// test/workspace-map-scripts.test.mjs
// The four built-in workspace-map cards (wsmap P2): their sidecars exactly as the index pins them;
// a REAL chain over two git repos with an npm dependency (extract -> catalog -> join -> render with no
// agent output on disk — the degraded path every real run can fall back to); the robustness contract
// (garbage or missing input still writes a valid output and the card exits 0); the hard line
// budget by member count; the extract card's deadline; a member key that is no safe file name; and
// the cards' own sources against the v1 tripwire. The cards run through the real runtime
// (process.execPath + script-child), each with the test's signal, so a hung card is killed at the
// test timeout instead of outliving it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withDeadline } from '../scripts/workspace-map-io.mjs';
import { EXTRACT_DEADLINE_MS, extractWithin } from '../scripts/workspace-map-extract.mjs';
import { loadScriptRegistry, DEFAULT_SCRIPTS_DIR } from '../src/core/script-registry.mjs';
import { runScriptExecution } from '../src/core/graph/script-runner.mjs';
import { effectiveScriptParams } from '../src/shared/graph/script-meta.mjs';
import { countLines } from '../src/shared/workspace-map/render.mjs';
import { edgeId } from '../src/shared/workspace-map/ids.mjs';
import { scanDescriptionBudget } from '../src/shared/workspace-size.mjs';
import { realAgentMetas } from './helpers/graph-ports.mjs';

// A card runs for real whatever the mock flag says (none declares a mock); keep the envelope honest.
delete process.env.WORCA_MOCK;
delete process.env.ORCH_MOCK;

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

const REG = loadScriptRegistry({ scriptsDir: DEFAULT_SCRIPTS_DIR, userScriptsDir: null, includePlugins: false, agentKeys: realAgentMetas().map((m) => m.key) });
const KEYS = ['workspaceMapExtract', 'workspaceMapCatalog', 'workspaceMapJoin', 'workspaceMapRender'];
const LIB_PKG = `${JSON.stringify({ name: '@wsmap/lib', version: '1.0.0' }, null, 2)}\n`;
const APP_PKG = `${JSON.stringify({ name: '@wsmap/app', version: '1.0.0', dependencies: { '@wsmap/lib': '^1.0.0' } }, null, 2)}\n`;
const tok = (type, path) => ({ seq: 1, type, path });
const lines = (path) => readFileSync(path, 'utf8').split(/\r?\n/);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** A committed git repo holding `files` (top-level names only). */
function gitRepo(label, files) {
  const dir = tmp(`worca-cc-wsmap-${label}-`);
  for (const [rel, text] of Object.entries(files)) writeFileSync(join(dir, rel), text);
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  g(['add', '-A']); g(['commit', '-qm', 'init']);
  return dir;
}

/** The run harness's workspace channel (run-harness.mjs _workspaceChannel) for `members` [{key, name, dir}]. */
function channel(name, members) {
  return {
    kind: 'metadata', workspaceDescription: '', workspaceId: 'wks-test-00000000', workspaceName: name,
    projects: members.map((m) => ({ projectKey: m.key, projectName: m.name, projectDir: m.dir, worktreeDir: m.dir, checkpointRef: null, graphInstruction: '' })),
  };
}

/** A runner ctx the way _execCtx builds one: sidecar ports, outputs allocated in ONE pipeline dir
 *  (the chain reads its neighbours' files there), the given bindings and workspace channel.
 *  `signal` is the test's `t.signal`: node:test aborts it at the test timeout, and the runner then
 *  kills the card's child (a card's own timeout is 30 minutes). */
function ctxFor(key, { pipelineDir, bindings = {}, workspace = null, signal }) {
  const meta = REG[key];
  const ports = { inputs: meta.inputs, outputs: meta.outputs };
  const outputs = {};
  for (const p of ports.outputs) outputs[p.id] = { path: join(pipelineDir, p.filename), store: 'run' };
  return {
    node: { id: `n_${key}`, kind: 'script', key }, executionId: `x:n_${key}:1`, ordinal: 1, pipelineDir, pipelineId: 'run-1',
    projectDir: pipelineDir, runCtx: { pipelineDir, projectDir: pipelineDir, baseName: 'scan' }, runRoot: null, repos: [], checkpointRef: null,
    workspace, ports, outputs, verdict: null, bindings, trigger: { wireIds: [], freshPorts: Object.keys(bindings) },
    script: { meta, runtime: meta.runtime, file: meta.scriptPath, command: null, params: effectiveScriptParams(meta, {}), timeoutMs: meta.timeoutMs, mock: null },
    claudeOpts: {}, signal, onEvent: () => {},
  };
}

/** Resolves 'hung' after `ms` without keeping the process alive — the bound of a race that must not
 *  wait for a deadline that never fires. */
const hung = (ms) => new Promise((res) => setTimeout(() => res('hung'), ms).unref());

test('the four cards: node runtime, placeable:false, a 30-minute timeout, no mock, ports exactly as the index pins', () => {
  const ports = (m) => ({ in: m.inputs.map((p) => `${p.id}:${p.type}`), out: m.outputs.map((p) => `${p.id}:${p.type}:${p.filename}`) });
  assert.deepEqual(ports(REG.workspaceMapExtract), { in: ['task:md'], out: ['extract:json:extract.json', 'brief:md:survey-brief.md'] });
  assert.deepEqual(ports(REG.workspaceMapCatalog), { in: ['extract:json', 'survey:json'], out: ['catalog:json:catalog.json', 'brief:md:usage-brief.md'] });
  assert.deepEqual(ports(REG.workspaceMapJoin), { in: ['catalog:json', 'usage:json'], out: ['map:json:workspace-map.json', 'brief:md:synth-brief.md'] });
  assert.deepEqual(ports(REG.workspaceMapRender), { in: ['map:json', 'synthesis:json'], out: ['workspace:md:workspace-scan.md'] });
  for (const key of KEYS) {
    const m = REG[key];
    assert.equal(m.metaVersion, 2, key);
    assert.equal(m.runtime, 'node', key);
    assert.equal(m.placeable, false, `${key}: never on a canvas`);
    assert.equal(m.timeoutMs, 1800000, key);
    assert.equal(m.domain, 'shared', key);
    assert.match(m.description, /worca/, key);
    assert.equal(m.mock, undefined, `${key}: no mock — the card runs for real on a mock run`);
    assert.ok(m.inputs.every((p) => p.required !== false), `${key}: every input is wired in the scan graph`);
    assert.ok(existsSync(m.scriptPath), `${key}: the program exists`);
  }
});

test('a real chain over two repos: the npm dependency becomes an edge and a description line; every brief keeps its first-lines contract', async (t) => {
  const lib = gitRepo('lib', { 'package.json': LIB_PKG, 'README.md': '# lib\n\nShared helpers for the app.\n' });
  const app = gitRepo('app', { 'package.json': APP_PKG, 'README.md': '# app\n\nThe web app.\n' });
  const workspace = channel('Shop', [{ key: 'app', name: 'App', dir: app }, { key: 'lib', name: 'Lib', dir: lib }]);
  const pipelineDir = tmp('worca-cc-wsmap-pipe-');
  const task = join(pipelineDir, 'task.md');
  writeFileSync(task, 'Scan the interconnections of the workspace "Shop".\n');

  const ex = ctxFor('workspaceMapExtract', { pipelineDir, workspace, bindings: { task: tok('md', task) }, signal: t.signal });
  const r1 = await runScriptExecution(ex);
  assert.match(r1.summary, /^extract: 2 members/);
  const extractPath = ex.outputs.extract.path;
  const extract = json(extractPath);
  assert.deepEqual(Object.keys(extract.members).sort(), ['app', 'lib']);
  // (this channel's checkout IS the live dir; the checkout-vs-live split is pinned by the Task 6 detached test)
  assert.equal(extract.members.app.dir, app, 'extract.json records the member dir it scanned');
  const sb = lines(ex.outputs.brief.path);
  assert.equal(sb[0], '# Workspace survey brief');
  assert.equal(sb[1], `<!-- worca:extract=${extractPath} -->`);
  assert.match(sb[2], /^<!-- worca:check=.*check-cli\.mjs.* survey "<OUT>" --extract .*-->$/);

  // survey.json was never written (a survey agent that failed): tolerated.
  const cat = ctxFor('workspaceMapCatalog', { pipelineDir, workspace, bindings: { extract: tok('json', extractPath), survey: tok('json', join(pipelineDir, 'survey.json')) }, signal: t.signal });
  const r2 = await runScriptExecution(cat);
  assert.match(r2.summary, /2 usage briefs/);
  const catalogPath = cat.outputs.catalog.path;
  assert.ok(json(catalogPath).entries.some((e) => e.member === 'lib' && e.kind === 'pkg'), 'lib provides its package');
  assert.deepEqual(json(catalogPath).briefs, { app: 'usage-briefs/app.md', lib: 'usage-briefs/lib.md' }, 'catalog.briefs names every per-member brief (spec §5.5)');
  const ub = lines(cat.outputs.brief.path);
  assert.equal(ub[0], '# Workspace usage brief');
  assert.equal(ub[1], `<!-- worca:catalog=${catalogPath} -->`);
  assert.match(ub[2], /^<!-- worca:check=.* usage "<OUT>" --catalog .*-->$/);
  for (const [key, name] of [['app', 'App'], ['lib', 'Lib']]) {
    assert.ok(ub.includes(`- ${key} (${name}): usage-briefs/${key}.md`), `index line for ${key}`);
    assert.ok(existsSync(join(pipelineDir, 'usage-briefs', `${key}.md`)), `usage-briefs/${key}.md written next to the index`);
  }

  // usage.json was never written: static and candidate edges only.
  const jn = ctxFor('workspaceMapJoin', { pipelineDir, workspace, bindings: { catalog: tok('json', catalogPath), usage: tok('json', join(pipelineDir, 'usage.json')) }, signal: t.signal });
  await runScriptExecution(jn);
  const mapPath = jn.outputs.map.path;
  const map = json(mapPath);
  assert.equal(map.runId, 'run-1', 'ctx.runId reaches the map');
  const edge = map.edges.find((e) => e.from === 'app' && e.to === 'lib' && e.kind === 'pkg');
  assert.ok(edge, `app -> lib pkg edge: ${JSON.stringify(map.edges)}`);
  assert.equal(edge.confidence, 'exact');
  const yb = lines(jn.outputs.brief.path);
  assert.equal(yb[0], '# Workspace synthesis brief');
  assert.equal(yb[1], `<!-- worca:map=${mapPath} -->`);
  assert.match(yb[2], /^<!-- worca:check=.* synthesis "<OUT>" --map .*-->$/);

  // synthesis.json was never written: fallback overview and roles.
  const rd = ctxFor('workspaceMapRender', { pipelineDir, workspace, bindings: { map: tok('json', mapPath), synthesis: tok('json', join(pipelineDir, 'synthesis.json')) }, signal: t.signal });
  const r4 = await runScriptExecution(rd);
  assert.match(r4.summary, /\(budget 300, 2 members\)$/);
  const md = readFileSync(rd.outputs.workspace.path, 'utf8');
  assert.ok(md.startsWith('# Workspace: Shop\n'), md);
  const inter = md.split('\n## Interconnections\n')[1]?.split('\n## ')[0] ?? '';
  assert.match(inter, /^- .*(App|app).* -> .*(Lib|lib)/m, md);
});

test('garbage or missing input: every card still writes a valid output and exits 0 — bad data never pauses the run', async (t) => {
  const pipelineDir = tmp('worca-cc-wsmap-bad-');
  const workspace = channel('Bad', [{ key: 'a', name: 'A', dir: pipelineDir }, { key: 'b', name: 'B', dir: pipelineDir }]);
  const garbage = join(pipelineDir, 'garbage.json');
  writeFileSync(garbage, '{ not json');
  const missing = join(pipelineDir, 'missing.json');

  // catalog: garbage extract.json (rebuilt from ctx.workspace as "every member none") + no survey.json
  const cat = ctxFor('workspaceMapCatalog', { pipelineDir, workspace, bindings: { extract: tok('json', garbage), survey: tok('json', missing) }, signal: t.signal });
  assert.match((await runScriptExecution(cat)).summary, /extract\.json is missing or unreadable/);
  const catalog = json(cat.outputs.catalog.path);
  assert.equal(catalog.version, 1);
  assert.ok(Array.isArray(catalog.entries));
  assert.equal(lines(cat.outputs.brief.path)[0], '# Workspace usage brief');

  // join: garbage catalog.json + garbage usage.json
  const jn = ctxFor('workspaceMapJoin', { pipelineDir, workspace, bindings: { catalog: tok('json', garbage), usage: tok('json', garbage) }, signal: t.signal });
  assert.match((await runScriptExecution(jn)).summary, /catalog\.json is missing or unreadable/);
  const map = json(jn.outputs.map.path);
  assert.equal(map.version, 1);
  assert.deepEqual(map.edges, []);
  assert.equal(map.workspace.name, 'Bad', 'the empty catalog carries the workspace name into the map');
  assert.equal(lines(jn.outputs.brief.path)[0], '# Workspace synthesis brief');

  // render: garbage map + garbage synthesis
  const rd = ctxFor('workspaceMapRender', { pipelineDir, workspace, bindings: { map: tok('json', garbage), synthesis: tok('json', garbage) }, signal: t.signal });
  assert.match((await runScriptExecution(rd)).summary, /\(budget 300, 2 members\)$/);
  const md = readFileSync(rd.outputs.workspace.path, 'utf8');
  assert.ok(md.startsWith('# Workspace: Bad\n'), md);
  assert.ok(countLines(md) <= scanDescriptionBudget(2), `${countLines(md)} lines`);
});

test('a run that spans no workspace (ctx.workspace null): every card writes its empty document, says why, exits 0', async (t) => {
  const pipelineDir = tmp('worca-cc-wsmap-nows-');
  const garbage = join(pipelineDir, 'garbage.json');
  writeFileSync(garbage, '{ not json');
  const run = async (key, bindings) => {
    const ctx = ctxFor(key, { pipelineDir, workspace: null, bindings, signal: t.signal });
    const res = await runScriptExecution(ctx);
    assert.match(res.summary, /no workspace/, `${key}: ${res.summary}`);
    return ctx;
  };
  const ex = await run('workspaceMapExtract', { task: tok('md', garbage) });
  assert.deepEqual(json(ex.outputs.extract.path).members, {});
  assert.equal(lines(ex.outputs.brief.path)[0], '# Workspace survey brief');
  const cat = await run('workspaceMapCatalog', { extract: tok('json', ex.outputs.extract.path), survey: tok('json', garbage) });
  assert.deepEqual(json(cat.outputs.catalog.path).entries, []);
  assert.deepEqual(json(cat.outputs.catalog.path).workspace, { name: 'Workspace' }, 'the shape P1 builds');
  assert.deepEqual(lines(cat.outputs.brief.path).slice(0, 2), ['# Workspace usage brief', `<!-- worca:catalog=${cat.outputs.catalog.path} -->`]);
  const jn = await run('workspaceMapJoin', { catalog: tok('json', cat.outputs.catalog.path), usage: tok('json', garbage) });
  assert.deepEqual(json(jn.outputs.map.path).edges, []);
  assert.equal(json(jn.outputs.map.path).stats.testFacts, 0, 'the stats shape P1 builds');
  assert.deepEqual(lines(jn.outputs.brief.path).slice(0, 2), ['# Workspace synthesis brief', `<!-- worca:map=${jn.outputs.map.path} -->`]);
  const rd = await run('workspaceMapRender', { map: tok('json', jn.outputs.map.path), synthesis: tok('json', garbage) });
  assert.match(readFileSync(rd.outputs.workspace.path, 'utf8'), /^# Workspace: Workspace\n[\s\S]*## Interconnections\n/);
});

test('render holds the description to scanDescriptionBudget(member count): 40 members, 3120 relations, at most 800 lines', async (t) => {
  const keys = Array.from({ length: 40 }, (_, i) => `m${String(i).padStart(2, '0')}`);
  const members = keys.map((key) => ({ key, name: key, role: `Service ${key}`, roleSource: 'static', aliases: [], stack: ['node'],
    coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, factsStatic: 3, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null } }));
  const edges = [];
  for (const from of keys) {
    for (const to of keys) {
      if (from === to) continue;
      for (const [kind, norm, display] of [['http', `http:GET /${to}/items`, `GET /${to}/items`], ['topic', `topic:${to}.events`, `${to}.events`]]) {
        edges.push({ id: edgeId(from, to, kind, norm), from, to, kind, norm, display, label: null, detail: '', confidence: 'exact', sources: ['static'],
          evidence: { from: [{ file: 'src/client.js', line: 1, match: display }], to: [{ file: 'src/server.js', line: 1, match: display }] } });
      }
    }
  }
  assert.equal(edges.length, 3120);
  const pipelineDir = tmp('worca-cc-wsmap-big-');
  const mapPath = join(pipelineDir, 'workspace-map.json');
  // BOM-prefixed on purpose: readJsonInput tolerates an editor's leading byte-order mark (the m00 line below proves the map was read).
  writeFileSync(mapPath, String.fromCharCode(0xFEFF) + JSON.stringify({ version: 1, workspace: { name: 'Big' }, scannedAt: '2026-09-25T00:00:00.000Z', runId: 'r', members, edges,
    order: [keys], cycles: [keys], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 },
    stats: { edges: edges.length, byKind: { http: 1560, topic: 1560 }, byConfidence: { exact: 3120 }, candidates: 0, candidatesConfirmed: 0, factsRejected: 0, testFacts: 0 }, errors: [] }));
  const workspace = channel('Big', keys.map((key) => ({ key, name: key, dir: join(pipelineDir, key) })));
  const rd = ctxFor('workspaceMapRender', { pipelineDir, workspace, bindings: { map: tok('json', mapPath), synthesis: tok('json', join(pipelineDir, 'none.json')) }, signal: t.signal });
  const res = await runScriptExecution(rd);
  assert.match(res.summary, /\(budget 800, 40 members\)$/);
  const md = readFileSync(rd.outputs.workspace.path, 'utf8');
  assert.ok(countLines(md) <= 800, `${countLines(md)} lines — over the 40-member budget`);
  assert.match(md, /\n## Interconnections\n/);
  assert.match(md, /^- m00 \(`m00`\): repo: "Service m00"$/m, 'the BOM-prefixed map was read, not rendered as missing');
});

// The extract card races extractWorkspace against this helper (extractWithin, EXTRACT_DEADLINE_MS):
// a slow extraction degrades to the "every member none" document instead of pausing the run (spec §7).
test('withDeadline: the value in time, the fallback after the deadline, a rejection passes through', async () => {
  assert.deepEqual(await withDeadline(Promise.resolve({ ok: 1 }), 1000, null), { ok: 1 });
  // Bounded: a deadline that never fires fails here in 2 s instead of hanging to the runner's timeout.
  assert.equal(await Promise.race([withDeadline(new Promise(() => {}), 10, 'late'), hung(2000)]), 'late');
  await assert.rejects(withDeadline(Promise.reject(new Error('boom')), 1000), /boom/);
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
  const before = timers();
  await withDeadline(Promise.resolve(1), 60000);
  assert.equal(timers(), before, 'the deadline timer is cleared once the promise settles');
});

test('the extract card degrades a slow extraction before its own 30-minute timeout (spec §7)', async () => {
  assert.ok(EXTRACT_DEADLINE_MS < REG.workspaceMapExtract.timeoutMs, 'the deadline fires before the card times out');
  const slow = await Promise.race([extractWithin({ name: 'W', members: [], extract: () => new Promise(() => {}), deadlineMs: 20 }), hung(2000)]);
  assert.notEqual(slow, 'hung', 'extractWithin waited past its deadline');
  assert.equal(slow.doc, null);
  assert.match(slow.why, /^extraction did not finish within/);
  assert.deepEqual(await extractWithin({ name: 'W', members: [], extract: async () => { throw new Error('boom'); } }), { doc: null, why: 'extraction crashed: boom' });
  assert.deepEqual(await extractWithin({ name: 'W', members: [], extract: async () => ({ version: 1 }) }), { doc: { version: 1 }, why: '' });
});

test('a member key that is not a safe file name: the brief file, its index line and catalog.briefs agree (usageBriefPath)', async (t) => {
  const pipelineDir = tmp('worca-cc-wsmap-key-');
  const workspace = channel('Keys', [{ key: 'my app', name: 'My App', dir: pipelineDir }, { key: 'lib', name: 'Lib', dir: pipelineDir }]);
  const garbage = join(pipelineDir, 'garbage.json');
  writeFileSync(garbage, '{ not json');
  const cat = ctxFor('workspaceMapCatalog', { pipelineDir, workspace, bindings: { extract: tok('json', garbage), survey: tok('json', garbage) }, signal: t.signal });
  await runScriptExecution(cat);
  assert.equal(json(cat.outputs.catalog.path).briefs['my app'], 'usage-briefs/my_app.md');
  assert.ok(lines(cat.outputs.brief.path).includes('- my app (My App): usage-briefs/my_app.md'), lines(cat.outputs.brief.path).join('\n'));
  assert.ok(existsSync(join(pipelineDir, 'usage-briefs', 'my_app.md')), 'the file the index line names exists');
});

test('the cards never carry a bare v1 sidecar token (the v1 tripwire sweeps src/ and ui/ only)', () => {
  for (const file of [...KEYS.map((key) => REG[key].scriptPath), join(DEFAULT_SCRIPTS_DIR, 'workspace-map-io.mjs')]) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\b(consumes|optionalConsumes|produces|connectsTo|loopSource)\s*:/, file);
  }
});
