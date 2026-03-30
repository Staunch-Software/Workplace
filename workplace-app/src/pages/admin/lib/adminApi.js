import api from '../../../api/axios';

// ── Users ──────────────────────────────────────────────
export const getUsers = () => api.get('/users');

export const createUser = (payload) => api.post('/users', payload);

export const updateUser = (id, payload) => api.patch(`/users/${id}`, payload);

export const assignVessels = (id, vessel_imos, plainPassword = null) =>
  api.put(`/users/${id}/vessels`, {
    vessel_imos: vessel_imos,
    plain_password: plainPassword,
  });

export const resendWelcomeEmail = (id) => api.post(`/users/${id}/resend-welcome`);

// ── Vessels ────────────────────────────────────────────
export const getVessels = () => api.get('/vessels');

export const createVessel = (payload) => api.post('/vessels', payload);

export const updateVessel = (imo, payload) => api.patch(`/vessels/${imo}`, payload);

export const updateVesselModuleStatus = (imo, status) =>
  api.patch(`/vessels/${imo}/module-status`, status);