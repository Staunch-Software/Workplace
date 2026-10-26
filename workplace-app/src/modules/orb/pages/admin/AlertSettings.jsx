import { useEffect, useMemo, useState, useCallback } from 'react';
import { SlidersHorizontal, ShieldCheck, History, RotateCcw, Check, X } from 'lucide-react';
import Modal from '../../components/shared/Modal';
import LoadingSpinner from '../../components/shared/LoadingSpinner';
import Dropdown from '../../components/shared/Dropdown';
import MultiSelectDropdown from '../../components/shared/MultiSelectDropdown';
import { useToast } from '../../context/ToastContext';
import api from '../../api/axiosOrb';
import './VesselConfiguration.css';
import './AdminSections.css';
import './AlertSettings.css';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const SEVERITY_DOT = { critical: '#C62828', major: '#E8742B', minor: '#D9A400', observation: '#4F86B8' };
const SEVERITY_OPTIONS = Object.keys(SEVERITY_DOT).map(s => ({ value: s, label: cap(s), dot: SEVERITY_DOT[s] }));
const COMPARATORS = [
  { value: '>', label: 'is above', hint: '>' },
  { value: '>=', label: 'is at least', hint: '≥' },
  { value: '<', label: 'is below', hint: '<' },
  { value: '<=', label: 'is at most', hint: '≤' },
  { value: '=', label: 'equals', hint: '=' },
  { value: '+/-', label: 'differs by more than', hint: '±' },
];
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const errText = (e, fallback) => {
  const d = e.response?.data?.detail;
  return typeof d === 'string' ? d : fallback;
};

// ADMIN screen for the compliance alerts: which are on, their severity and where they are offered, and every
// threshold with its per-vessel override. A change applies from the next run of the checks (upload, re-process,
// recalculate) and every threshold change is kept in a history with who made it.
export default function AlertSettings() {
  const [tab, setTab] = useState('alerts');
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/alert-config').then(r => setAlerts(r.data.data || [])).catch(() => setError('Could not load the alert settings'));
  }, []);

  return (
    <div className="al">
      <div className="vc-header">
        <div className="vc-header__text">
          <span className="vc-eyebrow">Administration</span>
          <h2 className="vc-title">Alert Settings</h2>
          <p className="vc-subtitle">Switch alerts on or off, set their severity, and change the thresholds they use. Changes apply from the next check run.</p>
        </div>
      </div>

      <div className="al-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'alerts'} className={`al-tab${tab === 'alerts' ? ' al-tab--on' : ''}`} onClick={() => setTab('alerts')}>
          <ShieldCheck size={15} /> Alerts
        </button>
        <button role="tab" aria-selected={tab === 'thresholds'} className={`al-tab${tab === 'thresholds' ? ' al-tab--on' : ''}`} onClick={() => setTab('thresholds')}>
          <SlidersHorizontal size={15} /> Thresholds
        </button>
      </div>

      {error && <div className="alert-banner error">{error}</div>}
      {!alerts && !error ? <LoadingSpinner /> : tab === 'alerts'
        ? <AlertsTab alerts={alerts || []} setAlerts={setAlerts} />
        : <ThresholdsTab alerts={alerts || []} />}
    </div>
  );
}

function AlertsTab({ alerts, setAlerts }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState('');
  const [showWithdrawn, setShowWithdrawn] = useState(false);

  const active = alerts.filter(a => a.enabled);
  const withdrawn = alerts.filter(a => !a.enabled);

  const patch = async (a, changes) => {
    setSaving(a.alert_code);
    try {
      const r = await api.patch(`/api/alert-config/${a.alert_code}`, changes);
      setAlerts(list => list.map(x => (x.alert_code === a.alert_code ? { ...x, ...r.data.data } : x)));
    } catch (e) {
      toast({ type: 'error', message: errText(e, 'Could not save the change') });
    } finally { setSaving(''); }
  };

  const toggleEnabled = (a) => {
    if (a.enabled && !window.confirm(`Switch off "${a.name}"? New alerts of this type stop being raised and the existing ones are hidden (kept in the database).`)) return;
    patch(a, { enabled: !a.enabled });
  };

  const rows = (list, dim) => list.map(a => (
    <tr key={a.alert_code} className={`vc-row${dim ? ' vc-row--inactive' : ''}`}>
      <td data-label="No." className="al-no">{a.alert_no}</td>
      <td data-label="Alert" className="vc-tankname">
        {a.name}
        <div className="al-code">{a.alert_code}</div>
      </td>
      <td data-label="Category" className="vc-muted">{a.category}</td>
      <td data-label="Scope" className="vc-muted">{a.scope}</td>
      <td data-label="Severity">
        <Dropdown portal size="sm" className="al-sev" value={a.severity} options={SEVERITY_OPTIONS} disabled={saving === a.alert_code}
                  onChange={v => v !== a.severity && patch(a, { severity: v })} ariaLabel={`Severity of ${a.name}`} />
      </td>
      <td data-label="Active" className="vc-center">
        <input type="checkbox" className="al-check" checked={a.enabled} disabled={saving === a.alert_code} onChange={() => toggleEnabled(a)} aria-label={`${a.name} active`} />
      </td>
      <td data-label="In Alerts filter" className="vc-center">
        <input type="checkbox" className="al-check" checked={a.in_alerts_filter} disabled={saving === a.alert_code || !a.enabled}
               onChange={() => patch(a, { in_alerts_filter: !a.in_alerts_filter })} aria-label={`${a.name} offered in the Alerts filter`} />
      </td>
      <td data-label="Check">
        {a.built ? <span className="al-pill al-pill--ok">Running</span> : <span className="al-pill al-pill--wait">Not built</span>}
      </td>
      <td data-label="Last change" className="vc-muted al-when">{a.updated_by_name ? `${a.updated_by_name} · ${when(a.updated_at)}` : '—'}</td>
    </tr>
  ));

  const head = (
    <thead>
      <tr>
        <th>No.</th><th>Alert</th><th>Category</th><th>Scope</th><th>Severity</th>
        <th className="vc-center">Active</th><th className="vc-center">In Alerts filter</th><th>Check</th><th>Last change</th>
      </tr>
    </thead>
  );

  return (
    <>
      <div className="al-summary">
        <span className="vc-meta-chip"><strong>{active.length}</strong> active</span>
        <span className="vc-meta-chip"><strong>{withdrawn.length}</strong> withdrawn</span>
        <span className="vc-meta-chip"><strong>{alerts.filter(a => a.enabled && !a.built).length}</strong> waiting for their check</span>
      </div>
      <div className="vc-table-wrap">
        <table className="vc-table al-table">{head}<tbody>{rows(active, false)}</tbody></table>
      </div>

      {withdrawn.length > 0 && (
        <div className="al-withdrawn">
          <button type="button" className="vc-btn vc-btn--secondary vc-btn--sm" onClick={() => setShowWithdrawn(v => !v)} aria-expanded={showWithdrawn}>
            {showWithdrawn ? 'Hide' : 'Show'} withdrawn alerts ({withdrawn.length})
          </button>
          <p className="as-hint">
            A withdrawn alert is switched off, never deleted: old alerts of that type are hidden from lists and exports unless they carry a conversation or await approval.
          </p>
          {showWithdrawn && <div className="vc-table-wrap"><table className="vc-table al-table">{head}<tbody>{rows(withdrawn, true)}</tbody></table></div>}
        </div>
      )}
    </>
  );
}

function ThresholdsTab({ alerts }) {
  const { toast } = useToast();
  const [vessels, setVessels] = useState([]);
  const [vesselIds, setVesselIds] = useState([]);        // [] = the default values every vessel follows
  const [params, setParams] = useState(null);
  const [loading, setLoading] = useState(false);         // reloading: the list stays on screen so the page does not jump
  const [draft, setDraft] = useState({});                // param_code -> { value, comparator, note }
  const [saving, setSaving] = useState('');
  const [history, setHistory] = useState(null);          // { param, rows }

  useEffect(() => { api.get('/api/vessels').then(r => setVessels(r.data.data || [])).catch(() => {}); }, []);

  const vesselName = useCallback((id) => vessels.find(v => v.id === id)?.name || 'Vessel', [vessels]);

  // One request per chosen vessel; each threshold then lists, per vessel, the value in force and whether it is an override.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      let merged;
      if (vesselIds.length === 0) {
        const r = await api.get('/api/alert-config/params');
        merged = (r.data.data || []).map(p => ({ ...p, targets: [] }));
      } else {
        const results = await Promise.all(vesselIds.map(id =>
          api.get('/api/alert-config/params', { params: { vessel_id: id } }).then(r => [id, r.data.data || []])));
        const by = new Map();
        for (const [id, list] of results) {
          for (const p of list) {
            const cur = by.get(p.param_code) || { ...p, targets: [] };
            cur.targets.push({
              vessel_id: id, override: p.override,
              value: p.override ? p.override.value : p.value, comparator: p.override ? p.override.comparator : p.comparator,
            });
            by.set(p.param_code, cur);
          }
        }
        merged = [...by.values()];
      }
      setParams(merged);
      setDraft({});
    } catch (e) {
      toast({ type: 'error', message: errText(e, 'Could not load the thresholds') });
      setParams(prev => prev || []);
    } finally { setLoading(false); }
  }, [vesselIds, toast]);

  useEffect(() => { load(); }, [load]);

  const alertName = useMemo(() => Object.fromEntries(alerts.map(a => [a.alert_code, `${a.alert_no}. ${a.name}`])), [alerts]);
  const order = useMemo(() => Object.fromEntries(alerts.map(a => [a.alert_code, a.alert_no])), [alerts]);
  const groups = useMemo(() => {
    const by = {};
    for (const p of params || []) (by[p.alert_code] ||= []).push(p);
    return Object.entries(by).sort((a, b) => (order[a[0]] ?? 99) - (order[b[0]] ?? 99));
  }, [params, order]);

  // the value in force: the default, or the chosen vessels' values when they all agree (otherwise null = mixed)
  const current = (p) => {
    if (!p.targets.length) return { value: p.value, comparator: p.comparator };
    const same = (key) => (p.targets.every(t => t[key] === p.targets[0][key]) ? p.targets[0][key] : null);
    return { value: same('value'), comparator: same('comparator') };
  };
  const shown = (p) => {
    const c = current(p);
    return { value: c.value ?? '', comparator: c.comparator, note: '', ...(draft[p.param_code] || {}) };
  };
  const isDirty = (p) => {
    const d = draft[p.param_code];
    if (!d) return false;
    const c = current(p);
    return c.value === null || c.comparator === null
      ? d.value !== '' || d.comparator !== c.comparator
      : Number(d.value ?? c.value) !== c.value || (d.comparator ?? c.comparator) !== c.comparator;
  };
  const edit = (p, field, v) => setDraft(d => ({ ...d, [p.param_code]: { ...shown(p), [field]: v } }));

  const save = async (p) => {
    const d = shown(p);
    const value = Number(d.value);
    if (d.value === '' || Number.isNaN(value)) { toast({ type: 'error', message: 'Enter a number' }); return; }
    if (!d.comparator) { toast({ type: 'error', message: 'Choose the rule' }); return; }
    setSaving(p.param_code);
    const body = { value, comparator: d.comparator, note: d.note?.trim() || null };
    try {
      if (vesselIds.length === 0) await api.put(`/api/alert-config/params/${p.param_code}`, { ...body, vessel_id: null });
      else await Promise.all(vesselIds.map(id => api.put(`/api/alert-config/params/${p.param_code}`, { ...body, vessel_id: id })));
      toast({ type: 'success', message: vesselIds.length === 0 ? 'Default value saved' : `Saved for ${vesselIds.length === 1 ? vesselName(vesselIds[0]) : `${vesselIds.length} vessels`}` });
      await load();
    } catch (e) { toast({ type: 'error', message: errText(e, 'Could not save') }); }
    finally { setSaving(''); }
  };

  const reset = async (p) => {
    const own = p.targets.filter(t => t.override);
    if (!window.confirm(`${own.length === 1 ? vesselName(own[0].vessel_id) : `${own.length} vessels`} will follow the default value again. Continue?`)) return;
    setSaving(p.param_code);
    try {
      await Promise.all(own.map(t => api.delete(`/api/alert-config/params/${p.param_code}`, { params: { vessel_id: t.vessel_id } })));
      await load();
    } catch (e) { toast({ type: 'error', message: errText(e, 'Could not reset') }); }
    finally { setSaving(''); }
  };

  const openHistory = async (p) => {
    setHistory({ param: p, rows: null });
    try {
      let rows;
      if (vesselIds.length === 0) {
        rows = (await api.get(`/api/alert-config/params/${p.param_code}/history`)).data.data || [];
      } else {
        const lists = await Promise.all(vesselIds.map(id =>
          api.get(`/api/alert-config/params/${p.param_code}/history`, { params: { vessel_id: id } })
            .then(r => (r.data.data || []).map(h => ({ ...h, vessel: vesselName(id) })))));
        rows = lists.flat().sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
      }
      setHistory({ param: p, rows });
    } catch (e) { setHistory(null); toast({ type: 'error', message: errText(e, 'Could not load the history') }); }
  };

  const names = vesselIds.map(vesselName);
  const scopeText = vesselIds.length === 0
    ? 'These are the values every vessel follows unless it has its own override.'
    : `Saving a value here sets the same override for ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}; every other vessel keeps the default.`;

  const appliesCell = (p) => {
    if (!p.targets.length) return <span className="al-pill al-pill--wait">All vessels</span>;
    const shownTargets = p.targets.slice(0, 3);
    return (
      <div className="al-applies">
        {shownTargets.map(t => (
          <span key={t.vessel_id} className={`al-pill ${t.override ? 'al-pill--override' : 'al-pill--wait'}`}
                title={t.override ? `${vesselName(t.vessel_id)} has its own value (${t.value})` : `${vesselName(t.vessel_id)} follows the default value`}>
            {vesselName(t.vessel_id)} · {t.override ? 'own value' : 'default'}
          </span>
        ))}
        {p.targets.length > 3 && <span className="al-pill al-pill--wait">+{p.targets.length - 3} more</span>}
      </div>
    );
  };

  return (
    <>
      <div className="al-scope">
        <div className="as-field al-scope__field"><span>Thresholds for</span>
          <MultiSelectDropdown value={vesselIds} onChange={setVesselIds} placeholder="All vessels (default values)"
                               options={vessels.map(v => ({ value: v.id, label: v.name }))} />
        </div>
        <p className="as-hint">{scopeText}</p>
      </div>
      {vesselIds.length > 0 && (
        <div className="al-chips">
          {vesselIds.map(id => (
            <span key={id} className="up-fchip al-chip">
              {vesselName(id)}
              <button type="button" onClick={() => setVesselIds(ids => ids.filter(x => x !== id))} aria-label={`Remove ${vesselName(id)}`}><X size={12} /></button>
            </span>
          ))}
          <button type="button" className="vc-btn vc-btn--secondary vc-btn--sm" onClick={() => setVesselIds([])}>Back to default values</button>
        </div>
      )}

      {!params ? <LoadingSpinner /> : (
        <div className={`al-groups${loading ? ' al-groups--loading' : ''}`} aria-busy={loading}>
          {groups.map(([code, list]) => (
            <section key={code} className="al-group">
              <h4 className="al-group__title">{alertName[code] || code}</h4>
              <div className="vc-table-wrap">
                <table className="vc-table al-table">
                  <thead>
                    <tr><th>Threshold</th><th>Rule</th><th className="vc-num">Value</th><th>Unit</th><th>Applies to</th><th className="vc-th-actions">Action</th></tr>
                  </thead>
                  <tbody>
                    {list.map(p => {
                      const d = shown(p);
                      const dirty = isDirty(p);
                      const hasOverride = p.targets.some(t => t.override);
                      return (
                        <tr key={p.param_code} className="vc-row">
                          <td data-label="Threshold" className="vc-tankname">
                            {p.label}
                            {p.note && <div className="al-code">{p.note}</div>}
                            {dirty && (
                              <input className="form-control al-note" placeholder="Reason for the change (optional)" value={d.note || ''}
                                     onChange={e => edit(p, 'note', e.target.value)} maxLength={500} />
                            )}
                          </td>
                          <td data-label="Rule">
                            <Dropdown portal size="sm" value={d.comparator} options={COMPARATORS} placeholder="Mixed" onChange={v => edit(p, 'comparator', v)} ariaLabel={`Rule for ${p.label}`} />
                          </td>
                          <td data-label="Value" className="vc-num">
                            <input type="number" step="any" className="form-control al-value" value={d.value} placeholder={d.value === '' ? 'Mixed' : undefined}
                                   onChange={e => edit(p, 'value', e.target.value)} aria-label={`Value of ${p.label}`} />
                          </td>
                          <td data-label="Unit" className="vc-muted">{p.unit || '—'}</td>
                          <td data-label="Applies to">{appliesCell(p)}</td>
                          <td className="vc-td-actions">
                            <div className="vc-rowbtns">
                              <button className="vc-btn vc-btn--primary vc-btn--sm" disabled={!dirty || saving === p.param_code} onClick={() => save(p)}>
                                <Check size={14} /> Save
                              </button>
                              {hasOverride && (
                                <button className="vc-btn vc-btn--secondary vc-btn--sm" disabled={saving === p.param_code} onClick={() => reset(p)} title="Follow the default again">
                                  <RotateCcw size={14} /> Reset
                                </button>
                              )}
                              <button className="vc-btn vc-btn--secondary vc-btn--sm" onClick={() => openHistory(p)}><History size={14} /> History</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {history && (
        <Modal title={`History — ${history.param.label}`} onClose={() => setHistory(null)} wide
               footer={<button className="vc-btn vc-btn--secondary" onClick={() => setHistory(null)}>Close</button>}>
          {history.rows === null ? <LoadingSpinner /> : history.rows.length === 0 ? (
            <div className="empty-state">No changes recorded yet: the value is as first set by the review.</div>
          ) : (
            <div className="vc-table-wrap">
              <table className="vc-table">
                <thead><tr><th>When</th>{vesselIds.length > 0 && <th>Vessel</th>}<th>Who</th><th className="vc-num">From</th><th className="vc-num">To</th><th>Note</th></tr></thead>
                <tbody>
                  {history.rows.map((h, i) => (
                    <tr key={i} className="vc-row">
                      <td data-label="When">{when(h.changed_at)}</td>
                      {vesselIds.length > 0 && <td data-label="Vessel">{h.vessel}</td>}
                      <td data-label="Who">{h.changed_by_name || '—'}</td>
                      <td data-label="From" className="vc-num">{h.old_value ?? '—'}</td>
                      <td data-label="To" className="vc-num">{h.new_value ?? 'override removed'}</td>
                      <td data-label="Note" className="vc-muted">{h.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
