import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle, Clock, Info, Filter, ChevronDown, ChevronUp,
  MessageSquare, AlertOctagon, Edit, Send, Paperclip, Trash2, UserCircle, Edit3,
  Image as ImageIcon, Eye, X, Upload, Lock, ArrowUpDown,
  ArrowRight, Flag,
  ArrowRightLeft, Move, Download
} from 'lucide-react';
import { Flower2, Flower, RefreshCcw } from "lucide-react";
import { MessageCircle } from "lucide-react";
import { Check, Plus, MoreHorizontal } from 'lucide-react';


import { defectApi } from '@drs/services/defectApi';
import { blobUploadService } from '@drs/services/blobUploadService';
import { useAuth } from '@/context/AuthContext';
import { generateId } from '@drs/services/idGenerator';
import AttachmentLink from '@drs/components/shared/AttachmentLink';
import ColumnCustomizationModal from '@drs/components/modals/ColumnCustomizationModal';
import './Vessel.css';
import EnhancedClosureModal from '@drs/components/modals/EnhancedClosureModal';

import {
  DndContext,
  closestCenter
} from '@dnd-kit/core';

import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove
} from '@dnd-kit/sortable';

import { CSS } from '@dnd-kit/utilities';
import {
  STATUS_OPTIONS, FILTER_STATUS_OPTIONS, PRIORITY_OPTIONS, DEADLINE_STATUS_OPTIONS, PR_STATUS_OPTIONS, COMPONENT_OPTIONS, DEFECT_SOURCE_OPTIONS,
  DEFECT_SOURCE_MAP, formatDate, toLocalDateInput, getDeadlineStatus, getDefectSourceLabel, paginate, COLUMN_DEFINITIONS, COLUMN_MIN_WIDTHS
} from '@drs/components/shared/constants';

import {
  FilterHeader,
  PrManagerPopover,
  EquipmentFilter,
  DefectSourceFilter,
  FloatingSelectWithIcon,
  InlineDateEdit,
  FloatingSelectText
} from '@drs/components/shared/TableControls';




// Image Gallery Modal with Navigation
const ImageGalleryModal = ({ images, initialIndex = 0, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  if (!images || images.length === 0) return null;

  const handlePrev = () => setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  const handleNext = () => setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        cursor: 'pointer'
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'white',
          border: 'none',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          zIndex: 10000
        }}
      >
        <X size={20} />
      </button>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            style={{
              position: 'absolute',
              left: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              fontSize: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            style={{
              position: 'absolute',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              fontSize: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            ›
          </button>
        </>
      )}

      <div style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <img
          src={images[currentIndex].url}
          alt={images[currentIndex].name}
          style={{
            maxWidth: '85vw',
            maxHeight: '85vh',
            objectFit: 'contain',
            borderRadius: '8px'
          }}
        />
        <p style={{ color: 'white', marginTop: '15px', fontSize: '14px' }}>
          {currentIndex + 1} / {images.length} - {images[currentIndex].name}
        </p>
      </div>
    </div>
  );
};


// ✅ UPDATED: Teams-like Thread Section with PENDING_CLOSURE Approval Workflow
const ThreadSection = ({ defectId, defectStatus, closureRemarks }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState("");
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [mentionList, setMentionList] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [taggedUsers, setTaggedUsers] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);
  const messagesEndRef = useRef(null);
  const threadScrollRef = useRef(null);

  // ✅ Determine if this user has authority to approve (Shore/Admin)
  const canApprove = user?.role === 'SHORE' || user?.role === 'ADMIN';


  // ADD this useMemo after the useQuery for threads (Vessel ThreadSection)
  // Replace: const { data: threads = [] } = useQuery(...)
  // Keep the useQuery but rename its result, then add the useMemo:

  const { data: allThreads = [] } = useQuery({
    queryKey: ['threads', defectId],
    queryFn: () => defectApi.getThreads(defectId),
  });

  const threads = useMemo(() => {
    const safeThreads = Array.isArray(allThreads) ? [...allThreads] : [];

    let filtered = safeThreads.filter(t => t.is_internal !== true);

    if (defectStatus === 'CLOSED') {
      if (closureRemarks) {
        filtered.push({
          id: 'system-closure-marker',
          is_system_message: true,
          is_closure_remarks: true,
          body: closureRemarks,
          created_at: new Date().toISOString()
        });
      } else {
        filtered.push({
          id: 'system-closure-marker',
          is_system_message: true,
          is_closure_remarks: false,
          body: 'Defect Closed via Import',
          created_at: new Date().toISOString()
        });
      }
    }

    return filtered;
  }, [allThreads, defectStatus, closureRemarks]);

  const { data: vesselUsers = [] } = useQuery({
    queryKey: ['vessel-users-thread', defectId],
    queryFn: async () => {
      try {
        return await defectApi.getVesselUsers(defectId);
      } catch (e) {
        return [];
      }
    },
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
        u.full_name.toLowerCase().includes(searchTerm.toLowerCase()) &&
        u.id !== user?.id
      );
      setMentionList(filtered);
      setShowMentions(filtered.length > 0);
    } else {
      setShowMentions(false);
    }
  };

  const selectMention = (u) => {
    const textBeforeCursor = replyText.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = replyText.slice(cursorPosition);
    const newText = replyText.slice(0, lastAtIndex) + `@${u.full_name} ` + textAfterCursor;
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
        uploadedAttachments.push({
          id: generateId(),
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
        author: user?.job_title || "Crew",
        body: replyText,
        tagged_user_ids: taggedUsers
      });

      for (const meta of uploadedAttachments) await defectApi.createAttachment(meta);

      setReplyText("");
      setFiles([]);
      setTaggedUsers([]);
      queryClient.invalidateQueries(['threads', defectId]);

    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // ✅ Handle Approval / Rejection
  const handleDecision = async (decision) => {
    if (!window.confirm(`Are you sure you want to ${decision} this closure request?`)) return;

    const newStatus = decision === 'ACCEPT' ? 'CLOSED' : 'OPEN';

    try {
      await defectApi.updateDefect(defectId, { status: newStatus });
      queryClient.invalidateQueries(['defects']);
      queryClient.invalidateQueries(['threads', defectId]);
    } catch (err) {
      alert("Action failed: " + err.message);
    }
  };


  const isMyMessage = (authorRole) => {
    return authorRole === user?.full_name || authorRole === user?.job_title;
  };

  // const extractMentions = (text) => {
  //   const parts = [];
  //   const mentionRegex = /@([\w][\w\s\-]*[\w]|[\w]+)/g;
  //   let lastIndex = 0;
  //   let match;

  //   while ((match = mentionRegex.exec(text)) !== null) {
  //     if (match.index > lastIndex) {
  //       parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
  //     }
  //     parts.push({ type: 'mention', content: match[0] });
  //     lastIndex = match.index + match[0].length;
  //   }

  //   if (lastIndex < text.length) {
  //     parts.push({ type: 'text', content: text.slice(lastIndex) });
  //   }

  //   return parts.length > 0 ? parts : [{ type: 'text', content: text }];
  // };

  const extractMentions = (text) => {
    const parts = [];
    // Build pattern from actual user names
    const names = vesselUsers.map(u =>
      (u.full_name || u.name || '').replace(/[-]/g, '\\-')
    ).filter(Boolean).sort((a, b) => b.length - a.length); // longest first

    if (names.length === 0) return [{ type: 'text', content: text }];

    const mentionRegex = new RegExp(
      `@(${names.join('|')})`, 'g'
    );

    let lastIndex = 0;
    let match;
    while ((match = mentionRegex.exec(text)) !== null) {
      if (match.index > lastIndex)
        parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      parts.push({ type: 'mention', content: match[0] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length)
      parts.push({ type: 'text', content: text.slice(lastIndex) });

    return parts.length > 0 ? parts : [{ type: 'text', content: text }];
  };

  useEffect(() => {
    if (!threadScrollRef.current) return;

    threadScrollRef.current.scrollTo({
      top: threadScrollRef.current.scrollHeight,
      behavior: 'smooth'
    });
  }, [threads]);


  return (
    <div className="thread-container">
      <div style={{ padding: '12px 15px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', fontWeight: '600', fontSize: '13px', color: '#334155', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <MessageSquare size={16} /> Discussion & Updates
      </div>
      <div
        ref={threadScrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '15px',
          height: '400px',
          background: '#fafafa'
        }}
      >

        {threads.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '13px', padding: '20px' }}>No messages yet.</div>
        ) : (
          threads.map(t => {
            // REPLACE WITH
            if (t.is_system_message) {
              if (t.is_closure_remarks) {
                return (
                  <div key={t.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '25px 0' }}>
                    <div style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: '12px',
                      padding: '12px 20px',
                      maxWidth: '85%',
                      textAlign: 'center',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                    }}>
                      <div style={{ color: '#15803d', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', marginBottom: '4px', letterSpacing: '0.05em' }}>
                        Closure Remark
                      </div>
                      <div style={{
                        color: '#44403c',
                        fontSize: '13px',
                        fontWeight: '500',
                        lineHeight: '1.5',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere'
                      }}>
                        {t.body}
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={t.id} style={{ textAlign: 'center', margin: '15px 0' }}>
                  <span style={{
                    background: '#f1f5f9',
                    fontSize: '11px',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    color: '#64748b',
                    fontWeight: '600'
                  }}>
                    {t.body} • {new Date(t.created_at).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              );
            }

            const isMine = isMyMessage(t.author_role);
            const messageParts = extractMentions(t.body);

            return (
              <div key={t.id} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isMine ? 'flex-end' : 'flex-start',
                marginBottom: '12px'
              }}>
                <div style={{
                  fontSize: '10px',
                  color: '#64748b',
                  marginBottom: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{ fontWeight: '600' }}>{t.author_role}</span>
                  <span>{new Date(t.created_at).toLocaleString()}</span>
                </div>
                <div style={{
                  maxWidth: '70%',
                  padding: '10px 14px',
                  background: isMine ? '#0084ff' : 'white',
                  color: isMine ? 'white' : '#1e293b',
                  borderRadius: isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere'
                }}>
                  <div style={{ fontSize: '14px', lineHeight: '1.4' }}>
                    {messageParts.map((part, idx) => (
                      part.type === 'mention' ? (
                        <span key={idx} style={{
                          background: isMine ? 'rgba(255,255,255,0.2)' : '#e3f2fd',
                          color: isMine ? 'white' : '#1565c0',
                          padding: '1px 4px',
                          borderRadius: '3px',
                          fontWeight: '600',
                          fontSize: '13px'
                        }}>
                          {part.content}
                        </span>
                      ) : (
                        <span key={idx}>{part.content}</span>
                      )
                    ))}
                  </div>
                  {t.attachments?.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {t.attachments.map(a => <AttachmentLink key={a.id} attachment={a} />)}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ✅ PENDING CLOSURE APPROVAL BOX */}
      {defectStatus === 'PENDING_CLOSURE' && (
        <div style={{
          padding: '10px 15px',
          background: '#fff7ed',
          borderTop: '1px solid #fdba74',
          borderBottom: '1px solid #fdba74',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          <div style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
            maxWidth: '100%'
          }}>
            <AlertOctagon size={20} color="#ea580c" style={{ marginTop: '2px', flexShrink: 0 }} />
            <div style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden'
            }}>
              <h4 style={{
                margin: '0 0 5px 0',
                color: '#9a3412',
                fontSize: '14px',
                fontWeight: '700'
              }}>
                Closure Requested
              </h4>
              <p style={{
                margin: 0,
                fontSize: '13px',
                color: '#334155',
                fontStyle: 'italic',
                marginBottom: '10px',
                wordWrap: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'pre-wrap',      // ✅ Preserve line breaks and wrap text
                wordBreak: 'break-word',     // ✅ Break long words if needed
                maxWidth: '100%',            // ✅ Don't exceed parent width
                overflow: 'hidden'           // ✅ Hide any overflow
              }}>
                "{closureRemarks || 'No remarks provided.'}"
              </p>

              {/* Only show buttons to Shore/Admin */}
              {canApprove ? (
                <div style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}>
                  <button
                    onClick={() => handleDecision('ACCEPT')}
                    style={{
                      background: '#16a34a',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <CheckCircle size={14} /> Accept & Close
                  </button>
                  <button
                    onClick={() => handleDecision('REJECT')}
                    style={{
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: '600',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <X size={14} /> Reject
                  </button>
                </div>
              ) : (
                <div style={{
                  fontSize: '12px',
                  color: '#ea580c',
                  fontWeight: '600'
                }}>
                  ⏳ Waiting for Shore Approval...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {defectStatus !== 'CLOSED' ? (
        <div style={{ padding: '12px', borderTop: '1px solid #e2e8f0', background: 'white' }}>
          <div style={{ position: 'relative' }}>
            <textarea
              style={{
                width: '100%',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '10px 70px 10px 10px',
                fontSize: '13px',
                height: '80px',      // 👈 FIXED
                resize: 'none',      // 👈 IMPORTANT
                outline: 'none'
              }}
              placeholder="Type an update (@ to mention)..."
              value={replyText}
              onChange={handleTextChange}
            />

            {/* SEND BUTTON INSIDE TEXTAREA */}
            <button
              onClick={handleReply}
              disabled={isUploading || (!replyText && files.length === 0)}
              style={{
                position: 'absolute',
                bottom: '27px',
                right: '15px',
                background: '#ea580c',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              <Send size={20} />
            </button>

            {/* MENTIONS DROPDOWN */}
            {showMentions && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '80px',
                  left: '10px',
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  zIndex: 100,
                  maxWidth: '250px',
                  maxHeight: '200px',
                  overflowY: 'auto'
                }}
              >
                {mentionList.map(u => (
                  <div
                    key={u.id}
                    onClick={() => selectMention(u)}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f1f5f9',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                  >
                    <UserCircle size={14} /> {u.full_name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ATTACHMENT ROW */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: '8px' }}>
            <label
              style={{
                cursor: 'pointer',
                color: '#64748b',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px'
              }}
            >
              <Paperclip size={16} />
              <input type="file" multiple hidden onChange={e => setFiles(Array.from(e.target.files))} />
              {files.length > 0 ? `${files.length} file(s)` : 'Attach'}
            </label>
          </div>
        </div>

      ) : (
        <div style={{ padding: '12px', borderTop: '1px solid #e2e8f0', textAlign: 'center', background: '#f8fafc', color: '#64748b', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
          <Lock size={14} /> Thread Locked (Defect Closed)
        </div>
      )}
    </div>
  );
};

// Image Sidebar Component
const ImageSidebar = ({ images, onClose, title }) => {
  const [selectedIndex, setSelectedIndex] = useState(null);

  // ✅ Download image function
  const handleDownload = async (img) => {
    try {
      console.log('📥 Downloading image:', img.name);

      // Fetch the image as a blob
      const response = await fetch(img.url);
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = img.name || 'image.jpg';
      document.body.appendChild(link);
      link.click();

      // Cleanup
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      console.log('✅ Download completed');
    } catch (error) {
      console.error('❌ Download failed:', error);
      alert('Failed to download image');
    }
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '320px',
          background: 'white',
          boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid #e2e8f0'
        }}
      >
        <div style={{
          padding: '15px 20px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#f8fafc'
        }}>
          <h3 style={{ margin: 0, fontSize: '15px', color: '#334155', fontWeight: '700' }}>
            {title} ({images.length})
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#94a3b8',
              padding: '4px',
              display: 'flex'
            }}
          >
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '15px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {images.map((img, idx) => (
              <div
                key={img.id}
                style={{
                  position: 'relative',
                  borderRadius: '8px',
                  overflow: 'visible', // ✅ Changed from 'hidden'
                  border: '2px solid #e2e8f0',
                  transition: 'all 0.2s'
                }}
              >
                {/* Image Container */}
                <div
                  style={{
                    position: 'relative',
                    borderRadius: '6px',
                    overflow: 'hidden'
                  }}
                >
                  {/* Image */}
                  <img
                    src={img.url}
                    alt={img.name}
                    onClick={() => setSelectedIndex(idx)}
                    style={{
                      width: '100%',
                      height: '180px',
                      objectFit: 'cover',
                      cursor: 'pointer',
                      display: 'block'
                    }}
                    onMouseEnter={(e) => e.currentTarget.parentElement.parentElement.style.borderColor = '#ea580c'}
                    onMouseLeave={(e) => e.currentTarget.parentElement.parentElement.style.borderColor = '#e2e8f0'}
                  />

                  {/* Image name overlay */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
                    padding: '8px',
                    color: 'white',
                    pointerEvents: 'none'
                  }}>
                    <p style={{
                      margin: 0,
                      fontSize: '11px',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {img.name}
                    </p>
                  </div>

                  {/* ✅ Download Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(img);
                    }}
                    style={{
                      position: 'absolute',
                      top: '-1px',
                      right: '-1px',
                      background: 'white',
                      border: '1px solid #e2e8f0',
                      borderRadius: '0px 0px 0px 50px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      zIndex: 10
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#ea580c';
                      e.currentTarget.style.borderColor = '#ea580c';
                      e.currentTarget.querySelector('svg').style.color = 'white';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'white';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.querySelector('svg').style.color = '#334155';
                    }}
                    title="Download Image"
                  >
                    <Download size={13} style={{ color: '#334155', transition: 'color 0.2s' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedIndex !== null && (
        <ImageGalleryModal
          images={images}
          initialIndex={selectedIndex}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </>
  );
};

// ✅ UPDATED: Image Upload Component (disabled when closed) 
const BeforeAfterImageUpload = ({ defectId, type, isMandatory, defectStatus }) => {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const [localPreviewIndex, setLocalPreviewIndex] = useState(null);

  const isClosed = defectStatus === 'CLOSED';

  const { data: existingImages = [] } = useQuery({
    queryKey: [`${type}-images`, defectId],
    queryFn: async () => {
      const images = await defectApi.getDefectImages(defectId, type);
      return images || [];
    }
  });

  const handleFileChange = (e) => {
    if (isClosed) return;
    const newFiles = Array.from(e.target.files);
    const MAX_SIZE = 1024 * 1024;
    const validFiles = [];

    newFiles.forEach(file => {
      if (file.size > MAX_SIZE) {
        alert(`⚠️ ${file.name} exceeds 1MB`);
      } else if (file.type.startsWith('image/')) {
        validFiles.push(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviewImages(prev => [...prev, {
            id: generateId(),
            url: e.target.result,
            name: file.name,
            fileRef: file
          }]);
        };
        reader.readAsDataURL(file);
      }
    });

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles]);
    }
    e.target.value = null;
  };

  const removeFile = (id) => {
    const itemToRemove = previewImages.find(p => p.id === id);
    if (!itemToRemove) return;
    setPreviewImages(prev => prev.filter(p => p.id !== id));
    setFiles(prev => prev.filter(f => f !== itemToRemove.fileRef));
  };

  const handleUpload = async () => {
    if (previewImages.length === 0 || isClosed) return;
    setIsUploading(true);
    try {
      for (const item of previewImages) {
        const imageId = generateId();
        const blobPath = await blobUploadService.uploadBinary(item.fileRef, defectId, imageId);
        await defectApi.saveDefectImage({
          id: imageId,
          defect_id: defectId,
          image_type: type,
          file_name: item.name,
          file_size: item.fileRef.size,
          blob_path: blobPath
        });
      }
      alert('✅ Images uploaded successfully!');
      setFiles([]);
      setPreviewImages([]);
      queryClient.invalidateQueries([`${type}-images`, defectId]);
    } catch (err) {
      alert('❌ Upload failed: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const existingImagesMapped = existingImages.map(img => ({
    id: img.id,
    url: img.image_url,
    name: img.file_name,
    uploaded: true
  }));

  return (
    <div style={{ padding: '12px', background: isClosed ? '#f8fafc' : 'white', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h4 style={{ margin: 0, fontSize: '13px', color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <ImageIcon size={14} />
          {type === 'before' ? 'Before' : 'After'}
          {existingImagesMapped.length > 0 && (
            <span style={{ fontSize: '10px', background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '10px', fontWeight: '600' }}>
              {existingImagesMapped.length} {existingImagesMapped.length === 1 ? 'Image' : 'Images'}

            </span>
          )}
        </h4>
        {existingImagesMapped.length > 0 && (
          <button
            onClick={() => setShowSidebar(true)}
            style={{ background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
          >
            View
          </button>
        )}
      </div>

      {!isClosed && (
        <>
          {/* ✅ LIST SHOWN ABOVE UPLOAD BUTTONS */}
          {previewImages.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
              {previewImages.map((img, idx) => (
                <div
                  key={img.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#f1f5f9',
                    padding: '5px 10px',
                    borderRadius: '4px',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  <span
                    onClick={() => setLocalPreviewIndex(idx)}
                    style={{
                      fontSize: '13px',
                      color: '#2563eb',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '85%'
                    }}
                    title="View Full Image"
                  >
                    {img.name}
                  </span>
                  <X
                    size={14}
                    color="#ef4444"
                    style={{ cursor: 'pointer' }}
                    onClick={() => removeFile(img.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* ACTION BUTTONS */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="file" multiple accept="image/*" id={`${type}-upload-${defectId}`} onChange={handleFileChange} hidden />
            <label
              htmlFor={`${type}-upload-${defectId}`}
              style={{
                cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px',
                color: '#ea580c', fontWeight: '600', fontSize: '11px', padding: '6px 12px',
                border: '1px dashed #cbd5e1', borderRadius: '4px', background: '#f8fafc'
              }}
            >
              <Upload size={12} /> Select Image
            </label>

            {previewImages.length > 0 && (
              <button
                onClick={handleUpload}
                disabled={isUploading}
                style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', padding: '7px 12px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
              >
                {isUploading ? 'Uploading...' : 'Upload'}
              </button>
            )}
          </div>
        </>
      )}

      {isMandatory && existingImagesMapped.length === 0 && (
        <div style={{ marginTop: '8px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: '4px', padding: '6px', fontSize: '10px', color: '#92400e', fontWeight: '600', textAlign: 'center' }}>
          ⚠️ MANDATORY
        </div>
      )}

      {showSidebar && (
        <ImageSidebar
          images={existingImagesMapped}
          onClose={() => setShowSidebar(false)}
          title={`${type === 'before' ? 'Before' : 'After'} Images`}
        />
      )}

      {localPreviewIndex !== null && (
        <ImageGalleryModal
          images={previewImages}
          initialIndex={localPreviewIndex}
          onClose={() => setLocalPreviewIndex(null)}
        />
      )}
    </div>
  );
};

const INITIAL_NEW_DEFECT = {
  date_identified: new Date().toISOString().split('T')[0],
  target_close_date: '',
  defect_source: 'Internal Audit',
  equipment_name: '',
  description: '',
  priority: 'LOW',
  status: 'OPEN',
  pr_number: '',
  is_flagged: false,
  is_dd: false,
};

const useColumnResize = (setColumnWidths) => {
  const startXRef = useRef(0);
  const colRef = useRef(null);

  const onMouseMove = (e) => {
    if (!colRef.current) return;

    const delta = e.clientX - startXRef.current;

    setColumnWidths(prev => {
      const minWidth = COLUMN_MIN_WIDTHS[colRef.current] || 60;
      const newWidth = prev[colRef.current] + delta;

      return {
        ...prev,
        [colRef.current]: Math.max(newWidth, minWidth)
      };
    });

    startXRef.current = e.clientX;
  };

  const onMouseUp = () => {
    colRef.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };

  const onMouseDown = (e, colKey) => {
    startXRef.current = e.clientX;
    colRef.current = colKey;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return { onMouseDown };
};


// ✅ Main Dashboard Component
const VesselDashboard = () => {
  const { user } = useAuth();
  const ALLOWED_DELETE_EMAILS = ['chief.tapi@drs.com'];
  const canDelete = ALLOWED_DELETE_EMAILS.includes(user?.email);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const vesselImo = user?.assigned_vessels?.[0]?.imo || user?.assigned_vessel_imos?.[0] || '';
  console.log(vesselImo)
  const [showCreateRow, setShowCreateRow] = useState(false);
  const rowRefs = useRef({});
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [activeDescDefect, setActiveDescDefect] = useState(null);
  const [descDraft, setDescDraft] = useState('');

  const [showColumnModal, setShowColumnModal] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState([
    'date',
    'deadline',
    'source',
    'equipment',
    'description',
    'priority',
    'status',
    'deadline_icon',
    'chat',
    'flag',
    'dd',
    'pr_details'
  ]); // Default: all columns visible (icons split into separate columns)


  const [newDefect, setNewDefect] = useState(INITIAL_NEW_DEFECT);

  const EMPTY_FILTERS = {
    date_identified_from: '',
    date_identified_to: '',
    date_identified_sort: '',
    target_close_date: '',
    target_close_date_sort: '',
    equipment: [],
    description: '',
    priority: [],
    status: [],
    pr_number: '',
    pr_status: '',
    defect_source: [],
    deadline_status: [],
    is_flagged: [],
    is_dd: [],
    pending_closure: '',
    text_sort: { field: null, dir: 'asc' }
  };

  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const sf = {
    ...EMPTY_FILTERS,
    ...filters,
    equipment: filters.equipment ?? [],
    priority: filters.priority ?? [],
    status: filters.status ?? [],
    defect_source: filters.defect_source ?? [],
    deadline_status: filters.deadline_status ?? [],
    is_flagged: filters.is_flagged ?? [],
    is_dd: filters.is_dd ?? [],
    text_sort: filters.text_sort ?? { field: null, dir: 'asc' },
  };

  const hasActiveFilters = useMemo(() => {
    return (
      sf.date_identified_from ||
      sf.date_identified_to ||
      sf.target_close_date ||
      sf.equipment.length > 0 ||
      sf.description ||
      sf.priority.length > 0 ||
      sf.status.length > 0 ||
      sf.pr_number ||
      sf.defect_source.length > 0 ||
      sf.deadline_status.length > 0 ||
      sf.is_flagged.length > 0 ||
      sf.is_dd.length > 0 ||
      sf.pending_closure
    );
  }, [filters]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.date_identified_from || filters.date_identified_to) count++;
    if (filters.target_close_date) count++;
    if (sf.equipment.length > 0) count++;
    if (sf.description?.trim()) count++;
    if (sf.priority.length > 0) count++;
    if (sf.status.length > 0) count++;
    if (filters.pr_number) count++;
    if (sf.defect_source.length > 0) count++;
    if (sf.deadline_status.length > 0) count++;
    if (sf.is_flagged.length > 0) count++;
    if (sf.is_dd.length > 0) count++;
    if (filters.pending_closure) count++;
    return count;
  }, [filters]);

  const clearAllFilters = () => {
    setFilters(EMPTY_FILTERS);
    setCurrentPage(1);
  };

  const [columnWidths, setColumnWidths] = useState({
    sno: 20,
    date_identified: 20,
    target_close_date: 20,
    defect_source: 20,
    equipment: 20,
    pr_number: 20
  });



  const { onMouseDown } = useColumnResize(setColumnWidths);
  const [expandedId, setExpandedId] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [expandedDescId, setExpandedDescId] = useState(null);
  const [activePrId, setActivePrId] = useState(null);
  const createRowRef = useRef(null);

  // ✅ NOTIFICATION PARSING: State for yellow highlighting
  const [highlightedId, setHighlightedId] = useState(null);
  const [closureModalOpen, setClosureModalOpen] = useState(false);
  const [closureDefect, setClosureDefect] = useState(null);
  const [closureValidation, setClosureValidation] = useState(null);

  const { data: rawDefects, isLoading } = useQuery({
    queryKey: ['defects', vesselImo],
    queryFn: () => defectApi.getDefects(vesselImo),
  });
  const defects = Array.isArray(rawDefects) ? rawDefects : rawDefects?.items ?? rawDefects?.data ?? [];

  const { data: userPreferences, isLoading: preferencesLoading } = useQuery({
    queryKey: ['user-preferences'],
    queryFn: defectApi.getUserPreferences,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // ✅ CRITICAL: Load saved column preferences when data arrives (with migration)
  useEffect(() => {
    if (!userPreferences?.preferences?.vessel_columns) return;

    const columns = userPreferences.preferences.vessel_columns;

    console.log('📥 Loading saved column order from database:', columns);

    // Handle migration from old structure
    if (columns.includes('priority_status')) {
      const migrated = columns
        .filter(c => c !== 'priority_status')
        .concat(['priority', 'status', 'deadline_icon', 'chat']);

      console.log('🔄 Migrating old column structure:', migrated);
      setVisibleColumns(migrated);
      updateColumnsMutation.mutate(migrated);
    } else {
      // ✅ Use saved order as-is
      setVisibleColumns(columns);
    }
  }, [userPreferences, location.pathname]);


  // ✅ NEW: Mutation to save column preferences
  const updateColumnsMutation = useMutation({
    mutationFn: defectApi.updateColumnPreferences,
    onSuccess: (data) => {
      console.log('✅ Column preferences saved to database');
    },
    onError: (error) => {
      console.error('❌ Failed to save column preferences:', error);
    }
  });


  // ✅ NEW: Helper function to check if column is visible
  const isColumnVisible = (columnId) => visibleColumns.includes(columnId);

  // ✅ NEW: Calculate dynamic colspan based on visible columns
  const calculateColspan = () => {
    let count = 1; // S.No column (always visible)
    if (isColumnVisible('date')) count++;
    if (isColumnVisible('deadline')) count++;
    if (isColumnVisible('source')) count++;
    if (isColumnVisible('equipment')) count++;
    if (isColumnVisible('description')) count++;
    if (isColumnVisible('priority')) count++;
    if (isColumnVisible('status')) count++;
    if (isColumnVisible('deadline_icon')) count++;
    if (isColumnVisible('chat')) count++;
    if (isColumnVisible('flag')) count++;
    if (isColumnVisible('dd')) count++;
    if (isColumnVisible('pr_details')) count++;
    if (isEditMode) count++;
    return count;
  };

  // ✅ NEW: Handle column customization save
  const handleSaveColumns = async (selectedColumns) => {
    setVisibleColumns(selectedColumns);
    await updateColumnsMutation.mutateAsync(selectedColumns);
  };

  // ✅ NEW: Listen for column customization event from VesselLayout
  useEffect(() => {
    const handleOpenModal = () => {
      console.log('🎯 Opening column customization modal');
      setShowColumnModal(true);
    };

    window.addEventListener('openColumnCustomization', handleOpenModal);

    return () => {
      window.removeEventListener('openColumnCustomization', handleOpenModal);
    };
  }, []);
  const pendingOpenDefectRef = useRef(null);
  const isNotificationRef = useRef(false);
  const hasNavigatedRef = useRef(false); // ✅ NEW: Track if we've already navigated

  useEffect(() => {
    const highlightDefectId = searchParams.get('highlightDefectId');
    const targetId = highlightDefectId || location.state?.autoOpenDefectId;

    if (!targetId || defects.length === 0) return;

    // ✅ Prevent re-running after we've already handled this defect
    if (hasNavigatedRef.current === targetId) return;

    const defectIndex = defects.findIndex(d => d.id === targetId);
    if (defectIndex === -1) return;

    console.log('🎯 Auto-opening defect:', targetId);

    isNotificationRef.current = true;
    pendingOpenDefectRef.current = targetId;
    hasNavigatedRef.current = targetId; // ✅ Mark as handled

    // Clear all filters to ensure defect is visible
    setFilters(EMPTY_FILTERS);

    // Calculate target page
    const targetPage = Math.ceil((defectIndex + 1) / pageSize);
    console.log(`📄 Defect is on page ${targetPage}, current page: ${currentPage}`);
    console.group("🔎 PAGE VERIFICATION");
    console.log("Clicked defect:", targetId);
    console.log("Defect index:", defectIndex);
    console.log("Page size:", pageSize);
    console.log("Expected page:", targetPage);
    console.log("Current page BEFORE set:", currentPage);
    console.groupEnd();


    // ✅ Navigate to target page (second effect will handle expansion)
    setCurrentPage(targetPage);

    // Clean up query params
    if (highlightDefectId) {
      searchParams.delete('highlightDefectId');
      setSearchParams(searchParams, { replace: true });
    }

    if (location.state?.autoOpenDefectId) {
      window.history.replaceState({}, document.title);
    }

  }, [defects, pageSize, searchParams, setSearchParams, location.state]); // ✅ Removed currentPage

  useEffect(() => {
    if (pendingOpenDefectRef.current) return;

    setCurrentPage(1);
  }, [filters]);

  useEffect(() => {
    const handleClickOutside = () => setExpandedDescId(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    if (showCreateRow && createRowRef.current) {
      createRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, [showCreateRow]);

  // ✅ Auto-calculate deadline as 15 days from date_identified
  useEffect(() => {
    if (newDefect.date_identified && showCreateRow) {
      const identifiedDate = new Date(newDefect.date_identified);
      identifiedDate.setDate(identifiedDate.getDate() + 15);
      const deadlineDate = identifiedDate.toISOString().split('T')[0];

      setNewDefect(prev => ({
        ...prev,
        target_close_date: deadlineDate
      }));
    }
  }, [newDefect.date_identified, showCreateRow]);


  const equipmentList = useMemo(
    () =>
      [...new Set(defects.map(d => d.equipment_name).filter(Boolean))],
    [defects]
  );

  const openCount = defects.filter(d => d.status === 'OPEN').length;
  const highPriorityCount = defects.filter(d => d.priority === 'HIGH').length;

  const criticalCount = defects.filter(d => d.priority === 'CRITICAL').length;
  const closedCount = defects.filter(d => d.status === 'CLOSED').length;


  const updateMutation = useMutation({
    mutationFn: ({ id, updates }) => defectApi.updateDefect(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries(['defects', vesselImo]);

      // Snapshot previous value
      const previousDefects = queryClient.getQueryData(['defects', vesselImo]);

      // Optimistically update
      queryClient.setQueryData(['defects', vesselImo], (old) =>
        old?.map(d => d.id === id ? { ...d, ...updates } : d)
      );

      return { previousDefects };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      queryClient.setQueryData(['defects', vesselImo], context.previousDefects);
    },
    onSettled: () => {
      // Refetch to ensure sync
      queryClient.invalidateQueries(['defects', vesselImo]);
    }
  });

  // ✅ UPDATED: Handle inline update with status validation
  const handleInlineUpdate = async (id, field, value) => {
    const defect = defects.find(d => d.id === id);
    if (!defect || defect[field] === value) return;

    // ✅ If changing status to CLOSED, open enhanced modal
    if (field === 'status' && value === 'CLOSED') {
      try {
        // Validate images first
        const validation = await defectApi.validateDefectImages(id);

        // Store data and open modal
        setClosureDefect(defect);
        setClosureValidation(validation);
        setClosureModalOpen(true);

      } catch (error) {
        alert('❌ Error validating defect: ' + error.message);
      }
      return;
    }

    updateMutation.mutate({ id, updates: { [field]: value } });
  };

  const scrollRowBelowHeader = (rowId) => {
    const anchor = document.getElementById(`row-${rowId}`);
    if (!anchor) return;

    anchor.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };



  const DeadlineIcon = ({ date }) => {
    const status = getDeadlineStatus(date);

    // REPLACE WITH
    const config = {
      NORMAL: { color: '#00a115', title: 'Due Date OK' },
      WARNING: { color: '#f59e0b', title: 'Due Date within 15 days' },
      OVERDUE: { color: '#dc2626', title: 'Due Date crossed' }
    };

    return (
      <Clock
        size={20}
        color={config[status].color}
        title={config[status].title}
      />
    );
  };



  const filteredData = useMemo(() => {
    if (!Array.isArray(defects) || defects.length === 0) return [];

    const safeFilters = {
      ...EMPTY_FILTERS,
      ...filters,
      is_flagged: filters.is_flagged ?? [],
      is_dd: filters.is_dd ?? [],
      deadline_status: filters.deadline_status ?? [],
      is_owner: filters.is_owner ?? [],
      priority: filters.priority ?? [],
      status: filters.status ?? [],
      equipment: filters.equipment ?? [],
      vessel: filters.vessel ?? [],
      defect_source: filters.defect_source ?? [],
      text_sort: filters.text_sort ?? { field: null, dir: 'asc' },
    };

    let data = defects.filter(d => {
      const prString = d.pr_entries?.map(p => p.pr_number).join(', ') || '';

      const reportDate = d.date_identified
        ? new Date(d.date_identified.split('T')[0])
        : null;

      const fromDate = filters.date_identified_from
        ? new Date(filters.date_identified_from)
        : null;

      const toDate = filters.date_identified_to
        ? new Date(filters.date_identified_to)
        : null;
      const matchFlagged =
        safeFilters.is_flagged.length === 0 ||
        safeFilters.is_flagged.includes(String(d.is_flagged));

      const matchDD =
        safeFilters.is_dd.length === 0 ||
        safeFilters.is_dd.includes(String(d.is_dd));

      const matchReportDate =
        (!fromDate || (reportDate && reportDate >= fromDate)) &&
        (!toDate || (reportDate && reportDate <= toDate));

      const matchDeadline = (() => {
        if (!filters.target_close_date) return true;
        if (!d.target_close_date) return false;

        const defectDeadline = new Date(d.target_close_date.split('T')[0]);
        const filterDate = new Date(filters.target_close_date);

        return defectDeadline < filterDate;
      })();


      const matchSource =
        (safeFilters.defect_source?.length || 0) === 0 ||
        safeFilters.defect_source.includes(d.defect_source);


      const matchEquip =
        (safeFilters.equipment?.length || 0) === 0 ||
        safeFilters.equipment.includes(d.equipment_name);

      const matchDesc =
        !filters.description ||
        d.description.toLowerCase().includes(filters.description.toLowerCase());

      const matchPrior =
        safeFilters.priority.length === 0 ||
        safeFilters.priority.includes(d.priority);

      const matchStatus =
        isEditMode
          ? d.status === 'OPEN'
          : safeFilters.status.length === 0 || safeFilters.status.includes(d.status);

      const matchPrNo =
        !filters.pr_number ||
        prString.toLowerCase().includes(filters.pr_number.toLowerCase());

      const matchPrStatus =
        !filters.pr_status || d.pr_status === filters.pr_status;

      const matchDeadlineStatus =
        safeFilters.deadline_status.length === 0 ||
        safeFilters.deadline_status.includes(getDeadlineStatus(d.target_close_date));

      const matchPendingClosure =
        !filters.pending_closure ||
        d.status === 'PENDING_CLOSURE';

      const matchVessel =
        (safeFilters.vessel?.length || 0) === 0 ||
        safeFilters.vessel.includes(d.vessel_name);



      return (
        matchReportDate &&
        matchDeadline &&
        matchEquip &&
        matchDesc &&
        matchPrior &&
        matchStatus &&
        matchPrNo &&
        matchPrStatus &&
        matchSource &&
        matchDeadlineStatus &&
        matchPendingClosure &&
        matchVessel &&
        matchFlagged &&  // ✅ NEW
        matchDD
      );
    });

    /* 🔽 SORTING LOGIC (SINGLE COLUMN AT A TIME) */
    // ─── UNIFIED SORT (flag is permanent secondary on all non-flag columns) ───
    const hasExplicitSort =
      filters.text_sort?.field ||
      filters.date_identified_sort ||
      filters.target_close_date_sort;

    if (!hasExplicitSort) {
      // Default: flagged to top, then newest date
      data.sort((a, b) => {
        const flagDiff = (b.is_flagged ? 1 : 0) - (a.is_flagged ? 1 : 0);
        if (flagDiff !== 0) return flagDiff;
        const da = a.date_identified ? new Date(a.date_identified) : new Date(0);
        const db = b.date_identified ? new Date(b.date_identified) : new Date(0);
        return db - da;
      });

    } else if (filters.text_sort?.field === 'flag') {
      // Flag column: pure flag sort, date as tiebreaker
      data.sort((a, b) => {
        const bA = a.is_flagged ? 1 : 0;
        const bB = b.is_flagged ? 1 : 0;
        if (bA !== bB) return filters.text_sort.dir === 'asc' ? bA - bB : bB - bA;
        const da = a.date_identified ? new Date(a.date_identified) : new Date(0);
        const db = b.date_identified ? new Date(b.date_identified) : new Date(0);
        return db - da;
      });

    } else {
      // All other columns: flag floats within each sorted group
      const primarySort = (() => {
        if (filters.date_identified_sort) {
          return (a, b) => {
            const da = a.date_identified ? new Date(a.date_identified) : null;
            const db = b.date_identified ? new Date(b.date_identified) : null;
            if (!da || !db) return 0;
            return filters.date_identified_sort === 'asc' ? da - db : db - da;
          };
        }
        if (filters.target_close_date_sort) {
          return (a, b) => {
            const da = a.target_close_date ? new Date(a.target_close_date) : null;
            const db = b.target_close_date ? new Date(b.target_close_date) : null;
            if (!da || !db) return 0;
            return filters.target_close_date_sort === 'asc' ? da - db : db - da;
          };
        }

        const { field, dir } = filters.text_sort;
        const fieldMap = {
          vessel: 'vessel_name',
          equipment: 'equipment_name',
          source: 'defect_source',
          description: 'description',
          date_identified: 'date_identified',
          target_close_date: 'target_close_date',
          priority: 'priority',
          status: 'status',
          deadline_icon: 'target_close_date',
          dd: 'is_dd',
        };

        return (a, b) => {
          const key = fieldMap[field];
          const valA = a[key];
          const valB = b[key];

          if (field === 'priority') {
            const w = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            const wA = w[String(valA).toUpperCase()] ?? 99;
            const wB = w[String(valB).toUpperCase()] ?? 99;
            return dir === 'asc' ? wA - wB : wB - wA;
          }
          if (field === 'status') {
            const w = { OPEN: 0, PENDING_CLOSURE: 1, CLOSED: 2 };
            return dir === 'asc'
              ? (w[valA] ?? 99) - (w[valB] ?? 99)
              : (w[valB] ?? 99) - (w[valA] ?? 99);
          }
          if (field === 'dd') {
            return dir === 'asc'
              ? (valA ? 1 : 0) - (valB ? 1 : 0)
              : (valB ? 1 : 0) - (valA ? 1 : 0);
          }
          if (['date_identified', 'target_close_date', 'deadline_icon'].includes(field)) {
            const dA = valA ? new Date(valA).getTime() : 0;
            const dB = valB ? new Date(valB).getTime() : 0;
            return dir === 'asc' ? dA - dB : dB - dA;
          }
          // Default: string sort
          const strA = String(valA || '').toLowerCase();
          const strB = String(valB || '').toLowerCase();
          return dir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        };
      })();

      data.sort((a, b) => {
        const primaryResult = primarySort(a, b);
        if (primaryResult !== 0) return primaryResult;
        // 🚩 Flagged rows rise within same primary-sort group
        return (b.is_flagged ? 1 : 0) - (a.is_flagged ? 1 : 0);
      });
    }
    // ─── END UNIFIED SORT ───
    return data;
  }, [defects, filters, isEditMode]);


  const handleFilterChange = (field, value) => {
    setCurrentPage(1);
    setFilters(prev => ({
      ...prev,
      ...(field === 'date_identified_sort'
        ? { target_close_date_sort: '' }
        : field === 'target_close_date_sort'
          ? { date_identified_sort: '' }
          : {}),
      [field]: value
    }));
  };

  const handleTextSort = (field) => {
    setFilters(prev => {
      const current = prev.text_sort;
      const nextDir = current.field === field
        ? current.dir === 'asc' ? 'desc'
          : current.dir === 'desc' ? null
            : 'asc'
        : 'asc';

      return {
        ...prev,
        date_identified_sort: '',
        target_close_date_sort: '',
        text_sort: nextDir === null
          ? { field: null, dir: 'asc' }
          : { field, dir: nextDir }
      };
    });
  };


  const getPriorityIcon = (priority) => {
    const colorMap = {
      CRITICAL: '#dc2626',   // red
      HIGH: '#f97316',       // orange
      MEDIUM: '#2563eb',     // blue
      LOW: '#16a34a'      // green
    };

    return (
      <AlertTriangle
        size={20}
        color={colorMap[priority] || '#94a3b8'}
      />
    );
  };


  const getStatusIcon = (status) => {
    if (status === 'CLOSED') {
      return <Flower size={20} color="#22c55e" title="Closed" />;
    }
    if (status === 'PENDING_CLOSURE') {
      return <Flower size={20} color="#f59e0b" title="Pending Closure" />;
    }
    return <Flower size={20} color="#3b82f6" title="Open" />;
  };


  const getFlagIcon = (value) => (
    <Flag
      size={18}
      color={value ? '#e8290b' : '#8e8d8d'}
      fill={value ? '#e8290b' : 'none'}
      strokeWidth={value ? 2 : 1.5}
      style={{ transition: 'all 0.15s ease' }}
      title={value ? 'Flagged' : 'Not Flagged'}
    />
  );

  const getDDIcon = (value) => (
    <div
      style={{
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: `${value ? '1.5px solid #0ea5e9' : '2px solid #9ca3af'}`,
        background: value ? '#e0f2fe' : 'transparent',
        color: value ? '#0ea5e9' : '#9ca3af',
        fontSize: '9px',
        fontWeight: 'bold',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
        transition: 'all 0.2s'
      }}
      title={value ? 'Dry Dock — Active' : 'Not Dry Dock'}
    >
      DD
    </div>
  );

  const normalizeDate = (dateStr) => {
    if (!dateStr) return '';
    return dateStr.split('T')[0];
  };

  const deleteMutation = useMutation({
    mutationFn: (id) => defectApi.removeDefect(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['defects']);
    },
    onError: (err) => {
      alert("Failed to delete: " + err.message);
    }
  });

  const handleDelete = (id) => {
    if (!canDelete) return;
    const confirmed = window.confirm(
      "⚠️ Are you sure you want to delete this defect?\n\nThis action cannot be undone."
    );
    if (!confirmed) return;
    deleteMutation.mutate(id);
  };

  const handleCreateSave = async () => {
    if (!newDefect.equipment_name || !newDefect.description) {
      alert('Area of Concern and Description are required');
      return;
    }

    const defectId = generateId(); // ✅ DEFINE ONCE

    try {
      // -------------------------------------------------------------
      // 1️⃣ Construct the Full Package (to save as JSON backup)
      // -------------------------------------------------------------
      const fullPackage = {
        id: defectId,
        vessel_imo: vesselImo,
        date: newDefect.date_identified,
        target_close_date: newDefect.target_close_date,
        equipment: newDefect.equipment_name,
        description: newDefect.description,
        priority: newDefect.priority,
        status: newDefect.status,
        responsibility: 'Engine Dept',
        defect_source: newDefect.defect_source,
        created_at: new Date().toISOString(),
        is_flagged: newDefect.is_flagged === true,
        is_dd: newDefect.is_dd === true,
      };

      // -------------------------------------------------------------
      // 2️⃣ Upload JSON Backup to Azure Blob Storage & Wait for Path
      // -------------------------------------------------------------
      console.log('📦 [DASHBOARD] Uploading JSON metadata backup...');
      const jsonBackupPath = await blobUploadService.uploadMetadataJSON(fullPackage, defectId);

      if (!jsonBackupPath) {
        throw new Error("Failed to generate JSON backup path. Check console logs.");
      }
      console.log('✅ [DASHBOARD] JSON path received:', jsonBackupPath);


      // -------------------------------------------------------------
      // 3️⃣ Create Defect in API (Passing the JSON Path)
      // -------------------------------------------------------------
      await defectApi.createDefect({
        ...fullPackage,
        json_backup_path: jsonBackupPath // ✅ CRITICAL: Pass the path here
      });

      // -------------------------------------------------------------
      // 4️⃣ Create PR entry (SEPARATE TABLE)
      // -------------------------------------------------------------
      if (newDefect.pr_number?.trim()) {
        await defectApi.createPrEntry({
          defect_id: defectId,
          pr_number: newDefect.pr_number.trim()
        });
      }

      setNewDefect(INITIAL_NEW_DEFECT);
      setShowCreateRow(false);

      setHighlightedId(defectId);
      queryClient.invalidateQueries(['defects']);
      alert("✅ Defect Created Successfully!");

      setTimeout(() => {
        setHighlightedId(null);
      }, 3000);

    } catch (err) {
      console.error("❌ Creation Failed:", err);
      alert(`Failed to create defect: ${err.message}`);
    }
  };

  const handleKpiFilter = (type) => {
    setCurrentPage(1);
    setFilters(prev => {
      const currentStatus = Array.isArray(prev.status) ? prev.status : [];
      const currentPriority = Array.isArray(prev.priority) ? prev.priority : [];
      const currentDeadline = Array.isArray(prev.deadline_status) ? prev.deadline_status : [];

      switch (type) {
        case 'OPEN':
          return currentStatus.includes('OPEN') && currentStatus.length === 1
            ? { ...prev, status: [] }
            : { ...prev, status: ['OPEN'], priority: [], deadline_status: [], pending_closure: '' };

        case 'HIGH':
          return currentPriority.includes('HIGH') && currentPriority.length === 1
            ? { ...prev, priority: [] }
            : { ...prev, priority: ['HIGH'], status: [], deadline_status: [], pending_closure: '' };

        case 'CRITICAL':
          return currentPriority.includes('CRITICAL') && currentPriority.length === 1
            ? { ...prev, priority: [] }
            : { ...prev, priority: ['CRITICAL'], status: [], deadline_status: [], pending_closure: '' };

        case 'OVERDUE':
          return currentDeadline.includes('OVERDUE') && currentDeadline.length === 1
            ? { ...prev, deadline_status: [], status: [] }
            : { ...prev, deadline_status: ['OVERDUE'], status: ['OPEN'], priority: [], pending_closure: '' };

        case 'PENDING_CLOSURE':
          return prev.pending_closure
            ? { ...prev, pending_closure: '', status: [] }
            : { ...prev, pending_closure: 'YES', status: ['PENDING_CLOSURE'], priority: [], deadline_status: [] };

        case 'CLOSED':
          return currentStatus.includes('CLOSED') && currentStatus.length === 1
            ? { ...prev, status: [] }
            : { ...prev, status: ['CLOSED'], priority: [], deadline_status: [], pending_closure: '' };

        default:
          return prev;
      }
    });
  };


  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));
  const paginatedData = useMemo(
    () => paginate(filteredData, currentPage, pageSize),
    [filteredData, currentPage, pageSize]
  );



  useEffect(() => {
    const targetId = pendingOpenDefectRef.current;
    if (!targetId) return;

    let attempts = 0;
    const maxAttempts = 10;

    const tryFindRow = () => {
      const rowEl = document.getElementById(`row-${targetId}`);

      if (!rowEl && attempts < maxAttempts) {
        attempts++;
        console.log(`⏳ Attempt ${attempts}: Row not ready yet, retrying...`);
        setTimeout(tryFindRow, 50); // Try again in 50ms
        return;
      }

      if (!rowEl) {
        console.log('❌ Row not found after max attempts');
        pendingOpenDefectRef.current = null;
        hasNavigatedRef.current = null;
        return;
      }

      console.log('✅ Row found, expanding and scrolling:', targetId);

      setExpandedId(targetId);
      setHighlightedId(targetId);

      // wait one more frame after expansion renders
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.getElementById(`row-${targetId}`);
          if (el) {
            el.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          }
        });
      });


      setTimeout(() => setHighlightedId(null), 3000);

      pendingOpenDefectRef.current = null;
      hasNavigatedRef.current = null;
    };

    tryFindRow();

  }, [currentPage, paginatedData]);


  const overdueCount = defects.filter(
    d => getDeadlineStatus(d.target_close_date) === 'OVERDUE' &&
      d.status !== 'CLOSED' &&
      d.status !== 'PENDING_CLOSURE'
  ).length;
  const pendingClosureCount = defects.filter(d => d.status === 'PENDING_CLOSURE').length;

  const totalActiveColumns = useMemo(() => {
    let count = 1; // S.No (Always visible)
    if (isColumnVisible('date')) count++;
    if (isColumnVisible('deadline')) count++;
    if (isColumnVisible('source')) count++;
    if (isColumnVisible('equipment')) count++;
    if (isColumnVisible('description')) count++;
    if (isColumnVisible('priority_status')) count++;
    if (isColumnVisible('pr_details')) count++;
    if (isEditMode) count++; // Delete column in edit mode
    return count;
  }, [visibleColumns, isEditMode]);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(prev => prev - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(prev => prev + 1);
  };

  const startIndex = (currentPage - 1) * pageSize + 1
  const endIndex = Math.min(currentPage * pageSize, filteredData.length)


  const totalColumns = isEditMode ? 9 : 8; // Adjust these numbers based on your actual column count
  if (isLoading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading Dashboard...</div>;

  return (
    <div className="dashboard-wrapper">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <h1 className="page-title">Vessel Overview</h1>
          <button
            onClick={() => setIsEditMode(!isEditMode)}
            style={{
              background: isEditMode ? '#ea580c' : 'white',
              color: isEditMode ? 'white' : '#334155',
              border: '1px solid #cbd5e1',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s'
            }}
          >
            <Edit3 size={16} />
            {isEditMode ? 'Exit Edit Mode' : 'Enable Edit Mode'}
          </button>
        </div>
        {/* <div style={{ display: 'flex', gap: '10px' }}>
          <span className="badge badge-normal">Total: {filteredData.length}</span>
          <span className="badge badge-critical">High/Crit: {highPriorityCount}</span>
        </div> */}
      </div>

      <div className="kpi-grid">
        <div
          className={`kpi-card blue ${sf.status.includes('OPEN') ? 'active' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleKpiFilter('OPEN')}

        >
          <div className="kpi-icon"
          ><AlertTriangle size={24} /></div>
          <div className="kpi-data">
            <h2>{openCount}</h2>
            <p>Open Defects</p>
          </div>
        </div>

        <div
          className={`kpi-card orange ${sf.priority.includes('HIGH') ? 'active' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleKpiFilter('HIGH')}
        >
          <div className="kpi-icon">
            <AlertTriangle size={24} />
          </div>
          <div className="kpi-data">
            <h2>{highPriorityCount}</h2>
            <p>High Priority</p>
          </div>
        </div>

        <div
          className={`kpi-card red ${sf.priority.includes('CRITICAL') ? 'active' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleKpiFilter('CRITICAL')}
        >
          <div className="kpi-icon">
            <AlertOctagon size={24} />
          </div>
          <div className="kpi-data">
            <h2>{criticalCount}</h2>
            <p>Critical Defects</p>
          </div>
        </div>


        {/* ✅ NEW OVERDUE CARD */}
        <div
          className={`kpi-card red ${sf.deadline_status.includes('OVERDUE') ? 'active' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleKpiFilter('OVERDUE')}
        >
          <div className="kpi-icon">
            <Clock size={24} />
          </div>
          <div className="kpi-data">
            <h2>{overdueCount}</h2>
            <p>Overdue Defects</p>
          </div>
        </div>

        <div
          className={`kpi-card orange ${filters.pending_closure ? 'active' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleKpiFilter('PENDING_CLOSURE')}
        >
          <div className="kpi-icon">
            <Clock size={24} />
          </div>
          <div className="kpi-data">
            <h2>{pendingClosureCount}</h2>
            <p>Pending Closure</p>
          </div>
        </div>


        <div
          className={`kpi-card green ${sf.status.includes('CLOSED') ? 'active' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => handleKpiFilter('CLOSED')}
        >
          <div className="kpi-icon">
            <CheckCircle size={24} />
          </div>
          <div className="kpi-data">
            <h2>{closedCount}</h2>
            <p>Total Closed</p>
          </div>
        </div>

      </div>


      <div className="table-card">
        <div className='table-action-bar'>
          {/* LEFT: Create Defect Button */}
          <button
            onClick={() => {
              setCurrentPage(1);
              setShowCreateRow(true);
            }}

            disabled={showCreateRow}
            style={{
              background: '#ea580c',
              color: 'white',
              border: 'none',
              padding: '8px 14px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              marginLeft: '10px',
              cursor: showCreateRow ? 'not-allowed' : 'pointer'
            }}
          >
            + Create Defect
          </button>

          {/* RIGHT: Legend */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 14px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#334155',
              gap: '24px'
            }}
          >
            {/* PRIORITY */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <strong>Priority:</strong>
              <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <AlertTriangle size={14} color="#16a34a" /> Low
                <AlertTriangle size={14} color="#2563eb" /> Medium
                <AlertTriangle size={14} color="#f97316" /> High
                <AlertTriangle size={14} color="#dc2626" /> Critical
              </span>
            </div>

            {/* STATUS */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <strong>Status:</strong>
              <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <Flower size={14} color="#3b82f6" />Open
                <Flower size={14} color="#f59e0b" />Pending Closure
                <Flower size={14} color="#22c55e" />Closed
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <strong>Due Date:</strong>
              <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <Clock size={14} color="#16a34a" /> Normal
                <Clock size={14} color="#f59e0b" /> ≤15 Days
                <Clock size={14} color="#dc2626" /> Overdue
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <strong>Other:</strong>
              <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <Flag size={14} color="#e8290b" fill="#e8290b" /> Flagged
                <div style={{
                  width: '17px', height: '17px', borderRadius: '50%',
                  border: '2px solid #0ea5e9', background: '#e0f2fe',
                  color: '#0ea5e9', fontSize: '9px', fontWeight: '900',
                  display: 'inline-flex', alignItems: 'center',
                  justifyContent: 'center', fontFamily: 'monospace'
                }}>DD</div> Dry Dock
              </span>
            </div>
          </div>
        </div>


        <div className='table-scroll-wrapper'>
          <DndContext
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;

              // ✅ FIX: Compute new order ONCE using current state
              const oldIndex = visibleColumns.indexOf(active.id);
              const newIndex = visibleColumns.indexOf(over.id);

              if (oldIndex === -1 || newIndex === -1) return;

              // ✅ Compute the reordered array
              const reorderedColumns = arrayMove(visibleColumns, oldIndex, newIndex);

              console.log('🔄 Column reorder:', {
                from: active.id,
                to: over.id,
                oldIndex,
                newIndex,
                newOrder: reorderedColumns
              });

              // ✅ Update local state
              setVisibleColumns(reorderedColumns);

              // ✅ Save to database with the SAME reordered array
              updateColumnsMutation.mutate(reorderedColumns);
            }}
          >
            <table className="data-table">
              <thead>
                <SortableContext
                  items={visibleColumns}
                  strategy={horizontalListSortingStrategy}
                > <tr>
                    <th style={{ width: 100 }}>Defect ID</th>

                    {visibleColumns.map((colId) => {
                      switch (colId) {
                        case 'date':
                          return (
                            <DraggableTh key="date" id="date" disabled={!isEditMode} style={{ width: columnWidths.date_identified }}>
                              <FilterHeader
                                label="Report Date"
                                field="date_identified"
                                currentFilter={{
                                  from: filters.date_identified_from,
                                  to: filters.date_identified_to
                                }}
                                // currentFilterSort={filters.date_identified_sort} // REMOVED
                                onFilterChange={(field, val) => {
                                  if (typeof val === 'object') {
                                    setFilters(prev => ({
                                      ...prev,
                                      date_identified_from: val.from || '',
                                      date_identified_to: val.to || ''
                                    }));
                                  } else {
                                    setFilters(prev => ({ ...prev, [field]: val }));
                                  }
                                }}
                                type="date-range"
                                onSort={() => handleTextSort('date_identified')} // ADDED
                                sortState={filters.text_sort.field === 'date_identified' ? filters.text_sort.dir : null} // ADDED
                              />
                            </DraggableTh>
                          );

                        case 'deadline':
                          return (
                            <DraggableTh key="deadline" id="deadline" disabled={!isEditMode} style={{ width: columnWidths.target_close_date }}>
                              <FilterHeader
                                label="Due Date"
                                field="target_close_date"
                                currentFilter={filters.target_close_date}
                                // currentFilterSort={filters.target_close_date_sort} // REMOVED
                                onFilterChange={(field, val) => {
                                  setFilters(prev => ({ ...prev, [field]: val }));
                                }}
                                type="date"
                                onSort={() => handleTextSort('target_close_date')} // ADDED
                                sortState={filters.text_sort.field === 'target_close_date' ? filters.text_sort.dir : null} // ADDED
                              />
                            </DraggableTh>
                          );

                        case 'source':
                          return (
                            <DraggableTh key="source" id="source" disabled={!isEditMode} style={{ width: columnWidths.defect_source, minWidth: "100px" }}>
                              <DefectSourceFilter
                                label="Source"
                                options={DEFECT_SOURCE_OPTIONS}
                                selectedValues={filters.defect_source}
                                onChange={(vals) =>
                                  setFilters(prev => ({ ...prev, defect_source: vals }))
                                }
                                width={columnWidths.defect_source}
                                onResize={onMouseDown}
                                onSort={() => handleTextSort('source')}
                                sortState={filters.text_sort.field === 'source' ? filters.text_sort.dir : null}
                              />
                            </DraggableTh>
                          );

                        case 'equipment':
                          return (
                            <DraggableTh key="equipment" id="equipment" disabled={!isEditMode} style={{ width: columnWidths.equipment, minWidth: "160px" }}>
                              <EquipmentFilter
                                label="Area of Concern"
                                options={equipmentList}
                                selectedValues={filters.equipment}
                                onChange={(vals) => {
                                  setCurrentPage(1);
                                  setFilters(prev => ({ ...prev, equipment: vals }))
                                }}
                                width={columnWidths.equipment}
                                onResize={onMouseDown}
                                onSort={() => handleTextSort('equipment')}
                                sortState={filters.text_sort.field === 'equipment' ? filters.text_sort.dir : null}
                              />
                            </DraggableTh>
                          );

                        case 'description':
                          return (
                            <DraggableTh key="description" id="description" disabled={!isEditMode} style={{ width: 600 }}>
                              <FilterHeader
                                label="Description"
                                field="description"
                                currentFilter={filters.description}
                                onFilterChange={(field, val) => {
                                  setFilters(prev => ({
                                    ...prev,
                                    [field]: val,
                                    date_identified_sort: '',
                                    target_close_date_sort: '',
                                    text_sort: { field: null, dir: 'asc' }   // ✅ clear sorts on text filter
                                  }));
                                }}
                                width={columnWidths.description}
                                onResize={onMouseDown}
                                onSort={() => handleTextSort('description')}
                                sortState={filters.text_sort.field === 'description' ? filters.text_sort.dir : null}
                              />
                            </DraggableTh>
                          );

                        case 'priority':
                          return (
                            <DraggableTh key="priority" id="priority" disabled={!isEditMode} style={{ width: 20, textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <span
                                  onClick={() => handleTextSort('priority')}
                                  style={{ cursor: 'pointer', display: 'inline-flex' }}
                                  title="Sort by Priority"
                                >
                                  <AlertTriangle size={16} color={filters.text_sort.field === 'priority' ? '#ea580c' : '#64748b'} />
                                </span>
                                <FilterHeader
                                  label=""
                                  field="priority"
                                  currentFilter={filters.priority}
                                  onFilterChange={handleFilterChange}
                                  type="multi-select"
                                  options={[
                                    { label: 'Low', value: 'LOW' },
                                    { label: 'Medium', value: 'MEDIUM' },
                                    { label: 'High', value: 'HIGH' },
                                    { label: 'Critical', value: 'CRITICAL' },
                                  ]}
                                  iconRenderer={(val) => {
                                    const colorMap = { CRITICAL: '#dc2626', HIGH: '#f97316', MEDIUM: '#2563eb', LOW: '#16a34a' };
                                    return <AlertTriangle size={13} color={colorMap[val]} />;
                                  }}
                                />
                              </div>
                            </DraggableTh>
                          );

                        case 'status':
                          return (
                            <DraggableTh key="status" id="status" disabled={!isEditMode} style={{ width: 20, textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <span
                                  onClick={() => handleTextSort('status')}
                                  style={{ cursor: 'pointer', display: 'inline-flex' }}
                                  title="Sort by Status"
                                >
                                  <Flower size={16} color={filters.text_sort.field === 'status' ? '#ea580c' : '#64748b'} />
                                </span>
                                <FilterHeader
                                  label=""
                                  field="status"
                                  currentFilter={filters.status}
                                  onFilterChange={handleFilterChange}
                                  type="multi-select"
                                  options={[
                                    { label: 'Open', value: 'OPEN' },
                                    { label: 'Pending Closure', value: 'PENDING_CLOSURE' },
                                    { label: 'Closed', value: 'CLOSED' },
                                  ]}
                                  iconRenderer={(val) => {
                                    const colorMap = { OPEN: '#3b82f6', PENDING_CLOSURE: '#f59e0b', CLOSED: '#22c55e' };
                                    return <Flower size={13} color={colorMap[val]} />;
                                  }}
                                />
                              </div>
                            </DraggableTh>
                          );

                        case 'deadline_icon':
                          return (
                            <DraggableTh key="deadline_icon" id="deadline_icon" disabled={!isEditMode} style={{ width: 20, textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <span
                                  onClick={() => handleTextSort('deadline_icon')}
                                  style={{ cursor: 'pointer', display: 'inline-flex' }}
                                  title="Sort by Deadline"
                                >
                                  <Clock size={16} color={filters.text_sort.field === 'deadline_icon' ? '#ea580c' : '#64748b'} />
                                </span>
                                <FilterHeader
                                  label=""
                                  field="deadline_status"
                                  currentFilter={filters.deadline_status}
                                  onFilterChange={handleFilterChange}
                                  type="multi-select"
                                  options={[
                                    { label: 'Normal', value: 'NORMAL' },
                                    { label: 'Warning (≤15 days)', value: 'WARNING' },
                                    { label: 'Overdue', value: 'OVERDUE' },
                                  ]}
                                  iconRenderer={(val) => {
                                    const colorMap = { NORMAL: '#16a34a', WARNING: '#f59e0b', OVERDUE: '#dc2626' };
                                    return <Clock size={13} color={colorMap[val]} />;
                                  }}
                                />
                              </div>
                            </DraggableTh>
                          );

                        case 'chat':
                          return (
                            <DraggableTh key="chat" id="chat" disabled={!isEditMode} style={{ width: 20, textAlign: 'center' }}>
                              <div className="filter-header">
                                <span>💬</span>
                              </div>
                            </DraggableTh>
                          );

                        case 'flag':
                          return (
                            <DraggableTh key="flag" id="flag" disabled={!isEditMode}
                              style={{ width: 24, textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0px' }}>
                                <span
                                  onClick={() => handleTextSort('flag')}
                                  style={{ cursor: 'pointer', display: 'inline-flex' }}
                                  title="Sort by Flag"
                                >
                                  <Flag
                                    size={16}
                                    color={
                                      filters.text_sort.field === 'flag' && sf.is_flagged.length > 0 ? '#7c3aed'
                                        : filters.text_sort.field === 'flag' ? '#2563eb'
                                          : sf.is_flagged.length > 0 ? '#ea580c'
                                            : '#64748b'
                                    }
                                    fill={filters.text_sort.field === 'flag' ? '#ef4444' : 'none'}
                                  />
                                </span>
                                <FilterHeader
                                  label=""
                                  field="is_flagged"
                                  currentFilter={filters.is_flagged}
                                  onFilterChange={handleFilterChange}
                                  type="multi-select"
                                  options={[
                                    { label: 'Flagged', value: 'true' },
                                    { label: 'Not Flagged', value: 'false' },
                                  ]}
                                  iconRenderer={(val) => (
                                    <Flag
                                      size={13}
                                      color={val === 'true' ? '#e8290b' : '#64748b'}
                                      fill={val === 'true' ? '#e8290b' : 'none'}
                                    />
                                  )}
                                />
                              </div>
                            </DraggableTh>
                          );

                        case 'dd':
                          return (
                            <DraggableTh key="dd" id="dd" disabled={!isEditMode}
                              style={{ width: 24, textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0px' }}>
                                <div
                                  onClick={() => handleTextSort('dd')}
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '50%',
                                    border: `1.5px solid ${filters.text_sort.field === 'dd' && sf.is_dd.length > 0 ? '#7c3aed'
                                      : filters.text_sort.field === 'dd' ? '#2563eb'
                                        : sf.is_dd.length > 0 ? '#ea580c'
                                          : '#64748b'
                                      }`,
                                    background:
                                      filters.text_sort.field === 'dd' && sf.is_dd.length > 0 ? '#f5f3ff'
                                        : filters.text_sort.field === 'dd' ? '#e0f2fe'
                                          : sf.is_dd.length > 0 ? '#fff7ed'
                                            : 'transparent',
                                    color:
                                      filters.text_sort.field === 'dd' && sf.is_dd.length > 0 ? '#7c3aed'
                                        : filters.text_sort.field === 'dd' ? '#2563eb'
                                          : sf.is_dd.length > 0 ? '#ea580c'
                                            : '#64748b',
                                    fontSize: '9px',
                                    fontWeight: '900',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontFamily: 'monospace',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                  }}
                                  title="Sort by Dry Dock"
                                >
                                  DD
                                </div>
                                <FilterHeader
                                  label=""
                                  field="is_dd"
                                  currentFilter={filters.is_dd}
                                  onFilterChange={handleFilterChange}
                                  type="multi-select"
                                  options={[
                                    { label: 'Dry Dock', value: 'true' },
                                    { label: 'Not Dry Dock', value: 'false' },
                                  ]}
                                  iconRenderer={(val) => (
                                    <div style={{
                                      width: '13px',
                                      height: '13px',
                                      borderRadius: '50%',
                                      border: `1px solid ${val === 'true' ? '#0ea5e9' : '#a0aec0'}`,
                                      background: val === 'true' ? '#e0f2fe' : 'transparent',
                                      color: val === 'true' ? '#0ea5e9' : '#94a3b8',
                                      fontSize: '6px',
                                      fontWeight: '900',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontFamily: 'monospace'
                                    }}>DD</div>
                                  )}
                                />
                              </div>
                            </DraggableTh>
                          );

                        case 'pr_details':
                          return (
                            <DraggableTh key="pr_details" id="pr_details" disabled={!isEditMode} style={{ width: columnWidths.pr_number, padding: "12px 0px" }}>
                              <FilterHeader
                                label="PR Details"
                                field="pr_number"
                                currentFilter={filters.pr_number}
                                onFilterChange={handleFilterChange}
                                width={columnWidths.pr_number}
                                onResize={onMouseDown}
                              />
                            </DraggableTh>
                          );

                        default:
                          return null;
                      }
                    })}

                    {isEditMode && canDelete && <th style={{ width: 10 }}>Delete</th>}
                  </tr>
                </SortableContext>
              </thead>


              <tbody>
                {paginatedData.map((defect, index) => {
                  const isClosed = defect.status === 'CLOSED';
                  const activePrs = defect.pr_entries?.filter(p => !p.is_deleted) || [];
                  const visiblePrs = activePrs.slice(0, 2);
                  const extraCount = activePrs.length - visiblePrs.length;
                  return (
                    <React.Fragment key={defect.id}>
                      <tr
                        ref={(el) => (rowRefs.current[defect.id] = el)}
                        className={expandedId === defect.id ? 'expanded-row-header' : ''}
                        style={{
                          background: highlightedId === defect.id
                            ? '#fef3c7'
                            : expandedId === defect.id ? '#f0f9ff' : 'transparent',
                          borderLeft: highlightedId === defect.id ? '4px solid #f59e0b' : 'none',
                          transition: 'background 0.5s ease',
                          width: 20
                        }}
                      >


                        <td style={{ textAlign: "center", fontWeight: 600, fontSize: '12px', color: '#1e293b', whiteSpace: 'nowrap' }}>
                          <div id={`row-${defect.id}`} className="row-anchor" />
                          {defect.defect_number || `#${(currentPage - 1) * pageSize + index + 1}`}
                        </td>

                        {visibleColumns.map(colId => {
                          switch (colId) {
                            case 'date':
                              return (
                                <td key="date" style={{ width: columnWidths.date_identified }}>
                                  <span>{formatDate(defect.date_identified)}</span>
                                </td>)

                            case 'deadline':
                              return (
                                <td key="deadline" style={{ width: columnWidths.target_close_date }}>
                                  {isEditMode && !isClosed ? (
                                    <InlineDateEdit
                                      value={defect.target_close_date}
                                      min={toLocalDateInput(defect.date_identified)}
                                      disabled={isClosed}
                                      onSave={(val) =>
                                        handleInlineUpdate(defect.id, 'target_close_date', val)
                                      }
                                    />
                                  ) : (
                                    <span>{formatDate(defect.target_close_date)}</span>
                                  )}
                                </td>
                              )

                            case 'source':
                              return (
                                <td key="source" style={{ width: columnWidths.defect_source, minWidth: "90px" }}>
                                  {isEditMode && !isClosed ? (
                                    <FloatingSelectText
                                      value={defect.defect_source}
                                      options={DEFECT_SOURCE_OPTIONS}
                                      onChange={(val) =>
                                        handleInlineUpdate(defect.id, 'defect_source', val)
                                      }
                                    />
                                  ) : (
                                    <span>
                                      {DEFECT_SOURCE_MAP[defect.defect_source] || defect.defect_source}
                                    </span>
                                  )}

                                </td>
                              )

                            case "equipment":
                              return (
                                <td key="equipment" style={{ width: columnWidths.equipment, minWidth: "105px" }}>
                                  {isEditMode && !isClosed ? (
                                    <FloatingSelectText
                                      value={defect.equipment_name}
                                      options={COMPONENT_OPTIONS}
                                      onChange={(val) =>
                                        handleInlineUpdate(defect.id, 'equipment_name', val)
                                      }
                                      width="160px"
                                    />
                                  ) : (
                                    <span>{defect.equipment_name}</span>
                                  )}

                                </td>
                              )

                            case "description":
                              return (
                                <td key="description" className='desc_width' style={{ maxWidth: '250px', position: 'relative', width: columnWidths.description, minWidth: "10px", whiteSpace: "normal" }}>
                                  {isEditMode && !isClosed ? (
                                    <>
                                      {/* COLLAPSED VIEW - 2 LINES */}
                                      <div
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedDescId(
                                            expandedDescId === defect.id ? null : defect.id
                                          );
                                          setActiveDescDefect(defect);
                                          setDescDraft(defect.description);
                                        }}
                                        style={{
                                          cursor: 'pointer',
                                          fontSize: '13px',
                                          display: '-webkit-box',
                                          WebkitLineClamp: 2,
                                          WebkitBoxOrient: 'vertical',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          lineHeight: '1.4',
                                          maxHeight: '2.8em', // 2 lines * 1.4 line-height
                                          textDecoration: 'underline',
                                          textDecorationStyle: 'dashed',
                                          textDecorationColor: '#cbd5e1',
                                          textUnderlineOffset: '2px',
                                          textTransform: 'uppercase',
                                        }}
                                      >
                                        <span style={{ borderBottom: '1px dashed #cbd5e1', paddingBottom: '1px', display: 'inline' }}>
                                          {defect.description}
                                        </span>
                                      </div>

                                      {/* EDIT DROPDOWN */}
                                      {expandedDescId === defect.id && (
                                        <div
                                          onClick={(e) => e.stopPropagation()}
                                          style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            width: '100%',
                                            background: 'white',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '6px',
                                            padding: '10px',
                                            marginTop: '4px',
                                            zIndex: 50,
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            fontSize: '13px'
                                          }}
                                        >
                                          <textarea
                                            autoFocus
                                            value={descDraft}
                                            onChange={(e) => setDescDraft(e.target.value)}
                                            style={{
                                              width: '100%',
                                              minHeight: '80px',
                                              fontSize: '13px',
                                              padding: '6px',
                                              border: '1px solid #cbd5e1',
                                              borderRadius: '4px',
                                              resize: 'vertical'
                                            }}
                                          />

                                          <div
                                            style={{
                                              display: 'flex',
                                              justifyContent: 'flex-end',
                                              gap: '8px',
                                              marginTop: '6px'
                                            }}
                                          >
                                            <button
                                              onClick={() => {
                                                handleInlineUpdate(
                                                  defect.id,
                                                  'description',
                                                  descDraft
                                                );
                                                setExpandedDescId(null);
                                                setActiveDescDefect(null);
                                              }}
                                              style={{
                                                background: '#ea580c',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '4px',
                                                padding: '4px 10px',
                                                fontSize: '11px',
                                                fontWeight: '600',
                                                cursor: 'pointer'
                                              }}
                                            >
                                              Save
                                            </button>

                                            <button
                                              onClick={() => {
                                                setExpandedDescId(null);
                                                setActiveDescDefect(null);
                                              }}
                                              style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: '#ea580c',
                                                fontSize: '11px',
                                                fontWeight: '600',
                                                cursor: 'pointer'
                                              }}
                                            >
                                              Close
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      {/* ✅ COLLAPSED VIEW (2 LINES) - CLICK TO OPEN */}
                                      <div
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setExpandedDescId(
                                            expandedDescId === defect.id ? null : defect.id
                                          );
                                        }}
                                        style={{
                                          cursor: 'pointer',
                                          fontSize: '13px',
                                          display: '-webkit-box',
                                          WebkitLineClamp: 2,
                                          WebkitBoxOrient: 'vertical',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          lineHeight: '1.4',
                                          maxHeight: '2.8em', // 2 lines * 1.4 line-height
                                          textTransform: 'uppercase',
                                        }}
                                        title="Click to view full description"
                                      >
                                        {defect.description}
                                      </div>

                                      {/* ✅ EXPANDED DROPDOWN VIEW */}
                                      {expandedDescId === defect.id && (
                                        <div
                                          onClick={(e) => e.stopPropagation()}
                                          style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            width: '100%',
                                            background: 'white',
                                            border: '1px solid #e2e8f0',
                                            borderRadius: '6px',
                                            padding: '10px',
                                            marginTop: '4px',
                                            zIndex: 50,
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            whiteSpace: 'pre-wrap',
                                            fontSize: '13px',
                                            textTransform: 'uppercase',

                                          }}
                                        >
                                          {defect.description}
                                          <div
                                            style={{
                                              textAlign: 'right',
                                              marginTop: '6px',
                                              fontSize: '11px',
                                              color: '#ea580c',
                                              cursor: 'pointer',
                                              fontWeight: '600'
                                            }}
                                            onClick={() => setExpandedDescId(null)}
                                          >
                                            Close
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </td>
                              )
                            case "priority":
                              return (
                                <td key="priority" style={{ width: 20 }}>
                                  {isEditMode && !isClosed ? (
                                    <FloatingSelectWithIcon
                                      icon={getPriorityIcon(defect.priority)}
                                      value={defect.priority}
                                      options={PRIORITY_OPTIONS}
                                      iconRenderer={getPriorityIcon}
                                      disabled={defect.status === 'CLOSED'}
                                      onChange={(val) =>
                                        handleInlineUpdate(defect.id, 'priority', val)
                                      }
                                    />
                                  ) : (
                                    <span title={"Priority: " + defect.priority}>
                                      {getPriorityIcon(defect.priority)}
                                    </span>
                                  )}
                                </td>
                              )
                            case "status":
                              return (
                                <td key="status" style={{ width: 20 }}>
                                  {/* If PENDING_CLOSURE: Show icon as read-only (waiting for approval) */}
                                  {defect.status === 'PENDING_CLOSURE' ? (
                                    <div style={{ cursor: 'not-allowed', opacity: 0.9 }} title="Pending Shore Approval">
                                      {getStatusIcon(defect.status)}
                                    </div>
                                  ) : (
                                    isEditMode && !isClosed ? (
                                      <FloatingSelectWithIcon
                                        icon={getStatusIcon(defect.status)}
                                        value={defect.status}
                                        options={STATUS_OPTIONS}
                                        iconRenderer={getStatusIcon}
                                        disabled={defect.status === 'CLOSED'}
                                        onChange={(val) =>
                                          handleInlineUpdate(defect.id, 'status', val)
                                        }
                                      />
                                    ) : (
                                      <span title={"Status: " + defect.status}>
                                        {getStatusIcon(defect.status)}
                                      </span>
                                    )
                                  )}
                                </td>
                              )

                            case "chat":
                              return (
                                <td key="chat" style={{ width: 20 }}>
                                  <button
                                    title={expandedId === defect.id ? "Close Discussion" : "Open Discussion"}
                                    onClick={() => {
                                      const isOpening = expandedId !== defect.id;
                                      setExpandedId(isOpening ? defect.id : null);

                                      if (isOpening) {
                                        setTimeout(() => {
                                          scrollRowBelowHeader(defect.id);
                                        }, 50);
                                      }
                                    }}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      cursor: 'pointer',
                                      padding: '4px'
                                    }}
                                  >
                                    <MessageCircle
                                      size={20}
                                      color={expandedId === defect.id ? '#ea580c' : '#545454'}
                                    />
                                  </button>
                                </td>
                              )
                            case "deadline_icon":
                              return (
                                <td key="deadline_icon" style={{ width: 20 }}>
                                  <DeadlineIcon date={defect.target_close_date} />
                                </td>
                              )

                            case 'flag':
                              return (
                                <td key="flag" style={{ width: 24 }}>
                                  {isEditMode && !isClosed ? (
                                    <div
                                      onClick={() => handleInlineUpdate(defect.id, 'is_flagged', !defect.is_flagged)}
                                      style={{
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        transition: 'background 0.2s'
                                      }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                      title={defect.is_flagged ? 'Click to unflag' : 'Click to flag'}
                                    >
                                      {getFlagIcon(defect.is_flagged)}
                                    </div>
                                  ) : (
                                    <span title={defect.is_flagged ? 'Flagged' : 'Not Flagged'}>
                                      {getFlagIcon(defect.is_flagged)}
                                    </span>
                                  )}
                                </td>
                              );

                            case 'dd':
                              return (
                                <td key="dd" style={{ width: 24 }}>
                                  {isEditMode && !isClosed ? (
                                    <div
                                      onClick={() => handleInlineUpdate(defect.id, 'is_dd', !defect.is_dd)}
                                      style={{
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        transition: 'background 0.2s'
                                      }}
                                      onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                      title={defect.is_dd ? 'Click to remove Dry Dock' : 'Click to mark as Dry Dock'}
                                    >
                                      {getDDIcon(defect.is_dd)}
                                    </div>
                                  ) : (
                                    <span title={defect.is_dd ? 'Dry Dock' : 'Not Dry Dock'}>
                                      {getDDIcon(defect.is_dd)}
                                    </span>
                                  )}
                                </td>
                              );

                            case "pr_details":
                              return (
                                <td key="pr_details" style={{ width: 20, position: 'relative', textAlign: 'center' }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActivePrId(defect.id);
                                    }}
                                    title={
                                      activePrs.length === 0
                                        ? 'No PR Number'
                                        : 'View PR Numbers'
                                    }
                                    style={{
                                      border: 'none',
                                      background: 'transparent',
                                      cursor: 'pointer',
                                      padding: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center'
                                    }}
                                  >
                                    <MoreHorizontal
                                      size={18}
                                      color={activePrs.length === 0 ? '#dc2626' : '#475569'}
                                    />
                                  </button>

                                  {/* PR Manager Popover */}
                                  {activePrId === defect.id && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 100 }}>
                                      <PrManagerPopover
                                        defect={defect}
                                        onClose={() => setActivePrId(null)}
                                        onRefresh={() => queryClient.invalidateQueries(['defects'])}
                                      />
                                    </div>
                                  )}
                                </td>
                              )
                            default:
                              return null;
                          }
                        })}

                        {isEditMode && canDelete && (
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="action-btn"
                              onClick={() => handleDelete(defect.id)}
                              style={{ color: '#ef4444', border: 'none', background: 'none', cursor: 'pointer' }}
                              title="Delete Defect"
                            >
                              <Trash2 size={18} />
                            </button>
                          </td>
                        )}
                      </tr>
                      {
                        expandedId === defect.id && (
                          <tr>
                            <td colSpan={calculateColspan()} style={{ padding: 0 }}>
                              <div style={{ background: '#f8fafc', padding: '20px', borderBottom: '1px solid #e2e8f0' }}>
                                {isClosed && (
                                  <div style={{
                                    background: '#fef3c7',
                                    border: '1px solid #fbbf24',
                                    borderRadius: '8px',
                                    padding: '12px',
                                    marginBottom: '20px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    fontSize: '13px',
                                    color: '#92400e',
                                    fontWeight: '600'
                                  }}>
                                    <Lock size={16} />
                                    CLOSED - Read Only Mode (All editing disabled)
                                  </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', height: "450px" }}>
                                  <ThreadSection
                                    defectId={defect.id}
                                    defectStatus={defect.status}
                                    closureRemarks={defect.closure_remarks}
                                  />
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <BeforeAfterImageUpload
                                      defectId={defect.id}
                                      type="before"
                                      isMandatory={defect.before_image_required}
                                      defectStatus={defect.status}
                                    />
                                    <BeforeAfterImageUpload
                                      defectId={defect.id}
                                      type="after"
                                      isMandatory={defect.after_image_required}
                                      defectStatus={defect.status}
                                    />
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )
                      }
                    </React.Fragment>
                  );
                })}

                {/* ✅ UPDATED CREATE ROW - Matches Edit Mode Style */}
                {showCreateRow && (
                  <tr
                    ref={createRowRef}
                    style={{
                      background: '#fffbeb',
                      borderLeft: '4px solid #ea580c'
                    }}
                  >
                    {/* 1. S.No Column */}
                    <td style={{ width: 100, textAlign: 'center', color: '#ea580c', fontWeight: 700, fontSize: '13px' }}>
                      NEW
                    </td>

                    {/* 3. Visible Columns Mapping */}
                    {visibleColumns.map((colId) => {
                      switch (colId) {
                        case 'date':
                          return (
                            <td key="date" style={{ width: columnWidths.date_identified }}>
                              <input
                                type="date"
                                className="ghost-input"
                                value={newDefect.date_identified}
                                onChange={(e) =>
                                  setNewDefect(prev => ({ ...prev, date_identified: e.target.value }))
                                }
                                style={{ width: '100%' }}
                              />
                            </td>
                          );

                        case 'deadline':
                          return (
                            <td key="deadline" style={{ width: columnWidths.target_close_date }}>
                              <input
                                type="date"
                                className="ghost-input"
                                value={newDefect.target_close_date}
                                onChange={(e) =>
                                  setNewDefect(prev => ({ ...prev, target_close_date: e.target.value }))
                                }
                                style={{ width: '100%' }}
                              />
                            </td>
                          );

                        case 'source':
                          return (
                            <td key="source" style={{ width: columnWidths.defect_source, minWidth: "90px" }}>
                              <select
                                className="ghost-select"
                                value={newDefect.defect_source}
                                onChange={(e) =>
                                  setNewDefect(prev => ({ ...prev, defect_source: e.target.value }))
                                }
                                style={{ width: '100%' }}
                              >
                                {DEFECT_SOURCE_OPTIONS.map(src => (
                                  <option key={src} value={src}>
                                    {getDefectSourceLabel(src)}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );

                        case 'equipment':
                          return (
                            <td key="equipment" style={{ width: columnWidths.equipment, minWidth: "105px" }}>
                              <select
                                className="ghost-select"
                                value={newDefect.equipment_name}
                                onChange={(e) =>
                                  setNewDefect(prev => ({ ...prev, equipment_name: e.target.value }))
                                }
                                style={{ width: '100%' }}
                              >
                                <option value="">Select Area of Concern…</option>
                                {COMPONENT_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </td>
                          );

                        case 'description':
                          return (
                            <td key="description" style={{ width: columnWidths.description, minWidth: "10px", position: 'relative' }}>
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedDescId('CREATE_NEW');
                                }}
                                style={{
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  lineHeight: '1.4',
                                  maxHeight: '2.8em',
                                  textDecoration: 'underline',
                                  textDecorationStyle: 'dashed',
                                  textDecorationColor: '#cbd5e1',
                                  textUnderlineOffset: '2px',
                                  textTransform: 'uppercase',
                                  minHeight: '2.8em',
                                  color: newDefect.description ? '#1e293b' : '#94a3b8'
                                }}
                              >
                                {newDefect.description || 'Click to enter description…'}
                              </div>

                              {expandedDescId === 'CREATE_NEW' && (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    width: '100%',
                                    background: 'white',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '6px',
                                    padding: '10px',
                                    marginTop: '4px',
                                    zIndex: 50,
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                    fontSize: '13px'
                                  }}
                                >
                                  <textarea
                                    autoFocus
                                    value={newDefect.description}
                                    onChange={(e) =>
                                      setNewDefect(prev => ({ ...prev, description: e.target.value }))
                                    }
                                    placeholder="Enter description…"
                                    style={{
                                      width: '100%',
                                      minHeight: '80px',
                                      fontSize: '13px',
                                      padding: '6px',
                                      border: '1px solid #cbd5e1',
                                      borderRadius: '4px',
                                      resize: 'vertical',
                                      textTransform: 'uppercase'
                                    }}
                                  />

                                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                                    <button
                                      onClick={() => setExpandedDescId(null)}
                                      style={{ background: '#ea580c', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 10px', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
                                    >
                                      Done
                                    </button>
                                    <button
                                      onClick={() => setExpandedDescId(null)}
                                      style={{ background: 'transparent', border: 'none', color: '#ea580c', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
                                    >
                                      Close
                                    </button>
                                  </div>
                                </div>
                              )}
                            </td>
                          );

                        case 'priority':
                          return (
                            <td key="priority" style={{ width: 20 }}>
                              <FloatingSelectWithIcon
                                icon={getPriorityIcon(newDefect.priority)}
                                value={newDefect.priority}
                                options={PRIORITY_OPTIONS}
                                iconRenderer={getPriorityIcon}
                                onChange={(val) => setNewDefect(prev => ({ ...prev, priority: val }))}
                              />
                            </td>
                          );

                        case 'status':
                          return (
                            <td key="status" style={{ width: 20 }}>
                              <FloatingSelectWithIcon
                                icon={getStatusIcon(newDefect.status)}
                                value={newDefect.status}
                                options={STATUS_OPTIONS}
                                iconRenderer={getStatusIcon}
                                onChange={(val) => setNewDefect(prev => ({ ...prev, status: val }))}
                              />
                            </td>
                          );

                        case 'deadline_icon':
                          return (
                            <td key="deadline_icon" style={{ width: 20 }}>
                              <Clock size={20} color="#94a3b8" title="Set deadline first" />
                            </td>
                          );

                        case 'chat':
                          return (
                            <td key="chat" style={{ width: 20, textAlign: 'center' }}>
                              <MessageCircle size={20} color="#94a3b8" />
                            </td>
                          );

                        case 'flag':
                          return (
                            <td key="flag" style={{ width: 24, textAlign: 'center' }}>
                              <div
                                onClick={() => setNewDefect(prev => ({ ...prev, is_flagged: !prev.is_flagged }))}
                                style={{
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  padding: '4px',
                                  borderRadius: '4px'
                                }}
                                title="Toggle Flag"
                              >
                                {getFlagIcon(newDefect.is_flagged)}
                              </div>
                            </td>
                          );

                        case 'dd':
                          return (
                            <td key="dd" style={{ width: 24, textAlign: 'center' }}>
                              <div
                                onClick={() => setNewDefect(prev => ({ ...prev, is_dd: !prev.is_dd }))}
                                style={{
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  padding: '4px',
                                  borderRadius: '4px'
                                }}
                                title="Toggle Dry Dock"
                              >
                                {getDDIcon(newDefect.is_dd)}
                              </div>
                            </td>
                          );

                        default:
                          return null;
                      }
                    })}

                    {/* 4. Action Buttons Column (Handles colSpan for Edit Mode) */}
                    <td
                      style={{ textAlign: 'center', width: 80 }}
                      colSpan={isEditMode ? 2 : 1}
                    >
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        <button
                          onClick={handleCreateSave}
                          title="Save Defect"
                          style={{
                            background: '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px 10px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <Check size={16} />
                        </button>

                        <button
                          onClick={() => {
                            setShowCreateRow(false);
                            setNewDefect(INITIAL_NEW_DEFECT);
                          }}
                          title="Cancel"
                          style={{
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            padding: '6px 10px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}

                {filteredData.length === 0 && (
                  <tr><td colSpan={calculateColspan()} style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>No records match the filters.</td></tr>
                )}
              </tbody>
            </table> {/* End of your existing table */}
          </DndContext>
        </div>



        {/* --- COOL PAGINATION FOOTER --- */}
        <div
          style={{
            zIndex: 10,
            padding: '15px 25px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0'
          }}
        >
          {/* LEFT: Showing count */}
          <div
            style={{
              fontSize: '13px',
              color: '#64748b'
            }}
          >
            Showing <b>{startIndex}</b> to <b>{endIndex}</b> of <b>{filteredData.length}</b> defects

          </div>

          {/* RIGHT: Page size + pagination */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '20px'
            }}
          >
            {/* PAGE SIZE SELECTOR */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Show</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  cursor: 'pointer'
                }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>per page</span>
            </div>

            {/* PAGE INFO */}
            <div style={{ fontSize: '13px', color: '#94a3b8', fontWeight: '600' }}>
              Page <span style={{ color: '#1e293b' }}>{currentPage}</span> of {totalPages}
            </div>

            {/* NAV BUTTONS */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="pag-btn"
              >
                <ChevronDown size={20} style={{ transform: 'rotate(90deg)' }} />
              </button>

              <button
                onClick={handleNextPage}
                disabled={currentPage >= totalPages}
                className="pag-btn"
              >
                <ChevronDown size={20} style={{ transform: 'rotate(-90deg)' }} />
              </button>
            </div>
          </div>
        </div>


        {/* ✅ Column Customization Modal */}
        <ColumnCustomizationModal
          isOpen={showColumnModal}
          onClose={() => setShowColumnModal(false)}
          currentColumns={visibleColumns}
          availableColumns={COLUMN_DEFINITIONS}
          onSave={handleSaveColumns}
        />


        {closureModalOpen && closureDefect && (
          <EnhancedClosureModal
            defect={closureDefect}
            validation={closureValidation}
            onClose={() => {
              setClosureModalOpen(false);
              setClosureDefect(null);
              setClosureValidation(null);
            }}
            onSuccess={() => {
              queryClient.invalidateQueries(['defects']);
              setClosureModalOpen(false);
              setClosureDefect(null);
              setClosureValidation(null);
            }}
          />
        )}

      </div>
    </div >
  );
};

export default VesselDashboard;

const DraggableTh = ({ id, children, disabled, style }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition
  } = useSortable({ id, disabled });

  const fstyle = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: disabled ? 1 : 0.95,
    ...style
  };


  return (
    <th ref={setNodeRef} style={fstyle} >
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {!disabled && (
          <span
            {...attributes}
            {...listeners}
            style={{ cursor: 'grab', display: 'flex' }}
          >
            <ArrowRightLeft size={10} />
          </span>
        )}
        {children}
      </div>
    </th>
  );
};