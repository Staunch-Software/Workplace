import axios from 'axios';
import toast from 'react-hot-toast';

const axiosLub = axios.create({
  baseURL: 'http://localhost:8002',
  // baseURL: "/lub",
  headers: { 'Content-Type': 'application/json' },
});

axiosLub.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

axiosLub.interceptors.response.use(
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

export default axiosLub;