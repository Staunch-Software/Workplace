import React, { useState, useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vesselReportsApi } from '../../api/reportsApi';
import ReportsNavbar from '../../components/ReportsNavbar';
import '../../../drs/components/shared/live-feed.css';
import { fmtRelativeDateTime } from '@/utils/dateUtils';

import {
  FileText, AtSign, CheckCircle, Eye,
  RefreshCw, Anchor, ChevronDown, CheckCheck
} from 'lucide-react';

const EVENT_CONFIG = {
  new_report: {
    icon: FileText,
    color: '#10b981',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    label: 'New Report',
  },
  mention: {
    icon: AtSign,
    color: '#3b82f6',
    bg: '#eff6ff',
    border: '#bfdbfe',
    label: 'Mention',
  },
  pending_job: {
    icon: FileText,
    color: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a',
    label: 'Pending',
  },
  // Both missing_job and missing_report (actual backend type) — show as amber Pending
  missing_job: {
    icon: FileText,
    color: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a',
    label: 'Pending',
  },
  missing_report: {
    icon: FileText,
    color: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a',
    label: 'Pending',
  },
};


export default function VesselReportFeedPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('UNREAD');

  const { data: notifications = [], isLoading, isFetching } = useQuery({
    queryKey: ['vessel-report-notifications'],
    queryFn: () => vesselReportsApi.getNotifications(),
    refetchInterval: 15000,
  });

  const markReadMutation = useMutation({
    mutationFn: vesselReportsApi.markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries(['vessel-report-notifications']),
  });

  const markAllReadMutation = useMutation({
    mutationFn: vesselReportsApi.markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries(['vessel-report-notifications']),
  });

  const filteredNotifs = useMemo(() => {
    if (filter === 'UNREAD') return notifications.filter(n => !n.is_read);
    return notifications;
  }, [notifications, filter]);

  const handleMarkDone = (id) => {
    markReadMutation.mutate(id);
  };

  const handleView = (item) => {
    // If there's a report_id, open the report (Vessel view) in a new tab
    if (item.report_id) {
       // No 'noopener'/'noreferrer' -- same-origin link, and severing the
       // opener stops the new tab from inheriting sessionStorage (the auth
       // token), which made it look logged out.
       window.open(`/reports/vessel?open=${item.report_id}`, '_blank');
    }
  };

  return (
    <div className="live-feed-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <ReportsNavbar totalUnread={notifications.filter(n => !n.is_read).length} />
      
      {/* Header */}
      <div className="feed-header" style={{ padding: '20px 24px', background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="feed-header-left">
          <h2>My Feed (Vessel)</h2>
          <div className="feed-count-badge">
            {notifications.filter(n => !n.is_read).length} unread
          </div>
        </div>
        <div className="feed-header-right">
          <div className="feed-filters">
            <button
              className={`feed-filter-btn ${filter === 'UNREAD' ? 'active' : ''}`}
              onClick={() => setFilter('UNREAD')}
            >
              Unread
            </button>
            <button
              className={`feed-filter-btn ${filter === 'ALL' ? 'active' : ''}`}
              onClick={() => setFilter('ALL')}
            >
              All
            </button>
          </div>
          
          <button 
            className="action-btn" 
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending || notifications.filter(n => !n.is_read).length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', fontSize: '0.8rem', fontWeight: 600, color: '#64748b', cursor: 'pointer' }}
          >
            <CheckCheck size={14} /> Mark All Read
          </button>
          
          <button className="action-btn" onClick={() => queryClient.invalidateQueries(['vessel-report-notifications'])}>
            <RefreshCw size={14} className={isFetching ? 'spin' : ''} color="#64748b" />
          </button>
        </div>
      </div>

      {/* Feed List */}
      <div className="feed-scroll-container">
        {isLoading ? (
          <div className="feed-empty-state">
            <div className="spinner" style={{ width: '24px', height: '24px', border: '2px solid #cbd5e1', borderTopColor: '#3b82f6', borderRadius: '50%', marginBottom: '16px' }} />
            <p>Loading feed...</p>
          </div>
        ) : filteredNotifs.length === 0 ? (
          <div className="feed-empty-state">
            <CheckCircle size={48} color="#cbd5e1" style={{ marginBottom: '16px' }} />
            <h3>You're all caught up!</h3>
            <p>No {filter === 'UNREAD' ? 'unread' : ''} notifications at the moment.</p>
          </div>
        ) : (
          <div className="feed-list" style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
            {filteredNotifs.map(item => {
              const cfg = EVENT_CONFIG[item.type] || EVENT_CONFIG.new_report;
              const Icon = cfg.icon;

              // Parse title for vessel name if needed, assuming format like "New report available — AM Tarang"
              const titleParts = item.title?.split('—') || [];
              const vesselName = titleParts.length > 1 ? titleParts[1].trim() : 'System';
              const mainTitle = titleParts[0].trim();

              return (
                <div 
                  key={item.id}
                  className={`feed-row ${item.is_read ? 'is-read' : 'is-unread'}`}
                  style={{
                    "--row-accent": cfg.color,
                    "--row-bg": cfg.bg,
                    "--row-border": cfg.border,
                    background: '#fff',
                    border: '1px solid var(--row-border)',
                    borderRadius: '12px',
                    padding: '16px',
                    marginBottom: '12px',
                    display: 'flex',
                    gap: '16px',
                    position: 'relative',
                    boxShadow: item.is_read ? 'none' : '0 4px 12px rgba(0,0,0,0.03)'
                  }}
                >
                  <div className="feed-row-icon-box" style={{ background: cfg.bg, padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'fit-content' }}>
                    <Icon size={18} color={cfg.color} />
                  </div>
                  
                  <div className="feed-row-content" style={{ flex: 1 }}>
                    <div className="feed-row-top" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span className="vessel-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
                        <Anchor size={11} color="#94a3b8" /> {vesselName}
                      </span>
                      <span className="desc-text" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b' }}>
                        {mainTitle}
                      </span>
                    </div>
                    
                    <div className="feed-row-bottom">
                      <span className="message-text" style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>
                        {item.body}
                      </span>
                    </div>
                  </div>

                  <div className="feed-row-actions" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                    <span className="timestamp" style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 500 }}>
                      {fmtRelativeDateTime(item.created_at)}
                    </span>
                    <div className="btn-group" style={{ display: 'flex', gap: '6px' }}>
                      {item.report_id && (
                        <button 
                          onClick={() => handleView(item)} 
                          style={{ background: '#f1f5f9', border: 'none', padding: '6px', borderRadius: '6px', cursor: 'pointer', color: '#64748b' }}
                          title="View Report"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                      {!item.is_read && (
                        <button 
                          onClick={() => handleMarkDone(item.id)} 
                          disabled={markReadMutation.isPending}
                          style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, padding: '6px', borderRadius: '6px', cursor: 'pointer', color: cfg.color }}
                          title="Mark as Done"
                        >
                          <CheckCircle size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .feed-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 24px;
          background: #fff;
          border-bottom: 1px solid #e2e8f0;
        }
        .feed-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .feed-header-left h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 800;
          color: #0f172a;
        }
        .feed-count-badge {
          background: #ef4444;
          color: #fff;
          font-size: 0.75rem;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 12px;
        }
        .feed-header-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .feed-filters {
          display: flex;
          background: #f1f5f9;
          padding: 4px;
          border-radius: 8px;
        }
        .feed-filter-btn {
          background: transparent;
          border: none;
          padding: 6px 12px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #64748b;
          border-radius: 6px;
          cursor: pointer;
        }
        .feed-filter-btn.active {
          background: #fff;
          color: #0f172a;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .feed-scroll-container {
          flex: 1;
          overflow-y: auto;
          position: relative;
        }
        .feed-empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #64748b;
        }
        .feed-empty-state h3 {
          margin: 0 0 8px;
          font-size: 1.1rem;
          font-weight: 700;
          color: #1e293b;
        }
        .feed-empty-state p {
          margin: 0;
          font-size: 0.9rem;
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
