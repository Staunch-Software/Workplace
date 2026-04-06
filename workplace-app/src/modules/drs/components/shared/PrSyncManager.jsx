// =============================================================================
// components/PrSyncManager.jsx
//
// Admin/Shore only component.
// Shows last sync status + manual sync button + session expiry banner.
// Drop this anywhere in your admin/settings panel.
// =============================================================================

import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi'; // adjust path as needed

const PrSyncManager = () => {
  const [status, setStatus]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  // Fetch current sync status on mount
  useEffect(() => {
    fetchStatus();
  }, []);

  const fetchStatus = async () => {
    try {
      const data = await defectApi.getPrSyncStatus();
      setStatus(data);
    } catch (err) {
      // Silently fail — status is optional info
    }
  };

  const handleSync = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await defectApi.triggerPrSync();
      setStatus(prev => ({
        ...prev,
        status: 'success',
        last_run_at: new Date().toISOString(),
        total_scraped: result.total_scraped,
        total_synced: result.sync?.synced ?? 0,
        error: null,
      }));
    } catch (err) {
      const msg = err?.response?.data?.detail || err.message || 'Sync failed';
      setError(msg);
      setStatus(prev => ({ ...prev, status: 'error', error: msg }));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString();
  };

  const isSessionExpired = status?.status === 'session_expired' || 
                           (status?.error && status.error.toLowerCase().includes('session'));

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: '8px',
      padding: '16px',
      maxWidth: '420px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontWeight: '700', fontSize: '13px', color: '#1e293b' }}>
          Mariapps PR Sync
        </span>
        <StatusBadge status={status?.status} />
      </div>

      {/* Session Expired Banner */}
      {isSessionExpired && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          padding: '10px 12px',
          marginBottom: '12px',
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
        }}>
          <AlertTriangle size={14} color="#dc2626" style={{ marginTop: '1px', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: '12px', fontWeight: '600', color: '#dc2626' }}>
              Mariapps Session Expired
            </div>
            <div style={{ fontSize: '11px', color: '#7f1d1d', marginTop: '2px' }}>
              Please run on server: <code>python app/scraper/generate_auth.py</code>
            </div>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {error && !isSessionExpired && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          padding: '8px 12px',
          marginBottom: '12px',
          fontSize: '11px',
          color: '#dc2626',
        }}>
          {error}
        </div>
      )}

      {/* Stats */}
      {status && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
          <StatRow label="Last Run" value={formatDate(status.last_run_at)} />
          <StatRow label="PRs Cached" value={status.total_cached ?? '—'} />
          <StatRow label="Last Scraped" value={status.total_scraped ?? '—'} />
          <StatRow label="Last Synced" value={status.total_synced ?? '—'} />
        </div>
      )}

      {/* Sync Button */}
      <button
        onClick={handleSync}
        disabled={loading}
        style={{
          width: '100%',
          padding: '8px',
          fontSize: '12px',
          fontWeight: '600',
          borderRadius: '6px',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          background: loading ? '#94a3b8' : '#0f172a',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          transition: 'background 0.2s',
        }}
      >
        <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        {loading ? 'Syncing...' : 'Sync Now'}
      </button>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};


// ── Sub-components ─────────────────────────────────────────────────────────

const StatusBadge = ({ status }) => {
  const map = {
    success:        { color: '#16a34a', bg: '#dcfce7', label: 'Healthy' },
    error:          { color: '#dc2626', bg: '#fee2e2', label: 'Error' },
    session_expired:{ color: '#dc2626', bg: '#fee2e2', label: 'Session Expired' },
    never_run:      { color: '#64748b', bg: '#f1f5f9', label: 'Never Run' },
  };
  const s = map[status] || map.never_run;
  return (
    <span style={{
      fontSize: '10px', fontWeight: '600', padding: '2px 8px',
      borderRadius: '999px', background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  );
};

const StatRow = ({ label, value }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
    <span style={{ color: '#64748b' }}>{label}</span>
    <span style={{ fontWeight: '600', color: '#1e293b' }}>{value}</span>
  </div>
);

export default PrSyncManager;