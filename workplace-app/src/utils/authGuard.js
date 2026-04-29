import toast from 'react-hot-toast';

// Prevent multiple simultaneous logout redirects when several requests expire at once
let _isLoggingOut = false;

export function handleExpiredSession() {
  if (_isLoggingOut) return;
  _isLoggingOut = true;

  localStorage.removeItem('platform_token');
  localStorage.removeItem('platform_user');
  sessionStorage.removeItem('platform_token');
  sessionStorage.removeItem('platform_user');
  // Legacy keys used by older modules
  localStorage.removeItem('app_token');
  localStorage.removeItem('user');

  toast.error('Session expired. Please login again.');
  window.location.href = '/login';
}
