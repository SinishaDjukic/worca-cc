// test/workspace-map-eval-cli.test.mjs
// tools/workspace-map-eval.mjs: --map as a file, a run folder or a Workspace scan run id,
// --labels, --overrides <workspaceId>, --init (never overwrites), --json, usage errors (exit 2),
// the script entry point (also through a symlinked path), BOM-prefixed files, --init write
// errors, and a mistyped --map path or a non-id --overrides that never opens the database.
// WORCA_HOME is a temp dir (run ids and overrides are read from the DB).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { sampleMap } from './helpers/wsmap-stored.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createWorkspace, saveWorkspaceScanResult, setWorkspaceEdgeState, addWorkspaceManualEdge } from '../src/core/workspaces.mjs';
import { main } from '../tools/workspace-map-eval.mjs';

const home = useTempHome(after);
const created = [];
after(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true, maxRetries: 3 }))));
const TOOL = fileURLToPath(new URL('../tools/workspace-map-eval.mjs', import.meta.url));

async function tmp(prefix = 'worca-cc-wsmap-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}
async function freshRepo() {
  const dir = await tmp();
  const g = (a) => spawnSync('git', a, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  await writeFile(join(dir, 'README.md'), '# hi\n');
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}
/** Run main() in-process, capturing both streams. */
async function run(...argv) {
  let out = '';
  let err = '';
  const code = await main(argv, { out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}
async function mapFile(map) {
  const file = join(await tmp(), 'workspace-map.json');
  await writeFile(file, JSON.stringify(map));
  return file;
}
const KEYS = ['aaa-00000001', 'bbb-00000002'];

test('--init writes an undecided template and never overwrites an existing file', async () => {
  const { map } = sampleMap({ keys: KEYS, name: 'Init' });
  const out = join(await tmp(), 'labels.json');
  const r = await run('--map', await mapFile(map), '--init', out);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /wrote 3 labels to /);
  const t = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(t.workspace, 'Init');
  assert.ok(t.edges.every((e) => e.truth === null && typeof e.key === 'string'));
  const again = await run('--map', await mapFile(map), '--init', out);
  assert.equal(again.code, 2);
  assert.match(again.err, /exists/);
});

test('--labels prints the table; --json prints evaluate()\'s result; a stored { map, synthesis } doc is accepted', async () => {
  const { map, synthesis } = sampleMap({ keys: KEYS, name: 'Labelled' });
  const labels = { version: 1, workspace: 'Labelled', edges: [
    { from: KEYS[0], to: KEYS[1], kind: 'http', key: 'GET /zz-invoices/:id', truth: true },
    { from: KEYS[0], to: KEYS[1], kind: 'topic', key: 'topic:zz.orders.created', truth: false },
    { from: KEYS[1], to: KEYS[0], kind: 'db', truth: true },
  ] };
  const lf = join(await tmp(), 'labels.json');
  await writeFile(lf, JSON.stringify(labels));
  const table = await run('--map', await mapFile(map), '--labels', lf);
  assert.equal(table.code, 0, table.err);
  assert.match(table.out, /^worca workspace map eval — Labelled: 3 edges, 3 pairs, 3 labels$/m);
  assert.match(table.out, /^missed \(1\)$/m);
  const json = await run('--map', await mapFile({ map, synthesis }), '--labels', lf, '--json');
  const r = JSON.parse(json.out);
  assert.deepEqual({ tp: r.keys.tp, fp: r.keys.fp, fn: r.keys.fn }, { tp: 1, fp: 1, fn: 0 });
  assert.deepEqual({ tp: r.pairs.tp, fp: r.pairs.fp, fn: r.pairs.fn, unlabelled: r.pairs.unlabelled }, { tp: 1, fp: 1, fn: 1, unlabelled: 1 });
});

test('--map <runId> reads workspace-map.json from that run\'s folder', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const wsKey = 'wks-evalrun-0000abcd';
  const projects = [a, b].map((p) => ({ projectKey: projectKey(p), projectDir: p, projectName: basename(p) }));
  const { id, dir } = await seedWorkspacePipeline(a, wsKey, { title: 'Workspace scan: Eval' }, projects);
  const { map } = sampleMap({ keys: projects.map((p) => p.projectKey), name: 'From Run' });
  await writeFile(join(dir, 'workspace-map.json'), JSON.stringify(map));
  const out = join(await tmp(), 'labels.json');
  const r = await run('--map', id, '--init', out);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).workspace, 'From Run');
  const missing = await run('--map', 'deadbeef', '--init', join(await tmp(), 'x.json'));
  assert.equal(missing.code, 2);
  assert.match(missing.err, /no such file or run: deadbeef/);
});

test('--overrides <workspaceId> scores the map against the workspace\'s review', async () => {
  const a = await freshRepo();
  const b = await freshRepo();
  const ws = await createWorkspace({ name: 'Reviewed', projectPaths: [a, b] });
  const { map, synthesis, ids } = sampleMap({ keys: ws.projectKeys, name: ws.name });
  await saveWorkspaceScanResult(ws.id, { map, synthesis });
  await setWorkspaceEdgeState(ws.id, ids.http, 'confirmed');
  await setWorkspaceEdgeState(ws.id, ids.topic, 'rejected');
  await addWorkspaceManualEdge(ws.id, { from: ws.projectKeys[1], to: ws.projectKeys[0], kind: 'db', display: 'table zz_audit' });
  const r = await run('--map', await mapFile(map), '--overrides', ws.id, '--json');
  assert.equal(r.code, 0, r.err);
  const res = JSON.parse(r.out);
  assert.deepEqual({ tp: res.pairs.tp, fp: res.pairs.fp, fn: res.pairs.fn, unlabelled: res.pairs.unlabelled }, { tp: 1, fp: 1, fn: 1, unlabelled: 1 });
  assert.deepEqual(res.missed, [{ level: 'pair', from: ws.projectKeys[1], to: ws.projectKeys[0], kind: 'db' }]);
  const unknown = await run('--map', await mapFile(map), '--overrides', 'wks-nope-00000000');
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /no such workspace/);
});

test('usage errors exit 2: no --map, no mode, two modes, an unknown flag, a non-map file', async () => {
  const { map } = sampleMap({ keys: KEYS });
  const f = await mapFile(map);
  for (const argv of [[], ['--map', f], ['--map', f, '--labels', 'x', '--init', 'y'], ['--map', f, '--init', 'y', '--bogus']]) {
    const r = await run(...argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.err, /usage: node tools\/workspace-map-eval\.mjs/);
  }
  const notMap = join(await tmp(), 'x.json');
  await writeFile(notMap, '{"hello": 1}');
  const r = await run('--map', notMap, '--init', join(await tmp(), 'y.json'));
  assert.equal(r.code, 2);
  assert.match(r.err, /not a workspace map/);
});

test('the script entry point runs main() and sets the exit code', async () => {
  const { map } = sampleMap({ keys: KEYS, name: 'Spawned' });
  const out = join(await tmp(), 'labels.json');
  const ok = spawnSync(process.execPath, [TOOL, '--map', await mapFile(map), '--init', out], {
    env: { ...process.env, WORCA_HOME: home }, encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /wrote 3 labels/);
  const bad = spawnSync(process.execPath, [TOOL], { env: { ...process.env, WORCA_HOME: home }, encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

test('a BOM-prefixed map and labels file are read; --init into a missing folder or onto a folder exits 2', async () => {
  const { map } = sampleMap({ keys: KEYS, name: 'Bom' });
  const d = await tmp();
  const BOM = String.fromCharCode(0xfeff);
  await writeFile(join(d, 'map.json'), `${BOM}${JSON.stringify(map)}`);
  await writeFile(join(d, 'labels.json'), `${BOM}${JSON.stringify({ version: 1, edges: [] })}`);
  assert.equal((await run('--map', join(d, 'map.json'), '--labels', join(d, 'labels.json'))).code, 0);
  const missing = await run('--map', join(d, 'map.json'), '--init', join(d, 'no', 'such', 'labels.json'));
  assert.equal(missing.code, 2);
  assert.match(missing.err, /--init: cannot write/);
  await mkdir(join(d, 'adir'));
  const onDir = await run('--map', join(d, 'map.json'), '--init', join(d, 'adir'));
  assert.equal(onDir.code, 2);
  assert.match(onDir.err, /exists/);
});

test('a mistyped --map path is not looked up as a run: no database is opened', async () => {
  const d = await tmp();
  const fresh = join(d, 'home');
  const r = spawnSync(process.execPath, [TOOL, '--map', join(d, 'typo.json'), '--init', join(d, 'l.json')], {
    env: { ...process.env, WORCA_HOME: fresh }, encoding: 'utf8',
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no such file or run/);
  assert.equal(existsSync(join(fresh, '.worca-cc')), false, 'no worca home was created');
});

test('--map <run folder> reads its workspace-map.json; a folder without one exits 2', async () => {
  const { map } = sampleMap({ keys: KEYS, name: 'Folder' });
  const folder = await tmp();
  await writeFile(join(folder, 'workspace-map.json'), JSON.stringify(map));
  const out = join(await tmp(), 'labels.json');
  const r = await run('--map', folder, '--init', out);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).workspace, 'Folder');
  const none = await run('--map', await tmp(), '--init', join(await tmp(), 'x.json'));
  assert.equal(none.code, 2);
  assert.match(none.err, /has no workspace-map\.json/);
});

test('--overrides with something that is not a workspace id exits 2 before any database is opened', async () => {
  const { map } = sampleMap({ keys: KEYS });
  const d = await tmp();
  const f = join(d, 'map.json');
  await writeFile(f, JSON.stringify(map));
  const fresh = join(d, 'home');
  const r = spawnSync(process.execPath, [TOOL, '--map', f, '--overrides', 'typo'], {
    env: { ...process.env, WORCA_HOME: fresh }, encoding: 'utf8',
  });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /not a workspace id/);
  assert.equal(existsSync(join(fresh, '.worca-cc')), false, 'no worca home was created');
});

test('the entry guard compares real paths: a symlinked checkout path still runs main()', async (t) => {
  const d = await tmp();
  const link = join(d, 'tools-link');
  try { await symlink(dirname(TOOL), link, 'junction'); } catch (e) { t.skip(`cannot create a symlink here: ${e.code}`); return; }
  const r = spawnSync(process.execPath, [join(link, 'workspace-map-eval.mjs')], { env: { ...process.env, WORCA_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /usage: node tools\/workspace-map-eval\.mjs/);
});
