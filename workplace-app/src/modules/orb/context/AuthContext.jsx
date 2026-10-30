import { useAuth as useWorkplaceAuth } from '@/context/AuthContext';

// Adapter so the ported ORB pages keep calling useAuth() unchanged.
// Login/logout and the user itself come from the workplace app.
export function useAuth() {
  const { user, logout } = useWorkplaceAuth();
  const orbUser = user
    ? { ...user, name: user.full_name || user.name || user.email, role: user.role }
    : null;
  const isVessel = user?.role === 'VESSEL';
  return {
    user: orbUser,
    logout,
    isAdmin: user?.role === 'ADMIN',
    isVessel,                       // ship user: Vessel View
    isShore: !!user && !isVessel,   // SHORE or ADMIN: Shore View
  };
}
