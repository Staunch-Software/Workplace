// src/components/shared/AttachmentLink.jsx
// Use this component wherever you display attachments
import React, { useState, useEffect } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { defectApi } from '@drs/services/defectApi';

/**
 * AttachmentLink Component
 * Fetches fresh SAS URL when component mounts
 * This solves the "attachment not opening after reload" issue
 * 
 * Usage:
 * <AttachmentLink attachment={{ id: '123', file_name: 'test.pdf', blob_path: 'defects/...' }} />
 */
const AttachmentLink = ({ attachment }) => {
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchUrl = async () => {
      try {
        setLoading(true);
        console.log('🔗 Fetching fresh URL for:', attachment.file_name);
        
        // Fetch fresh signed URL from backend
        const freshUrl = await defectApi.getAttachmentUrl(attachment.blob_path);
        
        setDownloadUrl(freshUrl);
        setError(null);
        console.log('✅ Fresh URL obtained');
      } catch (err) {
        console.error('❌ Failed to load attachment URL:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (attachment.blob_path) {
      fetchUrl();
    }
  }, [attachment.blob_path, attachment.file_name]);

  // Loading state
  if (loading) {
    return (
      <div style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '4px', 
        fontSize: '12px', 
        color: '#94a3b8',
        padding: '4px 8px',
        background: '#f8fafc',
        borderRadius: '4px',
        border: '1px solid #e2e8f0'
      }}>
        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
        Loading...
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '4px', 
        fontSize: '12px', 
        color: '#ef4444',
        padding: '4px 8px',
        background: '#fef2f2',
        borderRadius: '4px',
        border: '1px solid #fecaca'
      }}>
        ⚠️ Failed to load
      </div>
    );
  }

  // Success state - clickable link
  return (
    <a 
      href={downloadUrl} 
      target="_blank" 
      rel="noreferrer" 
      download={attachment.file_name}
      style={{ 
        display: 'inline-flex',
        alignItems: 'center', 
        gap: '4px', 
        fontSize: '12px', 
        color: '#3b82f6', 
        textDecoration: 'none',
        padding: '4px 8px',
        background: '#eff6ff',
        borderRadius: '4px',
        border: '1px solid #bfdbfe',
        transition: 'all 0.2s',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#dbeafe';
        e.currentTarget.style.borderColor = '#93c5fd';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#eff6ff';
        e.currentTarget.style.borderColor = '#bfdbfe';
      }}
    >
      <Download size={12} /> {attachment.file_name}
    </a>
  );
};

export default AttachmentLink;

// CSS for spin animation (add to your global CSS or inline)
const style = document.createElement('style');
style.textContent = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
document.head.appendChild(style);