import { useEffect, useState, useCallback, useRef } from 'react';
import { Activity, Upload, Trash2 } from 'lucide-react';
import api from '../../api/axiosOrb';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// 15 ppm bilge alarm / oil content monitor data of one vessel. "ORB vs 15 ppm alarm record" (alert 23) matches
// every D 15.1 entry with a discharge in this data, so each file the crew exports from the monitor is uploaded here.
export default function OcmSection({ vesselId }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);     // { type: 'ok' | 'error', text, detail }
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/vessels/${vesselId}/ocm-imports`);
      setItems(r.data.data || []);
    } catch (e) {
      setResult({ type: 'error', text: 'Could not load the imports' });
    }
  }, [vesselId]);

  useEffect(() => { load(); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api.post(`/api/vessels/${vesselId}/ocm-imports`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const d = r.data.data;
      setResult({
        type: 'ok',
        text: `${d.row_count} records read, ${d.discharge_operations} discharge operation${d.discharge_operations === 1 ? '' : 's'}` +
              (d.rows_skipped ? `, ${d.rows_skipped} row${d.rows_skipped === 1 ? '' : 's'} left out (unreadable time or unclear status)` : '') +
              '. The next re-process or recalculate matches them with the Oil Record Book.',
      });
      await load();
    } catch (e) {
      const d = e.response?.data?.detail;
      if (d && typeof d === 'object') {
        setResult({
          type: 'error',
          text: d.message || 'The file could not be used',
          detail: `Columns found: ${(d.headers_found || []).join(', ') || 'none'}. ` +
                  `Date/time column: ${d.time_column || 'not found'}. Status column: ${d.status_column || 'not found'}.`,
        });
      } else {
        setResult({ type: 'error', text: typeof d === 'string' ? d : 'Upload failed' });
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (item) => {
    if (!window.confirm(`Remove ${item.filename} and its ${item.row_count} records?`)) return;
    try {
      await api.delete(`/api/vessels/${vesselId}/ocm-imports/${item.id}`);
      await load();
    } catch (e) { setResult({ type: 'error', text: e.response?.data?.detail || 'Could not remove' }); }
  };

  return (
    <div className="as-block">
      <div className="vc-sectionhead">
        <h4 className="vc-sectionhead__title"><Activity size={16} /> 15 ppm monitor data</h4>
        <label className={`vc-btn vc-btn--primary vc-btn--sm as-upload${busy ? ' as-upload--busy' : ''}`}>
          <Upload size={15} /> {busy ? 'Uploading…' : 'Upload export'}
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm,.txt" disabled={busy} onChange={e => upload(e.target.files[0])} />
        </label>
      </div>
      <p className="as-hint">
        CSV or Excel export of the monitor&rsquo;s stored data: a date/time column and a status column (for example overboard / recirculation).
        Times are read day first and taken as ship time, the same clock as the Oil Record Book.
      </p>
      {result && (
        <div className={`as-result as-result--${result.type}`} role="status">
          <div>{result.text}</div>
          {result.detail && <div className="as-result__detail">{result.detail}</div>}
        </div>
      )}
      {items === null ? null : items.length === 0 ? (
        <div className="vc-notanks">No monitor data uploaded for this vessel yet, so &ldquo;ORB vs 15 ppm alarm record&rdquo; is not checked.</div>
      ) : (
        <div className="vc-table-wrap">
          <table className="vc-table">
            <thead>
              <tr><th>File</th><th className="vc-num">Records</th><th>From</th><th>To</th><th>Uploaded</th><th className="vc-th-actions">Action</th></tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} className="vc-row">
                  <td data-label="File" className="vc-tankname">{it.filename}</td>
                  <td data-label="Records" className="vc-num">{it.row_count}</td>
                  <td data-label="From" className="vc-muted">{fmt(it.period_from)}</td>
                  <td data-label="To" className="vc-muted">{fmt(it.period_to)}</td>
                  <td data-label="Uploaded" className="vc-muted">{fmt(it.imported_at)}{it.imported_by_name ? ` · ${it.imported_by_name}` : ''}</td>
                  <td className="vc-td-actions">
                    <div className="vc-rowbtns">
                      <button className="vc-btn vc-btn--danger vc-btn--sm" onClick={() => remove(it)}><Trash2 size={14} /> Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
