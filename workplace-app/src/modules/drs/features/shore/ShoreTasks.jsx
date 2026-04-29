import React, { useState, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';

import { useAuth } from '@/context/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { defectApi } from '@drs/services/defectApi';
import { DEFECT_SOURCE_OPTIONS } from '../../components/shared/constants';
import "../../components/shared/live-feed.css"

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
      className="tooltip-wrapper"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="tooltip-bubble">
          {text}
          <div className="tooltip-arrow" />
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
    <span ref={ref} className="desc-tooltip-trigger"
      onMouseEnter={handleMouseEnter} onMouseLeave={() => setShow(false)}>
      {children}
      {show && ReactDOM.createPortal(
        <div
          className={`desc-tooltip-portal ${pos.below ? 'is-below' : 'is-above'}`}
          style={{
            top: pos.below ? pos.top : undefined,
            bottom: pos.below ? undefined : `calc(100vh - ${pos.top}px)`,
            left: pos.left,
          }}>
          {text}
          <div className="desc-tooltip-arrow" />
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
    <div ref={ref} className="custom-select-container">
      <button onClick={() => setOpen(!open)} className={`select-trigger ${value ? 'has-value' : ''}`}>
        <span className="select-label">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`select-chevron ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <div className="select-dropdown">
          <div onClick={() => { onChange(''); setOpen(false); }}
            className="select-reset-option">
            {placeholder}
          </div>
          {options.map(opt => (
            <div key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`select-item ${value === opt.value ? 'is-selected' : ''}`}>
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
    <div className="live-feed-page">

      {/* ── Header ── */}
      <div className="feed-header">
        <div className="header-top-row">
          <div className="nav-group">
            {/* FIX 4: clearFilters() on every tab switch */}
            <div className="tab-container">
              <button
                onClick={() => { setActiveTab('live'); setViewMode('all'); clearFilters(); }}
                className={`tab-btn ${activeTab === 'live' ? 'active' : ''}`}
              >
                Live Feed
              </button>
              <button
                onClick={() => { setActiveTab('mine'); setViewMode('all'); clearFilters(); }}
                className={`tab-btn ${activeTab === 'mine' ? 'active' : ''}`}
              >
                <AtSign size={13} />
                My Feed
                {myMentionUnreadCount > 0 && (
                  <span className="tab-badge">
                    {myMentionUnreadCount}
                  </span>
                )}
              </button>
            </div>

            {/* FIX 5: "X of Y" uses correct base count per tab */}
            <p className="feed-summary-text">
              {displayItems.length} {activeTab === 'live' ? 'event' : 'mention'}{displayItems.length !== 1 ? 's' : ''}
              {hasFilters && (
                <span className="filter-context">
                  {' '}of {activeTab === 'live'
                    ? feedItems.filter(i => i.event_type !== 'MENTION').length
                    : myMentions.length}
                </span>
              )}
              {isFetching && <span className="refreshing-indicator">Refreshing…</span>}
            </p>
          </div>

          <div className="view-mode-container">
            <div className="view-mode-switcher">
              {[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, { key: 'read', label: 'Read' }].map(opt => (
                <button key={opt.key} onClick={() => setViewMode(opt.key)} className={`view-mode-btn ${viewMode === opt.key ? 'is-active' : ''}`}>
                  {opt.label}
                  {opt.key === 'unread' && unreadCount > 0 && (
                    <span className={`unread-pill ${activeTab === 'mine' ? 'bg-blue' : 'bg-red'}`}>
                      {unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <button onClick={() => refetch()} className="refresh-btn">
              <RefreshCw size={14} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
          </div>
        </div>

        {/* ── Filter Bar ── */}
        <div className="filter-toolbar">
          <Select value={vesselFilter} onChange={setVesselFilter} options={vesselOptions} placeholder="All Vessels" />
          <Select value={priorityFilter} onChange={setPriorityFilter} options={priorityOptions} placeholder="All Priorities" />
          <Select value={sourceFilter} onChange={setSourceFilter} options={sourceOptions} placeholder="All Sources" />

          <div className="date-picker-group">

            <span className="date-label">From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="date-input" />
            <span className="date-label">To</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="date-input" />
          </div>

          <div className="search-field-wrapper">
            <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment, description…"
              className="search-input" />
          </div>

          {hasFilters && (
            <button onClick={clearFilters} className="clear-filters-btn">
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Feed List ── */}
      <div className="feed-scroll-area">
        {isLoading ? (
          <div className="feed-status-container">
            <span className="loading-text">Loading feed…</span>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="feed-status-container empty">
            {activeTab === 'mine' ? <AtSign size={36} color="#cbd5e1" /> : <Anchor size={36} color="#cbd5e1" />}
            <p className="feed-empty-text">
              {activeTab === 'mine'
                ? hasFilters ? 'No mentions match your filters' : 'No mentions yet'
                : hasFilters ? 'No events match your filters' : 'No feed events found'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="feed-empty-clear-btn">
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
  <div className="section-divider" style={{ "--divider-color": color }}>
    <div className="divider-line" />
    <span className="divider-label">
      {label}
    </span>
    <div className="divider-line" />
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
    <div className={`feed-row ${item.is_read ? 'is-read' : 'is-unread'}`}
      style={{
        "--row-accent": accentColor,
        "--row-bg": accentBg,
        "--row-border": accentBorder
      }}>
      <div className="feed-row-icon-box">
        <AlertTriangle size={18} color={accentColor} />
      </div>
      <div className="feed-row-content">
        <div className="feed-row-top">
          <span className="vessel-tag">
            <Anchor size={11} color="#94a3b8" />{item.vessel_name || '—'}
          </span>
          {desc && (hasFullDesc ? (
            <DescTooltip text={desc}>
              <span className="desc-text has-tooltip">{shortDesc}</span>
            </DescTooltip>
          ) : (
            <span className="desc-text">{shortDesc}</span>
          ))}
          {item.defect?.equipment_name && (
            <>
              <span className="separator">–</span>
              <span className="equipment-tag">{item.defect.equipment_name}</span>
            </>
          )}
          {item.defect?.defect_source && (
            <span className="source-tag">{"(" + item.defect.defect_source + ")"}</span>
          )}
        </div>
        <div className="feed-row-bottom">
          <span className="message-text">
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
              <div className="remark-group">
                <span className="vertical-divider">|</span>
                {/* <Wrench size={11} color="#10b981" style={{ flexShrink: 0 }} /> */}
                {/* <span style={{ fontSize: '11px', fontWeight: '700', color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.4px', flexShrink: 0 }}>
                  Work Done:
                </span> */}
                {isLong ? (
                  <DescTooltip text={remark}>
                    <span className="remark-text has-tooltip">
                      {shortRemark}
                    </span>
                  </DescTooltip>
                ) : (
                  <span className="remark-text">{remark}</span>
                )}
              </div>
            );
          })()}
        </div>
      </div>
      <div className="feed-row-actions">
        <span className="timestamp">{formatDateTime(item.created_at)}</span>
        <div className="btn-group">
          {item.defect_id && (
            <Tooltip text="View Defect">
              <button onClick={() => onView(item.defect_id)} className="action-btn view-btn">
                <Eye size={14} />
              </button>
            </Tooltip>
          )}
          {!item.is_read && (
            <Tooltip text="Mark as Done">
              <button onClick={() => onMarkDone(item.id)} disabled={isPending} className="action-btn done-btn">
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
    <div className={`feed-row mention-row ${item.is_read ? 'is-read' : 'is-unread'}`}
      style={{
        "--row-accent": accentColor,
        "--row-bg": accentBg,
        "--row-border": accentBorder
      }}>
      {/* Icon Box - Exact same as FeedRow */}
      <div className="feed-row-icon-box">
        <AtSign size={18} color={accentColor} />
      </div>

      <div className="feed-row-content">
        {/* Top Line: Vessel, Description (if any), and Equipment (from DB title) */}
        <div className="feed-row-top">
          <span className="vessel-tag">
            <Anchor size={11} color="#94a3b8" />{item.vessel_name || '—'}
          </span>

          {desc && (hasFullDesc ? (
            <DescTooltip text={desc}>
              <span className="desc-text has-tooltip">{shortDesc}</span>
            </DescTooltip>
          ) : (
            <span className="desc-text">{shortDesc}</span>
          ))}

          {displayEquipment && (
            <>
              <span className="separator">–</span>
              <span className="equipment-tag">
                {displayEquipment}
              </span>
            </>
          )}

          {item.defect?.defect_source && (
            <span className="source-tag">{"(" + item.defect.defect_source + ")"}</span>
          )}

          {isInternal && (
            <span className="internal-badge">
              <Lock size={9} /> INTERNAL
            </span>
          )}
        </div>

        {/* Message Line: Shows "Capt.sujil mentioned you: @Sujil hi sujil" */}
        <div className="feed-row-bottom">
          <span className="message-text">{item.message}</span>
        </div>
      </div>

      {/* Date and Buttons - Exact same as FeedRow */}
      <div className="feed-row-actions">
        <span className="timestamp">
          {formatDateTime(item.created_at)}
        </span>
        <div className="btn-group">
          {item.defect_id && (
            <Tooltip text="View Defect">
              <button onClick={() => onView(item.defect_id, item.meta?.is_internal)} className="action-btn view-btn">
                <Eye size={14} />
              </button>
            </Tooltip>
          )}
          {!item.is_read && (
            <Tooltip text="Mark as Done">
              <button onClick={() => onMarkDone(item.id)} disabled={isPending} className="action-btn done-btn">
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