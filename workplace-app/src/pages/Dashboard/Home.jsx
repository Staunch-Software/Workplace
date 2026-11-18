import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ClipboardList, Trello, Droplet, Activity, FileCheck2, BookOpen, ShieldAlert, Ship, Star, User } from "lucide-react";
import api from '../../api/axios';
import './Home.css';

const MAX_RECENT = 3;

const readStore = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeStore = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const timeAgo = (ts) => {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
};

const SkeletonCards = () => (
  <div className="hm-app-grid" aria-hidden="true">
    {[0, 1, 2, 3, 4, 5].map(i => (
      <div key={i} className="hm-skel-card">
        <div className="hm-skel hm-skel-icon" />
        <div className="hm-skel-lines">
          <div className="hm-skel" style={{ height: 12, width: '65%' }} />
          <div className="hm-skel" style={{ height: 10, width: '45%', marginTop: 8 }} />
        </div>
      </div>
    ))}
  </div>
);

const Home = ({ searchQuery = '' }) => {
  const { user, setUser } = useAuth();
  const [category, setCategory] = useState('all');
  const storeId = user?.id ?? user?.email ?? 'user';
  const pinsKey = `hm_pins_${storeId}`;
  const recentKey = `hm_recent_${storeId}`;
  const [pins, setPins] = useState(() => readStore(pinsKey, []));
  const [recent, setRecent] = useState(() => readStore(recentKey, []));
  const [showJobTitleModal, setShowJobTitleModal] = useState(!user?.job_title);
  const [jobTitleInput, setJobTitleInput] = useState('');
  const [savingJobTitle, setSavingJobTitle] = useState(false);

  useEffect(() => { document.title = 'Workplace'; }, []);

  const handleSaveJobTitle = async () => {
    if (!jobTitleInput.trim()) return;
    setSavingJobTitle(true);
    try {
      await api.patch('/users/me/job-title', { job_title: jobTitleInput.trim() });
      const updatedUser = { ...user, job_title: jobTitleInput.trim() };
      localStorage.setItem('platform_user', JSON.stringify(updatedUser));
      setUser(updatedUser);
      setShowJobTitleModal(false);
    } catch {
      alert('Failed to save job title');
    } finally {
      setSavingJobTitle(false);
    }
  };

  const togglePin = (appId) => {
    const next = pins.includes(appId) ? pins.filter(p => p !== appId) : [...pins, appId];
    setPins(next);
    writeStore(pinsKey, next);
  };

  const handleAppClick = (appId) => {
    const nextRecent = [{ id: appId, ts: Date.now() }, ...recent.filter(r => r.id !== appId)].slice(0, MAX_RECENT);
    setRecent(nextRecent);
    writeStore(recentKey, nextRecent);

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


    if (appId === 'engine') {
      window.open('/aepms', '_blank');
    }

    if (appId === 'reports') {
      window.open('/reports/overview', '_blank');
    }

    if (appId === 'orb') {
      window.open('/orb/dashboard', '_blank');
    }

    if (appId === 'incident') {
      window.open('/incident', '_blank');
    }

    if (appId === 'vp') {
      window.open('/vp', '_blank');
    }
  };

  const groups = [
    { key: 'ops', label: 'Operations' },
    { key: 'perf', label: 'Performance and analysis' },
    { key: 'safe', label: 'Compliance and safety' },
  ];

  const allApps = [
    { id: 'drs', group: 'ops', permKey: 'drs', name: 'DRS', desc: 'Defect Reporting System', icon: <ClipboardList />, class: 'hm-grp-ops' },
    { id: 'jira', group: 'ops', permKey: 'jira', name: 'SmartPAL JIRA Portal', desc: 'Ticket Tracking for SmartPAL Portal', icon: <Trello />, class: 'hm-grp-ops' },
    { id: 'reports', group: 'ops', permKey: 'report_tracker', name: 'Report Tracker', desc: 'Report Tracking & Threads', icon: <FileCheck2 />, class: 'hm-grp-ops' },
    { id: 'engine', group: 'perf', permKey: 'engine_performance', name: 'Engine Performance', desc: 'Metrics & Health', icon: <Activity />, class: 'hm-grp-perf' },
    { id: 'lube', group: 'perf', permKey: 'lubeoil', name: 'Lubeoil Analysis', desc: 'Shore Analysis Portal', icon: <Droplet />, class: 'hm-grp-perf' },
    { id: 'vp', group: 'perf', permKey: 'vessel_performance', name: 'Vessel Performance', desc: 'Noon Reports, CP, ISO 19030 & Emissions', icon: <Ship />, class: 'hm-grp-perf' },
    { id: 'orb', group: 'safe', permKey: 'orb', name: 'Oil Record Book', desc: 'ORB Digitisation & Compliance', icon: <BookOpen />, class: 'hm-grp-orb' },
    { id: 'incident', group: 'safe', permKey: 'incident_report', name: 'Incident Reports', desc: 'Incident Repository & Investigation', icon: <ShieldAlert />, class: 'hm-grp-incident' },
  ];

  const apps = allApps
    .filter(app => user?.permissions?.[app.permKey] === true)
    .filter(app => category === 'all' || app.group === category)
    .filter(app =>
      !searchQuery.trim() ||
      app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.desc.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const isDefaultView = category === 'all' && !searchQuery.trim();
  const permissionsReady = !!user?.permissions;

  const hasAnyAccess = allApps.some(a => user?.permissions?.[a.permKey] === true);

  const pinnedApps = apps.filter(a => pins.includes(a.id));
  const unpinnedApps = apps.filter(a => !pins.includes(a.id));

  const recentApps = isDefaultView
    ? recent
        .map(r => ({ ...r, app: allApps.find(a => a.id === r.id) }))
        .filter(r => r.app && user?.permissions?.[r.app.permKey] === true)
    : [];

  const showHint = permissionsReady && isDefaultView && apps.length > 0
    && pinnedApps.length === 0 && recentApps.length === 0;

  const visibleGroups = groups
    .map(g => ({ ...g, apps: unpinnedApps.filter(a => a.group === g.key) }))
    .filter(g => g.apps.length > 0);

  const onCardKeyDown = (e, appId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleAppClick(appId);
    }
  };

  const renderCard = (app, i) => {
    const pinned = pins.includes(app.id);
    return (
      <div
        key={app.id}
        className={`hm-app-card ${app.class}`}
        style={{ animationDelay: `${i * 0.06}s` }}
      >
        <div
          className="hm-card-main"
          role="button"
          tabIndex={0}
          onClick={() => handleAppClick(app.id)}
          onKeyDown={(e) => onCardKeyDown(e, app.id)}
        >
          <div className="hm-icon-container">{app.icon}</div>
          <div className="hm-card-text">
            <h3>{app.name}</h3>
            <p className="hm-app-description">{app.desc}</p>
          </div>
        </div>
        <button
          type="button"
          className={`hm-pin ${pinned ? 'is-pinned' : ''}`}
          aria-label={pinned ? `Unpin ${app.name}` : `Pin ${app.name}`}
          aria-pressed={pinned}
          onClick={() => togglePin(app.id)}
        >
          <Star size={16} fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  return (
    <>
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
          <div>
            <h1>{getGreeting()}, {user?.full_name ?? user?.name ?? 'User'}</h1>
            <p>
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          {user?.job_title && (
            <span className="hm-role-pill">
              <User size={14} aria-hidden="true" />
              {user.job_title}
            </span>
          )}
        </div>

        {recentApps.length > 0 && (
          <section>
            <h2 className="hm-group-title">Recently opened</h2>
            <div className="hm-recent">
              {recentApps.map(({ app, ts }) => (
                <button
                  key={app.id}
                  type="button"
                  className={`hm-recent-item ${app.class}`}
                  onClick={() => handleAppClick(app.id)}
                >
                  <span className="hm-recent-icon">{app.icon}</span>
                  <span className="hm-recent-name">{app.name}</span>
                  <span className="hm-recent-time">{timeAgo(ts)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="hm-chips">
          {[{ key: 'all', label: 'All' }, ...groups].map(c => (
            <button
              key={c.key}
              type="button"
              className={`hm-chip ${category === c.key ? 'is-active' : ''}`}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {!permissionsReady && <SkeletonCards />}

        {permissionsReady && !hasAnyAccess && (
          <div className="hm-empty-card">
            <h3>No modules yet</h3>
            <p>Your account doesn't have access to any modules. Ask your administrator to grant access.</p>
          </div>
        )}

        {permissionsReady && hasAnyAccess && apps.length === 0 && (
          <p className="hm-empty">No modules match your filter.</p>
        )}

        {showHint && (
          <div className="hm-hint">
            <Star size={16} aria-hidden="true" />
            <span>Star a module to pin it here. The modules you open show up in a quick-access row.</span>
          </div>
        )}

        {permissionsReady && pinnedApps.length > 0 && (
          <section>
            <h2 className="hm-group-title">Pinned</h2>
            <div className="hm-app-grid">
              {pinnedApps.map(renderCard)}
            </div>
          </section>
        )}

        {permissionsReady && visibleGroups.map(g => (
          <section key={g.key}>
            <h2 className="hm-group-title">{g.label}</h2>
            <div className="hm-app-grid">
              {g.apps.map(renderCard)}
            </div>
          </section>
        ))}
      </main>
    </>
  );
};

export default Home;