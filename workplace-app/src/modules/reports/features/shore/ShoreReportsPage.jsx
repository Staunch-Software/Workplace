import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '../../api/reportsApi';
import ReportsNavbar from '../../components/ReportsNavbar';
import AttachmentsPanel from '../../components/AttachmentsPanel';
import ThreadPanel from '../../components/ThreadPanel';
import ReportViewerModal from '../../components/ReportViewerModal';
import BulkDownloadModal from '../../components/BulkDownloadModal';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  Ship, Filter, Search, ChevronDown, ChevronRight, X, CheckCircle2, Clock, AlertCircle, Paperclip, AlertTriangle, CalendarClock, MessageSquare, Download
} from 'lucide-react';
import '../../styles/Reports.css';
import { compareReportNames } from '../../reportOrder';
import { fmtDate } from '@/utils/dateUtils';

const FREQ_ORDER = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'OTHER'];
const FREQ_LABELS = {
  WEEKLY: 'Weekly', MONTHLY: 'Monthly', QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-Yearly', YEARLY: 'Yearly', OTHER: 'Other',
};

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


function StatusBadge({ scrape_status }) {
  const map = {
    SCRAPED: { icon: <CheckCircle2 size={11}/>, label: 'Scraped', cls: 'scraped' },
    PENDING: { icon: <Clock size={11}/>, label: 'Pending', cls: 'pending' },
    FAILED:  { icon: <AlertCircle size={11}/>, label: 'Failed', cls: 'failed' },
  };
  const s = map[scrape_status] || map.PENDING;
  return <span className={`rt-badge rt-badge-${s.cls}`}>{s.icon} {s.label}</span>;
}

export default function ShoreReportsPage() {
  useAuth();

  const [selectedImo, setSelectedImo] = useState('');
  const [expandedFreqs, setExpandedFreqs] = useState(['WEEKLY', 'MONTHLY']);
  const [selectedReportName, setSelectedReportName] = useState('');
  const [search, setSearch] = useState('');
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [selectedRow, setSelectedRow] = useState(null); // The report opened in the Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFocusPane, setModalFocusPane] = useState(undefined); // 'thread' when opened from a mention notification
  const [highlightRowId, setHighlightRowId] = useState(null); // Row to flash/scroll to when opened from a notification
  const skipAutoSelectRef = useRef(false); // set while a notification is choosing the vessel/report, to stop auto-select from overriding it
  const [isVesselDropdownOpen, setIsVesselDropdownOpen] = useState(false);
  const [tooltipData, setTooltipData] = useState({ visible: false, text: '', x: 0, y: 0 });
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const handleTooltipEnter = useCallback((e, text) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipData({
      visible: true,
      text,
      x: rect.right + 10,
      y: rect.top + (rect.height / 2)
    });
  }, []);
  const handleTooltipLeave = useCallback(() => {
    setTooltipData({ visible: false, text: '', x: 0, y: 0 });
  }, []);

  // Fetch vessels
  const { data: coreVessels = [] } = useQuery({
    queryKey: ['core-vessels'],
    queryFn: () => reportsApi.getVessels(),
  });

  // Fetch all reports
  const { data: rawReports, isLoading } = useQuery({
    queryKey: ['reports-list'],
    queryFn: () => reportsApi.listReports(),
    refetchInterval: 30000,
  });
  const reports = useMemo(() => (Array.isArray(rawReports) ? rawReports : []), [rawReports]);

  // Handle ?open= param — a notification click should land on the correct
  // report row in the table, not pop the viewer modal (mentions still need
  // the modal since that's where the thread panel lives).
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && reports.length > 0) {
      const target = reports.find(r => r.id === openId);
      if (target) {
        skipAutoSelectRef.current = true;
        setSelectedImo(target.vessel_imo);

        // Find correct frequency for this report to ensure the sidebar expands
        const f = normalizeFreq(target.frequency);
        setExpandedFreqs(prev => prev.includes(f) ? prev : [...prev, f]);

        setSelectedReportName(target.report_name);
        setSelectedRow(target);

        if (searchParams.get('thread') === 'true') {
          setModalFocusPane('thread');
          setModalOpen(true);
        } else {
          setHighlightRowId(target.id);
        }
        setSearchParams({}, { replace: true });
      }
    }
  }, [searchParams, reports, setSearchParams]);

  // Clear the highlight a few seconds after landing on the row
  useEffect(() => {
    if (!highlightRowId) return;
    const t = setTimeout(() => setHighlightRowId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightRowId]);

  const { data: rawConfigs } = useQuery({
    queryKey: ['report-configs'],
    queryFn: () => reportsApi.listConfigs(),
  });
  const configs = useMemo(() => (Array.isArray(rawConfigs) ? rawConfigs : []), [rawConfigs]);

  // Build vessel list
  const vessels = useMemo(() => {
    const stats = {};
    reports.forEach(r => {
      if (!stats[r.vessel_imo]) stats[r.vessel_imo] = { total: 0, pending: 0, scraped: 0 };
      stats[r.vessel_imo].total++;
      if (r.scrape_status === 'PENDING' || r.scrape_status === 'FAILED') stats[r.vessel_imo].pending++;
      if (r.scrape_status === 'SCRAPED') stats[r.vessel_imo].scraped++;
    });

    if (coreVessels.length === 0) {
      const map = {};
      reports.forEach(r => {
        if (!map[r.vessel_imo]) map[r.vessel_imo] = { name: r.vessel_name, ...stats[r.vessel_imo] };
      });
      return Object.entries(map).map(([imo, d]) => ({ imo, ...d })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return coreVessels.map(v => ({
      imo: v.imo,
      name: v.name,
      ...stats[v.imo] || { total: 0, pending: 0, scraped: 0 }
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [coreVessels, reports]);

  const activeVesselImo = selectedImo || vessels[0]?.imo || '';
  const activeVessel = vessels.find(v => v.imo === activeVesselImo);

  // Reports for active vessel
  const vesselReports = useMemo(() => {
    let filtered = reports.filter(r => r.vessel_imo === activeVesselImo);
    if (configs.length > 0) {
      const validCodes = new Set(
        configs.filter(c => c.vessel_imo === activeVesselImo).map(c => c.report_code)
      );
      filtered = filtered.filter(r => validCodes.has(r.report_code));
    }
    return filtered;
  }, [reports, activeVesselImo, configs]);

  // Build tree: frequency → report_name → [report instances]
  const treeData = useMemo(() => {
    const map = {};

    // ONLY add reports that actually have data for this vessel
    vesselReports.forEach(r => {
      const f = normalizeFreq(r.frequency);
      const name = r.report_name || 'Unknown';
      if (!map[f]) map[f] = {};
      if (!map[f][name]) map[f][name] = [];
      map[f][name].push(r);
    });

    return map;
  }, [vesselReports]);

  const displayFreqs = FREQ_ORDER;

  const getSortedNames = useCallback((freq) => {
    let names = Object.keys(treeData[freq] || {});
    if (sidebarSearch) {
      names = names.filter(n => n.toLowerCase().includes(sidebarSearch.toLowerCase()));
    }
    return names.sort(compareReportNames);
  }, [treeData, sidebarSearch]);

  // Auto-select first report on vessel change
  useEffect(() => {
    if (skipAutoSelectRef.current) {
      skipAutoSelectRef.current = false;
      return;
    }
    setSelectedRow(null);
    for (const f of displayFreqs) {
      const names = getSortedNames(f);
      if (names.length > 0) {
        setSelectedReportName(names[0]);
        if (!expandedFreqs.includes(f)) setExpandedFreqs(p => [...p, f]);
        return;
      }
    }
    setSelectedReportName('');
  }, [activeVesselImo]); // eslint-disable-line

  const toggleFreq = useCallback((id) => {
    setExpandedFreqs(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }, []);

  const selectReport = useCallback((name) => {
    setSelectedReportName(name);
    setSelectedRow(null);
  }, []);

  // Table rows for selected report name
  const tableData = useMemo(() => {
    if (!selectedReportName) return [];
    let rows = [];
    for (const f in treeData) {
      if (treeData[f][selectedReportName]) {
        rows = rows.concat(treeData[f][selectedReportName]);
      }
    }
    const q = search.toLowerCase();
    return rows
      .filter(r => !q ||
        r.job_order_no?.toLowerCase().includes(q) ||
        r.report_code?.toLowerCase().includes(q) ||
        r.approved_by?.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const dateA = new Date(a.due_date || a.job_date || a.created_at || 0).getTime();
        const dateB = new Date(b.due_date || b.job_date || b.created_at || 0).getTime();
        return dateB - dateA;
      });
  }, [treeData, selectedReportName, search]);

  const totalUnread = reports.reduce((a, r) => a + (r.unread_shore || 0), 0);

  // When vessel changes, reset row selection
  const handleVesselChange = (imo) => {
    setSelectedImo(imo);
    setModalOpen(false);
    setSelectedRow(null);
  };

  return (
    <div className="rt-root">
      {/* Fixed Tooltip for Sidebar */}
      {tooltipData.visible && (
        <div style={{
          position: 'fixed',
          top: tooltipData.y,
          left: tooltipData.x,
          transform: 'translateY(-50%)',
          background: '#1e293b',
          color: '#f8fafc',
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '0.75rem',
          fontWeight: 600,
          whiteSpace: 'normal',
          maxWidth: '260px',
          zIndex: 9999,
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}>
          <div style={{
            position: 'absolute', top: '50%', right: '100%',
            transform: 'translateY(-50%)', border: '5px solid transparent', borderRightColor: '#1e293b'
          }} />
          {tooltipData.text}
        </div>
      )}

      <ReportsNavbar totalUnread={totalUnread} />

      {/* ── Control Bar ── */}
      <div className="rt-control-bar">
        <div className="rt-control-left">
          <h2 className="rt-page-heading">Reports Dashboard</h2>
          <div 
            className="rt-vessel-select-wrap" 
            onClick={() => setIsVesselDropdownOpen(!isVesselDropdownOpen)}
          >
            <Ship size={14} color="#2563eb" />
            <span className="rt-vessel-select-value">{activeVessel?.name || 'Select Vessel'}</span>
            <ChevronDown size={13} className="rt-select-chevron" />
            
            {isVesselDropdownOpen && (
              <>
                <div className="rt-dropdown-overlay" onClick={(e) => { e.stopPropagation(); setIsVesselDropdownOpen(false); }} />
                <div className="rt-vessel-dropdown">
                  {vessels.map(v => (
                    <div 
                      key={v.imo} 
                      className={`rt-vessel-option ${v.imo === activeVesselImo ? 'active' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVesselChange(v.imo);
                        setIsVesselDropdownOpen(false);
                      }}
                    >
                      {v.name}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

        </div>

        <div className="rt-control-right">
          <button className="bdl-trigger-btn" onClick={() => setDownloadModalOpen(true)}>
            <Download size={14} />
            Download Reports
          </button>

          <div className="rt-search-box">
            <Search size={13} color="#94a3b8" />
            <input
              type="text"
              placeholder="Search job no, approver..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <X size={13} color="#94a3b8" style={{cursor:'pointer'}} onClick={() => setSearch('')} />}
          </div>
        </div>
      </div>

      {/* ── Main Layout ── */}
      <div className="rt-main-content">

        {/* Card Accordion Sidebar */}
        <div className="rt-freq-sidebar" style={{ paddingTop: 0 }}>
          
          {/* Sidebar Search */}
          <div style={{ 
            position: 'sticky', 
            top: 0, 
            zIndex: 10, 
            background: '#f1f5f9', 
            padding: '20px 16px 16px 16px', 
            margin: '0 -16px'
          }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Filter reports..."
                value={sidebarSearch}
                onChange={e => setSidebarSearch(e.target.value)}
                style={{ width: '100%', padding: '10px 12px 10px 34px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem', color: '#1e293b', outline: 'none', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}
              />
              {sidebarSearch && <X size={13} color="#94a3b8" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer' }} onClick={() => setSidebarSearch('')} />}
            </div>
          </div>

          {displayFreqs.map(freqId => {
            const reportNames = getSortedNames(freqId);
            const isExpanded = expandedFreqs.includes(freqId);
            
            return (
              <div key={freqId} className={`rt-sidebar-group-card ${isExpanded ? 'expanded' : ''}`}>
                <div 
                  className="rt-sidebar-group-header"
                  onClick={() => toggleFreq(freqId)}
                >
                  <div className="rt-sgh-left">
                    {FREQ_LABELS[freqId] || freqId}
                    <span className="rt-sgh-count">{reportNames.length}</span>
                  </div>
                  <ChevronRight size={16} className={`rt-sgh-chevron ${isExpanded ? 'expanded' : ''}`} />
                </div>
                
                {isExpanded && (
                  <div className="rt-sidebar-group-items">
                    {reportNames.length === 0 ? (
                      <div className="rt-tree-leaf" style={{ cursor: 'default', color: '#94a3b8', fontStyle: 'italic', pointerEvents: 'none' }}>
                        <span className="rt-tree-leaf-name">No reports found</span>
                      </div>
                    ) : (
                      reportNames.map(name => {
                        const instances = treeData[freqId][name];
                        const isActive = selectedReportName === name;
                        return (
                          <div
                            key={name}
                            className={`rt-tree-leaf ${isActive ? 'active' : ''}`}
                            onClick={() => selectReport(name)}
                            onMouseEnter={(e) => handleTooltipEnter(e, name)}
                            onMouseLeave={handleTooltipLeave}
                          >
                            <span className="rt-tree-leaf-name">{name}</span>
                            {instances.length > 0 && (
                              <span className="rt-tree-badge">{instances.length}</span>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Right area: table + detail panel stacked */}
        <div className="rt-table-area">

          {/* Table header */}
          {selectedReportName && (
            <div className="rt-table-header">
              <div className="rt-table-title">{selectedReportName}</div>
              <div className="rt-table-subtitle">
                {tableData.length} record{tableData.length !== 1 ? 's' : ''} found
              </div>
            </div>
          )}

          {/* Table */}
          <div className="rt-table-scroll">
            {isLoading ? (
              <div className="rt-loading"><span className="rt-spinner" /> Loading reports...</div>
            ) : (
              <table className="rt-data-table">
                <thead>
                  <tr>
                    <th>Job Order No.</th>
                    <th>Due Date</th>
                    <th>Next Due Date</th>
                    <th>Job Status</th>
                    <th>Job Start Date</th>
                    <th>Job End Date</th>
                    <th>Job Type</th>
                    <th>Job Category</th>
                    <th>Approved By</th>
                    <th style={{ width: 40, textAlign: 'center' }} title="Attachment"><Paperclip size={14} /></th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{textAlign:'center', padding:'120px 0', color:'#94a3b8'}}>
                        {selectedReportName ? 'No records found.' : 'Select a report from the left.'}
                      </td>
                    </tr>
                  ) : tableData.map((r) => {
                    const isPending = r.job_status === 'PENDING';
                    
                    let isOverdue = false;
                    if (isPending && r.due_date) {
                        const due = new Date(r.due_date);
                        const day = due.getDay();
                        const daysToSunday = day === 0 ? 0 : 7 - day;
                        const graceEnd = new Date(due);
                        graceEnd.setDate(graceEnd.getDate() + daysToSunday + 2);
                        graceEnd.setHours(23, 59, 59, 999);
                        const now = new Date();
                        isOverdue = now > graceEnd;
                    }

                    const isHighlighted = r.id === highlightRowId;

                    return (
                    <tr
                      key={r.id}
                      ref={isHighlighted ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
                      className={`rt-data-row ${isPending ? (isOverdue ? 'rt-row-overdue' : 'rt-row-today-planned') : ''}`}
                      style={isHighlighted ? { outline: '2px solid #6366f1', outlineOffset: '-2px', background: 'rgba(99,102,241,0.08)', transition: 'background 1.5s ease' } : undefined}
                    >
                      <td className="rt-col-job">
                         {isPending && (
                           <span className="rt-due-pin-icon" style={{marginRight: 6, display: 'inline-flex', alignItems: 'center'}}>
                             {isOverdue ? <AlertTriangle size={13} /> : <CalendarClock size={13} />}
                           </span>
                         )}
                         {r.job_order_no || '—'}
                      </td>
                      <td className="rt-col-date">{fmtDate(r.due_date)}</td>
                      <td className="rt-col-date">{fmtDate(r.next_due_date)}</td>
                      <td>
                        {isPending ? (
                          <span className={`rt-due-status-label ${isOverdue ? 'overdue' : 'planned'}`}>
                            {isOverdue ? '⚠ PENDING' : 'THIS WEEK'}
                          </span>
                        ) : (
                          r.job_status || '—'
                        )}
                      </td>
                      <td className="rt-col-date">{fmtDate(r.job_start_date)}</td>
                      <td className="rt-col-date">{fmtDate(r.job_end_date)}</td>
                      <td>{r.job_type || '—'}</td>
                      <td>{r.job_category || '—'}</td>
                      <td style={{color:'#334155'}}>{r.approved_by || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {(() => {
                          const hasAttachment = r.attachments?.some(a => !a.blob_path?.startsWith('MISSING:'));
                          return (
                            <button
                              className="rt-btn-icon-only"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRow(r);
                                setModalFocusPane(undefined);
                                setModalOpen(true);
                              }}
                              title={hasAttachment ? 'View Attachment' : 'View / Open Thread'}
                            >
                              {hasAttachment ? <Paperclip size={16} /> : <MessageSquare size={16} />}
                            </button>
                          );
                        })()}
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Collapsible Modal Viewer ── */}
          {modalOpen && selectedRow && (
            <ReportViewerModal
              report={selectedRow}
              role="SHORE"
              focusPane={modalFocusPane}
              onClose={() => setModalOpen(false)}
            />
          )}
        </div>
      </div>

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
