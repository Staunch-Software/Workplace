// src/modules/reports/api/axiosReports.js
// Raw Axios client for the Report Tracker backend.
// Used by the Navbar VesselStatusModal for sync-status/all and sync-log endpoints.
// Pattern matches axiosDrs.js / axiosJira.js — returns the full Axios response
// so callers can access res.data directly.
import axios from 'axios';
import { handleExpiredSession } from '../../../utils/authGuard';

const isDev = import.meta.env.DEV;

const apiReports = axios.create({
  baseURL: isDev ? 'http://localhost:8006/api/v1' : '/reports/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

apiReports.interceptors.request.use(
  (config) => {
    const token =
      localStorage.getItem('platform_token') ||
      sessionStorage.getItem('platform_token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error),
);

apiReports.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail || '';
    if (
      status === 401 ||
      (status === 403 && detail === 'Could not validate credentials')
    ) {
      handleExpiredSession();
    }
    return Promise.reject(err);
  },
);

export default apiReports;
