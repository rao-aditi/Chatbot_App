// Central AI settings — everything tunable comes from environment variables.
require('dotenv').config();
const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
};

module.exports = {
  apiKey: process.env.GEMINI_API_KEY || '',
  model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  // Used when the primary model is overloaded or out of quota. Set empty to disable.
  fallbackModel: process.env.GEMINI_FALLBACK_MODEL === undefined ? 'gemini-3.1-flash-lite' : process.env.GEMINI_FALLBACK_MODEL,
  requestTimeoutMs: int(process.env.GEMINI_TIMEOUT_MS, 30000),
  maxOutputTokens: int(process.env.GEMINI_MAX_OUTPUT_TOKENS, 4096),
  maxToolIterations: int(process.env.AI_MAX_TOOL_ITERATIONS, 5),
  maxMessageChars: int(process.env.CHAT_MAX_MESSAGE_CHARS, 2000),
  historyMessages: int(process.env.CHAT_HISTORY_MESSAGES, 12),
  historyCharBudget: int(process.env.CHAT_HISTORY_CHAR_BUDGET, 12000),
  maxPendingPerSocket: int(process.env.CHAT_MAX_PENDING, 3),
  messagesPerMinute: int(process.env.CHAT_MESSAGES_PER_MINUTE, 15),
  aiRequestsPerHour: int(process.env.AI_REQUESTS_PER_HOUR, 60),
  // When set, sockets must present an HS256 JWT (auth.token) signed with this.
  // Gemini File Search store holding docs/ai-knowledge (see scripts/indexDocs.js).
  fileSearchStore: process.env.FILE_SEARCH_STORE_NAME || '',
  authSecret: process.env.CHAT_AUTH_SECRET || '',
};
