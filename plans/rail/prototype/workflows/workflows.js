// Workflows on Rail (Wave 3, second pass; mock plans/rail/mocks/wave-3/workflows-2): explored as the Marketplace is. The
// bar holds ways in with counts (yours: workflows, agents, scripts; for you, your team's, the Marketplace's); Build it by
// hand is its quiet last line, in Expert. A way opens as cards (cost, time, merged; Use it; Change it in a chat). A
// workflow's page tells it as a WorkflowStory (Simple's drawing); Advanced and Expert show dev's real graph under it, one
// pick from the story, and change a step's model and effort in place; Expert edits it by hand on dev's canvas (Rail's
// skin, the bar becomes its Library, Auto-align is dev's auto-layout). Everything else is made and changed in a chat.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const mode = () => R.prefs?.mode?.() || 'simple', atLeast = (m) => R.MODES.indexOf(mode()) >= R.MODES.indexOf(m);
  const MODELS = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Codex high', 'Gemini Pro'], EFFORTS = ['low', 'medium', 'high'];
  // what each kind of step does to your task, in plain words (the story's words; a small model writes them in the product)
  const SAYS = { planner: 'Thinks before touching anything: reads your task and the code, writes the plan.', implementer: 'Makes the change and runs your tests until they pass.', reviewer: 'Reads it the way a colleague would, against the plan.', security: 'Looks for trouble: injection, secrets, unsafe input.', clarify: 'Asks you what is unclear before anything is planned.', 'run-tests': 'Runs your test suite; a failure sends it back.', 'diff-gate': 'Stops a change that touches too many files.' };
  // [name, ref, model, effort, minutes, $ a task]
  const data = {
    workflow: [
      { id: 'default', title: 'Default', own: false, domain: 'coding', what: 'Plan, build, review: what every task runs unless you pick another.', tasks: 41, merged: 92, from: 'Made with Worca', pinned: true, steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.30], ['Build', 'implementer', 'Sonnet 5.5', 'high', 11, 0.22], ['Review', 'reviewer', 'Opus 5.5', 'medium', 4, 0.10]], loops: [['Review', 'Build', 3]] },
      { id: 'security-first', title: 'Security-first review', own: true, domain: 'coding', what: 'A security pass before each PR; it sends the build back up to twice.', tasks: 6, merged: 100, from: 'From the chat Release checklist', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.40], ['Build', 'implementer', 'Sonnet 5.5', 'high', 9, 0.31], ['Security check', 'security', 'Opus 5.5', 'high', 4, 0.19], ['Review', 'reviewer', 'Opus 5.5', 'medium', 2, 0.12]], loops: [['Security check', 'Build', 2]] },
      { id: 'quick-fix', title: 'Quick Fix', own: false, domain: 'coding', what: 'Skips the plan; builds and runs the tests.', tasks: 9, merged: 89, from: 'Made with Worca', steps: [['Build', 'implementer', 'Sonnet 5.5', 'medium', 5, 0.18], ['Run tests', 'run-tests', '', '', 2, 0.01]], loops: [['Run tests', 'Build', 2]] },
      { id: 'full', title: 'Full', own: false, domain: 'coding', what: 'Asks first, plans, builds, reviews and runs the tests.', tasks: 3, merged: 100, from: 'Made with Worca', steps: [['Clarify', 'clarify', 'Opus 5.5', 'high', 2, 0.12], ['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.30], ['Build', 'implementer', 'Sonnet 5.5', 'high', 11, 0.24], ['Review', 'reviewer', 'Opus 5.5', 'high', 4, 0.14], ['Run tests', 'run-tests', '', '', 2, 0.01]], loops: [['Review', 'Build', 3]] },
      { id: 'api-rewrite', title: 'API rewrite', own: true, domain: 'coding', what: 'Plans the contract, builds it behind a diff gate, reviews it.', tasks: 1, merged: 0, running: true, from: 'From the chat Plan the API rewrite', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 6, 0.90], ['Build', 'implementer', 'Opus 5.5', 'high', 24, 2.80], ['Diff gate', 'diff-gate', '', '', 1, 0.01], ['Review', 'reviewer', 'Opus 5.5', 'high', 6, 0.40]], loops: [['Review', 'Build', 2]] },
    ],
    agent: [
      { id: 'planner', title: 'Plan', own: false, domain: 'coding', type: 'producer', ins: 'the task, your answers', outs: 'the plan', model: 'Opus 5.5', effort: 'high', asks: true, fan: true },
      { id: 'implementer', title: 'Build', own: false, domain: 'coding', type: 'producer', ins: 'the plan, a fix to make', outs: 'the change', model: 'Sonnet 5.5', effort: 'high', asks: false, fan: true },
      { id: 'reviewer', title: 'Review', own: false, domain: 'coding', type: 'verifier', ins: 'the change', outs: 'a review when it blocks, a pass when clean', model: 'Opus 5.5', effort: 'medium', asks: false, fan: false },
      { id: 'clarify', title: 'Clarify', own: false, domain: 'coding', type: 'clarifier', ins: 'the task', outs: 'your answers', model: 'Opus 5.5', effort: 'high', asks: true, fan: false },
      { id: 'security', title: 'Security check', own: true, domain: 'coding', type: 'verifier', ins: 'the change', outs: 'findings when it blocks', model: 'Opus 5.5', effort: 'high', asks: false, fan: false },
    ],
    script: [
      { id: 'diff-gate', title: 'Diff gate', own: false, domain: 'coding', runtime: 'Node.js', what: 'Blocks the review when the diff touches more files than allowed', param: ['Most files', '40'], timeout: '600 s', cases: 2 },
      { id: 'todo-gate', title: 'TODO gate', own: false, domain: 'coding', runtime: 'Python', what: 'Blocks when the change adds more TODOs than allowed', param: ['Most TODOs', '5'], timeout: '600 s', cases: 1 },
      { id: 'run-tests', title: 'Run tests', own: true, domain: 'coding', runtime: 'Shell', what: 'Runs the test suite: exit 0 passes, exit 1 blocks', param: ['Command', 'npm test'], timeout: '900 s', cases: 3 },
    ],
  };
  const TEAM = 5, MARKET = 24;
  const kindOfWay = { workflows: 'workflow', agents: 'agent', scripts: 'script' };
  let current = '', menu = '', confirm = null, ctl = null, bar = null, page = null, sort = 'most used', show = 'the graph';
  let ed = null, edMore = false;   // the canvas: { id, wf (a working copy), g, picked, more, saved, past:[], next:[] }
  const find = (k) => { const [kind, id] = k.split(':'); return { kind, x: data[kind === 'edit' ? 'workflow' : kind]?.find((y) => y.id === id) }; };
  const titleOf = (id) => data.agent.find((a) => a.id === id)?.title || data.script.find((s) => s.id === id)?.title || id;
  const usedIn = (id) => data.workflow.filter((w) => w.steps.some((s) => s[1] === id)).map((w) => w.title);
  const money = (n) => `$${n.toFixed(2)}`;
  const costOf = (w) => w.steps.reduce((a, s) => a + (s[5] || 0), 0), minOf = (w) => w.steps.reduce((a, s) => a + (s[4] || 0), 0);
  const factsOf = (w) => (w.running ? `Its first task is running · ${money(4.8)} so far` : `${money(costOf(w))} a task · ${minOf(w)} min · ${w.merged}% merged`);
  const shape = (w) => `${w.steps.length} steps · used by ${w.tasks} ${w.tasks === 1 ? 'task' : 'tasks'}`;
  const markOf = (kind, size) => R.kindMark({ kind, size });
  // drafts (rail.drafts): a change by hand goes into the thing's draft; tasks keep running the saved one until you save
  const blank = (kind, x) => (kind === 'workflow' ? { steps: structuredClone(x.steps), loops: structuredClone(x.loops), changes: 0 } : { model: x.model, effort: x.effort, asks: x.asks, fan: x.fan, changes: 0 });
  const touch = (kind, x, fn) => { x.draft ||= blank(kind, x); fn(x.draft); x.draft.changes += 1; };
  const shown = (x) => (x.draft ? { ...x, ...x.draft } : x);   // what you see and edit is the draft
  const saveDraft = (x) => { const { changes, ...rest } = x.draft; Object.assign(x, structuredClone(rest)); delete x.draft; delete x.fresh; };
  const allDrafts = () => Object.entries(data).flatMap(([k, l]) => l.filter((x) => x.draft).map((x) => [k, x]));
  const barOfDraft = (x) => (x.draft ? R.draftBar({ changes: x.draft.changes, fresh: !!x.fresh, hooks: { save: { 'data-draft-save': '' }, discard: { 'data-draft-discard': '' } } }) : '');

  // ---- the story: a WorkflowStory from the workflow and its tasks ----
  let waysOpen = false;
  function storyOf(w) {
    const loop = w.loops[0], from = loop ? w.steps.findIndex((s) => s[0] === loop[0]) : -1, to = loop ? w.steps.findIndex((s) => s[0] === loop[1]) : -1;
    const round = from >= 0 ? (w.steps[from][5] || 0) + (w.steps[to][5] || 0) : 0, roundMin = from >= 0 ? (w.steps[from][4] || 0) + (w.steps[to][4] || 0) : 0;
    const half = Math.ceil(w.tasks / 2);
    const ways = [{ title: 'Straight through', meta: `${w.steps.map((s) => s[0]).join(', ')} · about ${minOf(w)} min, ${money(costOf(w))} · ${w.tasks - (loop ? half : 0)} of ${w.tasks} tasks`, tone: 'ok', stage: 4 },
      ...(loop ? [{ title: `${loop[0]} finds something`, meta: `Back to ${loop[1]} once or twice · each round about ${roundMin} min, ${money(round)} · ${half} of ${w.tasks} tasks`, tone: 'act', stage: 2 },
        { title: `Still not right after ${loop[2]} ${+loop[2] === 1 ? 'round' : 'rounds'}`, meta: 'It stops and asks you what to do · never yet', tone: 'ask', stage: 2 }] : [])];
    return R.workflowStory({ steps: w.steps.map(([name, ref, , , min, cost], i) => ({ name, says: SAYS[ref] || `${titleOf(ref)}.`, meta: `about ${min} min · ${money(cost || 0)}`, check: i === from })),
      loop: loop ? { from, to, text: `found something? back to ${loop[1]}, at most ${+loop[2] === 1 ? 'once' : +loop[2] === 2 ? 'twice' : `${loop[2]} times`}` } : null, ways: !atLeast('advanced') || waysOpen ? ways : [], byline: atLeast('advanced') ? `Told by Haiku 5.5 from this workflow and its last ${w.tasks} ${w.tasks === 1 ? 'task' : 'tasks'}` : '' })
      + (atLeast('advanced') ? `<div class="wf-acts open-line">${R.button({ label: waysOpen ? 'Fold how a task goes through it' : `How a task goes through it · ${ways.length} ${ways.length === 1 ? 'way' : 'ways'}`, kind: 'quiet', icon: R.icon(waysOpen ? 'chevron' : 'chevR', 12), attrs: { 'data-wf-ways': '', 'aria-expanded': String(waysOpen), 'data-folds': '.ws .list' } })}</div>` : '');
  }

  // ---- the cards of a way ----
  function cardOf(kind, x) {
    const open = { 'data-wf-open': `${kind}:${x.id}` };
    if (kind === 'workflow' && x.fresh) return R.pluginCard({ mark: R.kindMark({ kind: 'workflow', tone: 'act' }), kicker: `Draft · never saved · ${x.draft.steps.length} steps`, title: x.title, what: x.what, facts: 'Nothing can run it until you save it', action: R.button({ label: atLeast('expert') ? 'Go on editing' : 'Finish it in a chat', attrs: atLeast('expert') ? { 'data-wf-edit': x.id } : { 'data-wf-chat': `workflow:${x.id}` } }), attrs: open });
    if (kind === 'workflow') return R.pluginCard({ mark: R.kindMark({ kind: 'workflow', tone: x.running ? 'run' : x.draft ? 'act' : 'idle' }), kicker: x.draft ? `${shape(x)} · a draft waits, ${x.draft.changes} ${x.draft.changes === 1 ? 'change' : 'changes'}` : shape(x), title: x.title, what: x.what, why: x.id === 'default' ? 'Every task runs this unless you pick another' : '', facts: factsOf(x), action: R.button({ label: 'Use it', attrs: { 'data-wf-use': x.id, title: 'Starts a task in a chat with this workflow in its sentence' } }), more: R.button({ label: 'Change it in a chat', kind: 'quiet', attrs: { 'data-wf-chat': `${kind}:${x.id}` } }), attrs: open });
    const kicker = kind === 'agent' ? `${{ producer: 'Makes something', verifier: 'Checks', clarifier: 'Asks you' }[x.type]} · ${x.model}` : `A script · ${x.runtime}`;
    const what = kind === 'agent' ? `Takes ${x.ins}; gives ${x.outs}.` : `${x.what}.`;
    return R.pluginCard({ mark: markOf(kind), kicker, title: x.title, what, facts: usedIn(x.id).length ? `In ${usedIn(x.id).join(', ')}` : 'In no workflow yet', action: R.button({ label: 'Open', attrs: open }), more: R.button({ label: 'Change it in a chat', kind: 'quiet', attrs: { 'data-wf-chat': `${kind}:${x.id}` } }), attrs: open });
  }
  function wayHtml(way) {
    const kind = kindOfWay[way] || 'workflow';
    const SORT = { 'most used': (a, b) => (b.tasks || 0) - (a.tasks || 0), cheapest: (a, b) => costOf(a) - costOf(b), 'A–Z': (a, b) => a.title.localeCompare(b.title) };
    let list = data[kind].slice();
    if (way === 'drafts') { const d = allDrafts(); return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ title: 'Drafts', facts: esc(`${d.length} ${d.length === 1 ? 'draft' : 'drafts'} · changed by hand, not saved · tasks run the saved ones`) })}<div class="pg-grid">${d.map(([k, x]) => cardOf(k, x)).join('')}</div></div></div></div>`; }
    if (way === 'for-you') list = data.workflow.filter((w) => !w.own && w.tasks < 5);
    if (way === 'team') list = data.workflow.filter((w) => w.own);
    if (kind === 'workflow') list.sort(SORT[sort] || SORT['most used']);
    const T = { workflows: ['Your workflows', `${data.workflow.length} workflows · each made in a chat`], agents: ['Your agents', `${data.agent.length} agents · the steps workflows are made of`], scripts: ['Your scripts', `${data.script.length} scripts · checks a workflow runs`], 'for-you': ['For you', 'Workflows Worca thinks fit how you work'], team: ['Your team’s', `${TEAM} shared by your team · use one and it is yours too`] }[way] || ['Your workflows', ''];
    const sentence = kind === 'workflow' ? `<div class="wf-sent">Showing ${R.sentencePicker({ id: 'wf-sort', text: sort, tip: 'How they are ordered', items: Object.keys(SORT).map((v) => ({ id: v, text: v, checked: v === sort })), open: menu === 'wf-sort', chevron: R.icon('chevron', 10) })}</div>` : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ title: T[0], facts: esc(T[1]) })}${sentence}<div class="pg-grid">${list.map((x) => cardOf(kind, x)).join('')}</div></div></div></div>`;
  }

  // ---- a thing's page ----
  function pageHtml(kind, x0) {
    const x = shown(x0), draft = barOfDraft(x0);
    const pick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    const ro = !x.own;   // a built-in reads; its copy is yours to change
    const menuItems = [...(kind === 'workflow' ? [{ id: 'use', text: 'Use it', help: 'Starts a task with it' }, { id: 'pin', text: x.pinned ? 'Unpin from Chat' : 'Pin to Chat', help: 'Its starter on Chat\'s home' }, { id: 'export', text: 'Export…', help: 'As a file, a Claude Code skill or a Worca plugin' }] : []), ...(ro ? [{ id: 'copy', text: 'Use as a template', help: 'A copy of yours, to change' }] : []), ...(x.own ? [{ sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'Asks first' }] : [])];
    const more = R.moreMenu({ id: 'wf-more', label: `More for ${x.title}`, icon: R.icon('more', 16), open: menu === 'wf-more', items: menuItems });
    const strip = confirm?.x === x0 ? R.confirmStrip({ text: `Delete ${x.title}? ${kind === 'workflow' ? 'Tasks it ran keep their history; schedules that use it stop.' : `Workflows that use it: ${usedIn(x.id).join(', ') || 'none'}.`}`, yes: 'Delete', danger: true }) : '';
    const exp = menu === 'wf-export' ? `<div class="card-form">${R.confirmForm({ form: 'export', id: 'wf-export-t', text: `Export ${x.title}`, body: `<span class="tp-sentence">As ${pick('wf-as', x.as || 'a JSON file', ['a JSON file', 'a Claude Code skill', 'a Worca plugin'], 'What it becomes')}, with the agents it uses</span>` + R.confirmActions({ yes: 'Export' }) })}</div>` : '';
    const chat = R.button({ label: 'Change it in a chat', attrs: { 'data-wf-chat': `${kind}:${x.id}`, title: 'Worca proposes the change as a card; you apply it' } });
    if (kind === 'workflow') {
      const delta = costOf(x) - costOf(data.workflow[0]);
      const head = R.placeHead({ title: x.title, facts: esc(`${shape(x)} · ${x.from}`), mark: R.kindMark({ kind: 'workflow', tone: x.running ? 'run' : 'idle' }), word: x.running ? 'Running' : `${money(costOf(x))} a task`,
        why: x.running ? `${money(4.8)} so far` : `${x.id === 'default' ? 'what every task runs' : `${money(Math.abs(delta))} ${delta >= 0 ? 'more' : 'less'} than Default`} · ${x.merged}% merged`,
        action: chat + (atLeast('expert') ? R.button({ label: 'Edit by hand', kind: 'quiet', attrs: { 'data-wf-edit': x.id, title: 'The graph, on the canvas' } }) : ''), menu: more }) + draft;
      const toggle = atLeast('advanced') ? `<div class="wf-sent">Showing ${pick('wf-show', show, ['the graph', 'the story only'], 'The real graph under the story, or the story alone')}</div>` : '';
      const well = atLeast('advanced') && show === 'the graph' ? '<div class="wf-well gv-skin is-view" id="wf-graph"></div>' : '';
      const steps = atLeast('advanced') ? R.settingsSection({ title: 'What each step does', meta: ro ? 'A built-in reads as it is; Use as a template to change it.' : 'Change a step’s model and effort here, or anything in a chat.',
        rows: x.steps.map(([name, ref, model, effort, , cost], i) => R.settingsRow({ name: `${i + 1}. ${name}`, sentence: `${esc(SAYS[ref] || titleOf(ref))}<br><span class="wf-who">${model ? `An agent on ${ro ? `<b>${esc(model)}</b>, ${esc(effort)}` : `${pick(`wfm-${i}`, model, MODELS, 'Its model')} ${pick(`wfe-${i}`, effort, EFFORTS, 'How hard it thinks')}`}` : 'A script'} · ${money(cost || 0)} a task</span>` })).join('')
          + x.loops.map(([from, to, n], i) => R.settingsRow({ name: 'Loop', sentence: `${esc(from)} sends fixes back to ${esc(to)}, up to ${ro ? `<b>${n}</b>` : pick(`wfl-${i}`, String(n), ['1', '2', '3', '5'], 'How many rounds')} times` })).join('') }) : '';
      return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${exp}${storyOf(x)}${toggle}</div>${well}<div class="convo-col">${steps}<div class="wf-acts">${R.button({ label: 'Use it', attrs: { 'data-wf-use': x.id, disabled: x0.fresh ? true : null, title: x0.fresh ? 'Save it first: nothing can run a draft' : 'Starts a task in a chat with this workflow in its sentence' } })}</div></div></div><div class="convo-dock" id="wf-dock"></div></div>`;
    }
    const head = R.placeHead({ title: x.title, facts: esc(`${x.own ? 'Yours' : 'Built-in'} · ${x.domain} · ${kind === 'agent' ? x.type : x.runtime}`), mark: markOf(kind), word: x.own ? 'Yours' : 'Built-in', why: usedIn(x.id).length ? `In ${usedIn(x.id).join(', ')}` : 'In no workflow yet', action: chat, menu: more }) + draft;
    let body;
    if (kind === 'agent') {
      body = R.settingsSection({ title: 'What it does', rows: [R.settingsRow({ name: 'Does', sentence: esc(SAYS[x.id] || '') }), R.settingsRow({ name: 'Takes', sentence: esc(x.ins) }), R.settingsRow({ name: 'Gives', sentence: esc(x.outs) })].join('') })
        + R.settingsSection({ title: 'How it runs', rows: [R.settingsRow({ name: 'Model', sentence: `Runs on ${ro || !atLeast('advanced') ? `<b>${esc(x.model)}</b> ${esc(x.effort)}` : `${pick('ag-model', x.model, MODELS, 'Its model')} ${pick('ag-effort', x.effort, EFFORTS, 'How hard it thinks')}`}` }),
          R.settingsRow({ name: 'Questions', sentence: x.asks ? 'Asks you when something is unclear' : 'Never asks; it decides', end: ro ? '' : R.switchButton({ on: x.asks, label: 'Asks questions', attrs: { 'data-wf-sw': 'asks' } }) }),
          R.settingsRow({ name: 'Research', sentence: x.fan ? 'Sends helpers to read the code first' : 'Reads the code itself', end: ro ? '' : R.switchButton({ on: x.fan, label: 'Research fan-out', attrs: { 'data-wf-sw': 'fan' } }) })].join('') });
    } else {
      body = R.settingsSection({ title: 'What it does', rows: [R.settingsRow({ name: 'Does', sentence: esc(x.what) }), R.settingsRow({ name: 'Runs', sentence: `${esc(x.runtime)}, stopped after ${esc(x.timeout)}` }), R.settingsRow({ name: esc(x.param[0]), sentence: `<b>${esc(x.param[1])}</b> unless a workflow says otherwise` })].join('') })
        + R.settingsSection({ title: 'Its tests', rows: R.settingsRow({ name: 'Cases', sentence: `${x.cases} saved ${x.cases === 1 ? 'case' : 'cases'}`, end: R.button({ label: 'Run all', kind: 'quiet', attrs: { 'data-wf-run': x.id } }) }) });
    }
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${exp}${body}</div></div><div class="convo-dock" id="wf-dock"></div></div>`;
  }

  // ---- Expert: the canvas (dev's graph, Rail's skin) ----
  const snap = () => ({ wf: structuredClone(ed.wf), g: ed.g, picked: ed.picked });
  function edHtml() {
    const w = ed.wf, i = ed.picked.startsWith('n') && ed.picked !== 'n_task' && ed.picked !== 'n_end' ? +ed.picked.slice(1) : -1, st = w.steps[i];
    const pick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: R.icon('chevron', 10), right: true });
    const loop = st && w.loops.find((l) => l[0] === st[0]);
    const insp = st ? `<h2 class="wf-ed-h">${esc(st[0])}</h2><p class="wf-ed-m">Step ${i + 1} of ${w.steps.length} · ${st[2] ? 'an agent' : 'a script'}</p>${R.settingsSection({ rows: [R.settingsRow({ name: 'Does', sentence: esc(SAYS[st[1]] || titleOf(st[1])) }),
      ...(st[2] ? [R.settingsRow({ name: 'Runs on', sentence: `${pick(`ed-m-${i}`, st[2], MODELS, 'Its model')} ${pick(`ed-e-${i}`, st[3], EFFORTS, 'How hard it thinks')}` })] : []),
      ...(loop ? [R.settingsRow({ name: 'Loop', sentence: `Sends fixes back to <b>${esc(loop[1])}</b> up to ${pick(`ed-l-${i}`, String(loop[2]), ['1', '2', '3', '5'], 'How many rounds')} times, then asks you` })] : []),
      R.settingsRow({ name: 'Stops after', sentence: pick(`ed-t-${i}`, st[6] || '30 min', ['10 min', '30 min', '1 hour'], 'When it gives up') }),
      R.settingsRow({ name: 'Costs', sentence: `About ${money(st[5] || 0)} a task${loop ? `; a round back adds ${money((st[5] || 0) + (w.steps[w.steps.findIndex((s) => s[0] === loop[1])]?.[5] || 0))}` : ''}` }),
      ...(edMore ? ['<div class="ed-more">' + R.settingsRow({ name: 'Session', sentence: `${pick(`ed-s-${i}`, st[7] || 'its own session', ['its own session', 'one conversation with the step before'], 'Which session it runs in')}` }), R.settingsRow({ name: 'Sub-agents', sentence: `${pick(`ed-sa-${i}`, st[8] || 'on', ['on', 'off'], 'Whether it sends helpers')}` }) + '</div>'] : [])].join('') })}
      <div class="wf-acts open-line">${R.button({ label: edMore ? 'Fewer settings' : 'More settings', kind: 'quiet', icon: R.icon(edMore ? 'chevron' : 'chevR', 12), attrs: { 'data-ed-more': '', 'aria-expanded': String(edMore), 'data-folds': '.ed-more' } })}</div><div class="wf-acts">${R.button({ label: 'Try it on a task', kind: 'quiet', attrs: { 'data-say': `Tries ${st[0]} on your last task, in a copy` } })}${R.button({ label: 'Remove', kind: 'quiet', attrs: { 'data-ed-remove': String(i) } })}</div>`
      : `<h2 class="wf-ed-h">${ed.picked === 'n_end' ? 'End' : 'Task'}</h2><p class="wf-ed-m">${ed.picked === 'n_end' ? 'What the workflow comes to: a pull request' : 'Where your task comes in: its words and the files you add'}</p><p class="wf-ed-m">Pick a step on the canvas to change it.</p>`;
    const io = `<span class="rc-pop">${R.button({ label: 'Import, Export', kind: 'quiet', attrs: { 'data-menu': 'ed-io', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'ed-io') } })}${menu === 'ed-io' ? R.compactMenu({ items: [{ id: 'ed-io|import', text: 'Import…', help: 'A JSON file, a Claude Code skill' }, { id: 'ed-io|export', text: 'Export…', help: 'As a file, a skill or a plugin' }] }) : ''}</span>`;
    return `<div class="wf-ed"><div class="wf-ed-top">${R.button({ label: `Back to ${w.title}`, kind: 'quiet', iconOnly: true, icon: R.icon('chevL', 14), attrs: { 'data-ed-back': '' } })}<b>${esc(w.title)}</b>${data.workflow.find((y) => y.id === ed.id)?.draft ? '' : '<span>saved · tasks run this</span>'}<span class="wf-ed-sp"></span>${R.button({ label: 'Undo', kind: 'quiet', attrs: { 'data-ed-undo': '', disabled: ed.past.length ? null : true } })}${R.button({ label: 'Redo', kind: 'quiet', attrs: { 'data-ed-redo': '', disabled: ed.next.length ? null : true } })}${io}${R.button({ label: 'Ask Worca', kind: 'quiet', icon: R.icon('ask-worca', 14), attrs: { 'data-ed-ask': '' } })}${barOfDraft(data.workflow.find((y) => y.id === ed.id) || {})}</div>
      <div class="wf-ed-body"><div class="wf-canvas"><div class="gv-skin is-edit" id="wf-canvas-g"></div><div class="wf-ed-tools">${R.button({ label: 'Auto-align', kind: 'quiet', attrs: { 'data-ed-align': '', title: 'Tidies every step into place; Undo puts it back' } })}${R.button({ label: 'Zoom out', kind: 'quiet', attrs: { 'data-ed-zoom': '-1' } })}<span>${Math.round(ed.scale * 100)}%</span>${R.button({ label: 'Zoom in', kind: 'quiet', attrs: { 'data-ed-zoom': '1' } })}${R.button({ label: 'Fit', kind: 'quiet', attrs: { 'data-ed-fit': '' } })}</div></div><aside class="wf-insp">${insp}</aside></div></div>`;
  }
  function edMount() {
    const host = document.getElementById('wf-canvas-g'); if (!host) return;
    const w = Math.round((host.parentElement.clientWidth - 48) * ed.scale); const { g } = window.RailGraph.mount(host, ed.wf, { width: w, mode: 'edit', aligned: false, select: ed.picked, g: ed.g, says: (r) => SAYS[r] || '' });
    ed.g = g;
  }
  const edDraft = () => { const x = data.workflow.find((w) => w.id === ed.id); if (!x) return; if (!ed.past.length && !x.fresh) { delete x.draft; return; } x.draft = { steps: structuredClone(ed.wf.steps), loops: structuredClone(ed.wf.loops), changes: Math.max(ed.past.length, 1) }; };   // the canvas writes the thing's draft
  const edChange = (fn, words) => { ed.past.push(snap()); ed.next = []; fn(); edDraft(); draw(); if (words) say(words); };

  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'workflows';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    ctl?.paint();
    if (current.startsWith('edit:')) {
      const { x } = find(current); if (!x || !atLeast('expert')) { window.RailShell.go(x ? `workflows/workflow:${x.id}` : 'workflows'); return; }
      if (!ed || ed.id !== x.id) ed = { id: x.id, wf: structuredClone(shown(x)), g: null, picked: `n${x.loops.length ? x.steps.findIndex((s) => s[0] === x.loops[0][0]) : 0}`, saved: true, past: [], next: [], scale: 1 };
      page.innerHTML = edHtml(); edMount(); return;
    }
    const { kind, x } = current && !current.startsWith('~') ? find(current) : {};
    if (!x) { page.innerHTML = wayHtml(current.startsWith('~') ? current.slice(1) : 'workflows'); return; }
    page.innerHTML = pageHtml(kind, x);
    const gEl = document.getElementById('wf-graph'); if (gEl) window.RailGraph?.mount(gEl, shown(x), { width: gEl.clientWidth || 900, says: (r) => SAYS[r] || '' });
    window.RailConversation?.dock(document.getElementById('wf-dock'), { kind, title: x.title, chat: '' });
  }
  function act(id, kind, x) {
    if (id === 'use') { window.RailConversation?.start('task', ''); say(`${x.title} is in the task’s sentence`); return; }
    if (id === 'copy') { const c = { ...structuredClone(x), id: `${x.id}-copy`, title: `${x.title} copy`, own: true, pinned: false, from: 'A copy of yours' }; data[kind].push(c); window.RailShell.go(`workflows/${kind}:${c.id}`); say(`${c.title}: yours to change`); return; }
    if (id === 'pin') { x.pinned = !x.pinned; draw(); say(x.pinned ? `${x.title} is a starter on Chat` : `${x.title} left Chat's starters`); return; }
    if (id === 'export') { menu = 'wf-export'; draw(); return; }
    if (id === 'delete') { confirm = { kind, x }; draw(); }
  }
  function wire(b, pg) {
    bar = b; page = pg;
    const way = (key, title, mark, n) => ({ key: `way:${key}`, _way: key, title, mark, end: n === '' ? '' : String(n), current: current === `~${key}` || (key === 'workflows' && (current === '' || current.startsWith('workflow:'))) || (kindOfWay[key] && current.startsWith(`${kindOfWay[key]}:`)), tip: `${title}${n === '' ? '' : ` · ${n}`}` });
    const lib = (kind, x) => ({ key: `lib:${kind}:${x.id}`, _lib: [kind, x], title: x.title, mark: markOf(kind), end: kind === 'agent' ? x.model : x.runtime, tip: `Adds ${x.title} after the step you picked` });
    const flow = ['Task', 'End', 'AND: waits for all', 'OR: the first wins', 'Combine'].map((t) => ({ key: `lib:flow:${t}`, _lib: ['flow', { title: t }], title: t, mark: R.kindMark({ kind: 'workflow' }), tip: `${t}: drop it between two steps` }));
    ctl = R.listController({ root: bar, spec: { noun: 'workflows', label: 'Selected', view: () => ({ state: 'ready', parts: [],
      sections: current.startsWith('edit:') ? [{ id: 'lib-a', title: 'Agents · add to the canvas', rows: data.agent.map((x) => lib('agent', x)) }, { id: 'lib-s', title: 'Scripts', rows: data.script.map((x) => lib('script', x)) }, { id: 'lib-f', title: 'Flow', rows: flow }]
        : [{ id: 'yours', title: 'Yours', rows: [way('workflows', 'Workflows', markOf('workflow'), data.workflow.length), way('agents', 'Agents', markOf('agent'), data.agent.length), way('scripts', 'Scripts', markOf('script'), data.script.length), ...(allDrafts().length ? [way('drafts', 'Drafts', R.kindMark({ kind: 'plugin', icon: 'edit', tone: 'act' }), allDrafts().length)] : [])] },
          { id: 'browse', title: 'Browse', rows: [way('for-you', 'For you', R.kindMark({ kind: 'plugin', icon: 'sparkle' }), data.workflow.filter((w) => !w.own && w.tasks < 5).length), way('team', 'Your team’s', R.kindMark({ kind: 'group' }), TEAM), way('market', 'From the Marketplace', R.kindMark({ kind: 'plugin', icon: 'nav-marketplace' }), MARKET)] },
          ...(atLeast('expert') ? [{ id: 'hand', title: 'By hand', rows: [way('hand', 'Build it by hand', R.kindMark({ kind: 'plugin', icon: 'edit' }), '')] }] : [])] }),
      can: () => [], bulk: () => [], act: () => {}, word: () => false, say, active: () => /^#workflows/.test(location.hash),
      open: (r) => {
        if (r._lib) { const [kind, x] = r._lib; if (kind === 'flow') { say(`${x.title}: drop it between two steps on the canvas`); return; }
          const at = ed.picked.startsWith('n') && /^n\d+$/.test(ed.picked) ? +ed.picked.slice(1) + 1 : ed.wf.steps.length;
          edChange(() => { ed.wf.steps.splice(at, 0, [x.title, x.id, kind === 'agent' ? x.model : '', kind === 'agent' ? x.effort : '', 3, 0.15]); ed.g = null; ed.picked = `n${at}`; }, `Added ${x.title} after ${ed.wf.steps[at - 1]?.[0] || 'the task'}`); return; }
        if (r._way === 'market') { window.RailShell.go('marketplace/~shelf-3'); return; }
        if (r._way === 'hand') { const c = { id: `new-${Date.now() % 1e5}`, title: 'New workflow', own: true, domain: 'coding', what: 'Built by hand.', tasks: 0, merged: 0, from: 'Built by hand', fresh: true, steps: [], loops: [], draft: { steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.30], ['Build', 'implementer', 'Sonnet 5.5', 'high', 9, 0.22]], loops: [], changes: 0 } }; data.workflow.push(c); window.RailShell.go(`workflows/edit:${c.id}`); return; }
        window.RailShell.go(r._way === 'workflows' ? 'workflows' : `workflows/~${r._way}`);
      } } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit;
      if ((hit = on('[data-wf-use]'))) { const x = data.workflow.find((w) => w.id === hit.dataset.wfUse); if (x) act('use', 'workflow', x); return; }
      if ((hit = on('[data-wf-chat]'))) { const { x } = find(hit.dataset.wfChat); if (x) window.RailConversation?.start('ask', `Change ${x.title}: `); return; }
      if (on('[data-wf-ways]')) { waysOpen = !waysOpen; draw(); return; }
      if ((hit = on('[data-wf-edit]'))) { window.RailShell.go(`workflows/edit:${hit.dataset.wfEdit}`); return; }
      if (current.startsWith('edit:') && ed) {
        if (on('[data-draft-discard]')) { const x = data.workflow.find((w) => w.id === ed.id); if (x.fresh) { data.workflow.splice(data.workflow.indexOf(x), 1); ed = null; window.RailShell.go('workflows'); say(`Discarded ${x.title}`); return; } delete x.draft; ed = null; draw(); say(`Discarded the draft of ${x.title}`); return; }
        if (on('[data-ed-back]')) { window.RailShell.go(`workflows/workflow:${ed.id}`); return; }
        if (on('[data-ed-undo]')) { const s = ed.past.pop(); if (s) { ed.next.push(snap()); Object.assign(ed, s); edDraft(); draw(); } return; }
        if (on('[data-ed-redo]')) { const s = ed.next.pop(); if (s) { ed.past.push(snap()); Object.assign(ed, s); edDraft(); draw(); } return; }
        if (on('[data-ed-align]')) { edChange(() => { ed.g = window.RailGraph.align(ed.g || window.RailGraph.build(ed.wf, (r) => SAYS[r] || '')); }, 'Aligned: every step in its place'); return; }
        if (on('[data-ed-fit]')) { ed.scale = 1; draw(); return; }
        if ((hit = on('[data-ed-zoom]'))) { ed.scale = Math.min(2.5, Math.max(1, ed.scale + 0.25 * +hit.dataset.edZoom)); draw(); return; }
        if (on('[data-ed-more]')) { edMore = !edMore; draw(); return; }   // remembered while you edit
        if (on('[data-ed-ask]')) { document.getElementById('topnav-ask')?.click(); return; }
        if (on('[data-ed-save], [data-draft-save]')) { const x = data.workflow.find((w) => w.id === ed.id); x.draft ||= blank('workflow', ed.wf); saveDraft(x); ed.past = []; ed.next = []; draw(); say(`Saved ${x.title}`); return; }
        if ((hit = on('[data-ed-remove]'))) { const k = +hit.dataset.edRemove, name = ed.wf.steps[k][0]; edChange(() => { ed.wf.steps.splice(k, 1); ed.wf.loops = ed.wf.loops.filter((l) => l[0] !== name && l[1] !== name); ed.g = null; ed.picked = 'n_task'; }, `Removed ${name}`); return; }
        if ((hit = on('#wf-canvas-g [data-node-id]'))) { ed.picked = hit.dataset.nodeId; draw(); return; }
        if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
          if (id === 'ed-io') { say(v === 'import' ? 'Pick a file to import' : `Exported ${ed.wf.title}`); draw(); return; }
          const [, k, n] = id.split('-'), st = ed.wf.steps[+n];
          edChange(() => { if (k === 'm') st[2] = v; else if (k === 'e') st[3] = v; else if (k === 'l') ed.wf.loops.find((l) => l[0] === st[0])[2] = +v; else if (k === 't') st[6] = v; else if (k === 's') st[7] = v; else if (k === 'sa') st[8] = v; ed.g = null; }); return; }
        if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
        return;
      }
      const card = on('[data-wf-open]'); if (card && !on('button:not([data-wf-open])')) { window.RailShell.go(`workflows/${card.dataset.wfOpen}`); return; }
      const { kind, x } = current && !current.startsWith('~') ? find(current) : {};
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = id === 'wf-as' ? 'wf-export' : '';
        if (id === 'wf-sort') { sort = v; draw(); return; }
        if (id === 'wf-show') { show = v; draw(); return; }
        if (!x) return;
        if (id === 'wf-more') { act(v, kind, x); return; }
        if (id === 'wf-as') { x.as = v; draw(); return; }
        const n = +id.slice(4);
        touch(kind, x, (d) => { if (id.startsWith('wfm-')) d.steps[n][2] = v; else if (id.startsWith('wfe-')) d.steps[n][3] = v; else if (id.startsWith('wfl-')) d.loops[n][2] = +v; else if (id === 'ag-model') d.model = v; else if (id === 'ag-effort') d.effort = v; });
        draw(); say(`${x.title}: kept as a draft; tasks still run the saved one`); return;
      }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); return; }
      if (!x) return;
      if ((hit = on('[data-wf-sw]'))) { const k = hit.dataset.wfSw; touch(kind, x, (d) => { d[k] = !d[k]; }); draw(); say(`${x.title}: kept as a draft`); return; }
      if (on('[data-draft-save]')) { saveDraft(x); draw(); say(`Saved ${x.title}: tasks run it from now`); return; }
      if (on('[data-draft-discard]')) { const before = x.draft; if (x.fresh) { const l = data[kind], i = l.indexOf(x); l.splice(i, 1); say(`Discarded ${x.title}`, () => { l.splice(i, 0, x); draw(); }); window.RailShell.go('workflows'); return; } delete x.draft; draw(); say(`Discarded the draft of ${x.title}`, () => { x.draft = before; draw(); }); return; }
      if ((hit = on('[data-wf-run]'))) { say(`${x.title}: ${x.cases} of ${x.cases} cases pass`); return; }
      if ((hit = on('[data-confirm]'))) {
        if (menu === 'wf-export') { menu = ''; draw(); if (hit.dataset.confirm === 'yes') say(`Exported ${x.title} as ${x.as || 'a JSON file'}`); return; }
        if (hit.dataset.confirm === 'yes') { const l = data[kind], i = l.indexOf(x); l.splice(i, 1); confirm = null; say(`Deleted ${x.title}`, () => { l.splice(i, 0, x); draw(); }); window.RailShell.go('workflows'); } else { confirm = null; draw(); }
      }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu && menu !== 'wf-export', inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
    R.prefs?.onChange?.(() => { if (here()) draw(); });   // the mode decides the graph, the pickers and the canvas
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.workflows = { search: (q) => Object.entries(data).flatMap(([k, l]) => l.filter((x) => x.title.toLowerCase().includes(q)).map((x) => ({ label: x.title, where: `${k === 'workflow' ? 'Workflow' : k === 'agent' ? 'Agent' : 'Script'} · ${x.own ? 'yours' : 'built-in'}`, hash: `workflows/${k}:${x.id}` }))), sample: 'workflow:default', newLabel: 'Build workflow', newAct: () => window.RailConversation?.starter('workflow'),
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) { if (menu !== 'wf-export') menu = ''; if (confirm && `${confirm.kind}:${confirm.x.id}` !== arg) confirm = null; } current = arg || ''; draw(); } };
})();
