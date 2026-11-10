// Module router for the Incident Report repository (shore side: SHORE with the permission, and ADMIN).
// Seeing the module needs `incident_report`; creating / editing / closing needs `incident_create`, which is
// granted to a few named users only. Both are enforced by the incident API: the screens only hide what is refused.
// An incident opens as a popup over the list (?open=<id>), so a link to one still works.
import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import api, { errText } from './api/axiosIncident';
import IncidentList from './pages/IncidentList';
import './styles/incident.css';

function Navbar({ user }) {
  const navigate = useNavigate();
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
      <div className="inc-nav__spacer" />
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
    api.get('/api/me').then((r) => setMe(r.data.data)).catch((e) => setError(errText(e, 'Could not reach the incident service')));
  }, [allowed]);

  return (
    <div className="inc-root">
      <Navbar user={user} />
      {!allowed ? (
        <div className="inc-center"><div className="inc-error">You do not have access to the Incident Reports module.</div></div>
      ) : error ? (
        <div className="inc-center"><div className="inc-error" role="alert">{error}</div></div>
      ) : !me ? (
        <div className="inc-center"><Loader2 size={22} className="inc-spin" /></div>
      ) : (
        <Routes>
          <Route index element={<IncidentList me={me} />} />
          <Route path="*" element={<Navigate to="/incident" replace />} />
        </Routes>
      )}
    </div>
  );
}
