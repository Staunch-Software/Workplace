// ✅ ONLY SHOW THESE TWO IN DROPDOWNS (PENDING_CLOSURE is internal state only)
export const STATUS_OPTIONS = ['OPEN', 'CLOSED'];
export const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const DEADLINE_STATUS_OPTIONS = ['NORMAL', 'WARNING', 'OVERDUE'];
export const PR_STATUS_OPTIONS = ['Not Set', 'Requested', 'Approved', 'Ordered', 'Delivered', 'Rejected'];
// Inside src/components/shared/constants.js
export const COMPONENT_OPTIONS = [
  "HULL",
  "DECK",
  "SHIP ACCESS",
  "DECK MACHINERIES",
  "CARGO SYSTEM",
  "RADIO AND NAVIGATION",
  "BALLAST AND FUEL TANKS",
  "PAINT STORE WORKSHOP",
  "ACCOMMODATION SUPERSTRUCTURE",
  "ENGINE ROOM",
  "EMERGENCY MACHINERIES",
  "LIFE SAVING APPLIANCE",
  "FIRE FIGHTING APPLIANCE",
  "POLLUTION PREVENTION",
  "PMS",
  "ENERGY MANAGEMENT",
  "ELEVATOR",
  "MLC QHSE",
  "SECURITY",
  "CREW INTERACTION"
];

export const DEFECT_SOURCE_OPTIONS = [
  "Office - Technical", "Office - Operation", "Internal Audit", "External Audit",'Vessel',
  "Third Party - RS", "Third Party - PnI", "Third Party - Charterer",
  "Third Party - Other", "Owner's Inspection"
];

export const DEFECT_SOURCE_MAP = {
  "Office - Technical": "OFC-TECH",
  "Office - Operation": "OFC-OPS",
  "Internal Audit": "INT.AUD",
  "External Audit": "EXT.AUD",
  'Vessel': 'VESSEL',
  "Third Party - RS": "3rd PTY-RS",
  "Third Party - PnI": "3rd PTY-PNI",
  "Third Party - Charterer": "3rd PTY-CHTR",
  "Third Party - Other": "3rd PTY-OTH",
  "Owner's Inspection": "OWNER"
};

export const COLUMN_DEFINITIONS = [
  { id: 'date', label: 'Date of Report', description: 'When the defect was reported' },
  { id: 'deadline', label: 'Deadline', description: 'Target completion date' },
  { id: 'source', label: 'Defect Source', description: 'Origin of the defect report' },
  { id: 'equipment', label: 'Area of Concern', description: 'Equipment or system affected' },
  { id: 'description', label: 'Description', description: 'Detailed description of the defect' },
  { id: 'priority', label: 'Priority Icon', description: 'Defect priority level (Critical/High/Medium/Low)' },
  { id: 'status', label: 'Status Icon', description: 'Current status (Open/Closed)' },
  { id: 'deadline_icon', label: 'Deadline Status Icon', description: 'Visual indicator for deadline urgency' },
  { id: 'chat', label: 'Discussion Icon', description: 'Open discussion thread' },
  { id: 'pr_details', label: 'PR Details', description: 'Purchase requisition information' },
    // In your constants file, add to SHORE_COLUMN_DEFINITIONS:
  { id: 'flag', label: 'Flag', description: 'Flag defect to show at top'  },
  { id: 'dd', label: 'Dry Dock' }
  
];

// ✅ SHORE-ONLY COLUMNS (extends base)
export const SHORE_COLUMN_DEFINITIONS = [
  ...COLUMN_DEFINITIONS,
  {
    id: 'owner',
    label: 'Owner',
    description: 'Indicates whether this defect is owned by shore'
  },

];



export const COLUMN_MIN_WIDTHS = {
  sno: 50,
  date_identified: 110,
  target_close_date: 120,
  defect_source: 80,
  equipment: 150,
  description: 300,   // 👈 IMPORTANT
  actions: 120,
  pr_number: 80
};

// 🔹 Date helpers
export const formatDate = (dateStr) => {
  if (!dateStr) return '-';

  return new Date(dateStr)
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit'
    })
    .replace(/\s+/g, '-');
};

export const toLocalDateInput = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// 🔹 Deadline helpers
export const getDeadlineStatus = (targetCloseDate) => {
  if (!targetCloseDate) return 'NORMAL';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deadline = new Date(targetCloseDate);
  deadline.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil(
    (deadline - today) / (1000 * 60 * 60 * 24)
  );

  if (diffDays < 0) return 'OVERDUE';
  if (diffDays <= 15) return 'WARNING';
  return 'NORMAL';
};

// 🔹 Defect source helpers
export const getDefectSourceLabel = (value) =>
  DEFECT_SOURCE_MAP[value] || value;

// 🔹 Pagination helper
export const paginate = (data, currentPage, pageSize) => {
  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  return data.slice(start, end);
};

// ✅ Status color helper
export const getStatusColor = (status) => {
  switch (status) {
    case 'OPEN': return '#3b82f6'; // Blue
    case 'PENDING_CLOSURE': return '#f59e0b'; // Orange
    case 'CLOSED': return '#22c55e'; // Green
    default: return '#94a3b8'; // Grey
  }
};

// ✅ Filter-only options (includes internal states for filtering)
export const FILTER_STATUS_OPTIONS = ['OPEN', 'PENDING_CLOSURE', 'CLOSED'];