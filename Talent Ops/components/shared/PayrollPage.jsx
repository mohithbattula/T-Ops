import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import DataTable from '../employee/components/UI/DataTable';
import PayrollFormModal from './PayrollFormModal';
import { DollarSign, Eye, X } from 'lucide-react';

const PayrollPage = ({ userRole, userId, addToast, orgId }) => {
    const [payrolls, setPayrolls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const [selectedPayroll, setSelectedPayroll] = useState(null);
    const [showDetailsModal, setShowDetailsModal] = useState(false);

    useEffect(() => {
        fetchPayrolls();

        // Real-time subscription
        const subscription = supabase
            .channel('payroll-changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'payroll'
            }, () => {
                fetchPayrolls();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(subscription);
        };
    }, []);

    const fetchPayrolls = async () => {
        try {
            setLoading(true);

            // Fetch payroll records first
            const { data: payrollData, error: payrollError } = await supabase
                .from('payroll')
                .select('*')
                .eq('org_id', orgId)
                .order('created_at', { ascending: false });

            if (payrollError) {
                console.error('Error fetching payrolls:', payrollError);
                addToast('Failed to load payroll records: ' + payrollError.message, 'error');
                return;
            }

            if (!payrollData || payrollData.length === 0) {
                setPayrolls([]);
                return;
            }

            // Fetch employee details separately
            const employeeIds = [...new Set(payrollData.map(p => p.employee_id))];
            const { data: profilesData, error: profilesError } = await supabase
                .from('profiles')
                .select('id, full_name, email')
                .eq('org_id', orgId)
                .in('id', employeeIds);

            if (profilesError) {
                console.error('Error fetching profiles:', profilesError);
            }

            // Create a map of employee details
            const profilesMap = {};
            if (profilesData) {
                profilesData.forEach(profile => {
                    profilesMap[profile.id] = profile;
                });
            }

            // Merge payroll data with employee details
            const formattedPayrolls = payrollData.map(payroll => ({
                id: payroll.id,
                employee_id: payroll.employee_id,
                name: profilesMap[payroll.employee_id]?.full_name || 'Unknown',
                email: profilesMap[payroll.employee_id]?.email || '',
                month: payroll.month,
                basic_salary: payroll.basic_salary,
                hra: payroll.hra,
                allowances: payroll.allowances,
                deductions: payroll.deductions,
                lop_days: payroll.lop_days,
                net_salary: payroll.net_salary,
                status: payroll.status,
                created_at: payroll.created_at
            }));

            setPayrolls(formattedPayrolls);
        } catch (error) {
            console.error('Unexpected error fetching payrolls:', error);
            addToast('Failed to load payroll records', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handlePayrollSuccess = (message) => {
        addToast(message, 'success');
        fetchPayrolls();
    };

    const handleViewDetails = (payroll) => {
        setSelectedPayroll(payroll);
        setShowDetailsModal(true);
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
                        backgroundColor: '#7c3aed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        color: 'white'
                    }}>
                        {row.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <p style={{ fontWeight: 600, marginBottom: '2px' }}>{row.name}</p>
                        <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{row.email}</p>
                    </div>
                </div>
            )
        },
        {
            header: 'Month',
            accessor: 'month'
        },
        {
            header: 'Basic Salary',
            accessor: 'basic_salary',
            render: (row) => (
                <span style={{ fontWeight: 600 }}>
                    ₹{row.basic_salary?.toLocaleString()}
                </span>
            )
        },
        {
            header: 'LOP Days',
            accessor: 'lop_days',
            render: (row) => (
                <span style={{
                    color: row.lop_days > 0 ? '#dc2626' : '#059669',
                    fontWeight: 600
                }}>
                    {row.lop_days || 0}
                </span>
            )
        },
        {
            header: 'Net Salary',
            accessor: 'net_salary',
            render: (row) => (
                <span style={{
                    fontWeight: 700,
                    fontSize: '1rem',
                    color: '#059669'
                }}>
                    ₹{row.net_salary?.toLocaleString()}
                </span>
            )
        },
        {
            header: 'Status',
            accessor: 'status',
            render: (row) => (
                <span style={{
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: row.status === 'generated' ? '#dcfce7' : '#fef3c7',
                    color: row.status === 'generated' ? '#166534' : '#b45309'
                }}>
                    {row.status?.charAt(0).toUpperCase() + row.status?.slice(1)}
                </span>
            )
        },
        {
            header: 'Actions',
            accessor: 'actions',
            render: (row) => (
                <button
                    onClick={() => handleViewDetails(row)}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '8px',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        backgroundColor: '#eff6ff',
                        color: '#1e40af',
                        border: '1px solid #bfdbfe',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#dbeafe';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#eff6ff';
                    }}
                >
                    <Eye size={16} />
                    View Details
                </button>
            )
        }
    ];

    // Only show Generate button for Executive and Manager roles
    const canGenerate = userRole === 'Executive' || userRole === 'Manager' || userRole === 'executive' || userRole === 'manager';

    console.log('PayrollPage - userRole:', userRole, 'canGenerate:', canGenerate);

    return (
        <div style={{
            padding: '24px',
            backgroundColor: '#f9fafb',
            minHeight: '100vh'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '24px'
            }}>
                <div>
                    <h1 style={{
                        fontSize: '1.875rem',
                        fontWeight: 700,
                        color: '#111827',
                        marginBottom: '8px'
                    }}>
                        Payroll Records
                    </h1>
                    <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                        View and manage employee payroll records
                    </p>
                </div>

                {canGenerate && (
                    <button
                        onClick={() => setShowGenerateModal(true)}
                        style={{
                            padding: '12px 24px',
                            backgroundColor: '#7c3aed',
                            color: 'white',
                            border: 'none',
                            borderRadius: '12px',
                            fontSize: '1rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 6px -1px rgba(124, 58, 237, 0.3)',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#6d28d9';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 6px 8px -1px rgba(124, 58, 237, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = '#7c3aed';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(124, 58, 237, 0.3)';
                        }}
                    >
                        <DollarSign size={20} />
                        Generate Payroll
                    </button>
                )}
            </div>

            {/* Content */}
            {loading ? (
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '400px'
                }}>
                    <p style={{ color: '#6b7280', fontSize: '1.125rem' }}>Loading payroll records...</p>
                </div>
            ) : payrolls.length > 0 ? (
                <DataTable
                    title="Payroll Records"
                    columns={columns}
                    data={payrolls}
                />
            ) : (
                <div style={{
                    backgroundColor: 'white',
                    borderRadius: '16px',
                    padding: '48px',
                    textAlign: 'center',
                    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                }}>
                    <DollarSign size={64} color="#d1d5db" style={{ margin: '0 auto 16px' }} />
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
                        No Payroll Records Found
                    </h3>
                    <p style={{ color: '#6b7280', marginBottom: '24px' }}>
                        {canGenerate ? 'Click "Generate Payroll" to create payroll records for employees' : 'No payroll records have been generated yet'}
                    </p>
                    {canGenerate && (
                        <button
                            onClick={() => setShowGenerateModal(true)}
                            style={{
                                padding: '12px 24px',
                                backgroundColor: '#7c3aed',
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                fontSize: '1rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                        >
                            <DollarSign size={20} />
                            Generate Payroll
                        </button>
                    )}
                </div>
            )}

            {/* Generate Payroll Modal */}
            {showGenerateModal && (
                <PayrollFormModal
                    isOpen={showGenerateModal}
                    onClose={() => setShowGenerateModal(false)}
                    onSuccess={handlePayrollSuccess}
                    orgId={orgId}
                />
            )}

            {/* Payroll Details Modal */}
            {showDetailsModal && selectedPayroll && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000
                    }}
                    onClick={() => setShowDetailsModal(false)}
                >
                    <div
                        style={{
                            backgroundColor: 'white',
                            borderRadius: '16px',
                            padding: '32px',
                            maxWidth: '600px',
                            width: '90%',
                            maxHeight: '80vh',
                            overflowY: 'auto',
                            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '24px',
                            paddingBottom: '16px',
                            borderBottom: '2px solid #e5e7eb'
                        }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827' }}>
                                Payroll Details
                            </h2>
                            <button
                                onClick={() => setShowDetailsModal(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    color: '#6b7280'
                                }}
                            >
                                <X size={24} />
                            </button>
                        </div>

                        {/* Employee Info */}
                        <div style={{ marginBottom: '24px' }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '16px',
                                padding: '16px',
                                backgroundColor: '#f9fafb',
                                borderRadius: '12px'
                            }}>
                                <div style={{
                                    width: '56px',
                                    height: '56px',
                                    borderRadius: '50%',
                                    backgroundColor: '#7c3aed',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '1.5rem',
                                    fontWeight: 'bold',
                                    color: 'white'
                                }}>
                                    {selectedPayroll.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <p style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '4px' }}>
                                        {selectedPayroll.name}
                                    </p>
                                    <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                                        {selectedPayroll.email}
                                    </p>
                                    <p style={{ color: '#7c3aed', fontSize: '0.875rem', fontWeight: 600, marginTop: '4px' }}>
                                        {selectedPayroll.month}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Salary Breakdown */}
                        <div style={{ marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                                Salary Breakdown
                            </h3>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                                    <span style={{ color: '#6b7280' }}>Basic Salary</span>
                                    <span style={{ fontWeight: 600 }}>₹{selectedPayroll.basic_salary?.toLocaleString()}</span>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                                    <span style={{ color: '#6b7280' }}>HRA</span>
                                    <span style={{ fontWeight: 600 }}>₹{selectedPayroll.hra?.toLocaleString()}</span>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                                    <span style={{ color: '#6b7280' }}>Allowances</span>
                                    <span style={{ fontWeight: 600 }}>₹{selectedPayroll.allowances?.toLocaleString()}</span>
                                </div>

                                <div style={{
                                    height: '1px',
                                    backgroundColor: '#e5e7eb',
                                    margin: '8px 0'
                                }} />

                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: '#fef3c7', borderRadius: '8px' }}>
                                    <span style={{ color: '#92400e', fontWeight: 600 }}>Gross Salary</span>
                                    <span style={{ fontWeight: 700, color: '#92400e' }}>
                                        ₹{((selectedPayroll.basic_salary || 0) + (selectedPayroll.hra || 0) + (selectedPayroll.allowances || 0)).toLocaleString()}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Deductions */}
                        <div style={{ marginBottom: '24px' }}>
                            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '16px', color: '#374151' }}>
                                Deductions
                            </h3>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: '#fee2e2', borderRadius: '8px' }}>
                                    <span style={{ color: '#991b1b' }}>LOP Days</span>
                                    <span style={{ fontWeight: 600, color: '#991b1b' }}>{selectedPayroll.lop_days || 0} days</span>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: '#fee2e2', borderRadius: '8px' }}>
                                    <span style={{ color: '#991b1b' }}>Additional Deductions</span>
                                    <span style={{ fontWeight: 600, color: '#991b1b' }}>₹{selectedPayroll.deductions?.toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        {/* Net Salary */}
                        <div style={{
                            padding: '20px',
                            backgroundColor: '#dcfce7',
                            borderRadius: '12px',
                            border: '2px solid #86efac'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#166534' }}>
                                    Net Salary
                                </span>
                                <span style={{ fontSize: '1.75rem', fontWeight: 700, color: '#166534' }}>
                                    ₹{selectedPayroll.net_salary?.toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PayrollPage;
