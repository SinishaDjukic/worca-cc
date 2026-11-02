// ui/public/group-add.mjs — what Add to group shares between the Runs list and the Chats column: the per-list recent
// groups (the picker's Recent section) and the "Added to …" toast with Undo. Storage reads are guarded: with site data
// blocked even reading localStorage throws.
export const RECENT_SHOWN = 3;
const RECENT_KEEP = 8;
const key = (list) => `worca-cc.groups.recent.${list}`;

/** The list's recent group ids, newest first ([] when unreadable). */
export function readRecentGroups(storage, list) {
  try {
    const v = JSON.parse(storage?.getItem(key(list)) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

/** `id` was just used: it leads the list's recent ids. */
export function noteRecentGroup(storage, list, id) {
  if (!id) return;
  try { storage?.setItem(key(list), JSON.stringify([id, ...readRecentGroups(storage, list).filter((x) => x !== id)].slice(0, RECENT_KEEP))); }
  catch { /* storage off: Recent just stays empty */ }
}

/** The toast after an add: "Added to Billing v2" · the item (or "3 runs") · the skip note; Undo when there is a token. */
export function addedNotice({ group, titles, noun, skipped = 0, skipWhy = '', undo = null }) {
  const what = titles.length === 1 ? titles[0] : `${titles.length} ${noun}s`;
  return { tone: 'ok', title: `Added to ${group}`, detail: `${what}${skipped ? ` · Skipped ${skipped}: ${skipWhy}` : ''}`,
    action: undo ? { label: 'Undo', run: undo } : null };
}
