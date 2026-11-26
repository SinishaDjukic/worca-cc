// test/shape-prototype-design.test.mjs — Shaper small runs C1 (src/core/shape/prototype-design.mjs): the Prototype
// step's bridge to Design on a real registry with the mock engine: the design and its maker, a round's end, the frozen
// confirmed copy and a run's own copy of it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, symlinkSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useDesignEnv } from './helpers/design-fixture.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { getDesign } from '../src/core/design/store.mjs';
import { snapshotVersion } from '../src/core/design/versions.mjs';
import { screensOfPlan } from '../src/shared/shape/prototype.mjs';
import {
  createPrototypeDesign, startPrototypeBuild, awaitBuild, freezePrototype, stagePrototypeForRun, prototypeDesignTitle, PrototypeError,
} from '../src/core/shape/prototype-design.mjs';

useDesignEnv(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-proto-design-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
// The server passes snapshotVersion (ui/server.mjs), so a done build bumps the design's version.
const reg = () => createDesignBuilds({ broadcast: () => {}, deps: { staggerMs: 0, retryDelayMs: 0, snapshotVersion } });

const sha = (dir) => {
  const h = createHash('sha256');
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else h.update(n).update(readFileSync(p)); } };
  walk(dir);
  return h.digest('hex');
};

test('createPrototypeDesign: a web design titled "Prototype · " plus the feature, made by the requester, on the run\'s model', () => {
  const id = createPrototypeDesign({ title: 'Email templates', by: 'ann', models: { model: 'claude-opus-5-5', effort: 'medium' } });
  const d = getDesign(id);
  assert.equal(d.title, 'Prototype · Email templates');
  assert.equal(d.kind, 'web');
  assert.equal(d.createdBy, 'ann');
  assert.equal(getDesign(createPrototypeDesign({ title: 'x', by: 'bob' })).createdBy, 'bob', 'the resumed run\'s requester');
  assert.ok(prototypeDesignTitle('y'.repeat(300)).length <= 120);
});

test('a first round builds one section per screen, freezes, and a later change round leaves the frozen copy equal', async () => {
  const designBuilds = reg();
  const designId = createPrototypeDesign({ title: 'Email templates', by: 'local' });
  const started = await startPrototypeBuild({ designId, brief: 'MOCK_SECTIONS=2 Build the screens', by: 'local', deps: { designBuilds } });
  assert.ok(started.buildId);
  const end = await awaitBuild(started.buildId, { designBuilds });
  assert.equal(end.status, 'done');
  assert.equal(end.reason, null);
  assert.equal(end.sections.length, 2);
  assert.equal(screensOfPlan(end.sections).length, 2, 'one screen per section');
  assert.ok(end.version >= 1);
  const pipelineDir = join(scratch, 'plan-run-0badc0de');
  assert.deepEqual(freezePrototype({ designId, shownVersion: end.version + 1, screens: [], pipelineDir }), { stale: end.version });
  assert.equal(existsSync(join(pipelineDir, 'prototype-confirmed')), false, 'a stale confirm writes nothing');
  const screens = screensOfPlan(end.sections);
  const ref = freezePrototype({ designId, shownVersion: end.version, screens, pipelineDir });
  assert.equal(ref.dir, join(pipelineDir, 'prototype-confirmed'));
  assert.ok(existsSync(join(ref.dir, 'index.html')));
  const manifest = JSON.parse(readFileSync(join(ref.dir, 'prototype.json'), 'utf8'));
  assert.equal(manifest.version, end.version);
  assert.equal(manifest.designId, designId);
  assert.deepEqual(manifest.screens, screens);
  const before = sha(ref.dir);
  // R-arch-10: a later Design round on the same design leaves the frozen files equal.
  const change = await startPrototypeBuild({ designId, instruction: 'Warmer colours', by: 'local', deps: { designBuilds } });
  const end2 = await awaitBuild(change.buildId, { designBuilds });
  assert.equal(end2.status, 'done');
  assert.ok(end2.version > end.version);
  assert.equal(sha(ref.dir), before);
  // A run's own copy.
  const runDir = join(scratch, 'run-2');
  const staged = stagePrototypeForRun({ ref: { ...ref, designId }, pipelineDir: runDir });
  assert.equal(staged, join(runDir, 'prototype'));
  assert.equal(JSON.parse(readFileSync(join(staged, 'prototype.json'), 'utf8')).version, end.version);
  assert.equal(stagePrototypeForRun({ ref: { dir: join(scratch, 'gone'), version: 1, designId }, pipelineDir: join(scratch, 'run-3') }), null);
  assert.equal(existsSync(join(scratch, 'run-3', 'prototype')), false);
  // security-1-1: the origin run's folder is checked, and the frozen copy is closed to Worca.
  assert.match(ref.digest, /^[0-9a-f]{64}$/);
  assert.equal(statSync(ref.dir).mode & 0o777, 0o700);
  assert.ok(stagePrototypeForRun({ ref, pipelineDir: join(scratch, 'run-4'), originPipelineId: '0badc0de' }));
  assert.equal(stagePrototypeForRun({ ref, pipelineDir: join(scratch, 'run-5'), originPipelineId: '12345678' }), null, 'another run\'s folder');
  assert.equal(stagePrototypeForRun({ ref: { dir: ref.dir, version: ref.version, designId }, pipelineDir: join(scratch, 'run-6') }), null, 'no recorded digest');
});

test('security: a frozen folder changed, linked or swapped after the confirm is never staged', async () => {
  const designBuilds = reg();
  const designId = createPrototypeDesign({ title: 'Tamper', by: 'local' });
  const s = await startPrototypeBuild({ designId, brief: 'MOCK_SECTIONS=1 Build', by: 'local', deps: { designBuilds } });
  const end = await awaitBuild(s.buildId, { designBuilds });
  const fresh = (name) => freezePrototype({ designId, shownVersion: end.version, screens: [], pipelineDir: join(scratch, name) });
  // A changed file.
  const a = fresh('tamper-a');
  writeFileSync(join(a.dir, 'index.html'), '<p>agent wrote this</p>');
  assert.equal(stagePrototypeForRun({ ref: a, pipelineDir: join(scratch, 'out-a') }), null);
  assert.equal(existsSync(join(scratch, 'out-a', 'prototype')), false);
  // A link added inside the folder.
  const b = fresh('tamper-b');
  symlinkSync('/etc/hosts', join(b.dir, 'hosts.html'));
  assert.equal(stagePrototypeForRun({ ref: b, pipelineDir: join(scratch, 'out-b') }), null);
  // The folder itself swapped for a link to an identical copy elsewhere.
  const c = fresh('tamper-c');
  const elsewhere = join(scratch, 'elsewhere');
  mkdirSync(elsewhere, { recursive: true });
  renameSync(c.dir, join(elsewhere, 'prototype-confirmed'));
  symlinkSync(join(elsewhere, 'prototype-confirmed'), c.dir);
  assert.equal(stagePrototypeForRun({ ref: c, pipelineDir: join(scratch, 'out-c') }), null);
  // An untouched one stages, and its copy matches.
  const d = fresh('tamper-d');
  const staged = stagePrototypeForRun({ ref: d, pipelineDir: join(scratch, 'out-d') });
  assert.equal(sha(staged), sha(d.dir));
  // A repeat stage replaces the run's copy whole.
  writeFileSync(join(staged, 'extra.txt'), 'x');
  stagePrototypeForRun({ ref: d, pipelineDir: join(scratch, 'out-d') });
  assert.equal(existsSync(join(staged, 'extra.txt')), false);
});

test('a failed lead ends the build in error; a second start while one is open is refused with refusalNotice\'s words; no dist cannot freeze', async () => {
  const designBuilds = reg();
  const designId = createPrototypeDesign({ title: 'Failing', by: 'local' });
  const s = await startPrototypeBuild({ designId, brief: 'MOCK_FAIL_LEAD MOCK_SECTIONS=1', by: 'local', deps: { designBuilds } });
  const end = await awaitBuild(s.buildId, { designBuilds });
  assert.notEqual(end.status, 'done');
  assert.throws(() => freezePrototype({ designId, shownVersion: getDesign(designId).version, pipelineDir: join(scratch, 'x') }),
    (e) => e instanceof PrototypeError && e.code === 'no-dist');
  const other = createPrototypeDesign({ title: 'Busy', by: 'local' });
  const first = await startPrototypeBuild({ designId: other, brief: 'MOCK_SECTIONS=1', by: 'local', deps: { designBuilds } });
  const second = await startPrototypeBuild({ designId: other, brief: 'MOCK_SECTIONS=1', by: 'local', deps: { designBuilds } });
  assert.deepEqual(second, { refused: 'A build is already open: wait for it, or press Resume or Stop.', status: 409 });
  await awaitBuild(first.buildId, { designBuilds });
  const capped = createDesignBuilds({ broadcast: () => {}, deps: { staggerMs: 0, retryDelayMs: 0, budgetStatus: () => ({ blocked: true }) } });
  assert.deepEqual(await startPrototypeBuild({ designId: other, brief: 'x', by: 'local', deps: { designBuilds: capped } }),
    { refused: 'Total cost limit reached: no build started.', status: 403 });
});
