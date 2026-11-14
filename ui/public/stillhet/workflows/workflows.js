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
  const MODELS = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Codex', 'Gemini Pro'], EFFORTS = ['low', 'medium', 'high'];
  // what a step costs follows its model and effort: changing either re-prices the step, relative to what it was
  const RATE = { 'Opus 5.5': 1, 'Sonnet 5.5': 0.6, 'Haiku 5.5': 0.2, Codex: 0.7, 'Gemini Pro': 0.5 }, HARD = { low: 0.6, medium: 0.8, high: 1 };
  const reprice = (st, model, effort) => { const k = (RATE[model] / RATE[st[2]]) * (HARD[effort] / HARD[st[3]]); if (st[5] && Number.isFinite(k)) st[5] *= k; st[2] = model; st[3] = effort; };   // a live model id outside RATE keeps its cost
  // what each kind of step does to your task, in plain words (the story's words; a small model writes them in the product)
  const SAYS = { planner: 'Thinks before touching anything: reads your task and the code, writes the plan.', implementer: 'Makes the change and runs your tests until they pass.', reviewer: 'Reads it the way a colleague would, against the plan.', security: 'Looks for trouble: injection, secrets, unsafe input.', clarify: 'Asks you what is unclear before anything is planned.', 'run-tests': 'Runs your test suite; a failure sends it back.', 'diff-gate': 'Stops a change that touches too many files.' };
  // [name, ref, model, effort, minutes, $ a task]
  const data = {
    workflow: [
      { id: 'default', title: 'Default', own: false, domain: 'coding', what: 'Plan, build, review: what every task runs unless you pick another.', tasks: 41, merged: 92, from: 'Made with Worca', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.30], ['Build', 'implementer', 'Sonnet 5.5', 'high', 11, 0.22], ['Review', 'reviewer', 'Opus 5.5', 'medium', 4, 0.10]], loops: [['Review', 'Build', 3]] },
      { id: 'security-first', title: 'Security-first review', own: true, team: true, domain: 'coding', what: 'A security pass before each PR; it sends the build back up to twice.', tasks: 6, merged: 100, from: 'From the chat Release checklist', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.40], ['Build', 'implementer', 'Sonnet 5.5', 'high', 9, 0.31], ['Security check', 'security', 'Opus 5.5', 'high', 4, 0.19], ['Review', 'reviewer', 'Opus 5.5', 'medium', 2, 0.12]], loops: [['Security check', 'Build', 2]] },
      { id: 'quick-fix', title: 'Quick Fix', own: false, domain: 'coding', what: 'Skips the plan; builds and runs the tests.', tasks: 9, merged: 89, from: 'Made with Worca', steps: [['Build', 'implementer', 'Sonnet 5.5', 'medium', 5, 0.18], ['Run tests', 'run-tests', '', '', 2, 0.01]], loops: [['Run tests', 'Build', 2]] },
      { id: 'full', title: 'Full', own: false, domain: 'coding', what: 'Asks first, plans, builds, reviews and runs the tests.', tasks: 3, merged: 100, from: 'Made with Worca', steps: [['Clarify', 'clarify', 'Opus 5.5', 'high', 2, 0.12], ['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.30], ['Build', 'implementer', 'Sonnet 5.5', 'high', 11, 0.24], ['Review', 'reviewer', 'Opus 5.5', 'high', 4, 0.14], ['Run tests', 'run-tests', '', '', 2, 0.01]], loops: [['Review', 'Build', 3]] },
      { id: 'api-rewrite', title: 'API rewrite', own: true, team: true, domain: 'coding', what: 'Plans the contract, builds it behind a diff gate, reviews it.', tasks: 1, merged: 0, running: true, from: 'From the chat Plan the API rewrite', steps: [['Plan', 'planner', 'Opus 5.5', 'high', 6, 0.90], ['Build', 'implementer', 'Opus 5.5', 'high', 24, 2.80], ['Diff gate', 'diff-gate', '', '', 1, 0.01], ['Review', 'reviewer', 'Opus 5.5', 'high', 6, 0.40]], loops: [['Review', 'Build', 2]] },
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
  // the live kind (slice 7 D3): the place reads its lists through src() (RailWorkflowLive's records, dev's ids); the demo
  // reads its own data. Every write in the live kind goes through RailWorkflowLive (workflow-live.mjs), never RailWould.
  const isLive = () => window.RailAdapter?.kind === 'live';
  const LIVE = () => (isLive() ? window.RailWorkflowLive || null : null);
  const NONE = { workflow: [], agent: [], script: [] };
  const src = () => (isLive() ? LIVE()?.data() || NONE : data);
  // D19: the lists' own looks: the address's ?state= in the demo, the live lists' read in the live kind
  const listNow = () => { const st = isLive() ? LIVE()?.status() || 'loading' : window.RailDemoState?.list; return st === 'loading' || st === 'failed' ? st : 'ready'; };
  const UNDO_MS = 5000, BRANCHES = 'its steps branch; change it in a chat';   // the toast's undo window (pulse.js); D7's refusal
  const savedCount = () => src().workflow.filter((w) => !w.fresh).length;
  const teamOf = () => src().workflow.filter((w) => w.team);
  const forYou = () => src().workflow.filter((w) => !w.own && !w.plugin && w.tasks < 5);   // a suggestion; what you just installed is not one
  const marketCount = () => window.RailPlaces?.marketplace?.notInstalled?.(3) ?? 0;   // what the row opens: the agents and workflows the Marketplace still has for you
  const kindOfWay = { workflows: 'workflow', agents: 'agent', scripts: 'script' };
  const WAYS = ['workflows', 'agents', 'scripts', 'drafts', 'for-you', 'team'];   // an address may name only these
  let wide = false, current = '', menu = '', confirm = null, ctl = null, bar = null, page = null, sort = 'most used', show = 'the graph', exporting = false;   // Advanced and Expert open on the real graph; Expand reads it large (panel.expand)
  let importing = null, exportDir = '', fileInput = null;   // the import's confirm ({ name, n, resolve }); the plugin export's folder; the import's file picker (outside the page: a redraw must not replace it while the picker is open)
  let ed = null, edMore = false;   // the canvas: { id, wf (a working copy), g, picked, more, saved, past:[], next:[] }
  const find = (k) => { const [kind, id] = k.split(':'), key = kind === 'edit' ? 'workflow' : kind; return { kind, x: Object.hasOwn(src(), key) ? src()[key].find((y) => y.id === id) : undefined }; };
  const titleOf = (id) => src().agent.find((a) => a.id === id)?.title || src().script.find((s) => s.id === id)?.title || id;
  const usedIn = (id) => src().workflow.filter((w) => w.steps.some((s) => s[1] === id)).map((w) => w.title);
  const money = (n) => `$${n.toFixed(2)}`;
  const costOf = (w) => w.steps.reduce((a, s) => a + (s[5] || 0), 0), minOf = (w) => w.steps.reduce((a, s) => a + (s[4] || 0), 0);
  const mergedOf = (w) => (w.tasks ? `${w.merged}% merged` : 'no tasks yet');   // a copy starts with no history of its own
  let figs = false;   // look.figures-on-demand: a card's cost and time open with the page's Figures
  const factsOf = (w) => (figs ? (w.running ? (isLive() ? 'Its first task is running' : `Its first task is running · ${money(4.8)} so far`) : `${money(costOf(w))} a task · ${minOf(w)} min · ${mergedOf(w)}`) : (w.running ? 'Its first task is running' : ''));
  const shape = (w) => `${w.steps.length} steps · ${w.tasks ? `used by ${w.tasks} ${w.tasks === 1 ? 'task' : 'tasks'}` : 'not used yet'}`;
  const markOf = (kind, size) => R.kindMark({ kind, size });
  // drafts (rail.drafts): a change by hand goes into the thing's draft; tasks keep running the saved one until you save
  const blank = (kind, x) => (kind === 'workflow' ? { title: x.title, steps: structuredClone(x.steps), loops: structuredClone(x.loops), changes: 0, ...(x.tpl ? { base: x.base || x.tpl } : {}) } : { model: x.model, effort: x.effort, asks: x.asks, fan: x.fan, changes: 0 });
  // what a thing says, to tell a draft from what is saved: a default written out is no change, and a re-priced step rounds back
  const plain = (o) => JSON.stringify([o.title, (o.steps || []).map((s) => [...s.slice(0, 5), +(s[5] || 0).toFixed(4), s[6] || '30 min', s[7] || 'its own session', s[8] || 'on']), o.loops, o.model, o.effort, o.asks, o.fan]);
  const touch = (kind, x, fn) => { x.draft ||= blank(kind, x); fn(x.draft); x.draft.changes += 1; if (!x.fresh && plain({ ...x, ...x.draft }) === plain(x)) delete x.draft; };   // back to what is saved: no draft
  const shown = (x) => (x.draft ? { ...x, ...x.draft } : x);   // what you see and edit is the draft
  const saveDraft = (x) => { const { changes, ...rest } = x.draft; Object.assign(x, structuredClone(rest)); delete x.draft; delete x.fresh; };
  const allDrafts = () => Object.entries(src()).flatMap(([k, l]) => l.filter((x) => x.draft).map((x) => [k, x]));
  const barOfDraft = (x) => (x.draft ? R.draftBar({ changes: x.draft.changes, fresh: !!x.fresh, hooks: { save: { 'data-draft-save': '' }, discard: { 'data-draft-discard': '' } } }) : '');

  // ---- the story: a WorkflowStory from the workflow and its tasks ----
  let waysOpen = false;
  // set.flags: a Labs switch about how a workflow runs shows here, on the workflow it changes, while it is on
  function labsRows(w) {
    if (!R.prefs.flag('sessionGroups') || w.steps.length < 2) return '';
    return R.settingsSection({ title: 'Labs', meta: 'On in Settings › Labs.', rows: R.settingsRow({ name: 'Shared session', sentence: `Steps ${w.steps.slice(0, Math.min(3, w.steps.length)).map((s) => s[0]).join(', ')} run in one agent session and share what they learned` }) });
  }
  function storyOf(w) {
    const loop = w.loops[0], from = loop ? w.steps.findIndex((s) => s[0] === loop[0]) : -1, to = loop ? w.steps.findIndex((s) => s[0] === loop[1]) : -1;
    const round = from >= 0 ? (w.steps[from][5] || 0) + (w.steps[to][5] || 0) : 0, roundMin = from >= 0 ? (w.steps[from][4] || 0) + (w.steps[to][4] || 0) : 0;
    const half = Math.ceil(w.tasks / 2);
    const ways = [{ title: 'Straight through', meta: `${w.steps.map((s) => s[0]).join(', ')} · about ${minOf(w)} min, ${money(costOf(w))}${w.tasks ? ` · ${w.tasks - (loop ? half : 0)} of ${w.tasks} tasks` : ''}`, tone: 'ok', stage: 4 },
      ...(loop ? [{ title: `${loop[0]} finds something`, meta: `Back to ${loop[1]} once or twice · each round about ${roundMin} min, ${money(round)}${w.tasks ? ` · ${half} of ${w.tasks} tasks` : ''}`, tone: 'act', stage: 2 },
        { title: `Still not right after ${loop[2]} ${+loop[2] === 1 ? 'round' : 'rounds'}`, meta: 'It stops and asks you what to do · never yet', tone: 'ask', stage: 2 }] : [])];
    return R.workflowStory({ steps: w.steps.map(([name, ref, , , min, cost], i) => ({ name, says: SAYS[ref] || `${titleOf(ref)}.`, meta: `about ${min} min · ${money(cost || 0)}`, check: i === from })),
      loop: loop ? { from, to, text: `found something? back to ${loop[1]}, at most ${+loop[2] === 1 ? 'once' : +loop[2] === 2 ? 'twice' : `${loop[2]} times`}` } : null, ways: !atLeast('advanced') || waysOpen ? ways : [], byline: atLeast('advanced') ? `Told by Haiku 5.5 from this workflow${w.tasks ? ` and its last ${w.tasks} ${w.tasks === 1 ? 'task' : 'tasks'}` : ''}` : '' })
      + (atLeast('advanced') ? `<div class="wf-acts open-line">${R.button({ label: waysOpen ? 'Fold how a task goes through it' : `How a task goes through it · ${ways.length} ${ways.length === 1 ? 'way' : 'ways'}`, kind: 'quiet', icon: R.icon(waysOpen ? 'chevron' : 'chevR', 12), attrs: { 'data-wf-ways': '', 'aria-expanded': String(waysOpen), 'data-folds': '.ws .list' } })}</div>` : '');
  }

  // ---- the cards of a way ----
  function cardOf(kind, x) {
    const open = { 'data-wf-open': `${kind}:${x.id}` };
    if (kind === 'workflow' && x.fresh) return R.pluginCard({ mark: R.kindMark({ kind: 'workflow', tone: 'idle', advisory: true }), kicker: `Draft · never saved · ${x.draft.steps.length} steps`, title: x.title, what: x.what, facts: 'Nothing can run it until you save it', action: R.button({ label: atLeast('expert') ? 'Go on editing' : 'Finish it in a chat', attrs: atLeast('expert') ? { 'data-wf-edit': x.id } : { 'data-wf-chat': `workflow:${x.id}` } }), attrs: open });
    if (kind === 'workflow') return R.pluginCard({ mark: R.kindMark({ kind: 'workflow', tone: x.running ? 'run' : 'idle', advisory: !x.running && !!x.draft }), kicker: x.draft ? `${shape(x)} · a draft waits, ${x.draft.changes} ${x.draft.changes === 1 ? 'change' : 'changes'}` : shape(x), title: x.title, what: x.what, facts: factsOf(x), action: R.button({ label: 'Use it', attrs: { 'data-wf-use': x.id, title: 'Starts a task in a chat with this workflow in its sentence' } }), more: R.button({ label: 'Change it in a chat', kind: 'quiet', attrs: { 'data-wf-chat': `${kind}:${x.id}` } }), attrs: open });
    const kicker = kind === 'agent' ? `${{ producer: 'Makes something', verifier: 'Checks', clarifier: 'Asks you' }[x.type]} · ${x.model}` : `A script · ${x.runtime}`;
    const what = kind === 'agent' ? `Takes ${x.ins}; gives ${x.outs}.` : `${x.what}.`;
    return R.pluginCard({ mark: markOf(kind), kicker, title: x.title, what, facts: usedIn(x.id).length ? `In ${usedIn(x.id).join(', ')}` : 'In no workflow yet', action: R.button({ label: 'Open', attrs: open }), more: R.button({ label: 'Change it in a chat', kind: 'quiet', attrs: { 'data-wf-chat': `${kind}:${x.id}` } }), attrs: open });
  }
  function wayHtml(way) {
    const kind = kindOfWay[way] || 'workflow';
    const SORT = { 'most used': (a, b) => (b.tasks || 0) - (a.tasks || 0), cheapest: (a, b) => costOf(a) - costOf(b), 'A–Z': (a, b) => a.title.localeCompare(b.title) };
    let list = src()[kind].filter((x) => !x.fresh);   // one never saved is only a draft, listed and counted there
    if (way === 'drafts') { const d = allDrafts(); return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ center: { label: 'Workflows', to: 'workflows' }, title: 'Drafts', facts: esc(`${d.length} ${d.length === 1 ? 'draft' : 'drafts'} · changed by hand, not saved · tasks run the saved ones`) })}${d.length ? `<div class="pg-grid">${d.map(([k, x]) => cardOf(k, x)).join('')}</div>` : R.emptyState({ title: 'No drafts.', text: 'A change you make by hand waits here until you save it.', actions: R.button({ label: 'Go to All workflows', kind: 'quiet', attrs: { 'data-wf-goto': 'workflows' } }) })}</div></div></div>`; }
    if (way === 'for-you') list = forYou();
    if (way === 'team') list = teamOf();
    if (kind === 'workflow') list.sort(SORT[sort] || SORT['most used']);
    const T = { workflows: ['Your workflows', `${savedCount()} workflows · each made in a chat`], agents: ['Your agents', `${src().agent.length} agents · the steps workflows are made of`], scripts: ['Your scripts', `${src().script.length} scripts · checks a workflow runs`], 'for-you': ['For you', 'Workflows Worca thinks fit how you work'], team: ['Your team’s', `${teamOf().length} shared by your team · use one and it is yours too`] }[way] || ['Your workflows', ''];
    const sentence = kind === 'workflow' && list.length > 1 ? `<div class="wf-sent">Showing ${R.sentencePicker({ id: 'wf-sort', text: sort, tip: 'How they are ordered', items: Object.keys(SORT).map((v) => ({ id: v, text: v, checked: v === sort })), open: menu === 'wf-sort', chevron: R.icon('chevron', 10) })} ${R.figuresToggle({ open: figs, attrs: { 'data-wf-figs': '' } })}</div>` : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ center: way === 'workflows' ? null : { label: 'Workflows', to: 'workflows' }, title: T[0], facts: esc(T[1]) })}${sentence}${list.length ? `<div class="pg-grid">${list.map((x) => cardOf(kind, x)).join('')}</div>` : R.emptyState({ title: way === 'team' ? 'Your team has shared nothing yet.' : 'Nothing to suggest yet.', text: way === 'team' ? 'A workflow your team shares shows here, ready to use.' : 'Worca suggests workflows once it has seen how you work.', actions: R.button({ label: 'Go to All workflows', kind: 'quiet', attrs: { 'data-wf-goto': 'workflows' } }) })}</div></div></div>`;
  }

  // ---- a thing's page ----
  function pageHtml(kind, x0) {
    const x = shown(x0), draft = barOfDraft(x0);
    const pick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    const ro = !x.own;   // a built-in reads; its copy is yours to change
    const menuItems = [...(kind === 'workflow' ? [{ id: 'pin', text: x.pinned ? 'Unpin from Chat' : 'Pin to Chat', help: 'Its starter on Chat\'s home' }, { id: 'export', text: 'Export…', help: 'As a file, a Claude Code skill or a Worca plugin' }] : []), ...(ro && (kind === 'workflow' || !isLive()) ? [{ id: 'copy', text: 'Use as a template', help: 'A copy of yours, to change' }] : []), ...(x.own ? [{ sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'Asks first' }] : [])];
    const more = R.moreMenu({ id: 'wf-more', label: `More for ${x.title}`, icon: R.icon('more', 16), open: menu === 'wf-more', items: menuItems });
    const strip = confirm?.x === x0 ? R.confirmStrip({ text: `Delete ${x.title}? ${x0.draft && !x0.fresh ? `Its draft of ${x0.draft.changes} unsaved ${x0.draft.changes === 1 ? 'change' : 'changes'} goes with it. ` : ''}${kind === 'workflow' ? `${x.running ? 'Its first task is still running and will finish. ' : ''}Tasks it ran keep their history; schedules that use it stop.` : usedIn(x.id).length ? `The step stays in ${usedIn(x.id).join(', ')}, and those workflows go on running it.` : 'No workflow uses it.'}`, yes: 'Delete', danger: true }) : '';
    const exp = exporting ? `<div class="card-form">${R.confirmForm({ form: 'export', id: 'wf-export-t', text: `Export ${x.title}`, body: `<span class="tp-sentence">As ${pick('wf-as', x.as || 'a JSON file', ['a JSON file', 'a Claude Code skill', 'a Worca plugin'], 'What it becomes')} with the agents it uses</span>`
      + (x.as === 'a Worca plugin' ? R.field({ id: 'wf-export-dir', label: 'Folder', value: exportDir, placeholder: '~/worca-plugins/my-plugin', hint: 'The plugin is written into this folder', attrs: { 'data-wf-export-dir': '' } }) : '') + R.confirmActions({ yes: 'Export' }) })}</div>` : '';
    const chat = R.button({ label: 'Change it in a chat', attrs: { 'data-wf-chat': `${kind}:${x.id}`, title: 'Worca proposes the change as a card; you apply it' } });
    if (kind === 'workflow') {
      const delta = costOf(x) - costOf(src().workflow[0]);
      const head = R.placeHead({ center: { label: 'Workflows', to: 'workflows' }, title: x.title, facts: esc(`${shape(x)} · ${x.from}`), mark: R.kindMark({ kind: 'workflow', tone: x.running ? 'run' : 'idle' }), word: x.running ? 'Running' : `${money(costOf(x))} a task`,
        why: x.running ? (isLive() ? 'Its first task is running' : `${money(4.8)} so far`) : `${x.id === 'default' || x.id === 'wf_default' ? 'what every task runs' : `${money(Math.abs(delta))} ${delta >= 0 ? 'more' : 'less'} than Default`} · ${mergedOf(x)}`,
        action: chat + (atLeast('expert') ? R.button({ label: ro ? 'Edit a copy by hand' : 'Edit by hand', kind: 'quiet', attrs: ro ? { 'data-wf-copy-edit': x.id, title: 'A built-in reads as it is: this makes a copy of yours, on the canvas' } : { 'data-wf-edit': x.id, title: 'The graph, on the canvas' } }) : ''), menu: more }) + draft;
      const toggle = atLeast('advanced') ? `<div class="wf-sent">Showing ${pick('wf-show', show, ['the graph', 'the story only'], 'The real graph under the story, or the story alone')}</div>` : '';
      const well = atLeast('advanced') && show === 'the graph' ? R.expandFrame({ open: wide, name: `the graph of ${esc(x.title)}`, body: `${wide ? `<h2 class="wf-ed-h">${esc(x.title)}</h2>` : ''}<div class="wf-well gv-skin is-view" id="wf-graph"></div>`, attrs: { 'data-wf-wide': '' } }) : '';
      // thing.one-telling: the story says what each step does and costs, the graph how they connect; this holds only what you can change
      const steps = atLeast('advanced') && !ro ? R.settingsSection({ title: 'Change a step', meta: 'Its model and effort here, or anything in a chat.',
        rows: x.steps.map(([name, , model, effort], i) => (model ? R.settingsRow({ name: `${i + 1}. ${name}`, sentence: `Runs on ${pick(`wfm-${i}`, model, MODELS, 'Its model')} ${pick(`wfe-${i}`, effort, EFFORTS, 'How hard it thinks')}` }) : '')).join('')
          + x.loops.map(([from, to, n], i) => R.settingsRow({ name: 'Loop', sentence: `${esc(from)} sends fixes back up to ${pick(`wfl-${i}`, String(n), ['1', '2', '3', '5'], 'How many rounds')} times` })).join('') }) : '';
      return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${exp}${storyOf(x)}${labsRows(x)}${toggle}${well}${steps}<div class="wf-acts">${R.button({ label: 'Use it', attrs: { 'data-wf-use': x.id, disabled: x0.fresh ? true : null, title: x0.fresh ? 'Save it first: nothing can run a draft' : 'Starts a task in a chat with this workflow in its sentence' } })}${x0.fresh ? '<span class="wf-ed-m">Save it first: nothing can run a draft</span>' : ''}</div></div></div><div class="convo-dock" id="wf-dock"></div></div>`;
    }
    const head = R.placeHead({ center: { label: 'Workflows', to: 'workflows' }, title: x.title, facts: esc(`${x.domain} · ${kind === 'agent' ? x.type : x.runtime}`), mark: markOf(kind), word: x.own ? 'Yours' : 'Built-in', why: usedIn(x.id).length ? `In ${usedIn(x.id).join(', ')}` : 'In no workflow yet', action: chat, menu: more }) + draft;
    let body;
    if (kind === 'agent') {
      body = R.settingsSection({ title: 'Its work', rows: [R.settingsRow({ name: 'Does', sentence: esc(SAYS[x.id] || '') }), R.settingsRow({ name: 'Takes', sentence: esc(x.ins) }), R.settingsRow({ name: 'Gives', sentence: esc(x.outs) })].join('') })
        + R.settingsSection({ title: 'How it runs', rows: [R.settingsRow({ name: 'Model', sentence: `Runs on ${ro || !atLeast('advanced') ? `<b>${esc(x.model)}</b> ${esc(x.effort)}` : `${pick('ag-model', x.model, MODELS, 'Its model')} ${pick('ag-effort', x.effort, EFFORTS, 'How hard it thinks')}`}` }),
          R.settingsRow({ name: 'Questions', sentence: x.asks ? 'Asks you when something is unclear' : 'Never asks; it decides', end: ro || !atLeast('advanced') ? '' : R.switchButton({ on: x.asks, label: 'Asks questions', attrs: { 'data-wf-sw': 'asks' } }) }),
          R.settingsRow({ name: 'Research', sentence: x.fan ? 'Sends helpers to read the code first' : 'Reads the code itself', end: ro || !atLeast('advanced') ? '' : R.switchButton({ on: x.fan, label: 'Research fan-out', attrs: { 'data-wf-sw': 'fan' } }) })].join('') });
    } else {
      body = R.settingsSection({ title: 'Its work', rows: [R.settingsRow({ name: 'Does', sentence: esc(x.what) }), R.settingsRow({ name: 'Written in', sentence: `${esc(x.runtime)}, stopped after ${esc(x.timeout)}` }), R.settingsRow({ name: esc(x.param[0]), sentence: `<b>${esc(x.param[1])}</b> unless a workflow says otherwise` })].join('') })
        + R.settingsSection({ title: 'Its tests', rows: R.settingsRow({ name: 'Cases', sentence: `${x.cases} saved ${x.cases === 1 ? 'case' : 'cases'}`, end: R.button({ label: 'Run all', kind: 'quiet', attrs: { 'data-wf-run': x.id } }) }) });
    }
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${exp}${body}</div></div><div class="convo-dock" id="wf-dock"></div></div>`;
  }

  // the import's confirm (D10): a file that runs scripts asks before anything is imported
  const importStrip = () => (importing ? R.confirmStrip({ id: 'wf-import-t', text: `It runs ${importing.n} ${importing.n === 1 ? 'script' : 'scripts'} on your machine. Import it?`, yes: 'Import', attrs: { 'data-wf-import': '' } }) : '');

  // ---- Expert: the canvas (dev's graph, drawn in the Rail look) ----
  // a step's place on the canvas: its node id (live, the tuple's [9]) or the demo's nN
  const stepAt = (p) => { const k = ed.wf.steps.findIndex((s) => s[9] && s[9] === p); return k >= 0 ? k : /^n\d+$/.test(p) ? +p.slice(1) : -1; };
  const snap = () => ({ wf: structuredClone(ed.wf), g: ed.g && { ...ed.g, tpl: structuredClone(ed.g.tpl) }, picked: ed.picked, laid: ed.laid });   // a copy of the layout: Auto-align writes the live one
  function edHtml() {
    const w = ed.wf, i = stepAt(ed.picked), st = w.steps[i];
    const pick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: R.icon('chevron', 10), right: true });
    const loop = st && w.loops.find((l) => l[0] === st[0]);
    const insp = st ? `<h2 class="wf-ed-h">${esc(st[0])}</h2><p class="wf-ed-m">Step ${i + 1} of ${w.steps.length} · ${st[2] ? 'an agent' : 'a script'}</p>${R.settingsSection({ rows: [R.settingsRow({ name: 'Name', sentence: R.field({ id: 'ed-step-name', label: 'Step name', quietLabel: true, value: st[0], hint: '40 characters at most', attrs: { 'data-ed-step': String(i), maxlength: 40 } }) }), R.settingsRow({ name: 'Does', sentence: esc(SAYS[st[1]] || titleOf(st[1])) }),
      ...(st[2] ? [R.settingsRow({ name: 'Runs on', sentence: `${pick(`ed-m-${i}`, st[2], MODELS, 'Its model')} ${pick(`ed-e-${i}`, st[3], EFFORTS, 'How hard it thinks')}` })] : []),
      ...(loop ? [R.settingsRow({ name: 'Loop', sentence: `Sends fixes back to <b>${esc(loop[1])}</b> up to ${pick(`ed-l-${i}`, String(loop[2]), ['1', '2', '3', '5'], 'How many rounds')} times, then asks you` })] : []),
      R.settingsRow({ name: 'Stops after', sentence: pick(`ed-t-${i}`, st[6] || '30 min', ['10 min', '30 min', '1 hour'], 'When it gives up') }),
      R.settingsRow({ name: 'Costs', sentence: `About ${money(st[5] || 0)} a task${loop ? `; a round back adds ${money((st[5] || 0) + (w.steps[w.steps.findIndex((s) => s[0] === loop[1])]?.[5] || 0))}` : ''}` }),
      ...(edMore ? ['<div class="ed-more">' + R.settingsRow({ name: 'Session', sentence: `${pick(`ed-s-${i}`, st[7] || 'its own session', ['its own session', 'one conversation with the step before'], 'Which session it runs in')}` }), R.settingsRow({ name: 'Sub-agents', sentence: `${pick(`ed-sa-${i}`, st[8] || 'on', ['on', 'off'], 'Whether it sends helpers')}` }) + '</div>'] : [])].join('') })}
      <div class="wf-acts open-line">${R.button({ label: edMore ? 'Fewer settings' : 'More settings', kind: 'quiet', icon: R.icon(edMore ? 'chevron' : 'chevR', 12), attrs: { 'data-ed-more': '', 'aria-expanded': String(edMore), 'data-folds': '.ed-more' } })}</div><div class="wf-acts">${R.button({ label: 'Try it on a task', kind: 'quiet', attrs: { 'data-ed-try': String(i), disabled: src().workflow.find((y) => y.id === ed.id)?.fresh ? true : null, title: src().workflow.find((y) => y.id === ed.id)?.fresh ? 'Save it first: nothing can run a draft' : 'Starts a task in a chat with this step named' } })}${R.button({ label: 'Remove', kind: 'quiet', attrs: { 'data-ed-remove': String(i) } })}</div>${src().workflow.find((y) => y.id === ed.id)?.fresh ? '<p class="wf-ed-m">Try it on a task once it is saved: nothing can run a draft.</p>' : ''}`
      : `<h2 class="wf-ed-h">${ed.picked === 'n_end' ? 'End' : 'Task'}</h2><p class="wf-ed-m">${ed.picked === 'n_end' ? 'What the workflow comes to: a pull request' : 'Where your task comes in: its words and the files you add'}</p><p class="wf-ed-m">Pick a step on the canvas to change it.</p>`;
    const io = `<span class="rc-pop">${R.button({ label: 'Import, Export', kind: 'quiet', attrs: { 'data-menu': 'ed-io', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'ed-io') } })}${menu === 'ed-io' ? R.compactMenu({ items: [{ id: 'ed-io|import', text: 'Import…', help: 'A JSON file, a Claude Code skill' }, { id: 'ed-io|export', text: 'Export…', help: 'As a file, a skill or a plugin' }] }) : ''}</span>`;
    return `<div class="wf-ed">${importStrip()}<div class="wf-ed-top">${R.button({ label: `Back to ${w.title}`, kind: 'quiet', iconOnly: true, icon: R.icon('chevL', 14), attrs: { 'data-ed-back': '' } })}${R.field({ id: 'ed-name', label: 'Workflow name', quietLabel: true, value: w.title, attrs: { 'data-ed-name': '', maxlength: 40, title: '40 characters at most' } })}${src().workflow.find((y) => y.id === ed.id)?.draft ? '' : '<span>saved · tasks run this</span>'}<span class="wf-ed-sp"></span>${R.button({ label: 'Undo', kind: 'quiet', attrs: { 'data-ed-undo': '', disabled: ed.past.length ? null : true, title: ed.past.length ? null : 'Nothing to undo yet' } })}${R.button({ label: 'Redo', kind: 'quiet', attrs: { 'data-ed-redo': '', disabled: ed.next.length ? null : true, title: ed.next.length ? null : 'Nothing undone to bring back' } })}${io}${R.button({ label: 'Ask Worca', kind: 'quiet', icon: R.icon('ask-worca', 14), attrs: { 'data-ed-ask': '' } })}${barOfDraft(src().workflow.find((y) => y.id === ed.id) || {})}</div>
      <div class="wf-ed-body"><div class="wf-canvas"><div class="gv-skin is-edit" id="wf-canvas-g"></div><div class="wf-ed-tools">${R.button({ label: 'Auto-align', kind: 'quiet', attrs: { 'data-ed-align': '', title: 'Tidies every step into place; Undo puts it back' } })}${R.button({ label: 'Zoom out', kind: 'quiet', attrs: { 'data-ed-zoom': '-1', disabled: ed.z ? null : true, title: ed.z ? null : 'The whole graph already fits' } })}<span>${Math.round((ed.z || ed.fit || 1) * 100)}%</span>${R.button({ label: 'Zoom in', kind: 'quiet', attrs: { 'data-ed-zoom': '1', disabled: (ed.z || ed.fit) >= 1 ? true : null, title: (ed.z || ed.fit) >= 1 ? 'It is at full size' : null } })}${R.button({ label: 'Fit', kind: 'quiet', attrs: { 'data-ed-fit': '', disabled: ed.z ? null : true, title: ed.z ? 'The whole graph in the canvas' : 'The whole graph already fits' } })}</div></div><aside class="wf-insp">${insp}</aside></div></div>`;
  }
  function edMount() {
    const host = document.getElementById('wf-canvas-g'); if (!host) return;
    const wf = isLive() && ed.wf.tpl ? { ...ed.wf, tpl: LIVE().preview(ed.id, ed.wf) } : ed.wf;   // live: dev's template, as the draft would save it
    const { g, fit } = window.RailGraph.mount(host, wf, { width: host.parentElement.clientWidth - 48, zoom: ed.z || 0, mode: 'edit', aligned: false, select: ed.picked, g: ed.g, says: (r) => SAYS[r] || '' });
    ed.g = g;
    // the zoom is the graph's real size; it opens fitted (0 is Fit), and a zoom past that scrolls inside the canvas
    if (Math.abs(fit - ed.fit) > 0.02) { ed.fit = fit; page.innerHTML = edHtml(); edMount(); }
  }
  const edDraft = () => { const x = src().workflow.find((w) => w.id === ed.id); if (!x) return; if (!x.fresh && (!ed.past.length || (!ed.laid && plain(ed.wf) === plain(x)))) { delete x.draft; return; } x.draft = { title: ed.wf.title, steps: structuredClone(ed.wf.steps), loops: structuredClone(ed.wf.loops), changes: Math.max(ed.past.length, 1), ...(ed.wf.tpl ? { base: ed.wf.base || ed.wf.tpl } : {}) }; };   // live: the template the canvas opened on (D9)   // the canvas writes the thing's draft
  const edChange = (fn, words) => { ed.past.push(snap()); ed.next = []; fn(); edDraft(); draw(); if (words) say(words); };

  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'workflows';   // the page area is shared by every place: draw only while this one is open
  let drawnAt = null;   // which thing the page shows: redrawing it keeps your place, so a picker opens where you clicked and not under the dock
  function draw() {
    if (!bar || !page || !here()) return;
    const keep = drawnAt === current ? ['.convo-scroll', '.wf-insp'].map((q) => [q, page.querySelector(q)?.scrollTop || 0]) : [];
    drawNow(); drawnAt = current;
    keep.forEach(([q, top]) => { const el = page.querySelector(q); if (el) el.scrollTop = top; });
  }
  function drawNow() {
    ctl?.paint();
    if (current.startsWith('edit:')) {
      if (listNow() !== 'ready') { page.innerHTML = `<div class="rail-locked">${R.listState({ state: listNow(), noun: 'workflows', retry: listNow() === 'failed' ? { 'data-wf-retry': '' } : null })}</div>`; return; }
      const { x } = find(current); if (!x || !atLeast('expert') || !x.own) { window.RailShell.go(x ? `workflows/workflow:${x.id}` : 'workflows'); return; }   // a built-in reads as it is
      if (!ed || ed.id !== x.id) ed = { id: x.id, wf: structuredClone(shown(x)), g: null, picked: x.steps[x.loops.length ? x.steps.findIndex((s) => s[0] === x.loops[0][0]) : 0]?.[9] || `n${x.loops.length ? x.steps.findIndex((s) => s[0] === x.loops[0][0]) : 0}`, saved: true, past: [], next: [], z: 0, fit: 0 };
      page.innerHTML = edHtml(); edMount(); return;
    }
    const ls = listNow();
    if (ls !== 'ready') { page.innerHTML = `<div class="rail-locked">${R.placeHead({ title: 'Workflows' })}${R.listState({ state: ls, noun: 'workflows', retry: ls === 'failed' ? { 'data-wf-retry': '' } : null })}</div>`; return; }   // D19
    const { kind, x } = current && !current.startsWith('~') ? find(current) : {};
    if (!x && /^(agent|script):/.test(current)) { const way = `${kind}s`; page.innerHTML = `<div class="rail-locked">${R.notFound({ what: kind, name: current.split(':')[1], back: way.charAt(0).toUpperCase() + way.slice(1), attrs: { 'data-wf-goto': `workflows/~${way}` } })}</div>`; return; }   // nav.not-found, with this thing's own noun
    if (!x) { page.innerHTML = wayHtml(current.startsWith('~') ? current.slice(1) : 'workflows'); return; }
    page.innerHTML = pageHtml(kind, x);
    const gEl = document.getElementById('wf-graph'); if (gEl) window.RailGraph?.mount(gEl, isLive() && x.tpl && x.draft ? { ...shown(x), tpl: LIVE().preview(x.id, x.draft) } : shown(x), { width: gEl.clientWidth || 900 });   // thing.one-telling: the story says what a step does
    window.RailConversation?.dock(document.getElementById('wf-dock'), { kind, title: x.title, chat: '' });
  }
  function copyOf(kind, x) {   // each copy its own id and name: a second copy is "copy 2"
    let n = 1; while (src()[kind].some((y) => y.id === `${x.id}-copy${n > 1 ? `-${n}` : ''}`)) n += 1;
    const s = n > 1 ? `-${n}` : '', c = { ...structuredClone(x), id: `${x.id}-copy${s}`, title: `${x.title} copy${n > 1 ? ` ${n}` : ''}`, own: true, team: false, pinned: false, tasks: 0, merged: 0, running: false, from: 'A copy of yours' }; src()[kind].push(c); return c;
  }
  function act(id, kind, x) {
    if (id === 'use') { window.RailConversation?.handOver({ mode: 'task', workflow: x.title, about: { kind: 'Workflow', name: x.title } }); return; }
    if (id === 'copy' && LIVE()) { liveCopy(x, (nid) => `workflows/workflow:${nid}`); return; }
    if (id === 'copy') { const c = copyOf(kind, x); window.RailShell.go(`workflows/${kind}:${c.id}`); say(`${c.title}: yours to change`); return; }
    if (id === 'pin' && LIVE()) { const on = !x.pinned; LIVE().pin(x.id, on).then((a) => { draw(); say(!a.ok ? `Could not pin ${x.title}: ${a.error}` : on ? `${x.title} is a starter on Chat` : `${x.title} left Chat's starters`); }); return; }   // PUT /api/chat-home/pins
    if (id === 'pin') { x.pinned = !x.pinned; window.RailConversation?.pin?.(x.title, x.pinned); draw(); say(x.pinned ? `${x.title} is a starter on Chat` : `${x.title} left Chat's starters`); return; }
    if (id === 'export') { exporting = true; draw(); page.querySelector('[data-confirm="yes"]')?.focus(); return; }
    if (id === 'delete') { confirm = { kind, x }; draw(); }
  }
  // Use as a template in the live kind (D16): POST /api/workflows with no id and the name "X copy", then open the copy
  function liveCopy(x, to) {
    LIVE().act('copy-workflow', { tpl: x.tpl, name: `${x.title} copy`, id: x.id }).then((a) => {
      if (!a.ok) { if (a.error !== 'busy') say(`Could not copy ${x.title}: ${a.error}`); return; }   // a second press while the copy runs says nothing
      const w = a.data?.workflow || {};
      LIVE().refresh('workflows').then(() => { window.RailShell.go(to(w.id)); say(`${w.name}: yours to change`); });
    });
  }
  function liveImport(file) {
    LIVE().importFile(file, { confirm: (n) => new Promise((resolve) => { importing = { name: file.name, n, resolve }; draw(); }) })
      .then((a) => { importing = null; draw(); if (a.text) say(a.text); });
  }
  function handNew() { const c = { id: `new-${Date.now() % 1e5}`, title: 'New workflow', own: true, domain: 'coding', what: 'Built by hand.', tasks: 0, merged: 0, from: 'Built by hand', fresh: true, steps: [], loops: [], draft: { steps: [['Plan', 'planner', 'Opus 5.5', 'high', 3, 0.30], ['Build', 'implementer', 'Sonnet 5.5', 'high', 9, 0.22]], loops: [], changes: 0 } }; src().workflow.push(c); window.RailShell.go(`workflows/edit:${c.id}`); }
  function wire(b, pg) {
    bar = b; page = pg;
    const way = (key, title, mark, n) => ({ key: `way:${key}`, _way: key, title, mark, end: n === '' ? '' : String(n), current: current === `~${key}` || (key === 'workflows' && (current === '' || current.startsWith('workflow:'))) || (kindOfWay[key] && current.startsWith(`${kindOfWay[key]}:`)), tip: `${title}${n === '' ? '' : ` · ${n}`}` });
    const lib = (kind, x) => ({ key: `lib:${kind}:${x.id}`, _lib: [kind, x], title: x.title, mark: markOf(kind), end: kind === 'agent' ? x.model : x.runtime, tip: `Adds ${x.title} after the step you picked` });
    const flow = ['AND: waits for all', 'OR: the first wins', 'Combine'].map((t) => ({ key: `lib:flow:${t}`, _lib: ['flow', { title: t.split(':')[0] }], title: t, mark: R.kindMark({ kind: 'workflow' }), tip: `${t}: say where it goes, in a chat` }));
    ctl = R.listController({ root: bar, spec: { noun: 'workflows', label: 'Selected', retry: () => LIVE()?.load(), view: () => ({ state: listNow(), parts: [],
      sections: current.startsWith('edit:') ? [{ id: 'lib-a', title: 'Agents · add to the canvas', rows: src().agent.map((x) => lib('agent', x)) }, { id: 'lib-s', title: 'Scripts', rows: src().script.map((x) => lib('script', x)) }, { id: 'lib-f', title: 'Flow · in a chat', rows: flow }]
        : [{ id: 'yours', title: 'Yours', noCount: true, rows: [way('workflows', 'All workflows', markOf('workflow'), savedCount()), way('agents', 'Agents', markOf('agent'), src().agent.length), way('scripts', 'Scripts', markOf('script'), src().script.length), ...(allDrafts().length ? [way('drafts', 'Drafts', R.kindMark({ kind: 'plugin', icon: 'file', advisory: true }), allDrafts().length)] : [])] },
          { id: 'browse', title: 'Browse', noCount: true, rows: [way('for-you', 'For you', R.kindMark({ kind: 'plugin', icon: 'whoYou' }), forYou().length), way('team', 'Your team’s', R.kindMark({ kind: 'group' }), teamOf().length), ...(window.RailShell?.locked('marketplace') ? [] : [way('market', 'Marketplace workflows', R.kindMark({ kind: 'plugin', icon: 'nav-marketplace' }), marketCount())])] },
          ] }),
      can: () => [], bulk: () => [], act: () => {}, word: () => false, say, active: () => /^#workflows/.test(location.hash),
      open: (r) => {
        if (r._lib) { const [kind, x] = r._lib; if (kind === 'flow') { window.RailConversation?.handOver({ about: { kind: 'Flow', name: `${x.title} in ${ed.wf.title}` }, ph: `Where should ${x.title} go in ${ed.wf.title}?` }); return; }
          if (src().workflow.find((w) => w.id === ed.id)?.chain === false) { say(`Could not add ${x.title}: ${BRANCHES}`); return; }   // D7
          const k0 = stepAt(ed.picked), at = k0 >= 0 ? k0 + 1 : ed.wf.steps.length, nid = isLive() ? LIVE().stepId(ed.id, ed.wf.steps) : `n${at}`;
          let name = x.title; for (let n = 2; ed.wf.steps.some((s) => s[0] === name); n += 1) name = `${x.title} ${n}`;   // loops name their steps: each name once
          edChange(() => { ed.wf.steps.splice(at, 0, [name, x.id, kind === 'agent' ? x.model : '', kind === 'agent' ? x.effort : '', 3, 0.15, ...(isLive() ? [undefined, undefined, undefined, nid] : [])]); ed.g = null; ed.picked = nid; }, `Added ${name} after ${ed.wf.steps[at - 1]?.[0] || 'the task'}`); return; }
        if (r._way === 'market') { window.RailShell.go('marketplace/~shelf-3-new'); return; }
        window.RailShell.go(r._way === 'workflows' ? 'workflows' : `workflows/~${r._way}`);
      } } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit;
      if ((hit = on('[data-wf-goto]'))) { window.RailShell.go(hit.dataset.wfGoto); return; }
      if (on('[data-wf-figs]')) { figs = !figs; draw(); return; }
      if (on('[data-wf-wide]')) { wide = !wide; draw(); return; }
      if ((hit = on('[data-wf-use]'))) { const x = src().workflow.find((w) => w.id === hit.dataset.wfUse); if (x) act('use', 'workflow', x); return; }
      if ((hit = on('[data-wf-chat]'))) { const { kind: k, x } = find(hit.dataset.wfChat); if (x) window.RailConversation?.handOver({ about: { kind: k.charAt(0).toUpperCase() + k.slice(1), name: x.title }, ph: `What should change in ${x.title}?` }); return; }
      if (on('[data-wf-ways]')) { waysOpen = !waysOpen; draw(); return; }
      if ((hit = on('[data-wf-edit]'))) { window.RailShell.go(`workflows/edit:${hit.dataset.wfEdit}`); return; }
      if (on('[data-wf-retry]')) { LIVE()?.load(); draw(); return; }
      if (importing && (hit = on('[data-wf-import] [data-confirm]'))) { const { resolve } = importing, yes = hit.dataset.confirm === 'yes'; importing = null; if (resolve) resolve(yes); else if (yes) say(window.RailWould('ask for a file to import')); draw(); return; }   // the demo's sample file says what the app does
      if ((hit = on('[data-wf-copy-edit]')) && LIVE()) { liveCopy(src().workflow.find((w) => w.id === hit.dataset.wfCopyEdit), (nid) => `workflows/edit:${nid}`); return; }
      if ((hit = on('[data-wf-copy-edit]'))) { const c = copyOf('workflow', src().workflow.find((w) => w.id === hit.dataset.wfCopyEdit)); window.RailShell.go(`workflows/edit:${c.id}`); say(`${c.title}: yours to change`); return; }
      if (current.startsWith('edit:') && ed) {
        if (on('[data-draft-discard]')) { const x = src().workflow.find((w) => w.id === ed.id); const was = ed, before = x.draft; if (x.fresh) { const i = src().workflow.indexOf(x); src().workflow.splice(i, 1); ed = null; window.RailShell.go('workflows'); say(`Discarded ${x.title}`, () => { src().workflow.splice(i, 0, x); ed = was; window.RailShell.go(`workflows/edit:${x.id}`); }); return; } if (LIVE()) LIVE().discard('workflow', ed.id); else delete x.draft; ed = null; draw(); say(`Discarded the draft of ${x.title}`, () => { x.draft = before; if (!ed || ed.id === x.id) ed = was; draw(); }); return; }
        if (on('[data-ed-back]')) { window.RailShell.go(`workflows/workflow:${ed.id}`); return; }
        if (on('[data-ed-undo]')) { const s = ed.past.pop(); if (s) { ed.next.push(snap()); Object.assign(ed, s); edDraft(); draw(); } return; }
        if (on('[data-ed-redo]')) { const s = ed.next.pop(); if (s) { ed.past.push(snap()); Object.assign(ed, s); edDraft(); draw(); } return; }
        if (on('[data-ed-align]')) { edChange(() => { ed.laid = true; ed.g = window.RailGraph.align(ed.g || window.RailGraph.build(ed.wf, (r) => SAYS[r] || '')); },'Aligned: every step in its place'); return; }
        if (on('[data-ed-fit]')) { ed.z = 0; draw(); return; }
        if ((hit = on('[data-ed-zoom]'))) { const z = Math.min(1, (ed.z || ed.fit) + 0.2 * +hit.dataset.edZoom); ed.z = z <= ed.fit ? 0 : z; draw(); return; }
        if (on('[data-ed-more]')) { edMore = !edMore; draw(); return; }   // remembered while you edit
        if (on('[data-ed-ask]')) { window.RailConversation?.handOver({ about: { kind: 'Workflow', name: ed.wf.title }, ph: `What should change in ${ed.wf.title}?` }); return; }
        if ((hit = on('[data-ed-try]'))) { window.RailConversation?.handOver({ mode: 'task', workflow: ed.wf.title, about: { kind: `Step ${ed.wf.steps[+hit.dataset.edTry][0]}`, name: ed.wf.title }, ph: `Which task should ${ed.wf.steps[+hit.dataset.edTry][0]} try?` }); return; }
        if (on('[data-ed-save], [data-draft-save]') && LIVE()) { const x = src().workflow.find((w) => w.id === ed.id); x.draft ||= blank('workflow', ed.wf); LIVE().save('workflow', ed.id).then((a) => { if (a.ok) ed = null; draw(); if (a.text) say(a.text); }); return; }   // D6: checked here, then POST /api/workflows
        if (on('[data-ed-save], [data-draft-save]')) { const x = src().workflow.find((w) => w.id === ed.id); x.draft ||= blank('workflow', ed.wf); saveDraft(x); ed.past = []; ed.next = []; ed.laid = false; draw(); say(`Saved ${x.title}`); return; }
        if ((hit = on('[data-ed-remove]'))) { const k = +hit.dataset.edRemove, name = ed.wf.steps[k][0];
          if (src().workflow.find((w) => w.id === ed.id)?.chain === false) { say(`Could not remove ${name}: ${BRANCHES}`); return; }   // D7
          edChange(() => { ed.wf.steps.splice(k, 1); ed.wf.loops = ed.wf.loops.filter((l) => l[0] !== name && l[1] !== name); ed.g = null; ed.picked = 'n_task'; }, `Removed ${name}`); return; }
        if ((hit = on('#wf-canvas-g [data-node-id]'))) { ed.picked = hit.dataset.nodeId; draw(); return; }
        if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
          if (id === 'ed-io' && LIVE()) { if (v === 'import') fileInput.click(); else LIVE().exportAs(ed.id, 'a JSON file').then((a) => say(a.text)); draw(); return; }   // D10, D11
          if (id === 'ed-io' && v === 'import') { importing = { name: 'Release checklist.json', n: 1 }; draw(); return; }   // the demo's sample file: it runs one script
          if (id === 'ed-io') { say(v === 'import' ? window.RailWould('ask for a file to import') : window.RailWould(`export ${ed.wf.title}`)); draw(); return; }
          const [, k, n] = id.split('-'), st = ed.wf.steps[+n];
          const was = { m: st[2], e: st[3], l: String(ed.wf.loops.find((l) => l[0] === st[0])?.[2]), t: st[6] || '30 min', s: st[7] || 'its own session', sa: st[8] || 'on' }[k]; if (v === was) { draw(); return; }   // the same value is no change
          edChange(() => { if (k === 'm') reprice(st, v, st[3]); else if (k === 'e') reprice(st, st[2], v); else if (k === 'l') ed.wf.loops.find((l) => l[0] === st[0])[2] = +v; else if (k === 't') st[6] = v; else if (k === 's') st[7] = v; else if (k === 'sa') st[8] = v; ed.g = null; }); return; }
        if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
        return;
      }
      const card = on('[data-wf-open]'); if (card && !on('button:not([data-wf-open])')) { window.RailShell.go(`workflows/${card.dataset.wfOpen}`); return; }
      const { kind, x } = current && !current.startsWith('~') ? find(current) : {};
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
        if (id === 'wf-sort') { sort = v; draw(); return; }
        if (id === 'wf-show') { show = v; draw(); return; }
        if (!x) return;
        if (id === 'wf-more') { act(v, kind, x); return; }
        if (id === 'wf-as') { x.as = v; draw(); return; }
        const n = +id.slice(4), cur = shown(x);
        const was = id.startsWith('wfm-') ? cur.steps[n][2] : id.startsWith('wfe-') ? cur.steps[n][3] : id.startsWith('wfl-') ? String(cur.loops[n][2]) : id === 'ag-model' ? cur.model : id === 'ag-effort' ? cur.effort : ''; if (v === was) { draw(); return; }   // the same value is no change
        touch(kind, x, (d) => { if (id.startsWith('wfm-')) reprice(d.steps[n], v, d.steps[n][3]); else if (id.startsWith('wfe-')) reprice(d.steps[n], d.steps[n][2], v); else if (id.startsWith('wfl-')) d.loops[n][2] = +v; else if (id === 'ag-model') d.model = v; else if (id === 'ag-effort') d.effort = v; });
        draw(); say(x.draft ? `${x.title}: kept as a draft; tasks still run the saved one` : `${x.title}: back to what is saved`); return;
      }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); return; }
      if (!x) return;
      if ((hit = on('[data-wf-sw]'))) { const k = hit.dataset.wfSw; touch(kind, x, (d) => { d[k] = !d[k]; }); draw(); say(x.draft ? `${x.title}: kept as a draft` : `${x.title}: back to what is saved`); return; }
      if (on('[data-draft-save]') && LIVE()) { LIVE().save(kind, x.id).then((a) => { draw(); if (a.text) say(a.text); }); return; }   // D6, D15
      if (on('[data-draft-save]')) { saveDraft(x); draw(); say(`Saved ${x.title}: tasks run it from now`); return; }
      if (on('[data-draft-discard]')) { const before = x.draft; if (x.fresh) { const l = src()[kind], i = l.indexOf(x); l.splice(i, 1); say(`Discarded ${x.title}`, () => { l.splice(i, 0, x); draw(); }); window.RailShell.go('workflows'); return; } if (LIVE()) LIVE().discard(kind, x.id); else delete x.draft; draw(); say(`Discarded the draft of ${x.title}`, () => { x.draft = before; draw(); }); return; }
      if ((hit = on('[data-wf-run]')) && LIVE()) { LIVE().runCases(x.id).then((a) => say(a.text === 'busy' ? `${x.title}: its cases are already running` : a.text)); return; }   // D12: dev's script bench
      if ((hit = on('[data-wf-run]'))) { say(window.RailWould(`run the ${x.cases} saved ${x.cases === 1 ? 'case' : 'cases'} of ${x.title}`)); return; }
      if ((hit = on('[data-confirm]'))) {
        if (exporting && LIVE()) { const dir = page.querySelector('[data-wf-export-dir]')?.value?.trim() || ''; exporting = false; draw(); if (hit.dataset.confirm === 'yes') LIVE().exportAs(x.id, x.as || 'a JSON file', { pluginDir: dir }).then((a) => say(a.text)); return; }   // D11
        if (exporting) { exporting = false; draw(); if (hit.dataset.confirm === 'yes') say(window.RailWould(`export ${x.title} as ${x.as || 'a JSON file'}`)); return; }
        if (hit.dataset.confirm === 'yes' && LIVE()) { confirm = null; const u = LIVE().deferDelete(kind, x.id, UNDO_MS); say(`Deleted ${x.title}`, () => { if (!u.undo()) say(`Too late to undo: ${x.title} is being deleted`); }); window.RailShell.go('workflows'); }   // D14: the module hides it and sends DELETE once the undo window closes
        else if (hit.dataset.confirm === 'yes') { const l = src()[kind], i = l.indexOf(x); l.splice(i, 1); confirm = null; say(`Deleted ${x.title}`, () => { l.splice(i, 0, x); draw(); }); window.RailShell.go('workflows'); } else { confirm = null; draw(); }
      }
    });
    if (!fileInput) { fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json', hidden: true });
      fileInput.setAttribute('data-wf-file', '');
      document.body.appendChild(fileInput);
      fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; fileInput.value = ''; if (f && LIVE()) liveImport(f); }); }   // D10
    page.addEventListener('input', (e) => { if (e.target.matches?.('[data-wf-export-dir]')) exportDir = e.target.value; });   // kept across a redraw
    page.addEventListener('change', (e) => {   // the canvas: rename the workflow or a step
      if (!here() || !ed || !current.startsWith('edit:')) return;
      const t = e.target, v = t.value?.trim();
      if (t.matches('[data-ed-name]')) { if (!v) { t.value = ed.wf.title; say(`Kept ${ed.wf.title}: a workflow needs a name`); return; } if (v === ed.wf.title) { t.value = v; return; } if (src().workflow.some((w) => w.id !== ed.id && w.title.toLowerCase() === v.toLowerCase())) { t.value = ed.wf.title; say(`Kept ${ed.wf.title}: another workflow is called ${v}`); return; } edChange(() => { ed.wf.title = v; }, `Renamed to ${v}`); return; }
      if (t.matches('[data-ed-step]')) { const st = ed.wf.steps[+t.dataset.edStep], old = st[0];
        if (!v) { t.value = old; say(`Kept ${old}: a step needs a name`); return; }
        if (v === old) { t.value = old; return; }
        if (ed.wf.steps.some((s) => s[0] === v)) { t.value = old; say(`Kept ${old}: another step is called ${v}`); return; }   // loops name their steps
        edChange(() => { st[0] = v; ed.wf.loops.forEach((l) => { if (l[0] === old) l[0] = v; if (l[1] === old) l[1] = v; }); ed.g = null; }, `Renamed to ${v}`); }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wide && here()) { wide = false; draw(); } });
    window.addEventListener('hashchange', () => { if (!here()) wide = false; });   // Expand belongs to the page you expanded on
    document.addEventListener('keydown', (e) => { if (e.key !== 'Escape' || !here() || menu || !(exporting || confirm)) return; exporting = false; confirm = null; draw(); }, true);   // capture: an open menu takes Esc first
    R.prefs?.onChange?.(() => { if (here()) draw(); });   // the mode decides the graph, the pickers and the canvas
  }
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.workflows = { records: () => src(), changed: () => { if (here()) draw(); }, names: () => src().workflow.filter((w) => !w.fresh).map((w) => ({ title: w.title, steps: w.steps.map((s) => s[0]) })), has: (a) => (isLive() && listNow() !== 'ready') || (a.startsWith('~') ? WAYS.includes(a.slice(1)) : !!find(a).x || /^(agent|script):/.test(a)),   // an unknown agent or script says so on the page, in its own noun
    // what an installed plugin brings: read as built-ins, gone when it is removed (the Marketplace calls this)
    plugin: (id, name, gives, on) => { for (const kind of ['agent', 'workflow']) { data[kind] = data[kind].filter((x) => x.plugin !== id); if (on) (gives?.[kind] || []).forEach((x) => { if (x.says) SAYS[x.id] = x.says; data[kind].push({ domain: 'coding', tasks: 0, merged: 0, loops: [], from: `From the plugin ${name}`, ...structuredClone(x), own: false, plugin: id }); }); } },
    search: (q) => Object.entries(src()).flatMap(([k, l]) => l.filter((x) => x.title.toLowerCase().includes(q)).map((x) => ({ label: x.title, where: `${k === 'workflow' ? 'Workflow' : k === 'agent' ? 'Agent' : 'Script'} · ${x.own ? 'yours' : 'built-in'}`, hash: `workflows/${k}:${x.id}` }))), sample: 'workflow:default', newLabel: 'Build workflow', newAct: () => window.RailConversation?.starter('workflow'), newMenu: () => (atLeast('expert') ? [{ header: 'Ask in chat' }, { id: 'bar-new|chat', text: 'Build a workflow' }, { sep: true }, { header: 'Legacy approach' }, { id: 'bar-new|hand', text: 'Build it by hand…' }] : [{ id: 'bar-new|chat', text: 'Build a workflow' }]), newPick: (id) => { if (id === 'hand') handNew(); else window.RailConversation?.starter('workflow'); },
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) { menu = ''; exporting = false; wide = false; if (confirm && `${confirm.kind}:${confirm.x.id}` !== arg) confirm = null; } current = arg || ''; draw(); } };
})();
