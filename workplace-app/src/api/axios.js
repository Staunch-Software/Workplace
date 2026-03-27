import axios from 'axios';
import toast from 'react-hot-toast';

const api = axios.create({
  // baseURL: 'http://localhost:8003/api/v1', 
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


export default api;