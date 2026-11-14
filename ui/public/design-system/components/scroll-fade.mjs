// A scrolling column fades at an edge while there is more past it (docs/rail/motion.md › motion.scroll-fade): the chat
// softens as it goes under the composer, and under the top bar once scrolled; at its end, nothing fades. One watcher
// marks every `.convo-scroll` (or `[data-scroll-fade]`); the stylesheet fades.
const SEL = '.convo-scroll, [data-scroll-fade], .menu.is-two-cols,.bar-list, .rail-side-settings, .rl-side-body, .side-menu, .pz-popover .panel-body, #card, body.view-settings .main, body.view-runs .main', EDGE = 4, FAR = 72;   // every column that scrolls under something: chats, the bars, Settings, Pulse, a task's page
const seen = new WeakSet();

/**
 * Which edges of a scrolling box have more past them.
 * @param {{scrollTop:number, scrollHeight:number, clientHeight:number}} box
 * @returns {{above:boolean, below:boolean}}
 */
export function scrollEdges({ scrollTop, scrollHeight, clientHeight }) {
  return { above: scrollTop > EDGE, below: scrollHeight - scrollTop - clientHeight > EDGE };
}

/** Marks every scrolling column in a document with what lies past its edges, now and as it scrolls or grows. */
export function watchScrollFades(doc) {
  if (seen.has(doc)) return;
  seen.add(doc);
  const win = doc.defaultView;
  const mark = (el) => { const e = scrollEdges(el); el.toggleAttribute('data-more-above', e.above); el.toggleAttribute('data-more-below', e.below); el.toggleAttribute('data-far-below', el.scrollHeight - el.scrollTop - el.clientHeight > FAR); };
  const all = () => doc.querySelectorAll(SEL).forEach(mark);
  doc.addEventListener('scroll', (ev) => { if (ev.target.matches?.(SEL)) mark(ev.target); }, { capture: true, passive: true });
  win.addEventListener('resize', all);
  all();
  if (win.MutationObserver && doc.body) new win.MutationObserver(() => win.requestAnimationFrame(all)).observe(doc.body, { subtree: true, childList: true });
}
