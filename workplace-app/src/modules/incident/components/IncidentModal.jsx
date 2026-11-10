import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X, Pencil, Lock, Unlock, Loader2, Paperclip, Upload, Trash2, Ship, CalendarDays, Tag,
  ChevronLeft, ChevronRight, FileText, ListChecks, Images, PenLine, MessageSquare,
} from 'lucide-react';
import api, { errText, openFile } from '../api/axiosIncident';
import IncidentForm from './IncidentForm';
import FileTab from './FileTab';
import PhotoGallery from './PhotoGallery';
import IncidentChatPanel from './IncidentChatPanel';
import ConfirmDialog from './ConfirmDialog';
import { fmtDay } from '../utils/format';

const TABS = [
  ['sof', 'SOF', FileText],
  ['log', 'Alarm & event log', ListChecks],
  ['photos', 'Photo evidence', Images],
  ['writeup', 'Free write-up', PenLine],
];

function WriteupTab({ incident, canEdit, onIncidentChange }) {
  const [text, setText] = useState(incident.writeup || '');
  const [saved, setSaved] = useState(incident.writeup || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dirty = text !== saved;

  const save = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.patch(`/api/incidents/${incident.id}`, { writeup: text });
      setSaved(text);
      onIncidentChange(r.data.data);
    } catch (e) { setError(errText(e, 'Could not save')); } finally { setSaving(false); }
  };

  return (
    <div className="inc-tabpane">
      <label className="inc-field inc-field--grow">Free write-up
        <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={!canEdit}
                  placeholder={canEdit ? 'Write the narrative of the incident here…' : 'No write-up recorded.'} />
      </label>
      {error && <div className="inc-error" role="alert">{error}</div>}
      {canEdit && (
        <div className="inc-row">
          <button type="button" className="inc-btn inc-btn--primary" onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 size={14} className="inc-spin" />} Save write-up
          </button>
          {dirty && <span className="inc-hint">Unsaved changes</span>}
        </div>
      )}
    </div>
  );
}

// The report attachment(s): shown in the header strip, uploaded here.
function ReportFiles({ incident, canEdit, files, onFilesChange, setError }) {
  const reports = files.filter((f) => f.kind === 'REPORT');
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const ref = useRef(null);

  const upload = async (list) => {
    if (!list?.length) return;
    const form = new FormData();
    form.append('kind', 'REPORT');
    Array.from(list).forEach((f) => form.append('files', f));
    setUploading(true);
    try {
      const r = await api.post(`/api/incidents/${incident.id}/files`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      onFilesChange([...files, ...r.data.data]);
    } catch (e) { setError(errText(e, 'Upload failed')); } finally {
      setUploading(false);
      if (ref.current) ref.current.value = '';
    }
  };

  const remove = async () => {
    const f = toDelete;
    try {
      await api.delete(`/api/incidents/${incident.id}/files/${f.id}`);
      onFilesChange(files.filter((x) => x.id !== f.id));
    } catch (e) { setError(errText(e, 'Could not delete the file')); } finally { setToDelete(null); }
  };

  return (
    <div className="inc-reportfiles">
      <span className="inc-label">Report attachment</span>
      {reports.length === 0 && <span className="inc-muted">None</span>}
      {reports.map((f) => (
        <span key={f.id} className="inc-chip">
          <button type="button" className="inc-filelink" onClick={() => openFile(incident.id, f.id).catch(() => setError('Could not open the file'))}>
            <Paperclip size={12} /> {f.file_name}
          </button>
          {canEdit && <button type="button" className="inc-iconbtn inc-iconbtn--sm" onClick={() => setToDelete(f)} aria-label={`Delete ${f.file_name}`}><Trash2 size={12} /></button>}
        </span>
      ))}
      {toDelete && (
        <ConfirmDialog danger title="Delete report attachment?" message={toDelete.file_name}
                       detail="This removes the attachment from the incident and cannot be undone."
                       confirmLabel="Delete" onConfirm={remove} onCancel={() => setToDelete(null)} />
      )}
      {canEdit && (
        <>
          <input ref={ref} type="file" hidden multiple onChange={(e) => upload(e.target.files)} accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt" />
          <button type="button" className="inc-btn inc-btn--ghost inc-btn--sm" onClick={() => ref.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={12} className="inc-spin" /> : <Upload size={12} />} Upload
          </button>
        </>
      )}
    </div>
  );
}

// An incident, opened as a popup over the list (like the DRS feed popup): header facts, the evidence tabs on the
// left half and the internal chat on the right. Arrow buttons / keys step through the incidents of the list.
export default function IncidentModal({ id, me, siblings = [], onNavigate, onClose, onChanged }) {
  const [incident, setIncident] = useState(null);
  const [files, setFiles] = useState([]);
  const [tab, setTab] = useState('sof');
  const [pane, setPane] = useState('evidence');   // narrow screens: which half is shown
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dirtyRef = useRef(false);

  const idx = siblings.indexOf(id);
  const prevId = idx > 0 ? siblings[idx - 1] : null;
  const nextId = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  const load = useCallback(async () => {
    setLoading(true);
    setIncident(null);
    try {
      const r = await api.get(`/api/incidents/${id}`);
      const { files: f, ...rest } = r.data.data;
      setIncident(rest);
      setFiles(f || []);
      setError('');
    } catch (e) {
      setError(errText(e, 'Could not load the incident'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); setTab('sof'); }, [load]);

  const close = useCallback(() => {
    if (dirtyRef.current) onChanged?.();
    onClose();
  }, [onChanged, onClose]);

  // Anything saved here shows in the list (thumbnail, report, status), so the list is refreshed on the way out.
  const markChanged = () => { dirtyRef.current = true; };
  const merge = (next) => { markChanged(); setIncident((i) => ({ ...i, ...next })); };
  const setFilesChanged = (next) => { markChanged(); setFiles(next); };

  useEffect(() => {
    const onKey = (e) => {
      if (document.querySelector('.inc-lightbox, .inc-backdrop--form, .inc-backdrop--confirm')) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape') close();
      if (!typing && e.key === 'ArrowLeft' && prevId) onNavigate(prevId);
      if (!typing && e.key === 'ArrowRight' && nextId) onNavigate(nextId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, prevId, nextId, onNavigate]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const changeStatus = async () => {
    const closing = incident.status === 'DRAFT';
    setBusy(true);
    try {
      const r = await api.post(`/api/incidents/${id}/${closing ? 'close' : 'reopen'}`);
      merge(r.data.data);
    } catch (e) { setError(errText(e, 'Could not change the status')); } finally { setBusy(false); setConfirmClose(false); }
  };
  // Closing locks the details, so it asks first; reopening is harmless and goes straight through.
  const toggleStatus = () => (incident.status === 'DRAFT' ? setConfirmClose(true) : changeStatus());

  const canEdit = !!me?.can_create && incident?.status === 'DRAFT';

  return (
    <div className="inc-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <button type="button" className="inc-swipe inc-swipe--l" onClick={() => prevId && onNavigate(prevId)} disabled={!prevId} aria-label="Previous incident">
        <ChevronLeft size={22} />
      </button>
      <div className="inc-dialog" role="dialog" aria-modal="true" aria-label="Incident">
        {loading ? (
          <div className="inc-dialog__center"><Loader2 size={24} className="inc-spin" /></div>
        ) : !incident ? (
          <div className="inc-dialog__center">
            <div className="inc-error" role="alert">{error || 'Incident not found'}</div>
            <button type="button" className="inc-btn inc-btn--ghost" onClick={close}>Close</button>
          </div>
        ) : (
          <>
            <header className="inc-dhead">
              <div className="inc-dhead__top">
                <div className="inc-dhead__title">
                  <h2>{incident.incident_no}</h2>
                  <span className={`inc-badge inc-badge--${incident.status.toLowerCase()}`}>{incident.status === 'DRAFT' ? 'Draft' : 'Closed'}</span>
                  {incident.offhire && <span className="inc-badge inc-badge--off">Off-hire</span>}
                </div>
                <div className="inc-dhead__actions">
                  {canEdit && <button type="button" className="inc-btn inc-btn--ghost" onClick={() => setEditing(true)}><Pencil size={14} /> Edit details</button>}
                  {me?.can_create && (
                    <button type="button" className={`inc-btn ${incident.status === 'DRAFT' ? 'inc-btn--primary' : 'inc-btn--ghost'}`} onClick={toggleStatus} disabled={busy}>
                      {busy ? <Loader2 size={14} className="inc-spin" /> : incident.status === 'DRAFT' ? <Lock size={14} /> : <Unlock size={14} />}
                      {incident.status === 'DRAFT' ? 'Close incident' : 'Reopen'}
                    </button>
                  )}
                  <button type="button" className="inc-closebtn" onClick={close} title="Close (Esc)" aria-label="Close"><X size={18} /></button>
                </div>
              </div>
              <div className="inc-facts">
                <span><Ship size={14} /> {incident.vessel_name}</span>
                <span><CalendarDays size={14} /> {fmtDay(incident.incident_date)}</span>
                {incident.category && <span><Tag size={14} /> {incident.category}</span>}
                {siblings.length > 1 && idx >= 0 && <span className="inc-facts__pos">{idx + 1} of {siblings.length}</span>}
              </div>
              <div className="inc-summary">
                <div><span className="inc-label">Description</span><p>{incident.description || <span className="inc-muted">—</span>}</p></div>
                {incident.offhire && <div><span className="inc-label">Offhire record</span><p>{incident.offhire_details || <span className="inc-muted">Off-hire, no details</span>}</p></div>}
                <div><span className="inc-label">Comments</span><p>{incident.comments || <span className="inc-muted">—</span>}</p></div>
              </div>
              <ReportFiles incident={incident} canEdit={canEdit} files={files} onFilesChange={setFilesChanged} setError={setError} />
              {error && <div className="inc-error" role="alert">{error}</div>}
              {incident.status === 'CLOSED' && (
                <div className="inc-note"><Lock size={13} /> This incident is closed. {me?.can_create ? 'Reopen it to make changes. ' : ''}The chat stays open.</div>
              )}
            </header>

            <div className="inc-mobiletabs" role="tablist">
              <button type="button" role="tab" aria-selected={pane === 'evidence'} className={pane === 'evidence' ? 'on' : ''} onClick={() => setPane('evidence')}>Evidence</button>
              <button type="button" role="tab" aria-selected={pane === 'chat'} className={pane === 'chat' ? 'on' : ''} onClick={() => setPane('chat')}><MessageSquare size={13} /> Chat</button>
            </div>

            <div className="inc-split">
              <section className={`inc-half${pane === 'evidence' ? '' : ' inc-half--hidden'}`} aria-label="Evidence">
                <div className="inc-tabs" role="tablist">
                  {TABS.map(([key, label, Icon]) => (
                    <button key={key} type="button" role="tab" aria-selected={tab === key}
                            className={`inc-tab${tab === key ? ' inc-tab--on' : ''}`} onClick={() => setTab(key)}>
                      <Icon size={14} /> {label}
                      {key === 'photos' && <span className="inc-tab__n">{files.filter((f) => f.kind === 'PHOTO').length}</span>}
                    </button>
                  ))}
                </div>
                <div className="inc-tabbody">
                  {tab === 'sof' && <FileTab incident={incident} kind="SOF" notesField="sof_notes" notesLabel="Statement of facts" canEdit={canEdit}
                                             files={files} onFilesChange={setFilesChanged} onIncidentChange={merge} />}
                  {tab === 'log' && <FileTab incident={incident} kind="LOG" notesField="log_notes" notesLabel="Alarm log and event log notes" canEdit={canEdit}
                                             files={files} onFilesChange={setFilesChanged} onIncidentChange={merge} />}
                  {tab === 'photos' && <PhotoGallery incident={incident} canEdit={canEdit} files={files} onFilesChange={setFilesChanged} />}
                  {tab === 'writeup' && <WriteupTab incident={incident} canEdit={canEdit} onIncidentChange={merge} />}
                </div>
              </section>
              <section className={`inc-half inc-half--chat${pane === 'chat' ? '' : ' inc-half--hidden'}`} aria-label="Internal chat">
                <div className="inc-halfhead"><MessageSquare size={15} /> Internal chat</div>
                <IncidentChatPanel incidentId={incident.id} currentUserId={me?.id} />
              </section>
            </div>
          </>
        )}
      </div>
      <button type="button" className="inc-swipe inc-swipe--r" onClick={() => nextId && onNavigate(nextId)} disabled={!nextId} aria-label="Next incident">
        <ChevronRight size={22} />
      </button>

      {confirmClose && (
        <ConfirmDialog title="Close this incident?"
                       message={incident?.incident_no}
                       detail="Its details become read-only until it is reopened. The chat stays open."
                       confirmLabel="Close incident" onConfirm={changeStatus} onCancel={() => setConfirmClose(false)} />
      )}
      {editing && incident && (
        <IncidentForm incident={incident} onClose={() => setEditing(false)}
                      onSaved={(next) => { merge(next); setEditing(false); }} />
      )}
    </div>
  );
}
