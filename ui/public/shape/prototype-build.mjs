// ui/public/shape/prototype-build.mjs — Shaper small runs C1 (D17): the Prototype step's building view and its settled
// preview well. The Design stage's own reducer folds the build's frames (reduceFrame), its Plan list gives the screen
// rows (selectPlanRows), and its reveal paces each screen's text (createReveal). A screen shows as plain labelled
// pieces read from its text (piecesOf): agent HTML never reaches the card.
import { initialStage, reduceFrame, selectPlanRows, statusWord } from '../design/stage-model.mjs';
import { createReveal } from '../design/reveal.mjs';
import { buildCheckRows } from './check-row.mjs';
import { piecesOf } from '../../../src/shared/shape/prototype.mjs';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const lower = (w) => String(w || '').toLowerCase();

// A bus for the design-* frames app.js hears, so a card can follow its build without the Design page open.
const LISTENERS = new Set();
/** app.js hands every `design-*` frame here (next to the Design page's own). */
export function pushPrototypeFrame(frame) { for (const fn of [...LISTENERS]) { try { fn(frame); } catch { /* one card never breaks another */ } } }
/** Listen to design frames; returns the unsubscribe. */
export function onPrototypeFrame(fn) { LISTENERS.add(fn); return () => LISTENERS.delete(fn); }

const ROW_WORD = Object.freeze({ done: 'done', failed: 'failed', stopped: 'stopped', planned: 'waiting', waiting: 'waiting' });

/** D17: one Lead row, then `selectPlanRows`' rows, each with its status word. The Lead is planning until the plan
 *  lands, integrating while the build integrates, and reviewing during a Thorough review round; the integrate, rework
 *  and change-round agents fold into it or into their section. */
export function screenRows(state, { reviewing = false } = {}) {
  const plan = selectPlanRows(state);
  const agents = state.agents || {};
  const agentWord = (ids) => { const a = ids.map((id) => agents[id]).find(Boolean); return a ? lower(statusWord(a.status)) : ''; };
  const leadWord = reviewing ? 'reviewing'
    : state.status === 'integrating' ? 'integrating'
      : !plan.rows.length ? 'planning'
        : state.status === 'done' ? 'done' : 'building';
  return [
    { key: 'lead', name: 'Lead', word: leadWord },
    ...plan.rows.map((r) => ({ key: r.key, name: r.name, word: r.state === 'active' ? (agentWord(r.who.map((w) => w.agentId)) || 'writing') : ROW_WORD[r.state] || r.state })),
  ];
}

/** D5: a row's mark from its word: done the check, failed the x, waiting and stopped the hollow mark, every other word
 *  (the Lead's planning, building, integrating, reviewing; an active screen's writing, thinking, …) the live dot. */
export function buildMark(word) {
  if (word === 'done') return 'check';
  if (word === 'failed') return 'x';
  if (word === 'waiting' || word === 'stopped') return 'wait';
  return 'live';
}

/** The preview well: one column per screen, its name and ids in the head, its pieces below (each with `--i`). */
function paintWell(doc, well, screens, piecesBy, { register } = {}) {
  well.setAttribute('aria-label', `Prototype preview: ${plural(screens.length, 'screen')}`);
  well.replaceChildren(...screens.map((s) => {
    const col = doc.createElement('div'); col.className = 'proto-col'; col.dataset.section = s.section;
    const head = doc.createElement('div'); head.className = 'proto-col-head';
    const name = doc.createElement('span'); name.className = 'proto-col-name'; name.textContent = s.name;
    head.append(name);
    if (register !== 'plain' && Array.isArray(s.ids) && s.ids.length) {
      const ids = doc.createElement('span'); ids.className = 'proto-col-ids'; ids.textContent = s.ids.join(', ');
      head.append(ids);
    }
    col.append(head);
    (piecesBy(s.section) || []).forEach((p, i) => {
      const piece = doc.createElement('div'); piece.className = `proto-piece proto-piece-${p.tag}`;
      piece.style.setProperty('--i', String(i));
      piece.textContent = p.text;
      col.append(piece);
    });
    return col;
  }));
}

/**
 * Mounts the view in `host`. Live: subscribes with `{type:'subscribe', designBuildId}` through `subscribe(msg, onFrame)`
 * (returns the unsubscribe), folds the frames, draws the rows (`aria-busy`) and paces each screen's text. Settled (the
 * built state): only the well, every screen's `pieces` (or `texts[section]`) shown at once.
 * @param {Document} doc
 * @param {HTMLElement} host
 * @param {{buildId?: string, designId?: string, screens?: Array<{section, name, ids, pieces?}>, subscribe?: Function,
 *   reduced?: () => boolean, settled?: boolean, reviewing?: boolean, register?: string,
 *   clock?: {set: Function, clear: Function, now: number}}} o
 * @returns {{destroy: () => void, rows: () => object[]}}
 */
export function mountPrototypeBuild(doc, host, { buildId = null, designId = null, screens = [], subscribe = null, reduced = () => false,
  settled = false, reviewing = false, register, clock = null } = {}) {
  const well = doc.createElement('div'); well.className = 'proto-well'; well.setAttribute('role', 'group');
  if (settled) {
    const by = new Map(screens.map((s) => [s.section, Array.isArray(s.pieces) ? s.pieces : []]));
    paintWell(doc, well, screens, (id) => by.get(id), { register });
    host.append(well);
    return { destroy: () => well.remove(), rows: () => [] };
  }
  const rowsBox = doc.createElement('div'); rowsBox.className = 'plan-checks proto-rows'; rowsBox.setAttribute('aria-busy', 'true');
  host.append(rowsBox);   // the well follows the rows once the first screen is planned: no empty preview while the Lead plans
  let state = { ...initialStage({ designId, kind: 'web', reduced: reduced() }), buildId };
  const shown = new Map();   // sectionId -> the text the reveal last gave it
  const timers = clock || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t), get now() { return Date.now(); } };
  let last = [];
  const paint = () => {
    last = screenRows(state, { reviewing });
    rowsBox.replaceChildren(...buildCheckRows(doc, { items: last.map((r) => ({
      pass: r.word === 'done', mark: buildMark(r.word), id: '', idCol: false,
      label: r.name, note: r.word, ariaLabel: r.word,
    })) }));
    const names = new Map(selectPlanRows(state).rows.map((r) => [r.key, r.name]));
    const cols = (state.sectionOrder || []).filter((id) => names.has(id))
      .map((id) => ({ section: id, name: names.get(id), ids: (screens.find((s) => s.section === id) || {}).ids || [] }));
    paintWell(doc, well, cols, (id) => piecesOf(shown.get(id) || ''), { register });
    if (cols.length && !well.parentNode) rowsBox.after(well);
  };
  const reveal = createReveal({ setTimer: timers.set, clearTimer: timers.clear, now: () => timers.now, reduced,
    onPrefix: ({ sectionId, text }) => { shown.set(sectionId, text); paint(); } });
  const onFrame = (f) => {
    if (!f || f.designId !== designId) return;
    const out = reduceFrame(state, f, timers.now);
    state = out.state;
    for (const e of out.effects) {
      if (e.type === 'feed' && typeof e.text === 'string') {
        if (reduced()) reveal.flush({ key: e.key, sectionId: e.sectionId, text: e.text, final: e.final });
        else reveal.push({ key: e.key, sectionId: e.sectionId, text: e.text, final: e.final });
      }
    }
    paint();
  };
  paint();
  const off = typeof subscribe === 'function' ? subscribe({ type: 'subscribe', designBuildId: buildId }, onFrame) : null;
  return {
    destroy() { reveal.destroy(); if (typeof off === 'function') off(); rowsBox.remove(); well.remove(); },
    rows: () => last,
    frame: onFrame,
  };
}
