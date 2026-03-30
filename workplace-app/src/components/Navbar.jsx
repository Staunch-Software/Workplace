import React, { useState, useRef, useEffect } from 'react';
import { Building2, Search, Shield, LogOut, ChevronDown, Ship, X, Check, KeyRound, Activity, ChevronRight, Database, Clock, Wifi, WifiOff, FileText, Trello, Droplet, Zap } from "lucide-react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import './Navbar.css';

// ── Module metadata keyed by backend permission key ───────────────────────────
const MODULE_META = {
    drs: { label: 'DRS', icon: <FileText size={13} />, color: '#3b82f6' },
    jira: { label: 'SmartPAL JIRA', icon: <Trello size={13} />, color: '#f97316' },
    voyage: { label: 'Voyage Performance', icon: <Ship size={13} />, color: '#8b5cf6' },
    lubeoil: { label: 'Lubeoil Analysis', icon: <Droplet size={13} />, color: '#06b6d4' },
    engine_performance: { label: 'Engine Performance', icon: <Zap size={13} />, color: '#22c55e' },
};

// ── Vessel Status Modal ────────────────────────────────────────────────────────
const VesselStatusModal = ({ onClose, assignedVessels = [], userPermissions = {} }) => {
    const [vessels, setVessels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedImo, setExpandedImo] = useState(null);
    const rowRefs = useRef({});
    const allowedKeys = Object.keys(userPermissions).filter(k => userPermissions[k] === true);

    useEffect(() => {
        // Backend should return:
        // [{ imo, name, online, last_sync, modules: [{ key: 'drs', available: true }, ...] }]
        const fetchStatuses = async () => {
            try {
                const res = await api.get('/vessels/status');
                const filtered = res.data.map(v => ({
                    ...v,
                    modules: (v.modules || []).filter(m => allowedKeys.includes(m.key)),
                }));
                setVessels(filtered);
            } catch {
                // Mock fallback — uses permission keys matching MODULE_META
                setVessels(
                    assignedVessels.map((imo, idx) => ({
                        imo,
                        name: `Vessel ${idx + 1}`,
                        online: idx % 2 === 0,
                        last_sync: idx % 2 === 0 ? new Date(Date.now() - 1000 * 60 * 15).toISOString() : new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
                        modules: allowedKeys.map((key, i) => ({
                            key,
                            available: i % 2 === 0,
                        })),
                    }))
                );
            } finally {
                setLoading(false);
            }
        };
        fetchStatuses();
    }, [userPermissions]);


    const formatSync = (iso) => {
        if (!iso) return 'Never';
        const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    const handleToggle = (imo) => {                      // 👈 add this handler
        const next = expandedImo === imo ? null : imo;
        setExpandedImo(next);
        if (next) {
            setTimeout(() => {
                rowRefs.current[next]?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',                    // scrolls minimally — only if needed
                });
            }, 50); // small delay lets the DOM expand first
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <div style={{
                background: 'var(--white)', borderRadius: 18,
                width: 520, maxHeight: '82vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px',
                    borderBottom: '1px solid var(--gray-200)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, var(--primary-light) 0%, var(--white) 100%)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Activity size={18} color="white" />
                        </div>
                        <div>
                            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--gray-900)' }}>Vessel Status</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: 1 }}>
                                {vessels.length} assigned vessel{vessels.length !== 1 ? 's' : ''}
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: 4, borderRadius: 6 }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ overflowY: 'auto', padding: '14px 20px', flex: 1 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--gray-400)', fontSize: '0.875rem' }}>
                            Loading vessel status…
                        </div>
                    ) : vessels.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--gray-400)', fontSize: '0.875rem' }}>
                            No vessels assigned.
                        </div>
                    ) : (
                        vessels.map((v) => {
                            const isExpanded = expandedImo === v.imo;
                            const availableCount = (v.modules || []).filter(m => m.available).length;

                            return (
                                <div key={v.imo}
                                    ref={el => rowRefs.current[v.imo] = el}
                                    style={{
                                        border: `1px solid ${isExpanded ? 'var(--primary)' : 'var(--gray-200)'}`,
                                        borderRadius: 12, marginBottom: 10,
                                        overflow: 'hidden',
                                        transition: 'border-color 0.2s',
                                        boxShadow: isExpanded ? '0 0 0 3px var(--primary-light)' : 'none',
                                    }}>
                                    {/* Vessel Row */}
                                    <div
                                        onClick={() => handleToggle(v.imo)}
                                        style={{
                                            padding: '14px 16px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            cursor: 'pointer',
                                            background: isExpanded ? 'var(--primary-light)' : 'var(--white)',
                                            transition: 'background 0.15s',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            {/* Ship icon box instead of status dot */}
                                            <div style={{
                                                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                                                background: isExpanded ? 'var(--primary)' : 'var(--gray-100)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                transition: 'background 0.15s',
                                            }}>
                                                <Ship size={16} color={isExpanded ? 'white' : 'var(--gray-500)'} />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--gray-900)' }}>
                                                    {v.name}
                                                </div>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--gray-500)', marginTop: 2 }}>
                                                    IMO: {v.imo}
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{
                                                fontSize: '0.72rem', padding: '3px 8px', borderRadius: 20,
                                                background: 'var(--gray-100)', color: 'var(--gray-600)',
                                                display: 'flex', alignItems: 'center', gap: 4,
                                            }}>
                                                <Database size={11} />
                                                {availableCount}/{(v.modules || []).length} modules
                                            </div>
                                            <ChevronRight size={15} color="var(--gray-400)"
                                                style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                                        </div>
                                    </div>

                                    {/* Expanded Panel */}
                                    {isExpanded && (
                                        <div style={{
                                            borderTop: '1px solid var(--gray-200)',
                                            padding: '16px',
                                            background: '#fafafa',
                                            animation: 'fadeSlideIn 0.18s ease',
                                        }}>
                                            {/* Last Sync */}
                                            {/* Connection & Sync Info */}
                                            <div style={{
                                                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                                                gap: 8, marginBottom: 14,
                                            }}>
                                                {[
                                                    // {
                                                    //     label: 'Last Sync',
                                                    //     value: v.last_sync,
                                                    //     icon: <Wifi size={13} color={v.online ? '#16a34a' : 'var(--gray-400)'} />,
                                                    //     bg: v.online ? 'rgba(34,197,94,0.08)' : 'var(--gray-100)',
                                                    // },
                                                    {
                                                        label: 'Last Push',
                                                        value: v.last_push_at,
                                                        icon: <Clock size={13} color="#16a34a" />,
                                                        bg: 'rgba(34,197,94,0.08)',
                                                    },
                                                    {
                                                        label: 'Last Pull',
                                                        value: v.last_pull_at,
                                                        icon: <Clock size={13} color="#16a34a" />,
                                                        bg: 'rgba(34,197,94,0.08)',
                                                    },
                                                ].map(({ label, value, icon, bg }) => (
                                                    <div key={label} style={{
                                                        padding: '10px 12px', borderRadius: 9,
                                                        background: bg,
                                                        border: '1px solid var(--gray-200)',
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                                            {icon}
                                                            <span style={{ fontSize: '0.7rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                                                                {label}
                                                            </span>
                                                        </div>
                                                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-800)' }}>
                                                            {formatSync(value)}
                                                        </div>
                                                        {value && (
                                                            <div style={{ fontSize: '0.67rem', color: 'var(--gray-400)', marginTop: 2 }}>
                                                                {new Date(value).toLocaleString()}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Modules */}
                                            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                                                Available Modules
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                                                {(v.modules || []).map((mod) => {
                                                    const meta = MODULE_META[mod.key] ?? { label: mod.key, icon: <Database size={13} />, color: '#6b7280' };
                                                    return (
                                                        <div key={mod.key} style={{
                                                            display: 'flex', alignItems: 'center', gap: 8,
                                                            padding: '8px 10px', borderRadius: 8,
                                                            background: mod.available ? `${meta.color}12` : 'var(--gray-100)',
                                                            border: `1px solid ${mod.available ? `${meta.color}33` : 'var(--gray-200)'}`,
                                                            cursor: mod.available ? 'default' : 'not-allowed',   // 👈 shows not-allowed cursor
                                                        }}
                                                            title={mod.available ? `${meta.label} is available` : `${meta.label} is not available on this vessel`}  // 👈 native tooltip
                                                        >
                                                            <div style={{
                                                                width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                                                                background: mod.available ? `${meta.color}20` : 'var(--gray-200)',
                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                color: mod.available ? meta.color : 'var(--gray-400)',
                                                            }}>
                                                                {meta.icon}
                                                            </div>
                                                            <span style={{
                                                                fontSize: '0.75rem', fontWeight: 500,
                                                                color: mod.available ? 'var(--gray-800)' : 'var(--gray-400)',
                                                                lineHeight: 1.2,
                                                            }}>
                                                                {meta.label}
                                                            </span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '14px 24px', borderTop: '1px solid var(--gray-200)',
                    display: 'flex', justifyContent: 'flex-end',
                }}>
                    <button onClick={onClose} style={{
                        padding: '8px 20px', borderRadius: 8,
                        border: '1px solid var(--gray-200)', background: 'var(--white)',
                        cursor: 'pointer', fontSize: '0.875rem', color: 'var(--gray-700)',
                        fontWeight: 500,
                    }}>
                        Close
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeSlideIn {
                    from { opacity: 0; transform: translateY(-6px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
};

// ── Main Navbar ────────────────────────────────────────────────────────────────
const Navbar = () => {
    const { user, logout, setUser } = useAuth();
    const navigate = useNavigate();
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [vesselPickerOpen, setVesselPickerOpen] = useState(false);
    const [vesselStatusOpen, setVesselStatusOpen] = useState(false);
    const [allVessels, setAllVessels] = useState([]);
    const [selectedImos, setSelectedImos] = useState([]);
    const [saving, setSaving] = useState(false);
    const dropdownRef = useRef(null);

    const [changePasswordOpen, setChangePasswordOpen] = useState(false);
    const [cpForm, setCpForm] = useState({ old_password: '', new_password: '', confirm: '' });
    const [cpError, setCpError] = useState('');
    const [cpSuccess, setCpSuccess] = useState(false);
    const [cpLoading, setCpLoading] = useState(false);

    const handleChangePassword = async () => {
        setCpError('');
        if (cpForm.new_password !== cpForm.confirm) { setCpError('Passwords do not match'); return; }
        if (cpForm.new_password.length < 8) { setCpError('Minimum 8 characters'); return; }
        setCpLoading(true);
        try {
            await api.post('/users/me/change-password', {
                old_password: cpForm.old_password,
                new_password: cpForm.new_password,
            });
            setCpSuccess(true);
            setTimeout(() => { setChangePasswordOpen(false); setCpSuccess(false); setCpForm({ old_password: '', new_password: '', confirm: '' }); }, 2000);
        } catch (err) {
            setCpError(err.response?.data?.detail || 'Failed to change password');
        } finally {
            setCpLoading(false);
        }
    };

    useEffect(() => {
        const handler = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleLogout = () => { logout(); navigate('/login'); };
    const handleAdminPanel = () => { setDropdownOpen(false); navigate('/admin/users'); };

    const openVesselPicker = async () => {
        setDropdownOpen(false);
        try {
            const res = await api.get('/vessels');
            setAllVessels(res.data);
            setSelectedImos(user?.assigned_vessels ?? []);
            setVesselPickerOpen(true);
        } catch (err) {
            console.error('Failed to load vessels', err);
        }
    };

    const openVesselStatus = () => {
        setDropdownOpen(false);
        setVesselStatusOpen(true);
    };

    const handleSaveVessels = async () => {
        setSaving(true);
        try {
            await api.patch('/users/me/vessels', selectedImos);
            const updatedUser = { ...user, assigned_vessels: selectedImos };
            localStorage.setItem('platform_user', JSON.stringify(updatedUser));
            setUser(updatedUser);
            setVesselPickerOpen(false);
        } catch (err) {
            alert('Failed to save vessel assignments');
        } finally {
            setSaving(false);
        }
    };

    const toggleImo = (imo) =>
        setSelectedImos(prev =>
            prev.includes(imo) ? prev.filter(i => i !== imo) : [...prev, imo]
        );

    const initials = user?.full_name
        ? user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        : 'U';

    return (
        <>
            <nav className="navbar">
                <div className="nav-container">
                    <div className="nav-left">
                        <div className="logo-icon">
                            <Building2 size={24} />
                        </div>
                        <span className="brand-name">Workplace</span>
                        {user?.role === 'VESSEL' && user?.assigned_vessel_names?.length > 0 && (
                            <div style={{
                                marginLeft: '16px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: 'var(--primary-light)',
                                border: '1px solid var(--primary)',
                                borderRadius: '20px',
                                padding: '3px 10px',
                                fontSize: '0.75rem',
                                fontWeight: 500,
                                color: 'var(--primary)',
                            }}>
                                <Ship size={12} />
                                {user.assigned_vessel_names.join(', ')}
                            </div>
                        )}
                    </div>

                    <div className="nav-right">
                        <div className="search-wrapper">
                            <Search className="search-icon" size={18} />
                            <input type="text" placeholder="Search..." className="search-input" />
                        </div>

                        <div className="divider"></div>

                        <div className="profile-wrapper" ref={dropdownRef}>
                            <button
                                className="profile-btn"
                                onClick={() => setDropdownOpen(prev => !prev)}
                            >
                                <div className="avatar">{initials}</div>
                                <span className="profile-name">{user?.full_name ?? 'User'}</span>
                                <ChevronDown size={14} className={`chevron ${dropdownOpen ? 'open' : ''}`} />
                            </button>

                            {dropdownOpen && (
                                <div className="dn-profile-dropdown">
                                    <div className="dropdown-user-info">
                                        <div className="dropdown-avatar">{initials}</div>
                                        <div>
                                            <div className="dropdown-name">{user?.full_name}</div>
                                            <div className="dropdown-email">{user?.email}</div>
                                            <div className="dropdown-role">{user?.role}</div>
                                        </div>
                                    </div>

                                    <div className="dropdown-divider" />

                                    {user?.role === 'ADMIN' && (
                                        <button className="dropdown-item" onClick={handleAdminPanel}>
                                            <Shield size={15} /> Admin Panel
                                        </button>
                                    )}

                                    {user?.can_self_assign_vessels && (
                                        <button className="dropdown-item" onClick={openVesselPicker}>
                                            <Ship size={15} /> My Vessels
                                        </button>
                                    )}

                                    {/* ── NEW: Vessel Status ── */}
                                    {user?.assigned_vessels?.length > 0 && (
                                        <button className="dropdown-item" onClick={openVesselStatus}>
                                            <Activity size={15} /> Vessel Status
                                        </button>
                                    )}

                                    <button className="dropdown-item" onClick={() => { setDropdownOpen(false); setChangePasswordOpen(true); }}>
                                        <KeyRound size={15} /> Change Password
                                    </button>

                                    <button className="dropdown-item danger" onClick={handleLogout}>
                                        <LogOut size={15} /> Logout
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </nav>

            {/* Vessel Picker Modal */}
            {vesselPickerOpen && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: 'var(--white)', borderRadius: 16,
                        width: 480, maxHeight: '80vh',
                        display: 'flex', flexDirection: 'column',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
                    }}>
                        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--gray-900)' }}>My Vessels</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)', marginTop: 2 }}>Select vessels you want access to</div>
                            </div>
                            <button onClick={() => setVesselPickerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', padding: 4 }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ overflowY: 'auto', padding: '12px 24px', flex: 1 }}>
                            {allVessels.map(v => (
                                <div
                                    key={v.imo}
                                    onClick={() => toggleImo(v.imo)}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 6,
                                        border: `1px solid ${selectedImos.includes(v.imo) ? 'var(--primary)' : 'var(--gray-200)'}`,
                                        background: selectedImos.includes(v.imo) ? 'var(--primary-light)' : 'var(--white)',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--gray-900)' }}>{v.name}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: 2 }}>IMO: {v.imo} · {(v.vessel_type || '').replace(/_/g, ' ')}</div>
                                    </div>
                                    {selectedImos.includes(v.imo) && (
                                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Check size={12} color="white" />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--gray-200)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => setVesselPickerOpen(false)}
                                style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--gray-200)', background: 'var(--white)', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--gray-700)' }}>
                                Cancel
                            </button>
                            <button onClick={handleSaveVessels} disabled={saving}
                                style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}>
                                {saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Vessel Status Modal */}
            {vesselStatusOpen && (
                <VesselStatusModal
                    onClose={() => setVesselStatusOpen(false)}
                    assignedVessels={user?.assigned_vessels ?? []}
                    userPermissions={user?.permissions ?? {}}
                />
            )}

            {/* Change Password Modal */}
            {changePasswordOpen && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--white)', borderRadius: 16, width: 420, padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--gray-900)' }}>Change Password</h2>
                            <button onClick={() => { setChangePasswordOpen(false); setCpError(''); setCpForm({ old_password: '', new_password: '', confirm: '' }); }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)' }}><X size={20} /></button>
                        </div>
                        {cpSuccess ? (
                            <div style={{ textAlign: 'center', padding: '20px 0' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>✅</div>
                                <p style={{ color: 'var(--gray-700)', fontWeight: 600 }}>Password changed successfully!</p>
                            </div>
                        ) : (
                            <>
                                {['old_password', 'new_password', 'confirm'].map((field, i) => (
                                    <div key={field} style={{ marginBottom: 14 }}>
                                        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
                                            {['Current Password', 'New Password', 'Confirm New Password'][i]}
                                        </label>
                                        <input type="password" value={cpForm[field]}
                                            onChange={e => setCpForm({ ...cpForm, [field]: e.target.value })}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--gray-300)', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                    </div>
                                ))}
                                {cpError && <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: 12 }}>{cpError}</p>}
                                <button onClick={handleChangePassword} disabled={cpLoading}
                                    style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', fontWeight: 600, cursor: 'pointer', fontSize: '0.875rem' }}>
                                    {cpLoading ? 'Saving...' : 'Update Password'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default Navbar;