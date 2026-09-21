// src/modules/reports/components/ManualUploadModal.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X, Upload, Loader2, AlertCircle, CheckCircle2, ChevronDown, Check,
  Ship, FileText, CalendarDays, Repeat, CloudUpload, Search,
} from 'lucide-react';
import { reportsApi } from '../api/reportsApi';
import { compareReportNames } from '../reportOrder';
import '../styles/ManualUploadModal.css';

const ACCEPT = '.pdf,.xls,.xlsx,.xlsm,.csv,.doc,.docx';

const FREQUENCIES = [
  { id: 'ALL', label: 'All' },
  { id: 'DAILY', label: 'Daily' },
  { id: 'WEEKLY', label: 'Weekly' },
  { id: 'MONTHLY', label: 'Monthly' },
  { id: 'QUARTERLY', label: 'Quarterly' },
  { id: 'HALF_YEARLY', label: 'Half-Yearly' },
  { id: 'YEARLY', label: 'Yearly' },
];

function normalizeFreq(f) {
  if (!f) return 'OTHER';
  const u = f.toUpperCase().replace(/[\s-]/g, '_');
  if (u.includes('DAIL')) return 'DAILY';
  if (u.includes('WEEK')) return 'WEEKLY';
  if (u.includes('MONTH') || u === '1_MONTH') return 'MONTHLY';
  if (u.includes('QUARTER') || u === '3_MONTH') return 'QUARTERLY';
  if (u.includes('HALF') || u === '6_MONTH') return 'HALF_YEARLY';
  if (u.includes('YEAR') || u === '12_MONTH') return 'YEARLY';
  return 'OTHER';
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* Modern select: styled trigger + floating option list, closes on outside click */
function Select({ icon, value, options, placeholder, onChange, searchable = false, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(o => o.value === value);
  const shown = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <div className="mu-select" ref={ref}>
      <button
        type="button"
        className={`mu-select-trigger ${open ? 'open' : ''}`}
        disabled={disabled}
        onClick={() => { setOpen(o => !o); setQ(''); }}
      >
        {icon}
        <span className={`mu-select-value ${selected ? '' : 'placeholder'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={15} className={`mu-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="mu-select-menu">
          {searchable && (
            <div className="mu-select-search">
              <Search size={13} />
              <input autoFocus placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          )}
          <div className="mu-select-options">
            {shown.length === 0 && <div className="mu-select-empty">No matches</div>}
            {shown.map(o => (
              <button
                type="button"
                key={o.value}
                className={`mu-option ${o.value === value ? 'active' : ''}`}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                <span>{o.label}</span>
                {o.value === value && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ManualUploadModal({ vessels = [], configs = [], defaultVesselImo = '', onClose }) {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [vesselImo, setVesselImo] = useState(defaultVesselImo || vessels[0]?.imo || '');
  const [frequency, setFrequency] = useState('ALL');
  const [reportCode, setReportCode] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const fileInputRef = useRef(null);

  const vesselConfigs = useMemo(() => configs.filter(c => c.vessel_imo === vesselImo), [configs, vesselImo]);

  const availableFreqs = useMemo(() => {
    const present = new Set(vesselConfigs.map(c => normalizeFreq(c.frequency)));
    return FREQUENCIES.filter(f => f.id === 'ALL' || present.has(f.id));
  }, [vesselConfigs]);

  const reportOptions = useMemo(
    () => vesselConfigs
      .filter(c => frequency === 'ALL' || normalizeFreq(c.frequency) === frequency)
      .sort((a, b) => compareReportNames(a.report_name, b.report_name))
      .map(c => ({ value: c.report_code, label: c.report_name })),
    [vesselConfigs, frequency]
  );

  const vesselOptions = useMemo(() => vessels.map(v => ({ value: v.imo, label: v.name })), [vessels]);

  const changeVessel = (imo) => { setVesselImo(imo); setFrequency('ALL'); setReportCode(''); };
  const changeFrequency = (id) => { setFrequency(id); setReportCode(''); };

  const pickFile = (f) => { if (f) { setFile(f); setError(''); } };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); };

  const canSubmit = vesselImo && reportCode && file && !busy && !done;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await reportsApi.manualUpload({ vessel_imo: vesselImo, report_code: reportCode, report_date: reportDate, file });
      await queryClient.invalidateQueries({ queryKey: ['reports-list'] });
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e.response?.data?.detail || 'Upload failed, please retry.');
      setBusy(false);
    }
  };

  return (
    <div className="mu-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mu-card">
        <div className="mu-head">
          <div className="mu-head-icon"><CloudUpload size={18} /></div>
          <div className="mu-head-text">
            <div className="mu-title">Upload Report</div>
            <div className="mu-subtitle">Add a report manually — it appears on the Dashboard and Overview</div>
          </div>
          <button type="button" className="mu-close" onClick={() => !busy && onClose()} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mu-body">
          <div className="mu-field">
            <label>Vessel</label>
            <Select
              icon={<Ship size={15} className="mu-field-icon" />}
              value={vesselImo}
              options={vesselOptions}
              placeholder="Select vessel"
              onChange={changeVessel}
              searchable
            />
          </div>

          <div className="mu-field">
            <label><Repeat size={12} /> Frequency</label>
            <div className="mu-chips">
              {availableFreqs.map(f => (
                <button
                  type="button"
                  key={f.id}
                  className={`mu-chip ${frequency === f.id ? 'active' : ''}`}
                  onClick={() => changeFrequency(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mu-field">
            <label>Report type</label>
            <Select
              icon={<FileText size={15} className="mu-field-icon" />}
              value={reportCode}
              options={reportOptions}
              placeholder={reportOptions.length ? 'Select report type' : 'No reports for this selection'}
              onChange={setReportCode}
              searchable
              disabled={reportOptions.length === 0}
            />
          </div>

          <div className="mu-field">
            <label>Report date <span className="mu-hint">(optional)</span></label>
            <div className="mu-date-wrap">
              <CalendarDays size={15} className="mu-field-icon" />
              <input type="date" value={reportDate} max={today} onChange={e => setReportDate(e.target.value)} />
              {reportDate && (
                <button type="button" className="mu-date-clear" onClick={() => setReportDate('')} aria-label="Clear date">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="mu-help">
              {reportDate
                ? 'This date will be used as the report date.'
                : 'Leave empty to detect the date from the file automatically.'}
            </div>
          </div>

          <div className="mu-field">
            <label>File</label>
            <div
              className={`mu-drop ${dragOver ? 'over' : ''} ${file ? 'has-file' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                hidden
                onChange={e => pickFile(e.target.files?.[0])}
              />
              {file ? (
                <>
                  <FileText size={22} className="mu-drop-icon ok" />
                  <div className="mu-drop-name">{file.name}</div>
                  <div className="mu-drop-sub">{formatSize(file.size)} · click to change</div>
                </>
              ) : (
                <>
                  <CloudUpload size={22} className="mu-drop-icon" />
                  <div className="mu-drop-name">Drop a file here or click to browse</div>
                  <div className="mu-drop-sub">PDF, Excel, CSV, Word · max 50 MB</div>
                </>
              )}
            </div>
          </div>

          {error && <div className="mu-msg error"><AlertCircle size={14} /> {error}</div>}
          {done && <div className="mu-msg ok"><CheckCircle2 size={14} /> Uploaded successfully</div>}
        </div>

        <div className="mu-foot">
          <button type="button" className="mu-btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="mu-btn primary" disabled={!canSubmit} onClick={submit}>
            {busy ? <Loader2 size={15} className="mu-spin" /> : <Upload size={15} />}
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
