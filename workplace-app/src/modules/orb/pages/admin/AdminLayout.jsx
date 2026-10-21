import Sidebar from '../../components/Layout/Sidebar';
import Header from '../../components/Layout/Header';

// Shell for admin pages (ORB's own admin layout relied on nested routes).
export default function AdminLayout({ title, children }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Header title={title} />
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}
