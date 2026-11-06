// The Runs list (docs/rail/lists.md; plans/rail/agreed/chat-and-runs-decisions.md C3, C4): one operations view across
// every build. The library owns the behaviour (listController); this names the rows, the sentence and what an action does.
// A row's state, word and section come from R.runState and R.sectionOf on its real run-page case, and it opens that case.
(function () {
  const R = window.RailUI, M = window.RunsListModel, RM = window.RunCardModel;
  const root = document.getElementById('runs-root');
  if (!root) return;
  const KEY = 'worca-rail.runs.view';
  const store = { get: () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }, set: (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* the view lasts the session */ } } };
  const FRESH = { show: 'all', from: 'all', person: '', by: 'state', labels: [] };
  let view = { ...FRESH, ...(store.get() || {}) }, data = M.seed(), listCase = 'full', recent = [], ctl = null;
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const usd = (n) => `$${n.toFixed(2)}`;

  // ---- what a row is, from its case ----
  const stateOf = (r) => (r.archived ? 'archived' : RM.stateOf(r.case));
  const wordOf = (r) => R.runState(stateOf(r)).word;
  const sectionOfRun = (r) => (r.archived ? 'recent' : R.sectionOf(wordOf(r)));
  const openCase = (r) => (r.archived ? 'archived' : r.case);
  const NEEDS = () => R.runState('question').word;
  const markOf = (state) => { const st = R.runState(state); return R.statusDot({ tone: st.dot, sym: st.sym }); };
  const membersOf = (g) => data.runs.filter((r) => r.group === g.id).sort((a, b) => (a.pos || 0) - (b.pos || 0));
  const liveMembers = (g) => membersOf(g).filter((r) => !r.archived);
  const groupState = (g) => RM.stateOf(g.case);
  // a member that waits on a person raises its group; one that is simply ready ships with the group
  const raises = (m) => sectionOfRun(m) === 'needs' && ![R.runState('ready').word, R.runState('approved').word].includes(wordOf(m));
  const groupSection = (g) => (liveMembers(g).some(raises) ? 'needs' : R.sectionOf(R.runState(groupState(g)).word));
  // what it is in the list: a run, or a group with its runs
  function tops() {
    const out = data.runs.filter((r) => !r.group).map((r) => ({ run: r, section: sectionOfRun(r), archived: r.archived, labels: r.labels, project: r.project, by: r.by, day: r.day, word: wordOf(r) }));
    for (const g of data.groups) {
      const ms = membersOf(g); if (!ms.length) continue;
      const archived = ms.every((m) => m.archived);
      out.push({ group: g, section: archived ? 'recent' : groupSection(g), archived, labels: [...new Set(ms.flatMap((m) => m.labels))], project: g.project, by: ms[0].by, day: g.day, word: R.runState(groupState(g)).word });
    }
    return out;
  }
  const finished = (t) => t.section === 'recent' || !!t.run?.pr || t.word === 'Ready' || t.word === 'Failed';
  const readyToShip = (t) => t.word === 'Ready' && (t.run?.kind || 'Git') === 'Git' && !t.run?.pr;
  const SHOWS = [
    { id: 'all', text: 'all', help: 'Every run that is not archived', test: (t) => !t.archived },
    { id: 'needs', text: NEEDS().toLowerCase(), help: 'Waiting on a person: a question, a gate, a pause, a failure, ready to ship', title: NEEDS(), test: (t) => !t.archived && t.section === 'needs' },
    { id: 'running', text: 'running', help: 'Working now', test: (t) => !t.archived && t.section === 'running' },
    { id: 'waiting', text: 'waiting', help: 'Not started yet: after another run, or at a time', test: (t) => !t.archived && t.section === 'scheduled' },
    { id: 'finished', text: 'finished', help: 'Every run that has ended', test: (t) => !t.archived && finished(t) },
    { id: 'ready', text: 'ready to ship', help: 'Finished with no PR open: nothing else needs doing but shipping it', test: (t) => !t.archived && readyToShip(t) },
    { id: 'archived', text: 'archived', help: 'Runs you archived', test: (t) => t.archived },
  ];
  const showOf = (id) => SHOWS.find((x) => x.id === id);
  const passes = (t, v) => showOf(v.show).test(t) && (v.from === 'all' || (t.project || 'No project') === v.from) && (!v.person || t.by === v.person)
    && (!labelsOn() || !v.labels.length || t.labels.some((l) => v.labels.includes(l)));
  const labelsOn = () => R.prefs.flag('runLabels');
  const shared = () => listCase === 'shared';
  const count = (patch) => String(tops().filter((t) => passes(t, { ...view, ...patch })).length);

  // ---- the row ----
  const has = (need) => R.shows(need);
  const hint = (...keys) => R.keyHint(keys, R.isMac(window));
  const targetOf = (r) => { const w = wordOf(r), waiting = sectionOfRun(r) === 'scheduled'; return { id: r.id, title: r.title, state: R.bulkStateOf(w), status: /^interrupted/.test(r.case) ? 'interrupted' : '', prNeeds: w === NEEDS() && !!r.pr, pipelineId: waiting ? null : r.id, ticketId: waiting ? r.id : null }; };
  const targets = (rows) => rows.map((x) => (x.g ? { id: x.key, members: membersOf(x.g).map(targetOf) } : targetOf(x.r)));
  const plan = (a, rows) => R.planBulk(a, targets(rows));
  const n = (p) => p.apply.length + p.cancel.length;
  const runRows = (rows) => [...new Map(rows.flatMap((x) => (x.g ? membersOf(x.g) : [x.r])).map((r) => [r.id, r])).values()];
  function menuOf(x) {
    const r = x.r, g = x.g;
    const stop = plan('stop', [x]), arch = plan('archive', [x]), del = plan('delete', [x]);
    const isArchived = g ? membersOf(g).every((m) => m.archived) : r.archived;
    const items = [{ id: 'toggle', text: 'Select', hint: hint('Space') },
      { id: 'stop', text: 'Stop', hint: hint('S'), off: !n(stop), help: n(stop) ? 'Stops it; the branch and changes stay' : R.skipText(stop) },
      isArchived ? { id: 'archive', text: 'Restore', hint: hint('E'), help: 'Brings it back to Runs' } : { id: 'archive', text: 'Archive', hint: hint('E'), off: !n(arch), help: n(arch) ? 'Removes its branch and logs; Undo in the notice' : R.skipText(arch) }];
    if (has('advanced') && r && !(r.group && !r.adhoc)) items.push({ sep: true }, { id: 'add-to-group', text: 'Add to group…', hint: hint('G'), help: 'Find a group, or make a new one' });
    if (has('advanced') && r?.adhoc && r.group) items.push({ id: 'leave-group', text: 'Remove from group', hint: hint('shift', 'G'), help: 'It stays in Runs, in no group' });
    const pr = r?.pr || (g ? membersOf(g).find((m) => m.pr)?.pr : '');
    if (pr) items.push({ id: 'view-pr', text: `View PR ${pr} ↗`, help: 'Opens the PR on GitHub' });
    if (g?.kind === 'feature') items.push({ id: 'open', text: 'Open feature', help: 'Its plan, its runs, how it ships' });
    if (has('advanced')) items.push({ id: 'delete', text: 'Delete', hint: hint('Backspace'), danger: true, off: !n(del), help: n(del) ? 'Removes it for good; asks first' : R.skipText(del) });
    return items;
  }
  const labelWords = (r) => (labelsOn() && r.labels.length ? r.labels.slice(0, 2).join(', ') + (r.labels.length > 2 ? ` +${r.labels.length - 2}` : '') : '');
  function metaOf(r, section, member) {
    const w = wordOf(r);
    const says = !member && ((section === 'needs' && w === NEEDS()) || (section === 'running' && w === 'Working')) || (member && w === 'Working');
    return [says ? '' : w, r.detail === w ? '' : r.detail, !member && view.by !== 'project' ? r.project || 'No project' : '', member ? '' : labelWords(r), shared() && !member ? r.by : ''].filter(Boolean).join(' · ');
  }
  const costTip = (r) => (r.cost == null ? 'Cost unknown' : `Cost ${usd(r.cost)}`);
  const row = (r, section, member) => {
    const x = { r };
    const base = { key: `run:${r.id}`, _x: x, title: member && r.pos ? `${r.pos} · ${r.title}` : r.title, meta: metaOf(r, section, member), mark: markOf(stateOf(r)), end: [r.pr, r.time].filter(Boolean).join(' · '),
      unread: r.unread, tip: `${r.title}\n${costTip(r)}\nOpens the run`, menu: null };
    x.key = base.key;
    base.menu = menuOf(x);
    if (r.rounds) base.rounds = r.rounds;
    return base;
  };
  function groupRowOf(g, section) {
    const ms = membersOf(g), done = ms.filter((m) => ['merged', 'in-review', 'ready'].includes(R.bulkStateOf(wordOf(m)))).length;
    const needy = ms.find(raises);
    const state = section === 'needs' && needy && R.sectionOf(R.runState(groupState(g)).word) !== 'needs' ? stateOf(needy) : groupState(g);
    const why = section === 'needs' && needy ? `Run ${needy.pos || ms.indexOf(needy) + 1} ${wordOf(needy).toLowerCase()}${needy.detail ? ` · ${needy.detail}` : ''}` : R.runState(state).word;
    const kindWord = { feature: 'Feature', chain: 'Chain', user: 'Group' }[g.kind];
    const total = ms.reduce((a, m) => a + (m.cost || 0), 0);
    const x = { g, key: `group:${g.id}` };
    return { key: x.key, _x: x, title: g.title, meta: [kindWord, why, view.by !== 'project' ? g.project : ''].filter(Boolean).join(' · '), mark: markOf(state), count: `${done}/${ms.length}`, noun: 'runs',
      open: !(['Ready', 'Stopped', 'Merged', 'Failed'].includes(R.runState(groupState(g)).word)), tip: `${g.title}\nGroup total ${usd(total)}\nOpens the ${kindWord.toLowerCase()}`, menu: menuOf(x), members: ms.map((m) => row(m, '', true)) };
  }
  const rowOf = (t, section) => (t.group ? groupRowOf(t.group, section) : row(t.run, section, false));

  // ---- the sentence ----
  function parts() {
    const projects = [...new Set(tops().map((t) => t.project || 'No project'))].sort();
    const out = [{ word: 'Showing', id: 'show', text: showOf(view.show).text, tip: 'Which runs the list shows', items: SHOWS.map((x) => ({ id: x.id, text: x.text, help: x.help, checked: view.show === x.id, hint: count({ show: x.id }) })) }];
    if (shared()) out.push({ word: 'started by', id: 'person', text: view.person || 'everyone', tip: 'Whose runs it shows, on a shared sign-in', items: [{ id: '', text: 'everyone', checked: !view.person, hint: count({ person: '' }) }, { sep: true }, ...M.PEOPLE.map((p) => ({ id: p, text: p, checked: view.person === p, hint: count({ person: p }) }))] });
    out.push({ word: 'from', id: 'from', text: view.from === 'all' ? 'all projects' : view.from, tip: 'Which project they come from', items: [{ id: 'all', text: 'all projects', checked: view.from === 'all', hint: count({ from: 'all' }) }, { sep: true }, ...projects.map((p) => ({ id: p, text: p, checked: view.from === p, hint: count({ from: p }) }))] });
    out.push({ word: 'by', id: 'by', text: view.by, tip: 'How the list is grouped', items: [{ id: 'state', text: 'state', help: `${NEEDS()}, Running, Waiting, Recent`, checked: view.by === 'state', hint: count({}) }, { id: 'project', text: 'project', help: 'One section per project', checked: view.by === 'project', hint: String(projects.length) }, { id: 'day', text: 'day', help: 'Upcoming, Today, Yesterday, Previous 7 days, Previous 30 days, Older', checked: view.by === 'day', hint: String(M.DAYS.filter(([d]) => tops().some((t) => t.day === d && passes(t, view))).length) }] });
    if (labelsOn() && view.labels.length) {
      const all = [...new Set(data.runs.flatMap((r) => r.labels))].sort();
      out.push({ word: 'labelled', id: 'labels', text: view.labels.join(', '), tip: 'Runs with any of these labels', items: [{ id: '', text: 'any label', help: 'Every label', hint: count({ labels: [] }) }, { sep: true }, ...all.map((l) => ({ id: l, text: l, checked: view.labels.includes(l), hint: count({ labels: [l] }) }))] });
    }
    return out;
  }
  const EMPTY = { needs: 'Nothing needs you.', running: 'No running runs.', waiting: 'Nothing is waiting.', finished: 'No finished runs yet.', ready: 'Nothing is ready to ship.', archived: 'No archived runs.' };
  function sections() {
    const list = tops().filter((t) => passes(t, view));
    const rows = (ts, s) => ts.map((t) => rowOf(t, s));
    if (view.show !== 'all') return [{ id: view.show, title: showOf(view.show).title || cap(showOf(view.show).text), rows: rows(list, view.show === 'needs' || view.show === 'running' ? view.show : '') }];
    const needs = list.filter((t) => t.section === 'needs'), rest = list.filter((t) => t.section !== 'needs');
    const head = needs.length ? [{ id: 'needs', title: NEEDS(), rows: rows(needs, 'needs') }] : [];
    if (view.by === 'project') {
      const names = [...new Set(rest.map((t) => t.project || 'No project'))];
      return [...head, ...names.map((p) => { const ts = rest.filter((t) => (t.project || 'No project') === p), kinds = ts.map((t) => t.run?.kind).filter(Boolean); return { id: `project:${p}`, title: p, chip: kinds.length ? R.chip({ text: kinds[0] }) : '', rows: rows(ts, '') }; })];
    }
    if (view.by === 'day') return [...head, ...M.DAYS.map(([d, title]) => ({ id: `day:${d}`, title, limit: d === 'older' ? 3 : undefined, rows: rows(rest.filter((t) => t.day === d), '') }))];
    return [...head, { id: 'running', title: 'Running', rows: rows(rest.filter((t) => t.section === 'running'), 'running') }, { id: 'waiting', title: R.runState('scheduled').word, rows: rows(rest.filter((t) => t.section === 'scheduled'), '') }, { id: 'recent', title: 'Recent', rows: rows(rest.filter((t) => t.section === 'recent'), '') }];
  }

  // ---- actions ----
  const snapshot = () => JSON.stringify(data);
  const undoTo = (snap, pick, words) => ({ tip: words, run: () => { data = JSON.parse(snap); ctl.restore(pick); ctl.paint(); say('Undone'); } });
  const rowsNow = (rows) => rows.map((x) => x._x);
  const byId = (id) => data.runs.find((r) => r.id === id);
  function bulkActions(rows0) {
    const rows = rowsNow(rows0), archivedView = view.show === 'archived';
    const stop = plan('stop', rows), arch = plan('archive', rows), del = plan('delete', rows), all = runRows(rows);
    const off = (p) => R.skipText(p) || 'None of these';
    const acts = [{ id: 'stop', label: 'Stop', n: n(stop), tip: R.skipText(stop) || 'Asks first; the branches and changes stay', why: off(stop) },
      archivedView ? { id: 'archive', label: 'Restore', n: all.length, tip: 'Brings them back to Runs' } : { id: 'archive', label: 'Archive', n: n(arch), tip: R.skipText(arch) || 'Undo in the notice', why: off(arch) }];
    if (has('advanced')) acts.push({ id: 'delete', label: 'Delete', n: n(del), tip: R.skipText(del) || 'Asks first; it cannot be taken back', why: off(del) });
    if (labelsOn()) acts.push({ id: 'label', label: 'Label', n: all.length, tip: 'Adds or removes a label on each' });
    if (has('advanced')) { const can = rows.filter((x) => x.r && !(x.r.group && !x.r.adhoc)); acts.push({ id: 'add-to-group', label: 'Add to group', n: can.length, tip: can.length < rows.length ? `Skips ${rows.length - can.length}: a feature's runs and groups stay as they are` : 'Find a group, or make a new one', why: 'A feature\'s runs and groups stay as they are' }); }
    return acts;
  }
  function act(id, rows0, { bulk } = {}) {
    const rows = rowsNow(rows0), pick = ctl.state.pick, snap = snapshot(), names = rows.length === 1 ? `“${(rows[0].r || rows[0].g).title}”` : plural(rows.length, 'run');
    const backTo = rows.length === 1 && !bulk ? `[data-open="${CSS.escape(rows[0].key)}"]` : '';
    if (id === 'stop') { const p = plan('stop', rows), c = n(p); if (!c) { say(R.skipText(p)); return; } ctl.confirm({ text: `Stop ${rows.length === 1 ? names : plural(c, 'run')}? Its branch and changes stay.${p.skip.length ? ` ${R.skipText(p)}` : ''}`, yes: `Stop ${c}`, danger: true, back: backTo, run: () => { p.apply.forEach((t) => { byId(t.id).case = 'stopped'; }); p.cancel.forEach((t) => { byId(t.id).case = 'ticket-canceled'; }); ctl.clear(); say(`Stopped ${plural(c, 'run')}`); } }); return; }
    if (id === 'archive') {
      const back = view.show === 'archived' || rows.every((x) => (x.g ? membersOf(x.g).every((m) => m.archived) : x.r.archived));
      if (back) { runRows(rows).forEach((r) => { r.archived = false; }); ctl.clear(); ctl.paint(); say(`Restored ${plural(runRows(rows).length, 'run')}`, undoTo(snap, pick, 'Archives them again')); return; }
      const p = plan('archive', rows), c = n(p); if (!c) { say(R.skipText(p)); return; }
      p.apply.forEach((t) => { byId(t.id).archived = true; }); ctl.clear(); ctl.paint();
      say(`Archived ${plural(c, 'run')}${p.skip.length ? ` · ${R.skipText(p)}` : ''}`, undoTo(snap, pick, 'Puts them back')); return;
    }
    if (id === 'delete') { const p = plan('delete', rows), c = n(p); if (!c) { say(R.skipText(p)); return; } ctl.confirm({ text: `Delete ${rows.length === 1 ? names : plural(c, 'run')}? This cannot be taken back.${p.skip.length ? ` ${R.skipText(p)}` : ''}`, yes: `Delete ${c}`, danger: true, back: '', run: () => { const gone = new Set([...p.apply, ...p.cancel].map((t) => t.id)); data.runs = data.runs.filter((r) => !gone.has(r.id)); ctl.clear(); say(`Deleted ${plural(c, 'run')}`); } }); return; }
    if (id === 'label') { openLabels(rows); return; }
    if (id === 'add-to-group') { openGroups(rows, rows.length === 1 && !bulk ? `[data-menu="row:${CSS.escape(rows[0].key)}"]` : '[data-bulk="add-to-group"]'); return; }
    if (id === 'leave-group') { const r = rows[0].r, g = data.groups.find((x) => x.id === r.group); r.group = ''; r.adhoc = false; ctl.paint(); say(`Removed from ${g.title}`, undoTo(snap, pick, 'Puts it back in the group')); return; }
    if (id === 'view-pr') { const r = rows[0].r || membersOf(rows[0].g).find((m) => m.pr); say(`Opens PR ${r.pr} on GitHub (it leaves Worca; not in this prototype)`); ctl.paint(); return; }
    if (id === 'open') { openThing(rows0[0]); return; }
  }
  function openLabels(rows) {
    const runs = runRows(rows), snap = snapshot(), pick = ctl.state.pick;
    ctl.picker({ label: 'Labels', placeholder: 'Find or add a label', anchor: '[data-bulk="label"]', hint: 'Enter adds what you typed',
      sections: (q) => { const all = [...new Set(data.runs.flatMap((r) => r.labels))].sort().filter((l) => l.includes(q.trim().toLowerCase())); const add = q.trim() && !all.includes(q.trim().toLowerCase()) ? [{ text: q.trim().toLowerCase(), n: 'New', on: false }] : []; return [{ title: 'Labels', kind: 'label', many: true, rows: [...add, ...all.map((l) => { const c = runs.filter((r) => r.labels.includes(l)).length; return { text: l, n: `${c} of ${runs.length}`, on: c === runs.length }; })] }]; },
      pick: (k, l) => { const on = runs.every((r) => r.labels.includes(l)); runs.forEach((r) => { r.labels = on ? r.labels.filter((x) => x !== l) : [...new Set([...r.labels, l])]; }); ctl.state.pop.q = ''; const i = root.querySelector('#list-pop-q'); if (i) i.value = ''; ctl.paint(); say(`${on ? 'Removed' : 'Added'} ${l} ${on ? 'from' : 'to'} ${plural(runs.length, 'run')}`, undoTo(snap, pick, 'Puts the labels back')); } });
  }
  const userGroups = () => [...data.userGroups, ...data.groups.filter((g) => g.kind === 'user').map((g) => ({ id: g.id, title: g.title }))];
  function openGroups(rows, anchor) {
    const runs = rows.filter((x) => x.r && !(x.r.group && !x.r.adhoc)).map((x) => x.r);
    if (!runs.length) { say('A feature\'s runs and groups stay as they are'); return; }
    const own = runs.length === 1 ? runs[0].group : '', snap = snapshot(), pick = ctl.state.pick;
    const nOf = (id) => String(data.runs.filter((r) => r.group === id).length);
    ctl.picker({ label: 'Add to group', placeholder: 'Find or create a group', anchor, hint: '↑ ↓ move · Enter adds · Esc closes',
      sections: (q) => { const f = q.trim().toLowerCase(), all = userGroups().filter((g) => g.id !== own && g.title.toLowerCase().includes(f)), rec = f ? [] : recent.map((id) => all.find((g) => g.id === id)).filter(Boolean).slice(0, 3); const rest = all.filter((g) => !rec.includes(g));
        const exact = userGroups().some((g) => g.title.toLowerCase() === f);
        return [...(f && !exact ? [{ title: 'New', kind: 'create', rows: [{ text: `Create “${q.trim()}”`, n: '', on: false }] }] : f ? [] : [{ title: 'New', kind: 'new', rows: [{ text: 'New group…', n: '', on: false }] }]),
          ...(rec.length ? [{ title: 'Recent', kind: 'group', rows: rec.map((g) => ({ text: g.title, n: nOf(g.id), on: false })) }] : []), ...(rest.length ? [{ title: rec.length ? 'All groups' : 'Groups', kind: 'group', rows: rest.map((g) => ({ text: g.title, n: nOf(g.id), on: false })) }] : [])]; },
      pick: (kind, text) => {
        if (kind === 'new') { ctl.closePicker(); ctl.dialog({ title: 'New group', label: 'Name', value: R.prefs.flag('smartRunNaming') ? `${runs[0].title.split(' ').slice(0, 3).join(' ')} work` : '', hint: R.prefs.flag('smartRunNaming') ? 'Suggested from the runs in it; change it if it is wrong' : '', yes: 'Create group', back: anchor, run: (name) => place(runs, makeGroup(name), snap, pick) }); return; }
        if (kind === 'create') { place(runs, makeGroup(text.slice(8, -1)), snap, pick); return; }
        place(runs, userGroups().find((g) => g.title === text), snap, pick);
      } });
  }
  const makeGroup = (title) => { const g = { id: `g-${Date.now().toString(36)}`, title }; data.userGroups.push(g); return g; };
  function place(runs, ug, snap, pick) {
    if (!data.groups.some((g) => g.id === ug.id)) data.groups.push({ id: ug.id, kind: 'user', case: 'group-working', title: ug.title, project: runs[0].project, time: runs[0].time, day: runs[0].day, cost: null });
    data.userGroups = data.userGroups.filter((g) => g.id !== ug.id);
    runs.forEach((r) => { r.group = ug.id; r.adhoc = true; });
    recent = [ug.id, ...recent.filter((x) => x !== ug.id)].slice(0, 8);
    ctl.closePicker(); ctl.clear(); ctl.openGroup(`group:${ug.id}`); ctl.paint(); ctl.landOn(`run:${runs[0].id}`);
    say(`Added to ${ug.title} · ${runs.length === 1 ? runs[0].title : plural(runs.length, 'run')}`, undoTo(snap, pick, 'Puts them back where they were'));
  }
  function openThing(row) {
    const x = row._x;
    if (x.r) x.r.unread = false;
    window.RailShell.openRun(`run/${x.g ? x.g.case : openCase(x.r)}`, x.g ? x.g.title : x.r.title);
  }

  ctl = R.listController({ root, spec: {
    noun: 'runs', label: 'Selected runs',
    view: () => ({ state: listCase === 'loading' ? (ctl?.state.waited ? 'loading' : 'waiting') : ['offline', 'failed'].includes(listCase) ? listCase : 'ready', parts: parts(), tools: [{ id: 'select', text: 'Select', hint: `${R.keyHint(['mod'], R.isMac(window))} click`, help: 'Tick runs to act on several at once' }, { id: 'keys', text: 'Keyboard shortcuts', hint: '?', help: 'The keys of this list' }],
      sections: sections(), empty: listCase === 'empty' ? { text: 'No runs yet.', action: 'Start a run' } : { text: EMPTY[view.show] || 'Nothing here with these words.' } }),
    can: () => ['menu', 'fold', 'stop', 'archive', ...(has('advanced') ? ['group', 'delete'] : [])],
    bulk: bulkActions, act, open: openThing,
    openRound: (row, n2) => { const rd = row._x.r.rounds.list.find((x) => x.n === n2); window.RailShell.openRun(`run/${rd.case}`, `${row._x.r.title} · Round ${n2}`); },
    word: (id, v) => {
      if (id === 'labels') { if (!v) { view.labels = []; return false; } view.labels = view.labels.includes(v) ? view.labels.filter((l) => l !== v) : [...view.labels, v]; store.set(view); return view.labels.length > 0; }
      view = { ...view, [id]: v }; store.set(view); return false;
    },
    say, active: () => !root.closest('[hidden]') && !document.querySelector('.pz-popover, .keys-modal, #app .viewer-modal, #app .nav-fly'),
    retry: () => setCase('full'), emptyAct: () => document.getElementById('topnav-new')?.click(), touched: () => window.RailPulse?.dismiss(),
  } });

  function setCase(c) {
    listCase = c; data = c === 'empty' ? { groups: [], runs: [], userGroups: [] } : M.seed(); ctl.clear();
    ctl.state.waited = false;
    if (c === 'loading') setTimeout(() => { ctl.state.waited = true; ctl.paint(); }, 300);
    if (c === 'refresh') { listCase = 'full'; ctl.paint(); say('Could not load the runs. The rows here may be out of date.'); return; }
    ctl.paint();
  }
  document.getElementById('list-case')?.addEventListener('change', (e) => setCase(e.target.value));
  R.prefs.onChange(() => ctl.paint());
  window.RailRunsList = {
    show: () => ctl.paint(),
    focus: () => ctl.focusRow(),
    // from the search: the runs with this label
    label: (l) => { view = { ...view, labels: [l], show: 'all', from: 'all', person: '' }; store.set(view); ctl.clear(); ctl.paint(); },
  };
  ctl.paint();
})();
