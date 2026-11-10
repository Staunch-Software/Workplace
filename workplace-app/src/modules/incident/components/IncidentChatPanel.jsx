import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Paperclip, X, Download, Loader2, MessageSquare, Lock } from 'lucide-react';
import api, { errText } from '../api/axiosIncident';
import { fmtSize, fmtStamp, newId } from '../utils/format';

// Internal chat of an incident, adapted from ORB's AlertChatPanel: @mentions, attachments, read markers, polling.
// Everything written here is visible only to people with access to the module.
const MAX_FILES = 5;
const MAX_MB = 10;
const POLL_MS = 10000;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function MessageBody({ text, names }) {
  const parts = useMemo(() => {
    if (!text) return [];
    const list = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
    if (!list.length) return [text];
    const re = new RegExp(`(@(?:${list.map(escapeRegExp).join('|')}))`, 'gi');
    return text.split(re);
  }, [text, names]);
  return (
    <span>
      {parts.map((p, i) => (p.startsWith('@') && i % 2 === 1 ? <span key={i} className="ac-mention">{p}</span> : p))}
    </span>
  );
}

export default function IncidentChatPanel({ incidentId, currentUserId }) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mentionable, setMentionable] = useState([]);
  const [draft, setDraft] = useState('');
  const [tagged, setTagged] = useState({});
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState({ open: false, query: '', index: 0 });
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const lastCount = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/incidents/${incidentId}/threads`);
      setThreads(r.data.data || []);
      setError('');
    } catch (e) {
      setError(errText(e, 'Could not load the conversation'));
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => {
    setLoading(true);
    lastCount.current = 0;
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!loading && threads.length !== lastCount.current) {
      lastCount.current = threads.length;
      api.post(`/api/incidents/${incidentId}/threads/mark-read`).catch(() => {});
    }
  }, [threads, loading, incidentId]);

  useEffect(() => {
    api.get(`/api/incidents/${incidentId}/mentionable-users`)
      .then((r) => setMentionable(r.data.data || []))
      .catch(() => setMentionable([]));
  }, [incidentId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [threads.length]);

  const allNames = useMemo(() => [...mentionable.map((u) => u.name), ...threads.map((t) => t.author_name)], [mentionable, threads]);

  const pickerMatches = useMemo(() => {
    if (!picker.open) return [];
    const q = picker.query.toLowerCase();
    return mentionable.filter((u) => u.name.toLowerCase().includes(q)).slice(0, 8);
  }, [picker, mentionable]);

  const onDraftChange = (e) => {
    const value = e.target.value;
    setDraft(value);
    const before = value.slice(0, e.target.selectionStart);
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
    const at = draft.slice(0, pos).lastIndexOf('@');
    setDraft(`${draft.slice(0, at)}@${u.name} ${draft.slice(pos)}`);
    setTagged((t) => ({ ...t, [u.id]: u.name }));
    setPicker({ open: false, query: '', index: 0 });
    requestAnimationFrame(() => {
      if (el) { el.focus(); const p = at + u.name.length + 2; el.setSelectionRange(p, p); }
    });
  };

  const onKeyDown = (e) => {
    if (picker.open && pickerMatches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPicker((p) => ({ ...p, index: (p.index + 1) % pickerMatches.length })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPicker((p) => ({ ...p, index: (p.index - 1 + pickerMatches.length) % pickerMatches.length })); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(pickerMatches[picker.index]); return; }
    }
    if (e.key === 'Escape' && picker.open) { e.stopPropagation(); setPicker({ open: false, query: '', index: 0 }); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  };

  const addFiles = (list) => {
    const next = [...files];
    for (const f of Array.from(list || [])) {
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
    form.append('tagged_user_ids', ids.join(','));
    form.append('client_id', newId());
    files.forEach((f) => form.append('files', f));
    setSending(true);
    setError('');
    try {
      const r = await api.post(`/api/incidents/${incidentId}/threads`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      setThreads((t) => (t.some((x) => x.id === r.data.data.id) ? t : [...t, r.data.data]));
      setDraft(''); setTagged({}); setFiles([]);
    } catch (e) {
      setError(errText(e, 'Could not send the message'));
    } finally {
      setSending(false);
    }
  };

  const openAttachment = async (t, a) => {
    try {
      const r = await api.get(`/api/incidents/${incidentId}/threads/${t.id}/attachments/${a.id}`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch { setError('Could not open the file'); }
  };

  return (
    <div className="ac">
      <div className="ac-banner"><Lock size={13} /> Internal chat — only people with access to this module can see it</div>
      <div className="ac-list" ref={scrollRef}>
        {loading ? (
          <div className="ac-empty"><Loader2 size={18} className="inc-spin" /></div>
        ) : threads.length === 0 ? (
          <div className="ac-empty"><MessageSquare size={26} /><span>No messages yet. Start the conversation.</span></div>
        ) : threads.map((t) => {
          const mine = t.author_id === currentUserId;
          return (
            <div key={t.id} className={`ac-msg${mine ? ' ac-msg--mine' : ''}`}>
              <div className="ac-msg__meta">
                <strong>{mine ? 'You' : t.author_name}</strong>
                <span className="ac-when">{fmtStamp(t.created_at)}</span>
              </div>
              {t.body && <div className="ac-msg__body"><MessageBody text={t.body} names={allNames} /></div>}
              {t.attachments.map((a) => (
                <button key={a.id} type="button" className="ac-file" onClick={() => openAttachment(t, a)}>
                  <Download size={12} /> <span>{a.file_name}</span> <em>{fmtSize(a.file_size)}</em>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {error && <div className="inc-error ac-error" role="alert">{error}</div>}

      <div className="ac-composer">
        {picker.open && pickerMatches.length > 0 && (
          <ul className="ac-picker" role="listbox">
            {pickerMatches.map((u, i) => (
              <li key={u.id} role="option" aria-selected={i === picker.index}
                  className={`ac-picker__item${i === picker.index ? ' ac-picker__item--on' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); choose(u); }}>
                <span>{u.name}</span><em>{u.role === 'ADMIN' ? 'Admin' : 'Shore'}</em>
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
        <textarea ref={inputRef} className="ac-input" rows={3} value={draft} onChange={onDraftChange} onKeyDown={onKeyDown}
                  placeholder="Write a message… type @ to tag someone" disabled={sending} />
        <div className="ac-actions">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)}
                 accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.log,.xlsx,.xls,.docx,.doc" />
          <button type="button" className="inc-btn inc-btn--ghost" onClick={() => fileRef.current?.click()} disabled={sending || files.length >= MAX_FILES}>
            <Paperclip size={14} /> Attach
          </button>
          <span className="inc-hint ac-hint">Ctrl+Enter to send</span>
          <button type="button" className="inc-btn inc-btn--primary" onClick={send} disabled={sending || (!draft.trim() && files.length === 0)}>
            {sending ? <Loader2 size={14} className="inc-spin" /> : <Send size={14} />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
