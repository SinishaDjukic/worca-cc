// extension/src/sidebar/sidebar-view.mjs — the sidebar's DOM, built with Ask Worca's own structure and classes
// (ui/public/ask-panel.mjs) inside worca's Chat page shell (.chat-page > .chat-convo, style.css "Chat P1: shell"), so
// the CSS cut from style.css styles it unchanged. test/extension-sidebar-markup.test.mjs pins it against makePanel.
// The composer is Ask's (ask-panel.mjs buildComposer) minus voice and Sets, plus the area-capture button.
import { parseQuotedMessage } from '../../../ui/public/pinpoint-model.mjs';
import { ATTACH_ACCEPT } from '../../../ui/public/attach-files.mjs';
import { ctxPercent, ctxLevel, fmtCtx, fmtUsd, fmtWindow, ctxBreakdown, fmtShare, kTok, CTX_COST_HINT } from '../../../ui/public/ask-meter.mjs';
import { pickerGroups } from '../../../ui/public/ask-engine.mjs';
import { modelGroups } from '../../../src/shared/connections.mjs';
import { icon } from '../../../ui/public/icons.mjs';

/** ask-panel.mjs ICONS (module-private there; the markup test reads the strings from that file and pins them). */
export const ICON = Object.freeze({
  plus: 'M12 5v14M5 12h14',
  chevronDown: 'M6 9l6 6 6-6',
  send: 'M12 19V5M6 11l6-6 6 6',
  // Not in Ask (it has no capture): the sidebar's camera and settings glyphs, same 24-grid stroke style.
  camera: ['M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  settings: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
});
/** The send glyph — the same path as ask-panel.mjs ICONS.send (the markup test reads it from that file). */
export const SEND_ICON_PATH = ICON.send;

/** Every class this module (and sidebar.mjs) puts on an element that style.css or sidebar.css must style.
 *  test/extension-css.test.mjs asserts each has a rule in the generated sidebar CSS. */
export const SIDEBAR_CLASSES = Object.freeze([
  'chat-page', 'chat-convo', 'chat-head', 'chat-dock', 'chat-composer-lead',
  'ask-transcript', 'ask-transcript-col', 'ask-msg', 'ask-user-bubble', 'ask-user-quote', 'ask-user-quote-h', 'ask-user-quote-t',
  'extras-pills', 'extra-pill', 'ask-attachment-pill', 'extra-pill-name', 'ask-answer', 'ask-answer-plain', 'ask-md', 'ask-error-line', 'ask-notice',
  'ask-composer', 'ask-composer-box', 'ask-chips', 'ask-chip', 'ask-chip-quote', 'ask-chip-quote-m', 'ask-chip-quote-k', 'ask-chip-quote-t', 'ask-chip-x',
  'ask-input', 'ask-composer-msg', 'ask-composer-row', 'ask-composer-spacer', 'ask-send', 'ask-stop',
  'wx-app', 'wx-select', 'wx-page-chip', 'wx-sends', 'wx-card', 'wx-card-t', 'wx-card-k', 'wx-state', 'wx-state-t', 'wx-state-k', 'wx-code',
  'wx-state-actions', 'wx-state-body', 'wx-settings', 'wf-disc', 'wf-disc-body', 'field', 'hint', 'wx-settings-body', 'wx-settings-row',
  'btn', 'btn-sm', 'btn-primary', 'btn-quiet', 'btn-icon', 'ic', 'chat-head-btn', 'chat-new-btn',
  // Ask's composer controls and popovers (the sidebar's own composer, D-composer). Emitted but unlisted because no rule
  // targets them on their own (they are styled through their parent): ask-model-btn-label, ask-scope-item,
  // ask-effort-row, ask-effort-item, ask-pane-back.
  'ask-scope-btn', 'ask-scope-label', 'ask-meter', 'ask-meter-cost', 'ask-ctx-ring', 'ask-ctx-ring-track', 'ask-ctx-ring-arc',
  'ask-model-btn', 'ask-model-btn-effort', 'ask-chip-name', 'ask-chip-thumb', 'ask-drop', 'ask-drop-label',
  'menu', 'menu-item', 'ask-pop', 'ask-pop-scope', 'ask-pop-model', 'ask-pop-ctx', 'ask-pop-item', 'ask-pop-caption', 'ask-pop-caption-row', 'ask-pop-caption-meter',
  'ask-pop-empty', 'ask-pop-divider', 'ask-pop-group', 'ask-pop-subgroup', 'ask-model-item', 'ask-model-name', 'ask-model-check', 'ask-model-tag',
  'ask-pop-row-value', 'ask-pop-row-chev',
  'ask-ctx-bar', 'ask-ctx-bar-used', 'ask-ctx-bar-buffer', 'ask-ctx-stat', 'ask-ctx-swatch', 'ask-ctx-stat-name', 'ask-ctx-stat-tokens',
  'ask-ctx-stat-share', 'ask-ctx-foot', 'ask-ctx-hint',
  'wx-settings-check', 'wx-pin-hint', 'wx-settings-paired',
]);

export function make(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** ask-panel.mjs svgIcon: one <path> per string (d is one path or an array). */
function svgIcon(doc, d, size, stroke) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  for (const part of [].concat(d)) { const p = doc.createElementNS(NS, 'path'); p.setAttribute('d', part); svg.appendChild(p); }
  return svg;
}

/** ask-panel.mjs ctxRing: a track and a 100-unit arc that starts at 12 o'clock. */
function ctxRing(doc) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg');
  for (const [k, v] of [['width', '16'], ['height', '16'], ['viewBox', '0 0 16 16'], ['fill', 'none'], ['aria-hidden', 'true']]) svg.setAttribute(k, v);
  for (const cls of ['ask-ctx-ring-track', 'ask-ctx-ring-arc']) {
    const c = doc.createElementNS(NS, 'circle');
    for (const [k, v] of [['class', cls], ['cx', '8'], ['cy', '8'], ['r', '6'], ['stroke-width', '2.5']]) c.setAttribute(k, v);
    svg.appendChild(c);
  }
  const arc = svg.lastChild;
  arc.setAttribute('pathLength', '100');
  arc.setAttribute('transform', 'rotate(-90 8 8)');
  arc.setAttribute('stroke-dasharray', '0 100');
  return { svg, arc };
}

/** Same structure as ask-panel.mjs buildQuoteChip (:570). */
export function buildQuoteChip(doc, q, onRemove) {
  const chip = make(doc, 'div', 'ask-chip ask-chip-quote');
  chip.setAttribute('role', 'group');
  chip.setAttribute('aria-label', 'Quoted text');
  const m = make(doc, 'div', 'ask-chip-quote-m');
  m.append(make(doc, 'div', 'ask-chip-quote-k', q.src ? `From ${q.src}` : 'Quoting'), make(doc, 'div', `ask-chip-quote-t${q.code ? ' mono' : ''}`, q.text));
  const x = make(doc, 'button', 'ask-chip-x');
  x.append(icon(doc, 'x', 12));
  x.type = 'button';
  x.setAttribute('aria-label', 'Remove quote');
  x.addEventListener('click', onRemove);
  chip.append(m, x);
  return chip;
}

export function buildPageChip(doc, { title, readable, on }, onToggle) {
  const b = make(doc, 'button', `ask-chip wx-page-chip${on ? ' is-on' : ''}`);
  b.type = 'button';
  b.disabled = !readable;
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  b.title = readable ? 'Send the readable text of this page with the next message' : 'Worca cannot read this page';
  b.append(make(doc, 'span', 'ask-chip-name', `${on ? 'Page text: on' : 'Page text: off'} · ${title || 'this page'}`));
  b.addEventListener('click', onToggle);
  return b;
}

/** "The user must see what is sent": one line in the composer's lead row. screenshots: how many area captures ride
 *  along (each with its page details); action: the running worca Action this page belongs to. */
export function buildSendsNote(doc, tab, withText, hasQuote, { screenshots = 0, action = null } = {}) {
  if (!tab || (!tab.readable && !tab.url)) return make(doc, 'div', 'wx-sends', tab && tab.reason ? tab.reason : 'No page context: Worca cannot read this page.');
  const parts = tab.readable ? ['page URL', 'title', 'your selection'] : ['page URL', 'title'];
  if (withText && tab.readable) parts.push('the page text');
  if (hasQuote) parts.push('the quoted passage');
  if (screenshots) parts.push(`${screenshots} screenshot${screenshots === 1 ? '' : 's'} with their page details`);
  if (action && action.runId) parts.push('the running worca run it belongs to');
  return make(doc, 'div', 'wx-sends', `Sends with your message: ${parts.join(', ')}.`);
}

/** ask-panel.mjs fitInput (:377): one line minimum, 120px maximum. Every programmatic write to the value must call it
 *  (an assignment fires no input event). */
export function fitInput(input) {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight || 0, 120)}px`;
}

/** ask-panel.mjs appendToComposer (:1209): append on a new line, never replace (Pinpoint Use this / Discuss / Go deeper). */
export function appendDraftText(cur, add) {
  const a = String(add ?? '').trim();
  if (!a) return String(cur ?? '');
  const c = String(cur ?? '');
  return c ? `${c.replace(/\s*$/, '')}\n${a}` : a;
}

// ---- the thread list (review M1) -------------------------------------------------------------------------------------
// Pure, so the head's <select> is a function of (list, open thread) and a jsdom test can pin it.

/** The list with `t` in it: an existing entry is updated in place (title, updatedAt); a new one goes first. */
export const THREAD_LIST_MAX = 50;   // a long sidebar session does not grow the select without bound
export function upsertThread(list, t) {
  if (!t || typeof t.id !== 'string') return list;
  const i = list.findIndex((x) => x.id === t.id);
  if (i === -1) return [{ id: t.id, title: t.title ?? null, updatedAt: t.updatedAt ?? null }, ...list].slice(0, THREAD_LIST_MAX);
  const next = list.slice();
  next[i] = { ...list[i], title: t.title ?? list[i].title ?? null, updatedAt: t.updatedAt ?? list[i].updatedAt ?? null };
  return next;
}

/** An ask-title frame: the thread's new title, or the list unchanged when the thread is not in it. */
export function retitleThread(list, id, title) {
  const i = list.findIndex((x) => x.id === id);
  if (i === -1) return list;
  const next = list.slice();
  next[i] = { ...list[i], title: title ?? null };
  return next;
}

/** A thread the server no longer has (404 on load). */
export const dropThread = (list, id) => list.filter((x) => x.id !== id);

/** The head select's options: "New chat" first (selected when no thread is open), then every thread, the open one
 *  selected. The open thread is always listed, so choosing "New chat" is always a real change. */
export function threadOptions(list, openId) {
  const rows = openId && !list.some((t) => t.id === openId) ? [{ id: openId, title: null }, ...list] : list;
  return [
    { value: '', label: 'New chat', selected: !openId },
    ...rows.map((t) => ({ value: t.id, label: t.title || 'Untitled chat', selected: t.id === openId })),
  ];
}

/** The Chat head's New chat glyph, ask-panel.mjs ICONS.plus (test/extension-sidebar-markup.test.mjs pins it to that
 *  file and to the button the Ask panel renders). */
export const NEW_CHAT_ICON_PATH = ICON.plus;

/** ask-panel.mjs checkMark: the ✓ beside the current pick, a stroke icon. */
function checkMark(doc) {
  const n = make(doc, 'span', 'ask-model-check');
  n.append(icon(doc, 'check', 12));
  return n;
}

/** ask-panel.mjs newChatButton: "+ New chat", a labelled small quiet button (.btn .btn-sm .btn-quiet) with a
 *  decorative plus; the visible label is its name. The markup test pins it to the button the Ask panel renders. */
export function buildNewChatButton(doc, className, onClick) {
  const b = make(doc, 'button', `btn btn-sm btn-quiet chat-new-btn ${className}`);
  b.type = 'button';
  b.setAttribute('data-ask-new-btn', '');
  b.appendChild(svgIcon(doc, NEW_CHAT_ICON_PATH, 14, 2));
  b.appendChild(make(doc, 'span', null, 'New chat'));
  b.addEventListener('click', onClick);
  return b;
}

/** ask-panel.mjs iconButton (:432), with its svgIcon defaults (17px, stroke 1.9). */
export function buildIconButton(doc, className, title, d, onClick) {
  const b = make(doc, 'button', className);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.appendChild(svgIcon(doc, d, 17, 1.9));
  b.addEventListener('click', onClick);
  return b;
}

// ---- the chat scope (Ask's pill + popover) ---------------------------------------------------------------------
export const NO_PROJECT_TITLE = 'Chat scope: No project';

/**
 * What the picker shows, from the lists' load state and the chat's scope. Pure.
 * → {kind:'loading'|'error', pinned, label} | {kind:'empty'} | {kind:'select', value, pinned, label, projects:[{value,label}], workspaces:[…]}
 * A pinned scope the lists lack (a removed project, or a Worca with none) is still listed, so a chat's pin always shows;
 * while the lists load or fail, the pin is labelled by its name from `names` (the last good lists, the thread's context
 * chips: Map 'p:<key>' | 'w:<id>' -> name), else by its raw key.
 */
export function scopeModel({ status, projects = [], workspaces = [], scope = null, names = null }) {
  const pin = scope && scope.pinned ? (scope.workspaceId ? `w:${scope.workspaceId}` : scope.projectKey ? `p:${scope.projectKey}` : null) : null;
  const nameOf = (v) => (names && names.get(v)) || v.slice(2);
  if (status === 'loading' || status === 'error') return { kind: status, pinned: !!pin, label: pin ? nameOf(pin) : null };
  const P = projects.map((p) => ({ value: `p:${p.key}`, label: p.name || p.key }));
  const W = workspaces.map((w) => ({ value: `w:${w.id}`, label: w.name || w.id }));
  if (pin && ![...P, ...W].some((o) => o.value === pin)) (pin.startsWith('w:') ? W : P).unshift({ value: pin, label: nameOf(pin) });
  if (!P.length && !W.length) return { kind: 'empty' };
  const hit = pin && [...P, ...W].find((o) => o.value === pin);
  return { kind: 'select', value: pin || 'auto', pinned: !!pin, label: hit ? hit.label : null, projects: P, workspaces: W };
}

/** The pill: "No project" unless pinned (then the pinned label, .is-pinned, data-pinned). m = scopeModel(…). */
export function patchScopePill(btn, label, m) {
  const pinned = !!m.pinned;
  label.textContent = pinned ? (m.label || 'Pinned') : 'No project';
  btn.classList.toggle('is-pinned', pinned);
  btn.toggleAttribute('data-pinned', pinned);
  btn.title = pinned ? `This chat is pinned to ${m.label}` : NO_PROJECT_TITLE;
}

/** Ask's openScopePopover body (ask-panel.mjs openScopePopover), sidebar wording: caption "Chat scope", "No project",
 *  Projects, Workspaces — or the loading / error (+ Retry) / empty (+ Open Worca) lines. */
export function fillScopePopover(doc, panel, m, { onPick, onRetry, onOpen }) {
  panel.appendChild(make(doc, 'div', 'ask-pop-caption', 'Chat scope'));
  if (m.kind === 'loading') { panel.appendChild(make(doc, 'div', 'ask-pop-empty', 'Loading projects…')); return; }
  if (m.kind === 'error') {
    panel.append(make(doc, 'div', 'ask-pop-empty', 'Couldn\'t load projects'), menuItem(doc, 'ask-scope-item', 'Retry', onRetry));
    return;
  }
  const any = menuItem(doc, 'ask-scope-item', 'No project', () => onPick('auto'), { checked: m.kind !== 'select' || !m.pinned });
  any.title = NO_PROJECT_TITLE;
  panel.appendChild(any);
  if (m.kind === 'empty') {
    panel.append(make(doc, 'div', 'ask-pop-divider'), make(doc, 'div', 'ask-pop-empty', 'No projects in this Worca yet'), menuItem(doc, 'ask-scope-item', 'Open Worca', onOpen));
    return;
  }
  for (const [caption, list] of [['Projects', m.projects], ['Workspaces', m.workspaces]]) {
    if (!list.length) continue;
    panel.append(make(doc, 'div', 'ask-pop-divider'), make(doc, 'div', 'ask-pop-caption', caption));
    for (const o of list) panel.appendChild(menuItem(doc, 'ask-scope-item', o.label, () => onPick(o.value), { checked: m.value === o.value }));
  }
}

// ---- Ask's popover primitive (openPopover / menuItem / onPopKeydown), minimal ------------------------------------
/** One popover at a time on `host` (the .ask-composer, which the shell CSS positions .ask-pop against). */
export function createPopovers(doc, host) {
  let cur = null;
  const items = (p) => [...p.querySelectorAll('.ask-pop-item:not(:disabled)')];
  const onDocDown = (e) => { if (cur && !cur.panel.contains(e.target) && !cur.trigger.contains(e.target)) close({ focusTrigger: false }); };
  function close({ focusTrigger = true } = {}) {
    if (!cur) return;
    const { panel, trigger } = cur;
    cur = null;
    panel.remove();
    trigger.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', onDocDown, true);
    if (focusTrigger) { try { trigger.focus(); } catch { /* gone */ } }
  }
  const focusFirst = (panel) => { const first = items(panel)[0]; if (first) { first.tabIndex = 0; try { first.focus(); } catch { /* ignore */ } } };
  const onKey = (e) => {
    if (!cur) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const list = items(cur.panel);
    if (!list.length) return;
    const i = list.indexOf(doc.activeElement);
    const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const it = list[(to + list.length) % list.length];
    it.tabIndex = 0;
    it.focus();
  };
  return {
    isOpen: (trigger) => !!cur && (!trigger || cur.trigger === trigger),
    close,
    /** Toggle: a second click on the same trigger closes. build(panel) fills it; rebuild() re-runs it. */
    open(trigger, panelClass, build) {
      if (cur && cur.trigger === trigger) { close({ focusTrigger: false }); return null; }
      close({ focusTrigger: false });
      const panel = make(doc, 'div', `menu ask-pop ${panelClass}`);
      panel.setAttribute('role', 'menu');
      panel.addEventListener('keydown', onKey);
      build(panel);
      host.appendChild(panel);
      trigger.setAttribute('aria-expanded', 'true');
      cur = { panel, trigger, build };
      doc.addEventListener('pointerdown', onDocDown, true);
      focusFirst(panel);
      return panel;
    },
    rebuild() {
      if (!cur) return;
      const had = cur.panel.contains(doc.activeElement);
      cur.panel.replaceChildren();
      cur.build(cur.panel);
      if (had) focusFirst(cur.panel);
    },
  };
}

/** ask-panel.mjs menuItem + its label/✓ children. labelClass null: a bare <span> (Ask's Effort row and pane back). */
export function menuItem(doc, className, label, onPick, { checked = false, disabled = false, labelClass = 'ask-model-name' } = {}) {
  const b = make(doc, 'button', `menu-item ask-pop-item ${className}`.trim());
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.tabIndex = -1;
  b.disabled = disabled;
  b.appendChild(make(doc, 'span', labelClass, label));
  if (checked) b.appendChild(checkMark(doc));
  if (onPick && !disabled) b.addEventListener('click', onPick);
  return b;
}

const tag = (doc, text, variant, title) => { const t = make(doc, 'span', `ask-model-tag ${variant}`, text); if (title) t.title = title; return t; };

/** Ask's openModelPopover (minus "More models" and the credential badge): engine sections (pickerGroups), connection
 *  sub-groups (modelGroups), status tags, ✓ on the pick; the Effort row opens the effort pane. Hidden rows are not listed. */
export function fillModelPopover(doc, panel, { catalog, pick, lock, pane = 'main', onModel, onEffort, onPane }) {
  const models = (catalog && Array.isArray(catalog.models) ? catalog.models : []).filter((m) => m && !m.hidden);
  const entry = (catalog && Array.isArray(catalog.models) ? catalog.models : []).find((m) => pick && m.id === pick.model) || null;
  if (pane === 'effort') {
    const back = menuItem(doc, 'ask-pane-back', '‹ Effort', () => onPane('main'), { labelClass: null });
    back.setAttribute('data-ask-pane-back', '');
    panel.append(back, make(doc, 'div', 'ask-pop-divider'));
    const efforts = entry && Array.isArray(entry.efforts) ? entry.efforts : ['medium', 'high', 'xhigh', 'max'];
    for (const e of efforts) panel.appendChild(menuItem(doc, 'ask-effort-item', e, () => onEffort(e), { checked: !!pick && pick.effort === e }));
    return;
  }
  const sections = pickerGroups(models, { lock });
  for (const g of sections) {
    if (sections.length > 1) panel.appendChild(make(doc, 'div', 'ask-pop-group', g.label));
    const conns = modelGroups(g.models, { engine: g.engine });
    for (const c of conns) {
      if (conns.length > 1) panel.appendChild(make(doc, 'div', 'ask-pop-subgroup', c.label));
      for (const m of c.models) {
        const it = menuItem(doc, 'ask-model-item', m.label || m.id, () => onModel(m.id));
        if (m.costUnreliable) it.appendChild(tag(doc, '⚠cost', 'is-warn', 'This model reported no cost while consuming tokens — chat spend may not count toward the budget.'));
        if (Array.isArray(m.secretsMissing) && m.secretsMissing.length) {
          it.appendChild(tag(doc, 'secret not set', 'is-err', `${m.secretsMissing.join(', ')} is not set — configure it in the ${m.plugin ? `“${m.plugin}” ` : ''}plugin's Model secrets, or this model will fail.`));
        }
        if (m.needsSignIn) it.appendChild(tag(doc, 'needs sign-in', 'is-err', m.signInMessage || 'The provider behind this model is not usable yet — the Providers page.'));
        if (pick && m.id === pick.model) it.appendChild(checkMark(doc));
        panel.appendChild(it);
      }
    }
  }
  panel.appendChild(make(doc, 'div', 'ask-pop-divider'));
  const noEffort = !!(entry && entry.noEffort);
  const row = menuItem(doc, 'ask-effort-row', 'Effort', noEffort ? null : () => onPane('effort'), { disabled: noEffort, labelClass: null });
  row.setAttribute('data-ask-effort-row', '');
  if (noEffort) {
    row.title = 'This model takes no reasoning effort, so none is sent.';
    row.appendChild(make(doc, 'span', 'ask-pop-row-value', 'not supported'));
  } else {
    row.append(make(doc, 'span', 'ask-pop-row-value', pick ? pick.effort : ''), make(doc, 'span', 'ask-pop-row-chev', '›'));
  }
  panel.appendChild(row);
}

/** The meter's figures from ask-model totals() — ask-panel.mjs currentCtx + updateMeters, as data. Pure. */
export function meterState(totals) {
  const t = totals || {};
  const lu = t.live && t.live.usage ? t.live.usage : null;
  const rawCtx = lu && Number.isFinite(lu.ctx) ? lu.ctx : t.ctx;
  const rawWin = lu && Number.isInteger(lu.ctxWindow) ? lu.ctxWindow : t.ctxWindow;
  const ctx = Number.isFinite(rawCtx) ? rawCtx : null;
  const win = Number.isInteger(rawWin) ? rawWin : null;
  const pct = ctxPercent(ctx, win);
  const fill = pct != null ? +Math.min(100, (ctx / win) * 100).toFixed(2) : 0;
  const lv = t.live || null;
  const liveCost = lv ? (Number.isFinite(lv.costUsd) ? lv.costUsd : (Number.isFinite(lv.estimatedCostUsd) ? lv.estimatedCostUsd : null)) : null;
  const cost = liveCost != null ? `≈${fmtUsd((Number.isFinite(t.costUsd) ? t.costUsd : 0) + liveCost)}` : (t.costUsd == null ? '' : (fmtUsd(t.costUsd) || ''));
  return { ctx, win, pct, fill, level: ctxLevel(ctx, win), figure: fmtCtx(ctx, win), cost };
}

/** ask-panel.mjs updateMeters on the composer's refs, from meterState(). */
export function patchMeter(refs, s) {
  refs.meterCost.textContent = s.cost;
  refs.ctxArc.setAttribute('stroke-dasharray', `${s.fill} 100`);
  if (s.figure) refs.ctxBtn.title = `${s.figure}${s.pct != null ? ` · ${s.pct}%` : ''}`;
  else refs.ctxBtn.removeAttribute('title');
  refs.ctxBtn.classList.toggle('is-ctx-warn', s.level === 'warn');
  refs.ctxBtn.classList.toggle('is-ctx-high', s.level === 'high');
  refs.ctxBtn.setAttribute('aria-label', s.pct != null ? `Context window, ${s.pct}% full` : 'Context window');
}

const levelClass = (level) => (level === 'warn' || level === 'high' ? ` is-ctx-${level}` : '');

/** Ask's buildCtxPopover (ask-panel.mjs), the window's figures only (no topics / agents / worktrees), plus this chat's
 *  cost. s = meterState(). */
export function fillCtxPopover(doc, p, s) {
  const { ctx, win } = s;
  const b = ctxBreakdown(ctx, win);
  p.setAttribute('aria-label', 'Context window');
  const head = make(doc, 'div', 'ask-pop-caption-row');
  head.append(make(doc, 'span', 'ask-pop-caption', 'Context window'), make(doc, 'span', 'ask-pop-caption-meter', b ? `${kTok(ctx)} / ${fmtWindow(win)} (${b.pct}%)` : (ctx > 0 ? kTok(ctx) : '')));
  p.appendChild(head);
  if (!b) {
    p.appendChild(make(doc, 'div', 'ask-pop-empty', 'The window shows after the first answer.'));
  } else {
    const bar = make(doc, 'div', 'ask-ctx-bar');
    bar.setAttribute('aria-hidden', 'true');
    const used = make(doc, 'span', `ask-ctx-bar-used${levelClass(b.level)}`);
    used.style.width = `${+Math.min(100, (ctx / win) * 100).toFixed(2)}%`;
    bar.appendChild(used);
    const hatch = Math.min(b.buffer, Math.max(0, win - ctx));
    if (hatch > 0) {
      const buf = make(doc, 'span', 'ask-ctx-bar-buffer');
      buf.style.width = `${+((hatch / win) * 100).toFixed(2)}%`;
      bar.appendChild(buf);
    }
    p.appendChild(bar);
    for (const [key, name, n] of [['used', 'Used', b.used], ['buffer', 'Autocompact buffer', b.buffer], ['free', 'Free space', b.free]]) {
      if (key === 'buffer' && n <= 0) continue;
      const r = make(doc, 'div', `ask-ctx-stat${key === 'used' ? levelClass(b.level) : ''}`);
      r.dataset.stat = key;
      r.append(make(doc, 'span', 'ask-ctx-swatch'), make(doc, 'span', 'ask-ctx-stat-name', name), make(doc, 'span', 'ask-ctx-stat-tokens', kTok(n)), make(doc, 'span', 'ask-ctx-stat-share', fmtShare(n, win)));
      p.appendChild(r);
    }
    p.appendChild(b.level === 'high'
      ? make(doc, 'div', 'ask-ctx-foot is-ctx-high', 'Compaction soon')
      : make(doc, 'div', 'ask-ctx-foot', `${kTok(b.untilCompact)} until auto-compact`));
  }
  if (ctx >= CTX_COST_HINT) p.appendChild(make(doc, 'div', 'ask-ctx-hint', `Each message re-sends about ${(ctx / 1000).toFixed(1)}k tokens.`));
  if (s.cost) p.appendChild(make(doc, 'div', 'ask-ctx-hint', `This chat so far: ${s.cost}`));
}

/** The messages route echoes {id,name,bytes,kind,mime}; ask-model reads attKind (ask-panel.mjs:975). */
export function echoAttachments(stored) {
  return (Array.isArray(stored) ? stored : []).map((a) => ({ id: a.id, name: a.name, bytes: a.bytes, attKind: a.kind ?? 'text', mime: a.mime ?? null }));
}

/**
 * The composer — Ask's bottom bar (ask-panel.mjs buildComposer) minus voice and Sets, plus the capture button.
 * Built ONCE per paired session (M4). → refs; every handler is the caller's (missing ones do nothing).
 * @param {{placeholder:string, onInput, onSend, onStop, onFiles?:(files:File[])=>void, onPaste?:(e:ClipboardEvent)=>void,
 *          onCapture?, onScope?:(btn)=>void, onModel?:(btn)=>void, onCtx?:(btn)=>void}} o
 */
export function buildComposer(doc, o) {
  const call = (fn, ...a) => { if (typeof fn === 'function') fn(...a); };
  const wrap = make(doc, 'div', 'ask-composer');
  const box = make(doc, 'div', 'ask-composer-box');
  const lead = make(doc, 'div', 'chat-composer-lead');
  lead.setAttribute('data-chat-composer-lead', '');
  const chips = make(doc, 'div', 'ask-chips');
  chips.hidden = true;
  const input = doc.createElement('textarea');
  input.className = 'ask-input';
  input.rows = 1;
  input.placeholder = o.placeholder;
  input.addEventListener('input', () => { fitInput(input); o.onInput(input.value); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); o.onSend(); } });
  input.addEventListener('paste', (e) => call(o.onPaste, e));
  const msg = make(doc, 'div', 'ask-composer-msg');
  msg.hidden = true;
  const row = make(doc, 'div', 'ask-composer-row');
  const file = doc.createElement('input');
  file.type = 'file';
  file.multiple = true;
  file.accept = ATTACH_ACCEPT;
  file.hidden = true;
  file.addEventListener('change', () => { const fs = [...(file.files || [])]; file.value = ''; if (fs.length) call(o.onFiles, fs); });
  const attach = buildIconButton(doc, 'btn btn-quiet btn-icon', 'Attach files', ICON.plus, () => file.click());
  attach.setAttribute('data-ask-attach-btn', '');
  const capture = buildIconButton(doc, 'btn btn-quiet btn-icon', 'Capture an area of the page', ICON.camera, () => call(o.onCapture));
  capture.setAttribute('data-wx-capture-btn', '');
  const scope = make(doc, 'button', 'btn btn-sm btn-quiet ask-scope-btn');
  scope.type = 'button';
  scope.setAttribute('data-ask-scope-btn', '');
  scope.setAttribute('aria-haspopup', 'menu');
  scope.title = NO_PROJECT_TITLE;
  const scopeLabel = make(doc, 'span', 'ask-scope-label', 'No project');
  scope.append(scopeLabel, svgIcon(doc, ICON.chevronDown, 11, 2));
  scope.addEventListener('click', () => call(o.onScope, scope));
  const spacer = make(doc, 'span', 'ask-composer-spacer');
  const meter = make(doc, 'span', 'ask-meter');
  meter.setAttribute('data-ask-meter', '');
  const meterCost = make(doc, 'span', 'ask-meter-cost', '');
  const ctxBtn = make(doc, 'button', 'btn btn-sm btn-quiet btn-icon ask-ctx-ring');
  ctxBtn.type = 'button';
  ctxBtn.setAttribute('data-ask-ctx-btn', '');
  ctxBtn.setAttribute('aria-haspopup', 'menu');
  ctxBtn.setAttribute('aria-expanded', 'false');
  ctxBtn.setAttribute('aria-label', 'Context window');
  const ring = ctxRing(doc);
  ctxBtn.appendChild(ring.svg);
  ctxBtn.addEventListener('click', () => call(o.onCtx, ctxBtn));
  meter.append(meterCost, ctxBtn);
  const model = make(doc, 'button', 'btn btn-sm btn-quiet ask-model-btn');
  model.type = 'button';
  model.setAttribute('data-ask-model-btn', '');
  model.setAttribute('aria-haspopup', 'menu');
  const modelLabel = make(doc, 'span', 'ask-model-btn-label', '');
  const modelEffort = make(doc, 'span', 'ask-model-btn-effort', '');
  model.append(modelLabel, modelEffort, svgIcon(doc, ICON.chevronDown, 12, 2));
  model.addEventListener('click', () => call(o.onModel, model));
  const send = make(doc, 'button', 'btn btn-primary btn-icon ask-send');
  send.type = 'button';
  send.setAttribute('data-ask-send', '');
  send.setAttribute('aria-label', 'Send');
  send.appendChild(svgIcon(doc, ICON.send, 15, 2.2));
  send.addEventListener('click', o.onSend);
  const stop = make(doc, 'button', 'btn btn-icon ask-stop');
  stop.type = 'button';
  stop.setAttribute('data-ask-stop', '');
  stop.setAttribute('aria-label', 'Stop');
  stop.hidden = true;
  const sq = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  // The Ask panel's exact glyph (ask-panel.mjs buildComposer's stop rect), for pixel parity.
  sq.setAttribute('width', '10'); sq.setAttribute('height', '10'); sq.setAttribute('viewBox', '0 0 24 24');
  sq.setAttribute('fill', 'currentColor'); sq.setAttribute('aria-hidden', 'true');
  const r = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
  r.setAttribute('x', '6'); r.setAttribute('y', '6'); r.setAttribute('width', '12'); r.setAttribute('height', '12'); r.setAttribute('rx', '2');
  sq.appendChild(r);
  stop.appendChild(sq);
  stop.addEventListener('click', o.onStop);
  row.append(file, attach, capture, scope, spacer, meter, model, send, stop);
  box.append(lead, chips, input, msg, row);
  wrap.appendChild(box);
  return { el: wrap, lead, chips, input, msg, file, attach, capture, scope, scopeLabel, meter, meterCost, ctxBtn, ctxArc: ring.arc, model, modelLabel, modelEffort, send, stop };
}

/** ask-panel.mjs buildDropTarget's overlay (the caller wires the drag events on .chat-convo). */
export function buildDropOverlay(doc) {
  const d = make(doc, 'div', 'ask-drop');
  d.setAttribute('data-ask-drop', '');
  d.setAttribute('aria-hidden', 'true');
  d.hidden = true;
  d.appendChild(make(doc, 'span', 'ask-drop-label', 'Drop files to attach'));
  return d;
}

/** ask-panel.mjs renderChips' file chip: thumb (images), name, ×. A screenshot's chip names its page in the hover. */
export function buildFileChip(doc, f, onRemove) {
  const chip = make(doc, 'span', 'ask-chip');
  if (f.attKind === 'image' && f.dataBase64) {
    const img = doc.createElement('img');
    img.className = 'ask-chip-thumb';
    img.alt = f.name;
    img.src = `data:${f.mime};base64,${f.dataBase64}`;
    chip.appendChild(img);
  }
  chip.appendChild(make(doc, 'span', 'ask-chip-name', f.name));
  if (f.capture) chip.title = `Screenshot of ${f.capture.url}`;
  const x = make(doc, 'button', 'ask-chip-x');
  x.append(icon(doc, 'x', 12));
  x.type = 'button';
  x.setAttribute('aria-label', `Remove ${f.name}`);
  x.addEventListener('click', onRemove);
  chip.appendChild(x);
  return chip;
}

/** Same as ask-panel.mjs renderAnswerInto (:4976): live rows read model.live().text, md vs plain classes. */
export function renderAnswerInto(div, text, renderer, { live = false } = {}) {
  const out = renderer.render(text);
  if (out.kind === 'md') {
    div.classList.add('ask-md');
    div.classList.remove('ask-answer-plain');
    div.replaceChildren(out.frag);
    if (!live && typeof renderer.highlight === 'function') renderer.highlight(div);
  } else {
    div.classList.add('ask-answer-plain');
    div.classList.remove('ask-md');
    div.textContent = text;
  }
}

/** ask-panel.mjs buildAttachmentPill's text branch (:2648). Images are pills here too: an <img> cannot send the token. */
export function buildAttachmentPill(doc, b) {
  const pill = make(doc, 'span', 'extra-pill ask-attachment-pill');
  pill.appendChild(make(doc, 'span', 'extra-pill-name', b.name || '(attachment)'));
  return pill;
}

/**
 * One transcript row, ask-panel.mjs buildMessage (:5025) minus the activity/thinking rows and live cards.
 * @param {{text:(row)=>string, live:(row)=>boolean, renderer:object, sentQuote?:object|null, openInWorca:()=>void}} o
 * → { el, answer } (answer: the .ask-answer element to patch on ask-delta, or null)
 */
export function buildRow(doc, row, { text, live, renderer, sentQuote = null, openInWorca }) {
  const wrap = make(doc, 'div', `ask-msg ask-msg-${row.role}`);
  if (row.role === 'user') {
    const parsed = parseQuotedMessage(row.text || '');
    // A sidebar message's quote rides page-quote.md (M1); this session shows it as the quote card it was sent with.
    const quote = parsed.quote || sentQuote;
    const rest = parsed.quote ? parsed.rest : (row.text || '');
    if (quote) {
      const card = make(doc, 'div', 'ask-user-quote');
      card.append(make(doc, 'div', 'ask-user-quote-h', quote.src ? `From ${quote.src}` : 'Quoted'), make(doc, 'div', 'ask-user-quote-t', quote.text));
      wrap.appendChild(card);
    }
    if (!quote || rest) wrap.appendChild(make(doc, 'div', 'ask-user-bubble', rest));
    const atts = (row.blocks || []).filter((b) => b && b.kind === 'attachment');
    if (atts.length) {
      const pills = make(doc, 'div', 'extras-pills ask-user-pills');
      for (const b of atts) pills.appendChild(buildAttachmentPill(doc, b));
      wrap.appendChild(pills);
    }
    return { el: wrap, answer: null };
  }
  if (row.role === 'system') {
    const notices = (row.blocks || []).filter((b) => b && b.kind === 'notice');
    for (const b of notices.length ? notices : [{ text: row.text }]) { const n = make(doc, 'div', 'ask-notice'); n.appendChild(make(doc, 'span', null, b.text || '')); wrap.appendChild(n); }
    return { el: wrap, answer: null };
  }
  const answer = make(doc, 'div', 'ask-answer');
  wrap.appendChild(answer);
  renderAnswerInto(answer, text(row), renderer, { live: live(row) });
  for (const b of row.blocks || []) {
    if (!b) continue;
    if (b.kind === 'notice') { const n = make(doc, 'div', 'ask-notice'); n.appendChild(make(doc, 'span', null, b.text || '')); wrap.appendChild(n); }
    else if (b.kind === 'card') {
      const card = make(doc, 'div', 'wx-card');
      card.append(make(doc, 'div', 'wx-card-t', (b.card && (b.card.title || b.card.brief)) || 'Card'), make(doc, 'div', 'wx-card-k', 'Act on this card in Worca.'));
      const open = make(doc, 'button', 'btn', 'Open in Worca');
      open.type = 'button';
      open.addEventListener('click', openInWorca);
      card.append(open);
      wrap.appendChild(card);
    }
  }
  if (row.status === 'error') {
    // ask-panel.mjs:5085-5093 (minus the signed-out "Sign in…" link, which needs the app): a CLASSIFIED notice is the
    // explanation and suppresses the raw line; otherwise errorMessage, else the generic line only when no notice exists.
    const classified = (row.blocks || []).some((b) => b && b.kind === 'notice' && (b.errorClass || b.codexSetup));
    if (!classified) {
      const explained = (row.blocks || []).some((b) => b && b.kind === 'notice');
      if (row.errorMessage) wrap.appendChild(make(doc, 'div', 'ask-error-line', row.errorMessage));
      else if (!explained) wrap.appendChild(make(doc, 'div', 'ask-error-line', 'This turn ended with an error.'));
    }
  }
  return { el: wrap, answer };
}

/** Offline / unpaired / pairing / denied / expired / remote states. */
export function buildState(doc, kind, props = {}) {
  const box = make(doc, 'div', `wx-state wx-${kind}`);
  box.append(...stateNodes(doc, kind, props));
  return box;
}

/** A state screen's title, text and (pairing) code. sidebar.mjs patches these into ONE screen, so the Settings below
 *  them are never rebuilt. */
export function stateNodes(doc, kind, props = {}) {
  const T = {
    offline: props.reason
      ? ['Worca could not load this chat', `Worca at ${props.baseUrl} answered with an error: ${props.reason}`]
      : ['Worca isn\'t running', `Nothing answers at ${props.baseUrl}. Start it with "worca ui" (or "npx @worca/app"), then try again.`],
    unpaired: ['Connect to Worca', 'Pair this browser with your local Worca. Worca will ask you to approve it.'],
    pairing: ['Approve in Worca', 'Worca shows a prompt with this code. Approve it there only if the codes match.'],
    denied: ['Pairing was declined', 'Worca declined this browser. You can ask again.'],
    expired: ['The pairing request expired', 'Nobody answered in time. Ask again.'],
    remote: ['Local Worca only', 'This Worca has remote access on; the browser extension works with a local Worca only.'],
  }[kind];
  const out = [make(doc, 'h2', 'wx-state-t', T[0]), make(doc, 'p', 'wx-state-k', T[1])];
  if (kind === 'pairing') out.push(make(doc, 'div', 'wx-code mono', props.code));
  return out;
}

/**
 * Settings: worca's disclosure (.wf-disc) — the "Show Pinpoint when I select text" option (D10), then a labelled address
 * row with a compact Save, and a hint. Built ONCE per sidebar page (and once in the paired shell) and kept across every
 * state screen, so a retry never collapses it or drops what is typed.
 * → { el, input, pinpoint, pinHint, sync(v), reset(v), invalid(msg), setPinpoint(on) }
 */
export function buildSettings(doc, { value, onSave, pinpointOnSelect = false, onPinpoint = () => {} }) {
  const d = make(doc, 'details', 'wf-disc wx-settings');
  d.append(make(doc, 'summary', null, 'Settings'));
  const body = make(doc, 'div', 'field wf-disc-body wx-settings-body');
  const check = make(doc, 'label', 'wx-settings-check');
  const pinpoint = doc.createElement('input');
  pinpoint.type = 'checkbox';
  pinpoint.id = 'wx-pinpoint-select';
  pinpoint.checked = !!pinpointOnSelect;
  pinpoint.addEventListener('change', () => onPinpoint(pinpoint.checked));
  check.append(pinpoint, doc.createTextNode(' Show Pinpoint when I select text'));
  const pinHint = make(doc, 'p', 'hint wx-pin-hint', pinHintText('Alt+Shift+W'));
  body.append(check, pinHint);
  const label = make(doc, 'label', null, 'Worca address');
  label.htmlFor = 'wx-base-url';
  const row = make(doc, 'div', 'wx-settings-row');
  const input = make(doc, 'input', 'input');
  input.id = 'wx-base-url';
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.value = value;
  input.addEventListener('input', () => input.setCustomValidity(''));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onSave(input.value); } });
  const save = make(doc, 'button', 'btn btn-sm', 'Save');
  save.type = 'button';
  save.addEventListener('click', () => onSave(input.value));
  row.append(input, save);
  body.append(label, row, make(doc, 'p', 'hint', 'Only 127.0.0.1 or localhost. Saving forgets the pairing.'));
  d.append(body);
  let shown = value;
  const reset = (v) => { shown = v; input.value = v; input.setCustomValidity(''); };
  return {
    el: d,
    input,
    pinpoint,
    pinHint,
    setPinpoint(on) { pinpoint.checked = !!on; },
    /** The live shortcut (commands.getAll), so a user who rebound it sees their own key. */
    setShortcut(key) { pinHint.textContent = pinHintText(key); },
    /** The stored address: the input follows it only when it really changed; otherwise what is typed stays. */
    sync(v) { if (v !== shown) reset(v); },
    reset,
    invalid(msg) { input.setCustomValidity(msg); input.reportValidity(); },
  };
}

/** The Pinpoint option's hint, naming the bound shortcut (or saying none is bound). */
export function pinHintText(key) {
  return key ? `Off: select text, then press the Pinpoint shortcut (${key}).` : 'Off: select text, then set a Pinpoint shortcut in the browser\'s extension shortcuts.';
}
