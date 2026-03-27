import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { Toaster } from 'react-hot-toast';

import Login from './pages/Login/Login';
import Home from './pages/Dashboard/Home';
import Navbar from './components/Navbar';

const DrsModule = lazy(() => import('./modules/drs/DrsModule'));
const LubModule = lazy(() => import('./modules/lubeoil/Lubmodule'));
const JiraModule = lazy(() => import('./modules/jira/JiraModule'));
const AepmsModule = lazy(() => import('./modules/aepms/AepmsModule'));
const AdminPanel = lazy(() => import('./pages/admin/AdminPanel'));

function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <BrowserRouter>
        <Routes>
          {/* ── PUBLIC ─────────────────────────────────── */}
          <Route path="/login" element={<Login />} />

          {/* ── WORKSPACE DASHBOARD ────────────────────── */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Navbar />
              <Home />
            </ProtectedRoute>
          } />

          {/* ── ADMIN PANEL ────────────────────────────── */}
          <Route path="/admin/*" element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <Suspense fallback={
                <div style={{
                  position: 'fixed',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--white)',
                  gap: '16px',
                  zIndex: 999,
                }}>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    border: '4px solid var(--gray-200)',
                    borderTopColor: 'var(--primary)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)', fontFamily: 'Inter, sans-serif' }}>
                    Loading...
                  </span>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </div>
              }>
                <AdminPanel />
              </Suspense>
            </ProtectedRoute>
          } />

          {/* ── DRS MODULE ─────────────────────────────── */}
          <Route path="/drs/*" element={
            <ProtectedRoute>
              <Suspense fallback={<div className="p-10 text-center">Loading DRS...</div>}>
                <DrsModule />
              </Suspense>
            </ProtectedRoute>
          } />

          <Route path="/lub/*" element={
            <ProtectedRoute allowedRoles={['SHORE', 'ADMIN', 'VESSEL']}>
              <LubModule />
            </ProtectedRoute>
          } />

          <Route path="/jira/*" element={
            <ProtectedRoute allowedRoles={['SHORE', 'ADMIN', 'VESSEL']}>
              <Suspense fallback={<div className="p-10 text-center">Loading JIRA...</div>}>
                <JiraModule />
              </Suspense>
            </ProtectedRoute>
          } />


          <Route path="/aepms/*" element={
            <ProtectedRoute allowedRoles={['SHORE', 'ADMIN', 'VESSEL']}>
              <Suspense fallback={<div className="p-10 text-center">Loading AEPMS...</div>}>
                <AepmsModule />
              </Suspense>
            </ProtectedRoute>
          } />

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;