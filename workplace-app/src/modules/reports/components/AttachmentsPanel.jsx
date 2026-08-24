// src/modules/reports/components/AttachmentsPanel.jsx
// Left section of the detail panel.
// Shows attachment tabs at top, inline PDF viewer below.
// Supports multiple attachments from comma-separated blob_path.
import React, { useState, useEffect } from 'react';
import { FileText, Paperclip, AlertCircle, ChevronDown, ChevronUp, Download, ZoomIn, ZoomOut, RotateCcw, RefreshCw, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { reportsApi } from '../api/reportsApi';

function getFilename(path) {
  if (!path) return 'Document';
  if (path.startsWith('MISSING:')) {
    path = path.substring(8);
  }
  const base = path.split('/').pop();
  // Strip leading date+index prefix like "2026-08-14_0_"
  let cleanName = base.replace(/^\d{4}-\d{2}-\d{2}_\d+_/, '');
  
  // The scraper often appends the report name and extension AFTER the actual extension.
  // We match up to the FIRST valid extension and truncate the rest.
  const match = cleanName.match(/(.*?\.(?:xlsx?|xlsm|csv|pdf|png|jpe?g|gif|docx?|pptx?|txt|zip|rar|7z|msg|eml))/i);
  if (match) {
    cleanName = match[1];
  }
  
  return cleanName.replace(/_/g, ' ').trim();
}

function isSpreadsheetFile(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm') || lower.endsWith('.csv');
}

// Excel/Word/PowerPoint files render via Microsoft's Office Online Viewer
// (pixel-accurate to the real app -- colors, merges, logos, layout, slides,
// everything) instead of a plain fallback. Office Online doesn't support raw
// .csv, so that keeps using the SheetJS table.
function isOfficeViewerFile(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  return (
    lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm') ||
    lower.endsWith('.docx') || lower.endsWith('.doc') ||
    lower.endsWith('.pptx') || lower.endsWith('.ppt')
  );
}

function isCsvFile(path) {
  return !!path && path.toLowerCase().endsWith('.csv');
}

function isPdfFile(path) {
  return !!path && path.toLowerCase().endsWith('.pdf');
}

function isBrowserRenderable(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith('.pdf') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.txt') || isSpreadsheetFile(path) || isOfficeViewerFile(path);
}

// Downloads a (possibly cross-origin) file without navigating or opening a
// new tab. A plain `<a download target="_blank">` makes the browser flash
// open/close a blank tab for cross-origin URLs, which reflows the whole page
// ("shake"). Fetching the bytes ourselves and saving via a blob: URL avoids
// any navigation entirely.
async function triggerDownload(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(blobUrl);
}

function isImageFile(path) {
  if (!path) return false;
  const lower = path.toLowerCase();
  return lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif');
}

export default function AttachmentsPanel({ reportId, reportName, attachments = [], isCollapsed, onToggle }) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [sasUrl, setSasUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sheetTables, setSheetTables] = useState(null); // [{ name, html }] for spreadsheet preview
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [pdfChecking, setPdfChecking] = useState(false); // true while verifying a PDF's magic header before rendering it
  const [officeLoading, setOfficeLoading] = useState(false); // true until the Office Online iframe reports loaded
  const [sheetZoom, setSheetZoom] = useState(100); // % zoom for the local spreadsheet table preview
  const [officeZoom, setOfficeZoom] = useState(100); // % zoom for Office Online iframe
  const [downloading, setDownloading] = useState(false);

  const handleDownloadClick = async () => {
    const fileName = attachments[activeIdx]?.file_name || 'Document';
    setDownloading(true);
    try {
      await triggerDownload(sasUrl, fileName);
    } catch (e) {
      console.error(e);
    } finally {
      setDownloading(false);
    }
  };


  // Load SAS URL whenever reportId or activeIdx changes
  useEffect(() => {
    if (!reportId || attachments.length === 0) return;
    setLoading(true);
    setError(null);
    setSasUrl(null);
    setSheetTables(null);
    setActiveSheetIdx(0);
    setSheetZoom(100);
    setOfficeLoading(isOfficeViewerFile(attachments[activeIdx]?.file_name));
    setOfficeZoom(100);
    // Block the iframe from rendering until the PDF magic-header check below
    // finishes, so a corrupted file never flashes the native "Failed to load
    // PDF document" dialog before our own error state swaps in.
    setPdfChecking(isPdfFile(attachments[activeIdx]?.file_name));

    const path = attachments[activeIdx]?.blob_path || null;
    if (path && path.startsWith('MISSING:')) {
      setError('This report has not been updated in MariApp yet.');
      setSasUrl(null);
      setLoading(false);
      return;
    }

    reportsApi.getPdfUrlByPath(reportId, path)
      .then(d => setSasUrl(d.sas_url))
      .catch(e => setError(e.response?.data?.detail || 'Could not load PDF.'))
      .finally(() => setLoading(false));
  }, [reportId, activeIdx]); // eslint-disable-line

  // Once we have a SAS URL for a CSV attachment, fetch and parse it into an HTML table.
  // (.xlsx/.xls/.xlsm go through the Office Online Viewer iframe instead -- see render below.)
  useEffect(() => {
    const fileName = attachments[activeIdx]?.file_name;
    if (!sasUrl || !isCsvFile(fileName)) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(sasUrl)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(buf => {
        if (cancelled) return;
        const wb = XLSX.read(buf, { type: 'array' });
        const tables = wb.SheetNames.map(name => ({
          name,
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], { id: undefined, editable: false }),
        }));
        setSheetTables(tables);
        // Open on whichever tab was active when the file was last saved in
        // Excel (stored in the workbook itself), so the preview matches what
        // you'd see opening the downloaded file -- not always sheet 1, which
        // is often just a summary/index tab.
        const savedActiveTab = wb.Workbook?.WBView?.[0]?.activeTab;
        setActiveSheetIdx(
          Number.isInteger(savedActiveTab) && savedActiveTab < tables.length ? savedActiveTab : 0
        );
      })
      .catch(() => {
        if (!cancelled) setError('Could not preview this spreadsheet.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [sasUrl, activeIdx]); // eslint-disable-line

  // Once we have a SAS URL for a PDF, verify it's actually a real PDF before
  // handing it to the iframe. A 200-OK download during scraping doesn't
  // guarantee the bytes are a real PDF (e.g. SmartPAL can serve an HTML
  // error/session-timeout page mid-download) -- Azure still serves those
  // bytes with a "application/pdf" content-type (set from the filename, not
  // the content), so the browser's native PDF viewer only discovers the
  // problem after loading, showing a jarring generic "Failed to load PDF
  // document" dialog. A cheap ranged request checking for the "%PDF-" magic
  // header lets us show our own clean error state instead.
  useEffect(() => {
    const fileName = attachments[activeIdx]?.file_name;
    if (!sasUrl || !isPdfFile(fileName)) return;

    let cancelled = false;
    const isRealPdf = (buf) => new TextDecoder().decode(buf.slice(0, 5)) === '%PDF-';
    const notReady = () => { if (!cancelled) setError('This report has not been updated in MariApp yet.'); };

    fetch(sasUrl, { headers: { Range: 'bytes=0-4' } })
      .then(r => {
        if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(buf => {
        if (cancelled) return;
        if (!isRealPdf(buf)) notReady();
      })
      .catch(() =>
        // Range requests aren't always supported by the storage backend --
        // retry with a plain GET before concluding the file is unavailable,
        // so a healthy PDF is never misreported as missing.
        fetch(sasUrl)
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.arrayBuffer();
          })
          .then(buf => {
            if (!cancelled && !isRealPdf(buf)) notReady();
          })
          .catch(notReady)
      )
      .finally(() => {
        if (!cancelled) setPdfChecking(false);
      });

    return () => { cancelled = true; };
  }, [sasUrl, activeIdx]); // eslint-disable-line

  if (isCollapsed) {
    return (
      <div className="rt-vertical-header" onClick={onToggle}>
        <FileText size={20} className="rt-panel-icon" />
        <span className="rt-vertical-text">Document</span>
        <ChevronDown size={16} className="rt-panel-chevron" />
      </div>
    );
  }

  return (
    <div className="rt-attach-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Collapsible Header */}
      <div className="rt-panel-header" onClick={onToggle}>
        <div className="rt-panel-header-title">
          <FileText size={18} className="rt-panel-icon" />
          <span>Report Document</span>
        </div>
        <ChevronUp size={16} className="rt-panel-chevron" />
      </div>

      <div style={{ flex: 1, overflow: 'hidden', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {!attachments || attachments.length === 0 ? (
          <div className="rt-attach-empty">
            <Paperclip size={36} strokeWidth={1.2} color="#cbd5e1" />
            <p>No attachment found.</p>
          </div>
        ) : (
          <div style={{ 
            flex: 1, 
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            background: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Attachment Tabs */}
            <div className="rt-attach-tabs">
              {attachments.map((att, idx) => (
                <button
                  key={idx}
                  className={`rt-attach-tab ${activeIdx === idx ? 'active' : ''}`}
                  onClick={() => setActiveIdx(idx)}
                  title={att.file_name}
                >
                  <FileText size={12} />
                  <span>File {idx + 1}</span>
                </button>
              ))}
            </div>

            {/* Filename display */}
            <div className="rt-attach-filename">
              <FileText size={13} color="#3b82f6" />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {attachments[activeIdx]?.file_name || 'Document'}
              </span>
              {sasUrl && !error && (
                <button
                  type="button"
                  onClick={handleDownloadClick}
                  disabled={downloading}
                  title="Download file"
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#3b82f6', background: 'none', border: 'none', padding: 0, cursor: downloading ? 'default' : 'pointer', textDecoration: 'none', fontWeight: 600, fontSize: '0.75rem', flexShrink: 0, opacity: downloading ? 0.6 : 1, fontFamily: 'inherit' }}
                >
                  {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {downloading ? 'Downloading…' : 'Download'}
                </button>
              )}
            </div>

            {/* PDF Viewer */}
            <div className="rt-attach-viewer">
              {(loading || pdfChecking) && (
                <div className="rt-attach-loading">
                  <span className="rt-spinner" />
                  <span>Loading document...</span>
                </div>
              )}
              {error && !pdfChecking && (
                <div className="rt-attach-error">
                  <AlertCircle size={22} color="#d97706" />
                  <span>{error}</span>
                </div>
              )}
              {!loading && !error && !pdfChecking && sasUrl && (
                <>
                  {!isBrowserRenderable(attachments[activeIdx]?.file_name) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: '16px', background: '#f8fafc', padding: '24px', textAlign: 'center' }}>
                      <FileText size={48} color="#10b981" />
                      <div>
                        <h3 style={{ margin: '0 0 8px 0', color: '#0f172a' }}>File Download Required</h3>
                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>This document type ({(attachments[activeIdx]?.file_name || '').split('.').pop().toUpperCase()}) cannot be previewed natively in the browser.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleDownloadClick}
                        disabled={downloading}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#3b82f6', color: '#fff', padding: '10px 20px', borderRadius: '6px', border: 'none', textDecoration: 'none', fontWeight: 600, marginTop: '8px', cursor: downloading ? 'default' : 'pointer', opacity: downloading ? 0.75 : 1, fontFamily: 'inherit' }}
                      >
                        {downloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                        {downloading ? 'Downloading…' : 'Download File'}
                      </button>
                    </div>
                  ) : isImageFile(attachments[activeIdx]?.file_name) ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', overflow: 'hidden', padding: '16px' }}>
                      <img
                        src={sasUrl}
                        alt={attachments[activeIdx]?.file_name}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px' }}
                      />
                    </div>
                  ) : isOfficeViewerFile(attachments[activeIdx]?.file_name) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', overflow: 'hidden' }}>
                      {/* Zoom toolbar */}
                      {!officeLoading && (
                        <div className="rt-attach-zoom-bar">
                          <button type="button" className="rt-zoom-btn" title="Zoom out" onClick={() => setOfficeZoom(z => Math.max(50, z - 10))}><ZoomOut size={13} /></button>
                          <span className="rt-zoom-label">{officeZoom}%</span>
                          <button type="button" className="rt-zoom-btn" title="Zoom in" onClick={() => setOfficeZoom(z => Math.min(200, z + 10))}><ZoomIn size={13} /></button>
                          <button type="button" className="rt-zoom-btn" title="Reset zoom" onClick={() => setOfficeZoom(100)}><RotateCcw size={12} /></button>
                        </div>
                      )}
                      {/* Iframe with loading overlay */}
                      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
                        {officeLoading && (
                          <div className="rt-attach-loading" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
                            <span className="rt-spinner" />
                            <span>Loading document…</span>
                          </div>
                        )}
                        <iframe
                          key={sasUrl}
                          src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(sasUrl)}`}
                          title={attachments[activeIdx]?.file_name}
                          className="rt-attach-iframe"
                          onLoad={() => setOfficeLoading(false)}
                          style={{
                            opacity: officeLoading ? 0 : 1,
                            width: `${(100 / officeZoom) * 100}%`,
                            height: `${(100 / officeZoom) * 100}%`,
                            transform: `scale(${officeZoom / 100})`,
                            transformOrigin: 'top left',
                          }}
                        />
                      </div>
                    </div>
                  ) : isCsvFile(attachments[activeIdx]?.file_name) ? (
                    !sheetTables ? (
                      <div className="rt-attach-loading">
                        <span className="rt-spinner" />
                        <span>Loading spreadsheet...</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                          {sheetTables.length > 1 && (
                            <div className="rt-attach-tabs" style={{ flex: 1, minWidth: 0 }}>
                              {sheetTables.map((s, idx) => (
                                <button
                                  key={s.name}
                                  className={`rt-attach-tab ${activeSheetIdx === idx ? 'active' : ''}`}
                                  onClick={() => setActiveSheetIdx(idx)}
                                  title={s.name}
                                >
                                  <span>{s.name}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 8px', marginLeft: 'auto', flexShrink: 0 }}>
                            <button
                              type="button"
                              onClick={() => setSheetZoom(z => Math.max(50, z - 10))}
                              title="Zoom out"
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', border: '1px solid #e2e8f0', borderRadius: '5px', background: '#fff', cursor: 'pointer', color: '#475569' }}
                            >
                              <ZoomOut size={13} />
                            </button>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', minWidth: '34px', textAlign: 'center' }}>{sheetZoom}%</span>
                            <button
                              type="button"
                              onClick={() => setSheetZoom(z => Math.min(200, z + 10))}
                              title="Zoom in"
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', border: '1px solid #e2e8f0', borderRadius: '5px', background: '#fff', cursor: 'pointer', color: '#475569' }}
                            >
                              <ZoomIn size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setSheetZoom(100)}
                              title="Reset zoom"
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', border: '1px solid #e2e8f0', borderRadius: '5px', background: '#fff', cursor: 'pointer', color: '#475569' }}
                            >
                              <RotateCcw size={12} />
                            </button>
                          </div>
                        </div>
                        <div
                          className="rt-attach-sheet-table"
                          style={{ flex: 1, overflow: 'auto', background: '#fff', padding: '8px', zoom: sheetZoom / 100 }}
                          dangerouslySetInnerHTML={{ __html: sheetTables[activeSheetIdx]?.html || '' }}
                        />
                      </div>
                    )
                  ) : (
                    <iframe
                      key={sasUrl}
                      src={`/reports/api/v1/reports/${reportId}/pdf/stream?path=${encodeURIComponent(attachments[activeIdx]?.blob_path || '')}`}
                      title={attachments[activeIdx]?.file_name}
                      className="rt-attach-iframe"
                    />
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
