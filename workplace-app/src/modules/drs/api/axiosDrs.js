import axios from 'axios';

const apiDrs = axios.create({
  // baseURL: 'http://localhost:8001/api/v1', // drs-backend
  // baseURL: 'http://52.172.91.85:8001/api/v1',
  baseURL: "/drs",
  headers: { 'Content-Type': 'application/json' },
});

apiDrs.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

export default apiDrs;