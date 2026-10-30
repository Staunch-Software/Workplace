import { useState, useEffect } from 'react';
import { NavLink, useNavigate as useRouterNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSidebar } from '../../context/SidebarContext';
import {
  LayoutDashboard, Upload, FileText, Bell,
  BookOpen, ArrowLeft, Rss,
} from 'lucide-react';
import api from '../../api/axiosOrb';
import { useOrbBase } from '../../hooks/useOrbNavigate';

// Shore View and Vessel View each get their own menu. Vessel Config is not here: it lives in the
// profile menu (admin only), as in the Lube Oil module.
const SHORE_LINKS = [
  { to: '/dashboard',  label: 'Dashboard',   Icon: LayoutDashboard },
  { to: '/uploads',    label: 'ORB Uploads',  Icon: Upload },
  { to: '/entries',    label: 'ORB Entries',  Icon: FileText },
  { to: '/alerts',     label: 'Alerts',       Icon: Bell },
  { to: '/feed',       label: 'Feed',         Icon: Rss },
  { to: '/daily-log',  label: 'Daily Log',    Icon: BookOpen },
];

const VESSEL_LINKS = [
  { to: '/dashboard',  label: 'Dashboard',   Icon: LayoutDashboard },
  { to: '/entries',    label: 'ORB Entries',  Icon: FileText },
  { to: '/alerts',     label: 'Alerts',       Icon: Bell },
  { to: '/feed',       label: 'Feed',         Icon: Rss },
  { to: '/daily-log',  label: 'Daily Log',    Icon: BookOpen },
];

export default function Sidebar() {
  const { isVessel } = useAuth();
  const base = useOrbBase();
  const MAIN_LINKS = isVessel ? VESSEL_LINKS : SHORE_LINKS;
  const goToWorkplace = useRouterNavigate();
  const { isOpen, close } = useSidebar();
  const [alertCount, setAlertCount] = useState(0);
  const [feedCount, setFeedCount] = useState(0);

  useEffect(() => {
    const fetch = () => {
      api.get('/api/alerts/summary').then(r => setAlertCount(r.data.data?.total || 0)).catch(() => {});
      api.get('/api/feed', { params: { limit: 1 } }).then(r => setFeedCount(r.data.data?.unread_count || 0)).catch(() => {});
    };
    fetch();
    const id = setInterval(fetch, 30000);
    window.addEventListener('orb:feed-changed', fetch);
    return () => { clearInterval(id); window.removeEventListener('orb:feed-changed', fetch); };
  }, []);

  return (
    <>
      {/* Backdrop — only visible on mobile when sidebar is open */}
      {isOpen && <div className="sidebar-backdrop" onClick={close} />}

      <aside className={`sidebar${isOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo__mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="32" cy="16" r="5" />
              <line x1="32" y1="21" x2="32" y2="46" />
              <line x1="20" y1="28" x2="44" y2="28" />
              <path d="M16 38 a16 16 0 0 0 32 0" />
              <line x1="16" y1="38" x2="16" y2="33" />
              <line x1="48" y1="38" x2="48" y2="33" />
            </svg>
          </div>
          <div className="sidebar-logo__text">
            <span className="sidebar-logo__name">ORB Platform</span>
            <span className="sidebar-logo__tag">MARPOL Compliance</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section">{isVessel ? 'Vessel' : 'Shore'}</div>
          {MAIN_LINKS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={`${base}${to}`}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
              onClick={close}
            >
              <Icon size={18} className="sidebar-icon" />
              {label}
              {label === 'Alerts' && alertCount > 0 && (
                <span className="sidebar-badge">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
              {label === 'Feed' && feedCount > 0 && (
                <span className="sidebar-badge">
                  {feedCount > 99 ? '99+' : feedCount}
                </span>
              )}
            </NavLink>
          ))}

        </nav>
        <nav className="sidebar-nav" style={{ flex: 'none', paddingTop: 0 }}>
          <button type="button" className="sidebar-link" onClick={() => goToWorkplace('/dashboard')} style={{ width: '100%', background: 'none', border: 'none', textAlign: 'left' }}>
            <ArrowLeft size={18} className="sidebar-icon" />
            Back to Workplace
          </button>
        </nav>
      </aside>
    </>
  );
}
