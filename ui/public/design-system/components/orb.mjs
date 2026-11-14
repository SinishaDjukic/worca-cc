// Worca's orb, the sphere of dots that moves only while Worca works (ui/public/dot-orb.mjs, the app's own drawing): the
// library draws its place, and one watcher brings every orb on a page to life. A page never makes a canvas of its own.
import { attrs } from './html.mjs';
import { createDotOrbs, ORB_PHASES } from '../../dot-orb.mjs';

/**
 * OrbMark: Worca's orb with its W facing you, in its phase: rest (still), think (two points wander), tool (a patch sweeps), write (it spins under
 * a rolling wave). The watcher (watchOrbs) draws and moves it.
 * @param {object} [o]
 * @param {'rest'|'think'|'tool'|'write'} [o.phase]
 * @param {number} [o.size]
 * @param {boolean} [o.w]   Worca's W facing you, lit while the sphere turns under it (on in Rail)
 */
export function orbMark({ phase = 'think', size = 18, w = true } = {}) {
  const p = ORB_PHASES[phase] ? phase : 'rest';
  return `<canvas class="dot-orb"${attrs({ 'data-orb': p, 'data-pattern': w ? 'w' : null, 'data-s': String(size), width: String(size), height: String(size), style: `width:${size}px;height:${size}px`, 'aria-hidden': 'true' })}></canvas>`;
}

/**
 * Brings every OrbMark on the page to life, and any added later; a changed data-orb changes its phase. One shared loop.
 * @param {Document} doc
 */
export function watchOrbs(doc) {
  const win = doc.defaultView, orbs = createDotOrbs({ doc, win });
  const scan = () => { for (const el of doc.querySelectorAll('canvas[data-orb]')) if (orbs.phase(el) !== el.dataset.orb || el.dataset.phase !== el.dataset.orb) orbs.set(el, el.dataset.orb); };
  scan();
  if (win.MutationObserver && doc.body) new win.MutationObserver(scan).observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-orb'] });
  return orbs;
}
