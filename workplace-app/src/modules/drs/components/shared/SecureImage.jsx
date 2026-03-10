// src/components/shared/SecureImage.jsx
import React, { useState, useEffect } from 'react';
import { defectApi } from '@drs/services/defectApi';
import { ImageOff, Loader } from 'lucide-react';

const SecureImage = ({ blobPath, style, className }) => {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!blobPath) {
      setLoading(false);
      setError(true);
      return;
    }

    let isMounted = true;

    const loadImage = async () => {
      try {
        setLoading(true);
        const signedUrl = await defectApi.getAttachmentUrl(blobPath);
        if (isMounted) {
          setUrl(signedUrl);
          setError(false);
        }
      } catch (err) {
        console.error('Failed to load image:', err);
        if (isMounted) {
          setUrl(null);
          setError(true);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
    };
  }, [blobPath]);

  if (loading) {
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f1f5f9'
        }}
        className={className}
      >
        <Loader size={16} className="spin-animation" />
      </div>
    );
  }

  if (error || !url) {
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fee2e2'
        }}
        className={className}
      >
        <ImageOff size={16} color="#ef4444" />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt="Evidence"
      style={{
        ...style,
        cursor: 'pointer',
        objectFit: 'cover'
      }}
      className={className}
      onClick={() => window.open(url, '_blank')}
    />
  );
};

export default SecureImage;