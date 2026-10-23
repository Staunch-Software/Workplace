import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, AtSign, MessageSquare, CheckCircle2, FileText, AlertTriangle, CheckCheck, Inbox, ClipboardCheck, XCircle } from 'lucide-react';
import api from '../../api/axiosOrb';
import { useNavigate } from '../../hooks/useOrbNavigate';
import './NotificationBell.css';

const POLL_MS = 15000;

const ICONS = {
  MENTION: AtSign, MESSAGE: MessageSquare, RESOLVED: CheckCircle2, UPLOAD: FileText, ALERTS_RAISED: AlertTriangle,
  REQUEST: ClipboardCheck, REJECTED: XCircle, RESOLUTION_REQUESTED: ClipboardCheck, RESOLUTION_REJECTED: XCircle,
};

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Bell in the ORB header: the user's notifications (mentions, replies, resolved alerts, finished
// uploads) and the activity feed of their vessels.
export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('notifications');
  const [notes, setNotes] = useState({ items: [], unread_count: 0 });
  const [feed, setFeed] = useState({ items: [], unread_count: 0 });
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const [n, f] = await Promise.all([api.get('/api/notifications'), api.get('/api/feed')]);
      setNotes(n.data.data);
      setFeed(f.data.data);
    } catch (_) { /* the bell must never break the page */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, load]);

  const go = async (item, kind) => {
    if (!item.is_read) {
      api.post(`/api/${kind === 'notifications' ? 'notifications' : 'feed'}/${item.id}/read`).then(load).catch(() => {});
    }
    setOpen(false);
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    await api.post(tab === 'notifications' ? '/api/notifications/read-all' : '/api/feed/read-all').catch(() => {});
    load();
  };

  const list = tab === 'notifications' ? notes : feed;
  const badge = notes.unread_count;

  return (
    <div className="nb" ref={ref}>
      <button type="button" className={`nb-btn${open ? ' nb-btn--open' : ''}`} onClick={() => setOpen(o => !o)}
              aria-label={`Notifications${badge ? `, ${badge} unread` : ''}`} aria-haspopup="true" aria-expanded={open}>
        <Bell size={19} />
        {badge > 0 && <span className="nb-badge">{badge > 99 ? '99+' : badge}</span>}
        {badge === 0 && feed.unread_count > 0 && <span className="nb-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notifications">
          <div className="nb-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'notifications'} className={`nb-tab${tab === 'notifications' ? ' nb-tab--on' : ''}`} onClick={() => setTab('notifications')}>
              Notifications{notes.unread_count > 0 && <span className="nb-tab__n">{notes.unread_count}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'feed'} className={`nb-tab${tab === 'feed' ? ' nb-tab--on' : ''}`} onClick={() => setTab('feed')}>
              Activity{feed.unread_count > 0 && <span className="nb-tab__n">{feed.unread_count}</span>}
            </button>
            <button type="button" className="nb-all" onClick={markAll} disabled={list.unread_count === 0} title="Mark everything as read">
              <CheckCheck size={14} /> Mark all read
            </button>
          </div>

          <div className="nb-list">
            {list.items.length === 0 ? (
              <div className="nb-empty"><Inbox size={26} /><span>{tab === 'notifications' ? 'No notifications yet.' : 'No activity yet.'}</span></div>
            ) : list.items.map(item => {
              const Icon = ICONS[item.type || item.event_type] || Bell;
              return (
                <button key={item.id} type="button" className={`nb-item${item.is_read ? '' : ' nb-item--unread'}`} onClick={() => go(item, tab)}>
                  <span className={`nb-item__icon nb-item__icon--${(item.type || item.event_type || '').toLowerCase()}`}><Icon size={15} /></span>
                  <span className="nb-item__body">
                    <span className="nb-item__title">{item.title}</span>
                    {item.message && <span className="nb-item__msg">{item.message}</span>}
                    <span className="nb-item__time">{ago(item.created_at)}{item.shore_only ? ' · shore only' : ''}</span>
                  </span>
                  {!item.is_read && <span className="nb-item__dot" aria-label="Unread" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
