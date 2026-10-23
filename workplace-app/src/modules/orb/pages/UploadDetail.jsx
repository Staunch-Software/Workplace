import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useNavigate } from '../hooks/useOrbNavigate';
import { MessageSquare, RefreshCw, FileText, FileSpreadsheet, Download, Ship, User, CalendarClock, ListChecks, Layers, Copy, AlertTriangle, CheckCircle2, XCircle, Table2, ClipboardList, Anchor } from 'lucide-react';
import Sidebar from '../components/Layout/Sidebar';
import Header from '../components/Layout/Header';
import Badge from '../components/shared/Badge';
import Modal from '../components/shared/Modal';
import LoadingSpinner from '../components/shared/LoadingSpinner';
import api from '../api/axiosOrb';
import { useAuth } from '../context/AuthContext';
import AlertModal from '../components/alerts/AlertModal';
import SourceEntryDetail from '../components/alerts/SourceEntryDetail';
import './UploadDetail.css';

const TABS = ['Entries', 'Alerts', 'Daily Log'];

const COL_LABELS = [
  { key: 'date',                  label: 'Date' },
  { key: 'iopp_retention',        label: 'IOPP Tanks Retention (m³)' },
  { key: 'non_iopp_retention',    label: 'Non-IOPP Tanks Retention (m³)' },
  { key: 'total_sludge_retention',label: 'Total Sludge Retention (m³)' },
  { key: 'sludge_incineration',   label: 'Sludge Incineration (m³)' },
  { key: 'evaporation',           label: 'Total Evaporation (m³)' },
  { key: 'sludge_ashore',         label: 'Sludge Pumped Ashore (m³)' },
  { key: 'bilge_retention',       label: 'Bilge Retention (m³)' },
  { key: 'bilge_15ppm',           label: 'Bilge Pumped thru 15 PPM (m³)' },
  { key: 'bilge_ashore',          label: 'Bilge Pumped Ashore (m³)' },
  { key: 'equipment_failure',     label: '15 PPM Failures' },
  { key: 'bunker_qty',            label: 'Bunker Taken (MT)' },
  { key: 'bunker_grade',          label: 'Grade' },
];

function formatDailyLogCell(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value.map(v => `${v.tank_name}: ${v.value}`).join(', ');
  }
  return value ?? '—';
}

const SUMMARY_LABELS = [
  { key: 'total_sludge_retention',      label: 'Total Sludge Accumulation (m³)' },
  { key: 'sludge_accumulation_ratio',   label: 'Sludge Accum. / Fuel Consumed (%)' },
  { key: 'sludge_incineration',         label: 'Total Sludge Incineration (m³)' },
  { key: 'evaporation',                 label: 'Total Evaporation (m³)' },
  { key: 'sludge_ashore',              label: 'Total Sludge Pumped Ashore (m³)' },
  { key: 'bilge_retention',             label: 'Total Bilge Accumulation (m³)' },
  { key: 'bilge_15ppm',                 label: 'Total Bilge via 15 PPM (m³)' },
  { key: 'bilge_ashore',               label: 'Total Bilge Pumped Ashore (m³)' },
  { key: 'equipment_failure',           label: 'No. of 15 PPM Failures' },
  { key: 'bunker_qty',                  label: 'Total Bunker Taken (MT)' },
];

export default function UploadDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [upload, setUpload] = useState(null);
  const [entries, setEntries] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [dailyLog, setDailyLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logLoading, setLogLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('Entries');
  const [preview, setPreview] = useState(null); // { url, loading }
  const { isAdmin, user } = useAuth();
  const [openAlertId, setOpenAlertId] = useState(null);   // alert whose Source ORB Entry is expanded
  const [modalAlert, setModalAlert] = useState(null);     // alert open in the popup
  const [reprocessing, setReprocessing] = useState(false);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [u, e, a] = await Promise.all([
        api.get(`/api/uploads/${id}`),
        api.get(`/api/uploads/${id}/entries`),
        api.get(`/api/uploads/${id}/alerts?is_resolved=false`),
      ]);
      setUpload(u.data.data);
      setEntries(e.data.data || []);
      setAlerts(a.data.data || []);
    } finally {
      setLoading(false);
    }
  };

  const loadDailyLog = async () => {
    if (dailyLog) return; // already loaded
    setLogLoading(true);
    try {
      const res = await api.get(`/api/uploads/${id}/daily-log`);
      setDailyLog(res.data.data);
    } catch (e) {
      console.error('Daily log load failed', e);
    } finally {
      setLogLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (activeTab === 'Daily Log') loadDailyLog();
  }, [activeTab]);

  const resolveAlert = async (alertId) => {
    await api.patch(`/api/alerts/${alertId}/resolve`, { notes: '' });
    load(true);
  };

  const openPreview = async () => {
    setPreview({ url: null, loading: true });
    try {
      const res = await api.get(`/api/uploads/${id}/pdf`, { responseType: 'blob' });
      setPreview({ url: window.URL.createObjectURL(res.data), loading: false });
    } catch (e) {
      console.error('PDF preview load failed', e);
      setPreview(null);
    }
  };

  const closePreview = () => {
    if (preview?.url) window.URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  // TEMPORARY (testing only): re-run extraction on this upload. Remove with the backend endpoint.
  const reprocess = async () => {
    if (!window.confirm('Re-run extraction on this upload?\n\nIts current entries and their alerts are deleted and rebuilt from the PDF. Resolved-alert history for those entries is lost.')) return;
    setReprocessing(true);
    try {
      await api.post(`/api/uploads/${id}/reprocess`);
      await load();
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Could not start re-extraction');
    } finally {
      setReprocessing(false);
    }
  };

  // TEMPORARY (testing only): re-apply post-processing to the saved extraction -- no Gemini cost.
  const reprocessSaved = async () => {
    if (!window.confirm('Re-process this upload from its saved extraction?\n\nNo Gemini calls are made (no cost). Its current entries and their alerts are deleted and rebuilt with the latest repair and check rules.')) return;
    setReprocessing(true);
    try {
      await api.post(`/api/uploads/${id}/reprocess-saved`);
      await load();
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Could not start re-processing');
    } finally {
      setReprocessing(false);
    }
  };

  // While an upload is being (re)processed, refresh every 5s so the status updates by itself.
  useEffect(() => {
    if (!upload || !['pending', 'processing'].includes(upload.status)) return undefined;
    const t = setInterval(async () => {
      // Quiet refresh of the upload row only (load() would flash the full-page spinner).
      const r = await api.get(`/api/uploads/${id}`);
      const next = r.data.data;
      setUpload(next);
      if (!['pending', 'processing'].includes(next.status)) load();
    }, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload?.status]);

  const downloadFile = async (type) => {
    const res = await api.get(`/api/uploads/${id}/export/${type}`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ORB_Report.${type === 'excel' ? 'xlsx' : 'pdf'}`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content"><Header title="Upload Detail" backTo="/uploads" /><LoadingSpinner /></div>
    </div>
  );

  const STEPS = ['Uploaded', 'Processing', 'Extracted', 'Completed'];
  const stepIndex = !upload ? 0
    : upload.status === 'pending' ? 0
    : upload.status === 'processing' ? 1
    : upload.status === 'failed' ? 1
    : upload.extracted_entries_count > 0 ? 2 : 1;
  const activeIndex = upload?.status === 'completed' ? 3 : stepIndex;
  const isError = upload?.status === 'failed';

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-content">
        <Header title="Upload Detail" backTo="/uploads" />
        <div className="page-body">
          <div className="ud">

            {/* ── Breadcrumb ── */}
            <nav className="ud-crumb" aria-label="Breadcrumb">
              <button type="button" className="ud-crumb__link" onClick={() => navigate('/uploads')}>
                ORB Uploads
              </button>
              <span className="ud-crumb__sep">/</span>
              <span className="ud-crumb__current">{upload?.original_filename || 'Detail'}</span>
            </nav>

            {/* ── Upload info card ── */}
            {upload && (
              <div className="ud-panel ud-summary">
                <div className="ud-summary__top">
                  <div className="ud-file">
                    <span className="ud-file__icon"><FileText size={24} /></span>
                    <div className="ud-file__body">
                      <span className="ud-eyebrow">ORB Upload</span>
                      <h2 className="ud-title">{upload.original_filename}</h2>
                      <div className="ud-meta">
                        <span className="ud-meta__item"><Ship size={15} />Vessel: <strong>{upload.vessel_name}</strong></span>
                        <span className="ud-meta__item"><User size={15} />Uploaded by: <strong>{upload.uploader_name}</strong></span>
                        <span className="ud-meta__item"><CalendarClock size={15} />{new Date(upload.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="ud-actions">
                    <button className="ud-btn ud-btn--secondary" onClick={openPreview}>
                      <FileText size={15} />
                      Preview PDF
                    </button>
                    {isAdmin && ['completed', 'failed'].includes(upload.status) && (
                      <button className="ud-btn ud-btn--secondary" onClick={reprocessSaved} disabled={reprocessing}
                              title="Temporary testing option: re-apply the latest rules to the saved extraction (no Gemini cost)">
                        <RefreshCw size={15} />Re-process saved (free)
                      </button>
                    )}
                    {isAdmin && ['completed', 'failed', 'processing'].includes(upload.status) && (
                      <button className="ud-btn ud-btn--secondary" onClick={reprocess} disabled={reprocessing}
                              title="Temporary testing option: rebuild this upload's entries from the PDF">
                        <RefreshCw size={15} />{reprocessing ? 'Starting…' : (upload.status === 'processing' ? 'Re-run (if stuck)' : 'Re-run extraction')}
                      </button>
                    )}
                    {upload.status === 'completed' && (
                      <>
                        <button className="ud-btn ud-btn--secondary" onClick={() => downloadFile('excel')}>
                          <FileSpreadsheet size={15} />Download Excel
                        </button>
                        <button className="ud-btn ud-btn--primary" onClick={() => downloadFile('pdf')}>
                          <Download size={15} />Download PDF
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Stat tiles */}
                <div className="ud-stats">
                  <div className="ud-stat">
                    <span className="ud-stat__icon"><ListChecks size={17} /></span>
                    <div>
                      <div className="ud-stat__value">{upload.extracted_entries_count}</div>
                      <div className="ud-stat__label">entries extracted</div>
                    </div>
                  </div>
                  <div className={`ud-stat ${upload.status === 'completed' ? 'ud-stat--green' : upload.status === 'failed' ? 'ud-stat--red' : 'ud-stat--amber'}`}>
                    <span className="ud-stat__icon">
                      {upload.status === 'completed' ? <CheckCircle2 size={17} /> : upload.status === 'failed' ? <XCircle size={17} /> : <Layers size={17} />}
                    </span>
                    <div>
                      <div className="ud-stat__value"><Badge value={upload.status} /></div>
                      <div className="ud-stat__label">
                        {upload.status === 'processing' && upload.total_pages > 0
                          ? `Page ${upload.pages_processed || 0} of ${upload.total_pages}`
                          : 'status'}
                      </div>
                    </div>
                  </div>
                  {upload.duplicate_entries_skipped > 0 && (
                    <div className="ud-stat ud-stat--amber">
                      <span className="ud-stat__icon"><Copy size={17} /></span>
                      <div>
                        <div className="ud-stat__value">{upload.duplicate_entries_skipped}</div>
                        <div className="ud-stat__label">duplicate {upload.duplicate_entries_skipped === 1 ? 'entry' : 'entries'} skipped</div>
                      </div>
                    </div>
                  )}
                </div>

                {(upload.duplicate_entries_skipped > 0 || upload.error_message) && (
                  <div className="ud-banners">
                    {upload.duplicate_entries_skipped > 0 && (
                      <div className="ud-banner ud-banner--warn">
                        <AlertTriangle size={16} />
                        <div>
                          <strong>{upload.duplicate_entries_skipped} duplicate {upload.duplicate_entries_skipped === 1 ? 'entry was' : 'entries were'} detected and skipped</strong> during extraction.
                          These entries already existed for this vessel (from a previous upload covering the same date range) and were not saved again to prevent double-counting.
                        </div>
                      </div>
                    )}
                    {upload.error_message && (
                      <div className="ud-banner ud-banner--error">
                        <XCircle size={16} />
                        <div>{upload.error_message}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Stage stepper */}
                <div className="ud-stepper">
                  {STEPS.map((step, i) => {
                    const done = i < activeIndex;
                    const active = i === activeIndex;
                    const failed = isError && i === 1;
                    const cls = failed ? 'ud-step--failed' : done ? 'ud-step--done' : active ? 'ud-step--active' : '';
                    return (
                      <div key={step} className={`ud-step ${cls} ${i < STEPS.length - 1 ? 'ud-step--grow' : ''}`}>
                        <div className="ud-step__col">
                          <div className="ud-step__dot">
                            {active && !done && (upload.status === 'processing' || upload.status === 'pending') ? (
                              <span className="ud-step__pulse" />
                            ) : done ? '✓' : failed ? '✕' : i + 1}
                          </div>
                          <span className="ud-step__label">{step}</span>
                        </div>
                        {i < STEPS.length - 1 && (
                          <div className={`ud-step__line ${i < activeIndex ? 'ud-step__line--done' : ''}`} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Tabs ── */}
            <div className="ud-tabs upload-tabs" role="tablist">
              {TABS.map(tab => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  className={`ud-tab ${activeTab === tab ? 'ud-tab--active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                  {tab === 'Alerts' && alerts.length > 0 && (
                    <span className="ud-tab__count">{alerts.length}</span>
                  )}
                </button>
              ))}
            </div>

            {/* ── Tab: Entries ── */}
            {activeTab === 'Entries' && (
              <div className="ud-panel ud-section">
                <div className="ud-section__head">
                  <h3 className="ud-section__title"><ClipboardList size={18} />Extracted Entries <span className="ud-pill">{entries.length}</span></h3>
                </div>
                <div className="ud-table-wrap">
                  <table className="ud-table ud-table--entries">
                    <thead>
                      <tr>
                        <th>Date</th><th>Code</th><th>Item</th><th>Operation</th>
                        <th>Quantities</th><th>Tank / Location</th><th>Officer 1</th><th>Page</th><th>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map(e => (
                        <tr key={e.id} className={e.confidence_score < 0.75 ? 'row-low-confidence' : ''}>
                          <td>{e.entry_date}</td>
                          <td><span className="ud-code">{e.orb_code}</span></td>
                          <td title={(e.item_lines || []).map(l => `${l.item || '(blank)'} ${l.text}`).join('\n')}>
                            {(e.item_lines || []).some(l => l.item)
                              ? e.item_lines.filter(l => l.item).map(l => l.item).join(' · ')
                              : (e.item_number || '—')}
                          </td>
                          <td className="ud-op">{e.operation_description}</td>
                          <td className="ud-small">
                            {e.quantities?.map(q => `${q.qty_value} ${q.qty_unit} (${q.qty_type})`).join(', ') || '—'}
                          </td>
                          <td>{e.tank_location || '—'}</td>
                          <td className="ud-small">{e.officer_1_name ? `${e.officer_1_name} (${e.officer_1_rank || ''})` : '—'}</td>
                          <td className="ud-small ud-center">{e.page_number ?? '—'}</td>
                          <td>
                            <span className={`ud-conf ${e.confidence_score < 0.75 ? 'ud-conf--low' : ''}`}>
                              {e.confidence_score != null ? (e.confidence_score * 100).toFixed(0) + '%' : '—'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Tab: Alerts ── */}
            {activeTab === 'Alerts' && (
              <div className="ud-panel ud-section">
                <div className="ud-section__head">
                  <h3 className="ud-section__title"><AlertTriangle size={18} />Alerts <span className="ud-pill">{alerts.length}</span></h3>
                </div>
                {alerts.length === 0 ? (
                  <div className="ud-empty">
                    <span className="ud-empty__icon"><CheckCircle2 size={24} /></span>
                    No open alerts for this upload.
                  </div>
                ) : (
                  <div className="ud-alerts">
                    {alerts.map(a => {
                      const open = openAlertId === a.id;
                      return (
                        <div key={a.id} className="ud-alert-wrap">
                          <div
                            className={`ud-alert ${a.severity === 'critical' ? 'ud-alert--critical' : a.severity === 'major' ? 'ud-alert--major' : ''}${open ? ' ud-alert--open' : ''}`}
                            role="button" tabIndex={0} aria-expanded={open}
                            onClick={() => setOpenAlertId(open ? null : a.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenAlertId(open ? null : a.id); } }}
                          >
                            <div className="ud-alert__body">
                              <div className="ud-alert__head">
                                <Badge value={a.severity} />
                                <span className="ud-alert__type">{a.alert_type.replace(/_/g, ' ')}</span>
                                {a.page_number != null && (
                                  <span className="ud-alert__page">· Page {a.page_number}</span>
                                )}
                              </div>
                              <p className="ud-alert__msg">{a.message}</p>
                            </div>
                            <div className="ud-alert__actions">
                              <button className="ud-btn ud-btn--secondary ud-btn--sm" title="Open the pages and the conversation"
                                      onClick={(e) => { e.stopPropagation(); setModalAlert(a); }}>
                                <MessageSquare size={13} />
                                {a.thread_count > 0 ? ` ${a.thread_count}${a.unread_count > 0 ? ` · ${a.unread_count} new` : ''}` : ' Open'}
                              </button>
                              <button className="ud-btn ud-btn--secondary ud-btn--sm" onClick={(e) => { e.stopPropagation(); resolveAlert(a.id); }}>Resolve</button>
                            </div>
                          </div>
                          {open && <SourceEntryDetail alert={a} />}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {modalAlert && (
              <AlertModal
                alert={modalAlert}
                vesselName={upload?.vessel_name}
                isShore
                currentUserId={user?.id}
                onClose={() => { setModalAlert(null); load(true); }}
                onChanged={() => load(true)}
              />
            )}

            {/* ── Tab: Daily Log ── */}
            {activeTab === 'Daily Log' && (
              logLoading ? <LoadingSpinner /> : !dailyLog ? (
                <div className="ud-panel ud-section">
                  <div className="ud-empty">
                    <span className="ud-empty__icon"><Table2 size={24} /></span>
                    No daily log data available.
                  </div>
                </div>
              ) : (() => {
                const dailyRows = dailyLog.daily_rows || [];
                const tankReference = dailyLog.tank_reference || [];
                const monthlySummary = dailyLog.monthly_summary || {};
                return (
                <>
                  {/* Table 1: Daily rows */}
                  <div className="ud-panel ud-section">
                    <div className="ud-section__head">
                      <h3 className="ud-section__title"><Table2 size={18} />Daily Log</h3>
                    </div>
                    <div className="ud-table-wrap">
                      <table className="ud-table ud-table--log" style={{ minWidth: 1200 }}>
                        <thead>
                          <tr>
                            {COL_LABELS.map(c => (
                              <th key={c.key}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dailyRows.map((row) => (
                            <tr key={row.date}>
                              {COL_LABELS.map(c => (
                                <td key={c.key} className={c.key === 'date' || c.key === 'bunker_grade' ? 'ud-left' : ''}>
                                  {formatDailyLogCell(row[c.key])}
                                </td>
                              ))}
                            </tr>
                          ))}
                          {/* Total row */}
                          <tr className="ud-total-row">
                            {COL_LABELS.map(c => (
                              <td key={c.key} className={c.key === 'date' || c.key === 'bunker_grade' ? 'ud-left' : ''}>
                                {c.key === 'date' ? 'TOTAL' : c.key === 'bunker_grade' ? '—' : (monthlySummary[c.key] || '—')}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Table 2: Monthly summary */}
                  <div className="ud-panel ud-section">
                    <div className="ud-section__head">
                      <h3 className="ud-section__title"><Layers size={18} />Monthly / Custom Date Selection Summary</h3>
                    </div>
                    <div className="ud-table-wrap">
                      <table className="ud-table ud-table--summary" style={{ minWidth: 900 }}>
                        <thead>
                          <tr>
                            {SUMMARY_LABELS.map(c => (
                              <th key={c.key}>{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="ud-summary-row">
                            {SUMMARY_LABELS.map(c => (
                              <td key={c.key}>{monthlySummary[c.key] ?? '—'}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Tank Reference */}
                  <div className="ud-panel ud-section">
                    <div className="ud-section__head">
                      <h3 className="ud-section__title"><Anchor size={18} />Tank Reference — From Capacity Plan &amp; IOPP Certificate</h3>
                    </div>
                    <div className="ud-table-wrap">
                      <table className="ud-table ud-table--log ud-table--tanks">
                        <thead>
                          <tr>
                            <th>Tank Code</th>
                            <th>Tank Name</th>
                            <th>Group</th>
                            <th>Capacity (m³)</th>
                            <th>IOPP / NON-IOPP</th>
                            <th>Evaporation Allowed</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tankReference.map((t) => (
                            <tr key={t.tank_code}>
                              <td className="ud-left">{t.tank_code}</td>
                              <td className="ud-left">{t.tank_name}</td>
                              <td className="ud-left">{t.tank_group || '—'}</td>
                              <td>{t.capacity_m3}</td>
                              <td>
                                <span className={`ud-tag ${t.is_iopp ? 'ud-tag--iopp' : 'ud-tag--non'}`}>
                                  {t.is_iopp ? 'IOPP' : 'NON-IOPP'}
                                </span>
                              </td>
                              <td>{t.is_evaporation_allowed ? '✓ Yes' : '—'}</td>
                            </tr>
                          ))}
                          <tr className="ud-total-row">
                            <td className="ud-left" colSpan={3}>SUBTOTAL</td>
                            <td>
                              {tankReference.reduce((s, t) => s + t.capacity_m3, 0).toFixed(2)}
                            </td>
                            <td colSpan={2}></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
                );
              })()
            )}

          </div>
        </div>
      </div>

      {preview && (
        <Modal title={upload?.original_filename || 'PDF Preview'} onClose={closePreview} xwide>
          {preview.loading ? (
            <LoadingSpinner />
          ) : (
            <iframe
              src={preview.url}
              title="PDF Preview"
              style={{ width: '100%', height: '100%', minHeight: '75vh', border: 'none', display: 'block' }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
