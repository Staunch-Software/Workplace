import axios from 'axios';
import toast from 'react-hot-toast';

const apiDrs = axios.create({
  // baseURL: 'http://localhost:8001/api/v1', 
  // baseURL: 'http://52.172.91.85:8001/api/v1',
  baseURL: "/drs/api/v1",
  headers: { 'Content-Type': 'application/json' },
});

apiDrs.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

apiDrs.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('platform_token');
      localStorage.removeItem('platform_user');
      sessionStorage.removeItem('platform_token');
      sessionStorage.removeItem('platform_user');
      toast.error('Session expired. Please login again.');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default apiDrs;