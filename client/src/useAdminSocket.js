import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://chatbot-app-t7b7.onrender.com/api';

export default function useAdminSocket() {
  const socketRef = useRef(null);
  const [activeRooms, setActiveRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [botTyping, setBotTyping] = useState(false);

  // Initialize socket connection as Admin
  useEffect(() => {
    const socket = io(SERVER_URL, {
      query: { isAdmin: 'true' },
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

    // Receive list of all active client rooms
    socket.on('active_rooms', (rooms) => {
      setActiveRooms(rooms);
    });

    // Receive chat history when joining a room
    socket.on('history', (history) => {
      setMessages(history);
    });

    // Receive new messages in the currently selected room
    socket.on('message', (msg) => {
      setMessages((prev) => {
        // Only append if we don't already have it (prevent duplicates)
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    // Receive bot typing status in the currently selected room
    socket.on('bot_typing', (isTyping) => {
      setBotTyping(isTyping);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Admin selects a chat room from the list
  const selectRoom = useCallback((roomId) => {
    setSelectedRoomId(roomId);
    setMessages([]);
    setBotTyping(false);
    if (socketRef.current) {
      socketRef.current.emit('join_room', roomId);
    }
  }, []);

  // Admin sends a message back to the customer
  const sendMessage = useCallback((text) => {
    if (!socketRef.current || !selectedRoomId || !text.trim()) return;
    socketRef.current.emit('client_message', {
      text,
      roomId: selectedRoomId,
    });
  }, [selectedRoomId]);

  return {
    activeRooms,
    selectedRoomId,
    selectRoom,
    messages,
    connected,
    botTyping,
    sendMessage,
  };
}
