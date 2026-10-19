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

/** Paint `el` (idempotent): class, data-state, the symbol or nothing. It owns `el.className`: a caller that needs its
 *  own class wraps the dot rather than adding one to it. */
export function paintStatusDot(el, m) {
  if (!el || !m) return;
  el.className = `status-dot is-${m.dot}${m.pulse ? ' is-pulse' : ''}${m.symbol ? ' has-sym' : ''}`;
  el.dataset.state = m.state;
  if (m.symbol) {
    if (el.dataset.symbol !== m.symbol) { el.innerHTML = symbolSvg(m.symbol); el.dataset.symbol = m.symbol; }
  } else {
    el.replaceChildren();
    delete el.dataset.symbol;
  }
  // QA 6: a PR-driven Needs you is a plain dot, but the list shows no state word beside it, so it keeps its name.
  if (m.symbol || m.state === 'needs-you') {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', m.word);
    el.removeAttribute('aria-hidden');
  } else {
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
    el.setAttribute('aria-hidden', 'true');
  }
}

/** A new dot for a model. */
export function renderStatusDot(doc, m) {
  const el = doc.createElement('span');
  paintStatusDot(el, m);
  return el;
}
