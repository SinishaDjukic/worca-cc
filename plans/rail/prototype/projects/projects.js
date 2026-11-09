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
    behind: { word: (p) => `Out of sync, ${p.behind} behind`, why2: () => 'Only your copy is older; new tasks start from origin', tone: 'idle', short: () => '', quiet: true, act: 'Sync', why: 'Fast-forwards to the remote; nothing of yours is touched' },
    diverged: { word: 'Out of sync', why2: (p) => `${p.ahead} ahead, ${p.behind} behind ${p.base} · the next task asks how to bring them together`, tone: 'ask', short: 'Out of sync', act: 'Bring together…', why: 'Asks Worca in a chat how to bring both sides together' },
    offline: { word: "Can't reach origin", tone: 'fail', short: 'Offline', act: 'Retry', why: 'Fetches again' },
    uncommitted: { word: 'Uncommitted changes', tone: 'act', short: 'Uncommitted' },
    local: { word: 'Only on this computer', why2: () => 'Worca works here; nothing leaves it until you link a repository', tone: 'idle', short: '', quiet: true, act: 'Link a repository…', why: 'Adds the repository as origin; nothing is pushed' },
    folder: { word: 'No git', tone: 'idle', short: '', act: 'Use git', why: 'Runs git init; the first task commits what is there' },
    missing: { word: 'Folder missing', tone: 'fail', short: 'Folder missing', act: 'Remove…', why: 'Its folder is gone: remove it from Worca, or put the folder back' },
  };
  const data = { projects: [
    { id: 'billing-api', tags: ['cost-center: 4410'], labels: ['payments'], kind: 'Git', path: '~/src/billing-api', branch: 'main', base: 'origin/main', origin: 'behind', behind: 3, checked: '1 min ago', teamMemory: true },
    { id: 'worca-cc', kind: 'Git', path: '~/src/worca-cc', branch: 'dev', base: 'origin/dev', origin: 'ok', checked: '1 min ago' },
    { id: 'web-app', kind: 'Git', path: '~/src/web-app', branch: 'develop', base: 'origin/develop', origin: 'diverged', ahead: 2, behind: 3, checked: '1 min ago' },
    { id: 'docs-site', kind: 'Folder', path: '~/Projects/docs-site', origin: 'folder', files: 214 },
    { id: 'payments-api', kind: 'Git', path: '~/src/payments-api', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'design-kit', kind: 'Git', path: '~/src/design-kit', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'email-service', kind: 'Git', path: '~/src/email-service', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'ingest-gateway', kind: 'Git', path: '~/src/ingest-gateway', branch: 'main', base: 'origin/main', origin: 'diverged', ahead: 1, behind: 2, checked: '1 min ago' },
    { id: 'device-registry', kind: 'Git', path: '~/src/device-registry', branch: 'main', base: 'origin/main', origin: 'behind', behind: 1, checked: '1 min ago' },
    { id: 'telemetry-db', kind: 'Git', path: '~/src/telemetry-db', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'ops-dashboard', kind: 'Git', path: '~/src/ops-dashboard', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
    { id: 'firmware-sdk', kind: 'Git', path: '~/src/firmware-sdk', branch: 'main', base: 'origin/main', origin: 'ok', checked: '1 min ago' },
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
  // team memory decides which notes there are: on, its tasks read both unless you say otherwise; off, the team's are not offered
  const TEAM_NOTES = ['its own and the team\'s notes', 'the team\'s notes'], defOf = (p, x) => (x.id === 'memory' && p.teamMemory ? TEAM_NOTES[0] : x.def);
  const view = { show: 'all', by: 'workspace' }, showAll = new Set();   // a workspace in Needs you lists its trouble first; its other projects are one click away
  const pid = () => current.split('@')[0];   // the address may say through which workspace: billing-api@legacy
  const firstHome = (id) => window.RailSpaces?.list().find((w) => w.projects.some(([p]) => p === id))?.id;
  let current = '', menu = '', confirm = null, ctl = null, bar = null, page = null, form = '', formTyped = '', formErr = '', setsOpen = false;
  const o = (p) => ORIGIN[p.origin];
  const wordOf = (p) => (typeof o(p).word === 'function' ? o(p).word(p) : o(p).word);
  const shortOf = (p) => (typeof o(p).short === 'function' ? o(p).short(p) : o(p).short);
  const tasksOf = (id) => (window.RailChats?.data().chats || []).filter((c) => c.project === id).flatMap((c) => (c.tasks || []).filter((t) => t.kind !== 'schedule').map((t) => ({ t, c })));
  const toneOfTask = (t) => R.markTone(R.runState(window.RunCardModel.stateOf(t.case)));
  const inTasksNeeds = (id, t) => (window.RailWorld?.tops() || []).some((x) => !x.archived && x.section === 'needs' && x.project === id && x.title === t.title);
  const waitingOn = (id, t) => ['ask', 'act'].includes(toneOfTask(t)) || (toneOfTask(t) !== 'fail' && inTasksNeeds(id, t));   // the same rows as Tasks' Needs you: an approved task ready to merge waits on you too
  const asking = (p) => tasksOf(p.id).filter(({ t }) => waitingOn(p.id, t)).sort((a, b) => ['ask', 'act'].includes(toneOfTask(b.t)) - ['ask', 'act'].includes(toneOfTask(a.t)));   // the tasks here waiting on you, a question first
  const needs = (p) => ['ask', 'fail'].includes(o(p).tone) || asking(p).length > 0;
  const endOf = (p) => { const k = asking(p).length; return k && o(p).tone !== 'fail' ? `${k} ${k === 1 ? 'task needs you' : 'tasks need you'}` : shortOf(p); };   // "question" is a workspace's: a link Worca is unsure of
  const SHOWS = [{ id: 'all', text: 'all', test: () => true }, { id: 'needs', text: 'needs you', test: needs }, { id: 'behind', text: 'out of sync', test: (p) => ['behind', 'diverged'].includes(p.origin) }, { id: 'folder', text: 'without git', test: (p) => p.kind === 'Folder' }];
  const mark = (p, size) => R.kindMark({ kind: 'project', tone: asking(p).length && o(p).tone !== 'fail' ? 'ask' : o(p).tone, size, title: wordOf(p) });
  const rowOf = (p) => ({ key: `proj:${p.id}`, _p: p, title: p.id, mark: mark(p), end: endOf(p), current: p.id === pid() && !(adv() && window.RailSpaces?.member(p.id)), tip: `${p.id}\n${p.kind} · ${p.path}\n${wordOf(p)}`,
    menu: [...actItem(p), { id: 'task', text: 'New task here', help: 'The composer, on this project' }, { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' }, { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Worca forgets it; its folder and tasks stay' }] });
  // a missing folder's one way on is Remove…, which every menu already ends with
  function actItem(p) { return o(p).act && p.origin !== 'missing' ? [{ id: 'act', text: o(p).act, help: o(p).why }] : []; }
  // what there is to fetch from: why not, when there is nothing
  const noOrigin = (p) => (p.origin === 'missing' ? 'Its folder is missing: nothing to check' : p.kind === 'Folder' ? 'It has no git: nothing to check' : p.origin === 'local' ? 'No origin linked yet: nothing to check' : '');
  // what Tasks lists for this project: its top rows that are not archived (a group is one row)
  const taskCount = (id) => { const d = window.RailWorld?.data(); if (!d) return 0; return d.runs.filter((r) => !r.group && !r.archived && r.project === id).length + d.groups.filter((g) => { const ms = d.runs.filter((r) => r.group === g.id); return g.project === id && ms.length && !ms.every((m) => m.archived); }).length; };

  function act(id, rows) {
    const p = rows[0]?._p; if (!p) return;
    if (id === 'act') return originAct(p);
    if (id === 'task') { window.RailConversation?.handOver({ mode: 'task', project: p.id, about: { kind: 'Project', name: p.id } }); return; }
    if (id === 'tasks') { window.RailRunsList.filter({ project: p.id }); return; }
    if (id === 'remove') { current = p.id; confirm = { what: 'remove', p }; window.RailShell.go(`projects/${p.id}`); }
  }
  function originAct(p) {
    if (p.origin === 'behind') { const n = p.behind; Object.assign(p, { origin: 'ok', behind: 0, checked: 'just now' }); draw(); say(`Synced ${p.id}: ${n} ${n === 1 ? 'commit' : 'commits'} from ${p.base}`); return; }
    if (p.origin === 'diverged') { window.RailConversation?.handOver({ project: p.id, about: { kind: 'Project', name: p.id }, text: `It has diverged from ${p.base}: ${p.ahead} ahead, ${p.behind} behind. How should we bring them together?` }); return; }
    if (p.origin === 'local') { p.origin = 'ok'; p.base = 'origin/main'; draw(); say('Linked origin; nothing was pushed'); return; }
    if (p.origin === 'offline') { p.origin = 'ok'; p.checked = 'just now'; draw(); say(`Reached ${p.base}`); return; }
    if (p.origin === 'folder') { Object.assign(p, { kind: 'Git', origin: 'local', branch: 'main' }); draw(); say(`${p.id} uses git now; the first task commits what is there`); return; }
    if (p.origin === 'missing') { confirm = { what: 'remove', p }; draw(); }
  }

  // Every new task here gets (rail: default labels and cost tags): a project's own and each workspace's. Labels add up; a cost tag has one value: the project's own wins, two workspaces that differ make the task's composer ask
  const defaultsRows = (owner, from) => { const tagKey = (t) => t.split(':')[0].trim(), own = owner.tags || [], ownL = owner.labels || [], got = from.flatMap((w) => (w.tags || []).filter((t) => !own.some((o) => tagKey(o) === tagKey(t))).map((t) => [t, w])), keys = got.map(([t]) => tagKey(t)), clash = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i && got[i] && got[keys.indexOf(k)][0] !== got[i][0]))];
    const labels = [...new Set([...from.flatMap((w) => w.labels || []), ...ownL])], tags = [...own, ...[...new Map(got.filter(([t]) => !clash.includes(tagKey(t))).map(([t]) => [t, t])).keys()]];
    const row = (name, kind, list, field) => R.settingsRow({ name, sentence: owner.editing === field ? R.field({ id: `def-${field}`, label: name, quietLabel: true, value: (field === 'tags' ? own : ownL).join(', '), placeholder: field === 'tags' ? 'team: web, cost-center: 4410' : 'hotfix, billing', attrs: { 'data-def-input': field } }) : list.length ? list.map((text) => R.chip({ text, title: text })).join(' ') : '<span class="set-from">None</span>', end: R.button({ label: owner.editing === field ? 'Done' : 'Change', kind: 'quiet', attrs: { 'data-def-edit': field } }) });
    return R.settingsSection({ title: 'Every new task here gets', meta: 'A task can change its own.', rows: row('Cost tags', 'tag', tags, 'tags') + row('Labels', 'label', labels, 'labels') + (clash.length ? R.settingsRow({ name: 'Who pays', sentence: `${esc(from.map((w) => w.title).join(' and '))} name different ${clash.map(esc).join(', ')}s. ${clash.map((k, i) => `Charge new tasks to ${R.sentencePicker({ id: `pj-pay-${i}`, text: 'each task asks', tip: 'Who pays', items: [{ id: 'ask', text: 'each task asks', checked: true }, ...[...new Set(got.filter(([t]) => tagKey(t) === k).map(([t]) => t))].map((t) => ({ id: t, text: t }))], open: menu === `pj-pay-${i}`, chevron: R.icon('chevron', 10) })}`).join(' ')}` }) : '') }); };
  const defaults = (owner, from) => defaultsRows(owner, from);
  // what was typed: no repeats, and a cost tag has one value, so a key given twice keeps its last
  const defaultsParse = (f, v) => { const l = [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))]; return f === 'tags' ? [...new Map(l.map((t) => [t.split(':')[0].trim(), t])).values()] : l; };
  const defaultsClick = (e, owner, repaint) => { const hit = e.target.closest('[data-def-edit]'); if (!hit) return false; const f = hit.dataset.defEdit, closing = owner.editing === f; if (closing) { const typed = document.getElementById(`def-${f}`)?.value || '', v = defaultsParse(f, typed), was = [...(owner[f] || [])].sort().join(', '), oneValue = f === 'tags' && v.length < new Set(typed.split(',').map((x) => x.trim()).filter(Boolean)).size; owner[f] = v; owner.editing = ''; if ([...v].sort().join(', ') !== was) say(!v.length ? `No ${f === 'tags' ? 'cost tags' : 'labels'} of its own now` : oneValue ? `A cost tag has one value: kept ${v.join(', ')}` : 'Kept for every new task here'); } else owner.editing = f; repaint(); if (!closing) document.getElementById(`def-${f}`)?.focus(); return true; };
  const defaultsKey = (e, owner, repaint) => { const f = e.target.dataset?.defInput; if (!f || owner.editing !== f || !['Enter', 'Escape'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const done = () => e.currentTarget?.querySelector?.(`[data-def-edit="${f}"]`); if (e.key === 'Enter') { done()?.click(); return; } owner.editing = ''; repaint(); done()?.focus(); };
  function pageHtml(p) {
    const pick = (id, text, items, tip, off = []) => R.sentencePicker({ id, text, tip, items: items.map((x) => ({ id: x, text: x, checked: x === text, off: off.includes(x), help: off.includes(x) ? 'Team memory is off for this project' : '' })), open: menu === id, chevron: R.icon('chevron', 10) });
    const via = current.split('@')[1] || firstHome(p.id), homes = adv() ? window.RailSpaces?.list().filter((w) => w.projects.some(([x]) => x === p.id)) || [] : [], here2 = homes.find((w) => w.id === via), also = homes.filter((w) => w !== here2);
    const crumb = adv() && here2 ? `<p class="pj-crumb">${R.textLink({ label: `${here2.title} ›`, attrs: { 'data-pj-go': `ws:${here2.id}` } })}</p>` : '';
    const waits = asking(p), first = waits[0];   // a question waiting leads; how the project stands comes after it
    const head = R.placeHead({ title: p.id, facts: esc([also.length ? `Also in ${also.map((w) => w.title).join(', ')}` : '', p.kind, p.path, p.branch].filter(Boolean).join(' · ')), mark: mark(p), word: first ? (waits.length === 1 ? '1 task needs you' : `${waits.length} tasks need you`) : wordOf(p), why: first ? (p.origin === 'ok' ? '' : wordOf(p)) : o(p).why2 ? o(p).why2(p) : p.checked ? `Checked ${p.checked}` : p.files ? `${p.files} files` : '',
      action: first ? R.button({ label: 'Answer', attrs: { 'data-pj-open': `${first.c.id}|${first.t.title}`, title: `Opens ${first.t.title} in its chat` } }) : o(p).act ? R.button({ label: o(p).act, kind: o(p).quiet ? 'quiet' : '', attrs: { 'data-pj-act': p.id, title: o(p).why } }) : '',
      menu: R.moreMenu({ id: 'pj-more', label: `More for ${p.id}`, icon: R.icon('more', 16), open: menu === 'pj-more', items: [...(first ? actItem(p) : []), { id: 'task', text: 'New task here', help: 'The composer, on this project' }, { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' }, { id: 'fetch', text: 'Check origin now', help: noOrigin(p) || 'Fetches; moves nothing', off: !!noOrigin(p) }, ...(p.kind === 'Git' && p.origin === 'local' ? [{ id: 'remote', text: 'Link a remote…', help: 'Adds the repository as origin; nothing is pushed' }] : []), { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Worca forgets it; its folder and tasks stay' }] }) });
    const strip = confirm && confirm.p === p ? R.confirmStrip({ text: `Remove ${p.id}? Worca forgets it; its folder and its tasks stay, and its schedules stop.`, yes: 'Remove', danger: true }) : '';
    const tone = toneOfTask, list = tasksOf(p.id).filter(({ t }) => !['ok', 'merged', 'idle'].includes(tone(t)) || waitingOn(p.id, t));   // what is on it now
    const counts = ['run', 'ask', 'fail', 'ok', 'merged'].map((k) => [k, list.filter(({ t }) => (k === 'ask' ? waitingOn(p.id, t) : tone(t) === k && !waitingOn(p.id, t))).length]).filter(([, n]) => n);
    const WORD = { run: 'working', ask: 'need you', fail: 'failed', ok: 'ready', merged: 'merged' };
    const tasks = list.length ? R.list({ groups: [{ rows: list.map(({ t, c }) => R.listRow({ title: t.title, meta: t.detail || '', mark: R.kindMark({ kind: 'task', tone: tone(t), stage: t.stage, title: t.detail }), open: { 'data-pj-open': `${c.id}|${t.title}`, title: `Opens ${t.title} in its chat` } })) }] })
      : R.emptyState({ title: 'Nothing is on it now.', actions: R.button({ label: 'Start a task', kind: 'quiet', attrs: { 'data-pj-menu': 'task' } }) });
    const done = tasksOf(p.id).filter(({ t }) => ['ok', 'merged'].includes(tone(t)) && !waitingOn(p.id, t)).slice(0, 5);
    const lately = done.length ? R.list({ groups: [{ title: 'Lately', rows: done.map(({ t, c }) => R.listRow({ title: t.title, meta: t.detail || '', mark: R.kindMark({ kind: 'task', tone: tone(t), stage: t.stage, title: t.detail }), open: { 'data-pj-open': `${c.id}|${t.title}`, title: `Opens ${t.title} in its chat` } })) }] }) : '';
    const sets = R.settingsSection({ title: 'How its tasks run', meta: 'Yours from Settings until you change them here.', rows: SETS.map((x) => { const def = defOf(p, x), v = p.sets?.[x.id] || def;
      return R.settingsRow({ name: x.name, sentence: `${esc(x.words)} ${pick(`pjs-${x.id}`, v, x.items, x.name, x.id === 'memory' && !p.teamMemory ? TEAM_NOTES : [])}`, changed: v !== def ? [{ name: x.name, was: def }] : false, end: v !== def ? R.button({ label: 'Use yours', kind: 'quiet', attrs: { 'data-pj-reset': x.id, title: `Back to your ${def}` } }) : '' }); }).join('') });
    const setsNow = adv() || setsOpen ? sets : ''; const setsTog = adv() ? '' : `<div class="wf-acts open-line">${R.button({ label: setsOpen ? 'Hide how its tasks run' : 'How its tasks run', kind: 'quiet', icon: R.icon(setsOpen ? 'chevron' : 'chevR', 12), attrs: { 'data-pj-sets': '', 'aria-expanded': String(setsOpen), 'data-folds': '.pj-sets' } })}</div>`;
    const team = R.shows('expert') ? R.settingsSection({ title: 'Team', rows: R.settingsRow({ name: 'Team memory', sentence: p.teamMemory ? 'The team\'s notes for this project are on its worca-memory branch' : 'No team notes yet', end: R.switchButton({ on: !!p.teamMemory, label: 'Team memory', attrs: { 'data-pj-team': p.id } }) }) }) : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${crumb}${head}${strip}
      <p class="convo-head">${list.length ? (counts.length === 1 && counts[0][0] === 'ask' ? '' : `On it now: ${counts.map(([k, n]) => `${n} ${k === 'ask' && n === 1 ? 'needs you' : WORD[k]}`).join(', ')}`) : ''}</p>${tasks}${SPEND[p.id] ? R.factsLine([{ n: `$${SPEND[p.id][0]}`, word: 'this month', attrs: { 'data-pj-spend': '', title: 'Opens Insights › Spend' } }, { n: String(taskCount(p.id)), word: taskCount(p.id) === 1 ? 'task' : 'tasks', attrs: { 'data-pj-menu': 'tasks', title: 'Opens Tasks, from this project' } }]) : ''}${lately}${defaults(p, homes)}${setsTog}${setsNow ? `<div class="pj-sets">${setsNow}</div>` : ''}${team}
    </div></div><div class="convo-dock" id="pj-dock"></div></div>`;
  }

  // the home: Simple the list; from Advanced each workspace one box (panel.workspace-map). Chat first: it ends with the composer; by hand stays, quiet
  const adv = () => R.shows('advanced'), spaces = () => (adv() ? window.RailSpaces?.list() || [] : []);
  const loose = () => data.projects.filter((p) => !window.RailSpaces?.member(p.id));
  const rowsHtml = (l) => R.list({ groups: [{ rows: l.map((p) => R.listRow({ title: p.id, meta: [endOf(p), p.ahead ? `${p.ahead} ${p.ahead === 1 ? 'commit' : 'commits'} here, ${p.behind} on origin` : ''].filter(Boolean).join(' · '), mark: mark(p), open: { 'data-pj-go': p.id, title: `Opens ${p.id}` } })) }] });
  const SPEND = { 'billing-api': [186, 12], 'web-app': [131, 14], 'worca-cc': [72, 22], 'docs-site': [23, 1] };   // as Insights counts them
  // the bar's Needs you, whatever the page or a count says about it: one list
  function needRows() {
    if (!adv() || view.by !== 'workspace') return data.projects.filter(needs).map((p) => ({ go: p.id, name: p.id }));
    return [...spaces().filter((w) => window.RailSpaces.toneOf(w) !== 'idle').map((w) => ({ go: `ws:${w.id}`, name: w.title })), ...loose().filter(needs).map((p) => ({ go: p.id, name: p.id }))];
  }
  // how many need you, in one unit wherever it is said: projects (one in two workspaces once; a workspace that only has a question is one)
  const needCount = () => data.projects.filter(needs).length + (adv() && view.by === 'workspace' ? spaces().filter((w) => window.RailSpaces.toneOf(w) !== 'idle' && !w.projects.some(([id]) => data.projects.some((p) => p.id === id && needs(p)))).length : 0);
  function homeHtml() {
    const need = needRows();
    const head = R.placeHead({ title: 'Your projects', facts: esc(`${data.projects.length} ${data.projects.length === 1 ? 'project' : 'projects'}${spaces().length ? ` in ${spaces().length} ${spaces().length === 1 ? 'workspace' : 'workspaces'}, ${loose().length} on their own` : ''}`), ...(need.length ? { mark: R.kindMark({ kind: adv() ? 'workspace' : 'project', tone: 'ask' }), word: `${needCount()} ${needCount() === 1 ? 'project needs' : 'projects need'} you`, why: '', action: R.button({ label: `Open ${need[0].name}`, attrs: { 'data-pj-go': need[0].go } }) } : {}) });
    const list = adv() ? '' : `<div class="convo-col">${rowsHtml([...data.projects.filter(needs), ...data.projects.filter((p) => !needs(p))])}</div>`;   // the bar's order
    const say2 = adv() && !spaces().length ? '<p class="ws-about">A workspace is projects that work together: Worca learns how they connect, and changes them in the right order.</p>' : '';
    const fields = form === 'project' ? R.field({ id: 'pj-hand-v', label: 'Folder or repository', placeholder: '~/src/your-project', value: formTyped, error: formErr }) : R.field({ id: 'pj-hand-v', label: 'Its name', placeholder: 'Web shop', value: formTyped, error: formErr });
    const hand = form ? `<div class="card-form">${R.confirmForm({ form: 'hand', id: 'pj-hand-t', text: form === 'project' ? 'Add a project by hand' : 'Make a workspace by hand', body: fields + R.confirmActions({ yes: form === 'project' ? 'Add' : 'Make it' }) })}</div>` : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${say2}${hand}</div>${list}</div><div class="convo-dock" id="pj-dock"></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'projects';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    if (current.includes('@') && !adv()) { window.RailShell.go(`projects/${pid()}`); return; }   // "through a workspace" is an Advanced address
    ctl?.paint();
    if (current.startsWith('ws:')) { if (!adv()) { window.RailShell.go('projects'); return; } window.RailSpaces.render(page, current.slice(3)); return; }
    const p = data.projects.find((x) => x.id === pid());
    if (!p) { page.innerHTML = homeHtml(); window.RailConversation?.dock(document.getElementById('pj-dock'), { kind: 'project', title: 'your projects', chat: '' }); return; }
    page.innerHTML = pageHtml(p);
    window.RailConversation?.dock(document.getElementById('pj-dock'), { kind: 'project', title: p.id, chat: '' });
  }
  const closeForm = () => { form = ''; formTyped = ''; formErr = ''; draw(); };
  function wire(b, pg) {
    bar = b; page = pg;
    // the bar (list.bar-model): what needs you first; a workspace over its projects, a healthy one folded; a project in two is under both, its address says through which
    const kid = (w) => ([id]) => { const p = data.projects.find((x) => x.id === id), addr = `${id}@${w.id}`; return p ? { ...rowOf(p), key: `proj:${id}:${w.id}`, _addr: addr, current: current === addr || (current === id && firstHome(id) === w.id) } : { key: `m:${id}:${w.id}`, _addr: '', title: id, mark: R.kindMark({ kind: 'project' }), end: '', tip: `${id}: a folder in this workspace` }; };
    const spaceRow = (w) => ({ key: `ws:${w.id}`, _w: w, title: w.title, mark: R.kindMark({ kind: 'workspace', tone: window.RailSpaces.toneOf(w), breathe: window.RailSpaces.toneOf(w) !== 'idle' && `ws:${w.id}` !== current }), end: window.RailSpaces.rowWord(w), current: `ws:${w.id}` === current, tip: `${w.title}\n${window.RailSpaces.hint(w)}`, tree: w.projects.map(kid(w)), treeShut: window.RailSpaces.toneOf(w) === 'idle', menu: window.RailSpaces.menu(w, true) });
    const treeOn = () => adv() && view.by === 'workspace';
    ctl = R.listController({ root: bar, spec: { noun: 'projects', label: 'Selected projects', view: () => { const test = SHOWS.find((x) => x.id === view.show).test;
      const parts = [{ word: 'Showing', id: 'show', text: SHOWS.find((x) => x.id === view.show).text, tip: 'Which projects the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, checked: view.show === x.id, hint: String(x.id === 'needs' ? needCount() : data.projects.filter(x.test).length) })) }, ...(adv() ? [{ word: 'by', id: 'by', text: view.by, tip: 'How they are grouped', items: ['workspace', 'name'].map((x) => ({ id: x, text: x, checked: view.by === x })) }] : [])];
      if (treeOn()) { const needsS = (w) => window.RailSpaces.toneOf(w) !== 'idle', keep = (w) => view.show === 'all' || (view.show === 'needs' && needsS(w)) || w.projects.some(([id]) => { const p = data.projects.find((x) => x.id === id); return p && test(p); }), filt = (r) => ({ ...r, tree: view.show === 'all' ? r.tree : r.tree.filter((c) => { const p = c._p; return p && test(p); }) });
        const L = loose().filter(test);
        return { state: 'ready', parts, sections: [{ id: 'needs', title: R.runState('question').word, count: ['all', 'needs'].includes(view.show) ? needCount() : undefined, rows: [...spaces().filter((w) => needsS(w) && keep(w)).map(spaceRow).map(filt).map((r) => { const t = r.tree.filter((c) => (c._p && needs(c._p)) || c.current); const left = r.tree.length - t.length, w2 = r._w.id; if (!left) return r; if (showAll.has(w2)) return { ...r, tree: [...r.tree, { key: `less:${w2}`, _less: w2, title: 'Show fewer', mark: '', end: '', tip: `Back to what needs you in ${r.title}` }] }; return { ...r, tree: [...t, { key: `more:${w2}`, _more: w2, title: `${left} more`, mark: '', end: '', tip: `Shows the other ${left} projects of ${r.title}` }] }; }), ...L.filter(needs).map(rowOf)] }, { id: 'spaces', title: 'Workspaces', rows: spaces().filter((w) => !needsS(w) && keep(w)).map(spaceRow).map(filt) }, { id: 'loose', title: 'Not in a workspace', rows: L.filter((p) => !needs(p)).map(rowOf) }].filter((x) => x.rows.length), empty: { text: 'No projects yet.', action: 'Add project' } }; }
      const l = data.projects.filter(test).sort((a, b) => (view.by === 'name' ? a.id.localeCompare(b.id) : 0));
      return { state: 'ready', parts, sections: [{ id: 'needs', title: R.runState('question').word, rows: l.filter(needs).map(rowOf) }, { id: 'all', title: 'Projects', rows: l.filter((p) => !needs(p)).map(rowOf) }].filter((x) => x.rows.length), empty: { text: 'No projects yet.', action: 'Add project' } }; },
      can: () => ['menu'], bulk: () => [], act: (id, rows) => { if (rows[0]?._w) window.RailSpaces.act(id, rows[0]._w); else act(id, rows); }, open: (r) => { if (r._more) { showAll.add(r._more); ctl.paint(); return; } if (r._less) { showAll.delete(r._less); ctl.paint(); return; } if (r._w) window.RailShell.go(`projects/ws:${r._w.id}`); else if (r._addr) window.RailShell.go(`projects/${r._addr}`); else if (r._p) window.RailShell.go(`projects/${r._p.id}`); else say(`${r.title} is a folder in this workspace, not added as a project`); }, word: (id, v) => { view[id] = v; return false; }, say,
      active: () => /^#projects/.test(location.hash), emptyAct: () => window.RailConversation?.starter('project') } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit;
      if ((hit = on('[data-pj-go]'))) { window.RailShell.go(`projects/${hit.dataset.pjGo}`); return; }
      if (current.startsWith('ws:')) return;   // the workspace has its own
      if (form && (hit = on('[data-confirm]'))) { const v = page.querySelector('#pj-hand-v')?.value.trim() || '', kind = form; if (hit.dataset.confirm !== 'yes') { closeForm(); return; } const id = kind === 'project' ? v.split('/').filter(Boolean).pop() || '' : '', wrong = !v || (kind === 'project' && !id) ? (kind === 'project' ? 'It needs a folder or a repository' : 'It needs a name') : kind === 'project' ? (data.projects.some((x) => x.id === id) ? `${id} is already a project` : '') : (window.RailSpaces.named(v) ? `${window.RailSpaces.named(v).title} already exists` : ''); if (wrong) { formTyped = v; formErr = wrong; draw(); page.querySelector('#pj-hand-v')?.focus(); return; } form = ''; formTyped = ''; formErr = ''; if (kind === 'project') { window.RailProjects.add({ id, path: v, kind: 'Git', origin: 'local', branch: 'main' }); say(`Added ${id}`); window.RailShell.go(`projects/${id}`); return; } const wsId = window.RailSpaces.add({ title: v, fresh: true }); window.RailShell.go(`projects/ws:${wsId}`); return; }
      const p = data.projects.find((x) => x.id === pid()); if (!p || !page.querySelector('#pj-dock')) return;
      if (defaultsClick(e, p, draw)) return;      if (on('[data-pj-spend]')) { window.RailShell.go('insights/spend'); return; }
      if (on('[data-pj-sets]')) { setsOpen = !setsOpen; draw(); return; }
      if ((hit = on('[data-pj-act]'))) { originAct(p); return; }
      if ((hit = on('[data-pj-open]'))) { const [cid, title] = hit.dataset.pjOpen.split('|'); window.RailShell.openTask(window.RailChats.data().chats.find((c) => c.id === cid)?.tasks.find((t) => t.title === title)?.case || '', cid, title); return; }
      if ((hit = on('[data-pj-reset]'))) { delete p.sets[hit.dataset.pjReset]; draw(); say('Back to yours'); return; }
      if ((hit = on('[data-pj-team]'))) { p.teamMemory = !p.teamMemory; if (p.sets) delete p.sets.memory; draw(); say(p.teamMemory ? 'Team memory on' : 'Team memory off'); return; }
      if ((hit = on('[data-confirm]'))) { if (hit.dataset.confirm === 'yes') { const i = data.projects.indexOf(p), back = window.RailSpaces?.forget(p.id); data.projects.splice(i, 1); confirm = null; current = ''; say(`Removed ${p.id}`, { tip: 'Puts it back', run: () => { data.projects.splice(i, 0, p); back?.(); draw(); } }); window.RailShell.go('projects'); } else { confirm = null; draw(); } return; }
      if ((hit = on('[data-pj-menu]'))) { act(hit.dataset.pjMenu, [{ _p: p }]); return; }
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
        if (id === 'pj-more') { if (v === 'fetch') { p.checked = 'just now'; draw(); say(`Checked ${p.base || p.id}`); } else if (v === 'remote') { p.origin = 'ok'; p.base = 'origin/main'; draw(); say('Linked origin; nothing was pushed'); } else act(v, [{ _p: p }]); return; }
        if (id.startsWith('pj-pay-')) { if (v !== 'ask') { const was = p.tags || []; p.tags = [...was, v]; draw(); say(`New tasks here charge ${v}`, () => { p.tags = was; draw(); }); } else draw(); return; }
        if (id.startsWith('pjs-')) { const x = SETS.find((s) => s.id === id.slice(4)); if ((p.sets?.[x.id] || defOf(p, x)) === v) { draw(); return; } p.sets = p.sets || {}; p.sets[id.slice(4)] = v; draw(); say(`${SETS.find((x) => x.id === id.slice(4)).name} for ${p.id}: ${v}`); return; }
      }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    page.addEventListener('keydown', (e) => {
      if (!here() || current.startsWith('ws:')) return;
      if (form && e.target.id === 'pj-hand-v' && ['Enter', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') closeForm(); else page.querySelector('[data-confirm="yes"]')?.click(); return; }
      const p = data.projects.find((x) => x.id === pid()); if (p) defaultsKey(e, p, draw);
    });
    page.addEventListener('submit', (e) => { if (here() && form) e.preventDefault(); });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  window.RailProjects = { sync: (id) => { const p = data.projects.find((x) => x.id === id); if (p?.origin === 'behind') Object.assign(p, { origin: 'ok', behind: 0, checked: 'just now' }); }, spend: (id) => SPEND[id]?.[0] || 0, hint: (id) => { const p = data.projects.find((x) => x.id === id); return p ? (p.origin === 'behind' ? `${p.behind} behind` : shortOf(p) || '') : ''; }, list: () => data.projects, add: (p) => { if (!data.projects.some((x) => x.id === p.id)) data.projects.push({ kind: 'Git', origin: 'local', branch: 'main', ...p }); ctl?.paint(); } };
  if (window.RailFirstRun) data.projects = [];   // the first run: nothing added yet
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.projects = { has: (a) => (a.startsWith('ws:') ? (window.RailSpaces?.list() || []).some((w) => w.id === a.slice(3)) : data.projects.some((p) => p.id === a.split('@')[0])), defaults: defaultsRows, defaultsClick, defaultsKey, redraw: () => draw(), newMenu: () => [{ header: 'Ask in chat' }, { id: 'bar-new|project', text: 'Add a project' }, ...(adv() ? [{ id: 'bar-new|workspace', text: 'Make a workspace' }] : []), { sep: true }, { header: 'Legacy approach' }, { id: 'bar-new|hand-project', text: 'Add a project…' }, ...(adv() ? [{ id: 'bar-new|hand-space', text: 'Make a workspace…' }] : [])], newPick: (id) => { if (id === 'project' || id === 'workspace') { window.RailConversation?.starter(id); return; } form = id === 'hand-project' ? 'project' : 'space'; if (current) window.RailShell.go('projects'); setTimeout(() => { draw(); page?.querySelector('#pj-hand-v')?.focus(); }, 60); }, search: (q) => [...data.projects.filter((p) => `${p.id} ${p.path}`.toLowerCase().includes(q)).map((p) => ({ label: p.id, where: wordOf(p), hash: `projects/${p.id}` })), ...spaces().filter((w) => w.title.toLowerCase().includes(q)).map((w) => ({ label: w.title, where: 'Workspace', hash: `projects/ws:${w.id}` }))], sample: 'billing-api', newLabel: 'Add project', newAct: () => window.RailConversation?.starter('project'),
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) { menu = ''; if (confirm?.p?.id !== arg) confirm = null; } current = arg || ''; draw(); } };
})();
