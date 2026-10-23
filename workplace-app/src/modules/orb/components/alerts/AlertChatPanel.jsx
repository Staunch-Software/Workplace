import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Paperclip, X, Download, Lock, Loader2, MessageSquare, ClipboardCheck, CheckCircle2, Ban, Clock } from 'lucide-react';
import api from '../../api/axiosOrb';

const MAX_FILES = 5;
const MAX_MB = 10;
const POLL_MS = 10000;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

// Message text with "@Name" of known people highlighted.
function MessageBody({ text, names }) {
  const parts = useMemo(() => {
    if (!text) return [];
    const list = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!list.length) return [text];
    const re = new RegExp(`(@(?:${list.map(escapeRegExp).join('|')}))`, 'gi');
    return text.split(re);
  }, [text, names]);
  return (
    <span className="ac-text">
      {parts.map((p, i) => (p.startsWith('@') && i % 2 === 1 ? <span key={i} className="ac-mention">{p}</span> : p))}
    </span>
  );
}

export default function AlertChatPanel({ alertId, isShore, currentUserId, alert, onAction, refreshKey = 0 }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('external');           // shore only: 'external' | 'internal'
  const [mentionable, setMentionable] = useState([]);
  const [draft, setDraft] = useState('');
  const [tagged, setTagged] = useState({});               // id -> name picked from the @ list
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState({ open: false, query: '', index: 0 });
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const lastCount = useRef(0);

  const internal = isShore && mode === 'internal';

  // Locked like a closed DRS thread: for everyone once the alert is resolved, and for the vessel while shore
  // reviews its resolution request (shore may still write). The API refuses the message as well.
  const status = alert.status || (alert.is_resolved ? 'RESOLVED' : 'OPEN');
  const resolved = status === 'RESOLVED';
  const pending = status === 'PENDING_APPROVAL';
  const locked = resolved || (pending && !isShore);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/alerts/${alertId}/threads`);
      setThreads(r.data.data || []);
      setError('');
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not load the conversation');
    } finally {
      setLoading(false);
    }
  }, [alertId]);

  // Load, then poll while the tab is visible.
  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // The popup changed something (a resolution step wrote a system line): show it now, not at the next poll.
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey, load]);

  // Opening the chat marks it read (other people's new messages stop counting as unread).
  useEffect(() => {
    if (!loading && threads.length !== lastCount.current) {
      lastCount.current = threads.length;
      api.post(`/api/alerts/${alertId}/threads/mark-read`).catch(() => {});
    }
  }, [threads, loading, alertId]);

  useEffect(() => {
    api.get(`/api/alerts/${alertId}/mentionable-users`, { params: { internal } })
      .then(r => setMentionable(r.data.data || []))
      .catch(() => setMentionable([]));
  }, [alertId, internal]);

  const visible = useMemo(() => threads.filter(t => (isShore ? t.is_internal === internal : !t.is_internal)), [threads, isShore, internal]);
  const internalCount = threads.filter(t => t.is_internal).length;
  const externalCount = threads.filter(t => !t.is_internal && !t.is_system).length;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible.length]);

  const allNames = useMemo(() => [...mentionable.map(u => u.name), ...threads.map(t => t.author_name)], [mentionable, threads]);

  const pickerMatches = useMemo(() => {
    if (!picker.open) return [];
    const q = picker.query.toLowerCase();
    return mentionable.filter(u => u.name.toLowerCase().includes(q)).slice(0, 8);
  }, [picker, mentionable]);

  const onDraftChange = (e) => {
    const value = e.target.value;
    setDraft(value);
    const pos = e.target.selectionStart;
    const before = value.slice(0, pos);
    const at = before.lastIndexOf('@');
    if (at !== -1 && (at === 0 || /\s/.test(before[at - 1])) && !before.slice(at + 1).includes('\n')) {
      setPicker({ open: true, query: before.slice(at + 1), index: 0 });
    } else if (picker.open) {
      setPicker({ open: false, query: '', index: 0 });
    }
  };

  const choose = (u) => {
    const el = inputRef.current;
    const pos = el ? el.selectionStart : draft.length;
    const before = draft.slice(0, pos);
    const at = before.lastIndexOf('@');
    const next = `${draft.slice(0, at)}@${u.name} ${draft.slice(pos)}`;
    setDraft(next);
    setTagged(t => ({ ...t, [u.id]: u.name }));
    setPicker({ open: false, query: '', index: 0 });
    requestAnimationFrame(() => {
      if (el) { el.focus(); const p = at + u.name.length + 2; el.setSelectionRange(p, p); }
    });
  };

  const onKeyDown = (e) => {
    if (picker.open && pickerMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPicker(p => ({ ...p, index: (p.index + 1) % pickerMatches.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPicker(p => ({ ...p, index: (p.index - 1 + pickerMatches.length) % pickerMatches.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(pickerMatches[picker.index]); return; }
    }
    if (e.key === 'Escape' && picker.open) { e.stopPropagation(); setPicker({ open: false, query: '', index: 0 }); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    const next = [...files];
    for (const f of incoming) {
      if (f.size > MAX_MB * 1024 * 1024) { setError(`${f.name} is larger than ${MAX_MB} MB`); continue; }
      if (next.length >= MAX_FILES) { setError(`At most ${MAX_FILES} files per message`); break; }
      next.push(f);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = '';
  };

  const send = async () => {
    const body = draft.trim();
    if ((!body && files.length === 0) || sending) return;
    const ids = Object.entries(tagged).filter(([, name]) => body.includes(`@${name}`)).map(([id]) => id);
    const form = new FormData();
    form.append('body', body);
    form.append('is_internal', String(internal));
    form.append('tagged_user_ids', ids.join(','));
    form.append('client_id', newId());
    files.forEach(f => form.append('files', f));
    setSending(true);
    setError('');
    try {
      const r = await api.post(`/api/alerts/${alertId}/threads`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setThreads(t => (t.some(x => x.id === r.data.data.id) ? t : [...t, r.data.data]));
      setDraft(''); setTagged({}); setFiles([]);
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not send the message');
    } finally {
      setSending(false);
    }
  };

  const openAttachment = async (t, a) => {
    try {
      const r = await api.get(`/api/alerts/${alertId}/threads/${t.id}/attachments/${a.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError('Could not open the file');
    }
  };

  return (
    <div className="ac">
      {isShore && (
        <div className="ac-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!internal} className={`ac-tab${!internal ? ' ac-tab--on' : ''}`} onClick={() => setMode('external')}>
            External <span className="ac-tab__n">{externalCount}</span>
          </button>
          <button type="button" role="tab" aria-selected={internal} className={`ac-tab ac-tab--internal${internal ? ' ac-tab--on' : ''}`} onClick={() => setMode('internal')}>
            <Lock size={12} /> Internal <span className="ac-tab__n">{internalCount}</span>
          </button>
        </div>
      )}
      {internal && <div className="ac-banner"><Lock size={13} /> Internal note — visible to shore users only</div>}

      <div className="ac-list" ref={scrollRef}>
        {loading ? (
          <div className="ac-empty"><Loader2 size={18} className="ac-spin" /></div>
        ) : visible.length === 0 ? (
          <div className="ac-empty"><MessageSquare size={26} /><span>{internal ? 'No internal notes yet.' : 'No messages yet. Start the conversation.'}</span></div>
        ) : visible.map(t => {
          if (t.is_system) {
            const tone = /rejected/i.test(t.body) ? ' ac-sys--rejected' : /accepted|resolved by/i.test(t.body) ? ' ac-sys--ok' : '';
            return (
              <div key={t.id} className={`ac-sys${tone}`}>
                {t.body}
                <span className="ac-sys__when">{fmtWhen(t.created_at)}</span>
              </div>
            );
          }
          const mine = t.author_id === currentUserId;
          return (
            <div key={t.id} className={`ac-msg${mine ? ' ac-msg--mine' : ''}${t.is_internal ? ' ac-msg--internal' : ''}`}>
              <div className="ac-msg__meta">
                <strong>{mine ? 'You' : t.author_name}</strong>
                <span className="ac-role">{t.author_role === 'VESSEL' ? 'Vessel' : 'Shore'}</span>
                <span className="ac-when">{fmtWhen(t.created_at)}</span>
              </div>
              {t.body && <div className="ac-msg__body"><MessageBody text={t.body} names={allNames} /></div>}
              {t.attachments.map(a => (
                <button key={a.id} type="button" className="ac-file" onClick={() => openAttachment(t, a)}>
                  <Download size={12} /> <span>{a.file_name}</span> <em>{fmtSize(a.file_size)}</em>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {error && <div className="ac-error" role="alert">{error}</div>}

      {/* The resolution notes live in the conversation, as the closure remarks do in DRS */}
      {pending && (
        <div className="ac-res ac-res--pending">
          <div className="ac-res__head"><ClipboardCheck size={16} /><strong>Resolution requested</strong></div>
          <div className="ac-res__meta">{alert.resolution_requested_by_name} · {fmtWhen(alert.resolution_requested_at)}</div>
          <div className="ac-res__text">{alert.resolution_notes || 'No notes provided.'}</div>
          {isShore ? (
            <div className="ac-res__actions">
              <button type="button" className="ac-btn ac-btn--ok" onClick={() => onAction?.('accept')}>Accept</button>
              <button type="button" className="ac-btn ac-btn--no" onClick={() => onAction?.('reject')}>Reject</button>
            </div>
          ) : (
            <div className="ac-res__wait"><Clock size={13} /> Awaiting shore approval</div>
          )}
        </div>
      )}
      {resolved && (
        <div className="ac-res ac-res--resolved">
          <div className="ac-res__head"><CheckCircle2 size={16} /><strong>Alert resolved</strong></div>
          <div className="ac-res__meta">{alert.resolved_by_name}{alert.resolved_at ? ` · ${fmtWhen(alert.resolved_at)}` : ''}</div>
          <div className="ac-res__text">{alert.resolution_notes || 'No notes were recorded.'}</div>
        </div>
      )}
      {status === 'OPEN' && (alert.rejection_reason || alert.rejected_at) && (
        <div className="ac-res ac-res--rejected">
          <div className="ac-res__head"><Ban size={16} /><strong>Resolution request rejected</strong></div>
          <div className="ac-res__meta">{alert.rejected_by_name} · {fmtWhen(alert.rejected_at)}</div>
          {alert.rejection_reason && <div className="ac-res__text">{alert.rejection_reason}</div>}
        </div>
      )}

      {locked ? (
        <div className="ac-locked" role="status">
          <Lock size={14} />
          <span>{resolved ? 'Thread locked (alert resolved)' : 'Thread locked while shore reviews your resolution request'}</span>
        </div>
      ) : (
      <div className="ac-composer">
        {picker.open && pickerMatches.length > 0 && (
          <ul className="ac-picker" role="listbox">
            {pickerMatches.map((u, i) => (
              <li key={u.id} role="option" aria-selected={i === picker.index}
                  className={`ac-picker__item${i === picker.index ? ' ac-picker__item--on' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); choose(u); }}>
                <span>{u.name}</span><em>{u.role === 'VESSEL' ? 'Vessel' : 'Shore'}</em>
              </li>
            ))}
          </ul>
        )}
        {files.length > 0 && (
          <div className="ac-files">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="ac-chip">
                <Paperclip size={11} /> {f.name} <em>{fmtSize(f.size)}</em>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className={`ac-input${internal ? ' ac-input--internal' : ''}`}
          rows={3}
          value={draft}
          onChange={onDraftChange}
          onKeyDown={onKeyDown}
          placeholder={internal ? 'Internal note for shore… type @ to tag someone' : 'Write a message… type @ to tag someone'}
          disabled={sending}
        />
        <div className="ac-actions">
          <input ref={fileRef} type="file" multiple hidden onChange={e => addFiles(e.target.files)}
                 accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.xlsx,.xls,.docx,.doc" />
          <button type="button" className="ac-btn ac-btn--ghost" onClick={() => fileRef.current?.click()} disabled={sending || files.length >= MAX_FILES}>
            <Paperclip size={14} /> Attach
          </button>
          <span className="ac-hint">Ctrl+Enter to send</span>
          <button type="button" className="ac-btn ac-btn--send" onClick={send} disabled={sending || (!draft.trim() && files.length === 0)}>
            {sending ? <Loader2 size={14} className="ac-spin" /> : <Send size={14} />} Send
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
