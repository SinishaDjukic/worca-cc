// ui/public/requirements-view.mjs
// The Requirements page (plans/requirements-design.md §6): the feature specs, and one feature's interview
// and spec. app.js owns routing and the WebSocket; this module owns the host it is given and routes
// through `deps.route(param)` (#requirements/<param>).
//
//   const view = createRequirementsView({ host, subEl, msgEl, deps });
//   view.show(param)    '' the list · 'new' a new feature · 'feature/<n>' one feature (the route's param)
//   view.changed(seq)   a `requirements-changed` frame: refetch what is on screen
//   view.destroy()

// The displayed state (A2 §4), always the server's `f.state`: the page never derives it. `started` is
// drawn as the latest run's pill (runPill), not as a badge.
const STATE = Object.freeze({
  looking: { label: 'Looking', cls: 'running' },
  thinking: { label: 'Thinking', cls: 'running' },
  your_turn: { label: 'Your turn', cls: 'amber' },
  decide: { label: 'Decide', cls: 'amber' },
  ready: { label: 'Ready', cls: 'green' },
  started: { label: 'Started', cls: '' },
  archived: { label: 'Archived', cls: '' },
});
// The list's filter tabs. Counts leave archived out; Archived fetches with archived=1 and has no count.
const FILTERS = Object.freeze([
  { key: 'open', label: 'All open', has: (s) => s !== 'archived' },
  { key: 'needs', label: 'Needs you', has: (s) => s === 'your_turn' || s === 'decide' },
  { key: 'ready', label: 'Ready', has: (s) => s === 'ready' },
  { key: 'started', label: 'Started', has: (s) => s === 'started' },
  { key: 'archived', label: 'Archived', has: (s) => s === 'archived', noCount: true },
]);
const READY_CHECKS = 6;
const RUN_LIVE = ['created', 'starting', 'running', 'pausing'];
const SECTIONS = [['goal', 'Goal'], ['actors', 'Actors'], ['flow', 'Main flow'], ['edgeCases', 'Edge cases'],
  ['rules', 'Business rules'], ['outOfScope', 'Out of scope'], ['openQuestions', 'Open questions']];
// The long lists the spec card folds behind one link.
const FOLDED = ['flow', 'edgeCases', 'rules', 'outOfScope'];
const KEYS = ['A', 'B', 'C', 'D'];
const MAX_ROUNDS = 6;

function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'hidden') node.hidden = !!v;
    else if (k === 'disabled') node.disabled = !!v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// The page's icons (24px grid, drawn in currentColor; the colour comes from style.css).
const ICONS = Object.freeze({
  pencil: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4z' }], ['path', { d: 'M13.5 6.5l4 4' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  remove: [['path', { d: 'M7 7l10 10M17 7L7 17' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  circle: [['circle', { cx: 12, cy: 12, r: 7.5 }]],
  dots: [['circle', { cx: 5, cy: 12, r: 1.6 }], ['circle', { cx: 12, cy: 12, r: 1.6 }], ['circle', { cx: 19, cy: 12, r: 1.6 }]],
  ask: [['path', { d: 'M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6.5L8 21v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z' }],
    ['path', { d: 'M9.9 9.1a2.2 2.2 0 1 1 3.2 2c-.7.4-1.1.9-1.1 1.6' }], ['path', { d: 'M12 15v.01' }]],
  play: [['path', { d: 'M6 4l14 8-14 8V4Z' }]],
  warn: [['path', { d: 'M12 3l9.5 17h-19L12 3z' }], ['path', { d: 'M12 10v4.5M12 17.5v.01' }]],
});
const AUTO_WORKFLOW = 'wf_auto';
// Workflows a feature never starts with: the memory defragment is a maintenance run, not a build.
const NOT_FOR_BUILDS = ['wf_auto', 'wf_memory_defrag'];
const REASON_MAX = 500;
/** An inline SVG icon; decorative (aria-hidden) unless `label` names it (role=img). */
function icon(shapes, { size = 16, label = null, width = 2, fill = 'none', stroke = 'currentColor' } = {}) {
  const set = (el, attrs) => { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const svg = set(document.createElementNS(SVG_NS, 'svg'), { width: size, height: size, viewBox: '0 0 24 24', fill, stroke,
    'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  if (label) set(svg, { role: 'img', 'aria-label': label }); else svg.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) svg.append(set(document.createElementNS(SVG_NS, tag), attrs));
  return svg;
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) { const err = new Error(data.error || `HTTP ${res.status}`); err.status = res.status; err.data = data; throw err; }
  return data;
}

const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const sentence = (s) => { const t = String(s || '').replace(/[_-]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const badge = (state) => h('span', { class: `badge ${STATE[state]?.cls || ''}`.trim(), text: STATE[state]?.label || state });
const runColour = (status) => (RUN_LIVE.includes(status) ? 'peach' : status === 'done' ? 'green'
  : status === 'error' || status === 'stopped' ? 'red' : '');
/** The latest run as a pill: peach while it runs (its phase as the text), amber while it waits for the person
 *  (a question or the Auto confirmation), green done, red error / stopped. */
function runPill(run) {
  const status = run && run.status;
  if (run && run.waiting === true) return h('span', { class: 'pill-run req-run amber' }, h('span', { class: 'pdot' }), 'Waiting for you');
  const text = (RUN_LIVE.includes(status) && run.phase ? sentence(run.phase) : sentence(status)) || 'Started';
  return h('span', { class: `pill-run req-run ${runColour(status)}`.trim() }, h('span', { class: 'pdot' }), text);
}
// A list row carries `latestRun`; the feature page has its starts, newest first, each with its run.
const latestRunOf = (f) => (f.latestRun !== undefined ? f.latestRun : (f.starts && f.starts[0] && f.starts[0].run) || null);
const stateMark = (f) => (f.state === 'started' ? runPill(latestRunOf(f)) : badge(f.state));
/** The line under a row's title, by state; `need` when it asks something of the person. */
function rowMeta(f) {
  const run = f.latestRun;
  switch (f.state) {
    case 'your_turn': {
      const k = Number.isInteger(f.pendingCount) && f.pendingCount > 0 ? `${plural(f.pendingCount, 'question')} for you` : 'Your turn';
      return { text: `Round ${Math.min(Number(f.rounds) || 1, MAX_ROUNDS)} of ${MAX_ROUNDS} · ${k}`, need: true };
    }
    case 'decide': {
      const n = Number(f.openAssumptions) || 0;
      return { text: `Interview done · Ready ${Number(f.ready) || 0} of ${READY_CHECKS}${n > 0 ? ` · ${plural(n, 'assumption')} to decide` : ''}`, need: true };
    }
    case 'ready': return { text: `Ready ${READY_CHECKS} of ${READY_CHECKS}` };
    case 'started': {
      // the interview goes on after a start (A2 D11): questions waiting are said here too
      const k = Number.isInteger(f.pendingCount) && f.pendingCount > 0 ? f.pendingCount : 0;
      const waits = !!(run && run.waiting === true);
      const runText = waits ? ' · run waiting for you'
        : run && run.status ? ` · run ${run.status}${run.phase ? ` · ${sentence(run.phase)}` : ''}` : '';
      return { text: `Started${runText}${k ? ` · ${plural(k, 'question')} for you` : ''}`, need: k > 0 || waits };
    }
    case 'looking': return { text: 'Worca is looking at the code…' };
    case 'thinking': return { text: 'Worca is thinking…' };
    default: return null;
  }
}
const isWorking = (f) => !!f.busy || f.status === 'looking' || f.status === 'thinking';
// Worca is working, or the feature is archived: nothing on the page may be changed.
const isLocked = (f) => isWorking(f) || f.status === 'archived';

export function createRequirementsView({ host, subEl, msgEl, deps = {} }) {
  const route = deps.route || ((p) => { location.hash = p ? `#requirements/${p}` : '#requirements'; });
  let param = '';
  let seqShown = null;
  let paintNo = 0;
  let draft = null;          // { roundTurnId, picks: {id: option}, texts: {id: text} } — the open card's unsent answers
  let revising = null;       // the earlier round being changed (its round turn id), shown as a card (D12)
  let revDraft = null;       // that card's unsent answers, as `draft`
  let editing = null;        // the section open in its editor
  let current = null;        // the feature page on screen: { f, turns }, for a repaint without a fetch
  let focusNext = null;      // the data-ui field the next feature paint focuses (a field just opened)
  let targets = { projects: [], workspaces: [] };
  let filter = 'open';      // the list's filter tab (FILTERS), kept across repaints and visits
  let paintedKey = null;     // what the host currently shows: 'list' | 'new' | 'feature/<n>'
  let focusLater = null;     // a data-ui to focus once it is on screen, while the focus is lost (a round sent)
  // Start in worca: the workflow / branch choices per feature seq ({ workflowId, sourceBranch, open }),
  // the workflow list and each project's branches (loaded once, when Change opens), a start in flight,
  // and the start-before-Ready dialog ({ wrap, trigger, triggerUi }).
  const choices = new Map();
  let workflows = null;      // null not loaded · 'loading' · [{ id, name }]
  const branchLists = new Map();   // projectDir -> 'loading' | { branches, current }
  let starting = false;
  let dialog = null;
  let workflowsFailed = false;     // GET /api/workflows failed: Auto only, and the card says so
  const assumePosting = new Set(); // assumption ids whose Confirm / Reject POST is in flight
  // Unsaved input of the feature page, kept across repaints (read from the DOM before a rebuild, put back after).
  let ui = freshUi();
  let ctxEls = null;
  function freshUi() {
    return { editVals: null, crit: '', critOpen: false, orientOpen: false, moreOpen: false, menu: null, decideMore: false, specTab: 'draft',
      ctx: { open: false, loaded: false, loading: false, failed: false, body: '', look: false } };
  }

  if (subEl) subEl.textContent = 'Define a feature with Worca before anything is built. Nothing runs until you start it.';
  const say = (text, kind = '') => { if (msgEl) { msgEl.textContent = text || ''; msgEl.className = `form-msg${kind ? ` ${kind}` : ''}`; } };
  const fail = (err) => say(err && err.status === 404
    ? 'Requirements are turned off, or this feature no longer exists.'
    : (err && err.message) || String(err), 'err');
  const act = async (fn) => { say(''); try { await fn(); } catch (err) { fail(err); } };
  // "Started build v<n>." with a link to the run (the page stays on the feature, D10).
  const sayStarted = (version, runId) => {
    if (!msgEl) return;
    msgEl.className = 'form-msg ok';
    msgEl.replaceChildren(`Started build v${version}. `, h('a', { class: 'req-msg-link', href: `#running/${runId}` }, 'Open the run'));
  };

  async function loadTargets() {
    const [p, w] = await Promise.all([api('GET', '/api/projects').catch(() => ({})), api('GET', '/api/workspaces').catch(() => ({}))]);
    targets = { projects: p.projects || [], workspaces: w.workspaces || [] };
  }
  const targetName = (f) => (f.scopeType === 'workspace'
    ? targets.workspaces.find((w) => w.id === f.scopeKey)?.name
    : targets.projects.find((p) => p.key === f.scopeKey)?.name) || f.scopeKey;
  const targetLabel = (f) => `${f.scopeType === 'workspace' ? 'Workspace' : 'Project'} · ${targetName(f)}`;

  async function show(p = '') {
    param = String(p || '');
    const m = /^feature\/(?:FEAT-)?(\d+)$/.exec(param);
    const next = m ? Number(m[1]) : null;
    if (next !== seqShown) {
      draft = null; revising = null; revDraft = null; editing = null; current = null; ui = freshUi(); focusLater = null;
      closeDialog(false);
    }
    seqShown = next;
    say('');
    await paint();
  }
  // A live frame never touches the new-feature form; on the list only the list repaints.
  async function changed(seq) {
    if (param === 'new') return;
    if (seqShown == null || Number(seq) === seqShown) await paint();
  }

  async function paint() {
    const mine = ++paintNo;
    const key = param === 'new' ? 'new' : seqShown != null ? `feature/${seqShown}` : 'list';
    try {
      await loadTargets();
      if (key === 'new') {
        // The list call carries the code-look cost for the hint; the form renders without it.
        const look = await api('GET', '/api/requirements').then((d) => d.lookCostUsd, () => null);
        if (mine === paintNo) { paintNew(typeof look === 'number' ? look : null); paintedKey = key; }
        return;
      }
      if (seqShown != null) {
        const data = await api('GET', `/api/requirements/${seqShown}`);
        if (mine === paintNo) { paintFeature(data.feature, data.turns || []); paintedKey = key; }
        return;
      }
      const data = await api('GET', `/api/requirements${filter === 'archived' ? '?archived=1' : ''}`);
      if (mine === paintNo) { paintList(data); paintedKey = key; }
    } catch (err) {
      if (mine !== paintNo) return;
      // Only a 404, or a first load, blanks the host; any other failure keeps what is on screen.
      if ((err && err.status === 404) || paintedKey !== key) { host.replaceChildren(); paintedKey = null; }
      fail(err);
    }
  }

  // Read the unsaved input from the current feature page into `ui`, and which field has focus.
  function capture(f) {
    if (!host.querySelector(`[data-req-feature="${f.seq}"]`)) return null;
    const q = (k) => host.querySelector(`[data-ui="${k}"]`);
    const active = document.activeElement;
    const focus = active && host.contains(active) ? active.getAttribute('data-ui') : null;
    const ea = q('edit-a');
    if (ea) {
      const eb = q('edit-b');
      ui.editVals = { key: ea.closest('[data-section]')?.getAttribute('data-section'), a: ea.value, b: eb ? eb.value : '' };
    }
    const crit = q('new-criterion');
    if (crit) ui.crit = crit.value;
    if (ui.ctx.loaded && q('ctx-body')) { ui.ctx.body = q('ctx-body').value; ui.ctx.look = q('ctx-look').checked; }
    const orient = host.querySelector('.req-orient');
    if (orient) ui.orientOpen = orient.open;
    return focus;
  }

  // Every paint goes through here: a null or false child never reaches the DOM
  // (replaceChildren would render it as the text "null").
  const paintHost = (...kids) => host.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const setFilter = (key) => { if (key === filter) return; filter = key; void paint(); };

  function filterTabs(all) {
    const onKey = (e) => {
      const i = FILTERS.findIndex((F) => F.key === filter);
      const j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? FILTERS.length - 1 : null;
      if (j == null) return;
      e.preventDefault();
      setFilter(FILTERS[(j + FILTERS.length) % FILTERS.length].key);
    };
    return h('div', { class: 'seg req-filter', role: 'tablist', 'aria-label': 'Filter features', onkeydown: onKey },
      ...FILTERS.map((F) => {
        const on = F.key === filter;
        return h('button', { type: 'button', role: 'tab', class: on ? 'on' : null, 'aria-selected': on ? 'true' : 'false',
          tabindex: on ? '0' : '-1', 'data-filter': F.key, onclick: () => setFilter(F.key) },
        F.noCount ? F.label : `${F.label} · ${all.filter((f) => F.has(f.state)).length}`);
      }));
  }

  function listRow(f) {
    const meta = rowMeta(f);
    return h('button', { type: 'button', class: 'req-row', 'data-feature': f.seq, onclick: () => route(`feature/${f.seq}`) },
      h('code', { class: 'req-id', text: f.id }),
      h('span', { class: 'req-row-main' },
        h('span', { class: 'req-title', text: f.title }),
        meta ? h('span', { class: `hint req-row-meta${meta.need ? ' need' : ''}`, text: meta.text }) : null),
      stateMark(f),
      h('span', { class: 'req-cost', text: usd(f.costUsd) }));
  }

  function paintList(data) {
    const all = data.features || [];
    const F = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    const shown = all.filter((f) => F.has(f.state));
    const groups = new Map();
    for (const f of shown) {
      const k = `${f.scopeType}:${f.scopeKey}`;
      if (!groups.has(k)) groups.set(k, { label: targetLabel(f), items: [] });
      groups.get(k).items.push(f);
    }
    const spend = data.spend;
    const tabFocused = host.contains(document.activeElement) && document.activeElement.getAttribute('role') === 'tab';
    paintHost(
      h('div', { class: 'req-bar' },
        filterTabs(all),
        h('button', { type: 'button', class: 'btn-go', onclick: () => route('new') }, 'New feature')),
      shown.length ? null : h('p', { class: 'hint req-empty', text: all.length === 0 && filter !== 'archived'
        ? 'No features yet. Describe one in a few sentences and Worca interviews you about it.'
        : 'Nothing here.' }),
      [...groups.values()].map((g) => h('section', { class: 'req-group', 'aria-label': g.label },
        h('h2', { text: g.label }),
        h('div', { class: 'card req-rows' }, g.items.map(listRow)))),
      spend && typeof spend.windowUsd === 'number'
        ? h('p', { class: 'hint req-spend', text: `Spent on requirements this ${spend.resetPeriod === 'weekly' ? 'week' : 'month'}: ${usd(spend.windowUsd)}${
          typeof spend.totalLimitUsd === 'number' ? ` of your ${usd(spend.totalLimitUsd)} limit` : ''}.` })
        : null,
    );
    // a filter chosen from the keyboard keeps the focus on the tabs across the rebuild
    if (tabFocused) host.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }

  function paintNew(lookCost) {
    const select = h('select', { id: 'req-new-target' },
      targets.projects.length ? h('optgroup', { label: 'Projects' }, targets.projects.map((p) => h('option', { value: `project:${p.key}`, text: p.name }))) : null,
      targets.workspaces.length ? h('optgroup', { label: 'Workspaces' }, targets.workspaces.map((w) => h('option', { value: `workspace:${w.id}`, text: w.name }))) : null);
    const title = h('input', { id: 'req-new-title', type: 'text', maxlength: '200', placeholder: 'Cancel an order before it ships' });
    const desc = h('textarea', { id: 'req-new-desc', rows: '5', placeholder: 'A few sentences, the way you would tell a colleague.' });
    const lookHint = h('span', { class: 'hint req-new-look' });
    const sayLook = () => {
      lookHint.textContent = select.value.startsWith('workspace:')
        ? "Worca looks at the code of this workspace's projects once, read-only, to learn what already exists. Change that in Workspace context."
        : "Worca looks at this project's code once, read-only, to learn what already exists. Change that in Project context.";
    };
    select.addEventListener('change', sayLook);
    sayLook();
    const create = () => act(async () => {
      const [scopeType, ...rest] = select.value.split(':');
      const data = await api('POST', '/api/requirements', { scopeType, scopeKey: rest.join(':'), title: title.value, description: desc.value });
      route(`feature/${data.feature.seq}`);
    });
    const field = (id, label, control, ...after) => h('div', { class: 'field' }, h('label', { for: id }, ...label), control, ...after);
    paintHost(h('div', { class: 'req-new-page' },
      h('a', { href: '#requirements', class: 'hint req-back', onclick: (e) => { e.preventDefault(); route(''); } }, '← All features'),
      h('div', { class: 'req-new-head' },
        h('h2', { text: 'New feature' }),
        h('p', { class: 'req-sub', text: 'Describe it the way you would to a colleague. Worca asks the rest, a few questions at a time.' })),
      h('div', { class: 'card req-new' },
        field('req-new-title', ['Title'], title),
        field('req-new-desc', ['Describe it ', h('span', { class: 'opt', text: 'who needs it, what they want to do, and why' })], desc),
        field('req-new-target', ['For'], h('div', { class: 'select-wrap' }, select), lookHint),
        h('div', { class: 'actions req-new-actions' },
          lookCost != null ? h('span', { class: 'hint req-new-cost', text: `About ${usd(lookCost)} for the code look, then cents per round.` }) : null,
          h('div', { class: 'req-new-btns' },
            h('button', { type: 'button', class: 'btn', onclick: () => route('') }, 'Cancel'),
            h('button', { type: 'button', class: 'btn-go', onclick: create }, 'Start the interview'))))));
  }

  // ---- the feature page (board Interview.dc.html): header, the conversation left, Ready + spec right ----

  // Every round with its number, questions, note and the latest answers given (a revision supersedes).
  function roundsOf(turns) {
    const latest = new Map();
    for (const t of turns) if (t.kind === 'answers') latest.set(t.payload.roundTurnId, t.payload.answers || []);
    let n = 0;
    return turns.filter((t) => t.kind === 'round').map((t) => ({
      turnId: t.id, n: ++n, questions: t.payload.questions || [], note: t.payload.note || '',
      given: new Map((latest.get(t.id) || []).map((a) => [a.id, a])),
    }));
  }

  // The question card: the pending round (recommended answers preselected), or with `revise` an earlier
  // round prefilled from its latest answers (design D12), posted as a revision of that round.
  function questionCard(f, round, { revise = false } = {}) {
    let d = revise ? revDraft : draft;
    if (!d || d.roundTurnId !== round.turnId) {
      d = { roundTurnId: round.turnId, picks: {}, texts: {} };
      for (const q of round.questions) {
        const a = revise && round.given ? round.given.get(q.id) : null;
        if (a && a.answer) { if (q.options.includes(a.answer)) d.picks[q.id] = a.answer; else d.texts[q.id] = a.answer; }
        else if (q.recommended) d.picks[q.id] = q.recommended;
      }
      if (revise) revDraft = d; else draft = d;
    }
    const count = h('span', { class: 'qanswered' });
    const recount = () => {
      const n = round.questions.filter((q) => d.picks[q.id] || d.texts[q.id]).length;
      count.textContent = `${n} of ${round.questions.length} answered`;
    };
    const answers = () => round.questions.map((q) => (d.texts[q.id] ? { id: q.id, text: d.texts[q.id] }
      : d.picks[q.id] ? { id: q.id, option: d.picks[q.id] } : null)).filter(Boolean);
    const post = (extra) => act(async () => {
      await api('POST', `/api/requirements/${f.seq}/answers`, { roundTurnId: round.turnId, ...extra, answers: answers() });
      // a revision sent: the focus goes back to that round's Change, as soon as it is on screen again
      if (revise) { revDraft = null; revising = null; focusLater = `change-${round.turnId}`; } else draft = null;
      await paint();
    });
    const foot = revise
      ? [h('button', { type: 'button', class: 'btn btn-mini req-revise-cancel',
        onclick: () => { revising = null; revDraft = null; focusNext = `change-${round.turnId}`; redraw(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'btn-go', onclick: () => post({}) }, 'Submit changes')]
      : [h('button', { type: 'button', class: 'btn btn-mini req-finish', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/finish`, {}); await paint(); }) }, 'Finish now'),
        h('button', { type: 'button', class: 'btn btn-mini req-skip', onclick: () => post({ useRecommended: true }) }, 'Skip, use recommended'),
        h('button', { type: 'button', class: 'btn-go', onclick: () => post({}) }, 'Submit')];
    const panel = h('div', { class: `qpanel req-q${revise ? ' req-revise' : ''}` },
      h('div', { class: 'qpanel-head' }, h('b', { text: revise ? `Change round ${round.n}` : 'Your turn' }),
        h('span', { class: 'qcount', text: plural(round.questions.length, 'question') })),
      round.note ? h('p', { class: 'hint req-q-note', text: round.note }) : null,
      ...round.questions.map((q, i) => {
        const buttons = q.options.map((o, k) => h('button', { type: 'button', class: 'qopt', 'data-key': KEYS[k], 'data-ui': `q-${round.turnId}-${i}-${k}`,
          'aria-pressed': d.picks[q.id] === o && !d.texts[q.id] ? 'true' : 'false' },
          h('span', { class: 'qopt-txt', text: o }), o === q.recommended ? h('span', { class: 'qrec', text: 'Recommended' }) : null));
        const free = h('input', { class: 'qfree', type: 'text', value: d.texts[q.id] || '', placeholder: 'Or type your own answer…', 'aria-label': `Your own answer to: ${q.question}` });
        const sync = () => {
          buttons.forEach((b, k) => { const on = !d.texts[q.id] && d.picks[q.id] === q.options[k]; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('sel', on); });
          free.classList.toggle('has', !!d.texts[q.id]);
          recount();
        };
        buttons.forEach((b, k) => b.addEventListener('click', () => { d.picks[q.id] = q.options[k]; delete d.texts[q.id]; free.value = ''; sync(); }));
        free.addEventListener('input', () => { const v = free.value.trim(); if (v) { d.texts[q.id] = v; delete d.picks[q.id]; } else delete d.texts[q.id]; sync(); });
        queueMicrotask(sync);
        return h('div', { class: 'qblock' },
          h('div', { class: 'qtext' }, h('span', { class: 'qn', text: String(i + 1) }), q.question),
          q.why ? h('div', { class: 'hint req-why', text: q.why }) : null,
          h('div', { class: 'qopts' }, ...buttons), free);
      }),
      h('div', { class: 'qpanel-foot' }, count, ...foot));
    recount();
    return panel;
  }

  // Earlier rounds: one card, each answered question with its latest answer, a Change per round (D12).
  // The round waiting for answers is the question card instead.
  function earlierRounds(f, rounds) {
    const open = !isLocked(f);
    const shown = rounds.filter((r) => !(f.pending && r.turnId === f.pending.turnId));
    if (!shown.length) return null;
    return h('section', { class: 'card req-rounds' }, h('h3', { text: 'Earlier rounds' }),
      ...shown.map((r) => h('div', { class: 'req-round', 'data-round': r.turnId },
        h('div', { class: 'req-round-head' }, h('span', { class: 'req-round-n', text: `Round ${r.n}` }),
          open && r.questions.length && revising !== r.turnId
            ? h('button', { type: 'button', class: 'hint req-link req-change', 'data-ui': `change-${r.turnId}`, 'aria-label': `Change round ${r.n}`,
              onclick: () => { revising = r.turnId; revDraft = null; focusNext = `q-${r.turnId}-0-0`; redraw(); } }, 'Change')
            : null),
        r.note ? h('p', { class: 'hint req-round-note', text: r.note }) : null,
        ...r.questions.map((q) => {
          const a = r.given.get(q.id);
          return h('div', { class: 'req-round-q' },
            h('div', { class: 'req-round-qt', text: q.question }),
            h('div', { class: 'req-round-answer' }, a ? `→ ${a.answer}` : 'Not answered',
              a && a.recommended ? ' ' : null, a && a.recommended ? h('code', { text: 'recommended' }) : null));
        }))));
  }

  function conversation(f, turns, rounds) {
    const working = isWorking(f);
    const open = !isLocked(f);
    let rev = null;
    if (revising != null) {
      rev = rounds.find((r) => r.turnId === revising && r.questions.length) || null;
      if (!rev) { revising = null; revDraft = null; }
    }
    const hasStarts = (f.starts || []).length > 0;
    // The current card: a round being changed, the pending round, Ready to build, or Decide (A2 §5).
    const card = !open ? null
      : rev ? questionCard(f, rev, { revise: true })
        : f.pending ? questionCard(f, { ...f.pending, n: rounds.find((r) => r.turnId === f.pending.turnId)?.n })
          : buildCardShown(f) ? buildCard(f)
            : f.state === 'decide' || decideNeeded(f) ? decideCard(f)
              : null;
    return h('div', { class: 'req-left' },
      hasStarts ? runsCard(f) : null,
      hasStarts && (f.changedSinceStart || []).length ? changedNotice(f) : null,
      f.status === 'archived' ? h('p', { class: 'hint req-note', text: 'This feature is archived. Restore it to continue.' }) : null,
      working ? h('p', { class: 'hint req-working', text: f.status === 'looking' ? 'Worca is looking at the code…' : 'Worca is thinking…' }) : null,
      open && f.lastError ? h('div', { class: 'req-error form-msg err' }, f.lastError, ' ',
        h('button', { type: 'button', class: 'btn btn-mini req-retry', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/retry`, {}); await paint(); }) }, 'Try again')) : null,
      card,
      earlierRounds(f, rounds),
      orientationBox(f, turns));
  }

  // ---- Decide (board Decisions.dc.html, A2 D3/D4): Confirm / Reject per assumption, Confirm the N left,
  // and the follow-up round on the rejected ones not yet asked about ----
  // The Confirm / Reject toggle of one assumption (Decide card and spec card): a role=group of two
  // aria-pressed buttons; pressing the pressed one reopens it (A1). Both stay disabled while the POST runs,
  // across a live repaint too, so a double click never posts twice. `prefix` keeps the data-ui unique.
  function assumeToggle(f, a, { prefix = '', disabled = false, extraCls = '' } = {}) {
    const groupButtons = () => host.querySelectorAll(`[data-assume-toggle="${a.id}"] button`);
    const set = (status) => {
      if (assumePosting.has(a.id)) return;
      assumePosting.add(a.id);
      for (const b of groupButtons()) b.disabled = true;
      void act(async () => {
        try { await api('POST', `/api/requirements/${f.seq}/assumptions/${a.id}`, { status }); } finally { assumePosting.delete(a.id); }
        await paint();
      }).then(() => { for (const b of groupButtons()) if (!assumePosting.has(a.id)) b.disabled = disabled; });
    };
    const btn = (label, status, cls, key) => {
      const on = a.status === status;
      return h('button', { type: 'button', class: `${cls}${extraCls ? ` ${extraCls}` : ''}${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false',
        'aria-label': `${label} ${a.id}`, 'data-ui': `${prefix}${key}-${a.id}`, disabled: disabled || assumePosting.has(a.id),
        onclick: () => set(on ? 'open' : status) }, label);
    };
    return h('div', { class: 'seg seg-sm req-toggle', role: 'group', 'aria-label': `Decide ${a.id}`, 'data-assume-toggle': a.id },
      btn('Confirm', 'confirmed', 'req-yes req-confirm', 'confirm'), btn('Reject', 'rejected', 'req-no req-reject', 'reject'));
  }

  function decideCard(f) {
    const all = (f.spec && f.spec.assumptions) || [];
    if (!all.length) return h('p', { class: 'hint req-note', text: 'The interview is done. Edit the spec on the right; every change is kept.' });
    const waitingIds = f.unaskedRejections || [];
    const open = all.filter((a) => a.status === 'open');
    const waiting = all.filter((a) => a.status === 'rejected' && waitingIds.includes(a.id));
    const rest = all.filter((a) => !open.includes(a) && !waiting.includes(a));
    const rejected = all.filter((a) => a.status === 'rejected').length;
    const row = (a) => h('div', { class: `req-arow ${a.status}`, 'data-decide': a.id },
      h('code', { class: 'req-id', text: a.id }),
      h('span', { class: 'req-arow-text', text: a.text }),
      assumeToggle(f, a, { prefix: 'decide-' }));
    const post = (path, body) => act(async () => { await api('POST', `/api/requirements/${f.seq}/${path}`, body); await paint(); });
    return h('section', { class: 'qpanel req-decide', 'aria-label': 'Decide the assumptions' },
      h('div', { class: 'qpanel-head' }, icon(ICONS.ask, { size: 17, width: 1.8 }), h('b', { text: 'Decide the assumptions' }),
        h('span', { class: 'qcount', text: `${open.length} of ${all.length} left` })),
      h('p', { class: 'hint req-decide-note', text: 'Worca filled these gaps itself. Confirm what is right, reject what is not: a rejected one is asked again in one short round.' }),
      h('div', { class: 'req-arows' }, ...open.map(row), ...waiting.map(row), ...(ui.decideMore ? rest.map(row) : [])),
      rest.length ? h('button', { type: 'button', class: 'hint req-link req-decide-more', 'aria-expanded': ui.decideMore ? 'true' : 'false', 'data-ui': 'decide-more',
        onclick: () => { ui.decideMore = !ui.decideMore; focusNext = 'decide-more'; redraw(); } }, ui.decideMore ? 'Show fewer' : `Show the other ${rest.length}`) : null,
      h('div', { class: 'qpanel-foot' },
        h('span', { class: 'qanswered', text: `${all.length - open.length} decided · ${rejected} rejected` }),
        open.length ? h('button', { type: 'button', class: 'btn btn-mini', 'data-ui': 'confirm-all', onclick: () => post('assumptions', { confirmOpen: true }) },
          `Confirm the ${open.length} left`) : null,
        waitingIds.length ? h('button', { type: 'button', class: 'btn-go', 'data-ui': 'follow-up', onclick: () => post('follow-up', {}) },
          `Done, ask about ${waitingIds[0]}${waitingIds.length > 1 ? ` and ${waitingIds.length - 1} more` : ''}`) : null));
  }

  // Something to decide, from the data rather than the state (A2 D11): a started feature still decides its
  // assumptions and asks about the rejected ones (the state there is `started`, never `decide`).
  const decideNeeded = (f) => !f.pending && f.status === 'done'
    && (((f.spec && f.spec.assumptions) || []).some((a) => a.status === 'open') || (f.unaskedRejections || []).length > 0);

  // The Ready to build card is the current card: Ready, nothing to answer or change, not locked.
  const buildCardShown = (f) => f.state === 'ready' && !isLocked(f) && !f.pending && revising == null;

  // ---- Ready to build (board Ready.dc.html, A2 D6): what Start does, the workflow and base branch ----
  // The choices of a feature, kept per seq; a feature already started defaults to its last start's.
  function choiceOf(f) {
    let c = choices.get(f.seq);
    if (!c) {
      const last = (f.starts || [])[0];
      c = { workflowId: (last && last.workflowId) || AUTO_WORKFLOW, sourceBranch: (last && last.sourceBranch) || '', open: false };
      choices.set(f.seq, c);
    }
    return c;
  }
  // The version the next start saves the spec as: the latest start's + 1 (1 before any start).
  const nextVersion = (f) => ((((f.starts || [])[0]) || {}).version || 0) + 1;
  const projectPath = (f) => (f.scopeType === 'project' ? targets.projects.find((p) => p.key === f.scopeKey)?.path || null : null);
  const workflowName = (id) => (id === AUTO_WORKFLOW ? 'Auto' : (Array.isArray(workflows) && workflows.find((w) => w.id === id)?.name) || id);
  // Repaint for a list that just arrived, only while the Ready to build card is on screen.
  const redrawBuild = () => { if (current && host.querySelector('.req-build')) redraw(); };
  function loadBuildOptions(f) {
    if (workflows == null) {
      workflows = 'loading';
      api('GET', '/api/workflows').then((d) => { workflows = (d.workflows || []).filter((w) => w && w.id && !NOT_FOR_BUILDS.includes(w.id)); workflowsFailed = false; },
        () => { workflows = []; workflowsFailed = true; }).then(redrawBuild);
    }
    const dir = projectPath(f);
    if (dir && !branchLists.has(dir)) {
      branchLists.set(dir, 'loading');
      api('GET', `/api/branches?projectDir=${encodeURIComponent(dir)}`)
        .then((d) => { branchLists.set(dir, { branches: d.branches || [], current: d.current || null }); },
          () => { branchLists.set(dir, { branches: [], current: null }); }).then(redrawBuild);
    }
  }
  function buildChoices(f, c, chipBranch) {
    const opt = (value, text) => h('option', { value, text });
    const wfs = Array.isArray(workflows) ? workflows : [];
    const wf = h('select', { id: 'req-build-wf', 'data-ui': 'build-workflow' }, opt(AUTO_WORKFLOW, 'Auto'), ...wfs.map((w) => opt(w.id, w.name || w.id)),
      c.workflowId !== AUTO_WORKFLOW && !wfs.some((w) => w.id === c.workflowId) ? opt(c.workflowId, c.workflowId) : null);
    wf.value = c.workflowId;
    wf.addEventListener('change', () => { c.workflowId = wf.value || AUTO_WORKFLOW; redraw(); });
    let branch;
    if (f.scopeType === 'workspace') {
      branch = h('input', { type: 'text', id: 'req-build-branch', 'data-ui': 'build-branch', value: c.sourceBranch,
        placeholder: "Branch for every project (empty: each project's default)", 'aria-label': 'Branch for every project' });
      branch.addEventListener('input', () => { c.sourceBranch = branch.value.trim(); chipBranch.textContent = `Branch from · ${c.sourceBranch || 'default'}`; });
    } else {
      const list = branchLists.get(projectPath(f));
      const known = list && list !== 'loading' ? list : { branches: [], current: null };
      branch = h('select', { id: 'req-build-branch', 'data-ui': 'build-branch' },
        opt('', known.current ? `Project default (${known.current})` : 'Project default'), ...known.branches.map((b) => opt(b, b)),
        c.sourceBranch && !known.branches.includes(c.sourceBranch) ? opt(c.sourceBranch, c.sourceBranch) : null);
      branch.value = c.sourceBranch;
      branch.addEventListener('change', () => { c.sourceBranch = branch.value; redraw(); });
    }
    return h('div', { class: 'req-build-choices' },
      h('div', { class: 'req-build-field' }, h('label', { for: 'req-build-wf', text: 'Workflow' }), h('div', { class: 'select-wrap' }, wf),
        workflowsFailed ? h('span', { class: 'hint warn req-build-warn', role: 'status', text: 'Could not load workflows; Auto is used.' }) : null),
      h('div', { class: 'req-build-field' }, h('label', { for: 'req-build-branch', text: 'Branch from' }),
        f.scopeType === 'workspace' ? branch : h('div', { class: 'select-wrap' }, branch)));
  }
  function buildCard(f) {
    const c = choiceOf(f);
    if (c.open) loadBuildOptions(f);
    const version = nextVersion(f);
    const total = (f.readiness && f.readiness.total) || READY_CHECKS;
    const chipBranch = h('span', { class: 'chip', text: `Branch from · ${c.sourceBranch || 'default'}` });
    return h('section', { class: 'card req-build', 'aria-label': 'Ready to build' },
      h('div', { class: 'req-build-main' },
        h('h3', { text: 'Ready to build' }),
        h('p', {}, `All ${total} checks pass. Starting saves this spec as version ${version} and starts a run on `, h('b', { text: targetName(f) }),
          ' with it as the task. The run plans, builds and reviews; its cost counts toward your limit like any run.'),
        h('div', { class: 'req-build-chips' },
          h('span', { class: 'chip', text: `Workflow · ${workflowName(c.workflowId)}` }), chipBranch,
          h('button', { type: 'button', class: 'hint req-link', 'data-ui': 'build-change', 'aria-expanded': c.open ? 'true' : 'false',
            'aria-label': 'Change the workflow and branch',
            onclick: () => { c.open = !c.open; focusNext = c.open ? 'build-workflow' : 'build-change'; redraw(); } }, 'Change')),
        c.open ? buildChoices(f, c, chipBranch) : null),
      h('button', { type: 'button', class: 'btn-go req-build-go', 'data-ui': 'start-go', 'data-start': '', disabled: starting,
        onclick: (e) => startFlow(f, { trigger: e.currentTarget }) }, icon(ICONS.play, { size: 14, fill: 'currentColor', stroke: 'none' }), 'Start in worca'));
  }

  // ---- Started (board Started.dc.html, A2 D10/D11): the runs, the total, what changed since ----
  function runsCard(f) {
    const starts = f.starts || [];
    const r = f.readiness || {};
    const changed = (f.changedSinceStart || []).length > 0;
    const build = starts.reduce((sum, s) => sum + (Number(s.run && s.run.costUsd) || 0), 0);
    const req = Number(f.costUsd) || 0;
    const row = (s) => {
      const early = Array.isArray(s.failing) && s.failing.length > 0;
      const label = h('span', { class: 'req-run-label', title: early && s.reason ? s.reason : null,
        text: `Run · spec v${s.version}${early ? ' · started before Ready' : ''}` });
      if (!s.run) {
        return h('div', { class: 'req-run-row gone' }, h('span', { class: 'req-run-main' }, label, h('span', { class: 'hint', text: 'Run not found' })));
      }
      return h('a', { class: 'req-run-row', href: s.run.href || `#running/${s.runId}` },
        runPill(s.run), h('span', { class: 'req-run-main' }, label),
        h('span', { class: 'req-run-cost', text: usd(s.run.costUsd) }), h('span', { class: 'req-run-go', 'aria-hidden': 'true', text: '→' }));
    };
    return h('section', { class: 'card req-runs', 'aria-label': 'Runs from this feature' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'Runs from this feature' }),
        h('button', { type: 'button', class: 'btn btn-mini', 'data-ui': 'start-again', 'data-start': '',
          disabled: !changed || isLocked(f) || starting || !(r.ok || r.overridable),
          title: changed ? null : 'Nothing changed since the last start',
          onclick: (e) => startFlow(f, { trigger: e.currentTarget }) }, `Start again with v${nextVersion(f)}`)),
      h('div', { class: 'req-run-rows' }, ...starts.map(row)),
      h('p', { class: 'hint req-run-total' }, `Total for ${f.id} so far: `, h('code', { text: usd(req + build) }),
        ` (requirements ${usd(req)} + build ${usd(build)})`));
  }

  const sectionTitle = (key) => (SECTIONS.find(([k]) => k === key) || [key, sentence(key)])[1];
  // One line of the changed-since notice: what was there struck through, what is there now marked.
  function changeLine(c) {
    const del = (t) => h('del', { class: 'req-del', text: t });
    const ins = (t) => h('ins', { class: 'req-ins', text: t });
    const both = (a, b) => [a ? del(a) : null, a && b ? ' ' : null, b ? ins(b) : null];
    let kids;
    if (c.kind === 'goal') kids = [`${c.field === 'measure' ? 'Success measure' : 'Goal'}: `, ...both(c.before, c.after)];
    else if (c.kind === 'section') {
      const items = [...(c.removed || []).map(del), ...(c.added || []).map(ins)];
      kids = [`${sectionTitle(c.section)}: `, ...items.flatMap((x, i) => (i ? [' ', x] : [x]))];
    } else {
      const id = h('code', { class: 'req-id', text: c.id });
      kids = c.change === 'added' ? [id, ' added: ', ins(c.after || '')]
        : c.change === 'removed' ? [id, ' removed: ', del(c.before || '')]
          : [id, ' ', ...both(c.before, c.after)];
    }
    return h('div', { class: 'req-change-line' }, ...kids);
  }
  function changedNotice(f) {
    const v = f.starts[0].version;
    const undo = () => act(async () => {
      if (!window.confirm(`Undo your changes since build v${v}? The spec goes back to the one that run started with.`)) return;
      await api('POST', `/api/requirements/${f.seq}/revert`, { version: v });
      await paint();
    });
    return h('section', { class: 'req-changed', 'aria-label': 'Changed since the run started' },
      icon(ICONS.warn, { size: 18 }),
      h('div', { class: 'req-changed-body' },
        h('b', { text: 'Changed since the run started' }),
        ...f.changedSinceStart.map(changeLine),
        h('p', { text: `The running build still works from v${v}; it does not see this change.` }),
        h('div', { class: 'req-actions' },
          h('button', { type: 'button', class: 'btn btn-mini', 'data-ui': 'revert', disabled: isLocked(f), onclick: undo }, 'Undo my changes'))));
  }

  // A small icon button (`req-ico`); `req-sect-edit` marks it as one of the edits the lock disables.
  const icoBtn = (name, label, onclick, { disabled = false, cls = 'req-sect-edit', ...rest } = {}) => h('button',
    { type: 'button', class: `req-ico${cls ? ` ${cls}` : ''}`, 'aria-label': label, title: label, disabled, onclick, ...rest }, icon(ICONS[name], { size: 15 }));

  // `ro`: the started version (A2 §5), read-only: no pencil, no edited mark, no rewrite.
  function sectionBlock(f, key, title, ro = false) {
    const s = f.spec;
    const edited = !ro && !!s.edited?.[key];
    const working = isLocked(f);
    let body;
    if (editing === key && !ro) {
      const isGoal = key === 'goal';
      const a = isGoal ? h('input', { type: 'text', value: s.goal.text, 'aria-label': 'Goal', 'data-ui': 'edit-a' }) : h('textarea', { rows: '5', 'aria-label': title, 'data-ui': 'edit-a' }, (s[key] || []).join('\n'));
      const b = isGoal ? h('input', { type: 'text', value: s.goal.measure, placeholder: 'Success measure', 'aria-label': 'Success measure', 'data-ui': 'edit-b' }) : null;
      if (ui.editVals && ui.editVals.key === key) { a.value = ui.editVals.a; if (b) b.value = ui.editVals.b; }
      body = h('div', { class: 'req-edit' }, a, b,
        h('div', { class: 'req-actions' },
          h('button', { type: 'button', class: 'btn btn-mini', onclick: () => { editing = null; ui.editVals = null; redraw(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn-go', onclick: () => act(async () => {
            await api('PUT', `/api/requirements/${f.seq}/spec/${key}`, { value: isGoal ? { text: a.value, measure: b.value } : a.value });
            editing = null; ui.editVals = null; await paint();
          }) }, 'Save')));
    } else if (key === 'goal') {
      body = s.goal.text ? h('div', {}, h('p', { text: s.goal.text }), s.goal.measure ? h('p', { class: 'hint', text: `Measure: ${s.goal.measure}` }) : null) : h('p', { class: 'hint', text: 'Not yet.' });
    } else {
      const list = s[key] || [];
      body = list.length ? h(key === 'flow' ? 'ol' : 'ul', {}, ...list.map((t) => h('li', { text: t }))) : h('p', { class: 'hint', text: 'Not yet.' });
    }
    return h('section', { class: 'req-sect', 'data-section': key },
      h('div', { class: 'req-sect-head' },
        h('h4', {}, title, edited ? h('span', { class: 'req-edited', text: ' · edited by you' }) : null),
        edited ? h('button', { type: 'button', class: 'btn-ghost btn-mini req-sect-edit req-rewrite', disabled: working, 'aria-label': `Let Worca rewrite ${title}`,
          onclick: () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/spec/${key}/edited`); await paint(); }) }, 'Let Worca rewrite this') : null,
        ro ? null : icoBtn('pencil', `Edit ${title}`, () => { editing = key; focusNext = 'edit-a'; redraw(); }, { disabled: working, 'data-ui': `edit-${key}` })),
      body);
  }

  function criteriaBlock(f, ro = false) {
    const working = isLocked(f);
    const adding = !ro && (ui.critOpen || !!ui.crit);
    // the draft marks a criterion changed since the latest start (the version switch is on)
    const changedIds = new Map(ro ? [] : (f.changedSinceStart || []).filter((c) => c.kind === 'criterion' && c.change !== 'removed').map((c) => [c.id, c.change]));
    let input = null;
    let addBtn = null;
    if (adding) {
      input = h('input', { type: 'text', placeholder: 'Add a criterion: what a tester can check', 'aria-label': 'New acceptance criterion', 'data-ui': 'new-criterion' });
      input.value = ui.crit;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
        else if (e.key === 'Escape') { e.preventDefault(); ui.critOpen = false; ui.crit = ''; input.value = ''; focusNext = 'add-criterion'; redraw(); }
      });
      addBtn = h('button', { type: 'button', class: 'btn btn-mini req-sect-edit', disabled: working,
        onclick: () => act(async () => {
          await api('POST', `/api/requirements/${f.seq}/criteria`, { text: input.value });
          input.value = ''; ui.crit = ''; ui.critOpen = false;
          await paint();
        }) }, 'Add');
    }
    const list = f.spec.criteria || [];
    return h('section', { class: 'req-sect', 'data-section': 'criteria' },
      h('div', { class: 'req-sect-head' }, h('h4', { text: 'Acceptance criteria' }),
        ro ? null : icoBtn('plus', 'Add a criterion', () => { ui.critOpen = true; focusNext = 'new-criterion'; redraw(); },
          { disabled: working, 'aria-expanded': adding ? 'true' : 'false', 'data-ui': 'add-criterion' })),
      list.length ? h('ul', { class: 'req-items' }, ...list.map((c) => h('li', { class: 'req-item', 'data-criterion': c.id },
        h('code', { text: c.id }), h('span', { class: 'req-item-text', text: c.text }),
        changedIds.has(c.id) ? h('span', { class: 'hint req-changed-mark', text: changedIds.get(c.id) === 'added' ? 'new' : 'changed' }) : null,
        ro ? null : icoBtn('remove', `Remove ${c.id}`, () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/criteria/${c.id}`); await paint(); }),
          { disabled: working })))) : adding ? null : h('p', { class: 'hint', text: 'None yet.' }),
      adding ? h('div', { class: 'req-item req-add' }, input, addBtn) : null);
  }

  function assumptionsBlock(f, ro = false) {
    const working = isLocked(f);
    const list = f.spec.assumptions || [];
    return h('section', { class: 'req-sect', 'data-section': 'assumptions' },
      h('div', { class: 'req-sect-head' }, h('h4', { text: 'Assumptions' })),
      list.length ? null : h('p', { class: 'hint', text: 'None yet.' }),
      ...list.map((a) => h('div', { class: `req-item req-assume ${a.status}`, 'data-assumption': a.id },
        h('code', { text: a.id }), h('span', { class: 'req-item-text', text: a.text }),
        // the frozen version shows the status as a badge; the draft's toggle carries it (aria-pressed)
        ro ? h('span', { class: `badge ${a.status === 'confirmed' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}`, text: a.status })
          : assumeToggle(f, a, { disabled: working, extraCls: 'req-sect-edit' }))));
  }

  // The spec card: goal, actors, criteria, assumptions and open questions; the long lists folded behind one link.
  // Once started and changed since, a switch shows the draft (v<n+1>, editable) or the frozen spec the
  // latest run started with (v<n>, read-only).
  function specSwitch(f) {
    const n = nextVersion(f) - 1;
    const tab = (key, label) => {
      const on = ui.specTab === key;
      return h('button', { type: 'button', role: 'tab', class: on ? 'on' : null, 'aria-selected': on ? 'true' : 'false', tabindex: on ? '0' : '-1',
        'data-ui': `spec-tab-${key}`, onclick: () => { ui.specTab = key; focusNext = `spec-tab-${key}`; redraw(); } }, label);
    };
    const onKey = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      ui.specTab = ui.specTab === 'draft' ? 'started' : 'draft';
      focusNext = `spec-tab-${ui.specTab}`;
      redraw();
    };
    return h('div', { class: 'seg seg-sm req-spec-switch', role: 'tablist', 'aria-label': 'Spec version', onkeydown: onKey },
      tab('draft', `v${nextVersion(f)} draft`), tab('started', `v${n} started`));
  }

  function specCard(f) {
    const latest = (f.starts || [])[0];
    const canSwitch = !!(latest && latest.spec && (f.changedSinceStart || []).length);
    if (!canSwitch) ui.specTab = 'draft';
    const ro = canSwitch && ui.specTab === 'started';
    const v = ro ? { ...f, spec: latest.spec } : f;
    const s = v.spec;
    const n = FOLDED.reduce((k, key) => k + (s[key] || []).length, 0);
    const titleOf = (key) => SECTIONS.find(([k]) => k === key)[1];
    const interviewing = f.status === 'your_turn' || f.status === 'thinking' || f.status === 'looking';
    return h('section', { class: 'card req-spec' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'Spec' }),
        canSwitch ? h('span', { class: 'hint req-spec-ver', text: ro ? `v${latest.version} is with the run, read-only` : `v${nextVersion(f)} draft · v${latest.version} is with the run` })
          : interviewing ? h('span', { class: 'hint', text: 'updates after every round' }) : null,
        canSwitch ? specSwitch(f) : null),
      sectionBlock(v, 'goal', 'Goal', ro), sectionBlock(v, 'actors', 'Actors', ro),
      criteriaBlock(v, ro), assumptionsBlock(v, ro),
      sectionBlock(v, 'openQuestions', 'Open questions', ro),
      ui.moreOpen ? FOLDED.map((k) => sectionBlock(v, k, titleOf(k), ro)) : null,
      h('button', { type: 'button', class: 'link-btn req-more', 'aria-expanded': ui.moreOpen ? 'true' : 'false', 'data-ui': 'spec-more',
        onclick: () => { ui.moreOpen = !ui.moreOpen; focusNext = 'spec-more'; redraw(); } },
      ui.moreOpen ? 'Hide flow, edge cases, rules and out of scope' : `Show flow, edge cases, rules and out of scope (${plural(n, 'item')})`));
  }

  // ---- Start (A2 D5): a plain start, or with `override` the start-before-Ready dialog straight away.
  // A plain start the server refuses as NOT_READY opens the dialog too, naming the checks it reported. ----
  function startFlow(f, { override = false, trigger = null } = {}) {
    if (starting || dialog) return;
    if (override) { openStartDialog(f, failingChecks(f), trigger); return; }
    void startPlain(f, trigger);
  }
  // The checks that fail: the server's keys (NOT_READY) looked up in the readiness, else every failing one.
  function failingChecks(f, keys = null) {
    const checks = (f.readiness && f.readiness.checks) || [];
    if (!keys) return checks.filter((c) => !c.ok);
    return keys.map((k) => checks.find((c) => c.key === k) || { key: k, ok: false, label: sentence(k), hint: '' });
  }
  function postStart(f, extra = {}) {
    const c = choiceOf(f);
    const branch = String(c.sourceBranch || '').trim();
    return api('POST', `/api/requirements/${f.seq}/start`, { ...extra, workflowId: c.workflowId || AUTO_WORKFLOW, ...(branch ? { sourceBranch: branch } : {}) });
  }
  // A start went through: the answer carries the feature, now started; repaint from it and say so.
  function started(f, data) {
    starting = false;
    const c = choices.get(f.seq);
    if (c) c.open = false;
    // Another feature is on screen now: its page keeps its paint and its focus (only its Start buttons,
    // disabled while this start ran, come back).
    if (seqShown !== f.seq) { redraw(); return; }
    paintNo += 1;   // a fetch already under way would paint the feature as it was before the start
    if (data && data.feature && seqShown === data.feature.seq) { paintFeature(data.feature, data.turns || []); paintedKey = `feature/${seqShown}`; }
    sayStarted(data.version, data.runId);
    // The control pressed is gone with the repaint: the focus goes to the message's run link, else the runs card.
    const link = msgEl && msgEl.querySelector('a');
    const to = link && link.isConnected ? link : host.querySelector('.req-runs a.req-run-row, .req-runs button:not(:disabled)');
    if (to) to.focus();
  }
  async function startPlain(f, trigger) {
    say('');
    starting = true;
    for (const b of host.querySelectorAll('[data-start]')) b.disabled = true;
    const triggerUi = trigger && trigger.getAttribute ? trigger.getAttribute('data-ui') : null;
    try {
      started(f, await postStart(f));
    } catch (err) {
      starting = false;
      redraw();
      if (err && err.status === 409 && err.data && Array.isArray(err.data.failing)) {
        const now = current && current.f.seq === f.seq ? current.f : f;
        openStartDialog(now, failingChecks(now, err.data.failing), host.querySelector(`[data-ui="${triggerUi}"]`) || trigger);
      } else fail(err);
    }
  }

  // The start-before-Ready dialog (board StartAnyway.dc.html): the upstream modal overlay (.viewer-modal),
  // on <body> so a live repaint of the page never drops what is typed. Escape and Keep deciding close it;
  // Tab stays inside; the focus goes to the reason on open and back to the trigger on close.
  function openStartDialog(f, failing, trigger) {
    closeDialog(false);
    const openN = ((f.spec && f.spec.assumptions) || []).filter((a) => a.status === 'open').length;
    const assumptionsFail = failing.some((c) => c.key === 'assumptions');
    const who = (typeof deps.who === 'function' && deps.who()) || 'you';
    let busy = false;
    const area = h('textarea', { id: 'req-dlg-reason', rows: '3', maxlength: String(REASON_MAX), 'aria-required': 'true', 'aria-describedby': 'req-dlg-count' });
    const count = h('span', { class: 'hint req-dlg-count', id: 'req-dlg-count', text: `0 / ${REASON_MAX}` });
    const msg = h('p', { class: 'form-msg err req-dlg-msg', role: 'alert' });
    const go = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, assumptionsFail && openN ? `Start with ${openN} open` : 'Start anyway');
    const sync = () => { count.textContent = `${area.value.length} / ${REASON_MAX}`; go.disabled = busy || !area.value.trim(); };
    area.addEventListener('input', sync);
    go.addEventListener('click', async () => {
      if (busy || !area.value.trim()) return;
      busy = true; starting = true; sync(); msg.textContent = '';
      try {
        const data = await postStart(f, { reason: area.value.trim() });
        closeDialog(false);
        started(f, data);
      } catch (err) {
        starting = false;
        msg.textContent = (err && err.message) || String(err);
      } finally { busy = false; sync(); }
    });
    const card = h('section', { class: 'card req-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'req-dlg-title' },
      h('h2', { id: 'req-dlg-title', text: `Start ${f.id} before it's Ready?` }),
      h('p', { class: 'req-dlg-lead', text: failing.length === 1 ? 'One check does not pass yet:' : `${failing.length} checks do not pass yet:` }),
      h('div', { class: 'req-dlg-fail' },
        h('ul', {}, ...failing.map((c) => h('li', {}, icon(ICONS.circle, { label: 'Not passed' }),
          h('span', {}, h('b', { text: c.label || sentence(c.key) }), c.hint ? `: ${c.hint}` : '')))),
        assumptionsFail ? h('p', { text: 'The run treats open assumptions as confirmed: the build follows them as written.' }) : null),
      h('div', { class: 'field req-dlg-field' },
        h('label', { for: 'req-dlg-reason' }, 'Why start now? ', h('span', { class: 'opt', text: 'required, kept on the feature with your name' })),
        area, count),
      h('p', { class: 'hint req-dlg-who', text: `Recorded as: ${who} · started before Ready` }),
      msg,
      h('div', { class: 'req-dlg-btns' },
        h('button', { type: 'button', class: 'btn', onclick: () => { if (!busy) closeDialog(true); } }, 'Keep deciding'), go));
    const wrap = h('div', { class: 'viewer-modal req-dlg-wrap' }, card);
    const triggerUi = trigger && trigger.getAttribute ? trigger.getAttribute('data-ui') : null;
    // On the document, in the capture phase: Escape and Tab work wherever the focus is, even after a click
    // on the scrim left it on <body>. Removed on close.
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) closeDialog(true); return; }
      if (e.key !== 'Tab') return;
      const all = [...card.querySelectorAll('button, textarea, input, select, a[href]')].filter((el) => !el.disabled);
      if (!all.length) return;
      const first = all[0], last = all[all.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !card.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !card.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.append(wrap);
    // the page behind cannot be reached while the dialog is open
    host.inert = true; host.setAttribute('inert', '');
    dialog = { wrap, trigger, triggerUi, onKey };
    area.focus();
  }
  function restoreFocus(trigger, triggerUi) {
    const el = trigger && trigger.isConnected ? trigger : triggerUi ? host.querySelector(`[data-ui="${triggerUi}"]`) : null;
    if (el && !el.disabled) el.focus();
  }
  function closeDialog(restore = true) {
    if (!dialog) return;
    const { wrap, trigger, triggerUi, onKey } = dialog;
    dialog = null;
    document.removeEventListener('keydown', onKey, true);
    host.inert = false; host.removeAttribute('inert');
    wrap.remove();
    if (restore) restoreFocus(trigger, triggerUi);
  }

  // Ready to start? (A2 D1): the server's six checks, never derived here; every state but archived.
  function readyPanel(f) {
    const r = f.readiness;
    if (!r || !Array.isArray(r.checks) || f.status === 'archived') return null;
    // Once started, starting again needs a change since (the runs card's Start again, A2 D11).
    const hasStarts = (f.starts || []).length > 0;
    const same = hasStarts && !(f.changedSinceStart || []).length;
    const locked = isLocked(f) || starting || same;
    // While the Ready to build card is on screen its Start is the one (board Ready.dc.html), and once started
    // the runs card's Start again is: no second button here.
    const cardStarts = buildCardShown(f) || hasStarts;
    return h('section', { class: 'card req-ready' },
      h('div', { class: 'req-card-head' }, h('h3', { text: 'Ready to start?' }), h('code', { text: `${r.passed} of ${r.total || READY_CHECKS}` })),
      h('ul', { class: 'req-checks' }, ...r.checks.map((c) => h('li', { class: `req-check${c.ok ? ' ok' : ''}`, 'data-check': c.key },
        icon(c.ok ? ICONS.check : ICONS.circle, { label: c.ok ? 'Passed' : 'Not yet', width: c.ok ? 2.4 : 2 }),
        h('span', { class: 'req-check-label', text: c.label }),
        !c.ok && c.hint ? h('span', { class: 'hint req-check-hint', text: c.hint }) : null))),
      h('div', { class: 'req-ready-foot' },
        h('span', { class: 'hint', text: 'Nothing is built until you start it.' }),
        h('div', { class: 'req-ready-btns' },
          r.overridable ? h('button', { type: 'button', class: 'link-btn req-start-anyway', 'data-ui': 'start-anyway', 'data-start': '', disabled: locked,
            onclick: (e) => startFlow(f, { override: true, trigger: e.currentTarget }) }, "Start before it's Ready…") : null,
          cardStarts ? null : h('button', { type: 'button', class: r.ok ? 'btn-go btn-mini req-start' : 'btn btn-mini req-start', 'data-ui': 'start', 'data-start': '', disabled: !r.ok || locked,
            onclick: (e) => startFlow(f, { override: false, trigger: e.currentTarget }) }, 'Start in worca'))));
  }

  function loadContext(f) {
    ui.ctx.loading = true;
    void act(async () => {
      try {
        const c = await api('GET', `/api/requirements/context/${f.scopeType}/${encodeURIComponent(f.scopeKey)}`);
        ui.ctx.body = c.body; ui.ctx.look = !!c.lookAtCode; ui.ctx.loaded = true;
        // the page may have been rebuilt while loading: write into the panel that is on screen now
        if (ctxEls) { ctxEls.saveBtn.disabled = false; ctxEls.area.value = c.body; ctxEls.look.checked = !!c.lookAtCode; }
      } catch (err) { ui.ctx.failed = true; throw err; } finally { ui.ctx.loading = false; }
    });
  }

  // Project / Workspace context, opened from the ⋯ menu; loaded the first time it opens.
  function contextPanel(f) {
    ctxEls = null;
    if (!ui.ctx.open) return null;
    const name = f.scopeType === 'workspace' ? 'Workspace context' : 'Project context';
    const area = h('textarea', { rows: '4', 'aria-label': 'Shared context', 'data-ui': 'ctx-body', placeholder: 'Actors, terms and standing rules every feature here should know' });
    const look = h('input', { type: 'checkbox', id: 'req-ctx-look', 'data-ui': 'ctx-look' });
    const saveBtn = h('button', { type: 'button', class: 'btn btn-mini', disabled: !ui.ctx.loaded, onclick: () => act(async () => {
      await api('PUT', `/api/requirements/context/${f.scopeType}/${encodeURIComponent(f.scopeKey)}`, { body: area.value, lookAtCode: look.checked });
      say('Context saved.', 'ok');
    }) }, 'Save context');
    ctxEls = { area, look, saveBtn };
    if (ui.ctx.loaded) { area.value = ui.ctx.body; look.checked = ui.ctx.look; }
    else if (!ui.ctx.loading && !ui.ctx.failed) loadContext(f);
    return h('section', { class: 'card req-context', 'aria-label': name },
      h('div', { class: 'req-card-head' }, h('h3', { text: name }),
        h('button', { type: 'button', class: 'btn btn-mini', 'data-ui': 'ctx-close', onclick: () => { ui.ctx.open = false; focusNext = 'menu-more'; redraw(); } }, 'Close')),
      area, h('label', { for: 'req-ctx-look', class: 'req-ctx-look' }, look, ' Let Worca look at the code when a feature starts'),
      h('div', { class: 'req-actions' }, saveBtn));
  }

  function orientationBox(f, turns) {
    const o = f.orientation;
    const text = !o ? 'Not looked yet.'
      : o.skipped === 'off' ? 'Looking at the code is turned off for this one (Project context).'
        : o.skipped === 'no-repo' ? 'There is no repository to look at yet.'
          : o.skipped === 'failed' ? 'Worca could not look at the code this time; the interview runs without it.'
            : o.summary || 'Nothing relevant found.';
    const looks = turns.filter((t) => t.kind === 'orientation' && !(t.payload && t.payload.skipped));
    const cost = looks.reduce((sum, t) => sum + (Number(t.costUsd) || 0), 0);
    const times = looks.length === 1 ? 'looked once' : looks.length === 2 ? 'looked twice' : `looked ${looks.length} times`;
    const nFiles = ((o && o.files) || []).length;
    const meta = looks.length ? [times, nFiles ? plural(nFiles, 'file') : null, cost > 0 ? usd(cost) : null].filter(Boolean).join(' · ') : null;
    return h('details', { class: 'card req-orient', open: ui.orientOpen }, // `open: false` is skipped by h()
      h('summary', {}, 'What Worca found in the code', meta ? h('span', { class: 'hint req-orient-meta', text: meta }) : null),
      h('p', { text }),
      o && o.files && o.files.length ? h('ul', { class: 'hint', 'data-min-level': 'advanced' }, ...o.files.map((p) => h('li', { text: p }))) : null);
  }

  // A menu button (the ⋯ header menu's pattern, .hd-more-wrap / .hd-menu): the trigger toggles a role=menu
  // list; a choice, Escape (focus back on the trigger) or a press outside closes it. The open one is kept
  // in `ui.menu`, so a live repaint does not shut it.
  function menu(key, trigger, items) {
    const on = ui.menu === key;
    const list = h('div', { class: 'hd-menu req-menu-list', role: 'menu', hidden: !on }, ...items);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', on ? 'true' : 'false');
    trigger.addEventListener('click', () => setMenu(ui.menu === key ? null : key));
    list.addEventListener('click', (e) => { if (e.target.closest('[role="menuitem"]')) setMenu(null); }, true);
    const wrap = h('div', { class: 'hd-more-wrap req-menu', 'data-menu': key }, trigger, list);
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || ui.menu !== key) return;
      e.preventDefault(); e.stopPropagation();
      setMenu(null);
      trigger.focus();
    });
    return wrap;
  }
  function setMenu(key) {
    ui.menu = key;
    for (const w of host.querySelectorAll('[data-menu]')) {
      const on = w.getAttribute('data-menu') === key;
      w.querySelector('[role="menu"]').hidden = !on;
      w.querySelector('[aria-haspopup]').setAttribute('aria-expanded', on ? 'true' : 'false');
    }
  }
  // Each item has a data-ui, so a live repaint keeps the focus on it inside the open menu.
  const menuItem = (label, onclick, { disabled = false, ui: key = null } = {}) => h('button', { type: 'button', role: 'menuitem', class: 'req-menu-item', 'data-ui': key, disabled, onclick }, label);

  function header(f) {
    const save = () => act(async () => {
      try {
        const r = await api('POST', `/api/requirements/${f.seq}/save`, {});
        say(`Saved to ${r.path} (not committed).`, 'ok');
      } catch (err) {
        if (err.data?.error !== 'exists') throw err;
        if (!window.confirm(`${err.data.path} already exists. Replace it?`)) return;
        const r = await api('POST', `/api/requirements/${f.seq}/save`, { overwrite: true });
        say(`Saved to ${r.path} (not committed).`, 'ok');
      }
    });
    const copy = () => act(async () => {
      const res = await fetch(`/api/requirements/${f.seq}/markdown`);
      if (!res.ok) throw new Error(`Could not copy the Markdown (HTTP ${res.status}).`);
      await navigator.clipboard.writeText(await res.text());
      say('Copied as Markdown.', 'ok');
    });
    const archived = f.status === 'archived';
    const rounds = Number(f.rounds) || 0;
    const done = f.status === 'done' || !!f.readiness?.checks?.find((c) => c.key === 'interview')?.ok;
    return h('div', { class: 'req-head', 'data-req-feature': f.seq },
      h('div', { class: 'req-head-main' },
        h('div', { class: 'req-head-title' }, h('code', { class: 'req-id', text: f.id }), h('h2', { text: f.title }), stateMark(f)),
        h('div', { class: 'req-chips' },
          h('span', { class: 'chip', text: targetLabel(f) }),
          h('span', { class: 'chip', text: done ? `Interview done · ${plural(rounds, 'round')}` : `Round ${Math.min(rounds || 1, MAX_ROUNDS)} of ${MAX_ROUNDS}` }),
          h('span', { class: 'chip', text: `${usd(f.costUsd)} so far` }),
          f.savedPath ? h('span', { class: 'chip', text: `Saved as ${f.savedPath}` }) : null)),
      h('div', { class: 'req-head-tools' },
        menu('export', h('button', { type: 'button', class: 'btn btn-mini', 'data-ui': 'menu-export' }, 'Export ▾'), [
          f.scopeType === 'project' ? menuItem('Save to specs/', save, { ui: 'mi-save' }) : null,
          menuItem('Copy Markdown', copy, { ui: 'mi-copy' }),
          h('a', { role: 'menuitem', class: 'req-menu-item', 'data-ui': 'mi-download', href: `/api/requirements/${f.seq}/markdown?download=1`, download: '' }, 'Download .md'),
        ]),
        menu('more', h('button', { type: 'button', class: 'req-ico', 'aria-label': 'More actions', title: 'More actions', 'data-ui': 'menu-more' },
          icon(ICONS.dots, { size: 18, fill: 'currentColor', stroke: 'none' })), [
          menuItem(f.scopeType === 'workspace' ? 'Workspace context' : 'Project context', () => {
            ui.ctx.open = true; ui.ctx.failed = false; focusNext = 'ctx-body'; redraw();
            host.querySelector('.req-context')?.scrollIntoView?.({ block: 'nearest' });
          }, { ui: 'mi-context' }),
          menuItem('Look again', () => act(async () => { await api('POST', `/api/requirements/${f.seq}/look`, {}); await paint(); }), { disabled: isLocked(f), ui: 'mi-look' }),
          menuItem(archived ? 'Restore' : 'Archive', () => act(async () => {
            await api('POST', `/api/requirements/${f.seq}/archive`, archived ? { restore: true } : {});
            await paint();
          }), { disabled: !!f.busy, ui: 'mi-archive' }),
        ])));
  }

  // A repaint from the feature on screen, without a fetch (a fold, an editor opened, Change, Cancel).
  function redraw() { if (current) paintFeature(current.f, current.turns); }

  function paintFeature(f, turns = []) {
    current = { f, turns };
    const focus = capture(f);
    const rounds = roundsOf(turns);
    paintHost(h('div', { class: 'req-page' },
      h('a', { href: '#requirements', class: 'hint req-back', onclick: (e) => { e.preventDefault(); route(''); } }, '← All features'),
      header(f),
      contextPanel(f),
      h('div', { class: 'req-cols' },
        conversation(f, turns, rounds),
        h('div', { class: 'req-right' }, readyPanel(f), specCard(f)))));
    if (ui.editVals && ui.editVals.key !== editing) ui.editVals = null;
    const want = focusNext || focus;
    focusNext = null;
    if (want) {
      const el = host.querySelector(`[data-ui="${want}"]`);
      if (el && !el.disabled) el.focus();
    }
    // A focus kept for later (a revision sent: that round's Change): taken once the control is back and the
    // focus is still nowhere; dropped as soon as the focus is somewhere else.
    if (focusLater) {
      const a = document.activeElement;
      const lost = !a || a === document.body || !a.isConnected;
      const el = host.querySelector(`[data-ui="${focusLater}"]`);
      if (!lost) focusLater = null;
      else if (el && !el.disabled) { el.focus(); focusLater = null; }
    }
  }

  const onDocClick = (e) => {
    if (!ui.menu) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('[data-menu]') && host.contains(t)) return;
    setMenu(null);
  };
  document.addEventListener('click', onDocClick, true);

  return { show, changed, destroy: () => { paintNo += 1; closeDialog(false); document.removeEventListener('click', onDocClick, true); host.replaceChildren(); } };
}
