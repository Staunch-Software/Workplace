import { useCallback } from 'react';
import { useNavigate as useRouterNavigate } from 'react-router-dom';

export const ORB_BASE = '/orb';

// ORB pages navigate with module-relative paths ('/uploads', '/alerts', ...).
// This wrapper mounts them under /orb inside the workplace router.
export function useNavigate() {
  const navigate = useRouterNavigate();
  return useCallback((to, opts) => {
    if (typeof to === 'string' && to.startsWith('/') && to !== ORB_BASE && !to.startsWith(ORB_BASE + '/')) {
      return navigate(ORB_BASE + to, opts);
    }
    return navigate(to, opts);
  }, [navigate]);
}
