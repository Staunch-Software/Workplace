import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MessageSquare, ChevronDown, ChevronUp, Trash2, Edit, CheckCircle,
  Filter, RotateCcw, Send, Paperclip, Search, UserCircle
} from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { blobUploadService } from '@drs/services/blobUploadService';
import { generateId } from '@drs/services/idGenerator';
import { useAuth } from '@/context/AuthContext';
import AttachmentLink from '@drs/components/shared/AttachmentLink';
import './Vessel.css';
import CloseDefectModal from './CloseDefectModal';

const systemMessageStyle = {
  display: 'flex',
  justifyContent: 'center',
  margin: '15px 0',
  width: '100%'
};

const systemPillStyle = {
  backgroundColor: '#f1f5f9',
  border: '1px solid #e2e8f0',
  color: '#64748b',
  fontSize: '11px',
  fontWeight: '600',
  padding: '4px 12px',
  borderRadius: '12px',
  textAlign: 'center',
  textTransform: 'uppercase',
  letterSpacing: '0.5px'
};

// --- UPDATED THREAD SECTION WITH MENTION LOGIC ---
const ThreadSection = ({ defectId, defectStatus }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);

  // Mention State
  const [mentionList, setMentionList] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [taggedUsers, setTaggedUsers] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);

  // 1. Fetch Threads
  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['threads', defectId],
    queryFn: () => defectApi.getThreads(defectId),
    enabled: !!defectId
  });

  // 2. Fetch Real Users for Mentions
  const { data: vesselUsers = [] } = useQuery({
    queryKey: ['vessel-users-thread', defectId],
    queryFn: async () => {
      try {
        const users = await defectApi.getVesselUsers(defectId);
        return users.map(u => ({
          id: u.id,
          name: u.full_name || u.name || "Unknown",
          role: u.role || 'Staff'
        }));
      } catch (e) {
        return [];
      }
    },
    enabled: !!defectId
  });

  // 3. Handle Text Change
  const handleTextChange = (e) => {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;
    setReplyText(text);
    setCursorPosition(cursorPos);

    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && (lastAtIndex === 0 || text[lastAtIndex - 1] === ' ')) {
      const searchTerm = textBeforeCursor.slice(lastAtIndex + 1);
      
      const filtered = vesselUsers.filter(u =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      setMentionList(filtered);
      setShowMentions(filtered.length > 0);
    } else {
      setShowMentions(false);
    }
  };

  // 4. Select Mention
  const selectMention = (u) => {
    const textBeforeCursor = replyText.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = replyText.slice(cursorPosition);
    
    const newText = replyText.slice(0, lastAtIndex) + `@${u.name} ` + textAfterCursor;
    setReplyText(newText);
    
    if (!taggedUsers.includes(u.id)) {
      setTaggedUsers([...taggedUsers, u.id]);
    }
    setShowMentions(false);
  };

  const handleReply = async () => {
    if (!replyText && files.length === 0) return;
    setIsUploading(true);
    try {
      const threadId = generateId();
      const uploadedAttachments = [];
      for (const file of files) {
        const path = await blobUploadService.uploadBinary(file, defectId, generateId());
        uploadedAttachments.push({ id: generateId(), thread_id: threadId, file_name: file.name, file_size: file.size, content_type: file.type, blob_path: path });
      }
      
      await defectApi.createThread({ 
        id: threadId, 
        defect_id: defectId, 
        author: user?.job_title || "Crew", 
        body: replyText,
        tagged_user_ids: taggedUsers // ✅ Sends tags
      });
      
      for (const meta of uploadedAttachments) await defectApi.createAttachment(meta);

      setReplyText(""); setFiles([]); setTaggedUsers([]);
      queryClient.invalidateQueries(['threads', defectId]);
    } catch (err) { alert("Failed: " + err.message); }
    finally { setIsUploading(false); }
  };

  if (isLoading) return <div style={{ padding: '20px', color: '#64748b' }}>Loading chat...</div>;

  return (
    <div className="thread-section-wrapper" style={{ padding: '20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
      <div className="thread-history" style={{ marginBottom: '20px' }}>
        {threads.length === 0 ? <p style={{ textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>No messages.</p> :
          threads.map(t => {
            if (t.is_system_message) {
              return (
                <div key={t.id} style={systemMessageStyle}>
                  <span style={systemPillStyle}>
                    {t.body} • {new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            }

            const isMy = t.user_id === user?.id;
            return (
              <div key={t.id} style={{ display: 'flex', justifyContent: isMy ? 'flex-end' : 'flex-start', marginBottom: '15px' }}>
                <div style={{ maxWidth: '70%', padding: '12px', background: isMy ? '#dcf8c6' : 'white', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '13px', color: isMy ? '#065f46' : '#1e293b' }}>{t.author}</strong>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                  <p style={{ fontSize: '14px', margin: 0, color: '#334155' }}>{t.body}</p>
                  {t.attachments?.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {t.attachments.map(a => <AttachmentLink key={a.id} attachment={a} />)}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        }
      </div>

      {defectStatus !== 'CLOSED' ? (
        <div className="reply-box" style={{ display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative' }}>
          <textarea
            className="input-field"
            placeholder="Type a reply (type @ to mention)..."
            value={replyText}
            onChange={handleTextChange}
            style={{ width: '100%', minHeight: '80px' }}
          />

          {showMentions && (
            <div style={{ 
              position: 'absolute', 
              bottom: '90px', 
              left: '0', 
              background: 'white', 
              border: '1px solid #e2e8f0', 
              borderRadius: '8px', 
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)', 
              maxHeight: '180px', 
              overflowY: 'auto', 
              zIndex: 100, 
              width: '250px' 
            }}>
              {mentionList.map(u => (
                <div 
                  key={u.id} 
                  onClick={() => selectMention(u)} 
                  style={{ 
                    padding: '10px', 
                    cursor: 'pointer', 
                    borderBottom: '1px solid #f1f5f9', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '10px' 
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                   <UserCircle size={16} color="#64748b" />
                   <div style={{display:'flex', flexDirection:'column'}}>
                     <span style={{ fontSize: '13px', fontWeight: '500', color: '#334155' }}>{u.name}</span>
                     <span style={{ fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' }}>{u.role}</span>
                   </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: '#64748b' }}>
              <Paperclip size={16} /> <input type="file" multiple hidden onChange={e => setFiles(Array.from(e.target.files))} />
              {files.length > 0 ? `${files.length} files attached` : 'Attach Files'}
            </label>
            <button className="btn-primary" onClick={handleReply} disabled={isUploading}>
              <Send size={16} /> Send Reply
            </button>
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '15px', background: '#f1f5f9', borderRadius: '8px', color: '#64748b', fontSize: '13px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
          <CheckCircle size={16} /> This defect is closed. Thread is view-only.
        </div>
      )}
    </div>
  );
};

const VesselHistory = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const vesselImo = user?.assignedVessels?.[0] || '';

  const [expandedRow, setExpandedRow] = useState(null);
  const [openThreadRow, setOpenThreadRow] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [defectToClose, setDefectToClose] = useState(null);

  const { data: defects = [], isLoading } = useQuery({
    queryKey: ['defects', vesselImo],
    queryFn: () => defectApi.getDefects(vesselImo),
    enabled: !!vesselImo
  });

  useEffect(() => {
    const urlDefectId = searchParams.get('highlightDefectId');
    const stateDefectId = location.state?.autoOpenDefectId;
    const targetId = urlDefectId || stateDefectId;

    if (targetId && defects.length > 0) {
      const targetDefect = defects.find(d => d.id === targetId);

      if (targetDefect) {
        setStatusFilter('All');
        setPriorityFilter('All');
        setOpenThreadRow(targetId);
        setExpandedRow(null);
        setHighlightedId(targetId);

        setTimeout(() => {
          const element = document.getElementById(`row-${targetId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 500);

        setTimeout(() => setHighlightedId(null), 3000);
      }
    }
  }, [defects, searchParams, location.state]);

  const filteredDefects = defects.filter(defect => {
    const isNotClosed = defect.status !== 'CLOSED';
    const matchStatus = statusFilter === 'All' || defect.status === statusFilter.toUpperCase().replace(' ', '_');
    const matchPriority = priorityFilter === 'All' || defect.priority === priorityFilter.toUpperCase();
    const matchSearch = searchQuery === '' ||
      defect.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      defect.equipment_name?.toLowerCase().includes(searchQuery.toLowerCase());

    return isNotClosed && matchStatus && matchPriority && matchSearch;
  });

  const toggleExpand = (id) => { setExpandedRow(expandedRow === id ? null : id); setOpenThreadRow(null); };
  const toggleThread = (id) => { setOpenThreadRow(openThreadRow === id ? null : id); setExpandedRow(null); };
  const handleEdit = (defect) => navigate('/drs/vessel/create', { state: { defectToEdit: defect } });

  const handleRemove = async (id) => {
    if (window.confirm("Are you sure you want to REMOVE this defect?")) {
      await defectApi.removeDefect(id);
      queryClient.invalidateQueries(['defects', vesselImo]);
    }
  };

  const getPRStatusClass = (status) => {
    const statusMap = {
      'Delivered': 'normal',
      'Closed': 'normal',
      'Ordered': 'medium',
      'In Transit': 'medium',
      'Approved': 'high',
      'Pending': 'high',
      'Not Required': 'normal'
    };
    return statusMap[status] || 'normal';
  };

  if (isLoading) return <div className="dashboard-container">Loading History...</div>;

  return (
    <div className="dashboard-container">
      <h1 className="page-title">Defect History</h1>

      <div className="section-header-with-filters">
        <h3>Total Records ({filteredDefects.length})</h3>
        <div className="filter-controls">
          <div className="v-search-box" style={{ background: 'white', border: '1px solid #cbd5e1', display: 'flex', alignItems: 'center', padding: '0 10px', borderRadius: '6px', height: '36px' }}>
            <Search size={14} color="#64748b" style={{ marginRight: '8px' }} />
            <input
              type="text"
              placeholder="Search defects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ border: 'none', outline: 'none', fontSize: '13px', width: '150px', color: '#334155' }}
            />
          </div>

          <div className="filter-group">
            <Filter size={14} className="filter-icon" />
            <select className="filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
            </select>
          </div>
          <div className="filter-group">
            <select className="filter-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="All">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Normal">Normal</option>
            </select>
          </div>
          <button className="reset-btn" onClick={() => { setStatusFilter('All'); setPriorityFilter('All'); setSearchQuery(''); }}><RotateCcw size={14} /></button>
        </div>
      </div>

      <div className="table-card">
        <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: '8%' }}>ID</th>
              <th style={{ width: '14%' }}>Equipment</th>
              <th style={{ width: '18%' }}>Title</th>
              <th style={{ width: '10%' }}>Priority</th>
              <th style={{ width: '11%' }}>Status</th>
              <th style={{ width: '11%' }}>PR No.</th>
              <th style={{ width: '13%' }}>PR Status</th>
              <th style={{ width: '7%', textAlign: 'center' }}>Thread</th>
              <th style={{ width: '8%', textAlign: 'center' }}>Expand</th>
            </tr>
          </thead>
          <tbody>
            {filteredDefects.length > 0 ? filteredDefects.map((defect) => (
              <React.Fragment key={defect.id}>
                <tr
                  id={`row-${defect.id}`}
                  className={expandedRow === defect.id ? 'expanded-active' : ''}
                  style={{
                    backgroundColor: highlightedId === defect.id ? '#fef9c3' : 'inherit',
                    transition: 'background-color 0.5s ease'
                  }}
                >
                  <td className="id-cell" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {defect.id.substring(0, 8)}
                  </td>
                  <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {defect.equipment_name}
                  </td>
                  <td className="title-cell" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {defect.title}
                  </td>
                  <td>
                    <span className={`badge badge-${defect.priority.toLowerCase()}`}>{defect.priority}</span>
                  </td>
                  <td>
                    <span className={`status-dot ${defect.status.toLowerCase().replace('_', '-')}`}></span>
                    {defect.status.replace('_', ' ')}
                  </td>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#64748b' }}>
                      {defect.pr_number || '—'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${getPRStatusClass(defect.pr_status)}`}>
                      {defect.pr_status || 'Not Set'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="thread-btn" onClick={(e) => { e.stopPropagation(); toggleThread(defect.id); }}>
                      <MessageSquare size={16} />
                    </button>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button className="action-btn" onClick={() => toggleExpand(defect.id)}>
                      {expandedRow === defect.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                  </td>
                </tr>

                {expandedRow === defect.id && (
                  <tr className="detail-row"><td colSpan="9">
                    <div className="detail-content">
                      <div className="detail-grid" style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div>
                          <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Description:</strong>
                          <p style={{ fontSize: '14px', margin: 0 }}>{defect.description}</p>
                        </div>
                        <div>
                          <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Remarks:</strong>
                          <p style={{ fontSize: '14px', margin: 0 }}>{defect.ships_remarks || 'None'}</p>
                        </div>
                        <div>
                          <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Responsibility:</strong>
                          <p style={{ fontSize: '14px', margin: 0 }}>{defect.responsibility}</p>
                        </div>
                        <div>
                          <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '4px' }}>Date:</strong>
                          <p style={{ fontSize: '14px', margin: 0 }}>{new Date(defect.date_identified).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="detail-actions" style={{ padding: '20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px' }}>
                        {defect.status !== 'CLOSED' && (
                          <button className="btn-action edit" onClick={() => handleEdit(defect)}><Edit size={16} /> Update</button>
                        )}
                        {defect.status !== 'CLOSED' && (
                          <button
                            className="btn-action close-task"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDefectToClose(defect);
                            }}
                          >
                            <CheckCircle size={16} /> Close Defect
                          </button>
                        )}
                        <button className="btn-action delete" onClick={() => handleRemove(defect.id)}><Trash2 size={16} /> Remove</button>
                      </div>
                    </div>
                  </td></tr>
                )}

                {openThreadRow === defect.id && (
                  <tr className="detail-row"><td colSpan="9">
                    <div className="detail-content">
                      <ThreadSection defectId={defect.id} defectStatus={defect.status} />
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            )) : (
              <tr><td colSpan="9" style={{ textAlign: 'center', padding: '30px', color: '#64748b' }}>No records found matching your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {defectToClose && (
        <CloseDefectModal
          defect={defectToClose}
          onClose={() => setDefectToClose(null)}
          onSuccess={() => {
            alert("✅ Defect Closed Successfully!");
            setDefectToClose(null);
            queryClient.invalidateQueries(['defects', vesselImo]);
            queryClient.invalidateQueries(['threads', defectToClose.id]);
          }}
        />
      )}
    </div>
  );
};

export default VesselHistory;