import React, { Suspense, lazy, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';

const AdminConfig = lazy(() => import('./features/AdminConfig'));
const Task1Page = lazy(() => import('./features/Task1Page'));

function TaskMgmtModule() {
  useEffect(() => { document.title = 'Task Management'; }, []);
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
          Loading Task Management...
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    }>
      <Routes>
        <Route path="/" element={<AdminConfig />} />
        <Route path="/tasks/1" element={<Task1Page />} />
      </Routes>
    </Suspense>
  );
}

export default TaskMgmtModule;
