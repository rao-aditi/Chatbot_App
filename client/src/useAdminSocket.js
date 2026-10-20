import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5002';
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60000;

// The dashboard has no login. Its own host (Vercel function / Vite dev
// middleware, client/api/admin-token.js) holds a server-side key and returns a
// short-lived dashboard token. Resolves { token } or { error } with a message an
// operator can act on.
const fetchAdminToken = async () => {
  try {
    const res = await fetch('/api/admin-token', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) return { token: data.token };
    return { error: data.error || `Dashboard token service returned ${res.status}.` };
  } catch {
    return { error: 'Dashboard token service (/api/admin-token) is unreachable.' };
  }
};

export default function useAdminSocket() {
  const socketRef = useRef(null);
  const selectedRoomRef = useRef(null);
  const [activeRooms, setActiveRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [botTyping, setBotTyping] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  // Human-readable reason the dashboard cannot connect (config/auth/network).
  const [diagnostic, setDiagnostic] = useState('');

  // One socket for the lifetime of the dashboard. Socket.IO reconnects on its
  // own after network drops or server restarts; the auth callback below runs on
  // every attempt so a fresh token is always presented.
  useEffect(() => {
    let retryTimer = null;
    let retryAttempt = 0;
    let lastTokenError = '';

    const socket = io(SERVER_URL, {
      // Admin status comes only from the signed token the server verifies.
      auth: (cb) => {
        fetchAdminToken().then(({ token, error }) => {
          lastTokenError = error || '';
          cb({ token: token || '' });
        });
      },
      transports: ['polling', 'websocket'],
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    // Fires on the first connect and after every reconnect. Server-side room
    // membership is lost with the old socket, so re-join the open conversation
    // (which also reloads its history). The room list is pushed by the server.
    socket.on('connect', () => {
      setConnected(true);
      setAccessDenied(false);
      setDiagnostic('');
      retryAttempt = 0;
      if (selectedRoomRef.current) socket.emit('join_room', selectedRoomRef.current);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setBotTyping(false);
    });

    socket.on('connect_error', (err) => {
      setConnected(false);
      // Middleware rejections are not retried by socket.io, so retry here with
      // exponential backoff (5s, 10s, ... capped at 60s) - never a tight loop.
      // A fresh token is fetched on each attempt, so expiry self-heals.
      const code = err && err.message;
      if (code === 'unauthorized' || code === 'server_misconfigured') {
        setAccessDenied(true);
        setDiagnostic(
          code === 'server_misconfigured'
            ? 'Chat server is missing CHAT_AUTH_SECRET.'
            : lastTokenError || 'Chat server rejected the dashboard credentials.'
        );
        clearTimeout(retryTimer);
        const delay = Math.min(RETRY_BASE_MS * 2 ** retryAttempt, RETRY_MAX_MS);
        retryAttempt += 1;
        retryTimer = setTimeout(() => socket.connect(), delay);
      } else {
        setDiagnostic(`Cannot reach chat server at ${SERVER_URL}. Retrying…`);
      }
    });

    socket.on('active_rooms', (rooms) => {
      setActiveRooms(Array.isArray(rooms) ? rooms : []);
    });

    // Full history of the selected conversation; replaces (never appends to)
    // the list, so reconnects cannot duplicate messages.
    socket.on('admin_history', ({ roomId, messages: history }) => {
      if (roomId !== selectedRoomRef.current) return;
      setMessages(history || []);
    });

    // Sent to a room when its chat is cleared by the customer.
    socket.on('history', (history) => {
      if (Array.isArray(history) && history.length === 0) setMessages([]);
    });

    socket.on('message', (msg) => {
      if (!msg || msg.roomId !== selectedRoomRef.current) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      // Customer text arriving in the conversation being read is not "unread".
      if (msg.sender === 'user') socket.emit('mark_read', msg.roomId);
    });

    socket.on('bot_typing', (isTyping) => {
      setBotTyping(Boolean(isTyping));
    });

    return () => {
      clearTimeout(retryTimer);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const selectRoom = useCallback((roomId) => {
    selectedRoomRef.current = roomId;
    setSelectedRoomId(roomId);
    setMessages([]);
    setBotTyping(false);
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('join_room', roomId);
    }
  }, []);

  const sendMessage = useCallback((text) => {
    const roomId = selectedRoomRef.current;
    if (!socketRef.current || !roomId || !text.trim()) return;
    socketRef.current.emit('client_message', { text, roomId });
  }, []);

  return {
    activeRooms,
    selectedRoomId,
    selectRoom,
    messages,
    connected,
    botTyping,
    sendMessage,
    accessDenied,
    diagnostic,
  };
}
