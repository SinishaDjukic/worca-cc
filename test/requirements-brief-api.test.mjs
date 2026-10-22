// test/requirements-brief-api.test.mjs — the product brief's HTTP API in mock mode, behind the flag (A7 design §5,
// D6, D9, D11, D14, D17): the brief page's body, create / refresh, the owner's edits, export, delete, Add this to
// the brief, the look refused with the switch off, the list and feature views, and the brief frames.
// The server is the real one (ui/server.mjs) on a repository with one commit on `main`; a bare app with an
// injected budget covers the budget refusal. Never a model call: WORCA_MOCK=1 throughout.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';
import express from 'express';

let home; let srv; let base; let prev; let shop; let cart; let bare; let mall; let hold;
let briefJob; let store;

const git = (dir, ...a) => {
  const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
/** A repository on `main` with one commit (README.md). */
async function repo(name) {
  const dir = realpathSync(await mkdtemp(join(home, `${name}-`)));
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  git(dir, 'add', '.'); git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

before(async () => {
  home = realpathSync(await mkdtemp(join(tmpdir(), 'worca-req-brief-api-')));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'requirements';
  (await import('../src/core/db.mjs'))._resetForTests();
  const { addProject } = await import('../src/core/projects.mjs');
  const add = async (name, path) => ({ key: (await addProject({ name, path })).find((p) => p.name === name).key, dir: path });
  shop = await add('shop', await repo('shop'));
  cart = await add('cart', await repo('cart'));
  const plain = realpathSync(await mkdtemp(join(home, 'plain-')));
  mkdirSync(join(plain, 'src'), { recursive: true });
  bare = await add('plain', plain);   // a folder that is no repository
  mall = await add('mall', await repo('mall'));
  hold = await add('hold', await repo('hold'));
  briefJob = await import('../src/core/requirements/brief-job.mjs');
  store = await import('../src/core/requirements/store.mjs');
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  (await import('../src/core/db.mjs'))._resetForTests();   // release the sqlite handle (Windows cannot unlink an open file)
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const request = (at) => async (method, path, body) => {
  const r = await fetch(`${at()}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* markdown */ }
  return { status: r.status, json, text, headers: r.headers };
};
const call = request(() => base);
const waitFor = async (pred, ms = 8000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const B = (p, rest = '') => `/api/requirements/brief/project/${p.key}${rest}`;

async function frames() {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const seen = [];
  ws.on('message', (d) => { try { const m = JSON.parse(String(d)); if (m.type === 'requirements-changed') seen.push(m); } catch { /* not ours */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { seen, close: () => ws.close() };
}

async function makeReady(p) {
  const r = await call('POST', B(p));
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await briefJob.briefSettled('project', p.key);
  // Not through GET: the page memoises staleness for 30 s per brief, and the staleness test commits after this.
  const b = store.getBrief('project', p.key);
  assert.equal(b.status, 'ready', JSON.stringify(b));
  return b;
}

test('the brief page before any brief: no brief, the default branch, the notes, no staleness', async () => {
  const r = await call('GET', B(shop));
  assert.equal(r.status, 200);
  assert.equal(r.json.brief, null);
  assert.deepEqual(r.json.target, { name: 'shop', branch: 'main', leftOut: [], slow: [] });
  assert.equal(r.json.notes.lookAtCode, true);
  assert.equal(r.json.notes.body, '');
  assert.equal(r.json.estimate.costUsd, null);
  assert.ok('model' in r.json.estimate);
  assert.deepEqual(r.json.usedBy, []);
  assert.equal(r.json.staleness, null);
  assert.equal((await call('GET', '/api/requirements/brief/project/nope-1234abcd')).status, 400);
  assert.equal((await call('GET', '/api/requirements/brief/team/x')).status, 400);
  const none = (await call('GET', B(bare))).json;
  assert.equal(none.target.branch, null, 'a folder without a repository has no branch to read');
  assert.equal((await call('PUT', B(shop, '/sections/users'), { value: 'Buyer: buys' })).status, 409);
  assert.equal((await call('PUT', B(shop, '/sections/users'), { value: 'Buyer: buys' })).json.error, 'There is no brief yet.');
  assert.equal((await call('DELETE', B(shop, '/sections/users/edited'))).status, 409);
  assert.equal((await call('GET', B(shop, '/markdown'))).status, 404);
});

test('create, read, edit, release, export and delete, with brief frames', async () => {
  const ws = await frames();
  try {
    const c = await call('POST', B(shop));
    assert.equal(c.status, 202);
    assert.ok(['making', 'ready'].includes(c.json.brief.status), c.json.brief.status);
    assert.equal(c.json.target.name, 'shop');
    await briefJob.briefSettled('project', shop.key);
    let v = (await call('GET', B(shop))).json;
    assert.equal(v.brief.status, 'ready');
    assert.match(v.brief.sections.product, /\[mock\]/);
    assert.deepEqual(v.brief.sections.areas.map((a) => a.name), ['Orders', 'Accounts']);
    assert.equal(v.brief.sources[0].sha, git(shop.dir, 'rev-parse', 'refs/heads/main'));
    assert.equal(v.brief.sources[0].branch, 'main');
    assert.equal(v.target.branch, 'main');
    assert.equal(v.staleness.known, true);
    assert.equal(v.staleness.commits, 0);
    for (const k of ['id', 'scopeType', 'scopeKey', 'status', 'sections', 'edited', 'sources', 'files', 'seed', 'model', 'costUsd', 'error', 'madeBy', 'madeAt', 'updatedAt']) {
      assert.ok(k in v.brief, `brief.${k}`);
    }
    await waitFor(() => ws.seen.some((f) => f.brief === `project:${shop.key}`));
    assert.ok(ws.seen.filter((f) => f.brief).every((f) => !('seq' in f)), 'a brief frame names the brief, not a feature');

    const before = ws.seen.length;
    const e = await call('PUT', B(shop, '/sections/users'), { value: 'Buyer: places orders\nAdmin: refunds them' });
    assert.equal(e.status, 200);
    assert.deepEqual(e.json.brief.sections.users, [{ name: 'Buyer', can: 'places orders' }, { name: 'Admin', can: 'refunds them' }]);
    assert.equal(e.json.brief.edited.users, true);
    assert.equal((await call('PUT', B(shop, '/sections/actors'), { value: 'x' })).status, 400);
    assert.equal((await call('PUT', B(shop, '/sections/product'), { value: ['not', 'text'] })).status, 400);
    const rel = await call('DELETE', B(shop, '/sections/users/edited'));
    assert.equal(rel.status, 200);
    assert.ok(!rel.json.brief.edited.users, 'Let Worca rewrite this clears the mark');
    assert.deepEqual(rel.json.brief.sections.users.map((u) => u.name), ['Buyer', 'Admin'], 'the text stays until a refresh');
    assert.equal((await call('DELETE', B(shop, '/sections/actors/edited'))).status, 400);
    await waitFor(() => ws.seen.length >= before + 2);

    const md = await call('GET', B(shop, '/markdown'));
    assert.equal(md.status, 200);
    assert.match(md.headers.get('content-type'), /text\/markdown/);
    assert.match(md.text, /^# Product brief: shop/);
    assert.match(md.text, /Buyer: places orders/);
    assert.equal(md.headers.get('content-disposition'), null);
    const dl = await call('GET', B(shop, '/markdown?download=1'));
    assert.equal(dl.headers.get('content-disposition'), 'attachment; filename="product-brief-shop.md"');

    const n = ws.seen.length;
    const del = await call('DELETE', B(shop));
    assert.equal(del.status, 200);
    assert.equal(del.json.brief, null);
    assert.equal(del.json.staleness, null);
    assert.equal(store.getBrief('project', shop.key), null);
    assert.equal((await call('GET', B(shop, '/markdown'))).status, 404);
    await waitFor(() => ws.seen.length > n);
  } finally { ws.close(); }
});

test('refusals write nothing: the switch off, no repository, already being made', async () => {
  assert.equal((await call('PUT', `/api/requirements/context/project/${shop.key}`, { lookAtCode: false })).status, 200);
  try {
    const off = await call('POST', B(shop));
    assert.equal(off.status, 409);
    assert.match(off.json.error, /Looking at the code is off for this project/);
    assert.equal(store.getBrief('project', shop.key), null);
  } finally { await call('PUT', `/api/requirements/context/project/${shop.key}`, { lookAtCode: true }); }

  const none = await call('POST', B(bare));
  assert.equal(none.status, 409);
  assert.equal(none.json.error, 'There is no repository to look at.');
  assert.equal(store.getBrief('project', bare.key), null);

  // A brief already being made (the row says so): the second create is refused.
  const row = store.beginBrief('project', shop.key);
  try {
    const busy = await call('POST', B(shop));
    assert.equal(busy.status, 409);
    assert.equal(busy.json.error, 'Worca is already making this brief.');
    assert.equal(store.getBrief('project', shop.key).status, 'making');
  } finally { store.failBrief(row.id, { code: 'TEST', message: 'test' }); store.deleteBrief('project', shop.key); }
});

test('the budget refusal: 409 with the brief\'s own message, nothing written', async () => {
  const { registerRequirementsRoutes } = await import('../src/core/requirements/routes.mjs');
  const app = express();
  app.use(express.json());
  registerRequirementsRoutes(app, { broadcast: () => {}, deps: { budget: () => ({ blocked: true, totalLimitUsd: 20 }) } });
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try {
    const r = await request(() => `http://127.0.0.1:${s.address().port}`)('POST', B(cart));
    assert.equal(r.status, 409);
    assert.equal(r.json.error, 'The spending limit of $20 is reached for this period. Worca can make the brief when the limit resets or is raised.');
    assert.equal(store.getBrief('project', cart.key), null);
  } finally { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
});

test('staleness after a commit to main: one commit, touching the Orders area', async () => {
  await makeReady(cart);
  writeFileSync(join(cart.dir, 'README.md'), '# cart\n\nOrders can be cancelled.\n');
  git(cart.dir, 'commit', '-q', '-am', 'orders');
  const v = (await call('GET', B(cart))).json;
  assert.equal(v.staleness.known, true);
  assert.equal(v.staleness.commits, 1);
  assert.equal(v.staleness.touching, 1);
  assert.deepEqual(v.staleness.areas, ['Orders']);
  assert.equal(v.staleness.partial, false);
  const refresh = await call('POST', B(cart));
  assert.equal(refresh.status, 202);
  assert.ok(refresh.json.brief.madeAt, 'the earlier brief stays readable while it is refreshed');
  await briefJob.briefSettled('project', cart.key);
  const after = (await call('GET', B(cart))).json;
  assert.equal(after.brief.sources[0].sha, git(cart.dir, 'rev-parse', 'refs/heads/main'));
  assert.equal(after.staleness.commits, 0);
});

test('a feature with a brief: its view, Add this to the brief, the look refused with the switch off, the list', async () => {
  await makeReady(shop);
  const ws = await frames();
  try {
    const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: shop.key, title: 'Gift message on an order', description: 'A note for the orders page' });
    assert.equal(c.status, 201);
    const seq = c.json.feature.seq;
    await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn');
    let f = (await call('GET', `/api/requirements/${seq}`)).json.feature;
    assert.equal(f.orientation.skipped, 'brief');
    assert.equal(f.brief.status, 'ready');
    assert.ok(f.brief.madeAt);
    assert.equal(f.brief.sources[0].branch, 'main');
    assert.ok(f.brief.matches.includes('Orders'), JSON.stringify(f.brief.matches));
    assert.equal(typeof f.brief.matchesMore, 'number');
    assert.equal(f.brief.lookAtCode, true);
    assert.ok('lookCostUsd' in f && (f.lookCostUsd === null || typeof f.lookCostUsd === 'number'));
    assert.equal(f.brief.sections, undefined, 'the feature view carries the brief\'s status, not its text');

    const early = await call('POST', `/api/requirements/${seq}/brief-addition`, {});
    assert.equal(early.status, 409);
    assert.equal(early.json.error, 'There is no closer look to add.');

    assert.equal((await call('POST', `/api/requirements/${seq}/look`, {})).status, 202);
    await waitFor(async () => { const x = (await call('GET', `/api/requirements/${seq}`)).json.feature; return !x.busy && x.orientation && x.orientation.summary; });
    writeFileSync(join(shop.dir, 'README.md'), '# shop\n\nGift messages.\n');
    git(shop.dir, 'commit', '-q', '-am', 'gift');
    assert.deepEqual((await call('GET', B(shop))).json.staleness.areas, ['Orders']);
    const n = ws.seen.length;
    const add = await call('POST', `/api/requirements/${seq}/brief-addition`, {});
    assert.equal(add.status, 200, JSON.stringify(add.json));
    assert.ok(add.json.feature.orientation.addedToBrief);
    assert.equal(add.json.feature.seq, seq);
    const area = store.getBrief('project', shop.key).sections.areas.find((a) => a.added);
    assert.equal(`${area.belongsTo}: ${area.name}`, 'Orders: Gift message on an order');
    assert.deepEqual(area.files, ['README.md'], 'relative to the checkout');
    assert.deepEqual((await call('GET', B(shop))).json.staleness.areas, ['Orders', 'Orders: Gift message on an order'],
      'the added area counts at once, though the commits come from the memo');
    await waitFor(() => ws.seen.slice(n).some((x) => x.brief === `project:${shop.key}`) && ws.seen.slice(n).some((x) => x.seq === seq));
    const again = await call('POST', `/api/requirements/${seq}/brief-addition`, {});
    assert.equal(again.status, 409);
    assert.equal(again.json.error, 'Already added to the brief.');

    assert.equal((await call('PUT', `/api/requirements/context/project/${shop.key}`, { lookAtCode: false })).status, 200);
    try {
      const orientation = (await call('GET', `/api/requirements/${seq}`)).json.feature.orientation;
      const look = await call('POST', `/api/requirements/${seq}/look`, {});
      assert.equal(look.status, 409);
      assert.equal(look.json.error, 'Looking at the code is off for this project.');
      f = (await call('GET', `/api/requirements/${seq}`)).json.feature;
      assert.deepEqual(f.orientation, orientation, 'the orientation is unchanged');
      assert.equal(f.brief.lookAtCode, false);
      const list = (await call('GET', '/api/requirements')).json;
      assert.deepEqual(list.briefs.find((b) => b.scopeKey === shop.key),
        { scopeType: 'project', scopeKey: shop.key, status: 'ready', madeAt: store.getBrief('project', shop.key).madeAt, lookAtCode: false });
      assert.ok(list.briefs.some((b) => b.scopeKey === cart.key && b.lookAtCode === true));
    } finally { await call('PUT', `/api/requirements/context/project/${shop.key}`, { lookAtCode: true }); }

    const page = (await call('GET', B(shop))).json;
    assert.deepEqual(page.usedBy, [{ seq, id: `FEAT-${seq}` }]);
  } finally { ws.close(); }
});

test('a feature without a brief: brief null', async () => {
  const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: bare.key, title: 'Plain', description: 'd' });
  const seq = c.json.feature.seq;
  await waitFor(async () => !(await call('GET', `/api/requirements/${seq}`)).json.feature.busy);
  const f = (await call('GET', `/api/requirements/${seq}`)).json.feature;
  assert.equal(f.brief, null);
  assert.ok('lookCostUsd' in f);
});

test('brief frames: silent while the flag is off, `{ type, brief }` while it is on', async () => {
  const { requirementsBriefNotifier } = await import('../src/core/requirements/routes.mjs');
  const sent = [];
  const onBrief = requirementsBriefNotifier((frame) => sent.push(frame));
  delete process.env.WORCA_FLAGS;
  try { onBrief('project', 'p-1'); } finally { process.env.WORCA_FLAGS = 'requirements'; }
  assert.deepEqual(sent, []);
  onBrief('workspace', 'w:1');
  assert.deepEqual(sent, [{ type: 'requirements-changed', brief: 'workspace:w:1' }]);
});

test('flag off: the brief routes answer the gate\'s 404 and a refused create sends no frame', async () => {
  const ws = await frames();
  delete process.env.WORCA_FLAGS;
  try {
    for (const [m, p] of [['GET', B(cart)], ['POST', B(cart)], ['DELETE', B(cart)], ['GET', B(cart, '/markdown')],
      ['PUT', B(cart, '/sections/users')], ['DELETE', B(cart, '/sections/users/edited')], ['POST', '/api/requirements/1/brief-addition']]) {
      const r = await call(m, p, m === 'GET' ? undefined : {});
      assert.equal(r.status, 404, `${m} ${p}`);
      assert.deepEqual(r.json, { error: 'not found' });
    }
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(ws.seen, []);
  } finally { process.env.WORCA_FLAGS = 'requirements'; ws.close(); }
});

// ---------------------------------------------------------------- Task 6 review fixes

test('staleness follows the owner: editing What exists today stops the check at once; releasing it brings it back', async () => {
  await makeReady(mall);
  writeFileSync(join(mall.dir, 'README.md'), '# mall\n\nOrders.\n');
  git(mall.dir, 'commit', '-q', '-am', 'orders');
  const v = (await call('GET', B(mall))).json;
  assert.equal(v.staleness.commits, 1);
  assert.deepEqual(v.staleness.areas, ['Orders']);
  const e = await call('PUT', B(mall, '/sections/areas'), { value: 'Orders (partly): checkout\nAccounts (exists): sign-in' });
  assert.equal(e.status, 200);
  assert.equal(e.json.staleness.checked, false);
  assert.equal(e.json.staleness.touching, 0);
  assert.deepEqual(e.json.staleness.areas, []);
  assert.equal(e.json.staleness.commits, 1);
  const r = await call('DELETE', B(mall, '/sections/areas/edited'));
  assert.equal(r.json.staleness.checked, true);
  assert.deepEqual(r.json.staleness.areas, ['Orders']);
});

test('releasing a section that is not edited writes nothing and sends no frame', async () => {
  const before = store.getBrief('project', mall.key);
  assert.ok(!before.edited.users);
  const ws = await frames();
  try {
    const r = await call('DELETE', B(mall, '/sections/users/edited'));
    assert.equal(r.status, 200);
    assert.equal(r.json.brief.updatedAt, before.updatedAt);
    await new Promise((res) => setTimeout(res, 100));
    assert.deepEqual(ws.seen, []);
    assert.equal(store.getBrief('project', mall.key).updatedAt, before.updatedAt);
  } finally { ws.close(); }
});

test('saving the notes sends the brief frame (the switch shows on the brief page, the list and the feature)', async () => {
  const ws = await frames();
  try {
    assert.equal((await call('PUT', `/api/requirements/context/project/${mall.key}`, { body: 'Shoppers', lookAtCode: true })).status, 200);
    await waitFor(() => ws.seen.some((f) => f.brief === `project:${mall.key}`));
  } finally { ws.close(); }
});

/** A bare app with the requirements routes and `deps`, for one test. */
async function bareApp(deps, fn) {
  const { registerRequirementsRoutes } = await import('../src/core/requirements/routes.mjs');
  const app = express();
  app.use(express.json());
  // WORCA_MOCK may be unset in here while a real server is live: a model call fails loudly, it never spawns.
  registerRequirementsRoutes(app, { broadcast: () => {}, deps: { runClaudeImpl: () => { throw new Error('no model call in tests'); }, ...deps } });
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try { return await fn(request(() => `http://127.0.0.1:${s.address().port}`)); }
  finally { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
}

test('a create probes the default branch once (the 202 body reuses the refusals\' target)', async () => {
  const { defaultBranchRef } = await import('../src/core/worktree.mjs');
  let n = 0;
  await bareApp({ defaultBranchRef: (...a) => { n += 1; return defaultBranchRef(...a); } }, async (req) => {
    const r = await req('POST', B(mall));
    assert.equal(r.status, 202);
    assert.equal(r.json.target.branch, 'main');
    assert.equal(n, 1);
    await briefJob.briefSettled('project', mall.key);
  });
});

test('while a brief is being made (a job held open, no model): create and delete refused, edits kept, not recovered', async () => {
  await makeReady(hold);
  let release;
  const gate = new Promise((r) => { release = r; });
  const mockWas = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;   // the real job path, with a checkout that waits and then finds nothing (NO_REPO)
  try {
    await bareApp({ openLook: () => gate.then(() => null) }, async (req) => {
      const c = await req('POST', B(hold));
      assert.equal(c.status, 202);
      assert.equal(c.json.brief.status, 'making');
      assert.ok(briefJob.isBriefBusy('project', hold.key));
      const again = await req('POST', B(hold));
      assert.equal(again.status, 409);
      assert.equal(again.json.error, 'Worca is already making this brief.');
      const del = await req('DELETE', B(hold));
      assert.equal(del.status, 409);
      assert.equal(del.json.error, 'Worca is making this brief. Try again when it is done.');
      const e = await req('PUT', B(hold, '/sections/users'), { value: 'Clerk: rings up sales' });
      assert.equal(e.status, 200);
      assert.equal(briefJob.recoverBriefs(), 0, 'a running job is not interrupted by the sweep');
      release();
      await briefJob.briefSettled('project', hold.key);
    });
  } finally { release(); if (mockWas === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = mockWas; }
  const b = store.getBrief('project', hold.key);
  assert.equal(b.status, 'ready', 'the earlier brief is kept');
  assert.equal(b.error.code, 'NO_REPO');
  assert.deepEqual(b.sections.users, [{ name: 'Clerk', can: 'rings up sales' }]);
  assert.equal(b.edited.users, true);
});

test('a workspace brief: no branch on the page; the export names each member on its provenance line', async () => {
  const { createWorkspace } = await import('../src/core/workspaces.mjs');
  const ws = await createWorkspace({ name: 'Market', projectPaths: [shop.dir, cart.dir] });
  const W = (rest = '') => `/api/requirements/brief/workspace/${encodeURIComponent(ws.id)}${rest}`;
  const page = (await call('GET', W())).json;
  assert.equal(page.target.name, 'Market');
  assert.equal(page.target.branch, null);
  assert.deepEqual(page.target.leftOut, []);
  const c = await call('POST', W());
  assert.equal(c.status, 202, JSON.stringify(c.json));
  await briefJob.briefSettled('workspace', ws.id);
  const md = await call('GET', W('/markdown?download=1'));
  assert.equal(md.status, 200);
  assert.match(md.text, /^# Product brief: Market/);
  assert.match(md.text, /^shop-[A-Za-z0-9]+: Made from main @ [0-9a-f]{7} on \d{4}-\d{2}-\d{2}$/m);
  assert.match(md.text, /^cart-[A-Za-z0-9]+: Made from main @ [0-9a-f]{7} on \d{4}-\d{2}-\d{2}$/m);
  assert.equal(md.headers.get('content-disposition'), 'attachment; filename="product-brief-market.md"');
});
