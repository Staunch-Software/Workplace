// src/components/features/CloseDefectModal.jsx
import React, { useState } from 'react';
import { X, CheckCircle, Image as ImageIcon, AlertTriangle, Loader } from 'lucide-react';
import { blobUploadService } from '@drs/services/blobUploadService';
import { defectApi } from '@drs/services/defectApi';

const CloseDefectModal = ({ defect, onClose, onSuccess }) => {
  const [remarks, setRemarks] = useState(defect?.ships_remarks || "");
  const [beforeImage, setBeforeImage] = useState(null);
  const [afterImage, setAfterImage] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [beforePreview, setBeforePreview] = useState(null);
  const [afterPreview, setAfterPreview] = useState(null);

  const handleBeforeImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setBeforeImage(file);
      setBeforePreview(URL.createObjectURL(file));
    }
  };

  const handleAfterImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAfterImage(file);
      setAfterPreview(URL.createObjectURL(file));
    }
  };

  const removeBeforeImage = () => {
    setBeforeImage(null);
    if (beforePreview) {
      URL.revokeObjectURL(beforePreview);
      setBeforePreview(null);
    }
  };

  const removeAfterImage = () => {
    setAfterImage(null);
    if (afterPreview) {
      URL.revokeObjectURL(afterPreview);
      setAfterPreview(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation
    if (!remarks || !remarks.trim()) {
      alert("⚠️ Final Remarks are required.");
      return;
    }

    if (!beforeImage || !afterImage) {
      alert("⚠️ Both 'Before' and 'After' photos are required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const timestamp = Date.now();

      // Upload Images to Azure Blob Storage
      console.log('📤 Uploading BEFORE image...');
      const beforePath = await blobUploadService.uploadBinary(
        beforeImage,
        defect.id,
        `CLOSURE_BEFORE_${timestamp}`
      );

      console.log('📤 Uploading AFTER image...');
      const afterPath = await blobUploadService.uploadBinary(
        afterImage,
        defect.id,
        `CLOSURE_AFTER_${timestamp}`
      );

      console.log('✅ Images uploaded successfully');
      console.log('Before Path:', beforePath);
      console.log('After Path:', afterPath);

      // Call Close Defect API
      await defectApi.closeDefect(defect.id, {
        closure_remarks: remarks.trim(),
        closure_image_before: beforePath,
        closure_image_after: afterPath
      });

      console.log('✅ Defect closed successfully');
      
      // Clean up preview URLs
      if (beforePreview) URL.revokeObjectURL(beforePreview);
      if (afterPreview) URL.revokeObjectURL(afterPreview);

      // Call success callback
      onSuccess();
    } catch (error) {
      console.error('❌ Error closing defect:', error);
      alert("Failed to close defect: " + (error.message || 'Unknown error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="modal-content" style={{
        background: 'white',
        borderRadius: '12px',
        width: '550px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
      }}>
        {/* Header */}
        <div className="modal-header" style={{
          padding: '20px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '18px',
            color: '#0f172a'
          }}>
            <CheckCircle color="#10b981" size={20} />
            Close Defect
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <X size={20} color="#64748b" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ padding: '20px' }}>
            {/* Remarks */}
            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '14px',
                fontWeight: '600',
                color: '#334155'
              }}>
                Final Job Report *
              </label>
              <textarea
                className="input-field"
                rows="4"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Describe the repair work completed..."
                required
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Image Upload Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '15px',
              marginBottom: '15px'
            }}>
              {/* Before Image */}
              <div className="upload-box" style={{
                border: '2px dashed #cbd5e1',
                borderRadius: '8px',
                padding: '10px',
                textAlign: 'center',
                background: '#f8fafc'
              }}>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 'bold',
                  color: '#ef4444',
                  display: 'block',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  BEFORE REPAIR
                </span>
                {beforePreview ? (
                  <div style={{ position: 'relative' }}>
                    <img
                      src={beforePreview}
                      alt="Before"
                      style={{
                        width: '100%',
                        height: '120px',
                        objectFit: 'cover',
                        borderRadius: '4px'
                      }}
                    />
                    <button
                      type="button"
                      onClick={removeBeforeImage}
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px',
                        fontWeight: 'bold'
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label style={{
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    color: '#64748b',
                    padding: '20px 10px'
                  }}>
                    <ImageIcon size={32} style={{ marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px' }}>Click to Upload</span>
                    <input
                      type="file"
                      hidden
                      accept="image/*"
                      onChange={handleBeforeImageChange}
                    />
                  </label>
                )}
              </div>

              {/* After Image */}
              <div className="upload-box" style={{
                border: '2px dashed #cbd5e1',
                borderRadius: '8px',
                padding: '10px',
                textAlign: 'center',
                background: '#f8fafc'
              }}>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 'bold',
                  color: '#10b981',
                  display: 'block',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  AFTER REPAIR
                </span>
                {afterPreview ? (
                  <div style={{ position: 'relative' }}>
                    <img
                      src={afterPreview}
                      alt="After"
                      style={{
                        width: '100%',
                        height: '120px',
                        objectFit: 'cover',
                        borderRadius: '4px'
                      }}
                    />
                    <button
                      type="button"
                      onClick={removeAfterImage}
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        background: 'rgba(0, 0, 0, 0.6)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '14px',
                        fontWeight: 'bold'
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label style={{
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    color: '#64748b',
                    padding: '20px 10px'
                  }}>
                    <ImageIcon size={32} style={{ marginBottom: '8px' }} />
                    <span style={{ fontSize: '12px' }}>Click to Upload</span>
                    <input
                      type="file"
                      hidden
                      accept="image/*"
                      onChange={handleAfterImageChange}
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Warning */}
            <div className="info-box" style={{
              background: '#fffbeb',
              color: '#b45309',
              padding: '12px',
              borderRadius: '6px',
              fontSize: '12px',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start'
            }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                This action is permanent. The defect will be marked as CLOSED and moved to history.
              </span>
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer" style={{
            padding: '20px',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px'
          }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                border: '1px solid #cbd5e1',
                background: 'white',
                borderRadius: '6px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                color: '#64748b'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
              style={{
                padding: '8px 16px',
                background: isSubmitting ? '#86efac' : '#10b981',
                border: '1px solid #10b981',
                borderRadius: '6px',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader size={14} className="spin-animation" />
                  Closing...
                </>
              ) : (
                <>
                  <CheckCircle size={14} />
                  Confirm Closure
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CloseDefectModal;