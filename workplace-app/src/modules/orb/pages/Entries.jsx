import { Fragment, useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, Search, RotateCcw, FileSearch, ChevronRight, AlertTriangle } from 'lucide-react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/Layout/Header';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import Dropdown from '../components/shared/Dropdown';
import MultiSelectDropdown from '../components/shared/MultiSelectDropdown';
import { useAuth } from '../context/AuthContext';
import api from '../api/axiosOrb';
import './Entries.css';

const ORB_CODES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const EMPTY_FILTERS = {
  vessel_id: [], orb_code: '', date_from: '', date_to: '', confidence_below: '',
};

const confidenceTone = (score) => (score >= 0.9 ? 'high' : score >= 0.75 ? 'mid' : 'low');

export default function Entries() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isShore, isVessel } = useAuth();
  const isVesselUser = isVessel || user?.role === 'VESSEL';
  const isShoreView = !isVesselUser;
  const showVesselCol = isShoreView;

  const [entries, setEntries] = useState([]);
  const [vessels, setVessels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  // Initialize filters from URL search params if present
  const [filters, setFilters] = useState(() => {
    const vesselParam = searchParams.getAll('vessel_id');
    const singleVessel = searchParams.get('vessel_id');
    const vessel_id = (isShoreView && vesselParam.length > 0)
      ? vesselParam
      : (isShoreView && singleVessel ? singleVessel.split(',').filter(Boolean) : []);

    return {
      vessel_id,
      orb_code: searchParams.get('orb_code') || '',
      date_from: searchParams.get('date_from') || '',
      date_to: searchParams.get('date_to') || '',
      confidence_below: searchParams.get('confidence_below') || '',
    };
  });

  const vesselMap = useMemo(() => {
    const map = {};
    vessels.forEach(v => {
      map[v.id] = v.name;
    });
    return map;
  }, [vessels]);

  useEffect(() => {
    if (isShoreView) {
      api.get('/api/vessels').then(r => setVessels(r.data.data || [])).catch(() => {});
    }
  }, [isShoreView]);

  const load = (activeFilters = filters) => {
    setLoading(true);
    // Ignore overrides if it is a DOM/React event object (e.g. from onClick={load})
    const cleanFilters = (activeFilters && typeof activeFilters === 'object' && !activeFilters._reactName && !activeFilters.nativeEvent)
      ? activeFilters
      : filters;
    const finalFilters = { ...cleanFilters };

    // For vessel users, never filter by vessel_id
    if (!isShoreView) {
      finalFilters.vessel_id = [];
    }

    const params = new URLSearchParams();
    Object.entries(finalFilters).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(item => params.append(k, item));
      else if (v) params.append(k, v);
    });

    // Keep URL query params in sync
    setSearchParams(params, { replace: true });

    api.get(`/api/entries?${params}`)
      .then(r => setEntries(r.data.data || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(filters);
  }, []);

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  const handleVesselChange = (selectedVessels) => {
    const nextFilters = { ...filters, vessel_id: selectedVessels };
    setFilters(nextFilters);
    load(nextFilters);
  };

  const handleOrbCodeChange = (code) => {
    const nextFilters = { ...filters, orb_code: code };
    setFilters(nextFilters);
    load(nextFilters);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      load(filters);
    }
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    load(EMPTY_FILTERS);
  };

  const activeCount = Object.values(filters).filter(v => (Array.isArray(v) ? v.length > 0 : v !== '')).length;
  const colSpan = showVesselCol ? 9 : 8;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Header title="ORB Entries" />
        <div className="page-body">
          <div className="en">
            <div className="en-header">
              <div className="en-header__text">
                <span className="en-eyebrow">Oil Record Book</span>
                <h1 className="en-title">ORB Entries</h1>
                <p className="en-subtitle">Browse extracted Oil Record Book entries and check extraction confidence.</p>
              </div>
            </div>

            <section className="en-filters">
              <div className="en-filters__head">
                <span className="en-filters__title"><Filter size={14} /> Filters</span>
                {activeCount > 0 && <span className="en-filters__badge">{activeCount} active</span>}
              </div>
              <div className={`en-filters__grid${!isShoreView ? ' en-filters__grid--vessel' : ''}`}>
                {isShoreView && (
                  <div className="form-group en-f-vessel">
                    <label>Vessel</label>
                    <MultiSelectDropdown
                      value={filters.vessel_id}
                      onChange={handleVesselChange}
                      placeholder="All vessels (or select)"
                      options={vessels.map(v => ({ value: v.id, label: v.name }))}
                    />
                  </div>
                )}
                <div className="form-group">
                  <label>ORB Code</label>
                  <Dropdown
                    value={filters.orb_code}
                    onChange={handleOrbCodeChange}
                    options={[{ value: '', label: 'All' }, ...ORB_CODES.map(c => ({ value: c, label: `Code ${c}` }))]}
                  />
                </div>
                <div className="form-group">
                  <label>Date From</label>
                  <input
                    type="date"
                    className="form-control"
                    value={filters.date_from}
                    onChange={e => setFilter('date_from', e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label>Date To</label>
                  <input
                    type="date"
                    className="form-control"
                    value={filters.date_to}
                    onChange={e => setFilter('date_to', e.target.value)}
                    onKeyDown={handleKeyDown}
                  />
                </div>
                <div className="form-group">
                  <label>Confidence Below</label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    className="form-control"
                    value={filters.confidence_below}
                    onChange={e => setFilter('confidence_below', e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="e.g. 0.75"
                  />
                </div>
              </div>
              <div className="en-filters__actions">
                <button className="en-btn en-btn--secondary" onClick={clearFilters} disabled={activeCount === 0}>
                  <RotateCcw size={15} /> Clear Filters
                </button>
                <button className="en-btn en-btn--primary" onClick={() => load(filters)}>
                  <Search size={16} /> Apply
                </button>
              </div>
            </section>

            {loading ? <LoadingSpinner /> : (
              <div className="en-panel">
                <div className="en-panel__bar">
                  <span className="en-count"><strong>{entries.length}</strong> {entries.length === 1 ? 'entry' : 'entries'}</span>
                  <span className="en-legend">
                    <span className="en-legend__item"><i className="en-dot en-dot--high" /> ≥ 90%</span>
                    <span className="en-legend__item"><i className="en-dot en-dot--mid" /> 75–89%</span>
                    <span className="en-legend__item"><i className="en-dot en-dot--low" /> &lt; 75%</span>
                  </span>
                </div>
                <div className="en-table-wrap">
                  <table className="en-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        {showVesselCol && <th>Vessel</th>}
                        <th>Code</th>
                        <th>Item</th>
                        <th>Operation</th>
                        <th>Tank/Location</th>
                        <th>Officers</th>
                        <th className="en-center">Page</th>
                        <th>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.length === 0 ? (
                        <tr className="en-emptyrow">
                          <td colSpan={colSpan}>
                            <div className="en-empty">
                              <span className="en-empty__icon"><FileSearch size={24} /></span>
                              <div className="en-empty__title">No entries found.</div>
                              <div className="en-empty__text">
                                {isShoreView && filters.vessel_id?.length > 0
                                  ? `No extracted entries recorded for ${filters.vessel_id.map(id => vesselMap[id] || 'selected vessel').join(', ')}. Try selecting another vessel or clearing filters.`
                                  : 'Try adjusting or clearing the filters.'}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : entries.map(e => {
                        const isOpen = expanded === e.id;
                        const tone = e.confidence_score != null ? confidenceTone(e.confidence_score) : null;
                        return (
                          <Fragment key={e.id}>
                            <tr
                              className={`en-row${e.confidence_score < 0.75 ? ' row-low-confidence en-row--low' : ''}${isOpen ? ' en-row--open' : ''}`}
                              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                            >
                              <td data-label="Date" className="en-date">
                                <ChevronRight size={14} className={`en-chev${isOpen ? ' en-chev--open' : ''}`} />
                                {e.entry_date}
                              </td>
                              {showVesselCol && (
                                <td data-label="Vessel" className="en-vessel">
                                  {vesselMap[e.vessel_id] || '—'}
                                </td>
                              )}
                              <td data-label="Code"><span className="en-code">{e.orb_code}</span></td>
                              <td data-label="Item" className="en-mono">{e.item_number || '—'}</td>
                              <td data-label="Operation" className="en-op"><span className="en-op__text">{e.operation_description}</span></td>
                              <td data-label="Tank/Location">{e.tank_location || '—'}</td>
                              <td data-label="Officers" className="en-muted">{e.officer_1_name || '—'}</td>
                              <td data-label="Page" className="en-center en-muted">{e.page_number ?? '—'}</td>
                              <td data-label="Confidence">
                                {e.confidence_score != null ? (
                                  <div className={`en-conf en-conf--${tone}`}>
                                    <div className="en-conf__track">
                                      <div className="en-conf__fill" style={{ width: `${e.confidence_score * 100}%` }} />
                                    </div>
                                    <span className="en-conf__val">{(e.confidence_score * 100).toFixed(0)}%</span>
                                    {tone === 'low' && <AlertTriangle size={13} className="en-conf__warn" />}
                                  </div>
                                ) : '—'}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="en-exprow">
                                <td colSpan={colSpan}>
                                  <div className="en-detail">
                                    <div className="en-detail__title">Quantities</div>
                                    {e.quantities?.length ? (
                                      <div className="en-qty-wrap">
                                        <table className="en-qty">
                                          <thead><tr><th>Type</th><th>Value</th><th>Unit</th><th>From</th><th>To</th></tr></thead>
                                          <tbody>
                                            {e.quantities.map(q => (
                                              <tr key={q.id}>
                                                <td>{q.qty_type}</td>
                                                <td>{q.qty_value}</td>
                                                <td>{q.qty_unit}</td>
                                                <td>{q.from_tank || '—'}</td>
                                                <td>{q.to_tank || '—'}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    ) : <span className="en-muted"> None</span>}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
