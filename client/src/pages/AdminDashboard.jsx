import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useAdminSocket from '../useAdminSocket';
import logo from '../assets/image.png';
import {
    MessageSquare,
    Users,
    Settings,
    LogOut,
    Search,
    Send,
    User,
    Bot,
    Headphones,
    Circle,
    MoreVertical,
    Clock,
    ChevronLeft,
    ChevronRight
} from 'lucide-react';

function formatTime(iso) {
    if (!iso) return '';
    try {
        const date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function formatDate(iso) {
    if (!iso) return '';
    try {
        const date = new Date(iso);
        if (isNaN(date.getTime())) return '';
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) return 'Today';
        if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
        return '';
    }
}

function Avatar({ sender, size = 'sm' }) {
    const sizeClasses = {
        sm: 'w-8 h-8 text-sm',
        md: 'w-10 h-10 text-sm',
        lg: 'w-12 h-12 text-base'
    };

    let avatarClass = 'bg-[#2b7fa6] text-white';
    let initials = 'You';

    if (sender === 'bot') {
        avatarClass = 'bg-gradient-to-br from-[#04364A] via-[#06506B] to-[#022B3A] text-white';
        initials = 'LA';
    } else if (sender === 'agent' || sender === 'support') {
        avatarClass = 'bg-gradient-to-br from-[#04364A] via-[#06506B] to-[#022B3A] text-white';
        initials = 'SP';
    }

    return (
        <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center font-semibold flex-shrink-0 ${avatarClass}`}>
            {sender === 'bot' && <Bot className="w-4 h-4" />}
            {sender === 'agent' && <Headphones className="w-4 h-4" />}
            {sender === 'user' && <User className="w-4 h-4" />}
            {!['bot', 'agent', 'user'].includes(sender) && initials}
        </div>
    );
}

function MessageBubble({ msg }) {
    const isBot = msg.sender === 'bot';
    const isAgent = msg.sender === 'agent' || msg.sender === 'support';
    const isUser = msg.sender === 'user';

    let bubbleClass = 'bg-[#2b7fa6] text-white rounded-2xl rounded-br-md';
    let alignmentClass = 'justify-end';

    if (isBot || isAgent) {
        bubbleClass = isBot
            ? 'bg-white text-gray-800 rounded-2xl rounded-bl-md shadow-sm border border-gray-200'
            : 'bg-[#065273] text-white rounded-2xl rounded-bl-md';
        alignmentClass = 'justify-start';
    }

    return (
        <div className={`flex gap-2.5 mb-4 ${alignmentClass} animate-slideIn`}>
            {(isBot || isAgent) && <Avatar sender={msg.sender} size="sm" />}
            <div className={`max-w-[70%] px-4 py-3 ${bubbleClass}`}>
                {(isBot || isAgent) && (
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${isBot ? 'text-[#065273]' : 'text-white'}`}>
                            {isBot ? 'Bot' : 'Agent Support'}
                        </span>
                    </div>
                )}
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                {isBot && msg.meta && msg.meta.matched && (
                    <span className="inline-block mt-1.5 px-2 py-0.5 bg-gray-50 text-[#065273] text-[10px] font-semibold rounded-full">
                        {msg.meta.section}
                    </span>
                )}
                <span className="block text-[10px] opacity-60 mt-1.5 text-right">
                    {formatTime(msg.createdAt || msg.timestamp || msg.metadata?.timestamp)}
                </span>
            </div>
            {isUser && <Avatar sender="user" size="sm" />}
        </div>
    );
}

function SidebarRoomItem({ room, selected, onClick }) {
    return (
        <button
            onClick={() => onClick(room.roomId)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-200 group ${selected
                ? 'bg-gray-50 border-1 border-[#065273] shadow-sm'
                : 'hover:bg-gray-50 border-2 border-transparent'
                }`}
        >
            <div className="relative flex-shrink-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#04364A] via-[#06506B] to-[#022B3A] flex items-center justify-center text-white font-semibold text-sm">
                    {(room.customerName || `Customer #${room.roomId?.slice(-4)}`).charAt(0).toUpperCase()}
                </div>
                <Circle
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 ${room.online ? 'text-green-500 fill-green-500' : 'text-gray-300 fill-gray-300'
                        }`}
                />
            </div>
            <div className="flex-1 min-w-0 text-left">
                <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-gray-900 truncate">
                        {room.customerName}
                    </span>
                    {room.lastMessageTime && (
                        <span className="text-[10px] text-gray-400 whitespace-nowrap ml-2">
                            {formatTime(room.lastMessageTime)}
                        </span>
                    )}
                </div>
                <p className="text-sm text-gray-500 truncate mt-0.5">
                    {room.lastMessage || 'Connected'}
                </p>
            </div>
            {room.unreadCount > 0 && (
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#065273] text-white text-[10px] font-bold flex items-center justify-center">
                    {room.unreadCount}
                </span>
            )}
        </button>
    );
}

export default function AdminDashboard() {
    const navigate = useNavigate();
    const {
        activeRooms,
        selectedRoomId,
        selectRoom,
        messages,
        connected,
        botTyping,
        sendMessage,
    } = useAdminSocket();

    const [input, setInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const scrollRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, botTyping]);

    useEffect(() => {
        if (selectedRoomId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [selectedRoomId]);

    const handleSend = (e) => {
        e.preventDefault();
        if (!input.trim() || !selectedRoomId) return;
        sendMessage(input);
        setInput('');
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            handleSend(e);
        }
    };

    const selectedRoom = activeRooms.find((r) => r.roomId === selectedRoomId);
    const filteredRooms = activeRooms.filter(room => {
        const name = room.customerName;
        return name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            room.roomId?.toLowerCase().includes(searchQuery.toLowerCase());
    });

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        return 'Good evening';
    };

    return (
        <div className="flex h-screen bg-gray-50 overflow-hidden">
            <aside className="w-[380px] bg-white border-r border-gray-200 flex flex-col flex-shrink-0">

                <div className="py-4 px-6 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <img src={logo} alt="logo" className="h-8 w-auto" />
                            <div>
                                <h1 className="text-lg font-bold text-gray-900">Assistant</h1>
                                <p className="text-sm text-gray-500">GST & Accounting Support</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="py-4 px-6 border-b border-gray-200">
                    <div className={`flex items-center gap-2 text-sm font-medium ${connected ? 'text-green-600' : 'text-gray-400'
                        }`}>
                        <span className={`relative flex h-2.5 w-2.5 ${connected ? 'animate-pulse' : ''}`}>
                            <span className={`absolute inline-flex h-full w-full rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'
                                } opacity-75`}></span>
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${connected ? 'bg-green-500' : 'bg-gray-300'
                                }`}></span>
                        </span>
                        {connected ? 'Dashboard Connected' : 'Connecting Dashboard…'}
                    </div>
                </div>

                <div className="py-4 px-6 border-b border-gray-200">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search conversations..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#3b84a3] focus:border-transparent transition-all"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto py-4 px-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                            Active Chats
                            <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 text rounded-full text-[12px]">
                                {activeRooms.length}
                            </span>
                        </h2>
                        <button className="text-sm text-[#065273] hover:underline font-medium">
                            View all
                        </button>
                    </div>

                    {filteredRooms.length === 0 ? (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                                <MessageSquare className="w-6 h-6 text-gray-400" />
                            </div>
                            <p className="text-sm text-gray-500">No active support chats</p>
                            <p className="text-sm text-gray-400 mt-1">Customers will appear here when they start a chat</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredRooms.map((room) => (
                                <SidebarRoomItem
                                    key={room.roomId}
                                    room={room}
                                    selected={room.roomId === selectedRoomId}
                                    onClick={selectRoom}
                                />
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#04364A] via-[#06506B] to-[#022B3A] flex items-center justify-center text-white font-semibold text-sm">
                            A
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-base font-medium text-gray-900 truncate">Admin Agent</p>
                            <p className="text-sm text-gray-500">Online • Ready to assist</p>
                        </div>
                        <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                            <LogOut className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>
                </div>
            </aside>

            <main className="flex-1 flex flex-col bg-gray-50">
                {selectedRoomId ? (
                    <>
                        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between flex-shrink-0">
                            <div className="flex items-center gap-4">
                                <button className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors">
                                    <ChevronLeft className="w-5 h-5 text-gray-500" />
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#04364A] via-[#06506B] to-[#022B3A] flex items-center justify-center text-white font-semibold">
                                            {(selectedRoom?.customerName || `Customer #${selectedRoomId?.slice(-4)}`).charAt(0).toUpperCase()}
                                        </div>
                                        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${selectedRoom?.online ? 'bg-green-500' : 'bg-gray-300'
                                            }`} />
                                    </div>
                                    <div>
                                        <h2 className="font-semibold text-gray-900">
                                            {selectedRoom?.customerName}
                                        </h2>
                                        <div className="flex items-center gap-4">
                                            <span className="text-sm text-gray-500">
                                                Room ID : {selectedRoomId}
                                            </span>
                                            <div className="flex items-center gap-1">
                                                <span className="w-2 h-2 rounded-full bg-gray-300" />
                                                <span className={`text-base ${selectedRoom?.online ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {selectedRoom?.online ? 'Online' : 'Offline'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                                    <Users className="w-4 h-4 text-gray-500" />
                                </button>
                                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                                    <Settings className="w-4 h-4 text-gray-500" />
                                </button>
                            </div>
                        </header>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto px-6 py-4" ref={scrollRef}>
                            {messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center">
                                    <div className="w-20 h-20 rounded-full bg-gray-50 flex items-center justify-center mb-4">
                                        <MessageSquare className="w-10 h-10 text-[#065273]" />
                                    </div>
                                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                        Conversation started
                                    </h3>
                                    <p className="text-sm text-gray-500 max-w-sm">
                                        Send a message to the customer to begin the support session
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="text-center mb-6">
                                        <span className="inline-block px-3 py-1 bg-gray-100 text-gray-500 text-sm rounded-full">
                                            {formatDate(messages[0]?.createdAt || messages[0]?.timestamp || messages[0]?.metadata?.timestamp)}
                                        </span>
                                    </div>
                                    {messages.map((msg) => (
                                        <MessageBubble key={msg.id} msg={msg} />
                                    ))}
                                    {botTyping && (
                                        <div className="flex gap-2.5 mb-4 justify-start">
                                            <Avatar sender="bot" size="sm" />
                                            <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-gray-200">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                                                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <form
                            onSubmit={handleSend}
                            className="bg-white border-t border-gray-200 p-4 flex-shrink-0"
                        >
                            <div className="flex items-center gap-3">
                                <div className="flex-1">
                                    <textarea
                                        ref={inputRef}
                                        rows={1}
                                        placeholder={`Reply to ${selectedRoom?.customerName}...`}
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyPress}
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-1 focus:ring-[#3b84a3] focus:border-transparent transition-all text-sm min-h-[44px] max-h-[120px] leading-5"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={!input.trim()}
                                    className="h-[44px] w-[44px] flex items-center justify-center bg-gradient-to-br from-[#04364A] via-[#06506B] to-[#022B3A] hover:bg-[#022938] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex-shrink-0"
                                >
                                    <Send className="w-5 h-5" />
                                </button>
                            </div>
                        </form>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center px-6">
                        <div className="text-center max-w-md">
                            <div className="w-22 h-22 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-6">
                                <MessageSquare className="w-10 h-10 text-[#216e8f]" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">
                                {getGreeting()}! 👋
                            </h2>
                            <p className="text-gray-500 mb-6">
                                Select a customer conversation from the sidebar to start live chatting and providing support.
                            </p>
                            <div className="flex items-center justify-center gap-6 text-sm">
                                <div className="flex items-center gap-2 text-gray-600">
                                    <span className="w-2 h-2 rounded-full bg-green-500" />
                                    <span>{activeRooms.length} active chats</span>
                                </div>
                                <div className="flex items-center gap-2 text-gray-600">
                                    <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
                                    <span>{connected ? 'Connected' : 'Disconnected'}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}