import axios from 'axios';

const api = axios.create({
  // baseURL: 'http://localhost:8000/api/v1', 
  // baseURL: 'http://52.172.91.85:8003/api/v1',
  baseURL: "/api/v1", //fix
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

export default api;