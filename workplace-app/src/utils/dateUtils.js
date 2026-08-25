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

/**
 * Parse a date string from the backend, always treating naive ISO strings as UTC.
 * Python datetime.utcnow() → "2026-08-25T04:06:00" (no "Z") → appends "Z" → UTC.
 * @param {string|Date|null} dateStr
 * @returns {Date|null}
 */
function parseUtc(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const s = String(dateStr).trim();
  // If the string matches YYYY-MM-DDTHH:MM... but has NO timezone suffix, treat as UTC.
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) &&
    !/[Zz]$/.test(s) &&
    !/[+-]\d{2}:\d{2}$/.test(s)
  ) {
    return new Date(s + 'Z');
  }
  return new Date(s);
}

/**
 * Format a date string as "25 Aug 2026" (local time, date only).
 * Used in report list tables for due_date, next_due_date, job_start_date, job_end_date.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtDate(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format a date string as "25 Aug" (local time, day + month only, no year).
 * Used in OverviewPage calendar chips.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtDateShort(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
}

/**
 * Format a date string as "25 August 2026" (local time, long month name).
 * Used in ActivityFeedPage date group labels.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtDateLong(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format a date string as "25 Aug, 10:30" (local date + time).
 * Used in thread message timestamps.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtDateTime(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date string as "10:30" (local time only, HH:mm).
 * Used in ActivityFeedPage event timestamps.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtTime(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '—';
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date string as a relative feed label with a time component:
 *   - Same local day  → "Today at 10:30"
 *   - Previous day   → "Yesterday at 10:30"
 *   - Older          → "25 Aug 2026, 10:30"
 * "Today/Yesterday" is computed from local calendar days, not UTC midnight.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtRelativeDateTime(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '';
  const now = new Date();

  // Strip to midnight in LOCAL time for calendar-day comparison
  const localDate  = new Date(d.getFullYear(),   d.getMonth(),   d.getDate());
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((localToday - localDate) / 86400000);

  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `Today at ${time}`;
  if (diffDays === 1) return `Yesterday at ${time}`;
  return `${fmtDate(d)}, ${time}`;
}

/**
 * Format a date string as a relative date label (NO time):
 *   - Same local day  → "Today"
 *   - Previous day   → "Yesterday"
 *   - Older          → "25 August 2026"
 * Used in ActivityFeedPage date group dividers.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtRelativeDateLabel(dateStr) {
  const d = parseUtc(dateStr);
  if (!d || isNaN(d)) return '';
  const now = new Date();

  const localDate  = new Date(d.getFullYear(),   d.getMonth(),   d.getDate());
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((localToday - localDate) / 86400000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return fmtDateLong(d);
}

/**
 * Format a Date object as "01Aug2026" for use in ZIP file names.
 * @param {Date|null} date
 * @returns {string}
 */
export function fmtFilenameDate(date) {
  if (!date) return '';
  const d = parseUtc(date);
  if (!d || isNaN(d)) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const m   = d.toLocaleDateString('en-GB', { month: 'short' });
  return `${day}${m}${d.getFullYear()}`;
}
