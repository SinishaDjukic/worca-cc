// test/design-build-crew.test.mjs — Design P2 Task 11: builders in plan order, the failed-section pause, the integrate
// pass with its one rework cycle, assembly, the end stats and snapshot().
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { framesOf, newBuild, newDesign, recordMockBuild, useDesignEnv, waitForFrame, waitUntil } from './helpers/design-fixture.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { crewFile, designDir, designWorkDir, distDir, sectionDir } from '../src/core/design/paths.mjs';
import { getBuild, listAgents } from '../src/core/design/store.mjs';

useDesignEnv(after);

const mockRun = (o) => runClaude({ ...o, mock: true });
const isSection = (o) => o.cwd.includes('sections');

test('a full round: lead, builders in plan order, integrate, dist, end stats', async () => {
  const d = newDesign(); const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=3' });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(calls.map((c) => c.cwd.split(sep).at(-1)), ['work', 'hero', 'features', 'pricing', 'work']);
  assert.equal(calls.at(-1).resumeSessionId, listAgents(build.id).find((a) => a.role === 'lead').sessionId);
  assert.equal(calls.at(-1).maxTurns, 15);
  assert.deepEqual([...new Set(framesOf(frames, 'design-build').map((f) => f.status))], ['planning', 'building', 'integrating', 'done']);
  const end = framesOf(frames, 'design-build').at(-1).stats;
  assert.deepEqual([end.agentsNow, end.agentsTotal, end.sectionsDone, end.sectionsPlanned, end.failed, end.layers], [0, 4, 3, 3, 0, 15]);
  assert.deepEqual(Object.keys(end).sort(), ['agentsNow', 'agentsTotal', 'costKnown', 'costUsd', 'elapsedMs', 'estimatedUsd', 'failed', 'layers', 'sectionsDone', 'sectionsPlanned'], 'M13: stats carry no Design limit');
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['done', 'done', 'done']);
  assert.equal(getBuild(build.id).layers, 15);
  assert.equal(getBuild(build.id).agentsTotal, 4);
});

test('M6: the lead never runs beside builders; the count is processes now; the lead counts once', async () => {
  let lead = 0; let builders = 0; let peak = 0;
  const d = newDesign({ fast: true });
  let overlap = false;
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=16', deps: { runClaude: async (o) => {
    const isLead = !o.cwd.includes('sections');
    if (isLead) lead++; else builders++;
    if (lead && builders) overlap = true;
    peak = Math.max(peak, builders);
    try { await new Promise((r) => setTimeout(r, 3)); return await runClaude({ ...o, mock: true }); } finally { if (isLead) lead--; else builders--; }
  } } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(overlap, false, 'lead and builders at once (an assert inside runClaude would only fail a section)');
  assert.equal(peak, 12);
  assert.ok(framesOf(frames, 'design-build').every((f) => f.stats.agentsNow <= 12));
  assert.equal(framesOf(frames, 'design-build').at(-1).stats.agentsTotal, 17, '1 + 16 sections');
});

test('M5: exactly one agent row per section, however often it runs', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_RATE_LIMIT_SECTION=hero MOCK_REWORK=hero' });
  await build.run();
  const rows = listAgents(build.id).filter((a) => a.role === 'builder');
  assert.deepEqual(rows.map((a) => a.sectionId).sort(), ['features', 'hero']);
});

test('section frames: writing then done with the summary line and its agent', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1' });
  await build.run();
  const s = framesOf(frames, 'design-section').filter((f) => f.sectionId === 'hero');
  assert.deepEqual(s.map((f) => f.status), ['writing', 'done']);
  assert.equal(s[1].summary, 'Built hero.');
  assert.match(s[1].agentId, /^a_[0-9a-f]{8}$/);
});

test('M10: the folder exists before the spawn, paths are absolute, .crew.json tracks statuses', async () => {
  const d = newDesign(); const seen = [];
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=2', deps: { maxBuildersFor: () => 1, runClaude: (o) => {
    if (o.cwd.includes('sections')) seen.push([existsSync(o.cwd), isAbsolute(o.cwd), o.writeGuard.allowedDirs.every(isAbsolute), JSON.parse(readFileSync(crewFile(d.id), 'utf8')).map((c) => c.status)]);
    return runClaude({ ...o, mock: true });
  } } });
  await build.run();
  assert.deepEqual(seen, [[true, true, true, ['writing', 'planned']], [true, true, true, ['done', 'writing']]]);
  assert.deepEqual(JSON.parse(readFileSync(crewFile(d.id), 'utf8')), [{ id: 'hero', status: 'done', summary: 'Built hero.' }, { id: 'features', status: 'done', summary: 'Built features.' }]);
});

test('.crew.json is replaced whole at every change, and a write that fails never stops the round', async () => {
  // Temp file plus rename: a hard link taken at hero's spawn keeps the file it saw; an in-place write would change it.
  const d = newDesign(); const held = join(designDir(d.id), 'crew-at-hero.json');
  const { build } = newBuild(d, { brief: 'MOCK_SECTIONS=2', deps: { maxBuildersFor: () => 1, runClaude: (o) => {
    if (o.cwd.endsWith(`${sep}hero`)) linkSync(crewFile(d.id), held);
    return mockRun(o);
  } } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(JSON.parse(readFileSync(held, 'utf8')).map((c) => c.status), ['writing', 'planned']);
  assert.deepEqual(JSON.parse(readFileSync(crewFile(d.id), 'utf8')).map((c) => c.status), ['done', 'done']);
  // A rename that throws (EPERM or EBUSY on Windows while a builder reads the file): here .crew.json is a folder.
  const e = newDesign();
  mkdirSync(join(crewFile(e.id), 'x'), { recursive: true });
  const blocked = newBuild(e, { brief: 'MOCK_SECTIONS=2' });
  assert.deepEqual(await blocked.build.run(), { status: 'done', reason: null });
  assert.deepEqual(getBuild(blocked.build.id).sections.map((x) => x.status), ['done', 'done']);
});

test('never more than the cap at once, and the queue is plan order', async () => {
  let now = 0; let peak = 0; const order = [];
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=5', deps: { maxBuildersFor: () => 2, runClaude: async (o) => { if (o.cwd.includes('sections')) { order.push(o.cwd.split(sep).at(-1)); now++; peak = Math.max(peak, now); } try { await new Promise((r) => setTimeout(r, 5)); return await runClaude({ ...o, mock: true }); } finally { if (o.cwd.includes('sections')) now--; } } } });
  await build.run();
  assert.equal(peak, 2);
  assert.deepEqual(order.slice(0, 5), ['hero', 'features', 'pricing', 'faq', 'team']);
});

test('spawns are staggered', async () => {
  const at = [];
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=3', deps: { staggerMs: 40, runClaude: (o) => { if (o.cwd.includes('sections')) at.push(Date.now()); return runClaude({ ...o, mock: true }); } } });
  await build.run();
  assert.ok(at[1] - at[0] >= 35 && at[2] - at[1] >= 35);
});

test('M7: setFast raises the cap for the next spawn and never kills', async () => {
  let open; const gate = new Promise((r) => { open = r; });
  const running = new Set(); const aborted = [];
  const { build, frames } = newBuild(newDesign({ fast: false }), { brief: 'MOCK_SECTIONS=6', deps: { maxBuildersFor: (f) => (f ? 5 : 2), runClaude: async (o) => {
    if (o.cwd.includes('sections')) { running.add(o.cwd); o.signal.addEventListener('abort', () => aborted.push(o.cwd)); await gate; }
    return runClaude({ ...o, mock: true });
  } } });
  const p = build.run();
  await waitUntil(() => running.size === 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(running.size, 2);
  build.setFast(true);
  await waitUntil(() => running.size === 5);
  build.setFast(false);
  assert.deepEqual(aborted, []);
  open();
  assert.deepEqual(await p, { status: 'done', reason: null });
  assert.equal(framesOf(frames, 'design-plan').length, 1, 'planned sections stay planned');
  assert.equal(getBuild(build.id).sections.length, 6);
});

test('M8: one failed section leaves the rest; nothing running, then paused, failed, integration not run', async () => {
  const d = newDesign(); const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=3 MOCK_FAIL_SECTION=features' });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['done', 'failed', 'done']);
  assert.equal(calls.filter((c) => c.maxTurns === 15).length, 0);
  assert.equal(existsSync(join(distDir(d.id), 'index.html')), false);
  const end = framesOf(frames, 'design-build').at(-1);
  assert.deepEqual([end.status, end.reason, end.stats.failed, end.stats.agentsNow], ['paused', 'failed', 1, 0]);
  assert.equal(framesOf(frames, 'design-agent').filter((f) => f.sectionId === 'features').at(-1).status, 'error');
});

test('every section failed is the same pause', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero' });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
});

test('a section with no index.html is failed, though the process exited 0', async () => {
  // hero's builder leaves an empty index.html, features' writes nothing; both processes resolve as a success.
  const { build, frames, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: { runClaude: async (o) => {
    if (!isSection(o)) return mockRun(o);
    if (o.cwd.endsWith('hero')) writeFileSync(join(o.cwd, 'index.html'), '');
    return { text: 'Done.', exitCode: 0 };
  } } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'failed' });
  assert.deepEqual(getBuild(build.id).sections.map((s) => s.status), ['failed', 'failed']);
  assert.equal(calls.filter((c) => c.maxTurns === 15).length, 0, 'no integrate');
  for (const id of ['hero', 'features']) {
    const last = framesOf(frames, 'design-agent').filter((f) => f.sectionId === id).at(-1);
    assert.equal(last.status, 'error', id);
    assert.match(last.error, /index\.html/, id);
  }
  assert.equal(framesOf(frames, 'design-build').at(-1).stats.failed, 2);
});

test('a transient rate limit resumes that agent once', async () => {
  const { build, calls, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_RATE_LIMIT_SECTION=hero' });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(calls.filter((c) => c.cwd.endsWith('hero')).length, 2);
  assert.ok(calls.filter((c) => c.cwd.endsWith('hero'))[1].resumeSessionId);
  assert.equal(framesOf(frames, 'design-section').filter((f) => f.sectionId === 'hero').at(-1).status, 'done');
});

test('M6: an agent waiting out a retry is not a process now', async () => {
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_RATE_LIMIT_SECTION=hero', deps: { retryDelayMs: 300 } });
  const p = build.run();
  await waitUntil(() => build.snapshot().agents.some((a) => a.sectionId === 'hero' && a.status === 'retrying'));
  assert.equal(build.runningCount, 0);
  assert.equal(build.snapshot().build.stats.agentsNow, 0, 'its process has ended');
  assert.deepEqual(await p, { status: 'done', reason: null });
});

test('L2.28: a builder waiting out a retry keeps its build slot', async () => {
  const order = [];
  const { build } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_RATE_LIMIT_SECTION=hero', deps: { maxBuildersFor: () => 1, retryDelayMs: 50, runClaude: (o) => {
    if (isSection(o)) order.push(o.cwd.split(sep).at(-1));
    return mockRun(o);
  } } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.deepEqual(order, ['hero', 'hero', 'features'], 'features never starts while hero waits');
});

test('a usage limit pauses the whole build and keeps finished sections', async () => {
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=3 MOCK_USAGE_LIMIT_SECTION=features', deps: { maxBuildersFor: () => 1 } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'usage_limit' });
  assert.equal(calls.some((c) => c.cwd.endsWith('pricing')), false, 'nothing more spawns');
  assert.deepEqual(getBuild(build.id).sections.map((x) => x.status), ['done', 'stopped', 'planned']);
});

test('M10: rework is read from rework, not done: one Edit on that section, one cycle only', async () => {
  const { build, calls, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_REWORK=hero' });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const hero = calls.filter((c) => c.cwd.endsWith('hero'));
  assert.equal(hero.length, 2, 'integration.json said done:true with a non-empty rework');
  assert.match(hero[1].prompt, /^Rework: /);
  assert.equal(calls.filter((c) => c.maxTurns === 15).length, 1, 'no second integrate');
  assert.ok(framesOf(frames, 'design-delta').some((f) => f.sectionId === 'hero' && f.splice.del > 0), 'R17: the Edit draws as a deleting splice');
});

/** An integrate pass that only writes `text` to integration.json; every other process is the mock. */
const integrateWrites = (d, text) => async (o) => {
  if (o.maxTurns !== 15) return mockRun(o);
  writeFileSync(join(designWorkDir(d.id), 'integration.json'), text);
  return { text: 'Integrated.', exitCode: 0 };
};

test('done:false with an empty rework runs no cycle and does not loop', async () => {
  const d = newDesign();
  const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2', deps: { runClaude: integrateWrites(d, '{"v":1,"done":false,"rework":[]}') } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(calls.filter((c) => c.maxTurns === 15).length, 1, 'one integrate');
  assert.equal(calls.filter(isSection).length, 2, 'no rework');
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
});

test('an invalid integration.json does not fail the round', async () => {
  const d = newDesign();
  const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { runClaude: integrateWrites(d, '{') } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
  assert.equal(calls.filter(isSection).length, 1);
  // A file naming one real section and one unknown is invalid as a whole: nothing goes back, not even hero.
  const e = newDesign();
  const mixed = newBuild(e, { brief: 'MOCK_SECTIONS=2', deps: { runClaude: integrateWrites(e, '{"v":1,"rework":[{"id":"hero","why":"x"},{"id":"nope","why":"y"}]}') } });
  assert.deepEqual(await mixed.build.run(), { status: 'done', reason: null });
  assert.equal(mixed.calls.filter(isSection).length, 2, 'an invalid file is an empty rework');
});

test('a Write refused by the CLI still ends right: the draft rolls back, the retry lands', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_TOOL_ERROR_SECTION=hero' });
  await build.run();
  const files = framesOf(frames, 'design-file').filter((f) => f.path === 'sections/hero/index.html');
  assert.equal(files[0].bytes, 0);
  assert.match(files.at(-1).text, /^<section/);
});

test('M10: snapshotVersion runs after dist and before the terminal frame, once', async () => {
  const d = newDesign(); const order = [];
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { snapshotVersion: async ({ designId }) => {
    order.push([designId, existsSync(join(distDir(d.id), 'index.html')), frames.some((f) => f.type === 'design-build' && f.status === 'done')]);
  } } });
  await build.run();
  assert.deepEqual(order, [[d.id, true, false]]);
  assert.equal(framesOf(frames, 'design-build').filter((f) => f.status === 'done').length, 1);
  assert.equal(framesOf(frames, 'design-build').at(-1).status, 'done');
});

test('a failing snapshot does not stop the round; a paused round takes no snapshot', async () => {
  const a = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { snapshotVersion: async () => { throw new Error('disk full'); } } });
  assert.equal((await a.build.run()).status, 'done');
  let calls = 0;
  const b = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_FAIL_SECTION=hero', deps: { snapshotVersion: async () => { calls++; } } });
  await b.build.run();
  assert.equal(calls, 0);
});

test('rev never skips within a path across deltas and files', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_REWORK=hero' });
  await build.run();
  const byPath = new Map();
  for (const f of frames) if (f.type === 'design-delta' || f.type === 'design-file') {
    const last = byPath.get(f.path) ?? 0; assert.equal(f.rev, last + 1, f.path); byPath.set(f.path, f.rev);
  }
});

test('deltas respect 16 KiB and are never written anywhere', async () => {
  // hero's builder streams one Write of about 40 KB as a single tool-input chunk, then the file lands.
  const big = `<section data-section="hero">${'x'.repeat(40000)}</section>`;
  const d = newDesign();
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { runClaude: async (o) => {
    if (!isSection(o)) return mockRun(o);
    const file = join(o.cwd, 'index.html');
    const ti = (phase, extra = {}) => o.onEvent({ type: 'toolInput', phase, parentId: null, messageId: 'm1', index: 0, toolUseId: 't1', name: 'Write', ...extra });
    ti('start');
    ti('delta', { partialJson: JSON.stringify({ file_path: file, content: big }) });
    ti('stop');
    writeFileSync(file, big);
    o.onEvent({ type: 'toolResult', parentId: null, meta: null, results: [{ toolUseId: 't1', isError: false, text: 'ok', content: 'ok' }] });
    return { text: 'Built hero.', exitCode: 0 };
  } } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const deltas = framesOf(frames, 'design-delta');
  for (const f of deltas) assert.ok(Buffer.byteLength(f.splice.text) <= 16384, `${f.path}: ${Buffer.byteLength(f.splice.text)} bytes`);
  const hero = deltas.filter((f) => f.path === 'sections/hero/index.html');
  assert.ok(hero.length >= 3, `the Write goes out in frames of at most 16 KiB (${hero.length})`);
  assert.equal(hero.map((f) => f.splice.text).join(''), big);
  for (const rel of readdirSync(designDir(d.id), { recursive: true })) {
    const p = join(designDir(d.id), String(rel));
    if (statSync(p).isFile()) assert.equal(readFileSync(p, 'utf8').includes('design-delta'), false, String(rel));
  }
});

test('snapshot() has the C-5 shape, and seq does not advance', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1 MOCK_HANG_SECTION=hero' });
  const p = build.run();
  await waitForFrame(frames, (f) => f.type === 'design-delta' && f.sectionId === 'hero');
  const s = build.snapshot();
  assert.equal(s.type, 'design-snapshot');
  assert.deepEqual(Object.keys(s).sort(), ['agents', 'build', 'buildId', 'designId', 'drafts', 'plan', 'questions', 'sections', 'seq', 'ts', 'type'].sort());
  assert.equal(s.build.status, 'building');
  assert.deepEqual(s.sections.map((x) => [x.id, x.job, x.status]), [['hero', 'Hero', 'writing']], 'section records keyed id, as P4 reads them');
  assert.deepEqual([s.plan.planRev, s.plan.canvas], [1, { w: 1440 }]);
  assert.ok(s.drafts.find((x) => x.path === 'sections/hero/index.html').text.startsWith('<section'));
  const before = frames.at(-1).seq;
  assert.ok(s.seq <= before);
  await build.stop('user'); await p;
});

test('snapshot(): build and agents carry their frames\' fields, plan and sections the records; no drafts once terminal', async () => {
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_BANDS' });
  await build.run();
  const s = build.snapshot();
  const common = new Set(['type', 'designId', 'buildId', 'seq', 'ts']);
  const fieldsOf = (f) => Object.keys(f).filter((k) => !common.has(k)).sort();
  assert.deepEqual(Object.keys(s.build).sort(), fieldsOf(framesOf(frames, 'design-build').at(-1)));
  assert.deepEqual([s.build.status, s.build.reason, s.build.stats.sectionsDone], ['done', null, 2]);
  assert.deepEqual(s.agents.map((a) => [a.role, a.sectionId, a.status]), [['lead', null, 'done'], ['builder', 'hero', 'done'], ['builder', 'features', 'done']]);
  for (const a of s.agents) assert.deepEqual(Object.keys(a).sort(), fieldsOf(framesOf(frames, 'design-agent').find((f) => f.agentId === a.agentId)));
  assert.deepEqual(Object.keys(s.plan).sort(), ['canvas', 'planRev', 'sections']);
  assert.deepEqual(s.plan.sections.map((x) => [x.id, x.status, x.band]), [['hero', 'done', 'Top'], ['features', 'done', 'Top']]);
  assert.deepEqual(s.sections, getBuild(build.id).sections);
  assert.deepEqual(s.questions, []);
  assert.deepEqual(s.drafts, [], 'no drafts once terminal');
  assert.equal(s.seq, frames.at(-1).seq);
});

test('the build row follows the stage and every section change; the build frames carry the counts', async () => {
  let id = null; const seen = [];
  const { build, frames } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2', deps: { maxBuildersFor: () => 1, runClaude: (o) => {
    const row = getBuild(id);
    seen.push([o.cwd.split(sep).at(-1), row.status, row.sections.map((s) => s.status).join(',')]);
    return mockRun(o);
  } } });
  id = build.id;
  await build.run();
  assert.deepEqual(seen, [
    ['work', 'planning', ''],
    ['hero', 'building', 'writing,planned'],
    ['features', 'building', 'done,writing'],
    ['work', 'integrating', 'done,done'],
  ]);
  const building = framesOf(frames, 'design-build').filter((f) => f.status === 'building');
  assert.equal(building.at(-1).stats.sectionsDone, 2, 'the last building frame already counts the last section');
});

test('every spawn takes the global slot once and frees it once, retries included', async () => {
  const slot = { taken: 0, freed: 0 };
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_RATE_LIMIT_SECTION=hero', deps: {
    acquireGlobal: async () => { slot.taken += 1; },
    releaseGlobal: () => { slot.freed += 1; },
  } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  assert.equal(calls.length, 5, 'lead, hero twice, features, integrate');
  assert.deepEqual(slot, { taken: 5, freed: 5 });
});

test('M8: a builder whose folder cannot be made gives its machine slot back', async () => {
  const slot = { taken: 0, freed: 0 };
  const d = newDesign();
  const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: {
    acquireGlobal: async () => {
      slot.taken += 1;
      // The builder's slot: its section folder becomes a file, so mkdirSync throws in _newBuilder.
      if (slot.taken === 2) { rmSync(sectionDir(d.id, 'hero'), { recursive: true, force: true }); writeFileSync(sectionDir(d.id, 'hero'), ''); }
    },
    releaseGlobal: () => { slot.freed += 1; },
  } });
  const error = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await build.run(), { status: 'error', reason: 'engine-error' });
  } finally {
    console.error = error;
  }
  assert.equal(calls.length, 1, 'the lead only');
  assert.deepEqual(slot, { taken: 2, freed: 2 });
  assert.deepEqual(listAgents(build.id).map((a) => a.role), ['lead'], 'no builder row');
});

test('a halt while a section waits out the stagger leaves it planned, with no row and no spawn', async () => {
  const d = newDesign();
  const { build, frames, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_USAGE_LIMIT_SECTION=hero', deps: { staggerMs: 300 } });
  assert.deepEqual(await build.run(), { status: 'paused', reason: 'usage_limit' });
  assert.equal(calls.some((c) => c.cwd.endsWith('features')), false);
  assert.deepEqual(getBuild(build.id).sections.map((s) => [s.status, s.agentId === null]), [['stopped', false], ['planned', true]]);
  assert.deepEqual(listAgents(build.id).map((a) => a.role), ['lead', 'builder']);
  assert.deepEqual(JSON.parse(readFileSync(crewFile(d.id), 'utf8')).map((c) => c.status), ['stopped', 'planned'], '.crew.json follows the settle');
  assert.deepEqual(framesOf(frames, 'design-section').map((f) => [f.sectionId, f.status]), [['hero', 'writing'], ['hero', 'stopped']]);
});

test('a failed rework pauses the round as failed; a halt in rework settles on the halt', async () => {
  const reworkRuns = (fail) => (o) => (/^Rework: /.test(o.prompt) ? Promise.reject(fail()) : mockRun(o));
  const d = newDesign(); let snaps = 0;
  const a = newBuild(d, { brief: 'MOCK_SECTIONS=2 MOCK_REWORK=hero', deps: { snapshotVersion: async () => { snaps++; }, runClaude: reworkRuns(() => new Error('rework crashed')) } });
  assert.deepEqual(await a.build.run(), { status: 'paused', reason: 'failed' });
  assert.deepEqual(getBuild(a.build.id).sections.map((s) => s.status), ['failed', 'done']);
  assert.equal(a.calls.filter((c) => c.maxTurns === 15).length, 1, 'no second integrate');
  assert.equal(existsSync(join(distDir(d.id), 'index.html')), false);
  assert.equal(snaps, 0);
  assert.match(a.calls.find((c) => /^Rework: /.test(c.prompt)).prompt, /^Rework: Mock rework$/m, 'the why of integration.json');
  const limit = () => Object.assign(new Error('mock usage limit'), { errorClass: 'usage_limit' });
  const b = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=2 MOCK_REWORK=hero', deps: { runClaude: reworkRuns(limit) } });
  assert.deepEqual(await b.build.run(), { status: 'paused', reason: 'usage_limit' });
  assert.deepEqual(getBuild(b.build.id).sections.map((s) => s.status), ['stopped', 'done']);
  assert.equal(listAgents(b.build.id).find((x) => x.sectionId === 'hero').status, 'stopped', 'the reworking agent was open again, so the settle stops it');
});

test('a builder\'s first prompt names its plan brief, the plan notes and the kit contract; lint findings reach integrate', async () => {
  const d = newDesign();
  const contract = join(designWorkDir(d.id), '.kit', 'CONTRACT.md');
  mkdirSync(dirname(contract), { recursive: true });
  writeFileSync(contract, 'x');
  const { build, calls } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: { runClaude: async (o) => {
    const r = await mockRun(o);
    if (isSection(o)) writeFileSync(join(o.cwd, 'style.css'), '.loose{color:red}\n', { flag: 'a' });
    return r;
  } } });
  assert.deepEqual(await build.run(), { status: 'done', reason: null });
  const plan = JSON.parse(readFileSync(join(designWorkDir(d.id), 'plan.json'), 'utf8'));
  const hero = calls.find(isSection).prompt;
  assert.match(hero, /^Section: hero$/m);
  assert.ok(hero.includes(`\nBrief:\n${plan.sections[0].brief}`), hero);
  assert.ok(hero.includes(`Plan notes: ${plan.notes}`), hero);
  assert.ok(hero.includes(`Kit contract: ${contract}`), hero);
  assert.ok(hero.includes(`Crew status: ${crewFile(d.id)}`), hero);
  const integrate = calls.find((c) => c.maxTurns === 15).prompt;
  assert.match(integrate, /^- \[error\] css-scope \(section hero\) sections\/hero\/style\.css: /m);
});

test('integrate: a lost session starts the lead fresh from the integrate prompt; a failed pass still finishes', async () => {
  let lost = false;
  const a = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=1', deps: { runClaude: (o) => {
    if (o.maxTurns === 15 && !lost) { lost = true; return Promise.reject(new Error('claude exited with code 1: No conversation found with session ID: x')); }
    return mockRun(o);
  } } });
  assert.deepEqual(await a.build.run(), { status: 'done', reason: null });
  const integ = a.calls.filter((c) => c.maxTurns === 15);
  assert.equal(integ.length, 2);
  assert.ok(integ[0].resumeSessionId);
  assert.equal(integ[1].resumeSessionId, undefined);
  assert.equal(integ[1].prompt, integ[0].prompt, 'the fresh lead gets the integrate prompt, never the plan prompt');
  assert.match(integ[1].prompt, /^The builders are done/);

  const d = newDesign();
  const b = newBuild(d, { brief: 'MOCK_SECTIONS=1 MOCK_REWORK=hero', deps: { runClaude: (o) => (o.maxTurns === 15 ? Promise.reject(new Error('lead crashed')) : mockRun(o)) } });
  assert.deepEqual(await b.build.run(), { status: 'done', reason: null }, 'L2.10: integration is a check');
  assert.equal(b.calls.filter(isSection).length, 1, 'no rework without an integration file');
  assert.ok(existsSync(join(distDir(d.id), 'index.html')));
  const leadRow = listAgents(b.build.id).find((x) => x.role === 'lead');
  assert.deepEqual([leadRow.status, leadRow.job], ['error', 'Integrate']);
  assert.match(leadRow.error, /lead crashed/);

  const e = newDesign();
  const limit = () => Promise.reject(Object.assign(new Error('mock usage limit'), { errorClass: 'usage_limit' }));
  const c = newBuild(e, { brief: 'MOCK_SECTIONS=1', deps: { runClaude: (o) => (o.maxTurns === 15 ? limit() : mockRun(o)) } });
  assert.deepEqual(await c.build.run(), { status: 'paused', reason: 'usage_limit' }, 'a halt in integrate wins over the finish');
  assert.equal(existsSync(join(distDir(e.id), 'index.html')), false);
});

test('a shell the assembler refuses ends error, assemble-failed, and takes no snapshot', async () => {
  const d = newDesign(); let snaps = 0;
  const { build, frames } = newBuild(d, { brief: 'MOCK_SECTIONS=1', deps: {
    snapshotVersion: async () => { snaps++; },
    runClaude: async (o) => {
      const r = await mockRun(o);
      if (o.maxTurns === 15) writeFileSync(join(designWorkDir(d.id), 'shell.html'), '<!doctype html><html><head></head><body></body></html>');
      return r;
    },
  } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'assemble-failed' });
  assert.equal(snaps, 0);
  assert.equal(existsSync(join(distDir(d.id), 'index.html')), false);
  assert.deepEqual([frames.at(-1).type, frames.at(-1).status, frames.at(-1).reason], ['design-build', 'error', 'assemble-failed']);
  assert.deepEqual([getBuild(build.id).status, getBuild(build.id).reason], ['error', 'assemble-failed']);
});

test('a throw inside a section loop ends the round error, engine-error, and no process is left running', async () => {
  let n = 0;
  // The hero hangs and the cap of 2 queues the third section, so the throw lands while a process surely runs: the
  // spend gate's await (Task 14) between the global slot and the spawn decides any race of microtasks.
  const { build, calls } = newBuild(newDesign(), { brief: 'MOCK_SECTIONS=3 MOCK_HANG_SECTION=hero', deps: {
    maxBuildersFor: () => 2,
    acquireGlobal: async () => {
      if (++n !== 3) return;
      await waitUntil(() => build.runningCount > 0);
      throw new Error('slot table gone');
    },
  } });
  assert.deepEqual(await build.run(), { status: 'error', reason: 'engine-error' });
  assert.equal(build.runningCount, 0);
  assert.equal(getBuild(build.id).status, 'error');
  const sections = getBuild(build.id).sections.map((s) => s.status);
  assert.equal(sections[1], 'planned', 'features threw before its row');
  assert.equal(sections.includes('done'), false, `the throw aborts the other loops (${sections})`);
  assert.equal(calls.filter(isSection).length >= 1, true);
});

test('recordMockBuild needs no WORCA_MOCK and returns a finished build', async () => {
  const saved = process.env.WORCA_MOCK; delete process.env.WORCA_MOCK;
  try {
    const f = await recordMockBuild();
    assert.equal(f.at(-1).type, 'design-build');
    assert.equal(f.at(-1).status, 'done');
    assert.equal(framesOf(f, 'design-section').filter((x) => x.status === 'done').length, 3);
  } finally { process.env.WORCA_MOCK = saved; }
});

test('recordMockBuild: every frame in emit order; it refuses to run without a WORCA_HOME', async () => {
  const f = await recordMockBuild({ brief: 'MOCK_SECTIONS=2' });
  assert.equal(f[0].type, 'design-build');
  assert.ok(f.every((x, i) => i === 0 || x.seq === f[i - 1].seq + 1), 'seq rises by one per frame');
  assert.deepEqual(new Set(f.map((x) => x.buildId)).size, 1);
  const home = process.env.WORCA_HOME; delete process.env.WORCA_HOME;
  try {
    await assert.rejects(recordMockBuild(), /WORCA_HOME/);
  } finally { process.env.WORCA_HOME = home; }
});
