/**
 * dateUtils.js — Shared date formatting utility for the Reports module.
 *
 * RULES:
 *  - All dates from the backend/DB are stored as UTC (naive datetimes without timezone).
 *  - The browser's `new Date(isoString)` already treats a naive ISO string as UTC and
 *    converts it to the LOCAL timezone of the device automatically.
 *  - Therefore all helpers here simply use the browser's local timezone for DISPLAY.
 *  - DO NOT use moment/dayjs; DO NOT pass timezone strings — browser handles TZ correctly.
 *  - Locale is always 'en-GB' for consistent dd-mmm-yyyy display order across browsers.
 */

/**
 * Format a date string as "25 Aug 2026" (local time, date only).
 * Used in report list tables for due_date, next_due_date, job_start_date, job_end_date.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
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
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
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
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Format a date string as "25 Aug 2026, 10:30" (local date + time).
 * Used in thread message timestamps.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-GB', {
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
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date string as a relative feed label with a time component:
 *   - Same day  → "Today at 10:30"
 *   - Yesterday → "Yesterday at 10:30"
 *   - Older     → "25 Aug 2026, 10:30"
 * Uses LOCAL time for all comparisons. The "Today/Yesterday" boundary is
 * computed from the device's local midnight, not UTC midnight.
 * Used in ReportFeedPage and VesselReportFeedPage.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtRelativeDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();

  // Compare calendar days in local time
  const localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((localToday - localDate) / 86400000);

  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `Today at ${time}`;
  if (diffDays === 1) return `Yesterday at ${time}`;
  return `${fmtDate(d)}, ${time}`;
}

/**
 * Format a date string as a relative date label (NO time):
 *   - Same day  → "Today"
 *   - Yesterday → "Yesterday"
 *   - Older     → "25 August 2026"
 * Used in ActivityFeedPage date group dividers.
 * @param {string|Date|null} dateStr
 * @returns {string}
 */
export function fmtRelativeDateLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();

  const localDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
  const d = String(date.getDate()).padStart(2, '0');
  const m = date.toLocaleDateString('en-GB', { month: 'short' });
  return `${d}${m}${date.getFullYear()}`;
}
