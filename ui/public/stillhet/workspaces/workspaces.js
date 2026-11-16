// Workspaces on Rail (Wave 3, second pass; mock plans/rail/mocks/wave-3/scope-2): organizational: a named set of projects
// and the map of how they connect. They live inside the one Projects place, from Advanced (projects/ws:<id>): its box on
// the home, opened in place as its map; what Worca is unsure of comes first as yes-or-no questions. Chat first: a page
// ends with the composer, Change projects or links in a chat leads; Edit by hand is the manual way, a draft until saved (rail.drafts).
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const WORD = { ok: '', behind: 'Your copy is older', diverged: 'Out of sync', missing: 'Folder missing' };
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
  let current = '', menu = '', confirm = null, page = null, linksOpen = false, editing = '', opening = '';
  const SURE = { exact: 'Certain', verified: 'Checked', heuristic: 'Fairly sure', inferred: 'A guess' }, PCT = { exact: 100, verified: 95, heuristic: 72, inferred: 40 };
  const SAYS_SURE = { heuristic: 'Worca is fairly sure', inferred: 'Worca is guessing' };
  const ORIGIN_TO = { ok: 'ok', behind: 'behind', diverged: 'diverged', missing: 'missing', offline: 'behind', uncommitted: 'behind', local: 'ok', folder: 'ok' };
  const shown = (w) => { if (!w.draft) return w; const ids = w.draft.projects.map(([p]) => p); return { ...w, projects: w.draft.projects, links: w.links.filter((l) => ids.includes(l.from) && ids.includes(l.to)) }; };   // a project taken out takes its links and questions with it
  const live = (w) => { const P = window.RailProjects?.list() || []; w.projects = w.projects.map(([id, st]) => { const p = P.find((x) => x.id === id); return [id, p ? ORIGIN_TO[p.origin] || st : st]; }); return w; };   // one truth: Projects
  // F-G-G4-02: the description is markdown (dev's workspace file): the library's Prose, loaded once, then the page redraws
  let proseAsked = false;
  const aboutProse = (text) => { if (!proseAsked) { proseAsked = true; R.loadProse({ doc: document }).then((ok) => { if (ok && current) redraw(); }); } return R.prose({ text, doc: document }); };
  const pn = (id) => window.RailProjects?.nameOfKey?.(id) || id;   // F-G-G5-06: a link names its projects by name, never by key
  const unsure = (l) => l.state === 'auto' && !!SAYS_SURE[l.sure];   // what Worca is certain of or checked is no question, and is drawn solid
  const questions = (w) => w.links.filter(unsure);
  const running = (ids) => (window.RailChats?.data().chats || []).filter((c) => ids.includes(c.project)).flatMap((c) => c.tasks || []).filter((t) => t.kind !== 'schedule' && R.markTone(R.runState(window.RunCardModel.stateOf(t.case))) === 'run').length;   // running means running; what waits on you is said as such
  const toneOf = (w) => { const s = live(w).projects.map(([, x]) => x); return s.includes('missing') ? 'fail' : s.includes('diverged') || questions(w).length ? 'ask' : 'idle'; };
  const others = (w, id) => data.spaces.filter((x) => x !== w && x.projects.some(([p]) => p === id));
  const n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
  function lines(w) {
    const out = []; live(w);
    w.projects.forEach(([p, s]) => { if (s === 'missing') out.push([`${pn(p)}: folder missing`, 'fail']); if (s === 'diverged') out.push([`${pn(p)} is out of sync`, 'ask']); });
    if (questions(w).length) out.push([n(questions(w).length, 'question') + ' for you', 'ask']);
    const r = running(w.projects.map(([p]) => p)); if (r) out.push([`${n(r, 'task')} running`]);
    const shared = w.projects.map(([p]) => [p, others(w, p)[0]]).find(([, o]) => o); if (shared) out.push([`shares ${pn(shared[0])} with ${shared[1].title}`]);
    return out.slice(0, 4);
  }
  const boxOf = (w) => ({ id: w.id, title: w.title, count: n(w.projects.length, 'project'), lines: lines(w), attrs: { 'data-pj-go': `ws:${w.id}`, title: `Opens ${w.title} here` } });
  const go = (id) => window.RailShell.go(id ? `projects/ws:${id}` : 'projects');
  // the live kind (slice 9 D4): every write runs its live branch first, through the live module; the demo branch is unchanged
  const isLive = () => window.RailAdapter?.kind === 'live';
  const LIVE = () => (isLive() ? window.RailProjectsLive || null : null);
  const busyOf = (id) => LIVE()?.pending(id) || '';   // what dev is doing for it now (D22): its control says so, disabled
  const UNDO_MS = 5000;   // the toast's undo window (pulse.js): Delete waits for it (D14)
  const redraw = () => window.RailPlaces.projects.redraw();
  const said = (a) => { if (a?.text) say(a.text); redraw(); };
  function act(id, w) {
    if (id === 'sync' && LIVE()) { LIVE().syncBehind(w.id).then(said); redraw(); return; }   // D14: dev's ff sync, member by member
    if (id === 'scan' && LIVE()) { if (busyOf(w.id)) return; LIVE().scan(w.id).then(said); redraw(); return; }
    if (id === 'sync') { const of = (st) => live(w).projects.filter(([, s]) => s === st).map(([p]) => p), behind = of('behind'), diverged = of('diverged'); behind.forEach((p) => window.RailProjects.sync(p)); redraw(); say(`Synced ${n(behind.length, 'project')} in ${w.title}${diverged.length ? `; ${diverged.map(pn).join(', ')} ${diverged.length === 1 ? 'has' : 'have'} diverged and ${diverged.length === 1 ? 'was' : 'were'} left alone` : ''}`); return; }
    if (id === 'scan') { if (w.scanning) return; const gone = live(w).projects.filter(([, s]) => s === 'missing').map(([p]) => p); w.scanning = true; redraw(); say(`Reading ${w.title}${gone.length ? `; skips ${gone.map(pn).join(', ')}, folder missing` : ''}`); setTimeout(() => { w.scanning = false; w.scanned = 'just now'; redraw(); say(`Mapped ${w.title}`); }, 1800); return; }
    if (id === 'task') { window.RailConversation?.handOver({ mode: 'task', project: w.title, ref: { pageWorkspaceId: w.id }, about: { kind: 'Workspace', name: w.title } }); return; }
    if (id === 'edit') { editing = editing === w.id && here() ? '' : w.id; if (here() && current === w.id) redraw(); else go(w.id); return; }
    if (id === 'delete') { confirm = w; if (current === w.id) redraw(); else go(w.id); }
  }
  function mapOf(w, list) {
    const nodes = list.map(([p, s]) => { const also = others(w, p)[0], r = running([p]), bits = [s !== 'ok' ? WORD[s] : '', r ? `${r} running` : '', also ? `Also in ${also.title}` : ''].filter(Boolean);
      return { id: p, title: pn(p), status: bits[0] || '', tone: s === 'missing' ? 'fail' : s === 'diverged' ? 'ask' : '', attrs: { 'data-pj-go': `${p}@${w.id}`, title: `${pn(p)}${bits.length ? ` · ${bits.join(' · ')}` : ''}` } }; });
    return R.workspaceMap({ label: `How ${w.title} connects`, nodes, links: w.links.filter((l) => l.state !== 'rejected').map((l) => ({ from: l.from, to: l.to, word: `${l.how.split(' ')[0]}${unsure(l) ? '?' : ''}`, unsure: unsure(l) })) });
  }
  const syncItem = (w) => { const none = !live(w).projects.some(([, s]) => s === 'behind'), busy = busyOf(w.id) === 'Syncing…'; return { id: 'sync', text: busy ? 'Syncing…' : 'Sync what is behind', help: none ? 'Nothing here is behind' : 'Fast-forwards each project that is behind', off: none || busy }; };
  const scanOff = (w) => (w.scanning || busyOf(w.id) === 'Scanning…' ? 'It is being read now' : !w.projects.length ? 'No projects to read yet' : w.projects.every(([, s]) => s === 'missing') ? 'Every folder here is missing: nothing to read' : '');
  // the same menu on its row in the bar and on its head; the head has Scan again beside its map
  const menuOf = (w, scan) => (w.fresh && LIVE() ? [{ id: 'edit', text: 'Edit by hand', help: 'Which projects it holds; a draft until you save it' }, { sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'A draft: nothing was saved yet' }]   // a live draft is not in dev yet: nothing to scan, sync or start
    : [...(scan ? [{ id: 'scan', text: 'Scan again', help: scanOff(live(w)) || 'Reads every project and maps how they connect', off: !!scanOff(w) }] : []), { id: 'edit', text: 'Edit by hand', help: 'Which projects it holds; a draft until you save it' }, syncItem(w), { id: 'task', text: 'New task across it', help: 'The composer, on this workspace' }, { sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'Its projects stay' }]);
  function pageHtml(w0) {
    const w = shown(live(w0)), q = questions(w), ids = w.projects.map(([p]) => p);
    const more = R.moreMenu({ id: 'ws-more', label: `More for ${w.title}`, icon: R.icon('more', 16), open: menu === 'ws-more', items: menuOf(w0, false) });
    const head = R.placeHead({ center: { label: 'Projects', to: 'projects' }, title: w.title, facts: esc(w.projects.length ? [w.projects.length === 1 ? '1 project' : `${w.projects.length} projects that work together`, ids.reduce((a, p) => a + (window.RailProjects?.spend(p) || 0), 0) ? `$${Math.round(ids.reduce((a, p) => a + (window.RailProjects?.spend(p) || 0), 0)).toLocaleString('en-US')} this month` : '', running(ids) ? `${running(ids)} running` : ''].filter(Boolean).join(' · ') : 'No projects yet'), mark: R.kindMark({ kind: 'workspace', tone: toneOf(w0) }), word: w0.fresh ? 'New workspace' : q.length ? `${n(q.length, 'question')} for you` : toneOf(w0) === 'idle' ? 'All well' : lines(w0)[0]?.[0] || '', why: '',
      action: R.button({ label: 'Change projects or links in a chat', kind: q.length ? 'quiet' : '', attrs: { 'data-ws': 'chat', title: 'Worca proposes the change as a card; you apply it' } }) , menu: more });
    const strip = confirm === w0 ? R.confirmStrip({ text: `Delete ${w.title}? Its projects stay; its map and history go.`, yes: 'Delete', danger: true }) : '';
    const saving = busyOf(w0.id) === 'Saving…';
    const draft = w0.draft ? R.draftBar({ changes: w0.draft.changes, fresh: !!w0.fresh, save: saving ? 'Saving…' : 'Save', hooks: { save: { 'data-draft-save': '', disabled: saving }, discard: { 'data-draft-discard': '', disabled: saving } } }) : '';
    const ask = q.map((l) => R.turnRow({ mark: R.kindMark({ kind: 'chat', tone: 'ask', size: 16 }), text: `<b>Is this right: ${esc(pn(l.from))} ${esc(l.how)} ${esc(pn(l.to))}?</b> ${SAYS_SURE[l.sure]}${R.shows('expert') ? ` (${PCT[l.sure]}%)` : ''}${l.at ? ` · ${R.textLink({ label: busyOf(`open:${w0.id}`) && opening === l.at ? busyOf(`open:${w0.id}`) : l.at, attrs: { 'data-ws-at': l.at, 'data-ws-from': l.from, title: 'Where Worca read this', disabled: !!busyOf(`open:${w0.id}`) && opening === l.at } })}` : ''}`, end: busyOf(`edge:${l.id}`) ? R.button({ label: busyOf(`edge:${l.id}`), attrs: { disabled: true } }) : R.button({ label: 'Yes', attrs: { 'data-ws-yes': w0.links.indexOf(l) } }) + R.button({ label: 'No', kind: 'quiet', attrs: { 'data-ws-no': w0.links.indexOf(l) } }) })).join('');
    const about = w.about ? `<div class="ws-about">${aboutProse(w.about)}<p>Worca tells every task here how they fit together.</p></div>` : '';   // F-G-G4-02: its description is markdown, drawn as Prose
    const boxes = R.workspaceBoxes({ boxes: [boxOf(w0)], openId: w.id, openTitle: w.title, openHead: `<p class="wb-age">${w0.scanning ? 'Reading its projects…' : w.scanned === 'never' ? 'Not mapped yet' : `Its map is from ${esc(w.scanned)}`} ${!scanOff(w0) ? R.button({ label: 'Scan again', kind: 'quiet', attrs: { 'data-ws': 'scan', title: 'Reads every project and maps how they connect' } }) : R.tooltip({ text: scanOff(w0), off: true, html: R.button({ label: busyOf(w0.id) === 'Scanning…' ? 'Scanning…' : 'Scan again', kind: 'quiet', attrs: { disabled: true } }) })}</p>`, open: ids.length ? mapOf(w, w.projects) : '<p class="wf-ed-m">No projects yet: Edit by hand, or say which in the chat below.</p>' });
    const order = w.links.length && ids.length > 1 ? `<h3 class="ws-h">A change across it goes in this order</h3><p class="ws-order">${R.workspaceOrder(ids, w.links.filter((l) => l.state !== 'rejected')).map((p) => `<b>${esc(pn(p))}</b>`).join(' <span>then</span> ')}</p><p class="wf-ed-m">What is used goes before what uses it.${q.length ? ` This order depends on your ${q.length === 1 ? 'answer' : `${q.length} answers`} above.` : ''}</p><div class="wf-acts">${R.button({ label: `Start a task across all ${ids.length}`, kind: q.length ? 'quiet' : '', attrs: { 'data-ws': 'task' } })}</div>` : '';
    const links = w.links.length ? `<div class="wf-acts open-line">${R.button({ label: linksOpen ? 'Hide how they connect' : `How they connect · ${w.links.length}`, kind: 'quiet', icon: R.icon(linksOpen ? 'chevron' : 'chevR', 12), attrs: { 'data-ws-links': '', 'aria-expanded': String(linksOpen), 'data-folds': '.ws-links' } })}</div>${linksOpen ? `<div class="ws-links">${R.settingsSection({ rows: w.links.map((l) => { const i = w0.links.indexOf(l); return R.settingsRow({ name: l.state === 'confirmed' ? 'Confirmed' : l.state === 'rejected' ? 'Rejected' : l.state === 'manual' ? 'Added by hand' : SURE[l.sure], sentence: `<b>${esc(pn(l.from))}</b> ${esc(l.how)} <b>${esc(pn(l.to))}</b> · ${esc(l.kind)}`, end: l.state === 'auto' ? (unsure(l) ? R.button({ label: 'Confirm', kind: 'quiet', attrs: { 'data-ws-yes': i } }) : '') + R.button({ label: 'Reject', kind: 'quiet', attrs: { 'data-ws-no': i } }) : l.state === 'manual' ? '' : R.button({ label: 'Undo', kind: 'quiet', attrs: { 'data-ws-undo': i } }) }); }).join('') })}</div>` : ''}` : '';
    const free = (window.RailProjects?.list() || []).map((p) => p.id).filter((id) => !ids.includes(id));
    // form.workspace-edit: its name first, then its projects; both a draft until Save
    const nameRow = R.settingsRow({ name: 'Name', sentence: R.field({ id: 'ws-name', label: 'Its name', quietLabel: true, value: w0.draft?.name ?? w0.title, attrs: { maxlength: 80, 'data-ws-name': '' } }) });
    const edit = editing === w0.id ? R.settingsSection({ title: 'Its projects', meta: 'By hand: a draft until you save it.', rows: nameRow + w.projects.map(([p], i) => R.settingsRow({ name: pn(p), sentence: others(w0, p).length ? `Also in ${esc(others(w0, p).map((x) => x.title).join(', '))}` : '', end: R.button({ label: 'Take out', kind: 'quiet', attrs: { 'data-ws-rm': i, title: `${pn(p)} leaves the workspace; the project stays` } }) })).join('')
      + (free.length ? R.settingsRow({ name: 'Add one', sentence: `Add ${R.sentencePicker({ id: 'ws-add', text: 'a project', items: free.map((o) => ({ id: o, text: pn(o) })), open: menu === 'ws-add', chevron: R.icon('chevron', 10) })}` }) : '') }) : '';
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${draft}${ask}${about}</div><div class="convo-col">${boxes}</div><div class="convo-col">${edit}${order}${links}${window.RailPlaces.projects.defaults(withDefaults(w0), [])}</div></div><div class="convo-dock" id="ws-dock"></div></div>`;
  }
  const here = () => location.hash === `#projects/ws:${current}`;   // this workspace is the one open: a click that just left the page is not ours
  // keys.esc-strip: Esc closes Edit by hand while nothing has changed; a draft stays until you save or discard it
  R.dismissOnOutside(document, { open: () => here() && !!editing && !confirm && !data.spaces.find((x) => x.id === editing)?.draft, inside: () => true, close: () => { editing = ''; }, paint: () => redraw() });
  function touch(w, fn) { w.draft ||= { projects: structuredClone(w.projects), changes: 0 }; fn(w.draft); w.draft.changes += 1; }
  // form.workspace-edit: a typed name joins the draft; the same name as now is no change
  function readName(w) { const el = page?.querySelector('#ws-name'); if (!el) return; const v = el.value.trim(); if (!v || v === (w.draft?.name ?? w.title)) return; touch(w, (d) => { d.name = v === w.title ? undefined : v; }); }
  function render(el, id) {
    if (page !== el) { page = el; wire(); }
    if (current !== id) { menu = ''; if (confirm && confirm.id !== id) confirm = null; }
    current = id; const w = data.spaces.find((x) => x.id === id);
    if (!w && window.RailWorld?.live && window.RailDemoState?.list === 'loading') { el.innerHTML = R.listState({ state: 'loading', noun: 'this workspace' }); return; }   // F-G-G4-01: a fresh load or a shared link waits for the first read, never the home
    if (!w) { go(''); return; }
    el.innerHTML = pageHtml(w);
    window.RailConversation?.dock(document.getElementById('ws-dock'), { kind: 'workspace', title: w.title, chat: '', ref: { pageWorkspaceId: w.id } });   // D16: the page's workspace, as dev's context
  }
  // A link's answer in the live kind (D10, slice 9 D3): dev's edge PUT through the live module; the page changes only once
  // the server answered ok and the map is read again, and a refusal keeps the question with the shell's one line.
  const answerWords = (l, state) => `${state[0].toUpperCase()}${state.slice(1)}: ${pn(l.from)} ${l.how} ${pn(l.to)}`;
  function answerLive(w, l, state) {
    LIVE().answer(w.id, l.id, state).then((a) => {
      if (!a.ok) { if (a.text) say(a.text); redraw(); return; }
      redraw();
      say(state === 'auto' ? 'Back to what the scan found' : answerWords(l, state), state === 'auto' ? undefined : { tip: 'Back to what the scan found', run: () => answerLive(w, l, 'auto') });
    });
    redraw();
  }
  // a workspace's own cost tags and Labels, live (D19): read on open, saved through the live module
  function withDefaults(w) {
    const L = LIVE(); if (!L || w.fresh) return w;
    const d = L.spaceDetail(w.id), ready = d.status === 'ready';   // a PUT built from defaults not read yet would wipe its cost tags
    return Object.assign(w, { tags: d.tags || [], labels: d.labels || [], saving: busyOf(`${w.id}#defaults`), off: ready ? '' : d.status === 'failed' ? 'Could not read its settings; open the page again to retry' : 'Reading its settings…',
      persist: ready ? (next, msg) => L.saveSpaceDefaults(w.id, next).then((a) => { say(a.ok ? msg : a.text); redraw(); }) : undefined });
  }
  function wire() {
    page.addEventListener('click', (e) => {
      if (!here()) return;
      const on = (q) => e.target.closest(q); let hit; const w = data.spaces.find((x) => x.id === current); if (!w) return;
      if ((hit = on('[data-ws]'))) { const v = hit.dataset.ws; if (v === 'chat') window.RailConversation?.handOver({ project: w.title, ref: { pageWorkspaceId: w.id }, about: { kind: 'Workspace', name: w.title }, ph: `What should change in ${w.title}?` }); else if (v === 'edit') { editing = editing === w.id ? '' : w.id; redraw(); } else act(v, w); return; }
      if (window.RailPlaces.projects.defaultsClick(e, withDefaults(w), redraw)) return;
      if ((hit = on('[data-ws-at]')) && LIVE()) { opening = hit.dataset.wsAt; LIVE().openInEditor(w.id, hit.dataset.wsFrom, hit.dataset.wsAt).then(said); redraw(); return; }   // D15: dev opens the evidence file
      if ((hit = on('[data-ws-at]'))) { say(window.RailWould(`open ${hit.dataset.wsAt} in your editor`)); return; }
      if (on('[data-ws-links]')) { linksOpen = !linksOpen; redraw(); return; }
      if ((hit = on('[data-ws-rm]'))) { const i = +hit.dataset.wsRm; touch(w, (d) => { d.projects.splice(i, 1); }); redraw(); say(`${w.title}: kept as a draft`); return; }
      if ((hit = on('[data-ws-yes], [data-ws-no], [data-ws-undo]')) && LIVE()) { const l = w.links[+(hit.dataset.wsYes ?? hit.dataset.wsNo ?? hit.dataset.wsUndo)]; if (l) answerLive(w, l, hit.dataset.wsYes !== undefined ? 'confirmed' : hit.dataset.wsNo !== undefined ? 'rejected' : 'auto'); return; }
      if ((hit = on('[data-ws-yes], [data-ws-no], [data-ws-undo]'))) { const l = w.links[+(hit.dataset.wsYes ?? hit.dataset.wsNo ?? hit.dataset.wsUndo)]; l.state = hit.dataset.wsYes !== undefined ? 'confirmed' : hit.dataset.wsNo !== undefined ? 'rejected' : 'auto'; redraw(); say(l.state === 'auto' ? 'Back to what the scan found' : `${l.state[0].toUpperCase()}${l.state.slice(1)}: ${l.from} ${l.how} ${l.to}`, l.state === 'auto' ? undefined : { tip: 'Back to what the scan found', run: () => { l.state = 'auto'; redraw(); } }); return; }
      if (on('[data-draft-save]') && LIVE()) { if (busyOf(w.id)) return; readName(w); LIVE().saveSpace(w.id, w.draft).then((a) => { if (a.ok) { delete w.draft; editing = ''; say(a.text); if (a.id && current === w.id && here()) go(a.id); else redraw(); return; } if (a.keep) w.draft = a.keep; said(a); }); redraw(); return; }   // D12, D13: dev's routes, in order
      if (on('[data-draft-save]')) { readName(w); if (w.draft.name) w.title = w.draft.name; const kept = shown(w).links; w.projects = structuredClone(w.draft.projects); w.links = kept; delete w.draft; delete w.fresh; editing = ''; redraw(); say(`Saved ${w.title}; a short scan maps what changed`); return; }
      if (on('[data-draft-discard]') && LIVE() && w.fresh) { LIVE().discardFresh(w.id); go(''); say(`Discarded ${w.title}`); return; }   // a draft sends nothing
      if (on('[data-draft-discard]')) { if (w.fresh) { data.spaces.splice(data.spaces.indexOf(w), 1); go(''); say(`Discarded ${w.title}`); return; } delete w.draft; editing = ''; redraw(); say(`Discarded the draft of ${w.title}`); return; }
      if (confirm === w && (hit = on('[data-confirm]')) && LIVE() && w.fresh) { confirm = null; if (hit.dataset.confirm === 'yes') { LIVE().discardFresh(w.id); go(''); say(`Discarded ${w.title}`); } else redraw(); return; }   // a draft is the client's: nothing to send
      if (confirm === w && (hit = on('[data-confirm]')) && LIVE()) { if (hit.dataset.confirm === 'yes') { const u = LIVE().deferDeleteSpace(w.id, UNDO_MS), t = w.title; confirm = null; say(`Deleted ${t}`, { tip: 'Puts it back', run: () => { if (!u.undo()) say(`Too late to undo: ${t} is being deleted`); } }); go(''); } else { confirm = null; redraw(); } return; }   // D14: DELETE once the undo window closes
      if (confirm === w && (hit = on('[data-confirm]'))) { if (hit.dataset.confirm === 'yes') { const i = data.spaces.indexOf(w); data.spaces.splice(i, 1); confirm = null; say(`Deleted ${w.title}`, () => { data.spaces.splice(i, 0, w); redraw(); }); go(''); } else { confirm = null; redraw(); } return; }
      if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); menu = ''; if (id === 'ws-add') { touch(w, (d) => { d.projects.push([v, 'ok']); }); redraw(); say(`${w.title}: kept as a draft`); } else act(v, w); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; redraw(); }
    });
    page.addEventListener('keydown', (e) => { if (!here()) return; const w = data.spaces.find((x) => x.id === current); if (w) window.RailPlaces.projects.defaultsKey(e, w, redraw); });
    page.addEventListener('change', (e) => { if (!here() || !e.target.matches?.('[data-ws-name]')) return; const w = data.spaces.find((x) => x.id === current); if (w) { readName(w); redraw(); } });   // the Name row is part of the draft
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: redraw });
  }
  // the live kind: dev's workspaces and their maps, as the adapter keeps them (D10); the first run: nothing added yet
  // slice 9: one lasting object per workspace, so its draft survives the store reading it again; a fresh draft (D12) is the
  // live module's until Save; a workspace waiting for its undo window is hidden
  const PAGE_KEYS = new Set(['draft', 'scanning', 'editing', 'defErr', 'defTyped']), views = new Map();
  const viewOf = (w) => { const v = views.get(w.id) || {}; for (const k of Object.keys(v)) if (!PAGE_KEYS.has(k)) delete v[k]; views.set(w.id, Object.assign(v, w)); return v; };
  if (window.RailWorld?.live) Object.defineProperty(data, 'spaces', { get: () => { const L = LIVE(), gone = L?.hidden() || new Set(); return [...(window.RailWorld.part('spaces') || []).filter((w) => !gone.has(w.id)).map(viewOf), ...(L?.drafts() || [])]; }, set: () => {}, configurable: true });
  else if (window.RailFirstRun) data.spaces = [];
  const idOf = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  window.RailSpaces = { list: () => data.spaces, questions, saysSure: SAYS_SURE, render, boxOf, toneOf, act, syncItem, menu: menuOf, named: (title) => data.spaces.find((w) => w.id === idOf(title) || w.title.toLowerCase() === title.toLowerCase()), hint: (w) => n(w.projects.length, 'project'), rowWord: (w) => (questions(w).length ? n(questions(w).length, 'question') : lines(w)[0]?.[0] && toneOf(w) !== 'idle' ? (toneOf(w) === 'fail' ? 'Folder missing' : 'Out of sync') : ''),
    member: (id) => data.spaces.some((w) => w.projects.some(([p]) => p === id)),
    forget: (id) => { const was = data.spaces.map((w) => [w, w.projects, w.links, w.draft?.projects]), keep = ([p]) => p !== id; for (const w of data.spaces) { w.projects = w.projects.filter(keep); w.links = w.links.filter((l) => l.from !== id && l.to !== id); if (w.draft) w.draft.projects = w.draft.projects.filter(keep); } return () => was.forEach(([w, projects, links, draft]) => { Object.assign(w, { projects, links }); if (w.draft && draft) w.draft.projects = draft; }); },   // a project removed from Worca leaves every workspace; the undo puts it back
    remove: (id) => { data.spaces = data.spaces.filter((w) => w.id !== id); },
    add: ({ title, projects = [], fresh = false }) => { if (LIVE()) { const id = LIVE().fresh(title); editing = id; return id; }   /* D12: a client draft until Save */ const id = idOf(title); if (!data.spaces.some((w) => w.id === id)) data.spaces.push({ id, title, home: '', runs: 0, scanned: fresh ? 'never' : 'just now', model: '', about: '', projects: fresh ? [] : projects.map((p) => [p, 'ok']), links: [], ...(fresh ? { fresh: true, draft: { projects: projects.map((p) => [p, 'ok']), changes: 0 } } : {}) }); if (fresh) editing = id; return id; } };
})();
