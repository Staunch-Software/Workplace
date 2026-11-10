import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AtSign, MessageSquare, Lock, Unlock, CheckCheck, Inbox, Rss } from 'lucide-react';
import api from '../api/axiosIncident';
import { ago, announceUnreadChange } from '../utils/format';

const POLL_MS = 15000;

const ICONS = { MENTION: AtSign, MESSAGE: MessageSquare, CLOSED: Lock, REOPENED: Unlock };

// Bell in the navbar: the user's own notifications (mentions, replies in incidents they are involved in, incidents
// closed or reopened). The activity of all incidents has a page of its own: Feed.
export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState({ items: [], unread_count: 0 });
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/notifications');
      setNotes(r.data.data);
    } catch { /* the bell must never break the page */ }
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- async fetch on mount; state is set after the await
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- refresh when the panel opens; state is set after the await
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, load]);

  const go = async (item) => {
    if (!item.is_read) api.post(`/api/notifications/${item.id}/read`).then(load).catch(() => {});
    setOpen(false);
    if (item.link) navigate(`/incident${item.link}`);
  };

  const markAll = async () => {
    await api.post('/api/notifications/read-all').catch(() => {});
    load();
    announceUnreadChange();
  };

  const badge = notes.unread_count;

  return (
    <div className="inc-bell" ref={ref}>
      <button type="button" className={`inc-bell__btn${open ? ' inc-bell__btn--open' : ''}`} onClick={() => setOpen((o) => !o)}
              aria-label={`Notifications${badge ? `, ${badge} unread` : ''}`} aria-haspopup="true" aria-expanded={open}>
        <Bell size={19} />
        {badge > 0 && <span className="inc-bell__badge">{badge > 99 ? '99+' : badge}</span>}
      </button>

      {open && (
        <div className="inc-bell__panel" role="dialog" aria-label="Notifications">
          <div className="inc-bell__head">
            <span className="inc-bell__title">Notifications{badge > 0 && <span className="inc-bell__count">{badge}</span>}</span>
            <button type="button" className="inc-bell__all" onClick={markAll} disabled={badge === 0} title="Mark everything as read">
              <CheckCheck size={14} /> Mark all read
            </button>
          </div>

          <div className="inc-bell__list">
            {notes.items.length === 0 ? (
              <div className="inc-bell__empty"><Inbox size={26} /><span>No notifications yet.</span></div>
            ) : notes.items.map((item) => {
              const Icon = ICONS[item.type] || Bell;
              return (
                <button key={item.id} type="button" className={`inc-bell__item${item.is_read ? '' : ' inc-bell__item--unread'}`} onClick={() => go(item)}>
                  <span className={`inc-bell__icon inc-bell__icon--${(item.type || '').toLowerCase()}`}><Icon size={15} /></span>
                  <span className="inc-bell__body">
                    <span className="inc-bell__itemtitle">{item.title}</span>
                    {item.message && <span className="inc-bell__msg">{item.message}</span>}
                    <span className="inc-bell__time">{ago(item.created_at)}</span>
                  </span>
                  {!item.is_read && <span className="inc-bell__dot" aria-label="Unread" />}
                </button>
              );
            })}
          </div>

          <button type="button" className="inc-bell__foot" onClick={() => { setOpen(false); navigate('/incident/feed'); }}>
            <Rss size={14} /> Open Feed
          </button>
        </div>
      )}
    </div>
  );
}
