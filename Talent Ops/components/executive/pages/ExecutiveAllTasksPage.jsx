import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { Briefcase, ChevronRight, LayoutGrid } from 'lucide-react';
import AllTasksView from '../../shared/AllTasksView';
import { useUser } from '../context/UserContext';

const ExecutiveAllTasksPage = () => {
    console.log('🔵 ExecutiveAllTasksPage LOADED - Project Selection View');
    const { userId, orgId } = useUser();
    const [viewMode, setViewMode] = useState('projects'); // 'projects' or 'tasks'
    const [selectedProject, setSelectedProject] = useState(null);
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchProjects();
    }, [userId, orgId]);

    const fetchProjects = async () => {
        try {
            setLoading(true);

            // Fetch all active projects for the Executive view
            const { data: allProjects, error } = await supabase
                .from('projects')
                .select('id, name, status, description')
                .eq('status', 'active')
                .eq('org_id', orgId);

            if (error) throw error;

            setProjects(allProjects || []);
        } catch (error) {
            console.error('Error fetching projects:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleProjectClick = (project) => {
        setSelectedProject(project);
        setViewMode('tasks');
    };

    const handleBackToProjects = () => {
        setSelectedProject(null);
        setViewMode('projects');
    };

    if (viewMode === 'tasks' && selectedProject) {
        return (
            <AllTasksView
                userRole="executive"
                projectRole="executive"
                userId={userId}
                orgId={orgId}
                projectId={selectedProject.id}
                onBack={handleBackToProjects}
            />
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '24px' }}>
            {/* Header */}
            <div>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <LayoutGrid size={28} color="#8b5cf6" /> Projects
                </h1>
                <p style={{ color: '#64748b', marginTop: '4px' }}>
                    Select a project to view and manage tasks
                </p>
            </div>

            {loading ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Loading projects...</div>
            ) : projects.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#64748b', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <Briefcase size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
                    <p style={{ fontSize: '1.1rem', fontWeight: 500 }}>No active projects found</p>
                    <p style={{ fontSize: '0.9rem' }}>There are no active projects in the organization.</p>
                </div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '24px'
                }}>
                    {projects.map(project => (
                        <div
                            key={project.id}
                            onClick={() => handleProjectClick(project)}
                            style={{
                                backgroundColor: 'white',
                                borderRadius: '16px',
                                border: '1px solid #e2e8f0',
                                padding: '24px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '16px',
                                position: 'relative',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.transform = 'translateY(-4px)';
                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
                                e.currentTarget.style.borderColor = '#8b5cf6';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.05)';
                                e.currentTarget.style.borderColor = '#e2e8f0';
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{
                                    width: '48px',
                                    height: '48px',
                                    borderRadius: '12px',
                                    backgroundColor: ['#dbeafe', '#e0e7ff', '#fae8ff', '#fce7f3', '#ffe4e6', '#ffedd5', '#fef3c7', '#dcfce7'][project.id % 8] || '#f3f4f6',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '1.25rem',
                                    fontWeight: 700,
                                    color: ['#1e40af', '#3730a3', '#86198f', '#9d174d', '#9f1239', '#9a3412', '#92400e', '#166534'][project.id % 8] || '#4b5563'
                                }}>
                                    {project.name.substring(0, 2).toUpperCase()}
                                </div>
                                <div style={{
                                    padding: '4px 12px',
                                    borderRadius: '20px',
                                    backgroundColor: project.status === 'active' ? '#dcfce7' : '#f1f5f9',
                                    color: project.status === 'active' ? '#166534' : '#64748b',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    textTransform: 'uppercase'
                                }}>
                                    {project.status || 'Active'}
                                </div>
                            </div>

                            <div>
                                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
                                    {project.name}
                                </h3>
                                <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.5', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                    {project.description}
                                </p>
                            </div>

                            <div style={{ marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 500 }}>
                                    View Tasks
                                </span>
                                <div style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    backgroundColor: '#f8fafc',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#8b5cf6'
                                }}>
                                    <ChevronRight size={18} />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ExecutiveAllTasksPage;
