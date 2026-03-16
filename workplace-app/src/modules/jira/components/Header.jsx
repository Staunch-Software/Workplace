import { useAuth } from '@/context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <header style={{ background: '#1A3C5E', color: 'white', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#E8610A', fontWeight: 700, fontSize: 20 }}>ozellar</span>
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>MA Ticketing Portal</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>{user?.name}</span>
        <span style={{ background: 'rgba(255,255,255,0.2)', fontSize: 11, padding: '2px 10px', borderRadius: 999 }}>{user?.role}</span>
        <button onClick={() => { logout(); navigate('/') }}
          style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer' }}>
          Logout
        </button>
      </div>
    </header>
  )
}
