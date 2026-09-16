// test/metrics-record-sink.test.mjs
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { makeOrigin, cloneAs, branchFiles, pushRawMarker, fakeHarness, useGitSandbox } from './helpers/metrics-git.mjs';
import { addProject } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeTeamMetricsPrefs } from '../src/core/config.mjs';
import { enableTeamMetrics, discoverProject, listOutbox, outboxDir, flushSlug, setRecordMyRuns, _testing as syncTesting } from '../src/core/metrics/sync.mjs';
import { recordRunMetrics, _testing as recordTesting } from '../src/core/metrics/record.mjs';
import { readRunLedger } from '../src/core/metrics/ledger.mjs';

const skip = process.platform === 'win32';
const root = mkdtempSync(join(tmpdir(), 'worca-metrics-rec-'));
useGitSandbox(before, after);   // FIRST (§5.12)
useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => { syncTesting.reset(); recordTesting.reset(); });

let gw, co, coBare;
before(async () => {
  gw = cloneAs(root, 'm', makeOrigin(root, 'gateway'), 'gateway');
  coBare = makeOrigin(root, 'console'); co = cloneAs(root, 'm', coBare, 'console');
  await addProject({ name: 'gateway', path: gw });
  await addProject({ name: 'console', path: co });
});

test('delegating project: record keeps its own target.project, takes the delegate attribution, lands only on the delegate', { skip }, async () => {
  await enableTeamMetrics(gw, { mode: 'here', attribution: 'none' });
  await enableTeamMetrics(co, { mode: 'delegate', delegateTo: 'gateway' });
  recordTesting.setScheduleFlush(() => null);          // flush explicitly below
  const r = await recordRunMetrics(fakeHarness({ projectDir: co, runId: 'runD0001' }), { status: 'done' });
  assert.equal(r.recorded, true, JSON.stringify(r));
  const [name] = await listOutbox('gateway');
  const line = JSON.parse(readFileSync(join(outboxDir('gateway'), name), 'utf8'));
  assert.deepEqual(line.target, { kind: 'project', project: 'console' });
  assert.equal(line.actor, null);
  assert.deepEqual(line.cost.byPhase, { plan: 0.5 }, 'agent-key phase is mapped to the UI phase');
  assert.deepEqual(line.cycles, { plan: 1 });
  assert.equal(readRunLedger('runD0001').state, 'pending');
  await flushSlug('gateway', { sleep: async () => {} });
  assert.equal(readRunLedger('runD0001').state, 'recorded');
  assert.equal(branchFiles(coBare).length, 2, 'nothing lands on the delegating branch');
});

test('chained delegateTo records nothing, logs "no chains", ledger says skipped', { skip }, async () => {
  const biBare = makeOrigin(root, 'payments-worker'); const bi = cloneAs(root, 'm', biBare, 'payments-worker');
  await addProject({ name: 'payments-worker', path: bi });
  pushRawMarker(root, biBare, { schema: 1, delegateTo: 'console' });
  await discoverProject(bi, { force: true });
  const h = fakeHarness({ projectDir: bi, runId: 'runX0001' });
  const r = await recordRunMetrics(h, { status: 'done' });
  assert.equal(r.recorded, false); assert.equal(r.reason, 'delegate-invalid');
  assert.deepEqual(await listOutbox('console'), []);
  assert.equal(readRunLedger('runX0001').state, 'skipped');
  assert.ok(h.logs.some((l) => l.source === 'metrics' && /no chains/.test(l.text)));
});

test('mock run and preflight-only failure produce no record', async () => {
  const h = fakeHarness({ projectDir: gw, runId: 'runM0001' });
  h.claude.mock = true;
  assert.deepEqual(await recordRunMetrics(h, { status: 'done' }), { recorded: false, reason: 'mock' });
  const p = fakeHarness({ projectDir: gw, runId: 'runM0002' });
  p.pipeline = null;
  assert.deepEqual(await recordRunMetrics(p, { status: 'error', error: new Error('unknown agent') }), { recorded: false, reason: 'no-pipeline' });
});

test('"Record my runs" off → nothing recorded, ledger says skipped', { skip }, async () => {
  setRecordMyRuns(gw, false);
  const r = await recordRunMetrics(fakeHarness({ projectDir: gw, runId: 'runO0001' }), { status: 'done' });
  assert.deepEqual(r, { recorded: false, reason: 'opted-out' });
  assert.equal(readRunLedger('runO0001').state, 'skipped');
  setRecordMyRuns(gw, true);
});

test('the terminal hook never rediscovers a stale cache (no network at run end)', { skip }, async () => {
  writeTeamMetricsPrefs(projectKey(gw), { checkedAt: '2020-01-01T00:00:00Z' });   // very stale, still enabled
  let networkCalls = 0;
  syncTesting.setGit(async (cwd, args, opts) => {
    if (args.includes('ls-remote') || args.includes('fetch') || args.includes('push')) networkCalls++;
    return syncTesting.defaultGit(cwd, args, opts);
  });
  recordTesting.setScheduleFlush(() => null);
  const r = await recordRunMetrics(fakeHarness({ projectDir: gw, runId: 'runN0001' }), { status: 'done' });
  assert.equal(r.recorded, true, JSON.stringify(r));
  assert.equal(networkCalls, 0);
});
