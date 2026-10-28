// ui/public/graph/session-layer.mjs
// The One session tray layer (05 §4.1): `div.gv-sessions` at z 0 inside `.gv-world`, before `svg.gv-wires`, holding
// one `div.gv-sess` per session behind its cards, each with its header strip. Trays are placed with inline px from
// sessionRects (the model, never a measure), and a style write happens only when a rect changed (the wire dCache
// pattern). The view decides WHEN to paint; this file owns the DOM. The member chip `span.nsess` sits in a member's
// label row, after its title.
import { icon } from '../icons.mjs';

const STATUSES = ['pending', 'waiting', 'active', 'paused', 'done', 'error', 'stopped', 'interrupted', 'skipped'];   // run-decor's (Task 56)
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The header's words (05 §4.4) for a lanes host. `fallback`: the steps run as separate sessions (the Labs flag is
 *  off, or the engine has no verified sub-agents, C14). */
export function sessionWords(spec, { engineText, fallback, labels }) {
  const s = spec.settings || {};
  const label = s.label || 'One session';
  const n = spec.members.length;
  const shared = s.mode === 'shared';
  const text = fallback ? `${label} · ${engineText}: separate sessions`
    : shared ? `${label} · ${engineText} · shared conversation · ${count(n, 'step', 'steps')}`
      : `${label} · ${engineText} · ${count(n, 'sub-agent', 'sub-agents')}`;
  const tail = fallback ? `${count(n, 'step', 'steps')}, separate sessions`
    : shared ? `${count(n, 'step', 'steps')}, one conversation` : count(n, 'sub-agent', 'sub-agents');
  return { text, aria: `${label}: ${labels.join(', ')}. ${tail}.` };
}

export function createSessionLayer(doc, { mode = 'edit' } = {}) {
  const el = doc.createElement('div');
  el.className = 'gv-sessions';
  const edit = mode === 'edit';
  const trays = new Map();          // key -> { el, head, st, sr, pos, words, text, aria, fallback } (key = sid; a flow row segment: `sid:row`)
  let rectMap = new Map();          // key -> the painted rect (the composer hit-tests these)
  const chipped = new Set();        // node ids that carry a chip now
  const decor = new Map();          // sid -> a run decor's fallback (setChrome): it wins over the paint, both ways (C14)
  let lastChips = null;             // the last chips() call, replayed when a decor's fallback changes

  function build(sid) {
    const t = doc.createElement('div');
    t.className = 'gv-sess';
    t.dataset.sessionId = sid;
    const head = doc.createElement('div');
    head.className = 'gv-sess-head';
    head.dataset.sessionId = sid;
    head.setAttribute('role', edit ? 'button' : 'group');
    if (edit) head.setAttribute('tabindex', '0');
    if (!edit) {
      const dot = doc.createElement('i');
      dot.className = 'sdot';
      dot.setAttribute('aria-hidden', 'true');
      head.appendChild(dot);
    }
    head.appendChild(icon(doc, 'terminal', 12, 'sglyph'));
    const st = doc.createElement('span');
    st.className = 'st';
    const sr = doc.createElement('span');
    sr.className = 'sr';
    head.append(st, sr);
    t.appendChild(head);
    el.appendChild(t);
    return { el: t, head, st, sr, pos: '', words: '', text: '', aria: '', fallback: false };
  }

  /** `items`: [{ sid, key?, rect, text, aria, fallback, lone, open? }]. A tray whose key is not listed is removed. */
  function paint(items) {
    const seen = new Set();
    rectMap = new Map();
    for (const it of items) {
      const k = it.key || it.sid;
      seen.add(k);
      let t = trays.get(k);
      if (!t) { t = build(it.sid); trays.set(k, t); }
      const r = it.rect;
      rectMap.set(k, r);
      const pos = `${r.x}|${r.y}|${r.w}|${r.h}|${r.head ? `${r.head.y - r.y}|${r.head.h}` : '-'}`;
      if (t.pos !== pos) {
        t.pos = pos;
        t.el.style.left = `${r.x}px`;
        t.el.style.top = `${r.y}px`;
        t.el.style.width = `${r.w}px`;
        t.el.style.height = `${r.h}px`;
        t.head.hidden = !r.head;
        if (r.head) { t.head.style.top = `${r.head.y - r.y}px`; t.head.style.height = `${r.head.h}px`; }
      }
      const words = `${it.text}\u0001${it.aria}\u0001${it.fallback}\u0001${it.lone}\u0001${it.open || ''}`;
      if (t.words !== words) {
        t.words = words;
        t.text = it.text;
        t.aria = it.aria;
        t.st.textContent = it.text;
        t.head.setAttribute('aria-label', it.aria);
        if (!edit) t.head.title = it.text;                // small hosts show the dot only (style.css): the words stay in title
        t.fallback = Boolean(it.fallback);             // the paint's own answer; a decor's wins over it
        t.el.classList.toggle('fallback', decor.has(it.sid) ? decor.get(it.sid) : t.fallback);
        t.el.classList.toggle('lone', Boolean(it.lone));
        for (const side of ['left', 'right']) t.el.classList.toggle(`open-${side}`, it.open === side || it.open === 'both');
      }
    }
    for (const [k, t] of [...trays]) if (!seen.has(k)) { t.el.remove(); trays.delete(k); }
    for (const sid of [...decor.keys()]) if (![...trays.values()].some((t) => t.el.dataset.sessionId === sid)) decor.delete(sid);
  }

  /** Run hosts (Tasks 56-57): class and text toggles only, never a rebuild, on EVERY tray of `sid` (a flow host has one
   *  per row). A key left out keeps its value (the status too; `status: null` clears it); `right: null` clears the
   *  right side (applyDecor below expert); `text`, `title` and `aria: null` put back what the last paint wrote.
   *  `fallback` is the run's own answer (Task 57: "its fallback wins") and holds until the session goes: `true` takes
   *  the members' "sub-agent" chips away, `false` makes the tray solid and brings them back. A decor that sets it sets
   *  `text` too. */
  function setChrome(sid, chrome) {
    const c = chrome && typeof chrome === 'object' ? chrome : {};
    const { fallback = null, warn = null, bad = null } = c;
    for (const t of trays.values()) {
      if (t.el.dataset.sessionId !== sid) continue;
      if (c.status !== undefined) for (const s of STATUSES) t.el.classList.toggle(`is-${s}`, s === c.status);
      if (c.text !== undefined) { const v = c.text == null ? t.text : String(c.text); if (t.st.textContent !== v) t.st.textContent = v; }
      if (c.right !== undefined) { const v = c.right == null ? '' : String(c.right); if (t.sr.textContent !== v) t.sr.textContent = v; }
      if (c.title !== undefined) t.head.title = c.title == null ? (edit ? '' : t.text) : String(c.title);
      if (c.aria !== undefined) t.head.setAttribute('aria-label', c.aria == null ? t.aria : String(c.aria));
      if (fallback != null) t.el.classList.toggle('fallback', Boolean(fallback));
      if (warn != null) t.el.classList.toggle('warn', Boolean(warn));
      if (bad != null) t.el.classList.toggle('bad', Boolean(bad));
    }
    if (fallback != null && decor.get(sid) !== Boolean(fallback)) {
      decor.set(sid, Boolean(fallback));
      if (lastChips) chips(lastChips[0], lastChips[1]);
    }
  }

  /** Validation on the header (05 §2.3): red pip + `.bad` for a session's first error, amber + `.warn` otherwise. */
  function setIssues(errBy, warnBy) {
    for (const [, t] of trays) {
      const sid = t.el.dataset.sessionId;
      const err = errBy.get(sid) || null;
      const warn = err ? null : warnBy.get(sid) || null;
      t.el.classList.toggle('bad', Boolean(err));
      t.el.classList.toggle('warn', Boolean(warn));
      for (const [cls, msg] of [['npip', err], ['nwarn', warn]]) {
        let pip = t.head.querySelector(`:scope > .${cls}`);
        if (!msg) { if (pip) pip.remove(); continue; }
        if (!pip) { pip = doc.createElement('div'); pip.className = cls; pip.dataset.sessionId = sid; t.head.prepend(pip); }
        pip.title = msg;
      }
    }
  }

  function select(sid) {
    for (const t of trays.values()) t.el.classList.toggle('sel', t.el.dataset.sessionId === sid);
  }

  /** The member chip, after the title in each member's label row: `chips` = [{ sid, members, chip: 'sub-agent'|'shared'|
   *  null, fallback, label }]. A card that is no longer a member, or whose session falls back (the paint's `fallback`,
   *  unless a run decor said otherwise), loses its chip. */
  function chips(nodeEls, list) {
    lastChips = [nodeEls, list];
    for (const id of [...chipped]) if (!nodeEls.has(id)) chipped.delete(id);   // a deleted card
    const want = new Map();
    for (const c of list) {
      if (!c.chip || (decor.has(c.sid) ? decor.get(c.sid) : c.fallback)) continue;
      c.members.forEach((id, i) => want.set(id, { text: c.chip, title: c.chip === 'shared'
        ? `Runs as step ${i + 1} of ${c.members.length} of one conversation in ${c.label}`
        : `Runs as sub-agent ${i + 1} of ${c.members.length} in ${c.label}` }));
    }
    if (!want.size && !chipped.size) return;
    for (const [id, nodeEl] of nodeEls) {
      const lab = nodeEl.querySelector(':scope > .nlabel');
      if (!lab) continue;
      let chip = lab.querySelector(':scope > .nsess');
      const w = want.get(id);
      if (!w) { if (chip) chip.remove(); chipped.delete(id); continue; }
      if (!chip) {
        chip = doc.createElement('span');
        chip.className = 'nsess';
        chip.setAttribute('aria-hidden', 'true');
        const t = doc.createElement('span');
        t.className = 't';
        chip.append(icon(doc, 'agent', 10, 'sglyph'), t);
        const tt = lab.querySelector(':scope > .tt');
        if (tt) tt.after(chip); else lab.appendChild(chip);
      }
      const t = chip.querySelector(':scope > .t');
      if (t.textContent !== w.text) t.textContent = w.text;
      chip.title = w.title;
      chipped.add(id);
    }
  }

  return { el, paint, setChrome, setIssues, select, chips, rects: () => rectMap };
}
