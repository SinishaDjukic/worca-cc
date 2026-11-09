// test/design-build-kinds.test.mjs — Design P7 Task 7: a pitch and a video round end to end on the engine and the mock.
// A fresh drive stages the kit for board kinds (L7.12), plan frames carry no `estHeight` on decks and video and a
// `duration` on video only (C-5), and the builder is told its slide or its scene's window.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv } from './helpers/design-fixture.mjs';
import { designWorkDir, distDir, kitDir } from '../src/core/design/paths.mjs';
import { lintDesign } from '../src/core/design/assemble.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';

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
