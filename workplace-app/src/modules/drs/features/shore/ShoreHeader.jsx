import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { defectApi } from '@drs/services/defectApi';
import { Bell, ChevronDown, UserPlus, LogOut, X } from 'lucide-react';
import './Shore.css';

const ShoreHeader = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef(null);

  // 1. Fetch
  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: defectApi.getNotifications,
    refetchInterval: 15000,
  });

  // 2. Separate Logic for Badge vs List
  const safeNotifications = Array.isArray(notifications) ? notifications : [];
  const badgeCount = safeNotifications.filter(n => !n.is_seen).length;
  const displayList = safeNotifications.filter(n => !n.is_read);

  // 3. Mutations
  const markSeenMutation = useMutation({
    mutationFn: defectApi.markNotificationsSeen,
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  const markReadMutation = useMutation({
    mutationFn: defectApi.markSingleNotificationRead,
    onSuccess: () => queryClient.invalidateQueries(['notifications'])
  });

  // 4. Toggle Bell (Clears Badge)
  const handleToggleNotif = (e) => {
    e.stopPropagation();
    if (!showNotifications && badgeCount > 0) {
      markSeenMutation.mutate();
    }
    setShowNotifications(!showNotifications);
    setIsMenuOpen(false);
  };

  // 5. Click Item (Removes from List & Navigates)
  const handleNotificationClick = (notification) => {
    setShowNotifications(false);

    // Mark specifically this item as read
    markReadMutation.mutate(notification.id);

    // Navigate
    if (notification.type === 'MENTION' || notification.title.includes('Mention')) {
      navigate('/drs/shore/tasks');
    } else if (notification.link) {
      navigate(notification.link);
    }
  };

  const handleLogout = () => { logout(); navigate('/login'); };
  const toggleProfileMenu = (e) => { e.stopPropagation(); setIsMenuOpen(!isMenuOpen); setShowNotifications(false); };

  useEffect(() => {
    function handleClickOutside(event) {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false); setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifRef]);

  return (
    <header className="shore-header">
      <div className="global-status"><span>System Status: <strong>Online</strong></span></div>
      <div className="header-actions" ref={notifRef}>

        {/* NOTIFICATIONS */}
        <div style={{ position: 'relative' }}>
          <button className={`icon-btn notification-btn ${showNotifications ? 'active' : ''}`} onClick={handleToggleNotif}>
            <Bell size={20} />
            {badgeCount > 0 && <span className="badge-count">{badgeCount}</span>}
          </button>

          {showNotifications && (
            <div className="notification-dropdown" style={{ zIndex: 1001 }}>
              <div className="notif-header">
                <h3>Notifications</h3>
                <button onClick={(e) => { e.stopPropagation(); setShowNotifications(false); }}><X size={16} /></button>
              </div>
              <div className="notif-list">
                {displayList.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No new notifications</div>
                ) : (
                  displayList.map(n => (
                    <div
                      key={n.id}
                      className={`notif-item ${!n.is_seen ? 'unread' : ''}`}
                      onClick={() => handleNotificationClick(n)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="notif-content">
                        <p style={{ fontWeight: '600', marginBottom: '4px', fontSize: '13px' }}>{n.title}</p>
                        <p style={{ fontSize: '12px', margin: 0 }}>{n.message}</p>
                        <span className="notif-time" style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
                          {new Date(n.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* PROFILE */}
        <div className="profile-container">
          <div className="profile-pill" onClick={toggleProfileMenu}>
            <div className="avatar-circle">{user?.name?.charAt(0) || 'A'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
              <span className="profile-name">{user?.name}</span>
              <span style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'left' }}>{user?.job_title || user?.role}</span>
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
        </div>

      </div>
    </header>
  );
};

export default ShoreHeader;