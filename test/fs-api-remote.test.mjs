// test/fs-api-remote.test.mjs — the folder browser and folder-path routes on a hosted Worca.
// A separate file because REMOTE_MODE is fixed when ui/server.mjs is imported (as
// api-actions-remote.test.mjs). With the terminal and actions off, a signed-in person may
// browse, add and install only inside Worca's own folders (src/core/fs-scope.mjs);
// WORCA_TERMINAL_REMOTE=1 or WORCA_ACTIONS_REMOTE=1 lifts the limit (read per request).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, symlink, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { _testing as dialogTesting } from '../src/core/folder-dialog.mjs';
import { TEAM, AUD, CERTS_URL, makeAccessKey, signAccessJwt, certsFetch } from './helpers/access-jwt.mjs';
import { checkRows } from './helpers/rows.mjs';

const PUBLIC = 'worca-01.example.com';
const accessKey = makeAccessKey();
const fakeCerts = certsFetch({ keys: [accessKey] });
const realFetch = globalThis.fetch;
const ENV_KEYS = ['WORCA_HOME', 'HOME', 'USERPROFILE', 'WORCA_MOCK', 'WORCA_ALLOWED_HOSTS', 'WORCA_CF_ACCESS_TEAM_DOMAIN',
  'WORCA_CF_ACCESS_AUD', 'WORCA_ACTIONS_REMOTE', 'WORCA_TERMINAL_REMOTE', 'WORCA_PROJECTS_ROOT', 'WORCA_DATA_DIR',
  'WORCA_NO_NATIVE_DIALOG', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME'];
const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let base, homeDir, projects, outside, srv, port, linked = false;

/** A request through the public Host with a valid Access token (a signed-in person). */
function remote(method, path, body) {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: {
      host: PUBLIC, origin: `https://${PUBLIC}`, 'cf-access-jwt-assertion': signAccessJwt(accessKey),
      ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (resp) => {
      let text = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { text += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: text ? JSON.parse(text) : null }));
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}
const dirs = (p) => remote('GET', `/api/fs/dirs?path=${encodeURIComponent(p)}`);
const refused = (r) => {
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, 'FS_OUTSIDE_ALLOWED');
  assert.match(r.body.error, /WORCA_TERMINAL_REMOTE=1 or WORCA_ACTIONS_REMOTE=1/);
};

before(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-fsremote-')));
  homeDir = join(base, 'worca');
  projects = join(base, 'projects');
  outside = join(base, 'outside');
  await mkdir(homeDir, { recursive: true });
  await mkdir(join(projects, 'app'), { recursive: true });
  await mkdir(join(projects, 'other'), { recursive: true });
  await mkdir(join(outside, 'secret'), { recursive: true });
  await mkdir(join(projects, '.secret'), { recursive: true });
  await mkdir(join(projects, 'app', '.git'), { recursive: true });
  try { await symlink(outside, join(projects, 'escape'), 'dir'); linked = true; } catch { /* no symlink perms */ }
  process.env.WORCA_HOME = homeDir;
  process.env.HOME = base;
  process.env.USERPROFILE = base;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_PROJECTS_ROOT = projects;
  process.env.WORCA_NO_NATIVE_DIALOG = '1';
  process.env.WORCA_ALLOWED_HOSTS = PUBLIC;
  process.env.WORCA_CF_ACCESS_TEAM_DOMAIN = TEAM;
  process.env.WORCA_CF_ACCESS_AUD = AUD;
  for (const k of ['WORCA_ACTIONS_REMOTE', 'WORCA_TERMINAL_REMOTE', 'WORCA_DATA_DIR', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME']) delete process.env[k];
  _resetForTests();
  // Registry entries from before the limit existed (any path could be added): they must not widen it.
  const { addProject } = await import('../src/core/projects.mjs');
  await addProject({ name: 'old-outside', path: outside });
  await addProject({ name: 'old-base', path: base });
  globalThis.fetch = (url, opts) => (String(url) === CERTS_URL ? fakeCerts(url) : realFetch(url, opts));
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});

afterEach(() => { delete process.env.WORCA_ACTIONS_REMOTE; delete process.env.WORCA_TERMINAL_REMOTE; });

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  globalThis.fetch = realFetch;
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (base) await rm(base, { recursive: true, force: true, maxRetries: 3 });
});

test('remote mode: the folder browser lists only inside Worca\'s folders', async () => {
  await checkRows([
    { name: 'a blank listing opens the projects root, limited, Up disabled', run: async () => {
      const r = await dirs('');
      assert.equal(r.status, 200);
      assert.equal(r.body.path, projects);
      assert.equal(r.body.limited, true);
      assert.equal(r.body.parent, null);
      assert.ok(r.body.roots.includes(projects));
      assert.deepEqual(r.body.dirs.map((d) => d.name), ['app', 'other'], 'the escaping link is not listed');
    } },
    { name: 'inside the projects root and the data dir lists', run: async () => {
      assert.equal((await dirs(join(projects, 'app'))).status, 200);
      const data = await dirs(join(homeDir, '.worca-cc'));
      assert.equal(data.status, 200, JSON.stringify(data.body));
    } },
    { name: 'outside is refused with 403 FS_OUTSIDE_ALLOWED', run: async () => {
      refused(await dirs(outside));
      refused(await dirs(base));
      refused(await dirs('/'));
      refused(await dirs(join(outside, 'no-such-dir')));
    } },
    { name: 'a `..` escape is refused', run: async () => {
      refused(await dirs(`${projects}/app/../../outside`));
    } },
    { name: 'a symlink escape is refused', run: async () => {
      if (!linked) return;
      refused(await dirs(join(projects, 'escape')));
      refused(await dirs(join(projects, 'escape', 'secret')));
    } },
    { name: 'the native dialog answers unsupported (the in-app browser takes over)', run: async () => {
      const r = await remote('POST', '/api/fs/pick-folder', { purpose: 'project' });
      assert.equal(r.status, 200);
      assert.equal(r.body.status, 'unsupported');
    } },
    { name: 'no native dialog is offered, even where the server could open one (it would open on the server)', run: async () => {
      dialogTesting.set({ platform: 'darwin', env: {} });
      try {
        const r = await remote('GET', '/api/fs/pick-folder');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, { available: false });
      } finally { dialogTesting.reset(); }
    } },
  ]);
});

test('remote mode: adding, installing into and rooting at a folder outside are refused', async () => {
  await checkRows([
    { name: 'POST /api/projects outside -> 403, inside -> 200', run: async () => {
      refused(await remote('POST', '/api/projects', { name: 'secret', path: join(outside, 'secret') }));
      if (linked) refused(await remote('POST', '/api/projects', { name: 'esc', path: join(projects, 'escape', 'secret') }));
      const ok = await remote('POST', '/api/projects', { name: 'app', path: join(projects, 'app') });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    } },
    { name: 'POST /api/projects/bulk with one path outside -> 403', run: async () => {
      refused(await remote('POST', '/api/projects/bulk', { projects: [
        { name: 'other', path: join(projects, 'other') }, { name: 'secret', path: join(outside, 'secret') }] }));
    } },
    { name: 'POST /api/install outside -> 403', run: async () => {
      refused(await remote('POST', '/api/install', { projectDir: join(outside, 'secret') }));
    } },
    { name: 'POST /api/settings projectsRoot / root outside -> 403', run: async () => {
      refused(await remote('POST', '/api/settings', { projectsRoot: outside }));
      refused(await remote('POST', '/api/settings', { root: outside }));
    } },
  ]);
});

test('remote mode: the workspace wizard import reads only inside Worca\'s folders', async () => {
  const importOf = (body) => remote('POST', '/api/workspaces/import-candidates', body);
  const outsideRow = (r, path) => {
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = r.body.candidates.find((c) => c.path === path);
    assert.ok(row, `a row for ${path}: ${JSON.stringify(r.body.candidates)}`);
    assert.equal(row.status, 'problem');
    assert.match(row.problem, /outside Worca's data and projects folders/);
  };
  await checkRows([
    { name: 'a picked or pasted path outside is a problem row, nothing about it is read', run: async () => {
      outsideRow(await importOf({ paths: [join(outside, 'secret')] }), join(outside, 'secret'));
      outsideRow(await importOf({ text: `${join(outside, 'no-such-dir')}\n` }), join(outside, 'no-such-dir'));
      outsideRow(await importOf({ paths: [`${projects}/app/../../outside`] }), outside);
    } },
    { name: 'a folder inside is searched without following the escaping link, even to a repository', run: async () => {
      await mkdir(join(outside, 'secret', '.git'), { recursive: true });
      try {
        for (const depth of [1, 2]) {
          const r = await importOf({ paths: [projects], depth });
          assert.equal(r.status, 200, JSON.stringify(r.body));
          assert.ok(r.body.candidates.length > 0);
          for (const c of r.body.candidates) assert.ok(c.path.startsWith(projects + '/'), `${c.path} is inside`);
          assert.ok(!r.body.candidates.some((c) => c.path.startsWith(join(projects, 'escape'))), 'the link is not listed');
        }
      } finally { await rm(join(outside, 'secret', '.git'), { recursive: true, force: true }); }
    } },
    { name: 'a .code-workspace inside naming a folder outside: that row is a problem', run: async () => {
      const ws = join(projects, 'team.code-workspace');
      await writeFile(ws, JSON.stringify({ folders: [{ path: '../outside/secret' }, { path: 'other' }] }));
      try {
        outsideRow(await importOf({ paths: [ws] }), join(outside, 'secret'));
      } finally { await rm(ws, { force: true }); }
    } },
    { name: 'WORCA_TERMINAL_REMOTE=1 lifts it', run: async () => {
      process.env.WORCA_TERMINAL_REMOTE = '1';
      try {
        const r = await importOf({ paths: [join(outside, 'secret')] });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.doesNotMatch(r.body.candidates[0].problem || '', /outside Worca's data/);
      } finally { delete process.env.WORCA_TERMINAL_REMOTE; }
    } },
  ]);
});

test('remote mode: WORCA_TERMINAL_REMOTE=1 or WORCA_ACTIONS_REMOTE=1 allows the full listing', async () => {
  await checkRows(['WORCA_TERMINAL_REMOTE', 'WORCA_ACTIONS_REMOTE'].map((flag) => ({ name: flag, run: async () => {
    delete process.env.WORCA_ACTIONS_REMOTE; delete process.env.WORCA_TERMINAL_REMOTE;
    process.env[flag] = '1';
    try {
      const r = await dirs(outside);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.limited, undefined);
      assert.deepEqual(r.body.dirs.map((d) => d.name), ['secret']);
      if (linked) assert.equal((await dirs(join(projects, 'escape'))).status, 200);
      const add = await remote('POST', '/api/projects', { name: `secret-${flag}`, path: join(outside, 'secret') });
      assert.notEqual(add.status, 403, JSON.stringify(add.body));
      await remote('DELETE', `/api/projects?name=${encodeURIComponent(`secret-${flag}`)}`);
    } finally { delete process.env[flag]; }
  } })));
});

test('remote mode: registered projects, broad roots and hidden folders do not widen the limit', async () => {
  const worcaData = await realpath(join(homeDir, '.worca-cc'));
  await checkRows([
    { name: 'a pre-existing registry entry outside (and one for the parent of every root) opens nothing', run: async () => {
      const r = await dirs('');
      assert.deepEqual(r.body.roots, [projects, worcaData]);
      refused(await dirs(outside));
      refused(await dirs(join(outside, 'secret')));
      refused(await dirs(base));
      refused(await remote('POST', '/api/install', { projectDir: outside }));
    } },
    { name: 'a projects root of / (or one segment) is ignored: the Worca home stays, the disk does not open', run: async () => {
      const prevRoot = process.env.WORCA_PROJECTS_ROOT;
      const warn = console.warn;
      const warned = [];
      console.warn = (m) => warned.push(String(m));
      try {
        for (const broad of ['/', '/usr']) {
          process.env.WORCA_PROJECTS_ROOT = broad;
          const r = await dirs('');
          assert.equal(r.status, 200, JSON.stringify(r.body));
          assert.deepEqual(r.body.roots, [worcaData]);
          assert.equal(r.body.path, worcaData);
          refused(await dirs('/etc'));
          refused(await dirs(projects));
        }
        assert.ok(warned.some((m) => /too broad/.test(m)), 'the skipped root is logged');
      } finally {
        console.warn = warn;
        process.env.WORCA_PROJECTS_ROOT = prevRoot;
      }
    } },
    { name: 'a hidden folder inside an allowed root is refused for browse, add and install', run: async () => {
      refused(await dirs(join(projects, '.secret')));
      refused(await remote('POST', '/api/projects', { name: 'hidden', path: join(projects, '.secret') }));
      refused(await remote('POST', '/api/projects/bulk', { projects: [{ name: 'hidden', path: join(projects, '.secret') }] }));
      refused(await remote('POST', '/api/install', { projectDir: join(projects, 'app', '.git') }));
      refused(await remote('POST', '/api/install', { projectDir: join(projects, '.secret') }));
    } },
  ]);
});

test('remote mode, no projects root configured: the OS home stays browsable and addable (S50: today\'s rule); outside it is refused', async () => {
  const prevRoot = process.env.WORCA_PROJECTS_ROOT;
  const elsewhere = await realpath(await mkdtemp(join(tmpdir(), 'worca-cc-fsremote-else-')));   // outside HOME (= base)
  const mine = join(base, 'mine');
  const def = join(homeDir, '.worca-cc', 'projects');
  delete process.env.WORCA_PROJECTS_ROOT;                 // the default root, <worcaHome>/projects (U6)
  try {
    await mkdir(mine, { recursive: true });
    const blank = await dirs('');
    assert.equal(blank.status, 200, JSON.stringify(blank.body));
    assert.equal(blank.body.path, base, 'a blank browse opens at home');
    assert.equal((await dirs(mine)).status, 200, 'a folder under home lists');
    refused(await dirs(elsewhere));
    assert.equal((await remote('GET', `/api/projects/probe?path=${encodeURIComponent(mine)}`)).status, 200, 'the probe follows the same roots');
    refused(await remote('GET', `/api/projects/probe?path=${encodeURIComponent(elsewhere)}`));
    refused(await remote('GET', `/api/projects/probe?path=${encodeURIComponent(join(homeDir, '.worca-cc', 'store'))}`));   // the Worca home stays hidden
    await mkdir(def, { recursive: true });
    refused(await dirs(join(homeDir, '.worca-cc')));             // the Worca home stays a hidden folder of home (today's rule)
    assert.equal((await dirs('')).body.path, base, 'the default projects root is never a start');
    await mkdir(join(def, 'site'), { recursive: true });
    assert.equal((await dirs(def)).status, 200, 'the default projects root (in the Worca home, a hidden folder of home) is browsable');
    const inDefault = await remote('POST', '/api/projects', { name: 'site-in-default', path: join(def, 'site') });
    assert.equal(inDefault.status, 200, JSON.stringify(inDefault.body));
    const add = await remote('POST', '/api/projects', { name: 'mine', path: mine });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    if (linked) {                                                // a link in place of the projects folder is not a root
      const store = join(homeDir, '.worca-cc', 'store', 'x');
      await mkdir(store, { recursive: true });
      await rm(def, { recursive: true, force: true });
      await symlink(join(homeDir, '.worca-cc', 'store'), def, 'dir');
      refused(await dirs(store));
      refused(await remote('POST', '/api/install', { projectDir: store }));
    }
  } finally {
    if (prevRoot === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prevRoot;
    await rm(elsewhere, { recursive: true, force: true });
    await rm(def, { recursive: true, force: true });
  }
});

test('remote mode: the Add project probe stays inside Worca\'s folders; New creates under the projects root', async () => {
  refused(await remote('GET', `/api/projects/probe?path=${encodeURIComponent(join(outside, 'secret'))}`));
  const inside = await remote('GET', `/api/projects/probe?path=${encodeURIComponent(join(projects, 'app'))}`);
  assert.equal(inside.status, 200, JSON.stringify(inside.body));
  assert.equal(inside.body.vcs, 'git');
  const made = await remote('POST', '/api/projects/create', { name: 'hosted-new' });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.project.path, join(projects, 'hosted-new'));
});

test('remote mode (#693): the probe offers an enclosing repository root only inside Worca\'s folders', async () => {
  const docs = join(projects, 'other', 'docs');
  const probe693 = join(homeDir, '.worca-cc', 'probe693');
  await mkdir(docs, { recursive: true });
  await mkdir(probe693, { recursive: true });
  for (const d of [join(projects, 'other'), homeDir]) spawnSync('git', ['init', '-q'], { cwd: d });
  try {
    const inRoots = await remote('GET', `/api/projects/probe?path=${encodeURIComponent(docs)}`);
    assert.equal(inRoots.status, 200, JSON.stringify(inRoots.body));
    assert.deepEqual([inRoots.body.insideRepo, inRoots.body.repoRoot], [true, join(projects, 'other')]);
    const outRoots = await remote('GET', `/api/projects/probe?path=${encodeURIComponent(probe693)}`);
    assert.equal(outRoots.status, 200, JSON.stringify(outRoots.body));
    assert.equal(outRoots.body.insideRepo, true);
    assert.equal('repoRoot' in outRoots.body, false, 'a root outside the allowed folders is not disclosed');
    process.env.WORCA_ACTIONS_REMOTE = '1';                       // not limited: the root is offered
    assert.equal((await remote('GET', `/api/projects/probe?path=${encodeURIComponent(probe693)}`)).body.repoRoot, homeDir);
  } finally {
    for (const d of [join(projects, 'other', '.git'), join(homeDir, '.git'), docs, probe693]) await rm(d, { recursive: true, force: true });
  }
});

test('remote mode: a project card adding a folder outside Worca\'s folders fails FS_OUTSIDE_ALLOWED at apply and touches nothing', async () => {
  const store = await import('../src/core/ask/store.mjs');
  const t = store.createThread();
  const dir = join(outside, 'secret');
  store.appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_0000aa01', state: 'proposed',
    card: { type: 'project', kind: 'add', summary: 'Add secret', name: 'secret', path: dir, vcs: 'git', change: { kind: 'add', name: 'secret', path: dir, useGit: true } } }] });
  const r = await remote('POST', `/api/ask/threads/${t.id}/cards/card_0000aa01`, { state: 'applied' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.block.state, 'failed');
  assert.equal(r.body.block.card.result.code, 'FS_OUTSIDE_ALLOWED');
  assert.equal(existsSync(join(dir, '.git')), false, 'no git init outside');
  // The failed card starts an event turn whose spawn reads WORCA_MOCK: let it end before after() restores the env
  // (else, under load, it spawns the real claude binary).
  const turnId = r.body.turn && r.body.turn.assistantMessageId;
  for (const t0 = Date.now(); turnId && store.getMessage(turnId)?.status === 'streaming';) {
    if (Date.now() - t0 > 10000) throw new Error('the event turn did not end');
    await new Promise((res) => setTimeout(res, 25));
  }
});
