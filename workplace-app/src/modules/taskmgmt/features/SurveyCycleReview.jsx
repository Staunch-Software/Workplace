import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import axiosTaskmgmt from '../api/axiosTaskmgmt';
import { urgencyColor } from '../utils/urgency';

function formatDate(d) {
  return d || '—';
}

function DueWindow({ row }) {
  if (row.range_date_from || row.range_date_to) {
    return <span>{formatDate(row.range_date_from)} → {formatDate(row.range_date_to)}</span>;
  }
  return <span>{formatDate(row.due_date)}</span>;
}

function DaysLeft({ row }) {
  const color = urgencyColor(row.urgency);
  return (
    <span style={{
      fontWeight: 600, fontSize: '0.82rem', padding: '2px 8px', borderRadius: 6,
      background: color.bg, color: color.fg,
    }}>
      {row.days_remaining != null ? `${row.days_remaining}d` : '—'}
    </span>
  );
}

/**
 * Subtask 1.W.4 body — the only functional subtask right now. Deliberately shows each
 * source's rows independently (no cross-source matching/merging here).
 */
export default function SurveyCycleReview({ taskId, subtaskCode, onData }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [triggering, setTriggering] = useState(null); // `${vessel}::${survey}::${source}` while in flight

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await axiosTaskmgmt.get(`/tasks/${taskId}/subtasks/${subtaskCode}/vessels`);
      setState({ loading: false, error: null, data: res.data });
      onData?.(res.data);
    } catch (err) {
      const detail = err.response?.data?.detail || 'Failed to load survey cycle review data';
      setState({ loading: false, error: detail, data: null });
      onData?.(null);
    }
  }, [taskId, subtaskCode, onData]);

  useEffect(() => { load(); }, [load]);

  const handleTrigger = async (row) => {
    const key = `${row.vessel_name}::${row.survey_name}::${row.source}`;
    setTriggering(key);
    try {
      await axiosTaskmgmt.post(`/tasks/${taskId}/subtasks/${subtaskCode}/trigger-work-order`, {
        vessel_name: row.vessel_name,
        survey_name: row.survey_name,
        source: row.source,
      });
      toast.success(`Work order triggered for ${row.vessel_name} — ${row.survey_name}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to trigger work order');
    } finally {
      setTriggering(null);
    }
  };

  if (state.loading) {
    return <div style={{ padding: 16, fontSize: '0.85rem', color: 'var(--gray-500)' }}>Loading…</div>;
  }
  if (state.error) {
    return <div style={{ padding: 16, fontSize: '0.85rem', color: '#B3261E' }}>{state.error}</div>;
  }

  const rows = state.data?.rows || [];
  if (!rows.length) {
    return (
      <div style={{ padding: 16, fontSize: '0.85rem', color: 'var(--gray-500)' }}>
        No surveys due 1–3 months out right now.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--gray-200)', borderRadius: 8, marginTop: 8 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ background: 'var(--gray-100)' }}>
            <th style={{ padding: 8, textAlign: 'left' }}>Vessel</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Survey</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Due window</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Days left</th>
            <th style={{ padding: 8, textAlign: 'left' }}>Source</th>
            <th style={{ padding: 8, textAlign: 'left' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const key = `${row.vessel_name}::${row.survey_name}::${row.source}`;
            return (
              <tr key={`${key}::${i}`} style={{ borderTop: '1px solid var(--gray-200)' }}>
                <td style={{ padding: 8 }}>{row.vessel_name}</td>
                <td style={{ padding: 8 }}>{row.survey_name}</td>
                <td style={{ padding: 8, color: 'var(--gray-500)' }}><DueWindow row={row} /></td>
                <td style={{ padding: 8 }}><DaysLeft row={row} /></td>
                <td style={{ padding: 8, color: 'var(--gray-500)' }}>{row.source}</td>
                <td style={{ padding: 8 }}>
                  <button
                    onClick={() => handleTrigger(row)}
                    disabled={triggering === key}
                    style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--gray-200)',
                      background: triggering === key ? 'var(--gray-100)' : 'var(--white)',
                      cursor: triggering === key ? 'default' : 'pointer', fontSize: '0.78rem',
                    }}
                  >
                    {triggering === key ? 'Triggering…' : 'Trigger work order'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
