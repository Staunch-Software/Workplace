// src/modules/reports/components/VesselThreadPanel.jsx
import React, { useState, useEffect, useRef } from "react";
import { Send, MessageSquare, CheckCircle, Loader2, ChevronDown, ChevronUp, Paperclip, X, Download } from "lucide-react";
import { vesselReportsApi } from "../api/reportsApi";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { v4 as uuidv4 } from "uuid";
import { fmtDateTime } from "@/utils/dateUtils";

const ThreadAttachmentLink = ({ reportId, threadId, attachment, isMine }) => {
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    try {
      setDownloading(true);
      const { url } = await vesselReportsApi.getThreadAttachmentUrl(reportId, threadId, attachment.id);
      window.open(url, "_blank");
    } catch (e) {
      console.error(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div 
      onClick={handleDownload}
      style={{ 
        display: 'inline-flex', alignItems: 'center', gap: '6px', 
        padding: '6px 10px', background: isMine ? 'rgba(255,255,255,0.1)' : '#fff',
        border: isMine ? '1px solid rgba(255,255,255,0.2)' : '1px solid #e2e8f0', 
        borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
        opacity: downloading ? 0.7 : 1, marginTop: '4px'
      }}
    >
      {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      <span style={{ textDecoration: 'underline' }}>{attachment.file_name}</span>
    </div>
  );
};

export default function VesselThreadPanel({ reportId, reportName, reportMeta, isCollapsed, onToggle }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef(null);
  const highlightRef = useRef(null);
  const fileInputRef = useRef(null);

  const [mentionList, setMentionList] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [taggedUsers, setTaggedUsers] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);

  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // Mention list is scoped to this report's own vessel, sourced from
  // GET /vessels (any authenticated user) rather than the admin-only
  // GET /users -- SHORE/VESSEL users aren't ADMIN, so the old admin-users
  // fetch 403'd for them and silently left the @mention picker empty.
  const { data: vessels = [] } = useQuery({
    queryKey: ['core-vessels'],
    queryFn: () => vesselReportsApi.getVessels(),
  });

  const vesselUsers = reportMeta?.vessel_imo
    ? (vessels.find(v => String(v.imo) === String(reportMeta.vessel_imo))?.assigned_users || [])
    : [];

  const allUserNames = vesselUsers.map(u => u.full_name).filter(Boolean);
  const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mentionPattern = allUserNames.length > 0 
    ? `(@(?:${allUserNames.map(escapeRegExp).join('|')}))` 
    : `(@_never_match_)`;
  const mentionRegex = new RegExp(mentionPattern, 'gi');

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["vessel-report-threads", reportId],
    queryFn: () => vesselReportsApi.getThreads(reportId),
    enabled: !!reportId,
    refetchInterval: 10000,
  });

  const sendMutation = useMutation({
    mutationFn: ({ body, tagged_user_ids, attachments }) =>
      vesselReportsApi.postThread(reportId, { body, tagged_user_ids, attachments }),
    onSuccess: () => {
      setDraft("");
      setTaggedUsers([]);
      setSelectedFile(null);
      setIsUploading(false);
      queryClient.invalidateQueries(["vessel-report-threads", reportId]);
      queryClient.invalidateQueries(["vessel-reports-list"]);
    },
    onError: () => {
      setIsUploading(false);
    }
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      vesselReportsApi.verifyReport(reportId, user?.full_name || user?.email),
    onSuccess: () => {
      queryClient.invalidateQueries(["vessel-reports-list"]);
    },
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threads]);

  async function handleSend() {
    if ((!draft.trim() && !selectedFile) || sendMutation.isPending || isUploading) return;
    
    setIsUploading(true);
    let attachments = [];
    
    if (selectedFile) {
      try {
        const timestamp = Date.now();
        const sanitizedFileName = selectedFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const attachmentId = uuidv4();
        const blobPath = `reports/${reportId}/attachments/${attachmentId}_${timestamp}_${sanitizedFileName}`;
        
        const sasData = await vesselReportsApi.getThreadUploadSasUrl(reportId, blobPath);
        await vesselReportsApi.uploadToAzureBlob(selectedFile, sasData.url);
        
        attachments.push({
          file_name: selectedFile.name,
          file_size: selectedFile.size,
          content_type: selectedFile.type || 'application/octet-stream',
          blob_path: blobPath
        });
      } catch (err) {
        console.error("Upload failed", err);
        setIsUploading(false);
        alert("Failed to upload attachment.");
        return;
      }
    }
    
    sendMutation.mutate({ body: draft.trim(), tagged_user_ids: taggedUsers, attachments });
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  const handleScroll = (e) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = e.target.scrollTop;
    }
  };

  const handleTextChange = (e) => {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;
    setDraft(text);
    setCursorPosition(cursorPos);

    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && (lastAtIndex === 0 || text[lastAtIndex - 1] === ' ')) {
      const searchTerm = textBeforeCursor.slice(lastAtIndex + 1);
      const filtered = vesselUsers.filter(u =>
        u.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setMentionList(filtered);
      setShowMentions(filtered.length > 0);
    } else {
      setShowMentions(false);
    }
  };

  const selectMention = (selectedUser) => {
    const textBeforeCursor = draft.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = draft.slice(cursorPosition);

    const newText = draft.slice(0, lastAtIndex) + `@${selectedUser.full_name} ` + textAfterCursor;
    setDraft(newText);
    
    if (!taggedUsers.includes(selectedUser.id)) {
      setTaggedUsers([...taggedUsers, selectedUser.id]);
    }
    
    setShowMentions(false);
  };

  const isVerified = reportMeta?.verify_status === "VERIFIED";

  if (!reportId) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', flexDirection: 'column', gap: '12px' }}>
        <MessageSquare size={40} />
        <span>Select a report to open its thread</span>
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <div className="rt-vertical-header" onClick={onToggle}>
        <MessageSquare size={20} className="rt-panel-icon" />
        <span className="rt-vertical-text">Communication</span>
        <ChevronDown size={16} className="rt-panel-chevron" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>
      
      <div className="rt-panel-header" onClick={onToggle}>
        <div className="rt-panel-header-title">
          <MessageSquare size={18} className="rt-panel-icon" />
          <span>Communication</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ChevronUp size={16} className="rt-panel-chevron" />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', background: '#fff' }} ref={scrollRef}>
        {isLoading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Loading messages...</div>
        )}

        {!isLoading && threads.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '0.85rem' }}>No messages yet. Start the conversation.</div>
        )}

        {threads.map((t) => {
          const isMine = t.author_id === String(user?.id);
          return (
            <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, marginBottom: '4px', padding: '0 4px' }}>
                {t.author_name} · {fmtDateTime(t.created_at)}
              </span>
              <div style={{
                maxWidth: '85%', padding: '12px 16px', borderRadius: '12px', fontSize: '0.85rem', lineHeight: 1.5,
                backgroundColor: isMine ? '#1e293b' : '#f8fafc',
                color: isMine ? '#ffffff' : '#334155',
                border: isMine ? 'none' : '1px solid #e2e8f0',
                borderBottomRightRadius: isMine ? '4px' : '12px',
                borderBottomLeftRadius: isMine ? '12px' : '4px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}>
                {(t.body || '').split(mentionRegex).map((part, i) =>
                  part.startsWith('@') ? 
                    <span key={i} style={{ color: isMine ? '#93c5fd' : '#3b82f6', fontWeight: '600' }}>{part}</span> : 
                    part
                )}
                {t.attachments && t.attachments.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: t.body ? '8px' : '0' }}>
                    {t.attachments.map(att => (
                      <ThreadAttachmentLink key={att.id} reportId={reportId} threadId={t.id} attachment={att} isMine={isMine} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
        
        {selectedFile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#f1f5f9', borderRadius: '8px', marginBottom: '8px', border: '1px solid #e2e8f0' }}>
            <Paperclip size={14} color="#64748b" />
            <span style={{ fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#334155' }}>
              {selectedFile.name}
            </span>
            <button 
              onClick={() => setSelectedFile(null)} 
              disabled={isUploading}
              style={{ background: 'none', border: 'none', cursor: isUploading ? 'not-allowed' : 'pointer', color: '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px', 
          background: '#f8fafc', 
          padding: '8px 12px', 
          borderRadius: '24px', 
          border: '1px solid #e2e8f0',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
        }}>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                setSelectedFile(e.target.files[0]);
              }
            }} 
          />
          <button style={{ 
            background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', 
            padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '50%', transition: 'all 0.2s', flexShrink: 0
          }}
          onClick={() => fileInputRef.current?.click()}
          onMouseEnter={e => e.currentTarget.style.color = '#3b82f6'}
          onMouseLeave={e => e.currentTarget.style.color = '#64748b'}
          title="Add attachment"
          disabled={isUploading}
          >
            <Paperclip size={20} />
          </button>

          <div style={{ position: 'relative', flex: 1 }}>
            
            {showMentions && (
              <div style={{ 
                position: 'absolute', 
                bottom: '100%', 
                left: '0', 
                background: 'white', 
                border: '1px solid #e2e8f0', 
                borderRadius: '12px', 
                boxShadow: '0 4px 20px rgba(0,0,0,0.1)', 
                maxHeight: '200px', 
                overflowY: 'auto', 
                zIndex: 1000, 
                minWidth: '240px',
                marginBottom: '12px'
              }}>
                {mentionList.map(u => (
                  <div 
                    key={u.id} 
                    onClick={() => selectMention(u)} 
                    style={{ 
                      padding: '12px 16px', 
                      cursor: 'pointer', 
                      fontSize: '13px', 
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.2s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                  >
                    <span style={{ fontWeight: 500, color: '#0f172a' }}>{u.full_name}</span>
                    {u.role === 'ADMIN' && (
                      <span style={{ fontSize: '10px', padding: '2px 8px', background: '#fef3c7', color: '#b45309', borderRadius: '12px', fontWeight: '700' }}>ADMIN</span>
                    )}
                    {u.role === 'SHORE' && (
                      <span style={{ fontSize: '10px', padding: '2px 8px', background: '#e0e7ff', color: '#4f46e5', borderRadius: '12px', fontWeight: '700' }}>SHORE</span>
                    )}
                    {u.role === 'VESSEL' && (
                      <span style={{ fontSize: '10px', padding: '2px 8px', background: '#d1fae5', color: '#065f46', borderRadius: '12px', fontWeight: '700' }}>VESSEL</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ position: 'relative', width: '100%', height: '36px' }}>
              <div
                ref={highlightRef}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  padding: '7px 0', border: 'none',
                  fontSize: '0.875rem', lineHeight: 1.5, fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto',
                  pointerEvents: 'none', background: 'transparent', color: '#0f172a',
                  boxSizing: 'border-box'
                }}
              >
                {draft.split(mentionRegex).map((part, i) =>
                  part.startsWith('@') ? <span key={i} style={{ color: '#3b82f6' }}>{part}</span> : part
                )}
                <span>&nbsp;</span>
              </div>
              <textarea
                rows={1}
                style={{
                  position: 'relative', width: '100%', height: '36px',
                  padding: '7px 0', border: 'none',
                  fontSize: '0.875rem', resize: 'none', outline: 'none',
                  background: 'transparent', color: 'transparent', caretColor: '#0f172a',
                  lineHeight: 1.5, transition: 'all 0.2s', fontFamily: 'inherit', overflowY: 'auto',
                  margin: 0, boxSizing: 'border-box'
                }}
                placeholder={draft ? "" : "Type a message (use @ to mention)..."}
                value={draft}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                onScroll={handleScroll}
              />
            </div>
            
          </div>
          
          <button
            onClick={handleSend}
            disabled={(!draft.trim() && !selectedFile) || sendMutation.isPending || isUploading}
            style={{
              background: (draft.trim() || selectedFile) ? '#3b82f6' : '#e2e8f0',
              color: (draft.trim() || selectedFile) ? '#fff' : '#94a3b8', 
              border: 'none', cursor: (draft.trim() || selectedFile) ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
              borderRadius: '50%', width: '36px', height: '36px', flexShrink: 0
            }}
          >
            {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} style={{ marginLeft: '-2px', marginTop: '1px' }} />}
          </button>
        </div>
      </div>
    </div>
  );
}
