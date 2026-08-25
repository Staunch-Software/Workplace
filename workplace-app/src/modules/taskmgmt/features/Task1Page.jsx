import React, { useCallback, useState } from 'react';
import axiosTaskmgmt from '../api/axiosTaskmgmt';
import SubtaskRow from '../components/SubtaskRow';
import SurveyCycleReview from './SurveyCycleReview';

// Backend has no subtask-level metadata table (task_master only holds the 63 top-level
// RACI tasks) — subtask codes/titles/status tags are hardcoded here. Only 1.W.4 is
// functional; the rest are placeholders until their own backend logic exists (see
// app/routes/subtasks.py's SUBTASK_VESSEL_HANDLERS registry for where to add them).
const SUBTASKS = [
  { code: '1.W.1', title: 'Vessel & document identity matching across sources', statusTag: 'pending mapping', functional: false },
  { code: '1.W.2', title: 'Certificate expiry verification', statusTag: 'pending verification logic', functional: false },
  { code: '1.W.3', title: 'Condition of Class verification', statusTag: 'pending verification logic', functional: false },
  { code: '1.W.4', title: 'Class survey cycle review', functional: true },
  { code: '1.W.5', title: 'Supporting document checklist', statusTag: 'pending document list', functional: false },
];

const TASK_ID = 1;

export default function Task1Page() {
  const [task, setTask] = useState(null);
  const [accessState, setAccessState] = useState('checking'); // 'checking' | 'granted' | 'denied'
  const [deniedReason, setDeniedReason] = useState('');
  const [w4Data, setW4Data] = useState(null);

  // Page-level role gate: probe the one functional subtask's endpoint (backend enforces
  // Survey Coordinator — see require_survey_coordinator). No client-side role_code check
  // exists (the JWT doesn't carry role_code — see deps.py), so this mirrors the same
  // "let the backend 403 decide" pattern the RACI admin config screen already relies on.
  const probeAccess = useCallback(async () => {
    try {
      await axiosTaskmgmt.get(`/tasks/${TASK_ID}/subtasks/1.W.4/vessels`);
      setAccessState('granted');
    } catch (err) {
      if (err.response?.status === 403) {
        setDeniedReason(err.response?.data?.detail || 'This page is only available to the Survey Coordinator role.');
        setAccessState('denied');
      } else {
        // Any other failure (network, 401 already handled by the axios interceptor, etc.)
        // — don't silently show the page, but don't claim it's a role issue either.
        setDeniedReason('Could not verify access to this page.');
        setAccessState('denied');
      }
    }
  }, []);

  React.useEffect(() => { probeAccess(); }, [probeAccess]);

  React.useEffect(() => {
    if (accessState !== 'granted') return;
    (async () => {
      try {
        const res = await axiosTaskmgmt.get(`/tasks/${TASK_ID}`);
        setTask(res.data);
      } catch {
        // Header is cosmetic — if it fails, the page still works, just without the
        // description line.
      }
    })();
  }, [accessState]);

  if (accessState === 'checking') {
    return <div style={{ padding: 24, fontSize: '0.9rem', color: 'var(--gray-500)' }}>Loading…</div>;
  }

  if (accessState === 'denied') {
    return (
      <div style={{ padding: 24 }}>
        <div style={{
          padding: 16, borderRadius: 8, background: '#FDECEC', color: '#B3261E', fontSize: '0.9rem',
        }}>
          {deniedReason}
        </div>
      </div>
    );
  }

  const w4Rows = w4Data?.rows || [];
  const w4Urgency = w4Rows.some((r) => r.urgency === 'RED' || r.urgency === 'AMBER') ? 'AMBER' : 'NEUTRAL';

  return (
    <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)', fontWeight: 600 }}>TASK {TASK_ID}</div>
        <h2 style={{ margin: '4px 0' }}>{task?.description || 'Survey planning and Arrangement'}</h2>
        {task?.interval && (
          <p style={{ color: 'var(--gray-500)', fontSize: '0.85rem', margin: 0 }}>
            Interval: {task.interval}
          </p>
        )}
      </div>

      <div style={{ border: '1px solid var(--gray-200)', borderRadius: 8, overflow: 'hidden' }}>
        {SUBTASKS.map((s) =>
          s.functional ? (
            <SubtaskRow
              key={s.code}
              code={s.code}
              title={s.title}
              functional
              badgeCount={w4Data?.vessel_count}
              badgeUrgency={w4Urgency}
            >
              <SurveyCycleReview taskId={TASK_ID} subtaskCode={s.code} onData={setW4Data} />
            </SubtaskRow>
          ) : (
            <SubtaskRow key={s.code} code={s.code} title={s.title} functional={false} statusTag={s.statusTag} />
          )
        )}
      </div>
    </div>
  );
}
