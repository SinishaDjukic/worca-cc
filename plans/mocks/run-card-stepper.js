// Run card v2 mock: renders RunCardModel.view() (run-card-model.js) with Worca's own classes, and keeps the
// viewer's choices (case, open stage, added chips, ship mode, open menu) in `ui`.
const M = window.RunCardModel;
const P = (d) => `<path d="${d}"></path>`;
const ICON = {
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  now: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"></circle>',
  question: P('M9.2 9.2a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1.1-1.4 2v.4') + P('M12 17.6h.01'),
  alert: P('M12 6.8v6.6') + P('M12 17.6h.01'),
  pause: P('M9 5v14M15 5v14'),
  merge: '<circle cx="6" cy="5.5" r="2.2"></circle><circle cx="6" cy="18.5" r="2.2"></circle><circle cx="18" cy="12" r="2.2"></circle>' + P('M6 7.7v8.6') + P('M6 7.7c0 2.4 2.5 4.3 9.8 4.3'),
  refresh: P('M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'),
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"></rect>' + P('M5 15V6a2 2 0 0 1 2-2h8'),
  chevron: P('M6 9.5l6 6 6-6'),
  plus: P('M12 5v14M5 12h14'),
  x: P('M7 7l10 10M17 7 7 17'),
  prc: '<circle cx="6" cy="6" r="2.5"></circle>' + P('M6 8.5V21M13 6h3a2 2 0 0 1 2 2v3M18 15v6M15 18h6'),
  pr: '<circle cx="6" cy="6" r="2.2"></circle><circle cx="6" cy="18" r="2.2"></circle><circle cx="18" cy="18" r="2.2"></circle>' + P('M6 8.2v7.6') + P('M18 15.8V9a3 3 0 0 0-3-3h-4') + P('M13 3.5 10.5 6 13 8.5'),
  up: P('M12 19V5M6 11l6-6 6 6'),
  play: P('M8 5.5v13l10.5-6.5z'),
  folder: P('M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z'),
};
const svg = (name, size) => (ICON[name] ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>` : '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let ui = { caseId: 'working', open: null, chips: [], ship: 'stack', menu: '' };

function statusDot(v) {
  if (v.sym) {
    const g = v.sym === 'q' ? ICON.question : ICON.alert;
    return `<span class="status-dot ${v.sym === 'q' ? 'is-amber' : 'is-red'} has-sym" role="img" aria-label="${v.word}"><svg class="status-sym" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor" stroke="none"></circle><g fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg></span>`;
  }
  return `<span class="status-dot ${v.dot}" aria-hidden="true"></span>`;
}
// A menu: an optional line on what the main action does, then each item with its one-line help.
function menu(id, items, lead) {
  if (ui.menu !== id) return '';
  const head = lead ? `<p class="menu-lead">${esc(lead)}</p><div class="menu-sep"></div>` : '';
  return `<div class="menu" role="menu">${head}${items.map((it) => `<button type="button" class="menu-item has-help" role="menuitem" data-menu-pick="${esc(it.id || it.text)}"><span>${esc(it.text)}</span>${it.help ? `<span class="menu-help">${esc(it.help)}</span>` : ''}</button>`).join('')}</div>`;
}
function chip(c, i) {
  const x = `<button type="button" class="tag-x" aria-label="Remove ${esc(c.text)}" data-unchip="${i}">${svg('x', 10)}</button>`;
  if (c.kind === 'label') return `<span class="label-chip"><span class="label-dot hue-blue"></span><span class="label-chip-t">${esc(c.text)}</span>${x}</span>`;
  if (c.kind === 'tag') return `<span class="badge tag-chip">${esc(c.text)}${x}</span>`;
  return `<span class="kind-chip">${esc(c.text)}</span>`;
}
function rowHtml(r) {
  const meta = [r.loops ? `<span class="sc-loop" title="Ran ${r.loops} times">${svg('refresh', 11)}${r.loops}</span>` : '', r.time ? `<span>${esc(r.time)}</span>` : ''].join('');
  return `<li class="rd-route-row ${r.rowCls}"><span class="rd-route-dot ${r.dotCls}" role="img" aria-label="${r.word}">${svg(r.icon, 10)}</span>
    <div class="rd-route-main"><div class="rd-route-place"><span class="rd-route-name" title="${esc(r.name)}">${esc(r.name)}</span>${meta ? `<span class="sc-meta">${meta}</span>` : ''}</div>
    ${r.live ? `<div class="rd-route-second" title="${esc(r.live)}">${esc(r.live)}${r.when ? `<span class="rc-when"> · ${esc(r.when)}</span>` : ''}</div>` : ''}</div></li>`;
}
function stackHtml(k) {
  const seg = k.modes ? `<div class="seg" role="group" aria-label="Ship as"><button type="button" data-ship="stack" aria-pressed="${k.ship === 'stack'}">Stacked · ${k.count} PRs</button><button type="button" data-ship="one" aria-pressed="${k.ship === 'one'}">One PR</button></div>` : '';
  const rows = k.rows.map((r) => `<li class="rd-route-row ${r.rowCls}"><span class="rd-route-dot ${r.dotCls}" role="img" aria-label="${r.word}">${svg(r.icon, 11)}</span>
    <div class="rd-route-main"><div class="rd-route-place"><span class="sk-num">${esc(r.num)}</span><span class="rd-route-name" title="${esc(r.title)}">${esc(r.title)}</span><span class="sk-br"></span><span class="sk-word is-${r.state}">${esc(r.word)}</span></div>
    <div class="rd-route-second" title="${esc(r.sub)}">${esc(r.sub)}</div></div></li>`).join('');
  return `<div class="sk"><div class="sk-head"><span class="rc-label">${esc(k.title)}</span>${seg}</div><ol class="rd-route-list sk-list" aria-label="${esc(k.title)}">${rows}</ol>${k.note ? `<p class="sk-note" style="margin:0">${esc(k.note)}</p>` : ''}</div>`;
}

function render() {
  const v = M.view(ui.caseId, ui);
  const a = v.action;
  const action = a ? `<div class="rc-side"><div class="btn-split rc-action rc-pop is-right"><button type="button" class="btn ${a.primary ? 'btn-primary' : ''}" title="${esc(a.help)}">${svg(a.icon, 16)}${esc(a.label)}</button>${a.items.length ? `<button type="button" class="btn btn-icon ${a.primary ? 'btn-primary' : ''}" aria-label="More actions" aria-haspopup="menu" aria-expanded="${ui.menu === 'act'}" data-menu="act">${svg('chevron', 16)}</button>${menu('act', a.items, a.label + ': ' + a.help)}` : ''}</div></div>` : '';
  const addable = M.add.filter((x) => !ui.chips.some((c) => c.kind === x.kind));
  const place = v.branch ? `<span class="sc-branch" title="${esc(v.branch)}"><code>${esc(v.branch)}</code><button type="button" class="btn btn-sm btn-quiet btn-icon" aria-label="Copy branch name">${svg('copy', 12)}</button></span>`
    : v.folder ? `<span class="sc-branch" title="${esc(v.folder)}"><code>${esc(v.folder)}</code></span>` : '';
  const facts = [v.kind ? `<span class="kind-chip">${esc(v.kind)}</span>` : '', `<span class="rc-trunc">${esc(v.project)}</span>`, place, `<span>${v.started}</span>`].filter(Boolean)
    .join('<span class="rc-sep">·</span>') + ui.chips.map(chip).join('')
    + (addable.length ? `<span class="rc-pop"><button type="button" class="btn btn-sm btn-quiet btn-icon rc-add" aria-label="Add a label, cost tag or group" aria-haspopup="menu" aria-expanded="${ui.menu === 'add'}" data-menu="add">${svg('plus', 14)}</button>${menu('add', addable.map((x) => ({ id: x.kind, text: x.menu, help: x.help })))}</span>` : '');

  const track = v.stages.map((st) => `<div class="sc-seg">${st.cells.map((c) => `<span class="sc-cell ${c}"></span>`).join('')}</div>`).join('');
  const tabs = v.stages.map((st) => `<button type="button" class="sc-stage" role="tab" aria-selected="${st.selected}" data-stage="${st.key}" aria-label="${esc(st.aria)}"><span class="l">${st.label}</span><span class="m">${esc(st.meta)}</span></button>`).join('');
  const o = v.open;
  const head = o.isRun ? `<div class="sc-head"><span class="sc-run" title="${esc(o.title)}">${esc(o.label)} · ${esc(o.title)}</span><button type="button" class="btn btn-sm btn-quiet">Open run</button></div>`
    : o.browsing ? '<div class="sc-head is-end"><button type="button" class="btn btn-sm btn-quiet" data-back>Back to now</button></div>' : '';
  const panel = o.stack ? stackHtml(o.stack) : `<ol class="rd-route-list sc-subs" aria-label="${o.label} steps" style="grid-column:1 / -1">${o.rows.map(rowHtml).join('')}</ol>`;

  document.getElementById('card').innerHTML = `
  <div class="rc">
    <div class="rc-head"><h1 class="rc-heading" title="${esc(v.title)}">${esc(v.title)}</h1><div class="rc-facts">${facts}</div></div>
    <section class="rc-card" aria-label="Run status">
      <div class="rc-zone"><span class="rc-rail">${statusDot(v)}</span><span class="rc-main rc-word">${esc(v.word)}</span>${action}${v.detail ? `<span class="rc-detail" title="${esc(v.detail)}">${esc(v.detail)}</span>` : ''}</div>
      <div class="rc-zone"><div class="rc-span"><div class="sc-track" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" aria-hidden="true">${track}</div><div class="sc-stages" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" role="tablist" aria-label="Stages">${tabs}</div></div></div>
      <div class="rc-zone is-ruled">${head}${panel}</div>
      <div class="rc-zone is-ruled"><div class="rc-figs">${v.figs.map((f) => `<span>${f.k}<b>${f.v}</b></span>`).join('')}</div></div>
    </section>
    <div class="tabs rc-tabs" role="tablist" aria-label="Run detail">${v.tabs.map((t) => `<button type="button" class="tab" role="tab" aria-selected="${t.sel}">${esc(t.l)}${t.n ? `<span class="n">${t.n}</span>` : ''}</button>`).join('')}</div>
  </div>`;
}

const pick = document.getElementById('case');
const groups = [...new Set(M.cases.map((c) => c.group))];
pick.innerHTML = groups.map((g) => `<optgroup label="${g}">${M.cases.filter((c) => c.group === g).map((c) => `<option value="${c.id}"${c.id === ui.caseId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
pick.addEventListener('change', () => { ui = Object.assign(ui, { caseId: pick.value, open: null, ship: 'stack', menu: '' }); render(); });

document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (t && t.dataset.themePick) {
    document.documentElement.dataset.theme = t.dataset.themePick;
    document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    return;
  }
  if (!t) { if (ui.menu) { ui.menu = ''; render(); } return; }
  const d = t.dataset;
  if (d.menu) ui.menu = ui.menu === d.menu ? '' : d.menu;
  else if (d.menuPick) {
    const add = M.add.find((x) => x.kind === d.menuPick);
    if (ui.menu === 'add' && add) ui.chips = ui.chips.concat({ kind: add.kind, text: add.text });
    ui.menu = '';
  } else if (d.unchip !== undefined) { ui.chips = ui.chips.filter((_, i) => i !== +d.unchip); ui.menu = ''; }
  else if (d.stage) { ui.open = d.stage; ui.menu = ''; }
  else if ('back' in d) ui.open = null;
  else if (d.ship) ui.ship = d.ship;
  else { if (ui.menu) { ui.menu = ''; render(); } return; }
  render();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.menu) { ui.menu = ''; render(); } });
render();
