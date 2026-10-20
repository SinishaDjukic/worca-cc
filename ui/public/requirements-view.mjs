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
// The interview status the feature page's head still shows (f.status).
const STATUS = Object.freeze({
  looking: { label: 'Looking at the code', cls: 'running' },
  thinking: { label: 'Thinking', cls: 'running' },
  your_turn: { label: 'Your turn', cls: 'amber' },
  done: { label: 'Interview done', cls: 'green' },
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
const statusBadge = (status) => h('span', { class: `badge ${STATUS[status]?.cls || ''}`.trim(), text: STATUS[status]?.label || status });
const runColour = (status) => (RUN_LIVE.includes(status) ? 'peach' : status === 'done' ? 'green'
  : status === 'error' || status === 'stopped' ? 'red' : '');
/** The latest run as a pill: peach while it runs (its phase as the text), green done, red error / stopped. */
function runPill(run) {
  const status = run && run.status;
  const text = (RUN_LIVE.includes(status) && run.phase ? sentence(run.phase) : sentence(status)) || 'Started';
  return h('span', { class: `pill-run req-run ${runColour(status)}`.trim() }, h('span', { class: 'pdot' }), text);
}
const stateMark = (f) => (f.state === 'started' ? runPill(f.latestRun) : badge(f.state));
/** The line under a row's title, by state; `need` when it asks something of the person. */
function rowMeta(f) {
  const run = f.latestRun;
  switch (f.state) {
    case 'your_turn': {
      const k = Number.isInteger(f.pendingCount) && f.pendingCount > 0 ? `${plural(f.pendingCount, 'question')} for you` : 'Your turn';
      return { text: `Round ${Math.min(Number(f.rounds) || 1, MAX_ROUNDS)} of ${MAX_ROUNDS} · ${k}`, need: true };
    }
    case 'decide': return { text: `Interview done · Ready ${Number(f.ready) || 0} of ${READY_CHECKS}`, need: true };
    case 'ready': return { text: `Ready ${READY_CHECKS} of ${READY_CHECKS}` };
    case 'started': return { text: `Started${run && run.status ? ` · run ${run.status}${run.phase ? ` · ${sentence(run.phase)}` : ''}` : ''}` };
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
  let editing = null;        // the section open in its editor
  let targets = { projects: [], workspaces: [] };
  let filter = 'open';      // the list's filter tab (FILTERS), kept across repaints and visits
  let paintedKey = null;     // what the host currently shows: 'list' | 'new' | 'feature/<n>'
  // Unsaved input of the feature page, kept across repaints (read from the DOM before a rebuild, put back after).
  let ui = freshUi();
  let ctxEls = null;
  function freshUi() { return { editVals: null, crit: '', orientOpen: false, roundsOpen: [], ctx: { open: false, loaded: false, loading: false, body: '', look: false } }; }

  if (subEl) subEl.textContent = 'Define a feature with Worca before anything is built. Nothing runs until you start it.';
  const say = (text, kind = '') => { if (msgEl) { msgEl.textContent = text || ''; msgEl.className = `form-msg${kind ? ` ${kind}` : ''}`; } };
  const fail = (err) => say(err && err.status === 404
    ? 'Requirements are turned off, or this feature no longer exists.'
    : (err && err.message) || String(err), 'err');
  const act = async (fn) => { say(''); try { await fn(); } catch (err) { fail(err); } };

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
    if (next !== seqShown) { draft = null; editing = null; ui = freshUi(); }
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
    const ctx = host.querySelector('.req-context');
    if (ctx) {
      ui.ctx.open = ctx.open;
      if (ui.ctx.loaded) { ui.ctx.body = q('ctx-body').value; ui.ctx.look = q('ctx-look').checked; }
    }
    const orient = host.querySelector('.req-orient');
    if (orient) ui.orientOpen = orient.open;
    ui.roundsOpen = [...host.querySelectorAll('details.req-round')].filter((d) => d.open).map((d) => Number(d.getAttribute('data-round')));
    return focus;
  }

  // Every list / new-feature paint goes through here: a null or false child never reaches the DOM
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
        ? h('p', { class: 'hint req-spend', text: `Spent on requirements this month: ${usd(spend.windowUsd)}${
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

  function questionCard(f, pending) {
    if (!draft || draft.roundTurnId !== pending.turnId) {
      draft = { roundTurnId: pending.turnId, picks: {}, texts: {} };
      for (const q of pending.questions) if (q.recommended) draft.picks[q.id] = q.recommended;
    }
    const count = h('span', { class: 'qanswered' });
    const recount = () => {
      const n = pending.questions.filter((q) => draft.picks[q.id] || draft.texts[q.id]).length;
      count.textContent = `${n} of ${pending.questions.length} answered`;
    };
    const answers = () => pending.questions.map((q) => (draft.texts[q.id] ? { id: q.id, text: draft.texts[q.id] }
      : draft.picks[q.id] ? { id: q.id, option: draft.picks[q.id] } : null)).filter(Boolean);
    const post = (extra) => act(async () => {
      await api('POST', `/api/requirements/${f.seq}/answers`, { roundTurnId: pending.turnId, ...extra, answers: answers() });
      draft = null;
      await paint();
    });
    const panel = h('div', { class: 'qpanel req-q' },
      h('div', { class: 'qpanel-head' }, h('b', { text: 'Your turn' }),
        h('span', { class: 'qcount', text: `${pending.questions.length} question${pending.questions.length === 1 ? '' : 's'}` })),
      pending.note ? h('p', { class: 'hint', text: pending.note }) : null,
      ...pending.questions.map((q, i) => {
        const buttons = q.options.map((o, k) => h('button', { type: 'button', class: 'qopt', 'data-key': KEYS[k], 'aria-pressed': draft.picks[q.id] === o && !draft.texts[q.id] ? 'true' : 'false' },
          h('span', { class: 'qopt-txt', text: o }), o === q.recommended ? h('span', { class: 'qrec', text: 'Recommended' }) : null));
        const free = h('input', { class: 'qfree', type: 'text', value: draft.texts[q.id] || '', placeholder: 'Or type your own answer…', 'aria-label': `Your own answer to: ${q.question}` });
        const sync = () => {
          buttons.forEach((b, k) => { const on = !draft.texts[q.id] && draft.picks[q.id] === q.options[k]; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('sel', on); });
          free.classList.toggle('has', !!draft.texts[q.id]);
          recount();
        };
        buttons.forEach((b, k) => b.addEventListener('click', () => { draft.picks[q.id] = q.options[k]; delete draft.texts[q.id]; free.value = ''; sync(); }));
        free.addEventListener('input', () => { const v = free.value.trim(); if (v) { draft.texts[q.id] = v; delete draft.picks[q.id]; } else delete draft.texts[q.id]; sync(); });
        queueMicrotask(sync);
        return h('div', { class: 'qblock' },
          h('div', { class: 'qtext' }, h('span', { class: 'qn', text: String(i + 1) }), q.question),
          q.why ? h('div', { class: 'hint req-why', text: q.why }) : null,
          h('div', { class: 'qopts' }, ...buttons), free);
      }),
      h('div', { class: 'qpanel-foot' }, count,
        h('button', { type: 'button', class: 'btn req-finish', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/finish`, {}); await paint(); }) }, 'Finish now'),
        h('button', { type: 'button', class: 'btn req-skip', onclick: () => post({ useRecommended: true }) }, 'Skip, use recommended'),
        h('button', { type: 'button', class: 'btn-go', onclick: () => post({}) }, 'Submit')));
    recount();
    return panel;
  }

  // Earlier rounds, read-only and folded: each round's questions with the latest answers given, and its note.
  // The round waiting for answers is the question card instead.
  function earlierRounds(f, turns) {
    const latest = new Map();
    for (const t of turns) if (t.kind === 'answers') latest.set(t.payload.roundTurnId, t.payload.answers || []);
    const out = [];
    let n = 0;
    for (const t of turns) {
      if (t.kind !== 'round') continue;
      n += 1;
      if (f.pending && t.id === f.pending.turnId) continue;
      const qs = t.payload.questions || [];
      const given = new Map((latest.get(t.id) || []).map((a) => [a.id, a]));
      out.push(h('details', { class: 'req-round', 'data-round': t.id, open: ui.roundsOpen.includes(t.id) },
        h('summary', { text: qs.length ? `Round ${n} · ${qs.length} question${qs.length === 1 ? '' : 's'}` : `Round ${n} · no more questions` }),
        t.payload.note ? h('p', { class: 'hint req-round-note', text: t.payload.note }) : null,
        ...qs.map((q) => {
          const a = given.get(q.id);
          return h('div', { class: 'req-round-q' },
            h('div', { class: 'qtext', text: q.question }),
            h('div', { class: 'req-round-answer', text: a ? `Your answer: ${a.answer}${a.recommended ? ' (recommended)' : ''}` : 'Not answered' }));
        })));
    }
    return out;
  }

  function conversation(f, turns) {
    const working = isWorking(f);
    const open = !isLocked(f);
    return h('div', { class: 'req-left' },
      ...earlierRounds(f, turns),
      working ? h('p', { class: 'hint', text: f.status === 'looking' ? 'Worca is looking at the code…' : 'Worca is thinking…' }) : null,
      f.status === 'archived' ? h('p', { class: 'hint', text: 'This feature is archived. Restore it to continue.' }) : null,
      open && f.lastError ? h('div', { class: 'req-error form-msg err' }, f.lastError, ' ',
        h('button', { type: 'button', class: 'btn btn-mini req-retry', onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/retry`, {}); await paint(); }) }, 'Try again')) : null,
      open && f.pending ? questionCard(f, f.pending) : null,
      open && f.status === 'done' ? h('p', { class: 'hint', text: 'The interview is done. Edit the spec on the right; every change is kept.' }) : null);
  }

  function sectionBlock(f, key, title) {
    const s = f.spec;
    const edited = !!s.edited?.[key];
    const working = isLocked(f);
    let body;
    if (editing === key) {
      const isGoal = key === 'goal';
      const a = isGoal ? h('input', { type: 'text', value: s.goal.text, 'aria-label': 'Goal', 'data-ui': 'edit-a' }) : h('textarea', { rows: '5', 'aria-label': title, 'data-ui': 'edit-a' }, (s[key] || []).join('\n'));
      const b = isGoal ? h('input', { type: 'text', value: s.goal.measure, placeholder: 'Success measure', 'aria-label': 'Success measure', 'data-ui': 'edit-b' }) : null;
      if (ui.editVals && ui.editVals.key === key) { a.value = ui.editVals.a; if (b) b.value = ui.editVals.b; }
      body = h('div', { class: 'req-edit' }, a, b,
        h('div', { class: 'req-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => { editing = null; ui.editVals = null; void paint(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn-go', onclick: () => act(async () => {
            await api('PUT', `/api/requirements/${f.seq}/spec/${key}`, { value: isGoal ? { text: a.value, measure: b.value } : a.value });
            editing = null; ui.editVals = null; await paint();
          }) }, 'Save')));
    } else if (key === 'goal') {
      body = s.goal.text ? h('div', {}, h('p', { text: s.goal.text }), s.goal.measure ? h('p', { class: 'hint', text: `Success measure: ${s.goal.measure}` }) : null) : h('p', { class: 'hint', text: 'Not yet.' });
    } else {
      const list = s[key] || [];
      body = list.length ? h(key === 'flow' ? 'ol' : 'ul', {}, ...list.map((t) => h('li', { text: t }))) : h('p', { class: 'hint', text: 'Not yet.' });
    }
    return h('section', { class: 'req-sect', 'data-section': key },
      h('div', { class: 'req-sect-head' }, h('h3', { text: title }),
        edited ? h('span', { class: 'req-edited', text: 'edited by you' }) : null,
        h('button', { type: 'button', class: 'btn-ghost btn-mini req-sect-edit', disabled: working, 'aria-label': `Edit ${title}`, onclick: () => { editing = key; void paint(); } }, 'Edit'),
        edited ? h('button', { type: 'button', class: 'btn-ghost btn-mini req-sect-edit', disabled: working, 'aria-label': `Let Worca rewrite ${title}`,
          onclick: () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/spec/${key}/edited`); await paint(); }) }, 'Let Worca rewrite this') : null),
      body);
  }

  function criteriaBlock(f) {
    const working = isLocked(f);
    const input = h('input', { type: 'text', placeholder: 'Add a criterion: what a tester can check', 'aria-label': 'New acceptance criterion', 'data-ui': 'new-criterion' });
    input.value = ui.crit;
    return h('section', { class: 'req-sect', 'data-section': 'criteria' },
      h('div', { class: 'req-sect-head' }, h('h3', { text: 'Acceptance criteria' })),
      ...f.spec.criteria.map((c) => h('div', { class: 'req-item', 'data-criterion': c.id },
        h('code', { text: c.id }), h('span', { class: 'req-item-text', text: c.text }),
        h('button', { type: 'button', class: 'btn-ghost btn-mini req-sect-edit', disabled: working, 'aria-label': `Remove ${c.id}`,
          onclick: () => act(async () => { await api('DELETE', `/api/requirements/${f.seq}/criteria/${c.id}`); await paint(); }) }, 'Remove'))),
      h('div', { class: 'req-item' }, input,
        h('button', { type: 'button', class: 'btn btn-mini req-sect-edit', disabled: working,
          onclick: () => act(async () => {
            await api('POST', `/api/requirements/${f.seq}/criteria`, { text: input.value });
            input.value = ''; ui.crit = '';
            await paint();
          }) }, 'Add')));
  }

  function assumptionsBlock(f) {
    const working = isLocked(f);
    const set = (a, status) => act(async () => { await api('POST', `/api/requirements/${f.seq}/assumptions/${a.id}`, { status }); await paint(); });
    return h('section', { class: 'req-sect', 'data-section': 'assumptions' },
      h('div', { class: 'req-sect-head' }, h('h3', { text: 'Assumptions' })),
      f.spec.assumptions.length ? null : h('p', { class: 'hint', text: 'None yet.' }),
      ...f.spec.assumptions.map((a) => h('div', { class: 'req-item', 'data-assumption': a.id },
        h('code', { text: a.id }), h('span', { class: 'req-item-text', text: a.text }),
        h('span', { class: `badge ${a.status === 'confirmed' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}`, text: a.status }),
        h('button', { type: 'button', class: 'btn btn-mini req-confirm req-sect-edit', disabled: working, 'aria-label': `Confirm ${a.id}`, 'data-ui': `confirm-${a.id}`, 'aria-pressed': a.status === 'confirmed' ? 'true' : 'false',
          onclick: () => set(a, a.status === 'confirmed' ? 'open' : 'confirmed') }, 'Confirm'),
        h('button', { type: 'button', class: 'btn btn-mini req-reject req-sect-edit', disabled: working, 'aria-label': `Reject ${a.id}`, 'data-ui': `reject-${a.id}`, 'aria-pressed': a.status === 'rejected' ? 'true' : 'false',
          onclick: () => set(a, a.status === 'rejected' ? 'open' : 'rejected') }, 'Reject'))));
  }

  function contextPanel(f) {
    const area = h('textarea', { rows: '4', 'aria-label': 'Shared context', 'data-ui': 'ctx-body', placeholder: 'Actors, terms and standing rules every feature here should know' });
    const look = h('input', { type: 'checkbox', id: 'req-ctx-look', 'data-ui': 'ctx-look' });
    const saveBtn = h('button', { type: 'button', class: 'btn', disabled: !ui.ctx.loaded, onclick: () => act(async () => {
        await api('PUT', `/api/requirements/context/${f.scopeType}/${encodeURIComponent(f.scopeKey)}`, { body: area.value, lookAtCode: look.checked });
        say('Context saved.', 'ok');
      }) }, 'Save context');
    ctxEls = { area, look, saveBtn };
    if (ui.ctx.loaded) { area.value = ui.ctx.body; look.checked = ui.ctx.look; }
    const panel = h('details', { class: 'req-context' },
      h('summary', { text: f.scopeType === 'workspace' ? 'Workspace context' : 'Project context' }),
      area, h('label', { for: 'req-ctx-look' }, look, ' Let Worca look at the code when a feature starts'),
      h('div', { class: 'req-actions' }, saveBtn));
    panel.addEventListener('toggle', () => {
      if (!panel.open || ui.ctx.loaded || ui.ctx.loading) return;
      ui.ctx.loading = true;
      void act(async () => {
        try {
          const c = await api('GET', `/api/requirements/context/${f.scopeType}/${encodeURIComponent(f.scopeKey)}`);
          ui.ctx.body = c.body; ui.ctx.look = !!c.lookAtCode; ui.ctx.loaded = true;
          // the page may have been rebuilt while loading: write into the panel that is on screen now
          if (ctxEls) { ctxEls.saveBtn.disabled = false; ctxEls.area.value = c.body; ctxEls.look.checked = !!c.lookAtCode; }
        } finally { ui.ctx.loading = false; }
      });
    });
    if (ui.ctx.open) panel.open = true;
    return panel;
  }

  function orientationBox(f) {
    const o = f.orientation;
    const text = !o ? 'Not looked yet.'
      : o.skipped === 'off' ? 'Looking at the code is turned off for this one (Project context).'
        : o.skipped === 'no-repo' ? 'There is no repository to look at yet.'
          : o.skipped === 'failed' ? 'Worca could not look at the code this time; the interview runs without it.'
            : o.summary || 'Nothing relevant found.';
    return h('details', { class: 'req-orient', open: ui.orientOpen }, // `open: false` is skipped by h()
      h('summary', { text: 'What Worca found in the code' }),
      h('p', { text }),
      o && o.files && o.files.length ? h('ul', { class: 'hint', 'data-min-level': 'advanced' }, ...o.files.map((p) => h('li', { text: p }))) : null,
      h('button', { type: 'button', class: 'btn btn-mini req-sect-edit', disabled: isLocked(f),
        onclick: () => act(async () => { await api('POST', `/api/requirements/${f.seq}/look`, {}); await paint(); }) }, 'Look again'));
  }

  function paintFeature(f, turns = []) {
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
    const focus = capture(f);
    host.replaceChildren(
      h('div', { class: 'req-head', 'data-req-feature': f.seq }, h('h2', { text: `${f.id} · ${f.title}` }), statusBadge(f.status)),
      h('div', { class: 'req-meta' },
        h('span', { text: targetLabel(f) }),
        h('span', { text: `Round ${Math.min(f.rounds, MAX_ROUNDS)} of ${MAX_ROUNDS}` }),
        h('span', { text: `Cost so far ${usd(f.costUsd)}` }),
        f.savedPath ? h('span', { text: `Saved as ${f.savedPath}` }) : null),
      h('div', { class: 'req-actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => route('') }, 'All features'),
        f.scopeType === 'project' ? h('button', { type: 'button', class: 'btn', onclick: save }, 'Save to specs/') : null,
        h('button', { type: 'button', class: 'btn', onclick: copy }, 'Copy Markdown'),
        h('a', { class: 'btn', href: `/api/requirements/${f.seq}/markdown?download=1`, download: '' }, 'Download .md'),
        h('button', { type: 'button', class: 'btn', disabled: f.busy, onclick: () => act(async () => {
          await api('POST', `/api/requirements/${f.seq}/archive`, f.status === 'archived' ? { restore: true } : {});
          await paint();
        }) }, f.status === 'archived' ? 'Restore' : 'Archive')),
      orientationBox(f),
      contextPanel(f),
      h('div', { class: 'req-cols' },
        conversation(f, turns),
        h('div', { class: 'req-right' },
          ...SECTIONS.slice(0, 6).map(([k, t]) => sectionBlock(f, k, t)),
          criteriaBlock(f), assumptionsBlock(f),
          sectionBlock(f, ...SECTIONS[6]))),
    );
    if (ui.editVals && ui.editVals.key !== editing) ui.editVals = null;
    if (focus) {
      const el = host.querySelector(`[data-ui="${focus}"]`);
      if (el && !el.disabled) el.focus();
    }
  }

  return { show, changed, destroy: () => { paintNo += 1; host.replaceChildren(); } };
}
