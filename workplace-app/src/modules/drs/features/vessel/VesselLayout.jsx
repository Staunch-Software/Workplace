///New vessel layout for customize button
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { defectApi } from '@drs/services/defectApi';
import { getVessels } from '@drs/api/vessels';
import {
  Bell, LogOut, Ship, X, User, CheckCircle,
  MessageSquare, AlertOctagon, Info, Columns, FileText, ArrowLeft, ChevronLeft, Mail, Menu, ListTodo
} from 'lucide-react';
import './Vessel.css';
import "../../components/shared/vessel-responsive.css"

const VesselLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // --- UI STATES ---
  const [showNotifications, setShowNotifications] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSearch, setEmailSearch] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftSuccess, setDraftSuccess] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [clickedNotifications, setClickedNotifications] = useState(new Set()); // Track clicked IDs

  const notifRef = useRef(null);
  const userMenuRef = useRef(null);

  const assignedImo = user?.vessels?.[0]?.imo
    || (typeof user?.assigned_vessels?.[0] === 'string' ? user?.assigned_vessels?.[0] : user?.assigned_vessels?.[0]?.imo)
    || user?.assignedVessels?.[0]?.imo;

  // Fetch Vessel Details for Header
  const { data: rawVessels } = useQuery({
    queryKey: ['vessels'],
    queryFn: getVessels
  });
  const vessels = Array.isArray(rawVessels) ? rawVessels : rawVessels?.items ?? rawVessels?.data ?? [];

  // --- NOTIFICATIONS LOGIC ---
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: defectApi.getNotifications,
    refetchInterval: 15000,
  });

  const { data: allDefects = [] } = useQuery({
    queryKey: ['defects', 'vessel-list'],
    queryFn: () => defectApi.getDefects(),
    enabled: showEmailModal,
  });

  // ✅ CORRECTED LOGIC:
  // Badge: Count unseen notifications
  // Panel: Show notifications that are NOT dismissed (is_read = false)
  // Click notification: Add to clickedNotifications set (changes color, stays in panel)
  // Click X: Mark as read (dismisses from panel)
  // Click Clear All: Mark all as read (dismisses all from panel)

  const badgeCount = notifications.filter(n => !n.is_seen).length;
  const displayList = notifications.filter(n => !n.is_read); // Only show non-dismissed

  // --- MUTATIONS ---
  const markSeenMutation = useMutation({
    mutationFn: defectApi.markNotificationsSeen,
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  // ✅ Dismiss single notification (X button - marks as read, removes from panel)
  const dismissNotificationMutation = useMutation({
    mutationFn: defectApi.markSingleNotificationRead,
    onSuccess: () => {
      console.log('✅ Notification dismissed from panel (marked as read in DB)');
      queryClient.invalidateQueries(['notifications']);
    }
  });

  // ✅ Dismiss all notifications (Clear All - marks all as read, removes from panel)
  const dismissAllNotificationsMutation = useMutation({
    mutationFn: defectApi.markNotificationsRead,
    onSuccess: () => {
      console.log('✅ All notifications dismissed from panel (marked as read in DB)');
      setClickedNotifications(new Set()); // Clear clicked state
      queryClient.invalidateQueries(['notifications']);
    }
  });

  // --- HANDLERS ---

  const handleToggleNotif = (e) => {
    e.stopPropagation();

    // ✅ Mark notifications as "seen" when opening panel (removes badge)
    if (!showNotifications && badgeCount > 0) {
      markSeenMutation.mutate();
    }

    setShowNotifications(!showNotifications);
    setShowUserMenu(false);
  };

  const handleNotificationClick = (notification) => {
    console.log('📬 Notification clicked:', notification);

    // ✅ Add to clicked set (changes color from yellow to white)
    // Notification STAYS in panel until X or Clear All
    setClickedNotifications(prev => new Set([...prev, notification.id]));

    // ✅ Navigation Logic
    if (notification.link) {
      console.log('🔗 Using notification link:', notification.link);
      navigate(notification.link);
      setTimeout(() => setShowNotifications(false), 100);
    } else if (notification.type === 'MENTION') {
      console.log('💬 Mention notification without link, routing to tasks');
      navigate('/drs/vessel/tasks');
      setTimeout(() => setShowNotifications(false), 100);
    } else {
      console.log('⚠️ No link in notification, routing to dashboard');
      navigate('/drs/vessel/dashboard');
      setTimeout(() => setShowNotifications(false), 100);
    }
  };

  // ✅ X button - Dismiss single notification (removes from panel, marks as read in DB)
  const handleDismissNotification = async (notificationId, e) => {
    e.stopPropagation();

    console.log('🗑️ Dismissing notification from panel:', notificationId);

    // Remove from clicked set if present
    setClickedNotifications(prev => {
      const newSet = new Set(prev);
      newSet.delete(notificationId);
      return newSet;
    });

    // Mark as read in database (removes from panel)
    await dismissNotificationMutation.mutateAsync(notificationId);
  };

  // ✅ Clear All - Dismiss all notifications (removes from panel, marks all as read in DB)
  const handleClearAll = async () => {
    console.log('🧹 Dismissing all notifications from panel');
    await dismissAllNotificationsMutation.mutateAsync();
  };

  // ✅ NEW: Open Column Customization Modal
  const handleCustomizeColumns = () => {
    setShowUserMenu(false);
    // Trigger the modal opening via a custom event
    window.dispatchEvent(new CustomEvent('openColumnCustomization'));
  };

  const currentVessel = useMemo(() => {
    return vessels.find(v => v.imo === assignedImo);
  }, [vessels, assignedImo]);

  const shipName = user?.assigned_vessel_names?.[0] || 'Unassigned Vessel';
  const shipImo = assignedImo || 'No IMO';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isActive = (path) => location.pathname.includes(path);

  return (
    <div className="modern-shell defect-main-shell">
      {isSidebarOpen && (
        <div className="defect-mobile-overlay" onClick={() => setIsSidebarOpen(false)} />
      )}
      <nav className="top-nav defect-top-navbar">
        <div className="nav-left">
          {/* 9-DOT — ALL APPS */}
          <button
            className="nine-dot-btn defect-nav-app-switcher"
            onClick={() => navigate('/dashboard')}
            title="All apps"
            aria-label="All apps"
          >
            <div className="nine-dot-grid">
              {[...Array(9)].map((_, i) => <span key={i} className="dot" />)}
            </div>
            <span className="nine-dot-label"><ChevronLeft size={20} /></span>
          </button>

          <div className="vessel-brand">
            <div className="brand-logo">
              <Ship size={24} />
            </div>
            <div className="vessel-info defect-nav-vessel-info">
              <h1 className="defect-nav-title">{shipName}</h1>
              <span className="imo-badge defect-nav-badge">IMO: {shipImo}</span>
            </div>
          </div>

          <div className="nav-divider defect-nav-divider"></div>

          <div className="nav-links defect-desktop-nav">
            <button
              className={`nav-item ${isActive('/vessel/dashboard') ? 'active' : ''}`}
              onClick={() => navigate('/drs/vessel/dashboard')}
            >
              <span className="pill-label">Defect List</span>
            </button>
            <button
              className={`nav-item ${isActive('/vessel/tasks') ? 'active' : ''}`}
              onClick={() => navigate('/drs/vessel/tasks')}
            >
              <span className="pill-label">My Feed</span>
            </button>

            <button className={`nav-item ${isActive('/vessel/reports') ? 'active' : ''}`} onClick={() => navigate('/drs/vessel/reports')}>
              <FileText size={16} />
              <span className="pill-label">Reports</span>
            </button>
          </div>
        </div>

        <div className="nav-right defect-nav-right">

          {/* --- ✅ NOTIFICATIONS BELL --- */}
          <div className="nav-action-wrapper" ref={notifRef}>
            <button
              onClick={() => { setShowEmailModal(true); setEmailSearch(''); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px', margin: '0 4px', borderRadius: '8px',
                display: 'flex', alignItems: 'center', color: '#334155', transition: 'all 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              title="Draft Defect Email"
            >
              <Mail size={20} />
            </button>

            <button
              onClick={() => { setShowEmailModal(true); setEmailSearch(''); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '8px', margin: '0 4px', borderRadius: '8px',
                display: 'flex', alignItems: 'center', color: '#334155', transition: 'all 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
              title="Draft Defect Email"
            >
              <Mail size={20} />
            </button>

            <button
              className={`notif-btn defect-bell-scaling  ${showNotifications ? 'active' : ''}`}
              onClick={handleToggleNotif}
              aria-label="Notifications"
              style={{ margin: "10px" }}
            >
              <Bell size={20} />
              {badgeCount > 0 && <span className="notif-badge">{badgeCount}</span>}
            </button>

            {showNotifications && (
              <div className="nav-dropdown notif-panel defect-notif-panel-scaling">
                <div className="notif-header defect-notif-header-scaling">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Bell size={18} color="#ea580c" />
                    <h3 className="defect-notif-panel-title" style={{ margin: 0, fontWeight: '700', color: '#0f172a' }}>
                      Notifications
                    </h3>
                  </div>
                  {displayList.length > 0 && (
                    <button
                      onClick={handleClearAll}
                      className="defect-notif-clear-btn"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ea580c',
                        fontWeight: '600',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#fff7ed'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      Clear All
                    </button>
                  )}
                </div>

                <div className="notif-list defect-notif-list-scaling" style={{ overflowY: 'auto' }}>
                  {displayList.length === 0 ? (
                    <div className="defect-notif-empty-state" style={{
                      padding: '40px 20px',
                      textAlign: 'center',
                      color: '#94a3b8'
                    }}>
                      <CheckCircle size={48} color="#10b981" style={{ marginBottom: '12px' }} />
                      <p style={{ fontSize: '14px', fontWeight: '600', color: '#64748b', margin: 0 }}>
                        All caught up!
                      </p>
                      <p style={{ fontSize: '12px', color: '#94a3b8', margin: '4px 0 0 0' }}>
                        No new notifications
                      </p>
                    </div>
                  ) : (
                    displayList.map(n => {
                      const isClicked = clickedNotifications.has(n.id);

                      return (
                        <div
                          key={n.id}
                          onClick={() => handleNotificationClick(n)}
                          className="defect-notif-item-scaling"
                          style={{
                            padding: '14px 16px',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            background: isClicked ? 'white' : '#fffbeb',
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'flex-start'
                          }}
                          onMouseEnter={(e) => {
                            if (!isClicked) {
                              e.currentTarget.style.background = '#fef3c7';
                            }
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = isClicked ? 'white' : '#fffbeb';
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {/* Icon + Title Row */}
                            <div className="defect-notif-title-row"  style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              {/* Type Icon */}
                              {n.type === 'MENTION' && (
                                <div className="defect-notif-icon-box">
                                  <MessageSquare size={12} color="#3b82f6" />
                                </div>
                              )}
                              {n.type === 'ALERT' && (
                                <div className="defect-notif-icon-box">
                                  <AlertOctagon size={12} color="#ea580c" />
                                </div>
                              )}
                              {n.type === 'SYSTEM' && (
                                <div className="defect-notif-icon-box">
                                  <Info size={12} color="#64748b" />
                                </div>
                              )}

                              {/* Title */}
                              <strong className="defect-notif-title-text" style={{ color: '#1e293b', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {n.title}
                              </strong>
                            </div>

                            {/* Message */}
                            <p className="defect-notif-msg-text" style={{ color: '#64748b', margin: '0 0 8px 0', lineHeight: '1.5', display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {n.message}
                            </p>

                            {/* Timestamp */}
                            <div 
                            className="defect-notif-footer-row" style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}>
                              <span
                              className="defect-notif-time-text"
                               style={{
                                fontSize: '11px',
                                color: '#94a3b8',
                                fontWeight: '500'
                              }}>
                                {new Date(n.created_at).toLocaleString('en-GB', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  hour12: false
                                })}
                              </span>

                              <span
                              className="defect-notif-badge-text"
                              style={{
                                // fontSize: '10px',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                background: n.type === 'MENTION'
                                  ? '#dbeafe'
                                  : n.type === 'ALERT'
                                    ? '#fed7aa'
                                    : '#e5e7eb',
                                color: n.type === 'MENTION'
                                  ? '#1e40af'
                                  : n.type === 'ALERT'
                                    ? '#c2410c'
                                    : '#4b5563'
                              }}>
                                {n.type}
                              </span>
                            </div>
                          </div>

                          {/* ✅ X Button */}
                          <button
                          className="defect-notif-x-btn"
                            onClick={(e) => handleDismissNotification(n.id, e)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: '6px',
                              color: '#cbd5e1',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderRadius: '4px',
                              transition: 'all 0.2s ease',
                              flexShrink: 0,
                              alignSelf: 'flex-start'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#f1f5f9';
                              e.currentTarget.style.color = '#64748b';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'none';
                              e.currentTarget.style.color = '#cbd5e1';
                            }}
                            title="Dismiss notification"
                            aria-label="Dismiss notification"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* --- USER MENU --- */}
          <div className="nav-action-wrapper" ref={userMenuRef}>
            <button
              className={`user-btn ${showUserMenu ? 'active' : ''}`}
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                setShowNotifications(false);
              }}
            >
              <div className="avatar-circle">
                {user?.full_name?.charAt(0) || 'U'}
              </div>
              <div className="user-text">
                <span className="name">{user?.full_name || 'User'}</span>
                <span className="role">{user?.job_title || 'Crew'}</span>
              </div>
            </button>

            {showUserMenu && (
              <div className="nav-dropdown user-menu">
                <div className="user-profile-header">
                  <div className="avatar-large">
                    {user?.full_name?.charAt(0) || 'U'}
                  </div>
                  <div className="profile-details">
                    <strong>{user?.full_name}</strong>
                    <span>{user?.email}</span>
                  </div>
                </div>
                <div className="dropdown-divider"></div>

                {/* ✅ NEW: Customize Columns Button */}
                <button
                  className="dropdown-item customize-columns"
                  onClick={handleCustomizeColumns}
                >
                  <Columns size={16} />
                  Customize Columns
                </button>

                <div className="dropdown-divider"></div>

                <button className="dropdown-item logout" onClick={() => navigate('/dashboard')}>
                  <ArrowLeft size={16} />
                  Back to Dashboard
                </button>
              </div>
            )}
            <button className="defect-hamburger-btn" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={24} />
            </button>
          </div>
        </div>
      </nav>

      <aside className={`defect-mobile-sidebar-right ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2 style={{ color: '#ea580c', fontWeight: '800' }}>Vessel Menu</h2>
          <button onClick={() => setIsSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'white' }}>
            <X size={24} />
          </button>
        </div>

        <div className="sidebar-links">
          <button className={`side-nav-item ${isActive('/vessel/dashboard') ? 'active' : ''}`}
            onClick={() => { navigate('/drs/vessel/dashboard'); setIsSidebarOpen(false); }}>
            <ListTodo size={20} /> Defect List
          </button>
          <button className={`side-nav-item ${isActive('/vessel/tasks') ? 'active' : ''}`}
            onClick={() => { navigate('/drs/vessel/tasks'); setIsSidebarOpen(false); }}>
            <MessageSquare size={20} /> My Feed
          </button>
          <button className={`side-nav-item ${isActive('/vessel/reports') ? 'active' : ''}`}
            onClick={() => { navigate('/drs/vessel/reports'); setIsSidebarOpen(false); }}>
            <FileText size={20} /> Reports
          </button>
        </div>
      </aside>

      <main className="main-viewport">
        <Outlet />
      </main>
      {/* ✅ EMAIL DRAFT MODAL */}
      {
        showEmailModal && (() => {
          const modalDefects = allDefects.filter(d =>
            d.status === 'OPEN' || d.status === 'PENDING_CLOSURE'
          );
          const filtered = modalDefects.filter(d => {
            const q = emailSearch.toLowerCase();
            return !q ||
              d.title?.toLowerCase().includes(q) ||
              d.vessel_name?.toLowerCase().includes(q) ||
              d.equipment_name?.toLowerCase().includes(q);
          });

          const handleSelect = async (defect) => {
            try {
              setDraftLoading(true);
              setDraftSuccess(false);

              // Open blank tab immediately on user click (before async call)
              // This prevents browser popup blocker from blocking it
              const outlookTab = window.open('', '_blank');
              if (outlookTab) {
                outlookTab.document.write(`
    <html>
      <head><title>Opening Outlook...</title></head>
      <body style="
        font-family: sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        background: #f8fafc;
        color: #334155;
      ">
        <div style="
          width: 40px; height: 40px;
          border: 3px solid #e2e8f0;
          border-top: 3px solid #0078d4;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
          margin-bottom: 20px;
        "></div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        <h2 style="margin: 0 0 8px 0; font-size: 18px;">Preparing your Outlook draft...</h2>
        <p style="margin: 0; font-size: 14px; color: #64748b;">
          This will open automatically. Please wait.
        </p>
      </body>
    </html>
  `);
              }

              const data = await defectApi.createEmailDraft(defect.id);
              setDraftLoading(false);
              setDraftSuccess(true);

              // Now redirect the already-open tab to Outlook
              if (outlookTab) {
                outlookTab.location.href = data.web_link || 'https://outlook.office365.com/mail/drafts';
              }

              setTimeout(() => {
                setShowEmailModal(false);
                setDraftSuccess(false);
              }, 1500);

            } catch (err) {
              setDraftLoading(false);
              console.error('Email draft failed:', err);
              alert('Failed to create email draft. Please try again.');
            }
          };

          return (
            <div
              onClick={() => setShowEmailModal(false)}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
                zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  background: 'white', borderRadius: '12px', width: '480px',
                  maxHeight: '560px', display: 'flex', flexDirection: 'column',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden'
                }}
              >
                {/* Header */}
                <div style={{
                  padding: '16px 20px', borderBottom: '1px solid #e2e8f0',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: '#f8fafc'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Mail size={18} color="#0078d4" />
                    <span style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a' }}>
                      Draft Defect Email
                    </span>
                  </div>
                  <button
                    onClick={() => setShowEmailModal(false)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex' }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Search */}
                <div style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9' }}>
                  <input
                    autoFocus
                    placeholder="Search by title, vessel, equipment..."
                    value={emailSearch}
                    onChange={e => setEmailSearch(e.target.value)}
                    style={{
                      width: '100%', padding: '8px 12px', borderRadius: '8px',
                      border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
                    Showing {filtered.length} open / pending defects
                  </div>
                </div>

                {/* Defect List */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {filtered.length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>
                      No defects found
                    </div>
                  ) : (
                    filtered.map(defect => (
                      <div
                        key={defect.id}
                        onClick={() => !draftLoading && handleSelect(defect)}
                        style={{
                          padding: '12px 20px', borderBottom: '1px solid #f1f5f9',
                          cursor: draftLoading ? 'not-allowed' : 'pointer',
                          opacity: draftLoading ? 0.6 : 1,
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '13px', fontWeight: '600', color: '#1e293b',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                            }}>
                              {defect.title}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px' }}>
                              {defect.vessel_name} · {defect.equipment_name}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', marginLeft: '10px', flexShrink: 0 }}>
                            <span style={{
                              fontSize: '10px', fontWeight: '700', padding: '2px 7px',
                              borderRadius: '10px',
                              background: defect.priority === 'CRITICAL' ? '#fee2e2' : defect.priority === 'HIGH' ? '#ffedd5' : defect.priority === 'MEDIUM' ? '#dbeafe' : '#dcfce7',
                              color: defect.priority === 'CRITICAL' ? '#dc2626' : defect.priority === 'HIGH' ? '#ea580c' : defect.priority === 'MEDIUM' ? '#2563eb' : '#16a34a',
                            }}>
                              {defect.priority}
                            </span>
                            <span style={{
                              fontSize: '10px', fontWeight: '700', padding: '2px 7px',
                              borderRadius: '10px',
                              background: defect.status === 'PENDING_CLOSURE' ? '#fef3c7' : '#dbeafe',
                              color: defect.status === 'PENDING_CLOSURE' ? '#d97706' : '#2563eb',
                            }}>
                              {defect.status === 'PENDING_CLOSURE' ? 'PENDING' : defect.status}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Loading / Success Footer */}
                {(draftLoading || draftSuccess) && (
                  <div style={{
                    padding: '16px 20px',
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    background: draftSuccess ? '#f0fdf4' : '#f8fafc'
                  }}>
                    {draftLoading && (
                      <>
                        <div style={{
                          width: '18px', height: '18px',
                          border: '2px solid #e2e8f0',
                          borderTop: '2px solid #0078d4',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite'
                        }} />
                        <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>
                          Creating draft in Outlook...
                        </span>
                      </>
                    )}
                    {draftSuccess && (
                      <>
                        <span style={{ fontSize: '18px' }}>✅</span>
                        <span style={{ fontSize: '13px', color: '#16a34a', fontWeight: '600' }}>
                          Draft created! Opening Outlook...
                        </span>
                      </>
                    )}
                  </div>
                )}

              </div>
            </div>
          );
        })()}
    </div>
  );
};

export default VesselLayout;