import axios from 'axios';
import { handleExpiredSession } from '../../../utils/authGuard';

const axiosJira = axios.create({
  // baseURL: 'http://localhost:8004',
  baseURL: '/jira/api',
});

axiosJira.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

axiosJira.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || '';
    if (status === 401 || (status === 403 && detail === 'Could not validate credentials')) {
      handleExpiredSession();
    }
    return Promise.reject(err);
  }
);

export default axiosJira;