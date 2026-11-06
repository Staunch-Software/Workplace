/**
 * DRS Time Utilities
 * Provides timezone-consistent parsing and IST (Asia/Kolkata) formatting
 * for Notifications and Feed sections across both Shore and Vessel.
 */

export const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Normalizes an incoming date/timestamp.
 * Naive ISO strings (without 'Z' or explicit timezone offset) from Python
 * are treated as UTC by appending 'Z', preventing local browser timezone bias.
 *
 * @param {string|number|Date|null|undefined} iso
 * @returns {Date|null}
 */
export const parseTs = (iso) => {
  if (!iso) return null;
  if (iso instanceof Date) return isNaN(iso.getTime()) ? null : iso;
  if (typeof iso === 'number') {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(iso).trim();
  if (!s) return null;
  // Date-only: YYYY-MM-DD treated as UTC midnight
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(`${s}T00:00:00Z`);
  }
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(hasZone ? s : `${s}Z`);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Returns the YYYY-MM-DD date key in Asia/Kolkata (IST).
 * Used for accurate date-range filtering and Today vs Earlier grouping in IST.
 *
 * @param {string|number|Date} [when=new Date()]
 * @returns {string} e.g. "2026-10-29"
 */
export const getIstDateKey = (when = new Date()) => {
  const d = parseTs(when);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST_TIMEZONE }).format(d);
};

/**
 * Format datetime for Feed rows in IST.
 * Example output: "29 Oct 2026 · 12:03 IST"
 *
 * @param {string|number|Date} dt
 * @returns {string}
 */
export const formatFeedDateTime = (dt) => {
  const d = parseTs(dt);
  if (!d) return '—';
  const dateStr = d.toLocaleDateString('en-GB', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dateStr} · ${timeStr} IST`;
};

/**
 * Format datetime for Notification dropdowns in IST.
 * Example output: "29 Oct, 12:03 IST"
 *
 * @param {string|number|Date} dt
 * @returns {string}
 */
export const formatNotificationDateTime = (dt) => {
  const d = parseTs(dt);
  if (!d) return '';
  const dateStr = d.toLocaleDateString('en-GB', {
    timeZone: IST_TIMEZONE,
    day: 'numeric',
    month: 'short',
  });
  const timeStr = d.toLocaleTimeString('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dateStr}, ${timeStr} IST`;
};
