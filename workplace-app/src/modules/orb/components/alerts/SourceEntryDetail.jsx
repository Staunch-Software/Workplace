import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import api from '../../api/axiosOrb';
import LoadingSpinner from '../shared/LoadingSpinner';
import './SourceEntryDetail.css';

// The "Source ORB Entry" drilldown of an alert: the entry the alert was raised on, its lines as
// written (blank item numbers in red) and its quantities. Entries are cached for the session.
const cache = new Map();

export default function SourceEntryDetail({ alert }) {
  const [entry, setEntry] = useState(alert.entry_id ? cache.get(alert.entry_id) || null : null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!alert.entry_id || cache.has(alert.entry_id)) return undefined;
    let live = true;
    setLoading(true);
    api.get(`/api/entries/${alert.entry_id}`)
      .then(r => { cache.set(alert.entry_id, r.data.data); if (live) setEntry(r.data.data); })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [alert.entry_id]);

  if (!alert.entry_id) {
    return <div className="sed"><span className="sed-muted">No specific entry — this is a vessel-level aggregate alert.</span></div>;
  }
  if (loading) return <div className="sed"><LoadingSpinner /></div>;
  if (failed || !entry) return <div className="sed"><span className="sed-muted">Source entry not found.</span></div>;

  return (
    <div className="sed">
      <div className="sed-title"><FileText size={15} /> Source ORB Entry</div>
      <div className="sed-grid">
        <div><span className="sed-k">Date:</span> {entry.entry_date}</div>
        <div><span className="sed-k">Code:</span> <strong>{entry.orb_code}</strong></div>
        <div><span className="sed-k">Item:</span> {entry.item_number || '—'}</div>
        <div><span className="sed-k">Tank/Location:</span> {entry.tank_location || '—'}</div>
        <div className="sed-wide"><span className="sed-k">Operation:</span> {entry.operation_description}</div>
        {entry.item_lines?.length > 0 && (
          <div className="sed-wide">
            <span className="sed-k">Lines as written:</span>
            {entry.item_lines.map((l, i) => (
              <div key={i} className="sed-mono">
                <strong style={l.item ? undefined : { color: '#c00000' }}>{l.item || '(blank)'}</strong> {l.text}
              </div>
            ))}
          </div>
        )}
        <div><span className="sed-k">Officer 1:</span> {entry.officer_1_name || '—'} {entry.officer_1_rank ? `(${entry.officer_1_rank})` : ''}</div>
        <div><span className="sed-k">Officer 2:</span> {entry.officer_2_name || '—'} {entry.officer_2_rank ? `(${entry.officer_2_rank})` : ''}</div>
        <div><span className="sed-k">Confidence:</span> {entry.confidence_score != null ? `${(entry.confidence_score * 100).toFixed(0)}%` : '—'}</div>
      </div>
      <div className="sed-qty">
        <div className="sed-title">Quantities</div>
        {entry.quantities?.length ? (
          <div className="sed-qty-wrap">
            <table className="sed-qty-table">
              <thead><tr><th>Type</th><th>Value</th><th>Unit</th><th>From</th><th>To</th></tr></thead>
              <tbody>
                {entry.quantities.map(q => (
                  <tr key={q.id}>
                    <td>{q.qty_type}</td><td>{q.qty_value}</td><td>{q.qty_unit}</td>
                    <td>{q.from_tank || '—'}</td><td>{q.to_tank || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <span className="sed-muted"> None</span>}
      </div>
    </div>
  );
}
