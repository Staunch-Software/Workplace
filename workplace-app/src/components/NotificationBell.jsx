// src/components/NotificationBell.jsx
//
// Global notification bell shown in the Navbar.
// Polls /api/v1/notifications every 15 seconds.
// Notification types:
//   "mention"    – @mention in a thread
//   "new_report" – new scrape cycle for an assigned vessel
//   "new_thread" – shore sent a new message (vessel side only)
//
// FIX BUG 1 & 7 (2026-08-21):
//   The original component used hard-coded fetch() calls pointing to
//   '/reports/api/v1' (shore Nginx proxy). On a vessel (local intranet),
//   this URL doesn't resolve — the vessel backend runs on a different host.
//   Fixed by routing through the existing role-aware API clients:
//     - VESSEL role  → vesselReportsApi (localhost:8006 / vessel server)
//     - SHORE/ADMIN  → reportsApi       (Nginx proxy / shore cloud)

import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, MessageSquare, FileText, Check, CheckCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { reportsApi, vesselReportsApi } from '../modules/reports/api/reportsApi';

// ── Role-aware API dispatcher ─────────────────────────────────────────────────
// Returns the correct notifications API set based on the user's role so
// vessel users hit their local backend and shore/admin users hit the cloud.
function useNotificationsApi(role) {
  if (role === 'VESSEL') return vesselReportsApi;
  return reportsApi;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Pick the correct API client based on the logged-in user's role.
  const api = useNotificationsApi(user?.role);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', user?.role],
    queryFn: () => api.getNotifications(),
    enabled: !!user,
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markOneMutation = useMutation({
    mutationFn: (id) => api.markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.role] }),
  });

  const markAllMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.role] }),
  });

  // Close panel when clicking outside
  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={panelRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* ── Bell button ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          position: 'relative',
          background: open ? 'rgba(99,102,241,0.12)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
          borderRadius: '10px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 0.18s',
          color: open ? '#6366f1' : '#64748b',
        }}
        title="Notifications"
      >
        <Bell
          size={20}
          style={{
            animation: unreadCount > 0 ? 'bell-shake 2s ease-in-out infinite' : 'none',
          }}
        />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              background: '#ef4444',
              color: '#fff',
              fontSize: '10px',
              fontWeight: 700,
              borderRadius: '99px',
              minWidth: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
              boxShadow: '0 0 0 2px #fff',
              animation: 'badge-pop 0.3s cubic-bezier(.36,.07,.19,.97)',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 10px)',
            right: 0,
            width: '360px',
            maxHeight: '520px',
            background: '#fff',
            borderRadius: '16px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.14), 0 4px 16px rgba(0,0,0,0.08)',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 99999,
            animation: 'notif-slide-in 0.2s cubic-bezier(.16,1,.3,1)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              borderBottom: '1px solid #f1f5f9',
              background: '#fafafa',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bell size={16} color="#6366f1" />
              <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <span
                  style={{
                    background: '#6366f1',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 700,
                    borderRadius: '99px',
                    padding: '1px 7px',
                  }}
                >
                  {unreadCount} new
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllMutation.mutate()}
                  disabled={markAllMutation.isPending}
                  title="Mark all as read"
                  style={{
                    background: 'transparent',
                    border: '1px solid #e2e8f0',
                    cursor: 'pointer',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s',
                  }}
                >
                  <CheckCheck size={13} />
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '6px',
                  color: '#94a3b8',
                  display: 'flex',
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '48px 20px',
                  gap: '12px',
                  color: '#94a3b8',
                }}
              >
                <Bell size={36} strokeWidth={1.3} />
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500 }}>
                  You&apos;re all caught up!
                </p>
                <p style={{ margin: 0, fontSize: '0.78rem' }}>No notifications yet.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  userRole={user?.role}
                  onNavigate={(url) => {
                    if (!n.is_read) markOneMutation.mutate(n.id);
                    setOpen(false);
                    navigate(url);
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Keyframe animations ── */}
      <style>{`
        @keyframes bell-shake {
          0%, 85%, 100% { transform: rotate(0); }
          87% { transform: rotate(-12deg); }
          90% { transform: rotate(12deg); }
          93% { transform: rotate(-8deg); }
          96% { transform: rotate(8deg); }
          98% { transform: rotate(-3deg); }
        }
        @keyframes badge-pop {
          0% { transform: scale(0); }
          80% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        @keyframes notif-slide-in {
          from { opacity: 0; transform: translateY(-8px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── Notification item ─────────────────────────────────────────────────────────
function NotificationItem({ notification: n, userRole, onNavigate }) {
  const isMention   = n.type === 'mention';
  const isNewThread = n.type === 'new_thread';
  const base = userRole === 'VESSEL' ? '/reports/vessel' : '/reports/shore';

  // For mentions → open the thread panel directly. For new messages/reports → open report.
  const url = (isMention || isNewThread)
    ? `${base}?open=${n.report_id}&thread=true`
    : `${base}?open=${n.report_id}`;

  return (
    <div
      onClick={() => onNavigate(url)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '14px 20px',
        cursor: n.is_read ? 'default' : 'pointer',
        background: n.is_read ? 'transparent' : 'rgba(99,102,241,0.04)',
        borderBottom: '1px solid #f8fafc',
        transition: 'background 0.15s',
        position: 'relative',
      }}
      onMouseEnter={(e) => {
        if (!n.is_read) e.currentTarget.style.background = 'rgba(99,102,241,0.08)';
      }}
      onMouseLeave={(e) => {
        if (!n.is_read) e.currentTarget.style.background = 'rgba(99,102,241,0.04)';
        else e.currentTarget.style.background = 'transparent';
      }}
    >
      {/* Unread dot */}
      {!n.is_read && (
        <span
          style={{
            position: 'absolute',
            left: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#6366f1',
          }}
        />
      )}

      {/* Icon */}
      <div
        style={{
          flexShrink: 0,
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: isMention
            ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
            : isNewThread
            ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
            : 'linear-gradient(135deg, #0ea5e9, #06b6d4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isMention
            ? '0 2px 8px rgba(99,102,241,0.35)'
            : isNewThread
            ? '0 2px 8px rgba(245,158,11,0.35)'
            : '0 2px 8px rgba(14,165,233,0.35)',
          opacity: n.is_read ? 0.55 : 1,
        }}
      >
        {(isMention || isNewThread) ? (
          <MessageSquare size={16} color="#fff" />
        ) : (
          <FileText size={16} color="#fff" />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: '0 0 2px',
            fontSize: '0.82rem',
            fontWeight: n.is_read ? 500 : 700,
            color: n.is_read ? '#64748b' : '#0f172a',
            lineHeight: 1.4,
          }}
        >
          {n.title}
        </p>
        {n.body && (
          <p
            style={{
              margin: '0 0 4px',
              fontSize: '0.76rem',
              color: '#94a3b8',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {n.body}
          </p>
        )}
        <span style={{ fontSize: '0.7rem', color: '#cbd5e1', fontWeight: 500 }}>
          {timeAgo(n.created_at)}
        </span>
      </div>

      {/* Read check */}
      {n.is_read && (
        <Check size={13} style={{ flexShrink: 0, color: '#cbd5e1', marginTop: '3px' }} />
      )}
    </div>
  );
}
