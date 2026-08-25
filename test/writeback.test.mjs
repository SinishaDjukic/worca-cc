// test/writeback.test.mjs — spec §7.5 result write-back, all in WORCA_MOCK mode.
// The mock registry has NO canned 'capabilities' default, so every test here also
// exercises the tolerant-default: PluginOpError kind 'plugin' => writeBack:true.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { setMockSourceResponses } from '../src/core/plugin-shim.mjs';
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

test('probe transport error WITH pinned inputs fails CLOSED: the opt-out may be in them', async () => {
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
