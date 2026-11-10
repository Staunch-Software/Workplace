import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, Bell, CheckCircle, MessageSquare, Unlock, X } from 'lucide-react';
import api from '../api/axiosIncident';
import { fmtStamp } from '../utils/format';

const POLL_MS = 15000;

// Same behaviour as the DRS bell: the red badge counts notifications you have not *seen*; opening the bell clears it
// but the items stay listed (yellow until you click them) until you dismiss them with their X or Clear All.
const TYPES = {
  MENTION: { Icon: AtSign, color: '#3b82f6', pillBg: '#dbeafe', pillFg: '#1e40af' },
  MESSAGE: { Icon: MessageSquare, color: '#6366f1', pillBg: '#e0e7ff', pillFg: '#3730a3' },
  CLOSED: { Icon: CheckCircle, color: '#10b981', pillBg: '#d1fae5', pillFg: '#047857' },
  REOPENED: { Icon: Unlock, color: '#f59e0b', pillBg: '#fef3c7', pillFg: '#b45309' },
};

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [badge, setBadge] = useState(0);
  const [clicked, setClicked] = useState(() => new Set());
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/notifications');
      setItems(r.data.data.items || []);
      setBadge(r.data.data.badge_count || 0);
    } catch { /* the bell must never break the page */ }
  }, []);

  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- async fetch on mount; state is set after the await
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = () => {
    if (!open && badge > 0) {
      setBadge(0);                                           // the badge clears the moment the bell is opened
      api.post('/api/notifications/seen').catch(() => load());
    }
    setOpen((o) => !o);
  };

  const go = (item) => {
    setClicked((s) => new Set([...s, item.id]));            // turns from yellow to white; stays until dismissed
    if (item.link) navigate(`/incident${item.link}`);
    setTimeout(() => setOpen(false), 100);
  };

  const dismiss = async (e, id) => {
    e.stopPropagation();
    setItems((all) => all.filter((n) => n.id !== id));
    try { await api.post(`/api/notifications/${id}/read`); } catch { load(); }
  };

  const clearAll = async () => {
    setItems([]);
    try { await api.post('/api/notifications/read-all'); } catch { load(); }
  };

  return (
    <div className="inc-nb" ref={ref}>
      <button type="button" className={`inc-nb__btn${open ? ' inc-nb__btn--active' : ''}`} onClick={toggle}
              aria-label={`Notifications${badge ? `, ${badge} new` : ''}`} aria-haspopup="true" aria-expanded={open}>
        <Bell size={20} />
        {badge > 0 && <span className="inc-nb__badge">{badge > 99 ? '99+' : badge}</span>}
      </button>

      {open && (
        <div className="inc-nb__panel" role="dialog" aria-label="Notifications">
          <div className="inc-nb__head">
            <div className="inc-nb__headtitle"><Bell size={18} color="#ea580c" /><h3>Notifications</h3></div>
            {items.length > 0 && <button type="button" className="inc-nb__clear" onClick={clearAll}>Clear All</button>}
          </div>

          <div className="inc-nb__list">
            {items.length === 0 ? (
              <div className="inc-nb__empty">
                <CheckCircle size={48} color="#10b981" />
                <p className="inc-nb__empty1">All caught up!</p>
                <p className="inc-nb__empty2">No new notifications</p>
              </div>
            ) : items.map((n) => {
              const t = TYPES[n.type] || TYPES.MESSAGE;
              const Icon = t.Icon;
              return (
                <div key={n.id} className={`inc-nb__item${clicked.has(n.id) ? ' inc-nb__item--clicked' : ''}`} onClick={() => go(n)}
                     role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') go(n); }}>
                  <div className="inc-nb__itembody">
                    <div className="inc-nb__itemtop">
                      <span className="inc-nb__typeicon"><Icon size={12} color={t.color} /></span>
                      <strong className="inc-nb__itemtitle">{n.title}</strong>
                    </div>
                    {n.message && <p className="inc-nb__itemmsg">{n.message}</p>}
                    <div className="inc-nb__itemfoot">
                      <span className="inc-nb__time">{fmtStamp(n.created_at)}</span>
                      <span className="inc-nb__pill" style={{ background: t.pillBg, color: t.pillFg }}>{n.type}</span>
                    </div>
                  </div>
                  <button type="button" className="inc-nb__x" onClick={(e) => dismiss(e, n.id)} title="Dismiss" aria-label="Dismiss notification">
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
