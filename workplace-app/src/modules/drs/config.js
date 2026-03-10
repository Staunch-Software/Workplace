// src/config.js

const env = import.meta.env ? import.meta.env : process.env;

export const CONFIG = {
  API_BASE_URL: env.VITE_API_URL || 'http://localhost:4000/api',
  AZURE_STORAGE_URL: env.VITE_AZURE_BLOB_URL, // e.g. https://acct.blob.core.windows.net/pdf-repository
};