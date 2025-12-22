import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, MessageSquare, X, Move, Loader } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';

const CHATBOT_API_URL = 'http://localhost:5000/chat';

const Chatbot = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([
        { role: 'ai', text: 'Hello! I am your Talent Ops AI assistant. How can I help you today?' }
    ]);
    const [isLoading, setIsLoading] = useState(false);
    const [userProfile, setUserProfile] = useState(null);
    const messagesEndRef = useRef(null);

    // Dragging state
    const [position, setPosition] = useState(() => {
        const saved = localStorage.getItem('chatbot-position');
        return saved ? JSON.parse(saved) : { bottom: 30, right: 30 };
    });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const containerRef = useRef(null);

    // Fetch user profile on mount
    useEffect(() => {
        const fetchUserProfile = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', user.id)
                        .single();
                    
                    setUserProfile(profile);
                }
            } catch (error) {
                console.error('Error fetching user profile:', error);
            }
        };
        
        fetchUserProfile();
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    // Save position to localStorage
    useEffect(() => {
        localStorage.setItem('chatbot-position', JSON.stringify(position));
    }, [position]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        
        const userMessage = input.trim();
        setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
        setInput('');
        setIsLoading(true);

        try {
            // Check if backend is running
            const healthCheck = await fetch('http://localhost:5000/health').catch(() => null);
            
            if (!healthCheck || !healthCheck.ok) {
                setMessages(prev => [...prev, { 
                    role: 'ai', 
                    text: '⚠️ Chatbot backend is not running. Please start the backend server first.\n\nTo start:\n1. Open terminal in chatbot-backend folder\n2. Run: python main.py\n3. Wait for "Running on http://localhost:5000"' 
                }]);
                setIsLoading(false);
                return;
            }

            // Send message to backend
            const response = await fetch(CHATBOT_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: userProfile?.id || 'guest',
                    role: userProfile?.role || 'employee',
                    team_id: userProfile?.team_id || null,
                    message: userMessage
                })
            });

            const data = await response.json();
            
            // Handle different response types
            if (data.reply === 'forbidden') {
                setMessages(prev => [...prev, { 
                    role: 'ai', 
                    text: `🚫 ${data.message || data.reason || 'You do not have permission to perform this action.'}` 
                }]);
            } else if (data.message) {
                setMessages(prev => [...prev, { 
                    role: 'ai', 
                    text: data.message 
                }]);
            } else if (Array.isArray(data.reply) && data.reply.length > 0) {
                // Format structured data response
                const formattedData = JSON.stringify(data.reply, null, 2);
                setMessages(prev => [...prev, { 
                    role: 'ai', 
                    text: `Here's what I found:\n\`\`\`json\n${formattedData}\n\`\`\`` 
                }]);
            } else {
                setMessages(prev => [...prev, { 
                    role: 'ai', 
                    text: 'I processed your request successfully!' 
                }]);
            }
        } catch (error) {
            console.error('Chatbot error:', error);
            setMessages(prev => [...prev, { 
                role: 'ai', 
                text: `❌ Error: ${error.message}\n\nMake sure the chatbot backend is running on http://localhost:5000` 
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    // Drag handlers
    const handleMouseDown = (e) => {
        const isButton = e.target.closest('button');
        const isDragHandle = e.target.closest('.drag-handle');
        const isFAB = e.target.closest('.chatbot-fab');

        if (isButton && !isDragHandle && !isFAB) return;

        e.preventDefault();
        setIsDragging(true);
        setDragStart({
            x: e.clientX,
            y: e.clientY,
            startBottom: position.bottom,
            startRight: position.right
        });
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDragging) return;

            const deltaX = dragStart.x - e.clientX;
            const deltaY = dragStart.y - e.clientY;

            const newRight = dragStart.startRight + deltaX;
            const newBottom = dragStart.startBottom + deltaY;

            const maxRight = window.innerWidth - 100;
            const maxBottom = window.innerHeight - 100;

            setPosition({
                right: Math.max(10, Math.min(maxRight, newRight)),
                bottom: Math.max(10, Math.min(maxBottom, newBottom))
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, dragStart]);

    return (
        <div
            ref={containerRef}
            style={{
                position: 'fixed',
                bottom: `${position.bottom}px`,
                right: `${position.right}px`,
                zIndex: 2000,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                cursor: isDragging ? 'grabbing' : 'default',
                userSelect: isDragging ? 'none' : 'auto'
            }}
        >
            {/* Chat Window */}
            {isOpen && (
                <div style={{
                    width: '380px',
                    height: '550px',
                    backgroundColor: 'var(--surface)',
                    borderRadius: '16px',
                    boxShadow: 'var(--shadow-lg)',
                    marginBottom: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    animation: 'slideIn 0.3s ease-out'
                }}>
                    {/* Header */}
                    <div
                        className="drag-handle"
                        onMouseDown={handleMouseDown}
                        style={{
                            padding: '16px',
                            background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            userSelect: 'none'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Move size={16} style={{ opacity: 0.7 }} />
                            <Bot size={20} />
                            <div>
                                <div style={{ fontWeight: 600 }}>AI Assistant</div>
                                {userProfile && (
                                    <div style={{ fontSize: '0.75rem', opacity: 0.9 }}>
                                        {userProfile.full_name} • {userProfile.role}
                                    </div>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            style={{
                                color: 'white',
                                opacity: 0.8,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div style={{ 
                        flex: 1, 
                        padding: '16px', 
                        overflowY: 'auto', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '16px', 
                        backgroundColor: 'var(--background)' 
                    }}>
                        {messages.map((msg, i) => (
                            <div key={i} style={{ 
                                display: 'flex', 
                                gap: '8px', 
                                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' 
                            }}>
                                <div style={{
                                    width: '32px', 
                                    height: '32px', 
                                    borderRadius: '50%',
                                    background: msg.role === 'ai' 
                                        ? 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)' 
                                        : 'var(--accent)',
                                    color: 'white', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center', 
                                    flexShrink: 0,
                                    boxShadow: 'var(--shadow-sm)'
                                }}>
                                    {msg.role === 'ai' ? <Bot size={18} /> : <User size={18} />}
                                </div>
                                <div style={{
                                    maxWidth: '75%',
                                    padding: '12px 16px',
                                    borderRadius: '12px',
                                    backgroundColor: msg.role === 'ai' ? 'var(--surface)' : 'var(--accent)',
                                    color: msg.role === 'ai' ? 'var(--text-main)' : 'white',
                                    boxShadow: 'var(--shadow-sm)',
                                    borderTopLeftRadius: msg.role === 'ai' ? '2px' : '12px',
                                    borderTopRightRadius: msg.role === 'user' ? '2px' : '12px',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word'
                                }}>
                                    <p style={{ fontSize: '0.9rem', lineHeight: '1.5', margin: 0 }}>
                                        {msg.text}
                                    </p>
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <div style={{
                                    width: '32px', 
                                    height: '32px', 
                                    borderRadius: '50%',
                                    background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                                    color: 'white', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center'
                                }}>
                                    <Bot size={18} />
                                </div>
                                <div style={{
                                    padding: '12px 16px',
                                    borderRadius: '12px',
                                    backgroundColor: 'var(--surface)',
                                    boxShadow: 'var(--shadow-sm)',
                                    display: 'flex',
                                    gap: '8px',
                                    alignItems: 'center'
                                }}>
                                    <Loader size={16} className="spin" />
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        Thinking...
                                    </span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div style={{ 
                        padding: '12px', 
                        borderTop: '1px solid var(--border)', 
                        backgroundColor: 'var(--surface)', 
                        display: 'flex', 
                        gap: '8px' 
                    }}>
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                            placeholder="Ask me anything..."
                            disabled={isLoading}
                            style={{
                                flex: 1,
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                outline: 'none',
                                fontSize: '0.9rem',
                                backgroundColor: 'var(--background)',
                                color: 'var(--text-main)',
                                opacity: isLoading ? 0.6 : 1
                            }}
                        />
                        <button
                            onClick={handleSend}
                            disabled={isLoading || !input.trim()}
                            style={{
                                width: '44px', 
                                height: '44px', 
                                borderRadius: '8px',
                                background: isLoading || !input.trim() 
                                    ? 'var(--border)' 
                                    : 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
                                color: 'white',
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                border: 'none',
                                cursor: isLoading || !input.trim() ? 'not-allowed' : 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: isLoading || !input.trim() ? 'none' : 'var(--shadow-sm)'
                            }}
                        >
                            {isLoading ? <Loader size={18} className="spin" /> : <Send size={18} />}
                        </button>
                    </div>
                </div>
            )}

            {/* Toggle Button (FAB) */}
            <button
                className="chatbot-fab"
                onMouseDown={handleMouseDown}
                onClick={(e) => {
                    if (!isDragging) {
                        setIsOpen(!isOpen);
                    }
                }}
                style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--accent) 0%, var(--primary) 100%)',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'var(--shadow-lg)',
                    transition: isDragging ? 'none' : 'transform 0.2s ease, box-shadow 0.2s ease',
                    cursor: isDragging ? 'grabbing' : 'grab',
                    border: 'none',
                    userSelect: 'none'
                }}
                onMouseEnter={(e) => {
                    if (!isDragging) {
                        e.currentTarget.style.transform = 'scale(1.1)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-xl)';
                    }
                }}
                onMouseLeave={(e) => {
                    if (!isDragging) {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                    }
                }}
            >
                {isOpen ? <X size={28} /> : <MessageSquare size={28} />}
            </button>

            <style>
                {`
                    @keyframes slideIn {
                        from { opacity: 0; transform: translateY(20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    .drag-handle:active {
                        cursor: grabbing !important;
                    }
                    .spin {
                        animation: spin 1s linear infinite;
                    }
                `}
            </style>
        </div>
    );
};

export default Chatbot;
