// The Tasks and Schedules centers (Wave 3; docs/stillhet/panels.md › panel.center):
// the landing page of each, cards from the one store, so a card changes when its task or schedule does. And the two forms,
// New task and New schedule (also a schedule's Edit…), as Dialogs of labelled fields. Everything drawn comes from the
// library; this says what each thing is.
(function () {
  const R = window.StillhetUI, W = window.StillhetWorld, RM = window.RunCardModel;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.StillhetPulse?.say(t, undo);
  const usd = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;   // F-fm-02: thousands separated ($2,551.75)
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const advanced = () => R.shows('advanced');
  const List = () => window.StillhetRunsList, Sch = () => window.StillhetSchedules;
  const WEEK = { from: 1102, to: 1108, label: 'this week' };   // Monday to today, in the list's own date keys: the seven real days the figure opens
  const inWeek = (t) => { const d = List().dateOf(t); return d >= WEEK.from && d <= WEEK.to; };
  const link = (label, hook, tip) => R.textLink({ label, attrs: { ...hook, title: tip || null } });
  const count = (label, hook, tip) => link(label, hook, tip);   // a number that opens what it counts (quiet until hovered: stillhet.css)
  const filterHook = (f) => ({ 'data-c-filter': JSON.stringify(f) });
  let menu = '', tasksHost = null, schedHost = null, quietOpen = false;
  let asking = null;   // a card's step that asks first (act.confirm), in a ConfirmStrip at the card it was pressed on (the Projects center: under its head): { does, id, label, f, busy, where }
  let view = { sort: 'most urgent', sSort: 'most urgent' }, figs = { tasks: false, sched: false };
  // One filter per place (list.bar-model): Show, Project and Group by are the bar's Filter, and the page follows it. The
  // page's own line keeps Order and Figures. StillhetRunsList.view() says what is chosen and shown() is the very rows the bar lists.
  const barView = () => { const v = List().view?.(); return v ? { show: v.show, from: v.project || 'all', by: v.by, narrowed: v.narrowed || '' } : { show: 'all', from: List().from(), by: '', narrowed: '' }; };
  const byNow = () => (barView().by === 'workflow' ? 'workflow' : 'project');
  const sView = () => Sch().view?.() || { show: Sch().showing(), from: '', by: '' };
  const centerCard = R.centerCard || R.taskActions.card;
  // Cards never move under the pointer: the order is the one the page had when it was opened (or its Order was picked);
  // a card acted on stays where it was and shows its new state, and the order settles on the next visit.
  const frozen = { tasks: null, sched: null }, acted = new Map(), actedS = new Map();   // acted, actedS: a task, a schedule acted on this visit → the name of the card it stood on
  const settle = (which) => { frozen[which] = null; if (which === 'tasks') { acted.clear(); actedS.clear(); } };
  function hold(which, rows, keyOf) {
    const f = frozen[which]; if (!f) { frozen[which] = rows.map(keyOf); return rows; }
    const at = (r) => { const i = f.indexOf(keyOf(r)); return i < 0 ? f.length : i; };
    const out = [...rows].sort((a, b) => at(a) - at(b));
    for (const r of out) if (!f.includes(keyOf(r))) f.push(keyOf(r));
    return out;
  }
  // the demo's server takes a moment to answer, as a real one does, so a button that waits shows it waits (comp.button-busy)
  const DEMO_WAIT_MS = 450;
  const answered = () => (W.live ? Promise.resolve() : new Promise((ok) => setTimeout(ok, DEMO_WAIT_MS)));
  const BUSY_WORD = { retry: 'Retrying…', resume: 'Resuming…', approve: 'Approving…', merge: 'Merging…', pr: 'Creating PR…', 'fix-checks': 'Starting the fix…', run: 'Starting…', stop: 'Stopping…', pause: 'Resuming…' };

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
  const liveSays = (r) => { const v = W.live ? window.StillhetTaskLive?.detail?.(r.id) : null; if (!v) return ''; const why = (v.why || []).find((x) => /^✗/.test(x)); return v.detail || (why ? why.replace(/^✗\s*/, '') : '') || GIT_SAYS[v.git] || ''; };
  const clause = (r) => R.taskClause({ state: stateOf(r), name: link(r.title, { 'data-c-open': r.id }, `Opens ${r.title}`), detail: liveSays(r) || r.detail || '' });
  // V-TW-01: a button names its task in at most 24 characters, whole words, "…" when cut; its tooltip keeps the full title
  const SHORT = 24;
  const shortOf = (title) => { const s = String(title || '').trim(); if (s.length <= SHORT) return s; let out = ''; for (const w of s.split(/\s+/)) { const next = out ? `${out} ${w}` : w; if (next.length > SHORT) break; out = next; } return `${out || s.slice(0, SHORT - 1)}…`; };
  const actionsOf = (rs, o) => R.taskActions(rs.map((t) => ({ id: t.id, title: t.title, short: t.short || shortOf(t.title), state: stateOf(t) })), o);
  const schedLink = (s) => (advanced() ? link(s.title, { 'data-c-sched': s.id }, `Opens ${s.title}`) : esc(s.title));   // Simple: Schedules is locked, so no links lead there
  // a task's own page (thing-page: a card's title opens its thing, in every mode)
  const openPage = (r) => { if (!W.live) r.unread = false; const S = window.StillhetShell; if (S.openTaskPage) S.openTaskPage(r.case, '', r.title, r.opens || r.id); else S.go(`run/${r.opens || r.id}`); };

  // ---- the Tasks center ----
  const inFrom = (project) => { const f = barView().from || 'all'; return f === 'all' || (project || 'No project') === f; };   // the list's "from": the page shows the same project
  const fromRows = () => (List().shown ? List().shown().filter((t) => !t.archived) : List().rows().filter((t) => inFrom(t.project)));
  function groups() {
    const rows = fromRows(), key = (t) => (byNow() === 'workflow' ? t.workflow || 'Default' : t.project || 'No project');
    const map = new Map();
    const of = (k) => { if (!map.has(k)) map.set(k, { name: k, rows: [], missed: [], live: [] }); return map.get(k); };
    rows.forEach((t) => of(key(t)).rows.push(t));
    for (const s of Sch().all()) {
      if (!inFrom(s.project)) continue;
      const k = byNow() === 'workflow' ? s.workflow || 'Default' : s.project || 'No project';
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
  const groupFilter = (g, more = {}) => ({ ...(byNow() === 'workflow' ? { workflow: g.name } : { project: g.name }), ...more });
  function factsOf(g) {
    const parts = [[g.running.length, 'running', { show: 'running' }], [g.waiting.length, 'waiting', { show: 'waiting' }]];
    if (g.recent.length) parts.push([g.recent.length, g.recent.every((t) => t.word === 'Merged') ? 'merged' : 'finished', { show: 'finished', range: WEEK }]);
    const nums = parts.filter(([n]) => n).map(([n, w, f]) => [`${n} ${w}`, f]);
    if (g.cost > 0) nums.push([`${usd(g.cost)} this week`, { range: WEEK }]);
    return { html: nums.map(([t, f]) => count(t, filterHook(groupFilter(g, f)), `Opens the ${t} in Tasks`)).join(' · '), tip: nums.map(([t]) => t).join(' · ') };
  }
  // the task a card is about: the most urgent one that waits on you, else the one that runs
  const topOf = (g) => g.held || (g.needs[0] && taskOf(g.needs[0])) || null;
  // of the tasks that run, the one the card already stood for keeps it (a new one never takes a card over)
  const leadOf = (g) => { const top = topOf(g); if (top) return top; const runs = g.running.map(taskOf).filter(Boolean); return runs.find((t) => frozen.tasks?.includes(`t:${t.id}`)) || runs[0] || null; };
  const schedOf = (g) => g.heldS || (leadOf(g) ? null : g.missed[0] || g.live[0] || null);
  const keyOfCard = (g) => { const t = leadOf(g), sc = schedOf(g); return t ? `t:${t.id}` : sc ? `s:${sc.id}` : `g:${g.name}`; };
  const runNowBtn = (s2) => R.button({ label: 'Run now', attrs: { 'data-c-sact': `run|${s2.id}`, 'aria-label': `Run now: ${s2.title}`, title: `Runs ${s2.title} now to catch up` } });
  const openBtn = (r) => R.button({ label: 'Open', attrs: { 'data-c-open': r.id, title: `Opens ${r.title}` } });
  function actionOf(g) {
    if (g.held) return openBtn(g.held);
    if (g.heldS) { const run = Sch().runningRun(g.heldS), t = run?.wid && W.find(run.wid); return t ? openBtn(t) : ''; }
    if (g.needs.length) return actionsOf([taskOf(g.needs[0])].filter(Boolean));   // the card's one action (panel.card-opens)
    if (g.missed.length) return runNowBtn(g.missed[0]);
    const lead = leadOf(g);
    return lead ? openBtn(lead) : '';
  }
  // One card per thing that needs you (panel.card-opens): each task that waits and each missed time has its own card, with
  // its one action; what runs in a project shares one card. The bar's Show narrows the cards as it narrows the list.
  function partsOf(g) {
    const only = (o) => ({ ...g, needs: [], missed: [], live: [], running: [], one: true, ...o }), show = barView().show;
    const needs = [...g.needs.map((t) => only({ needs: [t] })), ...(['all', 'needs'].includes(show) ? g.missed.map((x) => only({ missed: [x] })) : [])];   // the rows are the bar's own (shown()); a missed time is a schedule, listed under All and Needs you
    const liveS = ['all', 'running'].includes(show) ? g.live : [];
    const runs = g.running.length || liveS.length ? [only({ running: g.running, live: liveS, one: false })] : [];
    return [...needs, ...runs];
  }
  // what the card's own task says, under its title: why it stands where it does. The state word is the card's first word
  // already, so it is never said again here.
  const saysOf = (r) => { const t = liveSays(r) || r.detail || '', w = R.runState(stateOf(r)).word; const lead = [w, R.needsReason(stateOf(r))].find((x) => x && (t === x || t.startsWith(`${x} · `))); return lead ? t.slice(lead.length).replace(/^ · /, '') : t; };
  // a single task's own facts: when, and what it has cost
  const ownFacts = (r) => [r.time && r.time !== 'now' ? r.time : '', r.cost > 0 ? usd(r.cost) : ''].filter(Boolean).join(' · ');
  function cardOf(g) {
    const top = topOf(g), lead = leadOf(g), sch = schedOf(g), st = top ? R.runState(stateOf(top)) : null;
    const word = g.heldS ? Sch().wordOf(g.heldS.id) : g.held ? st.word : top ? R.needsReason(stateOf(top)) : g.missed.length ? 'Missed' : g.running.length || g.live.length ? R.runState('working').word : 'Quiet';
    const tone = g.heldS ? (Sch().running(g.heldS.id) ? 'run' : 'idle') : top ? R.markTone(st) : g.missed.length ? 'act' : g.running.length || g.live.length ? 'run' : 'idle';
    const others = lead ? [] : g.live.filter((x) => x !== sch).map((x) => `${schedLink(x)} is running`);   // a running task leads: its schedule is not said twice
    const first = lead ? esc(saysOf(lead)) : g.heldS ? esc(Sch().running(sch.id) ? 'Its task is running' : cap1(Sch().nextOf(sch.id) || '')) : sch ? (g.missed.includes(sch) ? `Missed ${esc(sch.missed)} · ${esc(sch.missedWhy || '')}` : 'Its task is running') : 'Nothing is going on here.';
    const facts = factsOf(g);
    const kind = lead ? 'task' : sch ? 'schedule' : byNow() === 'workflow' ? 'workflow' : 'project';   // the mark says how it stands (list.kind-mark)
    const title = lead ? lead.title : sch ? sch.title : g.name;
    const titleHtml = lead ? link(lead.title, { 'data-c-open': lead.id }, `Opens ${lead.title}`) : sch ? schedLink(sch) : link(g.name, filterHook(groupFilter(g)), `Shows only ${g.name}'s tasks in the list`);
    // the whole card opens its thing; the project in its kicker narrows the place to it (panel.center-narrow)
    const opens = lead ? { 'data-c-go': `t:${lead.id}` } : sch && advanced() ? { 'data-c-go': `s:${sch.id}` } : null;
    const narrows = (lead || sch) && !(byNow() === 'project' && barView().from !== 'all' && barView().from) ? { name: g.name, attrs: { ...filterHook(groupFilter(g)), title: `Shows only ${g.name}'s tasks` } } : null;
    const own = g.one && lead ? ownFacts(lead) : '';
    // a step that asks first asks here, at its own card (act.confirm): the strip takes the place of the buttons it came from
    const mine = asking && asking.where === 'tasks' && (g.held ? g.held.id === asking.id : g.needs.some((t) => taskOf(t)?.id === asking.id));
    return centerCard({ mark: R.kindMark({ kind, tone, advisory: tone === 'ok', breathe: !g.held && !!(top || g.missed.length) }), word, project: narrows, kicker: !narrows && (lead || sch) ? `· ${g.name}` : '', opens, tone, title, titleHtml,
      whatHtml: [first, ...others].filter(Boolean).slice(0, 2).join('<br>'), action: mine ? stripOf(asking) : actionOf(g), ...(g.one ? { facts: own } : { factsHtml: facts.html, factsTip: facts.tip }), attrs: { 'data-c-key': keyOfCard(g) } });
  }
  const cap1 = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  const part = (id, label, text, items, tip) => ({ id, label, text, tip, items: items.map((v) => (typeof v === 'object' ? v : { id: v, text: cap1(v), checked: v === text })) });
  // a center's filters (list.filters): FilterRow's one compact line, each picker with its label inside it; at its end
  // Figures, a small toggle button with its pressed state, and the one quiet way to Chat for new work
  const filters = (parts, which, facts) => `${R.filterRow({ parts: parts.map((x) => ({ raw: x.id === 'c-from' || x.id === 'c-sfrom', ...x })), open: menu, end: `${R.button({ label: 'Figures', kind: 'quiet', cls: 'cf-figs', attrs: { 'data-c-figs': which, 'aria-pressed': String(figs[which]), title: figs[which] ? 'Hides the counts and costs' : 'Shows the counts and costs' } })}` })}${figs[which] ? R.figuresLine(facts) : ''}`;
  // The centers are for looking at work and answering it; new work starts in Chat. The head's one quiet way there:
  const startBtn = (which) => R.button({ kind: 'quiet', label: 'Start one in Chat', attrs: { 'data-c-start': which, title: which === 'task' ? 'Opens Chat, ready for a new task' : 'Opens Chat, ready for a new schedule' } });
  function tasksHtml() {
    // the list's own first-load looks (D15): never "No tasks yet." while the first load is out
    const ls = window.StillhetDemoState?.list || '';
    if (ls === 'loading' || ls === 'failed') return wrap(`${R.placeHead({ title: 'Tasks', facts: 'New work starts in Chat' })}${R.listState({ state: ls, noun: 'tasks', retry: ls === 'failed' ? { 'data-c-retry': '', 'data-key': 'c-retry' } : null })}`);
    const rows = fromRows(), all = groups().sort(SORTS[view.sort]);
    if (!List().rows().length) return wrap(`${R.placeHead({ title: 'Tasks', facts: 'New work starts in Chat' })}${R.emptyState({ title: 'No tasks yet.', actions: startBtn('task') })}`);
    // F-3-10: live, the API's week (every project, or the chosen one's row), nothing while it is read; demo, the per-run sum
    const week = W.live ? (() => { const f = List().from(), t = window.StillhetInsightsLive?.weekTotals?.(f === 'all' ? null : f); return t ? { n: t.runs, cost: t.spentUsd } : null; })() : weekOf(rows);
    const live = all.filter((g) => !g.quiet).flatMap(partsOf).sort(SORTS[view.sort]), quiet = all.filter((g) => g.quiet);
    // a task acted on here that left every card (merged, retried) keeps its card where it was, in its new state
    if (asking && !W.find(asking.id)) asking = null;
    const held = [...acted].map(([id, name]) => ({ id, name, r: W.find(id) })).filter((x) => x.r && !live.some((g) => leadOf(g)?.id === x.id))
      .map((x) => ({ name: x.name, held: x.r, rows: [], needs: [], missed: [], live: [], running: [], waiting: [], recent: [], cost: 0 }));
    const blankG = { rows: [], needs: [], missed: [], live: [], running: [], waiting: [], recent: [], cost: 0 };
    const heldS = [...actedS].map(([id, name]) => ({ name, s2: Sch().find(id) })).filter((x) => x.s2 && !live.some((g) => schedOf(g)?.id === x.s2.id)).map((x) => ({ ...blankG, name: x.name, heldS: x.s2 }));
    const shown = hold('tasks', [...live, ...held, ...heldS], keyOfCard);
    // the count opens the chosen project's week; live, the list can hold fewer than the API counted, and the tip says so
    const f = List().from(), wk = filterHook({ range: WEEK, ...(f === 'all' ? {} : { project: f }) }), wTip = W.live ? 'Opens this week\'s tasks in the list. The figure counts every task Worca recorded this week, so the two can differ' : 'Opens this week\'s tasks';
    const facts = week ? `${count(`${plural(week.n, 'task')} this week`, wk, wTip)}${week.cost > 0 ? ` · ${count(`${usd(week.cost)} this week`, wk, wTip)}` : ''}` : '';
    // the page's line: Order and Figures. Which tasks, which project and the grouping are the bar's Filter (one filter per place)
    const bar = filters([part('c-sort', 'Order', view.sort, Object.keys(SORTS), 'How the cards are ordered')], 'tasks', facts);
    const narrowed = f !== 'all' || barView().narrowed ? R.narrowedLine({ to: barView().narrowed || f, clear: { 'data-c-clear': 'tasks', title: 'Shows every project again' } }) : '';
    const calm = barView().show === 'all' && !barView().narrowed && !all.some((g) => g.needs.length || g.missed.length);
    const nothing = !shown.length && !quiet.length ? R.emptyState({ title: 'No tasks in this view.' }) : '';
    const noun = byNow() === 'workflow' ? 'workflow' : 'project';
    const quietFacts = (() => { return quiet.map((g) => g.name).join(', '); })();
    const quietRow = quiet.length ? `${R.quietLine({ n: quiet.length, noun, names: quietFacts, open: quietOpen, hook: { 'data-c-quiet': '' } })}${quietOpen ? `<div class="pg-grid">${quiet.map(cardOf).join('')}</div>` : ''}` : '';
    return wrap(`${R.placeHead({ title: 'Tasks', say: calm ? 'Nothing needs you' : '', actions: startBtn('task') })}${bar}${narrowed}${nothing}<div class="pg-grid">${shown.map(cardOf).join('')}</div>${quietRow}`);
  }
  const wrap = (body) => `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center">${body}</div></div></div>`;
  const stripOf = (a) => R.confirmStrip({ ...R.confirmOf(a.f, a.label), busy: a.busy ? R.workingWord(a.label) : '', id: 'c-confirm-t', attrs: { 'data-c-ask': '' } });
  // the center a card was pressed in: the Tasks center, or the Projects center (its home draws the same cards, projects.js)
  const placeEl = () => document.getElementById('route-place');
  const whereNow = () => (tasksHost && !tasksHost.hidden && location.hash.startsWith('#runs') ? 'tasks' : placeEl() && !placeEl().hidden && /^#projects\/?$/.test(location.hash) ? 'place' : '');
  const hostOf = (where) => (where === 'place' ? placeEl() : tasksHost);
  function startAsk(a) { asking = { ...a, where: whereNow() || 'tasks' }; paint(); hostOf(asking.where)?.querySelector('[data-c-ask] [data-confirm="yes"]')?.focus({ preventScroll: true }); }
  // a card's button while its action is out: busy, with a present-tense label (comp.button-busy)
  const press = (el, label, work) => { if (el && el.isConnected && !el.disabled) return R.busy(el, { label, until: work() }); return work(); };

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
    if (!week.length && sec === 'paused') return R.runOutcomes({ runs: [], says: 'No tasks in 7 days' });
    if (!week.length) return R.runOutcomes({ runs: [], says: s.started === Sch().dateWord(Sch().TODAY) ? `Started ${esc(s.started)} · no tasks yet` : 'No tasks in 7 days' });
    const num = done.length ? count(failed ? `${won} of ${done.length}` : `${won} of ${done.length} succeeded`, filterHook({ schedule: s.id, show: 'finished' }), `Opens the ${won} that succeeded in Tasks`) : '';
    const pre = s.started === 'Nov 9' || week.length < 7 ? `Started ${esc(s.started)}${num ? ' · ' : ''}` : '';
    const fixed = failed && done.at(-1) !== failed && OUT(done.at(-1)) === 'ok';   // a past failure a later run fixed (look.alert-ladder)
    const fail = failed ? ` · ${link(`failed ${failed.date}${fixed ? '' : ` at ${stepOf(failed.meta).replace(/^Failed at /, '')}`}`, { 'data-c-srun': `${s.id}|${s.runs.indexOf(failed)}` }, 'Opens that task')}${fixed ? ' · next task passed' : ''}` : '';
    const pr = !failed && done[0] && /#\d+/.exec(done.at(-1)?.meta || '');
    return R.runOutcomes({ runs: week.map(OUT), says: `${pre}${num}${fail}${pr ? ` · merged ${pr[0]}` : ''}${week.length !== done.length ? ` · last ${week.length} tasks` : ''}` });
  }
  const flowWord = (w) => `${w && w !== 'Default' ? w : 'Default'} workflow`;
  function schedCard(s) {
    // its word and why are the schedule's own (StillhetSchedules.wordOf / nextOf): the same on its page, its row and its chat card
    const sec = sectionNow(s), word = Sch().wordOf(s.id), next = Sch().nextOf(s.id);
    const project = s.project || 'No project', tone = sec === 'needs' ? 'act' : sec === 'running' ? 'run' : 'idle';
    // its kicker: the state word, its project (a link that narrows Schedules to it) and when it runs next; a missed one says when and why in the line under its title
    const kicker = sec === 'needs' ? '' : next, what = sec === 'needs' ? `Missed ${s.missed}, ${s.at} · ${s.missedWhy}` : s.what || R.scheduleWords(s).says;
    const fact = `${R.REPEATS.includes(s.every) ? R.scheduleWords(s).says : s.every}${s.tz && s.tz !== homeTz() ? ` ${s.tz}` : ''} · ${flowWord(s.workflow)}${s.preset ? ` · ${s.preset === 'preset deleted' ? s.preset : `from ${s.preset}`}` : ''}`;   // when it runs and its workflow
    const narrowed = sView().from === project;
    // Run now, Stop and Resume are one kind of button: bordered, never filled, so the row of cards reads evenly
    const act = sec === 'ended' ? null : sec === 'running' ? ['Stop', 'stop'] : sec === 'paused' ? ['Resume', 'pause'] : ['Run now', 'run'];   // an ended one runs no more
    return centerCard({ mark: R.kindMark({ kind: 'schedule', tone: sec === 'needs' ? 'act' : sec === 'paused' ? 'pause' : sec === 'running' ? 'run' : 'idle', breathe: sec === 'needs' }), word, kicker: narrowed ? `· ${[project, kicker].filter(Boolean).join(' · ')}` : kicker, project: narrowed ? null : { name: project, attrs: { 'data-c-snarrow': project, title: `Shows only ${project}'s schedules` } }, opens: { 'data-c-go': `s:${s.id}` }, tone, title: s.title, titleHtml: link(s.title, { 'data-c-sched': s.id }, `Opens ${s.title}`), what, line: schedLine(s), facts: fact, action: act ? R.button({ label: act[0], attrs: { 'data-c-sact': `${act[1]}|${s.id}`, 'aria-label': `${act[0]}: ${s.title}`, title: `${act[0]}: ${s.title}` } }) : '', attrs: { 'data-c-card': s.id, 'data-c-key': `s:${s.id}`, title: s.cost ? `${usd(s.cost)} a task` : null } });
  }
  function schedulesHtml() {
    // which schedules: the bar's Filter (Show, Project), so bar and page show the same ones (one filter per place)
    const v = sView(), shows = Sch().shows || ((s, show) => show === 'all' || s.state === 'paused');
    const all = Sch().all(), sorted = all.filter((s) => (!v.from || (s.project || 'No project') === v.from) && shows(s, v.show)).sort(SCHED_SORTS[view.sSort]);
    if (!all.length) return wrap(`${R.placeHead({ title: 'Schedules', facts: 'New work starts in Chat' })}${R.emptyState({ title: 'No schedules yet.', actions: startBtn('schedule') })}`);
    const list = hold('sched', sorted, (s) => s.id);
    const runs = all.flatMap((s) => s.runs.filter((r) => r.case !== 'stopped').slice(0, 7)).filter((r) => OUT(r) !== 'run'), won = runs.filter((r) => OUT(r) === 'ok').length;
    const facts = [esc(plural(all.length, 'schedule')), runs.length ? count(`${won} of ${runs.length} runs succeeded in 7 days`, filterHook({ schedule: 'any', show: 'finished' }), 'Opens the runs that succeeded in Tasks') : '', `times in ${DEFAULT_TZ}${all.some((s) => s.tz && s.tz !== DEFAULT_TZ) ? ', unless a card says' : ''}`].filter(Boolean).join(' · ');
    const bar = filters([part('c-ssort', 'Order', view.sSort, Object.keys(SCHED_SORTS), 'How the cards are ordered')], 'sched', facts);
    const narrowed = v.from ? R.narrowedLine({ to: v.from, clear: { 'data-c-clear': 'sched', title: 'Shows every project again' } }) : '';
    const none = { paused: 'No paused schedules here.', once: 'No one-off schedules here.', repeating: 'No repeating schedules here.' }[v.show] || 'No schedules here.';
    return wrap(`${R.placeHead({ title: 'Schedules', actions: startBtn('schedule') })}${bar}${narrowed}${list.length ? `<div class="pg-grid">${list.map(schedCard).join('')}</div>` : R.emptyState({ title: none })}`);
  }

  // ---- paint ----
  const paintTasks = () => { if (tasksHost && !tasksHost.hidden && location.hash.startsWith('#runs')) tasksHost.innerHTML = tasksHtml(); };
  const paintSched = () => { if (schedHost && !schedHost.hidden && /^#schedules/.test(location.hash)) schedHost.innerHTML = schedulesHtml(); };
  const paint = () => { paintTasks(); paintSched(); window.StillhetPlaces?.projects?.redraw?.(); };

  // ---- a card's action, on the thing itself ----
  function act(does, id, label = '', confirmed = false) {
    const r = W.find(id); if (!r) return;
    if (does === 'open') { openPage(r); return; }   // a card's title and its Open open the task's own page (thing-page)
    if (does === 'answer') { if (!W.live) r.unread = false; window.StillhetShell.openRun(`run/${r.case}`, r.title, r.opens || r.id); return; }   // a question is answered where you talk: its card in its chat
    if (whereNow() === 'tasks') acted.set(id, cardNameOf(r));   // its card stays where it is
    if (W.live) return liveAct(does, r);   // Tasks D17: dev's route through StillhetTaskLive; the store moves only when dev's frames say so
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
  const cardNameOf = (r) => { const t = List().rows().find((x) => taskOf(x)?.id === r.id || x.id === r.id); return byNow() === 'workflow' ? t?.workflow || r.workflow || 'Default' : r.project || t?.project || 'No project'; };
  // The live kind (Tasks, Step 8): a card's action is the same StillhetTaskLive id the task page runs; nothing moves here before
  // its route answers ok, and a refusal is the shell's one `Could not ACTION: REASON`.
  const LIVE_LABEL = { retry: 'Retry', resume: 'Resume', approve: 'Approve and build', merge: 'Merge PR', pr: 'Create PR', 'fix-checks': 'Fix checks' };
  const LIVE_SAY = { retry: (t) => `Retrying ${t}`, resume: (t) => `Resumed ${t}`, approve: (t) => `Approved ${t}`, merge: (t) => `Merged ${t}`, pr: (t) => `Created a PR for ${t}`, 'fix-checks': (t) => `A short task is fixing ${t}\u2019s checks` };
  // A step the task page confirms first (its state's flow in the library's table: Merge PR, Fix checks) asks here too, in
  // the same words, filled with the task's own PR, base and failing count (run-page-model.js liveFacts).
  // Resume past a used-up budget asks first, at the button (act.confirm): the budget is the one StillhetWorld holds
  const usd0 = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  const budgetNow = () => { const b = W.budget?.('yours'); if (b) return { limit: b.usd, spent: b.spent }; return W.facts?.().budget || null; };
  function budgetAsk(does, r) {
    if (does !== 'resume' || stateOf(r) !== 'paused-budget') return null;
    const b = budgetNow(); if (!b || !Number.isFinite(b.limit)) return null;
    const over = Math.max(0, (b.spent || 0) - b.limit);
    return { does, id: r.id, label: 'Resume', busy: false, f: { confirm: `Resume past the ${usd0(b.limit)} budget? ${over > 0 ? `${usd0(over)} over so far` : `All ${usd0(b.limit)} of it is spent`}` } };
  }
  function demoAsk(does, r) {
    const past = budgetAsk(does, r); if (past) return past;
    const label = LIVE_LABEL[does], f = label ? RM.flow[r.case]?.[label] : null;
    return f && f.confirm ? { does, id: r.id, label, f, busy: false } : null;
  }
  function liveAsk(does, r) {
    const past = budgetAsk(does, r); if (past) return past;
    const v = window.StillhetTaskLive?.detail?.(r.id), label = LIVE_LABEL[does];
    // the base: the page's (once its detail is in), else the PR's own from its checks entry
    const f = v ? R.actionFlow(stateOf(r), RM.liveFacts({ ...v, base: v.base || window.StillhetTaskLive.checks?.(r.id)?.base || '' }))[label] : null;
    return f && f.confirm ? { does, id: r.id, label, f, busy: false } : null;
  }
  function liveAct(does, r, confirmed = false) {
    const T = window.StillhetTaskLive;
    if (!T || !LIVE_LABEL[does]) return;
    const asks = !confirmed && liveAsk(does, r);   // the live kind never merges unasked
    if (asks) { startAsk(asks); return; }
    const was = confirmed ? asking : null;
    if (was) { was.busy = true; paint(); }
    return Promise.resolve(T.flow(LIVE_LABEL[does], { taskId: r.id, pr: r.pr, title: r.title })).then((res) => {
      if (was && asking === was) { asking = null; paint(); hostOf(was.where)?.querySelector(`[data-c-act="${does}|${r.id}"]`)?.focus({ preventScroll: true }); }   // a refusal is the shell's one line; the card still offers it
      if (res && res.ok) say(res.say || LIVE_SAY[does](r.title));
    });
  }
  function answerAsk(yes) {
    const a = asking; if (!a) return;
    if (yes && W.find(a.id)) {
      if (W.live) { liveAct(a.does, W.find(a.id), true); return; }
      // the strip's own button says it is working until the answer is in (act.confirm), then the card shows the new state
      a.busy = true; paint();
      answered().then(() => { if (asking !== a) return; asking = null; if (W.find(a.id)) act(a.does, a.id, '', true); paint(); hostOf(a.where)?.querySelector(`[data-c-key="t:${a.id}"] [data-c-open]`)?.focus({ preventScroll: true }); });
      return;
    }
    asking = null; paint(); hostOf(a.where)?.querySelector(`[data-c-act="${a.does}|${a.id}"]`)?.focus({ preventScroll: true });
  }
  function onClick(e) {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-c-ask] [data-confirm]'))) { if (!hit.disabled) answerAsk(hit.dataset.confirm === 'yes'); return; }
    if ((hit = on('[data-c-retry]'))) { window.StillhetAdapter?.retry?.(); return; }
    if ((hit = on('[data-c-figs]'))) { const w = hit.dataset.cFigs; figs[w] = !figs[w]; paint(); (w === 'sched' ? schedHost : tasksHost)?.querySelector(`[data-c-figs="${w}"]`)?.focus({ preventScroll: true }); return; }
    if ((hit = on('[data-narrow-clear][data-c-clear]'))) { if (hit.dataset.cClear === 'sched') Sch().narrow?.(''); else List().filter({}); return; }
    if ((hit = on('[data-c-snarrow]'))) { settle('sched'); Sch().narrow?.(hit.dataset.cSnarrow); schedHost?.querySelector('[data-narrow-clear]')?.focus({ preventScroll: true }); return; }   // a schedule card's project narrows Schedules to it, bar and page
    if ((hit = on('[data-c-filter]'))) { List().filter(JSON.parse(hit.dataset.cFilter)); return; }
    if ((hit = on('[data-c-open]'))) { act('open', hit.dataset.cOpen); return; }
    if ((hit = on('[data-c-act]'))) {
      const [d, id] = hit.dataset.cAct.split('|'), r = W.find(id); if (!r || hit.disabled) return;
      // a step that asks first asks at once, at its card; every other step waits on the server, and its button says so
      const asks = W.live ? !!liveAsk(d, r) : !!(whereNow() && demoAsk(d, r));
      if (asks) { act(d, id, hit.textContent); return; }
      press(hit, BUSY_WORD[d] || R.workingWord(LIVE_LABEL[d] || ''), () => (W.live ? Promise.resolve(act(d, id, hit.textContent)) : answered().then(() => act(d, id, hit.textContent))));
      return;
    }
    if ((hit = on('[data-c-sact]'))) {
      const [d, id] = hit.dataset.cSact.split('|'), s0 = Sch().find(id); if (hit.disabled) return;
      if (s0 && whereNow() === 'tasks') actedS.set(id, byNow() === 'workflow' ? s0.workflow || 'Default' : s0.project || 'No project');   // its card stays where it is
      press(hit, d === 'pause' && s0?.state !== 'paused' ? 'Pausing…' : BUSY_WORD[d] || 'Working…', () => answered().then(() => { Sch().act(id, d); paint(); }));
      return;
    }
    if ((hit = on('[data-c-sched]'))) { window.StillhetShell.go(`schedule/${hit.dataset.cSched}`); return; }   // a schedule's title opens its own page (thing-page)
    if ((hit = on('[data-c-srun]'))) { const [id, i] = hit.dataset.cSrun.split('|'), s = Sch().find(id); Sch().openRun(s, s.runs[+i]); return; }
    if ((hit = on('[data-c-start]'))) { ask(hit.dataset.cStart); return; }   // Chat, with its composer ready for a task or a schedule
    if (on('[data-c-quiet]')) { quietOpen = !quietOpen; paint(); return; }
    if ((hit = on('[data-pick^="c-"]'))) {
      const [id, ...rest] = hit.dataset.pick.split('|'), v = rest.join('|'); menu = '';
      settle(id === 'c-ssort' ? 'sched' : 'tasks');   // a new order is asked for: the cards may move now
      if (id === 'c-sort') view.sort = v; if (id === 'c-ssort') view.sSort = v;
      paint(); backTo(id); return;
    }
    if ((hit = on('[data-menu^="c-"]'))) { const id = hit.dataset.menu; menu = menu === id ? '' : id; paint(); backTo(id); return; }
    // the whole card opens its thing (panel.card-opens): a click that landed on no control of its own
    if ((hit = on('[data-c-go]')) && !on('button, a, input, select, textarea, label, [role="alertdialog"]') && !String(window.getSelection?.() || '')) {
      const [k, ...rest] = hit.dataset.cGo.split(':'), id = rest.join(':');
      if (k === 't') act('open', id); else window.StillhetShell.go(`schedule/${id}`);
    }
  }
  const backTo = (id) => document.querySelector(`#route-runs [data-menu="${id}"], #route-schedule [data-menu="${id}"]`)?.focus({ preventScroll: true });   // the picker keeps the focus over a redraw
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    document.getElementById('route-runs').addEventListener('click', onClick);
    for (const [el, where] of [['route-runs', 'tasks'], ['route-place', 'place']]) document.getElementById(el).addEventListener('keydown', (e) => { if (e.key === 'Escape' && asking?.where === where && !asking.busy) { e.stopPropagation(); answerAsk(false); } });   // Esc is the strip's safe side
    for (const el of ['route-runs', 'route-schedule']) document.getElementById(el).addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu && !form) { e.stopPropagation(); const m = menu; menu = ''; paint(); backTo(m); } });   // Esc closes an open picker, back on its button
    document.getElementById('route-schedule').addEventListener('click', onClick);
    document.getElementById('route-place').addEventListener('click', (e) => { if (e.target.closest('[data-c-filter], [data-c-open], [data-c-act], [data-c-sact], [data-c-sched], [data-c-ask], [data-c-go]')) onClick(e); });   // the Projects center's cards act the same way
    W.onMove(paint); W.onChange(paint); R.prefs.onChange(paint);
    R.dismissOnOutside(document, { open: () => !!menu && !form, inside: '#route-runs .pz-pick, #route-schedule .fr .pz-pick', back: () => null, close: () => { menu = ''; }, paint });
  }

  // ---- the labelled forms, opened from Chat (form.dialog, form.check-at-save) ----
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
  // dev has no auto-merge at start, so the live form draws no 'merge when checks pass' (plans/stillhet/stillhet-wiring.md).
  const LIVE_AGENT = 'the project\'s default';
  const LIVE_SETUP = 'as the project is set up';
  const LIVE_THEN = { 'open a PR': 'ready', 'leave it on the branch': 'none' };
  const LIVE_SOURCE = { 'the latest version from origin': true, 'my local copy': false };
  const capUsd = (t) => { const m = /\$(\d+(?:\.\d+)?)/.exec(t); return m ? parseFloat(m[1]) : null; };
  const engines = () => window.StillhetTaskLive?.engines?.() || [];
  function loadBranches() {
    if (!W.live || !form || liveBranches.project === form.project) return;
    const project = form.project; liveBranches = { project, list: [] };
    window.StillhetTaskLive?.branches?.(window.StillhetTaskLive.projectDirOf(project) || '').then((list) => {
      if (liveBranches.project !== project || !list) return;
      liveBranches = { project, list }; if (form) paintForm();
    });
  }
  const flows = () => (W.live ? liveFlows || [{ id: '', title: 'Default', steps: [], agents: [] }] : [AUTO_FLOW, ...window.StillhetPlaces.workflows.names(), ...(window.StillhetPlaces.workflows.names().some((w) => isShaper(w.title)) ? [] : [SHAPER_FLOW])]);   // Auto leads the list in both kinds (COV-2 humanInLoop); the demo's list holds Shaper as dev's does
  let liveModels = [];
  function loadFlows() {
    if (!W.live) return;
    if (!liveFlows) window.StillhetChatLive?.catalog('workflows').then((r) => { if (!r?.ok) return; liveFlows = (r.data?.workflows || []).map((x) => ({ id: x.id, title: x.name || x.id, steps: [], auto: x.auto === true || x.id === 'wf_auto', agents: (Array.isArray(x.nodes) ? x.nodes : []).filter((n) => n && n.kind === 'agent' && n.id).map((n) => n.id) })); if (!liveFlows.some((x) => x.id === 'wf_auto')) liveFlows.unshift(AUTO_FLOW); if (form) { applyActiveFlow(); paintForm(); } });
    if (!liveModels.length) window.StillhetChatLive?.catalog('models').then((r) => { if (!r?.ok) return; liveModels = (r.data?.models || []).filter((m) => m && m.id).map((m) => ({ id: m.id, label: m.label || m.id, engine: m.engine || 'claude' })); if (form) paintForm(); });
  }
  // F-cov23-03: Auto is classic's client-side constant (app.js AUTO_WORKFLOW): /api/workflows never lists it, its picker leads with it
  const AUTO_FLOW = Object.freeze({ id: 'wf_auto', title: 'Auto', steps: [], auto: true, agents: [] });
  const SHAPER_FLOW = Object.freeze({ id: 'wf_shape', title: 'Shaper', steps: ['Clarify', 'Plan', 'Build', 'Review'], agents: [] });
  const isShaper = (title) => /shap(e|er)\b/i.test(String(title || ''));   // dev's wf_shape family builds a feature in slices
  const AGENTS_OWN = 'the workflow\'s own';
  // the picked workflow (an unpicked Default is dev's wf_default) and the models its agents can each run, as `LABEL for every step`
  const liveFlow = () => flows().find((x) => x.title === form.workflow && x.id) || (liveFlows || []).find((x) => x.id === 'wf_default') || null;
  function liveAgentPicks() {
    const w = liveFlow(); if (!w || w.auto || !w.agents.length) return [];
    const engine = engines().find((e) => e.label === form.agent)?.id || 'claude';
    return liveModels.filter((m) => m.engine === engine).map((m) => ({ text: `${m.label} for every step`, model: m.id }));
  }
  // ---- New task's run options (COV-2; docs/stillhet/forms.md form.run-options) ----
  // Every read and write is StillhetRunOptionsLive's (dev's routes, live/run-options-live.mjs); its words are StillhetRunOptions'
  // (the same module's helpers). The demo answers the same calls with sample data in dev's shapes, so one path draws both.
  const RO = () => window.StillhetRunOptions || null;
  const DEMO_PRESETS = [
    { id: 'rp_bugfix', name: 'Bug fix', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_fix', engine: 'claude', syncBeforeStart: true, tags: ['bugfix'] } },
    { id: 'rp_docs', name: 'Docs pass', scope: { kind: 'project', ref: 'worca-cc' }, setup: { workflowId: 'wf_docs', engine: 'codex', sourceBranch: 'dev', guardrailsId: 'strict' } },
    { id: 'rp_billing', name: 'Billing slice', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_feature', engine: 'claude', guardrailsId: 'billing-ci' } },
    { id: 'rp_copilot', name: 'Copilot review', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_full', engine: 'copilot' } },   // pins the locked engine (COV-2 engine check)
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
    // what this adapter can feed that the live one cannot yet: a field with no source is not drawn (lessons 1)
    offers: { workspaces: true, addProject: true, afterBranch: true, intoBranch: true, autoMerge: true, mock: true, notify: true },
    guards: ['Team default', 'Strict', 'Read only'],   // TaskProposal's list (chat/conversation.js)
    locks: { Copilot: 'Copilot: off while the credential broker is on' },   // classic engine-locks.mjs words
    policyNotes: () => ok({ policy: { home: 'acme/worca-policy', caps: { pipeline: { kind: 'hard', value: 20 } } }, notes: [{ level: 'warn', text: 'Guardrails Normal rank below the team minimum (Strict). The task proceeds and is recorded as off-policy.' }] }),
  };
  const OPT = () => (!RO() ? null : W.live ? window.StillhetRunOptionsLive || null : DEMO_OPT);
  const offers = (k) => !!OPT()?.offers?.[k];
  const GUARDS = () => OPT()?.guards || [];
  const LOCKS = () => OPT()?.locks || {};
  let presetList = null, sourceList = null;   // per form open: dev's presets and plugin task sources (null: not read, or refused)
  const dirOf = (project = form.project) => (project === 'No project' ? '' : W.live ? window.StillhetTaskLive?.projectDirOf(project) || '' : `/demo/${project}`);
  // The engine list is the eight engines Settings › Models knows (its ENGINES, in its order and by its names). One that is
  // not set up is listed and off, and says where to set it up; the demo's set-up ones are those with a sign-in that is signed in.
  const ALL_ENGINES = () => (window.SettingsModel?.ENGINES || [['claude', 'Claude'], ['codex', 'Codex (beta)'], ['copilot', 'Copilot (beta)'], ['cursor', 'Cursor (beta)'], ['gemini', 'Gemini CLI (beta)'], ['goose', 'Goose (beta)'], ['opencode', 'OpenCode (beta)'], ['qwen', 'Qwen Code (beta)']]).map(([id, label]) => ({ id, label: String(label).replace(' (beta)', '') }));
  const DEMO_SIGN_INS = ['claude', 'codex', 'copilot', 'gemini'], NOT_SET_UP = 'Not set up: Settings › Models';
  const setUp = (id) => (W.live ? engines().some((e) => e.id === id) : DEMO_SIGN_INS.includes(id) && R.prefs.connected(id));
  const engineLabelOf = (id) => (W.live ? engines().find((e) => e.id === id)?.label || '' : ALL_ENGINES().find((e) => e.id === id)?.label || '');
  const engineIdOf = (label) => (W.live ? engines().find((e) => e.label === label)?.id || '' : ALL_ENGINES().find((e) => e.label === label)?.id || String(label || '').toLowerCase());
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
    const pinned = engineLabelOf(pf.engine);
    if (pinned && LOCKS()[pinned]) { f.agent = 'Claude'; said('agentSaid', `${pinned} is off: starts on Claude`); }   // a locked engine is never picked: classic's engine-locks
    else if (pinned) f.agent = pinned;
    const guard = GUARDS().find((g) => g.toLowerCase().replace(/ /g, '-') === pf.carried.guardrailsId); if (guard) f.guard = guard;   // an unknown set: the broken note says so
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
      const pick = form.gate.profiles.length ? F.pick({ id: 'f-gprofile', label: 'Profile', text: form.gatePick || 'Pick one', items: form.gate.profiles.map((p) => ({ id: p, text: p, checked: p === form.gatePick })), open: menu === 'f-gprofile' }) : '';
      return `${R.choiceNote({ text: form.gate.text, ways: form.gate.profiles.length ? [{ label: 'Use this profile', kind: 'primary', attrs: { 'data-c-bind': '' } }] : [] })}${pick}`;
    }
    if (form.conn) return form.conn.fail ? R.choiceNote({ text: form.conn.text, ways: [{ label: 'Open the Marketplace page', kind: 'quiet', attrs: { 'data-c-market': '' } }, { label: 'Test connection', kind: 'primary', attrs: { 'data-c-srctest': '' } }] }) : `<p class="cc-proof">${esc(form.conn.text)}</p>`;
    const own = (s.inputs || []).filter((x) => x && x.key && x.type !== 'task-browser').map((x) => {
      const label = x.label || x.key, v = srcInputs(s)[x.key] || '';
      if (x.type === 'text') return R.field({ id: `cc-in-${x.key}`, label, value: v, attrs: { 'data-src-in': x.key } });
      const opts = x.type === 'select' ? (x.options || []).map((o) => (typeof o === 'object' ? { value: String(o.value), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) })) : form.srcOpts?.[x.key];
      const list = Array.isArray(opts) ? opts : [];
      const text = opts === 'loading' ? 'Loading…' : opts === 'failed' ? 'Could not load the choices' : list.find((o) => o.value === v)?.label || v || 'Pick one';
      return F.pick({ id: `si-${x.key}`, label, text, items: list.map((o) => ({ id: o.value, text: o.label, checked: o.value === v })), open: menu === `si-${x.key}` });
    }).join('');
    const rows = (form.tickets || []).map((t) => R.listRow({ title: String(t.title || t.id), meta: Array.isArray(t.labels) ? t.labels.join(', ') : '', check: form.ticket === String(t.id), open: { 'data-c-ticket': String(t.id) }, boxAttrs: { 'data-c-ticket': String(t.id) } })).join('');
    const empty = form.tickets && !form.tickets.length ? `<p class="cc-proof">${form.search ? 'No tasks matched.' : 'Type to search.'}</p>` : '';
    const fail = form.ticketErr ? `<p class="cc-proof">${esc(form.ticketErr)}</p>` : '';
    const prev = form.preview ? R.prose({ text: `${form.preview.title}\n\n${form.preview.body}` }) : '';
    return `${own}${R.field({ id: 'cc-search', label: `Search ${name}`, error: errOf('#cc-search'), value: form.search, placeholder: `Search ${name}…`, attrs: { 'data-f': 'search' } })}${rows ? `<div class="cc-tickets">${rows}</div>` : ''}${empty}${fail}${prev}`;
  }
  // set.spend-word: a cap is never called soft or hard, and the pipeline's cap is "the task's cost cap" in words a person reads
  const capWords = (t) => String(t).replace(/\s*\((?:hard|soft)\)/gi, '').replace(/\bpipeline cap (\$[\d.,]+)/gi, 'the task\'s cost cap is $1').replace(/^Team caps?:\s*the/i, 'The');
  // the one note under the text (form.run-options): the newest refusal, else the broken preset, else the team policy
  function noteHtml() {
    const n = form.note, busy = form.busy ? { disabled: true } : {};
    if (n?.kind === 'engine') return R.choiceNote({ text: n.error, means: n.overridable ? RO().ENGINE_TICK : '', end: n.overridable ? R.checkbox({ label: RO().ENGINE_ALLOW, checked: !!form.allow, attrs: { 'data-c-allow': '' } }) : '' });
    if (n?.kind === 'sync') return R.choiceNote({ text: n.title, means: n.note || '', rows: n.rows.map((text) => ({ text })), ways: [{ label: 'Cancel', kind: 'quiet', attrs: { 'data-c-sync': 'cancel', ...busy } }, ...(n.primary ? [{ label: n.primary.label, kind: 'primary', attrs: { 'data-c-sync': n.primary.policy, ...busy } }] : [])] });
    if (form.broken?.length) { const b = RO().brokenNoteOf(form.broken); return R.choiceNote({ text: b.title, means: 'Start waits until each item is fixed', rows: b.rows.map((x, i) => ({ text: x.reset ? x.text : `${x.text} · Edit the preset's scope in Settings › Presets`, ...(x.reset ? { way: { label: 'Reset to default', attrs: { 'data-c-preset-reset': String(i) } } } : {}) })) }); }
    const p = form.policy;
    return p ? R.choiceNote({ needsYou: p.tone === 'amber', text: p.head, rows: [...p.rows.map((x) => ({ text: x.text })), ...(p.caps ? [{ text: cap(capWords(p.caps)) }] : [])] }) : '';
  }

  // live: dev's GET /api/projects (the store's projects part, less a Remove's undo window), never task rows (F-a4-06)
  const liveProjects = () => { const gone = window.StillhetProjectsLive?.hidden?.() || new Set(); return (W.part('projects') || []).filter((p) => p.id && !gone.has(p.id)).map((p) => ({ name: p.name || p.id, missing: p.origin === 'missing' })); };
  const projects = () => [...new Set([...(W.live ? liveProjects().map((p) => p.name) : W.rows().map((r) => r.project).filter(Boolean)), 'No project'])];
  // the project used last: the newest task's (a waiting schedule is not used yet) if listed and its folder is there; a missing folder is never preselected
  function defaultProject() {
    if (!W.live) return projects().includes('billing-api') ? 'billing-api' : projects()[0];
    const ok = liveProjects().filter((p) => !p.missing).map((p) => p.name);
    return W.rows().find((r) => !String(r.id).startsWith('sched:') && ok.includes(r.project))?.project ?? ok[0] ?? 'No project';
  }
  // ---- the forms' fields (docs/stillhet/forms.md form.run-options): every field is fed by the adapter, demo or live ----
  const PREVIOUS_BASE = 'the task before it\'s branch', EACH_BASE = 'each project\'s own branch', SAME_BRANCH = 'the same as the source branch';
  const DEMO_HOME = '/Users/you';
  const DEMO_FOLDERS = { [DEMO_HOME]: ['src', 'Documents'], [`${DEMO_HOME}/src`]: ['notes-app', 'billing-api', 'web-app'], [`${DEMO_HOME}/Documents`]: ['drafts'] };
  const demoDirs = (path) => (W.live ? [] : (DEMO_FOLDERS[path] || []).map((name) => ({ name, path: `${path}/${name}` })));
  const spaces = () => (offers('workspaces') && R.shows('advanced') ? window.StillhetSpaces?.list() || [] : []);
  const isSpace = (v) => spaces().some((x) => x.title === v);
  const targetOf = (project) => (project === 'No project' ? 'none' : isSpace(project) ? 'workspace' : 'project');
  function projectItems() {
    const list = projects(), own = list.filter((p) => p !== 'No project');
    if (offers('addProject') && form?.target === 'project' && !own.includes(form.project)) own.push(form.project);   // one added here
    const it = (v) => ({ id: v, text: v, checked: v === form?.project });
    return [...own.map(it), ...(offers('addProject') && R.shows('advanced') ? [{ id: '+add', text: 'Add project…', help: 'Adds a project and picks it' }] : []), it('No project'),
      ...(spaces().length ? [{ sep: true }, { header: 'Workspaces' }, ...spaces().map((x) => ({ ...it(x.title), hint: window.StillhetSpaces.hint(x) }))] : [])];
  }
  const DEMO_BRANCH = 'main';   // the demo projects' default branch
  const baseList = () => { const own = W.live ? [LIVE_BASE, ...liveBranches.list] : form?.target === 'workspace' ? [EACH_BASE] : [DEMO_BRANCH, 'dev']; return offers('afterBranch') && form?.after ? [PREVIOUS_BASE, ...own] : own; };
  function engineItems() {
    const item = (v, off = '') => ({ id: v, text: textOf('agent', v), checked: v === form.agent, ...(off ? { off: true, help: off, hint: off === NOT_SET_UP ? 'Not set up' : '' } : {}) });
    const listed = [...new Set([...LISTS().agent, ...Object.keys(LOCKS())])], ids = W.live ? engines().map((e) => e.id) : [];
    const rest = ALL_ENGINES().filter((e) => !listed.includes(e.label) && !ids.includes(e.id));
    return [...listed.map((v) => item(v, LOCKS()[v] || '')), ...rest.map((e) => item(e.label, NOT_SET_UP))];
  }
  const SLICES = { one: 'one PR for the whole feature', each: 'a PR per slice' };
  const NOTIFY = ['only when a task fails', 'after every task', 'never'];
  const LISTS = () => ({ project: projectItems(), workflow: flows().map((w) => w.title), agent: W.live ? [LIVE_AGENT, ...engines().map((e) => e.label)] : ALL_ENGINES().filter((e) => setUp(e.id) && !LOCKS()[e.label]).map((e) => e.label), base: baseList(), into: [SAME_BRANCH, ...baseList().filter((b) => ![PREVIOUS_BASE, EACH_BASE, LIVE_BASE].includes(b))], guard: GUARDS(), source: W.live ? [LIVE_SETUP, ...Object.keys(LIVE_SOURCE)] : ['the latest version from origin', 'my local copy'], then: W.live ? [LIVE_SETUP, ...Object.keys(LIVE_THEN)] : Object.keys(THEN).filter((t) => offers('autoMerge') || !/^merge/.test(t)), slices: Object.keys(SLICES), every: R.REPEATS.filter((x) => x !== 'every hour'), tz: [...new Set([homeTz(), 'Europe/Sofia', 'UTC', 'Europe/Berlin', 'America/New_York'])], ends: ['no end date', 'after 10 tasks', 'after 30 days'], overlap: ['skip if still going', 'queue if still going'], fails: ['pause after 3 failures', 'pause after 5 failures', 'never pause'], notify: NOTIFY, cap: ['the workflow\'s own', 'at $5', 'at $20'], agents: W.live ? [AGENTS_OWN, ...liveAgentPicks().map((x) => x.text)] : [AGENTS_OWN, 'Sonnet for every step', 'Opus for every step'] });
  const blank = (kind, keep = {}) => { const f = blank0(kind, keep); f.target = targetOf(f.project); if (offers('afterBranch') && f.after) f.base = PREVIOUS_BASE; return f; };   // a task waiting for a run branches off it
  const blank0 = (kind, keep) => ({ kind, project: defaultProject(), workflow: 'Default', agent: W.live ? LIVE_AGENT : 'Claude', base: W.live ? LIVE_BASE : DEMO_BRANCH, into: SAME_BRANCH, source: W.live ? LIVE_SETUP : 'the latest version from origin', then: W.live ? LIVE_SETUP : 'open a PR', text: '', path: '', src: 'write', name: '', more: false, title: '', branch: '', tags: '', files: [], agents: 'the workflow\'s own', cap: 'the workflow\'s own', every: 'every weekday', at: '09:00', date: '', tz: homeTz(), ends: 'no end date', overlap: 'skip if still going', fails: 'pause after 3 failures', notify: NOTIFY[0], err: '', ...OPTS_BLANK(), ...keep });
  // COV-2: what the run options keep while the form is open (form.run-options)
  const OPTS_BLANK = () => ({ agentTouched: false, tagsTouched: false, workflowTouched: false, projectKey: '', defaultsFor: null, defaultEngine: '', activeWf: '', preset: '', presetObj: null, presetBase: null, carried: {}, broken: [], resetDone: [], profile: '', gate: null, gatePick: '', search: '', tickets: null, ticket: '', preview: null, ticketErr: '', note: null, allow: false, policy: null, tagsSaid: '', flowSaid: '', agentSaid: '', guard: GUARDS()[0] || '', target: 'project', view: 'form', add: { name: '', path: '' }, browseAt: '',
    sameAsSource: false, draft: false, slices: 'one', mayAnswer: false, noMemory: false, mock: false });
  // What a choice is called in its field: a "default" always says what it is the default of (form.fields)
  function textOf(k, v) {
    if (k === 'workflow') return v === 'Default' ? 'Default workflow' : v;
    if (k === 'agent') return v === LIVE_AGENT ? 'The project\'s default engine' : v;
    if (k === 'agents') return v === AGENTS_OWN ? 'The workflow\'s own' : v;
    if (k === 'cap') return v === 'the workflow\'s own' ? 'The workflow\'s own cap' : String(v).replace(/^at /, '');
    if (k === 'base') return v === LIVE_BASE ? 'The project\'s default branch' : !W.live && v === DEMO_BRANCH ? `${v} (the project's default branch)` : v === PREVIOUS_BASE || v === EACH_BASE ? cap(v) : v;
    if (k === 'into') return v === SAME_BRANCH ? `The same as the source branch${[PREVIOUS_BASE, EACH_BASE, LIVE_BASE].includes(form.base) ? '' : ` (${form.base})`}` : v;
    if (k === 'slices') return cap(SLICES[v] || v);
    if (k === 'project' || k === 'tz' || k === 'guard') return v;
    return cap(String(v));
  }
  // the library's form parts, by name once the index exports them (field.mjs attaches them to Field until then)
  const F = { pick: R.pickField, pair: R.fieldPair, grid: R.formGrid, fold: R.fieldFold, readback: R.formReadback };
  const itemsOf = (k) => (k === 'agent' ? engineItems() : LISTS()[k].map((v) => (typeof v === 'object' ? v : { id: v, text: textOf(k, v), checked: v === form[k] })));
  const fPick = (k, label, o = {}) => F.pick({ id: `f-${k}`, label, text: textOf(k, form[k]), items: itemsOf(k), open: menu === `f-${k}`, ...o });
  const opt = (k, label, help, o = {}) => R.checkbox({ label, help, checked: !!form[k], ...o, attrs: { 'data-c-opt': k, ...(o.attrs || {}) } });
  const stepsOf = () => { const w = flows().find((x) => x.title === form.workflow), s2 = (w?.steps || []).map((x) => VERB[x] || x.toLowerCase()), last = s2.pop(); return [s2.join(', '), last].filter(Boolean).join(' and '); };
  // the one supporting line under the fields: it reads the choices back and is never a control (form.fields)
  const thenWords = () => (form.draft && /PR/.test(form.then) ? 'opens a draft PR' : THEN[form.then] || 'does what the project is set up to do');
  const proof = () => { const where = form.target === 'none' ? 'without a project' : `on ${form.project}`, steps = stepsOf(); return `Starts ${form.after ? `once ${form.after.title} ends` : 'now'} ${where}${steps ? `: ${textOf('workflow', form.workflow)} ${steps}` : ''}, then ${form.sameAsSource ? 'leaves its commits on the source branch' : thenWords()}.`; };
  const pad2 = (n) => String(n).padStart(2, '0');
  const nowAt = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayWords = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
  const timeOk = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
  // when the form's schedule runs next: always a moment still to come, or null (a one-off with no date, or one already past)
  function nextRun() {
    if (!timeOk(form.at)) return null;
    if (form.every === 'once') { if (!form.date) return null; const d = new Date(`${form.date}T${form.at}:00`); return Number.isFinite(d.getTime()) && d.getTime() > Date.now() ? d : null; }
    const [d] = R.scheduleDates({ every: form.every, at: form.at, from: Sch().TODAY, n: 1, nowAt: nowAt() }); if (!d) return null;
    const [h, m] = form.at.split(':').map(Number); d.setHours(h, m, 0, 0); return d;
  }
  const repeatWords = () => (form.every === 'once' ? 'once' : form.every === 'every weekday' ? 'weekdays' : form.every === 'every weekend' ? 'at weekends' : form.every);
  function schedProof() {
    const next = nextRun();
    if (!timeOk(form.at)) return 'Give it a time of day, as 09:00.';
    if (form.every === 'once') return !form.date ? 'Runs once. Pick its date.' : next ? `Runs once, on ${dayWords(next)} at ${form.at}.` : 'That date and time have passed. Pick one still to come.';
    return `Runs ${repeatWords()} at ${form.at}${form.tz !== homeTz() ? ` (${form.tz})` : ''}${next ? ` · next ${dayWords(next)}, ${form.at}` : ''}`;
  }
  const errOf = (at) => (form.errAt === at ? form.err : '');   // the line sits under the field it is about
  function formHtml() {
    if (form.view === 'add') return addHtml();
    if (form.view === 'browse') return browseHtml();
    const sched = form.kind === 'schedule', edit = sched && !!form.editing;
    const task = form.kind === 'task', fit = task && RO() && presetList ? fits() : [];
    // a saved preset is a field too, once one exists for this project (D7); its menu: the presets, Update and Duplicate, No preset
    const presetItems = [...fit.map((p) => ({ id: `p:${p.id}`, text: p.name, checked: p.id === form.preset })), ...(form.preset ? [{ sep: true }, ...(RO().presetModified(form.presetBase, presetView()) ? [{ id: 'update', text: 'Update preset', help: 'Saves these picks into the preset' }] : []), { id: 'duplicate', text: 'Duplicate', help: 'Saves a copy and starts from it' }] : []), { sep: true }, { id: 'none', text: 'No preset', checked: !form.preset }];
    const preset = fit.length || form.preset ? F.pick({ id: 'f-preset', label: 'Preset', text: form.presetObj?.name || 'No preset', tip: 'A saved setup to start from', items: presetItems, open: menu === 'f-preset' }) : '';
    const src = R.segmented({ label: 'Task source', hook: 'c-src', items: [{ id: 'write', label: 'Write it', pressed: form.src === 'write' }, { id: 'file', label: 'From file', pressed: form.src === 'file' }, ...(task ? (sourceList || []).map((x, i) => ({ id: `plugin:${i}`, label: x.displayName || x.sourceId, pressed: form.src === `plugin:${i}` })) : [])] });
    const plugin = task ? pluginOf() : null;
    const whatOff = edit && !Sch().canEdit('what') ? { disabled: true } : {};
    const what = plugin ? `<div class="cc-src">${src}${sourceHtml(plugin)}</div>` : `<div class="cc-lbl">${form.src === 'write' ? R.field({ id: 'cc-text', label: 'What should it do', multiline: true, error: errOf('#cc-text'), hint: whatOff.disabled ? 'Its instruction cannot be changed here yet' : '', value: form.text, placeholder: sched ? 'What should each task do?' : 'Describe the software task to build…', attrs: { 'data-f': 'text', rows: sched ? 3 : 5, ...whatOff } }) : R.field({ id: 'cc-path', label: 'What should it do', error: errOf('#cc-path'), value: form.path, placeholder: 'A file in the project: docs/task.md', attrs: { 'data-f': 'path' } })}${edit ? '' : src}</div>`;
    const model = LISTS().agents.length > 1;
    const engine = model ? F.pair({ label: 'Engine and model', wider: 'second', fields: [fPick('agent', 'Engine', { quietLabel: true }), fPick('agents', 'Model', { quietLabel: true })], hint: form.agentSaid }) : fPick('agent', 'Engine', { hint: form.agentSaid });
    if (sched) {
      const once = form.every === 'once';
      const time = R.field({ id: 'cc-at', label: once ? 'Time' : 'At', type: 'time', quietLabel: once, error: errOf('#cc-at'), value: form.at, attrs: { 'data-f': 'at', required: true } });
      const when = once ? F.pair({ label: 'Date and time', wider: 'first', fields: [R.field({ id: 'cc-date', label: 'Date', type: 'date', quietLabel: true, error: errOf('#cc-date'), value: form.date, attrs: { 'data-f': 'date', min: isoDay(new Date()) } }), time] }) : time;
      const name = R.field({ id: 'cc-name', label: 'Name', error: errOf('#cc-name'), hint: edit && !Sch().canEdit('name') ? 'Its name cannot be changed here yet' : '', value: form.name, placeholder: 'What to call this schedule', attrs: { 'data-f': 'name', maxlength: 80, ...(edit && !Sch().canEdit('name') ? { disabled: true } : {}) } });
      const expert = R.shows('expert') ? [fPick('overlap', 'While one still runs'), fPick('ends', 'Stop after'), fPick('fails', 'When tasks fail'), ...(offers('notify') ? [fPick('notify', 'Notify')] : [])] : [];
      const more = edit ? '' : F.fold({ label: 'More options', open: form.more, says: R.shows('expert') ? 'Branch, time zone, while one still runs, stop after, notify' : 'Branch, time zone', attrs: { 'data-c-more': '' },
        body: F.grid({ fields: [fPick('base', 'Source branch'), fPick('then', 'When a task is done'), fPick('tz', 'Time zone'), ...expert] }) });
      const body = `${F.grid({ fields: [{ html: name, wide: true }, { html: what, wide: true }, ...(edit ? [] : [fPick('project', 'Project'), fPick('workflow', 'Workflow'), engine, '<span></span>']), fPick('every', 'Repeats'), when] })}${F.readback(schedProof())}${more}`;
      return R.dialog({ title: edit ? 'Edit schedule' : 'New schedule', body, yes: edit ? 'Save changes' : 'Create schedule', busy: !!form.busy, busyLabel: edit ? 'Saving…' : 'Creating schedule…', close: R.icon('x', 15), id: 'cc-t', cls: 'cc-dlg', hooks: hooksOf() });
    }
    // Agents' quiet pair (D6): the one model saved as the workflow's defaults, or the project's picks reset to them
    const id = flowId(), flowOwn = !!OPT() && !!id && !RO().RESERVED_WORKFLOWS.includes(id) && form.project !== 'No project' && form.target !== 'workspace' && agentIds().length;
    const flowBtns = flowOwn && model ? `<div class="cc-acts">${agentModel() ? R.button({ label: form.flowSaid || 'Save as the workflow\'s defaults', kind: 'quiet', attrs: { 'data-c-flowsave': '', title: `Every agent of ${form.workflow} runs ${form.agents.replace(/ for every step$/, '')} unless a task picks another` } }) : ''}${R.button({ label: !agentModel() && form.flowSaid ? form.flowSaid : 'Reset to the workflow\'s defaults', kind: 'quiet', attrs: { 'data-c-flowreset': '', title: `Clears ${form.project}'s own agent picks for ${form.workflow}` } })}</div>` : '';
    const none = form.target === 'none';   // No project has no git, and Auto asks you only inside a project (classic #hitl-why)
    const shaper = isShaper(form.workflow);
    const tagsSave = form.projectKey && OPT() ? `<div class="cc-acts">${R.button({ label: form.tagsSaid || 'Save as default', kind: 'quiet', attrs: { 'data-c-tagsave': '', title: `New tasks in ${form.project} start with these tags` } })}</div>` : '';
    const now = offers('afterBranch') && form.after ? `<p class="fld-read">It starts once ${esc(form.after.title)} ends. ${R.textLink({ label: 'Start now instead', attrs: { 'data-c-nowinstead': '', title: 'Starts it now, without waiting' } })}</p>` : '';   // classic setPendingSchedule(null)
    const switches = [
      opt('sameAsSource', 'Run on the source branch', none ? 'Needs a project' : 'Commits straight onto the source branch: no new branch and no PR', { disabled: none }),
      opt('draft', 'Create a draft PR', 'The PR opens as a draft; you mark it ready for review', { disabled: none || form.sameAsSource || /leave/.test(form.then) }),
      opt('hitl', 'Ask me at each step', none ? 'Needs a project' : 'Human in the loop: it stops to ask when the plan has open questions', { checked: !none && form.hitl !== false, disabled: none, attrs: { 'data-c-hitl': '' } }),
      opt('mayAnswer', 'Worca may answer for me', 'While you are away Worca answers its questions and notes each answer'),
      opt('noMemory', 'Run without memory', 'It reads no project or team memory and writes none'),
      ...(offers('mock') ? [opt('mock', 'Mock mode', 'This is a mock instance: the task runs without calling a model')] : []),
    ];
    const moreFields = [
      R.field({ id: 'cc-title', label: 'Title', value: form.title, placeholder: 'Worca names it from what it should do', attrs: { 'data-f': 'title', maxlength: NAME_MAX } }),
      R.field({ id: 'cc-branch', label: 'New branch', value: form.branch, placeholder: 'Worca makes one', attrs: { 'data-f': 'branch', ...(form.sameAsSource ? { disabled: true } : {}) } }),
      fPick('source', 'Start from', { hint: 'The copy of the source branch it starts on' }),
      fPick('then', 'When it is done', { disabled: form.sameAsSource, tip: form.sameAsSource ? 'It runs on the source branch, so there is no PR' : '' }),
      ...(GUARDS().length ? [fPick('guard', 'Guardrails', { hint: 'Applies to every agent in this task' })] : []),
      fPick('cap', 'Cost cap'),
      { html: `${R.field({ id: 'cc-tags', label: 'Cost tags', error: errOf('#cc-tags'), value: form.tags, placeholder: 'Comma separated', attrs: { 'data-f': 'tags' } })}${tagsSave}` },
      { html: `<div class="cc-opts">${switches.join('')}</div>`, wide: true },
      { html: `<div class="cc-acts">${R.button({ kind: 'quiet', label: 'Add files…', attrs: { 'data-c-files': '', title: 'Attaches files to the task' } })}${form.files.length ? `<span class="fld-hint">${esc(form.files.map((x) => x.name).join(', '))}</span>` : ''}</div>`, wide: true },
    ];
    const body = `${F.grid({ fields: [fPick('project', 'Project', { tip: 'The project you used last' }), preset || '<span></span>', { html: `${what}${task ? noteHtml() : ''}`, wide: true }, fPick('workflow', 'Workflow'), { html: `${engine}${flowBtns}` }, ...(shaper ? [fPick('slices', 'One PR, or a PR per slice', { hint: 'Shaper builds a feature in slices', disabled: none || form.sameAsSource, tip: none ? 'Needs a project' : form.sameAsSource ? 'It runs on the source branch, so there is no PR' : '' }), '<span></span>'] : []), fPick('base', 'Source branch', { disabled: none, tip: none ? 'No project has no branches' : '' }), offers('intoBranch') ? fPick('into', 'Base branch', { disabled: none || form.sameAsSource, hint: 'The branch its PR goes into' }) : '<span></span>'] })}${F.readback(proof())}${now}${F.fold({ label: 'More options', open: form.more, says: 'Title, branch, pull request, guardrails, cost, memory, files', attrs: { 'data-c-more': '' }, body: F.grid({ fields: moreFields }) })}`;
    return R.dialog({ title: 'New task', body, yes: form.after ? 'Start after it' : 'Start task', busy: !!form.busy, busyLabel: 'Starting task…', status: R.button({ label: 'Schedule…', kind: 'quiet', attrs: { 'data-c-tosched': '', title: 'The same task, at a time' } }), close: R.icon('x', 15), id: 'cc-t', cls: 'cc-dlg', hooks: hooksOf() });
  }
  const hooksOf = () => ({ close: {}, cancel: {}, yes: {} });
  // Add project… (COV-2, F-cov1-09): a short form in New task's own Dialog; Browse… opens the FolderBrowser in its place
  function addHtml() {
    const a = form.add, empty = !a.name.trim() || !a.path.trim();
    const body = `${R.field({ id: 'cc-addname', label: 'Project name', value: a.name, placeholder: 'What to call it', attrs: { 'data-c-addname': '', maxlength: 80 } })}${R.field({ id: 'cc-addpath', label: 'Folder', value: a.path, placeholder: '/absolute/path/to/project', attrs: { 'data-c-addpath': '' } })}${R.folderWay({ pick: { label: 'Browse…', hook: 'data-c-browse', title: 'Picks the folder on this computer' } })}`;
    return R.dialog({ title: 'Add project', body, yes: 'Save', id: 'cc-t', cls: 'cc-dlg', hooks: { cancel: { 'data-c-addcancel': '' }, yes: { 'data-c-addsave': '', disabled: empty, title: empty ? 'Give it a name and a folder' : `Adds ${a.name.trim()} and picks it` } } });
  }
  function browseHtml() {
    const at = form.browseAt, up = at.slice(0, at.lastIndexOf('/'));
    return R.folderBrowser({ path: at, parent: !W.live && DEMO_FOLDERS[up] ? up : null, dirs: demoDirs(at), state: 'ready', id: 'nt-fb' });
  }
  const toView = (view, focus) => { form.view = view; menu = ''; paintForm(focus); };
  function addClick(e) {
    const on = (q) => e.target.closest(q);
    if (on('[data-c-browse]')) { form.browseAt = DEMO_FOLDERS[form.add.path] ? form.add.path : DEMO_HOME; toView('browse', '.fb [data-dialog="yes"]'); return; }
    if (on('[data-c-addcancel]')) { toView('form', '[data-menu="f-project"]'); return; }
    const save = on('[data-c-addsave]'); if (!save || save.disabled) return;
    const name = form.add.name.trim(), path = form.add.path.trim();
    window.StillhetProjects?.add({ id: name, path });   // one project list: Projects' own
    Object.assign(form, { project: name, target: 'project', add: { name: '', path: '' } });
    pickedProject(); toView('form', '[data-menu="f-project"]');
  }
  function browseClick(e) {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-fb-go]'))) { if (!hit.disabled) { form.browseAt = hit.dataset.fbGo; paintForm('.fb [data-dialog="yes"]'); } return; }
    if (on('[data-fb-home]')) { form.browseAt = DEMO_HOME; paintForm('[data-fb-home]'); return; }
    if ((hit = on('[data-dialog="yes"]'))) { if (!hit.disabled) form.add = { ...form.add, path: form.browseAt }; toView('add', '[data-c-addpath]'); return; }
    if (on('[data-dialog]')) toView('add', '[data-c-browse]');
  }
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  // where the form is drawn: a plain node beside #app (Pulse rewrites #app on every draw, which would drop an open form). It
  // places nothing: the library lifts the Dialog to the window, holds the focus in it and closes it on Esc (dialog.mjs watchDialogs).
  const host = () => { let h = document.getElementById('center-dlg'); if (!h) { h = document.createElement('div'); h.id = 'center-dlg'; h.className = 'pz-app stillhet-page'; h.style.display = 'contents'; document.body.append(h); h.addEventListener('click', dlgClick); h.addEventListener('input', dlgInput); h.addEventListener('keydown', dlgKey); h.addEventListener('mousedown', (e) => { if (e.target.classList.contains('viewer-modal')) closeForm(); }); } return h; };
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
  // the control the form was opened from, found again after a redraw replaced it (the focus goes back to its opener)
  const selOf = (el0) => { const trig = el0?.closest?.('[role="menu"]')?.parentElement?.querySelector('[aria-haspopup]'), el = trig || el0, d = el?.dataset || {}; if (trig?.id) return `#${CSS.escape(trig.id)}`; return d.menu ? `[data-menu="${d.menu}"]` : d.row ? `[data-row="${d.row}"] [data-more], [data-row="${d.row}"]` : ''; };
  let openerSel = '';
  function openForm(kind, keep) { menu = ''; opener = document.activeElement; openerSel = selOf(opener); form = blank(kind, keep); document.addEventListener('keydown', escAnywhere, true); loadFlows(); loadBranches(); loadOptions(); paintForm(kind === 'schedule' && !form.editing ? '#cc-name' : '#cc-text'); }
  // Edit… on a schedule (its card, its row's ⋯, its chat card): the same Dialog, holding what it has now; Save changes it
  function editSchedule(id) {
    const s0 = Sch().find(id); if (!s0) return;
    wire();
    const once = s0.every === 'Once', at = timeOk(s0.at) ? s0.at : '09:00', d = Number.isFinite(s0.nextAt) ? new Date(s0.nextAt) : Sch().nextDates(s0)[0];
    openForm('schedule', { editing: id, name: s0.title, text: s0.what || s0.title, project: s0.project || 'No project', every: once ? 'once' : s0.every, at, date: once && d ? isoDay(d) : '', tz: s0.tz || homeTz(), was: { name: s0.title, text: s0.what || s0.title, every: once ? 'once' : s0.every, at, date: once && d ? isoDay(d) : '' } });
  }
  // a route change closes the form, as the account menu does (pulse.js): only a redraw of the same page keeps it; the next page owns the focus
  addEventListener('hashchange', () => { if (!form) return; formOff(); opener = null; paintForm(); });
  function closeForm() { formOff(); paintForm(); (opener?.isConnected && opener !== document.body ? opener : (openerSel && [...document.querySelectorAll(openerSel)].find((x) => x.offsetParent !== null)) || document.querySelector('#bar-head [data-bar-new]'))?.focus(); }   // a menu's item is gone by now: back to its +
  function check() {
    if (form.kind === 'task' && pluginOf()) return form.ticket ? null : [RO().PICK_FIRST, '#cc-search'];   // a ticket source: the picked ticket is the task
    if (form.kind === 'task' && form.broken?.length) return ['Reset each item the preset needs first', '#cc-text'];   // D7: broken items block Start
    const words = form.src === 'write' ? form.text.trim() : form.path.trim();
    if (form.kind === 'schedule' && !form.name.trim()) return ['Name it first', '#cc-name'];
    if (form.kind === 'schedule' && Sch().all().some((s) => s.id !== form.editing && s.title.toLowerCase() === form.name.trim().toLowerCase())) return ['A schedule already has that name', '#cc-name'];
    if (!words) return [form.src === 'write' ? 'Say what it should do' : 'Name the file it should follow', form.src === 'write' ? '#cc-text' : '#cc-path'];
    if (form.kind === 'schedule' && !timeOk(form.at)) return ['Give it a time of day, as 09:00', '#cc-at'];
    if (form.kind === 'schedule' && form.every === 'once' && !form.date) return ['Pick the date it runs on', '#cc-date'];
    if (form.kind === 'schedule' && form.every === 'once' && !nextRun()) return ['That date and time have passed: pick one still to come', '#cc-date'];
    return null;
  }
  // the form's overlap and failures words as dev's values (both kinds)
  const policiesOf = (f) => ({ overlap: /^queue/.test(f.overlap) ? 'queue' : 'skip', maxFailures: /never/.test(f.fails) ? 0 : Number(/\d+/.exec(f.fails)?.[0] || 3) });
  // the foot's button is busy while its action is out (comp.button-busy): the demo's server answers after a moment too
  function save() {
    if (form.busy) return;
    const bad = check(); if (bad) { form.err = bad[0]; form.errAt = bad[1]; paintForm(bad[1]); return; }
    if (form.editing) { saveEdit(); return; }
    if (W.live && form.kind === 'task') { liveStart(); return; }   // D12b: dev's POST /api/run
    if (W.live && form.kind === 'schedule') { liveSchedule(); return; }   // Schedules D9: dev's POST /api/run with repeat
    if (form.kind === 'task' && demoRefused()) return;   // the demo's engine and sync notes (D13), in the live kind's words
    const f = form; f.busy = true; paintForm();
    answered().then(() => { if (form !== f) return; f.busy = false; demoSave(); });
  }
  function demoSave() {
    const ticket = pluginOf() && (form.tickets || []).find((t) => String(t.id) === form.ticket);
    const words = (ticket ? String(ticket.title) : form.src === 'write' ? form.text : `Follow ${form.path}`).trim(), project = form.project === 'No project' ? '' : form.project, k = Date.now().toString(36);
    if (form.kind === 'task') {
      const title = form.title.trim() || (words.length > 56 ? `${words.slice(0, 54).trim()}…` : words);
      const f = form; closeForm();
      if (f.after) { Sch().add({ id: `n${k}`, title, project, chat: '', every: 'Once', at: '', next: `after ${f.after.title}`, state: 'scheduled', time: 'after', section: 'next', labels: [], what: words, cost: 0, started: Sch().dateWord(Sch().TODAY), runs: [], after: f.after.title, afterRef: { kind: f.after.kind, id: f.after.id, policy: 'done' } }); say(`Scheduled ${title}: it starts once ${f.after.title} ends`); paint(); return; }
      W.add({ id: `n-${k}`, case: 'starting', title, project, detail: 'Plan is under way', time: 'now', day: 'today', cost: 0, workflow: f.workflow, kind: f.target === 'workspace' ? 'Workspace' : project ? 'Git' : 'No project' });
      say(`Started ${title}`); paint(); return;
    }
    const once = form.every === 'once', next = nextRun(), every = once ? 'Once' : form.every, w = R.scheduleWords({ every, at: form.at, nowAt: nowAt() });
    const s = { id: `n${k}`, title: form.name.trim(), project, chat: '', every, at: form.at, tz: form.tz, next: once ? `Next ${Sch().dateWord(next)} at ${form.at}` : w.next, day: w.day, state: 'scheduled', time: w.time, section: 'next', labels: [], what: words.endsWith('.') ? words : `${words}.`, cost: 0, started: Sch().dateWord(Sch().TODAY), workflow: form.workflow, agent: form.agent, base: form.base, then: form.then, ends: form.ends, notify: form.notify, overlap: policiesOf(form).overlap, fails: policiesOf(form).maxFailures, ...(once ? { nextAt: next.getTime() } : {}), runs: [] };
    closeForm(); Sch().add(s); say(`Scheduled ${s.title}: ${once ? `once, on ${dayWords(next)} at ${s.at}` : R.scheduleWords(s).runs}`);
    if (advanced()) { window.StillhetShell.go(`schedule/${s.id}`); return; }   // after saving you land on the schedule you made
    toChatCard(s);   // Simple has no Schedules place: you land in its chat, on its card
  }
  // a schedule made from the form where Schedules is not offered: its card in a chat (the one you are in, else one of its own)
  function toChatCard(s) {
    const C = window.StillhetChats; if (!C) return;
    const here = /^#chat\/([^/?]+)/.exec(location.hash)?.[1], chats = () => C.data().chats;
    const cid = here && chats().some((x) => x.id === here) ? here : C.newChat(s.title, s.project || '', { fromTask: true });
    const c = chats().find((x) => x.id === cid); if (!c) return;
    s.chat = cid;
    window.StillhetConversation?.join(c, { t: 'schedule', id: `k-${s.id}`, task: s.id });   // joined before it is listed: a thread built now would draw it twice
    c.tasks = [...(c.tasks || []), { id: s.id, kind: 'schedule', title: s.title, detail: `Runs ${R.scheduleWords(s).runs}`, time: s.at }]; C.refresh();
    window.StillhetShell.go(`chat/${cid}`);
  }
  // Edit…'s Save: only what changed is sent, through the schedule's own edit (schedules.js: the demo applies it, the live kind PATCHes it)
  async function saveEdit() {
    const f = form, was = f.was, patch = {};
    if (f.name.trim() !== was.name) patch.title = f.name.trim();
    if (f.text.trim() !== was.text) patch.what = f.text.trim();
    if (f.every !== was.every || f.at !== was.at || f.date !== was.date) Object.assign(patch, { every: f.every, at: f.at, ...(f.every === 'once' ? { date: f.date } : {}) });
    if (!Object.keys(patch).length) { closeForm(); return; }   // a Save that changed nothing closes without a toast (form.check-at-save)
    f.busy = true; paintForm();
    await answered();
    const r = await Sch().edit(f.editing, patch);
    f.busy = false;
    if (form !== f) return;
    if (r && r.ok === false) { form.err = `Could not save the changes: ${r.error || 'no answer'}`; form.errAt = '#cc-name'; paintForm(form.errAt); return; }
    closeForm(); say(`Saved ${f.name.trim()}`); paint();
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
    const none = form.project === 'No project', dir = none ? '' : window.StillhetTaskLive?.projectDirOf(form.project) || '';
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
      ...(body0.workflowId === 'wf_auto' ? { humanInLoop: form.hitl !== false } : {}),   // Auto: classic's switch, on unless the project turned it off
      // More options' switches, each sent only when it is turned from its default (dev's POST /api/run keys)
      ...(!none && form.sameAsSource ? { sameAsSource: true } : {}), ...(form.mayAnswer ? { nightMode: true } : {}), ...(form.noMemory ? { noMemory: true } : {}), ...(form.mock ? { mock: true } : {}),
      ...(body0.workflowId !== 'wf_auto' && form.hitlTouched ? { humanInLoop: form.hitl !== false } : {}),
      ...(form.guard && form.guard !== GUARDS()[0] && !form.preset ? { guardrailsId: form.guard.toLowerCase().replace(/ /g, '-') } : {}) };
    if (!none && !form.sameAsSource && (form.draft || (isShaper(form.workflow) && form.slicesTouched))) body.pr = { ...(body.pr || {}), ...(form.draft && body.pr?.open !== 'none' ? { open: 'draft' } : {}), ...(isShaper(form.workflow) && form.slicesTouched ? { slices: form.slices } : {}) };
    if (form.sameAsSource) { delete body.featureBranch; delete body.pr; }
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
    const res = await window.StillhetTaskLive?.act('new-task', { body, quiet: true, key: 'new-task:form' });
    f.busy = false;
    if (form !== f) return;
    if (!res?.ok && refused(res)) return;
    if (!res?.ok) { form.err = `Could not start the task: ${res?.error || 'no answer'}`; form.errAt = form.src === 'write' ? '#cc-text' : '#cc-path'; paintForm(form.errAt); return; }
    closeForm();
    if (f.after) { say(`Scheduled ${f.title.trim() || words}: it starts once ${f.after.title} ends`); return; }   // a waiting ticket, no task yet: Schedules lists it
    say(`Started ${f.title.trim() || words}`);
    if (res.data?.runId) window.StillhetShell?.go(`run/${res.data.runId}`);
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
  // StillhetScheduleLive (the rule from its words, live/schedule-rule.mjs); a refusal stays in the form with what was typed.
  async function liveSchedule() {
    if (form.busy) return;
    const words = (form.src === 'write' ? form.text : `Follow ${form.path}`).trim(), none = form.project === 'No project';
    const dir = none ? '' : window.StillhetTaskLive?.projectDirOf(form.project) || '';
    if (!none && !dir) { form.err = 'Could not create the schedule: that project is not known'; form.errAt = '#cc-name'; paintForm(form.errAt); return; }   // never a no-project schedule by accident
    const f = form; f.busy = true; paintForm();
    // a one-off is dev's scheduledFor on POST /api/run; a repeating one is its repeat rule
    const once = f.every === 'once', next = nextRun();
    const res = once ? await window.StillhetTaskLive?.act('new-task', { body: { ...(none ? { noProject: true } : { projectDir: dir }), ...runFields(none), prompt: words, title: f.name.trim(), scheduledFor: next.toISOString() }, quiet: true, key: 'new-task:form' })
      : await window.StillhetScheduleLive?.act('new', { ...(none ? { noProject: true } : { projectDir: dir }), run: runFields(none), prompt: words, title: f.name.trim(), every: f.every, at: f.at, tz: f.tz,
        end: window.StillhetScheduleLive.endOf?.(f.ends) || null, ...policiesOf(f) });
    f.busy = false;
    if (form !== f) return;
    if (!res?.ok) { form.err = `Could not create the schedule: ${res?.error || 'no answer'}`; form.errAt = form.src === 'write' ? '#cc-text' : '#cc-path'; paintForm(form.errAt); return; }
    closeForm(); say(`Scheduled ${f.name.trim()}: ${once ? `once, on ${dayWords(next)} at ${f.at}` : R.scheduleWords({ every: f.every, at: f.at }).runs}`);
    const made = res.data?.id || res.data?.ticketId || res.data?.scheduleId; if (made && advanced()) window.StillhetShell.go(`schedule/${made}`);   // you land on the schedule you made, once the server names it
  }
  // a project pick (or one added here): its base, preset and source; a workspace has no project folder, so no defaults, config or policy read
  function pickedProject() {
    const f = form; f.target = targetOf(f.project);
    f.base = W.live ? LIVE_BASE : baseList().includes(f.base) ? f.base : baseList()[0]; loadBranches(); f.note = null;
    if (f.preset && f.presetObj?.scope?.kind !== 'global') clearPreset(); else checkPreset();
    if (f.target === 'workspace') Object.assign(f, { projectKey: '', defaultEngine: '', activeWf: '', policy: null, defaultsFor: f.project, policyGen: (f.policyGen || 0) + 1 });
    else loadProject();
    if (pluginOf()) pickSource();
  }
  function dlgClick(e) {
    if (form?.view === 'add') { addClick(e); return; }
    if (form?.view === 'browse') { browseClick(e); return; }
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-menu-pick^="f-preset|"]'))) { const v = hit.dataset.menuPick.slice('f-preset|'.length); menu = ''; if (v === 'update') updatePreset(); else if (v === 'duplicate') duplicatePreset(); else if (v === 'none') clearPreset(); else { const p = (presetList || []).find((x) => `p:${x.id}` === v); if (p) applyPreset(p); } paintForm('[data-menu="f-preset"]'); return; }
    if ((hit = on('[data-menu-pick^="si-"]'))) { const [id, ...v] = hit.dataset.menuPick.split('|'); form.srcIn = { ...form.srcIn, [id.slice(3)]: v.join('|') }; menu = ''; paintForm(`[data-menu="${id}"]`); searchTickets(); return; }
    if ((hit = on('[data-menu^="si-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paintForm(`[data-menu="${hit.dataset.menu}"]`); return; }
    if ((hit = on('[data-menu-pick^="f-gprofile|"]'))) { form.gatePick = hit.dataset.menuPick.slice('f-gprofile|'.length); menu = ''; paintForm('[data-menu="f-gprofile"]'); return; }
    if ((hit = on('[data-menu-pick^="f-"]'))) {
      if (hit.getAttribute('aria-disabled') === 'true') return;   // an off item says why in its tooltip and picks nothing
      const [id, ...rest] = hit.dataset.menuPick.split('|'), v = rest.join('|');   // a picked name may hold '|'
      if (id === 'f-project' && v === '+add' && offers('addProject')) { form.add = { name: '', path: '' }; toView('add', '[data-c-addname]'); return; }
      form[id.slice(2)] = v; menu = '';
      if (id === 'f-slices') form.slicesTouched = true;
      if (id === 'f-every' && v === 'once' && !form.date) { const t = new Date(); t.setDate(t.getDate() + 1); form.date = isoDay(t); }   // a one-off starts on tomorrow's date, never a past one
      if (id === 'f-project') pickedProject();
      if (id === 'f-base' || id === 'f-source') { form.note = null; form.synced = false; }   // a changed base or source is asked again
      if (id === 'f-agent') { form.agentTouched = true; form.allow = false; if (form.note?.kind === 'engine') form.note = null; }   // the consent was for the engine refused
      if (id === 'f-workflow') { form.workflowTouched = true; const wf = flowId(), dir = dirOf(); if (W.live && !form.preset && wf && dir) OPT()?.setActiveWorkflow(dir, wf).then((r) => { if (!r.ok) window.StillhetAdapter?.toast?.(`Could not select the workflow: ${r.error}`); }); }
      if (!LISTS().agents.includes(form.agents)) form.agents = AGENTS_OWN;
      if (id === 'f-agents' || id === 'f-workflow') loadPolicy();
      paintForm(`[data-menu="${id}"]`); return;
    }
    if ((hit = on('[data-menu^="f-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paintForm(`[data-menu="${hit.dataset.menu}"]`); return; }
    if (menu) { menu = ''; paintForm(); }
    if ((hit = on('[data-c-src]'))) { form.src = hit.dataset.cSrc; if (pluginOf()) { pickSource(); paintForm('#cc-search'); return; } paintForm(form.src === 'write' ? '#cc-text' : '#cc-path'); return; }
    if (e.target.matches?.('input[data-c-allow]')) { form.allow = e.target.checked; paintForm('[data-c-allow]'); return; }
    if ((hit = on('[data-c-sync]'))) { if (!hit.disabled) syncWay(hit.dataset.cSync); return; }
    if (on('[data-c-nowinstead]')) { form.after = null; if (!baseList().includes(form.base)) form.base = baseList()[0]; paintForm('[data-dialog="yes"]'); return; }
    if (e.target.matches?.('input[data-c-opt]')) {   // More options' switches: a Checkbox each, with its line of help
      const k = e.target.dataset.cOpt; form[k] = e.target.checked; if (k === 'hitl') form.hitlTouched = true;
      paintForm(`[data-c-opt="${k}"]`); return;
    }
    if ((hit = on('[data-c-preset-reset]'))) { resetBroken(+hit.dataset.cPresetReset); return; }
    if (on('[data-c-bind]')) { bindProfile(); return; }
    if (on('[data-c-srctest]')) { connectSource(); paintForm(); return; }
    if (on('[data-c-market]')) { closeForm(); window.StillhetShell.go('marketplace'); return; }
    if ((hit = on('[data-c-ticket]'))) { if (hit.matches('input')) e.preventDefault(); pickTicket(hit.dataset.cTicket); return; }
    if (on('[data-c-tagsave]')) { saveTags(); return; }
    if (on('[data-c-flowsave]')) { saveFlow(false); return; }
    if (on('[data-c-flowreset]')) { saveFlow(true); return; }
    if (on('[data-c-more]')) { form.more = !form.more; paintForm('[data-c-more]'); return; }
    if (on('[data-c-tosched]')) { form = blank('schedule', { project: form.project, workflow: form.workflow, agent: form.agent, base: form.base === PREVIOUS_BASE ? baseList().find((x) => x !== PREVIOUS_BASE) : form.base, source: form.source, then: form.then, text: form.text, path: form.path, src: /^plugin:/.test(form.src) ? 'write' : form.src, name: form.title }); paintForm('#cc-name'); return; }
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
    const ds = e.target.dataset || {};
    if ('cAddname' in ds || 'cAddpath' in ds) { form.add = { ...form.add, ['cAddname' in ds ? 'name' : 'path']: e.target.value }; paintForm(); return; }   // Save goes on once both are filled
    const si = e.target.dataset?.srcIn; if (si) { form.srcIn = { ...form.srcIn, [si]: e.target.value }; clearTimeout(searchTimer); searchTimer = setTimeout(searchTickets, 300); return; }   // a filter reruns the list (source-pane.mjs)
    const k = e.target.dataset?.f; if (!k) return; form[k] = e.target.value;
    if (k === 'at' || k === 'date') { const line = document.querySelector('#center-dlg .fld-read'); if (line) line.textContent = schedProof(); }   // the read-back follows, and the field keeps its caret
    if (k === 'tags') form.tagsTouched = true;
    if (k === 'search') { clearTimeout(searchTimer); searchTimer = setTimeout(searchTickets, 300); }   // source-pane.mjs's debounce
    if (form.err && check()?.[1] !== form.errAt) { const f = document.querySelector(`#center-dlg ${form.errAt}`); form.err = ''; form.errAt = ''; document.querySelector(`#${f?.id}-note`)?.remove(); f?.removeAttribute('aria-invalid'); f?.removeAttribute('aria-describedby'); }   // once it is mended, the line goes
  }
  function dlgKey(e) {
    if (e.key === 'Escape' && form?.view === 'add') { e.stopPropagation(); toView('form', '[data-menu="f-project"]'); return; }   // one view back, never the whole task
    if (e.key === 'Escape' && form?.view === 'browse') { e.stopPropagation(); toView('add', '[data-c-browse]'); return; }
    if (e.key === 'Escape') { e.stopPropagation(); if (menu) { const m = menu; menu = ''; paintForm(`[data-menu="${m}"]`); } else closeForm(); return; }
    if (e.key === 'Enter' && e.target.matches('input[data-f]')) { e.preventDefault(); save(); return; }
  }

  // the project a form opens on: the one given, else the composer's (Chat's own accessor once it has one), else the open chat's
  const chatProject = () => { const own = window.StillhetConversation?.project?.(); if (own) return own; const id = /^#chat\/([^/?]+)/.exec(location.hash)?.[1]; return (id && window.StillhetChats?.data?.().chats.find((x) => x.id === id)?.project) || ''; };
  const keepOf = (keep) => { const project = keep.project || chatProject(); return { ...keep, ...(project ? { project: projects().includes(project) ? project : defaultProject() } : {}) }; };
  const ask = (which) => window.StillhetConversation?.handOver({ mode: which === 'task' ? 'task' : 'schedule', ph: which === 'task' ? 'What should the task do?' : 'What should run, and when?' });
  window.StillhetCenters = {
    tasks: (el) => { wire(); settle('tasks'); tasksHost = el; menu = ''; asking = null; if (W.live) window.StillhetInsightsLive?.retryWeek?.(); paint(); },   // a visit reads a failed week again
    schedules: (el) => { wire(); schedHost = el; menu = ''; if (/^#schedules/.test(location.hash)) el.innerHTML = schedulesHtml(); },
    visit: (which) => settle(which),   // a new visit: the cards take their settled order
    editSchedule,   // Edit… from a schedule's row, card or chat card, in every mode
    // the forms, opened from Chat only (its starters and cards): New task, New schedule, and a schedule's Edit…
    newSchedule: (keep = {}) => { wire(); openForm('schedule', keepOf(keep)); },
    newTask: (keep = {}) => { wire(); openForm('task', keepOf(keep)); },   // Run after this: the New task form, waiting for that one
    // the Projects center's strip, under its home's head; a strip asked there is dropped once its home is left
    askStrip: () => (asking?.where === 'place' && W.find(asking.id) ? stripOf(asking) : ''), unask: () => { if (asking?.where === 'place') asking = null; },
    paint, wire, taskOf, stateOf, clause, actionsOf, schedLink, link, inWeek,
  };
})();
