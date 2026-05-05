import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { Toaster } from 'react-hot-toast';
import { useState } from 'react';

import Login from './pages/Login/Login';
import ResetPassword from './pages/ResetPassword/ResetPassword';
import Home from './pages/Dashboard/Home';
import Navbar from './components/Navbar';
import UserGuide from './pages/UserGuide/UserGuide';

const DrsModule = lazy(() => import('./modules/drs/DrsModule'));
const LubModule = lazy(() => import('./modules/lubeoil/Lubmodule'));
const JiraModule = lazy(() => import('./modules/jira/JiraModule'));
const AepmsModule = lazy(() => import('./modules/aepms/AepmsModule'));
const AdminPanel = lazy(() => import('./pages/admin/AdminPanel'));

const moduleLoaderStyle = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  background: 'var(--white)', gap: '16px', zIndex: 999,
};
const spinnerStyle = {
  width: '44px', height: '44px',
  border: '4px solid var(--gray-200)', borderTopColor: 'var(--primary)',
  borderRadius: '50%', animation: 'spin 0.8s linear infinite',
};
const spinKeyframes = `@keyframes spin { to { transform: rotate(360deg); } }`;
const ModuleLoader = ({ label }) => (
  <div style={moduleLoaderStyle}>
    <div style={spinnerStyle} />
    <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)', fontFamily: 'Inter, sans-serif' }}>
      {label}
    </span>
    <style>{spinKeyframes}</style>
  </div>
);

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <BrowserRouter>
        <Routes>
          {/* ── PUBLIC ─────────────────────────────────── */}
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* ── WORKSPACE DASHBOARD ────────────────────── */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Navbar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
              <Home searchQuery={searchQuery} />
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
              <Suspense fallback={<ModuleLoader label="Loading DRS..." />}>
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
              <Suspense fallback={<ModuleLoader label="Loading JIRA..." />}>
                <JiraModule />
              </Suspense>
            </ProtectedRoute>
          } />


          <Route path="/aepms/*" element={
            <ProtectedRoute allowedRoles={['SHORE', 'ADMIN', 'VESSEL']}>
              <Suspense fallback={<ModuleLoader label="Loading AEPMS..." />}>
                <AepmsModule />
              </Suspense>
            </ProtectedRoute>
          } />

          {/* ── USER GUIDE ─────────────────────────────── */}
          <Route path="/help" element={
            <ProtectedRoute allowedRoles={['ADMIN', 'SHORE', 'VESSEL']}>
              <UserGuide />
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