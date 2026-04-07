import { useState, useEffect } from 'react'
import axiosJira from '../api/axiosJira'

function toUtcDate(isoStr) {
  if (!isoStr) return null
  // If no timezone info, treat as UTC (backend returns naive UTC strings)
  const s = /[Z+\-]\d*$/.test(isoStr.trim()) ? isoStr : isoStr + 'Z'
  return new Date(s)
}

function formatRelative(isoStr) {
  if (!isoStr) return '—'
  const diff = Date.now() - toUtcDate(isoStr).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function formatAbsolute(isoStr) {
  if (!isoStr) return '—'
  const d = toUtcDate(isoStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SyncLogPanel({ onClose }) {
  const [jiraStatus, setJiraStatus] = useState(null)
  const [jiraLoading, setJiraLoading] = useState(true)
  const [vessels, setVessels] = useState([])
  const [vesselLoading, setVesselLoading] = useState(true)
  const [vesselError, setVesselError] = useState(null)

  useEffect(() => {
    axiosJira.get('/api/jira/status')
      .then(r => setJiraStatus(r.data))
      .catch(() => setJiraStatus(null))
      .finally(() => setJiraLoading(false))

    axiosJira.get('/api/jira/vessel-sync-status')
      .then(r => setVessels(Array.isArray(r.data) ? r.data : []))
      .catch(() => setVesselError('Could not load vessel sync data.'))
      .finally(() => setVesselLoading(false))
  }, [])

  const pull = jiraStatus?.lastResult?.pull || {}
  const push = jiraStatus?.lastResult?.push || {}
  const mode = jiraStatus?.mode ? jiraStatus.mode.charAt(0) + jiraStatus.mode.slice(1).toLowerCase() : null

  return (
    <aside className="slp-panel slp-panel--open">
      {/* Header */}
      <div className="slp-header">
        <h2 className="slp-title">Sync Log</h2>
        <button className="slp-close" onClick={onClose} aria-label="Close sync log">
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Jira Sync Section ── */}
      <section className="slp-section">
        <p className="slp-section-title">Last Sync with Jira</p>
        {jiraLoading ? (
          <div className="slp-skeleton-row" style={{ height: 70 }} />
        ) : !jiraStatus?.lastSync ? (
          <p className="slp-empty">No sync has run since the server started.</p>
        ) : (
          <div className="slp-jira-card">
            <div className="slp-jira-top">
              <span className={`slp-mode-badge slp-mode-badge--${jiraStatus.mode?.toLowerCase()}`}>
                {mode}
              </span>
              <span className="slp-jira-time" title={formatAbsolute(jiraStatus.lastSync)}>
                {formatRelative(jiraStatus.lastSync)}
              </span>
            </div>
            <div className="slp-jira-stats">
              <div className="slp-stat-row">
                <span className="slp-stat-dir slp-stat-dir--push">↑ Push</span>
                <span className="slp-stat-val">
                  <strong>{push.pushed ?? 0}</strong> submitted
                  {push.failed > 0 && <span className="slp-stat-err"> · {push.failed} failed</span>}
                </span>
              </div>
              <div className="slp-stat-row">
                <span className="slp-stat-dir slp-stat-dir--pull">↓ Pull</span>
                <span className="slp-stat-val">
                  <strong>{pull.updated ?? 0}</strong> updated · <strong>{pull.created ?? 0}</strong> created
                  {pull.detailFetched > 0 && <span className="slp-stat-detail"> · {pull.detailFetched} detail-fetched</span>}
                </span>
              </div>
            </div>
            {jiraStatus.running && (
              <p className="slp-running">Sync is currently running…</p>
            )}
          </div>
        )}
      </section>

      <div className="slp-divider" />

      {/* ── Vessel Sync Section ── */}
      <section className="slp-section">
        <p className="slp-section-title">Last Shore ↔ Vessel Sync</p>
        {vesselLoading ? (
          <div className="slp-vessel-skeleton">
            {[1, 2, 3].map(i => <div key={i} className="slp-skeleton-row" />)}
          </div>
        ) : vesselError ? (
          <p className="slp-error">{vesselError}</p>
        ) : vessels.length === 0 ? (
          <p className="slp-empty">No vessels assigned to your account.</p>
        ) : (
          <div className="slp-vessel-table">
            <div className="slp-vessel-header-row">
              <span>Vessel</span>
              <span style={{ textAlign: 'right' }}>Sent to Vessel</span>
              <span style={{ textAlign: 'right' }}>Received from Vessel</span>
            </div>
            {vessels.map(v => (
              <div key={v.imo} className="slp-vessel-row">
                <div className="slp-vessel-name-cell">
                  <span className={`slp-sync-dot ${v.last_pull_at || v.last_push_at ? 'slp-sync-dot--ok' : 'slp-sync-dot--none'}`} />
                  <span className="slp-vessel-name" title={v.name}>{v.name}</span>
                </div>
                <span className="slp-vessel-time" title={formatAbsolute(v.last_pull_at)}>
                  {formatRelative(v.last_pull_at)}
                </span>
                <span className="slp-vessel-time" title={formatAbsolute(v.last_push_at)}>
                  {formatRelative(v.last_push_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  )
}
