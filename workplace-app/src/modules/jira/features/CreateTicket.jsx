import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import JiraHeader from '../components/JiraHeader'
import { MODULES, ENVIRONMENTS, PRIORITY_OPTIONS } from '../constants/index'
import axiosJira from '../api/axiosJira'
import '../styles/Createticket.css'

export default function CreateTicket() {
  const navigate = useNavigate()
  const [priority, setPriority] = useState('')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [module, setModule] = useState('')
  const [environment, setEnvironment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await axiosJira.post('/api/tickets', { summary, description, module, environment, priority })
      navigate('/jira/vessel/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create ticket')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ct-page">
      <JiraHeader />
      <main className="ct-main">
        <div className="ct-breadcrumb">
          <button onClick={() => navigate('/vessel')} className="ct-breadcrumb-btn">Help Center</button>
          <span>/</span><span>Raise a Request</span>
        </div>

        <div className="ct-heading">
          <span className="ct-brand">ozellar</span>
          <h1 className="ct-title">MA Ticketing Portal</h1>
          <p className="ct-subtitle">Raise a request using the options below</p>
        </div>

        {!priority ? (
          <div>
            <p className="ct-priority-label">What can we help you with?</p>
            <div className="ct-priority-list">
              {PRIORITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPriority(opt.value)}
                  className={`ct-priority-btn ct-priority-btn--${opt.value}`}
                >
                  <p className="ct-priority-btn-title">{opt.label}</p>
                  <p className="ct-priority-btn-desc">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="ct-card">
            <div className="ct-selected-priority">
              <div>
                <p className="ct-selected-priority-name">{priority} Priority</p>
                <p className="ct-selected-priority-desc">{PRIORITY_OPTIONS.find(o => o.value === priority)?.description}</p>
              </div>
              <button onClick={() => setPriority('')} className="ct-change-btn">Change</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="ct-field">
                <label className="ct-label">Summary <span className="ct-required">*</span></label>
                <input
                  value={summary}
                  onChange={e => setSummary(e.target.value)}
                  placeholder="Brief summary of the issue"
                  required
                  className="ct-input"
                />
              </div>
              <div className="ct-field">
                <label className="ct-label">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Detailed description of the issue..."
                  className="ct-textarea"
                />
              </div>
              <div className="ct-field">
                <label className="ct-label">Module <span className="ct-required">*</span></label>
                <select value={module} onChange={e => setModule(e.target.value)} required className="ct-select">
                  <option value="">Select module</option>
                  {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="ct-field ct-field--last">
                <label className="ct-label">Environment <span className="ct-required">*</span></label>
                <select value={environment} onChange={e => setEnvironment(e.target.value)} required className="ct-select">
                  <option value="">Select environment</option>
                  {ENVIRONMENTS.map(env => <option key={env} value={env}>{env}</option>)}
                </select>
              </div>
              {error && <div className="ct-error">{error}</div>}
              <div className="ct-actions">
                <button type="submit" disabled={loading} className="ct-submit-btn">
                  {loading ? 'Submitting...' : 'Submit'}
                </button>
                <button type="button" onClick={() => navigate('/jira/vessel/dashboard')} className="ct-cancel-btn">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}