// test/design-build-kinds.test.mjs — Design P7 Task 7: a pitch and a video round end to end on the engine and the mock.
// A fresh drive stages the kit for board kinds (L7.12), plan frames carry no `estHeight` on decks and video and a
// `duration` on video only (C-5), and the builder is told its slide or its scene's window.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv } from './helpers/design-fixture.mjs';
import { designWorkDir, distDir, kitDir } from '../src/core/design/paths.mjs';
import { lintDesign } from '../src/core/design/assemble.mjs';
import { stageDesignKit, stageWorcaLook } from '../src/core/design/kit.mjs';
import { addProject, listProjects } from '../src/core/projects.mjs';

useDesignEnv(after);

test('a pitch builds: kit staged, plan frames carry no estHeight, dist on deck-stage', async () => {
  // MOCK_SHELL_SLOTS: a board shell has no slots even then (L7.4), or the lint below reports `shell-slot-kind`.
  const d = newDesign({ kind: 'pitch' }); const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_SHELL_SLOTS' });
  assert.equal((await build.run()).status, 'done');
  assert.ok(existsSync(join(kitDir(d.id), 'deck-stage.js')));
  const plan = framesOf(frames, 'design-plan')[0];
  assert.deepEqual(plan.canvas, { w: 1920, h: 1080 });
  assert.equal('estHeight' in plan.sections[0], false);
  const html = readFileSync(join(distDir(d.id), 'index.html'), 'utf8');
  assert.ok(html.includes('<deck-stage width="1920" height="1080">'));
  // The inlined deck-stage.js names that tag in its JSDoc too: the stage itself wraps the first slide.
  assert.match(html, /<deck-stage width="1920" height="1080">\s*<section data-section="hero" data-label="Hero">/);
  assert.match(calls[0].prompt, /^Kind: pitch$/m);
  assert.doesNotMatch(calls[0].systemPrompt, /hero-copy/);
  assert.match(calls.find((c) => c.systemPrompt.startsWith('MOCK_ROLE: design-builder\n')).systemPrompt, /data-deck-anim/);
  assert.ok(calls.some((c) => c.prompt.split('\n').includes('Slide 2 of 2.')));
  const written = JSON.parse(readFileSync(join(designWorkDir(d.id), 'plan.json'), 'utf8'));
  assert.equal('estHeight' in written.sections[0], false, 'the mock lead writes a deck plan without estHeight');
  assert.equal(lintDesign({ workDir: designWorkDir(d.id), plan: written }).ok, true);
});

test('a video builds: durations reach the frame, the builder is told its window', async () => {
  const d = newDesign({ kind: 'video' }); const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2' });
  assert.equal((await build.run()).status, 'done');
  assert.deepEqual(framesOf(frames, 'design-plan')[0].sections.map((s) => s.duration), [4, 4]);
  assert.ok(calls.some((c) => c.prompt.split('\n').includes('Scene 2 of 2: 4s to 8s of a 8s film.')));
  assert.ok(frames.some((f) => f.type === 'design-delta' && f.part === 'js'));
  assert.ok(readFileSync(join(distDir(d.id), 'index.html'), 'utf8').includes('"embedded":false'));
});

test('web frames gain no duration; a stageKit failure is the round\'s error, not a crash', async () => {
  const w = newDesign({ kind: 'web' }); const a = newBuild(w, { brief: 'MOCK_SECTIONS=1' }); await a.build.run();
  assert.equal('duration' in framesOf(a.frames, 'design-plan')[0].sections[0], false);
  assert.equal(existsSync(kitDir(w.id)), false, 'web keeps P5\'s chat staging alone');
  const f = newDesign({ kind: 'pitch' }); const b = newBuild(f, { brief: '', deps: { stageKit: async () => { throw new Error('disk full'); } } });
  assert.deepEqual(await b.build.run(), { status: 'error', reason: 'engine-error' });
});

// Review M2: a Continue stages the kit too, or a round with no kit fails at its end on every paid Continue.
test('a Continue stages the kit again: a stageKit that threw on run() leaves the round continuable, and it ends done', async () => {
  let fail = true; let staged = 0;
  const stageKit = async (o) => { staged += 1; if (fail) throw new Error('disk full'); return stageDesignKit(o); };
  const d = newDesign({ kind: 'pitch' }); const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2', deps: { stageKit } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'engine-error' });
  assert.deepEqual([calls.length, staged, existsSync(kitDir(d.id))], [0, 1, false], 'no spawn before the kit');
  fail = false;
  assert.deepEqual(await build.continue(), { status: 'done', reason: null });
  assert.equal(staged, 2, 'the Continue staged it');
  assert.ok(existsSync(join(kitDir(d.id), 'deck-stage.js')));
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
});

test('a Continue restages a kit removed after the round paused (a pre-P7 round never had one)', async () => {
  for (const kind of ['pitch', 'video']) {
    const d = newDesign({ kind }); const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=hero' });
    assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' }, kind);
    rmSync(kitDir(d.id), { recursive: true, force: true });
    assert.deepEqual(await build.continue(), { status: 'done', reason: null }, kind);
    assert.ok(existsSync(join(kitDir(d.id), 'CONTRACT.md')), kind);
  }
});

test('a change round on a video keeps durations and adds one', async () => {
  const d = newDesign({ kind: 'video' }); await newBuild(d, { brief: 'MOCK_SECTIONS=2' }).build.run();
  const { build, frames, calls } = newBuild(d, { kind: 'change', instruction: 'MOCK_ROUND_ADD=extra:hero', needsLead: true, sections: [] });
  assert.equal((await build.run()).status, 'done');
  const last = framesOf(frames, 'design-plan').at(-1);
  assert.deepEqual(last.sections.map((s) => [s.id, s.duration]), [['hero', 4], ['extra', 4], ['features', 4]]);
  // The touched scene's builder is told its window in the applied plan; the add's builder its own.
  const touched = calls.find((c) => /^Change: /.test(c.prompt)).prompt.split('\n');
  assert.ok(touched.includes('Scene 1 of 3: 0s to 4s of a 12s film.') && touched.includes('S.dur is 4.'));
  assert.ok(calls.some((c) => c.prompt.split('\n').includes('Scene 2 of 3: 4s to 8s of a 12s film.')));
});

/** A recorded stageLook around the real one, so a call stages the real fonts. */
function recordedLook() {
  const calls = [];
  return { calls, stageLook: async (o) => { calls.push(o.workDir); return stageWorcaLook(o); } };
}
const worcaDir = (d) => join(designWorkDir(d.id), 'assets', 'worca');

test('(a) a document builds: kit staged on the drive, worca\'s look staged after the plan and before dist, the TOC in dist', async () => {
  const look = recordedLook();
  const d = newDesign({ kind: 'document' }); const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2', deps: { stageLook: look.stageLook } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.ok(existsSync(join(kitDir(d.id), 'CONTRACT.md')), 'a direct build stages the document kit');
  assert.ok(existsSync(join(kitDir(d.id), 'worca-look', 'tokens.css')));
  assert.equal(look.calls.length, 2, 'once after the plan, once before dist');
  assert.ok(existsSync(join(worcaDir(d), 'poppins-latin-400-normal.woff2')));
  const plan = framesOf(frames, 'design-plan')[0];
  assert.deepEqual(plan.canvas, { w: 794 });
  assert.deepEqual(plan.sections.map((s) => s.estHeight), [600, 600]);
  const html = readFileSync(join(distDir(d.id), 'index.html'), 'utf8');
  assert.ok(html.includes('data-worca-toc') && html.includes('@page{size:A4'));
  assert.ok(existsSync(join(distDir(d.id), 'assets', 'worca', 'poppins-latin-400-normal.woff2')));
  assert.match(calls[0].prompt, /^Kind: document$/m);
  assert.ok(calls.some((c) => c.prompt.split('\n').includes('Part 2 of 2.') && c.prompt.split('\n').includes('Printed page: A4.')));
});

test('(b) MOCK_BAD_BRAND: one fix resume that names brand.md, then done', async () => {
  const d = newDesign({ kind: 'document' }); const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_BAD_BRAND' });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const fix = calls[1].prompt.split('\n');
  assert.equal(fix[0], 'plan.json or brand.md is not valid:');
  assert.match(fix.at(-1), /Edit the `Look source:` line of brand\.md/);
});

test('(c) MOCK_BAD_BRAND_ALWAYS: plan-invalid naming Look source, and no builder ever starts', async () => {
  const look = recordedLook();
  const d = newDesign({ kind: 'document' }); const { build, calls, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_BAD_BRAND_ALWAYS', deps: { stageLook: look.stageLook } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.systemPrompt.startsWith('MOCK_ROLE: design-lead\n')), 'no builder');
  assert.match(framesOf(frames, 'design-agent').at(-1).error, /^plan\.json is not valid: .*Look source/);
  assert.deepEqual([look.calls.length, existsSync(worcaDir(d))], [0, false]);
  assert.equal(framesOf(frames, 'design-plan').length, 0, 'the plan was never taken');
});

test('(d) MOCK_LOOK=brief: worca\'s fonts are never staged', async () => {
  const look = recordedLook();
  const d = newDesign({ kind: 'document' }); const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_LOOK=brief', deps: { stageLook: look.stageLook } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual([look.calls.length, existsSync(worcaDir(d))], [0, false]);
});

test('(e) MOCK_LOOK=project with no project: plan-invalid with the project error', async () => {
  const d = newDesign({ kind: 'document' }); const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_LOOK=project' });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.ok(framesOf(frames, 'design-agent').at(-1).error.includes('brand.md: Look source is project, but your task has no Project line'));
});

test('(f) a web design never reads brand.md for the gate', async () => {
  const look = recordedLook();
  const d = newDesign({ kind: 'web' }); const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { stageLook: look.stageLook } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(existsSync(join(designWorkDir(d.id), 'brand.md')), false, 'the mock web lead writes no brand.md');
  assert.equal(look.calls.length, 0);
});

test('(g) a stageLook that throws is the round\'s engine-error, not a crash', async () => {
  const d = newDesign({ kind: 'document' });
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { stageLook: async () => { throw new Error('disk full'); } } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'engine-error' });
});

test('(h) a change round that switches the look to worca stages the fonts once the round applies', async () => {
  const d = newDesign({ kind: 'document' });
  await newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_LOOK=brief' }).build.run();
  assert.equal(existsSync(worcaDir(d)), false);
  // Which stage each call came in: the lead's change stage (no builder row yet), or the finish (the builders done).
  const order = [];
  let built = 0;
  const stageLook = async (o) => { order.push(built ? 'finish' : 'change'); return stageWorcaLook(o); };
  const { build, frames } = newBuild(d, { kind: 'change', instruction: 'MOCK_LOOK=worca', needsLead: true, sections: [], deps: { stageLook } });
  build.on('frame', (f) => { if (f.type === 'design-agent' && f.role === 'builder' && f.status === 'done') built += 1; });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(order, ['change', 'finish'], 'after the round applies, and again before dist');
  const applied = framesOf(frames, 'design-plan').at(-1);
  assert.ok(applied, 'the round applied');
  assert.ok(existsSync(join(worcaDir(d), 'poppins-latin-400-normal.woff2')));
  assert.match(readFileSync(join(designWorkDir(d.id), 'brand.md'), 'utf8'), /^Look source: worca — mock/);
});

test('(i) MOCK_BAD_PLAN with MOCK_BAD_BRAND: the one fix prompt lists both, and the round ends done', async () => {
  const d = newDesign({ kind: 'document' }); const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_BAD_PLAN MOCK_BAD_BRAND' });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const fix = calls[1].prompt;
  assert.match(fix, /^- the plan needs at least one section$/m);
  assert.match(fix, /^- brand\.md has no "Look source:" line/m);
});

// Review M1: the fonts are staged once the lead row is `done`, so a staging throw after the round applied leaves a
// Continue that builds the round's sections rather than re-running the applied round.
test('a change round whose stageLook throws once: the Continue builds the added section and ends done', async () => {
  const d = newDesign({ kind: 'document' });
  await newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_LOOK=brief' }).build.run();
  let fail = true;
  const stageLook = async (o) => { if (fail) { fail = false; throw new Error('disk full'); } return stageWorcaLook(o); };
  const { build } = newBuild(d, { kind: 'change', instruction: 'MOCK_LOOK=worca MOCK_ROUND_ADD=extra:hero', needsLead: true, sections: [], deps: { stageLook } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'engine-error' });
  assert.deepEqual(await build.continue(), { status: 'done', reason: null });
  assert.ok(existsSync(join(worcaDir(d), 'poppins-latin-400-normal.woff2')));
  assert.ok(readFileSync(join(distDir(d.id), 'index.html'), 'utf8').includes('data-section="extra"'));
});

// Review M2: `_finish`'s restage is best-effort; a throw there still assembles dist from the fonts staged after the plan.
test('a stageLook that throws only before dist: the round still ends done with its dist', async () => {
  let n = 0;
  const stageLook = async (o) => { n += 1; if (n === 2) throw new Error('disk full'); return stageWorcaLook(o); };
  const d = newDesign({ kind: 'document' }); const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { stageLook } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(n, 2);
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
  assert.ok(existsSync(join(distDir(d.id), 'assets', 'worca', 'poppins-latin-400-normal.woff2')));
});

/** A registered project folder, removed after the file. */
async function aProject(name) {
  const dir = mkdtempSync(join(tmpdir(), 'worca-design-doc-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  await addProject({ name, path: dir });
  return (await listProjects()).find((x) => x.name === name);
}

// Review M3: the gate's `project` rule on both sides, and no staging on a refused gate (invariant 2).
test('MOCK_LOOK=project with a project picked: done on an engine that reads it, plan-invalid on one that cannot', async () => {
  const p = await aProject('docsite');
  const ok = newBuild(newDesign({ kind: 'document', projectKey: p.key }), { brief: 'MOCK_SECTIONS=1 MOCK_LOOK=project' });
  assert.deepEqual(await ok.build.run(), { status: 'done', reason: null });
  const d = newDesign({ kind: 'document', projectKey: p.key });
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_LOOK=project' });
  build._engineRow = { ...build._engineRow, readsOutsideCwd: false };
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.ok(framesOf(frames, 'design-agent').at(-1).error.includes('brand.md: Look source is project, but your task has no Project line'));
});

test('MOCK_BAD_PLAN_ALWAYS with worca\'s look: plan-invalid, and the fonts are never staged', async () => {
  const look = recordedLook();
  const d = newDesign({ kind: 'document' }); const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_BAD_PLAN_ALWAYS', deps: { stageLook: look.stageLook } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.match(readFileSync(join(designWorkDir(d.id), 'brand.md'), 'utf8'), /^Look source: worca/);
  assert.deepEqual([look.calls.length, existsSync(worcaDir(d))], [0, false]);
});
