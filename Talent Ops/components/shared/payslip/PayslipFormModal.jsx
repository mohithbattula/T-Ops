import React, { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
    generatePayslipNumber,
    calculatePresentDays,
    calculateLeaveDays
} from '../../../utils/payslipHelpers';
import { formatMonthYear } from '../../../utils/payrollCalculations';
import { generatePayslipPDF, uploadPayslipPDF } from '../../../utils/pdfGenerator';
import { X, FileText, Plus } from 'lucide-react';
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
        <div className="payslip-modal-overlay" onClick={handleClose}>
            <div className="payslip-modal-content" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="payslip-modal-header">
                    <h2><FileText size={24} /> Generate Payslip</h2>
                    <button onClick={handleClose} className="close-btn">
                        <X size={24} />
                    </button>
                </div>

                {/* Error Alert with Action */}
                {error && (
                    <div className="alert alert-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <span>{error}</span>
                        {payrollMissing && (
                            <button
                                onClick={() => setShowCreatePayroll(true)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    background: '#059669',
                                    color: 'white',
                                    border: 'none',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '0.875rem',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                <Plus size={16} /> Create Payroll
                            </button>
                        )}
                    </div>
                )}

                {/* Form */}
                <form onSubmit={handleGeneratePayslip} className="payslip-form">
                    <div className="form-grid">
                        {/* Left Column */}
                        <div className="form-column">
                            <div className="form-group">
                                <label>Payslip Number</label>
                                <input
                                    type="text"
                                    value={payslipNumber}
                                    readOnly
                                    className="form-input"
                                />
                            </div>

                            {/* Company Logo Upload */}
                            <div className="form-group">
                                <label>Company Logo (Optional)</label>
                                <div
                                    className="logo-upload-area"
                                    onClick={() => document.getElementById('logo-upload').click()}
                                    style={{
                                        border: '2px dashed #7c3aed',
                                        borderRadius: '12px',
                                        padding: '30px',
                                        textAlign: 'center',
                                        cursor: 'pointer',
                                        backgroundColor: logoPreview ? '#f9fafb' : '#faf5ff',
                                        transition: 'all 0.3s'
                                    }}
                                >
                                    {logoPreview ? (
                                        <div>
                                            <img
                                                src={logoPreview}
                                                alt="Logo preview"
                                                style={{
                                                    maxWidth: '150px',
                                                    maxHeight: '100px',
                                                    objectFit: 'contain'
                                                }}
                                            />
                                            <p style={{ marginTop: '10px', fontSize: '0.875rem', color: '#6b7280' }}>
                                                Click to change logo
                                            </p>
                                        </div>
                                    ) : (
                                        <div>
                                            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>📁</div>
                                            <p style={{ color: '#7c3aed', fontWeight: 600, marginBottom: '5px' }}>
                                                Click to Upload Logo
                                            </p>
                                            <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                                                PNG, JPG, GIF (Max 5MB)
                                            </p>
                                        </div>
                                    )}
                                </div>
                                <input
                                    id="logo-upload"
                                    type="file"
                                    accept="image/png,image/jpeg,image/jpg,image/gif"
                                    onChange={handleLogoUpload}
                                    style={{ display: 'none' }}
                                />
                            </div>

                            {/* Company Name */}
                            <div className="form-group">
                                <label>Company Name</label>
                                <input
                                    type="text"
                                    value={companyName}
                                    onChange={(e) => setCompanyName(e.target.value)}
                                    placeholder="Company Name"
                                    className="form-input"
                                />
                            </div>

                            {/* Company Address */}
                            <div className="form-group">
                                <label>Company Address</label>
                                <textarea
                                    value={companyAddress}
                                    onChange={(e) => setCompanyAddress(e.target.value)}
                                    placeholder="Company Address"
                                    className="form-input"
                                    rows="3"
                                    style={{ resize: 'vertical' }}
                                />
                            </div>

                            {/* Company Email */}
                            <div className="form-group">
                                <label>Company Email</label>
                                <input
                                    type="email"
                                    value={companyEmail}
                                    onChange={(e) => setCompanyEmail(e.target.value)}
                                    placeholder="Company Email"
                                    className="form-input"
                                />
                            </div>

                            {/* Company Phone */}
                            <div className="form-group">
                                <label>Company Phone</label>
                                <input
                                    type="tel"
                                    value={companyPhone}
                                    onChange={(e) => setCompanyPhone(e.target.value)}
                                    placeholder="Company Phone"
                                    className="form-input"
                                />
                            </div>

                            <div className="form-group">
                                <label>Select Employee *</label>
                                <select
                                    value={selectedEmployee}
                                    onChange={(e) => setSelectedEmployee(e.target.value)}
                                    required
                                    className="form-input"
                                >
                                    <option value="">-- Select Employee --</option>
                                    {employees.map(emp => (
                                        <option key={emp.id} value={emp.id}>
                                            {emp.full_name} ({emp.email})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {employeeData && (
                                <div className="employee-info-box">
                                    <p><strong>Role:</strong> {employeeData.role}</p>
                                    <p><strong>Location:</strong> {employeeData.location || 'N/A'}</p>
                                </div>
                            )}

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Month *</label>
                                    <select
                                        value={selectedMonth}
                                        onChange={(e) => setSelectedMonth(e.target.value)}
                                        required
                                        className="form-input"
                                    >
                                        <option value="">Select month...</option>
                                        {months.map(month => (
                                            <option key={month.value} value={month.value}>
                                                {month.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Year *</label>
                                    <select
                                        value={selectedYear}
                                        onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                        required
                                        className="form-input"
                                    >
                                        {years.map(year => (
                                            <option key={year} value={year}>
                                                {year}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Right Column */}
                        <div className="form-column">
                            {payrollData && (
                                <>
                                    {/* Attendance Summary */}
                                    <div className="attendance-summary">
                                        <h3>Attendance Summary</h3>
                                        <div className="attendance-grid">
                                            <div className="attendance-item">
                                                <span className="label">Present Days</span>
                                                <span className="value">{presentDays}</span>
                                            </div>
                                            <div className="attendance-item">
                                                <span className="label">Leave Days</span>
                                                <span className="value">{leaveDays}</span>
                                            </div>
                                            <div className="attendance-item">
                                                <span className="label">LOP Days</span>
                                                <span className="value">{payrollData.lop_days || 0}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Salary Breakdown */}
                                    <div className="salary-breakdown">
                                        <h3>Salary Breakdown</h3>

                                        <div className="salary-section">
                                            <h4>Earnings</h4>
                                            <div className="salary-row">
                                                <span>Basic Salary</span>
                                                <span>₹{(payrollData.basic_salary || 0).toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="salary-row">
                                                <span>HRA</span>
                                                <span>₹{(payrollData.hra || 0).toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="salary-row">
                                                <span>Allowances</span>
                                                <span>₹{(payrollData.allowances || 0).toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="salary-row total">
                                                <span>Total Earnings</span>
                                                <span>₹{totalEarnings.toLocaleString('en-IN')}</span>
                                            </div>
                                        </div>

                                        <div className="salary-section">
                                            <h4>Deductions</h4>
                                            <div className="salary-row">
                                                <span>Deductions</span>
                                                <span>₹{(payrollData.deductions || 0).toLocaleString('en-IN')}</span>
                                            </div>
                                            <div className="salary-row total">
                                                <span>Total Deductions</span>
                                                <span>₹{totalDeductions.toLocaleString('en-IN')}</span>
                                            </div>
                                        </div>

                                        <div className="net-salary">
                                            <span>Net Salary</span>
                                            <span>₹{(payrollData.net_salary || 0).toLocaleString('en-IN')}</span>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="modal-footer">
                        <button
                            type="button"
                            onClick={handleClose}
                            className="btn btn-secondary"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading || !selectedEmployee || !selectedMonth || !payrollData}
                        >
                            <FileText size={18} />
                            {loading ? 'Generating...' : 'Generate Payslip'}
                        </button>
                    </div>
                </form>
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
