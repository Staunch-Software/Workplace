import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { vesselReportsApi } from "../../api/reportsApi";
import ReportsNavbar from "../../components/ReportsNavbar";
import AttachmentsPanel from "../../components/AttachmentsPanel";
import VesselThreadPanel from "../../components/VesselThreadPanel";
import ReportViewerModal from "../../components/ReportViewerModal";
import { FileText, MessageSquare, Search, X, WifiOff, ChevronRight, Paperclip, AlertTriangle, CalendarClock } from "lucide-react";
import "../../styles/Reports.css";
import { compareReportNames } from "../../reportOrder";

const FREQUENCIES = [
  { id: 'WEEKLY', label: 'WEEKLY' },
  { id: 'MONTHLY', label: 'MONTHLY' },
  { id: 'QUARTERLY', label: 'QUARTERLY' },
  { id: 'HALF_YEARLY', label: 'HALF YEARLY' },
  { id: 'YEARLY', label: 'YEARLY' },
];

function fmt(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function VesselReportsPage() {
  const [expandedFreqs, setExpandedFreqs] = useState(['WEEKLY', 'MONTHLY']);
  const [selectedReportName, setSelectedReportName] = useState('');
  const [search, setSearch] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [tooltipData, setTooltipData] = useState({ visible: false, text: '', x: 0, y: 0 });

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
  
  const [selectedRow, setSelectedRow] = useState(null); // The report opened in the Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFocusPane, setModalFocusPane] = useState(undefined); // 'thread' when opened from a mention notification
  const [highlightRowId, setHighlightRowId] = useState(null); // Row to flash/scroll to when opened from a notification
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["vessel-reports-list"],
    queryFn: () => vesselReportsApi.listReports(),
    refetchInterval: 15000,
  });

  const reports = Array.isArray(data) ? data : [];

  // Handle ?open= param — a notification click should land on the correct
  // report row in the table, not pop the viewer modal (mentions still need
  // the modal since that's where the thread panel lives).
  useEffect(() => {
    const openId = searchParams.get('open');
    if (openId && reports.length > 0) {
      const target = reports.find(r => r.id === openId);
      if (target) {
        let f = (target.frequency || 'OTHER').toUpperCase().replace(/[-\s]/g, '_');
        if (f === 'HALF YEARLY') f = 'HALF_YEARLY';

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

  // Build Tree Data (Group by Frequency -> Report Name)
  const treeData = useMemo(() => {
    const map = {};
    
    reports.forEach(r => {
      let f = (r.frequency || 'OTHER').toUpperCase().replace(/[-\s]/g, '_');
      if (f === 'HALF YEARLY') f = 'HALF_YEARLY';
      
      const name = r.report_name || 'Unknown Report';
      if (!map[f]) map[f] = {};
      if (!map[f][name]) map[f][name] = [];
      map[f][name].push(r);
    });
    return map;
  }, [reports]);

  const displayFreqs = FREQUENCIES;

  const getSortedNames = useCallback((freq) => {
    let names = Object.keys(treeData[freq] || {});
    if (sidebarSearch) {
      names = names.filter(n => n.toLowerCase().includes(sidebarSearch.toLowerCase()));
    }
    return names.sort(compareReportNames);
  }, [treeData, sidebarSearch]);

  // Auto-select first report if none selected
  useEffect(() => {
    if (reports.length > 0) {
      const currentExists = reports.some(r => r.report_name === selectedReportName);
      if (!currentExists || !selectedReportName) {
        for (let freq of displayFreqs) {
          const names = getSortedNames(freq.id);
          if (names.length > 0) {
            setSelectedReportName(names[0]);
            if (!expandedFreqs.includes(freq.id)) {
              setExpandedFreqs(prev => [...prev, freq.id]);
            }
            return;
          }
        }
      }
    } else {
      setSelectedReportName('');
    }
  }, [reports, treeData, selectedReportName, expandedFreqs, displayFreqs]);

  const toggleFreq = (freqId) => {
    setExpandedFreqs(prev => 
      prev.includes(freqId) ? prev.filter(id => id !== freqId) : [...prev, freqId]
    );
  };

  const tableData = useMemo(() => {
    if (!selectedReportName) return [];
    let jobs = [];
    for (let f in treeData) {
      if (treeData[f][selectedReportName]) {
        jobs = jobs.concat(treeData[f][selectedReportName]);
      }
    }
    const rows = jobs.filter(r => {
      const matchesSearch = !search || 
        r.job_order_no?.toLowerCase().includes(search.toLowerCase()) ||
        r.report_code?.toLowerCase().includes(search.toLowerCase());
      return matchesSearch;
    });
    return rows.sort((a, b) => {
      const dateA = new Date(a.due_date || a.job_date || a.created_at || 0).getTime();
      const dateB = new Date(b.due_date || b.job_date || b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [treeData, selectedReportName, search]);

  const totalUnread = reports.reduce((acc, r) => acc + (r.unread_vessel || 0), 0);
  const reportsRemaining = reports.filter(r => r.verify_status === 'UNVERIFIED' && r.scrape_status === 'SCRAPED').length;

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

      <ReportsNavbar totalUnread={totalUnread} reportsRemaining={reportsRemaining} />
      
      <div className="rt-dashboard-body">
        {/* SUB-HEADER CONTROL BAR */}
        <div className="rt-control-bar">
          <div className="rt-control-left">
            <h2 className="rt-page-heading">Reports Dashboard</h2>
            <span style={{ fontSize: "0.75rem", color: "#64748b", display: 'flex', alignItems: 'center', gap: '6px', background: '#f1f5f9', padding: '4px 10px', borderRadius: '6px', fontWeight: 600 }}>
              <WifiOff size={12} /> Offline-First Mode
            </span>
          </div>
          
          <div className="rt-control-right">
            <div className="rt-search-box" style={{ width: 220, background: '#fff', border: '1px solid var(--rt-border)' }}>
              <Search size={14} />
              <input 
                type="text" 
                placeholder="Search jobs..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        </div>

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

            {displayFreqs.map(freq => {
              const reportNames = getSortedNames(freq.id);
              
              const isExpanded = expandedFreqs.includes(freq.id);
              
              return (
                <div key={freq.id} className={`rt-sidebar-group-card ${isExpanded ? 'expanded' : ''}`}>
                  <div 
                    className="rt-sidebar-group-header"
                    onClick={() => toggleFreq(freq.id)}
                  >
                    <div className="rt-sgh-left">
                      {freq.label}
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
                          const count = treeData[freq.id][name].length;
                          const isActive = selectedReportName === name;
                          return (
                            <div 
                              key={name} 
                              className={`rt-tree-leaf ${isActive ? 'active' : ''}`}
                              onClick={() => setSelectedReportName(name)}
                              onMouseEnter={(e) => handleTooltipEnter(e, name)}
                              onMouseLeave={handleTooltipLeave}
                            >
                              <span className="rt-tree-leaf-name">
                                {name}
                              </span>
                              <span className="rt-tree-badge">{count}</span>
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

          {/* DATA TABLE AREA */}
          <div className="rt-table-area">
            {selectedReportName && (
              <div className="rt-table-header">
                <div className="rt-table-title">{selectedReportName}</div>
                <div className="rt-table-subtitle">Job History • {tableData.length} records found</div>
              </div>
            )}

            {isLoading ? (
              <div className="rt-loading"><span className="rt-spinner"/></div>
            ) : isError ? (
              <div className="rt-loading" style={{ flexDirection: 'column', gap: '10px', color: '#dc2626' }}>
                <span>Couldn't load your reports ({error?.response?.status === 503 ? 'vessel assignment check failed' : 'server error'}). Please retry.</span>
                <button
                  onClick={() => refetch()}
                  style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', color: '#334155', fontWeight: 600, cursor: 'pointer' }}
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="rt-table-scroll">
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
                          No historical records found.
                        </td>
                      </tr>
                    ) : (
                      tableData.map((r, idx) => {
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
                             {r.job_order_no || r.report_code}
                          </td>
                          <td className="rt-col-date">{fmt(r.due_date)}</td>
                          <td className="rt-col-date">{fmt(r.next_due_date)}</td>
                          <td>
                            {isPending ? (
                              <span className={`rt-due-status-label ${isOverdue ? 'overdue' : 'planned'}`}>
                                {isOverdue ? '⚠ PENDING' : 'THIS WEEK'}
                              </span>
                            ) : (
                              r.job_status || '—'
                            )}
                          </td>
                          <td className="rt-col-date">{fmt(r.job_start_date)}</td>
                          <td className="rt-col-date">{fmt(r.job_end_date)}</td>
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
                      )})
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Collapsible Modal Viewer ── */}
          {modalOpen && selectedRow && (
            <ReportViewerModal
              report={selectedRow}
              role="VESSEL"
              focusPane={modalFocusPane}
              onClose={() => setModalOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
