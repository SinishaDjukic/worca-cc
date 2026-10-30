// test/writeback.test.mjs — spec §7.5 result write-back, all in WORCA_MOCK mode.
// The first test sets no capabilities answer, so it exercises the tolerant-default: PluginOpError kind 'unimplemented' =>
// writeBack:true. The mock registry's own capabilities answer (A6) keeps writeBack true, so the others behave the same.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createPipeline, readPipelineForResume } from '../src/core/artifacts.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { setMockSourceResponses, callSource, PluginOpError } from '../src/core/plugin-shim.mjs';
import { writePluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { createProfile, readPluginState, writeTicketUpdates } from '../src/core/plugin-config.mjs';
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
  // capabilities: undefined = no canned answer, so the op is absent and the tolerant default (writeBack true) is what runs
  setMockSourceResponses({ capabilities: undefined, reportResult: (args) => { calls.push(args); return { ok: true }; } });
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

test("e2e: a SIGTERM pause (pauseForSignal) reports 'needs-human': a stopped CLI run has nobody to resume it", async () => {
  const calls = [];
  setMockSourceResponses({
    getTask: { id: 'T-5', title: 'Evicted', url: 'https://x.test/T-5', state: 'open', updatedAt: '2026-07-12T00:00:00Z', body: 'demo body', meta: {} },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-pause-'));
  let orch;
  let accepted = null;
  orch = createOrchestrator({
    projectDir, auto: true, claude: { mock: true },
    source: { type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-5' },
    runners: {
      // The CLI's SIGTERM handler, mid-node.
      producer: async () => { accepted = orch.pauseForSignal('SIGTERM'); return { status: 'ok', summary: 'done' }; },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    },
  });

  const res = await orch.run();

  assert.equal(accepted, true, 'a running run accepts the signal pause');
  assert.equal(res.status, 'paused');
  assert.equal(res.reason, 'terminated');
  assert.equal(res.detail, 'the process received SIGTERM');
  assert.equal(calls.length, 1, 'the SIGTERM pause reported exactly once');
  assert.equal(calls[0].id, 'T-5');
  assert.equal(calls[0].status, 'needs-human');
  const row = getDb().prepare('SELECT status, resume_point FROM pipelines WHERE id = ?').get(orch.getState().id);
  assert.equal(row.status, 'paused');
  const rp = JSON.parse(row.resume_point);
  assert.equal(rp.version, 2, 'a graph resume point `worca resume` can continue');
  assert.equal(orch.pauseForSignal('SIGTERM'), false, 'a run no longer running refuses a second signal pause');
});

test('e2e: a SIGTERM while a resume still sets up (idle) pauses it as soon as it runs, before any node', async () => {
  const calls = [];
  setMockSourceResponses({
    getTask: { id: 'T-6', title: 'Evicted twice', url: 'https://x.test/T-6', state: 'open', updatedAt: '2026-07-12T00:00:00Z', body: 'demo body', meta: {} },
    reportResult: (args) => { calls.push(args); return { ok: true }; },
  });
  const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-pause-'));
  let first;
  first = createOrchestrator({
    projectDir, auto: true, claude: { mock: true },
    source: { type: 'plugin', plugin: 'gh', sourceId: 'issues', taskId: 'T-6' },
    runners: {
      producer: async () => { first.pauseForSignal('SIGTERM'); return { status: 'ok', summary: 'done' }; },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    },
  });
  assert.equal((await first.run()).status, 'paused');
  const id = first.getState().id;

  let produced = 0;
  const orch = createOrchestrator({
    projectDir, auto: true, claude: { mock: true },
    resume: readPipelineForResume(id),
    runners: {
      producer: async () => { produced += 1; return { status: 'ok', summary: 'done' }; },
      verifier: async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' }),
    },
  });
  const resuming = orch.resume();
  assert.equal(orch.state.status, 'idle', 'precondition: the resume has not reached running yet');
  assert.equal(orch.pauseForSignal('SIGTERM'), true, 'the signal is held for the resume');
  const res = await resuming;

  assert.equal(res.status, 'paused');
  assert.equal(res.reason, 'terminated');
  assert.equal(produced, 0, 'no node ran: the pause landed as the resume started running');
  assert.equal(getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status, 'paused');
  assert.ok(JSON.parse(getDb().prepare('SELECT resume_point FROM pipelines WHERE id = ?').get(id).resume_point), 'still resumable');
  assert.deepEqual(calls.map((c) => c.status), ['needs-human', 'needs-human']);
});

// ── Ticket updates (plans/ticket-updates-design.md D6, D7, D11) ─────────────────
const TU_RULES = { projects: [{ value: 'SHOP', label: 'Shop' }], rules: [
  { project: '', moment: 'finished', target: { kind: 'category', value: 'done' } },
  { project: 'SHOP', label: 'Shop', moment: 'finished', target: { kind: 'status', value: '10012', label: 'Resolved', category: 'done' } }] };
async function withFlag(on, fn) {
  const was = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = on ? 'ticketUpdates' : '-ticketUpdates';
  try { return await fn(); } finally { if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was; }
}
const tuMeta = (project, plugin = 'tu-gh') => ({ plugin, sourceId: 'issues', taskId: 'SHOP-7', url: 'https://tracker.test/SHOP-7', title: 'Fix',
  ...(project ? { project } : {}) });

test('Ticket updates: a move only with ticketUpdates and a record; project rule, All projects, a failed run; the note comes back', async () => {
  const calls = [];
  const answer = (args) => (args.move && args.move.status
    ? { moved: { from: 'In Progress', to: args.move.name }, note: `Moved to ${args.move.name}.` } : { moved: null, note: '' });
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return answer(args); } });   // capabilities: the mock's, ticketUpdates true
  writeTicketUpdates('tu-gh', 'default', 'issues', TU_RULES);
  await withFlag(true, async () => {
    let p = await seedDonePluginPipeline(tuMeta('SHOP'));
    assert.deepEqual(await retryWriteback(p.id), { ok: true, note: 'Moved to Resolved.', moved: { from: 'In Progress', to: 'Resolved' } });
    assert.deepEqual(calls.at(-1).move, { status: '10012', name: 'Resolved' });
    p = await seedDonePluginPipeline(tuMeta('OPS'));
    assert.deepEqual(await retryWriteback(p.id), { ok: true }, 'an empty note adds nothing');
    assert.deepEqual(calls.at(-1).move, { category: 'done' }, 'no rule for OPS: All projects');
    p = await seedDonePluginPipeline(tuMeta(null));
    await retryWriteback(p.id);
    assert.deepEqual(calls.at(-1).move, { category: 'done' }, 'a row without project (from before this change): All projects');
    p = await seedDonePluginPipeline(tuMeta('SHOP'));
    getDb().prepare("UPDATE pipelines SET status = 'error' WHERE id = ?").run(p.id);
    await retryWriteback(p.id);
    assert.deepEqual(calls.at(-1).move, { none: true }, 'a run that did not finish successfully');
    p = await seedDonePluginPipeline(tuMeta('SHOP', 'tu-none'));
    assert.deepEqual(await retryWriteback(p.id), { ok: true });
    assert.equal('move' in calls.at(-1), false, 'no record: no move (legacy)');
    setMockSourceResponses({ capabilities: { writeBack: true }, reportResult: (args) => { calls.push(args); return answer(args); } });
    p = await seedDonePluginPipeline(tuMeta('SHOP'));
    await retryWriteback(p.id);
    assert.equal('move' in calls.at(-1), false, 'a connector without ticketUpdates hears no move');
  });
  setMockSourceResponses({ reportResult: (args) => { calls.push(args); return answer(args); } });
  await withFlag(false, async () => {
    const p = await seedDonePluginPipeline(tuMeta('SHOP'));
    await retryWriteback(p.id);
    assert.equal('move' in calls.at(-1), false, 'flag off: no move');
  });
  setMockSourceResponses(null);
});

test('Ticket updates (S1): a capabilities probe that fails for another reason still passes the move; the old setting never runs', async () => {
  const calls = [];
  const report = (args) => { calls.push(args); return { moved: null, note: '' }; };
  writeTicketUpdates('tu-gh', 'default', 'issues', TU_RULES);
  await withFlag(true, async () => {
    setMockSourceResponses({ capabilities: () => { throw new PluginOpError('rate-limit', 'Jira rate limit: try again later.'); }, reportResult: report });
    let p = await seedDonePluginPipeline(tuMeta('SHOP'));
    assert.deepEqual(await retryWriteback(p.id), { ok: true });
    assert.deepEqual(calls.at(-1).move, { status: '10012', name: 'Resolved' }, 'fail closed: the saved rule, not the old setting');
    setMockSourceResponses({ capabilities: () => { throw new PluginOpError('timeout', 'op exceeded'); }, reportResult: report });
    p = await seedDonePluginPipeline(tuMeta('SHOP', 'tu-none'));
    await retryWriteback(p.id);
    assert.equal('move' in calls.at(-1), false, 'no record: still legacy');
    setMockSourceResponses({ capabilities: () => { throw new PluginOpError('unimplemented', 'no capabilities op'); }, reportResult: report });
    p = await seedDonePluginPipeline(tuMeta('SHOP'));
    await retryWriteback(p.id);
    assert.equal('move' in calls.at(-1), false, 'a connector without a capabilities op cannot hear a move');
  });
  setMockSourceResponses(null);
});

test('Ticket updates (S8): the note and the move are one line of at most 300 characters', async () => {
  setMockSourceResponses({ reportResult: () => ({ moved: { from: 'In\nProgress', to: `R${'e'.repeat(400)}` },
    note: `Not moved: Jira refused the move to Done:\n  ${'x'.repeat(500)}.` }) });
  writeTicketUpdates('tu-gh', 'default', 'issues', TU_RULES);
  await withFlag(true, async () => {
    const out = await retryWriteback((await seedDonePluginPipeline(tuMeta('SHOP'))).id);
    assert.equal(out.note.includes('\n'), false);
    assert.ok(out.note.startsWith('Not moved: Jira refused the move to Done: xxx'), out.note.slice(0, 60));
    assert.equal(out.note.length, 300);
    assert.deepEqual([out.moved.from, out.moved.to.length], ['In Progress', 300]);
  });
  setMockSourceResponses(null);
});

test("e2e (D6, D11): the task's meta.project picks the rule; the audit line ends with the plugin's note", async () => {
  setMockSourceResponses({ getTask: { id: 'SHOP-9', title: 'Demo', url: 'https://x.test/SHOP-9', state: 'open', updatedAt: '2026-07-12T00:00:00Z',
    body: 'demo body', meta: { key: 'SHOP-9', project: 'SHOP' } } });   // reportResult: the mock's (D17), it answers by the move
  writeTicketUpdates('tu-e2e', 'default', 'issues', TU_RULES);
  await withFlag(true, async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'worca-cc-wb-tu-'));
    const orch = createOrchestrator({ projectDir, auto: true, claude: { mock: true },
      source: { type: 'plugin', plugin: 'tu-e2e', sourceId: 'issues', taskId: 'SHOP-9' } });
    const res = await orch.run();
    assert.equal(res.status, 'done');
    const id = orch.getState().id;
    assert.equal(JSON.parse(getDb().prepare('SELECT source_ref FROM pipelines WHERE id = ?').get(id).source_ref).project, 'SHOP');
    assert.deepEqual(JSON.parse(readPluginState('tu-e2e').lastReport).move, { status: '10012', name: 'Resolved' });
    const lines = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(id).map((r) => r.text);
    assert.ok(lines.includes('Result reported back to the task source. Moved to Resolved.'), lines.join(' | '));
  });
  setMockSourceResponses(null);
});
