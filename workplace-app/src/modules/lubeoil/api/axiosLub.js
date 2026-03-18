import axios from 'axios';

const axiosLub = axios.create({
  // baseURL: 'http://localhost:8002',
  baseURL: "/lub",
  headers: { 'Content-Type': 'application/json' },
});

axiosLub.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

export default axiosLub;