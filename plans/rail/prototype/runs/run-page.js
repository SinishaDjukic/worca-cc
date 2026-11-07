(function () {
// Run card v2 mock: renders RunCardModel.view() (run-page-model.js) with Worca's own classes, and keeps the
// viewer's choices (case, open stage, added chips, ship mode, open menu) in `ui`.
const M = window.RunCardModel;
// The page is built from the Worca Rail components (ui/public/design-system/components/, bundled as components.js).
const R = window.RailUI;
const SHELL = window.RailShell || null;   // the one Worca: the run page answers only inside #card and its tools

const svg = (name, size) => R.icon(name, size);
const esc = R.esc;

// a case starts fresh: nothing from the case before it carries over
const fresh = (caseId) => ({ caseId, run: null, groupRun: null, question: 0, pauseAfter: false, cmd: null, askOpen: false, land: '', open: null, chips: [], ship: '', menu: '', tab: '', focus: '', view: 'steps', parent: null, back: null, dialog: '', after: [], away: '', askEach: false, answer: null, file: null, actFilter: 'all', rounds: [], ticks: [], taskOpen: false, stackSt: null, busy: null, broken: false, crash: null, offline: false, over: {}, restGone: false, watched: null, fixed: {}, outline: null, outlineEdited: false, marks: {}, markText: {}, lines: [], showMet: false, showEarlier: false, copy: false, services: {}, comments: {}, commentOn: null, picked: null, session: 0, doc: null, graphNode: null, graphZoom: '', form: null, log: { from: 'all', level: 'all', step: 'all', cycle: 'all', session: 'all', q: '', raw: false, follow: true } });
R.watchScrollbars(document);
let ui = fresh('working');

const statusDot = (v) => (SHELL ? R.kindMark({ kind: 'task', tone: R.markTone(v), ...M.stageOf(ui.caseId), title: v.word }) : R.statusDot({ tone: v.dot, sym: v.sym, glyph: R.ICONS[v.sym === 'q' ? 'question' : 'alert'] }));
// A menu: an optional line on what the main action does, then each item with its one-line help.
// One compact menu everywhere, as the app's View menu: one line per item, a leading check for a choice, a hint on the
// right (a count or a shortcut), the help in the tooltip; danger items come last, after a rule.
const DANGER = /^(Discard|Stop|Stop the run|Stop run \d+|Archive|Delete|Delete run|Cancel|Cancel the rest)$/;
function menu(id, items) {
  if (ui.menu !== id) return '';
  return R.compactMenu({ items: items.map((it) => (it.sep || it.header ? it : Object.assign({ danger: DANGER.test(it.text) }, it))) });
}
// Labels and cost tags are one group on the metadata line: a tag mark, then each name in a quiet outline (labels
// first, then cost tags, which read as key: value), what does not fit folded into +N. The group is one button; it
// opens one editor (also L). No colour, no ×: removing is in the editor.
const KNOWN = { label: [['ui', 12], ['needs demo', 4], ['hotfix', 7], ['release', 9], ['docs', 2]], tag: [['team: web', 31], ['team: api', 18], ['client: acme', 6]],
  group: [['Navigation', 4], ['Billing export', 2], ['Onboarding', 3]] };
const tagsOf = () => ui.chips.filter((c) => c.kind === 'label').concat(ui.chips.filter((c) => c.kind === 'tag'));
const tagGroupHtml = () => R.tagGroup({ items: tagsOf(), open: ui.menu === 'tags', editor: tagEditorHtml() });
// One list editor, shared by labels and cost tags and by groups: many choices for tags, one for a group.
function listEditorHtml({ label, inputId, placeholder, sections, hint }) {
  const on = (k, t) => ui.chips.some((c) => c.kind === k && c.text === t);
  const rows = (kind) => KNOWN[kind].concat(ui.chips.filter((c) => c.kind === kind && !KNOWN[kind].some(([t]) => t === c.text)).map((c) => [c.text, 1])).map(([text, n]) => ({ text, n, on: on(kind, text) }));
  return R.listEditor({ label, inputId, placeholder, hint, sections: sections.map((s) => Object.assign({}, s, { rows: rows(s.kind) })) });
}
const tagEditorHtml = () => listEditorHtml({ label: 'Labels and cost tags', inputId: 'tag-input', placeholder: 'A label, or key: value for a cost tag',
  sections: [{ title: 'Labels', kind: 'label', many: true }, { title: 'Cost tags', kind: 'tag', many: true }], hint: 'Cost tags split this run’s cost in Statistics' });
const groupEditorHtml = () => listEditorHtml({ label: 'Move to group', inputId: 'group-input', placeholder: 'Find or create a group',
  sections: [{ title: 'Groups', kind: 'group', many: false }], hint: 'A group tracks related runs on one page; a run is in one at a time' });
// Every focusable control carries data-key, so a render keeps keyboard focus on it (or moves it on purpose via
// pendingFocus) instead of dropping it to the page.
let pendingFocus = '';
let lastOpen = '';

// A picker among the words of a form or a line: the chosen words, its ▾, its menu.
const wordPick = (id, text, tip, items, cls = '') => R.wordPicker({ text, tip, cls, chevron: svg('chevron', 12), open: ui.menu === id, menuHtml: menu(id, items), attrs: { 'data-menu': id, 'data-key': 'menu:' + id } });

const logsShow = () => R.runPartShows('logs', R.prefs.mode());
let logsGone = false;   // archived or deleted: the logs went with the worktree, so nothing offers them
function rowHtml(r, full) {
  const logs = logsShow() && !logsGone;
  const log = logs && full && !/is-next/.test(r.rowCls) && !r.evidence ? R.button({ label: 'Log', kind: 'quiet', cls: 'rtab-log', attrs: { 'data-key': 'log:' + r.akey, 'data-logstep': r.logStep || r.name } }) : '';
  // A failed or blocked step shows what broke, its last lines and a way into the log, in Activity only.
  const ev = r.evidence ? `<div class="rtab-ev"><p class="rtab-ev-t">${esc(r.evidence.title)}</p><pre class="rtab-ev-l">${r.evidence.lines.map(esc).join('\n')}</pre>${logs ? R.button({ label: r.evidence.log, attrs: { 'data-key': 'log:' + r.akey, 'data-logstep': r.logStep || r.name } }) : ''}</div>` : '';
  return R.stepRow(r, { full, action: log, below: ev });
}

const DOTS = svg('dots', 14);
// A run of a cut: Merge with next and Remove, right on its row; Undo edits comes back while anything is changed.
function outlineMenu(r) {
  const id = 'cut' + r.index; const last = r.index === r.total - 1; const two = r.total <= 2;
  const items = [{ id: `cut:merge|${r.index}`, text: 'Merge with next', off: last, help: last ? 'The last run has no next run' : 'Makes this run and the next one run' }]
    .concat(ui.outlineEdited ? [{ id: 'cut:undo|0', text: 'Undo edits', help: 'Back to the split as Worca wrote it' }] : [])
    .concat({ id: `cut:remove|${r.index}`, text: 'Remove', danger: true, off: two, help: two ? 'A cut has at least 2 runs; Don’t split builds it as one' : 'Leaves this run out of the plan' });
  return `<span class="rc-pop is-right">${R.button({ label: 'More for run ' + (r.index + 1), kind: 'quiet', iconOnly: true, title: false, icon: DOTS, attrs: { 'data-menu': id, 'data-key': 'menu:' + id, 'aria-haspopup': 'menu', 'aria-expanded': String(ui.menu === id) } })}${ui.menu === id ? R.compactMenu({ items }) : ''}</span>`;
}
function stackHtml(k) {
  const seg = '';
  const rows = k.rows.map((r) => R.stackRow(r.editable ? Object.assign({}, r, { end: outlineMenu(r) }) : r)).join('');
  const choice = k.note ? `<p class="sk-note sk-rec">${esc(k.note)}</p>` : '';
  return `<div class="sk${k.enter ? ' is-enter' : ''}"><div class="sk-head"><span class="rc-label">${esc(k.title)}</span>${seg}</div>${choice}<ol class="rd-route-list sk-list" aria-label="${esc(k.title)}">${rows}</ol></div>`;
}

// The tabs under the card: one question each, each fact in one place (spec › The tabs). Overview reports by exception:
// what this state needs from you in full, what went fine one line each; Changes is everything the run produced,
// grouped by what it is; Activity is every step with its rounds, model, cost and log, and what each step wrote;
// Decisions is who decided what. Time, cost against the budget and the diff size stay the card's figures.
const ICON_WHO = { you: 'whoYou', away: 'whoAway', default: 'whoDefault' };
const WHO = { you: 'You', away: 'Answered for you · Away mode', default: 'Worca’s default' };
function focusHtml(v) {
  const f = v.over.focus;
  if (!f) return '';
  if (f.kind === 'plan') {
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">The plan <span class="n">${f.items.length} steps</span></h2>
      <ol class="ov-plan">${f.items.map((x, i) => `<li><span class="ov-n">${i + 1}</span><span>${esc(x.t)}</span></li>`).join('')}</ol>
      ${f.issues.length ? `<h3 class="ov-sub is-warn">${f.issues.length} open issues</h3><ul class="rtab-list">${f.issues.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
</section>`;
  }
  if (f.kind === 'criteria') {
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">Requirements <span class="n">${f.items.length} agreed</span></h2><ul class="ov-issues">${f.items.map(([, t]) => `<li><span>${esc(t)}</span></li>`).join('')}</ul></section>`;
  }
  if (f.kind === 'reqs') {
    // Each requirement is marked here; Not met and Dropped count once they say why. Create PR opens when none is left.
    const rows = f.items.map(([id, t]) => { const m = ui.marks[id];
      const why = m && m !== 'met' ? R.field({ id: 'mark-' + id, label: m === 'dropped' ? 'Why it is dropped' : 'Where it moved', value: ui.markText[id] || '', attrs: { 'data-key': 'mark-' + id, 'data-marktext': id } }) : '';
      return `<li class="ov-req"><span>${esc(t)}</span>${R.segmented({ label: id + ' mark', hook: 'mark', items: [['met', 'Met'], ['not-met', 'Not met'], ['dropped', 'Dropped']].map(([k, l]) => ({ id: id + '|' + k, label: l, pressed: m === k })) })}${why}</li>`; }).join('');
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">Requirements <span class="n">${f.left ? f.left + ' left' : 'all marked'}</span></h2><ul class="ov-reqs">${rows}</ul></section>`;
  }
  if (f.kind === 'findings') {
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">${esc(f.title)}</h2>${f.note ? `<p class="rl-note">${esc(f.note)}</p>` : ''}${issuesHtml(f.issues)}${f.roles.length ? rolesHtml(f.roles, 'ov') : ''}</section>`;
  }
  if (f.kind === 'broke') {
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">What broke</h2>
      <div class="rtab-ev"><p class="rtab-ev-t">${esc(f.ev.title)}</p><pre class="rtab-ev-l">${f.ev.lines.map(esc).join('\n')}</pre>${logsShow() && !logsGone ? R.button({ label: f.ev.log, attrs: { 'data-key': 'ov-log', 'data-logstep': 'all' } }) : ''}</div></section>`;
  }
  const rows = f.items.map((x, i) => {
    const st = typeof x === 'string' ? (ui.ticks.includes(i) ? 'done' : 'next') : x.state;
    const t = typeof x === 'string' ? x : x.t;
    // A check says why it is here and, when there is one, its one way to act (to its home: Decisions, a file in Changes).
    const why = x.why ? `<span class="ov-why">${esc(x.why)}${x.act ? ' · ' + R.textLink({ label: x.act, attrs: { 'data-go': x.go, 'data-key': 'go:' + i } }) : ''}</span>` : '';
    if (f.kind === 'check') return `<li>${R.checkbox({ cls: 'ov-check', html: esc(t) + why, checked: st === 'done', attrs: { 'data-tick': i, 'data-key': 'tick:' + i } })}</li>`;
    return R.row({ kind: 'route', cls: 'is-' + st, rail: R.stepDot({ dotCls: st === 'done' ? 'is-done' : st === 'now' ? 'is-working is-pulse' : st === 'paused' ? 'is-closed' : 'is-future', word: st === 'done' ? 'Done' : st === 'now' ? 'In progress' : st === 'paused' ? 'Paused' : 'Not yet', icon: st === 'done' ? 'check' : st === 'now' ? 'now' : st === 'paused' ? 'pause' : '' }), text: `<span class="rd-route-name">${esc(t)}</span>` });
  }).join('');
  if (f.kind === 'check') {
    const n = f.items.length - ui.ticks.length;
    return `<section class="rtab ov-focus" id="ov-focus"><h2 class="rtab-h">${esc(f.title)} <span class="n">${n ? n + ' to check' : 'all checked'}</span></h2><ul class="ov-checks">${rows}</ul></section>`;
  }
  return `<section class="rtab ov-focus is-progress" id="ov-focus"><h2 class="rtab-h">The plan <span class="n">${esc(f.note)}</span></h2><ol class="rd-route-list ov-progress">${rows}</ol></section>`;
}
function summaryPanel(v) {
  const o = v.over;
  const extra = usedHtml(v) + checklistHtml(o.checklist) + (v.docsHere ? docsSection(v) : '');
  const after = ui.after.length ? `<section class="rtab"><h2 class="rtab-h">Runs after this <span class="n">${ui.after.length}</span></h2><ul class="ov-arts">${ui.after.map((x, i) => `<li><span class="ov-after-t" title="${esc(x.task)}">${esc(x.task)}</span><span class="rtab-dim">${esc(x.when)}</span>${R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-unafter': i, 'data-key': 'unafter:' + i } })}</li>`).join('')}</ul></section>` : '';
  // Before it is built, the ask is all there is to say about the outcome.
  const evidence = () => (o.evidence ? `<section class="rtab"><ol class="rd-route-list ov-lines">${R.lineRow({ mark: R.stepDot({ dotCls: 'is-done', word: 'Done', icon: 'check' }), text: o.evidence, link: true, attrs: { 'data-tab': 'activity', 'data-key': 'ov-evidence', title: 'Opens Activity: the tests, the review\'s rounds and the manual test' } })}</ol></section>` : '');
  if (!o.ask) return focusHtml(v) + after + evidence() + `<section class="rtab"><h2 class="rtab-h">What you asked</h2><p class="rtab-p ov-task${ui.taskOpen ? ' is-open' : ''}">${esc(M.asks?.[ui.caseId] || o.task)}</p></section>` + extra;
  // What went fine, one line each (What opens): the ask opens its parts in place, its only home; the evidence goes to
  // Activity, where the rounds and the steps live.
  const ok = R.stepDot({ dotCls: 'is-done', word: 'Done', icon: 'check' });
  const open = !!ui.askOpen;
  const parts = open ? `<p class="ov-quote">“${esc(M.asks?.[ui.caseId] || o.task)}”</p><ul class="ov-parts">${o.ask.parts.map(([part, how]) => `<li>${ok}<span><span class="ov-part">${esc(part)}</span><span class="ov-why">${esc(how)}</span></span></li>`).join('')}</ul><p class="ov-why">Not asked: ${esc(o.ask.unasked[0])} in <code>${esc(o.ask.unasked[1])}</code></p>` : '';
  const askLine = R.lineRow({ mark: ok, text: `Did all ${o.ask.parts.length} parts you asked, plus ${o.ask.unasked[0]}`, open, more: parts, attrs: { 'data-askopen': true, 'data-key': 'ask-open' } });
  const evLine = o.evidence ? R.lineRow({ mark: ok, text: o.evidence, link: true, attrs: { 'data-tab': 'activity', 'data-key': 'ov-evidence', title: 'Opens Activity: the tests, the review\'s rounds and the manual test' } }) : '';
  return focusHtml(v) + after + `<section class="rtab"><ol class="rd-route-list ov-lines">${askLine}${evLine}</ol></section>` + extra;
}
// One line that opens its detail in place (What opens): its mark, its words, › .
function lineRow(key, mark, text, more) {
  const open = ui.lines.includes(key);
  return R.lineRow({ mark, text, open, more, attrs: { 'data-line': key, 'data-key': 'line:' + key } });
}
const okDot = () => `<span class="rd-route-dot is-done" role="img" aria-label="Done">${svg('check', 10)}</span>`;
const warnDot = () => `<span class="rd-route-dot is-problem" role="img" aria-label="Needs attention">${svg('alert', 10)}</span>`;
const issuesHtml = (issues) => (issues.length ? `<ul class="ov-issues">${issues.map((x) => `<li>${R.chip({ text: x.sev })}<span>${esc(x.t)}<span class="ov-why">${esc(x.at)}</span></span></li>`).join('')}</ul>` : '');
// One independent reviewer per role: a line each, its findings open under it; one with findings opens by itself once.
function rolesHtml(roles, where) {
  return `<ol class="rd-route-list ov-lines" aria-label="Role reviews">${roles.map((r) => lineRow(where + ':role:' + r.role, r.n ? warnDot() : okDot(), r.role + ' · ' + r.t, r.findings.length ? `<ul class="ov-issues">${r.findings.map((t) => `<li><span>${esc(t)}</span></li>`).join('')}</ul>` : '<p class="ov-why">Nothing to report.</p>')).join('')}</ol>`;
}
// What the steps' perspectives checked, the latest cycle: what is not met stays open, with its evidence.
function checklistHtml(c) {
  if (!c) return '';
  const total = c.met.length + c.unmet.length;
  const met = ui.showMet ? `<ul class="ov-issues">${c.met.map((t) => `<li>${okDot()}<span>${esc(t)}</span></li>`).join('')}</ul>` : '';
  const earlier = ui.showEarlier ? `<ul class="ov-issues">${c.earlier.map(([n, t]) => `<li><span>${esc(n)} · ${esc(t)}</span></li>`).join('')}</ul>` : '';
  return `<section class="rtab rl-sec"><h2 class="rtab-h">Perspective checklists <span class="n">Cycle ${c.cycle}: ${c.met.length} of ${total} met</span></h2>
    <ul class="ov-issues">${c.unmet.map(([t, why]) => `<li>${warnDot()}<span>${esc(t)}<span class="ov-why">${esc(why)}</span></span></li>`).join('')}</ul>${met}${earlier}
    <div class="rl-tools">${R.button({ label: ui.showMet ? 'Hide met items' : `Show ${c.met.length} met items`, kind: 'quiet', attrs: { 'data-showmet': true, 'data-key': 'show-met', 'aria-expanded': String(ui.showMet) } })}${R.button({ label: 'Earlier cycles', kind: 'quiet', attrs: { 'data-showearlier': true, 'data-key': 'show-earlier', 'aria-expanded': String(ui.showEarlier) } })}</div></section>`;
}
// What the run used: the skills it mounted (Advanced), the memory it changed and where its worktree is (Expert).
function usedHtml(v) {
  if ((!v.over.ask && !v.bar.stop) || !v.has.started) return '';
  const d = v.tabData; const rows = [];
  if (R.shows('advanced')) rows.push(lineRow('skills', okDot(), d.skills.length + ' skills mounted', `<ul class="ov-issues">${d.skills.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ul>`));
  if (R.shows('expert')) rows.push(...(v.has.changes ? [lineRow('memory', okDot(), d.memory.length + ' memory changes', `<ul class="ov-issues">${d.memory.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ul>`)] : []), ...(v.has.worktree ? [lineRow('worktree', okDot(), 'Worktree', `<code>${esc(d.worktree)}</code>`)] : []));
  return rows.length ? `<section class="rtab"><ol class="rd-route-list ov-lines">${rows.join('')}</ol></section>` : '';
}
// A run with no Changes tab keeps its documents here.
function docsSection(v) {
  const arts = v.over.artifacts; if (!arts.length) return '';
  return `<section class="rtab"><h2 class="rtab-h">Documents <span class="n">${arts.length}</span></h2><ul class="ov-issues">${arts.map(([doc, step], i) => `<li><span>${R.documentLink({ name: doc, attrs: { 'data-doc': i, 'data-key': 'ovdoc:' + i, title: 'Open ' + doc } })}<span class="ov-why">from ${esc(step)}</span></span></li>`).join('')}</ul></section>`;
}
// Changes' Actions, under Check out: the worktree's services, its ports and the patch; in a workspace, only the
// projects that changed. They run on your machine, so on a hosted Worca they are off and say why.
const HOSTED_WHY = 'Actions run on your own machine; this Worca is hosted, so use your own checkout';
function actionsHtml(v) {
  if (!R.runPartShows('actions', R.prefs.mode())) return '';
  const d = v.tabData; const off = v.hosted;
  const hook = (o) => (off ? Object.assign({ disabled: true, title: HOSTED_WHY }, o) : o);
  const svc = d.services.map((x) => { const on = !!ui.services[x.id];
    return R.listRow({ title: x.name, meta: on ? 'Running on port ' + x.port : 'Port ' + x.port, end: R.button({ label: ui.svcBusy === x.id ? (on ? 'Stopping…' : 'Starting…') : on ? 'Stop' : 'Start', kind: 'quiet', attrs: ui.svcBusy === x.id ? { disabled: true, title: 'Waiting for the service', 'data-key': 'svc:' + x.id } : hook({ 'data-service': x.id, 'data-key': 'svc:' + x.id }) }) + (on ? R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-say': 'Opened localhost:' + x.port, 'data-key': 'svc-open:' + x.id } }) : '') }); });
  const tools = d.builtins.map((t, i) => R.button({ label: t, attrs: hook({ 'data-say': t + ': running in the worktree', 'data-key': 'builtin:' + i }) })).concat(R.button({ label: 'Download patch', attrs: { 'data-say': 'Downloading run.patch', 'data-key': 'act-patch' } })).join('');
  let members = '';
  if (v.isWorkspace) {
    const picked = ui.picked || d.members.map((m) => m.name);
    members = `${R.checkbox({ label: 'All changed projects', checked: picked.length === d.members.length, attrs: { 'data-pickall': true, 'data-key': 'pick-all' } })}${d.members.map((m) => R.checkbox({ label: m.name + ' · ' + m.files + ' files', checked: picked.includes(m.name), attrs: { 'data-pick': m.name, 'data-key': 'pick:' + m.name } })).join('')}
      <div class="rl-tools">${R.button({ label: `Check out ${picked.length} of ${d.members.length}`, attrs: hook(Object.assign({ 'data-say': `Checked out ${picked.join(', ') || 'nothing'} on this machine`, 'data-key': 'ws-checkout' }, picked.length ? {} : { disabled: true, title: 'Pick a project first' })) })}<span class="rtab-dim">${d.noChangeMembers.length} project had no changes</span></div>`;
  }
  const copy = ui.copy ? `<p class="rl-note">Local copy open · since 18:12</p>` : '';
  return `<div class="ch-actions"><h3 class="ov-sub">Actions</h3>${off ? `<p class="rl-note">${esc(HOSTED_WHY)}</p>` : ''}${copy}${members}${R.list({ groups: [{ rows: svc }] })}<div class="rl-tools">${tools}</div></div>`;
}
// Comments on a diff: the threads on this file's lines, and your own on a line you pick.
const notesOf = (path, d) => ((d.comments[path] || []).length + (ui.comments[path] || []).length);
function commentsHtml(path, d) {
  const all = (d.comments[path] || []).concat(ui.comments[path] || []);
  const lines = d.hunk.lines.filter(([k]) => k !== ' ').map(([, t]) => t.trim());
  const on = ui.commentOn && ui.commentOn.path === path ? ui.commentOn : null;
  const pick = on ? R.sentencePicker({ id: 'cmtline', text: on.line, items: lines.map((t) => ({ id: t, text: t, checked: t === on.line })), open: ui.menu === 'cmtline', tip: 'Which line it is on', chevron: svg('chevron', 12) }) : '';
  const form = on ? `<div class="ch-comment"><p class="rl-sentence">On ${pick}</p>${R.field({ id: 'cmt-text', label: 'Comment', value: on.text || '', error: on.err || '', multiline: true, attrs: { 'data-key': 'cmt-text' } })}<div class="rl-tools">${R.button({ label: 'Add comment', kind: 'primary', attrs: { 'data-cmt': 'add', 'data-key': 'cmt-add' } })}${R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-cmt': 'cancel', 'data-key': 'cmt-cancel' } })}</div></div>`
    : R.button({ label: 'Comment on a line', kind: 'quiet', attrs: { 'data-cmt': 'open', 'data-path': path, 'data-key': 'cmt-open' } });
  return `${all.length ? `<ul class="ch-thread" aria-label="Comments">${all.map((c) => `<li><b>${esc(c.who)}</b> on <code>${esc(c.line)}</code><span class="ov-why">${esc(c.t)}</span></li>`).join('')}</ul>` : ''}${form}`;
}
// Discarded, archived or deleted: the page says so and offers no tools on what is not there.
const GONE_WORDS = { discarded: ['The changes are gone', 'They were discarded; the run stays in history.'], archived: ['The local branch and worktree are gone', 'The remote branch and any PR stay.'], deleted: ['The changes are gone', 'The run was deleted.'] };
function changesPanel(v) {
  if (v.gone) return `<section class="rtab"><h2 class="rtab-h">${esc(GONE_WORDS[v.gone][0])}</h2><p class="rtab-p rtab-dim">${esc(GONE_WORDS[v.gone][1])}</p></section>`;
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
    const diff = open === r.i ? `<div class="ch-diff"><p class="ch-at">${esc(d.hunk.at)}</p><pre>${d.hunk.lines.map(([k, t]) => `<span class="${k === '+' ? 'add' : k === '-' ? 'del' : ''}">${esc(k + ' ' + t)}</span>`).join('\n')}</pre>${commentsHtml(r.p, d)}${R.button({ label: 'Open the whole diff', attrs: { 'data-key': 'file-full', 'data-say': 'Opens the whole diff of the file' } })}</div>` : '';
    return `<li class="ch-file${open === r.i ? ' is-open' : ''}${ui.land === 'file:' + r.i ? ' is-flash' : ''}">${R.fileRow({ status: m.st, name: r.name, dir: r.dir, path: r.p, notes: notesOf(r.p, d), added: r.a, removed: r.dl, blocks: blocks(r.a, r.dl), open: open === r.i, attrs: { 'data-file': r.i, 'data-key': 'file:' + r.i } })}${diff}</li>`;
  }).join('')).join('');
  // Documents its steps wrote: they stay with the run and are not in the PR. A name opens it; one download at the end.
  const arts = v.over.artifacts;
  const docs = arts.length ? head('Not in the code', String(arts.length)) + `<li class="ch-gnote">Written by the run’s steps; they stay with the run and are not in the PR</li>` + arts.map(([doc, step], i) => `<li class="ch-file ch-doc${ui.land === 'doc:' + i ? ' is-flash' : ''}"><span class="ch-st" aria-hidden="true"></span><span class="ch-name">${R.documentLink({ name: doc, attrs: { 'data-key': 'art:' + i, 'data-doc': i, title: 'Open ' + doc } })}<span class="ch-path">from ${esc(step)}</span></span>${R.button({ label: 'Download ' + doc, kind: 'quiet', iconOnly: true, icon: svg('download', 14), attrs: { 'data-key': 'dl:' + i, 'data-say': 'Downloading ' + doc } })}</li>`).join('') : '';
  const where = v.place.folder ? `In a copy of ${v.place.folder}; Apply writes them into the folder.` : v.place.branch ? `${v.place.branch} into ${v.place.base || 'dev'}` : '';
  // The code's own actions sit in the Changes head, as the card's action does: Check out, the rest in its ▾.
  const chItems = (v.bar.stop ? [{ id: 'ch:refresh', text: 'Refresh', help: 'Reload the diff from the worktree' }] : [])
    .concat([{ id: 'ch:patch', text: 'Download patch', help: 'Every change as one .patch file' }, { id: 'ch:copy', text: 'Copy git commands', help: 'git fetch and git switch to this branch' }]);
  const coWhy = v.hosted ? HOSTED_WHY : v.heldBy ? `Held by “${v.heldBy}”; it has the branch checked out` : '';
  if (ui.copy) chItems.unshift({ id: 'ch:discard-copy', text: 'Discard the copy', help: 'Removes the local copy; the branch stays' });
  const tools = v.place.folder ? '' : R.splitButton({ main: { label: ui.copy ? 'Unlink' : 'Check out', title: coWhy || (ui.copy ? 'Lets go of the local copy; the branch stays' : 'Check the branch out on this machine'), attrs: { 'data-key': 'ch:checkout', 'data-checkout': true, disabled: !!coWhy } },
    moreLabel: 'More for these changes', chevron: svg('chevron', 14), open: ui.menu === 'ch', menuHtml: menu('ch', chItems), moreAttrs: { 'data-menu': 'ch', 'data-key': 'menu:ch' }, cls: 'rc-pop is-right ch-act' });
  return `<section class="rtab"><div class="ch-head"><div class="ch-sum"><h2 class="rtab-h">${f.length} ${f.length === 1 ? 'file' : 'files'} <span class="ct"><span class="add">+${add}</span><span class="del">−${del}</span></span></h2><span class="rtab-dim" title="${esc(where)}">${v.place.folder ? esc(where) : R.workPlace({ branch: v.place.branch, base: v.place.base || 'dev' })}</span></div>${tools}</div>
    ${actionsHtml(v)}<ul class="ch-list">${rows}${docs}</ul></section>`;
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
      const row = rowHtml(Object.assign({}, r, { ref: '', akey: r.ref, logStep: st.label.startsWith('Run ') ? st.label + ' · ' + r.name : r.name, roundsKey: rd && r.loops ? key : '', roundsOpen: isOpen }), true);
      const sub = isOpen ? rd.map(([t, why], i) => R.row({ kind: 'step', cls: 'is-round', rail: `<span class="ac-round-n" aria-hidden="true">${i + 1}</span>`, text: `<span class="sc-name ac-why">${esc(why)}</span><span class="sc-time">${esc(t)}</span><span class="sc-rest"></span>` })).join('') : '';
      const di = v.over.artifacts.findIndex(([, step]) => step === r.name);
      const wrote = di < 0 ? '' : R.row({ kind: 'step', cls: 'is-round is-wrote', rail: '<span class="ac-round-n" aria-hidden="true"></span>', text: `<span class="sc-name ac-why">Wrote ${R.textLink({ label: v.over.artifacts[di][0], attrs: { 'data-go': 'doc:' + di, 'data-key': 'wrote:' + di, title: 'Open it in Changes' } })}</span><span class="sc-time"></span><span class="sc-rest"></span>` });
      return row + sub + wrote;
    }).join('');
  }).join('');
  const graphBtn = R.runPartShows('graph', R.prefs.mode()) ? R.button({ label: 'Open the graph', kind: 'quiet', attrs: { 'data-key': 'graph', 'data-graph': true } }) : '';
  return `<div class="rtab-bar">${seg}${logsGone ? '' : graphBtn}</div><section class="rtab rtab-stage"><ol class="rd-route-list sc-subs is-full" aria-label="Steps">${rows || '<li class="sc-stage-row"><p class="rtab-dim rtab-p">No problems or questions in this run.</p></li>'}</ol></section>${logsHtml(v)}${agentsHtml(v)}${sessionsHtml(v)}${usageHtml(v)}${costHtml(v)}`;
}
// Logs (Advanced): the sentence narrows them (Expert), Summaries or Raw (flag commandSummaries), search and copy.
const LOG_FILTERS = (v) => { const uniq = (k) => [...new Set(v.logs.map((l) => String(l[k])))];
  return [{ id: 'log-from', key: 'from', all: 'every source', vals: uniq('from') }, { id: 'log-level', key: 'lvl', state: 'level', all: 'any level', vals: uniq('lvl') }, { id: 'log-step', key: 'step', all: 'every step', vals: uniq('step') }, { id: 'log-cycle', key: 'cycle', all: 'any cycle', vals: uniq('cycle') }, { id: 'log-session', key: 'session', all: 'any session', vals: uniq('session') }]; };
function logsHtml(v) {
  if (!logsShow() || !v.has.started) return '';
  if (logsGone) return `<section class="rtab rl-sec" id="act-logs"><h2 class="rtab-h">Logs</h2>${R.emptyState({ title: 'The logs are gone', text: 'They went with the worktree.' })}</section>`;
  const L = ui.log; const fs = LOG_FILTERS(v);
  const q = L.q.trim().toLowerCase(); const summaries = R.prefs.flag('commandSummaries'); const raw = !summaries || L.raw;
  const lines = v.logs.filter((l) => fs.every((f) => { const want = L[f.state || f.key]; return want === 'all' || String(l[f.key]) === want; }) && (!q || (l.sum + ' ' + l.raw).toLowerCase().includes(q)));
  const expert = R.runPartShows('logFilters', R.prefs.mode());
  const sentence = expert ? `<p class="rl-sentence">Showing ${fs.map((f) => { const cur = L[f.state || f.key]; return R.sentencePicker({ id: f.id, text: cur === 'all' ? f.all : (f.key === 'cycle' ? 'cycle ' + cur : cur), open: ui.menu === f.id, chevron: svg('chevron', 12), items: [{ id: 'all', text: f.all, checked: cur === 'all' }].concat(f.vals.map((x) => ({ id: x, text: f.key === 'cycle' ? 'cycle ' + x : x, checked: cur === x }))) }); }).join(' · ')}</p>` : '';
  const list = lines.length ? R.logLines({ label: 'Log', lines: lines.map((l) => ({ t: l.t, from: l.step, lvl: l.lvl, text: raw ? l.raw : l.sum })) }) : R.emptyState({ title: 'Nothing in the log matches', text: 'Change the filters or the search.' });
  return `<section class="rtab rl-sec" id="act-logs"><h2 class="rtab-h">Logs <span class="n">${lines.length} of ${v.logs.length} lines</span></h2>${sentence}
    <div class="rl-tools">${R.field({ id: 'log-q', label: 'Search the log', value: L.q, attrs: { 'data-key': 'log-q' } })}${summaries ? R.segmented({ label: 'Show', hook: 'logview', items: [{ id: 'sum', label: 'Summaries', pressed: !L.raw }, { id: 'raw', label: 'Raw', pressed: L.raw }] }) : ''}${v.bar.stop ? R.checkbox({ label: 'Auto-scroll', checked: L.follow, attrs: { id: 'log-follow', 'data-key': 'log-follow' } }) : ''}${R.button({ label: 'Copy', kind: 'quiet', attrs: { 'data-key': 'log-copy', 'data-say': `Copied ${lines.length} log lines` } })}</div>${list}</section>`;
}
function agentsHtml(v) {
  if (!R.runPartShows('agents', R.prefs.mode()) || !v.agents.length) return '';
  return `<section class="rtab rl-sec"><h2 class="rtab-h">Agents <span class="n">${v.agents.length}</span></h2>${R.table({ label: 'Agents', columns: [{ id: 'name', label: 'Agent' }, { id: 'type', label: 'Type', narrow: false }, { id: 'model', label: 'Model', narrow: false }, { id: 'cycle', label: 'Cycle', num: true, narrow: false }, { id: 'skills', label: 'Skills', num: true, narrow: false }, { id: 'graph', label: 'Graph', num: true, narrow: false }, { id: 'tokens', label: 'Tokens', num: true }], rows: v.agents })}</section>`;
}
function sessionsHtml(v) {
  if (!R.runPartShows('sessions', R.prefs.mode()) || !v.sessions.length) return '';
  const k = Math.min(ui.session, v.sessions.length - 1); const x = v.sessions[k];
  return `<section class="rtab rl-sec"><h2 class="rtab-h">Sessions <span class="n">${v.sessions.length}</span></h2>${R.table({ label: 'Sessions', columns: [{ id: 'name', label: 'Session' }, { id: 'turns', label: 'Turns', num: true, narrow: false }, { id: 'in', label: 'In', num: true, narrow: false }, { id: 'out', label: 'Out', num: true, narrow: false }, { id: 'cache', label: 'Cache', num: true, narrow: false }, { id: 'cost', label: 'Cost', num: true }], rows: v.sessions })}
    <p class="rl-sentence">Session ${R.sentencePicker({ id: 'session', text: x.name, open: ui.menu === 'session', chevron: svg('chevron', 12), items: v.sessions.map((y, i) => ({ id: String(i), text: y.name, checked: i === k })) })}</p>
    <div class="rl-tools">${R.button({ label: 'Open the transcript', kind: 'quiet', attrs: { 'data-transcript': k, 'data-key': 'session-open' } })}${R.button({ label: 'Copy its id', kind: 'quiet', attrs: { 'data-say': 'Copied ' + x.id, 'data-key': 'session-copy' } })}</div></section>`;
}
function usageHtml(v) {
  if (!R.prefs.flag('runTelemetry') || !v.usage.length) return '';
  return `<section class="rtab rl-sec"><h2 class="rtab-h">Step usage</h2>${R.table({ label: 'Step usage', columns: [{ id: 'name', label: 'Step' }, { id: 'model', label: 'Model', narrow: false }, { id: 'cache', label: 'Cache', num: true, narrow: false }, { id: 'calls', label: 'Calls', num: true, narrow: false }, { id: 'retries', label: 'Retries', num: true, narrow: false }, { id: 'compact', label: 'Compactions', num: true, narrow: false }, { id: 'errors', label: 'Tool errors', num: true, narrow: false }, { id: 'time', label: 'Tools and tests', num: true, narrow: false }, { id: 'peak', label: 'Context peak', num: true }], rows: v.usage })}</section>`;
}
// What it cost and who spent it: what is counted, then what is apart and never summed.
function costHtml(v) {
  const d = v.tabData; const fig = v.figs.find((f) => f.k === 'Cost'); if (!fig || !v.has.started) return '';
  // The rows add up to the total: what Worca's own calls took out of it is not on top of it.
  const usd = (x) => parseFloat(String(x).replace(/[^0-9.]/g, '')) || 0;
  const other = d.costOther.reduce((a, [, c]) => a + usd(c), 0); const total = usd(fig.v); const fits = total > other;
  const rows = [{ name: 'Agents', cost: v.agentsUnknown ? 'cost unknown' : fits ? '$' + (total - other).toFixed(2) : fig.v }].concat(fits || v.agentsUnknown ? d.costOther.map(([name, cost]) => ({ name, cost })) : []).concat(v.agentsUnknown ? [] : [{ name: 'Total', cost: fig.v }]);
  return `<section class="rtab rl-sec"><h2 class="rtab-h">Cost</h2>${R.table({ label: 'Cost', columns: [{ id: 'name', label: 'Spent on' }, { id: 'cost', label: 'Cost', num: true }], rows })}${v.agentsUnknown ? '<p class="rl-note">This engine reports no cost, so the total is only Worca’s own calls.</p>' : ''}<p class="rl-note">Apart, not in the total: ${d.costApart.map(([a, b]) => esc(a) + ' ' + esc(b)).join(' · ')}</p></section>`;
}
// A view that only shows is a Dialog without a form (docs/rail/forms.md): the graph, a document, a transcript.
const viewDialog = (title, body, cls) => R.dialog({ title, id: 'vd-h', close: svg('x', 14), body, yes: 'Close', view: true, cls, hooks: { close: { 'data-viewclose': true, 'data-key': 'vd-close' }, yes: { 'data-viewclose': true, 'data-key': 'vd-ok' } } });
function viewDialogHtml(v) {
  if (ui.dialog === 'doc') {
    const d = ui.doc; return viewDialog(d.name, `<div class="rl-tools">${R.button({ label: 'Download', kind: 'quiet', attrs: { 'data-say': 'Downloading ' + d.name, 'data-key': 'doc-dl' } })}</div><div class="doc-view">${md(d.body)}</div>`);
  }
  // Commands you run yourself stay until you close them, with a copy button: never a toast that fades.
  if (ui.dialog === 'commands') return viewDialog('Git commands', `<p class="pd-hint">${esc(ui.cmd.label)}</p><div class="rl-tools">${R.copyButton({ text: ui.cmd.text, label: 'Copy the commands', attrs: { 'data-key': 'cmd-copy' } })}</div><pre class="rtab-ev-l">${esc(ui.cmd.text)}</pre>`);
  if (ui.dialog !== 'graph') return '';
  const expert = R.shows('expert'); const g = v.graph;
  const stages = expert ? g.stages : g.stages.map((st) => Object.assign({}, st, { nodes: st.nodes.map((n) => Object.assign({}, n, { meta: '', loops: 0 })) }));
  const node = ui.graphNode && g.stages.flatMap((st) => st.nodes).find((n) => n.key === ui.graphNode);
  const step = node ? v.logs.filter((l) => l.step === node.name || l.step.endsWith(' · ' + node.name)) : [];
  const drawer = node ? `<div class="wg-drawer"><div class="wg-drawer-h"><span>${esc(node.name)}</span><span>${logsShow() ? R.button({ label: 'Open in Logs', attrs: { 'data-logstep': step[0] ? step[0].step : node.name, 'data-key': 'drawer-logs' } }) : ''}${R.button({ label: 'Close the log', kind: 'quiet', attrs: { 'data-node': node.key, 'data-key': 'drawer-close' } })}</span></div>${step.length ? R.logLines({ label: node.name + ' log', lines: step.map((l) => ({ t: l.t, from: l.from, lvl: l.lvl, text: l.sum })) }) : R.emptyState({ title: 'Nothing here yet', text: 'This step has not started.' })}</div>` : '';
  const tools = `<div class="wg-tools">${R.segmented({ label: 'Zoom', hook: 'zoom', items: [{ id: 'small', label: 'Small', pressed: ui.graphZoom === 'small' }, { id: 'normal', label: 'Normal', pressed: !ui.graphZoom }, { id: 'large', label: 'Large', pressed: ui.graphZoom === 'large' }] })}</div>`;
  return viewDialog('Workflow', tools + R.workflowGraph({ stages, end: g.end, zoom: ui.graphZoom }) + drawer);
}
// A step's form (docs/rail/forms.md): its sentence, one field or choice, a foot that names what happens.
function formDialogHtml() {
  const F = ui.form; if (!F || ui.dialog !== F.id) return '';
  const def = F.def;
  const body = (def.text ? `<p class="pd-hint">${esc(R.fill(def.text, F.ctx || {}))}</p>` : '') + (def.options ? R.optionList({ label: def.title, options: def.options, selected: F.pick, recommended: -1, optAttrs: (i) => ({ 'data-fopt': i, 'data-key': 'fopt:' + i }) })
    : R.field({ id: 'fd-value', label: def.field.label, value: F.value, hint: def.field.hint || '', error: F.fieldErr || '', multiline: !!def.field.multiline, attrs: { 'data-key': 'fd-value' } }))
    + (F.err ? `<div class="pd-alert" role="alert"><b>${esc(F.err.title)}</b><span>${esc(F.err.detail)}</span></div>` : '');
  return R.dialog({ title: def.title, id: 'fd-h', close: svg('x', 14), body, yes: def.yes, busy: !!ui.busy, busyLabel: 'Working…', hooks: { close: { 'data-fd': 'cancel', 'data-key': 'fd-close' }, cancel: { 'data-fd': 'cancel', 'data-key': 'fd-cancel' }, yes: { 'data-fd': 'ok', 'data-key': 'fd-ok' } } });
}
function decisionsPanel(v) {
  const ds = v.tabData.decisions;
  const by = (w) => ds.filter((x) => x.who === w).length;
  const ask = v.ask;
  const sum = [by('you') ? by('you') + ' by you' : '', by('away') ? by('away') + ' by Away mode' : '', by('default') ? by('default') + ' by default' : ''].filter(Boolean).join(' · ');
  const waiting = ask ? R.row({ kind: 'route', cls: 'is-ask', rail: R.stepDot({ dotCls: 'is-problem', word: 'Waiting for you', icon: 'question' }), text: `<div class="dc-body"><p class="rtab-q">${esc(ask.q)}</p><p class="rtab-dim">Waiting for you · ${R.textLink({ label: 'Answer it in the card', attrs: { 'data-goanswer': true, 'data-key': 'dc-answer' } })}</p></div>` }) : '';
  return `<section class="rtab"><div class="ch-head"><h2 class="rtab-h">${ds.length ? ds.length + (ds.length === 1 ? ' decision' : ' decisions') : 'Nothing decided yet'}</h2><span class="rtab-dim">${esc(sum)}</span></div>
    <ol class="rd-route-list dc-list">${waiting}${ds.map((x) => R.row({ kind: 'route', cls: 'is-done', rail: R.stepDot({ dotCls: 'dc-who is-' + x.who, word: WHO[x.who], icon: ICON_WHO[x.who], size: 11 }), text: `<div class="dc-body"><p class="rtab-q">${esc(x.q)}</p><p class="dc-a">${esc(x.a)}</p><p class="rtab-dim">${esc([x.step, WHO[x.who], x.note, x.when].filter(Boolean).join(' · '))}</p></div>` })).join('')}</ol></section>`;
}
function panelHtml(v) {
  const t = v.tabs.find((x) => x.sel) || v.tabs[0]; const id = t.id;
  // a part that cannot be drawn says so in its own place; the rest of the page keeps working
  if (ui.broken) return R.emptyState({ title: R.failureOf(`Show the ${t.l.toLowerCase()}`).title, text: 'Something went wrong here. The rest of the page still works.', error: true,
    actions: R.button({ label: 'Reload this part', attrs: { 'data-fixpart': true, 'data-key': 'fix-part' } }) + R.button({ label: 'Details', kind: 'quiet', attrs: { 'data-say': DETAILS, 'data-key': 'part-details' } }) });
  return ({ summary: summaryPanel, changes: changesPanel, activity: activityPanel, decisions: decisionsPanel })[id](v);
}
function figHtml(f, v) {
  if (f.k === 'Cost' && v) {
    const html = R.figureBreakdown({ label: 'Cost by stage', rows: v.activity.filter((st) => st.meta).map((st) => [st.label, st.meta]), total: f.v, help: `${f.title || ''}. Each step’s cost and model are in Activity.` });
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
  logsGone = v.has.logsGone;
  const a = v.action;
  // The run's controls sit together on the status line: its one action (with ▾), then ⋯ for everything else.
  const split = a ? R.splitButton({ main: { label: ui.busy && !ui.confirm && !ui.dialog ? R.workingWord(ui.busy.label) : a.label, kind: a.primary ? 'primary' : '', icon: svg(a.icon, 14), title: a.offWhy || a.help, attrs: { 'data-key': 'act-main', 'data-label': a.label, disabled: !!a.offWhy || !!ui.busy } },
    moreLabel: a.items.length ? 'More actions' : '', chevron: svg('chevron', 14), open: ui.menu === 'act', menuHtml: menu('act', a.items), moreAttrs: { 'data-menu': 'act', 'data-key': 'menu:act' }, cls: 'rc-action rc-pop is-right' }) : '';
  const action = `<div class="rc-side">${split}<span class="rc-pop is-right">${R.button({ label: 'More for this run', iconOnly: true, title: false, icon: DOTS, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': String(ui.menu === 'more'), 'data-menu': 'more', 'data-key': 'menu:more' } })}${ui.menu === 'groups' ? groupEditorHtml() : menu('more', moreItems(v))}</span></div>`;
  // Many labels and tags, one group: a run already in a feature or chain, or a group page, joins none; a run you
  // grouped can leave it again from the same menu.
  // Where the code lives, said as a phrase that follows the run: "branch into dev", "#959 merges branch into dev",
  // "branch merged into dev", "main to origin/main", "on source then to origin", "into ~/folder". The branch name copies itself on click and loses
  // its middle, never its end, so sibling runs (-2, -3) stay apart.
  const pl = v.place;
  const where = R.workPlace(Object.assign({ finished: v.finished, copyAttrs: pl.branch ? { 'data-say': `Copied ${pl.hidden || pl.branch}` } : null, prAttrs: pl.pr ? { 'data-say': `Opens ${pl.pr} on GitHub` } : null }, pl));
  const pr = pl.pr ? `<a class="rc-pr" href="#" data-key="pr" data-say="Opens ${esc(pl.pr)} on GitHub" title="Open ${esc(pl.pr)} on GitHub">${esc(pl.pr)}</a>` : '';
  const repos = pl.repos.length ? `<span>${pl.repos.length} repositories</span>` : '';
  // + stays at the end of the place line; labels and tags, once added, get their own wrapping row under it.
  const kind = v.kind ? R.chip({ text: v.kind }) : '';
  const placeLine = [kind, where, repos, pl.branch || pl.folder ? '' : pr].filter(Boolean).join('<span class="rc-sep" aria-hidden="true">·</span>');
  // One metadata line: what it is, where the code lives, then the tag group (mark, labels, cost tags).
  const facts = `<span class="rc-placeset">${placeLine}</span>${placeLine ? '<span class="rc-sep" aria-hidden="true">·</span>' : ''}${tagGroupHtml()}`;
  // Where you are: Runs › place › group, the page itself never a crumb; on a narrow card only the parent, as ‹ Parent.
  const crumbs = R.trail({ items: v.crumbs.map((c, i) => (c.go ? { label: c.t, button: true, attrs: { 'data-crumb': i, 'data-key': 'crumb:' + i } }
    : { label: c.t, attrs: { 'data-key': 'crumb:' + i, 'data-say': 'Goes to ' + (i ? (c.group ? 'the ' + c.t + ' group' : c.t + ' runs') : 'the Runs list') } })) });
  // A run in a group steps to its siblings; a run that has not started has no page yet.
  const pg = v.pager;
  const left = svg('chevron', 14).replace('M6 9.5l6 6 6-6', 'M14.5 6l-6 6 6 6');
  const right = svg('chevron', 14).replace('M6 9.5l6 6 6-6', 'M9.5 6l6 6-6 6');
  const sib = (x, dir) => (x ? { ok: !!x.ok, why: `Run ${x.index + 1} hasn’t started`, attrs: { 'data-sib': x.index, 'data-key': 'sib:' + dir } } : { ok: false, why: dir === 'prev' ? 'This is the first run' : 'This is the last run', attrs: { 'data-sib': '', 'data-key': 'sib:' + dir } });
  const pager = pg ? R.pager({ label: 'Runs in this group', index: pg.index, n: pg.n, noun: 'run', prev: sib(pg.prev, 'prev'), next: sib(pg.next, 'next'), icons: { prev: left, next: right } }) : '';
  const scope = v.bar.scope ? ` title="Applies to the whole ${esc(v.bar.scope)}: the running run and the ones after it"` : '';

  const o = v.open;
  const enter = o.key !== lastOpen; lastOpen = o.key;   // the steps fade in only when another stage opens, never on a repaint
  const head = o.isRun ? `<div class="sc-head"><span class="sc-run" title="${esc(o.title)}">${esc(o.title)}</span>${v.independent ? R.chip({ text: 'Independent', title: 'It does not start from another run’s branch' }) : ''}${o.meta ? `<span class="rtab-dim sc-run-cost">${esc(o.meta)}</span>` : ''}${o.canOpen && !(a && a.label === 'Open run ' + (o.runIndex + 1)) ? `${R.button({ label: 'Open run', attrs: { 'data-open-run': o.runIndex, 'data-key': 'open-run' } })}` : v.bar.stop ? R.button({ label: 'Re-plan from here', title: 'The planner re-cuts this run and the ones after it', attrs: { 'data-replan': o.runIndex, 'data-key': 'replan' } }) : ''}</div>`
    : v.planHead ? `<div class="sc-head"><span class="sc-run">How the work was cut into runs</span>${R.button({ label: 'Open the plan', attrs: { 'data-key': 'open-plan', 'data-doc': 0 } })}</div>` : '';
  // the next run of a group, under the run it follows: starts by itself, or asks first
  const then = v.then ? `<div class="sc-then">Then <b title="${esc(v.then.title)}">Run ${v.then.n} · ${esc(v.then.title)}</b>${wordPick('then', ui.askEach ? 'asks me first' : 'starts by itself', `When run ${v.then.n} starts`, [{ id: 'group:go', text: 'Starts by itself', checked: !ui.askEach, help: 'Each run starts when the one before it is ready' }, { id: 'group:ask', text: 'Asks me first', checked: !!ui.askEach, help: 'Stops for your OK before the next run starts' }], 'pd-ship')}</div>` : '';
  const ask = v.ask && o.rows.some((r) => /is-ask/.test(r.rowCls)) ? answerHtml(v.ask) : v.under && o.rows.some((r) => /is-ask/.test(r.rowCls)) ? underHtml(v.under) : '';
  const panel = o.stack ? stackHtml(Object.assign({}, o.stack, { enter })) + (v.under && v.id === 'outline' ? `<div class="sc-then">${esc(v.under.roles.length + ' roles reviewed the split · ' + (ui.fixed.outline ? 'no open issues' : '1 open issue'))}</div>` : '') : `<ol class="rd-route-list sc-subs${enter ? ' is-enter' : ''}" aria-label="${esc(o.label)} steps" style="grid-column:1 / -1">${o.rows.map((r) => rowHtml(r) + (/is-ask/.test(r.rowCls) ? ask : '')).join('')}</ol>`;
  const sel = (v.tabs.find((t) => t.sel) || v.tabs[0]).id;

  const scroller = document.scrollingElement || document.documentElement; const keepY = scroller.scrollTop;
  R.morph(document.getElementById('card'), `
  <div class="rc">
    <div class="rc-bar">${crumbs}${ui.offline ? `<span class="rc-conn" role="status" title="Worca lost its connection to the server; your runs keep going and it reconnects by itself">${R.statusDot({ tone: 'is-grey' })}Offline · retrying</span>` : ''}${pager}</div>
    ${stripHtml(v)}
    <div class="rc-head"><div class="rc-title-row"><h1 class="rc-heading${ui.titleOpen ? ' is-open' : ''}" title="${esc(v.title)}" data-title>${esc(v.title)}</h1>${SHELL ? R.button({ label: 'Keep in view', kind: 'quiet', iconOnly: true, icon: R.icon('eye', 16), attrs: { 'data-keep-view': ui.caseId, 'aria-pressed': 'false', title: 'Keep in view: its mark stays in the top bar, on every page' } }) : ''}</div>${facts ? `<div class="rc-facts">${facts}</div>` : ''}</div>
    <section class="rc-card" aria-label="Run status">
      ${R.statusLine({ dot: statusDot(v), word: v.word, action, detail: v.detail })}
      <div class="rc-zone"><div class="rc-span">${R.stepper({ stages: v.stages, deepen: SHELL ? R.markTone(v) : '' })}</div></div>
      ${SHELL ? stageStream(v, `${head}${panel}${then}`) : `<div class="rc-zone is-ruled" role="tabpanel" id="stage-panel" aria-labelledby="st-${o.key}">${head}${panel}${then}</div>`}
      <div class="rc-zone is-ruled">${R.figures(v.figs.map((f) => figHtml(f, v)))}</div>
    </section>
    ${SHELL ? '' : R.tabs({ label: 'Run detail', controls: 'rtab-panel', cls: 'rc-tabs', items: v.tabs.map((t) => ({ id: t.id, label: t.l, count: t.n, selected: t.sel })) })}
    ${prDialogHtml(v)}${viewDialogHtml(v)}${formDialogHtml()}
    ${R.toast({ text: ui.toast || '' })}
    ${SHELL && PART_STAGE[ui.tab] && v.stages.some((st) => st.key === PART_STAGE[ui.tab]) ? '' : `<div class="rtab-panel" role="tabpanel" id="rtab-panel" aria-labelledby="tab-${sel}" tabindex="0">${panelHtml(v)}</div>`}
    ${ui.crash ? R.errorToast({ title: 'Something went wrong', text: 'Worca hit an error it did not expect. Your runs keep going.', icon: svg('alert', 15), count: ui.crash.n,
    actions: R.button({ label: 'Reload', attrs: { 'data-crash': 'reload', 'data-key': 'crash-reload' } }) + R.button({ label: 'Copy details', kind: 'quiet', attrs: { 'data-say': DETAILS, 'data-key': 'crash-details' } }),
    close: R.button({ label: 'Close', kind: 'quiet', iconOnly: true, title: false, icon: svg('x', 14), attrs: { 'data-crash': 'close', 'data-key': 'crash-close' } }) }) : ''}
  </div>`, { motion: !jump });
  jump = false;

  if (scroller.scrollTop !== keepY) scroller.scrollTop = keepY;   // nothing moves by itself: a repaint never scrolls the page
  R.fitTags(document);
  fitMenus();
  const nx = document.getElementById('next-event'); if (nx) { const to = ui.caseId === 'chain' ? (chainNext() >= 0 ? 'chain' : '') : (ui.pauseAfter ? 'paused-you' : (v.flow || {}).next); nx.disabled = !to; nx.title = to ? 'Event: ' + (v.event || EVENT[ui.caseId] || EVENT[v.state] || 'something happens outside the run') : 'Nothing outside the run happens next here; use the card'; }
  const selTab = document.querySelector('.rc-tabs .tab[aria-selected="true"]'); const strip = selTab?.parentElement;
  if (strip) { const l = selTab.offsetLeft - strip.offsetLeft, r = l + selTab.offsetWidth; if (l < strip.scrollLeft) strip.scrollLeft = l; else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = r - strip.clientWidth; }
  if (keep) {
    const el = keep === 'menu-first' ? document.querySelector('.menu .menu-item') : document.querySelector(`[data-key="${CSS.escape(keep)}"]`) || (keep.startsWith('lst:') ? document.getElementById('tag-input') : null);   // a removed custom label has no row left
    el?.focus({ preventScroll: true });
  }
}

// In the one Worca a task reads down like a conversation: finished stages one line, the open one in full, what is to come quiet.
const PART_STAGE = { decisions: 'plan', changes: 'build', activity: 'review' };
// What a part holds, said before it opens: the files and lines, the decisions and the one open, the steps.
function partSays(v, t) {
  if (t.id === 'changes') { const [files, docs] = String(t.n || '').split(' · '), diff = (v.figs.find((f) => f.k === 'Changes') || {}).v || ''; return [files ? `${files} files ${diff}`.trim() : diff, docs].filter(Boolean).join(' · '); }
  if (t.id === 'decisions') return t.n ? `${t.n}${v.ask ? ' · 1 open' : ''}` : '';
  if (t.id === 'activity') { const n = v.activity.reduce((a, st) => a + st.rows.filter((r) => !/\bis-next\b/.test(r.rowCls)).length, 0); return n ? `${n} ${n === 1 ? 'step' : 'steps'} so far` : ''; }
  return t.n || '';
}
// The part that matters now opens by itself: Decisions while Plan waits on you, Changes once the task is ready.
function partNow(v, caseId) {
  const live = v.stages.find((st) => st.live), has = (id) => v.tabs.some((t) => t.id === id);
  if (v.ask && live?.key === 'plan' && has('decisions')) return 'decisions';
  if (/^(ready|approved)$/.test(M.stateOf(caseId)) && has('changes')) return 'changes';
  return '';
}
function stageStream(v, open) {
  const tab = (id) => v.tabs.find((t) => t.id === id);
  const partAt = PART_STAGE[ui.tab] && tab(ui.tab) ? PART_STAGE[ui.tab] : '';
  const partBtn = (id) => { const t = tab(id); return t ? R.stagePart({ label: t.l, says: partSays(v, t), open: ui.tab === id, attrs: { 'data-tab': ui.tab === id ? v.tabs[0].id : id, 'data-key': `tab:${id}`, title: ui.tab === id ? `Closes ${t.l}` : `Opens ${t.l} under this stage` } }) : ''; };
  const line = (st) => {
    const live = st.live, done = st.cells.every((c) => /is-(done|merged)/.test(c)), next = st.cells.every((c) => /is-next/.test(c));
    const mark = live ? R.kindMark({ kind: 'task', tone: R.markTone(v), stage: -1, size: 16 }) : svg(done ? 'check' : 'now', 14);
    const parts = Object.entries(PART_STAGE).filter(([, k]) => k === st.key).map(([id]) => partBtn(id)).join('');
    return R.stageLine({ mark, label: st.label, meta: st.meta || '', parts, next, attrs: { 'data-stage-line': st.key }, body: (st.selected ? `<div class="rc-zone" role="tabpanel" id="stage-panel" aria-labelledby="st-${esc(st.key)}">${open}</div>` : '') + (partAt === st.key ? `<div class="rtab-panel stage-part" id="rtab-panel" tabindex="0">${panelHtml(v)}</div>` : '') });
  };
  // what has no stage of its own (a group's runs) sits after the stages, as links
  const rest = v.tabs.slice(1).filter((t) => !(PART_STAGE[t.id] && v.stages.some((st) => st.key === PART_STAGE[t.id]))).map((t) => partBtn(t.id)).join('');
  return `<div class="stage-stream">${v.stages.map(line).join('')}${rest ? `<div class="stage-parts">${rest}</div>` : ''}</div>`;
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
  if (SHELL && !SHELL.owns('run', e.target)) return;
  if (e.target.id === 'after-task') ui.afterDraft = e.target.value;
  if (e.target.id === 'changes-text') ui.changesText = e.target.value;
  if (e.target.id === 'fd-value' && ui.form) ui.form.value = e.target.value;
  if (e.target.id === 'cmt-text' && ui.commentOn) ui.commentOn.text = e.target.value;
  if (e.target.id === 'pd-version' && ui.pr) ui.pr.version = e.target.value;
  if (e.target.id === 'log-q') { ui.log.q = e.target.value; pendingFocus = 'log-q'; render(); return; }
  if (e.target.dataset && e.target.dataset.marktext) { ui.markText[e.target.dataset.marktext] = e.target.value; return; }
  if (e.target.id === 'answer-own') { ui.answerOwn = e.target.value; if (e.target.value && ui.answer !== -1) { ui.answer = -1; document.querySelectorAll('.sc-ans-opt').forEach((x) => { x.setAttribute('aria-checked', 'false'); x.tabIndex = -1; }); } }
  const m = ui.pr && e.target.id.match(/^pd-(title|desc)(?:-(\d+))?$/);
  if (m) (m[2] === undefined ? ui.pr : ui.pr.prs[+m[2]])[m[1]] = e.target.value;
});
document.addEventListener('change', (e) => {
  if (SHELL && !SHELL.owns('run', e.target)) return;
  if (e.target.id === 'break' && e.target.value && e.target.value !== 'step') { const k = e.target.value; e.target.value = ''; breakNow(k); return; }
  if (e.target.id === 'log-follow') { ui.log.follow = e.target.checked; toast(e.target.checked ? 'The log follows new lines' : 'The log stays where it is'); render(); return; }
  if (e.target.dataset && e.target.dataset.marktext) { pendingFocus = e.target.dataset.key; render(); return; }
  if (e.target.dataset && e.target.dataset.pickall !== undefined) { const all = M.view(ui.caseId, ui).tabData.members.map((m) => m.name); ui.picked = e.target.checked ? all : []; pendingFocus = 'pick-all'; render(); return; }
  if (e.target.dataset && e.target.dataset.pick) { const all = M.view(ui.caseId, ui).tabData.members.map((m) => m.name); const cur = ui.picked || all; ui.picked = e.target.checked ? cur.concat(e.target.dataset.pick) : cur.filter((x) => x !== e.target.dataset.pick); pendingFocus = e.target.dataset.key; render(); return; }
  if (!ui.pr) return;
  if (e.target.id === 'pd-release') { ui.pr.release = e.target.checked; pendingFocus = 'pd-release'; render(); return; }
  if (e.target.id === 'pd-draft') ui.pr.draft = e.target.checked;
  if (e.target.id === 'pd-watch') ui.pr.watch = e.target.checked;
});
// The intro's note lists what this design proposes beyond today's app, with why; the buttons carry no mark.
{ const n = document.getElementById('proposed'); if (n) n.innerHTML = `<summary>${M.proposed.length} actions are proposed, not in today’s app</summary><ul>${M.proposed.map(([a, why]) => `<li><b>${esc(a)}</b> ${esc(why)}</li>`).join('')}</ul>`; }
const pick = document.getElementById('case');
const groups = M.caseGroups;   // by what you check
pick.innerHTML = groups.map((g) => `<optgroup label="${g}">${M.cases.filter((c) => c.group === g).map((c) => `<option value="${c.id}"${c.id === ui.caseId ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
pick.addEventListener('change', () => {
  // #run/<case>/<part> opens that part under its stage; with none named, the part that matters now
  const named = SHELL ? (location.hash.match(/^#run\/[^/]+\/(\w+)/) || [])[1] : '';
  if (SHELL) history.replaceState(null, '', '#run/' + pick.value); jump = true; ui = Object.assign(fresh(pick.value), { chips: (M.cases.find((c) => c.id === pick.value) || {}).chips || [] });
  if (SHELL) { const v0 = M.view(ui.caseId, ui); ui.tab = v0.tabs.some((t) => t.id === named) ? named : partNow(v0, ui.caseId); }
  render();
});
// The prototype's flow (RunCardModel.flow): an action moves the run to its next case or does its job in place and
// says so in the toast; a destructive or outward one (Stop, Discard, Merge, Apply) asks first in a confirm strip.
const AWAY = [{ id: 'away:auto', text: 'As set up', help: 'Follows Settings and whether you marked this run' }, { id: 'away:on', text: 'Answer for me', help: 'Worca answers this run’s questions from now on, at any hour' }, { id: 'away:off', text: 'Never', help: 'Worca never answers on this run, whatever the settings' }];
function moreItems(v) {
  const group = !!v.kind; const live = v.bar.stop;
  const noun = group ? v.kind.toLowerCase() : 'run';
  const items = [];
  // Discarded and archived things have no tools left; deleted things have nothing at all.
  if (v.gone) {
    if (v.gone === 'discarded') items.push({ id: 'more:archive', text: 'Archive', help: 'Takes it out of Runs; the history stays' });
    if (v.gone === 'archived') items.push({ id: 'more:restore', text: 'Restore', help: 'Brings the record back to Runs; its branch, worktree and logs stay gone' });
    items.push({ id: 'more:link', text: 'Copy link', help: 'Paste it in Chat or an issue' });
    return items;
  }
  if (live && !group) items.push({ header: 'Away mode' }, ...AWAY.map((x) => Object.assign({ checked: (ui.away || 'away:auto') === x.id }, x)), { sep: true });
  if (v.runAfter) items.push({ id: 'more:after', text: v.runAfter.label, help: v.runAfter.help });
  if (!group && !v.inGroup) items.push(v.addedGroup ? { id: 'ungroup', text: 'Leave ' + v.addedGroup, help: 'The run leaves the group; its labels and tags stay' } : { id: 'more:group', text: 'Move to group…', help: 'Tracks it with related runs on one page' });
  if (v.hasSetup) items.push({ id: 'more:preset', text: 'Save as preset', help: 'Starts the next run with this task’s setup' });
  // Try it: a local copy to run; another run can hold it, and once open it says so here and in Changes.
  if (v.finished && !v.archived && v.place.branch && !v.place.folder && v.has.try) {
    const svc0 = v.tabData.services[0];
    if (ui.tryBusy || ui.copy) items.push({ header: ui.copy && !ui.tryBusy ? 'Local copy open · since 18:12' : 'Try it' }, ...R.tryStep({ checkingOut: ui.tryBusy === 'checkout', settingUp: ui.tryBusy === 'setup', service: svc0 ? { name: svc0.name, port: svc0.port, running: !!ui.services[svc0.id] } : null }).map((x) => Object.assign({}, x, { id: 'try:' + x.id })));
    if (ui.tryBusy) items.push({ sep: true });
    else if (ui.copy) items.push({ id: 'more:unlink', text: 'Unlink', help: 'Lets go of the local copy; the branch stays' }, { id: 'more:discard-copy', text: 'Discard the copy', help: 'Removes the local copy; the branch stays' }, { sep: true });
    else items.push({ id: 'more:try', text: 'Try it', off: !!(v.heldBy || v.hosted), hint: v.heldBy ? 'Held' : '', help: v.hosted ? HOSTED_WHY : v.heldBy ? `Held by “${v.heldBy}”; it has the branch checked out` : 'Checks the branch out locally so you can run it' });
  }
  if (group) { const on = !!ui.askEach; if (v.bar.stop) items.push({ id: 'group:toggle', text: 'Ask before each run', checked: on, help: 'Stops for your OK before each later run starts; takes effect at once' }); }
  if (v.has.worktree && !group && R.shows(R.actionLevel('Terminal'))) items.push({ id: 'more:terminal', text: 'Terminal', hint: 'Ctrl+`', help: 'A shell in this run’s worktree' });
  items.push({ id: 'more:link', text: 'Copy link', help: 'Paste it in Chat or an issue' });
  if (v.finished && v.has.report) items.push({ id: 'more:report', text: 'Report this ' + noun, help: 'Asks for a note, then sends it with the logs to the Worca team' });
  if (v.finished && !v.archived && v.has.started) items.push({ id: 'more:archive', text: 'Archive', help: v.dependents ? v.dependents + ' runs wait on this one and will start without it. Removes the branch, worktree and logs' : 'Removes the branch, worktree and logs; the remote branch and PR stay' });
  if (group && !v.archived && !live && R.shows('advanced')) items.push({ id: 'more:delete', text: 'Delete', help: 'Removes it and its runs from Runs; their PRs stay' });
  return items;
}
const CH_SAY = { 'ch:refresh': () => 'Diff refreshed from the worktree', 'ch:patch': () => 'Downloading run.patch', 'ch:copy': (v) => 'Copied: git fetch && git switch ' + v.place.branch };
const MORE_SAY = { 'more:terminal': 'Terminal opened in the worktree' };
let toastTimer = 0;
// The toast fades out (Motion), then empties: its text stays while it fades.
function toast(text) { ui.toast = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => { ui.toast = ''; const el = document.querySelector('.rc-toast'); if (el) { el.classList.remove('is-on'); toastTimer = setTimeout(() => { if (!ui.toast) el.textContent = ''; }, 200); } }, 4000); }
// An action moves this run: M.move keeps what is the run's own, and the case picker follows it.
function landOn(moved) {
  const par = ui.parent;
  if (par) { ui.over = Object.assign({}, ui.over, { [par.caseId + ':' + par.index]: moved }); Object.assign(ui, { run: moved, caseId: moved.id, open: null, menu: '', focus: '', answer: null, confirm: null, dialog: '', pauseAfter: false }); pick.value = moved.id; pendingFocus = 'act-main'; return; }
  if (SHELL) history.replaceState(null, '', '#run/' + moved.id);
  Object.assign(ui, { run: moved, caseId: moved.id, open: null, ship: '', menu: '', tab: '', focus: '', parent: null, back: null, titleOpen: false, answer: null, file: null, rounds: [], ticks: [], actFilter: 'all', confirm: null, dialog: '', pauseAfter: false, question: 0 });
  pick.value = moved.id; pendingFocus = 'act-main';
}
function goCase(id, f) { landOn(M.move(ui, id, f || {})); }
// One flow for every step (step-flow.mjs): its Dialog if it needs fields, the strip if it asks, its button says what is
// happening, then the run moves on, or nothing changes and the place you acted says what failed and why.
const follow = R.stepFlow({
  dialogShown: (f) => ui.dialog === f.dialog,
  openDialog(f, label) {
    ui.dialog = f.dialog; ui.dialogLabel = label; ui.dialogF = f; ui.menu = '';
    if (f.dialog !== 'pr') { const def = M.forms[f.dialog]; ui.form = { id: f.dialog, def, ctx: M.view(ui.caseId, ui).formCtx, pick: def.options ? def.pick : 0, value: def.field ? def.field.value : '', err: null, fieldErr: '' }; pendingFocus = def.options ? 'fopt:' + def.pick : 'fd-value'; return; }
    if (f.dialog === 'pr') { const v = M.view(ui.caseId, ui); ui.pr = { title: v.title, desc: '', mode: 'write', gen: false, genTitle: false, titleN: 0, titleSuggested: false, draft: false, watch: true, base: 'dev' }; if (!v.runs.length || !/^Create \d/.test(label)) { generateTitle(); generate(); } else startStack(v); pendingFocus = v.runs.length ? 'pd-ok' : 'pd-close'; }
  },
  confirmed: () => !!(ui.confirm && ui.confirm.ok),
  askConfirm(f, label) { ui.dialog = ''; ui.confirm = Object.assign(R.confirmOf(f, label), { f, label }); ui.menu = ''; pendingFocus = 'confirm:yes'; },
  working(label) { ui.busy = { label }; ui.menu = ''; if (ui.confirm) ui.confirm.err = null; if (ui.pr) ui.pr.err = null; if (ui.form) ui.form.err = null; pendingFocus = ui.form && ui.dialog === ui.form.id ? 'fd-ok' : ui.dialog ? 'pd-ok' : ui.confirm ? 'confirm:yes' : pendingFocus; },
  // The mock of the app's call: a step that asked takes its time and can fail; one that did not is quicker. Left behind (Cancel, another case), it never lands.
  perform(f, label) {
    const busy = ui.busy, asked = f.confirm || f.dialog || f.fromDialog;
    return new Promise((answer) => setTimeout(() => {
      if (ui.busy !== busy) return;
      ui.busy = null;
      const odd = asked && takeBreak('step');
      answer(asked && (odd || takeFail()) ? { ok: false, odd, why: REASON[label.split(' ')[0]] || 'GitHub did not answer' } : { ok: true });
    }, asked ? 900 : 250));
  },
  done(f, label) { done(f, label); render(); },
  failed(label, err) { failed(err); render(); document.querySelector('.pd-alert')?.scrollIntoView({ block: 'nearest' }); },
});
function done(f, label) {
  ui.dialog = ''; ui.confirm = null; ui.menu = ''; ui.form = null;
  // Done on a group's page, it happens to the run it names, and the group reads from that run.
  if (f.member !== undefined) { const v = M.view(ui.caseId, ui); const i = f.index !== undefined ? f.index : v.holdIndex; ui.over = Object.assign({}, ui.over, { [ui.caseId + ':' + i]: M.moveMember(ui.caseId, i, ui, f.member, f) }); toast(f.say); pendingFocus = 'act-main'; return; }
  if (f.leave) { if (SHELL) { ui = fresh('starting'); SHELL.go('runs'); window.RailPulse?.say(f.say); } else { goCase('deleted', {}); toast(f.say); } return; }
  if (f.fix) { ui.fixed = Object.assign({}, ui.fixed, { [f.fix]: true }); toast(f.say); pendingFocus = 'act-main'; return; }
  if (f.run) { f.run(); toast(f.say); pendingFocus = 'act-main'; }
  else if (f.to) { goCase(f.to, f); toast(f.say); } else { toast(f.say); pendingFocus = pendingFocus || 'act-main'; }
}
// Why a step fails here (a mock's reasons); a failure keeps the state as it was.
const REASON = { Report: 'the report could not be sent', Link: 'the remote did not answer', Push: 'the remote rejected the push', Publish: 'the remote rejected the push', Fix: 'GitHub did not answer', Update: 'GitHub did not answer', Resume: 'the schedule could not be saved', Raise: 'the budget settings could not be saved', Mark: 'GitHub did not answer', Apply: 'a terminal still has the folder open', Abort: 'the run did not answer; it may have just finished', Delete: 'a terminal still has the worktree open', Merge: 'GitHub says the branch is behind dev; update it and try again', Create: 'git push was rejected: the remote branch moved', Stop: 'the run did not answer; it may have just finished',
  Archive: 'a terminal still has the worktree open', Discard: 'a terminal still has the worktree open', Cancel: 'run 3 had just started', 'Re-plan': 'the planner did not answer in time', Continue: 'the budget settings could not be saved' };
function failed(err) {
  const why = err.reason.replace(/^./, (c) => c.toLowerCase());
  if (ui.form && ui.dialog === ui.form.id) { ui.form.err = err; pendingFocus = 'fd-ok'; return; }
  if (ui.dialog === 'pr') {
    // a stack fails part-way: the PRs already opened stay opened, and a retry opens only the rest
    const left = (ui.pr.prs || []).filter((x) => !x.made);
    if (ui.pr.prs && left.length > 1) { left[0].made = '#' + (959 + ui.pr.prs.indexOf(left[0])); left[0].open = false; ui.dialogLabel = 'Create ' + (left.length - 1) + ' PRs';
      err.title = R.failureOf('Create ' + (left.length - 1) + ' of ' + ui.pr.prs.length + ' PRs').title; err.detail = 'Opened ' + left[0].made + '; the next one failed: ' + why + '. A retry opens only the rest.'; }
    ui.pr.err = err; pendingFocus = 'pd-ok';
  } else { ui.confirm.err = err; ui.confirm.ok = false; pendingFocus = 'confirm:yes'; }
}
// The prototype's "Next one fails" switch: the next confirmed step or suggestion fails, to show how a failure reads.
function takeFail() { const box = document.getElementById('fail-next'); if (!box || !box.checked) return false; box.checked = false; return true; }
// The prototype's "Break something" picker: what an error nobody planned for looks like (docs/rail/failures.md: When
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
const draftFail = (kind) => R.suggestionFail({ retry: { 'data-draft': kind, 'data-key': 'draft-retry-' + kind }, attrs: { style: 'flex:1 0 100%' } });
function draft(kind) {
  const flag = kind === 'answer' ? 'answerDraft' : 'changesDraft'; ui[flag] = true; clearTimeout(draftTimer); const fails = takeFail(); ui[kind + 'Err'] = false;
  draftTimer = setTimeout(() => { if (!ui[flag]) return; ui[flag] = false; if (fails) { ui[kind + 'Err'] = true; render(); return; } if (kind === 'answer') { ui.answerOwn = DRAFT.answer; ui.answer = -1; pendingFocus = 'answer-own'; } else { ui.changesText = DRAFT.changes; pendingFocus = 'changes-text'; } render(); }, 1100);
}
// A document opens in its viewer: a view only shows, so it is a Dialog without a form.
function openDoc(i) { const d = M.view(ui.caseId, ui).tabData; const name = d.artifacts[i][0]; ui.doc = { name, body: d.docBody[name] || '' }; ui.dialog = 'doc'; ui.menu = ''; pendingFocus = 'vd-close'; }
function act(label) {
  if (label === 'Ask for changes' || label === 'Revise') { const v = M.view(ui.caseId, ui); ui.changesFor = label; ui.dialog = 'changes'; ui.changesText = ''; ui.menu = ''; if (v.id === 'plan' || v.id === 'outline') { draft('changes'); pendingFocus = 'draft-stop'; } else pendingFocus = 'changes-text'; return; }
  if (label === 'Full plan') { openDoc(0); return; }
  if (label === 'Review the workflow') { ui.dialog = 'graph'; ui.graphNode = null; ui.menu = ''; pendingFocus = 'vd-close'; return; }
  if (label === 'Watch' || label === 'Watch PRs') { const it = M.view(ui.caseId, ui).action.items.find((x) => x.text === label); ui.watched = !(it && it.checked); ui.menu = ''; toast(ui.watched ? (label === 'Watch' ? 'Worca watches the PR and fixes failing checks' : 'Worca watches all three PRs') : 'Worca stopped watching'); pendingFocus = 'act-main'; return; }
  if (label === 'Next question' || label === 'Previous question') { ui.question = (ui.question || 0) + (label === 'Next question' ? 1 : -1); ui.answer = null; ui.answerOwn = ''; ui.menu = ''; pendingFocus = 'act-main'; return; }
  if (/ (stacked PRs|one PR) instead$/.test(label)) {
    const v = M.view(ui.caseId, ui); const it = v.action.items.find((x) => x.text === label);
    if (it && it.off) { toast(it.help); ui.menu = ''; pendingFocus = 'menu:act'; return; }
    ui.ship = /one PR/.test(label) ? 'one' : 'stack'; ui.menu = '';
    const nv = M.view(ui.caseId, ui); return act(nv.action.label);
  }
  if (label === 'Cancel the rest') { follow({ say: 'The runs that had not started are cancelled; a running run keeps running', confirm: 'Cancel the rest? The runs that have not started are cancelled. A running run keeps running.', run: () => { ui.restGone = true; } }, label); return; }
  // What is left: the plan holds only the runs that have not finished.
  if (label === 'Re-plan the rest') { const left = M.view(ui.caseId, ui).runs.filter((r) => !/^(Ready|Merged)$/.test(r.word)).map((r) => r.title); follow({ to: 'outline', say: 'The waiting runs are cancelled; Worca planned what is left', confirm: 'Re-plan the rest? The waiting runs are cancelled and Worca plans what is left from the last finished run.', run: () => { goCase('outline', {}); ui.outline = left.length ? left : null; } }, label); return; }
  // A stack in review merges one PR at a time; merging one moves the next onto dev, where its checks run again.
  const pm = ui.caseId === 'chain' && /^(Merge|Fix checks on) (#\d+)$/.exec(label);
  if (pm) {
    const nums = M.chainPrs; const i = nums.indexOf(pm[2]); const nx = nums[i + 1];
    const set = (fn) => () => { const st = (ui.stackSt || M.chainStart).slice(); fn(st); ui.stackSt = st; };
    if (pm[1] === 'Merge') follow({ confirm: 'Merge ' + pm[2] + ' into dev?' + (nx ? ' Worca then moves ' + nx + ' onto dev.' : ''), say: 'Merged ' + pm[2] + ' into dev' + (nx ? '; ' + nx + ' now goes into dev' : '; the whole stack is in dev'),
      run: set((st) => { st[i] = 'merged'; if (nx && st[i + 1] !== 'failing') st[i + 1] = 'checks'; }) }, label);
    else follow({ confirm: 'Fix the failing checks on ' + pm[2] + '? Worca pushes the fix to the PR.', say: 'A short run is fixing ' + pm[2] + '’s checks', run: set((st) => { st[i] = 'fixing'; }) }, label);
    return;
  }
  const stopRun = /^Stop run (\d+)$/.exec(label);
  if (stopRun) { follow({ member: 'stopped', index: +stopRun[1] - 1, say: 'Stopped run ' + stopRun[1] + '; its branch and changes stay', confirm: 'Stop run ' + stopRun[1] + '? Its branch and changes stay; the runs after it do not start.' }, label); return; }
  const flowNow = M.view(ui.caseId, ui).flow || {};
  const run = { Pause: 'pauseNow', 'Pause after this step': 'pauseAfter', 'Stop the run': 'stop' }[label];
  if (run && !flowNow[label]) {
    const vNow = M.view(ui.caseId, ui); const rf = vNow.runFlow[run];
    // Pause after this step changes nothing yet: the run keeps working, and says so until the step ends.
    if (rf.pauseAfter) { ui.pauseAfter = !ui.pauseAfter; ui.menu = ''; toast(ui.pauseAfter ? rf.say : 'It goes on after this step'); pendingFocus = 'act-main'; return; }
    // On a group's page Pause and Stop are the running run's; the group stays where it is and reads from it.
    if (vNow.liveRun >= 0 && run === 'pauseNow') { follow(Object.assign({}, rf, { to: undefined, member: rf.to, index: vNow.liveRun, say: 'Paused run ' + (vNow.liveRun + 1) + '; Resume goes on from where it was' }), 'Pause'); return; }
    follow(rf, label === 'Stop the run' ? 'Stop the run' : 'Pause'); return;
  }
  if (label === 'Try it' || label === 'Check out the whole feature') { toast(M.view(ui.caseId, ui).tryIt); ui.menu = ''; pendingFocus = 'act-main'; return; }
  const f = flowNow[label];
  if (f && f.openMember) { const v = M.view(ui.caseId, ui); ui.back = { caseId: ui.caseId, open: ui.open, tab: ui.tab }; goMember(ui.caseId, v.holdIndex); return; }
  if (f && f.commands) { ui.cmd = { label, text: f.commands }; ui.dialog = 'commands'; ui.menu = ''; pendingFocus = 'vd-close'; return; }
  if (f) follow(f, label); else toast(label + ': not in this prototype');
}
const EVENT = { starting: 'Plan is under way', working: 'Review passed', checks: '2 checks failed', failing: 'dev moved on: 2 files conflict', conflicts: 'Checks green, a reviewer approved', feature: 'Runs 2 and 3 finished', chain: 'The next PR’s checks pass and a reviewer approves' };
const chainNext = () => (ui.stackSt || M.chainStart).findIndex((x) => x === 'checks' || x === 'review' || x === 'fixing');
function nextEvent() {
  if (ui.caseId === 'chain') { const i = chainNext(); if (i < 0) return; const st = (ui.stackSt || M.chainStart).slice(); const fx = st[i] === 'fixing'; st[i] = fx ? 'checks' : 'ready'; ui.stackSt = st; toast('Event: ' + M.chainPrs[i] + (fx ? ' fix is pushed; checks run again' : ' checks passed and a reviewer approved')); render(); return; }
  const v = M.view(ui.caseId, ui); const flowNext = v.flow || {}; const to = flowNext.next;
  // The step you asked it to pause after has ended.
  if (ui.pauseAfter && v.bar.stop && v.liveRun < 0) { const step = v.formCtx.step; goCase('paused-you', { step: 'pause-after' }); toast('Event: ' + step + ' finished; the run paused, as you asked'); render(); return; }
  if (!to) return; const say = v.event || EVENT[ui.caseId] || EVENT[v.state] || 'something happened outside the run'; if (flowNext.fixed) ui.fixed = Object.assign({}, ui.fixed, { [flowNext.fixed]: true }); goCase(to); toast('Event: ' + say); render(); }
// The page asks you something in one place, under the bar: confirm a step that cannot be taken back, schedule a run
// after this one, or set up the PR before it opens.
function underHtml(u) {
  return `<li class="sc-answer">${issuesHtml(u.issues)}${rolesHtml(u.roles, 'step')}</li>`;
}
const detailsLink = () => R.failureLink({ label: 'Details', attrs: { 'data-say': DETAILS, 'data-key': 'err-details' } });
function stripHtml(v) {
  const acts = (yes) => R.confirmActions({ yes });
  if (ui.dialog === 'after') {
    const opts = v.finished ? ['Now, as a follow-up'] : ['When this run finishes'].concat(v.place.pr ? ['When its PR merges'] : []);
    return R.confirmForm({ form: 'after', text: v.runAfter.label, body: `<input class="input input-sm" id="after-task" type="text" placeholder="What should the next run do?" aria-label="Task for the next run" data-key="after-task" value="${esc(ui.afterDraft || '')}">
      ${opts.length > 1 ? `<select class="select input-sm" id="after-when" aria-label="When it starts" data-key="after-when">${opts.map((o) => `<option>${esc(o)}</option>`).join('')}</select>` : `<span class="rtab-dim" id="after-when-t">${esc(opts[0])}</span>`}${acts(v.finished ? 'Start run' : 'Schedule')}` });
  }
  if (ui.dialog === 'changes') {
    return R.confirmForm({ form: 'changes', text: ui.changesFor === 'Revise' ? 'Tell Worca what to change in the workflow' : v.id === 'plan' || v.id === 'outline' ? 'Tell the planner what to change' : 'Say what to change', body: `${R.suggestionField({ id: 'changes-text', cls: 'pd-wide', value: ui.changesText || '', rows: 3, placeholder: v.id === 'plan' || v.id === 'outline' ? 'What should the plan do differently?' : 'What should change?', writingPlaceholder: 'Drafting from the 2 open issues…', writing: ui.changesDraft, attrs: { 'data-key': 'changes-text' }, act: ui.changesDraft ? R.stopWriting({ attrs: { 'data-stopdraft': 'changes', 'data-key': 'draft-stop', title: null } }) : R.suggestButton({ tip: draftTip('Draft it from the open issues'), label: 'Draft it from the open issues', attrs: { 'data-draft': 'changes', 'data-key': 'draft-changes' } }) })}
      ${ui.changesErr ? draftFail('changes') : ''}${acts(v.id === 'plan' || v.id === 'outline' ? 'Send to the planner' : 'Send')}` });
  }
  if (ui.confirm) {
    const c = ui.confirm; const busy = !!ui.busy && !ui.dialog;
    const err = c.err && { title: c.err.title, detail: c.err.detail, extra: c.err.odd ? detailsLink() : '' };
    return R.confirmStrip({ text: c.text, yes: c.yes, no: c.no, danger: c.danger, busy: busy ? R.workingWord(c.label) : '', err });
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
  const sug = R.suggestedChip();
  const H = v.tabData.helper.pr; const tip = (what) => `${what} · writes with ${H.model} (Models › Helper jobs › ${H.job})`;
  // Worca could not write it: the field keeps the text it had, says so, and offers Try again.
  const fail = (f, i, sfx, gen) => R.suggestionFail({ model: H.model, retry: { 'data-pd': gen, 'data-pi': i, 'data-key': `pd-retry-${gen}${sfx}` } });
  // The title and description fields, shared by one PR and by each PR of a stack (i is its row, -1 for one PR).
  const fields = (f, i) => {
    const sfx = i < 0 ? '' : '-' + i; const hook = (o) => Object.assign({ 'data-pi': i }, o);
    const sparkle = (kind, what, label) => R.suggestButton({ tip: tip(what), label, attrs: hook({ 'data-pd': kind, 'data-key': `pd-${kind}${sfx}` }) });
    const titleField = R.suggestionField({ id: 'pd-title' + sfx, value: f.title, placeholder: 'Title', writingPlaceholder: 'Suggesting a title…', writing: f.genTitle, attrs: { maxlength: 256, 'data-key': 'pd-title' + sfx }, act: sparkle('gentitle', 'Suggest a title', 'Suggest a title') });
    const stop = R.stopWriting({ attrs: hook({ 'data-pd': 'stop', 'data-key': 'pd-stop' + sfx }) });
    const eye = R.previewToggle({ on: f.mode === 'preview', attrs: { 'data-pdmode': f.mode === 'preview' ? 'write' : 'preview', 'data-pi': i, 'data-key': 'pd-eye' + sfx } });
    const descField = f.mode === 'preview' ? R.suggestionPreview({ writing: f.gen, html: f.desc ? md(f.desc) : '<p class="rtab-dim">Nothing to preview yet.</p>' })
      : R.suggestionField({ id: 'pd-desc' + sfx, value: f.desc, rows: 7, placeholder: 'Optional: empty uses the title', writingPlaceholder: 'Writing from the run: what it did, its changes, how it was checked…', writing: f.gen, attrs: { 'data-key': 'pd-desc' + sfx } });
    return `<div class="pd-f"><span class="pd-lab"><label for="pd-title${sfx}">Title</label>${f.titleSuggested && !f.genTitle ? sug : ''}</span>${titleField}${f.errTitle ? fail(f, i, sfx, 'gentitle') : ''}</div>
    <div class="pd-f"><span class="pd-lab"><label for="pd-desc${sfx}">Description</label>${f.descSuggested && !f.gen ? sug : ''}${f.gen ? stop : sparkle('gen', 'Write it from the run', 'Write the description from the run')}${eye}</span>${descField}${f.errDesc ? fail(f, i, sfx, 'gen') : ''}</div>`;
  };
  // A stack, reviewed by exception: the rows are the stack shown once (order, size, base); Worca writes every title
  // and description, and you open a row only to change it. A row Worca thinks is worth a look says why.
  const sh = v.ship;
  const rowLine = (f, i) => f.made ? `<span class="st-sum">Opened ${esc(f.made)}</span>` : f.gen || f.genTitle ? '<span class="st-writing">Writing…</span>'
    : (f.errDesc || f.errTitle) && !f.open ? '<span class="st-sum">Couldn’t write it; today’s text stays</span>'
    : v.tabData.prFlag[i] ? `<span class="st-flag">${esc(v.tabData.prFlag[i])}</span>` : `<span class="st-sum" title="${esc(v.tabData.prSum[i] || '')}">${esc(v.tabData.prSum[i] || '')}</span>`;
  const rowsHtml = stacked && pr.prs ? `<div class="pd-f"><span class="pd-hint">Worca writes each title and description from its run. Open a row only to change it.</span><ol class="st-list">${pr.prs.map((f, i) => R.stackedPrRow({ n: i + 1, title: f.title, line: rowLine(f, i), meta: [`${(sh.sizes || [])[i] || ''} · ${v.tabData.prFiles[i] || 1} files`, i && sh.word !== 'separate' ? 'into PR ' + i : 'into ' + pr.base], open: f.open, made: f.made, body: f.open && !f.made ? fields(f, i) : '', attrs: { 'data-prrow': i, 'data-key': 'prrow:' + i } })).join('')}</ol></div>` : '';
  const title = stacked ? '' : fields(pr, -1);
  const branch = v.place.branch || 'feat/unified-page-navigation';
  // The sentence says what opens, from where, into what; how many PRs is a picker in it, like the base.
  const shipPick = sh ? `${wordPick('pdship', sh.pick === 'one' ? 'One PR' : sh.n + ' ' + sh.word + ' PRs', 'How many PRs', [
    { id: 'ship:stack', text: sh.n + ' ' + sh.word + ' PRs', checked: sh.pick !== 'one', hint: sh.rec !== 'one' ? 'Suggested' : '', help: sh.word === 'separate' ? 'One PR per run, each into dev' : 'One PR per run, each into the one before' },
    { id: 'ship:one', text: 'One PR', checked: sh.pick === 'one', hint: sh.rec === 'one' ? 'Suggested' : '', off: !!sh.oneBlocked, help: sh.oneBlocked || 'Every run in one review' }], 'pd-ship')}<span>from</span>` : '';
  const shipHint = sh ? `<span class="pd-hint">${esc((sh.pick === sh.rec ? 'Worca suggests this: ' : 'Worca suggests ' + (sh.rec === 'one' ? 'one PR' : sh.n + ' ' + sh.word + ' PRs') + ': ') + sh.reason)}</span>` : '';
  const into = `<div class="pd-f"><div class="pd-into">${shipPick}<code class="pd-br" title="${esc(branch)}">${esc(branch)}</code><span>into</span>${wordPick('pdbase', pr.base, 'Base branch · pushes to origin', ['dev', 'main'].map((x) => ({ id: 'base:' + x, text: x, checked: pr.base === x })))}</div>
    ${shipHint}${v.baseMoved && pr.base === 'dev' ? '' : `<span class="pd-hint${pr.base === 'main' ? ' is-warn' : ''}">${pr.base === 'main' ? 'main is 41 commits behind dev; the PR would carry them too' : 'dev has 2 new commits since the run started; they merge cleanly'}</span>`}</div>`;
  // Where it goes (Advanced): which remote it pushes to and which it opens against; another repository says so.
  const remotes = R.shows('advanced') ? `<div class="pd-f"><div class="pd-into"><span>Push to</span>${wordPick('pdpush', pr.push || 'origin', 'The remote the branch goes to', ['origin', 'fork'].map((x) => ({ id: 'pushr:' + x, text: x, checked: (pr.push || 'origin') === x })))}<span>open on</span>${wordPick('pdremote', pr.remote || 'origin', 'The remote the pull request opens on', ['origin', 'upstream'].map((x) => ({ id: 'baser:' + x, text: x, checked: (pr.remote || 'origin') === x })))}</div>${(pr.remote || 'origin') !== (pr.push || 'origin') ? `<span class="pd-hint">A pull request across repositories: ${esc(pr.push || 'origin')}’s branch into ${esc(pr.remote || 'origin')}’s ${esc(pr.base)}</span>` : ''}</div>` : '';
  const moved = v.baseMoved && pr.base === 'dev' ? `<span class="pd-hint is-warn">dev moved while the run worked: 12 new commits, 1 file overlaps. Update the branch first, or the PR opens with conflicts.</span>` : '';
  const release = `<div class="pd-f">${R.checkbox({ label: 'Add a release', checked: !!pr.release, attrs: { id: 'pd-release', 'data-key': 'pd-release' } })}${pr.release ? R.field({ id: 'pd-version', label: 'Version', value: pr.version === undefined ? 'v1.20.0' : pr.version, hint: 'From the latest tag · a draft release after it merges', attrs: { 'data-key': 'pd-version' } }) : ''}</div>`;
  const tryFirst = R.shows('advanced') && !stacked ? `<div class="pd-f"><div class="rl-tools">${R.button({ label: 'Try it first', kind: 'quiet', attrs: { 'data-pd': 'try', 'data-key': 'pd-try', title: v.heldBy ? `Held by “${v.heldBy}”` : v.hosted ? HOSTED_WHY : 'Checks the branch out locally before the PR opens', disabled: !!(v.heldBy || v.hosted || ui.copy) } })}${ui.copy ? '<span class="pd-hint">Local copy open · since 18:12</span>' : ''}</div></div>` : '';
  const opts = `<div class="pd-opts">${R.checkbox({ label: 'Draft', checked: pr.draft, attrs: { id: 'pd-draft', 'data-key': 'pd-draft' } })}${R.checkbox({ label: 'Watch: fix failing checks', checked: pr.watch, attrs: { id: 'pd-watch', 'data-key': 'pd-watch' } })}<span class="pd-hint pd-closes">${stacked ? 'The last PR closes ' : 'Closes '}${esc(v.tabData.issue)}</span></div>`;
  const alert = pr.err ? `<div class="pd-alert" role="alert"><b>${esc(pr.err.title)}</b><span>${esc(pr.err.detail)}${pr.err.odd ? ' ' + detailsLink() : ''}</span></div>` : '';
  const busy = !!ui.busy;
  // The Dialog component: its head (title, Close), the one scrolling body, its foot (Cancel, the step naming what happens).
  return R.dialog({ title: ui.dialogLabel, id: 'pd-h', close: svg('x', 14), body: `${into}${moved}${remotes}${rowsHtml}${title}${opts}${release}${tryFirst}${alert}`,
    yes: ui.dialogLabel, busy, busyLabel: R.workingWord(ui.dialogLabel),
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
  ui.pr.prs = v.runs.map((r, i) => ({ title: r.title, made: (v.ship.owned || {})[i] || '', desc: v.tabData.prTemplate(i, titles, v.title), gen: false, genTitle: false, titleSuggested: true, descSuggested: false, mode: 'write', open: false }));
  ui.pr.prs.forEach((f, i) => { if (!f.made) generate(f, i, 900 + i * 600); });
}
// A question is answered where it is asked: under its step, Worca's pick checked, the other options and your own
// words; the card's Send answer sends it. A multi-question Clarify shows the one it is on.
function answerHtml(q) {
  if (q.kind === 'auto') {
    const d = M.view(ui.caseId, ui).tabData;
    return `<li class="sc-answer"><p class="sc-ans-why">${esc(q.why)}</p><div class="rl-tools">${R.button({ label: 'Review the workflow', attrs: { 'data-act': 'Review the workflow', 'data-key': 'auto-review' } })}</div>${R.shows('expert') ? R.table({ label: 'What it tunes', columns: [{ id: 'name', label: 'Setting' }, { id: 'why', label: 'Why', narrow: false, bare: true }, { id: 'val', label: 'Value', num: true }], rows: d.tunables.map(([name, val, why]) => ({ name, val, why })) }) : ''}</li>`;
  }
  const pick = ui.answer === null || ui.answer === undefined ? q.pick : ui.answer;
  const own = R.suggestionField({ id: 'answer-own', inputCls: 'input-sm', value: ui.answerOwn || '', placeholder: 'Or write your own answer', writingPlaceholder: 'Writing an answer from the review…', writing: ui.answerDraft, attrs: { 'aria-label': 'Your own answer', 'data-key': 'answer-own' },
    act: ui.answerDraft ? R.stopWriting({ attrs: { 'data-stopdraft': 'answer', 'data-key': 'draft-stop', title: null } }) : R.suggestButton({ tip: draftTip('Draft an answer from the review'), label: 'Draft an answer', attrs: { 'data-draft': 'answer', 'data-key': 'draft-answer' } }) });
  return `<li class="sc-answer${ui.flashAnswer ? ' is-flash' : ''}">${q.n ? `<p class="sc-ans-q">${esc(q.q)} <span class="rtab-dim">${esc(q.n)}</span></p>` : ''}<p class="sc-ans-why">${esc(q.why)}</p>
    ${R.optionList({ label: q.q, options: q.options, selected: pick, recommended: q.pick, own, optAttrs: (i) => ({ 'data-answer': i, 'data-key': 'answer:' + i }) })}${ui.answerErr ? draftFail('answer') : ''}</li>`;
}
const v0 = () => M.view(ui.caseId, ui);
function goMember(group, i) {
  if (!ui.parent) ui.groupRun = ui.run;   // the group as it stands, for the way back up
  const m = M.memberAt(group, i, ui);
  Object.assign(ui, { caseId: m.id, run: m, parent: { caseId: group, index: i }, open: null, tab: '', focus: '', menu: '', titleOpen: false });
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
  const sl = SHELL && e.target.closest?.('#card [data-stage-line]');
  if (sl && !e.target.closest('.rc-zone')) { document.querySelector(`#card .sc-stage[data-stage="${CSS.escape(sl.dataset.stageLine)}"]`)?.click(); return; }
  if (SHELL && !SHELL.owns('run', e.target)) return;
  // in the one Worca the trail's first step is the Runs list itself
  if (SHELL && e.target.closest('#card [data-key="crumb:0"]')) { e.preventDefault(); SHELL.back(); return; }
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
  const offItem = e.target.closest('#card .menu-item[aria-disabled="true"]');
  if (offItem) { toast(offItem.title || 'Not available here'); ui.menu = ''; render(); return; }
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
  if (!t || !t.closest('#card')) return;
  const d = t.dataset;
  if (d.copy) { try { navigator.clipboard.writeText(d.copy).catch(() => {}); } catch { /* the clipboard is the browser's call */ } R.copied(t); return; }
  if (d.fd) {
    const F = ui.form;
    if (d.fd === 'cancel') { ui.form = null; ui.dialog = ''; ui.busy = null; pendingFocus = 'act-main'; render(); return; }
    const val = F.def.options ? F.def.options[F.pick] : String(F.value).trim();
    if (F.def.field && F.def.field.required && !val) { F.fieldErr = F.def.field.label + ' is needed'; pendingFocus = 'fd-value'; render(); return; }
    F.fieldErr = ''; const f = ui.dialogF; follow(Object.assign({}, f, { dialog: '', fromDialog: true, value: val, say: String(f.say || '').replace('{value}', val) }), ui.dialogLabel); render(); return;
  }
  if (d.fopt !== undefined) { ui.form.pick = +d.fopt; pendingFocus = 'fopt:' + d.fopt; render(); return; }
  if (d.viewclose !== undefined) { ui.dialog = ''; ui.doc = null; ui.graphNode = null; pendingFocus = 'act-main'; render(); return; }
  if (d.node !== undefined) { ui.graphNode = ui.graphNode === d.node ? null : d.node; pendingFocus = 'node:' + d.node; render(); document.querySelector('.wg-drawer')?.scrollIntoView({ block: 'nearest' }); return; }
  if (d.zoom) { ui.graphZoom = d.zoom === 'normal' ? '' : d.zoom; pendingFocus = 'zoom:' + d.zoom; render(); return; }
  if (d.graph !== undefined) { ui.dialog = 'graph'; ui.graphNode = null; pendingFocus = 'vd-close'; render(); return; }
  if (d.doc !== undefined) { openDoc(+d.doc); render(); return; }
  if (d.transcript !== undefined) { const x = M.view(ui.caseId, ui).sessions[+d.transcript]; ui.doc = { name: 'Transcript · ' + x.name, body: '## ' + x.name + '\n- You: go on with this step\n- Agent: read 12 files, edited 3\n- Agent: the step is done' }; ui.dialog = 'doc'; pendingFocus = 'vd-close'; render(); return; }
  if (d.logstep !== undefined) { ui.dialog = ''; ui.graphNode = null; ui.tab = 'activity'; ui.log = Object.assign({}, ui.log, { step: d.logstep || 'all', from: 'all', level: 'all', cycle: 'all', session: 'all', q: '' }); render(); document.getElementById('act-logs')?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }); return; }
  if (d.line) { ui.lines = ui.lines.includes(d.line) ? ui.lines.filter((x) => x !== d.line) : ui.lines.concat(d.line); pendingFocus = 'line:' + d.line; render(); return; }
  if (d.showmet !== undefined) { ui.showMet = !ui.showMet; pendingFocus = 'show-met'; render(); return; }
  if (d.showearlier !== undefined) { ui.showEarlier = !ui.showEarlier; pendingFocus = 'show-earlier'; render(); return; }
  if (d.mark) { const [id, m] = d.mark.split('|'); ui.marks = Object.assign({}, ui.marks, { [id]: m }); pendingFocus = m === 'met' ? 'mark:' + d.mark : 'mark-' + id; render(); return; }
  if (d.logview) { ui.log = Object.assign({}, ui.log, { raw: d.logview === 'raw' }); pendingFocus = 'logview:' + d.logview; render(); return; }
  if (d.service) { const id = d.service; const on = !ui.services[id]; ui.svcBusy = id; pendingFocus = 'svc:' + id; render(); setTimeout(() => { ui.svcBusy = ''; ui.services = Object.assign({}, ui.services, { [id]: on }); toast(on ? 'Started' : 'Stopped'); pendingFocus = 'svc:' + id; render(); }, 500); return; }
  if (d.checkout !== undefined) { ui.copy = !ui.copy; toast(ui.copy ? 'Checked out ' + (v0().place.branch || 'the branch') + ' on this machine' : 'Unlinked the local copy; the branch stays'); pendingFocus = 'ch:checkout'; render(); return; }
  if (d.cmt) {
    if (d.cmt === 'open') { const lines = v0().tabData.hunk.lines.filter(([k]) => k !== ' ').map(([, x]) => x.trim()); ui.commentOn = { path: d.path, line: lines[lines.length - 1], text: '', err: '' }; pendingFocus = 'cmt-text'; }
    else if (d.cmt === 'cancel') { ui.commentOn = null; pendingFocus = 'cmt-open'; }
    else { const c = ui.commentOn; if (!c.text.trim()) { c.err = 'Write the comment first'; pendingFocus = 'cmt-text'; } else { ui.comments = Object.assign({}, ui.comments, { [c.path]: (ui.comments[c.path] || []).concat({ who: 'You', line: c.line, t: c.text.trim() }) }); ui.commentOn = null; toast('Comment added; the review sees it'); pendingFocus = 'cmt-open'; } }
    render(); return;
  }
  if (d.confirm && ui.dialog === 'after') {
    if (d.confirm === 'yes') { const task = (document.getElementById('after-task')?.value || '').trim() || 'Follow-up to ' + M.view(ui.caseId, ui).title; const when = document.getElementById('after-when')?.value || document.getElementById('after-when-t')?.textContent || '';
      ui.after = ui.after.concat({ task, when }); toast((when.startsWith('Now') ? 'Started: ' : 'Scheduled: ') + task + (when.startsWith('Now') ? '' : ' · ' + when.toLowerCase())); }
    ui.dialog = ''; ui.afterDraft = ''; pendingFocus = 'menu:more';
  }
  else if (d.draft) { draft(d.draft); pendingFocus = 'draft-stop'; }
  else if (d.stopdraft) { ui[d.stopdraft === 'answer' ? 'answerDraft' : 'changesDraft'] = false; clearTimeout(draftTimer); pendingFocus = d.stopdraft === 'answer' ? 'answer-own' : 'changes-text'; }
  else if (d.confirm && ui.dialog === 'changes') {
    if (d.confirm === 'yes') { const txt = (document.getElementById('changes-text')?.value || '').trim(); const f = (v0().flow || {})[ui.changesFor || 'Ask for changes'] || {};
      if (!txt) { toast('Write what to change first'); render(); return; }
      ui.dialog = ''; ui.changesDraft = false; pendingFocus = 'act-main';
      if (f.to) goCase(f.to); toast(f.say || 'Sent to the planner; it plans again'); }
    else { ui.dialog = ''; ui.changesDraft = false; pendingFocus = 'act-main'; }
  }
  else if (d.pd === 'try') { ui.copy = true; toast('Checked out on this machine; the PR waits for you'); pendingFocus = 'pd-title'; }
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
    const [pid, pval] = d.menuPick.split('|');
    if (/^log-/.test(pid)) { const k = { 'log-from': 'from', 'log-level': 'level', 'log-step': 'step', 'log-cycle': 'cycle', 'log-session': 'session' }[pid]; ui.log = Object.assign({}, ui.log, { [k]: pval }); ui.menu = ''; pendingFocus = 'pick:' + pid; }
    else if (pid === 'session') { ui.session = +pval; ui.menu = ''; pendingFocus = 'pick:session'; }
    else if (pid === 'cmtline') { ui.commentOn.line = pval; ui.menu = ''; pendingFocus = 'pick:cmtline'; }
    else if (pid === 'cut:merge' || pid === 'cut:remove' || pid === 'cut:undo') {
      const runs = (ui.outline || v0().outlineRuns).slice(); const i = +pval; ui.menu = '';
      if (pid === 'cut:undo') { ui.outline = null; ui.outlineEdited = false; toast('Back to the split as Worca wrote it'); }
      else if (pid === 'cut:merge') { runs.splice(i, 2, runs[i] + ' + ' + runs[i + 1]); ui.outline = runs; ui.outlineEdited = true; toast('Merged runs ' + (i + 1) + ' and ' + (i + 2)); }
      else { runs.splice(i, 1); ui.outline = runs; ui.outlineEdited = true; toast('Removed run ' + (i + 1)); }
      pendingFocus = 'act-main';
    }
    else if (d.menuPick.startsWith('pushr:')) { ui.pr.push = d.menuPick.slice(6); ui.menu = ''; pendingFocus = 'menu:pdpush'; }
    else if (d.menuPick.startsWith('baser:')) { ui.pr.remote = d.menuPick.slice(6); ui.menu = ''; pendingFocus = 'menu:pdremote'; }
    else if (d.menuPick === 'more:try') { ui.tryBusy = 'checkout'; ui.menu = 'more'; pendingFocus = 'menu:more'; setTimeout(() => { ui.tryBusy = 'setup'; render(); setTimeout(() => { ui.tryBusy = ''; ui.copy = true; toast('Checked out on this machine · local copy open'); render(); }, 500); }, 500); }
    else if (/^try:(start|stop)$/.test(d.menuPick)) { const id = v0().tabData.services[0].id; const on = d.menuPick === 'try:start'; ui.services = Object.assign({}, ui.services, { [id]: on }); ui.menu = 'more'; pendingFocus = 'menu:more'; toast(on ? 'Started' : 'Stopped'); }
    else if (d.menuPick === 'try:open') { ui.menu = ''; pendingFocus = 'menu:more'; toast('Opened localhost:' + v0().tabData.services[0].port); }
    else if (d.menuPick === 'try:actions') { ui.tab = 'changes'; ui.menu = ''; pendingFocus = 'menu:more'; }
    else if (d.menuPick === 'more:unlink' || d.menuPick === 'ch:discard-copy' || d.menuPick === 'more:discard-copy') { const unlink = d.menuPick === 'more:unlink'; ui.copy = false; ui.menu = ''; pendingFocus = 'menu:more'; toast(unlink ? 'Unlinked the local copy; the branch stays' : 'Discarded the local copy; the branch stays'); }
    else if (d.menuPick === 'more:preset') { ui.menu = ''; ui.dialogF = { dialog: 'preset', say: 'Saved as preset “{value}”' }; ui.dialogLabel = 'Save as preset'; follow(ui.dialogF, 'Save as preset'); }
    else if (d.menuPick === 'more:delete') { const noun = v0().kind.toLowerCase(); follow({ leave: true, say: 'Deleted the ' + noun + ' and its runs; their PRs stay', confirm: 'Delete this ' + noun + ' and its runs? This cannot be undone; their PRs stay.' }, 'Delete'); }
    else if (d.menuPick === 'more:report') { ui.menu = ''; follow(v0().runFlow.report, 'Report this ' + (v0().kind ? v0().kind.toLowerCase() : 'run')); }
    else if (d.menuPick === 'more:link') { toast('Copied the link to this ' + (v0().kind ? v0().kind.toLowerCase() : 'run')); pendingFocus = 'menu:more'; ui.menu = ''; }
    else if (d.menuPick === 'group:toggle') { ui.askEach = !ui.askEach; ui.menu = ''; pendingFocus = 'menu:more'; toast(ui.askEach ? 'Worca asks before each run starts' : 'Each run starts by itself'); }
    else if (d.menuPick.startsWith('base:')) { ui.pr.base = d.menuPick.slice(5); ui.menu = ''; pendingFocus = 'menu:pdbase'; }
    else if (d.menuPick.startsWith('ship:')) {
      const want = d.menuPick.slice(5); const sh = M.view(ui.caseId, ui).ship; ui.menu = ''; pendingFocus = 'menu:pdship';
      if (want === 'one' && sh.oneBlocked) toast(sh.oneBlocked);
      else { ui.ship = want; const nv = M.view(ui.caseId, ui); ui.dialogLabel = nv.action.label; ui.dialogF = nv.flow[nv.action.label]; ui.pr.err = null;
        if (want === 'one' && !ui.pr.desc && !ui.pr.gen) { generateTitle(); generate(); }
        if (want === 'stack' && !ui.pr.prs) startStack(nv); }
    }
    else if (d.menuPick.startsWith('away:')) { ui.away = d.menuPick; ui.menu = ''; pendingFocus = 'menu:more'; toast('Away mode on this run: ' + AWAY.find((x) => x.id === d.menuPick).text); }
    else if (d.menuPick === 'more:after') { ui.dialog = 'after'; ui.menu = ''; pendingFocus = 'after-task'; }
    else if (d.menuPick === 'more:archive') { const vm = v0(); const a = vm.runFlow.archive; follow(Object.assign({}, a, { confirm: (vm.dependents ? vm.dependents + ' runs wait on this one and will start without it. ' : '') + a.confirm.replace('this run', 'this ' + (vm.kind ? vm.kind.toLowerCase() : 'run')) }), 'Archive'); }
    else if (d.menuPick === 'more:restore') { landOn(M.restored(ui)); toast('The record is back in Runs; its branch, worktree and logs are not'); }
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
    Object.assign(ui, { caseId: back.caseId, run: ui.groupRun && ui.groupRun.id === back.caseId ? ui.groupRun : null, open: back.open, tab: back.tab, parent: null, back: null, menu: '' });
    pick.value = ui.caseId; pendingFocus = 'open-run';
  }
  else if (d.stage) { ui.open = d.stage; ui.menu = ''; }
  else if (d.tab) { ui.tab = d.tab; ui.focus = ''; if (t.classList.contains('rc-fig-link')) pendingFocus = 'tab:' + d.tab; }
  else if (d.ref) { ui.tab = 'activity'; ui.view = 'steps'; ui.focus = d.ref; pendingFocus = 'act:' + d.ref; render(); document.querySelector('.is-focus')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); return; }
  else if (d.view) ui.view = d.view;
  else if (d.go) {
    const [kind, n] = d.go.split(':');
    if (kind === 'tab') ui.tab = n;
    else if (kind === 'doc' && !v0().tabs.some((x) => x.id === 'changes')) { openDoc(+n); render(); return; }
    else { ui.tab = 'changes'; if (kind === 'file') ui.file = +n; ui.land = d.go; pendingFocus = kind === 'file' ? 'file:' + n : 'art:' + n; }
    render(); ui.land = '';
    document.querySelector('.ch-file.is-flash')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); return;
  }
  else if ('askopen' in d) { ui.askOpen = !ui.askOpen; pendingFocus = 'ask-open'; }
  else if ('goanswer' in d) { pendingFocus = v0().ask.options ? 'answer:' + (ui.answer ?? v0().ask.pick) : 'act-main'; ui.flashAnswer = true; render(); ui.flashAnswer = false; document.querySelector('.sc-answer')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); return; }
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
  if (SHELL && (!SHELL.runActive() || document.querySelector('.pz-popover'))) return;   // Pulse's panel holds the keys while it is open
  const t = e.target;
  const act = R.shortcutAction(R.keyFacts(e), { scopes: ['run', 'anywhere'] });   // the library's table; here, what each does
  if (act === 'help' && !SHELL && !ui.menu && !ui.dialog) { e.preventDefault(); R.openShortcutsSheet({ doc: document, scopes: ['anywhere', 'run'] }); return; }   // in the one Worca, Pulse opens it
  if (t.id === 'group-input' && e.key === 'Enter') { e.preventDefault(); const g = t.value.trim(); if (g) { ui.chips = ui.chips.filter((c) => c.kind !== 'group').concat({ kind: 'group', text: g }); ui.menu = ''; pendingFocus = 'menu:more'; toast((KNOWN.group.some(([x]) => x === g) ? 'Moved to ' : 'Created and moved to ') + g); } render(); return; }
  if (t.id === 'tag-input' && e.key === 'Enter') { e.preventDefault(); addTag(t.value); render(); return; }
  if (act === 'labels' && document.querySelector('.rc-tags')) { e.preventDefault(); ui.menu = 'tags'; pendingFocus = 'tag-input'; render(); return; }
  if ((ui.confirm || ui.dialog) && act === 'close' && !ui.menu) { ui.form = null; ui.doc = null; ui.graphNode = null; if (ui.pr) { ui.pr.gen = false; ui.pr.genTitle = false; (ui.pr.prs || []).forEach((f) => { f.gen = false; f.genTitle = false; }); } ui.confirm = null; ui.dialog = ''; ui.busy = null; pendingFocus = 'act-main'; render(); return; }
  if (act === 'terminal') { e.preventDefault(); toast('Terminal opened in the worktree'); render(); return; }
  if (e.key === 'Enter' && e.target.id === 'after-task') { e.preventDefault(); document.querySelector('[data-confirm="yes"]')?.click(); return; }
  if (ui.menu && (act === 'close' || (e.key === 'Tab' && t.closest && t.closest('.menu')))) {
    pendingFocus = ui.menu === 'groups' ? 'menu:more' : 'menu:' + ui.menu; ui.menu = ''; render(); if (act === 'close') e.preventDefault(); return;
  }
  const k = { next: 1, prev: -1, first: 'first', last: 'last' }[act];
  if (!k || !t.closest) return;
  const group = t.closest('.menu') ? [...t.closest('.menu').querySelectorAll('.menu-item')]
    : t.getAttribute('role') === 'tab' ? [...t.closest('[role="tablist"]').querySelectorAll('[role="tab"]')]
    : t.getAttribute('role') === 'radio' ? [...t.closest('[role="radiogroup"]').querySelectorAll('[role="radio"]:not([disabled])')] : null;
  if (!group) return;
  if (t.getAttribute('role') === 'tab' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;   // tabs are horizontal
  e.preventDefault();
  const i = group.indexOf(t);
  const next = group[k === 'first' ? 0 : k === 'last' ? group.length - 1 : (i + k + group.length) % group.length];
  if (t.closest('.menu')) { next.focus(); return; }
  pendingFocus = next.dataset.key; next.click();
});
// A case named in the address (#question) opens on load, so a review sheet can show every state at once.
R.prefs.onChange(render);
// A menu, a picker, an editor and a Dialog close on a click outside or Esc (docs/rail/panels.md).
let stale = false;
const onPage = () => !SHELL || SHELL.runActive();
const repaint = () => { if (stale) { stale = false; render(); } };
R.dismissOnOutside(document, { rank: 3, open: () => !!ui.menu && onPage(), inside: '.rc-pop, .menu, .spick, [data-tagzone]', back: () => `[data-key="menu:${CSS.escape(ui.menu === 'groups' ? 'more' : ui.menu)}"]`, close: () => { ui.menu = ''; stale = true; }, paint: repaint });
R.dismissOnOutside(document, { dialog: true, open: () => onPage() && !ui.busy && !!document.querySelector('#card .viewer-modal'), inside: '#card .viewer-modal .card', back: () => '[data-key="act-main"]', close: () => { ui.form = null; ui.doc = null; ui.graphNode = null; ui.dialog = ''; if (ui.pr) { ui.pr.gen = false; ui.pr.genTitle = false; (ui.pr.prs || []).forEach((f) => { f.gen = false; f.genTitle = false; }); } stale = true; }, paint: repaint });
{ const h = location.hash.slice(1); if (!SHELL && M.cases.some((c) => c.id === h)) { pick.value = h; pick.dispatchEvent(new Event('change')); } else render(); }
})();
