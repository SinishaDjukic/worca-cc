// One way to report an action's result (#555): toasts, button states, field errors,
// card alerts and dirty-state Save. Every helper reaches the DOM through its arguments
// (or `document`), never through a cached node: app.js jsdom suites boot a fresh DOM per
// test while this module stays cached by its (un-busted) URL.

export const TOAST_MAX = 3;
export const TOAST_AUTO_MS = 5000;
export const BUTTON_DONE_MS = 2000;
const TONES = new Set(['ok', 'err', 'warn', 'info']);
const SVG_NS = 'http://www.w3.org/2000/svg';

// [tag, attrs] per glyph; drawn with currentColor so the tone colour comes from CSS.
const GLYPHS = {
  ok: [['path', { d: 'M5 12.5l4.2 4.2L19 7' }]],
  err: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 7.5v5.5' }], ['path', { d: 'M12 16.5v.01' }]],
  warn: [['path', { d: 'M12 4l9 16H3z' }], ['path', { d: 'M12 10v4' }], ['path', { d: 'M12 17v.01' }]],
  info: [['circle', { cx: '12', cy: '12', r: '9' }], ['path', { d: 'M12 11v5' }], ['path', { d: 'M12 8v.01' }]],
  x: [['path', { d: 'M6 6l12 12' }], ['path', { d: 'M18 6L6 18' }]],
};

/** An aria-hidden stroke icon for `name` (ok | err | warn | info | x). */
export function feedbackIcon(doc, name, cls = '') {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  if (cls) svg.setAttribute('class', cls);
  for (const [tag, attrs] of GLYPHS[name] || GLYPHS.info) {
    const n = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n);
  }
  return svg;
}

function el(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// ---------------------------------------------------------------- toasts

/** The #toasts live region (index.html ships it; created if a test DOM lacks it). */
export function toastRegion(doc = globalThis.document) {
  let r = doc.getElementById('toasts');
  if (!r) {
    r = el(doc, 'div', 'toasts');
    r.id = 'toasts';
    r.setAttribute('role', 'status');
    r.setAttribute('aria-live', 'polite');
    doc.body.append(r);
  }
  return r;
}

const toastsIn = (r) => [...r.children].filter((c) => c.classList.contains('toast'));

const mainEl = (doc) => {
  const m = doc.querySelector('main.main');
  if (m && !m.hasAttribute('tabindex')) m.setAttribute('tabindex', '-1');
  return m;
};

// A toast that holds focus hands it back (the element focused before it, else main, else the
// first focusable one) so removing it never drops focus to BODY.
function dismiss(t) {
  t._fbStop?.();
  const doc = t.ownerDocument;
  const held = t.contains(doc.activeElement);
  const back = t._fbReturn;
  t.remove();
  if (!held) return;
  const target = back && back.isConnected && typeof back.focus === 'function' ? back
    : mainEl(doc) || doc.querySelector('a[href], button, input, [tabindex]');
  target?.focus?.();
}

function armAutoClose(t, ms) {
  let left = ms;
  let started = 0;
  let timer = null;
  let hovered = false;
  const start = () => {
    if (timer || !t.isConnected) return;
    started = Date.now();
    timer = setTimeout(() => dismiss(t), left);
    timer?.unref?.();                       // never keep a node:test process alive
  };
  const pause = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    left = Math.max(0, left - (Date.now() - started));
  };
  t.addEventListener('mouseenter', () => { hovered = true; pause(); });
  t.addEventListener('mouseleave', () => { hovered = false; if (!t.contains(t.ownerDocument.activeElement)) start(); });
  t.addEventListener('focusin', pause);
  t.addEventListener('focusout', (e) => { if (!hovered && !t.contains(e.relatedTarget)) start(); });
  t._fbStop = () => { clearTimeout(timer); timer = null; };
  start();
}

/**
 * Raise a toast. ok/info close after 5 s (paused while hovered or focused); err/warn stay
 * until dismissed. `action` = { label, run } (Undo | Open | Retry | Details). A toast with
 * the same `key` replaces the older one. Never moves focus. Returns { el, close }.
 */
export function notify({ tone = 'info', title = '', detail = '', action = null, key = null, timeout } = {}, { doc = globalThis.document } = {}) {
  const t0 = TONES.has(tone) ? tone : 'info';
  const r = toastRegion(doc);
  if (key) for (const old of toastsIn(r)) if (old.dataset.key === key) dismiss(old);

  const t = el(doc, 'div', `toast ${t0}`);
  if (key) t.dataset.key = key;
  t.setAttribute('role', t0 === 'err' ? 'alert' : 'status');
  const ti = el(doc, 'span', 'ti');
  ti.append(feedbackIcon(doc, t0));
  const body = el(doc, 'div', 'tb');
  body.append(el(doc, 'div', 'tt', String(title)));
  if (detail) body.append(el(doc, 'div', 'td', String(detail)));
  if (action && action.label && typeof action.run === 'function') {
    const b = el(doc, 'button', 'btn btn-sm toast-act', action.label);
    b.type = 'button';
    b.addEventListener('click', () => { dismiss(t); action.run(); });
    body.append(b);
  }
  const x = el(doc, 'button', 'btn btn-sm btn-quiet btn-icon toast-x');
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss');
  x.title = 'Dismiss';
  x.append(feedbackIcon(doc, 'x'));
  x.addEventListener('click', () => dismiss(t));
  t.append(ti, body, x);
  t.addEventListener('focusin', (e) => {
    if (e.relatedTarget && !t.contains(e.relatedTarget)) t._fbReturn = e.relatedTarget;
  });
  r.append(t);

  // At most TOAST_MAX: drop the oldest non-error first (never the one just added).
  for (let list = toastsIn(r); list.length > TOAST_MAX; list = toastsIn(r)) {
    dismiss(list.slice(0, -1).find((n) => !n.classList.contains('err') && !n.classList.contains('warn')) || list[0]);
  }
  const ms = timeout !== undefined ? timeout : (t0 === 'err' || t0 === 'warn' ? 0 : TOAST_AUTO_MS);
  if (ms > 0) armAutoClose(t, ms);
  return { el: t, close: () => dismiss(t) };
}

/** Polite screen-reader line in the toast region (button "Saved" states). */
export function announce(text, doc = globalThis.document) {
  const r = toastRegion(doc);
  let s = [...r.children].find((c) => c.classList.contains('toasts-sr'));
  if (!s) { s = el(doc, 'span', 'sr-only toasts-sr'); r.prepend(s); }
  s.textContent = text;
  // A repeated identical string is not re-announced: blank it, then set it on the next turn.
  clearTimeout(s._fbT);
  s._fbT = null;
  if (s._fbLast === text) {
    s.textContent = '';
    s._fbT = setTimeout(() => { s.textContent = text; }, 50);
    s._fbT?.unref?.();
  }
  s._fbLast = text;
}

// ---------------------------------------------------------------- buttons

function paintButton(btn, state, label) {
  const doc = btn.ownerDocument;
  btn.dataset.fbState = state;
  btn.classList.toggle('is-busy', state === 'busy');
  btn.classList.toggle('is-done', state === 'done');
  btn.disabled = state === 'busy';
  if (state === 'busy') btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
  if (state === 'done') btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
  if (state === 'busy') {
    const sp = el(doc, 'span', 'btn-spin');
    sp.setAttribute('aria-hidden', 'true');
    btn.replaceChildren(sp, doc.createTextNode(label));
  } else if (state === 'done') {
    btn.replaceChildren(feedbackIcon(doc, 'ok', 'btn-ic'), doc.createTextNode(label));
  }
  stateChanged(btn);
}

// (v4) Tell the card's dirty tracker that a button changed state, so a Save gated on a busy
// sibling (Reset, Test) re-enables when that sibling settles, success or failure.
function stateChanged(btn) {
  const Ev = btn.ownerDocument.defaultView?.Event;
  if (Ev) btn.dispatchEvent(new Ev('fb-state', { bubbles: true }));
}

// A Save tracked by trackDirty carries `_fbIsClean`; a clean card keeps it disabled.
const gated = (btn, idleDisabled) => !!idleDisabled() || !!btn._fbIsClean?.();

function toIdle(btn, idleDisabled) {
  clearTimeout(btn._fbTimer);
  btn._fbTimer = null;
  // (v4) Re-attach the ORIGINAL nodes, never clones: app.js caches children (el.startBtnLabel,
  // app.js:284) and keeps writing to them; a write made while busy lands on the held node.
  if (btn._fbIdle) { btn.replaceChildren(...btn._fbIdle); btn._fbIdle = null; }
  btn.classList.remove('is-busy', 'is-done');
  btn.removeAttribute('aria-busy');
  btn.removeAttribute('aria-disabled');
  delete btn.dataset.fbState;
  btn.disabled = gated(btn, idleDisabled);
  btn._fbRepaint?.();                      // the dirty marker catches up with the idle state
  stateChanged(btn);                       // (v4) a Save waiting on this sibling repaints
}

// Disabling a focused button drops focus to <body> in Chromium; give it back when we can.
function refocus(btn, hadFocus) {
  const doc = btn.ownerDocument;
  if (hadFocus && !btn.disabled && (doc.activeElement === doc.body || doc.activeElement == null)) btn.focus?.();
}

async function settle(fn) {
  try {
    const v = await fn();
    return v === undefined ? { ok: true } : v;
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/**
 * busy ("Saving…", spinner, disabled) → done ("✓ Saved", 2 s) → idle. Never throws:
 * fn's result is returned as-is (undefined → {ok:true}); a throw becomes {ok:false, error}.
 * A result with ok === false skips "done" and returns to idle at once.
 * The idle button is disabled when `idleDisabled()` is true or, for a Save that trackDirty
 * owns, when its card is clean. A click on a "Saved" button whose card is clean is ignored.
 */
export async function withButton(btn, fn, { busy = 'Saving…', done = 'Saved', doneMs = BUTTON_DONE_MS, idleDisabled = () => false } = {}) {
  if (!btn) return settle(fn);
  if (btn.dataset.fbState === 'busy') return { ok: false, skipped: true };
  if (btn.dataset.fbState === 'done' && gated(btn, idleDisabled)) return { ok: false, skipped: true };
  // (v4) Hold the original children (detached while busy/done, re-attached by toIdle). During
  // "done" they are already held, so a second click keeps the first capture.
  if (!btn._fbIdle) btn._fbIdle = [...btn.childNodes];
  const hadFocus = btn.ownerDocument.activeElement === btn;
  clearTimeout(btn._fbTimer);
  paintButton(btn, 'busy', busy);
  const r = await settle(fn);
  if (!btn.isConnected) return r;
  if (r && r.ok === false) { toIdle(btn, idleDisabled); refocus(btn, hadFocus); return r; }
  paintButton(btn, 'done', done);
  refocus(btn, hadFocus);
  announce(done, btn.ownerDocument);
  btn._fbTimer = setTimeout(() => toIdle(btn, idleDisabled), doneMs);
  btn._fbTimer?.unref?.();
  return r;
}

// ---------------------------------------------------------------- field errors

let feSeq = 0;
const tokens = (n, a) => (n.getAttribute(a) || '').split(/\s+/).filter(Boolean);

function clearOne(msg) {
  for (const f of msg._fbFields || []) {
    f.classList.remove('field-invalid');
    f.removeAttribute('aria-invalid');
    const rest = tokens(f, 'aria-describedby').filter((id) => id !== msg.id);
    if (rest.length) f.setAttribute('aria-describedby', rest.join(' ')); else f.removeAttribute('aria-describedby');
    f.removeEventListener('input', f._fbOnEdit);
    f.removeEventListener('change', f._fbOnEdit);
    delete f._fbErr;
  }
  msg.remove();
}

/**
 * Mark one field (or several that share one rule, e.g. a port range) invalid: red border,
 * aria-invalid, a sentence under the field linked by aria-describedby, focus on the first.
 * Editing any of them clears the error. Returns the message node.
 */
export function fieldError(target, message, { focus = true } = {}) {
  const fields = (Array.isArray(target) ? target : [target]).filter(Boolean);
  if (!fields.length) return null;
  for (const f of fields) if (f._fbErr) clearOne(f._fbErr);
  const doc = fields[0].ownerDocument;
  const msg = el(doc, 'span', 'field-error');
  msg.id = `fe-${++feSeq}`;
  msg.append(feedbackIcon(doc, 'err', 'fe-ic'), el(doc, 'span', 'fe-text', String(message)));
  const host = fields[0].closest('.field, .ac-field, .ac-env-row, .confirm-field') || fields[0].parentElement;
  host.append(msg);
  msg._fbFields = fields;
  const onEdit = () => clearOne(msg);
  for (const f of fields) {
    f.classList.add('field-invalid');
    f.setAttribute('aria-invalid', 'true');
    f.setAttribute('aria-describedby', [...tokens(f, 'aria-describedby'), msg.id].join(' '));
    f._fbErr = msg;
    f._fbOnEdit = onEdit;
    f.addEventListener('input', onEdit);
    f.addEventListener('change', onEdit);
  }
  if (focus) fields[0].focus?.();
  return msg;
}

/** Remove every field error inside `root`. */
export function clearFieldErrors(root) {
  if (!root) return;
  for (const m of root.querySelectorAll('.field-error')) clearOne(m);
}

// ---------------------------------------------------------------- card alerts

const ACTION_ROW = '.add-project-actions, .ac-foot, [data-card-actions]';
// (v5) The card's OWN row first: #run-form holds the hidden inline add-project panel, whose
// .add-project-actions (index.html:209) comes before the form's div.actions in document order.
const OWN_ROW = ACTION_ROW.split(', ').map((s) => `:scope > ${s}`).join(', ');
const actionRowOf = (card) => card.querySelector(OWN_ROW) || card.querySelector(ACTION_ROW);

/**
 * One alert per card, directly above its own action row (a direct child first, else the first
 * descendant row, else at the end): tinted box, icon,
 * bold title, detail, Dismiss. err/warn are role=alert. `null` removes it.
 */
export function cardAlert(card, opts) {
  if (!card) return null;
  for (const old of card.querySelectorAll('.card-alert')) old.remove();
  if (!opts) return null;
  const { tone = 'err', title = '', detail = '' } = opts;
  const t0 = TONES.has(tone) ? tone : 'err';
  const doc = card.ownerDocument;
  const box = el(doc, 'div', `card-alert ${t0}`);
  box.setAttribute('role', t0 === 'err' || t0 === 'warn' ? 'alert' : 'status');
  const ic = el(doc, 'span', 'ca-ic');
  ic.append(feedbackIcon(doc, t0));
  const body = el(doc, 'div', 'ca-body');
  if (title) body.append(el(doc, 'strong', 'ca-title', String(title)));
  if (detail) body.append(el(doc, 'div', 'ca-detail', String(detail)));
  const x = el(doc, 'button', 'btn btn-sm btn-quiet btn-icon ca-x');
  x.type = 'button';
  x.setAttribute('aria-label', 'Dismiss');
  x.title = 'Dismiss';
  x.append(feedbackIcon(doc, 'x'));
  x.addEventListener('click', () => box.remove());
  box.append(ic, body, x);
  const row = actionRowOf(card);
  if (row) row.before(box); else card.append(box);
  return box;
}

// ---------------------------------------------------------------- dirty-state Save

const CONTROLS = 'input, select, textarea';
const valueOf = (n) => (n.type === 'checkbox' || n.type === 'radio' ? n.checked : n.value);

/** The dirty baseline of `root`: each control's value (a checkbox or radio: checked), skipping
 *  [data-dirty-ignore] subtrees, buttons and file inputs. trackDirty and modal-guard.mjs share it. */
export function controlSnapshot(root) {
  return JSON.stringify([...root.querySelectorAll(CONTROLS)]
    .filter((n) => !n.closest('[data-dirty-ignore]') && n.type !== 'button' && n.type !== 'file')
    .map(valueOf));
}

/**
 * Save stays disabled until a control in `card` differs from the last clean snapshot; an
 * "Unsaved changes" marker shows beside the buttons while it does. Controls inside
 * [data-dirty-ignore] (pickers that reset themselves) do not count. Structural edits
 * (Add / Remove rows) are caught by re-checking after any click.
 */
export function trackDirty(card, { saveBtn = null, marker = 'Unsaved changes' } = {}) {
  const doc = card.ownerDocument;
  let mark = card.querySelector('.dirty-mark');
  if (!mark) {
    mark = el(doc, 'span', 'dirty-mark');
    mark.append(el(doc, 'span', 'dirty-dot'), doc.createTextNode(marker));
    mark.hidden = true;
    const row = saveBtn?.closest(ACTION_ROW) || saveBtn?.parentElement;
    if (row) row.prepend(mark); else card.append(mark);
  }
  const snap = () => controlSnapshot(card);
  let base = snap();
  const api = {
    isDirty: () => snap() !== base,
    markClean() { base = snap(); paint(); },
    refresh: () => paint(),
  };
  function paint() {
    const d = api.isDirty();
    mark.hidden = !d;
    // busy/done own the Save itself; (v4) while a sibling (Reset, Test) is busy, Save waits too.
    if (saveBtn && !saveBtn.dataset.fbState) saveBtn.disabled = !d || !!card.querySelector('[data-fb-state="busy"]');
  }
  if (saveBtn) {
    saveBtn._fbIsClean = () => !api.isDirty();   // read by withButton's idle state
    saveBtn._fbRepaint = paint;
  }
  card.addEventListener('input', paint);
  card.addEventListener('change', paint);
  card.addEventListener('fb-state', paint);                 // (v4) a sibling went busy / idle
  card.addEventListener('click', () => setTimeout(paint, 0));
  paint();
  return api;
}

/** "Install failed: 401 …" → { title: 'Install failed', detail: '401 …' } (short head only). */
export function splitMessage(text) {
  const s = String(text || '');
  const i = s.indexOf(': ');
  return i > 0 && i <= 48 ? { title: s.slice(0, i), detail: s.slice(i + 2) } : { title: s, detail: '' };
}
