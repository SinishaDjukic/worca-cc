// ui/public/dialog-layout.mjs — the shared dialog anatomy (docs/design-system.md › Modals).
// A .viewer-modal card that opts in carries .dlg and exactly three kinds of direct child:
// .dlg-head (pinned: hero, title, subtitle), .dlg-body (the ONE scroller), .dlg-foot (pinned:
// status line + action row). Static dialogs write the wrappers in index.html; JS builders call
// layoutDialog on the card they built. Ids, classes and data-* hooks stay on the moved nodes.

const EDGE_PX = 1;
const watchedDocs = new WeakSet();
const watchedBodies = new WeakSet();

/**
 * Wrap `card`'s direct children: `head` nodes into .dlg-head, `foot` nodes into .dlg-foot, every
 * other child (in document order) into .dlg-body. Null entries and nodes that are not direct
 * children are skipped. Idempotent: a card that already has .dlg is returned untouched. `card` is
 * the element that plays the column — a .card, or the sync refusal's .qpanel.
 */
export function layoutDialog(card, { head = [], foot = [] } = {}) {
  if (!card || card.classList.contains('dlg')) return card;
  const doc = card.ownerDocument;
  const own = (list) => list.filter((n) => n && n.parentNode === card);
  const headNodes = own(head);
  const footNodes = own(foot);
  const pinned = new Set([...headNodes, ...footNodes]);
  const bodyNodes = [...card.childNodes].filter((n) => !pinned.has(n));
  const region = (cls, nodes) => {
    const r = doc.createElement('div');
    r.className = cls;
    r.append(...nodes);
    return r;
  };
  const parts = [];
  if (headNodes.length) parts.push(region('dlg-head', headNodes));
  parts.push(region('dlg-body', bodyNodes));
  if (footNodes.length) parts.push(region('dlg-foot', footNodes));
  card.replaceChildren(...parts);
  card.classList.add('dlg');
  watchDialogEdges(card);
  return card;
}

/** Flag the card while content sits under its head (data-under-head) or below its foot (data-under-foot). */
export function syncDialogEdges(body) {
  const card = body?.parentElement;
  if (!card?.classList.contains('dlg')) return;
  const top = body.scrollTop > EDGE_PX;
  const below = body.scrollTop + body.clientHeight < body.scrollHeight - EDGE_PX;
  card.toggleAttribute('data-under-head', top);
  card.toggleAttribute('data-under-foot', below);
}

/**
 * Keep the edge flags current for every .dlg-body under `root` (a document, a card or a body).
 * One capture-phase scroll listener per document (scroll does not bubble); a ResizeObserver per
 * body catches open (0 → n height), content growth and window resizes. Safe to call repeatedly.
 */
export function watchDialogEdges(root = globalThis.document) {
  if (!root) return;
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  if (!doc) return;
  if (!watchedDocs.has(doc)) {
    watchedDocs.add(doc);
    doc.addEventListener('scroll', (e) => {
      const t = e.target;
      if (t?.classList?.contains('dlg-body')) syncDialogEdges(t);
    }, true);
  }
  // Same guard as ask-panel.mjs:1514 — jsdom has no ResizeObserver; tests drive syncDialogEdges directly.
  const RO = doc.defaultView && doc.defaultView.ResizeObserver;
  const bodies = root.classList?.contains('dlg-body') ? [root] : [...root.querySelectorAll('.dlg-body')];
  for (const body of bodies) {
    syncDialogEdges(body);
    if (typeof RO !== 'function' || watchedBodies.has(body)) continue;
    watchedBodies.add(body);
    const ro = new RO(() => syncDialogEdges(body));
    ro.observe(body);
    for (const child of body.children) ro.observe(child);
  }
}
