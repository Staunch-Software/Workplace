import { useAuth } from '@/context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function VesselHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <header style={{ background: '#1A3C5E', color: 'white', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#E8610A', fontWeight: 700, fontSize: 20 }}>ozellar</span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Help Center</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.vessels?.[0]?.name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{user?.full_name}</div>
        </div>
        <button onClick={() => { logout(); navigate('/login') }}
          style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.2)', background: 'none', padding: '4px 12px', borderRadius: 8, cursor: 'pointer' }}>
          Logout
        </button>
      </div>
    </header>
  )
}
