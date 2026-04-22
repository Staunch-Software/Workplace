import React, { useState, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';

import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { defectApi } from '@drs/services/defectApi';
import { DEFECT_SOURCE_OPTIONS } from '../../components/shared/constants';

import {
  AlertCircle, AlertTriangle, Info, Zap,
  Eye, CheckCircle, Search, Filter,
  Anchor, Wrench, Image, GitPullRequest,
  Lock, Unlock, ChevronDown, X, RefreshCw, AtSign
} from 'lucide-react';

// ── Event type config ──────────────────────────────────────────────────────
const EVENT_CONFIG = {
  DEFECT_OPENED: {
    icon: AlertCircle,
    color: '#ef4444',
    bg: '#fef2f2',
    border: '#fecaca',
    label: 'Opened',
  },
  DEFECT_CLOSED: {
    icon: CheckCircle,
    color: '#10b981',
    bg: '#f0fdf4',
    border: '#bbf7d0',
    label: 'Closed',
  },
  PRIORITY_CHANGED: {
    icon: Zap,
    color: '#f59e0b',
    bg: '#fffbeb',
    border: '#fde68a',
    label: 'Priority',
  },
  IMAGE_UPLOADED: {
    icon: Image,
    color: '#6366f1',
    bg: '#eef2ff',
    border: '#c7d2fe',
    label: 'Image',
  },
  PIC_MADE_MANDATORY: {
    icon: Lock,
    color: '#0ea5e9',
    bg: '#f0f9ff',
    border: '#bae6fd',
    label: 'Mandatory',
  },
  PIC_MADE_OPTIONAL: {
    icon: Unlock,
    color: '#64748b',
    bg: '#f8fafc',
    border: '#e2e8f0',
    label: 'Optional',
  },
  PR_ADDED: {
    icon: GitPullRequest,
    color: '#8b5cf6',
    bg: '#f5f3ff',
    border: '#ddd6fe',
    label: 'PR Added',
  },
  MENTION: {
    icon: AtSign,
    color: '#3b82f6',
    bg: '#eff6ff',
    border: '#bfdbfe',
    label: 'Mention',
  },
};

// Priority colors
const PRIORITY_ICON_CONFIG = {
  CRITICAL: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  HIGH: { color: '#f97316', bg: '#fff7ed', border: '#fed7aa' },
  MEDIUM: { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  LOW: { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
};

const PRIORITY_ORDER = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

// ── Tooltip ────────────────────────────────────────────────────────────────
const Tooltip = ({ text, children }) => {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div style={{
          position: 'absolute', bottom: '110%', left: '50%',
          transform: 'translateX(-50%)', background: '#1e293b', color: '#f8fafc',
          padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
          whiteSpace: 'nowrap', zIndex: 9999, pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>
          {text}
          <div style={{
            position: 'absolute', top: '100%', left: '50%',
            transform: 'translateX(-50%)', width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid #1e293b',
          }} />
        </div>
      )}
    </span>
  );
};

// ── Description tooltip ────────────────────────────────────────────────────
const DescTooltip = ({ text, children }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: false });
  const ref = useRef();

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const below = rect.top < 180;
      setPos({ top: below ? rect.bottom + 8 : rect.top - 8, left: rect.left, below });
    }
    setShow(true);
  };

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline' }}
      onMouseEnter={handleMouseEnter} onMouseLeave={() => setShow(false)}>
      {children}
      {show && ReactDOM.createPortal(
        <div style={{
          position: 'fixed',
          top: pos.below ? pos.top : undefined,
          bottom: pos.below ? undefined : `calc(100vh - ${pos.top}px)`,
          left: pos.left, background: '#1e293b', color: '#f8fafc',
          padding: '8px 12px', borderRadius: '8px', fontSize: '12px',
          lineHeight: '1.6', maxWidth: '340px', zIndex: 99999,
          pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word', textTransform: 'uppercase',
        }}>
          {text}
          <div style={{
            position: 'absolute', top: '100%', left: '12px', width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderTop: '5px solid #1e293b',
          }} />
        </div>,
        document.body
      )}
    </span>
  );
};

// ── Select dropdown ────────────────────────────────────────────────────────
// ── Select dropdown ────────────────────────────────────────────────────────
const Select = ({ value, onChange, options, placeholder }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef();

  React.useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: '140px' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '8px 12px', background: 'white',
        border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px',
        color: value ? '#1e293b' : '#94a3b8', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '8px', fontFamily: 'inherit',
      }}>
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} style={{ color: '#94a3b8', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.08)', zIndex: 1000, 
          // --- ADDED SCROLL LOGIC HERE ---
          maxHeight: '280px', 
          overflowY: 'auto',
          // -------------------------------
        }}>
          <div onClick={() => { onChange(''); setOpen(false); }}
            style={{ 
              padding: '9px 12px', fontSize: '13px', color: '#94a3b8', 
              cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
              position: 'sticky', top: 0, background: 'white', zIndex: 1 
            }}>
            {placeholder}
          </div>
          {options.map(opt => (
            <div key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                padding: '9px 12px', fontSize: '13px',
                color: value === opt.value ? '#2563eb' : '#374151',
                background: value === opt.value ? '#eff6ff' : 'transparent',
                cursor: 'pointer', fontWeight: value === opt.value ? '600' : '400',
              }}>
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
// ── Format date ────────────────────────────────────────────────────────────
const formatDateTime = (dt) => {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
};

// ── Shared filter logic ────────────────────────────────────────────────────
const applyCommonFilters = (items, { vesselFilter, priorityFilter, sourceFilter, dateFrom, dateTo, search }) => {
  return items.filter(item => {
    if (vesselFilter && String(item.vessel_imo) !== String(vesselFilter)) return false;
    if (priorityFilter && item.defect?.priority !== priorityFilter) return false;
    if (sourceFilter && item.defect?.defect_source !== sourceFilter) return false;
    if (dateFrom && new Date(item.created_at) < new Date(dateFrom)) return false;
    if (dateTo) {
      const end = new Date(dateTo); end.setHours(23, 59, 59, 999);
      if (new Date(item.created_at) > end) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const matchesLive =
        item.defect?.description?.toLowerCase().includes(q) ||
        item.defect?.equipment_name?.toLowerCase().includes(q);

      const matchesMention =
        item.message?.toLowerCase().includes(q) ||
        item.defect?.description?.toLowerCase().includes(q) ||
        item.defect?.equipment_name?.toLowerCase().includes(q);
      if (!matchesLive && !matchesMention) return false;
    }
    return true;
  });
};

// ── Main Component ─────────────────────────────────────────────────────────
const LiveFeed = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  // FIX 1: Extract to plain variable — user?.id is not valid in deps array
  const userId = user?.id;

  const [activeTab, setActiveTab] = useState('live');
  const [vesselFilter, setVesselFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('all');

  const { data: feedItems = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['live-feed'],
    queryFn: () => defectApi.getLiveFeed(),
    refetchInterval: 15000,
  });

  const { data: vessels = [] } = useQuery({
    queryKey: ['vessels'],
    queryFn: () => defectApi.getVessels(),
  });

  const vesselOptions = useMemo(() => {
    return vessels
      .map(v => ({ value: String(v.imo_number), label: v.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [vessels]);

  const markReadMutation = useMutation({
    mutationFn: defectApi.markFeedRead,
    onSuccess: () => queryClient.invalidateQueries(['live-feed']),
  });

  const sourceOptions = DEFECT_SOURCE_OPTIONS.map(s => ({ value: s, label: s }));

  const priorityOptions = [
    { value: 'CRITICAL', label: 'Critical' },
    { value: 'HIGH', label: 'High' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'LOW', label: 'Low' },
  ];

  const handleView = (defectId, isInternal = false) => {
    const url = isInternal
      ? `/drs/shore/dashboard?highlightDefectId=${defectId}&isInternal=true`
      : `/drs/shore/dashboard?highlightDefectId=${defectId}`;

    window.open(url, '_blank');
  };

  const handleMarkDone = (id) => {
    markReadMutation.mutate(id);
  };

  const clearFilters = () => {
    setVesselFilter('');
    setPriorityFilter('');
    setSourceFilter('');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  };

  const myMentions = useMemo(() => {
    if (!userId) return [];

    return feedItems
      .filter(item => item.event_type === 'MENTION')
      .filter(item => {
        // 1. Parse meta if it's a string
        if (typeof item.meta === 'string') {
          try {
            item.meta = JSON.parse(item.meta);
          } catch (e) {
            console.error("Failed to parse meta for item:", item.id, e);
            return false;
          }
        }

        // 2. Check if user is mentioned
        const ids = item.meta?.mentioned_user_ids || [];
        return ids.includes(String(userId));
      });
  }, [feedItems, userId]);

  const myMentionUnreadCount = myMentions.filter(i => !i.is_read).length;

  const hasFilters = vesselFilter || priorityFilter || sourceFilter || dateFrom || dateTo || search;

  // FIX 3: Both tabs use applyCommonFilters independently
  const liveFeedFiltered = useMemo(() => {
    const base = feedItems.filter(item => item.event_type !== 'MENTION');
    const filtered = applyCommonFilters(base, { vesselFilter, priorityFilter, sourceFilter, dateFrom, dateTo, search });
    return filtered.sort((a, b) => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const dA = new Date(a.created_at), dB = new Date(b.created_at);
      const getGroup = (item, date) => item.is_read ? 3 : date >= today ? 1 : 2;
      const gA = getGroup(a, dA), gB = getGroup(b, dB);
      if (gA !== gB) return gA - gB;
      if (gA === 1) return dB - dA;
      const pA = PRIORITY_ORDER[a.defect?.priority || a.meta?.new_priority] || 99;
      const pB = PRIORITY_ORDER[b.defect?.priority || b.meta?.new_priority] || 99;
      if (pA !== pB) return pA - pB;
      return dB - dA;
    });
  }, [feedItems, vesselFilter, priorityFilter, sourceFilter, search, dateFrom, dateTo]);

  const myFeedFiltered = useMemo(() => {
    return applyCommonFilters(myMentions, { vesselFilter, priorityFilter, sourceFilter, dateFrom, dateTo, search }).sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  }, [myMentions, vesselFilter, priorityFilter, sourceFilter, search, dateFrom, dateTo]);

  const activeList = activeTab === 'live' ? liveFeedFiltered : myFeedFiltered;

  const displayItems = useMemo(() => {
    if (viewMode === 'unread') return activeList.filter(i => !i.is_read);
    if (viewMode === 'read') return activeList.filter(i => i.is_read);
    return activeList;
  }, [activeList, viewMode]);

  const unreadCount = activeList.filter(i => !i.is_read).length;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const grouped = useMemo(() => {
    const todayUnread = displayItems.filter(i => !i.is_read && new Date(i.created_at) >= today);
    const olderUnread = displayItems.filter(i => !i.is_read && new Date(i.created_at) < today);
    const read = displayItems.filter(i => i.is_read);
    return { todayUnread, olderUnread, read };
  }, [displayItems]);

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#f8fafc', fontFamily: "'DM Sans', 'Segoe UI', sans-serif", overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div style={{ padding: '18px 24px 0', background: '#f8fafc', flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            {/* FIX 4: clearFilters() on every tab switch */}
            <div style={{ display: 'flex', gap: '4px', background: '#e2e8f0', borderRadius: '10px', padding: '3px', width: 'fit-content' }}>
              <button
                onClick={() => { setActiveTab('live'); setViewMode('all'); clearFilters(); }}
                style={{
                  padding: '6px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '13px', fontWeight: '700',
                  background: activeTab === 'live' ? 'white' : 'transparent',
                  color: activeTab === 'live' ? '#0f172a' : '#64748b',
                  boxShadow: activeTab === 'live' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                Live Feed
              </button>
              <button
                onClick={() => { setActiveTab('mine'); setViewMode('all'); clearFilters(); }}
                style={{
                  padding: '6px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '13px', fontWeight: '700',
                  background: activeTab === 'mine' ? 'white' : 'transparent',
                  color: activeTab === 'mine' ? '#0f172a' : '#64748b',
                  boxShadow: activeTab === 'mine' ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <AtSign size={13} />
                My Feed
                {myMentionUnreadCount > 0 && (
                  <span style={{
                    background: '#3b82f6', color: 'white', fontSize: '10px',
                    fontWeight: '700', padding: '1px 6px', borderRadius: '10px', lineHeight: '1.4',
                  }}>
                    {myMentionUnreadCount}
                  </span>
                )}
              </button>
            </div>

            {/* FIX 5: "X of Y" uses correct base count per tab */}
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#94a3b8' }}>
              {displayItems.length} {activeTab === 'live' ? 'event' : 'mention'}{displayItems.length !== 1 ? 's' : ''}
              {hasFilters && (
                <span style={{ color: '#94a3b8' }}>
                  {' '}of {activeTab === 'live'
                    ? feedItems.filter(i => i.event_type !== 'MENTION').length
                    : myMentions.length}
                </span>
              )}
              {isFetching && <span style={{ marginLeft: '8px', color: '#60a5fa' }}>Refreshing…</span>}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: '8px', padding: '3px', gap: '2px' }}>
              {[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, { key: 'read', label: 'Read' }].map(opt => (
                <button key={opt.key} onClick={() => setViewMode(opt.key)} style={{
                  padding: '5px 14px', borderRadius: '6px', border: 'none', fontSize: '12px',
                  fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
                  background: viewMode === opt.key ? 'white' : 'transparent',
                  color: viewMode === opt.key ? '#0f172a' : '#64748b',
                  boxShadow: viewMode === opt.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}>
                  {opt.label}
                  {opt.key === 'unread' && unreadCount > 0 && (
                    <span style={{
                      marginLeft: '5px',
                      background: activeTab === 'mine' ? '#3b82f6' : '#ef4444',
                      color: 'white', fontSize: '10px', fontWeight: '700',
                      padding: '1px 5px', borderRadius: '10px',
                    }}>
                      {unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button onClick={() => refetch()} style={{
              background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px',
              padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center',
              gap: '6px', fontSize: '13px', color: '#475569', fontFamily: 'inherit',
            }}>
              <RefreshCw size={14} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Filter Bar ── */}
        <div style={{
          background: 'white', border: '1.5px solid #cbd5e1', borderRadius: '12px',
          padding: '14px 18px', display: 'flex', gap: '10px', alignItems: 'center',
          flexWrap: 'wrap', marginBottom: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        }}>
          <Select value={vesselFilter} onChange={setVesselFilter} options={vesselOptions} placeholder="All Vessels" />
          <Select value={priorityFilter} onChange={setPriorityFilter} options={priorityOptions} placeholder="All Priorities" />
          <Select value={sourceFilter} onChange={setSourceFilter} options={sourceOptions} placeholder="All Sources" />

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#475569', fontFamily: 'inherit', background: '#f8fafc' }} />
            <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', color: '#475569', fontFamily: 'inherit', background: '#f8fafc' }} />
          </div>

          <div style={{ position: 'relative', flex: '1', minWidth: '180px' }}>
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment, description…"
              style={{
                width: '100%', padding: '8px 12px 8px 32px', border: '1px solid #e2e8f0',
                borderRadius: '8px', fontSize: '13px', color: '#1e293b', outline: 'none',
                fontFamily: 'inherit', boxSizing: 'border-box', background: '#f8fafc',
              }} />
          </div>

          {hasFilters && (
            <button onClick={clearFilters} style={{
              background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444',
              borderRadius: '8px', padding: '7px 10px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '12px', fontWeight: '600', fontFamily: 'inherit',
            }}>
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Feed List ── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '0 24px 24px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        minHeight: 0, maxHeight: 'calc(100vh - 250px)',
      }}>
        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#94a3b8', fontSize: '14px' }}>
            Loading feed…
          </div>
        ) : displayItems.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '10px' }}>
            {activeTab === 'mine' ? <AtSign size={36} color="#cbd5e1" /> : <Anchor size={36} color="#cbd5e1" />}
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0 }}>
              {activeTab === 'mine'
                ? hasFilters ? 'No mentions match your filters' : 'No mentions yet'
                : hasFilters ? 'No events match your filters' : 'No feed events found'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} style={{
                background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px',
                padding: '6px 14px', fontSize: '12px', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {grouped.todayUnread.length > 0 && (
              <>
                <SectionDivider label="Today" color="#ef4444" />
                {grouped.todayUnread.map(item => (
                  activeTab === 'live'
                    ? <FeedRow key={item.id} item={item} onView={handleView} onMarkDone={handleMarkDone} isPending={markReadMutation.isPending} />
                    : <MentionRow key={item.id} item={item} onView={handleView} onMarkDone={handleMarkDone} isPending={markReadMutation.isPending} />
                ))}
              </>
            )}
            {grouped.olderUnread.length > 0 && (
              <>
                <SectionDivider label="Earlier" color="#f59e0b" />
                {grouped.olderUnread.map(item => (
                  activeTab === 'live'
                    ? <FeedRow key={item.id} item={item} onView={handleView} onMarkDone={handleMarkDone} isPending={markReadMutation.isPending} />
                    : <MentionRow key={item.id} item={item} onView={handleView} onMarkDone={handleMarkDone} isPending={markReadMutation.isPending} />
                ))}
              </>
            )}
            {grouped.read.length > 0 && (
              <>
                <SectionDivider label="Read" color="#94a3b8" />
                {grouped.read.map(item => (
                  activeTab === 'live'
                    ? <FeedRow key={item.id} item={item} onView={handleView} onMarkDone={handleMarkDone} isPending={markReadMutation.isPending} />
                    : <MentionRow key={item.id} item={item} onView={handleView} onMarkDone={handleMarkDone} isPending={markReadMutation.isPending} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      `}</style>
    </div>
  );
};

// ── Section divider ────────────────────────────────────────────────────────
const SectionDivider = ({ label, color }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '4px 0 2px' }}>
    <div style={{ height: '1px', flex: 1, background: '#e2e8f0' }} />
    <span style={{
      fontSize: '10px', fontWeight: '700', color, letterSpacing: '0.8px', textTransform: 'uppercase',
      background: 'white', padding: '2px 10px', borderRadius: '10px', border: `1px solid ${color}22`, flexShrink: 0,
    }}>
      {label}
    </span>
    <div style={{ height: '1px', flex: 1, background: '#e2e8f0' }} />
  </div>
);

// ── Feed row ───────────────────────────────────────────────────────────────
const FeedRow = ({ item, onView, onMarkDone, isPending }) => {
  const cfg = EVENT_CONFIG[item.event_type] || EVENT_CONFIG.DEFECT_OPENED;
  const priority = item.defect?.priority || item.meta?.new_priority;
  const pIconCfg = PRIORITY_ICON_CONFIG[priority] || null;
  const accentColor = pIconCfg ? pIconCfg.color : cfg.color;
  const accentBg = pIconCfg ? pIconCfg.bg : cfg.bg;
  const accentBorder = pIconCfg ? pIconCfg.border : cfg.border;
  const desc = item.defect?.description || '';
  const meta = typeof item.meta === 'string' ? (() => { try { return JSON.parse(item.meta); } catch { return {}; } })() : (item.meta || {});
  const shortDesc = desc.length > 50 ? desc.slice(0, 50) + '…' : desc;
  const hasFullDesc = desc.length > 50;

  return (
    <div style={{
      background: item.is_read ? 'white' : accentBg,
      border: `1px solid ${item.is_read ? '#e2e8f0' : accentBorder}`,
      borderLeft: `3px solid ${item.is_read ? '#e2e8f0' : accentColor}`,
      borderRadius: '10px', padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: '12px',
      boxShadow: item.is_read ? 'none' : `0 1px 4px ${accentColor}18`,
      opacity: item.is_read ? 0.72 : 1, transition: 'all 0.2s ease',
    }}>
      <div style={{ width: '36px', height: '36px', borderRadius: '9px', background: accentBg, border: `1px solid ${accentBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <AlertTriangle size={18} color={accentColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13.5px', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <Anchor size={11} color="#94a3b8" />{item.vessel_name || '—'}
          </span>
          {desc && (hasFullDesc ? (
            <DescTooltip text={desc}>
              <span style={{ fontSize: '13.5px', fontWeight: '500', color: '#1e293b', cursor: 'default', textTransform: 'uppercase', borderBottom: '1px dashed #cbd5e1', paddingBottom: '1px' }}>{shortDesc}</span>
            </DescTooltip>
          ) : (
            <span style={{ fontSize: '13.5px', fontWeight: '500', color: '#1e293b', textTransform: 'uppercase' }}>{shortDesc}</span>
          ))}
          {item.defect?.equipment_name && (
            <>
              <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 'bolder', margin: '0 2px' }}>–</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0, textTransform: 'uppercase' }}>{item.defect.equipment_name}</span>
            </>
          )}
          {item.defect?.defect_source && (
            <span style={{ fontWeight: '600', color: '#1e293b', textTransform: 'uppercase', fontSize: '13px' }}>{"(" + item.defect.defect_source + ")"}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px', color: '#334155', lineHeight: '1.4', fontWeight: '500' }}>
            {item.message}
          </span>

          {item.event_type === 'DEFECT_CLOSED' && (() => {
            const remark = item.defect?.closure_remark
              || item.defect?.closure_remarks
              || meta?.closure_remark
              || '';
            if (!remark) return null;
            const shortRemark = remark.length > 50 ? remark.slice(0, 50) + '…' : remark;
            const isLong = remark.length > 50;

            return (
              <>
                <span style={{ color: '#cbd5e1', fontSize: '13px', fontWeight: '300' }}>|</span>
                {/* <Wrench size={11} color="#10b981" style={{ flexShrink: 0 }} /> */}
                {/* <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>
                  Work Done:
                </span> */}
                {isLong ? (
                  <DescTooltip text={remark}>
                    <span style={{
                      fontSize: '12px', fontWeight: '500', color: '#334155',
                      cursor: 'default', borderBottom: '1px dashed #cbd5e1', paddingBottom: '1px',
                    }}>
                      {shortRemark}
                    </span>
                  </DescTooltip>
                ) : (
                  <span style={{ fontSize: '12px', fontWeight: '500', color: '#334155' }}>{remark}</span>
                )}
              </>
            );
          })()}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
        <span style={{ fontSize: '12px', color: '#5f5f5f', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(item.created_at)}</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          {item.defect_id && (
            <Tooltip text="View Defect">
              <button onClick={() => onView(item.defect_id)} style={{ border: '1px solid #e2e8f0', borderRadius: '7px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', width: "35px", height: "24px" }}>
                <Eye size={14} />
              </button>
            </Tooltip>
          )}
          {!item.is_read && (
            <Tooltip text="Mark as Done">
              <button onClick={() => onMarkDone(item.id)} disabled={isPending} style={{ border: `1px solid ${accentBorder}`, borderRadius: '7px', background: accentBg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentColor, width: "35px", height: "24px" }}>
                <CheckCircle size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Mention row (Mapping to your DB structure & matching FeedRow layout) ──
const MentionRow = ({ item, onView, onMarkDone, isPending }) => {
  // Use Priority from joined defect or default to Blue for Mentions
  const priority = item.defect?.priority;
  const pIconCfg = PRIORITY_ICON_CONFIG[priority] || { color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' };

  const accentColor = pIconCfg.color;
  const accentBg = pIconCfg.bg;
  const accentBorder = pIconCfg.border;

  // Extract equipment from title "Mention - ENERGY MANAGEMENT" -> "ENERGY MANAGEMENT"
  const equipmentFromTitle = item.title?.includes(' - ') ? item.title.split(' - ')[1] : '';
  const displayEquipment = item.defect?.equipment_name || equipmentFromTitle;

  // Description from defect or fallback to the mention title
  const desc = item.defect?.description || "";
  const shortDesc = desc.length > 50 ? desc.slice(0, 50) + '…' : desc;
  const hasFullDesc = desc.length > 50;

  const isInternal = item.meta?.is_internal;

  return (
    <div style={{
      background: item.is_read ? 'white' : accentBg,
      border: `1px solid ${item.is_read ? '#e2e8f0' : accentBorder}`,
      borderLeft: `3px solid ${item.is_read ? '#e2e8f0' : accentColor}`,
      borderRadius: '10px', padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: '12px',
      boxShadow: item.is_read ? 'none' : `0 1px 4px ${accentColor}18`,
      opacity: item.is_read ? 0.72 : 1, transition: 'all 0.2s ease',
    }}>
      {/* Icon Box - Exact same as FeedRow */}
      <div style={{
        width: '36px', height: '36px', borderRadius: '9px',
        background: accentBg, border: `1px solid ${accentBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
      }}>
        <AtSign size={18} color={accentColor} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Top Line: Vessel, Description (if any), and Equipment (from DB title) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13.5px', fontWeight: '700', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            <Anchor size={11} color="#94a3b8" />{item.vessel_name || '—'}
          </span>

          {desc && (hasFullDesc ? (
            <DescTooltip text={desc}>
              <span style={{ fontSize: '13.5px', fontWeight: '500', color: '#1e293b', cursor: 'default', textTransform: 'uppercase', borderBottom: '1px dashed #cbd5e1', paddingBottom: '1px' }}>{shortDesc}</span>
            </DescTooltip>
          ) : (
            <span style={{ fontSize: '13.5px', fontWeight: '500', color: '#1e293b', textTransform: 'uppercase' }}>{shortDesc}</span>
          ))}

          {displayEquipment && (
            <>
              <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 'bolder', margin: '0 2px' }}>–</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0, textTransform: 'uppercase' }}>
                {displayEquipment}
              </span>
            </>
          )}

          {item.defect?.defect_source && (
            <span style={{ fontWeight: '600', color: '#1e293b', textTransform: 'uppercase', fontSize: '13px' }}>{"(" + item.defect.defect_source + ")"}</span>
          )}

          {isInternal && (
            <span style={{ fontSize: '9px', fontWeight: '700', background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '3px', marginLeft: '4px' }}>
              <Lock size={9} /> INTERNAL
            </span>
          )}
        </div>

        {/* Message Line: Shows "Capt.sujil mentioned you: @Sujil hi sujil" */}
        <span style={{ fontSize: '12px', color: '#334155', lineHeight: '1.4', fontWeight: '500' }}>
          {item.message}
        </span>
      </div>

      {/* Date and Buttons - Exact same as FeedRow */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px', flexShrink: 0 }}>
        <span style={{ fontSize: '12px', color: '#5f5f5f', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {formatDateTime(item.created_at)}
        </span>
        <div style={{ display: 'flex', gap: '6px' }}>
          {item.defect_id && (
            <Tooltip text="View Defect">
              <button onClick={() => onView(item.defect_id, item.meta?.is_internal)} style={{ border: '1px solid #e2e8f0', borderRadius: '7px', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', width: "35px", height: "24px" }}>
                <Eye size={14} />
              </button>
            </Tooltip>
          )}
          {!item.is_read && (
            <Tooltip text="Mark as Done">
              <button onClick={() => onMarkDone(item.id)} disabled={isPending} style={{ border: `1px solid ${accentBorder}`, borderRadius: '7px', background: accentBg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: accentColor, width: "35px", height: "24px" }}>
                <CheckCircle size={14} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveFeed;