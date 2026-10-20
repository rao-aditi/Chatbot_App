import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:5002';
const UNAUTHORIZED_RETRY_MS = 5000;

// Local development: the server hands out a short-lived admin token to loopback
// requests (see /api/admin/dev-token). No login and nothing to paste. In any
// environment where that endpoint is disabled this resolves to '' and the
// server rejects the socket, which surfaces as `accessDenied`.
const fetchAdminToken = async () => {
  try {
    const res = await fetch(`${SERVER_URL}/api/admin/dev-token`, { cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    return data.token || '';
  } catch {
    return '';
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

  // One socket for the lifetime of the dashboard. Socket.IO reconnects on its
  // own after network drops or server restarts; the auth callback below runs on
  // every attempt so a fresh token is always presented.
  useEffect(() => {
    let retryTimer = null;

    const socket = io(SERVER_URL, {
      query: { isAdmin: 'true' },
      auth: (cb) => { fetchAdminToken().then((token) => cb({ token })); },
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
      if (selectedRoomRef.current) socket.emit('join_room', selectedRoomRef.current);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setBotTyping(false);
    });

    socket.on('connect_error', (err) => {
      setConnected(false);
      // Middleware rejections are not retried by socket.io; retry ourselves in
      // case the server came up with different settings.
      if (err && err.message === 'unauthorized') {
        setAccessDenied(true);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => socket.connect(), UNAUTHORIZED_RETRY_MS);
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
  };
}
