// The Tasks and Schedules centers (Wave 3; docs/rail/panels.md › panel.center; mocks plans/rail/mocks/wave-3/tasks-center, schedules-center):
// the landing page of each, cards from the one store, so a card changes when its task or schedule does. And the two Legacy
// approach forms (rail.chat-first), as Dialogs. Everything drawn comes from the library; this says what each thing is.
(function () {
  const R = window.RailUI, W = window.RailWorld, RM = window.RunCardModel;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const usd = (n) => `$${n.toFixed(2)}`;
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const advanced = () => R.shows('advanced');
  const List = () => window.RailRunsList, Sch = () => window.RailSchedules;
  const WEEK = { from: 1102, to: 1108, label: 'this week' };   // Monday to today, in the list's own date keys: the seven real days the figure opens
  const inWeek = (t) => { const d = List().dateOf(t); return d >= WEEK.from && d <= WEEK.to; };
  const chev = R.icon('chevron', 10);
  const link = (label, hook, tip) => R.textLink({ label, attrs: { ...hook, title: tip || null } });
  const count = (label, hook, tip) => link(label, hook, tip);   // a number that opens what it counts (quiet until hovered: rail.css)
  const filterHook = (f) => ({ 'data-c-filter': JSON.stringify(f) });
  let menu = '', tasksHost = null, schedHost = null, quietOpen = false;
  let view = { sort: 'most urgent', by: 'project', sSort: 'most urgent', from: '' }, figs = { tasks: false, sched: false };

  // ---- what a task is on a card ----
  const costOf = (t) => (t.run ? t.run.cost || 0 : W.membersOf(t.group).reduce((a, m) => a + (m.cost || 0), 0));
  const taskOf = (t) => t.run || (t.group ? W.membersOf(t.group).find(W.raises) || W.membersOf(t.group)[0] : null);
  const stateOf = (r) => RM.stateOf(r.case);
  const RANK = R.taskRank;
  const stepOf = (detail) => (detail || '').split(' · ')[0];
  const clause = (r) => R.taskClause({ state: stateOf(r), name: link(r.title, { 'data-c-open': r.id }, `Opens ${r.title} in its chat`), detail: r.detail || '' });
  const actionsOf = (rs) => R.taskActions(rs.map((t) => ({ id: t.id, title: t.title, short: t.short, state: stateOf(t) })));
  const schedLink = (s) => (advanced() ? link(s.title, { 'data-c-sched': s.id }, `Opens ${s.title}`) : esc(s.title));   // Simple: Schedules is locked, so no links lead there

  // ---- the Tasks center ----
  const inFrom = (project) => { const f = List().from(); return f === 'all' || (project || 'No project') === f; };   // the list's "from": the page shows the same project
  const fromRows = () => List().rows().filter((t) => inFrom(t.project));
  function groups() {
    const rows = fromRows(), key = (t) => (view.by === 'workflow' ? t.workflow || 'Default' : t.project || 'No project');
    const map = new Map();
    const of = (k) => { if (!map.has(k)) map.set(k, { name: k, rows: [], missed: [], live: [] }); return map.get(k); };
    rows.forEach((t) => of(key(t)).rows.push(t));
    for (const s of Sch().all()) {
      if (!inFrom(s.project)) continue;
      const k = view.by === 'workflow' ? s.workflow || 'Default' : s.project || 'No project';
      if (s.section === 'needs') of(k).missed.push(s); else if (Sch().running(s.id)) of(k).live.push(s);
    }
    return [...map.values()].map((g) => {
      const c = (sec) => g.rows.filter((t) => t.section === sec);
      const recent = c('recent').filter(inWeek);
      const needs = c('needs').filter((t) => taskOf(t)).sort((a, b) => RANK(stateOf(taskOf(a))) - RANK(stateOf(taskOf(b))));
      return { ...g, needs, running: c('running'), waiting: c('scheduled'), recent, cost: g.rows.filter(inWeek).reduce((a, t) => a + costOf(t), 0), quiet: !needs.length && !g.missed.length && !c('running').length };
    });
  }
  const urgency = (g) => (g.needs.length ? RANK(stateOf(taskOf(g.needs[0]))) : g.missed.length ? 2.5 : g.running.length || g.live.length ? 5 : 6);
  const SORTS = { 'most urgent': (a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name), 'most spent': (a, b) => b.cost - a.cost, 'A–Z': (a, b) => a.name.localeCompare(b.name) };
  const groupFilter = (g, more = {}) => ({ ...(view.by === 'workflow' ? { workflow: g.name } : { project: g.name }), ...more });
  function factsOf(g) {
    const parts = [[g.running.length, 'running', { show: 'running' }], [g.waiting.length, 'waiting', { show: 'waiting' }]];
    if (g.recent.length) parts.push([g.recent.length, g.recent.every((t) => t.word === 'Merged') ? 'merged' : 'finished', { show: 'finished', range: WEEK }]);
    const nums = parts.filter(([n]) => n).map(([n, w, f]) => [`${n} ${w}`, f]);
    if (g.cost > 0) nums.push([`${usd(g.cost)} this week`, { range: WEEK }]);
    return { html: nums.map(([t, f]) => count(t, filterHook(groupFilter(g, f)), `Opens the ${t} in Tasks`)).join(' · '), tip: nums.map(([t]) => t).join(' · ') };
  }
  function actionOf(g) {
    const top = g.needs[0] && taskOf(g.needs[0]);
    if (top) return actionsOf(g.needs.slice(0, 2).map(taskOf).filter(Boolean));   // the one action, named when two things wait
    if (g.missed.length) return R.button({ label: 'Run now', attrs: { 'data-c-sact': `run|${g.missed[0].id}`, title: `Runs ${g.missed[0].title} now to catch up` } });
    return R.button({ label: 'Open', attrs: { 'data-c-filter': JSON.stringify(groupFilter(g)), title: `Opens ${g.name}'s tasks` } });
  }
  // one card per level (look.alert-ladder): Advisory never rides under Caution, a missed time and what runs each have their own
  const isReady = (t) => ['ready', 'approved'].includes(stateOf(taskOf(t)));
  function partsOf(g) {
    const lit = g.needs.filter((t) => !isReady(t)), ready = g.needs.filter(isReady), only = (o) => ({ ...g, needs: [], missed: [], live: [], running: [], ...o });
    const parts = [...(lit.length ? [only({ needs: lit })] : []), ...(ready.length ? [only({ needs: ready })] : []), ...(g.missed.length ? [only({ missed: g.missed })] : []), ...(!g.needs.length && (g.running.length || g.live.length) ? [only({ running: g.running, live: g.live })] : [])];
    return parts.length ? parts : [g];
  }
  function cardOf(g) {
    const top = g.needs[0] && taskOf(g.needs[0]), st = top ? R.runState(stateOf(top)) : null;
    const word = top ? R.needsReason(stateOf(top)) : g.missed.length ? 'Missed' : g.running.length || g.live.length ? R.runState('working').word : 'Quiet';
    const tone = top ? R.markTone(st) : g.missed.length ? 'act' : g.running.length || g.live.length ? 'run' : 'idle';
    const what = [...g.needs.slice(0, 2).map((t) => clause(taskOf(t))), ...g.missed.map((s) => `${schedLink(s)} missed ${esc(s.missed)}`), ...g.live.map((s) => `${schedLink(s)} is running`)].slice(0, 2);
    const running = !what.length && g.running[0] && taskOf(g.running[0]);
    const facts = factsOf(g);
    const kind = top || g.running.length || g.live.length ? 'task' : g.missed.length ? 'schedule' : view.by === 'workflow' ? 'workflow' : 'project';   // the mark says how it stands (list.kind-mark)
    return R.pluginCard({ mark: R.kindMark({ kind, tone, advisory: tone === 'ok', breathe: !!(top || g.missed.length) }), word, tone, title: g.name,
      whatHtml: what.join('; ') || (running ? `${link(running.title, { 'data-c-open': running.id })} is running` : 'Nothing is going on here.'), action: actionOf(g), attrs: { title: facts.tip } });
  }
  const picker = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: chev });
  function tasksHtml() {
    const rows = fromRows(), all = groups().sort(SORTS[view.sort]);
    if (!rows.length) return wrap(`${R.placeHead({ title: 'Your tasks', facts: 'New work starts in Chat' })}${R.emptyState({ title: 'No tasks yet.', actions: R.button({ label: 'Go to Chat', kind: 'quiet', attrs: { 'data-c-chat': '' } }) })}`);
    const cost = rows.filter(inWeek).reduce((a, t) => a + costOf(t), 0);
    const shown = all.filter((g) => !g.quiet).flatMap(partsOf).sort(SORTS[view.sort]), quiet = all.filter((g) => g.quiet);
    const facts = `${count(plural(rows.length, 'task'), filterHook({}), 'Opens every task')}${cost > 0 ? ` · ${count(`${usd(cost)} this week`, filterHook({ range: WEEK }), 'Opens this week\'s tasks')}` : ''}`;
    const sent = R.centerSentence({ words: `Showing ${picker('c-sort', view.sort, Object.keys(SORTS), 'How the cards are ordered')} by ${picker('c-by', view.by, ['project', 'workflow'], 'What a card is')}`, open: figs.tasks, attrs: { 'data-c-figs': 'tasks' }, facts });
    const calm = !all.some((g) => g.needs.length || g.missed.length);
    const way = advanced() ? '' : `<p class="center-way">New work starts in Chat. ${link('Go to Chat', { 'data-c-chat': '' })}</p>`;
    const noun = view.by === 'workflow' ? 'workflow' : 'project';
    const quietFacts = (() => { return quiet.map((g) => g.name).join(', '); })();
    const quietRow = quiet.length ? `${R.quietLine({ n: quiet.length, noun, names: quietFacts, open: quietOpen, hook: { 'data-c-quiet': '' } })}${quietOpen ? `<div class="pg-grid">${quiet.map(cardOf).join('')}</div>` : ''}` : '';
    return wrap(`${R.placeHead({ title: 'Your tasks', say: calm ? 'Nothing needs you' : '' })}${sent}${way}<div class="pg-grid">${shown.map(cardOf).join('')}</div>${quietRow}`);
  }
  const wrap = (body) => `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center">${body}</div></div></div>`;

  // ---- the Schedules center ----
  const OUT = (r) => { const t = RM.stateOf(r.case); return t === 'failed' ? 'fail' : R.sectionOf(R.runState(t).word) === 'running' ? 'run' : 'ok'; };
  const sectionNow = (s) => (Sch().running(s.id) ? 'running' : s.state === 'paused' ? 'paused' : s.section === 'needs' ? 'needs' : 'next');
  const DEFAULT_TZ = 'Europe/Sofia';
  const SCHED_RANK = { needs: 0, running: 1, next: 2, paused: 3 };
  const nextDate = (s) => Sch().nextDates(s)[0];
  const SCHED_SORTS = { 'most urgent': (a, b) => SCHED_RANK[sectionNow(a)] - SCHED_RANK[sectionNow(b)] || nextDate(a) - nextDate(b), 'next to run': (a, b) => (a.state === 'paused') - (b.state === 'paused') || nextDate(a) - nextDate(b), 'A–Z': (a, b) => a.title.localeCompare(b.title) };
  function schedLine(s) {
    const week = s.runs.filter((r) => r.case !== 'stopped').slice(0, 7).reverse(), done = week.filter((r) => OUT(r) !== 'run'), won = done.filter((r) => OUT(r) === 'ok').length, sec = sectionNow(s);
    const failed = done.filter((r) => OUT(r) === 'fail').at(-1);
    if (sec === 'needs') return R.runOutcomes({ runs: ['miss'], says: esc(`Runs again ${Sch().dateWord(nextDate(s))}; run now to catch up`) });
    if (!week.length && sec === 'paused') return R.runOutcomes({ runs: [], says: 'No runs in 7 days' });
    if (!week.length) return R.runOutcomes({ runs: [], says: s.started === Sch().dateWord(Sch().TODAY) ? `Started ${esc(s.started)} · no runs yet` : 'No runs in 7 days' });
    const num = done.length ? count(failed ? `${won} of ${done.length}` : `${won} of ${done.length} succeeded`, filterHook({ schedule: s.id, show: 'finished' }), `Opens the ${won} that succeeded in Tasks`) : '';
    const pre = s.started === 'Nov 9' || week.length < 7 ? `Started ${esc(s.started)}${num ? ' · ' : ''}` : '';
    const fixed = failed && done.at(-1) !== failed && OUT(done.at(-1)) === 'ok';   // a past failure a later run fixed (look.alert-ladder)
    const fail = failed ? ` · ${link(`failed ${failed.date}${fixed ? '' : ` at ${stepOf(failed.meta).replace(/^Failed at /, '')}`}`, { 'data-c-srun': `${s.id}|${s.runs.indexOf(failed)}` }, 'Opens that run')}${fixed ? ' · next run passed' : ''}` : '';
    const pr = !failed && done[0] && /#\d+/.exec(done.at(-1)?.meta || '');
    return R.runOutcomes({ runs: week.map(OUT), says: `${pre}${num}${fail}${pr ? ` · merged ${pr[0]}` : ''}${week.length !== done.length ? ` · last ${week.length} runs` : ''}` });
  }
  function schedCard(s) {
    const sec = sectionNow(s), run = Sch().runningRun(s), next = Sch().nextLine(s);
    const [word, kicker, tone] = sec === 'needs' ? ['Missed', `${s.missed}, ${s.at} · ${s.missedWhy}`, 'act'] : sec === 'running' ? [R.runState('working').word, `for ${!run.time || run.time === 'now' ? 'a moment' : run.time}`, 'run'] : sec === 'paused' ? ['Paused', 'by you', 'idle'] : ['Next up', next, 'idle'];
    const fact = esc(`${s.project || 'No project'} · ${R.scheduleWords(s).says}${s.tz && s.tz !== DEFAULT_TZ ? ` ${s.tz}` : ''}`);
    const act = sec === 'needs' ? ['Run now', 'run', ''] : sec === 'running' ? ['Stop', 'stop', 'quiet'] : sec === 'paused' ? ['Resume', 'pause', 'quiet'] : ['Run now', 'run', 'quiet'];
    return R.pluginCard({ mark: R.kindMark({ kind: 'schedule', tone: sec === 'needs' ? 'act' : sec === 'paused' ? 'pause' : sec === 'running' ? 'run' : 'idle', breathe: sec === 'needs' }), word, kicker, tone, title: s.title, titleHtml: link(s.title, { 'data-c-sched': s.id }, `Opens ${s.title}`), what: s.what || R.scheduleWords(s).says, line: schedLine(s), factsHtml: fact, factsTip: fact, action: R.button({ label: act[0], kind: act[2], attrs: { 'data-c-sact': `${act[1]}|${s.id}`, title: `${act[0]}: ${s.title}` } }), attrs: { 'data-c-card': s.id, title: s.cost ? `${usd(s.cost)} a run` : null } });
  }
  function schedulesHtml() {
    const all = Sch().all(), list = all.filter((s) => (!view.from || (s.project || 'No project') === view.from) && (Sch().showing() === 'all' || s.state === 'paused')).sort(SCHED_SORTS[view.sSort]);
    if (!all.length) return wrap(`${R.placeHead({ title: 'Your schedules', facts: 'New work starts in Chat' })}${R.emptyState({ title: 'No schedules yet.', actions: R.button({ label: 'Schedule a task', kind: 'quiet', attrs: { 'data-c-new': 'schedule' } }) })}`);
    const runs = all.flatMap((s) => s.runs.filter((r) => r.case !== 'stopped').slice(0, 7)).filter((r) => OUT(r) !== 'run'), won = runs.filter((r) => OUT(r) === 'ok').length;
    const facts = [esc(plural(all.length, 'schedule')), runs.length ? count(`${won} of ${runs.length} runs succeeded in 7 days`, filterHook({ schedule: 'any', show: 'finished' }), 'Opens the runs that succeeded in Tasks') : '', `times in ${DEFAULT_TZ}${all.some((s) => s.tz && s.tz !== DEFAULT_TZ) ? ', unless a card says' : ''}`].filter(Boolean).join(' · ');
    const projects = ['every project', ...new Set(all.map((s) => s.project || 'No project'))];
    const sent = R.centerSentence({ words: `Showing ${picker('c-ssort', view.sSort, Object.keys(SCHED_SORTS), 'How the cards are ordered')} from ${picker('c-sfrom', view.from || 'every project', projects, 'Which project')}`, open: figs.sched, attrs: { 'data-c-figs': 'sched' }, facts });
    return wrap(`${R.placeHead({ title: 'Your schedules' })}${sent}${list.length ? `<div class="pg-grid">${list.map(schedCard).join('')}</div>` : R.emptyState({ title: 'No paused schedules here.' })}`);
  }

  // ---- paint ----
  const paintTasks = () => { if (tasksHost && !tasksHost.hidden && location.hash.startsWith('#runs')) tasksHost.innerHTML = tasksHtml(); };
  const paintSched = () => { if (schedHost && !schedHost.hidden && /^#schedules/.test(location.hash)) schedHost.innerHTML = schedulesHtml(); };
  const paint = () => { paintTasks(); paintSched(); window.RailPlaces?.projects?.redraw?.(); };

  // ---- a card's action, on the thing itself ----
  function act(does, id) {
    const r = W.find(id); if (!r) return;
    if (does === 'open' || does === 'answer') { r.unread = false; window.RailShell.openRun(`run/${r.case}`, r.title, r.id); return; }
    const was = { case: r.case, detail: r.detail, time: r.time, day: r.day };
    const back = () => { W.move(id, was.case, was.detail, { time: was.time, day: was.day }); };
    if (does === 'retry') { W.move(id, 'starting', 'Plan is under way'); say(`Retrying ${r.title}`, back); }
    if (does === 'resume') { W.move(id, 'working', 'Picked up where it stopped'); say(`Resumed ${r.title}`, back); }
    if (does === 'approve') { W.move(id, 'approved', 'Approved · checks pass'); say(`Approved ${r.title}`, back); }
    if (does === 'merge') { W.move(id, 'merged', 'Merged'); say(`Merged ${r.title}`, back); }
  }
  function onClick(e) {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-c-figs]'))) { figs[hit.dataset.cFigs] = !figs[hit.dataset.cFigs]; paint(); return; }
    if ((hit = on('[data-c-filter]'))) { List().filter(JSON.parse(hit.dataset.cFilter)); return; }
    if ((hit = on('[data-c-open]'))) { act('open', hit.dataset.cOpen); return; }
    if ((hit = on('[data-c-act]'))) { const [d, id] = hit.dataset.cAct.split('|'); act(d, id); return; }
    if ((hit = on('[data-c-sact]'))) { const [d, id] = hit.dataset.cSact.split('|'); Sch().act(id, d); paint(); return; }
    if ((hit = on('[data-c-sched]'))) { window.RailShell.openSchedule(hit.dataset.cSched); return; }
    if ((hit = on('[data-c-srun]'))) { const [id, i] = hit.dataset.cSrun.split('|'), s = Sch().find(id); Sch().openRun(s, s.runs[+i]); return; }
    if (on('[data-c-chat]')) { window.RailShell.go('chat'); return; }
    if ((hit = on('[data-c-new]'))) { openForm(hit.dataset.cNew); return; }
    if (on('[data-c-quiet]')) { quietOpen = !quietOpen; paint(); return; }
    if ((hit = on('[data-menu-pick^="c-"]'))) {
      const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
      if (id === 'c-sort') view.sort = v; if (id === 'c-by') view.by = v; if (id === 'c-ssort') view.sSort = v; if (id === 'c-sfrom') view.from = v === 'every project' ? '' : v;
      paint(); return;
    }
    if ((hit = on('[data-menu^="c-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paint(); }
  }
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    document.getElementById('route-runs').addEventListener('click', onClick);
    document.getElementById('route-schedule').addEventListener('click', onClick);
    document.getElementById('route-place').addEventListener('click', (e) => { if (e.target.closest('[data-c-filter], [data-c-open], [data-c-act], [data-c-sact], [data-c-sched]')) onClick(e); });   // the Projects center's cards act the same way
    W.onMove(paint); W.onChange(paint); R.prefs.onChange(paint);
    R.dismissOnOutside(document, { open: () => !!menu && !form, inside: '#route-runs .spick, #route-schedule .spick', back: () => null, close: () => { menu = ''; }, paint });
  }

  // ---- the Legacy approach's forms (form.dialog, form.check-at-save) ----
  let form = null, opener = null;
  const NAME_MAX = 80;   // form.name-limit
  const THEN = { 'open a PR': 'opens a PR', 'leave it on the branch': 'leaves it on the branch', 'merge when checks pass': 'merges when checks pass' };
  const VERB = { Plan: 'plans', Build: 'builds', Review: 'reviews', Clarify: 'asks first', 'Run tests': 'runs the tests', 'Security check': 'checks security', 'Diff gate': 'checks the size' };
  const flows = () => window.RailPlaces.workflows.names();
  const projects = () => [...new Set(W.rows().map((r) => r.project).filter(Boolean)), 'No project'];
  const LISTS = () => ({ project: projects(), workflow: flows().map((w) => w.title), agent: ['Claude', 'Codex', 'Gemini'], base: ['main', 'dev'], source: ['the latest version from origin', 'my local copy'], then: Object.keys(THEN), every: R.REPEATS.filter((x) => x !== 'once' && x !== 'every hour').map((x) => x.replace(/^every /, '')), at: R.TIMES_OF_DAY, tz: ['Europe/Sofia', 'UTC', 'Europe/Berlin', 'America/New_York'], ends: ['no end date', 'after 10 runs', 'after 30 days'], overlap: ['skip if still going', 'queue if still going'], fails: ['pause after 3 failures', 'pause after 5 failures', 'never pause'], cap: ['the workflow\'s own', 'at $5', 'at $20'], agents: ['the workflow\'s own', 'Sonnet for every step', 'Opus for every step'] });
  const blank = (kind, keep = {}) => ({ kind, project: projects().includes('billing-api') ? 'billing-api' : projects()[0], workflow: 'Default', agent: 'Claude', base: 'main', source: 'the latest version from origin', then: 'open a PR', text: '', path: '', src: 'write', name: '', more: false, title: '', branch: '', tags: '', agents: 'the workflow\'s own', cap: 'the workflow\'s own', every: 'weekday', at: '09:00', tz: 'Europe/Sofia', ends: 'no end date', overlap: 'skip if still going', fails: 'pause after 3 failures', err: '', ...keep });
  const fPick = (k, tip) => R.sentencePicker({ id: `f-${k}`, text: form[k], tip, items: LISTS()[k].map((v) => ({ id: v, text: v, checked: v === form[k] })), open: menu === `f-${k}`, chevron: chev });
  const proof = () => { const w = flows().find((x) => x.title === form.workflow), s = (w?.steps || []).map((x) => VERB[x] || x.toLowerCase()), last = s.pop(); return `${form.workflow} ${[s.join(', '), last].filter(Boolean).join(' and ')}, then ${THEN[form.then]}.`.replace(' and , ', ' '); };
  const errOf = (at) => (form.errAt === at ? form.err : '');   // the line sits under the field it is about
  function formHtml() {
    const sched = form.kind === 'schedule';
    const frame = `<div class="cc-frame"><span>A task on ${fPick('project', 'The project you used last')} using the ${fPick('workflow')} workflow, run by ${fPick('agent')},<br> from ${fPick('base')}, ${fPick('source')}, then ${fPick('then')}</span><span class="cc-proof">${esc(proof())}</span></div>`;
    const src = R.segmented({ label: 'Task source', hook: 'c-src', items: [{ id: 'write', label: 'Write it', pressed: form.src === 'write' }, { id: 'file', label: 'From file', pressed: form.src === 'file' }] });
    const what = `<div class="cc-lbl">${form.src === 'write' ? R.field({ id: 'cc-text', label: 'What should it do', multiline: true, error: errOf('#cc-text'), value: form.text, placeholder: sched ? 'What should each run do?' : 'Describe the software task to build…', attrs: { 'data-f': 'text', rows: 5 } }) : R.field({ id: 'cc-path', label: 'What should it do', error: errOf('#cc-path'), value: form.path, placeholder: 'A file in the project: docs/task.md', attrs: { 'data-f': 'path' } })}${src}</div>`;
    const fold = (label, says) => `<div class="cc-fold">${R.button({ label, kind: 'quiet', icon: R.icon(form.more ? 'chevron' : 'chevR', 12), attrs: { 'data-c-more': '', 'aria-expanded': String(form.more) } })}<span>${esc(says)}</span></div>`;
    if (sched) {
      const body = `${frame}${R.field({ id: 'cc-name', label: 'Name', error: errOf('#cc-name'), value: form.name, placeholder: 'What to call this schedule', attrs: { 'data-f': 'name', maxlength: 80 } })}${what}
        <div class="cc-frame"><span>Every ${fPick('every')} at ${fPick('at')} in ${fPick('tz')}</span><span class="cc-proof">Next: ${esc(R.scheduleDates({ every: `every ${form.every}`, at: form.at, from: Sch().TODAY }).map((d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')).join(', '))}.</span></div>
        ${fold('If something gets in the way', `${cap(form.ends)}; ${form.overlap}; ${form.fails}`)}${form.more ? `<div class="cc-more"><span>It ends with ${fPick('ends')}</span><span>A run still going means ${fPick('overlap')}</span><span>When runs fail, ${fPick('fails')}</span></div>` : ''}`;
      return R.dialog({ title: 'New schedule', body, yes: R.scheduleButton({ every: `every ${form.every}`, at: form.at }), close: R.icon('x', 15), id: 'cc-t', cls: 'cc-dlg', hooks: hooksOf() });
    }
    const body = `${frame}${what}${fold('More options', 'Title, branch, cost tags, agents, guardrails, files')}${form.more ? `<div class="cc-more">${R.field({ id: 'cc-title', label: 'Title', value: form.title, placeholder: 'Worca names it from what it should do', attrs: { 'data-f': 'title', maxlength: NAME_MAX } })}${R.field({ id: 'cc-branch', label: 'Branch', value: form.branch, placeholder: 'Worca makes one', attrs: { 'data-f': 'branch' } })}${R.field({ id: 'cc-tags', label: 'Cost tags', value: form.tags, placeholder: 'Comma separated', attrs: { 'data-f': 'tags' } })}<span>Agents: ${fPick('agents')}</span><span>Cost cap: ${fPick('cap')}</span><span>${R.button({ label: 'Add files…', kind: 'quiet', attrs: { 'data-c-files': '', title: 'Attaches files to the task' } })}</span></div>` : ''}`;
    return R.dialog({ title: 'New task', body, yes: 'Start task', status: `${R.button({ label: 'Schedule…', kind: 'quiet', attrs: { 'data-c-tosched': '', title: 'The same task, at a time' } })}`, close: R.icon('x', 15), id: 'cc-t', cls: 'cc-dlg', hooks: hooksOf() });
  }
  const hooksOf = () => ({ close: {}, cancel: {}, yes: {} });
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  const host = () => { let h = document.getElementById('center-dlg'); if (!h) { h = document.createElement('div'); h.id = 'center-dlg'; h.className = 'pz-app rail-page'; document.getElementById('app').append(h); h.addEventListener('click', dlgClick); h.addEventListener('input', dlgInput); h.addEventListener('keydown', dlgKey); h.addEventListener('mousedown', (e) => { if (e.target.classList.contains('viewer-modal')) closeForm(); }); } return h; };
  function paintForm(focus) {
    const h = host(), scroll = h.querySelector('.dlg-body')?.scrollTop || 0;
    h.innerHTML = form ? formHtml() : '';
    if (!form) return;
    const b = h.querySelector('.dlg-body'); if (b) b.scrollTop = scroll;
    (focus ? h.querySelector(focus) : null)?.focus();
  }
  function openForm(kind, keep) { menu = ''; opener = document.activeElement; form = blank(kind, keep); paintForm(kind === 'schedule' ? '#cc-name' : '#cc-text'); }
  function closeForm() { form = null; menu = ''; paintForm(); (opener?.isConnected && opener !== document.body ? opener : document.querySelector('#bar-head [data-bar-new]'))?.focus(); }   // a menu's item is gone by now: back to its +
  function check() {
    const words = form.src === 'write' ? form.text.trim() : form.path.trim();
    if (form.kind === 'schedule' && !form.name.trim()) return ['Name it first', '#cc-name'];
    if (form.kind === 'schedule' && Sch().all().some((s) => s.title.toLowerCase() === form.name.trim().toLowerCase())) return ['A schedule already has that name', '#cc-name'];
    if (!words) return [form.src === 'write' ? 'Say what it should do' : 'Name the file it should follow', form.src === 'write' ? '#cc-text' : '#cc-path'];
    return null;
  }
  function save() {
    const bad = check(); if (bad) { form.err = bad[0]; form.errAt = bad[1]; paintForm(bad[1]); return; }
    const words = (form.src === 'write' ? form.text : `Follow ${form.path}`).trim(), project = form.project === 'No project' ? '' : form.project, k = Date.now().toString(36);
    if (form.kind === 'task') {
      const title = form.title.trim() || (words.length > 56 ? `${words.slice(0, 54).trim()}…` : words);
      const f = form; closeForm();
      W.add({ id: `n-${k}`, case: 'starting', title, project, detail: 'Plan is under way', time: 'now', day: 'today', cost: 0, workflow: f.workflow, kind: project ? 'Git' : 'No project' });
      say(`Started ${title}`); paint(); return;
    }
    const every = `every ${form.every}`, w = R.scheduleWords({ every, at: form.at }), s = { id: `n${k}`, title: form.name.trim(), project, chat: '', every, at: form.at, tz: form.tz, next: w.next, day: w.day, state: 'scheduled', time: w.time, section: 'next', labels: [], what: words.endsWith('.') ? words : `${words}.`, cost: 0, started: Sch().dateWord(Sch().TODAY), workflow: form.workflow, agent: form.agent, base: form.base, then: form.then, ends: form.ends, overlap: form.overlap, fails: form.fails, runs: [] };
    closeForm(); Sch().add(s); say(`Scheduled ${s.title}: ${R.scheduleWords(s).runs}`); paint();
  }
  function dlgClick(e) {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-menu-pick^="f-"]'))) { const [id, v] = hit.dataset.menuPick.split('|'); form[id.slice(2)] = v; menu = ''; paintForm(`[data-menu="${id}"]`); return; }
    if ((hit = on('[data-menu^="f-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paintForm(`[data-menu="${hit.dataset.menu}"]`); return; }
    if (menu) { menu = ''; paintForm(); }
    if ((hit = on('[data-c-src]'))) { form.src = hit.dataset.cSrc; paintForm(form.src === 'write' ? '#cc-text' : '#cc-path'); return; }
    if (on('[data-c-more]')) { form.more = !form.more; paintForm('[data-c-more]'); return; }
    if (on('[data-c-tosched]')) { form = blank('schedule', { project: form.project, workflow: form.workflow, agent: form.agent, base: form.base, source: form.source, then: form.then, text: form.text, path: form.path, src: form.src, name: form.title }); paintForm('#cc-name'); return; }
    if (on('[data-c-files]')) { say('Would ask for the files to attach'); return; }
    if ((hit = on('[data-dialog]'))) { if (hit.dataset.dialog === 'yes') save(); else closeForm(); }
  }
  function dlgInput(e) {
    const k = e.target.dataset?.f; if (!k) return; form[k] = e.target.value;
    if (form.err && check()?.[1] !== form.errAt) { const f = document.querySelector(`#center-dlg ${form.errAt}`); form.err = ''; form.errAt = ''; document.querySelector(`#${f?.id}-note`)?.remove(); f?.removeAttribute('aria-invalid'); f?.removeAttribute('aria-describedby'); }   // once it is mended, the line goes
  }
  function dlgKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); if (menu) { const m = menu; menu = ''; paintForm(`[data-menu="${m}"]`); } else closeForm(); return; }
    if (e.key === 'Enter' && e.target.matches('input[data-f]')) { e.preventDefault(); save(); return; }
    if (e.key === 'Tab') { const all = [...document.querySelectorAll('#center-dlg .card button, #center-dlg .card input, #center-dlg .card textarea')].filter((x) => !x.disabled && x.offsetParent), first = all[0], last = all.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  }

  const ask = (which) => window.RailConversation?.handOver({ mode: which === 'task' ? 'task' : 'schedule', ph: which === 'task' ? 'What should the task do?' : 'What should run, and when?' });
  const maker = (noun, chatWord, formWord) => ({ newLabel: `New ${noun}`, newMenu: () => [{ header: 'Ask in chat' }, { id: 'bar-new|chat', text: chatWord }, { sep: true }, { header: 'Legacy approach' }, { id: 'bar-new|form', text: formWord }], newPick: (id) => { if (id === 'form') openForm(noun); else ask(noun); } });
  const MAKERS = { tasks: maker('task', 'Start a task', 'New task…'), schedules: maker('schedule', 'Schedule a task', 'New schedule…') };
  window.RailCenters = {
    tasks: (el) => { wire(); tasksHost = el; menu = ''; paint(); },
    schedules: (el) => { wire(); schedHost = el; menu = ''; if (/^#schedules/.test(location.hash)) el.innerHTML = schedulesHtml(); },
    maker: (which) => (advanced() ? MAKERS[which] : null),
    paint, wire, taskOf, stateOf, clause, actionsOf, schedLink, link, inWeek,
  };
})();
