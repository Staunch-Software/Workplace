import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import axiosTaskmgmt from '../api/axiosTaskmgmt';

const ROLE_COLUMNS = [
  { code: 'SURVEY_COORDINATOR', label: 'Survey Coordinator' },
  { code: 'TA', label: 'TA' },
  { code: 'TSI', label: 'TSI' },
  { code: 'TM', label: 'TM' },
];

const RACI_LETTERS = ['R', 'A', 'C', 'I'];

function cellKey(taskId, roleCode) {
  return `${taskId}::${roleCode}`;
}

function RaciCell({ taskId, roleCode, values, saving, onChange }) {
  const toggle = (letter) => {
    const next = values.includes(letter)
      ? values.filter((v) => v !== letter)
      : [...values, letter];
    onChange(taskId, roleCode, next);
  };

  return (
    <details style={{ position: 'relative' }}>
      <summary style={{
        cursor: 'pointer', listStyle: 'none', userSelect: 'none',
        minWidth: 56, padding: '4px 8px', borderRadius: 6,
        border: '1px solid var(--gray-200)', textAlign: 'center',
        fontSize: '0.8rem', color: values.length ? 'var(--gray-900)' : 'var(--gray-400)',
        background: saving ? 'var(--gray-100)' : 'var(--white)',
      }}>
        {values.length ? values.join(', ') : '—'}
      </summary>
      <div style={{
        position: 'absolute', zIndex: 20, top: '110%', left: 0,
        background: 'var(--white)', border: '1px solid var(--gray-200)',
        borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        padding: 8, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90,
      }}>
        {RACI_LETTERS.map((letter) => (
          <label key={letter} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={values.includes(letter)}
              onChange={() => toggle(letter)}
            />
            {letter}
          </label>
        ))}
      </div>
    </details>
  );
}

function RoleUserSelect({ roleCode, users, selectedUserId, saving, onChange }) {
  return (
    <select
      value={selectedUserId || ''}
      onChange={(e) => onChange(roleCode, e.target.value || null)}
      disabled={saving}
      style={{
        width: '100%', padding: '4px 6px', borderRadius: 6,
        border: '1px solid var(--gray-200)', fontSize: '0.8rem',
        background: saving ? 'var(--gray-100)' : 'var(--white)',
      }}
    >
      <option value="">— Unassigned —</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.full_name}</option>
      ))}
    </select>
  );
}

export default function AdminConfig() {
  const [vessels, setVessels] = useState([]);
  const [selectedVessel, setSelectedVessel] = useState('');
  const [tasks, setTasks] = useState([]);
  const [assignments, setAssignments] = useState({}); // role_code -> { user_id, full_name, email }
  const [matrix, setMatrix] = useState({}); // cellKey -> string[]
  const [usersByRole, setUsersByRole] = useState({}); // role_code -> User[]
  const [loading, setLoading] = useState(true);
  const [savingCells, setSavingCells] = useState(new Set());

  const markSaving = useCallback((key, isSaving) => {
    setSavingCells((prev) => {
      const next = new Set(prev);
      if (isSaving) next.add(key); else next.delete(key);
      return next;
    });
  }, []);

  // Initial load: vessels + task list (vessel-independent)
  useEffect(() => {
    (async () => {
      try {
        const [vesselsRes, tasksRes] = await Promise.all([
          axiosTaskmgmt.get('/vessels'),
          axiosTaskmgmt.get('/tasks'),
        ]);
        setVessels(vesselsRes.data);
        setTasks(tasksRes.data);
        if (vesselsRes.data.length) setSelectedVessel(vesselsRes.data[0].imo);
      } catch (err) {
        toast.error('Failed to load Task Management setup data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Eligible users per role — fixed set of 4 roles, fetched once
  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.all(
          ROLE_COLUMNS.map((r) => axiosTaskmgmt.get('/users', { params: { role_code: r.code } }))
        );
        const byRole = {};
        ROLE_COLUMNS.forEach((r, i) => { byRole[r.code] = results[i].data; });
        setUsersByRole(byRole);
      } catch (err) {
        toast.error('Failed to load eligible users');
      }
    })();
  }, []);

  // Vessel-scoped config: assignments + RACI matrix
  useEffect(() => {
    if (!selectedVessel) return;
    (async () => {
      try {
        const res = await axiosTaskmgmt.get('/config', { params: { vessel_imo: selectedVessel } });
        const assignmentMap = {};
        res.data.assignments.forEach((a) => { assignmentMap[a.role_code] = a; });
        setAssignments(assignmentMap);

        const matrixMap = {};
        res.data.matrix.forEach((m) => { matrixMap[cellKey(m.task_id, m.role_code)] = m.raci_values; });
        setMatrix(matrixMap);
      } catch (err) {
        toast.error('Failed to load vessel configuration');
      }
    })();
  }, [selectedVessel]);

  const handleAssignmentChange = useCallback(async (roleCode, userId) => {
    const key = `assign::${roleCode}`;
    markSaving(key, true);
    // optimistic update
    setAssignments((prev) => ({
      ...prev,
      [roleCode]: { role_code: roleCode, user_id: userId, full_name: null, email: null },
    }));
    try {
      const res = await axiosTaskmgmt.put('/config/assignment', {
        vessel_imo: selectedVessel,
        role_code: roleCode,
        user_id: userId,
      });
      setAssignments((prev) => ({ ...prev, [roleCode]: res.data }));
    } catch (err) {
      toast.error(`Failed to save ${roleCode} assignment`);
    } finally {
      markSaving(key, false);
    }
  }, [selectedVessel, markSaving]);

  const handleMatrixChange = useCallback(async (taskId, roleCode, raciValues) => {
    const key = cellKey(taskId, roleCode);
    markSaving(key, true);
    setMatrix((prev) => ({ ...prev, [key]: raciValues }));
    try {
      await axiosTaskmgmt.put('/config/matrix-entry', {
        vessel_imo: selectedVessel,
        task_id: taskId,
        role_code: roleCode,
        raci_values: raciValues,
      });
    } catch (err) {
      toast.error('Failed to save RACI entry');
    } finally {
      markSaving(key, false);
    }
  }, [selectedVessel, markSaving]);

  const selectedVesselName = useMemo(
    () => vessels.find((v) => v.imo === selectedVessel)?.name || '',
    [vessels, selectedVessel]
  );

  if (loading) {
    return <div style={{ padding: 24, fontSize: '0.9rem', color: 'var(--gray-500)' }}>Loading Task Management…</div>;
  }

  return (
    <div style={{ padding: 24, fontFamily: 'Inter, sans-serif' }}>
      <h2 style={{ marginBottom: 4 }}>Task Management — Admin Config</h2>
      <p style={{ color: 'var(--gray-500)', fontSize: '0.85rem', marginBottom: 16 }}>
        Assign who fills each role on the selected vessel, and set their RACI involvement per task. Changes save automatically.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: '0.85rem', marginRight: 8 }}>Vessel:</label>
        <select
          value={selectedVessel}
          onChange={(e) => setSelectedVessel(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--gray-200)', minWidth: 240 }}
        >
          {vessels.map((v) => (
            <option key={v.imo} value={v.imo}>{v.name}</option>
          ))}
        </select>
        {selectedVesselName && (
          <span style={{ marginLeft: 12, fontSize: '0.8rem', color: 'var(--gray-500)' }}>{selectedVesselName}</span>
        )}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--gray-200)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: 'var(--gray-100)' }}>
              <th style={{ padding: 8, textAlign: 'left', minWidth: 40 }}>#</th>
              <th style={{ padding: 8, textAlign: 'left', minWidth: 280 }}>Description</th>
              <th style={{ padding: 8, textAlign: 'left', minWidth: 90 }}>Interval</th>
              {ROLE_COLUMNS.map((r) => (
                <th key={r.code} style={{ padding: 8, minWidth: 160 }}>
                  <div style={{ marginBottom: 6, fontWeight: 600 }}>{r.label}</div>
                  <RoleUserSelect
                    roleCode={r.code}
                    users={usersByRole[r.code] || []}
                    selectedUserId={assignments[r.code]?.user_id}
                    saving={savingCells.has(`assign::${r.code}`)}
                    onChange={handleAssignmentChange}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} style={{ borderTop: '1px solid var(--gray-200)' }}>
                <td style={{ padding: 8, color: 'var(--gray-500)' }}>{task.item_no}</td>
                <td style={{ padding: 8 }}>{task.description}</td>
                <td style={{ padding: 8, color: 'var(--gray-500)' }}>{task.interval || '—'}</td>
                {ROLE_COLUMNS.map((r) => {
                  const key = cellKey(task.id, r.code);
                  return (
                    <td key={r.code} style={{ padding: 8, textAlign: 'center' }}>
                      <RaciCell
                        taskId={task.id}
                        roleCode={r.code}
                        values={matrix[key] || []}
                        saving={savingCells.has(key)}
                        onChange={handleMatrixChange}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
