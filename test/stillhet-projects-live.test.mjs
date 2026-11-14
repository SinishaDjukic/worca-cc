// Stillhet slice 9 D3: the one live module that writes Projects and Workspaces through dev's routes. Every request is
// built from PROJECT_ACTIONS; every action answers { ok, text }; a refusal changes nothing; one press, one request.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startProjectsLive, PROJECT_ACTIONS } from '../ui/public/stillhet/live/projects-live.mjs';

const ALL = [];   // every request of every rig: checked against the table at the end
after(() => {
  const known = Object.values(PROJECT_ACTIONS).map(([, , f]) => f);
  const args = { key: 'X', id: 'X', name: 'X', path: 'X', url: 'X', edgeId: 'X', state: 'X', patch: {}, tags: [], labels: [], paths: [], projectKey: 'X', file: 'X', owned: false };
  for (const c of ALL) {
    const fits = known.some((f) => { for (const owned of [false, true]) { const [m, u] = f({ ...args, owned }); const re = new RegExp(`^${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/X/g, '[^/&?]+')}$`); if (m === c.method && re.test(c.url)) return true; } return false; });
    assert.ok(fits, `${c.method} ${c.url} is not in PROJECT_ACTIONS`);
  }
});

const WORLD = () => ({
  projects: [
    { id: 'shop-1111aaaa', name: 'shop', devPath: '/src/shop', origin: 'behind', ownedFolder: false },
    { id: 'api-2222bbbb', name: 'api', devPath: '/src/api', origin: 'ok', ownedFolder: false },
    { id: 'docs-3333cccc', name: 'docs', devPath: '/w/docs', origin: 'folder', ownedFolder: true },
  ],
  spaces: [{ id: 'wks-pair-4444dddd', title: 'Pair', projects: [['shop-1111aaaa', 'behind'], ['api-2222bbbb', 'ok']], paths: ['/src/shop', '/src/api'], links: [] }],
});
function rig({ answer = () => null, hold = () => null } = {}) {
  const calls = [], toasts = [], refreshed = [], went = [], timers = [];
  let world = WORLD(), changes = 0;
  const fetch = async (url, o = {}) => {
    const method = o.method || 'GET', body = o.body ? JSON.parse(o.body) : undefined;
    calls.push({ method, url, body }); ALL.push({ method, url });
    await hold(method, url);
    const a = await answer(method, url, body);
    if (a === 'down') throw new TypeError('Failed to fetch');
    const [status, data] = a || [200, method === 'GET' ? {} : { ok: true }];
    return { ok: status < 400, status, json: async () => structuredClone(data) };
  };
  const live = startProjectsLive({ fetch, toast: (t) => toasts.push(t), refresh: (...s) => { refreshed.push(...s); }, world: () => world, go: (h) => went.push(h), on: () => { changes += 1; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].fn = null; } });
  const writes = () => calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);
  return { live, calls, writes, toasts, refreshed, went, timers, setWorld: (w) => { world = w; }, world: () => world, changes: () => changes, fire: async () => { for (const t of timers.splice(0)) await t.fn?.(); } };
}
const tick = () => new Promise((r) => setImmediate(r));
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };

test('PROJECT_ACTIONS: each id builds its method, URL and body, and carries its D22 pending label', () => {
  const b = (id, a) => PROJECT_ACTIONS[id][2](a);
  assert.deepEqual(b('rename', { key: 'k', name: 'N' }), ['PATCH', '/api/projects/k', { name: 'N' }]);
  assert.deepEqual(b('relocate', { key: 'k', path: '/p' }), ['PATCH', '/api/projects/k', { path: '/p' }]);
  assert.deepEqual(b('sync', { key: 'k' }), ['POST', '/api/projects/k/sync', { mode: 'ff' }]);
  assert.deepEqual(b('fetch', { key: 'k' }), ['POST', '/api/projects/k/sync', { mode: 'fetch' }]);
  assert.deepEqual(b('git', { key: 'k' }), ['POST', '/api/projects/k/git-init', {}]);
  assert.deepEqual(b('link', { key: 'k', url: 'git@x:y.git' }), ['POST', '/api/projects/k/git-init', { remoteUrl: 'git@x:y.git' }]);
  assert.deepEqual(b('remove', { name: 'a b', owned: true }), ['DELETE', '/api/projects?name=a%20b&deleteFolder=1']);
  assert.deepEqual(b('add', { name: 'n', path: '/p/n' }), ['POST', '/api/projects', { name: 'n', path: '/p/n' }]);
  assert.deepEqual(b('clone', { url: 'https://x/y.git' }), ['POST', '/api/projects/clone', { url: 'https://x/y.git' }]);
  assert.deepEqual(b('set', { key: 'k', patch: { 'pr.open': 'draft' } }), ['PATCH', '/api/projects/k/settings', { 'pr.open': 'draft' }]);
  assert.deepEqual(b('defaults', { key: 'k', tags: ['a: b'], labels: ['x'] }), ['PUT', '/api/projects/k/tags/defaults', { tags: ['a: b'], labels: ['x'] }]);
  assert.deepEqual(b('space-create', { name: 'W', paths: ['/a', '/b'] }), ['POST', '/api/workspaces', { name: 'W', projectPaths: ['/a', '/b'] }]);
  assert.deepEqual(b('space-remove', { id: 'w', path: '/a' }), ['POST', '/api/workspaces/w/members', { remove: '/a', rescan: 'none' }]);
  assert.deepEqual(b('scan', { id: 'w' }), ['POST', '/api/workspaces/w/scan', {}]);
  assert.deepEqual(b('answer', { id: 'w', edgeId: 'e', state: 'auto' }), ['PUT', '/api/workspaces/w/map/edges/e', { state: null }]);
  assert.deepEqual(b('open-editor', { id: 'w', projectKey: 'k', file: 'src/a.ts' }), ['POST', '/api/workspaces/w/open-in-editor', { projectKey: 'k', file: 'src/a.ts' }]);
  const LABELS = { sync: 'Syncing…', fetch: 'Checking…', git: 'Setting up git…', link: 'Linking…', rename: 'Renaming…', relocate: 'Moving…', add: 'Adding…', clone: 'Adding…', set: 'Saving…', team: 'Saving…', defaults: 'Saving…', 'space-create': 'Saving…', scan: 'Scanning…', 'space-sync': 'Syncing…', answer: 'Saving…', 'open-editor': 'Opening…', remove: '', 'space-delete': '' };
  for (const [id, label] of Object.entries(LABELS)) assert.equal(PROJECT_ACTIONS[id][1], label, id);
  assert.ok(Object.isFrozen(PROJECT_ACTIONS));
});

test('pending(id) holds the label while dev answers; a double press sends one request; a frame keeps it', async () => {
  const g = gate();
  const r = rig({ hold: (m, u) => (m === 'PATCH' ? g.p : null) });
  const one = r.live.rename('shop-1111aaaa', 'Shop');
  const two = r.live.rename('shop-1111aaaa', 'Shop');
  assert.equal(r.live.pending('shop-1111aaaa'), 'Renaming…');
  r.live.frame({ type: 'projects-changed', action: 'updated' });
  assert.equal(r.live.pending('shop-1111aaaa'), 'Renaming…');
  assert.deepEqual(await two, { ok: false, text: '' });
  g.open();
  assert.deepEqual(await one, { ok: true, text: 'Renamed shop to Shop' });
  assert.equal(r.live.pending('shop-1111aaaa'), '');
  assert.deepEqual(r.writes(), [['PATCH', '/api/projects/shop-1111aaaa', { name: 'Shop' }]]);
  assert.ok(r.refreshed.includes('projects'));
});

test('a refusal answers Could not … with dev\'s error and changes nothing; a network failure says Worca is not answering', async () => {
  const r = rig({ answer: (m, u) => (u.endsWith('/sync') ? [409, { error: 'a run holds it' }] : u.endsWith('/git-init') ? 'down' : null) });
  const before = structuredClone(r.world());
  assert.deepEqual(await r.live.origin('shop-1111aaaa', 'sync'), { ok: false, text: 'Could not sync shop: a run holds it' });
  assert.deepEqual(await r.live.origin('docs-3333cccc', 'git'), { ok: false, text: 'Worca is not answering' });
  assert.deepEqual(r.world(), before);
  assert.deepEqual(r.refreshed, []);
});

test('origin sends ff, fetch and git-init; linkRemote sends the address', async () => {
  const r = rig();
  await r.live.origin('shop-1111aaaa', 'sync');
  await r.live.origin('api-2222bbbb', 'fetch');
  await r.live.origin('docs-3333cccc', 'git');
  await r.live.linkRemote('api-2222bbbb', 'git@github.com:o/api.git');
  assert.deepEqual(r.writes(), [['POST', '/api/projects/shop-1111aaaa/sync', { mode: 'ff' }], ['POST', '/api/projects/api-2222bbbb/sync', { mode: 'fetch' }],
    ['POST', '/api/projects/docs-3333cccc/git-init', {}], ['POST', '/api/projects/api-2222bbbb/git-init', { remoteUrl: 'git@github.com:o/api.git' }]]);
});

test('a refused fast-forward (200 with sync.ff.ok false) is a refusal', async () => {
  const r = rig({ answer: () => [200, { sync: { ff: { ok: false, kind: 'diverged' } } }] });
  assert.deepEqual(await r.live.origin('shop-1111aaaa', 'sync'), { ok: false, text: 'Could not sync shop: it has diverged' });
});

test('addProject: a path posts {name, path}; an address clones and follows clone-changed; a 400 answers the field error', async () => {
  const r = rig({ answer: (m, u, b) => (u === '/api/projects' && b.path === '/nested/x' ? [400, { error: 'Inside a git repository', code: 'NESTED_IN_REPO' }] : u === '/api/projects' ? [200, { projects: [{ key: 'new-5555eeee', name: 'new', path: '/src/new' }] }] : u === '/api/projects/clone' ? [202, { jobId: 'cln_1', job: { id: 'cln_1', name: 'repo', state: 'running' } }] : null) });
  assert.deepEqual(await r.live.addProject('/src/new'), { ok: true, text: 'Added new', key: 'new-5555eeee' });
  assert.deepEqual(await r.live.addProject('/nested/x'), { ok: false, field: 'Inside a git repository' });
  assert.deepEqual(await r.live.addProject('https://github.com/o/repo.git'), { ok: true, text: 'Cloning repo…' });
  r.live.frame({ type: 'clone-changed', job: { id: 'cln_1', name: 'repo', state: 'done', project: { key: 'repo-6666ffff' } } });
  await tick();
  assert.deepEqual(r.went, ['projects/repo-6666ffff']);
  r.live.frame({ type: 'clone-changed', job: { id: 'cln_other', name: 'other', state: 'error', error: 'nope' } });
  assert.deepEqual(r.toasts, [], 'a clone this tab did not start says nothing');
  await r.live.addProject('https://github.com/o/repo.git');
  r.live.frame({ type: 'clone-changed', job: { id: 'cln_1', name: 'repo', state: 'error', error: 'auth failed' } });
  assert.deepEqual(r.toasts, ['Could not clone repo: auth failed']);
  assert.deepEqual(r.writes().map(([m, u]) => [m, u]), [['POST', '/api/projects'], ['POST', '/api/projects'], ['POST', '/api/projects/clone'], ['POST', '/api/projects/clone']]);
  assert.equal(r.writes()[0][2].name, 'new');
});

test('relocate answers the new key; a 400 answers the field error; a 409 says Could not … and the world stays', async () => {
  const r = rig({ answer: (m, u, b) => (b?.path === '/gone' ? [400, { error: 'path is not a directory' }] : b?.path === '/busy' ? [409, { error: 'finish or stop its tasks first', code: 'PROJECT_BUSY' }] : [200, { project: { key: 'shop-7777aaaa' }, previousKey: 'shop-1111aaaa' }]) });
  const before = structuredClone(r.world());
  assert.deepEqual(await r.live.relocate('shop-1111aaaa', '/gone'), { ok: false, field: 'path is not a directory' });
  assert.deepEqual(await r.live.relocate('shop-1111aaaa', '/busy'), { ok: false, text: 'Could not move shop: finish or stop its tasks first' });
  assert.deepEqual(r.world(), before);
  assert.deepEqual(await r.live.relocate('shop-1111aaaa', '/src/shop2'), { ok: true, key: 'shop-7777aaaa', text: 'shop now uses /src/shop2' });
});

test('deferRemove and deferDeleteSpace send nothing before the window and nothing on Undo; an owned folder sends deleteFolder=1', async () => {
  const r = rig();
  const u = r.live.deferRemove('shop-1111aaaa', 5000);
  assert.ok(r.live.hidden().has('shop-1111aaaa'));
  assert.equal(r.writes().length, 0);
  assert.equal(u.undo(), true);
  assert.ok(!r.live.hidden().has('shop-1111aaaa'));
  await r.fire();
  assert.equal(r.writes().length, 0, 'Undo sends nothing');
  r.live.deferRemove('docs-3333cccc', 5000);
  r.live.deferDeleteSpace('wks-pair-4444dddd', 5000);
  assert.ok(r.live.hidden().has('wks-pair-4444dddd'));
  assert.equal(r.writes().length, 0);
  await r.fire();
  assert.deepEqual(r.writes(), [['DELETE', '/api/projects?name=docs&deleteFolder=1', undefined], ['DELETE', '/api/workspaces/wks-pair-4444dddd', undefined]]);
});

test('a remove refused after the window toasts Could not remove … and shows the project again', async () => {
  const r = rig({ answer: (m) => (m === 'DELETE' ? [409, { error: 'a run is still running', code: 'PROJECT_BUSY' }] : null) });
  r.live.deferRemove('api-2222bbbb', 5000);
  await r.fire();
  assert.deepEqual(r.toasts, ['Could not remove api: a run is still running']);
  assert.ok(!r.live.hidden().has('api-2222bbbb'));
});

test('a remove re-reads the project when its window closes: gone or renamed sends nothing and says so; a fired hide clears on the next projects read or after its timeout', async () => {
  const r = rig();
  r.live.deferRemove('shop-1111aaaa', 5000);
  r.setWorld({ ...WORLD(), projects: WORLD().projects.map((p) => (p.id === 'shop-1111aaaa' ? { ...p, name: 'store' } : p)) });
  await r.fire();
  assert.equal(r.writes().length, 0, 'renamed in the window: nothing sent');
  assert.deepEqual(r.toasts, ['Did not remove shop: it changed while you could undo']);
  assert.ok(!r.live.hidden().has('shop-1111aaaa'));
  r.setWorld({ ...WORLD(), projects: WORLD().projects.map((p) => (p.id === 'docs-3333cccc' ? { ...p, ownedFolder: false } : p)) });
  r.live.deferRemove('docs-3333cccc', 5000);
  r.setWorld(WORLD());
  await r.fire();
  assert.deepEqual(r.writes(), [['DELETE', '/api/projects?name=docs&deleteFolder=1', undefined]], 'the owned folder is read when the window closes');
  const never = gate();
  const h = rig({ hold: (m) => (m === 'DELETE' ? never.p : null) });
  h.live.deferRemove('api-2222bbbb', 5000);
  const fired = h.fire(); await tick();
  assert.ok(h.live.hidden().has('api-2222bbbb'), 'hidden while dev answers');
  h.live.frame({ type: 'projects-changed' });
  assert.ok(!h.live.hidden().has('api-2222bbbb'), 'the next projects read shows the truth');
  h.live.deferDeleteSpace('wks-pair-4444dddd', 5000);
  const fired2 = h.fire(); await tick();
  assert.ok(h.live.hidden().has('wks-pair-4444dddd'));
  const cap = h.timers.find((t) => t.fn); assert.ok(cap && cap.ms >= 10000, 'a hide that never hears back has a timeout');
  await cap.fn();
  assert.ok(!h.live.hidden().has('wks-pair-4444dddd'));
  never.open(); await fired; await fired2;
});

test('saveSpace takes out a member no project holds by its stored path', async () => {
  const r = rig();
  r.setWorld({ ...WORLD(), spaces: [{ id: 'wks-pair-4444dddd', title: 'Pair', projects: [['shop-1111aaaa', 'ok'], ['gone-5555eeee', 'missing']], paths: ['/src/shop', '/old/gone'], links: [] }] });
  const a = await r.live.saveSpace('wks-pair-4444dddd', { projects: [['shop-1111aaaa', 'ok']], changes: 1 });
  assert.equal(a.ok, true, a.text);
  assert.deepEqual(r.writes(), [['POST', '/api/workspaces/wks-pair-4444dddd/members', { remove: '/old/gone', rescan: 'none' }]]);
});

test('fresh then saveSpace sends one POST with the members\' devPaths; a 409 keeps the draft; Discard sends nothing', async () => {
  let refuse = true;
  const r = rig({ answer: (m, u) => (u === '/api/workspaces' ? (refuse ? [409, { error: 'a workspace with these projects exists' }] : [201, { workspace: { id: 'wks-web-8888aaaa' } }]) : null) });
  const id = r.live.fresh('Web store');
  assert.equal(id, 'draft:web-store');
  const d = r.live.drafts()[0];
  assert.deepEqual([d.id, d.title, d.fresh], ['draft:web-store', 'Web store', true]);
  d.draft.projects.push(['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok']);
  assert.deepEqual(await r.live.saveSpace(id, d.draft), { ok: false, text: 'Could not save Web store: a workspace with these projects exists' });
  assert.equal(r.live.drafts().length, 1, 'the draft stays');
  refuse = false;
  assert.deepEqual(await r.live.saveSpace(id, d.draft), { ok: true, text: 'Saved Web store; a short scan maps what changed', id: 'wks-web-8888aaaa' });
  assert.deepEqual(r.writes().at(-1), ['POST', '/api/workspaces', { name: 'Web store', projectPaths: ['/src/shop', '/src/api'] }]);
  assert.equal(r.live.drafts().length, 0);
  const n = r.writes().length;
  r.live.fresh('Other'); r.live.discardFresh('draft:other');
  assert.equal(r.writes().length, n);
  assert.equal(r.live.drafts().length, 0);
});

test('saveSpace on a saved workspace sends PATCH, then add, then removals, stops at the first refusal and keeps the rest', async () => {
  const r = rig({ answer: (m, u, b) => (b?.remove ? [409, { error: 'a run holds it' }] : null) });
  r.setWorld({ ...WORLD(), projects: [...WORLD().projects, { id: 'kit-9999aaaa', name: 'kit', devPath: '/src/kit', origin: 'ok' }] });
  const draft = { name: 'Web shop', projects: [['api-2222bbbb', 'ok'], ['kit-9999aaaa', 'ok']], changes: 3 };
  const a = await r.live.saveSpace('wks-pair-4444dddd', draft);
  assert.equal(a.ok, false);
  assert.equal(a.text, 'Could not save Web shop: a run holds it (the name and kit were saved)');
  assert.deepEqual(a.keep, { projects: [['api-2222bbbb', 'ok'], ['kit-9999aaaa', 'ok']], changes: 1 }, 'the draft keeps only the removal');
  assert.deepEqual(r.writes(), [['PATCH', '/api/workspaces/wks-pair-4444dddd', { name: 'Web shop' }], ['POST', '/api/workspaces/wks-pair-4444dddd/members', { add: ['/src/kit'] }], ['POST', '/api/workspaces/wks-pair-4444dddd/members', { remove: '/src/shop', rescan: 'none' }]]);
  assert.ok(r.refreshed.includes('workspaces'));
});

test('scan: a 428 answers dev\'s message; syncBehind syncs each member that is behind; answer and openInEditor go through the table', async () => {
  const r = rig({ answer: (m, u) => (u.endsWith('/scan') ? [428, { error: 'Pick a model for the scan first', code: 'SCAN_MODEL_REQUIRED' }] : null) });
  assert.deepEqual(await r.live.scan('wks-pair-4444dddd'), { ok: false, text: 'Pick a model for the scan first' });
  assert.deepEqual(await r.live.syncBehind('wks-pair-4444dddd'), { ok: true, text: 'Synced 1 project in Pair' });
  assert.equal((await r.live.answer('wks-pair-4444dddd', 'e1', 'confirmed')).ok, true);
  assert.deepEqual(await r.live.openInEditor('wks-pair-4444dddd', 'api-2222bbbb', 'payments/receipts.ts:41'), { ok: true, text: 'Opened receipts.ts in your editor' });
  assert.deepEqual(r.writes().slice(1), [['POST', '/api/projects/shop-1111aaaa/sync', { mode: 'ff' }], ['PUT', '/api/workspaces/wks-pair-4444dddd/map/edges/e1', { state: 'confirmed' }],
    ['POST', '/api/workspaces/wks-pair-4444dddd/open-in-editor', { projectKey: 'api-2222bbbb', file: 'payments/receipts.ts' }]]);
});

test('detail(key) reads settings and defaults once; a pick, Use yours, team memory and defaults send their routes; settings-changed reads again', async () => {
  const ST = { own: {}, effective: { 'pr.open': { value: 'none', source: 'user' }, 'memory.team': { value: false, source: 'user' } }, layers: { 'pr.open': { default: 'none' }, 'memory.team': { default: false } } };
  const r = rig({ answer: (m, u, b) => (m === 'GET' && u.endsWith('/settings') ? [200, ST] : m === 'GET' && u.endsWith('/tags/defaults') ? [200, { tags: ['team:web'], labels: ['shop'] }] : b && 'memory.team' in b ? [400, { error: 'This project has no origin', code: 'NO_ORIGIN' }] : m === 'PATCH' ? [200, ST] : null) });
  assert.equal(r.live.detail('api-2222bbbb').status, 'loading');
  await tick(); await tick();
  const d = r.live.detail('api-2222bbbb');
  assert.equal(d.status, 'ready');
  assert.equal(d.sets.pr.value, 'open no PR');
  assert.deepEqual([d.tags, d.labels, d.teamMemory], [['team: web'], ['shop'], false]);
  assert.equal(r.calls.filter((c) => c.method === 'GET').length, 2);
  await r.live.setSet('api-2222bbbb', 'pr', 'create a draft PR');
  await r.live.resetSet('api-2222bbbb', 'pr');
  assert.deepEqual(await r.live.teamMemory('api-2222bbbb', true), { ok: false, text: 'Could not change api: This project has no origin' });
  await r.live.saveDefaults('api-2222bbbb', { tags: ['team: shop'], labels: [] });
  assert.deepEqual(r.writes(), [['PATCH', '/api/projects/api-2222bbbb/settings', { 'pr.open': 'draft' }], ['PATCH', '/api/projects/api-2222bbbb/settings', { 'pr.open': null }],
    ['PATCH', '/api/projects/api-2222bbbb/settings', { 'memory.team': true }], ['PUT', '/api/projects/api-2222bbbb/tags/defaults', { tags: ['team: shop'], labels: [] }]]);
  const gets = r.calls.filter((c) => c.method === 'GET').length;
  r.live.frame({ type: 'settings-changed' }); await tick(); await tick();
  assert.equal(r.calls.filter((c) => c.method === 'GET').length, gets + 2);
});

test('source scan (R-arch-3): the pages hold none of dev\'s route or field names', () => {
  for (const f of ['projects/projects.js', 'workspaces/workspaces.js']) {
    const src = readFileSync(new URL(`../ui/public/stillhet/${f}`, import.meta.url), 'utf8');
    for (const word of ['/api/', 'projectPaths', 'remoteUrl', 'deleteFolder', 'projectKeys']) assert.ok(!src.includes(word), `${f} holds ${word}`);
    for (const word of ['notLive(', 'is not in Stillhet yet', "refuse('workspaces.add')"]) assert.ok(!src.includes(word), `${f} holds ${word}`);
  }
});
