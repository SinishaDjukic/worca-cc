// ui/public/ask/widgets-layout.mjs
// The LAYOUT half of the ask widget catalog v1 (ask-forms design §6.1). A
// container draws its children through ctx.render(items), which is the SAME
// entry point the top-level layout goes through — so `when`, the error slots and
// disposal keep working at any depth. Chrome only: a container contributes no
// field, and hiding a tab does NOT hide its fields from the answer (that is what
// `when` is for).
import { h } from './dom.mjs';

function groupWidget(item, ctx) {
  const box = h(ctx.doc, 'div', 'af-grp');
  if (item.title) box.appendChild(h(ctx.doc, 'h3', 'af-grp-title', item.title));
  for (const node of ctx.render(item.children)) box.appendChild(node);
  return box;
}

function columnsWidget(item, ctx) {
  const cols = Array.isArray(item.columns) ? item.columns : [];
  const box = h(ctx.doc, 'div', 'af-cols');
  box.style.setProperty('--af-cols', String(Math.max(1, cols.length)));
  for (const col of cols) {
    const cell = h(ctx.doc, 'div', 'af-col');
    for (const node of ctx.render(col)) cell.appendChild(node);
    box.appendChild(cell);
  }
  return box;
}

function tabsWidget(item, ctx) {
  const defs = Array.isArray(item.tabs) ? item.tabs : [];
  const id = ctx.idFor(`tabs-${defs.length}`);
  const box = h(ctx.doc, 'div', 'af-tabs');
  const bar = h(ctx.doc, 'div', 'af-tabs-bar');
  bar.setAttribute('role', 'tablist');
  const tabs = [];
  const panes = [];

  const select = (i, focus) => {
    tabs.forEach((t, k) => {
      const on = k === i;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('on', on);
      t.tabIndex = on ? 0 : -1;
      panes[k].hidden = !on;
    });
    if (focus && tabs[i]) tabs[i].focus();
  };

  defs.forEach((def, i) => {
    const pane = h(ctx.doc, 'div', 'af-pane');
    pane.id = `${id}-p${i}`;
    pane.setAttribute('role', 'tabpanel');
    pane.setAttribute('aria-labelledby', `${id}-t${i}`);
    pane.hidden = i !== 0;
    for (const node of ctx.render(def && def.children)) pane.appendChild(node);
    panes.push(pane);

    const tab = h(ctx.doc, 'button', i === 0 ? 'af-tab on' : 'af-tab', String((def && def.label) || `Tab ${i + 1}`));
    tab.type = 'button';
    tab.id = `${id}-t${i}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(i === 0));
    tab.setAttribute('aria-controls', pane.id);
    tab.tabIndex = i === 0 ? 0 : -1;
    tab.addEventListener('click', () => select(i, false));
    tab.addEventListener('keydown', (e) => {
      const last = defs.length - 1;
      let next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = i === last ? 0 : i + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = i === 0 ? last : i - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      if (next === null) return;
      e.preventDefault();
      select(next, true);
    });
    tabs.push(tab);
    bar.appendChild(tab);
  });

  box.appendChild(bar);
  for (const p of panes) box.appendChild(p);
  return box;
}

export const LAYOUT_WIDGETS_TABLE = Object.freeze({
  group: groupWidget,
  columns: columnsWidget,
  tabs: tabsWidget,
});
