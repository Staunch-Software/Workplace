import { useEffect, useState } from 'react';
import api from '../api/axiosIncident';
import { imageCache } from '../utils/imageCache';

export default function AuthedImage({ incidentId, fileId, alt = '', className = '' }) {
  const key = `${incidentId}/${fileId}`;
  const [loaded, setLoaded] = useState({ key: '', url: null });
  const [failedKey, setFailedKey] = useState('');

  useEffect(() => {
    if (imageCache.has(key)) return undefined;
    let live = true;
    api.get(`/api/incidents/${incidentId}/files/${fileId}`, { responseType: 'blob' })
      .then((r) => {
        const url = URL.createObjectURL(r.data);
        imageCache.set(key, url);
        if (live) setLoaded({ key, url });
      })
      .catch(() => { if (live) setFailedKey(key); });
    return () => { live = false; };
  }, [key, incidentId, fileId]);

  const src = imageCache.get(key) || (loaded.key === key ? loaded.url : null);
  if (failedKey === key) return <div className={`inc-img-fallback ${className}`}>No preview</div>;
  if (!src) return <div className={`inc-img-fallback ${className}`} />;
  return <img src={src} alt={alt} className={className} />;
}
