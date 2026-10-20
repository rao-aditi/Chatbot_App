// Gemini File Search store for the project documentation (docs/ai-knowledge).
// Indexing is a separate, explicit step (npm run index-docs) — never done per chat request.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');
const config = require('../config');

const DOCS_DIR = path.resolve(__dirname, '../../docs/ai-knowledge');
// Server-side state: store id + content hash of every indexed file. Gitignored.
const STATE_FILE = path.resolve(__dirname, '../../.knowledge-index.json');
// Only user-facing docs are indexed. Technical docs (API, database, auth,
// backend, integrations, architecture, structure, errors, AI agent, master index)
// stay on disk but are never put in the store, so the model cannot retrieve them.
const INDEXED_DOCS = [
  'PROJECT_OVERVIEW.md', 'BUSINESS_LOGIC.md', 'GST_MODULE_DOCUMENTATION.md', 'MARKETPLACE_AND_SOFTWARE_ACCESS.md',
  'CLIENT_PORTAL_DOCUMENTATION.md', 'FEATURES_AND_IMPLEMENTATION_STATUS.md', 'FRONTEND_DOCUMENTATION.md', 'PROJECT_GLOSSARY.md',
];
const STORE_DISPLAY_NAME = 'project-docs-ai-knowledge';

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { store: null, files: {} }; }
};
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

// FILE_SEARCH_STORE_NAME (env) wins over the state file written by the indexer.
const getStoreName = () => config.fileSearchStore || readState().store || '';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The SDK pager did not reliably follow page tokens, so list via REST (key stays server-side).
async function listDocuments(client, store) {
  const docs = [];
  let token = '';
  do {
    const url = `https://generativelanguage.googleapis.com/v1beta/${store}/documents?pageSize=20${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const res = await fetch(url, { headers: { 'x-goog-api-key': config.apiKey } });
    if (!res.ok) throw new Error(`Listing documents failed: ${res.status}`);
    const json = await res.json();
    docs.push(...(json.documents || []));
    token = json.nextPageToken || '';
  } while (token);
  return docs;
}

// Make the store mirror the docs folder: upload new/changed files, delete
// removed/changed ones. Unchanged files are skipped (hash match + exists remotely).
async function syncDocs({ force = false, log = console.log } = {}) {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set');
  const client = new GoogleGenAI({ apiKey: config.apiKey });
  const state = readState();

  let store = config.fileSearchStore || state.store;
  if (store) {
    try { await client.fileSearchStores.get({ name: store }); } catch { log(`Store ${store} not found, creating a new one`); store = null; state.files = {}; }
  }
  if (!store) {
    const created = await client.fileSearchStores.create({ config: { displayName: STORE_DISPLAY_NAME } });
    store = created.name;
    state.files = {};
    log(`Created store ${store}`);
  }
  state.store = store;

  const local = fs.readdirSync(DOCS_DIR).filter((f) => INDEXED_DOCS.includes(f));
  const remote = await listDocuments(client, store);
  const remoteByName = new Map();
  for (const d of remote) {
    const list = remoteByName.get(d.displayName) || [];
    list.push(d);
    remoteByName.set(d.displayName, list);
  }
  const del = (d) => client.fileSearchStores.documents.delete({ name: d.name, config: { force: true } });

  const result = { uploaded: [], skipped: [], deleted: [] };
  for (const file of local) {
    const buf = fs.readFileSync(path.join(DOCS_DIR, file));
    const hash = sha(buf);
    const existing = remoteByName.get(file) || [];
    if (!force && existing.length === 1 && state.files[file] === hash) { result.skipped.push(file); continue; }

    for (const d of existing) await del(d); // avoid duplicates / stale content
    let op = await client.fileSearchStores.uploadToFileSearchStore({
      file: path.join(DOCS_DIR, file),
      fileSearchStoreName: store,
      config: { displayName: file, mimeType: 'text/markdown', chunkingConfig: { whiteSpaceConfig: { maxTokensPerChunk: 400, maxOverlapTokens: 60 } } },
    });
    for (let i = 0; !op.done && i < 120; i += 1) { await sleep(2000); op = await client.operations.get({ operation: op }); }
    if (!op.done || op.error) throw new Error(`Indexing ${file} failed: ${JSON.stringify(op.error || 'timeout')}`);
    state.files[file] = hash;
    writeState(state);
    result.uploaded.push(file);
    log(`Indexed ${file}`);
  }

  for (const [name, docs] of remoteByName) {
    if (!local.includes(name)) { for (const d of docs) await del(d); delete state.files[name]; result.deleted.push(name); }
  }
  writeState(state);
  return { store, ...result };
}

module.exports = { syncDocs, getStoreName, DOCS_DIR };
