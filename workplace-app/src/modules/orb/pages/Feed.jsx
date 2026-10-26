import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AtSign, MessageSquare, CheckCircle2, ClipboardCheck, XCircle, FileText, AlertTriangle, CheckCheck, RefreshCw,
  Search, X, Mail, MailOpen, Anchor, Lock, Inbox, ChevronRight,
} from 'lucide-react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/Layout/Header';
import Dropdown from '../components/shared/Dropdown';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import AlertModal from '../components/alerts/AlertModal';
import api from '../api/axiosOrb';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useOrbBase } from '../hooks/useOrbNavigate';
import './Feed.css';
import { fmtDateDotTime, dateKey, istWall } from '../utils/time';

const POLL_MS = 15000;
const SEVERITIES = ['critical', 'major', 'minor', 'observation'];

// How each kind of event looks. `group` is what the Type filter offers.
const EVENTS = {
  MESSAGE:              { label: 'Message', Icon: MessageSquare, color: '#5c534a', bg: '#F6F0E8', border: '#E6DACB' },
  MENTION:              { label: 'Mention', Icon: AtSign, color: '#A34509', bg: '#FFF1E3', border: '#F8D2B0' },
  RESOLUTION_REQUESTED: { label: 'Resolution request', Icon: ClipboardCheck, color: '#1f5f9a', bg: '#EAF3FC', border: '#C5DBF2' },
  RESOLUTION_REJECTED:  { label: 'Rejected', Icon: XCircle, color: '#B42318', bg: '#FDEEEE', border: '#F1B4AE' },
  RESOLVED:             { label: 'Resolved', Icon: CheckCircle2, color: '#1d7a46', bg: '#EAF7EF', border: '#A7DDBB' },
  UPLOAD:               { label: 'Upload', Icon: FileText, color: '#1f5f9a', bg: '#EAF3FC', border: '#C5DBF2' },
  ALERTS_RAISED:        { label: 'New alerts', Icon: AlertTriangle, color: '#B42318', bg: '#FDEEEE', border: '#F1B4AE' },
};
const SEVERITY_COLOR = {
  critical: { color: '#B42318', bg: '#FDEEEE', border: '#F1B4AE' },
  major: { color: '#A34509', bg: '#FFF1E3', border: '#F8D2B0' },
  minor: { color: '#8A6A00', bg: '#FFF9DD', border: '#F1E3A0' },
  observation: { color: '#4A5560', bg: '#F1F3F5', border: '#D9DFE5' },
};

const fmtWhen = (iso) => (iso ? fmtDateDotTime(iso) : '—');
const pretty = (s) => (s || '').replace(/_/g, ' ');

function applyFilters(items, { vessel, severity, type, from, to, search }) {
  const q = search.trim().toLowerCase();
  return items.filter(i => {
    if (vessel && i.vessel_id !== vessel) return false;
    if (severity && i.severity !== severity) return false;
    if (type && i.event_type !== type) return false;
    // the date filters are IST calendar days
    const day = dateKey(istWall(i.created_at));
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (q && ![i.title, i.message, i.vessel_name, i.alert_type && pretty(i.alert_type), i.actor_name].some(v => (v || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

function Divider({ label, color }) {
  return (
    <div className="fd-divider" style={{ '--fd-div': color }}>
      <span className="fd-divider__line" /><span className="fd-divider__label">{label}</span><span className="fd-divider__line" />
    </div>
  );
}

function FeedRow({ item, onOpen, onToggleRead, mine }) {
  const cfg = EVENTS[item.event_type] || EVENTS.MESSAGE;
  const sev = SEVERITY_COLOR[item.severity];
  const accent = sev || cfg;
  const Icon = mine && item.mentioned_me ? AtSign : cfg.Icon;
  return (
    <div className={`fd-row ${item.is_read ? 'is-read' : 'is-unread'}`} onClick={() => onOpen(item)}
         style={{ '--fd-accent': accent.color, '--fd-bg': accent.bg, '--fd-border': accent.border }}>
      <div className="fd-row__icon"><Icon size={18} color={accent.color} /></div>
      <div className="fd-row__body">
        <div className="fd-row__top">
          <span className="fd-vessel"><Anchor size={11} /> {item.vessel_name || '—'}</span>
          {item.alert_type && <span className="fd-type">{pretty(item.alert_type)}</span>}
          {item.severity && <span className={`am-sev am-sev--${item.severity} fd-sev`}>{item.severity}</span>}
          {item.shore_only && item.alert_id && <span className="fd-internal"><Lock size={9} /> Internal</span>}
          <span className="fd-kind">{cfg.label}</span>
        </div>
        <div className="fd-row__title">{item.title}</div>
        {item.message && <div className="fd-row__msg">{item.message}</div>}
      </div>
      <div className="fd-row__side">
        <span className="fd-when">{fmtWhen(item.created_at)}</span>
        <div className="fd-row__btns">
          {!item.own && (
            <button type="button" className="fd-icon-btn" title={item.is_read ? 'Mark as unread' : 'Mark as read'}
                    onClick={(e) => { e.stopPropagation(); onToggleRead(item); }}>
              {item.is_read ? <MailOpen size={15} /> : <Mail size={15} />}
            </button>
          )}
          <span className="fd-go" aria-hidden="true"><ChevronRight size={16} /></span>
        </div>
      </div>
    </div>
  );
}

export default function Feed() {
  const navigate = useNavigate();
  const base = useOrbBase();
  const { user, isShore } = useAuth();

  const [data, setData] = useState({ items: [], unread_count: 0 });
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [tab, setTab] = useState('mine');                  // mine = addressed to me, live = everything on my vessels
  const [viewMode, setViewMode] = useState('unread');
  const [filters, setFilters] = useState({ vessel: '', severity: '', type: '', from: '', to: '', search: '' });
  const [marking, setMarking] = useState(false);
  // The alert viewer: ids of the list at the moment it opened (so reading an item does not reshuffle it under you)
  const [viewer, setViewer] = useState(null);              // { ids: [], index, alert }

  const load = useCallback(async (manual = false) => {
    if (manual) setFetching(true);
    try {
      const r = await api.get('/api/feed', { params: { limit: 300 } });
      setData(r.data.data);
      window.dispatchEvent(new Event('orb:feed-changed'));   // the sidebar badge follows at once
    } catch (_) { /* keep what is on screen */ } finally {
      setLoading(false); setFetching(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const clearFilters = () => setFilters({ vessel: '', severity: '', type: '', from: '', to: '', search: '' });
  const hasFilters = Object.values(filters).some(Boolean);

  const vesselOptions = useMemo(() => {
    const seen = new Map();
    data.items.forEach(i => seen.set(i.vessel_id, i.vessel_name));
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [data.items]);

  const mine = useMemo(() => data.items.filter(i => i.for_me), [data.items]);
  const live = useMemo(() => data.items.filter(i => i.event_type !== 'MENTION'), [data.items]);
  const mineUnread = mine.filter(i => !i.is_read).length;

  const activeList = useMemo(() => applyFilters(tab === 'mine' ? mine : live, filters), [tab, mine, live, filters]);
  const unreadCount = activeList.filter(i => !i.is_read).length;
  const displayItems = useMemo(() => {
    if (viewMode === 'unread') return activeList.filter(i => !i.is_read);
    if (viewMode === 'read') return activeList.filter(i => i.is_read);
    return activeList;
  }, [activeList, viewMode]);

  const grouped = useMemo(() => {
    const todayKey = dateKey(istWall());
    const isToday = (i) => dateKey(istWall(i.created_at)) === todayKey;
    return {
      today: displayItems.filter(isToday),
      earlier: displayItems.filter(i => !isToday(i) && !i.is_read),
      read: displayItems.filter(i => !isToday(i) && i.is_read),
    };
  }, [displayItems]);

  const setRead = async (item, read) => {
    setData(d => ({ ...d, items: d.items.map(i => (i.id === item.id ? { ...i, is_read: read } : i)),
                    unread_count: Math.max(0, d.unread_count + (read ? -1 : 1)) }));
    try { await api.post(`/api/feed/${item.id}/${read ? 'read' : 'unread'}`); } catch (_) { /* reloaded below */ }
    load();
  };
  const markAll = async () => {
    setMarking(true);
    try { await api.post('/api/feed/read-all'); } finally { setMarking(false); load(); }
  };

  const openAlertAt = useCallback(async (ids, index) => {
    const item = data.items.find(i => i.id === ids[index]);
    if (!item) return;
    if (!item.is_read && !item.own) setRead(item, true);
    try {
      const r = await api.get(`/api/alerts/${item.alert_id}`);
      setViewer({ ids, index, item, alert: r.data.data });
    } catch (_) { setViewer(null); }
  }, [data.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const onOpen = (item) => {
    if (item.alert_id) {
      const ids = displayItems.filter(i => i.alert_id).map(i => i.id);
      openAlertAt(ids, Math.max(0, ids.indexOf(item.id)));
      return;
    }
    if (!item.is_read && !item.own) setRead(item, true);
    if (item.link) navigate(item.link);
  };

  const step = (delta) => viewer && openAlertAt(viewer.ids, viewer.index + delta);

  const viewerProps = viewer && {
    position: `${viewer.index + 1} / ${viewer.ids.length}`,
    hasPrev: viewer.index > 0, hasNext: viewer.index < viewer.ids.length - 1,
    onPrev: () => step(-1), onNext: () => step(1),
    canMarkUnread: !viewer.item.own,
    onMarkUnread: () => { setRead(viewer.item, false); setViewer(null); },
    onGoToAlert: () => window.open(`${base}/alerts?alert=${viewer.alert.id}`, '_blank'),
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Header title="Feed" />
        <div className="page-body">
          <div className="fd">
            <div className="fd-head">
              <div className="fd-head__row">
                <div className="fd-head__left">
                  <div className="fd-tabs" role="tablist">
                    <button type="button" role="tab" aria-selected={tab === 'mine'} className={`fd-tab${tab === 'mine' ? ' fd-tab--on' : ''}`}
                            onClick={() => { setTab('mine'); setViewMode('unread'); clearFilters(); }}>
                      <AtSign size={13} /> My Feed{mineUnread > 0 && <span className="fd-tab__n">{mineUnread}</span>}
                    </button>
                    <button type="button" role="tab" aria-selected={tab === 'live'} className={`fd-tab${tab === 'live' ? ' fd-tab--on' : ''}`}
                            onClick={() => { setTab('live'); setViewMode('unread'); clearFilters(); }}>
                      Live Feed
                    </button>
                  </div>
                  <p className="fd-summary">
                    {displayItems.length} event{displayItems.length !== 1 ? 's' : ''}
                    {hasFilters && <span className="fd-summary__of"> of {(tab === 'mine' ? mine : live).length}</span>}
                    {fetching && <span className="fd-summary__busy"> Refreshing…</span>}
                  </p>
                </div>
                <div className="fd-head__right">
                  <div className="fd-modes" role="group" aria-label="Show">
                    {[['all', 'All'], ['unread', 'Unread'], ['read', 'Read']].map(([key, label]) => (
                      <button key={key} type="button" className={`fd-mode${viewMode === key ? ' fd-mode--on' : ''}`} onClick={() => setViewMode(key)}>
                        {label}{key === 'unread' && unreadCount > 0 && <span className={`fd-pill ${tab === 'mine' ? 'fd-pill--blue' : 'fd-pill--red'}`}>{unreadCount}</span>}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="fd-btn" onClick={markAll} disabled={marking || data.unread_count === 0}>
                    <CheckCheck size={14} /> {marking ? 'Marking…' : 'Mark all as read'}
                  </button>
                  <button type="button" className="fd-btn" onClick={() => load(true)}>
                    <RefreshCw size={14} className={fetching ? 'fd-spin' : ''} /> Refresh
                  </button>
                </div>
              </div>

              <div className="fd-filters">
                {isShore && vesselOptions.length > 1 && (
                  <div className="fd-filter"><Dropdown value={filters.vessel} onChange={v => setFilter('vessel', v)} options={[{ value: '', label: 'All vessels' }, ...vesselOptions]} /></div>
                )}
                <div className="fd-filter"><Dropdown value={filters.severity} onChange={v => setFilter('severity', v)}
                  options={[{ value: '', label: 'All severities' }, ...SEVERITIES.map(s => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} /></div>
                <div className="fd-filter"><Dropdown value={filters.type} onChange={v => setFilter('type', v)}
                  options={[{ value: '', label: 'All types' }, ...Object.entries(EVENTS).filter(([k]) => isShore || k !== 'UPLOAD').map(([value, c]) => ({ value, label: c.label }))]} /></div>
                <div className="fd-dates">
                  <span>From</span><input type="date" value={filters.from} onChange={e => setFilter('from', e.target.value)} />
                  <span>To</span><input type="date" value={filters.to} onChange={e => setFilter('to', e.target.value)} />
                </div>
                <div className="fd-search">
                  <Search size={14} />
                  <input value={filters.search} onChange={e => setFilter('search', e.target.value)} placeholder="Search vessel, alert, message…" />
                </div>
                {hasFilters && <button type="button" className="fd-clear" onClick={clearFilters}><X size={12} /> Clear</button>}
              </div>
            </div>

            <div className="fd-list">
              {loading ? <LoadingSpinner /> : displayItems.length === 0 ? (
                <div className="fd-empty">
                  {tab === 'mine' ? <AtSign size={34} /> : <Inbox size={34} />}
                  <p>{hasFilters ? 'Nothing matches your filters'
                    : viewMode === 'unread' ? 'You are all caught up'
                    : tab === 'mine' ? 'Nothing addressed to you yet' : 'No activity yet'}</p>
                  {hasFilters && <button type="button" className="fd-btn" onClick={clearFilters}>Clear filters</button>}
                </div>
              ) : (
                <>
                  {grouped.today.length > 0 && <><Divider label="Today" color="#ef4444" />{grouped.today.map(i => <FeedRow key={i.id} item={i} mine={tab === 'mine'} onOpen={onOpen} onToggleRead={(it) => setRead(it, !it.is_read)} />)}</>}
                  {grouped.earlier.length > 0 && <><Divider label="Earlier" color="#f59e0b" />{grouped.earlier.map(i => <FeedRow key={i.id} item={i} mine={tab === 'mine'} onOpen={onOpen} onToggleRead={(it) => setRead(it, !it.is_read)} />)}</>}
                  {grouped.read.length > 0 && <><Divider label="Read" color="#94a3b8" />{grouped.read.map(i => <FeedRow key={i.id} item={i} mine={tab === 'mine'} onOpen={onOpen} onToggleRead={(it) => setRead(it, !it.is_read)} />)}</>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {viewer && (
        <AlertModal
          key={viewer.alert.id}
          alert={viewer.alert}
          vesselName={viewer.item.vessel_name}
          isShore={isShore}
          currentUserId={user?.id}
          viewer={viewerProps}
          onChanged={() => load()}
          onClose={() => { setViewer(null); load(); }}
        />
      )}
    </div>
  );
}
