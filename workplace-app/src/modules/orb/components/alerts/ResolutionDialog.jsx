import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Check, Ban, ClipboardCheck, ShieldCheck, Loader2, Info, AlertCircle } from 'lucide-react';
import api from '../../api/axiosOrb';
import './ResolutionDialog.css';

export const MIN_NOTES = 20;   // characters, for a resolution request and for a direct resolve (same rule as the API)

const SEVERITY_LABEL = { critical: 'Critical', major: 'Major', minor: 'Minor', observation: 'Observation' };

// What each resolution step asks for, how it looks and which call it makes.
export const ACTIONS = {
  request: {
    title: 'Request Resolution', icon: Send, tone: 'orange', field: 'Resolution notes', required: true,
    placeholder: 'Describe what was done on board to fix this alert… (minimum 20 characters)',
    info: 'Shore will review your notes and either accept the resolution or send the alert back to you.',
    submit: 'Send Request', busy: 'Sending…',
    call: (id, text) => api.post(`/api/alerts/${id}/request-resolution`, { notes: text }),
  },
  resolve: {
    title: 'Resolve Alert', icon: ShieldCheck, tone: 'green', field: 'Resolution notes', required: true,
    placeholder: 'Record why this alert can be closed… (minimum 20 characters)',
    info: 'The alert is marked resolved right away. Your notes are saved with it and appear in the Excel and PDF exports.',
    submit: 'Resolve Alert', busy: 'Resolving…',
    call: (id, text) => api.patch(`/api/alerts/${id}/resolve`, { notes: text }),
  },
  accept: {
    title: 'Accept Resolution', icon: Check, tone: 'green', field: 'Note for the vessel', required: false,
    placeholder: 'Add a note for the vessel (optional)',
    info: 'The alert will be marked resolved and the vessel will be notified.',
    submit: 'Accept Resolution', busy: 'Accepting…',
    call: (id, text) => api.post(`/api/alerts/${id}/accept-resolution`, { notes: text }),
  },
  reject: {
    title: 'Reject Resolution', icon: Ban, tone: 'red', field: 'Reason for rejecting', required: false,
    placeholder: 'Tell the vessel what still needs to be fixed (optional)',
    info: 'The alert goes back to Open and the vessel is notified with your reason.',
    submit: 'Reject Resolution', busy: 'Rejecting…',
    call: (id, text) => api.post(`/api/alerts/${id}/reject-resolution`, { reason: text }),
  },
};

// The notes dialog of a resolution step: a window of its own above the alert popup (as in DRS).
export default function ResolutionDialog({ action, alert, vesselName, busy, error, onSubmit, onCancel }) {
  const cfg = ACTIONS[action];
  const Icon = cfg.icon;
  const [text, setText] = useState('');
  const area = useRef(null);
  const len = text.trim().length;
  const valid = !cfg.required || len >= MIN_NOTES;
  const progress = cfg.required ? Math.min(100, Math.round((len / MIN_NOTES) * 100)) : 0;

  useEffect(() => {
    area.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);

  const submit = () => { if (valid && !busy) onSubmit(text.trim()); };

  const dialog = (
    <div className="rd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <form className={`rd rd--${cfg.tone}`} role="dialog" aria-modal="true" aria-labelledby="rd-title"
            onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <header className="rd-head">
          <span className="rd-head__icon"><Icon size={20} /></span>
          <div className="rd-head__text">
            <h2 id="rd-title" className="rd-title">{cfg.title}</h2>
            <p className="rd-sub">{alert.alert_type.replace(/_/g, ' ')}{vesselName ? ` · ${vesselName}` : ''}</p>
          </div>
          <button type="button" className="rd-x" onClick={onCancel} disabled={busy} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="rd-body">
          <div className="rd-card">
            <div className="rd-card__label">Alert details</div>
            <div className="rd-card__row">
              <span className={`am-sev am-sev--${alert.severity}`}>{SEVERITY_LABEL[alert.severity] || alert.severity}</span>
              {alert.page_number != null && <span className="rd-chip">Page {alert.page_number}</span>}
              {vesselName && <span className="rd-chip">{vesselName}</span>}
            </div>
            <p className="rd-card__msg">{alert.message}</p>
            {action === 'accept' || action === 'reject' ? (
              alert.resolution_notes && (
                <div className="rd-quote">
                  <span className="rd-quote__by">Vessel notes{alert.resolution_requested_by_name ? ` · ${alert.resolution_requested_by_name}` : ''}</span>
                  {alert.resolution_notes}
                </div>
              )
            ) : null}
          </div>

          <label className="rd-label" htmlFor="rd-text">
            {cfg.field}{cfg.required && <span className="rd-req"> *</span>}
          </label>
          <textarea
            id="rd-text" ref={area} className={`rd-input${cfg.required && len > 0 ? (valid ? ' rd-input--ok' : ' rd-input--short') : ''}`}
            rows={5} value={text} maxLength={2000} placeholder={cfg.placeholder} disabled={busy}
            onChange={e => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
          />
          {cfg.required ? (
            <div className="rd-meter" aria-live="polite">
              <span className="rd-meter__bar"><span className={`rd-meter__fill${valid ? ' rd-meter__fill--ok' : ''}`} style={{ width: `${progress}%` }} /></span>
              <span className={`rd-meter__text${valid ? ' rd-meter__text--ok' : ''}`}>
                {len}/{MIN_NOTES} characters {valid ? '✓' : 'minimum'}
              </span>
            </div>
          ) : (
            <div className="rd-meter"><span className="rd-meter__text">{len > 0 ? `${len} characters` : 'Optional'}</span></div>
          )}

          <div className="rd-info"><Info size={15} /><span>{cfg.info}</span></div>
          {error && <div className="rd-error" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}
        </div>

        <footer className="rd-foot">
          <button type="button" className="rd-btn rd-btn--cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="rd-btn rd-btn--go" disabled={!valid || busy}>
            {busy ? <Loader2 size={15} className="rd-spin" /> : <Icon size={15} />}
            {busy ? cfg.busy : cfg.submit}
          </button>
        </footer>
      </form>
    </div>
  );

  return createPortal(dialog, document.querySelector('.orb-root') || document.body);
}
