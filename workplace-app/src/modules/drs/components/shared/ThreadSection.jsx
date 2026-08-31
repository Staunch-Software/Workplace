// components/shared/ThreadSection.jsx
import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Paperclip, CheckCircle, X, Loader2 } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { blobUploadService } from '@drs/services/blobUploadService';
import { generateId } from '@drs/services/idGenerator';
import { useAuth } from '@/context/AuthContext';
import AttachmentLink from '@drs/components/shared/AttachmentLink';

// Caret helpers for the contentEditable mention box
const getCaretOffset = (root) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const preRange = range.cloneRange();
  preRange.selectNodeContents(root);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
};

const getNodeOffsetAt = (root, charOffset) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node;
  let remaining = charOffset;
  while ((node = walker.nextNode())) {
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
  }
  return { node: root, offset: root.childNodes.length };
};

/**
 * Reusable ThreadSection Component
 * Handles conversation threads with file attachments
 * Works for both Vessel and Shore dashboards
 */
const ThreadSection = ({ defectId, defectStatus }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const editorRef = useRef(null);
  const [replyText, setReplyText] = useState("");
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [mentionList, setMentionList] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [taggedUsers, setTaggedUsers] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);

  // Fetch threads for this defect
  const { data: threads = [], isLoading } = useQuery({
    queryKey: ['threads', defectId],
    queryFn: () => defectApi.getThreads(defectId),
    enabled: !!defectId,
    refetchOnWindowFocus: false, // Prevent unnecessary refetches
    staleTime: 1000 * 30 // Consider data fresh for 30 seconds
  });

  // Fetch vessel users for @mentions
  const { data: vesselUsers = [] } = useQuery({
    queryKey: ['vessel-users', defectId],
    queryFn: () => defectApi.getVesselUsers(defectId),
    enabled: !!defectId,
    staleTime: 1000 * 60 * 5 // Cache for 5 minutes
  });

  // Handle text change with @mention detection (contentEditable box)
  const handleEditorInput = () => {
    const root = editorRef.current;
    if (!root) return;

    const text = root.innerText.replace(/\u00A0/g, ' ');
    setReplyText(text);

    const caretOffset = getCaretOffset(root);
    if (caretOffset === null) {
      setShowMentions(false);
      return;
    }
    setCursorPosition(caretOffset);

    const textBeforeCursor = text.slice(0, caretOffset);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && (lastAtIndex === 0 || /\s/.test(text[lastAtIndex - 1]))) {
      const searchTerm = textBeforeCursor.slice(lastAtIndex + 1);
      if (!/\s/.test(searchTerm)) {
        const filtered = vesselUsers.filter(u =>
          u.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setMentionList(filtered);
        setShowMentions(filtered.length > 0);
        return;
      }
    }
    setShowMentions(false);
  };

  // Select a user from mention dropdown — inserts a blue, non-editable @Name chip
  const selectMention = (selectedUser) => {
    const root = editorRef.current;
    if (!root) return;
    root.focus();

    const text = root.innerText.replace(/\u00A0/g, ' ');
    const textBeforeCursor = text.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    if (lastAtIndex === -1) {
      setShowMentions(false);
      return;
    }

    const startPos = getNodeOffsetAt(root, lastAtIndex);
    const endPos = getNodeOffsetAt(root, cursorPosition);

    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    range.deleteContents();

    const mentionSpan = document.createElement('span');
    mentionSpan.contentEditable = 'false';
    mentionSpan.className = 'mention-chip';
    mentionSpan.textContent = `@${selectedUser.name}`;
    range.insertNode(mentionSpan);

    const spaceNode = document.createTextNode('\u00A0');
    mentionSpan.after(spaceNode);

    const newRange = document.createRange();
    newRange.setStartAfter(spaceNode);
    newRange.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(newRange);

    const newText = root.innerText.replace(/\u00A0/g, ' ');
    setReplyText(newText);
    setCursorPosition(getCaretOffset(root) ?? newText.length);

    // Avoid duplicate tags
    if (!taggedUsers.includes(selectedUser.id)) {
      setTaggedUsers([...taggedUsers, selectedUser.id]);
    }

    setShowMentions(false);
  };

  // Handle file selection
  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...newFiles]);
    console.log('📎 Files selected:', newFiles.map(f => f.name));
  };

  // Remove file from list
  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Send reply with attachments
  const handleReply = async () => {
    if (!replyText.trim() && files.length === 0) {
      alert('⚠️ Please enter a message or attach a file');
      return;
    }

    setIsUploading(true);

    try {
      const threadId = generateId();
      console.log('💬 Sending reply...');

      // STEP 1: Upload files to Azure Blob Storage
      const uploadedAttachments = [];
      
      if (files.length > 0) {
        console.log(`📤 Uploading ${files.length} file(s)...`);
        
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const attachmentId = generateId();
          
          console.log(`   Uploading [${i + 1}/${files.length}]: ${file.name}`);
          
          try {
            const blobPath = await blobUploadService.uploadBinary(file, defectId, attachmentId);
            
            uploadedAttachments.push({
              id: attachmentId,
              thread_id: threadId,
              file_name: file.name,
              file_size: file.size,
              content_type: file.type,
              blob_path: blobPath
            });
            
            console.log(`   ✅ Uploaded: ${file.name}`);
          } catch (uploadError) {
            console.error(`   ❌ Upload failed for ${file.name}:`, uploadError);
            throw new Error(`Failed to upload "${file.name}": ${uploadError.message}`);
          }
        }
        
        console.log('✅ All files uploaded');
      }

      // STEP 2: Create thread message in database
      console.log('💾 Saving thread message...');
      await defectApi.createThread({
        id: threadId,
        defect_id: defectId,
        author: user?.job_title || user?.full_name || "User",
        body: replyText.trim(),
        tagged_user_ids: taggedUsers
      });
      console.log('✅ Thread message saved');

      // STEP 3: Save attachment metadata to database
      if (uploadedAttachments.length > 0) {
        console.log(`💾 Saving ${uploadedAttachments.length} attachment(s) metadata...`);
        
        for (const attachment of uploadedAttachments) {
          await defectApi.createAttachment(attachment);
        }
        
        console.log('✅ All attachments saved');
      }

      // Reset form
      setReplyText("");
      setFiles([]);
      setTaggedUsers([]);
      if (editorRef.current) editorRef.current.innerHTML = '';
      
      // Refresh threads
      queryClient.invalidateQueries(['threads', defectId]);
      
      console.log('🎉 Reply sent successfully!');
      
    } catch (err) {
      console.error("❌ Failed to send reply:", err);
      alert(`❌ Failed to send reply: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '20px', color: '#64748b', fontSize: '13px', textAlign: 'center' }}>
        <Loader2 className="animate-spin" style={{ display: 'inline-block', marginRight: '8px' }} size={16} />
        Loading conversation...
      </div>
    );
  }

  return (
    <div className="thread-expand-container" style={{ padding: '20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
      {/* Thread History */}
      <div className="thread-history" style={{ marginBottom: '20px', maxHeight: '400px', overflowY: 'auto' }}>
        {threads.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
            No conversation history yet.
          </p>
        ) : (
          threads.map(t => {
            const isMyMessage = t.user_id === user?.id;
            const isShoreMessage = t.author?.toLowerCase().includes('superintendent') || 
                                   t.author?.toLowerCase().includes('shore') ||
                                   t.role === 'shore';
            
            let bubbleColor = 'white';
            if (isMyMessage) bubbleColor = '#dcf8c6';
            else if (isShoreMessage) bubbleColor = '#e0f2fe';
            
            return (
              <div 
                key={t.id} 
                style={{ 
                  display: 'flex', 
                  justifyContent: isMyMessage ? 'flex-end' : 'flex-start', 
                  marginBottom: '15px' 
                }}
              >
                <div style={{ 
                  maxWidth: '70%', 
                  padding: '12px', 
                  background: bubbleColor, 
                  borderRadius: isMyMessage ? '12px 12px 2px 12px' : '12px 12px 12px 2px', 
                  border: isShoreMessage && !isMyMessage ? '1px solid #0ea5e9' : '1px solid #e2e8f0',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)' 
                }}>
                  {/* Message Header */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '6px', 
                    gap: '10px' 
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong style={{ 
                        fontSize: '13px', 
                        color: isMyMessage ? '#065f46' : (isShoreMessage ? '#0369a1' : '#1e293b') 
                      }}>
                        {t.author}
                      </strong>
                      {isShoreMessage && !isMyMessage && (
                        <span style={{ 
                          fontSize: '10px', 
                          padding: '2px 6px', 
                          background: '#0ea5e9', 
                          color: 'white', 
                          borderRadius: '4px',
                          fontWeight: '600'
                        }}>
                          SHORE
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                      {new Date(t.created_at).toLocaleString()}
                    </span>
                  </div>
                  
                  {/* Message Body */}
                  <p style={{ fontSize: '14px', color: '#334155', margin: '0', whiteSpace: 'pre-wrap' }}>
                    {t.body.split(/(@[\w\s]+)/g).map((part, i) =>
                      part.startsWith('@') ? 
                        <span key={i} style={{ color: '#3b82f6', fontWeight: '600' }}>{part}</span> : 
                        part
                    )}
                  </p>

                  {/* 🆕 Attachments - Now using AttachmentLink component */}
                  {t.attachments && t.attachments.length > 0 && (
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

      {/* Reply Box (Conditional based on defect status) */}
      {defectStatus !== 'CLOSED' ? (
        <div className="reply-box" style={{ position: 'relative' }}>
          {/* Mention-aware reply box (contentEditable so @Name can be colored inline) */}
          <div
            ref={editorRef}
            className="input-field mention-editor"
            contentEditable={!isUploading}
            suppressContentEditableWarning
            onInput={handleEditorInput}
            onKeyUp={handleEditorInput}
            onClick={handleEditorInput}
            data-placeholder="Type a reply (use @ to mention)..."
            style={{
              width: '100%',
              minHeight: '80px',
              maxHeight: '200px',
              overflowY: 'auto',
              marginBottom: '10px',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              fontSize: '14px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              outline: 'none',
              background: isUploading ? '#f8fafc' : 'white',
              cursor: isUploading ? 'not-allowed' : 'text'
            }}
          />
          <style>{`
            .mention-editor:empty:before {
              content: attr(data-placeholder);
              color: #94a3b8;
              pointer-events: none;
            }
            .mention-editor .mention-chip {
              color: #3b82f6;
              font-weight: 600;
            }
          `}</style>

          {/* @Mention Dropdown */}
          {showMentions && (
            <div style={{ 
              position: 'absolute', 
              bottom: '120px', 
              left: '20px', 
              background: 'white', 
              border: '1px solid #e2e8f0', 
              borderRadius: '8px', 
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)', 
              maxHeight: '200px', 
              overflowY: 'auto', 
              zIndex: 1000, 
              minWidth: '200px' 
            }}>
              {mentionList.map(u => (
                <div
                  key={u.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectMention(u)}
                  style={{
                    padding: '10px', 
                    cursor: 'pointer', 
                    fontSize: '13px', 
                    borderBottom: '1px solid #f1f5f9',
                    transition: 'background 0.2s',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                  <span>{u.name}</span>
                  {u.role === 'shore' && (
                    <span style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      background: '#0ea5e9',
                      color: 'white',
                      borderRadius: '4px',
                      fontWeight: '600'
                    }}>
                      SHORE
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* File List */}
          {files.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              {files.map((file, index) => (
                <div 
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    marginBottom: '6px'
                  }}
                >
                  <div style={{ fontSize: '13px', color: '#334155' }}>
                    <Paperclip size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    {file.name} ({(file.size / 1024).toFixed(1)} KB)
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#ef4444',
                      padding: '4px'
                    }}
                    title="Remove file"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* File Upload */}
            <div>
              <input 
                type="file" 
                multiple 
                id={`file-reply-${defectId}`} 
                onChange={handleFileChange}
                accept="image/*,.pdf,.doc,.docx"
                hidden 
                disabled={isUploading}
              />
              <label 
                htmlFor={`file-reply-${defectId}`} 
                style={{ 
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px', 
                  fontSize: '13px', 
                  color: '#64748b',
                  opacity: isUploading ? 0.5 : 1
                }}
              >
                <Paperclip size={14} /> 
                {files.length > 0 ? `${files.length} file(s) attached` : 'Attach Files'}
              </label>
            </div>
            
            {/* Send Button */}
            <button 
              className="btn-primary" 
              onClick={handleReply} 
              disabled={isUploading || (!replyText.trim() && files.length === 0)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                opacity: (isUploading || (!replyText.trim() && files.length === 0)) ? 0.5 : 1,
                cursor: (isUploading || (!replyText.trim() && files.length === 0)) ? 'not-allowed' : 'pointer'
              }}
            >
              {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {isUploading ? 'Sending...' : 'Send Reply'}
            </button>
          </div>
        </div>
      ) : (
        // Read-only message for CLOSED defects
        <div style={{ 
          padding: '15px', 
          background: '#f1f5f9', 
          borderRadius: '8px',
          textAlign: 'center',
          color: '#64748b'
        }}>
          <p style={{ 
            margin: 0, 
            fontSize: '13px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '8px' 
          }}>
            <CheckCircle size={16} style={{ color: '#10b981' }} />
            🔒 This defect is closed. Thread is view-only.
          </p>
        </div>
      )}
    </div>
  );
};

export default ThreadSection;