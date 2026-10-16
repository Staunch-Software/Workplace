// Unread feed events per vessel, counted the same way the Feed section lists
// them: normal events for everyone, mention events only if they mention the
// current user.
const mentionsUser = (item, userId) => {
  let meta = item.meta;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { return false; }
  }
  return (meta?.mentioned_user_ids || []).map(String).includes(String(userId));
};

export const countUnreadFeedByVessel = (items, userId) => {
  const counts = {};
  (Array.isArray(items) ? items : []).forEach((i) => {
    if (i.is_read || !i.vessel_imo) return;
    if (i.event_type === 'MENTION' && !mentionsUser(i, userId)) return;
    const key = String(i.vessel_imo);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
};
