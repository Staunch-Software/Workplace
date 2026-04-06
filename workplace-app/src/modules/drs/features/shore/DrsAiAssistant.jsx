/**
 * OpenClaw AI Assistant
 * Maritime Intelligence Co-pilot for DRS
 * 
 * Features:
 * - Maritime identity & personality
 * - Rich structured responses (cards, tables, defect links)
 * - Action buttons (navigate, open defect, email draft)
 * - Groq-powered with llama-3.3-70b-versatile
 * 
 * ENV: VITE_GROQ_API_KEY=gsk_xxx
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { defectApi } from '@drs/services/defectApi';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY;

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are OpenClaw, a sharp maritime operations AI co-pilot built into a Defect Reporting System (DRS) used by ship superintendents and fleet managers.

Your personality:
- Professional but direct — no fluff, no pleasantries beyond a brief greeting
- You speak like an experienced maritime superintendent, not a generic chatbot
- Use nautical/maritime terminology naturally (vessel, overdue, rectification, superintendent, flag state, etc.)
- You're confident and action-oriented

Your capabilities:
- Analyze fleet defect data in real-time
- Identify critical/overdue issues and flag risks
- Summarize vessel health
- Answer questions about specific vessels, defects, priorities

RESPONSE FORMAT RULES (strictly follow):
You must respond in JSON with this structure:
{
  "message": "your conversational response text",
  "type": "text" | "defect_list" | "vessel_summary" | "table" | "alert",
  "data": null | { ... structured data depending on type },
  "actions": [] | [{ "label": "button label", "type": "navigate" | "email" | "open_defect", "payload": "route or defect_id" }]
}

For defect_list type, data should be:
{ "defects": [{ "id": "...", "vessel": "...", "description": "...", "priority": "CRITICAL|HIGH|MEDIUM|LOW", "status": "OPEN|CLOSED|PENDING_CLOSURE", "deadline_status": "OVERDUE|NORMAL|...", "equipment": "..." }] }

For vessel_summary type, data should be:
{ "vessels": [{ "name": "...", "open": 0, "critical": 0, "overdue": 0, "health": "GOOD|WARNING|CRITICAL" }] }

For table type, data should be:
{ "headers": ["Col1","Col2"], "rows": [["val1","val2"]] }

For alert type, data should:
{ "severity": "critical|warning|info", "title": "...", "detail": "..." }

Actions are optional — only add when navigation or email would genuinely help the user act on the information.
Valid navigate payloads: "/drs/shore/dashboard", "/drs/shore/tasks", "/drs/shore/reports"
For open_defect, payload is the defect id string.
For email, payload is the defect id string.

Always be concise. Never repeat data you already showed. If insufficient data, say so.`;

// ─── CALL AI ─────────────────────────────────────────────────────────────────
async function callOpenClaw(messages) {
    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
            temperature: 0.3,
            response_format: { type: 'json_object' },
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `API ${res.status}`);
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    try {
        return JSON.parse(raw);
    } catch {
        return { message: raw, type: 'text', data: null, actions: [] };
    }
}

// ─── PRIORITY CONFIG ─────────────────────────────────────────────────────────
const PRIORITY_STYLE = {
    CRITICAL: { bg: '#fff1f1', color: '#dc2626', border: '#fecaca' },
    HIGH: { bg: '#fff7ed', color: '#ea580c', border: '#fed7aa' },
    MEDIUM: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
    LOW: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
};

const STATUS_STYLE = {
    OPEN: { bg: '#eff6ff', color: '#2563eb' },
    PENDING_CLOSURE: { bg: '#fefce8', color: '#ca8a04' },
    CLOSED: { bg: '#f0fdf4', color: '#16a34a' },
};

const HEALTH_STYLE = {
    CRITICAL: { color: '#dc2626', icon: '🔴' },
    WARNING: { color: '#ea580c', icon: '🟡' },
    GOOD: { color: '#16a34a', icon: '🟢' },
};

// ─── SUGGESTIONS ─────────────────────────────────────────────────────────────
const SUGGESTIONS = [
    'Fleet health briefing',
    'Show critical defects',
    'Which vessels are overdue?',
    'Pending closure summary',
];

// ─── STYLES ──────────────────────────────────────────────────────────────────
const FONT = "'IBM Plex Mono', 'Fira Code', 'Courier New', monospace";
const SANS = "'DM Sans', 'Segoe UI', system-ui, sans-serif";

const S = {
    fab: {
        position: 'fixed', bottom: '28px', right: '28px',
        width: '54px', height: '54px', borderRadius: '14px',
        background: 'linear-gradient(145deg, #0a2342 0%, #1a4a7a 100%)',
        border: '1px solid rgba(255,255,255,0.1)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 32px rgba(10,35,66,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        zIndex: 9998, transition: 'all 0.2s',
    },
    panel: {
        position: 'fixed', bottom: '96px', right: '28px',
        width: '400px', height: '600px', borderRadius: '18px',
        background: '#f8fafc',
        boxShadow: '0 24px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.07)',
        display: 'flex', flexDirection: 'column',
        zIndex: 9997, overflow: 'hidden',
        fontFamily: SANS,
        animation: 'ocSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
    },
    header: {
        background: 'linear-gradient(135deg, #0a2342 0%, #1a4a7a 50%, #0f3460 100%)',
        padding: '14px 16px 12px',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
    },
    headerGrid: {
        position: 'absolute', inset: 0, opacity: 0.06,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 20px, rgba(255,255,255,0.5) 20px, rgba(255,255,255,0.5) 21px), repeating-linear-gradient(90deg, transparent, transparent 20px, rgba(255,255,255,0.5) 20px, rgba(255,255,255,0.5) 21px)',
    },
    headerContent: { position: 'relative', display: 'flex', alignItems: 'center', gap: '10px' },
    clawIcon: {
        width: '36px', height: '36px', borderRadius: '10px',
        background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    headerName: { color: '#fff', fontSize: '15px', fontWeight: 700, fontFamily: FONT, letterSpacing: '-0.5px', margin: 0 },
    headerSub: { color: 'rgba(255,255,255,0.55)', fontSize: '10.5px', margin: 0, fontFamily: FONT, letterSpacing: '0.5px' },
    statusDot: {
        width: 7, height: 7, borderRadius: '50%', background: '#4ade80',
        boxShadow: '0 0 8px #4ade80', marginLeft: 'auto', flexShrink: 0,
    },
    messages: {
        flex: 1, overflowY: 'auto', padding: '14px 12px',
        display: 'flex', flexDirection: 'column', gap: '12px',
        background: '#f8fafc',
    },
    msgUser: {
        alignSelf: 'flex-end',
        background: 'linear-gradient(135deg, #0a2342, #1a4a7a)',
        color: '#fff', padding: '10px 14px',
        borderRadius: '14px 14px 3px 14px',
        fontSize: '13px', maxWidth: '82%', lineHeight: 1.5,
        wordBreak: 'break-word', fontFamily: SANS,
        boxShadow: '0 2px 12px rgba(10,35,66,0.25)',
    },
    msgAi: {
        alignSelf: 'flex-start',
        background: '#ffffff',
        color: '#1e293b', padding: '11px 14px',
        borderRadius: '14px 14px 14px 3px',
        fontSize: '13px', maxWidth: '90%', lineHeight: 1.6,
        wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        fontFamily: SANS,
    },
    msgError: {
        alignSelf: 'flex-start', background: '#fef2f2',
        border: '1px solid #fecaca', color: '#dc2626',
        padding: '10px 14px', borderRadius: '14px 14px 14px 3px',
        fontSize: '13px', maxWidth: '90%',
    },
    card: {
        background: '#fff', border: '1px solid #e2e8f0',
        borderRadius: '10px', overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
        marginTop: '6px',
    },
    cardHeader: {
        padding: '8px 12px', background: '#f8fafc',
        borderBottom: '1px solid #e2e8f0',
        fontSize: '11px', fontWeight: 700, color: '#64748b',
        fontFamily: FONT, letterSpacing: '0.5px', textTransform: 'uppercase',
    },
    defectRow: {
        padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
        cursor: 'pointer', transition: 'background 0.15s',
    },
    badge: {
        fontSize: '10px', fontWeight: 700, padding: '2px 8px',
        borderRadius: '20px', display: 'inline-block',
    },
    actionBtn: {
        display: 'inline-flex', alignItems: 'center', gap: '5px',
        padding: '6px 12px', borderRadius: '8px', fontSize: '12px',
        fontWeight: 600, cursor: 'pointer', border: 'none',
        transition: 'all 0.15s', fontFamily: SANS,
    },
    suggestions: {
        padding: '8px 12px 10px', display: 'flex',
        flexWrap: 'wrap', gap: '6px', flexShrink: 0,
        borderTop: '1px solid #f1f5f9', background: '#fff',
    },
    suggBtn: {
        background: '#f0f7ff', border: '1px solid #bfdbfe',
        borderRadius: '20px', padding: '5px 11px',
        fontSize: '11.5px', color: '#1d4ed8', cursor: 'pointer',
        transition: 'all 0.15s', fontFamily: SANS, fontWeight: 500,
    },
    inputRow: {
        padding: '10px 12px', borderTop: '1px solid #e2e8f0',
        display: 'flex', gap: '8px', alignItems: 'flex-end',
        flexShrink: 0, background: '#fff',
    },
    input: {
        flex: 1, resize: 'none', border: '1.5px solid #e2e8f0',
        borderRadius: '10px', padding: '9px 12px', fontSize: '13px',
        fontFamily: SANS, outline: 'none', background: '#f8fafc',
        color: '#1e293b', lineHeight: 1.45, transition: 'border 0.15s',
    },
    sendBtn: {
        width: '36px', height: '36px', borderRadius: '10px', border: 'none',
        background: 'linear-gradient(135deg, #0a2342, #1a4a7a)',
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'all 0.15s',
        boxShadow: '0 2px 8px rgba(10,35,66,0.3)',
    },
    typingWrap: {
        alignSelf: 'flex-start', background: '#fff',
        border: '1px solid #e2e8f0', padding: '12px 16px',
        borderRadius: '14px 14px 14px 3px',
        display: 'flex', gap: '5px', alignItems: 'center',
    },
    typingDot: { width: 7, height: 7, borderRadius: '50%', background: '#94a3b8' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
    th: { padding: '7px 10px', background: '#f1f5f9', color: '#475569', fontWeight: 700, textAlign: 'left', fontFamily: FONT, fontSize: '10px', letterSpacing: '0.3px' },
    td: { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', color: '#334155' },
};

// ─── RICH MESSAGE RENDERER ────────────────────────────────────────────────────
function RichMessage({ msg, onAction }) {
    if (msg.role === 'user') return <div style={S.msgUser}>{msg.content}</div>;
    if (msg.error) return <div style={S.msgError}>⚠️ {msg.content}</div>;

    const { message, type, data, actions } = msg.parsed || { message: msg.content, type: 'text', data: null, actions: [] };

    return (
        <div style={{ alignSelf: 'flex-start', maxWidth: '95%' }}>
            {/* Main message text */}
            {message && (
                <div style={S.msgAi}>{message}</div>
            )}

            {/* Defect list cards */}
            {type === 'defect_list' && data?.defects?.length > 0 && (
                <div style={{ ...S.card, marginTop: '6px' }}>
                    <div style={S.cardHeader}>⚓ {data.defects.length} Defect{data.defects.length !== 1 ? 's' : ''}</div>
                    {data.defects.map((d, i) => {
                        const ps = PRIORITY_STYLE[d.priority] || PRIORITY_STYLE.LOW;
                        const ss = STATUS_STYLE[d.status] || STATUS_STYLE.OPEN;
                        return (
                            <div
                                key={d.id || i}
                                style={S.defectRow}
                                onMouseEnter={e => e.currentTarget.style.background = '#f0f7ff'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1e293b', marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {d.vessel} {d.equipment ? `· ${d.equipment}` : ''}
                                        </div>
                                        <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                                            {d.description?.slice(0, 90)}{d.description?.length > 90 ? '…' : ''}
                                        </div>
                                        {d.deadline_status === 'OVERDUE' && (
                                            <div style={{ fontSize: '10.5px', color: '#dc2626', fontWeight: 700, marginTop: '3px', fontFamily: FONT }}>
                                                ⏰ OVERDUE
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end', flexShrink: 0 }}>
                                        <span style={{ ...S.badge, background: ps.bg, color: ps.color, border: `1px solid ${ps.border}` }}>{d.priority}</span>
                                        <span style={{ ...S.badge, background: ss.bg, color: ss.color }}>{d.status === 'PENDING_CLOSURE' ? 'PENDING' : d.status}</span>
                                    </div>
                                </div>
                                {/* Per-defect actions */}
                                {d.id && (
                                    <div style={{ display: 'flex', gap: '6px', marginTop: '7px' }}>
                                        <button
                                            style={{ ...S.actionBtn, background: '#eff6ff', color: '#2563eb', fontSize: '11px', padding: '4px 10px' }}
                                            onClick={() => onAction({ type: 'open_defect', payload: d.id })}
                                        >
                                            🔍 View
                                        </button>
                                        <button
                                            style={{ ...S.actionBtn, background: '#f0fdf4', color: '#16a34a', fontSize: '11px', padding: '4px 10px' }}
                                            onClick={() => onAction({ type: 'email', payload: d.id })}
                                        >
                                            ✉ Email
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Vessel summary cards */}
            {type === 'vessel_summary' && data?.vessels?.length > 0 && (
                <div style={{ ...S.card, marginTop: '6px' }}>
                    <div style={S.cardHeader}>🚢 Fleet Overview</div>
                    {data.vessels.map((v, i) => {
                        const hs = HEALTH_STYLE[v.health] || HEALTH_STYLE.GOOD;
                        return (
                            <div key={i} style={{ ...S.defectRow, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>{v.name}</div>
                                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontFamily: FONT }}>
                                        {v.open} open · {v.critical} critical · {v.overdue} overdue
                                    </div>
                                </div>
                                <div style={{ fontSize: '13px', fontWeight: 700, color: hs.color }}>
                                    {hs.icon} {v.health}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Table */}
            {type === 'table' && data?.headers && (
                <div style={{ ...S.card, marginTop: '6px', overflow: 'auto' }}>
                    <table style={S.table}>
                        <thead>
                            <tr>{data.headers.map((h, i) => <th key={i} style={S.th}>{h}</th>)}</tr>
                        </thead>
                        <tbody>
                            {data.rows?.map((row, i) => (
                                <tr key={i}>{row.map((cell, j) => <td key={j} style={S.td}>{cell}</td>)}</tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Alert */}
            {type === 'alert' && data && (
                <div style={{
                    ...S.card, marginTop: '6px', padding: '12px 14px',
                    borderLeft: `4px solid ${data.severity === 'critical' ? '#dc2626' : data.severity === 'warning' ? '#ea580c' : '#2563eb'}`,
                    background: data.severity === 'critical' ? '#fef2f2' : data.severity === 'warning' ? '#fff7ed' : '#eff6ff',
                }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b', marginBottom: '3px' }}>{data.title}</div>
                    <div style={{ fontSize: '12px', color: '#475569' }}>{data.detail}</div>
                </div>
            )}

            {/* Global action buttons */}
            {actions?.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                    {actions.map((a, i) => (
                        <button
                            key={i}
                            style={{ ...S.actionBtn, background: '#0a2342', color: '#fff', boxShadow: '0 2px 8px rgba(10,35,66,0.3)' }}
                            onClick={() => onAction(a)}
                        >
                            {a.type === 'navigate' ? '→' : a.type === 'email' ? '✉' : '🔍'} {a.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function OpenClawAssistant() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [defectData, setDefectData] = useState(null);
    const [vesselData, setVesselData] = useState(null);
    const bottomRef = useRef(null);
    const inputRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);

    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 100);
            if (!defectData) loadData();
        }
    }, [open]);

    const loadData = async () => {
        setFetching(true);
        try {
            const [defects, vessels] = await Promise.all([
                defectApi.getDefects(),
                defectApi.getVessels(),
            ]);
            setDefectData(defects);
            setVesselData(vessels);
            const critical = defects.filter(d => d.priority === 'CRITICAL' && d.status === 'OPEN').length;
            const overdue = defects.filter(d => d.deadline_status === 'OVERDUE').length;
            setMessages([{
                role: 'assistant',
                parsed: {
                    message: `OpenClaw online. Fleet data loaded — ${defects.length} defects across ${vessels.length} vessels.${critical > 0 ? `\n⚠️ ${critical} critical defect${critical > 1 ? 's' : ''} require attention.` : ''}${overdue > 0 ? `\n🔴 ${overdue} overdue.` : ''}`,
                    type: overdue > 0 || critical > 0 ? 'alert' : 'text',
                    data: overdue > 0 || critical > 0 ? {
                        severity: critical > 0 ? 'critical' : 'warning',
                        title: `${critical} Critical · ${overdue} Overdue`,
                        detail: `${defects.filter(d => d.status === 'OPEN').length} open defects across fleet. Immediate review recommended.`
                    } : null,
                    actions: [],
                },
            }]);
        } catch (e) {
            setMessages([{ role: 'assistant', error: true, content: 'Could not load fleet data. Check connection.' }]);
        } finally {
            setFetching(false);
        }
    };

    const buildContext = useCallback(() => {
        if (!defectData || !vesselData) return '';
        return `\n\n[LIVE FLEET DATA]\n${JSON.stringify({
            total_defects: defectData.length,
            vessels: vesselData.map(v => v.name || v.imo_number),
            open: defectData.filter(d => d.status === 'OPEN').length,
            closed: defectData.filter(d => d.status === 'CLOSED').length,
            pending: defectData.filter(d => d.status === 'PENDING_CLOSURE').length,
            critical: defectData.filter(d => d.priority === 'CRITICAL').length,
            high: defectData.filter(d => d.priority === 'HIGH').length,
            overdue: defectData.filter(d => d.deadline_status === 'OVERDUE').length,
            defects: defectData.filter(d => d.id).map(d => ({
                id: String(d.id),
                vessel: d.vessel_name || d.vessel_imo,
                equipment: d.equipment || d.equipment_name,
                description: d.description?.slice(0, 100),
                status: d.status,
                priority: d.priority,
                deadline_status: d.deadline_status,
            })),
        }, null, 2)}`;
    }, [defectData, vesselData]);

    const handleAction = useCallback(async (action) => {
        if (action.type === 'navigate') {
            navigate(action.payload);
        } else if (action.type === 'open_defect') {
            if (!action.payload) { alert('No defect ID provided.'); return; }
            navigate('/drs/shore/dashboard', { state: { autoOpenDefectId: String(action.payload) } });
        } else if (action.type === 'email') {
            try {
                const isValidId = action.payload &&
                    !['fleet_report', 'summary', 'report', 'all'].includes(action.payload) &&
                    action.payload.length > 8;
                if (!isValidId) {
                    alert('No specific defect selected. Click ✉ Email on an individual defect card.');
                    return;
                }
                const data = await defectApi.getEmailRecipients(action.payload);
                if (!data?.recipients || !data?.defect) throw new Error('Invalid response');
                const { recipients, defect: d } = data;
                const subject = `[DRS] ${d.title} | ${d.vessel_name}`;
                const body = [
                    `DEFECT REPORT — Maritime DRS`,
                    `Vessel: ${d.vessel_name}`, `Title: ${d.title}`,
                    `Priority: ${d.priority}`, `Status: ${d.status}`,
                    `Description: ${d.description}`,
                    `Generated by OpenClaw AI`,
                ].join('\n');
                window.open(`mailto:${recipients.join(';')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
            } catch (err) {
                console.error('[OpenClaw] Email action failed:', err);
                alert(`Could not prepare email draft: ${err.message}`);
            }
        }
    }, [navigate]);

    const send = async (text) => {
        const userText = (text || input).trim();
        if (!userText || loading || fetching) return;
        setInput('');

        const userMsg = { role: 'user', content: userText };
        setMessages(prev => [...prev, userMsg]);
        setLoading(true);

        try {
            const history = messages
                .filter(m => !m.error)
                .map(m => ({
                    role: m.role,
                    content: m.role === 'assistant'
                        ? (m.parsed?.message || m.content || '')
                        : m.content,
                }));

            const contextMsg = { role: 'user', content: userText + buildContext() };
            const aiHistory = [...history, contextMsg];
            const parsed = await callOpenClaw(aiHistory);

            setMessages(prev => [...prev, { role: 'assistant', parsed }]);
        } catch (e) {
            setMessages(prev => [...prev, {
                role: 'assistant', error: true,
                content: `Connection error: ${e.message}`,
            }]);
        } finally {
            setLoading(false);
        }
    };

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    const showSuggestions = messages.length <= 1 && !loading && !fetching;

    return (
        <>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=DM+Sans:wght@400;500;600;700&display=swap');
        @keyframes ocSlideUp {
          from { opacity:0; transform:translateY(24px) scale(0.95); }
          to   { opacity:1; transform:translateY(0) scale(1); }
        }
        @keyframes ocPulse { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }
        .oc-dot-1 { animation: ocPulse 1.2s infinite 0s; }
        .oc-dot-2 { animation: ocPulse 1.2s infinite 0.2s; }
        .oc-dot-3 { animation: ocPulse 1.2s infinite 0.4s; }
        .oc-fab:hover { transform:scale(1.07) translateY(-2px)!important; box-shadow:0 12px 40px rgba(10,35,66,0.6),0 4px 12px rgba(0,0,0,0.4)!important; }
        .oc-sugg:hover { background:#dbeafe!important; border-color:#93c5fd!important; }
        .oc-input:focus { border-color:#1a4a7a!important; background:#fff!important; box-shadow:0 0 0 3px rgba(26,74,122,0.1)!important; }
        .oc-send:hover { opacity:0.85; transform:scale(1.05); }
        .oc-messages::-webkit-scrollbar { width:3px; }
        .oc-messages::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:3px; }
        .oc-close:hover { background:rgba(255,255,255,0.15)!important; }
      `}</style>

            {/* FAB */}
            <button className="oc-fab" style={S.fab} onClick={() => setOpen(o => !o)} title="OpenClaw Assistant">
                {open ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L8 6H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-4-4z" />
                        <circle cx="9" cy="12" r="1.2" fill="#fff" /><circle cx="12" cy="12" r="1.2" fill="#fff" /><circle cx="15" cy="12" r="1.2" fill="#fff" />
                    </svg>
                )}
            </button>

            {open && (
                <div style={S.panel}>
                    {/* Header */}
                    <div style={S.header}>
                        <div style={S.headerGrid} />
                        <div style={S.headerContent}>
                            <div style={S.clawIcon}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round">
                                    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                                </svg>
                            </div>
                            <div>
                                <p style={S.headerName}>OPENCLAW</p>
                                <p style={S.headerSub}>MARITIME INTELLIGENCE · FLEET CO-PILOT</p>
                            </div>
                            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={S.statusDot} />
                                <button
                                    className="oc-close"
                                    onClick={() => setOpen(false)}
                                    style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="oc-messages" style={S.messages}>
                        {fetching ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#64748b', fontSize: '12.5px', padding: '8px', fontFamily: FONT }}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                                </svg>
                                Syncing fleet data...
                            </div>
                        ) : messages.map((m, i) => (
                            <RichMessage key={i} msg={m} onAction={handleAction} />
                        ))}

                        {loading && (
                            <div style={S.typingWrap}>
                                {[0, 1, 2].map(i => (
                                    <div key={i} className={`oc-dot-${i + 1}`} style={S.typingDot} />
                                ))}
                                <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: FONT, marginLeft: '4px' }}>OpenClaw is thinking...</span>
                            </div>
                        )}
                        <div ref={bottomRef} />
                    </div>

                    {/* Suggestions */}
                    {showSuggestions && (
                        <div style={S.suggestions}>
                            {SUGGESTIONS.map(s => (
                                <button key={s} className="oc-sugg" style={S.suggBtn} onClick={() => send(s)}>{s}</button>
                            ))}
                        </div>
                    )}

                    {/* Input */}
                    <div style={S.inputRow}>
                        <textarea
                            ref={inputRef}
                            className="oc-input"
                            style={{ ...S.input, height: '38px', maxHeight: '90px' }}
                            placeholder="Ask OpenClaw about your fleet..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKey}
                            rows={1}
                            disabled={fetching}
                        />
                        <button
                            className="oc-send"
                            style={{ ...S.sendBtn, opacity: (!input.trim() || loading || fetching) ? 0.4 : 1 }}
                            onClick={() => send()}
                            disabled={!input.trim() || loading || fetching}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}