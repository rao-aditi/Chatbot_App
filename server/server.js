// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const prisma = require('./utils/db');
const aiConfig = require('./ai/config');
const { verifyToken, signToken } = require('./ai/auth');
const { createChatHandler } = require('./ai/chatHandler');
const { isAiEnabled } = require('./ai/agent');

const PORT = process.env.PORT || 5002;

const DEFAULT_CLIENT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "https://chatbot-app-rust.vercel.app"
];

// Local dev origins always stay allowed alongside whatever CLIENT_ORIGIN
// is configured, so the same deployed backend can be hit from local dev too.
const CLIENT_ORIGINS = [
  ...DEFAULT_CLIENT_ORIGINS,
  ...(process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : [])
]
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter((origin, index, arr) => origin && arr.indexOf(origin) === index);

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// Database Middleware 
app.use(async (req, res, next) => {
  req.prisma = prisma;
  next();
});

// REST endpoints 
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), authRequired: Boolean(aiConfig.authSecret) });
});

// ---- Local-development admin access ---------------------------------------
// Lets the AdminDashboard open without a login or a pasted token: the server
// mints a short-lived admin JWT (same format/secret as `npm run admin-token`) so
// the normal socket auth path stays fully enforced. Hard-restricted to local
// development:
//   - needs an explicit opt-in (ADMIN_DEV_ACCESS=true) AND NODE_ENV !== 'production'
//   - needs CHAT_AUTH_SECRET (tokens are still signed and verified)
//   - only answers loopback connections with a localhost Host header (blocks
//     DNS rebinding) and a localhost Origin (blocks other websites from reading
//     the token cross-origin; CORS is otherwise open on this server)
const ADMIN_DEV_ACCESS = process.env.ADMIN_DEV_ACCESS === 'true' && process.env.NODE_ENV !== 'production';
const ADMIN_DEV_TOKEN_TTL_SECONDS = 10 * 60;
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

app.get('/api/admin/dev-token', (req, res) => {
  const origin = req.headers.origin;
  if (
    !ADMIN_DEV_ACCESS ||
    !aiConfig.authSecret ||
    !LOOPBACK_ADDRS.has(req.socket.remoteAddress) ||
    !LOCAL_HOST_RE.test(req.headers.host || '') ||
    (origin && !LOCAL_ORIGIN_RE.test(origin))
  ) {
    return res.status(404).json({ error: 'Not found.' });
  }
  const token = signToken(
    { id: 'admin', name: 'Admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + ADMIN_DEV_TOKEN_TTL_SECONDS },
    aiConfig.authSecret
  );
  res.set('Cache-Control', 'no-store');
  res.json({ token, expiresIn: ADMIN_DEV_TOKEN_TTL_SECONDS });
});

// Chat history for the caller's OWN room. The same history is also pushed over
// the socket ('history' event); this endpoint lets a client reload it on demand.
// Requires a verified token (CHAT_AUTH_SECRET) and the room is derived from the
// token's identity, so a user can never read another user's room.
app.get('/api/messages/:roomId', async (req, res) => {
  if (!aiConfig.authSecret) {
    return res.status(503).json({ error: 'Chat history API requires CHAT_AUTH_SECRET to be configured.' });
  }
  const header = req.headers.authorization || '';
  const claims = header.startsWith('Bearer ') ? verifyToken(header.slice(7), aiConfig.authSecret) : null;
  const userId = claims && String(claims.id || claims.sub || '');
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });

  const ownRoomId = `room_${userId}`;
  if (req.params.roomId !== ownRoomId) return res.status(403).json({ error: 'Forbidden.' });

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
  try {
    // Newest `limit` messages, returned oldest-first for display.
    const rows = await prisma.message.findMany({
      where: { roomId: ownRoomId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({ roomId: ownRoomId, messages: rows.reverse() });
  } catch (error) {
    console.error('Error loading messages:', error);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// HTTP + Socket.io server
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGINS, methods: ['GET', 'POST'] },
});

// Reject unauthenticated sockets during the handshake. Doing this in middleware
// (rather than disconnecting after 'connection') means a bad token never gets a
// live session, so the client's in-flight polling requests can't hit
// "Session ID unknown"; it receives a clean `connect_error` instead.
io.use((socket, next) => {
  if (!aiConfig.authSecret) return next();
  const claims = verifyToken(socket.handshake.auth && socket.handshake.auth.token, aiConfig.authSecret);
  if (!claims) {
    const err = new Error('unauthorized');
    err.data = { code: 'unauthorized', message: 'Authentication required.' };
    return next(err);
  }
  socket.data.claims = claims;
  next();
});

// Socket.io with Database Integration
io.on('connection', (socket) => {

  let isAdmin = socket.handshake.query.isAdmin === 'true';
  // Reassigned once createOrGetRoom resolves the real DB user id (see below).
  let userId = socket.handshake.query.userId || null;
  let userName = socket.handshake.query.userName || "";
  let userEmail = socket.handshake.query.userEmail || "";

  // When CHAT_AUTH_SECRET is set, identity and admin status come only from a
  // verified token; the client-supplied query values are ignored.
  if (aiConfig.authSecret) {
    const claims = socket.data.claims; // verified by io.use above
    userId = String(claims.id || claims.sub || '') || null;
    userName = claims.name || "";
    userEmail = claims.email || "";
    isAdmin = claims.role === 'admin' && socket.handshake.query.isAdmin === 'true';
  }

  const roomId = userId
    ? `room_${userId}`
    : `room_${require("crypto").randomUUID()}`;

  // client_message awaits this before computing senderId, so a fast first
  // message can't race ahead of user-id resolution (see createOrGetRoom).
  let roomSetupPromise = Promise.resolve(null);

  // Resolves the caller's tool permissions after room setup. Admin tools are
  // only granted when identity is token-verified; without CHAT_AUTH_SECRET the
  // userId is client-asserted and therefore never trusted for elevated roles.
  const getIdentity = async () => {
    await roomSetupPromise;
    let role = 'user';
    if (aiConfig.authSecret && userId) {
      const dbUser = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (dbUser && dbUser.role === 'admin') role = 'admin';
    }
    return { userId, role };
  };

  const notifyAdmins = async (targetRoomId) => {
    if (targetRoomId === 'general') return;
    io.to('admins').emit('active_rooms', await getActiveRooms());
  };

  const chat = isAdmin
    ? null
    : createChatHandler({ io, socket, roomId, getIdentity, notifyAdmins });

  if (isAdmin) {
    socket.join('admins');

    // Get active rooms from database
    getActiveRooms().then(rooms => {
      socket.emit('active_rooms', rooms);
    });
  } else {
    socket.join(roomId);

    roomSetupPromise = createOrGetRoom(roomId, userId, userName, userEmail)
      .then(({ room, userId: resolvedUserId }) => {
        userId = resolvedUserId;
        return room;
      })
      .catch((error) => {
        // A DB error here must not crash the whole Socket.IO server for
        // every connected client — log it and let the client retry/reconnect.
        console.error('Error loading room/history on connection:', error);
        socket.emit('error', { message: 'Failed to load chat history' });
        return null;
      });

    roomSetupPromise.then(async (room) => {
      if (!room) return;

      const messages = await prisma.message.findMany({
        where: { roomId: room.id },
        orderBy: { createdAt: 'asc' },
        take: 100
      });

      socket.emit('history', messages);
    });
  }

  // Admin joining a specific customer's room
  socket.on('join_room', async (targetRoomId) => {
    if (!isAdmin) return;

    if (typeof targetRoomId !== 'string' || !targetRoomId) return;

    try {
      // An admin follows one conversation at a time: leave any previously
      // viewed customer room so live events from it stop arriving.
      for (const joined of socket.rooms) {
        if (joined !== socket.id && joined !== 'admins' && joined !== targetRoomId) socket.leave(joined);
      }
      socket.join(targetRoomId);

      // Newest 1000 messages, oldest-first. 'admin_history' carries the roomId
      // so a slow response for a previously selected room can be discarded.
      const rows = await prisma.message.findMany({
        where: { roomId: targetRoomId },
        orderBy: { createdAt: 'desc' },
        take: 1000
      });

      socket.emit('admin_history', { roomId: targetRoomId, messages: rows.reverse() });
    } catch (error) {
      console.error('Error loading room on join_room:', error);
      socket.emit('error', { message: 'Failed to load room' });
    }
  });

  socket.on('client_message', async (payload) => {
    // Customers go through the AI chat flow (legacy event name kept so older
    // clients keep working); only agents use the direct-reply path below.
    if (!isAdmin) return chat.handleMessage(payload);

    const text = (payload && payload.text ? String(payload.text) : '').trim();
    if (!text) return;

    // Make sure userId has been resolved (see createOrGetRoom) before it's
    // used below — otherwise a message sent right after connecting could
    // race ahead of that resolution and get attributed to a stale id.
    await roomSetupPromise;

    // Agent replies must name an existing customer conversation; they are
    // persisted to and emitted to that one room only.
    const targetRoomId = payload && typeof payload.roomId === 'string' ? payload.roomId : '';
    if (!targetRoomId) return;
    const sender = 'agent';
    const senderId = null;

    try {
      const exists = await prisma.room.findUnique({ where: { id: targetRoomId }, select: { id: true } });
      if (!exists) return socket.emit('error', { message: 'Unknown conversation' });

      // Save user message to database
      const userMessage = await prisma.message.create({
        data: {
          roomId: targetRoomId,
          senderId: senderId,
          sender: sender,
          text: text,
          type: 'text',
          metadata: {
            timestamp: new Date().toISOString()
          }
        }
      });

      io.to(targetRoomId).emit('message', userMessage);

      // Update room's last message
      await prisma.room.upsert({
        where: { id: targetRoomId },
        update: {
          lastMessage: new Date()
        },
        create: {
          id: targetRoomId,
          type: "support",
          name: `Room ${targetRoomId}`,
          lastMessage: new Date()
        }
      });

      // Update active rooms meta
      if (targetRoomId !== 'general') {
        const rooms = await getActiveRooms();
        io.to('admins').emit('active_rooms', rooms);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('disconnect', async () => {
    if (isAdmin) {
    } else {
      console.log(`[socket] customer disconnected: ${socket.id} (room: ${roomId})`);
      // Update room status in database if needed
    }
  });
});

// Helper functions
async function createOrGetRoom(roomId, userId, userName, userEmail) {
  let room = await prisma.room.findUnique({
    where: { id: roomId }
  });

  if (!room) {
    room = await prisma.room.create({
      data: {
        id: roomId,
        type: "support",
        name: `Room ${roomId}`
      }
    });
  }

  // The id that should actually be used as Message.senderId — defaults to
  // the client-generated userId, but falls back to whichever User row really
  // owns this email if that id doesn't have (or can't get) a User row.
  let effectiveUserId = userId;

  if (userId) {
    // Create user if not exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      try {
        await prisma.user.create({
          data: {
            id: userId,
            email: userEmail,
            name: userName || ""
          }
        });
      } catch (error) {
        // email is globally unique — a different userId sharing the same
        // email (e.g. same person, cleared localStorage) must not crash
        // the connection. Reuse the existing account's id so messages can
        // still be attributed and saved instead of failing their FK check.
        if (error.code !== 'P2002') throw error;

        const userByEmail = userEmail
          ? await prisma.user.findUnique({ where: { email: userEmail } })
          : null;
        effectiveUserId = userByEmail ? userByEmail.id : null;

        console.warn(`User email ${userEmail} already registered under a different id; using ${effectiveUserId} instead of ${userId}`);
      }
    }

    const existingRoomUser = await prisma.roomUser.findFirst({
      where: {
        roomId,
        userId
      }
    });

    if (!existingRoomUser) {
      await prisma.roomUser.create({
        data: {
          roomId,
          userId,
          userName
        }
      });
    }
  }

  return { room, userId: effectiveUserId };
}

async function getActiveRooms() {
  try {
    const rooms = await prisma.room.findMany({
      where: {
        lastMessage: {
          not: null
        }
      },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        },
        users: true
      },
      orderBy: {
        lastMessage: "desc"
      }
    });

    return rooms.map(room => ({
      roomId: room.id,
      customerName: room.users?.[0]?.userName || "",
      lastMessage: room.messages?.[0]?.text || "No messages",
      lastMessageTime: room.lastMessage,
      online: true,
      totalMessages: room.messages.length
    }));
  } catch (error) {
    console.error("Error getting active rooms:", error);
    return [];
  }
}

async function getRoomData(roomId) {
  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        },
        users: true
      }
    });

    return room
      ? [{
        roomId: room.id,
        customerName: room.users?.[0]?.userName || "",
        lastMessage: room.messages?.[0]?.text || "No messages",
        lastMessageTime: room.lastMessage,
        online: true,
        totalMessages: room.messages.length
      }]
      : [];
  } catch (error) {
    console.error("Error getting room data:", error);
    return [];
  }
}

// Start server 
server.listen(PORT, async () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(isAiEnabled()
    ? `AI chat enabled (model: ${aiConfig.model})`
    : 'GEMINI_API_KEY not set — chat replies are disabled until it is configured');
  if (process.env.ADMIN_DEV_ACCESS === 'true') {
    console.warn(ADMIN_DEV_ACCESS && aiConfig.authSecret
      ? '[admin] ADMIN_DEV_ACCESS on: /api/admin/dev-token serves loopback requests only (local development)'
      : '[admin] ADMIN_DEV_ACCESS ignored (disabled in production or CHAT_AUTH_SECRET missing)');
  }
  if (!aiConfig.authSecret) {
    console.warn('CHAT_AUTH_SECRET not set — socket identities are client-asserted (dev mode)');
  }
});