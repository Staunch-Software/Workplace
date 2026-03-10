// src/components/layout/ProtectedRoute.jsx  (Workspace — unified)
// ─────────────────────────────────────────────────────────────
// Works for both Workspace routes (no allowedRoles) and
// DRS routes (allowedRoles: ['VESSEL'] | ['SHORE', 'ADMIN']).
// ─────────────────────────────────────────────────────────────

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="p-10 text-center">Loading...</div>;
  }

  // Not logged in → go to login, preserve intended destination
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Role check (only when allowedRoles is provided)
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return (
      <div className="p-10 text-center text-red-500">
        Access Denied: You do not have permission to view this page.
      </div>
    );
  }

  return children;
};

export default ProtectedRoute;