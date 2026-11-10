import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AtSign, CheckCheck, FilePlus2, Images, Loader2, Lock, MailOpen, Mail, MessageSquare, Rss, Unlock,
} from 'lucide-react';
import api, { errText } from '../api/axiosIncident';
import { ago, announceUnreadChange, dayLabel, dayOf } from '../utils/format';

const POLL_MS = 15000;

const TYPES = {
  INCIDENT_CREATED: { label: 'New incident', Icon: FilePlus2, tone: 'violet' },
  MESSAGE: { label: 'Message', Icon: MessageSquare, tone: 'blue' },
  MENTION: { label: 'Mention', Icon: AtSign, tone: 'amber' },
  CLOSED: { label: 'Closed', Icon: Lock, tone: 'green' },
  REOPENED: { label: 'Reopened', Icon: Unlock, tone: 'red' },
  FILES_ADDED: { label: 'Evidence added', Icon: Images, tone: 'teal' },
};

const SCOPES = [['all', 'All activity'], ['mine', 'My feed'], ['mentions', 'Mentions']];

// Activity of every incident: new incidents, messages and mentions, closed/reopened, evidence added. "My feed" is what
// was addressed to you. Click an item to open the incident; the dot (or the mail icon) marks it read / unread.
export default function IncidentFeed() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [vessels, setVessels] = useState([]);
  const [scope, setScope] = useState('all');
  const [type, setType] = useState('');
  const [vessel, setVessel] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await api.get('/api/feed', { params: vessel ? { vessel_imo: vessel } : {} });
      setItems(r.data.data.items || []);
      setUnread(r.data.data.unread_count || 0);
      setError('');
    } catch (e) {
      setError(errText(e, 'Could not load the feed'));
    } finally {
      setLoading(false);
    }
  }, [vessel]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) load(true); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => { api.get('/api/vessels').then((r) => setVessels(r.data.data || [])).catch(() => {}); }, []);

  const visible = useMemo(() => items.filter((i) => (
    (scope === 'all' || (scope === 'mine' && i.for_me) || (scope === 'mentions' && i.mentioned_me))
    && (!type || i.event_type === type)
    && (!onlyUnread || !i.is_read)
  )), [items, scope, type, onlyUnread]);

  const groups = useMemo(() => {
    const out = [];
    for (const i of visible) {
      const key = dayOf(i.created_at);
      if (!out.length || out[out.length - 1].key !== key) out.push({ key, label: dayLabel(i.created_at), rows: [] });
      out[out.length - 1].rows.push(i);
    }
    return out;
  }, [visible]);

  const mineCount = items.filter((i) => i.for_me && !i.is_read).length;
  const mentionCount = items.filter((i) => i.mentioned_me && !i.is_read).length;

  const setRead = async (item, read) => {
    setItems((all) => all.map((x) => (x.id === item.id ? { ...x, is_read: read } : x)));
    if (!item.own) setUnread((u) => Math.max(0, u + (read ? -1 : 1)));
    try {
      await api.post(`/api/feed/${item.id}/${read ? 'read' : 'unread'}`);
      announceUnreadChange();
    } catch (e) {
      setError(errText(e, 'Could not update the item'));
      load(true);
    }
  };

  const open = (item) => {
    if (!item.is_read) setRead(item, true);
    navigate(`/incident${item.link || `?open=${item.incident_id}`}`);
  };

  const markAll = async () => {
    try {
      await api.post('/api/feed/read-all');
      announceUnreadChange();
      load(true);
    } catch (e) { setError(errText(e, 'Could not mark everything as read')); }
  };

  return (
    <div className="inc-body">
      <div className="inc-control-bar">
        <div className="inc-control-left">
          <h1 className="inc-heading">Activity Feed</h1>
          <div className="inc-stats">
            <span className="inc-stat inc-stat--amber"><b>{unread}</b> Unread</span>
            <span className="inc-stat"><b>{mineCount}</b> For me</span>
            <span className="inc-stat"><b>{mentionCount}</b> Mentions</span>
          </div>
        </div>
        <div className="inc-control-right">
          <button type="button" className="inc-btn inc-btn--ghost" onClick={markAll} disabled={unread === 0}>
            <CheckCheck size={15} /> Mark all read
          </button>
        </div>
      </div>

      <div className="inc-filterbar">
        <div className="inc-seg" role="tablist" aria-label="Scope">
          {SCOPES.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={scope === v}
                    className={`inc-seg__btn${scope === v ? ' inc-seg__btn--on' : ''}`} onClick={() => setScope(v)}>{label}</button>
          ))}
        </div>
        <select className="inc-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        <select className="inc-select" value={vessel} onChange={(e) => setVessel(e.target.value)} aria-label="Vessel">
          <option value="">All vessels</option>
          {vessels.map((v) => <option key={v.imo} value={v.imo}>{v.name}</option>)}
        </select>
        <label className="inc-check inc-check--pill">
          <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Unread only
        </label>
      </div>

      {error && <div className="inc-error inc-error--bar" role="alert">{error}</div>}

      <div className="inc-card">
        <div className="inc-card__head">
          <div>
            <div className="inc-card__title">Recent activity</div>
            <div className="inc-card__sub">{visible.length} item{visible.length === 1 ? '' : 's'} from the last 60 days · click one to open the incident</div>
          </div>
        </div>
        <div className="inc-card__scroll inc-feed">
          {loading ? (
            <div className="inc-empty"><Loader2 size={20} className="inc-spin" /></div>
          ) : visible.length === 0 ? (
            <div className="inc-empty"><Rss size={30} /><span>{items.length ? 'Nothing matches these filters.' : 'No activity yet.'}</span></div>
          ) : groups.map((g) => (
            <section key={g.key}>
              <div className="inc-feed__day">{g.label}</div>
              {g.rows.map((i) => {
                const t = TYPES[i.event_type] || { label: i.event_type, Icon: Rss, tone: 'blue' };
                const Icon = t.Icon;
                return (
                  <div key={i.id} className={`inc-feed__item${i.is_read ? '' : ' inc-feed__item--unread'}`}>
                    <button type="button" className="inc-feed__main" onClick={() => open(i)}>
                      <span className={`inc-feed__icon inc-feed__icon--${t.tone}`}><Icon size={16} /></span>
                      <span className="inc-feed__body">
                        <span className="inc-feed__title">{i.title}</span>
                        {i.message && <span className="inc-feed__msg">{i.message}</span>}
                        <span className="inc-feed__meta">
                          <span className="inc-cat">{i.incident_no}</span>
                          <span>{i.vessel_name}</span>
                          {i.category && <span>{i.category}</span>}
                          <span className={`inc-badge inc-badge--${i.incident_status.toLowerCase()}`}>{i.incident_status === 'DRAFT' ? 'Draft' : 'Closed'}</span>
                          {i.mentioned_me && <span className="inc-badge inc-badge--draft">Mentions you</span>}
                        </span>
                      </span>
                      <span className="inc-feed__time">{ago(i.created_at)}</span>
                    </button>
                    {!i.own && (
                      <button type="button" className="inc-iconbtn inc-feed__toggle" onClick={() => setRead(i, !i.is_read)}
                              title={i.is_read ? 'Mark as unread' : 'Mark as read'} aria-label={i.is_read ? 'Mark as unread' : 'Mark as read'}>
                        {i.is_read ? <Mail size={15} /> : <MailOpen size={15} />}
                      </button>
                    )}
                    {!i.is_read && <span className="inc-feed__dot" aria-label="Unread" />}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
