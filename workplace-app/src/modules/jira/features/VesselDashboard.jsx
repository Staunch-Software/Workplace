// VesselDashboard.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import JiraHeader from '../components/JiraHeader'
import { StatusBadge, PriorityBadge } from '../components/StatusBadge'
import axiosJira from '../api/axiosJira'
import '../styles/VesselDashboard.css'

export default function VesselDashboard() {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('open')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 })

  const fetchTickets = async () => {
    setLoading(true)
    try {
      const res = await axiosJira.get('/api/tickets', { params: { status, page, limit: 10 } })
      setTickets(res.data.tickets)
      setPagination(res.data.pagination)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTickets() }, [status, page])

  return (
    <div className="vd-page">
     <JiraHeader />

      <main className="vd-main">

        {/* Header */}
        <div className="vd-topbar">
          <div>
            <h1 className="vd-topbar-title">My Requests</h1>
            <p className="vd-topbar-sub">Track and manage your vessel's support tickets</p>
          </div>
          <button onClick={() => navigate('/jira/vessel/create')} className="vd-raise-btn">
            <svg className="vd-raise-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            Raise Ticket
          </button>
        </div>

        {/* Tabs */}
        <div className="vd-tabs">
          {[
            { key: 'open',   label: 'Open Requests' },
            { key: 'closed', label: 'Closed Requests' },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => { setStatus(tab.key); setPage(1) }}
              className={`vd-tab ${status === tab.key ? 'vd-tab--active' : 'vd-tab--inactive'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table card */}
        <div className="vd-card">
          <div className="vd-table-scroll">
            <table className="vd-table">
              <thead>
                <tr>
                  {['Reference', 'Summary', 'Priority', 'Status', 'Module'].map(h => (
                    <th key={h} className="vd-th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(8)].map((_, i) => (
                    <tr key={i}>
                      {[28, '70%', 60, 80, 60].map((w, j) => (
                        <td key={j} className="vd-td">
                          <div
                            className="vd-skeleton-cell"
                            style={{ width: typeof w === 'number' ? w : w }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : tickets.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="vd-td">
                      <div className="vd-empty">
                        <svg className="vd-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="vd-empty-text">No tickets found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  tickets.map(t => (
                    <tr key={t.id} onClick={() => navigate(`/jira/vessel/tickets/${t.id}`)}>
                      <td className="vd-td">
                        {t.reference ? (
                          <span className="vd-ref">{t.reference}</span>
                        ) : (
                          <span className="vd-ref-pending">
                            <span className="vd-pending-dot" />
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="vd-td">
                        <span className="vd-summary">{t.summary}</span>
                      </td>
                      <td className="vd-td">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="vd-td">
                        <StatusBadge status={t.jiraStatus || t.status || t.jiraSubmissionStatus} />
                      </td>
                      <td className="vd-td">
                        <span className="vd-module">{t.module}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination.total > 0 && (
            <div className="vd-pagination">
              <p className="vd-pagination-info">
                Showing{' '}
                <strong>{(page - 1) * pagination.limit + 1}–{Math.min(page * pagination.limit, pagination.total)}</strong>
                {' '}of <strong>{pagination.total}</strong> tickets
              </p>
              <div className="vd-pagination-btns">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="vd-page-btn"
                >
                  ← Previous
                </button>
                <button
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="vd-page-btn"
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