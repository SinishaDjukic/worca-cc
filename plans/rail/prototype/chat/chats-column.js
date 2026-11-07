// The Chats column (docs/rail/lists.md; plans/rail/agreed/chat-and-runs-decisions.md C1): beside the conversation, Needs
// you first, then Running, then Recent. The list is the library's (listController); the conversation is today's capture.
(function () {
  const R = window.RailUI, M = window.ChatsListModel;
  const bar = document.getElementById('bar-chat');
  if (!bar) return;
  const STORE_W = 'worca-rail.chats.width', STORE_V = 'worca-rail.chats.view';
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* a remembered choice is a nicety */ } };
  const clampW = (px) => Math.min(680, Math.max(360, Math.round(+px) || 360));
  const FRESH = { show: 'all', from: 'all', by: R.BY_DEFAULT, sort: 'activity' };
  const parse = (t) => { try { return JSON.parse(t) || {}; } catch { return {}; } };
  let view = { ...FRESH, ...parse(get(STORE_V)) }, data = M.seed(), width = clampW(get(STORE_W)), current = '', listCase = 'full', recent = [], ctl = null, opened = true;
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const usd = (n) => `$${n.toFixed(2)}`;
  const NEEDS = () => R.runState('question').word;
  const has = (need) => R.shows(need);
  const hint = (...k) => R.keyHint(k, R.isMac(window));
  // a chat whose task waits on you stays under Needs you, whatever the chat itself is doing (a member that needs you raises its group)
  // a task that waits on you (a question, a gate, a failure, a pause, a cap) lifts its chat, as it counts in Pulse
  const NEEDS_TONES = ['ask', 'act', 'fail', 'pause'];
  const asksInside = (c) => { const walk = (t) => (t.case && t.case !== 'scheduled' && NEEDS_TONES.includes(R.markTone(R.runState(window.RunCardModel.stateOf(t.case))))) || (t.after || []).some(walk); return (c.tasks || []).some(walk); };
  const sectionOfChat = (c) => (asksInside(c) ? 'needs' : R.chatState(c.state).section);
  const busyOf = (c) => R.chatState(c.state).busy || '';
  const toneOf = (state) => (state === 'needs-you' ? 'ask' : state === 'idle' ? 'idle' : 'run');
  const markOf = (state, kind) => R.kindMark({ kind: kind === 'workflow' && state === 'idle' ? 'workflow' : 'chat', tone: toneOf(state), title: state === 'idle' ? R.CHAT_KINDS[kind]?.label || 'Chat' : R.chatState(state).word });
  const RM = window.RunCardModel;
  const taskMenu = (t) => [{ id: 'open-task', text: t.kind === 'schedule' ? 'Open schedule' : 'Open task', help: 'Opens its card in its chat' }, { id: 'in-view', text: window.RailShell?.inView.has(t.kind === 'schedule' ? 'schedule' : 'task', t.id) ? 'Out of view' : 'Keep in view', help: 'Its live mark in the top bar, on every page' }, ...(t.git === 'open' || t.git === 'fail' ? [{ id: 'watch', text: t.watch ? 'Stop watching' : 'Watch', help: 'Worca follows the PR and fixes failing checks for you' }] : []), { id: 'label-task', text: 'Label…', hint: hint('L'), help: 'Adds a label to this task' }, ...(has('advanced') ? [{ id: 'add-to-group', text: 'Add to group…', hint: hint('G'), help: 'Find a group, or make a new one' }] : []), { sep: true }, { id: 'archive', text: 'Archive', hint: hint('E'), help: 'Undo in the notice' }];
  const KIND_OF = { feature: 'feature', workflow: 'workflow' };   // what a chat started: a Shaper task, a workflow run, else a plain task
  // What hangs under a chat: its tasks and schedules, in their order of waiting.
  const treeOf = (c, list) => list.filter((t) => !t.gone).map((t) => {   // a deleted schedule leaves the bar
    const x = { t, c, key: `task:${t.id}` };
    if (t.kind === 'schedule') return { key: x.key, _x: x, title: t.title, mark: R.kindMark({ kind: 'schedule', title: t.detail }), end: t.time, tip: `${t.title}\n${t.detail}\nOpens the schedule`, current: false, menu: taskMenu(t) };
    const st = R.runState(RM.stateOf(t.case));
    return { key: x.key, _x: x, title: t.title, mark: R.kindMark({ kind: KIND_OF[t.kind] || 'task', tone: R.markTone(st), stage: t.stage, title: `${st.word} · ${t.detail || ''}` }), endMark: t.git ? R.gitMark({ status: t.git, watch: t.watch || '', title: t.watch ? `Watching · ${t.detail}` : t.branch }) : '', end: t.git ? '' : t.endWord || '', tip: `${t.title}\n${st.word} · ${t.detail || ''}\nOpens the task`, tree: t.after ? treeOf(c, t.after) : undefined, menu: taskMenu(t) };
  });

  // ---- the view ----
  const SHOWS = [{ id: 'all', text: 'all', help: 'Every chat that is not archived', test: (c) => !c.archived }, { id: 'needs', text: NEEDS().toLowerCase(), title: NEEDS(), help: 'A run a chat follows asks you something', test: (c) => !c.archived && sectionOfChat(c) === 'needs' },
    { id: 'running', text: 'running', help: 'Replying, running a command or following a run', test: (c) => !c.archived && sectionOfChat(c) === 'running' }, { id: 'archived', text: 'archived', help: 'Chats you archived', test: (c) => c.archived }];
  const showOf = (id) => SHOWS.find((x) => x.id === id);
  const passes = (c, v) => showOf(v.show).test(c) && (v.from === 'all' || (c.project || 'No project') === v.from);
  const count = (p) => String(data.chats.filter((c) => passes(c, { ...view, ...p })).length);
  const KEYS = { activity: (a, b) => data.chats.indexOf(a) - data.chats.indexOf(b), created: (a, b) => data.chats.indexOf(b) - data.chats.indexOf(a), title: (a, b) => a.title.localeCompare(b.title), cost: (a, b) => (b.cost || 0) - (a.cost || 0) };
  const sorted = (list) => [...list.filter((c) => c.pinned).sort(KEYS[view.sort]), ...list.filter((c) => !c.pinned).sort(KEYS[view.sort])];

  // ---- rows ----
  function chatRow(c, member) {
    const st = R.chatState(c.state), x = { c, key: `chat:${c.id}` };
    const r = { key: x.key, _x: x, title: c.title, lead: c.origin ? R.originMark(c.origin) : '', mark: markOf(c.state, c.kind), unread: c.unread, current: current === c.id, tip: [c.title, [c.project || 'No project', ...(c.labels || [])].join(' · '), [st.line || (c.state === 'idle' ? R.CHAT_KINDS[c.kind]?.label : ''), c.time].filter(Boolean).join(' · '), c.pinned ? 'Pinned' : ''].filter(Boolean).join('\n'), end: c.time, tree: c.tasks?.length ? treeOf(c, c.tasks) : undefined,
      meta: '' };
    r.menu = [{ id: 'toggle', text: 'Select', hint: hint('Space') }, { id: 'in-view', text: window.RailShell?.inView.has('chat', c.id) ? 'Out of view' : 'Keep in view', help: 'Its live mark in the top bar, on every page' }, { id: 'rename', text: 'Rename…', hint: hint('R'), help: 'Give it another name' }, { id: 'pin', text: c.pinned ? 'Unpin' : 'Pin', hint: hint('P'), help: 'A pinned chat leads its section' },
      ...(has('advanced') ? [{ id: 'add-to-group', text: 'Add to group…', hint: hint('G'), help: 'Find a group, or make a new one' }, ...(c.group ? [{ id: 'leave-group', text: 'Remove from group', hint: hint('shift', 'G'), help: 'It stays in Chats, in no group' }] : [])] : []),
      { sep: true }, c.archived ? { id: 'archive', text: 'Restore', hint: hint('E'), help: 'Brings it back' } : { id: 'archive', text: 'Archive', hint: hint('E'), off: !!busyOf(c), help: busyOf(c) || 'Undo in the notice' },
      ...(has('advanced') ? [{ id: 'delete', text: 'Delete…', hint: hint('Backspace'), danger: true, help: 'Removes it for good; asks first' }] : [])];
    return r;
  }
  const membersOf = (g) => data.chats.filter((c) => c.group === g.id && !c.archived);
  function groupRowOf(g, list) {
    const needs = list.some((c) => sectionOfChat(c) === 'needs'), busy = list.find(busyOf);
    const state = needs ? 'needs-you' : busy ? busy.state : 'idle';
    const kinds = Object.keys(R.CHAT_KINDS), kind = kinds.find((k) => list.some((c) => c.kind === k)) || 'chat';
    const ps = [...new Set(list.map((c) => c.project).filter(Boolean))];
    const where = ps.length > 1 ? `${ps.length} projects` : ps[0] || 'No project';
    const cost = list.reduce((a, c) => a + (c.cost || 0), 0), x = { g, key: `cgroup:${g.id}` };
    return { key: x.key, _x: x, title: g.name, mark: markOf(state, kind), count: String(list.length), noun: 'chats', open: needs || !!busy, holds: list.some((c) => c.id === current), tip: `${g.name}\n${where} · ${list.length} chats\n${R.chatState(state).line || ''}`.trim(), end: list[0]?.time,
      meta: '', members: list.map((c) => chatRow(c, true)),
      menu: [{ id: 'rename', text: 'Rename…', hint: hint('R'), help: 'Give the group another name' }, { id: 'ungroup', text: 'Ungroup', help: 'The chats stay, in no group; Undo in the notice' }, { sep: true },
        { id: 'archive', text: 'Archive group', hint: hint('E'), off: !!busy, help: busy ? `“${busy.title}”: ${busyOf(busy).toLowerCase()}` : 'Undo in the notice' }, ...(has('advanced') ? [{ id: 'delete', text: 'Delete group…', hint: hint('Backspace'), danger: true, help: 'Removes the group and its chats for good; asks first' }] : [])] };
  }
  // the chats of a view, a group's folded into its row where its newest chat sits
  function rowsOf(list, foldGroups) {
    const out = [], placed = new Set();
    for (const c of list) {
      const g = foldGroups && c.group ? data.groups.find((x) => x.id === c.group) : null;
      if (!g) { out.push({ row: chatRow(c, false), c }); continue; }
      if (placed.has(g.id)) continue; placed.add(g.id);
      out.push({ row: groupRowOf(g, sorted(list.filter((m) => m.group === g.id))), c: list.filter((m) => m.group === g.id).sort((a, b) => ({ needs: 0, running: 1, recent: 2 }[sectionOfChat(a)] - { needs: 0, running: 1, recent: 2 }[sectionOfChat(b)]))[0] });
    }
    return out;
  }
  function sections() {
    const list = sorted(data.chats.filter((c) => passes(c, view)));
    if (view.by === 'ai') { const names = [...new Set(list.map(aiTopic))]; return names.map((n, i) => ({ id: `ai:${n}`, title: n, chip: i === 0 ? R.chip({ text: 'Worca · Haiku', title: 'A helper job names the topics. Change the sentence to undo it' }) : '', rows: list.filter((c) => aiTopic(c) === n).map((c) => chatRow(c, false)) })); }
    if (view.by === 'topic') {
      const sec = data.groups.map((g) => ({ id: `topic:${g.id}`, title: g.name, rows: list.filter((c) => c.group === g.id).map((c) => chatRow(c, false)) }));
      return [...sec, { id: 'topic:none', title: 'Ungrouped', rows: list.filter((c) => !c.group || !data.groups.some((g) => g.id === c.group)).map((c) => chatRow(c, false)) }];
    }
    const flat = view.show !== 'all';
    const rows = rowsOf(list, !flat);
    if (flat) return [{ id: view.show, title: showOf(view.show).title || view.show[0].toUpperCase() + view.show.slice(1), rows: rows.map((x) => x.row) }];
    const needs = rows.filter((x) => sectionOfChat(x.c) === 'needs'), rest = rows.filter((x) => sectionOfChat(x.c) !== 'needs');
    const head = needs.length ? [{ id: 'needs', title: NEEDS(), rows: needs.map((x) => x.row) }] : [];
    if (view.by === 'day') return R.dateSections({ rows: rest, dayOf: (x) => x.c.day, row: (x) => x.row, head, days: M.DAYS });
    if (view.by === 'project') {
      const name = (x) => { const ps = x.row.members ? [...new Set(x.row.members.map((m) => m._x.c.project).filter(Boolean))] : []; return ps.length > 1 ? 'Several projects' : x.c.project || 'No project'; };
      return [...head, ...[...new Set(rest.map(name))].map((p) => ({ id: `project:${p}`, title: p, rows: rest.filter((x) => name(x) === p).map((x) => x.row) }))];
    }
    return [...head, { id: 'running', title: 'Running', rows: rest.filter((x) => sectionOfChat(x.c) === 'running').map((x) => x.row) }, { id: 'recent', title: 'Recent', rows: rest.filter((x) => sectionOfChat(x.c) === 'recent').map((x) => x.row) }];
  }
  // AI topics: a helper names them; your own groups stay as they are. The mock's helper reads the titles' words.
  const AI_TOPICS = [['Billing', /bill|invoice|export|cost/i], ['Tests and builds', /flaky|build|test|ci\b|nightly|sentry/i], ['Releases', /release|changelog|notes/i], ['Infrastructure', /migrat|docker|queue|cron|pnpm|webhook|slow|index/i]];
  const aiTopic = (c) => (AI_TOPICS.find(([, re]) => re.test(c.title)) || ['Everything else'])[0];
  function parts() {
    return parts0();
  }
  function parts0() {
    const projects = [...new Set(data.chats.map((c) => c.project || 'No project'))].sort();
    return [{ word: 'Showing', id: 'show', text: showOf(view.show).text, tip: 'Which chats the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, help: x.help, checked: view.show === x.id, hint: count({ show: x.id }) })) },
      { word: 'from', id: 'from', text: view.from === 'all' ? 'all projects' : view.from, tip: 'Which project they belong to', items: [{ id: 'all', text: 'all projects', checked: view.from === 'all', hint: count({ from: 'all' }) }, { sep: true }, ...projects.map((p) => ({ id: p, text: p, checked: view.from === p, hint: count({ from: p }) }))] },
      R.byPart({ by: view.by, choices: [{ id: 'day', hint: String(M.DAYS.filter(([d]) => data.chats.some((c) => c.day === d && passes(c, view))).length) }, { id: 'state', help: `${NEEDS()}, Running, Recent`, hint: count({}) }, { id: 'project', hint: String(projects.length) }, { id: 'topic', help: 'One section per group, then Ungrouped', hint: String(data.groups.length) }, { id: 'ai', help: 'A helper job names the topics (Models › Jobs: Haiku); your groups are kept' }] })];
  }
  const SORTS = [['activity', 'Recent', 'Last activity first'], ['created', 'Created', 'Newest chat first'], ['title', 'A to Z', 'By title'], ['cost', 'Cost', 'Most spent first']];

  // ---- actions ----
  const snapshot = () => JSON.stringify(data);
  const undoTo = (snap, pick, tip) => ({ tip, run: () => { data = JSON.parse(snap); ctl.restore(pick); ctl.paint(); say('Undone'); } });
  const chatsOf = (rows) => [...new Map(rows.flatMap((x) => (x.g ? data.chats.filter((c) => c.group === x.g.id) : [x.c])).map((c) => [c.id, c])).values()];
  const archivePlan = (rows) => { const all = chatsOf(rows), busy = all.filter(busyOf); return { apply: all.filter((c) => !busyOf(c)), skipped: busy, title: busy.length ? `Skipped ${plural(busy.length, 'busy chat')}: ${busy.map((c) => c.title).join(', ')}` : '' }; };
  function bulkActions(rows0) {
    const rows = rows0.map((r) => r._x), arch = view.show === 'archived', p = archivePlan(rows), all = chatsOf(rows);
    return [arch ? { id: 'archive', label: 'Restore', n: all.length, tip: 'Brings them back' } : { id: 'archive', label: 'Archive', n: p.apply.length, tip: p.title || 'Undo in the notice', why: p.title },
      ...(has('advanced') ? [{ id: 'add-to-group', label: 'Add to group', n: all.length, tip: 'One group per chat; adding a grouped chat moves it' }, { id: 'delete', label: 'Delete', n: all.length, tip: 'Asks first; it cannot be taken back' }] : [])];
  }
  function act(id, rows0, { bulk, viaKey } = {}) {
    const rows = rows0.map((r) => r._x), x = rows[0], snap = snapshot(), pick = ctl.state.pick;
    if (id === 'in-view' && x) { if (x.t) window.RailShell.inView.toggle({ type: x.t.kind === 'schedule' ? 'schedule' : 'task', id: x.t.id, chat: x.c.id, title: x.t.title, case: x.t.case }); else if (x.c) window.RailShell.inView.toggle({ type: 'chat', id: x.c.id, title: x.c.title }); ctl.paint(); return; }
    if (x?.t && !bulk && id !== 'add-to-group') {
      const t = x.t;
      if (id === 'open-task') { if (t.kind === 'schedule') window.RailShell.openSchedule(t.id); else window.RailShell.openTask(t.case, x.c.id, t.title); return; }
      if (id === 'watch') { t.watch = t.watch ? '' : 'idle'; ctl.paint(); say(t.watch ? 'Watching: Worca fixes failing checks' : 'Stopped watching', undoTo(snap, pick, 'As it was')); return; }
      if (id === 'label-task') { x.c.labels = [...new Set([...(x.c.labels || []), 'hotfix'])]; ctl.paint(); say(`Labelled ${t.title}: hotfix`, undoTo(snap, pick, 'As it was')); return; }
      if (id === 'archive') { const drop = (l) => l.filter((y) => y !== t).map((y) => (y.after ? { ...y, after: drop(y.after) } : y)); x.c.tasks = drop(x.c.tasks); ctl.paint(); say(`Archived ${t.title}`, undoTo(snap, pick, 'Puts it back')); window.RailConversation?.refresh(); return; }
    }
    const back = !bulk && x ? `[data-open="${CSS.escape(x.key)}"]` : '';
    if (id === 'rename') {
      const name = x.g ? x.g.name : x.c.title;
      ctl.dialog({ title: x.g ? 'Rename group' : 'Rename chat', label: 'Name', value: name, yes: 'Rename', back, run: (v) => { if (x.g) x.g.name = v; else x.c.title = v; ctl.paint({ focus: back }); say(`Renamed to ${v}`); } }); return;
    }
    if (id === 'pin') { x.c.pinned = !x.c.pinned; ctl.paint({ focus: back }); say(x.c.pinned ? 'Pinned' : 'Unpinned', undoTo(snap, pick, 'As it was')); return; }
    if (id === 'archive') {
      const restoring = view.show === 'archived' || (x.c && x.c.archived && !bulk);
      if (restoring) { const all = chatsOf(rows); all.forEach((c) => { c.archived = false; }); ctl.clear(); ctl.paint(); say(`Restored ${plural(all.length, 'chat')}`, undoTo(snap, pick, 'Archives them again')); return; }
      const p = archivePlan(rows);
      if (!p.apply.length) { say(p.title); return; }
      p.apply.forEach((c) => { c.archived = true; }); ctl.clear(); ctl.paint();
      say(`Archived ${plural(p.apply.length, 'chat')}${p.title ? ` · ${p.title}` : ''}`, undoTo(snap, pick, 'Puts them back')); return;
    }
    if (id === 'delete') {
      const all = chatsOf(rows), archived = all.filter((c) => c.archived).length;
      const text = x.g && rows.length === 1 ? `Delete “${x.g.name}” and its ${plural(all.length, 'chat')}${archived ? ` (${archived} archived)` : ''}? This cannot be taken back.` : `Delete ${all.length === 1 ? `“${all[0].title}”` : plural(all.length, 'chat')}? This cannot be taken back.`;
      ctl.confirm({ text, yes: `Delete ${all.length}`, danger: true, run: () => { const gone = new Set(all.map((c) => c.id)); data.chats = data.chats.filter((c) => !gone.has(c.id)); if (x.g && rows.length === 1) data.groups = data.groups.filter((g) => g !== x.g); ctl.clear(); if (gone.has(current)) goHome(); say(x.g && rows.length === 1 ? `Group deleted · ${x.g.name}` : `Deleted ${plural(all.length, 'chat')}`); } }); return;
    }
    if (id === 'add-to-group') { const chats = rows.flatMap((y) => (y.g ? membersOf(y.g) : [y.c])); openGroups(chats, bulk ? '[data-bulk="add-to-group"]' : `[data-menu="row:${CSS.escape(x.key)}"]`); return; }
    if (id === 'leave-group') { const g = data.groups.find((y) => y.id === x.c.group); x.c.group = ''; ctl.paint(); say(`Removed from group · ${g.name}`, undoTo(snap, pick, 'Puts it back')); return; }
    if (id === 'ungroup') { data.chats.filter((c) => c.group === x.g.id).forEach((c) => { c.group = ''; }); data.groups = data.groups.filter((g) => g !== x.g); ctl.paint(); say(`Group removed · ${x.g.name}`, undoTo(snap, pick, 'Puts the group back')); return; }
    void viaKey;
  }
  function openGroups(chats, anchor) {
    const own = chats.length === 1 ? chats[0].group : '', snap = snapshot(), pick = ctl.state.pick;
    const nOf = (id) => String(data.chats.filter((c) => c.group === id).length);
    ctl.picker({ label: 'Add to group', placeholder: 'Find or create a group', anchor, hint: '↑ ↓ move · Enter adds · Esc closes',
      sections: (q) => { const f = q.trim().toLowerCase(), all = data.groups.filter((g) => g.id !== own && g.name.toLowerCase().includes(f)), rec = f ? [] : recent.map((id) => all.find((g) => g.id === id)).filter(Boolean).slice(0, 3), rest = all.filter((g) => !rec.includes(g));
        const exact = data.groups.some((g) => g.name.toLowerCase() === f);
        return [...(f && !exact ? [{ title: 'New', kind: 'create', rows: [{ text: `Create “${q.trim()}”`, n: '', on: false }] }] : f ? [] : [{ title: 'New', kind: 'new', rows: [{ text: 'New group…', n: '', on: false }] }]),
          ...(rec.length ? [{ title: 'Recent', kind: 'group', rows: rec.map((g) => ({ text: g.name, n: nOf(g.id), on: false })) }] : []), ...(rest.length ? [{ title: rec.length ? 'All groups' : 'Groups', kind: 'group', rows: rest.map((g) => ({ text: g.name, n: nOf(g.id), on: false })) }] : [])]; },
      pick: (kind, text) => {
        if (kind === 'new') { ctl.closePicker(); ctl.dialog({ title: 'New group', label: 'Name', value: R.prefs.flag('smartRunNaming') ? `${chats[0].title.split(' ').slice(0, 3).join(' ')} work` : '', hint: R.prefs.flag('smartRunNaming') ? 'Suggested from the chats in it; change it if it is wrong' : '', yes: 'Create group', back: anchor, run: (name) => place(chats, newGroup(name), snap, pick) }); return; }
        place(chats, kind === 'create' ? newGroup(text.slice(8, -1)) : data.groups.find((g) => g.name === text), snap, pick);
      } });
  }
  const newGroup = (name) => { const g = { id: `t-${Date.now().toString(36)}`, name }; data.groups.push(g); return g; };
  function place(chats, g, snap, pick) {
    chats.forEach((c) => { c.group = g.id; }); recent = [g.id, ...recent.filter((x) => x !== g.id)].slice(0, 8);
    ctl.closePicker(); ctl.clear(); ctl.openGroup(`cgroup:${g.id}`); ctl.paint(); ctl.landOn(`chat:${chats[0].id}`);
    say(`Added to ${g.name} · ${chats.length === 1 ? chats[0].title : plural(chats.length, 'chat')}`, undoTo(snap, pick, 'Puts them back where they were'));
  }
  function openChat(id) { const c = data.chats.find((x) => x.id === id); if (c) c.unread = false; window.RailShell.go(`chat/${id}`); }
  const goHome = () => { current = ''; window.RailShell.go('chat'); };
  function newChat(title = 'New chat', project = '', o = {}) { const id = `n${Date.now().toString(36)}`; data.chats.unshift({ id, title, state: 'idle', kind: 'chat', project, time: 'now', day: 'today', cost: null, pinned: false, archived: false, unread: false, group: '', origin: null, labels: [], tasks: [], ...o }); ctl.paint(); return id; }
  // ---- the column ----
  bar.innerHTML = '<div id="chats-root"></div>';
  const root = bar.querySelector('#chats-root');
  function toggle() { /* the list is the bar now: nothing to hide it from */ }
  const neighbour = (dir) => { const ids = ctl.state.order.filter((k) => k.startsWith('chat:')).map((k) => k.slice(5)), i = ids.indexOf(current); return ids[i < 0 ? (dir > 0 ? 0 : ids.length - 1) : i + dir]; };

  ctl = R.listController({ root, spec: {
    noun: 'chats', label: 'Selected chats', scopes: ['chat'],
    view: () => ({ state: listCase === 'loading' ? (ctl?.state.waited ? 'loading' : 'waiting') : ['offline', 'failed'].includes(listCase) ? listCase : 'ready', parts: parts(),
      tools: [{ id: 'select', text: 'Select', hint: `${R.keyHint(['mod'], R.isMac(window))} click`, help: 'Tick chats to act on several at once' }, { id: 'reset', text: 'Reset view', off: JSON.stringify({ show: view.show, from: view.from, by: view.by, sort: view.sort }) === JSON.stringify({ show: FRESH.show, from: FRESH.from, by: FRESH.by, sort: FRESH.sort }), help: 'Back to all chats, from all projects, by date' }, { sep: true }, { header: 'Sort' }, ...SORTS.map(([id, text, help]) => ({ id: `sort:${id}`, text, help, checked: view.sort === id })), { sep: true }, { id: 'keys', text: 'Keyboard shortcuts', hint: '?', help: 'The keys of this list' }],
      sections: sections(), empty: { text: listCase === 'empty' ? 'No chats yet.' : view.show === 'needs' ? 'No chat needs you.' : view.show === 'archived' ? 'No archived chats.' : view.show === 'running' ? 'No chat is running.' : 'No chats yet.', action: listCase === 'empty' ? 'New chat' : '' } }),
    can: () => ['menu', 'fold', 'archive', 'rename', 'pin', ...(has('advanced') ? ['group', 'delete'] : [])],
    bulk: bulkActions, act,
    open: (r) => { if (r._x.g) { ctl.toggleGroup(r.key); return; } if (r._x.t) { if (r._x.t.kind === 'schedule') window.RailShell.openSchedule(r._x.t.id); else window.RailShell.openTask(r._x.t.case, r._x.c.id, r._x.t.title); return; } openChat(r._x.c.id); },
    word: (id, v) => { view = { ...view, [id]: v }; set(STORE_V, JSON.stringify(view)); return false; },
    tool: (v) => { if (v === 'reset') { view = { ...FRESH }; set(STORE_V, JSON.stringify(view)); say('View reset'); return; } if (v.startsWith('sort:')) { view = { ...view, sort: v.slice(5) }; set(STORE_V, JSON.stringify(view)); } },
    key: (act) => {
      if (act === 'new-chat') window.RailConversation?.start('ask');
      else if (act === 'focus-list') ctl.focusList();
      else if (act === 'prev-chat' || act === 'next-chat') { const id = neighbour(act === 'next-chat' ? 1 : -1); if (id) openChat(id); }
    },
    say, active: () => (location.hash.startsWith('#chat') || !location.hash) && !document.querySelector('.pz-popover, .keys-modal, #app .viewer-modal, #app .nav-fly'),
    retry: () => setCase('full'), emptyAct: () => window.RailConversation?.start('ask'),
  } });
  function setCase(c) {
    listCase = c === 'shared' || c === 'refresh' ? 'full' : c; data = c === 'empty' ? { groups: [], chats: [] } : M.seed(); ctl.clear(); ctl.state.waited = false;
    if (c === 'loading') setTimeout(() => { ctl.state.waited = true; ctl.paint(); }, 300);
    ctl.paint();
    if (c === 'refresh' && location.hash.startsWith('#chat')) say('Could not load the chats. The rows here may be out of date.');
  }
  document.getElementById('list-case')?.addEventListener('change', (e) => setCase(e.target.value));
  window.RailWorld.onChange(() => setCase(listCase));   // another Pulse case: what waits on you follows it
  R.prefs.onChange(() => ctl.paint());
  window.RailChats = {
    show: (id) => { current = id || ''; ctl.paint(); return true; },
    opened: () => true,
    toggle,
    newChat,
    data: () => data,
    refresh: () => { ctl.paint(); window.RailShell?.inView.draw(); },
  };
  ctl.paint();
})();
