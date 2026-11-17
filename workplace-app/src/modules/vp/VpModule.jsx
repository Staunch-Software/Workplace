// src/modules/vp/VpModule.jsx
// Vessel Performance dashboard. Opens in its own tab (like ORB) and owns the whole window; page
// navigation inside it is by state, so the address stays /vp. Every style of the module is scoped to
// .vp-root (see postcss.config.js), so nothing leaks into the rest of the workplace.
import React, { useEffect, useState } from 'react'
import { useAuth as useWorkplaceAuth } from '@/context/AuthContext'
import './index.css'
import App from './App'
import { loadMaplibre } from './utils/loadMaplibre'

export default function VpModule() {
  const { user } = useWorkplaceAuth()
  const [ready, setReady] = useState(false)
  const allowed = user?.role === 'ADMIN' || (user?.role === 'SHORE' && user?.permissions?.vessel_performance === true)

  useEffect(() => {
    if (!allowed) return undefined
    const title = document.title
    document.title = 'Vessel Performance'
    loadMaplibre().finally(() => setReady(true))
    return () => { document.title = title }
  }, [allowed])

  if (!allowed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 8, fontFamily: 'Inter, sans-serif' }}>
        <h2 style={{ margin: 0 }}>Access not granted</h2>
        <p style={{ margin: 0, color: '#64748b' }}>You do not have access to Vessel Performance. Please ask an administrator.</p>
        <a href="/dashboard">Back to Workplace</a>
      </div>
    )
  }

  return (
    <div className="vp-root">
      {ready ? <App /> : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16, color: '#64748b' }}>
          <div style={{ width: 36, height: 36, border: '3px solid #1e3a5f', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13 }}>Loading Vessel Performance…</span>
        </div>
      )}
    </div>
  )
}
