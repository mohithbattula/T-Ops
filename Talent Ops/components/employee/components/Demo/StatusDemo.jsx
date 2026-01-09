import React, { useState, useEffect } from 'react';
import { useUser } from '../../context/UserContext';
import { supabase } from '../../../../lib/supabaseClient';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const StatusDemo = () => {
    const { userName, userStatus, userTask, lastActive, userId } = useUser();

    // Mock Status Data for the List
    const statusData = [
        { name: userName, dept: 'Engineering', availability: userStatus, task: userTask || 'No active task', lastActive: lastActive }
    ];

    const getSunday = (d) => {
        const date = new Date(d);
        date.setHours(0, 0, 0, 0);
        const day = date.getDay();
        const diff = date.getDate() - day;
        return new Date(date.setDate(diff));
    };

    const [currentWeekStart, setCurrentWeekStart] = useState(getSunday(new Date()));
    const [weeklyData, setWeeklyData] = useState([]);
    const [joinDate, setJoinDate] = useState(null);
    const [loading, setLoading] = useState(false);

    const handlePrevWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(currentWeekStart.getDate() - 7);
        setCurrentWeekStart(newDate);
    };

    const handleNextWeek = () => {
        const newDate = new Date(currentWeekStart);
        newDate.setDate(currentWeekStart.getDate() + 7);
        setCurrentWeekStart(newDate);
    };

    // Helper: Get all dates in a range
    const getDatesInRange = (startDate, endDate) => {
        const date = new Date(startDate.getTime());
        const dates = [];
        while (date <= endDate) {
            dates.push(new Date(date));
            date.setDate(date.getDate() + 1);
        }
        return dates;
    };

    useEffect(() => {
        const fetchJoinDate = async () => {
            if (!userId) return;
            const { data } = await supabase.from('profiles').select('join_date').eq('id', userId).single();
            if (data?.join_date) setJoinDate(new Date(data.join_date));
        };
        fetchJoinDate();
    }, [userId]);

    useEffect(() => {
        const fetchData = async () => {
            if (!userId) return;
            setLoading(true);

            // Define Time Range: Weekly (Sun - Sat)
            const weekStart = new Date(currentWeekStart);
            const weekEnd = new Date(currentWeekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);

            const fetchStart = weekStart.toISOString().split('T')[0];
            const fetchEnd = weekEnd.toISOString().split('T')[0];

            try {
                // Fetch Data
                const { data: attendance } = await supabase
                    .from('attendance')
                    .select('*')
                    .eq('employee_id', userId)
                    .gte('date', fetchStart)
                    .lte('date', fetchEnd);

                const { data: leaves } = await supabase
                    .from('leaves')
                    .select('*')
                    .eq('employee_id', userId)
                    .eq('status', 'Approved')
                    .or(`from_date.lte.${fetchEnd},to_date.gte.${fetchStart}`);

                // --- DATE HELPERS ---
                const getLocalDateStr = (date) => {
                    const offset = date.getTimezoneOffset() * 60000;
                    return new Date(date.getTime() - offset).toISOString().split('T')[0];
                };
                const todayLocalStr = getLocalDateStr(new Date());

                // --- SELF-HEALING LOGIC ---
                // Fix stale records strictly from BEFORE today (Local Time)
                const staleRecords = attendance?.filter(a => a.date < todayLocalStr && !a.clock_out) || [];

                if (staleRecords.length > 0) {
                    await Promise.all(staleRecords.map(async (record) => {
                        const clockOutTime = '23:59:00';
                        const start = new Date(`${record.date}T${record.clock_in}`);
                        const end = new Date(`${record.date}T${clockOutTime}`);
                        const diffMs = end - start;
                        const totalHours = (diffMs / (1000 * 60 * 60)).toFixed(2);

                        await supabase
                            .from('attendance')
                            .update({
                                clock_out: clockOutTime,
                                total_hours: totalHours,
                                status: 'present'
                            })
                            .eq('id', record.id);
                    }));
                }

                // Process Day Logic (Aggregate Multiple Sessions)
                const processDay = (date) => {
                    const dateStr = getLocalDateStr(date);

                    // Find ALL records for this day
                    const dayRecords = attendance?.filter(a => a.date === dateStr) || [];
                    const leave = leaves?.find(l => dateStr >= l.from_date && dateStr <= l.to_date);

                    let totalHours = 0;
                    let isAnyActive = false;

                    dayRecords.forEach(att => {
                        if (att.clock_out && att.total_hours) {
                            totalHours += parseFloat(att.total_hours);
                        } else if (att.clock_in && !att.clock_out) {
                            // Active Session
                            const isToday = dateStr === todayLocalStr;
                            const start = new Date(`${dateStr}T${att.clock_in}`);

                            if (isToday) {
                                isAnyActive = true;
                                const now = new Date();
                                const diff = (now - start) / (1000 * 60 * 60);
                                if (diff > 0) totalHours += diff;
                            } else {
                                // Stale session visual fallback (Auto-closing...)
                                const end = new Date(`${dateStr}T23:59:00`);
                                const diff = (end - start) / (1000 * 60 * 60);
                                if (diff > 0) totalHours += diff;
                            }
                        }
                    });

                    let tooltipStatus = 'Absent';
                    let status = 'ABSENT'; // For color logic if needed

                    const today = new Date();
                    today.setHours(0, 0, 0, 0);

                    // Status Determination
                    if (date > today) {
                        tooltipStatus = 'Upcoming';
                    } else if (joinDate && date < joinDate) {
                        tooltipStatus = 'Not Joined';
                    } else if (dayRecords.length > 0) {
                        if (isAnyActive) {
                            tooltipStatus = 'Active Now';
                        } else {
                            // If auto-closing stale logic ran visually, we might want to say that, 
                            // but usually it heals fast.
                            // Check if we have an open record that ISN'T active (stale)
                            const hasStale = dayRecords.some(r => !r.clock_out && dateStr !== todayLocalStr);
                            tooltipStatus = hasStale ? 'Auto-closing...' : 'Present';
                        }
                    } else if (leave) {
                        tooltipStatus = 'On Leave';
                    }

                    return {
                        dateStr,
                        hours: Number(totalHours.toFixed(2)),
                        dayName: date.toLocaleDateString('en-US', { weekday: 'short' }),
                        tooltipStatus
                    };
                };

                // --- WEEKLY DATA (Exclude Sat=6, Sun=0) ---
                const wDates = getDatesInRange(weekStart, weekEnd);
                const wData = wDates
                    .filter(d => d.getDay() !== 0 && d.getDay() !== 6)
                    .map(d => processDay(d));

                setWeeklyData(wData);

            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();

        // Realtime Subscription
        const channel = supabase
            .channel('status-demo-changes')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'attendance',
                    filter: `employee_id=eq.${userId}`
                },
                () => {
                    fetchData();
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [userId, currentWeekStart, joinDate]);

    // Format Week Range Display
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const dateRangeStr = `${currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    // Custom Tooltip for Chart
    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div style={{ backgroundColor: '#ffffff', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
                    <p style={{ fontWeight: 'bold', marginBottom: '4px', color: '#1e293b' }}>{label}</p>
                    <p style={{ fontSize: '0.9rem', color: '#6366f1' }}>Hours: {data.hours}h</p>
                    <p style={{ fontSize: '0.8rem', color: '#64748b' }}>Status: {data.tooltipStatus}</p>
                </div>
            );
        }
        return null;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

            {/* Header */}
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Your Status</h2>

            {/* Status List */}
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                            {['Team Member', 'Department', 'Availability', 'Current Task', 'Last Active'].map(h => (
                                <th key={h} style={{ padding: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {statusData.map((row, i) => (
                            <tr key={i}>
                                <td style={{ padding: '16px 12px', fontWeight: 500 }}>{row.name}</td>
                                <td style={{ padding: '16px 12px', color: 'var(--text-secondary)' }}>{row.dept}</td>
                                <td style={{ padding: '16px 12px' }}>
                                    <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '12px',
                                        backgroundColor: row.availability === 'Online' ? '#dcfce7' : '#fef9c3',
                                        color: row.availability === 'Online' ? '#166534' : '#854d0e', fontSize: '0.85rem', fontWeight: 600
                                    }}>
                                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor' }}></span>
                                        {row.availability}
                                    </span>
                                </td>
                                <td style={{ padding: '16px 12px' }}>{row.task}</td>
                                <td style={{ padding: '16px 12px', color: 'var(--text-secondary)' }}>{row.lastActive}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Weekly Log Graph */}
            <div style={{ backgroundColor: 'var(--surface)', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                    <div>
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Clock size={20} className="text-indigo-500" /> Weekly Log
                        </h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            {dateRangeStr} (Weekdays)
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={handlePrevWeek} style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', cursor: 'pointer', backgroundColor: 'var(--background)', display: 'flex', alignItems: 'center' }}>
                            <ChevronLeft size={16} />
                        </button>
                        <button onClick={handleNextWeek} style={{ padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', cursor: 'pointer', backgroundColor: 'var(--background)', display: 'flex', alignItems: 'center' }}>
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>

                <div style={{ height: '300px', width: '100%' }}>
                    {loading ? (
                        <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                            Loading data...
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={weeklyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                                <XAxis
                                    dataKey="dayName"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                                    unit="h"
                                />
                                <Tooltip content={<CustomTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="hours"
                                    stroke="#6366f1"
                                    strokeWidth={3}
                                    fillOpacity={1}
                                    fill="url(#colorHours)"
                                    activeDot={{ r: 6, strokeWidth: 2, stroke: '#fff' }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>

        </div>
    );
};

export default StatusDemo;
