import { useEffect, useState, useCallback } from 'react';
import { Wrench, Plus, Pencil, Trash2, AlertTriangle, Check, X } from 'lucide-react';
import api from '../../api/axiosOrb';
import './EquipmentSection.css';

const TYPES = [
  { value: 'BILGE_PUMP', label: 'Bilge pump' },
  { value: 'OWS', label: 'Oily water separator' },
  { value: 'OCM', label: '15 ppm monitor (OCM)' },
];
const typeLabel = (v) => TYPES.find(t => t.value === v)?.label || v;
const EMPTY = { equipment_type: 'BILGE_PUMP', name: '', make_model: '', serial_no: '', rated_capacity_m3_hr: '', linked_tank_id: '', is_active: true };

// Pumps, OWS and the 15 ppm monitor of one vessel. The pump rate feeds the "Pump capacity exceeded" alert;
// there is no default rate, so a bilge tank without one is not checked and is listed here.
export default function EquipmentSection({ vesselId, tanks = [] }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);       // null = closed, otherwise the draft (with id when editing)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/vessels/${vesselId}/equipment`);
      setData(r.data.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not load the equipment');
    }
  }, [vesselId]);

  useEffect(() => { load(); }, [load]);

  const activeTanks = tanks.filter(t => t.is_active);
  const tankName = (id) => tanks.find(t => t.id === id)?.tank_name || '—';
  const needsRate = form && form.equipment_type !== 'OCM';

  const open = (item) => {
    setError('');
    setForm(item ? {
      id: item.id, equipment_type: item.equipment_type, name: item.name, make_model: item.make_model || '',
      serial_no: item.serial_no || '', rated_capacity_m3_hr: item.rated_capacity_m3_hr ?? '',
      linked_tank_id: item.linked_tank_id || '', is_active: item.is_active,
    } : { ...EMPTY });
  };

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (needsRate && !(Number(form.rated_capacity_m3_hr) > 0)) { setError('Rated capacity (m³/hr) is required: there is no default rate'); return; }
    setSaving(true); setError('');
    const body = {
      equipment_type: form.equipment_type,
      name: form.name.trim(),
      make_model: form.make_model.trim() || null,
      serial_no: form.serial_no.trim() || null,
      rated_capacity_m3_hr: needsRate ? Number(form.rated_capacity_m3_hr) : (Number(form.rated_capacity_m3_hr) > 0 ? Number(form.rated_capacity_m3_hr) : null),
      linked_tank_id: form.linked_tank_id || null,
      is_active: form.is_active,
    };
    try {
      if (form.id) await api.patch(`/api/vessels/${vesselId}/equipment/${form.id}`, body);
      else await api.post(`/api/vessels/${vesselId}/equipment`, body);
      setForm(null);
      await load();
    } catch (e) {
      const d = e.response?.data?.detail;
      setError(typeof d === 'string' ? d : 'Could not save');
    } finally { setSaving(false); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove ${item.name}?`)) return;
    try {
      await api.delete(`/api/vessels/${vesselId}/equipment/${item.id}`);
      await load();
    } catch (e) { setError(e.response?.data?.detail || 'Could not remove'); }
  };

  const missing = data?.tanks_missing_pump_rate || [];

  return (
    <div className="eq">
      <div className="vc-sectionhead">
        <h4 className="vc-sectionhead__title"><Wrench size={16} /> Pumps &amp; equipment</h4>
        <button className="vc-btn vc-btn--primary vc-btn--sm" onClick={() => open(null)}><Plus size={15} /> Add equipment</button>
      </div>

      {missing.length > 0 && (
        <div className="eq-warn" role="status">
          <AlertTriangle size={16} />
          <span>
            Pump capacity is <strong>not checked</strong> for {missing.map(t => t.tank_name).join(', ')}.
            Add the pump with its rated capacity and link it to the tank.
          </span>
        </div>
      )}
      {error && !form && <div className="alert-banner error">{error}</div>}

      {form && (
        <div className="eq-form">
          {error && <div className="alert-banner error">{error}</div>}
          <div className="eq-grid">
            <label className="eq-field"><span>Type</span>
              <select className="form-control" value={form.equipment_type} onChange={e => setForm({ ...form, equipment_type: e.target.value })}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="eq-field"><span>Name *</span>
              <input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Bilge pump No.1" />
            </label>
            <label className="eq-field"><span>Rated capacity (m³/hr){needsRate ? ' *' : ''}</span>
              <input className="form-control" type="number" min="0" step="0.01" value={form.rated_capacity_m3_hr}
                     onChange={e => setForm({ ...form, rated_capacity_m3_hr: e.target.value })} />
            </label>
            <label className="eq-field"><span>Pumps from tank</span>
              <select className="form-control" value={form.linked_tank_id} onChange={e => setForm({ ...form, linked_tank_id: e.target.value })}>
                <option value="">— not linked —</option>
                {activeTanks.map(t => <option key={t.id} value={t.id}>{t.tank_name}</option>)}
              </select>
            </label>
            <label className="eq-field"><span>Make / model</span>
              <input className="form-control" value={form.make_model} onChange={e => setForm({ ...form, make_model: e.target.value })} />
            </label>
            <label className="eq-field"><span>Serial no.{form.equipment_type === 'OCM' ? ' (links the alarm data dump)' : ''}</span>
              <input className="form-control" value={form.serial_no} onChange={e => setForm({ ...form, serial_no: e.target.value })} />
            </label>
          </div>
          <label className="eq-check"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /> In service</label>
          <div className="eq-form__foot">
            <button className="vc-btn vc-btn--secondary vc-btn--sm" onClick={() => { setForm(null); setError(''); }} disabled={saving}><X size={14} /> Cancel</button>
            <button className="vc-btn vc-btn--primary vc-btn--sm" onClick={save} disabled={saving}><Check size={14} /> {saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {!data ? null : data.items.length === 0 ? (
        <div className="vc-notanks">No pumps or equipment registered for this vessel yet.</div>
      ) : (
        <div className="vc-table-wrap">
          <table className="vc-table eq-table">
            <thead>
              <tr>
                <th>Type</th><th>Name</th><th>Make / model</th><th>Serial</th>
                <th className="vc-num">Rated (m³/hr)</th><th>Pumps from</th><th>Status</th><th className="vc-th-actions">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map(it => (
                <tr key={it.id} className={`vc-row${it.is_active ? '' : ' vc-row--inactive'}`}>
                  <td data-label="Type">{typeLabel(it.equipment_type)}</td>
                  <td data-label="Name" className="vc-tankname">{it.name}</td>
                  <td data-label="Make / model" className="vc-muted">{it.make_model || '—'}</td>
                  <td data-label="Serial" className="vc-muted">{it.serial_no || '—'}</td>
                  <td data-label="Rated (m³/hr)" className="vc-num">{it.rated_capacity_m3_hr ?? '—'}</td>
                  <td data-label="Pumps from" className="vc-muted">{it.linked_tank_id ? tankName(it.linked_tank_id) : '—'}</td>
                  <td data-label="Status">{it.is_active ? 'In service' : 'Out of service'}</td>
                  <td className="vc-td-actions">
                    <div className="vc-rowbtns">
                      <button className="vc-btn vc-btn--secondary vc-btn--sm" onClick={() => open(it)}><Pencil size={14} /> Edit</button>
                      <button className="vc-btn vc-btn--danger vc-btn--sm" onClick={() => remove(it)}><Trash2 size={14} /> Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
