import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadMap, featureForRoute } from '../tools/split-by-feature/plan.mjs';
import { planSplit, main, nextCaps, SPIKE_GATE } from '../tools/split-by-feature.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const map = (features, docless = {}) => JSON.stringify({ version: 1, docless, features });
const F = (name, routes = [], css = [], doc = null) => ({ name, doc, routes, css, html: [] });
const MINI = map([F('shell', [], ['.*']), F('runs', ['/api/runs'])], { runs: 'test' });

test('longest prefix wins and a sibling prefix does not match', () => {
  const m = loadMap(ROOT, map([F('runs', ['/api/runs']), F('groups', ['/api/runs/groups'])], { runs: 't', groups: 't' }));
  assert.equal(featureForRoute(m, '/api/runs/groups/x'), 'groups');
  assert.equal(featureForRoute(m, '/api/runs/:id'), 'runs');
  assert.equal(featureForRoute(m, '/api/runsx'), null);
});

test('a catch-all prefix is refused', () => {
  assert.throws(() => loadMap(ROOT, map([F('x', ['/api/'])], { x: 't' })), /too broad/);
});

test('feature names: docs basename, ui/public folder, shell or docless — nothing else', () => {
  loadMap(ROOT, map([F('statistics', [], [], 'docs/statistics.md'), F('chat', [], [], 'docs/chat-home.md'), F('shell')]));
  assert.throws(() => loadMap(ROOT, map([F('labs')])), /bad feature name: labs .*feature-map\.json:\d+/);
  assert.throws(() => loadMap(ROOT, map([F('statistics')])), /doc must be docs\/statistics\.md/);
  assert.throws(() => loadMap(ROOT, map([F('runs')], { runs: '' })), /needs a reason/);
});

test('--root: the map is read from that root, not from the tool\'s own copy', () => {
  const d = mkdtempSync(join(tmpdir(), 'sbf-root-'));
  for (const p of ['docs', 'ui/public', 'tools/split-by-feature']) mkdirSync(join(d, p), { recursive: true });
  writeFileSync(join(d, 'tools/split-by-feature/feature-map.json'), map([F('shell'), F('labs-x')]));
  assert.throws(() => loadMap(d), /bad feature name: labs-x .*feature-map\.json:\d+/);
  assert.match(planSplit({ root: d, serverSrc: '', css: '', html: '' }).problems.join('\n'), /bad feature name: labs-x/);
});

test('an unmapped route fails the coverage check, with its file:line', () => {
  const server = "import express from 'express';\nconst app = express();\napp.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));\n"
    + "app.get('/api/runs', (q, s) => s.json([]));\napp.get('/api/x', (q, s) => s.json({}));\n// SPA fallback: x\napp.use((q, s, n) => n());\n";
  const r = planSplit({ root: ROOT, serverSrc: server, css: '', html: '', mapText: MINI });
  assert.deepEqual(r.problems.filter((p) => p.startsWith('unmapped route')), ['unmapped route: GET /api/x (ui/server.mjs:5)']);
  for (const p of r.problems) assert.match(p, /\((?:ui|tools)\/[^\s:]+:\d+\)$/, p);
});

test('every mode refuses Express 5 and names the version', async () => {
  const stub = mkdtempSync(join(tmpdir(), 'sbf-x5-'));
  mkdirSync(join(stub, 'node_modules/express'), { recursive: true });
  writeFileSync(join(stub, 'package.json'), '{"name":"stub"}');
  writeFileSync(join(stub, 'node_modules/express/package.json'), '{"name":"express","version":"5.3.0"}');
  for (const mode of ['--check', '--apply', '--dry-run', '--write-caps']) {
    const errs = []; const code = await main([mode, '--root', stub], { err: (m) => errs.push(m), out: () => {} });
    assert.equal(code, 1, mode); assert.match(errs.join('\n'), /found express 5\.3\.0/, mode);
  }
  for (const mode of ['--check', '--apply', '--dry-run', '--write-caps']) {           // and as a real process
    assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'tools/split-by-feature.mjs'), mode, '--root', stub], { stdio: 'pipe' }),
      (e) => e.status === 1 && /found express 5\.3\.0/.test(String(e.stderr)), mode);
  }
});

test('--apply refuses on the real tree and writes nothing, until the gate and the equivalence check exist', async () => {
  const before = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
  const errs = []; const outs = [];
  const code = await main(['--apply', '--root', ROOT], { err: (m) => errs.push(m), out: (m) => outs.push(m) });
  assert.equal(code, 1);
  assert.match(errs.join('\n'), /--apply is not built yet/);
  assert.deepEqual(outs, []);
  assert.equal(execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }), before);
});

test('--write-caps only lowers, drops or adds; it never raises', () => {
  const caps = { 'ui/public/app.js': 41380, 'src/a.mjs': 1500, 'src/b.mjs': 1200 };
  const counts = { 'ui/public/app.js': 41400, 'src/a.mjs': 1400, 'src/b.mjs': 900, 'src/c.mjs': 1100, 'src/d.mjs': 10 };
  assert.deepEqual(nextCaps(caps, counts), { 'src/a.mjs': 1400, 'src/c.mjs': 1100, 'ui/public/app.js': 41380 });
});

test('the real tree is fully covered, the pins match the baseline and the spike gate passes', () => {
  const r = planSplit({ root: ROOT });
  assert.deepEqual(r.problems, []);
  assert.ok(r.stats.movedShare >= SPIKE_GATE.movedShare, JSON.stringify(r.stats));
  assert.ok(r.stats.serverLinesAfter <= SPIKE_GATE.serverLinesAfter, JSON.stringify(r.stats));
});
