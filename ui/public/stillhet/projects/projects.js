// Projects on Rail (Wave 3, 3.1): dev's functions, Rail's design. The list in the one bar (the list sentence, one-line
// rows, a project's state on its mark); a project's page as a PlaceHead, then what runs in it, then its own settings as
// sentences that say where each value comes from, then the composer. Adding a project is a conversation (Chat's
// Add project card), so the bar's + arms it there.
(function () {
  const R = window.RailUI;
  const esc = R.esc;   // the library's: it escapes the double quote too
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  // dev's origin states (branch-sync), each with its words, how it stands and its one way on
  const ORIGIN = {
    ok: { word: 'Up to date', tone: 'idle', short: '' },
    behind: { word: 'Your copy is older', why2: (p) => `${p.behind} behind ${p.base}; new tasks start from origin`, tone: 'idle', short: () => '', quiet: true, act: 'Sync', why: 'Fast-forwards to the remote; nothing of yours is touched' },
    diverged: { word: 'Out of sync', why2: (p) => `${p.ahead} ahead, ${p.behind} behind ${p.base} · the next task asks how to bring them together`, tone: 'ask', short: 'Out of sync', act: 'Bring together…', why: 'Asks Worca in a chat how to bring both sides together' },
    offline: { word: "Can't reach origin", tone: 'fail', short: 'Offline', act: 'Retry', why: 'Fetches again' },
    uncommitted: { word: 'Uncommitted changes', tone: 'act', short: 'Uncommitted' },
    local: { word: 'Only on this computer', why2: () => 'Worca works here; nothing leaves it until you link a repository', tone: 'idle', short: '', quiet: true, act: 'Link a repository…', why: 'Adds the repository as origin; nothing is pushed' },
    folder: { word: 'No git', tone: 'idle', short: '', act: 'Use git', why: 'Runs git init; the first task commits what is there' },
    missing: { word: 'Folder missing', tone: 'fail', short: 'Folder missing', act: 'Locate folder…', why: 'Tell Worca where it moved; or remove it from the menu' },
  };
  // the live kind (D9): the store's projects, read on every read; the demo's seed otherwise
  const W = window.RailWorld;
  const nameOf = (p) => p.name || p.id;   // live: dev's name (the id is its key); the demo's id is its name
  // the live kind (D8): a project's own actions are the Projects slice's; until then they write nothing and say so
  const notLive = (p, what) => { if (!W?.live) return false; say(`${p ? `${nameOf(p)}: ` : ''}${what} is not in Stillhet yet. It is on the wiring list.`); return true; };
  let seeded;
  const data = { get projects() { return W?.live ? W.part('projects') : seeded; }, set projects(v) { seeded = v; } };
  data.projects = [
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
  ];
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
  let bellHeard = -1, drawn = '', current = '', menu = '', confirm = null, ctl = null, bar = null, page = null, form = '', formTyped = '', formErr = '', setsOpen = false, locating = '';
  const NAME_MAX = 80, TAG_MAX = 40;   // form.name-limit; small.label-short
  // what Worca can go and look at: a full path, or (adding) a repository's address; nothing else leaves this form
  const pathWrong = (v, repo) => (/[<>"`|*?\x00-\x1f]/.test(v) ? 'A path has no < > " ` | * or ?' : (repo && /^(https?:\/\/|ssh:\/\/|git@)\S+$/.test(v)) || /^~?(\/[^/]+)+\/?$/.test(v) ? '' : `Give its full path, such as ~/src/your-project${repo ? ', or a repository address' : ''}`);
  const ADVANCED_SETS = ['branch', 'memory', 'setup'];   // patterns, the team's notes and your Claude Code setup start at Advanced
  const newTaskItem = (p) => ({ id: 'task', text: 'New task here', ...(p.origin === 'missing' ? { off: true, help: 'Its folder is missing: locate it first' } : { help: 'The composer, on this project' }) });
  const fetchItem = (p) => ({ id: 'fetch', text: 'Check origin now', help: noOrigin(p) || 'Fetches; moves nothing', off: !!noOrigin(p) });
  const o = (p) => ORIGIN[p.origin];
  const wordOf = (p) => (typeof o(p).word === 'function' ? o(p).word(p) : o(p).word);
  const shortOf = (p) => (typeof o(p).short === 'function' ? o(p).short(p) : o(p).short);
  const tasksOf = (id) => (window.RailChats?.data().chats || []).filter((c) => c.project === id).flatMap((c) => (c.tasks || []).filter((t) => t.kind !== 'schedule').map((t) => ({ t, c })));
  const toneOfTask = (t) => R.markTone(R.runState(window.RunCardModel.stateOf(t.case)));
  const inTasksNeeds = (id, t) => (window.RailWorld?.tops() || []).some((x) => !x.archived && x.section === 'needs' && x.project === id && x.title === t.title);
  const waitingOn = (id, t) => ['ask', 'act'].includes(toneOfTask(t)) || inTasksNeeds(id, t);   // the same rows as Tasks' Needs you: an approved task ready to merge waits on you too
  const asking = (p) => tasksOf(nameOf(p)).filter(({ t }) => waitingOn(nameOf(p), t)).sort((a, b) => R.alertLevel(toneOfTask(b.t)) - R.alertLevel(toneOfTask(a.t)));   // the tasks here waiting on you, highest level first (look.alert-ladder)
  // ---- how a project stands: one answer for its card, its bar row and the bell (panel.center-shelf) ----
  const C = () => window.RailCenters, List = () => window.RailRunsList, Sch = () => window.RailSchedules;
  const link = (label, hook, tip) => R.textLink({ label, attrs: { ...hook, title: tip || null } });
  const inCenter = () => !!(C() && List()?.rows && Sch()?.all);
  function standing(p) {
    const rows = inCenter() ? List().rows().filter((t) => t.project === nameOf(p)) : [], c = (sec) => rows.filter((t) => t.section === sec), scheds = inCenter() ? Sch().all().filter((s) => s.project === nameOf(p)) : [];
    const tasks = c('needs').map(C()?.taskOf || (() => null)).filter(Boolean).sort((a, b) => R.taskRank(C().stateOf(a)) - R.taskRank(C().stateOf(b)));
    const missed = scheds.filter((s) => s.section === 'needs'), running = c('running'), waiting = c('scheduled'), live = scheds.filter((s) => Sch().running(s.id));
    const top = tasks[0], stopped = o(p).tone === 'fail', split = p.origin === 'diverged';
    const originBtn = (kind) => R.button({ label: o(p).act, kind, attrs: { 'data-pj-home-act': p.id, title: o(p).why } });
    const verb = stopped || (!top && split) ? (o(p).act || 'Open').replace(/…$/, '') : top ? R.cardAction(C().stateOf(top)).label : missed.length ? 'Run now' : 'Open';   // what its other workspace says: Answer there
    const base = { p, tasks, missed, running, waiting, live, verb };
    if (stopped) return { ...base, word: wordOf(p), tone: 'fail', kind: 'project', rank: 0, what: p.origin === 'missing' ? `${esc(p.path)} is gone; nothing can start here until it is back` : `Worca can't reach ${esc(p.base || 'origin')}`, action: originBtn('primary') };
    if (top) { const id = C().stateOf(top), tone = R.markTone(R.runState(id)); return { ...base, word: R.needsReason(id), tone, kind: 'task', rank: R.taskRank(id), what: `${tasks.slice(0, 2).map(C().clause).join('; ')}${split ? '; its branch is also out of sync' : ''}`, action: C().actionsOf(tasks.slice(0, 2)) }; }
    if (split) return { ...base, word: wordOf(p), tone: 'ask', kind: 'project', rank: 2.3, what: 'Your branch and origin have both moved; the next task asks how to bring them together', action: originBtn('') };
    if (missed.length) return { ...base, word: 'Schedule missed', tone: 'act', kind: 'schedule', rank: 2.5, what: missed.map((s) => `${C().schedLink(s)} missed ${esc(s.missed)} while ${esc(s.missedWhy)}`).join('; '), action: R.button({ label: 'Run now', attrs: { 'data-c-sact': `run|${missed[0].id}`, title: `Runs ${missed[0].title} now to catch up` } }) };
    if (running.length || live.length) { const named = [...running.map(C().taskOf).filter(Boolean).map((t) => link(t.title, { 'data-c-open': t.id }, `Opens ${t.title} in its chat`)), ...live.filter((s) => !running.some((t) => C().taskOf(t)?.title === s.title)).map((s) => C().schedLink(s))], shown = named.slice(0, 2), more = named.length - shown.length; return { ...base, word: R.runState('working').word, tone: 'run', kind: 'task', rank: 5, what: `${shown.join(' and ')}${more ? ` and ${more} more` : ''} ${named.length === 1 ? 'is' : 'are'} running`, action: openBtn(p), sentenceRuns: true }; }
    if (p.origin === 'behind') return { ...base, word: wordOf(p), tone: 'idle', kind: 'project', rank: 4, what: 'New tasks start from origin; syncing touches nothing of yours', action: originBtn('quiet') };
    return { ...base, word: '', tone: 'idle', kind: 'project', rank: 9, what: 'Nothing is going on here.', action: openBtn(p), quiet: true };
  }
  const openBtn = (p) => R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-pj-go': p.id, title: `Opens ${nameOf(p)}` } });
  const litTone = (t) => ['fail', 'ask', 'act'].includes(t) || t === 'ok';   // Advisory counts under Needs you too (look.alert-ladder)
  const standsOut = (s) => litTone(s.tone);
  const markOf = (s, size) => R.kindMark({ kind: s.kind, tone: s.tone, advisory: s.tone === 'ok', breathe: standsOut(s), size, title: s.word || undefined });
  const needs = (p) => standsOut(standing(p)) || (inCenter() && standing(p).tasks.length > 0);
  const endOf = (p) => { const s = standing(p), k = s.tasks.length; return k && !['fail'].includes(o(p).tone) ? `${k} ${k === 1 ? 'task needs you' : 'tasks need you'}` : standsOut(s) ? s.word : shortOf(p); };   // "question" is a workspace's: a link Worca is unsure of
  const SHOWS = [{ id: 'all', text: 'all', test: () => true }, { id: 'needs', text: 'needs you', test: needs }, { id: 'behind', text: 'out of sync', test: (p) => p.origin === 'diverged' }, { id: 'folder', text: 'without git', test: (p) => p.kind === 'Folder' }];
  const stateIdOf = (t) => window.RunCardModel.stateOf(t.case);
  const markTone = (p) => (o(p).tone === 'fail' || !asking(p).length ? o(p).tone : ['ask', 'act'].includes(toneOfTask(asking(p)[0].t)) ? 'ask' : toneOfTask(asking(p)[0].t));
  const mark = (p, size) => R.kindMark({ kind: 'project', tone: markTone(p), advisory: markTone(p) === 'ok', size, title: wordOf(p) });
  const rowOf = (p) => ({ key: `proj:${p.id}`, _p: p, title: nameOf(p), mark: standsOut(standing(p)) ? markOf(standing(p)) : mark(p), end: endOf(p), current: p.id === pid() && !(adv() && window.RailSpaces?.member(p.id)), tip: `${nameOf(p)}\n${p.kind} · ${p.path}\n${wordOf(p)}`,
    menu: [...actItem(p), newTaskItem(p), { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' }, fetchItem(p), { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Worca forgets it; its folder and tasks stay' }] });
  function actItem(p) { return o(p).act ? [{ id: 'act', text: o(p).act, help: o(p).why }] : []; }
  // what there is to fetch from: why not, when there is nothing
  const noOrigin = (p) => (p.origin === 'missing' ? 'Its folder is missing: nothing to check' : p.kind === 'Folder' ? 'It has no git: nothing to check' : p.origin === 'local' ? 'No origin linked yet: nothing to check' : '');
  // what Tasks lists for this project: the very rows of that list
  const taskCount = (id) => (window.RailRunsList?.rows() || []).filter((t) => t.project === id).length;

  function act(id, rows) {
    const p = rows[0]?._p; if (!p) return;
    if (id === 'act') return originAct(p);
    if (id === 'task') { window.RailConversation?.handOver({ mode: 'task', project: p.id, ref: { pageProjectKey: p.id }, about: { kind: 'Project', name: nameOf(p) } }); return; }
    if (id === 'tasks') { window.RailRunsList.filter({ project: nameOf(p) }); return; }
    if (id === 'fetch') { if (notLive(p, 'Check origin now')) return; p.checked = 'just now'; draw(); say(`Checked ${p.base || p.id}`); return; }
    if (id === 'remove') { if (notLive(p, 'Remove')) return; current = p.id; confirm = { what: 'remove', p }; window.RailShell.go(`projects/${p.id}`); }
  }
  function originAct(p) {
    if (p.origin !== 'diverged' && notLive(p, (o(p).act || '').replace(/…$/, ''))) return;   // diverged hands over to a chat: nothing written
    if (p.origin === 'behind') { const n = p.behind; Object.assign(p, { origin: 'ok', behind: 0, checked: 'just now' }); draw(); say(`Synced ${p.id}: ${n} ${n === 1 ? 'commit' : 'commits'} from ${p.base}`); return; }
    if (p.origin === 'diverged') { window.RailConversation?.handOver({ project: p.id, ref: { pageProjectKey: p.id }, about: { kind: 'Project', name: nameOf(p) }, text: `It has diverged from ${p.base}: ${p.ahead} ahead, ${p.behind} behind. How should we bring them together?` }); return; }
    if (p.origin === 'local') { p.origin = 'ok'; p.base = 'origin/main'; draw(); say('Linked origin; nothing was pushed'); return; }
    if (p.origin === 'offline') { p.origin = 'ok'; p.checked = 'just now'; draw(); say(`Reached ${p.base}`); return; }
    if (p.origin === 'folder') { Object.assign(p, { kind: 'Git', origin: 'local', branch: 'main' }); draw(); say(`${p.id} uses git now; the first task commits what is there`); return; }
    if (p.origin === 'missing') { confirm = null; form = 'locate'; locating = p.id; formTyped = p.path; formErr = ''; if (pid() !== p.id) window.RailShell.go(`projects/${p.id}`); else draw(); setTimeout(() => { page?.querySelector('#pj-hand-v')?.select(); }, 60); }
  }

  // Every new task here gets (rail: default labels and cost tags): a project's own and each workspace's. Labels add up; a cost tag has one value: the project's own wins, two workspaces that differ make the task's composer ask
  const defaultsRows = (owner, from) => { const tagKey = (t) => t.split(':')[0].trim(), own = owner.tags || [], ownL = owner.labels || [], got = from.flatMap((w) => (w.tags || []).filter((t) => !own.some((o) => tagKey(o) === tagKey(t))).map((t) => [t, w])), keys = got.map(([t]) => tagKey(t)), clash = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i && got[i] && got[keys.indexOf(k)][0] !== got[i][0]))];
    const labels = [...new Set([...from.flatMap((w) => w.labels || []), ...ownL])], tags = [...own, ...[...new Map(got.filter(([t]) => !clash.includes(tagKey(t))).map(([t]) => [t, t])).keys()]];
    const row = (name, kind, list, field) => R.settingsRow({ name, sentence: owner.editing === field ? R.field({ id: `def-${field}`, label: name, quietLabel: true, value: owner.defTyped ?? (field === 'tags' ? own : ownL).join(', '), error: owner.defErr || '', placeholder: field === 'tags' ? 'team: web, cost-center: 4410' : 'hotfix, billing', attrs: { 'data-def-input': field } }) : list.length ? list.map((text) => R.chip({ text, title: text })).join(' ') : '<span class="set-from">None</span>', end: R.button({ label: owner.editing === field ? 'Done' : 'Change', kind: 'quiet', attrs: { 'data-def-edit': field } }) });
    return R.settingsSection({ title: 'Every new task here gets', meta: 'A task can change its own.', rows: row('Cost tags', 'tag', tags, 'tags') + row('Labels', 'label', labels, 'labels') + (clash.length ? R.settingsRow({ name: 'Who pays', sentence: `${esc(from.map((w) => w.title).join(' and '))} name different ${clash.map(esc).join(', ')}s. ${clash.map((k, i) => `Charge new tasks to ${R.sentencePicker({ id: `pj-pay-${i}`, text: 'each task asks', tip: 'Who pays', items: [{ id: 'ask', text: 'each task asks', checked: true }, ...[...new Set(got.filter(([t]) => tagKey(t) === k).map(([t]) => t))].map((t) => ({ id: t, text: t }))], open: menu === `pj-pay-${i}`, chevron: R.icon('chevron', 10) })}`).join(' ')}` }) : '') }); };
  const defaults = (owner, from) => defaultsRows(owner, from);
  // what was typed: no repeats, and a cost tag has one value, so a key given twice keeps its last
  const tidyTag = (t) => t.split(':').map((x) => x.trim()).join(': ');   // "team:web" and "team: web" are one value
  const defaultsParse = (f, v) => { const l = [...new Set(v.split(',').map((x) => (f === 'tags' ? tidyTag(x) : x.trim())).filter(Boolean))]; return f === 'tags' ? [...new Map(l.map((t) => [t.split(':')[0].trim(), t])).values()] : l; };
  // what a cost tag or label may be: small.label-short, and a cost tag is key: value
  const defaultsWrong = (f, l) => { const bad = l.find((t) => /[<>]/.test(t)); if (bad) return 'No < or > in it'; const long = l.find((t) => t.length > TAG_MAX); if (long) return `${f === 'tags' ? 'A cost tag' : 'A label'} holds ${TAG_MAX} characters; "${long.slice(0, 12)}…" has ${long.length}`; const odd = f === 'tags' && l.find((t) => !/^[^:]+: [^:]+$/.test(t)); return odd ? `A cost tag is key: value, such as team: web; "${odd}" is not` : ''; };
  const defaultsClick = (e, owner, repaint) => { const hit = e.target.closest('[data-def-edit]'); if (!hit) return false; const f = hit.dataset.defEdit, closing = owner.editing === f; if (closing) { const typed0 = document.getElementById(`def-${f}`)?.value || '', list0 = typed0.split(',').map((x) => (f === 'tags' ? tidyTag(x) : x.trim())).filter(Boolean), wrong = defaultsWrong(f, list0); if (wrong) { owner.defErr = wrong; owner.defTyped = typed0; repaint(); document.getElementById(`def-${f}`)?.focus(); return true; } delete owner.defErr; delete owner.defTyped; const typed = typed0, v = defaultsParse(f, typed), was = [...(owner[f] || [])].sort().join(', '), oneValue = f === 'tags' && v.length < new Set(typed.split(',').map(tidyTag).filter(Boolean)).size; owner[f] = v; owner.editing = ''; if ([...v].sort().join(', ') !== was) say(!v.length ? `No ${f === 'tags' ? 'cost tags' : 'labels'} of its own now` : oneValue ? `A cost tag has one value: kept ${v.join(', ')}` : 'Kept for every new task here'); } else { delete owner.defErr; delete owner.defTyped; owner.editing = f; } repaint(); if (!closing) document.getElementById(`def-${f}`)?.focus(); return true; };
  const defaultsKey = (e, owner, repaint) => { const f = e.target.dataset?.defInput; if (!f || owner.editing !== f || !['Enter', 'Escape'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const done = () => e.currentTarget?.querySelector?.(`[data-def-edit="${f}"]`); if (e.key === 'Enter') { done()?.click(); return; } const root = e.currentTarget; owner.editing = ''; delete owner.defErr; delete owner.defTyped; repaint(); root?.querySelector?.(`[data-def-edit="${f}"]`)?.focus(); };
  function pageHtml(p) {
    const pick = (id, text, items, tip, off = []) => R.sentencePicker({ id, text, tip, items: items.map((x) => ({ id: x, text: x, checked: x === text, off: off.includes(x), help: off.includes(x) ? 'Team memory is off for this project' : '' })), open: menu === id, chevron: R.icon('chevron', 10) });
    const via = current.split('@')[1] || firstHome(p.id), homes = adv() ? window.RailSpaces?.list().filter((w) => w.projects.some(([x]) => x === p.id)) || [] : [], here2 = homes.find((w) => w.id === via), also = homes.filter((w) => w !== here2);
    const crumb = '';   // the trail in the head holds it (nav.center-home)
    const waits = asking(p), first = waits[0];   // a question waiting leads; how the project stands comes after it
    const head = R.placeHead({ center: { label: 'Projects', to: 'projects', via: adv() && here2 ? [{ label: here2.title, attrs: { 'data-pj-go': `ws:${here2.id}` } }] : [] }, title: nameOf(p), facts: esc([also.length ? `Also in ${also.map((w) => w.title).join(', ')}` : '', p.kind, p.path, p.branch].filter(Boolean).join(' · ')), mark: mark(p), word: first ? (waits.length === 1 ? '1 task needs you' : `${waits.length} tasks need you`) : wordOf(p), why: first ? (p.origin === 'ok' ? '' : wordOf(p)) : o(p).why2 ? o(p).why2(p) : p.checked ? `Checked ${p.checked}` : p.files ? `${p.files} files` : '',
      action: first ? R.button({ label: R.cardAction(stateIdOf(first.t)).label, kind: toneOfTask(first.t) === 'fail' ? 'primary' : '', attrs: { 'data-pj-open': `${first.c.id}|${first.t.title}`, title: `Opens ${first.t.title} in its chat` } }) : o(p).act ? R.button({ label: o(p).act, kind: o(p).quiet ? 'quiet' : '', attrs: { 'data-pj-act': p.id, title: o(p).why } }) : '',
      menu: R.moreMenu({ id: 'pj-more', label: `More for ${nameOf(p)}`, icon: R.icon('more', 16), open: menu === 'pj-more', items: [...(first ? actItem(p) : []), newTaskItem(p), { id: 'tasks', text: 'Show its tasks', help: 'Tasks, from this project' }, fetchItem(p), ...(p.kind === 'Git' && p.origin === 'local' ? [{ id: 'remote', text: 'Link a remote…', help: 'Adds the repository as origin; nothing is pushed' }] : []), { sep: true }, { id: 'remove', text: 'Remove…', danger: true, help: 'Worca forgets it; its folder and tasks stay' }] }) });
    const strip = confirm && confirm.p === p ? R.confirmStrip({ text: `Remove ${nameOf(p)}? Worca forgets it; its folder and its tasks stay, and its schedules stop.`, yes: 'Remove', danger: true }) : '';
    const tone = toneOfTask, list = tasksOf(nameOf(p)).filter(({ t }) => !['ok', 'merged', 'idle'].includes(tone(t)) || waitingOn(nameOf(p), t));   // what is on it now
    const counts = ['run', 'ask', 'fail', 'ok', 'merged'].map((k) => [k, list.filter(({ t }) => (k === 'ask' ? waitingOn(nameOf(p), t) : tone(t) === k && !waitingOn(nameOf(p), t))).length]).filter(([, n]) => n);
    const WORD = { run: 'working', ask: 'need you', fail: 'failed', ok: 'ready', merged: 'merged' };
    const tasks = list.length ? R.list({ groups: [{ rows: list.map(({ t, c }) => R.listRow({ title: t.title, meta: t.detail || '', mark: R.kindMark({ kind: 'task', tone: tone(t), stage: t.stage, title: t.detail }), open: { 'data-pj-open': `${c.id}|${t.title}`, title: `Opens ${t.title} in its chat` } })) }] })
      : R.emptyState({ title: p.origin === 'missing' ? 'Nothing can start here until its folder is back.' : 'Nothing is on it now.', actions: p.origin === 'missing' ? '' : R.button({ label: 'Start a task', kind: 'quiet', attrs: { 'data-pj-menu': 'task' } }) });
    const locate = form === 'locate' && locating === p.id ? `<div class="card-form">${R.confirmForm({ form: 'hand', id: 'pj-hand-t', text: `Where is ${nameOf(p)} now?`, body: R.field({ id: 'pj-hand-v', label: 'Its folder', placeholder: '~/src/your-project', value: formTyped, error: formErr, attrs: { maxlength: 200 } }) + R.confirmActions({ yes: 'Use this folder' }) })}</div>` : '';
    const done = tasksOf(nameOf(p)).filter(({ t }) => ['ok', 'merged'].includes(tone(t)) && !waitingOn(nameOf(p), t)).slice(0, 5);
    const lately = done.length ? R.list({ groups: [{ title: 'Lately', rows: done.map(({ t, c }) => R.listRow({ title: t.title, meta: t.detail || '', mark: R.kindMark({ kind: 'task', tone: tone(t), stage: t.stage, title: t.detail }), open: { 'data-pj-open': `${c.id}|${t.title}`, title: `Opens ${t.title} in its chat` } })) }] }) : '';
    const sets = R.settingsSection({ title: 'How its tasks run', meta: 'Yours from Settings until you change them here.', rows: SETS.filter((x) => adv() || !ADVANCED_SETS.includes(x.id)).map((x) => { const def = defOf(p, x), v = p.sets?.[x.id] || def;
      return R.settingsRow({ name: x.name, sentence: `${esc(x.words)} ${pick(`pjs-${x.id}`, v, x.items, x.name, x.id === 'memory' && !p.teamMemory ? TEAM_NOTES : [])}`, changed: v !== def ? [{ name: x.name, was: def }] : false, end: v !== def ? R.button({ label: 'Use yours', kind: 'quiet', attrs: { 'data-pj-reset': x.id, title: `Back to your ${def}` } }) : '' }); }).join('') });
    const setsNow = adv() || setsOpen ? sets : ''; const setsTog = adv() ? '' : `<div class="wf-acts open-line">${R.button({ label: setsOpen ? 'Hide how its tasks run' : 'How its tasks run', kind: 'quiet', icon: R.icon(setsOpen ? 'chevron' : 'chevR', 12), attrs: { 'data-pj-sets': '', 'aria-expanded': String(setsOpen), 'data-folds': '.pj-sets' } })}</div>`;
    const team = R.shows('expert') ? R.settingsSection({ title: 'Team', rows: R.settingsRow({ name: 'Team memory', sentence: p.teamMemory ? 'The team\'s notes for this project are on its worca-memory branch' : 'No team notes yet', end: R.switchButton({ on: !!p.teamMemory, label: 'Team memory', attrs: { 'data-pj-team': p.id } }) }) }) : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${crumb}${head}${strip}${locate}
      <p class="convo-head">${list.length ? (counts.length === 1 && counts[0][0] === 'ask' ? '' : `On it now: ${counts.map(([k, n]) => `${n} ${k === 'ask' && n === 1 ? 'needs you' : WORD[k]}`).join(', ')}`) : ''}</p>${tasks}${SPEND[p.id] ? R.factsLine([{ n: `$${SPEND[p.id][0]}`, word: 'this month', ...(adv() ? { attrs: { 'data-pj-spend': '', title: `Opens Insights › Spend, of ${p.id}` } } : {}) }, { n: String(taskCount(nameOf(p))), word: taskCount(nameOf(p)) === 1 ? 'task' : 'tasks', attrs: { 'data-pj-menu': 'tasks', title: 'Opens Tasks, from this project' } }]) : ''}${lately}${p.origin === 'missing' ? '' /* nothing can start here: what its tasks would get applies once the folder is back */ : `${defaults(p, homes)}${setsTog}${setsNow ? `<div class="pj-sets">${setsNow}</div>` : ''}${team}`}
    </div></div><div class="convo-dock" id="pj-dock"></div></div>`;
  }

  // the home: Simple the list; from Advanced each workspace one box (panel.workspace-map). Chat first: it ends with the composer; by hand stays, quiet
  const adv = () => R.shows('advanced'), spaces = () => (adv() ? window.RailSpaces?.list() || [] : []);
  const loose = () => data.projects.filter((p) => !window.RailSpaces?.member(p.id));
  const SPEND = { 'billing-api': [186], 'web-app': [131], 'worca-cc': [72], 'docs-site': [23] };   // as Insights counts them
  // the bar counts its own rows, in its unit: projects (one in two workspaces once; a workspace with only a question is one)
  const loneSpaces = () => (adv() && view.by === 'workspace' ? spaces().filter((w) => !w.projects.some(([id]) => data.projects.some((p) => p.id === id && needs(p))) && window.RailSpaces.questions(w).length) : []);
  const needCount = () => data.projects.filter(needs).length + loneSpaces().length;
  // what needs you beyond tasks and missed times, each once: the bell and Pulse's Needs you read this list (small-rules)
  function needItems() {
    // live: a missing folder or out of sync (D22); workspace link questions have no live source in this slice
    if (W?.live) return data.projects.filter((p) => p.needs).map((p) => ({ key: `p:${p.id}`, title: nameOf(p), meta: wordOf(p), kind: 'project', tone: o(p).tone === 'fail' ? 'fail' : 'ask', go: `projects/${p.id}`, project: p.id, tip: `Opens ${nameOf(p)}` }));
    return [...data.projects.filter((p) => o(p).tone === 'fail' || p.origin === 'diverged').map((p) => ({ key: `p:${p.id}`, title: p.id, meta: wordOf(p), kind: 'project', tone: o(p).tone === 'fail' ? 'fail' : 'ask', go: `projects/${p.id}`, project: p.id, tip: `Opens ${p.id}` })),
      ...spaces().flatMap((w) => window.RailSpaces.questions(w).map((l) => ({ key: `q:${w.id}:${l.from}:${l.to}`, title: w.title, meta: `Does ${l.from} ${l.how.replace(/s\b/, '')} ${l.to}?`, kind: 'workspace', tone: 'ask', go: `projects/ws:${w.id}`, project: '', tip: `Opens ${w.title} at its question` })))];
  }
  // a workspace's link Worca is unsure of, as a card
  const qCard = (w, l) => R.pluginCard({ mark: R.kindMark({ kind: 'workspace', tone: 'ask', breathe: true }), word: R.needsReason('question'), tone: 'ask', title: w.title,
    whatHtml: `Does ${link(l.from, { 'data-pj-go': `${l.from}@${w.id}` }, `Opens ${l.from}`)} ${esc(l.how.replace(/s\b/, ''))} ${link(l.to, { 'data-pj-go': `${l.to}@${w.id}` }, `Opens ${l.to}`)}? ${window.RailSpaces.saysSure[l.sure]}`, action: R.button({ label: 'Answer', attrs: { 'data-pj-go': `ws:${w.id}`, title: `Goes to the question in ${w.title}` } }), attrs: { title: l.at || null } });
  const SYNC_TIP = (p) => (p.origin === 'diverged' ? `${p.ahead} ahead, ${p.behind} behind ${p.base}` : p.origin === 'behind' ? `Your copy is older: ${p.behind} behind ${p.base}` : p.origin === 'missing' ? `Last seen ${p.checked}` : p.files ? `No git · ${p.files} files` : '');
  const homesOf = (id) => spaces().filter((w) => w.projects.some(([x]) => x === id));
  const count = (label, f, tip) => link(label, { 'data-c-filter': JSON.stringify(f) }, tip);
  function factsOf(s, extra = []) {
    const p = s.p, nums = [];
    if (s.running.length && !s.sentenceRuns) nums.push(count(`${s.running.length} running`, { project: nameOf(p), show: 'running' }, `Opens what runs in ${nameOf(p)}`));
    if (s.waiting.length) nums.push(count(`${s.waiting.length} waiting`, { project: nameOf(p), show: 'waiting' }, `Opens what waits in ${nameOf(p)}`));
    return [...nums, ...extra.map(esc)].join(' · ');
  }
  function cardOf(s, extra = []) {
    const p = s.p;
    return R.pluginCard({ mark: s.quiet ? R.kindMark({ kind: 'project' }) : markOf(s), word: s.word, tone: s.tone === 'idle' ? '' : s.tone, title: nameOf(p), whatHtml: s.what, factsHtml: factsOf(s, extra), factsTip: '', action: s.action, attrs: { 'data-pc-card': p.id, title: SYNC_TIP(p) || null } });
  }
  // "most urgent" and A–Z, for cards and shelves alike
  const RANKED = { 'most urgent': (a, b) => (!!a.loose - !!b.loose) || a.rank - b.rank, 'A–Z': (a, b) => (!!a.loose - !!b.loose) || a.name.localeCompare(b.name) };   // ties keep the projects' own order; On their own is always the last group
  function shelvesOf() {
    const stand = new Map(data.projects.map((p) => [p.id, standing(p)])), Q_RANK = 2.7;
    const raw = spaces().map((w) => ({ w, name: w.title, ids: w.projects.map(([id]) => id).filter((id) => stand.has(id)), qs: window.RailSpaces.questions(w) }));
    if (loose().length) raw.push({ w: null, loose: true, name: 'On their own', ids: loose().map((p) => p.id), qs: [] });
    raw.forEach((sh) => { sh.rank = Math.min(9, ...(sh.qs.length ? [Q_RANK] : []), ...sh.ids.map((id) => stand.get(id).rank)); });
    const ordered = [...raw].sort(RANKED['most urgent']), homeBy = new Map();   // a project's one card goes to its most urgent workspace
    for (const sh of ordered) for (const id of sh.ids) if (!homeBy.has(id)) homeBy.set(id, sh);
    return { raw, stand, homeBy, sort: (l) => [...l].sort(RANKED[sortBy]) };
  }
  const homeOf = (id) => shelvesOf().homeBy.get(id)?.w?.id;
  let sortBy = 'most urgent', figures = false, quietOpen = new Set(), pickMenu = '';
  const pick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: pickMenu === id, chevron: R.icon('chevron', 10) });
  const center = () => ({ by: adv() && view.by === 'workspace' ? 'workspace' : 'project' });
  function quietOf(key, list, noun = 'project') {
    if (!list.length) return '';
    const open = quietOpen.has(key);
    return `${R.quietLine({ n: list.length, noun, names: list.map((x) => x.name || x.p.id).join(', '), open, hook: { 'data-pc-quiet': key } })}${open && noun === 'project' ? `<div class="pg-grid">${list.map((s) => cardOf(s)).join('')}</div>` : ''}`;
  }
  const also = (s, where) => R.centerAlso({ mark: markOf(s), name: s.p.id, where, link: link(`${s.verb} there`, { 'data-pc-to': s.p.id }, `Goes to its card in ${where}`) });
  function shelfHtml(sh, ctx) {
    const here = sh.ids.filter((id) => ctx.homeBy.get(id) === sh).map((id) => ctx.stand.get(id)), elsewhere = sh.ids.filter((id) => ctx.homeBy.get(id) !== sh && !ctx.stand.get(id).quiet).map((id) => ctx.stand.get(id));
    const shown = here.filter((s) => !s.quiet), quiet = here.filter((s) => s.quiet);
    const cards = ctx.sort([...shown.map((s) => ({ rank: s.rank, name: s.p.id, html: cardOf(s, homesOf(s.p.id).length > 1 ? [`Also in ${homesOf(s.p.id).filter((w) => w !== sh.w).map((w) => w.title).join(', ')}`] : []) })), ...sh.qs.map((l) => ({ rank: 2.7, name: `${sh.name} ${l.from}`, html: qCard(sh.w, l) }))]);
    const top = [...shown].sort((a, b) => a.rank - b.rank)[0], topQ = sh.qs.length && (!top || top.rank > 2.7);
    const word = standsOut(top || {}) ? top.word : topQ ? R.needsReason('question') : '', tone = word ? (topQ ? 'ask' : top.tone) : '';
    const runs = shown.reduce((a, s) => a + s.running.length, 0), facts = figures && runs ? `${runs} running` : '';
    return R.centerShelf({ title: sh.name, count: figures ? `${sh.ids.length} ${sh.ids.length === 1 ? 'project' : 'projects'}` : '', link: sh.w ? link('Workspace map', { 'data-pj-go': `ws:${sh.w.id}` }, `Opens ${sh.w.title} and how its projects connect`) : '', word, tone, facts, cards: cards.map((c) => c.html).join(''), rest: `${elsewhere.map((s) => also(s, ctx.homeBy.get(s.p.id).name)).join('')}${quietOf(`sh:${sh.name}`, quiet)}`, attrs: { 'data-pc-shelf': sh.name } });
  }
  function homeHtml() {
    const ctx = shelvesOf(), { by } = center(), all = [...ctx.stand.values()], lit = all.filter((s) => standsOut(s)), questions = spaces().flatMap((w) => window.RailSpaces.questions(w));
    const says = (n, one, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : '');
    const running = all.reduce((a, s) => a + s.running.length, 0), facts = [says(data.projects.length, 'project'), ...(adv() ? [says(spaces().length, 'workspace'), loose().length ? `${loose().length} on their own` : ''] : []), lit.length ? `${lit.length} need${lit.length === 1 ? 's' : ''} you` : '', adv() ? says(questions.length, 'question') : '', says(all.filter((s) => s.p.origin === 'diverged').length, 'out of sync', 'out of sync'), says(all.filter((s) => s.p.origin === 'behind').length, 'older copy', 'older copies'), running ? count(`${running} running`, { show: 'running' }, 'Opens what is running in Tasks') : ''].filter(Boolean).join(' · ');
    const sent = R.centerSentence({ words: `Showing ${pick('pc-sort', sortBy, Object.keys(RANKED), 'How the cards are ordered')}${adv() ? ` by ${pick('pc-by', by, ['workspace', 'project'], 'What a card is')}` : ''}`, open: figures, attrs: { 'data-pc-figs': '' }, facts });
    const calm = !lit.length && !(adv() && questions.length);
    const head = R.placeHead({ title: 'Your projects', say: calm && data.projects.length ? 'Nothing needs you' : '' });
    const way = adv() ? '' : `<p class="center-way">New work starts in Chat. ${link('Go to Chat', { 'data-pj-chat': '' })}</p>`;
    const say2 = adv() && !spaces().length ? '<p class="ws-about">A workspace is projects that work together: Worca learns how they connect, and changes them in the right order.</p>' : '';
    const fields =form === 'project' ? R.field({ id: 'pj-hand-v', label: 'Folder or repository', placeholder: '~/src/your-project', value: formTyped, error: formErr, attrs: { maxlength: 200 } }) : R.field({ id: 'pj-hand-v', label: 'Its name', placeholder: 'Web shop', value: formTyped, error: formErr, hint: `Up to ${NAME_MAX} characters`, attrs: { maxlength: NAME_MAX } });
    const hand = form ? `<div class="card-form">${R.confirmForm({ form: 'hand', id: 'pj-hand-t', text: form === 'project' ? 'Add a project by hand' : 'Make a workspace by hand', body: fields + R.confirmActions({ yes: form === 'project' ? 'Add' : 'Make it' }) })}</div>` : '';
    const wrap = (body) => `<div class="convo"><div class="convo-scroll"><div class="convo-col is-center">${body}</div></div></div>`;
    if (!data.projects.length) return wrap(`${R.placeHead({ title: 'Your projects' })}${way}${hand}${R.emptyState({ title: 'No projects yet.', actions: R.button({ label: 'Add project', kind: 'quiet', attrs: { 'data-pj-add': '' } }) })}`);
    if (by === 'workspace') {
      const shelves = ctx.sort(ctx.raw), busy = shelves.filter((sh) => sh.ids.some((id) => !ctx.stand.get(id).quiet && ctx.homeBy.get(id) === sh) || sh.qs.length || sh.ids.some((id) => ctx.homeBy.get(id) !== sh && !ctx.stand.get(id).quiet)), still = shelves.filter((sh) => !busy.includes(sh));
      const loud = (sh) => !!sh.w;   // a quiet workspace folds; a quiet "On their own" keeps its shelf, it is no workspace
      const fold = still.filter(loud), open = quietOpen.has('spaces');
      const stillRow = fold.length ? `<div class="center-shelf">${R.quietLine({ n: fold.length, noun: 'workspace', names: fold.map((sh) => sh.name).join(', '), open, hook: { 'data-pc-quiet': 'spaces' } })}</div>${open ? fold.map((sh) => shelfHtml(sh, ctx)).join('') : ''}` : '';
      return wrap(`${head}${sent}${way}${say2}${hand}${[...busy, ...still.filter((sh) => !loud(sh))].map((sh) => shelfHtml(sh, ctx)).join('')}${stillRow}`);
    }
    const flat = ctx.sort([...all.filter((s) => !s.quiet).map((s) => ({ rank: s.rank, name: s.p.id, html: cardOf(s, adv() ? homesOf(s.p.id).map((w) => w.title) : []) })), ...(adv() ? spaces().flatMap((w) => window.RailSpaces.questions(w).map((l) => ({ rank: 2.7, name: `${w.title} ${l.from}`, html: qCard(w, l) }))) : [])]);
    const quiet = all.filter((s) => s.quiet);
    return wrap(`${head}${sent}${way}${say2}${hand}<div class="pg-grid center-flat">${flat.map((c) => c.html).join('')}</div>${quietOf('flat', quiet)}`);
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'projects';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    const items = needItems().length; if (items !== bellHeard) { bellHeard = items; window.RailPulse?.refresh(); }   // the bell reads the same list
    if (current.includes('@') && !adv()) { window.RailShell.go(`projects/${pid()}`); return; }   // "through a workspace" is an Advanced address
    ctl?.paint();
    const scrolled = drawn === current ? page.querySelector('.convo-scroll')?.scrollTop || 0 : 0, keep = () => { drawn = current; const s = page.querySelector('.convo-scroll'); if (s) s.scrollTop = scrolled; };   // a menu opening leaves the page where it was, its picker in view
    if (current.startsWith('ws:')) { if (!adv()) { window.RailShell.go('projects'); return; } window.RailSpaces.render(page, current.slice(3)); keep(); return; }
    const p = data.projects.find((x) => x.id === pid());
    if (!p) { page.innerHTML = homeHtml(); keep(); return; }
    page.innerHTML = pageHtml(p);
    window.RailConversation?.dock(document.getElementById('pj-dock'), { kind: 'project', title: nameOf(p), chat: '', ref: { pageProjectKey: p.id } });   // D16: the page's project, as dev's context
    keep();
  }
  // panel.dismiss: focus returns to what opened it: Locate on the page, the bar's + otherwise
  const closeForm = () => { const was = form; form = ''; formTyped = ''; formErr = ''; draw(); (was === 'locate' ? page.querySelector('[data-pj-act]') || page.querySelector('[data-menu="pj-more"]') : document.querySelector('[data-bar-new]'))?.focus(); };
  function wire(b, pg) {
    bar = b; page = pg;
    // the bar (list.bar-model): what needs you first; a workspace over its projects, a healthy one folded; a project in two is under both, its address says through which
    const kid = (w) => ([id]) => { const p = data.projects.find((x) => x.id === id), addr = `${id}@${w.id}`; return p ? { ...rowOf(p), key: `proj:${id}:${w.id}`, _addr: addr, current: current === addr || (current === id && firstHome(id) === w.id) } : { key: `m:${id}:${w.id}`, _addr: '', title: id, mark: R.kindMark({ kind: 'project' }), end: '', tip: `${id}: a folder in this workspace` }; };
    const worst = (w) => { const kids = w.projects.map(([id]) => data.projects.find((p) => p.id === id)).filter(Boolean).map(standing).filter(standsOut).sort((a, b) => a.rank - b.rank)[0], q = window.RailSpaces.questions(w).length; return kids && (!q || kids.rank <= 2.7) ? { word: kids.word, tone: kids.tone, level: R.alertLevel(kids.tone) } : q ? { word: R.needsReason('question'), tone: 'ask', level: 2 } : { word: '', tone: 'idle', level: 0 }; };   // a workspace at its worst child
    const spaceRow = (w) => ({ key: `ws:${w.id}`, _w: w, title: w.title, mark: R.kindMark({ kind: 'workspace', tone: worst(w).tone, advisory: worst(w).tone === 'ok', breathe: worst(w).level > 0 && `ws:${w.id}` !== current }), end: worst(w).word, current: `ws:${w.id}` === current, tip: `${w.title}\n${window.RailSpaces.hint(w)}`, tree: w.projects.map(kid(w)), treeShut: worst(w).level === 0, menu: window.RailSpaces.menu(w, true) });
    const treeOn = () => adv() && view.by === 'workspace';
    ctl = R.listController({ root: bar, spec: { noun: 'projects', label: 'Selected projects', view: () => { const test = SHOWS.find((x) => x.id === view.show).test;
      const parts = [{ word: 'Showing', id: 'show', text: SHOWS.find((x) => x.id === view.show).text, tip: 'Which projects the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, checked: view.show === x.id, hint: String(x.id === 'needs' ? needCount() : data.projects.filter(x.test).length) })) }, ...(adv() ? [{ word: 'by', id: 'by', text: view.by, tip: 'How they are grouped', items: ['workspace', 'name'].map((x) => ({ id: x, text: x, checked: view.by === x })) }] : [])];
      if (treeOn()) { const needsS = (w) => worst(w).level > 0, keep = (w) => view.show === 'all' || (view.show === 'needs' && needsS(w)) || w.projects.some(([id]) => { const p = data.projects.find((x) => x.id === id); return p && test(p); }), filt = (r) => ({ ...r, tree: view.show === 'all' ? r.tree : r.tree.filter((c) => { const p = c._p; return p && test(p); }) });
        const L = loose().filter(test);
        const out = { state: 'ready', parts, sections: [{ id: 'needs', title: R.runState('question').word, count: needCount(), rows: [...spaces().filter((w) => needsS(w) && keep(w)).map(spaceRow).map(filt).map((r) => { const w2 = r._w.id, t = r.tree.filter((c) => (c._p && needs(c._p) && (homeOf(c._p.id) === w2)) || c.current); const left = r.tree.length - t.length; if (!left) return r; if (showAll.has(w2)) return { ...r, tree: [...r.tree, { key: `less:${w2}`, _less: w2, title: 'Show fewer', mark: '', end: '', tip: `Back to what needs you in ${r.title}` }] }; return { ...r, tree: [...t, { key: `more:${w2}`, _more: w2, title: `${left} more`, mark: '', end: '', tip: `Shows the other ${left} projects of ${r.title}` }] }; }), ...L.filter(needs).map(rowOf)] }, { id: 'spaces', title: 'Workspaces', rows: spaces().filter((w) => !needsS(w) && keep(w)).map(spaceRow).map(filt) }, { id: 'loose', title: 'On their own', rows: L.filter((p) => !needs(p)).map(rowOf) }].filter((x) => x.rows.length), empty: { text: 'No projects yet.', action: 'Add project' } };
        // red above amber, and the count is what is drawn (look.alert-ladder)
        const lvl = (r) => (r._w ? worst(r._w).level : r._p ? R.alertLevel(standing(r._p).tone) : 0);
        const nd = out.sections.find((s) => s.id === 'needs');
        if (nd) { nd.rows.sort((a, b) => lvl(b) - lvl(a)); nd.count = nd.rows.reduce((k, r) => k + (r._w ? Math.max(1, r.tree.filter((c) => c._p && needs(c._p)).length) : 1), 0); }
        return out; }
      const l = data.projects.filter(test).sort((a, b) => (view.by === 'name' ? a.id.localeCompare(b.id) : 0));
      return { state: 'ready', parts, sections: [{ id: 'needs', title: R.runState('question').word, rows: l.filter(needs).sort((a, b) => standing(a).rank - standing(b).rank).map(rowOf) }, { id: 'all', title: 'Projects', rows: l.filter((p) => !needs(p)).map(rowOf) }].filter((x) => x.rows.length), empty: { text: 'No projects yet.', action: 'Add project' } }; },
      can: () => ['menu'], bulk: () => [], act: (id, rows) => { if (rows[0]?._w) window.RailSpaces.act(id, rows[0]._w); else act(id, rows); }, open: (r) => { if (r._more) { showAll.add(r._more); ctl.paint(); return; } if (r._less) { showAll.delete(r._less); ctl.paint(); return; } if (r._w) window.RailShell.go(`projects/ws:${r._w.id}`); else if (r._addr) window.RailShell.go(`projects/${r._addr}`); else if (r._p) window.RailShell.go(`projects/${r._p.id}`); else say(`${r.title} is a folder in this workspace, not added as a project`); }, word: (id, v) => { view[id] = v; if (id === 'by') draw(); return false; }, say,
      active: () => /^#projects/.test(location.hash), emptyAct: () => window.RailConversation?.starter('project') } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit;
      if ((hit = on('[data-pj-home-act]'))) { const x = data.projects.find((y) => y.id === hit.dataset.pjHomeAct); if (x) originAct(x); return; }
      if (on('[data-pc-figs]')) { figures = !figures; draw(); return; }
      if ((hit = on('[data-pc-quiet]'))) { const k = hit.dataset.pcQuiet; if (quietOpen.has(k)) quietOpen.delete(k); else quietOpen.add(k); draw(); return; }
      if ((hit = on('[data-pc-to]'))) { const c = page.querySelector(`[data-pc-card="${CSS.escape(hit.dataset.pcTo)}"]`); c?.scrollIntoView({ block: 'center' }); R.land(c); return; }
      if (on('[data-pj-chat]')) { window.RailShell.go('chat'); return; }
      if (on('[data-pj-add]')) { window.RailConversation?.starter('project'); return; }
      if ((hit = on('[data-menu-pick^="pc-"]'))) { const [id, v] = hit.dataset.menuPick.split('|'); pickMenu = ''; if (id === 'pc-sort') sortBy = v; else view.by = v === 'project' ? 'name' : 'workspace'; draw(); return; }
      if ((hit = on('[data-menu^="pc-"]'))) { pickMenu = pickMenu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); return; }
      if ((hit = on('[data-pj-open]'))) { const [cid, title] = hit.dataset.pjOpen.split('|'); window.RailShell.openTask(window.RailChats.data().chats.find((c) => c.id === cid)?.tasks.find((t) => t.title === title)?.case || '', cid, title); return; }
      if ((hit = on('[data-pj-go]'))) { window.RailShell.go(`projects/${hit.dataset.pjGo}`); return; }
      if (current.startsWith('ws:')) return;   // the workspace has its own
      if (form === 'locate' && (hit = on('[data-confirm]'))) { const v = page.querySelector('#pj-hand-v')?.value.trim() || '', p = data.projects.find((x) => x.id === locating); if (hit.dataset.confirm !== 'yes' || !p) { closeForm(); return; } if (!v || v === p.path) { formTyped = v; formErr = v ? 'That is where it was: give where it is now' : 'It needs a folder'; draw(); page.querySelector('#pj-hand-v')?.focus(); return; } if (pathWrong(v)) { formTyped = v; formErr = pathWrong(v); draw(); page.querySelector('#pj-hand-v')?.focus(); return; } form = ''; formTyped = ''; formErr = ''; Object.assign(p, { path: v, origin: 'ok', checked: 'just now' }); draw(); say(`${p.id} now uses ${v}`); return; }
      if (form && (hit = on('[data-confirm]'))) { const v = page.querySelector('#pj-hand-v')?.value.trim() || '', kind = form; if (hit.dataset.confirm !== 'yes') { closeForm(); return; } const id = kind === 'project' ? (v.split(/[/:]/).filter(Boolean).pop() || '').replace(/\.git$/, '') : '', wrong = !v || (kind === 'project' && !id) ? (kind === 'project' ? 'It needs a folder or a repository' : 'It needs a name') : kind === 'project' ? (pathWrong(v, true) || (id.length > NAME_MAX ? `A project's name holds ${NAME_MAX} characters; this folder's has ${id.length}` : data.projects.some((x) => x.id === id) ? `${id} is already a project` : '')) : (window.RailSpaces.named(v) ? `${window.RailSpaces.named(v).title} already exists` : ''); if (wrong) { formTyped = v; formErr = wrong; draw(); page.querySelector('#pj-hand-v')?.focus(); return; } form = ''; formTyped = ''; formErr = ''; if (kind === 'project') { window.RailProjects.add({ id, path: v, kind: 'Git', origin: 'local', branch: 'main' }); say(`Added ${id}`); window.RailShell.go(`projects/${id}`); return; } const wsId = window.RailSpaces.add({ title: v, fresh: true }); window.RailShell.go(`projects/ws:${wsId}`); return; }
      const p = data.projects.find((x) => x.id === pid()); if (!p || !page.querySelector('#pj-dock')) return;
      if (on('[data-def-edit]') && notLive(p, 'Cost tags and labels')) return;
      if (defaultsClick(e, p, draw)) return;      if (on('[data-pj-spend]')) { window.RailPlaces.insights.spendOf(p.id); return; }
      if (on('[data-pj-sets]')) { setsOpen = !setsOpen; draw(); return; }
      if ((hit = on('[data-pj-act]'))) { originAct(p); return; }
      if ((hit = on('[data-pj-reset], [data-pj-team]')) && notLive(p, hit.matches('[data-pj-team]') ? 'Team memory' : 'How its tasks run')) return;
      if ((hit = on('[data-pj-reset]'))) { delete p.sets[hit.dataset.pjReset]; draw(); say('Back to yours'); return; }
      if ((hit = on('[data-pj-team]'))) { p.teamMemory = !p.teamMemory; if (p.sets) delete p.sets.memory; draw(); say(p.teamMemory ? 'Team memory on' : 'Team memory off'); return; }
      if ((hit = on('[data-confirm]'))) { if (hit.dataset.confirm === 'yes') { const i = data.projects.indexOf(p), back = window.RailSpaces?.forget(p.id); data.projects.splice(i, 1); confirm = null; current = ''; say(`Removed ${p.id}`, { tip: 'Puts it back', run: () => { data.projects.splice(i, 0, p); back?.(); draw(); } }); window.RailShell.go('projects'); } else { confirm = null; draw(); } return; }
      if ((hit = on('[data-pj-menu]'))) { act(hit.dataset.pjMenu, [{ _p: p }]); return; }
      if ((hit = on('[data-menu-pick]'))) {
        const [id, v] = hit.dataset.menuPick.split('|'); menu = '';
        if ((id === 'pj-more' && v === 'remote') || id.startsWith('pj-pay-') || id.startsWith('pjs-')) { if (notLive(p, id === 'pj-more' ? 'Link a remote' : id.startsWith('pjs-') ? 'How its tasks run' : 'Who pays')) { draw(); return; } }
        if (id === 'pj-more') { if (v === 'remote') { p.origin = 'ok'; p.base = 'origin/main'; draw(); say('Linked origin; nothing was pushed'); } else act(v, [{ _p: p }]); return; }
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
    R.dismissOnOutside(document, { open: () => here() && !!pickMenu, inside: '#route-place .spick', back: () => null, close: () => { pickMenu = ''; }, paint: draw });
  }
  // a half-typed cost tag or label does not wait for you on another page
  window.addEventListener('hashchange', () => { [...data.projects, ...(window.RailSpaces?.list() || [])].forEach((x) => { delete x.editing; delete x.defErr; delete x.defTyped; }); });
  window.RailProjects = { needItems, all: () => data.projects, editTags: (id) => { if (notLive(null, 'Cost tags')) return; window.RailShell.go(`projects/${id}`); setTimeout(() => { const p = data.projects.find((x) => x.id === id); if (!p) return; p.editing = 'tags'; draw(); document.getElementById('def-tags')?.focus(); }, 80); }, sync: (id) => { if (W?.live) return; const p = data.projects.find((x) => x.id === id); if (p?.origin === 'behind') Object.assign(p, { origin: 'ok', behind: 0, checked: 'just now' }); }, spend: (id) => SPEND[id]?.[0] || 0, hint: (id) => { const p = data.projects.find((x) => x.id === id); return p ? (p.origin === 'behind' ? `${p.behind} behind` : shortOf(p) || '') : ''; }, list: () => data.projects, add: (p) => { if (notLive(null, 'Adding a project')) return; if (!data.projects.some((x) => x.id === p.id)) data.projects.push({ kind: 'Git', origin: 'local', branch: 'main', ...p }); ctl?.paint(); } };
  if (window.RailFirstRun) data.projects = [];   // the first run: nothing added yet
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.projects = { has: (a) => (a.startsWith('ws:') ? (window.RailSpaces?.list() || []).some((w) => w.id === a.slice(3)) : data.projects.some((p) => p.id === a.split('@')[0])), defaults: defaultsRows, defaultsClick, defaultsKey, redraw: () => draw(), get newMenu() { return adv() ? newMenuItems : null; }, get newAct() { return adv() ? () => window.RailConversation?.starter('project') : null; }, get newLabel() { return adv() ? 'Add project' : ''; }, newPick: (id) => { if (id === 'project' || id === 'workspace') { window.RailConversation?.starter(id); return; } if (id === 'hand-project' && notLive(null, 'Adding a project by hand')) return; form = id === 'hand-project' ? 'project' : 'space'; if (current) window.RailShell.go('projects'); setTimeout(() => { draw(); page?.querySelector('#pj-hand-v')?.focus(); }, 60); }, search: (q) => [...data.projects.filter((p) => `${nameOf(p)} ${p.path}`.toLowerCase().includes(q)).map((p) => ({ label: nameOf(p), where: wordOf(p), hash: `projects/${p.id}` })), ...spaces().filter((w) => w.title.toLowerCase().includes(q)).map((w) => ({ label: w.title, where: 'Workspace', hash: `projects/ws:${w.id}` }))], sample: 'billing-api',
    show: ({ bar: b, page: pg, arg }) => { window.RailCenters?.wire(); if (b !== bar) wire(b, pg); if (current !== arg) { menu = ''; if (confirm?.p?.id !== arg) confirm = null; if (form === 'locate' && (arg || '').split('@')[0] !== locating) { form = ''; formTyped = ''; formErr = ''; } } current = arg || ''; draw(); } };
  const newMenuItems = () => [{ header: 'Ask in chat' }, { id: 'bar-new|project', text: 'Add a project' }, ...(adv() ? [{ id: 'bar-new|workspace', text: 'Make a workspace' }] : []), { sep: true }, { header: 'Legacy approach' }, { id: 'bar-new|hand-project', text: 'Add a project…' }, ...(adv() ? [{ id: 'bar-new|hand-space', text: 'Make a workspace…' }] : [])];
})();
