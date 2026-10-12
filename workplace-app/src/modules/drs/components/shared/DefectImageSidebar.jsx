// DefectImageSidebar.jsx - Enhanced DRS Image Sidebar showing both Before and After images
import React, { useState } from 'react';
import {
  X, Download, Eye, Columns, Image as ImageIcon, CheckCircle
} from 'lucide-react';
import DefectImageGalleryModal from './DefectImageGalleryModal';
import './DefectImageGallery.css';

export const DefectImageSidebar = ({
  beforeImages = [],
  afterImages = [],
  images = [],
  title = 'Defect Images',
  defectNumber = '',
  defectTitle = '',
  initialTab = 'all',
  onClose
}) => {
  const displayDefectNo = defectNumber || (defectTitle && !['defect images', 'images', 'before images', 'after images'].includes(String(defectTitle).toLowerCase().trim()) ? defectTitle : '');
  const titleHeader = displayDefectNo
    ? (String(displayDefectNo).toLowerCase().startsWith('defect') ? displayDefectNo : `Defect ${displayDefectNo}`)
    : (title || 'Defect Images');

  // If legacy single images array is passed:
  const isLegacy = beforeImages.length === 0 && afterImages.length === 0 && images.length > 0;
  const effectiveBefore = isLegacy
    ? (title.toLowerCase().includes('before') ? images : [])
    : beforeImages;
  const effectiveAfter = isLegacy
    ? (title.toLowerCase().includes('after') ? images : [])
    : afterImages;

  const totalCount = effectiveBefore.length + effectiveAfter.length;

  // Filter tabs: 'all', 'before', 'after'
  const [activeTab, setActiveTab] = useState(() => {
    if (initialTab === 'before' && effectiveBefore.length > 0) return 'before';
    if (initialTab === 'after' && effectiveAfter.length > 0) return 'after';
    return 'all';
  });

  // State to control full view modal
  const [modalState, setModalState] = useState(null);

  // Download handler
  const handleDownload = async (img, e) => {
    if (e) e.stopPropagation();
    if (!img?.url) return;
    try {
      console.log('Downloading image:', img.name);
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

  // Open Full View in comparison or single mode
  const openCompareModal = () => {
    setModalState({
      type: 'before',
      index: 0,
      mode: 'compare'
    });
  };

  const openImageInModal = (type, index) => {
    setModalState({
      type,
      index,
      mode: 'single'
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="defect-image-sidebar-overlay" onClick={onClose} />

      {/* Sidebar Panel */}
      <div className="defect-image-sidebar">
        {/* Header */}
        <div className="defect-image-sidebar-header">
          <div>
            <h3 className="defect-image-sidebar-title">
              <ImageIcon size={18} color="#0284c7" />
              {titleHeader}
            </h3>
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', fontWeight: '500' }}>
              {effectiveBefore.length} Before | {effectiveAfter.length} After
            </div>
          </div>
          <button className="defect-image-sidebar-close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Top Actions: Compare Full View button & Tabs */}
        <div className="defect-image-sidebar-actions">
          {totalCount > 0 && (
            <button
              className="defect-compare-btn"
              onClick={openCompareModal}
              title="Open full screen side-by-side comparison"
            >
              <Columns size={15} />
              Compare Before & After in Full View
            </button>
          )}

          {/* Tab Filter */}
          <div className="defect-tab-container">
            <button
              className={`defect-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All
              <span
                className="defect-tab-badge"
                style={{ background: '#e2e8f0', color: '#334155' }}
              >
                {totalCount}
              </span>
            </button>

            <button
              className={`defect-tab-btn ${activeTab === 'before' ? 'active' : ''}`}
              onClick={() => setActiveTab('before')}
            >
              <ImageIcon size={12} />
              Before
              <span
                className="defect-tab-badge"
                style={{ background: '#ffedd5', color: '#c2410c' }}
              >
                {effectiveBefore.length}
              </span>
            </button>

            <button
              className={`defect-tab-btn ${activeTab === 'after' ? 'active' : ''}`}
              onClick={() => setActiveTab('after')}
            >
              <CheckCircle size={12} />
              After
              <span
                className="defect-tab-badge"
                style={{ background: '#d1fae5', color: '#047857' }}
              >
                {effectiveAfter.length}
              </span>
            </button>
          </div>
        </div>

        {/* Scrollable Images List */}
        <div className="defect-sidebar-scroll">
          {/* SECTION: BEFORE IMAGES */}
          {(activeTab === 'all' || activeTab === 'before') && (
            <div>
              <div className="defect-section-header before">
                <h4 className="defect-section-title before">
                  <ImageIcon size={14} />
                  Before Images
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#ea580c' }}>
                    ({effectiveBefore.length})
                  </span>
                </h4>
              </div>

              {effectiveBefore.length === 0 ? (
                <div className="defect-empty-box">
                  No before images uploaded for this defect
                </div>
              ) : (
                effectiveBefore.map((img, idx) => (
                  <div key={img.id || idx} className="defect-image-card before">
                    <div
                      className="defect-image-thumb-wrap"
                      onClick={() => openImageInModal('before', idx)}
                      title="Click to view full image"
                    >
                      <span className="defect-type-pill before">BEFORE</span>
                      <button
                        className="defect-card-download-btn"
                        onClick={(e) => handleDownload(img, e)}
                        title="Download image"
                      >
                        <Download size={13} />
                      </button>
                      <img
                        src={img.url}
                        alt={img.name}
                        className="defect-image-thumb"
                      />
                    </div>
                    <div className="defect-card-footer">
                      <p className="defect-card-filename" title={img.name}>
                        {img.name}
                      </p>
                      <button
                        className="defect-card-view-btn"
                        onClick={() => openImageInModal('before', idx)}
                      >
                        <Eye size={12} /> View
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* SECTION: AFTER IMAGES */}
          {(activeTab === 'all' || activeTab === 'after') && (
            <div>
              <div className="defect-section-header after">
                <h4 className="defect-section-title after">
                  <CheckCircle size={14} />
                  After Images
                  <span style={{ fontSize: '11px', fontWeight: '600', color: '#10b981' }}>
                    ({effectiveAfter.length})
                  </span>
                </h4>
              </div>

              {effectiveAfter.length === 0 ? (
                <div className="defect-empty-box">
                  No after images uploaded for this defect
                </div>
              ) : (
                effectiveAfter.map((img, idx) => (
                  <div key={img.id || idx} className="defect-image-card after">
                    <div
                      className="defect-image-thumb-wrap"
                      onClick={() => openImageInModal('after', idx)}
                      title="Click to view full image"
                    >
                      <span className="defect-type-pill after">AFTER</span>
                      <button
                        className="defect-card-download-btn"
                        onClick={(e) => handleDownload(img, e)}
                        title="Download image"
                      >
                        <Download size={13} />
                      </button>
                      <img
                        src={img.url}
                        alt={img.name}
                        className="defect-image-thumb"
                      />
                    </div>
                    <div className="defect-card-footer">
                      <p className="defect-card-filename" title={img.name}>
                        {img.name}
                      </p>
                      <button
                        className="defect-card-view-btn"
                        onClick={() => openImageInModal('after', idx)}
                      >
                        <Eye size={12} /> View
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Full View / Comparison Modal */}
      {modalState && (
        <DefectImageGalleryModal
          beforeImages={effectiveBefore}
          afterImages={effectiveAfter}
          initialActiveType={modalState.type}
          initialIndex={modalState.index}
          initialMode={modalState.mode}
          defectNumber={displayDefectNo}
          defectTitle={displayDefectNo}
          onClose={() => setModalState(null)}
        />
      )}
    </>
  );
};

export default DefectImageSidebar;
