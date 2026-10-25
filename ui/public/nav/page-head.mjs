// ui/public/nav/page-head.mjs — the one page head (docs/design-system.md Navigation): the title row (h1, kind chip,
// optional meta line, the page's actions on the right), then the tabs. A screen MOVES its own nodes in
// (mountPageHead), so every listener and painter keeps its element. Chip wording stays in run-page-head.mjs; the
// facts block is untouched.

/** An empty head: { root, row, main, meta, actions, tabs }. */
export function buildPageHead(doc) {
  const mk = (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e; };
  const root = mk('header', 'ph');
  const row = mk('div', 'ph-row');
  const main = mk('div', 'ph-main');
  const meta = mk('p', 'ph-meta');
  meta.hidden = true;
  const actions = mk('div', 'ph-actions');
  const tabs = mk('div', 'ph-tabs');
  main.append(meta);
  row.append(main, actions);
  root.append(row, tabs);
  return { root, row, main, meta, actions, tabs };
}

/** The meta line under the title; hidden while empty. */
export function setPageMeta(head, text) {
  const t = String(text || '');
  head.meta.hidden = !t;
  if (head.meta.textContent !== t) head.meta.textContent = t;
}

/** Build the head as `screen`'s first child and move `titleRow`, `actions` and `tablist` into it. Once per screen. */
export function mountPageHead(screen, { titleRow = null, actions = null, tablist = null } = {}) {
  if (screen.__pageHead) return screen.__pageHead;
  const head = buildPageHead(screen.ownerDocument);
  if (titleRow) head.main.prepend(titleRow);
  if (actions) head.actions.append(actions);
  if (tablist) head.tabs.append(tablist);
  screen.prepend(head.root);
  screen.__pageHead = head;
  return head;
}

/** After a navigation: focus the page's h1 (tabindex=-1), unless focus is inside `keep` (the split layout's list). */
export function focusPageTitle(head, { keep = null } = {}) {
  const h = head && head.root.querySelector('h1');
  if (!h) return;
  const active = h.ownerDocument.activeElement;
  if (keep && active && keep.contains(active)) return;
  h.focus({ preventScroll: true });
}
