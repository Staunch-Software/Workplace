// src/modules/drs/DrsModule.jsx
// ─────────────────────────────────────────────────────────────
// DRS converted from standalone App → nested module.
// BrowserRouter and AuthProvider removed (inherited from Workspace).
// All route paths are now RELATIVE (no leading /drs prefix here —
// that prefix is set in Workspace App.jsx via path="/drs/*").
// ─────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/auth/ProtectedRoute'; // ← Workspace's unified ProtectedRoute

// Vessel
import VesselLayout from './features/vessel/VesselLayout';
import VesselDashboard from './features/vessel/VesselDashboard';
import CreateDefect from './features/vessel/CreateDefect';
import MyTasks from './features/vessel/MyTasks';
import VesselReports from './features/vessel/VesselReports';

// Shore
import ShoreLayout from './features/shore/ShoreLayout';
import ShoreDashboard from './features/shore/ShoreDashboard';
import ShoreTasks from './features/shore/ShoreTasks';
import ShoreHistory from './features/shore/ShoreHistory';
import ShoreVesselData from './features/shore/ShoreVesselData';
import ShoreReports from './features/shore/ShoreReports';
import AdminUserPanel from './features/shore/AdminUserPanel';
import AnalyticsDashboard from './features/shore/AnalyticsDashboard';

function DrsModule() {
  useEffect(() => { document.title = 'DRS'; }, []);
  return (
    <Routes>
      {/* Default: /drs → /drs/vessel/dashboard or /drs/shore/dashboard
          handled by Workspace's post-login redirect based on role */}
      <Route index element={<Navigate to="vessel/dashboard" replace />} />

      {/* ── VESSEL ROUTES ──────────────────────────────────── */}
      <Route
        path="vessel"
        element={
          <ProtectedRoute allowedRoles={['VESSEL']}>
            <VesselLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<VesselDashboard />} />
        <Route path="tasks" element={<MyTasks />} />
        <Route path="create" element={<CreateDefect />} />
        <Route path="reports" element={<VesselReports />} />
        {/* Legacy redirect — keep to avoid broken bookmarks */}
        <Route path="history" element={<Navigate to="dashboard" replace />} />
      </Route>

      {/* ── SHORE ROUTES ───────────────────────────────────── */}
      <Route
        path="shore"
        element={
          <ProtectedRoute allowedRoles={['SHORE', 'ADMIN']}>
            <ShoreLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<ShoreDashboard />} />
        <Route path="vessels" element={<ShoreVesselData />} />
        <Route path="tasks" element={<ShoreTasks />} />
        <Route path="history" element={<ShoreHistory />} />
        <Route path="reports" element={<ShoreReports />} />
        <Route path="analytics-dashboard" element={<AnalyticsDashboard />} />
        <Route
          path="admin/users"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <AdminUserPanel />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Catch-all inside /drs/* */}
      <Route path="*" element={<Navigate to="vessel/dashboard" replace />} />
    </Routes>
  );
}

export default DrsModule;