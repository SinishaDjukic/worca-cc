// Run card v2 mock: renders RunCardModel.view() (run-page-model.js) with Worca's own classes, and keeps the
// viewer's choices (case, open stage, added chips, ship mode, open menu) in `ui`.
const M = window.RunCardModel;
// The page is built from the Worca Rail components (ui/public/design-system/components/, bundled as components.js).
const R = window.RailUI;
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
  download: P('M12 4v11M7 10.5l5 5 5-5M5 20h14'),
  play: P('M8 5.5v13l10.5-6.5z'),
  after: P('M5 12h11M12 7l5 5-5 5M20 5v14'),
  folder: P('M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z'),
};
const svg = (name, size) => (ICON[name] ? `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>` : '');
const esc = R.esc;

// a case starts fresh: nothing from the case before it carries over
const fresh = (caseId) => ({ caseId, askOpen: false, land: '', open: null, chips: [], ship: '', menu: '', tab: '', focus: '', view: 'steps', parent: null, back: null, dialog: '', after: [], away: '', askEach: false, answer: null, file: null, actFilter: 'all', rounds: [], ticks: [], taskOpen: false, stackSt: null, busy: null, broken: false, crash: null, offline: false });
let ui = fresh('working');

const statusDot = (v) => R.statusDot({ tone: v.dot, sym: v.sym, glyph: v.sym === 'q' ? ICON.question : ICON.alert });
// A menu: an optional line on what the main action does, then each item with its one-line help.
// One compact menu everywhere, as the app's View menu: one line per item, a leading check for a choice, a hint on the
// right (a count or a shortcut), the help in the tooltip; danger items come last, after a rule.
const DANGER = /^(Discard|Stop|Stop the run|Archive|Cancel|Cancel the rest)$/;
function menu(id, items) {
  if (ui.menu !== id) return '';
  return R.compactMenu({ items: items.map((it) => (it.sep || it.header ? it : Object.assign({ danger: DANGER.test(it.text) }, it))) });
}
// Labels and cost tags are one group on the metadata line: a tag mark, then each name in a quiet outline (labels
// first, then cost tags, which read as key: value), what does not fit folded into +N. The group is one button; it
// opens one editor (also L). No colour, no ×: removing is in the editor.
const TAG_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"></path><circle cx="8" cy="8" r="1.4" fill="currentColor"></circle></svg>';
const KNOWN = { label: [['ui', 12], ['needs demo', 4], ['hotfix', 7], ['release', 9], ['docs', 2]], tag: [['team: web', 31], ['team: api', 18], ['client: acme', 6]],
  group: [['Navigation', 4], ['Billing export', 2], ['Onboarding', 3]] };
const tagsOf = () => ui.chips.filter((c) => c.kind === 'label').concat(ui.chips.filter((c) => c.kind === 'tag'));
function tagGroupHtml() {
  const all = tagsOf(); const list = all.map((c) => c.text).join(', ');
  // A label is an outline with a small dot, a cost tag a soft fill (key: value); no colour. The mark opens the editor
  // (so does a click on the group, or L); a small × shows on the chip under the pointer or with keyboard focus.
  const XS = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg>';
  return `<span class="rc-pop rc-tagpop"><span class="rc-tags${ui.menu === 'tags' ? ' is-open' : ''}" data-tagzone title="${all.length ? esc(list) + ' · L to edit' : 'Add a label or cost tag · L'}"><button type="button" class="rc-tags-mark" data-menu="tags" data-key="menu:tags" aria-haspopup="dialog" aria-expanded="${ui.menu === 'tags'}" aria-label="${all.length ? 'Edit labels and cost tags: ' + esc(list) : 'Add a label or cost tag'}">${TAG_ICON}</button>${all.map((c) => `<span class="rc-tag is-${c.kind}">${esc(c.text)}<button type="button" class="rc-tag-x" data-untag="${c.kind}|${esc(c.text)}" data-key="untag:${c.kind}:${esc(c.text)}" aria-label="Remove ${esc(c.text)}">${XS}</button></span>`).join('')}<span class="rc-tag-more" hidden></span></span>${ui.menu === 'tags' ? tagEditorHtml() : ''}</span>`;
}
// One list editor, shared by labels and cost tags and by groups: a field (type to find or create), then checked
// lists with how many runs use each; many choices for tags, one for a group.
function listEditorHtml({ label, inputId, placeholder, sections, hint }) {
  const on = (k, t) => ui.chips.some((c) => c.kind === k && c.text === t);
  const rows = ({ kind, many }) => KNOWN[kind].concat(ui.chips.filter((c) => c.kind === kind && !KNOWN[kind].some(([t]) => t === c.text)).map((c) => [c.text, 1]))
    .map(([t, n]) => `<button type="button" class="menu-item" role="${many ? 'menuitemcheckbox' : 'menuitemradio'}" aria-checked="${on(kind, t)}" data-listtoggle="${kind}|${esc(t)}" data-key="lst:${kind}:${esc(t)}"><span class="mi-l">${esc(t)}</span><span class="mi-hint">${n}</span></button>`).join('');
  return `<div class="menu rc-list-ed" role="dialog" data-motion="in" aria-label="${esc(label)}">
    <input class="input input-sm" id="${inputId}" type="text" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" data-key="${inputId}">
    ${sections.map((sec, i) => (i ? '<div class="menu-sep" role="separator"></div>' : '') + `<p class="menu-h">${esc(sec.title)}</p>` + rows(sec)).join('')}
    <p class="menu-help">${esc(hint)}</p></div>`;
}
const tagEditorHtml = () => listEditorHtml({ label: 'Labels and cost tags', inputId: 'tag-input', placeholder: 'A label, or key: value for a cost tag',
  sections: [{ title: 'Labels', kind: 'label', many: true }, { title: 'Cost tags', kind: 'tag', many: true }], hint: 'Cost tags split this run’s cost in Statistics' });
const groupEditorHtml = () => listEditorHtml({ label: 'Move to group', inputId: 'group-input', placeholder: 'Find or create a group',
  sections: [{ title: 'Groups', kind: 'group', many: false }], hint: 'A group tracks related runs on one page; a run is in one at a time' });
// The group never wraps: show what fits, fold the rest into +N (measured after each render, never on hover).
function fitTags() {
  const g = document.querySelector('.rc-tags'); if (!g) return;
  const tags = [...g.querySelectorAll('.rc-tag')]; const more = g.querySelector('.rc-tag-more');   // the chips, after the mark
  tags.forEach((t) => { t.hidden = false; }); more.hidden = true;
  const line = g.closest('.rc-facts'); const br = line.querySelector('.rc-mid-a');
  // Over when the last tag runs past the line, or when the branch would lose more than its middle (it keeps about a
  // third of the line, at most 240px). The open editor is not part of the line.
  const keep = Math.min(240, line.clientWidth * 0.34);
  const lastRight = () => { const vis = [...g.children].filter((x) => !x.hidden && x.getBoundingClientRect().width); return vis.length ? vis[vis.length - 1].getBoundingClientRect().right : 0; };
  const over = () => lastRight() > line.getBoundingClientRect().right + 1 || (br && br.scrollWidth > br.clientWidth + 1 && br.clientWidth < keep);
  let hide = 0;
  while (over() && hide < tags.length) { hide++; tags[tags.length - hide].hidden = true; more.hidden = false; more.textContent = '+' + hide; }
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
  const log = full && !/is-next/.test(r.rowCls) && !r.evidence ? R.button({ label: 'Log', kind: 'quiet', cls: 'rtab-log', attrs: { 'data-key': 'log:' + r.akey, 'data-say': 'Opens the log of ' + r.name } }) : '';
  const rest = `<span class="sc-rest"><span class="sc-loops">${loops}</span>${full ? `<span class="sc-model">${esc(r.model || '')}</span><span class="sc-cost">${esc(r.cost || '')}</span><span class="sc-act">${log}</span>` : ''}</span>`;
  // A failed or blocked step shows what broke, its last lines and a way into the log, in Activity only.
  const ev = r.evidence ? `<div class="rtab-ev"><p class="rtab-ev-t">${esc(r.evidence.title)}</p><pre class="rtab-ev-l">${r.evidence.lines.map(esc).join('\n')}</pre>${R.button({ label: r.evidence.log, attrs: { 'data-key': 'log:' + r.akey, 'data-say': r.evidence.log + ': opens the log there' } })}</div>` : '';
  return `<li class="rd-route-row sc-row ${r.rowCls}${r.focus ? ' is-focus' : ''}"><span class="rd-route-dot ${r.dotCls}" role="img" aria-label="${esc(r.word)}">${svg(r.icon, 10)}</span>
    ${name}<span class="sc-time">${esc(r.time || '')}</span>${rest}
    ${r.live ? `<div class="rd-route-second sc-line" title="${esc(r.live)}">${esc(r.live)}${r.when ? `<span class="rc-when"> · ${esc(r.when)}</span>` : ''}</div>` : ''}${ev}</li>`;
}
function stackHtml(k) {
  const seg = '';
  const rows = k.rows.map((r) => `<li class="rd-route-row ${r.rowCls}"><span class="rd-route-dot ${r.dotCls}" role="img" aria-label="${r.word}">${svg(r.icon, 11)}</span>
    <div class="rd-route-main"><div class="rd-route-place"><span class="sk-num">${esc(r.num)}</span><span class="rd-route-name" title="${esc(r.title)}">${esc(r.title)}</span></div>
    <div class="rd-route-second" title="${esc(r.word + ' · ' + r.sub)}"><span class="sk-word is-${r.state}">${esc(r.word)}</span> · ${esc(r.sub)}</div></div></li>`).join('');
  const choice = k.note ? `<p class="sk-note sk-rec">${esc(k.note)}</p>` : '';
  return `<div class="sk${k.enter ? ' is-enter' : ''}"><div class="sk-head"><span class="rc-label">${esc(k.title)}</span>${seg}</div>${choice}<ol class="rd-route-list sk-list" aria-label="${esc(k.title)}">${rows}</ol></div>`;
}

// The tabs under the card: one question each, each fact in one place (spec › The tabs). Overview reports by exception:
// what this state needs from you in full, what went fine one line each; Changes is everything the run produced,
// grouped by what it is; Activity is every step with its rounds, model, cost and log, and what each step wrote;
// Decisions is who decided what. Time, cost against the budget and the diff size stay the card's figures.
const ICON_WHO = { you: P('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z') + P('M4.5 20a7.5 7.5 0 0 1 15 0'), away: P('M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'), default: P('M12 3v4M12 17v4M3 12h4M17 12h4') };
const WHO = { you: 'You', away: 'Answered for you · Away mode', default: 'Worca’s default' };
function focusHtml(v) {
  const f = v.over.focus;
  if (!f) return '';
  if (f.kind === 'plan') {
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">The plan <span class="n">${f.items.length} steps</span></h2>
      <ol class="ov-plan">${f.items.map((x, i) => `<li><span class="ov-n">${i + 1}</span><span>${esc(x.t)}</span></li>`).join('')}</ol>
      <h3 class="ov-sub is-warn">${f.issues.length} open issues</h3><ul class="rtab-list">${f.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
</section>`;
  }
  if (f.kind === 'broke') {
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">What broke</h2>
      <div class="rtab-ev"><p class="rtab-ev-t">${esc(f.ev.title)}</p><pre class="rtab-ev-l">${f.ev.lines.map(esc).join('\n')}</pre>${R.button({ label: f.ev.log, attrs: { 'data-key': 'ov-log', 'data-say': f.ev.log + ': opens the log there' } })}</div>
      ${f.next ? `<p class="rtab-dim rtab-p">${esc(f.next)} is the card’s action: ${esc((v.action || {}).help || '')}.</p>` : ''}</section>`;
  }
  const rows = f.items.map((x, i) => {
    const st = typeof x === 'string' ? (ui.ticks.includes(i) ? 'done' : 'next') : x.state;
    const t = typeof x === 'string' ? x : x.t;
    // A check says why it is here and, when there is one, its one way to act (to its home: Decisions, a file in Changes).
    const why = x.why ? `<span class="ov-why">${esc(x.why)}${x.act ? ' · ' + R.textLink({ label: x.act, attrs: { 'data-go': x.go, 'data-key': 'go:' + i } }) : ''}</span>` : '';
    if (f.kind === 'check') return `<li><label class="ov-check"><input type="checkbox" data-tick="${i}" data-key="tick:${i}"${st === 'done' ? ' checked' : ''}><span>${esc(t)}${why}</span></label></li>`;
    return `<li class="rd-route-row is-${st}"><span class="rd-route-dot ${st === 'done' ? 'is-done' : st === 'now' ? 'is-working is-pulse' : 'is-future'}" role="img" aria-label="${st === 'done' ? 'Done' : st === 'now' ? 'In progress' : 'Not yet'}">${svg(st === 'done' ? 'check' : st === 'now' ? 'now' : '', 10)}</span><span class="rd-route-name">${esc(t)}</span></li>`;
  }).join('');
  if (f.kind === 'check') {
    const n = f.items.length - ui.ticks.length;
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">${esc(f.title)} <span class="n">${n ? n + ' to check' : 'all checked'}</span></h2><ul class="ov-checks">${rows}</ul></section>`;
  }
  return `<section class="rtab ov-focus is-progress" id="ov-focus"><h2 class="rtab-h">The plan <span class="n">${esc(f.note)}</span></h2><ol class="rd-route-list ov-progress">${rows}</ol></section>`;
}
function summaryPanel(v) {
  const o = v.over;
  const after = ui.after.length ? `<section class="rtab"><h2 class="rtab-h">Runs after this <span class="n">${ui.after.length}</span></h2><ul class="ov-arts">${ui.after.map((x, i) => `<li><span class="ov-after-t" title="${esc(x.task)}">${esc(x.task)}</span><span class="rtab-dim">${esc(x.when)}</span>${R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-unafter': i, 'data-key': 'unafter:' + i } })}</li>`).join('')}</ul></section>` : '';
  // Before it is built, the ask is all there is to say about the outcome.
  if (!o.ask) return focusHtml(v) + after + `<section class="rtab"><h2 class="rtab-h">What you asked</h2><p class="rtab-p ov-task${ui.taskOpen ? ' is-open' : ''}">${esc(o.task)}</p></section>`;
  // What went fine, one line each (What opens): the ask opens its parts in place, its only home; the evidence goes to
  // Activity, where the rounds and the steps live.
  const ok = `<span class="rd-route-dot is-done" role="img" aria-label="Done">${svg('check', 10)}</span>`;
  const open = !!ui.askOpen;
  const parts = open ? `<div class="ov-line-more" data-motion="open"><p class="ov-quote">“${esc(o.task)}”</p><ul class="ov-parts">${o.ask.parts.map(([part, how]) => `<li>${ok}<span><span class="ov-part">${esc(part)}</span><span class="ov-why">${esc(how)}</span></span></li>`).join('')}</ul><p class="ov-why">Not asked: ${esc(o.ask.unasked[0])} in <code>${esc(o.ask.unasked[1])}</code></p></div>` : '';
  const askLine = `<li class="rd-route-row ov-line${open ? ' is-open' : ''}">${ok}<button type="button" class="row-btn ov-line-btn" data-askopen aria-expanded="${open}" data-key="ask-open"><span>Did all ${o.ask.parts.length} parts you asked, plus ${esc(o.ask.unasked[0])}</span>${svg('chevron', 14)}</button>${parts}</li>`;
  const evLine = o.evidence ? `<li class="rd-route-row ov-line">${ok}<button type="button" class="row-btn ov-line-btn is-link" data-tab="activity" data-key="ov-evidence" title="Opens Activity: the tests, the review's rounds and the manual test"><span>${esc(o.evidence)}</span>${svg('chevron', 14)}</button></li>` : '';
  return focusHtml(v) + after + `<section class="rtab"><ol class="rd-route-list ov-lines">${askLine}${evLine}</ol></section>`;
}
function changesPanel(v) {
  const d = v.tabData; const f = d.files;
  const add = f.reduce((a, x) => a + x[1], 0); const del = f.reduce((a, x) => a + x[2], 0);
  // Grouped by what each file is (spec › The tabs): Code, Tests, then what is not in the code; largest first in each,
  // the folder after the name.
  const blocks = (a, dl) => { const n = Math.min(5, Math.max(1, Math.round((a + dl) / 40))); const ga = Math.round(n * a / (a + dl || 1)); return Array.from({ length: 5 }, (_, k) => `<i class="${k < ga ? 'add' : k < n ? 'del' : ''}"></i>`).join(''); };
  const open = ui.file === undefined || ui.file === null ? -1 : ui.file;
  const files = f.map(([p, a, dl], i) => ({ p, a, dl, i, dir: p.slice(0, p.lastIndexOf('/') + 1), name: p.slice(p.lastIndexOf('/') + 1) }));
  const kinds = [['Code', files.filter((x) => !/^test\//.test(x.p))], ['Tests', files.filter((x) => /^test\//.test(x.p))]].filter(([, xs]) => xs.length);
  const head = (name, n, a, dl) => `<li class="ch-dir ch-group"><span class="ch-gn">${name}</span><span class="rtab-dim">${n}</span>${a !== undefined ? `<span class="ct"><span class="add">+${a}</span><span class="del">−${dl}</span></span>` : ''}</li>`;
  const rows = kinds.map(([name, xs]) => head(name, `${xs.length} ${xs.length === 1 ? 'file' : 'files'}`, xs.reduce((s, x) => s + x.a, 0), xs.reduce((s, x) => s + x.dl, 0)) + xs.slice().sort((x, y) => (y.a + y.dl) - (x.a + x.dl)).map((r) => {
    const m = d.fileMeta[r.p] || { st: 'M' };
    const diff = open === r.i ? `<div class="ch-diff"><p class="ch-at">${esc(d.hunk.at)}</p><pre>${d.hunk.lines.map(([k, t]) => `<span class="${k === '+' ? 'add' : k === '-' ? 'del' : ''}">${esc(k + ' ' + t)}</span>`).join('\n')}</pre>${R.button({ label: 'Open the whole diff', attrs: { 'data-key': 'file-full', 'data-say': 'Opens the whole diff of the file' } })}</div>` : '';
    return `<li class="ch-file${open === r.i ? ' is-open' : ''}${ui.land === 'file:' + r.i ? ' is-flash' : ''}"><button type="button" class="ch-row" aria-expanded="${open === r.i}" data-file="${r.i}" data-key="file:${r.i}"><span class="ch-st is-${m.st}" title="${m.st === 'A' ? 'Added' : 'Modified'}">${m.st}</span><span class="ch-name" title="${esc(r.p)}">${esc(r.name)}<span class="ch-path">${esc(r.dir)}</span></span>${m.notes ? `<span class="ch-notes" title="${m.notes} review comments">${m.notes}</span>` : '<span class="ch-notes"></span>'}<span class="ct"><span class="add">+${r.a}</span><span class="del">−${r.dl}</span></span><span class="ch-blocks" aria-hidden="true">${blocks(r.a, r.dl)}</span></button>${diff}</li>`;
  }).join('')).join('');
  // Documents its steps wrote: they stay with the run and are not in the PR. A name opens it; one download at the end.
  const arts = v.over.artifacts;
  const docs = arts.length ? head('Not in the code', String(arts.length)) + `<li class="ch-gnote">Written by the run’s steps; they stay with the run and are not in the PR</li>` + arts.map(([doc, step], i) => `<li class="ch-file ch-doc${ui.land === 'doc:' + i ? ' is-flash' : ''}"><span class="ch-st" aria-hidden="true"></span><span class="ch-name"><button type="button" class="ov-art-name" data-key="art:${i}" data-say="Opens ${esc(doc)}" title="Open ${esc(doc)}"><code>${esc(doc)}</code></button><span class="ch-path">from ${esc(step)}</span></span>${R.button({ label: 'Download ' + doc, kind: 'quiet', iconOnly: true, icon: svg('download', 14), attrs: { 'data-key': 'dl:' + i, 'data-say': 'Downloading ' + doc } })}</li>`).join('') : '';
  const where = v.place.folder ? `In a copy of ${v.place.folder}; Apply writes them into the folder.` : v.place.branch ? `${v.place.branch} into ${v.place.base || 'dev'}` : '';
  // The code's own actions sit in the Changes head, as the card's action does: Check out, the rest in its ▾.
  const chItems = (v.bar.stop ? [{ id: 'ch:refresh', text: 'Refresh', help: 'Reload the diff from the worktree' }] : [])
    .concat([{ id: 'ch:patch', text: 'Download patch', help: 'Every change as one .patch file' }, { id: 'ch:copy', text: 'Copy git commands', help: 'git fetch and git switch to this branch' }]);
  const tools = v.place.folder ? '' : R.splitButton({ main: { label: 'Check out', title: 'Check the branch out on this machine', attrs: { 'data-key': 'ch:checkout', 'data-say': `Checked out ${v.place.branch || 'the branch'} on this machine` } },
    moreLabel: 'More for these changes', chevron: svg('chevron', 14), open: ui.menu === 'ch', menuHtml: menu('ch', chItems), moreAttrs: { 'data-menu': 'ch', 'data-key': 'menu:ch' }, cls: 'rc-pop is-right ch-act' });
  return `<section class="rtab"><div class="ch-head"><div class="ch-sum"><h2 class="rtab-h">${f.length} files <span class="ct"><span class="add">+${add}</span><span class="del">−${del}</span></span></h2><span class="rtab-dim" title="${esc(where)}">${esc(where)}</span></div>${tools}</div>
    <ul class="ch-list">${rows}${docs}</ul></section>`;
}
function activityPanel(v) {
  const only = ui.actFilter === 'problems';
  const seg = R.segmented({ label: 'Show', hook: 'filter', items: [{ id: 'all', label: 'All steps', pressed: !only }, { id: 'problems', label: 'Problems and questions', pressed: only }] });
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
      const di = v.over.artifacts.findIndex(([, step]) => step === r.name);
      const wrote = di < 0 ? '' : `<li class="rd-route-row sc-row is-round is-wrote"><span class="ac-round-n" aria-hidden="true"></span><span class="sc-name ac-why">Wrote ${R.textLink({ label: v.over.artifacts[di][0], attrs: { 'data-go': 'doc:' + di, 'data-key': 'wrote:' + di, title: 'Open it in Changes' } })}</span><span class="sc-time"></span><span class="sc-rest"></span></li>`;
      return row + sub + wrote;
    }).join('');
  }).join('');
  return `<div class="rtab-bar">${seg}${R.button({ label: 'Open the graph', kind: 'quiet', attrs: { 'data-key': 'graph', 'data-say': 'Opens the run graph, centred on the live step' } })}</div><section class="rtab rtab-stage"><ol class="rd-route-list sc-subs is-full" aria-label="Steps">${rows || '<li class="sc-stage-row"><p class="rtab-dim rtab-p">No problems or questions in this run.</p></li>'}</ol></section>`;
}
function decisionsPanel(v) {
  const ds = v.tabData.decisions;
  const by = (w) => ds.filter((x) => x.who === w).length;
  const ask = v.ask;
  const sum = [by('you') ? by('you') + ' by you' : '', by('away') ? by('away') + ' by Away mode' : '', by('default') ? by('default') + ' by default' : ''].filter(Boolean).join(' · ');
  const waiting = ask ? `<li class="rd-route-row is-ask"><span class="rd-route-dot is-problem" role="img" aria-label="Waiting for you">${svg('question', 10)}</span><div class="dc-body"><p class="rtab-q">${esc(ask.q)}</p><p class="rtab-dim">Waiting for you · ${R.textLink({ label: 'Answer it in the card', attrs: { 'data-goanswer': true, 'data-key': 'dc-answer' } })}</p></div></li>` : '';
  return `<section class="rtab"><div class="ch-head"><h2 class="rtab-h">${ds.length} decisions</h2><span class="rtab-dim">${esc(sum)}</span></div>
    <ol class="rd-route-list dc-list">${waiting}${ds.map((x) => `<li class="rd-route-row is-done"><span class="rd-route-dot dc-who is-${x.who}" role="img" aria-label="${esc(WHO[x.who])}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_WHO[x.who]}</svg></span><div class="dc-body"><p class="rtab-q">${esc(x.q)}</p><p class="dc-a">${esc(x.a)}</p><p class="rtab-dim">${esc([x.step, WHO[x.who], x.note, x.when].filter(Boolean).join(' · '))}</p></div></li>`).join('')}</ol></section>`;
}
function panelHtml(v) {
  const t = v.tabs.find((x) => x.sel) || v.tabs[0]; const id = t.id;
  // a part that cannot be drawn says so in its own place; the rest of the page keeps working
  if (ui.broken) return R.emptyState({ title: `Could not show the ${t.l.toLowerCase()}`, text: 'Something went wrong here. The rest of the page still works.', error: true,
    actions: R.button({ label: 'Reload this part', attrs: { 'data-fixpart': true, 'data-key': 'fix-part' } }) + R.button({ label: 'Details', kind: 'quiet', attrs: { 'data-say': DETAILS, 'data-key': 'part-details' } }) });
  return ({ summary: summaryPanel, changes: changesPanel, activity: activityPanel, decisions: decisionsPanel })[id](v);
}
function figHtml(f, v) {
  if (f.k === 'Cost' && v) {
    const rows = v.activity.filter((st) => st.meta).map((st) => `<li><span>${esc(st.label)}</span><span class="ct">${esc(st.meta)}</span></li>`).join('');
    const html = `<div class="menu rc-cost" role="dialog" data-motion="in" aria-label="Cost by stage"><p class="menu-h">Cost by stage</p><ul>${rows}<li class="is-total"><span>Total</span><span class="ct">${esc(f.v)}</span></li></ul><p class="menu-help">${esc(f.title || '')}. Each step’s cost and model are in Activity.</p></div>`;
    return R.figure({ k: f.k, v: f.v, of: f.of, warn: f.warn, title: f.title || '', pop: { open: ui.menu === 'cost', html, attrs: { 'data-menu': 'cost', 'data-key': 'menu:cost' } } });
  }
  if (f.tab) return R.figure({ k: f.k, v: f.v, tab: f.tab, title: 'Open Changes', current: ui.tab === f.tab });
  return R.figure({ k: f.k, v: f.v, of: f.of, warn: f.warn, title: f.title });
}

let jump = true;   // the first draw, or another case picked: another page, drawn at once (Motion: never a transition between pages)
function render() {
  const keep = pendingFocus || document.activeElement?.dataset?.key || '';
  pendingFocus = '';
  const v = M.view(ui.caseId, ui);
  const a = v.action;
  // The run's controls sit together on the status line: its one action (with ▾), then ⋯ for everything else.
  const split = a ? R.splitButton({ main: { label: a.label, kind: a.primary ? 'primary' : '', icon: svg(a.icon, 14), title: a.help, attrs: { 'data-key': 'act-main', 'data-label': a.label } },
    moreLabel: a.items.length ? 'More actions' : '', chevron: svg('chevron', 14), open: ui.menu === 'act', menuHtml: menu('act', a.items), moreAttrs: { 'data-menu': 'act', 'data-key': 'menu:act' }, cls: 'rc-action rc-pop is-right' }) : '';
  const dots = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>';
  const action = `<div class="rc-side">${split}<span class="rc-pop is-right">${R.button({ label: 'More for this run', iconOnly: true, title: false, icon: dots, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': String(ui.menu === 'more'), 'data-menu': 'more', 'data-key': 'menu:more' } })}${ui.menu === 'groups' ? groupEditorHtml() : menu('more', moreItems(v))}</span></div>`;
  // Many labels and tags, one group: a run already in a feature or chain, or a group page, joins none; a run you
  // grouped can leave it again from the same menu.
  // Where the code lives, said as a phrase that follows the run: "branch into dev", "#959 merges branch into dev",
  // "branch merged into dev", "main to origin/main", "into ~/folder". The branch name copies itself on click and loses
  // its middle, never its end, so sibling runs (-2, -3) stay apart.
  const pl = v.place;
  const mid = (t) => { const k = Math.max(t.lastIndexOf('-'), t.lastIndexOf('/')); const cut = k > 0 && t.length - k <= 16 ? k : Math.max(0, t.length - 12); return `<code class="rc-mid" title="${esc(t)}"><span class="rc-mid-a">${esc(t.slice(0, cut))}</span><span class="rc-mid-b">${esc(t.slice(cut))}</span></code>`; };
  const branchBtn = (t) => (pl.copy ? `<button type="button" class="rc-branch" data-key="copy" data-say="Copied ${esc(t)}" title="Copy branch name" aria-label="Copy branch name ${esc(t)}">${mid(t)}</button>` : mid(t));
  const word = (w) => `<span class="rc-word-sm">${w}</span>`;
  const pr = pl.pr ? `<a class="rc-pr" href="#" data-key="pr" data-say="Opens ${esc(pl.pr)} on GitHub" title="Open ${esc(pl.pr)} on GitHub">${esc(pl.pr)}</a>` : '';
  const where = pl.folder ? `<span class="rc-place">${word(pl.applied ? 'written into' : 'into')}${mid(pl.folder)}</span>`
    : !pl.branch ? ''
    : pl.base === 'origin/main' ? `<span class="rc-place">${branchBtn(pl.branch)}${word('to')}<code class="rc-base">${esc(pl.base)}</code></span>`
    : `<span class="rc-place">${pl.pr && !pl.merged ? pr + word('merges') : ''}${branchBtn(pl.branch)}${word(pl.merged ? 'merged into' : 'into')}<code class="rc-base">${esc(pl.base)}</code>${pl.pr && pl.merged ? word('by') + pr : ''}</span>`;
  const repos = pl.repos.length ? `<span>${pl.repos.length} repositories</span>` : '';
  // + stays at the end of the place line; labels and tags, once added, get their own wrapping row under it.
  const kind = v.kind ? `<span class="kind-chip">${esc(v.kind)}</span>` : '';
  const placeLine = [kind, where, repos, pl.branch || pl.folder ? '' : pr].filter(Boolean).join('<span class="rc-sep" aria-hidden="true">·</span>');
  // One metadata line: what it is, where the code lives, then the tag group (mark, labels, cost tags).
  const facts = `<span class="rc-placeset">${placeLine}</span>${placeLine ? '<span class="rc-sep" aria-hidden="true">·</span>' : ''}${tagGroupHtml()}`;
  // Where you are: Runs › place › group, the page itself never a crumb; on a narrow card only the parent, as ‹ Parent.
  const crumbs = `<nav class="rc-crumbs" aria-label="Breadcrumb"><ol>${v.crumbs.map((c, i) => `<li${i === v.crumbs.length - 1 ? ' class="is-parent"' : ''}>${c.go ? `<button type="button" class="rc-crumb" data-crumb="${i}" data-key="crumb:${i}" title="${esc(c.t)}">${esc(c.t)}</button>` : `<a class="rc-crumb" href="#" data-key="crumb:${i}" data-say="Goes to ${esc(i ? (c.group ? 'the ' + c.t + ' group' : c.t + ' runs') : 'the Runs list')}" title="${esc(c.t)}">${esc(c.t)}</a>`}</li>`).join('')}</ol></nav>`;
  // A run in a group steps to its siblings; a run that has not started has no page yet.
  const pg = v.pager;
  const left = svg('chevron', 14).replace('M6 9.5l6 6 6-6', 'M14.5 6l-6 6 6 6');
  const right = svg('chevron', 14).replace('M6 9.5l6 6 6-6', 'M9.5 6l6 6-6 6');
  const sib = (x, dir, icon) => R.button({ label: (dir === 'prev' ? 'Previous' : 'Next') + ' run', kind: 'quiet', iconOnly: true, icon, title: x && !x.ok ? `Run ${x.index + 1} hasn’t started` : false,
    attrs: { 'data-sib': x ? x.index : '', 'data-key': 'sib:' + dir, disabled: !(x && x.ok) } });
  const pager = pg ? `<span class="rc-pager" role="group" aria-label="Runs in this group">${sib(pg.prev, 'prev', left)}<span class="rc-pager-n">${pg.index + 1} of ${pg.n}</span>${sib(pg.next, 'next', right)}</span>` : '';
  const scope = v.bar.scope ? ` title="Applies to the whole ${esc(v.bar.scope)}: the running run and the ones after it"` : '';

  const track = v.stages.map((st) => `<div class="sc-seg">${st.cells.map((c) => `<span class="sc-cell ${c}"></span>`).join('')}</div>`).join('');
  // The stage row is a real tablist: one Tab stop (the selected stage), arrows move, each tab names the panel it controls.
  const stages = v.stages.map((st) => `<button type="button" class="sc-stage" role="tab" id="st-${st.key}" aria-controls="stage-panel" aria-selected="${st.selected}" tabindex="${st.selected ? 0 : -1}" data-stage="${st.key}" data-key="stage:${st.key}" aria-label="${esc(st.aria)}" title="${esc(st.aria)}"><span class="l">${esc(st.label)}</span><span class="m">${esc(st.meta)}</span></button>`).join('');
  const o = v.open;
  const enter = o.key !== lastOpen; lastOpen = o.key;   // the steps fade in only when another stage opens, never on a repaint
  const head = o.isRun ? `<div class="sc-head"><span class="sc-run" title="${esc(o.title)}">${esc(o.title)}</span>${o.meta ? `<span class="rtab-dim sc-run-cost">${esc(o.meta)}</span>` : ''}${o.canOpen ? `${R.button({ label: 'Open run', attrs: { 'data-open-run': o.runIndex, 'data-key': 'open-run' } })}` : v.bar.stop ? R.button({ label: 'Re-plan from here', title: 'The planner re-cuts this run and the ones after it', attrs: { 'data-replan': o.runIndex, 'data-key': 'replan' } }) : ''}</div>`
    : v.planHead ? `<div class="sc-head"><span class="sc-run">How the work was cut into runs</span>${R.button({ label: 'Open the plan', attrs: { 'data-key': 'open-plan', 'data-say': 'Opens plan.md' } })}</div>` : '';
  // the next run of a group, under the run it follows: starts by itself, or asks first
  const then = v.then ? `<div class="sc-then">Then <b title="${esc(v.then.title)}">Run ${v.then.n} · ${esc(v.then.title)}</b><span class="rc-pop pd-basepop"><button type="button" class="pd-base pd-ship" data-menu="then" data-key="menu:then" aria-haspopup="menu" aria-expanded="${ui.menu === 'then'}" title="When run ${v.then.n} starts">${ui.askEach ? 'asks me first' : 'starts by itself'}${svg('chevron', 12)}</button>${menu('then', [{ id: 'group:go', text: 'Starts by itself', checked: !ui.askEach, help: 'Each run starts when the one before it is ready' }, { id: 'group:ask', text: 'Asks me first', checked: !!ui.askEach, help: 'Stops for your OK before the next run starts' }])}</span></div>` : '';
  const ask = v.ask && o.rows.some((r) => /is-ask/.test(r.rowCls)) ? answerHtml(v.ask) : '';
  const panel = o.stack ? stackHtml(Object.assign({}, o.stack, { enter })) : `<ol class="rd-route-list sc-subs${enter ? ' is-enter' : ''}" aria-label="${esc(o.label)} steps" style="grid-column:1 / -1">${o.rows.map((r) => rowHtml(r) + (/is-ask/.test(r.rowCls) ? ask : '')).join('')}</ol>`;
  const sel = (v.tabs.find((t) => t.sel) || v.tabs[0]).id;

  const scroller = document.scrollingElement || document.documentElement; const keepY = scroller.scrollTop;
  R.morph(document.getElementById('card'), `
  <div class="rc">
    <div class="rc-bar">${crumbs}${ui.offline ? `<span class="rc-conn" role="status" title="Worca lost its connection to the server; your runs keep going and it reconnects by itself">${R.statusDot({ tone: 'is-grey' })}Offline · retrying</span>` : ''}${pager}</div>
    ${stripHtml(v)}
    <div class="rc-head"><div class="rc-title-row"><h1 class="rc-heading${ui.titleOpen ? ' is-open' : ''}" title="${esc(v.title)}" data-title>${esc(v.title)}</h1></div>${facts ? `<div class="rc-facts">${facts}</div>` : ''}</div>
    <section class="rc-card" aria-label="Run status">
      ${R.statusLine({ dot: statusDot(v), word: v.word, action, detail: v.detail })}
      <div class="rc-zone"><div class="rc-span"><div class="sc-track" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" aria-hidden="true">${track}</div><div class="sc-stages" style="grid-template-columns:repeat(${v.stages.length},minmax(0,1fr))" role="tablist" aria-label="Stages">${stages}</div></div></div>
      <div class="rc-zone is-ruled" role="tabpanel" id="stage-panel" aria-labelledby="st-${o.key}">${head}${panel}${then}</div>
      <div class="rc-zone is-ruled">${R.figures(v.figs.map((f) => figHtml(f, v)))}</div>
    </section>
    ${R.tabs({ label: 'Run detail', controls: 'rtab-panel', cls: 'rc-tabs', items: v.tabs.map((t) => ({ id: t.id, label: t.l, count: t.n, selected: t.sel })) })}
    ${prDialogHtml(v)}
    ${R.toast({ text: ui.toast || '' })}
    <div class="rtab-panel" role="tabpanel" id="rtab-panel" aria-labelledby="tab-${sel}" tabindex="0">${panelHtml(v)}</div>
    ${ui.crash ? R.errorToast({ title: 'Something went wrong', text: 'Worca hit an error it did not expect. Your runs keep going.', icon: svg('alert', 15), count: ui.crash.n,
    actions: R.button({ label: 'Reload', attrs: { 'data-crash': 'reload', 'data-key': 'crash-reload' } }) + R.button({ label: 'Copy details', kind: 'quiet', attrs: { 'data-say': DETAILS, 'data-key': 'crash-details' } }),
    close: R.button({ label: 'Close', kind: 'quiet', iconOnly: true, title: false, icon: svg('x', 14), attrs: { 'data-crash': 'close', 'data-key': 'crash-close' } }) }) : ''}
  </div>`, { motion: !jump });
  jump = false;

  if (scroller.scrollTop !== keepY) scroller.scrollTop = keepY;   // nothing moves by itself: a repaint never scrolls the page
  fitTags();
  fitMenus();
  const nx = document.getElementById('next-event'); if (nx) { const to = ui.caseId === 'chain' ? (chainNext() >= 0 ? 'chain' : '') : (M.flow[ui.caseId] || {}).next; nx.disabled = !to; nx.title = to ? 'Event: ' + EVENT[ui.caseId] : 'Nothing outside the run happens next here; use the card'; }
  const selTab = document.querySelector('.rc-tabs .tab[aria-selected="true"]'); const strip = selTab?.parentElement;
  if (strip) { const l = selTab.offsetLeft - strip.offsetLeft, r = l + selTab.offsetWidth; if (l < strip.scrollLeft) strip.scrollLeft = l; else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth; }
  if (keep) {
    const el = keep === 'menu-first' ? document.querySelector('.menu .menu-item') : document.querySelector(`[data-key="${CSS.escape(keep)}"]`) || (keep.startsWith('lst:') ? document.getElementById('tag-input') : null);   // a removed custom label has no row left
    el?.focus({ preventScroll: true });
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
document.addEventListener('input', (e) => {
  if (e.target.id === 'after-task') ui.afterDraft = e.target.value;
  if (e.target.id === 'changes-text') ui.changesText = e.target.value;
  if (e.target.id === 'answer-own') { ui.answerOwn = e.target.value; if (e.target.value && ui.answer !== -1) { ui.answer = -1; document.querySelectorAll('.sc-ans-opt').forEach((x) => { x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; }); } }
  const m = ui.pr && e.target.id.match(/^pd-(title|desc)(?:-(\d+))?$/);
  if (m) (m[2] === undefined ? ui.pr : ui.pr.prs[+m[2]])[m[1]] = e.target.value;
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'break' && e.target.value && e.target.value !== 'step') { const k = e.target.value; e.target.value = ''; breakNow(k); return; }
  if (!ui.pr) return;
  if (e.target.id === 'pd-draft') ui.pr.draft = e.target.checked;
  if (e.target.id === 'pd-watch') ui.pr.watch = e.target.checked;
});
// The intro's note lists what this design proposes beyond today's app, with why; the buttons carry no mark.
{ const n = document.getElementById('proposed'); if (n) n.innerHTML = `<summary>${M.proposed.length} actions are proposed, not in today’s app</summary><ul>${M.proposed.map(([a, why]) => `<li><b>${esc(a)}</b> ${esc(why)}</li>`).join('')}</ul>`; }
const pick = document.getElementById('case');
const groups = [...new Set(M.cases.map((c) => c.group))];
pick.innerHTML = groups.map((g) => `<optgroup label="${g}">${M.cases.filter((c) => c.group === g).map((c) => `<option value="${c.id}"${c.id === ui.caseId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
pick.addEventListener('change', () => { jump = true; ui = Object.assign(fresh(pick.value), { chips: (M.cases.find((c) => c.id === pick.value) || {}).chips || [] }); render(); });
// The prototype's flow (RunCardModel.flow): an action moves the run to its next case or does its job in place and
// says so in the toast; a destructive or outward one (Stop, Discard, Merge, Apply) asks first in a confirm strip.
const AWAY = [{ id: 'away:auto', text: 'As set up', help: 'Follows Settings and whether you marked this run' }, { id: 'away:on', text: 'Answer for me', help: 'Worca answers this run’s questions from now on, at any hour' }, { id: 'away:off', text: 'Never', help: 'Worca never answers on this run, whatever the settings' }];
function moreItems(v) {
  const group = !!v.kind; const live = v.bar.stop;
  const items = [];
  if (live && !group) items.push({ header: 'Away mode' }, ...AWAY.map((x) => Object.assign({ checked: (ui.away || 'away:auto') === x.id }, x)), { sep: true });
  if (v.runAfter) items.push({ id: 'more:after', text: v.runAfter.label, help: v.runAfter.help });
  if (!group && !v.inGroup) items.push(v.addedGroup ? { id: 'ungroup', text: 'Leave ' + v.addedGroup, help: 'The run leaves the group; its labels and tags stay' } : { id: 'more:group', text: 'Move to group…', help: 'Tracks it with related runs on one page' });
  if (!group) items.push({ id: 'more:preset', text: 'Save as preset', help: 'Starts the next run with this task’s setup' });
  items.push({ id: 'more:terminal', text: 'Terminal', hint: 'Ctrl+`', help: 'A shell in this run’s worktree' }, { id: 'more:link', text: 'Copy link', help: 'Paste it in Chat or an issue' });
  if (v.finished && !v.archived) items.push({ id: 'more:report', text: 'Report this run', help: 'Sends the logs and a note to the Worca team' }, { id: 'more:archive', text: 'Archive', help: 'Removes the branch, worktree and logs; the remote branch and PR stay' });
  if (v.archived) items.push({ id: 'more:restore', text: 'Restore', help: 'Brings the run back to Runs' });
  return items;
}
const CH_SAY = { 'ch:refresh': () => 'Diff refreshed from the worktree', 'ch:patch': () => 'Downloading run.patch', 'ch:copy': (v) => 'Copied: git fetch && git switch ' + v.place.branch };
const MORE_SAY = { 'more:link': 'Copied the link to this run', 'more:preset': 'Saved as preset “Unified page navigation”', 'more:terminal': 'Terminal opened in the worktree', 'more:report': 'Report sent with the logs',
};
let toastTimer = 0;
// The toast fades out (Motion), then empties: its text stays while it fades.
function toast(text) { ui.toast = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = ''; const el = document.querySelector('.rc-toast'); if (el) { el.classList.remove('is-on'); toastTimer = setTimeout(() => { if (!ui.toast) el.textContent = ''; }, 200); } }, 4000); }
function goCase(id) {
  Object.assign(ui, { caseId: id, open: null, ship: '', menu: '', tab: '', focus: '', parent: null, back: null, titleOpen: false, answer: null, file: null, rounds: [], ticks: [], actFilter: 'all', confirm: null, dialog: '' });
  pick.value = id; pendingFocus = 'act-main';
}
function follow(f, label) {
  if (f.dialog && ui.dialog !== f.dialog) {
    ui.dialog = f.dialog; ui.dialogLabel = label; ui.dialogF = f; ui.menu = '';
    if (f.dialog === 'pr') { const v = M.view(ui.caseId, ui); ui.pr = { title: v.title, desc: '', mode: 'write', gen: false, genTitle: false, titleN: 0, titleSuggested: false, draft: false, watch: true, base: 'dev' }; if (!v.runs.length || !/^Create \d/.test(label)) { generateTitle(); generate(); } else startStack(v); pendingFocus = v.runs.length ? 'pd-ok' : 'pd-close'; }
    return;
  }
  if (f.confirm && !(ui.confirm && ui.confirm.ok)) {
    ui.dialog = '';
    ui.confirm = { text: f.confirm, yes: label.replace(/ the run$/, '') || 'Confirm', danger: /^(Stop|Discard|Cancel)/.test(label), f, label }; ui.menu = ''; pendingFocus = 'confirm:yes'; return;
  }
  // A step you confirmed, in the strip or the dialog: its button says what is happening; then the run moves on, or
  // nothing changes and the place you acted says what failed and why, with Try again (as Create PR does today).
  if (f.confirm || f.fromDialog) {
    const busy = { label }; ui.busy = busy; ui.menu = ''; if (ui.confirm) ui.confirm.err = null; if (ui.pr) ui.pr.err = null;
    pendingFocus = ui.dialog ? 'pd-ok' : 'confirm:yes';
    setTimeout(() => {
      if (ui.busy !== busy) return;
      ui.busy = null;
      const odd = takeBreak('step');
      if (odd || takeFail()) { failed(label, odd); render(); document.querySelector('.pd-alert')?.scrollIntoView({ block: 'nearest' }); return; }
      done(f, label); render();
    }, 900);
    return;
  }
  done(f, label);
}
function done(f, label) {
  ui.dialog = ''; ui.confirm = null; ui.menu = '';
  if (f.run) { f.run(); toast(f.say); pendingFocus = 'act-main'; }
  else if (f.to) { goCase(f.to); toast(f.say || 'Now: ' + M.view(f.to, {}).word); } else { toast(f.say); pendingFocus = pendingFocus || 'act-main'; }
}
// What a step's button says while it works, and why it can fail; a failure keeps the state as it was.
const WORKING = { Fix: 'Fixing…', Merge: 'Merging…', Create: 'Creating…', Stop: 'Stopping…', Discard: 'Discarding…', Archive: 'Archiving…', Cancel: 'Cancelling…', 'Re-plan': 'Re-planning…', Continue: 'Continuing…', Delete: 'Deleting…' };
const working = (label) => WORKING[label.split(' ')[0]] || 'Working…';
const REASON = { Merge: 'GitHub says the branch is behind dev; update it and try again', Create: 'git push was rejected: the remote branch moved', Stop: 'the run did not answer; it may have just finished',
  Archive: 'a terminal still has the worktree open', Discard: 'a terminal still has the worktree open', Cancel: 'run 3 had just started', 'Re-plan': 'the planner did not answer in time', Continue: 'the budget settings could not be saved' };
function failed(label, odd) {
  const why = odd ? 'something went wrong on Worca’s side' : REASON[label.split(' ')[0]] || 'GitHub did not answer';
  const err = { title: 'Could not ' + label.charAt(0).toLowerCase() + label.slice(1), detail: why[0].toUpperCase() + why.slice(1) + '. Nothing changed.', odd };
  if (ui.dialog === 'pr') {
    // a stack fails part-way: the PRs already opened stay opened, and a retry opens only the rest
    const left = (ui.pr.prs || []).filter((x) => !x.made);
    if (ui.pr.prs && left.length > 1) { left[0].made = '#' + (959 + ui.pr.prs.indexOf(left[0])); left[0].open = false; ui.dialogLabel = 'Create ' + (left.length - 1) + ' PRs';
      err.title = 'Could not create ' + (left.length - 1) + ' of ' + ui.pr.prs.length + ' PRs'; err.detail = 'Opened ' + left[0].made + '; the next one failed: ' + why + '. A retry opens only the rest.'; }
    ui.pr.err = err; pendingFocus = 'pd-ok';
  } else { ui.confirm.err = err; ui.confirm.ok = false; pendingFocus = 'confirm:yes'; }
}
// The prototype's "Next one fails" switch: the next confirmed step or suggestion fails, to show how a failure reads.
function takeFail() { const box = document.getElementById('fail-next'); if (!box || !box.checked) return false; box.checked = false; return true; }
// The prototype's "Break something" picker: what an error nobody planned for looks like (docs/design-system.md › When
// something breaks unexpectedly). A step waits for the next confirmed step; the others happen at once.
function takeBreak(kind) { const s = document.getElementById('break'); if (!s || s.value !== kind) return false; s.value = ''; return true; }
const DETAILS = 'Copied the error details: id E-7F3A, with the message and stack';
let offlineTimer = 0;
function breakNow(kind) {
  if (kind === 'part') { ui.broken = true; pendingFocus = 'fix-part'; }
  if (kind === 'background') ui.crash = { n: ui.crash ? ui.crash.n + 1 : 1 };   // a repeat counts, never a second toast
  if (kind === 'offline') { ui.offline = true; clearTimeout(offlineTimer); offlineTimer = setTimeout(() => { ui.offline = false; toast('Back online'); render(); }, 6000); }
  render();
}
// Worca writes for you (the violet shimmer), in a field you then edit: a drafted answer, a change request.
const DRAFT = { answer: 'Show only ‹ Parent under 600px; keep the full trail from 600px up', changes: 'Slices: take the parent from the feature, not the project.\nSaved runs: fall back to Runs when there is no live parent.' };
let draftTimer = 0;
const draftTip = (what) => { const h = M.view(ui.caseId, ui).tabData.helper.draft; return `${what} · writes with ${h.model} (Models › Helper jobs › ${h.job})`; };
const draftFail = (kind) => `<span class="pd-fail" role="status" style="flex:1 0 100%">Couldn’t write it: no answer in 20s. The text is as it was. <button type="button" class="pd-retry" data-draft="${kind}" data-key="draft-retry-${kind}">Try again</button></span>`;
function draft(kind) {
  const flag = kind === 'answer' ? 'answerDraft' : 'changesDraft'; ui[flag] = true; clearTimeout(draftTimer); const fails = takeFail(); ui[kind + 'Err'] = false;
  draftTimer = setTimeout(() => { if (!ui[flag]) return; ui[flag] = false; if (fails) { ui[kind + 'Err'] = true; render(); return; } if (kind === 'answer') { ui.answerOwn = DRAFT.answer; ui.answer = -1; pendingFocus = 'answer-own'; } else { ui.changesText = DRAFT.changes; pendingFocus = 'changes-text'; } render(); }, 1100);
}
function act(label) {
  if (label === 'Ask for changes') { ui.dialog = 'changes'; ui.changesText = ''; ui.menu = ''; draft('changes'); pendingFocus = 'draft-stop'; return; }
  if (/ (stacked PRs|one PR) instead$/.test(label)) {
    const v = M.view(ui.caseId, ui); const it = v.action.items.find((x) => x.text === label);
    if (it && it.off) { toast(it.help); ui.menu = ''; pendingFocus = 'menu:act'; return; }
    ui.ship = /one PR/.test(label) ? 'one' : 'stack'; ui.menu = '';
    const nv = M.view(ui.caseId, ui); return act(nv.action.label);
  }
  if (label === 'Cancel the rest') { follow({ say: 'The runs that had not started are dropped; the others stay', confirm: 'Cancel the runs that have not started? Runs already done or running stay.' }, label); return; }
  // A stack in review merges one PR at a time; merging one moves the next onto dev, where its checks run again.
  const pm = ui.caseId === 'chain' && /^(Merge|Fix checks on) (#\d+)$/.exec(label);
  if (pm) {
    const nums = M.chainPrs; const i = nums.indexOf(pm[2]); const nx = nums[i + 1];
    const set = (fn) => () => { const st = (ui.stackSt || M.chainStart).slice(); fn(st); ui.stackSt = st; };
    if (pm[1] === 'Merge') follow({ confirm: 'Merge ' + pm[2] + ' into dev?' + (nx ? ' Worca then moves ' + nx + ' onto dev.' : ''), say: 'Merged ' + pm[2] + ' into dev' + (nx ? '; ' + nx + ' now goes into dev' : '; the whole stack is in dev'),
      run: set((st) => { st[i] = 'merged'; if (nx && st[i + 1] !== 'failing') st[i + 1] = 'checks'; }) }, label);
    else follow({ say: 'A short run fixed ' + pm[2] + '’s checks; they run again', run: set((st) => { st[i] = 'checks'; }) }, label);
    return;
  }
  const run = { Pause: 'pauseNow', 'Pause after this step': 'pauseAfter', 'Stop the run': 'stop' }[label];
  if (run) { follow(M.runFlow[run], label === 'Stop the run' ? 'Stop the run' : 'Pause'); return; }
  if (label === 'Try it' || label === 'Check out the whole feature') { toast(M.view(ui.caseId, ui).tryIt); ui.menu = ''; pendingFocus = 'act-main'; return; }
  const f = (M.flow[ui.caseId] || {})[label];
  if (f) follow(f, label); else toast(label + ': done');
}
const EVENT = { starting: 'Plan is under way', working: 'Review passed', checks: '2 checks failed', failing: 'dev moved on: 2 files conflict', conflicts: 'Checks green, a reviewer approved', feature: 'Runs 2 and 3 finished', chain: 'The next PR’s checks pass and a reviewer approves' };
const chainNext = () => (ui.stackSt || M.chainStart).findIndex((x) => x === 'checks' || x === 'review');
function nextEvent() {
  if (ui.caseId === 'chain') { const i = chainNext(); if (i < 0) return; const st = (ui.stackSt || M.chainStart).slice(); st[i] = 'ready'; ui.stackSt = st; toast('Event: ' + M.chainPrs[i] + ' checks passed and a reviewer approved'); render(); return; }
  const to = (M.flow[ui.caseId] || {}).next; if (!to) return; const say = EVENT[ui.caseId]; goCase(to); toast('Event: ' + say); render(); }
// The page asks you something in one place, under the bar: confirm a step that cannot be taken back, schedule a run
// after this one, or set up the PR before it opens.
function stripHtml(v) {
  const acts = (yes) => R.confirmActions({ yes });
  if (ui.dialog === 'after') {
    const opts = v.finished ? ['Now, as a follow-up'] : ['When this run finishes'].concat(v.place.pr ? ['When its PR merges'] : []);
    return `<form class="rc-confirm is-form" role="dialog" data-motion="open" aria-labelledby="rc-strip-t" data-form="after"><span class="rc-confirm-t" id="rc-strip-t">${esc(v.runAfter.label)}</span>
      <input class="input input-sm" id="after-task" type="text" placeholder="What should the next run do?" aria-label="Task for the next run" data-key="after-task" value="${esc(ui.afterDraft || '')}">
      ${opts.length > 1 ? `<select class="select input-sm" id="after-when" aria-label="When it starts" data-key="after-when">${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : `<span class="rtab-dim" id="after-when-t">${esc(opts[0])}</span>`}${acts(v.finished ? 'Start run' : 'Schedule')}</form>`;
  }
  if (ui.dialog === 'changes') {
    return `<form class="rc-confirm is-form" role="dialog" data-motion="open" aria-labelledby="rc-strip-t" data-form="changes"><span class="rc-confirm-t" id="rc-strip-t">Tell the planner what to change</span>
      <div class="pd-adorn${ui.changesDraft ? ' is-writing' : ''}" style="flex:1 0 100%"><textarea class="textarea" id="changes-text" rows="3" placeholder="${ui.changesDraft ? 'Drafting from the 2 open issues…' : 'What should the plan do differently?'}" data-key="changes-text"${ui.changesDraft ? ' readonly' : ''} style="width:100%;font-size:var(--fs-body)">${ui.changesDraft ? '' : esc(ui.changesText || '')}</textarea><span class="pd-act">${ui.changesDraft ? '<button type="button" class="pd-stop" data-stopdraft="changes" data-key="draft-stop" aria-label="Stop writing">' + svg('x', 12) + '</button>' : `<button type="button" class="pd-ai" data-draft="changes" data-key="draft-changes" title="${esc(draftTip('Draft it from the open issues'))}" aria-label="Draft it from the open issues"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path></svg></button>`}</span></div>
      ${ui.changesErr ? draftFail('changes') : ''}${acts('Send to the planner')}</form>`;
  }
  if (ui.confirm) {
    const c = ui.confirm; const busy = !!ui.busy && !ui.dialog;
    const err = c.err && { title: c.err.title, detail: c.err.detail, extra: c.err.odd ? `<button type="button" class="pd-retry" data-say="${esc(DETAILS)}" data-key="err-details">Details</button>` : '' };
    return R.confirmStrip({ text: c.text, yes: c.yes, danger: c.danger, busy: busy ? working(c.label) : '', err });
  }
  return '';
}
// Create PR, as today's dialog: Into (base branch), the PRs for a group, the title and a description you write or
// Generate drafts with AI (Write / Preview, Stop while it drafts), Draft and the issue it closes, then Watch. It is
// the app's standard dialog (.viewer-modal .dlg), not the strip: it is a form, not a yes or no.
const md = (t) => esc(t).split('\n').map((l) => (l.startsWith('## ') ? `<h3>${l.slice(3)}</h3>` : l.startsWith('- ') ? `<li>${l.slice(2).replace(/`([^`]+)`/g, '<code>$1</code>')}</li>` : l.trim() ? `<p>${l}</p>` : '')).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
function prDialogHtml(v) {
  if (ui.dialog !== 'pr') return '';
  const pr = ui.pr; const stacked = v.runs.length && !/^Create PR$/.test(ui.dialogLabel);
  const SPARK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path></svg>';
  const EYE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>';
  const sug = '<span class="pd-sug">Suggested</span>';
  const H = v.tabData.helper.pr; const tip = (what) => `${what} · writes with ${H.model} (Models › Helper jobs › ${H.job})`;
  // Worca could not write it: the field keeps the text it had, says so, and offers Try again.
  const fail = (f, pi, sfx, gen) => `<span class="pd-fail" role="status">Couldn’t write it: no answer from ${esc(H.model)} in 20s. The text is as it was. <button type="button" class="pd-retry" data-pd="${gen}"${pi} data-key="pd-retry-${gen}${sfx}">Try again</button></span>`;
  // The title and description fields, shared by one PR and by each PR of a stack (i is its row, -1 for one PR).
  const fields = (f, i) => {
    const sfx = i < 0 ? '' : '-' + i; const pi = ` data-pi="${i}"`;
    return `<div class="pd-f"><span class="pd-lab"><label for="pd-title${sfx}">Title</label>${f.titleSuggested && !f.genTitle ? sug : ''}</span>
      <div class="pd-adorn${f.genTitle ? ' is-writing' : ''}"><input class="input" id="pd-title${sfx}" type="text" maxlength="256" value="${f.genTitle ? '' : esc(f.title)}" placeholder="${f.genTitle ? 'Suggesting a title…' : 'Title'}" data-key="pd-title${sfx}"${f.genTitle ? ' readonly' : ''}><span class="pd-act"><button type="button" class="pd-ai" data-pd="gentitle"${pi} data-key="pd-gentitle${sfx}" title="${esc(tip('Suggest a title'))}" aria-label="Suggest a title">${SPARK}</button></span></div>${f.errTitle ? fail(f, pi, sfx, 'gentitle') : ''}</div>
    <div class="pd-f"><span class="pd-lab"><label for="pd-desc${sfx}">Description</label>${f.descSuggested && !f.gen ? sug : ''}${f.gen ? `<button type="button" class="pd-stop" data-pd="stop"${pi} data-key="pd-stop${sfx}" title="Stop" aria-label="Stop writing">${svg('x', 12)}</button>` : `<button type="button" class="pd-ai" data-pd="gen"${pi} data-key="pd-gen${sfx}" title="${esc(tip('Write it from the run'))}" aria-label="Write the description from the run">${SPARK}</button>`}<button type="button" class="pd-eye${f.mode === 'preview' ? ' is-on' : ''}" data-pdmode="${f.mode === 'preview' ? 'write' : 'preview'}"${pi} data-key="pd-eye${sfx}" aria-pressed="${f.mode === 'preview'}" title="Preview" aria-label="Preview">${EYE}</button></span>
      <div class="pd-adorn${f.gen ? ' is-writing' : ''}">${f.mode === 'preview' ? `<div class="pd-preview">${f.desc ? md(f.desc) : '<p class="rtab-dim">Nothing to preview yet.</p>'}</div>` : `<textarea class="textarea" id="pd-desc${sfx}" rows="7" placeholder="${f.gen ? 'Writing from the run: what it did, its changes, how it was checked…' : 'Optional: empty uses the title'}" data-key="pd-desc${sfx}"${f.gen ? ' readonly' : ''}>${f.gen ? '' : esc(f.desc)}</textarea>`}</div>${f.errDesc ? fail(f, pi, sfx, 'gen') : ''}</div>`;
  };
  // A stack, reviewed by exception: the rows are the stack shown once (order, size, base); Worca writes every title
  // and description, and you open a row only to change it. A row Worca thinks is worth a look says why.
  const sh = v.ship;
  const rowLine = (f, i) => f.made ? `<span class="st-sum">Opened ${esc(f.made)}</span>` : f.gen || f.genTitle ? '<span class="st-writing">Writing…</span>'
    : (f.errDesc || f.errTitle) && !f.open ? '<span class="st-sum">Couldn’t write it; today’s text stays</span>'
    : v.tabData.prFlag[i] ? `<span class="st-flag">${esc(v.tabData.prFlag[i])}</span>` : `<span class="st-sum" title="${esc(v.tabData.prSum[i] || '')}">${esc(v.tabData.prSum[i] || '')}</span>`;
  const rowsHtml = stacked && pr.prs ? `<div class="pd-f"><span class="pd-hint">Worca writes each title and description from its run. Open a row only to change it.</span><ol class="st-list">${pr.prs.map((f, i) => `<li class="st-row"><button type="button" class="st-head" data-prrow="${i}" data-key="prrow:${i}" aria-expanded="${!!f.open}"${f.made ? ' disabled' : ''}>${svg('chevron', 14).replace('M6 9.5l6 6 6-6', f.open ? 'M6 9.5l6 6 6-6' : 'M9.5 6l6 6-6 6')}<span class="st-num">PR ${i + 1}</span><span class="st-mid"><span class="st-t" title="${esc(f.title)}">${esc(f.title)}</span>${rowLine(f, i)}</span><span class="st-meta"><span>${esc((sh.sizes || [])[i] || '')} · ${v.tabData.prFiles[i] || 1} files</span><span>${i ? 'into PR ' + i : 'into ' + esc(pr.base)}</span></span></button>${f.open && !f.made ? `<div class="st-body">${fields(f, i)}</div>` : ''}</li>`).join('')}</ol></div>` : '';
  const title = stacked ? '' : fields(pr, -1);
  const branch = v.place.branch || 'feat/unified-page-navigation';
  // The sentence says what opens, from where, into what; how many PRs is a picker in it, like the base.
  const shipPick = sh ? `<span class="rc-pop pd-basepop"><button type="button" class="pd-base pd-ship" data-menu="pdship" data-key="menu:pdship" aria-haspopup="menu" aria-expanded="${ui.menu === 'pdship'}" title="How many PRs">${sh.pick === 'one' ? 'One PR' : sh.n + ' stacked PRs'}${svg('chevron', 12)}</button>${menu('pdship', [
    { id: 'ship:stack', text: sh.n + ' stacked PRs', checked: sh.pick !== 'one', hint: sh.rec !== 'one' ? 'Suggested' : '', help: 'One PR per run, each into the one before' },
    { id: 'ship:one', text: 'One PR', checked: sh.pick === 'one', hint: sh.rec === 'one' ? 'Suggested' : '', off: !!sh.oneBlocked, help: sh.oneBlocked || 'Every run in one review' }])}</span><span>from</span>` : '';
  const shipHint = sh ? `<span class="pd-hint">${esc((sh.pick === sh.rec ? 'Worca suggests this: ' : 'Worca suggests ' + (sh.rec === 'one' ? 'one PR' : sh.n + ' stacked PRs') + ': ') + sh.reason)}</span>` : '';
  const into = `<div class="pd-f"><div class="pd-into">${shipPick}<code class="pd-br" title="${esc(branch)}">${esc(branch)}</code><span>into</span><span class="rc-pop pd-basepop"><button type="button" class="pd-base" data-menu="pdbase" data-key="menu:pdbase" aria-haspopup="menu" aria-expanded="${ui.menu === 'pdbase'}" title="Base branch · pushes to origin">${esc(pr.base)}${svg('chevron', 12)}</button>${menu('pdbase', ['dev', 'main'].map((x) => ({ id: 'base:' + x, text: x, checked: pr.base === x })))}</span></div>
    ${shipHint}<span class="pd-hint${pr.base === 'main' ? ' is-warn' : ''}">${pr.base === 'main' ? 'main is 41 commits behind dev; the PR would carry them too' : 'dev has 2 new commits since the run started; they merge cleanly'}</span></div>`;
  const opts = `<div class="pd-opts"><label class="pd-check"><input type="checkbox" id="pd-draft" data-key="pd-draft"${pr.draft ? ' checked' : ''}> Draft</label><label class="pd-check"><input type="checkbox" id="pd-watch" data-key="pd-watch"${pr.watch ? ' checked' : ''}> Watch: fix failing checks</label><span class="pd-hint pd-closes">${stacked ? 'The last PR closes ' : 'Closes '}${esc(v.tabData.issue)}</span></div>`;
  const alert = pr.err ? `<div class="pd-alert" role="alert"><b>${esc(pr.err.title)}</b><span>${esc(pr.err.detail)}${pr.err.odd ? ` <button type="button" class="pd-retry" data-say="${esc(DETAILS)}" data-key="err-details">Details</button>` : ''}</span></div>` : '';
  const busy = !!ui.busy;
  // The Dialog component: its head (title, Close), the one scrolling body, its foot (Cancel, the step naming what happens).
  return R.dialog({ title: ui.dialogLabel, id: 'pd-h', close: svg('x', 14), body: `${into}${rowsHtml}${title}${opts}${alert}`,
    yes: ui.dialogLabel, busy, busyLabel: working(ui.dialogLabel),
    hooks: { close: { 'data-pd': 'cancel', 'data-key': 'pd-close' }, cancel: { 'data-pd': 'cancel', 'data-key': 'pd-cancel' }, yes: { 'data-pd': 'ok', 'data-key': 'pd-ok' } } });
}
// Writing for you (the violet shimmer): the title quickly, the description from the run; Stop ends it.
const live = (f) => ui.pr && (f === ui.pr || (ui.pr.prs || []).includes(f));
// If Worca cannot write it (an error, or no answer in 20s), nothing changes: the field keeps the text it had.
function generate(f = ui.pr, i = -1, delay = 1400) {
  const v = M.view(ui.caseId, ui); const fails = takeFail();
  f.gen = true; f.mode = 'write'; f.errDesc = false;
  setTimeout(() => { if (!live(f) || !f.gen) return; f.gen = false;
    if (fails) { f.errDesc = true; render(); return; }
    f.desc = i < 0 ? v.tabData.prBody(v.title, v.tabData.files) : v.tabData.prBodyStack(i, ui.pr.prs.map((x) => x.title), v.title); f.descSuggested = true; render(); }, delay);
}
function generateTitle(f = ui.pr, i = -1, delay = 700) {
  const v = M.view(ui.caseId, ui); const fails = takeFail();
  f.genTitle = true; f.errTitle = false;
  setTimeout(() => { if (!live(f) || !f.genTitle) return; f.genTitle = false;
    if (fails) { f.errTitle = true; render(); return; }
    f.title = i < 0 ? (ui.pr.titleN++ % 2 ? 'One head for run and group pages, breadcrumb in the top bar' : v.title) : v.runs[i].title; f.titleSuggested = true; render(); }, delay);
}
// Each stacked PR starts from today's text (the server's template) and Worca writes over it; all rows start closed.
function startStack(v) {
  const titles = v.runs.map((r) => r.title);
  ui.pr.prs = v.runs.map((r, i) => ({ title: r.title, desc: v.tabData.prTemplate(i, titles, v.title), gen: false, genTitle: false, titleSuggested: true, descSuggested: false, mode: 'write', open: false }));
  ui.pr.prs.forEach((f, i) => generate(f, i, 900 + i * 600));
}
// A question is answered where it is asked: under its step, Worca's pick checked, the other options and your own
// words; the card's Send answer sends it. A multi-question Clarify shows the one it is on.
function answerHtml(q) {
  const pick = ui.answer === null || ui.answer === undefined ? q.pick : ui.answer;
  return `<li class="sc-answer${ui.flashAnswer ? ' is-flash' : ''}">${q.n ? `<p class="sc-ans-q">${esc(q.q)} <span class="rtab-dim">${esc(q.n)}</span></p>` : ''}<p class="sc-ans-why">${esc(q.why)}</p>
    <div class="sc-ans-opts" role="radiogroup" aria-label="${esc(q.q)}">${q.options.map((o, i) => `<button type="button" class="sc-ans-opt" role="radio" aria-checked="${i === pick}" tabindex="${i === pick ? 0 : -1}" data-answer="${i}" data-key="answer:${i}"><span class="sc-ans-dot" aria-hidden="true"></span><span class="sc-ans-l">${esc(o)}</span>${i === q.pick ? '<span class="sc-ans-hint">Worca’s pick</span>' : ''}</button>`).join('')}</div>
    <div class="pd-adorn${ui.answerDraft ? ' is-writing' : ''}"><input class="input input-sm" id="answer-own" type="text" placeholder="${ui.answerDraft ? 'Writing an answer from the review…' : 'Or write your own answer'}" aria-label="Your own answer" data-key="answer-own" value="${ui.answerDraft ? '' : esc(ui.answerOwn || '')}"${ui.answerDraft ? ' readonly' : ''}><span class="pd-act">${ui.answerDraft ? '<button type="button" class="pd-stop" data-stopdraft="answer" data-key="draft-stop" aria-label="Stop writing">' + svg('x', 12) + '</button>' : `<button type="button" class="pd-ai" data-draft="answer" data-key="draft-answer" title="${esc(draftTip('Draft an answer from the review'))}" aria-label="Draft an answer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"></path></svg></button>`}</span></div>${ui.answerErr ? draftFail('answer') : ''}</li>`;
}
const v0 = () => M.view(ui.caseId, ui);
function goMember(group, i) {
  Object.assign(ui, { caseId: M.view(group, {}).runCases[i], parent: { caseId: group, index: i }, open: null, tab: '', focus: '', menu: '', titleOpen: false });
  pick.value = ui.caseId; pendingFocus = 'crumb:' + (M.view(ui.caseId, ui).crumbs.length - 1);
}
function addChip(text, kind) {
  const t = String(text).trim();
  if (t && !ui.chips.some((c) => c.kind === kind && c.text === t)) ui.chips = ui.chips.concat({ kind, text: t });
}
// Typing a word adds a label; typing key: value adds a cost tag. The editor stays open for the next one.
function addTag(text) { const t = String(text).trim(); if (!t) return; addChip(t, /^[^:]+:\s*\S/.test(t) ? 'tag' : 'label'); pendingFocus = 'tag-input'; }

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (t && t.id === 'next-event') { nextEvent(); return; }
  if (t && t.dataset.fixpart !== undefined) { ui.broken = false; pendingFocus = 'tab:' + ((M.view(ui.caseId, ui).tabs.find((x) => x.sel) || {}).id || ''); toast('Reloaded the part'); render(); return; }
  if (t && t.dataset.crash) { const k = t.dataset.crash; ui.crash = null; if (k === 'reload') toast('Reloaded'); pendingFocus = 'act-main'; render(); return; }
  if (t && t.id === 'restart') { ui = fresh('starting'); pick.value = 'starting'; pendingFocus = 'act-main'; toast('Restarted: a new run'); render(); return; }
  if (t && t.dataset.themePick) {
    document.documentElement.dataset.theme = t.dataset.themePick;
    document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)));
    return;
  }
  const sayEl = e.target.closest('#card [data-say]');
  if (sayEl) { e.preventDefault(); toast(sayEl.dataset.say); pendingFocus = sayEl.dataset.key || ''; ui.menu = ''; render(); return; }
  const zone = e.target.closest('[data-tagzone]');
  if (zone && !e.target.closest('[data-untag], [data-menu]')) { const opening = ui.menu !== 'tags'; ui.menu = opening ? 'tags' : ''; pendingFocus = opening ? 'tag-input' : 'menu:tags'; render(); return; }
  const tick = e.target.closest('[data-tick]');
  if (tick) {
    // a tick changes only the box (the browser already did) and its section's count: nothing else repaints
    const i = +tick.dataset.tick; ui.ticks = tick.checked ? ui.ticks.concat(i) : ui.ticks.filter((x) => x !== i);
    const n = tick.closest('.ov-checks').querySelectorAll('[data-tick]').length - ui.ticks.length;
    const c = tick.closest('.ov-focus')?.querySelector('.rtab-h .n'); if (c) c.textContent = n ? n + ' to check' : 'all checked';
    return;
  }
  if (!t && e.target.closest('[data-title]')) { ui.titleOpen = !ui.titleOpen; render(); return; }
  if (!t || !t.closest('#card')) { if (ui.menu && !e.target.closest('.menu')) { ui.menu = ''; render(); } return; }
  const d = t.dataset;
  if (d.confirm && ui.dialog === 'after') {
    if (d.confirm === 'yes') { const task = (document.getElementById('after-task')?.value || '').trim() || 'Follow-up to ' + M.view(ui.caseId, ui).title; const when = document.getElementById('after-when')?.value || document.getElementById('after-when-t')?.textContent || '';
      ui.after = ui.after.concat({ task, when }); toast((when.startsWith('Now') ? 'Started: ' : 'Scheduled: ') + task + (when.startsWith('Now') ? '' : ' · ' + when.toLowerCase())); }
    ui.dialog = ''; ui.afterDraft = ''; pendingFocus = 'menu:more';
  }
  else if (d.draft) { draft(d.draft); pendingFocus = 'draft-stop'; }
  else if (d.stopdraft) { ui[d.stopdraft === 'answer' ? 'answerDraft' : 'changesDraft'] = false; clearTimeout(draftTimer); pendingFocus = d.stopdraft === 'answer' ? 'answer-own' : 'changes-text'; }
  else if (d.confirm && ui.dialog === 'changes') { if (d.confirm === 'yes') { const txt = (document.getElementById('changes-text')?.value || '').trim(); toast(txt ? 'Sent to the planner; it plans again' : 'Write what to change first'); if (!txt) return; } ui.dialog = ''; ui.changesDraft = false; pendingFocus = 'act-main'; }
  else if (d.pd === 'ok') { const f = ui.dialogF; const pr = ui.pr; ui.pr.gen = false; follow(Object.assign({}, f, { dialog: '', fromDialog: true, say: f.say + (pr.draft ? ' as a draft' : '') + (pr.watch ? '; Worca watches it' : '') }), ui.dialogLabel); }
  else if (d.pd === 'cancel') { ui.dialog = ''; ui.busy = null; ui.pr.gen = false; pendingFocus = 'act-main'; }
  else if (d.pd === 'gen') { const i = +(d.pi ?? -1); generate(i < 0 ? ui.pr : ui.pr.prs[i], i); pendingFocus = 'pd-stop' + (i < 0 ? '' : '-' + i); }
  else if (d.pd === 'gentitle') { const i = +(d.pi ?? -1); generateTitle(i < 0 ? ui.pr : ui.pr.prs[i], i); pendingFocus = 'pd-gentitle' + (i < 0 ? '' : '-' + i); }
  else if (d.prrow !== undefined) { const f = ui.pr.prs[+d.prrow]; f.open = !f.open; pendingFocus = t.dataset.key; }
  else if (d.pd === 'stop') { const i = +(d.pi ?? -1); (i < 0 ? ui.pr : ui.pr.prs[i]).gen = false; pendingFocus = 'pd-gen' + (i < 0 ? '' : '-' + i); toast('Stopped writing'); }
  else if (d.pdmode) { const i = +(d.pi ?? -1); (i < 0 ? ui.pr : ui.pr.prs[i]).mode = d.pdmode; pendingFocus = t.dataset.key; }
  else if (d.confirm) { if (d.confirm === 'yes') { ui.confirm.ok = true; follow(ui.confirm.f, ui.confirm.label); } else { ui.confirm = null; pendingFocus = 'act-main'; } }
  else if (d.run === 'stop') follow(M.runFlow.stop, 'Stop the run');
  else if (d.act) act(d.act);
  else if (d.menu) { const opening = ui.menu !== d.menu; ui.menu = opening ? d.menu : ''; if (opening) pendingFocus = d.menu === 'tags' ? 'tag-input' : 'menu-first'; }
  else if (d.menuPick) {
    if (d.menuPick.startsWith('base:')) { ui.pr.base = d.menuPick.slice(5); ui.menu = ''; pendingFocus = 'menu:pdbase'; }
    else if (d.menuPick.startsWith('ship:')) {
      const want = d.menuPick.slice(5); const sh = M.view(ui.caseId, ui).ship; ui.menu = ''; pendingFocus = 'menu:pdship';
      if (want === 'one' && sh.oneBlocked) toast(sh.oneBlocked);
      else { ui.ship = want; const nv = M.view(ui.caseId, ui); ui.dialogLabel = nv.action.label; ui.dialogF = M.flow[ui.caseId][nv.action.label]; ui.pr.err = null;
        if (want === 'one' && !ui.pr.desc && !ui.pr.gen) { generateTitle(); generate(); }
        if (want === 'stack' && !ui.pr.prs) startStack(nv); }
    }
    else if (d.menuPick.startsWith('away:')) { ui.away = d.menuPick; ui.menu = ''; pendingFocus = 'menu:more'; toast('Away mode on this run: ' + AWAY.find((x) => x.id === d.menuPick).text); }
    else if (d.menuPick === 'more:after') { ui.dialog = 'after'; ui.menu = ''; pendingFocus = 'after-task'; }
    else if (d.menuPick === 'more:archive') follow({ to: 'archived', confirm: 'Archive this run? The local branch, worktree and logs are removed; the remote branch and any PR stay.' }, 'Archive');
    else if (d.menuPick === 'more:restore') { goCase('merged'); toast('Restored to Runs'); }
    else if (d.menuPick === 'group:ask' || d.menuPick === 'group:go') { const ask = d.menuPick === 'group:ask'; ui.menu = ''; pendingFocus = 'menu:then';
      toast(ask === ui.askEach ? (ask ? 'Already asks first' : 'Already starts by itself') : ask ? 'Worca asks before each run starts' : 'Each run starts by itself'); ui.askEach = ask; }
    else if (CH_SAY[d.menuPick]) { toast(CH_SAY[d.menuPick](M.view(ui.caseId, ui))); pendingFocus = 'menu:ch'; ui.menu = ''; }
    else if (MORE_SAY[d.menuPick]) { toast(MORE_SAY[d.menuPick]); pendingFocus = 'menu:more'; ui.menu = ''; }
    else if (ui.menu === 'act') act(d.menuPick);
    else if (d.menuPick === 'ungroup') { const g = (ui.chips.find((c) => c.kind === 'group') || {}).text; ui.chips = ui.chips.filter((c) => c.kind !== 'group'); ui.menu = ''; pendingFocus = 'menu:more'; toast('Left ' + g); }
    else if (d.menuPick === 'more:group') { ui.menu = 'groups'; pendingFocus = 'group-input'; }
    else { pendingFocus = 'menu:' + ui.menu; ui.menu = ''; }
  }
  else if (d.untag) { const [k, tx] = d.untag.split('|'); ui.chips = ui.chips.filter((c) => !(c.kind === k && c.text === tx)); pendingFocus = 'menu:tags'; toast('Removed ' + tx); }
  else if (d.listtoggle) {
    const [k, tx] = d.listtoggle.split('|'); const has = ui.chips.some((c) => c.kind === k && c.text === tx);
    if (k === 'group') { ui.chips = ui.chips.filter((c) => c.kind !== 'group').concat(has ? [] : [{ kind: 'group', text: tx }]); ui.menu = ''; pendingFocus = 'menu:more'; toast(has ? 'Left ' + tx : 'Moved to ' + tx); }
    else { ui.chips = has ? ui.chips.filter((c) => !(c.kind === k && c.text === tx)) : ui.chips.concat({ kind: k, text: tx }); pendingFocus = t.dataset.key; }
  }
  else if (d.replan !== undefined) { const n = +d.replan + 1; follow({ say: 'The planner re-cut runs ' + n + ' and on; runs before it stay', confirm: 'Re-plan from run ' + n + '? The planner re-cuts runs ' + n + ' and on; runs 1' + (n > 2 ? '–' + (n - 1) : '') + ' stay as they are.' }, 'Re-plan from here'); }
  else if (d.openRun !== undefined) { ui.back = { caseId: ui.caseId, open: ui.open, tab: ui.tab }; goMember(ui.caseId, +d.openRun); }
  else if (d.sib !== undefined && d.sib !== '') { const v = M.view(ui.caseId, ui); goMember(v.parent.caseId, +d.sib); pendingFocus = t.dataset.key; }
  else if (d.crumb !== undefined) {
    // Up to the group: back where you left it if you came from there, else with this run's segment open.
    const go = M.view(ui.caseId, ui).crumbs[+d.crumb].go;
    const back = ui.back && ui.back.caseId === go.caseId ? ui.back : { caseId: go.caseId, open: go.open, tab: '' };
    Object.assign(ui, { caseId: back.caseId, open: back.open, tab: back.tab, parent: null, back: null, menu: '' });
    pick.value = ui.caseId; pendingFocus = 'open-run';
  }
  else if (d.stage) { ui.open = d.stage; ui.menu = ''; }
  else if (d.tab) { ui.tab = d.tab; ui.focus = ''; if (t.classList.contains('rc-fig-link')) pendingFocus = 'tab:' + d.tab; }
  else if (d.ref) { ui.tab = 'activity'; ui.view = 'steps'; ui.focus = d.ref; pendingFocus = 'act:' + d.ref; render(); document.querySelector('.is-focus')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); return; }
  else if (d.view) ui.view = d.view;
  else if (d.go) {
    const [kind, n] = d.go.split(':');
    if (kind === 'tab') ui.tab = n;
    else { ui.tab = 'changes'; if (kind === 'file') ui.file = +n; ui.land = d.go; pendingFocus = kind === 'file' ? 'file:' + n : 'art:' + n; }
    render(); ui.land = '';
    document.querySelector('.ch-file.is-flash')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); return;
  }
  else if ('askopen' in d) { ui.askOpen = !ui.askOpen; pendingFocus = 'ask-open'; }
  else if ('goanswer' in d) { pendingFocus = 'answer:' + (ui.answer ?? v0().ask.pick); ui.flashAnswer = true; render(); ui.flashAnswer = false; document.querySelector('.sc-answer')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); return; }
  else if (d.unafter !== undefined) { ui.after = ui.after.filter((_, i) => i !== +d.unafter); toast('Scheduled run cancelled'); pendingFocus = 'menu:more'; }
  else if (d.answer !== undefined) { ui.answer = +d.answer; pendingFocus = 'answer:' + d.answer; }
  else if (d.file !== undefined) { ui.file = ui.file === +d.file ? null : +d.file; pendingFocus = 'file:' + d.file; }
  else if (d.filter) { ui.actFilter = d.filter; pendingFocus = 'filter:' + d.filter; }
  else if (d.rounds) { ui.rounds = ui.rounds.includes(d.rounds) ? ui.rounds.filter((x) => x !== d.rounds) : ui.rounds.concat(d.rounds); pendingFocus = 'rounds:' + d.rounds; }
  else if (d.key === 'act-main') act(d.label);
  else { if (ui.menu) { ui.menu = ''; render(); } return; }
  render();
});

// Keys: tabs and stages move with arrows / Home / End and select as they move; the ship choice is a radio group;
// menus take ↑ ↓ Home End, and Escape or Tab close them with focus back on their trigger.
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.id === 'group-input' && e.key === 'Enter') { e.preventDefault(); const g = t.value.trim(); if (g) { ui.chips = ui.chips.filter((c) => c.kind !== 'group').concat({ kind: 'group', text: g }); ui.menu = ''; pendingFocus = 'menu:more'; toast((KNOWN.group.some(([x]) => x === g) ? 'Moved to ' : 'Created and moved to ') + g); } render(); return; }
  if (t.id === 'tag-input' && e.key === 'Enter') { e.preventDefault(); addTag(t.value); render(); return; }
  if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') && document.querySelector('.rc-tags')) { e.preventDefault(); ui.menu = 'tags'; pendingFocus = 'tag-input'; render(); return; }
  if ((ui.confirm || ui.dialog) && e.key === 'Escape' && !ui.menu) { if (ui.pr) { ui.pr.gen = false; ui.pr.genTitle = false; (ui.pr.prs || []).forEach((f) => { f.gen = false; f.genTitle = false; }); } ui.confirm = null; ui.dialog = ''; ui.busy = null; pendingFocus = 'act-main'; render(); return; }
  if (e.key === '`' && e.ctrlKey) { e.preventDefault(); toast('Terminal opened in the worktree'); render(); return; }
  if (e.key === 'Enter' && e.target.id === 'after-task') { e.preventDefault(); document.querySelector('[data-confirm="yes"]')?.click(); return; }
  if (ui.menu && (e.key === 'Escape' || (e.key === 'Tab' && t.closest && t.closest('.menu')))) {
    pendingFocus = ui.menu === 'groups' ? 'menu:more' : 'menu:' + ui.menu; ui.menu = ''; render(); if (e.key === 'Escape') e.preventDefault(); return;
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
// A case named in the address (#question) opens on load, so a review sheet can show every state at once.
{ const h = location.hash.slice(1); if (M.cases.some((c) => c.id === h)) { pick.value = h; pick.dispatchEvent(new Event('change')); } else render(); }
