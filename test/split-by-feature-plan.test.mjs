import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadMap, featureForRoute } from '../tools/split-by-feature/plan.mjs';
import { planSplit, main, nextCaps, spikeGate, serverCeiling, writeFiles, codeLineCounts, SPIKE_GATE } from '../tools/split-by-feature.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
// After the freeze-day migration this checkout is itself split: the tests that split the real tree then check the
// post-split invariants instead (nothing left to move, --apply changes 0 files), so the migrated suite stays green.
const SPLIT = planSplit({ root: ROOT }).alreadySplit === true;
const UNSPLIT_ONLY = SPLIT && 'this checkout is already split (ui/public/parts.json): there is no unsplit tree to refuse';
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

function plannerCopy(t) {
  const d = mkdtempSync(join(tmpdir(), 'sbf-apply-')); t.after(() => rmSync(d, { recursive: true, force: true }));
  // docs/ whole: loadMap checks every feature name against a docs/*.md basename (plan.mjs, slice 1 D1)
  for (const p of ['ui/server.mjs', 'ui/public', 'tools/split-by-feature', 'package.json', 'docs'])
    cpSync(join(ROOT, p), join(d, p), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(d, 'node_modules'), 'dir');
  return d;
}

test('--apply writes the split; a second --apply changes 0 files; a fresh plan of the original changes nothing', async (t) => {
  const d = plannerCopy(t);
  const outs = []; const errs = [];
  if (SPLIT) {                                                                    // the migrated tree: a no-op
    assert.equal(await main(['--apply', '--root', d], { out: (m) => outs.push(m), err: (m) => errs.push(m) }), 0, errs.join('\n'));
    assert.deepEqual(outs, ['already split (parts manifest v1 present): 0 files changed']);
    assert.deepEqual(writeFiles(d, planSplit({ root: d }).files), []);
    return;
  }
  const pristine = plannerCopy(t);
  assert.equal(await main(['--apply', '--root', d], { out: (m) => outs.push(m), err: (m) => errs.push(m) }), 0, errs.join('\n'));
  assert.match(outs[0], /^applied split-by-feature v1 on no-git: \d+ files changed$/);
  assert.ok(existsSync(join(d, 'ui/public/parts.json')) && existsSync(join(d, 'ui/routes/index.mjs')));
  assert.equal(existsSync(join(d, 'ui/public/style.css')), false);
  const server = readFileSync(join(d, 'ui/server.mjs'), 'utf8');
  assert.ok(server.includes('res.send(Buffer.from(entry.text))'), 'serveStyleCss must send a Buffer: res.send(string) lower-cases charset=UTF-8');
  assert.equal(await main(['--apply', '--root', d], { out: (m) => outs.push(m), err: (m) => errs.push(m) }), 0);
  assert.equal(outs[1], 'already split (parts manifest v1 present): 0 files changed');
  assert.deepEqual(writeFiles(d, planSplit({ root: pristine }).files), []);      // idempotent without the shortcut too
  assert.equal(JSON.parse(readFileSync(join(d, 'tools/split-by-feature/size-caps.json'), 'utf8'))['ui/server.mjs'], 10085);
});

test('--apply refuses a git checkout with uncommitted changes and writes nothing', { skip: UNSPLIT_ONLY }, async (t) => {
  const d = plannerCopy(t);
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: d });
  const errs = [];
  assert.equal(await main(['--apply', '--root', d], { out: () => {}, err: (m) => errs.push(m) }), 1);   // staged, uncommitted
  assert.match(errs.join('\n'), /refusing --apply: .* uncommitted changes/);
  assert.equal(existsSync(join(d, 'ui/public/parts.json')), false);
});

test('--dry-run outside a git checkout says why and exits 1', async (t) => {
  const d = plannerCopy(t); const errs = [];
  assert.equal(await main(['--dry-run', '--root', d], { out: () => {}, err: (m) => errs.push(m) }), 1);
  assert.match(errs.join('\n'), /--dry-run needs a git checkout/);
});

test('--write-caps only lowers, drops or adds; it never raises', () => {
  const caps = { 'ui/public/app.js': 41380, 'src/a.mjs': 1500, 'src/b.mjs': 1200 };
  const counts = { 'ui/public/app.js': 41400, 'src/a.mjs': 1400, 'src/b.mjs': 900, 'src/c.mjs': 1100, 'src/d.mjs': 10 };
  assert.deepEqual(nextCaps(caps, counts), { 'src/a.mjs': 1400, 'src/c.mjs': 1100, 'ui/public/app.js': 41380 });
});

test('the real tree is fully covered, the pins match the baseline and the spike gate passes', () => {
  const r = planSplit({ root: ROOT });
  assert.deepEqual(r.problems, []);
  if (SPLIT) {                                         // nothing left to move; the residual server holds its ceiling
    assert.ok(codeLineCounts(ROOT)['ui/server.mjs'] <= serverCeiling(ROOT), `ui/server.mjs over its ceiling ${serverCeiling(ROOT)}`);
    return;
  }
  assert.deepEqual(spikeGate(r.stats, serverCeiling(ROOT)), { pass: true, reasons: [], ceiling: 10085 });
});

test('spike gate: >= 95% of route statements moved and ui/server.mjs within its size-cap ceiling', () => {
  assert.equal(SPIKE_GATE.movedShare, 0.95);
  const ok = { movedShare: 430 / 441, serverLinesAfter: 9972 };
  assert.equal(spikeGate(ok, 9972).pass, true);
  assert.deepEqual(spikeGate({ ...ok, movedShare: 0.94 }, 9972).reasons, ['moved 94% < 95%']);
  assert.deepEqual(spikeGate({ ...ok, serverLinesAfter: 9973 }, 9972).reasons, ['ui/server.mjs 9973 lines > ceiling 9972']);
  assert.deepEqual(spikeGate(ok, undefined).reasons, ['no size-cap ceiling for ui/server.mjs in tools/split-by-feature/size-caps.json']);
});

test('--check --stats prints the gate result with its reason, and exits 1 when it fails', async () => {
  const outs = [];
  assert.equal(await main(['--check', '--stats', '--root', ROOT], { out: (m) => outs.push(m), err: () => {} }), 0);
  if (SPLIT) return assert.deepEqual(outs, ['already split (parts manifest v1 present): nothing left to move']);
  assert.match(outs.at(-1), /^moved \d+\/\d+ route statements \(\d+%\), ui\/server\.mjs after the split: \d+ lines — spike gate passed \(>= 95% moved, ceiling 10085 lines\)$/);
});

test('docs/split-by-feature.md holds the tooling rollback (plain and two-part) next to procedures A and B', () => {
  const doc = readFileSync(join(ROOT, 'docs/split-by-feature.md'), 'utf8');
  assert.match(doc, /^## Rollback$/m);
  const tooling = doc.slice(doc.indexOf('\n## Rollback\n'), doc.indexOf('\n## Rollback A'));   // the needles must sit in the new section
  assert.ok(tooling.length > 0 && doc.indexOf('\n## Rollback\n') < doc.indexOf('\n## Rollback A'));
  assert.match(tooling, /git revert -m 1/);        // also in the M paragraph, so search the section only
  assert.match(tooling, /two-part revert/);
  assert.match(tooling, /git diff origin\/dev/);
  assert.match(tooling, /fail 0/);
});

test('--apply writes ui/public/parts.json last, so an interrupted apply is never "already split"', async (t) => {
  if (SPLIT) return t.skip(UNSPLIT_ONLY);
  const d = plannerCopy(t);
  const plan = planSplit({ root: d });
  const order = []; writeFiles(d, plan.files, { onWrite: (rel) => order.push(rel) });
  assert.equal(order.at(-1), 'ui/public/parts.json');
});

test('an apply cut off before parts.json: --apply and --check exit 1 naming the interrupted apply', async (t) => {
  if (SPLIT) return t.skip(UNSPLIT_ONLY);
  const d = plannerCopy(t);
  const plan = planSplit({ root: d });
  // killed right after the last file before the manifest: ui/server.mjs sorts last once parts.json is moved to the end.
  // (A write count is not deterministic: unchanged files are skipped and do not call onWrite.)
  assert.throws(() => writeFiles(d, plan.files, { onWrite: (rel) => { if (rel === 'ui/server.mjs') throw new Error('killed'); } }), /killed/);
  assert.ok(existsSync(join(d, 'ui/routes/index.mjs')));
  assert.ok(!existsSync(join(d, 'ui/public/parts.json')));
  for (const mode of ['--apply', '--check']) {
    const errs = [];
    assert.equal(await main([mode, '--root', d], { out: () => {}, err: (m) => errs.push(m) }), 1, mode);
    assert.match(errs.join('\n'), /interrupted --apply: ui\/public\/parts\.json is missing/, mode);
  }
});

test('the full split with only parts.json removed is reported as interrupted, not as unsplit', async (t) => {
  if (SPLIT) return t.skip(UNSPLIT_ONLY);
  const d = plannerCopy(t);
  writeFiles(d, planSplit({ root: d }).files);
  rmSync(join(d, 'ui/public/parts.json'));
  const p = planSplit({ root: d });
  assert.equal(p.interrupted, true); assert.match(p.problems[0], /interrupted --apply/);
});

const lowCeiling = (d) => writeFileSync(join(d, 'tools/split-by-feature/size-caps.json'),
  JSON.stringify({ ...JSON.parse(readFileSync(join(d, 'tools/split-by-feature/size-caps.json'), 'utf8')), 'ui/server.mjs': 1 }, null, 2) + '\n');

test('--check --stats exits 1 when the spike gate fails, and says why', async (t) => {
  if (SPLIT) return t.skip(UNSPLIT_ONLY);
  const d = plannerCopy(t); lowCeiling(d);
  const outs = [];
  assert.equal(await main(['--check', '--stats', '--root', d], { out: (m) => outs.push(m), err: () => {} }), 1);
  assert.match(outs.at(-1), /spike gate FAILED \(ui\/server\.mjs \d+ lines > ceiling 1\)$/);
});

test('--apply refuses a failed spike gate and writes nothing', async (t) => {
  if (SPLIT) return t.skip(UNSPLIT_ONLY);
  const d = plannerCopy(t); lowCeiling(d);
  const errs = [];
  assert.equal(await main(['--apply', '--root', d], { out: () => {}, err: (m) => errs.push(m) }), 1);
  assert.match(errs.join('\n'), /spike gate FAILED \(.*ceiling 1\): nothing written/);
  assert.ok(!existsSync(join(d, 'ui/public/parts.json'))); assert.ok(existsSync(join(d, 'ui/public/style.css')));
});
