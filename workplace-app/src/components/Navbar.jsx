import React, { useState, useRef, useEffect } from 'react';
import { Building2, Search, Shield, LogOut, ChevronDown, Ship, X, Check, KeyRound, Activity, ChevronRight, Database, Clock, Wifi, WifiOff, FileText, Trello, Droplet, Zap, AlertCircle, Terminal, RefreshCw, ArrowUpRight, ArrowDownLeft, CheckCircle, Ship as ShipIcon, BookOpen, AlertTriangle } from "lucide-react";
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
    if (diff < 0) return 'Just now';
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

function parseErrorMessage(raw) {
    if (!raw) return { title: 'Unknown error', detail: null, code: null, dev: null };

    const dev = { raw };

    // ── 1. Unique Violation ───────────────────────────────────────────────────
    if (raw.includes('UniqueViolationError') || raw.includes('duplicate key value')) {
        const keyMatch = raw.match(/Key \((.+?)\)=\((.+?)\)/);
        const constrMatch = raw.match(/constraint "(.+?)"/);
        const sqlMatch = raw.match(/\[SQL: (.+?)\]/s);
        const paramMatch = raw.match(/\[parameters: (.+?)\]/s);
        dev.exception = 'asyncpg.exceptions.UniqueViolationError';
        dev.constraint = constrMatch?.[1] ?? null;
        dev.sql = sqlMatch?.[1]?.trim() ?? null;
        dev.params = paramMatch?.[1]?.trim() ?? null;
        dev.ref = raw.match(/https:\/\/sqlalche\.me\/\S+/)?.[0] ?? null;
        if (keyMatch) {
            dev.key = `${keyMatch[1]} = ${keyMatch[2]}`;
            return {
                title: 'Duplicate record — already exists',
                detail: `A record with ${keyMatch[1].replace(/_/g, ' ')} "${keyMatch[2]}" already exists.`,
                code: keyMatch[2], dev,
            };
        }
        return { title: 'Duplicate record', detail: 'This record already exists in the database.', code: null, dev };
    }

    // ── 2. Foreign Key Violation ──────────────────────────────────────────────
    if (raw.includes('ForeignKeyViolationError') || raw.includes('foreign key constraint')) {
        const tableMatch = raw.match(/table "(.+?)"/);
        dev.exception = 'asyncpg.exceptions.ForeignKeyViolationError';
        dev.table = tableMatch?.[1] ?? null;
        return {
            title: 'Linked record missing',
            detail: tableMatch
                ? `A referenced record in "${tableMatch[1]}" no longer exists.`
                : 'This record references something that no longer exists.',
            code: null, dev,
        };
    }

    // ── 3. Not Null Violation ─────────────────────────────────────────────────
    if (raw.includes('NotNullViolationError') || raw.includes('null value in column')) {
        const col = raw.match(/column "(.+?)"/)?.[1];
        const table = raw.match(/relation "(.+?)"/)?.[1];
        dev.exception = 'asyncpg.exceptions.NotNullViolationError';
        return {
            title: 'Missing required field',
            detail: col
                ? `The field "${col.replace(/_/g, ' ')}"${table ? ` in "${table}"` : ''} cannot be empty.`
                : 'A required field is missing.',
            code: null, dev,
        };
    }

    // ── 4. Check Constraint Violation ────────────────────────────────────────
    if (raw.includes('CheckViolationError') || raw.includes('check constraint')) {
        const constr = raw.match(/constraint "(.+?)"/)?.[1];
        dev.exception = 'asyncpg.exceptions.CheckViolationError';
        dev.constraint = constr ?? null;
        return {
            title: 'Value not allowed',
            detail: constr
                ? `The value violates the rule "${constr.replace(/_/g, ' ')}".`
                : 'A field value does not meet the required conditions.',
            code: null, dev,
        };
    }

    // ── 5. Exclusion Constraint Violation ────────────────────────────────────
    if (raw.includes('ExclusionViolationError') || raw.includes('exclusion constraint')) {
        dev.exception = 'asyncpg.exceptions.ExclusionViolationError';
        return {
            title: 'Conflicting record exists',
            detail: 'This record overlaps with an existing record and cannot be saved.',
            code: null, dev,
        };
    }

    // ── 6. Data Type / Value Error ───────────────────────────────────────────
    if (raw.includes('DataError') || raw.includes('invalid input syntax') || raw.includes('out of range')) {
        const typeMatch = raw.match(/type "(.+?)"/);
        const valMatch = raw.match(/value "(.+?)"/);
        dev.exception = 'sqlalchemy.exc.DataError';
        return {
            title: 'Invalid data format',
            detail: valMatch
                ? `The value "${valMatch[1]}" is not valid${typeMatch ? ` for type "${typeMatch[1]}"` : ''}.`
                : 'A field contains data in the wrong format.',
            code: valMatch?.[1] ?? null, dev,
        };
    }

    // ── 7. String Too Long ───────────────────────────────────────────────────
    if (raw.includes('value too long') || raw.includes('string_data_right_truncation')) {
        const col = raw.match(/column "(.+?)"/)?.[1];
        dev.exception = 'asyncpg.exceptions.StringDataRightTruncationError';
        return {
            title: 'Text too long',
            detail: col
                ? `The value for "${col.replace(/_/g, ' ')}" exceeds the maximum allowed length.`
                : 'One of the fields exceeds the maximum allowed length.',
            code: null, dev,
        };
    }

    // ── 8. Deadlock ──────────────────────────────────────────────────────────
    if (raw.includes('DeadlockDetectedError') || raw.includes('deadlock detected')) {
        dev.exception = 'asyncpg.exceptions.DeadlockDetectedError';
        return {
            title: 'Deadlock detected',
            detail: 'Two operations conflicted with each other. The sync will retry automatically.',
            code: null, dev,
        };
    }

    // ── 9. Serialization Failure ─────────────────────────────────────────────
    if (raw.includes('SerializationFailure') || raw.includes('could not serialize')) {
        dev.exception = 'asyncpg.exceptions.SerializationFailureError';
        return {
            title: 'Sync conflict',
            detail: 'The record was modified by another process at the same time. Will retry.',
            code: null, dev,
        };
    }

    // ── 10. Insufficient Privilege ───────────────────────────────────────────
    if (raw.includes('InsufficientPrivilegeError') || raw.includes('permission denied')) {
        const obj = raw.match(/relation "(.+?)"/)?.[1] ?? raw.match(/table "(.+?)"/)?.[1];
        dev.exception = 'asyncpg.exceptions.InsufficientPrivilegeError';
        return {
            title: 'Permission denied',
            detail: obj
                ? `The database user does not have access to "${obj}".`
                : 'The database user does not have permission to perform this action.',
            code: null, dev,
        };
    }

    // ── 11. Undefined Table / Column ─────────────────────────────────────────
    if (raw.includes('UndefinedTableError') || raw.includes('relation') && raw.includes('does not exist')) {
        const table = raw.match(/relation "(.+?)"/)?.[1];
        dev.exception = 'asyncpg.exceptions.UndefinedTableError';
        return {
            title: 'Table not found',
            detail: table
                ? `The table "${table}" does not exist. A migration may be required.`
                : 'A required database table is missing.',
            code: null, dev,
        };
    }

    if (raw.includes('UndefinedColumnError') || raw.includes('column') && raw.includes('does not exist')) {
        const col = raw.match(/column "(.+?)"/)?.[1];
        dev.exception = 'asyncpg.exceptions.UndefinedColumnError';
        return {
            title: 'Column not found',
            detail: col
                ? `The column "${col}" does not exist. A migration may be required.`
                : 'A required database column is missing.',
            code: null, dev,
        };
    }

    // ── 12. Disk / Storage Full ──────────────────────────────────────────────
    if (raw.includes('DiskFull') || raw.includes('no space left on device') || raw.includes('out of disk')) {
        dev.exception = 'asyncpg.exceptions.DiskFull';
        return {
            title: 'Server storage full',
            detail: 'The database server has run out of disk space. Contact your administrator.',
            code: null, dev,
        };
    }

    // ── 13. Blob / File Upload ───────────────────────────────────────────────
    if (raw.toLowerCase().includes('blob') || raw.toLowerCase().includes('upload')) {
        return {
            title: 'File upload failed',
            detail: 'The file could not be sent to the server. Check the connection and retry.',
            code: null, dev,
        };
    }

    // ── 14. SSL Error ────────────────────────────────────────────────────────
    if (raw.toLowerCase().includes('ssl') || raw.includes('certificate')) {
        dev.exception = 'SSL/TLS Error';
        return {
            title: 'Secure connection failed',
            detail: 'An SSL certificate or encryption error occurred. Check server configuration.',
            code: null, dev,
        };
    }

    // ── 15. Connection / Timeout ─────────────────────────────────────────────
    if (raw.toLowerCase().includes('timeout')) {
        dev.exception = 'ConnectionTimeoutError';
        return {
            title: 'Connection timed out',
            detail: 'The server did not respond in time. The vessel may have poor connectivity.',
            code: null, dev,
        };
    }

    if (raw.toLowerCase().includes('connection refused') || raw.includes('ECONNREFUSED')) {
        dev.exception = 'ECONNREFUSED';
        return {
            title: 'Connection refused',
            detail: 'The server actively refused the connection. The service may be down.',
            code: null, dev,
        };
    }

    if (raw.includes('ECONNRESET') || raw.includes('connection reset')) {
        dev.exception = 'ECONNRESET';
        return {
            title: 'Connection was reset',
            detail: 'The connection was interrupted mid-transfer. The sync will retry.',
            code: null, dev,
        };
    }

    if (raw.includes('ENOTFOUND') || raw.includes('getaddrinfo')) {
        dev.exception = 'ENOTFOUND';
        return {
            title: 'Server not reachable',
            detail: 'The server address could not be resolved. Check network or DNS settings.',
            code: null, dev,
        };
    }

    if (raw.toLowerCase().includes('connection')) {
        dev.exception = 'ConnectionError';
        return {
            title: 'Connection problem',
            detail: 'Could not reach the server. The vessel may be offline.',
            code: null, dev,
        };
    }

    // ── 16. Authentication ───────────────────────────────────────────────────
    if (raw.includes('password authentication failed') || raw.includes('AuthenticationError')) {
        dev.exception = 'asyncpg.exceptions.AuthenticationError';
        return {
            title: 'Authentication failed',
            detail: 'The database credentials are incorrect or have expired.',
            code: null, dev,
        };
    }

    // ── 17. JSON / Parse Error ───────────────────────────────────────────────
    if (raw.includes('JSONDecodeError') || raw.includes('invalid json') || raw.includes('JSON parse')) {
        dev.exception = 'JSONDecodeError';
        return {
            title: 'Invalid data received',
            detail: 'The server returned data in an unexpected format.',
            code: null, dev,
        };
    }

    // ── 18. HTTP Errors ──────────────────────────────────────────────────────
    if (raw.includes('404') || raw.includes('Not Found')) {
        return { title: 'Resource not found', detail: 'The requested record or endpoint does not exist.', code: '404', dev };
    }
    if (raw.includes('401') || raw.includes('Unauthorized')) {
        return { title: 'Not authorised', detail: 'The session has expired or the token is invalid. Try logging in again.', code: '401', dev };
    }
    if (raw.includes('403') || raw.includes('Forbidden')) {
        return { title: 'Access denied', detail: 'You do not have permission to perform this action.', code: '403', dev };
    }
    if (raw.includes('409') || raw.includes('Conflict')) {
        return { title: 'Conflict', detail: 'This change conflicts with another update. Please refresh and try again.', code: '409', dev };
    }
    if (raw.includes('413') || raw.includes('Request Entity Too Large') || raw.includes('Payload Too Large')) {
        return { title: 'File too large', detail: 'The file exceeds the maximum allowed upload size.', code: '413', dev };
    }
    if (raw.includes('429') || raw.includes('Too Many Requests')) {
        return { title: 'Too many requests', detail: 'The sync is being rate limited. It will retry shortly.', code: '429', dev };
    }
    if (raw.includes('500') || raw.includes('Internal Server Error')) {
        return { title: 'Server error', detail: 'An unexpected error occurred on the server. Contact your administrator.', code: '500', dev };
    }
    if (raw.includes('502') || raw.includes('Bad Gateway')) {
        return { title: 'Gateway error', detail: 'The server received an invalid response from an upstream service.', code: '502', dev };
    }
    if (raw.includes('503') || raw.includes('Service Unavailable')) {
        return { title: 'Service unavailable', detail: 'The server is temporarily down for maintenance or overloaded.', code: '503', dev };
    }

    // ── 19. Generic SQLAlchemy / asyncpg ─────────────────────────────────────
    if (raw.includes('sqlalchemy') || raw.includes('asyncpg')) {
        const firstLine = raw.split('\n')[0].replace(/\(.*?\)/g, '').trim();
        dev.exception = raw.match(/asyncpg\.exceptions\.(\w+)/)?.[0]
            ?? raw.match(/sqlalchemy\.exc\.(\w+)/)?.[0]
            ?? 'Database error';
        return {
            title: 'Database error',
            detail: firstLine.length < 120 ? firstLine : 'An internal database error occurred.',
            code: null, dev,
        };
    }

    // ── 20. Short readable message — show as-is ───────────────────────────────
    if (raw.length < 80) return { title: raw, detail: null, code: null, dev };

    // ── 21. Long unknown — truncate ───────────────────────────────────────────
    return { title: 'Sync error', detail: raw.slice(0, 120) + '…', code: null, dev };
}

const DevRow = ({ label, value, copyable }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        const text = typeof value === 'string' ? value : '';
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            });
        } else {
            const el = document.createElement('textarea');
            el.value = text;
            el.style.position = 'absolute';
            el.style.left = '-9999px';
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="err-dev-row" style={{
            borderBottom: '0.5px solid #fecdd3',
            padding: '9px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className='fsize-14' style={{ fontSize: '10px', fontWeight: 800, color: '#9f1239', textTransform: 'uppercase', letterSpacing: '0.8px', fontFamily: 'sans-serif' }}>
                    {label}
                </span>
                {copyable && (
                    <button onClick={handleCopy} className='fsize-15' style={{
                        fontSize: '11px',
                        color: copied ? '#10b981' : '#64748b',
                        background: copied ? '#ecfdf5' : '#f8fafc',
                        border: `1px solid ${copied ? '#a7f3d0' : '#e2e8f0'}`,
                        borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                        fontFamily: 'sans-serif', transition: '0.2s'
                    }}>
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                )}
            </div>
            <div className='fsize-15' style={{ fontSize: '12px', color: '#334155', lineHeight: 1.6, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {value}
            </div>
        </div>
    );
};

const LiveModuleDetail = ({ imo, moduleKey, isInstalled, prefetchedData }) => {
    const [data, setData] = useState(prefetchedData ?? null);
    const [loading, setLoading] = useState(!prefetchedData);
    const [devTabs, setDevTabs] = useState({});

    const fetchSyncData = async () => {
        if (!imo || !isInstalled) { setLoading(false); return; }
        try {
            let res;
            if (moduleKey === 'drs') res = await apiDrs.get(`/vessels/${imo}/sync-log`);
            else if (moduleKey === 'lubeoil') res = await apiLuboil.get(`api/vessels/${imo}/sync-log`);
            else if (moduleKey === 'jira') res = await axiosJira.get(`api/vessels/${imo}/sync-log`);
            else { setData(null); setLoading(false); return; }
            setData(res.data);
        } catch (err) {
            console.error("Sync log fetch failed", err);
        } finally {
            setLoading(false);
        }
    };

    // When drawer switches to a different vessel/module, sync immediately
    useEffect(() => {
        if (prefetchedData) {
            setData(prefetchedData);
            setLoading(false);
        } else {
            setLoading(true);
            fetchSyncData();
        }
    }, [imo, moduleKey, prefetchedData]);

    // Keep polling every 30s to stay fresh
    useEffect(() => {
        const interval = setInterval(fetchSyncData, 30000);
        return () => clearInterval(interval);
    }, [imo, moduleKey, isInstalled]);

    if (!isInstalled) return (
        <div style={mStyles.notInstalledBox}>
            <Activity size={40} color="#cbd5e1" />
            <h3 style={{ color: THEME.textMuted, margin: '15px 0 5px' }}>Module Not Configured</h3>
            <p style={{ color: THEME.textMuted, fontSize: '13px' }}>This application is not installed on this vessel.</p>
        </div>
    );

    if (loading) return (
        <div style={{ padding: 40, textAlign: 'center' }}>
            <RefreshCw className="spin" color={THEME.primary} />
        </div>
    );

    const activeErrors = data?.active_errors || [];

    return (
        <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div style={mStyles.sectionLabel}>{moduleKey.toUpperCase()} Sync Statistics</div>
            <div style={mStyles.statsRow}>
                <div style={mStyles.statBox}>
                    <div style={mStyles.statLabel}><ArrowUpRight size={14} /> Vessel → Shore (Push)</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: data?.vessel_reported_push ? THEME.success : THEME.danger }}>
                        {data?.vessel_reported_push
                            ? new Date(data.vessel_reported_push).toLocaleString()
                            : 'Never Synced'}
                    </div>
                </div>
                <div style={mStyles.statBox}>
                    <div style={mStyles.statLabel}><ArrowDownLeft size={14} /> Shore → Vessel (Pull)</div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: data?.vessel_reported_pull ? THEME.success : THEME.danger }}>
                        {data?.vessel_reported_pull
                            ? new Date(data.vessel_reported_pull).toLocaleString()
                            : 'Never Synced'}
                    </div>
                </div>
            </div>

            <div style={{ ...mStyles.sectionLabel, marginTop: 24 }}>Current Active Issues</div>
            {activeErrors.length === 0 ? (
                <div style={mStyles.emptyState}>
                    <CheckCircle size={32} color={THEME.success} />
                    <span style={{ fontWeight: 600, color: THEME.textMain }}>Everything is up to date</span>
                    <span style={{ fontSize: '12px', color: THEME.textMuted }}>No issues found for this module.</span>
                </div>
            ) : activeErrors.map((err, i) => {
                const parsed = parseErrorMessage(err.msg);
                const view = devTabs[i] ?? 'user';
                const setView = (v) => setDevTabs(prev => ({ ...prev, [i]: v }));
                return (
                    <div key={i} style={{ ...mStyles.normalErrorCard, marginBottom: 10 }}>
                        <div style={mStyles.errCardHeader}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontWeight: 700, fontSize: 12, color: '#b91c1c' }}>
                                    Sync issue{err.entity ? ` · ${err.entity.toLowerCase()}` : ''}
                                </span>
                                {parsed.code && (
                                    <span style={{ fontFamily: 'monospace', background: '#fecdd3', color: '#9f1239', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>
                                        {parsed.code}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ display: 'flex', gap: 2, background: 'rgb(255 212 212)', borderRadius: 6, padding: 3 }}>
                                    {['user', 'dev'].map(tab => (
                                        <button key={tab} onClick={() => setView(tab)} style={{
                                            fontSize: '11px', fontWeight: 500,
                                            padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer',
                                            background: view === tab ? '#fff1f2' : 'transparent',
                                            color: '#b91c1c', transition: 'background .15s',
                                        }}>
                                            {tab === 'user' ? 'User' : 'Dev'}
                                        </button>
                                    ))}
                                </div>
                                <span style={{ fontSize: 11, color: THEME.textMuted }}>{formatAgo(err.ts)}</span>
                            </div>
                        </div>

                        {view === 'user' && (
                            <div style={{ padding: '12px 16px' }}>
                                <div style={{ fontWeight: 600, fontSize: '13px', color: '#1e293b', marginBottom: parsed.detail ? 5 : 0 }}>
                                    {parsed.title}
                                </div>
                                {parsed.detail && (
                                    <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                                        {parsed.detail}
                                    </div>
                                )}
                            </div>
                        )}

                        {view === 'dev' && (
                            <div style={{ fontFamily: 'monospace' }}>
                                <DevRow label="Raw error" value={parsed.dev?.raw ?? err.msg} copyable />
                                {parsed.dev?.exception && <DevRow label="Exception" value={parsed.dev.exception} />}
                                {parsed.dev?.constraint && <DevRow label="Constraint" value={parsed.dev.constraint} />}
                                {parsed.dev?.key && <DevRow label="Conflicting key" value={parsed.dev.key} />}
                                {parsed.dev?.sql && <DevRow label="SQL" value={parsed.dev.sql} copyable />}
                                {parsed.dev?.params && <DevRow label="Parameters" value={parsed.dev.params} />}
                                {parsed.dev?.ref && (
                                    <DevRow label="SQLAlchemy ref" value={
                                        <a href={parsed.dev.ref} target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}>
                                            {parsed.dev.ref}
                                        </a>
                                    } />
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

const VesselStatusModal = ({ onClose, userPermissions = {} }) => {
    const [vessels, setVessels] = useState([]);
    const [moduleErrors, setModuleErrors] = useState({});
    const [syncLogs, setSyncLogs] = useState({});  // { imo: { drs: {...}, lubeoil: {...}, jira: {...} } }
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [drawer, setDrawer] = useState(null); // { vessel, moduleKey }
    const [syncDetails, setSyncDetails] = useState({});

    useEffect(() => {
        getVesselStatus().then(res => {
            const normalized = (res.data || []).map(v => ({ ...v, imo: v.imo || v.imo_number }));
            setVessels(normalized);
            setLoading(false);
        });

        const loadAll = async () => {
            const sources = [
                { promise: apiDrs.get("/vessels/sync-status/all"), key: 'drs' },
                { promise: apiLuboil.get("api/vessels/sync-status/all"), key: 'lubeoil' },
                { promise: axiosJira.get("api/vessels/sync-status/all"), key: 'jira' },
            ];

            // Fire all requests, update state as each one resolves
            sources.forEach(({ promise, key }) => {
                promise
                    .then(res => {
                        const data = res.data || {};
                        setModuleErrors(prev => {
                            const next = { ...prev };
                            Object.entries(data).forEach(([imo, d]) => {
                                next[imo] = (next[imo] || 0) + (d.failed_items_count || 0);
                            });
                            return next;
                        });
                        setSyncLogs(prev => {
                            const next = { ...prev };
                            Object.entries(data).forEach(([imo, d]) => {
                                next[imo] = { ...next[imo], [key]: d };
                            });
                            return next;
                        });
                    })
                    .catch(err => {
                        console.warn(`Sync status failed for ${key}:`, err);
                        // Silently skip — other modules still render
                    });
            });
        };

        loadAll();
        const interval = setInterval(loadAll, 30000);
        return () => clearInterval(interval);
    }, []);

    const MODULE_COLS = [
        { key: 'drs', label: 'DRS' },
        { key: 'jira', label: 'JIRA' },
        { key: 'lubeoil', label: 'Lube oil' },
        { key: 'voyage', label: 'Voyage perf' },
        { key: 'engine_performance', label: 'Engine perf' },
    ];

    function ageClass(iso) {
        if (!iso) return 'never';
        const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
        if (h < 1) return 'fresh';
        if (h < 12) return 'stale';
        return 'old';
    }

    function formatAgo(iso) {
        if (!iso) return 'Never';
        const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
        if (d < 60) return `${d}s ago`;
        if (d < 3600) return `${Math.floor(d / 60)}m ago`;
        if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
        return `${Math.floor(d / 86400)}d ago`;
    }

    const SYNC_STYLE = {
        fresh: { background: '#eaf3de', border: '1px solid #c0dd97', color: '#27500a' },
        stale: { background: '#faeeda', border: '1px solid #fac775', color: '#633806' },
        old: { background: '#fcebeb', border: '1px solid #f7c1c1', color: '#791f1f' },
        never: { background: '#f8fafc', border: '1px solid #e2e8f0', color: '#94a3b8' },
    };

    function ModuleBadge({ vessel, moduleKey, isInstalled }) {
        const imo = String(vessel.imo_number || vessel.imo);
        const log = syncLogs[imo]?.[moduleKey];

        if (!isInstalled) return (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>N/A</span>
        );

        const errCount = log?.failed_items_count ?? 0;
        const push = log?.vessel_reported_push ?? null;
        const pull = log?.vessel_reported_pull ?? null;

        // Use whichever is more recent
        const lastSync = push && pull
            ? (new Date(push) > new Date(pull) ? push : pull)
            : push ?? pull ?? null;
        const isActive = drawer?.vessel?.imo === vessel.imo && drawer?.moduleKey === moduleKey;
        const age = ageClass(lastSync);

        const CHIP = {
            fresh: { bg: '#eaf3de', border: '#97c459', color: '#27500a', errBg: '#27500a' },
            stale: { bg: '#faeeda', border: '#ef9f27', color: '#633806', errBg: '#854f0b' },
            old: { bg: '#fcebeb', border: '#f09595', color: '#791f1f', errBg: '#791f1f' },
            never: { bg: '#f8fafc', border: '#e2e8f0', color: '#94a3b8', errBg: '#888780' },
        };
        const c = CHIP[age];

        return (
            <div
                onClick={() => setDrawer(isActive ? null : { vessel, moduleKey })}
                title="Click to view sync details and errors"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '3px 8px 3px 6px',
                    borderRadius: 6,
                    background: c.bg,
                    border: `0.5px solid ${c.border}`,
                    color: c.color,
                    fontSize: 11, fontWeight: 500,
                    cursor: 'pointer', transition: '0.12s',
                    outline: isActive ? '2px solid #6366f1' : 'none',
                    outlineOffset: 1,
                    filter: isActive ? 'brightness(0.94)' : 'none',
                }}
            >
                {/* Clock icon */}
                <Clock size={12} color={c.color} strokeWidth={2} />

                {/* Sync time */}
                {formatAgo(lastSync)}

                {errCount > 0 && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 2,
                        background: '#fee2e2',
                        color: '#a32d2d',
                        border: '0.5px solid #fca5a5',
                        fontSize: 9, fontWeight: 700,
                        padding: '0px 4px',
                        borderRadius: 4,
                        marginLeft: 1,
                        lineHeight: 1.6,
                    }}>
                        <AlertTriangle size={8} color="#a32d2d" strokeWidth={2.5} />
                        {errCount}
                    </span>
                )}
            </div>
        );
    }


    const filtered = vessels.filter(v => {
        const totalErrors = moduleErrors[String(v.imo)] || 0;
        const matchSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
            String(v.imo).includes(search);
        if (filter === 'live') return v.online && matchSearch;
        if (filter === 'errors') return totalErrors > 0 && matchSearch;
        return matchSearch;
    });

    const pillBase = { flex: 1, padding: '6px 16px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid', transition: '0.15s' };
    const pills = {
        all: { ...pillBase, background: filter === 'all' ? '#eeedfe' : '#fff', color: filter === 'all' ? '#3c3489' : '#64748b', borderColor: filter === 'all' ? '#afa9ec' : '#e2e8f0' },
        live: { ...pillBase, background: filter === 'live' ? '#eaf3de' : '#fff', color: filter === 'live' ? '#27500a' : '#64748b', borderColor: filter === 'live' ? '#c0dd97' : '#e2e8f0' },
        errors: { ...pillBase, background: filter === 'errors' ? '#fcebeb' : '#fff', color: filter === 'errors' ? '#791f1f' : '#64748b', borderColor: filter === 'errors' ? '#f7c1c1' : '#e2e8f0' },
    };

    return (
        <div style={tStyles.overlay}>
            <div style={tStyles.modal}>
                {/* Header */}
                <div style={tStyles.header}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Vessel status</h2>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                            Sync health across all installed modules
                        </p>
                    </div>
                    <button onClick={onClose} style={tStyles.closeBtn}><X size={18} /></button>
                </div>

                {/* Toolbar */}
                <div style={tStyles.toolbar}>
                    <div style={tStyles.searchBox}>
                        <Search size={14} color="#94a3b8" />
                        <input
                            placeholder="Search vessels…"
                            style={tStyles.searchInput}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button style={pills.all} onClick={() => setFilter('all')}>All</button>
                        <button style={pills.live} onClick={() => setFilter('live')}>Live</button>
                        <button style={pills.errors} onClick={() => setFilter('errors')}>Errors</button>
                    </div>
                </div>

                {/* Table */}

                <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                    {/* Table — always full width, never pushed */}
                    <div style={{ overflowX: 'auto', flex: 1, overflowY: 'auto' }}>
                        {loading ? (
                            <div style={{ padding: 60, textAlign: 'center' }}>
                                <RefreshCw className="spin" color="#6366f1" />
                            </div>
                        ) : (
                            <table style={tStyles.table}>
                                <thead>
                                    <tr>
                                        <th style={tStyles.th}>Vessel</th>
                                        {MODULE_COLS.map(m => (
                                            <th key={m.key} style={{ ...tStyles.th, textAlign: 'center' }}>{m.label}</th>
                                        ))}
                                        <th style={{ ...tStyles.th, textAlign: 'center' }}>Total errors</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.length === 0 ? (
                                        <tr>
                                            <td colSpan={MODULE_COLS.length + 2} style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                                                No vessels match your filter
                                            </td>
                                        </tr>
                                    ) : filtered.map(v => {
                                        const totalErrors = moduleErrors[String(v.imo)] || 0;
                                        return (
                                            <tr key={v.imo} style={tStyles.row}>
                                                <td style={tStyles.td}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                                        {v.online && (
                                                            <span style={{
                                                                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                                                                background: '#3b6d11',
                                                            }} title="Online" />
                                                        )}
                                                        {!v.online && (
                                                            <span style={{ width: 8, height: 8, flexShrink: 0 }} />
                                                        )}
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{v.name}</div>
                                                            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>IMO {v.imo}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                {MODULE_COLS.map(m => {
                                                    const isInstalled = v.modules?.find(mod => mod.key === m.key)?.available;
                                                    return (
                                                        <td key={m.key} style={{ ...tStyles.td, textAlign: 'center' }}>
                                                            <ModuleBadge vessel={v} moduleKey={m.key} isInstalled={isInstalled} />
                                                        </td>
                                                    );
                                                })}
                                                <td style={{ ...tStyles.td, textAlign: 'center' }}>
                                                    {totalErrors > 0 ? (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#a32d2d', fontWeight: 700, fontSize: 13 }}>
                                                            <AlertCircle size={14} strokeWidth={2.5} />
                                                            {totalErrors > 99 ? '99+' : totalErrors}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: '#94a3b8', fontSize: 12 }}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Drawer — floats over the table, doesn't push layout */}
                    {drawer && (
                        <div style={{
                            position: 'absolute', top: 0, right: 0, bottom: 0,
                            width: 360,
                            background: '#fff',
                            borderLeft: '1px solid #e2e8f0',
                            boxShadow: '-4px 0 24px rgba(15,23,42,0.10)',
                            display: 'flex', flexDirection: 'column',
                            zIndex: 10,
                            animation: 'slideInRight 0.2s ease',
                        }}>
                            {/* Drawer Header */}
                            <div style={{
                                padding: '14px 18px',
                                borderBottom: '1px solid #e2e8f0',
                                display: 'flex', alignItems: 'flex-start',
                                justifyContent: 'space-between', gap: 8,
                                flexShrink: 0,
                            }}>
                                <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                                        {drawer.vessel.name} · {MODULE_COLS.find(m => m.key === drawer.moduleKey)?.label}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                                        IMO {drawer.vessel.imo} — sync details & active issues
                                    </div>
                                </div>
                                <button onClick={() => setDrawer(null)} style={{ ...tStyles.closeBtn, padding: 6, flexShrink: 0 }}>
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Drawer Body */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
                                <LiveModuleDetail
                                    imo={drawer.vessel.imo_number || drawer.vessel.imo}
                                    moduleKey={drawer.moduleKey}
                                    isInstalled={drawer.vessel.modules?.find(m => m.key === drawer.moduleKey)?.available}
                                    prefetchedData={null}
                                />

                            </div>
                        </div>
                    )}
                </div>

                {/* Footer / legend */}
                <div style={tStyles.footer}>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                        {[['fresh', '#eaf3de', '#c0dd97', '#27500a', '< 1h'],
                        ['stale', '#faeeda', '#fac775', '#633806', '1–12h'],
                        ['old', '#fcebeb', '#f7c1c1', '#791f1f', '> 12h']].map(([, bg, br, tx, label]) => (
                            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
                                <span style={{ background: bg, border: `1px solid ${br}`, color: tx, padding: '1px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
                                    {label === '< 1h' ? 'Fresh' : label === '1–12h' ? 'Stale' : 'Old'}
                                </span>
                                {label}
                            </span>
                        ))}
                    </div>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{filtered.length} vessel{filtered.length !== 1 ? 's' : ''}</span>
                </div>
            </div>
        </div>
    );
};

const tStyles = {
    overlay: { position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modal: {
        background: '#fff', width: '95vw', maxWidth: 1300,  // was 1100
        height: '80vh', borderRadius: 20, display: 'flex',
        flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
    },
    header: { padding: '20px 28px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    closeBtn: { border: 'none', background: '#f1f5f9', padding: 10, borderRadius: 10, cursor: 'pointer', display: 'flex' },
    toolbar: { padding: '12px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    searchBox: { flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 14px' },
    searchInput: { border: 'none', background: 'transparent', outline: 'none', fontSize: 13, width: '100%' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
    th: { padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#64748b', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 },
    td: { padding: '13px 16px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' },
    row: { transition: '0.12s' },
    footer: { padding: '12px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
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
                            <input type="text" placeholder="Search..." className="search-input nav-search-input" onChange={e => setSearchQuery(e.target.value)} />
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