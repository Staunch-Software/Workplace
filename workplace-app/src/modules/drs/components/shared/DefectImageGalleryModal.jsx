// DefectImageGalleryModal.jsx - Enhanced Full View Image Modal with Before & After Comparison
import React, { useState, useEffect, useCallback } from 'react';
import {
  X, ChevronLeft, ChevronRight, Download, Columns, Maximize2, Image as ImageIcon, CheckCircle
} from 'lucide-react';
import './DefectImageGallery.css';

export const DefectImageGalleryModal = ({
  beforeImages = [],
  afterImages = [],
  images = [],
  initialIndex = 0,
  initialActiveType = 'before',
  initialMode = null,
  defectNumber = '',
  defectTitle = '',
  onClose
}) => {
  const displayDefectNo = defectNumber || (defectTitle && !['defect images', 'images', 'before images', 'after images'].includes(String(defectTitle).toLowerCase().trim()) ? defectTitle : '');
  const titleHeader = displayDefectNo
    ? (String(displayDefectNo).toLowerCase().startsWith('defect') ? displayDefectNo : `Defect ${displayDefectNo}`)
    : 'Defect Images';

  // Support legacy callers who pass a single images array
  const effectiveBefore = beforeImages.length > 0 ? beforeImages : (images.length > 0 && initialActiveType === 'before' ? images : []);
  const effectiveAfter = afterImages.length > 0 ? afterImages : (images.length > 0 && initialActiveType === 'after' ? images : []);

  // If only legacy images array is passed without before/after separation:
  const isLegacySingle = beforeImages.length === 0 && afterImages.length === 0 && images.length > 0;
  const legacyList = isLegacySingle ? images : [];

  const hasBefore = effectiveBefore.length > 0;
  const hasAfter = effectiveAfter.length > 0;
  const canCompare = hasBefore || hasAfter;

  // Default mode: single view when clicking a picture; can switch to compare if needed
  const defaultMode = initialMode || 'single';
  const [viewMode, setViewMode] = useState(defaultMode);

  // Indexes for Side-by-Side compare
  const [beforeIdx, setBeforeIdx] = useState(
    initialActiveType === 'before' && initialIndex < effectiveBefore.length ? initialIndex : 0
  );
  const [afterIdx, setAfterIdx] = useState(
    initialActiveType === 'after' && initialIndex < effectiveAfter.length ? initialIndex : 0
  );

  // Single mode active item
  const allImagesCombined = isLegacySingle
    ? legacyList.map(img => ({ ...img, type: 'preview' }))
    : [
        ...effectiveBefore.map(img => ({ ...img, type: 'before' })),
        ...effectiveAfter.map(img => ({ ...img, type: 'after' }))
      ];

  const [singleIdx, setSingleIdx] = useState(() => {
    if (isLegacySingle) return Math.min(initialIndex, legacyList.length - 1);
    if (initialActiveType === 'after') {
      const idx = effectiveBefore.length + (initialIndex < effectiveAfter.length ? initialIndex : 0);
      return Math.min(idx, allImagesCombined.length - 1);
    }
    return Math.min(initialIndex, allImagesCombined.length - 1);
  });

  // Download helper
  const handleDownload = async (img, e) => {
    if (e) e.stopPropagation();
    if (!img?.url) return;
    try {
      const response = await fetch(img.url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = img.name || 'defect_image.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  // Keyboard controls
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowLeft') {
      if (viewMode === 'compare') {
        if (hasBefore) setBeforeIdx(prev => (prev === 0 ? effectiveBefore.length - 1 : prev - 1));
      } else {
        setSingleIdx(prev => (prev === 0 ? allImagesCombined.length - 1 : prev - 1));
      }
    } else if (e.key === 'ArrowRight') {
      if (viewMode === 'compare') {
        if (hasAfter) setAfterIdx(prev => (prev === effectiveAfter.length - 1 ? 0 : prev + 1));
      } else {
        setSingleIdx(prev => (prev === allImagesCombined.length - 1 ? 0 : prev + 1));
      }
    }
  }, [onClose, viewMode, hasBefore, hasAfter, effectiveBefore.length, effectiveAfter.length, allImagesCombined.length]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const currentBefore = effectiveBefore[beforeIdx];
  const currentAfter = effectiveAfter[afterIdx];
  const currentSingle = allImagesCombined[singleIdx];

  const switchToCompare = () => {
    if (currentSingle) {
      if (currentSingle.type === 'before') {
        const bIdx = singleIdx;
        if (bIdx >= 0 && bIdx < effectiveBefore.length) setBeforeIdx(bIdx);
      } else if (currentSingle.type === 'after') {
        const aIdx = singleIdx - effectiveBefore.length;
        if (aIdx >= 0 && aIdx < effectiveAfter.length) setAfterIdx(aIdx);
      }
    }
    setViewMode('compare');
  };

  const switchToSingle = () => {
    if (viewMode === 'compare') {
      if (hasBefore) {
        setSingleIdx(Math.min(beforeIdx, effectiveBefore.length - 1));
      } else if (hasAfter) {
        setSingleIdx(effectiveBefore.length + Math.min(afterIdx, effectiveAfter.length - 1));
      }
    }
    setViewMode('single');
  };

  return (
    <div className="defect-gallery-modal" onClick={onClose}>
      {/* Top Header */}
      <div className="defect-gallery-header" onClick={e => e.stopPropagation()}>
        <div className="defect-gallery-title-box">
          <h3 className="defect-gallery-title">
            <ImageIcon size={18} color="#38bdf8" />
            {titleHeader}
            <span style={{ fontSize: '12px', fontWeight: '400', color: '#94a3b8', marginLeft: '6px' }}>
              ({effectiveBefore.length} Before | {effectiveAfter.length} After)
            </span>
          </h3>
        </div>

        {/* View Mode Switcher */}
        {!isLegacySingle && canCompare && (
          <div className="defect-gallery-mode-toggle">
            <button
              className={`defect-gallery-mode-btn ${viewMode === 'single' ? 'active' : ''}`}
              onClick={switchToSingle}
              title="Single Full Screen"
            >
              <Maximize2 size={14} /> Single View
            </button>
            <button
              className={`defect-gallery-mode-btn ${viewMode === 'compare' ? 'active' : ''}`}
              onClick={switchToCompare}
              title="Side-by-Side Comparison"
            >
              <Columns size={14} /> Side-by-Side View
            </button>
          </div>
        )}

        {/* Close Button */}
        <button
          className="defect-gallery-close-btn"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Close (Esc)"
        >
          <X size={20} />
        </button>
      </div>

      {/* Main Viewport */}
      {viewMode === 'compare' && !isLegacySingle ? (
        <div className="defect-gallery-compare-viewport" onClick={e => e.stopPropagation()}>
          {/* LEFT PANE: BEFORE */}
          <div className="defect-compare-pane before">
            <div className="defect-pane-header">
              <div className="defect-pane-label">
                <span className="defect-pane-badge before">
                  BEFORE
                </span>
                {hasBefore && (
                  <span className="defect-pane-info">
                    {beforeIdx + 1} of {effectiveBefore.length} - {currentBefore?.name}
                  </span>
                )}
              </div>
              {hasBefore && (
                <button
                  className="defect-card-download-btn"
                  style={{ position: 'static' }}
                  onClick={(e) => handleDownload(currentBefore, e)}
                  title="Download Before Image"
                >
                  <Download size={14} />
                </button>
              )}
            </div>

            <div className="defect-pane-stage">
              {hasBefore ? (
                <>
                  <img
                    src={currentBefore.url}
                    alt={currentBefore.name || 'Before Defect Image'}
                    className="defect-pane-img"
                    onClick={() => {
                      setSingleIdx(beforeIdx);
                      setViewMode('single');
                    }}
                    style={{ cursor: 'pointer' }}
                    title="Click to view single full screen"
                  />
                  {effectiveBefore.length > 1 && (
                    <>
                      <button
                        className="defect-nav-btn prev"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBeforeIdx(prev => (prev === 0 ? effectiveBefore.length - 1 : prev - 1));
                        }}
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button
                        className="defect-nav-btn next"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBeforeIdx(prev => (prev === effectiveBefore.length - 1 ? 0 : prev + 1));
                        }}
                      >
                        <ChevronRight size={20} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                  <ImageIcon size={40} style={{ opacity: 0.4, marginBottom: '8px' }} />
                  <p style={{ margin: 0, fontSize: '13px' }}>No Before Images Uploaded</p>
                </div>
              )}
            </div>

            {effectiveBefore.length > 1 && (
              <div className="defect-pane-thumbnails">
                {effectiveBefore.map((img, idx) => (
                  <img
                    key={img.id || idx}
                    src={img.url}
                    alt={img.name}
                    className={`defect-mini-thumb ${idx === beforeIdx ? 'active before' : ''}`}
                    onClick={() => setBeforeIdx(idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* RIGHT PANE: AFTER */}
          <div className="defect-compare-pane after">
            <div className="defect-pane-header">
              <div className="defect-pane-label">
                <span className="defect-pane-badge after">
                  AFTER
                </span>
                {hasAfter && (
                  <span className="defect-pane-info">
                    {afterIdx + 1} of {effectiveAfter.length} - {currentAfter?.name}
                  </span>
                )}
              </div>
              {hasAfter && (
                <button
                  className="defect-card-download-btn"
                  style={{ position: 'static' }}
                  onClick={(e) => handleDownload(currentAfter, e)}
                  title="Download After Image"
                >
                  <Download size={14} />
                </button>
              )}
            </div>

            <div className="defect-pane-stage">
              {hasAfter ? (
                <>
                  <img
                    src={currentAfter.url}
                    alt={currentAfter.name || 'After Defect Image'}
                    className="defect-pane-img"
                    onClick={() => {
                      setSingleIdx(effectiveBefore.length + afterIdx);
                      setViewMode('single');
                    }}
                    style={{ cursor: 'pointer' }}
                    title="Click to view single full screen"
                  />
                  {effectiveAfter.length > 1 && (
                    <>
                      <button
                        className="defect-nav-btn prev"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAfterIdx(prev => (prev === 0 ? effectiveAfter.length - 1 : prev - 1));
                        }}
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button
                        className="defect-nav-btn next"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAfterIdx(prev => (prev === effectiveAfter.length - 1 ? 0 : prev + 1));
                        }}
                      >
                        <ChevronRight size={20} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                  <ImageIcon size={40} style={{ opacity: 0.4, marginBottom: '8px' }} />
                  <p style={{ margin: 0, fontSize: '13px' }}>No After Images Uploaded</p>
                </div>
              )}
            </div>

            {effectiveAfter.length > 1 && (
              <div className="defect-pane-thumbnails">
                {effectiveAfter.map((img, idx) => (
                  <img
                    key={img.id || idx}
                    src={img.url}
                    alt={img.name}
                    className={`defect-mini-thumb ${idx === afterIdx ? 'active after' : ''}`}
                    onClick={() => setAfterIdx(idx)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* SINGLE VIEW MODE */
        <div className="defect-gallery-single-viewport" onClick={e => e.stopPropagation()}>
          {currentSingle && (
            <div className="defect-single-img-wrap">
              <img
                src={currentSingle.url}
                alt={currentSingle.name}
                className="defect-single-img"
              />

              {allImagesCombined.length > 1 && (
                <>
                  <button
                    className="defect-nav-btn prev"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSingleIdx(prev => (prev === 0 ? allImagesCombined.length - 1 : prev - 1));
                    }}
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <button
                    className="defect-nav-btn next"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSingleIdx(prev => (prev === allImagesCombined.length - 1 ? 0 : prev + 1));
                    }}
                  >
                    <ChevronRight size={24} />
                  </button>
                </>
              )}
            </div>
          )}

          {currentSingle && (
            <div className="defect-single-footer">
              {currentSingle.type === 'before' && (
                <span className="defect-pane-badge before">BEFORE</span>
              )}
              {currentSingle.type === 'after' && (
                <span className="defect-pane-badge after">AFTER</span>
              )}
              <span style={{ fontSize: '13px' }}>
                {singleIdx + 1} / {allImagesCombined.length} - {currentSingle.name}
              </span>
              <button
                className="defect-card-download-btn"
                style={{ position: 'static' }}
                onClick={(e) => handleDownload(currentSingle, e)}
                title="Download Image"
              >
                <Download size={14} />
              </button>
            </div>
          )}

          {allImagesCombined.length > 1 && (
            <div className="defect-single-thumbnails">
              {allImagesCombined.map((img, idx) => (
                <img
                  key={img.id || idx}
                  src={img.url}
                  alt={img.name}
                  className={`defect-mini-thumb ${idx === singleIdx ? `active ${img.type || ''}` : ''}`}
                  onClick={() => setSingleIdx(idx)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DefectImageGalleryModal;
