import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Paperclip, Images, Loader2, FileWarning, Ship, Layers, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import api, { errText, openFile } from '../api/axiosIncident';
import AuthedImage from '../components/AuthedImage';
import CardSelect from '../components/CardSelect';
import IncidentForm from '../components/IncidentForm';
import IncidentModal from '../components/IncidentModal';
import { fmtDay } from '../utils/format';

const STATUS_TABS = [['', 'All'], ['DRAFT', 'Draft'], ['CLOSED', 'Closed']];

export default function IncidentList({ me }) {
  const [params, setParams] = useSearchParams();
  const openId = params.get('open') || '';
  const openTab = params.get('tab') || 'sof';
  const filters = useMemo(() => ({
    status: params.get('status') || '',
    vessel_imo: params.get('vessel') || '',
    category: params.get('category') || '',
    q: params.get('q') || '',
    date_from: params.get('from') || '',
    date_to: params.get('to') || '',
  }), [params]);

  const [all, setAll] = useState([]);          // every incident matching the filters except the status tab
  const [vessels, setVessels] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(filters.q);
  const [sortField, setSortField] = useState(null);
  const [sortOrder, setSortOrder] = useState('normal'); // 'asc' | 'desc' | 'normal'

  // 3-state sort: Ascending -> Descending -> Normal (reset)
  const toggleSort = useCallback((field) => {
    if (sortField !== field) {
      setSortField(field);
      setSortOrder('asc');
    } else {
      if (sortOrder === 'asc') {
        setSortOrder('desc');
      } else if (sortOrder === 'desc') {
        setSortField(null);
        setSortOrder('normal');
      } else {
        setSortOrder('asc');
      }
    }
  }, [sortField, sortOrder]);

  const setParam = useCallback((key, value) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);

  useEffect(() => {
    api.get('/api/vessels').then((r) => setVessels(r.data.data || [])).catch(() => {});
    api.get('/api/categories').then((r) => setCategories(r.data.data || [])).catch(() => {});
  }, []);

  // Typing in the search box filters after a short pause, not on every key.
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== filters.q) setParam('q', search.trim()); }, 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const { status, ...serverFilters } = filters;
  const serverKey = JSON.stringify(serverFilters);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const p = Object.fromEntries(Object.entries(JSON.parse(serverKey)).filter(([, v]) => v));
      const r = await api.get('/api/incidents', { params: p });
      setAll(r.data.data || []);
      setError('');
    } catch (e) {
      setError(errText(e, 'Could not load incidents'));
    } finally {
      setLoading(false);
    }
  }, [serverKey]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    total: all.length,
    draft: all.filter((r) => r.status === 'DRAFT').length,
    closed: all.filter((r) => r.status === 'CLOSED').length,
    offhire: all.filter((r) => r.offhire).length,
  }), [all]);

  const rows = useMemo(() => {
    const list = status ? all.filter((r) => r.status === status) : all;
    if (!sortField || sortOrder === 'normal') {
      // Normal/Default mode: chronological order by incident_no (0001, 0002, 0003...)
      return [...list].sort((a, b) =>
        (a.incident_no || '').localeCompare(b.incident_no || '', undefined, { numeric: true })
      );
    }
    return [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'incident_no') {
        cmp = (a.incident_no || '').localeCompare(b.incident_no || '', undefined, { numeric: true });
      } else if (sortField === 'incident_date') {
        const da = a.incident_date ? new Date(a.incident_date).getTime() : 0;
        const db = b.incident_date ? new Date(b.incident_date).getTime() : 0;
        cmp = da - db;
        if (cmp === 0) {
          cmp = (a.incident_no || '').localeCompare(b.incident_no || '', undefined, { numeric: true });
        }
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });
  }, [all, status, sortField, sortOrder]);
  const stop = (e) => e.stopPropagation();
  const openIncident = useCallback((id, tabName) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('open', id); else next.delete('open');
      if (tabName && tabName !== 'sof') next.set('tab', tabName); else next.delete('tab');
      return next;
    }, { replace: true });
  }, [setParams]);

  const closeIncident = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('open');
      next.delete('tab');
      return next;
    }, { replace: true });
  }, [setParams]);

  return (
    <div className="inc-body">
      <div className="inc-control-bar">
        <div className="inc-control-left">
          <h1 className="inc-heading">Incident Reports</h1>
          <div className="inc-stats">
            <span className="inc-stat"><b>{counts.total}</b> Total</span>
            <span className="inc-stat inc-stat--amber"><b>{counts.draft}</b> Draft</span>
            <span className="inc-stat inc-stat--green"><b>{counts.closed}</b> Closed</span>
            <span className="inc-stat inc-stat--red"><b>{counts.offhire}</b> Off-hire</span>
          </div>
        </div>
        <div className="inc-control-right">
          <div className="inc-search">
            <Search size={15} />
            <input type="search" placeholder="Search ID, vessel, description…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {me?.can_create && (
            <button type="button" className="inc-btn inc-btn--primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New incident
            </button>
          )}
        </div>
      </div>

      <div className="inc-filterbar">
        <div className="inc-seg" role="tablist" aria-label="Status">
          {STATUS_TABS.map(([v, label]) => (
            <button key={v || 'all'} type="button" role="tab" aria-selected={status === v}
                    className={`inc-seg__btn${status === v ? ' inc-seg__btn--on' : ''}`} onClick={() => setParam('status', v)}>
              {label}
            </button>
          ))}
        </div>
        <CardSelect
          value={filters.vessel_imo}
          onChange={(val) => setParam('vessel', val)}
          options={vessels}
          placeholder="All vessels"
          ariaLabel="Filter by vessel"
          icon={Ship}
          size="sm"
          searchable
          multi
        />
        <CardSelect
          value={filters.category}
          onChange={(val) => setParam('category', val)}
          options={categories}
          placeholder="All categories"
          ariaLabel="Filter by category"
          icon={Layers}
          size="sm"
          multi
        />
        <label className="inc-datef">From <input type="date" value={filters.date_from} onChange={(e) => setParam('from', e.target.value)} /></label>
        <label className="inc-datef">To <input type="date" value={filters.date_to} onChange={(e) => setParam('to', e.target.value)} /></label>
      </div>

      {error && <div className="inc-error inc-error--bar" role="alert">{error}</div>}

      <div className="inc-card">
        <div className="inc-card__head">
          <div>
            <div className="inc-card__title">Incident register</div>
            <div className="inc-card__sub">{rows.length} incident{rows.length === 1 ? '' : 's'} · click a row to open it</div>
          </div>
        </div>
        <div className="inc-card__scroll">
          <table className="inc-table">
            <thead>
              <tr>
                <th>Status</th>
                <th
                  className={`inc-th-sortable${sortField === 'incident_no' && sortOrder !== 'normal' ? ' inc-th-sortable--active' : ''}`}
                  onClick={() => toggleSort('incident_no')}
                  title={
                    sortField === 'incident_no' && sortOrder === 'asc'
                      ? 'Sorted: Ascending (0001 to 9999). Click to sort descending.'
                      : sortField === 'incident_no' && sortOrder === 'desc'
                      ? 'Sorted: Descending (9999 to 0001). Click for normal order.'
                      : 'Click to sort by Incident ID (Ascending)'
                  }
                >
                  <div className="inc-th-sort-inner">
                    <span>Incident ID</span>
                    <span className={`inc-sort-icon${sortField === 'incident_no' && sortOrder !== 'normal' ? ' inc-sort-icon--active' : ''}`}>
                      {sortField === 'incident_no' && sortOrder === 'asc' ? (
                        <ArrowUp size={13} />
                      ) : sortField === 'incident_no' && sortOrder === 'desc' ? (
                        <ArrowDown size={13} />
                      ) : (
                        <ArrowUpDown size={13} />
                      )}
                    </span>
                  </div>
                </th>
                <th>Vessel</th>
                <th
                  className={`inc-th-sortable${sortField === 'incident_date' && sortOrder !== 'normal' ? ' inc-th-sortable--active' : ''}`}
                  onClick={() => toggleSort('incident_date')}
                  title={
                    sortField === 'incident_date' && sortOrder === 'asc'
                      ? 'Sorted: Oldest first. Click to sort newest first.'
                      : sortField === 'incident_date' && sortOrder === 'desc'
                      ? 'Sorted: Newest first. Click for normal order.'
                      : 'Click to sort by Date (Oldest first)'
                  }
                >
                  <div className="inc-th-sort-inner">
                    <span>Date</span>
                    <span className={`inc-sort-icon${sortField === 'incident_date' && sortOrder !== 'normal' ? ' inc-sort-icon--active' : ''}`}>
                      {sortField === 'incident_date' && sortOrder === 'asc' ? (
                        <ArrowUp size={13} />
                      ) : sortField === 'incident_date' && sortOrder === 'desc' ? (
                        <ArrowDown size={13} />
                      ) : (
                        <ArrowUpDown size={13} />
                      )}
                    </span>
                  </div>
                </th>
                <th>Description</th>
                <th>Category</th>
                <th>PIC</th>
                <th>Offhire</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="inc-empty"><Loader2 size={20} className="inc-spin" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="inc-empty">
                  <FileWarning size={30} />
                  <span>No incidents match these filters.</span>
                </td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="inc-row-click" tabIndex={0} onClick={() => openIncident(r.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') openIncident(r.id); }}>
                  <td><span className={`inc-badge inc-badge--${r.status.toLowerCase()}`}>{r.status === 'DRAFT' ? 'Draft' : 'Closed'}</span></td>
                  <td className="inc-nowrap inc-col-id">{r.incident_no}</td>
                  <td className="inc-col-strong">{r.vessel_name}</td>
                  <td className="inc-nowrap inc-col-date">{fmtDay(r.incident_date)}</td>
                  <td className="inc-clamp" title={r.description}>{r.description || <span className="inc-muted">—</span>}</td>
                  <td>{r.category ? <span className="inc-cat">{r.category}</span> : <span className="inc-muted">—</span>}</td>
                  <td onClick={(e) => {
                    if (r.first_photo_id) {
                      e.stopPropagation();
                      openIncident(r.id, 'photos');
                    }
                  }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      {r.first_photo_id && (
                        <span
                          className="inc-thumb inc-thumb--clickable"
                          role="button"
                          tabIndex={0}
                          title="Click to view photo evidence"
                          aria-label="View photo evidence"
                          onClick={(e) => {
                            e.stopPropagation();
                            openIncident(r.id, 'photos');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              openIncident(r.id, 'photos');
                            }
                          }}
                        >
                          <AuthedImage incidentId={r.id} fileId={r.first_photo_id} alt="Photo" />
                          {r.photo_count > 1 && <span className="inc-thumb__n"><Images size={10} /> {r.photo_count}</span>}
                        </span>
                      )}
                      <span>{r.pic_name || (!r.first_photo_id && <span className="inc-muted">—</span>)}</span>
                    </div>
                  </td>
                  <td>{r.offhire ? <span className="inc-badge inc-badge--off" title={r.offhire_details}>Off-hire</span> : <span className="inc-muted">No</span>}</td>
                  <td onClick={stop}>
                    {r.first_report ? (
                      <button type="button" className="inc-viewbtn" title={r.first_report.file_name}
                              onClick={() => openFile(r.id, r.first_report.id).catch(() => setError('Could not open the report'))}>
                        <Paperclip size={13} /> {r.report_count > 1 ? `${r.report_count} files` : 'View'}
                      </button>
                    ) : <span className="inc-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && (
        <IncidentModal
          id={openId}
          me={me}
          initialTab={openTab}
          siblings={rows.map((r) => r.id)}
          onNavigate={openIncident}
          onClose={closeIncident}
          onChanged={() => load(true)}
        />
      )}
      {creating && (
        <IncidentForm
          incident={null}
          onClose={() => setCreating(false)}
          onSaved={(inc) => { setCreating(false); load(true); openIncident(inc.id); }}
        />
      )}
    </div>
  );
}
