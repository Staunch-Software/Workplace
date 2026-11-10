// Thumbnails repeat across the list, so each image is fetched once per page load.
export const imageCache = new Map();

// A photo that was deleted must not linger in the cache.
export const forgetImage = (incidentId, fileId) => {
  const key = `${incidentId}/${fileId}`;
  const url = imageCache.get(key);
  if (url) URL.revokeObjectURL(url);
  imageCache.delete(key);
};
