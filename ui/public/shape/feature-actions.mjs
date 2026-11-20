// ui/public/shape/feature-actions.mjs — Shaper s3: the feature card's controls. One painter for the Chat feature card and
// the one feature card (Plans tab, group page): Pause · Stop on the run in flight, Resume · Re-plan the rest once the
// feature halted, and the ⋯ menu (Re-plan the rest · Cancel the rest · Ask before each run · Open the plan).
// Ask before each run is the approve-each switch (shape_features.approve_each); a run it holds shows one Needs you row with
// Start now (Run now on the held ticket).
import { toggleMenu } from '../workflows/menu.mjs';
import { icon } from '../icons.mjs';
import { paintStatusDot } from '../status-dot.mjs';
import { ACTION_LABEL, RUN_STATES } from '../../../src/shared/run-model.mjs';

const LIVE = new Set(['starting', 'running', 'pausing']);
export const FAILED = 'That did not work. Try again.';
export const REPLAN_CONFIRM = Object.freeze({ title: 'Re-plan the rest', confirmLabel: 'Re-plan',
  message: 'The waiting runs are canceled and Worca plans what is left from the last finished run.' });
export const CANCEL_CONFIRM = Object.freeze({ title: 'Cancel the rest', confirmLabel: 'Cancel the rest', danger: true,
  message: 'The runs that have not started are canceled. A running run keeps running.' });

/** The buttons beside ⋯, [{key, label, primary?, disabled?}]. `c` is featureCardModel(...).controls (null: none). */
export function featureButtons(c) {
  if (!c || !c.active) return [];
  if (c.halted) return [{ key: 'resume', label: 'Resume', primary: true }, ...(c.rest ? [{ key: 'replan', label: 'Re-plan the rest' }] : [])];
  if (c.held) return [{ key: 'start', label: ACTION_LABEL['start-now'], primary: true }];
  const t = c.target;
  if (!t || !LIVE.has(t.status)) return [];
  const out = [];
  if (t.runId) out.push({ key: 'pause', label: t.status === 'pausing' ? 'Pausing…' : 'Pause', disabled: t.status !== 'running' || !!t.asks });
  if (t.runId || t.pipelineId) out.push({ key: 'stop', label: 'Stop' });
  return out;
}

/** The ⋯ items, the same on every host, [{key, label, checked?}]. */
export function featureMenu(c) {
  if (!c) return [];
  const items = [];
  if (c.rest) items.push({ key: 'replan', label: 'Re-plan the rest' }, { key: 'cancel', label: 'Cancel the rest' });
  if (c.active) items.push({ key: 'approve-each', label: 'Ask before each run', checked: !!c.approveEach });
  if (c.planPipelineId) items.push({ key: 'plan', label: 'Open the plan' });
  return items;
}

/** The control a repaint gives the focus back to: the focused one inside `host`, else the one an action noted before it
 *  disabled its button (Chromium blurs a disabled button to <body>). A focus the person moved elsewhere wins. */
export function featureFocusOf(doc, host) {
  const a = doc.activeElement;
  if (a && host.contains(a) && a.dataset && a.dataset.act) return a.dataset.act;
  if (a && a !== doc.body) return null;
  const noted = host.dataset.focus ? host : host.querySelector('[data-focus]');
  return noted ? noted.dataset.focus : null;
}

/** Focus `act` in `host` when it is there and enabled, else ⋯ (a Pause that became Pausing…, a Resume that is gone),
 *  else `fallback` (the group page draws no ⋯ in the controls: its header's ⋯ takes the focus). */
export function focusFeatureControl(host, act, fallback = null) {
  if (!act) return;
  const el = [`[data-act="${act}"]`, '[data-act="feature-more"]'].map((q) => host.querySelector(q)).find((b) => b && !b.disabled)
    || (fallback && fallback.isConnected && !fallback.disabled ? fallback : null);
  if (el) el.focus();
}

/**
 * Paint the controls into `host`. It is rebuilt only when what it shows changes, so an open ⋯ menu survives the chat
 * card's once-a-second repaint.
 * deps: { act(action, body, {focus}) → Promise<{ok, error?}>, confirm(opts) → Promise<boolean>, openPlan(c),
 *         pause?(target, btn) → Promise<string|void> (a reason when refused), stop?(target), error?: string,
 *         focusFallback?() → Element|null (where the focus goes when the control it was on and ⋯ are both gone) }
 * omit: the button keys the host's run-model footer already shows (pause / stop / resume), so none shows twice. It never
 * drops Start now: no footer shows a held run's start.
 */
export function paintFeatureActions(doc, host, c, deps, { omit = [], menu: withMenu = true } = {}) {
  const buttons = featureButtons(c).filter((b) => (b.key === 'start' || !omit.includes(b.key))
    && (b.key === 'pause' ? !!deps.pause : b.key === 'stop' ? !!deps.stop : true));
  const held = c && c.active && !c.halted && c.held ? c.held : null;
  const menu = withMenu ? featureMenu(c) : [];
  // Set before the signature check: a host hidden by the caller (run-card.mjs, a non-feature paint) must reappear
  // even when the controls it shows did not change. An error (a Ship as failure on a finished feature) shows on its own.
  host.hidden = !buttons.length && !menu.length && !deps.error;
  // The held run's number is in the sig: run 3 held after run 2 started repaints with the same buttons.
  const sig = JSON.stringify([buttons, menu, held, deps.error || null]);
  if (host.dataset.sig === sig) return;          // the handlers keep the deps of the last rebuild: hosts pass stable deps
  host.dataset.sig = sig;
  const had = featureFocusOf(doc, host);
  delete host.dataset.focus;
  host.replaceChildren();
  const err = doc.createElement('div'); err.className = 'shape-feature-err'; err.setAttribute('role', 'alert');
  const fail = (text) => { err.textContent = text || ''; err.hidden = !text; };
  fail(deps.error);
  // F39: name the control before disabling it (Chromium drops the focus from a disabled button). The note on the host
  // lets a repaint in the meantime give the focus back; the button takes it again if it is still here when it is done.
  const hold = (b) => { const had = doc.activeElement === b; if (had) host.dataset.focus = b.dataset.act; b.disabled = true; return had; };
  const release = (b, had) => {
    if (!b.isConnected) return;
    b.disabled = false;
    if (had && host.dataset.focus === b.dataset.act) { delete host.dataset.focus; b.focus(); }
  };
  const run = async (action, body, b) => {
    const focus = b.dataset.act;
    const had = hold(b); fail('');
    const r = await Promise.resolve().then(() => deps.act(action, body, { focus })).catch(() => ({ ok: false }));
    if (!r || !r.ok) fail((r && r.error) || FAILED);
    release(b, had);
  };
  // The confirm takes the focus and drops it to <body> when it closes: give it back to the control (⋯ for a menu pick,
  // which menu.mjs focused before the pick), or ⋯ when a repaint replaced it, on either answer. When the confirm
  // resolves, Chromium still reports its hidden button as activeElement (it moves to <body> a frame later), so a
  // focus that is detached or inside a hidden box counts as lost too.
  const lost = (a) => !a || a === doc.body || !a.isConnected || !!a.closest('[hidden], .hidden')
    || (typeof a.checkVisibility === 'function' && !a.checkVisibility());
  const confirmed = async (opts, action, b) => {
    const act = b.dataset.act;
    const had = doc.activeElement === b;
    const ok = await deps.confirm(opts);
    if (had && lost(doc.activeElement)) focusFeatureControl(host, act);
    if (ok) await run(action, null, b);
  };
  const pick = {
    resume: (b) => run('resume', null, b),
    start: (b) => run('start', null, b),
    replan: (b) => confirmed(REPLAN_CONFIRM, 'replan', b),
    cancel: (b) => confirmed(CANCEL_CONFIRM, 'cancel', b),
    'approve-each': (b) => run('approve-each', { on: !c.approveEach }, b),
    plan: () => deps.openPlan(c),
    // deps.pause is called synchronously (in the click), so a Stop clicked right after it is seen after it.
    pause: async (b) => {
      const had = hold(b);
      let why;
      try { why = await deps.pause(c.target, b); } catch (e) { why = (e && e.message) || 'failed'; }
      if (why) { fail(`Could not pause: ${why}`); release(b, had); }
    },
    stop: () => deps.stop(c.target),
  };
  const btn = (key, label, primary) => {
    const b = doc.createElement('button'); b.type = 'button';
    b.className = `btn btn-sm ${primary ? 'btn-primary' : 'btn-quiet'} shape-feature-act shape-feature-${key}`;
    if (label) b.textContent = label;
    b.dataset.act = `feature-${key}`;
    return b;
  };
  // A run "Ask me before each run" holds: Needs you, the reason once, then its Start now.
  let row = null;
  if (held) {
    row = doc.createElement('div'); row.className = 'shape-feature-held';
    const dot = doc.createElement('span');                        // paintStatusDot owns its className
    // QA 6: the "?" is only for while Worca asks; a held run waits on you, so a plain amber dot
    paintStatusDot(dot, { ...RUN_STATES['needs-you'], state: 'needs-you', symbol: null });
    const word = doc.createElement('span'); word.className = 'shape-feature-held-word'; word.textContent = RUN_STATES['needs-you'].word;
    const why = doc.createElement('span'); why.className = 'shape-feature-held-why'; why.textContent = `Run ${held.index} waits for you to start`;
    row.append(dot, word, why);
    host.appendChild(row);
  }
  for (const x of buttons) {
    const b = btn(x.key, x.label, x.primary);
    b.disabled = !!x.disabled;
    b.addEventListener('click', (e) => { if (e.detail > 1) return; pick[x.key](b); });
    (x.key === 'start' && row ? row : host).appendChild(b);
  }
  if (menu.length) {
    const more = btn('more', null);
    more.classList.add('btn-icon');
    more.appendChild(icon(doc, 'more', 16));
    more.title = 'More actions';
    more.setAttribute('aria-label', 'More actions');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => toggleMenu({ doc, anchor: more, align: 'end', label: 'More actions',
      items: menu.map((i) => ({ label: i.label, ...(i.checked != null ? { checked: i.checked } : {}), onSelect: () => pick[i.key](more) })) }));
    host.appendChild(more);
  }
  host.appendChild(err);
  focusFeatureControl(host, had, typeof deps.focusFallback === 'function' ? deps.focusFallback() : null);
}

/** Run 4 (D18): the ⋯ items as entries for a menu outside the controls host (the group page's header ⋯), with the same
 *  confirms and posts. `anchor` gets the focus back after a confirm (Chromium drops it to <body> when the dialog closes).
 *  deps: { act(action, body) → Promise<{ok, error?}>, confirm(opts) → Promise<boolean>, openPlan(c), fail?(text) } */
export function featureMenuItems(c, deps, anchor) {
  const fail = deps.fail || (() => {});
  const run = async (action, body) => {
    const r = await Promise.resolve().then(() => deps.act(action, body)).catch(() => ({ ok: false }));
    if (!r || !r.ok) fail((r && r.error) || FAILED);
  };
  const confirmed = async (opts, action) => {
    const ok = await deps.confirm(opts);
    if (anchor && anchor.isConnected) anchor.focus();
    if (ok) await run(action, null);
  };
  const pick = {
    replan: () => confirmed(REPLAN_CONFIRM, 'replan'),
    cancel: () => confirmed(CANCEL_CONFIRM, 'cancel'),
    'approve-each': () => run('approve-each', { on: !c.approveEach }),
    plan: () => deps.openPlan(c),
  };
  return featureMenu(c).map((i) => ({ label: i.label, ...(i.checked != null ? { checked: i.checked } : {}), onSelect: () => pick[i.key]() }));
}
