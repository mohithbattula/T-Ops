import React from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import Chatbot from '../UI/Chatbot';
import LoginSummaryModal from '../../../shared/LoginSummaryModal';
import AnnouncementPopup from '../../../shared/AnnouncementPopup';
import { supabase } from '../../../../lib/supabaseClient';
import { MessageProvider } from '../../../shared/context/MessageContext';

const Layout = ({ children }) => {
    const [isCollapsed, setIsCollapsed] = React.useState(false);
    const [showLoginSummary, setShowLoginSummary] = React.useState(false);
    const [showAnnouncements, setShowAnnouncements] = React.useState(false);
    const [userId, setUserId] = React.useState(null);
    const location = useLocation();

    React.useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                setUserId(user.id);
                // Start sequence: Announcements first
                setTimeout(() => setShowAnnouncements(true), 1000);
            }
        };
        fetchUser();
    }, []);

    const handleAnnouncementsClose = () => {
        setShowAnnouncements(false);
        // Step 2: Show Notifications after announcements are closed
        setShowLoginSummary(true);
    };

    // Removed auto-collapse timer

    return (

        <MessageProvider>
            <div style={{ display: 'flex', minHeight: '100vh' }}>
                <Sidebar
                    isCollapsed={isCollapsed}
                    toggleSidebar={() => setIsCollapsed(!isCollapsed)}
                    onMouseEnter={() => setIsCollapsed(false)}
                    onMouseLeave={() => setIsCollapsed(true)}
                />
                <div style={{
                    marginLeft: isCollapsed ? '80px' : '260px',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'margin-left 0.3s ease'
                }}>
                    <Header />
                    <main style={{ flex: 1, padding: 'var(--spacing-xl)', backgroundColor: 'var(--background)' }}>
                        {children}
                    </main>
                    <Chatbot />
                </div>
                <AnnouncementPopup
                    isOpen={showAnnouncements}
                    onClose={handleAnnouncementsClose}
                    userId={userId}
                />
                <LoginSummaryModal
                    isOpen={showLoginSummary}
                    onClose={() => setShowLoginSummary(false)}
                    userId={userId}
                />
            </div>
        </MessageProvider>
    );
};

export default Layout;
