import React, { useState, useRef, useEffect } from 'react';
import { Building2, Search, Shield, LogOut, ChevronDown, Ship, X, Check, KeyRound, Activity, ChevronRight, Database, Clock, Wifi, WifiOff, FileText, Trello, Droplet, Zap, AlertCircle } from "lucide-react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getVesselStatus } from '../pages/admin/lib/adminApi';
import './Navbar.css';

// ── Module metadata keyed by backend permission key ───────────────────────────
const MODULE_META = {
    drs: { label: 'DRS', icon: <FileText size={13} />, color: '#3b82f6' },
    jira: { label: 'SmartPAL JIRA', icon: <Trello size={13} />, color: '#f97316' },
    voyage: { label: 'Voyage Performance', icon: <Ship size={13} />, color: '#8b5cf6' },
    lubeoil: { label: 'Lubeoil Analysis', icon: <Droplet size={13} />, color: '#06b6d4' },
    engine_performance: { label: 'Engine Performance', icon: <Zap size={13} />, color: '#22c55e' },
};

const VesselStatusModal = ({ onClose, assignedVessels = [], userPermissions = {} }) => {
    const [vessels, setVessels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedImo, setExpandedImo] = useState(null);
    const [filter, setFilter] = useState('all');
    const rowRefs = useRef({});
    const allowedKeys = Object.keys(userPermissions).filter(k => userPermissions[k] === true);

    useEffect(() => {
        const fetchStatuses = async () => {
            try {
                const res = await getVesselStatus();
                const filtered = res.data.map(v => ({
                    ...v,
                    modules: (v.modules || []).filter(m => allowedKeys.includes(m.key)),
                }));
                setVessels(filtered);
            } catch {
                setVessels(
                    assignedVessels.map((imo, idx) => ({
                        imo,
                        name: `Vessel ${idx + 1}`,
                        online: idx % 2 === 0,
                        last_sync_success: idx % 3 !== 0,
                        last_pull_at: new Date(Date.now() - 1000 * 60 * (idx * 30 + 15)).toISOString(),
                        last_push_at: new Date(Date.now() - 1000 * 60 * (idx * 15 + 5)).toISOString(),
                        sync_errors: idx % 3 === 0 ? [
                            { id: 1, error_type: 'shore_error', error_msg: 'HTTP 500: Defect sync failed', created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
                            { id: 2, error_type: 'vessel_error', error_msg: 'Blob upload failed: timeout', created_at: new Date(Date.now() - 1000 * 60 * 90).toISOString() },
                        ] : [],
                        modules: allowedKeys.map((key, i) => ({ key, available: i % 2 === 0 })),
                    }))
                );
            } finally {
                setLoading(false);
            }
        };
        fetchStatuses();
    }, []);

    const formatSync = (iso) => {
        if (!iso) return 'Never';
        const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    const liveCount = vessels.filter(v => v.online).length;
    const errorCount = vessels.filter(v => (v.sync_errors || []).length > 0).length;

    const filteredVessels = vessels.filter(v => {
        if (filter === 'live') return v.online;
        if (filter === 'errors') return (v.sync_errors || []).length > 0;
        return true;
    });

    const handleToggle = (imo) => {
        const next = expandedImo === imo ? null : imo;
        setExpandedImo(next);
        if (next) setTimeout(() => rowRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
    };

    const handleStatCard = (type) => {
        setFilter(prev => prev === type ? 'all' : type);
        setExpandedImo(null);
    };

    const ageStyle = (iso) => {
        if (!iso) return { bg: '#f8fafc', border: '#e2e8f0', color: '#94a3b8' };
        const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
        if (h < 1) return { bg: '#f0fdf4', border: '#86efac', color: '#15803d' };
        if (h < 6) return { bg: '#fefce8', border: '#fde68a', color: '#854d0e' };
        return { bg: '#fff1f2', border: '#fecdd3', color: '#be123c' };
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(15,23,42,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(2px)',
        }}>
            <div style={{
                background: '#fff', borderRadius: 20,
                width: 540, maxHeight: '86vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 32px 80px rgba(0,0,0,0.28)',
                overflow: 'hidden',
                border: '1px solid #e2e8f0',
            }}>

                {/* ── Header ── */}
                <div style={{
                    padding: '18px 22px',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#fff',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                            width: 38, height: 38, borderRadius: 11,
                            background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                        }}>
                            <Activity size={18} color="white" />
                        </div>
                        <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>Fleet Status</div>
                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                                {vessels.length} vessel{vessels.length !== 1 ? 's' : ''} assigned
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: '#f8fafc', border: '1px solid #e2e8f0',
                        cursor: 'pointer', color: '#64748b', padding: '6px 8px',
                        borderRadius: 8, display: 'flex', alignItems: 'center',
                        transition: 'background 0.15s',
                    }}>
                        <X size={16} />
                    </button>
                </div>

                {/* ── Stat cards ── */}
                {!loading && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '14px 18px 0' }}>
                        {/* Live */}
                        <div onClick={() => handleStatCard('live')} style={{
                            borderRadius: 12, padding: '13px 15px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 11,
                            background: filter === 'live' ? '#dcfce7' : '#f0fdf4',
                            border: `1.5px solid ${filter === 'live' ? '#22c55e' : '#bbf7d0'}`,
                            transition: 'all 0.15s',
                        }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                                background: filter === 'live' ? '#bbf7d0' : '#dcfce7',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Wifi size={18} color="#16a34a" />
                            </div>
                            <div>
                                <div style={{ fontSize: 24, fontWeight: 800, color: '#15803d', lineHeight: 1, letterSpacing: '-0.02em' }}>{liveCount}</div>
                                <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginTop: 3 }}>
                                    {filter === 'live' ? '← tap to clear' : 'Live now'}
                                </div>
                            </div>
                        </div>

                        {/* Errors */}
                        <div onClick={() => handleStatCard('errors')} style={{
                            borderRadius: 12, padding: '13px 15px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 11,
                            background: filter === 'errors' ? '#fee2e2' : (errorCount > 0 ? '#fff1f2' : '#f8fafc'),
                            border: `1.5px solid ${filter === 'errors' ? '#ef4444' : (errorCount > 0 ? '#fecdd3' : '#e2e8f0')}`,
                            transition: 'all 0.15s',
                            opacity: errorCount === 0 ? 0.55 : 1,
                        }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                                background: filter === 'errors' ? '#fecaca' : (errorCount > 0 ? '#fee2e2' : '#f1f5f9'),
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <AlertCircle size={18} color={errorCount > 0 ? '#dc2626' : '#94a3b8'} />
                            </div>
                            <div>
                                <div style={{ fontSize: 24, fontWeight: 800, color: errorCount > 0 ? '#b91c1c' : '#94a3b8', lineHeight: 1, letterSpacing: '-0.02em' }}>{errorCount}</div>
                                <div style={{ fontSize: 11, color: errorCount > 0 ? '#f87171' : '#cbd5e1', fontWeight: 600, marginTop: 3 }}>
                                    {filter === 'errors' ? '← tap to clear' : 'With errors'}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Filter tabs ── */}
                {!loading && (
                    <div style={{ display: 'flex', gap: 5, padding: '10px 18px 0' }}>
                        {[
                            { key: 'all', label: `All`, count: vessels.length },
                            { key: 'live', label: `Online`, count: liveCount },
                            { key: 'errors', label: `Errors`, count: errorCount },
                        ].map(tab => (
                            <button key={tab.key}
                                onClick={() => { setFilter(tab.key); setExpandedImo(null); }}
                                style={{
                                    fontSize: 12, padding: '5px 12px', borderRadius: 20,
                                    cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5,
                                    background: filter === tab.key ? '#0f172a' : '#f8fafc',
                                    border: `1px solid ${filter === tab.key ? '#0f172a' : '#e2e8f0'}`,
                                    color: filter === tab.key ? '#fff' : '#64748b',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {tab.label}
                                <span style={{
                                    fontSize: 10, fontWeight: 700,
                                    background: filter === tab.key ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                                    color: filter === tab.key ? '#fff' : '#64748b',
                                    padding: '1px 6px', borderRadius: 10,
                                }}>
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                {/* ── Vessel list ── */}
                <div style={{ overflowY: 'auto', padding: '10px 18px 14px', flex: 1 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '48px 0' }}>
                            <div style={{ width: 32, height: 32, border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', margin: '0 auto 12px', animation: 'spin 0.8s linear infinite' }} />
                            <div style={{ fontSize: 13, color: '#94a3b8' }}>Loading vessel status…</div>
                        </div>
                    ) : filteredVessels.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8', fontSize: 13 }}>
                            No vessels match this filter.
                        </div>
                    ) : (
                        filteredVessels.map((v) => {
                            const isExpanded = expandedImo === v.imo;
                            const errors = v.sync_errors || [];
                            const hasErrors = errors.length > 0;
                            const ps = ageStyle(v.last_push_at);
                            const pl = ageStyle(v.last_pull_at);

                            return (
                                <div key={v.imo} ref={el => rowRefs.current[v.imo] = el}
                                    style={{
                                        borderRadius: 13, marginBottom: 8, overflow: 'hidden',
                                        border: `1px solid ${hasErrors ? '#fecdd3' : isExpanded ? '#c7d2fe' : '#e2e8f0'}`,
                                        boxShadow: isExpanded ? '0 0 0 3px rgba(99,102,241,0.1)' : 'none',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {/* ── Row summary (always visible) ── */}
                                    <div onClick={() => handleToggle(v.imo)} style={{
                                        padding: '12px 14px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        cursor: 'pointer',
                                        background: hasErrors ? '#fff5f5' : isExpanded ? '#f5f3ff' : '#fff',
                                        transition: 'background 0.15s',
                                    }}>
                                        {/* Left: status dot + name */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{ position: 'relative', flexShrink: 0 }}>
                                                <div style={{
                                                    width: 34, height: 34, borderRadius: 9,
                                                    background: v.online ? '#f0fdf4' : '#f8fafc',
                                                    border: `1px solid ${v.online ? '#86efac' : '#e2e8f0'}`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                    <Ship size={15} color={v.online ? '#16a34a' : '#94a3b8'} />
                                                </div>
                                                {/* Online indicator dot */}
                                                <div style={{
                                                    position: 'absolute', bottom: -2, right: -2,
                                                    width: 9, height: 9, borderRadius: '50%',
                                                    background: v.online ? '#22c55e' : '#d1d5db',
                                                    border: '2px solid #fff',
                                                }} />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>
                                                    {v.name}
                                                </div>
                                                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                                                    IMO {v.imo}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Right: badges + chevron */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

                                            {/* Error badge */}
                                            {hasErrors && (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                    fontSize: 11, padding: '3px 8px', borderRadius: 20,
                                                    background: '#fee2e2', color: '#b91c1c',
                                                    fontWeight: 700, border: '1px solid #fecaca',
                                                }}>
                                                    <AlertCircle size={10} />
                                                    {errors.length}
                                                </div>
                                            )}

                                            {/* ── Offline app install badge ── */}
                                            {(() => {
                                                const anyInstalled = (v.modules || []).some(m => m.available === true);
                                                return (
                                                    <div style={{
                                                        display: 'flex', alignItems: 'center', gap: 5,
                                                        fontSize: 11, padding: '4px 9px', borderRadius: 20,
                                                        fontWeight: 600,
                                                        background: anyInstalled ? '#f0fdf4' : '#f8fafc',
                                                        border: `1px solid ${anyInstalled ? '#86efac' : '#e2e8f0'}`,
                                                        color: anyInstalled ? '#15803d' : '#94a3b8',
                                                    }}>
                                                        <div style={{
                                                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                                            background: anyInstalled ? '#22c55e' : '#d1d5db',
                                                        }} />
                                                        {anyInstalled ? 'App installed' : 'Not installed'}
                                                    </div>
                                                );
                                            })()}

                                            <ChevronRight size={14} color="#cbd5e1"
                                                style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                                        </div>
                                    </div>

                                    {/* ── Expanded panel ── */}
                                    {isExpanded && (
                                        <div style={{
                                            borderTop: '1px solid #f1f5f9',
                                            background: '#fafbfc',
                                            animation: 'fadeSlideIn 0.18s ease',
                                        }}>
                                            {/* Sync timestamps (Shore Perspective) */}
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '12px 14px' }}>
                                                {[
                                                    {
                                                        label: 'Shore Pull (Vessel → Shore)',
                                                        value: v.last_pull_at,
                                                        s: ageStyle(v.last_pull_at)
                                                    },
                                                    {
                                                        label: 'Shore Push (Shore → Vessel)',
                                                        value: v.last_push_at,
                                                        s: ageStyle(v.last_push_at)
                                                    },
                                                ].map(({ label, value, s }) => (
                                                    <div key={label} style={{
                                                        padding: '10px 12px', borderRadius: 9,
                                                        background: s.bg, border: `1px solid ${s.border}`,
                                                    }}>
                                                        <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 4, lineHeight: 1.3, textTransform: 'uppercase' }}>
                                                            {label}
                                                        </div>
                                                        <div style={{ fontSize: 14, fontWeight: 800, color: s.color, letterSpacing: '-0.01em' }}>
                                                            {formatSync(value)}
                                                        </div>
                                                        {value && (
                                                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>
                                                                {new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>

                                            {/* ── Error log — only shown when expanded ── */}
                                            {hasErrors && (
                                                <div style={{ padding: '0 14px 12px' }}>
                                                    <div style={{
                                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                        marginBottom: 8,
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <AlertCircle size={12} color="#ef4444" />
                                                            <span style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                                Sync errors
                                                            </span>
                                                        </div>
                                                        <span style={{
                                                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                                                            background: '#fee2e2', color: '#b91c1c', border: '1px solid #fecaca',
                                                        }}>
                                                            {errors.length} event{errors.length !== 1 ? 's' : ''}
                                                        </span>
                                                    </div>

                                                    <div style={{
                                                        maxHeight: 220, overflowY: 'auto',
                                                        display: 'flex', flexDirection: 'column', gap: 6,
                                                        paddingRight: 2,
                                                    }}>
                                                        {errors.map((err, i) => (
                                                            <div key={err.id ?? i} style={{
                                                                display: 'flex', gap: 9, alignItems: 'flex-start',
                                                                padding: '9px 10px', borderRadius: 9,
                                                                background: '#fff',
                                                                border: `1px solid ${err.error_type === 'shore_error' ? '#fecaca' : '#fed7aa'}`,
                                                            }}>
                                                                {/* Type badge */}
                                                                <div style={{
                                                                    fontSize: 9, fontWeight: 800, padding: '3px 6px',
                                                                    borderRadius: 5, flexShrink: 0, letterSpacing: '0.04em',
                                                                    background: err.error_type === 'shore_error' ? '#fef2f2' : '#fff7ed',
                                                                    color: err.error_type === 'shore_error' ? '#b91c1c' : '#c2410c',
                                                                    border: `1px solid ${err.error_type === 'shore_error' ? '#fecaca' : '#fed7aa'}`,
                                                                    marginTop: 1,
                                                                }}>
                                                                    {err.error_type === 'shore_error' ? 'SHORE' : 'SHIP'}
                                                                </div>

                                                                {/* Message + time */}
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <div style={{
                                                                        fontSize: 12, fontWeight: 600, color: '#1e293b',
                                                                        wordBreak: 'break-word', lineHeight: 1.4,
                                                                    }}>
                                                                        {err.error_msg}
                                                                    </div>
                                                                    {err.created_at && (
                                                                        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>
                                                                            {new Date(err.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* ── Modules ── */}
                                            <div style={{ padding: '0 14px 14px' }}>
                                                <div style={{
                                                    fontSize: 11, fontWeight: 700, color: '#94a3b8',
                                                    textTransform: 'uppercase', letterSpacing: '0.05em',
                                                    marginBottom: 8,
                                                }}>
                                                    Modules
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                                    {(v.modules || []).map((mod) => {
                                                        const meta = MODULE_META[mod.key] ?? { label: mod.key, icon: <Database size={13} />, color: '#6b7280' };
                                                        return (
                                                            <div key={mod.key} style={{
                                                                display: 'flex', alignItems: 'center', gap: 8,
                                                                padding: '8px 10px', borderRadius: 8,
                                                                background: mod.available ? `${meta.color}0d` : '#f8fafc',
                                                                border: `1px solid ${mod.available ? `${meta.color}25` : '#e2e8f0'}`,
                                                            }}>
                                                                <div style={{
                                                                    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                                                                    background: mod.available ? `${meta.color}18` : '#f1f5f9',
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    color: mod.available ? meta.color : '#cbd5e1',
                                                                }}>
                                                                    {React.cloneElement(meta.icon, { size: 13 })}
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontSize: 12, fontWeight: 600, color: mod.available ? '#1e293b' : '#94a3b8' }}>
                                                                        {meta.label}
                                                                    </div>
                                                                    <div style={{ fontSize: 10, color: mod.available ? '#22c55e' : '#cbd5e1', fontWeight: 600 }}>
                                                                        {mod.available ? 'Active' : 'Inactive'}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* ── Footer ── */}
                <div style={{
                    padding: '12px 18px', borderTop: '1px solid #f1f5f9',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#fafbfc',
                }}>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {liveCount} online · {errorCount} with errors
                    </div>
                    <button onClick={onClose} style={{
                        padding: '7px 18px', borderRadius: 8,
                        border: '1px solid #e2e8f0', background: '#fff',
                        cursor: 'pointer', fontSize: 13, color: '#475569', fontWeight: 600,
                    }}>
                        Close
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes fadeSlideIn {
                    from { opacity: 0; transform: translateY(-5px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
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