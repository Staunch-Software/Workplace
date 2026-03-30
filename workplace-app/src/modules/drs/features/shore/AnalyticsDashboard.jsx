import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Ship, RefreshCcw, ChevronDown, X, Check, Flag, TrendingUp } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { useAuth } from '@/context/AuthContext';
import { getDeadlineStatus } from '@drs/components/shared/constants';

// ─── Color constants ──────────────────────────────────────────────────────────
const PRIORITY_COLORS = {
    CRITICAL: '#dc2626',
    HIGH: '#f97316',
    MEDIUM: '#2563eb',
    LOW: '#16a34a',
};
const STATUS_COLORS = {
    OPEN: '#3b82f6',
    PENDING_CLOSURE: '#f59e0b',
    CLOSED: '#22c55e',
};
const DEADLINE_COLORS = {
    NORMAL: '#00a115',
    WARNING: '#f59e0b',
    OVERDUE: '#dc2626',
};

function pct(num, den) {
    if (!den) return '0%';
    return Math.round((num / den) * 100) + '%';
}

// ─── Donut chart ──────────────────────────────────────────────────────────────
function DonutChart({ data, size = 100, label }) {
    const r = 36, cx = size / 2, cy = size / 2;
    const circumference = 2 * Math.PI * r;
    const total = data.reduce((s, d) => s + d.value, 0);
    let offset = 0;
    const slices = data.map(d => {
        const dash = total ? (d.value / total) * circumference : 0;
        const gap = circumference - dash;
        const rotation = (offset / (total || 1)) * 360 - 90;
        offset += d.value;
        return { ...d, dash, gap, rotation };
    });
    return (
        <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {total === 0 ? (
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e2e8f0" strokeWidth={10} />
                ) : slices.map((s, i) => (
                    <circle key={i} cx={cx} cy={cy} r={r}
                        fill="none" stroke={s.color} strokeWidth={10}
                        strokeDasharray={`${s.dash} ${s.gap}`}
                        transform={`rotate(${s.rotation} ${cx} ${cy})`}
                        style={{ transition: 'stroke-dasharray .4s ease' }}
                    />
                ))}
            </svg>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', lineHeight: 1 }}>{total}</div>
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            </div>
        </div>
    );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function Legend({ items }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
            {items.map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#64748b', flex: 1 }}>{item.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{item.value}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 34, textAlign: 'right' }}>{item.pct}</span>
                </div>
            ))}
        </div>
    );
}

// ─── Horizontal bar ───────────────────────────────────────────────────────────
function HBar({ label, count, value, max, color }) {
    const w = max ? Math.round((value / max) * 100) : 0;
    return (
        <div style={{ marginBottom: 11 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                <span style={{ color: '#475569', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '80%' }}>{label}</span>
                <span style={{ color: '#334155', fontWeight: 700 }}>{count}</span>
            </div>
            <div style={{ height: 5, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: w + '%', background: color, borderRadius: 3, transition: 'width .5s ease' }} />
            </div>
        </div>
    );
}

// ─── Multi-vessel selector ────────────────────────────────────────────────────
function VesselMultiSelector({ vessels, selected, onChange }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    const toggle = (v) => {
        if (v === '') {
            onChange([]);
        } else {
            const next = selected.includes(v)
                ? selected.filter(s => s !== v)
                : [...selected, v];
            onChange(next);
        }
    };

    const label = selected.length === 0
        ? 'All Vessels'
        : selected.length === 1
            ? selected[0]
            : `${selected.length} vessels selected`;

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px',
                    border: '1px solid #cbd5e1', borderRadius: '6px',
                    background: selected.length > 0 ? '#fff7ed' : 'white',
                    cursor: 'pointer', fontSize: 13,
                    color: selected.length > 0 ? '#ea580c' : '#334155',
                    fontWeight: 600, minWidth: 160,
                }}
            >
                <Ship size={14} color="#ea580c" />
                <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                <ChevronDown size={13} style={{ flexShrink: 0 }} />
            </button>

            {open && (
                <div style={{
                    position: 'absolute', top: '110%', left: 0, zIndex: 300,
                    background: 'white', border: '1px solid #e2e8f0',
                    borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,.12)',
                    minWidth: 240, maxHeight: 300, overflowY: 'auto',
                }}>
                    <div
                        onClick={() => toggle('')}
                        style={{
                            padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                            color: '#334155', fontWeight: selected.length === 0 ? 700 : 400,
                            background: selected.length === 0 ? '#fff7ed' : 'transparent',
                            borderLeft: selected.length === 0 ? '3px solid #ea580c' : '3px solid transparent',
                            borderBottom: '1px solid #f1f5f9',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        }}
                        onMouseEnter={e => { if (selected.length !== 0) e.currentTarget.style.background = '#f8fafc'; }}
                        onMouseLeave={e => { if (selected.length !== 0) e.currentTarget.style.background = 'transparent'; }}
                    >
                        <span>All Vessels</span>
                        {selected.length === 0 && <Check size={13} color="#ea580c" />}
                    </div>
                    {vessels.map(v => {
                        const isSelected = selected.includes(v);
                        return (
                            <div
                                key={v}
                                onClick={() => toggle(v)}
                                style={{
                                    padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                                    color: '#334155', fontWeight: isSelected ? 700 : 400,
                                    background: isSelected ? '#fff7ed' : 'transparent',
                                    borderLeft: isSelected ? '3px solid #ea580c' : '3px solid transparent',
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                    <Ship size={12} color={isSelected ? '#ea580c' : '#94a3b8'} />
                                    {v}
                                </span>
                                {isSelected && <Check size={13} color="#ea580c" />}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ─── Chart canvas wrapper ─────────────────────────────────────────────────────
function ChartCanvas({ id, height = 220 }) {
    return (
        <div style={{ position: 'relative', width: '100%', height }}>
            <canvas id={id} />
        </div>
    );
}

// ─── Flagged Defects Panel ────────────────────────────────────────────────────
function FlaggedDefectsPanel({ defects }) {
    const [expandedVessel, setExpandedVessel] = useState(null);

    const flagged = useMemo(
        () => defects.filter(d => d.is_flagged && d.status !== 'CLOSED'),
        [defects]
    );

    const byVessel = useMemo(() => {
        const map = {};
        flagged.forEach(d => {
            const v = d.vessel_name || 'Unknown';
            if (!map[v]) map[v] = [];
            map[v].push(d);
        });
        return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
    }, [flagged]);

    if (flagged.length === 0) return null;

    const getDeadlineBadge = (date) => {
        if (!date) return null;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dl = new Date(date); dl.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((dl - today) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) return { label: `${Math.abs(diffDays)}D OVER`, style: { background: '#FCEBEB', color: '#791F1F', border: '1px solid #fca5a5' } };
        if (diffDays <= 15) return { label: `${diffDays}D LEFT`, style: { background: '#FAEEDA', color: '#633806', border: '1px solid #fed7aa' } };
        return { label: `${diffDays}D LEFT`, style: { background: '#EAF3DE', color: '#27500A', border: '1px solid #d9f99d' } };
    };

    const fmtDate = d => d
        ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';

    const priorityStyle = p => ({
        CRITICAL: { background: '#FCEBEB', color: '#791F1F', border: '1px solid #fca5a5' },
        HIGH: { background: '#FAEEDA', color: '#633806', border: '1px solid #fed7aa' },
        MEDIUM: { background: '#E6F1FB', color: '#0C447C', border: '1px solid #bae6fd' },
        LOW: { background: '#EAF3DE', color: '#27500A', border: '1px solid #d9f99d' },
    }[p] || { background: '#F1EFE8', color: '#444441' });

    const HoverText = ({ text, weight = 400, color = '#475569' }) => {
        const [isHovered, setIsHovered] = useState(false);
        const [coords, setCoords] = useState({ x: 0, y: 0 });
        return (
            <div style={{ width: '100%', cursor: 'help' }}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onMouseMove={e => setCoords({ x: e.clientX, y: e.clientY })}>
                <div style={{ fontSize: 12, color, fontWeight: weight, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'wrap', width: '100%', display: 'block' }}>
                    {text || '—'}
                </div>
                {isHovered && text && text.length > 5 && (
                    <div style={{ position: 'fixed', top: coords.y + 15, left: Math.min(coords.x, window.innerWidth - 270), zIndex: 9999, background: '#1e293b', color: '#fff', padding: '8px 12px', borderRadius: '6px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.4)', fontSize: '11px', lineHeight: '1.4', maxWidth: '250px', pointerEvents: 'none', border: '1px solid #334155' }}>
                        {text}
                    </div>
                )}
            </div>
        );
    };

    const GRID_TEMPLATE = "40px 90px 180px 110px 130px 1fr 90px 100px";

    return (
        <div style={{ marginBottom: 24, border: '1px solid #fca5a5', borderRadius: 12, overflow: 'hidden', background: '#fff', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#fff5f5', borderBottom: '1px solid #fca5a5' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: '#E24B4A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Flag size={20} color="#fff" fill="#fff" />
                    </div>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#7f1d1d', lineHeight: 1.2 }}>Attention Required: Flagged Defects</div>
                        <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2, opacity: 0.8 }}>Fleet items marked for urgent follow-up</div>
                    </div>
                </div>
                <div style={{ background: '#fff', border: '1px solid #fca5a5', borderRadius: 8, padding: '6px 14px', textAlign: 'right' }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#E24B4A', display: 'block', lineHeight: 1 }}>{flagged.length}</span>
                    <span style={{ fontSize: 10, color: '#b91c1c', fontWeight: 600, textTransform: 'uppercase' }}>Total Items</span>
                </div>
            </div>
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {byVessel.map(([vessel, rows], vi) => {
                    const isOpen = expandedVessel === vessel;
                    return (
                        <div key={vessel} style={{ border: isOpen ? '1px solid #fca5a5' : '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
                            <div onClick={() => setExpandedVessel(isOpen ? null : vessel)}
                                style={{ display: 'grid', gridTemplateColumns: '30px auto 1fr auto 40px', alignItems: 'center', gap: 12, padding: '10px 18px', cursor: 'pointer', background: isOpen ? '#fffafa' : '#fff' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{vi + 1}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Ship size={17} color={isOpen ? '#E24B4A' : '#475569'} />
                                    <div style={{ fontSize: 14, fontWeight: 700, color: isOpen ? '#7f1d1d' : '#1e293b' }}>{vessel}</div>
                                </div>
                                <div />
                                <div style={{ fontSize: 12, fontWeight: 700, color: isOpen ? '#E24B4A' : '#64748b', background: isOpen ? '#fee2e2' : '#f1f5f9', padding: '2px 10px', borderRadius: '12px' }}>
                                    {rows.length} Items
                                </div>
                                <ChevronDown size={18} style={{ color: isOpen ? '#E24B4A' : '#cbd5e1', transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                            </div>
                            {isOpen && (
                                <div style={{ borderTop: '1px solid #fee2e2', background: '#fff' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: GRID_TEMPLATE, gap: 12, padding: '10px 20px', background: '#f8fafc', borderBottom: '1px solid #edf2f7' }}>
                                        {['#', 'Reported', 'Due Date', 'Source', 'Area', 'Description', 'Priority', 'Reference'].map((h, idx) => (
                                            <div key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#64748b', textAlign: (idx === 0 || idx >= 6) ? 'center' : 'left' }}>{h}</div>
                                        ))}
                                    </div>
                                    {rows.map((d, i) => {
                                        const badge = getDeadlineBadge(d.target_close_date);
                                        const pr = d.pr_entries?.filter(p => !p.is_deleted).map(p => p.pr_number).join(', ') || '—';
                                        return (
                                            <div key={d.id} style={{ display: 'grid', gridTemplateColumns: GRID_TEMPLATE, alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid #f1f5f9', height: '46px' }}>
                                                <div style={{ fontSize: 11, color: '#cbd5e1', fontWeight: 600, textAlign: 'center' }}>{i + 1}</div>
                                                <div style={{ fontSize: 12, color: '#475569' }}>{fmtDate(d.date_identified)}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}>{fmtDate(d.target_close_date)}</span>
                                                    {badge && <span style={{ fontSize: 8, fontWeight: 900, padding: '2px 6px', borderRadius: 4, ...badge.style, whiteSpace: 'nowrap' }}>{badge.label}</span>}
                                                </div>
                                                <HoverText text={d.defect_source} />
                                                <HoverText text={d.equipment_name} weight={700} color="#0f172a" />
                                                <HoverText text={d.description} />
                                                <div style={{ textAlign: 'center' }}>
                                                    <span style={{ fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 4, ...priorityStyle(d.priority) }}>{d.priority}</span>
                                                </div>
                                                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {pr !== '—' ? <span style={{ color: '#0369a1', background: '#f0f9ff', padding: '2px 6px', borderRadius: 4, border: '1px solid #bae6fd' }}>{pr}</span> : <span style={{ opacity: 0.5 }}>No PR</span>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Trend data builder ───────────────────────────────────────────────────────
function buildTrendData(defects, selectedDays) {
    const now = new Date();
    const startDate = new Date(now.getTime() - selectedDays * 24 * 60 * 60 * 1000);

    // Updated grouping thresholds
    let grouping;
    if (selectedDays <= 2) grouping = 'hourly';
    else if (selectedDays <= 30) grouping = 'daily';
    else if (selectedDays <= 180) grouping = 'weekly';
    else grouping = 'monthly';

    const buckets = [];

    if (grouping === 'hourly') {
        const totalHours = selectedDays * 24;
        for (let i = 0; i < totalHours; i++) {
            const start = new Date(startDate.getTime() + i * 60 * 60 * 1000);
            const end = new Date(start.getTime() + 60 * 60 * 1000);
            // Label: "01 Mar 10" (DD Mon HH)
            const day = start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
            const hour = start.getHours().toString().padStart(2, '0');
            buckets.push({ label: `${day} ${hour}`, start, end, created: 0, closed: 0 });
        }
    } else if (grouping === 'daily') {
        for (let i = 0; i < selectedDays; i++) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() + i);
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            // Label: "01 Mar"
            buckets.push({
                label: start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                start, end, created: 0, closed: 0,
                // Store month boundary info for separator lines
                isMonthStart: start.getDate() === 1,
                dayIndex: i,
            });
        }
    } else if (grouping === 'weekly') {
        const weeks = Math.ceil(selectedDays / 7);
        for (let i = 0; i < weeks; i++) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            start.setDate(start.getDate() + i * 7);
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            // Label: "01 Mar" (week start date)
            buckets.push({
                label: start.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                start, end, created: 0, closed: 0,
                weekIndex: i,
            });
        }
    } else {
        const months = Math.ceil(selectedDays / 30);
        const base = new Date(startDate);
        base.setDate(1); base.setHours(0, 0, 0, 0);
        for (let i = 0; i < months; i++) {
            const start = new Date(base);
            start.setMonth(start.getMonth() + i);
            const end = new Date(start);
            end.setMonth(end.getMonth() + 1);
            // Label: "Mar 25"
            buckets.push({
                label: start.toLocaleString('default', { month: 'short', year: '2-digit' }),
                start, end, created: 0, closed: 0,
                monthIndex: i,
                isYearStart: start.getMonth() === 0,
            });
        }
    }

    defects.forEach(d => {
        if (d.date_identified) {
            const dt = new Date(d.date_identified);
            if (dt >= startDate && dt <= now) {
                const b = buckets.find(b => dt >= b.start && dt < b.end);
                if (b) b.created++;
            }
        }
        if (d.status === 'CLOSED' && d.updated_at) {
            const dt = new Date(d.updated_at);
            if (dt >= startDate && dt <= now) {
                const b = buckets.find(b => dt >= b.start && dt < b.end);
                if (b) b.closed++;
            }
        }
    });

    return {
        labels: buckets.map(b => b.label),
        createdCounts: buckets.map(b => b.created),
        closedCounts: buckets.map(b => b.closed),
        grouping,
        buckets, // pass full bucket metadata for separator logic
    };
}
// ─── Readable range label ─────────────────────────────────────────────────────
function rangeLabel(days) {
    if (days === 1) return '1 day';
    if (days < 7) return `${days} days`;
    if (days < 30) return `${Math.round(days / 7)} wk${Math.round(days / 7) > 1 ? 's' : ''}`;
    if (days < 365) return `${Math.round(days / 30)} mo${Math.round(days / 30) > 1 ? 's' : ''}`;
    if (days === 730) return '2 years';
    return `${(days / 365).toFixed(1)} yrs`;
}

// ─── Main component ───────────────────────────────────────────────────────────
const AnalyticsDashboard = () => {
    const { user } = useAuth();
    const [selectedVessels, setSelectedVessels] = useState([]);
    const [selectedDays, setSelectedDays] = useState(180);  // ← NEW
    const chartRefs = useRef({});

    const { data: allDefects = [], isLoading, refetch } = useQuery({
        queryKey: ['defects', 'analytics'],
        queryFn: () => defectApi.getDefects(),
        staleTime: 2 * 60 * 1000,
    });

    const { data: allVessels = [] } = useQuery({
        queryKey: ['vessels', 'master-list'],
        queryFn: () => defectApi.getVessels(),
    });

    const vesselNames = useMemo(() =>
        [...new Set(allDefects.map(d => d.vessel_name).filter(Boolean))].sort(),
        [allDefects]);

    const defects = useMemo(() => {
        if (selectedVessels.length === 0) return allDefects;
        return allDefects.filter(d => selectedVessels.includes(d.vessel_name));
    }, [allDefects, selectedVessels]);

    const isFiltered = selectedVessels.length > 0;

    const stats = useMemo(() => {
        const total = defects.length;
        const open = defects.filter(d => d.status === 'OPEN').length;
        const closed = defects.filter(d => d.status === 'CLOSED').length;
        const pending = defects.filter(d => d.status === 'PENDING_CLOSURE').length;
        const critical = defects.filter(d => d.priority === 'CRITICAL').length;
        const high = defects.filter(d => d.priority === 'HIGH').length;
        const medium = defects.filter(d => d.priority === 'MEDIUM').length;
        const low = defects.filter(d => d.priority === 'LOW').length;
        const overdue = defects.filter(d =>
            getDeadlineStatus(d.target_close_date) === 'OVERDUE' &&
            d.status !== 'CLOSED' && d.status !== 'PENDING_CLOSURE'
        ).length;
        const warning = defects.filter(d =>
            getDeadlineStatus(d.target_close_date) === 'WARNING' && d.status !== 'CLOSED'
        ).length;
        const onTrack = defects.filter(d =>
            d.status !== 'CLOSED' && getDeadlineStatus(d.target_close_date) === 'NORMAL'
        ).length;
        return { total, open, closed, pending, critical, high, medium, low, overdue, warning, onTrack };
    }, [defects]);

    const vesselData = useMemo(() => {
        const source = isFiltered
            ? allDefects.filter(d => selectedVessels.includes(d.vessel_name))
            : allDefects;
        const map = {};
        source.forEach(d => {
            const name = d.vessel_name || 'Unknown';
            if (!map[name]) map[name] = { name, total: 0, open: 0, closed: 0, pending: 0, critical: 0, overdue: 0 };
            map[name].total++;
            if (d.status === 'OPEN') map[name].open++;
            if (d.status === 'CLOSED') map[name].closed++;
            if (d.status === 'PENDING_CLOSURE') map[name].pending++;
            if (d.priority === 'CRITICAL') map[name].critical++;
            if (getDeadlineStatus(d.target_close_date) === 'OVERDUE' &&
                d.status !== 'CLOSED' && d.status !== 'PENDING_CLOSURE')
                map[name].overdue++;
        });
        return Object.values(map).sort((a, b) => b.total - a.total);
    }, [allDefects, selectedVessels, isFiltered]);

    const overduePriorityData = useMemo(() => {
        const source = isFiltered
            ? allDefects.filter(d => selectedVessels.includes(d.vessel_name))
            : allDefects;
        const map = {};
        source.forEach(d => {
            const isOverdue =
                getDeadlineStatus(d.target_close_date) === 'OVERDUE' &&
                d.status !== 'CLOSED' && d.status !== 'PENDING_CLOSURE';
            if (!isOverdue) return;
            const vessel = d.vessel_name || 'Unknown';
            if (!map[vessel]) map[vessel] = { vessel, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
            const p = d.priority || 'LOW';
            if (map[vessel][p] !== undefined) map[vessel][p]++;
        });
        return Object.values(map).sort((a, b) =>
            (b.CRITICAL + b.HIGH + b.MEDIUM + b.LOW) - (a.CRITICAL + a.HIGH + a.MEDIUM + a.LOW)
        );
    }, [allDefects, selectedVessels, isFiltered]);

    const equipBreakdown = useMemo(() => {
        const map = {};
        defects.forEach(d => { const k = d.equipment_name || 'Unknown'; map[k] = (map[k] || 0) + 1; });
        return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
    }, [defects]);
    const maxEquip = useMemo(() => Math.max(...equipBreakdown.map(e => e[1]), 1), [equipBreakdown]);

    const sourceBreakdown = useMemo(() => {
        const map = {};
        defects.forEach(d => { const k = d.defect_source || 'Unknown'; map[k] = (map[k] || 0) + 1; });
        return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
    }, [defects]);

    // ── UPDATED: continuous day-based trend data ──────────────────────────────
    const trendData = useMemo(
        () => buildTrendData(defects, selectedDays),
        [defects, selectedDays]
    );

    const buildTrendChart = () => {
        if (!window.Chart) return;
        const trendCanvas = document.getElementById('trend-chart');
        if (!trendCanvas) return;
        chartRefs.current.trend?.destroy();

        const { labels, createdCounts, closedCounts, grouping, buckets } = trendData;

        const gridColors = labels.map((_, i) => {
            if (i === 0) return '#f1f5f9';
            if (grouping === 'daily') {
                if (buckets[i]?.start.getDate() === 1) return '#94a3b8';
                if (i % 7 === 0) return '#cbd5e1';
                return '#f1f5f9';
            }
            if (grouping === 'weekly') {
                if (i % 4 === 0) return '#94a3b8';
                return '#f1f5f9';
            }
            if (grouping === 'monthly') {
                if (buckets[i]?.isYearStart) return '#64748b';
                if (i % 3 === 0) return '#94a3b8';
                return '#f1f5f9';
            }
            if (grouping === 'hourly') {
                if (i % 24 === 0) return '#94a3b8';
                return '#f1f5f9';
            }
            return '#f1f5f9';
        });

        const maxTicksLimit =
            grouping === 'hourly' ? 24 :
                grouping === 'daily' ? 14 : 12;

        chartRefs.current.trend = new window.Chart(trendCanvas, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Reported',
                        data: createdCounts,
                        borderColor: '#ea580c',
                        backgroundColor: '#ea580c18',
                        fill: true, tension: 0.4, pointRadius: 4,
                        pointBackgroundColor: '#ea580c',
                        pointBorderColor: '#fff', pointBorderWidth: 2,
                        borderWidth: 2.5,
                    },
                    {
                        label: 'Closed',
                        data: closedCounts,
                        borderColor: '#16a34a',
                        backgroundColor: '#16a34a14',
                        fill: true, tension: 0.4, pointRadius: 4,
                        pointBackgroundColor: '#16a34a',
                        pointBorderColor: '#fff', pointBorderWidth: 2,
                        borderWidth: 2.5,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'white', borderColor: '#e2e8f0', borderWidth: 1,
                        titleColor: '#334155', bodyColor: '#64748b', padding: 10,
                        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}` },
                    },
                },
                scales: {
                    x: {
                        grid: {
                            display: true,
                            color: ctx => gridColors[ctx.index] ?? '#f1f5f9',
                            lineWidth: ctx => {
                                const c = gridColors[ctx.index];
                                if (c === '#64748b') return 2;
                                if (c === '#94a3b8') return 1.5;
                                if (c === '#cbd5e1') return 1;
                                return 0.5;
                            },
                        },
                        ticks: {
                            font: { size: 11 }, color: '#64748b',
                            maxRotation: 45, autoSkip: true, maxTicksLimit,
                        },
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' },
                        ticks: { stepSize: 1, font: { size: 11 }, color: '#64748b', precision: 0 },
                    },
                },
            },
        });
    };

    const buildVesselChart = () => {
        if (!window.Chart) return;
        const vesselCanvas = document.getElementById('vessel-bar-chart');
        if (!vesselCanvas) return;
        chartRefs.current.vessel?.destroy();
        const top8 = vesselData.slice(0, 8);
        const wrapper = vesselCanvas.parentElement;
        if (wrapper) wrapper.style.height = Math.max(top8.length * 46 + 80, 200) + 'px';
        chartRefs.current.vessel = new window.Chart(vesselCanvas, {
            type: 'bar',
            data: {
                labels: top8.map(v => v.name),
                datasets: [
                    { label: 'Open', data: top8.map(v => v.open), backgroundColor: '#3b82f6', borderRadius: 3 },
                    { label: 'Pending', data: top8.map(v => v.pending), backgroundColor: '#f59e0b', borderRadius: 3 },
                    { label: 'Critical', data: top8.map(v => v.critical), backgroundColor: '#dc2626', borderRadius: 3 },
                    { label: 'Closed', data: top8.map(v => v.closed), backgroundColor: '#22c55e55', borderRadius: 3 },
                ],
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { stacked: true, beginAtZero: true, ticks: { font: { size: 11 }, color: '#64748b' }, grid: { color: '#f1f5f9' } },
                    y: { stacked: true, ticks: { font: { size: 11 }, color: '#334155' }, grid: { display: false } },
                },
            },
        });
    };

    const buildOverdueChart = () => {
        if (!window.Chart) return;
        const overdueCanvas = document.getElementById('overdue-priority-chart');
        if (!overdueCanvas) return;
        chartRefs.current.overdue?.destroy();
        const data = overduePriorityData;
        const wrapper = overdueCanvas.parentElement;
        if (wrapper) wrapper.style.height = Math.max(data.length * 48 + 80, 160) + 'px';
        chartRefs.current.overdue = new window.Chart(overdueCanvas, {
            type: 'bar',
            data: {
                labels: data.map(v => v.vessel),
                datasets: [
                    { label: 'Critical', data: data.map(v => v.CRITICAL), backgroundColor: '#dc2626', borderRadius: 4 },
                    { label: 'High', data: data.map(v => v.HIGH), backgroundColor: '#f97316', borderRadius: 4 },
                    { label: 'Medium', data: data.map(v => v.MEDIUM), backgroundColor: '#2563eb', borderRadius: 4 },
                    { label: 'Low', data: data.map(v => v.LOW), backgroundColor: '#16a34a', borderRadius: 4 },
                ],
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: item => item.parsed.x === 0 ? null : ` ${item.dataset.label}: ${item.parsed.x}`,
                            footer: items => {
                                if (!items.length) return '';
                                const total = items[0].chart.data.datasets.reduce((sum, ds) =>
                                    sum + (Number(ds.data[items[0].dataIndex]) || 0), 0);
                                return `Total overdue: ${total}`;
                            },
                        },
                        filter: item => item.parsed.x > 0,
                    },
                },
                scales: {
                    x: {
                        stacked: true, beginAtZero: true,
                        title: { display: true, text: 'Overdue Defect Count', font: { size: 11 }, color: '#64748b' },
                        ticks: { font: { size: 11 }, color: '#64748b', stepSize: 1 },
                        grid: { color: '#f1f5f9' },
                    },
                    y: { stacked: true, ticks: { font: { size: 11 }, color: '#334155' }, grid: { display: false } },
                },
            },
        });
    };

    // ── Effect 1: Vessel + Overdue charts (NOT affected by selectedDays) ──
    useEffect(() => {
        if (!window.Chart) return;
        buildVesselChart();
        buildOverdueChart();
    }, [vesselData, overduePriorityData]);

    // ── Effect 2: Trend chart ONLY (responds to selectedDays + defects) ──
    useEffect(() => {
        if (!window.Chart) return;
        buildTrendChart();
    }, [trendData]);

    // ── Chart.js loader (runs once) ──
    useEffect(() => {
        if (!document.getElementById('chartjs-cdn')) {
            const s = document.createElement('script');
            s.id = 'chartjs-cdn';
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
            s.onload = () => {
                buildVesselChart();
                buildOverdueChart();
                buildTrendChart();
            };
            document.head.appendChild(s);
        } else {
            buildVesselChart();
            buildOverdueChart();
            buildTrendChart();
        }
    }, []);

    useEffect(() => () => {
        Object.values(chartRefs.current).forEach(c => c?.destroy?.());
    }, []);

    // Summary totals for the trend header pills
    const totalCreated = trendData.createdCounts.reduce((a, b) => a + b, 0);
    const totalClosed = trendData.closedCounts.reduce((a, b) => a + b, 0);

    if (isLoading) return <div className="dashboard-container">Loading Analytics...</div>;

    return (
        <div className="dashboard-container">

            {/* ── Slider thumb styles (injected once) ── */}
            <style>{`
                .drs-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    width: 18px; height: 18px; border-radius: 50%;
                    background: #ea580c; border: 2px solid white;
                    box-shadow: 0 1px 5px rgba(0,0,0,.3);
                    cursor: pointer; transition: transform .15s;
                }
                .drs-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
                .drs-slider::-moz-range-thumb {
                    width: 18px; height: 18px; border-radius: 50%;
                    background: #ea580c; border: 2px solid white;
                    box-shadow: 0 1px 5px rgba(0,0,0,.3); cursor: pointer;
                }
            `}</style>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 20, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <h1 className="page-title" style={{ margin: 0 }}>Fleet Analytics</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <VesselMultiSelector vessels={vesselNames} selected={selectedVessels} onChange={setSelectedVessels} />
                    {selectedVessels.length > 0 && (
                        <button onClick={() => setSelectedVessels([])}
                            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'white', color: '#64748b', border: '1px solid #cbd5e1', padding: '7px 12px', borderRadius: '6px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                            <X size={12} /> Clear
                        </button>
                    )}
                    <button onClick={() => refetch()}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'white', color: '#334155', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        <RefreshCcw size={13} /> Refresh
                    </button>
                </div>
            </div>

            {/* Filter banner */}
            {selectedVessels.length > 0 && (
                <div style={{ marginBottom: 18, padding: '9px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', fontSize: 13, color: '#9a3412', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, flexWrap: 'wrap' }}>
                    <Ship size={14} />
                    Filtered to:&nbsp;
                    {selectedVessels.map(v => (
                        <span key={v} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fed7aa', borderRadius: '10px', padding: '2px 10px', fontSize: 12 }}>
                            {v}
                            <X size={11} style={{ cursor: 'pointer' }} onClick={() => setSelectedVessels(selectedVessels.filter(s => s !== v))} />
                        </span>
                    ))}
                </div>
            )}

            {/* ── Row 1: Donut charts ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div className="table-card" style={{ padding: 0 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Status Distribution</span>
                    </div>
                    <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
                        <DonutChart size={100} label="total" data={[
                            { label: 'Open', value: stats.open, color: STATUS_COLORS.OPEN },
                            { label: 'Pending', value: stats.pending, color: STATUS_COLORS.PENDING_CLOSURE },
                            { label: 'Closed', value: stats.closed, color: STATUS_COLORS.CLOSED },
                        ]} />
                        <Legend items={[
                            { label: 'Open', value: stats.open, color: STATUS_COLORS.OPEN, pct: pct(stats.open, stats.total) },
                            { label: 'Pending Closure', value: stats.pending, color: STATUS_COLORS.PENDING_CLOSURE, pct: pct(stats.pending, stats.total) },
                            { label: 'Closed', value: stats.closed, color: STATUS_COLORS.CLOSED, pct: pct(stats.closed, stats.total) },
                        ]} />
                    </div>
                </div>

                <div className="table-card" style={{ padding: 0 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Priority Distribution</span>
                    </div>
                    <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
                        <DonutChart size={100} label="total" data={[
                            { label: 'Critical', value: stats.critical, color: PRIORITY_COLORS.CRITICAL },
                            { label: 'High', value: stats.high, color: PRIORITY_COLORS.HIGH },
                            { label: 'Medium', value: stats.medium, color: PRIORITY_COLORS.MEDIUM },
                            { label: 'Low', value: stats.low, color: PRIORITY_COLORS.LOW },
                        ]} />
                        <Legend items={[
                            { label: 'Critical', value: stats.critical, color: PRIORITY_COLORS.CRITICAL, pct: pct(stats.critical, stats.total) },
                            { label: 'High', value: stats.high, color: PRIORITY_COLORS.HIGH, pct: pct(stats.high, stats.total) },
                            { label: 'Medium', value: stats.medium, color: PRIORITY_COLORS.MEDIUM, pct: pct(stats.medium, stats.total) },
                            { label: 'Low', value: stats.low, color: PRIORITY_COLORS.LOW, pct: pct(stats.low, stats.total) },
                        ]} />
                    </div>
                </div>

                <div className="table-card" style={{ padding: 0 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Deadline Status</span>
                    </div>
                    <div style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
                        <DonutChart size={100} label="active" data={[
                            { label: 'On track', value: stats.onTrack, color: DEADLINE_COLORS.NORMAL },
                            { label: 'Warning', value: stats.warning, color: DEADLINE_COLORS.WARNING },
                            { label: 'Overdue', value: stats.overdue, color: DEADLINE_COLORS.OVERDUE },
                        ]} />
                        <Legend items={[
                            { label: 'On track', value: stats.onTrack, color: DEADLINE_COLORS.NORMAL, pct: pct(stats.onTrack, stats.open + stats.pending) },
                            { label: 'Within 15 days', value: stats.warning, color: DEADLINE_COLORS.WARNING, pct: pct(stats.warning, stats.open + stats.pending) },
                            { label: 'Overdue', value: stats.overdue, color: DEADLINE_COLORS.OVERDUE, pct: pct(stats.overdue, stats.open + stats.pending) },
                        ]} />
                    </div>
                </div>
            </div>

            

            {/* ── Row 2: Vessel breakdown ── */}
            <div className="table-card" style={{ padding: 0, marginBottom: 16 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Vessel Defect Breakdown</span>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#64748b' }}>
                        {[{ label: 'Open', color: '#3b82f6' }, { label: 'Pending', color: '#f59e0b' }, { label: 'Critical', color: '#dc2626' }, { label: 'Closed', color: '#22c55e55' }].map(l => (
                            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, display: 'inline-block' }} />{l.label}
                            </span>
                        ))}
                    </div>
                </div>
                <div style={{ padding: 16 }}>
                    <ChartCanvas id="vessel-bar-chart" height={Math.max(vesselData.slice(0, 8).length * 46 + 80, 200)} />
                </div>
            </div>
            {/* ── Flagged Defects ── */}
            <FlaggedDefectsPanel defects={defects} />
            {/* ── Row 3: Trend (with slider) + Equipment ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16 }}>

                {/* ── UPDATED TREND CARD ── */}
                <div className="table-card" style={{ padding: 0 }}>
                    {/* Header */}
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <TrendingUp size={14} color="#ea580c" />
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Defect Trend</span>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>· last {rangeLabel(selectedDays)}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            {/* Summary pills */}
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 10, background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: '#ea580c', display: 'inline-block' }} />
                                {totalCreated} reported
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 10, background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 7, height: 7, borderRadius: 2, background: '#16a34a', display: 'inline-block' }} />
                                {totalClosed} closed
                            </span>
                            {/* Legend */}
                            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#ea580c', display: 'inline-block' }} /> Reported</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#16a34a', display: 'inline-block' }} /> Closed</span>
                            </div>
                        </div>
                    </div>

                    {/* Chart */}
                    <div style={{ padding: '16px 16px 8px' }}>
                        <ChartCanvas id="trend-chart" height={200} />
                    </div>

                    {/* Slider */}
                    <div style={{ padding: '8px 20px 16px' }}>
                        {/* Track */}
                        <div style={{ position: 'relative', height: 20, marginBottom: 10 }}>
                            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 4, background: '#e2e8f0', borderRadius: 2, transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                            <div style={{ position: 'absolute', top: '50%', left: 0, height: 4, borderRadius: 2, background: '#ea580c', transform: 'translateY(-50%)', width: `${((selectedDays - 1) / 729) * 100}%`, transition: 'width .04s', pointerEvents: 'none' }} />
                            <input
                                type="range" min={1} max={730} step={1}
                                value={selectedDays}
                                onChange={e => setSelectedDays(Number(e.target.value))}
                                className="drs-slider"
                                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', appearance: 'none', background: 'transparent', outline: 'none', cursor: 'pointer', margin: 0, zIndex: 1 }}
                            />
                        </div>

                        {/* Indicator tick marks */}
                        <div style={{ position: 'relative', height: 18, marginBottom: 4 }}>
                            {[
                                { days: 1, label: '1D' },
                                { days: 7, label: '1W' },
                                { days: 30, label: '1M' },
                                { days: 90, label: '3M' },
                                { days: 180, label: '6M' },
                                { days: 365, label: '1Y' },
                                { days: 730, label: '2Y' },
                            ].map(({ days, label }) => {
                                const pctPos = ((days - 1) / 729) * 100;
                                const isActive = selectedDays >= days;
                                const isNearest = (() => {
                                    const snaps = [1, 7, 30, 90, 180, 365, 730];
                                    return snaps.reduce((a, b) =>
                                        Math.abs(b - selectedDays) < Math.abs(a - selectedDays) ? b : a
                                    ) === days;
                                })();
                                return (
                                    <div
                                        key={days}
                                        onClick={() => setSelectedDays(days)}
                                        style={{
                                            position: 'absolute',
                                            left: `${pctPos}%`,
                                            transform: 'translateX(-50%)',
                                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                                            cursor: 'pointer', userSelect: 'none',
                                        }}
                                    >
                                        <div style={{
                                            width: isNearest ? 3 : 1.5,
                                            height: isNearest ? 8 : 5,
                                            background: isNearest ? '#ea580c' : isActive ? '#f97316' : '#cbd5e1',
                                            borderRadius: 1,
                                            marginBottom: 2,
                                            transition: 'all .15s',
                                        }} />
                                        <span style={{
                                            fontSize: 9,
                                            fontWeight: isNearest ? 800 : 600,
                                            color: isNearest ? '#ea580c' : isActive ? '#94a3b8' : '#cbd5e1',
                                            letterSpacing: '0.03em',
                                            transition: 'all .15s',
                                        }}>
                                            {label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Current value pill */}
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 2 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#ea580c', padding: '2px 14px', borderRadius: 16, background: '#fff7ed', border: '1px solid #fed7aa' }}>
                                    {rangeLabel(selectedDays)}
                                </span>
                                <span style={{ fontSize: 9, color: '#cbd5e1', letterSpacing: '0.04em' }}>
                                    by {trendData.grouping}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Equipment — unchanged */}
                <div className="table-card" style={{ padding: 0 }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Top Areas of Concern</span>
                    </div>
                    <div style={{ padding: 16 }}>
                        {equipBreakdown.length === 0
                            ? <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>No data</div>
                            : equipBreakdown.map(([eq, cnt], i) => (
                                <HBar key={eq} label={eq} value={cnt} max={maxEquip} count={cnt}
                                    color={['#ea580c', '#f97316', '#dc2626', '#2563eb', '#16a34a', '#9333ea', '#0891b2', '#b45309'][i % 8]} />
                            ))
                        }
                    </div>
                </div>
            </div>

            {/* ── Row 4: Overdue by vessel + priority ── */}
            <div className="table-card" style={{ padding: 0, marginBottom: 16 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Overdue Defects by Vessel</span>
                        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 10 }}>broken down by priority — open & active only</span>
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#64748b' }}>
                        {[{ label: 'Critical', color: PRIORITY_COLORS.CRITICAL }, { label: 'High', color: PRIORITY_COLORS.HIGH }, { label: 'Medium', color: PRIORITY_COLORS.MEDIUM }, { label: 'Low', color: PRIORITY_COLORS.LOW }].map(l => (
                            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color, display: 'inline-block' }} />{l.label}
                            </span>
                        ))}
                    </div>
                </div>
                <div style={{ padding: 16 }}>
                    {overduePriorityData.length === 0
                        ? <div style={{ textAlign: 'center', color: '#16a34a', fontSize: 13, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <span style={{ fontSize: 18 }}>✓</span> No overdue defects{selectedVessels.length > 0 ? ' for selected vessels' : ' across the fleet'}
                        </div>
                        : <ChartCanvas id="overdue-priority-chart" height={Math.max(overduePriorityData.length * 48 + 80, 160)} />
                    }
                </div>
            </div>

            

            {/* ── Row 5: Defect sources ── */}
            <div className="table-card" style={{ padding: 0, marginBottom: 16 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Defect Sources</span>
                </div>
                <div style={{ padding: 16 }}>
                    {sourceBreakdown.length === 0
                        ? <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>No data</div>
                        : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                            {sourceBreakdown.map(([src, cnt], i) => {
                                const color = ['#ea580c', '#f97316', '#dc2626', '#2563eb', '#16a34a', '#9333ea'][i % 6];
                                return (
                                    <div key={src} style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>{src}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 11, color: '#94a3b8' }}>{pct(cnt, stats.total)}</span>
                                            <span style={{ fontSize: 13, fontWeight: 700, color, background: color + '18', padding: '2px 9px', borderRadius: '10px' }}>{cnt}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    }
                </div>
            </div>

        </div>
    );
};

export default AnalyticsDashboard;