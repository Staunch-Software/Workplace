// Axios client for the Incident Report backend.
// Same pattern as axiosOrb.js: workplace token, session-expiry handling. Endpoints are '/api/...'.
import axios from 'axios';
import { handleExpiredSession } from '../../../utils/authGuard';

const isDev = import.meta.env.DEV;

const apiIncident = axios.create({
  baseURL: isDev ? 'http://localhost:8008' : '/incident',
  timeout: 30000,
});

apiIncident.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiIncident.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || '';
    if (status === 401 || (status === 403 && detail === 'Could not validate credentials')) {
      handleExpiredSession();
    }
    return Promise.reject(err);
  },
);

export const errText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d[0]?.msg) return d[0].msg;
  return fallback;
};

// Files are served through the API (storage has no public access), so they are fetched with the token.
export async function openFile(incidentId, fileId) {
  const r = await apiIncident.get(`/api/incidents/${incidentId}/files/${fileId}`, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default apiIncident;
