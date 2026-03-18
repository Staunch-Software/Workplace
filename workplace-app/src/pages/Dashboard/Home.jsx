import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { FileText, Trello, Ship, Droplet, Activity } from "lucide-react";
import api from '../../api/axios';
import './Home.css';

const FullScreenLoader = () => (
  <div style={{
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--white)',
    gap: '16px',
    zIndex: 9999,
  }}>
    <div style={{
      width: '48px',
      height: '48px',
      border: '4px solid var(--gray-200)',
      borderTopColor: 'var(--primary)',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
    <span style={{
      fontSize: '0.875rem',
      color: 'var(--gray-500)',
      fontFamily: 'Inter, sans-serif',
      fontWeight: 500,
    }}>
      Loading DRS...
    </span>
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

const Home = () => {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showJobTitleModal, setShowJobTitleModal] = useState(!user?.job_title);
  const [jobTitleInput, setJobTitleInput] = useState('');
  const [savingJobTitle, setSavingJobTitle] = useState(false);

  const handleSaveJobTitle = async () => {
    if (!jobTitleInput.trim()) return;
    setSavingJobTitle(true);
    try {
      await api.patch('/users/me/job-title', { job_title: jobTitleInput.trim() });
      const updatedUser = { ...user, job_title: jobTitleInput.trim() };
      localStorage.setItem('platform_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setShowJobTitleModal(false);
    } catch (err) {
      alert('Failed to save job title');
    } finally {
      setSavingJobTitle(false);
    }
  };

  const handleAppClick = (appId) => {
    if (appId === 'drs') {
      if (user?.role === 'VESSEL') {
        window.open('/drs/vessel/dashboard', '_blank');
      } else {
        window.open('/drs/shore/dashboard', '_blank');
      }
    }

    if (appId === 'lube') {
      window.open('/lub', '_blank');
    }

    if (appId === 'jira') {
      window.open('/jira', '_blank');
    }

    if (appId === 'voyage') {
      window.open('/voyage', '_blank');
    }

    if (appId === 'engine') {
      window.open('/engine', '_blank');
    }
  };

  const allApps = [
    { id: 'drs', permKey: 'drs', name: 'DRS', desc: 'Defect Reporting System', icon: <FileText size={32} />, class: 'hm-card-drs', delay: '0s' },
    { id: 'jira', permKey: 'jira', name: 'SmartPAL JIRA Portal', desc: 'Ticket Tracking for SmartPAL Portal', icon: <Trello size={32} />, class: 'hm-card-jira', delay: '0.1s' },
    { id: 'voyage', permKey: 'voyage', name: 'Voyage Performance', desc: 'Analytics & Tracking', icon: <Ship size={32} />, class: 'hm-card-voyage', delay: '0.2s' },
    { id: 'lube', permKey: 'lubeoil', name: 'Lubeoil Analysis', desc: 'Shore Analysis Portal', icon: <Droplet size={32} />, class: 'hm-card-lube', delay: '0.3s' },
    { id: 'engine', permKey: 'engine_performance', name: 'Engine Performance', desc: 'Metrics & Health', icon: <Activity size={32} />, class: 'hm-card-engine', delay: '0.4s' },
  ];

  const apps = allApps.filter(app => user?.permissions?.[app.permKey] === true);

  return (
    <>
      {loading && <FullScreenLoader />}

      {showJobTitleModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: 'var(--white)', borderRadius: 16,
            width: 420, padding: '32px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <h2 style={{ margin: '0 0 8px', fontSize: '1.25rem', fontWeight: 600, color: 'var(--gray-900)' }}>
              Welcome to Workplace 👋
            </h2>
            <p style={{ margin: '0 0 24px', fontSize: '0.875rem', color: 'var(--gray-500)' }}>
              Please enter your job title to complete your profile.
            </p>
            <input
              type="text"
              placeholder="e.g. Chief Engineer, Fleet Manager"
              value={jobTitleInput}
              onChange={e => setJobTitleInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveJobTitle()}
              style={{
                width: '100%', padding: '10px 14px',
                borderRadius: 8, border: '1px solid var(--gray-300)',
                fontSize: '0.875rem', marginBottom: 16,
                boxSizing: 'border-box', outline: 'none',
              }}
              autoFocus
            />
            <button
              onClick={handleSaveJobTitle}
              disabled={savingJobTitle || !jobTitleInput.trim()}
              style={{
                width: '100%', padding: '10px',
                borderRadius: 8, border: 'none',
                background: 'var(--primary)', color: 'white',
                fontSize: '0.875rem', fontWeight: 500,
                cursor: jobTitleInput.trim() ? 'pointer' : 'not-allowed',
                opacity: jobTitleInput.trim() ? 1 : 0.6,
              }}
            >
              {savingJobTitle ? 'Saving...' : 'Continue'}
            </button>
          </div>
        </div>
      )}
      <main className="hm-container">
        <div className="hm-welcome-header">
          <h1>Welcome back, {user?.full_name ?? user?.name ?? 'User'}</h1>
          <p>Access your primary applications and tools below.</p>
        </div>

        <div className="hm-app-grid">
          {apps.map((app) => (
            <div
              key={app.id}
              className={`hm-app-card ${app.class}`}
              style={{ animationDelay: app.delay }}
              onClick={() => handleAppClick(app.id)}
            >
              <div className="hm-icon-container">
                {app.icon}
              </div>
              <h3>{app.name}</h3>
              <p className="hm-app-description">{app.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </>
  );
};

export default Home;