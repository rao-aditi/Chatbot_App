// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const prisma = require('./utils/db');

const {
  findAnswer,
  listSections,
  getQuestionsBySection,
  addKnowledgeBaseEntry,
  loadKnowledgeBase
} = require('./utils/matcher');

const PORT = process.env.PORT || 5002;

const CLIENT_ORIGINS = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(',')
  : [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "https://office-managment-testing.vercel.app"
  ]

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
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/sections', async (req, res) => {
  try {
    const sections = await listSections();
    res.json(sections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sections/:section', async (req, res) => {
  try {
    const questions = await getQuestionsBySection(req.params.section);
    res.json(questions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const { message, roomId, userId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) is required' });
    }

    const result = await findAnswer(message);

    // Save the user message to database
    // const userMessage = await prisma.message.create({
    //   data: {
    //     roomId: roomId || 'general',
    //     senderId: userId || null,
    //     sender: 'user',
    //     text: message,
    //     type: 'text',
    //     metadata: {
    //       timestamp: new Date().toISOString(),
    //       query: message
    //     }
    //   }
    // });

    const userMessage = await prisma.message.create({
      data: {
        roomId: roomId || 'general',
        senderId: userId || null,
        sender: 'user',
        text: message,
        type: 'text',
        metadata: {
          timestamp: new Date().toISOString()
        }
      }
    });

    // Save the bot response to database
    const botMessage = await prisma.message.create({
      data: {
        roomId: roomId || 'general',
        senderId: null,
        sender: 'bot',
        text: result.answer,
        type: 'text',
        metadata: {
          matched: result.matched,
          confidence: result.confidence,
          section: result.section,
          sourceQuestion: result.question,
          timestamp: new Date().toISOString()
        }
      }
    });

    // Update room's last message
    await prisma.room.upsert({
      where: {
        id: roomId || 'general',
      },
      create: {
        id: roomId || 'general',
        type: "support",
        name: `Room ${roomId || 'general'}`,
        lastMessage: new Date(),
      },
      update: {
        lastMessage: new Date(),
      },
    });

    res.json({
      ...result,
      messageIds: {
        user: userMessage.id,
        bot: botMessage.id
      }
    });
  } catch (error) {
    console.error('Error in ask endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Knowledge Base Management 
app.post('/api/knowledge-base', async (req, res) => {
  try {
    const { section, question, answer, keywords } = req.body;

    if (!section || !question || !answer) {
      return res.status(400).json({ error: 'section, question, and answer are required' });
    }

    const entry = await addKnowledgeBaseEntry(section, question, answer, keywords);
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/knowledge-base', async (req, res) => {
  try {
    const kb = await loadKnowledgeBase();
    res.json(kb);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//  Message History 
app.get('/api/messages/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const messages = await prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      skip: parseInt(offset),
      take: parseInt(limit)
    });

    const total = await prisma.message.count({
      where: { roomId }
    });

    res.json({
      messages: messages.reverse(),
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// HTTP + Socket.io server
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGINS, methods: ['GET', 'POST'] },
});

// Socket.io with Database Integration
io.on('connection', (socket) => {

  const isAdmin = socket.handshake.query.isAdmin === 'true';
  // const roomId = socket.handshake.query.roomId || "";
  const userId = socket.handshake.query.userId || null;
  const userName = socket.handshake.query.userName || "";
  const userEmail = socket.handshake.query.userEmail || "";

  const roomId = userId
    ? `room_${userId}`
    : `room_${require("crypto").randomUUID()}`;

  if (isAdmin) {
    socket.join('admins');

    // Get active rooms from database
    getActiveRooms().then(rooms => {
      socket.emit('active_rooms', rooms);
    });
  } else {
    socket.join(roomId);

    createOrGetRoom(roomId, userId, userName, userEmail).then(async (room) => {
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
    if (isAdmin) {
      socket.join(targetRoomId);

      const messages = await prisma.message.findMany({
        where: { roomId: targetRoomId },
        orderBy: { createdAt: 'asc' },
        take: 100
      });

      socket.emit('history', messages);
    }
  });

  socket.on('client_message', async (payload) => {
    const text = (payload && payload.text ? String(payload.text) : '').trim();
    if (!text) return;

    const targetRoomId = isAdmin ? (payload.roomId || roomId) : roomId;
    const sender = isAdmin ? 'agent' : 'user';
    const senderId = payload.userId || userId || null;

    try {
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

      // If customer sends a message, trigger bot response
      if (!isAdmin) {
        io.to(targetRoomId).emit('bot_typing', true);

        setTimeout(async () => {
          try {
            const result = await findAnswer(text);

            // Save bot message to database
            const botMessage = await prisma.message.create({
              data: {
                roomId: targetRoomId,
                sender: 'bot',
                text: result.answer,
                type: 'text',
                metadata: {
                  matched: result.matched,
                  confidence: result.confidence,
                  section: result.section,
                  sourceQuestion: result.question,
                  timestamp: new Date().toISOString()
                }
              }
            });

            io.to(targetRoomId).emit('bot_typing', false);
            io.to(targetRoomId).emit('message', botMessage);

            // Update active rooms
            if (targetRoomId !== 'general') {
              const rooms = await getActiveRooms();
              io.to('admins').emit('active_rooms', rooms);
            }
          } catch (error) {
            console.error('Error in bot response:', error);
            io.to(targetRoomId).emit('bot_typing', false);
          }
        }, 500 + Math.random() * 400);
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

  if (userId) {
    // Create user if not exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!existingUser) {
      await prisma.user.create({
        data: {
          id: userId,
          email: userEmail,
          name: userName || ""
        }
      });
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

  return room;
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

  try {
    const count = await prisma.knowledgeBase.count();
    if (count === 0) {
      console.log('No knowledge base entries found. Please import data.');
    }
  } catch (error) {
    console.error('Error checking knowledge base:', error);
  }
});