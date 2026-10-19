// ui/public/group-picker.mjs — ⋯ → Add to group… (runs redesign §3.3): a small popover anchored to the ⋯ button,
// placed and clamped to the viewport with placeFlyout (Known bug 8). Each group is drawn with the one status dot
// (status-dot.mjs) and its "2/3" count. groups: [{ id, title, model: groupModel output }].
import { renderStatusDot } from './status-dot.mjs';
import { placeFlyout } from './side-flyout.mjs';

export function openGroupPicker({ doc, anchor, groups, onPick, onCreate, onClose = () => {} }) {
  const el = doc.createElement('div');
  el.className = 'group-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Add to group');
  const q = doc.createElement('input');
  q.type = 'search';
  q.className = 'input gp-search';
  q.placeholder = 'Find a group';
  q.setAttribute('aria-label', 'Find a group');
  const list = doc.createElement('div');
  list.className = 'gp-list';
  for (const g of groups) {
    const row = doc.createElement('button');
    row.type = 'button';
    row.className = 'gp-row';
    row.dataset.groupId = g.id;
    const t = doc.createElement('span');
    t.className = 'gp-title';
    t.textContent = g.title;
    const c = doc.createElement('span');
    c.className = 'runs-count';
    c.textContent = g.model.count ? g.model.count.text : '';
    row.append(renderStatusDot(doc, g.model), t, c);
    row.addEventListener('click', () => { close(); onPick(g); });
    list.append(row);
  }
  const empty = doc.createElement('p');
  empty.className = 'gp-empty';
  empty.textContent = groups.length ? 'No groups match.' : 'No groups yet.';
  empty.hidden = groups.length > 0;
  const neu = doc.createElement('button');
  neu.type = 'button';
  neu.className = 'btn btn-sm btn-quiet gp-new';
  neu.textContent = 'New group';
  neu.addEventListener('click', () => {
    const name = doc.createElement('input');
    name.className = 'input gp-name';
    name.placeholder = 'Group name';
    name.setAttribute('aria-label', 'Group name');
    name.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !name.value.trim()) return;
      e.preventDefault();
      const title = name.value.trim();
      close();
      onCreate(title);
    });
    neu.replaceWith(name);
    name.focus();
  });
  q.addEventListener('input', () => {
    const s = q.value.trim().toLowerCase();
    let shown = 0;
    for (const row of list.children) {
      row.hidden = !!s && !row.querySelector('.gp-title').textContent.toLowerCase().includes(s);
      if (!row.hidden) shown += 1;
    }
    empty.hidden = shown > 0;
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } });
  const onDown = (e) => { if (!el.contains(e.target) && e.target !== anchor) close(); };
  el.append(q, list, empty, neu);
  doc.body.append(el);
  placeFlyout(el, anchor, { mode: 'down', gap: 4, margin: 8, win: doc.defaultView });   // its default win is globalThis.window, unset under a test's JSDOM
  doc.addEventListener('pointerdown', onDown, true);
  q.focus();
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    doc.removeEventListener('pointerdown', onDown, true);
    el.remove();
    onClose();
  }
  return { el, close };
}
