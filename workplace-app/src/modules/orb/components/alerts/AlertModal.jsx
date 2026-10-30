import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Check, FileText, FileSearch, MessageSquare, ChevronsLeftRight, Loader2, AlertTriangle, Clock,
  ChevronLeft, ChevronRight, MailOpen, ExternalLink,
} from 'lucide-react';
import api from '../../api/axiosOrb';
import AlertChatPanel from './AlertChatPanel';
import ResolutionDialog, { ACTIONS } from './ResolutionDialog';
import './AlertModal.css';
import { fmtDateTime } from '../../utils/time';

const SEVERITY_LABEL = { critical: 'Critical', major: 'Major', minor: 'Minor', observation: 'Observation' };

const fmtWhen = fmtDateTime;

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

export default function AlertModal({ alert: initial, vesselName, isShore, currentUserId, onClose, onChanged, startAction, viewer }) {
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

  // Opened from the feed: the arrow keys walk through the list, as in DRS.
  useEffect(() => {
    if (!viewer || action) return undefined;
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
      if (e.key === 'ArrowLeft' && viewer.hasPrev) viewer.onPrev();
      if (e.key === 'ArrowRight' && viewer.hasNext) viewer.onNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [viewer, action]);

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
            {viewer && (
              <div className="am-viewer">
                <button type="button" className="am-iconbtn" onClick={viewer.onPrev} disabled={!viewer.hasPrev} aria-label="Previous" title="Previous (←)"><ChevronLeft size={16} /></button>
                <span className="am-viewer__pos">{viewer.position}</span>
                <button type="button" className="am-iconbtn" onClick={viewer.onNext} disabled={!viewer.hasNext} aria-label="Next" title="Next (→)"><ChevronRight size={16} /></button>
                {viewer.canMarkUnread && (
                  <button type="button" className="am-btn am-btn--ghost" onClick={viewer.onMarkUnread}><MailOpen size={14} /> Mark as unread</button>
                )}
                <button type="button" className="am-btn am-btn--ghost" onClick={viewer.onGoToAlert}><ExternalLink size={14} /> Go to alert</button>
              </div>
            )}
            {buttons.map(([key, label, cls]) => (
              <button key={key} type="button" className={`am-btn ${cls}`} onClick={() => open(key)}>{label}</button>
            ))}
            <button type="button" className="am-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        </header>
        {info?.approximate && (
          <div className="am-warn"><AlertTriangle size={14} /> This upload predates page tracking, so the PDF page shown may be off by a split page.</div>
        )}

        <div className={`am-body${collapsed.extracted && collapsed.raw ? ' am-body--chatonly' : ''}`}>
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
            <AlertChatPanel alertId={alert.id} isShore={isShore} currentUserId={currentUserId} alert={alert} onAction={open} refreshKey={chatTick} />
          </Pane>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(modal, document.querySelector('.orb-root') || document.body)}
      {action && (
        <ResolutionDialog
          key={action} action={action} alert={alert} vesselName={vesselName} busy={busy} error={error}
          onSubmit={submit} onCancel={() => { setAction(null); setError(''); }}
        />
      )}
    </>
  );
}
