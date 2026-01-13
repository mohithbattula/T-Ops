import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
    generatePayslipNumber,
    calculatePresentDays,
    calculateLeaveDays
} from '../../../utils/payslipHelpers';
import { formatMonthYear } from '../../../utils/payrollCalculations';
import { generatePayslipPDF, uploadPayslipPDF } from '../../../utils/pdfGenerator';
import { X, FileText, Plus, DollarSign } from 'lucide-react';
import PayslipPreview from './PayslipPreview';
import PayrollFormModal from '../PayrollFormModal';
import './PayslipFormModal.css';

const PayslipFormModal = ({ isOpen, onClose, onSuccess, orgId }) => {
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPreview, setShowPreview] = useState(false);
    const [showCreatePayroll, setShowCreatePayroll] = useState(false);
    const [payrollMissing, setPayrollMissing] = useState(false);

    // Form state
    const [selectedEmployee, setSelectedEmployee] = useState('');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [payslipNumber, setPayslipNumber] = useState('');

    // Company details state
    const [companyName, setCompanyName] = useState('Talent Ops');
    const [companyAddress, setCompanyAddress] = useState('');
    const [companyEmail, setCompanyEmail] = useState('');
    const [companyPhone, setCompanyPhone] = useState('');
    const [logoFile, setLogoFile] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');

    // Payslip data
    const [employeeData, setEmployeeData] = useState(null);
    const [payrollData, setPayrollData] = useState(null);
    const [presentDays, setPresentDays] = useState(0);
    const [leaveDays, setLeaveDays] = useState(0);

    useEffect(() => {
        if (isOpen) {
            setLoading(false); // Reset loading state when modal opens
            fetchEmployees();
            generateNewPayslipNumber(orgId);
        }
    }, [isOpen, orgId]);

    useEffect(() => {
        if (selectedEmployee && selectedMonth) {
            fetchEmployeeData();
        }
    }, [selectedEmployee, selectedMonth, selectedYear]);

    const fetchEmployees = async () => {
        try {
            console.log('Fetching employees...');

            // Check if user is authenticated
            const { data: { user } } = await supabase.auth.getUser();
            console.log('Current user authentication status:', user ? `Authenticated as ${user.email}` : 'Not authenticated');

            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, email, role')
                .eq('org_id', orgId)
                .order('full_name');

            if (error) {
                console.error('Error fetching employees:', error);
                console.error('Error details:', {
                    message: error.message,
                    code: error.code,
                    details: error.details,
                    hint: error.hint
                });
                setError('Failed to load employees: ' + error.message);
                return;
            }

            if (data) {
                console.log('Employees loaded:', data.length);
                if (data.length === 0) {
                    console.warn('⚠️ No employees found in the database. The profiles table might be empty.');
                    setError('No employees found. Please add employees to the system first.');
                }
                setEmployees(data);
            } else {
                console.warn('No employees found');
                setEmployees([]);
            }
        } catch (err) {
            console.error('Unexpected error fetching employees:', err);
            setError('Failed to load employees');
        }
    };

    const generateNewPayslipNumber = async (oId) => {
        console.log('🔢 Generating new payslip number...');
        const number = await generatePayslipNumber(oId);
        console.log('✅ Generated payslip number:', number);
        setPayslipNumber(number);
    };

    const handleLogoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Validate file type
            const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
            if (!validTypes.includes(file.type)) {
                setError('Please upload a valid image file (PNG, JPG, GIF)');
                return;
            }

            // Validate file size (max 5MB)
            if (file.size > 5 * 1024 * 1024) {
                setError('File size must be less than 5MB');
                return;
            }

            setLogoFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setLogoPreview(reader.result);
            };
            reader.readAsDataURL(file);
            setError('');
        }
    };

    const fetchEmployeeData = async () => {
        setLoading(true);
        setError('');

        try {
            // Fetch employee details
            const { data: employee, error: empError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', selectedEmployee)
                .eq('org_id', orgId)
                .single();

            if (empError) throw empError;
            setEmployeeData(employee);

            // Fetch payroll data
            const monthStr = formatMonthYear(parseInt(selectedMonth), selectedYear);
            console.log('Fetching payroll for employee:', selectedEmployee, 'month:', monthStr);

            const { data: payroll, error: payrollError } = await supabase
                .from('payroll')
                .select('*')
                .eq('employee_id', selectedEmployee)
                .eq('month', monthStr)
                .eq('org_id', orgId)
                .single();

            console.log('Payroll query result:', { payroll, payrollError });

            if (payrollError) {
                console.error('Payroll fetch error details:', {
                    message: payrollError.message,
                    details: payrollError.details,
                    hint: payrollError.hint,
                    code: payrollError.code
                });
                setPayrollMissing(true);
                setError(`No payroll data found for this employee and month (${monthStr}).`);
                setPayrollData(null);
            } else {
                console.log('Payroll data loaded successfully:', payroll);
                setPayrollData(payroll);
                setError('');
            }

            // Calculate attendance
            const present = await calculatePresentDays(selectedEmployee, parseInt(selectedMonth), selectedYear, orgId);
            const leaves = await calculateLeaveDays(selectedEmployee, parseInt(selectedMonth), selectedYear, orgId);

            setPresentDays(present);
            setLeaveDays(leaves);
        } catch (err) {
            console.error('Error fetching data:', err);
            setError(err.message || 'Failed to fetch employee data');
        } finally {
            setLoading(false);
        }
    };

    const handleGeneratePayslip = async (e) => {
        e.preventDefault();

        if (!selectedEmployee || !selectedMonth || !payrollData) {
            setError('Please select employee, month and ensure payroll data exists');
            return;
        }

        // Show preview instead of saving immediately
        setShowPreview(true);
    };

    const handleSavePayslip = async () => {
        setLoading(true);
        setError('');

        try {
            // Prepare payslip data with explicit number conversions to prevent NaN errors
            const monthStr = formatMonthYear(parseInt(selectedMonth), selectedYear);
            const payslipData = {
                payslipNumber,
                employeeId: selectedEmployee,
                employeeName: employeeData.full_name || 'N/A',
                employeeEmail: employeeData.email || 'N/A',
                employeeRole: employeeData.role || 'N/A',
                employeeLocation: employeeData.location || 'N/A',
                month: monthStr,
                // Ensure all numeric fields are valid numbers, never null/undefined/NaN
                basicSalary: Number(payrollData.basic_salary) || 0,
                hra: Number(payrollData.hra) || 0,
                allowances: Number(payrollData.allowances) || 0,
                deductions: Number(payrollData.deductions) || 0,
                lopDays: Number(payrollData.lop_days) || 0,
                lopAmount: 0,
                netSalary: Number(payrollData.net_salary) || 0,
                presentDays: Number(presentDays) || 0,
                leaveDays: Number(leaveDays) || 0
            };

            // Company settings - use form values
            const companySettings = {
                company_name: companyName || 'Talent Ops',
                company_address: companyAddress,
                company_email: companyEmail,
                company_phone: companyPhone,
                logo_url: logoPreview
            };

            // Generate PDF
            const pdf = await generatePayslipPDF(payslipData, companySettings);

            // Upload to Supabase
            const storageUrl = await uploadPayslipPDF(pdf, payslipNumber, selectedEmployee);
            console.log('PDF uploaded successfully to:', storageUrl);

            // Get current user
            const { data: { user } } = await supabase.auth.getUser();
            console.log('Current user:', user?.id);

            // Prepare insert data
            const insertData = {
                payslip_number: payslipNumber,
                employee_id: selectedEmployee,
                month: monthStr,
                amount: payrollData.net_salary,
                storage_url: storageUrl,
                created_by: user?.id,
                status: 'generated',
                org_id: orgId
            };

            console.log('Attempting to insert payslip record:', insertData);

            // Save payslip record
            const { data: insertedData, error: insertError } = await supabase
                .from('payslips')
                .insert(insertData)
                .select();

            if (insertError) {
                console.error('Database insert error:', insertError);
                throw insertError;
            }

            console.log('Payslip record inserted successfully:', insertedData);

            // Success callback
            if (onSuccess) {
                onSuccess('Payslip generated successfully!');
            }

            // Reset and close
            handleClose();

        } catch (err) {
            console.error('Error generating payslip:', err);
            setError(err.message || 'Failed to generate payslip');
            setShowPreview(false); // Go back to form on error
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        // Reset form
        setSelectedEmployee('');
        setSelectedMonth('');
        setSelectedYear(new Date().getFullYear());
        setEmployeeData(null);
        setPayrollData(null);
        setPresentDays(0);
        setLeaveDays(0);
        setError('');
        setShowPreview(false);
        setShowCreatePayroll(false);
        setPayrollMissing(false);

        // Reset company details
        setCompanyName('Talent Ops');
        setCompanyAddress('');
        setCompanyEmail('');
        setCompanyPhone('');
        setLogoFile(null);
        setLogoPreview('');

        onClose();
    };

    const handlePayrollCreated = (message) => {
        setShowCreatePayroll(false);
        setPayrollMissing(false);
        // Refetch employee data to get the newly created payroll
        if (selectedEmployee && selectedMonth) {
            fetchEmployeeData();
        }
    };

    const months = [
        { value: 1, label: 'January' },
        { value: 2, label: 'February' },
        { value: 3, label: 'March' },
        { value: 4, label: 'April' },
        { value: 5, label: 'May' },
        { value: 6, label: 'June' },
        { value: 7, label: 'July' },
        { value: 8, label: 'August' },
        { value: 9, label: 'September' },
        { value: 10, label: 'October' },
        { value: 11, label: 'November' },
        { value: 12, label: 'December' }
    ];

    const years = Array.from({ length: 11 }, (_, i) => 2030 - i);

    const totalEarnings = payrollData
        ? (payrollData.basic_salary || 0) + (payrollData.hra || 0) + (payrollData.allowances || 0)
        : 0;

    const totalDeductions = payrollData ? (payrollData.deductions || 0) : 0;

    if (!isOpen) return null;

    // Prepare payslip data for preview - same data validation as handleSavePayslip
    const payslipDataForPreview = payrollData && employeeData ? {
        payslipNumber,
        employeeId: selectedEmployee,
        employeeName: employeeData.full_name || 'N/A',
        employeeEmail: employeeData.email || 'N/A',
        employeeRole: employeeData.role || 'N/A',
        employeeLocation: employeeData.location || 'N/A',
        month: formatMonthYear(parseInt(selectedMonth), selectedYear),
        basicSalary: Number(payrollData.basic_salary) || 0,
        hra: Number(payrollData.hra) || 0,
        allowances: Number(payrollData.allowances) || 0,
        deductions: Number(payrollData.deductions) || 0,
        lopDays: Number(payrollData.lop_days) || 0,
        lopAmount: 0,
        netSalary: Number(payrollData.net_salary) || 0,
        presentDays: Number(presentDays) || 0,
        leaveDays: Number(leaveDays) || 0
    } : null;

    const companySettings = {
        company_name: companyName,
        company_address: companyAddress,
        company_email: companyEmail,
        company_phone: companyPhone,
        logo_url: logoPreview
    };

    // Show preview if showPreview is true
    if (showPreview && payslipDataForPreview) {
        return (
            <PayslipPreview
                payslipData={payslipDataForPreview}
                companySettings={companySettings}
                onBack={() => setShowPreview(false)}
                onSave={handleSavePayslip}
                loading={loading}
            />
        );
    }

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            animation: 'fadeIn 0.3s ease-out'
        }} onClick={handleClose}>
            <div
                style={{
                    maxWidth: '1200px',
                    width: '95%',
                    backgroundColor: 'white',
                    borderRadius: '28px',
                    overflow: 'hidden',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: '90vh'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: '24px 32px',
                    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: 'white'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ padding: '10px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}>
                            <FileText size={24} />
                        </div>
                        <div>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Generate Digital Payslip</h2>
                            <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>Secure Document Issuance Terminal</p>
                        </div>
                    </div>
                    <button onClick={handleClose} style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: 'none',
                        borderRadius: '50%',
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                    }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}>
                        <X size={24} />
                    </button>
                </div>

                <div style={{ padding: '32px', overflowY: 'auto' }}>
                    {/* Error Alert with Action */}
                    {error && (
                        <div style={{
                            backgroundColor: '#fff1f2',
                            border: '1px solid #fecaca',
                            color: '#e11d48',
                            padding: '16px',
                            borderRadius: '16px',
                            marginBottom: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                            fontSize: '0.9rem',
                            fontWeight: 500
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <X size={18} />
                                <span>{error}</span>
                            </div>
                            {payrollMissing && (
                                <button
                                    onClick={() => setShowCreatePayroll(true)}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: '12px',
                                        background: '#059669',
                                        color: 'white',
                                        border: 'none',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        fontSize: '0.85rem',
                                        boxShadow: '0 4px 6px rgba(5, 150, 105, 0.2)'
                                    }}
                                >
                                    <Plus size={16} /> Initialize Payroll
                                </button>
                            )}
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleGeneratePayslip}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '32px' }}>
                            {/* Left Column - Core Data */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#475569' }}>Payslip Serial</label>
                                        <input
                                            type="text"
                                            value={payslipNumber}
                                            readOnly
                                            style={{
                                                padding: '14px 16px',
                                                borderRadius: '14px',
                                                border: '2px solid #f1f5f9',
                                                backgroundColor: '#f8fafc',
                                                fontSize: '0.95rem',
                                                fontWeight: 700,
                                                color: '#64748b'
                                            }}
                                        />
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#475569' }}>Target Recipient *</label>
                                        <select
                                            value={selectedEmployee}
                                            onChange={(e) => setSelectedEmployee(e.target.value)}
                                            required
                                            style={{
                                                padding: '14px 16px',
                                                borderRadius: '14px',
                                                border: '2px solid #e2e8f0',
                                                fontSize: '0.95rem',
                                                fontWeight: 600,
                                                color: '#1e293b',
                                                backgroundColor: 'white',
                                                cursor: 'pointer',
                                                outline: 'none',
                                                transition: 'border-color 0.2s'
                                            }}
                                            onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
                                            onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                        >
                                            <option value="">Select individual...</option>
                                            {employees.map(emp => (
                                                <option key={emp.id} value={emp.id}>
                                                    {emp.full_name} ({emp.email})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#475569' }}>Billing Month *</label>
                                        <select
                                            value={selectedMonth}
                                            onChange={(e) => setSelectedMonth(e.target.value)}
                                            required
                                            style={{
                                                padding: '14px 16px',
                                                borderRadius: '14px',
                                                border: '2px solid #e2e8f0',
                                                fontSize: '0.95rem',
                                                fontWeight: 600,
                                                color: '#1e293b',
                                                backgroundColor: 'white',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <option value="">Select month...</option>
                                            {months.map(month => (
                                                <option key={month.value} value={month.value}>
                                                    {month.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#475569' }}>Fiscal Year *</label>
                                        <select
                                            value={selectedYear}
                                            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                            required
                                            style={{
                                                padding: '14px 16px',
                                                borderRadius: '14px',
                                                border: '2px solid #e2e8f0',
                                                fontSize: '0.95rem',
                                                fontWeight: 600,
                                                color: '#1e293b',
                                                backgroundColor: 'white',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {years.map(year => (
                                                <option key={year} value={year}>
                                                    {year}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                {/* Branding Panel */}
                                <div style={{
                                    padding: '28px',
                                    backgroundColor: '#f8fafc',
                                    borderRadius: '24px',
                                    border: '1px solid #e2e8f0',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '20px'
                                }}>
                                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <div style={{ width: '8px', height: '24px', backgroundColor: '#7c3aed', borderRadius: '4px' }}></div>
                                        Corporate Identity
                                    </h3>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 2fr', gap: '24px' }}>
                                        <div
                                            onClick={() => document.getElementById('logo-upload').click()}
                                            style={{
                                                border: '2px dashed #cbd5e1',
                                                borderRadius: '20px',
                                                padding: '24px',
                                                textAlign: 'center',
                                                cursor: 'pointer',
                                                backgroundColor: logoPreview ? 'white' : '#f1f5f9',
                                                transition: 'all 0.3s',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                minHeight: '160px',
                                                position: 'relative',
                                                overflow: 'hidden'
                                            }}
                                        >
                                            {logoPreview ? (
                                                <img
                                                    src={logoPreview}
                                                    alt="Identity preview"
                                                    style={{ maxWidth: '100%', maxHeight: '120px', objectFit: 'contain' }}
                                                />
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                                                    <Plus size={32} color="#94a3b8" />
                                                    <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Upload Logo</p>
                                                </div>
                                            )}
                                            <input
                                                id="logo-upload"
                                                type="file"
                                                accept="image/png,image/jpeg,image/jpg,image/gif"
                                                onChange={handleLogoUpload}
                                                style={{ display: 'none' }}
                                            />
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <input
                                                type="text"
                                                value={companyName}
                                                onChange={(e) => setCompanyName(e.target.value)}
                                                placeholder="Legal Entity Name"
                                                style={{ padding: '12px 16px', borderRadius: '12px', border: '1.5px solid #e2e8f0', fontSize: '0.95rem', fontWeight: 600 }}
                                            />
                                            <textarea
                                                value={companyAddress}
                                                onChange={(e) => setCompanyAddress(e.target.value)}
                                                placeholder="Registered Office Address"
                                                rows="3"
                                                style={{ padding: '12px 16px', borderRadius: '12px', border: '1.5px solid #e2e8f0', fontSize: '0.95rem', fontWeight: 500, resize: 'none' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                        <input
                                            type="email"
                                            value={companyEmail}
                                            onChange={(e) => setCompanyEmail(e.target.value)}
                                            placeholder="Contact Email"
                                            style={{ padding: '12px 16px', borderRadius: '12px', border: '1.5px solid #e2e8f0', fontSize: '0.9rem', fontWeight: 600 }}
                                        />
                                        <input
                                            type="tel"
                                            value={companyPhone}
                                            onChange={(e) => setCompanyPhone(e.target.value)}
                                            placeholder="Finance Desk Extension"
                                            style={{ padding: '12px 16px', borderRadius: '12px', border: '1.5px solid #e2e8f0', fontSize: '0.9rem', fontWeight: 600 }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Right Column - Financial Synthesis */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                {payrollData ? (
                                    <>
                                        {/* Attendance Ribbon */}
                                        <div style={{
                                            background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                                            borderRadius: '24px',
                                            padding: '24px',
                                            border: '1.5px solid #bae6fd'
                                        }}>
                                            <h4 style={{ margin: '0 0 16px 0', fontSize: '1rem', fontWeight: 800, color: '#0369a1', textTransform: 'uppercase' }}>Operational Pulse</h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                                                {[
                                                    { label: 'Present', val: presentDays, color: '#059669' },
                                                    { label: 'Leave', val: leaveDays, color: '#2563eb' },
                                                    { label: 'LOP', val: payrollData.lop_days || 0, color: '#dc2626' }
                                                ].map((item, idx) => (
                                                    <div key={idx} style={{ textAlign: 'center', backgroundColor: 'white', padding: '12px', borderRadius: '16px', border: '1px solid #bae6fd' }}>
                                                        <p style={{ margin: '0 0 4px 0', fontSize: '0.7rem', fontWeight: 700, color: '#64748b' }}>{item.label}</p>
                                                        <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: item.color }}>{item.val}d</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Financial Breakdown */}
                                        <div style={{
                                            backgroundColor: '#f8fafc',
                                            borderRadius: '24px',
                                            padding: '28px',
                                            border: '1px solid #e2e8f0',
                                            flex: 1,
                                            display: 'flex',
                                            flexDirection: 'column'
                                        }}>
                                            <h4 style={{ margin: '0 0 20px 0', fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>Compensation Structure</h4>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>
                                                    <span>Base / Basic</span>
                                                    <span>₹{(payrollData.basic_salary || 0).toLocaleString('en-IN')}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>
                                                    <span>Housing Allowance</span>
                                                    <span>₹{(payrollData.hra || 0).toLocaleString('en-IN')}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#64748b', fontWeight: 600 }}>
                                                    <span>Standard Allowances</span>
                                                    <span>₹{(payrollData.allowances || 0).toLocaleString('en-IN')}</span>
                                                </div>
                                                <div style={{ height: '1px', backgroundColor: '#e2e8f0', margin: '8px 0' }} />
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', color: '#1e293b', fontWeight: 800 }}>
                                                    <span>Gross Earnings</span>
                                                    <span>₹{totalEarnings.toLocaleString('en-IN')}</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#e11d48', fontWeight: 700, marginTop: '12px' }}>
                                                    <span>Total Deductions</span>
                                                    <span>- ₹{totalDeductions.toLocaleString('en-IN')}</span>
                                                </div>
                                            </div>

                                            <div style={{
                                                marginTop: 'auto',
                                                padding: '20px',
                                                background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
                                                borderRadius: '20px',
                                                border: '2px solid #ddd6fe',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}>
                                                <span style={{ fontSize: '1rem', fontWeight: 800, color: '#5b21b6' }}>Payable Amount</span>
                                                <span style={{ fontSize: '1.5rem', fontWeight: 900, color: '#7c3aed' }}>₹{(payrollData.net_salary || 0).toLocaleString('en-IN')}</span>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div style={{
                                        flex: 1,
                                        border: '2px dashed #e2e8f0',
                                        borderRadius: '24px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '40px',
                                        textAlign: 'center',
                                        color: '#64748b'
                                    }}>
                                        <DollarSign size={48} color="#cbd5e1" style={{ marginBottom: '16px' }} />
                                        <p style={{ fontWeight: 600, margin: '0 0 16px 0' }}>
                                            {payrollMissing
                                                ? `No payroll record found for ${selectedMonth} ${selectedYear}.`
                                                : 'Select employee and month to load financial snapshot'}
                                        </p>
                                        {payrollMissing && (
                                            <button
                                                type="button"
                                                onClick={() => setShowCreatePayroll(true)}
                                                style={{
                                                    padding: '12px 24px',
                                                    borderRadius: '12px',
                                                    backgroundColor: '#7c3aed',
                                                    color: 'white',
                                                    border: 'none',
                                                    fontWeight: 700,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    boxShadow: '0 4px 12px rgba(124, 58, 237, 0.2)'
                                                }}
                                            >
                                                <Plus size={18} />
                                                Generate Payroll Data
                                            </button>
                                        )}
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: '16px', marginTop: 'auto' }}>
                                    <button
                                        type="button"
                                        onClick={handleClose}
                                        style={{
                                            flex: 0.8,
                                            padding: '16px',
                                            borderRadius: '16px',
                                            fontWeight: 700,
                                            border: '2px solid #e2e8f0',
                                            backgroundColor: 'white',
                                            color: '#64748b',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        Dismiss
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={loading || !selectedEmployee || !selectedMonth || !payrollData}
                                        style={{
                                            flex: 1.2,
                                            padding: '16px',
                                            borderRadius: '16px',
                                            fontWeight: 800,
                                            border: 'none',
                                            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                                            color: 'white',
                                            cursor: (loading || !selectedEmployee || !selectedMonth || !payrollData) ? 'not-allowed' : 'pointer',
                                            boxShadow: '0 8px 20px rgba(79, 70, 229, 0.3)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '10px',
                                            opacity: (loading || !selectedEmployee || !selectedMonth || !payrollData) ? 0.6 : 1,
                                            transition: 'all 0.3s'
                                        }}
                                        onMouseEnter={(e) => { if (!loading && selectedEmployee && payrollData) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 25px rgba(79, 70, 229, 0.4)'; } }}
                                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(79, 70, 229, 0.3)'; }}
                                    >
                                        <FileText size={20} />
                                        {loading ? 'Processing Document...' : 'Verify & Generate Payslip'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            </div>

            {/* Payroll Creation Modal */}
            <PayrollFormModal
                isOpen={showCreatePayroll}
                onClose={() => setShowCreatePayroll(false)}
                onSuccess={handlePayrollCreated}
                orgId={orgId}
            />
        </div>
    );
};

export default PayslipFormModal;
