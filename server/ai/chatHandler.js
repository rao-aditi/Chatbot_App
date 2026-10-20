// Customer chat flow over Socket.IO:
//   chat_message {requestId, text, retry?}  ->  typing, message(s), chat_reply | chat_error
//   clear_chat                              ->  history []
// A room always belongs to the socket's server-resolved identity — the client
// can never name a room, so users cannot read or write other users' chats.
const prisma = require('../utils/db');
const config = require('./config');
const { runAgent, isAiEnabled } = require('./agent');
const { createRateLimiter } = require('./rateLimiter');

const messageLimiter = createRateLimiter(config.messagesPerMinute, 60 * 1000);
const aiLimiter = createRateLimiter(config.aiRequestsPerHour, 60 * 60 * 1000);

const REQUEST_ID_RE = /^[\w-]{1,64}$/;

// Recent turns as model input, newest kept first, trimmed to a character
// budget (a cheap stand-in for token counting).
async function loadHistory(roomId, excludeId) {
  const rows = await prisma.message.findMany({
    where: { roomId, type: { in: ['text', 'support_request'] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: config.historyMessages,
    select: { sender: true, text: true },
  });

  const turns = [];
  let used = 0;
  for (const r of rows) {
    const body = r.text.slice(0, config.maxMessageChars);
    if (used + body.length > config.historyCharBudget) break;
    used += body.length;
    turns.push({
      role: r.sender === 'user' ? 'user' : 'assistant',
      content: r.sender === 'agent' || r.sender === 'support' ? `[Human support agent] ${body}` : body,
    });
  }
  return turns.reverse();
}

/**
 * @param {object} deps
 * @param {import('socket.io').Server} deps.io
 * @param {import('socket.io').Socket} deps.socket
 * @param {string} deps.roomId
 * @param {() => Promise<{userId: string|null, role: string}>} deps.getIdentity resolves after room setup
 * @param {(roomId: string) => Promise<void>} deps.notifyAdmins
 */
function createChatHandler({ io, socket, roomId, getIdentity, notifyAdmins }) {
  let pending = 0;
  // Serialises work per socket so replies come back in order and history is
  // consistent, while each reply still carries its own requestId.
  let queue = Promise.resolve();

  const fail = (requestId, code, message) => socket.emit('chat_error', { requestId, code, message });

  async function process({ requestId, text, retry }) {
    const { userId, role } = await getIdentity();
    const rateKey = userId || socket.id;

    if (!messageLimiter(rateKey)) {
      return fail(requestId, 'rate_limited', 'You are sending messages too quickly. Please wait a moment.');
    }

    // Persist the user's message once; a retry reuses the stored one.
    let userMessage = null;
    if (retry) {
      userMessage = await prisma.message.findFirst({
        where: { roomId, sender: 'user', metadata: { path: ['requestId'], equals: requestId } },
      });
    }
    if (!userMessage) {
      userMessage = await prisma.message.create({
        data: {
          roomId,
          senderId: userId || null,
          sender: 'user',
          text,
          type: 'text',
          metadata: { timestamp: new Date().toISOString(), requestId },
        },
      });
      io.to(roomId).emit('message', userMessage);
    }

    await prisma.room.upsert({
      where: { id: roomId },
      update: { lastMessage: new Date() },
      create: { id: roomId, type: 'support', name: `Room ${roomId}`, lastMessage: new Date() },
    });
    notifyAdmins(roomId);

    io.to(roomId).emit('bot_typing', true);
    socket.emit('typing', { requestId, isTyping: true });

    try {
      // Every message goes to the AI model. There is deliberately no
      // canned-answer fallback: if the provider fails the user sees an error
      // (with Retry) instead of a wrong or unrelated answer.
      if (!isAiEnabled()) {
        console.error('[chat] GEMINI_API_KEY is not set; cannot answer.');
        return fail(requestId, 'config', 'The assistant is not configured correctly. Please contact support.');
      }
      if (!aiLimiter(rateKey)) {
        return fail(requestId, 'quota', 'You have reached the hourly assistant limit. Please try again later.');
      }

      const history = await loadHistory(roomId, userMessage.id);
      const { text: replyText, toolsUsed } = await runAgent(history, text, { userId, roomId, role, io });
      const metadata = { timestamp: new Date().toISOString(), requestId, ai: true, model: config.model, tools: toolsUsed };

      const botMessage = await prisma.message.create({
        data: { roomId, sender: 'bot', text: replyText, type: 'text', metadata },
      });
      io.to(roomId).emit('message', botMessage);
      socket.emit('chat_reply', { requestId, message: botMessage });
      notifyAdmins(roomId);
    } catch (err) {
      fail(requestId, err.code || 'failed', err.userMessage || 'Something went wrong. Please try again.');
    } finally {
      io.to(roomId).emit('bot_typing', false);
      socket.emit('typing', { requestId, isTyping: false });
    }
  }

  function handleMessage(payload) {
    const requestId =
      payload && REQUEST_ID_RE.test(String(payload.requestId || '')) ? String(payload.requestId) : `srv_${Date.now()}`;

    if (!payload || typeof payload.text !== 'string') {
      return fail(requestId, 'invalid', 'Message must be text.');
    }
    const text = payload.text.trim();
    if (!text) return fail(requestId, 'invalid', 'Message cannot be empty.');
    if (text.length > config.maxMessageChars) {
      return fail(requestId, 'too_long', `Message is too long (max ${config.maxMessageChars} characters).`);
    }
    if (pending >= config.maxPendingPerSocket) {
      return fail(requestId, 'busy', 'Please wait for earlier replies before sending more.');
    }

    pending += 1;
    queue = queue
      .then(() => process({ requestId, text, retry: payload.retry === true }))
      .catch((err) => {
        console.error('[chat] unexpected error:', err);
        fail(requestId, 'failed', 'Something went wrong. Please try again.');
      })
      .finally(() => { pending -= 1; });
  }

  async function clearChat() {
    try {
      await getIdentity();
      await prisma.message.deleteMany({ where: { roomId } });
      io.to(roomId).emit('history', []);
      notifyAdmins(roomId);
    } catch (err) {
      console.error('[chat] clear failed:', err);
      socket.emit('chat_error', { requestId: null, code: 'failed', message: 'Could not clear the conversation.' });
    }
  }

  socket.on('chat_message', handleMessage);
  socket.on('clear_chat', clearChat);

  return { handleMessage };
}

module.exports = { createChatHandler };
