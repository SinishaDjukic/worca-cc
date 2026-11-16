// Projects on Stillhet (Wave 3, 3.1): dev's functions, Stillhet's design. The list in the one bar (its filters, one-line
// rows, a project's state on its mark); a project's page as a PlaceHead, then its parts as tabs (classic's project tabs):
// Overview, Tasks, Memory, Sets, Actions, Automations, Readiness, Settings. No composer here: Ask about it in chat hands
// the project to Chat. Adding a project is a conversation (Chat's Add project card), so the bar's + arms it there.
(function () {
  const R = window.StillhetUI;
  const esc = R.esc;   // the library's: it escapes the double quote too
  const say = (t, undo) => window.StillhetPulse?.say(t, undo);
  // dev's origin states (branch-sync), each with its words, how it stands and its one way on
  const ORIGIN = {
    ok: { word: 'Up to date', tone: 'idle', short: '' },
    behind: { word: 'Your copy is older', why2: (p) => `${p.behind} behind ${p.base}; new tasks start from origin`, tone: 'idle', short: () => '', quiet: true, act: 'Sync', why: 'Fast-forwards to the remote; nothing of yours is touched' },
    diverged: { word: 'Out of sync', why2: (p) => `${p.ahead} ahead, ${p.behind} behind ${p.base} · the next task asks how to bring them together`, tone: 'ask', short: 'Out of sync', act: 'Bring together…', why: 'Asks Worca in a chat how to bring both sides together' },
    offline: { word: "Can't reach origin", tone: 'fail', short: 'Offline', act: 'Retry', why: 'Fetches again' },
    uncommitted: { word: 'Uncommitted changes', tone: 'act', short: 'Uncommitted' },
    local: { word: 'Only on this computer', why2: () => 'Worca works here; nothing leaves it until you link a repository', tone: 'idle', short: '', quiet: true, act: 'Link a repository…', why: 'Adds the repository as origin; nothing is pushed' },
    folder: { word: 'No git', tone: 'idle', short: '', act: 'Use git', why: 'Runs git init; the first task commits what is there' },
    missing: { word: 'Folder missing', tone: 'fail', short: 'Folder missing', act: 'Locate folder…', why: 'Tell Worca where it moved; or remove it from the menu' },
    reading: { word: '', tone: 'idle', short: '' },   // F-6-19: the early record, drawn before its sync is read: no word, no action
  };
  // the live kind (D9): the store's projects, read on every read; the demo's seed otherwise
  const W = window.StillhetWorld;
  const nameOf = (p) => p.name || p.id;   // live: dev's name (the id is its key); the demo's id is its name
  const keyName = (id) => nameOf(data.projects.find((p) => p.id === id) || { id });   // F-G-G5-06: a project named by its key (a workspace link) reads its name
  // the live kind (slice 9 D4): every write runs its live branch first, through the live module; the demo branch is unchanged
  const isLive = () => window.StillhetAdapter?.kind === 'live';
  const LIVE = () => (isLive() ? window.StillhetProjectsLive || null : null);
  const busyOf = (id) => LIVE()?.pending(id) || '';   // what dev is doing for it now (D22): its control says so, disabled
  const said = (a) => { if (a?.text) say(a.text); draw(); };
  const UNDO_MS = 5000;   // the toast's undo window (pulse.js): Remove waits for it (D10)
  // live: one lasting object per project, so what the page holds (a half-typed field) survives the store reading it again
  const PAGE_KEYS = new Set(['editing', 'defErr', 'defTyped']), views = new Map();
  const viewOf = (p) => { const v = views.get(p.id) || {}; for (const k of Object.keys(v)) if (!PAGE_KEYS.has(k)) delete v[k]; views.set(p.id, Object.assign(v, p)); return v; };
  let seeded;
  const data = { get projects() { return W?.live ? (W.part('projects') || []).filter((p) => !LIVE()?.hidden().has(p.id)).map(viewOf) : seeded; }, set projects(v) { seeded = v; } };
  // D18: the store's load state, live; ?state=… in the demo
  const listNow = () => { const st = window.StillhetDemoState?.list; return st === 'loading' || st === 'failed' ? st : 'ready'; };
  const notRead = (d) => (d.status === 'failed' ? 'Could not read its settings; open the page again to retry' : 'Reading its settings…');
  // a project page's own settings and defaults, live (D16): read on open, merged into its lasting object
  function withDetail(p) {
    const d = LIVE()?.detail(p.id); if (!d) return p;
    // only settings read from dev may be written back: a PUT built from a page still loading would wipe its cost tags
    const ready = d.status === 'ready';
    Object.assign(p, { tags: d.tags || [], labels: d.labels || [], teamMemory: !!d.teamMemory, saving: busyOf(`${p.id}#defaults`), off: ready ? '' : notRead(d),
      persist: ready ? (next, msg) => LIVE().saveDefaults(p.id, next).then((a) => { say(a.ok ? msg : a.text); draw(); }) : undefined });
    return p;
  }
  data.projects = [
    { id: 'billing-api', tags: ['cost-center: 4410'], labels: ['payments'], kind: 'Git', path: '~/src/billing-api', branch: 'main', base: 'origin/main', origin: 'behind', behind: 3, checked: '1 min ago', teamMemory: true,
      // B4.5: its facts in projects-map.mjs's shapes (readinessOf, metricsOf, policyOf), as the live kind maps dev's answers
      readiness: { level: 'partial', word: 'Partly ready', mustFix: 2, shouldFix: 3, passed: 4, applicable: 9, tools: [{ name: 'Claude Code', word: 'Ready' }, { name: 'OpenAI Codex', word: 'Partly ready' }], notJudged: ['Gemini CLI'],
        failing: { must: [{ title: 'Has a README', fix: 'Add a README.md that says how to run it' }, { title: 'Has a test command', fix: 'Add a test script to package.json' }], should: [{ title: 'Has a lockfile', fix: 'Commit package-lock.json' }, { title: 'Ignores build output', fix: 'Add dist/ to .gitignore' }, { title: 'Has a contributing guide', fix: 'Add CONTRIBUTING.md' }], advice: [{ title: 'Has an editor config', fix: '' }] }, checkedAt: null },
      metrics: { state: 'on', word: 'on · 12 tasks', scope: 'this project', lastPush: new Date(Date.now() - 2 * 3600e3).toISOString() },
      policy: { state: 'follows', word: 'follows acme/gateway', scope: 'acme/gateway', updatedAt: null } },
    { id: 'worca-cc', kind: 'Git', path: '~/src/worca-cc', branch: 'dev', base: 'origin/dev', origin: 'ok', checked: '1 min ago' },
    { id: 'web-app', kind: 'Git', path: '~/src/web-app', branch: 'develop', base: 'origin/develop', origin: 'diverged', ahead: 2, behind: 3, checked: '1 min ago',
      readiness: { level: 'ready', word: 'Agent-ready', mustFix: 0, shouldFix: 0, passed: 9, applicable: 9, tools: [{ name: 'Claude Code', word: 'Ready' }], notJudged: [], failing: { must: [], should: [], advice: [] }, checkedAt: null },
      metrics: { state: 'off', word: 'off', scope: '', lastPush: null }, policy: { state: 'home', word: 'home', scope: 'acme/policy', updatedAt: null } },
    { id: 'docs-site', kind: 'Folder', path: '~/Projects/docs-site', origin: 'folder', files: 214, ownedFolder: true },
    { id: 'payments-api', kind: 'Git', path: '~/src/payments-api', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'design-kit', kind: 'Git', path: '~/src/design-kit', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'email-service', kind: 'Git', path: '~/src/email-service', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'ingest-gateway', kind: 'Git', path: '~/src/ingest-gateway', branch: 'main', base: 'origin/main', origin: 'diverged', ahead: 1, behind: 2, checked: '1 min ago' },
    { id: 'device-registry', kind: 'Git', path: '~/src/device-registry', branch: 'main', base: 'origin/main', origin: 'behind', behind: 1, checked: '1 min ago' },
    { id: 'telemetry-db', kind: 'Git', path: '~/src/telemetry-db', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'ops-dashboard', kind: 'Git', path: '~/src/ops-dashboard', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'firmware-sdk', kind: 'Git', path: '~/src/firmware-sdk', branch: 'main', origin: 'local' },
    { id: 'legacy-billing', kind: 'Git', path: '~/old/legacy-billing', branch: 'main', base: 'origin/main', origin: 'missing', checked: '3 days ago' },
  ];
  // its own settings: each a sentence whose value is yours (Settings) until the project changes it
  const SETS = [
    { id: 'pr', name: 'Pull requests', words: 'When a task finishes', items: ['create a PR ready for review', 'create a draft PR', 'open no PR'], def: 'create a PR ready for review' },
    { id: 'engine', name: 'Engine', words: 'Its tasks run on', items: ['Claude Code', 'Codex', 'Gemini CLI'], def: 'Claude Code' },
    { id: 'cap', name: 'Cost', words: 'A task pauses at', items: ['$20', '$50', '$100', 'no cap'], def: '$50' },
    { id: 'branch', name: 'Branch names', words: 'New branches are named', items: ['{type}/{slug}', '{ticket}-{slug}', 'worca/{id}'], def: '{type}/{slug}' },
    { id: 'memory', name: 'Memory', words: 'Its tasks read', items: ['its own notes', 'its own and the team\'s notes', 'the team\'s notes'], def: 'its own notes' },
    { id: 'setup', name: 'Your setup', words: 'Its tasks load your Claude Code setup:', items: ['on', 'off'], def: 'on' },
    // classic's per-project settings, on the demo's data until the live layer reads them (demoOnly)
    { id: 'stepModel', name: 'Step models', words: 'Its steps run on', items: ['your models', 'Opus 5.5 for every step', 'Sonnet 5.5 for every step'], def: 'your models', demoOnly: true },
    { id: 'helper', name: 'Helper model', words: 'Titles, names and PR text use', items: ['your helper model', 'Haiku 5.5', 'Sonnet 5.5'], def: 'your helper model', demoOnly: true },
    { id: 'turns', name: 'Chat turn limit', words: 'A chat here stops to ask after', items: ['25 turns', '50 turns', '100 turns', 'no limit'], def: '50 turns', demoOnly: true },
    { id: 'context', name: 'Context size', words: 'Its tasks use', items: ['the standard context', 'the large context'], def: 'the standard context', demoOnly: true },
    { id: 'skills', name: 'Skill delivery', words: 'Skills reach its tasks', items: ['from your setup', 'as files in the project', 'not at all'], def: 'from your setup', demoOnly: true },
  ];
  // team memory decides which notes there are: on, its tasks read both unless you say otherwise; off, the team's are not offered
  const TEAM_NOTES = ['its own and the team\'s notes', 'the team\'s notes'], defOf = (p, x) => (x.id === 'memory' && p.teamMemory ? TEAM_NOTES[0] : x.def);
  const view = { show: 'all', by: 'workspace' }, showAll = new Set();   // a workspace in Needs you lists its trouble first; its other projects are one click away
  const pid = () => current.split('@')[0];   // the address may say through which workspace: billing-api@legacy
  const firstHome = (id) => window.StillhetSpaces?.list().find((w) => w.projects.some(([p]) => p === id))?.id;
  let away = false, notFoundSoon = false, bellHeard = -1, drawn = '', current = '', menu = '', confirm = null, ctl = null, bar = null, page = null, form = '', formTyped = '', formErr = '', locating = '', formAt = '';   // formAt: the route arg the open form belongs to
  const NAME_MAX = 80, TAG_MAX = 40;   // form.name-limit; small.label-short
  // what Worca can go and look at: a full path, or (adding) a repository's address; nothing else leaves this form
  const pathWrong = (v, repo) => (/[<>"`|*?\x00-\x1f]/.test(v) ? 'A path has no < > " ` | * or ?' : (repo && /^(https?:\/\/|ssh:\/\/|git@)\S+$/.test(v)) || /^~?(\/[^/]+)+\/?$/.test(v) ? '' : `Give its full path, such as ~/src/your-project${repo ? ', or a repository address' : ''}`);
  const ADVANCED_SETS = ['branch', 'memory', 'setup'];   // patterns, the team's notes and your Claude Code setup start at Advanced
  const newTaskItem = (p) => ({ id: 'task', text: 'New task here', ...(p.origin === 'missing' ? { off: true, help: 'Its folder is missing: locate it first' } : { help: 'The composer, on this project' }) });
  const fetchItem = (p) => ({ id: 'fetch', text: busyOf(p.id) === 'Checking…' ? 'Checking…' : 'Check origin now', help: noOrigin(p) || 'Fetches; moves nothing', off: !!noOrigin(p) || !!busyOf(p.id) });
  const tasksItem = { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' };
  const renameItem = { id: 'rename', text: 'Rename…', help: 'Its name in Worca; its folder and its tasks stay' };   // form.rename-project
  const o = (p) => ORIGIN[p.origin];
  const wordOf = (p) => (typeof o(p).word === 'function' ? o(p).word(p) : o(p).word);
  const shortOf = (p) => (typeof o(p).short === 'function' ? o(p).short(p) : o(p).short);
  const tasksOf = (id) => (window.StillhetChats?.data().chats || []).filter((c) => c.project === id).flatMap((c) => (c.tasks || []).filter((t) => t.kind !== 'schedule').map((t) => ({ t, c })));
  const toneOfTask = (t) => R.markTone(R.runState(window.RunCardModel.stateOf(t.case)));
  const inTasksNeeds = (id, t) => (window.StillhetWorld?.tops() || []).some((x) => !x.archived && x.section === 'needs' && x.project === id && x.id === t.id);   // by id: a feature in Needs can share a stopped run's title (F-W3a2-06)
  const waitingOn = (id, t) => ['ask', 'act'].includes(toneOfTask(t)) || inTasksNeeds(id, t);   // the same rows as Tasks' Needs you: an approved task ready to merge waits on you too
  const asking = (p) => tasksOf(nameOf(p)).filter(({ t }) => waitingOn(nameOf(p), t)).sort((a, b) => R.alertLevel(toneOfTask(b.t)) - R.alertLevel(toneOfTask(a.t)));   // the tasks here waiting on you, highest level first (look.alert-ladder)
  // F-6-15, V3-12: what waits on you here, each once (by title): its chats' asks and the Tasks list's Needs rows of this
  // project, highest level first. The head counts these and the on-it list shows them first; the bar row says the same count (F-W3a2-06)
  function waitsOf(p) {
    if (p.early) return [];   // F-6-19: the store has not loaded its tasks yet
    const chat = asking(p).map(({ t, c }) => ({ title: t.title, detail: t.detail, stage: t.stage, tone: toneOfTask(t), state: stateIdOf(t), open: { 'data-pj-open': `${c.id}|${t.title}` } }));
    const said = new Set(chat.map((x) => x.title));
    const listed = standing(p).tasks.filter((t) => !said.has(t.title)).map((t) => { const id = C().stateOf(t); return { title: t.title, detail: t.detail, stage: t.stage, tone: R.markTone(R.runState(id)), state: id, open: { 'data-c-open': t.id }, tip: `Opens ${t.title}` /* no chat here: its card or its task page */ }; });
    return [...chat, ...listed].sort((a, b) => R.alertLevel(b.tone) - R.alertLevel(a.tone));
  }
  // ---- how a project stands: one answer for its card, its bar row and the bell (panel.center-shelf) ----
  const C = () => window.StillhetCenters, List = () => window.StillhetRunsList, Sch = () => window.StillhetSchedules;
  const link = (label, hook, tip) => R.textLink({ label, attrs: { ...hook, title: tip || null } });
  const inCenter = () => !!(C() && List()?.rows && Sch()?.all);
  function standing(p) {
    const rows = inCenter() ? List().rows().filter((t) => t.project === nameOf(p)) : [], c = (sec) => rows.filter((t) => t.section === sec), scheds = inCenter() ? Sch().all().filter((s) => s.project === nameOf(p)) : [];
    const tasks = c('needs').map(C()?.taskOf || (() => null)).filter(Boolean).sort((a, b) => R.taskRank(C().stateOf(a)) - R.taskRank(C().stateOf(b)));
    const missed = scheds.filter((s) => s.section === 'needs'), running = c('running'), waiting = c('scheduled'), live = scheds.filter((s) => Sch().running(s.id));
    const top = tasks[0], stopped = o(p).tone === 'fail', split = p.origin === 'diverged';
    const originBtn = (kind) => R.button({ label: o(p).act, kind, attrs: { 'data-pj-home-act': p.id, title: o(p).why } });
    const verb = stopped || (!top && split) ? (o(p).act || 'Open').replace(/…$/, '') : top ? R.cardAction(C().stateOf(top)).label : missed.length ? 'Run now' : 'Open';   // what its other workspace says: Answer there
    const base = { p, tasks, missed, running, waiting, live, verb };
    if (stopped) return { ...base, word: wordOf(p), tone: 'fail', kind: 'project', rank: 0, what: p.origin === 'missing' ? `${esc(p.path)} is gone; nothing can start here until it is back` : `Worca can't reach ${esc(p.base || 'origin')}`, action: originBtn('primary') };
    if (top) { const id = C().stateOf(top), tone = R.markTone(R.runState(id)); return { ...base, word: R.needsReason(id), tone, kind: 'task', rank: R.taskRank(id), what: `${tasks.slice(0, 2).map(C().clause).join('; ')}${split ? '; its branch is also out of sync' : ''}`, action: C().actionsOf(tasks.slice(0, 2)) }; }
    if (split) return { ...base, word: wordOf(p), tone: 'ask', kind: 'project', rank: 2.3, what: 'Your branch and origin have both moved; the next task asks how to bring them together', action: originBtn('') };
    if (missed.length) return { ...base, word: 'Schedule missed', tone: 'act', kind: 'schedule', rank: 2.5, what: missed.map((s) => `${C().schedLink(s)} missed ${esc(s.missed)} while ${esc(s.missedWhy)}`).join('; '), action: R.button({ label: 'Run now', attrs: { 'data-c-sact': `run|${missed[0].id}`, 'aria-label': `Run now: ${missed[0].title}`, title: `Runs ${missed[0].title} now to catch up` } }) };
    if (running.length || live.length) { const named = [...running.map(C().taskOf).filter(Boolean).map((t) => link(t.title, { 'data-c-open': t.id }, `Opens ${t.title} in its chat`)), ...live.filter((s) => !running.some((t) => C().taskOf(t)?.title === s.title)).map((s) => C().schedLink(s))], shown = named.slice(0, 2), more = named.length - shown.length; return { ...base, word: R.runState('working').word, tone: 'run', kind: 'task', rank: 5, what: `${shown.join(' and ')}${more ? ` and ${more} more` : ''} ${named.length === 1 ? 'is' : 'are'} running`, action: openBtn(p), sentenceRuns: true }; }
    if (p.origin === 'behind') return { ...base, word: wordOf(p), tone: 'idle', kind: 'project', rank: 4, what: 'New tasks start from origin; syncing touches nothing of yours', action: originBtn('quiet') };
    return { ...base, word: '', tone: 'idle', kind: 'project', rank: 9, what: 'Nothing is going on here.', action: openBtn(p), quiet: true };
  }
  const openBtn = (p) => R.button({ label: 'Open', attrs: { 'data-pj-go': p.id, title: `Opens ${nameOf(p)}` } });
  const litTone = (t) => ['fail', 'ask', 'act'].includes(t) || t === 'ok';   // Advisory counts under Needs you too (look.alert-ladder)
  const standsOut = (s) => litTone(s.tone);
  const markOf = (s, size) => R.kindMark({ kind: s.kind, tone: s.tone, advisory: s.tone === 'ok', breathe: standsOut(s), size, title: s.word || undefined });
  const needs = (p) => standsOut(standing(p)) || (inCenter() && standing(p).tasks.length > 0);
  const endOf = (p) => { const s = standing(p), k = waitsOf(p).length; return k && !['fail'].includes(o(p).tone) ? `${k} ${k === 1 ? 'task needs you' : 'tasks need you'}` : standsOut(s) ? s.word : shortOf(p); };   // "question" is a workspace's: a link Worca is unsure of
  const SHOWS = [{ id: 'all', text: 'all', test: () => true }, { id: 'needs', text: 'needs you', test: (p) => ownNeed(p) }, { id: 'behind', text: 'out of sync', test: (p) => p.origin === 'diverged' }, { id: 'folder', text: 'without git', test: (p) => p.kind === 'Folder' }];
  const stateIdOf = (t) => window.RunCardModel.stateOf(t.case);
  const markTone = (p) => { const w = waitsOf(p); return o(p).tone === 'fail' || !w.length ? o(p).tone : ['ask', 'act'].includes(w[0].tone) ? 'ask' : w[0].tone; };
  const mark = (p, size) => R.kindMark({ kind: 'project', tone: markTone(p), advisory: markTone(p) === 'ok', size, title: wordOf(p) });
  const rowOf = (p) => ({ key: `proj:${p.id}`, _p: p, title: nameOf(p), mark: standsOut(standing(p)) ? markOf(standing(p)) : mark(p), end: endOf(p), current: p.id === pid() && !(adv() && window.StillhetSpaces?.member(p.id)), tip: `${nameOf(p)}\n${p.kind} · ${p.path}\n${wordOf(p)}`,
    menu: [...actItem(p), newTaskItem(p), { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' }, fetchItem(p), renameItem, { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: removeHelp(p) }] });
  const removeHelp = (p) => (p.ownedFolder ? 'Worca forgets it and deletes the folder it made; its tasks stay' : 'Worca forgets it; its folder and tasks stay');
  function actItem(p) { return o(p).act ? [{ id: 'act', text: busyOf(p.id) || o(p).act, help: o(p).why, off: !!busyOf(p.id) }] : []; }
  // what there is to fetch from: why not, when there is nothing
  const noOrigin = (p) => (p.origin === 'missing' ? 'Its folder is missing: nothing to check' : p.kind === 'Folder' ? 'It has no git: nothing to check' : p.origin === 'local' ? 'No origin linked yet: nothing to check' : '');
  // what Tasks lists for this project: the very rows of that list; the demo reads the one fact Insights reads too (build.one-mock)
  const monthOf = (name) => (isLive() ? null : window.StillhetInsightsModel?.projectMonth?.(name) || null);
  const taskCount = (id) => monthOf(id)?.tasks ?? (window.StillhetRunsList?.rows() || []).filter((t) => t.project === id).length;

  function act(id, rows) {
    const p = rows[0]?._p; if (!p) return;
    if (id === 'act') return originAct(p);
    if (id === 'task') { window.StillhetConversation?.handOver({ mode: 'task', project: p.id, ref: { pageProjectKey: p.id }, about: { kind: 'Project', name: nameOf(p) } }); return; }
    if (id === 'tasks') { window.StillhetRunsList.filter({ project: nameOf(p) }); return; }
    if (id === 'fetch') { if (LIVE()) { LIVE().origin(p.id, 'fetch').then(said); draw(); return; } p.checked = 'just now'; draw(); say(`Checked ${p.base || p.id}`); return; }
    if (id === 'rename' || id === 'remote') { openForm(id === 'rename' ? 'rename' : 'link', p, id === 'rename' ? nameOf(p) : ''); return; }
    if (id === 'remove') { current = p.id; confirm = { what: 'remove', p }; window.StillhetShell.go(`projects/${p.id}`); }
  }
  // a page form under the head (Locate folder, Rename, Link a remote): one field, its own words (form.rename-project, form.link-remote)
  function openForm(kind, p, typed) { confirm = null; form = kind; locating = p.id; formAt = p.id; formTyped = typed; formErr = ''; if (pid() !== p.id) window.StillhetShell.go(`projects/${p.id}`); else draw(); setTimeout(() => { page?.querySelector('#pj-hand-v')?.select(); }, 60); }
  const ORIGIN_LIVE = { behind: 'sync', offline: 'fetch', folder: 'git' };   // D6: dev's sync and git-init routes
  function originAct(p) {
    if (busyOf(p.id)) return;
    if (LIVE() && ORIGIN_LIVE[p.origin]) { LIVE().origin(p.id, ORIGIN_LIVE[p.origin]).then(said); draw(); return; }
    if (p.origin === 'behind') { const n = p.behind; Object.assign(p, { origin: 'ok', behind: 0, checked: 'just now' }); draw(); say(`Synced ${p.id}: ${n} ${n === 1 ? 'commit' : 'commits'} from ${p.base}`); return; }
    if (p.origin === 'diverged') { window.StillhetConversation?.handOver({ project: p.id, ref: { pageProjectKey: p.id }, about: { kind: 'Project', name: nameOf(p) }, text: `It has diverged from ${p.base}: ${p.ahead} ahead, ${p.behind} behind. How should we bring them together?` }); return; }
    if (p.origin === 'local') { openForm('link', p, ''); return; }   // form.link-remote: its repository address first
    if (p.origin === 'offline') { p.origin = 'ok'; p.checked = 'just now'; draw(); say(`Reached ${p.base}`); return; }
    if (p.origin === 'folder') { Object.assign(p, { kind: 'Git', origin: 'local', branch: 'main' }); draw(); say(`${p.id} uses git now; the first task commits what is there`); return; }
    if (p.origin === 'missing') openForm('locate', p, p.path);
  }

  // Every new task here gets (rail: default labels and cost tags): a project's own and each workspace's. Labels add up; a cost tag has one value: the project's own wins, two workspaces that differ make the task's composer ask
  const defaultsRows = (owner, from) => { const tagKey = (t) => t.split(':')[0].trim(), own = owner.tags || [], ownL = owner.labels || [], got = from.flatMap((w) => (w.tags || []).filter((t) => !own.some((o) => tagKey(o) === tagKey(t))).map((t) => [t, w])), keys = got.map(([t]) => tagKey(t)), clash = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i && got[i] && got[keys.indexOf(k)][0] !== got[i][0]))];
    const labels = [...new Set([...from.flatMap((w) => w.labels || []), ...ownL])], tags = [...own, ...[...new Map(got.filter(([t]) => !clash.includes(tagKey(t))).map(([t]) => [t, t])).keys()]];
    const row = (name, kind, list, field) => R.settingsRow({ name, sentence: owner.editing === field ? R.field({ id: `def-${field}`, label: name, quietLabel: true, value: owner.defTyped ?? (field === 'tags' ? own : ownL).join(', '), error: owner.defErr || '', placeholder: field === 'tags' ? 'team: web, cost-center: 4410' : 'hotfix, billing', attrs: { 'data-def-input': field } }) : list.length ? list.map((text) => R.chip({ text, title: text })).join(' ') : '<span class="set-from">None</span>', end: owner.saving ? R.button({ label: owner.saving, kind: 'quiet', attrs: { disabled: true } }) : owner.off ? R.tooltip({ text: owner.off, off: true, html: R.button({ label: 'Change', kind: 'quiet', attrs: { disabled: true } }) }) : R.button({ label: owner.editing === field ? 'Done' : 'Change', kind: 'quiet', attrs: { 'data-def-edit': field } }) });
    return R.settingsSection({ title: 'Every new task here gets', meta: 'A task can change its own.', rows: row('Cost tags', 'tag', tags, 'tags') + row('Labels', 'label', labels, 'labels') + (clash.length ? R.settingsRow({ name: 'Who pays', note: `${esc(from.map((w) => w.title).join(' and '))} name different ${clash.map(esc).join(', ')}s.`, end: clash.map((k, i) => R.rowPicker({ id: `pj-pay-${i}`, label: 'Charge new tasks to', text: 'each task asks', tip: 'Who pays', items: [{ id: 'ask', text: 'each task asks', checked: true }, ...[...new Set(got.filter(([t]) => tagKey(t) === k).map(([t]) => t))].map((t) => ({ id: t, text: t, ...(owner.off ? { off: true, help: owner.off } : {}) }))], open: menu === `pj-pay-${i}`, chevron: R.icon('chevron', 12) })).join('') }) : '') }); };
  const defaults = (owner, from) => defaultsRows(owner, from);
  // what was typed: no repeats, and a cost tag has one value, so a key given twice keeps its last
  const tidyTag = (t) => t.split(':').map((x) => x.trim()).join(': ');   // "team:web" and "team: web" are one value
  const defaultsParse = (f, v) => { const l = [...new Set(v.split(',').map((x) => (f === 'tags' ? tidyTag(x) : x.trim())).filter(Boolean))]; return f === 'tags' ? [...new Map(l.map((t) => [t.split(':')[0].trim(), t])).values()] : l; };
  // what a cost tag or label may be: small.label-short, and a cost tag is key: value
  const defaultsWrong = (f, l) => { const bad = l.find((t) => /[<>]/.test(t)); if (bad) return 'No < or > in it'; const long = l.find((t) => t.length > TAG_MAX); if (long) return `${f === 'tags' ? 'A cost tag' : 'A label'} holds ${TAG_MAX} characters; "${long.slice(0, 12)}…" has ${long.length}`; const odd = f === 'tags' && l.find((t) => !/^[^:]+: [^:]+$/.test(t)); return odd ? `A cost tag is key: value, such as team: web; "${odd}" is not` : ''; };
  const defaultsClick = (e, owner, repaint) => { const hit = e.target.closest('[data-def-edit]'); if (!hit) return false; if (owner.off) return true; /* not read from dev yet: nothing to change */ const f = hit.dataset.defEdit, closing = owner.editing === f; if (closing) { const typed0 = document.getElementById(`def-${f}`)?.value || '', list0 = typed0.split(',').map((x) => (f === 'tags' ? tidyTag(x) : x.trim())).filter(Boolean), wrong = defaultsWrong(f, list0); if (wrong) { owner.defErr = wrong; owner.defTyped = typed0; repaint(); document.getElementById(`def-${f}`)?.focus(); return true; } delete owner.defErr; delete owner.defTyped; const typed = typed0, v = defaultsParse(f, typed), was = [...(owner[f] || [])].sort().join(', '), oneValue = f === 'tags' && v.length < new Set(typed.split(',').map(tidyTag).filter(Boolean)).size; if (owner.persist) { owner.editing = ''; if ([...v].sort().join(', ') !== was) owner.persist({ tags: owner.tags || [], labels: owner.labels || [], [f]: v }, !v.length ? `No ${f === 'tags' ? 'cost tags' : 'labels'} of its own now` : oneValue ? `A cost tag has one value: kept ${v.join(', ')}` : 'Kept for every new task here'); repaint(); return true; } owner[f] = v; owner.editing = ''; if ([...v].sort().join(', ') !== was) say(!v.length ? `No ${f === 'tags' ? 'cost tags' : 'labels'} of its own now` : oneValue ? `A cost tag has one value: kept ${v.join(', ')}` : 'Kept for every new task here'); } else { delete owner.defErr; delete owner.defTyped; owner.editing = f; } repaint(); if (!closing) document.getElementById(`def-${f}`)?.focus(); return true; };
  const defaultsKey = (e, owner, repaint) => { const f = e.target.dataset?.defInput; if (!f || owner.editing !== f || !['Enter', 'Escape'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const done = () => e.currentTarget?.querySelector?.(`[data-def-edit="${f}"]`); if (e.key === 'Enter') { done()?.click(); return; } const root = e.currentTarget; owner.editing = ''; delete owner.defErr; delete owner.defTyped; repaint(); root?.querySelector?.(`[data-def-edit="${f}"]`)?.focus(); };
  // a page form: its sentence, its one field and its yes (form.rename-project, form.link-remote; Locate folder is the design's)
  const PAGE_FORMS = {
    locate: { text: (p) => `Where is ${nameOf(p)} now?`, label: 'Its folder', ph: '~/src/your-project', yes: 'Use this folder', max: 200 },
    rename: { text: (p) => `What should ${nameOf(p)} be called?`, label: 'Its name', ph: 'billing-api', yes: 'Rename', max: NAME_MAX },
    link: { text: (p) => `Where is the repository of ${nameOf(p)}?`, label: 'Its repository address', ph: 'git@github.com:you/your-project.git', yes: 'Link', max: 200 },
  };
  // ---- B4.5 (F-6-15): how a project stands, read-only: readiness, team metrics and policy, its last run and its ended tasks ----
  // the facts in live/projects-map.mjs's shapes: live, the live module's reads (each page open); the demo's seed otherwise.
  // This is a classic script and cannot import that module in the demo kind, so the three small words below
  // (readinessLine, timeWord, endsOf there) are said here the same way.
  const known = (value) => ({ status: 'ready', value });
  const pageFacts = (p) => LIVE()?.facts(p.id) || { readiness: known(readinessDemo(p)), metrics: known(p.metrics || null), policy: known(p.policy || null) };
  const readyLine = (r) => { const n = [r.mustFix && `${r.mustFix} must fix`, r.shouldFix && `${r.shouldFix} should fix`].filter(Boolean); return `${r.word} · ${n.length ? n.join(', ') : `${r.passed} of ${r.applicable} checks pass`}`; };
  const agoWord = (iso) => { const t = Date.parse(String(iso || '')); if (!Number.isFinite(t)) return ''; const min = Math.floor(Math.max(0, Date.now() - t) / 60000), h = Math.floor(min / 60), d = Math.floor(h / 24); return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : h < 24 ? `${h} h ago` : `${d} ${d === 1 ? 'day' : 'days'} ago`; };
  const ENDS = { done: ['ready', 'approved', 'merged', 'kept', 'labelled', 'noproject'], stopped: ['stopped', 'discarded'], failed: ['failed'] };
  // a fact's sentence: reading, could not read (no codes), or what `say` makes of its value
  const factSays = (f, what, sayIt) => (f.status === 'loading' ? 'Reading…' : f.status === 'failed' ? `Could not read its ${what}; open the page again to retry` : sayIt(f.value));
  // the store's tasks of this project, in store order: live tasks first, then dev's history newest first (live-map.mjs
  // snapshotOf); a schedule's own ticket and a time still to come never ran
  const ranHere = (p) => (p.early ? [] : (W?.tops() || []).filter((t) => t.project === nameOf(p) && !t.archived && !t.scheduleId && t.day !== 'upcoming'));
  function standsPart(p) {
    const f = pageFacts(p), r = f.readiness.value, report = f.readiness.status === 'ready' && !!r?.level;
    const ready = p.origin === 'missing' || (f.readiness.status === 'ready' && r?.off) ? '' : R.settingsRow({ name: 'Readiness', sentence: esc(factSays(f.readiness, 'readiness', (v) => (v?.level ? readyLine(v) : 'Not judged yet'))), end: R.button({ label: report ? 'See the checks' : 'Open', attrs: { 'data-pj-tab': 'readiness', title: 'Opens the Readiness tab' } }) });
    const ran = ranHere(p), last = ran[0], ends = { done: 0, stopped: 0, failed: 0 };
    for (const t of ran) { const id = stateIdOf(t), k = Object.keys(ENDS).find((x) => ENDS[x].includes(id)); if (k) ends[k] += 1; }
    const lastRow = R.settingsRow({ name: 'Last task', sentence: p.early ? 'Reading…' /* F-6-19: the store's tasks are still loading */ : last ? `${R.textLink({ label: last.title, attrs: { 'data-c-open': last.id, title: `Opens ${last.title}` } })}${esc([last.time, R.runState(stateIdOf(last)).word].filter(Boolean).map((x) => ` · ${x}`).join(''))}` : 'No tasks yet' });
    const soFar = Object.entries(ends).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(' · ');
    return R.settingsSection({ title: 'How it stands', rows: ready + lastRow + (soFar ? R.settingsRow({ name: 'So far', sentence: esc(soFar) }) : '') });
  }
  // Metrics and Policy in the Team section (Expert): the fact, and where to change it
  function teamFacts(p) {
    const f = pageFacts(p), go = (label, place) => R.textLink({ label, attrs: { 'data-pj-go-place': place, title: `Opens ${place === 'insights/team' ? 'Insights › Team' : 'Settings › Team policy'}` } });
    const plusScope = (word, scope) => (scope && !word.includes(scope) ? ` · ${scope}` : '');   // "follows acme/gateway" names its scope once
    const row = (name, fact, what, sayIt, end) => (fact.status === 'ready' && !fact.value ? '' : R.settingsRow({ name, sentence: esc(factSays(fact, what, sayIt)), end }));
    return row('Metrics', f.metrics, 'team metrics', (m) => `${m.word}${plusScope(m.word, m.scope)}${m.lastPush && agoWord(m.lastPush) ? ` · last push ${agoWord(m.lastPush)}` : ''}`, go('In Insights', 'insights/team'))
      + row('Policy', f.policy, 'team policy', (x) => `${x.word}${plusScope(x.word, x.scope)}`, go('In Settings', 'settings/team'));
  }
  // ---- a project's page in tabs (classic's project tabs; gaps.md Projects). Memory, Sets, Actions and Automations are
  // classic's functions drawn on the demo's data: live, each says it is not here yet until its reads exist ----
  const TABS = [['overview', 'Overview'], ['tasks', 'Tasks'], ['memory', 'Memory'], ['sets', 'Sets'], ['actions', 'Actions'], ['automations', 'Automations'], ['readiness', 'Readiness'], ['settings', 'Settings']];
  const DEMO_ONLY = ['memory', 'sets', 'actions', 'automations'];
  let tab = 'overview', sub = null, histOpen = false;   // sub: the small form open in a tab (a new memory file, an action, a rule)
  const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms));   // the demo's server: long enough to see a button busy
  // the nine checks readiness counts: its summary line and its rows read this one list
  const CHECKS = [['Has a README', 'must', 'Add a README.md that says how to run it'], ['Has a test command', 'must', 'Add a test script to package.json'], ['Has a build command', 'must', 'Add a build script to package.json'], ['Has agent instructions', 'must', 'Add a CLAUDE.md that says how to work here'],
    ['Has a lockfile', 'should', 'Commit package-lock.json'], ['Ignores build output', 'should', 'Add dist/ to .gitignore'], ['Has a contributing guide', 'should', 'Add CONTRIBUTING.md'], ['Has a linter', 'should', 'Add a lint script to package.json'], ['Pins its runtime', 'should', 'Add an .nvmrc']];
  const checksOf = (r) => { const failing = [...r.failing.must, ...r.failing.should]; return CHECKS.map(([title, level, fix]) => { const f = failing.find((c) => c.title === title); return { title, level, fix: f?.fix || fix, pass: !f, ignored: false }; }); };
  // what the demo keeps for a project's tabs, made on first use
  const X = (p) => (p.x = p.x || {
    checks: p.readiness?.level ? checksOf(p.readiness) : null,
    memory: p.kind === 'Folder' || p.origin === 'missing' ? [] : [{ name: 'MEMORY.md', says: 'The index: one line for each note', meta: '1.2 KB · changed 2 days ago' }, { name: 'conventions.md', says: 'How this code is written and tested', meta: '3.4 KB · changed 2 days ago' }, { name: 'review-findings.md', says: 'What reviews keep finding here', meta: '2.1 KB · changed last week' }],
    history: [{ when: '2 days ago', what: 'A task added 2 notes to conventions.md' }, { when: 'Last week', what: 'Defragmented: 14 notes became 11' }, { when: '3 weeks ago', what: 'You made review-findings.md' }],
    guardrails: [{ name: 'Default guardrails', says: 'No force-push, no secrets in a commit, no deleted branches', on: true }, { name: 'Strict', says: 'Also asks before a migration or a new dependency', on: false }],
    mcp: [{ name: 'Core tools', says: 'GitHub, Playwright', on: true }, { name: 'Data', says: 'Postgres, read only', on: false }],
    mcpFile: p.readiness?.level ? { servers: ['postgres', 'sentry'], approved: false } : null,
    actions: [{ name: 'Run the tests', cmd: 'npm test' }, { name: 'Start it', cmd: 'npm run dev' }],
    rules: [{ when: 'A pull request gets review comments', does: 'Start a task that answers them', on: true }, { when: `${p.base || 'origin'} moves`, does: 'Sync this copy', on: true }, { when: 'CI fails on the main branch', does: 'Start a task that fixes it', on: false }],
  });
  // the demo's readiness report, counted from its checks: an ignored check is not counted, so the summary and the rows agree
  function readinessDemo(p) {
    const c = p.readiness?.level ? X(p).checks : null; if (!c) return p.readiness || { none: true };
    const on = c.filter((k) => !k.ignored), fail = on.filter((k) => !k.pass), must = fail.filter((k) => k.level === 'must'), should = fail.filter((k) => k.level === 'should');
    return { ...p.readiness, level: must.length ? 'partial' : 'ready', word: fail.length ? 'Partly ready' : 'Agent-ready', mustFix: must.length, shouldFix: should.length, passed: on.length - fail.length, applicable: on.length, failing: { must, should, advice: p.readiness.failing.advice } };
  }
  const subForm = (text, fields, yes) => `<div class="card-form" data-pj-sub>${R.confirmForm({ form: 'pj-sub', id: 'pj-sub-t', text, body: fields.map(([k, label, ph, hint]) => R.field({ id: `pj-sub-${k}`, label, placeholder: ph, value: sub[k] || '', error: sub[`err${k.toUpperCase()}`] || '', ...(hint ? { hint } : {}), attrs: { maxlength: 120, autocomplete: 'off' } })).join('') + R.confirmActions({ yes }) })}</div>`;
  const notHere = (what) => R.notInStillhet({ place: `A project's ${what}`, today: `the project's ${what} tab`, attrs: { 'data-pj-chat': '' } });
  const word = (ok, yes, no) => `<span class="pj-check ${ok ? 'is-ok' : 'is-no'}">${esc(ok ? yes : no)}</span>`;
  function memoryTab(p) {
    const x = X(p), form = sub?.k === 'mem-new' ? subForm('A new memory file', [['a', 'File name', 'decisions.md', 'A Markdown file in this project\'s memory']], 'Create') : '';
    const files = x.memory.length ? R.list({ groups: [{ rows: x.memory.map((m, i) => R.listRow({ title: m.name, meta: `${m.says} · ${m.meta}`, mark: R.kindMark({ kind: 'file', icon: 'file', size: 16 }), open: { 'data-pj-mem': i, title: `Opens ${m.name}` } })) }] })
      : R.emptyState({ title: 'No memory yet.', text: 'A task writes down what it learns here; you can start a file yourself.', actions: R.button({ label: 'New file', attrs: { 'data-pj-sub-open': 'mem-new' } }) });
    const acts = `<div class="pj-acts">${R.button({ label: 'New file', attrs: { 'data-pj-sub-open': 'mem-new', title: 'A Markdown file in this project\'s memory' } })}${R.button({ label: 'Defragment', attrs: { 'data-pj-defrag': '', disabled: x.memory.length < 2, title: 'Merges notes that say the same and drops what is out of date; History keeps what it did' } })}${R.button({ label: 'History', icon: R.icon(histOpen ? 'chevron' : 'chevR', 12), attrs: { 'data-pj-hist': '', 'aria-expanded': String(histOpen) } })}</div>`;
    const hist = histOpen ? R.settingsSection({ title: 'History', rows: x.history.map((h) => R.settingsRow({ name: h.when, sentence: esc(h.what) })).join('') }) : '';
    return `<p class="pj-say">What its tasks have learned here, as files they read before they start.</p>${acts}${form}${files}${hist}`;
  }
  function setsTab(p) {
    const x = X(p), rows = (list, hook, kind) => list.map((g, i) => R.settingsRow({ name: g.name, sentence: esc(g.says), end: R.switchButton({ on: g.on, label: `${g.name} for this project`, attrs: { [hook]: i } }) })).join('');
    const f = x.mcpFile, file = f ? R.settingsSection({ title: 'Its own .mcp.json', meta: 'A project can name MCP servers in its own file. Its tasks load them only once you approve.', rows: R.settingsRow({ name: `${f.servers.length} servers`, sentence: `${esc(f.servers.join(', '))} · ${word(f.approved, 'Approved: its tasks load them', 'Not approved: its tasks do not load them')}`, end: R.button({ label: f.approved ? 'Take approval back' : 'Approve', attrs: { 'data-pj-mcp': '' } }) }) }) : '';
    return `<p class="pj-say">The rule sets and tool sets this project's tasks run with. A set is made in Settings; here you choose which ones apply.</p>${R.settingsSection({ title: 'Guardrails', rows: rows(x.guardrails, 'data-pj-guard') })}${R.settingsSection({ title: 'MCP sets', rows: rows(x.mcp, 'data-pj-mcpset') })}${file}`;
  }
  function actionsTab(p) {
    const x = X(p), editing = sub?.k === 'act' ? subForm(sub.i == null ? 'A new action' : `Change ${x.actions[sub.i].name}`, [['a', 'Name', 'Run the tests'], ['b', 'Command', 'npm test', 'Runs in the project\'s folder']], sub.i == null ? 'Add' : 'Save') : '';
    const list = R.settingsSection({ title: 'Its actions', meta: 'Commands you run here often, one click each.', action: R.button({ label: 'Add action', attrs: { 'data-pj-sub-open': 'act' } }),
      rows: x.actions.length ? x.actions.map((a, i) => R.settingsRow({ name: a.name, sentence: `<code>${esc(a.cmd)}</code>`, end: R.button({ label: 'Run', attrs: { 'data-pj-act-run': i, title: `Runs ${a.cmd} in a terminal here` } }) + R.button({ label: 'Edit', attrs: { 'data-pj-act-edit': i } }) + R.button({ label: 'Remove', attrs: { 'data-pj-act-del': i } }) })).join('') : R.settingsRow({ name: 'None yet', sentence: 'Add a command you run here often' }) });
    const open = R.settingsSection({ title: 'Open it', rows: R.settingsRow({ name: 'On this computer', sentence: `<code>${esc(p.path)}</code>`, end: ['editor', 'terminal', 'files'].map((k) => R.button({ label: k === 'editor' ? 'Open in editor' : k === 'terminal' ? 'Open a terminal' : 'Open its files', attrs: { 'data-pj-launch': k } })).join('') }) });
    return `${editing}${list}${open}`;
  }
  function automationsTab(p) {
    const x = X(p), adding = sub?.k === 'rule' ? subForm('A new rule', [['a', 'When', 'A pull request gets review comments'], ['b', 'Then', 'Start a task that answers them']], 'Add') : '';
    return `${adding}${R.settingsSection({ title: 'Rules', meta: 'What Worca does here by itself. A rule that is off waits; nothing is lost.', action: R.button({ label: 'Add rule', attrs: { 'data-pj-sub-open': 'rule' } }) + R.button({ label: 'Check now', attrs: { 'data-pj-rules-check': '', disabled: !x.rules.some((r) => r.on), title: 'Looks now for what the rules wait on' } }),
      rows: x.rules.length ? x.rules.map((r, i) => R.settingsRow({ name: r.when, sentence: esc(r.does), end: R.switchButton({ on: r.on, label: `Rule: ${r.when}`, attrs: { 'data-pj-rule': i } }) + R.button({ label: 'Delete', attrs: { 'data-pj-rule-del': i } }) })).join('') : R.settingsRow({ name: 'No rules yet', sentence: 'Add one, or ask for it in chat' }) })}`;
  }
  function readinessTab(p) {
    const f = pageFacts(p), r = f.readiness.value;
    if (f.readiness.status !== 'ready') return R.listState({ state: f.readiness.status === 'failed' ? 'failed' : 'loading', noun: 'checks' });
    if (!r?.level) return R.emptyState({ title: 'Not judged yet.', text: 'Worca checks nine things that make a project easy for an agent to work in.', actions: isLive() ? '' : R.button({ label: 'Check now', attrs: { 'data-pj-judge': '' } }) });
    const live = isLive(), checks = live ? [...r.failing.must.map((c) => ({ ...c, level: 'must' })), ...r.failing.should.map((c) => ({ ...c, level: 'should' }))] : X(p).checks;
    const rows = checks.map((c, i) => R.settingsRow({ name: c.title, sentence: c.ignored ? 'Ignored: not counted' : c.pass ? word(true, 'Passes') : `${word(false, '', c.level === 'must' ? 'Must fix' : 'Should fix')}${c.fix ? ` · ${esc(c.fix)}` : ''}`,
      end: live ? '' : c.ignored ? R.button({ label: 'Count it again', attrs: { 'data-pj-ignore': i } }) : R.button({ label: 'Recheck', attrs: { 'data-pj-recheck': i, title: `Checks "${c.title}" again` } }) + R.button({ label: 'Ignore', attrs: { 'data-pj-ignore': i, title: 'Leaves it out of the count for this project' } }) })).join('');
    const tools = [['Tools', r.tools.map((t) => `${t.name}: ${t.word}`).join(', ')], ['Not judged', r.notJudged.join(', ')], ['Advice', r.failing.advice.map((c) => c.title).join(', ')]].filter(([, v]) => v);
    return `${R.settingsSection({ title: readyLine(r), meta: live ? 'The checks that fail; the rest pass.' : 'Each check, and what fixes it.', action: live ? '' : R.button({ label: 'Recheck all', attrs: { 'data-pj-recheck': 'all' } }), rows })}${tools.length ? R.settingsSection({ title: 'For which tools', rows: tools.map(([name, v]) => R.settingsRow({ name, sentence: esc(v) })).join('') }) : ''}`;
  }
  // a project's page, as its named parts (comp.patch-parts): draw() patches them into the frame's column
  function pageParts(p) {
    withDetail(p);
    const live = LIVE()?.detail(p.id);
    const pick = (id, label, text, items, tip, off = []) => R.rowPicker({ id, label, text, tip, items: items.map((x) => ({ id: x, text: x, checked: x === text, off: off.includes(x), help: off.includes(x) ? 'Team memory is off for this project' : '' })), open: menu === id, chevron: R.icon('chevron', 12) });
    const via = current.split('@')[1] || firstHome(p.id), homes = adv() ? window.StillhetSpaces?.list().filter((w) => w.projects.some(([x]) => x === p.id)) || [] : [], here2 = homes.find((w) => w.id === via), also = homes.filter((w) => w !== here2);
    const waits = waitsOf(p), first = waits[0];   // a question waiting leads; how the project stands comes after it
    const ask = R.button({ label: 'Ask about it in chat', attrs: { 'data-pj-ask': '', title: 'Opens Chat with this project attached' } });
    const head = R.placeHead({ center: { label: 'Projects', to: 'projects', via: adv() && here2 ? [{ label: here2.title, attrs: { 'data-pj-go': `ws:${here2.id}` } }] : [] }, title: nameOf(p), facts: esc([also.length ? `Also in ${also.map((w) => w.title).join(', ')}` : '', p.kind, p.path, p.branch].filter(Boolean).join(' · ')), mark: mark(p), word: first ? (waits.length === 1 ? '1 task here needs you' : `${waits.length} tasks here need you`) : wordOf(p), why: first ? (p.origin === 'ok' ? '' : wordOf(p)) : o(p).why2 ? o(p).why2(p) : p.checked ? `Checked ${p.checked}` : p.files ? `${p.files} files` : '',
      action: (first ? R.button({ label: R.cardAction(first.state).label, kind: first.tone === 'fail' ? 'primary' : '', attrs: { ...first.open, title: first.tip || `Opens ${first.title} in its chat` } }) : o(p).act ? R.button({ label: o(p).act, busy: busyOf(p.id) ? { label: busyOf(p.id) } : false, attrs: { 'data-pj-act': p.id, title: o(p).why } }) : ''), actions: p.origin === 'missing' ? '' : ask,
      menu: R.moreMenu({ id: 'pj-more', label: `More for ${nameOf(p)}`, icon: R.icon('more', 16), open: menu === 'pj-more', items: p.early ? [newTaskItem(p), tasksItem] /* F-6-19: the writes read the store's record: they wait for it */ : [...(first ? actItem(p) : []), newTaskItem(p), tasksItem, fetchItem(p), renameItem, ...(p.kind === 'Git' && p.origin === 'local' ? [{ id: 'remote', text: 'Link a remote…', help: 'Adds the repository as origin; nothing is pushed' }] : []), { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: removeHelp(p) }] }) });
    const now = TABS.some(([id]) => id === tab) ? tab : 'overview';
    const tabsRow = R.tabs({ label: `${nameOf(p)}: its parts`, controls: 'pj-panel', cls: 'pj-tabs', idPrefix: 'pjtab-', items: TABS.map(([id, label]) => ({ id, label, selected: id === now, count: id === 'tasks' && waits.length ? waits.length : '' })) });
    // form.remove-owned: a folder Worca made goes with it, and the strip says so
    const strip = confirm && confirm.p?.id === p.id ? R.confirmStrip({ text: p.ownedFolder ? `Remove ${nameOf(p)}? Worca made its folder, so the folder goes too; its tasks stay, and its schedules stop.` : `Remove ${nameOf(p)}? Worca forgets it; its folder and its tasks stay, and its schedules stop.`, yes: 'Remove', danger: true }) : '';
    // what is on it now: what waits on you first (the head's count), then its chats' other open tasks
    const tone = toneOfTask, others = p.early ? [] : tasksOf(nameOf(p)).filter(({ t }) => !['ok', 'merged', 'idle'].includes(tone(t)) && !waits.some((x) => x.title === t.title));
    const rowOfTask = (x) => R.listRow({ title: x.title, meta: x.detail || '', mark: R.kindMark({ kind: 'task', tone: x.tone, stage: x.stage, title: x.detail }), open: { ...x.open, title: x.tip || `Opens ${x.title} in its chat` } });
    const going = others.map(({ t, c }) => ({ title: t.title, detail: t.detail, stage: t.stage, tone: tone(t), open: { 'data-pj-open': `${c.id}|${t.title}` } }));
    const list = [...waits, ...going];
    const counts = ['run', 'ask', 'fail'].map((k) => [k, k === 'ask' ? waits.length : others.filter(({ t }) => tone(t) === k).length]).filter(([, n]) => n);
    const WORD = { run: 'working', ask: 'need you', fail: 'failed' };
    // V3-05: the line says what runs; nothing runs (only asks, or a paused or stopped task), no line
    const onLine = counts.length && !(counts.length === 1 && counts[0][0] === 'ask') ? `<p class="convo-head">On it now: ${counts.map(([k, n]) => `${n} ${k === 'ask' && n === 1 ? 'needs you' : WORD[k]}`).join(', ')}</p>` : '';
    const nothing = R.emptyState({ title: p.origin === 'missing' ? 'Nothing can start here until its folder is back.' : 'Nothing is on it now.', actions: p.origin === 'missing' ? '' : R.button({ label: 'Start a task', attrs: { 'data-pj-menu': 'task' } }) });
    const tasks = list.length ? R.list({ groups: [{ rows: list.map(rowOfTask) }] }) : nothing;
    const F = PAGE_FORMS[form], locate = F && locating === p.id ? `<div class="card-form">${R.confirmForm({ form: 'hand', id: 'pj-hand-t', text: F.text(p), body: R.field({ id: 'pj-hand-v', label: F.label, placeholder: F.ph, value: formTyped, error: formErr, ...(form === 'rename' ? { hint: `Up to ${NAME_MAX} characters` } : {}), attrs: { maxlength: F.max, 'data-keep': `pj-hand:${form}:${p.id}` } }) + R.confirmActions({ yes: busyOf(p.id) || F.yes, busy: !!busyOf(p.id) }) })}</div>` : '';
    const ended = p.early ? [] : tasksOf(nameOf(p)).filter(({ t }) => ['ok', 'merged'].includes(tone(t)) && !waitingOn(nameOf(p), t)).map(({ t, c }) => ({ title: t.title, detail: t.detail, stage: t.stage, tone: tone(t), open: { 'data-pj-open': `${c.id}|${t.title}` } }));
    const lately = ended.length ? R.list({ groups: [{ title: 'Lately', rows: ended.slice(0, 5).map(rowOfTask) }] }) : '';
    // live (D16): each sentence reads dev's value and what it would inherit; Branch names is not offered live (D19, slice 12)
    const setOf = (x) => (live ? (live.sets?.[x.id] ? { def: live.sets[x.id].yours, v: live.sets[x.id].value } : null) : { def: defOf(p, x), v: p.sets?.[x.id] || defOf(p, x) });
    const sets = R.settingsSection({ title: 'How its tasks run', meta: 'Yours from Settings until you change them here.', rows: SETS.filter((x) => (adv() || !ADVANCED_SETS.includes(x.id)) && !(live && (x.id === 'branch' || x.demoOnly)) && setOf(x)).map((x) => { const { def, v } = setOf(x), busy = busyOf(`${p.id}#set:${x.id}`);
      // a labelled value in a fixed place (stillhet rule 2): the row's picker holds the value, one line under the name says what it decides
      return R.settingsRow({ name: x.name, note: `${esc(x.words.replace(/:$/, ''))}${v !== def ? ` · yours is ${esc(def)}` : ''}`, changed: v !== def ? [{ name: x.name, was: def }] : false, end: (busy ? R.button({ label: busy, busy: { label: busy } }) : v !== def ? R.button({ label: 'Use yours', attrs: { 'data-pj-reset': x.id, title: `Back to your ${def}` } }) : '') + pick(`pjs-${x.id}`, x.name, v, x.items, x.name, x.id === 'memory' && !p.teamMemory ? TEAM_NOTES : []) }); }).join('') });
    const team = R.shows('expert') ? R.settingsSection({ title: 'Team', rows: R.settingsRow({ name: 'Team memory', sentence: p.teamMemory ? 'The team\'s notes for this project are on its worca-memory branch' : 'No team notes yet', end: R.switchButton({ on: !!p.teamMemory, label: 'Team memory', why: busyOf(`${p.id}#team`) || p.off || '', disabled: !!busyOf(`${p.id}#team`) || !!p.off, attrs: { 'data-pj-team': p.id } }) }) + teamFacts(p) }) : '';
    // where it is: its folder (copy the path) and its remote (link one when it has none)
    const noRemote = p.kind === 'Git' && p.origin === 'local';
    const where = R.settingsSection({ title: 'Where it is', rows: R.settingsRow({ name: 'Folder', sentence: `<code>${esc(p.path)}</code>`, end: R.copyButton({ text: p.path, label: 'Copy the path' }) })
      + (p.kind === 'Git' ? R.settingsRow({ name: 'Remote', sentence: noRemote ? 'None: it is only on this computer' : esc(p.base || 'origin'), end: noRemote ? R.button({ label: 'Link a remote…', attrs: { 'data-pj-menu': 'remote', title: 'Adds the repository as origin; nothing is pushed' } }) : '' }) : '') });
    const figures = spendOf(p) != null ? R.factsLine([{ n: `$${Math.round(spendOf(p)).toLocaleString('en-US')}`, word: 'this month', ...(adv() ? { attrs: { 'data-pj-spend': '', title: `Opens Insights › Spend, of ${nameOf(p)}` } } : {}) }, { n: String(taskCount(nameOf(p))), word: taskCount(nameOf(p)) === 1 ? 'task' : 'tasks', attrs: { 'data-pj-menu': 'tasks', title: 'Opens Tasks, from this project' } }]) : '';
    const gone = p.origin === 'missing' ? R.emptyState({ title: 'Its folder is missing.', text: 'This applies once the folder is back: locate it from the head of this page.' }) : '';
    // F-6-19: an early record (the store still loading) draws its head and facts; its tasks say they are loading
    const loading = R.listState({ state: 'loading', noun: 'tasks' });
    const PANELS = {
      overview: () => `${standsPart(p)}${p.early ? loading : `${onLine}${tasks}${figures}`}${lately}`,
      tasks: () => (p.early ? loading : list.length || ended.length ? `${R.list({ level: 2, groups: [{ title: 'Need you', rows: waits.map(rowOfTask) }, { title: 'Working', rows: going.map(rowOfTask) }, { title: 'Ended', rows: ended.map(rowOfTask) }].filter((g) => g.rows.length) })}<div class="pj-acts">${R.button({ label: `All ${taskCount(nameOf(p)) || ''} in Tasks`.replace('  ', ' '), attrs: { 'data-pj-menu': 'tasks', title: 'Opens Tasks, from this project' } })}</div>` : nothing),
      memory: () => memoryTab(p), sets: () => setsTab(p), actions: () => actionsTab(p), automations: () => automationsTab(p),
      readiness: () => (p.origin === 'missing' ? gone : readinessTab(p)),
      settings: () => (p.origin === 'missing' ? gone : `${defaults(p, homes)}${sets}${where}${team}`),
    };
    const body = DEMO_ONLY.includes(now) && isLive() ? notHere(TABS.find(([id]) => id === now)[1]) : DEMO_ONLY.includes(now) && p.origin === 'missing' ? gone : PANELS[now]();
    return { head, tabs: tabsRow, strip, locate, panel: `<div class="pj-panel" id="pj-panel" role="tabpanel" aria-labelledby="pjtab-${now}" tabindex="-1">${body}</div>` };
  }
  // the answer to a tab's small form: checked as fields, then kept in the demo's model
  function subYes(p) {
    const x = X(p), a = page.querySelector('#pj-sub-a')?.value.trim() || '', b = page.querySelector('#pj-sub-b')?.value.trim() || '';
    const fail = (errA, errB = '') => { sub = { ...sub, a, b, errA, errB }; draw(); page.querySelector(errA ? '#pj-sub-a' : '#pj-sub-b')?.focus(); };
    const done = (text, focus) => { sub = null; draw(); say(text); page.querySelector(focus)?.focus(); };
    if (sub.k === 'mem-new') {
      const name = a && !/\.md$/i.test(a) ? `${a}.md` : a;
      if (!a) return fail('It needs a name'); if (/[\/\\<>:"|?*]/.test(a)) return fail('A file name has no / \\ < > : " | ? or *'); if (x.memory.some((m) => m.name.toLowerCase() === name.toLowerCase())) return fail(`${name} is already there`);
      x.memory.push({ name, says: 'Empty: its first note comes from you or a task', meta: '0 KB · just now' }); x.history.unshift({ when: 'Just now', what: `You made ${name}` }); return done(`Made ${name}`, '[data-pj-sub-open="mem-new"]');
    }
    if (!a || !b) return fail(a ? '' : sub.k === 'act' ? 'It needs a name' : 'Say when it acts', b ? '' : sub.k === 'act' ? 'It needs a command' : 'Say what it does');
    if (sub.k === 'act') { if (sub.i == null) x.actions.push({ name: a, cmd: b }); else Object.assign(x.actions[sub.i], { name: a, cmd: b }); return done(sub.i == null ? `Added ${a}` : `Saved ${a}`, '[data-pj-sub-open="act"]'); }
    x.rules.push({ when: a, does: b, on: true }); done('Added the rule; it is on', '[data-pj-sub-open="rule"]');
  }
  // a tab's own clicks (the demo's model); true when it took the click
  function tabClick(e, p) {
    const on = (q) => e.target.closest(q), x = X(p); let hit;
    const undo = (list, i, text) => { const [was] = list.splice(i, 1); draw(); say(text, () => { list.splice(i, 0, was); draw(); }); };
    if ((hit = on('[data-pj-sub-open]'))) { sub = { k: hit.dataset.pjSubOpen, i: null }; draw(); page.querySelector('#pj-sub-a')?.focus(); return true; }
    if (sub && (hit = on('[data-pj-sub] [data-confirm]'))) { if (hit.dataset.confirm === 'yes') subYes(p); else { const k = sub.k; sub = null; draw(); page.querySelector(`[data-pj-sub-open="${k}"]`)?.focus(); } return true; }
    if ((hit = on('[data-pj-mem]'))) { say(window.StillhetWould(`open ${x.memory[+hit.dataset.pjMem].name} to read and edit`)); return true; }
    if ((hit = on('[data-pj-defrag]'))) { R.busy(hit, { label: 'Defragmenting…', until: wait(900) }).then(() => { x.history.unshift({ when: 'Just now', what: `Defragmented: ${x.memory.length} files read, nothing to merge` }); if (tab === 'memory') draw(); say('Defragmented: nothing to merge'); }); return true; }
    if (on('[data-pj-hist]')) { histOpen = !histOpen; draw(); page.querySelector('[data-pj-hist]')?.focus(); return true; }
    if ((hit = on('[data-pj-guard], [data-pj-mcpset]'))) { const g = hit.dataset.pjGuard != null ? x.guardrails[+hit.dataset.pjGuard] : x.mcp[+hit.dataset.pjMcpset]; g.on = !g.on; draw(); say(`${g.name}: ${g.on ? 'used by' : 'not used by'} ${nameOf(p)}`); return true; }
    if ((hit = on('[data-pj-mcp]'))) { const f = x.mcpFile; if (f.approved) { f.approved = false; draw(); say('Approval taken back: its tasks no longer load them'); return true; } R.busy(hit, { label: 'Approving…', until: wait() }).then(() => { f.approved = true; if (tab === 'sets') draw(); say(`Approved ${f.servers.join(' and ')} for ${nameOf(p)}`); }); return true; }
    if ((hit = on('[data-pj-act-run]'))) { say(window.StillhetWould(`run ${x.actions[+hit.dataset.pjActRun].cmd} in a terminal in ${p.path}`)); return true; }
    if ((hit = on('[data-pj-act-edit]'))) { const i = +hit.dataset.pjActEdit; sub = { k: 'act', i, a: x.actions[i].name, b: x.actions[i].cmd }; draw(); page.querySelector('#pj-sub-a')?.focus(); return true; }
    if ((hit = on('[data-pj-act-del]'))) { const i = +hit.dataset.pjActDel; undo(x.actions, i, `Removed ${x.actions[i].name}`); return true; }
    if ((hit = on('[data-pj-launch]'))) { const k = hit.dataset.pjLaunch; say(window.StillhetWould(k === 'editor' ? `open ${p.path} in your editor` : k === 'terminal' ? `open a terminal in ${p.path}` : `open ${p.path} in your files`)); return true; }
    if ((hit = on('[data-pj-rule-del]'))) { undo(x.rules, +hit.dataset.pjRuleDel, 'Deleted the rule'); return true; }
    if ((hit = on('[data-pj-rule]'))) { const r = x.rules[+hit.dataset.pjRule]; r.on = !r.on; draw(); page.querySelector(`[data-pj-rule="${hit.dataset.pjRule}"]`)?.focus(); say(r.on ? 'The rule is on' : 'The rule is off'); return true; }
    if ((hit = on('[data-pj-rules-check]'))) { R.busy(hit, { label: 'Checking…', until: wait() }).then(() => say('Checked: nothing new for the rules to act on')); return true; }
    if ((hit = on('[data-pj-judge]'))) { R.busy(hit, { label: 'Checking…', until: wait(900) }).then(() => { p.readiness = { level: 'ready', word: 'Agent-ready', mustFix: 0, shouldFix: 0, passed: 9, applicable: 9, tools: [{ name: 'Claude Code', word: 'Ready' }], notJudged: [], failing: { must: [], should: [], advice: [] }, checkedAt: null }; x.checks = checksOf(p.readiness); draw(); say(`Checked ${nameOf(p)}: 9 of 9 checks pass`); }); return true; }
    if ((hit = on('[data-pj-recheck]'))) { const i = hit.dataset.pjRecheck, c = i === 'all' ? null : x.checks[+i]; R.busy(hit, { label: 'Checking…', until: wait() }).then(() => say(c ? `"${c.title}" ${c.pass ? 'passes' : 'still fails'}` : `Checked again: ${readyLine(readinessDemo(p))}`)); return true; }
    if ((hit = on('[data-pj-ignore]'))) { const c = x.checks[+hit.dataset.pjIgnore]; c.ignored = !c.ignored; draw(); say(c.ignored ? `"${c.title}" is not counted for ${nameOf(p)}` : `"${c.title}" counts again`); return true; }
    return false;
  }
  // a page's frame, built once per frame key (D7): its column takes the parts, a project's dock the composer
  // one page frame (stillhet.page-frame): the home and a project's page share Tasks' column; no composer under it (stillhet.chat-first)
  const frameHtml = (aPage) => `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center"${aPage ? ' data-pj-page' : ''}></div></div></div>`;

  // the home: Simple the list; from Advanced each workspace one box (panel.workspace-map). Chat first: it ends with the composer; by hand stays, quiet
  const adv = () => R.shows('advanced'), spaces = () => (adv() ? window.StillhetSpaces?.list() || [] : []);
  const loose = () => data.projects.filter((p) => !window.StillhetSpaces?.member(p.id));
  // this month's spend (slice 10 D19): live, Insights' read of this month's stats, its project row by name; null while
  // reading. The demo reads Insights' own model, so the two places never disagree
  const spendOf = (p) => (isLive() ? window.StillhetInsightsLive?.monthSpend(nameOf(p)) ?? null : monthOf(nameOf(p))?.spend ?? null);
  // the bar counts its own rows, in its unit: projects (one in two workspaces once; a workspace with only a question is one)
  const loneSpaces = () => (adv() && view.by === 'workspace' ? spaces().filter((w) => !w.projects.some(([id]) => data.projects.some((p) => p.id === id && needs(p))) && window.StillhetSpaces.questions(w).length) : []);
  // One count for what needs you (small-rules): this place's part is its projects to fix and the links Worca asks about; a task or a
  // missed time that waits is Tasks' part, and its project's row says so at its end ("2 tasks need you") in the project's own section.
  const ownNeed = (p) => needItems().some((x) => x.key === `p:${p.id}`);
  const placeNeeds = () => window.StillhetWorld?.needsLabel?.('project', 'proposal') || null;
  const needCount = () => (placeNeeds() ? placeNeeds().n : data.projects.filter(ownNeed).length + loneSpaces().length);
  // a project item names its problem with figures, its effect and its one fix (panel.pulse-read); `clear` is its state's
  // clear line in Pulse (pulse-model.js CLEARS), `fix` the label of the one fix the item carries itself (Sync, when only behind)
  function needOf(p) {
    if (p.origin === 'behind') { const n = p.behind; return { meta: `${n} ${n === 1 ? 'commit' : 'commits'} behind ${p.base} · ${p.autoSync === false ? 'New tasks start from older code' : 'Each new task syncs it first'}`, clear: 'project-behind', fix: busyOf(p.id) || 'Sync' }; }
    if (p.origin === 'diverged') return { meta: `${p.ahead} ahead, ${p.behind} behind ${p.base} · The next task asks how to bring them together`, clear: 'project-diverged', fix: '' };
    if (p.origin === 'missing') return { meta: 'Its folder is gone · New tasks cannot start here', clear: 'project-missing', fix: '' };
    return { meta: wordOf(p), clear: '', fix: '' };
  }
  // what needs you beyond tasks and missed times, each once: the bell and Pulse's Needs you read this list (small-rules)
  function needItems() {
    // each workspace link Worca is unsure of; live, from dev's workspaces and their maps (D10)
    const asks = spaces().flatMap((w) => window.StillhetSpaces.questions(w).map((l) => ({ key: `q:${w.id}:${l.from}:${l.to}`, title: w.title, meta: `Does ${keyName(l.from)} ${l.how.replace(/s\b/, '')} ${keyName(l.to)}?`, kind: 'workspace', tone: 'ask', go: `projects/ws:${w.id}`, project: '', tip: `Opens ${w.title} at its question` })));
    // live: a missing folder or out of sync (D22)
    if (W?.live) return [...data.projects.filter((p) => p.needs).map((p) => ({ key: `p:${p.id}`, title: nameOf(p), ...needOf(p), kind: 'project', tone: o(p).tone === 'fail' ? 'fail' : 'ask', go: `projects/${p.id}`, project: p.id, tip: `Opens ${nameOf(p)} at its fix` })), ...asks];
    return [...data.projects.filter((p) => o(p).tone === 'fail' || p.origin === 'diverged').map((p) => ({ key: `p:${p.id}`, title: p.id, ...needOf(p), kind: 'project', tone: o(p).tone === 'fail' ? 'fail' : 'ask', go: `projects/${p.id}`, project: p.id, tip: `Opens ${p.id} at its fix` })), ...asks];
  }
  // a workspace's link Worca is unsure of, as a card
  const qCard = (w, l) => R.pluginCard({ mark: R.kindMark({ kind: 'workspace', tone: 'ask', breathe: true }), word: R.needsReason('question'), tone: 'ask', title: w.title,
    whatHtml: `Does ${link(keyName(l.from), { 'data-pj-go': `${l.from}@${w.id}` }, `Opens ${keyName(l.from)}`)} ${esc(l.how.replace(/s\b/, ''))} ${link(keyName(l.to), { 'data-pj-go': `${l.to}@${w.id}` }, `Opens ${keyName(l.to)}`)}? ${window.StillhetSpaces.saysSure[l.sure]}`, action: R.button({ label: 'Answer', attrs: { 'data-pj-go': `ws:${w.id}`, title: `Goes to the question in ${w.title}` } }), attrs: { title: l.at || null } });
  const SYNC_TIP = (p) => (p.origin === 'diverged' ? `${p.ahead} ahead, ${p.behind} behind ${p.base}` : p.origin === 'behind' ? `Your copy is older: ${p.behind} behind ${p.base}` : p.origin === 'missing' ? `Last seen ${p.checked}` : p.files ? `No git · ${p.files} files` : '');
  const homesOf = (id) => spaces().filter((w) => w.projects.some(([x]) => x === id));
  const count = (label, f, tip) => link(label, { 'data-c-filter': JSON.stringify(f) }, tip);
  function factsOf(s, extra = []) {
    const p = s.p, nums = [];
    if (s.running.length && !s.sentenceRuns) nums.push(count(`${s.running.length} running`, { project: nameOf(p), show: 'running' }, `Opens what runs in ${nameOf(p)}`));
    if (s.waiting.length) nums.push(count(`${s.waiting.length} waiting`, { project: nameOf(p), show: 'waiting' }, `Opens what waits in ${nameOf(p)}`));
    return [...nums, ...extra.map(esc)].join(' · ');
  }
  function cardOf(s, extra = []) {
    const p = s.p;
    return R.pluginCard({ mark: s.quiet ? R.kindMark({ kind: 'project' }) : markOf(s), word: s.word, tone: s.tone === 'idle' ? '' : s.tone, title: nameOf(p), titleHtml: link(nameOf(p), { 'data-pj-go': p.id }, `Opens ${nameOf(p)}`), whatHtml: s.what, factsHtml: factsOf(s, extra), factsTip: '', action: s.action, attrs: { 'data-pc-card': p.id, 'data-pj-go': p.id, title: SYNC_TIP(p) || null } });   // stillhet.card-opens: the title is a link and the card opens the project
  }
  // "most urgent" and A–Z, for cards and shelves alike
  const RANKED = { 'most urgent': (a, b) => (!!a.loose - !!b.loose) || a.rank - b.rank, 'A–Z': (a, b) => (!!a.loose - !!b.loose) || a.name.localeCompare(b.name) };   // ties keep the projects' own order; On their own is always the last group
  function shelvesOf() {
    const stand = new Map(data.projects.map((p) => [p.id, standing(p)])), Q_RANK = 2.7;
    const raw = spaces().map((w) => ({ w, name: w.title, ids: w.projects.map(([id]) => id).filter((id) => stand.has(id)), qs: window.StillhetSpaces.questions(w) }));
    if (loose().length) raw.push({ w: null, loose: true, name: 'On their own', ids: loose().map((p) => p.id), qs: [] });
    raw.forEach((sh) => { sh.rank = Math.min(9, ...(sh.qs.length ? [Q_RANK] : []), ...sh.ids.map((id) => stand.get(id).rank)); });
    const ordered = [...raw].sort(RANKED['most urgent']), homeBy = new Map();   // a project's one card goes to its most urgent workspace
    for (const sh of ordered) for (const id of sh.ids) if (!homeBy.has(id)) homeBy.set(id, sh);
    return { raw, stand, homeBy, sort: (l) => [...l].sort(RANKED[sortBy]) };
  }
  const homeOf = (id) => shelvesOf().homeBy.get(id)?.w?.id;
  let sortBy = 'most urgent', figures = false, quietOpen = new Set(), pickMenu = '';
  const center = () => ({ by: adv() && view.by === 'workspace' ? 'workspace' : 'project' });
  function quietOf(key, list, noun = 'project') {
    if (!list.length) return '';
    const open = quietOpen.has(key);
    return `${R.quietLine({ n: list.length, noun, names: list.map((x) => x.name || nameOf(x.p)).join(', '), open, hook: { 'data-pc-quiet': key } })}${open && noun === 'project' ? `<div class="pg-grid">${list.map((s) => cardOf(s)).join('')}</div>` : ''}`;
  }
  const also = (s, where) => R.centerAlso({ mark: markOf(s), name: nameOf(s.p), where, link: link(`${s.verb} there`, { 'data-pc-to': s.p.id }, `Goes to its card in ${where}`) });
  function shelfHtml(sh, ctx) {
    const here = sh.ids.filter((id) => ctx.homeBy.get(id) === sh).map((id) => ctx.stand.get(id)), elsewhere = sh.ids.filter((id) => ctx.homeBy.get(id) !== sh && !ctx.stand.get(id).quiet).map((id) => ctx.stand.get(id));
    const shown = here.filter((s) => !s.quiet), quiet = here.filter((s) => s.quiet);
    const cards = ctx.sort([...shown.map((s) => ({ rank: s.rank, name: nameOf(s.p), html: cardOf(s, homesOf(s.p.id).length > 1 ? [`Also in ${homesOf(s.p.id).filter((w) => w !== sh.w).map((w) => w.title).join(', ')}`] : []) })), ...sh.qs.map((l) => ({ rank: 2.7, name: `${sh.name} ${l.from}`, html: qCard(sh.w, l) }))]);
    const top = [...shown].sort((a, b) => a.rank - b.rank)[0], topQ = sh.qs.length && (!top || top.rank > 2.7);
    const word = standsOut(top || {}) ? top.word : topQ ? R.needsReason('question') : '', tone = word ? (topQ ? 'ask' : top.tone) : '';
    const runs = shown.reduce((a, s) => a + s.running.length, 0), facts = figures && runs ? `${runs} running` : '';
    return R.centerShelf({ title: sh.name, count: figures ? `${sh.ids.length} ${sh.ids.length === 1 ? 'project' : 'projects'}` : '', link: sh.w ? link('Workspace map', { 'data-pj-go': `ws:${sh.w.id}`, 'aria-label': `Workspace map: ${sh.w.title}` }, `Opens ${sh.w.title} and how its projects connect`) : '', word, tone, facts, cards: cards.map((c) => c.html).join(''), rest: `${elsewhere.map((s) => also(s, ctx.homeBy.get(s.p.id).name)).join('')}${quietOf(`sh:${sh.name}`, quiet)}`, attrs: { 'data-pc-shelf': sh.name } });
  }
  // the home, as its named parts in its column (comp.patch-parts)
  function homeParts() {
    const ctx = shelvesOf(), { by } = center(), all = [...ctx.stand.values()], lit = all.filter((s) => standsOut(s)), questions = spaces().flatMap((w) => window.StillhetSpaces.questions(w));
    const says = (n, one, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : '');
    const running = all.reduce((a, s) => a + s.running.length, 0), facts = [says(data.projects.length, 'project'), ...(adv() ? [says(spaces().length, 'workspace'), loose().length ? `${loose().length} on their own` : ''] : []), lit.length ? `${lit.length} need${lit.length === 1 ? 's' : ''} you` : '', adv() ? says(questions.length, 'question') : '', says(all.filter((s) => s.p.origin === 'diverged').length, 'out of sync', 'out of sync'), says(all.filter((s) => s.p.origin === 'behind').length, 'older copy', 'older copies'), running ? count(`${running} running`, { show: 'running' }, 'Opens what is running in Tasks') : ''].filter(Boolean).join(' · ');
    // list.filters: labelled pickers that keep their place, and Figures as a button
    const part = (id, label, text, items, tip) => ({ id, label, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })) });
    const sent = `${R.centerFilters({ pick: pickMenu, end: R.figuresButton({ open: figures, attrs: { 'data-pc-figs': '' } }), parts: [part('pc-sort', 'Sort by', sortBy, Object.keys(RANKED), 'How the cards are ordered'), ...(adv() ? [part('pc-by', 'Group by', by, ['workspace', 'project'], 'What a shelf is')] : [])] })}${figures ? R.figuresLine(facts) : ''}`;
    const calm = !lit.length && !(adv() && questions.length);
    const head = R.placeHead({ title: 'Your projects', say: calm && data.projects.length ? 'Nothing needs you' : '' });
    const way = adv() ? '' : `<p class="center-way">New work starts in Chat. ${link('Go to Chat', { 'data-pj-chat': '' })}</p>`;
    const say2 = adv() && !spaces().length ? '<p class="ws-about">A workspace is projects that work together: Worca learns how they connect, and changes them in the right order.</p>' : '';
    const fields = R.field({ id: 'pj-hand-v', label: 'Its name', placeholder: 'Web shop', value: formTyped, error: formErr, hint: `Up to ${NAME_MAX} characters`, attrs: { maxlength: NAME_MAX, 'data-keep': 'pj-hand:space:' } });
    const hand = form === 'project' ? addCtl.html() : form ? `<div class="card-form">${R.confirmForm({ form: 'hand', id: 'pj-hand-t', text: 'Make a workspace by hand', body: fields + R.confirmActions({ yes: 'Make it' }) })}</div>` : '';
    const wrap = (parts) => ({ cls: 'is-center', parts });
    const ls = listNow();   // D18: loading and failed, in both kinds
    if (ls !== 'ready') return wrap({ head: R.placeHead({ title: 'Your projects' }), state: R.listState({ state: ls, noun: 'projects', retry: ls === 'failed' ? { 'data-pj-retry': '' } : null }) });
    if (!data.projects.length) return wrap({ head: R.placeHead({ title: 'Your projects' }), way, hand, empty: R.emptyState({ title: 'No projects yet.', actions: R.button({ label: 'Add project', attrs: { 'data-pj-add': '' } }) }) });
    if (by === 'workspace') {
      const shelves = ctx.sort(ctx.raw), busy = shelves.filter((sh) => sh.ids.some((id) => !ctx.stand.get(id).quiet && ctx.homeBy.get(id) === sh) || sh.qs.length || sh.ids.some((id) => ctx.homeBy.get(id) !== sh && !ctx.stand.get(id).quiet)), still = shelves.filter((sh) => !busy.includes(sh));
      const loud = (sh) => !!sh.w;   // a quiet workspace folds; a quiet "On their own" keeps its shelf, it is no workspace
      const fold = still.filter(loud), open = quietOpen.has('spaces');
      const stillRow = fold.length ? `<div class="center-shelf">${R.quietLine({ n: fold.length, noun: 'workspace', names: fold.map((sh) => sh.name).join(', '), open, hook: { 'data-pc-quiet': 'spaces' } })}</div>${open ? fold.map((sh) => shelfHtml(sh, ctx)).join('') : ''}` : '';
      return wrap({ head, ask: C()?.askStrip?.() || '', sent, way, say2, hand, shelves: [...busy, ...still.filter((sh) => !loud(sh))].map((sh) => shelfHtml(sh, ctx)).join(''), still: stillRow });
    }
    const flat = ctx.sort([...all.filter((s) => !s.quiet).map((s) => ({ rank: s.rank, name: nameOf(s.p), html: cardOf(s, adv() ? homesOf(s.p.id).map((w) => w.title) : []) })), ...(adv() ? spaces().flatMap((w) => window.StillhetSpaces.questions(w).map((l) => ({ rank: 2.7, name: `${w.title} ${l.from}`, html: qCard(w, l) }))) : [])]);
    const quiet = all.filter((s) => s.quiet);
    return wrap({ head, ask: C()?.askStrip?.() || '', sent, way, say2, hand, cards: `<div class="pg-grid center-flat">${flat.map((c) => c.html).join('')}</div>`, quiet: quietOf('flat', quiet) });
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'projects';   // the page area is shared by every place: draw only while this one is open
  let frameKey = '', frameCol = null;   // the frame drawn last and its column (D7)
  function draw() {
    if (!bar || !page || !here()) return;
    const items = needItems().length; if (items !== bellHeard) { bellHeard = items; window.StillhetPulse?.refresh(); }   // the bell reads the same list
    if (current.includes('@') && !adv()) { window.StillhetShell.go(`projects/${pid()}`); return; }   // "through a workspace" is an Advanced address
    ctl?.paint({ ifChanged: true });   // B2.8: an idle draw leaves the bar's rows as they are
    const scrolled = drawn === current ? page.querySelector('.convo-scroll')?.scrollTop || 0 : 0, keep = () => { drawn = current; const s = page.querySelector('.convo-scroll'); if (s) s.scrollTop = scrolled; };   // a menu opening leaves the page where it was, its picker in view
    if (current.startsWith('ws:')) { if (!adv()) { window.StillhetShell.go('projects'); return; } frameKey = ''; window.StillhetSpaces.render(page, current.slice(3)); keep(); return; }
    // F-6-19: while the store loads, the page draws from dev's project list (one read) and fills in as the store lands
    const p = data.projects.find((x) => x.id === pid()) || (W?.live && listNow() === 'loading' && pid() && LIVE()?.known(pid())) || undefined;
    // nav.not-found: loaded and not listed, the shell's not-found page (never the home, never Loading); not while an action
    // on it waits, and a turn later, so an action that just moved it routes first
    const lost = () => !data.projects.some((x) => x.id === pid()) && pid() && !busyOf(pid()) && W?.live && listNow() === 'ready' && here() && !page.hidden;
    if (!p && lost() && !notFoundSoon) { notFoundSoon = true; const at = location.hash; setTimeout(() => { notFoundSoon = false; if (location.hash === at && lost()) window.StillhetShell.go(at.slice(1)); }, 0); }
    const now = p ? { cls: '', parts: pageParts(p) } : homeParts();
    // the frame is built once per page (D7); another place or a workspace that wrote the shared page means a new one
    const key = p ? `p:${p.id}|${nameOf(p)}` : 'home';
    let col = page.querySelector(':scope > .convo > .convo-scroll > .convo-col');
    const rebuild = key !== frameKey || !col || col !== frameCol;
    if (rebuild) { page.innerHTML = frameHtml(!!p); col = frameCol = page.querySelector(':scope > .convo > .convo-scroll > .convo-col'); frameKey = key; }
    R.patchParts(col, now.parts);
    keep();
  }
  // panel.dismiss: focus returns to what opened it: Locate on the page, the bar's + otherwise
  const closeForm = () => { const was = form; if (was === 'project') addCtl.close(); form = ''; formTyped = ''; formErr = ''; draw(); (PAGE_FORMS[was] ? page.querySelector('[data-pj-act]') || page.querySelector('[data-menu="pj-more"]') : document.querySelector('[data-bar-new]'))?.focus(); };
  const formErr2 = (v, why) => { formTyped = v; formErr = why; draw(); page.querySelector('#pj-hand-v')?.focus(); };
  const REPO_RE = /^(https?:\/\/|ssh:\/\/|git@)\S+$/;
  // a page form's Yes: checked as the design does, then live through the module (a field error keeps it open), else the demo
  function pageFormYes(yes) {
    const v = page.querySelector('#pj-hand-v')?.value.trim() || '', p = data.projects.find((x) => x.id === locating), kind = form;
    if (!yes || !p) { closeForm(); return; }
    if (busyOf(p.id)) return;
    const wrong = kind === 'locate' ? (!v || v === p.path ? (v ? 'That is where it was: give where it is now' : 'It needs a folder') : pathWrong(v))
      : kind === 'rename' ? (!v ? 'It needs a name' : v.length > NAME_MAX ? `A name holds ${NAME_MAX} characters; this one has ${v.length}` : data.projects.some((x) => x.id !== p.id && nameOf(x).toLowerCase() === v.toLowerCase()) ? `${v} is already a project` : '')
        : (!v ? 'It needs its repository address' : REPO_RE.test(v) ? '' : 'Give its repository address, such as git@github.com:you/your-project.git');
    if (wrong) { formErr2(v, wrong); return; }
    if (kind === 'rename' && v === nameOf(p)) { closeForm(); return; }
    const done = (text, to) => { form = ''; formTyped = ''; formErr = ''; say(text); if (to) window.StillhetShell.go(to); else draw(); };
    if (LIVE()) {
      formTyped = v; formErr = '';
      const from = current, run = kind === 'locate' ? LIVE().relocate(p.id, v) : kind === 'rename' ? LIVE().rename(p.id, v) : LIVE().linkRemote(p.id, v);
      // D8: Locate lands on the new key once the store lists it; not listed, the Projects list (the old key may be gone); only while the person is still here
      run.then((a) => { if (a.ok) { const to = a.key && a.key !== p.id ? `projects/${a.key}` : kind === 'locate' && !a.key ? 'projects' : ''; done(a.text, current === from && here() ? to : ''); } else if (a.field) formErr2(v, a.field); else said(a); });
      draw(); return;
    }
    if (kind === 'locate') { Object.assign(p, { path: v, origin: 'ok', checked: 'just now' }); done(`${p.id} now uses ${v}`); return; }
    if (kind === 'rename') { const was = nameOf(p); p.name = v; done(`Renamed ${was} to ${v}`); return; }   // D7: the key never changes
    Object.assign(p, { origin: 'ok', base: 'origin/main' }); done('Linked origin; nothing was pushed');
  }
  function wire(b, pg) {
    bar = b; page = pg;
    // the bar (list.bar-model): what needs you first; a workspace over its projects, a healthy one folded; a project in two is under both, its address says through which
    // F-6-14: a member Worca does not know as a project is named by its folder (the workspace's stored path), its key only without one
    const kid = (w) => ([id], i) => { const p = data.projects.find((x) => x.id === id), addr = `${id}@${w.id}`, folder = R.folderName(w.paths?.[i]) || id; return p ? { ...rowOf(p), key: `proj:${id}:${w.id}`, _addr: addr, current: current === addr || (current === id && firstHome(id) === w.id) } : { key: `m:${id}:${w.id}`, _addr: '', title: folder, mark: R.kindMark({ kind: 'project' }), end: '', tip: `${folder}: a folder in this workspace` }; };
    const worst = (w) => { const kids = w.projects.map(([id]) => data.projects.find((p) => p.id === id)).filter(Boolean).map(standing).filter(standsOut).sort((a, b) => a.rank - b.rank)[0], q = window.StillhetSpaces.questions(w).length; return kids && (!q || kids.rank <= 2.7) ? { word: kids.word, tone: kids.tone, level: R.alertLevel(kids.tone) } : q ? { word: R.needsReason('question'), tone: 'ask', level: 2 } : { word: '', tone: 'idle', level: 0 }; };   // a workspace at its worst child
    const spaceRow = (w) => ({ key: `ws:${w.id}`, _w: w, title: w.title, mark: R.kindMark({ kind: 'workspace', tone: worst(w).tone, advisory: worst(w).tone === 'ok', breathe: worst(w).level > 0 && `ws:${w.id}` !== current }), end: worst(w).word, current: `ws:${w.id}` === current, tip: `${w.title}\n${window.StillhetSpaces.hint(w)}`, tree: w.projects.map(kid(w)), treeShut: worst(w).level === 0, menu: window.StillhetSpaces.menu(w, true) });
    const treeOn = () => adv() && view.by === 'workspace';
    ctl = R.listController({ root: bar, spec: { noun: 'projects', label: 'Selected projects', retry: () => window.StillhetAdapter?.retry?.(), view: () => { const test = SHOWS.find((x) => x.id === view.show).test;
      const parts = [{ word: 'Showing', id: 'show', text: SHOWS.find((x) => x.id === view.show).text, tip: 'Which projects the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, help: x.id === 'needs' ? placeNeeds()?.tip : undefined, checked: view.show === x.id, hint: String(x.id === 'needs' ? needCount() : data.projects.filter(x.test).length) })) }, ...(adv() ? [{ word: 'by', id: 'by', text: view.by, tip: 'How they are grouped', items: ['workspace', 'name'].map((x) => ({ id: x, text: x, checked: view.by === x })) }] : [])];
      if (treeOn()) { const needsS = (w) => w.projects.some(([id]) => data.projects.some((p) => p.id === id && ownNeed(p))) || window.StillhetSpaces.questions(w).length > 0, keep = (w) => view.show === 'all' || (view.show === 'needs' && needsS(w)) || w.projects.some(([id]) => { const p = data.projects.find((x) => x.id === id); return p && test(p); }), filt = (r) => ({ ...r, tree: view.show === 'all' ? r.tree : r.tree.filter((c) => { const p = c._p; return p && test(p); }) });
        const L = loose().filter(test);
        const out = { state: listNow(), parts, sections: [{ id: 'needs', title: R.runState('question').word, count: needCount(), rows: [...spaces().filter((w) => needsS(w) && keep(w)).map(spaceRow).map(filt).map((r) => { const w2 = r._w.id, t = r.tree.filter((c) => (c._p && (ownNeed(c._p) || needs(c._p)) && (homeOf(c._p.id) === w2)) || c.current); const left = r.tree.length - t.length; if (!left) return r; if (showAll.has(w2)) return { ...r, tree: [...r.tree, { key: `less:${w2}`, _less: w2, title: 'Show fewer', mark: '', end: '', tip: `Back to what needs you in ${r.title}` }] }; return { ...r, tree: [...t, { key: `more:${w2}`, _more: w2, title: `${left} more`, mark: '', end: '', tip: `Shows the other ${left} projects of ${r.title}` }] }; }), ...L.filter(ownNeed).map(rowOf)] }, { id: 'spaces', title: 'Workspaces', rows: spaces().filter((w) => !needsS(w) && keep(w)).map(spaceRow).map(filt) }, { id: 'loose', title: 'On their own', rows: L.filter((p) => !ownNeed(p)).map(rowOf) }].filter((x) => x.rows.length), empty: { text: 'No projects yet.', action: 'Add project' } };
        // red above amber (look.alert-ladder); the count is this place's part of the one count
        const lvl = (r) => (r._w ? worst(r._w).level : r._p ? R.alertLevel(standing(r._p).tone) : 0);
        const nd = out.sections.find((s) => s.id === 'needs');
        if (nd) { nd.rows.sort((a, b) => lvl(b) - lvl(a)); nd.count = needCount(); }
        return out; }
      const l = data.projects.filter(test).sort((a, b) => (view.by === 'name' ? nameOf(a).localeCompare(nameOf(b)) : 0));
      return { state: listNow(), parts, sections: [{ id: 'needs', title: R.runState('question').word, count: needCount(), rows: l.filter(ownNeed).sort((a, b) => standing(a).rank - standing(b).rank).map(rowOf) }, { id: 'all', title: 'Projects', rows: l.filter((p) => !ownNeed(p)).map(rowOf) }].filter((x) => x.rows.length), empty: { text: 'No projects yet.', action: 'Add project' } }; },
      can: () => ['menu'], bulk: () => [], act: (id, rows) => { if (rows[0]?._w) window.StillhetSpaces.act(id, rows[0]._w); else act(id, rows); }, open: (r) => { if (r._more) { showAll.add(r._more); ctl.paint(); return; } if (r._less) { showAll.delete(r._less); ctl.paint(); return; } if (r._w) window.StillhetShell.go(`projects/ws:${r._w.id}`); else if (r._addr) window.StillhetShell.go(`projects/${r._addr}`); else if (r._p) window.StillhetShell.go(`projects/${r._p.id}`); else say(`${r.title} is a folder in this workspace, not added as a project`); }, word: (id, v) => { view[id] = v; if (id === 'by') draw(); return false; }, say,
      active: () => /^#projects/.test(location.hash), emptyAct: () => window.StillhetConversation?.starter('project') } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit;
      if (form === 'project' && !current) { const took = addCtl.click(e.target); if (took === 'close') closeForm(); if (took) return; }   // form.add-project: its ways, its browser, its review
      if (on('[data-c-ask]')) return;   /* the center card's ConfirmStrip answers in centers.js */
      if ((hit = on('[data-pj-home-act]'))) { const x = data.projects.find((y) => y.id === hit.dataset.pjHomeAct); if (x) originAct(x); return; }
      if (on('[data-pc-figs]')) { figures = !figures; draw(); return; }
      if ((hit = on('[data-pc-quiet]'))) { const k = hit.dataset.pcQuiet; if (quietOpen.has(k)) quietOpen.delete(k); else quietOpen.add(k); draw(); return; }
      if ((hit = on('[data-pc-to]'))) { const c = page.querySelector(`[data-pc-card="${CSS.escape(hit.dataset.pcTo)}"]`); c?.scrollIntoView({ block: 'center' }); R.land(c); return; }
      if (on('[data-pj-chat]')) { window.StillhetShell.go('chat'); return; }
      if (on('[data-pj-add]')) { window.StillhetConversation?.starter('project'); return; }
      if (on('[data-pj-retry]')) { window.StillhetAdapter?.retry?.(); return; }   // D18
      if ((hit = on('[data-pick^="pc-"]'))) { const [id, v] = hit.dataset.pick.split('|'); pickMenu = ''; if (id === 'pc-sort') sortBy = v; else view.by = v === 'project' ? 'name' : 'workspace'; draw(); page.querySelector(`[data-menu="${id}"]`)?.focus(); return; }
      if ((hit = on('[data-menu^="pc-"]'))) { pickMenu = pickMenu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); return; }
      if ((hit = on('[data-pj-open]'))) { const [cid, title] = hit.dataset.pjOpen.split('|'); const t = window.StillhetChats.data().chats.find((c) => c.id === cid)?.tasks.find((x) => x.title === title); window.StillhetShell.openTask(t?.case || '', cid, title, W?.live ? t?.pid || t?.run : undefined); return; }
      if ((hit = on('[data-pj-go]'))) { if (hit.matches('.pg-card') && (on('button, a, input, .rc-confirm') || String(getSelection())) ) return;   /* a card opens its project; a control inside it does its own thing */ window.StillhetShell.go(`projects/${hit.dataset.pjGo}`); return; }
      if (current.startsWith('ws:')) return;   // the workspace has its own
      if (PAGE_FORMS[form] && (hit = on('[data-confirm]'))) { pageFormYes(hit.dataset.confirm === 'yes'); return; }
      if (form && (hit = on('[data-confirm]'))) { const v = page.querySelector('#pj-hand-v')?.value.trim() || ''; if (hit.dataset.confirm !== 'yes') { closeForm(); return; } const wrong = !v ? 'It needs a name' : window.StillhetSpaces.named(v) ? `${window.StillhetSpaces.named(v).title} already exists` : ''; if (wrong) { formErr2(v, wrong); return; }
        form = ''; formTyped = ''; formErr = ''; const wsId = window.StillhetSpaces.add({ title: v, fresh: true }); window.StillhetShell.go(`projects/ws:${wsId}`); return; }
      if ((hit = on('[data-pj-go-place]'))) { window.StillhetShell.go(hit.dataset.pjGoPlace); return; }   // Insights › Team, Settings › Team policy
      const early = W?.live && listNow() === 'loading' ? LIVE()?.known(pid()) : null;   // F-6-19: the page drawn before the store loads
      const p0 = data.projects.find((x) => x.id === pid()) || early; if (!p0 || !page.querySelector('[data-pj-page]')) return;
      const p = withDetail(p0);
      if (defaultsClick(e, p, draw)) return;      if (on('[data-pj-spend]')) { window.StillhetPlaces.insights.spendOf(nameOf(p)); return; }
      if ((hit = on('.pj-tabs [data-tab], [data-pj-tab]'))) { tab = hit.dataset.tab || hit.dataset.pjTab; sub = null; menu = ''; draw(); page.querySelector(`#pjtab-${tab}`)?.focus(); return; }
      if (on('[data-pj-ask]')) { window.StillhetConversation?.handOver({ project: p.id, ref: { pageProjectKey: p.id }, about: { kind: 'Project', name: nameOf(p) }, ph: `Ask about ${nameOf(p)}` }); return; }
      if (!isLive() && tabClick(e, p)) return;
      if ((hit = on('[data-pj-act]'))) { originAct(p); return; }
      if ((hit = on('[data-pj-reset]')) && LIVE()) { LIVE().resetSet(p.id, hit.dataset.pjReset).then((a) => { say(a.ok ? 'Back to yours' : a.text); draw(); }); draw(); return; }
      if ((hit = on('[data-pj-team]')) && LIVE()) { if (p.off) return; const want = !p.teamMemory; LIVE().teamMemory(p.id, want).then((a) => { say(a.ok ? (want ? 'Team memory on' : 'Team memory off') : a.text); draw(); }); draw(); return; }   // a refusal keeps the switch
      if ((hit = on('[data-pj-reset]'))) { delete p.sets[hit.dataset.pjReset]; draw(); say('Back to yours'); return; }
      if ((hit = on('[data-pj-team]'))) { p.teamMemory = !p.teamMemory; if (p.sets) delete p.sets.memory; draw(); say(p.teamMemory ? 'Team memory on' : 'Team memory off'); return; }
      if ((hit = on('[data-confirm]')) && LIVE()) { if (hit.dataset.confirm === 'yes') { const u = LIVE().deferRemove(p.id, UNDO_MS), name = nameOf(p); confirm = null; current = ''; say(`Removed ${name}`, { tip: 'Puts it back', run: () => { if (!u.undo()) say(`Too late to undo: ${name} is being removed`); } }); window.StillhetShell.go('projects'); } else { confirm = null; draw(); } return; }   // D10: DELETE once the undo window closes
      if ((hit = on('[data-confirm]'))) { if (hit.dataset.confirm === 'yes') { const i = data.projects.indexOf(p), back = window.StillhetSpaces?.forget(p.id); data.projects.splice(i, 1); confirm = null; current = ''; say(`Removed ${p.id}`, { tip: 'Puts it back', run: () => { data.projects.splice(i, 0, p); back?.(); draw(); } }); window.StillhetShell.go('projects'); } else { confirm = null; draw(); } return; }
      if ((hit = on('[data-pj-menu]'))) { act(hit.dataset.pjMenu, [{ _p: p }]); return; }
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
        if (id === 'pj-more') { act(v, [{ _p: p }]); return; }
        if (id.startsWith('pj-pay-') && LIVE()) { if (v !== 'ask' && p.persist) p.persist({ tags: [...(p.tags || []), v], labels: p.labels || [] }, `New tasks here charge ${v}`); else draw(); return; }
        if (id.startsWith('pjs-') && LIVE()) { const x = SETS.find((s) => s.id === id.slice(4)), now = LIVE().detail(p.id).sets?.[x.id]?.value; if (now === v) { draw(); return; } LIVE().setSet(p.id, x.id, v).then((a) => { say(a.ok ? `${x.name} for ${nameOf(p)}: ${v}` : a.text); draw(); }); draw(); return; }
        if (id.startsWith('pj-pay-')) { if (v !== 'ask') { const was = p.tags || []; p.tags = [...was, v]; draw(); say(`New tasks here charge ${v}`, () => { p.tags = was; draw(); }); } else draw(); return; }
        if (id.startsWith('pjs-')) { const x = SETS.find((s) => s.id === id.slice(4)); if ((p.sets?.[x.id] || defOf(p, x)) === v) { draw(); return; } p.sets = p.sets || {}; p.sets[id.slice(4)] = v; draw(); say(`${SETS.find((x) => x.id === id.slice(4)).name} for ${p.id}: ${v}`); return; }
      }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    page.addEventListener('keydown', (e) => {
      if (!here() || current.startsWith('ws:')) return;
      if (form === 'project') { const took = addCtl.key(e); if (took === 'close') closeForm(); if (took) return; }
      if (form && e.target.id === 'pj-hand-v' && ['Enter', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') closeForm(); else page.querySelector('[data-confirm="yes"]')?.click(); return; }
      // the tabs: arrows move, as a tablist does; Escape leaves a tab's small form
      const t = e.target.closest?.('.pj-tabs [role="tab"]'); if (t && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const all = [...page.querySelectorAll('.pj-tabs [role="tab"]')], i = all.indexOf(t); (e.key === 'Home' ? all[0] : e.key === 'End' ? all[all.length - 1] : all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length]).click(); return; }
      if (sub && e.key === 'Enter' && e.target.matches('[data-pj-sub] input')) { e.preventDefault(); e.stopPropagation(); page.querySelector('[data-pj-sub] [data-confirm="yes"]')?.click(); return; }   // two fields: Enter still saves
      if (sub && e.key === 'Escape' && e.target.closest('[data-pj-sub]')) { e.preventDefault(); e.stopPropagation(); page.querySelector('[data-pj-sub] [data-confirm]:not([data-confirm="yes"])')?.click(); return; }
      const p = data.projects.find((x) => x.id === pid()); if (p) defaultsKey(e, p, draw);
    });
    page.addEventListener('submit', (e) => { if (here() && form) e.preventDefault(); if (here() && sub && e.target.closest('[data-pj-sub]')) { e.preventDefault(); e.target.querySelector('[data-confirm="yes"]')?.click(); } });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
    R.dismissOnOutside(document, { open: () => here() && !!pickMenu, inside: '#route-place .spick, #route-place .pz-pick', back: () => null, close: () => { pickMenu = ''; }, paint: draw });
  }
  // a half-typed cost tag or label does not wait for you on another page
  window.addEventListener('hashchange', () => { [...data.projects, ...(window.StillhetSpaces?.list() || [])].forEach((x) => { delete x.editing; delete x.defErr; delete x.defTyped; });
    // an open form belongs to its own route: moving anywhere else closes it, so its text never waits for you (comp.keep-open)
    const [place, arg = ''] = location.hash.slice(1).split('/');
    if (place !== 'projects') away = true;   // D11: coming back, even to the same project, is a new open
    if (form && (place !== 'projects' || arg.split('@')[0] !== formAt)) { if (form === 'project') addCtl.close(); form = ''; formTyped = ''; formErr = ''; } });
  // a Pulse item opens its project with the fix in view: Locate folder's form, else the head's fix landed, else (a task
  // question holds the head) the More menu open on it; a project that no longer needs you only opens
  function openNeed(id) {
    const p = data.projects.find((x) => x.id === id); if (!p) { window.StillhetShell.go(`projects/${id}`); return; }
    if (p.origin === 'missing') { openForm('locate', p, p.path); return; }
    window.StillhetShell.go(`projects/${id}`);
    setTimeout(() => {
      if (pid() !== id || !page) return;
      const fix = page.querySelector('[data-pj-act]');
      if (fix) { R.land(fix); return; }   // R.land focuses it
      if (!waitsOf(p).length || !actItem(p).length) return;
      menu = 'pj-more'; draw();
      const item = page.querySelector('[data-menu-pick="pj-more|act"]'); R.land(item);
    }, 60);
  }
  // form.add-project (COV-1): every way classic adds a project, in project-add.js
  const addCtl = window.StillhetProjectAdd.make({ R, live: LIVE, onLive: isLive, say, said, go: (to) => window.StillhetShell.go(to), draw: () => draw(), projects: () => data.projects, nameOf, pathWrong,
    end: () => { form = ''; formTyped = ''; formErr = ''; }, addDemo: (p) => { if (!data.projects.some((x) => x.id === p.id)) data.projects.push({ kind: 'Git', origin: 'local', branch: 'main', ...p }); ctl?.paint(); } });
  window.StillhetProjects = { nameOfKey: (id) => keyName(id), needItems, openNeed, all: () => data.projects, editTags: (id) => { window.StillhetShell.go(`projects/${id}`); setTimeout(() => { const p = data.projects.find((x) => x.id === id); if (!p) return; p.editing = 'tags'; draw(); document.getElementById('def-tags')?.focus(); }, 80); }, sync: (id) => { if (LIVE()) { LIVE().origin(id, 'sync').then(said); return; } const p = data.projects.find((x) => x.id === id); if (p?.origin === 'behind') Object.assign(p, { origin: 'ok', behind: 0, checked: 'just now' }); }, spend: (id) => { const p = data.projects.find((x) => x.id === id); return (p ? spendOf(p) : monthOf(id)?.spend) || 0; }, hint: (id) => { const p = data.projects.find((x) => x.id === id); return p ? (p.origin === 'behind' ? `${p.behind} behind` : shortOf(p) || '') : ''; }, list: () => data.projects, add: (p) => { if (LIVE()) { LIVE().addProject(p.path || p.id).then(said); return; } if (!data.projects.some((x) => x.id === p.id)) data.projects.push({ kind: 'Git', origin: 'local', branch: 'main', ...p }); ctl?.paint(); } };
  if (window.StillhetFirstRun) data.projects = [];   // the first run: nothing added yet
  window.StillhetPlaces = window.StillhetPlaces || {};
  window.StillhetPlaces.projects = { has: (a) => (!!W?.live && listNow() !== 'ready') || (a.startsWith('ws:') ? (window.StillhetSpaces?.list() || []).some((w) => w.id === a.slice(3)) : data.projects.some((p) => p.id === a.split('@')[0])), defaults: defaultsRows, defaultsClick, defaultsKey, redraw: () => draw(), get newMenu() { return adv() ? newMenuItems : null; }, get newAct() { return adv() ? () => window.StillhetConversation?.starter('project') : null; }, get newLabel() { return adv() ? 'Add project' : ''; }, newPick: (id) => { if (id === 'project' || id === 'workspace') { window.StillhetConversation?.starter(id); return; } window.StillhetShell.closeDrawer?.(); form = id === 'hand-project' ? 'project' : 'space'; formAt = '';   /* F-cov1-04: the bar's drawer never stays over the form */ if (form === 'project') addCtl.open('folder'); if (current) window.StillhetShell.go('projects'); setTimeout(() => { draw(); page?.querySelector('#pj-hand-v')?.focus(); }, 60); }, search: (q) => [...data.projects.filter((p) => `${nameOf(p)} ${p.path}`.toLowerCase().includes(q)).map((p) => ({ label: nameOf(p), where: wordOf(p), hash: `projects/${p.id}` })), ...spaces().filter((w) => w.title.toLowerCase().includes(q)).map((w) => ({ label: w.title, where: 'Workspace', hash: `projects/ws:${w.id}` }))], sample: 'billing-api',
    show: ({ bar: b, page: pg, arg }) => { window.StillhetCenters?.wire(); if (b !== bar) wire(b, pg); if ((current || '').split('@')[0] !== (arg || '').split('@')[0]) { tab = 'overview'; sub = null; histOpen = false; } if (current !== arg) { menu = ''; window.StillhetCenters?.unask?.(); if (confirm?.p?.id !== arg) confirm = null; if (PAGE_FORMS[form] && (arg || '').split('@')[0] !== locating) { form = ''; formTyped = ''; formErr = ''; } } if ((current !== arg || away) && arg && !arg.startsWith('ws:')) LIVE()?.refacts(arg.split('@')[0]);   /* D11: its facts are read on each open, a return from another place included */ away = false; current = arg || ''; draw(); } };
  const newMenuItems = () => [{ id: 'bar-new|hand-project', text: 'Add a project…' }, ...(adv() ? [{ id: 'bar-new|hand-space', text: 'Make a workspace…' }] : []), { sep: true }, { header: 'Ask in chat' }, { id: 'bar-new|project', text: 'Add a project' }, ...(adv() ? [{ id: 'bar-new|workspace', text: 'Make a workspace' }] : [])];
})();
