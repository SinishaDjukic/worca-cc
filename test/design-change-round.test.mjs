// test/design-change-round.test.mjs
// Change rounds on the same engine (P2 Task 16, SPEC §4, C-3): `applyRound` (plan, shell slots, removals), a
// lead-less round over named sections, a lead round (round.json, one fix resume, apply, touch and add builders,
// integrate), the `todo` that ties a section to one round (L2.35, L2.37), M8 and Continue inside a change round, and
// the bases every selected section lands before the first spawn (Contract issue 22). One home per file.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { applyRound, DesignBuild } from '../src/core/design/build.mjs';
import { countLayers } from '../src/core/design/draft.mjs';
import { crewFile, designWorkDir, distDir, sectionDir } from '../src/core/design/paths.mjs';
import { validatePlan } from '../src/core/design/plan.mjs';
import { createAgent, getBuild, getDesign, latestBuild, listAgents } from '../src/core/design/store.mjs';

useDesignEnv(after);
const firstBuild = async (brief = 'MOCK_SECTIONS=3', fields = {}) => { const d = newDesign(fields); const { build } = newBuild(d, { brief }); await build.run(); return getDesign(d.id); };

const mockRun = (o) => runClaude({ ...o, mock: true });
const isBuilder = (o) => o.cwd.includes(`${sep}sections${sep}`);
const inSection = (o, id) => o.cwd.endsWith(`${sep}sections${sep}${id}`);
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
/** A process that runs until its signal aborts; the ref'd bound keeps Node 22 from draining the loop. */
function hangUntilAbort(o) {
  return new Promise((resolve, reject) => {
    const bound = setTimeout(() => reject(new Error('hung')), 10_000);
    const onAbort = () => { clearTimeout(bound); reject(abortError()); };
    if (o.signal.aborted) onAbort();
    else o.signal.addEventListener('abort', onAbort, { once: true });
  });
}
/** The build `buildId` rehydrated, every spawn recorded and run on the mock unless `deps.runClaude` says otherwise. */
const again = (buildId, deps = {}) => {
  const calls = [];
  const frames = [];
  const inner = deps.runClaude ?? mockRun;
  const b = DesignBuild.rehydrate({ buildId, deps: { staggerMs: 0, retryDelayMs: 0, ...deps, runClaude: (o) => { calls.push(o); return inner(o); } } });
  b.on('frame', (f) => frames.push(f));
  return { b, calls, frames };
};
const planIds = (designId) => JSON.parse(readFileSync(join(designWorkDir(designId), 'plan.json'), 'utf8')).sections.map((s) => s.id);

test('applyRound: order, brief-free touch, remove, and M5 add beside its slot in the same parent', () => {
  const s = (id) => ({ id, job: id, brief: 'b', parts: ['html'], estHeight: 600 });
  const plan = { v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [s('hero'), s('pricing'), s('team')] };
  const shellHtml = '<main class="g"><div data-worca-slot="hero"></div><div data-worca-slot="pricing"></div></main><!--worca:sections-->';
  const frozen = JSON.stringify(plan);
  const r = applyRound({ plan, shellHtml, round: { v: 1, summary: 's', touch: [{ id: 'hero', brief: 'x' }], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 600, after: 'hero' }], remove: ['team'] } });
  assert.deepEqual(r.plan.sections.map((x) => x.id), ['hero', 'faq', 'pricing']);
  assert.deepEqual(r.removed, ['team']);
  assert.equal(r.shellHtml, '<main class="g"><div data-worca-slot="hero"></div><div data-worca-slot="faq"></div><div data-worca-slot="pricing"></div></main><!--worca:sections-->');
  assert.equal(r.plan.sections[0].brief, 'b', "a touch brief is this round's text only");
  assert.deepEqual(r.plan.sections[1], { id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 600 }, 'after is dropped from the plan section');
  assert.equal(JSON.stringify(plan), frozen, 'pure: the input plan is not changed');
  const noSlot = applyRound({ plan, shellHtml: '<!--worca:sections-->', round: { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 600 }], remove: [] } });
  assert.deepEqual(noSlot.plan.sections.map((x) => x.id), ['hero', 'pricing', 'team', 'faq'], 'no after: at the end');
  assert.equal(noSlot.shellHtml, '<!--worca:sections-->');
  const quoted = applyRound({ plan, shellHtml: `<div class="x" data-worca-slot='hero'></div><div data-worca-slot="team"></div><!--worca:sections-->`, round: { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 600, after: 'hero' }], remove: ['team'] } });
  assert.equal(quoted.shellHtml, `<div class="x" data-worca-slot='hero'></div><div data-worca-slot="faq"></div><!--worca:sections-->`, 'found by scanShellSlots, whatever the quoting; a removed section takes its slot along');
  const noMarker = applyRound({ plan, shellHtml: '<main><div data-worca-slot="hero"></div><div data-worca-slot="pricing"></div><div data-worca-slot="team"></div></main>', round: { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 600 }], remove: [] } });
  assert.equal(noMarker.shellHtml, '<main><div data-worca-slot="hero"></div><div data-worca-slot="pricing"></div><div data-worca-slot="team"></div><div data-worca-slot="faq"></div></main>', 'no marker and no after slot: beside the last slot, or the strict modes throw BAD_SHELL at the end of a paid round');
  const textMarker = applyRound({ plan, shellHtml: '<main><div data-worca-slot="hero"></div></main><script>"<!--worca:sections-->"</script>', round: { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 600 }], remove: [] } });
  assert.equal(textMarker.shellHtml, '<main><div data-worca-slot="hero"></div><div data-worca-slot="faq"></div></main><script>"<!--worca:sections-->"</script>', 'the marker is a comment the parser reads, never text inside a script');
  const chained = applyRound({ plan, shellHtml: '<div data-worca-slot="hero"></div><!--worca:sections-->', round: { v: 1, summary: 's', touch: [], add: [{ id: 'one', job: 'One', brief: 'b', parts: ['html'], estHeight: 1, after: 'hero' }, { id: 'two', job: 'Two', brief: 'b', parts: ['html'], estHeight: 1, after: 'one' }], remove: [] } });
  assert.equal(chained.shellHtml, '<div data-worca-slot="hero"></div><div data-worca-slot="one"></div><div data-worca-slot="two"></div><!--worca:sections-->', 'after may name a section added earlier in the round');
  assert.deepEqual(chained.plan.sections.map((x) => x.id), ['hero', 'one', 'two', 'pricing', 'team']);
  const twin = applyRound({ plan, shellHtml: '<div data-worca-slot="hero"></div><!--worca:sections-->', round: { v: 1, summary: 's', touch: [], add: [{ id: 'one', job: 'One', brief: 'b', parts: ['html'], estHeight: 1, after: 'hero' }, { id: 'two', job: 'Two', brief: 'b', parts: ['html'], estHeight: 1, after: 'hero' }], remove: [] } });
  assert.deepEqual(twin.plan.sections.map((x) => x.id), ['hero', 'one', 'two', 'pricing', 'team'], 'two adds naming one after keep round order in the plan');
  assert.equal(twin.shellHtml, '<div data-worca-slot="hero"></div><div data-worca-slot="one"></div><div data-worca-slot="two"></div><!--worca:sections-->', 'and in the shell');
  const placed = applyRound({ plan, shellHtml: '<div data-worca-slot="hero"></div><div data-worca-slot="faq"></div><!--worca:sections-->', round: { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 1, after: 'hero' }], remove: [] } });
  assert.equal(placed.shellHtml, '<div data-worca-slot="hero"></div><div data-worca-slot="faq"></div><!--worca:sections-->', 'a slot the lead placed is not doubled');
  const swap = applyRound({ plan, shellHtml: '<main><div data-worca-slot="team"></div></main>', round: { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 1 }], remove: ['team'] } });
  assert.equal(swap.shellHtml, '<main><div data-worca-slot="faq"></div></main>', 'adds before removes: the only slot still anchors the add');
  const band = applyRound({ plan, shellHtml: '<!--worca:sections-->', round: { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 1, band: 'Help', after: 'team' }], remove: [] } });
  assert.equal(band.plan.sections.at(-1).band, 'Help', 'band is kept from the add');
});

test('named sections, no lead: one builder, Read then Edit, the rest stay done, a new version', async () => {
  const d = await firstBuild(); const snaps = [];
  const { build, calls, frames } = newBuild(d, { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false, deps: { snapshotVersion: async () => snaps.push(1) } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual([build.round, build.kind], [2, 'change']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].maxTurns, 15);
  assert.equal(calls[0].resumeSessionId, undefined);
  assert.match(calls[0].prompt, /^Change: Bolder/);
  assert.equal(frames[0].type, 'design-build');
  assert.equal(frames[1].type, 'design-plan', 'right after its first design-build');
  assert.deepEqual(framesOf(frames, 'design-plan')[0].sections.map((s) => [s.id, s.status]), [['hero', 'planned'], ['features', 'done'], ['pricing', 'done']]);
  assert.ok(framesOf(frames, 'design-delta').some((f) => f.sectionId === 'hero' && f.splice.del > 0), 'R17: the Edit draws');
  const heroIdx = frames.filter((f) => f.path === 'sections/hero/index.html');
  assert.equal(heroIdx[0].type, 'design-file', 'the base lands before the first splice');
  assert.match(heroIdx[0].text, /Mock hero\./);
  assert.equal(listAgents(build.id).length, 1);
  assert.equal(listAgents(build.id)[0].role, 'builder');
  assert.match(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /Changed hero\./);
  assert.equal(snaps.length, 1);
  assert.equal(framesOf(frames, 'design-build').at(-1).status, 'done');
  const prev = getBuild(d.currentBuild).sections;
  assert.deepEqual(getBuild(build.id).sections.filter((s) => s.id !== 'hero').map((s) => [s.id, s.status, s.summary, s.agentId]),
    prev.filter((s) => s.id !== 'hero').map((s) => [s.id, s.status, s.summary, s.agentId]), 'every other section keeps its status, summary and agentId');
  assert.equal(getBuild(build.id).layers, getBuild(d.currentBuild).layers, 'layers count every section on disk, not only the changed one');
});

test('instruction is an alias of brief', async () => {
  const d = await firstBuild('MOCK_SECTIONS=1');
  const b = DesignBuild.create({ design: d.id, kind: 'change', instruction: 'Bolder', sections: ['hero'], needsLead: false, deps: { staggerMs: 0, runClaude: mockRun } });
  assert.equal(getBuild(b.id).brief, 'Bolder');
  assert.equal((await b.run()).status, 'done');
});

test('a change round refuses what it cannot run, before any row', async () => {
  const blank = newDesign();
  assert.throws(() => newBuild(blank, { kind: 'change', brief: 'x', sections: [], needsLead: true }), { status: 422 }, 'no plan yet');
  assert.equal(latestBuild(blank.id), null);
  const d = await firstBuild('MOCK_SECTIONS=2');
  const before = latestBuild(d.id).id;
  assert.throws(() => newBuild(d, { kind: 'change', brief: 'x', sections: ['ghost'], needsLead: false }), { status: 422 }, 'an unknown section');
  const pin = { id: 'p1', path: 'sections/hero/index.html', tag: 'h2', text: 'T', html: '<h2>T</h2>' };
  assert.throws(() => newBuild(d, { kind: 'change', brief: 'x', sections: ['hero'], needsLead: false, pins: [pin] }), { status: 422 }, 'pins wait for P5');
  assert.equal(latestBuild(d.id).id, before);
});

test('a lead round: lead, the touched builder, then integrate on the same session', async () => {
  const d = await firstBuild();
  const { build, calls, frames } = newBuild(d, { kind: 'change', brief: 'Warmer colours', sections: [], needsLead: true });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(calls.map((c) => c.maxTurns), [20, 15, 15]);
  assert.match(calls[0].prompt, /^Change round: Warmer colours/);
  assert.match(calls[0].prompt, new RegExp(`^Round file: ${join(designWorkDir(d.id), 'round.json').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`, 'm'));
  assert.match(calls[1].prompt, /^Change: Warmer colours/);
  assert.match(calls[1].prompt, /^For this section: Mock touch$/m, "the touch's brief");
  assert.equal(calls[2].resumeSessionId, listAgents(build.id).find((a) => a.role === 'lead').sessionId);
  assert.equal(framesOf(frames, 'design-plan').at(-1).planRev, 2);
  assert.equal(listAgents(build.id).length, 2, 'the lead once, one builder');
});

test('add and remove reach the plan, the stage and the disk', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2 MOCK_SHELL_SLOTS');
  const { build, frames } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero MOCK_ROUND_REMOVE=features', sections: [], needsLead: true });
  assert.equal((await build.run()).status, 'done');
  const plan = JSON.parse(readFileSync(join(designWorkDir(d.id), 'plan.json'), 'utf8'));
  assert.deepEqual(plan.sections.map((s) => s.id), ['hero', 'faq']);
  assert.equal(framesOf(frames, 'design-section').some((f) => f.sectionId === 'features' && f.status === 'removed'), true);
  assert.equal(existsSync(sectionDir(d.id, 'features')), false);
  assert.ok(existsSync(join(sectionDir(d.id, 'faq'), 'index.html')));
  assert.match(readFileSync(join(designWorkDir(d.id), 'shell.html'), 'utf8'), /data-worca-slot="hero"><\/div><div data-worca-slot="faq"/);
  assert.equal(existsSync(join(designWorkDir(d.id), 'round.json')), false);
  assert.equal(validatePlan(readFileSync(join(designWorkDir(d.id), 'plan.json'), 'utf8'), { kind: 'web' }).ok, true, 'the applied plan still validates');
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.id), ['hero', 'faq'], 'the removed record leaves the row');
  assert.deepEqual(framesOf(frames, 'design-plan').at(-1).sections.map((s) => [s.id, s.status]), [['hero', 'planned'], ['faq', 'planned']]);
  assert.doesNotMatch(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /data-section="features"/);
  const html = (id) => readFileSync(join(sectionDir(d.id, id), 'index.html'), 'utf8');
  assert.equal(getBuild(build.id).layers, countLayers(html('hero')) + countLayers(html('faq')), 'a removed section leaves the layer count');
});

test('a round.json an earlier round left is never applied', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  const stale = { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'], estHeight: 600, after: 'hero' }], remove: [] };
  let wrote = false;
  const r2 = newBuild(d, { kind: 'change', brief: 'Add a FAQ', sections: [], needsLead: true, deps: {
    runClaude: (o) => {
      if (o.maxTurns !== 20) return mockRun(o);
      writeFileSync(join(designWorkDir(d.id), 'round.json'), JSON.stringify(stale));
      wrote = true;
      return hangUntilAbort(o);
    },
  } });
  const p = r2.build.run();
  await waitUntil(() => wrote);
  r2.build.pauseForDrain();
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  await r2.build.stop();
  assert.ok(existsSync(join(designWorkDir(d.id), 'round.json')), 'the unapplied round is still on disk');
  const r3 = newBuild(d, { kind: 'change', brief: 'Warmer', sections: [], needsLead: true, deps: {
    runClaude: (o) => (o.maxTurns === 20 ? Promise.resolve({ text: 'Planned.', exitCode: 0 }) : mockRun(o)),
  } });
  assert.deepEqual(await r3.build.run(), { status: 'error', reason: 'plan-invalid' }, 'this lead wrote no round.json');
  assert.deepEqual(planIds(d.id), ['hero', 'features']);
});

test('an add with no estHeight is filled from the normalized round', async () => {
  const d = await firstBuild();
  const round = { v: 1, summary: 's', touch: [], add: [{ id: 'faq', job: 'FAQ', brief: 'b', parts: ['html'] }], remove: [] };
  const { build } = newBuild(d, { kind: 'change', brief: 'Add a FAQ', sections: [], needsLead: true, deps: {
    runClaude: async (o) => {
      if (o.maxTurns !== 20) return mockRun(o);
      writeFileSync(join(designWorkDir(d.id), 'round.json'), JSON.stringify(round));
      return { text: 'Planned.', exitCode: 0 };
    },
  } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const text = readFileSync(join(designWorkDir(d.id), 'plan.json'), 'utf8');
  assert.equal(JSON.parse(text).sections.find((s) => s.id === 'faq').estHeight, 240);
  assert.equal(validatePlan(text, { kind: 'web' }).ok, true);
});

test('a bad round gets one resume, then fails the round', async () => {
  const d = await firstBuild();
  const { build, calls } = newBuild(d, { kind: 'change', brief: 'MOCK_BAD_ROUND', sections: [], needsLead: true });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'plan-invalid' });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].resumeSessionId);
  assert.match(calls[1].prompt, /^round\.json is not valid:/);
  assert.deepEqual(planIds(d.id), ['hero', 'features', 'pricing'], 'the plan is untouched');
});

test('a todo stays in the build row: no frame, snapshot or .crew.json carries it', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  let mid = null;
  const { build, frames } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true, deps: {
    runClaude: (o) => { if (!mid && isBuilder(o)) mid = build.snapshot(); return mockRun(o); },
  } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(getBuild(build.id).sections.map((s) => [s.id, s.todo]),
    [['hero', { stage: 'change', brief: 'Mock touch' }], ['faq', { stage: 'first' }], ['features', undefined]]);
  assert.equal(getBuild(build.id).sections.some((s) => Object.hasOwn(s, 'unbuiltAdd')), false,
    'the add, once its builder row exists, carries no unbuiltAdd: no later round clears its build');
  for (const f of frames) assert.equal(JSON.stringify(f).includes('"todo"'), false, `${f.type} carries no todo`);
  assert.ok(mid, 'a snapshot taken while the builders ran');
  for (const snap of [mid, build.snapshot()]) {
    for (const s of [...snap.sections, ...snap.plan.sections]) assert.equal(Object.hasOwn(s, 'todo'), false);
  }
  assert.equal(readFileSync(crewFile(d.id), 'utf8').includes('todo'), false);
});

test('M8 in a change round; Continue does not apply the round twice', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true, deps: {
    runClaude: (o) => (inSection(o, 'faq') ? Promise.reject(new Error('claude exited with code 1: boom')) : mockRun(o)),
  } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
  assert.equal(getBuild(build.id).sections.find((s) => s.id === 'faq').status, 'failed');
  const c = again(build.id);
  assert.equal(c.b.snapshot().plan.planRev, 2, 'an applied round reads planRev 2 from its rows');
  assert.deepEqual(await c.b.continue(), { status: 'done', reason: null });
  assert.deepEqual(planIds(d.id), ['hero', 'faq', 'features'], 'faq once');
  assert.equal(c.calls.some((o) => o.maxTurns === 20), false, 'the change stage does not run again');
  assert.deepEqual(c.calls.map((o) => [isBuilder(o) ? o.cwd.split(sep).at(-1) : 'lead', o.maxTurns]), [['faq', 25], ['lead', 15]]);
  assert.ok(framesOf(c.frames, 'design-plan').every((f) => f.planRev === 2), 'planRev not bumped on Continue');
  assert.equal(listAgents(build.id).filter((a) => a.sectionId === 'faq').length, 1, 'M5: the same faq agent');
});

test('L2.38: an integrate pass that wrote no integration.json still ran: Continue with nothing to do answers 409', async () => {
  const d0 = newDesign();
  const first = newBuild(d0, { brief: 'MOCK_SECTIONS=2 MOCK_FAIL_SECTION=features' });
  assert.deepEqual(await first.build.run(), { status: 'paused', reason: 'failed' });
  await first.build.stop('user');
  const d = getDesign(d0.id);
  // L2.10: an integrate pass may write no file.
  const noFile = (o) => (o.maxTurns === 15 ? Promise.resolve({ text: '', exitCode: 0 }) : mockRun(o));
  let snapshots = 0;
  const snapshotVersion = async () => { snapshots += 1; };
  const { build, calls } = newBuild(d, { kind: 'change', brief: 'Warmer colours', sections: [], needsLead: true, deps: { runClaude: noFile, snapshotVersion } });
  assert.deepEqual(await build.run(), { status: 'done', reason: 'partial' }, 'done but for the carried features');
  assert.deepEqual(calls.map((o) => o.maxTurns), [20, 15, 15], 'the change stage, the touched hero, integrate');
  assert.equal(existsSync(join(designWorkDir(d.id), 'integration.json')), false);
  assert.equal(snapshots, 1);
  const c = again(build.id, { runClaude: noFile, snapshotVersion });
  assert.throws(() => c.b.continue(), { status: 409, message: 'Nothing to continue' });
  assert.throws(() => build.continue(), { status: 409, message: 'Nothing to continue' }, 'the live instance too');
  assert.deepEqual([c.calls.length, snapshots], [0, 1], 'no lead pass, no second version');
  assert.deepEqual([getBuild(build.id).status, getBuild(build.id).reason], ['done', 'partial']);
});

test('M5: a removed section\'s folder that cannot be removed never half-applies the round', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: a read-only parent stands in for EBUSY' : false }, async () => {
  const d = await firstBuild('MOCK_SECTIONS=2 MOCK_SHELL_SLOTS');
  const sections = join(designWorkDir(d.id), 'sections');
  const logged = [];
  const error = console.error;
  chmodSync(sections, 0o555);
  console.error = (...a) => { logged.push(a.join(' ')); };
  let end;
  try {
    const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_REMOVE=features', sections: [], needsLead: true });
    end = await build.run();
    assert.deepEqual(end, { status: 'done', reason: null });
    assert.deepEqual(planIds(d.id), ['hero'], 'the plan is applied');
    assert.deepEqual(getBuild(build.id).sections.map((x) => x.id), ['hero'], 'and the records with it');
    assert.equal(existsSync(join(designWorkDir(d.id), 'round.json')), false, 'round.json is gone, so no Continue applies it again');
    assert.equal(listAgents(build.id).find((a) => a.role === 'lead').status, 'done');
    assert.ok(existsSync(sectionDir(d.id, 'features')), 'the folder is left behind');
    assert.ok(logged.some((l) => /features/.test(l) && /EACCES/.test(l)), 'and logged');
    assert.doesNotMatch(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /data-section="features"/);
  } finally {
    console.error = error;
    chmodSync(sections, 0o755);
  }
});

test('M5: a re-added section never takes the files a removed one of the same id left as its build', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: a read-only folder stands in for EBUSY' : false }, async () => {
  const d = await firstBuild('MOCK_SECTIONS=2 MOCK_SHELL_SLOTS');
  const features = sectionDir(d.id, 'features');
  writeFileSync(join(features, 'script.js'), 'window.STALE_FEATURES = 1;\n');
  const logged = [];
  const error = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  chmodSync(features, 0o555);
  try {
    const removal = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_REMOVE=features', sections: [], needsLead: true });
    assert.deepEqual(await removal.build.run(), { status: 'done', reason: null });
    assert.ok(existsSync(join(features, 'script.js')), 'the locked folder keeps the removed section\'s files');

    // The same id comes back while the folder is still locked: that section fails, the others build.
    let silent = true;
    const { build, frames, calls } = newBuild(getDesign(d.id), { kind: 'change', brief: 'MOCK_ROUND_ADD=features:hero', sections: [], needsLead: true, deps: {
      runClaude: (o) => (inSection(o, 'features') && silent ? Promise.resolve({ text: '', exitCode: 0 }) : mockRun(o)),
    } });
    logged.length = 0;
    assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
    const rec = () => getBuild(build.id).sections.find((s) => s.id === 'features');
    assert.equal(rec().status, 'failed');
    assert.equal(calls.some((o) => inSection(o, 'features')), false, 'no builder ran on the old files');
    assert.equal(listAgents(build.id).some((a) => a.sectionId === 'features'), false, 'and no row, so a Continue clears it again');
    assert.ok(logged.some((l) => /features/.test(l)), 'logged');
    assert.equal(framesOf(frames, 'design-file').some((f) => f.path.startsWith('sections/features/')), false, 'no stale base lands');
    assert.ok(framesOf(frames, 'design-file').some((f) => f.path.startsWith('sections/hero/')), 'the touched section\'s base still lands');

    // Still locked, a Continue after a restart (whose rehydrate counts the old index.html's layers) fails it again,
    // and the old layers stop counting though the folder stays.
    assert.ok(countLayers(readFileSync(join(features, 'index.html'), 'utf8')) > 0);
    const heroLayers = countLayers(readFileSync(join(sectionDir(d.id, 'hero'), 'index.html'), 'utf8'));
    const locked = again(build.id);
    assert.deepEqual(await locked.b.continue(), { status: 'paused', reason: 'failed' });
    assert.deepEqual(locked.calls, [], 'nothing spawns');
    assert.equal(getBuild(build.id).layers, heroLayers, 'a folder that could not be cleared counts no layers');

    // Unlocked, a Continue after a restart clears the folder first: a builder that writes nothing is not judged by
    // the old index.html, and the old layers stop counting.
    chmodSync(features, 0o755);
    const r = again(build.id, { runClaude: (o) => {
      if (!inSection(o, 'features') || !silent) return mockRun(o);
      writeFileSync(join(o.cwd, 'own.css'), '.own {}\n');
      return Promise.resolve({ text: '', exitCode: 0 });
    } });
    assert.deepEqual(await r.b.continue(), { status: 'paused', reason: 'failed' });
    assert.equal(existsSync(join(features, 'script.js')), false, 'the removed section\'s files are gone');
    assert.equal(listAgents(build.id).find((a) => a.sectionId === 'features').error, 'sections/features/index.html was not written');
    assert.equal(getBuild(build.id).layers, heroLayers, 'the old index.html no longer counts');

    silent = false;
    assert.deepEqual(await r.b.continue(), { status: 'done', reason: null });
    assert.equal(rec().status, 'done');
    assert.ok(existsSync(join(features, 'own.css')), 'a section with its builder row is never cleared: that row wrote there');
    assert.equal(existsSync(join(features, 'script.js')), false);
    assert.doesNotMatch(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /STALE_FEATURES/);
  } finally {
    console.error = error;
    if (existsSync(features)) chmodSync(features, 0o755);
  }
});

test('an add\'s folder cleared before its first build stops counting what the lead landed there', async () => {
  /** The adding round's layers, its faq builder silent; with `leadWrites` the lead breaks its prompt and Writes
   *  sections/faq/index.html during the change stage, and that file lands. */
  const layersAfter = async (leadWrites) => {
    const d = await firstBuild('MOCK_SECTIONS=2');
    const faq = join(sectionDir(d.id, 'faq'), 'index.html');
    const html = '<section data-section="faq"><div><div><p>Lead</p></div></div></section>';
    const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true, deps: {
      runClaude: (o) => {
        if (inSection(o, 'faq')) return Promise.resolve({ text: '', exitCode: 0 });
        if (leadWrites && o.maxTurns === 20) {
          const ti = (phase, extra = {}) => o.onEvent({ type: 'toolInput', phase, parentId: null, messageId: 'm1', index: 0, toolUseId: 't1', name: 'Write', ...extra });
          ti('start');
          ti('delta', { partialJson: JSON.stringify({ file_path: faq, content: html }) });
          ti('stop');
          mkdirSync(sectionDir(d.id, 'faq'), { recursive: true });
          writeFileSync(faq, html);
          o.onEvent({ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: 't1', isError: false, text: 'ok', content: 'ok' }] });
        }
        return mockRun(o);
      },
    } });
    assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
    assert.equal(existsSync(faq), false);
    return getBuild(build.id).layers;
  };
  assert.equal(await layersAfter(true), await layersAfter(false));
});

const LOCKED_SKIP = { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: a read-only folder stands in for EBUSY' : false };

/** A removal round that could not remove `features` (its folder locked then, unlocked since), then a round that adds a
 *  section of the same id and pauses right after its change stage, then the Stop the 409 asks for: the add never built,
 *  and its folder still holds the removed section's files. */
async function readdedNeverBuilt() {
  const d = await firstBuild('MOCK_SECTIONS=2 MOCK_SHELL_SLOTS');
  const features = sectionDir(d.id, 'features');
  writeFileSync(join(features, 'script.js'), 'window.STALE_FEATURES = 1;\n');
  const error = console.error;
  console.error = () => {};
  chmodSync(features, 0o555);
  try {
    const removal = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_REMOVE=features', sections: [], needsLead: true });
    assert.deepEqual(await removal.build.run(), { status: 'done', reason: null });
  } finally {
    chmodSync(features, 0o755);
    console.error = error;
  }
  let drain = () => {};
  const add = newBuild(getDesign(d.id), { kind: 'change', brief: 'MOCK_ROUND_ADD=features:hero', sections: [], needsLead: true, deps: {
    runClaude: async (o) => { const r = await mockRun(o); if (o.maxTurns === 20) drain(); return r; },
  } });
  drain = () => add.build.pauseForDrain();
  assert.deepEqual(await add.build.run(), { status: 'paused', reason: 'drain' });
  assert.deepEqual(planIds(d.id), ['hero', 'features'], 'the round is applied');
  assert.deepEqual(add.calls.map((o) => o.maxTurns), [20], 'no builder ran');
  assert.deepEqual(await again(add.build.id).b.stop('user'), { status: 'stopped', reason: 'user' });
  assert.ok(existsSync(join(features, 'script.js')), 'the removed section\'s files are still there');
  assert.equal(getBuild(add.build.id).layers, countLayers(readFileSync(join(sectionDir(d.id, 'hero'), 'index.html'), 'utf8')),
    'the leftover index.html counts no layers, rehydrated or not');
  return { d, features, addId: add.build.id };
}

test('M5: an add whose round ended before its first build: the next round clears its folder before it starts', LOCKED_SKIP, async () => {
  const { d, features } = await readdedNeverBuilt();
  const { build, frames } = newBuild(getDesign(d.id), { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false });
  assert.equal(existsSync(features), false, 'cleared before the round starts');
  assert.deepEqual(await build.run(), { status: 'done', reason: 'partial' }, 'done but for the carried, never-built features');
  assert.doesNotMatch(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /STALE_FEATURES/, 'no removed section\'s files in dist');
  assert.equal(getBuild(build.id).layers, countLayers(readFileSync(join(sectionDir(d.id, 'hero'), 'index.html'), 'utf8')),
    'the old index.html never counts');
  assert.equal(getBuild(build.id).sections.find((s) => s.id === 'features').unbuiltAdd, true, 'the row still marks an add with no build');
  for (const f of frames) assert.equal(JSON.stringify(f).includes('unbuiltAdd'), false, `${f.type} carries no unbuiltAdd`);
  const snap = again(build.id).b.snapshot();
  for (const s of [...snap.sections, ...snap.plan.sections]) assert.equal(Object.hasOwn(s, 'unbuiltAdd'), false);
  assert.equal(readFileSync(crewFile(d.id), 'utf8').includes('unbuiltAdd'), false);
});

test('M5: a round that names a never-built add starts it from an empty folder: a builder that writes nothing fails it', LOCKED_SKIP, async () => {
  const { d, features } = await readdedNeverBuilt();
  const { build, frames } = newBuild(getDesign(d.id), { kind: 'change', brief: 'Bolder', sections: ['features'], needsLead: false, deps: {
    runClaude: (o) => (inSection(o, 'features') ? Promise.resolve({ text: '', exitCode: 0 }) : mockRun(o)),
  } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
  assert.equal(getBuild(build.id).sections.find((s) => s.id === 'features').status, 'failed');
  assert.equal(listAgents(build.id).find((a) => a.sectionId === 'features').error, 'sections/features/index.html was not written');
  assert.equal(framesOf(frames, 'design-file').some((f) => f.path.startsWith('sections/features/')), false, 'no stale base lands');
  assert.equal(existsSync(join(features, 'script.js')), false);
});

test('M5: a never-built add\'s folder that cannot be cleared refuses the next round before its row', LOCKED_SKIP, async () => {
  const { d, features, addId } = await readdedNeverBuilt();
  chmodSync(features, 0o555);
  try {
    assert.throws(() => newBuild(getDesign(d.id), { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false }),
      { name: 'DesignRefusal', status: 409, message: /sections\/features/ });
    assert.equal(latestBuild(d.id).id, addId, 'no row');
    assert.ok(existsSync(join(features, 'script.js')));
  } finally {
    chmodSync(features, 0o755);
  }
  const { build } = newBuild(getDesign(d.id), { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false });
  assert.deepEqual(await build.run(), { status: 'done', reason: 'partial' });
  assert.equal(existsSync(features), false);
  assert.doesNotMatch(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /STALE_FEATURES/);
});

test('M5: a first build after a never-built add clears its folder before its row too, or is refused', LOCKED_SKIP, async () => {
  const { d, features, addId } = await readdedNeverBuilt();
  chmodSync(features, 0o555);
  try {
    assert.throws(() => newBuild(getDesign(d.id), { brief: 'MOCK_SECTIONS=2 MOCK_SHELL_SLOTS' }),
      { name: 'DesignRefusal', status: 409, message: /sections\/features/ });
    assert.equal(latestBuild(d.id).id, addId, 'no row');
  } finally {
    chmodSync(features, 0o755);
  }
  const { build } = newBuild(getDesign(d.id), { brief: 'MOCK_SECTIONS=2 MOCK_SHELL_SLOTS' });
  assert.equal(existsSync(features), false, 'cleared before the build starts: its records carry no unbuiltAdd');
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.doesNotMatch(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /STALE_FEATURES/);
});

test('M5: an add whose builder row exists builds in its folder, and its build is never cleared later', LOCKED_SKIP, async () => {
  const { d, features, addId } = await readdedNeverBuilt();
  // A crash between the builder row and the record write: the folder was cleared and made again, the row exists, and
  // the record still carries unbuiltAdd.
  rmSync(features, { recursive: true });
  mkdirSync(features);
  const { model, effort } = listAgents(addId).find((a) => a.role === 'lead');
  createAgent({ buildId: addId, role: 'builder', sectionId: 'features', job: 'Features', engine: 'claude', model, effort });
  let cwdThere = null;
  const c = again(addId, { runClaude: (o) => { if (inSection(o, 'features')) cwdThere = existsSync(o.cwd); return mockRun(o); } });
  assert.deepEqual(await c.b.continue(), { status: 'done', reason: null });
  assert.equal(cwdThere, true, 'the builder row\'s folder is not cleared under it: a real CLI cannot start in a missing cwd');
  assert.equal(listAgents(addId).filter((a) => a.sectionId === 'features').length, 1, 'the same builder row');
  assert.equal(Object.hasOwn(getBuild(addId).sections.find((s) => s.id === 'features'), 'unbuiltAdd'), false);
  const built = readFileSync(join(features, 'index.html'), 'utf8');
  const { build } = newBuild(getDesign(d.id), { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false });
  assert.equal(readFileSync(join(features, 'index.html'), 'utf8'), built, 'a built add is never cleared');
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
});

test('a pause during the change stage re-runs it on Continue', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  let spawned = false;
  const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true, deps: {
    runClaude: (o) => { if (o.maxTurns !== 20) return mockRun(o); spawned = true; return hangUntilAbort(o); },
  } });
  const p = build.run();
  await waitUntil(() => spawned);
  assert.equal(build.pauseForDrain(), true);
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  assert.deepEqual(planIds(d.id), ['hero', 'features'], 'nothing applied yet');
  const c = again(build.id);
  assert.equal(c.b.snapshot().plan.planRev, 1);
  const run = c.b.continue();
  assert.equal(c.frames[0].status, 'planning', 'the lead stage re-enters');
  assert.deepEqual(await run, { status: 'done', reason: null });
  assert.equal(c.calls[0].maxTurns, 20);
  assert.match(c.calls[0].prompt, /^Change round: MOCK_ROUND_ADD=faq:hero/);
  assert.deepEqual(planIds(d.id), ['hero', 'faq', 'features']);
  assert.equal(listAgents(build.id).filter((a) => a.role === 'lead').length, 1, 'the lead once (L2.1)');
});

test('a lead that wrote integration.json in an unapplied change stage still continues', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  let spawned = false;
  const { build } = newBuild(d, { kind: 'change', brief: 'Warmer', sections: [], needsLead: true, deps: {
    runClaude: (o) => {
      if (o.maxTurns !== 20) return mockRun(o);
      writeFileSync(join(designWorkDir(d.id), 'integration.json'), '{"v":1,"rework":[]}');
      spawned = true;
      return hangUntilAbort(o);
    },
  } });
  const p = build.run();
  await waitUntil(() => spawned);
  build.pauseForDrain();
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  const c = again(build.id);
  assert.deepEqual(await c.b.continue(), { status: 'done', reason: null }, 'the change stage is still owed');
  assert.equal(c.calls[0].maxTurns, 20);
});

test('integrate may send back a section with no agent in this round: a new builder, a change of this round', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  let integrated = false;
  let blocked = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { build, calls } = newBuild(d, { kind: 'change', brief: 'Warmer colours', sections: [], needsLead: true, deps: {
    acquireGlobal: async () => { if (integrated) { blocked = true; await gate; } },
    runClaude: async (o) => {
      if (o.maxTurns !== 15 || isBuilder(o)) return mockRun(o);
      writeFileSync(join(designWorkDir(d.id), 'integration.json'), JSON.stringify({ v: 1, rework: [{ id: 'features', why: 'Align the grid' }] }));
      integrated = true;
      return { text: 'Integrated.', exitCode: 0 };
    },
  } });
  const p = build.run();
  await waitUntil(() => blocked);
  assert.deepEqual(getBuild(build.id).sections.find((s) => s.id === 'features').todo, { stage: 'change', brief: 'Align the grid' },
    'in the row before its builder starts, so a restart there rehydrates it as a change of this round');
  release();
  assert.deepEqual(await p, { status: 'done', reason: null });
  const rework = calls.at(-1);
  assert.ok(inSection(rework, 'features'));
  assert.equal(rework.maxTurns, 15, 'stage change');
  assert.equal(rework.resumeSessionId, undefined);
  assert.match(rework.prompt, /^Change: Warmer colours/);
  assert.match(rework.prompt, /^For this section: Align the grid$/m);
  assert.deepEqual(getBuild(build.id).sections.find((s) => s.id === 'features').todo, { stage: 'change', brief: 'Align the grid' });
  assert.deepEqual(listAgents(build.id).map((a) => [a.role, a.sectionId]), [['lead', null], ['builder', 'hero'], ['builder', 'features']]);
  assert.match(readFileSync(join(distDir(d.id), 'index.html'), 'utf8'), /Changed features\./);
});

test('a lead-less change fails over to its own section only', async () => {
  const d = await firstBuild();
  const { build } = newBuild(d, { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false, deps: {
    runClaude: (o) => (inSection(o, 'hero') ? hangUntilAbort(o) : mockRun(o)),
  } });
  const p = build.run();
  await waitUntil(() => listAgents(build.id).some((a) => a.sectionId === 'hero'));
  assert.equal(build.stopAgent(listAgents(build.id).find((a) => a.sectionId === 'hero').id), true);
  assert.deepEqual(await p, { status: 'done', reason: 'partial' });
  assert.deepEqual(getBuild(build.id).sections.map((s) => [s.id, s.status]), [['hero', 'stopped'], ['features', 'done'], ['pricing', 'done']]);
  assert.equal(listAgents(build.id).length, 1);
});

test('a todo belongs to one round', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  let failed = false;
  const r2 = newBuild(d, { kind: 'change', brief: 'Bolder', sections: ['hero'], needsLead: false, deps: {
    runClaude: (o) => { if (!failed && inSection(o, 'hero')) { failed = true; return Promise.reject(new Error('claude exited with code 1: boom')); } return mockRun(o); },
  } });
  assert.deepEqual(await r2.build.run(), { status: 'paused', reason: 'failed' });
  assert.deepEqual(await r2.build.stop(), { status: 'stopped', reason: 'user' });
  const r3 = newBuild(d, { kind: 'change', brief: 'Calmer', sections: ['features'], needsLead: false });
  assert.deepEqual(await r3.build.run(), { status: 'done', reason: 'partial' }, 'not paused on a section this round never chose');
  const hero = getBuild(r3.build.id).sections.find((s) => s.id === 'hero');
  assert.equal(hero.status, 'failed', 'carried');
  assert.equal(Object.hasOwn(hero, 'todo'), false);
  assert.deepEqual(r3.calls.map((o) => o.cwd.split(sep).at(-1)), ['features']);
  const c = again(r3.build.id);
  assert.throws(() => c.b.continue(), { status: 409 });
  assert.throws(() => c.b.continue({ sections: ['hero'] }), { status: 422 }, 'only sections with a todo');
});

test('Continue after a pause during integrate does not re-run the change stage', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  let integrating = false;
  const { build } = newBuild(d, { kind: 'change', brief: 'MOCK_ROUND_ADD=faq:hero', sections: [], needsLead: true, deps: {
    runClaude: (o) => { if (o.maxTurns !== 15 || isBuilder(o)) return mockRun(o); integrating = true; return hangUntilAbort(o); },
  } });
  const p = build.run();
  await waitUntil(() => integrating);
  assert.equal(build.pauseForDrain(), true);
  assert.deepEqual(await p, { status: 'paused', reason: 'drain' });
  const c = again(build.id);
  assert.deepEqual(await c.b.continue(), { status: 'done', reason: null });
  assert.equal(c.calls.some((o) => o.maxTurns === 20), false);
  assert.deepEqual(c.calls.map((o) => [isBuilder(o), o.maxTurns]), [[false, 15]], 'integrate only');
  assert.deepEqual(planIds(d.id), ['hero', 'faq', 'features'], 'faq once');
});

test('every selected section lands its base before the first spawn ends', async () => {
  const d = await firstBuild('MOCK_SECTIONS=2');
  let seen = null;
  const out = newBuild(d, { kind: 'change', brief: 'Bolder', sections: ['hero', 'features'], needsLead: false, deps: {
    maxBuildersFor: () => 1,
    runClaude: async (o) => {
      if (seen === null && inSection(o, 'hero')) {
        seen = out.frames.some((f) => f.type === 'design-file' && f.path === 'sections/features/index.html' && /Mock features\./.test(f.text ?? ''));
      }
      return mockRun(o);
    },
  } });
  assert.deepEqual(await out.build.run(), { status: 'done', reason: null });
  assert.equal(seen, true);
  assert.deepEqual(out.calls.map((o) => o.cwd.split(sep).at(-1)), ['hero', 'features'], 'plan order under the cap');
});
