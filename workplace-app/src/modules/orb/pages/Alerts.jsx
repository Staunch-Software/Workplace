import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ShieldAlert, AlertTriangle, AlertCircle, Eye, RefreshCw, BellOff, Filter, MessageSquare, Check, Send,
} from 'lucide-react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/Layout/Header';
import Badge from '../components/shared/Badge';
import AlertModal from '../components/alerts/AlertModal';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import Dropdown from '../components/shared/Dropdown';
import MultiSelectDropdown from '../components/shared/MultiSelectDropdown';
import api from '../api/axiosOrb';
import './Alerts.css';

const SEVERITIES = ['critical', 'major', 'minor', 'observation'];

const SEVERITY_ICONS = {
  critical: ShieldAlert,
  major: AlertTriangle,
  minor: AlertCircle,
  observation: Eye,
};

// 12 alert types per the new compliance spec
const ALERT_TYPES = [
  'wrong_item_code',                 // 1  Major
  'mass_balance_error',              // 2  Major
  'tank_capacity_exceeded',          // 3  Critical
  'combined_capacity_threshold',     // 4  Major
  'sludge_generation_rate',          // 5  Observation/Minor
  'bilge_increasing_rate',           // 6  Major
  'sludge_vs_fuel_consumption',      // 7  Observation/Major/Critical
  'bilge_transfer_vs_soundings',     // 8  Minor
  // 'bilge_pump_capacity' (9) omitted — check paused, no UI to set pump capacity yet
  'bunker_mismatch',                 // 10 Minor
  'missing_master_signature',        // 11 Minor
  'non_chronological_entry',         // 12 Minor
  'erasure_detected',                // 12 Observation
  'item_number_missing',             // 14 Minor  — a line's item number (e.g. 11.2) not written
  'item_value_missing',              // 14 Major  — nothing recorded for an item (e.g. capacity)
  'capacity_reading_mismatch',
  'bunker_quantity_mismatch',
  'gap_between_entries',
  'reading_needs_review',            // Observation — figure looks wrong but the entry is uncertain
];

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [vessels, setVessels] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ vessel_id: [], severity: '', status: '', alert_type: '' });
  const [recalculating, setRecalculating] = useState(false);
  const [selected, setSelected] = useState(null);   // alert open in the popup
  const [startAction, setStartAction] = useState(null);   // resolution box to open with it
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isShore } = useAuth();

  useEffect(() => { api.get('/api/vessels').then(r => setVessels(r.data.data || [])); }, []);

  const load = (overrides = {}) => {
    setLoading(true);
    const activeFilters = { ...filters, ...overrides };
    const params = new URLSearchParams();
    Object.entries(activeFilters).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(item => params.append(k, item));
      else if (v !== '') params.append(k, v);
    });
    Promise.all([
      api.get(`/api/alerts?${params}`),
      api.get('/api/alerts/summary'),
    ]).then(([a, s]) => {
      setAlerts(a.data.data || []);
      setSummary(s.data.data || {});
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Opened from a notification or the activity feed: /alerts?alert=<id>
  const linkedAlertId = searchParams.get('alert');
  useEffect(() => {
    if (!linkedAlertId) return;
    api.get(`/api/alerts/${linkedAlertId}`)
      .then(r => setSelected(r.data.data))
      .catch(() => {})
      .finally(() => setSearchParams({}, { replace: true }));
  }, [linkedAlertId]);

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  const handleSeverityClick = (s) => {
    const newSeverity = filters.severity === s ? '' : s;
    setFilters(f => ({ ...f, severity: newSeverity }));
    load({ severity: newSeverity });
  };

  const handleRecalculate = async () => {
    if (filters.vessel_id.length !== 1) return;
    setRecalculating(true);
    try {
      await api.post(`/api/alerts/recalculate?vessel_id=${filters.vessel_id[0]}`);
      load();
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Header title="Alerts" />
        <div className="page-body">
          <div className="al">
            <div className="al-header">
              <div className="al-header__text">
                <span className="al-eyebrow">Compliance</span>
                <h1 className="al-title">Compliance Alerts</h1>
                <p className="al-subtitle">Review, investigate and resolve MARPOL compliance findings across your fleet.</p>
              </div>
            </div>

            <div className="al-severity">
              {SEVERITIES.map(s => {
                const Icon = SEVERITY_ICONS[s];
                const active = filters.severity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    className={`al-sev al-sev--${s}${active ? ' al-sev--active' : ''}`}
                    onClick={() => handleSeverityClick(s)}
                    aria-pressed={active}
                  >
                    <span className="al-sev__icon"><Icon size={20} /></span>
                    <span className="al-sev__body">
                      <span className="al-sev__count">{summary[s] || 0}</span>
                      <span className="al-sev__label">{s}</span>
                    </span>
                    {active && <span className="al-sev__tag">Filtered</span>}
                  </button>
                );
              })}
            </div>

            <div className="al-filters">
              <div className="al-filters__title"><Filter size={14} /> Filters</div>
              <div className="al-filters__grid">
                <div className="form-group">
                  <label>Vessel</label>
                  <MultiSelectDropdown
                    value={filters.vessel_id}
                    onChange={v => setFilter('vessel_id', v)}
                    placeholder="Select the vessel"
                    options={vessels.map(v => ({ value: v.id, label: v.name }))}
                  />
                </div>
                <div className="form-group">
                  <label>Severity</label>
                  <Dropdown
                    value={filters.severity}
                    onChange={v => setFilter('severity', v)}
                    options={[{ value: '', label: 'All' }, ...SEVERITIES.map(s => ({ value: s, label: s }))]}
                  />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <Dropdown
                    value={filters.status}
                    onChange={v => setFilter('status', v)}
                    options={[{ value: '', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'PENDING_APPROVAL', label: 'Pending approval' }, { value: 'RESOLVED', label: 'Resolved' }]}
                  />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <Dropdown
                    value={filters.alert_type}
                    onChange={v => setFilter('alert_type', v)}
                    options={[{ value: '', label: 'All' }, ...ALERT_TYPES.map(t => ({ value: t, label: t.replace(/_/g, ' ') }))]}
                  />
                </div>
                <div className="al-filters__actions">
                  <button className="al-btn al-btn--primary" onClick={load}>Apply</button>
                  {isShore && <button
                    className="al-btn al-btn--secondary"
                    onClick={handleRecalculate}
                    disabled={filters.vessel_id.length !== 1 || recalculating}
                    title={filters.vessel_id.length !== 1 ? 'Select exactly one vessel first' : 'Clear stale alerts and rerun all compliance checks'}
                  >
                    <RefreshCw size={15} className={recalculating ? 'al-spin' : ''} />
                    {recalculating ? 'Recalculating…' : 'Recalculate Alerts'}
                  </button>}
                </div>
              </div>
            </div>

            {loading ? <LoadingSpinner /> : (
              <div className="al-panel">
                <div className="al-table-wrap">
                  <table className="al-table">
                    <thead>
                      <tr>
                        <th>Severity</th><th>Vessel</th><th>Type</th><th>Message</th><th className="al-center">Page</th>
                        <th>Created</th><th>Status</th><th className="al-th-actions">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.length === 0 ? (
                        <tr className="al-emptyrow">
                          <td colSpan={8}>
                            <div className="al-empty">
                              <span className="al-empty__icon"><BellOff size={24} /></span>
                              <div className="al-empty__title">No alerts found.</div>
                              <div className="al-empty__text">Nothing matches the current filters.</div>
                            </div>
                          </td>
                        </tr>
                      ) : alerts.map(a => {
                        return (
                            <tr
                              key={a.id}
                              onClick={() => { setStartAction(null); setSelected(a); }}
                              className={`al-row al-row--${a.severity}${a.is_resolved ? ' al-row--resolved' : ''}`}
                              title="Open alert"
                            >
                              <td data-label="Severity" className="al-td-sev"><Badge value={a.severity} /></td>
                              <td data-label="Vessel" className="al-vessel">{vessels.find(v => v.id === a.vessel_id)?.name || '—'}</td>
                              <td data-label="Type"><span className="al-type">{a.alert_type.replace(/_/g, ' ')}</span></td>
                              <td data-label="Message" className="al-msg">
                                <span className="al-msg__text">{a.message}</span>
                                {a.thread_count > 0 && (
                                  <span className={`al-chat${a.unread_count > 0 ? ' al-chat--new' : ''}`}>
                                    <MessageSquare size={12} /> {a.thread_count}{a.unread_count > 0 ? ` · ${a.unread_count} new` : ''}
                                  </span>
                                )}
                              </td>
                              <td data-label="Page" className="al-center al-muted">{a.page_number ?? '—'}</td>
                              <td data-label="Created" className="al-muted">
                                {new Date(a.created_at).toLocaleDateString()}
                                {!a.is_resolved && (() => {
                                  const days = Math.floor((Date.now() - new Date(a.created_at)) / 86400000);
                                  const color = days < 7 ? '#22c55e' : days < 30 ? '#f59e0b' : '#ef4444';
                                  return (
                                    <span
                                      className="al-age"
                                      style={{ color, background: color + '18' }}
                                    >
                                      {days === 0 ? 'Today' : `${days}d`}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td data-label="Status">
                                {a.status === 'PENDING_APPROVAL'
                                  ? <Badge value="Pending approval" type="review" />
                                  : <Badge value={a.is_resolved ? 'Resolved' : 'Open'} type={a.is_resolved ? 'completed' : 'pending'} />}
                              </td>
                              <td className="al-td-actions">
                                {!a.is_resolved && (isShore || a.status !== 'PENDING_APPROVAL') && (
                                  <button className="al-btn al-btn--ghost al-btn--sm"
                                          onClick={(e) => { e.stopPropagation(); setStartAction(isShore ? (a.status === 'PENDING_APPROVAL' ? null : 'resolve') : 'request'); setSelected(a); }}>
                                    {isShore ? <><Check size={14} /> {a.status === 'PENDING_APPROVAL' ? 'Review' : 'Resolve'}</> : <><Send size={14} /> Request</>}
                                  </button>
                                )}
                              </td>
                            </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {selected && (
              <AlertModal
                alert={selected}
                vesselName={vessels.find(v => v.id === selected.vessel_id)?.name}
                isShore={isShore}
                currentUserId={user?.id}
                startAction={startAction}
                onClose={() => { setSelected(null); setStartAction(null); load(); }}
                onChanged={() => load()}
              />
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
