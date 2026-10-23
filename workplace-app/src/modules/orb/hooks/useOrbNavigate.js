import { useCallback } from 'react';
import { useNavigate as useRouterNavigate } from 'react-router-dom';
import { useAuth as useWorkplaceAuth } from '@/context/AuthContext';

export const ORB_ROOT = '/orb';

// Shore users (SHORE, ADMIN) work in Shore View, ship users (VESSEL) in Vessel View.
export const viewOf = (role) => (role === 'VESSEL' ? 'vessel' : 'shore');
export const viewBaseFor = (role) => `${ORB_ROOT}/${viewOf(role)}`;

export function useOrbBase() {
  const { user } = useWorkplaceAuth();
  return viewBaseFor(user?.role);
}

// ORB pages navigate with view-relative paths ('/uploads', '/alerts', ...).
// This wrapper mounts them under /orb/shore or /orb/vessel inside the workplace router.
export function useNavigate() {
  const navigate = useRouterNavigate();
  const base = useOrbBase();
  return useCallback((to, opts) => {
    if (typeof to === 'string' && to.startsWith('/') && to !== ORB_ROOT && !to.startsWith(ORB_ROOT + '/')) {
      return navigate(base + to, opts);
    }
    return navigate(to, opts);
  }, [navigate, base]);
}
