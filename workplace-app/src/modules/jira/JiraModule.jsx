import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

const ShoreDashboard = React.lazy(() => import('./features/ShoreDashboard'));
const VesselDashboard = React.lazy(() => import('./features/VesselDashboard'));
const CreateTicket = React.lazy(() => import('./features/CreateTicket'));
const TicketDetail = React.lazy(() => import('./features/TicketDetail'));

function JiraModule() {
  const { user } = useAuth();

  const defaultRoute = user?.role === 'VESSEL' ? 'vessel/dashboard' : 'shore/dashboard';

  return (
    <Routes>
      <Route index element={<Navigate to={defaultRoute} replace />} />

      {/* SHORE / ADMIN */}
      <Route path="shore/dashboard" element={<ShoreDashboard />} />
      <Route path="shore/tickets/:id" element={<TicketDetail />} />
      <Route path="shore/create" element={<CreateTicket />} />

      {/* VESSEL */}
      <Route path="vessel/dashboard" element={<VesselDashboard />} />
      <Route path="vessel/tickets/:id" element={<TicketDetail />} />
      <Route path="vessel/create" element={<CreateTicket />} />

      <Route path="*" element={<Navigate to={defaultRoute} replace />} />
    </Routes>
  );
}

export default JiraModule; 