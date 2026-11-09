// Chat: the home with its composer and background, a conversation on one rail with its timeline, and the composer that
// starts everything (New run moved here). The words, marks and flows come from the library; a task never changes while it
// runs: asking about one goes to its chat.
(function () {
  const R = window.RailUI, M = window.ChatsListModel, RM = window.RunCardModel;
  if (!document.getElementById('route-chat')) return;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const STAGES = ['Plan', 'Build', 'Review', 'PR', 'Merged'];
  const threads = new Map(), mounted = [];
  const LABELS = ['hotfix', 'billing', 'infra', 'release'], LABEL_MAX = 40; let labelQ = '';   // a label made in one chat is offered in every chat; small.label-short
  // a long name is cut at a word, with an ellipsis; a branch at a dash: never mid-word
  // the time a person wrote ("at 1am", "every night at 23:30", "weekdays at 9"), as a schedule's when; a repeat unless "once"
  const TIME_SAID = /\b(?:at\s*)?(\d{1,2})(?::(\d\d))?\s*(am|pm)\b|\bat\s*(\d{1,2})(?::(\d\d))?\b/i;
  const whenOf = (text) => {
    const m = text.match(TIME_SAID);
    let h = m ? +(m[1] || m[4]) : 2, min = m ? m[2] || m[5] || '00' : '00'; if (m?.[3]?.toLowerCase() === 'pm' && h < 12) h += 12; if (m?.[3]?.toLowerCase() === 'am' && h === 12) h = 0;
    const at = `${String(h).padStart(2, '0')}:${min}`;
    const day = text.match(/\b(mon|tues|wednes|thurs|fri|satur|sun)days?\b/i);
    const every = /\bweekdays?\b/i.test(text) ? 'every weekday' : /\bweekends?\b/i.test(text) ? 'every weekend' : day ? `every ${day[1][0].toUpperCase()}${day[1].slice(1).toLowerCase()}day` : /\bhour(ly)?\b/i.test(text) ? 'every hour' : 'every day';
    return /\b(once|tonight|today|tomorrow)\b/i.test(text) && !/\bevery\b/i.test(text) ? `tonight at ${at}` : every === 'every hour' ? every : `${every} at ${at}`;
  };
  // what a schedule's words name wins over its pickers: a time only when one is written, a repeat only when one is named
  const saidWhen = (text) => { const w = whenOf(text); return { at: TIME_SAID.test(text) ? w.match(/\d\d:\d\d$/)?.[0] || '' : '', every: /\b(weekdays?|weekends?|(?:mon|tues|wednes|thurs|fri|satur|sun)days?|hour(ly)?|daily|nightly|every day)\b/i.test(text) ? w.replace(/ at \d\d:\d\d$/, '') : /\b(once|tonight|today|tomorrow)\b/i.test(text) ? 'once' : '' }; };
  // the mock has no GitHub, files or clipboard behind it (click-sweep's limits): a control says what it would do, never that it did
  const wouldSay = (s) => s.replace(/^Opens /, 'Would open ').replace(/^Downloaded /, 'Would download ').replace(/^Copied /, 'Would copy ');
  const SAMPLE_FILES = ['notes.md', 'spec.pdf', 'screenshot.png'];
  // a proposal's line never restates its title: only the words the title had to cut
  const whyOf = (text) => (text.length <= 64 ? '' : `From this chat: ${text}`);
  // a task's name from what was asked: the clause before its details ("… that returns", "… with a test"), never cut mid-phrase
  let lastProject = window.RailFirstRun ? 'No project' : 'billing-api';   // the first run has no project yet
  const nameOf = (core) => { if (core.length <= 56) return core; const m = core.slice(0, 57).match(/^(.{16,}?)\s+(?:that|which|with|so|so that|because|returning|using|where|when|to make|for)\b/i); return (m ? m[1] : core.slice(0, 56).replace(/\s+\S*$/, '')).replace(/[\s,;:]+(?:and|or|the|a|an|to|of|in|on)?$/i, ''); };
  const clip = (t, n = 64) => (t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, '')}…`);
  // every change to a task goes to the store (shell/world.js), which tells every surface; a new task is linked into it first
  const put = (c, t) => { if (!t || t.kind === 'schedule') return; M.link(c || { project: '' }, t); window.RailWorld.move(t.run, t.case, t.detail, { stage: t.stage, title: t.title }); };
  // a task that starts sets up its worktree, then plans: Starting gives way to Plan by itself
  const settleStart = (c, t) => {
    const step = (ms, from, to) => setTimeout(() => { if (t.case !== from || t.stage !== (from === 'starting' ? 0 : to.after)) return; Object.assign(t, to.set); put(c, t); refreshAll(); }, ms);
    step(4000, 'starting', { set: { case: 'working', stage: 0, detail: 'Plan · writing the plan' } });
    step(12000, 'working', { after: 0, set: { stage: 1, detail: 'Build · writing the change' } });
    step(22000, 'working', { after: 1, set: { case: 'gate', stage: 2, detail: 'Waits for your OK on the review', why: ['Review passed with 2 small notes', 'The tests pass'] } });
  };
  const chatOfT = (t) => data().chats.find((c) => (c.tasks || []).some(function w(y) { return y === t || (y.after || []).some(w); }));
  const slug = (t, n = 40) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, n + 1).replace(/-[^-]*$/, '') || 'task';
  const data = () => window.RailChats.data();
  const fresh = (mode = 'ask') => ({ files: [], mode, text: '', project: 'billing-api', workflow: 'Default', engine: 'Opus 5.5', from: 'origin · latest', then: 'open a PR', every: 'every day', at: '02:00', preset: '', more: false, startAt: '', busy: false });
  // Thinking: what it does now, in plain words, one step every 0.6s; its seconds; the row is updated in place, never redrawn
  const THINKING = ['Reading the chat', 'Looking through the project', 'Searching the code', 'Writing the answer'];
  const THOUGHT = ['Read the chat', 'Looked through the project', 'Searched the code', 'Wrote the answer'];   // the same steps, done
  const thinkNow = (x) => { const ms = Date.now() - (x.at || Date.now()), steps = x.steps || THINKING, n = Math.min(steps.length, 1 + Math.floor(ms / 600)); return { step: steps[n - 1], secs: `${Math.max(1, Math.round(ms / 1000))}s`, n, phase: n === steps.length ? 'write' : n === 3 ? 'tool' : 'think' }; };   // searching is a tool; the last step writes
  function mount(root, side = false, opts = {}) {
    let sideNoPage = false;   // × on the page's chip: this question goes without the page
  const where = opts.where || (side ? '#ask-convo' : '#route-chat');
  let chatId = '', comp = fresh(opts.mode), menu = '', hover = null, opened = new Set(), timer = 0;
  const chat = () => data().chats.find((c) => c.id === chatId);
  // the first screen points a newcomer to Getting started until its sign-in is done; then it says nothing
  const newHere = () => { const gs = data().chats.find((c) => c.id === 'c0' && !c.archived); if (!gs || threads.get('c0')?.find((y) => y.id === 'g1')?.done) return ''; return `<p class="chat-home-new">New here? ${R.textLink({ label: 'Getting started', attrs: { 'data-back-to': 'chat/c0', title: 'Opens Getting started: sign in, add a project, then your first task' } })} signs you in and adds your first project.</p>`; };
  const turns = () => { const c = chat(); if (!c) return []; if (!threads.has(c.id)) threads.set(c.id, M.thread(c)); return threads.get(c.id); };
  const allTasks = (c) => { const out = []; const walk = (x) => { out.push(x); (x.after || []).forEach(walk); }; (c?.tasks || []).forEach(walk); return out; };
  const taskOf = (id) => allTasks(chat()).find((t) => t.id === id);
  const stOf = (t) => R.runState(RM.stateOf(t.case), { base: 'dev', pr: '#1180', reset: '17:00' });

  // ---- the composer ----
  const pk = (id, text, items, tip) => R.sentencePicker({ id: `cp-${id}`, text, tip, items: items.map((x) => (typeof x === 'string' ? { id: x, text: x, checked: x === text } : { ...x, checked: x.id === text })), open: menu === `cp-${id}`, chevron: R.icon('chevron', 10) });
  const W = (t) => `<span>${t}</span>`;
  const WP = (t, picker) => `<span class="cw-pair">${W(t)}${picker}</span>`;   // a sentence's word never stays behind at a line's end
  const MODES = [{ id: 'Ask', text: 'Ask', help: 'A question or a chat. Nothing starts by itself' }, { id: 'Task', text: 'Task', help: 'Starts work: a plan, a build, a review, a pull request' }, { id: 'Schedule', text: 'Schedule', help: 'Runs a task at its times' }];
  const PROJECTS = window.RailFirstRun ? ['No project'] : ['billing-api', 'web-app', 'worca-cc', 'docs-site', 'No project'];   // the first run lists only what you add
  // engine first, then its model: each engine's models under its name (Codex has its own)
  const ENGINE_MODELS = [['Claude Code', ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']], ['Codex', ['Codex high', 'Codex medium']], ['Gemini CLI', ['Gemini Pro', 'Gemini Flash']]];
  const ENGINES = ENGINE_MODELS.flatMap(([, ms]) => ms);
  const ENGINE_ITEMS = ENGINE_MODELS.flatMap(([e, ms], i) => [...(i ? [{ sep: true }] : []), { header: e }, ...ms.map((m) => ({ id: m, text: m }))]);
  // one picker for where it runs: each project's state at choice time; workspaces (organizational, and a run target as in dev) from Advanced
  const scopes = () => [...PROJECTS.map((id) => ({ id, text: id, hint: window.RailProjects?.hint(id) || '' })), ...(R.shows('advanced') && window.RailSpaces?.list().length ? [{ sep: true }, { header: 'Workspaces · projects that work together' }, ...window.RailSpaces.list().map((w) => ({ id: w.title, text: w.title, hint: window.RailSpaces.hint(w) }))] : [])];
  function sentence() {
    const mode = comp.intent ? '' : pk('mode', comp.mode === 'ask' ? 'Ask' : comp.mode === 'task' ? 'Task' : 'Schedule', MODES, 'Ask, start a task, or schedule one');   // an armed starter's chip says what it is
    const project = WP('on', pk('project', comp.project, scopes(), 'Where it runs: a project or, from Advanced, a workspace'));
    const engine = pk('engine', comp.engine, ENGINE_ITEMS, 'Which engine, then its model') + pk('effort', comp.effort || 'high', ['low', 'medium', 'high'], 'How hard it thinks');
    if (comp.mode === 'ask') return mode + project + engine;
    if (comp.mode === 'schedule') return mode + project + pk('every', comp.every, R.REPEATS, 'When it repeats') + (comp.every === 'every hour' ? '' : WP('at', pk('at', comp.at, R.TIMES_OF_DAY, 'What time')));
    const preset = comp.preset ? W('·') + pk('preset', comp.preset, ['No preset', 'Hotfix', 'Docs only'], 'The preset that filled it') : '';
    return mode + project + WP('with', pk('workflow', comp.workflow, [...new Set(['Default', 'Lean', 'Shaper', 'Architecture (C4)', comp.workflow])], 'Which workflow')) + W('on') + engine + WP('from', pk('from', comp.from, ['origin · latest', 'local copy', 'the source branch'], 'Where it starts')) + WP('then', pk('then', comp.then, ['open a PR', 'leave a branch', 'push to the source'], 'What happens when it is done')) + preset;
  }
  function detail() {
    if (comp.mode !== 'task') return '';
    const cr = (n, v) => `<div class="cr"><span>${n}</span><span>${v}</span></div>`;
    const note = window.RailPulse?.startNote?.();
    const noteHtml = note ? `<div class="composer-note">${R.kindMark({ kind: 'task', tone: note.blocked ? 'fail' : 'act', size: 16 })}<span>${esc(note.say)} ${note.use ? R.button({ label: `Use ${note.use}`, kind: 'quiet', attrs: { 'data-cp-use': note.use } }) : ''}${note.at ? R.button({ label: `Start at ${note.at}`, kind: 'quiet', attrs: { 'data-cp-at': note.at } }) : ''}</span></div>` : '';
    // every row is a choice, as on a proposal's Customise: a picker, or a field for what you name
    const field = (id, label, v, ph) => R.field({ id: `cp-${id}-f`, label, quietLabel: true, value: v || '', placeholder: ph, attrs: { 'data-cp-field': id } });
    const more = comp.more ? `<div class="composer-more">${cr('Title', field('title', 'Title', comp.title, 'Worca names it'))}${cr('Labels', pk('labels', comp.labels || 'no label', ['no label', 'hotfix', 'billing', 'export', 'infra'], 'Its labels'))}${cr('New branch', field('branch', 'New branch', comp.branch, 'Worca names it from the task'))}${cr('Asks you', pk('asks', comp.asks || 'When the plan has open questions', ['When the plan has open questions', 'Never', 'Before every step'], 'When it stops to ask'))}${cr('Memory', pk('memory', comp.memory || 'This project', ['This project', 'None'], 'What it remembers'))}${cr('Guardrails', pk('guard', comp.guard || 'Team default', ['Team default', 'Strict', 'Read only'], 'Applies to every agent in this task'))}${R.shows('expert') ? cr('Agents', pk('agents', comp.agents || 'As the workflow says', ['As the workflow says', 'One agent', 'A reviewer for each step'], 'Who works on it')) + cr('MCP servers', pk('mcp', comp.mcp || 'Project defaults', ['Project defaults', 'None', 'All I have'], 'Which tools it can use')) : ''}</div>` : '';
    return `<div>${R.button({ label: comp.more ? 'Hide Customise' : 'Customise', kind: 'quiet', icon: R.icon(comp.more ? 'chevron' : 'chevR', 12), attrs: { 'data-cp-more': '', 'aria-expanded': String(comp.more), title: 'Title, labels, branch, memory, guardrails and more' } })}</div>${more}${noteHtml}`;
  }
  const aboutNow = () => (comp.about && (!comp.about.binds || comp[comp.about.binds] === comp.about.name) ? comp.about : null);   // rail.hand-to-chat: changing the sentence drops the chip it set
  const chipsHtml = () => (comp.files.length || aboutNow() ? `<span class="composer-chips">${aboutNow() ? R.handedChip({ kind: comp.about.kind, name: comp.about.name, attrs: { 'data-cp-unabout': '' } }) : ''}${comp.files.map((f) => R.button({ label: f, kind: 'quiet', icon: R.icon('x', 11), attrs: { 'data-cp-unfile': f, title: `Removes ${f}` } })).join('')}</span>` : '');
  // ---- starting: a starter only arms the composer (its chip and its placeholder); nothing is sent until you send ----
  const STARTERS = [
    { id: 'task', label: 'New task', icon: 'kind-task', ph: 'Describe the task…' },
    { id: 'workflow', label: 'Build workflow', icon: 'kind-workflow', ph: 'Describe the workflow…' },
    { id: 'schedule', label: 'Schedule a task', icon: 'clock', ph: 'What should run, and when?' },
    { id: 'track', label: 'Follow a task', icon: 'track', ph: 'Which task to follow?' },
  ];
  const MORE = [
    { id: 'explain', label: 'Explain a diff', icon: 'pr', ph: 'Which task’s changes?' },
    { id: 'script', label: 'Write a script', icon: 'script', ph: 'What should the script do?' },
    { id: 'project', label: 'Add project', icon: 'folder', ph: 'Which folder or repository?' },
    { id: 'away', label: 'Step away', icon: 'away', ph: 'I’m away now', text: 'I’m away now' },
    { id: 'metrics', label: 'Team metrics', icon: 'signal', ph: 'What do you want to know?' },
    { id: 'model', label: 'Add a model', icon: 'set-models', ph: 'Which model or provider?' },
    { id: 'workspace', label: 'New workspace', icon: 'nav-workspaces', ph: 'Which projects belong together?' },
    { id: 'remember', label: 'Remember something', icon: 'set-memory', ph: 'What should Worca remember?' },
    { id: 'find', label: 'Find tasks', icon: 'list', ph: 'Which tickets? (Jira, GitHub, Linear)' },
  ];
  const PRESETS = ['Hotfix', 'Docs only', 'Release notes', 'Dependency bump'];
  let pins = ['Shaper'];   // pinned workflows lead the row; Shaper by default
  const intentOf = (id) => [...STARTERS, ...MORE].find((x) => x.id === id) || (id?.startsWith('pin:') ? { id, label: id.slice(4), icon: 'kind-workflow', ph: id === 'pin:Shaper' ? 'Describe the problem…' : `What should ${id.slice(4)} do?` } : null);
  function arm(id) {
    const x = intentOf(id); if (!x) return;
    menu = ''; comp = { ...comp, intent: id, mode: 'ask', text: x.text || '', preset: '' };
    paint(); const t = root.querySelector('[data-composer-t]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
  }
  // what can be followed: every task still going, wherever it was started; one chat follows it
  const liveTasks = () => (window.RailChats?.data().chats || []).flatMap((c) => (c.tasks || []).filter((t) => t.case && t.kind !== 'schedule' && !t.followed && !['ok', 'merged', 'stop', 'closed', 'idle'].includes(R.markTone(stOf(t)))).map((t) => ({ t, c })));
  function follow(t, c) {   // a chat of its own for this task: its live card, and what waits on you lifts the chat
    const had = data().chats.find((y) => y.kind === 'tracks' && (y.tasks || []).some((z) => z.run === t.run));
    if (had) { window.RailShell.go(`chat/${had.id}`); return; }
    const copy = { ...t, followed: true, after: undefined }, id = window.RailChats.newChat(`Follow ${t.title}`, c.project || '', { kind: 'tracks', state: 'following', tasks: [copy] });
    threads.set(id, [{ t: 'notice', text: `Following ${t.title}: its card stays live here` }, { t: 'task', id: 'b0', task: copy.id }]);
    window.RailChats.refresh(); window.RailShell.go(`chat/${id}`); say(`Following ${t.title}`);
  }
  // a question, a re-plan or a change for something on this screen: its chip in the box, nothing sent (rail.hand-to-chat)
  const handHere = (kind, name, ph, text) => { comp.about = { kind, name, ph, binds: '', was: '' }; if (text != null) comp.text = text; menu = ''; paint(false); root.querySelector('[data-composer-t]')?.focus(); };
  function startersHtml() {
    const tile = (x, pin) => R.button({ label: x.label, kind: 'quiet', icon: R.icon(x.icon, 14), attrs: { 'data-starter': x.id, ...(pin ? { 'data-pin': x.label, title: `${x.label}: ${WORKFLOWS[x.label] || 'a workflow you pinned'}. Fills the box; unpin it with a right-click` } : { title: `Fills the box: ${x.ph}` }) } });
    const live = liveTasks();
    const pick = (id, items, head) => (menu === id ? R.compactMenu({ label: head, items: [{ header: head }, ...items] }) : '');
    const trackMenu = pick('starter-track', live.map(({ t }) => ({ id: `starter-track|${t.id}`, text: t.title, mark: taskMark(t, 14) })), live.length ? 'Live' : 'Nothing running');
    const more = R.moreMenu({ id: 'starter-more', label: 'More', icon: R.icon('more', 16), open: menu === 'starter-more', items: [...MORE.map((x) => ({ id: `starter|${x.id}`, text: x.label, mark: R.icon(x.icon, 14) })), { sep: true }, { header: 'Start from a preset' }, ...PRESETS.map((p) => ({ id: `starter-preset|${p}`, text: p, mark: R.icon('set-presets', 14) })), { sep: true }, { header: 'Pinned workflows' }, ...['Shaper', 'Lean', 'Architecture (C4)'].map((w) => (pins.includes(w) ? { id: `starter-unpin|${w}`, text: `Unpin ${w}`, mark: R.icon('pin', 14) } : { id: `starter-pin|${w}`, text: `Pin ${w}`, mark: R.icon('pin', 14) }))] });
    return `<div class="home-starters" role="group" aria-label="Start something">${pins.map((w) => tile({ id: `pin:${w}`, label: w, icon: w === 'Shaper' ? 'kind-feature' : 'kind-workflow' }, true)).join('')}${STARTERS.map((x) => x.id === 'track' ? `<span class="rc-pop">${tile(x)}${trackMenu}</span>` : tile(x)).join('')}<span class="rc-pop">${more}</span></div>`;
  }
  const intentChip = () => { const x = comp.intent && intentOf(comp.intent); return x ? R.intentChip({ icon: R.icon(x.icon, 12), label: x.label, clear: { 'data-intent-clear': '' } }) : ''; };
  // how full this chat's context is, and what waits to be sent
  const meter = () => { const c = chat(); if (!c) return ''; const pct = Math.min(96, 8 + turns().length * 3); return `<span class="composer-meter" title="This chat has used ${pct}% of its context (200k tokens); older turns are summarised past 90%">${pct}% context</span>`; };   // a number says what it counts
  const queueHtml = () => ((comp.queue || []).length ? `<div class="composer-queue">${comp.queue.map((q, k) => R.turnRow({ mark: R.icon('clock', 14), text: `<b>Queued</b> ${esc(q)}`, end: R.button({ label: 'Edit', kind: 'quiet', attrs: { 'data-q-edit': String(k) } }) + R.button({ label: `Remove ${q}`, kind: 'quiet', iconOnly: true, icon: R.icon('x', 12), attrs: { 'data-q-drop': String(k) } }) })).join('')}</div>` : '');
  // @ mentions: a task named in what you write becomes a chip that leads to its card
  const mentionMenu = () => { if (menu !== 'cp-mention') return ''; const q = (comp.text.match(/@([^@\s]*)$/) || [, ''])[1].toLowerCase(); const all = (window.RailChats?.data().chats || []).flatMap((c) => (c.tasks || []).filter((t) => t.case && t.title.toLowerCase().includes(q))).slice(0, 6); return `<div class="composer-at">${R.compactMenu({ label: 'Mention a task', items: all.length ? all.map((t) => ({ id: `cp-mention|${t.case}|${t.title}`, text: t.title, mark: taskMark(t, 14) })) : [{ header: 'No task by that name' }] })}</div>`; };
  function composerHtml() {
    const asTask = (help) => (comp.mode === 'schedule' ? { off: true, help: 'For a task: choose Task in the sentence first' } : { help });   // a pick never changes the mode behind your back
    const plus = `<span class="rc-pop">${R.button({ label: 'Add', kind: 'quiet', iconOnly: true, icon: R.icon('plus', 15), attrs: { 'data-menu': 'cp-plus', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'cp-plus') } })}${menu === 'cp-plus' ? R.compactMenu({ items: [{ header: 'Attach' }, { id: 'cp-plus|Files', text: 'Files', help: 'Adds files for it to read' }, { id: 'cp-plus|md', text: 'Markdown or a .md file', help: 'Writes the task as Markdown' }, { sep: true }, { header: 'Start from' }, { id: 'cp-plus|Ticket', text: 'A ticket from a tracker', ...asTask('Starts from a ticket') }, { id: 'cp-plus|Reuse', text: 'Reuse last task', help: 'Fills in the words of your last task' }, { id: 'cp-plus|Shape', text: 'Shape it first', ...asTask('Worca asks and writes the requirements before it builds') }, { sep: true }, { header: 'Preset' }, ...['Hotfix', 'Docs only'].map((x) => ({ id: `cp-preset|${x}`, text: x, checked: comp.preset === x, ...asTask('Fills the sentence; Start says it is used') }))] }) : ''}</span>`;
    const words = comp.mode === 'schedule' ? 'Schedule' : 'Continue';
    const send = comp.busy ? R.button({ label: 'Stop', kind: 'primary', iconOnly: true, icon: R.icon('stop', 14), attrs: { 'data-cp-stop': '', title: 'Stops the reply' } })
      : comp.mode === 'ask' ? R.button({ label: 'Send', kind: 'primary', iconOnly: true, icon: R.icon('up', 14), attrs: { 'data-cp-send': '', title: 'Sends it to Worca' } })
        : R.button({ label: words, kind: 'primary', attrs: { 'data-cp-send': '', title: comp.mode === 'schedule' ? 'Saves the schedule' : 'Shows the task to check; you start it there' } });
    const hearing = comp.listening || comp.handsFree;   // the mic is on: the button stays pressed, the box says so
    return queueHtml() + mentionMenu() + R.composer({ value: comp.text, placeholder: hearing ? 'Listening… press the mic to stop' : comp.intent ? intentOf(comp.intent)?.ph || 'Ask Worca…' : aboutNow()?.ph ? aboutNow().ph : comp.mode === 'schedule' ? 'What should run each time?' : comp.mode === 'task' ? 'What should the task do?' : 'Ask Worca…', sentence: intentChip() + chipsHtml() + sentence(), detail: detail(), tools: plus, send: meter() + R.button({ label: hearing ? 'Stop listening' : 'Speak', kind: 'quiet', iconOnly: true, icon: R.icon('mic', 15), attrs: { 'data-cp-mic': '', 'aria-pressed': String(!!hearing), title: hearing ? 'Stops listening' : 'Speak instead of typing' } }) + `<span class="rc-pop">${R.button({ label: 'Voice options', kind: 'quiet', iconOnly: true, icon: R.icon('chevron', 10), attrs: { 'data-menu': 'cp-voice', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'cp-voice') } })}${menu === 'cp-voice' ? R.compactMenu({ items: [{ id: 'cp-voice|hands', text: comp.handsFree ? 'Turn hands-free off' : 'Turn hands-free on', help: 'Listens and answers aloud until you stop it' }] }) : ''}</span>` + send, attrs: { 'data-composer': '' } });
  }

  // ---- a turn ----
  // a task's depth on its card (panel.task-depth): each stage's time, cycles and cost; its Log and Artifacts open under it
  const dv = {};   // per task: { open: 'i|log' | 'i|arts', art, mode, cyc, who }
  const dpick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: R.icon('chevron', 10) });
  function depthBody(u, i) {
    const D = u.depth, v = dv[u.id] || (dv[u.id] = {}), [oi, part] = (v.open || '').split('|');
    if (+oi !== i || !part) return '';
    if (part === 'log') {
      const all = D.log.filter((l) => l.s === i), cycles = [...new Set(all.map((l) => l.c))], agents = [...new Set(all.map((l) => l.from))];
      const mode = v.mode || 'summaries', cyc = v.cyc || `cycle ${cycles[cycles.length - 1]}`, who = v.who || 'every agent';
      const lines = all.filter((l) => (mode === 'raw' || l.sum) && (cyc === 'every cycle' || `cycle ${l.c}` === cyc) && (who === 'every agent' || l.from === who));
      const err = all.some((l) => l.lvl === 'error'), live = i === Math.max(0, u.stage ?? 0);
      const head = `<div class="td-log-h"><span>Showing</span>${dpick(`dl-${u.id}-mode`, mode, ['summaries', 'raw'], 'Summaries or every line')}<span>of</span>${dpick(`dl-${u.id}-cyc`, cyc, [...cycles.map((c) => `cycle ${c}`), ...(cycles.length > 1 ? ['every cycle'] : [])], 'Which cycle')}<span>by</span>${dpick(`dl-${u.id}-who`, who, ['every agent', ...agents], 'Whose lines')}<span class="av-sp"></span>${err ? R.button({ label: 'First error', kind: 'quiet', attrs: { 'data-dl-err': u.id } }) : ''}${R.button({ label: 'Copy', kind: 'quiet', attrs: { 'data-dl-copy': String(lines.length), title: 'Copies these lines' } })}${live ? `${R.switchButton({ on: v.follow !== false, label: 'Follow live', attrs: { 'data-dl-follow': u.id } })}<span>Follow live</span>` : ''}</div>`;
      return `<div class="td-body">${head}${lines.length ? R.logLines({ label: `${STAGES[i]}'s log`, lines: lines.map((l) => ({ t: l.t, from: l.from, text: l.text, lvl: l.lvl })) }) : `<p class="cmd-s">No lines for that: change what it shows above</p>`}</div>`;
    }
    const names = v.allArts ? D.arts.map((a) => a.name) : D.steps[i].arts || [], arts = names.map((n) => D.arts.find((a) => a.name === n)), at = Math.min(v.art || 0, arts.length - 1), a = arts[at];
    return `<div class="td-body">${R.list({ groups: [{ title: `Artifacts · ${arts.length}`, rows: arts.map((x, k) => R.listRow({ title: x.name, meta: `${x.step} · ${x.size}`, mark: R.kindMark({ kind: 'plugin', icon: x.icon }), current: k === at, open: { 'data-dl-art': `${u.id}|${k}`, title: `Opens ${x.name} here` } })) }] })}${R.artifactView({ name: a.name, meta: a.step, body: a.body, at, of: arts.length, hooks: { prev: { 'data-dl-art': `${u.id}|${at - 1}` }, next: { 'data-dl-art': `${u.id}|${at + 1}` }, ...(R.shows('expert') ? { full: { 'data-open-task-page': u.id } } : {}), download: { 'data-say': `Would download ${a.name}` } } })}</div>`;
  }
  function findingsHtml(u) {
    const F = u.depth?.findings; if (!F || u.depth.sent) return u.depth?.sent ? R.turnRow({ mark: R.icon('check', 14), text: `<b>Sent to Review</b> ${esc(u.depth.sent)}` }) : '';
    const n = F.filter((f) => f.state === 'confirmed').length;
    return `<div class="td-find" data-anchor="find-${u.id}">${R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: '<b>Confirm these findings</b> Review found them; what you confirm goes to its next cycle' })}<div class="set-rows">${F.map((f) => R.settingsRow({ name: f.sev, sentence: `${esc(f.text)} · ${R.shows('expert') ? R.textLink({ label: f.at, attrs: { 'data-fact': `page|${u.id}`, title: `Opens ${f.at} in its changes` } }) : esc(f.at)}`, end: `<span class="td-fx">${R.button({ label: f.state === 'confirmed' ? 'Confirmed' : 'Confirm', kind: 'quiet', attrs: { 'data-dl-find': `${u.id}|${f.id}|confirmed`, 'aria-pressed': String(f.state === 'confirmed') } })}${R.button({ label: f.state === 'dismissed' ? 'Dismissed' : 'Dismiss', kind: 'quiet', attrs: { 'data-dl-find': `${u.id}|${f.id}|dismissed`, 'aria-pressed': String(f.state === 'dismissed') } })}</span>` })).join('')}</div>
      ${R.field({ id: `dl-note-${u.id}`, label: 'Notes', quietLabel: true, value: u.depth.note || '', placeholder: 'Anything the next cycle should know (optional)', multiline: true, attrs: { 'data-dl-note': u.id } })}<div class="td-fx">${R.button({ label: n ? `Send ${n} to Review` : 'Send to Review', kind: 'primary', attrs: { 'data-dl-send': u.id, disabled: F.some((f) => !f.state) ? true : null, title: F.some((f) => !f.state) ? 'Confirm or dismiss each first' : 'Review starts its next cycle with them' } })}${F.some((f) => f.state !== 'confirmed') ? R.button({ label: 'Confirm all', kind: 'quiet', attrs: { 'data-dl-all': u.id } }) : ''}</div></div>`;
  }
  function own(u) {   // the task's own stages (panel.task-card: what it shows is this task's): done, the one it is on, still to come
    const k = Math.max(0, u.stage ?? 0), st2 = R.runState(RM.stateOf(u.case)), tn = R.markTone(st2), merged = u.case === 'merged', D = u.depth, v = dv[u.id] || {};
    const partsOf = (i) => { const s = D?.steps[i]; if (!s || (i > k && !merged)) return ''; const lines = D.log.filter((l) => l.s === i).length, arts = (s.arts || []).length; return (lines ? R.stagePart({ label: 'Log', says: `${lines} lines`, open: v.open === `${i}|log`, attrs: { 'data-dl-open': `${u.id}|${i}|log` } }) : '') + (arts ? R.stagePart({ label: 'Artifacts', says: String(arts), open: v.open === `${i}|arts`, attrs: { 'data-dl-open': `${u.id}|${i}|arts` } }) : ''); };
    const metaOf = (i, name) => (D?.steps[i] && (merged || i <= k) ? D.steps[i].meta : merged || i < k ? 'done' : i === k ? (u.detail || st2.word).replace(new RegExp(`^${name} · `), '') : '');
    return `<div class="own-stages">${STAGES.map((name, i) => R.stageLine({ mark: merged || i < k ? R.stepDot({ dotCls: 'is-done', word: 'Done', icon: 'check' }) : i === k ? R.kindMark({ kind: 'task', tone: tn, stage: k, size: 16 }) : R.stepDot({ dotCls: 'is-future', word: 'Not yet', icon: '' }), label: i === k && D && !merged ? `${name} · now` : name, meta: metaOf(i, name), parts: D ? partsOf(i) : '', next: !merged && i > k, body: (i === k && tn === 'fail' && u.why ? u.why.map((w) => `<p class="cmd-s">${esc(w)}</p>`).join('') : '') + (D ? depthBody(u, i) : '') + (D && i === k && !merged ? findingsHtml(u) : '') })).join('')}${R.shows('expert') ? R.textLink({ label: 'Open its full page', attrs: u.id ? { 'data-open-task-page': u.id } : { 'data-open-slice': `${u.case}|${u.title}` } }) : ''}</div>`;
  }
  const taskMark = (t, size) => (t.kind === 'schedule' ? R.kindMark({ kind: 'schedule', size, title: t.detail }) : R.kindMark({ kind: 'task', tone: R.markTone(stOf(t)), stage: t.stage, size, title: `${stOf(t).word} · ${t.detail || ''}` }));
  const gitOf = (t) => (t.git ? R.gitMark({ status: t.git, watch: t.watch || '', title: t.watch ? `Watching · ${t.detail}` : `${t.branch || ''}` }) : '');
  const cardMore = (t, items) => R.moreMenu({ id: `card:${t.id}`, label: `More for ${t.title}`, icon: R.icon('more', 16), open: menu === `card:${t.id}`, items });
  const openCard = (x, t) => {
    if (t.cancelled) return R.turnRow({ mark: R.icon('check', 14), text: `Cancelled: <b>${esc(t.title)}</b>` });
    if (t.gone) return R.turnRow({ mark: R.icon('check', 14), text: `Deleted: <b>${esc(t.title)}</b> the tasks it ran stay` });
    const sched = t.kind === 'schedule', paused = sched && window.RailSchedules?.find(t.id)?.state === 'paused', expert = R.shows('expert');
    const action = t.case === 'scheduled' ? R.button({ label: 'Start now', kind: 'primary', attrs: { 'data-start-now': t.id } }) + R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-cancel-task': t.id } })
      : sched && t.gone ? ''   // deleted: the card says so, nothing left to run or open
      : sched ? (t.time === 'Paused' ? R.button({ label: 'Resume', attrs: { 'data-sched-card': `${t.id}|pause`, title: 'Runs again on its repeat' } }) : '') + (t.time === 'Paused' ? '' : R.button({ label: 'Run now', attrs: { 'data-sched-card': `${t.id}|run`, disabled: window.RailSchedules?.running(t.id), title: window.RailSchedules?.running(t.id) ? 'Its task is running; it can start again when that ends' : null } })) + (expert ? R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-open-sched': t.id } }) : R.button({ label: x.open ? 'Hide its runs' : 'Show its runs', kind: 'quiet', attrs: { 'data-open-task': t.id, 'aria-expanded': String(!!x.open) } }))
        + cardMore(t, [{ id: paused ? 'Resume' : 'Pause', text: paused ? 'Resume' : 'Pause', help: paused ? 'Runs at its times again' : 'Skips its times until you resume it' }, { id: 'Skip', ...window.RailSchedules?.skipItem(t.id) }, { sep: true }, { id: 'Delete', text: 'Delete', danger: true, help: 'Removes the schedule; the tasks it ran stay. Undo in the notice' }])
        : R.button({ label: 'Open', kind: 'quiet', attrs: { 'data-open-task': t.id } });
    const runs = sched && x.open && !expert ? window.RailSchedules?.find(t.id)?.runs || [] : [];   // rail.stay-in-chat: its runs under its card
    return R.taskCard({ compact: true, title: t.title, mark: taskMark(t), word: t.title, detail: t.detail, action, attrs: { 'data-anchor': x.id } }) + (sched && x.open && !expert ? `<div class="tc-rows">${runs.length ? runs.map((r) => R.turnRow({ mark: R.kindMark({ kind: 'task', tone: R.markTone(R.runState(RM.stateOf(r.case))), stage: r.stage, size: 16 }), text: `<b>${esc(r.title)}</b> ${esc(r.meta || '')} · ${esc(r.day)}` })).join('') : R.turnRow({ mark: '', text: 'No runs yet' })}</div>` : '');
  };
  // A task card's actions act here, from the same table the task page reads (run-state's actionFlow): a move to its next
  // state, a confirm under the card, or (a dialog) its page, which still holds the dialogs.
  const CTX = { base: 'dev', pr: '#1180', reset: '17:00', branch: 'feat/billing-csv-export', at: '14:00', value: '$40' };
  // dev's dialogs, each a short form under its card: what it asks, its choices, its action and Cancel
  const taskList = () => (window.RailChats?.data().chats || []).flatMap((c) => c.tasks || []);
  const formPick = (t, items) => R.sentencePicker({ id: `cf-${t.id}`, text: t.form.value, items: items.map((v) => (typeof v === 'string' ? { id: v, text: v, checked: v === t.form.value } : v.id ? { ...v, checked: v.id === t.form.value } : v)), open: menu === `cf-${t.id}`, chevron: R.icon('chevron', 10) });
  const formField = (t, label, o = {}) => R.field({ id: `cf-${t.id}-f`, label, quietLabel: true, value: o.value || '', placeholder: o.placeholder || '', multiline: !!o.multiline, attrs: { 'data-cf-field': t.id } });
  const FORMS = {
    pr: { value: () => 'ready for review', text: (t) => `Open the PR for ${t.title}`, body: (t) => formField(t, 'PR title', { value: t.title }) + `<span class="tp-sentence">as ${formPick(t, ['ready for review', 'a draft'])} into dev</span>`, say: (t, f) => `${f.say}${t.form.value === 'a draft' ? ' as a draft' : ''}` },
    model: { value: () => 'Sonnet 5.5', text: () => 'Resume on another model', body: (t) => `<span class="tp-sentence">Every remaining step runs on ${formPick(t, ENGINE_ITEMS)}</span>` },
    'resume-at': { value: () => '17:00', text: () => 'When it resumes', body: (t) => `<span class="tp-sentence">Resume at ${formPick(t, R.TIMES_OF_DAY)} today</span>` },
    cap: { value: () => '$40', text: () => 'Raise the cost cap', body: (t) => `<span class="tp-sentence">Raise it to ${formPick(t, ['$20', '$40', '$80', '$160'])} for this task</span>` },
    'team-cap': { value: () => '', text: () => 'Go on past the team cap', body: (t) => formField(t, 'Why', { placeholder: 'Why it goes on (the team sees this)', multiline: true }) },
    report: { value: () => 'a wrong result', text: (t) => `Report ${t.title} to the Worca team`, body: (t) => `<span class="tp-sentence">It was ${formPick(t, ['a wrong result', 'too slow', 'too costly', 'stuck', 'something else'])}; the logs go with it</span>` + formField(t, 'Note', { placeholder: 'What happened (optional)', multiline: true }) },
    preset: { value: (t) => t.title, text: () => 'Save its setup as a preset', body: (t) => formField(t, 'Preset name', { value: t.title }) },
    after: { value: () => '', text: (t) => `Start another task after ${t.title}`, body: (t) => { const others = taskList().filter((y) => y !== t && y.kind !== 'schedule').map((y) => y.title).slice(0, 8); if (!t.form.value) t.form.value = others[0] || ''; return `<span class="tp-sentence">Start ${formPick(t, others)} when this one finishes</span>`; } },
    label: { value: () => LABELS[0], text: (t) => `Add a label to ${t.title}`, body: (t) => `<span class="tp-sentence">Label it ${formPick(t, LABELS)}</span>` + formField(t, 'Or a new label', { placeholder: 'Or a new label' }) },
    group: { value: () => 'Release 1.20', text: () => 'Move it to a group', body: (t) => `<span class="tp-sentence">Track it in ${formPick(t, ['Release 1.20', 'Billing export', 'On call', 'Tidy up'])}</span>` },
  };
  const formHtml = (t) => { if (!t.form) return ''; const F = FORMS[t.form.kind]; if (!F) return ''; return `<div class="card-form" data-card-form="${t.id}">${R.confirmForm({ form: t.form.kind, id: `cf-${t.id}-t`, text: F.text(t), body: F.body(t) + R.confirmActions({ yes: t.form.label.replace(/…$/, ''), danger: false }) })}</div>`; };
  // rail.stay-in-chat: outside Expert a fact opens under its card, the part it names (its log, its artifacts)
  function openHere(t, part) {
    const x = turns().find((y) => y.t === 'task' && y.task === t.id); if (!x) return;
    turns().forEach((y) => { y.open = false; y.openSlice = -1; }); x.open = true;
    const D = t.depth; if (D) { const has = (i) => (part === 'log' ? D.log.some((l) => l.s === i) : (D.steps[i]?.arts || []).length > 0), k = Math.max(0, t.stage ?? 0); let i = k; while (i > 0 && !has(i)) i -= 1; if (has(i)) dv[t.id] = { ...(dv[t.id] || {}), open: `${i}|${part}`, art: 0, mode: '', cyc: '', who: '', allArts: part === 'arts' }; }
    paint(); requestAnimationFrame(() => root.querySelector(`[data-anchor="${x.id}"]`)?.scrollIntoView({ block: 'start' }));
  }
  function cardAct(t, label) {
    if (!label) return;
    const ctx = { ...CTX, step: STAGES[t.stage] || 'the current step', value: '{value}' }, live = R.runFlow(ctx);   // {value} is the form's choice, filled when you act
    const ANY = { Pause: live.pauseNow, Stop: live.stop, 'Report this task': live.report, Archive: live.archive, 'Save as preset': { dialog: 'preset', say: `Saved as a preset: ${t.title}` }, 'Run after…': { dialog: 'after', say: `Runs after ${t.title}` }, 'Start a follow-up': { followUp: true }, 'Tell Worca how to fix it': { followUp: true, fix: true }, 'Ask Worca to fix it': { autofix: true }, 'Show the log': { page: true }, 'Label…': { dialog: 'label', say: `Labelled ${t.title}: {value}` }, 'Move to group…': { dialog: 'group', say: `${t.title} moved to the group` } };
    const f = R.actionFlow(RM.stateOf(t.case), ctx)[label] || ANY[label];
    if (!f) { say(label); return; }
    if (f.page) { if (R.shows('expert')) window.RailShell.openTaskPage(t.case, chatId, t.title); else openHere(t, 'log'); return; }
    if (f.autofix) { fixTry(t, 1); return; }   /* the log lives on its page, under What broke */
    if (f.followUp) { const x = turns().find((y) => y.task === t.id && y.t === 'task'); if (x) { x.asking = true; if (f.fix) x.askValue = `Fix what failed: ${(t.why || []).map((w) => w.replace(/^✗\s*/, '')).join('; ') || t.detail}`; paint(); root.querySelector(`[data-ask-changes="${x.id}"]`)?.focus(); } return; }   // a follow-up is asked under the card, tied to this task
    if (f.dialog) { taskList().forEach((y) => { y.form = null; }); t.confirm = null; t.form = { label, kind: f.dialog, flow: f, value: FORMS[f.dialog]?.value(t) ?? '' }; paint(); root.querySelector(`[data-card-form="${t.id}"] input, [data-card-form="${t.id}"] textarea`)?.focus(); return; }   // what dev asks in a dialog, asked under the card, with its choices
    if (f.confirm) { t.confirm = { label, text: f.confirm, flow: f }; paint(); return; }
    doAct(t, label, f);
  }
  // Ask Worca to fix it: Worca reads what broke, says where it starts again and what it changes, and tries up to three
  // times on its own; the card says which try it is on; after the third it asks you (the prototype's first try passes)
  function fixTry(t, n) {
    const what = (t.why || []).map((w) => w.replace(/^✗\s*/, '')), at = STAGES[Math.max(0, t.stage)] || 'Build';
    Object.assign(t, { fixing: n, was: '', case: 'working', detail: `Fixing · try ${n} of 3: ${at} again, ${what.length ? `for ${what.length} ${what.length === 1 ? 'failure' : 'failures'}` : 'with what broke'}` });
    put(chatOfT(t), t); paint(); say(`Worca fixes it: ${at} again, up to 3 tries, then it asks you`);
    setTimeout(() => { if (t.fixing !== n) return; Object.assign(t, { fixing: 0, stage: Math.min(4, t.stage + 1), detail: `${STAGES[Math.min(4, t.stage + 1)]} · fixed on try ${n}: ${what.length || 'the'} failing ${what.length === 1 ? 'check passes' : 'checks pass'}`, why: null }); put(chatOfT(t), t); paint(); }, 5000);
  }
  function doAct(t, label, f) {
    if (f.to === 'paused-you' && !t.was) { t.was = t.case; t.wasDetail = t.detail; }   // Resume goes back to where it was
    if (/^Resume/.test(label) && t.was) { t.case = t.was; t.detail = t.wasDetail; t.was = ''; }
    else if (f.to && RM.cases?.some?.((c) => c.id === f.to)) {
      t.case = f.to; t.detail = `${STAGES[Math.max(0, t.stage)] || 'Plan'} · carries on`;   /* the kicker says the state; the line says where it is */
      const again = /^Restart (\w+)/.exec(label); if (again) { const k = STAGES.findIndex((w) => w.toLowerCase() === again[1].toLowerCase()); if (k >= 0) { t.stage = k; t.detail = `${STAGES[k]} runs again`; } }   // it goes back where it says
      else { const st = RM.stageOf?.(f.to); if (st?.stage >= 0) t.stage = f.to === 'merged' ? 4 : st.stage; }
    }
    put(chatOfT(t), t);   // the store hears it; the card, the bar, Pulse and Tasks read it again
    say(wouldSay(f.say || label));
  }
  // The proposed task, at dev's run proposal's parity, in Rail's words: the composer's sentence (with when), the workflow
  // said in a line, the brief with its files, Shaper's perspectives, Customise (where it runs, branches, guardrails, labels,
  // memory, asks you, and in Expert the agents), then Start (Schedule, Start planning), Not now, Open in the composer.
  const WORKFLOWS = { Default: 'Plan, build and review, then a PR', Lean: 'Build and a quick review', get Shaper() { return R.prefs.flag('shapeRequirements') ? 'Agrees what must be true, then up to 3 questions and a plan you approve' : 'Up to 3 questions, then a plan you approve'; }, 'Architecture (C4)': 'A C4 model first, then the plan' };
  const WHEN = ['now', 'at 17:00', 'tonight at 02:00', 'every day at 02:00', 'every weekday at 09:00', 'every Monday at 09:00', 'after Add CSV export'];   // a schedule's own times are on its page
  const PERSPECTIVES = ['Product', 'Security', 'UX', 'Data', 'Performance', 'Operations'];
  const EFFORT = ['low', 'medium', 'high'];
  // Shaper: once its questions are answered, a receipt names the decision and its plan follows
  function afterClarify() {
    const l = turns(), qs = l.filter((y) => y.t === 'question' && y.shaper), open = qs.filter((y) => !y.answered);
    if (!qs.length || open.length) return;
    const from = qs[0].shaper; if (l.some((y) => y.t === 'plan' && y.from === from)) return;
    const at = l.indexOf(qs[qs.length - 1]) + 1, k = Date.now().toString(36);
    const p = l.find((y) => y.id === from), task = p?.ask || p?.title || 'The task';
    if (!l.some((y) => y.t === 'change' && y.kind === 'Requirements' && y.from === from)) {   // first the requirements, by perspective, for you to agree
      const persp = p?.persp || ['Product'];
      l.splice(at, 0, { t: 'change', id: `rq${k}`, from, kind: 'Requirements', title: `What “${clip(task, 40)}” must do`, why: `${persp.length + 2} requirements from your answers, by perspective`, rows: [
        { name: 'Product', before: '', after: qs[0]?.answered || 'The smallest change that works' }, { name: 'Product', before: '', after: 'It works for every account, not only yours' },
        ...persp.filter((v) => v !== 'Product').map((v) => ({ name: v, before: '', after: { Security: 'Only people allowed to see it can use it', UX: 'It says what it does in plain words', Data: 'Numbers stay exact', Performance: 'Large exports stream', Operations: 'Every run is logged' }[v] || 'Reviewed' })),
        { name: 'Rollout', before: '', after: qs[1]?.answered || 'Behind a flag first' }],
        actions: [['Agree and plan', 'primary', 'Requirements agreed'], ['Ask for changes', 'quiet', '']], menuItems: ['Try again'], state: 'proposed' });
      const own = p?.task && taskOf(p.task); if (own) { Object.assign(own, { case: 'question', detail: 'Requirements wait for your OK' }); put(chat(), own); }
      return;
    }
    const own = p?.task && taskOf(p.task); if (own) { Object.assign(own, { case: 'plan', detail: 'The plan waits for your OK' }); put(chat(), own); }
    const req = l.find((y) => y.t === 'change' && y.kind === 'Requirements' && y.from === from);
    l.splice(req ? l.indexOf(req) + 2 : at, 0, { t: 'plan', id: `pl${k}`, from, title: task, summary: `Built in two slices, then one PR into dev. Decided: ${qs.map((y) => y.answered).join('; ')}.`, decided: qs.map((y) => [y.text, y.answered]),
      steps: [`Build ${task} behind its tests`, 'Check it against what you decided', `Review it from ${(p?.persp || ['Product']).join(', ')}`, 'Open one PR into dev'], tests: ['Unit tests for the new code', 'The existing suite stays green'], v: 1, versions: 1, persp: p?.persp || ['Product'],
      roles: (p?.persp || ['Product']).map((name, j) => ({ name, ok: j !== 1, note: { Product: 'Matches what was asked', Security: 'Wants the export behind a permission check', UX: 'Wants the column names checked', Data: 'Dates and money stay exact', Performance: 'Streams large exports', Operations: 'Logs each export' }[name] || 'Fine as written' })) });
  }
  // One filled button on the screen (rail.one-action): only the newest card still asking keeps its primary; the rest go
  // quiet, so what waits on you is the loudest thing here.
  const taskWaits = (y) => { if (y.t !== 'task') return false; const t = taskOf(y.task), r = t?.run && window.RailWorld.find(t.run); return !!r && window.RailWorld.section(r) === 'needs'; };
  const ASKING = (y) => taskWaits(y) || (y.t === 'proposal' && !y.later) || (y.t === 'change' && y.state === 'proposed' && !y.done) || (y.t === 'plan' && !y.approved) || (y.t === 'feature' && y.split) || ((y.t === 'gate' || y.t === 'ship' || y.t === 'act') && !y.done) || (y.t === 'question' && !y.answered);
  function calmCards(l) {
    let last = -1; l.forEach((y, k) => { if (ASKING(y)) last = k; });
    return l.map((y, k) => { const h = turnHtml(y, k); return k === last ? h : h.replace(/ btn-primary"/g, '"'); }).join('');
  }
  // Ask for changes, under the card it is about: a field, Send changes, Not now
  const askChanges = (x) => (x.asking ? `<div class="ask-changes">${R.field({ id: `chg-${x.id}`, label: 'What should change', quietLabel: true, placeholder: 'What should change?', value: x.askValue || '', multiline: true, attrs: { 'data-ask-changes': x.id } })}<span class="tp-actions">${R.button({ label: 'Send changes', kind: 'primary', attrs: { 'data-changes-send': x.id } })}${R.button({ label: 'Not now', kind: 'quiet', attrs: { 'data-changes-cancel': x.id } })}</span></div>` : '');
  function proposalHtml(x) {
    if (x.later) return R.turnRow({ mark: R.kindMark({ kind: 'task', tone: 'idle', size: 16 }), text: `Not now: <b>${esc(x.title)}</b>`, end: R.button({ label: 'Bring back', kind: 'quiet', attrs: { 'data-pp-back': x.id } }) });
    const pp = (f, text, items, tip) => R.sentencePicker({ id: `pp-${x.id}-${f}`, text, tip, items: items.map((v) => (typeof v === 'string' ? { id: v, text: v, checked: v === text } : v.id ? { ...v, checked: v.id === text } : v)), open: menu === `pp-${x.id}-${f}`, chevron: R.icon('chevron', 10) });
    const shaper = x.workflow === 'Shaper', later = x.when && x.when !== 'now';
    const sentence = W(/^every/.test(x.when || '') ? 'Schedule' : 'Task') + W('on') + pp('project', x.project, PROJECTS, 'Which project') + W('with') + pp('workflow', x.workflow, Object.keys(WORKFLOWS), 'Which workflow') + W('on') + pp('engine', x.engine, ENGINE_ITEMS, 'Which engine, then its model') + W('·') + pp('effort', x.effort || 'high', EFFORT, 'How hard it thinks') + pp('when', x.when || 'now', WHEN, 'When it starts: now, at a time, repeating, or after another task') + W('then') + pp('then', x.then, ['open a PR', 'leave a branch', 'merge into dev'], 'What happens when it is done');
    const brief = `<div class="tp-brief">${R.field({ id: `pp-brief-${x.id}`, label: 'Brief: what the first agent reads · Markdown', value: x.brief ?? x.why.replace(/^From this chat: /, ''), multiline: true, hint: `${(x.brief ?? x.why).length} characters`, attrs: { 'data-pp-brief': x.id } })}${(x.files || []).length ? `<span class="you-files">${x.files.map((f) => R.button({ label: f, kind: 'quiet', icon: R.icon('x', 11), attrs: { 'data-pp-unfile': `${x.id}|${f}`, title: `Removes ${f}` } })).join('')}</span>` : ''}</div>`;
    // Shaper's perspectives: a picker in the sentence ("reviewed by Product, Security"), each a tick; Product always reviews
    const pl = x.persp || ['Product'];
    const persp = shaper ? W('reviewed by') + R.sentencePicker({ id: `pp-${x.id}-persp`, text: pl.join(', '), tip: 'Who reviews the plan; Product always does', items: PERSPECTIVES.map((v) => ({ id: v, text: v, checked: pl.includes(v), off: v === 'Product', help: v === 'Product' ? 'Always reviews' : '' })), open: menu === `pp-${x.id}-persp`, chevron: R.icon('chevron', 10) }) : '';
    const what = `<p class="tp-what">${esc(WORKFLOWS[x.workflow] || '')}${later ? ` · starts ${esc(x.when)}` : ''}</p>`;
    const row = (k, v) => `<div class="cr"><span>${k}</span><span>${v}</span></div>`;
    const target = pp('target', x.target || 'Project', ['No project', 'Project', 'Workspace'], 'Where it runs');
    const agents = R.shows('expert') ? `<div class="tp-agents"><span class="tp-label">Agents ${R.button({ label: 'Reset to proposal', kind: 'quiet', attrs: { 'data-pp-reset': x.id } })}${R.button({ label: 'Save as project defaults', kind: 'quiet', attrs: { 'data-pp-save': x.id } })}</span>${['Plan', 'Build', 'Review'].map((a) => { const g = (x.agents || {})[a] || {}; return `<div class="cr"><span>${a}</span><span>${pp(`model${a}`, g.model || x.engine, ENGINES, `${a}'s model`)}${W('·')}${pp(`eff${a}`, g.effort || x.effort || 'high', EFFORT, `${a}'s effort`)}${W('·')}${pp(`sub${a}`, g.sub || 'no sub-agents', ['no sub-agents', '2 sub-agents', '4 sub-agents'], `${a}'s sub-agents`)}${W('·')}${pp(`fan${a}`, g.fan || 'one at a time', ['one at a time', 'fan out 3'], `${a}'s fan-out`)}</span></div>`; }).join('')}</div>` : '';
    const more = row('Where it runs', target)
      + row('Source branch', pp('src', x.src || 'dev', ['dev', 'main', 'origin · latest'], 'Where it starts from'))
      + row('Feature branch', R.field({ id: `pp-feat-${x.id}`, label: 'Feature branch', quietLabel: true, value: x.feature || `feat/${slug(x.title)}`, attrs: { 'data-pp-feature': x.id } }))
      + row('Run on the source branch', R.switchButton({ on: !!x.onSource, label: 'Run on the source branch', attrs: { 'data-pp-onsource': x.id } }))
      + row('Base branch', pp('base', x.base || 'dev', ['dev', 'main'], 'Where its PR goes'))
      + row('Guardrails', pp('guard', x.guard || 'Team default', ['Team default', 'Strict', 'Read only'], 'Applies to every agent in this task'))
      + row('Labels', pp('labels', x.labels || 'billing', ['billing', 'hotfix', 'export', 'no label'], 'Its labels'))
      + row('Memory', pp('memory', x.memory || 'This project', ['This project', 'None'], 'What it remembers'))
      + row('Asks you', pp('asks', x.asks || 'When the plan has open questions', ['When the plan has open questions', 'Never', 'Before every step'], 'When it stops to ask'))
      + row('Pull request', pp('pr', x.pr || 'ready for review', ['ready for review', 'a draft', 'no PR, a branch only'], 'How its PR opens'))
      + row('Then', pp('watch', x.watch || 'watch it and fix failing checks', ['watch it and fix failing checks', 'only tell me when checks fail', 'leave it'], 'What Worca does after the PR opens'))
      + row('Review rounds', pp('rounds', x.rounds || 'up to 3', ['up to 1', 'up to 3', 'up to 5'], 'How many times Review can send it back to Build'))
      + (later ? row('Time zone', pp('tz', x.tz || 'Europe/Sofia (yours)', ['Europe/Sofia (yours)', 'UTC'], 'The clock its times follow'))
        + row('If Worca was off', pp('missed', x.missed || 'run it when Worca is back', ['run it when Worca is back', 'skip it'], 'A start missed while Worca was not running'))
        + row('If the last still runs', pp('overlap', x.overlap || 'wait for it', ['wait for it', 'skip this one', 'run both'], 'When a start comes while the one before still runs'))
        + row('Pause it after', pp('fails', x.fails || '3 failures in a row', ['3 failures in a row', '5 failures in a row', 'never'], 'Stops repeating when it keeps failing'))
        + row('Ends', pp('ends', x.ends || 'never', ['never', 'after 10 runs', 'at the end of the month'], 'When the schedule stops by itself')) : '')
      + (R.shows('advanced') ? row('Tools', pp('mcp', x.mcp || 'Project defaults', ['Project defaults', 'None', 'All I have'], 'Which MCP servers and skills its agents can use')) : '')
      + agents;
    const nudge = x.nudge && !shaper ? `${R.kindMark({ kind: 'chat', tone: 'ask', size: 14 })}<span>This has open decisions: Shaper can ask them first (≈ $12 · ~40 min, against ≈ $8 · ~25 min as is).</span>` : '';
    const alts = x.nudge && !shaper ? { open: menu === `ppalt-${x.id}`, attrs: { 'data-menu': `ppalt-${x.id}` }, menu: R.compactMenu({ items: [{ id: `ppalt-${x.id}|asis`, text: 'Run as is', hint: '≈ $8 · ~25 min' }, { id: `ppalt-${x.id}|shape`, text: 'Shape it first', hint: '≈ $12 · ~40 min' }] }) } : null;
    const kicker = x.ticket ? `Proposed · from ${x.ticket}` : x.preset ? `Proposed · from preset ${x.preset}` : 'Proposed';
    const ppMenu = R.moreMenu({ id: `ppm:${x.id}`, label: `More for ${x.title}`, icon: R.icon('more', 16), open: menu === `ppm:${x.id}`, items: [{ id: 'composer', text: 'Edit in the composer', help: 'Puts all of it in the box to change; this card stays until you send' }, { id: 'preset', text: 'Save as preset', help: 'Starts the next task with this setup' }] });
    const card = R.taskProposal({ menu: ppMenu, title: x.title, why: x.why, sentence: sentence + persp + what, more: brief + more, open: x.open, nudge, hooks: { title: { 'data-pp-title': x.id }, more: { 'data-pp-more': x.id }, start: { 'data-pp-start': x.id }, later: { 'data-pp-later': x.id } }, start: later ? 'Schedule' : shaper ? 'Start planning' : 'Start', alts, kicker, attrs: { 'data-anchor': x.id } });
    return card;
  }

  function turnHtml(x, i) {
    const fold = () => ({ 'data-fold-turn': String(i), ...(x.id ? { 'data-anchor': x.id } : {}) });
    if (x.t === 'you') return R.youTurn({ text: x.text, quote: x.quote || '', files: x.files || [], refs: (x.refs || []).map((r) => ({ text: r.title, mark: R.kindMark({ kind: 'task', tone: 'idle', size: 14 }), attrs: { 'data-open-ref': r.case } })), attrs: { 'data-anchor': x.id || '' } });
    // commands are dev's on Rail's rail (CommandRow, CommandGroup): a group folded to its head, a failure opening it and
    // itself; no marks, the words say how each went; one fold opens the command and its output, each with Copy
    const TERMINAL = { 'data-say': 'Would open it in the terminal pane' };
    if (x.t === 'cmd') {   // one command running now: its seconds count, Stop beside it; done, it folds like any command
      const state = x.stopped ? 'stopped' : x.done ? 'ok' : 'run';
      return R.commandRow({ summary: x.sum || x.cmd, cmd: x.cmd, state, end: x.stopped ? 'stopped by you' : x.done ? x.end || '' : '1s', open: state !== 'run' && !!x.open, dir: x.dir || '', out: x.out || '', hooks: { toggle: { 'data-cmdx': String(i) }, stop: { 'data-cmd-stop': String(i) }, terminal: TERMINAL }, attrs: state === 'run' ? { 'data-think-at': String(x.at || (x.at = Date.now())) } : {} });
    }
    if (x.t === 'commands') {
      const failed = x.rows.filter((r) => r.state === 'fail').length, first = x.rows.findIndex((r) => r.state === 'fail');
      if (x.open === undefined) x.open = failed > 0; if (x.rowOpen === undefined) x.rowOpen = first;
      const rowOf = (r, k, a = {}) => R.commandRow({ ...r, dir: r.dir || x.dir || '', open: x.rowOpen === k, hooks: { toggle: { 'data-cmdr': `${x.id}|${k}` }, terminal: TERMINAL }, attrs: a });
      if (x.rows.length === 1) return rowOf(x.rows[0], 0, { 'data-anchor': x.id });
      return R.commandGroup({ head: R.commandHead({ count: x.rows.length, failed, dur: x.dur || '' }), open: x.open, rows: x.rows.map((r, k) => rowOf(r, k)).join(''), hooks: { toggle: { 'data-cmdg': x.id } }, attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'gate') {   // a step that needs a decision, or failed: its choices on one line
      if (x.done) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.title)}</b> ${esc(x.done)}` });
      return R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: x.failed ? 'fail' : 'ask', size: 16 }), text: `<b>${esc(x.title)}</b> ${esc(x.line)}`, end: x.actions.map(([l, k], n) => R.button({ label: l, kind: /^(Stop|Abort|Cancel the rest|Delete|Remove|Discard)/.test(l) ? 'quiet' : k, cls: /^(Stop|Abort|Cancel the rest|Delete|Remove|Discard)/.test(l) ? 'is-danger' : '', attrs: { 'data-gate': `${x.id}|${n}` } })).join(''), attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'ship') {   // what ships: each requirement met, not met (where it moved) or dropped (why); one PR or stacked
      if (x.done) return R.turnRow({ mark: R.gitMark({ status: 'open' }), text: `<b>${esc(x.done)}</b>` });
      const pk = (n, v) => R.sentencePicker({ id: `ship-${x.id}-${n}`, text: v, tip: 'Met, not met (where it moved) or dropped (why)', items: ['Met', 'Not met: moved to a later task', 'Dropped: not needed now'].map((o) => ({ id: o, text: o, checked: o === v })), open: menu === `ship-${x.id}-${n}`, chevron: R.icon('chevron', 10) });
      const met = x.reqs.filter((r) => r.v === 'Met').length;
      const rows = x.reqs.map((r, n) => R.turnRow({ mark: R.icon(r.v === 'Met' ? 'check' : 'x', 14), text: esc(r.text), end: pk(n, r.v) })).join('');
      const how = `<div class="tp-sentence"><span>Ships</span>${R.sentencePicker({ id: `shiphow-${x.id}`, text: (x.how || 'as one PR'), tip: 'One PR, or a stack of PRs', items: ['as one PR', 'as stacked PRs'].map((v) => ({ id: v, text: v, checked: (x.how || 'as one PR') === v })), open: menu === `shiphow-${x.id}`, chevron: R.icon('chevron', 10) })}</div>`;
      return R.changeProposal({ kind: 'Ship', title: x.title, why: `Requirements ${met}/${x.reqs.length}`, body: `<div class="tc-rows">${rows}</div>${how}`, apply: 'Create PR', hooks: { apply: { 'data-ship': x.id }, decline: { 'data-ship-later': x.id } }, attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'feature') {
      // a slice opens its stages as a task's card does: the same Show its stages, and the stages in the card's own stream
      const slTone = (s) => (s.off ? 'idle' : R.markTone(R.runState(RM.stateOf(s.case))));   // a slice cancelled or stopped by you is over, whatever it was
      const rows = x.slices.map((sl, k) => R.turnRow({ mark: R.kindMark({ kind: 'feature', tone: slTone(sl), stage: sl.stage, size: 16 }), text: `<b>${esc(sl.title)}</b> ${esc(sl.detail)}`,
        end: R.button({ label: x.openSlice === k ? 'Hide its stages' : 'Show its stages', kind: 'quiet', icon: R.icon(x.openSlice === k ? 'chevron' : 'chevR', 12), attrs: { 'data-slice-open': `${x.id}|${k}`, 'aria-expanded': String(x.openSlice === k) } }) })).join('');
      const sl = x.slices[x.openSlice], sliceStream = sl ? R.turnRow({ mark: R.kindMark({ kind: 'feature', tone: R.markTone(R.runState(RM.stateOf(sl.case))), stage: sl.stage, size: 16 }), text: `<b>${esc(sl.title)}</b> its stages`, end: R.button({ label: 'Hide its stages', kind: 'quiet', icon: R.icon('chevron', 12), attrs: { 'data-slice-open': `${x.id}|${x.openSlice}`, 'aria-expanded': 'true' } }), attrs: { 'data-slice-head': '' } }) + own(sl) : '';   // whose stages these are, from the slice itself
      if (x.split) {
        const srows = x.slices.map((sl, n) => R.turnRow({ mark: R.kindMark({ kind: 'task', tone: 'idle', size: 16 }), text: `<b>${n + 1} · ${esc(sl.title)}</b> ${esc(sl.detail)}`, end: R.moreMenu({ id: `slice:${x.id}:${n}`, label: `More for ${sl.title}`, icon: R.icon('more', 16), open: menu === `slice:${x.id}:${n}`, items: [{ id: 'Merge with next', text: 'Merge with next', off: n === x.slices.length - 1, help: n === x.slices.length - 1 ? 'It is the last: nothing comes after it' : 'One task instead of two' }, { id: 'Remove', text: 'Remove', danger: true, off: x.slices.length === 1, help: x.slices.length === 1 ? 'A split needs at least one task' : 'Undo edits brings it back' }] }) })).join('');
        return R.taskCard({ title: x.title, mark: R.kindMark({ kind: 'feature', tone: 'ask' }), word: 'Split', detail: `one after another${x.askEach ? ' · asks before each' : ''}`, rows: srows, action: R.button({ label: `Approve ${x.slices.length} ${x.slices.length === 1 ? 'task' : 'tasks'}`, kind: 'primary', attrs: { 'data-split-ok': x.id } }) + R.button({ label: 'Ask for changes', kind: 'quiet', attrs: { 'data-plan-changes': x.id } }), menu: R.moreMenu({ id: `split:${x.id}`, label: 'More for the split', icon: R.icon('more', 16), open: menu === `split:${x.id}`, items: ['Plan it as one', { id: 'Undo edits', text: 'Undo edits', off: !x.was, help: x.was ? 'Back to the split Worca proposed' : 'Nothing edited yet' }, x.askEach ? 'Don’t ask before each task' : 'Ask me before each task', { sep: true }, { id: 'Stop', text: 'Stop', danger: true, help: 'Sets the split aside; nothing starts. Undo in the notice' }] }), attrs: { 'data-anchor': x.id } }) + askChanges(x);
      }
      const halted = !!x.halted, stopped = !!x.stopped, rest = x.slices.some((sl) => sl.case === 'scheduled' && !sl.off);
      const parts = x.slices.map(slTone), tone = stopped ? 'stop' : halted ? 'pause' : 'run';
      const stopAsk = x.stopAsk ? R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: '<b>Stop?</b> The running task stops now and the rest never start; finished tasks and their branches stay', end: R.button({ label: 'Stop', kind: 'quiet', cls: 'is-danger', attrs: { 'data-feat': `${x.id}|stop-yes` } }) + R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-feat': `${x.id}|stop-no` } }) }) : '';
      return R.taskCard({ open: !!sliceStream, stream: sliceStream, title: x.title, mark: R.kindMark({ kind: 'feature', tone, stage: 1 }), word: stopped ? 'Stopped' : halted ? 'Paused' : 'Working', detail: `${R.partsWord(parts)} tasks done, one after another${x.askEach ? ' · asks before each' : ''}`, stages: R.stageBar({ labels: STAGES, stage: 1, tone }), rows, action: stopped ? R.button({ label: 'Re-plan the rest', kind: 'quiet', attrs: { 'data-feat': `${x.id}|replan` } }) : halted ? R.button({ label: 'Resume', kind: 'primary', attrs: { 'data-feat': `${x.id}|resume` } }) + R.button({ label: 'Re-plan the rest', kind: 'quiet', attrs: { 'data-feat': `${x.id}|replan` } }) : x.stopAsk ? '' : R.button({ label: 'Pause', kind: '', attrs: { 'data-feat': `${x.id}|pause` } }) + R.button({ label: 'Stop', kind: 'quiet', cls: 'is-danger', attrs: { 'data-feat': `${x.id}|stop` } }), menu: stopped ? '' : R.moreMenu({ id: `feat:${x.id}`, label: 'More for the feature', icon: R.icon('more', 16), open: menu === `feat:${x.id}`, items: [{ id: 'Re-plan the rest', text: 'Re-plan the rest', help: 'Say how in the box; the running task is not touched' }, { id: 'Cancel the rest', text: 'Cancel the rest', off: !rest, help: rest ? 'What has not started never starts. Undo in the notice' : 'Nothing is waiting to start' }, x.askEach ? 'Don’t ask before each task' : 'Ask before each task'] }), attrs: { 'data-anchor': x.id } }) + stopAsk;
    }
    if (x.t === 'plan') {
      const list = (h, items, ordered) => items?.length ? `<h4>${esc(h)}</h4><${ordered ? 'ol' : 'ul'}>${items.map((w) => `<li>${esc(w)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>` : '';
      const full = `<h4>What it does</h4><p class="tr-text">${esc(x.summary)}</p>${list('Decided', (x.decided || []).map(([q, a]) => `${q} ${a}`))}${list('Steps', x.steps || ['Build it behind its tests', 'Review it', 'Open one PR into dev'], true)}${list('How it is checked', x.tests || ['The existing suite stays green'])}`;
      const version = R.sentencePicker({ id: `pv-${x.id}`, text: `v${x.v} of ${x.versions}`, tip: 'Earlier versions of the plan', items: Array.from({ length: x.versions }, (_, k) => ({ id: String(k + 1), text: `v${k + 1}${k + 1 === x.versions ? ' (latest)' : ''}`, checked: k + 1 === x.v })), open: menu === `pv-${x.id}`, chevron: R.icon('chevron', 10) });
      if (x.approved) return R.turnRow({ mark: R.icon('check', 14), text: `<b>Plan approved</b> v${x.v}: building it` });
      const planMenu = R.moreMenu({ id: `plan:${x.id}`, label: 'More for the plan', icon: R.icon('more', 16), open: menu === `plan:${x.id}`, items: [{ id: 'Fix all', text: 'Fix all', off: !x.roles.some((r) => !r.ok), help: x.roles.some((r) => !r.ok) ? 'Answers what the reviewers left open, as a new version' : 'No reviewer has anything open' }, { id: 'Update for other perspectives', text: 'Update for other perspectives', off: PERSPECTIVES.every((p) => x.roles.some((r) => r.name === p)), help: PERSPECTIVES.every((p) => x.roles.some((r) => r.name === p)) ? 'Every perspective has reviewed it' : 'Another perspective reviews it, as a new version' }, { id: 'Save to plans/', text: 'Save to plans/', off: !!x.savedAs, help: x.savedAs ? `Would be ${x.savedAs}` : 'Would write it into the project’s plans folder' }, { id: 'Open in the composer', text: 'Open in the composer', help: 'Puts the plan in the box to change; this card stays' }, { sep: true }, { id: 'Stop', text: 'Stop', danger: true, help: 'Sets the plan aside; nothing is built. Undo in the notice' }] });
      const extra = x.savedAs ? `<p class="cmd-s">Would be saved as ${esc(x.savedAs)}</p>` : '';   // one line before the actions: who reviewed it (the shape check and perspectives are in it, and in ⋯)
      return askChanges(x) ? R.planCard({ menu: planMenu, extra, check: 'shape check passed', title: x.title, summary: x.summary, version, roles: x.roles, open: !!x.open, hooks: { roles: { 'data-plan-roles': x.id }, approve: { 'data-plan-approve': x.id }, changes: { 'data-plan-changes': x.id }, full: { 'data-plan-full': x.id } }, full, fullOpen: !!x.fullOpen, attrs: { 'data-anchor': x.id } }) + askChanges(x) : R.planCard({ menu: planMenu, extra, check: 'shape check passed', title: x.title, summary: x.summary, version, roles: x.roles, open: !!x.open, hooks: { roles: { 'data-plan-roles': x.id }, approve: { 'data-plan-approve': x.id }, changes: { 'data-plan-changes': x.id }, full: { 'data-plan-full': x.id } }, full, fullOpen: !!x.fullOpen, attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'filesgrid') return R.filesCard({ label: x.label || 'Files', files: x.files.map((f) => ({ ...f, view: { 'data-say': `Would open ${f.name}` }, download: { 'data-say': `Would download ${f.name}` } })) });
    if (x.t === 'words') return `<p class="convo-words">${x.html}</p>`;
    if (x.t === 'proposal') return proposalHtml(x);
    if (x.t === 'divider') return R.turnDivider({ text: x.text });
    if (x.t === 'notice') return R.turnRow({ mark: R.icon('check', 14), text: esc(x.text) });
    if (x.t === 'act') {
      if (x.done) return R.turnRow({ mark: R.icon('check', 14), text: esc(x.done) });
      const mark = x.mark === 'git' ? R.gitMark({ status: 'branch', title: 'Its branch' }) : R.kindMark({ kind: 'chat', tone: 'ask', size: 16 });
      return R.turnRow({ mark, text: x.text, end: x.actions.map(([label, kind], k) => R.button({ label, kind: kind === 'danger' ? 'quiet' : kind, cls: kind === 'danger' ? 'is-danger' : '', attrs: { 'data-act': `${x.id}|${k}` } })).join(''), attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'change' && x.after && !turns().find((y) => y.id === x.after)?.done) return '';   // one thing at a time: it waits for the card before it
    if (x.t === 'change') {
      const STEPS = [['Plan', 'Plan the contract → Sign off'], ['Build', 'Slice 1: read → Slice 2: write → Slice 3: auth'], ['Review', 'Review each slice'], ['PR', 'One PR into dev']];
      // a workflow proposed at dev's depth: each step a row with its model and effort to change in place, its loop, what it adds in cost
      const wpick = (id, text, items, tip) => R.sentencePicker({ id, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === id, chevron: R.icon('chevron', 10) });
      const graph = x.steps && x.state !== 'applied' ? `<div class="set-rows" style="margin:6px 0 0">${x.steps.map(([n, who, m, e], k) => R.settingsRow({ name: `${k + 1}. ${n}`, sentence: `${esc(who)} on ${wpick(`wfs-${x.id}-${k}-m`, m, ENGINES, 'Its model')} ${wpick(`wfs-${x.id}-${k}-e`, e, ['low', 'medium', 'high'], 'How hard it thinks')}` })).join('')}${x.loop ? R.settingsRow({ name: 'Loop', sentence: `${esc(x.loop[0])} sends it back to ${esc(x.loop[1])} up to ${wpick(`wfl-${x.id}`, x.loop[2], ['1', '2', '3', '5'], 'How many rounds')} times` }) : ''}</div>${x.cost ? `<p class="convo-head" style="margin:6px 0 0">${esc(x.cost)}</p>` : ''}` : '';
      const choice = x.choice ? `<div class="tp-sentence"><span>${esc(x.choice.label)}</span>${R.sentencePicker({ id: `cpch-${x.id}`, text: x.picked || x.choice.rec, tip: `${x.choice.label}: ${x.choice.rec} is what Worca recommends`, items: x.choice.items.map((v) => ({ id: v, text: v, help: v === x.choice.rec ? 'Worca recommends it' : '', checked: (x.picked || x.choice.rec) === v })), open: menu === `cpch-${x.id}`, chevron: R.icon('chevron', 10) })}</div>` : '';
      const HOW = { Folder: ['a folder on this machine', 'Add'], Clone: ['a repository URL', 'Clone'], New: ['a new, empty project', 'Create'] };
      const pf = (k, label, v, ph) => R.field({ id: `pj-${x.id}-${k}`, label, value: x.f?.[k] ?? v, placeholder: ph || '', attrs: { 'data-pj-field': `${x.id}|${k}` } });
      const project = x.kind === 'Project' && x.how ? `<div class="tp-sentence"><span>Add a project from</span>${R.sentencePicker({ id: `pj-${x.id}`, text: HOW[x.how][0], tip: 'Where the project comes from', items: Object.entries(HOW).map(([k, [w]]) => ({ id: k, text: w, checked: x.how === k })), open: menu === `pj-${x.id}`, chevron: R.icon('chevron', 10) })}</div><div class="pj-fields">${
        x.how === 'Folder' ? pf('path', 'Folder', '', '~/src/your-project') + R.button({ label: 'Choose a folder…', kind: 'quiet', attrs: { 'data-say': 'Would open a folder picker on this machine' } })
        : x.how === 'Clone' ? pf('url', 'Repository URL', '', 'https://github.com/acme/billing-web') + pf('branch', 'Branch', 'main') + pf('dir', 'Folder name', '', 'Worca names it from the URL')
          : pf('name', 'Name', '', 'billing-web') + pf('where', 'Where', '~/src') + `<div class="tp-sentence"><span>with</span>${R.sentencePicker({ id: `pjg-${x.id}`, text: x.git || 'git', tip: 'Start it as a git repository', items: ['git', 'no git'].map((v) => ({ id: v, text: v, checked: (x.git || 'git') === v })), open: menu === `pjg-${x.id}`, chevron: R.icon('chevron', 10) })}</div>`}</div>` : '';
      if (project) x.apply = HOW[x.how][1];
      const acts = x.actions ? x.actions.map(([label, kind, done], k) => ({ label: x.diff && k === 1 && x.diffOpen ? 'Hide the diff' : label, kind, attrs: { 'data-cp-act': `${x.id}|${k}`, ...(x.diff && k === 1 ? { 'aria-expanded': String(!!x.diffOpen) } : {}) } })) : null;
      const diff = x.diff && x.diffOpen ? R.list({ groups: [{ title: `The diff · ${x.diff.length} files`, rows: x.diff.map(([f, n]) => R.listRow({ title: f, meta: n, mark: R.kindMark({ kind: 'plugin', icon: 'file' }), open: { 'data-say': `Would open ${f}: its lines, added and removed` } })) }] }) : '';
      if (x.done) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.title)}</b> ${esc(x.done)}` });
      const cfm = x.confirmDelete ? R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: `<b>${esc(x.confirmDelete)}?</b> Its times end; the tasks it ran stay`, end: R.button({ label: 'Delete', kind: 'quiet', cls: 'is-danger', attrs: { 'data-chg-yes': x.id } }) + R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-chg-no': x.id } }) }) : '';   // act.confirm
      const cpMenu = R.moreMenu({ id: `chg:${x.id}`, label: `More for ${x.title}`, icon: R.icon('more', 16), open: menu === `chg:${x.id}`, items: [...(x.menuItems || []), 'Ask about it', 'Not now'] });
      return askChanges(x) ? R.changeProposal({ menu: cpMenu, actions: acts, kind: x.kind, title: x.title, why: x.why || '', rows: x.rows || [], body: graph + choice + diff, state: x.state, apply: x.apply || 'Apply', hooks: { apply: { 'data-cp-apply': x.id }, decline: { 'data-cp-decline': x.id }, revert: { 'data-cp-revert': x.id } }, attrs: { 'data-anchor': x.id } }) + askChanges(x) + cfm : cfm + R.changeProposal({ menu: cpMenu, actions: acts, kind: x.kind, title: x.title, why: x.why || '', rows: x.rows || (x.graph ? STEPS.map(([k, v]) => ({ name: k, before: '', after: v })) : []), body: graph + choice + project + diff, state: x.state, apply: x.apply || 'Apply', hooks: { apply: { 'data-cp-apply': x.id }, decline: { 'data-cp-decline': x.id }, revert: { 'data-cp-revert': x.id } }, attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'think') return R.thinkingRow({ done: true, secs: (x.text.match(/\d+s/) || ['a moment'])[0], steps: x.steps || THOUGHT, open: opened.has(i), attrs: fold() });
    if (x.t === 'cmds') return R.turnRow({ mark: R.icon(opened.has(i) ? 'chevron' : 'chevR', 14), text: esc(x.text), end: x.end, body: esc(x.body), open: opened.has(i), attrs: fold() });
    if (x.t === 'fail') return R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'fail', size: 16 }), text: `<b>${esc(x.cmd)}</b> failed`, end: x.end, body: esc(x.body), open: !opened.has(`shut${i}`), attrs: fold() });
    if (x.t === 'craft') { if (!x.timer) x.timer = setTimeout(() => { const l = turns(), k = l.indexOf(x); if (k >= 0) { l.splice(k, 1, x.then); paint(); } }, 2600); return `<div data-anchor="${x.id}" class="craft-turn">${R.crafting({ kind: x.kind, label: x.label, detail: x.detail })}</div>`; }   // what Worca is making stands where it will be, then becomes it
    if (x.t === 'working') { const now = thinkNow(x); return R.thinkingRow({ step: now.step, secs: now.secs, phase: now.phase, attrs: { 'data-think-at': String(x.at || Date.now()) } }); }
    if (x.t === 'files') return R.turnRow({ mark: R.gitMark({ status: 'open' }), text: `<b>${esc(x.text)}</b> ${esc(x.meta)}`, end: R.button({ label: 'View', kind: 'quiet', attrs: { 'data-say': `Would open the changes: ${x.text}, ${x.meta}` } }) });
    if (x.t === 'code') return `<div class="convo-code"><p>${esc(x.file)}</p><pre>${esc(x.text)}</pre></div>`;
    const t = taskOf(x.task); if (!t && x.t !== 'question' && x.t !== 'form') return '';
    if (x.t === 'schedule') return openCard(x, t);
    if (x.t === 'form') {
      if (x.answered) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.text)}</b> ${esc(x.answered)}` });
      const field = x.kind === 'slider' ? R.sliderPick({ id: `sl-${x.id}`, label: x.text, min: x.min, max: x.max, value: x.value, pick: x.pick, words: (n) => `${n} ${n === 1 ? x.unit.replace(/s$/, '') : x.unit}`, attrs: { 'data-form-slide': String(i) } })
        : x.kind === 'rank' ? R.rankList({ label: x.text, items: x.items, move: (id, d) => ({ 'data-form-rank': `${i}|${id}|${d}` }) })
        : R.pickRows({ cols: x.cols, rows: x.rows, tick: (id) => ({ 'data-form-tick': `${i}|${id}` }) });
      const n = x.kind === 'rows' ? x.rows.filter((r) => r.checked).length : 0;
      return `<div data-anchor="${x.id}">${R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: `<b>${esc(x.text)}</b>` })}${field}<div class="convo-answer-go" style="margin:10px 0 0 32px">${R.button({ label: x.kind === 'rows' ? `Make ${n} ${n === 1 ? 'task' : 'tasks'}` : 'Answer', kind: 'primary', attrs: { 'data-form-go': String(i), disabled: x.kind === 'rows' && !n ? true : null, title: x.kind === 'rows' && !n ? 'Tick at least one first' : null } })}${x.kind === 'rows' ? R.button({ label: 'Not now', kind: 'quiet', attrs: { 'data-form-skip': String(i) } }) : R.button({ label: x.kind === 'slider' ? 'Use Worca’s pick' : 'Use Worca’s order', kind: 'quiet', attrs: { 'data-form-pick': String(i) } })}</div></div>`;
    }
    if (x.t === 'question') {
      if (x.answered) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.text)}</b> ${esc(x.answered)}` });
      return `<div data-anchor="${x.id}">${R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', stage: -1, size: 16 }), text: `<b>${esc(x.text)}</b>` })}<div class="convo-answer">${R.optionList({ label: x.text, options: x.options, selected: x.pick, recommended: x.rec ?? x.pick ?? 0, optAttrs: (n) => ({ 'data-answer': `${i}|${n}` }), own: `${R.field({ id: `own-${x.id}`, label: 'Your own answer', quietLabel: true, placeholder: 'Or write your own answer', attrs: { 'data-own': String(i) } })}<div class="convo-answer-go">${R.button({ label: 'Answer', attrs: { 'data-answer-go': String(i) } })}${x.many ? R.button({ label: 'Use Worca’s picks', kind: 'quiet', attrs: { 'data-answer-picks': String(i), title: 'Takes Worca’s pick for this and the next question' } }) : ''}</div>` })}</div></div>`;
    }
    // "Asks you below" only when a question waits below it in this chat; else the decision is on the card itself (a gate's Accept as is)
    const st = stOf(t), tone = R.markTone(st), at = turns().indexOf(x), below = tone === 'ask' && turns().some((y, j) => j > at && ((y.t === 'question' && !y.answered) || (y.t === 'plan' && !y.approved)));   // a question or a plan waiting under it speaks for it
    const word = below ? 'Asks you below' : st.word;
    if (tone === 'wait' && !x.open) return openCard(x, t);   // one line until opened in place
    // Its one action and ⋯ are its state's own, as on its page; a question is answered under the card.
    // a live task with no step of its own to offer can always be paused or stopped from its card, as on dev's chat card
    const live = tone === 'run' && !st.action;
    const fixFirst = tone === 'fail' && !t.fixing;   // a failure leads with Worca fixing it (Emil, 8 Nov): it picks where and how, tries 3 times, then asks
    const main = below || t.confirm ? '' : fixFirst ? R.button({ label: 'Ask Worca to fix it', kind: 'primary', attrs: { 'data-card-act': `${t.id}|Ask Worca to fix it`, title: 'Worca reads what broke, picks where to start again and how, and tries up to 3 times before it asks you' } }) : st.action ?   /* while a confirm asks, its row holds the one button */ R.button({ label: st.action.label, kind: (st.action.primary || taskWaits(x)) && !t.confirm && !t.form ? 'primary' : '', attrs: { 'data-card-act': `${t.id}|${st.action.label}` } })
      : live ? R.button({ label: 'Pause', attrs: { 'data-card-act': `${t.id}|Pause`, title: 'Stops at once; Resume starts the current step again' } }) : '';
    // the card's ⋯: its state's own steps, then what any task can do, named as on its page (one ⋯, the same words)
    const done = ['ok', 'merged', 'stop', 'closed', 'idle'].includes(tone);
    const more = cardMore(t, [...(tone === 'fail' ? [...(st.action ? [{ id: st.action.label, text: st.action.label, help: 'Runs it again as it is, without a fix' }] : []), { id: 'Tell Worca how to fix it', text: 'Tell Worca how to fix it', help: 'A follow-up on its branch, with what failed already written' }, { id: 'Show the log', text: 'Show the log', help: R.shows('expert') ? 'Opens its page at What broke, with the log' : 'Opens its stages here, with the log' }] : []), ...(st.action?.items || []).filter((w) => typeof w === 'string'), ...(live ? [{ id: 'Stop', text: 'Stop', danger: true, help: 'Asks first; the branch and changes stay' }] : []), { sep: true },
      ...(done ? [{ id: 'Start a follow-up', text: 'Start a follow-up', help: 'A new task on this one’s branch, with what you ask' }] : []), { id: 'Run after…', text: 'Run after…', help: 'Another task starts when this one finishes' },
      { id: 'Label…', text: 'Label…', help: 'Adds a label to this task' }, { id: 'Move to group…', text: 'Move to group…', help: 'Tracks it with related tasks' }, { id: 'Save as preset', text: 'Save as preset', help: 'Starts the next task with this one’s setup' },
      ...(done ? [{ id: 'Report this task', text: 'Report this task', help: 'Asks for a note, then sends it with the logs to the Worca team' }, { id: 'Archive', text: 'Archive', help: 'Removes the branch, worktree and logs; the remote branch and PR stay' }] : []),
      ...(R.shows('expert') ? [{ sep: true }, { id: 'open', text: 'Open its page', help: 'The task page, while the card does not hold everything yet' }] : [])]);
    const confirm = t.confirm ? R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: `<b>${esc(t.confirm.label)}?</b> ${esc(t.confirm.text)}`, end: R.button({ label: t.confirm.label, kind: /discard|delete|stop|remove/i.test(t.confirm.label) ? 'quiet' : 'primary', cls: /discard|delete|stop|remove/i.test(t.confirm.label) ? 'is-danger' : '', attrs: { 'data-card-yes': t.id } }) + R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-card-no': t.id } }) }) : '';
    const toPage = R.shows('expert');   // rail.stay-in-chat: only Expert leaves the chat; else each fact opens its own part here
    const facts = t.facts && !x.open ? R.factsLine([{ n: t.facts.cost, word: 'so far', ...(toPage ? { attrs: { 'data-fact': `cost|${t.id}`, title: 'Opens Insights › Spend, for this task' } } : {}) }, { n: t.facts.time, word: '' }, { n: String(t.facts.agents), word: t.facts.agents === 1 ? 'agent' : 'agents', attrs: { 'data-open-task': t.id, title: 'Shows its stages and who works on them' } }, { n: String(t.facts.files), word: t.facts.files === 1 ? 'file' : 'files', attrs: toPage ? { 'data-fact': `page|${t.id}`, title: 'Opens its changes' } : { 'data-fact-files': x.id, 'aria-expanded': String(!!x.filesOpen), title: x.filesOpen ? 'Folds the list' : 'Lists the files it changed' } }, ...(t.facts.artifacts ? [{ n: String(t.facts.artifacts), word: t.facts.artifacts === 1 ? 'artifact' : 'artifacts', attrs: toPage ? { 'data-fact': `page|${t.id}`, title: 'Opens its artifacts' } : { 'data-fact-arts': t.id, title: 'Opens its artifacts under the stage that made them' } }] : [])]) : '';
    const changed = facts && x.filesOpen && !toPage && t.depth?.changed ? R.list({ groups: [{ title: `Changed · ${t.depth.changed.length} files`, rows: t.depth.changed.map(([f, n]) => R.listRow({ title: f, meta: n, mark: R.kindMark({ kind: 'plugin', icon: 'file' }), open: { 'data-say': `Would open ${f}: its lines, added and removed` } })) }] }) : '';
    const why = t.why && ['fail', 'ask', 'act', 'ok'].includes(tone) ? t.why.map((w) => R.turnRow({ mark: '', text: `<span class="cmd-s">${esc(w)}</span>` })).join('') : '';   // why it failed, on the card: the failing tests by name
    return R.taskCard({ rows: x.open ? '' : why + facts + changed, title: t.title, place: `<span class="rc-mid"><span class="rc-mid-a">${esc(t.branch || '')}</span></span><span>into dev</span>${gitOf(t)}${t.watch && t.git !== 'merged' ? '<span class="rc-watch" title="Worca watches the PR: new comments and failing checks come back here">· Worca watches its PR</span>' : ''}${(t.labels || []).map((l) => R.chip({ text: l })).join('')}`, mark: taskMark(t), word, detail: below ? '' : t.detail || '', /* rail.one-place: the question below says what it asks */ action: main, menu: more, stages: R.stageBar({ labels: STAGES, stage: t.stage, tone, step: t.step || R.stageStep(t.detail) }), foot: R.button({ label: x.open ? 'Hide its stages' : 'Show its stages', kind: 'quiet', icon: R.icon(x.open ? 'chevron' : 'chevR', 12), attrs: { 'data-open-task': t.id, 'aria-expanded': String(!!x.open), title: x.open ? 'Folds its stages' : 'Opens its stages here, as its page has them' } }), open: !!x.open, stream: own(t), attrs: { 'data-anchor': x.id } }) + confirm + formHtml(t) + askChanges(x);
  }

  // ---- the timeline: what is worth finding, where it really is ----
  function ticks() {
    const box = root.querySelector('.convo-scroll'); if (!box) return [];
    const H = box.scrollHeight || 1, list = turns();
    return [...root.querySelectorAll('[data-anchor]')].filter((e) => e.dataset.anchor).map((e) => {
      const x = list.find((y) => y.id === e.dataset.anchor), t = x?.task ? taskOf(x.task) : null;
      const kind = x?.t === 'you' ? 'you' : 'work';
      const tone = x?.t === 'question' ? 'ask' : x?.t === 'fail' ? 'fail' : t && t.kind !== 'schedule' ? R.markTone(stOf(t)) : '';
      const words = (s) => String(s || '').replace(/<[^>]+>/g, '');   // every tick names its turn: an act's text is markup
      const title = x?.t === 'you' ? x.text : x?.t === 'question' ? x.text : x?.t === 'fail' ? x.cmd : t?.title || x?.title || words(x?.text) || (x?.t === 'commands' ? x.rows[0]?.summary : '') || '';
      const line = x?.t === 'you' ? `You · ${x.when || ''}` : x?.t === 'question' ? `Waiting for you · ${x.when || ''}` : x?.t === 'fail' ? `Failed · ${x.when || ''}` : t?.detail || (x?.t === 'commands' ? `${x.rows.length} commands` : x?.kind || (x?.t === 'plan' ? 'Plan' : x?.t === 'feature' ? 'Feature' : x?.t === 'ship' ? 'Ship' : x?.t === 'proposal' ? 'Proposed' : ''));
      const mark = x?.t === 'you' ? R.icon('you', 16) : x?.t === 'question' ? R.kindMark({ kind: 'chat', tone: 'ask', stage: -1, size: 18 }) : x?.t === 'fail' ? R.kindMark({ kind: 'chat', tone: 'fail', stage: -1, size: 18 }) : t ? taskMark(t, 18) : '';
      const top = e.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      return { id: e.dataset.anchor, at: Math.min(0.98, top / H), kind, tone, title, line, mark };
    });
  }
  function paintTimeline() {
    const host = root.querySelector('[data-timeline]'), box = root.querySelector('.convo-scroll'); if (!host || !box) return;
    const list = ticks(), H = box.scrollHeight || 1;
    const on = list.find((t) => t.id === hover);
    host.innerHTML = list.length > 1 ? R.timeline({ ticks: list, view: [box.scrollTop / H, Math.min(1, box.clientHeight / H)], label: 'Move through this chat' }) + (on ? `<div class="tl-hover">${R.timelineCard({ mark: on.mark, title: on.title, line: on.line, at: on.at })}</div>` : '') : '';
    const pick = root.querySelector('[data-anchor-menu]');
    if (pick) pick.hidden = list.length < 2;
  }
  function goTo(id) { hover = null; menu = ''; paint(); const el = root.querySelector(`[data-anchor="${CSS.escape(id)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); R.land?.(el); } paintTimeline(); }   // the picked menu closes, then the turn is found in the redrawn page

  // ---- the page ----
  function paint(keepText = true) {
    window.RailShell?.unembedRun?.(root);   // the task page lent to an open card goes home before the chat redraws
    paintOnly(keepText);
    attention();   // what waits on you breathes after every redraw, until you have seen it
    const slot = root.querySelector('[data-run-slot]');
    if (slot) window.RailShell?.embedRun?.(slot, slot.dataset.runSlot, slot.dataset.runAsk);   // and comes back into the card that is open
  }
  function sideHome() {
    const ctx = window.RailShell?.pageContext?.() || { name: 'this page', kind: 'page', suggest: [] }, chip = !sideNoPage && ctx.kind !== 'page';
    const recent = [...data().chats].filter((c) => !c.archived).slice(0, 3).map((c) => R.listRow({ title: c.title, meta: [c.project || 'No project', c.tasks?.length ? `${c.tasks.length} ${c.tasks.length === 1 ? 'task' : 'tasks'}` : '', c.cost ? `$${c.cost.toFixed(2)}` : ''].filter(Boolean).join(' · '), mark: R.kindMark({ kind: 'chat', tone: c.state === 'needs-you' ? 'ask' : 'idle' }), open: { 'data-side-chat': c.id, title: `Opens ${c.title} here` } }));
    return `<div class="side-home"><h2 class="side-home-h">${esc(ctx.kind === 'page' ? 'Ask Worca' : `Ask about ${ctx.kind === 'task' ? 'this task' : ctx.name}`)}</h2>${ctx.kind === 'page' ? '' : `<p class="side-home-m">Worca sees ${esc(ctx.kind === 'project' ? 'its branch, its tasks and its settings' : ctx.kind === 'task' ? 'its stages, its log and its changes' : `this ${ctx.kind}`)}.</p>`}
      <div class="side-home-sug">${ctx.suggest.map((q) => R.button({ label: q, kind: 'quiet', attrs: { 'data-side-sug': q, title: 'Puts it in the box; nothing is sent' } })).join('')}</div>
      ${R.list({ groups: [{ title: 'Recent chats', rows: recent }] })}</div>
      <div class="side-home-dock">${chip ? `<div class="side-home-chips">${R.chip({ text: `${ctx.kind.charAt(0).toUpperCase() + ctx.kind.slice(1)} · ${ctx.name}`, title: 'Worca reads this page with your question' })}${R.button({ label: `Leave ${ctx.name} out`, kind: 'quiet', iconOnly: true, icon: R.icon('x', 12), attrs: { 'data-side-nopage': '' } })}</div>` : ''}${composerHtml()}</div>`;
  }
  function paintOnly(keepText = true) {
    const had = root.querySelector('[data-composer-t]'), caret = had && document.activeElement === had, y = root.querySelector('.convo-scroll')?.scrollTop;
    if (had && keepText) comp.text = had.value;
    const c = chat();
    if (!chatId || !c) {
      root.innerHTML = side ? sideHome() : `<div class="chat-home" data-home><div class="chat-home-in"><h1>${esc(opts.title || 'What\'s next?')}</h1>${composerHtml()}${opts.mode ? '' : startersHtml() + newHere()}</div></div>`;
    } else {
      const labels = (c.labels || []).map((l) => R.chip({ text: l })).join('');
      root.innerHTML = `<div class="convo"><div class="convo-scroll"><div class="convo-col"><div class="convo-head">${esc(c.project || 'No project')}${labels ? ` · ${labels}` : ''}${R.sentencePicker({ id: 'cl-label', text: '+ Label', tip: 'Adds or removes a label', body: R.listEditor({ label: 'Labels', inputId: 'cl-label-q', placeholder: 'Find or make a label', sections: [{ title: 'Labels', kind: 'label', many: true, rows: LABELS.filter((l) => l.includes(labelQ.toLowerCase())).map((l) => ({ text: l, n: '', on: (c.labels || []).includes(l) })) }], hint: labelQ.length >= LABEL_MAX ? `A label holds ${LABEL_MAX} characters at most` : labelQ && !LABELS.includes(labelQ.toLowerCase()) ? `Enter makes “${labelQ.toLowerCase()}”` : '' }), open: menu === 'cl-label', chevron: '' })}<span class="tl-list-btn rc-pop" data-anchor-menu>${R.button({ label: 'Move through this chat', kind: 'quiet', iconOnly: true, icon: R.icon('list', 15), attrs: { 'data-anchor-open': '', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'anchors') } })}</span></div>${calmCards(turns())}</div></div><div data-timeline></div><div class="convo-dock">${R.button({ label: 'Latest', kind: 'quiet', icon: R.icon('chevron', 12), cls: 'jump-latest', attrs: { 'data-jump-latest': '', title: 'Back to the newest turn' } })}${composerHtml()}</div></div>`;
      const box = root.querySelector('.convo-scroll');
      if (y != null) box.scrollTop = y;
      if (menu === 'anchors') root.querySelector('[data-anchor-menu]').insertAdjacentHTML('beforeend', R.compactMenu({ items: ticks().map((t) => ({ id: `tick|${t.id}`, text: t.title, hint: t.line })) }));
      box.addEventListener('scroll', paintTimeline, { passive: true });
      paintTimeline();
    }
    const t = root.querySelector('[data-composer-t]');
    if (t && caret) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
    size(t);
  }
  const size = (t) => { if (t) { t.style.height = 'auto'; t.style.height = `${Math.max(t.scrollHeight, t.closest('.is-plain') ? 0 : 44)}px`; } };

  // ---- starting things ----
  function ensureChat(title) {
    if (chatId && chat()) return chat();
    const id = window.RailChats.newChat(title, comp.project === 'No project' ? '' : comp.project);
    chatId = id; threads.set(id, []);
    return chat();
  }
  // Each starter's flow, as dev has it, in Rail's cards (plans/rail/chat-cards.md › Parity)
  function flowFor(intent, text, n) {
    const title = clip(text.replace(/[?.!]+$/, '')) || 'A new task';
    const proposal = (o) => ({ t: 'proposal', id: `p${n}`, title: title.charAt(0).toUpperCase() + title.slice(1), why: whyOf(text), project: comp.project, workflow: 'Default', engine: comp.engine, then: 'open a PR', open: false, nudge: false, ...o });
    if (intent === 'task') return [{ t: 'words', html: 'Here is the task. Check it, then start it:' }, proposal({ nudge: /\b(or|which|should|whether)\b|\?/i.test(text) })];
    if (intent.startsWith('pin:')) return [{ t: 'words', html: `A ${esc(intent.slice(4))} task. Check it, then start it:` }, proposal({ workflow: intent.slice(4), persp: ['Product', 'Security'] })];
    if (intent === 'schedule') return [{ t: 'words', html: 'Here is the schedule. Check when it runs, then schedule it:' }, proposal({ when: whenOf(text), title: (() => { const t = text.replace(/[?.!]+$/, '').replace(/\s+(?:every|each|daily|nightly|weekly|hourly|tonight|tomorrow|once|on weekdays|at \d)\b.*$/i, '').trim() || title; return clip(t.charAt(0).toUpperCase() + t.slice(1)); })() })];   /* its name is the what; the when is its own field */   // a schedule repeats unless you say once, at the time you said
    if (intent === 'workflow') return [{ t: 'think', text: 'Thought for 9s' }, { t: 'craft', id: `cr${n}`, kind: 'workflow', label: 'Making the workflow', detail: 'from what you said in this chat', then: { t: 'change', id: `w${n}`, kind: 'Workflow', title: title || 'New workflow', why: 'Proposed workflow · round 1: plan, build behind review, then a PR. Model and effort come from your defaults.', graph: true, apply: 'Save', state: 'proposed' } }];
    if (intent === 'explain') return [{ t: 'words', html: `What changed in <b>${esc(text || 'Add CSV export')}</b>: the export now streams rows, and the date column is ISO 8601. Five files, +358 −144:` }, { t: 'filesgrid', label: 'The diff', files: [{ name: 'export.mjs', meta: '+182 −64' }, { name: 'columns.mjs', meta: '+41 −58' }, { name: 'export.test.mjs', meta: '+96 −0' }] }];
    if (intent === 'script') return [{ t: 'change', id: `s${n}`, kind: 'Script', title: title || 'New script', why: 'A new script, tested before it is saved.', rows: [{ name: 'Runtime', before: '', after: 'Shell' }, { name: 'Inputs', before: '', after: 'a branch name' }, { name: 'Outputs', before: '', after: 'release notes, Markdown' }, { name: 'Program', before: '', after: '3 test cases' }], apply: 'Save', state: 'proposed' }, { t: 'act', id: `sa${n}`, mark: 'ask', text: `<b>Run ${esc((title || 'the script').toLowerCase().replace(/[^a-z0-9]+/g, '-'))}.sh?</b> It runs on this machine with your access and no sandbox, in the checkout of worca-cc, for up to 120 s`, actions: [['Run', 'primary', 'Done, exit 0'], ['Don’t run', 'quiet', 'Not run']] }];
    if (intent === 'project') return [{ t: 'change', id: `j${n}`, kind: 'Project', title: 'Add a project', why: 'Worca works in a project: a folder, a clone, or a new one', how: /^(https?:|git@)/.test(text) ? 'Clone' : 'Folder', f: /^(https?:|git@)/.test(text) ? { url: text } : text ? { path: text } : {}, state: 'proposed' }];
    if (intent === 'away') return [{ t: 'change', id: `a${n}`, kind: 'Away mode', title: 'Away mode on', rows: [{ name: 'Away mode', before: 'Off', after: 'On now' }], state: 'applied' }];
    if (intent === 'metrics') return [{ t: 'words', html: 'Last 7 days: 42 tasks, 31 merged, 4 failed; $412 spent, most on Review. Billing-api is busiest.' }];
    if (intent === 'model') return [{ t: 'change', id: `m${n}`, kind: 'Model', title: 'Add a model', why: text || 'A model for Review', rows: [{ name: 'Provider', before: '', after: 'Anthropic' }, { name: 'Model', before: '', after: 'Sonnet 5.5' }, { name: 'Used for', before: '', after: 'Review' }], apply: 'Add', state: 'proposed' }];
    if (intent === 'workspace') {   // what you typed: its projects are only the ones you have; a name you gave, or theirs
      const mine = (window.RailProjects?.list() || []).map((p) => p.id), said = text.toLowerCase(), holds = mine.filter((id) => new RegExp(`(^|[^a-z0-9-])${id.replace(/[-.]/g, '\\$&')}($|[^a-z0-9-])`).test(said));
      if (!holds.length) return [{ t: 'words', html: `None of that names a project you have. Your projects: <b>${mine.map(esc).join('</b>, <b>')}</b>. Say which belong together.` }];
      const named = text.match(/\b(?:called|named|call it|as)\s+["“]?([^"”,.]+)/i)?.[1] || (/[:]/.test(text) ? text.split(':')[0] : ''), name = clip((named.trim() || holds.join(' and ')), 40), others = [...new Set(said.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) || [])].filter((w) => !mine.includes(w));
      return [{ t: 'change', id: `k${n}`, kind: 'Workspace', name, holds, title: `Create ${name}`, why: text, rows: [{ name: 'Workspace', before: '', after: name }, { name: 'Projects', before: '', after: holds.join(', ') }, ...(others.length ? [{ name: 'Left out', before: '', after: `${others.join(', ')}: not your projects` }] : [])], apply: 'Create', state: 'proposed' }];
    }
    if (intent === 'remember') return [{ t: 'notice', text: `Remembered: ${text || 'that'}` }, { t: 'words', html: 'I’ll keep it in this project’s memory.' }];
    if (intent === 'find') return [{ t: 'words', html: 'Three tickets in Jira match; the first fits best:' }, proposal({ title: 'Export totals are off by a cent', ticket: 'BILL-412' })];
    return null;
  }
  // An ask that sounds like work brings a proposed task, in the composer's own words; one with open decisions offers the Shaper.
  function replyFor(text, n, intent = '') {
    const flow = intent && flowFor(intent, text, n); if (flow) return flow;
    // a change asked while a feature is being built here: Worca asks where it goes (dev's route card), with its guess
    const feat = turns().find((y) => y.t === 'feature' && !y.split && !y.halted);
    if (feat && /\b(add|change|also|fix|make|instead|rather)\b/i.test(text)) return [{ t: 'change', id: `rt${n}`, kind: 'Route', title: `Where does “${clip(text, 48)}” go?`, why: `${feat.title} is being built here; your change can join it or stand on its own`,
      choice: { label: 'Put it', items: ['into the next slice’s plan', 'as an extra slice', 'as a task of its own'], rec: 'into the next slice’s plan' }, actions: [['Route it', 'primary', 'Routed'], ['Not now', 'quiet', 'Kept for later']], state: 'proposed' }];
    // in a chat that has a task, "change it" is a follow-up on that task (its branch, its PR), never an unrelated new one
    const last = [...(chat()?.tasks || [])].reverse().find((t) => t.kind !== 'schedule');
    if (last && /\b(change it|change that|also|follow[- ]up|ask for changes|add .* to it|on top of)\b/i.test(text)) return [{ t: 'words', html: `A follow-up on <b>${esc(last.title)}</b>, on its branch. Check it, then start it:` },
      { t: 'proposal', id: `p${n}`, title: clip(`${last.title}: ${text.replace(/^change it:?\s*/i, '')}`), why: `On top of ${last.title}${last.branch ? `, on ${last.branch}` : ''}`, project: chat()?.project || comp.project, workflow: 'Lean', engine: comp.engine, then: ['open', 'pass', 'fail', 'conflict'].includes(last.git) ? 'update its PR' : 'open a PR', feature: last.branch || '', open: false, nudge: false }];
    if (!/\b(add|fix|build|make|implement|create|change|update|remove|rename|migrate)\b/i.test(text)) return [{ t: 'words', html: `Worca answers here from <b>${esc(comp.project || 'the project')}</b>'s code, naming the files it read. Ask for a change and it proposes a task.` }];   // a question gets an answer, never a build offer
    const core = text.replace(/^(can you|could you|please|let's)\s+/i, '').split(/,?\s+(?:or|and should|should it)\b|[?.!]/i)[0].trim();
    const title = nameOf(core);   // a whole clause, never cut mid-phrase
    return [{ t: 'words', html: 'I can do this as a task. Check it, then start it:' },
      { t: 'proposal', id: `p${n}`, title: title.charAt(0).toUpperCase() + title.slice(1), why: `From this chat: ${text.length > 70 ? `${text.slice(0, 70)}…` : text}`, brief: text, project: comp.project, workflow: 'Default', engine: comp.engine, then: 'open a PR', open: false, nudge: /\b(or|which|should|whether)\b|\?/i.test(text) }];
  }
  const saidName = (text) => { const t = text.replace(/[?.!]+$/, '').replace(/\s+(?:every|each|daily|nightly|weekly|hourly|tonight|tomorrow|once|on weekdays|at \d)\b.*$/i, '').trim() || text; return clip(t.charAt(0).toUpperCase() + t.slice(1)); };   // a schedule's name is the what; the when is its own field
  function send() {
    const had = root.querySelector('[data-composer-t]'); const text = (had?.value || comp.text).trim();
    if (comp.busy && text) { comp.queue = [...(comp.queue || []), text]; comp.text = ''; if (had) had.value = ''; paint(false); say('Queued: it goes when this reply is done'); return; }   // while Worca replies, sending queues
    if (!text) { had?.focus(); say(comp.mode === 'ask' ? 'Write something first' : 'Say what it should do first'); return; }
    const c = ensureChat(comp.mode === 'schedule' ? saidName(text) : text);
    if (!threads.has(c.id)) threads.set(c.id, M.thread(c));
    const list = threads.get(c.id), n = Date.now().toString(36);
    const intent = comp.intent || '';
    const handed = aboutNow(); list.push({ t: 'you', id: `y${n}`, text, when: 'now', refs: comp.refs || [], files: handed ? [`${handed.kind} · ${handed.name}`] : [] }); comp.about = null;
    if (comp.mode === 'task') {   // one way to start a task: the proposal, checked, then Start
      list.push({ t: 'words', html: 'Here it is. Check it, then start it:' }, { t: 'proposal', id: `p${n}`, title: comp.title || clip(text.charAt(0).toUpperCase() + text.slice(1)), feature: comp.branch || undefined, labels: comp.labels, asks: comp.asks, memory: comp.memory, guard: comp.guard, why: whyOf(text), project: comp.project, workflow: comp.workflow, engine: comp.engine, effort: comp.effort, then: comp.then, when: comp.startAt ? `at ${comp.startAt}` : 'now', preset: comp.preset, files: comp.files, open: false, nudge: false });
    } else if (false) {
      const t = { id: `t${n}`, title: clip(text), ask: text, case: 'starting', stage: 0, git: 'branch', branch: `feat/${slug(text)}`, detail: `Plan · ${comp.workflow} on ${comp.engine}` };
      if (comp.startAt) { t.case = 'scheduled'; t.detail = `Starts at ${comp.startAt}`; t.git = ''; }
      c.tasks = [...(c.tasks || []), t]; c.state = 'following'; put(c, t); settleStart(c, t);
      list.push({ t: 'words', html: `I'll start a task on <b>${esc(comp.project)}</b>: ${esc(comp.workflow)} on ${esc(comp.engine)}, then ${esc(comp.then)}.` }, { t: 'task', id: `k${n}`, task: t.id });
      say(comp.startAt ? `Starts at ${comp.startAt}` : 'Task started');
    } else if (comp.mode === 'schedule') {
      const said = saidWhen(text), every = said.every || comp.every, at = said.at || comp.at, words = R.scheduleWords({ every, at });   // what you wrote wins; the card and the notice say the same
      const s = { id: `s${n}`, kind: 'schedule', title: saidName(text), detail: `Runs ${words.runs}`, time: at };
      c.tasks = [...(c.tasks || []), s];
      window.RailSchedules?.add({ id: s.id, title: s.title, project: comp.project, chat: c.id, every, at, next: words.next, day: 'tomorrow', state: 'scheduled', time: at, section: 'next', labels: [], runs: [] });   // in Schedules too
      list.push({ t: 'schedule', id: `k${n}`, task: s.id });
      say(`Scheduled ${words.runs}`);
    } else {
      const w = { t: 'working', at: Date.now(), steps: THINKING }; list.push(w); comp.busy = true; c.state = 'replying';
      root.dispatchEvent(new CustomEvent('rail:replying', { bubbles: true, detail: { busy: true } }));   // Ask worca's icon writes while it does
      clearTimeout(timer);
      timer = setTimeout(() => { const i = list.indexOf(w); /* this message's own reply, under it: never another working row above */ if (i >= 0) list.splice(i, 1, { t: 'think', text: `Thought for ${thinkNow(list[i]).secs}`, steps: THOUGHT.slice(0, thinkNow(list[i]).n) }, ...replyFor(text, n, intent)); comp.busy = false; c.state = 'idle'; root.dispatchEvent(new CustomEvent('rail:replying', { bubbles: true, detail: { busy: false } })); if ((comp.queue || []).length) { const next = comp.queue.shift(); setTimeout(() => { comp.text = next; send(); }, 300); } window.RailChats.refresh(); paint(); if (c.id === chatId) { const bx = root.querySelector('.convo-scroll'); if (bx) bx.scrollTop = bx.scrollHeight; } /* the reply to what you sent is in view, its Start too */ }, 1400);
    }
    comp = { ...comp, text: '', startAt: '', more: false, files: [], intent: '', refs: [], mode: opts.mode || 'ask' };
    root.querySelectorAll('[data-composer-t]').forEach((t) => { t.value = ''; });   // a schedule's add redraws: the box is not the one read above
    window.RailChats.refresh();
    if (opts.where && !side) { chatId = ''; comp = fresh(opts.mode); window.RailShell.go(`chat/${c.id}`); return; }
    if (!side && location.hash !== `#chat/${c.id}`) { window.RailShell.go(`chat/${c.id}`); return; }
    paint(false);
    const box = root.querySelector('.convo-scroll'); if (box) box.scrollTop = box.scrollHeight;
    paintTimeline();
  }

  // ---- what a click or a key means here ----
  // the ⋯ of a plan, a split, a feature and a split's task: each changes its card, or hands to the box; true when it drew
  function cardMenu(kind, x, n, v) {
    const keep = () => { x.was = x.was || JSON.stringify(x.slices); };   // Undo edits goes back to what Worca proposed
    const aside = (word) => { const was = x.t; x.t = 'notice'; x.text = `${word}: ${x.title}. Nothing was built`; paint(); say(`${word}: ${x.title}`, { tip: 'Brings it back', run: () => { x.t = was; paint(); } }); return true; };
    if (kind === 'slice') { keep(); if (v === 'Remove') x.slices.splice(n, 1); if (v === 'Merge with next' && x.slices[n + 1]) { x.slices[n].title += ` + ${x.slices[n + 1].title}`; x.slices.splice(n + 1, 1); } return false; }
    if (/before each/.test(v)) { x.askEach = !x.askEach; paint(); say(x.askEach ? 'Asks you before each task' : 'Goes on without asking'); return true; }
    if (v === 'Plan it as one') { keep(); x.slices = [{ title: x.title, detail: 'one task', case: 'scheduled', stage: -1 }]; return false; }
    if (v === 'Undo edits' && x.was) { x.slices = JSON.parse(x.was); x.was = ''; return false; }
    if (v === 'Stop') return aside('Stopped');
    if (v === 'Re-plan the rest') { handHere('Feature', x.title, 'How should the rest change?'); return true; }
    if (v === 'Cancel the rest') { const rest = x.slices.filter((s) => s.case === 'scheduled' && !s.off), was = rest.map((s) => s.detail); rest.forEach((s) => { s.off = true; s.detail = 'Cancelled'; }); paint(); say(`Cancelled ${rest.length} ${rest.length === 1 ? 'task' : 'tasks'}`, { tip: 'Puts them back', run: () => { rest.forEach((s, k) => { s.off = false; s.detail = was[k]; }); paint(); } }); return true; }
    if (v === 'Fix all') { const open = x.roles.filter((r) => !r.ok); open.forEach((r) => { r.ok = true; r.note = `Answered in v${x.versions + 1}: ${r.note}`; }); x.versions += 1; x.v = x.versions; paint(); say(`Plan v${x.v}: ${open.length} ${open.length === 1 ? 'objection' : 'objections'} answered`); return true; }
    if (v === 'Update for other perspectives') { const who = PERSPECTIVES.find((p) => !x.roles.some((r) => r.name === p)); if (!who) return false; x.roles.push({ name: who, ok: true, note: 'Read this version; nothing to add' }); x.versions += 1; x.v = x.versions; paint(); say(`Plan v${x.v}: ${who} reviewed it too`); return true; }
    if (v === 'Save to plans/') { x.savedAs = `plans/${slug(x.title, 60)}.md`; paint(); say(`Would save it as ${x.savedAs}`); return true; }
    if (v === 'Open in the composer') { handHere('Plan', x.title, 'What should change in the plan?', x.summary); return true; }
    return false;
  }
  function pickMenu(id, v) {
    if (id.startsWith('chg:')) { menu = ''; const x = turns().find((y) => y.id === id.slice(4)); if (x && v === 'Not now') x.done = 'Not now'; if (x && /^Delete/.test(v)) x.confirmDelete = v; if (x && v === 'Ask about it') { handHere(x.kind, x.title, `What do you want to know about ${x.title}?`); return; } if (x && v === 'Try again') { handHere(x.kind, x.title, 'What should be different this time?'); return; } paint(); return; }
    if (/^(plan|split|feat|slice):/.test(id)) { menu = ''; const [kind, tid, n] = id.split(':'), x = turns().find((y) => y.id === tid); if (x && !cardMenu(kind, x, +n, v)) paint(); return; }
    if (id.startsWith('ppalt-')) { const x = turns().find((y) => y.id === id.slice(6)); menu = ''; if (x && v === 'shape') { x.workflow = 'Shaper'; say('Shaper will ask first'); } if (x && v === 'asis') { x.nudge = false; say('Runs as is'); } paint(); return; }
    if (id.startsWith('shiphow-')) { const x = turns().find((y) => y.id === id.slice(8)); if (x) x.how = v; menu = ''; paint(); return; }
    if (id.startsWith('pj-')) { const x = turns().find((y) => y.id === id.slice(3)); if (x) x.how = v; menu = ''; paint(); return; }
    if (id.startsWith('pjg-')) { const x = turns().find((y) => y.id === id.slice(4)); if (x) x.git = v; menu = ''; paint(); return; }
    if (id.startsWith('cpch-')) { const x = turns().find((y) => y.id === id.slice(5)); if (x) x.picked = v; menu = ''; paint(); return; }
    const sm = /^ship-(.+)-(\d+)$/.exec(id); if (sm) { const x = turns().find((y) => y.id === sm[1]); if (x) x.reqs[+sm[2]].v = v; menu = ''; paint(); return; }
    if (id === 'cp-mention') { const [cs, title] = v.split('|'); comp.refs = [...(comp.refs || []), { case: cs, title }]; comp.text = comp.text.replace(/@[^@\s]*$/, `@${title} `); menu = ''; paint(false); const t = root.querySelector('[data-composer-t]'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } return; }
    if (id === 'cp-voice') { comp.handsFree = !comp.handsFree; if (!comp.handsFree) comp.listening = false; menu = ''; paint(); say(comp.handsFree ? 'Hands-free on' : 'Hands-free off'); return; }
    if (id === 'starter-more') { const [k, ...rest] = v.split('|'); pickMenu(k, rest.join('|')); return; }   // More's items carry its id first
    if (id === 'starter') { arm(v); return; }
    if (id === 'starter-preset') { comp = { ...comp, intent: '', mode: 'task', preset: v, more: true }; menu = ''; paint(); root.querySelector('[data-composer-t]')?.focus(); say(`Preset ${v}: check it, then start`); return; }
    if (id === 'starter-pin') { pins = [...pins, v]; menu = ''; paint(); say(`Pinned ${v}`); return; }
    if (id === 'starter-unpin') { pins = pins.filter((w) => w !== v); menu = ''; paint(); say(`Unpinned ${v}`); return; }
    if (id === 'starter-track') { menu = ''; const hit = liveTasks().find(({ t }) => t.id === v); if (hit) follow(hit.t, hit.c); return; }
    const pv = /^pv-(.+)$/.exec(id); if (pv) { const x = turns().find((y) => y.id === pv[1]); if (x) x.v = +v; menu = ''; paint(); return; }
    const pm = /^pp-(.+?)-(project|workflow|engine|effort|when|then|target|src|base|guard|labels|memory|asks|pr|watch|rounds|mcp|tz|missed|overlap|fails|ends|(model|eff|sub|fan)(Plan|Build|Review))$/.exec(id);
    const pq = /^pp-(.+)-persp$/.exec(id);
    if (pq) { const x = turns().find((y) => y.id === pq[1]); if (x && v !== 'Product') { const l = x.persp || ['Product']; x.persp = l.includes(v) ? l.filter((w) => w !== v) : [...l, v]; } paint(); return; }   // ticks stay open to pick several
    if (id.startsWith('ppm:')) { menu = ''; const x = turns().find((y) => y.id === id.slice(4)); if (x && v === 'preset') { say(`Saved as a preset: ${x.workflow} on ${x.engine}, ${x.pr || 'ready for review'}`); paint(); return; }
      if (x && v === 'composer') { comp = { ...comp, mode: 'task', text: x.brief ?? x.title, project: x.project, workflow: x.workflow, engine: x.engine, then: x.then, more: true }; paint(); root.querySelector('[data-composer-t]')?.focus(); say('In the composer: change anything, then start it'); } else paint(); return; }
    if (pm) { const x = turns().find((y) => y.id === pm[1]); if (x) { if (pm[3]) { x.agents = x.agents || {}; const g = (x.agents[pm[4]] = x.agents[pm[4]] || {}); g[{ model: 'model', eff: 'effort', sub: 'sub', fan: 'fan' }[pm[3]]] = v; } else x[pm[2]] = v; } menu = ''; paint(); return; }
    if (id === 'cl-label') { const c = chat(); c.labels = (c.labels || []).includes(v) ? c.labels.filter((l) => l !== v) : [...(c.labels || []), v]; window.RailChats.refresh(); menu = ''; refreshAll(); return; }
    if (id === 'cp-mode') { comp.mode = v.toLowerCase(); if (comp.mode !== 'task') comp.more = false; }
    else if (id === 'cp-plus') {
      if (v === 'Reuse') comp.text = 'Add a CSV export to the billing page';
      else if (v === 'Shape') { comp.mode = 'task'; comp.workflow = 'Shaper'; say('Worca will ask first, then write the requirements'); }
      else if (v === 'Files') { const f = SAMPLE_FILES.find((n) => !comp.files.includes(n)); if (f) comp.files = [...comp.files, f]; say(f ? `Would open a file picker: ${f} stands in` : 'Would open a file picker'); }
      else if (v === 'md') comp.files = [...new Set([...comp.files, 'Markdown'])];
      else if (v === 'Ticket') { comp.files = [...new Set([...comp.files, 'SHOP-124'])]; comp.text = 'Export button does nothing on Safari'; comp.mode = 'task'; }
    } else if (id === 'cp-preset') { comp.preset = v === 'No preset' ? '' : v; if (v === 'Hotfix') { comp.workflow = 'Lean'; comp.then = 'open a PR'; comp.mode = 'task'; } if (v === 'Docs only') { comp.workflow = 'Lean'; comp.mode = 'task'; } }
    else comp[id.slice(3)] = v;
    menu = '';
    paint(id !== 'cp-plus');   // Reuse and a ticket write the box: what it held gives way
  }
  const unitsOf = (x) => `${x.value} ${x.value === 1 ? x.unit.replace(/s$/, '') : x.unit}`;
  root.addEventListener('click', (e) => {
    if (e.target.closest('#card')) return;   // inside an open card's stages: the task page answers its own clicks
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('.menu-item[aria-disabled="true"]'))) { if (hit.title) say(hit.title); return; }   // small.disabled-why: an item that cannot act never acts, and says why
    if ((hit = on('[data-tick]'))) { goTo(hit.dataset.tick); return; }
    if ((hit = on('[data-menu-pick^="dl-"]'))) { const [id, val] = hit.dataset.menuPick.split('|'), [, t, k] = id.split('-'); dv[t][k] = val; menu = ''; paint(); return; }
    if ((hit = on('[data-menu-pick^="wfs-"], [data-menu-pick^="wfl-"]'))) { const [id, v] = hit.dataset.menuPick.split('|'), parts = id.split('-'), x = turns().find((y) => y.id === parts[1]); if (x) { if (parts[0] === 'wfl') x.loop[2] = v; else x.steps[+parts[2]][parts[3] === 'm' ? 2 : 3] = v; } menu = ''; paint(); say('Changed: Save keeps it'); return; }
    if ((hit = on('[data-menu-pick]'))) { const [id, ...r] = hit.dataset.menuPick.split('|'); if (id === 'tick') goTo(r.join('|')); else if (id.startsWith('cf-')) { const t = taskOf(id.slice(3)); if (t?.form) t.form.value = r.join('|'); menu = ''; paint(); } else if (id.startsWith('card:')) { menu = ''; const t = taskOf(id.slice(5)), label = r.join('|'); if (t?.kind === 'schedule') { window.RailSchedules?.act(t.id, { Pause: 'pause', Resume: 'pause', Skip: 'skip', Delete: 'delete' }[label]); paint(); return; } if (t) { if (label === 'open' || !label) window.RailShell.openTaskPage(t.case, chatId, t.title); else cardAct(t, label); } } else pickMenu(id, r.join('|')); return; }
    if ((hit = on('[data-listtoggle^="label|"]'))) { const v = hit.dataset.listtoggle.slice(6), c = chat(); if (c) { c.labels = (c.labels || []).includes(v) ? c.labels.filter((l) => l !== v) : [...(c.labels || []), v]; window.RailChats.refresh(); refreshAll(); keepLabelQ(); } return; }
    if ((hit = on('[data-card-form] [data-confirm]'))) { e.preventDefault(); const t = taskOf(hit.closest('[data-card-form]').dataset.cardForm); if (!t?.form) return; const fm = t.form; t.form = null;
      if (hit.dataset.confirm !== 'yes') { paint(); return; }
      const typed = root.querySelector(`[data-cf-field="${t.id}"]`)?.value?.trim(), value = ['preset', 'team-cap', 'label'].includes(fm.kind) ? typed || fm.value : fm.value;
      if (fm.kind === 'label') { const v = value.toLowerCase().slice(0, LABEL_MAX); if (!LABELS.includes(v)) LABELS.push(v); t.labels = [...new Set([...(t.labels || []), v])]; const r = t.run && window.RailWorld.find(t.run); if (r) r.labels = [...new Set([...(r.labels || []), v])]; }
      if (fm.kind === 'team-cap' && !typed) { t.form = fm; paint(); say('Say why it goes on first'); return; }
      const F = FORMS[fm.kind], flow = { ...fm.flow, dialog: '', say: (F.say ? F.say({ ...t, form: fm }, fm.flow) : fm.flow.say || fm.label).replace('{value}', value) };
      doAct(t, fm.label, flow); return; }
    if (on('[data-jump-latest]')) { const b = root.querySelector('.convo-scroll'); b?.scrollTo({ top: b.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
    if ((hit = on('[data-copy]'))) { navigator.clipboard?.writeText(hit.dataset.copy).catch(() => {}); R.copied(hit); return; }   // Copy command, Copy output: a tick, Copied
    if ((hit = on('[data-cmdg]'))) { const x = turns().find((y) => y.id === hit.dataset.cmdg); if (x) { x.open = !x.open; paint(); } return; }
    if ((hit = on('[data-cmdr]'))) { const [id, k] = hit.dataset.cmdr.split('|'), x = turns().find((y) => y.id === id); if (x) { x.rowOpen = x.rowOpen === +k ? -1 : +k; paint(); } return; }
    if ((hit = on('[data-cmdx]'))) { const x = turns()[+hit.dataset.cmdx]; if (x && x.done) { x.open = !x.open; paint(); } return; }
    if ((hit = on('[data-side-sug]'))) { comp.text = hit.dataset.sideSug; paint(false); root.querySelector('[data-composer-t]')?.focus(); return; }   // a suggestion fills the box, never sends
    if ((hit = on('[data-side-chat]'))) { chatId = hit.dataset.sideChat; paint(); return; }
    if (on('[data-side-nopage]')) { sideNoPage = true; paint(); say('This question goes without the page'); return; }
    if ((hit = on('[data-dl-open]'))) { const [id, i, part] = hit.dataset.dlOpen.split('|'), v = dv[id] || (dv[id] = {}), key = `${i}|${part}`; v.open = v.open === key ? '' : key; v.art = 0; v.mode = v.cyc = v.who = ''; v.allArts = false; paint(); return; }   // one part open at a time; a stage's own Artifacts are that stage's, the fact's are all of them
    if ((hit = on('[data-dl-art]'))) { const [id, k] = hit.dataset.dlArt.split('|'); dv[id].art = +k; paint(); root.querySelector(`[data-dl-art="${id}|${k}"]`)?.focus(); return; }
    if ((hit = on('[data-dl-err]'))) { const t = taskOf(hit.dataset.dlErr), v = dv[t.id], [i] = v.open.split('|'), e = t.depth.log.find((l) => l.s === +i && l.lvl === 'error'); v.mode = 'raw'; v.cyc = `cycle ${e.c}`; v.who = 'every agent'; paint(); say(`The first error: ${e.text}`); return; }
    if ((hit = on('[data-dl-copy]'))) { say(`Would copy ${hit.dataset.dlCopy} lines`); return; }
    if ((hit = on('[data-dl-follow]'))) { const v = dv[hit.dataset.dlFollow]; v.follow = v.follow === false; paint(); say(v.follow ? 'Follows new lines as they come' : 'Stays where you are'); return; }
    if ((hit = on('[data-dl-find]'))) { const [id, f, st] = hit.dataset.dlFind.split('|'), x = taskOf(id).depth.findings.find((y) => y.id === f); x.state = x.state === st ? '' : st; paint(); return; }
    if ((hit = on('[data-dl-all]'))) { taskOf(hit.dataset.dlAll).depth.findings.forEach((f) => { f.state = 'confirmed'; }); paint(); return; }
    if ((hit = on('[data-dl-send]'))) { const t = taskOf(hit.dataset.dlSend), F = t.depth.findings, n = F.filter((f) => f.state === 'confirmed').length; t.depth.sent = `${n} ${n === 1 ? 'finding' : 'findings'}${t.depth.note ? ' and your notes' : ''} · cycle 3 starts with ${n === 1 ? 'it' : 'them'}`; paint(); say('Sent to Review: its next cycle starts'); return; }
    if ((hit = on('[data-cp-act]')) && hit.dataset.cpAct.endsWith('|1') && turns().find((y) => y.id === hit.dataset.cpAct.split('|')[0])?.diff) { const x = turns().find((y) => y.id === hit.dataset.cpAct.split('|')[0]); x.diffOpen = !x.diffOpen; paint(); return; }   // Show the diff opens under the card
    if ((hit = on('[data-fact]'))) { const [k, id] = hit.dataset.fact.split('|'), t = taskOf(id); if (k === 'cost') window.RailShell.go('insights/spend'); else if (t) window.RailShell.openTaskPage(t.case, chatId, t.title); return; }
    if ((hit = on('[data-fact-files]'))) { const x = turns().find((y) => y.id === hit.dataset.factFiles); if (x) { x.filesOpen = !x.filesOpen; paint(); } return; }
    if ((hit = on('[data-fact-arts]'))) { const t = taskOf(hit.dataset.factArts); if (t) openHere(t, 'arts'); return; }
    if ((hit = on('[data-open-slice]'))) { const [cs, ...w] = hit.dataset.openSlice.split('|'); window.RailShell.openTaskPage(cs, chatId, w.join('|')); return; }
    if ((hit = on('[data-chg-yes], [data-chg-no]'))) { const x = turns().find((y) => y.id === (hit.dataset.chgYes || hit.dataset.chgNo)); if (x) { const yes = !!hit.dataset.chgYes, what = x.confirmDelete; x.confirmDelete = ''; if (yes) { x.done = 'Deleted'; if (window.RailSchedules?.find(x.schedule)) window.RailSchedules.act(x.schedule, 'delete'); else say(`Deleted: ${what}`); } paint(); } return; }
    if ((hit = on('[data-open-task-page]'))) { const t = taskOf(hit.dataset.openTaskPage); if (t) window.RailShell.openTaskPage(t.case, chatId, t.title); return; }
    if ((hit = on('[data-sched-card]'))) { const [id, how] = hit.dataset.schedCard.split('|'); window.RailSchedules?.act(id, how || 'run'); paint(); return; }
    if ((hit = on('[data-card-act]'))) { const [id, ...l] = hit.dataset.cardAct.split('|'), t = taskOf(id); if (t) cardAct(t, l.join('|')); return; }   // the button's own label, never its tone: View PR opens the PR
    if ((hit = on('[data-card-yes], [data-card-no]'))) { const t = taskOf(hit.dataset.cardYes || hit.dataset.cardNo); if (t) { const c = t.confirm; t.confirm = null; if (hit.dataset.cardYes && c) doAct(t, c.label, c.flow); else paint(); } return; }
    if (on('[data-cp-unabout]')) { e.preventDefault(); const a = comp.about; if (a?.binds) comp[a.binds] = a.was; comp.about = null; paint(); return; }
    if ((hit = on('[data-cp-unfile]'))) { e.preventDefault(); comp.files = comp.files.filter((f) => f !== hit.dataset.cpUnfile); paint(); return; }
    if ((hit = on('[data-menu]'))) { e.preventDefault(); menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; if (menu !== 'cl-label') labelQ = ''; paint(); if (menu === 'cl-label') keepLabelQ(); return; }
    if (on('[data-anchor-open]')) { menu = menu === 'anchors' ? '' : 'anchors'; paint(); return; }
    if (on('[data-cp-send]')) { e.preventDefault(); send(); return; }
    if (on('[data-cp-stop]')) { e.preventDefault(); clearTimeout(timer); const c = chat(), l = turns(), i = l.findIndex((x) => x.t === 'working'); if (i >= 0) l.splice(i, 1, { t: 'words', html: 'Stopped.' }); comp.busy = false; if (c) c.state = 'idle'; window.RailChats.refresh(); paint(); return; }
    if (on('[data-cp-more]')) { e.preventDefault(); comp.more = !comp.more; paint(); return; }
    if (on('[data-cp-mic]')) { e.preventDefault(); const was = comp.listening || comp.handsFree; comp.listening = !was; comp.handsFree = false; paint(); return; }
    if ((hit = on('[data-cp-use]'))) { e.preventDefault(); comp.engine = hit.dataset.cpUse; comp.startAt = ''; paint(); return; }
    if ((hit = on('[data-cp-at]'))) { e.preventDefault(); comp.startAt = hit.dataset.cpAt; paint(); return; }
    if (on('[data-plan-full]')) { const x = turns().find((y) => y.id === on('[data-plan-full]').dataset.planFull); if (x) { x.fullOpen = !x.fullOpen; paint(); } return; }
    if (on('[data-plan-roles]')) { const x = turns().find((y) => y.id === on('[data-plan-roles]').dataset.planRoles); if (x) { x.open = !x.open; paint(); } return; }
    if ((hit = on('[data-turn-toggle]')) && hit.closest('[data-fold-turn]')) { const i = hit.closest('[data-fold-turn]').dataset.foldTurn, x = turns()[+i]; if (x.t === 'fail') { const k = `shut${i}`; if (opened.has(k)) opened.delete(k); else opened.add(k); } else { const n = +i; if (opened.has(n)) opened.delete(n); else opened.add(n); } paint(); return; }
    if ((hit = on('[data-answer]'))) { const [i, n] = hit.dataset.answer.split('|'); turns()[+i].pick = +n; paint(); return; }
    if ((hit = on('[data-answer-picks]'))) { const l = turns(), x = l[+hit.dataset.answerPicks]; for (const y of [x, l.find((z) => z.id === x.many)]) if (y && !y.answered) y.answered = y.options[y.pick]; afterClarify(); paint(); say('Took Worca’s picks'); return; }
    if ((hit = on('[data-form-rank]'))) { const [k, id, d] = hit.dataset.formRank.split('|'), x = turns()[+k], at = x.items.findIndex((y) => y.id === id), to = d === 'up' ? at - 1 : at + 1; if (to >= 0 && to < x.items.length) { [x.items[at], x.items[to]] = [x.items[to], x.items[at]]; paint(); root.querySelector(`[data-form-rank="${k}|${id}|${d}"]`)?.focus(); } return; }
    if ((hit = on('[data-form-tick]'))) { const [k, id] = hit.dataset.formTick.split('|'), r = turns()[+k].rows.find((y) => y.id === id); r.checked = !r.checked; paint(); return; }
    if ((hit = on('[data-form-pick]'))) { const x = turns()[+hit.dataset.formPick]; if (x.kind === 'slider') x.value = x.pick; x.answered = x.kind === 'slider' ? `${unitsOf(x)} · Worca’s pick` : `${x.items.map((y) => y.text).join(' › ')} · Worca’s order`; paint(); say('Answered with Worca’s pick'); return; }
    if ((hit = on('[data-form-skip]'))) { turns()[+hit.dataset.formSkip].answered = 'Not now'; paint(); return; }
    if ((hit = on('[data-form-go]'))) { const x = turns()[+hit.dataset.formGo];
      x.answered = x.kind === 'slider' ? unitsOf(x) : x.kind === 'rank' ? x.items.map((y) => y.text).join(' › ') : `Made ${x.rows.filter((r) => r.checked).length} ${x.rows.filter((r) => r.checked).length === 1 ? 'task' : 'tasks'}: ${x.rows.filter((r) => r.checked).map((r) => r.cells[0].split(' · ')[0]).join(', ')}`;
      paint(); say(x.kind === 'rows' ? 'Made the tasks: each starts as you check it' : 'Answered'); return; }
    if ((hit = on('[data-answer-go]'))) {
      const x = turns()[+hit.dataset.answerGo], t = taskOf(x.task), c = chat();
      const own = root.querySelector(`[data-own="${hit.dataset.answerGo}"]`)?.value.trim(); if (own) { x.options = [...x.options, own]; x.pick = x.options.length - 1; }
      if (!t) { x.answered = x.options[x.pick]; afterClarify(); paint(); say('Answered'); return; }   // a question of the chat itself, not of a task
      x.answered = x.options[x.pick]; t.case = 'working'; t.detail = 'Review · carries on with your answer'; c.state = 'following'; put(c, t); window.RailChats.refresh(); paint(); say('Answered: the task carries on'); return;
    }
    if (on('[data-cp-queue]')) { const t = root.querySelector('[data-composer-t]'); comp.queue = [...(comp.queue || []), (t?.value || comp.text).trim()]; comp.text = ''; paint(); say('Queued: it goes when this reply is done'); return; }
    if ((hit = on('[data-q-edit]'))) { const k = +hit.dataset.qEdit; comp.text = comp.queue[k]; comp.queue.splice(k, 1); paint(); root.querySelector('[data-composer-t]')?.focus(); return; }
    if ((hit = on('[data-q-drop]'))) { comp.queue.splice(+hit.dataset.qDrop, 1); paint(); return; }
    if ((hit = on('[data-starter]'))) { const id = hit.dataset.starter; if (id === 'track') { menu = menu === 'starter-track' ? '' : 'starter-track'; paint(); } else arm(id); return; }
    if (on('[data-intent-clear]')) { comp.intent = ''; paint(); root.querySelector('[data-composer-t]')?.focus(); return; }
    const pp = (attr) => { const h = on(`[${attr}]`); return h ? turns().find((y) => y.id === h.getAttribute(attr)) : null; };
    let px;
    if ((hit = on('[data-gate]'))) { const [id, k] = hit.dataset.gate.split('|'), x = turns().find((y) => y.id === id); if (x) { x.done = x.actions[+k][2]; paint(); say(x.done); } return; }
    if ((px = pp('data-ship'))) { px.done = `Would open PR #1107 into dev · ${px.how || 'As one PR'}`; paint(); say(px.done); return; }
    if ((px = pp('data-ship-later'))) { px.done = 'Not shipped yet: ship it from here'; paint(); return; }
    if ((hit = on('[data-ship-how]'))) { const [id, v] = hit.dataset.shipHow.split('|'), x = turns().find((y) => y.id === id); if (x) { x.how = v; paint(); } return; }
    if ((px = pp('data-split-ok'))) { px.split = false; paint(); say(px.slices.length === 1 ? 'Approved 1 task: it starts' : `Approved ${px.slices.length} tasks: the first starts`); return; }
    if ((hit = on('[data-feat]'))) { const [id, a] = hit.dataset.feat.split('|'), x = turns().find((y) => y.id === id); if (x) { if (a === 'replan') { handHere('Feature', x.title, 'How should the rest change?'); return; }   /* steering belongs to Chat: the running task is not touched */ if (a === 'stop') { x.stopAsk = true; paint(); return; } if (a === 'stop-no') { x.stopAsk = false; paint(); return; } if (a === 'stop-yes') { x.stopAsk = false; x.stopped = true; x.slices.forEach((s) => { if (['ready', 'merged'].includes(s.case) || s.off) return; s.off = true; s.detail = s.case === 'scheduled' ? 'Never started' : 'Stopped by you'; }); } if (a === 'pause') x.halted = true; if (a === 'resume') x.halted = false; paint(); say({ pause: 'Paused', 'stop-yes': `Stopped: ${x.title}`, resume: 'Resumed' }[a]); } return; }
    if ((px = pp('data-plan-roles'))) { px.open = !px.open; paint(); return; }
    if ((px = pp('data-plan-approve'))) { px.approved = true; const l = turns(), i = l.indexOf(px);
      const own = l.find((y) => y.t === 'task' && y.id === px.from), t = own && taskOf(own.task);
      if (t) { Object.assign(t, { kind: 'feature', case: 'working', stage: 1, detail: 'Build · slice 1 of 2' }); l.splice(l.indexOf(own), 1); put(chat(), t); }   // its planning card gives way to the feature below
      l.splice(l.indexOf(px) + 1, 0, { t: 'feature', id: `f${Date.now().toString(36)}`, title: px.title, slices: [{ title: `${clip(px.title, 40)}: the change`, case: 'working', stage: 1, detail: 'Build' }, { title: `${clip(px.title, 40)}: its rollout`, case: 'scheduled', stage: -1, detail: 'After the change' }] }); paint(); say('Approved: the plan is being built'); return; }
    if ((px = pp('data-plan-changes'))) { px.asking = true; paint(); root.querySelector(`[data-ask-changes="${px.id}"]`)?.focus(); return; }
    if ((px = pp('data-changes-cancel'))) { px.asking = false; px.askValue = ''; paint(); return; }
    if ((px = pp('data-changes-send'))) { const v = root.querySelector(`[data-ask-changes="${px.id}"]`)?.value.trim(); if (!v) { say('Say what should change first'); return; } px.asking = false; px.askValue = ''; const l = turns();
      if (px.kind === 'Requirements') {   // your change goes into the requirements, which wait for your OK again
        px.rows = [...(px.rows || []), { name: 'Your change', before: '', after: v }];
        l.splice(l.indexOf(px) + 1, 0, { t: 'you', id: `y${Date.now().toString(36)}`, text: v, when: 'now' });
        paint(); say('Requirements rewritten with your change'); return;
      }
      if (px.t === 'task') {   // a follow-up on a task: on its branch, updating its PR, not a stranger
        const t = taskOf(px.task), k = Date.now().toString(36), at = l.indexOf(px) + 1;
        l.splice(at, 0, { t: 'you', id: `y${k}`, text: v, when: 'now', quote: t.title }, { t: 'words', html: `A follow-up on <b>${esc(t.title)}</b>, on its branch. Check it, then start it:` },
          { t: 'proposal', id: `p${k}`, title: clip(`${t.title}: ${v}`), why: `On top of ${t.title}${t.branch ? `, on ${t.branch}` : ''}`, project: chat()?.project || comp.project, workflow: 'Lean', engine: comp.engine, then: ['open', 'pass', 'fail', 'conflict'].includes(t.git) ? 'update its PR' : 'open a PR', feature: t.branch || '', open: false, nudge: false });
        paint(); say('Follow-up proposed'); return;
      } l.splice(l.indexOf(px) + 1, 0, { t: 'change', id: `cg${Date.now().toString(36)}`, kind: 'Changes', title: px.title, why: `“${v}”`, rows: [{ name: 'Where it lands', before: '', after: 'a new round of the plan' }], actions: [['Start round 2', 'primary', 'Round 2 started'], ['Not now', 'quiet', 'Not now']], state: 'proposed' }); paint(); say('Asked for changes'); return; }
    if ((hit = on('[data-cmd-stop]'))) { const x = turns()[+hit.dataset.cmdStop]; if (x) { x.stopped = true; paint(); say('Stopped the command'); } return; }
    if ((hit = on('[data-cp-act]'))) { const [id, k] = hit.dataset.cpAct.split('|'), x = turns().find((y) => y.id === id);
      if (x?.kind === 'Workspace' && x.name && +k === 0) window.RailSpaces?.add({ title: x.name, projects: x.holds });   // Worca's suggestion kept: it is a workspace now
      if (x?.kind === 'Requirements' && x.actions[+k][0] === 'Ask for changes') { x.asking = true; paint(); root.querySelector(`[data-ask-changes="${x.id}"]`)?.focus(); return; }
      if (x?.kind === 'Requirements' && +k === 0) { x.done = 'Requirements agreed'; const l = turns(); const qs = l.filter((y) => y.t === 'question' && y.shaper === x.from); l.splice(l.indexOf(x) + 1, 0, { t: 'words', html: 'Writing the plan from them.' }); afterClarify(); paint(); say('Requirements agreed: writing the plan'); return; }
      if (x) { x.done = x.actions[+k][2] + (x.choice ? ` · ${x.picked || x.choice.rec}` : ''); paint(); say(x.done); } return; }
    if ((hit = on('[data-cp-choice]'))) { const [id, v] = hit.dataset.cpChoice.split('|'), x = turns().find((y) => y.id === id); if (x) { x.picked = v; paint(); } return; }
    if ((hit = on('[data-act]'))) { const [id, k] = hit.dataset.act.split('|'), x = turns().find((y) => y.id === id); if (x) { if (x.actions[+k][3]) { say(x.actions[+k][3]); return; }   /* it only shows something: the card still waits */ x.done = x.actions[+k][2]; paint(); say(x.done); } return; }
    if ((hit = on('[data-cp-apply], [data-cp-decline], [data-cp-revert]'))) { const id = hit.dataset.cpApply || hit.dataset.cpDecline || hit.dataset.cpRevert, x = turns().find((y) => y.id === id); if (x && x.kind === 'Project' && x.how && hit.dataset.cpApply) {   // the project is added: its name joins every project picker, and the next words offer the first task
      const f = x.f || {}, name = (f.name || f.dir || (f.url || '').split('/').pop()?.replace(/\.git$/, '') || (f.path || '').split('/').pop() || '').trim();
      if (!name) { say(x.how === 'Clone' ? 'Say which repository to clone first' : x.how === 'New' ? 'Name the project first' : 'Say which folder first'); root.querySelector('[data-pj-field]')?.focus(); return; }
      if (!PROJECTS.includes(name)) PROJECTS.splice(PROJECTS.length - 1, 0, name);
      comp.project = name; lastProject = name; window.RailProjects?.add({ id: name, path: f.path || f.dir || (f.url ? `~/src/${name}` : `~/Projects/${name}`) });   /* one store: Projects lists it */ const ch = chat(); if (ch && !ch.project) { ch.project = name; window.RailChats.refresh(); } x.done = `${name} added${x.how === 'Clone' ? ', cloned' : ''}`; const l = turns(); l.splice(l.indexOf(x) + 1, 0, { t: 'words', html: `<b>${esc(name)}</b> is in. Tell me the first thing to do in it, and I'll propose it as a task you check before it starts.` });
      paint(); say(`Added ${name}`); return; }
    if (x && x.kind === 'Sign-in' && hit.dataset.cpApply) { x.done = `Claude Code is signed in, with ${x.picked || x.choice?.rec || 'your Claude subscription'}`; paint(); say('Signed in'); return; }
    if (x?.kind === 'Workspace' && x.holds && hit.dataset.cpApply && window.RailSpaces?.list().some((w) => w.title.toLowerCase() === x.name.toLowerCase())) { say(`There is already a workspace called ${x.name}`); return; }
    if (x?.kind === 'Workspace' && x.holds && hit.dataset.cpApply) x.space = window.RailSpaces?.add({ title: x.name, projects: x.holds });
    if (x?.space && hit.dataset.cpRevert) { window.RailSpaces?.remove(x.space); x.space = ''; }
    if (x) { x.state = hit.dataset.cpApply ? 'applied' : hit.dataset.cpRevert ? 'proposed' : 'declined'; if (x.state === 'applied' && x.graph) x.rows = [{ name: 'Saved as', before: '', after: 'API rewrite' }]; paint(); say(x.state === 'applied' ? (x.space ? `Created ${x.name}: ${x.holds.join(', ')}` : x.kind === 'Changes' ? 'Would start building' : `Would ${(x.apply || 'apply').toLowerCase()} ${x.title}`) : x.state === 'declined' ? 'Nothing changed' : 'Reverted'); } return; }
    if ((px = pp('data-pp-more'))) { px.open = !px.open; paint(); return; }
    if ((px = pp('data-pp-later'))) { px.later = true; paint(); say('Set aside: bring it back from the chat'); return; }
    if ((px = pp('data-pp-back'))) { px.later = false; paint(); return; }
    if ((px = pp('data-pp-asis'))) { px.nudge = false; paint(); say('Runs as is'); return; }
    if ((hit = on('[data-pp-persp]'))) { const [id, v] = hit.dataset.ppPersp.split('|'), x = turns().find((y) => y.id === id); if (x) { const l = x.persp || ['Product']; x.persp = l.includes(v) ? l.filter((z) => z !== v) : [...l, v]; paint(); } return; }
    if ((hit = on('[data-pp-unfile]'))) { const [id, f] = hit.dataset.ppUnfile.split('|'), x = turns().find((y) => y.id === id); if (x) { x.files = (x.files || []).filter((z) => z !== f); paint(); } return; }
    if ((hit = on('[data-pp-target]'))) { const [id, v] = hit.dataset.ppTarget.split('|'), x = turns().find((y) => y.id === id); if (x) { x.target = v; paint(); } return; }
    if ((px = pp('data-pp-onsource'))) { px.onSource = !px.onSource; paint(); return; }
    if ((px = pp('data-pp-reset'))) { px.agents = {}; paint(); say('Agents back to the proposal'); return; }
    if ((px = pp('data-pp-save'))) { say(`Saved as ${px.project}'s defaults`); return; }
    if ((px = pp('data-pp-composer'))) { comp = { ...comp, mode: 'task', text: px.brief ?? px.title, project: px.project, workflow: px.workflow, engine: px.engine, then: px.then, more: true }; paint(); root.querySelector('[data-composer-t]')?.focus(); say('In the composer: change anything, then start it'); return; }
    if ((px = pp('data-pp-shape'))) { px.workflow = 'Shaper'; paint(); say('Shaper will ask first, then write the requirements'); return; }
    if ((px = pp('data-pp-start'))) {
      // Start: the proposal becomes the running task card in its place
      const c = chat(), l = turns(), i = l.indexOf(px), n = Date.now().toString(36);
      const rep = (px.when || '').match(/^(every .+?) at (\d\d:\d\d)$/);
      if (rep) {   // a repeating "when" makes a schedule: its row in the bar, its page in Schedules, a run each time
        const s = { id: `s${n}`, kind: 'schedule', title: px.title, detail: `${rep[1].charAt(0).toUpperCase()}${rep[1].slice(1)} at ${rep[2]}`, time: rep[2] };
        c.tasks = [...(c.tasks || []), s]; l.splice(i, 1, { t: 'schedule', id: px.id, task: s.id });
        window.RailSchedules?.add({ id: s.id, title: s.title, project: px.project, chat: c.id, every: rep[1], at: rep[2], next: `Next at ${rep[2]}`, day: 'tomorrow', state: 'scheduled', time: rep[2], section: 'next', labels: [], runs: [] });
        window.RailChats.refresh(); paint(); say(`Scheduled ${rep[1]} at ${rep[2]}`); return;
      }
      const t = { id: `t${n}`, title: px.title, ask: px.brief ?? px.title, case: 'starting', stage: 0, git: 'branch', branch: px.feature || `feat/${slug(px.title)}`, detail: `Plan · ${px.workflow} on ${px.engine}` };
      if (px.when && px.when !== 'now') { t.case = 'scheduled'; t.stage = -1; t.git = ''; t.detail = `Starts ${px.when}`; }
      if (px.workflow === 'Shaper' && t.case !== 'scheduled') Object.assign(t, { case: 'question', detail: 'Plan asks you below' });   // Shaper waits on your answers, not "Starting"
      c.tasks = [...(c.tasks || []), t]; c.state = 'following'; put(c, t); settleStart(c, t);
      l.splice(i, 1, { t: 'task', id: px.id, task: t.id, persp: px.persp || ['Product'], ask: px.title });   // what was asked and who reviews it carry on to the plan
      if (px.workflow === 'Shaper' && t.case !== 'scheduled') { const k = Date.now().toString(36); l.splice(i + 1, 0, { t: 'words', html: 'A few questions before the plan:' }, { t: 'question', id: `q1${k}`, text: `A · For “${clip(px.title, 48)}”, what matters most?`, options: ['The smallest change that works', 'Configurable from the start'], pick: 0, many: `q2${k}`, shaper: px.id, when: 'now' }, { t: 'question', id: `q2${k}`, text: 'B · How should it reach people?', options: [(px.persp || []).includes('Security') ? 'Behind a flag, after a security review' : 'Behind a flag first', 'To everyone at once'], pick: 0, shaper: px.id, when: 'now' }); }
      window.RailChats.refresh(); paint(); say(t.case === 'scheduled' ? `Scheduled: starts ${px.when}` : px.workflow === 'Shaper' ? 'Planning started' : 'Task started'); return;
    }
    if ((hit = on('[data-open-task]'))) { const x = turns().find((y) => y.task === hit.dataset.openTask && (y.t === 'task' || y.t === 'schedule')); if (x) { const was = x.open; turns().forEach((y) => { y.open = false; y.openSlice = -1; }); x.open = !was; paint(); if (x.open) requestAnimationFrame(() => root.querySelector(`[data-anchor="${x.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })); } return; }   // How it ran opens the card in place, one at a time
    if ((hit = on('[data-open-sched]'))) { window.RailShell.go(`schedule/${hit.dataset.openSched}`); return; }   // its runs, by day
    if ((hit = on('[data-start-now]'))) { const t = taskOf(hit.dataset.startNow); if (t) { t.case = 'starting'; t.stage = 0; t.detail = 'Plan is under way'; put(chat(), t); window.RailChats.refresh(); paint(); say('Started now'); } return; }
    if ((hit = on('[data-cancel-task]'))) { const t = taskOf(hit.dataset.cancelTask); if (t) { t.cancelled = true; paint(); say('Cancelled'); } return; }
    if ((hit = on('[data-slice-open]'))) { const [id, k] = hit.dataset.sliceOpen.split('|'), x = turns().find((y) => y.id === id); if (x) { const was = x.openSlice === +k; turns().forEach((y) => { y.open = false; y.openSlice = -1; }); x.openSlice = was ? -1 : +k; paint(); } return; }   // one thing open at a time: the lent page goes to the slice
    if ((hit = on('[data-open-ref]'))) { window.RailShell.openTask(hit.dataset.openRef, '', hit.textContent.trim()); return; }
    if ((hit = on('[data-say]'))) say(hit.dataset.say);
  });
  root.addEventListener('submit', (e) => { e.preventDefault(); });
  // A hover only draws its card: the strip under the pointer stays the same elements.
  function paintTimelineHover() {
    const host = root.querySelector('[data-timeline]'); if (!host) return;
    host.querySelector('.tl-hover')?.remove();
    const on = ticks().find((t) => t.id === hover);
    if (on) host.insertAdjacentHTML('beforeend', `<div class="tl-hover">${R.timelineCard({ mark: on.mark, title: on.title, line: on.line, at: on.at })}</div>`);
  }
  root.addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tick]'); const id = t ? t.dataset.tick : null; if (id !== hover) { hover = id; paintTimelineHover(); } });
  root.addEventListener('focusin', (e) => { const t = e.target.closest('[data-tick]'); if (t && t.dataset.tick !== hover) { hover = t.dataset.tick; paintTimelineHover(); } });
  root.addEventListener('contextmenu', (e) => { const p = e.target.closest('[data-pin]'); if (!p) return; e.preventDefault(); pins = pins.filter((w) => w !== p.dataset.pin); paint(); say(`Unpinned ${p.dataset.pin}`); });
  root.addEventListener('keydown', (e) => { const p = e.target.closest?.('[data-pin]'); if (p && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) { e.preventDefault(); pins = pins.filter((w) => w !== p.dataset.pin); paint(); say(`Unpinned ${p.dataset.pin}`); } });
  root.addEventListener('input', (e) => { if (e.target.matches('[data-dl-note]')) { const t = taskOf(e.target.dataset.dlNote); if (t) t.depth.note = e.target.value; return; } });
  root.addEventListener('input', (e) => { if (e.target.matches('[data-form-slide]')) { const x = turns()[+e.target.dataset.formSlide]; x.value = +e.target.value; const b = e.target.closest('.q-slide')?.querySelector('.q-slide-t b'); if (b) b.textContent = `${x.value} ${x.unit}`; return; } });
  root.addEventListener('input', (e) => { if (e.target.matches('[data-composer-t]')) { comp.text = e.target.value; size(e.target); const at = /@[^@\s]*$/.test(comp.text); if (at !== (menu === 'cp-mention')) { menu = at ? 'cp-mention' : ''; paint(); } else if (at) { const list = root.querySelector('.composer-at'); if (list) list.outerHTML = mentionMenu(); } } if (e.target.matches('[data-pp-brief]')) { const x = turns().find((y) => y.id === e.target.dataset.ppBrief); if (x) x.brief = e.target.value; } if (e.target.matches('[data-pp-feature]')) { const x = turns().find((y) => y.id === e.target.dataset.ppFeature); if (x) x.feature = e.target.value; } if (e.target.matches('[data-pp-title]')) { const x = turns().find((y) => y.id === e.target.dataset.ppTitle); if (x) x.title = e.target.value; } });
  // motion.attention: what needs you in this chat glows once, when you arrive and when it starts to wait
  const asksBelow = (y) => { const l = turns(), at = l.indexOf(y); return l.some((z, j) => j > at && ((z.t === 'question' && !z.answered) || (z.t === 'plan' && !z.approved))); };   // a question under a card speaks for it: one thing breathes
  const waitsOnYou = (y) => (y.t === 'question' && !y.answered) || (y.t === 'form' && !y.answered) || (y.t === 'plan' && !y.approved) || (y.t === 'gate' && !y.done) || ((y.t === 'task') && !asksBelow(y) && (() => { const t = taskOf(y.task), r = t?.run && window.RailWorld.find(t.run); return !!r && window.RailWorld.section(r) === 'needs'; })());
  // it breathes until you focus it or act on it, like an unread mark; seen ones stay quiet across redraws
  const seenAttn = new Set();
  function attention() {
    const one = [...turns()].reverse().find((y) => y.id && waitsOnYou(y) && !seenAttn.has(y.id));   // the newest that waits on you, alone, as one filled button
    root.querySelectorAll('.is-attn').forEach((el) => { if (el.dataset.anchor !== one?.id) el.classList.remove('is-attn'); });
    const el = one && root.querySelector(`[data-anchor="${one.id}"]`); if (el) { el.classList.add('is-attn'); const t = one.t === 'task' && taskOf(one.task); const tone = t ? R.markTone(R.runState(RM.stateOf(t.case))) : 'ask'; el.dataset.attn = tone === 'fail' ? 'fail' : tone === 'ok' || tone === 'merged' ? 'ok' : 'ask'; if (chatId && root.offsetParent) quietSoon({ target: el }); }   /* opened: it breathes its while, then counts as seen */
  }
  // opened, it keeps breathing for the time Settings › Notifications says (3 seconds), then counts as seen; acting on it
  // (a click inside it) is seen at once. "Until you act on it": only acting counts.
  const seeing = new Set();
  const seeNow = (el) => { if (!el) return; seenAttn.add(el.dataset.anchor); el.classList.remove('is-attn'); };
  function quietSoon(e) { const el = e.target.closest?.('.is-attn[data-anchor]'); if (!el) return; const v = window.RailAttnFor || '3'; if (v === 'act') return; const id = el.dataset.anchor; if (seeing.has(id)) return; seeing.add(id); setTimeout(() => { const now = root.querySelector(`[data-anchor="${CSS.escape(id)}"]`); seenAttn.add(id); if (now) now.classList.remove('is-attn'); }, +v * 1000); }
  root.addEventListener('focusin', quietSoon);
  root.addEventListener('pointerdown', (e) => { if (e.target.closest?.('button, input, textarea, [role="radio"], [role="menuitem"]')) seeNow(e.target.closest('.is-attn[data-anchor]')); else quietSoon(e); });
  // the store changed (here, in Tasks, in Pulse, from Away): read every chat's tasks again and draw; what now waits glows
  window.RailWorld.onMove(() => { for (const c of data().chats) M.sync(c); window.RailChats?.refresh(); paint(); });
  // a step taken inside a card's open stages moves the task itself: its card's head and bar, the bar's row, Pulse
  document.addEventListener('rail:task-moved', (e) => {
    const { from, to, ask } = e.detail || {}, t = (chat()?.tasks || []).find((y) => y.case === from && (!ask || y.title === ask)); if (!t) return;
    t.case = to; t.detail = R.runState(RM.stateOf(to), CTX).word; const st = RM.stageOf?.(to); if (st?.stage >= 0) t.stage = st.stage;
    put(chat(), t);
  });
  // the Label picker's field: typing finds, Enter makes a new label and adds it to this chat
  function keepLabelQ() { const q = root.querySelector('#cl-label-q'); if (q) { q.value = labelQ; q.focus(); q.setSelectionRange(labelQ.length, labelQ.length); } }
  root.addEventListener('input', (e) => { const f = e.target.dataset?.cpField; if (f) comp[f] = e.target.value; });
  root.addEventListener('input', (e) => { const k = e.target.dataset?.pjField; if (!k) return; const [id, f] = k.split('|'), x = turns().find((y) => y.id === id); if (x) { x.f = x.f || {}; x.f[f] = e.target.value; } });   // Add project's fields keep what you type   // Customise's fields keep what you type
  root.addEventListener('input', (e) => { if (e.target.id === 'cl-label-q') { labelQ = e.target.value.slice(0, LABEL_MAX); paint(false); keepLabelQ(); } });
  root.addEventListener('keydown', (e) => {
    if (e.target.id !== 'cl-label-q' || e.key !== 'Enter') return;
    e.preventDefault(); const v = labelQ.trim().toLowerCase(), c = chat(); if (!v || !c) return;
    if (!LABELS.includes(v)) LABELS.push(v);
    if (!(c.labels || []).includes(v)) c.labels = [...(c.labels || []), v];
    labelQ = ''; window.RailChats.refresh(); refreshAll(); keepLabelQ(); say(`Labelled ${v}`);
  });
  root.addEventListener('keydown', (e) => { if (e.target.matches('[data-composer-t]') && e.key === 'Enter' && !e.shiftKey && comp.mode === 'ask') { e.preventDefault(); send(); } });
  document.addEventListener('keydown', (e) => {
    if (side || opts.where || (e.key !== '[' && e.key !== ']') || root.hidden || e.target.matches?.('input, textarea, select')) return;
    const list = ticks(); if (!list.length) return;
    const box = root.querySelector('.convo-scroll'), now = box.scrollTop / (box.scrollHeight || 1);
    const next = e.key === ']' ? list.find((t) => t.at > now + 0.01) : [...list].reverse().find((t) => t.at < now - 0.01);
    if (next) { e.preventDefault(); goTo(next.id); }
  });
  R.dismissOnOutside(document, { open: () => !!menu, inside: `${where} .spick, ${where} .rc-pop, ${where} [data-anchor-menu], ${where} .composer-at`, back: () => null, close: () => { menu = ''; }, paint: () => paint() });

  const api = {
    isSide: side,
    paint,
    // Everything leads to its card in its chat: scroll to the card of a task (by its case or id) or a schedule, and flash it once
    focus: ({ cs = '', id = '', title = '' }) => {
      const l = turns(), card = (y) => y.t === 'task' || y.t === 'schedule', feat = (y) => y.t === 'feature' && !y.split;
      // by the task itself, then by its name (a feature, a slice inside one), and only then by a case, which many share
      const x = l.find((y) => card(y) && id && y.task === id) || (title && (l.find((y) => card(y) && taskOf(y.task)?.title === title) || l.find((y) => feat(y) && (y.title === title || y.slices.some((sl) => sl.title === title)))))
        || l.find((y) => card(y) && cs && taskOf(y.task)?.case === cs) || l.find((y) => feat(y) && cs && y.slices.some((sl) => sl.case === cs));   // a Shaper slice leads to its feature's card
      const el = x && root.querySelector(`[data-anchor="${x.id}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash');
      return true;
    },
    show: (id) => { setTimeout(() => settle(id), 0); if (id !== chatId) { opened = new Set(); hover = null; menu = ''; comp = { ...fresh(), project: id ? data().chats.find((c) => c.id === id)?.project || 'No project' : lastProject };   /* a new chat starts on the project you added last */ } chatId = id || ''; paint(); if (id) { const box = root.querySelector('.convo-scroll'); if (box) { box.scrollTop = 0; paintTimeline(); } } },
    start: (mode, text, project) => { chatId = ''; comp = { ...fresh(mode), text: text || '', ...(project ? { project } : {}) }; if (!side) window.RailShell.go('chat'); paint(false); root.querySelector('[data-composer-t]')?.focus(); },   /* what another place hands over stays in the box, on its project */
    pin: (w, on) => { pins = on ? [...new Set([...pins, w])] : pins.filter((x) => x !== w); refreshAll(); },
    handOver: ({ mode = 'ask', about, text = '', ph = '', project, workflow }) => {   // rail.hand-to-chat: the one way a place sends something to Chat
      chatId = ''; comp = fresh(mode); const binds = workflow ? 'workflow' : project && about?.name === project ? 'project' : ''; const was = binds ? comp[binds] : '';
      Object.assign(comp, { text, ...(project ? { project } : {}), ...(workflow ? { workflow } : {}), about: about ? { ...about, ph, binds, was } : null });
      if (!side) window.RailShell.go('chat'); paint(false); root.querySelector('[data-composer-t]')?.focus();
      if (!side) setTimeout(() => root.querySelector('[data-composer-t]')?.focus(), 60);   /* the route draws after the hash changes: the box keeps the focus */
    },
    arm,   /* a starter armed from another place (Projects' New: Add project) */
  };
  mounted.push(api);
  paint();
  return api;
  }
  const refreshAll = () => mounted.forEach((m) => m.paint());
  // a seeded chat that was replying or running a command finishes a few seconds after you open it: no row works forever
  const settling = new WeakSet();
  function settle(id) {
    const c = window.RailChats?.data().chats.find((x) => x.id === id), l = c && threads.get(c.id); if (!l) return;
    for (const w of l.filter((x) => x.t === 'working' && x.settle && !settling.has(x))) {
      settling.add(w);
      setTimeout(() => { const i = l.indexOf(w); if (i < 0) return; l.splice(i, 1, { t: 'words', html: w.settle }); if (c.state === 'replying' || c.state === 'command') c.state = 'idle'; window.RailChats.refresh(); refreshAll(); }, 3000);
    }
  }

  // ---- a task's or a schedule's own page: its question goes to its chat, or starts one ----
  function dock(host, { kind, title, chat: linked }) {
    if (!host) return;
    const name = linked ? data().chats.find((c) => c.id === linked)?.title : '';
    host.innerHTML = `${R.composer({ placeholder: `${kind === 'schedule' ? 'Ask about this schedule, or change it' : kind === 'task' ? 'Ask about this task' : `Ask about this ${kind}, or change it`} · ${name ? `in ${name}` : 'in a new chat'}`, sentence: '', tools: '', send: R.button({ label: 'Send', kind: 'primary', iconOnly: true, icon: R.icon('up', 14), attrs: { 'data-dock-send': '', title: name ? `Goes to ${name}` : 'Starts a chat about it' } }), attrs: { 'data-dock': '' } })}`;
    const go = () => {
      const t = host.querySelector('[data-composer-t]'), text = t.value.trim();
      if (!text) { t.focus(); say('Say what to ask first'); return; }
      let id = linked;
      if (!id) { id = window.RailChats.newChat(`About ${title}`, ''); threads.set(id, []); }
      const c = data().chats.find((x) => x.id === id);
      if (!threads.has(id)) threads.set(id, M.thread(c));
      threads.get(id).push({ t: 'you', id: `y${Date.now().toString(36)}`, text, when: 'now' }, { t: 'words', html: `Looking at <b>${esc(title)}</b>.` });
      window.RailChats.refresh(); window.RailShell.go(`chat/${id}`);
    };
    host.querySelector('[data-dock-send]').addEventListener('click', go);
    host.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); go(); });
  }

  const main = mount(document.getElementById('route-chat'));
  setInterval(() => { for (const r of document.querySelectorAll('[data-think-at]')) { const now = thinkNow({ at: +r.dataset.thinkAt }), st = r.querySelector('.think-w'), t = r.querySelector('.think-t'); if (st && st.textContent !== now.step) st.textContent = now.step; if (t && t.textContent !== now.secs) t.textContent = now.secs; const orb = r.querySelector('canvas[data-orb]'); if (orb && orb.dataset.orb !== now.phase) orb.dataset.orb = now.phase; } }, 250);
  // Away: Worca answered what waited, with its pick; coming back finds the questions answered and the tasks moving
  function awayAnswer() {
    const out = [];
    for (const c of data().chats) {
      const l = threads.get(c.id) || (threads.set(c.id, M.thread(c)), threads.get(c.id));
      const qs = l.filter((y) => y.t === 'question' && !y.answered && !y.shaper); if (!qs.length) continue;
      qs.forEach((q) => { q.answered = `${q.options[q.pick ?? 0]} (Worca, while you were away)`; });
      const t = (c.tasks || []).find((y) => y.case && R.markTone(R.runState(RM.stateOf(y.case))) === 'ask');
      if (t) { t.case = 'working'; t.detail = 'Carries on with Worca’s answer'; put(c, t); out.push(`${t.title}: ${qs[0].options[qs[0].pick ?? 0]}`); }
    }
    window.RailChats.refresh(); refreshAll(); return out;
  }
  window.RailConversation = {
    join: (c, turn) => { if (!threads.has(c.id)) threads.set(c.id, M.thread(c)); threads.get(c.id).push(turn); },   // a task started elsewhere (a schedule's Run now) joins its chat
    awayAnswer,
    show: main.show,
    sideRefresh: () => mounted.forEach((m) => m.isSide && m.paint()),
    focus: main.focus,
    start: main.start,
    handOver: main.handOver,
    pin: main.pin,
    starter: (id) => { main.start('ask'); setTimeout(() => main.arm(id), 0); },   // Chat with a starter armed: a place's New that is a conversation (Add project)
    mount: (el, opts) => (opts ? mount(el, false, opts) : mount(el, true)),
    refresh: refreshAll,
    dock,
    chatOfTask: ({ run = '', title = '' }) => { const allOf = (x) => { const out = []; const walk = (y) => { out.push(y); (y.after || []).forEach(walk); }; (x.tasks || []).filter((y) => !y.followed).forEach(walk); return out; };   /* a task's chat is where it began, not the chat that follows it */ const c = data().chats.find((x) => allOf(x).some((t) => (run && t.run === run) || (title && t.title === title))); return c?.id || ''; },
    chatOfCase: (cs) => { const allOf = (x) => { const out = []; const walk = (y) => { out.push(y); (y.after || []).forEach(walk); }; (x.tasks || []).filter((y) => !y.followed).forEach(walk); return out; }; const c = data().chats.find((x) => allOf(x).some((t) => t.case === cs)); return c?.id || ''; },
    chatTitle: (id) => data().chats.find((x) => x.id === id)?.title || '',
  };
})();
