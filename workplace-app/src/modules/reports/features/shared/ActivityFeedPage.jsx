import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { reportsApi, vesselReportsApi } from '../../api/reportsApi';
import ReportsNavbar from '../../components/ReportsNavbar';
import { fmtTime, fmtRelativeDateLabel } from '@/utils/dateUtils';
import {
  FileText, AlertTriangle, MessageSquare, CheckCircle,
  RefreshCw, Eye, Search, Anchor, Zap, Clock, Activity
} from 'lucide-react';
import '../../styles/ActivityFeedPageResponsive.css';

/* ─── Event metadata ─────────────────────────────────────────────── */
const EVENT_META = {
  NEW_REPORT:     { label: 'New Report',     color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', icon: FileText },
  // MISSING_REPORT is now treated as Pending (amber) — no red "Missing" in the UI
  MISSING_REPORT: { label: 'Pending',        color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', icon: Clock },
  PENDING_REPORT: { label: 'Pending',        color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', icon: Clock },
  MENTION:        { label: 'Mention',        color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe', icon: MessageSquare },
  VERIFIED:       { label: 'Verified',       color: '#10b981', bg: '#f0fdf4', border: '#a7f3d0', icon: CheckCircle },
};

const DEFAULT_META = { label: 'Event', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', icon: Zap };

function getMeta(type) { return EVENT_META[type] || DEFAULT_META; }

/* ─── Helpers ────────────────────────────────────────────────────── */
function initials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

/* ─── Tiny avatar ────────────────────────────────────────────────── */
const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444'];
function avatarColor(name) {
  let h = 0;
  for (let c of (name || '')) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/* ─── Skeleton row ───────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <div style={{ display:'flex', gap:14, padding:'16px 20px', background:'#fff', borderRadius:12, border:'1px solid #f1f5f9', marginBottom:8 }}>
      <div style={{ width:38, height:38, borderRadius:'50%', background:'#f1f5f9', flexShrink:0 }} className="skel" />
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
        <div style={{ height:12, width:'40%', borderRadius:6, background:'#f1f5f9' }} className="skel" />
        <div style={{ height:14, width:'75%', borderRadius:6, background:'#f1f5f9' }} className="skel" />
      </div>
      <div style={{ width:40, height:12, borderRadius:6, background:'#f1f5f9', alignSelf:'center' }} className="skel" />
    </div>
  );
}

/* ─── Stat chip ──────────────────────────────────────────────────── */
function StatChip({ icon: Icon, label, value, color }) {
  const bg = color + '18';
  return (
    <div className="afp-stat-chip" style={{ background: bg, border: `1px solid ${color}30` }}>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={16} color={color} />
      </div>
      <div>
        <div className="afp-stat-num">{value}</div>
        <div className="afp-stat-label">{label}</div>
      </div>
    </div>
  );
}

/* ─── Type pill filter ───────────────────────────────────────────── */
function TypePill({ type, active, count, onClick }) {
  const m = getMeta(type);
  return (
    <button
      onClick={onClick}
      className={`afp-pill ${active ? 'active' : ''}`}
      style={{
        border: active ? `1.5px solid ${m.color}` : '1.5px solid #e2e8f0',
        background: active ? m.bg : '#fff',
        color: active ? m.color : '#64748b',
        fontWeight: active ? 700 : 500,
      }}
    >
      <m.icon size={13} />
      {m.label}
      <span className="afp-pill-count" style={{ background: active ? `${m.color}20` : '#f1f5f9', color: active ? m.color : '#94a3b8' }}>
        {count}
      </span>
    </button>
  );
}

/* ─── Main ───────────────────────────────────────────────────────── */
export default function ActivityFeedPage() {
  const { user }   = useAuth();
  const [filterVessel, setFilterVessel] = useState('All');
  const [filterType,   setFilterType]   = useState('All');
  const [search,       setSearch]       = useState('');
  const [hoveredId,    setHoveredId]    = useState(null);

  const isVessel = user?.role === 'VESSEL';
  const api      = isVessel ? vesselReportsApi : reportsApi;

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['report-feed', isVessel],
    queryFn: () => api.getFeed({ days: 30 }),
    refetchInterval: 30000,
  });

  const events = Array.isArray(data) ? data : [];

  /* ── Assigned vessel IMO set for Shore users ── */
  const assignedImos = useMemo(() => {
    if (user?.role === 'ADMIN' || user?.role === 'SUPERUSER') return null;
    const list = Array.isArray(user?.assigned_vessels) ? user.assigned_vessels : [];
    if (list.length === 0) return new Set();
    return new Set(list.map(v => (typeof v === 'string' ? v : v?.imo)).filter(Boolean));
  }, [user]);

  /* ── Filter raw events to only assigned vessels (Shore users) ── */
  const assignedEvents = useMemo(() => {
    if (!assignedImos) return events; // ADMIN/SUPERUSER see all
    return events.filter(e => {
      const imo = String(e.vessel_imo || '');
      return imo && assignedImos.has(imo);
    });
  }, [events, assignedImos]);

  /* ── Counts per type ── */
  const typeCounts = useMemo(() => {
    const m = {};
    assignedEvents.forEach(e => { m[e.event_type] = (m[e.event_type] || 0) + 1; });
    return m;
  }, [assignedEvents]);

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:   assignedEvents.length,
    pending: (typeCounts['MISSING_REPORT'] || 0) + (typeCounts['PENDING_REPORT'] || 0),
    mention: (typeCounts['MENTION'] || 0),
  }), [assignedEvents, typeCounts]);

  /* ── Filtered & grouped ── */
  const filteredEvents = useMemo(() => assignedEvents.filter(e => {
    if (filterVessel !== 'All' && e.vessel_name !== filterVessel) return false;
    if (filterType   !== 'All' && e.event_type   !== filterType)   return false;
    if (search) {
      const lo = search.toLowerCase();
      if (!e.description?.toLowerCase().includes(lo) && !e.vessel_name?.toLowerCase().includes(lo)) return false;
    }
    return true;
  }), [assignedEvents, filterVessel, filterType, search]);

  const groupedEvents = useMemo(() => {
    const groups = {};
    filteredEvents.forEach(e => {
      const label = fmtRelativeDateLabel(e.created_at);
      if (!groups[label]) groups[label] = [];
      groups[label].push(e);
    });
    return groups;
  }, [filteredEvents]);

  const uniqueVessels  = useMemo(() => [...new Set(assignedEvents.map(e => e.vessel_name))], [assignedEvents]);
  const uniqueTypes    = useMemo(() => [...new Set(assignedEvents.map(e => e.event_type))],   [assignedEvents]);

  const openReport = (id) => {
    if (!id) return;
    const url = isVessel ? `/reports/vessel?open=${id}` : `/reports/shore?open=${id}`;
    // Same-origin internal link -- deliberately no 'noopener'/'noreferrer'
    // here, since severing the opener also stops the browser from carrying
    // sessionStorage (where the auth token lives) into the new tab, which
    // made the new tab look logged out.
    window.open(url, '_blank');
  };

  return (
    <div className="afp-root">
      <ReportsNavbar totalUnread={0} />

      {/* ── Hero Header ── */}
      <div className="afp-header">
        <div className="afp-header-content">
          <div className="afp-title-wrap">
            <div className="afp-title-icon">
              <Activity size={20} color="#fff" />
            </div>
            <div className="afp-title-text">
              <h1>Activity Feed</h1>
              <p>
                Track all report events across {isVessel ? 'your vessel' : 'all vessels'} — last 30 days
              </p>
            </div>
          </div>

          {/* Stat chips */}
          <div className="afp-stats-row">
            <StatChip icon={Activity}      label="Total Events" value={stats.total}   color="#6366f1" />
            <StatChip icon={Clock}         label="Pending"      value={stats.pending} color="#f59e0b" />
            <StatChip icon={MessageSquare} label="Mentions"     value={stats.mention} color="#8b5cf6" />
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="afp-toolbar">
        {/* Search */}
        <div className="afp-search-wrap">
          <Search size={15} color="#94a3b8" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
          <input
            type="text" placeholder="Search activity…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="afp-search-input"
          />
        </div>

        {/* Vessel filter — shore only */}
        {!isVessel && (
          <div className="afp-vessel-wrap">
            <Anchor size={14} color="#94a3b8" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <select
              value={filterVessel} onChange={e => setFilterVessel(e.target.value)}
              className="afp-vessel-select"
            >
              <option value="All">All Vessels</option>
              {uniqueVessels.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        {/* Type pills */}
        <div className="afp-pills-wrap">
          <TypePill type="All" active={filterType === 'All'} count={assignedEvents.length} onClick={() => setFilterType('All')} />
          {uniqueTypes.map(t => (
            <TypePill key={t} type={t} active={filterType === t} count={typeCounts[t] || 0} onClick={() => setFilterType(t)} />
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={() => refetch()}
          className="afp-refresh-btn"
        >
          <RefreshCw size={13} style={{ transition: 'transform 0.4s', transform: isFetching ? 'rotate(360deg)' : 'none' }} />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Feed Content ── */}
      <div className="afp-feed-scroll">
        {/* Loading skeletons */}
        {isLoading && (
          <div>
            {[1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredEvents.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 16 }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={32} color="#cbd5e1" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#334155', marginBottom: 4 }}>No activity yet</div>
              <div style={{ fontSize: '0.88rem', color: '#94a3b8' }}>Events will appear here as reports are created, verified, or mentioned.</div>
            </div>
          </div>
        )}

        {/* Date groups */}
        {!isLoading && Object.entries(groupedEvents).map(([dateLabel, dayEvents]) => (
          <div key={dateLabel} style={{ marginBottom: 28 }}>
            {/* Date divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
              <div style={{
                padding: '4px 14px', borderRadius: 20,
                background: dateLabel === 'Today' ? '#fef3c7' : '#f1f5f9',
                color: dateLabel === 'Today' ? '#d97706' : '#64748b',
                fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap'
              }}>
                {dateLabel.toUpperCase()} · {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
              </div>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            </div>

            {/* Event cards */}
            <div className="afp-cards-list">
              {dayEvents.map(event => {
                const meta    = getMeta(event.event_type);
                const Icon    = meta.icon;
                const isHover = hoveredId === event.id;
                const av      = event.author_name || event.source || '?';

                return (
                  <div
                    key={event.id}
                    className="afp-card"
                    onMouseEnter={() => setHoveredId(event.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={isHover ? { borderColor: `${meta.color}50` } : {}}
                  >
                    {/* Left accent line */}
                    <div className="afp-card-accent" style={{ background: meta.color }} />

                    {/* Type icon badge */}
                    <div className="afp-card-icon" style={{ background: meta.bg, border: `1.5px solid ${meta.border}` }}>
                      <Icon size={17} color={meta.color} />
                    </div>

                    {/* Content body */}
                    <div className="afp-card-body">
                      <div className="afp-card-badges">
                        {!isVessel && (
                          <span className="afp-vessel-badge">
                            <Anchor size={11} />
                            {event.vessel_name}
                          </span>
                        )}
                        <span className="afp-type-badge" style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>
                          {meta.label}
                        </span>
                      </div>
                      <div className="afp-card-desc">
                        {event.description}
                      </div>
                    </div>

                    {/* Author Meta */}
                    <div className="afp-card-meta">
                      <div className="afp-author-row">
                        <div className="afp-avatar" style={{ background: avatarColor(av) }}>
                          {initials(av)}
                        </div>
                        <span className="afp-author-name">{av}</span>
                      </div>
                      <div className="afp-time">
                        <Clock size={11} />
                        {fmtTime(event.created_at)}
                      </div>
                    </div>

                    {/* View Report Button */}
                    {event.report_id && (
                      <button
                        onClick={() => openReport(event.report_id)}
                        title="View Report"
                        className="afp-view-btn"
                        style={{
                          color: meta.color,
                          borderColor: isHover ? `${meta.color}60` : '#e2e8f0',
                          background: isHover ? meta.bg : '#f8fafc'
                        }}
                      >
                        <Eye size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .skel { animation: shimmer 1.5s infinite linear; }
        @keyframes shimmer {
          0%   { opacity:1; }
          50%  { opacity:0.4; }
          100% { opacity:1; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
      `}</style>
    </div>
  );
}
