import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';

const MessageContext = createContext();

export const useMessages = () => {
    return useContext(MessageContext);
};

export const MessageProvider = ({ children }) => {
    const [unreadCount, setUnreadCount] = useState(0);
    const [conversations, setConversations] = useState([]);
    const [lastReadTimes, setLastReadTimes] = useState({});
    const [userId, setUserId] = useState(null);

    // Initialize from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem('message_read_times');
        if (stored) {
            try {
                setLastReadTimes(JSON.parse(stored));
            } catch (e) {
                console.error('Failed to parse read times', e);
            }
        }

        // Get current user
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (user) setUserId(user.id);
        });

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session?.user) {
                setUserId(session.user.id);
            } else if (event === 'SIGNED_OUT') {
                setUserId(null);
                setConversations([]);
                setUnreadCount(0);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    // Persist to localStorage whenever it changes
    useEffect(() => {
        if (Object.keys(lastReadTimes).length > 0) {
            localStorage.setItem('message_read_times', JSON.stringify(lastReadTimes));
        }
    }, [lastReadTimes]);

    // Fetch conversations and calculate unread count
    useEffect(() => {
        if (!userId) return;

        const fetchConversations = async () => {
            try {
                // 1. Get user's conversation memberships
                const { data: memberships } = await supabase
                    .from('conversation_members')
                    .select('conversation_id')
                    .eq('user_id', userId);

                if (!memberships?.length) return;

                const conversationIds = memberships.map(m => m.conversation_id);

                // 2. Get conversations with their indexes (last message info)
                const { data: convs, error } = await supabase
                    .from('conversations')
                    .select(`
                        id, 
                        type, 
                        name,
                        conversation_indexes (
                            last_message,
                            last_message_at
                        )
                    `)
                    .in('id', conversationIds);

                if (error) throw error;

                setConversations(convs || []);
            } catch (err) {
                console.error('Error fetching conversations for notifications:', err);
            }
        };

        fetchConversations();

        // Poll every 30 seconds for new messages (simple real-time alternative)
        const interval = setInterval(fetchConversations, 30000);

        // Subscription for real-time updates on 'messages' table could be added here
        // but might be too heavy. Polling + local optimistic updates is safer for now.

        return () => clearInterval(interval);
    }, [userId]);

    // Calculate unread count
    useEffect(() => {
        if (!conversations.length) {
            setUnreadCount(0);
            return;
        }

        let count = 0;
        conversations.forEach(conv => {
            const index = conv.conversation_indexes?.[0];
            if (!index?.last_message_at) return;

            const lastMsgTime = new Date(index.last_message_at).getTime();
            const lastReadTime = lastReadTimes[conv.id] || 0;

            if (lastMsgTime > lastReadTime) {
                count++;
            }
        });

        setUnreadCount(count);
    }, [conversations, lastReadTimes]);

    const markAsRead = (conversationId) => {
        const now = Date.now();
        setLastReadTimes(prev => ({
            ...prev,
            [conversationId]: now
        }));

        // Optimistically update count immediately
        // (useEffect will run eventually but this feels snappier)
    };

    const value = {
        unreadCount,
        conversations,
        markAsRead,
        lastReadTimes
    };

    return (
        <MessageContext.Provider value={value}>
            {children}
        </MessageContext.Provider>
    );
};
