import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import JiraHeader from '../components/JiraHeader'
import axiosJira from '../api/axiosJira'
import '../styles/ShoreDashboard.css'

// ── Status config ────────────────────────────────────────────────────────────
const STATUS_CLASS = {
  'Sup In Progress':               'sd-badge--sup-in-progress',
  'Dev In Progress':               'sd-badge--dev-in-progress',
  'Waiting for Customer':          'sd-badge--waiting-customer',
  'Waiting for Support':           'sd-badge--waiting-support',
  'In Progress':                   'sd-badge--in-progress',
  'Pending':                       'sd-badge--pending',
  'FSD TO REVIEW':                 'sd-badge--fsd-review',
  'FSD APPROVED':                  'sd-badge--fsd-approved',
  'FSD  IN PROGRESS':              'sd-badge--fsd-in-progress',
  'READY FOR UAT':                 'sd-badge--ready-uat',
  'UAT IN PROGRESS':               'sd-badge--uat-in-progress',
  'QA IN PROGRESS':                'sd-badge--qa-in-progress',
  'CR Approved':                   'sd-badge--cr-approved',
  'Ready for Production':          'sd-badge--ready-production',
  'RELEASE TO PRODUCTION':         'sd-badge--release-production',
  'Awaiting Release':              'sd-badge--awaiting-release',
  'Resolved':                      'sd-badge--resolved',
  'Resolved Awaiting Confirmation':'sd-badge--resolved-awaiting',
  'Cancelled':                     'sd-badge--cancelled',
  'Closed':                        'sd-badge--closed',
  'SUP IN PROGRESS':               'sd-badge--sup-in-progress',
}

const PRIORITY_CONFIG = {
  Critical: { icon: '▲▲', cls: 'sd-priority-icon--critical', label: 'Severity 1 - Critical' },
  Major:    { icon: '▲',  cls: 'sd-priority-icon--major',    label: 'Severity 2 - Major' },
  Minor:    { icon: '—',  cls: 'sd-priority-icon--minor',    label: 'Severity 3 - Minor' },
}

// ── Sub-components ───────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cls = STATUS_CLASS[status] || 'sd-badge--default'
  return (
    <span className={`sd-badge ${cls}`}>
      <span className="sd-badge-dot" />
      {status}
    </span>
  )
}

function PriorityCell({ priority }) {
  const cfg = PRIORITY_CONFIG[priority]
  if (!cfg) return <span className="sd-priority-empty">—</span>
  return (
    <div className="sd-priority">
      <span className={`sd-priority-icon ${cfg.cls}`}>{cfg.icon}</span>
      <span className="sd-priority-label">{cfg.label}</span>
    </div>
  )
}

function TypeIcon({ requestType }) {
  if (!requestType) return <span style={{ width: 28, height: 28, display: 'inline-block' }} />
  const t = requestType.toLowerCase()
  const isEmail = t.includes('email')
  const isBug   = t.includes('bug') || t.includes('error')
  const isTask  = t.includes('task')

  let variant = 'default'
  if (isEmail) variant = 'email'
  else if (isBug) variant = 'bug'
  else if (isTask) variant = 'task'

  return (
    <span title={requestType} className={`sd-type-icon sd-type-icon--${variant}`}>
      {isEmail ? (
        <svg fill="currentColor" viewBox="0 0 24 24">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
      ) : isBug ? (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ) : isTask ? (
        <svg fill="currentColor" viewBox="0 0 24 24">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
      ) : (
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )}
    </span>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function ShoreDashboard() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState([])
  const [vessels, setVessels] = useState([])
  const [pagination, setPagination] = useState({ page: 1, limit: 15, total: 0, totalPages: 0 })
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)

  const [vesselName, setVesselName] = useState('all')
  const [statusMode, setStatusMode] = useState('open')
  const [selectedStatuses, setSelectedStatuses] = useState(new Set())
  const [priority, setPriority] = useState('all')
  const [search, setSearch] = useState('')
  const [searchDebounce, setSearchDebounce] = useState('')
  const [sortBy, setSortBy] = useState('updatedAt')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const statusMenuRef = useRef(null)

  useEffect(() => {
    if (!showStatusMenu) return
    const handler = (e) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target)) {
        setShowStatusMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showStatusMenu])

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounce(search), 400)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    axiosJira.get('/api/vessels').then(r => setVessels(r.data)).catch(console.error)
  }, [])

  const fetchTickets = useCallback(async (page = 1) => {
    setLoading(true)
    setCurrentPage(page)
    try {
      const params = { page, limit: 15, vesselName, priority, search: searchDebounce, sortBy, sortOrder }
      if (params.vesselName === 'all') delete params.vesselName
      if (params.priority === 'all') delete params.priority
      if (!params.search) delete params.search

      if (statusMode === 'open') params.status = 'open'
      else if (statusMode === 'closed') params.status = 'closed'
      else if (statusMode === 'custom' && selectedStatuses.size > 0) {
        params.status = 'all'
        params.statusList = [...selectedStatuses].join(',')
      }

      const res = await axiosJira.get('/api/tickets', { params })
      setTickets(res.data.tickets)
      setPagination(res.data.pagination)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [vesselName, statusMode, selectedStatuses, priority, searchDebounce, sortBy, sortOrder])

  useEffect(() => { fetchTickets(1) }, [fetchTickets])

  const handleSort = (field) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('desc') }
  }

  const handleSync = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const res = await axiosJira.post('/api/jira/sync')
      setSyncResult({ ...res.data, mode: 'incremental' })
      await fetchTickets(1)
    } catch { alert('Sync failed.') }
    finally { setSyncing(false) }
  }

  const handleFullSync = async () => {
    if (!window.confirm(
      'Run FULL sync?\n\nThis fetches all 300+ ticket details from Jira.\nEstimated time: 20–45 minutes.\n\nThe sync runs in the background — you can keep using the app.\nClick OK to start.'
    )) return
    setSyncing(true); setSyncResult(null)
    try {
      const res = await axiosJira.post('/api/jira/full-sync')
      setSyncResult({ ...res.data, mode: 'full', started: true })
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axiosJira.get('/api/jira/status')
          if (!statusRes.data.running) {
            clearInterval(pollInterval)
            await fetchTickets(1)
            setSyncResult(prev => prev ? { ...prev, done: true } : prev)
          }
        } catch { clearInterval(pollInterval) }
      }, 30000)
    } catch { alert('Full sync failed to start.') }
    finally { setSyncing(false) }
  }

  const handleExport = async () => {
    const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token')
    const params = new URLSearchParams({
      vesselName, priority, search: searchDebounce,
      ...(statusMode === 'open'   ? { status: 'open' }   : {}),
      ...(statusMode === 'closed' ? { status: 'closed' } : {}),
    })
    const res = await fetch(`http://localhost:8004/api/export?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tickets-${vesselName !== 'all' ? vesselName.replace(/\s+/g, '-') : 'all'}-${new Date().toISOString().split('T')[0]}.xlsx`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const formatDate = (d) => {
    if (!d) return '—'
    const date = new Date(d)
    if (isNaN(date.getTime())) return typeof d === 'string' ? d : '—'
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
  }

  const SortIcon = ({ field }) => (
    <span className={`sd-sort-icon ${sortBy === field ? 'sd-sort-icon--active' : ''}`}>
      {sortBy !== field ? '↕' : sortOrder === 'asc' ? '↑' : '↓'}
    </span>
  )

  const pageNums = Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === pagination.totalPages || Math.abs(p - currentPage) <= 2)

  const ALL_STATUSES = [
    'Sup In Progress', 'Dev In Progress', 'In Progress',
    'Waiting for Customer', 'Pending',
    'FSD TO REVIEW', 'FSD APPROVED', 'FSD  IN PROGRESS',
    'READY FOR UAT', 'UAT IN PROGRESS', 'QA IN PROGRESS',
    'CR Approved', 'Ready for Production', 'RELEASE TO PRODUCTION', 'Awaiting Release',
    'Resolved Awaiting Confirmation', 'Resolved', 'Cancelled', 'Closed',
  ]

  const statusLabel = statusMode === 'open'   ? 'Open requests'
    : statusMode === 'closed' ? 'Closed requests'
    : statusMode === 'all'    ? 'All statuses'
    : `${selectedStatuses.size} selected`

  const toggleStatus = (s) => {
    setSelectedStatuses(prev => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s); else next.add(s)
      return next
    })
    setStatusMode('custom')
  }

  const isFullBanner = syncResult?.mode === 'full' && syncResult?.started

  return (
    <div className="sd-page">
      <JiraHeader />

      <main className="sd-main">

        {/* Top bar */}
        <div className="sd-topbar">
          <div>
            <p className="sd-topbar-label">Help Center</p>
            <h1 className="sd-topbar-title">Requests</h1>
          </div>
          <div className="sd-topbar-actions">
            <button onClick={() => fetchTickets(currentPage)} className="sd-btn">
              <svg className="sd-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button onClick={handleExport} className="sd-btn">
              <svg className="sd-btn-icon sd-btn-icon--green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export
            </button>
            <button onClick={handleSync} disabled={syncing} className="sd-btn-sync">
              {syncing ? (
                <>
                  <span className="sd-spinner" />
                  Syncing...
                </>
              ) : (
                <>
                  <svg className="sd-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Sync with Jira
                </>
              )}
            </button>
            <button
              onClick={handleFullSync}
              disabled={syncing}
              title="Fetch ALL ticket details (run once to populate old tickets)"
              className="sd-btn-fullsync"
            >
              <svg className="sd-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Full Sync
            </button>
          </div>
        </div>

        {/* Sync result banner */}
        {syncResult && (
          <div className={`sd-banner ${isFullBanner ? 'sd-banner--warning' : 'sd-banner--success'}`}>
            <div className="sd-banner-content">
              <svg className={`sd-banner-icon ${isFullBanner ? 'sd-banner-icon--warning' : 'sd-banner-icon--success'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {isFullBanner ? (
                <span className={`sd-banner-text--warning`}>
                  {syncResult.done
                    ? 'Full sync complete — ticket list refreshed.'
                    : 'Full sync started in background — fetching all ticket details (~20–45 min). Keep using the app normally.'}
                </span>
              ) : (
                <>
                  <span className="sd-banner-text--success">Sync complete —</span>
                  <span className="sd-banner-sub">
                    {syncResult.totalScraped || 0} scraped, <strong>{syncResult.updated || 0}</strong> updated, <strong>{syncResult.created || 0}</strong> created
                  </span>
                  {syncResult.errors?.length > 0 && (
                    <span className="sd-banner-errors">({syncResult.errors.length} warnings)</span>
                  )}
                </>
              )}
            </div>
            <button
              onClick={() => setSyncResult(null)}
              className={`sd-banner-close ${isFullBanner ? 'sd-banner-close--warning' : 'sd-banner-close--success'}`}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="sd-filters">
          {/* Search */}
          <div className="sd-search-wrap">
            <svg className="sd-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Request contains..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="sd-search-input"
            />
          </div>

          {/* Status multi-select */}
          <div className="sd-status-wrap" ref={statusMenuRef}>
            <button onClick={() => setShowStatusMenu(v => !v)} className="sd-status-btn">
              <span className="sd-status-dot" />
              Status: {statusLabel}
              <svg className={`sd-chevron ${showStatusMenu ? 'sd-chevron--open' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showStatusMenu && (
              <div className="sd-status-menu">
                <div className="sd-status-presets">
                  {[
                    { key: 'open',   label: 'Open' },
                    { key: 'closed', label: 'Closed' },
                    { key: 'all',    label: 'All' },
                  ].map(p => (
                    <button
                      key={p.key}
                      onClick={() => { setStatusMode(p.key); setSelectedStatuses(new Set()); setShowStatusMenu(false) }}
                      className={`sd-preset-btn ${statusMode === p.key && selectedStatuses.size === 0 ? 'sd-preset-btn--active' : ''}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="sd-status-list-label">Or pick specific statuses:</p>
                <div className="sd-status-list">
                  {ALL_STATUSES.map(s => (
                    <label key={s} className="sd-status-item">
                      <input
                        type="checkbox"
                        checked={selectedStatuses.has(s)}
                        onChange={() => toggleStatus(s)}
                      />
                      <span className="sd-status-item-label">{s}</span>
                    </label>
                  ))}
                </div>
                {selectedStatuses.size > 0 && (
                  <div className="sd-status-footer">
                    <span className="sd-status-count">{selectedStatuses.size} selected</span>
                    <button
                      onClick={() => { setSelectedStatuses(new Set()); setStatusMode('open'); setShowStatusMenu(false) }}
                      className="sd-status-clear"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Vessel */}
          <select value={vesselName} onChange={e => setVesselName(e.target.value)} className="sd-select">
            <option value="all">All Vessels</option>
            {vessels.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>

          {/* Priority */}
          <select value={priority} onChange={e => setPriority(e.target.value)} className="sd-select">
            <option value="all">All Priorities</option>
            <option value="Critical">Critical</option>
            <option value="Major">Major</option>
            <option value="Minor">Minor</option>
          </select>

          {!loading && (
            <span className="sd-ticket-count">
              {pagination.total.toLocaleString()} tickets
            </span>
          )}
        </div>

        {/* Table */}
        <div className="sd-table-card">
          <div className="sd-table-scroll">
            <table className="sd-table">
              <thead>
                <tr>
                  <th className="sd-th sd-th--type">Type</th>
                  <th className="sd-th sd-th--sortable" onClick={() => handleSort('reference')}>
                    Reference <SortIcon field="reference" />
                  </th>
                  <th className="sd-th">Summary</th>
                  <th className="sd-th">Status</th>
                  <th className="sd-th">Vessel</th>
                  <th className="sd-th sd-th--sortable" onClick={() => handleSort('requester')}>
                    Requester <SortIcon field="requester" />
                  </th>
                  <th className="sd-th sd-th--sortable" onClick={() => handleSort('createdAt')}>
                    Created <SortIcon field="createdAt" />
                  </th>
                  <th className="sd-th sd-th--sortable" onClick={() => handleSort('updatedAt')}>
                    Updated <SortIcon field="updatedAt" />
                  </th>
                  <th className="sd-th sd-th--sortable" onClick={() => handleSort('priority')}>
                    Priority <SortIcon field="priority" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(9)].map((_, j) => (
                        <td key={j} className="sd-td">
                          <div
                            className="sd-skeleton-cell"
                            style={{ width: j === 2 ? '80%' : j === 0 ? '28px' : '60%' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="sd-td">
                      <div className="sd-empty">
                        <div className="sd-empty-inner">
                          <svg className="sd-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <p className="sd-empty-text">No tickets match your filters</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  tickets.map(ticket => (
                    <tr key={ticket.id} onClick={() => navigate(`/jira/shore/tickets/${ticket.id}`)}>
                      <td className="sd-td"><TypeIcon requestType={ticket.requestType} /></td>
                      <td className="sd-td">
                        {ticket.reference ? (
                          <span className="sd-ref">{ticket.reference}</span>
                        ) : (
                          <span className="sd-ref-pending">
                            <span className="sd-pending-dot" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="sd-td">
                        <span className="sd-summary">{ticket.summary}</span>
                      </td>
                      <td className="sd-td">
                        <StatusBadge status={ticket.jiraStatus || ticket.status} />
                      </td>
                      <td className="sd-td">
                        <span className="sd-vessel">
                          {ticket.vesselName || <span className="sd-vessel-empty">—</span>}
                        </span>
                      </td>
                      <td className="sd-td"><span className="sd-requester">{ticket.requester}</span></td>
                      <td className="sd-td"><span className="sd-date">{formatDate(ticket.jiraCreatedAt || ticket.createdAt)}</span></td>
                      <td className="sd-td"><span className="sd-date">{formatDate(ticket.jiraUpdatedAt || ticket.updatedAt)}</span></td>
                      <td className="sd-td"><PriorityCell priority={ticket.priority} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.total > 0 && (
            <div className="sd-pagination">
              <p className="sd-pagination-info">
                Showing{' '}
                <strong>{(currentPage - 1) * pagination.limit + 1}–{Math.min(currentPage * pagination.limit, pagination.total)}</strong>
                {' '}of <strong>{pagination.total}</strong> tickets
              </p>
              <div className="sd-pagination-pages">
                <button
                  onClick={() => fetchTickets(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="sd-page-btn"
                >
                  ← Previous
                </button>
                {pageNums.map((p, i) => {
                  const prev = pageNums[i - 1]
                  const showEllipsis = prev && p - prev > 1
                  return (
                    <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {showEllipsis && <span className="sd-ellipsis">…</span>}
                      <button
                        onClick={() => fetchTickets(p)}
                        className={`sd-page-num ${p === currentPage ? 'sd-page-num--active' : ''}`}
                      >
                        {p}
                      </button>
                    </span>
                  )
                })}
                <button
                  onClick={() => fetchTickets(currentPage + 1)}
                  disabled={currentPage >= pagination.totalPages}
                  className="sd-page-btn"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}