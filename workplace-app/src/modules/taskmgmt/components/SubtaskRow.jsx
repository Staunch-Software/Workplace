import React, { useState } from 'react';
import { urgencyColor } from '../utils/urgency';

/**
 * Generic collapsible subtask row — the shell 1.W.1–1.W.3 and 1.W.5 should plug into once
 * their own backend logic exists, rather than each subtask growing a one-off layout.
 *
 * Two modes:
 *  - functional=false: dimmed, non-interactive row with a small status tag (e.g. "pending
 *    mapping"). No data fetch is attempted for these.
 *  - functional=true: clickable row with a badge (count + color), expands to reveal
 *    `children` (the subtask's own table/content).
 */
export default function SubtaskRow({ code, title, functional, statusTag, badgeCount, badgeUrgency, children, defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!functional) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', borderBottom: '1px solid var(--gray-200)',
        opacity: 0.55, background: 'var(--gray-50, #fafafa)',
      }}>
        <span style={{ fontWeight: 600, minWidth: 56, fontSize: '0.85rem', color: 'var(--gray-500)' }}>{code}</span>
        <span style={{ flex: 1, fontSize: '0.9rem' }}>{title}</span>
        <span style={{
          fontSize: '0.75rem', padding: '3px 10px', borderRadius: 999,
          background: 'var(--gray-200)', color: 'var(--gray-500)', whiteSpace: 'nowrap',
        }}>
          {statusTag}
        </span>
      </div>
    );
  }

  const color = urgencyColor(badgeUrgency);

  return (
    <div style={{ borderBottom: '1px solid var(--gray-200)' }}>
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 600, minWidth: 56, fontSize: '0.85rem', color: 'var(--gray-500)' }}>{code}</span>
        <span style={{ flex: 1, fontSize: '0.9rem', fontWeight: 500 }}>{title}</span>
        {badgeCount != null && (
          <span style={{
            fontSize: '0.78rem', fontWeight: 600, padding: '3px 10px', borderRadius: 999,
            background: color.bg, color: color.fg, whiteSpace: 'nowrap',
          }}>
            {badgeCount} vessel{badgeCount === 1 ? '' : 's'}
          </span>
        )}
        <span style={{
          fontSize: '0.8rem', color: 'var(--gray-400)',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s',
        }}>
          ▶
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {children}
        </div>
      )}
    </div>
  );
}
