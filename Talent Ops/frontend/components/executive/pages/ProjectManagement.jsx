import React, { useState, useEffect } from 'react';
import { Plus, Users, FolderOpen, UserPlus, X, Trash2, Search, Building2, ChevronDown, Check, CheckCircle, XCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

const ProjectManagement = ({ addToast = () => { } }) => {
    const [projects, setProjects] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedProject, setSelectedProject] = useState(null);
    const [projectMembers, setProjectMembers] = useState([]);
    const [showAddMember, setShowAddMember] = useState(false);
    const [showAddProject, setShowAddProject] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [searchUser, setSearchUser] = useState('');
    const [selectedRole, setSelectedRole] = useState('consultant');

    useEffect(() => {
        fetchProjects();
        fetchAllUsers();
    }, []);

    const fetchProjects = async () => {
        try {
            const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            setProjects(data || []);
            if (data?.length > 0 && !selectedProject) {
                setSelectedProject(data[0]);
                fetchProjectMembers(data[0].id);
            }
        } catch (error) {
            console.error('Error fetching projects:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchAllUsers = async () => {
        try {
            const { data, error } = await supabase.from('profiles').select('id, full_name, email, role').order('full_name');
            if (error) throw error;
            setAllUsers(data || []);
        } catch (error) {
            console.error('Error fetching users:', error);
        }
    };

    const fetchProjectMembers = async (projectId) => {
        try {
            const { data, error } = await supabase
                .from('project_members')
                .select('*, profiles:user_id(id, full_name, email)')
                .eq('project_id', projectId);
            if (error) throw error;
            setProjectMembers(data || []);
        } catch (error) {
            console.error('Error fetching members:', error);
        }
    };

    const createProject = async () => {
        if (!newProjectName.trim()) return;
        try {
            const { data, error } = await supabase.from('projects').insert({ name: newProjectName.trim() }).select().single();
            if (error) throw error;
            setProjects([data, ...projects]);
            setNewProjectName('');
            setShowAddProject(false);
            addToast?.('Project created!', 'success');
        } catch (error) {
            addToast?.('Failed to create project', 'error');
        }
    };

    const addMember = async (userId) => {
        if (!selectedProject) return;

        // Map 'consultant' to 'employee' for database compatibility
        const dbRole = selectedRole === 'consultant' ? 'employee' : selectedRole;

        const insertData = {
            project_id: selectedProject.id,
            user_id: userId,
            role: dbRole
        };
        console.log('🔍 Adding member with data:', insertData);

        try {
            // 1. Insert into project_members
            const { data, error } = await supabase.from('project_members').insert(insertData).select();

            if (error) {
                console.error('Project member insert failed:', error);
                throw error;
            }

            console.log('📝 Project member added:', data);

            // 2. Sync with team_members (best effort)
            const teamMemberData = {
                team_id: selectedProject.id,
                profile_id: userId,
                role_in_project: dbRole
            };

            const { error: teamError } = await supabase.from('team_members').insert(teamMemberData);
            if (teamError) {
                console.warn('Team member sync warning (might already exist):', teamError);
            } else {
                console.log('Team member synced');
            }

            fetchProjectMembers(selectedProject.id);
            setShowAddMember(false);
            setSearchUser('');
            addToast?.('Member added successfully!', 'success');
        } catch (error) {
            console.error('❌ Full error object:', error);
            if (error.code === '23505') {
                addToast?.('User already in this project', 'error');
            } else {
                addToast?.('Failed to add member: ' + (error.message || 'Unknown error'), 'error');
            }
        }
    };

    const removeMember = async (memberId) => {
        try {
            const { error } = await supabase.from('project_members').delete().eq('id', memberId);
            if (error) throw error;
            setProjectMembers(projectMembers.filter(m => m.id !== memberId));
            addToast?.('Member removed', 'success');
        } catch (error) {
            addToast?.('Failed to remove member', 'error');
        }
    };

    const updateMemberRole = async (member, newRole) => {
        try {
            // Map 'consultant' to 'employee' for database compatibility if needed
            // Assuming DB constraints allow 'employee', 'team_lead', 'manager'
            const dbRole = newRole === 'consultant' ? 'employee' : newRole;

            console.log(`Updating member ${member.id} role. UI Role: ${newRole}, DB Role: ${dbRole}`);

            // Update project_members
            const { error: errorProject } = await supabase
                .from('project_members')
                .update({ role: dbRole })
                .eq('id', member.id);

            if (errorProject) {
                console.error('Project member update failed:', errorProject);
                throw errorProject;
            }

            // Sync with team_members (best effort)
            // project_id maps to team_id, user_id maps to profile_id
            if (member.project_id && member.user_id) {
                const { error: errorTeam } = await supabase
                    .from('team_members')
                    .update({ role_in_project: dbRole })
                    .eq('team_id', member.project_id)
                    .eq('profile_id', member.user_id);

                if (errorTeam) console.warn('Team member sync warning:', errorTeam);
            }

            console.log('Role update successful');

            // Update state locally
            setProjectMembers(prev => prev.map(m =>
                m.id === member.id ? { ...m, role: newRole } : m
            ));

            addToast?.('Role updated successfully', 'success');
        } catch (error) {
            console.error('Failed to update role:', error);
            addToast?.(`Update Failed: ${error.message || 'Unknown error'}`, 'error');
            // Re-fetch to ensure UI is in sync
            if (selectedProject?.id) fetchProjectMembers(selectedProject.id);
        }
    };

    const updateProjectStatus = async (projectId, newStatus) => {
        try {
            const { error } = await supabase
                .from('projects')
                .update({ status: newStatus })
                .eq('id', projectId);
            if (error) throw error;

            setProjects(projects.map(p => p.id === projectId ? { ...p, status: newStatus } : p));
            if (selectedProject?.id === projectId) {
                setSelectedProject({ ...selectedProject, status: newStatus });
            }
            addToast?.(`Project marked as ${newStatus}`, 'success');
        } catch (error) {
            addToast?.('Failed to update project status', 'error');
        }
    };

    const getRoleBadge = (role) => {
        // Map 'employee' from DB to 'consultant' for UI display
        const displayRole = role === 'employee' ? 'consultant' : role;
        const styles = {
            manager: { bg: '#fef3c7', color: '#b45309' },
            team_lead: { bg: '#dbeafe', color: '#1d4ed8' },
            consultant: { bg: '#f3f4f6', color: '#374151' }
        };
        return styles[displayRole] || styles.consultant;
    };

    const getStatusBadge = (status) => {
        const styles = {
            active: { bg: '#dcfce7', color: '#166534', icon: CheckCircle },
            completed: { bg: '#dbeafe', color: '#1e40af', icon: CheckCircle },
            deactivated: { bg: '#f3f4f6', color: '#6b7280', icon: XCircle }
        };
        return styles[status?.toLowerCase()] || styles.active;
    };

    const filteredUsers = allUsers.filter(u =>
        !projectMembers.find(m => m.user_id === u.id) &&
        (u.full_name?.toLowerCase().includes(searchUser.toLowerCase()) ||
            u.email?.toLowerCase().includes(searchUser.toLowerCase()))
    );

    if (loading) {
        return <div style={{ padding: '40px', textAlign: 'center' }}>Loading projects...</div>;
    }

    return (
        <div style={{ display: 'flex', gap: '24px', height: 'calc(100vh - 120px)' }}>
            {/* Projects List */}
            <div style={{ width: '280px', backgroundColor: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FolderOpen size={18} /> Projects
                    </h3>
                    <button onClick={() => setShowAddProject(true)} style={{ background: '#8b5cf6', border: 'none', borderRadius: '8px', padding: '6px', cursor: 'pointer', color: 'white' }}>
                        <Plus size={18} />
                    </button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {projects.map(project => (
                        <div key={project.id} onClick={() => { setSelectedProject(project); fetchProjectMembers(project.id); }}
                            style={{
                                padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                                backgroundColor: selectedProject?.id === project.id ? '#ede9fe' : 'transparent',
                                borderLeft: selectedProject?.id === project.id ? '3px solid #8b5cf6' : '3px solid transparent'
                            }}>
                            <div style={{ fontWeight: 600 }}>{project.name}</div>
                            <div style={{
                                fontSize: '0.75rem',
                                padding: '2px 8px',
                                borderRadius: '12px',
                                backgroundColor: getStatusBadge(project.status).bg,
                                color: getStatusBadge(project.status).color,
                                fontWeight: 600,
                                textTransform: 'capitalize',
                                display: 'inline-block',
                                marginTop: '4px'
                            }}>
                                {project.status || 'active'}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Project Members */}
            <div style={{ flex: 1, backgroundColor: 'var(--surface)', borderRadius: '16px', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {selectedProject ? (
                    <>
                        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedProject.name}</h2>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{projectMembers.length} members</p>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <select
                                    value={selectedProject.status || 'active'}
                                    onChange={(e) => updateProjectStatus(selectedProject.id, e.target.value)}
                                    style={{
                                        padding: '10px 16px',
                                        borderRadius: '10px',
                                        border: '2px solid var(--border)',
                                        backgroundColor: getStatusBadge(selectedProject.status).bg,
                                        color: getStatusBadge(selectedProject.status).color,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        textTransform: 'capitalize'
                                    }}
                                >
                                    <option value="active">Active</option>
                                    <option value="completed">Completed</option>
                                    <option value="deactivated">Deactivated</option>
                                </select>
                                <button onClick={() => setShowAddMember(true)} style={{
                                    padding: '10px 20px', borderRadius: '10px', background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                                    color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
                                }}>
                                    <UserPlus size={18} /> Add Member
                                </button>
                            </div>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                            {projectMembers.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                                    <Users size={48} style={{ marginBottom: '12px', opacity: 0.5 }} />
                                    <p>No members yet. Add project members to get started.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {projectMembers.map(member => {
                                        const badge = getRoleBadge(member.role);
                                        return (
                                            <div key={member.id} style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '14px 16px', backgroundColor: 'var(--background)', borderRadius: '12px', border: '1px solid var(--border)'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600 }}>
                                                        {member.profiles?.full_name?.charAt(0) || '?'}
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight: 600 }}>{member.profiles?.full_name || 'Unknown'}</div>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{member.profiles?.email}</div>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <select
                                                        value={member.role === 'employee' ? 'consultant' : (member.role?.toLowerCase() || 'consultant')}
                                                        onChange={(e) => updateMemberRole(member, e.target.value)}
                                                        style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: badge.bg, color: badge.color, fontWeight: 600, cursor: 'pointer' }}
                                                    >
                                                        <option value="consultant">Consultant</option>
                                                        <option value="team_lead">Team Lead</option>
                                                        <option value="manager">Manager</option>
                                                    </select>
                                                    <button onClick={() => removeMember(member.id)} style={{ padding: '8px', borderRadius: '8px', border: '1px solid #fee2e2', backgroundColor: '#fff', cursor: 'pointer', color: '#ef4444' }}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                        Select a project to manage members
                    </div>
                )}
            </div>

            {/* Add Project Modal */}
            {showAddProject && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: '16px', width: '400px' }}>
                        <h3 style={{ marginBottom: '16px', fontWeight: 700 }}>Create New Project</h3>
                        <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Project name..."
                            style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '16px', fontSize: '1rem' }}
                            onKeyPress={(e) => e.key === 'Enter' && createProject()} autoFocus />
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setShowAddProject(false)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--background)', cursor: 'pointer' }}>Cancel</button>
                            <button onClick={createProject} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#8b5cf6', color: 'white', fontWeight: 600, cursor: 'pointer' }}>Create</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Member Modal */}
            {showAddMember && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ backgroundColor: 'var(--surface)', padding: '24px', borderRadius: '16px', width: '500px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h3 style={{ fontWeight: 700 }}>Add Member to {selectedProject?.name}</h3>
                            <button onClick={() => setShowAddMember(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                                <input type="text" value={searchUser} onChange={(e) => setSearchUser(e.target.value)} placeholder="Search users..."
                                    style={{ width: '100%', padding: '10px 10px 10px 40px', borderRadius: '8px', border: '1px solid var(--border)' }} />
                            </div>
                            <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}
                                style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                                <option value="consultant">Consultant</option>
                                <option value="team_lead">Team Lead</option>
                                <option value="manager">Manager</option>
                            </select>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', maxHeight: '300px' }}>
                            {filteredUsers.length === 0 ? (
                                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>No users found</div>
                            ) : (
                                filteredUsers.map(user => (
                                    <div key={user.id} onClick={() => addMember(user.id)}
                                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '8px', cursor: 'pointer', marginBottom: '4px' }}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--background)'}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                                            {user.full_name?.charAt(0) || '?'}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 500 }}>{user.full_name}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{user.email}</div>
                                        </div>
                                        <Plus size={18} color="#8b5cf6" />
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProjectManagement;
