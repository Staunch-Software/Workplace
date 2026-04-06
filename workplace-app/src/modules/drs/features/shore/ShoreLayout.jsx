import React, { useState, useRef, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { defectApi } from '@drs/services/defectApi';
import {
  LayoutGrid, ListTodo, LogOut, FileText,
  Building2, Bell, X, ChevronDown, UserPlus, Plus, Mail, Ship, Columns, AlertOctagon, MessageSquare, CheckCircle, Info, ArrowLeft, ChevronLeft, Menu
} from 'lucide-react';
import './Shore.css';
import { createVessel } from '@drs/api/vessels';
import "../../components/shared/defects-responsive.css"

const ShoreLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // --- UI STATES ---
  const [showNotifications, setShowNotifications] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isVesselModalOpen, setIsVesselModalOpen] = useState(false);
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const notifRef = useRef(null);
  const profileRef = useRef(null);
  const userMenuRef = useRef(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [clickedNotifications, setClickedNotifications] = useState(new Set()); // Track clicked IDs

  // --- NOTIFICATION DATA LOGIC ---
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: defectApi.getNotifications,
    refetchInterval: 15000,
  });

  // --- VESSEL REGISTRATION STATE ---
  const [vesselData, setVesselData] = useState({
    imo_number: '',
    name: '',
    vessel_type: 'Oil Tanker',
    email: ''
  });

  const badgeCount = notifications.filter(n => !n.is_seen).length; // Badge = New alerts
  const displayList = notifications.filter(n => !n.is_read);      // List = Actionable items

  const markSeenMutation = useMutation({
    mutationFn: defectApi.markNotificationsSeen,
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

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

  // --- MUTATIONS ---
  const addVesselMutation = useMutation({
    mutationFn: createVessel,
    onSuccess: () => {
      queryClient.invalidateQueries(['vessels']);
      setIsVesselModalOpen(false);
      setVesselData({ imo_number: '', name: '', vessel_type: 'Oil Tanker', email: '' });
      alert("✅ Vessel Registered Successfully!");
    },
    onError: (err) => alert(`❌ Registration failed: ${err.message}`)
  });

  const handleRegisterSubmit = (e) => {
    e.preventDefault();
    if (vesselData.imo_number.length !== 7) return alert("IMO Number must be 7 digits.");
    addVesselMutation.mutate(vesselData);
  };
  // --- HANDLERS ---
  const handleToggleNotif = (e) => {
    e.stopPropagation();
    if (!showNotifications && badgeCount > 0) {
      markSeenMutation.mutate(); // Clear red badge on click
    }
    setShowNotifications(!showNotifications);
    setIsMenuOpen(false);
  };

  const handleNotificationClick = (notification) => {
    console.log('📬 Notification clicked:', notification);

    // ✅ Add to clicked set (changes color from yellow to white)
    // Notification STAYS in panel until X or Clear All
    setClickedNotifications(prev => new Set([...prev, notification.id]));

    const isInternal = notification.meta?.is_internal || false;
    const defectId = notification.meta?.defect_id;

    let link = notification.link;

    if (link?.startsWith('/drs/shore/vessels')) {
      link = link.replace('/drs/shore/vessels', '/drs/shore/dashboard');
    }


    // ✅ Navigation Logic
    if (link) {
      console.log('🔗 Using notification link:', link);
      navigate(link, { state: { autoOpenDefectId: defectId, isInternal } });
      setTimeout(() => setShowNotifications(false), 100);
    } else if (notification.type === 'MENTION') {
      console.log('💬 Mention notification without link, routing to tasks');
      navigate('/drs/shore/tasks', { state: { highlightDefectId: defectId, isInternal } });
      setTimeout(() => setShowNotifications(false), 100);
    } else {
      console.log('⚠️ No link in notification, routing to dashboard');
      navigate('/drs/shore/dashboard', { state: { autoOpenDefectId: defectId, isInternal } });
      setTimeout(() => setShowNotifications(false), 100);
    }
  };

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



  const handleCustomizeColumns = () => {
    setShowUserMenu(false);
    // Trigger the modal opening via a custom event
    window.dispatchEvent(new CustomEvent('openColumnCustomization'));
  };
  const handleLogout = () => { logout(); navigate('/login'); };

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) setShowNotifications(false);
      if (profileRef.current && !profileRef.current.contains(event.target)) setIsMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleClearAll = async () => {
    console.log('🧹 Dismissing all notifications from panel');
    await dismissAllNotificationsMutation.mutateAsync();
  };

  const isActive = (path) => location.pathname === path;



  return (
    <div className="shore-shell-topnav">
      {isSidebarOpen && (
        <div
          className="defect-mobile-overlay"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      <nav className="top-nav defect-top-navbar">
        {/* LEFT */}
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

          <div className="vessel-brand defect-nav-brand">
            <div className="brand-logo" style={{margin:"0px"}}><Building2 size={24} color="#2dd4bf" /></div>
            <div className="vessel-info">
              <h1 className="defect-nav-title">Ozellar Marine</h1>
              <span className="imo-badge defect-nav-badge">Shore HQ</span>
            </div>
          </div>
          <div className="nav-divider-v defect-nav-divider"></div>
          <div className="nav-pill-group defect-desktop-nav">
            <button
              className={`nav-pill ${isActive('/drs/shore/analytics-dashboard') ? 'active' : ''}`}
              onClick={() => navigate('/drs/shore/analytics-dashboard')}
            >
              <LayoutGrid size={16} />
              <span>Dashboard</span>
            </button>
            <button className={`nav-pill ${isActive('/drs/shore/dashboard') ? 'active' : ''}`} onClick={() => navigate('/drs/shore/dashboard')}>
              {/* <LayoutGrid size={16} /> */}
              <span className="pill-label">Defect List</span>
            </button>
            <button className={`nav-pill ${isActive('/drs/shore/tasks') ? 'active' : ''}`} onClick={() => navigate('/drs/shore/tasks')}>
              {/* <ListTodo size={16} /> */}
              <span className="pill-label">My Feed</span>
            </button>
            {/* ✅ NEW: Reports Tab */}
            <button className={`nav-pill ${isActive('/drs/shore/reports') ? 'active' : ''}`} onClick={() => navigate('/drs/shore/reports')}>
              <FileText size={16} />
              <span className="pill-label">Reports</span>
            </button>
          </div>
        </div>

        {/* RIGHT */}
        <div className="nav-right defect-nav-right">




          {/* NOTIFICATION UI INTEGRATED */}
          <div className="nav-action-wrapper" ref={notifRef}>
            <button
              className={`notif-btn  notif-bell-scaling ${showNotifications ? 'active' : ''}`}
              onClick={handleToggleNotif}
              aria-label="Notifications"
              style={{ margin: "10px" }}
            >
              <Bell size={20} />
              {badgeCount > 0 && <span className="notif-badge">{badgeCount}</span>}
            </button>

            {showNotifications && (
              <div className="nav-dropdown notif-panel notif-panel-scaling">
                <div className="notif-header notif-header-scaling">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Bell size={18} color="#ea580c" />
                    <h3 className="notif-panel-title notif-title-main-scaling" style={{ margin: 0, fontWeight: '700', color: '#0f172a' }}>
                      Notifications
                    </h3>
                  </div>
                  {displayList.length > 0 && (
                    <button
                      onClick={handleClearAll}
                      className="notif-clear-btn-scaling"
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

                <div className="notif-list notif-list-height-scaling" style={{ overflowY: 'auto' }}>
                  {displayList.length === 0 ? (
                    <div className="notif-empty-state-scaling" style={{
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
                          className="notif-item-scaling"
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              {/* Type Icon */}
                              {n.type === 'MENTION' && (
                                <div className="notif-icon-box-scaling" >
                                  <MessageSquare size={12} color="#3b82f6" />
                                </div>
                              )}
                              {n.type === 'ALERT' && (
                                <div className="notif-icon-box-scaling">
                                  <AlertOctagon size={12} color="#ea580c" />
                                </div>
                              )}
                              {n.type === 'SYSTEM' && (
                                <div className="notif-icon-box-scaling">
                                  <Info size={12} color="#64748b" />
                                </div>
                              )}

                              {/* Title */}
                              <strong className="notif-item-title-scaling" style={{ color: '#1e293b', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {n.title}
                              </strong>
                            </div>

                            {/* Message */}
                            <p className="notif-item-msg-scaling" style={{ color: '#64748b', margin: '0 0 8px 0', lineHeight: '1.5', display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {n.message}
                            </p>

                            {/* Timestamp */}
                            <div className="notif-footer-scaling" style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}>
                              <span style={{
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

                              <span className="notif-badge-scaling" style={{
                                fontSize: '10px',
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

          <div className="divider-v"></div>

          {/* PROFILE PILL */}
          {/* <div className="profile-container" ref={profileRef}>
            <div className="profile-pill" onClick={toggleProfileMenu}>
              <div className="avatar-circle">{user?.name?.charAt(0) || 'A'}</div>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
                <span className="profile-name">{user?.name || 'Admin'}</span>
                <span style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'left' }}>
                  {user?.job_title || user?.role || 'Fleet Manager'}
                </span>
              </div>
              <ChevronDown size={16} className={`arrow ${isMenuOpen ? 'up' : ''}`} />
            </div>

            {isMenuOpen && (
              <div className="profile-dropdown" style={{ zIndex: 1001 }}>
                {user?.role === 'ADMIN' && (
                  <div className="dropdown-item" onClick={() => navigate('/drs/shore/admin/users')}>
                    <UserPlus size={16} /><span>Admin Panel</span>
                  </div>
                )}
                <div className="dropdown-item logout" onClick={handleLogout}>
                  <LogOut size={16} /><span>Logout</span>
                </div>
              </div>
            )}
          </div> */}

          <div className="nav-action-wrapper" ref={userMenuRef}>
            <button
              className={`user-btn ${showUserMenu ? 'active' : ''}`}
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                setShowNotifications(false);
              }}
            >
              <div className="avatar-circle">
                {user?.full_name?.charAt(0) || 'A'}
              </div>
              <div className="user-text">
                <span className="name">{user?.full_name || 'User'}</span>
                <span className="role">{user?.job_title || 'Crew'}</span>
              </div>
            </button>

            {showUserMenu && (
              <div className="nav-dropdown user-menu defect-user-menu-scaling">
                <div className="user-profile-header defect-user-header-scaling">
                  <div className="avatar-large">
                    {user?.full_name?.charAt(0) || 'U'}
                  </div>
                  <div className="profile-details defect-avatar-scaling">
                    <strong className="defect-user-name-scaling">{user?.full_name}</strong>
                    <span className="defect-user-email-scaling">{user?.email}</span>
                  </div>
                </div>

                <div className="dropdown-divider"></div>

                {/* ✅ NEW: Customize Columns Button */}
                <button
                  className="dropdown-item customize-columns defect-item-scaling"
                  onClick={handleCustomizeColumns}
                >
                  <Columns size={16} />
                  Customize Columns
                </button>

                <div className="dropdown-divider"></div>

                <button className="dropdown-item logout defect-item-scaling" onClick={() => navigate('/dashboard')}>
                  <ArrowLeft size={16} />
                  Back to Dashboard
                </button>
              </div>
            )}

            <button
              className="defect-hamburger-btn"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <Menu size={24} />
            </button>

          </div>
        </div>
      </nav>

      {/* 5. ADD THE COLLAPSIBLE SIDEBAR DRAWER */}
      <aside className={`defect-mobile-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#2dd4bf' }}>Ozellar Navigation</h2>
          <button onClick={() => setIsSidebarOpen(false)}><X size={24} /></button>
        </div>

        <div className="sidebar-links">
          <button className={`side-nav-item ${isActive('/drs/shore/analytics-dashboard') ? 'active' : ''}`}
            onClick={() => { navigate('/drs/shore/analytics-dashboard'); setIsSidebarOpen(false); }}>
            <LayoutGrid size={18} /> Dashboard
          </button>

          <button className={`side-nav-item ${isActive('/drs/shore/dashboard') ? 'active' : ''}`}
            onClick={() => { navigate('/drs/shore/dashboard'); setIsSidebarOpen(false); }}>
            <ListTodo size={18} /> Defect List
          </button>

          <button className={`side-nav-item ${isActive('/drs/shore/tasks') ? 'active' : ''}`}
            onClick={() => { navigate('/drs/shore/tasks'); setIsSidebarOpen(false); }}>
            <MessageSquare size={18} /> My Feed
          </button>

          <button className={`side-nav-item ${isActive('/drs/shore/reports') ? 'active' : ''}`}
            onClick={() => { navigate('/drs/shore/reports'); setIsSidebarOpen(false); }}>
            <FileText size={18} /> Reports
          </button>
        </div>
      </aside>

      <main className="main-viewport">
        <div className="page-content">
          <Outlet />
        </div>
      </main>

      {/* --- 🆕 REGISTER VESSEL MODAL --- */}
      {isVesselModalOpen && user?.role === 'ADMIN' && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ width: '450px' }}>
            <div className="modal-header">
              <h3><Ship size={18} style={{ marginRight: '8px' }} /> Register New Vessel</h3>
              <button className="close-btn" onClick={() => setIsVesselModalOpen(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleRegisterSubmit} className="modal-body">
              <div className="form-group">
                <label>IMO Number</label>
                <input
                  className="input-field" maxLength={7} placeholder="9792058"
                  value={vesselData.imo_number}
                  onChange={(e) => setVesselData({ ...vesselData, imo_number: e.target.value.replace(/\D/g, '') })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Vessel Name</label>
                <input
                  className="input-field" placeholder="A.M. UMANG"
                  value={vesselData.name}
                  onChange={(e) => setVesselData({ ...vesselData, name: e.target.value.toUpperCase() })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Vessel Type</label>
                <div className="custom-select-wrapper">
                  <select
                    className="input-field custom-select"
                    value={vesselData.vessel_type}
                    onChange={(e) => setVesselData({ ...vesselData, vessel_type: e.target.value })}
                    onFocus={() => setIsSelectOpen(true)}
                    onBlur={() => setIsSelectOpen(false)}
                  >
                    <option>Oil Tanker</option>
                    <option>Bulk Carrier</option>
                    <option>Container Ship</option>
                    <option>LNG Carrier</option>
                    <option>General Cargo</option>
                  </select>
                  {/* The Arrow Icon */}
                  <ChevronDown
                    size={18}
                    className={`select-icon-arrow ${isSelectOpen ? 'up' : ''}`}
                  />
                </div>
              </div>
              <div className="form-group">
                <label><Mail size={14} style={{ verticalAlign: 'middle' }} /> Ship Email (Optional)</label>
                <input
                  type="email" className="input-field" placeholder="master.umang@shipping.com"
                  value={vesselData.email}
                  onChange={(e) => setVesselData({ ...vesselData, email: e.target.value })}
                />
              </div>
              <div className="modal-footer" style={{ borderTop: 'none', padding: '0', marginTop: '20px' }}>
                <button
                  type="submit" className="btn-confirm-vessel"
                  disabled={addVesselMutation.isPending}
                >
                  {addVesselMutation.isPending ? 'Registering...' : 'Confirm Registration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default ShoreLayout;