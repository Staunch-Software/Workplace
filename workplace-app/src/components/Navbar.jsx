import React, { useState, useRef, useEffect } from 'react';
import { Building2, Search, Shield, LogOut, ChevronDown, Ship, X, Check, KeyRound, Activity, ChevronRight, Database, Clock, Wifi, WifiOff, FileText, Trello, Droplet, Zap, AlertCircle, Terminal, RefreshCw, ArrowUpRight, ArrowDownLeft, CheckCircle, Ship as ShipIcon, BookOpen } from "lucide-react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getVesselStatus } from '../pages/admin/lib/adminApi';
import './Navbar.css';
import apiDrs from '../modules/drs/api/axiosDrs';
import axiosJira from '../modules/jira/api/axiosJira';
import api from '../api/axios';
import apiLuboil from '../modules/lubeoil/api/axiosLub';


// ── Module metadata keyed by backend permission key ───────────────────────────
const THEME = {
    primary: '#6366f1',
    success: '#10b981',
    danger: '#f43f5e',
    warning: '#f59e0b',
    surface: '#ffffff',
    background: '#f8fafc',
    border: '#e2e8f0',
    textMain: '#0f172a',
    textMuted: '#64748b'
};

const MODULE_META = {
    drs: { label: 'DRS (Defects)', icon: <FileText size={14} />, color: '#3b82f6' },
    jira: { label: 'JIRA Sync', icon: <Trello size={14} />, color: '#f97316' },
    voyage: { label: 'Voyage Perf', icon: <Ship size={14} />, color: '#8b5cf6' },
    lubeoil: { label: 'Lube Analysis', icon: <Droplet size={14} />, color: '#06b6d4' },
    engine_performance: { label: 'Engine Perf', icon: <Zap size={14} />, color: '#22c55e' },
};
function formatAgo(iso) {
    if (!iso) return 'Never';
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function ageClass(iso) {
    if (!iso) return 'never';
    const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
    if (h < 1) return 'fresh';
    if (h < 12) return 'stale';
    return 'old';
}

const SYNC_COLORS = {
    fresh: { bg: '#EAF3DE', border: '#C0DD97', text: '#3B6D11' },
    stale: { bg: '#FAEEDA', border: '#FAC775', text: '#854F0B' },
    old: { bg: '#FCEBEB', border: '#F7C1C1', text: '#A32D2D' },
    never: { bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8' },
};

const LiveModuleDetail = ({ imo, moduleKey, isInstalled }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchSyncData = async () => {
    if (!imo || !isInstalled) {
        setLoading(false);
        return;
    }

    try {
        if (moduleKey === 'drs') {
            const res = await apiDrs.get(`/vessels/${imo}/sync-log`);
            setData(res.data);

        } else if (moduleKey === 'lubeoil') {
            const res = await apiLuboil.get(`api/vessels/${imo}/sync-log`);
            setData(res.data);

        } else {
            setData(null);
        }
    } catch (err) {
        console.error("Sync log fetch failed", err);
    } finally {
        setLoading(false);
    }
};

    useEffect(() => {
        setLoading(true);
        fetchSyncData();
        const interval = setInterval(fetchSyncData, 30000); // 30s Polling
        return () => clearInterval(interval);
    }, [imo, moduleKey, isInstalled]);

    if (!isInstalled) return (
        <div style={mStyles.notInstalledBox}>
            <Activity size={40} color="#cbd5e1" />
            <h3 style={{ color: THEME.textMuted, margin: '15px 0 5px' }}>Module Not Configured</h3>
            <p style={{ color: THEME.textMuted, fontSize: '13px' }}>This application is not installed on this vessel.</p>
        </div>
    );

    if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><RefreshCw className="spin" color={THEME.primary} /></div>;

    const activeErrors = data?.active_errors || [];

    return (
        <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div className='fsize-15' style={mStyles.sectionLabel}>{moduleKey.toUpperCase()} Sync Statistics</div>
            <div style={mStyles.statsRow}>
                <div style={mStyles.statBox}>
                    <div className='fsize-15' style={mStyles.statLabel}><ArrowUpRight size={14} /> Vessel → Shore (Push)</div>
                    <div className='fsize-20' style={{ fontSize: '16px', fontWeight: 800, color: data?.vessel_reported_push ? THEME.success : THEME.danger }}>
                        {data?.vessel_reported_push ? new Date(data.vessel_reported_push).toLocaleString() : 'Never Synced'}
                    </div>
                </div>
                <div style={mStyles.statBox}>
                    <div className='fsize-15' style={mStyles.statLabel}><ArrowDownLeft size={14} /> Shore → Vessel (Pull)</div>
                    <div className='fsize-20' style={{ fontSize: '16px', fontWeight: 800, color: data?.vessel_reported_pull ? THEME.success : THEME.danger }}>
                        {data?.vessel_reported_pull ? new Date(data.vessel_reported_pull).toLocaleString() : 'Never Synced'}
                    </div>
                </div>
            </div>

            <div className='fsize-15' style={{ ...mStyles.sectionLabel, marginTop: 30 }}>Current Active Issues</div>
            {activeErrors.length === 0 ? (
                <div style={mStyles.emptyState}>
                    <CheckCircle size={32} color={THEME.success} />
                    <span style={{ fontWeight: 600, color: THEME.textMain }}>All data synchronized</span>
                    <span className='fsize-16' style={{ fontSize: '12px' }}>No active sync errors found for this module.</span>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {activeErrors.map((err, i) => (
                        <div key={i} style={mStyles.normalErrorCard}>
                            <div className='fsize-15' style={mStyles.errCardHeader}>
                                <span style={{ fontWeight: 800, color: '#b91c1c' }}>{err.entity?.toUpperCase()} ERROR</span>
                                <span style={{ color: THEME.textMuted }}>{new Date(err.ts).toLocaleTimeString()}</span>
                            </div>
                            <div className='fsize-17' style={mStyles.errCardBody}>{err.msg}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const VesselStatusModal = ({ onClose, userPermissions = {} }) => {
    const [vessels, setVessels] = useState([]);
    const [selectedVessel, setSelectedVessel] = useState(null);
    const [selectedModule, setSelectedModule] = useState('drs');
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [drsErrors, setDrsErrors] = useState({});

    useEffect(() => {

        // Load vessels from Core
        getVesselStatus().then(res => {
            setVessels(res.data || []);
            if (res.data?.length > 0)
                setSelectedVessel(res.data[0]);
            setLoading(false);
        });

        // Load DRS error summary
        apiDrs.get("/vessels/sync-status/all")
            .then(res => {
                setDrsErrors(res.data || {});
            })
            .catch(err => {
                console.error("Failed to load DRS errors", err);
            });

    }, []);

    useEffect(() => {

        const loadErrors = () => {

            apiDrs.get("/vessels/sync-status/all")
                .then(res => {
                    setDrsErrors(res.data || {});
                })
                .catch(err => {
                    console.error("Failed to load DRS errors", err);
                });

        };

        loadErrors();

        const interval =
            setInterval(loadErrors, 30000);

        return () =>
            clearInterval(interval);

    }, []);

    const filteredVessels = vessels.filter(v => {

        const matchesSearch =
            v.name.toLowerCase()
                .includes(search.toLowerCase());

        if (filter === 'live')
            return v.online && matchesSearch;

        if (filter === 'errors') {

            const errCount =
                drsErrors[v.imo]?.failed_items_count || 0;

            return errCount > 0 && matchesSearch;
        }

        return matchesSearch;
    });

    return (
        <div style={mStyles.overlay}>
            <div style={mStyles.modalContainer}>

                {/* --- Sidebar: Vessel List --- */}
                <div style={mStyles.sidebar}>
                    <div style={mStyles.sidebarHeader}>
                        <div style={mStyles.searchBox}>
                            <Search size={14} color={THEME.textMuted} />
                            <input placeholder="Search vessels..." className='fsize-18' style={mStyles.searchInput} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <div style={mStyles.pillRow}>
                            <button onClick={() => setFilter('all')} className='fsize-16' style={{ ...mStyles.pill, background: filter === 'all' ? THEME.primary : '#fff', color: filter === 'all' ? '#fff' : THEME.textMuted, borderColor: filter === 'all' ? THEME.primary : THEME.border }}>All</button>
                            <button onClick={() => setFilter('live')} className='fsize-16' style={{ ...mStyles.pill, background: filter === 'live' ? THEME.success : '#fff', color: filter === 'live' ? '#fff' : THEME.textMuted, borderColor: filter === 'live' ? THEME.success : THEME.border }}>Live</button>
                            <button onClick={() => setFilter('errors')} className='fsize-16' style={{ ...mStyles.pill, background: filter === 'errors' ? THEME.danger : '#fff', color: filter === 'errors' ? '#fff' : THEME.textMuted, borderColor: filter === 'errors' ? THEME.danger : THEME.border }}>Errors</button>
                        </div>
                    </div>

                    <div style={mStyles.listArea}>
                        {filteredVessels.map(v => {
                            const isSel = selectedVessel?.imo === v.imo;
                            return (
                                <div key={v.imo} onClick={() => setSelectedVessel(v)} style={{
                                    ...mStyles.vesselItem,
                                    backgroundColor: isSel ? '#f0f7ff' : 'transparent',
                                    borderLeft: `4px solid ${isSel ? THEME.primary : 'transparent'}`
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={mStyles.statusCircle}>
                                            <ShipIcon size={18} color={v.online ? THEME.success : THEME.textMuted} />
                                            {v.online && <div className="pulse-dot" style={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, background: THEME.success, borderRadius: '50%', border: '2px solid #fff' }} />}
                                        </div>
                                        <div>
                                            <div className='fsize-18' style={{ fontSize: '14px', fontWeight: 700, color: THEME.textMain }}>{v.name}</div>
                                            <div className='fsize-15' style={{ fontSize: '11px', color: THEME.textMuted }}>IMO {v.imo}</div>
                                        </div>
                                    </div>
                                    {(drsErrors[v.imo]?.failed_items_count || 0) > 0 && (
                                        <AlertCircle
                                            size={16}
                                            color={THEME.danger}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* --- Main Console: Module Detail --- */}
                <div style={mStyles.contentPane}>
                    <header style={mStyles.contentHeader}>
                        <div>
                            <h2 className='fsize-24' style={{ margin: 0, fontSize: '20px', fontWeight: 800 }}>{selectedVessel?.name}</h2>
                            <div className='fsize-15' style={{ display: 'flex', gap: 12, fontSize: '11px', marginTop: 4, fontWeight: 600 }}>
                                <span style={{ color: selectedVessel?.online ? THEME.success : THEME.textMuted }}>
                                    {selectedVessel?.online ? '● LIVE CONNECTION' : '○ OFFLINE'}
                                </span>
                                <span style={{ color: THEME.border }}>|</span>
                                <span style={{ color: THEME.textMuted }}>IMO: {selectedVessel?.imo}</span>
                            </div>
                        </div>
                        <button onClick={onClose} style={mStyles.closeBtn}><X size={20} /></button>
                    </header>

                    <div style={{ padding: '30px', overflowY: 'auto', flex: 1 }}>
                        <div className='fsize-15' style={mStyles.sectionLabel}>Installed Applications</div>
                        <div style={mStyles.moduleGrid}>
                            {Object.entries(MODULE_META).map(([key, meta]) => {
                                const isInstalled = selectedVessel?.modules?.find(m => m.key === key)?.available;
                                const isActive = selectedModule === key;
                                return (
                                    <div key={key} onClick={() => isInstalled && setSelectedModule(key)} style={{
                                        ...mStyles.moduleCard,
                                        borderColor: isActive ? THEME.primary : THEME.border,
                                        background: isActive ? '#f5f3ff' : '#fff',
                                        cursor: isInstalled ? 'pointer' : 'default',
                                        opacity: isInstalled ? 1 : 0.4
                                    }}>
                                        <div style={{ color: isInstalled ? meta.color : THEME.textMuted }}>{meta.icon}</div>
                                        <div className='fsize-15' style={{ fontSize: '11px', fontWeight: 800, marginTop: 10, textAlign: 'center', color: isInstalled ? THEME.textMain : THEME.textMuted }}>{meta.label}</div>
                                        <div className='fsize-13' style={{
                                            marginTop: 6, fontSize: '9px', fontWeight: 900,
                                            color: isInstalled ? THEME.success : THEME.textMuted,
                                            background: isInstalled ? '#ecfdf5' : '#f1f5f9',
                                            padding: '2px 8px', borderRadius: '4px'
                                        }}>
                                            {isInstalled ? 'INSTALLED' : 'N/A'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <LiveModuleDetail
                            imo={selectedVessel?.imo_number || selectedVessel?.imo}
                            moduleKey={selectedModule}
                            isInstalled={selectedVessel?.modules?.find(m => m.key === selectedModule)?.available}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
const mStyles = {
    overlay: { position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modalContainer: { background: '#fff', width: '1000px', height: '85vh', borderRadius: '28px', display: 'flex', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' },

    // Sidebar (Left)
    sidebar: { width: '320px', borderRight: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', background: '#fcfcfd' },
    sidebarHeader: { padding: '25px 20px', borderBottom: '1px solid #e2e8f0', background: '#fff' },
    searchBox: { display: 'flex', alignItems: 'center', gap: 8, background: '#f1f5f9', padding: '10px 14px', borderRadius: '12px', marginBottom: '15px' },
    searchInput: { border: 'none', background: 'transparent', outline: 'none', fontSize: '14px', width: '100%', fontWeight: 500 },
    pillRow: { display: 'flex', gap: 6 },
    pill: { flex: 1, border: '1px solid', padding: '6px 0', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', transition: '0.2s' },
    listArea: { flex: 1, overflowY: 'auto', padding: '12px' },
    vesselItem: { padding: '15px', borderRadius: '14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', transition: '0.2s' },
    statusCircle: { position: 'relative', width: 40, height: 40, borderRadius: '12px', background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center' },

    // Content (Right)
    contentPane: { flex: 1, display: 'flex', flexDirection: 'column', background: '#fff' },
    contentHeader: { padding: '25px 35px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    closeBtn: { border: 'none', background: '#f1f5f9', padding: '10px', borderRadius: '12px', cursor: 'pointer' },
    sectionLabel: { fontSize: '11px', fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '18px', letterSpacing: '1.5px' },

    moduleGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px', marginBottom: '35px' },
    moduleCard: { padding: '20px 10px', borderRadius: '20px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: '0.2s' },

    statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' },
    statBox: { padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0', background: '#f8fafc' },
    statLabel: { fontSize: '11px', fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 },

    normalErrorCard: { background: '#fff', border: '1px solid #fecdd3', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' },
    errCardHeader: { padding: '10px 18px', background: '#fff1f2', borderBottom: '1px solid #fecdd3', display: 'flex', justifyContent: 'space-between', fontSize: '11px' },
    errCardBody: { padding: '15px 18px', fontSize: '13px', color: '#334155', lineHeight: '1.6', fontFamily: 'monospace', wordBreak: 'break-all' },

    emptyState: { padding: '50px', textAlign: 'center', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, border: '2px dashed #e2e8f0', borderRadius: '20px' },
    notInstalledBox: { padding: '80px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', border: '1px solid #f1f5f9', borderRadius: '24px', background: '#fafbfc' },
};


// ── Main Navbar ────────────────────────────────────────────────────────────────
const Navbar = ({ setSearchQuery }) => {
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
                            <input type="text" placeholder="Search..." className="search-input" onChange={e => setSearchQuery(e.target.value)} />
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

                                    <button className="dropdown-item" onClick={() => { setDropdownOpen(false); navigate('/help'); }}>
                                        <BookOpen size={15} /> User Guide
                                    </button>

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
                    <div className='width-500' style={{ background: 'var(--white)', borderRadius: 16, width: 420, padding: 32, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <h2 className='fsize-21' style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--gray-900)' }}>Change Password</h2>
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
                                        <label className='fsize-16' style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-600)', display: 'block', marginBottom: 4 }}>
                                            {['Current Password', 'New Password', 'Confirm New Password'][i]}
                                        </label>
                                        <input type="password" value={cpForm[field]}
                                            onChange={e => setCpForm({ ...cpForm, [field]: e.target.value })}
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--gray-300)', fontSize: '0.875rem', boxSizing: 'border-box' }} />
                                    </div>
                                ))}
                                {cpError && <p className='fsize-16' style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: 12 }}>{cpError}</p>}
                                <button onClick={handleChangePassword} disabled={cpLoading}
                                    className='fsize-16'
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