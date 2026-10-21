// src/modules/orb/OrbModule.jsx
// Module router for the Oil Record Book (ORB) platform.
import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { SidebarProvider } from './context/SidebarContext';
import { ToastProvider } from './context/ToastContext';

import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';

import Dashboard from './pages/Dashboard';
import Vessels from './pages/Vessels';
import Uploads from './pages/Uploads';
import UploadDetail from './pages/UploadDetail';
import Entries from './pages/Entries';
import Alerts from './pages/Alerts';
import DailyLog from './pages/DailyLog';
import VesselConfiguration from './pages/admin/VesselConfiguration';
import AdminLayout from './pages/admin/AdminLayout';

export default function OrbModule() {
  useEffect(() => { document.title = 'ORB Platform'; }, []);

  return (
    <div className="orb-root">
      <ToastProvider>
        <SidebarProvider>
          <Routes>
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="vessels" element={<Vessels />} />
            <Route path="uploads" element={<Uploads />} />
            <Route path="uploads/:id" element={<UploadDetail />} />
            <Route path="entries" element={<Entries />} />
            <Route path="alerts" element={<Alerts />} />
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
            <Route path="admin" element={<Navigate to="/orb/admin/vessels" replace />} />
            <Route index element={<Navigate to="/orb/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/orb/dashboard" replace />} />
          </Routes>
        </SidebarProvider>
      </ToastProvider>
    </div>
  );
}
