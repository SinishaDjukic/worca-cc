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
  const data = () => window.RailChats.data();
  const fresh = (mode = 'ask') => ({ files: [], mode, text: '', project: 'billing-api', workflow: 'Default', engine: 'Opus 5.5', from: 'origin · latest', then: 'open a PR', every: 'every day', at: '02:00', preset: '', more: false, startAt: '', busy: false });
  // Thinking: what it does now, in plain words, one step every 0.6s; its seconds; the row is updated in place, never redrawn
  const THINKING = ['Reading the chat', 'Looking through the project', 'Searching the code', 'Writing the answer'];
  const THOUGHT = ['Read the chat', 'Looked through the project', 'Searched the code', 'Wrote the answer'];   // the same steps, done
  const thinkNow = (x) => { const ms = Date.now() - (x.at || Date.now()), steps = x.steps || THINKING, n = Math.min(steps.length, 1 + Math.floor(ms / 600)); return { step: steps[n - 1], secs: `${Math.max(1, Math.round(ms / 1000))}s`, n, phase: n === steps.length ? 'write' : n === 3 ? 'tool' : 'think' }; };   // searching is a tool; the last step writes
  function mount(root, side = false, opts = {}) {
  const where = opts.where || (side ? '#ask-convo' : '#route-chat');
  let chatId = '', comp = fresh(opts.mode), menu = '', hover = null, opened = new Set(), timer = 0;
  const chat = () => data().chats.find((c) => c.id === chatId);
  const turns = () => { const c = chat(); if (!c) return []; if (!threads.has(c.id)) threads.set(c.id, M.thread(c)); return threads.get(c.id); };
  const allTasks = (c) => { const out = []; const walk = (x) => { out.push(x); (x.after || []).forEach(walk); }; (c?.tasks || []).forEach(walk); return out; };
  const taskOf = (id) => allTasks(chat()).find((t) => t.id === id);
  const stOf = (t) => R.runState(RM.stateOf(t.case), { base: 'dev', pr: '#1180', reset: '17:00' });

  // ---- the composer ----
  const pk = (id, text, items, tip) => R.sentencePicker({ id: `cp-${id}`, text, tip, items: items.map((x) => (typeof x === 'string' ? { id: x, text: x, checked: x === text } : { ...x, checked: x.id === text })), open: menu === `cp-${id}`, chevron: R.icon('chevron', 10) });
  const W = (t) => `<span>${t}</span>`;
  const MODES = [{ id: 'Ask', text: 'Ask', help: 'A question or a chat. Nothing starts by itself' }, { id: 'Task', text: 'Task', help: 'Starts work: a plan, a build, a review, a pull request' }, { id: 'Schedule', text: 'Schedule', help: 'Runs a task at its times' }];
  const PROJECTS = ['billing-api', 'web-app', 'worca-cc', 'docs-site', 'No project'];
  const ENGINES = ['Opus 5.5', 'Sonnet 5.5', 'Codex', 'Gemini'];
  function sentence() {
    const mode = comp.intent ? '' : pk('mode', comp.mode === 'ask' ? 'Ask' : comp.mode === 'task' ? 'Task' : 'Schedule', MODES, 'Ask, start a task, or schedule one');   // an armed starter's chip says what it is
    const project = (comp.intent ? '' : W('on')) + pk('project', comp.project, PROJECTS, 'Which project');
    const engine = pk('engine', comp.engine, ENGINES, 'Which engine and model') + pk('effort', comp.effort || 'high', ['low', 'medium', 'high'], 'How hard it thinks');
    if (comp.mode === 'ask') return mode + project + engine;
    if (comp.mode === 'schedule') return mode + project + pk('every', comp.every, ['every day', 'every weekday', 'every Monday', 'once'], 'When it repeats') + W('at') + pk('at', comp.at, ['02:00', '06:00', '09:00', '17:00'], 'What time');
    const preset = comp.preset ? W('·') + pk('preset', comp.preset, ['No preset', 'Hotfix', 'Docs only'], 'The preset that filled it') : '';
    return mode + project + W('with') + pk('workflow', comp.workflow, ['Default', 'Lean', 'Shaper', 'Architecture (C4)'], 'Which workflow') + W('on') + engine + W('from') + pk('from', comp.from, ['origin · latest', 'local copy', 'the source branch'], 'Where it starts') + W('then') + pk('then', comp.then, ['open a PR', 'leave a branch', 'push to the source'], 'What happens when it is done') + preset;
  }
  function detail() {
    if (comp.mode !== 'task') return '';
    const cr = (n, v) => `<div class="cr"><span>${n}</span><span>${v}</span></div>`;
    const note = window.RailPulse?.startNote?.();
    const noteHtml = note ? `<div class="composer-note">${R.kindMark({ kind: 'task', tone: note.blocked ? 'fail' : 'act', size: 16 })}<span>${esc(note.say)} ${note.use ? R.button({ label: `Use ${note.use}`, kind: 'quiet', attrs: { 'data-cp-use': note.use } }) : ''}${note.at ? R.button({ label: `Start at ${note.at}`, kind: 'quiet', attrs: { 'data-cp-at': note.at } }) : ''}</span></div>` : '';
    const more = comp.more ? `<div class="composer-more">${cr('Title', 'Worca names it')}${cr('Labels', 'hotfix, billing')}${cr('New branch', 'feat/billing-csv-export')}${cr('Asks you', 'When the plan has open questions')}${cr('Memory', 'This project')}${cr('Guardrails', 'Team default')}${R.shows('expert') ? cr('Agents', 'As the workflow says') + cr('MCP servers', 'Project defaults') : ''}</div>` : '';
    return `<div>${R.button({ label: comp.more ? 'Hide Customise' : 'Customise', kind: 'quiet', icon: R.icon(comp.more ? 'chevron' : 'chevR', 12), attrs: { 'data-cp-more': '', 'aria-expanded': String(comp.more), title: 'Title, labels, branch, memory, guardrails and more' } })}</div>${more}${noteHtml}`;
  }
  const chipsHtml = () => (comp.files.length ? `<span class="composer-chips">${comp.files.map((f) => R.button({ label: f, kind: 'quiet', icon: R.icon('x', 11), attrs: { 'data-cp-unfile': f, title: `Removes ${f}` } })).join('')}</span>` : '');
  // ---- starting: a starter only arms the composer (its chip and its placeholder); nothing is sent until you send ----
  const STARTERS = [
    { id: 'task', label: 'New task', icon: 'kind-task', ph: 'Describe the task…' },
    { id: 'workflow', label: 'Build workflow', icon: 'kind-workflow', ph: 'Describe the workflow…' },
    { id: 'schedule', label: 'Schedule a run', icon: 'clock', ph: 'What should run, and when?' },
    { id: 'track', label: 'Track a run', icon: 'track', ph: 'Which task to follow?' },
  ];
  const MORE = [
    { id: 'explain', label: 'Explain a diff', icon: 'pr', ph: 'Which task’s changes?' },
    { id: 'script', label: 'Write a script', icon: 'sliders', ph: 'What should the script do?' },
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
  function startersHtml() {
    const tile = (x, pin) => R.button({ label: x.label, kind: 'quiet', icon: R.icon(x.icon, 14), attrs: { 'data-starter': x.id, ...(pin ? { 'data-pin': x.label, title: `Fills the box for ${x.label}; unpin it from ⋯` } : { title: `Fills the box: ${x.ph}` }) } });
    const live = (window.RailChats?.data().chats || []).flatMap((c) => (c.tasks || []).filter((t) => t.case && t.kind !== 'schedule').map((t) => ({ t, c })));
    const pick = (id, items, head) => (menu === id ? R.compactMenu({ label: head, items: [{ header: head }, ...items] }) : '');
    const trackMenu = pick('starter-track', live.slice(0, 6).map(({ t }) => ({ id: `starter-track|${t.case}|${t.title}`, text: t.title, mark: taskMark(t, 14) })), live.length ? 'Live' : 'Nothing running');
    const more = R.moreMenu({ id: 'starter-more', label: 'More', icon: R.icon('more', 16), open: menu === 'starter-more', items: [...MORE.map((x) => ({ id: `starter|${x.id}`, text: x.label, mark: R.icon(x.icon, 14) })), { sep: true }, { header: 'Start from a preset' }, ...PRESETS.map((p) => ({ id: `starter-preset|${p}`, text: p, mark: R.icon('set-presets', 14) })), { sep: true }, { header: 'Pinned workflows' }, ...['Shaper', 'Lean', 'Architecture (C4)'].map((w) => (pins.includes(w) ? { id: `starter-unpin|${w}`, text: `Unpin ${w}`, mark: R.icon('pin', 14) } : { id: `starter-pin|${w}`, text: `Pin ${w}`, mark: R.icon('pin', 14) }))] });
    return `<div class="home-starters" role="group" aria-label="Start something">${pins.map((w) => tile({ id: `pin:${w}`, label: w, icon: w === 'Shaper' ? 'kind-feature' : 'kind-workflow' }, true)).join('')}${STARTERS.map((x) => x.id === 'track' ? `<span class="rc-pop">${tile(x)}${trackMenu}</span>` : tile(x)).join('')}<span class="rc-pop">${more}</span></div>`;
  }
  const intentChip = () => { const x = comp.intent && intentOf(comp.intent); return x ? R.intentChip({ icon: R.icon(x.icon, 12), label: x.label, clear: { 'data-intent-clear': '' } }) : ''; };
  // how full this chat's context is, and what waits to be sent
  const meter = () => { const c = chat(); if (!c) return ''; const pct = Math.min(96, 8 + turns().length * 3); return `<span class="composer-meter" title="This chat has used ${pct}% of its context (200k tokens); older turns are summarised past 90%">${pct}%</span>`; };
  const queueHtml = () => ((comp.queue || []).length ? `<div class="composer-queue">${comp.queue.map((q, k) => R.turnRow({ mark: R.icon('clock', 14), text: `<b>Queued</b> ${esc(q)}`, end: R.button({ label: 'Edit', kind: 'quiet', attrs: { 'data-q-edit': String(k) } }) + R.button({ label: `Remove ${q}`, kind: 'quiet', iconOnly: true, icon: R.icon('x', 12), attrs: { 'data-q-drop': String(k) } }) })).join('')}</div>` : '');
  // @ mentions: a task named in what you write becomes a chip that leads to its card
  const mentionMenu = () => { if (menu !== 'cp-at') return ''; const q = (comp.text.match(/@([^@\s]*)$/) || [, ''])[1].toLowerCase(); const all = (window.RailChats?.data().chats || []).flatMap((c) => (c.tasks || []).filter((t) => t.case && t.title.toLowerCase().includes(q))).slice(0, 6); return `<div class="composer-at">${R.compactMenu({ label: 'Mention a task', items: all.length ? all.map((t) => ({ id: `cp-at|${t.case}|${t.title}`, text: t.title, mark: taskMark(t, 14) })) : [{ header: 'No task by that name' }] })}</div>`; };
  function composerHtml() {
    const plus = `<span class="rc-pop">${R.button({ label: 'Add', kind: 'quiet', iconOnly: true, icon: R.icon('plus', 15), attrs: { 'data-menu': 'cp-plus', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'cp-plus') } })}${menu === 'cp-plus' ? R.compactMenu({ items: [{ id: 'cp-plus|Files', text: 'Files', help: 'Adds files for it to read' }, { id: 'cp-plus|md', text: 'Markdown or a .md file', help: 'Writes the task as Markdown' }, { id: 'cp-plus|Ticket', text: 'A ticket from a tracker', help: 'Starts from a ticket' }, { id: 'cp-plus|Reuse', text: 'Reuse last task', help: 'Fills in the words of your last task' }, { id: 'cp-plus|Shape', text: 'Shape it first', help: 'Worca asks and writes the requirements before it builds' }, { sep: true }, { header: 'Preset' }, ...['Hotfix', 'Docs only'].map((x) => ({ id: `cp-preset|${x}`, text: x, checked: comp.preset === x, help: 'Fills the sentence; Start says it is used' }))] }) : ''}</span>`;
    const words = comp.mode === 'schedule' ? 'Schedule' : 'Continue';
    const send = comp.busy ? R.button({ label: 'Stop', kind: 'primary', iconOnly: true, icon: R.icon('stop', 14), attrs: { 'data-cp-stop': '', title: 'Stops the reply' } })
      : comp.mode === 'ask' ? R.button({ label: 'Send', kind: 'primary', iconOnly: true, icon: R.icon('up', 14), attrs: { 'data-cp-send': '', title: 'Sends it to Worca' } })
        : R.button({ label: words, kind: 'primary', attrs: { 'data-cp-send': '', title: comp.mode === 'schedule' ? 'Saves the schedule' : 'Shows the task to check; you start it there' } });
    return queueHtml() + mentionMenu() + R.composer({ value: comp.text, placeholder: comp.intent ? intentOf(comp.intent)?.ph || 'Ask Worca…' : comp.mode === 'schedule' ? 'What should run each time?' : comp.mode === 'task' ? 'What should the task do?' : 'Ask Worca…', sentence: intentChip() + chipsHtml() + sentence(), detail: detail(), tools: plus, send: meter() + R.button({ label: comp.handsFree ? 'Hands-free on' : 'Speak', kind: 'quiet', iconOnly: true, icon: R.icon('mic', 15), attrs: { 'data-cp-mic': '', 'aria-pressed': String(!!comp.handsFree), title: 'Speak instead of typing' } }) + `<span class="rc-pop">${R.button({ label: 'Voice options', kind: 'quiet', iconOnly: true, icon: R.icon('chevron', 10), attrs: { 'data-menu': 'cp-voice', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'cp-voice') } })}${menu === 'cp-voice' ? R.compactMenu({ items: [{ id: 'cp-voice|hands', text: comp.handsFree ? 'Hands-free off' : 'Hands-free', help: 'Listens and answers aloud until you stop it' }] }) : ''}</span>` + send, attrs: { 'data-composer': '' } });
  }

  // ---- a turn ----
  const taskMark = (t, size) => (t.kind === 'schedule' ? R.kindMark({ kind: 'schedule', size, title: t.detail }) : R.kindMark({ kind: 'task', tone: R.markTone(stOf(t)), stage: t.stage, size, title: `${stOf(t).word} · ${t.detail || ''}` }));
  const gitOf = (t) => (t.git ? R.gitMark({ status: t.git, watch: t.watch || '', title: t.watch ? `Watching · ${t.detail}` : `${t.branch || ''}` }) : '');
  const cardMore = (t, items) => R.moreMenu({ id: `card:${t.id}`, label: `More for ${t.title}`, icon: R.icon('more', 16), open: menu === `card:${t.id}`, items });
  const openCard = (x, t) => {
    if (t.cancelled) return R.turnRow({ mark: R.icon('check', 14), text: `Cancelled: <b>${esc(t.title)}</b>` });
    const action = t.case === 'scheduled' ? R.button({ label: 'Start now', kind: 'primary', attrs: { 'data-start-now': t.id } }) + R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-cancel-task': t.id } })
      : R.button({ label: 'Open', kind: 'quiet', attrs: t.kind === 'schedule' ? { 'data-open-sched': t.id } : { 'data-open-task': t.id } });
    return R.taskCard({ compact: true, title: t.title, mark: taskMark(t), word: t.title, detail: t.detail, action, attrs: { 'data-anchor': x.id } });
  };
  // A task card's actions act here, from the same table the task page reads (run-state's actionFlow): a move to its next
  // state, a confirm under the card, or (a dialog) its page, which still holds the dialogs.
  const CTX = { base: 'dev', pr: '#1180', reset: '17:00', branch: 'feat/billing-csv-export', at: '14:00', value: '$40' };
  function cardAct(t, label) {
    if (!label) return;
    const f = R.actionFlow(RM.stateOf(t.case), CTX)[label];
    if (!f) { say(label); return; }
    if (f.dialog) { t.confirm = { label, text: f.say || `${label} for ${t.title}`, flow: f }; paint(); return; }   // what its page asked in a dialog, asked here
    if (f.confirm) { t.confirm = { label, text: f.confirm, flow: f }; paint(); return; }
    doAct(t, label, f);
  }
  function doAct(t, label, f) {
    if (f.to && RM.cases?.some?.((c) => c.id === f.to)) { t.case = f.to; t.detail = R.runState(RM.stateOf(f.to), CTX).word; }
    window.RailChats.refresh(); paint(); say(f.say || label);
  }
  // The proposed task, at dev's run proposal's parity, in Rail's words: the composer's sentence (with when), the workflow
  // said in a line, the brief with its files, Shaper's perspectives, Customise (where it runs, branches, guardrails, labels,
  // memory, asks you, and in Expert the agents), then Start (Schedule, Start planning), Not now, Open in the composer.
  const WORKFLOWS = { Default: 'Plan, build and review, then a PR', Lean: 'Build and a quick review', Shaper: 'Up to 3 questions, then a plan you approve', 'Architecture (C4)': 'A C4 model first, then the plan' };
  const WHEN = ['now', 'at 17:00', 'tonight at 02:00', 'every weekday at 09:00', 'after Add CSV export'];
  const PERSPECTIVES = ['Product', 'Security', 'UX', 'Data', 'Performance', 'Operations'];
  const EFFORT = ['low', 'medium', 'high'];
  // Shaper: once its questions are answered, a receipt names the decision and its plan follows
  function afterClarify() {
    const l = turns(), qs = l.filter((y) => y.t === 'question' && y.shaper), open = qs.filter((y) => !y.answered);
    if (!qs.length || open.length) return;
    const from = qs[0].shaper; if (l.some((y) => y.t === 'plan' && y.from === from)) return;
    const at = l.indexOf(qs[qs.length - 1]) + 1, k = Date.now().toString(36);
    l.splice(at, 0, { t: 'notice', text: 'Requirements agreed' }, { t: 'plan', id: `pl${k}`, from, title: 'The plan', summary: qs.map((y) => y.answered).join(' · '), v: 1, versions: 1, roles: [{ name: 'Product', ok: true, note: 'Matches what was asked' }, { name: 'Security', ok: true, note: 'Nothing exposed' }, { name: 'UX', ok: false, note: 'Wants the column names checked' }] });
  }
  // One filled button on the screen (rail.one-action): only the newest card still asking keeps its primary; the rest go
  // quiet, so what waits on you is the loudest thing here.
  const ASKING = (y) => (y.t === 'proposal' && !y.later) || (y.t === 'change' && y.state === 'proposed' && !y.done) || (y.t === 'plan' && !y.approved) || (y.t === 'feature' && y.split) || ((y.t === 'gate' || y.t === 'ship' || y.t === 'act') && !y.done) || (y.t === 'question' && !y.answered);
  function calmCards(l) {
    let last = -1; l.forEach((y, k) => { if (ASKING(y)) last = k; });
    return l.map((y, k) => { const h = turnHtml(y, k); return k === last ? h : h.replace(/ btn-primary"/g, '"'); }).join('');
  }
  // Ask for changes, under the card it is about: a field, Send changes, Not now
  const askChanges = (x) => (x.asking ? `<div class="ask-changes">${R.field({ id: `chg-${x.id}`, label: 'What should change', quietLabel: true, placeholder: 'What should change?', multiline: true, attrs: { 'data-ask-changes': x.id } })}<span class="tp-actions">${R.button({ label: 'Send changes', kind: 'primary', attrs: { 'data-changes-send': x.id } })}${R.button({ label: 'Not now', kind: 'quiet', attrs: { 'data-changes-cancel': x.id } })}</span></div>` : '');
  function proposalHtml(x) {
    if (x.later) return R.turnRow({ mark: R.kindMark({ kind: 'task', tone: 'idle', size: 16 }), text: `Not now: <b>${esc(x.title)}</b>`, end: R.button({ label: 'Bring back', kind: 'quiet', attrs: { 'data-pp-back': x.id } }) });
    const pp = (f, text, items, tip) => R.sentencePicker({ id: `pp-${x.id}-${f}`, text, tip, items: items.map((v) => ({ id: v, text: v, checked: v === text })), open: menu === `pp-${x.id}-${f}`, chevron: R.icon('chevron', 10) });
    const shaper = x.workflow === 'Shaper', later = x.when && x.when !== 'now';
    const sentence = W('Task') + W('on') + pp('project', x.project, PROJECTS, 'Which project') + W('with') + pp('workflow', x.workflow, Object.keys(WORKFLOWS), 'Which workflow') + W('on') + pp('engine', x.engine, ENGINES, 'Which engine and model') + W('·') + pp('effort', x.effort || 'high', EFFORT, 'How hard it thinks') + pp('when', x.when || 'now', WHEN, 'When it starts: now, at a time, repeating, or after another task') + W('then') + pp('then', x.then, ['open a PR', 'leave a branch', 'merge into dev'], 'What happens when it is done');
    const brief = `<div class="tp-brief">${R.field({ id: `pp-brief-${x.id}`, label: 'Brief: what the first agent reads · Markdown', value: x.brief ?? x.why.replace(/^From this chat: /, ''), multiline: true, hint: `${(x.brief ?? x.why).length} characters`, attrs: { 'data-pp-brief': x.id } })}${(x.files || []).length ? `<span class="you-files">${x.files.map((f) => R.button({ label: f, kind: 'quiet', icon: R.icon('x', 11), attrs: { 'data-pp-unfile': `${x.id}|${f}`, title: `Removes ${f}` } })).join('')}</span>` : ''}</div>`;
    const persp = shaper ? `<div class="tp-persp"><span class="tp-label">Perspectives</span>${PERSPECTIVES.map((v) => R.button({ label: v, kind: 'quiet', attrs: v === 'Product' ? { 'aria-pressed': 'true', 'aria-disabled': 'true', title: 'Product always reviews' } : { 'data-pp-persp': `${x.id}|${v}`, 'aria-pressed': String((x.persp || ['Product']).includes(v)), title: 'Adds or removes this perspective' } })).join('')}</div>` : '';
    const what = `<p class="tp-what">${esc(WORKFLOWS[x.workflow] || '')}${later ? ` · starts ${esc(x.when)}` : ''}</p>`;
    const row = (k, v) => `<div class="cr"><span>${k}</span><span>${v}</span></div>`;
    const target = pp('target', x.target || 'Project', ['No project', 'Project', 'Workspace'], 'Where it runs');
    const agents = R.shows('expert') ? `<div class="tp-agents"><span class="tp-label">Agents ${R.button({ label: 'Reset to proposal', kind: 'quiet', attrs: { 'data-pp-reset': x.id } })}${R.button({ label: 'Save as project defaults', kind: 'quiet', attrs: { 'data-pp-save': x.id } })}</span>${['Plan', 'Build', 'Review'].map((a) => { const g = (x.agents || {})[a] || {}; return `<div class="cr"><span>${a}</span><span>${pp(`model${a}`, g.model || x.engine, ENGINES, `${a}'s model`)}${W('·')}${pp(`eff${a}`, g.effort || x.effort || 'high', EFFORT, `${a}'s effort`)}${W('·')}${pp(`sub${a}`, g.sub || 'no sub-agents', ['no sub-agents', '2 sub-agents', '4 sub-agents'], `${a}'s sub-agents`)}${W('·')}${pp(`fan${a}`, g.fan || 'one at a time', ['one at a time', 'fan out 3'], `${a}'s fan-out`)}</span></div>`; }).join('')}</div>` : '';
    const more = row('Where it runs', target)
      + row('Source branch', pp('src', x.src || 'dev', ['dev', 'main', 'origin · latest'], 'Where it starts from'))
      + row('Feature branch', R.field({ id: `pp-feat-${x.id}`, label: 'Feature branch', quietLabel: true, value: x.feature || `feat/${x.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 28)}`, attrs: { 'data-pp-feature': x.id } }))
      + row('Run on the source branch', R.switchButton({ on: !!x.onSource, label: 'Run on the source branch', attrs: { 'data-pp-onsource': x.id } }))
      + row('Base branch', pp('base', x.base || 'dev', ['dev', 'main'], 'Where its PR goes'))
      + row('Guardrails', pp('guard', x.guard || 'Team default', ['Team default', 'Strict', 'Read only'], 'Applies to every agent in this task'))
      + row('Labels', pp('labels', x.labels || 'billing', ['billing', 'hotfix', 'export', 'no label'], 'Its labels'))
      + row('Memory', pp('memory', x.memory || 'This project', ['This project', 'None'], 'What it remembers'))
      + row('Asks you', pp('asks', x.asks || 'When the plan has open questions', ['When the plan has open questions', 'Never', 'Before every step'], 'When it stops to ask'))
      + agents;
    const nudge = x.nudge && !shaper ? `${R.kindMark({ kind: 'chat', tone: 'ask', size: 14 })}<span>This has open decisions: Shaper can ask them first (≈ $12 · ~40 min, against ≈ $8 · ~25 min as is).</span>` : '';
    const alts = x.nudge && !shaper ? { open: menu === `ppalt-${x.id}`, attrs: { 'data-menu': `ppalt-${x.id}` }, menu: R.compactMenu({ items: [{ id: `ppalt-${x.id}|asis`, text: 'Run as is', hint: '≈ $8 · ~25 min' }, { id: `ppalt-${x.id}|shape`, text: 'Shape it first', hint: '≈ $12 · ~40 min' }] }) } : null;
    const kicker = x.ticket ? `Proposed · from ${x.ticket}` : x.preset ? `Proposed · from preset ${x.preset}` : 'Proposed';
    const card = R.taskProposal({ title: x.title, why: x.why, sentence: sentence + what + persp, more: brief + more, open: x.open, nudge, hooks: { title: { 'data-pp-title': x.id }, more: { 'data-pp-more': x.id }, start: { 'data-pp-start': x.id }, later: { 'data-pp-later': x.id } }, start: later ? 'Schedule' : shaper ? 'Start planning' : 'Start', alts, kicker, extra: R.button({ label: 'Edit in the composer', kind: 'quiet', attrs: { 'data-pp-composer': x.id, title: 'Puts all of it in the box to change; this card stays until you send' } }), attrs: { 'data-anchor': x.id } });
    return card;
  }

  function turnHtml(x, i) {
    const fold = () => ({ 'data-fold-turn': String(i), ...(x.id ? { 'data-anchor': x.id } : {}) });
    if (x.t === 'you') return R.youTurn({ text: x.text, quote: x.quote || '', files: x.files || [], refs: (x.refs || []).map((r) => ({ text: r.title, mark: R.kindMark({ kind: 'task', tone: 'idle', size: 14 }), attrs: { 'data-open-ref': r.case } })), attrs: { 'data-anchor': x.id || '' } });
    if (x.t === 'cmd') {   // a command running now: its seconds live; done, it folds its output like any command
      const cmdMenu = R.moreMenu({ id: `cmd:${i}`, label: `More for ${x.cmd}`, icon: R.icon('more', 16), open: menu === `cmd:${i}`, items: ['Copy command', 'Copy output', 'Show in terminal', 'Show all'] });
      if (!x.done && !x.stopped) return R.turnRow({ mark: R.kindMark({ kind: 'event', tone: 'run', size: 16 }), text: `<b>${esc(x.cmd)}</b>`, end: `<span class="think-t">1s</span>${R.button({ label: 'Stop', kind: 'quiet', attrs: { 'data-cmd-stop': String(i) } })}${cmdMenu}`, attrs: { 'data-think-at': String(x.at || (x.at = Date.now())) } });
      if (x.stopped) return R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'stop', size: 16 }), text: `<b>${esc(x.cmd)}</b> stopped by you`, end: cmdMenu });
      return R.turnRow({ mark: R.icon(opened.has(i) ? 'chevron' : 'chevR', 14), text: `<b>${esc(x.cmd)}</b> ${esc(x.sum || '')}`, end: `${esc(x.end || '')}${cmdMenu}`, body: esc(x.out || ''), open: opened.has(i), attrs: fold() });
    }
    if (x.t === 'gate') {   // a step that needs a decision, or failed: its choices on one line
      if (x.done) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.title)}</b> ${esc(x.done)}` });
      return R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: x.failed ? 'fail' : 'ask', size: 16 }), text: `<b>${esc(x.title)}</b> ${esc(x.line)}`, end: x.actions.map(([l, k], n) => R.button({ label: l, kind: k, attrs: { 'data-gate': `${x.id}|${n}` } })).join(''), attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'ship') {   // what ships: each requirement met, not met (where it moved) or dropped (why); one PR or stacked
      if (x.done) return R.turnRow({ mark: R.gitMark({ status: 'open' }), text: `<b>${esc(x.done)}</b>` });
      const pk = (n, v) => R.sentencePicker({ id: `ship-${x.id}-${n}`, text: v, tip: 'Met, not met (where it moved) or dropped (why)', items: ['Met', 'Not met: moved to a later task', 'Dropped: not needed now'].map((o) => ({ id: o, text: o, checked: o === v })), open: menu === `ship-${x.id}-${n}`, chevron: R.icon('chevron', 10) });
      const met = x.reqs.filter((r) => r.v === 'Met').length;
      const rows = x.reqs.map((r, n) => R.turnRow({ mark: R.icon(r.v === 'Met' ? 'check' : 'x', 14), text: esc(r.text), end: pk(n, r.v) })).join('');
      const how = `<p class="tp-sentence"><span>Ships</span>${R.sentencePicker({ id: `shiphow-${x.id}`, text: (x.how || 'as one PR'), tip: 'One PR, or a stack of PRs', items: ['as one PR', 'as stacked PRs'].map((v) => ({ id: v, text: v, checked: (x.how || 'as one PR') === v })), open: menu === `shiphow-${x.id}`, chevron: R.icon('chevron', 10) })}</p>`;
      return R.changeProposal({ kind: 'Ship', title: x.title, why: `Requirements ${met}/${x.reqs.length}`, body: `<div class="tc-rows">${rows}</div>${how}`, apply: 'Create PR', hooks: { apply: { 'data-ship': x.id }, decline: { 'data-ship-later': x.id } }, attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'feature') {
      const rows = x.slices.map((sl) => R.turnRow({ mark: R.kindMark({ kind: 'task', tone: R.markTone(R.runState(RM.stateOf(sl.case))), stage: sl.stage, size: 16 }), text: `${R.textLink({ label: sl.title, attrs: { 'data-open-ref': sl.case, title: `Opens ${sl.title} in its chat` } })} ${esc(sl.detail)}` })).join('');
      if (x.split) {
        const srows = x.slices.map((sl, n) => R.turnRow({ mark: R.kindMark({ kind: 'task', tone: 'idle', size: 16 }), text: `<b>${n + 1} · ${esc(sl.title)}</b> ${esc(sl.detail)}`, end: R.moreMenu({ id: `slice:${x.id}:${n}`, label: `More for ${sl.title}`, icon: R.icon('more', 16), open: menu === `slice:${x.id}:${n}`, items: ['Merge with next', 'Remove'] }) })).join('');
        return R.taskCard({ title: x.title, mark: R.kindMark({ kind: 'feature', tone: 'ask' }), word: 'Split', detail: `one after another${x.askEach ? ' · asks before each' : ''}`, rows: srows, action: R.button({ label: `Approve ${x.slices.length} tasks`, kind: 'primary', attrs: { 'data-split-ok': x.id } }) + R.button({ label: 'Ask for changes', kind: 'quiet', attrs: { 'data-plan-changes': x.id } }), menu: R.moreMenu({ id: `split:${x.id}`, label: 'More for the split', icon: R.icon('more', 16), open: menu === `split:${x.id}`, items: ['Fix all', 'Plan it as one', 'Undo edits', x.askEach ? 'Don’t ask before each task' : 'Ask me before each task', 'Stop'] }), attrs: { 'data-anchor': x.id } }) + askChanges(x);
      }
      const halted = !!x.halted;
      return R.taskCard({ title: x.title, mark: R.kindMark({ kind: 'feature', tone: halted ? 'pause' : 'run', stage: 1 }), word: halted ? 'Paused' : 'Running', detail: `${x.slices.length} tasks, one after another`, stages: R.stageBar({ labels: STAGES, stage: 1, tone: halted ? 'pause' : 'run' }), rows, action: halted ? R.button({ label: 'Resume', kind: 'primary', attrs: { 'data-feat': `${x.id}|resume` } }) + R.button({ label: 'Re-plan the rest', kind: 'quiet', attrs: { 'data-feat': `${x.id}|replan` } }) : R.button({ label: 'Pause', kind: '', attrs: { 'data-feat': `${x.id}|pause` } }) + R.button({ label: 'Stop', kind: 'quiet', attrs: { 'data-feat': `${x.id}|stop` } }), menu: R.moreMenu({ id: `feat:${x.id}`, label: 'More for the feature', icon: R.icon('more', 16), open: menu === `feat:${x.id}`, items: ['Re-plan the rest', 'Cancel the rest', 'Ask before each run', 'Open the plan'] }), attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'plan') {
      const version = R.sentencePicker({ id: `pv-${x.id}`, text: `v${x.v} of ${x.versions}`, tip: 'Earlier versions of the plan', items: Array.from({ length: x.versions }, (_, k) => ({ id: String(k + 1), text: `v${k + 1}${k + 1 === x.versions ? ' (latest)' : ''}`, checked: k + 1 === x.v })), open: menu === `pv-${x.id}`, chevron: R.icon('chevron', 10) });
      if (x.approved) return R.turnRow({ mark: R.icon('check', 14), text: `<b>Plan approved</b> v${x.v}: building it` });
      const planMenu = R.moreMenu({ id: `plan:${x.id}`, label: 'More for the plan', icon: R.icon('more', 16), open: menu === `plan:${x.id}`, items: ['Fix all', 'Save to plans/', 'Open in the composer', 'Stop'] });
      const extra = R.turnRow({ mark: R.icon('check', 14), text: '<b>Shape check</b> passed · scope, risks and tests are covered' }) + R.turnRow({ mark: R.icon('list', 14), text: `<b>Perspectives</b> ${esc((x.persp || ['Product', 'Security', 'UX', 'Data', 'Performance']).join(', '))}`, end: R.button({ label: 'Update plan', kind: 'quiet', attrs: { 'data-say': 'The plan is drafted again for these perspectives' } }) });
      return askChanges(x) ? R.planCard({ menu: planMenu, extra, title: x.title, summary: x.summary, version, roles: x.roles, open: !!x.open, hooks: { roles: { 'data-plan-roles': x.id }, approve: { 'data-plan-approve': x.id }, changes: { 'data-plan-changes': x.id }, full: { 'data-say': 'Opens the full plan' } }, attrs: { 'data-anchor': x.id } }) + askChanges(x) : R.planCard({ menu: planMenu, extra, title: x.title, summary: x.summary, version, roles: x.roles, open: !!x.open, hooks: { roles: { 'data-plan-roles': x.id }, approve: { 'data-plan-approve': x.id }, changes: { 'data-plan-changes': x.id }, full: { 'data-say': 'Opens the full plan' } }, attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'filesgrid') return R.filesCard({ label: x.label || 'Files', files: x.files.map((f) => ({ ...f, view: { 'data-say': `Opens ${f.name}` }, download: { 'data-say': `Downloaded ${f.name}` } })) });
    if (x.t === 'words') return `<p class="convo-words">${x.html}</p>`;
    if (x.t === 'proposal') return proposalHtml(x);
    if (x.t === 'divider') return R.turnDivider({ text: x.text });
    if (x.t === 'notice') return R.turnRow({ mark: R.icon('check', 14), text: esc(x.text) });
    if (x.t === 'act') {
      if (x.done) return R.turnRow({ mark: R.icon('check', 14), text: esc(x.done) });
      const mark = x.mark === 'git' ? R.gitMark({ status: 'branch', title: 'Its branch' }) : R.kindMark({ kind: 'chat', tone: 'ask', size: 16 });
      return R.turnRow({ mark, text: x.text, end: x.actions.map(([label, kind], k) => R.button({ label, kind: kind === 'danger' ? 'quiet' : kind, cls: kind === 'danger' ? 'is-danger' : '', attrs: { 'data-act': `${x.id}|${k}` } })).join(''), attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'change') {
      const STEPS = [['Plan', 'Plan the contract → Sign off'], ['Build', 'Slice 1: read → Slice 2: write → Slice 3: auth'], ['Review', 'Review each slice'], ['PR', 'One PR into dev']];
      const graph = x.graph ? `<div class="tc-rows">${STEPS.map(([k, v]) => R.turnRow({ mark: R.icon('kind-workflow', 14), text: `<b>${k}</b> ${esc(v)}` })).join('')}</div>` : '';   // its steps on the rail; the full graph is Workflows'
      const choice = x.choice ? `<p class="tp-sentence"><span>${esc(x.choice.label)}</span>${R.sentencePicker({ id: `cpch-${x.id}`, text: x.picked || x.choice.rec, tip: `${x.choice.label}: ${x.choice.rec} is what Worca recommends`, items: x.choice.items.map((v) => ({ id: v, text: v, help: v === x.choice.rec ? 'Worca recommends it' : '', checked: (x.picked || x.choice.rec) === v })), open: menu === `cpch-${x.id}`, chevron: R.icon('chevron', 10) })}</p>` : '';
      const acts = x.actions ? x.actions.map(([label, kind, done], k) => ({ label, kind, attrs: { 'data-cp-act': `${x.id}|${k}` } })) : null;
      if (x.done) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.title)}</b> ${esc(x.done)}` });
      const cpMenu = R.moreMenu({ id: `chg:${x.id}`, label: `More for ${x.title}`, icon: R.icon('more', 16), open: menu === `chg:${x.id}`, items: [...(x.menuItems || []), 'Ask about it', 'Not now'] });
      return R.changeProposal({ menu: cpMenu, actions: acts, kind: x.kind, title: x.title, why: x.why || '', rows: x.rows || [], body: graph + choice, state: x.state, apply: x.apply || 'Apply', hooks: { apply: { 'data-cp-apply': x.id }, decline: { 'data-cp-decline': x.id }, revert: { 'data-cp-revert': x.id } }, attrs: { 'data-anchor': x.id } });
    }
    if (x.t === 'think') return R.thinkingRow({ done: true, secs: (x.text.match(/\d+s/) || ['a moment'])[0], steps: x.steps || THOUGHT, open: opened.has(i), attrs: fold() });
    if (x.t === 'cmds') return R.turnRow({ mark: R.icon(opened.has(i) ? 'chevron' : 'chevR', 14), text: esc(x.text), end: x.end, body: esc(x.body), open: opened.has(i), attrs: fold() });
    if (x.t === 'fail') return R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'fail', size: 16 }), text: `<b>${esc(x.cmd)}</b> failed`, end: x.end, body: esc(x.body), open: !opened.has(`shut${i}`), attrs: fold() });
    if (x.t === 'working') { const now = thinkNow(x); return R.thinkingRow({ step: now.step, secs: now.secs, phase: now.phase, attrs: { 'data-think-at': String(x.at || Date.now()) } }); }
    if (x.t === 'files') return R.turnRow({ mark: R.gitMark({ status: 'open' }), text: `<b>${esc(x.text)}</b> ${esc(x.meta)}`, end: R.button({ label: 'View', kind: 'quiet', attrs: { 'data-say': 'Opens the changes' } }) });
    if (x.t === 'code') return `<div class="convo-code"><p>${esc(x.file)}</p><pre>${esc(x.text)}</pre></div>`;
    const t = taskOf(x.task); if (!t && x.t !== 'question') return '';
    if (x.t === 'schedule') return openCard(x, t);
    if (x.t === 'question') {
      if (x.answered) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.text)}</b> ${esc(x.answered)}` });
      return `<div data-anchor="${x.id}">${R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', stage: -1, size: 16 }), text: `<b>${esc(x.text)}</b>` })}<div class="convo-answer">${R.optionList({ label: x.text, options: x.options, selected: x.pick, recommended: 0, optAttrs: (n) => ({ 'data-answer': `${i}|${n}` }), own: `${R.field({ id: `own-${x.id}`, label: 'Your own answer', quietLabel: true, placeholder: 'Or write your own answer', attrs: { 'data-own': String(i) } })}<div class="convo-answer-go">${R.button({ label: 'Answer', attrs: { 'data-answer-go': String(i) } })}${x.many ? R.button({ label: 'Use Worca’s picks', kind: 'quiet', attrs: { 'data-answer-picks': String(i), title: 'Takes Worca’s pick for this and the next question' } }) : ''}</div>` })}</div></div>`;
    }
    const st = stOf(t), tone = R.markTone(st), word = tone === 'ask' ? 'Asks you below' : st.word;
    if (tone === 'wait' && !x.open) return openCard(x, t);   // one line until opened in place
    // Its one action and ⋯ are its state's own, as on its page; a question is answered under the card.
    const main = tone === 'ask' || !st.action ? '' : R.button({ label: st.action.label, kind: st.action.primary ? 'primary' : '', attrs: { 'data-card-act': t.id, title: tone === 'run' || tone === 'pause' ? null : 'Opens the task, where this happens' } });
    const more = cardMore(t, [...(st.action?.items || []).filter((w) => typeof w === 'string'), { id: 'open', text: 'Open its page', help: 'The task page, while the card does not hold everything yet' }]);
    const confirm = t.confirm ? R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: `<b>${esc(t.confirm.label)}?</b> ${esc(t.confirm.text)}`, end: R.button({ label: t.confirm.label, kind: /discard|delete|stop|remove/i.test(t.confirm.label) ? 'quiet' : 'primary', cls: /discard|delete|stop|remove/i.test(t.confirm.label) ? 'is-danger' : '', attrs: { 'data-card-yes': t.id } }) + R.button({ label: 'Cancel', kind: 'quiet', attrs: { 'data-card-no': t.id } }) }) : '';
    return R.taskCard({ title: t.title, place: `<span class="rc-mid"><span class="rc-mid-a">${esc(t.branch || '')}</span></span><span>into dev</span>${gitOf(t)}`, mark: taskMark(t), word, detail: t.detail || '', action: main, menu: more, stages: R.stageBar({ labels: STAGES, stage: t.stage, tone }), foot: R.button({ label: x.open ? 'Hide its stages' : 'Show its stages', kind: 'quiet', icon: R.icon(x.open ? 'chevron' : 'chevR', 12), attrs: { 'data-open-task': t.id, 'aria-expanded': String(!!x.open), title: x.open ? 'Folds its stages' : 'Opens its stages here, as its page has them' } }), open: !!x.open, stream: `<div class="tc-run-slot" data-run-slot="${esc(t.case)}"></div>`, attrs: { 'data-anchor': x.id } }) + confirm;
  }

  // ---- the timeline: what is worth finding, where it really is ----
  function ticks() {
    const box = root.querySelector('.convo-scroll'); if (!box) return [];
    const H = box.scrollHeight || 1, list = turns();
    return [...root.querySelectorAll('[data-anchor]')].filter((e) => e.dataset.anchor).map((e) => {
      const x = list.find((y) => y.id === e.dataset.anchor), t = x?.task ? taskOf(x.task) : null;
      const kind = x?.t === 'you' ? 'you' : 'work';
      const tone = x?.t === 'question' ? 'ask' : x?.t === 'fail' ? 'fail' : t && t.kind !== 'schedule' ? R.markTone(stOf(t)) : '';
      const title = x?.t === 'you' ? x.text : x?.t === 'question' ? x.text : x?.t === 'fail' ? x.cmd : t?.title || '';
      const line = x?.t === 'you' ? `You · ${x.when || ''}` : x?.t === 'question' ? `Waiting for you · ${x.when || ''}` : x?.t === 'fail' ? `Failed · ${x.when || ''}` : t?.detail || '';
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
  function goTo(id) { const el = root.querySelector(`[data-anchor="${CSS.escape(id)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); R.land?.(el); } hover = null; menu = ''; paintTimeline(); }

  // ---- the page ----
  function paint(keepText = true) {
    window.RailShell?.unembedRun?.(root);   // the task page lent to an open card goes home before the chat redraws
    paintOnly(keepText);
    const slot = root.querySelector('[data-run-slot]');
    if (slot) window.RailShell?.embedRun?.(slot, slot.dataset.runSlot);   // and comes back into the card that is open
  }
  function paintOnly(keepText = true) {
    const had = root.querySelector('[data-composer-t]'), caret = had && document.activeElement === had, y = root.querySelector('.convo-scroll')?.scrollTop;
    if (had && keepText) comp.text = had.value;
    const c = chat();
    if (!chatId || !c) {
      root.innerHTML = side ? `<div class="chat-home"><div class="chat-home-in">${composerHtml()}</div></div>` : `<div class="chat-home" data-home><div class="chat-home-in"><h1>${esc(opts.title || 'What\'s next for Worca?')}</h1>${composerHtml()}${opts.mode ? '' : startersHtml()}${opts.note ? `<p class="convo-dock-note">${esc(opts.note)}</p>` : ''}</div></div>`;
    } else {
      const labels = (c.labels || []).map((l) => R.chip({ text: l })).join('');
      root.innerHTML = `<div class="convo"><div class="convo-scroll"><div class="convo-col"><div class="convo-head">${esc(c.project || 'No project')}${labels ? ` · ${labels}` : ''}${R.sentencePicker({ id: 'cl-label', text: '+ Label', tip: 'Adds or removes a label', items: ['hotfix', 'billing', 'infra', 'release'].map((l) => ({ id: l, text: l, checked: (c.labels || []).includes(l) })), open: menu === 'cl-label', chevron: '' })}<span class="tl-list-btn rc-pop" data-anchor-menu>${R.button({ label: 'Move through this chat', kind: 'quiet', iconOnly: true, icon: R.icon('list', 15), attrs: { 'data-anchor-open': '', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'anchors') } })}</span></div>${calmCards(turns())}</div></div><div data-timeline></div><div class="convo-dock">${composerHtml()}</div></div>`;
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
    const title = text.replace(/[?.!]+$/, '').slice(0, 48) || 'A new task';
    const proposal = (o) => ({ t: 'proposal', id: `p${n}`, title: title.charAt(0).toUpperCase() + title.slice(1), why: `From this chat: ${text}`, project: comp.project, workflow: 'Default', engine: comp.engine, then: 'open a PR', open: false, nudge: false, ...o });
    if (intent === 'task') return [{ t: 'words', html: 'Here is the task. Check it, then start it:' }, proposal({ nudge: /\b(or|which|should|whether)\b|\?/i.test(text) })];
    if (intent.startsWith('pin:')) return [{ t: 'words', html: `A ${esc(intent.slice(4))} task. Check it, then start it:` }, proposal({ workflow: intent.slice(4), persp: ['Product', 'Security'] })];
    if (intent === 'schedule') return [{ t: 'words', html: 'Here it is, scheduled. Change when, then schedule it:' }, proposal({ when: 'tonight at 02:00' })];
    if (intent === 'workflow') return [{ t: 'think', text: 'Thought for 9s' }, { t: 'change', id: `w${n}`, kind: 'Workflow', title: title || 'New workflow', why: 'Proposed workflow · round 1: plan, build behind review, then a PR. Model and effort come from your defaults.', graph: true, apply: 'Save', state: 'proposed' }];
    if (intent === 'explain') return [{ t: 'words', html: `What changed in <b>${esc(text || 'Add CSV export')}</b>: the export now streams rows, and the date column is ISO 8601. Five files, +358 −144:` }, { t: 'filesgrid', label: 'The diff', files: [{ name: 'export.mjs', meta: '+182 −64' }, { name: 'columns.mjs', meta: '+41 −58' }, { name: 'export.test.mjs', meta: '+96 −0' }] }];
    if (intent === 'script') return [{ t: 'change', id: `s${n}`, kind: 'Script', title: title || 'New script', why: 'A new script, tested before it is saved.', rows: [{ name: 'Runtime', before: '', after: 'Shell' }, { name: 'Inputs', before: '', after: 'a branch name' }, { name: 'Outputs', before: '', after: 'release notes, Markdown' }, { name: 'Program', before: '', after: '3 test cases' }], apply: 'Save', state: 'proposed' }, { t: 'act', id: `sa${n}`, mark: 'ask', text: `<b>Run ${esc((title || 'the script').toLowerCase().replace(/[^a-z0-9]+/g, '-'))}.sh?</b> It runs in the sandbox; it reads git and writes nothing`, actions: [['Run', 'primary', 'Done, exit 0'], ['Don’t run', 'quiet', 'Not run']] }];
    if (intent === 'project') return [{ t: 'change', id: `j${n}`, kind: 'Project', title: 'Add a project', why: text || 'A folder on this machine', rows: [{ name: 'Name', before: '', after: 'billing-web' }, { name: 'Folder', before: '', after: '~/src/billing-web' }, { name: 'Kind', before: '', after: 'Folder, with git' }], apply: 'Add', state: 'proposed' }];
    if (intent === 'away') return [{ t: 'change', id: `a${n}`, kind: 'Away mode', title: 'Away mode on', rows: [{ name: 'Away mode', before: 'Off', after: 'On now' }], state: 'applied' }];
    if (intent === 'metrics') return [{ t: 'words', html: 'Last 7 days: 42 tasks, 31 merged, 4 failed; $412 spent, most on Review. Billing-api is busiest.' }];
    if (intent === 'model') return [{ t: 'change', id: `m${n}`, kind: 'Model', title: 'Add a model', why: text || 'A model for Review', rows: [{ name: 'Provider', before: '', after: 'Anthropic' }, { name: 'Model', before: '', after: 'Sonnet 5.5' }, { name: 'Used for', before: '', after: 'Review' }], apply: 'Add', state: 'proposed' }];
    if (intent === 'workspace') return [{ t: 'change', id: `k${n}`, kind: 'Workspace', title: 'Create a workspace', why: text || 'Projects that ship together', rows: [{ name: 'Workspace', before: '', after: 'Billing' }, { name: 'Members', before: '', after: 'billing-api, billing-web' }], apply: 'Create', state: 'proposed' }];
    if (intent === 'remember') return [{ t: 'notice', text: `Remembered: ${text || 'that'}` }, { t: 'words', html: 'I’ll keep it in this project’s memory.' }];
    if (intent === 'find') return [{ t: 'words', html: 'Three tickets in Jira match; the first fits best:' }, proposal({ title: 'Export totals are off by a cent', ticket: 'BILL-412' })];
    return null;
  }
  // An ask that sounds like work brings a proposed task, in the composer's own words; one with open decisions offers the Shaper.
  function replyFor(text, n, intent = '') {
    const flow = intent && flowFor(intent, text, n); if (flow) return flow;
    if (!/\b(add|fix|build|make|implement|create|change|update|remove|rename|migrate)\b/i.test(text)) return [{ t: 'words', html: 'Here is what I found. Tell me if you want it built.' }];
    const core = text.replace(/^(can you|could you|please|let's)\s+/i, '').split(/,?\s+(?:or|and should|should it)\b|[?.!]/i)[0].trim();
    const title = core.length <= 48 ? core : core.slice(0, 48).replace(/\s+\S*$/, '');   // a clause, cut at a word
    return [{ t: 'words', html: 'I can do this as a task. Check it, then start it:' },
      { t: 'proposal', id: `p${n}`, title: title.charAt(0).toUpperCase() + title.slice(1), why: `From this chat: ${text.length > 70 ? `${text.slice(0, 70)}…` : text}`, project: comp.project, workflow: 'Default', engine: comp.engine, then: 'open a PR', open: false, nudge: /\b(or|which|should|whether)\b|\?/i.test(text) }];
  }
  function send() {
    const had = root.querySelector('[data-composer-t]'); const text = (had?.value || comp.text).trim();
    if (comp.busy && text) { comp.queue = [...(comp.queue || []), text]; comp.text = ''; if (had) had.value = ''; paint(false); say('Queued: it goes when this reply is done'); return; }   // while Worca replies, sending queues
    if (!text) { had?.focus(); say(comp.mode === 'ask' ? 'Write something first' : 'Say what it should do first'); return; }
    const c = ensureChat(text);
    if (!threads.has(c.id)) threads.set(c.id, M.thread(c));
    const list = threads.get(c.id), n = Date.now().toString(36);
    const intent = comp.intent || '';
    list.push({ t: 'you', id: `y${n}`, text, when: 'now', refs: comp.refs || [] });
    if (comp.mode === 'task') {   // one way to start a task: the proposal, checked, then Start
      list.push({ t: 'words', html: 'Here it is. Check it, then start it:' }, { t: 'proposal', id: `p${n}`, title: (text.charAt(0).toUpperCase() + text.slice(1)).slice(0, 48), why: `From this chat: ${text}`, project: comp.project, workflow: comp.workflow, engine: comp.engine, effort: comp.effort, then: comp.then, when: comp.startAt ? `at ${comp.startAt}` : 'now', preset: comp.preset, files: comp.files, open: false, nudge: false });
    } else if (false) {
      const t = { id: `t${n}`, title: text.slice(0, 40), case: 'working', stage: 0, git: 'branch', branch: `feat/${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`, detail: `Plan · step 1 of 2 · ${comp.workflow} on ${comp.engine}` };
      if (comp.startAt) { t.case = 'scheduled'; t.detail = `Starts at ${comp.startAt}`; t.git = ''; }
      c.tasks = [...(c.tasks || []), t]; c.state = 'following';
      list.push({ t: 'words', html: `I'll start a task on <b>${esc(comp.project)}</b>: ${esc(comp.workflow)} on ${esc(comp.engine)}, then ${esc(comp.then)}.` }, { t: 'task', id: `k${n}`, task: t.id });
      say(comp.startAt ? `Starts at ${comp.startAt}` : 'Task started');
    } else if (comp.mode === 'schedule') {
      const s = { id: `s${n}`, kind: 'schedule', title: text.slice(0, 40), detail: `Runs ${comp.every} at ${comp.at}`, time: comp.at };
      c.tasks = [...(c.tasks || []), s];
      list.push({ t: 'schedule', id: `k${n}`, task: s.id });
      say(`Scheduled ${comp.every} at ${comp.at}`);
    } else {
      list.push({ t: 'working', at: Date.now(), steps: THINKING }); comp.busy = true; c.state = 'replying';
      root.dispatchEvent(new CustomEvent('rail:replying', { bubbles: true, detail: { busy: true } }));   // Ask worca's icon writes while it does
      clearTimeout(timer);
      timer = setTimeout(() => { const i = list.findIndex((x) => x.t === 'working'); if (i >= 0) list.splice(i, 1, { t: 'think', text: `Thought for ${thinkNow(list[i]).secs}`, steps: THOUGHT.slice(0, thinkNow(list[i]).n) }, ...replyFor(text, n, intent)); comp.busy = false; c.state = 'idle'; root.dispatchEvent(new CustomEvent('rail:replying', { bubbles: true, detail: { busy: false } })); if ((comp.queue || []).length) { const next = comp.queue.shift(); setTimeout(() => { comp.text = next; send(); }, 300); } window.RailChats.refresh(); paint(); }, 1400);
    }
    comp = { ...comp, text: '', startAt: '', more: false, files: [], intent: '', refs: [], mode: opts.mode || 'ask' };
    if (had) had.value = '';
    window.RailChats.refresh();
    if (opts.where && !side) { chatId = ''; comp = fresh(opts.mode); window.RailShell.go(`chat/${c.id}`); return; }
    if (!side && location.hash !== `#chat/${c.id}`) { window.RailShell.go(`chat/${c.id}`); return; }
    paint(false);
    const box = root.querySelector('.convo-scroll'); if (box) box.scrollTop = box.scrollHeight;
    paintTimeline();
  }

  // ---- what a click or a key means here ----
  function pickMenu(id, v) {
    if (id.startsWith('chg:')) { menu = ''; const x = turns().find((y) => y.id === id.slice(4)); if (x && v === 'Not now') x.done = 'Not now'; if (x && /^Delete/.test(v)) x.done = 'Deleted'; if (v === 'Ask about it') { const t = root.querySelector('[data-composer-t]'); if (t) { t.value = `About ${x?.title || 'this'}: `; comp.text = t.value; t.focus(); } } paint(); return; }
    if (id.startsWith('cmd:')) { menu = ''; paint(); say(v === 'Show in terminal' ? 'Opens it in the terminal' : v === 'Show all' ? 'Shows every line' : `${v.replace('Copy ', 'Copied the ')}`); return; }
    if (/^(plan|split|feat|slice):/.test(id)) { menu = ''; const [, tid, n] = id.split(':'), x = turns().find((y) => y.id === tid);
      if (x && id.startsWith('slice:')) { if (v === 'Remove') x.slices.splice(+n, 1); if (v === 'Merge with next' && x.slices[+n + 1]) { x.slices[+n].title += ` + ${x.slices[+n + 1].title}`; x.slices.splice(+n + 1, 1); } }
      if (x && v.includes('before each run')) x.askEach = !x.askEach;
      if (x && v === 'Plan it as one') { x.slices = [{ title: x.title, detail: 'one run', case: 'scheduled', stage: -1 }]; }
      paint(); say(v); return; }
    if (id.startsWith('ppalt-')) { const x = turns().find((y) => y.id === id.slice(6)); menu = ''; if (x && v === 'shape') { x.workflow = 'Shaper'; say('Shaper will ask first'); } if (x && v === 'asis') { x.nudge = false; say('Runs as is'); } paint(); return; }
    if (id.startsWith('shiphow-')) { const x = turns().find((y) => y.id === id.slice(8)); if (x) x.how = v; menu = ''; paint(); return; }
    if (id.startsWith('cpch-')) { const x = turns().find((y) => y.id === id.slice(5)); if (x) x.picked = v; menu = ''; paint(); return; }
    const sm = /^ship-(.+)-(\d+)$/.exec(id); if (sm) { const x = turns().find((y) => y.id === sm[1]); if (x) x.reqs[+sm[2]].v = v; menu = ''; paint(); return; }
    if (id === 'cp-at') { const [cs, title] = v.split('|'); comp.refs = [...(comp.refs || []), { case: cs, title }]; comp.text = comp.text.replace(/@[^@\s]*$/, `@${title} `); menu = ''; paint(false); root.querySelector('[data-composer-t]')?.focus(); return; }
    if (id === 'cp-voice') { comp.handsFree = !comp.handsFree; menu = ''; paint(); say(comp.handsFree ? 'Hands-free: listening' : 'Hands-free off'); return; }
    if (id === 'starter-more') { const [k, ...rest] = v.split('|'); pickMenu(k, rest.join('|')); return; }   // More's items carry its id first
    if (id === 'starter') { arm(v); return; }
    if (id === 'starter-preset') { comp = { ...comp, intent: '', mode: 'task', preset: v, more: true }; menu = ''; paint(); root.querySelector('[data-composer-t]')?.focus(); say(`Preset ${v}: check it, then start`); return; }
    if (id === 'starter-pin') { pins = [...pins, v]; menu = ''; paint(); say(`Pinned ${v}`); return; }
    if (id === 'starter-unpin') { pins = pins.filter((w) => w !== v); menu = ''; paint(); say(`Unpinned ${v}`); return; }
    if (id === 'starter-track') { const [cs, title] = v.split('|'); menu = ''; window.RailShell.openTask(cs, '', title); return; }
    const pv = /^pv-(.+)$/.exec(id); if (pv) { const x = turns().find((y) => y.id === pv[1]); if (x) x.v = +v; menu = ''; paint(); return; }
    const pm = /^pp-(.+?)-(project|workflow|engine|effort|when|then|target|src|base|guard|labels|memory|asks|(model|eff|sub|fan)(Plan|Build|Review))$/.exec(id);
    if (pm) { const x = turns().find((y) => y.id === pm[1]); if (x) { if (pm[3]) { x.agents = x.agents || {}; const g = (x.agents[pm[4]] = x.agents[pm[4]] || {}); g[{ model: 'model', eff: 'effort', sub: 'sub', fan: 'fan' }[pm[3]]] = v; } else x[pm[2]] = v; } menu = ''; paint(); return; }
    if (id === 'cl-label') { const c = chat(); c.labels = (c.labels || []).includes(v) ? c.labels.filter((l) => l !== v) : [...(c.labels || []), v]; window.RailChats.refresh(); menu = ''; refreshAll(); return; }
    if (id === 'cp-mode') { comp.mode = v.toLowerCase(); if (comp.mode !== 'task') comp.more = false; }
    else if (id === 'cp-plus') {
      if (v === 'Reuse') comp.text = 'Add a CSV export to the billing page';
      else if (v === 'Shape') { comp.mode = 'task'; comp.workflow = 'Shaper'; say('Worca will ask first, then write the requirements'); }
      else if (v === 'Files') comp.files = [...new Set([...comp.files, 'notes.md'])];
      else if (v === 'md') comp.files = [...new Set([...comp.files, 'Markdown'])];
      else if (v === 'Ticket') { comp.files = [...new Set([...comp.files, 'SHOP-124'])]; comp.text = 'Export button does nothing on Safari'; comp.mode = 'task'; }
    } else if (id === 'cp-preset') { comp.preset = v === 'No preset' ? '' : v; if (v === 'Hotfix') { comp.workflow = 'Lean'; comp.then = 'open a PR'; comp.mode = 'task'; } if (v === 'Docs only') comp.workflow = 'Lean'; }
    else comp[id.slice(3)] = v;
    menu = '';
    paint();
  }
  root.addEventListener('click', (e) => {
    if (e.target.closest('#card')) return;   // inside an open card's stages: the task page answers its own clicks
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-tick]'))) { goTo(hit.dataset.tick); return; }
    if ((hit = on('[data-menu-pick]'))) { const [id, ...r] = hit.dataset.menuPick.split('|'); if (id === 'tick') goTo(r.join('|')); else if (id.startsWith('card:')) { menu = ''; const t = taskOf(id.slice(5)), label = r.join('|'); if (t) { if (label === 'open' || !label) window.RailShell.openTaskPage(t.case, chatId, t.title); else cardAct(t, label); } } else pickMenu(id, r.join('|')); return; }
    if ((hit = on('[data-card-act]'))) { const t = taskOf(hit.dataset.cardAct), tone = R.markTone(stOf(t)); if (tone === 'run') { t.was = t.case; t.wasDetail = t.detail; t.case = 'paused-you'; t.detail = 'Paused by you'; say('Paused'); } else if (tone === 'pause' && t.was) { t.case = t.was; t.detail = t.wasDetail; say('Resumed'); } else { cardAct(t, stOf(t).action?.label || ''); return; } window.RailChats.refresh(); refreshAll(); return; }
    if ((hit = on('[data-card-yes], [data-card-no]'))) { const t = taskOf(hit.dataset.cardYes || hit.dataset.cardNo); if (t) { const c = t.confirm; t.confirm = null; if (hit.dataset.cardYes && c) doAct(t, c.label, c.flow); else paint(); } return; }
    if ((hit = on('[data-cp-unfile]'))) { e.preventDefault(); comp.files = comp.files.filter((f) => f !== hit.dataset.cpUnfile); paint(); return; }
    if ((hit = on('[data-menu]'))) { e.preventDefault(); menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paint(); return; }
    if (on('[data-anchor-open]')) { menu = menu === 'anchors' ? '' : 'anchors'; paint(); return; }
    if (on('[data-cp-send]')) { e.preventDefault(); send(); return; }
    if (on('[data-cp-stop]')) { e.preventDefault(); clearTimeout(timer); const c = chat(), l = turns(), i = l.findIndex((x) => x.t === 'working'); if (i >= 0) l.splice(i, 1, { t: 'words', html: 'Stopped.' }); comp.busy = false; if (c) c.state = 'idle'; window.RailChats.refresh(); paint(); return; }
    if (on('[data-cp-more]')) { e.preventDefault(); comp.more = !comp.more; paint(); return; }
    if (on('[data-cp-mic]')) { e.preventDefault(); say('Listening…'); return; }
    if ((hit = on('[data-cp-use]'))) { e.preventDefault(); comp.engine = hit.dataset.cpUse; comp.startAt = ''; paint(); return; }
    if ((hit = on('[data-cp-at]'))) { e.preventDefault(); comp.startAt = hit.dataset.cpAt; paint(); return; }
    if (on('[data-plan-roles]')) { const x = turns().find((y) => y.id === on('[data-plan-roles]').dataset.planRoles); if (x) { x.open = !x.open; paint(); } return; }
    if ((hit = on('[data-turn-toggle]'))) { const i = hit.closest('[data-fold-turn]').dataset.foldTurn, x = turns()[+i]; if (x.t === 'fail') { const k = `shut${i}`; if (opened.has(k)) opened.delete(k); else opened.add(k); } else { const n = +i; if (opened.has(n)) opened.delete(n); else opened.add(n); } paint(); return; }
    if ((hit = on('[data-answer]'))) { const [i, n] = hit.dataset.answer.split('|'); turns()[+i].pick = +n; paint(); return; }
    if ((hit = on('[data-answer-picks]'))) { const l = turns(), x = l[+hit.dataset.answerPicks]; for (const y of [x, l.find((z) => z.id === x.many)]) if (y && !y.answered) y.answered = y.options[y.pick]; afterClarify(); paint(); say('Took Worca’s picks'); return; }
    if ((hit = on('[data-answer-go]'))) {
      const x = turns()[+hit.dataset.answerGo], t = taskOf(x.task), c = chat();
      const own = root.querySelector(`[data-own="${hit.dataset.answerGo}"]`)?.value.trim(); if (own) { x.options = [...x.options, own]; x.pick = x.options.length - 1; }
      if (!t) { x.answered = x.options[x.pick]; afterClarify(); paint(); say('Answered'); return; }   // a question of the chat itself, not of a task
      x.answered = x.options[x.pick]; t.case = 'working'; t.detail = 'Review · step 3 of 3'; c.state = 'following'; window.RailChats.refresh(); paint(); say('Answered: the task carries on'); return;
    }
    if (on('[data-cp-queue]')) { const t = root.querySelector('[data-composer-t]'); comp.queue = [...(comp.queue || []), (t?.value || comp.text).trim()]; comp.text = ''; paint(); say('Queued: it goes when this reply is done'); return; }
    if ((hit = on('[data-q-edit]'))) { const k = +hit.dataset.qEdit; comp.text = comp.queue[k]; comp.queue.splice(k, 1); paint(); root.querySelector('[data-composer-t]')?.focus(); return; }
    if ((hit = on('[data-q-drop]'))) { comp.queue.splice(+hit.dataset.qDrop, 1); paint(); return; }
    if ((hit = on('[data-starter]'))) { const id = hit.dataset.starter; if (id === 'track') { menu = menu === 'starter-track' ? '' : 'starter-track'; paint(); } else arm(id); return; }
    if (on('[data-intent-clear]')) { comp.intent = ''; paint(); root.querySelector('[data-composer-t]')?.focus(); return; }
    const pp = (attr) => { const h = on(`[${attr}]`); return h ? turns().find((y) => y.id === h.getAttribute(attr)) : null; };
    let px;
    if ((hit = on('[data-gate]'))) { const [id, k] = hit.dataset.gate.split('|'), x = turns().find((y) => y.id === id); if (x) { x.done = x.actions[+k][2]; paint(); say(x.done); } return; }
    if ((px = pp('data-ship'))) { px.done = `Opened PR #1107 into dev · ${px.how || 'As one PR'}`; paint(); say('Created the PR'); return; }
    if ((px = pp('data-ship-later'))) { px.done = 'Not shipped yet: ship it from here'; paint(); return; }
    if ((hit = on('[data-ship-how]'))) { const [id, v] = hit.dataset.shipHow.split('|'), x = turns().find((y) => y.id === id); if (x) { x.how = v; paint(); } return; }
    if ((px = pp('data-split-ok'))) { px.split = false; paint(); say(`Approved ${px.slices.length} runs: the first starts`); return; }
    if ((hit = on('[data-feat]'))) { const [id, a] = hit.dataset.feat.split('|'), x = turns().find((y) => y.id === id); if (x) { if (a === 'pause' || a === 'stop') x.halted = true; if (a === 'resume') x.halted = false; paint(); say({ pause: 'Pausing…', stop: 'Stopped after the running slice', resume: 'Resumed', replan: 'Re-planning the rest' }[a]); } return; }
    if ((px = pp('data-plan-roles'))) { px.open = !px.open; paint(); return; }
    if ((px = pp('data-plan-approve'))) { px.approved = true; const l = turns(), i = l.indexOf(px); l.splice(i + 1, 0, { t: 'feature', id: `f${Date.now().toString(36)}`, title: px.title, slices: [{ title: 'Columns and order', case: 'working', stage: 1, detail: 'Build · step 1 of 2' }, { title: 'Dates and money', case: 'scheduled', stage: -1, detail: 'After the columns' }] }); paint(); say('Approved: the plan is being built'); return; }
    if ((px = pp('data-plan-changes'))) { px.asking = true; paint(); root.querySelector(`[data-ask-changes="${px.id}"]`)?.focus(); return; }
    if ((px = pp('data-changes-cancel'))) { px.asking = false; paint(); return; }
    if ((px = pp('data-changes-send'))) { const v = root.querySelector(`[data-ask-changes="${px.id}"]`)?.value.trim(); if (!v) { say('Say what should change first'); return; } px.asking = false; const l = turns(); l.splice(l.indexOf(px) + 1, 0, { t: 'change', id: `cg${Date.now().toString(36)}`, kind: 'Changes', title: px.title, why: `“${v}”`, rows: [{ name: 'Where it lands', before: '', after: 'a new round of the plan' }], actions: [['Start round 2', 'primary', 'Round 2 started'], ['Not now', 'quiet', 'Not now']], state: 'proposed' }); paint(); say('Asked for changes'); return; }
    if ((hit = on('[data-cmd-stop]'))) { const x = turns()[+hit.dataset.cmdStop]; if (x) { x.stopped = true; paint(); say('Stopped the command'); } return; }
    if ((hit = on('[data-cp-act]'))) { const [id, k] = hit.dataset.cpAct.split('|'), x = turns().find((y) => y.id === id); if (x) { x.done = x.actions[+k][2] + (x.choice ? ` · ${x.picked || x.choice.rec}` : ''); paint(); say(x.done); } return; }
    if ((hit = on('[data-cp-choice]'))) { const [id, v] = hit.dataset.cpChoice.split('|'), x = turns().find((y) => y.id === id); if (x) { x.picked = v; paint(); } return; }
    if ((hit = on('[data-act]'))) { const [id, k] = hit.dataset.act.split('|'), x = turns().find((y) => y.id === id); if (x) { x.done = x.actions[+k][2]; paint(); say(x.done); } return; }
    if ((hit = on('[data-cp-apply], [data-cp-decline], [data-cp-revert]'))) { const id = hit.dataset.cpApply || hit.dataset.cpDecline || hit.dataset.cpRevert, x = turns().find((y) => y.id === id); if (x) { x.state = hit.dataset.cpApply ? 'applied' : hit.dataset.cpRevert ? 'proposed' : 'declined'; if (x.state === 'applied' && x.graph) x.rows = [{ name: 'Saved as', before: '', after: 'API rewrite' }]; paint(); say(x.state === 'applied' ? `${x.kind}: changed` : x.state === 'declined' ? 'Nothing changed' : 'Reverted'); } return; }
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
      const t = { id: `t${n}`, title: px.title, case: 'working', stage: 0, git: 'branch', branch: `feat/${px.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`, detail: `Plan · step 1 of 2 · ${px.workflow} on ${px.engine}` };
      if (px.when && px.when !== 'now') { t.case = 'scheduled'; t.stage = -1; t.git = ''; t.detail = `Starts ${px.when}`; }
      c.tasks = [...(c.tasks || []), t]; c.state = 'following';
      l.splice(i, 1, { t: 'task', id: px.id, task: t.id });
      if (px.workflow === 'Shaper' && t.case !== 'scheduled') { const k = Date.now().toString(36); l.splice(i + 1, 0, { t: 'words', html: 'A few questions before the plan:' }, { t: 'question', id: `q1${k}`, text: 'A · Which date format?', options: ['ISO 8601 (Worca’s pick)', 'The account’s locale'], pick: 0, many: `q2${k}`, shaper: px.id, when: 'now' }, { t: 'question', id: `q2${k}`, text: 'B · Which columns come first?', options: ['Date, number, total (Worca’s pick)', 'Customer first'], pick: 0, shaper: px.id, when: 'now' }); }
      window.RailChats.refresh(); paint(); say(t.case === 'scheduled' ? `Scheduled: starts ${px.when}` : px.workflow === 'Shaper' ? 'Planning started' : 'Task started'); return;
    }
    if ((hit = on('[data-open-task]'))) { const x = turns().find((y) => y.task === hit.dataset.openTask && (y.t === 'task' || y.t === 'schedule')); if (x) { const was = x.open; turns().forEach((y) => { y.open = false; }); x.open = !was; paint(); if (x.open) requestAnimationFrame(() => root.querySelector(`[data-anchor="${x.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })); } return; }   // How it ran opens the card in place, one at a time
    if ((hit = on('[data-open-sched]'))) { window.RailShell.go(`schedule/${hit.dataset.openSched}`); return; }   // its runs, by day
    if ((hit = on('[data-start-now]'))) { const t = taskOf(hit.dataset.startNow); if (t) { t.case = 'working'; t.stage = 0; t.detail = 'Plan · step 1 of 2'; window.RailChats.refresh(); paint(); say('Started now'); } return; }
    if ((hit = on('[data-cancel-task]'))) { const t = taskOf(hit.dataset.cancelTask); if (t) { t.cancelled = true; paint(); say('Cancelled'); } return; }
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
  root.addEventListener('input', (e) => { if (e.target.matches('[data-composer-t]')) { comp.text = e.target.value; size(e.target); const at = /@[^@\s]*$/.test(comp.text); if (at !== (menu === 'cp-at')) { menu = at ? 'cp-at' : ''; paint(); } } if (e.target.matches('[data-pp-brief]')) { const x = turns().find((y) => y.id === e.target.dataset.ppBrief); if (x) x.brief = e.target.value; } if (e.target.matches('[data-pp-feature]')) { const x = turns().find((y) => y.id === e.target.dataset.ppFeature); if (x) x.feature = e.target.value; } if (e.target.matches('[data-pp-title]')) { const x = turns().find((y) => y.id === e.target.dataset.ppTitle); if (x) x.title = e.target.value; } });
  root.addEventListener('keydown', (e) => { if (e.target.matches('[data-composer-t]') && e.key === 'Enter' && !e.shiftKey && comp.mode === 'ask') { e.preventDefault(); send(); } });
  document.addEventListener('keydown', (e) => {
    if (side || opts.where || (e.key !== '[' && e.key !== ']') || root.hidden || e.target.matches?.('input, textarea, select')) return;
    const list = ticks(); if (!list.length) return;
    const box = root.querySelector('.convo-scroll'), now = box.scrollTop / (box.scrollHeight || 1);
    const next = e.key === ']' ? list.find((t) => t.at > now + 0.01) : [...list].reverse().find((t) => t.at < now - 0.01);
    if (next) { e.preventDefault(); goTo(next.id); }
  });
  R.dismissOnOutside(document, { open: () => !!menu, inside: `${where} .spick, ${where} .rc-pop, ${where} [data-anchor-menu]`, back: () => null, close: () => { menu = ''; }, paint: () => paint() });

  const api = {
    paint,
    // Everything leads to its card in its chat: scroll to the card of a task (by its case or id) or a schedule, and flash it once
    focus: ({ cs = '', id = '' }) => {
      const x = turns().find((y) => (y.t === 'task' || y.t === 'schedule') && (y.task === id || (cs && taskOf(y.task)?.case === cs)));
      const el = x && root.querySelector(`[data-anchor="${x.id}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.classList.remove('is-flash'); void el.offsetWidth; el.classList.add('is-flash');
      return true;
    },
    show: (id) => { if (id !== chatId) { opened = new Set(); hover = null; menu = ''; comp = { ...fresh(), project: id ? data().chats.find((c) => c.id === id)?.project || 'billing-api' : 'billing-api' }; } chatId = id || ''; paint(); if (id) { const box = root.querySelector('.convo-scroll'); if (box) { box.scrollTop = 0; paintTimeline(); } } },
    start: (mode, text) => { chatId = ''; comp = { ...fresh(mode), text: text || '' }; if (!side) window.RailShell.go('chat'); paint(); root.querySelector('[data-composer-t]')?.focus(); },
  };
  mounted.push(api);
  paint();
  return api;
  }
  const refreshAll = () => mounted.forEach((m) => m.paint());

  // ---- a task's or a schedule's own page: its question goes to its chat, or starts one ----
  function dock(host, { kind, title, chat: linked }) {
    if (!host) return;
    const name = linked ? data().chats.find((c) => c.id === linked)?.title : '';
    host.innerHTML = `${R.composer({ placeholder: kind === 'schedule' ? 'Ask about this schedule, or change it…' : 'Ask about this task…', sentence: '', tools: '', send: R.button({ label: 'Send', kind: 'primary', iconOnly: true, icon: R.icon('up', 14), attrs: { 'data-dock-send': '', title: name ? `Goes to ${name}` : 'Starts a chat about it' } }), attrs: { 'data-dock': '' } })}<p class="convo-dock-note">${esc(name ? `Goes to ${name}` : `Starts a new chat about ${title}, and links it`)}</p>`;
    const go = () => {
      const t = host.querySelector('[data-composer-t]'), text = t.value.trim();
      if (!text) { t.focus(); return; }
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
  window.RailConversation = {
    show: main.show,
    focus: main.focus,
    start: main.start,
    mount: (el, opts) => (opts ? mount(el, false, opts) : mount(el, true)),
    refresh: refreshAll,
    dock,
    chatOfCase: (cs) => { const allOf = (x) => { const out = []; const walk = (y) => { out.push(y); (y.after || []).forEach(walk); }; (x.tasks || []).forEach(walk); return out; }; const c = data().chats.find((x) => allOf(x).some((t) => t.case === cs)); return c?.id || ''; },
    chatTitle: (id) => data().chats.find((x) => x.id === id)?.title || '',
  };
})();
