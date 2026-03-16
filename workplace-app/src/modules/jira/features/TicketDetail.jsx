// TicketDetail.jsx

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import JiraHeader from '../components/JiraHeader'
import { useAuth } from '@/context/AuthContext'
import axiosJira from '../api/axiosJira'
import '../styles/TicketDetail.css'

// ── Config ───────────────────────────────────────────────────────────────────
const STATUS_CLASS = {
  'Sup In Progress':                'td-badge--sup-in-progress',
  'Dev In Progress':                'td-badge--dev-in-progress',
  'Waiting for Customer':           'td-badge--waiting-customer',
  'In Progress':                    'td-badge--in-progress',
  'Pending':                        'td-badge--pending',
  'FSD TO REVIEW':                  'td-badge--fsd-review',
  'FSD APPROVED':                   'td-badge--fsd-approved',
  'READY FOR UAT':                  'td-badge--ready-uat',
  'UAT IN PROGRESS':                'td-badge--uat-in-progress',
  'Resolved':                       'td-badge--resolved',
  'Resolved Awaiting Confirmation': 'td-badge--resolved-awaiting',
  'Cancelled':                      'td-badge--cancelled',
  'Closed':                         'td-badge--closed',
  'SUP IN PROGRESS':                'td-badge--sup-in-progress',
}

const STATUS_TRANSITIONS = {
  shore:  ['Resolved', 'Cancelled'],
  vessel: ['Resolved'],
}

const TRANSITION_CLS = {
  'Resolved':  { btnCls: 'td-action-btn--resolved',  icon: '✓', desc: 'Mark this ticket as resolved' },
  'Cancelled': { btnCls: 'td-action-btn--cancelled', icon: '✕', desc: 'Cancel this ticket' },
}

const PRIORITY_CONFIG = {
  Critical: { label: 'Severity 1 - Critical', badgeCls: 'td-priority-badge--Critical', icon: '▲▲' },
  Major:    { label: 'Severity 2 - Major',    badgeCls: 'td-priority-badge--Major',    icon: '▲' },
  Minor:    { label: 'Severity 3 - Minor',    badgeCls: 'td-priority-badge--Minor',    icon: '—' },
}

const AVATAR_COLORS = [
  'td-avatar--blue', 'td-avatar--violet', 'td-avatar--emerald', 'td-avatar--orange',
  'td-avatar--teal', 'td-avatar--pink',   'td-avatar--indigo',  'td-avatar--rose',
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function avatarColor(name) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

function formatDateTime(d) {
  if (!d) return '—'
  const normalized = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d) && !d.endsWith('Z') && !d.includes('+')
    ? d + 'Z' : d
  const date = new Date(normalized)
  if (isNaN(date.getTime())) return typeof d === 'string' ? d : '—'
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    month: 'short', day: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function formatDateShort(d) {
  if (!d) return '—'
  const normalized = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(d) && !d.endsWith('Z') && !d.includes('+')
    ? d + 'Z' : d
  const date = new Date(normalized)
  if (isNaN(date.getTime())) return typeof d === 'string' ? d : '—'
  return date.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Avatar({ name, size = 'md' }) {
  return (
    <div className={`td-avatar td-avatar--${size} ${avatarColor(name || '?')}`}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  )
}

function StatusBadge({ status }) {
  const cls = STATUS_CLASS[status] || 'td-badge--default'
  return (
    <span className={`td-badge ${cls}`}>
      <span className="td-badge-dot" />
      {status}
    </span>
  )
}

function jiraImgUrl(src) {
  if (!src) return ''
  if (src.startsWith('/api/') || src.startsWith('data:') || src.startsWith('blob:')) return src
  if (src.includes('atlassian.net')) return `/api/jira/image-proxy?url=${encodeURIComponent(src)}`
  if (
    src.startsWith('/secure/') || src.startsWith('/rest/') || src.startsWith('/wiki/') ||
    src.includes('/attachment') || src.includes('/secure')
  ) {
    const absolute = src.startsWith('http') ? src : `https://mariapps.atlassian.net${src}`
    return `/api/jira/image-proxy?url=${encodeURIComponent(absolute)}`
  }
  return src
}

function isPdfAttachment(att) {
  if (!att) return false
  const filename = (att.filename || '').toLowerCase()
  const mime = (att.mimeType || '').toLowerCase()
  return filename.endsWith('.pdf') || mime.includes('pdf')
}

function isVideoAttachment(att) {
  if (!att) return false
  const filename = (att.filename || '').toLowerCase()
  const mime = (att.mimeType || '').toLowerCase()
  return (
    filename.endsWith('.mp4') || filename.endsWith('.mov') ||
    filename.endsWith('.webm') || filename.endsWith('.avi') ||
    mime.includes('video')
  )
}

function VideoThumb() {
  return (
    <div className="td-video-thumb">
      <svg className="td-video-play-icon" fill="currentColor" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  )
}

function SafeImage({ src, alt, className, placeholderFilename }) {
  const [broken, setBroken] = useState(false)

  if (broken) {
    return (
      <div className="td-img-broken">
        <svg className="td-img-broken-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        {placeholderFilename && (
          <p className="td-img-broken-name">{placeholderFilename}</p>
        )}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt || 'Attachment'}
      className={className}
      onError={(e) => {
        e.target.onerror = null
        setBroken(true)
      }}
    />
  )
}

function MediaLightbox({ src, alt, isVideo, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const proxied = jiraImgUrl(src)

  return (
    <div className="td-lightbox" onClick={onClose}>
      <div className="td-lightbox-inner" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="td-lightbox-close">
          <svg className="td-lightbox-close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Close (Esc)
        </button>
        {isVideo ? (
          <video src={proxied} controls autoPlay className="td-lightbox-video">
            Your browser does not support video playback.
          </video>
        ) : (
          <SafeImage
            src={proxied}
            alt={alt}
            className="td-lightbox-img"
            placeholderFilename={alt}
          />
        )}
        {alt && <p className="td-lightbox-caption">{alt}</p>}
      </div>
    </div>
  )
}

function CommentImages({ images }) {
  const [lightbox, setLightbox] = useState(null)
  if (!images || images.length === 0) return null

  return (
    <>
      <div className="td-comment-images">
        {images.map((img, i) => {
          const isVideo = isVideoAttachment(img)
          const isPdf   = isPdfAttachment(img)

          if (isPdf) {
            return (
              <a
                key={i}
                href={jiraImgUrl(img.src)}
                target="_blank"
                rel="noopener noreferrer"
                className="td-pdf-link"
                title={img.filename || img.alt || 'PDF Document'}
              >
                <svg className="td-pdf-icon" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5z"/>
                </svg>
                <span className="td-pdf-name">{img.filename || img.alt || 'PDF'}</span>
              </a>
            )
          }

          return (
            <button
              key={i}
              onClick={() => setLightbox({ ...img, isVideo })}
              className="td-img-btn"
              title={img.filename || img.alt || (isVideo ? 'Play video' : 'View image')}
            >
              <div className="td-img-thumb-wrap">
                {isVideo ? (
                  <VideoThumb />
                ) : (
                  <SafeImage
                    src={jiraImgUrl(img.src)}
                    alt={img.alt || img.filename || 'Attachment'}
                    className="td-img-thumb"
                    placeholderFilename={img.filename}
                  />
                )}
              </div>
              <div className="td-img-overlay">
                <svg className="td-img-overlay-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                </svg>
              </div>
              {img.filename && (
                <p className="td-img-filename">{img.filename}</p>
              )}
            </button>
          )
        })}
      </div>
      {lightbox && (
        <MediaLightbox
          src={lightbox.src}
          alt={lightbox.filename || lightbox.alt}
          isVideo={lightbox.isVideo}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}

function AttachmentsPanel({ attachments }) {
  const [lightbox, setLightbox] = useState(null)

  if (!attachments || attachments.length === 0) {
    return (
      <div className="td-attach-empty">
        <svg className="td-attach-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
        </svg>
        <p className="td-attach-empty-text">No attachments</p>
        <p className="td-attach-empty-sub">Synced from Jira on next pull</p>
      </div>
    )
  }

  return (
    <>
      <div className="td-attach-list">
        {attachments.map((att, i) => {
          const isVideo    = isVideoAttachment(att)
          const isPdf      = isPdfAttachment(att)
          const proxiedSrc = jiraImgUrl(att.src)

          if (isPdf) {
            return (
              <a
                key={i}
                href={proxiedSrc}
                target="_blank"
                rel="noopener noreferrer"
                className="td-attach-item"
              >
                <div className="td-attach-thumb td-attach-thumb--pdf">
                  <svg style={{ width: 20, height: 20, color: '#ef4444' }} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8.5 17.5c-.3 0-.5-.1-.7-.3-.2-.2-.3-.5-.3-.8 0-.6.4-1.3 1.1-2-.3.8-.5 1.5-.5 2.1 0 .3.1.5.4 1zm5.1-1.2c-.4.2-.9.4-1.4.5.2-.5.4-1 .4-1.5 0-.4-.1-.7-.4-.9-.2-.2-.5-.3-.8-.3-.6 0-1.1.3-1.5.7-.3.4-.5.9-.5 1.5 0 .5.1.9.4 1.2.3.3.7.5 1.2.5.3 0 .6-.1.9-.2-.3.4-.6.7-1 .9-.5.2-1 .3-1.5.3-.7 0-1.3-.2-1.7-.7-.4-.4-.6-1-.6-1.8 0-1.1.5-2.3 1.4-3.3 1-1.1 2.1-1.7 3.2-1.7.5 0 .9.1 1.2.4.3.3.5.6.5 1.1 0 .8-.5 1.6-1.4 2.3z"/>
                  </svg>
                </div>
                <div className="td-attach-info">
                  <p className="td-attach-name">{att.filename || att.alt || 'PDF Document'}</p>
                  <p className="td-attach-hint">Click to open PDF</p>
                </div>
                <svg className="td-attach-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )
          }

          return (
            <button
              key={i}
              onClick={() => setLightbox({ ...att, isVideo })}
              className="td-attach-item"
            >
              <div className="td-attach-thumb">
                {isVideo ? (
                  <VideoThumb />
                ) : (
                  <SafeImage
                    src={jiraImgUrl(att.src)}
                    alt={att.alt || att.filename}
                    className="td-attach-thumb-img"
                    placeholderFilename={att.filename}
                  />
                )}
              </div>
              <div className="td-attach-info">
                <p className="td-attach-name">{att.filename || att.alt || (isVideo ? 'Video' : 'Attachment')}</p>
                <p className="td-attach-hint">{isVideo ? 'Click to play' : 'Click to view'}</p>
              </div>
              <svg className="td-attach-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
          )
        })}
      </div>
      {lightbox && (
        <MediaLightbox
          src={lightbox.src}
          alt={lightbox.filename || lightbox.alt}
          isVideo={lightbox.isVideo}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isVessel = user?.role === 'VESSEL'

  const [ticket, setTicket] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [statusChanging, setStatusChanging] = useState(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    axiosJira.get(`/api/tickets/${id}`)
      .then(r => { setTicket(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  const handleAddComment = async (e) => {
    e.preventDefault()
    if (!comment.trim()) return
    setSubmitting(true)
    try {
      const res = await axiosJira.post(`/api/tickets/${id}/comments`, { message: comment })
      setTicket(res.data)
      setComment('')
    } catch (err) { console.error(err) }
    finally { setSubmitting(false) }
  }

  const handleStatusChange = async (newStatus) => {
    setStatusChanging(newStatus)
    try {
      const res = await axiosJira.patch(`/api/tickets/${id}/status`, { status: newStatus })
      setTicket(res.data)
    } catch (err) { console.error(err) }
    finally { setStatusChanging(null) }
  }

  if (loading) {
    return (
      <div className="td-skeleton-wrap">
        {isVessel ? <JiraHeader /> : <JiraHeader />}
        <div className="td-skeleton-inner">
          <div className="td-skeleton-grid">
            <div className="td-skeleton-main">
              {[200, 400, 300].map(h => (
                <div key={h} className="td-skeleton-block" style={{ height: h }} />
              ))}
            </div>
            <div className="td-skeleton-side">
              {[80, 80, 120, 80].map(h => (
                <div key={h} className="td-skeleton-block" style={{ height: h }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!ticket) {
    const backPath = isVessel ? '/jira/vessel/dashboard' : '/jira/shore/dashboard'
    return (
      <div className="td-notfound-wrap">
        {isVessel ? <JiraHeader /> : <JiraHeader />}
        <div className="td-notfound-inner">
          <svg className="td-notfound-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h2 className="td-notfound-title">Ticket not found</h2>
          <button onClick={() => navigate(backPath)} className="td-notfound-back">
            ← Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  const currentStatus = ticket.jiraStatus || ticket.status
  const isClosed = ['Closed', 'Cancelled', 'Resolved', 'Resolved Awaiting Confirmation'].includes(currentStatus)
  const transitions = isClosed ? [] : (isVessel ? STATUS_TRANSITIONS.vessel : STATUS_TRANSITIONS.shore)
  const priorityCfg = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.Minor
  const backPath = isVessel ? '/jira/vessel/dashboard' : '/jira/shore/dashboard'

  const totalImages = (ticket.comments || []).reduce((sum, c) => sum + ((c.images || []).length), 0)
  const ticketAttachments = ticket.attachments || []

  return (
    <div className="td-page">
      {isVessel ? <JiraHeader /> : <JiraHeader />}

      <main className="td-main">

        <nav className="td-nav">
          <button onClick={() => navigate(backPath)} className="td-nav-link">Help Center</button>
          <span className="td-nav-sep">/</span>
          <span className="td-nav-link" style={{ cursor: 'default' }}>Ozellar – MA Ticketing Portal</span>
          <span className="td-nav-sep">/</span>
          <span className="td-nav-current">{ticket.reference || 'Pending Reference'}</span>
        </nav>

        <h1 className="td-title">{ticket.summary}</h1>

        <div className="td-grid">

          {/* ── LEFT: Main content ── */}
          <div className="td-col-main">

            {/* Requester + description card */}
            <div className="td-card">
              <div className="td-ticket-header">
                <div className="td-requester-row">
                  <Avatar name={ticket.requester || 'User'} size="md" />
                  <div className="td-requester-meta">
                    <span className="td-requester-name">{ticket.requester}</span>
                    <span className="td-requester-sep"> raised this on </span>
                    <span className="td-requester-date">{formatDateTime(ticket.jiraCreatedAt || ticket.createdAt)}</span>
                  </div>
                </div>
                <button onClick={() => setShowDetails(d => !d)} className="td-toggle-btn">
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
              </div>

              {showDetails && (
                <div className="td-details-grid">
                  <div>
                    <p className="td-detail-label">Vessel</p>
                    <p className="td-detail-value">{ticket.vesselName || '—'}</p>
                  </div>
                  <div>
                    <p className="td-detail-label">Module</p>
                    <p className="td-detail-value--plain">{ticket.module}</p>
                  </div>
                  <div>
                    <p className="td-detail-label">Environment</p>
                    <p className="td-detail-value--plain">{ticket.environment}</p>
                  </div>
                  <div>
                    <p className="td-detail-label">Priority</p>
                    <span className={`td-priority-badge ${priorityCfg.badgeCls}`}>
                      {priorityCfg.icon} {priorityCfg.label}
                    </span>
                  </div>
                  <div>
                    <p className="td-detail-label">Request Type</p>
                    <p className="td-detail-value--plain">{ticket.requestType || '—'}</p>
                  </div>
                  <div>
                    <p className="td-detail-label">Created</p>
                    <p className="td-detail-value--plain">{formatDateShort(ticket.jiraCreatedAt || ticket.createdAt)}</p>
                  </div>
                </div>
              )}

              <div className="td-description">
                {ticket.description ? (
                  <p className="td-description-text">{ticket.description}</p>
                ) : (
                  <p className="td-description-empty">No description provided.</p>
                )}
              </div>
            </div>

            {/* Activity / Comments */}
            <div className="td-card">
              <div className="td-activity-header">
                <h3 className="td-activity-title">Activity</h3>
                {ticket.comments && ticket.comments.length > 0 && (
                  <span className="td-activity-count">
                    ({ticket.comments.length} {ticket.comments.length === 1 ? 'comment' : 'comments'}
                    {totalImages > 0 && `, ${totalImages} image${totalImages > 1 ? 's' : ''}`})
                  </span>
                )}
              </div>

              <div className="td-comments-list">
                {!ticket.comments || ticket.comments.length === 0 ? (
                  <div className="td-empty-comments">
                    <svg className="td-empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="td-empty-text">No activity yet.</p>
                  </div>
                ) : (
                  ticket.comments.map((c, idx) => (
                    <div key={c.id || c._id || idx} className="td-comment-row">
                      <Avatar name={c.author || 'User'} size="md" />
                      <div className="td-comment-body">
                        <div className="td-comment-meta">
                          <span className="td-comment-author">{c.author}</span>
                          <span className="td-comment-time">{formatDateTime(c.createdAt)}</span>
                          {c.source === 'portal' && (
                            <span className="td-comment-source-badge">Portal</span>
                          )}
                        </div>
                        <p className="td-comment-text">{c.message}</p>
                        <CommentImages images={c.images} />
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="td-comment-form-wrap">
                <form onSubmit={handleAddComment} className="td-comment-form">
                  <Avatar name={user?.full_name || user?.email || 'You'} size="md" />
                  <div className="td-comment-input-wrap">
                    <textarea
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Add a comment..."
                      rows={3}
                      className="td-comment-textarea"
                    />
                    <div className="td-comment-actions">
                      <button
                        type="submit"
                        disabled={submitting || !comment.trim()}
                        className="td-comment-submit"
                      >
                        {submitting ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Sidebar ── */}
          <div className="td-col-side">

            {/* Status + Actions */}
            <div className="td-card td-card-pad">
              <p className="td-sidebar-label">Status</p>
              <StatusBadge status={currentStatus} />

              {!isClosed && transitions.length > 0 && (
                <div className="td-action-buttons">
                  <p className="td-actions-label">Actions</p>
                  {transitions.map(t => {
                    const cfg = TRANSITION_CLS[t]
                    return (
                      <button
                        key={t}
                        onClick={() => handleStatusChange(t)}
                        disabled={statusChanging !== null}
                        className={`td-action-btn ${cfg.btnCls}`}
                      >
                        <div className="td-action-btn-inner">
                          {statusChanging === t ? (
                            <span className="td-action-btn-spinner" />
                          ) : (
                            <span className="td-action-btn-icon">{cfg.icon}</span>
                          )}
                          <div>
                            <p className="td-action-btn-name">{t}</p>
                            <p className="td-action-btn-desc">{cfg.desc}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Jira reference */}
            {ticket.jiraUrl && (
              <div className="td-card td-card-pad">
                <p className="td-sidebar-label">Jira Reference</p>
                <a href={ticket.jiraUrl} target="_blank" rel="noopener noreferrer" className="td-jira-link">
                  <svg className="td-jira-link-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  {ticket.reference || 'View in Jira'}
                </a>
              </div>
            )}

            {/* Request type */}
            <div className="td-card td-card-pad">
              <p className="td-sidebar-label">Request type</p>
              <div className="td-req-type-row">
                {ticket.requestType === 'Email Request' ? (
                  <svg className="td-req-type-icon" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
                  </svg>
                ) : (
                  <svg className="td-req-type-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                <span className="td-req-type-text">{ticket.requestType || ticket.priority}</span>
              </div>
            </div>

            {/* Shared with */}
            <div className="td-card td-card-pad">
              <p className="td-sidebar-label">Shared with</p>
              <div className="td-shared-list">
                <div className="td-shared-person">
                  <Avatar name={ticket.requester || 'User'} size="sm" />
                  <div>
                    <p className="td-shared-name">{ticket.requester}</p>
                    <p className="td-shared-role">Creator</p>
                  </div>
                </div>
                {(ticket.sharedWith || []).filter(n => n !== ticket.requester).map((name, i) => (
                  <div key={i} className="td-shared-person">
                    <Avatar name={name} size="sm" />
                    <p className="td-shared-other">{name}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div className="td-card td-card-pad">
              <p className="td-sidebar-label">Dates</p>
              <div className="td-dates-list">
                <div className="td-date-row">
                  <span className="td-date-key">Created</span>
                  <span className="td-date-value">{formatDateShort(ticket.jiraCreatedAt || ticket.createdAt)}</span>
                </div>
                <div className="td-date-row">
                  <span className="td-date-key">Updated</span>
                  <span className="td-date-value">{formatDateShort(ticket.jiraUpdatedAt || ticket.updatedAt)}</span>
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div className="td-card td-card-pad">
              <p className="td-sidebar-label">
                Attachments
                {ticketAttachments.length > 0 && (
                  <span className="td-attach-count">({ticketAttachments.length})</span>
                )}
              </p>
              <AttachmentsPanel attachments={ticketAttachments} />
            </div>

          </div>
        </div>
      </main>
    </div>
  )
}