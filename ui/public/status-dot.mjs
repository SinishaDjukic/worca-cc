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
  if (m.symbol || m.state === 'needs-you' || m.dotLabel) {
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
