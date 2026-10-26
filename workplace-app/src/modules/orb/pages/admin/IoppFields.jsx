// IOPP Supplement (Form A, section 3) particulars of a tank. Alert 25 ("Tank not in IOPP Supplement") judges the
// tanks written in the Oil Record Book against these: the tank's name as the IOPP states it, the section it is listed
// under, the capacity the IOPP gives and the dates the entry is valid.
export default function IoppFields({ form, setForm }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <fieldset className="as-iopp">
      <legend>IOPP Supplement particulars</legend>
      <p className="as-hint">
        Used by the &ldquo;Tank not in IOPP Supplement&rdquo; alert. Leave a field empty if the IOPP does not state it.
      </p>
      <div className="as-grid">
        <div className="form-group">
          <label>Name in the IOPP</label>
          <input className="form-control" value={form.tank_name_iopp} onChange={set('tank_name_iopp')} placeholder="if different from the tank name" />
        </div>
        <div className="form-group">
          <label>Section / item</label>
          <input className="form-control" value={form.iopp_section_ref} onChange={set('iopp_section_ref')} placeholder="e.g. 3.1" maxLength={30} />
        </div>
        <div className="form-group">
          <label>IOPP capacity (m³)</label>
          <input type="number" min="0" step="0.01" className="form-control" value={form.iopp_capacity_m3} onChange={set('iopp_capacity_m3')} />
        </div>
        <div className="form-group">
          <label>Valid from</label>
          <input type="date" className="form-control" value={form.effective_from} onChange={set('effective_from')} />
        </div>
        <div className="form-group">
          <label>Valid to</label>
          <input type="date" className="form-control" value={form.effective_to} onChange={set('effective_to')} />
        </div>
      </div>
    </fieldset>
  );
}
