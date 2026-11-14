// Shared by the tasks and schedules center mocks (Rail, Wave 3). The bar and top bar are the prototype's own (centers-shell.js),
// adjusted here for what the mocks propose; the main column calls the library. Not product code.
window.centerMock = (function () {
  const R = window.RailUI, S = window.CENTER_SHELL;
  const chev = R.icon('chevron', 10);
  const pick = (t, tip = '') => R.sentencePicker({ id: t, text: t, tip, items: [], chevron: chev });
  const toneOf = (st) => (st === 'scheduled' ? 'idle' : R.markTone(R.runState(st)));
  const mark = (kind, st, breathe) => R.kindMark({ kind, breathe, tone: toneOf(st) });
  const row = (kind, st, title, meta, end, breathe) => R.listRow({ title, meta, mark: mark(kind, st, breathe), endText: end, open: { 'data-x': title } });
  const rowAt = (stage, st, title, meta, end) => R.listRow({ title, meta, mark: R.kindMark({ kind: 'task', tone: toneOf(st), stage }), endText: end, open: { 'data-x': title } });
  const count = (title, meta, n) => R.listRow({ title, meta, mark: '', endText: n, open: { 'data-x': title } });
  const card = ({ kind, st, breathe, kicker, title, what, extra, facts, action, button }) => R.pluginCard({ mark: mark(kind, st, breathe), kicker, title, what, facts, action: R.button({ label: action, kind: button || '' }) }).replace('<span class="pg-f">', `${extra}<span class="pg-f">`).replace(/\[([^\]]+)\]/g, '<a class="dc-link" href="#t">$1</a>');
  const sent = (parts) => `<div class="sent">${parts.map(([w, t]) => `${w} ${pick(t)}`).join(' ')}</div>`;
  const dots = (runs, says) => `<span class="runs">${runs.map((r) => `<i class="is-${r}"></i>`).join('')}<span>${says}</span></span>`;
  const figs = (parts) => R.figures(parts.map(([k, v]) => R.figure({ k, v: String(v), tab: k, title: `Opens the ${v} counted here` })));
  const plus = (label, menu) => `<span class="rc-pop">${R.button({ label, kind: 'quiet', iconOnly: true, icon: R.icon('plus', 15), attrs: { 'aria-haspopup': 'menu', 'aria-expanded': String(!!menu) } })}${menu ? R.compactMenu({ label, items: menu }) : ''}</span>`;
  const menuOf = (chat, form) => [{ header: 'Ask in chat' }, { id: 'c', text: chat }, { sep: true }, { header: 'Legacy approach' }, { id: 'f', text: form }];
  const fold = (label, says) => `<button type="button" class="fold" aria-expanded="false">${R.icon('chevR', 12)}<b>${label}</b><span>${says}</span></button>`;
  const end = (title, text) => { const r = [...document.querySelectorAll('#side-rail .list-row')].find((x) => x.querySelector('.lr-t')?.textContent === title); const f = r?.querySelector('.lr-fig'); if (f) f.textContent = text; };
  const byName = (t) => [...document.querySelectorAll('#side-rail .list-row')].find((x) => x.querySelector('.lr-t')?.textContent === t);
  function tasksBar() {
    const g = document.querySelector('#bar-tasks .list-group .list-rows'), byT = (t) => [...g.querySelectorAll(':scope > .list-row')].find((x) => x.querySelector('.lr-t')?.textContent.startsWith(t));
    ['Update Node', 'Add CSV', 'Migrate', 'Add pager'].forEach((t) => g.append(byT(t)));
    end('Migrate cron parser', 'Needs approval');
    const bump = (word, n) => { const h = [...document.querySelectorAll('#bar-tasks .list-h')].find((x) => x.textContent.trim().startsWith(word)); if (h) h.querySelector('.n').textContent = n; };
    bump('Today', 10); bump('Yesterday', 6); bump('Previous 7 days', 3);
    const more = [...document.querySelectorAll('#bar-tasks .list-more')].find((x) => x.textContent.includes('Show 1')); if (more) more.textContent = 'Show 2 more';
    const rn = byName('Rename settings keys');
    rn.querySelector('.lr-after')?.remove();
    rn.querySelectorAll('[title]').forEach((x) => { if (!x.matches('.lr-main')) { x.title = 'Checks running'; x.setAttribute('aria-label', 'Checks running'); } });
    rn.querySelector('.lr-main').title = 'Checks running · Round 2, merging dev in';
  }
  function schedulesBar() {
    const t = document.createElement('div'); t.innerHTML = R.list({ groups: [{ title: 'Running', count: 1, rows: [R.listRow({ title: 'Changelog digest', mark: mark('schedule', 'working'), endText: '6 min', open: { 'data-x': 'c' } })] }] });
    document.querySelector('#bar-schedules .list-group').after(t.querySelector('.list-group'));
    end('Docs sync', 'Missed'); end('Cost report', '');
    document.querySelectorAll('#bar-schedules .list-h-b').forEach((h) => { const n = [...h.childNodes].find((x) => x.nodeType === 3); if (n) n.textContent = { Tomorrow: 'Nov 13', 'This week': 'Nov 16' }[n.textContent.trim()] || n.textContent; });
    const from = document.createElement('div'); from.innerHTML = S.tasks.side;
    const sent = document.querySelector('#bar-schedules .list-sentence'), head = document.createElement('div');
    head.className = 'list-head'; sent.before(head); head.append(sent, from.querySelector('.list-tools'));
  }
  function paint({ shell, cap, bar, main, modal }) {
    document.getElementById('m').innerHTML = `<div class="strip">${cap}</div><div class="app" id="worca">${S[shell].side}<div class="main-col">${S[shell].top}<main class="main"><div class="convo-col center">${main}</div></main></div></div>${modal || ''}`;
    if (bar) document.querySelector('.bar-head [data-bar-hide]').insertAdjacentHTML('beforebegin', bar);
    if (shell === 'schedules') schedulesBar(); else tasksBar();
    const badge = document.querySelector('#topnav .topnav-badge'); if (badge) badge.textContent = '5';
    if (shell !== 'schedules') document.querySelectorAll('#m .list-row').forEach((r) => { if (r.querySelector('.lr-t')?.textContent.startsWith('Add pager')) r.classList.add('tint-ok'); });
    const d = document.querySelector('#m .viewer-modal .card');
    if (d) document.getElementById('worca').style.minHeight = `${Math.max(870, d.offsetHeight + 70)}px`;
  }
  return { R, pick, card, sent, dots, row, rowAt, count, mark, figs, plus, menuOf, fold, paint };
})();
