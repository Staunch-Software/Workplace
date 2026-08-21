// src/modules/reports/api/reportsApi.js
// Axios clients for the Report Tracker module.
//
// Pattern matches DRS (axiosDrs.js):
//   - Production: relative proxy path via Nginx  -> /reports/api/v1
//   - Local dev:  direct localhost URLs (commented in/out as needed)
//
// Shore and Admin users use reportsApi (shoreClient).
// Vessel users use vesselReportsApi (vesselClient).
import axios from 'axios';
import { handleExpiredSession } from '../../../utils/authGuard';

function makeClient(baseURL) {
  const client = axios.create({
    baseURL,
    headers: { 'Content-Type': 'application/json' },
  });
  client.interceptors.request.use((config) => {
    const token = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
    if (token) config.headers['Authorization'] = `Bearer ${token}`;
    return config;
  }, (error) => Promise.reject(error));

  client.interceptors.response.use(
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
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// !! DEPLOYMENT SWITCH — change ONLY the active (uncommented) line per env !!
// ─────────────────────────────────────────────────────────────────────────────

// ── Shore client (SHORE + ADMIN) ──
// PRODUCTION (Nginx proxy):
const shoreClient = makeClient('/reports/api/v1');
// DEV (local):              const shoreClient = makeClient('http://localhost:8006/api/v1');
// DIRECT VM (staging):       const shoreClient = makeClient('http://52.172.91.85:8006/api/v1');

// ── Vessel client (VESSEL role — hits the vessel's LOCAL backend) ──
// PRODUCTION (vessel intranet):
const vesselClient = makeClient('/reports/api/v1');
// DEV (local):              const vesselClient = makeClient('http://localhost:8006/api/v1');

// ── Core client (workplace-backend control plane — owns users & vessels) ──
// PRODUCTION (Nginx proxy):
const coreClient = makeClient('/api/v1');
// DEV (local):              const coreClient = makeClient('http://localhost:8000/api/v1');

// --- Shore API (SHORE + ADMIN) ---
export const reportsApi = {
  getVessels: () => coreClient.get("/vessels").then((r) => r.data),
  listReports: (params = {}) =>
    shoreClient.get("/reports", { params }).then((r) => r.data),
  getReport: (reportId) =>
    shoreClient.get(`/reports/${reportId}`).then((r) => r.data),
  getPdfUrl: (reportId) =>
    shoreClient.get(`/reports/${reportId}/pdf`).then((r) => r.data),
  getPdfUrlByPath: (reportId, path) =>
    shoreClient.get(`/reports/${reportId}/pdf`, { params: path ? { path } : {} }).then((r) => r.data),
  getThreads: (reportId) =>
    shoreClient.get(`/reports/${reportId}/threads`).then((r) => r.data),
  postThread: (reportId, payload) =>
    shoreClient.post(`/reports/${reportId}/threads`, payload).then((r) => r.data),
  getThreadUploadSasUrl: (reportId, blobPath) =>
    shoreClient.get(`/reports/${reportId}/upload-sas`, { params: { path: blobPath } }).then(r => r.data),
  getThreadAttachmentUrl: (reportId, threadId, attachmentId) =>
    shoreClient.get(`/reports/${reportId}/threads/${threadId}/attachments/${attachmentId}/url`).then(r => r.data),
  uploadToAzureBlob: async (file, sasUrl) => {
    return axios.put(sasUrl, file, {
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": file.type || "application/octet-stream" }
    });
  },
  // Config endpoints
  listConfigs: () =>
    shoreClient.get("/reports/config").then((r) => r.data),
  createConfig: (config) =>
    shoreClient.post("/reports/config", config).then((r) => r.data),
  deleteConfig: (configId) =>
    shoreClient.delete(`/reports/config/${configId}`).then((r) => r.data),
  bulkAssignVessel: (vessel_imo, vessel_name) =>
    shoreClient.post("/reports/config/bulk-assign", { vessel_imo, vessel_name }).then((r) => r.data),
  // Activity Feed
  getFeed: (params = {}) => shoreClient.get("/feed", { params }).then((r) => r.data),
  // Notifications
  getNotifications: () =>
    shoreClient.get("/notifications").then((r) => r.data),
  markNotificationRead: (id) =>
    shoreClient.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllNotificationsRead: () =>
    shoreClient.post("/notifications/read-all").then((r) => r.data),
};

// --- Vessel API (VESSEL + ADMIN) - offline-first local backend ---
export const vesselReportsApi = {
  getVessels: () => coreClient.get("/vessels").then((r) => r.data),
  listReports: (params = {}) =>
    vesselClient.get("/reports", { params }).then((r) => r.data),
  getReport: (reportId) =>
    vesselClient.get(`/reports/${reportId}`).then((r) => r.data),
  // PDF SAS URL - uses Azurite on vessel
  getPdfUrl: (reportId) =>
    vesselClient.get(`/reports/${reportId}/pdf`).then((r) => r.data),
  getPdfUrlByPath: (reportId, path) =>
    vesselClient.get(`/reports/${reportId}/pdf`, { params: path ? { path } : {} }).then((r) => r.data),
  getThreads: (reportId) =>
    vesselClient.get(`/reports/${reportId}/threads`).then((r) => r.data),
  // Message queued offline -> pushed by sync worker when online
  postThread: (reportId, payload) =>
    vesselClient.post(`/reports/${reportId}/threads`, payload).then((r) => r.data),
  getThreadUploadSasUrl: (reportId, blobPath) =>
    vesselClient.get(`/reports/${reportId}/upload-sas`, { params: { path: blobPath } }).then(r => r.data),
  getThreadAttachmentUrl: (reportId, threadId, attachmentId) =>
    vesselClient.get(`/reports/${reportId}/threads/${threadId}/attachments/${attachmentId}/url`).then(r => r.data),
  uploadToAzureBlob: async (file, sasUrl) => {
    return axios.put(sasUrl, file, {
      headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": file.type || "application/octet-stream" }
    });
  },
  // Verify a report (queued offline -> pushed by sync worker)
  verifyReport: (reportId, verifiedBy) =>
    vesselClient.post(`/reports/${reportId}/verify`, { verified_by: verifiedBy }).then((r) => r.data),
  // Activity Feed
  getFeed: (params = {}) => vesselClient.get("/feed", { params }).then((r) => r.data),
  // Notifications
  getNotifications: () =>
    vesselClient.get("/notifications").then((r) => r.data),
  markNotificationRead: (id) =>
    vesselClient.post(`/notifications/${id}/read`).then((r) => r.data),
  markAllNotificationsRead: () =>
    vesselClient.post("/notifications/read-all").then((r) => r.data),
};
