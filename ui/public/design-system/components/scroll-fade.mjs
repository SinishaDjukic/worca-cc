// A scrolling column fades at an edge while there is more past it (docs/rail/motion.md › motion.scroll-fade): the chat
// softens as it goes under the composer, and under the top bar once scrolled; at its end, nothing fades. One watcher
// marks every `.convo-scroll` (or `[data-scroll-fade]`); the stylesheet fades.
import { frameBatch } from './keyed-list.mjs';
const SEL = '.convo-scroll, [data-scroll-fade], .menu.is-two-cols,.bar-list, .rail-side-settings, .rl-side-body, .side-menu, .pz-popover .panel-body, #card, body.view-settings .main, body.view-runs .main', EDGE = 4, FAR = 72, PIN = 80;   // every column that scrolls under something: chats, the bars, Settings, Pulse, a task's page
const seen = new WeakSet();

/**
 * Which edges of a scrolling box have more past them.
 * @param {{scrollTop:number, scrollHeight:number, clientHeight:number}} box
 * @returns {{above:boolean, below:boolean}}
 */
export function scrollEdges({ scrollTop, scrollHeight, clientHeight }) {
  return { above: scrollTop > EDGE, below: scrollHeight - scrollTop - clientHeight > EDGE };
}

/**
 * Whether a scrolling box sits at its end: its last `near` px are in view (docs/rail/motion.md › motion.follow-end).
 * @param {{scrollTop:number, scrollHeight:number, clientHeight:number}|null|undefined} box
 * @param {number} [near=PIN]
 * @returns {boolean}
 */
export function pinnedToEnd(box, near = PIN) {
  return !!box && box.scrollHeight - box.scrollTop - box.clientHeight <= near;
}

/**
 * Marks every scrolling column in a document with what lies past its edges, now and as it scrolls or grows. A column is
 * measured only when it scrolls, resizes or its content changes: a draw that changes nothing measures nothing.
 */
export function watchScrollFades(doc) {
  if (seen.has(doc)) return;
  seen.add(doc);
  const win = doc.defaultView;
  const mark = (el) => { const e = scrollEdges(el); el.toggleAttribute('data-more-above', e.above); el.toggleAttribute('data-more-below', e.below); el.toggleAttribute('data-far-below', el.scrollHeight - el.scrollTop - el.clientHeight > FAR); };
  const dirty = new Set(), sized = new WeakSet();
  const flush = frameBatch(win, () => { const cols = [...dirty]; dirty.clear(); for (const el of cols) if (el.isConnected) mark(el); else if (resized) { resized.unobserve(el); sized.delete(el); } });   // a column that left is no longer observed
  const resized = win.ResizeObserver && new win.ResizeObserver((entries) => { for (const x of entries) dirty.add(x.target); flush.request(); });
  const want = (el) => { dirty.add(el); if (resized && !sized.has(el)) { sized.add(el); resized.observe(el); } };
  const all = () => doc.querySelectorAll(SEL).forEach((el) => { want(el); mark(el); dirty.delete(el); });
  doc.addEventListener('scroll', (ev) => { if (ev.target.matches?.(SEL)) mark(ev.target); }, { capture: true, passive: true });
  win.addEventListener('resize', all);
  all();
  // content change: the column a change landed in and every column around it (an outer column grows with an inner one,
  // its box unchanged), and any column that arrived with it; a change outside every column measures nothing
  const changed = (records) => {
    for (const r of records) {
      for (let col = r.target.closest?.(SEL); col; col = col.parentElement?.closest(SEL)) want(col);
      for (const n of r.addedNodes) if (n.nodeType === 1) { if (n.matches(SEL)) want(n); n.querySelectorAll(SEL).forEach(want); }
    }
    if (dirty.size) flush.request();
  };
  if (win.MutationObserver && doc.body) new win.MutationObserver(changed).observe(doc.body, { subtree: true, childList: true });
}
