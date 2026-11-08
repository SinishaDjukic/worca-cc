// The Design stage's Agents popover and the HUD dot's tip (ui/public/design/agents-panel.mjs), per the mock's
// `popover()` and `tip()` (canvas/build.mjs). Both paint the plain rows `selectAgentRows` gives:
// `{running, rows:[{agentId, name, crew, status, statusClass, action, cost, costTitle, gone, canStop}]}`.
// Every string reaches the DOM through `textContent`; a dot's colour is only ever `var(<crew token>)`.
// Pure: DOM only through `doc`, nothing at import time.
import { icon } from '../icons.mjs';

const TOKEN_RE = /^--[a-z0-9-]+$/i;
const STATUS_CLASS_RE = /^is-[a-z-]+$/;

/** `var(--token)` for a crew token name, or '' for anything else. */
const tokenVar = (crew) => (typeof crew === 'string' && TOKEN_RE.test(crew) ? `var(${crew})` : '');
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function setTitle(node, text) {
  if (text) node.title = text;
  else node.removeAttribute('title');
}

function errorText(err) {
  if (typeof err === 'string') return err;
  return typeof err?.message === 'string' ? err.message : '';
}

/**
 * The Agents popover: a dialog over the stage listing every agent of the round, running ones first as the model
 * orders them. Closed, `paint` only keeps the model; `open` paints it and takes the focus on × (never the unconfirmed
 * Stop), and a repaint keeps the focus inside it; closing gives it back to where it was when the popover opened, when
 * the focus is still inside it.
 * @param {{doc: Document, host?: HTMLElement, onStopAgent?: (agentId: string) => (void|Promise<void>),
 *   onClose?: () => void}} o
 * @returns {{el: HTMLElement, open: (agentId?: string) => void, close: () => void, isOpen: () => boolean,
 *   paint: (model: object) => void, destroy: () => void}}
 */
export function createAgentsPanel({ doc, host, onStopAgent, onClose }) {
  const el = make(doc, 'div', 'dz-pop');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Agents');
  el.hidden = true;
  const count = make(doc, 'span', 'dz-meta');
  const closeBtn = make(doc, 'button', 'btn btn-sm btn-quiet btn-icon');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.title = 'Close';
  closeBtn.appendChild(icon(doc, 'x', 14));
  const head = make(doc, 'div', 'dz-pop-head');
  head.append(make(doc, 'b', null, 'Agents'), count, make(doc, 'span', 'dz-spacer'), closeBtn);
  const list = make(doc, 'div', 'dz-pop-list');
  el.append(head, list);
  host?.appendChild(el);

  let opened = false;
  let destroyed = false;
  let picked = null;
  let scrollOwed = false;
  let last = null;
  // What had the focus when the popover opened (a HUD dot), given it back on close.
  let returnTo = null;
  /** agentId -> {row, dot, name, stat, act, cost, stop} */
  const entries = new Map();
  /** agentId -> the row model of the last paint */
  const models = new Map();
  /** agentIds whose Stop is in flight */
  const pending = new Set();
  /** agentId -> {message, status}: a refused Stop, shown until the agent's status moves on */
  const refused = new Map();

  function makeEntry(agentId) {
    const e = {
      row: make(doc, 'div', 'dz-arow'),
      dot: make(doc, 'i', 'dz-adot'),
      name: make(doc, 'span', 'dz-aname'),
      stat: make(doc, 'span', 'dz-astat'),
      act: make(doc, 'span', 'dz-aact'),
      cost: make(doc, 'span', 'dz-acost'),
      stop: null,
      agentId,
    };
    e.row.append(e.dot, e.name, e.stat, e.act, e.cost);
    return e;
  }

  function stopButton(e) {
    const b = make(doc, 'button', 'btn btn-sm btn-quiet btn-icon');
    b.type = 'button';
    b.appendChild(icon(doc, 'stop-square', 14));
    b.addEventListener('click', () => { stopAgent(e.agentId); });
    return b;
  }

  function fill(e, r) {
    const id = e.agentId;
    e.row.className = 'dz-arow';
    if (r.gone === true) e.row.classList.add('is-gone');
    if (picked != null && picked === id) e.row.classList.add('is-picked');
    const bg = tokenVar(r.crew);
    if (bg) e.dot.style.background = bg;
    else e.dot.style.removeProperty('background');
    e.name.textContent = str(r.name);
    const ref = refused.get(id);
    if (ref && ref.status !== str(r.status)) refused.delete(id);
    if (refused.has(id)) {
      e.stat.className = 'dz-astat is-fail';
      e.stat.textContent = 'Could not stop';
      setTitle(e.stat, ref.message);
    } else {
      e.stat.className = 'dz-astat';
      if (STATUS_CLASS_RE.test(str(r.statusClass))) e.stat.classList.add(r.statusClass);
      e.stat.textContent = str(r.status);
      setTitle(e.stat, '');
    }
    e.act.textContent = str(r.action);
    setTitle(e.act, str(r.action));
    e.cost.textContent = str(r.cost);
    setTitle(e.cost, str(r.costTitle));
    if (r.canStop === true) {
      if (!e.stop) { e.stop = stopButton(e); e.row.appendChild(e.stop); }
      const label = `Stop ${str(r.name)}`;
      e.stop.setAttribute('aria-label', label);
      e.stop.title = label;
      e.stop.disabled = pending.has(id);
    } else if (e.stop) {
      e.stop.remove();
      e.stop = null;
    }
  }

  // Runs a repaint and keeps the focus in the popover. A repaint that removes the focused Stop (its agent ended, or the
  // round paused) or the row holding it, moves that row, or disables that Stop (pressed: Chrome blurs it a frame later)
  // leaves the focus on <body>, where Esc reaches nothing: the same button gets it back when it can hold it, else ×.
  const holds = (node) => el.contains(node) && node.disabled !== true;
  function keepFocus(repaint) {
    const had = el.contains(doc.activeElement) ? doc.activeElement : null;
    repaint();
    if (!had || !opened || holds(doc.activeElement)) return;
    if (holds(had)) had.focus();
    if (!holds(doc.activeElement)) closeBtn.focus();
  }

  function repaintOne(agentId) {
    const e = entries.get(agentId);
    const r = models.get(agentId);
    if (opened && e && r) keepFocus(() => fill(e, r));
  }

  async function stopAgent(agentId) {
    if (destroyed || pending.has(agentId) || typeof onStopAgent !== 'function') return;
    pending.add(agentId);
    refused.delete(agentId);
    repaintOne(agentId);
    try {
      await onStopAgent(agentId);
    } catch (err) {
      if (!destroyed) refused.set(agentId, { message: errorText(err), status: str(models.get(agentId)?.status) });
    } finally {
      pending.delete(agentId);
      if (!destroyed) repaintOne(agentId);
    }
  }

  function scrollPicked() {
    if (!scrollOwed || picked == null) return;
    const e = entries.get(picked);
    if (!e) return;
    scrollOwed = false;
    e.row.scrollIntoView?.({ block: 'nearest' });
  }

  function render() {
    const rows = Array.isArray(last?.rows) ? last.rows : [];
    count.textContent = `${Number.isFinite(last?.running) ? last.running : 0} running`;
    const seen = new Set();
    let prev = null;
    for (const r of rows) {
      const id = r?.agentId;
      if (typeof id !== 'string' || seen.has(id)) continue;
      seen.add(id);
      let e = entries.get(id);
      if (!e) { e = makeEntry(id); entries.set(id, e); }
      models.set(id, r);
      fill(e, r);
      const want = prev ? prev.nextSibling : list.firstChild;
      if (want !== e.row) list.insertBefore(e.row, want);
      prev = e.row;
    }
    for (const [id, e] of entries) {
      if (seen.has(id)) continue;
      e.row.remove();
      entries.delete(id);
      models.delete(id);
      refused.delete(id);
    }
    scrollPicked();
  }

  function close() {
    const inside = el.contains(doc.activeElement);
    opened = false;
    scrollOwed = false;
    el.hidden = true;
    const back = returnTo;
    returnTo = null;
    if (inside && back?.isConnected) back.focus();
  }

  // The person's own ways out (Esc, ×) also tell the stage; a `close()` from the stage does not call back.
  function dismiss() {
    if (!opened) return;
    close();
    onClose?.();
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape' || !opened) return;
    e.stopPropagation();
    dismiss();
  }

  closeBtn.addEventListener('click', dismiss);
  el.addEventListener('keydown', onKeyDown);

  return {
    el,
    open(agentId) {
      if (destroyed) return;
      const active = doc.activeElement;
      if (!opened && active && active !== doc.body && !el.contains(active)) returnTo = active;
      picked = typeof agentId === 'string' && agentId ? agentId : null;
      scrollOwed = picked != null;
      opened = true;
      el.hidden = false;
      render();
      // A dialog takes the focus, so Esc reaches it: ×, its safe choice, as the HUD's Stop question focuses Keep
      // building (a held Enter on the dot would otherwise reach a Stop that acts at once).
      closeBtn.focus();
    },
    close,
    isOpen: () => opened,
    paint(model) {
      if (destroyed) return;
      last = model ?? null;
      if (opened) keepFocus(render);
    },
    destroy() {
      destroyed = true;
      opened = false;
      el.removeEventListener('keydown', onKeyDown);
      closeBtn.removeEventListener('click', dismiss);
      el.remove();
      entries.clear();
      models.clear();
      pending.clear();
      refused.clear();
      last = null;
      returnTo = null;
    },
  };
}

/**
 * The HUD dot's tip: the agent's dot, name and action, centred above the HUD by the stylesheet. Built hidden.
 * @param {{doc: Document, host?: HTMLElement}} o
 * @returns {{el: HTMLElement, show: (row: {crew?: string, name?: string, action?: string}) => void, hide: () => void,
 *   destroy: () => void}}
 */
export function createDotTip({ doc, host }) {
  const el = make(doc, 'div', 'dz-tip');
  el.hidden = true;
  const dot = make(doc, 'i', 'dz-tip-dot');
  const name = make(doc, 'b');
  const action = make(doc, 'span');
  el.append(dot, name, action);
  host?.appendChild(el);
  return {
    el,
    show(row) {
      const c = tokenVar(row?.crew);
      if (c) dot.style.setProperty('--dot', c);
      else dot.style.removeProperty('--dot');
      name.textContent = str(row?.name);
      action.textContent = str(row?.action);
      el.hidden = false;
    },
    hide() { el.hidden = true; },
    destroy() { el.remove(); },
  };
}
