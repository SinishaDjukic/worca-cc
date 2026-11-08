// Projects on Rail (Wave 3, 3.1): dev's functions, Rail's design. The list in the one bar (the list sentence, one-line
// rows, a project's state on its mark); a project's page as a PlaceHead, then what runs in it, then its own settings as
// sentences that say where each value comes from, then the composer. Adding a project is a conversation (Chat's
// Add project card), so the bar's + arms it there.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  // dev's origin states (branch-sync), each with its words, how it stands and its one way on
  const ORIGIN = {
    ok: { word: 'Up to date', tone: 'idle', short: '' },
    behind: { word: (p) => `${p.behind} behind ${p.base}`, tone: 'act', short: (p) => `${p.behind} behind`, act: 'Sync', why: 'Fast-forwards to the remote; nothing of yours is touched' },
    diverged: { word: 'Diverged', why2: (p) => `${p.ahead} ahead, ${p.behind} behind ${p.base} · the next task asks how to bring them together`, tone: 'ask', short: 'Diverged', act: 'Bring together…', why: 'Asks Worca in a chat how to bring both sides together' },
    offline: { word: "Can't reach origin", tone: 'fail', short: 'Offline', act: 'Retry', why: 'Fetches again' },
    uncommitted: { word: 'Uncommitted changes', tone: 'act', short: 'Uncommitted' },
    local: { word: 'Not on origin yet', tone: 'idle', short: 'Local' },
    folder: { word: 'No git', tone: 'idle', short: 'No git', act: 'Use git', why: 'Runs git init; the first task commits what is there' },
    missing: { word: 'Missing on disk', tone: 'fail', short: 'Missing', act: 'Remove…', why: 'Its folder is gone: remove it from Worca, or put the folder back' },
  };
  const data = { projects: [
    { id: 'billing-api', kind: 'Git', path: '~/src/billing-api', branch: 'main', base: 'origin/main', origin: 'behind', behind: 3, checked: '1 min ago', teamMemory: true },
    { id: 'worca-cc', kind: 'Git', path: '~/src/worca-cc', branch: 'dev', base: 'origin/dev', origin: 'ok', checked: '1 min ago' },
    { id: 'web-app', kind: 'Git', path: '~/src/web-app', branch: 'develop', base: 'origin/develop', origin: 'diverged', ahead: 2, behind: 3, checked: '1 min ago' },
    { id: 'docs-site', kind: 'Folder', path: '~/Projects/docs-site', origin: 'folder', files: 214 },
    { id: 'legacy-billing', kind: 'Git', path: '~/old/legacy-billing', branch: 'main', base: 'origin/main', origin: 'missing', checked: '3 days ago' },
  ] };
  // its own settings: each a sentence whose value is yours (Settings) until the project changes it
  const SETS = [
    { id: 'pr', name: 'Pull requests', words: 'When a task finishes', items: ['create a PR ready for review', 'create a draft PR', 'open no PR'], def: 'create a PR ready for review' },
    { id: 'engine', name: 'Engine', words: 'Its tasks run on', items: ['Claude Code', 'Codex', 'Gemini CLI'], def: 'Claude Code' },
    { id: 'cap', name: 'Cost', words: 'A task pauses at', items: ['$20', '$50', '$100', 'no cap'], def: '$50' },
    { id: 'branch', name: 'Branch names', words: 'New branches are named', items: ['{type}/{slug}', '{ticket}-{slug}', 'worca/{id}'], def: '{type}/{slug}' },
    { id: 'memory', name: 'Memory', words: 'Its tasks read', items: ['its own notes', 'its own and the team\'s notes', 'the team\'s notes'], def: 'its own notes' },
    { id: 'setup', name: 'Your setup', words: 'Its tasks load your Claude Code setup:', items: ['on', 'off'], def: 'on' },
  ];
  const view = { show: 'all' };
  let current = '', menu = '', confirm = null, ctl = null, home = null, bar = null, page = null;
  const o = (p) => ORIGIN[p.origin];
  const wordOf = (p) => (typeof o(p).word === 'function' ? o(p).word(p) : o(p).word);
  const shortOf = (p) => (typeof o(p).short === 'function' ? o(p).short(p) : o(p).short);
  const needs = (p) => ['ask', 'fail'].includes(o(p).tone);
  const tasksOf = (id) => (window.RailChats?.data().chats || []).filter((c) => c.project === id).flatMap((c) => (c.tasks || []).filter((t) => t.kind !== 'schedule').map((t) => ({ t, c })));
  const SHOWS = [{ id: 'all', text: 'all', test: () => true }, { id: 'needs', text: 'needs you', test: needs }, { id: 'behind', text: 'behind', test: (p) => p.origin === 'behind' }, { id: 'folder', text: 'without git', test: (p) => p.kind === 'Folder' }];
  const mark = (p, size) => R.kindMark({ kind: 'project', tone: o(p).tone, size, title: wordOf(p) });
  const rowOf = (p) => ({ key: `proj:${p.id}`, _p: p, title: p.id, mark: mark(p), end: shortOf(p), current: p.id === current, tip: `${p.id}\n${p.kind} · ${p.path}\n${wordOf(p)}`,
    menu: [...(o(p).act ? [{ id: 'act', text: o(p).act, help: o(p).why }] : []), { id: 'task', text: 'New task here', help: 'The composer, on this project' }, { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' }, { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Worca forgets it; its folder and tasks stay' }] });

  function act(id, rows) {
    const p = rows[0]?._p; if (!p) return;
    if (id === 'act') return originAct(p);
    if (id === 'task') { window.RailConversation?.start('task', '', p.id); return; }
    if (id === 'tasks') { window.RailShell.go('runs'); return; }
    if (id === 'remove') { current = p.id; confirm = { what: 'remove', p }; window.RailShell.go(`projects/${p.id}`); }
  }
  function originAct(p) {
    if (p.origin === 'behind') { const n = p.behind; Object.assign(p, { origin: 'ok', behind: 0, checked: 'just now' }); draw(); say(`Synced ${p.id}: ${n} commits from ${p.base}`); return; }
    if (p.origin === 'diverged') { window.RailConversation?.start('ask', `${p.id} has diverged from ${p.base}: ${p.ahead} ahead, ${p.behind} behind. How should we bring them together?`, p.id); return; }
    if (p.origin === 'offline') { p.origin = 'ok'; p.checked = 'just now'; draw(); say(`Reached ${p.base}`); return; }
    if (p.origin === 'folder') { Object.assign(p, { kind: 'Git', origin: 'local', branch: 'main' }); draw(); say(`${p.id} uses git now; the first task commits what is there`); return; }
    if (p.origin === 'missing') { confirm = { what: 'remove', p }; draw(); }
  }

  function pageHtml(p) {
    const pick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((x) => ({ id: x, text: x, checked: x === text })), open: menu === id, chevron: R.icon('chevron', 10) });
    const head = R.placeHead({ title: p.id, facts: esc([p.kind, p.path, p.branch].filter(Boolean).join(' · ')), mark: mark(p), word: wordOf(p), why: o(p).why2 ? o(p).why2(p) : p.checked ? `Checked ${p.checked}` : p.files ? `${p.files} files` : '',
      action: o(p).act ? R.button({ label: o(p).act, attrs: { 'data-pj-act': p.id, title: o(p).why } }) : '',
      menu: R.moreMenu({ id: 'pj-more', label: `More for ${p.id}`, icon: R.icon('more', 16), open: menu === 'pj-more', items: [{ id: 'task', text: 'New task here', help: 'The composer, on this project' }, { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' }, { id: 'fetch', text: 'Check origin now', help: 'Fetches; moves nothing' }, ...(p.kind === 'Git' && p.origin === 'local' ? [{ id: 'remote', text: 'Link a remote…', help: 'Adds the repository as origin; nothing is pushed' }] : []), { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Worca forgets it; its folder and tasks stay' }] }) });
    const strip = confirm && confirm.p === p ? R.confirmStrip({ text: `Remove ${p.id}? Worca forgets it; its folder and its tasks stay, and its schedules stop.`, yes: 'Remove', danger: true }) : '';
    const list = tasksOf(p.id), tone = (t) => R.markTone(R.runState(window.RunCardModel.stateOf(t.case)));
    const counts = ['run', 'ask', 'fail', 'ok', 'merged'].map((k) => [k, list.filter(({ t }) => tone(t) === k || (k === 'ask' && tone(t) === 'act')).length]).filter(([, n]) => n);
    const WORD = { run: 'working', ask: 'need you', fail: 'failed', ok: 'ready', merged: 'merged' };
    const tasks = list.length ? list.map(({ t, c }) => R.taskCard({ compact: true, title: t.title, mark: R.kindMark({ kind: 'task', tone: tone(t), stage: t.stage, size: 20, title: t.detail }), detail: t.detail || '', action: R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-pj-open': `${c.id}|${t.title}` } }) })).join('')
      : R.emptyState({ title: 'Nothing has run here yet.', actions: R.button({ label: 'Start a task', kind: 'quiet', attrs: { 'data-pj-menu': 'task' } }) });
    const sets = R.settingsSection({ title: 'How its tasks run', meta: 'Yours from Settings until you change them here.', rows: SETS.map((x) => { const v = p.sets?.[x.id] || x.def;
      return R.settingsRow({ name: x.name, sentence: `${esc(x.words)} ${pick(`pjs-${x.id}`, v, x.items, x.name)}${v === x.def ? ' <span class="set-from">(yours)</span>' : ''}`, changed: v !== x.def ? [{ name: x.name, was: x.def }] : false, end: v !== x.def ? R.button({ label: 'Use yours', kind: 'quiet', attrs: { 'data-pj-reset': x.id, title: `Back to your ${x.def}` } }) : '' }); }).join('') });
    const team = R.shows('expert') ? R.settingsSection({ title: 'Team', rows: R.settingsRow({ name: 'Team memory', sentence: p.teamMemory ? 'The team\'s notes for this project are on its worca-memory branch' : 'No team notes yet', end: R.switchButton({ on: !!p.teamMemory, label: 'Team memory', attrs: { 'data-pj-team': p.id } }) }) }) : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}
      <p class="convo-head">${list.length ? `${list.length} ${list.length === 1 ? 'task' : 'tasks'} · ${counts.map(([k, n]) => `${n} ${WORD[k]}`).join(' · ')}` : ''}</p>${tasks}${sets}${team}
    </div></div><div class="convo-dock" id="pj-dock"></div></div>`;
  }

  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'projects';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    ctl?.paint();
    const p = data.projects.find((x) => x.id === current);
    if (!p) { home ||= window.RailConversation?.mount(page, { mode: 'ask', where: '#route-place', title: 'Ask about a project', note: 'Every project is in the list beside; Add project is a conversation.' }); home?.show(''); return; }
    home = null; page.innerHTML = pageHtml(p);
    window.RailConversation?.dock(document.getElementById('pj-dock'), { kind: 'project', title: p.id, chat: '' });
  }
  function wire(b, pg) {
    bar = b; page = pg;
    ctl = R.listController({ root: bar, spec: { noun: 'projects', label: 'Selected projects', view: () => ({ state: 'ready',
      parts: [{ word: 'Showing', id: 'show', text: SHOWS.find((x) => x.id === view.show).text, tip: 'Which projects the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, checked: view.show === x.id, hint: String(data.projects.filter(x.test).length) })) }],
      sections: [{ id: 'needs', title: R.runState('question').word, rows: data.projects.filter((p) => needs(p) && SHOWS.find((x) => x.id === view.show).test(p)).map(rowOf) }, { id: 'all', title: 'Projects', rows: data.projects.filter((p) => !needs(p) && SHOWS.find((x) => x.id === view.show).test(p)).map(rowOf) }],
      empty: { text: 'No projects yet.', action: 'Add project' } }),
      can: () => ['menu'], bulk: () => [], act, open: (r) => window.RailShell.go(`projects/${r._p.id}`), word: (id, v) => { view[id] = v; return false; }, say,
      active: () => /^#projects/.test(location.hash), emptyAct: () => window.RailConversation?.starter('project') } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit; const p = data.projects.find((x) => x.id === current); if (!p || !page.querySelector('#pj-dock')) return;
      if ((hit = on('[data-pj-act]'))) { originAct(p); return; }
      if ((hit = on('[data-pj-open]'))) { const [cid, title] = hit.dataset.pjOpen.split('|'); window.RailShell.openTask(window.RailChats.data().chats.find((c) => c.id === cid)?.tasks.find((t) => t.title === title)?.case || '', cid, title); return; }
      if ((hit = on('[data-pj-reset]'))) { delete p.sets[hit.dataset.pjReset]; draw(); say('Back to yours'); return; }
      if ((hit = on('[data-pj-team]'))) { p.teamMemory = !p.teamMemory; draw(); say(p.teamMemory ? 'Team memory on' : 'Team memory off'); return; }
      if ((hit = on('[data-confirm]'))) { if (hit.dataset.confirm === 'yes') { const i = data.projects.indexOf(p); data.projects.splice(i, 1); confirm = null; current = ''; say(`Removed ${p.id}`, () => { data.projects.splice(i, 0, p); draw(); }); window.RailShell.go('projects'); } else { confirm = null; draw(); } return; }
      if ((hit = on('[data-pj-menu]'))) { act(hit.dataset.pjMenu, [{ _p: p }]); return; }
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
        if (id === 'pj-more') { if (v === 'fetch') { p.checked = 'just now'; draw(); say(`Checked ${p.base || p.id}`); } else if (v === 'remote') { p.origin = 'ok'; p.base = 'origin/main'; draw(); say('Linked origin; nothing was pushed'); } else act(v, [{ _p: p }]); return; }
        if (id.startsWith('pjs-')) { p.sets = p.sets || {}; p.sets[id.slice(4)] = v; draw(); say(`${SETS.find((x) => x.id === id.slice(4)).name} for ${p.id}: ${v}`); return; }
      }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailProjects = { list: () => data.projects, add: (p) => { if (!data.projects.some((x) => x.id === p.id)) data.projects.push({ kind: 'Git', origin: 'local', branch: 'main', ...p }); ctl?.paint(); } };
  if (window.RailFirstRun) data.projects = [];   // the first run: nothing added yet
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.projects = { search: (q) => data.projects.filter((p) => `${p.id} ${p.path}`.toLowerCase().includes(q)).map((p) => ({ label: p.id, where: wordOf(p), hash: `projects/${p.id}` })), sample: 'billing-api', newLabel: 'Add project', newAct: () => window.RailConversation?.starter('project'),
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) { menu = ''; if (confirm?.p?.id !== arg) confirm = null; } current = arg || ''; draw(); } };
})();
