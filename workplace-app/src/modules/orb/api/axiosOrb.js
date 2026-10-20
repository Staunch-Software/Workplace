// Axios client for the ORB (Oil Record Book) backend.
// Same pattern as axiosReports.js / axiosLub.js: workplace token, session-expiry handling.
// ORB endpoints are written as '/api/...' so the base URL is the service root.
import axios from 'axios';
import { handleExpiredSession } from '../../../utils/authGuard';

const isDev = import.meta.env.DEV;

const apiOrb = axios.create({
  baseURL: isDev ? 'http://localhost:8007' : '/orb',
  timeout: 30000,
});

apiOrb.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

apiOrb.interceptors.response.use(
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

export default apiOrb;
