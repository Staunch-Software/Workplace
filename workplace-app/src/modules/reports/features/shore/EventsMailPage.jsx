// src/modules/reports/features/shore/EventsMailPage.jsx
// Admin page: who receives each vessel's "new logbook report" mail (To and CC).
// Fully responsive across all devices from mobile (320px) to 4K displays.
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Mail,
  Plus,
  X,
  Send,
  RefreshCcw,
  Ship,
  Clock,
  User,
  Users,
  AlertCircle
} from 'lucide-react';
import { reportsApi } from '../../api/reportsApi';
import '../../styles/ReportConfigPage.css';
import '../../styles/EventsMailPage.css';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const errorText = (err, fallback) => err?.response?.data?.detail || fallback;

// Helper to format last mailed timestamp into clean, human-readable relative time
function formatLastMailed(isoString) {
  if (!isoString) return { display: 'Not mailed yet', full: null };
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { display: 'Not mailed yet', full: null };
    const full = d.toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const now = new Date();
    const diffSec = Math.floor((now - d) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    let display;
    if (diffMin < 2) display = 'Just now';
    else if (diffMin < 60) display = `${diffMin}m ago`;
    else if (diffHours < 24) display = `${diffHours}h ago`;
    else if (diffDays === 1) display = 'Yesterday';
    else if (diffDays < 7) display = `${diffDays}d ago`;
    else {
      display = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    return { display, full };
  } catch {
    return { display: 'Not mailed yet', full: null };
  }
}

// One list (To or CC) of a vessel: chips with remove buttons plus an add box.
function RecipientGroup({ vessel, kind, label, icon: Icon, onChanged }) {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const list = useMemo(
    () => vessel.recipients.filter((r) => (r.kind || 'to') === kind),
    [vessel.recipients, kind]
  );

  const remove = useMutation({
    mutationFn: (id) => reportsApi.deleteMailRecipient(id),
    onSuccess: () => {
      onChanged();
      toast.success('Recipient removed');
    },
    onError: (err) => toast.error(errorText(err, 'Could not remove address.')),
  });

  const submit = async (e) => {
    e.preventDefault();
    const raw = email.trim();
    if (!raw || isSubmitting) return;

    // Support comma, semicolon, or space-separated emails
    const emails = raw
      .split(/[,;\s]+/)
      .map((em) => em.trim().toLowerCase())
      .filter(Boolean);

    if (emails.length === 0) return;

    const invalid = emails.filter((em) => !EMAIL_REGEX.test(em));
    if (invalid.length > 0) {
      toast.error(`Invalid email format: ${invalid[0]}`);
      return;
    }

    // Check for duplicate in current vessel list
    const existing = new Set(vessel.recipients.map((r) => r.email.toLowerCase()));
    const dup = emails.filter((em) => existing.has(em));
    if (dup.length > 0) {
      toast.error(`Address already added: ${dup[0]}`);
      return;
    }

    setIsSubmitting(true);
    let added = 0;
    try {
      for (const em of emails) {
        await reportsApi.addMailRecipient(vessel.imo, em, kind);
        added++;
      }
      setEmail('');
      onChanged();
      toast.success(
        added > 1 ? `Added ${added} recipients to ${label}` : `Added recipient to ${label}`
      );
    } catch (err) {
      toast.error(errorText(err, 'Could not add address.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isTo = kind === 'to';
  const hasItems = list.length > 0;

  return (
    <div className={`emr-group emr-group--${kind}`}>
      <div className="emr-group-header">
        <span className="emr-group-title">
          <Icon size={12} className="emr-group-icon" />
          <span>{label}</span>
        </span>
        <span className={`emr-group-badge ${hasItems ? 'has-items' : 'is-empty'}`}>
          {list.length}
        </span>
      </div>

      <div className="emr-chips-wrap">
        {hasItems ? (
          <div className="emr-chips">
            {list.map((r) => (
              <span key={r.id} className={`emr-chip emr-chip--${kind}`} title={r.email}>
                <span className="emr-chip-dot" />
                <span className="emr-chip-text">{r.email}</span>
                <button
                  type="button"
                  title="Remove recipient"
                  className="emr-chip-del"
                  onClick={() => remove.mutate(r.id)}
                  disabled={remove.isPending}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <div className={`emr-empty-prompt ${isTo ? 'is-warning' : ''}`}>
            {isTo ? (
              <>
                <AlertCircle size={12} />
                <span>Required for delivery</span>
              </>
            ) : (
              <span>No CC recipients</span>
            )}
          </div>
        )}
      </div>

      <form className="emr-add-form" onSubmit={submit}>
        <div className="emr-input-wrapper">
          <Mail size={12} className="emr-input-icon" />
          <input
            type="email"
            placeholder={isTo && !hasItems ? 'Add required To address...' : `Add ${label} address...`}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
          />
        </div>
        <button
          type="submit"
          className="emr-add-btn"
          title={`Add ${label} recipient`}
          disabled={!email.trim() || isSubmitting}
        >
          {isSubmitting ? (
            <span className="emr-spinner-sm" />
          ) : (
            <>
              <Plus size={13} />
              <span>Add</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
}

function VesselRow({ vessel, onChanged }) {
  const toggle = useMutation({
    mutationFn: (enabled) => reportsApi.setMailVesselEnabled(vessel.imo, enabled),
    onSuccess: (res) => {
      onChanged();
      toast.success(res.enabled ? `${vessel.name} mails enabled` : `${vessel.name} mails paused`);
    },
    onError: (err) => toast.error(errorText(err, 'Could not change the switch.')),
  });

  const test = useMutation({
    mutationFn: () => reportsApi.sendMailTest(vessel.imo),
    onSuccess: (r) => toast.success(`Latest report sent to ${r.sent_to}`),
    onError: (err) => toast.error(errorText(err, 'Test mail failed.')),
  });

  const lastMailedInfo = useMemo(() => formatLastMailed(vessel.last_mailed), [vessel.last_mailed]);

  return (
    <tr className={`emr-row ${vessel.enabled ? 'is-active' : 'is-paused'}`}>
      {/* 1. Vessel Information */}
      <td className="emr-vessel-td">
        <div className="emr-vessel">
          <div className="emr-vessel-top">
            <div className={`emr-vessel-avatar ${vessel.enabled ? 'is-active' : 'is-paused'}`}>
              <Ship size={16} />
            </div>
            <div className="emr-vessel-meta">
              <div className="emr-vessel-name" title={vessel.name}>
                {vessel.name}
              </div>
              <div className="emr-vessel-badges">
                <span className="emr-imo-pill">IMO {vessel.imo}</span>
                <span className={`emr-status-pill ${vessel.enabled ? 'is-active' : 'is-paused'}`}>
                  <span className={`emr-status-dot ${vessel.enabled ? 'pulse' : ''}`} />
                  <span>{vessel.enabled ? 'Active' : 'Paused'}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="emr-last" title={lastMailedInfo.full ? `Last mailed: ${lastMailedInfo.full}` : 'No reports mailed yet'}>
            <Clock size={11} className="emr-last-icon" />
            <span className="emr-last-label">Last mailed:</span>
            <span className="emr-last-val">{lastMailedInfo.display}</span>
          </div>
        </div>
      </td>

      {/* 2. Recipients Distribution (To & CC) */}
      <td className="emr-recipients-td">
        <div className="emr-groups">
          <RecipientGroup vessel={vessel} kind="to" label="To" icon={User} onChanged={onChanged} />
          <RecipientGroup vessel={vessel} kind="cc" label="CC" icon={Users} onChanged={onChanged} />
        </div>
      </td>

      {/* 3. Actions (Toggle Switch & Test Mail) */}
      <td className="emr-actions-td">
        <div className="emr-action-controls">
          <div className="emr-switch-wrapper">
            <label className="emr-switch" title={vessel.enabled ? 'Mails are active — click to pause' : 'Mails are paused — click to activate'}>
              <input
                type="checkbox"
                checked={vessel.enabled}
                onChange={(e) => toggle.mutate(e.target.checked)}
                disabled={toggle.isPending}
              />
              <span className="emr-slider" />
            </label>
            <span className={`emr-switch-text ${vessel.enabled ? 'is-active' : 'is-paused'}`}>
              {vessel.enabled ? 'Active' : 'Paused'}
            </span>
          </div>

          <button
            type="button"
            className="emr-test-btn"
            onClick={() => test.mutate()}
            disabled={test.isPending}
            title="Sends this vessel's latest report to your own email address only"
          >
            {test.isPending ? (
              <>
                <span className="emr-spinner-sm" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send size={12} />
                <span>Test</span>
              </>
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function EventsMailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: vessels = [], isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['events-mail-recipients'],
    queryFn: () => reportsApi.listMailRecipients(),
  });

  const changed = () => queryClient.invalidateQueries({ queryKey: ['events-mail-recipients'] });

  return (
    <div className="rcfg-root emr-page-root">
      {/* ── Page Header ── */}
      <div className="rcfg-header emr-header">
        <div className="emr-header-inner">
          <div className="emr-header-top">
            <div className="emr-header-left">
              <button className="rcfg-back-btn emr-back-btn" onClick={() => navigate(-1)} title="Return to Report Config">
                <ArrowLeft size={16} />
                <span>Back</span>
              </button>
              <div className="rcfg-header-title emr-header-title">
                <div className="emr-title-icon-wrap">
                  <Mail size={18} />
                </div>
                <span>Event mails</span>
              </div>
            </div>

            <div className="rcfg-header-actions emr-header-actions">
              <button
                className="rcfg-btn rcfg-btn--ghost emr-refresh-btn"
                onClick={() => refetch()}
                disabled={isFetching}
                title="Refresh vessel recipients"
              >
                <RefreshCcw size={14} className={isFetching ? 'emr-spin' : ''} />
                <span>{isFetching ? 'Refreshing...' : 'Refresh'}</span>
              </button>
            </div>
          </div>

          <div className="rcfg-header-sub emr-header-sub">
            Each vessel's recipients get a mail with its last 7 logbook events whenever a new report arrives (auto-syncs every 15 min)
          </div>
        </div>
      </div>

      {/* ── Page Body ── */}
      <div className="emr-body">
        <div className="emr-content-inner">
          {isLoading ? (
            <div className="emr-loading-state">
              <span className="emr-spinner-lg" />
              <span className="emr-loading-text">Loading vessels & recipients...</span>
            </div>
          ) : isError ? (
            <div className="emr-error-state">
              <p>Could not load the recipient list.</p>
              <button className="rcfg-btn rcfg-btn--ghost" onClick={() => refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <div className="emr-table-card">
              <table className="emr-table">
                <thead>
                  <tr>
                    <th className="emr-th-vessel">Vessel</th>
                    <th className="emr-th-recipients">Recipients (To & CC)</th>
                    <th className="emr-th-actions">Mail</th>
                  </tr>
                </thead>
                <tbody>
                  {vessels.map((v) => (
                    <VesselRow key={v.imo} vessel={v} onChanged={changed} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
