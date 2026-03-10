import api from './axios';

// Get all vessels
export const getVessels = async () => {
  const response = await api.get('/vessels/');
  return response.data;
};

// Create a new vessel
export const createVessel = async (vesselData) => {
  const response = await api.post('/vessels/', vesselData);
  return response.data;
};