// The Design stage's HUD (SPEC section 3, L4.6, L4.15, L4.17): the dark bar under the stage. It paints the plain object
// `selectHud` returns: dots (one per cursor), the text, the line, the cost and the actions of each phase (`plan`,
// `build`, `end`, `halt`; `none` hides it). Stop asks in place ("Stop 13 agents?" with Keep building and Stop), Resume
// and Stop show their pending word and their refusal, and × hides the bar until the phase leaves `end`/`halt` or the
// `buildId` changes (a Continue keeps the id). It has no import-time side effects and starts no timer.
//
// The bar is `role="group"`; one `.sr-only` polite line speaks the state word when it changes, never the numbers,
// which change at 2 Hz (L4.17). Its parts (zones) are rebuilt only when the phase, the question or `followOff`
// changes; every other paint updates them in place, so a paint never swaps a button under the pointer.

import { icon } from '../icons.mjs';

const PHASES = new Set(['none', 'plan', 'build', 'end', 'halt']);
const LIVE = new Set(['plan', 'build']);
const CLOSABLE = new Set(['end', 'halt']);
const PCT_RE = /^(?:100|\d{1,2})(?:\.\d+)?%$/;
// A dot's colour is a crew token name (`CREW_TOKENS`), never a colour value from a frame.
const TOKEN_RE = /^--[a-z][a-z0-9-]*$/;

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const phaseOf = (hud) => (hud && PHASES.has(hud.phase) ? hud.phase : 'none');
const pctOf = (v) => (typeof v === 'string' && PCT_RE.test(v) ? v : '0%');
const messageOf = (err) => str(err && typeof err === 'object' ? err.message : err);

/**
 * The HUD, appended to `host`. `onStop` and `onResume` return promises: a rejection shows `Could not stop` or
 * `Could not resume` with its message as the text's `title`, kept through later paints until the person acts or the
 * phase changes; a resolved Stop closes the question, a resolved Resume puts its button back, enabled. Without
 * `onExport` the Export button is disabled and says why (L4.15).
 * @param {{doc: Document, host?: Element, onStop?: () => Promise<unknown>, onResume?: () => Promise<unknown>,
 *   onExport?: () => void, onFollow?: () => void, onHide?: () => void, onDot?: (agentId: string) => void,
 *   onDotHover?: (agentId: string|null) => void}} opts
 * @returns {{el: HTMLElement, paint: (hud: object, o?: {hidden?: boolean}) => void, closeConfirm: () => void,
 *   confirmOpen: () => boolean, destroy: () => void}}
 */
export function createHud({ doc, host, onStop, onResume, onExport, onFollow, onHide, onDot, onDotHover } = {}) {
  const el = doc.createElement('div');
  el.className = 'dz-hud is-none';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Build status');
  const sr = doc.createElement('span');
  sr.className = 'sr-only';
  sr.setAttribute('aria-live', 'polite');
  el.append(sr);
  host?.append(el);

  let hud = null;
  let hidden = false;
  let confirm = false;
  let pending = null; // 'stop' | 'resume' while its promise is out
  let error = null; // {kind: 'stop'|'resume', message}
  let closed = null; // {buildId} after ×
  let act = 0; // bumped when a pending action's result no longer has a place to land
  let hoverId = null;
  let destroyed = false;
  let zone = { key: '', nodes: [], dots: null, dotEls: new Map() };

  const button = (cls, label, fn) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    if (label) b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  const iconButton = (name, label, fn) => {
    const b = button('btn btn-sm btn-quiet btn-icon', '', fn);
    b.setAttribute('aria-label', label);
    b.title = label;
    b.append(icon(doc, name));
    return b;
  };
  const span = (cls) => {
    const s = doc.createElement('span');
    s.className = cls;
    return s;
  };

  const unhover = () => {
    if (hoverId === null) return;
    hoverId = null;
    onDotHover?.(null);
  };

  // The question closes; a Stop still out lands nowhere and a refusal shown in it goes with it.
  const closeQuestion = () => {
    if (!confirm) return false;
    confirm = false;
    if (pending === 'stop') { pending = null; act++; }
    if (error?.kind === 'stop') error = null;
    return true;
  };

  // The button that keeps the keyboard's place when a zone is rebuilt under it.
  const mainButton = () => zone.keep || zone.stop || zone.resume || (zone.exp && !zone.exp.disabled ? zone.exp : zone.close) || null;

  function openQuestion() {
    if (destroyed || !LIVE.has(phaseOf(hud)) || confirm) return;
    confirm = true;
    error = null;
    render();
    zone.keep?.focus();
  }

  function keepBuilding() {
    if (pending === 'stop' || !closeQuestion()) return;
    render();
    mainButton()?.focus();
  }

  async function doStop() {
    if (pending) return;
    const mine = ++act;
    pending = 'stop';
    error = null;
    render();
    try {
      await onStop?.();
    } catch (err) {
      if (destroyed || mine !== act) return;
      pending = null;
      error = { kind: 'stop', message: messageOf(err) };
      render();
      return;
    }
    if (destroyed || mine !== act) return;
    pending = null;
    closeQuestion();
    render();
  }

  async function doResume() {
    if (pending) return;
    const mine = ++act;
    pending = 'resume';
    error = null;
    render();
    try {
      await onResume?.();
    } catch (err) {
      if (destroyed || mine !== act) return;
      pending = null;
      error = { kind: 'resume', message: messageOf(err) };
      render();
      return;
    }
    if (destroyed || mine !== act) return;
    pending = null;
    render();
  }

  function closeBar() {
    if (pending) act++;
    pending = null;
    error = null;
    closed = { buildId: hud?.buildId };
    render();
  }

  function zoneKey(phase) {
    if (phase === 'none') return 'none';
    if (confirm) return 'confirm';
    if (phase === 'build' && hud.followOff === true) return 'build-follow';
    if (phase === 'halt' && hud.canResume === true) return 'halt-resume';
    return phase;
  }

  function buildZone(key) {
    const hadFocus = el.contains(doc.activeElement) && doc.activeElement !== el;
    unhover();
    for (const n of zone.nodes) n.remove();
    const z = { key, nodes: [], dots: null, dotEls: new Map() };
    if (key !== 'none') {
      const live = key === 'plan' || key === 'build' || key === 'build-follow';
      if (live) { z.dots = doc.createElement('div'); z.dots.className = 'dz-dots'; z.nodes.push(z.dots); }
      z.text = span('dz-hud-text');
      z.nodes.push(z.text);
      if (live || key === 'end') {
        const line = span('dz-line');
        z.bar = doc.createElement('i');
        line.append(z.bar);
        z.nodes.push(line);
      }
      if (live) { z.cost = span('dz-hud-cost'); z.nodes.push(z.cost); }
      const acts = doc.createElement('div');
      acts.className = 'dz-hud-acts';
      if (key === 'confirm') {
        z.keep = button('btn btn-sm btn-quiet', 'Keep building', keepBuilding);
        z.confirmStop = button('btn btn-sm btn-danger', 'Stop', () => { doStop(); });
        acts.append(z.keep, z.confirmStop);
      } else if (live) {
        if (key === 'build-follow') acts.append(button('btn btn-sm btn-quiet', 'Follow', () => onFollow?.()));
        z.stop = button('btn btn-sm', 'Stop', openQuestion);
        z.hide = iconButton(hidden ? 'cursor-off' : 'cursor', hidden ? 'Show cursors' : 'Hide cursors', () => onHide?.());
        acts.append(z.stop, z.hide);
      } else if (key === 'end') {
        z.exp = button('btn btn-sm btn-primary', 'Export', () => onExport?.());
        if (typeof onExport !== 'function') { z.exp.disabled = true; z.exp.title = 'Exports are not available yet'; }
        z.close = iconButton('x', 'Close', closeBar);
        acts.append(z.exp, z.close);
      } else {
        if (key === 'halt-resume') { z.resume = button('btn btn-sm btn-primary', 'Resume', () => { doResume(); }); acts.append(z.resume); }
        z.close = iconButton('x', 'Close', closeBar);
        acts.append(z.close);
      }
      z.nodes.push(acts);
    }
    el.append(...z.nodes);
    zone = z;
    if (hadFocus) mainButton()?.focus();
  }

  function syncDots(list) {
    const seen = new Set();
    const want = [];
    for (const d of Array.isArray(list) ? list : []) {
      const id = str(d?.agentId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      want.push([id, d]);
    }
    // Gone dots go first: one left in place would move every later dot, and a moved dot loses its focus.
    for (const [id, b] of zone.dotEls) {
      if (seen.has(id)) continue;
      b.remove();
      zone.dotEls.delete(id);
      if (hoverId === id) unhover();
    }
    let prev = null;
    for (const [id, d] of want) {
      let b = zone.dotEls.get(id);
      if (!b) {
        b = doc.createElement('button');
        b.type = 'button';
        b.addEventListener('click', () => onDot?.(id));
        b.addEventListener('mouseenter', () => { hoverId = id; onDotHover?.(id); });
        b.addEventListener('mouseleave', () => { hoverId = null; onDotHover?.(null); });
        zone.dotEls.set(id, b);
      }
      const label = str(d.label);
      if (b.getAttribute('aria-label') !== label) { b.setAttribute('aria-label', label); b.title = label; }
      b.classList.toggle('is-wait', d.waiting === true);
      const crew = typeof d.crew === 'string' && TOKEN_RE.test(d.crew) ? `var(${d.crew})` : '';
      if (b.style.getPropertyValue('--dot') !== crew) {
        if (crew) b.style.setProperty('--dot', crew);
        else b.style.removeProperty('--dot');
      }
      const at = prev ? prev.nextSibling : zone.dots.firstChild;
      if (at !== b) zone.dots.insertBefore(b, at);
      prev = b;
    }
  }

  function paintHide() {
    const label = hidden ? 'Show cursors' : 'Hide cursors';
    if (zone.hide.getAttribute('aria-label') !== label) {
      zone.hide.setAttribute('aria-label', label);
      zone.hide.title = label;
      zone.hide.replaceChildren(icon(doc, hidden ? 'cursor-off' : 'cursor'));
    }
    zone.hide.classList.toggle('is-off', hidden);
  }

  function render() {
    if (destroyed || !hud) return;
    const phase = phaseOf(hud);
    el.classList.toggle('is-none', phase === 'none' || closed !== null);
    el.classList.toggle('is-confirm', confirm);
    const key = zoneKey(phase);
    if (key !== zone.key) buildZone(key);
    if (key === 'none') return;
    if (zone.dots) syncDots(hud.dots);
    const failed = error && ((error.kind === 'stop' && confirm) || (error.kind === 'resume' && !confirm && phase === 'halt'));
    zone.text.textContent = failed
      ? (error.kind === 'stop' ? 'Could not stop' : 'Could not resume')
      : str(confirm ? hud.stopWord : hud.text);
    if (failed && error.message) zone.text.title = error.message;
    else zone.text.removeAttribute('title');
    if (zone.bar) zone.bar.style.width = phase === 'end' ? '100%' : pctOf(hud.pct);
    if (zone.cost) { zone.cost.textContent = str(hud.cost); zone.cost.hidden = !zone.cost.textContent; }
    if (zone.hide) paintHide();
    if (zone.confirmStop) {
      const busy = pending === 'stop';
      zone.confirmStop.textContent = busy ? 'Stopping…' : 'Stop';
      zone.confirmStop.disabled = busy;
      zone.keep.disabled = busy;
    }
    if (zone.resume) {
      const busy = pending === 'resume';
      zone.resume.textContent = busy ? 'Resuming…' : 'Resume';
      zone.resume.disabled = busy;
    }
  }

  const onKey = (e) => {
    if (e.key !== 'Escape' || !confirm || pending === 'stop') return;
    e.preventDefault();
    e.stopPropagation();
    keepBuilding();
  };
  el.addEventListener('keydown', onKey);

  return {
    el,
    paint(next, { hidden: hide = false } = {}) {
      if (destroyed) return;
      const before = phaseOf(hud);
      hud = next && typeof next === 'object' ? next : {};
      hidden = hide === true;
      const phase = phaseOf(hud);
      if (phase !== before) {
        if (!LIVE.has(phase)) closeQuestion();
        if (before === 'halt' && pending === 'resume') { pending = null; act++; }
        error = null;
      }
      if (closed && (!CLOSABLE.has(phase) || hud.buildId !== closed.buildId)) closed = null;
      const word = str(hud.word);
      if (sr.textContent !== word) sr.textContent = word;
      render();
    },
    closeConfirm() {
      if (closeQuestion()) render();
    },
    confirmOpen: () => confirm,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      act++;
      el.removeEventListener('keydown', onKey);
      el.remove();
      hoverId = null;
    },
  };
}
