// ui/public/flags.mjs — feature flags in the browser (docs/feature-flags.md).
//
// The server renders the state into the shell (src/core/index-html.mjs): <html data-flags="…"> lists
// the flags that are on, and <style id="flag-gates"> hides [data-flag~="<key>"] for every flag that is
// off, so flagged-off markup never paints. This module keeps both live (the `flags` WS frame, hello):
//   markup    data-flag=<key> [data-flag-chip]     hidden while off; the chip says Labs / Beta
//   logic     flagOn(key)                         read at the point of use
//   reactive  onFlagChange(key, fn)               mount / unmount a JS-built feature
//   anything  document 'worca:flags'              detail { flags, changed }
// Flags are not levels: an element with data-flag AND data-min-level needs both (two CSS gates).
// Keep literal keys out of this file's comments: test/flags-usage.test.mjs scans for them.
import { FLAGS, flagByKey } from '../../src/shared/flags/registry.mjs';
import { flagsAttr, flagGateCss } from '../../src/shared/flags/resolve.mjs';

export const STAGE_LABEL = Object.freeze({ experimental: 'Labs', beta: 'Beta', retiring: 'Retiring' });

const docOf = (doc) => doc || globalThis.document;
const listeners = new Map();   // key -> Set<(on:boolean)=>void>

/** { key: bool } for every registry flag, read from <html data-flags>. */
export function currentFlags(doc) {
  // A closed window's document has no <html>: every flag reads off.
  const on = new Set(String(docOf(doc).documentElement?.dataset.flags || '').split(/\s+/).filter(Boolean));
  return Object.fromEntries(FLAGS.map((f) => [f.key, on.has(f.key)]));
}

/** Is `key` on right now? An unknown key is off. */
export function flagOn(key, doc) { return currentFlags(doc)[key] === true; }

/** Call `fn(on)` whenever `key` flips. Returns an unsubscribe function. */
export function onFlagChange(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => { listeners.get(key)?.delete(fn); };
}

/**
 * Merge `patch` ({ key: bool }; unknown keys and non-booleans ignored) into the page: rewrite
 * <html data-flags> and #flag-gates, then — only for flags that actually flipped — call the
 * onFlagChange subscribers and fire `worca:flags`. Idempotent. Returns the full new state.
 */
export function applyFlags(patch, doc) {
  const d = docOf(doc);
  const before = currentFlags(d);
  const next = { ...before };
  for (const [k, v] of Object.entries(patch || {})) if (flagByKey(k) && typeof v === 'boolean') next[k] = v;
  d.documentElement.dataset.flags = flagsAttr(FLAGS, next);
  let gates = d.getElementById('flag-gates');
  if (!gates) { gates = d.createElement('style'); gates.id = 'flag-gates'; d.head.appendChild(gates); }
  gates.textContent = flagGateCss(FLAGS, next);
  const changed = FLAGS.map((f) => f.key).filter((k) => next[k] !== before[k]);
  for (const k of changed) {
    for (const fn of listeners.get(k) || []) { try { fn(next[k]); } catch (e) { console.warn('[worca] flag listener failed', e); } }
  }
  if (changed.length) {
    const Ev = (d.defaultView && d.defaultView.CustomEvent) || globalThis.CustomEvent;   // jsdom rejects Node's
    d.dispatchEvent(new Ev('worca:flags', { detail: { flags: next, changed } }));
  }
  return next;
}

const INTERACTIVE = 'a, button, input, select, textarea, label, summary';
const TAB_HOST = '[role="tab"], .tab, .tabs > button, .seg > button';

/** D9: give a [data-flag] element its stage chip, linking to its row in Settings › Labs.
 *  Inside the host, or right after it when the host is interactive (no link inside a button). The
 *  chip carries the host's data-flag, so it is gated exactly like the host. A tab gets a plain span
 *  inside its label instead (review A4), and so does a row of the sidebar (a button in .nav), after
 *  its label: a sibling would be a row of its own in the column-flex rail, and the row's own click
 *  opens the page. A non-empty data-flag-chip value names the flag without gating the host, so its
 *  chip is never hidden by the flag gate. Idempotent. */
export function chip(el, doc) {
  const d = docOf(doc || (el && el.ownerDocument));
  const named = el && el.dataset && el.dataset.flagChip;
  const key = String(named || (el && el.dataset && el.dataset.flag) || '').split(/\s+/).find((k) => flagByKey(k));
  if (!key || el.dataset.flagChipped) return el;
  el.dataset.flagChipped = '1';
  const f = flagByKey(key);
  const label = STAGE_LABEL[f.stage] || f.stage;
  const title = `${f.title} is ${f.stage === 'beta' ? 'in beta' : 'in Labs'}.`;
  if (el.matches(TAB_HOST) || el.matches('.nav button')) {
    const s = d.createElement('span');
    s.className = `flag-chip flag-chip-${f.stage}`;
    if (el.dataset.flag) s.dataset.flag = el.dataset.flag;
    s.textContent = label;
    s.title = title;
    el.appendChild(s);
    return el;
  }
  const a = d.createElement('a');
  a.className = `flag-chip flag-chip-${f.stage}`;
  a.href = `#settings/experimental/${key}`;
  if (el.dataset.flag) a.dataset.flag = el.dataset.flag;
  a.textContent = label;
  a.title = `${title} Open its switch in Settings › Labs.`;
  if (el.matches(INTERACTIVE)) el.after(a); else el.appendChild(a);
  return el;
}

/** chip() every [data-flag-chip] under `root`. */
export function decorateFlagChips(root) {
  const r = root || docOf();
  for (const el of r.querySelectorAll('[data-flag-chip]')) chip(el, el.ownerDocument);
  return r;
}
