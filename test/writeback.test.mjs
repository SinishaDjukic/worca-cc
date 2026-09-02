// test/writeback.test.mjs — spec §7.5 result write-back, all in WORCA_MOCK mode.
// The mock registry has NO canned 'capabilities' default, so every test here also
// exercises the tolerant-default: PluginOpError kind 'unimplemented' => writeBack:true.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { setMockSourceResponses, callSource } from '../src/core/plugin-shim.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { createProfile, readPluginState } from '../src/core/plugin-config.mjs';
import { retryWriteback, reportResultForPipeline } from '../src/core/sources.mjs';

useTempHome(after);
process.env.WORCA_MOCK = '1';
after(() => { delete process.env.WORCA_MOCK; setMockSourceResponses(null); });

const META = { plugin: 'gh', sourceId: 'issues', taskId: 'T-9', url: 'https://tracker.test/T-9', title: 'Fix login' };
const RESULTS = {
  summary: { filesNew: 2, filesChanged: 3, filesDeleted: 0, linesAdded: 120, linesRemoved: 14, blockingIssues: 1, nitpicks: 2 },
  newFiles: [], changedFiles: [],
  keyThingsToCheck: [{ id: 'check-0', severity: 'major', title: 'unguarded null deref', kind: 'impl', cycle: 1, file: 'src/a.mjs' }],
  nitpicks: [],
};

async function seedDonePluginPipeline(meta = META) {
  const p = await createPipeline(await mkdtemp(join(tmpdir(), 'worca-cc-wb-')), {
    promptText: '# Fix login\n\nbody', sourceType: 'plugin', sourceMeta: meta, title: 'Fix login',
  });
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(p.id);
  writeFileSync(join(p.dir, 'results.json'), JSON.stringify(RESULTS));
  return p;
}

test('done plugin pipeline reports completed with a diffstat summary (capabilities op absent => default writeBack)', async () => {
  const calls = [];
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return { ok: true }; } });
  const p = await seedDonePluginPipeline();

  const out = await retryWriteback(p.id);

  assert.deepEqual(out, { ok: true });
  assert.equal(calls.length, 1, 'reportResult called exactly once');
  assert.equal(calls[0].id, 'T-9', 'opaque task id round-trips from source_ref');
  assert.equal(calls[0].status, 'completed', "row status 'done' maps to 'completed'");
  assert.match(calls[0].summary, /3 changed, 2 new/, 'diffstat from results.summary');
  assert.match(calls[0].summary, /\+120 \/ -14/);
  assert.match(calls[0].summary, /1 blocking/);
  assert.match(calls[0].summary, /\[major\] unguarded null deref/, 'key checks listed');
  assert.ok(Array.isArray(calls[0].links), 'links array present (empty: no branch/PR in bundle)');
});

test("error/stopped rows report 'failed' even WITHOUT results.json (design PR12: terminal error paths now report)", async () => {
  const calls = [];
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return { ok: true }; } });
  for (const [status, i] of [['error', 0], ['stopped', 1]]) {
    const p = await createPipeline(await mkdtemp(join(tmpdir(), 'worca-cc-wb-')), {
      promptText: '# x', sourceType: 'plugin', sourceMeta: META, title: 'Broken run',
    });
    getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(status, p.id);
    // no results.json on purpose: failed runs often die before _buildResults
    const out = await retryWriteback(p.id);
    assert.deepEqual(out, { ok: true }, status);
    assert.equal(calls[i].status, 'failed', `row status '${status}' maps to 'failed'`);
    assert.match(calls[i].summary, new RegExp(`— ${status}`), 'summary carries the raw status');
  }
});

test('connector capabilities {writeBack:false} skips the report', async () => {
  const calls = [];
  setMockSourceResponses({
    capabilities: { writeBack: false, incrementalSync: false },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const p = await seedDonePluginPipeline();
  const out = await retryWriteback(p.id);
  assert.deepEqual(out, { ok: true, skipped: true });
  assert.equal(calls.length, 0);
});

test('the run\'s pinned source inputs reach capabilities AND reportResult (per-run write-back)', async () => {
  const caps = [];
  const calls = [];
  setMockSourceResponses({
    // A jira-source-style connector: write-back is whatever THIS run chose.
    capabilities: (args) => { caps.push(args); return { writeBack: args.inputs?.writeBack === 'yes', incrementalSync: false }; },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });

  const optedIn = await seedDonePluginPipeline({ ...META, inputs: { writeBack: 'yes', jql: 'project = X' } });
  assert.deepEqual(await retryWriteback(optedIn.id), { ok: true });
  assert.deepEqual(caps[0], { inputs: { writeBack: 'yes', jql: 'project = X' } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].inputs, { writeBack: 'yes', jql: 'project = X' }, 'connector can re-check the run\'s choice');

  const optedOut = await seedDonePluginPipeline({ ...META, inputs: { writeBack: 'no' } });
  assert.deepEqual(await retryWriteback(optedOut.id), { ok: true, skipped: true });
  assert.equal(calls.length, 1, 'an opted-out run is never reported');

  // A row with no pinned inputs (predates the field) probes with an empty bag.
  const legacy = await seedDonePluginPipeline();
  assert.deepEqual(await retryWriteback(legacy.id), { ok: true, skipped: true });
  assert.deepEqual(caps.at(-1), { inputs: {} });
});

test('probe transport error with NO pinned inputs fails OPEN: the report still runs', async () => {
  // No pinned inputs means no per-run opt-out was possible, so a transient
  // rate-limit/timeout on the probe must not silently drop the ticket comment
  // — the pre-profiles behavior, which reportResult itself then confirms.
  const calls = [];
  setMockSourceResponses({
    capabilities: () => { throw Object.assign(new Error('capabilities timed out'), { kind: 'timeout' }); },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const p = await seedDonePluginPipeline(); // META has no inputs
  assert.deepEqual(await retryWriteback(p.id), { ok: true });
  assert.equal(calls.length, 1, 'write-back proceeded despite the failed probe');
});

test('probe transport error WITH a pinned writeBack input fails CLOSED: the opt-out may be in it', async () => {
  const calls = [];
  setMockSourceResponses({
    capabilities: () => { throw Object.assign(new Error('rate limited'), { kind: 'rate-limit' }); },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const p = await seedDonePluginPipeline({ ...META, inputs: { writeBack: 'no', jql: 'project = X' } });
  const out = await retryWriteback(p.id);
  assert.equal(out.ok, false);
  assert.match(out.error, /capability probe failed: rate limited/);
  assert.equal(calls.length, 0, 'never write when the run may have opted out and we could not hear');
});

test('probe transport error with pinned inputs but NO writeBack key fails OPEN', async () => {
  // The UI pins EVERY source-panel input (defaults and empty strings included),
  // so "has pinned inputs" is true for essentially every plugin run — it must
  // not be what flips the probe to fail-closed. Only the reserved `writeBack`
  // input can carry a per-run opt-out; without it a transient probe error must
  // not silently drop the ticket comment.
  const calls = [];
  setMockSourceResponses({
    capabilities: () => { throw Object.assign(new Error('rate limited'), { kind: 'rate-limit' }); },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const p = await seedDonePluginPipeline({ ...META, inputs: { repo: 'octo/hello', filter: '' } });
  assert.deepEqual(await retryWriteback(p.id), { ok: true });
  assert.equal(calls.length, 1, 'write-back proceeded despite the failed probe');
});

test('an implemented capabilities() that CRASHES with a pinned writeBack input fails CLOSED', async () => {
  // A crash (kind "plugin") is not "op not implemented" (kind "unimplemented"):
  // the connector HAS an opt-out concept and we could not hear its answer, so
  // writing could violate an explicit per-run opt-out.
  const calls = [];
  setMockSourceResponses({
    capabilities: () => { throw new Error('bad response parse'); }, // no kind -> 'plugin'
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const p = await seedDonePluginPipeline({ ...META, inputs: { writeBack: 'no' } });
  const out = await retryWriteback(p.id);
  assert.equal(out.ok, false);
  assert.match(out.error, /capability probe failed: bad response parse/);
  assert.equal(calls.length, 0, 'a crash must not default past the pinned opt-out');
});

test('reportResult failure returns {ok:false,error} and NEVER throws', async () => {
  setMockSourceResponses({ reportResult: () => { throw new Error('rate limited'); } });
  const p = await seedDonePluginPipeline();
  const out = await retryWriteback(p.id);
  assert.equal(out.ok, false);
  assert.match(out.error, /rate limited/);
  // direct-call variant: reportResultForPipeline is equally throw-proof
  const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(p.id);
  const direct = await reportResultForPipeline(row, { results: RESULTS, branch: null, prUrl: null });
  assert.equal(direct.ok, false);
});

test('prompt-source pipelines never call the connector (silent skip); unknown id errors', async () => {
  const calls = [];
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return { ok: true }; } });
  const p = await createPipeline(await mkdtemp(join(tmpdir(), 'worca-cc-wb-')), { prompt: 'plain' });
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(p.id);
  assert.deepEqual(await retryWriteback(p.id), { ok: true, skipped: true });
  assert.equal(calls.length, 0);
  assert.equal((await retryWriteback('deadbeef')).ok, false);
});

test('a pre-profiles row still writes back after its plugin turns multiProfile (legacy default bucket)', async () => {
  // The row's source_ref pinned NO profile (it predates the field). Once the
  // plugin's manifest declares multiProfile, a bare callSource would refuse it
  // with CLI-flavored advice, retry would fail identically forever, and the
  // migrated flat config would sit unreachable in the reserved default bucket.
  // The legacy path reports against DEFAULT_PROFILE explicitly — that bucket
  // IS the instance the task came from.
  const P = 'legacy-mp';
  const cur = pluginCurrentDir(P);
  mkdirSync(cur, { recursive: true });
  writeFileSync(join(cur, 'index.mjs'), 'export default () => ({});\n');
  writeFileSync(join(cur, 'worca-cc-plugin.json'), JSON.stringify({
    name: P,
    taskSources: [{
      id: 'jira', displayName: 'Jira', module: './index.mjs', multiProfile: true,
      inputs: [{ key: 'task', type: 'task-browser', label: 'Task' }],
    }],
  }));
  writePluginsLock({
    [P]: {
      repo: 'local-fixture', subdir: null, pinnedSha: 'f'.repeat(40),
      version: null, enabled: true, installedAt: '2026-07-12T00:00:00.000Z',
    },
  });
  createProfile(P, 'work', 'Work'); // a roster exists, but the legacy row names none of it
  // Canary: the fixture manifest actually loads and the profile invariant is
  // live for this plugin — otherwise this test would pass vacuously.
  await assert.rejects(
    callSource({ plugin: P, sourceId: 'jira', op: 'listTasks', profile: 'nope' }),
    /has no profile "nope"/,
  );

  const calls = [];
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return { ok: true }; } });
  const p = await seedDonePluginPipeline({ plugin: P, sourceId: 'jira', taskId: 'L-1', url: 'https://x.test/L-1', title: 'Legacy' });

  assert.deepEqual(await retryWriteback(p.id), { ok: true });
  assert.equal(calls.length, 1, 'the legacy row reported instead of being stranded');
  assert.equal(calls[0].id, 'L-1');
  // The mock reportResult path persists into the profile it ran against: the
  // legacy DEFAULT bucket, never a phantom one.
  assert.ok(readPluginState(P).lastReport, 'state landed in the default bucket');
  assert.deepEqual(readPluginState(P, 'work'), {}, 'the roster profile stays untouched');
});

test('e2e: write-back failure completes the run anyway, with a warn log event', async () => {
  setMockSourceResponses({
    getTask: { id: 'T-1', title: 'Demo', url: 'https://x.test/T-1', state: 'open', updatedAt: '2026-07-12T00:00:00Z', body: 'demo body', meta: {} },
    reportResult: () => { throw new Error('tracker down'); },
  });
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-e2e-'));
  const orch = createOrchestrator({
    projectDir, auto: true, claude: { mock: true },
    source: { type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-1' },
  });
  const logs = [];
  orch.on('log', (e) => logs.push(e));

  const res = await orch.run();

  assert.equal(res.status, 'done', 'write-back failure NEVER blocks done');
  const row = getDb().prepare('SELECT status, source_type FROM pipelines WHERE id = ?').get(orch.getState().id);
  assert.equal(row.status, 'done');
  assert.equal(row.source_type, 'plugin', 'Task 12 threading persisted the source');
  assert.ok(
    logs.some((l) => l.source === 'writeback' && l.level === 'warn' && /tracker down/.test(l.text)),
    'failure surfaced as a warn log event (UI shows it + offers manual retry)',
  );
});

// ── forced pauses write back too ───────────────────────────────────────────────
// A run that parks ITSELF (auto-mode auth/quota, usage limit, cost cap,
// exhausted recoverable retries — pauseReason is set) has nobody attached, so
// without a report the external task stays claimed "in progress" forever. A
// MANUAL pause is the opposite — the user is present and resuming shortly — and
// must stay silent: the resumed run's own terminal path reports the outcome.

test("e2e: a forced pause (auto-mode auth) reports 'needs-human' to the task source", async () => {
  const calls = [];
  setMockSourceResponses({
    getTask: { id: 'T-2', title: 'Pausing', url: 'https://x.test/T-2', state: 'open', updatedAt: '2026-07-12T00:00:00Z', body: 'demo body', meta: {} },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-pause-'));
  const orch = createOrchestrator({
    projectDir, auto: true, claude: { mock: true },
    source: { type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-2' },
    runners: {
      producer: async () => { throw new Error('claude exited with code 1: API Error: 401 Invalid authentication credentials'); },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    },
  });

  const res = await orch.run();

  assert.equal(res.status, 'paused');
  assert.ok(orch.pauseReason, 'precondition: an auto-mode auth pause records a reason');
  assert.equal(calls.length, 1, 'the forced pause reported exactly once');
  assert.equal(calls[0].id, 'T-2', 'opaque task id round-trips from source_ref');
  assert.equal(calls[0].status, 'needs-human', "row status 'paused' maps to 'needs-human'");
  assert.match(calls[0].summary, /— paused/, 'thin status-only summary (no results bundle exists at a pause)');
});

test('e2e: a MANUAL pause never writes back — the user is driving', async () => {
  const calls = [];
  setMockSourceResponses({
    getTask: { id: 'T-4', title: 'Held', url: 'https://x.test/T-4', state: 'open', updatedAt: '2026-07-12T00:00:00Z', body: 'demo body', meta: {} },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-pause-'));
  let orch;
  orch = createOrchestrator({
    projectDir, auto: true, claude: { mock: true },
    source: { type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-4' },
    runners: {
      // Request the pause mid-node, exactly like the UI/CLI pause button: the
      // engine unwinds at the next boundary with NO pauseReason recorded.
      producer: async () => { orch.pause(); return { status: 'ok', summary: 'done' }; },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    },
  });

  const res = await orch.run();

  assert.equal(res.status, 'paused');
  assert.equal(orch.pauseReason, null, 'precondition: a manual pause records no reason');
  assert.equal(calls.length, 0, 'no reportResult for a manual pause');
});
