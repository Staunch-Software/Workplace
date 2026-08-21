// src/modules/reports/components/BulkDownloadModal.jsx
import React, { useState, useMemo, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import {
  X, Search, Download, Ship, FileText, Check, Loader2,
  Package, ChevronLeft, AlertCircle, CheckSquare, Square, Minus,
} from 'lucide-react';
import { reportsApi } from '../api/reportsApi';

/* ─── Helpers ─────────────────────────────────────────────────────── */
function getOriginalFilename(att) {
  if (att.file_name) return att.file_name;
  const path = att.blob_path || '';
  const base = path.split('/').pop();
  let name = base.replace(/^\d{4}-\d{2}-\d{2}_\d+_/, '');
  const m = name.match(/(.*?\.(?:xlsx?|xlsm|csv|pdf|png|jpe?g|gif|docx?|pptx?|txt|zip|rar|7z|msg|eml))/i);
  return m ? m[1] : name;
}
function sanitizeFolderName(name) {
  return (name || 'Unknown').replace(/[/\\?%*:|"<>]/g, '_').trim();
}
function hasValidAttachment(attachments) {
  return Array.isArray(attachments) &&
    attachments.some(a => a.blob_path && !a.blob_path.startsWith('MISSING:'));
}
function today() { return new Date().toISOString().slice(0, 10); }

export default function BulkDownloadModal({ vessels = [], reports = [], onClose }) {
  const [step, setStep] = useState(1);
  const [selectedVesselImo, setSelectedVesselImo] = useState('');
  const [vesselSearch, setVesselSearch] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  const [selectedReportNames, setSelectedReportNames] = useState(new Set());
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: '' });
  const [error, setError] = useState('');
  const abortRef = useRef(false);

  const selectedVessel = vessels.find(v => v.imo === selectedVesselImo);

  const availableReports = useMemo(() => {
    if (!selectedVesselImo) return [];
    const map = new Map();
    reports.forEach(r => {
      if (r.vessel_imo !== selectedVesselImo) return;
      if (!hasValidAttachment(r.attachments)) return;
      const name = r.report_name || 'Unknown';
      const prev = map.get(name) || { count: 0, files: 0 };
      map.set(name, {
        count: prev.count + 1,
        files: prev.files + r.attachments.filter(a => a.blob_path && !a.blob_path.startsWith('MISSING:')).length,
      });
    });
    return [...map.entries()].map(([name, info]) => ({ name, ...info })).sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedVesselImo, reports]);

  const filteredVessels = useMemo(() =>
    vesselSearch ? vessels.filter(v => v.name.toLowerCase().includes(vesselSearch.toLowerCase())) : vessels,
    [vessels, vesselSearch]);

  const filteredReports = useMemo(() =>
    reportSearch ? availableReports.filter(r => r.name.toLowerCase().includes(reportSearch.toLowerCase())) : availableReports,
    [availableReports, reportSearch]);

  const allSelected = filteredReports.length > 0 && filteredReports.every(r => selectedReportNames.has(r.name));
  const someSelected = !allSelected && filteredReports.some(r => selectedReportNames.has(r.name));
  const totalSelectedFiles = useMemo(() =>
    availableReports.filter(r => selectedReportNames.has(r.name)).reduce((s, r) => s + r.files, 0),
    [availableReports, selectedReportNames]);

  const toggleReport = useCallback((name) => {
    setSelectedReportNames(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedReportNames(prev => {
      const n = new Set(prev);
      if (allSelected) filteredReports.forEach(r => n.delete(r.name));
      else filteredReports.forEach(r => n.add(r.name));
      return n;
    });
  }, [allSelected, filteredReports]);

  const handleVesselSelect = useCallback((imo) => {
    setSelectedVesselImo(imo); setSelectedReportNames(new Set());
    setReportSearch(''); setError(''); setStep(2);
  }, []);

  const handleBackToVessels = useCallback(() => { setStep(1); setError(''); }, []);
  const goToStep = useCallback((n) => {
    if (downloading) return;
    if (n === 1) { setStep(1); return; }
    if (n === 2 && selectedVesselImo) setStep(2);
  }, [downloading, selectedVesselImo]);

  const handleDownload = useCallback(async () => {
    if (!selectedVesselImo || selectedReportNames.size === 0 || downloading) return;
    abortRef.current = false; setDownloading(true); setError('');
    const tasks = [];
    reports.forEach(r => {
      if (r.vessel_imo !== selectedVesselImo) return;
      if (!selectedReportNames.has(r.report_name)) return;
      r.attachments?.forEach(att => { if (att.blob_path && !att.blob_path.startsWith('MISSING:')) tasks.push({ report: r, att }); });
    });
    if (tasks.length === 0) { setError('No downloadable attachments found.'); setDownloading(false); return; }
    setProgress({ current: 0, total: tasks.length, label: 'Starting…' });
    const zip = new JSZip(); let done = 0, failed = 0;
    for (const { report, att } of tasks) {
      if (abortRef.current) break;
      const folder = sanitizeFolderName(report.report_name);
      const filename = getOriginalFilename(att);
      setProgress({ current: done, total: tasks.length, label: `Fetching ${filename}…` });
      try {
        const { sas_url } = await reportsApi.getPdfUrlByPath(report.id, att.blob_path);
        const resp = await fetch(sas_url);
        if (!resp.ok) throw new Error();
        const blob = await resp.blob();
        const folderObj = zip.folder(folder);
        const existingKeys = Object.keys(zip.files).filter(k => k.startsWith(folder + '/'));
        let finalName = filename;
        if (existingKeys.includes(`${folder}/${filename}`)) {
          const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
          const base = ext ? filename.slice(0, filename.lastIndexOf('.')) : filename;
          let i = 2; while (existingKeys.includes(`${folder}/${base}_${i}${ext}`)) i++;
          finalName = `${base}_${i}${ext}`;
        }
        folderObj.file(finalName, blob);
      } catch { failed++; }
      done++; setProgress({ current: done, total: tasks.length, label: `Downloaded ${done} of ${tasks.length}…` });
    }
    if (!abortRef.current) {
      setProgress({ current: tasks.length, total: tasks.length, label: 'Building ZIP…' });
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url; a.download = `${(selectedVessel?.name || 'vessel').replace(/\s+/g, '_')}_reports_${today()}.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      if (failed > 0) setError(`${failed} file${failed > 1 ? 's' : ''} could not be downloaded and were skipped.`);
    }
    setDownloading(false); setProgress({ current: 0, total: 0, label: '' });
  }, [selectedVesselImo, selectedReportNames, reports, selectedVessel, downloading]);

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const canDownload = step === 2 && selectedVesselImo && selectedReportNames.size > 0 && !downloading;

  return (
    <div className="bdl-backdrop" onClick={onClose}>
      <div className="bdl-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="bdl-header">
          <div className="bdl-header-left">
            <div className="bdl-header-icon"><Package size={20} /></div>
            <div>
              <h2 className="bdl-title">Download Reports</h2>
              <p className="bdl-subtitle">Select a vessel and reports to package as ZIP</p>
            </div>
          </div>
          <button className="bdl-close" onClick={onClose} disabled={downloading}><X size={18} /></button>
        </div>

        {/* Stepper */}
        <div className="bdl-stepper">
          <button type="button" className={`bdl-step-pill ${step === 1 ? 'active' : ''} ${selectedVesselImo ? 'done' : ''}`} onClick={() => goToStep(1)}>
            <span className="bdl-step-num">{selectedVesselImo && step !== 1 ? <Check size={12} /> : '1'}</span>
            <span className="bdl-step-label">Vessel{selectedVessel ? <strong> · {selectedVessel.name}</strong> : null}</span>
          </button>
          <div className={`bdl-step-connector ${selectedVesselImo ? 'done' : ''}`} />
          <button type="button" className={`bdl-step-pill ${step === 2 ? 'active' : ''}`} onClick={() => goToStep(2)} disabled={!selectedVesselImo}>
            <span className="bdl-step-num">2</span>
            <span className="bdl-step-label">Reports{selectedReportNames.size > 0 ? <strong> · {selectedReportNames.size} selected</strong> : null}</span>
          </button>
        </div>

        {/* Body */}
        <div className="bdl-body bdl-body-wizard">

          {/* Step 1 — Vessel */}
          {step === 1 && (
            <div className="bdl-step-panel">
              <div className="bdl-search-wrap bdl-search-lg">
                <Search size={14} />
                <input className="bdl-search-input" placeholder="Search vessels…" value={vesselSearch} onChange={e => setVesselSearch(e.target.value)} autoFocus />
                {vesselSearch && <button className="bdl-search-clear" onClick={() => setVesselSearch('')}><X size={11} /></button>}
              </div>

              {filteredVessels.length === 0 ? (
                <div className="bdl-placeholder"><Ship size={32} strokeWidth={1.2} /><p>No vessels found</p></div>
              ) : (
                <div className="bdl-vessel-grid">
                  {filteredVessels.map(v => (
                    <button key={v.imo} className={`bdl-vessel-card ${v.imo === selectedVesselImo ? 'active' : ''}`} onClick={() => handleVesselSelect(v.imo)}>
                      <div className="bdl-vessel-card-icon"><Ship size={18} /></div>
                      <div className="bdl-vessel-card-text">
                        <span className="bdl-vessel-card-name">{v.name}</span>
                        <span className="bdl-vessel-card-imo">IMO {v.imo}</span>
                      </div>
                      {v.imo === selectedVesselImo && <div className="bdl-vessel-card-check"><Check size={11} /></div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Reports */}
          {step === 2 && (
            <div className="bdl-step-panel">
              <div className="bdl-step2-toolbar">
                <button className="bdl-back-link" onClick={handleBackToVessels}><ChevronLeft size={15} />Change vessel</button>
                <span className="bdl-vessel-chip"><Ship size={12} />{selectedVessel?.name}</span>
              </div>

              {availableReports.length === 0 ? (
                <div className="bdl-placeholder"><AlertCircle size={28} strokeWidth={1.2} /><p>No reports with attachments found for this vessel</p></div>
              ) : (
                <>
                  <div className="bdl-search-wrap">
                    <Search size={13} />
                    <input className="bdl-search-input" placeholder="Filter reports…" value={reportSearch} onChange={e => setReportSearch(e.target.value)} autoFocus />
                    {reportSearch && <button className="bdl-search-clear" onClick={() => setReportSearch('')}><X size={11} /></button>}
                  </div>

                  <button className="bdl-select-all" onClick={toggleAll}>
                    <span className="bdl-cb-icon">
                      {allSelected ? <CheckSquare size={15} /> : someSelected ? <Minus size={15} /> : <Square size={15} />}
                    </span>
                    <span className="bdl-select-all-label">{allSelected ? 'Deselect all' : 'Select all'}</span>
                    <span className="bdl-select-all-count">{filteredReports.length} reports</span>
                  </button>

                  <div className="bdl-list bdl-list-reports">
                    {filteredReports.map(r => {
                      const checked = selectedReportNames.has(r.name);
                      return (
                        <button key={r.name} className={`bdl-report-item ${checked ? 'checked' : ''}`} onClick={() => toggleReport(r.name)}>
                          <span className="bdl-cb-icon">{checked ? <CheckSquare size={15} /> : <Square size={15} />}</span>
                          <span className="bdl-report-icon"><FileText size={13} /></span>
                          <span className="bdl-report-name">{r.name}</span>
                          <span className="bdl-report-meta">{r.count} {r.count === 1 ? 'entry' : 'entries'} · {r.files} {r.files === 1 ? 'file' : 'files'}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bdl-footer">
          {downloading && (
            <div className="bdl-progress-wrap">
              <div className="bdl-progress-bar-track">
                <div className="bdl-progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="bdl-progress-label">{progress.label} · {pct}%</span>
            </div>
          )}
          {error && !downloading && (
            <div className="bdl-error"><AlertCircle size={13} />{error}</div>
          )}
          <div className="bdl-footer-row">
            <span className="bdl-footer-summary">
              {canDownload ? `${selectedVessel?.name} · ${selectedReportNames.size} report${selectedReportNames.size > 1 ? 's' : ''} · ${totalSelectedFiles} file${totalSelectedFiles !== 1 ? 's' : ''}` : ''}
            </span>
            <div className="bdl-footer-actions">
              <button className="bdl-btn-cancel" onClick={onClose} disabled={downloading}>Cancel</button>
              <button className="bdl-btn-download" onClick={handleDownload} disabled={!canDownload}>
                {downloading ? <><Loader2 size={15} className="bdl-spin" />Downloading… {pct}%</> : <><Download size={15} />Download ZIP</>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
