// The Tasks and Schedules centers (Wave 3; docs/rail/panels.md › panel.center; mocks plans/rail/mocks/wave-3/tasks-center, schedules-center):
// the landing page of each, cards from the one store, so a card changes when its task or schedule does. And the two Legacy
// approach forms (rail.chat-first), as Dialogs. Everything drawn comes from the library; this says what each thing is.
(function () {
  const R = window.RailUI, W = window.RailWorld, RM = window.RunCardModel;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;   // F-fm-02: thousands separated ($2,551.75)
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
  let asking = null;   // a card's step that asks first (act.confirm), in a ConfirmStrip under the head of the center it was pressed in: { does, id, label, f, busy, where }
  let view = { sort: 'most urgent', by: 'project', sSort: 'most urgent', from: '' }, figs = { tasks: false, sched: false };

  // ---- what a task is on a card ----
  // F-3-10: this week's runs among the rows, each once: a group row is its members, each dated by its own day and time
  const weekOf = (rows) => { const runs = rows.flatMap((t) => (t.group ? W.membersOf(t.group).map((m) => ({ run: m, day: m.day })) : [t])).filter(inWeek); return { n: runs.length, cost: runs.reduce((a, t) => a + (t.run.cost || 0), 0) }; };
  // a group's task: one that waits on you, else the one the group reads as (its next unmerged task), else its first
  const taskOf = (t) => t.run || (t.group ? W.membersOf(t.group).find(W.raises) || W.membersOf(t.group).find((m) => m.case === t.group.case) || W.membersOf(t.group)[0] : null);
  const stateOf = (r) => RM.stateOf(r.case);
  const RANK = R.taskRank;
  const stepOf = (detail) => (detail || '').split(' · ')[0];
  // live: what the task page says of it (its reason, else its first ✗ item: '2 of 5 checks failing'), never the row's bare 'Finished'
  // the page's reason, else its first ✗ item, else its PR mark's word (gitMark: Conflicts, Checks failing)
  const GIT_SAYS = { conflict: 'Conflicts', fail: 'Checks failing' };
  const liveSays = (r) => { const v = W.live ? window.RailTaskLive?.detail?.(r.id) : null; if (!v) return ''; const why = (v.why || []).find((x) => /^✗/.test(x)); return v.detail || (why ? why.replace(/^✗\s*/, '') : '') || GIT_SAYS[v.git] || ''; };
  const clause = (r) => R.taskClause({ state: stateOf(r), name: link(r.title, { 'data-c-open': r.id }, `Opens ${r.title} in its chat`), detail: liveSays(r) || r.detail || '' });
  // V-TW-01: a button names its task in at most 24 characters, whole words, "…" when cut; its tooltip keeps the full title
  const SHORT = 24;
  const shortOf = (title) => { const s = String(title || '').trim(); if (s.length <= SHORT) return s; let out = ''; for (const w of s.split(/\s+/)) { const next = out ? `${out} ${w}` : w; if (next.length > SHORT) break; out = next; } return `${out || s.slice(0, SHORT - 1)}…`; };
  const actionsOf = (rs) => R.taskActions(rs.map((t) => ({ id: t.id, title: t.title, short: t.short || shortOf(t.title), state: stateOf(t) })));
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
      return { ...g, needs, running: c('running'), waiting: c('scheduled'), recent, cost: weekOf(g.rows).cost, quiet: !needs.length && !g.missed.length && !c('running').length };
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
      whatHtml: what.join('<br>') || (running ? `${link(running.title, { 'data-c-open': running.id })} is running` : 'Nothing is going on here.'), action: actionOf(g), attrs: { title: facts.tip } });
  }
  const picker = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: chev });
  function tasksHtml() {
    // the list's own first-load looks (D15): never "No tasks yet." while the first load is out
    const ls = window.RailDemoState?.list || '';
    if (ls === 'loading' || ls === 'failed') return wrap(`${R.placeHead({ title: 'Your tasks', facts: 'New work starts in Chat' })}${R.listState({ state: ls, noun: 'tasks', retry: ls === 'failed' ? { 'data-c-retry': '', 'data-key': 'c-retry' } : null })}`);
    const rows = fromRows(), all = groups().sort(SORTS[view.sort]);
    if (!rows.length) return wrap(`${R.placeHead({ title: 'Your tasks', facts: 'New work starts in Chat' })}${R.emptyState({ title: 'No tasks yet.', actions: R.button({ label: 'Go to Chat', kind: 'quiet', attrs: { 'data-c-chat': '' } }) })}`);
    // F-3-10: live, the API's week (every project, or the chosen one's row), nothing while it is read; demo, the per-run sum
    const week = W.live ? (() => { const f = List().from(), t = window.RailInsightsLive?.weekTotals?.(f === 'all' ? null : f); return t ? { n: t.runs, cost: t.spentUsd } : null; })() : weekOf(rows);
    const shown = all.filter((g) => !g.quiet).flatMap(partsOf).sort(SORTS[view.sort]), quiet = all.filter((g) => g.quiet);
    // the count opens the chosen project's week; live, the list can hold fewer than the API counted, and the tip says so
    const f = List().from(), wk = filterHook({ range: WEEK, ...(f === 'all' ? {} : { project: f }) }), wTip = W.live ? 'Opens this week\'s tasks in the list. The figure counts every run Worca recorded this week, so the two can differ' : 'Opens this week\'s tasks';
    const facts = week ? `${count(`${plural(week.n, 'task')} this week`, wk, wTip)}${week.cost > 0 ? ` · ${count(`${usd(week.cost)} this week`, wk, wTip)}` : ''}` : '';
    const sent = R.centerSentence({ words: `Showing ${picker('c-sort', view.sort, Object.keys(SORTS), 'How the cards are ordered')} by ${picker('c-by', view.by, ['project', 'workflow'], 'What a card is')}`, open: figs.tasks, attrs: { 'data-c-figs': 'tasks' }, facts });
    const calm = !all.some((g) => g.needs.length || g.missed.length);
    const way = advanced() ? '' : `<p class="center-way">New work starts in Chat. ${link('Go to Chat', { 'data-c-chat': '' })}</p>`;
    const noun = view.by === 'workflow' ? 'workflow' : 'project';
    const quietFacts = (() => { return quiet.map((g) => g.name).join(', '); })();
    const quietRow = quiet.length ? `${R.quietLine({ n: quiet.length, noun, names: quietFacts, open: quietOpen, hook: { 'data-c-quiet': '' } })}${quietOpen ? `<div class="pg-grid">${quiet.map(cardOf).join('')}</div>` : ''}` : '';
    if (asking && !W.find(asking.id)) asking = null;
    const askHtml = asking?.where === 'tasks' ? stripOf(asking) : '';
    return wrap(`${R.placeHead({ title: 'Your tasks', say: calm ? 'Nothing needs you' : '' })}${askHtml}${sent}${way}<div class="pg-grid">${shown.map(cardOf).join('')}</div>${quietRow}`);
  }
  const wrap = (body) => `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center">${body}</div></div></div>`;
  const stripOf = (a) => R.confirmStrip({ ...R.confirmOf(a.f, a.label), busy: a.busy ? R.workingWord(a.label) : '', id: 'c-confirm-t', attrs: { 'data-c-ask': '' } });
  // the center a card was pressed in: the Tasks center, or the Projects center (its home draws the same cards, projects.js)
  const placeEl = () => document.getElementById('route-place');
  const whereNow = () => (tasksHost && !tasksHost.hidden && location.hash.startsWith('#runs') ? 'tasks' : placeEl() && !placeEl().hidden && /^#projects\/?$/.test(location.hash) ? 'place' : '');
  const hostOf = (where) => (where === 'place' ? placeEl() : tasksHost);
  function startAsk(a) { asking = { ...a, where: whereNow() || 'tasks' }; paint(); hostOf(asking.where)?.querySelector('[data-c-ask] [data-confirm="yes"]')?.focus({ preventScroll: true }); }

  // ---- the Schedules center ----
  // F-FM2-01: a fire still going (a question or a gate included, logic.still-going) is neither ok nor failed
  const OUT = (r) => { const t = RM.stateOf(r.case); return R.stillGoing(t) ? 'run' : t === 'failed' ? 'fail' : R.sectionOf(R.runState(t).word) === 'running' ? 'run' : 'ok'; };
  const sectionNow = (s) => (s.ended ? 'ended' : Sch().running(s.id) ? 'running' : s.state === 'paused' ? 'paused' : s.section === 'needs' ? 'needs' : 'next');
  const DEFAULT_TZ = 'Europe/Sofia';   // the demo's seed; live, a new schedule's zone is the browser's (homeTz)
  const homeTz = () => (W.live ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' : DEFAULT_TZ);
  const SCHED_RANK = { needs: 0, running: 1, next: 2, paused: 3, ended: 4 };
  const nextDate = (s) => Sch().nextDates(s)[0];
  const SCHED_SORTS = { 'most urgent': (a, b) => SCHED_RANK[sectionNow(a)] - SCHED_RANK[sectionNow(b)] || nextDate(a) - nextDate(b), 'next to run': (a, b) => (a.state === 'paused' || !!a.ended) - (b.state === 'paused' || !!b.ended) || nextDate(a) - nextDate(b), 'A–Z': (a, b) => a.title.localeCompare(b.title) };
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
    // its word and why are the schedule's own (RailSchedules.wordOf / nextOf): the same on its page, its row and its chat card
    const sec = sectionNow(s), word = Sch().wordOf(s.id), next = Sch().nextOf(s.id);
    const [kicker, tone] = sec === 'needs' ? [`${s.missed}, ${s.at} · ${s.missedWhy}`, 'act'] : sec === 'running' ? [next, 'run'] : [next, 'idle'];
    const fact = esc(`${s.project || 'No project'} · ${R.REPEATS.includes(s.every) ? R.scheduleWords(s).says : s.every}${s.tz && s.tz !== homeTz() ? ` ${s.tz}` : ''}${s.preset ? ` · ${s.preset === 'preset deleted' ? s.preset : `from ${s.preset}`}` : ''}`);
    const act = sec === 'ended' ? null : sec === 'needs' ? ['Run now', 'run', ''] : sec === 'running' ? ['Stop', 'stop', 'quiet'] : sec === 'paused' ? ['Resume', 'pause', 'quiet'] : ['Run now', 'run', 'quiet'];   // an ended one runs no more
    return R.pluginCard({ mark: R.kindMark({ kind: 'schedule', tone: sec === 'needs' ? 'act' : sec === 'paused' ? 'pause' : sec === 'running' ? 'run' : 'idle', breathe: sec === 'needs' }), word, kicker, tone, title: s.title, titleHtml: link(s.title, { 'data-c-sched': s.id }, `Opens ${s.title}`), what: s.what || R.scheduleWords(s).says, line: schedLine(s), factsHtml: fact, factsTip: fact, action: act ? R.button({ label: act[0], kind: act[2], attrs: { 'data-c-sact': `${act[1]}|${s.id}`, title: `${act[0]}: ${s.title}` } }) : '', attrs: { 'data-c-card': s.id, title: s.cost ? `${usd(s.cost)} a run` : null } });
  }
  function schedulesHtml() {
    const all = Sch().all(), list = all.filter((s) => (!view.from || (s.project || 'No project') === view.from) && (Sch().showing() === 'all' || (Sch().showing() === 'drafts' ? !!window.RailDrafts?.get(`schedule:${s.id}`) : s.state === 'paused'))).sort(SCHED_SORTS[view.sSort]);
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
  function act(does, id, label = '', confirmed = false) {
    const r = W.find(id); if (!r) return;
    if (does === 'open' || does === 'answer') { if (!W.live) r.unread = false; window.RailShell.openRun(`run/${r.case}`, r.title, r.opens || r.id); return; }   // a lit origin opens its needy round (foldRounds); the live kind: the shell acknowledges it through the adapter
    if (W.live) { liveAct(does, r); return; }   // Tasks D17: dev's route through RailTaskLive; the store moves only when dev's frames say so
    // panel.center: a step that asks first (Merge, Fix checks) asks in a ConfirmStrip under the head, in the demo kind too,
    // with the demo task's own facts (its case's flow, the task page's words); only its Yes moves the store
    const asks = !confirmed && whereNow() && demoAsk(does, r);   // its strip draws under the head of the center it was pressed in
    if (asks) { startAsk(asks); return; }
    const was = { case: r.case, detail: r.detail, time: r.time, day: r.day };
    const back = () => { W.move(id, was.case, was.detail, { time: was.time, day: was.day }); };
    if (does === 'retry') { W.move(id, 'starting', 'Plan is under way'); say(`Retrying ${r.title}`, back); }
    if (does === 'resume') { W.move(id, 'working', 'Picked up where it stopped'); say(`Resumed ${r.title}`, back); }
    if (does === 'approve') { W.move(id, 'approved', 'Approved · checks pass'); say(`Approved ${r.title}`, back); }
    if (does === 'merge') { W.move(id, 'merged', 'Merged'); say(`Merged ${r.title}`, back); }
    if (does === 'pr') { W.move(id, 'checks', 'PR opened · checks running'); say(LIVE_SAY.pr(r.title), back); }
    if (does === 'fix-checks') { W.move(id, 'fixing-checks', 'Fixing the failing checks'); say(`A short task is fixing ${r.title}\u2019s checks`, back); }
  }
  // The live kind (Tasks, Step 8): a card's action is the same RailTaskLive id the task page runs; nothing moves here before
  // its route answers ok, and a refusal is the shell's one `Could not ACTION: REASON`.
  const LIVE_LABEL = { retry: 'Retry', resume: 'Resume', approve: 'Approve and build', merge: 'Merge PR', pr: 'Create PR', 'fix-checks': 'Fix checks' };
  const LIVE_SAY = { retry: (t) => `Retrying ${t}`, resume: (t) => `Resumed ${t}`, approve: (t) => `Approved ${t}`, merge: (t) => `Merged ${t}`, pr: (t) => `Created a PR for ${t}`, 'fix-checks': (t) => `A short task is fixing ${t}\u2019s checks` };
  // A step the task page confirms first (its state's flow in the library's table: Merge PR, Fix checks) asks here too, in
  // the same words, filled with the task's own PR, base and failing count (run-page-model.js liveFacts).
  function demoAsk(does, r) {
    const label = LIVE_LABEL[does], f = label ? RM.flow[r.case]?.[label] : null;
    return f && f.confirm ? { does, id: r.id, label, f, busy: false } : null;
  }
  function liveAsk(does, r) {
    const v = window.RailTaskLive?.detail?.(r.id), label = LIVE_LABEL[does];
    // the base: the page's (once its detail is in), else the PR's own from its checks entry
    const f = v ? R.actionFlow(stateOf(r), RM.liveFacts({ ...v, base: v.base || window.RailTaskLive.checks?.(r.id)?.base || '' }))[label] : null;
    return f && f.confirm ? { does, id: r.id, label, f, busy: false } : null;
  }
  function liveAct(does, r, confirmed = false) {
    const T = window.RailTaskLive;
    if (!T || !LIVE_LABEL[does]) return;
    const asks = !confirmed && liveAsk(does, r);   // the live kind never merges unasked
    if (asks) { startAsk(asks); return; }
    const was = confirmed ? asking : null;
    if (was) { was.busy = true; paint(); }
    Promise.resolve(T.flow(LIVE_LABEL[does], { taskId: r.id, pr: r.pr, title: r.title })).then((res) => {
      if (was && asking === was) { asking = null; paint(); hostOf(was.where)?.querySelector(`[data-c-act="${does}|${r.id}"]`)?.focus({ preventScroll: true }); }   // a refusal is the shell's one line; the card still offers it
      if (res && res.ok) say(res.say || LIVE_SAY[does](r.title));
    });
  }
  function answerAsk(yes) {
    const a = asking; if (!a) return;
    if (yes && W.find(a.id)) {
      if (W.live) { liveAct(a.does, W.find(a.id), true); return; }
      asking = null; act(a.does, a.id, '', true); paint(); return;
    }
    asking = null; paint(); hostOf(a.where)?.querySelector(`[data-c-act="${a.does}|${a.id}"]`)?.focus({ preventScroll: true });
  }
  function onClick(e) {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-c-ask] [data-confirm]'))) { if (!hit.disabled) answerAsk(hit.dataset.confirm === 'yes'); return; }
    if ((hit = on('[data-c-retry]'))) { window.RailAdapter?.retry?.(); return; }
    if ((hit = on('[data-c-figs]'))) { figs[hit.dataset.cFigs] = !figs[hit.dataset.cFigs]; paint(); return; }
    if ((hit = on('[data-c-filter]'))) { List().filter(JSON.parse(hit.dataset.cFilter)); return; }
    if ((hit = on('[data-c-open]'))) { act('open', hit.dataset.cOpen); return; }
    if ((hit = on('[data-c-act]'))) { const [d, id] = hit.dataset.cAct.split('|'); act(d, id, hit.textContent); return; }
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
    for (const [el, where] of [['route-runs', 'tasks'], ['route-place', 'place']]) document.getElementById(el).addEventListener('keydown', (e) => { if (e.key === 'Escape' && asking?.where === where && !asking.busy) { e.stopPropagation(); answerAsk(false); } });   // Esc is the strip's safe side
    document.getElementById('route-schedule').addEventListener('click', onClick);
    document.getElementById('route-place').addEventListener('click', (e) => { if (e.target.closest('[data-c-filter], [data-c-open], [data-c-act], [data-c-sact], [data-c-sched], [data-c-ask]')) onClick(e); });   // the Projects center's cards act the same way
    W.onMove(paint); W.onChange(paint); R.prefs.onChange(paint);
    R.dismissOnOutside(document, { open: () => !!menu && !form, inside: '#route-runs .spick, #route-schedule .spick', back: () => null, close: () => { menu = ''; }, paint });
  }

  // ---- the Legacy approach's forms (form.dialog, form.check-at-save) ----
  let form = null, opener = null;
  const NAME_MAX = 80;   // form.name-limit
  const THEN = { 'open a PR': 'opens a PR', 'leave it on the branch': 'leaves it on the branch', 'merge when checks pass': 'merges when checks pass' };
  const VERB = { Plan: 'plans', Build: 'builds', Review: 'reviews', Clarify: 'asks first', 'Run tests': 'runs the tests', 'Security check': 'checks security', 'Diff gate': 'checks the size' };
  // the live kind picks from dev's own workflows (GET /api/workflows, read through Chat's catalog) and sends their wf_ ids;
  // the base defaults to the project's own branch, as dev's New run does when none is named
  let liveFlows = null, liveBranches = { project: '', list: [] };
  const LIVE_BASE = 'its default branch';
  // the live kind's Agent: the project's own default engine (no engine sent, as dev's New run does until one is picked), or one
  // of dev's run engines; 'then' is dev's pr.open and 'source' its syncBeforeStart, each sent only when picked (else the
  // project's own setting holds, as dev's New run); Cost cap is the run's own cap (costCapUsd, pipelines.cost_cap_usd).
  // Agents is dev's per-run agent pick (POST /api/run `overlay.nodes`, checked by checkRunOverlay): one model for every agent
  // node of the picked workflow, from dev's models for the run's engine; Auto decides its agents at start, so it offers none.
  // dev has no auto-merge at start, so the live form draws no 'merge when checks pass' (plans/rail/stillhet-wiring.md).
  const LIVE_AGENT = 'the project\'s default';
  const LIVE_SETUP = 'as the project is set up';
  const LIVE_THEN = { 'open a PR': 'ready', 'leave it on the branch': 'none' };
  const LIVE_SOURCE = { 'the latest version from origin': true, 'my local copy': false };
  const capUsd = (t) => { const m = /\$(\d+(?:\.\d+)?)/.exec(t); return m ? parseFloat(m[1]) : null; };
  const engines = () => window.RailTaskLive?.engines?.() || [];
  function loadBranches() {
    if (!W.live || !form || liveBranches.project === form.project) return;
    const project = form.project; liveBranches = { project, list: [] };
    window.RailTaskLive?.branches?.(window.RailTaskLive.projectDirOf(project) || '').then((list) => {
      if (liveBranches.project !== project || !list) return;
      liveBranches = { project, list }; if (form) paintForm();
    });
  }
  const flows = () => (W.live ? liveFlows || [{ id: '', title: 'Default', steps: [], agents: [] }] : window.RailPlaces.workflows.names());
  let liveModels = [];
  function loadFlows() {
    if (!W.live) return;
    if (!liveFlows) window.RailChatLive?.catalog('workflows').then((r) => { if (!r?.ok) return; liveFlows = (r.data?.workflows || []).map((x) => ({ id: x.id, title: x.name || x.id, steps: [], auto: x.auto === true || x.id === 'wf_auto', agents: (Array.isArray(x.nodes) ? x.nodes : []).filter((n) => n && n.kind === 'agent' && n.id).map((n) => n.id) })); if (!liveFlows.some((x) => x.id === 'wf_auto')) liveFlows.unshift(AUTO_FLOW); if (form) { applyActiveFlow(); paintForm(); } });
    if (!liveModels.length) window.RailChatLive?.catalog('models').then((r) => { if (!r?.ok) return; liveModels = (r.data?.models || []).filter((m) => m && m.id).map((m) => ({ id: m.id, label: m.label || m.id, engine: m.engine || 'claude' })); if (form) paintForm(); });
  }
  // F-cov23-03: Auto is classic's client-side constant (app.js AUTO_WORKFLOW): /api/workflows never lists it, its picker leads with it
  const AUTO_FLOW = Object.freeze({ id: 'wf_auto', title: 'Auto', steps: [], auto: true, agents: [] });
  const AGENTS_OWN = 'the workflow\'s own';
  // the picked workflow (an unpicked Default is dev's wf_default) and the models its agents can each run, as `LABEL for every step`
  const liveFlow = () => flows().find((x) => x.title === form.workflow && x.id) || (liveFlows || []).find((x) => x.id === 'wf_default') || null;
  function liveAgentPicks() {
    const w = liveFlow(); if (!w || w.auto || !w.agents.length) return [];
    const engine = engines().find((e) => e.label === form.agent)?.id || 'claude';
    return liveModels.filter((m) => m.engine === engine).map((m) => ({ text: `${m.label} for every step`, model: m.id }));
  }
  // ---- New task's run options (COV-2; docs/rail/forms.md form.run-options) ----
  // Every read and write is RailRunOptionsLive's (dev's routes, live/run-options-live.mjs); its words are RailRunOptions'
  // (the same module's helpers). The demo answers the same calls with sample data in dev's shapes, so one path draws both.
  const RO = () => window.RailRunOptions || null;
  const DEMO_PRESETS = [
    { id: 'rp_bugfix', name: 'Bug fix', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_fix', engine: 'claude', syncBeforeStart: true, tags: ['bugfix'] } },
    { id: 'rp_docs', name: 'Docs pass', scope: { kind: 'project', ref: 'worca-cc' }, setup: { workflowId: 'wf_docs', engine: 'codex', sourceBranch: 'dev', guardrailsId: 'strict' } },
    { id: 'rp_billing', name: 'Billing slice', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_feature', engine: 'claude', guardrailsId: 'billing-ci' } },
  ];
  const DEMO_TICKETS = [{ id: 'BILL-212', title: 'BILL-212 Invoices export drops the VAT column', body: 'The CSV export of invoices leaves out the VAT column since the last release.' }, { id: 'BILL-219', title: 'BILL-219 Retry failed card payments once', body: 'A declined card payment is retried once, an hour later, before the invoice is marked unpaid.' }];
  const ok = (data) => Promise.resolve({ ok: true, data });
  const DEMO_OPT = {
    defaults: (dir) => ok({ engine: { value: 'claude' }, tags: [], projectKey: dir.replace(/^\/demo\//, '') }),
    config: () => ok({ config: {} }),
    setActiveWorkflow: () => ok({}), resetWorkflow: () => ok({}), saveWorkflowDefaults: () => ok({}), saveTagDefaults: (k, tags) => ok({ tags }),
    presets: () => ok({ presets: DEMO_PRESETS }),
    checkPreset: (id) => ok({ broken: id === 'rp_billing' ? [{ item: 'guardrails', ref: 'billing-ci', message: 'Guardrail set billing-ci no longer exists', reset: true }] : [] }),
    updatePreset: (id) => ok({ preset: DEMO_PRESETS.find((p) => p.id === id) }), duplicatePreset: (id) => ok({ preset: { ...DEMO_PRESETS.find((p) => p.id === id), id: `${id}_copy`, name: `${DEMO_PRESETS.find((p) => p.id === id).name} (copy)` } }),
    sources: () => ok({ sources: [{ type: 'plugin', plugin: 'jira', sourceId: 'issues', displayName: 'Jira', inputs: [], multiProfile: false, profiles: [] }] }),
    binding: () => ok({ profile: null, via: 'only' }), bind: () => ok({}),
    call: (plugin, sourceId, op, args) => ok(op === 'getTask' ? DEMO_TICKETS.find((t) => t.id === args.id) : { tasks: DEMO_TICKETS.filter((t) => t.title.toLowerCase().includes((args.search || '').toLowerCase())) }),
    policyNotes: () => ok({ policy: { home: 'acme/worca-policy', caps: { pipeline: { kind: 'hard', value: 20 } } }, notes: [{ level: 'warn', text: 'Guardrails Normal rank below the team minimum (Strict). The run proceeds and is recorded as off-policy.' }] }),
  };
  const OPT = () => (!RO() ? null : W.live ? window.RailRunOptionsLive || null : DEMO_OPT);
  let presetList = null, sourceList = null;   // per form open: dev's presets and plugin task sources (null: not read, or refused)
  const dirOf = (project = form.project) => (project === 'No project' ? '' : W.live ? window.RailTaskLive?.projectDirOf(project) || '' : `/demo/${project}`);
  const engineLabelOf = (id) => (W.live ? engines().find((e) => e.id === id)?.label || '' : id ? id[0].toUpperCase() + id.slice(1) : '');
  const engineIdOf = (label) => (W.live ? engines().find((e) => e.label === label)?.id || '' : String(label || '').toLowerCase());
  const slugOf = (t) => `wf_${String(t).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const flowId = (title = form.workflow) => (W.live ? flows().find((x) => x.title === title)?.id || '' : title === 'Default' ? '' : slugOf(title));
  const flowOfId = (id) => flows().find((x) => (W.live ? x.id : slugOf(x.title)) === id) || null;
  // the project's own workflow (dev's activeWorkflowId) preselects the Workflow picker, once the list holds it
  function applyActiveFlow() { const f = form; if (!f || f.workflowTouched || f.preset || !f.activeWf) return; const w = flowOfId(f.activeWf); if (w) f.workflow = w.title; }
  const fits = () => (presetList || []).filter((p) => RO().presetFits(p, form.projectKey));
  // the picks a preset holds, as the form shows them now (presetModified compares two of these)
  function presetView() {
    const live = runFields(form.project === 'No project');
    return { workflowId: flowId() || '', engine: engineIdOf(form.agent) || '', sourceBranch: live.sourceBranch || '', syncBeforeStart: W.live ? (live.syncBeforeStart ?? null) : form.source !== 'my local copy', pr: live.pr || null, tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean), sameAsSource: !!form.carried.sameAsSource };
  }
  function loadOptions() {
    const o = OPT(), f = form; if (!o || !f || f.kind !== 'task') return;
    presetList = null; sourceList = null;
    o.presets().then((r) => { if (form !== f) return; presetList = r.ok && Array.isArray(r.data?.presets) ? r.data.presets : null; paintForm(); });
    o.sources().then((r) => { if (form !== f) return; sourceList = r.ok && Array.isArray(r.data?.sources) ? r.data.sources.filter((s) => s && s.type === 'plugin' && s.plugin && s.sourceId) : null; paintForm(); });
    loadProject();
  }
  // dev's saved run defaults and the project's own workflow, read on open and on every project pick; a read that lands after
  // the form or its project changed is dropped, and a control the person touched is never overwritten
  function loadProject() {
    const o = OPT(), f = form; if (!o || !f || f.kind !== 'task') return;
    const project = f.project, dir = dirOf(project);
    Object.assign(f, { projectKey: '', defaultEngine: '', activeWf: '', policy: null, defaultsFor: project, policyGen: (f.policyGen || 0) + 1 });   // the old project's policy read is dropped
    if (!dir) return;
    o.defaults(dir).then((r) => {
      if (form !== f || f.project !== project || !r.ok) return;
      const d = RO().defaultsOf(r.data); f.projectKey = d.projectKey; f.defaultEngine = d.engine;
      if (!f.agentTouched && !f.preset && d.engine && engineLabelOf(d.engine)) f.agent = engineLabelOf(d.engine);
      if (!f.tagsTouched && !f.preset && d.tags.length) f.tags = d.tags.join(', ');
      loadPolicy(); paintForm();
    });
    o.config(dir).then((r) => { if (form !== f || f.project !== project || !r.ok) return; f.activeWf = String(r.data?.config?.activeWorkflowId || ''); f.hitl = r.data?.config?.humanInLoop !== false; applyActiveFlow(); paintForm(); });
  }
  // the team policy notes for the project, its guardrails and the Agents pick; only the newest read paints
  function loadPolicy() {
    const o = OPT(), f = form; if (!o || !f) return;
    const n = (f.policyGen = (f.policyGen || 0) + 1);
    if (!f.projectKey) { f.policy = null; return; }
    const model = agentModel();
    o.policyNotes({ projectKey: f.projectKey, guardrailsId: f.carried.guardrailsId || '', models: model ? [model] : [] }).then((r) => { if (form !== f || f.policyGen !== n) return; f.policy = r.ok ? RO().policyNoteOf(r.data) : null; paintForm(); });
  }
  const agentModel = () => (W.live ? liveAgentPicks().find((x) => x.text === form.agents)?.model || '' : form.agents === AGENTS_OWN ? '' : form.agents.split(' ')[0].toLowerCase());
  const agentIds = () => (W.live ? liveFlow()?.agents || [] : form.workflow === 'Default' ? [] : ['plan', 'build', 'review']);
  const said = (k, text) => { const f = form; f[k] = text; paintForm(); setTimeout(() => { if (form === f && f[k] === text) { f[k] = ''; paintForm(); } }, 2000); };
  const failWords = (r) => (/^HTTP \d+$/.test(r.error || '') ? `Could not save (${r.error})` : r.error || 'Could not save');
  function saveTags() {
    const o = OPT(), f = form; if (!o || !f.projectKey) return;
    o.saveTagDefaults(f.projectKey, f.tags.split(',').map((x) => x.trim()).filter(Boolean)).then((r) => {
      if (form !== f) return;
      if (r.ok) { said('tagsSaid', 'Saved'); return; }
      f.tagsSaid = ''; f.err = failWords(r); f.errAt = '#cc-tags'; paintForm();   // F-cov23-06: the field's error line, never the button's label
    });
  }
  function saveFlow(reset) {
    const o = OPT(), f = form, id = flowId(), dir = dirOf(); if (!o || !id || !dir) return;
    const model = agentModel();
    const p = reset ? o.resetWorkflow(dir, id) : o.saveWorkflowDefaults(id, model, dir);
    p.then((r) => {
      if (form !== f) return;
      if (r.ok) { said('flowSaid', reset ? 'Reset' : 'Saved'); return; }
      f.flowSaid = '';
      // COV-2 m-flowerr: a refusal is the form's error line (the field's error line, DS "something failed"), never the button's label
      f.err = `Could not ${r.step || 'reset to the workflow\'s defaults'}: ${r.error}`; f.errAt = f.src === 'write' ? '#cc-text' : f.src === 'file' ? '#cc-path' : '#cc-search'; paintForm();
    });
  }
  // ---- presets (D7): picked, applied and checked here; Update and Duplicate in the same menu ----
  function applyPreset(p) {
    const pf = RO().presetFormOf(p), f = form;
    Object.assign(f, { preset: p.id, presetObj: p, carried: { ...pf.carried, ...(pf.sameAsSource ? { sameAsSource: true } : {}) }, broken: [], resetDone: [], note: null });
    const w = flowOfId(pf.workflowId); if (w) f.workflow = w.title;
    if (pf.engine && engineLabelOf(pf.engine)) f.agent = engineLabelOf(pf.engine);
    if (pf.sourceBranch) f.base = pf.sourceBranch;
    if (pf.syncBeforeStart !== null) f.source = W.live ? Object.keys(LIVE_SOURCE).find((k) => LIVE_SOURCE[k] === pf.syncBeforeStart) : pf.syncBeforeStart ? 'the latest version from origin' : 'my local copy';
    if (pf.pr?.open) f.then = W.live ? Object.keys(LIVE_THEN).find((k) => LIVE_THEN[k] === pf.pr.open) || f.then : pf.pr.open === 'none' ? 'leave it on the branch' : 'open a PR';
    if (pf.tags.length) { const t = pf.tags.join(', '); if (t !== f.tags && f.errAt === '#cc-tags') Object.assign(f, { err: '', errAt: '' }); f.tags = t; }   // F-G-G3-02: new tags, the old refusal goes
    if (pf.featureBranch) f.branch = pf.featureBranch;
    f.presetBase = presetView();
    checkPreset(); loadPolicy();
  }
  function clearPreset() { Object.assign(form, { preset: '', presetObj: null, presetBase: null, carried: {}, broken: [], resetDone: [] }); loadPolicy(); }
  // dev's pick-time check; the items the form has reset since stay out (classic runPresetCheck)
  function checkPreset() {
    const o = OPT(), f = form, id = f.preset; if (!o || !id) return;
    o.checkPreset(id, dirOf()).then((r) => {
      if (form !== f || f.preset !== id) return;
      if (!r.ok) { f.err = `Could not check the preset: ${r.error}`; f.errAt = '#cc-text'; paintForm(); return; }
      f.broken = (Array.isArray(r.data?.broken) ? r.data.broken : []).filter((b) => !f.resetDone.includes(`${b.item}|${b.ref}`)); paintForm();
    });
  }
  function resetBroken(i) {
    const f = form, b = f.broken[i]; if (!b) return;
    const setup = RO().resetSetup(f.presetObj.setup, b, { workflowId: f.activeWf || 'wf_default', engine: f.defaultEngine || 'claude' });
    f.presetObj = { ...f.presetObj, setup }; f.resetDone = [...f.resetDone, `${b.item}|${b.ref}`];
    const pf = RO().presetFormOf(f.presetObj);
    f.carried = { ...pf.carried, ...(pf.sameAsSource ? { sameAsSource: true } : {}) };
    if (b.item === 'workflow') { const w = flowOfId(pf.workflowId); f.workflow = w ? w.title : 'Default'; }
    if (b.item === 'engine' && engineLabelOf(pf.engine)) f.agent = engineLabelOf(pf.engine);
    f.broken = f.broken.filter((x) => x !== b); paintForm('#cc-text'); checkPreset();
  }
  function updatePreset() {
    const o = OPT(), f = form; if (!o || !f.presetObj) return;
    o.updatePreset(f.preset, RO().presetSetupOf(startBody(!!f.presetObj.setup?.engine), f.presetObj), dirOf()).then((r) => {
      if (form !== f) return;
      if (!r.ok) { f.err = `Could not update the preset: ${r.error}`; f.errAt = '#cc-text'; paintForm(); return; }
      f.presetObj = r.data?.preset || f.presetObj; f.presetBase = presetView(); presetList = (presetList || []).map((p) => (p.id === f.preset ? f.presetObj : p));
      say(`Updated ${f.presetObj.name}`); paintForm();
    });
  }
  function duplicatePreset() {
    const o = OPT(), f = form; if (!o || !f.preset) return;
    o.duplicatePreset(f.preset).then((r) => {
      if (form !== f) return;
      if (!r.ok || !r.data?.preset) { f.err = `Could not duplicate the preset: ${r.error || 'no answer'}`; f.errAt = '#cc-text'; paintForm(); return; }
      const copy = r.data.preset;
      o.presets().then((l) => { if (form !== f) return; presetList = l.ok && Array.isArray(l.data?.presets) ? l.data.presets : [...(presetList || []), copy]; applyPreset(presetList.find((p) => p.id === copy.id) || copy); say(`Duplicated as ${copy.name}`); paintForm(); });
    });
  }
  // ---- a ticket source (D8): its profile gate, the search, the picked ticket ----
  const pluginOf = () => (/^plugin:\d+$/.test(form.src) ? (sourceList || [])[+form.src.slice(7)] || null : null);
  function pickSource() {
    const o = OPT(), f = form, s = pluginOf(); if (!o || !s) return;
    Object.assign(f, { profile: '', gate: null, gatePick: '', tickets: null, ticket: '', preview: null, ticketErr: '', search: '', conn: null, srcIn: {}, srcOpts: {} });
    const dir = dirOf();
    if (!s.multiProfile) { connectSource(); return; }
    if (!dir) { f.gate = { text: 'Select a project first. The source profile is bound to it.', profiles: [] }; return; }
    o.binding(dir, s.plugin, s.sourceId).then((r) => {
      if (form !== f || pluginOf() !== s) return;
      if (!r.ok) { f.gate = { text: `Could not resolve the source profile: ${r.error}`, profiles: [] }; paintForm(); return; }
      const g = RO().gateOf(r.data, s, f.project);
      if (g) { f.gate = g; f.gatePick = g.profiles[0] || ''; paintForm(); return; }
      f.profile = String(r.data.profile || ''); connectSource(); paintForm();
    });
  }
  // F-cov23-04: the source is checked before anything is listed (classic mountPluginSourcePane: validateConfig, a pending
  // sign-in polled every 5 s for up to 5 min); an unconnected one says so with its ways out, never an empty list
  const CONNECT_POLL_MS = 5000, CONNECT_MAX_MS = 5 * 60 * 1000;
  function connectSource(started = Date.now()) {
    const o = OPT(), f = form, s = pluginOf(); if (!o || !s) return;
    const name = s.displayName || s.sourceId;
    f.conn = { text: `Checking ${name} configuration…` };
    o.call(s.plugin, s.sourceId, 'validateConfig', {}, f.profile || undefined).then((r) => {
      if (form !== f || pluginOf() !== s) return;
      const v = r.ok ? r.data : { ok: false, errors: [{ message: r.error }] };
      if (v && v.ok === true) { f.conn = null; loadSourceOptions(); searchTickets(); paintForm(); return; }
      if (v && v.pending && Date.now() - started <= CONNECT_MAX_MS) {
        f.conn = { text: v.message || `Waiting for ${name} to connect…` }; paintForm();
        setTimeout(() => { if (form === f && pluginOf() === s && f.conn && !f.conn.fail) connectSource(started); }, CONNECT_POLL_MS);
        return;
      }
      const detail = v && v.pending ? 'timed out waiting for the sign-in. Press Test connection to try again' : (Array.isArray(v?.errors) ? v.errors : []).map((x) => x && x.message).filter(Boolean).join('; ') || 'connection check failed';
      f.conn = { fail: true, text: `${name} is not connected: ${detail}` }; paintForm();
    });
  }
  // the source's own inputs (source-pane.mjs): a text's default, a select's default; a remote-select is filled from its op
  const srcInputs = (s) => Object.fromEntries((s.inputs || []).filter((x) => x && x.key && x.type !== 'task-browser').map((x) => [x.key, form.srcIn?.[x.key] ?? (x.default != null ? String(x.default) : undefined)]).filter(([, v]) => v !== undefined && v !== ''));
  function loadSourceOptions() {
    const o = OPT(), f = form, s = pluginOf(); if (!o || !s) return;
    for (const x of (s.inputs || []).filter((i) => i && i.key && i.type === 'remote-select' && i.optionsFrom)) {
      f.srcOpts = { ...f.srcOpts, [x.key]: 'loading' };
      o.call(s.plugin, s.sourceId, x.optionsFrom, {}, f.profile || undefined).then((r) => {
        if (form !== f || pluginOf() !== s) return;
        f.srcOpts = { ...f.srcOpts, [x.key]: r.ok && Array.isArray(r.data) ? r.data.filter((v) => v && v.value != null).map((v) => ({ value: String(v.value), label: v.label != null ? String(v.label) : String(v.value) })) : 'failed' };
        paintForm();
      });
    }
  }
  function bindProfile() {
    const o = OPT(), f = form, s = pluginOf(), pick = f.gatePick; if (!o || !s || !pick) return;
    o.bind(dirOf(), s.plugin, s.sourceId, pick).then((r) => {
      if (form !== f) return;
      if (!r.ok) { f.err = `Could not save the profile binding: ${r.error}`; f.errAt = '#cc-search'; paintForm(); return; }
      f.gate = null; f.profile = pick; connectSource(); paintForm();
    });
  }
  let searchTimer = 0;
  function searchTickets() {
    const o = OPT(), f = form, s = pluginOf(); if (!o || !s) return;
    const asked = f.search, n = (f.searchGen = (f.searchGen || 0) + 1);
    const inputs = srcInputs(s);
    o.call(s.plugin, s.sourceId, 'listTasks', { inputs, search: asked }, f.profile || undefined).then((r) => {
      if (form !== f || f.searchGen !== n || f.search !== asked) return;   // a stale answer is dropped
      f.ticketErr = r.ok ? '' : `search failed: ${r.error}`; f.tickets = r.ok ? (Array.isArray(r.data?.tasks) ? r.data.tasks : []) : null; paintForm();
    });
  }
  function pickTicket(id) {
    const o = OPT(), f = form, s = pluginOf(); if (!o || !s) return;
    f.ticket = f.ticket === id ? '' : id; f.preview = null; paintForm(`[data-c-ticket="${CSS.escape(id)}"]`);
    if (!f.ticket) return;
    o.call(s.plugin, s.sourceId, 'getTask', { id }, f.profile || undefined).then((r) => { if (form !== f || f.ticket !== id) return; f.preview = r.ok ? { title: String(r.data?.title || id), body: String(r.data?.body || '') } : { title: id, body: `preview failed: ${r.error}` }; paintForm(); });
  }
  function sourceHtml(s) {
    const name = s.displayName || s.sourceId;
    if (form.gate) {
      const pick = form.gate.profiles.length ? `<span>Profile ${R.sentencePicker({ id: 'f-gprofile', text: form.gatePick || 'pick one', items: form.gate.profiles.map((p) => ({ id: p, text: p, checked: p === form.gatePick })), open: menu === 'f-gprofile', chevron: chev })}</span>` : '';
      return `${R.choiceNote({ text: form.gate.text, ways: form.gate.profiles.length ? [{ label: 'Use this profile', kind: 'primary', attrs: { 'data-c-bind': '' } }] : [] })}${pick}`;
    }
    if (form.conn) return form.conn.fail ? R.choiceNote({ text: form.conn.text, ways: [{ label: 'Open the Marketplace page', kind: 'quiet', attrs: { 'data-c-market': '' } }, { label: 'Test connection', kind: 'primary', attrs: { 'data-c-srctest': '' } }] }) : `<p class="cc-proof">${esc(form.conn.text)}</p>`;
    const own = (s.inputs || []).filter((x) => x && x.key && x.type !== 'task-browser').map((x) => {
      const label = x.label || x.key, v = srcInputs(s)[x.key] || '';
      if (x.type === 'text') return R.field({ id: `cc-in-${x.key}`, label, value: v, attrs: { 'data-src-in': x.key } });
      const opts = x.type === 'select' ? (x.options || []).map((o) => (typeof o === 'object' ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) })) : form.srcOpts?.[x.key];
      const list = Array.isArray(opts) ? opts : [];
      const text = opts === 'loading' ? 'Loading…' : opts === 'failed' ? 'failed to load' : list.find((o) => o.value === v)?.label || v || 'pick one';
      return `<span>${esc(label)} ${R.sentencePicker({ id: `si-${x.key}`, text, items: list.map((o) => ({ id: o.value, text: o.label, checked: o.value === v })), open: menu === `si-${x.key}`, chevron: chev })}</span>`;
    }).join('');
    const rows = (form.tickets || []).map((t) => R.listRow({ title: String(t.title || t.id), meta: Array.isArray(t.labels) ? t.labels.join(', ') : '', check: form.ticket === String(t.id), open: { 'data-c-ticket': String(t.id) }, boxAttrs: { 'data-c-ticket': String(t.id) } })).join('');
    const empty = form.tickets && !form.tickets.length ? `<p class="cc-proof">${form.search ? 'No tasks matched.' : 'Type to search.'}</p>` : '';
    const fail = form.ticketErr ? `<p class="cc-proof">${esc(form.ticketErr)}</p>` : '';
    const prev = form.preview ? R.prose({ text: `${form.preview.title}\n\n${form.preview.body}` }) : '';
    return `${own}${R.field({ id: 'cc-search', label: `Search ${name}`, error: errOf('#cc-search'), value: form.search, placeholder: `Search ${name}…`, attrs: { 'data-f': 'search' } })}${rows ? `<div class="cc-tickets">${rows}</div>` : ''}${empty}${fail}${prev}`;
  }
  // the one note under the text (form.run-options): the newest refusal, else the broken preset, else the team policy
  function noteHtml() {
    const n = form.note, busy = form.busy ? { disabled: true } : {};
    if (n?.kind === 'engine') return R.choiceNote({ text: n.error, means: n.overridable ? RO().ENGINE_TICK : '', end: n.overridable ? R.checkbox({ label: RO().ENGINE_ALLOW, checked: !!form.allow, attrs: { 'data-c-allow': '' } }) : '' });
    if (n?.kind === 'sync') return R.choiceNote({ text: n.title, means: n.note || '', rows: n.rows.map((text) => ({ text })), ways: [{ label: 'Cancel', kind: 'quiet', attrs: { 'data-c-sync': 'cancel', ...busy } }, ...(n.primary ? [{ label: n.primary.label, kind: 'primary', attrs: { 'data-c-sync': n.primary.policy, ...busy } }] : [])] });
    if (form.broken?.length) { const b = RO().brokenNoteOf(form.broken); return R.choiceNote({ text: b.title, means: 'Start waits until each item is fixed', rows: b.rows.map((x, i) => ({ text: x.reset ? x.text : `${x.text} · Edit the preset's scope in Settings › Presets`, ...(x.reset ? { way: { label: 'Reset to default', attrs: { 'data-c-preset-reset': String(i) } } } : {}) })) }); }
    const p = form.policy;
    return p ? R.choiceNote({ needsYou: p.tone === 'amber', text: p.head, rows: [...p.rows.map((x) => ({ text: x.text })), ...(p.caps ? [{ text: p.caps }] : [])] }) : '';
  }

  // live: dev's GET /api/projects (the store's projects part, less a Remove's undo window), never task rows (F-a4-06)
  const liveProjects = () => { const gone = window.RailProjectsLive?.hidden?.() || new Set(); return (W.part('projects') || []).filter((p) => p.id && !gone.has(p.id)).map((p) => ({ name: p.name || p.id, missing: p.origin === 'missing' })); };
  const projects = () => [...new Set([...(W.live ? liveProjects().map((p) => p.name) : W.rows().map((r) => r.project).filter(Boolean)), 'No project'])];
  // the project used last: the newest task's (a waiting schedule is not used yet) if listed and its folder is there; a missing folder is never preselected
  function defaultProject() {
    if (!W.live) return projects().includes('billing-api') ? 'billing-api' : projects()[0];
    const ok = liveProjects().filter((p) => !p.missing).map((p) => p.name);
    return W.rows().find((r) => !String(r.id).startsWith('sched:') && ok.includes(r.project))?.project ?? ok[0] ?? 'No project';
  }
  const LISTS = () => ({ project: projects(), workflow: flows().map((w) => w.title), agent: W.live ? [LIVE_AGENT, ...engines().map((e) => e.label)] : ['Claude', 'Codex', 'Gemini'], base: W.live ? [LIVE_BASE, ...liveBranches.list] : ['main', 'dev'], source: W.live ? [LIVE_SETUP, ...Object.keys(LIVE_SOURCE)] : ['the latest version from origin', 'my local copy'], then: W.live ? [LIVE_SETUP, ...Object.keys(LIVE_THEN)] : Object.keys(THEN), every: R.REPEATS.filter((x) => x !== 'once' && x !== 'every hour').map((x) => x.replace(/^every /, '')), at: R.TIMES_OF_DAY, tz: [...new Set([homeTz(), 'Europe/Sofia', 'UTC', 'Europe/Berlin', 'America/New_York'])], ends: ['no end date', 'after 10 runs', 'after 30 days'], overlap: ['skip if still going', 'queue if still going'], fails: ['pause after 3 failures', 'pause after 5 failures', 'never pause'], cap: ['the workflow\'s own', 'at $5', 'at $20'], agents: W.live ? [AGENTS_OWN, ...liveAgentPicks().map((x) => x.text)] : [AGENTS_OWN, 'Sonnet for every step', 'Opus for every step'] });
  const blank = (kind, keep = {}) => ({ kind, project: defaultProject(), workflow: 'Default', agent: W.live ? LIVE_AGENT : 'Claude', base: W.live ? LIVE_BASE : 'main', source: W.live ? LIVE_SETUP : 'the latest version from origin', then: W.live ? LIVE_SETUP : 'open a PR', text: '', path: '', src: 'write', name: '', more: false, title: '', branch: '', tags: '', files: [], agents: 'the workflow\'s own', cap: 'the workflow\'s own', every: 'weekday', at: '09:00', tz: homeTz(), ends: 'no end date', overlap: 'skip if still going', fails: 'pause after 3 failures', err: '', ...OPTS_BLANK(), ...keep });
  // COV-2: what the run options keep while the form is open (form.run-options)
  const OPTS_BLANK = () => ({ agentTouched: false, tagsTouched: false, workflowTouched: false, projectKey: '', defaultsFor: null, defaultEngine: '', activeWf: '', preset: '', presetObj: null, presetBase: null, carried: {}, broken: [], resetDone: [], profile: '', gate: null, gatePick: '', search: '', tickets: null, ticket: '', preview: null, ticketErr: '', note: null, allow: false, policy: null, tagsSaid: '', flowSaid: '' });
  const fPick = (k, tip) => R.sentencePicker({ id: `f-${k}`, text: form[k], tip, items: LISTS()[k].map((v) => ({ id: v, text: v, checked: v === form[k] })), open: menu === `f-${k}`, chevron: chev });
  const proof = () => { const w = flows().find((x) => x.title === form.workflow), s = (w?.steps || []).map((x) => VERB[x] || x.toLowerCase()), last = s.pop(); return `${form.workflow} ${[s.join(', '), last].filter(Boolean).join(' and ')}, then ${THEN[form.then] || 'does what the project is set up to do'}.`.replace(' and , ', ' ').replace(' , ', ', '); };
  const errOf = (at) => (form.errAt === at ? form.err : '');   // the line sits under the field it is about
  function formHtml() {
    const sched = form.kind === 'schedule';
    const after = form.after ? `<br> It starts once ${esc(form.after.title)} ends` : '';   // Run after this (dev's Schedule next…): it waits for that one
    const task = form.kind === 'task', fit = task && RO() && presetList ? fits() : [];
    // a saved preset leads the frame once one exists for this project (D7); its menu: the presets, Update and Duplicate, No preset
    const presetItems = [...fit.map((p) => ({ id: `p:${p.id}`, text: p.name, checked: p.id === form.preset })), ...(form.preset ? [{ sep: true }, ...(RO().presetModified(form.presetBase, presetView()) ? [{ id: 'update', text: 'Update preset', help: 'Saves these picks into the preset' }] : []), { id: 'duplicate', text: 'Duplicate', help: 'Saves a copy and starts from it' }] : []), { sep: true }, { id: 'none', text: 'No preset', checked: !form.preset }];
    const from = fit.length || form.preset ? ` from ${R.sentencePicker({ id: 'f-preset', text: form.presetObj?.name || 'no preset', tip: 'A saved setup to start from', items: presetItems, open: menu === 'f-preset', chevron: chev })}` : '';
    const frame = `<div class="cc-frame"><span>A task on ${fPick('project', 'The project you used last')}${from} using the ${fPick('workflow')} workflow, run by ${fPick('agent')},<br> from ${fPick('base')}, ${fPick('source')}, then ${fPick('then')}${after}</span><span class="cc-proof">${esc(proof())}</span></div>`;
    const src = R.segmented({ label: 'Task source', hook: 'c-src', items: [{ id: 'write', label: 'Write it', pressed: form.src === 'write' }, { id: 'file', label: 'From file', pressed: form.src === 'file' }, ...(task ? (sourceList || []).map((x, i) => ({ id: `plugin:${i}`, label: x.displayName || x.sourceId, pressed: form.src === `plugin:${i}` })) : [])] });
    const plugin = task ? pluginOf() : null;
    const what = plugin ? `<div class="cc-src">${src}${sourceHtml(plugin)}</div>${noteHtml()}` : `<div class="cc-lbl">${form.src === 'write' ? R.field({ id: 'cc-text', label: 'What should it do', multiline: true, error: errOf('#cc-text'), value: form.text, placeholder: sched ? 'What should each run do?' : 'Describe the software task to build…', attrs: { 'data-f': 'text', rows: 5 } }) : R.field({ id: 'cc-path', label: 'What should it do', error: errOf('#cc-path'), value: form.path, placeholder: 'A file in the project: docs/task.md', attrs: { 'data-f': 'path' } })}${src}</div>${task ? noteHtml() : ''}`;
    const fold = (label, says) => `<div class="cc-fold">${R.button({ label, kind: 'quiet', icon: R.icon(form.more ? 'chevron' : 'chevR', 12), attrs: { 'data-c-more': '', 'aria-expanded': String(form.more) } })}<span>${esc(says)}</span></div>`;
    if (sched) {
      const body = `${frame}${R.field({ id: 'cc-name', label: 'Name', error: errOf('#cc-name'), value: form.name, placeholder: 'What to call this schedule', attrs: { 'data-f': 'name', maxlength: 80 } })}${what}
        <div class="cc-frame"><span>Every ${fPick('every')} at ${fPick('at')} in ${fPick('tz')}</span><span class="cc-proof">Next: ${esc(R.scheduleDates({ every: `every ${form.every}`, at: form.at, from: Sch().TODAY }).map((d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')).join(', '))}.</span></div>
        ${fold('If something gets in the way', `${cap(form.ends)}; ${form.overlap}; ${form.fails}`)}${form.more ? `<div class="cc-more"><span>It ends with ${fPick('ends')}</span><span>A run still going means ${fPick('overlap')}</span><span>When runs fail, ${fPick('fails')}</span></div>` : ''}`;
      return R.dialog({ title: 'New schedule', body, yes: R.scheduleButton({ every: `every ${form.every}`, at: form.at }), close: R.icon('x', 15), id: 'cc-t', cls: 'cc-dlg', hooks: hooksOf() });
    }
    // Agents' quiet pair (D6): the one model saved as the workflow's defaults, or the project's picks reset to them
    const id = flowId(), flowOwn = !!OPT() && !!id && !RO().RESERVED_WORKFLOWS.includes(id) && form.project !== 'No project' && agentIds().length;
    const flowBtns = flowOwn ? `${agentModel() ? R.button({ label: form.flowSaid || 'Save as the workflow\'s defaults', kind: 'quiet', attrs: { 'data-c-flowsave': '', title: `Every agent of ${form.workflow} runs ${form.agents.replace(/ for every step$/, '')} unless a task picks another` } }) : ''}${R.button({ label: !agentModel() && form.flowSaid ? form.flowSaid : 'Reset to the workflow\'s defaults', kind: 'quiet', attrs: { 'data-c-flowreset': '', title: `Clears ${form.project}'s own agent picks for ${form.workflow}` } })}` : '';
    const perStep = W.live && LISTS().agents.length < 2 ? `<span>Cost cap: ${fPick('cap')}</span>` : `<span>Agents: ${fPick('agents')}${flowBtns}</span><span>Cost cap: ${fPick('cap')}</span>`;
    const tagsSave = form.projectKey && OPT() ? R.button({ label: form.tagsSaid || 'Save as default', kind: 'quiet', attrs: { 'data-c-tagsave': '', title: `New tasks in ${form.project} start with these tags` } }) : '';
    const body = `${frame}${what}${fold('More options', `${W.live ? 'Title, branch, cost tags, agents, cost cap, files' : 'Title, branch, cost tags, agents, guardrails, files'}${form.preset ? ', preset' : ''}`)}${form.more ? `<div class="cc-more">${R.field({ id: 'cc-title', label: 'Title', value: form.title, placeholder: 'Worca names it from what it should do', attrs: { 'data-f': 'title', maxlength: NAME_MAX } })}${R.field({ id: 'cc-branch', label: 'Branch', value: form.branch, placeholder: 'Worca makes one', attrs: { 'data-f': 'branch' } })}${R.field({ id: 'cc-tags', label: 'Cost tags', error: errOf('#cc-tags'), value: form.tags, placeholder: 'Comma separated', attrs: { 'data-f': 'tags' } })}${tagsSave}${perStep}<span>${R.button({ label: 'Add files…', kind: 'quiet', attrs: { 'data-c-files': '', title: 'Attaches files to the task' } })}${form.files.length ? ` ${esc(form.files.map((x) => x.name).join(', '))}` : ''}</span></div>` : ''}`;
    return R.dialog({ title: 'New task', body, yes: form.after ? 'Start after it' : 'Start task', busy: !!form.busy, busyLabel: 'Starting…', status: `${R.button({ label: 'Schedule…', kind: 'quiet', attrs: { 'data-c-tosched': '', title: 'The same task, at a time' } })}`, close: R.icon('x', 15), id: 'cc-t', cls: 'cc-dlg', hooks: hooksOf() });
  }
  const hooksOf = () => ({ close: {}, cancel: {}, yes: {} });
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  // the forms' host sits beside #app, never in it: Pulse rewrites #app on every draw (live loads, frames), which would drop an
  // open form. rail-layer gives it #app's fixed full-window box, so the scrim still covers the window and an empty host takes no clicks.
  const host = () => { let h = document.getElementById('center-dlg'); if (!h) { h = document.createElement('div'); h.id = 'center-dlg'; h.className = 'pz-app rail-page rail-layer'; document.body.append(h); h.addEventListener('click', dlgClick); h.addEventListener('input', dlgInput); h.addEventListener('keydown', dlgKey); h.addEventListener('mousedown', (e) => { if (e.target.classList.contains('viewer-modal')) closeForm(); }); } return h; };
  // F-gb21-01: a repaint with no focus target (a live load landing) keeps the field that had the focus, its caret and selection
  const focusOf = (h) => { const a = document.activeElement; if (!a || a === h || !h.contains(a)) return null; const sel = a.id ? `#${a.id}` : a.dataset.menu ? `[data-menu="${a.dataset.menu}"]` : a.dataset.f ? `[data-f="${a.dataset.f}"]` : ''; let at = null; try { at = [a.selectionStart, a.selectionEnd, a.selectionDirection]; } catch { /* no caret on a button */ } return sel ? { sel, at } : null; };
  function paintForm(focus) {
    const h = host(), scroll = h.querySelector('.dlg-body')?.scrollTop || 0, had = focus ? null : focusOf(h);
    h.innerHTML = form ? formHtml() : '';
    if (!form) return;
    const b = h.querySelector('.dlg-body'); if (b) b.scrollTop = scroll;
    if (focus) { h.querySelector(focus)?.focus(); return; }
    const el = had && h.querySelector(had.sel); if (!el) return;
    el.focus(); if (had.at && had.at[0] != null) try { el.setSelectionRange(...had.at); } catch { /* not a text field */ }
  }
  // Esc closes the open form wherever the focus is (F-gb21-01): the host's own listener only hears keys from inside it
  const escAnywhere = (e) => { if (e.key === 'Escape' && form && !host().contains(e.target)) dlgKey(e); };
  const formOff = () => { form = null; menu = ''; document.removeEventListener('keydown', escAnywhere, true); };
  function openForm(kind, keep) { menu = ''; opener = document.activeElement; form = blank(kind, keep); document.addEventListener('keydown', escAnywhere, true); loadFlows(); loadBranches(); loadOptions(); paintForm(kind === 'schedule' ? '#cc-name' : '#cc-text'); }
  // a route change closes the form, as the account menu does (pulse.js): only a redraw of the same page keeps it; the next page owns the focus
  addEventListener('hashchange', () => { if (!form) return; formOff(); opener = null; paintForm(); });
  function closeForm() { formOff(); paintForm(); (opener?.isConnected && opener !== document.body ? opener : document.querySelector('#bar-head [data-bar-new]'))?.focus(); }   // a menu's item is gone by now: back to its +
  function check() {
    if (form.kind === 'task' && pluginOf()) return form.ticket ? null : [RO().PICK_FIRST, '#cc-search'];   // a ticket source: the picked ticket is the task
    if (form.kind === 'task' && form.broken?.length) return ['Reset each item the preset needs first', '#cc-text'];   // D7: broken items block Start
    const words = form.src === 'write' ? form.text.trim() : form.path.trim();
    if (form.kind === 'schedule' && !form.name.trim()) return ['Name it first', '#cc-name'];
    if (form.kind === 'schedule' && Sch().all().some((s) => s.title.toLowerCase() === form.name.trim().toLowerCase())) return ['A schedule already has that name', '#cc-name'];
    if (!words) return [form.src === 'write' ? 'Say what it should do' : 'Name the file it should follow', form.src === 'write' ? '#cc-text' : '#cc-path'];
    return null;
  }
  // the form's overlap and failures words as dev's values (both kinds)
  const policiesOf = (f) => ({ overlap: /^queue/.test(f.overlap) ? 'queue' : 'skip', maxFailures: /never/.test(f.fails) ? 0 : Number(/\d+/.exec(f.fails)?.[0] || 3) });
  function save() {
    const bad = check(); if (bad) { form.err = bad[0]; form.errAt = bad[1]; paintForm(bad[1]); return; }
    if (W.live && form.kind === 'task') { liveStart(); return; }   // D12b: dev's POST /api/run
    if (W.live && form.kind === 'schedule') { liveSchedule(); return; }   // Schedules D9: dev's POST /api/run with repeat
    if (form.kind === 'task' && demoRefused()) return;   // the demo's engine and sync notes (D13), in the live kind's words
    const ticket = pluginOf() && (form.tickets || []).find((t) => String(t.id) === form.ticket);
    const words = (ticket ? String(ticket.title) : form.src === 'write' ? form.text : `Follow ${form.path}`).trim(), project = form.project === 'No project' ? '' : form.project, k = Date.now().toString(36);
    if (form.kind === 'task') {
      const title = form.title.trim() || (words.length > 56 ? `${words.slice(0, 54).trim()}…` : words);
      const f = form; closeForm();
      if (f.after) { Sch().add({ id: `n${k}`, title, project, chat: '', every: 'Once', at: '', next: `after ${f.after.title}`, state: 'scheduled', time: 'after', section: 'next', labels: [], what: words, cost: 0, started: Sch().dateWord(Sch().TODAY), runs: [], after: f.after.title, afterRef: { kind: f.after.kind, id: f.after.id, policy: 'done' } }); say(`Scheduled ${title}: it starts once ${f.after.title} ends`); paint(); return; }
      W.add({ id: `n-${k}`, case: 'starting', title, project, detail: 'Plan is under way', time: 'now', day: 'today', cost: 0, workflow: f.workflow, kind: project ? 'Git' : 'No project' });
      say(`Started ${title}`); paint(); return;
    }
    const every = `every ${form.every}`, w = R.scheduleWords({ every, at: form.at }), s = { id: `n${k}`, title: form.name.trim(), project, chat: '', every, at: form.at, tz: form.tz, next: w.next, day: w.day, state: 'scheduled', time: w.time, section: 'next', labels: [], what: words.endsWith('.') ? words : `${words}.`, cost: 0, started: Sch().dateWord(Sch().TODAY), workflow: form.workflow, agent: form.agent, base: form.base, then: form.then, ends: form.ends, overlap: policiesOf(form).overlap, fails: policiesOf(form).maxFailures, runs: [] };
    closeForm(); Sch().add(s); say(`Scheduled ${s.title}: ${R.scheduleWords(s).runs}`); paint();
  }
  // New task… in the live kind (D12b): POST /api/run { projectDir | noProject, prompt, workflowId?, engine?, sourceBranch?, syncBeforeStart?, pr?,
  // costCapUsd?, overlay? }; on ok the task's page opens, a refusal stays in the form with what was typed. One start at a time.
  // the frame's picks as dev's run fields, the same for a task and a schedule: workflow, engine and, with a project, its
  // base, sync and PR (No project has no git); a schedule stores them and replays them at each fire
  function runFields(none) {
    const wf = flows().find((x) => x.title === form.workflow)?.id || '';
    const engine = engines().find((e) => e.label === form.agent)?.id || '';
    const git = none ? {} : { ...(form.base && form.base !== LIVE_BASE ? { sourceBranch: form.base } : {}),
      ...(form.source in LIVE_SOURCE ? { syncBeforeStart: LIVE_SOURCE[form.source] } : {}), ...(LIVE_THEN[form.then] ? { pr: { open: LIVE_THEN[form.then] } } : {}) };
    return { ...(wf ? { workflowId: wf } : {}), ...(engine ? { engine } : {}), ...git };
  }
  // the start's one body (R-arch-2): the frame's picks, More options, and the run options (COV-2) — a preset's id and what
  // it carries, a picked ticket in place of the words, the engine consent; nothing extra when no option is used.
  // `keepPin`: Update preset keeps Claude when the preset pins an engine (COV-2 m-pin); only the start drops it
  function startBody(keepPin) {
    const words = (form.src === 'write' ? form.text : `Follow ${form.path}`).trim(), s = pluginOf();
    const none = form.project === 'No project', dir = none ? '' : window.RailTaskLive?.projectDirOf(form.project) || '';
    const usd = form.cap === LISTS().cap[0] ? null : capUsd(form.cap);
    const tags = form.tags.split(',').map((x) => x.trim()).filter(Boolean);
    const every = liveAgentPicks().find((x) => x.text === form.agents)?.model || '';   // one model for each agent node: dev's overlay.nodes
    const overlay = every ? { nodes: Object.fromEntries(liveFlow().agents.map((id) => [id, { model: every }])) } : null;
    const body0 = runFields(none);
    const body = { ...(none ? { noProject: true } : dir ? { projectDir: dir } : {}), prompt: words, ...body0,
      ...(!none && form.branch.trim() ? { featureBranch: form.branch.trim() } : {}), ...(usd ? { costCapUsd: usd } : {}), ...(overlay ? { overlay } : {}),
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      ...(tags.length ? { tags } : {}), ...(form.files.length ? { extras: form.files.map(({ name, dataBase64 }) => ({ name, dataBase64 })) } : {}),
      ...(form.after ? { after: { kind: form.after.kind, id: form.after.id }, afterPolicy: 'done' } : {}),
      ...(body0.workflowId === 'wf_auto' ? { humanInLoop: form.hitl !== false } : {}) };   // Auto only: classic's switch, on unless the project turned it off
    if (form.preset) Object.assign(body, Object.fromEntries(Object.entries(form.carried).filter(([k]) => k !== 'overlay' || !overlay)), { presetId: form.preset });
    if (s && form.ticket) { delete body.prompt; body.source = RO().sourceBodyOf({ plugin: s.plugin, sourceId: s.sourceId, taskId: form.ticket, inputs: srcInputs(s), profile: form.profile }); }
    // dev's Claude default is not sent as a pick (classic startRun): the body stays as before the defaults were read
    if (!keepPin && body.engine === 'claude' && form.defaultEngine === 'claude') delete body.engine;
    if (form.allow && (body.engine || form.defaultEngine || 'claude') !== 'claude') body.allowUnguardedEngine = true;
    return body;
  }
  // `extra`: a resend after a refusal, the form's body as it is now plus one key (syncPolicy): an edit made since is never lost
  async function liveStart(extra) {
    if (form.busy) return;
    const body = { ...startBody(), ...extra };
    const ticket = pluginOf() && (form.tickets || []).find((t) => String(t.id) === form.ticket);
    const words = (ticket ? String(ticket.title) : form.src === 'write' ? form.text : `Follow ${form.path}`).trim();
    const f = form; f.busy = true; paintForm();
    const res = await window.RailTaskLive?.act('new-task', { body, quiet: true, key: 'new-task:form' });
    f.busy = false;
    if (form !== f) return;
    if (!res?.ok && refused(res)) return;
    if (!res?.ok) { form.err = `Could not start the task: ${res?.error || 'no answer'}`; form.errAt = form.src === 'write' ? '#cc-text' : '#cc-path'; paintForm(form.errAt); return; }
    closeForm();
    if (f.after) { say(`Scheduled ${f.title.trim() || words}: it starts once ${f.after.title} ends`); return; }   // a waiting ticket, no task yet: Schedules lists it
    say(`Started ${f.title.trim() || words}`);
    if (res.data?.runId) window.RailShell?.go(`run/${res.data.runId}`);
  }
  // A refused start that has a note (D7, D9, D10): the note says it, under the text, and the form stays as it was
  function refused(res) {
    const r = RO()?.refusalOf(res); if (!r || r.kind === 'other') return false;
    if (r.kind === 'engine') form.note = { kind: 'engine', error: r.error, overridable: r.overridable };
    else if (r.kind === 'sync') form.note = { kind: 'sync', ...RO().syncNoteOf(r) };
    else { if (!form.preset) return false; form.note = null; form.broken = r.broken.filter((b) => !form.resetDone.includes(`${b.item}|${b.ref}`)); }
    form.err = ''; form.errAt = ''; paintForm(r.kind === 'sync' ? '[data-c-sync]:last-child' : r.kind === 'engine' && r.overridable ? '[data-c-allow]' : '#cc-text');
    return true;
  }
  function syncWay(policy) {
    if (policy === 'cancel') { form.note = null; paintForm('[data-dialog="yes"]'); say(RO().START_CANCELLED); return; }
    if (W.live) { liveStart({ syncPolicy: policy }); return; }
    form.note = null; form.synced = true; save();
  }
  // the demo (D13): a non-Claude Agent with no consent meets the engine refusal, a start from dev meets the diverged base
  function demoRefused() {
    if (W.live || !RO()) return false;
    const res = form.agent !== 'Claude' && !form.allow ? { ok: false, status: 409, error: `${form.agent} cannot enforce the guardrails Strict`, code: 'engine-refused', data: { code: 'engine-refused', error: `${form.agent} cannot enforce the guardrails Strict`, overridable: true } }
      : form.base === 'dev' && !form.synced ? { ok: false, status: 409, code: 'sync-diverged', data: { code: 'sync-diverged', options: ['origin', 'cancel'], members: [{ projectName: form.project, base: 'dev', remote: 'origin', ahead: 2, behind: 3 }] } } : null;
    return !!res && refused(res);
  }
  // New schedule… in the live kind (Schedules D9): POST /api/run { projectDir | noProject, prompt, title, repeat: { rule } }, through
  // RailScheduleLive (the rule from its words, live/schedule-rule.mjs); a refusal stays in the form with what was typed.
  async function liveSchedule() {
    if (form.busy) return;
    const words = (form.src === 'write' ? form.text : `Follow ${form.path}`).trim(), none = form.project === 'No project';
    const dir = none ? '' : window.RailTaskLive?.projectDirOf(form.project) || '';
    if (!none && !dir) { form.err = 'Could not create the schedule: that project is not known'; form.errAt = '#cc-name'; paintForm(form.errAt); return; }   // never a no-project schedule by accident
    const f = form; f.busy = true; paintForm();
    const res = await window.RailScheduleLive?.act('new', { ...(none ? { noProject: true } : { projectDir: dir }), run: runFields(none), prompt: words, title: f.name.trim(), every: `every ${f.every}`, at: f.at, tz: f.tz,
      end: window.RailScheduleLive.endOf?.(f.ends) || null, ...policiesOf(f) });
    f.busy = false;
    if (form !== f) return;
    if (!res?.ok) { form.err = `Could not create the schedule: ${res?.error || 'no answer'}`; form.errAt = form.src === 'write' ? '#cc-text' : '#cc-path'; paintForm(form.errAt); return; }
    closeForm(); say(`Scheduled ${f.name.trim()}: ${R.scheduleWords({ every: `every ${f.every}`, at: f.at }).runs}`);
  }
  function dlgClick(e) {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-menu-pick^="f-preset|"]'))) { const v = hit.dataset.menuPick.slice('f-preset|'.length); menu = ''; if (v === 'update') updatePreset(); else if (v === 'duplicate') duplicatePreset(); else if (v === 'none') clearPreset(); else { const p = (presetList || []).find((x) => `p:${x.id}` === v); if (p) applyPreset(p); } paintForm('[data-menu="f-preset"]'); return; }
    if ((hit = on('[data-menu-pick^="si-"]'))) { const [id, ...v] = hit.dataset.menuPick.split('|'); form.srcIn = { ...form.srcIn, [id.slice(3)]: v.join('|') }; menu = ''; paintForm(`[data-menu="${id}"]`); searchTickets(); return; }
    if ((hit = on('[data-menu^="si-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paintForm(`[data-menu="${hit.dataset.menu}"]`); return; }
    if ((hit = on('[data-menu-pick^="f-gprofile|"]'))) { form.gatePick = hit.dataset.menuPick.slice('f-gprofile|'.length); menu = ''; paintForm('[data-menu="f-gprofile"]'); return; }
    if ((hit = on('[data-menu-pick^="f-"]'))) {
      const [id, v] = hit.dataset.menuPick.split('|'); form[id.slice(2)] = v; menu = '';
      if (id === 'f-project') { form.base = W.live ? LIVE_BASE : form.base; loadBranches(); form.note = null; if (form.preset && form.presetObj?.scope?.kind !== 'global') clearPreset(); else checkPreset(); loadProject(); if (pluginOf()) pickSource(); }
      if (id === 'f-base' || id === 'f-source') { form.note = null; form.synced = false; }   // a changed base or source is asked again
      if (id === 'f-agent') { form.agentTouched = true; form.allow = false; if (form.note?.kind === 'engine') form.note = null; }   // the consent was for the engine refused
      if (id === 'f-workflow') { form.workflowTouched = true; const wf = flowId(), dir = dirOf(); if (W.live && !form.preset && wf && dir) OPT()?.setActiveWorkflow(dir, wf).then((r) => { if (!r.ok) window.RailAdapter?.toast?.(`Could not select the workflow: ${r.error}`); }); }
      if (!LISTS().agents.includes(form.agents)) form.agents = AGENTS_OWN;
      if (id === 'f-agents' || id === 'f-workflow') loadPolicy();
      paintForm(`[data-menu="${id}"]`); return;
    }
    if ((hit = on('[data-menu^="f-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paintForm(`[data-menu="${hit.dataset.menu}"]`); return; }
    if (menu) { menu = ''; paintForm(); }
    if ((hit = on('[data-c-src]'))) { form.src = hit.dataset.cSrc; if (pluginOf()) { pickSource(); paintForm('#cc-search'); return; } paintForm(form.src === 'write' ? '#cc-text' : '#cc-path'); return; }
    if (e.target.matches?.('input[data-c-allow]')) { form.allow = e.target.checked; paintForm('[data-c-allow]'); return; }
    if ((hit = on('[data-c-sync]'))) { if (!hit.disabled) syncWay(hit.dataset.cSync); return; }
    if ((hit = on('[data-c-preset-reset]'))) { resetBroken(+hit.dataset.cPresetReset); return; }
    if (on('[data-c-bind]')) { bindProfile(); return; }
    if (on('[data-c-srctest]')) { connectSource(); paintForm(); return; }
    if (on('[data-c-market]')) { closeForm(); window.RailShell.go('marketplace'); return; }
    if ((hit = on('[data-c-ticket]'))) { if (hit.matches('input')) e.preventDefault(); pickTicket(hit.dataset.cTicket); return; }
    if (on('[data-c-tagsave]')) { saveTags(); return; }
    if (on('[data-c-flowsave]')) { saveFlow(false); return; }
    if (on('[data-c-flowreset]')) { saveFlow(true); return; }
    if (on('[data-c-more]')) { form.more = !form.more; paintForm('[data-c-more]'); return; }
    if (on('[data-c-tosched]')) { form = blank('schedule', { project: form.project, workflow: form.workflow, agent: form.agent, base: form.base, source: form.source, then: form.then, text: form.text, path: form.path, src: /^plugin:/.test(form.src) ? 'write' : form.src, name: form.title }); paintForm('#cc-name'); return; }
    if (on('[data-c-files]')) { pickFiles(); return; }
    if ((hit = on('[data-dialog]'))) { if (hit.dataset.dialog === 'yes') save(); else closeForm(); }
  }
  // Add files…: the files go with the task as dev's New run sends them (POST /api/run `extras`, [{ name, dataBase64 }]).
  function pickFiles() {
    const f = form, input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', async () => {
      const read = (file) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok({ name: file.name, dataBase64: String(r.result).replace(/^data:[^,]*,/, '') }); r.onerror = () => ok(null); r.readAsDataURL(file); });
      const got = (await Promise.all([...(input.files || [])].map(read))).filter(Boolean);
      if (form !== f || !got.length) return;
      form.files = [...form.files.filter((x) => !got.some((g) => g.name === x.name)), ...got];
      paintForm('[data-c-files]');
    });
    input.click();
  }
  function dlgInput(e) {
    const si = e.target.dataset?.srcIn; if (si) { form.srcIn = { ...form.srcIn, [si]: e.target.value }; clearTimeout(searchTimer); searchTimer = setTimeout(searchTickets, 300); return; }   // a filter reruns the list (source-pane.mjs)
    const k = e.target.dataset?.f; if (!k) return; form[k] = e.target.value;
    if (k === 'tags') form.tagsTouched = true;
    if (k === 'search') { clearTimeout(searchTimer); searchTimer = setTimeout(searchTickets, 300); }   // source-pane.mjs's debounce
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
    tasks: (el) => { wire(); tasksHost = el; menu = ''; asking = null; if (W.live) window.RailInsightsLive?.retryWeek?.(); paint(); },   // a visit reads a failed week again
    schedules: (el) => { wire(); schedHost = el; menu = ''; if (/^#schedules/.test(location.hash)) el.innerHTML = schedulesHtml(); },
    maker: (which) => (advanced() ? MAKERS[which] : null),
    newTask: (keep = {}) => { wire(); openForm('task', { ...keep, ...(keep.project && !projects().includes(keep.project) ? { project: defaultProject() } : {}) }); },   // Run after this: the New task form, waiting for that one
    // the Projects center's strip, under its home's head; a strip asked there is dropped once its home is left
    askStrip: () => (asking?.where === 'place' && W.find(asking.id) ? stripOf(asking) : ''), unask: () => { if (asking?.where === 'place') asking = null; },
    paint, wire, taskOf, stateOf, clause, actionsOf, schedLink, link, inWeek,
  };
})();
