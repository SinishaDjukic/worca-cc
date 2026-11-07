// Schedules (Expert): the list in the one bar, and a schedule's page, read like a chat: its head, each time it ran as a task
// by day, a failure opened, and a composer whose question goes to its chat.
(function () {
  const R = window.RailUI, M = window.SchedulesModel, RM = window.RunCardModel;
  const bar = document.getElementById('bar-schedules'), page = document.getElementById('route-schedule');
  if (!bar || !page) return;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let data = M.seed(), current = '', view = { show: 'all', by: R.BY_DEFAULT }, ctl = null, menu = '', home = null;
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const st = (s) => R.runState(s.state), toneOf = (s) => (s.state === 'scheduled' ? 'idle' : R.markTone(st(s)));
  const SECTIONS = [['needs', R.runState('question').word], ['next', 'Next'], ['paused', R.runState('paused').word]];
  const rowOf = (s) => ({ key: `sched:${s.id}`, _s: s, title: s.title, meta: '', mark: R.kindMark({ kind: 'schedule', tone: toneOf(s), title: `${st(s).word} · ${s.next}` }), end: s.time, current: s.id === current, tip: `${s.title}\n${s.project || 'No project'} · ${s.chat ? 'from a chat' : 'no chat'}\nRuns ${s.every} at ${s.at} · ${s.next}`,
    menu: [{ id: 'run', text: 'Run now', help: 'Starts a task now; the schedule keeps its times' }, { id: 'in-view', text: window.RailShell?.inView.has('schedule', s.id) ? 'Out of view' : 'Keep in view', help: 'Its mark in the top bar, on every page' }, { id: 'pause', text: s.state === 'paused' ? 'Resume' : 'Pause', help: s.state === 'paused' ? 'It runs at its next time again' : 'It stops starting tasks until you resume it' }] });
  function act(id, rows) {
    const s = rows[0]?._s; if (!s) return;
    if (id === 'in-view') { window.RailShell.inView.toggle({ type: 'schedule', id: s.id, title: s.title }); draw(); return; }
    if (id === 'run') { say(`Started ${s.title}`); return; }
    if (id === 'pause') { s.state = s.state === 'paused' ? 'scheduled' : 'paused'; s.section = s.state === 'paused' ? 'paused' : 'next'; s.next = s.state === 'paused' ? 'Paused by you' : `Next at ${s.at}`; follow(s); draw(); say(s.state === 'paused' ? `Paused ${s.title}` : `Resumed ${s.title}`); }
  }
  ctl = R.listController({ root: bar, spec: { noun: 'schedules', label: 'Selected schedules', view: () => ({ state: 'ready',
    parts: [{ word: 'Showing', id: 'show', text: view.show, tip: 'Which schedules the list shows', items: ['all', 'paused'].map((x) => ({ id: x, text: x, checked: view.show === x })) },
      R.byPart({ by: view.by, choices: [{ id: 'day', help: 'By the next run: Today, Tomorrow, This week, Later; paused ones last' }, { id: 'state', help: `${SECTIONS.map(([, t]) => t).join(', ')}` }] })],
    sections: sections(), empty: { text: 'No schedules yet.', action: 'New schedule' } }),
    can: () => ['menu'], bulk: () => [], act, open: (r) => window.RailShell.openSchedule(r._s.id), word: (id, v) => { view = { ...view, [id]: v }; return false; }, say,
    active: () => /^#schedule/.test(location.hash) && !document.querySelector('.pz-popover, .keys-modal, #app .viewer-modal, #app .nav-fly'), emptyAct: () => window.RailConversation?.start('schedule') } });
  // By date (the default): what waits on you first, then by the next run, each day folding; paused ones last, as they have none.
  function sections() {
    const list = data.schedules.filter((s) => view.show === 'all' || s.state === 'paused'), at = (id) => list.filter((s) => s.section === id);
    if (view.by !== 'day') return SECTIONS.map(([id, title]) => ({ id, title, rows: at(id).map(rowOf) }));
    const head = at('needs').length ? [{ id: 'needs', title: SECTIONS[0][1], rows: at('needs').map(rowOf) }] : [];
    return [...R.dateSections({ rows: at('next'), dayOf: (s) => s.day, row: rowOf, head, days: R.NEXT_RUN_SECTIONS }), { id: 'paused', title: SECTIONS[2][1], rows: at('paused').map(rowOf) }];
  }
  const runMark = (r) => R.kindMark({ kind: 'task', tone: R.markTone(R.runState(RM.stateOf(r.case))), stage: r.stage, title: r.meta });
  function pageHtml(s) {
    const groups = R.DAY_SECTIONS.filter(([d]) => s.runs.some((r) => r.day === d)).map(([d, title]) => ({ title, rows: s.runs.filter((r) => r.day === d).map((r) => R.listRow({ title: r.title, meta: r.meta, mark: runMark(r), end: R.gitMark({ status: r.git, title: r.meta }), open: { 'data-sched-run': r.case, title: 'Opens this task' }, after: r.log ? `<div class="tr-body">${esc(r.log)}</div>` : '' })) }));
    const pick = (id, text, items) => R.sentencePicker({ id, text, items: items.map((x) => ({ id: x, text: x, checked: x === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col"><div><h1 class="schedule-title">${esc(s.title)}</h1><div class="convo-head">${esc(s.project || 'No project')} · Runs ${pick('sc-every', s.every, R.REPEATS.filter((x) => x !== 'once'))} at ${pick('sc-at', s.at, R.TIMES_OF_DAY)}${(s.labels || []).map((l) => R.chip({ text: l })).join('')}</div></div>
      <div class="convo-card-line">${R.kindMark({ kind: 'schedule', tone: toneOf(s), title: st(s).word })}<span class="convo-card-w schedule-word">${esc(st(s).word)}<span>${esc(s.next)}${s.chat ? ' · from a chat' : ''}</span></span>${R.button({ label: 'Run now', attrs: { 'data-sched-now': s.id } })}${R.moreMenu({ id: 'sc-more', label: `More for ${s.title}`, icon: R.icon('more', 16), open: menu === 'sc-more', items: [{ id: 'pause', text: s.state === 'paused' ? 'Resume' : 'Pause', help: s.state === 'paused' ? 'Runs at its times again' : 'Skips its times until you resume it' }, { id: 'skip', text: 'Skip the next run', help: 'Only the next one; the times stay' }, { sep: true }, { id: 'delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }] })}</div>
      ${groups.length ? R.list({ groups }) : R.emptyState({ title: 'It has not run yet.' })}
    </div></div><div class="convo-dock" id="sched-dock"></div></div>`;
  }
  function draw() {
    ctl.paint();
    const s = data.schedules.find((x) => x.id === current);
    if (!s) { home ||= window.RailConversation?.mount(page, { mode: 'schedule', where: '#route-schedule', title: 'Schedule a task', note: 'Every schedule is in the list beside; each time one runs, its task joins its chat.' }); home?.show(''); return; }
    home = null; page.innerHTML = pageHtml(s);
    if (s) window.RailConversation?.dock(document.getElementById('sched-dock'), { kind: 'schedule', title: s.title, chat: s.chat });
  }
  // the chat's schedule row and card read the same schedule: a time changed here is the bar's time too
  function follow(s) {
    const c = s.chat && window.RailChats?.data().chats.find((x) => x.id === s.chat), t = c?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
    if (t) { t.time = s.state === 'paused' ? 'Paused' : s.time; t.detail = s.state === 'paused' ? 'Paused by you' : `${s.every.charAt(0).toUpperCase()}${s.every.slice(1)} at ${s.at} · ${s.next}`; window.RailChats.refresh(); }
    ctl.paint();
  }
  function more(s, v) {
    if (v === 'pause') act('pause', [{ _s: s }]);
    if (v === 'skip') { s.next = 'Skips the next run, then as usual'; say(`Skips the next run of ${s.title}`); }
    if (v === 'delete') {
      const i = data.schedules.indexOf(s), c = s.chat && window.RailChats?.data().chats.find((x) => x.id === s.chat), row = c?.tasks?.find((x) => x.kind === 'schedule' && x.title === s.title);
      data.schedules.splice(i, 1); if (current === s.id) current = ''; if (row) { row.time = 'Deleted'; row.detail = 'Deleted · the tasks it ran stay'; row.gone = true; window.RailChats.refresh(); }
      say(`Deleted ${s.title}`, () => { data.schedules.splice(i, 0, s); if (row) { row.gone = false; follow(s); } draw(); }); draw(); return;
    }
    follow(s); draw();
  }
  page.addEventListener('click', (e) => {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-sched-run]'))) { window.RailShell.openTask(hit.dataset.schedRun, data.schedules.find((x) => x.id === current)?.chat || ''); return; }
    if ((hit = on('[data-sched-now]'))) { say('Started: it runs as a task now, and the schedule keeps its times'); return; }
    if (on('[data-sched-new]')) { window.RailConversation?.start('schedule'); return; }
    if ((hit = on('[data-menu-pick]'))) {
      const [id, v] = hit.dataset.menuPick.split('|'); const s = data.schedules.find((x) => x.id === current); menu = '';
      if (id === 'sc-more') { more(s, v); return; }
      if (id === 'sc-every') s.every = v; if (id === 'sc-at') s.at = v;
      if (s.state !== 'paused') { s.next = `Next ${s.every === 'every day' ? 'at' : s.every.replace(/^every /, 'on ')} ${s.at}`; if (s.every === 'every day') s.time = s.at; }
      follow(s); draw(); say(`Runs ${s.every} at ${s.at}`); return;
    }
    if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
  });
  R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-schedule .spick, #route-schedule .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  window.RailSchedules = { find: (id) => data.schedules.find((s) => s.id === id), add: (s) => { data.schedules.unshift(s); ctl.paint(); }, act: (id, v) => { const s = data.schedules.find((x) => x.id === id); if (s && v) more(s, v); }, show: (id) => { current = id || ''; draw(); }, summary: () => ({ n: data.schedules.filter((s) => s.state !== 'paused').length, needs: data.schedules.filter((s) => s.section === 'needs').length }) };
})();
