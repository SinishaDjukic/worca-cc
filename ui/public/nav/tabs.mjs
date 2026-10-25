// ui/public/nav/tabs.mjs — the one tab controller (docs/design-system.md Navigation): role=tablist wiring over the
// existing .tabs / .tab markup, a roving tabindex, ArrowLeft/ArrowRight (wrapping), Home and End, and click.
// Selection is the caller's: onSelect(key) pushes the address and the route opens the tab, so a tab is always in the
// URL. The panels and aria-selected stay the owner's (app.js initDetailTabs, group-page.mjs paintGroupPage).

/** Wire `list` once. `isShown(tab)` hides tabs the interface level hides (default: not [hidden]). */
export function wireTabs(list, { onSelect, label = '', keyOf = (t) => t.dataset.tab || t.dataset.sec, isShown = (t) => !t.hidden } = {}) {
  if (!list) return null;
  if (list.__navTabs) return list.__navTabs;
  if (label) list.setAttribute('aria-label', label);
  const all = () => [...list.querySelectorAll('[role="tab"]')];
  const shown = () => all().filter(isShown);
  let lastSel = null;
  // The strip grew under a kept selection (a live badge): scroll sideways only, never the page.
  const keepInStrip = (t) => {
    const a = list.getBoundingClientRect();
    const b = t.getBoundingClientRect();
    if (b.right > a.right) list.scrollLeft += b.right - a.right;
    else if (b.left < a.left) list.scrollLeft -= a.left - b.left;
  };
  const sync = () => {
    const s = shown();
    const sel = s.find((t) => t.getAttribute('aria-selected') === 'true') || s[0];
    for (const t of all()) t.tabIndex = t === sel ? 0 : -1;
    // A deep link or a key move can select a tab the 375px strip has scrolled out of sight.
    if (sel && sel !== lastSel && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else if (sel) keepInStrip(sel);
    lastSel = sel || null;
  };
  const pick = (t) => { if (t && isShown(t) && onSelect) onSelect(keyOf(t)); };
  list.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[role="tab"]');
    if (t && list.contains(t)) pick(t);
  });
  list.addEventListener('keydown', (e) => {
    const s = shown();
    const i = s.indexOf(e.target.closest && e.target.closest('[role="tab"]'));
    if (i === -1 || !s.length) return;
    const to = e.key === 'ArrowRight' ? s[(i + 1) % s.length]
      : e.key === 'ArrowLeft' ? s[(i - 1 + s.length) % s.length]
        : e.key === 'Home' ? s[0]
          : e.key === 'End' ? s[s.length - 1] : null;
    if (!to) return;
    e.preventDefault();
    to.focus();
    pick(to);
  });
  const mo = new list.ownerDocument.defaultView.MutationObserver(sync);
  mo.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'hidden'] });
  sync();
  list.__navTabs = { sync, destroy: () => mo.disconnect() };
  return list.__navTabs;
}
