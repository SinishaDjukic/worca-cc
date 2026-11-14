// test/design-build-watch.test.mjs
// Design P8 Task 4: on an engine without token streaming (`live: 'watch'`) the disk is the only source of
// `design-file` frames (L8.5, L8.23): the agent stream lands nothing, the build re-reads at every tool result and
// agent exit, lands only the current plan's sections (L8.24), and closes the watcher before dist and before the row
// leaves an open status. Claude opens none (L8.6). The mock ignores the engine, so a codex design still sends
// Claude-shaped events: "no design-delta" holds only because the watch row drops them.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { countLayers } from '../src/core/design/draft.mjs';
import { designWorkDir, distDir, sectionDir } from '../src/core/design/paths.mjs';
import { getBuild, getDesign } from '../src/core/design/store.mjs';
import { createWorkWatcher } from '../src/core/design/watch.mjs';
import { framesOf, newBuild, newDesign, useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';

useDesignEnv(after);

const mockRun = (o) => runClaude({ ...o, mock: true });
const isBuilder = (o, id) => o.cwd.endsWith(`${sep}sections${sep}${id}`);
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** `deps.createWorkWatcher` around the real one, counting opened, closed and the build's rescans. */
function countingWatcher() {
  const n = { opened: 0, closed: 0, rescans: 0 };
  const make = (opts) => {
    const w = createWorkWatcher(opts);
    n.opened += 1;
    let closed = false;
    return {
      start: () => w.start(),
      rescan: () => { n.rescans += 1; return w.rescan(); },
      close: () => { if (!closed) { closed = true; n.closed += 1; } w.close(); },
      drop: (id) => w.drop(id),
      get degraded() { return w.degraded; },
    };
  };
  return { n, make };
}

/** Waits on `gate`, rejecting AbortError once `signal` aborts; a ref'd 10 s bound (a fake settling only on abort
 *  cancels the rest of the file on Node 22). */
function hold(signal, gate) {
  return new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('hung')), 10_000);
    const onAbort = () => { clearTimeout(bound); reject(abortError()); };
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    gate.then(() => { clearTimeout(bound); signal.removeEventListener('abort', onAbort); resolve(); });
  });
}

/** The landing checks every watch-row build passes. */
function assertWatchFrames(frames) {
  const files = framesOf(frames, 'design-file');
  assert.ok(files.some((f) => f.path === 'sections/hero/index.html' && f.text.includes('data-section="hero"')), 'hero lands from the disk');
  assert.equal(framesOf(frames, 'design-delta').length, 0, 'no design-delta on a watch row');
  const pairs = files.map((f) => `${f.path}\n${f.text}`);
  assert.equal(new Set(pairs).size, pairs.length, 'no (path, text) pair lands twice');
  const end = frames.findLastIndex((f) => f.type === 'design-build' && f.status === 'done');
  assert.ok(end >= 0);
  assert.equal(frames.slice(end + 1).some((f) => f.type === 'design-file'), false, 'nothing lands after the terminal frame');
}

test('a watch engine: frames from the disk, no deltas, one landing per change, closed before dist', async () => {
  const { n, make } = countingWatcher();
  let openAtDist = null;
  const design = newDesign({ engine: 'codex' });
  const { build, frames } = newBuild(design, {
    deps: { createWorkWatcher: make, snapshotVersion: async () => { openAtDist = n.opened - n.closed; } },
  });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assertWatchFrames(frames);
  assert.equal(n.opened, 1);
  assert.equal(openAtDist, 0, 'the watcher is closed when snapshotVersion runs');
  assert.ok(existsSync(join(distDir(design.id), 'index.html')));
  assert.ok(n.rescans >= 3, 'a rescan at tool results and exits');
  const count = framesOf(frames, 'design-file').length;
  writeFileSync(join(designWorkDir(design.id), 'sections', 'hero', 'index.html'), '<p>after the end</p>');
  build._onWatchLand('sections/hero/index.html', { gone: false });
  assert.equal(framesOf(frames, 'design-file').length, count, 'a settled build lands nothing');
});

test('the same with the real default watcher', async () => {
  const design = newDesign({ engine: 'codex' });
  const { build, frames } = newBuild(design);
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assertWatchFrames(frames);
  assert.ok(existsSync(join(distDir(design.id), 'index.html')));
});

test('a tool result and an agent exit re-read; stop closes it', async (t) => {
  await t.test('held at a tool result, then released', async () => {
    const { n, make } = countingWatcher();
    let release;
    const gate = new Promise((r) => { release = r; });
    let atResult = null;
    let holding = false;
    const runner = async (o) => {
      if (!isBuilder(o, 'hero')) return mockRun(o);
      writeFileSync(join(o.cwd, 'index.html'), '<section data-section="hero"><h2>Held</h2></section>');
      const before = n.rescans;
      o.onEvent({ type: 'toolResult', parentId: 'toolu_sub', meta: null, results: [] });   // a sub-agent's: no re-read
      o.onEvent({ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: 't1', isError: false, text: 'ok', content: 'ok' }] });
      atResult = n.rescans - before;
      holding = true;
      await hold(o.signal, gate);
      return { text: '', exitCode: 0 };
    };
    const { build, frames } = newBuild(newDesign({ engine: 'gemini' }), { deps: { createWorkWatcher: make, runClaude: runner } });
    let atDone = null;
    build.on('frame', (f) => { if (f.type === 'design-section' && f.sectionId === 'hero' && f.status === 'done') atDone = n.rescans; });
    const p = build.run();
    await waitUntil(() => holding);
    assert.equal(atResult, 1, 'one rescan at the tool result');
    await waitUntil(() => frames.some((f) => f.type === 'design-file' && f.path === 'sections/hero/index.html'));
    const mid = n.rescans;
    release();
    assert.deepEqual(await p, { status: 'done', reason: null });
    assert.equal(atDone, mid + 1, 'one more when the process exits, before the section is judged');
    assert.equal(n.opened, n.closed);
  });

  await t.test('stop', async () => {
    const { n, make } = countingWatcher();
    let holding = false;
    const runner = async (o) => {
      if (!isBuilder(o, 'hero')) return mockRun(o);
      holding = true;
      await hold(o.signal, new Promise(() => {}));
      return { text: '', exitCode: 0 };
    };
    const { build } = newBuild(newDesign({ engine: 'gemini' }), { deps: { createWorkWatcher: make, runClaude: runner } });
    const p = build.run();
    await waitUntil(() => holding);
    assert.equal(n.opened - n.closed, 1, 'open while the builder runs');
    await build.stop('user');
    assert.equal((await p).status, 'stopped');
    assert.equal(n.opened, 1);
    assert.equal(n.closed, 1, 'opened equals closed');
  });
});

test('only the plan\'s sections land', async () => {
  const design = newDesign({ engine: 'codex' });
  const leftover = '<section data-section="old"><h2>a</h2><p>b</p><ul><li>c</li><li>d</li></ul></section>';
  const runner = async (o) => {
    if (isBuilder(o, 'hero')) {
      mkdirSync(join(designWorkDir(design.id), 'sections', 'old'), { recursive: true });
      writeFileSync(join(designWorkDir(design.id), 'sections', 'old', 'index.html'), leftover);
    }
    return mockRun(o);
  };
  const { build, frames } = newBuild(design, { deps: { runClaude: runner } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(frames.some((f) => typeof f.path === 'string' && f.path.startsWith('sections/old/')), false);
  const hero = countLayers(readFileSync(join(designWorkDir(design.id), 'sections', 'hero', 'index.html'), 'utf8'));
  assert.ok(hero > 0);
  assert.equal(getBuild(build.id).layers, hero, 'the leftover adds no layers');
  assert.equal(build._layerCount(), hero);
});

test('_onWatchLand: a gone lands only for a path this build landed; leftovers and repeats never land', async () => {
  const design = newDesign({ engine: 'codex' });
  assert.equal((await newBuild(design).build.run()).status, 'done');
  // A change round, not started: its records hold the plan's sections and it has not settled.
  const { build, frames } = newBuild(design, { kind: 'change', sections: ['hero'], brief: 'Change the hero' });
  const work = designWorkDir(design.id);
  const files = () => framesOf(frames, 'design-file').map((f) => [f.path, f.text]);
  build._onWatchLand('sections/hero/index.html', { gone: true });
  assert.deepEqual(files(), [], 'a gone for a path this build never landed sends nothing');
  build._landBases([{ id: 'hero' }]);
  const bases = files().length;
  assert.ok(bases > 0, 'the bases land');
  build._onWatchLand('sections/hero/index.html', { gone: false });
  assert.equal(files().length, bases, 'a base the watcher reads again does not land twice');
  writeFileSync(join(work, 'sections', 'hero', 'index.html'), '<p>new</p>');
  build._onWatchLand('sections/hero/index.html', { gone: false });
  build._onWatchLand('sections/hero/index.html', { gone: false });
  assert.deepEqual(files().slice(bases), [['sections/hero/index.html', '<p>new</p>']], 'the same text lands once');
  build._onWatchLand('sections/hero/index.html', { gone: true });
  assert.deepEqual(files().at(-1), ['sections/hero/index.html', ''], 'a landed path that went lands empty');
  mkdirSync(join(work, 'sections', 'zzz'), { recursive: true });
  writeFileSync(join(work, 'sections', 'zzz', 'index.html'), '<p>z</p>');
  build._onWatchLand('sections/zzz/index.html', { gone: false });
  writeFileSync(join(work, 'tokens.css'), ':root{--w:1}');
  build._onWatchLand('tokens.css', { gone: false });
  assert.deepEqual(files().at(-1), ['tokens.css', ':root{--w:1}'], 'the global files pass the section check');
  build._sections.find((s) => s.id === 'hero').unbuiltAdd = true;
  writeFileSync(join(work, 'sections', 'hero', 'index.html'), '<p>leftover</p>');
  build._onWatchLand('sections/hero/index.html', { gone: false });
  assert.equal(files().some(([p]) => p.startsWith('sections/zzz/')), false, 'a section the plan lacks never lands');
  assert.equal(files().some(([, text]) => text === '<p>leftover</p>'), false, 'an unbuilt add never lands');
  assert.equal(framesOf(frames, 'design-file').length, bases + 3);
});

test('a removed section\'s watch goes before its folder, a re-added one\'s before it is cleared; no leftover lands', async () => {
  const d = newDesign({ engine: 'codex' });
  const features = sectionDir(d.id, 'features');
  const drops = [];
  const make = (opts) => {
    const w = createWorkWatcher(opts);
    return {
      start: () => w.start(),
      rescan: () => w.rescan(),
      close: () => w.close(),
      drop: (id) => { drops.push([id, existsSync(sectionDir(d.id, id))]); w.drop(id); },
      get degraded() { return w.degraded; },
    };
  };
  assert.equal((await newBuild(d, { brief: 'MOCK_SECTIONS=2' }).build.run()).status, 'done');
  const removal = newBuild(getDesign(d.id), { kind: 'change', brief: 'MOCK_ROUND_REMOVE=features', sections: [], needsLead: true, deps: { createWorkWatcher: make } });
  assert.deepEqual(await removal.build.run(), { status: 'done', reason: null });
  assert.deepEqual(drops, [['features', true]], 'dropped while the folder is still there');
  assert.equal(existsSync(features), false);
  // A leftover the removal could not take (a Windows handle): the same id comes back.
  mkdirSync(features);
  writeFileSync(join(features, 'index.html'), '<section data-section="features"><p>STALE</p></section>');
  drops.length = 0;
  const add = newBuild(getDesign(d.id), { kind: 'change', brief: 'MOCK_ROUND_ADD=features:hero', sections: [], needsLead: true, deps: { createWorkWatcher: make } });
  assert.deepEqual(await add.build.run(), { status: 'done', reason: null });
  assert.deepEqual(drops, [['features', true]], 'dropped before the add clears its folder');
  const files = framesOf(add.frames, 'design-file');
  assert.equal(files.some((f) => f.text.includes('STALE')), false, 'the leftover never lands');
  assert.ok(files.some((f) => f.path === 'sections/features/index.html' && f.text.includes('data-section="features"')), 'the new build lands');
  assert.equal(framesOf(add.frames, 'design-delta').length, 0);
});

test('claude opens no watcher', async () => {
  const { n, make } = countingWatcher();
  const { build, frames } = newBuild(newDesign({ engine: 'claude' }), { deps: { createWorkWatcher: make } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(n.opened, 0);
  assert.ok(framesOf(frames, 'design-delta').length > 0, 'claude still streams');
});

test('a bridged-style Claude run still draws deltas from whole tool calls', async () => {
  const runner = (o) => mockRun({ ...o, onEvent: (evt) => { if (evt?.type !== 'toolInput') o.onEvent(evt); } });
  const { build, frames } = newBuild(newDesign({ engine: 'claude' }), { deps: { runClaude: runner } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.ok(framesOf(frames, 'design-delta').length >= 1);
  assert.ok(framesOf(frames, 'design-file').some((f) => f.path === 'sections/hero/index.html'));
});
