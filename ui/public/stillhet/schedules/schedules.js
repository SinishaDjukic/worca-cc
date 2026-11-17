// Schedules (Expert): the list in the one bar, and a schedule's page, read like a chat: its head, each time it ran as a task
// by day, a failure opened, and a composer whose question goes to its chat.
// One code path for both kinds (Schedules D5): the demo kind acts on its seed; the live kind sends each action through
// StillhetScheduleLive (live/schedule-live.mjs) and changes nothing until the server's frame reloads the store. The page
// is an inspect view: its facts are read-only values, and what changes a schedule is asked for in its chat (Edit…, the
// chat card's Dialog, comes through act(id, 'edit')). Delete waits out its Undo window before it is sent (D8).
(function () {
  const R = window.StillhetUI, M = window.SchedulesModel, RM = window.RunCardModel;
  const bar = document.getElementById('bar-schedules'), page = document.getElementById('route-schedule');
  if (!bar || !page) return;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const whenOf = (s) => (s.day === 'today' ? 'today' : s.day === 'week' ? 'week' : 'tomorrow');
  const LIVE = () => !!window.StillhetWorld?.live, SL = () => window.StillhetScheduleLive;
  let data = M.seed(); /* the schedules that wait to run are in the one store too, so Pulse's Scheduled lists the same ones */
  const gone = new Set();   // live: a Delete inside its Undo window, hidden here until the server's frame drops it (D8)
  const list = () => data.schedules.filter((s) => !gone.has(s.id));
  const byId = (id) => list().find((s) => s.id === id);
  // each started run is a task in the one store, in its project (panel.task-truth); a time not started is a ticket: Pulse lists it, Tasks does not, and a missed one needs you
  const missedWords = (s) => `Missed ${s.missed} · ${s.missedWhy}`;
  const ticketOf = (s) => (s.section === 'needs' ? { case: 'ticket-missed', detail: missedWords(s), missed: true } : { case: 'scheduled', detail: R.scheduleWords(s).says, missed: false });
  const toStore = () => { const W = window.StillhetWorld; if (!W || W.live) return;   /* the live kind's store already holds them (live/live-map.mjs) */ for (const s of data.schedules) {
    if (s.state !== 'paused' && !s.ended && !W.find(`sch-${s.id}`)) W.add({ id: `sch-${s.id}`, ...ticketOf(s), ticket: s.id, title: s.title, project: s.project || '', time: s.at, day: 'upcoming', when: whenOf(s) });
    s.runs.forEach((r, i) => { r.wid ||= `sr-${s.id}-${i}`; if (!W.find(r.wid)) W.add({ id: r.wid, case: r.case, title: r.title, project: s.project || '', detail: r.meta, time: r.time || 'now', day: r.day, schedule: s.id, cost: s.cost, over: !!r.over, workflow: s.workflow || 'Default' }); }); } };
  toStore(); window.StillhetWorld?.onChange(toStore);
  let current = '', view = { show: 'all', from: '', by: R.BY_DEFAULT }, ctl = null, menu = '';
  const say = (t, undo) => window.StillhetPulse?.say(t, undo);
  // the demo's server takes a moment to answer, as a real one does, so a waiting button shows it waits
  const answered = () => (LIVE() ? Promise.resolve() : new Promise((ok) => setTimeout(ok, 450)));
  const st = (s) => R.runState(s.state === 'ended' ? 'scheduled' : s.state), toneOf = (s) => (waitsOnYou(s) ? 'act' : isRunning(s) ? 'run' : s.ended || s.state === 'scheduled' ? 'idle' : R.markTone(st(s)));
  // one word for where a schedule stands, on its page, its card, its row, its chat card and Pulse (wordOf below)
  const word = (s) => (waitsOnYou(s) ? R.runState('question').word : isRunning(s) ? R.runState('working').word : s.ended ? 'Ended' : s.section === 'needs' ? 'Missed' : s.state === 'paused' ? R.runState('paused').word : 'Next up');
  const SECTIONS = [['needs', R.runState('question').word], ['running', 'Running'], ['next', 'Next up'], ['paused', R.runState('paused').word], ['ended', 'Ended']];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], dateWord = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  // live: the server's next time first (nextAt, live-map.mjs), which already skips a skipped one; a once-ticket has no time after it
  // the clock now, so a time already past today is never "next" (a next date is always still to come)
  const pad2 = (n) => String(n).padStart(2, '0'), nowAt = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const nextDates = (s, n = 1) => { if (!Number.isFinite(s.nextAt)) return R.scheduleDates({ every: s.every, at: s.at, from: M.TODAY, n, nowAt: nowAt() }); const first = new Date(s.nextAt), after = new Date(first); after.setDate(after.getDate() + 1); return [first, ...(s.every === 'Once' ? [] : R.scheduleDates({ every: s.every, at: s.at, from: after, n: n - 1, nowAt: '' }))]; };
  const nextDate = (s) => { const d = nextDates(s, 2); return Number.isFinite(s.nextAt) ? d[0] : d[s.skip ? 1 : 0] || d[0]; };   // a skipped time moves it to the one after
  const nextWord = (s) => (s.every === 'every hour' ? 'Within the hour' : dateWord(nextDate(s)));
  // when it next runs, in dates: its card and its page's head say the same
  const nextLine = (s) => { const [d1] = nextDates(s, 1).map(dateWord); return s.after ? `after ${s.after}` : s.every === 'every hour' ? (s.skip ? 'skips the next one' : 'within the hour') : s.skip ? 'Skips next time, then as usual' : `${d1}, ${s.at}`; };
  // why it stands where it does, next to its word: the same on its page, its card, its chat card and its row (nextOf below)
  const why = (s) => (waitsOnYou(s) ? (liveRuns(s).length > 1 ? `its ${liveRuns(s).length} running tasks wait on you` : 'its running task waits on you') : isRunning(s) ? `for ${!runningRun(s).time || runningRun(s).time === 'now' ? 'a moment' : runningRun(s).time}` : s.ended ? '' : s.section === 'next' ? nextLine(s) : s.state === 'paused' ? s.pauseWhy || s.next.replace(/^Paused ?/, '') || 'by you' : s.next.replace(/^(Missed|Next) /, ''));
  const sectionNow = (s) => (s.section !== 'needs' && isRunning(s) ? 'running' : s.section);   // a run under way moves it, a paused one's too, and its end leaves it where it was
  const flowWord = (s) => `${s.workflow && s.workflow !== 'Default' ? s.workflow : 'Default'} workflow`;
  const menuItems = (s) => (s.ended ? [{ id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }]
    : [{ id: 'run', text: 'Run now', off: isRunning(s), help: isRunning(s) ? 'Its task is running; it can start again when that ends' : 'Starts a task now; the schedule keeps its times' }, { id: 'in-view', text: window.StillhetShell?.inView.has('schedule', s.id) ? 'Out of view' : 'Keep in view', help: 'Its mark in the top bar, on every page' }, ...(s.every === 'Once' ? [] : [{ id: 'pause', text: s.state === 'paused' ? 'Resume' : 'Pause', help: s.state === 'paused' ? 'It runs at its next time again' : 'It stops starting tasks until you resume it' }, { id: 'skip', ...skipItem(s) }]), { sep: true }, { id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }]);
  const rowOf = (s) => ({ key: `sched:${s.id}`, _s: s, title: s.title, meta: `${s.project || 'No project'} · ${word(s)}`,   /* list.row-facts: project · state; its workflow and its prompt are in its tooltip and on its page */ mark: R.kindMark({ breathe: s.id !== current, kind: 'schedule', tone: toneOf(s), title: `${word(s)} · ${s.ended ? 'Ended' : s.next}` }), end: sectionNow(s) === 'running' ? (runningRun(s)?.time || 'now') : sectionNow(s) === 'needs' ? 'Missed' : s.state === 'paused' || s.ended ? '' : s.time, current: s.id === current, tip: `${s.title}\n${s.what ? `${s.what}\n` : ''}${s.project || 'No project'} · ${flowWord(s)} · ${s.chat ? 'from a chat' : 'no chat'}\nRuns ${s.ended ? 'no more' : R.scheduleWords(s).runs} · ${s.ended ? 'Ended' : s.next}`,
    menu: menuItems(s) });
  // Run now is one thing wherever you press it: a real task in the one store, on this schedule's page, and in its chat
  const liveWord = 'Plan · writing the plan';
  function runningRun(s) { const W = window.StillhetWorld; return s.runs.find((r) => { const w = r.wid && W?.find(r.wid); return w && !w.archived && R.stillGoing(RM.stateOf(w.case)); }); }   // logic.still-going: a fire waiting on a question is still going (F-G-G3-03)
  function isRunning(s) { return !!runningRun(s); }
  // F-FM2-01: the fires still going; while every one waits on you (a question, a gate), the schedule says Needs you, not Working
  function liveRuns(s) { const W = window.StillhetWorld; return s.runs.map((r) => r.wid && W?.find(r.wid)).filter((w) => w && !w.archived && R.stillGoing(RM.stateOf(w.case))); }
  function waitsOnYou(s) { const ws = liveRuns(s); return ws.length > 0 && ws.every((w) => window.StillhetWorld.section(w) === 'needs'); }
  // the live kind (D5): one request through StillhetScheduleLive; nothing here moves until its frame reloads the store
  async function live(id, s, args = {}, ok = '') {
    const r = await SL().act(id, { id: s.id, ...args });
    if (!r.ok) { if (r.error !== 'busy') say(`Could not ${SL().words(id)}: ${r.error}`); return null; }
    if (ok) say(ok);
    return r;
  }
  function runNow(s) {
    if (isRunning(s)) { say(`${s.title} is already running`); return; }
    if (LIVE()) { live('run', s, {}, `Started ${s.title}; the schedule keeps its times`); return; }
    const k = Date.now().toString(36), wid = `sr-${s.id}-${k}`;
    s.runs.unshift({ day: 'today', title: s.title, case: 'working', stage: 0, git: 'branch', meta: liveWord, wid });
    window.StillhetWorld?.add({ id: wid, case: 'working', title: s.title, project: s.project || '', detail: liveWord, time: 'now', day: 'today' });
    const c = s.chat && window.StillhetChats?.data().chats.find((x) => x.id === s.chat);
    if (c) { const t = { id: `t${k}`, run: wid, title: s.title, ask: s.title, case: 'working', stage: 0, git: 'branch', detail: liveWord }; c.tasks = [...(c.tasks || []), t]; window.StillhetConversation?.join(c, { t: 'task', id: `k${k}`, task: t.id }); window.StillhetChats.refresh(); }
    if (s.section === 'needs') { s.section = 'next'; s.state = 'scheduled'; s.next = R.scheduleWords(s).next; delete s.missed; window.StillhetWorld?.move(`sch-${s.id}`, 'scheduled', R.scheduleWords(s).says, { missed: false, day: 'upcoming', time: s.at, when: whenOf(s) }); }   // run now was the catching up
    draw(); say(`Started ${s.title}; the schedule keeps its times`);
  }
  const skipItem = (s) => (s.state === 'paused' ? { text: 'Skip next time', off: true, help: 'It is paused: nothing is coming to skip' } : s.skip ? { text: 'Keep next time', help: 'It runs next time after all' } : { text: 'Skip next time', help: 'Only the next one; the times stay' });
  function act(id, rows) {
    const s = rows[0]?._s; if (!s) return;
    if (id === 'in-view') { window.StillhetShell.inView.toggle({ type: 'schedule', id: s.id, title: s.title }); draw(); return; }
    if (id === 'run') { runNow(s); return; }
    if (id === 'skip' || id === 'delete') { more(s, id); return; }
    if (id === 'pause') {
      if (LIVE()) { const on = s.state === 'paused'; live(on ? 'resume' : 'pause', s, {}, on ? `Resumed ${s.title}` : `Paused ${s.title}`); return; }
      const W = window.StillhetWorld, wid = `sch-${s.id}`; if (W?.find(wid)) W.move(wid, s.state === 'paused' ? 'scheduled' : 'stopped', s.state === 'paused' ? R.scheduleWords(s).next : 'Paused by you', { missed: false });   // Pulse hears it: a paused time no longer needs you
      s.state = s.state === 'paused' ? 'scheduled' : 'paused'; s.section = s.state === 'paused' ? 'paused' : 'next'; s.next = s.state === 'paused' ? 'Paused by you' : R.scheduleWords(s).next; s.day = R.scheduleWords(s).day; s.skip = ''; toStore(); follow(s); draw(); say(s.state === 'paused' ? `Paused ${s.title}` : `Resumed ${s.title}`); }
  }
  ctl = R.listController({ root: bar, spec: { noun: 'schedules', label: 'Selected schedules', view: () => ({ state: 'ready',
    parts: [{ word: 'Showing', id: 'show', tabs: ['all', 'repeating', 'once'], text: view.show, tip: 'Which schedules the list shows', items: SHOWS.map(([x, help]) => ({ id: x, text: x, help, checked: view.show === x, hint: String(list().filter((s) => inFrom(s) && shows(s, x)).length) })) },
      { word: 'from', id: 'from', raw: true, text: view.from || 'All projects', tip: 'Which project they belong to', items: [{ id: 'all', text: 'All projects', checked: !view.from }, { sep: true }, ...projectsOf().map((p) => ({ id: p, text: p, checked: view.from === p }))] },
      R.byPart({ by: view.by, choices: [{ id: 'day', help: 'By the next task: Today, Tomorrow, This week, Later; paused ones last' }, { id: 'state', help: `${SECTIONS.map(([, t]) => t).join(', ')}` }] })],
    sections: sections(), empty: { text: 'No schedules yet.', action: 'Start one in Chat' } }),
    can: () => ['menu'], bulk: () => [], act, open: (r) => window.StillhetShell.go(`schedule/${r._s.id}`),   /* a row opens the schedule's own page (thing-page) */ word: (id, v) => { view = { ...view, [id]: id === 'from' && v === 'all' ? '' : v }; if (!current) window.StillhetCenters?.schedules(page); return false; }, say,
    active: () => /^#schedule/.test(location.hash) && !document.querySelector('.pz-popover, .keys-modal, .viewer-modal, #app .nav-fly'), emptyAct: () => window.StillhetConversation?.start('schedule') } });
  // Show: classic's two tabs (Once, Repeating) beside All and Paused; Project narrows bar and page together (one filter per place)
  const SHOWS = [['all', 'Every schedule'], ['paused', 'Only the paused ones'], ['once', 'One-off: runs a single time'], ['repeating', 'Runs again and again']];
  const shows = (s, show) => show === 'all' || (show === 'paused' ? s.state === 'paused' : show === 'once' ? s.every === 'Once' : show === 'repeating' ? s.every !== 'Once' : true);
  const inFrom = (s) => !view.from || (s.project || 'No project') === view.from;
  const projectsOf = () => [...new Set(list().map((s) => s.project || 'No project'))].sort();
  const showing = (s) => inFrom(s) && shows(s, view.show);
  // By date (the default): what waits on you first, then by the next run, each day folding; paused ones, then ended ones last, as they have none.
  function sections() {
    const shown = list().filter(showing), at = (id) => shown.filter((s) => sectionNow(s) === id);
    if (view.by !== 'day') return SECTIONS.map(([id, title]) => ({ id, title, rows: at(id).map(rowOf) })).filter((x) => x.rows.length);   // list.sections: an empty one is not drawn
    const head = [['needs', 0], ['running', 1]].filter(([id]) => at(id).length).map(([id, i]) => ({ id, title: SECTIONS[i][1], rows: at(id).map(rowOf) }));
    const next = at('next').sort((a, b) => nextDate(a) - nextDate(b)), days = [...new Set(next.map(nextWord))].map((d) => [d, d]);
    return [...R.dateSections({ rows: next, dayOf: nextWord, row: rowOf, head, days }), { id: 'paused', title: SECTIONS[3][1], rows: at('paused').map(rowOf) }, { id: 'ended', title: SECTIONS[4][1], rows: at('ended').map(rowOf) }].filter((x) => x.rows.length);
  }
  // a failed run a later run put right is Normal (look.alert-ladder): the list is newest first
  const fixedLater = (r) => { const s = data.schedules.find((x) => x.runs?.includes(r)); return !!s && s.runs.slice(0, s.runs.indexOf(r)).some((x) => ['ok', 'done', 'merged'].includes(R.markTone(R.runState(RM.stateOf(x.case))))); };
  const toneOfRun = (r) => { const t = R.markTone(R.runState(RM.stateOf(r.case))); return t === 'fail' && fixedLater(r) ? 'idle' : t; };
  const runMark = (r) => R.kindMark({ kind: 'task', tone: toneOfRun(r), stage: r.stage, title: r.meta });
  // each run is the task it started, in the chat's own card: its state, its stages, why it failed on the text edge, one way in
  const STAGES = ['Plan', 'Build', 'Review', 'PR', 'Merged'];
  const runCard = (r, day, s) => { const st = R.runState(RM.stateOf(r.case)), tone = toneOfRun(r);
    const why = r.log ? r.log.split('\n').map((w) => R.turnRow({ mark: '', text: `<span class="cmd-s">${esc(w.trim())}</span>` })).join('') : '';
    return R.taskCard({ title: r.title, mark: runMark(r), word: `${st.word} · ${day}`, detail: r.meta === st.word ? '' : r.meta, place: tone === 'merged' ? '' : R.gitMark({ status: r.git, title: r.meta }), rows: why, stages: R.stageBar({ labels: STAGES, stage: r.stage, tone, step: R.stageStep(r.meta), key: r.wid ? `t-${r.wid}` : '' }), action: ticketActs(r, s) || R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-sched-run': String(s.runs.indexOf(r)), 'aria-label': `Open: ${r.title || s.title}, ${r.meta || ''}`, title: 'Opens this task in its chat' } }) }); };
  // a fire that never started (run-state.mjs ticket-missed, ticket-failed): Start now is the ticket's own run-now; a failed one's Open project opens its project's page (D16)
  const ticketActs = (r, s) => (!/^ticket-(missed|failed)$/.test(r.case) ? '' : R.button({ label: 'Start now', kind: 'quiet', attrs: { 'data-sched-ticket': `${r.wid}|now`, title: 'Starts this one now; the schedule keeps its times' } })
    + (r.case === 'ticket-failed' ? R.button({ label: 'Open project', kind: 'quiet', attrs: { 'data-sched-ticket': `${r.wid}|project`, title: `Opens ${s.project || 'its project'}` } }) : ''));
  const projectKeyOf = (name) => { const W = window.StillhetWorld, ps = (W?.part?.('projects') || W?.data?.().projects || []); return (ps.find((p) => p && (p.name === name || p.id === name))?.id) || name; };
  // a task this schedule ran opens in its chat, as a card there: the schedule's chat, or one of its own; live, its own task page
  function openRun(s, r) {
    if (LIVE()) { if (r.wid && window.StillhetWorld?.find(r.wid)) window.StillhetShell.go(`run/${r.wid}`); else say(`${r.title} never started: ${r.meta || 'its ticket says why'}`); return; }
    const chats = () => window.StillhetChats.data().chats;
    let cid = s.chat || r.chat;
    if (!cid) { cid = r.chat = window.StillhetChats.newChat(r.title, s.project || '', { fromTask: true }); say(`Opened in a new chat: ${r.title}`); }
    if (!r.tid) {
      const c = chats().find((x) => x.id === cid), k = `${s.id}-${s.runs.indexOf(r)}`;
      r.wid ||= `sr-${k}`; r.tid = `t-${r.wid}`;
      c.tasks = [...(c.tasks || []), { id: r.tid, run: r.wid, title: r.title, ask: r.title, case: r.case, stage: r.stage, git: r.git, detail: r.meta }];
      window.StillhetConversation?.join(c, { t: 'task', id: `k-${r.wid}`, task: r.tid }); window.StillhetChats.refresh();
    }
    window.StillhetShell.openTask(r.case, cid, r.title, r.wid);
  }
  // ---- the page's facts, in words ----
  const OVERLAP = { skip: 'skip if still going', queue: 'queue if still going', start: 'start another if still going' };
  const MISSED = { run: 'run late if missed', skip: 'skip if missed' };
  const failsWord = (n) => (n === 0 ? 'never pause' : `pause after ${n} failures`);
  // how late a missed time may still start (dev's grace window, minutes), when a missed time runs late
  const GRACE = { 30: 'at most 30 minutes late', 60: 'at most 1 hour late', 120: 'at most 2 hours late', 360: 'at most 6 hours late', 720: 'at most 12 hours late', 1440: 'at most a day late' };
  const graceOf = (s) => (Number.isFinite(s.grace) ? s.grace : 360);
  const NOTIFY = { fail: 'only when a task fails', every: 'after every task', never: 'never' };
  const dayOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  // what Edit… may change through the adapter: dev's PATCH takes a schedule's times; its words are the demo's until dev takes them
  const canEdit = (field) => !LIVE() || ['every', 'at', 'date'].includes(field);
  // F-G-fid-03: a series in a zone other than this browser's names it beside its time, as its card does (centers.js schedCard)
  const zoneWord = (s) => (LIVE() && s.tz && s.tz !== Intl.DateTimeFormat().resolvedOptions().timeZone ? ` ${esc(s.tz)}` : '');
  // the library's form parts, by name once the index exports them (field.mjs attaches them to Field until then)
  const F = { value: R.fieldValue, grid: R.formGrid, readback: R.formReadback };
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  const dayWords = (d) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '');
  const repeatWords = (e) => (e === 'every weekday' ? 'weekdays' : e === 'every weekend' ? 'at weekends' : e);
  // the one sentence of a schedule's page: how it runs and when next, read back from its facts
  function readback(s) {
    if (s.ended) return `It ran ${repeatWords(s.every)}${s.at ? ` at ${s.at}` : ''} and has ended: it runs no more.`;
    if (s.after) return `Runs once, after ${s.after} ends.`;
    const once = s.every === 'Once', next = nextDates(s, 1)[0];
    const future = next && Number.isFinite(next.getTime()) && (!once || next.getTime() > Date.now());
    const runs = once ? `Runs once${future ? `, on ${dayWords(next)} at ${s.at}` : ''}` : s.every === 'every hour' ? 'Runs every hour' : `Runs ${repeatWords(s.every)} at ${s.at}${zoneWord(s)}`;
    if (once) return future ? `${runs}.` : `${runs}. Its time has passed.`;
    return s.state === 'paused' ? `${runs} · paused, so nothing is next` : `${runs}${future && s.every !== 'every hour' ? ` · next ${dayWords(next)}, ${s.at}` : ''}${s.skip ? ' · skips the next one' : ''}`;
  }
  function pageHtml(s) {
    const dayOfRun = Object.fromEntries(R.DAY_SECTIONS), cards = R.DAY_SECTIONS.flatMap(([d]) => s.runs.filter((r) => r.day === d)).map((r) => runCard(r, dayOfRun[r.day], s)).join('');   // one stream, newest first, as a chat's
    const paused = s.state === 'paused', once = s.every === 'Once', running = isRunning(s);
    // an inspect view: every fact is a label over its value, in a fixed place; nothing here is a control
    const v = (label, value, hint) => F.value({ label, value: value || 'Not set', hint });
    const fails = Number.isFinite(s.fails) ? s.fails : 3, missed = s.ifMissed || 'run', grace = graceOf(s);
    const when = s.after ? v('Runs after', s.after) : s.every === 'every hour' ? '<span></span>' : once && Number.isFinite(s.nextAt) ? v('Date and time', `${dayWords(new Date(s.nextAt))}, ${s.at}`) : v('At', `${s.at}${zoneWord(s)}`);
    const expert = R.shows('expert') && !once ? [
      v('While one still runs', cap(OVERLAP[s.overlap || 'skip'])), v('When tasks fail', cap(failsWord(fails))),
      v('A missed time', cap(MISSED[missed])), missed === 'run' ? v('How late it may start', cap(GRACE[grace] || `at most ${grace} minutes late`)) : '<span></span>',
      v('Stop after', cap(s.ends || 'no end date')), v('Notify', cap(NOTIFY[s.notify] || NOTIFY.fail)),
    ] : [];
    const facts = F.grid({ fields: [{ html: v('What it does', s.what), wide: true }, v('Repeats', once ? 'Once' : cap(s.every)), when,
      v('Project', s.project || 'No project'), v('Workflow', s.workflow && s.workflow !== 'Default' ? s.workflow : 'Default workflow'),
      v('Engine and model', s.agent || 'The project\'s default engine'), s.preset ? v('Preset', s.preset === 'preset deleted' ? 'Preset deleted' : s.preset) : '<span></span>', ...expert] });
    // the head's controls respond to what exists: its running task, its times, its next time; a change is asked for in its chat
    // the button ladder: ONE default action for the state (Run now when a time was missed, Resume when paused); the others are quiet
    const missedNow = s.section === 'needs' && !running;
    const btn = (label, hook, title, lead = false) => R.button({ label, kind: lead ? '' : 'quiet', attrs: { ...hook, title } });
    const skip = skipItem(s);
    const action = s.ended ? '' : [
      running ? btn('Stop', { 'data-sched-stop': s.id }, 'Stops the task that is running; the schedule keeps its times') : btn('Run now', { 'data-sched-now': s.id }, paused ? 'Starts a task now; it stays paused after' : missedNow ? 'Starts a task now to catch up; the schedule keeps its times' : 'Starts a task now; the schedule keeps its times', missedNow),
      once ? '' : paused ? btn('Resume', { 'data-sched-resume': s.id }, 'Runs at its times again', true) : btn('Pause', { 'data-sched-pause': s.id }, 'Skips its times until you resume it'),
      once || paused ? '' : btn(skip.text, { 'data-sched-skip': s.id }, skip.help),
    ].join('');
    const change = s.ended ? '' : btn('Change in its chat', { 'data-sched-chat': s.id }, 'Opens its chat with its form; the change is proposed there before it applies');
    // the state head follows the alert ladder as a task's does: a missed time, or a task of its that waits on you, is a Caution
    const level = missedNow || waitsOnYou(s) ? 'act' : '';
    const items = [{ id: 'in-view', text: window.StillhetShell?.inView.has('schedule', s.id) ? 'Out of view' : 'Keep in view', help: 'Its mark in the top bar, on every page' }, { sep: true }, { id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }];
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ center: { label: 'Schedules', to: 'schedules' }, title: s.title, actions: change, facts: `${esc(s.project || 'No project')} · ${esc(flowWord(s))}${(s.labels || []).map((l) => R.chip({ text: l })).join('')}`, mark: R.kindMark({ kind: 'schedule', tone: level || toneOf(s), title: word(s) }), tone: level, word: word(s), why: `${why(s)}${s.chat ? ' · from a chat' : ''}`,   /* the word already says it */ action, menu: R.moreMenu({ id: 'sc-more', label: `More for ${s.title}`, icon: R.icon('more', 16), open: menu === 'sc-more', items }) })}
      <div class="sched-form">${facts}${F.readback(readback(s))}</div>
      ${cards || (missedNow ? '' : R.emptyState({ title: 'It has not run yet.' }))}
    </div></div></div>`;   // no chat box here (a schedule's page is for inspecting): "Change in its chat" in its head leads there
  }
  // Change in its chat: its chat, with its form open (the live kind: its chat with the schedule in focus, or Chat's composer with the schedule as its chip)
  function toChat(s) {
    // stillhet.chat-first: the page has no edit form of its own. Its chat opens with the schedule's form; what you save
    // there is proposed in the chat and applies on Apply (panel.schedule-change). A schedule with no chat gets one.
    const C = window.StillhetConversation, cid = !LIVE() && C?.scheduleChat ? C.scheduleChat(s.id, { make: true }) : '';
    if (cid) {
      const form = () => { window.StillhetCenters?.editSchedule?.(s.id, { chat: cid }); };
      if (location.hash === `#chat/${cid}`) form(); else { addEventListener('hashchange', () => setTimeout(form, 0), { once: true }); window.StillhetShell.go(`chat/${cid}`); }
      return;
    }
    if (s.chat) { window.StillhetShell.go(`chat/${s.chat}`); requestAnimationFrame(() => requestAnimationFrame(() => window.StillhetConversation?.focus?.({ id: s.id }))); return; }
    window.StillhetConversation?.handOver?.({ mode: 'ask', about: { kind: 'Schedule', name: s.title }, ph: `What should change in ${s.title}?`, project: s.project || undefined });
  }
  function draw() {
    ctl.paint();
    const s = byId(current);
    if (!s && current && LIVE() && window.StillhetDemoState?.list === 'loading') { page.innerHTML = R.listState({ state: 'loading', noun: 'this schedule' }); return; }   // F-G-fid-01: a fresh load waits for the first read
    if (!s) { window.StillhetCenters?.schedules(page); return; }
    page.innerHTML = pageHtml(s);
  }
  // the chat's schedule row and card read the same schedule: a time changed here is the bar's time too
  function follow(s) {
    const c = s.chat && window.StillhetChats?.data().chats.find((x) => x.id === s.chat), t = c?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
    if (t) { t.time = s.state === 'paused' ? 'Paused' : s.time; t.detail = s.state === 'paused' ? 'Paused by you' : `${R.scheduleWords(s).says} · ${s.next}`; window.StillhetChats.refresh(); }
    const wid = `sch-${s.id}`; if (s.state !== 'paused' && window.StillhetWorld?.find(wid)) window.StillhetWorld.move(wid, 'scheduled', R.scheduleWords(s).says, { time: R.scheduleWords(s).time, when: whenOf(s) });   // Pulse's Scheduled too
    ctl.paint();
  }
  // Delete (D8): the row leaves at once and the notice offers Undo; the one DELETE goes when the notice ends, when another
  // notice replaces it, or when the page closes. A refused DELETE brings the row back and says why.
  // the one-offs that wait for it (dev's dependents): its notice names them, as dev's Cancel confirm does
  function waitersNote(s) {
    const w = list().filter((x) => x.id !== s.id && x.afterRef?.id === s.id).map((x) => `“${x.title}”`);
    return w.length ? ` · ${w.slice(0, 4).join(', ')}${w.length > 4 ? ` and ${w.length - 4} more` : ''} ${w.length === 1 ? 'was' : 'were'} waiting for it` : '';   // what happened, as the notice's "Deleted" says it
  }
  function remove(s) {
    const onIt = current === s.id && location.hash === `#schedule/${s.id}`, note = waitersNote(s);
    if (LIVE()) {
      gone.add(s.id); if (current === s.id) current = '';
      say(`Deleted ${s.title}${note}`, () => { h.undo(); gone.delete(s.id); draw(); window.StillhetConversation?.refresh(); });   // said first: the next notice is what flushes a waiting Delete
      const h = SL().deferDelete(s.id);
      h.done.then((r) => { if (r && r.ok === false) { gone.delete(s.id); draw(); window.StillhetConversation?.refresh(); say(`Could not delete ${s.title}: ${r.error}`); } });
      if (onIt) window.StillhetShell.go('schedules'); draw(); window.StillhetConversation?.refresh(); return;   // its Chat card reads Deleted
    }
    const i = data.schedules.indexOf(s), c = s.chat && window.StillhetChats?.data().chats.find((x) => x.id === s.chat), row = c?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
    data.schedules.splice(i, 1); if (current === s.id) current = ''; window.StillhetWorld?.remove(`sch-${s.id}`); if (row) { row.time = 'Deleted'; row.detail = 'Deleted · the tasks it ran stay'; row.gone = true; window.StillhetChats.refresh(); }
    say(`Deleted ${s.title}${note}`, () => { data.schedules.splice(i, 0, s); if (row) row.gone = false; toStore(); follow(s); draw(); }); if (onIt) window.StillhetShell.go('schedules'); draw();
  }
  function more(s, v) {
    if (v === 'pause') act('pause', [{ _s: s }]);
    if (v === 'run') { runNow(s); return; }
    if (v === 'delete') { remove(s); return; }
    if (v === 'in-view') { window.StillhetShell.inView.toggle({ type: 'schedule', id: s.id, title: s.title }); draw(); return; }
    if (v === 'edit') { window.StillhetCenters?.editSchedule?.(s.id); return; }   // the chat card's Edit… only: nothing on this page or its list offers it
    if (v === 'stop') {
      const r = runningRun(s); if (!r) return;
      if (LIVE()) { live('stop', s, { pipelineId: window.StillhetChatLive?.runOf?.(r.wid)?.pipelineId || r.wid }, `Stopped ${s.title}; the schedule keeps its times`); return; }
      r.case = 'stopped'; r.meta = 'Stopped by you'; window.StillhetWorld?.move(r.wid, 'stopped', 'Stopped by you'); draw(); say(`Stopped ${s.title}; the schedule keeps its times`); return;
    }
    if (v === 'skip') {
      if (s.state === 'paused') return;
      if (LIVE()) { if (s.skip) live('keep', s, {}, `${s.title} runs next time after all`); else live('skip', s, {}, `${s.title} skips next time`); return; }
      if (s.skip) { s.next = s.skip; s.skip = ''; say(`${s.title} runs next time after all`); } else { s.skip = s.next; s.next = s.section === 'needs' ? `${s.next} · skips next time` : 'Skips next time, then as usual'; say(`${s.title} skips next time`); }
    }
    follow(s); draw();
  }
  page.addEventListener('click', (e) => {
    const on = (q) => e.target.closest(q); let hit;
    const s = byId(current);
    if ((hit = on('[data-sched-run]'))) { if (s) openRun(s, s.runs[+hit.dataset.schedRun]); return; }
    // a button that waits on the server is busy with what it is doing until the answer is in (comp.button-busy)
    if ((hit = on('[data-sched-now]'))) { if (s) R.busy(hit, { label: 'Starting…', until: answered().then(() => runNow(s)) }); return; }
    if ((hit = on('[data-sched-stop]'))) { if (s) R.busy(hit, { label: 'Stopping…', until: answered().then(() => more(s, 'stop')) }); return; }
    if ((hit = on('[data-sched-resume]'))) { if (s) R.busy(hit, { label: 'Resuming…', until: answered().then(() => act('pause', [{ _s: s }])) }); return; }
    if ((hit = on('[data-sched-pause]'))) { if (s) R.busy(hit, { label: 'Pausing…', until: answered().then(() => act('pause', [{ _s: s }])) }); return; }
    if ((hit = on('[data-sched-skip]'))) { if (s) R.busy(hit, { label: s.skip ? 'Keeping…' : 'Skipping…', until: answered().then(() => more(s, 'skip')) }); return; }
    if (on('[data-sched-chat]')) { if (s) toChat(s); return; }
    if ((hit = on('[data-sched-ticket]'))) {
      const [tid, how] = hit.dataset.schedTicket.split('|'), r = s?.runs.find((x) => x.wid === tid); if (!s || !r) return;
      if (how === 'project') { window.StillhetShell.go(s.project ? `projects/${projectKeyOf(s.project)}` : 'projects'); return; }
      if (LIVE()) { live('run', { id: tid, title: r.title }, {}, `Started ${r.title} now`); return; }
      r.case = 'working'; r.meta = liveWord; draw(); say(`Started ${r.title} now`); return;
    }
    if (on('[data-sched-new]')) { window.StillhetConversation?.start('schedule'); return; }
    if ((hit = on('[data-menu-pick]'))) {
      const [id, v] = hit.dataset.menuPick.split('|'); if (!id.startsWith('sc-')) return;   // the composer's picks are the composer's
      menu = '';
      if (!s) return;
      if (id === 'sc-more') { draw(); more(s, v); return; }   // the menu closes now; live, what it did shows on the server's frame
      draw(); return;
    }
    if ((hit = on('[data-menu^="sc-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
  });
  page.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); const m = menu; menu = ''; draw(); page.querySelector(`[data-menu="${m}"]`)?.focus(); } });   // Esc closes the open ⋯, back on its button
  R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-schedule .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  R.prefs.onChange(() => { if (!page.hidden) draw(); });
  window.StillhetWorld?.onMove(() => { if (!bar.hidden) ctl.paint(); });
  // the live kind: a load replaced them (D9), a frame confirmed a Delete, or a schedule's runs were read; a draft stays over the new values
  const reload = () => { data = M.seed(); for (const id of [...gone]) if (!data.schedules.some((s) => s.id === id)) gone.delete(id); ctl.paint(); if (!page.hidden) draw(); };
  let heard = false;   // StillhetScheduleLive starts after the pages load (adapter.js): it is heard from its first store load on
  if (window.StillhetWorld?.live) window.StillhetWorld.onChange(() => { if (!heard && SL()?.onChange) { heard = true; SL().onChange(reload); } reload(); });
  const sOf = (id) => byId(id);
  // Edit…'s Save: { title?, what?, every?, at?, date? }. The demo applies it; the live kind sends what dev's PATCH takes and
  // answers { ok, error } so the form can say a refusal.
  async function edit(id, patch) {
    const s = sOf(id); if (!s) return { ok: false, error: 'that schedule is gone' };
    const once = s.every === 'Once';
    if (LIVE()) {
      if (!('every' in patch) && !('at' in patch) && !('date' in patch)) return { ok: false, error: 'only its times can be changed here yet' };
      const at = new Date(patch.date ? `${patch.date}T00:00:00` : s.nextAt || Date.now()), [h, m] = String(patch.at || s.at).split(':').map(Number); at.setHours(h, m, 0, 0);
      const draft = once ? { scheduledFor: at.toISOString() } : { every: patch.every || s.every, at: patch.at || s.at, tz: s.tz || Intl.DateTimeFormat().resolvedOptions().timeZone, rule: s.rule || null, onlyAt: !patch.every || patch.every === s.every };
      const r = await SL().act('save', { id: s.id, kind: once ? 'once' : 'recurring', draft });
      return r && r.ok ? { ok: true } : { ok: false, error: r?.error || 'no answer' };
    }
    const chat = s.chat && window.StillhetChats?.data().chats.find((x) => x.id === s.chat), row = chat?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
    if (patch.title) { s.title = patch.title; if (row) row.title = patch.title; const w = window.StillhetWorld?.find(`sch-${s.id}`); if (w) w.title = patch.title; }
    if (patch.what) s.what = patch.what;
    if (patch.at) s.at = patch.at;
    if (patch.every && !once && patch.every !== 'once') s.every = patch.every;
    if (once && (patch.date || patch.at)) { const d = new Date(`${patch.date || dayOf(new Date(s.nextAt || Date.now()))}T${s.at}:00`); if (Number.isFinite(d.getTime())) { s.nextAt = d.getTime(); s.next = `Next ${dateWord(d)} at ${s.at}`; } }
    else { const w = R.scheduleWords({ every: s.every, at: s.at, nowAt: nowAt() }); Object.assign(s, { time: w.time, day: w.day }); if (s.section === 'next' && !s.skip) s.next = w.next; }
    follow(s); draw();
    return { ok: true };
  }
  window.StillhetSchedules = { all: list, showing: () => view.show,
    // the bar's view, read by the Schedules page so bar and page show the same schedules: { show, from, by }; `shows(s, show)`
    // is the Show rule itself, and `narrow(project)` sets the bar's Project ('' clears it)
    view: () => ({ ...view }), shows, narrow: (project = '') => { view = { ...view, from: project || '' }; ctl.paint(); if (!current) window.StillhetCenters?.schedules(page); }, get TODAY() { return M.TODAY; }, nextDates, nextLine, dateWord, runningRun, openRun, find: sOf,
    add: (s) => { const w = R.scheduleWords(s); Object.assign(s, { day: w.day, time: w.time }); data.schedules.unshift(s); toStore(); ctl.paint(); } /* the demo's New schedule; live, the server's frame lists it */,
    act: (id, v) => { const s = sOf(id); if (s && v) more(s, v); }, running: (id) => { const s = sOf(id); return !!s && isRunning(s); },
    // the one source every surface reads (page, center card, bar row, chat card, Pulse): its word, why it stands there, its skip item
    wordOf: (id) => { const s = sOf(id); return s ? word(s) : ''; }, nextOf: (id) => { const s = sOf(id); return s ? why(s) : ''; },
    skipItem: (id) => { const s = sOf(id); return s ? skipItem(s) : { text: 'Skip next time' }; }, show: (id) => { if (!id) window.StillhetCenters?.visit?.('sched'); current = id || ''; draw(); },
    canEdit, edit,   // Edit…'s Save (centers.js editSchedule): what it may change, and the change itself
    summary: () => ({ n: list().filter((s) => s.state !== 'paused' && !s.ended).length, needs: list().filter((s) => s.section === 'needs').length }) };
})();
