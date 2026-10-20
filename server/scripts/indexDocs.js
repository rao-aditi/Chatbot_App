// Usage: npm run index-docs [-- --force]
// Syncs server/docs/ai-knowledge/*.md into the Gemini File Search store.
const { syncDocs } = require('../ai/knowledge/store');

syncDocs({ force: process.argv.includes('--force') })
  .then((r) => {
    console.log(`\nStore: ${r.store}\nUploaded: ${r.uploaded.length}  Skipped: ${r.skipped.length}  Deleted: ${r.deleted.length}`);
    console.log('Optionally set FILE_SEARCH_STORE_NAME=' + r.store + ' in server/.env (otherwise .knowledge-index.json is used).');
  })
  .catch((e) => { console.error('Indexing failed:', e.message); process.exit(1); });
