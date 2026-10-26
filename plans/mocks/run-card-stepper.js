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

let ui = { caseId: 'working', open: null, chips: [], ship: '', menu: '', tab: '', focus: '', view: 'steps', parent: null, back: null };

function statusDot(v) {
  if (v.sym) {
    const g = v.sym === 'q' ? ICON.question : ICON.alert;
    return `<span class="status-dot ${v.sym === 'q' ? 'is-amber' : 'is-red'} has-sym" aria-hidden="true"><svg class="status-sym" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor" stroke="none"></circle><g fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg></span>`;
  }
  return `<span class="status-dot ${v.dot}" aria-hidden="true"></span>`;
}
// A menu: an optional line on what the main action does, then each item with its one-line help.
function menu(id, items, lead) {
  if (ui.menu !== id) return '';
  const head = lead ? `<p class="menu-lead">${esc(lead)}</p><div class="menu-sep"></div>` : '';
  const danger = /^(Discard|Stop)$/;
  return `<div class="menu" role="menu">${head}${items.map((it) => `<button type="button" class="menu-item has-help${danger.test(it.text) ? ' is-danger' : ''}" role="menuitem" data-menu-pick="${esc(it.id || it.text)}"><span>${esc(it.text)}</span>${it.help ? `<span class="menu-help">${esc(it.help)}</span>` : ''}</button>`).join('')}</div>`;
}
function chip(c, i) {
  const x = `<button type="button" class="tag-x" aria-label="Remove ${esc(c.text)}" data-unchip="${i}">${svg('x', 10)}</button>`;
  if (c.kind === 'label') return `<span class="label-chip"><span class="label-dot hue-blue"></span><span class="label-chip-t" title="${esc(c.text)}">${esc(c.text)}</span>${x}</span>`;
  return `<span class="badge tag-chip" title="${esc(c.text)}">${esc(c.text)}${x}</span>`;
}
// The + picker: after choosing Label, Cost tag or group, a small field to type one, with existing values to pick.
function pickerHtml(kind) {
  const k = M.add.find((x) => x.kind === kind);
  const taken = ui.chips.filter((c) => c.kind === kind).map((c) => c.text);
  return `<div class="menu rc-picker" role="dialog" aria-label="Add ${esc(k.menu.toLowerCase())}"><p class="menu-h">${esc(k.menu)}</p>
    <input class="input input-sm" type="text" placeholder="${esc(k.placeholder)}" aria-label="${esc(k.menu)}" data-key="pick-input">
    <div class="rc-suggest">${k.suggest.filter((x) => !taken.includes(x)).map((x) => `<button type="button" class="btn btn-sm" data-suggest="${esc(x)}" data-key="suggest:${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <p class="menu-help">Enter adds it · Esc closes</p></div>`;
}
// Every focusable control carries data-key, so a render keeps keyboard focus on it (or moves it on purpose via
// pendingFocus) instead of dropping it to the page.
let pendingFocus = '';
let lastOpen = '';

function rowHtml(r, full) {
  // A step row is cells of its list's grid: circle · name · time · loops, and in Activity also model · cost · Log.
  // Rows are subgrids, so every column lines up down the list; on narrow cards the details drop under the name.
  const name = r.ref ? `<button type="button" class="sc-step rd-route-name sc-name" data-ref="${esc(r.ref)}" data-key="ref:${esc(r.ref)}" title="Open ${esc(r.name)} in Activity">${esc(r.name)}</button>`
    : `<span class="rd-route-name sc-name" title="${esc(r.name)}"${r.akey ? ` tabindex="-1" data-key="act:${esc(r.akey)}"` : ''}>${esc(r.name)}</span>`;
  const loops = r.loops ? `<span class="sc-loop" title="Ran ${r.loops} times">${svg('refresh', 11)}${r.loops}</span>` : '';
  const log = full && !/is-next/.test(r.rowCls) && !r.evidence ? `<button type="button" class="btn btn-sm btn-quiet rtab-log" data-key="log:${esc(r.akey)}">Log</button>` : '';
  const rest = `<span class="sc-rest"><span class="sc-loops">${loops}</span>${full ? `<span class="sc-model">${esc(r.model || '')}</span><span class="sc-cost">${esc(r.cost || '')}</span><span class="sc-act">${log}</span>` : ''}</span>`;
  // A failed or blocked step shows what broke, its last lines and a way into the log, in Activity only.
  const ev = r.evidence ? `<div class="rtab-ev"><p class="rtab-ev-t">${esc(r.evidence.title)}</p><pre class="rtab-ev-l">${r.evidence.lines.map(esc).join('\n')}</pre><button type="button" class="btn btn-sm rtab-ev-btn" data-key="log:${esc(r.akey)}">${esc(r.evidence.log)}</button></div>` : '';
  return `<li class="rd-route-row sc-row ${r.rowCls}${r.focus ? ' is-focus' : ''}"><span class="rd-route-dot ${r.dotCls}" role="img" aria-label="${esc(r.word)}">${svg(r.icon, 10)}</span>
    ${name}<span class="sc-time">${esc(r.time || '')}</span>${rest}
    ${r.live ? `<div class="rd-route-second sc-line" title="${esc(r.live)}">${esc(r.live)}${r.when ? `<span class="rc-when"> · ${esc(r.when)}</span>` : ''}</div>` : ''}${ev}</li>`;
}
// The ship choice: one pick, so a radio group (arrow keys move and pick); Recommended is the neutral chip, then why.
function choiceHtml(ch) {
  const opts = ch.options.map((o) => `<button type="button" class="qopt${o.selected ? ' sel' : ''}" role="radio" aria-checked="${o.selected}" tabindex="${o.selected ? 0 : -1}" data-ship="${o.id}" data-key="ship:${o.id}"${o.disabled ? ' disabled aria-disabled="true"' : ''}>
    <span class="sk-opt"><span class="sk-opt-l">${esc(o.label)}${o.rec ? '<span class="qrec">Recommended</span>' : ''}</span><span class="sk-opt-h">${esc(o.help)}</span></span></button>`).join('');
  return `<div class="qopts sk-choice" role="radiogroup" aria-label="Ship as">${opts}</div><p class="sk-note" style="margin:0">${esc(ch.reason)}</p>`;
}
function stackHtml(k) {
  const seg = '';
  const rows = k.rows.map((r) => `<li class="rd-route-row ${r.rowCls}"><span class="rd-route-dot ${r.dotCls}" role="img" aria-label="${r.word}">${svg(r.icon, 11)}</span>
    <div class="rd-route-main"><div class="rd-route-place"><span class="sk-num">${esc(r.num)}</span><span class="rd-route-name" title="${esc(r.title)}">${esc(r.title)}</span></div>
    <div class="rd-route-second" title="${esc(r.word + ' · ' + r.sub)}"><span class="sk-word is-${r.state}">${esc(r.word)}</span> · ${esc(r.sub)}</div></div></li>`).join('');
  const choice = k.choice ? choiceHtml(k.choice) + '<div class="sk-head"><span class="rc-label">What it opens</span></div>' : '';
  return `<div class="sk${k.enter ? ' is-enter' : ''}"><div class="sk-head"><span class="rc-label">${esc(k.title)}</span>${seg}</div>${choice}<ol class="rd-route-list sk-list" aria-label="${esc(k.title)}">${rows}</ol>${k.note ? `<p class="sk-note" style="margin:0">${esc(k.note)}</p>` : ''}</div>`;
}

// The tabs under the card: one question each, each fact in one place. Time, cost against the budget and the diff
// size are the card's figures; cost per step lives in Activity; the Away-mode cost in Decisions.
function summaryPanel(v) {
  const d = v.tabData;
  return `<section class="rtab"><h2 class="rtab-h">What you asked</h2><p class="rtab-p">${esc(d.task)}</p></section>
  <section class="rtab"><h2 class="rtab-h">To check <span class="n">${d.check.length}</span></h2><ul class="rtab-list">${d.check.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></section>
  <section class="rtab"><h2 class="rtab-h">Artifacts <span class="n">${d.artifacts.length}</span></h2><ul class="rtab-list is-plain">${d.artifacts.map(([f, step]) => `<li><code>${esc(f)}</code><span class="rtab-dim">from ${esc(step)}</span></li>`).join('')}</ul></section>`;
}
function changesPanel(v) {
  const f = v.tabData.files;
  return `<section class="rtab"><h2 class="rtab-h">${f.length} files</h2>
  <ul class="rtab-files">${f.map(([p, a, d], i) => `<li><button type="button" class="rtab-file" data-key="file:${i}"><code title="${esc(p)}">${esc(p)}</code><span class="ct"><span class="add">+${a}</span><span class="del">−${d}</span></span></button></li>`).join('')}</ul>
  <p class="rtab-dim rtab-p">A file opens its diff here; review comments sit on its lines.</p></section>`;
}
function activityPanel(v) {
  const view = ui.view || 'steps';
  const seg = `<div class="seg" role="group" aria-label="Show"><button type="button" data-view="steps" data-key="view:steps" aria-pressed="${view === 'steps'}">Steps</button><button type="button" data-view="graph" data-key="view:graph" aria-pressed="${view === 'graph'}">Graph</button></div>`;
  if (view === 'graph') return `<div class="rtab-bar">${seg}</div><p class="rtab-dim rtab-p">The run graph, as today, centred on the live step; a step opens the same log drawer.</p>`;
  // One list for the whole tab, stage headings as full-width rows, so every step on the tab shares the same columns.
  const rows = v.activity.map((st) => `<li class="sc-stage-row"><h2 class="rtab-h">${esc(st.label)}${st.title ? ' · ' + esc(st.title) : ''}${st.meta ? ` <span class="rtab-dim">${esc(st.meta)}</span>` : ''}</h2></li>`
    + st.rows.map((r) => rowHtml(Object.assign({}, r, { ref: '', akey: r.ref }), true)).join('')).join('');
  const stages = `<section class="rtab rtab-stage"><ol class="rd-route-list sc-subs is-full" aria-label="Steps">${rows}</ol></section>`;
  return `<div class="rtab-bar">${seg}</div>${stages}`;
}
function decisionsPanel(v) {
  return `<ul class="rtab-dec">${v.tabData.decisions.map((x) => `<li><span class="rtab-dim">${esc(x.step)}</span><span class="rtab-q">${esc(x.q)}</span><span>${esc(x.a)}</span><span class="rtab-dim">${esc(x.by)}</span></li>`).join('')}</ul>`;
}
function runsPanel(v) {
  return `<ul class="rtab-dec is-runs">${v.runs.map((r) => `<li><span class="status-dot ${r.dot}${/peach/.test(r.dot) ? ' is-pulse' : ''}" aria-hidden="true"></span><span class="rtab-q" title="${esc(r.title)}">${esc(r.title)}</span><span class="rtab-dim">${esc([r.word, r.time, r.cost, r.pr].filter(Boolean).join(' · '))}</span>${r.canOpen ? `<button type="button" class="btn btn-sm btn-quiet" data-open-run="${r.n - 1}" data-key="run:${r.n - 1}" aria-label="Open run ${r.n}: ${esc(r.title)}">Open</button>` : ''}</li>`).join('')}</ul>`;
}
function panelHtml(v) {
  const id = (v.tabs.find((t) => t.sel) || v.tabs[0]).id;
  return ({ summary: summaryPanel, changes: changesPanel, activity: activityPanel, decisions: decisionsPanel, runs: runsPanel })[id](v);
}
function figHtml(f) {
  if (f.tab) return `<button type="button" class="rc-fig-link" data-tab="${f.tab}" data-key="fig:${f.tab}" title="Open Changes">${esc(f.k)}<b>${esc(f.v)}</b></button>`;
  return `<span${f.title ? ` title="${esc(f.title)}"` : ''}>${esc(f.k)} <b>${esc(f.v)}</b>${f.of ? `<span class="rc-of${f.warn ? ' is-warn' : ''}">${esc(f.of)}</span>` : ''}</span>`;
}

function render() {
  const keep = pendingFocus || document.activeElement?.dataset?.key || '';
  pendingFocus = '';
  const v = M.view(ui.caseId, ui);
  const a = v.action;
  const action = a ? `<div class="rc-side"><div class="btn-split rc-action rc-pop is-right"><button type="button" class="btn ${a.primary ? 'btn-primary' : ''}" title="${esc(a.help)}" data-key="act-main">${svg(a.icon, 16)}${esc(a.label)}</button>${a.items.length ? `<button type="button" class="btn btn-icon ${a.primary ? 'btn-primary' : ''}" aria-label="More actions" aria-haspopup="menu" aria-expanded="${ui.menu === 'act'}" data-menu="act" data-key="menu:act">${svg('chevron', 16)}</button>${menu('act', a.items, a.help)}` : ''}</div></div>` : '';
  const addable = M.add.filter((x) => x.kind !== 'group' || !ui.chips.some((c) => c.kind === 'group'));   // many labels and tags, one group
  // The place line: branch → base with copy, or the folder, or the repositories; the PR once it exists. The branch
  // loses its middle, never its end, so sibling runs (-2, -3) stay apart.
  const pl = v.place;
  const mid = (t) => { const k = Math.max(t.lastIndexOf('-'), t.lastIndexOf('/')); const cut = k > 0 && t.length - k <= 16 ? k : Math.max(0, t.length - 12); return `<code class="rc-mid" title="${esc(t)}"><span class="rc-mid-a">${esc(t.slice(0, cut))}</span><span class="rc-mid-b">${esc(t.slice(cut))}</span></code>`; };
  const where = pl.folder ? `<span class="rc-place">${mid(pl.folder)}</span>`
    : pl.branch ? `<span class="rc-place">${mid(pl.branch)}${pl.copy ? `<button type="button" class="btn btn-sm btn-quiet btn-icon" aria-label="Copy branch name" data-key="copy">${svg('copy', 12)}</button>` : ''}${pl.base ? `<span class="rc-to" aria-label="into">→</span><code class="rc-base">${esc(pl.base)}</code>` : ''}</span>` : '';
  const repos = pl.repos.length ? `<span>${pl.repos.length} repositories</span>` : '';
  const pr = pl.pr ? `<a class="rc-pr" href="#" data-key="pr" title="Open ${esc(pl.pr)} on GitHub">${esc(pl.pr)}</a>` : '';
  // + stays at the end of the place line; labels and tags, once added, get their own wrapping row under it.
  const chipRow = ui.chips.length ? `<div class="rc-chips">${ui.chips.map(chip).join('')}</div>` : '';
  const placeLine = [where, repos, pr].filter(Boolean).join('<span class="rc-sep" aria-hidden="true">·</span>');
  const add = (addable.length ? `<span class="rc-pop"><button type="button" class="btn btn-sm btn-quiet btn-icon rc-add" aria-label="Add a label, cost tag or group" aria-haspopup="menu" aria-expanded="${ui.menu === 'add' || ui.menu.startsWith('pick-')}" data-menu="add" data-key="menu:add">${svg('plus', 14)}</button>${ui.menu.startsWith('pick-') ? pickerHtml(ui.menu.slice(5)) : menu('add', addable.map((x) => ({ id: x.kind, text: x.menu, help: x.help })))}</span>` : '');
  const facts = placeLine ? placeLine + add : '';   // a group page has no place line: + sits after its kind
  // Where you are: Runs › place › group, the page itself never a crumb; on a narrow card only the parent, as ‹ Parent.
  const crumbs = `<nav class="rc-crumbs" aria-label="Breadcrumb"><ol>${v.crumbs.map((c, i) => `<li${i === v.crumbs.length - 1 ? ' class="is-parent"' : ''}>${c.go ? `<button type="button" class="rc-crumb" data-crumb="${i}" data-key="crumb:${i}" title="${esc(c.t)}">${esc(c.t)}</button>` : `<a class="rc-crumb" href="#" data-key="crumb:${i}" title="${esc(c.t)}">${esc(c.t)}</a>`}</li>`).join('')}</ol></nav>`;
  // A run in a group steps to its siblings; a run that has not started has no page yet.
  const pg = v.pager;
  const left = svg('chevron', 14).replace('M6 9.5l6 6 6-6', 'M14.5 6l-6 6 6 6');
  const right = svg('chevron', 14).replace('M6 9.5l6 6 6-6', 'M9.5 6l6 6-6 6');
  const sib = (x, dir, icon) => `<button type="button" class="btn btn-sm btn-quiet btn-icon" data-sib="${x ? x.index : ''}" data-key="sib:${dir}" aria-label="${dir === 'prev' ? 'Previous' : 'Next'} run"${x && x.ok ? '' : ` disabled${x ? ` title="Run ${x.index + 1} hasn’t started"` : ''}`}>${icon}</button>`;
  const pager = pg ? `<span class="rc-pager" role="group" aria-label="Runs in this group">${sib(pg.prev, 'prev', left)}<span class="rc-pager-n">${pg.index + 1} of ${pg.n}</span>${sib(pg.next, 'next', right)}</span>` : '';
  const scope = v.bar.scope ? ` title="Applies to the whole ${esc(v.bar.scope)}: the running run and the ones after it"` : '';

  const track = v.stages.map((st) => `<div class="sc-seg">${st.cells.map((c) => `<span class="sc-cell ${c}"></span>`).join('')}</div>`).join('');
  // The stage row is a real tablist: one Tab stop (the selected stage), arrows move, each tab names the panel it controls.
  const stages = v.stages.map((st) => `<button type="button" class="sc-stage" role="tab" id="st-${st.key}" aria-controls="stage-panel" aria-selected="${st.selected}" tabindex="${st.selected ? 0 : -1}" data-stage="${st.key}" data-key="stage:${st.key}" aria-label="${esc(st.aria)}" title="${esc(st.aria)}"><span class="l">${esc(st.label)}</span><span class="m">${esc(st.meta)}</span></button>`).join('');
  const o = v.open;
  const enter = o.key !== lastOpen; lastOpen = o.key;   // the steps fade in only when another stage opens, never on a repaint
  const head = o.isRun ? `<div class="sc-head"><span class="sc-run" title="${esc(o.title)}">${esc(o.title)}</span>${o.meta ? `<span class="rtab-dim sc-run-cost">${esc(o.meta)}</span>` : ''}${o.canOpen ? `<button type="button" class="btn btn-sm" data-open-run="${o.runIndex}" data-key="open-run">Open run</button>` : ''}</div>`
    : '';
  const panel = o.stack ? stackHtml(Object.assign({}, o.stack, { enter })) : `<ol class="rd-route-list sc-subs${enter ? ' is-enter' : ''}" aria-label="${esc(o.label)} steps" style="grid-column:1 / -1">${o.rows.map((r) => rowHtml(r)).join('')}</ol>`;
  const sel = (v.tabs.find((t) => t.sel) || v.tabs[0]).id;

  document.getElementById('card').innerHTML = `
  <div class="rc">
    <div class="rc-bar">${crumbs}${pager}<span class="rc-bar-end">${v.bar.pause ? `<button type="button" class="btn btn-sm" data-key="bar:pause"${scope}>${svg('pause', 14)}Pause</button>` : ''}${v.bar.stop ? `<button type="button" class="btn btn-sm btn-danger" data-key="bar:stop"${scope}>Stop</button>` : ''}<button type="button" class="btn btn-sm btn-icon" aria-label="More for this run" data-key="bar:more"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg></button></span></div>
    <div class="rc-head"><div class="rc-title-row"><h1 class="rc-heading${ui.titleOpen ? ' is-open' : ''}" title="${esc(v.title)}" data-title>${esc(v.title)}</h1>${v.kind ? `<span class="kind-chip">${esc(v.kind)}</span>` : ''}${placeLine ? '' : add}</div>${facts ? `<div class="rc-facts">${facts}</div>` : ''}${chipRow}</div>
    <section class="rc-card" aria-label="Run status">
      <div class="rc-zone"><span class="rc-rail">${statusDot(v)}</span><span class="rc-main rc-word">${esc(v.word)}</span>${action}${v.detail ? `<span class="rc-detail" title="${esc(v.detail)}">${esc(v.detail)}</span>` : ''}</div>
      <div class="rc-zone"><div class="rc-span"><div class="sc-track" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" aria-hidden="true">${track}</div><div class="sc-stages" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" role="tablist" aria-label="Stages">${stages}</div></div></div>
      <div class="rc-zone is-ruled" role="tabpanel" id="stage-panel" aria-labelledby="st-${o.key}">${head}${panel}</div>
      <div class="rc-zone is-ruled"><div class="rc-figs">${v.figs.map(figHtml).join('')}</div></div>
    </section>
    <div class="tabs rc-tabs" role="tablist" aria-label="Run detail">${v.tabs.map((t) => `<button type="button" class="tab" role="tab" id="tab-${t.id}" aria-controls="rtab-panel" aria-selected="${t.sel}" tabindex="${t.sel ? 0 : -1}" data-tab="${t.id}" data-key="tab:${t.id}">${esc(t.l)}${t.n ? `<span class="n">${esc(t.n)}</span>` : ''}</button>`).join('')}</div>
    <div class="rtab-panel" role="tabpanel" id="rtab-panel" aria-labelledby="tab-${sel}" tabindex="0">${panelHtml(v)}</div>
  </div>`;

  fitMenus();
  document.querySelector('.rc-tabs .tab[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (keep) {
    const el = keep === 'menu-first' ? document.querySelector('.menu .menu-item') : document.querySelector(`[data-key="${CSS.escape(keep)}"]`);
    el?.focus({ preventScroll: keep !== 'menu-first' && !keep.startsWith('act:') });
  }
}

// An open menu or picker stays inside the window: shifted back from whichever edge it would cross, 16px gutter.
function fitMenus() {
  const vw = document.documentElement.clientWidth;
  document.querySelectorAll('#card .menu').forEach((m) => {
    const r = m.getBoundingClientRect();
    let dx = r.right > vw - 16 ? vw - 16 - r.right : 0;
    if (r.left + dx < 16) dx = 16 - r.left;
    if (dx) m.style.transform = `translateX(${dx}px)`;
  });
}
const pick = document.getElementById('case');
const groups = [...new Set(M.cases.map((c) => c.group))];
pick.innerHTML = groups.map((g) => `<optgroup label="${g}">${M.cases.filter((c) => c.group === g).map((c) => `<option value="${c.id}"${c.id === ui.caseId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
pick.addEventListener('change', () => { ui = Object.assign(ui, { caseId: pick.value, open: null, ship: '', menu: '', tab: '', focus: '', chips: [], parent: null, back: null, titleOpen: false }); render(); });
function goMember(group, i) {
  Object.assign(ui, { caseId: M.view(group, {}).runCases[i], parent: { caseId: group, index: i }, open: null, tab: '', focus: '', menu: '', titleOpen: false });
  pick.value = ui.caseId; pendingFocus = 'crumb:' + (M.view(ui.caseId, ui).crumbs.length - 1);
}
function addChip(text) {
  const kind = ui.menu.slice(5); const t = String(text).trim();
  if (t && !ui.chips.some((c) => c.kind === kind && c.text === t)) ui.chips = ui.chips.concat({ kind, text: t });
  ui.menu = ''; pendingFocus = 'menu:add';
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (t && t.dataset.themePick) {
    document.documentElement.dataset.theme = t.dataset.themePick;
    document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    return;
  }
  if (!t && e.target.closest('[data-title]')) { ui.titleOpen = !ui.titleOpen; render(); return; }
  if (!t || !t.closest('#card')) { if (ui.menu && !e.target.closest('.menu')) { ui.menu = ''; render(); } return; }
  const d = t.dataset;
  if (d.menu) { const opening = ui.menu !== d.menu; ui.menu = opening ? d.menu : ''; if (opening) pendingFocus = 'menu-first'; }
  else if (d.menuPick) {
    if (ui.menu === 'add' && M.add.some((x) => x.kind === d.menuPick)) { ui.menu = 'pick-' + d.menuPick; pendingFocus = 'pick-input'; }
    else { pendingFocus = 'menu:' + ui.menu; ui.menu = ''; }
  } else if (d.suggest !== undefined) { addChip(d.suggest); }
  else if (d.openRun !== undefined) { ui.back = { caseId: ui.caseId, open: ui.open, tab: ui.tab }; goMember(ui.caseId, +d.openRun); }
  else if (d.sib !== undefined && d.sib !== '') { const v = M.view(ui.caseId, ui); goMember(v.parent.caseId, +d.sib); pendingFocus = t.dataset.key; }
  else if (d.crumb !== undefined) {
    // Up to the group: back where you left it if you came from there, else with this run's segment open.
    const go = M.view(ui.caseId, ui).crumbs[+d.crumb].go;
    const back = ui.back && ui.back.caseId === go.caseId ? ui.back : { caseId: go.caseId, open: go.open, tab: '' };
    Object.assign(ui, { caseId: back.caseId, open: back.open, tab: back.tab, parent: null, back: null, menu: '' });
    pick.value = ui.caseId; pendingFocus = 'open-run';
  } else if (d.unchip !== undefined) { ui.chips = ui.chips.filter((_, i) => i !== +d.unchip); ui.menu = ''; pendingFocus = 'menu:add'; }
  else if (d.stage) { ui.open = d.stage; ui.menu = ''; }
  else if (d.ship) ui.ship = d.ship;
  else if (d.tab) { ui.tab = d.tab; ui.focus = ''; if (t.classList.contains('rc-fig-link')) pendingFocus = 'tab:' + d.tab; }
  else if (d.ref) { ui.tab = 'activity'; ui.view = 'steps'; ui.focus = d.ref; pendingFocus = 'act:' + d.ref; render(); document.querySelector('.is-focus')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); return; }
  else if (d.view) ui.view = d.view;
  else { if (ui.menu) { ui.menu = ''; render(); } return; }
  render();
});

// Keys: tabs and stages move with arrows / Home / End and select as they move; the ship choice is a radio group;
// menus take ↑ ↓ Home End, and Escape or Tab close them with focus back on their trigger.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.key === 'pick-input' && e.key === 'Enter') { e.preventDefault(); addChip(t.value); render(); return; }
  if (ui.menu && (e.key === 'Escape' || (e.key === 'Tab' && t.closest && t.closest('.menu')))) {
    pendingFocus = ui.menu.startsWith('pick-') ? 'menu:add' : 'menu:' + ui.menu; ui.menu = ''; render(); if (e.key === 'Escape') e.preventDefault(); return;
  }
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
  if (!(e.key in keys) || !t.closest) return;
  const group = t.closest('.menu') ? [...t.closest('.menu').querySelectorAll('.menu-item')]
    : t.getAttribute('role') === 'tab' ? [...t.closest('[role="tablist"]').querySelectorAll('[role="tab"]')]
    : t.getAttribute('role') === 'radio' ? [...t.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]:not([disabled])')] : null;
  if (!group) return;
  if (t.getAttribute('role') === 'tab' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;   // tabs are horizontal
  e.preventDefault();
  const i = group.indexOf(t); const k = keys[e.key];
  const next = group[k === 'first' ? 0 : k === 'last' ? group.length - 1 : (i + k + group.length) % group.length];
  if (t.closest('.menu')) { next.focus(); return; }
  pendingFocus = next.dataset.key; next.click();
});
render();
