// Mirrors the backend's RED/AMBER/NEUTRAL buckets (see taskmgmt-backend/app/utils/urgency.py)
// — just the color mapping for rendering, the actual bucketing decision is the backend's.
const URGENCY_COLORS = {
  RED: { bg: '#FDECEC', fg: '#B3261E' },
  AMBER: { bg: '#FFF4E0', fg: '#B25E00' },
  NEUTRAL: { bg: 'var(--gray-100)', fg: 'var(--gray-500)' },
};

export function urgencyColor(urgency) {
  return URGENCY_COLORS[urgency] || URGENCY_COLORS.NEUTRAL;
}
