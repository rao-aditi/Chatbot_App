import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:5002';

export default function useChatSocket(initialRoomId) {
  const socketRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [botTyping, setBotTyping] = useState(false);

  const [roomId] = useState(() => {
    if (initialRoomId && initialRoomId !== 'general') return initialRoomId;
    let stored = localStorage.getItem('chat_room_id');
    if (!stored) {
      stored = 'room_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('chat_room_id', stored);
    }
    return stored;
  });

  useEffect(() => {
    const socket = io(SERVER_URL, {
      query: { roomId },
      transports: ['polling', 'websocket'],
      withCredentials: false,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      setConnected(false);
    });

    socket.on('history', (history) => {
      setMessages(history);
    });

    socket.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('bot_typing', (isTyping) => {
      setBotTyping(isTyping);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId]);

  const sendMessage = useCallback((text) => {
    if (!socketRef.current || !text.trim()) return;
    socketRef.current.emit('client_message', { text });
  }, []);

  return { roomId, messages, connected, botTyping, sendMessage };
}
