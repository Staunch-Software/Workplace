// src/modules/reports/ReportsModule.jsx
// Module router for the Report Tracker.
import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import ShoreReportsPage from './features/shore/ShoreReportsPage';
import VesselReportsPage from './features/vessel/VesselReportsPage';
import ActivityFeedPage from './features/shared/ActivityFeedPage';
import ReportConfigPage from './features/shore/ReportConfigPage';
import OverviewPage from './features/shore/OverviewPage';

function DefaultRedirect() {
  return <Navigate to="overview" replace />;
}

export default function ReportsModule() {
  useEffect(() => { document.title = 'Report Tracker'; }, []);

  return (
    <Routes>
      {/* Shore / Admin landing page */}
      <Route
        path="shore"
        element={
          <ProtectedRoute allowedRoles={['SHORE', 'ADMIN']}>
            <ShoreReportsPage />
          </ProtectedRoute>
        }
      />

      {/* Admin config page */}
      <Route
        path="config"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <ReportConfigPage />
          </ProtectedRoute>
        }
      />

      {/* All-vessel Overview matrix */}
      <Route
        path="overview"
        element={
          <ProtectedRoute allowedRoles={['SHORE', 'ADMIN', 'VESSEL']}>
            <OverviewPage />
          </ProtectedRoute>
        }
      />

      {/* Vessel landing page (offline-first) */}
      <Route
        path="vessel"
        element={
          <ProtectedRoute allowedRoles={['VESSEL', 'ADMIN']}>
            <React.Suspense fallback={<div className="rpt-loading"><span className="rpt-spinner" /></div>}>
              <VesselReportsPage />
            </React.Suspense>
          </ProtectedRoute>
        }
      />

      {/* Smart redirect based on role */}
      <Route path="vessel-feed" element={<ActivityFeedPage />} />
      <Route path="feed" element={<ActivityFeedPage />} />
      <Route index element={<DefaultRedirect />} />
      <Route path="*" element={<DefaultRedirect />} />
    </Routes>
  );
}
