// Module router for the Incident Report repository (shore side: SHORE with the permission, and ADMIN).
// Seeing the module needs `incident_report`; creating / editing / closing needs `incident_create`, which is
// granted to a few named users only. Both are enforced by the incident API: the screens only hide what is refused.
// An incident opens as a popup over the list (?open=<id>), so a link to one still works. The bell and the Feed page
// show what happened on incidents (mentions, replies, closed/reopened, evidence added).
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ListChecks, Loader2, Rss, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api, { errText } from './api/axiosIncident';
import IncidentList from './pages/IncidentList';
import IncidentFeed from './pages/IncidentFeed';
import NotificationBell from './components/NotificationBell';
import { UNREAD_EVENT } from './utils/format';
import './styles/incident.css';
import './styles/feed.css';

function Navbar({ user, enabled }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onFeed = pathname.startsWith('/incident/feed');
  const [feedUnread, setFeedUnread] = useState(0);

  // Unread badge on the Feed tab: polled, and refreshed at once when something is read or unread anywhere.
  const loadUnread = useCallback(async () => {
    try {
      const r = await api.get('/api/feed/unread-count');
      setFeedUnread(r.data.data.unread_count || 0);
    } catch { /* the badge must never break the page */ }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    loadUnread(); // eslint-disable-line react-hooks/set-state-in-effect -- async fetch on mount; state is set after the await
    const id = setInterval(() => { if (!document.hidden) loadUnread(); }, 15000);
    window.addEventListener(UNREAD_EVENT, loadUnread);
    return () => { clearInterval(id); window.removeEventListener(UNREAD_EVENT, loadUnread); };
  }, [enabled, loadUnread]);

  const name = user?.full_name || user?.name || 'User';
  const initials = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <nav className="inc-nav">
      <button type="button" className="inc-nav__back" onClick={() => navigate('/dashboard')} title="Back to Dashboard" aria-label="Back to Dashboard">
        <ArrowLeft size={18} />
      </button>
      <div className="inc-nav__divider" />
      <div className="inc-nav__brand">
        <div className="inc-nav__icon"><ShieldAlert size={19} /></div>
        <div className="inc-nav__text">
          <span className="inc-nav__title">Incident Reports</span>
          <span className="inc-nav__tag">Repository</span>
        </div>
      </div>
      {enabled && (
        <div className="inc-nav__links" role="tablist">
          <button type="button" role="tab" aria-selected={!onFeed} className={`inc-nav__link${!onFeed ? ' inc-nav__link--on' : ''}`} onClick={() => navigate('/incident')}>
            <ListChecks size={15} /> Incidents
          </button>
          <button type="button" role="tab" aria-selected={onFeed} className={`inc-nav__link${onFeed ? ' inc-nav__link--on' : ''}`} onClick={() => navigate('/incident/feed')}>
            <Rss size={15} /> Feed
            {feedUnread > 0 && <span className="inc-nav__badge">{feedUnread > 99 ? '99+' : feedUnread}</span>}
          </button>
        </div>
      )}
      <div className="inc-nav__spacer" />
      {enabled && <NotificationBell />}
      <div className="inc-nav__pill">
        <span className="inc-nav__avatar">{initials}</span>
        <span className="inc-nav__who">
          <span className="inc-nav__name">{name}</span>
          <span className="inc-nav__role">{user?.role}</span>
        </span>
      </div>
    </nav>
  );
}

export default function IncidentModule() {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');

  const allowed = user?.role === 'ADMIN' || (user?.role === 'SHORE' && user?.permissions?.incident_report === true);

  useEffect(() => {
    if (!allowed) return;
    api.get('/api/me')
      .then((r) => {
        // A reverse proxy without the /incident/api route answers 200 with the app's index.html, not JSON.
        const data = r.data?.data;
        if (!data || typeof data !== 'object' || !('can_create' in data)) {
          throw new Error('unexpected response');
        }
        setMe(data);
      })
      .catch((e) => setError(errText(
        e,
        'The incident service did not respond correctly. Please contact the administrator (the /incident/api route may not be set up).',
      )));
  }, [allowed]);

  return (
    <div className="inc-root">
      <Navbar user={user} enabled={allowed && !!me} />
      {!allowed ? (
        <div className="inc-center"><div className="inc-error">You do not have access to the Incident Reports module.</div></div>
      ) : error ? (
        <div className="inc-center"><div className="inc-error" role="alert">{error}</div></div>
      ) : !me ? (
        <div className="inc-center"><Loader2 size={22} className="inc-spin" /></div>
      ) : (
        <Routes>
          <Route index element={<IncidentList me={me} />} />
          <Route path="feed" element={<IncidentFeed />} />
          <Route path="*" element={<Navigate to="/incident" replace />} />
        </Routes>
      )}
    </div>
  );
}
