// Stillhet B4.5: the project page says the right words. Its head counts this project's waits and says so (F-6-15, V3-12),
// never a bare "On it now:" (V3-05), names and never keys on the page and in the bar (F-6-14), and it draws its head and
// facts before dev's history has landed (F-6-19). The host is test/helpers/stillhet-projects-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, KEYS, sent, gate, settle, go, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { SOURCES, clone } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const page = (d) => d.getElementById('route-place');
const bar = (d) => d.getElementById('bar-place');
const text = (el) => el.textContent.replace(/\s+/g, ' ');
// the head: its PlaceHead and the word line under it, everything above How it stands
const headWord = (d) => text(page(d)).split('How it stands')[0];
const KEY_TEXT = /seed-[a-z]+-[0-9a-f]{8}|wks-[a-z0-9-]+|ghost-[0-9a-f]{8}/;
// the fixture's world (web-1, api-2, gone-3), with Waiting chat (ask_1) pinned to web: its Ask me is a chat ask there,
// and the missed ticket of web is a Needs row of Tasks only
const WORLD = () => { const src = clone(SOURCES); src.threads.threads[0].context = { projectKey: 'web-1' }; return { projects: src.projects, sync: src.sync, threads: src.threads, workspaces: { workspaces: [] } }; };

test('F-6-15/V3-12: the head counts this project\'s waits, says so, and lists the same ones first', async () => {
  const h = await projectsHost({ hash: '#projects/web-1', sources: WORLD() });
  assert.match(headWord(h.d), /2 tasks here need you/);
  const listed = [...page(h.d).querySelectorAll('.lr-t')].map((r) => r.textContent.trim());
  assert.deepEqual(listed.slice(0, 2).sort(), ['Ask me', 'Missed one'], 'a chat ask and a Tasks-only Needs row, both listed first');
  assert.ok(page(h.d).querySelector('[data-pj-open^="ask_1|"]'), 'a chat task opens in its chat');
  assert.ok([...page(h.d).querySelectorAll('[data-c-open]')].some((b) => b.closest('.lr-main, .list-row, [class*="lr"]')), 'a Tasks-only row opens through Tasks');
  assert.doesNotMatch(headWord(h.d), /tasks need you/, 'the head names its scope');
  // cycle-2 minor: a Tasks-only row has no chat here, so its link never says it opens one
  const missed = [...page(h.d).querySelectorAll('[data-c-open]')].filter((b) => /Missed one/.test(b.textContent) || /Missed one/.test(b.title));
  assert.ok(missed.length, 'the Tasks-only row has its link');
  for (const b of missed) assert.doesNotMatch(b.title, /in its chat/, `the Tasks-only row's tip: ${b.title}`);
  assert.match(page(h.d).querySelector('[data-pj-open^="ask_1|"]').title, /in its chat/, 'the chat ask still says its chat');
});

test('V3-05: no empty On it now line when nothing runs', async () => {
  const src = WORLD();
  const h = await projectsHost({ hash: '#projects/web-1', sources: { ...src, hello: { ...clone(SOURCES.hello), runs: [] },
    history: { pipelines: [{ id: 'pa', title: 'Stopped here', status: 'stopped', projectName: 'web', startedAt: SOURCES.history.pipelines[0].startedAt, mtime: SOURCES.history.pipelines[0].mtime }] } } });
  assert.ok(h.w.StillhetChats.data().chats.find((c) => c.id === 'ask_1')?.tasks.some((t) => t.title === 'Stopped here'), 'a stopped task in its chat');
  const lines = [...page(h.d).querySelectorAll('.convo-head')].map((p) => p.textContent.trim());
  assert.deepEqual(lines.filter((l) => /On it now/.test(l)), [], 'no On it now line');
  assert.deepEqual(lines.filter((l) => !l), [], 'and no empty one');
});

test('F-6-14: the bar\'s by-name order follows names, not keys', async () => {
  const P = (key, name) => ({ key, name, path: `/src/${name}`, displayPath: `~/src/${name}`, exists: true, vcs: 'git' });
  const h = await projectsHost({ hash: '#projects', sources: { projects: { projects: [P('aaa-11112222', 'zeta'), P('mmm-33334444', 'mid'), P('zzz-55556666', 'alpha')] }, sync: { projects: {} }, workspaces: { workspaces: [] } } });
  bar(h.d).querySelector('[data-menu="by"]').click(); await settle(30);
  bar(h.d).querySelector('[data-pick="by|name"]').click(); await settle(60);
  const order = ['alpha', 'mid', 'zeta'].map((n) => text(bar(h.d)).indexOf(n));
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `alpha, mid, zeta: ${text(bar(h.d))}`);
});

test('F-6-14: a project in two workspaces and an unknown member read names; no key shows in the page or the bar', async () => {
  const ws = (id, name, keys, paths) => ({ id, name, description: '', projectKeys: keys, projectPaths: paths, exists: keys.map(() => true), mapSummary: null });
  const h = await projectsHost({ hash: '#projects', sources: { workspaces: { workspaces: [ws('wks-a-1111', 'Shop A', [KEYS.behind], ['/src/seed-behind']), ws('wks-b-2222', 'Shop B', [KEYS.behind, 'ghost-0000aaaa'], ['/src/seed-behind', '/src/ghost-folder'])] } } });
  const also = page(h.d).querySelector('.center-also');
  assert.match(text(also), /seed-behind/, 'centerAlso shows its name');
  assert.doesNotMatch(text(page(h.d)), KEY_TEXT);
  assert.doesNotMatch(text(bar(h.d)), KEY_TEXT, 'no key in the bar');
  bar(h.d).querySelector('[data-fold-tree="ws:wks-b-2222"]').click(); await settle(60);   // a healthy workspace starts folded
  assert.match(text(bar(h.d)), /ghost-folder/, 'the unknown member reads its folder');
  assert.doesNotMatch(text(bar(h.d)), KEY_TEXT, 'nor with its members shown');
  await go(h.w, `#projects/${KEYS.behind}`, 200);
  assert.doesNotMatch(text(page(h.d)), KEY_TEXT, 'nor on a project page');
});

test('F-6-19: the project page draws before history; the store fills it in without rebuilding the frame', async () => {
  const g = gate();
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, hold: (u) => (u === '/api/history' ? g.p : null) });
  assert.equal(page(h.d).querySelector('.place-title')?.textContent.trim(), 'seed-ok', 'its name, from dev\'s project list');
  assert.match(text(page(h.d)), /Partly ready · 2 must fix, 3 should fix/, 'readiness fills in');
  assert.match(text(page(h.d)), /Loading tasks/, 'its tasks are loading');
  assert.doesNotMatch(text(page(h.d)), /No tasks yet|Nothing is on it now/, 'never says none while loading');
  page(h.d).querySelector('[data-menu="pj-more"]')?.click(); await settle(30);   // with no word and no action the head draws no menu
  const items = [...page(h.d).querySelectorAll('[data-menu-pick^="pj-more|"]')].map((b) => b.dataset.menuPick.split('|')[1]);
  assert.deepEqual(items.filter((i) => !['task', 'tasks'].includes(i)), [], 'an early record offers no write that reads the store');
  assert.equal(page(h.d).querySelector('[data-pj-act]'), null, 'no origin action');
  const dock = h.d.getElementById('pj-dock');
  assert.ok(dock);
  g.open(); await settle(200);
  h.sockets.at(-1)?.onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: [] }) }); await settle(200);
  assert.doesNotMatch(text(page(h.d)), /Loading tasks/);
  assert.match(text(page(h.d)), /Up to date/, 'the store\'s record took over');
  assert.equal(h.d.getElementById('pj-dock'), dock, 'the same dock: the frame was not rebuilt');
  assert.deepEqual(sent(h.calls), [], 'nothing written');
});

// F-W3a2-06: the head said "17 tasks here need you" and the bar row 16. A feature in Tasks' Needs you shares its title with
// a stopped run in a chat; the head matched chat tasks to Needs rows by title and counted that run as well. One rule now
// counts both: a chat task matches a Needs row by its id, and the bar row says the head's count.
test('F-W3a2-06: the head and the bar row count the same waits; a stopped run is no wait for sharing a Needs feature\'s title', async () => {
  const src = WORLD(), at0 = SOURCES.history.pipelines[0];
  const h = await projectsHost({ hash: '#projects', sources: { ...src, hello: { ...clone(SOURCES.hello), runs: [] },
    history: { pipelines: [{ id: 'pa', title: 'Stopped here', status: 'stopped', projectName: 'web', startedAt: at0.startedAt, mtime: at0.mtime }] } } });
  assert.ok(h.w.StillhetChats.data().chats.find((c) => c.id === 'ask_1')?.tasks.some((t) => t.title === 'Stopped here'), 'a stopped task in its chat');
  const tops = h.w.StillhetWorld.tops.bind(h.w.StillhetWorld);
  h.w.StillhetWorld.tops = () => [...tops(), { id: 'feat_same', isGroup: true, section: 'needs', project: 'web', title: 'Stopped here', case: 'ready', archived: false }];
  await go(h.w, '#projects/web-1', 200); await settle(120);
  assert.match(headWord(h.d), /1 task here needs you/);
  assert.equal([...page(h.d).querySelectorAll('.lr-t')].map((r) => r.textContent.trim())[0], 'Missed one');
  const row = bar(h.d).querySelector('[data-row="proj:web-1"]');
  assert.ok(row, text(bar(h.d)).slice(0, 300));
  assert.match(text(row), /1 task needs you/, 'the bar row says the head\'s count');
});
