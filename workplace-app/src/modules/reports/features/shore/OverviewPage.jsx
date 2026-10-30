// src/modules/reports/features/shore/OverviewPage.jsx
// All-vessel Overview matrix: report name (rows) x vessel (columns).
import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reportsApi } from '../../api/reportsApi';
import { useAuth } from '@/context/AuthContext';
import ReportsNavbar from '../../components/ReportsNavbar';
import AttachmentsPanel from '../../components/AttachmentsPanel';
import ThreadPanel from '../../components/ThreadPanel';
import BulkDownloadModal from '../../components/BulkDownloadModal';
import EventsGrid from './EventsGrid';
import {
  ChevronDown, X, Paperclip, FileWarning, CalendarDays, Layers, Search,
  BarChart3, MessageSquare, Download, AlertCircle, Clock,
  ChevronLeft, ChevronRight, RotateCcw,
} from 'lucide-react';
import '../../styles/Reports.css';
import '../../styles/OverviewPage.css';
import { compareReportNames, normalizeReportName } from '../../reportOrder';
import { fmtDateShort, fmtDate } from '@/utils/dateUtils';

const FREQUENCIES = [
  { id: 'EVENTS',    label: 'Events' },
  { id: 'DAILY',     label: 'Daily' },
  { id: 'WEEKLY',    label: 'Weekly' },
  { id: 'MONTHLY',  label: 'Monthly' },
  { id: 'QUARTERLY',label: 'Quarterly' },
  { id: 'HALF_YEARLY', label: 'Half-Yearly' },
  { id: 'YEARLY', label: 'Yearly' },
];

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Base/floor widths — must match the CSS defaults (--ovw-col-report-w,
// --ovw-cell-week-w, --ovw-cell-std-w) in OverviewPage.css.
const REPORT_COL_W = 260;
const BASE_WEEK_COL_W = 88;
const BASE_STD_COL_W = 150;
// Floor for Monthly / Quarterly / Half-Yearly / Yearly vessel columns (same as the design width; they only grow, never shrink).
const MIN_STD_COL_W = BASE_STD_COL_W;
const STD_COLS_PER_VIEW = 6;

const QUARTERS = [
  { id: 0, label: 'Q1', sub: 'Jan – Mar' },
  { id: 1, label: 'Q2', sub: 'Apr – Jun' },
  { id: 2, label: 'Q3', sub: 'Jul – Sep' },
  { id: 3, label: 'Q4', sub: 'Oct – Dec' },
];

const HALVES = [
  { id: 0, label: 'H1', sub: 'Jan – Jun' },
  { id: 1, label: 'H2', sub: 'Jul – Dec' },
];

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function normalizeFreq(f) {
  if (!f) return 'OTHER';
  const u = f.toUpperCase().replace(/[\s-]/g, '_');
  if (u.includes('DAIL') || u === '1_DAY') return 'DAILY';
  if (u.includes('WEEK')) return 'WEEKLY';
  if (u.includes('MONTH') || u === '1_MONTH') return 'MONTHLY';
  if (u.includes('QUARTER') || u === '3_MONTH') return 'QUARTERLY';
  if (u.includes('HALF') || u === '6_MONTH') return 'HALF_YEARLY';
  if (u.includes('YEAR') || u === '12_MONTH') return 'YEARLY';
  return 'OTHER';
}

function reportDate(r) {
  // report_date is read out of the report FILE itself (its "Report Month" /
  // "Date" field, or its filename) -- see app/utils/report_date.py on the
  // backend. It reflects the period the report actually covers, unlike
  // every SmartPAL-side date: a vessel routinely completes July's report on
  // 1-Aug, so job_end_date/due_date for that job read August even though
  // the report is July's. Only falls back to the old job-date chain when
  // no date could be recovered from the file (e.g. an unrecognised format).
  const d = r.report_date || r.job_end_date || r.job_date || r.due_date || r.created_at;
  return d ? new Date(d) : null;
}


// Date shown on a cell / in the preview. Half-yearly and yearly reports show the day the job was completed (job end date).
function displayDate(r) {
  const f = normalizeFreq(r.frequency);
  if ((f === 'HALF_YEARLY' || f === 'YEARLY') && r.job_end_date) return new Date(r.job_end_date);
  return reportDate(r);
}

function hasValidAttachment(attachments) {
  return Array.isArray(attachments) && attachments.some(a => a.blob_path && !a.blob_path.startsWith('MISSING:'));
}

function normalizeName(name) {
  if (!name) return 'UNKNOWN';
  return normalizeReportName(name);
}

/* Monday on/before Jan 1 of `year` — start of ISO week 1. */
function isoWeekOneStart(year) {
  const jan1 = new Date(year, 0, 1);
  const day = jan1.getDay(); // 0 = Sun ... 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(year, 0, 1 + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/* All real calendar weeks of `year`: week 1 = the Mon–Sun spanning Jan 1
   (may start in the prior December), continuing until the year ends. */
function buildYearWeeks(year) {
  const weeks = [];
  const cursor = isoWeekOneStart(year);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);
  let n = 1;
  while (cursor <= yearEnd) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    weeks.push({
      key: `w${n}`,
      number: n,
      label: `W${n}`,
      sub: `${fmtDateShort(start)} – ${fmtDateShort(end)}`,
      start,
      end,
    });
    cursor.setDate(cursor.getDate() + 7);
    n++;
  }
  return weeks;
}

const pctTone = p => (p >= 90 ? 'good' : p >= 70 ? 'warn' : 'bad');

function toIsoDate(d) {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildBuckets(frequency, year, monthIdx, quarterIdx, dailyEndDate = null, isAtLatest = true, halfIdx = 0) {
  if (frequency === 'DAILY') {
    const refDate = dailyEndDate instanceof Date ? dailyEndDate : new Date();

    const buckets = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(refDate);
      d.setDate(d.getDate() - i);

      const start = new Date(d);
      start.setHours(0, 0, 0, 0);

      const end = new Date(d);
      end.setHours(23, 59, 59, 999);

      const key = `d_${d.getFullYear()}_${d.getMonth() + 1}_${d.getDate()}`;
      buckets.push({
        key,
        label: fmtDateShort(d),
        sub: fmtDate(d),
        start,
        end,
        isLatest: i === 0 && isAtLatest,
      });
    }
    return buckets;
  }
  if (frequency === 'WEEKLY') {
    const monthStart = new Date(year, monthIdx, 1);
    const monthEnd = new Date(year, monthIdx + 1, 0, 23, 59, 59);
    return buildYearWeeks(year).filter(w => w.start <= monthEnd && w.end >= monthStart);
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
  if (frequency === 'HALF_YEARLY') {
    const startMonth = halfIdx * 6;
    const endMonth = startMonth + 5;
    const lastDay = new Date(year, endMonth + 1, 0).getDate();
    return [{
      key: 'h1',
      label: `H${halfIdx + 1}`,
      start: new Date(year, startMonth, 1),
      end: new Date(year, endMonth, lastDay, 23, 59, 59),
    }];
  }
  if (frequency === 'YEARLY') {
    return [{
      key: 'y1',
      label: `${year}`,
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59),
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

function findDailyMatch(instances, bucket) {
  const matches = instances.filter(r => {
    const d = reportDate(r);
    if (!d) return false;
    return fmtDateShort(d) === bucket.label || (d >= bucket.start && d <= bucket.end);
  });
  if (matches.length === 0) return null;
  const withAtt = matches.filter(r => hasValidAttachment(r.attachments));
  const pool = withAtt.length > 0 ? withAtt : matches;
  pool.sort((a, b) => (reportDate(a)?.getTime() || 0) - (reportDate(b)?.getTime() || 0));
  return pool[pool.length - 1];
}

/* All instances landing inside one bucket, oldest first. A monthly/quarterly
   bucket can legitimately contain more than one completed job (e.g. an
   extra out-of-cycle inspection alongside the regular monthly one) -- the
   caller decides whether to show just the latest or every one of them. */
function findMatches(instances, start, end) {
  const inRange = instances.filter(r => {
    const d = reportDate(r);
    return d && d >= start && d <= end;
  });
  if (inRange.length === 0) return [];
  const withAttachment = inRange.filter(r => hasValidAttachment(r.attachments));
  const pool = withAttachment.length > 0 ? withAttachment : inRange;
  return pool.sort((a, b) => (reportDate(a) || 0) - (reportDate(b) || 0));
}

function findBestMatch(instances, start, end) {
  const matches = findMatches(instances, start, end);
  return matches.length ? matches[matches.length - 1] : null;
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

/* Resolves what a cell should show.
   Rules (client requirement):
   - 'has'       : attachment present
   - 'pending'   : the ONE most-recent past bucket that has no attachment,
                   and only after Tuesday of the FOLLOWING week.
   - 'blank'     : no report record, before tracking started, current week,
                   grace period before next Tuesday, or an older incomplete period.
   Only the single latest incomplete bucket is surfaced so the matrix
   stays clean and actionable. */
function cellStatus(instances, bucket, now, isLatestIncompleteBucket) {
  const matches = findMatches(instances, bucket.start, bucket.end);
  const match = matches.length ? matches[matches.length - 1] : null;
  if (match && hasValidAttachment(match.attachments)) {
    // Surface every completed job with an attachment that landed in this
    // bucket, not just the latest -- see findMatches() above.
    const withAttachment = matches.filter(m => hasValidAttachment(m.attachments));
    return { status: 'has', matches: withAttachment, match, date: reportDate(match) };
  }
  if (!match) {
    return { status: 'blank' };
  }
  const firstDate = earliestAttachmentDate(instances);
  if (!firstDate || bucket.start < firstDate) {
    return { status: 'blank' };
  }

  // For past buckets: only the MOST RECENT incomplete one shows as pending.
  if (!isLatestIncompleteBucket) {
    return { status: 'blank' };
  }

  // Only show Pending after Tuesday of the FOLLOWING week.
  const followingTuesday = new Date(bucket.end);
  followingTuesday.setDate(followingTuesday.getDate() + 2); // Sun → Tue
  followingTuesday.setHours(0, 0, 0, 0);

  if (now >= followingTuesday) {
    return { status: 'pending', match, date: reportDate(match) };
  }

  // Before following Tuesday (including current week) — stay blank
  return { status: 'blank', match, date: reportDate(match) };
}

/* Returns the key of the latest bucket (by bucket.end) that has no
   valid attachment but does have a report record. Used so that only
   the single most-actionable incomplete bucket is shown per cell column. */
function latestIncompleteBucketKey(instances, buckets) {
  const firstDate = earliestAttachmentDate(instances);
  if (!firstDate) return null;
  // Walk buckets newest-first, find first one without a valid attachment
  for (let i = buckets.length - 1; i >= 0; i--) {
    const b = buckets[i];
    if (b.start < firstDate) break; // before tracking started
    const match = findBestMatch(instances, b.start, b.end);
    if (match && !hasValidAttachment(match.attachments)) {
      return b.key;
    }
  }
  return null;
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

/* Dark year pill; click opens a dropdown of the years that have data. */
function YearChip({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ovw-year-chip ovw-year-chip--btn" onClick={() => setOpen(o => !o)}>
      {value}
      <ChevronDown size={12} className={`ovw-compact-chevron ${open ? 'open' : ''}`} />
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
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function AttachmentPreviewModal({ report, onClose }) {
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  if (!report) return null;
  const date = displayDate(report);
  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div className="rt-modal-container ovw-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="rt-modal-header">
          <div className="rt-modal-title-group">
            <h2 className="rt-modal-title">{report.report_name}</h2>
            <span className="rt-modal-subtitle">{report.vessel_name} · {fmtDate(date)}</span>
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

function AttachmentIcon({ report, bucket, onOpen, viewerRole, showDate = true, seenIds }) {
  const isSeen = !!seenIds && seenIds.has(String(report.id));
  return (
    <button
      type="button"
      className={`ovw-chip ovw-chip-has ${isSeen ? 'ovw-chip-seen' : 'ovw-chip-new'}${!showDate ? ' ovw-chip-icon-only' : ''}`}
      title={`${bucket?.label || ''}: ${fmtDateShort(displayDate(report))} — ${isSeen ? 'Viewed' : 'New'} attachment`}
      onClick={() => onOpen(report)}
    >
      <span className="ovw-chip-has-icon">
        <Paperclip size={13} />
        {(viewerRole === 'VESSEL' ? report.unread_vessel : report.unread_shore) > 0 && (
          <span className="ovw-chip-msg-badge" title="New message">
            <MessageSquare size={8} />
          </span>
        )}
      </span>
      {showDate && <span>{fmtDateShort(displayDate(report))}</span>}
    </button>
  );
}

function AttachmentCell({ instances, bucket, now, onOpen, viewerRole, buckets, seenIds }) {
  const latestKey = latestIncompleteBucketKey(instances, buckets);
  const isCurrentBucket = bucket.start <= now && now <= bucket.end;
  const isLatestIncomplete = isCurrentBucket || bucket.key === latestKey;
  const { status, matches, date } = cellStatus(instances, bucket, now, isLatestIncomplete);

  if (status === 'blank') {
    return <div className="ovw-chip-empty" />;
  }
  if (status === 'pending') {
    return (
      <div className="ovw-chip ovw-chip-pending" title={`${bucket.label}: ${fmtDateShort(date)} — Pending submission`}>
        <span className="ovw-chip-pending-icon">
          <AlertCircle size={13} />
        </span>
        <span>Pending</span>
        <span className="ovw-chip-sub-date">{fmtDateShort(date)}</span>
      </div>
    );
  }
  // 'has' — one or more completed jobs with attachments landed in this
  // bucket (e.g. two monthly jobs completing in the same calendar month).
  // Show one icon+date per job in the same shell instead of collapsing to
  // just the latest.
  if (matches.length === 1) {
    return <AttachmentIcon report={matches[0]} bucket={bucket} onOpen={onOpen} viewerRole={viewerRole} seenIds={seenIds} />;
  }
  return (
    <div className="ovw-chip-multi">
      {matches.map(m => (
        <AttachmentIcon key={m.id || m.job_order_no} report={m} bucket={bucket} onOpen={onOpen} viewerRole={viewerRole} seenIds={seenIds} />
      ))}
    </div>
  );
}

/* ─── Main Page ─────────────────────────────────────────────────────────── */

export default function OverviewPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const now = new Date();
  const [frequency, setFrequency] = useState('WEEKLY');
  const [year, setYear] = useState(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState(now.getMonth());
  const [quarterIdx, setQuarterIdx] = useState(Math.floor(now.getMonth() / 3));
  const [halfIdx, setHalfIdx] = useState(Math.floor(now.getMonth() / 6));
  const [search, setSearch] = useState('');
  const [previewReport, setPreviewReport] = useState(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingVessel, setMissingVessel] = useState('ALL');
  const [mmExpanded, setMmExpanded] = useState({});
  const [dailyAnchorDate, setDailyAnchorDate] = useState(null);

  /* Per-user "viewed" memory, stored in the database so it follows the user
     across browsers and devices. Viewed attachments render dimmer. */
  const { data: viewedIds } = useQuery({
    queryKey: ['report-views'],
    queryFn: () => reportsApi.getViewedReportIds(),
    staleTime: 60_000,
    enabled: !!user,
  });
  const seenIds = useMemo(() => new Set((viewedIds || []).map(String)), [viewedIds]);
  const markSeen = useCallback((id) => {
    if (id == null || seenIds.has(String(id))) return;
    queryClient.setQueryData(['report-views'], (old) => [...(old || []), String(id)]);
    reportsApi.markReportViewed(id).catch(() => {
      queryClient.invalidateQueries({ queryKey: ['report-views'] });
    });
  }, [seenIds, queryClient]);

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

  const latestDailyDate = useMemo(() => {
    let latestTime = 0;
    for (const r of reportsForFreq) {
      const d = reportDate(r);
      if (d && !isNaN(d.getTime()) && d.getTime() > latestTime) {
        latestTime = d.getTime();
      }
    }
    return latestTime > 0 ? new Date(latestTime) : new Date();
  }, [reportsForFreq]);

  const activeDailyEnd = useMemo(() => {
    return dailyAnchorDate || latestDailyDate;
  }, [dailyAnchorDate, latestDailyDate]);

  const isAtLatestDaily = useMemo(() => {
    if (!dailyAnchorDate) return true;
    return (
      dailyAnchorDate.getFullYear() === latestDailyDate.getFullYear() &&
      dailyAnchorDate.getMonth() === latestDailyDate.getMonth() &&
      dailyAnchorDate.getDate() === latestDailyDate.getDate()
    );
  }, [dailyAnchorDate, latestDailyDate]);

  const handlePrevDaily = useCallback(() => {
    const base = dailyAnchorDate || latestDailyDate;
    const d = new Date(base);
    d.setDate(d.getDate() - 5);
    setDailyAnchorDate(d);
  }, [dailyAnchorDate, latestDailyDate]);

  const handleNextDaily = useCallback(() => {
    if (isAtLatestDaily) return;
    const base = dailyAnchorDate || latestDailyDate;
    const d = new Date(base);
    d.setDate(d.getDate() + 5);
    if (d >= latestDailyDate) {
      setDailyAnchorDate(null);
    } else {
      setDailyAnchorDate(d);
    }
  }, [dailyAnchorDate, latestDailyDate, isAtLatestDaily]);

  const handleResetDaily = useCallback(() => {
    setDailyAnchorDate(null);
  }, []);

  const handleDailyDatePicker = useCallback((e) => {
    const val = e.target.value;
    if (!val) return;
    const [y, m, d] = val.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    if (target >= latestDailyDate) {
      setDailyAnchorDate(null);
    } else {
      setDailyAnchorDate(target);
    }
  }, [latestDailyDate]);

  const assignedImos = useMemo(() => {
    // ADMIN and SUPERUSER see the full fleet; VESSEL and SHORE are restricted to their assigned vessels
    if (user?.role === 'ADMIN' || user?.role === 'SUPERUSER') return null;
    const list = Array.isArray(user?.assigned_vessels) ? user.assigned_vessels : [];
    if (list.length === 0) return new Set();
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
      .forEach(c => set.add(`${c.vessel_imo}|${normalizeName(c.report_name)}`));
    return set;
  }, [configs, frequency]);

  const buckets = useMemo(
    () => buildBuckets(frequency, year, monthIdx, quarterIdx, activeDailyEnd, isAtLatestDaily, halfIdx),
    [frequency, year, monthIdx, quarterIdx, activeDailyEnd, isAtLatestDaily, halfIdx]
  );

  const instanceIndex = useMemo(() => {
    const idx = {};
    reportsForFreq.forEach(r => {
      const name = normalizeName(r.report_name);
      if (!idx[name]) idx[name] = {};
      if (!idx[name][r.vessel_imo]) idx[name][r.vessel_imo] = [];
      // Pass normalized name down just in case
      idx[name][r.vessel_imo].push({ ...r, report_name: name });
    });
    return idx;
  }, [reportsForFreq]);

  const reportNames = useMemo(() => {
    const set = new Set(reportsForFreq.map(r => normalizeName(r.report_name)));
    let names = [...set].filter(name =>
      vessels.some(v => (instanceIndex[name]?.[v.imo] || []).some(r => hasValidAttachment(r.attachments)))
    );
    if (search) names = names.filter(n => n.toLowerCase().includes(search.toLowerCase()));
    return names.sort(compareReportNames);
  }, [reportsForFreq, search, vessels, instanceIndex]);

  /* Opening a report from the matrix should clear its unread badge, same as
     opening it from the inbox does — otherwise the badge never goes away.
     Clear it optimistically in the cache too, so the badge disappears the
     instant the report is opened rather than waiting on the round trip. */
  const handleOpenReport = useCallback((report) => {
    setPreviewReport(report);
    markSeen(report.id);
    const field = user?.role === 'VESSEL' ? 'unread_vessel' : 'unread_shore';
    if (!(report[field] > 0)) return;

    queryClient.setQueryData(['reports-list'], (old) =>
      Array.isArray(old) ? old.map(r => (r.id === report.id ? { ...r, [field]: 0 } : r)) : old
    );

    reportsApi.getReport(report.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['reports-list'] }))
      .catch(() => {});
  }, [user, queryClient, markSeen]);

  const handleMonthChange = useCallback((v) => setMonthIdx(v), []);
  const handleQuarterChange = useCallback((v) => setQuarterIdx(v), []);
  const handleHalfChange = useCallback((v) => setHalfIdx(v), []);

  const monthOptions = MONTH_NAMES.map((m, i) => ({ id: i, label: m }));
  const quarterOptions = QUARTERS.map(q => ({ id: q.id, label: q.label, sub: q.sub }));
  const halfOptions = HALVES.map(h => ({ id: h.id, label: h.label, sub: h.sub }));
  // Years that actually have reports (so a future year such as 2027 shows up once it has data), plus the current year.
  const yearOptions = useMemo(() => {
    const years = new Set([now.getFullYear()]);
    reports.forEach(r => { const d = reportDate(r); if (d && !isNaN(d)) years.add(d.getFullYear()); });
    return Array.from(years).sort((a, b) => b - a).map(y => ({ id: y, label: String(y) }));
  }, [reports]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Stat counts ── */
  const isDaily = frequency === 'DAILY';
  const isWeekly = frequency === 'WEEKLY';
  const hasSubCols = isWeekly || isDaily;
  const displayYear = (isDaily && buckets.length > 0 && buckets[buckets.length - 1]?.start)
    ? buckets[buckets.length - 1].start.getFullYear()
    : year;

  const totalWithAttachments = useMemo(() => {
    let count = 0;
    reportNames.forEach(name => {
      vessels.forEach(v => {
        const instances = instanceIndex[name]?.[v.imo] || [];
        if (isDaily) {
          buckets.forEach(b => {
            const match = findDailyMatch(instances, b);
            if (match && hasValidAttachment(match.attachments)) count++;
          });
        } else {
          buckets.forEach(b => {
            // Count every attachment-bearing job shown in the cell, not just
            // one per bucket -- matches the multi-icon display in AttachmentCell.
            count += findMatches(instances, b.start, b.end).filter(m => hasValidAttachment(m.attachments)).length;
          });
        }
      });
    });
    return count;
  }, [reportNames, vessels, instanceIndex, buckets, isDaily]);

  /* Completion for the CURRENT period of the selected tab across all vessels:
     Daily = today, Weekly = this week, Monthly = this month, Quarterly = this
     quarter. A report/vessel pair is expected once its first attachment exists;
     it is missing if the current period has no attachment yet. */
  const completion = useMemo(() => {
    const pad = n => String(n).padStart(2, '0');
    const keyOf = d => {
      if (frequency === 'DAILY') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (frequency === 'WEEKLY') {
        const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
        return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
      }
      if (frequency === 'MONTHLY') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      if (frequency === 'HALF_YEARLY') return `${d.getFullYear()}-H${Math.floor(d.getMonth() / 6)}`;
      if (frequency === 'YEARLY') return `${d.getFullYear()}`;
      return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3)}`;
    };
    const step = d => {
      const n = new Date(d);
      if (frequency === 'DAILY') n.setDate(n.getDate() + 1);
      else if (frequency === 'WEEKLY') n.setDate(n.getDate() + 7);
      else if (frequency === 'MONTHLY') { n.setDate(1); n.setMonth(n.getMonth() + 1); }
      else if (frequency === 'HALF_YEARLY') { n.setDate(1); n.setMonth(n.getMonth() + 6); }
      else if (frequency === 'YEARLY') { n.setDate(1); n.setMonth(0); n.setFullYear(n.getFullYear() + 1); }
      else { n.setDate(1); n.setMonth(n.getMonth() + 3); }
      return n;
    };
    const labelOf = d => {
      if (frequency === 'DAILY') return fmtDate(d);
      if (frequency === 'WEEKLY') {
        const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
        const e = new Date(m); e.setDate(e.getDate() + 6);
        return `${fmtDateShort(m)} – ${fmtDateShort(e)}`;
      }
      if (frequency === 'MONTHLY') return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      if (frequency === 'HALF_YEARLY') return `H${Math.floor(d.getMonth() / 6) + 1} ${d.getFullYear()}`;
      if (frequency === 'YEARLY') return `${d.getFullYear()}`;
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    };
    const today = new Date();
    const nowKey = keyOf(today);
    const stats = {};
    const life = {};
    vessels.forEach(v => { stats[v.imo] = { done: 0, expected: 0, items: [] }; life[v.imo] = { done: 0, expected: 0 }; });
    const overall = { done: 0, expected: 0 };

    reportNames.forEach(name => {
      vessels.forEach(v => {
        if (configuredPairs && !configuredPairs.has(`${v.imo}|${name}`)) return;
        const instances = instanceIndex[name]?.[v.imo] || [];
        const have = new Set();
        let first = null;
        instances.forEach(r => {
          if (!hasValidAttachment(r.attachments)) return;
          const d = reportDate(r);
          if (!d) return;
          have.add(keyOf(d));
          if (!first || d < first) first = d;
        });
        if (!first) return;
        const labels = [];
        // Lifetime (first submission -> today), used for the per-vessel circles.
        let cur = new Date(first), guard = 0;
        while (guard++ < 5000) {
          const k = keyOf(cur);
          if (k === nowKey) { if (have.has(k)) { life[v.imo].expected++; life[v.imo].done++; } break; }
          if (cur > today) break;
          life[v.imo].expected++;
          if (have.has(k)) life[v.imo].done++;
          cur = step(cur);
        }
        // Current period only (today / this week / this month / this quarter), used for the overall figure.
        stats[v.imo].expected++;
        if (have.has(nowKey)) stats[v.imo].done++;
        else labels.push(labelOf(today));
        if (labels.length) stats[v.imo].items.push({ report: name, labels });
      });
    });
    const withPct = o => ({ ...o, missing: o.expected - o.done, pct: o.expected > 0 ? Math.round((o.done / o.expected) * 100) : null });
    Object.keys(stats).forEach(k => { stats[k] = withPct(stats[k]); life[k] = withPct(life[k]); });
    Object.values(stats).forEach(st => { overall.done += st.done; overall.expected += st.expected; });
    Object.values(stats).forEach(st => st.items.sort((x, y) => y.labels.length - x.labels.length));
    const prefix = { DAILY: 'Today', WEEKLY: 'This week', MONTHLY: 'This month', QUARTERLY: 'This quarter', HALF_YEARLY: 'This half-year', YEARLY: 'This year' }[frequency];
    return { overall: withPct(overall), byVessel: stats, lifeByVessel: life, periodTitle: prefix, periodLabel: labelOf(today) };
  }, [frequency, reportNames, vessels, instanceIndex, configuredPairs]);

  /* Key of the bucket that contains today — used to underline current-week header */
  const currentWeekKey = useMemo(() => {
    if (!isWeekly) return null;
    const found = buckets.find(b => b.start <= now && now <= b.end);
    return found ? found.key : null;
  }, [buckets, isWeekly]); // eslint-disable-line

  // When the data columns' natural width leaves spare room in the scroll
  // container (few vessels/reports on a wide screen), spread that leftover
  // space evenly across the data columns only — the Report Name column
  // always stays fixed at REPORT_COL_W, so it never balloons into a phantom
  // gap. Columns never shrink below their normal design width either; once
  // there are enough vessels to fill the space naturally, this just falls
  // back to the CSS defaults and the table scrolls horizontally as usual.
  const scrollRef = useRef(null);
  const [dataColWidth, setDataColWidth] = useState(null);
  const [reportColWidth, setReportColWidth] = useState(REPORT_COL_W);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const totalDataCols = hasSubCols ? vessels.length * buckets.length : vessels.length;
    const baseWidth = isWeekly ? BASE_WEEK_COL_W : (isDaily ? 76 : BASE_STD_COL_W);

    const recompute = () => {
      if (totalDataCols === 0) { setDataColWidth(null); return; }
      // The report column width comes from CSS (it shrinks on narrower screens, see the media queries in OverviewPage.css).
      const reportW = parseInt(getComputedStyle(el).getPropertyValue('--ovw-col-report-w'), 10) || REPORT_COL_W;
      setReportColWidth(reportW);
      const available = el.clientWidth - reportW;
      const shrinkable = !hasSubCols;
      // Standard tabs: size the vessel columns so STD_COLS_PER_VIEW fit on screen (fewer vessels just fill the width); the rest scroll sideways.
      const ideal = Math.floor(available / (shrinkable ? Math.min(STD_COLS_PER_VIEW, totalDataCols) : totalDataCols));
      if (shrinkable) setDataColWidth(Math.max(MIN_STD_COL_W, ideal));
      else setDataColWidth(ideal > baseWidth ? ideal : null);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vessels.length, buckets.length, hasSubCols, isWeekly, isDaily, isLoading, reportNames.length]);

  const totalDataColsForWidth = hasSubCols ? vessels.length * buckets.length : vessels.length;
  const baseWidthForWidth = isWeekly ? BASE_WEEK_COL_W : (isDaily ? 76 : BASE_STD_COL_W);
  const actualDataColWidth = dataColWidth || baseWidthForWidth;
  const totalTableWidth = reportColWidth + (totalDataColsForWidth * actualDataColWidth);
  const isCompactCols = !hasSubCols && actualDataColWidth < BASE_STD_COL_W;

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
          {frequency !== 'EVENTS' && completion.overall.pct !== null && (() => {
            const o = completion.overall;
            const R = 15, C = 2 * Math.PI * R;
            const label = FREQUENCIES.find(f => f.id === frequency)?.label;
            return (
              <button
                type="button"
                className={`ovw-overall-btn ovw-tone-${pctTone(o.pct)}`}
                onClick={() => { setMissingVessel('ALL'); setMissingOpen(true); }}
                title="Click to see missing dates"
              >
                <span className="ovw-ob-donut">
                  <svg width="38" height="38" viewBox="0 0 40 40">
                    <circle cx="20" cy="20" r={R} className="ovw-ob-track" />
                    <circle cx="20" cy="20" r={R} className="ovw-ob-fill"
                      strokeDasharray={C} strokeDashoffset={C * (1 - o.pct / 100)} />
                  </svg>
                  <span className="ovw-ob-pct">{o.pct}%</span>
                </span>
                <span className="ovw-ob-text">
                  <span className="ovw-ob-title">Overall {label} Completed</span>
                  <span className="ovw-ob-sub">{o.missing} missing · View details</span>
                </span>
                <ChevronRight size={14} className="ovw-ob-chev" />
              </button>
            );
          })()}
          {/* ── Download Button ── */}
          <button className="bdl-trigger-btn" onClick={() => setDownloadModalOpen(true)}>
            <Download size={14} />
            Download Reports
          </button>
        </div>
      </div>

      {/* ── Frequency Pill Tabs (second row) ── */}
      <div className="ovw-tabs-row">
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

      {frequency === 'EVENTS' ? (
        <EventsGrid vessels={vessels} search={search} setSearch={setSearch} />
      ) : (<>
      {/* ── Control Bar ── */}
      <div className="ovw-control-bar">
        <div className="ovw-control-left">
          {frequency !== 'DAILY' && yearOptions.length > 1 ? (
            <YearChip value={year} options={yearOptions} onChange={setYear} />
          ) : (
            <span className="ovw-year-chip">{displayYear}</span>
          )}

          {frequency === 'QUARTERLY' ? (
            <CompactSelect
              icon={<CalendarDays size={13} />}
              value={quarterIdx}
              options={quarterOptions}
              onChange={handleQuarterChange}
            />
          ) : frequency === 'HALF_YEARLY' ? (
            <CompactSelect
              icon={<CalendarDays size={13} />}
              value={halfIdx}
              options={halfOptions}
              onChange={handleHalfChange}
            />
          ) : frequency === 'YEARLY' ? null
          : frequency === 'DAILY' ? (
            <div className="ovw-daily-nav-group">
              <button
                type="button"
                className="ovw-nav-arrow-btn"
                onClick={handlePrevDaily}
                title="Previous 5 Days"
              >
                <ChevronLeft size={14} />
              </button>

              <label className="ovw-compact-select ovw-daily-picker-label" title="Click to pick an end date">
                <span className="ovw-compact-select-icon"><CalendarDays size={13} /></span>
                <span className="ovw-compact-select-value">
                  {buckets.length > 0 ? `${buckets[0].label} – ${buckets[buckets.length - 1].label}` : 'Daily'}
                </span>
                <input
                  type="date"
                  className="ovw-hidden-date-input"
                  value={toIsoDate(activeDailyEnd)}
                  max={toIsoDate(latestDailyDate)}
                  onChange={handleDailyDatePicker}
                />
              </label>

              <button
                type="button"
                className="ovw-nav-arrow-btn"
                onClick={handleNextDaily}
                disabled={isAtLatestDaily}
                title={isAtLatestDaily ? "Already at latest" : "Next 5 Days"}
              >
                <ChevronRight size={14} />
              </button>

              {!isAtLatestDaily && (
                <button
                  type="button"
                  className="ovw-reset-latest-btn"
                  onClick={handleResetDaily}
                  title="Jump back to latest daily reports"
                >
                  <RotateCcw size={11} style={{ marginRight: 4 }} />
                  Latest
                </button>
              )}
            </div>
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
          <div
            className="ovw-table-scroll"
            ref={scrollRef}
            style={dataColWidth ? {
              '--ovw-cell-week-w': `${dataColWidth}px`,
              '--ovw-cell-std-w': `${dataColWidth}px`,
            } : (hasSubCols ? {
              '--ovw-cell-week-w': `${actualDataColWidth}px`,
            } : undefined)}
          >
            <table className={`ovw-table${isCompactCols ? ' ovw-table--compact' : ''}`} style={{ width: `${totalTableWidth}px` }}>
              <colgroup>
                <col style={{ width: 'var(--ovw-col-report-w)', minWidth: 'var(--ovw-col-report-w)', maxWidth: 'var(--ovw-col-report-w)' }} />
                {vessels.flatMap(v => 
                  hasSubCols 
                    ? buckets.map(b => (
                        <col key={`${v.imo}-${b.key}`} style={{ width: 'var(--ovw-cell-week-w)', minWidth: 'var(--ovw-cell-week-w)', maxWidth: 'var(--ovw-cell-week-w)' }} />
                      ))
                    : [<col key={v.imo} style={{ width: 'var(--ovw-cell-std-w)', minWidth: 'var(--ovw-cell-std-w)', maxWidth: 'var(--ovw-cell-std-w)' }} />]
                )}
              </colgroup>
              <thead>
                {/* ── Row 1: Report Name + Vessel Names ── */}
                <tr className="ovw-thead-row1">
                  <th className="ovw-th-report ovw-sticky-col" rowSpan={hasSubCols ? 2 : 1}>
                    <div className="ovw-th-report-inner">
                      <Layers size={13} className="ovw-th-icon" />
                      Report Name
                    </div>
                  </th>
                  {vessels.map((v, vi) => (
                    <th
                      key={v.imo}
                      className={`ovw-th-vessel${vi % 2 ? ' grp-odd' : ''}`}
                      colSpan={hasSubCols ? buckets.length : 1}
                    >
                      <div className="ovw-th-vessel-inner ovw-th-vessel-inner--pct">
                        <div className="ovw-vessel-textcol">
                          <span className="ovw-vessel-name">{v.name}</span>
                          <span className="ovw-vessel-imo">IMO {v.imo}</span>
                        </div>
                        {completion.lifeByVessel[v.imo]?.pct != null && (() => {
                          const st = completion.lifeByVessel[v.imo];
                          const R = 13, C = 2 * Math.PI * R;
                          return (
                            <span
                              className={`ovw-vcircle ovw-tone-${pctTone(st.pct)}`}
                              title={`${st.done} submitted · ${st.missing} missing (of ${st.expected})`}
                            >
                              <svg width="34" height="34" viewBox="0 0 34 34">
                                <circle cx="17" cy="17" r={R} className="ovw-vc-track" />
                                <circle cx="17" cy="17" r={R} className="ovw-vc-fill"
                                  strokeDasharray={C} strokeDashoffset={C * (1 - st.pct / 100)} />
                              </svg>
                              <span className="ovw-vc-num">{st.pct}%</span>
                            </span>
                          );
                        })()}
                      </div>
                    </th>
                  ))}
                </tr>

                {/* ── Row 2 (Weekly & Daily): Sub-headers ── */}
                {hasSubCols && (
                  <tr className="ovw-thead-row2">
                    {vessels.map((v, vi) =>
                      buckets.map(b => {
                        const isCurrent = isWeekly ? b.key === currentWeekKey : b.isLatest;
                        return (
                          <th
                            key={`${v.imo}-${b.key}`}
                            className={`ovw-th-week${isCurrent ? ' ovw-th-week-current' : ''}${vi % 2 ? ' grp-odd' : ''}`}
                            title={isDaily ? b.sub : `Week ${b.number} · ${b.sub}`}
                          >
                            {b.label}
                            {isCurrent && <span className="ovw-current-week-dot" />}
                          </th>
                        );
                      })
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

                    {vessels.map((v, vi) => {
                      const grp = vi % 2 ? ' grp-odd' : '';
                      const isConfigured = !configuredPairs || configuredPairs.has(`${v.imo}|${name}`);

                      if (!isConfigured) {
                        return (
                          <td
                            key={v.imo}
                            className={`ovw-td-cell ovw-cell-na${grp}`}
                            colSpan={hasSubCols ? buckets.length : 1}
                          >
                            <span className="ovw-na-text">N/A</span>
                          </td>
                        );
                      }

                      const instances = instanceIndex[name]?.[v.imo] || [];

                      if (isDaily) {
                        return buckets.map(b => {
                          const match = findDailyMatch(instances, b);
                          return (
                            <td key={`${v.imo}-${b.key}`} className={`ovw-td-cell ovw-td-week${grp}`}>
                              {match && hasValidAttachment(match.attachments) ? (
                                <AttachmentIcon
                                  report={match}
                                  bucket={{ label: b.label }}
                                  onOpen={handleOpenReport}
                                  viewerRole={user?.role}
                                  showDate={false}
                                  seenIds={seenIds}
                                />
                              ) : (
                                <div className="ovw-chip-empty" />
                              )}
                            </td>
                          );
                        });
                      }

                      if (isWeekly) {
                        return buckets.map(b => (
                          <td key={`${v.imo}-${b.key}`} className={`ovw-td-cell ovw-td-week${grp}`}>
                            <AttachmentCell instances={instances} bucket={b} now={now} onOpen={handleOpenReport} viewerRole={user?.role} buckets={buckets} seenIds={seenIds} />
                          </td>
                        ));
                      }

                      /* Monthly / Quarterly: single merged cell per vessel */
                      return (
                        <td key={v.imo} className={`ovw-td-cell${grp}`}>
                          <div className="ovw-icon-group">
                            {buckets.map(b => (
                              <AttachmentCell key={b.key} instances={instances} bucket={b} now={now} onOpen={handleOpenReport} viewerRole={user?.role} buckets={buckets} seenIds={seenIds} />
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
      </>)}

      </div>

      {missingOpen && (() => {
        const o = completion.overall;
        const label = FREQUENCIES.find(f => f.id === frequency)?.label;
        const LIMIT = 12;
        const list = vessels.filter(v => (missingVessel === 'ALL' || String(v.imo) === String(missingVessel)) && completion.byVessel[v.imo]?.items.length);
        return (
          <div className="ovw-mm-overlay" onClick={() => setMissingOpen(false)}>
            <div className="ovw-mm" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
              <div className="ovw-mm-head">
                <div className="ovw-mm-head-top">
                  <div className="ovw-mm-head-icon"><FileWarning size={20} /></div>
                  <div className="ovw-mm-head-text">
                    <div className="ovw-mm-eyebrow">{label} completion</div>
                    <h3 className="ovw-mm-title">Missing Submissions</h3>
                  </div>
                  <button type="button" className="ovw-mm-close" onClick={() => setMissingOpen(false)} aria-label="Close"><X size={16} /></button>
                </div>
                <div className="ovw-mm-stats">
                  <div className="ovw-mm-stat"><b>{o.pct}%</b><span>Completed</span></div>
                  <div className="ovw-mm-stat"><b>{o.done}</b><span>Submitted</span></div>
                  <div className="ovw-mm-stat miss"><b>{o.missing}</b><span>Missing</span></div>
                  <div className="ovw-mm-stat"><b>{completion.periodLabel}</b><span>{completion.periodTitle}</span></div>
                </div>
                <div className="ovw-mm-progress"><span style={{ width: `${o.pct}%` }} /></div>
              </div>

              <div className="ovw-mm-chips">
                <button type="button" className={`ovw-mm-chip${missingVessel === 'ALL' ? ' active' : ''}`} onClick={() => setMissingVessel('ALL')}>
                  All vessels <span>{o.missing}</span>
                </button>
                {vessels.map(v => (
                  <button
                    key={v.imo} type="button"
                    className={`ovw-mm-chip${String(missingVessel) === String(v.imo) ? ' active' : ''}`}
                    onClick={() => setMissingVessel(v.imo)}
                  >
                    {v.name} <span>{completion.byVessel[v.imo]?.missing ?? 0}</span>
                  </button>
                ))}
              </div>

              <div className="ovw-mm-body">
                {list.length === 0 ? (
                  <div className="ovw-mm-empty">
                    <div className="ovw-mm-empty-ico">✓</div>
                    All caught up — nothing missing.
                  </div>
                ) : list.map(v => {
                  const st = completion.byVessel[v.imo];
                  return (
                    <section key={v.imo} className="ovw-mm-vessel">
                      <div className="ovw-mm-vessel-head">
                        <div className="ovw-mm-vessel-id">
                          <span className="ovw-mm-vessel-name">{v.name}</span>
                          <span className="ovw-mm-vessel-imo">IMO {v.imo}</span>
                        </div>
                        <div className={`ovw-mm-vessel-pct ovw-tone-${pctTone(st.pct)}`}>
                          <div className="ovw-mm-vbar"><span style={{ width: `${st.pct}%` }} /></div>
                          <b>{st.pct}%</b>
                          <em>{st.missing} missing</em>
                        </div>
                      </div>
                      {st.items.map(it => {
                        const ek = `${v.imo}|${it.report}`;
                        const open = !!mmExpanded[ek];
                        const newest = [...it.labels].reverse();
                        const shown = open ? newest : newest.slice(0, LIMIT);
                        return (
                          <div key={it.report} className="ovw-mm-report">
                            <div className="ovw-mm-report-name">
                              <span className="ovw-mm-report-dot" />
                              {it.report}
                              <em>{it.labels.length} missing</em>
                            </div>
                            <div className="ovw-mm-dates">
                              {shown.map((l, i) => <span key={i} className="ovw-mm-date">{l}</span>)}
                              {newest.length > LIMIT && (
                                <button type="button" className="ovw-mm-more" onClick={() => setMmExpanded(x => ({ ...x, [ek]: !open }))}>
                                  {open ? 'Show less' : `+${newest.length - LIMIT} more`}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

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
