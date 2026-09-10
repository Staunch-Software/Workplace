import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, RefreshCw } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { DEFECT_SOURCE_MAP } from '@drs/components/shared/constants';

const ShoreReopenModal = ({ defect, onClose, onSuccess }) => {
    const queryClient = useQueryClient();

    const [reason, setReason] = useState('');

    const reopenMutation = useMutation({
        mutationFn: ({ id, reason }) =>
            defectApi.reopenDefect(id, { reason }),
        onSuccess: () => {
            queryClient.invalidateQueries(['defects']);
            queryClient.invalidateQueries(['defect', defect.id]);
            queryClient.invalidateQueries(['live-feed']);
            alert('✅ Defect successfully reopened!');
            onSuccess?.();
        },
        onError: (error) => {
            const msg = error?.response?.data?.detail || error?.message || 'Unknown error';
            alert('❌ Failed to reopen defect: ' + msg);
        }
    });

    const reasonValid = reason.trim().length >= 10;
    const canProceed = reasonValid && !reopenMutation.isPending;

    const handleReopen = async () => {
        if (!canProceed) return;
        await reopenMutation.mutateAsync({
            id: defect.id,
            reason: reason.trim()
        });
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '20px'
            }}
            onClick={onClose}
        >
            <div
                className='reopen-model'
                style={{
                    background: 'white',
                    borderRadius: '12px',
                    width: '100%',
                    maxWidth: '600px',
                    maxHeight: '90vh',
                    overflow: 'auto',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: 'white',
                    borderRadius: '12px 12px 0 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Reopen Defect</h2>
                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', opacity: 0.9 }}>
                            {defect.equipment_name || defect.title}
                        </p>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'rgba(255,255,255,0.2)', border: 'none',
                        borderRadius: '6px', padding: '8px', cursor: 'pointer', display: 'flex'
                    }}>
                        <X size={18} color="white" />
                    </button>
                </div>

                {/* Body */}
                <div style={{ padding: '24px' }}>
                    {/* Defect Details */}
                    <div style={{
                        background: 'light-dark(rgba(245, 244, 237, 1), rgba(38, 38, 36, 1))',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '14px 16px',
                        marginBottom: '20px'
                    }}>
                        <p style={{
                            fontSize: '11px', fontWeight: '700', color: '#94a3b8',
                            textTransform: 'uppercase', letterSpacing: '0.05em',
                            margin: '0 0 12px 0'
                        }}>
                            Defect details
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                            <div>
                                <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 3px 0' }}>Defect ID</p>
                                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', margin: 0 }}>
                                    {defect.defect_number || '—'}
                                </p>
                            </div>
                            <div>
                                <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 3px 0' }}>Area of concern</p>
                                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', margin: 0 }}>
                                    {defect.equipment_name || '—'}
                                </p>
                            </div>
                            <div>
                                <p style={{ fontSize: '11px', color: '#94a3b8', margin: '0 0 3px 0' }}>Source</p>
                                <p style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a', margin: 0 }}>
                                    {DEFECT_SOURCE_MAP[defect.defect_source] || defect.defect_source || '—'}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Reopen Reason */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{
                            fontSize: '13px', fontWeight: '700', color: '#0f172a',
                            display: 'block', marginBottom: '8px'
                        }}>
                            Reason for Reopening *
                        </label>
                        <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>
                            This reason will be visible to vessel crew and stored in the system audit trail.
                        </p>
                        <textarea
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Describe why this defect needs to be reopened... (minimum 10 characters)"
                            rows={4}
                            style={{
                                width: '100%', padding: '10px', fontSize: '13px',
                                border: `1px solid ${reasonValid ? '#cbd5e1' : reason.length > 0 ? '#fca5a5' : '#cbd5e1'}`,
                                borderRadius: '6px', resize: 'vertical', outline: 'none',
                                boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5
                            }}
                        />
                        <div style={{
                            fontSize: '11px', marginTop: '5px',
                            color: reasonValid ? '#16a34a' : reason.length > 0 ? '#dc2626' : '#94a3b8'
                        }}>
                            {reason.length}/10 characters {reasonValid ? '✓' : ''}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid #e5e7eb',
                    display: 'flex', justifyContent: 'flex-end', gap: '10px',
                    background: '#f9fafb', borderRadius: '0 0 12px 12px'
                }}>
                    <button onClick={onClose} style={{
                        background: 'white', border: '1px solid #d1d5db', color: '#374151',
                        padding: '8px 16px', borderRadius: '6px', fontSize: '13px',
                        fontWeight: '600', cursor: 'pointer'
                    }}>
                        Cancel
                    </button>
                    <button
                        onClick={handleReopen}
                        disabled={!canProceed}
                        style={{
                            background: canProceed ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#e5e7eb',
                            border: 'none', color: canProceed ? 'white' : '#9ca3af',
                            padding: '8px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: '700',
                            cursor: canProceed ? 'pointer' : 'not-allowed',
                            boxShadow: canProceed ? '0 4px 12px rgba(2,132,199,0.3)' : 'none',
                            display: 'flex', alignItems: 'center', gap: '6px',
                            opacity: reopenMutation.isPending ? 0.7 : 1
                        }}
                    >
                        <RefreshCw size={14} />
                        {reopenMutation.isPending ? 'Reopening...' : 'Reopen Defect'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShoreReopenModal;
