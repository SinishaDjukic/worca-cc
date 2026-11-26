// ui/public/status-dot.mjs — the ONE status dot (runs redesign spec §2.1). Every surface that shows a run's state
// draws it from runModel/groupModel's {state, dot, pulse, symbol, word}: Needs you and Failed are a 12px filled
// circle with a stroke "?" / "!" (role img, aria-label = the state word), every other state an 8px dot that is
// aria-hidden because the state word is always next to it (spec §4). QA 6: "?" only while Worca asks; a PR-driven
// Needs you is a plain amber dot that keeps its label.
import { ICONS } from './icons.mjs';

// The glyph's colour is set in style.css (`.status-sym > g`): var() inside an SVG presentation attribute is not
// reliable across engines.
const symbolSvg = (name) => '<svg class="status-sym" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
  + '<circle cx="12" cy="12" r="12" fill="currentColor" stroke="none"></circle>'
  + `<g fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</g></svg>`;
const iconSvg = (name) => '<svg class="status-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ` stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;

/** Paint `el` (idempotent): class, data-state, the symbol or nothing. It owns `el.className`: a caller that needs its
 *  own class wraps the dot rather than adding one to it. */
export function paintStatusDot(el, m) {
  if (!el || !m) return;
  el.className = `status-dot is-${m.dot}${m.pulse ? ' is-pulse' : ''}${m.symbol ? ' has-sym' : ''}${!m.symbol && m.icon ? ' has-ic' : ''}`;
  el.dataset.state = m.state;
  if (m.symbol) {
    if (el.dataset.symbol !== m.symbol) { el.innerHTML = symbolSvg(m.symbol); el.dataset.symbol = m.symbol; }
  } else if (m.icon) {
    // #948 s2: a chat's kind (the idle bubble, a started or followed run, a workflow), a line icon in the dot's place.
    if (el.dataset.symbol !== `ic:${m.icon}`) { el.innerHTML = iconSvg(m.icon); el.dataset.symbol = `ic:${m.icon}`; }
  } else {
    el.replaceChildren();
    delete el.dataset.symbol;
  }
  // QA 6: a PR-driven Needs you is a plain dot, but the list shows no state word beside it, so it keeps its name.
  // A chat's icon says what the chat did ("Started a run"), which no word beside it says: `dotLabel` names it.
  // s4: a run status mark (markDot) can repaint a needs-you run as a ring; the word beside it names that state.
  if (m.symbol || (m.state === 'needs-you' && m.dot === 'amber') || m.dotLabel) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', m.dotLabel || m.word);
    el.removeAttribute('aria-hidden');
  } else {
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.setAttribute('aria-hidden', 'true');
  }
  if (m.dotLabel) el.title = m.dotLabel;
  else el.removeAttribute('title');
}

/** A new dot for a model. */
export function renderStatusDot(doc, m) {
  const el = doc.createElement('span');
  paintStatusDot(el, m);
  return el;
}

/** Shaper small runs s4 (D2): the one map from a run status mark (src/shared/shape/run-status.mjs RUN_MARKS) to a dot.
 *  `ring` is the run with the turn (`next`); markDot gives a ring with no word the grey ring (owner direction). */
export const RUN_MARK_DOTS = Object.freeze({
  done: Object.freeze({ dot: 'green', pulse: false, symbol: null }),
  live: Object.freeze({ dot: 'peach', pulse: true, symbol: null }),
  ask: Object.freeze({ dot: 'amber', pulse: false, symbol: 'question' }),
  after: Object.freeze({ dot: 'dashed-ring', pulse: false, symbol: null }),
  ring: Object.freeze({ dot: 'ink-ring', pulse: false, symbol: null }),
  faint: Object.freeze({ dot: 'grey-ring', pulse: false, symbol: null }),
  failed: Object.freeze({ dot: 'red', pulse: false, symbol: 'alert' }),
});
const MARK_WORD = Object.freeze({ ask: 'Needs you', failed: 'Failed' });

const STILL_STATES = new Set(['paused', 'failed', 'stopped']);
/** A `live` mark with no word over a paused, failed or stopped run model is stale (the group feed lags the run between
 *  reloads): it must not paint a pulse. True when `st`'s mark should be ignored for model `m`. Pure. */
export function staleLive(st, m) {
  return !!st && st.mark === 'live' && st.word == null && !!m && STILL_STATES.has(m.state);
}

/** D2: a run model's dot repainted from a run status mark. A merged run (violet) and a PR-problem run (plain amber)
 *  keep their dev dot on `done`, so the PR fact is not lost. A null or unknown mark returns `m` itself. `word` only
 *  labels a symbol dot; the row text never comes from here. Pure. */
export function markDot(m, mark, word) {
  const d = mark && Object.hasOwn(RUN_MARK_DOTS, mark) ? RUN_MARK_DOTS[mark] : null;
  if (!m || !d) return m;
  if (mark === 'done' && (m.state === 'merged' || (m.state === 'needs-you' && !m.symbol))) return m;
  const dot = mark === 'ring' && !word ? 'grey-ring' : d.dot;
  return { ...m, dot, pulse: d.pulse, symbol: d.symbol, icon: null, word: word || MARK_WORD[mark] || m.word };
}
