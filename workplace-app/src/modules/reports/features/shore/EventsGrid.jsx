// src/modules/reports/features/shore/EventsGrid.jsx
// Overview "Events" tab: logbook column (rows) x vessel (columns), with
// the last 5 Vessel_Performance logbook events per vessel (each log row is an event, a day with
// no report counts as one "Missing" event).
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, FileWarning, AlertCircle, Search, X, CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { reportsApi } from '../../api/reportsApi';
import '../../styles/EventsCells.css';

const EVENTS = 5;
const SOURCES = [
  { id: 'mari_apps', label: 'MariApps' },
  { id: 'wni', label: 'WNI' },
];
const SECTIONS = ['Log Info', 'Performance', 'Emission'];
const SECTION_CLASS = { 'Log Info': 'info', Performance: 'perf', Emission: 'emis' };

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fmtValue(v) {
  if (v === null || v === undefined || v === '') return '-';
  const n = Number(v);
  if (v !== '' && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(String(v).trim())) {
    return String(Math.round(n * 1000) / 1000);
  }
  return String(v);
}

function toIso(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function EventsGrid({ vessels, search, setSearch }) {
  const [source, setSource] = useState('mari_apps');
  const [anchor, setAnchor] = useState(null); // null = today (latest)
  const [page, setPage] = useState(0); // 0 = newest EVENTS events; n = n pages further back
  const [selected, setSelected] = useState(() => new Set()); // highlighted rows
  // Plain click = single select (click again to clear); Shift+click = add/remove for multi select.
  const toggleRow = (key, e) => setSelected(prev => {
    if (e?.shiftKey) {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    }
    return prev.size === 1 && prev.has(key) ? new Set() : new Set([key]);
  });

  // Re-evaluated every few minutes so a page left open past midnight rolls over to the new day.
  const [todayIso, setTodayIso] = useState(() => toIso(new Date()));
  useEffect(() => {
    const t = setInterval(() => setTodayIso(prev => { const n = toIso(new Date()); return n === prev ? prev : n; }), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const activeEndIso = anchor || todayIso;
  const isAtLatest = page === 0 && (!anchor || anchor >= todayIso);

  const { data, isLoading, isPlaceholderData, error } = useQuery({
    queryKey: ['events-logbook', source, activeEndIso, page],
    queryFn: () => reportsApi.getEventsLogbook({ source, limit: EVENTS, offset: page * EVENTS, end_date: activeEndIso }),
    refetchInterval: 60000,
    // keep the previous events on screen while paging, but never show the other source's columns
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey?.[1] === source ? prev : undefined),
  });

  const onPickDate = (e) => {
    const v = e.target.value;
    if (!v) return;
    setPage(0);
    setAnchor(v >= todayIso ? null : v);
  };
  const resetLatest = () => { setAnchor(null); setPage(0); };

  const byImo = useMemo(() => {
    const m = {};
    (data?.vessels || []).forEach(v => { m[v.imo] = v.rows; });
    return m;
  }, [data]);

  const viaBackup = useMemo(() => {
    const m = {};
    (data?.vessels || []).forEach(v => { if (v.via) m[v.imo] = true; });
    return m;
  }, [data]);

  // Each vessel shows its own last EVENTS events, oldest -> newest. Every logbook row is one event
  // (a day with 3 rows = 3 events) and a day with no report is one "Missing" event.
  const slotCols = useMemo(() => {
    const out = {};
    vessels.forEach(v => {
      let evs = byImo[v.imo];
      if (!evs && !isPlaceholderData) {
        // vessel has no logbook rows at all: every day back from the end date is a missing event
        evs = [];
        const day = parseIso(activeEndIso);
        day.setDate(day.getDate() - page * EVENTS);
        while (evs.length < EVENTS && evs.length < 60) {
          const iso = toIso(day);
          if (iso < todayIso) evs.unshift({ _missing: true, _ts: iso });
          day.setDate(day.getDate() - 1);
        }
        evs = evs.slice(-EVENTS);
      }
      evs = evs || [];
      const slots = evs.map((ev, i) => ({
        ev,
        dayStart: i === 0 || evs[i - 1]._ts.slice(0, 10) !== ev._ts.slice(0, 10),
      }));
      while (slots.length < EVENTS) slots.push({ ev: null, dayStart: slots.length === 0 });
      out[v.imo] = slots;
    });
    return out;
  }, [vessels, byImo, isPlaceholderData, activeEndIso, page, todayIso]);

  const totalCols = vessels.length * EVENTS;

  const rangeLabel = anchor ? `Up to ${fmtDay(anchor)}` : 'Latest 5 events';
  const pageLabel = page === 0 ? '' : ` · ${page * EVENTS + 1}–${(page + 1) * EVENTS} back`;

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return SECTIONS.map(name => ({
      name,
      cols: (data?.columns || [])
        .filter(c => c.category === name)
        .filter(c => !q || c.display_name.toLowerCase().includes(q)),
    })).filter(s => s.cols.length > 0);
  }, [data, search]);

  

  return (
    <>
      <div className="ovw-control-bar">
        <div className="ovw-control-left">
          <div className="ovw-freq-tabs">
            {SOURCES.map(s => (
              <button
                key={s.id}
                className={`ovw-freq-tab ${source === s.id ? 'active' : ''}`}
                onClick={() => { setSource(s.id); resetLatest(); }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="ovw-daily-nav-group">
            <button type="button" className="ovw-nav-arrow-btn" onClick={() => setPage(p => p + 1)} title="Previous 5 events">
              <ChevronLeft size={14} />
            </button>
            <label className="ovw-compact-select ovw-daily-picker-label" title="Click to pick an end date">
              <span className="ovw-compact-select-icon"><CalendarDays size={13} /></span>
              <span className="ovw-compact-select-value">
                {rangeLabel}{pageLabel}
              </span>
              <input
                type="date"
                className="ovw-hidden-date-input"
                value={activeEndIso}
                max={todayIso}
                onChange={onPickDate}
              />
            </label>
            <button
              type="button"
              className="ovw-nav-arrow-btn"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              title={page === 0 ? 'Already at latest' : 'Next 5 events'}
            >
              <ChevronRight size={14} />
            </button>
            {!isAtLatest && (
              <button type="button" className="ovw-reset-latest-btn" onClick={resetLatest} title="Jump back to the latest events">
                <RotateCcw size={11} style={{ marginRight: 4 }} />
                Latest
              </button>
            )}
          </div>
          {selected.size > 0 && (
            <button type="button" className="ev-clear-sel" onClick={() => setSelected(new Set())}>
              <X size={12} /> Clear {selected.size} selected
            </button>
          )}
          <div className="ovw-stat-strip">
            <span className="ovw-stat-pill">
              <strong>{vessels.length}</strong>&nbsp;vessels
            </span>
            <span className="ovw-stat-pill">
              Last <strong>&nbsp;{EVENTS}&nbsp;</strong> events per vessel
            </span>
          </div>
        </div>
        <div className="ovw-control-right">
          <div className="ovw-search-box">
            <Search size={13} />
            <input
              type="text"
              placeholder="Filter column name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="ovw-search-clear" onClick={() => setSearch('')}>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="ovw-card">
        {isLoading ? (
          <div className="ovw-state-container">
            <div className="ovw-spinner-ring" />
            <p className="ovw-state-label">Loading logbook data…</p>
          </div>
        ) : error ? (
          <div className="ovw-state-container">
            <div className="ovw-empty-icon-wrap"><AlertCircle size={32} /></div>
            <p className="ovw-state-label">Could not load logbook data</p>
            <p className="ovw-state-sub">{error.response?.data?.detail || error.message}</p>
          </div>
        ) : sections.length === 0 || vessels.length === 0 ? (
          <div className="ovw-state-container">
            <div className="ovw-empty-icon-wrap"><FileWarning size={32} /></div>
            <p className="ovw-state-label">No logbook data found</p>
            <p className="ovw-state-sub">Try another source or clear the filter</p>
          </div>
        ) : (
          <div className={`ovw-table-scroll${isPlaceholderData ? ' ev-loading' : ''}`}>
            <table className="ovw-table ev-grid" style={{ width: `${280 + totalCols * 112}px` }}>
              <colgroup>
                <col style={{ width: 280, minWidth: 280, maxWidth: 280 }} />
                {Array.from({ length: totalCols }, (_, i) => (
                  <col key={i} style={{ width: 112, minWidth: 112, maxWidth: 112 }} />
                ))}
              </colgroup>
              <thead>
                <tr className="ovw-thead-row1">
                  <th className="ovw-th-report ovw-sticky-col" rowSpan={2}>
                    <div className="ovw-th-report-inner">
                      <Layers size={13} className="ovw-th-icon" />
                      Logbook Column
                    </div>
                  </th>
                  {vessels.map((v, vi) => (
                    <th key={v.imo} className={`ovw-th-vessel${vi % 2 ? ' grp-odd' : ''}`} colSpan={slotCols[v.imo].length}>
                      <div className="ovw-th-vessel-inner">
                        <span className="ovw-vessel-name">{v.name}</span>
                        <span className="ovw-vessel-imo">IMO {v.imo}</span>
                        {viaBackup[v.imo] && (
                          <span className="ev-via" title="No MariApps data for this period; showing Excel / email noon reports">Excel / Mail</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
                <tr className="ovw-thead-row2">
                  {vessels.map((v, vi) =>
                    slotCols[v.imo].map((sl, i) => {
                      const ts = sl.ev?._ts;
                      const isToday = ts?.slice(0, 10) === todayIso;
                      return (
                        <th
                          key={`${v.imo}-${i}`}
                          className={`ovw-th-week${isToday ? ' ovw-th-week-current' : ''}${vi % 2 ? ' grp-odd' : ''}`}
                          title={ts || ''}
                        >
                          {ts && fmtDay(ts.slice(0, 10))}
                          {isToday && <span className="ovw-current-week-dot" />}
                          {sl.ev?._missing && <span className="ev-missing-tag">Missing</span>}
                        </th>
                      );
                    })
                  )}
                </tr>
              </thead>
              <tbody>
                {sections.map(sec => (
                  <React.Fragment key={sec.name}>
                    <tr className={`ovw-ev-section ${SECTION_CLASS[sec.name]}`}>
                      <td className="ovw-sticky-col ovw-ev-section-label">{sec.name}<em>{sec.cols.length}</em></td>
                      <td colSpan={totalCols} className="ovw-ev-section-fill" />
                    </tr>
                    {sec.cols.map((c, rowIdx) => (
                      <tr
                        key={`${sec.name}-${c.db_column}`}
                        className={`ovw-row ovw-ev-row ${rowIdx % 2 === 0 ? 'even' : 'odd'}${selected.has(`${sec.name}-${c.db_column}`) ? ' ev-selected' : ''}`}
                        onClick={(e) => {
                          window.getSelection?.()?.removeAllRanges();
                          toggleRow(`${sec.name}-${c.db_column}`, e);
                        }}
                        title="Click to highlight this row · Shift+click to select multiple"
                      >
                        <td className="ovw-td-report ovw-sticky-col">
                          <span className="ovw-report-name">
                            {c.display_name}
                          </span>
                          {c.unit && <span className="ev-unit">{c.unit}</span>}
                        </td>
                        {vessels.map((v, vi) =>
                          slotCols[v.imo].map((sl, i) => {
                            const missingDay = !!sl.ev?._missing;
                            const val = fmtValue(sl.ev?.[c.db_column]);
                            const empty = val === '-';
                            const isNum = !empty && /^-?\d+(\.\d+)?$/.test(val);
                            return (
                              <td
                                key={`${v.imo}-${i}`}
                                className={`ovw-td-cell ovw-td-week ovw-ev-cell${sl.dayStart ? ' first' : ''}${empty ? ' empty' : ''}${missingDay ? ' missing' : ''}${!empty && !isNum ? ' text' : ''}${vi % 2 ? ' grp-odd' : ''}`}
                                title={empty ? '' : val}
                              >
                                {!empty && !isNum ? <span className="ev-pill">{val}</span> : val}
                              </td>
                            );
                          })
                        )}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
