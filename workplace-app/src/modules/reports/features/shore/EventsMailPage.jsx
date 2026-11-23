// src/modules/reports/features/shore/EventsMailPage.jsx
// Admin page: who receives each vessel's "new logbook report" mail (To and CC).
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeft, Mail, Plus, X, Send, RefreshCcw } from 'lucide-react';
import { reportsApi } from '../../api/reportsApi';
import '../../styles/ReportConfigPage.css';
import '../../styles/EventsMailPage.css';

const errorText = (err, fallback) => err?.response?.data?.detail || fallback;

// One list (To or CC) of a vessel: chips with remove buttons plus an add box.
function RecipientGroup({ vessel, kind, label, onChanged }) {
  const [email, setEmail] = useState('');
  const list = vessel.recipients.filter((r) => (r.kind || 'to') === kind);

  const add = useMutation({
    mutationFn: () => reportsApi.addMailRecipient(vessel.imo, email.trim(), kind),
    onSuccess: () => { setEmail(''); onChanged(); },
    onError: (err) => toast.error(errorText(err, 'Could not add the address.')),
  });
  const remove = useMutation({
    mutationFn: (id) => reportsApi.deleteMailRecipient(id),
    onSuccess: onChanged,
    onError: (err) => toast.error(errorText(err, 'Could not remove the address.')),
  });

  const submit = (e) => {
    e.preventDefault();
    if (email.trim() && !add.isPending) add.mutate();
  };

  return (
    <div className="emr-group">
      <div className="emr-group-label">{label}</div>
      {list.length > 0 && (
        <div className="emr-chips">
          {list.map((r) => (
            <span key={r.id} className={`emr-chip emr-chip--${kind}`} title={r.email}>
              <span className="emr-chip-text">{r.email}</span>
              <button type="button" title="Remove" onClick={() => remove.mutate(r.id)} disabled={remove.isPending}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form className="emr-add" onSubmit={submit}>
        <input
          type="email"
          placeholder={kind === 'to' && list.length === 0 ? 'Add To address (required)' : `Add ${label} address`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit" className="emr-icon-btn" title="Add" disabled={!email.trim() || add.isPending}>
          <Plus size={14} />
        </button>
      </form>
    </div>
  );
}

function VesselRow({ vessel, onChanged }) {
  const toggle = useMutation({
    mutationFn: (enabled) => reportsApi.setMailVesselEnabled(vessel.imo, enabled),
    onSuccess: onChanged,
    onError: (err) => toast.error(errorText(err, 'Could not change the switch.')),
  });
  const test = useMutation({
    mutationFn: () => reportsApi.sendMailTest(vessel.imo),
    onSuccess: (r) => toast.success(`Latest report sent to ${r.sent_to}`),
    onError: (err) => toast.error(errorText(err, 'Test mail failed.')),
  });

  return (
    <tr className={vessel.enabled ? '' : 'emr-off'}>
      <td className="emr-vessel">
        <div className="emr-vessel-name">{vessel.name}</div>
        <div className="emr-vessel-imo">IMO {vessel.imo}</div>
        <div className="emr-last">
          {vessel.last_mailed
            ? `Last mailed ${new Date(vessel.last_mailed).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
            : 'Not mailed yet'}
        </div>
      </td>
      <td>
        <div className="emr-groups">
          <RecipientGroup vessel={vessel} kind="to" label="To" onChanged={onChanged} />
          <RecipientGroup vessel={vessel} kind="cc" label="CC" onChanged={onChanged} />
        </div>
      </td>
      <td className="emr-actions">
        <label className="emr-switch" title={vessel.enabled ? 'Mails are on' : 'Mails are off'}>
          <input
            type="checkbox"
            checked={vessel.enabled}
            onChange={(e) => toggle.mutate(e.target.checked)}
            disabled={toggle.isPending}
          />
          <span />
        </label>
        <button
          type="button"
          className="emr-btn"
          onClick={() => test.mutate()}
          disabled={test.isPending}
          title="Sends this vessel's latest report to your own email only"
        >
          <Send size={12} /> {test.isPending ? 'Sending...' : 'Test'}
        </button>
      </td>
    </tr>
  );
}

export default function EventsMailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: vessels = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['events-mail-recipients'],
    queryFn: () => reportsApi.listMailRecipients(),
  });

  const changed = () => queryClient.invalidateQueries({ queryKey: ['events-mail-recipients'] });

  return (
    <div className="rcfg-root">
      <div className="rcfg-header emr-header">
        <div className="rcfg-header-left">
          <button className="rcfg-back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={16} /> Back
          </button>
          <div>
            <div className="rcfg-header-title"><Mail size={20} /> Event mails</div>
            <div className="rcfg-header-sub">
              Each vessel's recipients get a mail with its last 7 logbook events whenever a new report arrives
            </div>
          </div>
        </div>
        <div className="rcfg-header-actions">
          <button className="rcfg-btn rcfg-btn--ghost" onClick={() => refetch()}>
            <RefreshCcw size={15} /> Refresh
          </button>
        </div>
      </div>

      <div className="emr-body">
        {isLoading ? (
          <div className="rcfg-loading"><span className="rcfg-spinner" /><span>Loading vessels...</span></div>
        ) : isError ? (
          <div className="rcfg-empty"><p>Could not load the recipient list.</p></div>
        ) : (
          <table className="emr-table">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Recipients</th>
                <th>Mail</th>
              </tr>
            </thead>
            <tbody>
              {vessels.map((v) => <VesselRow key={v.imo} vessel={v} onChanged={changed} />)}
            </tbody>
          </table>
        )}
        <p className="emr-note">
          Changes apply at the next check (every 15 minutes). A vessel needs at least one To address, and its
          switch on, to be mailed; CC addresses get a copy. A vessel's first check records its existing reports
          without mailing them.
        </p>
      </div>
    </div>
  );
}
