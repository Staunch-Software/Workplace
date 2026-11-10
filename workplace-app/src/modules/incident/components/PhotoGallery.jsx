import { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import api, { errText } from '../api/axiosIncident';
import AuthedImage from './AuthedImage';
import ConfirmDialog from './ConfirmDialog';
import { forgetImage } from '../utils/imageCache';

// Photo evidence tab. These are the same pictures the list shows in its PIC column.
export default function PhotoGallery({ incident, canEdit, files, onFilesChange }) {
  const photos = files.filter((f) => f.kind === 'PHOTO');
  const [open, setOpen] = useState(null);         // index in photos
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState(null); // the photo awaiting confirmation
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const upload = async (list) => {
    if (!list?.length) return;
    const form = new FormData();
    form.append('kind', 'PHOTO');
    Array.from(list).forEach((f) => form.append('files', f));
    setUploading(true); setError('');
    try {
      const r = await api.post(`/api/incidents/${incident.id}/files`, form, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000,
      });
      onFilesChange([...files, ...r.data.data]);
    } catch (e) { setError(errText(e, 'Upload failed')); } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    const p = toDelete;
    try {
      await api.delete(`/api/incidents/${incident.id}/files/${p.id}`);
      forgetImage(incident.id, p.id);
      const rest = files.filter((x) => x.id !== p.id);
      onFilesChange(rest);
      // Keep the full-size view open on a neighbouring photo, or close it when that was the last one.
      const left = rest.filter((f) => f.kind === 'PHOTO').length;
      setOpen((i) => (i === null || left === 0 ? null : Math.min(i, left - 1)));
    } catch (e) { setError(errText(e, 'Could not delete the photo')); } finally { setToDelete(null); }
  };

  const step = useCallback((d) => setOpen((i) => (i === null ? i : (i + d + photos.length) % photos.length)), [photos.length]);

  useEffect(() => {
    if (open === null) return undefined;
    const onKey = (e) => {
      if (document.querySelector('.inc-backdrop--confirm')) return;   // the confirmation popup owns the keys
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const current = open !== null ? photos[open] : null;

  return (
    <div className="inc-tabpane">
      <div className="inc-filehead">
        <strong>Photos ({photos.length})</strong>
        {canEdit && (
          <>
            <input ref={fileRef} type="file" multiple hidden accept=".png,.jpg,.jpeg,.gif,.webp" onChange={(e) => upload(e.target.files)} />
            <button type="button" className="inc-btn inc-btn--primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={14} className="inc-spin" /> : <ImagePlus size={14} />} Add photos
            </button>
          </>
        )}
      </div>
      {error && <div className="inc-error" role="alert">{error}</div>}
      {photos.length === 0 ? <div className="inc-muted">No photos yet.</div> : (
        <div className="inc-photos">
          {photos.map((p, i) => (
            <div key={p.id} className="inc-photo-wrap">
              <button type="button" className="inc-photo" onClick={() => setOpen(i)} title={p.file_name}>
                <AuthedImage incidentId={incident.id} fileId={p.id} alt={p.file_name} />
              </button>
              {canEdit && (
                <button type="button" className="inc-photo-del" onClick={() => setToDelete(p)}
                        title="Delete photo" aria-label={`Delete ${p.file_name}`}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!canEdit && photos.length > 0 && incident.status === 'CLOSED' && (
        <div className="inc-hint">This incident is closed. Reopen it to add or delete photos.</div>
      )}

      {current && (
        <div className="inc-lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <button type="button" className="inc-lightbox__x" onClick={() => setOpen(null)} aria-label="Close"><X size={20} /></button>
          {photos.length > 1 && <button type="button" className="inc-lightbox__nav inc-lightbox__nav--l" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={26} /></button>}
          <div className="inc-lightbox__stage">
            <AuthedImage incidentId={incident.id} fileId={current.id} alt={current.file_name} />
            <div className="inc-lightbox__bar">
              <span>{current.file_name} · {open + 1}/{photos.length}</span>
              {canEdit && <button type="button" className="inc-btn inc-btn--danger" onClick={() => setToDelete(current)}><Trash2 size={14} /> Delete</button>}
            </div>
          </div>
          {photos.length > 1 && <button type="button" className="inc-lightbox__nav inc-lightbox__nav--r" onClick={() => step(1)} aria-label="Next"><ChevronRight size={26} /></button>}
        </div>
      )}

      {toDelete && (
        <ConfirmDialog danger title="Delete this photo?" message={toDelete.file_name}
                       detail="This removes the photo from the incident and from the PIC column, and cannot be undone."
                       confirmLabel="Delete photo" onConfirm={remove} onCancel={() => setToDelete(null)} />
      )}
    </div>
  );
}
