import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';

// The popup is mounted at the top of the module (.inc-root) instead of where it is opened from. Opened from inside
// another popup (the incident's header strip is a clipped scroll area) it could otherwise be trapped in that layer
// and show behind it. .inc-root also carries the colour tokens the popup's styles use.
const mountPoint = () => document.querySelector('.inc-root') || document.body;

// In-app confirmation popup, used in place of the browser's window.confirm.
// `onConfirm` may be async; the buttons are locked while it runs. The caller closes the dialog (clears its state).
export default function ConfirmDialog({
  title, message, detail, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm, onCancel,
}) {
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(null);

  useEffect(() => { cancelRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); onCancel(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy, onCancel]);

  const run = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  };

  return createPortal(
    <div className="inc-backdrop inc-backdrop--confirm" role="presentation"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="inc-confirm" role="alertdialog" aria-modal="true" aria-labelledby="inc-confirm-title">
        <div className={`inc-confirm__icon${danger ? ' inc-confirm__icon--danger' : ''}`}><AlertTriangle size={22} /></div>
        <h2 id="inc-confirm-title" className="inc-confirm__title">{title}</h2>
        {message && <p className="inc-confirm__msg">{message}</p>}
        {detail && <p className="inc-confirm__detail">{detail}</p>}
        <div className="inc-confirm__actions">
          <button ref={cancelRef} type="button" className="inc-btn inc-btn--ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={`inc-btn ${danger ? 'inc-btn--dangersolid' : 'inc-btn--primary'}`} onClick={run} disabled={busy}>
            {busy && <Loader2 size={14} className="inc-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    mountPoint(),
  );
}
