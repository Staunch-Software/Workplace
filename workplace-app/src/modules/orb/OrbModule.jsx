// src/modules/orb/OrbModule.jsx
// Module router for the Oil Record Book (ORB) platform.
// Two views: Shore View (SHORE, ADMIN) and Vessel View (VESSEL). Every user only sees the vessels
// assigned to them; that is enforced by the ORB API, the views only decide which pages exist.
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useAuth } from '@/context/AuthContext';
import { SidebarProvider } from './context/SidebarContext';
import { ToastProvider } from './context/ToastContext';
import { viewBaseFor, viewOf, ORB_ROOT } from './hooks/useOrbNavigate';

import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';

import Dashboard from './pages/Dashboard';
import Uploads from './pages/Uploads';
import UploadDetail from './pages/UploadDetail';
import Entries from './pages/Entries';
import Alerts from './pages/Alerts';
import DailyLog from './pages/DailyLog';
import Feed from './pages/Feed';
import VesselConfiguration from './pages/admin/VesselConfiguration';
import AlertSettings from './pages/admin/AlertSettings';
import AdminLayout from './pages/admin/AdminLayout';

// A user who opens the other view's address (or an old flat /orb/... link) lands on their own view.
function ToOwnView({ path }) {
  const { user } = useAuth();
  const location = useLocation();
  const base = viewBaseFor(user?.role);
  let rest = path;
  if (rest === undefined) {
    rest = location.pathname.replace(/^\/orb(\/(shore|vessel))?/, '') || '/dashboard';
    if (rest === '/vessels' || rest === '/') rest = '/dashboard';
    if (rest === '/admin') rest = '/admin/vessels';
  }
  return <Navigate to={`${base}${rest}`} replace />;
}

function ViewGate({ view, children }) {
  const { user } = useAuth();
  if (user && viewOf(user.role) !== view) return <ToOwnView />;
  return children;
}

function ShoreRoutes() {
  return (
    <Routes>
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="uploads" element={<Uploads />} />
      <Route path="uploads/:id" element={<UploadDetail />} />
      <Route path="entries" element={<Entries />} />
      <Route path="alerts" element={<Alerts />} />
      <Route path="feed" element={<Feed />} />
      <Route path="daily-log" element={<DailyLog />} />
      <Route
        path="admin/vessels"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminLayout title="Vessel Configuration">
              <VesselConfiguration />
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="admin/alerts"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminLayout title="Alert Settings">
              <AlertSettings />
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route path="admin" element={<Navigate to={`${ORB_ROOT}/shore/admin/vessels`} replace />} />
      <Route path="vessels" element={<Navigate to={`${ORB_ROOT}/shore/dashboard`} replace />} />
      <Route path="*" element={<Navigate to={`${ORB_ROOT}/shore/dashboard`} replace />} />
    </Routes>
  );
}

function VesselRoutes() {
  return (
    <Routes>
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="entries" element={<Entries />} />
      <Route path="alerts" element={<Alerts />} />
      <Route path="feed" element={<Feed />} />
      <Route path="daily-log" element={<DailyLog />} />
      <Route path="*" element={<Navigate to={`${ORB_ROOT}/vessel/dashboard`} replace />} />
    </Routes>
  );
}

export default function OrbModule() {
  useEffect(() => { document.title = 'ORB Platform'; }, []);

  return (
    <div className="orb-root">
      <ToastProvider>
        <SidebarProvider>
          <Routes>
            <Route path="shore/*" element={<ViewGate view="shore"><ShoreRoutes /></ViewGate>} />
            <Route path="vessel/*" element={<ViewGate view="vessel"><VesselRoutes /></ViewGate>} />
            <Route path="*" element={<ToOwnView />} />
          </Routes>
        </SidebarProvider>
      </ToastProvider>
    </div>
  );
}
