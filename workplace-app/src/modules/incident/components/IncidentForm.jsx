import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Ship, Layers } from 'lucide-react';
import api, { errText } from '../api/axiosIncident';
import CardSelect from './CardSelect';

const today = () => new Date().toISOString().slice(0, 10);

// Create (incident === null) or edit the header facts of an incident.
export default function IncidentForm({ incident, onClose, onSaved }) {
  const editing = !!incident;
  const [vessels, setVessels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    vessel_imo: incident?.vessel_imo || '',
    incident_date: incident?.incident_date || today(),
    category: incident?.category || '',
    pic_name: incident?.pic_name || '',
    description: incident?.description || '',
    offhire: incident?.offhire || false,
    offhire_details: incident?.offhire_details || '',
    comments: incident?.comments || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/vessels').then((r) => setVessels(r.data.data || [])).catch(() => {});
    api.get('/api/categories').then((r) => setCategories(r.data.data || [])).catch(() => {});
  }, []);

  const categoryOptions = useMemo(() => {
    const list = [...categories];
    if (form.category && !list.includes(form.category)) list.push(form.category);
    return list;
  }, [categories, form.category]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.vessel_imo) { setError('Choose the vessel'); return; }
    if (!form.incident_date) { setError('Enter the date of the incident'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, offhire_details: form.offhire ? form.offhire_details : '' };
      const r = editing
        ? await api.patch(`/api/incidents/${incident.id}`, payload)
        : await api.post('/api/incidents', payload);
      onSaved(r.data.data);
    } catch (err) {
      setError(errText(err, 'Could not save the incident'));
      setSaving(false);
    }
  };

  return (
    <div className="inc-backdrop inc-backdrop--form" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <form className="inc-modal" onSubmit={save}>
        <div className="inc-modal__head">
          <h2>{editing ? `Edit ${incident.incident_no}` : 'New incident'}</h2>
          <button type="button" className="inc-iconbtn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="inc-modal__body">
          <div className="inc-grid2">
            <label className="inc-field">Vessel
              <CardSelect
                value={form.vessel_imo}
                onChange={(val) => setForm((f) => ({ ...f, vessel_imo: val }))}
                options={vessels}
                placeholder="Select vessel…"
                icon={Ship}
                isBlock
                required
                searchable
                error={!!error && !form.vessel_imo}
              />
            </label>
            <label className="inc-field">Date of incident
              <input type="date" value={form.incident_date} onChange={set('incident_date')} max={today()} required />
            </label>
          </div>
          <div className="inc-grid2">
            <label className="inc-field">Incident category
              <CardSelect
                value={form.category}
                onChange={(val) => setForm((f) => ({ ...f, category: val }))}
                options={categoryOptions}
                placeholder="Select category…"
                icon={Layers}
                isBlock
              />
            </label>
            <label className="inc-field">Person In Charge (PIC)
              <input type="text" value={form.pic_name} onChange={set('pic_name')}
                     placeholder="e.g. Master, Chief Engineer, Superintendent…" />
            </label>
          </div>
          <label className="inc-field">Incident description
            <textarea rows={4} value={form.description} onChange={set('description')} />
          </label>
          <label className="inc-check">
            <input type="checkbox" checked={form.offhire} onChange={set('offhire')} /> Vessel went off-hire
          </label>
          {form.offhire && (
            <label className="inc-field">Offhire record
              <textarea rows={2} value={form.offhire_details} onChange={set('offhire_details')}
                        placeholder="Period, hours/days off-hire, reference…" />
            </label>
          )}
          <label className="inc-field">Comments
            <textarea rows={3} value={form.comments} onChange={set('comments')} />
          </label>
          {error && <div className="inc-error" role="alert">{error}</div>}
        </div>
        <div className="inc-modal__foot">
          <button type="button" className="inc-btn inc-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="inc-btn inc-btn--primary" disabled={saving}>
            {saving && <Loader2 size={14} className="inc-spin" />} {editing ? 'Save' : 'Create incident'}
          </button>
        </div>
      </form>
    </div>
  );
}
