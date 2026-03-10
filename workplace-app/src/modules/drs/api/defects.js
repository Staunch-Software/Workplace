// src/api/defects.js
import api from './axios';

export const getDefects = async (vesselImo = '') => {
  // If a vessel is selected, we send it to backend to filter
  const params = vesselImo ? { vessel_imo: vesselImo } : {};
  const response = await api.get('/defects/', { params });
  return response.data;
};