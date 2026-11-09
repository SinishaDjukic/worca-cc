// Workspaces on Rail (Wave 3, second pass; mock plans/rail/mocks/wave-3/scope-2): organizational: a named set of projects
// and the map of how they connect. They live inside the one Projects place, from Advanced (projects/ws:<id>): its box on
// the home, opened in place as its map; what Worca is unsure of comes first as yes-or-no questions. Chat first: a page
// ends with the composer, Change projects or links in a chat leads; Edit by hand is the manual way, a draft until saved (rail.drafts).
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const WORD = { ok: '', behind: 'Out of sync', diverged: 'Out of sync', missing: 'Folder missing' };
  const data = { spaces: [
    { id: 'web-shop', tags: ['team: shop'], labels: ['shop'], title: 'Web shop', home: 'web-shop', runs: 12, scanned: 'yesterday', model: 'Sonnet 5.5 · medium', about: 'A shop front built on a design kit calls a payments service, which calls billing and mails receipts.',
      projects: [['web-app', 'ok'], ['payments-api', 'ok'], ['design-kit', 'ok'], ['email-service', 'ok'], ['billing-api', 'behind']],
      links: [{ from: 'payments-api', to: 'billing-api', kind: 'REST API', how: 'calls the API of', sure: 'verified', state: 'confirmed' }, { from: 'web-app', to: 'payments-api', kind: 'REST API', how: 'calls the API of', sure: 'verified', state: 'confirmed' }, { from: 'payments-api', to: 'email-service', kind: 'queue', how: 'sends receipts through a queue to', at: 'payments/receipts.ts:41', sure: 'heuristic', state: 'auto' }, { from: 'web-app', to: 'design-kit', kind: 'build dependency', how: 'builds on', sure: 'exact', state: 'auto' }] },
    { id: 'iot', title: 'IoT SP Platform', home: '', runs: 0, scanned: '3 days ago', model: 'Sonnet 5.5 · high', about: 'Devices report through a gateway into a time-series store; a dashboard reads it.',
      projects: [['ingest-gateway', 'diverged'], ['device-registry', 'behind'], ['telemetry-db', 'ok'], ['ops-dashboard', 'ok'], ['firmware-sdk', 'ok']],
      links: [{ from: 'ingest-gateway', to: 'telemetry-db', kind: 'shared database', how: 'writes readings to', at: 'gateway/store.go:88', sure: 'inferred', state: 'auto' }, { from: 'ops-dashboard', to: 'telemetry-db', kind: 'shared database', how: 'reads readings from', sure: 'verified', state: 'auto' }] },
    { id: 'legacy', tags: ['team: billing'], labels: ['legacy'], title: 'Legacy billing', home: '', runs: 0, scanned: 'never', model: '', about: '',
      projects: [['legacy-billing', 'missing'], ['billing-api', 'behind']], links: [] },
  ] };
  let current = '', menu = '', confirm = null, page = null, linksOpen = false, editing = '';
  const SURE = { exact: 'Certain', verified: 'Checked', heuristic: 'Fairly sure', inferred: 'A guess' }, PCT = { exact: 100, verified: 95, heuristic: 72, inferred: 40 };
  const SAYS_SURE = { heuristic: 'Worca is fairly sure', inferred: 'Worca is guessing' };
  const ORIGIN_TO = { ok: 'ok', behind: 'behind', diverged: 'diverged', missing: 'missing', offline: 'behind', uncommitted: 'behind', local: 'ok', folder: 'ok' };
  const shown = (w) => { if (!w.draft) return w; const ids = w.draft.projects.map(([p]) => p); return { ...w, projects: w.draft.projects, links: w.links.filter((l) => ids.includes(l.from) && ids.includes(l.to)) }; };   // a project taken out takes its links and questions with it
  const live = (w) => { const P = window.RailProjects?.list() || []; w.projects = w.projects.map(([id, st]) => { const p = P.find((x) => x.id === id); return [id, p ? ORIGIN_TO[p.origin] || st : st]; }); return w; };   // one truth: Projects
  const unsure = (l) => l.state === 'auto' && !!SAYS_SURE[l.sure];   // what Worca is certain of or checked is no question, and is drawn solid
  const questions = (w) => w.links.filter(unsure);
  const running = (ids) => (window.RailChats?.data().chats || []).filter((c) => ids.includes(c.project)).flatMap((c) => c.tasks || []).filter((t) => t.kind !== 'schedule' && ['run', 'ask', 'act'].includes(R.markTone(R.runState(window.RunCardModel.stateOf(t.case))))).length;
  const toneOf = (w) => { const s = live(w).projects.map(([, x]) => x); return s.includes('missing') ? 'fail' : s.includes('diverged') || questions(w).length ? 'ask' : 'idle'; };
  const others = (w, id) => data.spaces.filter((x) => x !== w && x.projects.some(([p]) => p === id));
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  function lines(w) {
    const out = []; live(w);
    w.projects.forEach(([p, s]) => { if (s === 'missing') out.push([`${p}: folder missing`, 'fail']); if (s === 'diverged') out.push([`${p} is out of sync`, 'ask']); });
    if (questions(w).length) out.push([n(questions(w).length, 'question') + ' for you', 'ask']);
    const r = running(w.projects.map(([p]) => p)); if (r) out.push([`${n(r, 'task')} running`]);
    const shared = w.projects.map(([p]) => [p, others(w, p)[0]]).find(([, o]) => o); if (shared) out.push([`shares ${shared[0]} with ${shared[1].title}`]);
    return out.slice(0, 4);
  }
  const boxOf = (w) => ({ id: w.id, title: w.title, count: n(w.projects.length, 'project'), lines: lines(w), attrs: { 'data-pj-go': `ws:${w.id}`, title: `Opens ${w.title} here` } });
  const go = (id) => window.RailShell.go(id ? `projects/ws:${id}` : 'projects');
  const redraw = () => window.RailPlaces.projects.redraw();
  function act(id, w) {
    if (id === 'sync') { const of = (st) => live(w).projects.filter(([, s]) => s === st).map(([p]) => p), behind = of('behind'), diverged = of('diverged'); behind.forEach((p) => window.RailProjects.sync(p)); redraw(); say(`Synced ${n(behind.length, 'project')} in ${w.title}${diverged.length ? `; ${diverged.join(', ')} ${diverged.length === 1 ? 'has' : 'have'} diverged and ${diverged.length === 1 ? 'was' : 'were'} left alone` : ''}`); return; }
    if (id === 'scan') { if (w.scanning) return; const gone = live(w).projects.filter(([, s]) => s === 'missing').map(([p]) => p); w.scanning = true; redraw(); say(`Reading ${w.title}${gone.length ? `; skips ${gone.join(', ')}, folder missing` : ''}`); setTimeout(() => { w.scanning = false; w.scanned = 'just now'; redraw(); say(`Mapped ${w.title}`); }, 1800); return; }
    if (id === 'task') { window.RailConversation?.handOver({ mode: 'task', project: w.title, about: { kind: 'Workspace', name: w.title } }); return; }
    if (id === 'edit') { editing = editing === w.id && here() ? '' : w.id; if (here() && current === w.id) redraw(); else go(w.id); return; }
    if (id === 'delete') { confirm = w; if (current === w.id) redraw(); else go(w.id); }
  }
  function mapOf(w, list) {
    const nodes = list.map(([p, s]) => { const also = others(w, p)[0], r = running([p]), bits = [s !== 'ok' ? (s === 'behind' ? `Out of sync, ${(window.RailProjects?.list() || []).find((x) => x.id === p)?.behind || ''} behind` : WORD[s]) : '', r ? `${r} running` : '', also ? `Also in ${also.title}` : ''].filter(Boolean);
      return { id: p, title: p, status: bits[0] || '', tone: s === 'missing' ? 'fail' : s === 'diverged' ? 'ask' : '', attrs: { 'data-pj-go': `${p}@${w.id}`, title: `${p}${bits.length ? ` · ${bits.join(' · ')}` : ''}` } }; });
    return R.workspaceMap({ label: `How ${w.title} connects`, nodes, links: w.links.filter((l) => l.state !== 'rejected').map((l) => ({ from: l.from, to: l.to, word: `${l.how.split(' ')[0]}${unsure(l) ? '?' : ''}`, unsure: unsure(l) })) });
  }
  const syncItem = (w) => { const none = !live(w).projects.some(([, s]) => s === 'behind'); return { id: 'sync', text: 'Sync what is behind', help: none ? 'Nothing here is behind' : 'Fast-forwards each project that is behind', off: none }; };
  const scanOff = (w) => (w.scanning ? 'It is being read now' : !w.projects.length ? 'No projects to read yet' : w.projects.every(([, s]) => s === 'missing') ? 'Every folder here is missing: nothing to read' : '');
  // the same menu on its row in the bar and on its head; the head has Scan again beside its map
  const menuOf = (w, scan) => [...(scan ? [{ id: 'scan', text: 'Scan again', help: scanOff(live(w)) || 'Reads every project and maps how they connect', off: !!scanOff(w) }] : []), { id: 'edit', text: 'Edit by hand', help: 'Which projects it holds; a draft until you save it' }, syncItem(w), { id: 'task', text: 'New task across it', help: 'The composer, on this workspace' }, { sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'Its projects stay' }];
  function pageHtml(w0) {
    const w = shown(live(w0)), q = questions(w), ids = w.projects.map(([p]) => p);
    const more = R.moreMenu({ id: 'ws-more', label: `More for ${w.title}`, icon: R.icon('more', 16), open: menu === 'ws-more', items: menuOf(w0, false) });
    const head = R.placeHead({ title: w.title, facts: esc(w.projects.length ? [w.projects.length === 1 ? '1 project' : `${w.projects.length} projects that work together`, ids.reduce((a, p) => a + (window.RailProjects?.spend(p) || 0), 0) ? `$${ids.reduce((a, p) => a + (window.RailProjects?.spend(p) || 0), 0)} this month` : '', running(ids) ? `${running(ids)} running` : ''].filter(Boolean).join(' · ') : 'No projects yet'), mark: R.kindMark({ kind: 'workspace', tone: toneOf(w0) }), word: w0.fresh ? 'New workspace' : q.length ? `${n(q.length, 'question')} for you` : toneOf(w0) === 'idle' ? 'All well' : lines(w0)[0]?.[0] || '', why: '',
      action: R.button({ label: 'Change projects or links in a chat', kind: q.length ? 'quiet' : '', attrs: { 'data-ws': 'chat', title: 'Worca proposes the change as a card; you apply it' } }) , menu: more });
    const strip = confirm === w0 ? R.confirmStrip({ text: `Delete ${w.title}? Its projects stay; its map and history go.`, yes: 'Delete', danger: true }) : '';
    const draft = w0.draft ? R.draftBar({ changes: w0.draft.changes, fresh: !!w0.fresh, hooks: { save: { 'data-draft-save': '' }, discard: { 'data-draft-discard': '' } } }) : '';
    const ask = q.map((l) => R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: `<b>Is this right: ${esc(l.from)} ${esc(l.how)} ${esc(l.to)}?</b> ${SAYS_SURE[l.sure]}${R.shows('expert') ? ` (${PCT[l.sure]}%)` : ''}${l.at ? ` · ${R.textLink({ label: l.at, attrs: { 'data-ws-at': l.at, title: 'Where Worca read this' } })}` : ''}`, end: R.button({ label: 'Yes', attrs: { 'data-ws-yes': w0.links.indexOf(l) } }) + R.button({ label: 'No', kind: 'quiet', attrs: { 'data-ws-no': w0.links.indexOf(l) } }) })).join('');
    const about = w.about ? `<p class="ws-about">${esc(w.about)} Worca tells every task here how they fit together.</p>` : '';
    const boxes = R.workspaceBoxes({ boxes: [boxOf(w0)], openId: w.id, openTitle: w.title, openHead: `<p class="wb-age">${w0.scanning ? 'Reading its projects…' : w.scanned === 'never' ? 'Not mapped yet' : `Its map is from ${esc(w.scanned)}`} ${!scanOff(w0) ? R.button({ label: 'Scan again', kind: 'quiet', attrs: { 'data-ws': 'scan', title: 'Reads every project and maps how they connect' } }) : R.tooltip({ text: scanOff(w0), off: true, html: R.button({ label: 'Scan again', kind: 'quiet', attrs: { disabled: true } }) })}</p>`, open: ids.length ? mapOf(w, w.projects) : '<p class="wf-ed-m">No projects yet: Edit by hand, or say which in the chat below.</p>' });
    const order = w.links.length && ids.length > 1 ? `<h3 class="ws-h">A change across it goes in this order</h3><p class="ws-order">${R.workspaceOrder(ids, w.links.filter((l) => l.state !== 'rejected')).map((p) => `<b>${esc(p)}</b>`).join(' <span>then</span> ')}</p><p class="wf-ed-m">What is used goes before what uses it.${q.length ? ` This order depends on your ${q.length === 1 ? 'answer' : `${q.length} answers`} above.` : ''}</p><div class="wf-acts">${R.button({ label: `Start a task across all ${ids.length}`, kind: q.length ? 'quiet' : '', attrs: { 'data-ws': 'task' } })}</div>` : '';
    const links = w.links.length ? `<div class="wf-acts open-line">${R.button({ label: linksOpen ? 'Hide how they connect' : `How they connect · ${w.links.length}`, kind: 'quiet', icon: R.icon(linksOpen ? 'chevron' : 'chevR', 12), attrs: { 'data-ws-links': '', 'aria-expanded': String(linksOpen), 'data-folds': '.ws-links' } })}</div>${linksOpen ? `<div class="ws-links">${R.settingsSection({ rows: w.links.map((l) => { const i = w0.links.indexOf(l); return R.settingsRow({ name: l.state === 'confirmed' ? 'Confirmed' : l.state === 'rejected' ? 'Rejected' : SURE[l.sure], sentence: `<b>${esc(l.from)}</b> ${esc(l.how)} <b>${esc(l.to)}</b> · ${esc(l.kind)}`, end: l.state === 'auto' ? (unsure(l) ? R.button({ label: 'Confirm', kind: 'quiet', attrs: { 'data-ws-yes': i } }) : '') + R.button({ label: 'Reject', kind: 'quiet', attrs: { 'data-ws-no': i } }) : R.button({ label: 'Undo', kind: 'quiet', attrs: { 'data-ws-undo': i } }) }); }).join('') })}</div>` : ''}` : '';
    const free = (window.RailProjects?.list() || []).map((p) => p.id).filter((id) => !ids.includes(id));
    const edit = editing === w0.id ? R.settingsSection({ title: 'Its projects', meta: 'By hand: a draft until you save it.', rows: w.projects.map(([p], i) => R.settingsRow({ name: p, sentence: others(w0, p).length ? `Also in ${esc(others(w0, p).map((x) => x.title).join(', '))}` : '', end: R.button({ label: 'Take out', kind: 'quiet', attrs: { 'data-ws-rm': i, title: `${p} leaves the workspace; the project stays` } }) })).join('')
      + (free.length ? R.settingsRow({ name: 'Add one', sentence: `Add ${R.sentencePicker({ id: 'ws-add', text: 'a project', items: free.map((o) => ({ id: o, text: o })), open: menu === 'ws-add', chevron: R.icon('chevron', 10) })}` }) : '') }) : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${draft}${ask}${about}</div><div class="convo-col">${boxes}</div><div class="convo-col">${edit}${order}${links}${window.RailPlaces.projects.defaults(w0, [])}</div></div><div class="convo-dock" id="ws-dock"></div></div>`;
  }
  const here = () => location.hash === `#projects/ws:${current}`;   // this workspace is the one open: a click that just left the page is not ours
  // keys.esc-strip: Esc closes Edit by hand while nothing has changed; a draft stays until you save or discard it
  R.dismissOnOutside(document, { open: () => here() && !!editing && !confirm && !data.spaces.find((x) => x.id === editing)?.draft, inside: () => true, close: () => { editing = ''; }, paint: () => redraw() });
  function touch(w, fn) { w.draft ||= { projects: structuredClone(w.projects), changes: 0 }; fn(w.draft); w.draft.changes += 1; }
  function render(el, id) {
    if (page !== el) { page = el; wire(); }
    if (current !== id) { menu = ''; if (confirm && confirm.id !== id) confirm = null; }
    current = id; const w = data.spaces.find((x) => x.id === id); if (!w) { go(''); return; }
    el.innerHTML = pageHtml(w);
    window.RailConversation?.dock(document.getElementById('ws-dock'), { kind: 'workspace', title: w.title, chat: '' });
  }
  function wire() {
    page.addEventListener('click', (e) => {
      if (!here()) return;
      const on = (q) => e.target.closest(q); let hit; const w = data.spaces.find((x) => x.id === current); if (!w) return;
      if ((hit = on('[data-ws]'))) { const v = hit.dataset.ws; if (v === 'chat') window.RailConversation?.handOver({ project: w.title, about: { kind: 'Workspace', name: w.title }, ph: `What should change in ${w.title}?` }); else if (v === 'edit') { editing = editing === w.id ? '' : w.id; redraw(); } else act(v, w); return; }
      if (window.RailPlaces.projects.defaultsClick(e, w, redraw)) return;
      if ((hit = on('[data-ws-at]'))) { say(`Would open ${hit.dataset.wsAt} in your editor`); return; }
      if (on('[data-ws-links]')) { linksOpen = !linksOpen; redraw(); return; }
      if ((hit = on('[data-ws-rm]'))) { const i = +hit.dataset.wsRm; touch(w, (d) => { d.projects.splice(i, 1); }); redraw(); say(`${w.title}: kept as a draft`); return; }
      if ((hit = on('[data-ws-yes], [data-ws-no], [data-ws-undo]'))) { const l = w.links[+(hit.dataset.wsYes ?? hit.dataset.wsNo ?? hit.dataset.wsUndo)]; l.state = hit.dataset.wsYes !== undefined ? 'confirmed' : hit.dataset.wsNo !== undefined ? 'rejected' : 'auto'; redraw(); say(l.state === 'auto' ? 'Back to what the scan found' : `${l.state[0].toUpperCase()}${l.state.slice(1)}: ${l.from} ${l.how} ${l.to}`, l.state === 'auto' ? undefined : { tip: 'Back to what the scan found', run: () => { l.state = 'auto'; redraw(); } }); return; }
      if (on('[data-draft-save]')) { const kept = shown(w).links; w.projects = structuredClone(w.draft.projects); w.links = kept; delete w.draft; delete w.fresh; editing = ''; redraw(); say(`Saved ${w.title}; a short scan maps what changed`); return; }
      if (on('[data-draft-discard]')) { if (w.fresh) { data.spaces.splice(data.spaces.indexOf(w), 1); go(''); say(`Discarded ${w.title}`); return; } delete w.draft; editing = ''; redraw(); say(`Discarded the draft of ${w.title}`); return; }
      if (confirm === w && (hit = on('[data-confirm]'))) { if (hit.dataset.confirm === 'yes') { const i = data.spaces.indexOf(w); data.spaces.splice(i, 1); confirm = null; say(`Deleted ${w.title}`, () => { data.spaces.splice(i, 0, w); redraw(); }); go(''); } else { confirm = null; redraw(); } return; }
      if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); menu = ''; if (id === 'ws-add') { touch(w, (d) => { d.projects.push([v, 'ok']); }); redraw(); say(`${w.title}: kept as a draft`); } else act(v, w); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; redraw(); }
    });
    page.addEventListener('keydown', (e) => { if (!here()) return; const w = data.spaces.find((x) => x.id === current); if (w) window.RailPlaces.projects.defaultsKey(e, w, redraw); });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: redraw });
  }
  if (window.RailFirstRun) data.spaces = [];   // the first run: nothing added yet
  const idOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  window.RailSpaces = { list: () => data.spaces, render, boxOf, toneOf, act, syncItem, menu: menuOf, named: (title) => data.spaces.find((w) => w.id === idOf(title) || w.title.toLowerCase() === title.toLowerCase()), hint: (w) => n(w.projects.length, 'project'), rowWord: (w) => (questions(w).length ? n(questions(w).length, 'question') : lines(w)[0]?.[0] && toneOf(w) !== 'idle' ? (toneOf(w) === 'fail' ? 'Folder missing' : 'Out of sync') : ''),
    member: (id) => data.spaces.some((w) => w.projects.some(([p]) => p === id)),
    forget: (id) => { const was = data.spaces.map((w) => [w, w.projects, w.links, w.draft?.projects]), keep = ([p]) => p !== id; for (const w of data.spaces) { w.projects = w.projects.filter(keep); w.links = w.links.filter((l) => l.from !== id && l.to !== id); if (w.draft) w.draft.projects = w.draft.projects.filter(keep); } return () => was.forEach(([w, projects, links, draft]) => { Object.assign(w, { projects, links }); if (w.draft && draft) w.draft.projects = draft; }); },   // a project removed from Worca leaves every workspace; the undo puts it back
    remove: (id) => { data.spaces = data.spaces.filter((w) => w.id !== id); },
    add: ({ title, projects = [], fresh = false }) => { const id = idOf(title); if (!data.spaces.some((w) => w.id === id)) data.spaces.push({ id, title, home: '', runs: 0, scanned: fresh ? 'never' : 'just now', model: '', about: '', projects: fresh ? [] : projects.map((p) => [p, 'ok']), links: [], ...(fresh ? { fresh: true, draft: { projects: projects.map((p) => [p, 'ok']), changes: 0 } } : {}) }); if (fresh) editing = id; return id; } };
})();
