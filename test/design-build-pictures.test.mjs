// test/design-build-pictures.test.mjs — Design pictures (P2 Task B5a): the round's picture desk inside the build.
// With pictures on (the design's switch and a ready service) the lead is told the kit line and the rules, the kit is
// staged in work/.kit/, and a picture the lead asks for is made, booked once to the round, recorded and framed; off,
// nothing of it exists. Every way a round ends (a halt, a settle with no halt, a thrown drive) closes the desk and
// waits for it, so no picture row, frame or booking comes after the round's terminal `design-build` frame (SPEC §8).
// Every test injects `imagesReady` and `generatePicture`: none reads the person's settings or reaches a service.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { prepare } from '../src/core/db.mjs';
import { DesignBuild } from '../src/core/design/build.mjs';
import { stagePictureKit } from '../src/core/design/kit.mjs';
import { PICTURE_KIT, designWorkDir, distDir, madeDir, picturesDir } from '../src/core/design/paths.mjs';
import { createPictureDesk, readKeptPicture } from '../src/core/design/pictures.mjs';
import { getBuild, getDesign, listAgents, listPictures, updateDesign } from '../src/core/design/store.mjs';
import { ImagesError } from '../src/core/images.mjs';

useDesignEnv(after);
const png = (w, h) => Buffer.from(encodePNG(w, h, new Uint8Array(w * h * 3).fill(90)));

const gen = Object.assign(async (o) => { gen.calls.push(o); return { bytes: png(384, 256), ext: 'png', w: 384, h: 256, model: 'gpt-image-2.6-flare', ms: 5, costUsd: 0.04 }; }, { calls: [] });
beforeEach(() => { gen.calls.length = 0; });
const on = { imagesReady: () => true, generatePicture: gen };
const kit = (cwd, args) => new Promise((res) => execFile(process.execPath, [join(cwd, '.kit/picture.mjs'), ...args], { cwd }, (err, out) => res({ code: err ? err.code : 0, out })));
const planning = (o) => o.prompt.startsWith('Plan a new design') && /^Picture kit: \.kit\/picture\.mjs$/m.test(o.prompt);
const asking = (list, seen = []) => async (o) => {
  if (planning(o)) for (const [name, shape] of list) seen.push(await kit(o.cwd, [name, shape, `A test picture of ${name}, no text`]));
  return runClaude({ ...o, mock: true });
};
const pictureLedger = (bid) => prepare("SELECT COUNT(*) AS n FROM design_cost_ledger WHERE build_id = ? AND model = 'gpt-image-2.6-flare'").get(bid).n;

test('1 pictures on: the lead is told, one picture is made, booked once to the round, framed, and travels to dist', async () => {
  const d = newDesign(); const seen = [];
  const { build, calls, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...on, mock: true, runClaude: asking([['hero-studio', 'wide']], seen) } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(seen, [{ code: 0, out: 'assets/made/hero-studio.png  384×256\n' }]);
  assert.ok(calls[0].prompt.split('\n').includes('Picture kit: .kit/picture.mjs'));
  assert.ok(calls[0].systemPrompt.includes('Made pictures (only when your task names a `Picture kit`):'));
  assert.ok(calls.filter((c) => c.cwd !== designWorkDir(d.id)).every((c) => !c.systemPrompt.includes('Made pictures')), 'builders are not told');
  assert.deepEqual(readFileSync(join(designWorkDir(d.id), '.kit/picture.mjs')), readFileSync(PICTURE_KIT));
  assert.deepEqual([gen.calls[0].timeoutMs, gen.calls[0].mock], [180000, true]);
  const [row] = listPictures(d.id);
  assert.deepEqual([row.state, row.file, row.w, row.h, row.costUsd, row.round], ['made', 'assets/made/hero-studio.png', 384, 256, 0.04, 1]);
  const pf = framesOf(frames, 'design-picture');
  assert.deepEqual(pf.map((f) => [f.state, f.round, f.buildId]), [['making', 1, build.id], ['made', 1, build.id]]);
  assert.equal(pf[1].id, row.id, 'the frame names the stored row');
  assert.deepEqual(readKeptPicture(d.id, { id: row.id, ext: 'png' }), png(384, 256));
  assert.deepEqual(prepare("SELECT amount_usd, agent_id FROM design_cost_ledger WHERE build_id = ? AND model = 'gpt-image-2.6-flare'").all(build.id).map((r) => [r.amount_usd, r.agent_id]), [[0.04, null]]);
  assert.ok(getBuild(build.id).costUsd >= 0.04);
  assert.ok(existsSync(join(distDir(d.id), 'assets/made/hero-studio.png')));
});
test('2 pictures off, or the service not ready: no desk, no kit line, no rules, no command, no .pictures', async () => {
  for (const [d, deps] of [[newDesign({ pictures: false }), on], [newDesign(), { ...on, imagesReady: () => false }]]) {
    stagePictureKit({ workDir: designWorkDir(d.id) });   // what an earlier round left
    const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...deps, runClaude: asking([['hero', 'wide']]) } });
    assert.deepEqual(await build.run(), { status: 'done', reason: null });
    assert.doesNotMatch(calls[0].prompt, /^Picture kit:/m); assert.ok(!calls[0].systemPrompt.includes('Made pictures'));
    assert.equal(existsSync(join(designWorkDir(d.id), '.kit/picture.mjs')), false);
    assert.equal(existsSync(picturesDir(d.id)), false);
  }
  assert.equal(gen.calls.length, 0);
});
test('3 a hand-written ask with a bad shape gets its done file only, and the round ends done', async () => {
  const d = newDesign(); let done = null;
  const runClaudeX = async (o) => {
    if (planning(o)) {
      const P = picturesDir(d.id); const t = join(P, '.x.tmp');
      writeFileSync(t, JSON.stringify({ v: 1, name: 'x', shape: 'round', prompt: 'p', at: new Date().toISOString() })); renameSync(t, join(P, 'x.ask.json'));
      await waitUntil(() => { try { done = JSON.parse(readFileSync(join(P, 'x.done.json'), 'utf8')); return true; } catch { return false; } });
    }
    return runClaude({ ...o, mock: true });
  };
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...on, runClaude: runClaudeX } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual([done.ok, done.reason], [false, 'the shape must be wide, tall or square']);
  assert.deepEqual([listPictures(d.id), framesOf(frames, 'design-picture'), gen.calls.length], [[], [], 0]);
});
test('4 a reached limit pauses the round after the booking', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { ...on, runClaude: asking([['a', 'wide']]), readCaps: async () => ({ perRunCapUsd: 0.03, totalCapUsd: null }) } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
  assert.equal(pictureLedger(build.id), 1);
});
test('5 Stop while a picture is in the making: aborted, nothing booked, no file, a failed row; the round answers after the desk is done', async () => {
  const hang = { imagesReady: () => true, generatePicture: ({ signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) };
  const d = newDesign(); const seen = [];
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...hang, runClaude: asking([['a', 'wide']], seen) } });
  const ran = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-picture' && f.state === 'making');
  const t = join(picturesDir(d.id), '.late.tmp');
  writeFileSync(t, JSON.stringify({ v: 1, name: 'late', shape: 'wide', prompt: 'p', at: new Date().toISOString() })); renameSync(t, join(picturesDir(d.id), 'late.ask.json'));
  void build.stop();
  assert.equal((await ran).status, 'stopped');
  assert.ok(existsSync(join(picturesDir(d.id), 'late.done.json')), 'run() answered only after the desk wrote its last done file');
  assert.deepEqual(seen, [{ code: 1, out: 'picture: the round stopped\n' }]);
  assert.deepEqual(readdirSync(madeDir(d.id)), []);
  assert.deepEqual(listPictures(d.id).map((r) => [r.name, r.state, r.reason]), [['a', 'failed', 'the round stopped']]);
  assert.equal(pictureLedger(build.id), 0);
});
test('6 a Continue never makes or books a picture again', async () => {
  const d = newDesign(); const deps = { ...on, runClaude: asking([['a', 'wide']]) };
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', deps });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
  assert.equal(gen.calls.length, 1);
  const again = DesignBuild.rehydrate({ buildId: build.id, deps: { staggerMs: 0, retryDelayMs: 0, ...deps } });
  assert.deepEqual(await again.continue(), { status: 'done', reason: null });
  assert.deepEqual([gen.calls.length, pictureLedger(build.id), listPictures(d.id).length], [1, 1, 1]);
  assert.deepEqual(readdirSync(picturesDir(d.id)), [], 'the new desk cleared the old ask: the mock Continue ends before its first tick, so without the clear close() answers the old ask "stopped" with no call, and only this line sees it');
});
test('6b madeBefore counts this build\'s made pictures only: 1 on its Continue (a failed one is not counted), 0 in the next round', async () => {
  const before = []; const spy = (o) => { before.push(o.madeBefore); return createPictureDesk(o); };
  const failing = async (o) => { if (o.prompt.includes('of b,')) throw new ImagesError('the image service answered 500'); return gen(o); };
  const d = newDesign();
  const deps = { imagesReady: () => true, generatePicture: failing, createPictureDesk: spy, runClaude: asking([['a', 'wide'], ['b', 'wide']]) };
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', deps });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
  assert.deepEqual(listPictures(d.id).map((r) => [r.name, r.state]), [['a', 'made'], ['b', 'failed']]);
  const again = DesignBuild.rehydrate({ buildId: build.id, deps: { staggerMs: 0, retryDelayMs: 0, ...deps } });
  assert.deepEqual(await again.continue(), { status: 'done', reason: null });
  const next = newBuild(getDesign(d.id), { brief: 'MOCK_SECTIONS=1', deps: { ...on, createPictureDesk: spy } });
  assert.deepEqual(await next.build.run(), { status: 'done', reason: null });
  assert.deepEqual(before, [0, 1, 0]);
});

/** A `generatePicture` that hangs until its call is aborted, then rejects as an abort, `lag` ms later. `h.signal` is
 *  the call's signal once it started; `h.aborted` turns true at the abort. */
const hanging = (lag = 0) => {
  const h = { signal: null, aborted: false };
  h.deps = {
    imagesReady: () => true,
    generatePicture: ({ signal }) => new Promise((_, rej) => {
      h.signal = signal;
      signal.addEventListener('abort', () => {
        h.aborted = true;
        const err = Object.assign(new Error('aborted'), { name: 'AbortError' });
        if (lag) setTimeout(() => rej(err), lag); else rej(err);
      });
    }),
  };
  return h;
};
/** The lead's plan stage asks for `a` and waits 200 ms only: still in the making (exit 3). It waits until the call
 *  has started (the desk looks every 400 ms), runs `then`, and goes on to the mock, the picture still in the making. */
const askingLong = (h, seen = [], then = () => {}) => async (o) => {
  if (planning(o)) {
    seen.push(await kit(o.cwd, ['--wait-ms', '200', 'a', 'wide', 'A test picture of a, no text']));
    await waitUntil(() => h.signal !== null);
    then();
  }
  return runClaude({ ...o, mock: true });
};
const doneOf = (d, name) => JSON.parse(readFileSync(join(picturesDir(d.id), `${name}.done.json`), 'utf8'));
const lastOf = (frames, type) => frames.findLastIndex((f) => f.type === type);

test('4b a booking writes the round\'s cost at once, and a limit it reaches halts the round at the booking: the lead is aborted before the command answers', async () => {
  let rowCost = null; let abortedAtAnswer = null;
  const asks = async (o) => {
    if (planning(o)) {
      await kit(o.cwd, ['a', 'wide', 'A test picture of a, no text']);
      abortedAtAnswer = o.signal.aborted;
      rowCost = getBuild(build.id).costUsd;
    }
    return runClaude({ ...o, mock: true });
  };
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { ...on, runClaude: asks, readCaps: async () => ({ perRunCapUsd: 0.03, totalCapUsd: null }) } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
  assert.equal(rowCost, 0.04);
  assert.equal(abortedAtAnswer, true, 'the booking itself paused the round, not the lead\'s next usage');
  assert.deepEqual(listAgents(build.id).map((a) => [a.role, a.status]), [['lead', 'stopped']]);
});
test('4c a limit reached before the call: no call, nothing booked, the ask ends "the round stopped" and the round pauses', async () => {
  let asked = 0; const seen = [];
  // The lead's spawn passes the gate; the picture's call meets the limit.
  const budgetStatus = () => ({ blocked: (asked += 1) > 1 });
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { ...on, budgetStatus, runClaude: asking([['a', 'wide']], seen) } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'total-limit' });
  assert.deepEqual(seen, [{ code: 1, out: 'picture: the round stopped\n' }]);
  assert.deepEqual([gen.calls.length, pictureLedger(build.id)], [0, 0]);
});
test('5b a Stop while the call waits on the spend gate: the service is never handed an aborted signal, and the round answers', async () => {
  const h = hanging(); const d = newDesign(); let gates = 0; let release;
  const held = new Promise((r) => { release = r; });
  // The lead's spawn passes the team gate at once; the picture's call waits there until the Stop.
  const teamTotalGate = async () => { gates += 1; if (gates === 2) await held; return { blocked: false }; };
  const lead = async (o) => {
    if (planning(o)) {
      await kit(o.cwd, ['--wait-ms', '200', 'a', 'wide', 'A test picture of a, no text']);
      await waitUntil(() => gates === 2);
      void build.stop();
      release();
    }
    return runClaude({ ...o, mock: true });
  };
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...h.deps, teamTotalGate, runClaude: lead } });
  let timer;
  const hung = new Promise((r) => { timer = setTimeout(() => r('hung'), 5000); });
  const end = await Promise.race([build.run(), hung]);
  clearTimeout(timer);
  assert.deepEqual(end, { status: 'stopped', reason: 'user' });
  assert.equal(h.signal, null, 'the service was never called');
  assert.deepEqual([doneOf(d, 'a').ok, doneOf(d, 'a').reason], [false, 'the round stopped']);
});
test('7 a picture in the making when the round settles (no halt, done, a Stop): aborted, nothing booked, its frames before the terminal frame', async () => {
  for (const [brief, end, stop] of [
    ['MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', { status: 'paused', reason: 'failed' }, false],
    ['MOCK_SECTIONS=1', { status: 'done', reason: null }, false],
    ['MOCK_SECTIONS=1', { status: 'stopped', reason: 'user' }, true],
  ]) {
    // The call ends 300 ms after its abort: only a settle that waits for the desk sends the failed frame first.
    const h = hanging(300); const d = newDesign(); const seen = [];
    const { build, frames } = newBuild(d, { brief, deps: { ...h.deps, runClaude: askingLong(h, seen, () => { if (stop) void build.stop(); }) } });
    assert.deepEqual(await build.run(), end);
    assert.equal(seen[0].code, 3);
    assert.equal(h.signal.aborted, true);
    assert.deepEqual(listPictures(d.id).map((r) => [r.name, r.state, r.reason]), [['a', 'failed', 'the round stopped']]);
    assert.equal(pictureLedger(build.id), 0);
    assert.deepEqual([doneOf(d, 'a').ok, doneOf(d, 'a').reason], [false, 'the round stopped']);
    assert.deepEqual(framesOf(frames, 'design-picture').map((f) => f.state), ['making', 'failed']);
    assert.ok(lastOf(frames, 'design-picture') < lastOf(frames, 'design-build'), `${end.status}: the failed frame comes before the terminal frame`);
    assert.deepEqual([frames.at(-1).type, frames.at(-1).status, frames.at(-1).reason], ['design-build', end.status, end.reason]);
  }
});
test('7b a Stop while the drive waits for its own close of the desk ends the round stopped, not paused', async () => {
  const h = hanging(300);
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', deps: { ...h.deps, runClaude: askingLong(h) } });
  const ran = build.run();
  await waitUntil(() => h.aborted);
  void build.stop();
  assert.deepEqual(await ran, { status: 'stopped', reason: 'user' });
});
test('7c every other settle path waits for the desk: the lead failed; a Stop after the builders, after integrate, after rework; a rework that fails', async () => {
  for (const [brief, end, at] of [
    ['MOCK_SECTIONS=1 MOCK_FAIL_LEAD', { status: 'error', reason: 'lead-failed' }, 'lead'],
    ['MOCK_SECTIONS=1', { status: 'stopped', reason: 'user' }, 'builder'],
    ['MOCK_SECTIONS=1', { status: 'stopped', reason: 'user' }, 'integrate'],
    ['MOCK_SECTIONS=1 MOCK_REWORK=hero', { status: 'stopped', reason: 'user' }, 'rework'],
    ['MOCK_SECTIONS=1 MOCK_REWORK=hero', { status: 'paused', reason: 'failed' }, 'rework-fails'],
  ]) {
    // As test 7: the call ends 300 ms after its abort, so only a settle that waits for the desk frames it first.
    const h = hanging(300); const d = newDesign(); const seen = []; const lead = askingLong(h, seen);
    const run = async (o) => {
      if (at === 'builder' && o.cwd !== designWorkDir(d.id)) void build.stop();
      if (at === 'integrate' && o.prompt.startsWith('The builders are done')) void build.stop();
      if (at === 'rework' && o.prompt.startsWith('Rework: ')) void build.stop();
      if (at === 'rework-fails' && o.prompt.startsWith('Rework: ')) throw new Error('rework crashed');
      return lead(o);
    };
    const { build, frames } = newBuild(d, { brief, deps: { ...h.deps, runClaude: run } });
    assert.deepEqual(await build.run(), end, at);
    assert.equal(seen[0].code, 3, at);
    assert.ok(existsSync(join(picturesDir(d.id), 'a.done.json')), `${at}: run() answers after the desk wrote the done file`);
    assert.deepEqual(listPictures(d.id).map((r) => [r.name, r.state, r.reason]), [['a', 'failed', 'the round stopped']], at);
    assert.deepEqual(framesOf(frames, 'design-picture').map((f) => f.state), ['making', 'failed'], at);
    assert.ok(lastOf(frames, 'design-picture') < lastOf(frames, 'design-build'), `${at}: the failed frame comes before the terminal frame`);
    assert.deepEqual([frames.at(-1).type, frames.at(-1).status, frames.at(-1).reason], ['design-build', end.status, end.reason], at);
  }
});
test('8 a thrown drive with a picture in the making: the desk is done before run() answers error, engine-error, its terminal frame last', async () => {
  const h = hanging(); const d = newDesign(); let slots = 0;
  // The lead's plan spawn and the builder's pass; the lead's integrate spawn throws, outside the builder stage (which
  // aborts and awaits its own loops before it rethrows), so only _guarded waits for the desk.
  const acquireGlobal = async () => { slots += 1; if (slots > 2) throw new Error('slot table gone'); };
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...h.deps, acquireGlobal, runClaude: askingLong(h) } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'engine-error' });
  assert.equal(slots, 3);
  assert.equal(h.signal.aborted, true);
  assert.deepEqual([doneOf(d, 'a').ok, doneOf(d, 'a').reason], [false, 'the round stopped']);
  assert.deepEqual(framesOf(frames, 'design-picture').map((f) => f.state), ['making', 'failed']);
  assert.deepEqual([frames.at(-1).type, frames.at(-1).status, frames.at(-1).reason], ['design-build', 'error', 'engine-error']);
});
test('9 a Stop that lands before the desk opens opens nothing: no kit, no .pictures, no spawn', async () => {
  const d = newDesign();
  const readCaps = async () => { void build.stop(); return { perRunCapUsd: null, totalCapUsd: null }; };
  const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...on, readCaps } });
  assert.deepEqual(await build.run(), { status: 'stopped', reason: 'user' });
  assert.equal(calls.length, 0);
  assert.equal(existsSync(join(designWorkDir(d.id), '.kit/picture.mjs')), false);
  assert.equal(existsSync(picturesDir(d.id)), false);
});
test('10 the switch turned off mid-round takes effect at the next ask: refused, no call', async () => {
  const d = newDesign(); const seen = [];
  const lead = async (o) => {
    if (planning(o)) {
      updateDesign(d.id, { pictures: false });
      seen.push(await kit(o.cwd, ['a', 'wide', 'A test picture of a, no text']));
    }
    return runClaude({ ...o, mock: true });
  };
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { ...on, runClaude: lead } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(seen, [{ code: 1, out: 'picture: pictures are off for this design\n' }]);
  assert.deepEqual([gen.calls.length, listPictures(d.id).map((r) => [r.state, r.reason])], [0, [['failed', 'pictures are off for this design']]]);
});
test('11 a round with pictures on names the kit to the lead in every prompt: integrate, and a change round\'s plan', async () => {
  const d = newDesign();
  const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: on });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.match(calls.find((c) => c.prompt.startsWith('The builders are done')).prompt, /^Picture kit: \.kit\/picture\.mjs$/m);
  const change = newBuild(getDesign(d.id), { kind: 'change', instruction: 'Warmer colours', sections: [], needsLead: true, deps: on });
  assert.deepEqual(await change.build.run(), { status: 'done', reason: null });
  assert.match(change.calls[0].prompt, /^Change round: Warmer colours/);
  assert.match(change.calls[0].prompt, /^Picture kit: \.kit\/picture\.mjs$/m);
});
