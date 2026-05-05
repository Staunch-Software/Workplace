import { STATUS_COLORS } from '../constants'

export function StatusBadge({ status }) {
  const colorStr = STATUS_COLORS[status] || '#f3f4f6|#374151'
  const [bg, color] = colorStr.split('|')
  return (
    <span style={{ backgroundColor: bg, color, padding: '2px 10px', borderRadius: 999, fontWeight: 600 }}>
      {status || 'Unknown'}
    </span>
  )
}

export function PriorityBadge({ priority }) {
  const colors = {
    Critical: '#dc2626',
    Major: '#f97316',
    Minor: '#ca8a04',
  }
  return (
    <span style={{ color: colors[priority] || '#6b7280', fontWeight: 600 }}>
      {priority}
    </span>
  )
}
