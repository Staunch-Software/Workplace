import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Upload, CheckCircle, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';
import { blobUploadService } from '@drs/services/blobUploadService';
import { generateId } from '@drs/services/idGenerator';
import AttachmentLink from '../shared/AttachmentLink';

/**
 * Enhanced Defect Closure Modal - Integrates with PENDING_CLOSURE workflow
 * 
 * Features:
 * - Validates closure remarks (min 50 characters) ✅
 * - Shows existing before/after images ✅
 * - Upload missing images in-modal ✅
 * - Hides image sections if already uploaded ✅
 * - Prevents closure until all requirements met ✅
 * - Sets status to PENDING_CLOSURE instead of CLOSED ✅
 */

const EnhancedClosureModal = ({ defect, validation, onClose, onSuccess }) => {
  const queryClient = useQueryClient();
  
  // State
  const [remarks, setRemarks] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});

  // Closure mutation
  const closureMutation = useMutation({
    mutationFn: ({ id, updates }) => defectApi.updateDefect(id, updates),
    onSuccess: () => {
      onSuccess();
    },
    onError: (error) => {
      alert('❌ Failed to request closure: ' + error.message);
    }
  });

  // Fetch current before/after images
  const { data: beforeImages = [], refetch: refetchBefore } = useQuery({
    queryKey: ['defect-images', defect.id, 'before'],
    queryFn: () => defectApi.getDefectImages(defect.id, 'before'),
    enabled: !!defect.before_image_required
  });

  const { data: afterImages = [], refetch: refetchAfter } = useQuery({
    queryKey: ['defect-images', defect.id, 'after'],
    queryFn: () => defectApi.getDefectImages(defect.id, 'after'),
    enabled: !!defect.after_image_required
  });

  // Check if all requirements are met
  const remarksValid = remarks.trim().length >= 50;
  const beforeImagesOk = !defect.before_image_required || beforeImages.length > 0;
  const afterImagesOk = !defect.after_image_required || afterImages.length > 0;
  const canProceed = remarksValid && beforeImagesOk && afterImagesOk && !uploading;

  // Determine if we need to show image upload sections
  const needsBeforeImages = defect.before_image_required && beforeImages.length === 0;
  const needsAfterImages = defect.after_image_required && afterImages.length === 0;
  const showImageSection = needsBeforeImages || needsAfterImages;

  // Handle image upload
  const handleImageUpload = async (file, imageType) => {
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
      alert('❌ Please select an image file');
      return;
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      alert('❌ Image too large. Maximum size is 10MB');
      return;
    }

    try {
      const imageId = generateId();
      setUploadProgress(prev => ({ ...prev, [imageType]: 'Uploading...' }));
      setUploading(true);

      // Upload to Azure
      const blobPath = await blobUploadService.uploadBinary(file, defect.id, imageId);

      // Save metadata
      await defectApi.saveDefectImage({
        id: imageId,
        defect_id: defect.id,
        image_type: imageType,
        file_name: file.name,
        file_size: file.size,
        blob_path: blobPath
      });

      // Refresh images
      if (imageType === 'before') {
        await refetchBefore();
      } else {
        await refetchAfter();
      }

      setUploadProgress(prev => ({ ...prev, [imageType]: '✅ Complete!' }));
      
      setTimeout(() => {
        setUploadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[imageType];
          return newProgress;
        });
      }, 2000);

    } catch (error) {
      console.error('❌ Upload failed:', error);
      alert(`❌ Failed to upload: ${error.message}`);
      setUploadProgress(prev => {
        const newProgress = { ...prev };
        delete newProgress[imageType];
        return newProgress;
      });
    } finally {
      setUploading(false);
    }
  };

  // ✅ UPDATED: Handle proceed - Request Closure (PENDING_CLOSURE instead of CLOSED)
  const handleProceed = async () => {
    if (!canProceed || closureMutation.isPending) return;
    
    try {
      // Request closure with PENDING_CLOSURE status
      await closureMutation.mutateAsync({
        id: defect.id,
        updates: {
          status: 'PENDING_CLOSURE', // ✅ CHANGED FROM 'CLOSED'
          closure_remarks: remarks.trim()
        }
      });
    } catch (error) {
      console.error('Closure request failed:', error);
    }
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
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
        style={{
          background: 'white',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '650px',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '2px solid #f1f5f9',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)',
          color: 'white',
          borderRadius: '12px 12px 0 0'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '700' }}>
              Request Defect Closure
            </h2>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', opacity: 0.9 }}>
              {defect.equipment_name}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '6px',
              padding: '8px',
              cursor: 'pointer',
              display: 'flex'
            }}
          >
            <X size={18} color="white" />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '24px' }}>
          
          {/* Closure Remarks */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              fontSize: '13px', 
              fontWeight: '700', 
              color: '#0f172a',
              marginBottom: '8px',
              display: 'block'
            }}>
              Closure Remarks *
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Describe the resolution and actions taken... (minimum 50 characters)"
              style={{
                width: '100%',
                minHeight: '100px',
                padding: '10px',
                fontSize: '13px',
                border: `1px solid ${remarksValid ? '#cbd5e1' : remarks.length > 0 ? '#fca5a5' : '#cbd5e1'}`,
                borderRadius: '6px',
                resize: 'vertical',
                outline: 'none'
              }}
            />
            <div style={{
              fontSize: '11px',
              marginTop: '6px',
              color: remarksValid ? '#16a34a' : remarks.length > 0 ? '#dc2626' : '#64748b'
            }}>
              {remarks.length}/50 characters {remarksValid ? '✓' : ''}
            </div>
          </div>

          {/* Image Upload Section - Only show if missing mandatory images */}
          {showImageSection && (
            <div style={{ marginBottom: '16px' }}>
              <p style={{ 
                fontSize: '12px', 
                fontWeight: '700',
                color: '#0f172a',
                marginBottom: '10px'
              }}>
                Required Images
              </p>

              {/* Before Images - Only show if missing */}
              {needsBeforeImages && (
                <div style={{ 
                  padding: '12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px',
                  marginBottom: '12px'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px'
                  }}>
                    <span style={{ 
                      fontSize: '12px', 
                      fontWeight: '600',
                      color: '#991b1b'
                    }}>
                      ⚠️ Before Images (MANDATORY)
                    </span>
                    <label style={{
                      background: '#ef4444',
                      color: 'white',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                      opacity: uploading ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <Upload size={12} />
                      Select Image
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        disabled={uploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageUpload(file, 'before');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {uploadProgress.before && (
                    <div style={{
                      fontSize: '11px',
                      color: '#ea580c',
                      marginBottom: '6px',
                      fontStyle: 'italic'
                    }}>
                      {uploadProgress.before}
                    </div>
                  )}

                  <p style={{ 
                    fontSize: '11px', 
                    color: '#991b1b',
                    margin: '6px 0 0 0'
                  }}>
                    No before images uploaded yet
                  </p>
                </div>
              )}

              {/* After Images - Only show if missing */}
              {needsAfterImages && (
                <div style={{ 
                  padding: '12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '6px'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px'
                  }}>
                    <span style={{ 
                      fontSize: '12px', 
                      fontWeight: '600',
                      color: '#991b1b'
                    }}>
                      ⚠️ After Images (MANDATORY)
                    </span>
                    <label style={{
                      background: '#ef4444',
                      color: 'white',
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: '600',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                      opacity: uploading ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      <Upload size={12} />
                      Select Image
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        disabled={uploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImageUpload(file, 'after');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  {uploadProgress.after && (
                    <div style={{
                      fontSize: '11px',
                      color: '#ea580c',
                      marginBottom: '6px',
                      fontStyle: 'italic'
                    }}>
                      {uploadProgress.after}
                    </div>
                  )}

                  <p style={{ 
                    fontSize: '11px', 
                    color: '#991b1b',
                    margin: '6px 0 0 0'
                  }}>
                    No after images uploaded yet
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Success message if all images are already uploaded */}
          {!showImageSection && (defect.before_image_required || defect.after_image_required) && (
            <div style={{
              padding: '12px',
              background: '#f0fdf4',
              border: '1px solid #86efac',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#166534',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <CheckCircle size={14} />
              <span style={{ fontWeight: '600' }}>
                All required images already uploaded in chat
              </span>
            </div>
          )}

          {/* No images required at all */}
          {!defect.before_image_required && !defect.after_image_required && (
            <div style={{
              padding: '10px',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#64748b',
              marginBottom: '16px'
            }}>
              ℹ️ No before/after images required for this defect
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          background: '#f9fafb',
          borderRadius: '0 0 12px 12px'
        }}>
          <button
            onClick={onClose}
            style={{
              background: 'white',
              border: '1px solid #d1d5db',
              color: '#374151',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleProceed}
            disabled={!canProceed || closureMutation.isPending}
            style={{
              background: canProceed ? 'linear-gradient(135deg, #f59e0b 0%, #fb923c 100%)' : '#e5e7eb',
              border: 'none',
              color: canProceed ? 'white' : '#9ca3af',
              padding: '8px 20px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '700',
              cursor: (canProceed && !closureMutation.isPending) ? 'pointer' : 'not-allowed',
              boxShadow: canProceed ? '0 4px 12px rgba(245, 158, 11, 0.3)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: closureMutation.isPending ? 0.7 : 1
            }}
          >
            <CheckCircle size={14} />
            {closureMutation.isPending ? 'Processing...' : 'Request Closure'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EnhancedClosureModal;