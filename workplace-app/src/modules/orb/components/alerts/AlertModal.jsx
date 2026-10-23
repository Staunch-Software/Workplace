import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Check, FileText, FileSearch, MessageSquare, ChevronsLeftRight, Loader2, AlertTriangle, Send, Clock, Ban, CheckCircle2,
} from 'lucide-react';
import api from '../../api/axiosOrb';
import AlertChatPanel from './AlertChatPanel';
import './AlertModal.css';

const SEVERITY_LABEL = { critical: 'Critical', major: 'Major', minor: 'Minor', observation: 'Observation' };
const MIN_NOTES = 20;   // characters, for a resolution request and for a direct resolve (same rule as the API)

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// What each resolution action asks for and calls.
const ACTIONS = {
  request: { title: 'Request resolution', hint: 'Explain what was done to fix this. Shore will accept or reject your request.', label: 'Notes', required: true,
             submit: 'Send request', call: (id, text) => api.post(`/api/alerts/${id}/request-resolution`, { notes: text }) },
  resolve: { title: 'Resolve alert', hint: 'Record why this alert can be closed. It is saved with the alert and shown in the exports.', label: 'Resolution notes', required: true,
             submit: 'Resolve', call: (id, text) => api.patch(`/api/alerts/${id}/resolve`, { notes: text }) },
  accept:  { title: 'Accept resolution', hint: 'The alert will be marked resolved. You can add a note for the vessel.', label: 'Note (optional)', required: false,
             submit: 'Accept', call: (id, text) => api.post(`/api/alerts/${id}/accept-resolution`, { notes: text }) },
  reject:  { title: 'Reject resolution', hint: 'The alert goes back to open and the vessel is told. A reason helps them fix it.', label: 'Reason (optional)', required: false,
             submit: 'Reject', call: (id, text) => api.post(`/api/alerts/${id}/reject-resolution`, { reason: text }) },
};

// A PDF served by the API as a blob (an iframe cannot send the bearer token itself).
function usePdfBlob(path, enabled) {
  const [state, setState] = useState({ url: null, loading: !!enabled, error: '' });
  useEffect(() => {
    if (!enabled) { setState({ url: null, loading: false, error: '' }); return undefined; }
    let live = true;
    let objectUrl = null;
    setState({ url: null, loading: true, error: '' });
    api.get(path, { responseType: 'blob', timeout: 60000 })
      .then(r => {
        objectUrl = URL.createObjectURL(r.data);
        if (live) setState({ url: objectUrl, loading: false, error: '' });
      })
      .catch(async (e) => {
        let msg = 'Could not load this page';
        try { msg = JSON.parse(await e.response.data.text()).detail || msg; } catch (_) { /* keep default */ }
        if (live) setState({ url: null, loading: false, error: msg });
      });
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, enabled]);
  return state;
}

function Pane({ icon: Icon, title, note, collapsed, onToggle, wide, children }) {
  return (
    <section className={`am-pane${collapsed ? ' am-pane--collapsed' : ''}${wide ? ' am-pane--chat' : ''}`}>
      {collapsed ? (
        <button type="button" className="am-pane__bar" onClick={onToggle} title={`Show ${title}`}>
          <Icon size={18} /><span>{title}</span>
        </button>
      ) : (
        <>
          <header className="am-pane__head">
            <Icon size={15} /><strong>{title}</strong>
            {note && <span className="am-pane__note">{note}</span>}
            <button type="button" className="am-pane__fold" onClick={onToggle} aria-label={`Collapse ${title}`} title="Collapse">
              <ChevronsLeftRight size={15} />
            </button>
          </header>
          <div className="am-pane__body">{children}</div>
        </>
      )}
    </section>
  );
}

function PdfView({ state, title }) {
  if (state.loading) return <div className="am-state"><Loader2 size={22} className="am-spin" /><span>Loading page…</span></div>;
  if (state.error) return <div className="am-state am-state--error"><AlertTriangle size={20} /><span>{state.error}</span></div>;
  return <iframe className="am-frame" title={title} src={state.url} />;
}

// The notes box for a resolution step.
function ActionPanel({ action, busy, error, onSubmit, onCancel }) {
  const cfg = ACTIONS[action];
  const [text, setText] = useState('');
  const short = cfg.required && text.trim().length < MIN_NOTES;
  return (
    <form className="am-act" onSubmit={(e) => { e.preventDefault(); if (!short && !busy) onSubmit(text.trim()); }}>
      <div className="am-act__title">{cfg.title}</div>
      <p className="am-act__hint">{cfg.hint}</p>
      <label className="am-act__label" htmlFor="am-act-text">{cfg.label}</label>
      <textarea id="am-act-text" className="am-act__input" rows={3} value={text} maxLength={2000} autoFocus
                onChange={e => setText(e.target.value)} disabled={busy} />
      <div className="am-act__row">
        {cfg.required && (
          <span className={`am-act__count${short ? ' am-act__count--short' : ''}`}>
            {text.trim().length}/{MIN_NOTES} characters minimum
          </span>
        )}
        {error && <span className="am-act__error" role="alert">{error}</span>}
        <span className="am-act__spacer" />
        <button type="button" className="am-btn am-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className={`am-btn${action === 'reject' ? ' am-btn--danger' : ''}`} disabled={short || busy}>
          {busy ? <Loader2 size={14} className="am-spin" /> : action === 'request' ? <Send size={14} /> : action === 'reject' ? <Ban size={14} /> : <Check size={14} />} {cfg.submit}
        </button>
      </div>
    </form>
  );
}

// What happened to the alert so far, in words.
function StatusNote({ alert }) {
  if (alert.status === 'PENDING_APPROVAL') {
    return (
      <div className="am-note am-note--pending">
        <Clock size={15} />
        <div>
          <strong>Awaiting shore approval.</strong> Requested by {alert.resolution_requested_by_name} on {fmtWhen(alert.resolution_requested_at)}.
          {alert.resolution_notes && <div className="am-note__text">{alert.resolution_notes}</div>}
        </div>
      </div>
    );
  }
  if (alert.status === 'RESOLVED' || alert.is_resolved) {
    return (
      <div className="am-note am-note--resolved">
        <CheckCircle2 size={15} />
        <div>
          <strong>Resolved</strong>{alert.resolved_by_name ? ` by ${alert.resolved_by_name}` : ''}{alert.resolved_at ? ` on ${fmtWhen(alert.resolved_at)}` : ''}.
          {alert.resolution_notes && <div className="am-note__text">{alert.resolution_notes}</div>}
        </div>
      </div>
    );
  }
  if (alert.rejection_reason || alert.rejected_at) {
    return (
      <div className="am-note am-note--rejected">
        <Ban size={15} />
        <div>
          <strong>Resolution rejected</strong> by {alert.rejected_by_name} on {fmtWhen(alert.rejected_at)}.
          {alert.rejection_reason && <div className="am-note__text">{alert.rejection_reason}</div>}
        </div>
      </div>
    );
  }
  return null;
}

export default function AlertModal({ alert: initial, vesselName, isShore, currentUserId, onClose, onChanged, startAction }) {
  const [alert, setAlert] = useState(initial);
  const [info, setInfo] = useState(null);
  const [action, setAction] = useState(startAction && ACTIONS[startAction] ? startAction : null);
  const [busy, setBusy] = useState(false);
  const [chatTick, setChatTick] = useState(0);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState({ extracted: false, raw: false, chat: false });

  const status = alert.status || (alert.is_resolved ? 'RESOLVED' : 'OPEN');
  const resolved = status === 'RESOLVED';
  const pending = status === 'PENDING_APPROVAL';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !action) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose, action]);

  useEffect(() => {
    let live = true;
    setInfo(null);
    api.get(`/api/alerts/${initial.id}/page-info`)
      .then(r => { if (live) setInfo(r.data.data); })
      .catch(() => { if (live) setInfo({ has_page: false, reason: 'Page information is not available.' }); });
    return () => { live = false; };
  }, [initial.id]);

  const hasPage = !!info?.has_page;
  const extracted = usePdfBlob(`/api/alerts/${alert.id}/extracted-page`, hasPage);
  const raw = usePdfBlob(`/api/alerts/${alert.id}/raw-page`, hasPage);

  // Keep at least one pane open.
  const toggle = useCallback((key) => {
    setCollapsed(c => {
      const next = { ...c, [key]: !c[key] };
      return next.extracted && next.raw && next.chat ? c : next;
    });
  }, []);

  const submit = async (text) => {
    setBusy(true);
    setError('');
    try {
      const r = await ACTIONS[action].call(alert.id, text);
      // the response has no page / chat counts: keep the ones the list gave us
      setAlert(a => ({ ...a, ...r.data.data, page_number: a.page_number, upload_id: a.upload_id, thread_count: a.thread_count, unread_count: a.unread_count }));
      onChanged?.(r.data.data);
      setChatTick(t => t + 1);
      setAction(null);
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not complete this action');
    } finally {
      setBusy(false);
    }
  };

  const open = (a) => { setError(''); setAction(a); };

  const pageNote = info?.has_page && info.raw_page
    ? `PDF page ${info.raw_page}${info.part ? ` (${info.part} part)` : ''}${info.approximate ? ' · approximate' : ''}`
    : null;

  // Which resolution buttons this person gets, given the alert's status.
  const buttons = [];
  if (!resolved) {
    if (isShore && pending) {
      buttons.push(['accept', 'Accept', 'am-btn--resolve'], ['reject', 'Reject', 'am-btn--danger']);
    } else if (isShore) {
      buttons.push(['resolve', 'Resolve', 'am-btn--resolve']);
    } else if (!pending) {
      buttons.push(['request', 'Request resolution', 'am-btn--resolve']);
    }
    if (isShore && pending) buttons.push(['resolve', 'Resolve directly', 'am-btn--ghost']);
  }

  const modal = (
    <div className="am-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !action) onClose(); }}>
      <div className="am" role="dialog" aria-modal="true" aria-label="Alert details">
        <header className="am-head">
          <div className="am-head__main">
            <div className="am-head__row">
              <span className={`am-sev am-sev--${alert.severity}`}>{SEVERITY_LABEL[alert.severity] || alert.severity}</span>
              <h2 className="am-title">{alert.alert_type.replace(/_/g, ' ')}</h2>
              {resolved && <span className="am-resolved"><Check size={13} /> Resolved</span>}
              {pending && <span className="am-pendingchip"><Clock size={13} /> Pending approval</span>}
            </div>
            <p className="am-msg">{alert.message}</p>
            <div className="am-meta">
              {vesselName && <span>{vesselName}</span>}
              {alert.page_number != null && <span>Extracted page {alert.page_number}</span>}
              {pageNote && <span>{pageNote}</span>}
            </div>
          </div>
          <div className="am-head__actions">
            {!action && buttons.map(([key, label, cls]) => (
              <button key={key} type="button" className={`am-btn ${cls}`} onClick={() => open(key)}>{label}</button>
            ))}
            <button type="button" className="am-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </header>
        <StatusNote alert={alert} />
        {action && <ActionPanel key={action} action={action} busy={busy} error={error} onSubmit={submit} onCancel={() => { setAction(null); setError(''); }} />}
        {info?.approximate && (
          <div className="am-warn"><AlertTriangle size={14} /> This upload predates page tracking, so the PDF page shown may be off by a split page.</div>
        )}

        <div className="am-body">
          {info === null ? (
            <div className="am-state am-state--grow"><Loader2 size={22} className="am-spin" /></div>
          ) : hasPage ? (
            <>
              <Pane icon={FileSearch} title="System extracted" note={`Page ${info.extracted_page}`} collapsed={collapsed.extracted} onToggle={() => toggle('extracted')}>
                <PdfView state={extracted} title="System extracted page" />
              </Pane>
              <Pane icon={FileText} title="Original PDF" note={info.raw_page ? `Page ${info.raw_page}` : ''} collapsed={collapsed.raw} onToggle={() => toggle('raw')}>
                <PdfView state={raw} title="Original PDF page" />
              </Pane>
            </>
          ) : (
            <div className="am-nopage">
              <FileText size={26} />
              <span>{info.reason || 'This alert is not tied to a single page.'}</span>
            </div>
          )}
          <Pane icon={MessageSquare} title="Conversation" collapsed={collapsed.chat} onToggle={() => toggle('chat')} wide>
            <AlertChatPanel alertId={alert.id} isShore={isShore} currentUserId={currentUserId} resolved={resolved} refreshKey={chatTick} />
          </Pane>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.querySelector('.orb-root') || document.body);
}
