// src/modules/reports/features/shore/OverviewPage.jsx
// All-vessel Overview matrix: report name (rows) x vessel (columns).
import React, { useMemo, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reportsApi';
import { useAuth } from '@/context/AuthContext';
import ReportsNavbar from '../../components/ReportsNavbar';
import AttachmentsPanel from '../../components/AttachmentsPanel';
import ThreadPanel from '../../components/ThreadPanel';
import BulkDownloadModal from '../../components/BulkDownloadModal';
import {
  ChevronDown, X, Paperclip, FileWarning, CalendarDays, Layers, Search,
  BarChart3, MessageSquare, Download, AlertCircle, Clock,
} from 'lucide-react';
import '../../styles/Reports.css';
import '../../styles/OverviewPage.css';

const FREQUENCIES = [
  { id: 'WEEKLY',    label: 'Weekly' },
  { id: 'MONTHLY',  label: 'Monthly' },
  { id: 'QUARTERLY',label: 'Quarterly' },
];

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const QUARTERS = [
  { id: 0, label: 'Q1', sub: 'Jan – Mar' },
  { id: 1, label: 'Q2', sub: 'Apr – Jun' },
  { id: 2, label: 'Q3', sub: 'Jul – Sep' },
  { id: 3, label: 'Q4', sub: 'Oct – Dec' },
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function normalizeFreq(f) {
  if (!f) return 'OTHER';
  const u = f.toUpperCase().replace(/[\s-]/g, '_');
  if (u.includes('WEEK')) return 'WEEKLY';
  if (u.includes('MONTH') || u === '1_MONTH') return 'MONTHLY';
  if (u.includes('QUARTER') || u === '3_MONTH') return 'QUARTERLY';
  if (u.includes('HALF') || u === '6_MONTH') return 'HALF_YEARLY';
  if (u.includes('YEAR') || u === '12_MONTH') return 'YEARLY';
  return 'OTHER';
}

function reportDate(r) {
  const d = r.due_date || r.job_date || r.created_at;
  return d ? new Date(d) : null;
}

function fmtShort(date) {
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtFull(date) {
  if (!date) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function hasValidAttachment(attachments) {
  return Array.isArray(attachments) && attachments.some(a => a.blob_path && !a.blob_path.startsWith('MISSING:'));
}

function buildBuckets(frequency, year, monthIdx, quarterIdx) {
  if (frequency === 'WEEKLY') {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    const bounds = [1, 8, 15, 22, lastDay + 1];
    return [0, 1, 2, 3].map(i => ({
      key: `w${i + 1}`,
      label: `W${i + 1}`,
      start: new Date(year, monthIdx, bounds[i]),
      end: new Date(year, monthIdx, Math.min(bounds[i + 1] - 1, lastDay), 23, 59, 59),
    }));
  }
  if (frequency === 'MONTHLY') {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    return [{
      key: 'm1',
      label: MONTH_NAMES[monthIdx],
      start: new Date(year, monthIdx, 1),
      end: new Date(year, monthIdx, lastDay, 23, 59, 59),
    }];
  }
  const startMonth = quarterIdx * 3;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth + 1, 0).getDate();
  return [{
    key: 'q1',
    label: `Q${quarterIdx + 1}`,
    start: new Date(year, startMonth, 1),
    end: new Date(year, endMonth, lastDay, 23, 59, 59),
  }];
}

function findBestMatch(instances, start, end) {
  const inRange = instances.filter(r => {
    const d = reportDate(r);
    return d && d >= start && d <= end;
  });
  if (inRange.length === 0) return null;
  const withAttachment = inRange.filter(r => hasValidAttachment(r.attachments));
  const pool = withAttachment.length > 0 ? withAttachment : inRange;
  return pool.sort((a, b) => (reportDate(b) || 0) - (reportDate(a) || 0))[0];
}

/* Earliest date among instances that actually have a valid attachment —
   marks the point tracking "starts" for a given report/vessel pair. */
function earliestAttachmentDate(instances) {
  let earliest = null;
  instances.forEach(r => {
    if (!hasValidAttachment(r.attachments)) return;
    const d = reportDate(r);
    if (d && (!earliest || d < earliest)) earliest = d;
  });
  return earliest;
}

/* Resolves what a cell should show: an existing attachment, a missing
   (overdue, no submission) state, a pending (not yet due) state, or blank.
   Missing/Pending only apply to a period that actually has a report record
   in the dashboard (a `match`) — periods with no report instance at all are
   left blank rather than inventing a status for them. Also gated to after
   the report/vessel's first-ever attachment — not tracked before that. */
function cellStatus(instances, bucket, now) {
  const match = findBestMatch(instances, bucket.start, bucket.end);
  if (match && hasValidAttachment(match.attachments)) {
    return { status: 'has', match, date: reportDate(match) };
  }
  if (!match) {
    return { status: 'blank' };
  }
  const firstDate = earliestAttachmentDate(instances);
  if (!firstDate || bucket.start < firstDate) {
    return { status: 'blank' };
  }
  return { status: bucket.end < now ? 'missing' : 'pending', match, date: reportDate(match) };
}

/* ─── Sub-components ────────────────────────────────────────────────────── */

function CompactSelect({ icon, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.id === value);
  return (
    <div className="ovw-compact-select" onClick={() => setOpen(o => !o)}>
      {icon && <span className="ovw-compact-select-icon">{icon}</span>}
      <span className="ovw-compact-select-value">
        {selected?.label}
        {selected?.sub && <span className="ovw-compact-select-sub"> · {selected.sub}</span>}
      </span>
      <ChevronDown size={13} className={`ovw-compact-chevron ${open ? 'open' : ''}`} />
      {open && (
        <>
          <div className="ovw-dropdown-overlay" onClick={e => { e.stopPropagation(); setOpen(false); }} />
          <div className="ovw-dropdown">
            {options.map(o => (
              <div
                key={o.id}
                className={`ovw-option ${o.id === value ? 'active' : ''}`}
                onClick={e => { e.stopPropagation(); onChange(o.id); setOpen(false); }}
              >
                <span>{o.label}</span>
                {o.sub && <span className="ovw-option-sub">{o.sub}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AttachmentPreviewModal({ report, onClose }) {
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  if (!report) return null;
  const date = reportDate(report);
  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-modal-container ovw-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="rt-modal-header">
          <div className="rt-modal-title-group">
            <h2 className="rt-modal-title">{report.report_name}</h2>
            <span className="rt-modal-subtitle">{report.vessel_name} · {fmtFull(date)}</span>
          </div>
          <div className="rt-modal-controls">
            <button className="rt-modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div className="rt-modal-body">
          <div className="rt-modal-pane rt-pane-pdf">
            <AttachmentsPanel
              reportId={report.id}
              reportName={report.report_name}
              attachments={report.attachments}
              isCollapsed={false}
              onToggle={() => {}}
            />
          </div>
          <div className={`rt-modal-pane rt-pane-chat ${isChatCollapsed ? 'collapsed' : ''}`}>
            <ThreadPanel
              reportId={report.id}
              reportName={report.report_name}
              reportMeta={report}
              isCollapsed={isChatCollapsed}
              onToggle={() => setIsChatCollapsed(c => !c)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentCell({ instances, bucket, now, onOpen }) {
  const { status, match, date } = cellStatus(instances, bucket, now);

  if (status === 'blank') {
    return <div className="ovw-chip-empty" />;
  }
  if (status === 'missing') {
    return (
      <div className="ovw-chip ovw-chip-missing" title={`${bucket.label}: ${fmtShort(date)} — Missing attachment`}>
        <span className="ovw-chip-missing-icon">
          <AlertCircle size={13} />
        </span>
        <span>Missing</span>
        <span className="ovw-chip-sub-date">{fmtShort(date)}</span>
      </div>
    );
  }
  if (status === 'pending') {
    return (
      <div className="ovw-chip ovw-chip-pending" title={`${bucket.label}: ${fmtShort(date)} — Not yet due`}>
        <span className="ovw-chip-pending-icon">
          <Clock size={13} />
        </span>
        <span>Pending</span>
        <span className="ovw-chip-sub-date">{fmtShort(date)}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="ovw-chip ovw-chip-has"
      title={`${bucket.label}: ${fmtShort(date)} — View attachment`}
      onClick={() => onOpen(match)}
    >
      <span className="ovw-chip-has-icon">
        <Paperclip size={13} />
        {match.unread_shore > 0 && (
          <span className="ovw-chip-msg-badge" title="New message">
            <MessageSquare size={8} />
          </span>
        )}
      </span>
      <span>{fmtShort(date)}</span>
    </button>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */

export default function OverviewPage() {
  const { user } = useAuth();
  const now = new Date();
  const [frequency, setFrequency] = useState('WEEKLY');
  const [year] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [quarterIdx, setQuarterIdx] = useState(Math.floor(now.getMonth() / 3));
  const [search, setSearch] = useState('');
  const [previewReport, setPreviewReport] = useState(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);

  const { data: coreVessels = [] } = useQuery({
    queryKey: ['core-vessels'],
    queryFn: () => reportsApi.getVessels(),
  });

  const { data: rawReports, isLoading } = useQuery({
    queryKey: ['reports-list'],
    queryFn: () => reportsApi.listReports(),
    refetchInterval: 30000,
  });
  const reports = useMemo(() => (Array.isArray(rawReports) ? rawReports : []), [rawReports]);

  const { data: rawConfigs } = useQuery({
    queryKey: ['report-configs'],
    queryFn: () => reportsApi.listConfigs(),
  });
  const configs = useMemo(() => (Array.isArray(rawConfigs) ? rawConfigs : []), [rawConfigs]);

  const reportsForFreq = useMemo(
    () => reports.filter(r => normalizeFreq(r.frequency) === frequency),
    [reports, frequency]
  );

  const assignedImos = useMemo(() => {
    if (user?.role !== 'VESSEL') return null;
    const list = Array.isArray(user?.assigned_vessels) ? user.assigned_vessels : [];
    return new Set(list.map(v => (typeof v === 'string' ? v : v?.imo)).filter(Boolean));
  }, [user]);

  const vessels = useMemo(() => {
    let list;
    if (coreVessels.length > 0) {
      list = [...coreVessels];
    } else {
      const map = {};
      reports.forEach(r => { if (!map[r.vessel_imo]) map[r.vessel_imo] = { imo: r.vessel_imo, name: r.vessel_name }; });
      list = Object.values(map);
    }
    if (assignedImos) list = list.filter(v => assignedImos.has(v.imo));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [coreVessels, reports, assignedImos]);

  const configuredPairs = useMemo(() => {
    if (configs.length === 0) return null;
    const set = new Set();
    configs
      .filter(c => normalizeFreq(c.frequency) === frequency)
      .forEach(c => set.add(`${c.vessel_imo}|${c.report_name}`));
    return set;
  }, [configs, frequency]);

  const buckets = useMemo(
    () => buildBuckets(frequency, year, monthIdx, quarterIdx),
    [frequency, year, monthIdx, quarterIdx]
  );

  const instanceIndex = useMemo(() => {
    const idx = {};
    reportsForFreq.forEach(r => {
      const name = r.report_name || 'Unknown';
      if (!idx[name]) idx[name] = {};
      if (!idx[name][r.vessel_imo]) idx[name][r.vessel_imo] = [];
      idx[name][r.vessel_imo].push(r);
    });
    return idx;
  }, [reportsForFreq]);

  const reportNames = useMemo(() => {
    const set = new Set(reportsForFreq.map(r => r.report_name || 'Unknown'));
    let names = [...set].filter(name =>
      vessels.some(v => (instanceIndex[name]?.[v.imo] || []).some(r => hasValidAttachment(r.attachments)))
    );
    if (search) names = names.filter(n => n.toLowerCase().includes(search.toLowerCase()));
    return names.sort((a, b) => a.localeCompare(b));
  }, [reportsForFreq, search, vessels, instanceIndex]);

  const handleMonthChange = useCallback((v) => setMonthIdx(v), []);
  const handleQuarterChange = useCallback((v) => setQuarterIdx(v), []);

  const monthOptions = MONTH_NAMES.map((m, i) => ({ id: i, label: m }));
  const quarterOptions = QUARTERS.map(q => ({ id: q.id, label: q.label, sub: q.sub }));

  /* ── Stat counts ── */
  const totalWithAttachments = useMemo(() => {
    let count = 0;
    reportNames.forEach(name => {
      vessels.forEach(v => {
        const instances = instanceIndex[name]?.[v.imo] || [];
        buckets.forEach(b => {
          const match = findBestMatch(instances, b.start, b.end);
          if (match && hasValidAttachment(match.attachments)) count++;
        });
      });
    });
    return count;
  }, [reportNames, vessels, instanceIndex, buckets]);

  const isWeekly = frequency === 'WEEKLY';

  return (
    <div className="rt-root ovw-root">
      <ReportsNavbar />

      <div className="ovw-scroll-region">

      {/* ── Page Header ── */}
      <div className="ovw-page-header">
        <div className="ovw-header-left">
          <div className="ovw-header-icon-badge">
            <BarChart3 size={22} />
          </div>
          <div className="ovw-header-text">
            <h1 className="ovw-page-title">{assignedImos ? 'Vessel Report Overview' : 'Fleet Report Overview'}</h1>
            <p className="ovw-page-subtitle">
              {assignedImos
                ? 'Track submission status for your vessel and report types'
                : 'Track submission status across all vessels and report types'}
            </p>
          </div>
        </div>

        <div className="ovw-header-right-actions">
          {/* ── Download Button ── */}
          <button className="bdl-trigger-btn" onClick={() => setDownloadModalOpen(true)}>
            <Download size={14} />
            Download Reports
          </button>

          {/* ── Frequency Pill Tabs ── */}
          <div className="ovw-freq-tabs">
            {FREQUENCIES.map(f => (
              <button
                key={f.id}
                className={`ovw-freq-tab ${frequency === f.id ? 'active' : ''}`}
                onClick={() => setFrequency(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Control Bar ── */}
      <div className="ovw-control-bar">
        <div className="ovw-control-left">
          <span className="ovw-year-chip">{year}</span>

          {frequency === 'QUARTERLY' ? (
            <CompactSelect
              icon={<CalendarDays size={13} />}
              value={quarterIdx}
              options={quarterOptions}
              onChange={handleQuarterChange}
            />
          ) : (
            <CompactSelect
              icon={<CalendarDays size={13} />}
              value={monthIdx}
              options={monthOptions}
              onChange={handleMonthChange}
            />
          )}

          {/* Stat pills */}
          <div className="ovw-stat-strip">
            <span className="ovw-stat-pill">
              <span className="ovw-stat-dot reports" />
              <strong>{reportNames.length}</strong>&nbsp;reports
            </span>
            <span className="ovw-stat-pill">
              <span className="ovw-stat-dot vessels" />
              <strong>{vessels.length}</strong>&nbsp;vessels
            </span>
            <span className="ovw-stat-pill">
              <span className="ovw-stat-dot attachments" />
              <strong>{totalWithAttachments}</strong>&nbsp;with attachments
            </span>
          </div>
        </div>

        <div className="ovw-control-right">
          {/* Legend pills */}
          {configuredPairs && (
            <div className="ovw-legend-pill">
              <span className="ovw-legend-swatch na" />
              <span>Not applicable</span>
            </div>
          )}
          <div className="ovw-legend-pill">
            <span className="ovw-legend-swatch has" />
            <span>Attachment available</span>
          </div>
          <div className="ovw-legend-pill">
            <span className="ovw-legend-swatch pending" />
            <span>Pending</span>
          </div>
          <div className="ovw-legend-pill">
            <span className="ovw-legend-swatch missing" />
            <span>Missing</span>
          </div>

          {/* Search */}
          <div className="ovw-search-box">
            <Search size={13} />
            <input
              type="text"
              placeholder="Filter report name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="ovw-search-clear" onClick={() => setSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Table Card ── */}
      <div className="ovw-card">
        {isLoading ? (
          <div className="ovw-state-container">
            <div className="ovw-spinner-ring" />
            <p className="ovw-state-label">Loading report data…</p>
          </div>
        ) : reportNames.length === 0 ? (
          <div className="ovw-state-container">
            <div className="ovw-empty-icon-wrap">
              <FileWarning size={32} />
            </div>
            <p className="ovw-state-label">
              No {FREQUENCIES.find(f => f.id === frequency)?.label.toLowerCase()} reports found
            </p>
            <p className="ovw-state-sub">Try adjusting the period or clearing the search filter</p>
          </div>
        ) : (
          <div className="ovw-table-scroll">
            <table className="ovw-table">
              <thead>
                {/* ── Row 1: Report Name + Vessel Names ── */}
                <tr className="ovw-thead-row1">
                  <th className="ovw-th-report ovw-sticky-col" rowSpan={isWeekly ? 2 : 1}>
                    <div className="ovw-th-report-inner">
                      <Layers size={13} className="ovw-th-icon" />
                      Report Name
                    </div>
                  </th>
                  {vessels.map(v => (
                    <th
                      key={v.imo}
                      className="ovw-th-vessel"
                      colSpan={isWeekly ? buckets.length : 1}
                    >
                      <div className="ovw-th-vessel-inner">
                        <span className="ovw-vessel-name">{v.name}</span>
                        <span className="ovw-vessel-imo">IMO {v.imo}</span>
                      </div>
                    </th>
                  ))}
                </tr>

                {/* ── Row 2 (Weekly only): W1 W2 W3 W4 sub-headers ── */}
                {isWeekly && (
                  <tr className="ovw-thead-row2">
                    {vessels.map(v =>
                      buckets.map(b => (
                        <th key={`${v.imo}-${b.key}`} className="ovw-th-week">
                          {b.label}
                        </th>
                      ))
                    )}
                  </tr>
                )}
              </thead>

              <tbody>
                {reportNames.map((name, rowIdx) => (
                  <tr key={name} className={`ovw-row ${rowIdx % 2 === 0 ? 'even' : 'odd'}`}>
                    <td className="ovw-td-report ovw-sticky-col">
                      <span className="ovw-report-name">{name}</span>
                    </td>

                    {vessels.map(v => {
                      const isConfigured = !configuredPairs || configuredPairs.has(`${v.imo}|${name}`);

                      if (!isConfigured) {
                        return (
                          <td
                            key={v.imo}
                            className="ovw-td-cell ovw-cell-na"
                            colSpan={isWeekly ? buckets.length : 1}
                          >
                            <span className="ovw-na-text">N/A</span>
                          </td>
                        );
                      }

                      const instances = instanceIndex[name]?.[v.imo] || [];

                      if (isWeekly) {
                        return buckets.map(b => (
                          <td key={`${v.imo}-${b.key}`} className="ovw-td-cell ovw-td-week">
                            <AttachmentCell instances={instances} bucket={b} now={now} onOpen={setPreviewReport} />
                          </td>
                        ));
                      }

                      /* Monthly / Quarterly: single merged cell per vessel */
                      return (
                        <td key={v.imo} className="ovw-td-cell">
                          <div className="ovw-icon-group">
                            {buckets.map(b => (
                              <AttachmentCell key={b.key} instances={instances} bucket={b} now={now} onOpen={setPreviewReport} />
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </div>

      {previewReport && (
        <AttachmentPreviewModal report={previewReport} onClose={() => setPreviewReport(null)} />
      )}

      {downloadModalOpen && (
        <BulkDownloadModal
          vessels={vessels}
          reports={reports}
          onClose={() => setDownloadModalOpen(false)}
        />
      )}
    </div>
  );
}
