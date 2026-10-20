# AI Agent / Chatbot Documentation

> **Status in this repository: the AI agent backend (Gemini or any LLM) is NOT implemented.** Only a frontend chat widget and a generic Socket.IO server exist. This file documents exactly what exists, what the widget expects, and what is missing, so a future agent can be built against a verified contract. Do not describe any Gemini behaviour as existing.
> Related: [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) §7, [INTEGRATIONS_AND_CONFIGURATION.md](INTEGRATIONS_AND_CONFIGURATION.md), [AI_KNOWLEDGE_INDEX.md](AI_KNOWLEDGE_INDEX.md).

## 1. Verification performed
- Searched the whole repository (excluding `node_modules`) case-insensitively for `gemini`, `genai`, `openai`, `chatbot`, `AI agent` → **no matches**.
- `backend/package.json` and `frontend/package.json` list **no** LLM SDK (`@google/generative-ai`, `@google/genai`, `openai`, `langchain`, …).
- `backend/.env.example` has **no** `GEMINI_API_KEY` or similar variable.
- Backend search for chat-related code (`messages`, `send-message`, `join-room`, `chat`): only unrelated hits (validation messages in `validationIssues.service.js`, WhatsApp service). There is **no** `/api/messages` route and **no** chat model in `schema.prisma` (no `ChatMessage`/`Conversation` table).
- Git history (all branches, `git log --all -S"gemini" -i`) has **no commit that ever contained the word "gemini"**. The widget was added by commit `2696f43` ("add chatbot app & Billing", 2026-06-22; it also added `helpers/useChatSocket.js` and `styles/ChatWidget.css`, which are no longer in the tree), then adjusted by `25d60b6` ("Fix ChatWidget Socket.IO connection lifecycle") and `7e41737` ("chat bot changes", 2026-08-13) — all frontend-only. The commit message "add chatbot app" suggests the chat/bot server is a **separate application outside this repository** **[inference]**. No `backend/` file in the current tree references any chat event.

## 2. What exists

### 2.1 Frontend chat widget — `frontend/src/office_Managment_Frontent/components/Chat/ChatWidget.jsx`
- Mounted for every **staff** session in `layouts/AppShell.jsx` (`{!clientMode && <ChatWidget />}`); not shown in Client Portal mode.
- Floating button (bottom-right) opening a chat window with bot/agent/user bubbles (icons `RiRobot2Fill`, `FaUserShield`), typing indicator, unread badge, connection state.
- Identity: reads `localStorage.userData` (`id`, `name`, `email`); room id = `room_<userId>`.
- **Socket.IO client** (`socket.io-client`) connects to `VITE_API_URL || http://localhost:5001` with `query: { userId, userName, userEmail }`, transports `websocket, polling`, infinite reconnection (0.5–5 s backoff). A connection error is surfaced as "Socket connection failed" only after an 8 s grace period.
- **Events the widget listens for:** `connect`, `disconnect`, `connect_error`, `reconnect_failed`, `history` (array of messages), `message` (single message), `bot_typing` (boolean).
- **Event it emits:** `client_message` with payload `{ text, roomId, userId, userName, userEmail }`.
- **REST call:** `GET {VITE_API_URL}/api/messages/{roomId}?limit=100` (plain `axios`, no auth header) → expects `{ messages: [...] }`.
- **Message shape the UI renders:** `{ id?, sender: "user" | "bot" | "agent" | "support", text, createdAt|timestamp, isTemp?, metadata?: { matched?: boolean, confidence?: number } }` — a "Confidence: NN%" badge is shown when `metadata.matched === false`, which suggests the intended backend was a retrieval/FAQ-matching bot (**inference, not verified**).

### 2.2 Backend Socket.IO server — `backend/server.js`
```js
const io = new Server(server, { cors: { origin: corsOrigins, methods: ["GET","POST"], credentials: true } });
io.on("connection", (socket) => {
  socket.on("join-import-room", (importId, ack) => { socket.join(importId); ack?.({ ok: true }); });
});
app.set("io", io);
```
This is the **only** socket handler. It is used by the GSTR-1 bulk-import progress feature, not by chat. The chat widget's `client_message`, `history`, `message`, `bot_typing` events and the `/api/messages/:roomId` route have **no server counterpart** in this repo, so the widget currently cannot receive replies (it will connect — the server accepts any socket — but nothing answers; loading history will fail with "Failed to load messages").

## 3. What does NOT exist (do not invent)
- Gemini API integration, prompts, system instructions, model configuration.
- Tools / function calling, RAG pipeline, embeddings, vector store, knowledge-base loader.
- Chat persistence tables, message routes, per-user conversation memory.
- Authentication for the chat socket (the widget sends user info in the handshake query without a token; the server does not check it).

## 4. Facts a future Gemini integration can rely on (verified)
| Topic | Fact | Source |
|---|---|---|
| HTTP + WS server | single `http.Server` shared by Express and Socket.IO; port `PORT` or 5001 | `backend/server.js` |
| CORS for sockets | same allow-list as REST (`CORS_ORIGINS` or dev list) | `backend/server.js` |
| Auth for REST | `Authorization: Bearer <accessToken>`; `authenticate` builds `req.user` with `permissions`, `role`, `orgAdminId`, `activeCompanyId` | `OfficeManagment/middleware/authenticate.js` |
| Socket auth | none today — an agent should verify the access token (e.g. `verifyAccessToken` in `OfficeManagment/utils/jwt.utils.js`) in the socket handshake before using data | — |
| Tenant scoping helper | `scopeWhere(orgAdminId, extra, companyId)` and `assertOwnedByAdmin` | `shared/services/ownership.service.js` |
| Response helpers | `successResponse` / `errorResponse` | `OfficeManagment/utils/response.utils.js` |
| Existing outbound notification channels | e-mail (`mailer.service.js`), WhatsApp via Vonage (`whatsapp.service.js`) | `shared/services/` |
| Socket instance access in controllers | `req.app.get("io")` | `server.js`, used in `gstr1ImportDraft.controller.js` |
| Env loading | `dotenv` in `server.js`; add new variable **names** to `.env.example` | `backend/.env.example` |

## 5. Suggested integration points (design notes, not existing code)
- Put the chat socket handlers next to the `join-import-room` handler (or a new `src/chat/` module registered from `server.js`), implementing `client_message` → emit `bot_typing: true` → call Gemini → persist → emit `message` (+ `bot_typing: false`) and `history` on connect.
- Provide `GET /api/messages/:roomId` (authenticated) because the widget calls it.
- Use this `docs/ai-knowledge/` folder as the retrieval corpus: chunk by `##` headings; `AI_KNOWLEDGE_INDEX.md` maps topics to files and source paths.
- Per-user data tools must go through the same services the REST API uses (pass an actor equivalent to `req.user`) so multi-tenant and permission rules ([AUTHENTICATION_AND_PERMISSIONS.md](AUTHENTICATION_AND_PERMISSIONS.md)) still apply.
- Never place API keys in this documentation or in `.env.example`; use a variable name such as `GEMINI_API_KEY` and keep the value only in the untracked `.env`.
