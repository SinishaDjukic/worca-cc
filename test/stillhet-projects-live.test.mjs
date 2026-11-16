// Stillhet slice 9 D3: the one live module that writes Projects and Workspaces through dev's routes. Every request is
// built from PROJECT_ACTIONS; every action answers { ok, text }; a refusal changes nothing; one press, one request.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startProjectsLive, PROJECT_ACTIONS } from '../ui/public/stillhet/live/projects-live.mjs';

const ALL = [];   // every request of every rig: checked against the table at the end
after(() => {
  const known = Object.values(PROJECT_ACTIONS).map(([, , f]) => f);
  const args = { key: 'X', id: 'X', name: 'X', path: 'X', url: 'X', edgeId: 'X', state: 'X', patch: {}, tags: [], labels: [], paths: [], projectKey: 'X', file: 'X', owned: false, rows: [] };
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
function rig({ answer = () => null, hold = () => null, at = () => '' } = {}) {
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
  const live = startProjectsLive({ fetch, toast: (t) => toasts.push(t), refresh: (...s) => { refreshed.push(...s); }, world: () => world, go: (h) => went.push(h), at, on: () => { changes += 1; },
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
  r.setWorld(withProject({ id: 'new-5555eeee', name: 'new', devPath: '/src/new' }));
  assert.deepEqual(await r.live.addProject('/src/new'), { ok: true, text: 'Added new', key: 'new-5555eeee' });
  assert.deepEqual(await r.live.addProject('/nested/x'), { ok: false, field: 'Inside a git repository' });
  assert.deepEqual(await r.live.addProject('https://github.com/o/repo.git'), { ok: true, text: 'Cloning repo…' });
  r.live.frame({ type: 'clone-changed', job: { id: 'cln_1', name: 'repo', state: 'done', project: { key: 'repo-6666ffff' } } });
  r.setWorld(withProject({ id: 'repo-6666ffff', name: 'repo', devPath: '/src/repo' }));
  await r.fire(); await tick();
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
  r.setWorld(withProject({ id: 'shop-7777aaaa', name: 'shop', devPath: '/src/shop2' }));
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
  assert.ok(h.live.hidden().has('api-2222bbbb'), 'F-6-18: still hidden while the store lists it');
  h.setWorld({ ...WORLD(), projects: WORLD().projects.filter((p) => p.id !== 'api-2222bbbb') });
  assert.ok(!h.live.hidden().has('api-2222bbbb'), 'the store no longer lists it: the truth');
  h.setWorld(WORLD());
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
  r.setWorld({ ...WORLD(), spaces: [{ id: 'wks-pair-4444dddd', title: 'Pair', projects: [['shop-1111aaaa', 'ok'], ['gone-5555eeee', 'missing'], ['api-2222bbbb', 'ok']], paths: ['/src/shop', '/old/gone', '/src/api'], links: [] }] });
  const a = await r.live.saveSpace('wks-pair-4444dddd', { projects: [['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok']], changes: 1 });
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
  r.setWorld({ ...WORLD(), spaces: [...WORLD().spaces, { id: 'wks-web-8888aaaa', title: 'Web store', projects: [], paths: [], links: [] }] });
  assert.deepEqual(await r.live.saveSpace(id, d.draft), { ok: true, text: 'Saved Web store; a short scan maps what changed', id: 'wks-web-8888aaaa' });
  assert.deepEqual(r.writes().at(-1), ['POST', '/api/workspaces', { name: 'Web store', projectPaths: ['/src/shop', '/src/api'] }]);
  assert.equal(r.live.drafts().length, 0);
  const n = r.writes().length;
  r.live.fresh('Other'); r.live.discardFresh('draft:other');
  assert.equal(r.writes().length, n);
  assert.equal(r.live.drafts().length, 0);
});

test('saveSpace on a saved workspace sends add, then removals, then PATCH, stops at the first refusal and keeps the rest', async () => {
  const r = rig({ answer: (m, u, b) => (b?.remove ? [409, { error: 'a run holds it' }] : null) });
  r.setWorld({ ...WORLD(), projects: [...WORLD().projects, { id: 'kit-9999aaaa', name: 'kit', devPath: '/src/kit', origin: 'ok' }] });
  const draft = { name: 'Web shop', projects: [['api-2222bbbb', 'ok'], ['kit-9999aaaa', 'ok']], changes: 3 };
  const a = await r.live.saveSpace('wks-pair-4444dddd', draft);
  assert.equal(a.ok, false);
  assert.equal(a.text, 'Could not save Pair: a run holds it (kit was saved)');
  assert.deepEqual(a.keep, { name: 'Web shop', projects: [['api-2222bbbb', 'ok'], ['kit-9999aaaa', 'ok']], changes: 2 }, 'the draft keeps the name and the removal');
  assert.deepEqual(r.writes(), [['POST', '/api/workspaces/wks-pair-4444dddd/members', { add: ['/src/kit'] }], ['POST', '/api/workspaces/wks-pair-4444dddd/members', { remove: '/src/shop', rescan: 'none' }]], 'no PATCH: the name is saved last');
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

const withProject = (p) => ({ ...WORLD(), projects: [...WORLD().projects, p] });
/** Fires every queued timer, tick by tick, `n` times: the 100 ms polls of a wait that never ends. */
const drain = async (r, n = 120) => { for (let i = 0; i < n; i += 1) { await tick(); await r.fire(); } };

test('F-5-05 = F-6-02: addProject, relocate, a finished clone and a new workspace answer the key only once the store lists it; not listed in 10 s answers no key', async () => {
  const answer = (m, u) => (u === '/api/projects' ? [200, { projects: [{ key: 'new-5555eeee', name: 'new', path: '/src/new' }] }] : u === '/api/projects/clone' ? [202, { jobId: 'cln_1', job: { id: 'cln_1', name: 'repo', state: 'running' } }]
    : u === '/api/workspaces' ? [201, { workspace: { id: 'wks-web-8888aaaa' } }] : m === 'PATCH' ? [200, { project: { key: 'shop-7777aaaa' }, previousKey: 'shop-1111aaaa' }] : null);
  const r = rig({ answer });
  let got = null;
  const add = r.live.addProject('/src/new').then((a) => { got = a; return a; });
  await tick(); await tick(); await tick();
  assert.equal(got, null, 'no answer while the store does not list it');
  assert.equal(r.live.pending('add'), 'Adding…', 'the pending label holds while it waits');
  assert.ok(r.timers.every((t) => t.ms === 100), 'it looks again every 100 ms');
  r.setWorld(withProject({ id: 'new-5555eeee', name: 'new', devPath: '/src/new' }));
  await r.fire();
  assert.deepEqual(await add, { ok: true, text: 'Added new', key: 'new-5555eeee' });
  assert.equal(r.live.pending('add'), '');
  const mv = r.live.relocate('shop-1111aaaa', '/src/shop2');
  await tick(); await tick();
  r.setWorld({ ...WORLD(), projects: WORLD().projects.map((p) => (p.id === 'shop-1111aaaa' ? { ...p, id: 'shop-7777aaaa', devPath: '/src/shop2' } : p)) });
  await r.fire();
  assert.deepEqual(await mv, { ok: true, key: 'shop-7777aaaa', text: 'shop now uses /src/shop2' });
  await r.live.addProject('https://github.com/o/repo.git');
  r.live.frame({ type: 'clone-changed', job: { id: 'cln_1', name: 'repo', state: 'done', project: { key: 'repo-6666ffff' } } });
  await tick(); await tick();
  assert.deepEqual(r.went, [], 'a finished clone waits for the store');
  r.setWorld(withProject({ id: 'repo-6666ffff', name: 'repo', devPath: '/src/repo' }));
  await r.fire(); await tick();
  assert.deepEqual(r.went, ['projects/repo-6666ffff']);
  const id = r.live.fresh('Web store'); r.live.drafts()[0].draft.projects.push(['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok']);
  const ws = r.live.saveSpace(id, r.live.drafts()[0].draft);
  await tick(); await tick();
  r.setWorld({ ...WORLD(), spaces: [...WORLD().spaces, { id: 'wks-web-8888aaaa', title: 'Web store', projects: [], paths: [], links: [] }] });
  await r.fire();
  assert.deepEqual(await ws, { ok: true, text: 'Saved Web store; a short scan maps what changed', id: 'wks-web-8888aaaa' });

  const n = rig({ answer });   // never listed
  const a2 = n.live.addProject('/src/new'), m2 = n.live.relocate('shop-1111aaaa', '/src/shop2');
  await n.live.addProject('https://github.com/o/repo.git').catch(() => {});
  n.live.frame({ type: 'clone-changed', job: { id: 'cln_1', name: 'repo', state: 'done', project: { key: 'repo-6666ffff' } } });
  const id2 = n.live.fresh('Web store'); n.live.drafts()[0].draft.projects.push(['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok']);
  const w2 = n.live.saveSpace(id2, n.live.drafts()[0].draft);
  await drain(n);
  assert.deepEqual(await a2, { ok: true, text: 'Added new' });
  assert.deepEqual(await m2, { ok: true, text: 'shop now uses /src/shop2' });
  assert.deepEqual(await w2, { ok: true, text: 'Saved Web store; a short scan maps what changed' });
  assert.deepEqual(n.went, [], 'never routes to what the store does not list');
  assert.equal(n.timers.length, 0, 'it stops looking after 10 s');
});

test('F-6-16: saveSpace checks the members before the name: a take-out that leaves one project, an unknown member or a clashing name sends nothing and keeps the draft; a refused member change leaves the name unsaved', async () => {
  const r = rig({ answer: (m, u, b) => (b?.add ? [409, { error: 'a run holds it' }] : null) });
  r.setWorld({ ...WORLD(), projects: [...WORLD().projects, { id: 'kit-9999aaaa', name: 'kit', devPath: '/src/kit', origin: 'ok' }],
    spaces: [...WORLD().spaces, { id: 'wks-other-5555eeee', title: 'Other', projects: [['docs-3333cccc', 'ok'], ['api-2222bbbb', 'ok']], paths: ['/w/docs', '/src/api'], links: [] }] });
  const W = 'wks-pair-4444dddd';
  const one = { name: 'Web shop', projects: [['shop-1111aaaa', 'ok']], changes: 2 };
  assert.deepEqual(await r.live.saveSpace(W, one), { ok: false, text: 'Could not save Pair: a workspace needs at least two projects', keep: one });
  const many = { projects: Array.from({ length: 41 }, (_, i) => [i < 2 ? ['shop-1111aaaa', 'api-2222bbbb'][i] : `x-${i}`, 'ok']), changes: 39 };
  assert.equal((await r.live.saveSpace(W, many)).text, 'Could not save Pair: a workspace holds at most 40 projects');
  const ghost = { projects: [['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok'], ['ghost-0000aaaa', 'ok']], changes: 1 };
  assert.deepEqual(await r.live.saveSpace(W, ghost), { ok: false, text: 'Could not save Pair: ghost-0000aaaa is not a project Worca knows', keep: ghost });
  const clash = { name: 'other', projects: [['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok']], changes: 1 };
  assert.deepEqual(await r.live.saveSpace(W, clash), { ok: false, text: 'Could not save Pair: there is already a workspace called Other', keep: clash });
  assert.equal((await r.live.saveSpace(W, { name: '  ', projects: clash.projects, changes: 1 })).text, 'Could not save Pair: it needs a name');
  const fid = r.live.fresh('Solo'); const fd = r.live.drafts()[0].draft; fd.projects.push(['shop-1111aaaa', 'ok']);
  assert.equal((await r.live.saveSpace(fid, fd)).text, 'Could not save Solo: a workspace needs at least two projects');
  assert.deepEqual(r.writes(), [], 'a check the client can make sends nothing');
  const add = { name: 'Web shop', projects: [['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok'], ['kit-9999aaaa', 'ok']], changes: 2 };
  const a = await r.live.saveSpace(W, add);
  assert.equal(a.text, 'Could not save Pair: a run holds it');
  assert.deepEqual(a.keep, { name: 'Web shop', projects: add.projects, changes: 2 });
  assert.deepEqual(r.writes(), [['POST', `/api/workspaces/${W}/members`, { add: ['/src/kit'] }]], 'no PATCH after a refused member change');
});

test('F-6-17: a refusal is the refusal line in plain words: no HTTP status, no error code, dev\'s workspace phrases said plainly; a plain sentence from dev passes through', async () => {
  const W = 'wks-pair-4444dddd';
  const r = rig({ answer: (m, u, b) => (u.endsWith('/sync') ? [500, {}] : u.endsWith('/git-init') ? [409, { error: 'PROJECT_BUSY' }] : m === 'DELETE' ? [404, { error: `workspace not found: ${W}` }]
    : b?.remove ? [409, { error: 'cannot change the members of a workspace while a run or scan owns it' }] : u === '/api/projects' ? [400, {}] : null) });
  const texts = [];
  const t = async (p) => { const a = await p; texts.push(a.text ?? a.field); return a; };
  assert.equal((await t(r.live.origin('shop-1111aaaa', 'sync'))).text, 'Could not sync shop: something went wrong on Worca\'s side');
  assert.equal((await t(r.live.origin('docs-3333cccc', 'git'))).text, 'Could not set up git in docs: something else is using it right now');
  r.live.deferDeleteSpace(W, 5000); await r.fire();
  assert.deepEqual(r.toasts, ['Could not delete Pair: it no longer exists']); texts.push(...r.toasts);
  r.setWorld({ ...WORLD(), spaces: [{ ...WORLD().spaces[0], projects: [['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok'], ['docs-3333cccc', 'ok']], paths: ['/src/shop', '/src/api', '/w/docs'] }] });
  assert.equal((await t(r.live.saveSpace(W, { projects: [['shop-1111aaaa', 'ok'], ['api-2222bbbb', 'ok']], changes: 1 }))).text, 'Could not save Pair: a task or a scan is using it; try again when it ends');
  assert.deepEqual(await t(r.live.addProject('/src/x')), { ok: false, field: 'Worca could not use what was given' });
  for (const s of texts) assert.ok(!/HTTP \d|[A-Z]{3,}_[A-Z]|wks-/.test(s), s);
});

test('plainWhy: dev\'s answer becomes the reason of the refusal line', async () => {
  const { plainWhy } = await import('../ui/public/stillhet/live/projects-live.mjs');
  const rows = [
    [{ status: 0, error: 'x' }, 'Worca is not answering'],
    [{ status: 404, error: 'workspace not found: wks-a-1' }, 'it no longer exists'],
    [{ status: 400, error: 'a workspace needs at least 2 distinct member projects' }, 'a workspace needs at least two projects'],
    [{ status: 400, error: 'a workspace can hold at most 40 member projects' }, 'a workspace holds at most 40 projects'],
    [{ status: 409, error: 'a workspace over this exact project set already exists' }, 'another workspace has exactly these projects'],
    [{ status: 409, error: 'the name Pair once spanned this project set' }, 'that name was used for these projects before; choose another'],
    [{ status: 409, error: 'cannot delete a workspace with a live run' }, 'a task is running in it; try again when it ends'],
    [{ status: 404, error: '' }, 'it no longer exists'],
    [{ status: 409, error: 'PROJECT_BUSY' }, 'something else is using it right now'],
    [{ status: 422, error: 'HTTP 422' }, 'Worca could not use what was given'],
    [{ status: 503, error: '' }, 'something went wrong on Worca\'s side'],
    [{ status: 403, error: '' }, 'Worca refused it'],
    [{ status: 409, error: 'a run holds it' }, 'a run holds it'],
  ];
  for (const [a, want] of rows) assert.equal(plainWhy(a), want, JSON.stringify(a));
});

test('F-6-18: no GET for a removed item: not in its undo window, not when projects-changed arrives before dev answers the DELETE, not after, not under a moved project\'s old key; a refused DELETE reads it again', async () => {
  const held = gate();
  let refuse = false;
  const r = rig({ hold: (m) => (m === 'DELETE' ? held.p : null), answer: (m, u) => (m === 'DELETE' && refuse ? [409, { error: 'a run holds it' }] : m === 'PATCH' ? [200, { project: { key: 'api-7777aaaa' } }] : null) });
  r.live.detail('shop-1111aaaa'); r.live.spaceDetail('wks-pair-4444dddd'); r.live.detail('api-2222bbbb');
  await tick(); await tick();
  const gets = (id) => r.calls.filter((c) => c.method === 'GET' && c.url.includes(id)).length;
  const was = [gets('shop-1111aaaa'), gets('wks-pair-4444dddd')];
  r.live.deferRemove('shop-1111aaaa', 5000); r.live.deferDeleteSpace('wks-pair-4444dddd', 5000);
  r.live.frame({ type: 'projects-changed' }); r.live.frame({ type: 'workspaces-changed' });
  assert.equal(r.live.detail('shop-1111aaaa').status, 'loading', 'in its undo window: no read');
  await tick();
  const fired = r.fire(); await tick();
  r.live.frame({ type: 'projects-changed' }); r.live.frame({ type: 'workspaces-changed' });   // dev's frame before its answer
  r.live.detail('shop-1111aaaa'); r.live.spaceDetail('wks-pair-4444dddd');
  assert.ok(r.live.hidden().has('shop-1111aaaa') && r.live.hidden().has('wks-pair-4444dddd'), 'the removed rows do not flash back');
  held.open(); await fired; await tick();
  r.live.frame({ type: 'projects-changed' }); r.live.frame({ type: 'workspaces-changed' });
  await tick();
  assert.ok(r.live.hidden().has('shop-1111aaaa'), 'hidden while the store still lists it');
  assert.deepEqual([gets('shop-1111aaaa'), gets('wks-pair-4444dddd')], was, 'no GET for a removed item');
  r.setWorld({ ...WORLD(), projects: WORLD().projects.filter((p) => p.id !== 'shop-1111aaaa'), spaces: [] });
  assert.ok(!r.live.hidden().has('shop-1111aaaa') && !r.live.hidden().has('wks-pair-4444dddd'), 'gone from the store: no longer hidden');
  const mv = r.live.relocate('api-2222bbbb', '/src/api2'); await tick(); await tick();
  r.setWorld({ ...r.world(), projects: r.world().projects.map((p) => (p.id === 'api-2222bbbb' ? { ...p, id: 'api-7777aaaa' } : p)) });
  await r.fire(); assert.equal((await mv).key, 'api-7777aaaa');
  const apiGets = gets('api-2222bbbb');
  r.live.frame({ type: 'projects-changed' }); r.live.detail('api-2222bbbb'); await tick();
  assert.equal(gets('api-2222bbbb'), apiGets, 'never under the moved project\'s old key');
  refuse = true;
  r.setWorld(WORLD());
  const d0 = gets('docs-3333cccc');
  r.live.detail('docs-3333cccc'); await tick();
  r.live.deferRemove('docs-3333cccc', 5000); await r.fire(); await tick();
  assert.ok(!r.live.hidden().has('docs-3333cccc'), 'a refused DELETE shows it again');
  r.live.detail('docs-3333cccc'); await tick();
  assert.equal(gets('docs-3333cccc'), d0 + 4, 'and its page reads it again');
});

test('F-6-18 review: a move keeps the old key\'s row (and its Locate form) until the new key is listed, reads nothing under it meanwhile, then hides it', async () => {
  const r = rig({ answer: (m) => (m === 'PATCH' ? [200, { project: { key: 'shop-7777aaaa' } }] : null) });
  r.live.detail('shop-1111aaaa'); await tick(); await tick();
  const gets = () => r.calls.filter((c) => c.method === 'GET' && c.url.includes('shop-1111aaaa')).length, was = gets();
  const mv = r.live.relocate('shop-1111aaaa', '/src/shop2');
  await tick(); await tick();
  assert.ok(!r.live.hidden().has('shop-1111aaaa'), 'while the new key is not listed the old row stays: a redraw keeps the Locate form');
  assert.equal(r.live.pending('shop-1111aaaa'), 'Moving…', 'its label holds');
  r.live.frame({ type: 'projects-changed' }); r.live.detail('shop-1111aaaa'); await tick();
  assert.equal(gets(), was, 'nothing is read under the old key meanwhile');
  r.setWorld({ ...WORLD(), projects: [...WORLD().projects, { id: 'shop-7777aaaa', name: 'shop', devPath: '/src/shop2' }] });   // the store lists both for a moment
  await r.fire();
  assert.equal((await mv).key, 'shop-7777aaaa');
  assert.ok(r.live.hidden().has('shop-1111aaaa'), 'once the new key is listed the old one is hidden until the store drops it');
});

test('F-5-05 review: a finished clone goes to its project only while the person is still where they started it', async () => {
  let hash = '#projects';
  const r = rig({ at: () => hash, answer: (m, u) => (u === '/api/projects/clone' ? [202, { jobId: 'cln_1', job: { id: 'cln_1', name: 'repo', state: 'running' } }] : null) });
  await r.live.addProject('https://github.com/o/repo.git');
  hash = '#projects/api-2222bbbb';   // the person moved on while it cloned
  r.live.frame({ type: 'clone-changed', job: { id: 'cln_1', name: 'repo', state: 'done', project: { key: 'repo-6666ffff' } } });
  r.setWorld(withProject({ id: 'repo-6666ffff', name: 'repo', devPath: '/src/repo' }));
  await drain(r, 3);
  assert.deepEqual(r.went, [], 'elsewhere now: no route');
  hash = '#projects';
  await r.live.addProject('https://github.com/o/repo.git');
  r.live.frame({ type: 'clone-changed', job: { id: 'cln_1', name: 'repo', state: 'done', project: { key: 'repo-6666ffff' } } });
  await drain(r, 3);
  assert.deepEqual(r.went, ['projects/repo-6666ffff'], 'still there: it goes to the project');
});

test('F-6-18 review: after a DELETE dev answered ok, the hide timeout does not show the row again while the store still lists it, nor read it', async () => {
  const r = rig();
  r.live.deferRemove('api-2222bbbb', 5000);
  await r.fire(); await tick();   // the window closes, DELETE answers ok; the store's frame was lost
  assert.deepEqual(r.writes(), [['DELETE', '/api/projects?name=api', undefined]]);
  const cap = r.timers.find((t) => t.fn && t.ms >= 10000); assert.ok(cap, 'the hide timeout is set');
  await cap.fn();
  assert.ok(r.live.hidden().has('api-2222bbbb'), 'removed by dev: hidden until the store drops it');
  r.live.detail('api-2222bbbb'); r.live.frame({ type: 'projects-changed' }); await tick();
  assert.equal(r.calls.filter((c) => c.method === 'GET' && c.url.includes('api-2222bbbb')).length, 0, 'no GET that would answer 404');
  r.setWorld({ ...WORLD(), projects: WORLD().projects.filter((p) => p.id !== 'api-2222bbbb') });
  assert.ok(!r.live.hidden().has('api-2222bbbb'), 'dropped by the store: no longer hidden');
});

test('F-b23m2-02: a projects-changed frame that lands before the Locate PATCH answer reads nothing under the old key; a refused move reads it again', async () => {
  const held = gate();
  const r = rig({ hold: (m) => (m === 'PATCH' ? held.p : null), answer: (m) => (m === 'PATCH' ? [200, { project: { key: 'shop-7777aaaa' } }] : null) });
  r.live.detail('shop-1111aaaa'); await tick(); await tick();
  const gets = () => r.calls.filter((c) => c.method === 'GET' && c.url.includes('shop-1111aaaa')).length, was = gets();
  const mv = r.live.relocate('shop-1111aaaa', '/src/shop2'); await tick();
  r.live.frame({ type: 'projects-changed' }); r.live.frame({ type: 'settings-changed' }); await tick();   // dev's frame before its answer
  assert.equal(gets(), was, 'no GET under the old key while dev moves it');
  held.open(); await tick(); await tick();
  r.setWorld({ ...WORLD(), projects: WORLD().projects.map((p) => (p.id === 'shop-1111aaaa' ? { ...p, id: 'shop-7777aaaa' } : p)) });
  await r.fire(); assert.equal((await mv).key, 'shop-7777aaaa');
  assert.equal(gets(), was, 'nor after');
  const held2 = gate(), r2 = rig({ hold: (m) => (m === 'PATCH' ? held2.p : null), answer: (m) => (m === 'PATCH' ? [409, { error: 'a run holds it' }] : null) });
  r2.live.detail('api-2222bbbb'); await tick(); await tick();
  const g2 = () => r2.calls.filter((c) => c.method === 'GET' && c.url.includes('api-2222bbbb')).length, was2 = g2();
  const mv2 = r2.live.relocate('api-2222bbbb', '/src/api2'); await tick();
  r2.live.frame({ type: 'settings-changed' }); await tick();
  assert.equal(g2(), was2, 'nothing read while it waits');
  held2.open(); assert.equal((await mv2).ok, false);
  r2.live.frame({ type: 'settings-changed' }); await tick();
  assert.equal(g2(), was2 + 2, 'refused: the project is read again');
});

test('source scan (R-arch-3): the pages hold none of dev\'s route or field names', () => {
  for (const f of ['projects/projects.js', 'projects/project-add.js', 'workspaces/workspaces.js']) {
    const src = readFileSync(new URL(`../ui/public/stillhet/${f}`, import.meta.url), 'utf8');
    for (const word of ['/api/', 'projectPaths', 'remoteUrl', 'deleteFolder', 'projectKeys']) assert.ok(!src.includes(word), `${f} holds ${word}`);
    for (const word of ['notLive(', 'is not in Stillhet yet', "refuse('workspaces.add')"]) assert.ok(!src.includes(word), `${f} holds ${word}`);
  }
});

test('COV-1 PROJECT_ACTIONS: dirs, probe, git-available, create and bulk build classic\'s routes and bodies; add sends useGit only when asked', () => {
  const b = (id, a) => PROJECT_ACTIONS[id][2](a);
  assert.deepEqual(b('dirs', { path: '' }), ['GET', '/api/fs/dirs?path=']);
  assert.deepEqual(b('dirs', { path: '/a b' }), ['GET', '/api/fs/dirs?path=%2Fa%20b']);
  assert.deepEqual(b('probe', { path: '~/src/x' }), ['GET', '/api/projects/probe?path=~%2Fsrc%2Fx']);
  assert.deepEqual(b('git-available', {}), ['GET', '/api/git']);
  assert.deepEqual(b('create', { name: 'alpha', useGit: true, dryRun: true }), ['POST', '/api/projects/create', { name: 'alpha', useGit: true, dryRun: true }]);
  assert.deepEqual(b('create', { name: 'alpha', useGit: false }), ['POST', '/api/projects/create', { name: 'alpha' }]);
  assert.deepEqual(b('bulk', { rows: [{ name: 'a', path: '/a', include: true }] }), ['POST', '/api/projects/bulk', { projects: [{ name: 'a', path: '/a' }] }]);
  assert.deepEqual(b('add', { name: 'n', path: '/p/n', useGit: true }), ['POST', '/api/projects', { name: 'n', path: '/p/n', useGit: true }]);
  assert.deepEqual(b('add', { name: 'n', path: '/p/n', useGit: 'yes' }), ['POST', '/api/projects', { name: 'n', path: '/p/n' }]);
  assert.equal(PROJECT_ACTIONS.create[1], 'Creating…');
  assert.equal(PROJECT_ACTIONS.bulk[1], 'Adding…');
});

test('COV-1 folders, probe and gitAvailable: what dev answered, a refusal in plain words; git counts as there on any failure', async () => {
  const r = rig({ answer: (m, u) => (u === '/api/fs/dirs?path=%2Fnope' ? [400, { error: 'no such directory' }] : u.startsWith('/api/fs/dirs') ? [200, { path: '/src', parent: '/', home: '/home/me', dirs: [{ name: 'a', path: '/src/a' }] }]
    : u.startsWith('/api/projects/probe') ? [200, { path: '/src/a', exists: true, isDir: true, vcs: 'git' }] : u === '/api/git' ? 'down' : null) });
  assert.deepEqual(await r.live.folders('/src'), { ok: true, path: '/src', parent: '/', home: '/home/me', dirs: [{ name: 'a', path: '/src/a' }], limited: false, roots: [] });
  assert.deepEqual(await r.live.folders('/nope'), { ok: false, text: 'Could not open nope: no such directory' });
  assert.deepEqual(await r.live.probe('/src/a'), { ok: true, probe: { path: '/src/a', exists: true, isDir: true, vcs: 'git' } });
  assert.equal(await r.live.gitAvailable(), true, 'a failure counts as available, as classic does');
  const r2 = rig({ answer: (m, u) => (u === '/api/git' ? [200, { available: false }] : u.startsWith('/api/projects/probe') ? [400, { error: 'path is required', code: 'INVALID' }] : 'down') });
  assert.equal(await r2.live.gitAvailable(), false);
  assert.deepEqual(await r2.live.probe('/x'), { ok: false, field: 'path is required' });
  assert.deepEqual(await r2.live.folders('/src'), { ok: false, text: 'Worca is not answering' });
});

test('COV-1 checkNew: the dry run\'s where reads displayPath; a 400 is the field\'s error with the root', async () => {
  const r = rig({ answer: (m, u, b) => (b?.name === 'taken' ? [400, { error: '/w/projects/taken already exists; pick another name', code: 'EXISTS', root: '/w/projects', rootDisplay: '~/worca/projects' }] : b?.name ? [200, { ok: true, root: '/w/projects', rootDisplay: '~/worca/projects', path: '/w/projects/alpha', displayPath: '~/worca/projects/alpha', name: 'alpha' }] : [400, { error: 'name is required', code: 'INVALID', root: '/w/projects', rootDisplay: '~/worca/projects' }]) });
  assert.deepEqual(await r.live.checkNew({ name: 'alpha', useGit: true }), { ok: true, where: '~/worca/projects/alpha' });
  assert.deepEqual(r.writes().at(-1), ['POST', '/api/projects/create', { name: 'alpha', useGit: true, dryRun: true }]);
  assert.deepEqual(await r.live.checkNew({ name: 'taken' }), { ok: false, field: 'A folder called taken already exists', where: '~/worca/projects' });
  assert.ok(!/pick another name|\/w\//.test((await r.live.checkNew({ name: 'taken' })).field), 'F-cov1-07: never dev\'s raw text');
  assert.deepEqual(await r.live.checkNew({ name: '' }), { ok: true, where: '~/worca/projects' }, 'an empty name: the root, no field');
});

test('COV-1 createProject: 201 refreshes and answers the key once listed; 400 EXISTS is the field; 500 FAILED says Could not create; one at a time', async () => {
  const g = gate();
  const r = rig({ hold: (m, u) => (u === '/api/projects/create' ? g.p : null), answer: (m, u, b) => (b.name === 'taken' ? [400, { error: '/w/projects/taken already exists; pick another name', code: 'EXISTS' }] : b.name === 'dup' ? [400, { error: 'a project named "dup" already exists', code: 'EXISTS' }] : b.name === 'boom' ? [500, { error: 'disk full', code: 'FAILED' }] : [201, { project: { key: 'alpha-1234abcd', name: 'alpha' }, projects: [] }]) });
  r.setWorld(withProject({ id: 'alpha-1234abcd', name: 'alpha', devPath: '/w/alpha' }));
  const one = r.live.createProject({ name: 'alpha', useGit: true });
  assert.equal(r.live.pending('add'), 'Creating…');
  assert.deepEqual(await r.live.createProject({ name: 'alpha', useGit: true }), { ok: false, text: '' }, 'a second press sends nothing');
  g.open();
  assert.deepEqual(await one, { ok: true, text: 'Created alpha', key: 'alpha-1234abcd' });
  assert.ok(r.refreshed.includes('projects'));
  assert.deepEqual(r.writes(), [['POST', '/api/projects/create', { name: 'alpha', useGit: true }]]);
  assert.deepEqual(await r.live.createProject({ name: 'taken' }), { ok: false, field: 'A folder called taken already exists' });
  assert.deepEqual(await r.live.createProject({ name: 'dup' }), { ok: false, field: 'dup is already a project' }, 'F-cov1-07: Stillhet\'s words');
  assert.deepEqual(await r.live.createProject({ name: 'boom' }), { ok: false, text: 'Could not create boom: disk full' });
  assert.deepEqual(r.writes().at(-1), ['POST', '/api/projects/create', { name: 'boom' }]);
});

test('COV-1 addMany: sends {projects:[{name,path}]}, sorts added and skipped by index, a key only for one added row, refuses on 400', async () => {
  const results = (b) => b.projects.map((p, index) => (p.name === 'beta' ? { index, status: 'skipped', name: p.name, path: p.path, reason: 'already registered' } : { index, status: 'added', key: `${p.name}-1111aaaa`, name: p.name, path: p.path, vcs: 'git' }));
  const r = rig({ answer: (m, u, b) => (u === '/api/projects/bulk' ? (b.projects.length > 3 ? [400, { error: 'at most 100 projects' }] : [200, { projects: [], results: results(b) }]) : null) });
  r.setWorld({ ...WORLD(), projects: [...WORLD().projects, { id: 'alpha-1111aaaa', name: 'alpha' }, { id: 'gamma-1111aaaa', name: 'gamma' }] });
  const a = await r.live.addMany([{ name: 'alpha', path: '/s/alpha', include: true }, { name: 'beta', path: '/s/beta' }, { name: 'gamma', path: '/s/gamma' }]);
  assert.deepEqual(r.writes().at(-1), ['POST', '/api/projects/bulk', { projects: [{ name: 'alpha', path: '/s/alpha' }, { name: 'beta', path: '/s/beta' }, { name: 'gamma', path: '/s/gamma' }] }]);
  assert.equal(a.ok, true);
  assert.deepEqual(a.added, [{ key: 'alpha-1111aaaa', name: 'alpha' }, { key: 'gamma-1111aaaa', name: 'gamma' }]);
  assert.deepEqual(a.skipped, [{ index: 1, name: 'beta', path: '/s/beta', reason: 'already registered' }]);
  assert.equal(a.text, 'Added 2 projects. Skipped 1: beta (already registered).');
  assert.equal(a.key, undefined, 'no key when a row was skipped');
  assert.equal(a.results.length, 3);
  assert.ok(r.refreshed.includes('projects'));
  const one = await r.live.addMany([{ name: 'alpha', path: '/s/alpha' }]);
  assert.equal(one.key, 'alpha-1111aaaa', 'one added and none skipped: its key, once listed');
  const r2 = rig({ answer: (m, u, b) => (u === '/api/projects/bulk' ? [200, { projects: [], results: results(b) }] : null) });
  const none = await r2.live.addMany([{ name: 'beta', path: '/s/beta' }]);
  assert.deepEqual([none.ok, none.added, r2.refreshed], [true, [], []], 'all skipped: nothing refreshes');
  assert.deepEqual(await r.live.addMany([1, 2, 3, 4].map((n) => ({ name: `p${n}`, path: `/s/p${n}` }))), { ok: false, text: 'Could not add 4 projects: at most 100 projects' });
});
