// src/modules/reports/features/shore/ReportConfigPage.jsx
// Full-page admin config — vessel-wise breakdown showing configured targets
// and which are missing (not yet scraped), with full CRUD on targets.
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../../api/reportsApi';
import {
  ArrowLeft, Plus, Trash2, Pencil, Check, X,
  Ship, AlertCircle, CheckCircle2,
  Clock, RefreshCcw, Settings, Zap, ChevronDown
} from 'lucide-react';
import '../../styles/ReportConfigPage.css';

const EMPTY_FORM = { vessel_name: '', vessel_imo: '', report_name: '', department: 'DECK', frequency: 'MONTHLY' };
const FREQS = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'OTHER'];

const CustomSelect = ({ value, onChange, options, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="rcfg-custom-select" ref={ref}>
      <div className="rcfg-select-trigger" onClick={() => setIsOpen(!isOpen)}>
        {value ? options.find(o => o.value === value)?.label : placeholder}
        <ChevronDown size={14} className={isOpen ? 'open' : ''} />
      </div>
      {isOpen && (
        <div className="rcfg-select-dropdown">
          {options.map(o => (
            <div 
              key={o.value} 
              className={`rcfg-select-option ${value === o.value ? 'selected' : ''}`}
              onClick={() => { onChange(o.value); setIsOpen(false); }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function ReportConfigPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [showAddForm, setShowAddForm] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [selectedVesselImo, setSelectedVesselImo] = useState(null);

  // ── Data ──
  const { data: configs = [], isLoading: configLoading, refetch } = useQuery({
    queryKey: ['report-configs'],
    queryFn: () => reportsApi.listConfigs(),
  });

  const { data: reports = [], isLoading: reportLoading } = useQuery({
    queryKey: ['reports-list'],
    queryFn: () => reportsApi.listReports(),
    refetchInterval: 60000,
  });

  const { data: coreVessels = [], isLoading: coreVesselsLoading } = useQuery({
    queryKey: ['core-vessels'],
    queryFn: () => reportsApi.getVessels(),
  });

  // ── Mutations ──
  const registerMutation = useMutation({
    mutationFn: (data) => reportsApi.bulkAssignVessel(data.vessel_imo, data.vessel_name),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries(['report-configs']);
    },
  });

  const addMutation = useMutation({
    mutationFn: data => reportsApi.createConfig(data),
    onSuccess: () => {
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      queryClient.invalidateQueries(['report-configs']);
    },
  });

  const delMutation = useMutation({
    mutationFn: id => reportsApi.deleteConfig(id),
    onSuccess: () => queryClient.invalidateQueries(['report-configs']),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      await reportsApi.deleteConfig(id);
      await reportsApi.createConfig(data);
    },
    onSuccess: () => {
      setEditingId(null);
      queryClient.invalidateQueries(['report-configs']);
    },
  });

  // ── Vessel-wise grouping ──
  const vesselGroups = useMemo(() => {
    const groups = {};
    
    // Seed groups with all core vessels
    coreVessels.forEach(cv => {
      groups[cv.imo] = { imo: cv.imo, name: cv.name, configs: [] };
    });

    // Populate with existing configs
    configs.forEach(c => {
      if (!groups[c.vessel_imo]) {
        groups[c.vessel_imo] = { imo: c.vessel_imo, name: c.vessel_name, configs: [] };
      }
      groups[c.vessel_imo].configs.push(c);
    });

    // Attach scraped report status to each config
    Object.values(groups).forEach(g => {
      g.configs = g.configs.map(c => {
        const scraped = reports.find(
          r => r.vessel_imo === c.vessel_imo && r.report_code === c.report_code
        );
        return { ...c, scrapeStatus: scraped?.scrape_status || 'MISSING', lastScraped: scraped?.updated_at, nextDueDate: scraped?.next_due_date };
      });
      // Sort configs by report code
      g.configs.sort((a, b) => a.report_code.localeCompare(b.report_code));
    });

    const sortedGroups = Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
    return sortedGroups;
  }, [configs, reports, coreVessels, selectedVesselImo]);

  useEffect(() => {
    if (!selectedVesselImo && vesselGroups.length > 0) {
      setSelectedVesselImo(vesselGroups[0].imo);
    }
  }, [selectedVesselImo, vesselGroups]);

  function startEdit(c) {
    setEditingId(c.id);
    setEditForm({ vessel_name: c.vessel_name, vessel_imo: c.vessel_imo, report_name: c.report_name, department: c.department || 'DECK', frequency: c.frequency || 'MONTHLY' });
  }

  const loading = configLoading || reportLoading || coreVesselsLoading;
  const activeVessel = vesselGroups.find(g => g.imo === selectedVesselImo);

  return (
    <div className="rcfg-root">

      {/* ── Page Header ── */}
      <div className="rcfg-header">
        <div className="rcfg-header-left">
          <button className="rcfg-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back
          </button>
          <div>
            <div className="rcfg-header-title">
              <Settings size={20} />
              Report Configuration
            </div>
            <div className="rcfg-header-sub">
              Manage vessel scraper targets and track report coverage
            </div>
          </div>
        </div>

        <div className="rcfg-header-actions">
          <button className="rcfg-btn rcfg-btn--ghost" onClick={() => refetch()}>
            <RefreshCcw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* ── Main Layout (Sidebar + Content) ── */}
      <div className="rcfg-layout">
        
        {/* Sidebar */}
        <div className="rcfg-sidebar">
          {loading && !vesselGroups.length ? (
            <div className="rcfg-loading"><span className="rcfg-spinner" /><span>Loading vessels...</span></div>
          ) : vesselGroups.length === 0 ? (
            <div className="rcfg-empty" style={{ padding: '40px 10px' }}>
              <Ship size={32} strokeWidth={1} />
              <p>No vessels configured</p>
            </div>
          ) : (
            vesselGroups.map(vessel => {
              const scraped = vessel.configs.filter(c => c.scrapeStatus === 'SCRAPED').length;
              const pct = vessel.configs.length > 0 ? Math.round((scraped / vessel.configs.length) * 100) : 0;
              const isActive = selectedVesselImo === vessel.imo;

              return (
                <div 
                  key={vessel.imo} 
                  className={`rcfg-vessel-card ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedVesselImo(vessel.imo)}
                >
                  <div className="rcfg-vessel-card-header">
                    <div className="rcfg-vessel-icon">
                      <Ship size={18} />
                    </div>
                    <div>
                      <div className="rcfg-vessel-name">{vessel.name}</div>
                      <div className="rcfg-vessel-imo">IMO {vessel.imo}</div>
                    </div>
                  </div>
                  
                  <div className="rcfg-progress-wrap">
                    <div className="rcfg-progress-bar">
                      <div className="rcfg-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="rcfg-progress-label">
                      <span>{pct}% Scraped</span>
                      <span>{scraped} / {vessel.configs.length}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Content Area */}
        <div className="rcfg-content">
          {loading && !activeVessel ? (
            <div className="rcfg-loading"><span className="rcfg-spinner" /><span>Loading configs...</span></div>
          ) : !activeVessel ? (
            <div className="rcfg-empty">
              <Ship size={48} strokeWidth={1} />
              <h3>Select a vessel</h3>
              <p>Choose a vessel from the sidebar to view its report targets.</p>
            </div>
          ) : (
            <>
              <div className="rcfg-content-header">
                <div>
                  <div className="rcfg-content-title">{activeVessel.name} — Configured Reports</div>
                  <div className="rcfg-content-subtitle">{activeVessel.configs.length} total report targets for this vessel</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className="rcfg-btn rcfg-btn--primary" 
                    onClick={() => registerMutation.mutate({ vessel_imo: activeVessel.imo, vessel_name: activeVessel.name })}
                    disabled={registerMutation.isPending}
                  >
                    <Zap size={14} /> {registerMutation.isPending ? 'Assigning...' : 'Assign 40 Defaults'}
                  </button>
                  <button className="rcfg-btn rcfg-btn--ghost" onClick={() => setShowAddForm(!showAddForm)}>
                    <Plus size={14} /> Add Custom Target
                  </button>
                </div>
              </div>

              {showAddForm && (
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--rcfg-border)', background: 'var(--rcfg-bg)' }}>
                  <form className="rcfg-form-row" onSubmit={e => { 
                    e.preventDefault(); 
                    if (!addForm.report_name) return; 
                    const freqPrefix = { 'WEEKLY': 'WK', 'MONTHLY': 'MO', 'QUARTERLY': 'QT', 'HALF_YEARLY': 'HY', 'YEARLY': 'YR' }[addForm.frequency || 'MONTHLY'] || 'XX';
                    const nameSnippet = addForm.report_name.substring(0, 30).trim().replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
                    const genCode = `${freqPrefix}-XX-${nameSnippet}`;
                    addMutation.mutate({ ...addForm, report_code: genCode, vessel_name: activeVessel.name, vessel_imo: activeVessel.imo }); 
                  }}>
                    <div className="rcfg-form-field">
                      <label>Frequency</label>
                      <CustomSelect 
                        value={addForm.frequency} 
                        onChange={val => setAddForm(f => ({ ...f, frequency: val }))}
                        options={FREQS.map(f => ({ value: f, label: f.replace('_', ' ') }))}
                        placeholder="Select Frequency"
                      />
                    </div>
                    <div className="rcfg-form-field">
                      <label>Report Name</label>
                      <input className="rcfg-inline-input" placeholder="e.g. Daily Deck Log" value={addForm.report_name} onChange={e => setAddForm(f => ({ ...f, report_name: e.target.value }))} required />
                    </div>
                    <div className="rcfg-form-field">
                      <label>Department</label>
                      <CustomSelect 
                        value={addForm.department} 
                        onChange={val => setAddForm(f => ({ ...f, department: val }))}
                        options={[
                          { value: 'DECK', label: 'Deck' },
                          { value: 'ENGINE', label: 'Engine' },
                          { value: 'MARPOL', label: 'Marpol' },
                          { value: 'ELECTRICAL', label: 'Electrical' }
                        ]}
                        placeholder="Select Department"
                      />
                    </div>
                    <div className="rcfg-form-field rcfg-form-field--action" style={{ display: 'flex', flexDirection: 'row', gap: '8px' }}>
                      <button type="button" className="rcfg-btn rcfg-btn--ghost" onClick={() => setShowAddForm(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="rcfg-btn rcfg-btn--primary" disabled={addMutation.isPending}>
                        <Plus size={14} /> Add
                      </button>
                    </div>
                  </form>
                </div>
              )}

              <div className="rcfg-table-wrap">
                <table className="rcfg-report-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Report Code</th>
                      <th>Report Name</th>
                      <th>Dept</th>
                      <th>Last Scraped</th>
                      <th>Next Due</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FREQS.map(freq => {
                      const freqConfigs = activeVessel.configs.filter(c => {
                        let f = (c.frequency || 'OTHER').toUpperCase().trim().replace(/[-\s]+/g, '_');
                        if (f === 'HALFYEARLY') f = 'HALF_YEARLY';
                        if (!FREQS.includes(f)) f = 'OTHER';
                        return f === freq;
                      });
                      if (freqConfigs.length === 0) return null;
                      
                      return (
                        <React.Fragment key={freq}>
                          <tr style={{ background: '#f8fafc' }}>
                            <td colSpan="7" style={{ padding: '8px 20px', fontWeight: 700, fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              {freq.replace('_', ' ')}
                            </td>
                          </tr>
                          {freqConfigs.map(c => (
                            <tr key={c.id} className={editingId === c.id ? 'rcfg-row-editing' : ''}>
                              {editingId === c.id ? (
                                <>
                                  <td>—</td>
                                  <td>
                                    <select className="rcfg-inline-input" value={editForm.frequency} onChange={e => setEditForm(f => ({ ...f, frequency: e.target.value }))}>
                                      {FREQS.map(f => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
                                    </select>
                                  </td>
                                  <td><input className="rcfg-inline-input" value={editForm.report_name} onChange={e => setEditForm(f => ({ ...f, report_name: e.target.value }))} /></td>
                                  <td>
                                    <select className="rcfg-inline-input" value={editForm.department} onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))}>
                                      <option value="DECK">Deck</option>
                                      <option value="ENGINE">Engine</option>
                                      <option value="MARPOL">Marpol</option>
                                      <option value="ELECTRICAL">Electrical</option>
                                    </select>
                                  </td>
                                  <td>—</td>
                                  <td>—</td>
                                  <td>
                                    <div className="rcfg-actions">
                                      <button className="rcfg-icon-btn rcfg-icon-btn--save" onClick={() => editMutation.mutate({ id: c.id, data: { ...editForm, report_code: c.report_code } })} title="Save"><Check size={14} /></button>
                                      <button className="rcfg-icon-btn rcfg-icon-btn--cancel" onClick={() => setEditingId(null)} title="Cancel"><X size={14} /></button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td>
                                    {c.scrapeStatus === 'SCRAPED' ? (
                                      <span className="rcfg-status rcfg-status--scraped"><CheckCircle2 size={12} /> Scraped</span>
                                    ) : c.scrapeStatus === 'FAILED' ? (
                                      <span className="rcfg-status rcfg-status--failed"><AlertCircle size={12} /> Failed</span>
                                    ) : (
                                      <span className="rcfg-status rcfg-status--missing"><Clock size={12} /> Missing</span>
                                    )}
                                  </td>
                                  <td><code className="rcfg-code" style={{ fontSize: '0.8rem' }}>{c.report_code}</code></td>
                                  <td className="rcfg-td-name">{c.report_name}</td>
                                  <td>
                                    <span className={`rcfg-dept ${c.department?.toLowerCase()}`}>
                                      {c.department || '—'}
                                    </span>
                                  </td>
                                  <td>
                                    {c.lastScraped ? new Date(c.lastScraped).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                  </td>
                                  <td>
                                    {c.nextDueDate ? new Date(c.nextDueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                  </td>
                                  <td>
                                    <div className="rcfg-actions">
                                      <button className="rcfg-icon-btn rcfg-icon-btn--edit" onClick={() => startEdit(c)} title="Edit"><Pencil size={14} /></button>
                                      <button className="rcfg-icon-btn rcfg-icon-btn--delete" onClick={() => delMutation.mutate(c.id)} title="Delete"><Trash2 size={14} /></button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
