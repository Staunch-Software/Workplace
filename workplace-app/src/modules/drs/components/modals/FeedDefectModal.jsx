import React, { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ChevronLeft, ChevronRight, ExternalLink, Flag, Lock, MailOpen, AlertTriangle } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { formatDate } from '../shared/constants';
import { ToastProvider, ThreadSection, BeforeAfterImageUpload } from '../../features/shore/ShoreDashboard';
import './FeedDefectModal.css';

const DEFECTS_QUERY_KEY = ['defects', 'global-list'];

const PRIORITY_COLORS = {
  CRITICAL: '#dc2626',
  HIGH: '#f97316',
  MEDIUM: '#2563eb',
  LOW: '#16a34a',
};

const FeedDefectModal = ({ items, index, onIndexChange, onClose, onGoToDefect }) => {
  const queryClient = useQueryClient();
  const feedItem = items?.[index];
  const defectId = feedItem?.defect_id;

  const { data: defect, isLoading } = useQuery({
    queryKey: ['defect-detail', defectId],
    queryFn: () => defectApi.getDefectById(defectId),
    enabled: !!defectId,
  });

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

  const hasPrev = index > 0;
  const hasNext = index < (items?.length || 0) - 1;

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, hasPrev, hasNext, onClose, onIndexChange]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  if (!feedItem) return null;

  return (
    <ToastProvider>
      <div className="feed-modal-overlay" onClick={onClose}>
        <button
          className="feed-modal-swipe-btn feed-modal-swipe-left"
          onClick={(e) => { e.stopPropagation(); if (hasPrev) onIndexChange(index - 1); }}
          disabled={!hasPrev}
          title="Previous feed item"
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
                <div className="feed-modal-header-row">
                  <div className="fm-field">
                    <span className="fm-label">Defect ID</span>
                    <span className="fm-value">{defect.defect_number || '—'}</span>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Vessel</span>
                    <span className="fm-value">{defect.vessel_name}</span>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Report Date</span>
                    <span className="fm-value">{formatDate(defect.date_identified || defect.created_at)}</span>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Due Date</span>
                    <span className="fm-value">{formatDate(defect.target_close_date)}</span>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Source</span>
                    <span className="fm-value">{defect.defect_source}</span>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Priority</span>
                    <span className="fm-value fm-priority-value">
                      <AlertTriangle size={13} color={PRIORITY_COLORS[defect.priority] || '#94a3b8'} />
                      {defect.priority || '—'}
                    </span>
                  </div>
                  <div className="fm-field">
                    <span className="fm-label">Area of Concern</span>
                    <span className="fm-value">{defect.equipment_name}</span>
                  </div>
                  <div className="fm-field fm-field-grow">
                    <span className="fm-label">Description</span>
                    <span className="fm-value fm-description-value">{defect.description}</span>
                  </div>
                </div>
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
                  readOnly
                />
                <div className="fm-images">
                  <BeforeAfterImageUpload
                    defectId={defect.id}
                    type="before"
                    isMandatory={defect.before_image_required}
                    defectStatus={defect.status}
                    readOnly
                  />
                  <BeforeAfterImageUpload
                    defectId={defect.id}
                    type="after"
                    isMandatory={defect.after_image_required}
                    defectStatus={defect.status}
                    readOnly
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <button
          className="feed-modal-swipe-btn feed-modal-swipe-right"
          onClick={(e) => { e.stopPropagation(); if (hasNext) onIndexChange(index + 1); }}
          disabled={!hasNext}
          title="Next feed item"
        >
          <ChevronRight size={26} />
        </button>
      </div>
    </ToastProvider>
  );
};

export default FeedDefectModal;
