import React from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './AdminPanel.css';

import AllUsers     from './AllUsers';
import CreateUser   from './CreateUser';
import AllVessels   from './AllVessels';
import CreateVessel from './CreateVessel';

const ShieldCheck = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
  </svg>
);
const UsersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const ShipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
    <path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/>
    <path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/><path d="M12 3v4"/>
  </svg>
);
const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
  </svg>
);

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const is = (path) => location.pathname === path;

  const fullName = user?.full_name || 'System Admin';
  const email    = user?.email     || 'admin@platform.com';
  const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="ap-sidebar">
      <div className="ap-sidebar-header">
        <ShieldCheck />
        <span className="ap-sidebar-brand">Platform Admin</span>
      </div>
      <div className="ap-sidebar-body">
        <div>
          <button className="ap-back-btn" onClick={() => navigate('/dashboard')}>
            <ArrowLeftIcon /> Back to Dashboard
          </button>
          <p className="ap-sidebar-section-label">Users</p>
          <nav className="ap-sidebar-nav">
            <button className={`ap-sidebar-link ${is('/admin/users') ? 'active' : ''}`} onClick={() => navigate('/admin/users')}>
              <UsersIcon /> All Users
            </button>
            <button className={`ap-sidebar-link ${is('/admin/users/create') ? 'active' : ''}`} onClick={() => navigate('/admin/users/create')}>
              <PlusIcon /> Create User
            </button>
          </nav>
        </div>
        <div>
          <p className="ap-sidebar-section-label">Vessels</p>
          <nav className="ap-sidebar-nav">
            <button className={`ap-sidebar-link ${is('/admin/vessels') ? 'active' : ''}`} onClick={() => navigate('/admin/vessels')}>
              <ShipIcon /> All Vessels
            </button>
            <button className={`ap-sidebar-link ${is('/admin/vessels/create') ? 'active' : ''}`} onClick={() => navigate('/admin/vessels/create')}>
              <PlusIcon /> Create Vessel
            </button>
          </nav>
        </div>
      </div>
      <div className="ap-sidebar-footer">
        <div className="ap-sidebar-avatar">{initials}</div>
        <div>
          <div className="ap-sidebar-user-name">{fullName}</div>
          <div className="ap-sidebar-user-email">{email}</div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  return (
    <div className="ap-root ap-layout">
      <Sidebar />
      <main className="ap-main">
        <Routes>
          <Route path="/" element={<Navigate to="users" replace />} />
          <Route path="users"          element={<AllUsers />} />
          <Route path="users/create"   element={<CreateUser />} />
          <Route path="vessels"        element={<AllVessels />} />
          <Route path="vessels/create" element={<CreateVessel />} />
        </Routes>
      </main>
    </div>
  );
}