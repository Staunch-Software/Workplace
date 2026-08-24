import axios from 'axios';
import { handleExpiredSession } from '../utils/authGuard';

const api = axios.create({
  // baseURL: 'http://localhost:8003/api/v1',
  // baseURL: 'http://localhost:8000/api/v1',
  // baseURL: 'http://52.172.91.85:8003/api/v1',
  baseURL: "/api/v1",
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || '';
    const isLoginUrl = err.config?.url?.includes('/login/access-token');
    if (!isLoginUrl && (status === 401 || (status === 403 && (detail === 'Not authenticated' || detail === 'Could not validate credentials')))) {
      handleExpiredSession();
    }
    return Promise.reject(err);
  }
);


export default api;