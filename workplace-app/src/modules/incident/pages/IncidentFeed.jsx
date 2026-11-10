import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Anchor, AtSign, CheckCheck, CheckCircle, FilePlus2, Image as ImageIcon, Mail, MailOpen, MessageSquare,
  RefreshCw, Search, Unlock, X,
} from 'lucide-react';
import api, { errText } from '../api/axiosIncident';
import FeedSelect from '../components/FeedSelect';
import IncidentModal from '../components/IncidentModal';
import { dayOf, fmtDateTime } from '../utils/format';

const POLL_MS = 15000;

// Colours per event, in the same way the DRS feed colours its rows (accent bar, icon box and unread tint).
const EVENTS = {
  INCIDENT_CREATED: { icon: FilePlus2, color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe', label: 'New incident' },
  MESSAGE: { icon: MessageSquare, color: '#6366f1', bg: '#eef2ff', border: '#c7d2fe', label: 'Message' },
  MENTION: { icon: AtSign, color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe', label: 'Mention' },
  CLOSED: { icon: CheckCircle, color: '#10b981', bg: '#f0fdf4', border: '#bbf7d0', label: 'Closed' },
  REOPENED: { icon: Unlock, color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', label: 'Reopened' },
  FILES_ADDED: { icon: ImageIcon, color: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd', label: 'Evidence added' },
};

const typeOptions = Object.entries(EVENTS)
  .filter(([k]) => k !== 'MENTION')
  .map(([value, e]) => ({ value, label: e.label }));

const clip = (text, n = 50) => (text && text.length > n ? `${text.slice(0, n)}…` : text || '');

// Mentions of the caller are "My Feed"; everything else that happened on incidents is the "Live Feed".
const isMine = (i) => i.event_type === 'MENTION' && i.mentioned_me;

const applyFilters = (items, f) => items.filter((i) => {
  if (f.vessel && i.vessel_imo !== f.vessel) return false;
  if (f.category && i.category !== f.category) return false;
  if (f.type && i.event_type !== f.type) return false;
  if (f.from && dayOf(i.created_at) < f.from) return false;
  if (f.to && dayOf(i.created_at) > f.to) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = `${i.incident_no} ${i.vessel_name} ${i.description} ${i.category} ${i.message} ${i.title} ${i.actor_name}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
});

const EMPTY = { vessel: '', category: '', type: '', from: '', to: '', search: '' };

// Activity of every incident, laid out like the DRS feed: My Feed (your @mentions) and Live Feed (everything else),
// an All / Unread / Read switch, filters, and Today / Earlier / Read sections. A row opens the incident as a popup.
export default function IncidentFeed({ me }) {
  const [items, setItems] = useState([]);
  const [vessels, setVessels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tab, setTab] = useState('mine');
  const [view, setView] = useState('unread');
  const [filters, setFilters] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);       // { ids: [incident ids at the moment it opened], id }

  const load = useCallback(async () => {
    setFetching(true);
    try {
      const r = await api.get('/api/feed');
      setItems(r.data.data.items || []);
      setError('');
    } catch (e) {
      setError(errText(e, 'Could not load the feed'));
    } finally {
      setLoading(false);
      setFetching(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    api.get('/api/vessels').then((r) => setVessels(r.data.data || [])).catch(() => {});
    api.get('/api/categories').then((r) => setCategories(r.data.data || [])).catch(() => {});
  }, []);

  const vesselOptions = useMemo(
    () => vessels.map((v) => ({ value: v.imo, label: v.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [vessels],
  );
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c, label: c })), [categories]);

  const setFilter = (k) => (v) => setFilters((f) => ({ ...f, [k]: typeof v === 'string' ? v : v.target.value }));
  const clearFilters = () => setFilters(EMPTY);
  const hasFilters = Object.values(filters).some(Boolean);
  const switchTab = (t) => { setTab(t); setView('unread'); clearFilters(); };

  const mine = useMemo(() => items.filter(isMine), [items]);
  const live = useMemo(() => items.filter((i) => !isMine(i)), [items]);
  const mineUnread = mine.filter((i) => !i.is_read).length;

  // Live Feed order, as in DRS: today first, then older unread, then read; newest first inside each.
  const todayKey = dayOf(new Date().toISOString());
  const activeList = useMemo(() => {
    const base = applyFilters(tab === 'live' ? live : mine, filters);
    const group = (i) => (dayOf(i.created_at) === todayKey ? 1 : i.is_read ? 3 : 2);
    return [...base].sort((a, b) => group(a) - group(b) || new Date(b.created_at) - new Date(a.created_at));
  }, [tab, live, mine, filters, todayKey]);

  const displayItems = useMemo(() => {
    if (view === 'unread') return activeList.filter((i) => !i.is_read);
    if (view === 'read') return activeList.filter((i) => i.is_read);
    return activeList;
  }, [activeList, view]);

  const unreadCount = activeList.filter((i) => !i.is_read).length;
  const sections = useMemo(() => ({
    today: displayItems.filter((i) => dayOf(i.created_at) === todayKey),
    earlier: displayItems.filter((i) => !i.is_read && dayOf(i.created_at) !== todayKey),
    read: displayItems.filter((i) => i.is_read && dayOf(i.created_at) !== todayKey),
  }), [displayItems, todayKey]);

  const setRead = async (item, read) => {
    setItems((all) => all.map((x) => (x.id === item.id ? { ...x, is_read: read } : x)));
    try { await api.post(`/api/feed/${item.id}/${read ? 'read' : 'unread'}`); } catch (e) {
      setError(errText(e, 'Could not update the item'));
      load();
    }
  };

  const markAll = async () => {
    setMarking(true);
    try { await api.post('/api/feed/read-all'); await load(); } catch (e) {
      setError(errText(e, 'Could not mark everything as read'));
    } finally { setMarking(false); }
  };

  // The popup steps through the incidents in the list as it was when it opened, so marking the row read (which drops
  // it from the Unread view) cannot shift what the arrows point at.
  const openItem = (item) => {
    if (!item.is_read) setRead(item, true);
    const ids = [...new Set(displayItems.map((i) => i.incident_id))];
    setModal({ ids, id: item.incident_id });
  };

  // Plain render functions (not nested components), so a refresh does not remount every row.
  const renderRow = (item) => {
    const ev = EVENTS[item.event_type] || EVENTS.MESSAGE;
    const Icon = ev.icon;
    const isChat = item.event_type === 'MESSAGE' || item.event_type === 'MENTION';
    const text = isChat
      ? `${item.actor_name}${item.mentioned_me ? ' mentioned you' : ''}: ${item.message}`
      : item.title;
    return (
      <div key={item.id} className={`inc-lf__row ${item.is_read ? 'is-read' : 'is-unread'}`} onClick={() => openItem(item)}
           role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openItem(item); }}
           style={{ '--row-accent': ev.color, '--row-bg': ev.bg, '--row-border': ev.border }}>
        <div className="inc-lf__icon"><Icon size={18} color={ev.color} /></div>
        <div className="inc-lf__content">
          <div className="inc-lf__top">
            <span className="inc-lf__vessel"><Anchor size={11} color="#94a3b8" />{item.vessel_name || '—'}</span>
            <span className="inc-lf__no">{item.incident_no}</span>
            {item.description && <span className="inc-lf__desc" title={item.description}>{clip(item.description)}</span>}
            {item.category && (<><span className="inc-lf__sep">–</span><span className="inc-lf__tag">{item.category}</span></>)}
            <span className="inc-lf__tag">{`(${item.incident_status === 'DRAFT' ? 'Draft' : 'Closed'})`}</span>
          </div>
          <div className="inc-lf__bottom"><span className="inc-lf__msg">{text}</span></div>
        </div>
        <div className="inc-lf__actions">
          <span className="inc-lf__time">{fmtDateTime(item.created_at)}</span>
          {!item.own && (
            <button type="button" className="inc-lf__toggle" title={item.is_read ? 'Mark as unread' : 'Mark as read'}
                    aria-label={item.is_read ? 'Mark as unread' : 'Mark as read'}
                    onClick={(e) => { e.stopPropagation(); setRead(item, !item.is_read); }}>
              {item.is_read ? <Mail size={14} /> : <MailOpen size={14} />}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (label, color, rows) => (rows.length === 0 ? null : (
    <div className="inc-lf__section" key={label}>
      <div className="inc-lf__divider" style={{ '--divider-color': color }}>
        <div className="inc-lf__line" /><span className="inc-lf__dlabel">{label}</span><div className="inc-lf__line" />
      </div>
      {rows.map(renderRow)}
    </div>
  ));

  const noun = tab === 'live' ? 'event' : 'mention';
  const totalBase = tab === 'live' ? live.length : mine.length;

  return (
    <div className="inc-lf">
      <div className="inc-lf__header">
        <div className="inc-lf__toprow">
          <div className="inc-lf__navgroup">
            <div className="inc-lf__tabs">
              <button type="button" onClick={() => switchTab('mine')} className={`inc-lf__tab${tab === 'mine' ? ' active' : ''}`}>
                <AtSign size={13} /> My Feed
                {mineUnread > 0 && <span className="inc-lf__tabbadge">{mineUnread}</span>}
              </button>
              <button type="button" onClick={() => switchTab('live')} className={`inc-lf__tab${tab === 'live' ? ' active' : ''}`}>Live Feed</button>
            </div>
            <p className="inc-lf__summary">
              {displayItems.length} {noun}{displayItems.length !== 1 ? 's' : ''}
              {hasFilters && <span className="inc-lf__ctx"> of {totalBase}</span>}
              {fetching && <span className="inc-lf__refreshing">Refreshing…</span>}
            </p>
          </div>

          <div className="inc-lf__viewbar">
            <div className="inc-lf__switch">
              {[['all', 'All'], ['unread', 'Unread'], ['read', 'Read']].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setView(k)} className={`inc-lf__switchbtn${view === k ? ' is-active' : ''}`}>
                  {label}
                  {k === 'unread' && unreadCount > 0 && <span className={`inc-lf__pill ${tab === 'mine' ? 'bg-blue' : 'bg-red'}`}>{unreadCount}</span>}
                </button>
              ))}
            </div>
            <button type="button" className="inc-lf__btn" onClick={markAll} disabled={marking || unreadCount === 0}>
              <CheckCheck size={14} /> {marking ? 'Marking…' : 'Mark all as read'}
            </button>
            <button type="button" className="inc-lf__btn" onClick={load}>
              <RefreshCw size={14} className={fetching ? 'inc-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="inc-lf__toolbar">
          <FeedSelect value={filters.vessel} onChange={setFilter('vessel')} options={vesselOptions} placeholder="All Vessels" />
          <FeedSelect value={filters.category} onChange={setFilter('category')} options={categoryOptions} placeholder="All Categories" />
          {tab === 'live' && <FeedSelect value={filters.type} onChange={setFilter('type')} options={typeOptions} placeholder="All Events" />}
          <div className="inc-lf__dates">
            <span className="inc-lf__dlab">From</span>
            <input type="date" value={filters.from} onChange={setFilter('from')} className="inc-lf__date" />
            <span className="inc-lf__dlab">To</span>
            <input type="date" value={filters.to} onChange={setFilter('to')} className="inc-lf__date" />
          </div>
          <div className="inc-lf__search">
            <Search size={14} />
            <input value={filters.search} onChange={setFilter('search')} placeholder="Search incident, vessel, description…" />
          </div>
          {hasFilters && <button type="button" className="inc-lf__clear" onClick={clearFilters}><X size={12} /> Clear</button>}
        </div>
      </div>

      {error && <div className="inc-error inc-lf__error" role="alert">{error}</div>}

      <div className="inc-lf__scroll">
        {loading ? (
          <div className="inc-lf__status"><span>Loading feed…</span></div>
        ) : displayItems.length === 0 ? (
          <div className="inc-lf__status">
            {tab === 'mine' ? <AtSign size={36} color="#cbd5e1" /> : <Anchor size={36} color="#cbd5e1" />}
            <p>{tab === 'mine'
              ? hasFilters ? 'No mentions match your filters' : 'No mentions yet'
              : hasFilters ? 'No events match your filters' : 'No feed events found'}</p>
            {hasFilters && <button type="button" className="inc-lf__emptyclear" onClick={clearFilters}>Clear filters</button>}
          </div>
        ) : (
          <>
            {renderSection('Today', '#ef4444', sections.today)}
            {renderSection('Earlier', '#f59e0b', sections.earlier)}
            {renderSection('Read', '#94a3b8', sections.read)}
          </>
        )}
      </div>

      {modal && (
        <IncidentModal id={modal.id} me={me} siblings={modal.ids}
                       onNavigate={(id) => setModal((m) => ({ ...m, id }))}
                       onClose={() => setModal(null)} onChanged={load} />
      )}
    </div>
  );
}
