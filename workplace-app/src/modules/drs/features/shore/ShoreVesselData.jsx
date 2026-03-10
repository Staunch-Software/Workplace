import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import { createVessel, getVessels } from '@drs/api/vessels';
import { defectApi } from '@drs/services/defectApi';
import { blobUploadService } from '@drs/services/blobUploadService';
import { generateId } from '@drs/services/idGenerator';
import { useAuth } from '@/context/AuthContext';
import {
  MessageSquare, CheckCircle, Plus, X, Ship, Mail, Filter,
  Search, ChevronDown, ChevronUp, Check, Send, Paperclip, ShieldAlert,
  Edit2, Save
} from 'lucide-react';
import AttachmentLink from '@drs/components/shared/AttachmentLink';

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

const ThreadSection = ({ defectId, defectStatus }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [mentionList, setMentionList] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [taggedUsers, setTaggedUsers] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['threads', defectId],
    queryFn: () => defectApi.getThreads(defectId),
    enabled: !!defectId
  });

  const { data: vesselUsers = [] } = useQuery({
    queryKey: ['vessel-users', defectId],
    queryFn: () => defectApi.getVesselUsers(defectId),
    enabled: !!defectId
  });

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

  const selectMention = (user) => {
    const textBeforeCursor = replyText.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = replyText.slice(cursorPosition);
    const newText = replyText.slice(0, lastAtIndex) + `@${user.name} ` + textAfterCursor;
    setReplyText(newText);
    setTaggedUsers([...taggedUsers, user.id]);
    setShowMentions(false);
  };

  const handleReply = async () => {
    if (!replyText && files.length === 0) return;
    setIsUploading(true);

    try {
      const threadId = generateId();
      const uploadedAttachments = [];

      for (const file of files) {
        const attachmentId = generateId();
        const path = await blobUploadService.uploadBinary(file, defectId, attachmentId);
        uploadedAttachments.push({
          id: attachmentId,
          thread_id: threadId,
          file_name: file.name,
          file_size: file.size,
          content_type: file.type,
          blob_path: path
        });
      }

      await defectApi.createThread({
        id: threadId,
        defect_id: defectId,
        author: user?.job_title || "Superintendent",
        body: replyText,
        tagged_user_ids: taggedUsers
      });
      setTaggedUsers([]);

      for (const meta of uploadedAttachments) {
        await defectApi.createAttachment(meta);
      }

      setReplyText("");
      setFiles([]);
      queryClient.invalidateQueries(['threads', defectId]);
    } catch (err) {
      alert("Failed to send reply: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) return <div style={{ padding: '20px', color: '#64748b', fontSize: '13px' }}>Loading conversation...</div>;

  return (
    <div className="thread-expand-container" style={{ padding: '20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
      <div className="thread-history" style={{ marginBottom: '20px' }}>
        {threads.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No conversation history.</p>
        ) : (
          threads.map(t => {
            if (t.is_system_message) {
              return (
                <div key={t.id} style={systemMessageStyle}>
                  <span style={systemPillStyle}>
                    {t.body} • {new Date(t.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </span>
                </div>
              );
            }

            const isMyMessage = t.user_id === user?.id;
            return (
              <div key={t.id} style={{ display: 'flex', justifyContent: isMyMessage ? 'flex-end' : 'flex-start', marginBottom: '15px' }}>
                <div style={{ maxWidth: '70%', padding: '12px', background: isMyMessage ? '#dcf8c6' : 'white', borderRadius: isMyMessage ? '12px 12px 2px 12px' : '12px 12px 12px 2px', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <strong style={{ fontSize: '13px', color: isMyMessage ? '#065f46' : '#1e293b' }}>{t.author}</strong>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                  <p style={{ fontSize: '14px', color: '#334155', margin: '0' }}>{t.body}</p>
                  {t.attachments?.length > 0 && (
                    <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {t.attachments.map(a => (
                        <AttachmentLink key={a.id} attachment={a} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {defectStatus !== 'CLOSED' ? (
        <div className="reply-box" style={{ display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative' }}>
          <textarea
            className="input-field"
            placeholder="Type a reply (use @ to mention)..."
            value={replyText}
            onChange={handleTextChange}
            style={{ width: '100%', minHeight: '80px', marginBottom: '10px' }}
          />
          {showMentions && (
            <div style={{ position: 'absolute', bottom: '120px', left: '20px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: '200px', overflowY: 'auto', zIndex: 1000, minWidth: '200px' }}>
              {mentionList.map(u => (
                <div key={u.id} onClick={() => selectMention(u)} style={{ padding: '10px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f1f5f9' }}>
                  {u.name}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="file" multiple id={`file-reply-${defectId}`} onChange={(e) => setFiles(Array.from(e.target.files))} hidden />
              <label htmlFor={`file-reply-${defectId}`} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#64748b' }}>
                <Paperclip size={14} /> {files.length > 0 ? `${files.length} files` : 'Attach Files'}
              </label>
            </div>
            <button className="btn-primary" onClick={handleReply} disabled={isUploading || (!replyText && files.length === 0)}>
              <Send size={14} /> {isUploading ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '15px',
          background: '#f1f5f9',
          borderRadius: '8px',
          textAlign: 'center',
          color: '#64748b'
        }}>
          <p style={{ margin: 0, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <CheckCircle size={16} style={{ color: '#10b981' }} />
            This defect is closed. Thread is view-only.
          </p>
        </div>
      )}
    </div>
  );
};

const ShoreVesselData = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const dropdownRef = useRef(null);
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [vesselSearch, setVesselSearch] = useState('');
  const [selectedImos, setSelectedImos] = useState([]);
  const [expandedDefectId, setExpandedDefectId] = useState(null);
  const [openThreadRow, setOpenThreadRow] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);

  // Priority Modal States
  const [isPriorityModalOpen, setIsPriorityModalOpen] = useState(false);
  const [selectedDefectForPriority, setSelectedDefectForPriority] = useState(null);
  const [newPriority, setNewPriority] = useState('');
  const [isUpdatingPriority, setIsUpdatingPriority] = useState(false);

  // 🆕 PR EDITING STATES
  const [editingPR, setEditingPR] = useState(null);
  const [prNumber, setPrNumber] = useState('');
  const [prStatus, setPrStatus] = useState('');
  const [isSavingPR, setIsSavingPR] = useState(false);

  const { data: vesselList = [] } = useQuery({ queryKey: ['vessels'], queryFn: getVessels });
  const { data: allDefects = [], isLoading: isDefectsLoading } = useQuery({ 
    queryKey: ['defects', 'all'], 
    queryFn: () => defectApi.getDefects() 
  });

  useEffect(() => {
    if (vesselList.length > 0 && selectedImos.length === 0) {
      setSelectedImos(vesselList.map(v => v.imo_number));
    }
  }, [vesselList]);

  useEffect(() => {
    const urlDefectId = searchParams.get('highlightDefectId');
    const stateDefectId = location.state?.autoOpenDefectId;
    const targetId = urlDefectId || stateDefectId;

    if (targetId && allDefects.length > 0) {
      const targetDefect = allDefects.find(d => d.id === targetId);
      
      if (targetDefect) {
        if (!selectedImos.includes(targetDefect.vessel_imo)) {
          setSelectedImos(prev => [...prev, targetDefect.vessel_imo]);
        }
        setOpenThreadRow(targetId);
        setExpandedDefectId(null);
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
  }, [allDefects, searchParams, location.state]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setIsFilterOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleVessel = (imo) => {
    setSelectedImos(prev => prev.includes(imo) ? prev.filter(id => id !== imo) : [...prev, imo]);
  };

  const toggleSelectAll = () => {
    setSelectedImos(selectedImos.length === vesselList.length ? [] : vesselList.map(v => v.imo_number));
  };

  const toggleExpand = (id) => {
    setExpandedDefectId(expandedDefectId === id ? null : id);
    setOpenThreadRow(null); 
  };

  const toggleThread = (id) => {
    setOpenThreadRow(openThreadRow === id ? null : id);
    setExpandedDefectId(null);
  };

  const filteredDefects = allDefects.filter(defect => {
    const isNotClosed = defect.status !== 'CLOSED';
    const isSelectedVessel = selectedImos.includes(defect.vessel_imo);
    return isNotClosed && isSelectedVessel;
  });

  const openPriorityModal = (defect) => {
    setSelectedDefectForPriority(defect);
    setNewPriority(defect.priority); 
    setIsPriorityModalOpen(true);
  };

  const handleUpdatePriority = async () => {
    if (!selectedDefectForPriority) return;
    setIsUpdatingPriority(true);
    
    try {
      await defectApi.updateDefect(selectedDefectForPriority.id, {
         priority: newPriority
      });

      await queryClient.invalidateQueries(['defects']);
      await queryClient.invalidateQueries(['threads', selectedDefectForPriority.id]);
      
      alert(`✅ Priority escalated to ${newPriority}`);
      setIsPriorityModalOpen(false);
      setSelectedDefectForPriority(null);
      
    } catch (err) {
      alert("Failed to update priority: " + err.message);
    } finally {
      setIsUpdatingPriority(false);
    }
  };

  // 🆕 PR EDITING HANDLERS
  const startEditingPR = (defect) => {
    setEditingPR(defect.id);
    setPrNumber(defect.pr_number || '');
    setPrStatus(defect.pr_status || 'Pending');
  };

  const savePRChanges = async (defectId) => {
    setIsSavingPR(true);
    
    try {
      await defectApi.updateDefect(defectId, {
        prNumber: prNumber,
        prStatus: prStatus
      });
      
      await queryClient.invalidateQueries(['defects']);
      
      setEditingPR(null);
      alert('✅ PR information updated successfully!');
      
    } catch (err) {
      console.error('❌ PR update error:', err);
      alert('❌ Update failed: ' + err.message);
    } finally {
      setIsSavingPR(false);
    }
  };

  const cancelPREdit = () => {
    setEditingPR(null);
    setPrNumber('');
    setPrStatus('');
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

  const [formData, setFormData] = useState({ name: '', imo_number: '', vessel_type: 'Oil Tanker', email: '' });
  const addVesselMutation = useMutation({
    mutationFn: createVessel,
    onSuccess: () => {
      alert("Vessel Added Successfully!");
      setIsModalOpen(false);
      setFormData({ name: '', imo_number: '', vessel_type: 'Oil Tanker', email: '' });
      queryClient.invalidateQueries(['vessels']);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.imo_number.length !== 7) return alert("IMO Number must be 7 digits.");
    addVesselMutation.mutate(formData);
  };

  return (
    <div className="dashboard-container">
      <div className="section-header-with-filters">
        <div>
          <h1 className="page-title">Defect Overview</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
            Showing <strong>{filteredDefects.length}</strong> defects from <strong>{selectedImos.length}</strong> vessels.
          </p>
        </div>

        <div className="filter-controls">
          <div className="custom-dropdown-container" ref={dropdownRef} style={{ position: 'relative' }}>
            <button className="filter-btn" onClick={() => setIsFilterOpen(!isFilterOpen)} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'white', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', minWidth: '200px', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Filter size={14} color="#64748b" />
                <span style={{ fontSize: '13px', color: '#334155' }}>{selectedImos.length === vesselList.length ? 'All Vessels' : `${selectedImos.length} Selected`}</span>
              </div>
              <ChevronDown size={14} color="#64748b" />
            </button>

            {isFilterOpen && (
              <div className="dropdown-menu" style={{ position: 'absolute', top: '45px', right: '0', width: '280px', background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderRadius: '8px', zIndex: 100, padding: '10px' }}>
                <input type="text" placeholder="Search ships..." value={vesselSearch} onChange={(e) => setVesselSearch(e.target.value)} style={{ width: '90%', padding: '6px 10px', marginBottom: '10px', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px' }} />
                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                  <div onClick={toggleSelectAll} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', cursor: 'pointer' }}>
                    <div style={{ width: '16px', height: '16px', border: '1px solid #cbd5e1', borderRadius: '4px', background: selectedImos.length === vesselList.length ? '#3b82f6' : 'white' }}>
                      {selectedImos.length === vesselList.length && <Check size={12} color="white" />}
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: '600' }}>Select All</span>
                  </div>
                  {vesselList.filter(v => v.name.toLowerCase().includes(vesselSearch.toLowerCase())).map(v => (
                    <div key={v.imo_number} onClick={() => toggleVessel(v.imo_number)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px', cursor: 'pointer' }}>
                      <div style={{ width: '16px', height: '16px', border: '1px solid #cbd5e1', borderRadius: '4px', background: selectedImos.includes(v.imo_number) ? '#3b82f6' : 'white' }}>
                        {selectedImos.includes(v.imo_number) && <Check size={12} color="white" />}
                      </div>
                      <span style={{ fontSize: '13px' }}>{v.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {user?.role === 'ADMIN' && (
            <button className="btn-primary" onClick={() => setIsModalOpen(true)}>
              <Plus size={16} /> Register Vessel
            </button>
          )}
        </div>
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Vessel Name</th>
              <th>IMO</th>
              <th>Equipment</th>
              <th>Defect Title</th>
              <th>Priority</th>
              <th>Status</th>
              <th>PR No.</th>
              <th>PR Status</th>
              <th>Thread</th>
              <th>Expand</th>
            </tr>
          </thead>
          <tbody>
            {isDefectsLoading && <tr><td colSpan="10" style={{ textAlign: 'center', padding: '30px' }}>Loading Defects...</td></tr>}
            {filteredDefects.map((defect) => (
              <React.Fragment key={defect.id}>
                <tr 
                  id={`row-${defect.id}`} 
                  className={expandedDefectId === defect.id ? 'expanded-active' : ''}
                  style={{
                    backgroundColor: highlightedId === defect.id ? '#fef9c3' : 'inherit',
                    transition: 'background-color 0.5s ease'
                  }}
                >
                  <td style={{ fontWeight: '600' }}>{defect.vessel_name || 'Unknown'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '13px', color: '#64748b' }}>{defect.vessel_imo}</td>
                  <td>{defect.equipment_name || defect.equipment}</td>
                  <td>{defect.title}</td>
                  <td><span className={`badge badge-${defect.priority.toLowerCase()}`}>{defect.priority}</span></td>
                  <td><span className={`status-dot ${defect.status.toLowerCase().replace('_', '-')}`}></span>{defect.status.replace('_', ' ')}</td>
                  
                  {/* 🆕 INLINE EDITABLE PR NUMBER */}
                  <td>
                    {editingPR === defect.id ? (
                      <input
                        type="text"
                        value={prNumber}
                        onChange={(e) => setPrNumber(e.target.value)}
                        placeholder="PR-2024-001"
                        disabled={isSavingPR}
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          border: '1px solid #3b82f6',
                          borderRadius: '4px',
                          fontSize: '13px',
                          fontFamily: 'monospace'
                        }}
                      />
                    ) : (
                      <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#64748b' }}>
                        {defect.pr_number || '—'}
                      </span>
                    )}
                  </td>
                  
                  {/* 🆕 INLINE EDITABLE PR STATUS */}
                  <td>
                    {editingPR === defect.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <select
                          value={prStatus}
                          onChange={(e) => setPrStatus(e.target.value)}
                          disabled={isSavingPR}
                          style={{
                            padding: '4px 8px',
                            border: '1px solid #3b82f6',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}
                        >
                          <option value="Not Required">Not Required</option>
                          <option value="Pending">Pending</option>
                          <option value="Approved">Approved</option>
                          <option value="Ordered">Ordered</option>
                          <option value="In Transit">In Transit</option>
                          <option value="Delivered">Delivered</option>
                          <option value="Closed">Closed</option>
                        </select>
                        <button
                          onClick={() => savePRChanges(defect.id)}
                          disabled={isSavingPR}
                          style={{
                            background: '#10b981',
                            color: 'white',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            cursor: isSavingPR ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: isSavingPR ? 0.6 : 1
                          }}
                        >
                          <Save size={14} />
                        </button>
                        <button
                          onClick={cancelPREdit}
                          disabled={isSavingPR}
                          style={{
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            cursor: isSavingPR ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            opacity: isSavingPR ? 0.6 : 1
                          }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span className={`badge badge-${getPRStatusClass(defect.pr_status)}`}>
                          {defect.pr_status || 'Not Set'}
                        </span>
                        <button
                          onClick={() => startEditingPR(defect)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: '#64748b',
                            padding: '4px'
                          }}
                          title="Edit PR Info"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                    )}
                  </td>
                  
                  <td>
                    <button
                      className="btn-icon"
                      onClick={(e) => { e.stopPropagation(); toggleThread(defect.id); }}
                    >
                      <MessageSquare size={18} />
                    </button>
                  </td>
                  <td>
                    <button
                      className="action-btn"
                      onClick={() => toggleExpand(defect.id)}
                    >
                      {expandedDefectId === defect.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                  </td>
                </tr>

                {expandedDefectId === defect.id && (
                  <tr className="detail-row">
                    <td colSpan="10" style={{ padding: 0 }}>
                      <div className="detail-content">
                        <div className="detail-grid" style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                          <div>
                            <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '6px' }}>Description:</strong>
                            <p style={{ fontSize: '14px', color: '#334155', margin: 0 }}>{defect.description}</p>
                          </div>
                          <div>
                            <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '6px' }}>Ship Remarks:</strong>
                            <p style={{ fontSize: '14px', color: '#334155', margin: 0 }}>{defect.ships_remarks || 'No remarks provided.'}</p>
                          </div>
                          <div>
                            <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '6px' }}>Responsibility:</strong>
                            <p style={{ fontSize: '14px', color: '#334155', margin: 0 }}>{defect.responsibility || 'Not Assigned'}</p>
                          </div>
                          <div>
                            <strong style={{ fontSize: '13px', color: '#64748b', display: 'block', marginBottom: '6px' }}>Reported Date:</strong>
                            <p style={{ fontSize: '14px', color: '#334155', margin: 0 }}>{new Date(defect.date_identified).toLocaleDateString()}</p>
                          </div>
                        </div>

                        <div className="detail-actions" style={{ padding: '20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px' }}>
                          <button 
                            className="btn-action edit" 
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                            onClick={() => openPriorityModal(defect)} 
                          >
                            <ShieldAlert size={16} /> Raise Priority
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}

                {openThreadRow === defect.id && (
                  <tr className="detail-row">
                    <td colSpan="10" style={{ padding: 0 }}>
                      <ThreadSection defectId={defect.id} defectStatus={defect.status} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && user?.role === 'ADMIN' && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '450px' }}>
            <div className="modal-header">
              <h3><Ship size={18} style={{ marginRight: '8px' }} /> Register New Vessel</h3>
              <button onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-group"><label>IMO Number</label><input className="input-field" maxLength={7} placeholder="9792058" value={formData.imo_number} onChange={(e) => setFormData({ ...formData, imo_number: e.target.value.replace(/\D/g, '') })} required /></div>
              <div className="form-group"><label>Vessel Name</label><input className="input-field" placeholder="A.M. UMANG" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value.toUpperCase() })} required /></div>
              <div className="form-group"><label>Vessel Type</label><select className="input-field" value={formData.vessel_type} onChange={(e) => setFormData({ ...formData, vessel_type: e.target.value })}><option>Oil Tanker</option><option>Bulk Carrier</option><option>Container Ship</option><option>LNG Carrier</option><option>General Cargo</option></select></div>
              <div className="form-group"><label><Mail size={14} style={{ verticalAlign: 'middle' }} /> Ship Email (Optional)</label><input type="email" className="input-field" placeholder="master.umang@shipping.com" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} /></div>
              <div className="modal-footer" style={{ borderTop: 'none', padding: '0', marginTop: '20px' }}>
                <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={addVesselMutation.isPending}>{addVesselMutation.isPending ? 'Registering...' : 'Confirm Registration'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isPriorityModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '400px' }}>
            <div className="modal-header">
              <h3>Change Priority</h3>
              <button onClick={() => setIsPriorityModalOpen(false)}><X size={20} /></button>
            </div>
            
            <div className="modal-body">
              <p style={{marginBottom: '15px', color: '#64748b'}}>
                Set new priority for: <strong>{selectedDefectForPriority?.title}</strong>
              </p>
              
              <div className="form-group">
                <label>Select Level</label>
                <select 
                  className="input-field" 
                  value={newPriority} 
                  onChange={(e) => setNewPriority(e.target.value)}
                >
                  <option value="NORMAL">NORMAL</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>

              <div style={{background: '#f1f5f9', padding: '10px', borderRadius: '6px', fontSize: '12px', color: '#64748b', marginTop: '10px'}}>
                <ShieldAlert size={14} style={{verticalAlign: 'middle', marginRight: '5px'}}/>
                This will trigger a system alert in the chat and notify the vessel.
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setIsPriorityModalOpen(false)}>Cancel</button>
              <button 
                className="btn-primary" 
                onClick={handleUpdatePriority}
                disabled={isUpdatingPriority || newPriority === selectedDefectForPriority?.priority}
              >
                {isUpdatingPriority ? 'Updating...' : 'Confirm Change'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShoreVesselData;