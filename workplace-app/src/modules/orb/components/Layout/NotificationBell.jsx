import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, AtSign, MessageSquare, CheckCircle2, FileText, AlertTriangle, CheckCheck, Inbox, ClipboardCheck, XCircle, Rss } from 'lucide-react';
import api from '../../api/axiosOrb';
import { useNavigate } from '../../hooks/useOrbNavigate';
import './NotificationBell.css';
import { nowMs, parseTs, fmtDate } from '../../utils/time';

const POLL_MS = 15000;

const ICONS = {
  MENTION: AtSign, MESSAGE: MessageSquare, RESOLVED: CheckCircle2, UPLOAD: FileText, ALERTS_RAISED: AlertTriangle,
  REQUEST: ClipboardCheck, REJECTED: XCircle,
};

function ago(iso) {
  const s = Math.max(0, (nowMs() - parseTs(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso);
}

// Bell in the ORB header: the user's own notifications (mentions, replies, resolution steps, finished
// uploads). The activity of the vessels has a page of its own: Feed.
export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState({ items: [], unread_count: 0 });
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/notifications');
      setNotes(r.data.data);
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

  const go = async (item) => {
    if (!item.is_read) api.post(`/api/notifications/${item.id}/read`).then(load).catch(() => {});
    setOpen(false);
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    await api.post('/api/notifications/read-all').catch(() => {});
    load();
  };

  const badge = notes.unread_count;

  return (
    <div className="nb" ref={ref}>
      <button type="button" className={`nb-btn${open ? ' nb-btn--open' : ''}`} onClick={() => setOpen(o => !o)}
              aria-label={`Notifications${badge ? `, ${badge} unread` : ''}`} aria-haspopup="true" aria-expanded={open}>
        <Bell size={19} />
        {badge > 0 && <span className="nb-badge">{badge > 99 ? '99+' : badge}</span>}
      </button>

      {open && (
        <div className="nb-panel" role="dialog" aria-label="Notifications">
          <div className="nb-tabs">
            <span className="nb-title">Notifications{notes.unread_count > 0 && <span className="nb-tab__n">{notes.unread_count}</span>}</span>
            <button type="button" className="nb-all" onClick={markAll} disabled={notes.unread_count === 0} title="Mark everything as read">
              <CheckCheck size={14} /> Mark all read
            </button>
          </div>

          <div className="nb-list">
            {notes.items.length === 0 ? (
              <div className="nb-empty"><Inbox size={26} /><span>No notifications yet.</span></div>
            ) : notes.items.map(item => {
              const Icon = ICONS[item.type] || Bell;
              return (
                <button key={item.id} type="button" className={`nb-item${item.is_read ? '' : ' nb-item--unread'}`} onClick={() => go(item)}>
                  <span className={`nb-item__icon nb-item__icon--${(item.type || '').toLowerCase()}`}><Icon size={15} /></span>
                  <span className="nb-item__body">
                    <span className="nb-item__title">{item.title}</span>
                    {item.message && <span className="nb-item__msg">{item.message}</span>}
                    <span className="nb-item__time">{ago(item.created_at)}</span>
                  </span>
                  {!item.is_read && <span className="nb-item__dot" aria-label="Unread" />}
                </button>
              );
            })}
          </div>

          <button type="button" className="nb-foot" onClick={() => { setOpen(false); navigate('/feed'); }}>
            <Rss size={14} /> Open Feed
          </button>
        </div>
      )}
    </div>
  );
}
