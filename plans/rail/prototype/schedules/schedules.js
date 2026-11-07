// Schedules (Expert): the list in the one bar, and a schedule's page, read like a chat: its head, each time it ran as a task
// by day, a failure opened, and a composer whose question goes to its chat.
(function () {
  const R = window.RailUI, M = window.SchedulesModel, RM = window.RunCardModel;
  const bar = document.getElementById('bar-schedules'), page = document.getElementById('route-schedule');
  if (!bar || !page) return;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let data = M.seed(), current = '', view = { show: 'all' }, ctl = null, menu = '', home = null;
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const st = (s) => R.runState(s.state), toneOf = (s) => (s.state === 'scheduled' ? 'idle' : R.markTone(st(s)));
  const SECTIONS = [['needs', R.runState('question').word], ['next', 'Next'], ['paused', R.runState('paused').word]];
  const rowOf = (s) => ({ key: `sched:${s.id}`, _s: s, title: s.title, meta: '', mark: R.kindMark({ kind: 'schedule', tone: toneOf(s), title: `${st(s).word} · ${s.next}` }), end: s.time, current: s.id === current, tip: `${s.title}\n${s.project || 'No project'} · ${s.chat ? 'from a chat' : 'no chat'}\nRuns ${s.every} at ${s.at} · ${s.next}`,
    menu: [{ id: 'run', text: 'Run now', help: 'Starts a task now; the schedule keeps its times' }, { id: 'pause', text: s.state === 'paused' ? 'Resume' : 'Pause', help: s.state === 'paused' ? 'It runs at its next time again' : 'It stops starting tasks until you resume it' }] });
  function act(id, rows) {
    const s = rows[0]?._s; if (!s) return;
    if (id === 'run') { say(`Started ${s.title}`); return; }
    if (id === 'pause') { s.state = s.state === 'paused' ? 'scheduled' : 'paused'; s.section = s.state === 'paused' ? 'paused' : 'next'; s.next = s.state === 'paused' ? 'Paused by you' : `Next at ${s.at}`; draw(); say(st(s).word); }
  }
  ctl = R.listController({ root: bar, spec: { noun: 'schedules', label: 'Selected schedules', view: () => ({ state: 'ready',
    parts: [{ word: 'Showing', id: 'show', text: view.show, tip: 'Which schedules the list shows', items: ['all', 'paused'].map((x) => ({ id: x, text: x, checked: view.show === x })) }],
    sections: SECTIONS.map(([id, title]) => ({ id, title, rows: data.schedules.filter((s) => s.section === id && (view.show === 'all' || s.state === 'paused')).map(rowOf) })), empty: { text: 'No schedules yet.', action: 'New schedule' } }),
    can: () => ['menu'], bulk: () => [], act, open: (r) => window.RailShell.go(`schedule/${r._s.id}`), word: (id, v) => { view = { ...view, [id]: v }; return false; }, say,
    active: () => /^#schedule/.test(location.hash) && !document.querySelector('.pz-popover, .keys-modal, #app .viewer-modal, #app .nav-fly'), emptyAct: () => window.RailConversation?.start('schedule') } });
  const runMark = (r) => R.kindMark({ kind: 'task', tone: R.markTone(R.runState(RM.stateOf(r.case))), stage: r.stage, title: r.meta });
  function pageHtml(s) {
    const days = [...new Set(s.runs.map((r) => r.day))];
    const groups = days.map((d) => ({ title: d, rows: s.runs.filter((r) => r.day === d).map((r) => R.listRow({ title: r.title, meta: r.meta, mark: runMark(r), end: R.gitMark({ status: r.git, title: r.meta }), open: { 'data-sched-run': r.case, title: 'Opens this task' }, after: r.log ? `<div class="tr-body">${esc(r.log)}</div>` : '' })) }));
    const pick = (id, text, items) => R.sentencePicker({ id, text, items: items.map((x) => ({ id: x, text: x, checked: x === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col"><div><h1 class="schedule-title">${esc(s.title)}</h1><div class="convo-head">${esc(s.project || 'No project')} · Runs ${pick('sc-every', s.every, ['every day', 'every weekday', 'every Monday', 'every Tuesday', 'every Friday'])} at ${pick('sc-at', s.at, ['02:00', '06:00', '09:00', '17:00'])}${(s.labels || []).map((l) => R.chip({ text: l })).join('')}</div></div>
      <div class="convo-card-line">${R.kindMark({ kind: 'schedule', tone: toneOf(s), title: st(s).word })}<span class="convo-card-w schedule-word">${esc(st(s).word)}<span>${esc(s.next)}${s.chat ? ' · from a chat' : ''}</span></span>${R.button({ label: 'Run now', attrs: { 'data-sched-now': s.id } })}</div>
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
  page.addEventListener('click', (e) => {
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-sched-run]'))) { window.RailShell.openTask(hit.dataset.schedRun, data.schedules.find((x) => x.id === current)?.chat || ''); return; }
    if ((hit = on('[data-sched-now]'))) { say('Started: it runs as a task now, and the schedule keeps its times'); return; }
    if (on('[data-sched-new]')) { window.RailConversation?.start('schedule'); return; }
    if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); const s = data.schedules.find((x) => x.id === current); if (id === 'sc-every') s.every = v; if (id === 'sc-at') s.at = v; menu = ''; draw(); say(`Runs ${s.every} at ${s.at}`); return; }
    if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
  });
  R.dismissOnOutside(document, { open: () => !!menu, inside: '#route-schedule .spick', back: () => null, close: () => { menu = ''; }, paint: draw });
  window.RailSchedules = { show: (id) => { current = id || ''; draw(); }, summary: () => ({ n: data.schedules.filter((s) => s.state !== 'paused').length, needs: data.schedules.filter((s) => s.section === 'needs').length }) };
})();
