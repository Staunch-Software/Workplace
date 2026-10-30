// Time in the ORB screens: stored and synced as UTC, shown in IST (Asia/Kolkata), whatever the PC says.
// A vessel PC often has the wrong clock or time zone, so nothing here reads the PC's time zone, and "now" is the
// server's time (nowMs), not Date.now().
export const IST_TZ = 'Asia/Kolkata';

let serverOffsetMs = 0;

// Ask the backend what time it is and remember how far this browser's clock is from it.
export async function syncServerClock(api) {
  try {
    const t0 = Date.now();
    const res = await api.get('/api/time');
    const t1 = Date.now();
    const server = Date.parse(res.data.server_time);
    if (Number.isFinite(server)) serverOffsetMs = server - (t0 + (t1 - t0) / 2);
  } catch {
    /* keep the last offset */
  }
}

export const nowMs = () => Date.now() + serverOffsetMs;

// A timestamp without a zone is UTC (the API sends +00:00); never let the browser read it as local time.
export const parseTs = (iso) => {
  if (iso instanceof Date) return iso;
  if (typeof iso === 'number') return new Date(iso);
  const s = String(iso);
  return new Date(/([zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`);
};

const fmt = (opts) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: IST_TZ, ...opts });
  return (iso) => (iso ? f.format(parseTs(iso)) : '');
};

export const fmtDate = fmt({ day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDayMonthTime = fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtFull = fmt({ day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtDateTime = (iso) => (iso ? `${fmtFull(iso)} IST` : '');
const fmtClock = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtDateDotTime = (iso) => (iso ? `${fmtDate(iso)} · ${fmtClock(iso)}` : '');

// A Date whose local fields (year, month, day, hours ...) are the IST wall clock of the given moment, so code that
// compares calendar days or months can use getFullYear()/getMonth()/getDate() without touching the PC's zone.
export const istWall = (when = nowMs()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(parseTs(when));
  const v = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return new Date(v.year, v.month - 1, v.day, v.hour % 24, v.minute, v.second);
};

// YYYY-MM-DD from a Date's local fields (not toISOString, which shifts the day by the PC's zone).
export const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const istToday = () => { const d = istWall(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
export const daysSince = (iso) => Math.floor((nowMs() - parseTs(iso).getTime()) / 86400000);
