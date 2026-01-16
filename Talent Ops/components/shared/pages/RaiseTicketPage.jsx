import React, { useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
    Ticket,
    Send,
    AlertCircle,
    CheckCircle2,
    Paperclip,
    X,
    Loader2,
    Lightbulb,
    Bug,
    List,
    Filter,
    Clock,
    ArrowLeft
} from 'lucide-react';

const RaiseTicketPage = () => {
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [files, setFiles] = useState([]);
    const [ticketType, setTicketType] = useState('issue'); // 'issue' or 'enhancement'
    const [viewMode, setViewMode] = useState('create'); // 'create' or 'list'
    const [tickets, setTickets] = useState([]);
    const [fetchLoading, setFetchLoading] = useState(false);
    const [filterType, setFilterType] = useState('all'); // 'all', 'issue', 'enhancement'

    const [formData, setFormData] = useState({
        subject: '',
        category: 'it_support',
        description: ''
    });

    const issueCategories = [
        { value: 'it_support', label: 'IT Support' },
        { value: 'hr_support', label: 'HR Support' },
        { value: 'operations', label: 'Operations' },
        { value: 'finance', label: 'Finance' },
        { value: 'facilities', label: 'Facilities' },
        { value: 'other', label: 'Other' }
    ];

    const enhancementCategories = [
        { value: 'feature_request', label: 'New Feature' },
        { value: 'ux_improvement', label: 'UX/UI Improvement' },
        { value: 'process_opt', label: 'Process Optimization' },
        { value: 'new_tool', label: 'New Tool Request' },
        { value: 'other', label: 'Other' }
    ];



    const handleFileChange = (e) => {
        if (e.target.files) {
            setFiles([...files, ...Array.from(e.target.files)]);
        }
    };

    const removeFile = (index) => {
        setFiles(files.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { data: { user } } = await supabase.auth.getUser();

            if (!user) {
                alert('You must be logged in to submit a ticket.');
                setLoading(false);
                return;
            }

            // Upload files to Supabase Storage
            const uploadedUrls = [];

            if (files.length > 0) {
                for (const file of files) {
                    try {
                        // Create a unique file path: user_id/timestamp_filename
                        const fileExt = file.name.split('.').pop();
                        // Clean filename to remove special chars
                        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.]/g, '_');
                        const filePath = `${user.id}/${Date.now()}_${cleanFileName}`;

                        const { error: uploadError } = await supabase.storage
                            .from('ticket-attachments')
                            .upload(filePath, file);

                        if (uploadError) throw uploadError;

                        const { data: { publicUrl } } = supabase.storage
                            .from('ticket-attachments')
                            .getPublicUrl(filePath);

                        uploadedUrls.push(publicUrl);
                    } catch (uploadError) {
                        console.error('Error uploading file:', uploadError);
                        // Continue ensuring ticket is created even if one file fails? 
                        // Or throw to stop? Let's throw for now to ensure data integrity.
                        throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
                    }
                }
            }

            const payload = {
                user_id: user.id,
                type: ticketType, // 'issue' or 'enhancement'
                category: formData.category,
                subject: formData.subject,
                description: formData.description,
                status: ticketType === 'issue' ? 'open' : 'proposed',
                attachments: uploadedUrls
            };

            const { error } = await supabase
                .from('tickets')
                .insert([payload]);

            if (error) throw error;

            console.log('Ticket Submitted:', payload);
            setSuccess(true);
            setFormData({
                subject: '',
                category: ticketType === 'issue' ? 'it_support' : 'feature_request',
                description: ''
            });
            setFiles([]);

            // Reset success message after 3 seconds
            setTimeout(() => setSuccess(false), 3000);

        } catch (error) {
            console.error('Error submitting ticket:', error);
            alert(`Failed to submit ticket: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const toggleTicketType = (type) => {
        setTicketType(type);
        setFormData(prev => ({
            ...prev,
            category: type === 'issue' ? 'it_support' : 'feature_request'
        }));
    };

    // Fetch tickets when entering list view
    React.useEffect(() => {
        if (viewMode === 'list') {
            fetchTickets();
        }
    }, [viewMode]);

    const fetchTickets = async () => {
        setFetchLoading(true);
        try {
            const { data, error } = await supabase
                .from('tickets')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTickets(data || []);
        } catch (error) {
            console.error('Error fetching tickets:', error);
        } finally {
            setFetchLoading(false);
        }
    };

    const handleCloseTicket = async (ticketId) => {
        if (!confirm('Are you sure you want to close this ticket?')) return;

        // Optimistic Update: Update UI immediately
        const previousTickets = [...tickets];
        setTickets(tickets.map(t => t.id === ticketId ? { ...t, status: 'closed' } : t));

        try {
            const { error } = await supabase
                .from('tickets')
                .update({ status: 'closed' })
                .eq('id', ticketId);

            if (error) throw error;

            // Success notification (optional)
            // alert('Ticket closed successfully');

            // Re-fetch to ensure sync
            fetchTickets();
        } catch (error) {
            console.error('Error closing ticket:', error);
            alert(`Failed to close ticket: ${error.message}`);
            // Rollback optimistic update on error
            setTickets(previousTickets);
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'open': return 'bg-blue-100 text-blue-700';
            case 'in_progress': return 'bg-yellow-100 text-yellow-700';
            case 'resolved': return 'bg-green-100 text-green-700';
            case 'closed': return 'bg-slate-100 text-slate-700';
            case 'proposed': return 'bg-purple-100 text-purple-700';
            default: return 'bg-slate-100 text-slate-700';
        }
    };

    const filteredTickets = tickets.filter(t => {
        if (filterType === 'all') return true;
        return t.type === filterType;
    });

    return (
        <div className="p-6 max-w-4xl mx-auto">
            {/* Header with View Switcher */}
            <div className="flex justify-between items-start mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-indigo-100' : (ticketType === 'issue' ? 'bg-red-100' : 'bg-purple-100')}`}>
                            {viewMode === 'list' ? (
                                <List className="w-6 h-6 text-indigo-600" />
                            ) : ticketType === 'issue' ? (
                                <Bug className={`w-6 h-6 ${ticketType === 'issue' ? 'text-red-600' : 'text-purple-600'}`} />
                            ) : (
                                <Lightbulb className="w-6 h-6 text-purple-600" />
                            )}
                        </div>
                        {viewMode === 'list' ? 'Ticket History' : (ticketType === 'issue' ? 'Report an Issue' : 'Propose Enhancement')}
                    </h1>
                    <p className="text-slate-500 mt-2 ml-12">
                        {viewMode === 'list'
                            ? "View and track the status of your submitted tickets."
                            : (ticketType === 'issue'
                                ? "Submit a support request for bugs, errors, or operational issues."
                                : "Have an idea? Suggest improvements or new features for the platform.")}
                    </p>
                </div>

                <button
                    onClick={() => setViewMode(viewMode === 'create' ? 'list' : 'create')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${viewMode === 'create'
                        ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        : 'bg-indigo-600 text-white shadow-sm hover:bg-indigo-700'
                        }`}
                >
                    {viewMode === 'create' ? (
                        <>
                            <List className="w-4 h-4" />
                            View All Tickets
                        </>
                    ) : (
                        <>
                            <ArrowLeft className="w-4 h-4" />
                            Raise New Ticket
                        </>
                    )}
                </button>
            </div>

            {viewMode === 'list' ? (
                // LIST VIEW
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                    {/* Filters */}
                    <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit">
                        {['all', 'issue', 'enhancement'].map((type) => (
                            <button
                                key={type}
                                onClick={() => setFilterType(type)}
                                className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-all ${filterType === type
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                {type.replace('_', ' ')}s
                            </button>
                        ))}
                    </div>

                    {/* Tickets List */}
                    {fetchLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                        </div>
                    ) : filteredTickets.length > 0 ? (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="divide-y divide-slate-100">
                                {filteredTickets.map((ticket) => (
                                    <div key={ticket.id} className="p-6 hover:bg-slate-50 transition-colors">
                                        <div className="flex justify-between items-start gap-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-3">
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${ticket.type === 'issue' ? 'bg-red-50 text-red-600' : 'bg-purple-50 text-purple-600'
                                                        }`}>
                                                        {ticket.type}
                                                    </span>
                                                    <h3 className="font-semibold text-slate-800">{ticket.subject}</h3>
                                                </div>
                                                <p className="text-slate-600 text-sm line-clamp-2">{ticket.description}</p>
                                                <div className="flex items-center gap-4 text-xs text-slate-400 mt-2">
                                                    <span className="flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {new Date(ticket.created_at).toLocaleDateString()}
                                                    </span>
                                                    <span className="capitalize px-2 py-0.5 bg-slate-100 rounded text-slate-500">
                                                        {ticket.category.replace('_', ' ')}
                                                    </span>
                                                </div>

                                                {/* Attachments Display */}
                                                {ticket.attachments && ticket.attachments.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mt-3">
                                                        {ticket.attachments.map((url, idx) => {
                                                            // Extract filename from URL (assumes standard structure)
                                                            // URL format often includes /storage/v1/object/public/bucket/path...
                                                            // We just want the last part after the last slash
                                                            const fileName = decodeURIComponent(url.split('/').pop().split('_').slice(1).join('_') || 'attachment');

                                                            return (
                                                                <a
                                                                    key={idx}
                                                                    href={url}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-colors group"
                                                                >
                                                                    <Paperclip className="w-3 h-3 text-slate-400 group-hover:text-indigo-500" />
                                                                    <span className="truncate max-w-[150px]">{fileName}</span>
                                                                </a>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col items-end gap-2">
                                                <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize whitespace-nowrap ${getStatusColor(ticket.status)}`}>
                                                    {ticket.status.replace('_', ' ')}
                                                </span>
                                                {ticket.status !== 'closed' && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleCloseTicket(ticket.id);
                                                        }}
                                                        className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                                                    >
                                                        Close Ticket
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-200">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Ticket className="w-8 h-8 text-slate-300" />
                            </div>
                            <h3 className="text-lg font-medium text-slate-900">No tickets found</h3>
                            <p className="text-slate-500 max-w-sm mx-auto mt-2">
                                {filterType === 'all'
                                    ? "You haven't submitted any tickets yet."
                                    : `No ${filterType} tickets found.`}
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                // CREATE VIEW (Existing Code wrapped)
                <>
                    {/* Ticket Type Toggle */}
                    <div className="flex gap-4 mb-8 bg-slate-100 p-1.5 rounded-xl w-fit">
                        <button
                            onClick={() => toggleTicketType('issue')}
                            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${ticketType === 'issue'
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <Bug className="w-4 h-4" />
                            Raise Issue
                        </button>
                        <button
                            onClick={() => toggleTicketType('enhancement')}
                            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${ticketType === 'enhancement'
                                ? 'bg-white text-slate-800 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            <Lightbulb className="w-4 h-4" />
                            Enhancement
                        </button>
                    </div>

                    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-colors ${ticketType === 'issue' ? 'border-red-100' : 'border-purple-100'}`}>
                        <div className="p-6 md:p-8">
                            {success ? (
                                <div className="flex flex-col items-center justify-center py-12 text-center animate-in fade-in zoom-in duration-300">
                                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                                        <CheckCircle2 className="w-8 h-8 text-green-600" />
                                    </div>
                                    <h3 className="text-xl font-semibold text-slate-800 mb-2">
                                        {ticketType === 'issue' ? 'Issue Reported!' : 'Suggestion Received!'}
                                    </h3>
                                    <p className="text-slate-500 max-w-sm">
                                        Your {ticketType} has been recorded. Reference ID: #{Math.floor(Math.random() * 10000)}
                                    </p>
                                    <button
                                        onClick={() => setSuccess(false)}
                                        className="mt-6 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors font-medium"
                                    >
                                        Submit Another
                                    </button>
                                </div>
                            ) : (
                                <form onSubmit={handleSubmit} className="space-y-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2 col-span-2">
                                            <label className="text-sm font-medium text-slate-700">Category</label>
                                            <select
                                                value={formData.category}
                                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                            >
                                                {(ticketType === 'issue' ? issueCategories : enhancementCategories).map(cat => (
                                                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-700">Subject</label>
                                        <input
                                            type="text"
                                            required
                                            value={formData.subject}
                                            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                                            placeholder={ticketType === 'issue' ? "Brief summary of the issue" : "Title of your enhancement idea"}
                                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-700">Description</label>
                                        <textarea
                                            required
                                            rows="5"
                                            value={formData.description}
                                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                            placeholder={ticketType === 'issue' ? "Please describe the issue in detail..." : "Describe the enhancement and its benefits..."}
                                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all resize-none"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-700">Attachments</label>
                                        <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 transition-all hover:border-indigo-400 hover:bg-slate-50/50">
                                            <input
                                                type="file"
                                                multiple
                                                onChange={handleFileChange}
                                                className="hidden"
                                                id="file-upload"
                                            />
                                            <label
                                                htmlFor="file-upload"
                                                className="flex flex-col items-center justify-center cursor-pointer"
                                            >
                                                <div className="p-3 bg-indigo-50 rounded-full mb-3 text-indigo-600">
                                                    <Paperclip className="w-5 h-5" />
                                                </div>
                                                <span className="text-sm font-medium text-slate-700">Click to upload files</span>
                                                <span className="text-xs text-slate-500 mt-1">Images, PDF, or Documents (Max 10MB)</span>
                                            </label>
                                        </div>

                                        {files.length > 0 && (
                                            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {files.map((file, index) => (
                                                    <div key={index} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg group">
                                                        <div className="flex items-center gap-3 overflow-hidden">
                                                            <div className="min-w-[32px] w-8 h-8 bg-white rounded-md flex items-center justify-center border border-slate-200 text-slate-500 text-xs font-medium uppercase">
                                                                {file.name.split('.').pop()}
                                                            </div>
                                                            <span className="text-sm text-slate-700 truncate">{file.name}</span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeFile(index)}
                                                            className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors"
                                                        >
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="pt-4 flex items-center justify-end gap-4 border-t border-slate-100 mt-6">
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ subject: '', category: ticketType === 'issue' ? 'it_support' : 'feature_request', description: '' })}
                                            className="px-6 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-lg transition-colors"
                                        >
                                            Reset
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className={`flex items-center gap-2 px-6 py-2.5 text-white text-sm font-medium rounded-lg shadow-sm transition-all disabled:opacity-70 disabled:cursor-not-allowed ${ticketType === 'issue' ? 'bg-red-600 hover:bg-red-700 shadow-red-200' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'}`}
                                        >
                                            {loading ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Submitting...
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="w-4 h-4" />
                                                    Submit {ticketType === 'issue' ? 'Ticket' : 'Proposal'}
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default RaiseTicketPage;
