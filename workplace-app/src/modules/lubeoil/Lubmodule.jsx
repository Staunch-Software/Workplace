import React, { Suspense, lazy } from 'react';
const LuboilAnalysis = lazy(() => import('./features/LuboilAnalysis'));

function LubModule() {
  return (
    <Suspense fallback={
      <div style={{
        position: 'fixed', inset: 0, display: 'flex',
        flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', background: 'var(--white)', gap: 16
      }}>
        <div style={{
          width: 44, height: 44, border: '4px solid var(--gray-200)',
          borderTopColor: 'var(--primary)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <span style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
          Loading Luboil...
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <LuboilAnalysis />
    </Suspense>
  );
}

export default LubModule;