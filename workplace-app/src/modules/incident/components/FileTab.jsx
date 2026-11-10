import { useEffect, useRef, useState } from 'react';
import { Upload, FileText, Trash2, Loader2, Save } from 'lucide-react';
import api, { errText, openFile } from '../api/axiosIncident';
import { fmtSize, fmtStamp } from '../utils/format';
import ConfirmDialog from './ConfirmDialog';

// SOF and Alarm/event log tabs: a notes box plus the files that belong to it.
export default function FileTab({ incident, kind, notesField, notesLabel, canEdit, files, onFilesChange, onIncidentChange }) {
  const [notes, setNotes] = useState(incident[notesField] || '');
  const [saved, setSaved] = useState(incident[notesField] || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { setNotes(incident[notesField] || ''); setSaved(incident[notesField] || ''); }, [incident.id, notesField]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = files.filter((f) => f.kind === kind);
  const dirty = notes !== saved;

  const saveNotes = async () => {
    setSaving(true); setError('');
    try {
      const r = await api.patch(`/api/incidents/${incident.id}`, { [notesField]: notes });
      setSaved(notes);
      onIncidentChange(r.data.data);
    } catch (e) { setError(errText(e, 'Could not save')); } finally { setSaving(false); }
  };

  const upload = async (list) => {
    if (!list?.length) return;
    const form = new FormData();
    form.append('kind', kind);
    Array.from(list).forEach((f) => form.append('files', f));
    setUploading(true); setError('');
    try {
      const r = await api.post(`/api/incidents/${incident.id}/files`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      onFilesChange([...files, ...r.data.data]);
    } catch (e) { setError(errText(e, 'Upload failed')); } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
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
    <div className="inc-tabpane">
      <label className="inc-field inc-field--grow">{notesLabel}
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} readOnly={!canEdit}
                  placeholder={canEdit ? 'Type notes here…' : 'No notes recorded.'} />
      </label>
      {canEdit && (
        <div className="inc-row">
          <button type="button" className="inc-btn inc-btn--primary" onClick={saveNotes} disabled={!dirty || saving}>
            {saving ? <Loader2 size={14} className="inc-spin" /> : <Save size={14} />} Save notes
          </button>
          {dirty && <span className="inc-hint">Unsaved changes</span>}
        </div>
      )}

      <div className="inc-filehead">
        <strong>Files ({mine.length})</strong>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)}
                   accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.log,.xlsx,.xls,.docx,.doc" />
            <button type="button" className="inc-btn inc-btn--ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={14} className="inc-spin" /> : <Upload size={14} />} Upload
            </button>
          </>
        )}
      </div>
      {error && <div className="inc-error" role="alert">{error}</div>}
      {mine.length === 0 ? <div className="inc-muted">No files uploaded.</div> : (
        <ul className="inc-files">
          {mine.map((f) => (
            <li key={f.id}>
              <button type="button" className="inc-filelink" onClick={() => openFile(incident.id, f.id).catch(() => setError('Could not open the file'))}>
                <FileText size={14} /> <span>{f.file_name}</span>
              </button>
              <em>{fmtSize(f.file_size)} · {fmtStamp(f.created_at)}</em>
              {canEdit && <button type="button" className="inc-iconbtn" onClick={() => setToDelete(f)} aria-label={`Delete ${f.file_name}`}><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      )}
      {toDelete && (
        <ConfirmDialog danger title="Delete this file?" message={toDelete.file_name}
                       detail="This removes the file from the incident and cannot be undone."
                       confirmLabel="Delete" onConfirm={remove} onCancel={() => setToDelete(null)} />
      )}
    </div>
  );
}
