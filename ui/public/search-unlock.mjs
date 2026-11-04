// ui/public/search-unlock.mjs — the hand-off after a locked search result is picked: open the place where the next
// lock can be cleared (the mode dialog, or that flag's row in Settings › Labs) and, once EVERY lock of that result is
// clear, take the user on to it. Forgotten as soon as the user leaves the unlock place without unlocking (A-10).
// No DOM: app.js injects the checks and the movers, and calls changed() on worca:level / worca:flags,
// modeClosed() when the mode dialog closes and routed(view, param) from showView.
export function createSearchUnlock({ levelOk, flagOk, openMode, closeMode, go, labsHash }) {
  let pending = null;   // { href, locks, placed: '' | 'mode' | 'flag:<key>' }

  const unmet = () => pending.locks.find((l) => (l.type === 'mode' ? !levelOk(l.min) : !flagOk(l.key)));
  const where = (lock) => (lock.type === 'mode' ? 'mode' : `flag:${lock.key}`);

  function step() {
    const lock = unmet();
    const was = pending.placed;
    if (lock && where(lock) === was) return;           // still waiting at the same place
    pending.placed = '';                               // closeMode() reports back through modeClosed(): not a cancel
    if (was === 'mode') closeMode();
    if (!lock) { const href = pending.href; pending = null; go(href); return; }
    pending.placed = where(lock);
    if (lock.type === 'mode') openMode();
    else go(labsHash(lock.key));                       // the next flag's row: still Labs, so routed() keeps the pick
  }

  return Object.freeze({
    arm(row) { pending = { href: row.href, locks: row.locks || [], placed: '' }; step(); },
    changed() { if (pending) step(); },
    modeClosed() { if (pending && pending.placed === 'mode') pending = null; },
    routed(view, param = '') {
      if (pending && pending.placed.startsWith('flag:') && !(view === 'settings' && /^experimental(\/|$)/.test(param))) pending = null;
    },
    isArmed: () => pending !== null,
  });
}
