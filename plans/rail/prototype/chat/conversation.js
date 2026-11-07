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
    const mode = pk('mode', comp.mode === 'ask' ? 'Ask' : comp.mode === 'task' ? 'Task' : 'Schedule', MODES, 'Ask, start a task, or schedule one');
    const project = W('on') + pk('project', comp.project, PROJECTS, 'Which project');
    const engine = pk('engine', comp.engine, ENGINES, 'Which engine and model');
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
  function composerHtml() {
    const plus = `<span class="rc-pop">${R.button({ label: 'Add', kind: 'quiet', iconOnly: true, icon: R.icon('plus', 15), attrs: { 'data-menu': 'cp-plus', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'cp-plus') } })}${menu === 'cp-plus' ? R.compactMenu({ items: [{ id: 'cp-plus|Files', text: 'Files', help: 'Adds files for it to read' }, { id: 'cp-plus|md', text: 'Markdown or a .md file', help: 'Writes the task as Markdown' }, { id: 'cp-plus|Ticket', text: 'A ticket from a tracker', help: 'Starts from a ticket' }, { id: 'cp-plus|Reuse', text: 'Reuse last task', help: 'Fills in the words of your last task' }, { id: 'cp-plus|Shape', text: 'Shape it first', help: 'Worca asks and writes the requirements before it builds' }, { sep: true }, { header: 'Preset' }, ...['Hotfix', 'Docs only'].map((x) => ({ id: `cp-preset|${x}`, text: x, checked: comp.preset === x, help: 'Fills the sentence; Start says it is used' }))] }) : ''}</span>`;
    const words = comp.mode === 'schedule' ? 'Schedule' : comp.startAt ? `Start at ${comp.startAt}` : 'Start task';
    const send = comp.busy ? R.button({ label: 'Stop', kind: 'primary', iconOnly: true, icon: R.icon('stop', 14), attrs: { 'data-cp-stop': '', title: 'Stops the reply' } })
      : comp.mode === 'ask' ? R.button({ label: 'Send', kind: 'primary', iconOnly: true, icon: R.icon('up', 14), attrs: { 'data-cp-send': '', title: 'Sends it to Worca' } })
        : R.button({ label: words, kind: 'primary', attrs: { 'data-cp-send': '', title: comp.mode === 'schedule' ? 'Saves the schedule' : 'Starts the task now' } });
    return R.composer({ value: comp.text, placeholder: comp.mode === 'schedule' ? 'What should run each time?' : comp.mode === 'task' ? 'What should the task do?' : 'Ask Worca…', sentence: chipsHtml() + sentence(), detail: detail(), tools: plus, send: R.button({ label: 'Speak', kind: 'quiet', iconOnly: true, icon: R.icon('mic', 15), attrs: { 'data-cp-mic': '', title: 'Speak instead of typing' } }) + send, attrs: { 'data-composer': '' } });
  }

  // ---- a turn ----
  const taskMark = (t, size) => (t.kind === 'schedule' ? R.kindMark({ kind: 'schedule', size, title: t.detail }) : R.kindMark({ kind: 'task', tone: R.markTone(stOf(t)), stage: t.stage, size, title: `${stOf(t).word} · ${t.detail || ''}` }));
  const gitOf = (t) => (t.git ? R.gitMark({ status: t.git, watch: t.watch || '', title: t.watch ? `Watching · ${t.detail}` : `${t.branch || ''}` }) : '');
  const cardMore = (t, items) => R.moreMenu({ id: `card:${t.id}`, label: `More for ${t.title}`, icon: R.icon('more', 16), open: menu === `card:${t.id}`, items });
  const openCard = (x, t) => R.taskCard({ compact: true, title: t.title, mark: taskMark(t), word: t.title, detail: t.detail, action: R.button({ label: 'Open', kind: 'quiet', attrs: t.kind === 'schedule' ? { 'data-open-sched': t.id } : { 'data-open-task': t.id } }), attrs: { 'data-anchor': x.id } });
  function turnHtml(x, i) {
    const fold = () => ({ 'data-fold-turn': String(i), ...(x.id ? { 'data-anchor': x.id } : {}) });
    if (x.t === 'you') return `<div class="convo-you" data-anchor="${x.id || ''}">${esc(x.text)}</div>`;
    if (x.t === 'words') return `<p class="convo-words">${x.html}</p>`;
    if (x.t === 'think') return R.turnRow({ mark: R.icon('sparkle', 14), text: esc(x.text) });
    if (x.t === 'cmds') return R.turnRow({ mark: R.icon(opened.has(i) ? 'chevron' : 'chevR', 14), text: esc(x.text), end: x.end, body: esc(x.body), open: opened.has(i), attrs: fold() });
    if (x.t === 'fail') return R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'fail', size: 16 }), text: `<b>${esc(x.cmd)}</b> failed`, end: x.end, body: esc(x.body), open: !opened.has(`shut${i}`), attrs: fold() });
    if (x.t === 'working') return R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'run', size: 16 }), text: esc(x.text), end: x.end || '' });
    if (x.t === 'files') return R.turnRow({ mark: R.gitMark({ status: 'open' }), text: `<b>${esc(x.text)}</b> ${esc(x.meta)}`, end: R.button({ label: 'View', kind: 'quiet', attrs: { 'data-say': 'Opens the changes' } }) });
    if (x.t === 'code') return `<div class="convo-code"><p>${esc(x.file)}</p><pre>${esc(x.text)}</pre></div>`;
    const t = taskOf(x.task); if (!t) return '';
    if (x.t === 'schedule') return openCard(x, t);
    if (x.t === 'question') {
      if (x.answered) return R.turnRow({ mark: R.icon('check', 14), text: `<b>${esc(x.text)}</b> ${esc(x.answered)}` });
      return `<div data-anchor="${x.id}">${R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', stage: -1, size: 16 }), text: `<b>${esc(x.text)}</b>` })}<div class="convo-answer">${R.optionList({ label: x.text, options: x.options, selected: x.pick, recommended: 0, optAttrs: (n) => ({ 'data-answer': `${i}|${n}` }), own: `<div class="convo-answer-go">${R.button({ label: 'Answer', attrs: { 'data-answer-go': String(i) } })}</div>` })}</div></div>`;
    }
    const st = stOf(t), tone = R.markTone(st), word = tone === 'ask' ? 'Asks you below' : st.word;
    if (tone === 'wait') return openCard(x, t);
    // Its one action and ⋯ are its state's own, as on its page; a question is answered under the card.
    const main = tone === 'ask' || !st.action ? '' : R.button({ label: st.action.label, kind: st.action.primary ? 'primary' : '', attrs: { 'data-card-act': t.id, title: tone === 'run' || tone === 'pause' ? null : 'Opens the task, where this happens' } });
    const more = cardMore(t, [...(st.action?.items || []).filter((w) => typeof w === 'string'), { id: 'open', text: 'Open task', help: 'Opens its page' }]);
    return R.taskCard({ title: t.title, place: `<span class="rc-mid"><span class="rc-mid-a">${esc(t.branch || '')}</span></span><span>into dev</span>${gitOf(t)}`, mark: taskMark(t), word, detail: t.detail || '', action: main + more, stages: R.stageBar({ labels: STAGES, stage: t.stage, tone }), foot: R.button({ label: 'How it ran', kind: 'quiet', icon: R.icon('chevR', 12), attrs: { 'data-open-task': t.id, title: 'Opens this task' } }), attrs: { 'data-anchor': x.id } });
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
    const had = root.querySelector('[data-composer-t]'), caret = had && document.activeElement === had, y = root.querySelector('.convo-scroll')?.scrollTop;
    if (had && keepText) comp.text = had.value;
    const c = chat();
    if (!chatId || !c) {
      root.innerHTML = side ? `<div class="chat-home"><div class="chat-home-in">${composerHtml()}</div></div>` : `<div class="chat-home" data-home><div class="chat-home-bg"></div><div class="chat-home-in"><h1>${esc(opts.title || 'What\'s next for Worca?')}</h1>${composerHtml()}${opts.note ? `<p class="convo-dock-note">${esc(opts.note)}</p>` : ''}</div></div>`;
    } else {
      const labels = (c.labels || []).map((l) => R.chip({ text: l })).join('');
      root.innerHTML = `<div class="convo"><div class="convo-scroll"><div class="convo-col"><div class="convo-head">${esc(c.project || 'No project')}${labels ? ` · ${labels}` : ''}${R.sentencePicker({ id: 'cl-label', text: '+ Label', tip: 'Adds or removes a label', items: ['hotfix', 'billing', 'infra', 'release'].map((l) => ({ id: l, text: l, checked: (c.labels || []).includes(l) })), open: menu === 'cl-label', chevron: '' })}<span class="tl-list-btn rc-pop" data-anchor-menu>${R.button({ label: 'Move through this chat', kind: 'quiet', iconOnly: true, icon: R.icon('list', 15), attrs: { 'data-anchor-open': '', 'aria-haspopup': 'menu', 'aria-expanded': String(menu === 'anchors') } })}</span></div>${turns().map(turnHtml).join('')}</div></div><div data-timeline></div><div class="convo-dock">${composerHtml()}</div></div>`;
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
  function send() {
    const had = root.querySelector('[data-composer-t]'); const text = (had?.value || comp.text).trim();
    if (!text) { had?.focus(); say(comp.mode === 'ask' ? 'Write something first' : 'Say what it should do first'); return; }
    const c = ensureChat(text);
    if (!threads.has(c.id)) threads.set(c.id, M.thread(c));
    const list = threads.get(c.id), n = Date.now().toString(36);
    list.push({ t: 'you', id: `y${n}`, text, when: 'now' });
    if (comp.mode === 'task') {
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
      list.push({ t: 'working', text: 'Replying', end: '' }); comp.busy = true; c.state = 'replying';
      root.dispatchEvent(new CustomEvent('rail:replying', { bubbles: true, detail: { busy: true } }));   // Ask worca's icon writes while it does
      clearTimeout(timer);
      timer = setTimeout(() => { const i = list.findIndex((x) => x.t === 'working'); if (i >= 0) list.splice(i, 1, { t: 'words', html: 'Here is what I found. If you want this built, pick Task in the sentence below.' }); comp.busy = false; c.state = 'idle'; root.dispatchEvent(new CustomEvent('rail:replying', { bubbles: true, detail: { busy: false } })); window.RailChats.refresh(); paint(); }, 1400);
    }
    comp = { ...comp, text: '', startAt: '', more: false, files: [], mode: opts.mode || 'ask' };
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
    const on = (q) => e.target.closest(q); let hit;
    if ((hit = on('[data-tick]'))) { goTo(hit.dataset.tick); return; }
    if ((hit = on('[data-menu-pick]'))) { const [id, ...r] = hit.dataset.menuPick.split('|'); if (id === 'tick') goTo(r.join('|')); else if (id.startsWith('card:')) { menu = ''; const t = taskOf(id.slice(5)); if (t) window.RailShell.openTask(t.case, chatId, t.title); } else pickMenu(id, r.join('|')); return; }
    if ((hit = on('[data-card-act]'))) { const t = taskOf(hit.dataset.cardAct), tone = R.markTone(stOf(t)); if (tone === 'run') { t.was = t.case; t.wasDetail = t.detail; t.case = 'paused-you'; t.detail = 'Paused by you'; say('Paused'); } else if (tone === 'pause' && t.was) { t.case = t.was; t.detail = t.wasDetail; say('Resumed'); } else { window.RailShell.openTask(t.case, chatId, t.title); return; } window.RailChats.refresh(); refreshAll(); return; }
    if ((hit = on('[data-cp-unfile]'))) { e.preventDefault(); comp.files = comp.files.filter((f) => f !== hit.dataset.cpUnfile); paint(); return; }
    if ((hit = on('[data-menu]'))) { e.preventDefault(); menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; paint(); return; }
    if (on('[data-anchor-open]')) { menu = menu === 'anchors' ? '' : 'anchors'; paint(); return; }
    if (on('[data-cp-send]')) { e.preventDefault(); send(); return; }
    if (on('[data-cp-stop]')) { e.preventDefault(); clearTimeout(timer); const c = chat(), l = turns(), i = l.findIndex((x) => x.t === 'working'); if (i >= 0) l.splice(i, 1, { t: 'words', html: 'Stopped.' }); comp.busy = false; if (c) c.state = 'idle'; window.RailChats.refresh(); paint(); return; }
    if (on('[data-cp-more]')) { e.preventDefault(); comp.more = !comp.more; paint(); return; }
    if (on('[data-cp-mic]')) { e.preventDefault(); say('Listening…'); return; }
    if ((hit = on('[data-cp-use]'))) { e.preventDefault(); comp.engine = hit.dataset.cpUse; comp.startAt = ''; paint(); return; }
    if ((hit = on('[data-cp-at]'))) { e.preventDefault(); comp.startAt = hit.dataset.cpAt; paint(); return; }
    if ((hit = on('[data-turn-toggle]'))) { const i = hit.closest('[data-fold-turn]').dataset.foldTurn, x = turns()[+i]; if (x.t === 'fail') { const k = `shut${i}`; if (opened.has(k)) opened.delete(k); else opened.add(k); } else { const n = +i; if (opened.has(n)) opened.delete(n); else opened.add(n); } paint(); return; }
    if ((hit = on('[data-answer]'))) { const [i, n] = hit.dataset.answer.split('|'); turns()[+i].pick = +n; paint(); return; }
    if ((hit = on('[data-answer-go]'))) {
      const x = turns()[+hit.dataset.answerGo], t = taskOf(x.task), c = chat();
      x.answered = x.options[x.pick]; t.case = 'working'; t.detail = 'Review · step 3 of 3'; c.state = 'following'; window.RailChats.refresh(); paint(); say('Answered: the task carries on'); return;
    }
    if ((hit = on('[data-open-task]'))) { const t = taskOf(hit.dataset.openTask); if (t) window.RailShell.openTask(t.case, chatId, t.title); return; }
    if ((hit = on('[data-open-sched]'))) { window.RailShell.go(`schedule/s1`); return; }
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
  root.addEventListener('input', (e) => { if (e.target.matches('[data-composer-t]')) { comp.text = e.target.value; size(e.target); } });
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
  window.RailConversation = {
    show: main.show,
    start: main.start,
    mount: (el, opts) => (opts ? mount(el, false, opts) : mount(el, true)),
    refresh: refreshAll,
    dock,
    chatOfCase: (cs) => { const allOf = (x) => { const out = []; const walk = (y) => { out.push(y); (y.after || []).forEach(walk); }; (x.tasks || []).forEach(walk); return out; }; const c = data().chats.find((x) => allOf(x).some((t) => t.case === cs)); return c?.id || ''; },
    chatTitle: (id) => data().chats.find((x) => x.id === id)?.title || '',
  };
})();
