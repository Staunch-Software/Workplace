// Incident dates are plain calendar dates (YYYY-MM-DD): format them without any time-zone shift.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtDay = (ymd) => {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
};

// Timestamps come from the API as UTC; shown in IST like the rest of the app (ORB).
export const parseTs = (iso) => {
  const s = String(iso);
  return new Date(/([zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
};
const stamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
export const fmtStamp = (iso) => (iso ? stamp.format(parseTs(iso)) : '');

export const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const newId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

// "5m ago", "3h ago", "2d ago", then the date.
export const ago = (iso) => {
  const s = Math.max(0, (Date.now() - parseTs(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return stamp.format(parseTs(iso));
};

// Calendar day in IST, for grouping the feed under "Today" / "Yesterday" / a date.
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const dayName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' });
export const dayOf = (iso) => dayKey.format(parseTs(iso));
export const dayLabel = (iso) => {
  const key = dayOf(iso);
  if (key === dayKey.format(new Date())) return 'Today';
  if (key === dayKey.format(new Date(Date.now() - 86400000))) return 'Yesterday';
  return dayName.format(parseTs(iso));
};

// The bell and the Feed tab badge refresh each other through this event (read/unread changes anywhere).
export const UNREAD_EVENT = 'incident-unread-changed';
export const announceUnreadChange = () => window.dispatchEvent(new Event(UNREAD_EVENT));
