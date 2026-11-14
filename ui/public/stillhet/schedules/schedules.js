// Schedules (Expert): the list in the one bar, and a schedule's page, read like a chat: its head, each time it ran as a task
// by day, a failure opened, and a composer whose question goes to its chat.
// One code path for both kinds (Schedules D5): the demo kind acts on its seed; the live kind sends each action through
// RailScheduleLive (live/schedule-live.mjs) and changes nothing until the server's frame reloads the store. Edits are
// drafts (rail.drafts, RailDrafts); Delete waits out its Undo window before it is sent (D8).
(function () {
  const R = window.RailUI, M = window.SchedulesModel, RM = window.RunCardModel;
  const bar = document.getElementById('bar-schedules'), page = document.getElementById('route-schedule');
  if (!bar || !page) return;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const whenOf = (s) => (s.day === 'today' ? 'today' : s.day === 'week' ? 'week' : 'tomorrow');
  const LIVE = () => !!window.RailWorld?.live, SL = () => window.RailScheduleLive, D = () => window.RailDrafts;
  let data = M.seed(); /* the schedules that wait to run are in the one store too, so Pulse's Scheduled lists the same ones */
  const gone = new Set();   // live: a Delete inside its Undo window, hidden here until the server's frame drops it (D8)
  const list = () => data.schedules.filter((s) => !gone.has(s.id));
  const byId = (id) => list().find((s) => s.id === id);
  // each started run is a task in the one store, in its project (panel.task-truth); a time not started is a ticket: Pulse lists it, Tasks does not, and a missed one needs you
  const missedWords = (s) => `Missed ${s.missed} · ${s.missedWhy}`;
  const ticketOf = (s) => (s.section === 'needs' ? { case: 'ticket-missed', detail: missedWords(s), missed: true } : { case: 'scheduled', detail: R.scheduleWords(s).says, missed: false });
  const toStore = () => { const W = window.RailWorld; if (!W || W.live) return;   /* the live kind's store already holds them (live/live-map.mjs) */ for (const s of data.schedules) {
    if (s.state !== 'paused' && !s.ended && !W.find(`sch-${s.id}`)) W.add({ id: `sch-${s.id}`, ...ticketOf(s), ticket: s.id, title: s.title, project: s.project || '', time: s.at, day: 'upcoming', when: whenOf(s) });
    s.runs.forEach((r, i) => { r.wid ||= `sr-${s.id}-${i}`; if (!W.find(r.wid)) W.add({ id: r.wid, case: r.case, title: r.title, project: s.project || '', detail: r.meta, time: r.time || 'now', day: r.day, schedule: s.id, cost: s.cost, over: !!r.over, workflow: s.workflow || 'Default' }); }); } };
  toStore(); window.RailWorld?.onChange(toStore);
  let current = '', view = { show: 'all', by: R.BY_DEFAULT }, ctl = null, menu = '';
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const st = (s) => R.runState(s.state === 'ended' ? 'scheduled' : s.state), toneOf = (s) => (isRunning(s) ? 'run' : s.ended || s.state === 'scheduled' ? 'idle' : R.markTone(st(s)));
  // one word for where a schedule stands, on its page, its card, its row, its chat card and Pulse (wordOf below)
  const word = (s) => (isRunning(s) ? R.runState('working').word : s.ended ? 'Ended' : s.section === 'needs' ? 'Missed' : s.state === 'paused' ? R.runState('paused').word : 'Next up');
  const SECTIONS = [['needs', R.runState('question').word], ['running', 'Running'], ['next', 'Next up'], ['paused', R.runState('paused').word], ['ended', 'Ended']];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], dateWord = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  // live: the server's next time first (nextAt, live-map.mjs), which already skips a skipped one; a once-ticket has no time after it
  const nextDates = (s, n = 1) => { if (!Number.isFinite(s.nextAt)) return R.scheduleDates({ every: s.every, at: s.at, from: M.TODAY, n }); const first = new Date(s.nextAt), after = new Date(first); after.setDate(after.getDate() + 1); return [first, ...(s.every === 'Once' ? [] : R.scheduleDates({ every: s.every, at: s.at, from: after, n: n - 1, nowAt: '' }))]; };
  const nextDate = (s) => { const d = nextDates(s, 2); return Number.isFinite(s.nextAt) ? d[0] : d[s.skip ? 1 : 0] || d[0]; };   // a skipped time moves it to the one after
  const nextWord = (s) => (s.every === 'every hour' ? 'Within the hour' : dateWord(nextDate(s)));
  // when it next runs, in dates: its card and its page's head say the same
  const nextLine = (s) => { const [d1] = nextDates(s, 1).map(dateWord); return s.after ? `after ${s.after}` : s.every === 'every hour' ? (s.skip ? 'skips the next one' : 'within the hour') : s.skip ? 'Skips next time, then as usual' : `${d1}, ${s.at}`; };
  // why it stands where it does, next to its word: the same on its page, its card, its chat card and its row (nextOf below)
  const why = (s) => (isRunning(s) ? `for ${!runningRun(s).time || runningRun(s).time === 'now' ? 'a moment' : runningRun(s).time}` : s.ended ? '' : s.section === 'next' ? nextLine(s) : s.state === 'paused' ? s.pauseWhy || s.next.replace(/^Paused ?/, '') || 'by you' : s.next.replace(/^(Missed|Next) /, ''));
  const sectionNow = (s) => (s.section !== 'needs' && isRunning(s) ? 'running' : s.section);   // a run under way moves it, a paused one's too, and its end leaves it where it was
  const menuItems = (s) => (s.ended ? [{ id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }]
    : [{ id: 'run', text: 'Run now', off: isRunning(s), help: isRunning(s) ? 'Its task is running; it can start again when that ends' : 'Starts a task now; the schedule keeps its times' }, { id: 'in-view', text: window.RailShell?.inView.has('schedule', s.id) ? 'Out of view' : 'Keep in view', help: 'Its mark in the top bar, on every page' }, ...(afterItem(s) ? [afterItem(s)] : []), ...(s.every === 'Once' ? [] : [{ id: 'pause', text: s.state === 'paused' ? 'Resume' : 'Pause', help: s.state === 'paused' ? 'It runs at its next time again' : 'It stops starting tasks until you resume it' }, { id: 'skip', ...skipItem(s) }]), { sep: true }, { id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }]);
  const rowOf = (s) => ({ key: `sched:${s.id}`, _s: s, title: s.title, meta: '', mark: R.kindMark({ breathe: s.id !== current, kind: 'schedule', tone: toneOf(s), title: `${word(s)} · ${s.ended ? 'Ended' : s.next}` }), end: sectionNow(s) === 'running' ? (runningRun(s)?.time || 'now') : sectionNow(s) === 'needs' ? 'Missed' : s.state === 'paused' || s.ended ? '' : s.time, current: s.id === current, tip: `${s.title}\n${s.project || 'No project'} · ${s.chat ? 'from a chat' : 'no chat'}\nRuns ${s.ended ? 'no more' : R.scheduleWords(s).runs} · ${s.ended ? 'Ended' : s.next}`,
    menu: menuItems(s) });
  // Run now is one thing wherever you press it: a real task in the one store, on this schedule's page, and in its chat
  const liveWord = 'Plan · writing the plan';
  function runningRun(s) { const W = window.RailWorld; return s.runs.find((r) => { const w = r.wid && W?.find(r.wid); return w && W.section(w) === 'running'; }); }
  function isRunning(s) { return !!runningRun(s); }
  // the live kind (D5): one request through RailScheduleLive; nothing here moves until its frame reloads the store
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
    window.RailWorld?.add({ id: wid, case: 'working', title: s.title, project: s.project || '', detail: liveWord, time: 'now', day: 'today' });
    const c = s.chat && window.RailChats?.data().chats.find((x) => x.id === s.chat);
    if (c) { const t = { id: `t${k}`, run: wid, title: s.title, ask: s.title, case: 'working', stage: 0, git: 'branch', detail: liveWord }; c.tasks = [...(c.tasks || []), t]; window.RailConversation?.join(c, { t: 'task', id: `k${k}`, task: t.id }); window.RailChats.refresh(); }
    if (s.section === 'needs') { s.section = 'next'; s.state = 'scheduled'; s.next = R.scheduleWords(s).next; delete s.missed; window.RailWorld?.move(`sch-${s.id}`, 'scheduled', R.scheduleWords(s).says, { missed: false, day: 'upcoming', time: s.at, when: whenOf(s) }); }   // run now was the catching up
    draw(); say(`Started ${s.title}; the schedule keeps its times`);
  }
  // a one-off still to come can have a task wait for it (dev's Schedule next…): the New task form, starting after it
  const afterItem = (s) => (s.every === 'Once' && !s.ended && s.section === 'next' ? { id: 'after', text: 'Run after this', help: 'A new task that starts once this one ends' } : null);
  const skipItem = (s) => (s.state === 'paused' ? { text: 'Skip next time', off: true, help: 'It is paused: nothing is coming to skip' } : s.skip ? { text: 'Keep next time', help: 'It runs next time after all' } : { text: 'Skip next time', help: 'Only the next one; the times stay' });
  function act(id, rows) {
    const s = rows[0]?._s; if (!s) return;
    if (id === 'in-view') { window.RailShell.inView.toggle({ type: 'schedule', id: s.id, title: s.title }); draw(); return; }
    if (id === 'run') { runNow(s); return; }
    if (id === 'skip' || id === 'delete' || id === 'after') { more(s, id); return; }
    if (id === 'pause') {
      if (LIVE()) { const on = s.state === 'paused'; live(on ? 'resume' : 'pause', s, {}, on ? `Resumed ${s.title}` : `Paused ${s.title}`); return; }
      const W = window.RailWorld, wid = `sch-${s.id}`; if (W?.find(wid)) W.move(wid, s.state === 'paused' ? 'scheduled' : 'stopped', s.state === 'paused' ? R.scheduleWords(s).next : 'Paused by you', { missed: false });   // Pulse hears it: a paused time no longer needs you
      s.state = s.state === 'paused' ? 'scheduled' : 'paused'; s.section = s.state === 'paused' ? 'paused' : 'next'; s.next = s.state === 'paused' ? 'Paused by you' : R.scheduleWords(s).next; s.day = R.scheduleWords(s).day; s.skip = ''; toStore(); follow(s); draw(); say(s.state === 'paused' ? `Paused ${s.title}` : `Resumed ${s.title}`); }
  }
  ctl = R.listController({ root: bar, spec: { noun: 'schedules', label: 'Selected schedules', view: () => ({ state: 'ready',
    parts: [{ word: 'Showing', id: 'show', text: view.show, tip: 'Which schedules the list shows', items: ['all', 'paused', 'drafts'].map((x) => ({ id: x, text: x, checked: view.show === x })) },
      R.byPart({ by: view.by, choices: [{ id: 'day', help: 'By the next run: Today, Tomorrow, This week, Later; paused ones last' }, { id: 'state', help: `${SECTIONS.map(([, t]) => t).join(', ')}` }] })],
    sections: sections(), empty: { text: view.show === 'drafts' ? 'No drafts.' : 'No schedules yet.', action: 'New schedule' } }),
    can: () => ['menu'], bulk: () => [], act, open: (r) => window.RailShell.openSchedule(r._s.id), word: (id, v) => { view = { ...view, [id]: v }; if (!current) window.RailCenters?.schedules(page); return false; }, say,
    active: () => /^#schedule/.test(location.hash) && !document.querySelector('.pz-popover, .keys-modal, #app .viewer-modal, #app .nav-fly'), emptyAct: () => window.RailConversation?.start('schedule') } });
  // Showing drafts lists only the schedules with a draft (rail.drafts: Drafts in the bar lists every one)
  const showing = (s) => view.show === 'all' || (view.show === 'paused' ? s.state === 'paused' : !!D()?.get(`schedule:${s.id}`));
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
    return R.taskCard({ title: r.title, mark: runMark(r), word: `${st.word} · ${day}`, detail: r.meta === st.word ? '' : r.meta, place: tone === 'merged' ? '' : R.gitMark({ status: r.git, title: r.meta }), rows: why, stages: R.stageBar({ labels: STAGES, stage: r.stage, tone, step: R.stageStep(r.meta), key: r.wid ? `t-${r.wid}` : '' }), action: ticketActs(r, s) || R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-sched-run': String(s.runs.indexOf(r)), title: 'Opens this task in its chat' } }) }); };
  // a fire that never started (run-state.mjs ticket-missed, ticket-failed): Start now is the ticket's own run-now; a failed one's Open project opens its project's page (D16)
  const ticketActs = (r, s) => (!/^ticket-(missed|failed)$/.test(r.case) ? '' : R.button({ label: 'Start now', kind: 'quiet', attrs: { 'data-sched-ticket': `${r.wid}|now`, title: 'Starts this one now; the schedule keeps its times' } })
    + (r.case === 'ticket-failed' ? R.button({ label: 'Open project', kind: 'quiet', attrs: { 'data-sched-ticket': `${r.wid}|project`, title: `Opens ${s.project || 'its project'}` } }) : ''));
  const projectKeyOf = (name) => { const W = window.RailWorld, ps = (W?.part?.('projects') || W?.data?.().projects || []); return (ps.find((p) => p && (p.name === name || p.id === name))?.id) || name; };
  // a task this schedule ran opens in its chat, as a card there: the schedule's chat, or one of its own; live, its own task page
  function openRun(s, r) {
    if (LIVE()) { if (r.wid && window.RailWorld?.find(r.wid)) window.RailShell.go(`run/${r.wid}`); else say(`${r.title} never started: ${r.meta || 'its ticket says why'}`); return; }
    const chats = () => window.RailChats.data().chats;
    let cid = s.chat || r.chat;
    if (!cid) { cid = r.chat = window.RailChats.newChat(r.title, s.project || '', { fromTask: true }); say(`Opened in a new chat: ${r.title}`); }
    if (!r.tid) {
      const c = chats().find((x) => x.id === cid), k = `${s.id}-${s.runs.indexOf(r)}`;
      r.wid ||= `sr-${k}`; r.tid = `t-${r.wid}`;
      c.tasks = [...(c.tasks || []), { id: r.tid, run: r.wid, title: r.title, ask: r.title, case: r.case, stage: r.stage, git: r.git, detail: r.meta }];
      window.RailConversation?.join(c, { t: 'task', id: `k-${r.wid}`, task: r.tid }); window.RailChats.refresh();
    }
    window.RailShell.openTask(r.case, cid, r.title, r.wid);
  }
  // the question under a schedule goes to its chat with the schedule as its chip, on its project; Enter sends
  function dockSend(host, s) {
    const send = () => {
      const box = host.querySelector('[data-composer-t]'), text = box.value.trim();
      if (!text) { box.focus(); say('Say what to ask first'); return; }
      if (LIVE()) { window.RailConversation?.handOver?.({ mode: 'ask', about: { kind: 'Schedule', name: s.title }, text, project: s.project || undefined }); return; }   // live: Chat sends it (rail.hand-to-chat; the live chat owns the threads)
      const id = s.chat || window.RailChats.newChat(`About ${s.title}`, s.project || ''), c = window.RailChats.data().chats.find((x) => x.id === id), k = Date.now().toString(36);
      window.RailConversation.join(c, { t: 'you', id: `y${k}`, text, when: 'now', refs: [], files: [`Schedule · ${s.title}`] });
      window.RailConversation.join(c, { t: 'words', html: `Looking at <b>${esc(s.title)}</b>.` });
      window.RailChats.refresh(); window.RailShell.go(`chat/${id}`);
    };
    host.addEventListener('click', (e) => { if (e.target.closest('[data-dock-send]')) { e.stopPropagation(); send(); } }, true);
    host.addEventListener('submit', (e) => { e.stopPropagation(); e.preventDefault(); send(); }, true);
    host.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches('[data-composer-t]')) { e.preventDefault(); send(); } });
  }
  // ---- drafts (rail.drafts, D6): a picker changes the draft, never the schedule; Save sends it, Discard drops it ----
  const OVERLAP = { skip: 'skip if still going', queue: 'queue if still going', start: 'start another if still going' };
  const MISSED = { run: 'run late if missed', skip: 'skip if missed' };
  const failsWord = (n) => (n === 0 ? 'never pause' : `pause after ${n} failures`);
  // how late a missed time may still start (dev's grace window, minutes), when a missed time runs late
  const GRACE = { 30: 'at most 30 minutes late', 60: 'at most 1 hour late', 120: 'at most 2 hours late', 360: 'at most 6 hours late', 720: 'at most 12 hours late', 1440: 'at most a day late' };
  const graceOf = (s) => (Number.isFinite(s.grace) ? s.grace : 360);
  const graceWords = (g) => (GRACE[g] ? GRACE : { ...GRACE, [g]: `at most ${g} minutes late` });
  const refKey = (ref) => (ref && ref.id ? `${ref.kind || 'ticket'}:${ref.id}` : '');
  // what a one-off can wait for: the other one-offs still to come in its project, and its project's running tasks (dev's after-candidates)
  function afterChoices(s) {
    const W = window.RailWorld, mine = refKey(s.afterRef);
    const tickets = list().filter((x) => x.id !== s.id && x.every === 'Once' && !x.ended && x.section === 'next' && (x.project || '') === (s.project || '') && x.afterRef?.id !== s.id).map((x) => ({ id: `ticket:${x.id}`, text: x.title }));
    const tasks = (W?.tops?.() || []).filter((t) => t && (t.project || '') === (s.project || '') && W.section(t) === 'running').map((t) => ({ id: `pipeline:${t.id}`, text: t.title }));
    const all = [...tickets, ...tasks];
    return mine && !all.some((x) => x.id === mine) ? [{ id: mine, text: s.after || 'the run before it' }, ...all] : all;
  }
  const FAILS = [1, 2, 3, 5, 10, 0];
  const keyOf = (s) => `schedule:${s.id}`;
  const saved = (s) => ({ every: s.every, at: s.at, overlap: s.overlap || 'skip', fails: Number.isFinite(s.fails) ? s.fails : 3, ifMissed: s.ifMissed || 'run', grace: graceOf(s), afterRef: refKey(s.afterRef) });
  const shown = (s) => ({ ...s, ...(D()?.get(keyOf(s))?.fields || {}) });   // the page draws the draft over the saved schedule
  function touch(s, field, v) { D()?.touch(keyOf(s), saved(s), () => ({ [field]: v })); draw(); }
  async function saveDraft(s) {
    const d = D()?.get(keyOf(s)); if (!d) return;
    const x = shown(s);
    if (LIVE()) {
      const once = s.every === 'Once', at = new Date(s.nextAt || Date.now());
      if (once) { const [h, m] = String(x.at).split(':').map(Number); at.setHours(h, m, 0, 0); }
      const [ak, aid] = String(x.afterRef || '').split(':');
      // the saved rule rides along, so the new one keeps its end; a time-only change moves the saved rule's time (schedule-live patchOf)
      const draft = once ? ('afterRef' in d.fields && aid ? { after: { kind: ak, id: aid } } : { scheduledFor: at.toISOString() })
        : { ...(('every' in d.fields || 'at' in d.fields) ? { every: x.every, at: x.at, tz: s.tz || Intl.DateTimeFormat().resolvedOptions().timeZone, rule: s.rule || null, onlyAt: !('every' in d.fields) } : {}),
          ...('overlap' in d.fields ? { overlap: x.overlap } : {}), ...('fails' in d.fields ? { maxFailures: x.fails } : {}), ...('ifMissed' in d.fields ? { ifMissed: x.ifMissed } : {}), ...('grace' in d.fields ? { graceMin: x.grace } : {}) };
      const r = await live('save', s, { kind: once ? 'once' : 'recurring', draft });
      if (!r) return;   // a refused Save keeps the draft
      saving.add(keyOf(s)); say(`Saved ${s.title}`); return;   // the draft stays drawn until the server's frame brings the saved values (R-arch-4)
    }
    Object.assign(s, { every: x.every, at: x.at, overlap: x.overlap, fails: x.fails, ifMissed: x.ifMissed, grace: x.grace });
    if ('afterRef' in d.fields) { const c = afterChoices(s).find((y) => y.id === x.afterRef), [kind, id] = x.afterRef.split(':'); if (c) Object.assign(s, { after: c.text, afterRef: { kind, id, policy: s.afterRef?.policy || 'done' }, next: `after ${c.text}` }); }
    const w = R.scheduleWords(s); Object.assign(s, { time: w.time, day: w.day });
    if (s.section === 'next' && !s.skip) s.next = w.next;   // a paused one and a missed one keep what they say
    D().discard(keyOf(s)); follow(s); draw(); say(s.state === 'paused' ? `It stays paused; once resumed it runs ${w.runs}` : `Saved: runs ${w.runs}`);
  }
  function pageHtml(s0) {
    const s = shown(s0), dayOf = Object.fromEntries(R.DAY_SECTIONS), cards = R.DAY_SECTIONS.flatMap(([d]) => s.runs.filter((r) => r.day === d)).map((r) => runCard(r, dayOf[r.day], s0)).join('');   // one stream, newest first, as a chat's
    const paused = s.state === 'paused', changes = D()?.changes(keyOf(s0)) || 0;
    const pick = (id, text, items) => R.sentencePicker({ id, text, items: items.map((x) => ({ id: x, text: x, checked: x === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    const words = (id, map, v) => R.sentencePicker({ id, text: map[v] || v, items: Object.entries(map).map(([k, t]) => ({ id: k, text: t, checked: k === v })), open: menu === id, chevron: R.icon('chevron', 10) });
    const afterKey = typeof s.afterRef === 'string' ? s.afterRef : refKey(s.afterRef);   // the draft's pick, else the saved one
    const afters = s.after ? afterChoices(s0) : [], afterNow = afters.find((x) => x.id === afterKey)?.text || s0.after;
    const afterPick = () => R.sentencePicker({ id: 'sc-after', text: afterNow, items: afters.map((x) => ({ id: x.id, text: x.text, checked: x.id === afterKey })), open: menu === 'sc-after', chevron: R.icon('chevron', 10) });
    const repeat = s.every === 'Once' ? `Once${s.after ? ` · after ${afterPick()}` : ` at ${pick('sc-at', s.at, R.TIMES_OF_DAY)}`}`
      : s.ended ? `Repeated ${esc(s.every)}${s.at ? ` at ${esc(s.at)}` : ''}`
      : `Repeats ${pick('sc-every', s.every, R.REPEATS.filter((x) => x !== 'once').concat(R.REPEATS.includes(s.every) ? [] : [s.every]))}${s.every === 'every hour' ? '' : ` at ${pick('sc-at', s.at, R.TIMES_OF_DAY)}`}`;
    const preset = s.preset ? ` · ${s.preset === 'preset deleted' ? 'preset deleted' : `from ${esc(s.preset)}`}` : '';
    const expert = R.shows('expert') && s.every !== 'Once' && !s.ended ? R.turnRow({ mark: '', text: `<span class="cmd-s">${words('sc-overlap', OVERLAP, s.overlap || 'skip')} · ${R.sentencePicker({ id: 'sc-fails', text: failsWord(Number.isFinite(s.fails) ? s.fails : 3), items: FAILS.map((n) => ({ id: String(n), text: failsWord(n), checked: n === (Number.isFinite(s.fails) ? s.fails : 3) })), open: menu === 'sc-fails', chevron: R.icon('chevron', 10) })} · ${words('sc-missed', MISSED, s.ifMissed || 'run')}${(s.ifMissed || 'run') === 'run' ? `, ${words('sc-grace', graceWords(s.grace ?? graceOf(s0)), String(s.grace ?? graceOf(s0)))}` : ''}${s.tz ? ` · ${esc(s.tz)}` : ''}</span>` }) : '';
    const action = s.ended ? '' : isRunning(s) ? R.button({ label: 'Stop', attrs: { 'data-sched-stop': s.id, title: 'Stops the task that is running; the schedule keeps its times' } }) : paused ? R.button({ label: 'Resume', attrs: { 'data-sched-resume': s.id, title: 'Runs at its times again' } }) : R.button({ label: 'Run now', attrs: { 'data-sched-now': s.id } });
    const items = s.ended ? menuItems(s) : [afterItem(s), paused ? { id: 'run', text: 'Run now', off: isRunning(s), help: isRunning(s) ? 'Its task is running; it can start again when that ends' : 'Starts a task now; it stays paused after' } : s.every === 'Once' ? null : { id: 'pause', text: 'Pause', help: 'Skips its times until you resume it' }, s.every === 'Once' ? null : { id: 'skip', ...skipItem(s) }, { sep: true }, { id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }].filter(Boolean);
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ center: { label: 'Schedules', to: 'schedules' }, title: s.title, facts: `${esc(s.project || 'No project')} · ${repeat}${preset}${(s.labels || []).map((l) => R.chip({ text: l })).join('')}`, mark: R.kindMark({ kind: 'schedule', tone: toneOf(s0), title: word(s0) }), word: word(s0), why: `${why(s0)}${s.chat ? ' · from a chat' : ''}`,   /* the word already says it */ action, menu: R.moreMenu({ id: 'sc-more', label: `More for ${s.title}`, icon: R.icon('more', 16), open: menu === 'sc-more', items }) })}
      ${changes ? R.draftBar({ changes, hooks: { save: { 'data-sched-save': s.id }, discard: { 'data-sched-discard': s.id } } }) : ''}
      ${expert}
      ${s.agent ? R.turnRow({ mark: '', text: `<span class="cmd-s">${esc(`${s.workflow} workflow, run by ${s.agent}, from ${s.base}, then ${s.then} · ${s.ends}`)}</span>` }) : ''}
      ${cards || R.emptyState({ title: 'It has not run yet.' })}
    </div></div><div class="convo-dock" id="sched-dock"></div></div>`;
  }
  function draw() {
    ctl.paint();
    const s = byId(current);
    if (!s) { window.RailCenters?.schedules(page); return; }
    page.innerHTML = pageHtml(s);
    if (s) { const host = document.getElementById('sched-dock'); window.RailConversation?.dock(host, { kind: 'schedule', title: s.title, chat: s.chat }); dockSend(host, s); }
  }
  // the chat's schedule row and card read the same schedule: a time changed here is the bar's time too
  function follow(s) {
    const c = s.chat && window.RailChats?.data().chats.find((x) => x.id === s.chat), t = c?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
    if (t) { t.time = s.state === 'paused' ? 'Paused' : s.time; t.detail = s.state === 'paused' ? 'Paused by you' : `${R.scheduleWords(s).says} · ${s.next}`; window.RailChats.refresh(); }
    const wid = `sch-${s.id}`; if (s.state !== 'paused' && window.RailWorld?.find(wid)) window.RailWorld.move(wid, 'scheduled', R.scheduleWords(s).says, { time: R.scheduleWords(s).time, when: whenOf(s) });   // Pulse's Scheduled too
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
      say(`Deleted ${s.title}${note}`, () => { h.undo(); gone.delete(s.id); draw(); window.RailConversation?.refresh(); });   // said first: the next notice is what flushes a waiting Delete
      const h = SL().deferDelete(s.id);
      h.done.then((r) => { if (r && r.ok === false) { gone.delete(s.id); draw(); window.RailConversation?.refresh(); say(`Could not delete ${s.title}: ${r.error}`); } });
      if (onIt) window.RailShell.go('schedules'); draw(); window.RailConversation?.refresh(); return;   // its Chat card reads Deleted
    }
    const i = data.schedules.indexOf(s), c = s.chat && window.RailChats?.data().chats.find((x) => x.id === s.chat), row = c?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
    data.schedules.splice(i, 1); if (current === s.id) current = ''; window.RailWorld?.remove(`sch-${s.id}`); if (row) { row.time = 'Deleted'; row.detail = 'Deleted · the tasks it ran stay'; row.gone = true; window.RailChats.refresh(); }
    say(`Deleted ${s.title}${note}`, () => { data.schedules.splice(i, 0, s); if (row) row.gone = false; toStore(); follow(s); draw(); }); if (onIt) window.RailShell.go('schedules'); draw();
  }
  function more(s, v) {
    if (v === 'pause') act('pause', [{ _s: s }]);
    if (v === 'run') { runNow(s); return; }
    if (v === 'delete') { remove(s); return; }
    if (v === 'after') { window.RailCenters?.newTask?.({ after: { kind: 'ticket', id: s.id, title: s.title }, ...(s.project ? { project: s.project } : {}) }); return; }
    if (v === 'stop') {
      const r = runningRun(s); if (!r) return;
      if (LIVE()) { live('stop', s, { pipelineId: window.RailChatLive?.runOf?.(r.wid)?.pipelineId || r.wid }, `Stopped ${s.title}; the schedule keeps its times`); return; }
      r.case = 'stopped'; r.meta = 'Stopped by you'; window.RailWorld?.move(r.wid, 'stopped', 'Stopped by you'); draw(); say(`Stopped ${s.title}; the schedule keeps its times`); return;
    }
    if (v === 'skip') {
      if (s.state === 'paused') return;
      if (LIVE()) { if (s.skip) live('keep', s, {}, `${s.title} runs next time after all`); else live('skip', s, {}, `${s.title} skips next time`); return; }
      if (s.skip) { s.next = s.skip; s.skip = ''; say(`${s.title} runs next time after all`); } else { s.skip = s.next; s.next = s.section === 'needs' ? `${s.next} · skips next time` : 'Skips next time, then as usual'; say(`${s.title} skips next time`); }
    }
    follow(s); draw();
  }
  const PICKS = { 'sc-every': 'every', 'sc-at': 'at', 'sc-overlap': 'overlap', 'sc-fails': 'fails', 'sc-missed': 'ifMissed', 'sc-grace': 'grace', 'sc-after': 'afterRef' };
  page.addEventListener('click', (e) => {
    const on = (q) => e.target.closest(q); let hit;
    const s = byId(current);
    if ((hit = on('[data-sched-run]'))) { if (s) openRun(s, s.runs[+hit.dataset.schedRun]); return; }
    if ((hit = on('[data-sched-now]'))) { if (s) runNow(s); return; }
    if ((hit = on('[data-sched-stop]'))) { if (s) more(s, 'stop'); return; }
    if ((hit = on('[data-sched-resume]'))) { if (s) act('pause', [{ _s: s }]); return; }
    if ((hit = on('[data-sched-ticket]'))) {
      const [tid, how] = hit.dataset.schedTicket.split('|'), r = s?.runs.find((x) => x.wid === tid); if (!s || !r) return;
      if (how === 'project') { window.RailShell.go(s.project ? `projects/${projectKeyOf(s.project)}` : 'projects'); return; }
      if (LIVE()) { live('run', { id: tid, title: r.title }, {}, `Started ${r.title} now`); return; }
      r.case = 'working'; r.meta = liveWord; draw(); say(`Started ${r.title} now`); return;
    }
    if ((hit = on('[data-sched-save]'))) { if (s) saveDraft(s); return; }
    if ((hit = on('[data-sched-discard]'))) { if (s) { D()?.discard(keyOf(s)); draw(); say('Discarded the draft'); } return; }
    if (on('[data-sched-new]')) { window.RailConversation?.start('schedule'); return; }
    if ((hit = on('[data-menu-pick]'))) {
      const [id, v] = hit.dataset.menuPick.split('|'); if (!id.startsWith('sc-')) return;   // the composer's picks are the composer's
      menu = '';
      if (!s) return;
      if (id === 'sc-more') { draw(); more(s, v); return; }   // the menu closes now; live, what it did shows on the server's frame
      const field = PICKS[id]; if (!field) { draw(); return; }
      const value = field === 'fails' || field === 'grace' ? Number(v) : v;
      if (shown(s)[field] === value) { draw(); return; }   // the same value again: nothing changed, nothing to say
      touch(s, field, value); return;
    }
    if ((hit = on('[data-menu^="sc-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
  });
  R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-schedule .spick, #route-schedule .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  R.prefs.onChange(() => { if (!page.hidden) draw(); });
  window.RailWorld?.onMove(() => { if (!bar.hidden) ctl.paint(); });
  // the live kind: a load replaced them (D9), a frame confirmed a Delete, or a schedule's runs were read; a draft stays over the new values
  const saving = new Set();   // drafts a 2xx Save sent: dropped on the frame that reloads the saved schedule
  // a sent draft stays until the store holds what it saved (the schedules-changed reload), not on any other store change
  const landed = (k) => { const s0 = data.schedules.find((x) => keyOf(x) === k), f = D()?.get(k)?.fields || {}; return !s0 || Object.entries(f).every(([kk, v]) => saved(s0)[kk] === v); };
  const reload = () => { data = M.seed(); for (const k of [...saving]) if (landed(k)) { D()?.discard(k); saving.delete(k); } for (const id of [...gone]) if (!data.schedules.some((s) => s.id === id)) gone.delete(id); ctl.paint(); if (!page.hidden) draw(); };
  let heard = false;   // RailScheduleLive starts after the pages load (adapter.js): it is heard from its first store load on
  if (window.RailWorld?.live) window.RailWorld.onChange(() => { if (!heard && SL()?.onChange) { heard = true; SL().onChange(reload); } reload(); });
  window.RailDrafts?.onChange(() => { ctl.paint(); if (!page.hidden && current) draw(); });
  const sOf = (id) => byId(id);
  window.RailSchedules = { all: list, showing: () => view.show, get TODAY() { return M.TODAY; }, nextDates, nextLine, dateWord, runningRun, openRun, find: sOf,
    add: (s) => { const w = R.scheduleWords(s); Object.assign(s, { day: w.day, time: w.time }); data.schedules.unshift(s); toStore(); ctl.paint(); } /* the demo's New schedule; live, the server's frame lists it */,
    act: (id, v) => { const s = sOf(id); if (s && v) more(s, v); }, running: (id) => { const s = sOf(id); return !!s && isRunning(s); },
    // the one source every surface reads (page, center card, bar row, chat card, Pulse): its word, why it stands there, its skip item
    wordOf: (id) => { const s = sOf(id); return s ? word(s) : ''; }, nextOf: (id) => { const s = sOf(id); return s ? why(s) : ''; },
    skipItem: (id) => { const s = sOf(id); return s ? skipItem(s) : { text: 'Skip next time' }; }, show: (id) => { current = id || ''; draw(); },
    summary: () => ({ n: list().filter((s) => s.state !== 'paused' && !s.ended).length, needs: list().filter((s) => s.section === 'needs').length }) };
})();
