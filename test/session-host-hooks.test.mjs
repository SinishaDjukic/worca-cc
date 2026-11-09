// test/session-host-hooks.test.mjs — hook telemetry is consumed where its record lives.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { createSessionHosts } from '../src/core/session-host.mjs';
import { runMockSession, _testing as mockT } from '../src/core/engines/mock-session.mjs';
import { tracePath, readTrace } from '../src/core/session-trace.mjs';
import { spec, decisions, fakePort, member, mockMember, SID } from './helpers/session-host-fakes.mjs';

useTempHome(after);
before(async () => {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === 'wf_quick-fix'));
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = SID;
  t.sessions = { [SID]: { hostModel: 'claude-haiku-4-5' } };
  await writeGraphWorkflow({ ...t, id: 'wf_sess_hooks', name: 'Sess hooks' });
});
beforeEach(() => { mockT.resetSessions(); mockT.costFor = () => 0.25; mockT.behave = () => 'hooks'; mockT.hookUsd = { member: 0.2489, investigator: 0.03 }; });
after(() => { mockT.costFor = null; mockT.behave = null; mockT.hookUsd = null; delete process.env.WORCA_FLAGS; });
const SPEC = () => spec(['n_a', 'n_b'], { hostModel: 'claude-haiku-4-5' });

test('the member hook feeds reconcile; only the investigator hook reaches the member stream', async () => {
  const port = fakePort();
  const events = [];
  const host = createSessionHosts({ specs: [SPEC()], decisions: decisions(), port, transport: runMockSession }).hostFor('n_a');
  await host.run(mockMember('x:n_a:1', events), member('n_a'));
  assert.equal(port.booked[0].hookUsd, 0.2489);
  assert.equal(events.filter((e) => e.type === 'hook').length, 1);
});

test('a hook figure beyond tolerance is a mismatch on the record; the booking stays the harness figure', async () => {
  mockT.hookUsd = { member: 0.4, investigator: 0.03 };
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-hooks'), claude: { mock: true } });
  o._persist = async () => {}; o._sessionAudit = () => {};
  o.state.steps.push({ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', costUsd: 0 });
  const port = { ...fakePort(), bookTurn: (b) => o._bookSessionTurn(b) };
  const host = createSessionHosts({ specs: [SPEC()], decisions: decisions(), port, transport: runMockSession }).hostFor('n_a');
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  const rec = port.records.find((r) => r.kind === 'reconcile');
  assert.equal(rec.ok, false);
  assert.equal(rec.checks.find((c) => c.method === 'hook').ok, false, 'the hook check uses the 2% rule (C33)');
  assert.ok(Math.abs(o.state.steps[0].costUsd - 0.2511) < 1e-9, 'Δ (0.25 member + 0.0011 hand-off) is booked, not the hook figure');
});

test('a hook figure within 2% passes the hook check (the estimate check is its own: C33)', async () => {
  mockT.hookUsd = { member: 0.254 };                    // v3: 1.6% off the harness figure: past the $0.001 floor, inside 2%
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-hooks-ok'), claude: { mock: true } });
  o._persist = async () => {}; o._sessionAudit = () => {};
  o.state.steps.push({ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', costUsd: 0 });
  const port = { ...fakePort(), bookTurn: (b) => o._bookSessionTurn(b) };
  const host = createSessionHosts({ specs: [SPEC()], decisions: decisions(), port, transport: runMockSession }).hostFor('n_a');
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  const rec = port.records.find((r) => r.kind === 'reconcile');
  const hook = rec.checks.find((c) => c.method === 'hook');
  assert.equal(hook.ok, true);
});

test('v3 — a hook figure 4% off is a mismatch: the hook check is held to 2%, not the estimate\'s 15% (C33)', async () => {
  mockT.hookUsd = { member: 0.26 };
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-hooks-4pc'), claude: { mock: true } });
  o._persist = async () => {}; o._sessionAudit = () => {};
  o.state.steps.push({ key: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a', costUsd: 0 });
  const port = { ...fakePort(), bookTurn: (b) => o._bookSessionTurn(b) };
  const host = createSessionHosts({ specs: [SPEC()], decisions: decisions(), port, transport: runMockSession }).hostFor('n_a');
  await host.run(mockMember('x:n_a:1'), member('n_a'));
  const rec = port.records.find((r) => r.kind === 'reconcile');
  assert.equal(rec.checks.find((c) => c.method === 'hook').ok, false);
});

test('R2 end to end — an investigator\'s hook prices its own record; the member\'s hook never reaches the harness (C8)', { timeout: 120000 }, async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  mockT.behave = ({ agentType }) => (agentType.startsWith('worca-x-n_impl-1-') ? 'hooks' : null);   // the implementer fans out (mock.mjs)
  const orch = createOrchestrator({ projectDir: gitDir('sesshooks'), workflowId: 'wf_sess_hooks', prompt: 'demo', auto: true, claude: { mock: true } });
  const telemetry = [];                                   // v4: which hooks reach the harness's sub-agent telemetry at all
  const record = orch._recordSubAgentTelemetry.bind(orch);
  orch._recordSubAgentTelemetry = (raw) => { try { telemetry.push(JSON.parse(raw?.stdout).tool_use_id); } catch { /* not a payload */ } return record(raw); };
  assert.equal((await orch.run()).status, 'done');
  const st = orch.getState();
  const inv = st.subAgents.find((s) => s.id === 'mock_implementer_1');
  assert.ok(inv, 'the re-rooted investigator spawn made its record');
  assert.equal(inv.costUsd, 0.03, 'the investigator hook reached _recordSubAgentTelemetry and priced it');
  const impl = st.steps.find((s) => s.key === 'x:n_impl:1');
  const own = st.subAgents.find((s) => s.id === impl.session.memberAgentId);
  assert.equal(own.memberOf, SID);
  assert.equal(own.costUsd, undefined, 'the member\'s own record carries no price: its hook went to reconcile');
  // The stamp clears a price on the member's record whatever reached it, so the routing itself is pinned here (C8).
  assert.ok(telemetry.includes('mock_implementer_1'), 'the investigator\'s hook reached the telemetry');
  assert.equal(telemetry.includes(impl.session.memberAgentId), false, 'the member\'s own hook never did');
  const { records } = await readTrace(tracePath(st.pipelineDir, SID));
  const rec = records.find((r) => r.kind === 'reconcile' && r.dispatchId === impl.session.dispatchId);
  assert.ok(rec.checks.some((c) => c.method === 'hook'), 'the member hook became the turn\'s hook check');
});
