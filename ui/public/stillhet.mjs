// ui/public/stillhet.mjs — Stillhet's opt-in and opt-out in the app (docs/rail/navigation.md `nav.stillhet-ask`, `nav.design-switch`).
// Glue only: the Invitation and the DesignSwitch are library parts (design-system/components), mounted by JS so the flag-off
// page is dev's page. `toast` and `fetchJson(method, path, body) → {ok, data}` arrive by parameter, never by import.
import { applyFlags, onFlagChange } from './flags.mjs';
import { designSwitch, stillhetInvitation, watchStrips } from './design-system/components/index.mjs';

let dismissedThisLoad = false;   // Esc or Not now: closed for the rest of this load, asked again on the next
let inFlight = false;            // an answer is being saved
let watched = new WeakSet();     // documents whose Esc handler for strips is installed

/** Clears the module's per-load state (tests). */
export function resetStillhetState() { dismissedThisLoad = false; inFlight = false; watched = new WeakSet(); }

const messageOf = (r) => (r && r.data && (r.data.error || r.data.message)) || 'Try again in a moment.';

/** Is the question due? True only when every condition passes. */
export function shouldAskStillhet({ ask, asked, fresh, flagKnown, on, locked, welcomeThisLoad, setupOpen, dialogOpen }) {
  return !!ask && !asked && !fresh && !!flagKnown && !on && !locked && !welcomeThisLoad && !setupOpen && !dialogOpen;
}

/** Settings › Labs keeps the `rail` row only while Stillhet asks or is on; every other row stays. */
export function stillhetLabsRow(status) {
  return (flag) => flag.key !== 'rail' || status?.stillhetAsk === true || flag.on === true;
}

/** True when a visible text field holds something its default does not. */
export function hasTypedText(doc) {
  const fields = doc.querySelectorAll('input[type=text], input[type=search], input[type=url], input[type=email], input:not([type]), textarea, [contenteditable=true]');
  return [...fields].some((f) => {
    if (typeof f.checkVisibility === 'function' ? !f.checkVisibility() : f.closest('[hidden]')) return false;   // a closed dialog's fields do not count
    if (f.getAttribute('contenteditable') === 'true') return f.textContent.trim() !== '';
    return f.value !== f.defaultValue;
  });
}

/** Mounts the Invitation under the top bar. Returns a handle, or null when it is closed for this load. */
export function mountStillhetAsk({ doc, status, fetchJson, onAccepted = () => applyFlags({ rail: true }, doc) }) {
  if (dismissedThisLoad) return null;
  const existing = doc.querySelector('[data-stillhet="invitation"]');
  if (existing) return { el: existing, close: () => closeSlot(doc) };
  let slot = doc.getElementById('rail-strip');
  if (!slot) {
    slot = doc.createElement('div');
    slot.id = 'rail-strip';
    const bar = doc.getElementById('topnav');
    if (bar) bar.insertAdjacentElement('afterend', slot); else doc.body.prepend(slot);
  }
  if (!watched.has(doc)) { watched.add(doc); watchStrips(doc); }

  let busy = false, err = null, unsub = () => {};
  const paint = (focus = 'no') => {
    slot.innerHTML = stillhetInvitation({ bugsUrl: status.bugsUrl, busy, err });
    slot.querySelector(`[data-confirm="${focus}"]`)?.focus();
  };
  const close = () => { unsub(); closeSlot(doc); };

  async function answer(which) {
    inFlight = true; busy = which; err = null; paint(which === 'yes' ? 'yes' : 'no');
    const r = which === 'yes'
      ? await fetchJson('PATCH', '/api/flags', { rail: true })
      : await fetchJson('POST', '/api/onboarding', { stillhetAsked: true });
    inFlight = false; busy = false;
    if (r && r.ok) { close(); if (which === 'yes') onAccepted(); return; }
    err = which === 'yes'
      ? { title: 'Stillhet could not be turned on', detail: messageOf(r), from: 'yes' }
      : { title: 'Your answer could not be saved', detail: messageOf(r), from: 'no' };
    paint(which === 'yes' ? 'yes' : 'no');
  }
  function back() {
    if (inFlight) return;
    dismissedThisLoad = true;
    close();
    doc.getElementById('main')?.focus?.();
  }

  slot.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-confirm]');
    if (!b || inFlight) return;
    if (b.dataset.confirm === 'yes') { answer(err ? err.from : 'yes'); return; }
    if (err && err.from === 'no') { back(); return; }   // Not now
    answer('no');
  });
  slot.addEventListener('strip:back', back);
  unsub = onFlagChange('rail', (on) => { if (on) close(); });
  paint();
  return { el: slot.querySelector('[data-stillhet="invitation"]'), close };
}

function closeSlot(doc) { doc.getElementById('rail-strip')?.remove(); }

/** Mounts the Stillhet UI switch in the top bar, after Activity. `flag` is the `rail` entry of GET /api/flags. */
export function mountDesignSwitch({ doc, status, flag, fetchJson, toast }) {
  if (!status || status.stillhetAsk !== true) return null;
  if (doc.querySelector('[data-stillhet="design-switch"]')) return null;
  const host = doc.querySelector('.topnav-r');
  if (!host) return null;
  const anchor = doc.getElementById('activity-pop') || doc.getElementById('topnav-activity');
  let on = !!flag.on;
  const locked = !!flag.locked;
  const html = (busy = false) => designSwitch({ on, locked, busy });
  if (anchor && host.contains(anchor)) anchor.insertAdjacentHTML('afterend', html()); else host.insertAdjacentHTML('afterbegin', html());
  const node = () => doc.querySelector('[data-stillhet="design-switch"]');
  const repaint = (busy) => { const n = node(); if (n) n.outerHTML = html(busy); };
  node().addEventListener('click', async (e) => {
    const b = e.target.closest('[data-design-switch]');
    if (!b || b.disabled) return;
    repaint(true);
    const next = !on;
    const r = await fetchJson('PATCH', '/api/flags', { rail: next });
    if (r && r.ok) { on = next; repaint(false); applyFlags({ rail: next }, doc); return; }
    repaint(false);
    toast('Stillhet could not be switched: ' + messageOf(r));
  });
  return node();
}

/** Reloads once when `rail` changes away from its server-rendered value; waits while text is typed. */
export function watchRailReload({ doc, win, bootOn, isDirty = hasTypedText, toast, now = Date.now, storage = win.sessionStorage }) {
  let target = null, toasted = false, scheduled = false;
  const KEY = 'worca.stillhet.reload';
  function attempt() {
    if (target === null || scheduled) return;
    if (isDirty(doc)) {
      if (!toasted) { toasted = true; toast(target ? 'Stillhet is on.' : 'Stillhet is off.'); }
      return;
    }
    try {
      const last = JSON.parse(storage.getItem(KEY) || 'null');
      if (last && last.value === target && now() - last.at < 10000) return;
      storage.setItem(KEY, JSON.stringify({ value: target, at: now() }));
    } catch { /* storage is a nicety; the one-per-page guard still holds */ }
    scheduled = true;
    win.location.reload();
  }
  const off = onFlagChange('rail', (on) => {
    toasted = false;
    target = on === bootOn ? null : on;
    attempt();
  });
  doc.addEventListener('input', attempt);
  doc.addEventListener('visibilitychange', attempt);
  return () => { off(); doc.removeEventListener('input', attempt); doc.removeEventListener('visibilitychange', attempt); };
}
