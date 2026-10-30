import { NavLink } from 'react-router-dom';
import Sidebar from '../../components/Layout/Sidebar';
import Header from '../../components/Layout/Header';
import { useOrbBase } from '../../hooks/useOrbNavigate';
import './AdminSections.css';

// Shell for admin pages (ORB's own admin layout relied on nested routes).
export default function AdminLayout({ title, children }) {
  const base = useOrbBase();
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Header title={title} />
        <div className="page-body">
          <nav className="admin-nav" aria-label="Administration">
            <NavLink to={`${base}/admin/vessels`} className={({ isActive }) => `admin-nav__link${isActive ? ' admin-nav__link--on' : ''}`}>Vessel Configuration</NavLink>
            <NavLink to={`${base}/admin/alerts`} className={({ isActive }) => `admin-nav__link${isActive ? ' admin-nav__link--on' : ''}`}>Alert Settings</NavLink>
          </nav>
          {children}
        </div>
      </div>
    </div>
  );
}
