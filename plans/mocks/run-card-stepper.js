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
  after: P('M5 12h11M12 7l5 5-5 5M20 5v14'),
  folder: P('M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z'),
};
const svg = (name, size) => (ICON[name] ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>` : '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let ui = { caseId: 'working', open: null, chips: [], ship: '', menu: '', tab: '', focus: '', view: 'steps', parent: null, back: null, dialog: '', after: [], away: '', askEach: false, answer: null, file: null, actFilter: 'all', rounds: [], ticks: [], taskOpen: false };

function statusDot(v) {
  if (v.sym) {
    const g = v.sym === 'q' ? ICON.question : ICON.alert;
    return `<span class="status-dot ${v.sym === 'q' ? 'is-amber' : 'is-red'} has-sym" aria-hidden="true"><svg class="status-sym" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="currentColor" stroke="none"></circle><g fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${g}</g></svg></span>`;
  }
  return `<span class="status-dot ${v.dot}" aria-hidden="true"></span>`;
}
// A menu: an optional line on what the main action does, then each item with its one-line help.
// One compact menu everywhere, as the app's View menu: one line per item, a leading check for a choice, a hint on the
// right (a count or a shortcut), the help in the tooltip; danger items come last, after a rule.
function menu(id, items) {
  if (ui.menu !== id) return '';
  const danger = /^(Discard|Stop|Stop the run|Archive|Cancel|Cancel the rest)$/;
  let ruled = false;
  return `<div class="menu" role="menu">${items.map((it, i) => {
    if (it.sep) return '<div class="menu-sep" role="separator"></div>';
    if (it.header) return `<p class="menu-h">${esc(it.header)}</p>`;
    const bad = danger.test(it.text);
    const rule = bad && !ruled && i > 0 && !(items[i - 1] && items[i - 1].sep) ? '<div class="menu-sep" role="separator"></div>' : '';
    if (bad) ruled = true;
    const role = it.checked === undefined ? 'menuitem' : 'menuitemradio';
    return `${rule}<button type="button" class="menu-item${bad ? ' is-danger' : ''}" role="${role}"${it.checked === undefined ? '' : ` aria-checked="${!!it.checked}"`} data-menu-pick="${esc(it.id || it.text)}"${it.help ? ` title="${esc(it.help)}"` : ''}><span class="mi-l">${esc(it.text)}</span>${it.hint ? `<span class="mi-hint">${esc(it.hint)}</span>` : ''}</button>`;
  }).join('')}</div>`;
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
  const loops = !r.loops ? '' : r.roundsKey ? `<button type="button" class="sc-loop is-btn" aria-expanded="${!!r.roundsOpen}" data-rounds="${esc(r.roundsKey)}" data-key="rounds:${esc(r.roundsKey)}" title="${r.roundsOpen ? 'Hide' : 'Show'} the ${r.loops} rounds">${svg('refresh', 11)}${r.loops}</button>`
    : `<span class="sc-loop" title="Ran ${r.loops} times">${svg('refresh', 11)}${r.loops}</span>`;
  const log = full && !/is-next/.test(r.rowCls) && !r.evidence ? `<button type="button" class="btn btn-sm btn-quiet rtab-log" data-key="log:${esc(r.akey)}" data-say="Opens the log of ${esc(r.name)}">Log</button>` : '';
  const rest = `<span class="sc-rest"><span class="sc-loops">${loops}</span>${full ? `<span class="sc-model">${esc(r.model || '')}</span><span class="sc-cost">${esc(r.cost || '')}</span><span class="sc-act">${log}</span>` : ''}</span>`;
  // A failed or blocked step shows what broke, its last lines and a way into the log, in Activity only.
  const ev = r.evidence ? `<div class="rtab-ev"><p class="rtab-ev-t">${esc(r.evidence.title)}</p><pre class="rtab-ev-l">${r.evidence.lines.map(esc).join('\n')}</pre><button type="button" class="btn btn-sm rtab-ev-btn" data-key="log:${esc(r.akey)}" data-say="${esc(r.evidence.log)}: opens the log there">${esc(r.evidence.log)}</button></div>` : '';
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

// The tabs under the card: one question each, each fact in one place. Overview leads with what this state needs from
// you; Changes is the diff by folder; Activity is every step with its rounds, model, cost and log; Decisions is who
// decided what. Time, cost against the budget and the diff size stay the card's figures.
const ICON_WHO = { you: P('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z') + P('M4.5 20a7.5 7.5 0 0 1 15 0'), away: P('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'), default: P('M12 3v4M12 17v4M3 12h4M17 12h4') };
const WHO = { you: 'You', away: 'Answered for you · Away mode', default: 'Worca’s default' };
function focusHtml(v) {
  const f = v.over.focus;
  if (!f) return '';
  if (f.kind === 'ask') {
    const pick = ui.answer === undefined || ui.answer === null ? f.pick : ui.answer;
    return `<section class="rtab ov-focus is-ask${ui.flash ? ' is-flash' : ''}" id="ov-focus"><h2 class="rtab-h">Worca asks${f.n ? ` <span class="n">${esc(f.n)}</span>` : ''}</h2>
      <p class="ov-q">${esc(f.q)}</p><p class="rtab-dim rtab-p">${esc(f.why)}</p>
      <div class="qopts" role="radiogroup" aria-label="${esc(f.q)}">${f.options.map((o, i) => `<button type="button" class="qopt${i === pick ? ' sel' : ''}" role="radio" aria-checked="${i === pick}" tabindex="${i === pick ? 0 : -1}" data-answer="${i}" data-key="answer:${i}"><span class="sk-opt"><span class="sk-opt-l">${esc(o)}${i === f.pick ? '<span class="qrec">Worca’s pick</span>' : ''}</span></span></button>`).join('')}</div>
      <input class="input input-sm" type="text" placeholder="Or write your own answer" aria-label="Your own answer" data-key="answer-own">
      <div class="ov-acts"><button type="button" class="btn btn-sm btn-primary" data-key="answer-send" data-act="Answer">Send answer</button><span class="rtab-dim">The run goes on from ${esc(v.open.label)} as soon as you send</span></div></section>`;
  }
  if (f.kind === 'plan') {
    return `<section class="rtab ov-focus${ui.flash ? ' is-flash' : ''}" id="ov-focus"><h2 class="rtab-h">The plan <span class="n">${f.items.length} steps</span></h2>
      <ol class="ov-plan">${f.items.map((x, i) => `<li><span class="ov-n">${i + 1}</span><span>${esc(x.t)}</span></li>`).join('')}</ol>
      <h3 class="ov-sub is-warn">${f.issues.length} open issues</h3><ul class="rtab-list">${f.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="ov-acts"><button type="button" class="btn btn-sm btn-primary" data-key="plan-approve" data-act="Approve and build">Approve and build</button><button type="button" class="btn btn-sm" data-key="plan-change" data-act="Ask for changes">Ask for changes</button><button type="button" class="btn btn-sm btn-quiet" data-key="plan-full" data-act="Full plan">Full plan</button></div></section>`;
  }
  if (f.kind === 'broke') {
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">What broke</h2>
      <div class="rtab-ev"><p class="rtab-ev-t">${esc(f.ev.title)}</p><pre class="rtab-ev-l">${f.ev.lines.map(esc).join('\n')}</pre><button type="button" class="btn btn-sm rtab-ev-btn" data-key="ov-log" data-say="${esc(f.ev.log)}: opens the log there">${esc(f.ev.log)}</button></div>
      ${f.next ? `<p class="rtab-dim rtab-p">${esc(f.next)} is the card’s action: ${esc((v.action || {}).help || '')}.</p>` : ''}</section>`;
  }
  const rows = f.items.map((x, i) => {
    const st = typeof x === 'string' ? (ui.ticks.includes(i) ? 'done' : 'next') : x.state;
    const t = typeof x === 'string' ? x : x.t;
    if (f.kind === 'check') return `<li><label class="ov-check"><input type="checkbox" data-tick="${i}" data-key="tick:${i}"${st === 'done' ? ' checked' : ''}><span>${esc(t)}</span></label></li>`;
    return `<li class="rd-route-row is-${st}"><span class="rd-route-dot ${st === 'done' ? 'is-done' : st === 'now' ? 'is-working is-pulse' : 'is-future'}" role="img" aria-label="${st === 'done' ? 'Done' : st === 'now' ? 'In progress' : 'Not yet'}">${svg(st === 'done' ? 'check' : st === 'now' ? 'now' : '', 10)}</span><span class="rd-route-name">${esc(t)}</span></li>`;
  }).join('');
  if (f.kind === 'check') {
    const n = f.items.length - ui.ticks.length;
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">${esc(f.title)} <span class="n">${n ? n + ' to check' : 'all checked'}</span></h2><ul class="ov-checks">${rows}</ul></section>`;
  }
  const done = f.items.filter((x) => x.state === 'done').length;
  return `<section class="rtab ov-focus is-progress" id="ov-focus"><h2 class="rtab-h">The plan <span class="n">${done} of ${f.items.length} done</span></h2><ol class="rd-route-list ov-progress">${rows}</ol></section>`;
}
function summaryPanel(v) {
  const o = v.over;
  const did = o.outcome.length ? `<section class="rtab"><h2 class="rtab-h">What it did</h2><ul class="ov-did">${o.outcome.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>` : '';
  const asked = `<section class="rtab"><h2 class="rtab-h">What you asked</h2><p class="rtab-p ov-task${ui.taskOpen ? ' is-open' : ''}">${esc(o.task)}</p></section>`;
  const where = o.areas.length ? `<section class="rtab"><h2 class="rtab-h">Where it changed <button type="button" class="btn btn-sm btn-quiet ov-more" data-tab="changes" data-key="ov-changes">All ${v.tabData.files.length} files</button></h2>
    <ul class="ov-areas">${o.areas.map((x) => `<li><code>${esc(x.dir)}</code><span class="rtab-dim">${x.n} ${x.n === 1 ? 'file' : 'files'}</span><span class="ov-bar" aria-hidden="true"><i class="add" style="width:${Math.round(x.pct * x.add / (x.add + x.del))}%"></i><i class="del" style="width:${Math.round(x.pct * x.del / (x.add + x.del))}%"></i></span><span class="ct"><span class="add">+${x.add}</span><span class="del">−${x.del}</span></span></li>`).join('')}</ul></section>` : '';
  const arts = o.artifacts.length ? `<section class="rtab"><h2 class="rtab-h">Artifacts <span class="n">${o.artifacts.length}</span></h2><ul class="ov-arts">${o.artifacts.map(([f, step], i) => `<li><code title="${esc(f)}">${esc(f)}</code><span class="rtab-dim">${esc(step)}</span><button type="button" class="btn btn-sm btn-quiet" data-key="art:${i}" data-say="Opens ${esc(f)}" aria-label="Open ${esc(f)}">Open</button></li>`).join('')}</ul></section>` : '';
  const after = ui.after.length ? `<section class="rtab"><h2 class="rtab-h">Runs after this <span class="n">${ui.after.length}</span></h2><ul class="ov-arts">${ui.after.map((x, i) => `<li><span class="ov-after-t" title="${esc(x.task)}">${esc(x.task)}</span><span class="rtab-dim">${esc(x.when)}</span><button type="button" class="btn btn-sm btn-quiet" data-unafter="${i}" data-key="unafter:${i}">Cancel</button></li>`).join('')}</ul></section>` : '';
  return focusHtml(v) + after + did + asked + where + arts;
}
function changesPanel(v) {
  const d = v.tabData; const f = d.files;
  const add = f.reduce((a, x) => a + x[1], 0); const del = f.reduce((a, x) => a + x[2], 0);
  const groups = [];
  f.forEach(([p, a, dl], i) => { const dir = p.slice(0, p.lastIndexOf('/') + 1); let g = groups.find((x) => x.dir === dir); if (!g) groups.push(g = { dir, rows: [] }); g.rows.push({ p, name: p.slice(dir.length), a, dl, i }); });
  const blocks = (a, dl) => { const n = Math.min(5, Math.max(1, Math.round((a + dl) / 40))); const ga = Math.round(n * a / (a + dl || 1)); return Array.from({ length: 5 }, (_, k) => `<i class="${k < ga ? 'add' : k < n ? 'del' : ''}"></i>`).join(''); };
  const open = ui.file === undefined || ui.file === null ? -1 : ui.file;
  const rows = groups.map((g) => `<li class="ch-dir"><code>${esc(g.dir)}</code><span class="rtab-dim">${g.rows.length}</span></li>` + g.rows.map((r) => {
    const m = d.fileMeta[r.p] || { st: 'M' };
    const diff = open === r.i ? `<div class="ch-diff"><p class="ch-at">${esc(d.hunk.at)}</p><pre>${d.hunk.lines.map(([k, t]) => `<span class="${k === '+' ? 'add' : k === '-' ? 'del' : ''}">${esc(k + ' ' + t)}</span>`).join('\n')}</pre><button type="button" class="btn btn-sm" data-key="file-full" data-say="Opens the whole diff of the file">Open the whole diff</button></div>` : '';
    return `<li class="ch-file${open === r.i ? ' is-open' : ''}"><button type="button" class="ch-row" aria-expanded="${open === r.i}" data-file="${r.i}" data-key="file:${r.i}"><span class="ch-st is-${m.st}" title="${m.st === 'A' ? 'Added' : 'Modified'}">${m.st}</span><span class="ch-name" title="${esc(r.p)}">${esc(r.name)}</span>${m.notes ? `<span class="ch-notes" title="${m.notes} review comments">${m.notes}</span>` : '<span class="ch-notes"></span>'}<span class="ct"><span class="add">+${r.a}</span><span class="del">−${r.dl}</span></span><span class="ch-blocks" aria-hidden="true">${blocks(r.a, r.dl)}</span></button>${diff}</li>`;
  }).join('')).join('');
  const where = v.place.folder ? `In a copy of ${v.place.folder}; Apply writes them into the folder.` : v.place.branch ? `${v.place.branch} into ${v.place.base || 'dev'}` : '';
  const tools = v.place.folder ? '' : `<div class="ch-tools">${v.bar.stop ? '<button type="button" class="btn btn-sm btn-quiet" data-key="ch:refresh" data-say="Diff refreshed from the worktree">Refresh</button>' : ''}<button type="button" class="btn btn-sm" data-key="ch:checkout" data-say="Checked out the branch on this machine">Check out</button><button type="button" class="btn btn-sm btn-quiet" data-key="ch:patch" data-say="Downloading run.patch">Download patch</button><button type="button" class="btn btn-sm btn-quiet" data-key="ch:copy" data-say="Copied: git fetch && git switch ${esc(v.place.branch || '')}">Copy git commands</button></div>`;
  return tools + `<section class="rtab"><div class="ch-head"><h2 class="rtab-h">${f.length} files <span class="ct"><span class="add">+${add}</span><span class="del">−${del}</span></span></h2><span class="rtab-dim" title="${esc(where)}">${esc(where)}</span></div>
    <ul class="ch-list">${rows}</ul></section>`;
}
function activityPanel(v) {
  const only = ui.actFilter === 'problems';
  const seg = `<div class="seg" role="group" aria-label="Show"><button type="button" data-filter="all" data-key="filter:all" aria-pressed="${!only}">All steps</button><button type="button" data-filter="problems" data-key="filter:problems" aria-pressed="${only}">Problems and questions</button></div>`;
  const total = v.activity.reduce((a, st) => a + (parseFloat(String(st.meta).replace(/[^0-9.]/g, '')) || 0), 0) || 1;
  // One list for the whole tab, stage headings as full-width rows, so every step on the tab shares the same columns.
  // A step that ran more than once opens its rounds: how long each took and why it went round again.
  const rows = v.activity.map((st) => {
    const steps = st.rows.filter((r) => !only || /is-(ask|problem|failed)/.test(r.rowCls));
    if (only && !steps.length) return '';
    const cost = parseFloat(String(st.meta).replace(/[^0-9.]/g, '')) || 0;
    const head = `<li class="sc-stage-row"><h2 class="rtab-h">${esc(st.label)}${st.title ? ' · ' + esc(st.title) : ''}${st.meta ? ` <span class="rtab-dim">${esc(st.meta)}</span>` : ''}${cost ? `<span class="ac-share" title="${Math.round(cost / total * 100)}% of the cost" aria-hidden="true"><i style="width:${Math.round(cost / total * 100)}%"></i></span>` : ''}</h2></li>`;
    return head + steps.map((r) => {
      const rd = v.rounds[r.name];
      const key = st.key + '/' + r.name;
      const isOpen = rd && ui.rounds.includes(key);
      const row = rowHtml(Object.assign({}, r, { ref: '', akey: r.ref, roundsKey: rd && r.loops ? key : '', roundsOpen: isOpen }), true);
      const sub = isOpen ? rd.map(([t, why], i) => `<li class="rd-route-row sc-row is-round"><span class="ac-round-n" aria-hidden="true">${i + 1}</span><span class="sc-name ac-why">${esc(why)}</span><span class="sc-time">${esc(t)}</span><span class="sc-rest"></span></li>`).join('') : '';
      return row + sub;
    }).join('');
  }).join('');
  return `<div class="rtab-bar">${seg}<button type="button" class="btn btn-sm btn-quiet" data-key="graph" data-say="Opens the run graph, centred on the live step">Open the graph</button></div><section class="rtab rtab-stage"><ol class="rd-route-list sc-subs is-full" aria-label="Steps">${rows || '<li class="sc-stage-row"><p class="rtab-dim rtab-p">No problems or questions in this run.</p></li>'}</ol></section>`;
}
function decisionsPanel(v) {
  const ds = v.tabData.decisions;
  const by = (w) => ds.filter((x) => x.who === w).length;
  const ask = v.over.focus && v.over.focus.kind === 'ask' ? v.over.focus : null;
  const sum = [by('you') ? by('you') + ' by you' : '', by('away') ? by('away') + ' by Away mode' : '', by('default') ? by('default') + ' by default' : ''].filter(Boolean).join(' · ');
  const waiting = ask ? `<li class="rd-route-row is-ask"><span class="rd-route-dot is-problem" role="img" aria-label="Waiting for you">${svg('question', 10)}</span><div class="dc-body"><p class="rtab-q">${esc(ask.q)}</p><p class="rtab-dim">Waiting for you · <button type="button" class="dc-link" data-tab="summary" data-key="dc-answer">Answer in Overview</button></p></div></li>` : '';
  return `<section class="rtab"><div class="ch-head"><h2 class="rtab-h">${ds.length} decisions</h2><span class="rtab-dim">${esc(sum)}</span></div>
    <ol class="rd-route-list dc-list">${waiting}${ds.map((x) => `<li class="rd-route-row is-done"><span class="rd-route-dot dc-who is-${x.who}" role="img" aria-label="${esc(WHO[x.who])}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_WHO[x.who]}</svg></span><div class="dc-body"><p class="rtab-q">${esc(x.q)}</p><p class="dc-a">${esc(x.a)}</p><p class="rtab-dim">${esc([x.step, WHO[x.who], x.note, x.when].filter(Boolean).join(' · '))}</p></div></li>`).join('')}</ol></section>`;
}
function runsPanel(v) {
  return `<ul class="rtab-dec is-runs">${v.runs.map((r) => `<li><span class="status-dot ${r.dot}${/peach/.test(r.dot) ? ' is-pulse' : ''}" aria-hidden="true"></span><span class="rtab-q" title="${esc(r.title)}">${esc(r.title)}</span><span class="rtab-dim">${esc([r.word, r.time, r.cost, r.pr].filter(Boolean).join(' · '))}</span>${r.canOpen ? `<button type="button" class="btn btn-sm btn-quiet" data-open-run="${r.n - 1}" data-key="run:${r.n - 1}" aria-label="Open run ${r.n}: ${esc(r.title)}">Open</button>` : ''}</li>`).join('')}</ul>`;
}
function panelHtml(v) {
  const id = (v.tabs.find((t) => t.sel) || v.tabs[0]).id;
  return ({ summary: summaryPanel, changes: changesPanel, activity: activityPanel, decisions: decisionsPanel, runs: runsPanel })[id](v);
}
function figHtml(f, v) {
  if (f.k === 'Cost' && v) {
    const rows = v.activity.filter((st) => st.meta).map((st) => `<li><span>${esc(st.label)}</span><span class="ct">${esc(st.meta)}</span></li>`).join('');
    return `<span class="rc-pop"><button type="button" class="rc-fig-link" data-menu="cost" data-key="menu:cost" aria-haspopup="dialog" aria-expanded="${ui.menu === 'cost'}" title="${esc(f.title || '')}">${esc(f.k)} <b>${esc(f.v)}</b></button>${f.of ? `<span class="rc-of${f.warn ? ' is-warn' : ''}">${esc(f.of)}</span>` : ''}${ui.menu === 'cost' ? `<div class="menu rc-cost" role="dialog" aria-label="Cost by stage"><p class="menu-h">Cost by stage</p><ul>${rows}<li class="is-total"><span>Total</span><span class="ct">${esc(f.v)}</span></li></ul><p class="menu-help">${esc(f.title || '')}. Each step’s cost and model are in Activity.</p></div>` : ''}</span>`;
  }
  if (f.tab) return `<button type="button" class="rc-fig-link" data-tab="${f.tab}" data-key="fig:${f.tab}" title="Open Changes"${ui.tab === f.tab ? ' aria-current="true"' : ''}>${esc(f.k)}<b>${esc(f.v)}</b></button>`;
  return `<span${f.title ? ` title="${esc(f.title)}"` : ''}>${esc(f.k)} <b>${esc(f.v)}</b>${f.of ? `<span class="rc-of${f.warn ? ' is-warn' : ''}">${esc(f.of)}</span>` : ''}</span>`;
}

function render() {
  const keep = pendingFocus || document.activeElement?.dataset?.key || '';
  pendingFocus = '';
  const v = M.view(ui.caseId, ui);
  const a = v.action;
  const action = a ? `<div class="rc-side"><div class="btn-split rc-action rc-pop is-right"><button type="button" class="btn btn-sm ${a.primary ? 'btn-primary' : ''}" title="${esc(a.help)}" data-key="act-main">${svg(a.icon, 14)}${esc(a.label)}</button>${a.items.length ? `<button type="button" class="btn btn-sm btn-icon ${a.primary ? 'btn-primary' : ''}" aria-label="More actions" aria-haspopup="menu" aria-expanded="${ui.menu === 'act'}" data-menu="act" data-key="menu:act">${svg('chevron', 14)}</button>${menu('act', a.items)}` : ''}</div></div>` : '';
  // Many labels and tags, one group: a run already in a feature or chain, or a group page, joins none; a run you
  // grouped can leave it again from the same menu.
  const addable = M.add.filter((x) => x.kind !== 'group' || (!v.inGroup && !v.addedGroup))
    .map((x) => ({ id: x.kind, text: x.menu, help: x.help }))
    .concat(v.addedGroup ? [{ id: 'ungroup', text: 'Leave ' + v.addedGroup, help: 'The run leaves the group; its labels and tags stay' }] : []);
  // The place line: branch → base with copy, or the folder, or the repositories; the PR once it exists. The branch
  // loses its middle, never its end, so sibling runs (-2, -3) stay apart.
  const pl = v.place;
  const mid = (t) => { const k = Math.max(t.lastIndexOf('-'), t.lastIndexOf('/')); const cut = k > 0 && t.length - k <= 16 ? k : Math.max(0, t.length - 12); return `<code class="rc-mid" title="${esc(t)}"><span class="rc-mid-a">${esc(t.slice(0, cut))}</span><span class="rc-mid-b">${esc(t.slice(cut))}</span></code>`; };
  const where = pl.folder ? `<span class="rc-place">${mid(pl.folder)}</span>`
    : pl.branch ? `<span class="rc-place">${mid(pl.branch)}${pl.copy ? `<button type="button" class="btn btn-sm btn-quiet btn-icon" aria-label="Copy branch name" data-key="copy" data-say="Copied ${esc(pl.branch)}">${svg('copy', 12)}</button>` : ''}${pl.base ? `<span class="rc-to" aria-label="into">→</span><code class="rc-base">${esc(pl.base)}</code>` : ''}</span>` : '';
  const repos = pl.repos.length ? `<span>${pl.repos.length} repositories</span>` : '';
  const pr = pl.pr ? `<a class="rc-pr" href="#" data-key="pr" data-say="Opens ${esc(pl.pr)} on GitHub" title="Open ${esc(pl.pr)} on GitHub">${esc(pl.pr)}</a>` : '';
  // + stays at the end of the place line; labels and tags, once added, get their own wrapping row under it.
  const chipRow = v.chips.length ? `<div class="rc-chips">${ui.chips.map((c, i) => (c.kind === 'group' ? '' : chip(c, i))).join('')}</div>` : '';
  const kind = v.kind ? `<span class="kind-chip">${esc(v.kind)}</span>` : '';
  const placeLine = [kind, where, repos, pr].filter(Boolean).join('<span class="rc-sep" aria-hidden="true">·</span>');
  const add = (addable.length ? `<span class="rc-pop"><button type="button" class="btn btn-sm btn-quiet btn-icon rc-add" aria-label="Add a label, cost tag or group" aria-haspopup="menu" aria-expanded="${ui.menu === 'add' || ui.menu.startsWith('pick-')}" data-menu="add" data-key="menu:add">${svg('plus', 14)}</button>${ui.menu.startsWith('pick-') ? pickerHtml(ui.menu.slice(5)) : menu('add', addable)}</span>` : '');
  const facts = placeLine + add;
  // Where you are: Runs › place › group, the page itself never a crumb; on a narrow card only the parent, as ‹ Parent.
  const crumbs = `<nav class="rc-crumbs" aria-label="Breadcrumb"><ol>${v.crumbs.map((c, i) => `<li${i === v.crumbs.length - 1 ? ' class="is-parent"' : ''}>${c.go ? `<button type="button" class="rc-crumb" data-crumb="${i}" data-key="crumb:${i}" title="${esc(c.t)}">${esc(c.t)}</button>` : `<a class="rc-crumb" href="#" data-key="crumb:${i}" data-say="Goes to ${esc(i ? (c.group ? 'the ' + c.t + ' group' : c.t + ' runs') : 'the Runs list')}" title="${esc(c.t)}">${esc(c.t)}</a>`}</li>`).join('')}</ol></nav>`;
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
    <div class="rc-bar">${crumbs}${pager}<span class="rc-bar-end"><span class="rc-pop is-right"><button type="button" class="btn btn-sm btn-icon" aria-label="More for this run" aria-haspopup="menu" aria-expanded="${ui.menu === 'more'}" data-menu="more" data-key="menu:more"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg></button>${menu('more', moreItems(v))}</span></span></div>
    ${stripHtml(v)}
    <div class="rc-head"><div class="rc-title-row"><h1 class="rc-heading${ui.titleOpen ? ' is-open' : ''}" title="${esc(v.title)}" data-title>${esc(v.title)}</h1></div>${facts ? `<div class="rc-facts">${facts}</div>` : ''}${chipRow}</div>
    <section class="rc-card" aria-label="Run status">
      <div class="rc-zone"><span class="rc-rail">${statusDot(v)}</span><span class="rc-main rc-word">${esc(v.word)}</span>${action}${v.detail ? `<span class="rc-detail" title="${esc(v.detail)}">${esc(v.detail)}</span>` : ''}</div>
      <div class="rc-zone"><div class="rc-span"><div class="sc-track" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" aria-hidden="true">${track}</div><div class="sc-stages" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" role="tablist" aria-label="Stages">${stages}</div></div></div>
      <div class="rc-zone is-ruled" role="tabpanel" id="stage-panel" aria-labelledby="st-${o.key}">${head}${panel}</div>
      <div class="rc-zone is-ruled"><div class="rc-figs">${v.figs.map((f) => figHtml(f, v)).join('')}</div></div>
    </section>
    <div class="tabs rc-tabs" role="tablist" aria-label="Run detail">${v.tabs.map((t) => `<button type="button" class="tab" role="tab" id="tab-${t.id}" aria-controls="rtab-panel" aria-selected="${t.sel}" tabindex="${t.sel ? 0 : -1}" data-tab="${t.id}" data-key="tab:${t.id}">${esc(t.l)}${t.n ? `<span class="n">${esc(t.n)}</span>` : ''}</button>`).join('')}</div>
    <div class="rc-toast${ui.toast ? ' is-on' : ''}" role="status" aria-live="polite">${esc(ui.toast || '')}</div>
    <div class="rtab-panel" role="tabpanel" id="rtab-panel" aria-labelledby="tab-${sel}" tabindex="0">${panelHtml(v)}</div>
  </div>`;

  fitMenus();
  const nx = document.getElementById('next-event'); if (nx) { const to = (M.flow[ui.caseId] || {}).next; nx.disabled = !to; nx.title = to ? 'Event: ' + EVENT[ui.caseId] : 'Nothing outside the run happens next here; use the card'; }
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
document.addEventListener('submit', (e) => e.preventDefault());
document.addEventListener('input', (e) => { if (e.target.id === 'after-task') ui.afterDraft = e.target.value; });
const pick = document.getElementById('case');
const groups = [...new Set(M.cases.map((c) => c.group))];
pick.innerHTML = groups.map((g) => `<optgroup label="${g}">${M.cases.filter((c) => c.group === g).map((c) => `<option value="${c.id}"${c.id === ui.caseId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
pick.addEventListener('change', () => { ui = Object.assign(ui, { caseId: pick.value, open: null, ship: '', menu: '', tab: '', focus: '', chips: (M.cases.find((c) => c.id === pick.value) || {}).chips || [], toast: '', confirm: null, dialog: '', after: [], away: '', askEach: false, parent: null, back: null, titleOpen: false, answer: null, file: null, rounds: [], ticks: [], actFilter: 'all' }); render(); });
// The prototype's flow (RunCardModel.flow): an action moves the run to its next case or does its job in place and
// says so in the toast; a destructive or outward one (Stop, Discard, Merge, Apply) asks first in a confirm strip.
const AWAY = [{ id: 'away:auto', text: 'As set up', help: 'Follows Settings and whether you marked this run' }, { id: 'away:on', text: 'Answer for me', help: 'Worca answers this run’s questions from now on, at any hour' }, { id: 'away:off', text: 'Never', help: 'Worca never answers on this run, whatever the settings' }];
function moreItems(v) {
  const group = !!v.kind; const live = v.bar.stop;
  const items = [];
  if (live && !group) items.push({ header: 'Away mode' }, ...AWAY.map((x) => Object.assign({ checked: (ui.away || 'away:auto') === x.id }, x)), { sep: true });
  if (group) items.push({ header: 'Next run' }, { id: 'group:go', text: 'Starts by itself', checked: !ui.askEach, help: 'Each run starts when the one before it is ready' },
    { id: 'group:ask', text: 'Asks me first', checked: !!ui.askEach, help: 'Stops for your OK before the next run starts' }, { sep: true },
    { id: 'group:replan', text: 'Re-plan the rest', help: 'The planner re-cuts the runs that have not started' }, { id: 'group:plan', text: 'Open the plan', help: 'The plan and how it was cut into runs' }, { sep: true });
  if (v.runAfter) items.push({ id: 'more:after', text: v.runAfter.label, help: v.runAfter.help });
  if (!group) items.push({ id: 'more:preset', text: 'Save as preset', help: 'Starts the next run with this task’s setup' });
  items.push({ id: 'more:terminal', text: 'Terminal', hint: 'Ctrl+`', help: 'A shell in this run’s worktree' }, { id: 'more:link', text: 'Copy link', help: 'Paste it in Chat or an issue' });
  if (v.finished && !v.archived) items.push({ id: 'more:report', text: 'Report this run', help: 'Sends the logs and a note to the Worca team' }, { id: 'more:archive', text: 'Archive', help: 'Removes the branch, worktree and logs; the remote branch and PR stay' });
  if (v.archived) items.push({ id: 'more:restore', text: 'Restore', help: 'Brings the run back to Runs' });
  if (group) items.push({ id: 'group:cancel', text: 'Cancel the rest', help: 'Runs that have not started are dropped' });
  return items;
}
const MORE_SAY = { 'more:link': 'Copied the link to this run', 'more:preset': 'Saved as preset “Unified page navigation”', 'more:terminal': 'Terminal opened in the worktree', 'more:report': 'Report sent with the logs',
  'group:replan': 'The planner is re-cutting runs 3 and on', 'group:plan': 'Opens plan.md' };
let toastTimer = 0;
function toast(text) { ui.toast = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = ''; const el = document.querySelector('.rc-toast'); if (el) { el.classList.remove('is-on'); el.textContent = ''; } }, 4000); }
function goCase(id) {
  Object.assign(ui, { caseId: id, open: null, ship: '', menu: '', tab: '', focus: '', parent: null, back: null, titleOpen: false, answer: null, file: null, rounds: [], ticks: [], actFilter: 'all', confirm: null, dialog: '' });
  pick.value = id; pendingFocus = 'act-main';
}
function follow(f, label) {
  if (f.dialog && ui.dialog !== f.dialog) { ui.dialog = f.dialog; ui.dialogLabel = label; ui.dialogF = f; ui.menu = ''; pendingFocus = f.dialog + '-title'; return; }
  ui.dialog = '';
  if (f.confirm && !(ui.confirm && ui.confirm.ok)) {
    ui.confirm = { text: f.confirm, yes: label.replace(/ the run$/, '') || 'Confirm', danger: /^(Stop|Discard)/.test(label), f, label }; ui.menu = ''; pendingFocus = 'confirm:yes'; return;
  }
  ui.confirm = null; ui.menu = '';
  if (f.to) { goCase(f.to); toast(f.say || 'Now: ' + M.view(f.to, {}).word); } else { toast(f.say); pendingFocus = pendingFocus || 'act-main'; }
}
function act(label) {
  const run = { Pause: 'pauseNow', 'Pause after this step': 'pauseAfter', 'Stop the run': 'stop' }[label];
  if (run) { follow(M.runFlow[run], label === 'Stop the run' ? 'Stop the run' : 'Pause'); return; }
  if (label === 'Try it') { toast(M.view(ui.caseId, ui).tryIt); ui.menu = ''; pendingFocus = 'act-main'; return; }
  const f = (M.flow[ui.caseId] || {})[label];
  if (f) follow(f, label); else toast(label + ': done');
}
const EVENT = { starting: 'Plan is under way', working: 'Review passed', checks: '2 checks failed', failing: 'dev moved on: 2 files conflict', conflicts: 'Checks green, a reviewer approved', feature: 'Runs 2 and 3 finished' };
function nextEvent() { const to = (M.flow[ui.caseId] || {}).next; if (!to) return; const say = EVENT[ui.caseId]; goCase(to); toast('Event: ' + say); render(); }
// The page asks you something in one place, under the bar: confirm a step that cannot be taken back, schedule a run
// after this one, or set up the PR before it opens.
function stripHtml(v) {
  const acts = (yes, cls) => `<span class="rc-confirm-acts"><button type="button" class="btn btn-sm ${cls}" data-confirm="yes" data-key="confirm:yes">${esc(yes)}</button><button type="button" class="btn btn-sm btn-quiet" data-confirm="no" data-key="confirm:no">Cancel</button></span>`;
  if (ui.dialog === 'after') {
    const opts = v.finished ? ['Now, as a follow-up'] : ['When this run finishes'].concat(v.place.pr ? ['When its PR merges'] : []);
    return `<form class="rc-confirm is-form" role="dialog" aria-labelledby="rc-strip-t" data-form="after"><span class="rc-confirm-t" id="rc-strip-t">${esc(v.runAfter.label)}</span>
      <input class="input input-sm" id="after-task" type="text" placeholder="What should the next run do?" aria-label="Task for the next run" data-key="after-task" value="${esc(ui.afterDraft || '')}">
      ${opts.length > 1 ? `<select class="select input-sm" id="after-when" aria-label="When it starts" data-key="after-when">${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : `<span class="rtab-dim" id="after-when-t">${esc(opts[0])}</span>`}${acts(v.finished ? 'Start run' : 'Schedule', 'btn-primary')}</form>`;
  }
  if (ui.dialog === 'pr') {
    return `<form class="rc-confirm is-form" role="dialog" aria-labelledby="rc-strip-t" data-form="pr"><span class="rc-confirm-t" id="rc-strip-t">${esc(ui.dialogLabel)}</span>
      <input class="input input-sm" id="pr-title" type="text" aria-label="PR title" value="${esc(v.title)}" data-key="pr-title">
      <label class="rc-check"><input type="checkbox" id="pr-draft" data-key="pr-draft"> Draft</label><label class="rc-check"><input type="checkbox" id="pr-watch" checked data-key="pr-watch"> Watch: fix failing checks</label>
      <span class="rtab-dim">Into ${esc(v.place.base || 'dev')}</span>${acts(ui.dialogLabel, 'btn-primary')}</form>`;
  }
  if (ui.confirm) return `<div class="rc-confirm" role="alertdialog" aria-labelledby="rc-strip-t"><span class="rc-confirm-t" id="rc-strip-t">${esc(ui.confirm.text)}</span>${acts(ui.confirm.yes, ui.confirm.danger ? 'btn-danger' : 'btn-primary')}</div>`;
  return '';
}
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
  if (t && t.id === 'next-event') { nextEvent(); return; }
  if (t && t.id === 'restart') { goCase('starting'); ui.chips = []; toast('Restarted: a new run'); render(); return; }
  if (t && t.dataset.themePick) {
    document.documentElement.dataset.theme = t.dataset.themePick;
    document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    return;
  }
  const sayEl = e.target.closest('#card [data-say]');
  if (sayEl) { e.preventDefault(); toast(sayEl.dataset.say); pendingFocus = sayEl.dataset.key || ''; ui.menu = ''; render(); return; }
  const tick = e.target.closest('[data-tick]');
  if (tick) { const i = +tick.dataset.tick; ui.ticks = tick.checked ? ui.ticks.concat(i) : ui.ticks.filter((x) => x !== i); pendingFocus = 'tick:' + i; render(); return; }
  if (!t && e.target.closest('[data-title]')) { ui.titleOpen = !ui.titleOpen; render(); return; }
  if (!t || !t.closest('#card')) { if (ui.menu && !e.target.closest('.menu')) { ui.menu = ''; render(); } return; }
  const d = t.dataset;
  if (d.confirm && ui.dialog === 'after') {
    if (d.confirm === 'yes') { const task = (document.getElementById('after-task')?.value || '').trim() || 'Follow-up to ' + M.view(ui.caseId, ui).title; const when = document.getElementById('after-when')?.value || document.getElementById('after-when-t')?.textContent || '';
      ui.after = ui.after.concat({ task, when }); toast((when.startsWith('Now') ? 'Started: ' : 'Scheduled: ') + task + (when.startsWith('Now') ? '' : ' · ' + when.toLowerCase())); }
    ui.dialog = ''; ui.afterDraft = ''; pendingFocus = 'menu:more';
  }
  else if (d.confirm && ui.dialog === 'pr') { if (d.confirm === 'yes') { const f = ui.dialogF; follow(Object.assign({}, f, { dialog: '' }), ui.dialogLabel); } else { ui.dialog = ''; pendingFocus = 'act-main'; } }
  else if (d.confirm) { if (d.confirm === 'yes') { ui.confirm.ok = true; follow(ui.confirm.f, ui.confirm.label); } else { ui.confirm = null; pendingFocus = 'act-main'; } }
  else if (d.run === 'stop') follow(M.runFlow.stop, 'Stop the run');
  else if (d.act) act(d.act);
  else if (d.menu) { const opening = ui.menu !== d.menu; ui.menu = opening ? d.menu : ''; if (opening) pendingFocus = 'menu-first'; }
  else if (d.menuPick) {
    if (d.menuPick.startsWith('away:')) { ui.away = d.menuPick; ui.menu = ''; pendingFocus = 'menu:more'; toast('Away mode on this run: ' + AWAY.find((x) => x.id === d.menuPick).text); }
    else if (d.menuPick === 'more:after') { ui.dialog = 'after'; ui.menu = ''; pendingFocus = 'after-task'; }
    else if (d.menuPick === 'more:archive') follow({ to: 'archived', confirm: 'Archive this run? The local branch, worktree and logs are removed; the remote branch and any PR stay.' }, 'Archive');
    else if (d.menuPick === 'more:restore') { goCase('merged'); toast('Restored to Runs'); }
    else if (d.menuPick === 'group:ask' || d.menuPick === 'group:go') { const ask = d.menuPick === 'group:ask'; ui.menu = ''; pendingFocus = 'menu:more';
      toast(ask === ui.askEach ? (ask ? 'Already asks first' : 'Already starts by itself') : ask ? 'Worca asks before each run starts' : 'Each run starts by itself'); ui.askEach = ask; }
    else if (d.menuPick === 'group:cancel') follow({ say: 'Run 3 is dropped; runs 1 and 2 stay', confirm: 'Cancel the runs that have not started?' }, 'Cancel the rest');
    else if (MORE_SAY[d.menuPick]) { toast(MORE_SAY[d.menuPick]); pendingFocus = 'menu:more'; ui.menu = ''; }
    else if (ui.menu === 'act') act(d.menuPick);
    else if (d.menuPick === 'ungroup') { ui.chips = ui.chips.filter((c) => c.kind !== 'group'); ui.menu = ''; pendingFocus = 'menu:add'; }
    else if (ui.menu === 'add' && M.add.some((x) => x.kind === d.menuPick)) { ui.menu = 'pick-' + d.menuPick; pendingFocus = 'pick-input'; }
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
  else if (d.unafter !== undefined) { ui.after = ui.after.filter((_, i) => i !== +d.unafter); toast('Scheduled run cancelled'); pendingFocus = 'menu:more'; }
  else if (d.answer !== undefined) { ui.answer = +d.answer; pendingFocus = 'answer:' + d.answer; }
  else if (d.file !== undefined) { ui.file = ui.file === +d.file ? null : +d.file; pendingFocus = 'file:' + d.file; }
  else if (d.filter) { ui.actFilter = d.filter; pendingFocus = 'filter:' + d.filter; }
  else if (d.rounds) { ui.rounds = ui.rounds.includes(d.rounds) ? ui.rounds.filter((x) => x !== d.rounds) : ui.rounds.concat(d.rounds); pendingFocus = 'rounds:' + d.rounds; }
  else if (d.key === 'act-main' && !/^(Answer|Approve and build)$/.test(t.textContent.trim())) act(t.textContent.trim());
  else if (d.key === 'act-main') {
    // The card's Answer opens the question in Overview, focused on Worca's pick: the answer happens there, in place.
    ui.tab = 'summary'; ui.flash = true; render(); ui.flash = false; const el = document.querySelector('#ov-focus [aria-checked="true"], #ov-focus .btn-primary'); el?.focus({ preventScroll: true }); document.getElementById('ov-focus')?.scrollIntoView({ block: 'nearest' }); return;
  }
  else { if (ui.menu) { ui.menu = ''; render(); } return; }
  render();
});

// Keys: tabs and stages move with arrows / Home / End and select as they move; the ship choice is a radio group;
// menus take ↑ ↓ Home End, and Escape or Tab close them with focus back on their trigger.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.key === 'pick-input' && e.key === 'Enter') { e.preventDefault(); addChip(t.value); render(); return; }
  if ((ui.confirm || ui.dialog) && e.key === 'Escape') { ui.confirm = null; ui.dialog = ''; pendingFocus = 'act-main'; render(); return; }
  if (e.key === '`' && e.ctrlKey) { e.preventDefault(); toast('Terminal opened in the worktree'); render(); return; }
  if (e.key === 'Enter' && e.target.id === 'after-task') { e.preventDefault(); document.querySelector('[data-confirm="yes"]')?.click(); return; }
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
