import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Users, Clock, Calendar, ChevronRight, MoreHorizontal,
    CheckCircle2, AlertCircle, Timer, Plus, Star, X
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useUser } from '../context/UserContext';
import { supabase } from '../../../lib/supabaseClient';
import NotesTile from '../../shared/NotesTile';


const DashboardHome = () => {
    const { addToast } = useToast();
    const { userName } = useUser();
    const navigate = useNavigate();

    // Helper to format date as YYYY-MM-DD for comparison (Local Time)
    // Helper to format date as YYYY-MM-DD for comparison (Local Time)
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const [currentTime, setCurrentTime] = useState(new Date());

    // Update time every minute
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    const getGreeting = () => {
        const hour = currentTime.getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 18) return 'Good afternoon';
        return 'Good evening';
    };

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    // State
    const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
    const [showAddEventModal, setShowAddEventModal] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(today);

    const [timeline, setTimeline] = useState([]);
    const [employeeStats, setEmployeeStats] = useState({ active: 0, away: 0, offline: 0, total: 0 });
    const [teamAnalytics, setTeamAnalytics] = useState([]);
    const [taskStats, setTaskStats] = useState({ pending: 0, inProgress: 0, completed: 0 });
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Data for Modal
    const [allEmployees, setAllEmployees] = useState([]);
    const [allTeams, setAllTeams] = useState([]);
    const [eventScope, setEventScope] = useState('all'); // 'all', 'team', 'employee'
    const [selectedTeams, setSelectedTeams] = useState([]);
    const [selectedEmployees, setSelectedEmployees] = useState([]);

    // Fetch data from Supabase
    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                // Fetch employees for stats
                const { data: employees } = await supabase
                    .from('profiles')
                    .select('id, full_name, role, team_id');

                // Fetch real attendance data
                const todayStr = new Date().toISOString().split('T')[0];
                const { data: attendanceData } = await supabase
                    .from('attendance')
                    .select('employee_id, clock_in, clock_out')
                    .eq('date', todayStr);

                // Fetch approved leaves for today (Absent)
                const { data: leavesData } = await supabase
                    .from('leaves')
                    .select('id')
                    .eq('status', 'approved')
                    .lte('from_date', todayStr)
                    .gte('to_date', todayStr);

                if (employees) {
                    setAllEmployees(employees);

                    let activeCount = 0;
                    if (attendanceData) {
                        activeCount = attendanceData.filter(a => a.clock_in && !a.clock_out).length;
                    }

                    const absentCount = leavesData ? leavesData.length : 0;

                    setEmployeeStats({
                        total: employees.length,
                        active: activeCount,
                        absent: absentCount,
                        away: 0,
                        offline: Math.max(0, employees.length - activeCount - absentCount)
                    });
                }

                // Fetch teams for analytics
                // Fetch tasks for stats and analytics
                // Fetch tasks for stats and analytics AND timeline
                const { data: tasks } = await supabase
                    .from('tasks')
                    .select('id, status, assigned_to, title, due_date, priority');

                if (tasks) {
                    setTaskStats({
                        pending: tasks.filter(t => ['pending', 'to_do', 'to do'].includes(t.status?.toLowerCase())).length,
                        inProgress: tasks.filter(t => ['in_progress', 'in progress'].includes(t.status?.toLowerCase())).length,
                        completed: tasks.filter(t => ['completed', 'done'].includes(t.status?.toLowerCase())).length
                    });
                }

                // Fetch announcements
                const { data: eventsData } = await supabase
                    .from('announcements')
                    .select('*')
                    .order('event_time', { ascending: true });

                let combinedEvents = [];

                if (tasks) {
                    const taskEvents = tasks
                        .filter(t => t.due_date)
                        .map(t => ({
                            id: `task-${t.id}`,
                            date: t.due_date,
                            time: '09:00',
                            title: `Task: ${t.title}`,
                            location: `${t.priority} Priority`,
                            color: '#fef3c7',
                            scope: 'task',
                            participants: []
                        }));
                    combinedEvents = [...combinedEvents, ...taskEvents];
                }

                if (eventsData) {
                    const formattedEvents = eventsData.map(event => ({
                        id: event.id,
                        date: event.event_date,
                        time: event.event_time ? event.event_time.slice(0, 5) : '',
                        title: event.title,
                        location: event.location,
                        color: '#e0f2fe',
                        scope: event.event_for,
                        participants: [],
                        status: event.status,
                        type: 'announcement'
                    }));
                    combinedEvents = [...combinedEvents, ...formattedEvents];
                }

                // Sort by priority: Active > Future > Completed, then by time within each group
                combinedEvents.sort((a, b) => {
                    const getStatusPriority = (event) => {
                        if (event.type !== 'announcement') return 0;
                        const status = event.status || ((event.date === formatDate(new Date())) ? 'active' : (new Date(event.date) < new Date().setHours(0, 0, 0, 0) ? 'completed' : 'future'));
                        if (status === 'active') return 1;
                        if (status === 'future') return 2;
                        return 3;
                    };

                    const priorityA = getStatusPriority(a);
                    const priorityB = getStatusPriority(b);

                    if (priorityA !== priorityB) return priorityA - priorityB;
                    return a.time.localeCompare(b.time);
                });
                setTimeline(combinedEvents);

                // Fetch projects for analytics
                const { data: projectsData } = await supabase
                    .from('projects')
                    .select('id, name');

                const projects = projectsData ? projectsData.map(p => ({ id: p.id, name: p.name })) : [];

                if (projects.length > 0) setAllTeams(projects);

                if (projects && employees && tasks) {
                    const analytics = projects.map(project => {
                        const projectEmployees = employees.filter(e => e.team_id === project.id);
                        const projectEmployeeIds = projectEmployees.map(e => e.id);

                        // Calculate Project Performance
                        const projectTasks = tasks.filter(t => projectEmployeeIds.includes(t.assigned_to));
                        const completedTasks = projectTasks.filter(t => ['completed', 'done'].includes(t.status?.toLowerCase())).length;
                        const totalTasks = projectTasks.length;

                        const performance = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                        let status = 'Steady';
                        let color = '#3b82f6'; // blue

                        if (performance >= 80) {
                            status = 'Excellent';
                            color = '#15803d'; // green
                        } else if (performance >= 50) {
                            status = 'Good';
                            color = '#0ea5e9'; // light blue
                        } else if (performance > 0 && performance < 50) {
                            status = 'Needs Improvement';
                            color = '#dc2626'; // red
                        } else {
                            status = 'No Activity';
                            color = '#94a3b8'; // gray
                        }

                        return {
                            id: project.id,
                            name: project.name,
                            count: projectEmployees.length,
                            performance: performance,
                            projects: Math.floor(Math.random() * 10) + 5, // Placeholder
                            status: status,
                            color: color
                        };
                    });
                    setTeamAnalytics(analytics);
                }
            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            }
        };

        fetchDashboardData();
    }, [refreshTrigger]);

    // Real-time Subscription
    useEffect(() => {
        const sub = supabase
            .channel('dashboard_home_attendance_exec')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, (payload) => {
                setRefreshTrigger(prev => prev + 1);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(sub);
        };
    }, []);

    // Handlers
    const handleMonthChange = (direction) => {
        const newDate = new Date(currentMonth);
        newDate.setMonth(currentMonth.getMonth() + direction);
        setCurrentMonth(newDate);
    };

    const handleDateClick = (day) => {
        const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
        setSelectedDate(newDate);
    };

    const handleAddEvent = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);

        const title = formData.get('title');
        const date = formData.get('date');
        const time = formData.get('time');
        const location = formData.get('location');

        try {
            const { error } = await supabase
                .from('announcements')
                .insert({
                    title: title,
                    event_date: date,
                    event_time: time,
                    location: location,
                    event_for: eventScope,
                    teams: selectedTeams,
                    employees: selectedEmployees,
                });

            if (error) throw error;

            addToast('Event added successfully', 'success');
            setShowAddEventModal(false);

            // Reset form state
            setEventScope('team');
            setSelectedTeams([]);
            setSelectedEmployees([]);

            // Trigger refresh
            setRefreshTrigger(prev => prev + 1);

        } catch (error) {
            console.error('Error adding event:', error);
            addToast('Failed to add event: ' + error.message, 'error');
        }
    };

    const handleAddEmployee = (e) => {
        e.preventDefault();
        setShowAddEmployeeModal(false);
        addToast('Employee added successfully', 'success');
    };

    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
    const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
    const startDayOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

    const filteredTimeline = timeline.filter(event => event.date === formatDate(selectedDate));

    // Helper Component for Stat Cards
    const StatCard = ({ title, value, subtext, icon: Icon, color, trend, onClick }) => (
        <div
            onClick={onClick}
            style={{
                backgroundColor: '#ffffff',
                borderRadius: '24px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
                position: 'relative',
                overflow: 'hidden',
                cursor: onClick ? 'pointer' : 'default',
                transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                border: '1px solid #f1f5f9',
                boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
            }}
            onMouseEnter={(e) => {
                if (onClick) {
                    e.currentTarget.style.transform = 'translateY(-8px)';
                    e.currentTarget.style.boxShadow = '0 20px 40px rgba(0,0,0,0.06)';
                    e.currentTarget.style.borderColor = color;
                }
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.02)';
                e.currentTarget.style.borderColor = '#f1f5f9';
            }}
        >
            <div style={{
                position: 'absolute',
                top: '-20px',
                right: '-20px',
                width: '100px',
                height: '100px',
                background: `radial-gradient(circle, ${color}15 0%, transparent 70%)`,
                borderRadius: '50%',
                pointerEvents: 'none'
            }}></div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{
                    backgroundColor: `${color}10`,
                    padding: '12px',
                    borderRadius: '16px',
                    color: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease'
                }}>
                    <Icon size={24} />
                </div>
                {trend && (
                    <div style={{
                        padding: '6px 12px',
                        borderRadius: '20px',
                        backgroundColor: trend > 0 ? '#f0fdf4' : '#fef2f2',
                        color: trend > 0 ? '#166534' : '#991b1b',
                        fontSize: '0.75rem',
                        fontWeight: '800'
                    }}>
                        {trend > 0 ? `+${trend}%` : `${trend}%`}
                    </div>
                )}
            </div>

            <div>
                <p style={{ fontSize: '0.85rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{title}</p>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <h3 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>{value}</h3>
                    <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#94a3b8' }}>{subtext}</span>
                </div>
            </div>
        </div>
    );

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            paddingBottom: '24px',
            position: 'relative',
            minHeight: '100vh'
        }}>
            {/* Background Decorative Elements */}
            <div style={{ position: 'fixed', top: '10%', right: '-5%', width: '400px', height: '400px', background: 'radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%)', filter: 'blur(80px)', pointerEvents: 'none', zIndex: 0 }}></div>
            <div style={{ position: 'fixed', bottom: '10%', left: '-5%', width: '350px', height: '350px', background: 'radial-gradient(circle, rgba(14, 165, 233, 0.08) 0%, transparent 70%)', filter: 'blur(80px)', pointerEvents: 'none', zIndex: 0 }}></div>

            {/* Header / Hero Section */}
            <div style={{
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                borderRadius: '24px',
                padding: '24px',
                color: 'white',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 20px 40px rgba(0,0,0,0.1)'
            }}>
                {/* SVG Mesh Pattern Overlay */}
                <div style={{ position: 'absolute', inset: 0, opacity: 0.1, pointerEvents: 'none' }}>
                    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <pattern id="mesh" width="40" height="40" patternUnits="userSpaceOnUse">
                                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" />
                            </pattern>
                        </defs>
                        <rect width="100%" height="100%" fill="url(#mesh)" />
                    </svg>
                </div>

                <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '24px' }}>
                    <div style={{ flex: 1, minWidth: '300px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                            <span style={{ backgroundColor: 'rgba(255,255,255,0.1)', padding: '4px 12px', borderRadius: '16px', fontSize: '0.7rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.1em' }}>EXECUTIVE OVERVIEW</span>
                            <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: '800' }}>•</span>
                            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.8rem', fontWeight: '700' }}>{currentTime.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                        </div>
                        <h1 style={{ fontSize: '2rem', fontWeight: '800', marginBottom: '8px', letterSpacing: '-0.04em', lineHeight: 1 }}>
                            Welcome back, <span style={{ background: 'linear-gradient(to right, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{userName}!</span>
                        </h1>
                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem', maxWidth: '600px', fontWeight: '500', lineHeight: 1.6 }}>
                            Organization health is optimal today. {employeeStats.active} employees are currently active across {allTeams.length} projects.
                        </p>
                    </div>

                    {/* Glassmorphism Local Time Card */}
                    <div style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        backdropFilter: 'blur(10px)',
                        padding: '16px 24px',
                        borderRadius: '16px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        textAlign: 'right',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
                    }}>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.65rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '2px' }}>LOCAL TIME</p>
                        <h2 style={{ fontSize: '1.75rem', fontWeight: '800', color: 'white', letterSpacing: '0.05em', lineHeight: 1 }}>
                            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </h2>
                        <button
                            onClick={() => setShowAddEventModal(true)}
                            style={{
                                marginTop: '20px',
                                padding: '12px 24px',
                                borderRadius: '16px',
                                background: 'linear-gradient(to right, #0ea5e9, #6366f1)',
                                color: 'white',
                                border: 'none',
                                fontWeight: '800',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.3s ease',
                                boxShadow: '0 10px 20px rgba(99, 102, 241, 0.2)'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 15px 25px rgba(99, 102, 241, 0.3)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 10px 20px rgba(99, 102, 241, 0.2)'; }}
                        >
                            <Plus size={20} /> Plan New Event
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: '16px', position: 'relative', zIndex: 1 }}>

                {/* Left Column (8 columns) */}
                <div style={{ gridColumn: 'span 8', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Quick Stats Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                        <StatCard
                            title="Workforce Presence"
                            value={employeeStats.active}
                            subtext={`/ ${employeeStats.total} total`}
                            icon={Users}
                            color="#10b981"
                            trend={2.4}
                            onClick={() => navigate('/executive-dashboard/employee-status')}
                        />
                        <StatCard
                            title="Absence Management"
                            value={employeeStats.absent}
                            subtext="on leave today"
                            icon={AlertCircle}
                            color="#ef4444"
                            trend={-12}
                        />
                        <StatCard
                            title="Pipeline Load"
                            value={taskStats.pending + taskStats.inProgress}
                            subtext="active work items"
                            icon={Timer}
                            color="#f59e0b"
                        />
                        <StatCard
                            title="Task Velocity"
                            value={taskStats.completed}
                            subtext="finished this month"
                            icon={CheckCircle2}
                            color="#6366f1"
                        />
                    </div>

                    {/* Project Status Matrix */}
                    <div style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '32px',
                        padding: '32px',
                        border: '1px solid #f1f5f9',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <div>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>Project Health Matrix</h3>
                                <p style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: '600' }}>Real-time performance across active projects</p>
                            </div>
                            <button
                                onClick={() => navigate('/executive-dashboard/analytics')}
                                style={{ color: '#0ea5e9', fontWeight: '800', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer' }}
                            >
                                View full report <ChevronRight size={16} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {teamAnalytics.map((team) => (
                                <div
                                    key={team.id}
                                    onClick={() => navigate('/executive-dashboard/analytics', { state: { teamId: team.id } })}
                                    style={{
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '16px 24px',
                                        backgroundColor: '#f8fafc',
                                        borderRadius: '16px',
                                        transition: 'all 0.3s ease',
                                        border: '1px solid transparent'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#ffffff';
                                        e.currentTarget.style.borderColor = '#eef2f6';
                                        e.currentTarget.style.transform = 'translateX(8px)';
                                        e.currentTarget.style.boxShadow = '0 10px 20px rgba(0,0,0,0.03)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = '#f8fafc';
                                        e.currentTarget.style.borderColor = 'transparent';
                                        e.currentTarget.style.transform = 'translateX(0)';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: team.color, boxShadow: `0 0 10px ${team.color}40` }}></div>
                                        <span style={{ fontWeight: '700', color: '#1e293b', fontSize: '1rem' }}>{team.name}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                            <span style={{ fontSize: '1rem', fontWeight: '800', color: '#0f172a' }}>{team.performance}%</span>
                                            <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase' }}>COMPLETION</span>
                                        </div>
                                        <div style={{
                                            padding: '6px 14px',
                                            borderRadius: '12px',
                                            backgroundColor: '#ffffff',
                                            color: team.color,
                                            fontSize: '0.75rem',
                                            fontWeight: '800',
                                            boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                                            border: `1px solid ${team.color}20`
                                        }}>
                                            {team.status}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <NotesTile />
                </div>

                {/* Right Column (4 columns) */}
                <div style={{ gridColumn: 'span 4', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                    {/* Modern Calendar Widget */}
                    <div style={{
                        backgroundColor: '#ffffff',
                        borderRadius: '32px',
                        padding: '32px',
                        border: '1px solid #f1f5f9',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.02)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#0f172a' }}>{monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h3>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={() => handleMonthChange(-1)}
                                    style={{ width: '32px', height: '32px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: '1px solid #f1f5f9', cursor: 'pointer', transition: 'all 0.2s' }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                >
                                    &lt;
                                </button>
                                <button
                                    onClick={() => handleMonthChange(1)}
                                    style={{ width: '32px', height: '32px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', border: '1px solid #f1f5f9', cursor: 'pointer', transition: 'all 0.2s' }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                                >
                                    &gt;
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center', fontSize: '0.75rem', fontWeight: '800', color: '#94a3b8', marginBottom: '12px' }}>
                            <span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span><span style={{ color: '#ef4444' }}>SA</span><span style={{ color: '#ef4444' }}>SU</span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                            {Array.from({ length: startDayOffset }).map((_, i) => (
                                <div key={`empty-${i}`} style={{ height: '40px' }}></div>
                            ))}
                            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
                                const isSelected = selectedDate.getDate() === d && selectedDate.getMonth() === currentMonth.getMonth() && selectedDate.getFullYear() === currentMonth.getFullYear();
                                const isToday = today.getDate() === d && today.getMonth() === currentMonth.getMonth() && today.getFullYear() === currentMonth.getFullYear();

                                return (
                                    <div
                                        key={d}
                                        onClick={() => handleDateClick(d)}
                                        style={{
                                            height: '40px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            borderRadius: '12px',
                                            backgroundColor: isSelected ? '#0f172a' : isToday ? '#e2e8f0' : 'transparent',
                                            color: isSelected ? '#fff' : isToday ? '#1e293b' : '#475569',
                                            cursor: 'pointer',
                                            fontWeight: isSelected || isToday ? '800' : '600',
                                            fontSize: '0.85rem',
                                            transition: 'all 0.2s',
                                            position: 'relative'
                                        }}
                                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                                        onMouseLeave={(e) => { if (!isSelected && !isToday) e.currentTarget.style.backgroundColor = 'transparent'; }}
                                    >
                                        {d}
                                        {timeline.some(e => e.date === formatDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), d))) && (
                                            <div style={{ position: 'absolute', bottom: '6px', width: '4px', height: '4px', borderRadius: '50%', backgroundColor: isSelected ? '#38bdf8' : '#0ea5e9' }}></div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Timeline Feed */}
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>
                                Day Stream
                            </h3>
                            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: '#64748b' }}>
                                {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', position: 'relative' }}>
                            {/* Vertical Line */}
                            <div style={{ position: 'absolute', left: '11px', top: '10px', bottom: '10px', width: '2px', background: 'linear-gradient(to bottom, #f1f5f9, #e2e8f0, #f1f5f9)' }}></div>

                            {filteredTimeline.length > 0 ? (
                                filteredTimeline.map((event) => (
                                    <div key={event.id} style={{ display: 'flex', gap: '20px', position: 'relative', zIndex: 1 }}>
                                        <div style={{
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '50%',
                                            backgroundColor: '#ffffff',
                                            border: '2px solid #0ea5e9',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            boxShadow: '0 0 0 4px #ffffff',
                                            flexShrink: 0
                                        }}>
                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#0ea5e9' }}></div>
                                        </div>

                                        <div
                                            onClick={() => {
                                                if (event.scope === 'task') navigate('/executive-dashboard/tasks');
                                                else if (event.type === 'announcement') navigate('/executive-dashboard/announcements');
                                            }}
                                            style={{
                                                backgroundColor: '#ffffff',
                                                padding: '16px',
                                                borderRadius: '20px',
                                                border: '1px solid #f1f5f9',
                                                cursor: 'pointer',
                                                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                                                flex: 1
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.transform = 'translateY(-4px)';
                                                e.currentTarget.style.boxShadow = '0 10px 25px rgba(0,0,0,0.04)';
                                                e.currentTarget.style.borderColor = '#e0f2fe';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.boxShadow = 'none';
                                                e.currentTarget.style.borderColor = '#f1f5f9';
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                <p style={{ fontSize: '0.9rem', fontWeight: '800', color: '#1e293b', lineHeight: 1.3 }}>{event.title}</p>
                                                <span style={{ fontSize: '0.75rem', fontWeight: '700', color: '#64748b' }}>{event.time}</span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontSize: '0.8rem', fontWeight: '600' }}>
                                                <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: '#94a3b8' }}></span>
                                                {event.location}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                                    <div style={{ backgroundColor: '#f8fafc', width: '48px', height: '48px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px auto' }}>
                                        <Calendar size={20} color="#cbd5e1" />
                                    </div>
                                    <p style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: '600', fontStyle: 'italic' }}>No events scheduled</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Modals with Premium Styling */}
            {showAddEventModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
                    <div style={{
                        backgroundColor: '#ffffff',
                        padding: '40px',
                        borderRadius: '32px',
                        width: '450px',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                        animation: 'modalSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                            <h3 style={{ fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em', color: '#0f172a' }}>Plan Event</h3>
                            <button onClick={() => setShowAddEventModal(false)} style={{ background: '#f8fafc', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: '12px', color: '#64748b' }}><X size={20} /></button>
                        </div>
                        <form onSubmit={handleAddEvent} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Event Title</label>
                                <input name="title" type="text" placeholder="e.g., Strategic Review" required style={{ padding: '14px 18px', borderRadius: '16px', border: '1px solid #eef2f6', backgroundColor: '#f8fafc', fontSize: '1rem', outline: 'none', transition: 'all 0.2s' }} onFocus={(e) => { e.target.style.borderColor = '#0ea5e9'; e.target.style.backgroundColor = '#fff'; }} onBlur={(e) => { e.target.style.borderColor = '#eef2f6'; e.target.style.backgroundColor = '#f8fafc'; }} />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Scope</label>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    {['all', 'team', 'employee'].map(scope => (
                                        <label key={scope} style={{
                                            flex: 1,
                                            padding: '12px',
                                            borderRadius: '16px',
                                            border: `1px solid ${eventScope === scope ? '#0ea5e9' : '#eef2f6'}`,
                                            backgroundColor: eventScope === scope ? '#f0f9ff' : '#f8fafc',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            fontSize: '0.85rem',
                                            fontWeight: '700',
                                            color: eventScope === scope ? '#0ea5e9' : '#64748b',
                                            transition: 'all 0.2s'
                                        }}>
                                            <input type="radio" value={scope} checked={eventScope === scope} onChange={() => setEventScope(scope)} style={{ display: 'none' }} />
                                            {scope.charAt(0) + scope.slice(1)}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Date</label>
                                    <input name="date" type="date" required defaultValue={formatDate(selectedDate)} style={{ padding: '14px', borderRadius: '16px', border: '1px solid #eef2f6', backgroundColor: '#f8fafc', outline: 'none' }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label style={{ fontSize: '0.85rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Time</label>
                                    <input name="time" type="time" required style={{ padding: '14px', borderRadius: '16px', border: '1px solid #eef2f6', backgroundColor: '#f8fafc', outline: 'none' }} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '0.85rem', fontWeight: '800', color: '#64748b', textTransform: 'uppercase' }}>Location</label>
                                <input name="location" type="text" placeholder="e.g., Boardroom or Link" required style={{ padding: '14px 18px', borderRadius: '16px', border: '1px solid #eef2f6', backgroundColor: '#f8fafc', fontSize: '1rem', outline: 'none' }} />
                            </div>

                            <button type="submit" style={{ backgroundColor: '#0f172a', color: '#fff', padding: '16px', borderRadius: '16px', fontWeight: '800', border: 'none', cursor: 'pointer', marginTop: '12px', fontSize: '1rem', transition: 'all 0.3s' }} onMouseEnter={(e) => e.target.style.backgroundColor = '#1e293b'} onMouseLeave={(e) => e.target.style.backgroundColor = '#0f172a'}>Create Event</button>
                        </form>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes modalSlideUp {
                    from { opacity: 0; transform: translateY(30px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: #e2e8f0; borderRadius: 10px; }
                ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
            `}</style>
        </div>
    );
};

export default DashboardHome;
