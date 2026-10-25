// ui/public/nav/crumbs.mjs — the breadcrumb (docs/design-system.md Navigation): the trail up from a page, painted into
// the top bar's nav#topnav-crumbs. It ends at the parent; the page itself is the h1. At 760px and below CSS shows only
// the up link ("‹ Parent"). Grown out of run-page-head.mjs runCrumbs/paintCrumbs, which this change deletes.
import { icon } from '../icons.mjs';
import { pageTitle } from '../topnav.mjs';
import { parentOf, formatRoute } from './routes.mjs';

const MAX_DEPTH = 8;
// A section root reads its top bar title (one source for the section name); any other parent carries its own title.
const labelOf = (r) => r.title || pageTitle(r.view);

/** [{ label, href, view }] from the section root down to the parent of `route`; [] for a root or an unknown view. */
export function trailFor(route, ctx = {}) {
  const out = [];
  for (let p = parentOf(route, ctx); p && out.length < MAX_DEPTH; p = parentOf(p, ctx)) {
    out.unshift({ label: labelOf(p), href: formatRoute(p), view: p.view });
  }
  return out;
}

const crumbLink = (doc, c, cls = '') => {
  const a = doc.createElement('a');
  if (cls) a.className = cls;
  a.href = c.href;
  a.title = c.label;
  a.dataset.crumb = c.view;
  return a;
};

/** Paint `trail` into `nav`: the full trail (wide) and the up link (narrow). Hidden when empty; idempotent. */
export function paintTrail(nav, trail) {
  if (!nav) return;
  const sig = JSON.stringify(trail);
  nav.hidden = trail.length === 0;
  if (nav.dataset.sig === sig) return;
  nav.dataset.sig = sig;
  const doc = nav.ownerDocument;
  const list = doc.createElement('ol');
  list.className = 'nav-trail';
  trail.forEach((c, i) => {
    const li = doc.createElement('li');
    li.className = 'nav-crumb';
    if (i) {
      const s = doc.createElement('span');
      s.className = 'nav-crumb-sep';
      s.setAttribute('aria-hidden', 'true');
      s.append(icon(doc, 'chevron', 12));
      li.append(s);
    }
    const a = crumbLink(doc, c);
    a.textContent = c.label;
    li.append(a);
    list.append(li);
  });
  const kids = [list];
  const parent = trail[trail.length - 1];
  if (parent) {
    const up = crumbLink(doc, parent, 'nav-up');
    const label = doc.createElement('span');
    label.className = 'nav-up-label';                     // a text node in a flex box cannot ellipsize
    label.textContent = parent.label;
    up.append(icon(doc, 'chevron-left', 16), label);
    kids.push(up);
  }
  nav.replaceChildren(...kids);
}

/** One delegated listener: a plain left click on a crumb whose view is in `handlers` runs that handler (the
 *  restore hook of its list, e.g. runs: backToRunsList); any other crumb is the browser's own hash push. Later
 *  slices add their list's handler to the same map. The selector lives here, so app.js adds no crumb markup. */
export function onCrumbs(nav, handlers) {
  if (!nav) return;
  nav.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-crumb]');
    const fn = a && Object.prototype.hasOwnProperty.call(handlers, a.dataset.crumb) ? handlers[a.dataset.crumb] : null;
    if (!fn || (e.button || 0) !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    fn(a);
  });
}
