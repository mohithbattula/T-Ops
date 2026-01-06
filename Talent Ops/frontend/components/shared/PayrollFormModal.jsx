import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
    getDaysInMonth,
    calculatePresentDays,
    calculateApprovedLeaveDays,
    fetchEmployeeFinance,
    calculateLOPDays,
    calculateLOPAmount,
    calculateNetSalary,
    formatMonthYear,
    checkPayrollExists
} from '../../utils/payrollCalculations';
import { X, FileText, CheckSquare, Square, Calculator, AlertTriangle } from 'lucide-react';
import './payslip/PayslipFormModal.css';

const PayrollFormModal = ({ isOpen, onClose, onSuccess }) => {
    const [employees, setEmployees] = useState([]);
    const [selectedEmployees, setSelectedEmployees] = useState([]);
    const [selectAll, setSelectAll] = useState(false);
    const [loading, setLoading] = useState(false);
    const [calculating, setCalculating] = useState(false);
    const [error, setError] = useState('');
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // Form state
    const [selectedMonth, setSelectedMonth] = useState('');
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

    // Calculation preview data
    const [payrollPreview, setPayrollPreview] = useState([]);
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchEmployees();
            resetForm();
        }
    }, [isOpen]);

    const resetForm = () => {
        setSelectedEmployees([]);
        setSelectAll(false);
        setSelectedMonth('');
        setSelectedYear(new Date().getFullYear());
        setPayrollPreview([]);
        setShowPreview(false);
        setError('');
        setProgress({ current: 0, total: 0 });
    };

    const fetchEmployees = async () => {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, full_name, email, role')
                .order('full_name');

            if (error) {
                console.error('Error fetching employees:', error);
                setError('Failed to load employees: ' + error.message);
                return;
            }

            if (data) {
                setEmployees(data);
            }
        } catch (err) {
            console.error('Unexpected error fetching employees:', err);
            setError('Failed to load employees');
        }
    };

    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedEmployees([]);
        } else {
            setSelectedEmployees(employees.map(emp => emp.id));
        }
        setSelectAll(!selectAll);
    };

    const handleEmployeeToggle = (employeeId) => {
        setSelectedEmployees(prev => {
            const newSelection = prev.includes(employeeId)
                ? prev.filter(id => id !== employeeId)
                : [...prev, employeeId];

            setSelectAll(newSelection.length === employees.length);
            return newSelection;
        });
    };

    const handleCalculatePreview = async () => {
        if (selectedEmployees.length === 0) {
            setError('Please select at least one employee');
            return;
        }

        if (!selectedMonth) {
            setError('Please select a month');
            return;
        }

        setCalculating(true);
        setError('');
        setPayrollPreview([]);

        const preview = [];
        const warnings = [];
        const monthYear = formatMonthYear(parseInt(selectedMonth), selectedYear);

        for (const employeeId of selectedEmployees) {
            const employee = employees.find(e => e.id === employeeId);

            try {
                // Check if payroll already exists
                const exists = await checkPayrollExists(employeeId, monthYear);
                if (exists) {
                    warnings.push(`${employee.full_name}: Payroll already exists for ${monthYear}`);
                    continue;
                }

                // Fetch finance data
                const financeData = await fetchEmployeeFinance(employeeId);
                if (!financeData) {
                    warnings.push(`${employee.full_name}: No active salary data found`);
                    continue;
                }

                // Calculate attendance and leaves
                const totalWorkingDays = getDaysInMonth(parseInt(selectedMonth), selectedYear);
                const presentDays = await calculatePresentDays(employeeId, parseInt(selectedMonth), selectedYear);
                const leaveDays = await calculateApprovedLeaveDays(employeeId, parseInt(selectedMonth), selectedYear);

                // Calculate LOP
                const lopDays = calculateLOPDays(totalWorkingDays, presentDays, leaveDays);
                const lopAmount = calculateLOPAmount(financeData.basic_salary, totalWorkingDays, lopDays);

                // Add to preview with default deductions
                preview.push({
                    employee_id: employeeId,
                    employee_name: employee.full_name,
                    basic_salary: financeData.basic_salary,
                    hra: financeData.hra,
                    allowances: financeData.allowances,
                    total_working_days: totalWorkingDays,
                    present_days: presentDays,
                    leave_days: leaveDays,
                    lop_days: lopDays,
                    lop_amount: lopAmount,
                    additional_deductions: 0, // User input
                    net_salary: calculateNetSalary(
                        financeData.basic_salary,
                        financeData.hra,
                        financeData.allowances,
                        0,
                        lopAmount
                    )
                });
            } catch (error) {
                console.error(`Error calculating for ${employee.full_name}:`, error);
                warnings.push(`${employee.full_name}: ${error.message}`);
            }
        }

        if (preview.length === 0) {
            setError(warnings.join('\n') || 'No valid employees to process. Please check salary data.');
            setCalculating(false);
            return;
        }

        if (warnings.length > 0) {
            setError('⚠️ Warnings:\n' + warnings.join('\n'));
        }

        setPayrollPreview(preview);
        setShowPreview(true);
        setCalculating(false);
    };

    const handleDeductionChange = (employeeId, value) => {
        setPayrollPreview(prev => prev.map(item => {
            if (item.employee_id === employeeId) {
                const additionalDeductions = parseFloat(value) || 0;
                return {
                    ...item,
                    additional_deductions: additionalDeductions,
                    net_salary: calculateNetSalary(
                        item.basic_salary,
                        item.hra,
                        item.allowances,
                        additionalDeductions,
                        item.lop_amount
                    )
                };
            }
            return item;
        }));
    };

    const handleLopDaysChange = (employeeId, value) => {
        setPayrollPreview(prev => prev.map(item => {
            if (item.employee_id === employeeId) {
                const lopDays = Math.max(0, parseFloat(value) || 0);
                const lopAmount = calculateLOPAmount(item.basic_salary, item.total_working_days, lopDays);

                return {
                    ...item,
                    lop_days: lopDays,
                    lop_amount: lopAmount,
                    net_salary: calculateNetSalary(
                        item.basic_salary,
                        item.hra,
                        item.allowances,
                        item.additional_deductions,
                        lopAmount
                    )
                };
            }
            return item;
        }));
    };

    const handleGeneratePayroll = async () => {
        if (payrollPreview.length === 0) {
            setError('Please calculate preview first');
            return;
        }

        setLoading(true);
        setError('');
        setProgress({ current: 0, total: payrollPreview.length });

        const monthYear = formatMonthYear(parseInt(selectedMonth), selectedYear);
        let successCount = 0;
        const failures = [];

        // Get current user
        const { data: { user } } = await supabase.auth.getUser();

        for (let i = 0; i < payrollPreview.length; i++) {
            const item = payrollPreview[i];
            setProgress({ current: i + 1, total: payrollPreview.length });

            try {
                const { error } = await supabase
                    .from('payroll')
                    .insert({
                        employee_id: item.employee_id,
                        month: monthYear,
                        basic_salary: item.basic_salary,
                        hra: item.hra,
                        allowances: item.allowances,
                        deductions: item.additional_deductions,
                        lop_days: item.lop_days,
                        net_salary: item.net_salary,
                        generated_by: user?.id,
                        status: 'generated'
                    });

                if (error) throw error;

                // Send Payslip Notification
                const notificationMessage = `Your payslip for ${monthYear} has been generated.`;
                await supabase.from('notifications').insert({
                    receiver_id: item.employee_id,
                    sender_id: user?.id,
                    sender_name: 'Finance Department',
                    message: notificationMessage,
                    type: 'payslip',
                    is_read: false,
                    created_at: new Date().toISOString()
                });

                successCount++;
            } catch (error) {
                console.error(`Error generating payroll for ${item.employee_name}:`, error);
                failures.push(`${item.employee_name}: ${error.message}`);
            }
        }

        setLoading(false);
        setProgress({ current: 0, total: 0 });

        const message = `Successfully generated payroll for ${successCount} out of ${payrollPreview.length} employee(s)`
            + (failures.length > 0 ? `\n\nFailed:\n${failures.join('\n')}` : '');

        if (onSuccess) {
            onSuccess(message);
        }

        if (successCount > 0) {
            handleClose();
        } else {
            setError('Failed to generate any payroll records:\n' + failures.join('\n'));
        }
    };

    const handleClose = () => {
        resetForm();
        onClose();
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

    if (!isOpen) return null;

    return (
        <div className="payslip-modal-overlay" onClick={handleClose}>
            <div
                className="payslip-modal-content"
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: showPreview ? '1200px' : '900px' }}
            >
                {/* Header */}
                <div className="payslip-modal-header">
                    <h2><FileText size={24} /> Generate Payroll</h2>
                    <button onClick={handleClose} className="close-btn">
                        <X size={24} />
                    </button>
                </div>

                {/* Error Alert */}
                {error && (
                    <div className="alert alert-error" style={{
                        whiteSpace: 'pre-line',
                        backgroundColor: '#fee2e2',
                        color: '#991b1b',
                        padding: '12px',
                        borderRadius: '8px',
                        marginBottom: '16px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px'
                    }}>
                        <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <span>{error}</span>
                    </div>
                )}

                {/* Progress Indicator */}
                {loading && progress.total > 0 && (
                    <div style={{
                        padding: '12px',
                        backgroundColor: '#eff6ff',
                        borderRadius: '8px',
                        marginBottom: '16px'
                    }}>
                        <p style={{ marginBottom: '8px', fontWeight: 600, color: '#1e40af' }}>
                            Generating payroll... ({progress.current} of {progress.total})
                        </p>
                        <div style={{
                            width: '100%',
                            height: '8px',
                            backgroundColor: '#dbeafe',
                            borderRadius: '4px',
                            overflow: 'hidden'
                        }}>
                            <div style={{
                                width: `${(progress.current / progress.total) * 100}%`,
                                height: '100%',
                                backgroundColor: '#3b82f6',
                                transition: 'width 0.3s'
                            }} />
                        </div>
                    </div>
                )}

                {/* Form */}
                {!showPreview ? (
                    <form onSubmit={(e) => { e.preventDefault(); handleCalculatePreview(); }} className="payslip-form">
                        <div className="form-grid">
                            {/* Left Column - Employee Selection */}
                            <div className="form-column">
                                <div className="form-group">
                                    <label>Select Employees *</label>

                                    {/* Select All Checkbox */}
                                    <div
                                        onClick={handleSelectAll}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            padding: '12px',
                                            backgroundColor: '#f3f4f6',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            marginBottom: '12px',
                                            border: '2px solid #7c3aed'
                                        }}
                                    >
                                        {selectAll ? <CheckSquare size={20} color="#7c3aed" /> : <Square size={20} color="#6b7280" />}
                                        <span style={{ fontWeight: 600, color: '#1f2937' }}>
                                            Select All ({employees.length} employees)
                                        </span>
                                    </div>

                                    {/* Employee List */}
                                    <div style={{
                                        maxHeight: '300px',
                                        overflowY: 'auto',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '8px',
                                        padding: '8px'
                                    }}>
                                        {employees.map(emp => (
                                            <div
                                                key={emp.id}
                                                onClick={() => handleEmployeeToggle(emp.id)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    padding: '10px',
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    backgroundColor: selectedEmployees.includes(emp.id) ? '#f5f3ff' : 'transparent',
                                                    border: selectedEmployees.includes(emp.id) ? '1px solid #7c3aed' : '1px solid transparent',
                                                    marginBottom: '4px',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                {selectedEmployees.includes(emp.id) ?
                                                    <CheckSquare size={18} color="#7c3aed" /> :
                                                    <Square size={18} color="#9ca3af" />
                                                }
                                                <div style={{ flex: 1 }}>
                                                    <p style={{ fontWeight: 600, marginBottom: '2px' }}>{emp.full_name}</p>
                                                    <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{emp.email}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    <p style={{
                                        marginTop: '8px',
                                        fontSize: '0.875rem',
                                        color: '#7c3aed',
                                        fontWeight: 600
                                    }}>
                                        {selectedEmployees.length} employee(s) selected
                                    </p>
                                </div>
                            </div>

                            {/* Right Column - Month/Year Selection */}
                            <div className="form-column">
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

                                <div style={{
                                    marginTop: '20px',
                                    padding: '16px',
                                    backgroundColor: '#eff6ff',
                                    borderRadius: '12px',
                                    border: '1px solid #bfdbfe'
                                }}>
                                    <h4 style={{ marginBottom: '12px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Calculator size={18} />
                                        How Payroll is Calculated
                                    </h4>
                                    <ul style={{ fontSize: '0.875rem', color: '#1e40af', lineHeight: '1.8', paddingLeft: '20px' }}>
                                        <li>Working Days = Calendar days in month</li>
                                        <li>Present Days = Attendance records</li>
                                        <li>Paid Leave Days = (Casual + Sick + Vacation) ≤ Quota</li>
                                        <li>LOP Days = Working - (Present + Paid Leave Days)</li>
                                        <li>LOP Amount = (Basic ÷ Working) × LOP Days</li>
                                        <li>Net = (Basic + HRA + Allowances) - (LOP + Deductions)</li>
                                    </ul>
                                </div>
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="modal-footer">
                            <button
                                type="button"
                                onClick={handleClose}
                                className="btn btn-secondary"
                                disabled={calculating}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                disabled={calculating || selectedEmployees.length === 0 || !selectedMonth}
                            >
                                <Calculator size={18} />
                                {calculating ? 'Calculating...' : `Calculate Preview (${selectedEmployees.length})`}
                            </button>
                        </div>
                    </form>
                ) : (
                    // Preview Table
                    <div>
                        <div style={{
                            backgroundColor: '#f9fafb',
                            padding: '12px 16px',
                            borderRadius: '8px',
                            marginBottom: '16px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div>
                                <p style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                                    Payroll Preview - {formatMonthYear(parseInt(selectedMonth), selectedYear)}
                                </p>
                                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '4px' }}>
                                    Review calculations and enter additional deductions before generating
                                </p>
                            </div>
                            <button
                                onClick={() => setShowPreview(false)}
                                className="btn btn-secondary"
                                style={{ fontSize: '0.875rem' }}
                            >
                                ← Back to Selection
                            </button>
                        </div>

                        <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
                            <table style={{
                                width: '100%',
                                borderCollapse: 'collapse',
                                fontSize: '0.875rem'
                            }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
                                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>Employee</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Basic</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>HRA</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Allow.</th>
                                        <th style={{ padding: '12px', textAlign: 'center' }}>Work Days</th>
                                        <th style={{ padding: '12px', textAlign: 'center' }}>Present</th>
                                        <th style={{ padding: '12px', textAlign: 'center' }}>Leave</th>
                                        <th style={{ padding: '12px', textAlign: 'center' }}>LOP Days</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>LOP Amt.</th>
                                        <th style={{ padding: '12px', textAlign: 'right' }}>Add. Deduct.</th>
                                        <th style={{ padding: '12px', textAlign: 'right', fontWeight: 700 }}>Net Salary</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payrollPreview.map((row, index) => (
                                        <tr key={row.employee_id} style={{
                                            borderBottom: '1px solid #e5e7eb',
                                            backgroundColor: index % 2 === 0 ? 'white' : '#f9fafb'
                                        }}>
                                            <td style={{ padding: '12px', fontWeight: 600 }}>{row.employee_name}</td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>₹{row.basic_salary?.toLocaleString()}</td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>₹{row.hra?.toLocaleString()}</td>
                                            <td style={{ padding: '12px', textAlign: 'right' }}>₹{row.allowances?.toLocaleString()}</td>
                                            <td style={{ padding: '12px', textAlign: 'center' }}>{row.total_working_days}</td>
                                            <td style={{ padding: '12px', textAlign: 'center', color: '#059669', fontWeight: 600 }}>{row.present_days}</td>
                                            <td style={{ padding: '12px', textAlign: 'center', color: '#2563eb' }}>{row.leave_days}</td>
                                            <td style={{ padding: '12px' }}>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="0.5"
                                                    value={row.lop_days}
                                                    onChange={(e) => handleLopDaysChange(row.employee_id, e.target.value)}
                                                    style={{
                                                        width: '70px',
                                                        padding: '6px 8px',
                                                        border: '1px solid #d1d5db',
                                                        borderRadius: '6px',
                                                        textAlign: 'center',
                                                        color: row.lop_days > 0 ? '#dc2626' : '#374151',
                                                        fontWeight: row.lop_days > 0 ? 600 : 400
                                                    }}
                                                />
                                            </td>
                                            <td style={{ padding: '12px', textAlign: 'right', color: '#dc2626' }}>
                                                ₹{row.lop_amount?.toLocaleString()}
                                            </td>
                                            <td style={{ padding: '12px' }}>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={row.additional_deductions}
                                                    onChange={(e) => handleDeductionChange(row.employee_id, e.target.value)}
                                                    style={{
                                                        width: '100px',
                                                        padding: '6px 8px',
                                                        border: '1px solid #d1d5db',
                                                        borderRadius: '6px',
                                                        textAlign: 'right'
                                                    }}
                                                />
                                            </td>
                                            <td style={{
                                                padding: '12px',
                                                textAlign: 'right',
                                                fontWeight: 700,
                                                fontSize: '1rem',
                                                color: '#059669'
                                            }}>
                                                ₹{row.net_salary?.toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Generate Footer */}
                        <div className="modal-footer">
                            <button
                                type="button"
                                onClick={() => setShowPreview(false)}
                                className="btn btn-secondary"
                                disabled={loading}
                            >
                                Back
                            </button>
                            <button
                                type="button"
                                onClick={handleGeneratePayroll}
                                className="btn btn-primary"
                                disabled={loading}
                                style={{ backgroundColor: '#059669' }}
                            >
                                <FileText size={18} />
                                {loading ? `Generating... (${progress.current}/${progress.total})` : `Generate Payroll (${payrollPreview.length})`}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PayrollFormModal;
