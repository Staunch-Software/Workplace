export const MODULES = [
  'Accounts', 'Admin', 'Certification', 'Chartering', 'Crewing',
  'Dashboard', 'Data Library', 'Financial Reporting', 'LPSQ/HSEQ',
  'LiveFleet', 'MDM', 'New Applicant', 'PMS / Maintenance', 'Payroll',
  'Purchase', 'QDMS', 'Replication', 'Sea Roster', 'Ticketing', 'Training', 'Voyage'
]

export const ENVIRONMENTS = ['Office', 'Vessel', 'Both']

export const PRIORITY_OPTIONS = [
  {
    value: 'Critical',
    label: 'Critical',
    description: 'The incident has caused the solution or specific module to cease being operational and no workaround is readily available. (e.g. Database crash / Application Startup error)'
  },
  {
    value: 'Major',
    label: 'Major',
    description: 'An application bug occurred which is NOT a showstopper but has an urgent impact on the solution. Workaround might exist.'
  },
  {
    value: 'Minor',
    label: 'Minor',
    description: 'Some features malfunction. Software works with some issues. Workaround might exist.'
  }
]

export const STATUS_COLORS = {
  'Sup In Progress':                  '#dbeafe|#1e40af',
  'Dev In Progress':                  '#ede9fe|#5b21b6',
  'Waiting for Customer':             '#fef9c3|#92400e',
  'Waiting for Support':              '#dbeafe|#1e40af',
  'In Progress':                      '#dbeafe|#1e40af',
  'Pending':                          '#ffedd5|#9a3412',
  'On Hold':                          '#ffedd5|#9a3412',
  'READY FOR UAT':                    '#cffafe|#155e75',
  'UAT IN PROGRESS':                  '#cffafe|#155e75',
  'QA IN PROGRESS':                   '#cffafe|#155e75',
  'CR Approved':                      '#ccfbf1|#115e59',
  'Ready for Production':             '#ccfbf1|#115e59',
  'Resolved':                         '#dcfce7|#166534',
  'Resolved Awaiting Confirmation':   '#dcfce7|#166534',
  'Cancelled':                        '#f3f4f6|#374151',
  'Closed':                           '#e5e7eb|#4b5563',
  'PENDING':                          '#ffedd5|#c2410c',
  'SUBMITTED':                        '#dbeafe|#1d4ed8',
  'FAILED':                           '#fee2e2|#b91c1c',
  'SYNCED':                           '#dcfce7|#15803d',
}
