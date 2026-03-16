import axios from 'axios';

const axiosJira = axios.create({
  // baseURL: 'http://localhost:8004',
  baseURL: '/jira',
});

axiosJira.interceptors.request.use((config) => {
  const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
  if (token) config.headers['Authorization'] = `Bearer ${token}`;
  return config;
});

axiosJira.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('platform_token');
      localStorage.removeItem('platform_user');
      sessionStorage.removeItem('platform_token');
      sessionStorage.removeItem('platform_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default axiosJira;