/**
 * dateUtils.js — Shared date formatting utility for the Reports module.
 *
 * THE UTC PARSING BUG & FIX:
 *  - Python's datetime.utcnow() serializes WITHOUT a timezone marker:
 *      "2026-08-25T04:06:00"  ← no "Z" suffix
 *  - JavaScript's new Date("2026-08-25T04:06:00") treats a naive string as LOCAL time,
 *    NOT UTC. On IST (UTC+5:30) this shows 04:06 instead of the correct 09:36.
 *  - FIX: parseUtc() appends "Z" to any naive ISO string before passing to new Date().
 *    This forces the browser to interpret it as UTC and display it in the device's
 *    local timezone correctly (e.g. 04:06 UTC → 09:36 IST).
 *
 *  - Backend/sync: All datetimes remain stored & transmitted as UTC. No backend change.
 *  - Locale: Always 'en-GB' for consistent dd-mmm-yyyy order across browsers.
 */

function getFormatOptions(baseOptions) {
  try {
    const stored = localStorage.getItem('platform_user') || sessionStorage.getItem('platform_user');
    if (stored) {
      const user = JSON.parse(stored);
      if (user && (user.role === 'SHORE' || user.role === 'ADMIN')) {
        return { ...baseOptions, timeZone: 'Asia/Kolkata' };
      }
    }
  } catch (e) {
    // ignore
  }
  return baseOptions;
}

/**
 * Parse a date string from the backend, always treating naive ISO strings as UTC.
 * @param {string|Date|null} dateStr
 * @returns {Date|null}
 */
function parseUtc(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const s = String(dateStr).trim();
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) &&
    !/[Zz]$/.test(s) &&
    !/[+-]\d{2}:\d{2}$/.test(s)
  ) {
    return new Date(s + 'Z');
  }
  return new Date(s);
}

export function fmtDate(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', getFormatOptions({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }));
}

export function fmtDateShort(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', getFormatOptions({
    day: '2-digit',
    month: 'short',
  }));
}

export function fmtDateLong(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', getFormatOptions({
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }));
}

export function fmtDateTime(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleString('en-GB', getFormatOptions({
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }));
}

export function fmtTime(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleTimeString('en-GB', getFormatOptions({
    hour: '2-digit',
    minute: '2-digit',
  }));
}

function getParts(dateObj, timeZone) {
  if (!timeZone) {
    return { y: dateObj.getFullYear(), m: dateObj.getMonth(), d: dateObj.getDate() };
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(dateObj);
  const val = (type) => parseInt(parts.find(p => p.type === type).value, 10);
  return { y: val('year'), m: val('month') - 1, d: val('day') };
}

export function fmtRelativeDateTime(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '';
  const now = new Date();
  
  const opts = getFormatOptions({});
  const dP = getParts(d, opts.timeZone);
  const nP = getParts(now, opts.timeZone);

  const localDate  = new Date(dP.y, dP.m, dP.d);
  const localToday = new Date(nP.y, nP.m, nP.d);
  const diffDays = Math.floor((localToday - localDate) / 86400000);

  const time = d.toLocaleTimeString('en-GB', getFormatOptions({ hour: '2-digit', minute: '2-digit' }));
  if (diffDays === 0) return `Today at ${time}`;
  if (diffDays === 1) return `Yesterday at ${time}`;
  return `${fmtDate(d)}, ${time}`;
}

export function fmtRelativeDateLabel(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '';
  const now = new Date();

  const opts = getFormatOptions({});
  const dP = getParts(d, opts.timeZone);
  const nP = getParts(now, opts.timeZone);

  const localDate  = new Date(dP.y, dP.m, dP.d);
  const localToday = new Date(nP.y, nP.m, nP.d);
  const diffDays = Math.floor((localToday - localDate) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return fmtDateLong(d);
}

export function fmtFilenameDate(date) {
  if (!date) return '';
  const d = parseUtc(date);
  if (!d || isNaN(d)) return '';
  
  const opts = getFormatOptions({});
  const dP = getParts(d, opts.timeZone);
  
  const day = String(dP.d).padStart(2, '0');
  const m = d.toLocaleDateString('en-GB', getFormatOptions({ month: 'short' }));
  return `${day}${m}${dP.y}`;
}
