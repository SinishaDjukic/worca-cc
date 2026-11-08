// Workspaces on Rail (Wave 3, Phase 5): dev's sets of projects and their map, Rail's design. The list in the one bar; a
// workspace's page as a PlaceHead (how its projects stand, one step), then its projects as rows, how they connect as
// sentences ("Web shop calls Payments' REST API") each confirmed or rejected, and what Worca knows of it. Making one is a
// conversation (Chat's New workspace), as Add project is.
(function () {
  const R = window.RailUI;
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const say = (t, undo) => window.RailPulse?.say(t, undo);
  const WORD = { ok: 'Up to date', behind: 'Behind', diverged: 'Diverged', missing: 'Missing on disk' };
  const data = { spaces: [
    { id: 'web-shop', title: 'Web shop', home: 'web-shop', runs: 12, scanned: 'yesterday', model: 'Sonnet 5.5 · medium', about: 'A shop front that calls a payments service, which mails receipts; both share a design kit.',
      projects: [['web-app', 'ok'], ['payments-api', 'ok'], ['design-kit', 'ok'], ['email-service', 'ok']],
      links: [{ from: 'web-app', to: 'payments-api', kind: 'REST API', how: 'calls the API of', sure: 'verified', state: 'confirmed' }, { from: 'payments-api', to: 'email-service', kind: 'queue', how: 'sends receipts through a queue to', sure: 'heuristic', state: 'auto' }, { from: 'web-app', to: 'design-kit', kind: 'build dependency', how: 'builds with it', sure: 'exact', state: 'auto' }] },
    { id: 'iot', title: 'IoT SP Platform', home: '', runs: 0, scanned: '3 days ago', model: 'Sonnet 5.5 · high', about: 'Devices report through a gateway into a time-series store; a dashboard reads it.',
      projects: [['ingest-gateway', 'diverged'], ['device-registry', 'behind'], ['telemetry-db', 'ok'], ['ops-dashboard', 'ok'], ['firmware-sdk', 'ok']],
      links: [{ from: 'ingest-gateway', to: 'telemetry-db', kind: 'shared database', how: 'writes readings to', sure: 'inferred', state: 'auto' }, { from: 'ops-dashboard', to: 'telemetry-db', kind: 'shared database', how: 'reads readings from', sure: 'verified', state: 'auto' }] },
    { id: 'legacy', title: 'Legacy billing', home: '', runs: 0, scanned: 'never', model: '', about: '',
      projects: [['legacy-billing', 'missing'], ['billing-api', 'behind']], links: [] },
  ] };
  let current = '', menu = '', confirm = null, ctl = null, home = null, bar = null, page = null;
  const ORIGIN_TO = { ok: 'ok', behind: 'behind', diverged: 'diverged', missing: 'missing', offline: 'behind', uncommitted: 'behind', local: 'ok', folder: 'ok' };
  const live = (w) => { const P = window.RailProjects?.list() || []; w.projects = w.projects.map(([id, st]) => { const p = P.find((x) => x.id === id); return [id, p ? ORIGIN_TO[p.origin] || st : st]; }); return w; };   // one truth: Projects
  const count = (w) => live(w).projects.reduce((a, [, s]) => ({ ...a, [s]: (a[s] || 0) + 1 }), {});
  const standOf = (w) => { const c = count(w); return ['missing', 'diverged', 'behind', 'ok'].filter((k) => c[k]).map((k) => `${c[k]} ${k === 'ok' ? 'up to date' : WORD[k].toLowerCase()}`).join(' · '); };
  const toneOf = (w) => { const c = count(w); return c.missing ? 'fail' : c.diverged ? 'ask' : c.behind ? 'act' : 'idle'; };
  const rowOf = (w) => ({ key: `ws:${w.id}`, _w: w, title: w.title, mark: R.kindMark({ breathe: w.id !== current, kind: 'workspace', tone: toneOf(w), title: standOf(w) }), end: `${w.projects.length} projects`, current: w.id === current, tip: `${w.title}\n${standOf(w)}`,
    menu: [{ id: 'sync', text: 'Sync what is behind', help: 'Fast-forwards each project that is behind' }, { id: 'scan', text: 'Scan again', help: 'Reads every project and maps how they connect' }, { sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'Its projects stay' }] });
  function act(id, w) {
    if (id === 'sync') { const n = w.projects.filter(([, s]) => s === 'behind').length; w.projects = w.projects.map(([p, s]) => [p, s === 'behind' ? 'ok' : s]); draw(); say(n ? `Synced ${n} ${n === 1 ? 'project' : 'projects'} in ${w.title}` : `Nothing in ${w.title} is behind`); return; }
    if (id === 'scan') { w.scanned = 'just now'; draw(); say(`Scanning ${w.title}: a task reads each project, then maps how they connect`); return; }
    if (id === 'delete') { current = w.id; confirm = w; window.RailShell.go(`workspaces/${w.id}`); draw(); }
  }
  function pageHtml(w) {
    const c = count(w), behind = c.behind || 0;
    const head = R.placeHead({ title: w.title, facts: esc(`${w.projects.length} projects · scanned ${w.scanned}${w.home ? ` · its tasks are recorded in ${w.home}` : ''}`), mark: R.kindMark({ kind: 'workspace', tone: toneOf(w), title: standOf(w) }), word: standOf(w), why: c.diverged ? 'A diverged project asks how to bring it together before its next task' : '',
      action: behind ? R.button({ label: `Sync ${behind} behind`, attrs: { 'data-ws': 'sync' } }) : R.button({ label: 'Scan again', attrs: { 'data-ws': 'scan', title: 'Reads every project and maps how they connect' } }),
      menu: R.moreMenu({ id: 'ws-more', label: `More for ${w.title}`, icon: R.icon('more', 16), open: menu === 'ws-more', items: [{ id: 'scan', text: 'Scan again', help: 'Reads every project and maps how they connect' }, { id: 'task', text: 'New task across it', help: 'The composer, on this workspace' }, { sep: true }, { id: 'delete', text: 'Delete…', danger: true, help: 'Its projects stay' }] }) });
    const strip = confirm === w ? R.confirmStrip({ text: `Delete ${w.title}? Its projects stay; its map and history go.`, yes: 'Delete', danger: true }) : '';
    const others = (window.RailProjects?.list() || []).map((p) => p.id).filter((id) => !w.projects.some(([x]) => x === id));
    const projects = R.settingsSection({ title: 'Its projects', rows: w.projects.map(([p, s], i) => R.settingsRow({ name: p, sentence: esc(WORD[s]), end: w.projects.length > 2 ? R.button({ label: 'Remove', kind: 'quiet', attrs: { 'data-ws-rm': i, title: `${p} leaves the workspace; the project stays` } }) : '' })).join('')
      + (others.length ? R.settingsRow({ name: 'Add one', sentence: `Add ${R.sentencePicker({ id: 'ws-add', text: 'a project', items: others.map((o) => ({ id: o, text: o })), open: menu === 'ws-add', chevron: R.icon('chevron', 10) })}` }) : '') });
    const SURE = { exact: 'certain', verified: 'checked', heuristic: 'likely', inferred: 'a guess' };
    const links = R.settingsSection({ title: 'How they connect', meta: w.links.length ? 'What the scan found; confirm what is right, reject what is not.' : 'Not mapped yet: Scan again reads every project.', rows: w.links.map((l, i) => R.settingsRow({ name: l.state === 'confirmed' ? 'Confirmed' : l.state === 'rejected' ? 'Rejected' : SURE[l.sure][0].toUpperCase() + SURE[l.sure].slice(1), sentence: `<b>${esc(l.from)}</b> ${esc(l.how)} <b>${esc(l.to)}</b> · ${esc(l.kind)}`,
      end: l.state === 'auto' ? R.button({ label: 'Confirm', kind: 'quiet', attrs: { 'data-ws-yes': i } }) + R.button({ label: 'Reject', kind: 'quiet', attrs: { 'data-ws-no': i } }) : R.button({ label: 'Undo', kind: 'quiet', attrs: { 'data-ws-undo': i } }) })).join('') });
    const about = R.settingsSection({ title: 'What Worca knows of it', rows: R.settingsRow({ name: 'In short', sentence: esc(w.about || 'Nothing yet: Scan again writes it.'), end: R.button({ label: 'Change in a chat', kind: 'quiet', attrs: { 'data-ws': 'about' } }) }) + (w.model ? R.settingsRow({ name: 'Scans with', sentence: esc(w.model) }) : '') });
    return `<div class="convo"><div class="convo-scroll"><div class="convo-col">${head}${strip}${projects}${links}${about}</div></div><div class="convo-dock" id="ws-dock"></div></div>`;
  }
  const here = () => (location.hash.slice(1) || '').split('/')[0] === 'workspaces';   // the page area is shared by every place: draw only while this one is open
  function draw() {
    if (!bar || !page || !here()) return;
    ctl?.paint();
    const w = data.spaces.find((x) => x.id === current);
    if (!w) { home ||= window.RailConversation?.mount(page, { mode: 'ask', where: '#route-place', title: 'Make a workspace', note: 'Projects that ship together; Worca maps how they connect, so a task can work across them.' }); home?.show(''); return; }
    home = null; page.innerHTML = pageHtml(w);
    window.RailConversation?.dock(document.getElementById('ws-dock'), { kind: 'workspace', title: w.title, chat: '' });
  }
  function wire(b, pg) {
    bar = b; page = pg;
    ctl = R.listController({ root: bar, spec: { noun: 'workspaces', label: 'Selected workspaces', view: () => ({ state: 'ready', parts: [],
      sections: [{ id: 'needs', title: R.runState('question').word, rows: data.spaces.filter((w) => ['fail', 'ask'].includes(toneOf(w))).map(rowOf) }, { id: 'all', title: 'Workspaces', rows: data.spaces.filter((w) => !['fail', 'ask'].includes(toneOf(w))).map(rowOf) }],
      empty: { text: 'No workspaces yet.', action: 'New workspace' } }),
      can: () => ['menu'], bulk: () => [], act: (id, rows) => rows[0] && act(id, rows[0]._w), open: (r) => window.RailShell.go(`workspaces/${r._w.id}`), word: () => false, say,
      active: () => /^#workspaces/.test(location.hash), emptyAct: () => window.RailConversation?.starter('workspace') } });
    page.addEventListener('click', (e) => {
      if (!here()) return;   /* another place's page is showing */
      const on = (q) => e.target.closest(q); let hit; const w = data.spaces.find((x) => x.id === current); if (!w || !page.querySelector('#ws-dock')) return;
      if ((hit = on('[data-ws]'))) { const v = hit.dataset.ws; if (v === 'about') window.RailConversation?.start('ask', `About ${w.title}: `); else act(v, w); return; }
      if ((hit = on('[data-ws-rm]'))) { const i = +hit.dataset.wsRm, gone = w.projects.splice(i, 1)[0]; draw(); say(`${gone[0]} left ${w.title}`, () => { w.projects.splice(i, 0, gone); draw(); }); return; }
      if ((hit = on('[data-ws-yes], [data-ws-no], [data-ws-undo]'))) { const l = w.links[+(hit.dataset.wsYes ?? hit.dataset.wsNo ?? hit.dataset.wsUndo)]; l.state = hit.dataset.wsYes !== undefined ? 'confirmed' : hit.dataset.wsNo !== undefined ? 'rejected' : 'auto'; draw(); say(l.state === 'auto' ? 'Back to what the scan found' : `${l.state[0].toUpperCase()}${l.state.slice(1)}: ${l.from} ${l.how} ${l.to}`); return; }
      if ((hit = on('[data-confirm]'))) { if (hit.dataset.confirm === 'yes') { const i = data.spaces.indexOf(w); data.spaces.splice(i, 1); confirm = null; current = ''; say(`Deleted ${w.title}`, () => { data.spaces.splice(i, 0, w); draw(); }); window.RailShell.go('workspaces'); } else { confirm = null; draw(); } return; }
      if ((hit = on('[data-menu-pick]'))) { const [id, v] = hit.dataset.menuPick.split('|'); menu = ''; if (id === 'ws-add') { w.projects.push([v, 'ok']); draw(); say(`${v} joined ${w.title}; a short scan maps it`); } else if (v === 'task') window.RailConversation?.start('task'); else act(v, w); return; }
      if ((hit = on('[data-menu]'))) { menu = menu === hit.dataset.menu ? '' : hit.dataset.menu; draw(); }
    });
    R.dismissOnOutside(document, { open: () => here() && !!menu, inside: '#route-place .spick, #route-place .rc-pop', back: () => null, close: () => { menu = ''; }, paint: draw });
  }
  if (window.RailFirstRun) data.spaces = [];   // the first run: nothing added yet
  window.RailPlaces = window.RailPlaces || {};
  window.RailPlaces.workspaces = { sample: 'web-shop', newLabel: 'New workspace', newAct: () => window.RailConversation?.starter('workspace'),
    show: ({ bar: b, page: pg, arg }) => { if (b !== bar) wire(b, pg); if (current !== arg) { menu = ''; if (confirm?.id !== arg) confirm = null; } current = arg || ''; draw(); } };
})();
