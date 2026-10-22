// ui/public/chat/run-panel.mjs — worca Chat P4: the run panel's pure pieces. The panel re-hosts the run
// pages' own screens (app.js openRunDetail / openHistDetail with `host: 'panel'`); this module spells
// the panel's address, maps tab keys between the live and the saved screen, and builds its small
// chrome. No DOM work at import.

/** Below this window width an opening panel folds the Chat history column (and unfolds it on close). */
export const PANEL_HISTORY_MIN = 1500;

/** P1's own breakpoint (ask-panel.mjs HISTORY_OVERLAY_BELOW, not exported): below it the history column is an
 *  overlay with a scrim, which the panel folds but never re-opens. Keep the two equal (the helpers test pins it). */
export const PANEL_HISTORY_OVERLAY_BELOW = 1100;

/** Every user-facing string of the panel's own chrome. */
export const PANEL_STRINGS = Object.freeze({
  region: 'Run details',
  close: 'Close run panel',
  closeTip: 'Close',
  full: 'Open full page',
  loading: 'Loading the run…',
  missing: 'Could not find this run',
});

// The live screen's Q&A tab is `qa` (RD_TABS), the saved screen's `clarify` (HD_TABS).
const LIVE_TAB = Object.freeze({ clarify: 'qa' });
const SAVED_TAB = Object.freeze({ qa: 'clarify' });
const TAB_RE = /^[a-z]+$/;

/** The key `tab` names on the `kind` ('live' | 'saved') screen; '' for none or a malformed key. */
export function panelTabFor(kind, tab) {
  const t = String(tab || '').toLowerCase();
  if (!TAB_RE.test(t)) return '';
  const map = kind === 'saved' ? SAVED_TAB : LIVE_TAB;
  return Object.hasOwn(map, t) ? map[t] : t;
}

/** The thread half of a #chat param: '<thread>[/run/…]' -> '<thread>'; '' -> 'new'. */
export function panelThread(param) {
  return String(param || '').split('/')[0] || 'new';
}

/** The run half of a #chat param: '<thread>/run/<id>[/<tab>]' -> ['<id>'] | ['<id>', '<tab>']; else []. */
export function panelSegments(param) {
  const parts = String(param || '').split('/');
  if (parts[1] !== 'run' || !parts[2]) return [];
  return parts[3] ? [parts[2], parts[3]] : [parts[2]];
}

/** The panel's address (no '#'): chat/<thread|new>/run/<id>[/<tab>]. */
export function chatPanelHash(thread, id, tab = '') {
  const base = `chat/${thread || 'new'}/run/${id}`;
  return tab ? `${base}/${tab}` : base;
}

/** Where closing the panel goes (no '#'): the thread, or the Chat home for a chat with no thread yet. */
export function chatThreadHash(thread) {
  return !thread || thread === 'new' ? 'chat' : `chat/${thread}`;
}

// Static, trusted icon markup (no interpolation).
const ICON_FULL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"></path><path d="M14 4h6v6M20 4l-9 9"></path></svg>';
const ICON_CLOSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

function iconButton(doc, cls, label, tip, svg) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = `btn ${cls}`;
  b.setAttribute('aria-label', label);
  b.title = tip;
  b.innerHTML = svg;
  return b;
}

/** Open full page + Close, appended to the end of a mounted screen's bar. */
export function buildPanelBarButtons(doc) {
  const wrap = doc.createElement('span');
  wrap.className = 'crp-bar-btns';
  wrap.append(
    iconButton(doc, 'crp-full', PANEL_STRINGS.full, PANEL_STRINGS.full, ICON_FULL),
    iconButton(doc, 'crp-close', PANEL_STRINGS.close, PANEL_STRINGS.closeTip, ICON_CLOSE),
  );
  return wrap;
}

/** The panel's shell: a notice row (a run that is loading or missing) over the screen host. */
export function buildPanelShell(doc) {
  const root = doc.createElement('div');
  root.className = 'crp';
  root.dataset.crp = '';
  const msg = doc.createElement('div');
  msg.className = 'crp-msg';
  msg.hidden = true;
  const text = doc.createElement('p');
  text.className = 'crp-msg-text';
  text.setAttribute('role', 'status');
  msg.append(text, iconButton(doc, 'crp-close', PANEL_STRINGS.close, PANEL_STRINGS.closeTip, ICON_CLOSE));
  const host = doc.createElement('div');
  host.className = 'crp-host';
  root.append(msg, host);
  return root;
}

/** Show `text` in the shell's notice row; '' hides it. */
export function setPanelNotice(root, text) {
  const msg = root && root.querySelector('.crp-msg');
  if (!msg) return;
  msg.hidden = !text;
  msg.querySelector('.crp-msg-text').textContent = text || '';
}
