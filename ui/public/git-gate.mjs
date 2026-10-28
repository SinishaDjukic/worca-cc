// ui/public/git-gate.mjs — is git usable, in the browser (CONTRACT §0, DECISIONS U2/U4).
//
// The server renders <html data-git="on|off"> (src/core/index-html.mjs) and style.css hides every
// [data-needs-git] while it says off. This module keeps it live (the `git` WS frame, hello, and
// GET /api/git when Projects, the Add project dialog and New run open — U4):
//   markup    data-needs-git                      hidden while git is off
//   logic     gitOn()                             read at the point of use
//   reactive  onGitChange(fn)                     fn(on) on a flip
//   anything  document 'worca:git'                detail { available }
// No data-git attribute (tests, an old shell) reads as on.

export const GIT_MISSING_TEXT = 'git is not installed on this machine';   // mirrors src/core/git-available.mjs GIT_MISSING.message

const docOf = (doc) => doc || globalThis.document;
const listeners = new Set();   // (on:boolean) => void

/** Is git usable right now, as the page knows it? */
export function gitOn(doc) { return docOf(doc)?.documentElement?.dataset.git !== 'off'; }   // no document (a module test): on

/** Call `fn(on)` whenever git appears or goes missing. Returns an unsubscribe function. */
export function onGitChange(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/**
 * Write `available` into <html data-git>; only on a flip call the onGitChange subscribers and fire
 * `worca:git`. A non-boolean `available` changes nothing. Returns the state after the call.
 */
export function applyGit(state, doc) {
  const d = docOf(doc);
  const before = gitOn(d);
  const available = state && state.available;
  if (typeof available !== 'boolean') return before;
  d.documentElement.dataset.git = available ? 'on' : 'off';
  if (available !== before) {
    for (const fn of [...listeners]) { try { fn(available); } catch (e) { console.warn('[worca] git listener failed', e); } }
    const Ev = (d.defaultView && d.defaultView.CustomEvent) || globalThis.CustomEvent;   // jsdom rejects Node's
    d.dispatchEvent(new Ev('worca:git', { detail: { available } }));
  }
  return available;
}

/** Ask the server (GET /api/git; it re-probes at most once a minute) and apply the answer. A failure keeps the state. */
export async function refreshGit({ fetchImpl = globalThis.fetch, doc } = {}) {
  try {
    const res = await fetchImpl('/api/git');
    if (!res || !res.ok) return gitOn(doc);
    return applyGit(await res.json(), doc);
  } catch {
    return gitOn(doc);
  }
}
