import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ChevronLeft, ChevronRight, ChevronDown, ExternalLink, Flag, Lock, MailOpen, Pencil, Check } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import {
  formatDate, getStatusColor, getDeadlineStatus, toLocalDateInput,
  PRIORITY_OPTIONS, DEFECT_SOURCE_OPTIONS, COMPONENT_OPTIONS, PrioritySignalBarsIcon, StatusStageIcon,
} from '../shared/constants';
import { ToastProvider, ThreadSection, BeforeAfterImageUpload, useToast } from '../../features/shore/ShoreDashboard';
import './FeedDefectModal.css';

const DEFECTS_QUERY_KEY = ['defects', 'global-list'];

const PRIORITY_COLORS = {
  CRITICAL: '#dc2626',
  HIGH: '#f97316',
  MEDIUM: '#2563eb',
  LOW: '#16a34a',
};

const TIMELINE_LABELS = {
  OVERDUE: 'Overdue',
  WARNING: 'Due Soon',
  NORMAL: 'On Track',
};

// Custom dropdown: shows only ~4 options at a time, rest reachable via scroll.
const VISIBLE_OPTION_COUNT = 4;
const OPTION_ROW_HEIGHT = 34;

const ScrollableSelect = ({ value, options, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="fm-edit-input fm-scrollselect-trigger"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
      >
        {value || '—'}
      </button>
      {open && !disabled && (
        <div
          className="fm-scrollselect-list"
          style={{ maxHeight: `${VISIBLE_OPTION_COUNT * OPTION_ROW_HEIGHT}px` }}
        >
          {options.map(opt => (
            <div
              key={opt}
              className={`fm-scrollselect-option ${opt === value ? 'is-selected' : ''}`}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PRIORITY_LEVELS = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

const PrioritySelect = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} className="fm-priority-select">
      <button
        type="button"
        className="fm-edit-input fm-priority-trigger"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        style={{ color: PRIORITY_COLORS[value] || '#0f172a' }}
      >
        <span className="fm-priority-trigger-label">
          <PrioritySignalBarsIcon size={13} color={PRIORITY_COLORS[value] || '#94a3b8'} level={PRIORITY_LEVELS[value]} />
          {value || 'Select priority'}
        </span>
        <ChevronDown size={14} className="fm-priority-caret" />
      </button>
      {open && !disabled && (
        <div className="fm-priority-list">
          {PRIORITY_OPTIONS.map(opt => (
            <div
              key={opt}
              className={`fm-priority-option ${opt === value ? 'is-selected' : ''}`}
              onClick={() => { onChange(opt); setOpen(false); }}
              style={{ color: PRIORITY_COLORS[opt] }}
            >
              <PrioritySignalBarsIcon size={13} color={PRIORITY_COLORS[opt]} level={PRIORITY_LEVELS[opt]} />
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FeedDefectModalInner = ({ items, index, onIndexChange, onClose, onGoToDefect }) => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const feedItem = items?.[index];
  const defectId = feedItem?.defect_id;

  const { data: defect, isLoading } = useQuery({
    queryKey: ['defect-detail', defectId],
    queryFn: () => defectApi.getDefectById(defectId),
    enabled: !!defectId,
  });

  const updateFieldMutation = useMutation({
    mutationFn: ({ id, field, value }) => defectApi.updateDefect(id, { [field]: value }),
    onMutate: async ({ id, field, value }) => {
      await queryClient.cancelQueries(['defect-detail', id]);
      const prev = queryClient.getQueryData(['defect-detail', id]);
      queryClient.setQueryData(['defect-detail', id], (old) =>
        old ? { ...old, [field]: value } : old
      );
      return { prev };
    },
    onError: (err, { id }, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['defect-detail', id], ctx.prev);
      toast?.(`Update failed: ${err.message}`, 'error');
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries(['defect-detail', id]);
      queryClient.invalidateQueries(DEFECTS_QUERY_KEY);
      queryClient.invalidateQueries(['live-feed']);
    },
  });

  const [isEditMode, setIsEditMode] = useState(false);
  useEffect(() => { setIsEditMode(false); }, [defectId]);

  const canEditFields = isEditMode && defect && defect.status !== 'CLOSED';

  const updateField = (field, value) => {
    if (!defect || defect[field] === value) return;

    if (field === 'target_close_date') {
      const reportDate = new Date((defect.date_identified || '').split('T')[0]);
      const newDue = new Date(value);
      if (newDue <= reportDate) {
        toast?.('Due date must be after the report date', 'warning');
        return;
      }
    }

    updateFieldMutation.mutate({ id: defect.id, field, value });
  };

  const toggleFlagMutation = useMutation({
    mutationFn: (id) => defectApi.toggleFlag(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries(['defect-detail', id]);
      const prev = queryClient.getQueryData(['defect-detail', id]);
      queryClient.setQueryData(['defect-detail', id], (old) =>
        old ? { ...old, is_flagged: !old.is_flagged } : old
      );
      return { prev };
    },
    onError: (_err, id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['defect-detail', id], ctx.prev);
    },
    onSettled: (_data, _err, id) => {
      queryClient.invalidateQueries(['defect-detail', id]);
      queryClient.invalidateQueries(DEFECTS_QUERY_KEY);
      queryClient.invalidateQueries(['live-feed']);
    },
  });

  const markUnreadMutation = useMutation({
    mutationFn: (id) => defectApi.markFeedUnread(id),
    onSuccess: () => queryClient.invalidateQueries(['live-feed']),
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => defectApi.markFeedRead(id),
    onSuccess: () => queryClient.invalidateQueries(['live-feed']),
  });

  // Mark every feed event for the defect currently shown as read — fires on
  // initial open and again each time next/prev lands on a different defect,
  // since viewing the defect here shows all that info already.
  useEffect(() => {
    if (!defectId || !items) return;
    items
      .filter(i => i.defect_id === defectId && !i.is_read)
      .forEach(i => markReadMutation.mutate(i.id));
  }, [defectId]);

  // Jump straight to the next/previous event for a *different* defect —
  // consecutive events on the same defect (e.g. "Priority Changed" then
  // "Before Image Made Mandatory" fired seconds apart) show identical
  // defect details, so re-opening the same defect again is wasted clicks.
  const findAdjacentDifferentIndex = (dir) => {
    if (!items) return -1;
    const currentDefectId = feedItem?.defect_id;
    let i = index + dir;
    while (i >= 0 && i < items.length) {
      const candidateDefectId = items[i]?.defect_id;
      if (!candidateDefectId || candidateDefectId !== currentDefectId) return i;
      i += dir;
    }
    return -1;
  };

  const prevIndex = findAdjacentDifferentIndex(-1);
  const nextIndex = findAdjacentDifferentIndex(1);
  const hasPrev = prevIndex !== -1;
  const hasNext = nextIndex !== -1;

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(prevIndex);
      if (e.key === 'ArrowRight' && hasNext) onIndexChange(nextIndex);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, hasPrev, hasNext, prevIndex, nextIndex, onClose, onIndexChange]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  if (!feedItem) return null;

  return (
      <div className="feed-modal-overlay" onClick={onClose}>
        <button
          className="feed-modal-swipe-btn feed-modal-swipe-left"
          onClick={(e) => { e.stopPropagation(); if (hasPrev) onIndexChange(prevIndex); }}
          disabled={!hasPrev}
          title="Previous defect"
        >
          <ChevronLeft size={26} />
        </button>

        <div className="feed-modal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="fm-topbar">
            <div className="fm-topbar-left">
              {defect && (
                <button
                  className="fm-goto-btn"
                  onClick={() => onGoToDefect(defect.id, feedItem.meta?.is_internal || feedItem.event_type === 'MENTION')}
                >
                  <ExternalLink size={14} /> Go to Defect
                </button>
              )}
              {defect && defect.status !== 'CLOSED' && (
                <button
                  className={`fm-edit-toggle-btn ${isEditMode ? 'is-active' : ''}`}
                  onClick={() => setIsEditMode(v => !v)}
                >
                  {isEditMode ? <><Check size={14} /> Exit Edit Mode</> : <><Pencil size={14} /> Enable Edit Mode</>}
                </button>
              )}
            </div>
            <div className="fm-topbar-right">
              {defect && (
                <button
                  className={`fm-flag-btn ${defect.is_flagged ? 'is-flagged' : ''}`}
                  onClick={() => toggleFlagMutation.mutate(defect.id)}
                  disabled={toggleFlagMutation.isPending}
                  title={defect.is_flagged ? 'Click to unflag' : 'Click to flag'}
                >
                  <Flag size={16} color={defect.is_flagged ? '#e8290b' : '#8e8d8d'} fill={defect.is_flagged ? '#e8290b' : 'none'} />
                </button>
              )}
              <button
                className="fm-unread-btn"
                onClick={() => markUnreadMutation.mutate(feedItem.id)}
                disabled={markUnreadMutation.isPending}
                title="Mark as unread"
              >
                <MailOpen size={16} /> Mark as unread
              </button>
              <button className="feed-modal-close" onClick={onClose} title="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          {!defectId ? (
            <div className="feed-modal-loading">This event isn't linked to a defect.</div>
          ) : isLoading || !defect ? (
            <div className="feed-modal-loading">Loading defect…</div>
          ) : (
            <>
              <div className="feed-modal-header">
                <div className={`feed-modal-header-row ${canEditFields ? 'is-edit-mode' : ''}`}>
                  <div className="fm-field">
                    <span className="fm-label">Defect ID</span>
                    <div className="fm-field-value"><span className="fm-value">{defect.defect_number || '—'}</span></div>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Vessel</span>
                    <div className="fm-field-value"><span className="fm-value">{defect.vessel_name}</span></div>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Report Date</span>
                    <div className="fm-field-value"><span className="fm-value">{formatDate(defect.date_identified || defect.created_at)}</span></div>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Due Date</span>
                    <div className="fm-field-value">
                      {canEditFields ? (
                        <input
                          type="date"
                          className="fm-edit-input"
                          defaultValue={toLocalDateInput(defect.target_close_date)}
                          onBlur={(e) => e.target.value && updateField('target_close_date', e.target.value)}
                        />
                      ) : (
                        <span className="fm-value">{formatDate(defect.target_close_date)}</span>
                      )}
                    </div>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Source</span>
                    <div className="fm-field-value">
                      {canEditFields ? (
                        <select
                          className="fm-edit-input"
                          value={defect.defect_source || ''}
                          onChange={(e) => updateField('defect_source', e.target.value)}
                        >
                          {DEFECT_SOURCE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <span className="fm-value">{defect.defect_source}</span>
                      )}
                    </div>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Priority</span>
                    <div className="fm-field-value">
                      {canEditFields ? (
                        <PrioritySelect
                          value={defect.priority}
                          onChange={(val) => updateField('priority', val)}
                        />
                      ) : (
                        <span className="fm-value fm-priority-value">
                          <PrioritySignalBarsIcon
                            size={13}
                            color={PRIORITY_COLORS[defect.priority] || '#94a3b8'}
                            level={{ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 }[defect.priority]}
                          />
                          {defect.priority || '—'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Status</span>
                    <div className="fm-field-value">
                      <span className="fm-value fm-priority-value">
                        <StatusStageIcon size={13} color={getStatusColor(defect.status)} status={defect.status} />
                        {defect.status?.replace('_', ' ') || '—'}
                      </span>
                    </div>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Timeline</span>
                    <div className="fm-field-value">
                      <span className="fm-value fm-priority-value">
                        {defect.status === 'CLOSED'
                          ? 'Closed'
                          : TIMELINE_LABELS[getDeadlineStatus(defect.target_close_date)]}
                      </span>
                    </div>
                  </div>
                  <div className={`fm-field ${canEditFields ? 'fm-field-grow' : ''}`}>
                    <span className="fm-label">Area of Concern</span>
                    <div className="fm-field-value">
                      {canEditFields ? (
                        <ScrollableSelect
                          value={defect.equipment_name}
                          options={COMPONENT_OPTIONS}
                          onChange={(val) => updateField('equipment_name', val)}
                        />
                      ) : (
                        <span className="fm-value">{defect.equipment_name}</span>
                      )}
                    </div>
                  </div>
                  {!canEditFields && (
                    <div className="fm-field fm-field-description">
                      <span className="fm-label">Description</span>
                      <div className="fm-field-value"><span className="fm-value fm-description-value">{defect.description}</span></div>
                    </div>
                  )}
                </div>
                {canEditFields && (
                  <div className="fm-field fm-field-grow fm-field-grow-full">
                    <span className="fm-label">Description</span>
                    <textarea
                      className="fm-edit-input fm-edit-textarea"
                      defaultValue={defect.description}
                      onBlur={(e) => updateField('description', e.target.value)}
                    />
                  </div>
                )}
              </div>

              {defect.status === 'CLOSED' && (
                <div className="fm-closed-banner">
                  <Lock size={14} /> CLOSED - Read Only Mode (All editing disabled)
                </div>
              )}

              <div className="fm-body">
                <ThreadSection
                  defectId={defect.id}
                  defectStatus={defect.status}
                  closureRemarks={defect.closure_remarks}
                  closedAt={defect.closed_at || defect.updated_at}
                  closedById={defect.closed_by_id}
                  fixedHeight="100%"
                />
                <div className="fm-images">
                  <BeforeAfterImageUpload
                    defectId={defect.id}
                    type="before"
                    isMandatory={defect.before_image_required}
                    defectStatus={defect.status}
                    onToggleRequired={() => updateField('before_image_required', !defect.before_image_required)}
                  />
                  <BeforeAfterImageUpload
                    defectId={defect.id}
                    type="after"
                    isMandatory={defect.after_image_required}
                    defectStatus={defect.status}
                    onToggleRequired={() => updateField('after_image_required', !defect.after_image_required)}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <button
          className="feed-modal-swipe-btn feed-modal-swipe-right"
          onClick={(e) => { e.stopPropagation(); if (hasNext) onIndexChange(nextIndex); }}
          disabled={!hasNext}
          title="Next defect"
        >
          <ChevronRight size={26} />
        </button>
      </div>
  );
};

const FeedDefectModal = (props) => (
  <ToastProvider>
    <FeedDefectModalInner {...props} />
  </ToastProvider>
);

export default FeedDefectModal;
