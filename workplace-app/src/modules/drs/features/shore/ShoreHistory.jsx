import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Search, ChevronDown, ChevronUp, CheckCircle, MessageSquare
} from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { useAuth } from '@/context/AuthContext';
import SecureImage from '@drs/components/shared/SecureImage';
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

const ThreadSection = ({ defectId }) => {
  const { user } = useAuth();

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['threads', defectId],
    queryFn: () => defectApi.getThreads(defectId),
    enabled: !!defectId
  });

  if (isLoading) return <div style={{ padding: '20px', color: '#64748b' }}>Loading conversation...</div>;

  return (
    <div className="thread-section-wrapper" style={{ padding: '20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
      <div className="thread-history" style={{ marginBottom: '20px' }}>
        {threads.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No messages in this thread.</p>
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
                <div style={{ 
                  maxWidth: '70%', 
                  padding: '12px', 
                  background: isMyMessage ? '#dcf8c6' : 'white', 
                  borderRadius: isMyMessage ? '12px 12px 2px 12px' : '12px 12px 12px 2px', 
                  border: '1px solid #e2e8f0', 
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)' 
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', gap: '10px' }}>
                    <strong style={{ fontSize: '13px', color: isMyMessage ? '#065f46' : '#1e293b' }}>{t.author}</strong>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                  <p style={{ fontSize: '14px', color: '#334155', margin: '0' }}>
                    {t.body.split(/(@[\w\s]+)/g).map((part, i) =>
                      part.startsWith('@') ? <span key={i} style={{ color: '#3b82f6', fontWeight: '600' }}>{part}</span> : part
                    )}
                  </p>
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
    </div>
  );
};

const ShoreHistory = () => {
  const [expandedRow, setExpandedRow] = useState(null);
  const [openThreadRow, setOpenThreadRow] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: defects = [], isLoading } = useQuery({
    queryKey: ['defects', 'closed-history'],
    queryFn: () => defectApi.getDefects()
  });

  const filteredHistory = defects.filter(defect => {
    const isClosed = defect.status === 'CLOSED';
    const matchSearch = searchQuery === '' || 
      defect.equipment_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      defect.title?.toLowerCase().includes(searchQuery.toLowerCase());
    
    return isClosed && matchSearch;
  });

  const toggleExpand = (id) => {
    setExpandedRow(expandedRow === id ? null : id);
    setOpenThreadRow(null);
  };

  const toggleThread = (id) => {
    setOpenThreadRow(openThreadRow === id ? null : id);
    setExpandedRow(null);
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
      <div className="section-header-with-filters">
        <h1 className="page-title">Closed Defects Archive ({filteredHistory.length})</h1>
        <div className="filter-controls">
          <div className="v-search-box" style={{ marginBottom: 0, background: 'white', border: '1px solid #cbd5e1' }}>
            <Search size={14} color="#64748b" />
            <input 
              type="text" 
              placeholder="Search archives..." 
              style={{ color: '#333' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div style={{
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
      }}>
        <CheckCircle size={18} color="#16a34a" />
        <span style={{ fontSize: '14px', color: '#166534' }}>
          Showing {filteredHistory.length} completed {filteredHistory.length === 1 ? 'defect' : 'defects'} with evidence documentation
        </span>
      </div>

      {/* ✅ NO HORIZONTAL SCROLL - Fixed width columns */}
      <div className="table-card">
        <table className="data-table" style={{ width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: '12%' }}>Vessel</th>
              <th style={{ width: '15%' }}>Equipment</th>
              <th style={{ width: '10%' }}>Priority</th>
              <th style={{ width: '12%' }}>PR No.</th>
              <th style={{ width: '13%' }}>PR Status</th>
              <th style={{ width: '13%' }}>Closed Date</th>
              <th style={{ width: '8%', textAlign: 'center' }}>Thread</th>
              <th style={{ width: '8%', textAlign: 'center' }}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.length > 0 ? (
              filteredHistory.map((defect) => (
                <React.Fragment key={defect.id}>
                  <tr className={expandedRow === defect.id ? 'expanded-active' : ''} style={{ opacity: 0.85 }}>
                    <td style={{ fontWeight: 'bold', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {defect.vessel_name || defect.vessel_imo}
                    </td>
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {defect.equipment_name}
                    </td>
                    <td>
                      <span className={`badge badge-${defect.priority.toLowerCase()}`}>
                        {defect.priority}
                      </span>
                    </td>
                    
                    <td>
                      <span style={{ 
                        fontFamily: 'monospace', 
                        fontSize: '13px', 
                        color: '#64748b' 
                      }}>
                        {defect.pr_number || '—'}
                      </span>
                    </td>
                    
                    <td>
                      <span className={`badge badge-${getPRStatusClass(defect.pr_status)}`}>
                        {defect.pr_status || 'Not Set'}
                      </span>
                    </td>
                    
                    <td>{new Date(defect.closed_at || defect.updated_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button className="thread-btn" onClick={(e) => { e.stopPropagation(); toggleThread(defect.id); }}>
                        <MessageSquare size={16} />
                      </button>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="action-btn"
                        onClick={() => toggleExpand(defect.id)}
                      >
                        {expandedRow === defect.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </button>
                    </td>
                  </tr>

                  {expandedRow === defect.id && (
                    <tr className="detail-row">
                      <td colSpan="8" style={{ padding: 0 }}>
                        <div className="detail-content" style={{ padding: '24px', background: '#f8fafc' }}>
                          
                          <div style={{
                            background: '#f0fdf4',
                            padding: '20px',
                            borderRadius: '8px',
                            border: '1px solid #bbf7d0',
                            marginBottom: '20px'
                          }}>
                            <h4 style={{
                              margin: '0 0 12px 0',
                              color: '#166534',
                              fontSize: '15px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              fontWeight: '600'
                            }}>
                              <CheckCircle size={18} />
                              Closure Report
                            </h4>

                            <div style={{ marginBottom: '16px' }}>
                              <strong style={{ fontSize: '13px', color: '#15803d', display: 'block', marginBottom: '6px' }}>
                                Final Remarks:
                              </strong>
                              <p style={{ fontSize: '14px', color: '#166534', margin: 0, lineHeight: '1.6' }}>
                                {defect.closure_remarks || 'No remarks provided'}
                              </p>
                            </div>

                            {(defect.closure_image_before || defect.closure_image_after) && (
                              <div>
                                <strong style={{ fontSize: '13px', color: '#15803d', display: 'block', marginBottom: '12px' }}>
                                  Photographic Evidence:
                                </strong>
                                <div style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                                  gap: '20px'
                                }}>
                                  {defect.closure_image_before && (
                                    <div>
                                      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                                        <span style={{
                                          fontSize: '11px',
                                          fontWeight: 'bold',
                                          color: '#ef4444',
                                          background: '#fee2e2',
                                          padding: '4px 12px',
                                          borderRadius: '4px',
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.5px'
                                        }}>
                                          BEFORE REPAIR
                                        </span>
                                      </div>
                                      <SecureImage
                                        blobPath={defect.closure_image_before}
                                        style={{
                                          width: '100%',
                                          height: '200px',
                                          objectFit: 'cover',
                                          borderRadius: '6px',
                                          border: '2px solid #e5e7eb',
                                          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                                        }}
                                      />
                                    </div>
                                  )}

                                  {defect.closure_image_after && (
                                    <div>
                                      <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                                        <span style={{
                                          fontSize: '11px',
                                          fontWeight: 'bold',
                                          color: '#10b981',
                                          background: '#d1fae5',
                                          padding: '4px 12px',
                                          borderRadius: '4px',
                                          textTransform: 'uppercase',
                                          letterSpacing: '0.5px'
                                        }}>
                                          AFTER REPAIR
                                        </span>
                                      </div>
                                      <SecureImage
                                        blobPath={defect.closure_image_after}
                                        style={{
                                          width: '100%',
                                          height: '200px',
                                          objectFit: 'cover',
                                          borderRadius: '6px',
                                          border: '2px solid #e5e7eb',
                                          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {!defect.closure_image_before && !defect.closure_image_after && (
                              <div style={{
                                padding: '12px',
                                background: '#fef3c7',
                                border: '1px solid #fde68a',
                                borderRadius: '6px',
                                fontSize: '13px',
                                color: '#92400e'
                              }}>
                                ⚠️ No photographic evidence was uploaded for this closure.
                              </div>
                            )}
                          </div>

                          <div style={{
                            padding: '16px',
                            background: 'white',
                            borderRadius: '8px',
                            border: '1px solid #e2e8f0'
                          }}>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                              gap: '16px',
                              fontSize: '13px'
                            }}>
                              <div>
                                <strong style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                  Description:
                                </strong>
                                <p style={{ margin: 0, color: '#0f172a' }}>
                                  {defect.description}
                                </p>
                              </div>
                              <div>
                                <strong style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                  Defect Title:
                                </strong>
                                <p style={{ margin: 0, color: '#0f172a' }}>
                                  {defect.title}
                                </p>
                              </div>
                              <div>
                                <strong style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                  Ship Remarks:
                                </strong>
                                <p style={{ margin: 0, color: '#0f172a' }}>
                                  {defect.ships_remarks || 'No remarks provided.'}
                                </p>
                              </div>
                              <div>
                                <strong style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                  Responsibility:
                                </strong>
                                <p style={{ margin: 0, color: '#0f172a' }}>
                                  {defect.responsibility || 'Not assigned'}
                                </p>
                              </div>
                              <div>
                                <strong style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>
                                  Reported Date:
                                </strong>
                                <p style={{ margin: 0, color: '#0f172a' }}>
                                  {new Date(defect.date_identified || defect.created_at).toLocaleDateString()}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}

                  {openThreadRow === defect.id && (
                    <tr className="detail-row">
                      <td colSpan="8" style={{ padding: 0 }}>
                        <div className="detail-content">
                          <ThreadSection defectId={defect.id} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            ) : (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                  <CheckCircle size={48} color="#cbd5e1" style={{ marginBottom: '12px' }} />
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: '500' }}>
                    {searchQuery ? 'No closed defects match your search' : 'No closed defects found'}
                  </p>
                  <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#cbd5e1' }}>
                    Closed defects with evidence will appear here
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ShoreHistory;