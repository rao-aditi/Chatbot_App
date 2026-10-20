// Topic policy: the assistant explains how to USE OfficeGST (features, modules,
// workflows, business rules). It never explains APIs, database, authentication,
// integrations or internal implementation — even if the knowledge store has it.
// Enforced three ways: (1) technical docs are not indexed (knowledge/store.js),
// (2) restricted-only questions are refused here before any retrieval/model call,
// (3) replies that still leak technical details are replaced before delivery.

const REFUSAL =
  "I'm designed to help with OfficeGST's features and normal workflows. I can't provide details about APIs, databases, authentication, integrations, or internal technical implementation.";

// Technical vocabulary that signals a restricted topic.
const RESTRICTED = new RegExp(
  [
    '\\bapis?\\b', 'end-?points?', '\\broutes?\\b', '\\brest(?:ful)?\\b', 'graphql', 'webhooks?', 'payloads?',
    'request bod(?:y|ies)', 'response bod(?:y|ies)', '\\bcurl\\b', 'postman', 'swagger', 'openapi',
    'databases?', '\\bdb\\b', 'schemas?', '\\bsql\\b', 'postgres(?:ql)?', 'mysql', 'mongo', 'prisma', 'migrations?',
    'columns?\\b', 'foreign keys?', 'connection strings?', '\\borm\\b',
    '\\bjwt\\b', 'json web token', '\\btokens?\\b', 'oauth', 'bcrypt', 'password hash', 'hashed? password',
    '\\bsessions?\\b', '\\bcookies?\\b', 'authenticat\\w*', 'authoriz\\w*', 'rbac', 'permission (?:check|guard|matrix|key|logic)s?',
    'middleware', '\\bcors\\b', 'csrf', 'encrypt\\w*', '\\bsecrets?\\b', 'credentials?', 'api[ _-]?keys?',
    '\\benv(?:ironment)?[ _-]?(?:var\\w*|files?|variables?)?\\b', '\\.env', 'dotenv', 'config(?:uration)? files?',
    'gemini', 'openai', '\\bllm\\b', 'file search', 'knowledge (?:base|store)', 'system (?:prompt|instruction)s?', '\\bprompts?\\b',
    '\\bsmtp\\b', 'vonage', 'twilio', 'razorpay', 'stripe', 'sendgrid', 'third[- ]party', 'integrat\\w*',
    'backend', 'back-end', 'server[- ]side', 'frontend code', 'source code', 'codebase', 'repository', 'github',
    '\\bnode(?:\\.?js)?\\b', '\\bexpress\\b', '\\breact\\b', 'socket\\.?io', 'websockets?', 'docker', 'deploy\\w*', 'hosting', 'nginx',
    'controllers?', 'implementation', 'implemented in', 'how is it (?:built|coded)',
    '\\btables?\\b', 'which (?:url|server|endpoint)', 'what (?:url|server)', 'post(?:s|ed)? to', 'password[s]? (?:is|are)? ?(?:stored|saved|protected|encrypted|secured)',
    'where (?:is|are) .{0,40}(?:stored|saved)', '\\bhosted\\b',
    'file paths?', 'folder structure', 'architecture', 'tech(?:nology)? stack', 'libraries', '\\bnpm\\b', 'package\\.json',
  ].join('|'),
  'i'
);

// Signals that the user is also asking how to use the application.
const WORKFLOW = new RegExp(
  [
    'how (?:do|can|to|should|would)\\b', 'how to\\b', '\\bsteps?\\b', 'where (?:do|can) i',
    '\\b(?:add|create|edit|update|delete|assign|view|upload|download|file|generate|import|export|reconcile|reset|submit|find|open)\\s+(?:a |an |the |my |new )*(?:clients?|tasks?|reports?|invoices?|quotations?|returns?|documents?|reminders?|gst\w*)',
  ].join('|'),
  'i'
);

// Prompt-injection / prompt-disclosure attempts.
const PROMPT_PROBE =
  /(ignore|disregard|forget).{0,40}(instruction|rule|prompt)|reveal.{0,30}(prompt|instruction)|show.{0,30}(system|hidden).{0,10}(prompt|instruction)|developer mode|jailbreak/i;

// Remove the technical phrases, then see whether any usage question is left.
const hasWorkflowOutsideRestricted = (t) =>
  WORKFLOW.test(t.replace(new RegExp(RESTRICTED.source, 'gi'), ' '));

/**
 * @returns {{action:'refuse', reply:string} | {action:'answer', restrictedPart:boolean}}
 */
function classifyQuestion(text) {
  const t = String(text || '');
  if (PROMPT_PROBE.test(t)) return { action: 'refuse', reply: REFUSAL };
  if (!RESTRICTED.test(t)) return { action: 'answer', restrictedPart: false };
  // Technical terms with no usage question left -> refuse outright (no retrieval, no model call).
  // Technical terms next to a usage question -> answer only the usage part.
  if (!hasWorkflowOutsideRestricted(t)) return { action: 'refuse', reply: REFUSAL };
  return { action: 'answer', restrictedPart: true };
}

// Output guard. HARD leaks (APIs, secrets, DB, auth internals, AI/integration
// config, source files) replace the whole reply with the refusal. SOFT leaks
// (page routes, links, UI-library names) are scrubbed out of an otherwise fine answer.
const HARD_LEAK = [
  /\/api\/[\w/-]+/i,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w/:{}-]+/,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:SECRET|KEY|TOKEN|PASSWORD|HOST|PORT)\b/,
  /\b(?:JWT|bcrypt|Prisma|PostgreSQL|Socket\.IO|Express\.js|middleware|access token|refresh token)\b/i,
  /\bGemini\b|\bFile Search\b/i,
  /\b[\w-]+\.(?:js|jsx|ts|tsx|prisma|env|sql)\b/i,
  /\b(?:backend|frontend)\/(?:src|prisma)\b/i,
  /\bmodel\s+\w+\s*\{/,
  /\b(?:SELECT|INSERT INTO)\b[\s\S]{0,60}\b(?:FROM|VALUES)\b/,
];
const LIBS = /\b(?:Yup|Zod|Redux(?: Toolkit)?|Axios|React(?: Router)?|Vite|Tailwind|Node\.?js|Express|Formik)\b/;

const titleCase = (slug) => slug.split(/[-_/]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function scrubSoftLeaks(reply) {
  return reply
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/g, '$1') // markdown links -> text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/`([A-Za-z][\w ]*)`/g, '$1') // drop code formatting
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (m) => m.replace(/_/g, ' ')) // permission_keys -> plain words
    .replace(/\b([A-Z][a-z]+)((?:[A-Z][a-z]+)+)\b/g, (m) => m.replace(/([a-z])([A-Z])/g, '$1 $2')) // TaskForm -> Task Form
    .replace(/`\/([\w/-]+)`/g, (_, route) => `**${titleCase(route)}**`) // `/assign-task` -> **Assign Task**
    .replace(/(^|\s)\/([a-z][\w-]*(?:\/[\w-]+)*)(?=[\s.,;:)]|$)/g, (_, pre, route) => `${pre}**${titleCase(route)}**`)
    .split('\n')
    .map((line) => (LIBS.test(line) ? line.split(/(?<=[.!?])\s+/).filter((sent) => !LIBS.test(sent)).join(' ') : line))
    .join('\n');
}

// Returns the text that may be delivered to the user.
function guardReply(reply) {
  const hit = HARD_LEAK.map((re) => reply.match(re)).find(Boolean);
  if (hit) return { text: REFUSAL, blocked: true, matched: hit[0] };
  return { text: scrubSoftLeaks(reply), blocked: false };
}

// Extra per-request instruction when a question mixes usage + technical parts.
const MIXED_NOTE =
  'NOTE FOR THIS MESSAGE: it contains both a usage question and a restricted technical part. Answer ONLY the usage/workflow part. Do not mention, summarise or hint at the technical part, except to end with this sentence: "I can\'t provide details about APIs, databases, authentication, integrations, or internal technical implementation."';

module.exports = { REFUSAL, classifyQuestion, guardReply, MIXED_NOTE };
