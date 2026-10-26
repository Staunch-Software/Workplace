import { useState, useEffect } from 'react';
import { Flag, Check } from 'lucide-react';
import api from '../../api/axiosOrb';

const LANGUAGES = ['English', 'French', 'Spanish', 'Chinese', 'Japanese', 'Korean', 'Russian', 'Greek', 'Arabic', 'Portuguese', 'German', 'Italian', 'Turkish', 'Hindi'];

// Flag State particulars of a vessel. The official language drives "Book language" (alert 36): where it is not
// English, French or Spanish the Oil Record Book must also carry a translation into one of them.
export default function VesselProfileSection({ vessel, onSaved }) {
  const [form, setForm] = useState({ flag_state: '', flag_official_language: '', fuel_grades: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);   // { type: 'ok' | 'error', text }

  useEffect(() => {
    setForm({
      flag_state: vessel.flag_state || '',
      flag_official_language: vessel.flag_official_language || '',
      fuel_grades: (vessel.fuel_grades || []).join(', '),
    });
  }, [vessel.id, vessel.flag_state, vessel.flag_official_language, vessel.fuel_grades]);

  const grades = form.fuel_grades.split(',').map(g => g.trim().toUpperCase()).filter(Boolean);
  const dirty =
    form.flag_state.trim() !== (vessel.flag_state || '') ||
    form.flag_official_language.trim() !== (vessel.flag_official_language || '') ||
    grades.join(',') !== (vessel.fuel_grades || []).join(',');

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      const r = await api.put(`/api/vessels/${vessel.id}`, {
        flag_state: form.flag_state.trim(),
        flag_official_language: form.flag_official_language.trim(),
        fuel_grades: grades,
      });
      onSaved?.(r.data.data);
      setMsg({ type: 'ok', text: 'Saved' });
    } catch (e) {
      const d = e.response?.data?.detail;
      setMsg({ type: 'error', text: typeof d === 'string' ? d : 'Could not save' });
    } finally { setSaving(false); }
  };

  return (
    <div className="as-block">
      <div className="vc-sectionhead">
        <h4 className="vc-sectionhead__title"><Flag size={16} /> Flag State &amp; fuel</h4>
      </div>
      <div className="as-grid">
        <label className="as-field"><span>Flag State</span>
          <input className="form-control" value={form.flag_state} onChange={e => setForm({ ...form, flag_state: e.target.value })} placeholder="e.g. Panama" />
        </label>
        <label className="as-field"><span>Official language of the flag State</span>
          <input className="form-control" list={`lang-${vessel.id}`} value={form.flag_official_language}
                 onChange={e => setForm({ ...form, flag_official_language: e.target.value })} placeholder="e.g. Spanish" />
          <datalist id={`lang-${vessel.id}`}>{LANGUAGES.map(l => <option key={l} value={l} />)}</datalist>
        </label>
        <label className="as-field"><span>Fuel grades carried</span>
          <input className="form-control" value={form.fuel_grades} onChange={e => setForm({ ...form, fuel_grades: e.target.value })} placeholder="e.g. HFO, MDO" />
        </label>
      </div>
      <p className="as-hint">
        Without the language, &ldquo;Book language&rdquo; is not checked for this vessel.
      </p>
      <div className="as-foot">
        {msg && <span className={`as-msg as-msg--${msg.type}`} role="status">{msg.text}</span>}
        <button className="vc-btn vc-btn--primary vc-btn--sm" onClick={save} disabled={saving || !dirty}><Check size={14} /> {saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
