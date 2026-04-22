import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, Upload } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { blobUploadService } from '@drs/services/blobUploadService';
import { generateId } from '@drs/services/idGenerator';
import './EnhancedClosureModal.css';

const ShoreClosureModal = ({ defect, onClose, onSuccess }) => {
    const queryClient = useQueryClient();

    const [remarks, setRemarks] = useState('');

    // ✅ FIX: Object not boolean — supports two independent checkboxes
    const [wantsImages, setWantsImages] = useState({ before: false, after: false });

    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState({});
    const [uploadedImages, setUploadedImages] = useState({ before: [], after: [] });

    // ✅ FIX: Call shoreCloseDefect (not updateDefect), pass closure_remarks directly
    const closeMutation = useMutation({
        mutationFn: ({ id, closure_remarks }) =>
            defectApi.shoreCloseDefect(id, { closure_remarks }),
        onSuccess: () => {
            queryClient.invalidateQueries(['defects']);
            queryClient.invalidateQueries(['defect', defect.id]);
            alert('✅ Defect successfully closed!');
            onSuccess?.();
        },
        onError: (error) => {
            const msg = error?.response?.data?.detail || error?.message || 'Unknown error';
            alert('❌ Failed to close defect: ' + msg);
        }
    });

    const remarksValid = remarks.trim().length >= 50;
    const canProceed = remarksValid && !uploading && !closeMutation.isPending;

    const handleImageUpload = async (file, imageType) => {
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('❌ Please select an image file');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            alert('❌ Image too large. Maximum size is 10MB');
            return;
        }

        try {
            const imageId = generateId();
            setUploadProgress(prev => ({ ...prev, [imageType]: 'Uploading...' }));
            setUploading(true);

            const blobPath = await blobUploadService.uploadBinary(file, defect.id, imageId);

            await defectApi.saveDefectImage({
                id: imageId,
                defect_id: defect.id,
                image_type: imageType,
                file_name: file.name,
                file_size: file.size,
                blob_path: blobPath
            });

            setUploadedImages(prev => ({
                ...prev,
                [imageType]: [...prev[imageType], { id: imageId, file_name: file.name }]
            }));

            setUploadProgress(prev => ({ ...prev, [imageType]: '✅ Uploaded!' }));
            setTimeout(() => {
                setUploadProgress(prev => {
                    const updated = { ...prev };
                    delete updated[imageType];
                    return updated;
                });
            }, 2000);

        } catch (error) {
            console.error('Upload failed:', error);
            alert(`❌ Failed to upload: ${error.message}`);
            setUploadProgress(prev => {
                const updated = { ...prev };
                delete updated[imageType];
                return updated;
            });
        } finally {
            setUploading(false);
        }
    };

    // ✅ FIX: Pass { id, closure_remarks } — matches mutationFn signature
    const handleClose = async () => {
        if (!canProceed) return;
        await closeMutation.mutateAsync({
            id: defect.id,
            closure_remarks: remarks.trim()
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
                 className='clousure-model'
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
                    background: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)',
                    color: 'white',
                    borderRadius: '12px 12px 0 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    <div>
                        <h2 className='closure-fsize-22' style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>Close Defect</h2>
                        <p className='closure-fsize-16' style={{ margin: '4px 0 0 0', fontSize: '12px', opacity: 0.9 }}>
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

                    {/* Closure Remarks */}
                    <div style={{ marginBottom: '20px' }}>
                        <label className='closure-fsize-16' style={{
                            fontSize: '13px', fontWeight: '700', color: '#0f172a',
                            display: 'block', marginBottom: '8px'
                        }}>
                            Closure Remarks *
                        </label>
                        <textarea
                            value={remarks}
                            onChange={e => setRemarks(e.target.value)}
                            placeholder="Describe the resolution and actions taken... (minimum 50 characters)"
                            rows={4}
                            className='closure-fsize-16'
                            style={{
                                width: '100%', padding: '10px', fontSize: '13px',
                                border: `1px solid ${remarksValid ? '#cbd5e1' : remarks.length > 0 ? '#fca5a5' : '#cbd5e1'}`,
                                borderRadius: '6px', resize: 'vertical', outline: 'none',
                                boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5
                            }}
                        />
                        <div className='closure-fsize-14' style={{
                            fontSize: '11px', marginTop: '5px',
                            color: remarksValid ? '#16a34a' : remarks.length > 0 ? '#dc2626' : '#94a3b8'
                        }}>
                            {remarks.length}/50 characters {remarksValid ? '✓' : ''}
                        </div>
                    </div>

                    {/* ✅ Two independent image checkboxes */}
                    <div style={{
                        padding: '14px', background: '#f8fafc',
                        border: '1px solid #e2e8f0', borderRadius: '8px'
                    }}>
                        <p className='closure-fsize-16' style={{ fontSize: '12px', fontWeight: '700', color: '#374151', margin: '0 0 12px 0' }}>
                            Upload Images (Optional)
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {[
                                { type: 'before', label: 'Before Image' },
                                { type: 'after', label: 'After Image' }
                            ].map(({ type, label }) => (
                                <div key={type}>
                                    {/* Checkbox */}
                                    <label style={{
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        cursor: 'pointer', userSelect: 'none'
                                    }}>
                                        <input
                                            type="checkbox"
                                            checked={wantsImages[type]}
                                            onChange={e =>
                                                setWantsImages(prev => ({ ...prev, [type]: e.target.checked }))
                                            }
                                            style={{
                                                width: '16px', height: '16px',
                                                accentColor: '#ea580c', cursor: 'pointer', flexShrink: 0
                                            }}
                                        />
                                        <span className='closure-fsize-16' style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>
                                            {label}
                                        </span>
                                    </label>

                                    {/* Upload panel — shown only when checkbox is checked */}
                                    {wantsImages[type] && (
                                        <div style={{
                                            marginTop: '10px', marginLeft: '26px', padding: '12px',
                                            background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <span className='closure-fsize-16' style={{ fontSize: '12px', color: '#64748b' }}>
                                                    {uploadedImages[type].length > 0
                                                        ? `${uploadedImages[type].length} file(s) uploaded`
                                                        : 'No image selected'}
                                                </span>
                                                <label className='closure-fsize-16' style={{
                                                    background: uploading ? '#e5e7eb' : '#ea580c',
                                                    color: uploading ? '#9ca3af' : 'white',
                                                    padding: '4px 12px', borderRadius: '4px',
                                                    fontSize: '11px', fontWeight: '600',
                                                    cursor: uploading ? 'not-allowed' : 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: '4px'
                                                }}>
                                                    <Upload size={11} />
                                                    Select
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        style={{ display: 'none' }}
                                                        disabled={uploading}
                                                        onChange={e => {
                                                            const file = e.target.files?.[0];
                                                            if (file) handleImageUpload(file, type);
                                                            e.target.value = '';
                                                        }}
                                                    />
                                                </label>
                                            </div>

                                            {uploadProgress[type] && (
                                                <p className='closure-fsize-14' style={{ fontSize: '11px', color: '#ea580c', margin: '6px 0 0 0', fontStyle: 'italic' }}>
                                                    {uploadProgress[type]}
                                                </p>
                                            )}

                                            {uploadedImages[type].length > 0 && (
                                                <ul style={{ margin: '8px 0 0 0', padding: 0, listStyle: 'none' }}>
                                                    {uploadedImages[type].map(img => (
                                                        <li key={img.id} className='closure-fsize-14' style={{
                                                            fontSize: '11px', color: '#16a34a',
                                                            display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px'
                                                        }}>
                                                            <CheckCircle size={11} />
                                                            {img.file_name}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid #e5e7eb',
                    display: 'flex', justifyContent: 'flex-end', gap: '10px',
                    background: '#f9fafb', borderRadius: '0 0 12px 12px'
                }}>
                    <button onClick={onClose} className='closure-fsize-16' style={{
                        background: 'white', border: '1px solid #d1d5db', color: '#374151',
                        padding: '8px 16px', borderRadius: '6px', fontSize: '13px',
                        fontWeight: '600', cursor: 'pointer'
                    }}>
                        Cancel
                    </button>
                    <button
                        onClick={handleClose}
                        disabled={!canProceed}
                        className='closure-fsize-16'
                        style={{
                            background: canProceed ? 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)' : '#e5e7eb',
                            border: 'none', color: canProceed ? 'white' : '#9ca3af',
                            padding: '8px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: '700',
                            cursor: canProceed ? 'pointer' : 'not-allowed',
                            boxShadow: canProceed ? '0 4px 12px rgba(234,88,12,0.3)' : 'none',
                            display: 'flex', alignItems: 'center', gap: '6px',
                            opacity: closeMutation.isPending ? 0.7 : 1
                        }}
                    >
                        <CheckCircle size={14} />
                        {closeMutation.isPending ? 'Closing...' : 'Close Defect'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShoreClosureModal;