// test/stillhet-gate-instances.test.mjs — tools/stillhet-gate-instances.mjs starts the gate instances A–D (test protocol §2),
// each with its own HOME (F-X-01: settings.json lives under HOME, so an instance without one changes the owner's settings),
// keeps `rail` in that HOME's settings and never in WORCA_FLAGS (P11), stops only the processes it started, and checks the
// Claude login per HOME without ever printing or storing the CLI's output. In-process apart from a fixture server and a fake
// `claude` (a shell script on PATH, as test/scan-auth-gate.test.mjs does).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  INSTANCES, RECORD_FILE, GateInstanceError, parseArgs, planInstances, buildInstanceEnv, instanceSettings, prepareHome,
  startInstance, listInstances, stopInstances, loginStatus, loginReason, main, defaultPs, isolateCopy, claimInstance,
} from '../tools/stillhet-gate-instances.mjs';
import { CLAUDE_AUTH_ENV_KEYS, CLAUDE_AUTH_ENV_FLAGS } from '../src/core/preflight.mjs';

const posixOnly = process.platform === 'win32' ? 'ps and a shell-script claude' : false;
const scratch = mkdtempSync(join(tmpdir(), 'worca-gate-instances-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const fresh = (name) => { const d = join(scratch, `${name}-${++n}`); mkdirSync(d, { recursive: true }); return d; };
const FIXTURE = fileURLToPath(new URL('./fixtures/gate-instance-server.mjs', import.meta.url));
const io = (extra = {}) => { const out = [], err = []; return { out, err, io: { out: (l) => out.push(l), err: (l) => err.push(l), ...extra } }; };
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

/** Every file under `dir` → { rel: { sha, mtimeMs } }. */
function snapshot(dir, rel = '') {
  const out = {};
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = join(rel, e.name);
    if (e.isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = { sha: createHash('sha256').update(readFileSync(join(dir, r))).digest('hex'), mtimeMs: statSync(join(dir, r)).mtimeMs };
  }
  return out;
}
/** A fake real home with a store: settings, a DB whose run row names a worktree under that store, a run manifest with the
 *  same kind of paths, and a nested file. */
function fakeRealHome() {
  const home = fresh('realhome');
  const store = join(home, '.worca-cc');
  mkdirSync(join(store, 'store', 'p'), { recursive: true });
  mkdirSync(join(store, 'runs', 'r1'), { recursive: true });
  writeFileSync(join(store, 'settings.json'), JSON.stringify({ theme: 'dark', uiLevel: 'advanced', flags: { other: true, rail: true }, onboarding: { hidden: true } }));
  const db = new DatabaseSync(join(store, 'worca-cc.db'));
  db.exec('CREATE TABLE pipelines (id TEXT PRIMARY KEY, branch TEXT, project_dir TEXT, n INTEGER)');
  db.prepare('INSERT INTO pipelines VALUES (?, ?, ?, ?)').run('p1', JSON.stringify({ worktreeDir: join(store, 'runs', 'r1', 'repos', 'x'), feature: 'feat/x' }), '/repos/owner', 7);
  db.close();
  writeFileSync(join(store, 'runs', 'r1', 'run.json'), JSON.stringify({ runRoot: join(store, 'runs', 'r1'), repo: '/repos/owner' }));
  writeFileSync(join(store, 'store', 'p', 'plan.md'), '# plan\n');
  return home;
}
const branchOf = (store) => { const db = new DatabaseSync(join(store, 'worca-cc.db')); try { return db.prepare('SELECT branch, project_dir, n FROM pipelines').get(); } finally { db.close(); } };

test('PLAN-Gc F-X-01: each instance env has its own HOME/USERPROFILE, WORCA_HOME = that HOME (the store is HOME/.worca-cc), WORCA_AUTO_RESUME=0, its protocol port', () => {
  const root = join(scratch, 'plan-root');
  const plan = planInstances(parseArgs(['start', '--root', root]), { realHome: fakeRealHome(), tmp: scratch });
  assert.deepEqual(plan.map((i) => i.letter), ['A', 'B', 'C', 'D']);
  for (const inst of plan) {
    const env = buildInstanceEnv(inst, { PATH: '/bin', HOME: '/owner', PORT: '4317' });
    assert.equal(env.HOME, join(root, inst.letter));
    assert.equal(env.USERPROFILE, join(root, inst.letter));
    // WORCA_HOME is the base the server appends .worca-cc to (src/core/projects.mjs worcaHome); the copy lives at HOME/.worca-cc
    assert.equal(env.WORCA_HOME, join(root, inst.letter));
    assert.equal(env.WORCA_AUTO_RESUME, '0');
    assert.equal(env.PORT, String(INSTANCES[inst.letter].port));
    assert.equal(env.PATH, '/bin');
  }
  assert.ok(!existsSync(root), 'planning writes nothing');
});

test('PLAN-Gc: default ports are 4501–4504 and --port overrides one letter', () => {
  const realHome = fakeRealHome();
  const ports = (argv) => Object.fromEntries(planInstances(parseArgs(argv), { realHome, tmp: scratch }).map((i) => [i.letter, i.port]));
  assert.deepEqual(ports(['start']), { A: 4501, B: 4502, C: 4503, D: 4504 });
  assert.deepEqual(ports(['start', '--port', 'A=4601']), { A: 4601, B: 4502, C: 4503, D: 4504 });
  assert.deepEqual(planInstances(parseArgs(['start', 'B,D']), { realHome, tmp: scratch }).map((i) => i.letter), ['B', 'D']);
  assert.equal(planInstances(parseArgs(['start']), { realHome, tmp: scratch })[0].home, join(scratch, 'worca-gate-instances', 'A'));
  assert.throws(() => parseArgs(['start', '--bogus']), (e) => e instanceof GateInstanceError && e.code === 'bad-arg');
});

test('PLAN-Gc F-X-01: refuses port 4317, a HOME equal to the real home and a root inside the real store, and writes nothing', async () => {
  const realHome = fakeRealHome();
  const before = snapshot(realHome);
  const cases = [
    [['start', '--root', join(scratch, 'never-1'), '--port', 'A=4317'], 'owner-port', join(scratch, 'never-1')],
    [['start', '--root', join(scratch, 'never-2'), '--port', 'B=80'], 'bad-port', join(scratch, 'never-2')],
    [['start', '--root', join(scratch, 'never-3'), 'E'], 'unknown-letter', join(scratch, 'never-3')],
    [['start', '--root', join(scratch, 'never-4'), '--mock-env', 'PATH=/x'], 'bad-mock-env', join(scratch, 'never-4')],
    [['start', '--root', realHome], 'root-in-real-store', null],
    [['start', '--root', join(realHome, '.worca-cc', 'gates')], 'root-in-real-store', join(realHome, '.worca-cc', 'gates')],
  ];
  for (const [argv, code, absent] of cases) {
    const c = io({ realHome, tmp: scratch });
    assert.equal(await main(argv, c.io), 2, argv.join(' '));
    assert.match(c.err.join('\n'), new RegExp(`^${code}: `), argv.join(' '));
    if (absent) assert.ok(!existsSync(absent), `${absent} was not created`);
  }
  // a HOME equal to the real one (the real home IS ROOT/A), compared through realpath (/var vs /private/var on macOS)
  const root = fresh('root-holds-real');
  mkdirSync(join(root, 'A'));
  assert.throws(() => planInstances(parseArgs(['start', 'A', '--root', root]), { realHome: join(root, 'A'), tmp: scratch }),
    (e) => e.code === 'real-home');
  const c = io({ realHome: join(root, 'A'), tmp: scratch });
  assert.equal(await main(['start', 'A', '--root', root], c.io), 2);
  assert.deepEqual(readdirSync(join(root, 'A')), [], 'nothing written into the real home');
  assert.deepEqual(snapshot(realHome), before, 'the real store is untouched');
});

test('PLAN-Gc P11 (NV-14, NV-15, SX-04, OB-08): rail is set in the instance settings only; WORCA_FLAGS, CLAUDE_CONFIG_DIR and the Claude auth env keys are dropped', () => {
  const parent = { PATH: '/bin', WORCA_FLAGS: 'rail', CLAUDE_CONFIG_DIR: '/owner/.claude', NODE_TEST_CONTEXT: 'child-v8', WORCA_TEST_ALLOW_HOME_FALLBACK: '1' };
  for (const k of [...CLAUDE_AUTH_ENV_KEYS, ...CLAUDE_AUTH_ENV_FLAGS]) parent[k] = 'sk-owner';
  const frozen = JSON.stringify(parent);
  const plan = planInstances(parseArgs(['start', '--root', join(scratch, 'p11')]), { realHome: fakeRealHome(), tmp: scratch });
  for (const inst of plan) {
    const env = buildInstanceEnv(inst, parent);
    for (const k of ['WORCA_FLAGS', 'CLAUDE_CONFIG_DIR', 'NODE_TEST_CONTEXT', 'WORCA_TEST_ALLOW_HOME_FALLBACK', ...CLAUDE_AUTH_ENV_KEYS, ...CLAUDE_AUTH_ENV_FLAGS]) {
      assert.ok(!(k in env), `${inst.letter}: ${k} dropped`);
    }
    const s = instanceSettings({ flags: { other: true, rail: !inst.rail } }, inst, {});
    assert.equal(s.flags.rail, inst.rail, `${inst.letter}: rail ${inst.rail}`);
    assert.equal(s.flags.other, true, 'other flags kept');
  }
  assert.deepEqual(plan.map((i) => i.rail), [false, true, false, true]);
  assert.equal(JSON.stringify(parent), frozen, 'the parent env is never mutated');
});

test('PLAN-Gc: mock is on by default, --no-mock turns it off per instance, --mock-env passes only WORCA_MOCK_* keys', () => {
  const realHome = fakeRealHome();
  const plan = planInstances(parseArgs(['start', '--no-mock', 'B,C', '--mock-env', 'WORCA_MOCK_SLOW_MS=300', '--mock-env', 'WORCA_MOCK_FAIL_STEP=build']), { realHome, tmp: scratch });
  const env = Object.fromEntries(plan.map((i) => [i.letter, buildInstanceEnv(i, { WORCA_MOCK: '1', ORCH_MOCK: '1' })]));
  assert.deepEqual(plan.map((i) => i.mock), [true, false, false, true]);
  for (const l of ['A', 'D']) {
    assert.equal(env[l].WORCA_MOCK, '1');
    assert.equal(env[l].WORCA_MOCK_SLOW_MS, '300');
    assert.equal(env[l].WORCA_MOCK_FAIL_STEP, 'build');
  }
  for (const l of ['B', 'C']) {
    assert.ok(!('WORCA_MOCK' in env[l]) && !('ORCH_MOCK' in env[l]), `${l} is not mock`);
    assert.ok(!('WORCA_MOCK_SLOW_MS' in env[l]), `${l} gets no mock knob`);
  }
  assert.throws(() => planInstances(parseArgs(['start', '--mock-env', 'WORCA_FLAGS=rail']), { realHome, tmp: scratch }), (e) => e.code === 'bad-mock-env');
});

test('PLAN-Gc F-X-01: A/B copy a fake real store; the source is byte-identical and its mtimes unchanged; C/D start empty with welcomeSeen, rail and uiLevel', async () => {
  const realHome = fakeRealHome();
  const before = snapshot(join(realHome, '.worca-cc'));
  const root = fresh('copy-root');
  const plan = planInstances(parseArgs(['start', '--root', root]), { realHome, tmp: scratch });
  const by = Object.fromEntries(plan.map((i) => [i.letter, i]));
  const settingsOf = (l) => JSON.parse(readFileSync(join(root, l, '.worca-cc', 'settings.json'), 'utf8'));

  for (const l of ['A', 'B']) {
    const r = await prepareHome(by[l], { realHome });
    assert.ok(['clone', 'copy'].includes(r.copied), r.copied);
    // C1: the copy names its own store, so deleting a copied run on A or B never reaches the owner's real worktree
    const row = branchOf(join(root, l, '.worca-cc'));
    assert.equal(JSON.parse(row.branch).worktreeDir, join(root, l, '.worca-cc', 'runs', 'r1', 'repos', 'x'));
    // C1: a repo path that cannot be copied (missing here) points at HOME/outside/…, which never exists
    assert.equal(row.project_dir, join(root, l, 'outside', 'repos', 'owner'));
    assert.equal(row.n, 7);
    assert.deepEqual(JSON.parse(readFileSync(join(root, l, '.worca-cc', 'runs', 'r1', 'run.json'), 'utf8')), { runRoot: join(root, l, '.worca-cc', 'runs', 'r1'), repo: join(root, l, 'outside', 'repos', 'owner') });
    assert.equal(readFileSync(join(root, l, '.worca-cc', 'store', 'p', 'plan.md'), 'utf8'), '# plan\n');
    const s = settingsOf(l);
    assert.equal(s.theme, 'dark');
    assert.equal(s.uiLevel, 'advanced', 'a copied store keeps its level');
    assert.deepEqual(s.flags, { other: true, rail: l === 'B' });
    assert.deepEqual(s.onboarding, { hidden: true, welcomeSeen: true });
    assert.ok(!existsSync(join(root, l, '.worca-cc', 'settings.json.tmp')));
  }
  // a restart keeps the instance's own state: nothing is copied over it again
  writeFileSync(join(root, 'A', '.worca-cc', 'walk.txt'), 'walk state');
  assert.equal((await prepareHome(by.A, { realHome, uiLevel: 'simple' })).copied, 'kept');
  assert.equal(readFileSync(join(root, 'A', '.worca-cc', 'walk.txt'), 'utf8'), 'walk state');
  assert.equal(settingsOf('A').uiLevel, 'simple');

  for (const l of ['C', 'D']) {
    assert.equal((await prepareHome(by[l], { realHome })).copied, 'empty');
    assert.deepEqual(readdirSync(join(root, l, '.worca-cc')), ['settings.json']);
    assert.deepEqual(settingsOf(l), { flags: { rail: l === 'D' }, onboarding: { welcomeSeen: true }, uiLevel: 'expert' });
  }
  // --welcome leaves the welcome dialog to show
  assert.equal(instanceSettings({}, by.C, { welcome: true }).onboarding.welcomeSeen, false);

  // --fresh re-creates an instance HOME, but never a folder the tool did not make
  const stray = fresh('stray-root');
  mkdirSync(join(stray, 'A', '.worca-cc'), { recursive: true });
  const strayA = planInstances(parseArgs(['start', 'A', '--root', stray]), { realHome, tmp: scratch })[0];
  await assert.rejects(prepareHome(strayA, { realHome, fresh: true }), (e) => e.code === 'not-fresh-safe');
  assert.ok(existsSync(join(stray, 'A', '.worca-cc')));
  writeFileSync(join(root, 'A', 'server.log'), '');
  assert.ok(['clone', 'copy'].includes((await prepareHome(by.A, { realHome, fresh: true })).copied));
  assert.ok(!existsSync(join(root, 'A', '.worca-cc', 'walk.txt')), '--fresh starts over from the store');

  assert.deepEqual(snapshot(join(realHome, '.worca-cc')), before, 'the real store is byte-identical with unchanged mtimes');
  assert.equal(JSON.parse(branchOf(join(realHome, '.worca-cc')).branch).worktreeDir, join(realHome, '.worca-cc', 'runs', 'r1', 'repos', 'x'));

  // a copied DB that cannot be rewritten is removed and the start refused, never left pointing into the real store
  const badReal = fakeRealHome();
  writeFileSync(join(badReal, '.worca-cc', 'worca-cc.db'), 'not a database');
  const badA = planInstances(parseArgs(['start', 'A', '--root', fresh('bad-root')]), { realHome: badReal, tmp: scratch })[0];
  await assert.rejects(prepareHome(badA, { realHome: badReal }), (e) => e.code === 'store-rewrite');
  assert.ok(!existsSync(join(badA.home, '.worca-cc')));
  const noDb = fresh('no-db-home');
  mkdirSync(join(noDb, '.worca-cc'));
  assert.deepEqual(isolateCopy(join(noDb, '.worca-cc'), { home: noDb, realStore: join(badReal, '.worca-cc'), realHome: badReal }), { repos: 0, placeholders: 0 }, 'a store without a DB has nothing to rewrite');
  const noStore = planInstances(parseArgs(['start', 'A', '--root', fresh('nostore')]), { realHome: fresh('empty-real'), tmp: scratch })[0];
  await assert.rejects(prepareHome(noStore, { realHome: fresh('empty-real') }), (e) => e.code === 'no-store');
});

test('PLAN-Gc: start spawns the fixture server, records pid and lstart in the instance HOME, list prints HOME and port; a busy port is refused', { skip: posixOnly, timeout: 60000 }, async (t) => {
  const realHome = fakeRealHome();
  const root = fresh('start-root');
  const port = await freePort();
  const c = io({ realHome, tmp: scratch, serverPath: FIXTURE });
  assert.equal(await main(['start', 'C', '--root', root, '--port', `C=${port}`], c.io), 0, c.err.join('\n'));
  const rec = JSON.parse(readFileSync(join(root, 'C', RECORD_FILE), 'utf8'));
  t.after(() => { try { process.kill(rec.pid, 'SIGKILL'); } catch { /* gone */ } });
  assert.equal(rec.letter, 'C');
  assert.equal(rec.port, port);
  assert.equal(rec.home, join(root, 'C'));
  assert.equal(rec.serverPath, FIXTURE);
  assert.ok(Number.isInteger(rec.pid) && rec.lstart, 'pid and lstart recorded');
  assert.equal(rec.lstart, defaultPs(rec.pid).lstart);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json()).projects.length, 0);
  assert.equal(c.out.join('\n'), `C  http://127.0.0.1:${port}  HOME=${join(root, 'C')}  rail=off  mock=on  store=empty  pid=${rec.pid}`);

  const l = io({ realHome, tmp: scratch });
  assert.equal(await main(['list', '--root', root], l.io), 0);
  assert.equal(l.out.join('\n'), `C  http://127.0.0.1:${port}  HOME=${join(root, 'C')}  rail=off  mock=on  store=empty  pid=${rec.pid}`);
  const listed = listInstances(root);
  assert.equal(listed.length, 1);
  assert.ok(listed[0].alive && listed[0].ours);

  // started again while it runs: refused, not a second server
  const again = io({ realHome, tmp: scratch, serverPath: FIXTURE });
  assert.equal(await main(['start', 'C', '--root', root, '--port', `C=${port}`], again.io), 2);
  assert.match(again.err.join('\n'), /^already-running: /);

  // a port someone else holds
  const busy = net.createServer();
  await new Promise((r) => busy.listen(0, '127.0.0.1', r));
  t.after(() => busy.close());
  const b = io({ realHome, tmp: scratch, serverPath: FIXTURE });
  assert.equal(await main(['start', 'D', '--root', root, '--port', `D=${busy.address().port}`], b.io), 2);
  assert.match(b.err.join('\n'), /^port-in-use: port \d+ is already in use; pick another with --port D=N/);
  assert.ok(!existsSync(join(root, 'D', RECORD_FILE)), 'no record for a refused start');
  await assert.rejects(startInstance({ ...planInstances(parseArgs(['start', 'D', '--root', root]), { realHome, tmp: scratch })[0], port: busy.address().port }, { serverPath: FIXTURE }),
    (e) => e.code === 'port-in-use');
});

const gone = async (pid, needle) => {
  const until = Date.now() + 5000;
  while (defaultPs(pid)?.command.includes(needle) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  return !defaultPs(pid)?.command.includes(needle);
};

test('PLAN-Gc: an old "already in use" line in server.log does not block a start; a refused start leaves no live server', { skip: posixOnly, timeout: 60000 }, async (t) => {
  const realHome = fakeRealHome();
  const root = fresh('log-root');
  const [inst] = planInstances(parseArgs(['start', 'C', '--root', root, '--port', `C=${await freePort()}`]), { realHome, tmp: scratch });
  mkdirSync(inst.home, { recursive: true });
  writeFileSync(join(inst.home, 'server.log'), 'port 4503 is already in use\n');
  const rec = await startInstance(inst, { serverPath: FIXTURE });
  t.after(() => { try { process.kill(rec.pid, 'SIGKILL'); } catch { /* gone */ } });
  assert.equal((await fetch(`http://127.0.0.1:${inst.port}/api/projects`)).ok, true);

  // this start's own "already in use" line refuses it, and the child it spawned is stopped
  const [d] = planInstances(parseArgs(['start', 'D', '--root', root, '--port', `D=${await freePort()}`]), { realHome, tmp: scratch });
  let pid = null;
  const spawnLosing = (cmd, args, o) => {
    const c = spawn(process.execPath, ['-e', 'console.log("port N is already in use"); setInterval(() => {}, 1000)'], o);
    pid = c.pid;
    return c;
  };
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } });
  await assert.rejects(startInstance(d, { serverPath: FIXTURE, spawn: spawnLosing }), (e) => e.code === 'port-in-use');
  assert.ok(await gone(pid, 'setInterval'), 'the refused start\'s server is not left running');
  assert.ok(!existsSync(join(d.home, RECORD_FILE)));

  // a start time that cannot be read: refused and the server stopped, instead of a record that stop could never match
  const [d2] = planInstances(parseArgs(['start', 'D', '--root', fresh('lstart-root'), '--port', `D=${await freePort()}`]), { realHome, tmp: scratch });
  let pid2 = null;
  const spawnSeen = (cmd, args, o) => { const c = spawn(cmd, args, o); pid2 = c.pid; return c; };
  t.after(() => { try { process.kill(pid2, 'SIGKILL'); } catch { /* gone */ } });
  await assert.rejects(startInstance(d2, { serverPath: FIXTURE, spawn: spawnSeen, ps: () => null }), (e) => e.code === 'no-start-time');
  assert.ok(await gone(pid2, FIXTURE));
  assert.ok(!existsSync(join(d2.home, RECORD_FILE)));
});

test('PLAN-Gc: a letter is claimed before its start: a second claim refuses already-running, a dead holder\'s lock refuses stale-lock and is left alone', () => {
  const root = fresh('lock-root');
  const [a] = planInstances(parseArgs(['start', 'A', '--root', root]), { realHome: fakeRealHome(), tmp: scratch });
  const release = claimInstance(a);
  assert.throws(() => claimInstance(a), (e) => e.code === 'already-running');
  release();
  claimInstance(a)();
  assert.ok(!existsSync(join(root, '.A.lock')));
  // M1: no rm-and-retry takeover (two starts could both win it); the person removes the named file
  const lock = join(root, '.A.lock');
  writeFileSync(lock, String(2 ** 22 + 17));   // a pid that no longer runs
  assert.throws(() => claimInstance(a), (e) => e.code === 'stale-lock' && e.message.includes(lock));
  assert.equal(readFileSync(lock, 'utf8'), String(2 ** 22 + 17), 'the stale lock is not touched');
  rmSync(lock);
  claimInstance(a)();
  // m1: an empty lock is a start caught mid-claim, never "stale … pid 0" with advice to delete a live lock
  writeFileSync(lock, '');
  assert.throws(() => claimInstance(a), (e) => e.code === 'already-running' && !/pid 0/.test(e.message));
  assert.equal(readFileSync(lock, 'utf8'), '', 'the lock is not touched');
  rmSync(lock);
  assert.deepEqual(readdirSync(root).filter((f) => f.startsWith('.A.lock')), [], 'no temp lock files are left behind');
});

test('PLAN-Gc M1/m1: six processes claim one letter at once: exactly one wins, every other says already-running, none sees an empty or stale lock', { skip: posixOnly, timeout: 60000 }, async () => {
  const root = fresh('lock-race');
  const [a] = planInstances(parseArgs(['start', 'A', '--root', root]), { realHome: fakeRealHome(), tmp: scratch });
  const tool = new URL('../tools/stillhet-gate-instances.mjs', import.meta.url).href;
  const go = join(root, 'go');
  const code = `import { claimInstance } from ${JSON.stringify(tool)}; import { existsSync } from 'node:fs';
    while (!existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 5));
    try { const release = claimInstance(${JSON.stringify(a)}); console.log('won'); await new Promise((r) => setTimeout(r, 1500)); release(); }
    catch (e) { console.log(e.code + ': ' + e.message); }`;
  const runs = Array.from({ length: 6 }, () => new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(out.trim()));
  }));
  await new Promise((r) => setTimeout(r, 1000));
  writeFileSync(go, '');
  const results = await Promise.all(runs);
  assert.equal(results.filter((r) => r === 'won').length, 1, results.join('\n'));
  for (const r of results.filter((x) => x !== 'won')) assert.match(r, /^already-running: /);
  assert.ok(!existsSync(join(root, '.A.lock')), 'the winner released its lock');
});

test('PLAN-Gc: stop kills its own fixture server and leaves a foreign live process (forged record) running, reported not-ours', { skip: posixOnly, timeout: 60000 }, async (t) => {
  const realHome = fakeRealHome();
  const root = fresh('stop-root');
  const port = await freePort();
  assert.equal(await main(['start', 'D', '--root', root, '--port', `D=${port}`], io({ realHome, tmp: scratch, serverPath: FIXTURE }).io), 0);
  const own = JSON.parse(readFileSync(join(root, 'D', RECORD_FILE), 'utf8'));

  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { try { foreign.kill('SIGKILL'); } catch { /* gone */ } });
  await new Promise((r) => setTimeout(r, 200));
  mkdirSync(join(root, 'B'), { recursive: true });
  // the forged record names the foreign pid with its real lstart, but the command is not our server
  writeFileSync(join(root, 'B', RECORD_FILE), JSON.stringify({ ...own, letter: 'B', home: join(root, 'B'), pid: foreign.pid, lstart: defaultPs(foreign.pid).lstart }));
  // and a stale record whose pid no longer runs
  mkdirSync(join(root, 'C'), { recursive: true });
  writeFileSync(join(root, 'C', RECORD_FILE), JSON.stringify({ ...own, letter: 'C', home: join(root, 'C'), pid: 2 ** 22 + 17 }));

  const kills = [];
  const out = await stopInstances(root, ['A', 'B', 'C', 'D'], { kill: (pid, sig) => { kills.push(pid); process.kill(pid, sig); } });
  assert.deepEqual(out.map((r) => [r.letter, r.result]), [['B', 'not-ours'], ['C', 'not-running'], ['D', 'stopped']]);
  assert.deepEqual([...new Set(kills)], [own.pid], 'only its own pid is signalled');
  const left = defaultPs(own.pid);
  assert.ok(!left || !left.command.includes(FIXTURE), 'its server is gone (at most a zombie of this test process)');
  assert.ok(defaultPs(foreign.pid), 'the foreign process lives on');
  assert.ok(existsSync(join(root, 'B', RECORD_FILE)), 'a not-ours record is kept');
  assert.ok(!existsSync(join(root, 'C', RECORD_FILE)) && !existsSync(join(root, 'D', RECORD_FILE)));

  const c = io({ realHome, tmp: scratch });
  assert.equal(await main(['stop', '--root', root], c.io), 0);
  assert.match(c.out.join('\n'), /^B  pid=\d+  not-ours$/);
});

/** A fake `claude` in its own bin dir: `auth status` answers STATUS (with a decoy secret on stdout and stderr), `-p` answers
 *  PROMPT_EXIT, `auth login` exits 0; every call appends `$HOME|$CLAUDE_CONFIG_DIR|args` to SEEN. */
function fakeClaude({ status, promptExit = 0, promptText = 'ok' }) {
  const dir = fresh('fakebin');
  const seen = join(dir, 'seen.log');
  writeFileSync(join(dir, 'claude'), [
    '#!/bin/sh',
    `echo "$HOME|$CLAUDE_CONFIG_DIR|$*" >> '${seen}'`,
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
    `  echo '${status}'`,
    '  echo \'{"token":"sk-ant-FAKE-SECRET-PLANGC"}\' >&2',
    '  exit 0',
    'fi',
    'if [ "$1" = "auth" ] && [ "$2" = "login" ]; then exit 0; fi',
    `echo '${promptText} sk-ant-FAKE-SECRET-PLANGC'`,
    `exit ${promptExit}`,
  ].join('\n') + '\n');
  chmodSync(join(dir, 'claude'), 0o755);
  return { dir, seen, read: () => readFileSync(seen, 'utf8').trim().split('\n') };
}
const withPath = (dir) => ({ PATH: `${dir}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: '/owner/.claude' });

test('PLAN-Gc: login-status runs the CLI\'s auth status under the instance HOME (fake claude on PATH) and reports signed-in / signed-out', { skip: posixOnly }, async () => {
  const root = fresh('login-root');
  const [inst] = planInstances(parseArgs(['login-status', 'C', '--root', root]), { realHome: fakeRealHome(), tmp: scratch });
  const inBin = fakeClaude({ status: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', configDirectory: join(root, 'C', '.claude'), token: 'sk-ant-FAKE-SECRET-PLANGC' }) });
  assert.deepEqual(await loginStatus(inst, { baseEnv: withPath(inBin.dir) }), { state: 'signed-in', method: 'auth-status', configHome: 'inside' });
  assert.deepEqual(inBin.read(), [`${join(root, 'C')}||auth status --json`], 'run under the instance HOME, the owner\'s CLAUDE_CONFIG_DIR dropped');

  const outBin = fakeClaude({ status: JSON.stringify({ loggedIn: false, configDirectory: '/Users/owner/.claude' }) });
  const out = await loginStatus(inst, { baseEnv: withPath(outBin.dir), platform: 'linux' });
  assert.equal(out.state, 'signed-out');
  assert.equal(out.configHome, 'outside');
  assert.equal(out.reason, loginReason('linux'));

  // auth status unknown → the prompt fallback decides
  const unk = fakeClaude({ status: 'no idea', promptExit: 0 });
  assert.deepEqual(await loginStatus(inst, { baseEnv: withPath(unk.dir) }), { state: 'signed-in', method: 'prompt', configHome: 'unknown' });
  const unkOut = fakeClaude({ status: 'no idea', promptExit: 1, promptText: 'Not logged in · Please run /login' });
  assert.equal((await loginStatus(inst, { baseEnv: withPath(unkOut.dir) })).state, 'signed-out');
  assert.deepEqual(await loginStatus(inst, { baseEnv: { PATH: fresh('nobin') } }), { state: 'unknown', method: 'none', configHome: 'unknown', reason: loginReason(process.platform) });
});

test('PLAN-Gc: the login check never prints or writes the CLI output (decoy secret absent from stdout, stderr, files)', { skip: posixOnly }, async () => {
  const root = fresh('decoy-root');
  const bin = fakeClaude({ status: JSON.stringify({ loggedIn: true, configDirectory: join(root, 'A', '.claude'), token: 'sk-ant-FAKE-SECRET-PLANGC' }) });
  const c = io({ realHome: fakeRealHome(), tmp: scratch, baseEnv: withPath(bin.dir) });
  assert.equal(await main(['login-status', '--root', root], c.io), 0);
  const all = [...c.out, ...c.err].join('\n');
  assert.ok(!all.includes('FAKE-SECRET'), all);
  assert.match(c.out[0], /^A  http:\/\/127\.0\.0\.1:4501  HOME=.*  claude=signed-in \(auth-status\), config inside HOME$/);
  assert.equal(c.out.length, 4);
  const files = existsSync(root) ? Object.keys(snapshot(root)) : [];
  for (const f of files) assert.ok(!readFileSync(join(root, f), 'utf8').includes('FAKE-SECRET'), f);
});

test('PLAN-Gc: login runs the CLI\'s own login under that HOME and, when it does not take on darwin, says why and exits 3', { skip: posixOnly }, async () => {
  const root = fresh('login-cmd-root');
  const bin = fakeClaude({ status: JSON.stringify({ loggedIn: false }) });
  const c = io({ realHome: fakeRealHome(), tmp: scratch, baseEnv: withPath(bin.dir), platform: 'darwin' });
  assert.equal(await main(['login', 'B', '--root', root], c.io), 3);
  assert.deepEqual(bin.read(), [`${join(root, 'B')}||auth login`, `${join(root, 'B')}||auth status --json`]);
  assert.ok(c.err.join('\n').includes(loginReason('darwin')));
  assert.match(loginReason('darwin'), /Keychain/);
  assert.ok(!c.err.join('\n').includes('FAKE-SECRET') && !c.out.join('\n').includes('FAKE-SECRET'));

  const ok = fakeClaude({ status: JSON.stringify({ loggedIn: true, configDirectory: join(root, 'B', '.claude') }) });
  const d = io({ realHome: fakeRealHome(), tmp: scratch, baseEnv: withPath(ok.dir), platform: 'darwin' });
  assert.equal(await main(['login', 'B', '--root', root], d.io), 0);
  const bad = io({ realHome: fakeRealHome(), tmp: scratch });
  assert.equal(await main(['login', '--root', root], bad.io), 2, 'login needs one letter');
});
