import axios from 'axios';

const axiosAepms = axios.create({
  baseURL: import.meta.env.VITE_AEPMS_API_URL || 'http://localhost:8005',
});

axiosAepms.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

export default axiosAepms;