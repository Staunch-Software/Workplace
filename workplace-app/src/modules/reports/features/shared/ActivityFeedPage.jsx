import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { reportsApi, vesselReportsApi } from '../../api/reportsApi';
import ReportsNavbar from '../../components/ReportsNavbar';
import {
  FileText, AlertTriangle, MessageSquare, CheckCircle,
  RefreshCw, Eye, Search, Anchor, Zap, Clock, Activity
} from 'lucide-react';

/* ─── Event metadata ─────────────────────────────────────────────── */
const EVENT_META = {
  NEW_REPORT:     { label: 'New Report',     color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', icon: FileText },
  MISSING_REPORT: { label: 'Missing',        color: '#ef4444', bg: '#fef2f2', border: '#fecaca', icon: AlertTriangle },
  PENDING_REPORT: { label: 'Pending',        color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', icon: Clock },
  MENTION:        { label: 'Mention',        color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe', icon: MessageSquare },
  VERIFIED:       { label: 'Verified',       color: '#10b981', bg: '#f0fdf4', border: '#a7f3d0', icon: CheckCircle },
};

const DEFAULT_META = { label: 'Event', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', icon: Zap };

function getMeta(type) { return EVENT_META[type] || DEFAULT_META; }

/* ─── Helpers ────────────────────────────────────────────────────── */
function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateLabel(iso) {
  const d   = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
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
    <div style={{ display:'flex', alignItems:'center', gap:10, background:bg, borderRadius:10, padding:'10px 16px', border:`1px solid ${color}30` }}>
      <div style={{ width:32, height:32, borderRadius:8, background:color+'22', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <Icon size={16} color={color} />
      </div>
      <div>
        <div style={{ fontSize:'1.1rem', fontWeight:700, color:'#1e293b', lineHeight:1 }}>{value}</div>
        <div style={{ fontSize:'0.72rem', color:'#64748b', marginTop:2 }}>{label}</div>
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
      style={{
        display:'flex', alignItems:'center', gap:6,
        padding:'6px 14px', borderRadius:20,
        border: active ? `1.5px solid ${m.color}` : '1.5px solid #e2e8f0',
        background: active ? m.bg : '#fff',
        color: active ? m.color : '#64748b',
        fontWeight: active ? 700 : 500, fontSize:'0.82rem',
        cursor:'pointer', transition:'all 0.15s', whiteSpace:'nowrap'
      }}
    >
      <m.icon size={13} />
      {m.label}
      <span style={{ background: active ? `${m.color}20` : '#f1f5f9', color: active ? m.color : '#94a3b8', borderRadius:10, padding:'1px 7px', fontSize:'0.75rem', fontWeight:700 }}>{count}</span>
    </button>
  );
}

/* ─── Main ───────────────────────────────────────────────────────── */
export default function ActivityFeedPage() {
  const navigate   = useNavigate();
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

  /* ── Counts per type ── */
  const typeCounts = useMemo(() => {
    const m = {};
    events.forEach(e => { m[e.event_type] = (m[e.event_type] || 0) + 1; });
    return m;
  }, [events]);

  /* ── Stats ── */
  const stats = useMemo(() => ({
    total:   events.length,
    missing: (typeCounts['MISSING_REPORT'] || 0),
    mention: (typeCounts['MENTION'] || 0),
    verified:(typeCounts['VERIFIED'] || 0),
  }), [events, typeCounts]);

  /* ── Filtered & grouped ── */
  const filteredEvents = useMemo(() => events.filter(e => {
    if (filterVessel !== 'All' && e.vessel_name !== filterVessel) return false;
    if (filterType   !== 'All' && e.event_type   !== filterType)   return false;
    if (search) {
      const lo = search.toLowerCase();
      if (!e.description?.toLowerCase().includes(lo) && !e.vessel_name?.toLowerCase().includes(lo)) return false;
    }
    return true;
  }), [events, filterVessel, filterType, search]);

  const groupedEvents = useMemo(() => {
    const groups = {};
    filteredEvents.forEach(e => {
      const label = fmtDateLabel(e.created_at);
      if (!groups[label]) groups[label] = [];
      groups[label].push(e);
    });
    return groups;
  }, [filteredEvents]);

  const uniqueVessels  = useMemo(() => [...new Set(events.map(e => e.vessel_name))], [events]);
  const uniqueTypes    = useMemo(() => [...new Set(events.map(e => e.event_type))],   [events]);

  const openReport = (id) => {
    if (!id) return;
    navigate(isVessel ? `/reports/vessel?report=${id}` : `/reports/shore?report=${id}`);
  };

  return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', background:'#f0f4f8', fontFamily:"'Inter','Segoe UI',sans-serif" }}>
      <ReportsNavbar totalUnread={0} />

      {/* ── Hero Header ── */}
      <div style={{
        background:'#fff',
        borderBottom:'1px solid #e2e8f0',
        padding:'20px 36px 20px',
        flexShrink:0
      }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:42, height:42, borderRadius:12, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 12px rgba(99,102,241,0.3)' }}>
              <Activity size={20} color="#fff" />
            </div>
            <div>
              <h1 style={{ margin:0, fontSize:'1.2rem', fontWeight:700, color:'#1e293b', letterSpacing:'-0.01em' }}>Activity Feed</h1>
              <p style={{ margin:0, fontSize:'0.8rem', color:'#94a3b8' }}>
                Track all report events across {isVessel ? 'your vessel' : 'all vessels'} — last 30 days
              </p>
            </div>
          </div>

          {/* Stat chips */}
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <StatChip icon={Activity}      label="Total Events" value={stats.total}   color="#6366f1" />
            <StatChip icon={AlertTriangle} label="Missing"      value={stats.missing} color="#ef4444" />
            <StatChip icon={MessageSquare} label="Mentions"     value={stats.mention} color="#8b5cf6" />
            <StatChip icon={CheckCircle}   label="Verified"     value={stats.verified}color="#10b981" />
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ background:'#fff', borderBottom:'1px solid #e2e8f0', padding:'12px 36px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', flexShrink:0 }}>
        {/* Search */}
        <div style={{ position:'relative', flex:1, minWidth:220 }}>
          <Search size={15} color="#94a3b8" style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }} />
          <input
            type="text" placeholder="Search activity…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width:'100%', padding:'9px 14px 9px 36px', borderRadius:9, border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#1e293b', fontSize:'0.88rem', outline:'none', transition:'border-color 0.15s' }}
            onFocus={e => e.target.style.borderColor='#818cf8'}
            onBlur={e  => e.target.style.borderColor='#e2e8f0'}
          />
        </div>

        {/* Vessel filter — shore only */}
        {!isVessel && (
          <div style={{ position:'relative' }}>
            <Anchor size={14} color="#94a3b8" style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }} />
            <select
              value={filterVessel} onChange={e => setFilterVessel(e.target.value)}
              style={{ padding:'9px 14px 9px 30px', borderRadius:9, border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#334155', fontSize:'0.88rem', outline:'none', cursor:'pointer', appearance:'none' }}
            >
              <option value="All">All Vessels</option>
              {uniqueVessels.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}

        {/* Type pills */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          <TypePill type="All" active={filterType==='All'} count={events.length} onClick={() => setFilterType('All')} />
          {uniqueTypes.map(t => (
            <TypePill key={t} type={t} active={filterType===t} count={typeCounts[t]||0} onClick={() => setFilterType(t)} />
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={() => refetch()}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:9, border:'1.5px solid #e2e8f0', background:'#f8fafc', color:'#475569', fontSize:'0.85rem', cursor:'pointer', transition:'all 0.15s', whiteSpace:'nowrap' }}
          onMouseEnter={e => e.currentTarget.style.background='#e0e7ff'}
          onMouseLeave={e => e.currentTarget.style.background='#f8fafc'}
        >
          <RefreshCw size={13} style={{ transition:'transform 0.4s', transform: isFetching ? 'rotate(360deg)' : 'none' }} />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* ── Feed Content ── */}
      <div style={{ flex:1, overflowY:'auto', padding:'28px 36px' }}>

        {/* Loading skeletons */}
        {isLoading && (
          <div>
            {[1,2,3,4,5].map(i => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filteredEvents.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'80px 20px', gap:16 }}>
            <div style={{ width:72, height:72, borderRadius:'50%', background:'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <Activity size={32} color="#cbd5e1" />
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:'1.1rem', fontWeight:600, color:'#334155', marginBottom:4 }}>No activity yet</div>
              <div style={{ fontSize:'0.88rem', color:'#94a3b8' }}>Events will appear here as reports are created, verified, or mentioned.</div>
            </div>
          </div>
        )}

        {/* Date groups */}
        {!isLoading && Object.entries(groupedEvents).map(([dateLabel, dayEvents]) => (
          <div key={dateLabel} style={{ marginBottom:32 }}>
            {/* Date divider */}
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
              <div style={{ flex:1, height:1, background:'#e2e8f0' }} />
              <div style={{
                padding:'4px 14px', borderRadius:20,
                background: dateLabel==='Today' ? '#fef3c7' : '#f1f5f9',
                color:       dateLabel==='Today' ? '#d97706'  : '#64748b',
                fontSize:'0.75rem', fontWeight:700, letterSpacing:'0.04em', whiteSpace:'nowrap'
              }}>
                {dateLabel.toUpperCase()} · {dayEvents.length} event{dayEvents.length!==1?'s':''}
              </div>
              <div style={{ flex:1, height:1, background:'#e2e8f0' }} />
            </div>

            {/* Event cards */}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {dayEvents.map(event => {
                const meta    = getMeta(event.event_type);
                const Icon    = meta.icon;
                const isHover = hoveredId === event.id;
                const av      = event.author_name || event.source || '?';

                return (
                  <div
                    key={event.id}
                    onMouseEnter={() => setHoveredId(event.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      display:'flex', alignItems:'center', gap:16,
                      background: isHover ? '#fafbff' : '#fff',
                      borderRadius:12,
                      border: isHover ? `1.5px solid ${meta.color}40` : '1.5px solid #f1f5f9',
                      padding:'14px 20px',
                      boxShadow: isHover ? `0 4px 20px rgba(0,0,0,0.06)` : '0 1px 3px rgba(0,0,0,0.03)',
                      transition:'all 0.15s',
                      cursor:'default'
                    }}
                  >
                    {/* Left accent line */}
                    <div style={{ width:3, alignSelf:'stretch', borderRadius:3, background:meta.color, flexShrink:0 }} />

                    {/* Type icon badge */}
                    <div style={{ width:40, height:40, borderRadius:10, background:meta.bg, border:`1.5px solid ${meta.border}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Icon size={17} color={meta.color} />
                    </div>

                    {/* Main content */}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                        {/* Vessel pill */}
                        {!isVessel && (
                          <span style={{ display:'flex', alignItems:'center', gap:4, background:'#eff6ff', color:'#2563eb', borderRadius:6, padding:'2px 8px', fontSize:'0.75rem', fontWeight:700 }}>
                            <Anchor size={11} />
                            {event.vessel_name}
                          </span>
                        )}
                        {/* Type badge */}
                        <span style={{ background:meta.bg, color:meta.color, border:`1px solid ${meta.border}`, borderRadius:6, padding:'2px 8px', fontSize:'0.72rem', fontWeight:700, letterSpacing:'0.03em' }}>
                          {meta.label}
                        </span>
                      </div>

                      {/* Description */}
                      <div style={{ fontSize:'0.92rem', color:'#1e293b', fontWeight:500, lineHeight:1.4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {event.description}
                      </div>
                    </div>

                    {/* Author avatar + time */}
                    <div style={{ display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
                      <div style={{ textAlign:'right' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end', marginBottom:3 }}>
                          <div style={{ width:22, height:22, borderRadius:'50%', background:avatarColor(av), display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.65rem', fontWeight:700, color:'#fff' }}>
                            {initials(av)}
                          </div>
                          <span style={{ fontSize:'0.78rem', color:'#475569', fontWeight:500 }}>{av}</span>
                        </div>
                        <div style={{ fontSize:'0.75rem', color:'#94a3b8', display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end' }}>
                          <Clock size={11} />
                          {fmtTime(event.created_at)}
                        </div>
                      </div>

                      {/* View report button */}
                      {event.report_id && (
                        <button
                          onClick={() => openReport(event.report_id)}
                          title="View Report"
                          style={{
                            width:34, height:34, borderRadius:9,
                            border:`1.5px solid ${isHover ? meta.color+'60' : '#e2e8f0'}`,
                            background: isHover ? meta.bg : '#f8fafc',
                            color: meta.color, display:'flex', alignItems:'center', justifyContent:'center',
                            cursor:'pointer', transition:'all 0.15s', flexShrink:0
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background=meta.bg; e.currentTarget.style.transform='scale(1.1)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background= isHover ? meta.bg : '#f8fafc'; e.currentTarget.style.transform='scale(1)'; }}
                        >
                          <Eye size={15} />
                        </button>
                      )}
                    </div>
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
