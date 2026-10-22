// Promo video spec §Preflight: a run whose graph carries promoCapture / promoRender checks Chrome and
// ffmpeg at run start and refuses with one line per missing tool and its install hint for THIS host.
// The lookups are injected (`mediaTools`), so the suite never depends on what this machine has.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { mediaToolProblems, MEDIA_TOOL_NEEDS } from '../src/core/graph/media-preflight.mjs';
import { PROMO_VIDEO_WORKFLOW_ID } from '../src/core/graph/promo-video-workflow.mjs';

useTempHome(after);

const FIND_TOOLS = fileURLToPath(new URL('../assets/promo-kit/tools/find-tools.mjs', import.meta.url));
const kit = await import(new URL('../assets/promo-kit/tools/find-tools.mjs', import.meta.url).href);
const hints = kit.toolHints(process.platform);

/** Lookups that find nothing, with the kit's REAL hints; `calls` records every lookup. */
function missingTools() {
  const calls = [];
  return {
    calls,
    findChrome: () => { calls.push('chrome'); return null; },
    findFfmpeg: () => { calls.push('ffmpeg'); return null; },
    toolHints: (p) => kit.toolHints(p),
  };
}
const throwingTools = () => ({
  findChrome: () => { throw new Error('findChrome must not be consulted'); },
  findFfmpeg: () => { throw new Error('findFfmpeg must not be consulted'); },
  toolHints: () => { throw new Error('toolHints must not be consulted'); },
});

const ctx = (entries) => Object.fromEntries(entries.map((e, i) => [e.nodeId || `n_${i}`, e]));
const render = { nodeId: 'n_render', kind: 'script', key: 'promoRender', meta: { displayName: 'Promo Render' }, mock: { summary: 'x' } };
const capture = { nodeId: 'n_capture', kind: 'agent', key: 'promoCapture', meta: { displayName: 'Promo Capture' } };

test('the kit lookups exist where the preflight imports them', () => {
  assert.ok(existsSync(FIND_TOOLS), FIND_TOOLS);
  for (const f of ['findChrome', 'findFfmpeg', 'toolHints']) assert.equal(typeof kit[f], 'function', f);
  assert.deepEqual(Object.keys(MEDIA_TOOL_NEEDS).sort(), ['promoCapture', 'promoRender']);
});

test('mediaToolProblems: one line per missing tool, naming the cards and the host install hint', async () => {
  const tools = missingTools();
  const lines = await mediaToolProblems(ctx([capture, render]), { tools });
  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /^"Promo Capture", "Promo Render" need Chrome/);
  assert.ok(lines[0].endsWith(hints.chrome), lines[0]);
  assert.match(lines[1], /^"Promo Render" needs ffmpeg/);
  assert.ok(lines[1].endsWith(hints.ffmpeg), lines[1]);
  // Found tools are not reported; capture alone needs no ffmpeg.
  const chromeOnly = { ...missingTools(), findChrome: () => '/x/chrome' };
  assert.deepEqual(await mediaToolProblems(ctx([render]), { tools: chromeOnly }), [lines[1].replace('"Promo Capture", ', '')]);
  const capOnly = missingTools();
  assert.equal((await mediaToolProblems(ctx([capture]), { tools: capOnly })).length, 1);
  assert.deepEqual(capOnly.calls, ['chrome'], 'a capture-only graph never looks for ffmpeg');
  // The hint is the one for the host the run is on.
  const win = await mediaToolProblems(ctx([render]), { tools: missingTools(), platform: 'win32' });
  assert.ok(win[1].endsWith(kit.toolHints('win32').ffmpeg), win[1]);
});

test('mediaToolProblems: a mock run and a graph without promo cards never consult the lookups', async () => {
  // Mock: the agent runs on the mock engine and the script's declared mock spawns nothing.
  assert.deepEqual(await mediaToolProblems(ctx([capture, render]), { mocked: true, tools: throwingTools() }), []);
  // No promo card: untouched.
  const plain = ctx([{ nodeId: 'n_plan', kind: 'agent', key: 'planner' }, { nodeId: 'n_task', kind: 'task', key: null },
    { nodeId: 'n_tests', kind: 'script', key: 'runTests' }]);
  assert.deepEqual(await mediaToolProblems(plain, { tools: throwingTools() }), []);
  assert.deepEqual(await mediaToolProblems(null, { tools: throwingTools() }), []);
  // A mock run still checks a script card that declares NO mock: it really runs.
  const real = { ...render, mock: null };
  const lines = await mediaToolProblems(ctx([real]), { mocked: true, tools: missingTools() });
  assert.equal(lines.length, 2);
});

test('a non-mock run of wf_promo_video with no Chrome and no ffmpeg is refused before anything executes', { timeout: 60000 }, async () => {
  const prev = { WORCA_MOCK: process.env.WORCA_MOCK, ORCH_MOCK: process.env.ORCH_MOCK };
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
  try {
    const tools = missingTools();
    const orch = createOrchestrator({
      projectDir: gitDir('promo-preflight'), workflowId: PROMO_VIDEO_WORKFLOW_ID, prompt: 'a promo for this app',
      claude: { mock: false }, auto: true, mediaTools: tools,
    });
    const execs = [];
    orch.on('exec', (e) => execs.push(e));
    const res = await orch.run();
    assert.equal(res.status, 'error');
    const err = String(res.error);
    assert.ok(err.includes('need Chrome') || err.includes('needs Chrome'), err);
    assert.ok(err.includes(hints.chrome), err);
    assert.ok(err.includes('needs ffmpeg'), err);
    assert.ok(err.includes(hints.ffmpeg), err);
    assert.deepEqual(execs, [], 'the run stopped before the first execution');
    assert.ok(tools.calls.includes('chrome') && tools.calls.includes('ffmpeg'));
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('the orchestrator preflight passes a mock run through without consulting the lookups', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('promo-preflight-mock'), prompt: 'x', claude: { mock: true }, mediaTools: throwingTools() });
  orch.resolved = { nodeCtx: ctx([capture, render]) };
  await orch._preflightMediaTools();
  const live = createOrchestrator({ projectDir: gitDir('promo-preflight-live'), prompt: 'x', claude: { mock: false }, mediaTools: missingTools() });
  live.resolved = { nodeCtx: ctx([render]) };
  const prev = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    await assert.rejects(live._preflightMediaTools(), (e) => e.message.split('\n').length === 2);
  } finally { if (prev !== undefined) process.env.WORCA_MOCK = prev; }
});
