// src/modules/reports/reportOrder.js
// Canonical display order for report forms, as defined in
// "Reports_List - Reviewed.xlsx" (and mirrored by
// Reports-backend/data/default_reports_config.json). Reports not present in
// this list sort after all known ones, alphabetically among themselves.

const REPORT_NAME_ORDER = [
  'WEEKLY - 01 - DECK WEEKLY WORKDONE REPORT',
  'WEEKLY - 02 - ENG WEEKLY WORKDONE REPORT',
  'WEEKLY - 03 - ELECTRICAL WEEKLY WORKDONE REPORT',
  'WEEKLY - 04 - DECK CORROSION MAINTENANCE PLAN',
  'WEEKLY - 05 - WEEKLY BUNKER REPORT',
  'WEEKLY - 06 - BOILER AND COOLER WATER REPORT',
  'TECH-57 ONBOARD LO WEEKLY ANALYSIS REPORT',
  'TECH-07 ME PERFORMANCE SHEET',
  'TECH-06 ENGINE PERFORMANCE TREND',
  'TECH-12 AE-1 PERFORMANCE SHEET',
  'TECH-12 AE-2 PERFORMANCE SHEET',
  'TECH-12 AE-3 PERFORMANCE SHEET',
  'TECH-13 AUXILIARY ENGINE PERFORMANCE TREND',
  'TECH-08A SCAVENGE PORT INSPECTION TEMPLATE',
  'TECH-55 SCRAPE DOWN ANALYSIS TEST',
  'TECH-56 MONTHLY LO CONSUMPTION REPORT',
  'TECH-11 CHEMICAL CONSUMPUTION RECORD',
  'OPR-06 MONTHLY PAINT CONSUMPTION REPORT',
  'TECH-01 CORROSION MAINTENANCE TOOL',
  'MONTHLY - 05- LIST OF PRECISION TOOLS AND EQUIPMENT',
  'MONTHLY - 03 - ENGINE MONTH END REPORT',
  'MONTHLY - 04 - MONTHLY PARAMETERS',
  'OPT - BCR - 11 - TANK SOUNDING REPORT',
  'MONTHLY - 11 - OIL RECORD BOOK',
  'TECH-04 MONTHLY MARPOL REPORT',
  'SAF 24 - GARBAGE RECORD BOOK',
  'OPR 26 - BALLAST RECORD BOOK',
  'MONTHLY - 09 - BWTS OPERATIONAL DATA DUMP RECORD',
  'TECH-38A SEAL INVENTORY FORM',
  'MONTHLY - 06 - BATTERY LOG',
  'TECH-49 MGPS LOG',
  'TECH-48 ICCP LOG',
  'TECH-10 VIBRATION ANALYSIS REPORT',
  'TECH-15 ME CRANKWEB DEFLECTION REPORT',
  'TECH-15 AE-1 CRANKWEB DEFLECTION REPORT',
  'TECH-15 AE-2 CRANKWEB DEFLECTION REPORT',
  'TECH-15 AE-3 CRANKWEB DEFLECTION REPORT',
  'TECH-16 MAIN ENGINE BEARING CLEARANCES',
  'QUARTER-01 - VESSEL CONDITION REPORT-DECK',
  'QUARTER-02 - VESSEL CONDITION REPORT-ENGINE',
];

/* Same normalization the shore pages already apply to report_name before
   comparing/grouping — keep this in sync with normalizeName() in
   OverviewPage.jsx / ShoreReportsPage.jsx / ReportConfigPage.jsx. */
function normalizeForOrder(name) {
  if (!name) return 'UNKNOWN';
  let cleaned = name.trim().toUpperCase().replace(/\s+/g, ' ').replace(/\s*[-–—]\s*/g, '-');
  if (cleaned.endsWith(' REVIEW')) {
    cleaned = cleaned.replace(/ REVIEW$/, '').trim();
  }
  return cleaned;
}

const REPORT_ORDER_INDEX = new Map(
  REPORT_NAME_ORDER.map((name, i) => [normalizeForOrder(name), i])
);

/** Index of a report name in the canonical order, or Infinity if unknown. */
export function reportOrderIndex(name) {
  const idx = REPORT_ORDER_INDEX.get(normalizeForOrder(name));
  return idx === undefined ? Infinity : idx;
}

/** Comparator: sort report names by the canonical Excel order, unknown
    names last (alphabetically among themselves). */
export function compareReportNames(a, b) {
  const ia = reportOrderIndex(a);
  const ib = reportOrderIndex(b);
  if (ia !== ib) return ia - ib;
  return String(a).localeCompare(String(b));
}
