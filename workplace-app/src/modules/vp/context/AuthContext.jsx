import { useAuth as useWorkplaceAuth } from '@/context/AuthContext'

// Adapter so the ported Vessel Performance pages keep calling useAuth() unchanged.
// Sign-in, sign-out and the user itself come from the workplace app; access to this module is
// checked there (route guard) and again by the API on every request.
export function useAuth() {
  const { user, logout } = useWorkplaceAuth()
  const isAdmin = user?.role === 'ADMIN'
  const vpUser = user
    ? { id: user.id, username: user.full_name || user.name || user.email, role: isAdmin ? 'admin' : 'user' }
    : null
  return { user: vpUser, logout, isAdmin, isAuthenticated: !!user, loading: false }
}
