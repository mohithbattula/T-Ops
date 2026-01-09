import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Download, FileText, Calendar, DollarSign, Plus } from 'lucide-react';
import DataTable from '../employee/components/UI/DataTable';
import PayslipFormModal from './payslip/PayslipFormModal';

const PayslipsPage = ({ userRole, userId, addToast, orgId }) => {
    const [payslips, setPayslips] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    // Safe toast function
    const showToast = (message, type) => {
        if (addToast) {
            addToast(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    };

    useEffect(() => {
        fetchPayslips();
    }, [userId, userRole, refreshTrigger]);

    // Realtime Payslips
    useEffect(() => {
        const channel = supabase
            .channel('payslips-realtime')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'payslips',
                filter: `org_id=eq.${orgId}`
            }, (payload) => {
                console.log('Realtime Payslip Update:', payload);
                setRefreshTrigger(prev => prev + 1);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, []);

    const fetchPayslips = async () => {
        // Prevent fetching if core user data is missing
        if (!userId || !userRole) {
            console.log('Waiting for user ID and Role...');
            return;
        }

        try {
            setLoading(true);

            // Role-based filtering
            const normalizedRole = userRole ? userRole.toLowerCase().trim() : '';

            // Fetch payslips based on role
            let payslipsQuery = supabase
                .from('payslips')
                .select('*')
                .eq('org_id', orgId)
                .order('month', { ascending: false });

            // Check if user is Executive or Manager (they see ALL payslips)
            const isExecutive = normalizedRole.includes('executive');
            const isManager = normalizedRole.includes('manager');
            const isTeamLead = normalizedRole === 'team_lead';
            const isEmployee = normalizedRole === 'employee';

            // Only filter for employees and team leads
            if (isEmployee || isTeamLead) {
                payslipsQuery = payslipsQuery.eq('employee_id', userId);
            } else if (isExecutive || isManager) {
                // No filter - fetch all payslips
            } else {
                console.warn('⚠️ Unknown role, defaulting to user-specific payslips');
                payslipsQuery = payslipsQuery.eq('employee_id', userId);
            }

            const { data: payslipsData, error: payslipsError } = await payslipsQuery;

            if (payslipsError) {
                console.error('Error fetching payslips:', payslipsError);
                showToast('Failed to load payslips: ' + payslipsError.message, 'error');
                return;
            }

            if (!payslipsData || payslipsData.length === 0) {
                setPayslips([]);
                setLoading(false);
                return;
            }

            // Get unique employee IDs from payslips to fetch their profiles
            const employeeIds = [...new Set(payslipsData.map(p => p.employee_id))];

            // Fetch profiles for these employees
            const { data: profilesData, error: profilesError } = await supabase
                .from('profiles')
                .select('id, full_name, email, role')
                .eq('org_id', orgId)
                .in('id', employeeIds);

            if (profilesError) {
                console.error('Error fetching profiles:', profilesError);
            }

            // Create a map of employee_id to profile
            const profileMap = {};
            if (profilesData) {
                profilesData.forEach(profile => {
                    profileMap[profile.id] = profile;
                });
            }

            // Transform data for display
            const transformedData = payslipsData.map(payslip => ({
                id: payslip.id,
                employee_id: payslip.employee_id,
                name: profileMap[payslip.employee_id]?.full_name || 'Unknown',
                email: profileMap[payslip.employee_id]?.email || 'N/A',
                role: profileMap[payslip.employee_id]?.role || 'N/A',
                month: payslip.month || 'N/A',
                amount: payslip.amount ? `₹${Number(payslip.amount).toLocaleString()}` : 'N/A',
                status: 'Paid',
                storage_url: payslip.storage_url
            }));

            setPayslips(transformedData);
        } catch (error) {
            console.error('Unexpected error fetching payslips:', error);
            showToast('An unexpected error occurred while loading payslips', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async (payslip) => {
        if (!payslip.storage_url) {
            showToast('Payslip file not available', 'warning');
            return;
        }

        try {
            showToast('Downloading payslip...', 'info');

            console.log('Storage URL from DB:', payslip.storage_url);
            console.log('Employee ID:', payslip.employee_id);

            // Extract just the path after the bucket URL
            // The storage_url looks like: "https://...supabase.co/storage/v1/object/public/PAYSLIPS/employeeId/filename.pdf"
            // We need just the "employeeId/filename.pdf" part
            let filePath;
            if (payslip.storage_url.includes('/PAYSLIPS/')) {
                filePath = payslip.storage_url.split('/PAYSLIPS/')[1];
            } else {
                // Fallback: construct the path from employee_id
                const fileName = payslip.storage_url.split('/').pop();
                filePath = `${payslip.employee_id}/${fileName}`;
            }

            console.log('Attempting to download from path:', filePath);

            // Download from PAYSLIPS bucket (UPPERCASE - must match upload!)
            const { data, error } = await supabase.storage
                .from('PAYSLIPS')
                .download(filePath);

            if (error) {
                console.error('Download error:', error);
                throw error;
            }

            if (!data) {
                throw new Error('No data returned from download');
            }

            console.log('Download successful, creating blob URL...');

            // Ensure the blob is typed as PDF
            const pdfBlob = new Blob([data], { type: 'application/pdf' });

            // Create blob URL and force download
            const url = window.URL.createObjectURL(pdfBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Payslip_${payslip.month || 'doc'}_${payslip.name || 'employee'}.pdf`;
            document.body.appendChild(link);
            link.click();

            setTimeout(() => {
                document.body.removeChild(link);
                window.URL.revokeObjectURL(url);
            }, 100);

            showToast('Payslip downloaded successfully', 'success');

        } catch (error) {
            console.error('Download Logic Error:', error);
            showToast(`Could not download: ${error.message || 'File missing'}`, 'error');
        }
    };

    const handlePayslipSuccess = (message) => {
        showToast(message, 'success');
        setRefreshTrigger(prev => prev + 1); // Refresh the list
    };

    const columns = [
        {
            header: 'Employee',
            accessor: 'name',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        backgroundColor: '#e0f2fe',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        color: '#075985'
                    }}>
                        {row.name.charAt(0)}
                    </div>
                    <div>
                        <p style={{ fontWeight: 600, marginBottom: '2px' }}>{row.name}</p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{row.email}</p>
                    </div>
                </div>
            )
        },
        {
            header: 'Month',
            accessor: 'month',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Calendar size={16} color="var(--text-secondary)" />
                    <span style={{ fontWeight: 500 }}>{row.month}</span>
                </div>
            )
        },
        {
            header: 'Amount',
            accessor: 'amount',
            render: (row) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--success)', fontSize: '1rem' }}>{row.amount}</span>
                </div>
            )
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => (
                <span style={{
                    padding: '6px 12px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: '#dcfce7',
                    color: '#166534'
                }}>
                    {row.status}
                </span>
            )
        },
        {
            header: 'Payslip',
            accessor: 'action',
            render: (row) => (
                <button
                    onClick={() => handleDownload(row)}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        backgroundColor: '#7c3aed',
                        color: 'white',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s',
                        boxShadow: 'var(--shadow-sm)'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#6d28d9';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#7c3aed';
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                    }}
                >
                    <Download size={16} />
                    Download
                </button>
            )
        }
    ];

    // Determine if user can add payslips
    const canAddPayslips = userRole && (userRole.toLowerCase().includes('executive') || userRole.toLowerCase().includes('manager'));

    if (loading) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 20px',
                color: 'var(--text-secondary)'
            }}>
                <FileText size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
                <p style={{ fontSize: '1.1rem' }}>Loading payslips...</p>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-lg)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: 'var(--text-secondary)',
                        fontSize: '0.875rem',
                        marginBottom: '4px'
                    }}>
                        <span>Dashboard</span>
                        <span>/</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                            {userRole === 'employee' || userRole === 'team_lead' ? 'Your Payslip' : 'Payslips'}
                        </span>
                    </div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                        {userRole === 'employee' || userRole === 'team_lead' ? 'Your Payslip' : 'Payslips'}
                    </h2>
                </div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    {/* Add Payslip Button */}
                    {canAddPayslips && (
                        <button
                            onClick={() => setShowAddModal(true)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '12px 24px',
                                backgroundColor: '#000',
                                color: '#fff',
                                borderRadius: '12px',
                                fontWeight: 'bold',
                                border: 'none',
                                cursor: 'pointer',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                            }}
                        >
                            <Plus size={20} />
                            Add Payslip
                        </button>
                    )}

                    <div style={{
                        padding: '12px 20px',
                        backgroundColor: 'var(--surface)',
                        borderRadius: '12px',
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--shadow-sm)'
                    }}>
                        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            Total Payslips
                        </p>
                        <p style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                            {payslips.length}
                        </p>
                    </div>
                </div>
            </div>

            {/* Payslips Table */}
            {payslips.length > 0 ? (
                <DataTable
                    title="Payslip Records"
                    columns={columns}
                    data={payslips}
                />
            ) : (
                <div style={{
                    backgroundColor: 'var(--surface)',
                    borderRadius: '16px',
                    padding: '60px 20px',
                    textAlign: 'center',
                    border: '2px dashed var(--border)'
                }}>
                    <FileText size={64} style={{ margin: '0 auto 20px', opacity: 0.3, color: 'var(--text-secondary)' }} />
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '8px' }}>
                        No Payslips Found
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                        {userRole === 'employee' || userRole === 'team_lead'
                            ? 'You don\'t have any payslips yet.'
                            : 'No payslips have been generated yet.'}
                    </p>
                </div>
            )}

            {/* New Payslip Form Modal */}
            <PayslipFormModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                onSuccess={handlePayslipSuccess}
                orgId={orgId}
            />
        </div>
    );
};

export default PayslipsPage;
