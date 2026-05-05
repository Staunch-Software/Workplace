import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';

const Dashboard = lazy(() => import('./features/Dashboard'));
const Fleet = lazy(() => import('./features/Fleet'));
const MEPerformanceOverview = lazy(() => import('./features/MEPerformanceOverview'));
const AEPerformanceOverview = lazy(() => import('./features/AEPerformanceOverview'));
const UnifiedPerformance = lazy(() => import('./features/UnifiedPerformance'));
const Voyage = lazy(() => import('./features/Voyage'));

function AepmsModule() {
  useEffect(() => { document.title = 'Engine Performance'; }, []);
  return (
    <Suspense fallback={
      <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--white)', gap: '16px' }}>
        <div style={{ width: '44px', height: '44px', border: '4px solid var(--gray-200)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)', fontFamily: 'Inter, sans-serif' }}>Loading...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/fleet" element={<Fleet />} />
        <Route path="/me-performance" element={<MEPerformanceOverview />} />
        <Route path="/ae-performance" element={<AEPerformanceOverview />} />
        <Route path="/performance-cockpit" element={<UnifiedPerformance />} />
        <Route path="/voyage" element={<Voyage />} />
      </Routes>
    </Suspense>
  );
}

export default AepmsModule;