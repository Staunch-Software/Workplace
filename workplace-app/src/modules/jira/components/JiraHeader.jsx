// workplace-app/src/modules/jira/components/JiraHeader.jsx
// Mirrors DRS ShoreLayout/VesselLayout header pattern exactly.
// - 9-dot button → /dashboard
// - Brand: ozellar + "MA Ticketing Portal"
// - Right: user pill → dropdown with Back to Dashboard + Logout

import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { ArrowLeft, LogOut, ChevronLeft } from 'lucide-react'
import './JiraHeader.css'

export default function JiraHeader() {
    const { user, logout } = useAuth()
    const navigate = useNavigate()
    const [showUserMenu, setShowUserMenu] = useState(false)
    const userMenuRef = useRef(null)

    // Close dropdown on outside click
    useEffect(() => {
        function handleClickOutside(e) {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
                setShowUserMenu(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const handleLogout = () => {
        logout()
        navigate('/login')
    }

    const roleBadge = {
        SHORE: 'Shore',
        VESSEL: 'Vessel',
        ADMIN: 'Admin',
    }[user?.role] || user?.role

    return (
        <nav className="jh-nav">
            {/* LEFT */}
            <div className="jh-left">
                {/* 9-dot back button */}
                <button className="jh-nine-dot" onClick={() => navigate('/dashboard')} title="All apps" aria-label="All apps">
                    <div className="jh-dot-grid">
                        {[...Array(9)].map((_, i) => <span key={i} className="jh-dot" />)}
                    </div>
                    <ChevronLeft size={18} className="jh-chevron" />
                </button>

                {/* Brand */}
                <div className="jh-brand">
                    <span className="jh-brand-logo">ozellar</span>
                    <span className="jh-brand-sub">MA Ticketing Portal</span>
                </div>
            </div>

            {/* RIGHT */}
            <div className="jh-right">
                <div className="jh-user-wrap" ref={userMenuRef}>
                    <button
                        className={`jh-user-btn ${showUserMenu ? 'active' : ''}`}
                        onClick={() => setShowUserMenu(v => !v)}
                    >
                        <div className="jh-avatar">
                            {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div className="jh-user-text">
                            <span className="jh-user-name">{user?.full_name || 'User'}</span>
                            <span className="jh-user-role">{user?.job_title || roleBadge}</span>
                        </div>
                    </button>

                    {showUserMenu && (
                        <div className="jh-dropdown">
                            {/* Profile header */}
                            <div className="jh-dropdown-profile">
                                <div className="jh-avatar-lg">
                                    {user?.full_name?.charAt(0)?.toUpperCase() || 'U'}
                                </div>
                                <div className="jh-dropdown-profile-info">
                                    <strong>{user?.full_name}</strong>
                                    <span>{user?.email}</span>
                                    <span className="jh-role-pill">{roleBadge}</span>
                                </div>
                            </div>

                            <div className="jh-divider" />

                            <button className="jh-dropdown-item" onClick={() => { setShowUserMenu(false); navigate('/dashboard') }}>
                                <ArrowLeft size={15} />
                                Back to Dashboard
                            </button>

                            <div className="jh-divider" />

                            <button className="jh-dropdown-item jh-dropdown-logout" onClick={handleLogout}>
                                <LogOut size={15} />
                                Logout
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </nav>
    )
}