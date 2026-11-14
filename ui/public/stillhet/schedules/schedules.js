// Schedules (Expert): the list in the one bar, and a schedule's page, read like a chat: its head, each time it ran as a task
// by day, a failure opened, and a composer whose question goes to its chat.
(function () {
  const R = window.RailUI, M = window.SchedulesModel, RM = window.RunCardModel;
  const bar = document.getElementById('bar-schedules'), page = document.getElementById('route-schedule');
  if (!bar || !page) return;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const whenOf = (s) => (s.day === 'today' ? 'today' : s.day === 'week' ? 'week' : 'tomorrow');
  let data = M.seed(); /* the schedules that wait to run are in the one store too, so Pulse's Scheduled lists the same ones */
  // each started run is a task in the one store, in its project (panel.task-truth); a time not started is a ticket: Pulse lists it, Tasks does not, and a missed one needs you
  const missedWords = (s) => `Missed ${s.missed} · ${s.missedWhy}`;
  const ticketOf = (s) => (s.section === 'needs' ? { case: 'ticket-missed', detail: missedWords(s), missed: true } : { case: 'scheduled', detail: R.scheduleWords(s).says, missed: false });
  const toStore = () => { const W = window.RailWorld; if (!W || W.live) return;   /* the live kind's store already holds them (live/live-map.mjs) */ for (const s of data.schedules) {
    if (s.state !== 'paused' && !W.find(`sch-${s.id}`)) W.add({ id: `sch-${s.id}`, ...ticketOf(s), ticket: s.id, title: s.title, project: s.project || '', time: s.at, day: 'upcoming', when: whenOf(s) });
    s.runs.forEach((r, i) => { r.wid ||= `sr-${s.id}-${i}`; if (!W.find(r.wid)) W.add({ id: r.wid, case: r.case, title: r.title, project: s.project || '', detail: r.meta, time: r.time || 'now', day: r.day, schedule: s.id, cost: s.cost, over: !!r.over, workflow: s.workflow || 'Default' }); }); } };
  toStore(); window.RailWorld?.onChange(toStore);
  let current = '', view = { show: 'all', by: R.BY_DEFAULT }, ctl = null, menu = '';
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  // R-arch-10: the live kind does not wire Schedules yet (slice 6); every change goes through the adapter, which refuses, and nothing is written
  const refused = (what) => !!window.RailAdapter?.refuse?.(`schedules.${what}`);
  const st = (s) => R.runState(s.state), toneOf = (s) => (isRunning(s) ? 'run' : s.state === 'scheduled' ? 'idle' : R.markTone(st(s)));
  // one word for where a schedule stands, on its page, its card and its row
  const wordOf = (s) => (isRunning(s) ? R.runState('working').word : s.section === 'needs' ? 'Missed' : s.state === 'paused' ? R.runState('paused').word : 'Next up');
  const SECTIONS = [['needs', R.runState('question').word], ['running', 'Running'], ['next', 'Next up'], ['paused', R.runState('paused').word]];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], dateWord = (d) => `${MON[d.getMonth()]} ${d.getDate()}`;
  // live: the server's next time first (nextAt, live-map.mjs); a once-ticket has no time after it
  const nextDates = (s, n = 1) => { if (!Number.isFinite(s.nextAt)) return R.scheduleDates({ every: s.every, at: s.at, from: M.TODAY, n }); const first = new Date(s.nextAt), after = new Date(first); after.setDate(after.getDate() + 1); return [first, ...(s.every === 'Once' ? [] : R.scheduleDates({ every: s.every, at: s.at, from: after, n: n - 1, nowAt: '' }))]; };
  const nextDate = (s) => { const d = nextDates(s, 2); return d[s.skip ? 1 : 0] || d[0]; };   // a skipped time moves it to the one after
  const nextWord = (s) => (s.every === 'every hour' ? 'Within the hour' : dateWord(nextDate(s)));
  // when it next runs, in dates: its card and its page's head say the same
  const nextLine = (s) => { const [d1, d2] = nextDates(s, 2).map(dateWord); return s.every === 'every hour' ? (s.skip ? 'skips the next one' : 'within the hour') : s.skip ? `skips ${d1}, then ${d2}, ${s.at}` : `${d1}, ${s.at}`; };
  const sectionNow = (s) => (s.section !== 'needs' && isRunning(s) ? 'running' : s.section);   // a run under way moves it, a paused one's too, and its end leaves it where it was
  const rowOf = (s) => ({ key: `sched:${s.id}`, _s: s, title: s.title, meta: '', mark: R.kindMark({ breathe: s.id !== current, kind: 'schedule', tone: toneOf(s), title: `${wordOf(s)} · ${s.next}` }), end: sectionNow(s) === 'running' ? (runningRun(s)?.time || 'now') : sectionNow(s) === 'needs' ? 'Missed' : s.state === 'paused' ? '' : s.time, current: s.id === current, tip: `${s.title}\n${s.project || 'No project'} · ${s.chat ? 'from a chat' : 'no chat'}\nRuns ${R.scheduleWords(s).runs} · ${s.next}`,
    menu: [{ id: 'run', text: 'Run now', off: isRunning(s), help: isRunning(s) ? 'Its task is running; it can start again when that ends' : 'Starts a task now; the schedule keeps its times' }, { id: 'in-view', text: window.RailShell?.inView.has('schedule', s.id) ? 'Out of view' : 'Keep in view', help: 'Its mark in the top bar, on every page' }, { id: 'pause', text: s.state === 'paused' ? 'Resume' : 'Pause', help: s.state === 'paused' ? 'It runs at its next time again' : 'It stops starting tasks until you resume it' }, { id: 'skip', ...skipItem(s) }, { sep: true }, { id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }] });
  // Run now is one thing wherever you press it: a real task in the one store, on this schedule's page, and in its chat
  const liveWord = 'Plan · writing the plan';
  function runningRun(s) { const W = window.RailWorld; return s.runs.find((r) => { const w = r.wid && W?.find(r.wid); return w && W.section(w) === 'running'; }); }
  function isRunning(s) { return !!runningRun(s); }
  function runNow(s) {
    if (refused('run')) return;
    if (isRunning(s)) { say(`${s.title} is already running`); return; }
    const k = Date.now().toString(36), wid = `sr-${s.id}-${k}`;
    s.runs.unshift({ day: 'today', title: s.title, case: 'working', stage: 0, git: 'branch', meta: liveWord, wid });
    window.RailWorld?.add({ id: wid, case: 'working', title: s.title, project: s.project || '', detail: liveWord, time: 'now', day: 'today' });
    const c = s.chat && window.RailChats?.data().chats.find((x) => x.id === s.chat);
    if (c) { const t = { id: `t${k}`, run: wid, title: s.title, ask: s.title, case: 'working', stage: 0, git: 'branch', detail: liveWord }; c.tasks = [...(c.tasks || []), t]; window.RailConversation?.join(c, { t: 'task', id: `k${k}`, task: t.id }); window.RailChats.refresh(); }
    if (s.section === 'needs') { s.section = 'next'; s.state = 'scheduled'; s.next = R.scheduleWords(s).next; delete s.missed; window.RailWorld?.move(`sch-${s.id}`, 'scheduled', R.scheduleWords(s).says, { missed: false, day: 'upcoming', time: s.at, when: whenOf(s) }); }   // run now was the catching up
    draw(); say(`Started ${s.title}; the schedule keeps its times`);
  }
  const skipItem = (s) => (s.state === 'paused' ? { text: 'Skip next time', off: true, help: 'It is paused: nothing is coming to skip' } : s.skip ? { text: 'Keep next time', help: 'It runs next time after all' } : { text: 'Skip next time', help: 'Only the next one; the times stay' });
  function act(id, rows) {
    const s = rows[0]?._s; if (!s) return;
    if (id === 'in-view') { window.RailShell.inView.toggle({ type: 'schedule', id: s.id, title: s.title }); draw(); return; }
    if (refused(id)) return;
    if (id === 'run') { runNow(s); return; }
    if (id === 'skip' || id === 'delete') { more(s, id); return; }
    if (id === 'pause') { const W = window.RailWorld, wid = `sch-${s.id}`; if (W?.find(wid)) W.move(wid, s.state === 'paused' ? 'scheduled' : 'stopped', s.state === 'paused' ? R.scheduleWords(s).next : 'Paused by you', { missed: false });   // Pulse hears it: a paused time no longer needs you
      s.state = s.state === 'paused' ? 'scheduled' : 'paused'; s.section = s.state === 'paused' ? 'paused' : 'next'; s.next = s.state === 'paused' ? 'Paused by you' : R.scheduleWords(s).next; s.day = R.scheduleWords(s).day; s.skip = ''; toStore(); follow(s); draw(); say(s.state === 'paused' ? `Paused ${s.title}` : `Resumed ${s.title}`); }
  }
  ctl = R.listController({ root: bar, spec: { noun: 'schedules', label: 'Selected schedules', view: () => ({ state: 'ready',
    parts: [{ word: 'Showing', id: 'show', text: view.show, tip: 'Which schedules the list shows', items: ['all', 'paused'].map((x) => ({ id: x, text: x, checked: view.show === x })) },
      R.byPart({ by: view.by, choices: [{ id: 'day', help: 'By the next run: Today, Tomorrow, This week, Later; paused ones last' }, { id: 'state', help: `${SECTIONS.map(([, t]) => t).join(', ')}` }] })],
    sections: sections(), empty: { text: 'No schedules yet.', action: 'New schedule' } }),
    can: () => ['menu'], bulk: () => [], act, open: (r) => window.RailShell.openSchedule(r._s.id), word: (id, v) => { view = { ...view, [id]: v }; if (!current) window.RailCenters?.schedules(page); return false; }, say,
    active: () => /^#schedule/.test(location.hash) && !document.querySelector('.pz-popover, .keys-modal, #app .viewer-modal, #app .nav-fly'), emptyAct: () => window.RailConversation?.start('schedule') } });
  // By date (the default): what waits on you first, then by the next run, each day folding; paused ones last, as they have none.
  function sections() {
    const list = data.schedules.filter((s) => view.show === 'all' || s.state === 'paused'), at = (id) => list.filter((s) => sectionNow(s) === id);
    if (view.by !== 'day') return SECTIONS.map(([id, title]) => ({ id, title, rows: at(id).map(rowOf) })).filter((x) => x.rows.length);   // list.sections: an empty one is not drawn
    const head = [['needs', 0], ['running', 1]].filter(([id]) => at(id).length).map(([id, i]) => ({ id, title: SECTIONS[i][1], rows: at(id).map(rowOf) }));
    const next = at('next').sort((a, b) => nextDate(a) - nextDate(b)), days = [...new Set(next.map(nextWord))].map((d) => [d, d]);
    return [...R.dateSections({ rows: next, dayOf: nextWord, row: rowOf, head, days }), { id: 'paused', title: SECTIONS[3][1], rows: at('paused').map(rowOf) }].filter((x) => x.rows.length);
  }
  // a failed run a later run put right is Normal (look.alert-ladder): the list is newest first
  const fixedLater = (r) => { const s = data.schedules.find((x) => x.runs?.includes(r)); return !!s && s.runs.slice(0, s.runs.indexOf(r)).some((x) => ['ok', 'done', 'merged'].includes(R.markTone(R.runState(RM.stateOf(x.case))))); };
  const toneOfRun = (r) => { const t = R.markTone(R.runState(RM.stateOf(r.case))); return t === 'fail' && fixedLater(r) ? 'idle' : t; };
  const runMark = (r) => R.kindMark({ kind: 'task', tone: toneOfRun(r), stage: r.stage, title: r.meta });
  // each run is the task it started, in the chat's own card: its state, its stages, why it failed on the text edge, one way in
  const STAGES = ['Plan', 'Build', 'Review', 'PR', 'Merged'];
  const runCard = (r, day, s) => { const st = R.runState(RM.stateOf(r.case)), tone = toneOfRun(r);
    const why = r.log ? r.log.split('\n').map((w) => R.turnRow({ mark: '', text: `<span class="cmd-s">${esc(w.trim())}</span>` })).join('') : '';
    return R.taskCard({ title: r.title, mark: runMark(r), word: `${st.word} · ${day}`, detail: r.meta === st.word ? '' : r.meta, place: tone === 'merged' ? '' : R.gitMark({ status: r.git, title: r.meta }), rows: why, stages: R.stageBar({ labels: STAGES, stage: r.stage, tone, step: R.stageStep(r.meta), key: r.wid ? `t-${r.wid}` : '' }), action: R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-sched-run': String(s.runs.indexOf(r)), title: 'Opens this task in its chat' } }) }); };
  // a task this schedule ran opens in its chat, as a card there: the schedule's chat, or one of its own
  function openRun(s, r) {
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
      if (refused('ask')) return;
      const id = s.chat || window.RailChats.newChat(`About ${s.title}`, s.project || ''), c = window.RailChats.data().chats.find((x) => x.id === id), k = Date.now().toString(36);
      window.RailConversation.join(c, { t: 'you', id: `y${k}`, text, when: 'now', refs: [], files: [`Schedule · ${s.title}`] });
      window.RailConversation.join(c, { t: 'words', html: `Looking at <b>${esc(s.title)}</b>.` });
      window.RailChats.refresh(); window.RailShell.go(`chat/${id}`);
    };
    host.addEventListener('click', (e) => { if (e.target.closest('[data-dock-send]')) { e.stopPropagation(); send(); } }, true);
    host.addEventListener('submit', (e) => { e.stopPropagation(); e.preventDefault(); send(); }, true);
    host.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches('[data-composer-t]')) { e.preventDefault(); send(); } });
  }
  function pageHtml(s) {
    const dayOf = Object.fromEntries(R.DAY_SECTIONS), cards = R.DAY_SECTIONS.flatMap(([d]) => s.runs.filter((r) => r.day === d)).map((r) => runCard(r, dayOf[r.day], s)).join('');   // one stream, newest first, as a chat's
    const paused = s.state === 'paused';
    const pick = (id, text, items) => R.sentencePicker({ id, text, items: items.map((x) => ({ id: x, text: x, checked: x === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${R.placeHead({ center: { label: 'Schedules', to: 'schedules' }, title: s.title, facts: `${esc(s.project || 'No project')} · Repeats ${pick('sc-every', s.every, R.REPEATS.filter((x) => x !== 'once'))}${s.every === 'every hour' ? '' : ` at ${pick('sc-at', s.at, R.TIMES_OF_DAY)}`}${(s.labels || []).map((l) => R.chip({ text: l })).join('')}`, mark: R.kindMark({ kind: 'schedule', tone: toneOf(s), title: wordOf(s) }), word: wordOf(s), why: `${isRunning(s) ? `for ${!runningRun(s).time || runningRun(s).time === 'now' ? 'a moment' : runningRun(s).time}` : s.section === 'next' ? nextLine(s) : s.next.replace(/^(Missed|Next|Paused) /, '')}${s.chat ? ' · from a chat' : ''}`,   /* the word already says it */ action: isRunning(s) ? R.button({ label: 'Stop', attrs: { 'data-sched-stop': s.id, title: 'Stops the task that is running; the schedule keeps its times' } }) : paused ? R.button({ label: 'Resume', attrs: { 'data-sched-resume': s.id, title: 'Runs at its times again' } }) : R.button({ label: 'Run now', attrs: { 'data-sched-now': s.id } }), menu: R.moreMenu({ id: 'sc-more', label: `More for ${s.title}`, icon: R.icon('more', 16), open: menu === 'sc-more', items: [paused ? { id: 'run', text: 'Run now', off: isRunning(s), help: isRunning(s) ? 'Its task is running; it can start again when that ends' : 'Starts a task now; it stays paused after' } : { id: 'pause', text: 'Pause', help: 'Skips its times until you resume it' }, { id: 'skip', ...skipItem(s) }, { sep: true }, { id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }] }) })}
      ${s.agent ? R.turnRow({ mark: '', text: `<span class="cmd-s">${esc(`${s.workflow} workflow, run by ${s.agent}, from ${s.base}, then ${s.then} · ${s.ends} · ${s.overlap} · ${s.fails}${s.tz ? ` · ${s.tz}` : ''}`)}</span>` }) : ''}
      ${cards || R.emptyState({ title: 'It has not run yet.' })}
    </div></div><div class="convo-dock" id="sched-dock"></div></div>`;
  }
  function draw() {
    ctl.paint();
    const s = data.schedules.find((x) => x.id === current);
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
  function more(s, v) {
    if (refused(v)) { draw(); return; }   // its menu closes; nothing else changes
    if (v === 'pause') act('pause', [{ _s: s }]);
    if (v === 'run') { runNow(s); return; }
    if (v === 'stop') { const r = runningRun(s); if (!r) return; r.case = 'stopped'; r.meta = 'Stopped by you'; window.RailWorld?.move(r.wid, 'stopped', 'Stopped by you'); draw(); say(`Stopped ${s.title}; the schedule keeps its times`); return; }
    if (v === 'skip') {
      if (s.state === 'paused') return;
      if (s.skip) { s.next = s.skip; s.skip = ''; say(`${s.title} runs next time after all`); } else { s.skip = s.next; s.next = s.section === 'needs' ? `${s.next} · skips next time` : 'Skips next time, then as usual'; say(`${s.title} skips next time`); }
    }
    if (v === 'delete') {
      const i = data.schedules.indexOf(s), c = s.chat && window.RailChats?.data().chats.find((x) => x.id === s.chat), row = c?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
      const onIt = current === s.id && location.hash === `#schedule/${s.id}`;
      data.schedules.splice(i, 1); if (current === s.id) current = ''; window.RailWorld?.remove(`sch-${s.id}`); if (row) { row.time = 'Deleted'; row.detail = 'Deleted · the tasks it ran stay'; row.gone = true; window.RailChats.refresh(); }
      say(`Deleted ${s.title}`, () => { data.schedules.splice(i, 0, s); if (row) row.gone = false; toStore(); follow(s); draw(); }); if (onIt) window.RailShell.go('schedules'); draw(); return;
    }
    follow(s); draw();
  }
  page.addEventListener('click', (e) => {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-sched-run]'))) { const s = data.schedules.find((x) => x.id === current); if (s) openRun(s, s.runs[+hit.dataset.schedRun]); return; }
    if ((hit = on('[data-sched-now]'))) { const s = data.schedules.find((x) => x.id === current); if (s) runNow(s); return; }
    if ((hit = on('[data-sched-stop]'))) { const s = data.schedules.find((x) => x.id === current); if (s) more(s, 'stop'); return; }
    if ((hit = on('[data-sched-resume]'))) { const s = data.schedules.find((x) => x.id === current); if (s) act('pause', [{ _s: s }]); return; }
    if (on('[data-sched-new]')) { window.RailConversation?.start('schedule'); return; }
    if ((hit = on('[data-menu-pick]'))) {
      const [id, v] = hit.dataset.menuPick.split('|'); if (!id.startsWith('sc-')) return;   // the composer's picks are the composer's
      const s = data.schedules.find((x) => x.id === current); menu = '';
      if (id === 'sc-more') { more(s, v); return; }
      if ((id === 'sc-every' ? s.every : s.at) === v || refused(id)) { draw(); return; }   // the same value again: nothing changed, nothing to say
      if (id === 'sc-every') s.every = v; if (id === 'sc-at') s.at = v;
      const w = R.scheduleWords(s); Object.assign(s, { time: w.time, day: w.day });
      if (s.section === 'next') { if (s.skip) s.skip = w.next; else s.next = w.next; }   // a paused one and a missed one keep what they say
      follow(s); draw(); say(s.state === 'paused' ? `It stays paused; once resumed it runs ${w.runs}` : `Runs ${w.runs}`); return;
    }
    if ((hit = on('[data-menu^="sc-"]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
  });
  R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-schedule .spick, #route-schedule .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  R.prefs.onChange(() => { if (!page.hidden) draw(); });
  window.RailWorld?.onMove(() => { if (!bar.hidden) ctl.paint(); });
  if (window.RailWorld?.live) window.RailWorld.onChange(() => { data = M.seed(); ctl.paint(); if (!page.hidden) draw(); });   // the live kind: a load replaced them (D9)
  window.RailSchedules = { all: () => data.schedules, showing: () => view.show, get TODAY() { return M.TODAY; }, nextDates, nextLine, dateWord, runningRun, openRun, find: (id) => data.schedules.find((s) => s.id === id), add: (s) => { if (refused('add')) return; const w = R.scheduleWords(s); Object.assign(s, { day: w.day, time: w.time }); data.schedules.unshift(s); toStore(); ctl.paint(); } /* in the one store: Pulse's Scheduled lists it */, act: (id, v) => { const s = data.schedules.find((x) => x.id === id); if (s && v) more(s, v); }, running: (id) => { const s = data.schedules.find((x) => x.id === id); return !!s && isRunning(s); }, skipItem: (id) => { const s = data.schedules.find((x) => x.id === id); return s ? skipItem(s) : { text: 'Skip next time' }; }, show: (id) => { current = id || ''; draw(); }, summary: () => ({ n: data.schedules.filter((s) => s.state !== 'paused').length, needs: data.schedules.filter((s) => s.section === 'needs').length }) };
})();
