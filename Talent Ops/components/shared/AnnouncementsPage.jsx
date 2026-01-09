import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Calendar, MapPin, Clock, Users, User, X, Plus, CheckCircle2, Archive, AlertCircle, Trash2 } from 'lucide-react';

const AnnouncementsPage = ({ userRole, userId, orgId }) => {
    const [announcements, setAnnouncements] = useState([]);
    const [filteredAnnouncements, setFilteredAnnouncements] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [eventParticipants, setEventParticipants] = useState({ loading: false, names: [], type: '' });

    // Status Tab State
    const [activeTab, setActiveTab] = useState('active'); // 'active', 'upcoming', 'completed'

    // Add Event State
    const [showAddModal, setShowAddModal] = useState(false);
    const [eventScope, setEventScope] = useState('all'); // 'all', 'team', 'employee'
    const [selectedTeams, setSelectedTeams] = useState([]);
    const [selectedEmployees, setSelectedEmployees] = useState([]);
    const [allTeams, setAllTeams] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [userTeamId, setUserTeamId] = useState(null);
    const [senderName, setSenderName] = useState('');

    // Form Data
    const [newEvent, setNewEvent] = useState({
        title: '',
        date: '',
        time: '',
        location: '',
        message: ''
    });

    // View Mode State
    const [viewMode, setViewMode] = useState('announcements'); // 'events' | 'announcements'
    const [createType, setCreateType] = useState('event'); // 'event' | 'announcement'

    const isAuthorized = ['executive', 'manager', 'team_lead', 'employee'].includes(userRole);
    const canManageEvents = ['executive', 'manager'].includes(userRole); // Only them can edit status
    const canMarkCompleted = isAuthorized; // All roles can mark as completed

    useEffect(() => {
        fetchData();
    }, [userRole, userId, orgId, showAddModal]);

    const fetchData = async () => {
        try {
            setLoading(true);

            // 1. Fetch User Profile to get team_id
            const { data: profile } = await supabase
                .from('profiles')
                .select('team_id, full_name')
                .eq('id', userId)
                .eq('org_id', orgId)
                .single();
            if (profile) {
                setUserTeamId(profile.team_id);
                setSenderName(profile.full_name || 'System Announcement');
            }

            // 2. Fetch Announcements
            const { data, error } = await supabase
                .from('announcements')
                .select('*')
                .eq('org_id', orgId)
                .order('event_date', { ascending: true });

            if (error) throw error;

            if (data) {
                // Auto-update statuses based on date
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const updates = data.filter(event => {
                    const eventDate = new Date(event.event_date);
                    eventDate.setHours(0, 0, 0, 0);

                    // Logic: Future -> Active -> Completed
                    // We only upgrade status, never downgrade (to respect manual completion or logic)
                    // If DB is 'future' and Date is Today -> Update to 'active'
                    // If DB is 'future'/'active' and Date is Past -> Update to 'completed'

                    if (event.status === 'future') {
                        if (eventDate.getTime() === today.getTime()) return true; // targeted: active
                        if (eventDate < today) return true; // targeted: completed
                    }
                    if (event.status === 'active') {
                        if (eventDate < today) return true; // targeted: completed
                    }
                    return false;
                }).map(event => {
                    const eventDate = new Date(event.event_date);
                    eventDate.setHours(0, 0, 0, 0);
                    let newStatus = event.status;

                    if (eventDate.getTime() === today.getTime()) newStatus = 'active';
                    else if (eventDate < today) newStatus = 'completed';

                    return { id: event.id, status: newStatus };
                });

                if (updates.length > 0) {
                    // Perform updates in background
                    updates.forEach(async (update) => {
                        await supabase.from('announcements').update({ status: update.status }).eq('id', update.id).eq('org_id', orgId);
                    });

                    // Update local data immediately
                    data.forEach(d => {
                        const update = updates.find(u => u.id === d.id);
                        if (update) d.status = update.status;
                    });
                }

                const visibleEvents = data.filter(a => {
                    // All Logic - Visible to Everyone
                    if (a.event_for === 'all') return true;

                    // Executives and Managers see all
                    if (userRole === 'executive' || userRole === 'manager') return true;

                    let targetTeams = [];
                    let targetEmployees = [];
                    try {
                        targetTeams = typeof a.teams === 'string' ? JSON.parse(a.teams) : (a.teams || []);
                        targetEmployees = typeof a.employees === 'string' ? JSON.parse(a.employees) : (a.employees || []);
                    } catch (e) {
                        console.error("Error parsing targets", e);
                    }

                    if (a.event_for === 'team') {
                        return targetTeams.includes(userTeamId);
                    } else if (a.event_for === 'specific' || a.event_for === 'employee') {
                        return targetEmployees.includes(userId);
                    }
                    return false;
                });

                setAnnouncements(visibleEvents);
            }
        } catch (err) {
            console.error('Error loading announcements:', err);
        } finally {
            setLoading(false);
        }
    };

    // Filter Logic based on View Mode & Active Tab
    useEffect(() => {
        if (!announcements) return;

        const now = new Date();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let filtered = [];

        if (viewMode === 'announcements') {
            // ANNOUNCEMENTS MODE
            filtered = announcements.filter(item => {
                // Check if it's an announcement (location 'Broadcast' or specific marker)
                // We'll use location='Broadcast' or event_time='--:--' as convention for now
                if (item.event_for === 'all' && item.location === 'Broadcast') {
                    // It fits announcement profile
                } else if (item.location === 'Broadcast') {
                    // It fits
                } else {
                    // If user explicitly created as announcement, we store location 'Broadcast'
                    // If it's an old event, it likely has location.
                    // Filter STRICTLY by our convention: Location must be 'Broadcast' to be in this list.
                    // If user wants to see "All" events, they go to Events tab.
                    if (item.location !== 'Broadcast') return false;
                }

                // 24 Hour Expiration
                let createdTime = new Date(item.created_at || item.event_date); // Fallback if created_at needs to be fetched
                // If created_at is missing from select, we rely on event_date.
                // But for announcements, event_date is set to 'today' at creation.
                // So (now - event_date) should be small.

                // Better: Use `event_date` as the creation date for announcements.
                const eventDate = new Date(item.event_date);
                // Check if it's "today" or "yesterday"
                // Actually simply: Is it within 24h?
                // But `event_date` is just YYYY-MM-DD. It doesn't have time.
                // `event_time` has time.

                const dateTimeStr = `${item.event_date}T${item.event_time}`;
                const itemTime = new Date(dateTimeStr);

                if (isNaN(itemTime.getTime())) return false; // Invalid time

                const diffHours = (now - itemTime) / (1000 * 60 * 60);
                return diffHours <= 24 && diffHours >= 0; // Within last 24 hours
            });

            // Sort by newest
            filtered.sort((a, b) => {
                const dateA = new Date(`${a.event_date}T${a.event_time}`);
                const dateB = new Date(`${b.event_date}T${b.event_time}`);
                return dateB - dateA;
            });

        } else {
            // EVENTS MODE
            filtered = announcements.filter(event => {
                // Must NOT be an announcement (Location != Broadcast)
                if (event.location === 'Broadcast') return false;

                const eventDate = new Date(event.event_date);
                eventDate.setHours(0, 0, 0, 0);

                let effectiveStatus = event.status;
                if (!effectiveStatus || effectiveStatus === 'future') {
                    if (eventDate > now) effectiveStatus = 'future';
                    else if (eventDate.getTime() === today.getTime()) effectiveStatus = 'active';
                    else effectiveStatus = 'completed';
                }

                if (activeTab === 'upcoming') return effectiveStatus === 'future';
                if (activeTab === 'active') return effectiveStatus === 'active';
                if (activeTab === 'completed') return effectiveStatus === 'completed';
                return false;
            });

            filtered.sort((a, b) => {
                const dateA = new Date(`${a.event_date}T${a.event_time}`);
                const dateB = new Date(`${b.event_date}T${b.event_time}`);
                return activeTab === 'completed' ? dateB - dateA : dateA - dateB;
            });
        }

        setFilteredAnnouncements(filtered);
    }, [announcements, activeTab, viewMode]);


    // Fetch Participants for Selected Event
    useEffect(() => {
        const fetchParticipants = async () => {
            if (!selectedEvent) return;

            setEventParticipants({ loading: true, names: [], type: selectedEvent.event_for });

            try {
                if (selectedEvent.event_for === 'all') {
                    setEventParticipants({ loading: false, names: ['All Employees'], type: 'all' });
                    return;
                }

                if (selectedEvent.event_for === 'team') {
                    let teamIds = [];
                    try {
                        teamIds = typeof selectedEvent.teams === 'string' ? JSON.parse(selectedEvent.teams) : (selectedEvent.teams || []);
                    } catch (e) { console.error("Error parsing teams", e); }

                    if (teamIds.length > 0) {
                        const { data: teams } = await supabase
                            .from('projects')
                            .select('name')
                            .in('id', teamIds)
                            .eq('org_id', orgId);

                        if (teams) {
                            setEventParticipants({
                                loading: false,
                                names: teams.map(t => t.name),
                                type: 'team'
                            });
                        }
                    } else {
                        setEventParticipants({ loading: false, names: [], type: 'team' });
                    }
                } else if (selectedEvent.event_for === 'employee' || selectedEvent.event_for === 'specific') {
                    let empIds = [];
                    try {
                        empIds = typeof selectedEvent.employees === 'string' ? JSON.parse(selectedEvent.employees) : (selectedEvent.employees || []);
                    } catch (e) { console.error("Error parsing employees", e); }

                    if (empIds.length > 0) {
                        const { data: profiles } = await supabase
                            .from('profiles')
                            .select('full_name')
                            .in('id', empIds)
                            .eq('org_id', orgId);

                        if (profiles) {
                            setEventParticipants({
                                loading: false,
                                names: profiles.map(p => p.full_name),
                                type: 'employee'
                            });
                        }
                    } else {
                        setEventParticipants({ loading: false, names: [], type: 'employee' });
                    }
                }

            } catch (err) {
                console.error("Error fetching participants", err);
                setEventParticipants({ loading: false, names: ['Error loading participants'], type: 'error' });
            }
        };

        fetchParticipants();
    }, [selectedEvent]);


    // Fetch Options (Teams/Employees) for Add Modal
    useEffect(() => {
        const fetchOptions = async () => {
            if (!isAuthorized) return;
            setLoadingOptions(true);
            try {
                // Fetch Projects (instead of teams)
                const { data: teams } = await supabase.from('projects').select('id, name').eq('org_id', orgId);
                if (teams) setAllTeams(teams.map(t => ({ id: t.id, name: t.name })));

                // Fetch Employees
                const { data: emps } = await supabase.from('profiles').select('id, full_name, team_id').eq('org_id', orgId);
                if (emps) setAllEmployees(emps.map(e => ({ id: e.id, name: e.full_name, teamId: e.team_id })));

            } catch (e) {
                console.error("Error fetching options", e);
            } finally {
                setLoadingOptions(false);
            }
        };

        if (showAddModal) {
            fetchOptions();
        }
    }, [showAddModal, isAuthorized]);


    const handleAddEvent = async (e) => {
        e.preventDefault();
        try {
            // Determine initial status based on date
            const today = new Date().toISOString().split('T')[0];
            const nowTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

            let finalDate = newEvent.date;
            let finalTime = newEvent.time;
            let finalLocation = newEvent.location;

            // Apply defaults for Announcement
            if (createType === 'announcement') {
                finalDate = today;
                finalTime = nowTime;
                finalLocation = 'Broadcast'; // Convention marker
            }

            let initialStatus = 'future';
            if (finalDate === today) initialStatus = 'active';
            else if (finalDate < today) initialStatus = 'completed';

            const payload = {
                title: newEvent.title,
                event_date: finalDate,
                event_time: finalTime,
                location: finalLocation,
                message: newEvent.message,
                event_for: eventScope === 'my_team' ? 'employee' : eventScope,
                teams: eventScope === 'team' ? selectedTeams : [],
                employees: (eventScope === 'employee' || eventScope === 'my_team') ? selectedEmployees : [],
                status: initialStatus,
                org_id: orgId
            };

            let response = await supabase.from('announcements').insert(payload);

            if (response.error && (
                response.error.message.includes('column "status" of relation "announcements" does not exist') ||
                response.error.message.includes("Could not find the 'status' column")
            )) {
                // Retry without status
                // We'll remove status field
                delete payload.status;
                response = await supabase.from('announcements').insert(payload);
                console.warn("Status column missing, proceeding without it.");
            }

            if (response.error) throw response.error;

            alert(createType === 'announcement' ? 'Announcement posted!' : 'Event added successfully!');
            setShowAddModal(false);
            setNewEvent({ title: '', date: '', time: '', location: '', message: '' });
            setEventScope('all');
            setSelectedTeams([]);
            setSelectedEmployees([]);
            fetchData(); // Refresh list

            // --- Send Notifications ---
            if (senderName) {
                let recipientIds = [];

                if (eventScope === 'all') {
                    // Send to everyone (except self, optional, but usually good to notify self too or filter out)
                    recipientIds = allEmployees.map(e => e.id);
                } else if (eventScope === 'team') {
                    // Send to employees in selected teams
                    recipientIds = allEmployees
                        .filter(e => selectedTeams.includes(e.teamId))
                        .map(e => e.id);
                } else if (eventScope === 'employee' || eventScope === 'my_team') {
                    // Send to specific employees
                    recipientIds = selectedEmployees; // these are IDs
                }

                // Filter out the sender if you don't want to notify yourself (optional, keeping it commented out for testing so you see the notification)
                // recipientIds = recipientIds.filter(id => id !== userId);

                console.log('Sending notifications to:', recipientIds);

                if (recipientIds.length > 0) {
                    const notificationsData = recipientIds.map(receiverId => ({
                        sender_id: userId,
                        sender_name: senderName,
                        receiver_id: receiverId,
                        message: `New Announcement: ${newEvent.title}`,
                        type: 'announcement',
                        is_read: false,
                        created_at: new Date().toISOString(),
                        org_id: orgId
                    }));

                    const { error: notifError } = await supabase
                        .from('notifications')
                        .insert(notificationsData);

                    if (notifError) {
                        console.error("Error creating notifications:", notifError);
                    }
                }
            }
            // --------------------------

        } catch (err) {
            console.error("Error adding event:", err);
            alert("Failed to add event: " + err.message);
        }
    };

    const handleUpdateStatus = async (e, eventId, newStatus) => {
        e.stopPropagation();
        if (!confirm(`Are you sure you want to mark this event as ${newStatus}?`)) return;

        try {
            const { error } = await supabase
                .from('announcements')
                .update({ status: newStatus })
                .eq('id', eventId)
                .eq('org_id', orgId);

            if (error) {
                // Graceful fallback if column missing
                if (error.message.includes('column "status" of relation "announcements" does not exist') ||
                    error.message.includes("Could not find the 'status' column")) {
                    alert("The 'status' column does not exist in your database or schema cache needs refresh. Please run the migration script provided.");
                    return;
                }
                throw error;
            }

            // Update local state immediately for better UX
            setAnnouncements(prev => prev.map(ev =>
                ev.id === eventId ? { ...ev, status: newStatus } : ev
            ));

            if (selectedEvent && selectedEvent.id === eventId) {
                setSelectedEvent(prev => ({ ...prev, status: newStatus }));
            }

            // Close modal and switch to completed tab when marking as completed
            if (newStatus === 'completed') {
                setSelectedEvent(null);
                setActiveTab('completed');
            }

        } catch (err) {
            console.error("Error updating status:", err);
            alert("Failed to update status. Please try again.");
        }
    };

    const handleDeleteEvent = async (e, eventId) => {
        if (e) e.stopPropagation();
        if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) return;

        try {
            const { error } = await supabase
                .from('announcements')
                .delete()
                .eq('id', eventId)
                .eq('org_id', orgId);

            if (error) throw error;

            // Update local state
            setAnnouncements(prev => prev.filter(ev => ev.id !== eventId));

            // If the deleted event was open in modal, close it
            if (selectedEvent && selectedEvent.id === eventId) {
                setSelectedEvent(null);
            }

            alert('Event deleted successfully');
        } catch (err) {
            console.error("Error deleting event:", err);
            alert("Failed to delete event: " + err.message);
        }
    };

    if (loading) return <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading announcements...</div>;

    return (
        <div style={{ position: 'relative' }}>
            {/* Header / Actions Area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '32px' }}>
                <div>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: '500', marginBottom: '4px' }}>
                        Dashboard / Announcements
                    </p>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1e293b', lineHeight: 1.2 }}>
                        Announcements & Events
                    </h1>
                </div>

                {isAuthorized && (
                    <button
                        onClick={() => {
                            setCreateType(viewMode === 'announcements' ? 'announcement' : 'event');
                            setShowAddModal(true);
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            backgroundColor: '#0f172a',
                            color: 'white',
                            padding: '10px 16px',
                            borderRadius: '10px',
                            fontWeight: 600,
                            border: 'none',
                            cursor: 'pointer',
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                            transition: 'background-color 0.2s',
                            height: 'fit-content'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1e293b'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#0f172a'}
                    >
                        <Plus size={18} />
                        {viewMode === 'announcements' ? 'Post Announcement' : 'Add Event'}
                    </button>
                )}
            </div>

            {/* View Mode Toggle */}
            <div style={{ display: 'flex', gap: '4px', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '12px', width: 'fit-content', marginBottom: '24px' }}>
                <button
                    onClick={() => setViewMode('events')}
                    style={{
                        padding: '8px 24px',
                        borderRadius: '10px',
                        border: 'none',
                        backgroundColor: viewMode === 'events' ? 'white' : 'transparent',
                        color: viewMode === 'events' ? '#0f172a' : '#64748b',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: viewMode === 'events' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                        transition: 'all 0.2s'
                    }}
                >
                    Events / Calendar
                </button>
                <button
                    onClick={() => setViewMode('announcements')}
                    style={{
                        padding: '8px 24px',
                        borderRadius: '10px',
                        border: 'none',
                        backgroundColor: viewMode === 'announcements' ? 'white' : 'transparent',
                        color: viewMode === 'announcements' ? '#0f172a' : '#64748b',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: viewMode === 'announcements' ? '0 2px 4px rgba(0,0,0,0.05)' : 'none',
                        transition: 'all 0.2s'
                    }}
                >
                    Announcements
                </button>
            </div>

            {/* Tabs (Only visible for Events) */}
            {viewMode === 'events' && (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid #e2e8f0', paddingBottom: '0' }}>
                    {[
                        { id: 'active', label: 'Active Now', icon: CheckCircle2 },
                        { id: 'upcoming', label: 'Future', icon: Calendar },
                        { id: 'completed', label: 'Completed', icon: Archive }
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '12px 24px',
                                border: 'none',
                                borderBottom: activeTab === tab.id ? '2px solid #3b82f6' : '2px solid transparent',
                                backgroundColor: 'transparent',
                                color: activeTab === tab.id ? '#3b82f6' : '#64748b',
                                fontWeight: activeTab === tab.id ? 700 : 500,
                                cursor: 'pointer',
                                fontSize: '0.95rem',
                                transition: 'all 0.2s'
                            }}
                        >
                            <tab.icon size={18} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '24px' }}>
                {filteredAnnouncements.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', padding: '60px', textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: '16px', color: '#64748b', border: '2px dashed #e2e8f0' }}>
                        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
                            <AlertCircle size={48} color="#cbd5e1" />
                        </div>
                        <p style={{ fontSize: '1.2rem', fontWeight: 600, color: '#475569' }}>No {activeTab} announcements</p>
                        <p style={{ fontSize: '0.95rem' }}>
                            {activeTab === 'active' ? 'No events happening today.' :
                                activeTab === 'upcoming' ? 'No upcoming events scheduled.' : 'No completed events found.'}
                        </p>
                    </div>
                ) : (
                    filteredAnnouncements.map(event => (
                        <div
                            key={event.id}
                            onClick={() => setSelectedEvent(event)}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '16px',
                                padding: '24px',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
                                border: '1px solid #f1f5f9',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '16px',
                                transition: 'all 0.2s',
                                cursor: 'pointer',
                                position: 'relative'
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)';
                            }}
                        >
                            {/* Status Badge & Delete */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b', lineHeight: 1.4, wordBreak: 'break-word', flex: 1, paddingRight: '8px' }}>{event.title}</h3>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <span style={{
                                        padding: '4px 10px',
                                        borderRadius: '20px',
                                        fontSize: '0.7rem',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        backgroundColor: viewMode === 'announcements'
                                            ? '#f3e8ff'
                                            : activeTab === 'active' ? '#dcfce7' : activeTab === 'upcoming' ? '#e0f2fe' : '#f1f5f9',
                                        color: viewMode === 'announcements'
                                            ? '#7e22ce'
                                            : activeTab === 'active' ? '#166534' : activeTab === 'upcoming' ? '#0369a1' : '#64748b',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {viewMode === 'announcements' ? 'Broadcast' : activeTab === 'active' ? 'Active' : activeTab === 'upcoming' ? 'Future' : 'Completed'}
                                    </span>
                                    {canManageEvents && (
                                        <button
                                            onClick={(e) => handleDeleteEvent(e, event.id)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                cursor: 'pointer',
                                                color: '#94a3b8',
                                                padding: '4px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: '50%',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = '#fee2e2'; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                                            title="Delete"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '0.9rem' }}>
                                    <Calendar size={16} color="#3b82f6" />
                                    <span style={{ fontWeight: 500, color: '#334155' }}>
                                        {new Date(event.event_date).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' })}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '0.9rem' }}>
                                    <Clock size={16} color="#f59e0b" />
                                    <span>{event.event_time}</span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b', fontSize: '0.9rem' }}>
                                    <MapPin size={16} color="#ef4444" />
                                    <span>{event.location}</span>
                                </div>

                                {/* Scope/Audience Indicator */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid #f8fafc', color: '#94a3b8', fontSize: '0.8rem' }}>
                                    {event.event_for === 'all' ? <Users size={14} /> : (event.event_for === 'team' ? <Users size={14} /> : <User size={14} />)}
                                    <span>
                                        {event.event_for === 'all'
                                            ? 'Visible to everyone'
                                            : (event.event_for === 'team'
                                                ? 'Visible to selected teams'
                                                : 'Visible to selected employees')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Event Details Modal */}
            {selectedEvent && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000,
                    animation: 'fadeIn 0.2s ease-out'
                }} onClick={() => setSelectedEvent(null)}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            backgroundColor: 'white',
                            borderRadius: '24px',
                            width: '500px',
                            maxWidth: '90%',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                            position: 'relative',
                            overflow: 'hidden',
                            animation: 'slideUp 0.3s ease-out',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        {/* Modal Header with Status Color Band */}
                        <div style={{
                            height: '16px',
                            background: viewMode === 'announcements'
                                ? '#a855f7'
                                : activeTab === 'active' ? '#22c55e' : activeTab === 'upcoming' ? '#3b82f6' : '#94a3b8',
                            width: '100%',
                            flexShrink: 0
                        }}></div>

                        <div style={{ padding: '32px', overflowY: 'auto' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
                                <h2 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#1e293b', lineHeight: 1.2 }}>{selectedEvent.title}</h2>
                                <button
                                    onClick={() => setSelectedEvent(null)}
                                    style={{
                                        background: '#f1f5f9', border: 'none', borderRadius: '50%',
                                        width: '36px', height: '36px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', color: '#64748b', flexShrink: 0, marginLeft: '16px'
                                    }}
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Date and Time Block */}
                                <div style={{ display: 'flex', gap: '24px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#334155', fontWeight: 600 }}>
                                            <Calendar size={18} color="#3b82f6" />
                                            {new Date(selectedEvent.event_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#334155', fontWeight: 600 }}>
                                            <Clock size={18} color="#f59e0b" />
                                            {selectedEvent.event_time}
                                        </div>
                                    </div>
                                </div>

                                {/* Location */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Location</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#334155', fontWeight: 600 }}>
                                        <MapPin size={18} color="#ef4444" />
                                        {selectedEvent.location}
                                    </div>
                                </div>

                                {/* Audience & Participants */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Audience</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#334155', fontWeight: 500 }}>
                                        {selectedEvent.event_for === 'all' ? <Users size={18} color="#64748b" /> : <User size={18} color="#64748b" />}
                                        {selectedEvent.event_for === 'all'
                                            ? 'Visible to everyone'
                                            : (selectedEvent.event_for === 'team' ? 'Visible to specific teams' : 'Visible to specific employees')}
                                    </div>

                                    {/* Members List */}
                                    {eventParticipants.loading ? (
                                        <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '4px' }}>Loading participants...</p>
                                    ) : (
                                        eventParticipants.names.length > 0 && selectedEvent.event_for !== 'all' && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                                                {eventParticipants.names.map((name, idx) => (
                                                    <span key={idx} style={{
                                                        fontSize: '0.75rem',
                                                        backgroundColor: '#f1f5f9',
                                                        color: '#475569',
                                                        padding: '2px 8px',
                                                        borderRadius: '4px',
                                                        fontWeight: 500
                                                    }}>
                                                        {name}
                                                    </span>
                                                ))}
                                            </div>
                                        )
                                    )}
                                </div>

                                {/* Description / Message */}
                                {selectedEvent.message && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Details</span>
                                        <p style={{ color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                            {selectedEvent.message}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Actions Footer */}
                            <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '24px', borderTop: '1px solid #f1f5f9' }}>
                                {/* Management Actions for Authorized Users */}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    {canManageEvents && (
                                        <button
                                            onClick={(e) => handleDeleteEvent(e, selectedEvent.id)}
                                            style={{
                                                padding: '8px 16px', borderRadius: '8px', border: '1px solid #fee2e2',
                                                backgroundColor: '#fef2f2', color: '#ef4444', fontWeight: 600, fontSize: '0.85rem',
                                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
                                            }}
                                        >
                                            <Trash2 size={16} /> Delete
                                        </button>
                                    )}
                                    {canMarkCompleted && activeTab === 'active' && selectedEvent.status !== 'completed' && (
                                        <button
                                            onClick={(e) => handleUpdateStatus(e, selectedEvent.id, 'completed')}
                                            style={{
                                                padding: '8px 16px', borderRadius: '8px', border: '1px solid #f1f5f9',
                                                backgroundColor: '#f8fafc', color: '#64748b', fontWeight: 600, fontSize: '0.85rem',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            Mark as Completed
                                        </button>
                                    )}
                                </div>

                                <button
                                    onClick={() => setSelectedEvent(null)}
                                    style={{
                                        padding: '12px 24px',
                                        backgroundColor: '#1e293b',
                                        color: 'white',
                                        fontWeight: 600,
                                        borderRadius: '12px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                    }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Event Modal */}
            {showAddModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.6)',
                    backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 1000,
                    animation: 'fadeIn 0.2s ease-out'
                }} onClick={() => setShowAddModal(false)}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            backgroundColor: '#fff',
                            padding: '32px',
                            borderRadius: '24px',
                            width: '450px',
                            maxWidth: '90%',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                            animation: 'slideUp 0.3s ease-out'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b' }}>Add Event</h3>
                            <button onClick={() => setShowAddModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                                <X size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleAddEvent} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Type Toggle */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', padding: '4px', background: '#f1f5f9', borderRadius: '8px', width: 'fit-content' }}>
                                <button
                                    type="button"
                                    onClick={() => setCreateType('event')}
                                    style={{
                                        padding: '6px 12px', borderRadius: '6px', border: 'none',
                                        background: createType === 'event' ? 'white' : 'transparent',
                                        color: createType === 'event' ? '#0f172a' : '#64748b',
                                        fontWeight: 600, cursor: 'pointer', boxShadow: createType === 'event' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                                    }}
                                >
                                    Event
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setCreateType('announcement')}
                                    style={{
                                        padding: '6px 12px', borderRadius: '6px', border: 'none',
                                        background: createType === 'announcement' ? 'white' : 'transparent',
                                        color: createType === 'announcement' ? '#0f172a' : '#64748b',
                                        fontWeight: 600, cursor: 'pointer', boxShadow: createType === 'announcement' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'
                                    }}
                                >
                                    Announcement
                                </button>
                            </div>

                            <input
                                type="text"
                                placeholder={createType === 'announcement' ? "Announcement Headline" : "Event Title"}
                                value={newEvent.title}
                                onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                                required
                                style={{ padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', width: "100%", background: '#f8fafc' }}
                            />

                            {/* Scope Selection */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#1e293b' }}>Who is this event for?</label>

                                {['executive', 'manager'].includes(userRole) ? (
                                    /* Exec/Manager Options */
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="radio"
                                                name="scope"
                                                value="all"
                                                checked={eventScope === 'all'}
                                                onChange={() => setEventScope('all')}
                                                style={{ accentColor: '#3b82f6' }}
                                            />
                                            All Employees (Broadcast)
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="radio"
                                                name="scope"
                                                value="team"
                                                checked={eventScope === 'team'}
                                                onChange={() => setEventScope('team')}
                                                style={{ accentColor: '#3b82f6' }}
                                            />
                                            Specific Project(s)
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="radio"
                                                name="scope"
                                                value="employee"
                                                checked={eventScope === 'employee'}
                                                onChange={() => setEventScope('employee')}
                                                style={{ accentColor: '#3b82f6' }}
                                            />
                                            Specific Employee(s)
                                        </label>
                                    </div>
                                ) : (
                                    /* Team Lead / Employee Options */
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="radio"
                                                name="scope"
                                                value="my_team"
                                                checked={eventScope === 'my_team'}
                                                onChange={() => { setEventScope('my_team'); setSelectedEmployees([]); }}
                                                style={{ accentColor: '#3b82f6' }}
                                            />
                                            My Project
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="radio"
                                                name="scope"
                                                value="employee"
                                                checked={eventScope === 'employee'}
                                                onChange={() => { setEventScope('employee'); setSelectedEmployees([]); }}
                                                style={{ accentColor: '#3b82f6' }}
                                            />
                                            All Employees
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* Lists for Exec/Manager */}
                            {['executive', 'manager'].includes(userRole) && !loadingOptions && eventScope === 'team' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', background: '#f8fafc' }}>
                                    {allTeams.length > 0 ? allTeams.map(team => (
                                        <label key={team.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedTeams.includes(team.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedTeams([...selectedTeams, team.id]);
                                                    else setSelectedTeams(selectedTeams.filter(id => id !== team.id));
                                                }}
                                                style={{ accentColor: '#3b82f6' }}
                                            />
                                            {team.name}
                                        </label>
                                    )) : <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No projects found</p>}
                                </div>
                            )}

                            {['executive', 'manager'].includes(userRole) && !loadingOptions && eventScope === 'employee' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', background: '#f8fafc' }}>
                                    {allEmployees.length > 0 ? allEmployees.map(emp => (
                                        <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                            <input
                                                type="checkbox"
                                                checked={selectedEmployees.includes(emp.id)}
                                                onChange={(e) => {
                                                    if (e.target.checked) setSelectedEmployees([...selectedEmployees, emp.id]);
                                                    else setSelectedEmployees(selectedEmployees.filter(id => id !== emp.id));
                                                }}
                                                style={{ accentColor: '#3b82f6' }}
                                            />
                                            {emp.name}
                                        </label>
                                    )) : <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No employees found</p>}
                                </div>
                            )}

                            {/* Lists for Team Lead / Employee */}
                            {!['executive', 'manager'].includes(userRole) && !loadingOptions && (
                                <>
                                    {eventScope === 'my_team' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', background: '#f8fafc' }}>
                                            {/* Select All for My Team */}
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={
                                                        allEmployees.filter(e => e.teamId === userTeamId).length > 0 &&
                                                        selectedEmployees.length === allEmployees.filter(e => e.teamId === userTeamId).length
                                                    }
                                                    onChange={(e) => {
                                                        const myMembers = allEmployees.filter(e => e.teamId === userTeamId);
                                                        if (e.target.checked) setSelectedEmployees(myMembers.map(m => m.id));
                                                        else setSelectedEmployees([]);
                                                    }}
                                                    style={{ accentColor: '#3b82f6' }}
                                                />
                                                Select All
                                            </label>

                                            {allEmployees.filter(e => e.teamId === userTeamId).map(emp => (
                                                <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedEmployees.includes(emp.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) setSelectedEmployees([...selectedEmployees, emp.id]);
                                                            else setSelectedEmployees(selectedEmployees.filter(id => id !== emp.id));
                                                        }}
                                                        style={{ accentColor: '#3b82f6' }}
                                                    />
                                                    {emp.name}
                                                </label>
                                            ))}
                                            {allEmployees.filter(e => e.teamId === userTeamId).length === 0 && <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No team members found</p>}
                                        </div>
                                    )}

                                    {eventScope === 'employee' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '150px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '12px', background: '#f8fafc' }}>
                                            {allEmployees.length > 0 ? allEmployees.map(emp => (
                                                <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedEmployees.includes(emp.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) setSelectedEmployees([...selectedEmployees, emp.id]);
                                                            else setSelectedEmployees(selectedEmployees.filter(id => id !== emp.id));
                                                        }}
                                                        style={{ accentColor: '#3b82f6' }}
                                                    />
                                                    {emp.name}
                                                </label>
                                            )) : <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No employees found</p>}
                                        </div>
                                    )}
                                </>
                            )}

                            {createType === 'event' && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <input
                                        type="date"
                                        required={createType === 'event'}
                                        value={newEvent.date}
                                        onChange={(e) => setNewEvent({ ...newEvent, date: e.target.value })}
                                        style={{ padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', background: '#f8fafc', width: "100%" }}
                                    />
                                    <input
                                        type="time"
                                        required={createType === 'event'}
                                        value={newEvent.time}
                                        onChange={(e) => setNewEvent({ ...newEvent, time: e.target.value })}
                                        style={{ padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', background: '#f8fafc', width: "100%" }}
                                    />
                                </div>
                            )}

                            {createType === 'event' && (
                                <input
                                    type="text"
                                    placeholder="Location"
                                    required={createType === 'event'}
                                    value={newEvent.location}
                                    onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                                    style={{ padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', background: '#f8fafc', width: "100%" }}
                                />
                            )}

                            <textarea
                                placeholder="Event Details / Message (Optional)"
                                rows="3"
                                value={newEvent.message}
                                onChange={(e) => setNewEvent({ ...newEvent, message: e.target.value })}
                                style={{ padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '1rem', background: '#f8fafc', width: "100%", resize: 'vertical', fontFamily: 'inherit' }}
                            />

                            <button type="submit" style={{ backgroundColor: '#1e293b', color: '#fff', padding: '14px', borderRadius: '12px', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '8px', fontSize: '1rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>Save Event</button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AnnouncementsPage;
