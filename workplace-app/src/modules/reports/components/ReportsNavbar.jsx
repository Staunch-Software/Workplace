// src/modules/reports/components/ReportsNavbar.jsx
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { ChevronDown, Settings, Home, LayoutGrid, Rss, LayoutDashboard } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import coreApi from '@/api/axios';
import NotificationBell from '@/components/NotificationBell';

export default function ReportsNavbar({ totalUnread, reportsRemaining }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const isAdmin = user?.role === 'ADMIN';
  const fullName = user?.full_name || user?.name || 'User';
  const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  useEffect(() => {
    function handleOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const { data: coreVessels = [] } = useQuery({
    queryKey: ['core-vessels'],
    queryFn: () => coreApi.get('/vessels').then(r => r.data),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  let vesselName = fullName;
  if (user?.role === 'VESSEL') {
    const assigned = user?.assigned_vessels?.[0];
    const imo = typeof assigned === 'string' ? assigned : assigned?.imo;
    const matched = coreVessels.find(v => v.imo === imo);
    if (matched) vesselName = matched.name;
  }

  return (
    <nav className="rpt-navbar">

      {/* ── Subtle dots-grid → arrow ── */}
      <button
        className="rpt-nav-home-btn"
        onClick={() => navigate('/dashboard')}
        title="Back to Dashboard"
        aria-label="Back to Dashboard"
        onMouseEnter={e => {
          e.currentTarget.querySelector('.rpt-dots-grid').style.opacity = '0';
          e.currentTarget.querySelector('.rpt-dots-arrow').style.opacity = '1';
        }}
        onMouseLeave={e => {
          e.currentTarget.querySelector('.rpt-dots-grid').style.opacity = '1';
          e.currentTarget.querySelector('.rpt-dots-arrow').style.opacity = '0';
        }}
      >
        <div className="rpt-dots-grid">
          {[...Array(9)].map((_, i) => <span key={i} className="rpt-dot" />)}
        </div>
        <div className="rpt-dots-arrow">‹</div>
      </button>

      <div className="rpt-nav-divider" />

      {/* ── Brand ── */}
      <div className="rpt-nav-brand">
        <div className="rpt-nav-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        </div>
        <div className="rpt-nav-brand-text">
          <div className="rpt-nav-title">Report Tracker</div>
          <div className="rpt-nav-title-tag">
            {user?.role === 'VESSEL' ? `Vessel · ${vesselName}` : 'Shore · Admin'}
          </div>
        </div>
      </div>

      {/* ── Navigation Links ── */}
      <div className="rpt-nav-links" style={{ marginLeft: '24px' }}>
        {user?.role !== 'VESSEL' && (
          <button
            className={`rpt-nav-link ${location.pathname.includes('overview') ? 'active' : ''}`}
            onClick={() => navigate('/reports/overview')}
          >
            <LayoutDashboard size={14} />
            Overview
          </button>
        )}
        <button
          className={`rpt-nav-link ${(location.pathname.endsWith('shore') || location.pathname.endsWith('vessel')) ? 'active' : ''}`}
          onClick={() => navigate(user?.role === 'VESSEL' ? '/reports/vessel' : '/reports/shore')}
        >
          <LayoutGrid size={14} />
          Dashboard
        </button>
        <button
          className={`rpt-nav-link ${location.pathname.includes('feed') ? 'active' : ''}`}
          onClick={() => navigate(user?.role === 'VESSEL' ? '/reports/vessel-feed' : '/reports/feed')}
        >
          <Rss size={14} />
          Feed
        </button>
      </div>

      <div style={{ flex: 1 }} />

      {/* ── Notification Bell ── */}
      <NotificationBell />

      {/* ── Profile ── */}
      <div className="rpt-nav-profile" ref={profileRef}>
        <div className="rpt-profile-pill" onClick={() => setProfileOpen(o => !o)}>
          <div className="rpt-avatar">{initials}</div>
          <div className="rpt-profile-info">
            <span className="rpt-profile-name">{fullName}</span>
            <span className="rpt-profile-role">{user?.role}</span>
          </div>
          <ChevronDown size={13} className={`rpt-profile-chevron ${profileOpen ? 'open' : ''}`} />
        </div>

        {profileOpen && (
          <div className="rpt-profile-dropdown">
            <div className="rpt-dropdown-user">
              <div className="rpt-dropdown-avatar">{initials}</div>
              <div>
                <div className="rpt-dropdown-user-name">{fullName}</div>
                <div className="rpt-dropdown-user-role">{user?.email || user?.role}</div>
              </div>
            </div>
            <div className="rpt-dropdown-sep" />
            {isAdmin && (
              <button className="rpt-dropdown-item" onClick={() => { navigate('/reports/config'); setProfileOpen(false); }}>
                <Settings size={15} /><span>Configure Reports</span>
              </button>
            )}
            <button className="rpt-dropdown-item" onClick={() => navigate('/dashboard')}>
              <Home size={15} /><span>Back to Dashboard</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
