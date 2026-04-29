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
    if (err.response?.status === 401 && !err.config?.url?.includes('/login/access-token')) {
      handleExpiredSession();
    }
    return Promise.reject(err);
  }
);


export default api;