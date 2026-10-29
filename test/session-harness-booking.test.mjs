// test/session-harness-booking.test.mjs — every dollar a session turn reports lands on exactly one row, once.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runCostBreakdown, AUX_ORDER, fmtAuxCalls } from '../src/shared/cost/breakdown.mjs';
import { recordBridgeCost } from '../src/core/bridge/telemetry.mjs';
import { setPipelineCostLimitUsd, addGlobalModel, removeGlobalModel } from '../src/core/settings.mjs';
import { priceUsage, splitTurnCost } from '../src/core/session-cost.mjs';
import { listCostRates, liveCostRates, PREDEFINED_LIST_PRICES } from '../src/core/config.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { setCostCapOverride } from '../src/core/cost-budget.mjs';
import { writePolicyState } from '../src/core/policy/state.mjs';
import { createSessionHosts } from '../src/core/session-host.mjs';
import { runMockSession, _testing as mockT, MOCK_MEMBER_USAGE } from '../src/core/engines/mock-session.mjs';
import { spec, decisions, member, mockMember } from './helpers/session-host-fakes.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc: the caps and model overrides below must never reach a shared home.
const home = mkdtempSync(join(tmpdir(), 'worca-sess-book-home-'));
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true });
});

const SID = 's_aaaaaaaa';
function unit(engine = 'claude') {
  const o = createOrchestrator({ projectDir: join(tmpdir(), 'worca-sess-book'), claude: { mock: true, engine } });
  o._persist = async () => {};
  for (const k of ['x:n_a:1', 'x:n_b:1']) o.state.steps.push({ key: k, executionId: k, nodeId: k.split(':')[1], costUsd: 0 });
  return o;
}
const B = (stepKey, cumulativeUsd, over = {}) => ({ sid: SID, hostEpoch: 1, hostSessionId: 'H1', turnId: 't', dispatchId: 'd', stepKey, cumulativeUsd,
  hostUsage: { input_tokens: 1000, output_tokens: 20 }, hostModel: 'claude-haiku-4-5', memberUsage: { input_tokens: 10 }, memberModel: 'claude-opus-5-5', hookUsd: NaN, ...over });
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m ?? ''} ${a} vs ${b}`);

test('two turns on one host: each row books its own share; hand-offs are an aux line; total = Σ rows', () => {
  const o = unit();
  o._bookSessionTurn(B('x:n_a:1', 0.5));
  o._bookSessionTurn(B('x:n_b:1', 0.8));
  const [a, b] = o.state.steps;
  near(a.costUsd, 0.5);
  near(b.costUsd, 0.3);
  assert.deepEqual(a.auxCosts.session, { usd: 0.0011, calls: 1 });
  near(o.state.totalCostUsd, 0.8);
  const br = runCostBreakdown(o.state.steps, o.state.totalCostUsd);
  assert.deepEqual(br.lines.map((l) => [l.kind, l.label]), [['session', 'Session hand-offs']]);
  assert.deepEqual([...AUX_ORDER], ['away', 'auto', 'title', 'session']);
  assert.equal(fmtAuxCalls('session', 2), '2 hand-offs');
});

test('C9 — carried spend goes to the CUT step\'s row; the rest to the current step; nothing twice', () => {
  const o = unit();
  o._bookSessionTurn(B('x:n_a:1', 0.2));
  const r = o._bookSessionTurn(B('x:n_b:1', 0.7, { carried: { turnId: 't:2', dispatchId: 'd:x:n_a:1:a1', executionId: 'x:n_a:1', cutUsd: 0.07 } }));
  near(r.carried.usd, 0.07);
  near(o.state.steps[0].costUsd, 0.27);
  near(o.state.steps[1].costUsd, 0.43);
  near(o.state.totalCostUsd, 0.7);
});

test('C9 — a cut that the harness will never restore is booked at once as an estimate', () => {
  const o = unit();
  o._openTurns = new Map([['x:n_a:1', { model: null, msgModel: null, perMsg: new Map() }]]);
  const r = o._bookSessionTurn({ ...B('x:n_a:1', NaN), cutEstimateUsd: 0.05 });
  assert.equal(r.costSource, 'estimate');
  near(o.state.steps[0].costUsd, 0.05);
  assert.deepEqual([r.deltaUsd, r.hostOverheadUsd, r.hostPriced, r.overridden, r.carried, r.reconcile], [null, null, false, false, null, { ok: true, checks: [] }], 'v4: every other field');
  assert.equal(o._openTurns.has('x:n_a:1'), false, 'v4: the cut\'s open turn is closed: the pause flush never floors it again');
});

test('C34 / M-15 — a bridged member books the upstream figure once, never again at the open-turn flush', () => {
  const o = unit();
  recordBridgeCost({ tag: 'x:n_a:1', costUsd: 0.3 });                    // what the bridge saw upstream under the member's tag (bridge/telemetry.mjs:60)
  const r = o._bookSessionTurn(B('x:n_a:1', 0));                         // the CLI priced the unknown id at $0
  assert.equal(r.costSource, 'bridge');
  near(o.state.steps[0].costUsd, 0.3);
  o._closeOpenTurns('x:n_a:1');
  near(o.state.steps[0].costUsd, 0.3, 'the tag was forgotten: no second booking');
});

test('an engine without cost books nothing: blank, never $0', () => {
  const o = unit('copilot');
  delete o.state.steps[0].costUsd;                                       // v5: a real row starts blank, so a $0 booking would show
  const r = o._bookSessionTurn({ ...B('x:n_a:1', NaN) });
  assert.equal(r.costSource, 'none');
  assert.equal(o.state.steps[0].costUsd, undefined);
  assert.equal(o.state.steps[0].auxCosts, undefined);
});

test('the remaining budget is the tightest pipeline cap, or null (verify minor 4: the same sources _checkCostLimits reads)', async () => {
  const o = unit();
  assert.equal(o._remainingPipelineBudgetUsd(), null, 'no pipeline id yet: nothing to meter');
  o.pipeline = { id: 'p_budget' };
  assert.equal(o._remainingPipelineBudgetUsd(), null, 'no cap set');
  await setPipelineCostLimitUsd(5);                                     // the developer's own cap, read via pipelineCostLimitUsd (settings.mjs:651)
  o.state.totalCostUsd = 1.5;
  near(o._remainingPipelineBudgetUsd(), 3.5);
  await setPipelineCostLimitUsd(null);
});

// ── v2: the port, the result branch, the full booking shape, the team cap, the list-rate split and each part's override ──

test('v2 — _sessionPort(): the Task 39 shape, each method wired to the harness', () => {
  const o = unit();
  o.pipeline = { id: 'p_port', dir: '/pipe' };
  const port = o._sessionPort();
  assert.deepEqual(Object.keys(port), ['runId', 'pipelineDir', 'engine', 'mock', 'bookTurn', 'onRecord', 'stampRow', 'remainingBudgetUsd',
    'checkCostLimits', 'seedBaseline', 'saveSnapshot', 'onQueue', 'log']);
  assert.deepEqual([port.runId, port.pipelineDir, port.engine, port.mock], ['p_port', '/pipe', 'claude', true]);
  assert.equal(port.bookTurn(B('x:n_a:1', 0.4)).costSource, 'harness');
  near(o.state.steps[0].costUsd, 0.4);
  port.seedBaseline('H1', 1);
  near(o._bookSessionTurn(B('x:n_b:1', 1.25)).deltaUsd, 0.25, 'seedBaseline sets the run-level baseline');
  assert.equal(port.remainingBudgetUsd(), null);
  let gated = 0; o._checkCostLimits = () => { gated += 1; };
  port.checkCostLimits();
  assert.equal(gated, 1);
  const lines = []; o.on('log', (l) => lines.push(l));
  port.log('warn', 'hello', { nodeId: 'n_a' });
  assert.deepEqual([lines.at(-1).source, lines.at(-1).level, lines.at(-1).text, lines.at(-1).nodeId], ['session', 'warn', 'hello', 'n_a']);
  for (const f of ['onRecord', 'stampRow', 'onQueue']) assert.doesNotThrow(() => port[f]('x', {}, {}), f);
  assert.equal(unit('copilot')._sessionPort().engine, 'copilot');
});

test('v2 — a member\'s sessionBooked result is logged and books nothing; a plain result still books', () => {
  const o = unit();
  const lines = []; o.on('log', (l) => lines.push(l));
  const attr = { stepKey: 'x:n_a:1', executionId: 'x:n_a:1', nodeId: 'n_a' };
  o._onAgentEvent('implementer', { type: 'result', text: ' REPORT ', sessionBooked: true, costUsd: 5, cumulativeCost: true, sessionId: 'H9' }, attr);
  assert.equal(o.state.steps[0].costUsd, 0);
  assert.equal(o.state.steps[0].sessionCosts, undefined, 'no baseline moved');
  assert.equal(lines.at(-1).text, 'REPORT');
  o._onAgentEvent('implementer', { type: 'result', text: '', costUsd: 0.5, cumulativeCost: true, sessionId: 'S1' }, attr);
  near(o.state.steps[0].costUsd, 0.5);
});

test('v2 — the booking\'s every field: Δ, the split at the resolved host model, hostPriced, the checks, open turns closed', () => {
  const o = unit();
  o._openTurns = new Map([['x:n_a:1', { model: null, msgModel: null, perMsg: new Map() }]]);
  const r = o._bookSessionTurn(B('x:n_a:1', 0.5, { memberUsage: { input_tokens: 5000, output_tokens: 700 } }));
  const est = priceUsage('claude-opus-5-5', { input_tokens: 5000, output_tokens: 700 });
  assert.deepEqual(Object.keys(r), ['deltaUsd', 'memberUsd', 'hostOverheadUsd', 'costSource', 'hostPriced', 'overridden', 'carried', 'reconcile']);
  assert.deepEqual([r.deltaUsd, r.costSource, r.hostPriced, r.overridden, r.carried], [0.5, 'harness', true, false, null]);
  near(r.memberUsd, 0.4989);
  near(r.hostOverheadUsd, 0.0011);
  assert.equal(r.reconcile.ok, false, 'the member\'s priced usage is far from its harness share');
  assert.deepEqual(r.reconcile.checks.map((c) => [c.method, c.ok]), [['estimate', false]]);
  near(r.reconcile.checks[0].otherUsd, est);
  assert.equal(o._openTurns.has('x:n_a:1'), false);
  const unpriced = o._bookSessionTurn(B('x:n_b:1', 0.7, { hostModel: 'no-such-model' }));
  assert.deepEqual([unpriced.hostPriced, unpriced.hostOverheadUsd], [false, 0]);
  near(unpriced.memberUsd, 0.2, 'an unpriceable main agent books 0 overhead; the step keeps the Δ');
  assert.deepEqual(o.state.steps[1].auxCosts.session, { usd: 0, calls: 1 }, 'a $0 hand-off still counts (C22)');
});

test('v2 — a carried split with no Δ carries nothing (the cut stays pending; a blank row stays blank); Δ with a bridge figure still advances the baseline', () => {
  const o = unit();
  delete o.state.steps[0].costUsd;                                       // a real row starts blank
  const r = o._bookSessionTurn(B('x:n_b:1', NaN, { carried: { executionId: 'x:n_a:1', cutUsd: 0.07 } }));
  assert.equal(r.carried, null, 'v3: nothing carried, so the SessionHost keeps the cut for the next Δ (or books its estimate)');
  assert.equal(o.state.steps[0].costUsd, undefined, 'never $0 on the cut row');
  assert.equal(r.costSource, 'estimate', 'no Δ on an engine with cost: the member\'s priced usage');
  recordBridgeCost({ tag: 'x:n_a:1', costUsd: 0.3 });
  o._bookSessionTurn(B('x:n_a:1', 0.1));
  near(o._bookSessionTurn(B('x:n_b:1', 0.4)).deltaUsd, 0.3, 'the bridged turn still moved the run-level baseline to 0.1');
});

test('v2 — a cut estimate on an engine without cost books nothing (C24)', () => {
  const o = unit('copilot');
  delete o.state.steps[0].costUsd;
  const r = o._bookSessionTurn({ ...B('x:n_a:1', NaN), cutEstimateUsd: 0.05 });
  assert.equal(r.costSource, 'none');
  assert.equal(o.state.steps[0].costUsd, undefined);
});

test('v2 — the remaining budget: the own cap\'s override lifts it; a team soft cap counts only where reaching it pauses', async () => {
  const o = unit();
  o.pipeline = { id: 'p_team' };
  o.state.totalCostUsd = 1;
  o.policyRun = { fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 4, onBreach: 'pause' } } };
  near(o._remainingPipelineBudgetUsd(), 3, 'the team soft cap pauses an attended run');
  o.policyRun.fields['cost.pipelineLimitUsd'].onBreach = 'warn';
  assert.equal(o._remainingPipelineBudgetUsd(), null, 'onBreach warn: the turn must not stop there');
  o.policyRun.fields['cost.pipelineLimitUsd'].onBreach = 'pause';
  o.auto = true;
  assert.equal(o._remainingPipelineBudgetUsd(), null, 'an unattended run goes on past a team soft cap');
  o.auto = false;
  await setPipelineCostLimitUsd(2.5);
  near(o._remainingPipelineBudgetUsd(), 1.5, 'the tighter of the two');
  await setPipelineCostLimitUsd(null);
  o.policyRun = undefined;
});

test('v2 — the split is taken at the CLI\'s list rates; each part then takes its own override (run 5 cycle 4)', async () => {
  near(listCostRates('claude-haiku-4-5-20251001').input, PREDEFINED_LIST_PRICES['claude-haiku-4-5'].input);
  assert.equal(listCostRates('nope'), null);
  assert.equal(listCostRates(null), null);
  await addGlobalModel({ id: 'claude-haiku-4-5', cost: { free: true } });
  try {
    assert.equal(liveCostRates('claude-haiku-4-5').input, 0, 'the display reader takes the override');
    assert.equal(listCostRates('claude-haiku-4-5').input, PREDEFINED_LIST_PRICES['claude-haiku-4-5'].input, 'the list reader never does');
    const o = unit();
    const r = o._bookSessionTurn(B('x:n_a:1', 0.5));
    near(r.memberUsd, 0.4989, 'the host\'s list-price share is still taken out of the CLI figure');
    assert.deepEqual([r.hostOverheadUsd, r.overridden], [0, true], '{free} main agent: its share books $0');
    near(o.state.steps[0].costUsd, 0.4989);
    assert.deepEqual(o.state.steps[0].auxCosts.session, { usd: 0, calls: 1 });
  } finally { await removeGlobalModel('claude-haiku-4-5'); }
  await addGlobalModel({ id: 'claude-opus-5-5', cost: { perMtok: { input: 1, output: 2 } } });
  try {
    const o = unit();
    const r = o._bookSessionTurn(B('x:n_a:1', 0.5, { memberUsage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } }));
    near(r.memberUsd, 3, '{perMtok} re-prices the member from its own usage');
    const u = { input_tokens: 1000, output_tokens: 100 };
    near(splitTurnCost({ deltaUsd: 0.5, hostUsage: u, hostModel: 'claude-haiku-4-5', memberUsage: u, memberModel: 'claude-opus-5-5', engineCost: true, ratesFor: listCostRates }).estimateUsd,
      priceUsage('claude-opus-5-5', u, { ratesFor: listCostRates }), 'v4: the estimate check reads the list rates too');
    near(r.hostOverheadUsd, 0.0011);
    const lines = []; o.on('log', (l) => lines.push(l));
    const n = o._bookSessionTurn(B('x:n_b:1', 0.9, { memberUsage: null }));
    assert.equal(n.memberUsd, null, 'a {perMtok} member with no usage is unpriceable, never $0');
    assert.ok(lines.some((l) => l.level === 'warn' && /priced per-Mtok but the turn carried no token usage/.test(l.text)));
  } finally { await removeGlobalModel('claude-opus-5-5'); }
});

test('v3 — the remaining budget is withheld when a turn model is booked at other prices than the CLI\'s meter (an override, a base-URL route)', async () => {
  const o = unit();
  o.pipeline = { id: 'p_models' };
  await setPipelineCostLimitUsd(5);
  try {
    o.state.totalCostUsd = 1;
    near(o._remainingPipelineBudgetUsd({ models: ['claude-opus-5-5', 'claude-haiku-4-5'] }), 4, 'list-priced models: the flag stands');
    await addGlobalModel({ id: 'claude-opus-5-5', cost: { free: true } });
    try {
      assert.equal(o._sessionPort().remainingBudgetUsd({ models: ['claude-opus-5-5'] }), null, 'the port forwards the models (v4: under an override)');
      assert.equal(o._remainingPipelineBudgetUsd({ models: ['claude-haiku-4-5', 'claude-opus-5-5'] }), null, 'a {free} member: the CLI would stop a turn the books say may go on');
      near(o._remainingPipelineBudgetUsd({ models: ['claude-haiku-4-5'] }), 4);
      near(o._remainingPipelineBudgetUsd(), 4, 'no models named: as before');
    } finally { await removeGlobalModel('claude-opus-5-5'); }
    await addGlobalModel({ id: 'my-routed', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9' } });
    try {
      assert.equal(o._remainingPipelineBudgetUsd({ models: ['my-routed'] }), null, 'a base-URL route: its spend is not the CLI\'s list figure');
    } finally { await removeGlobalModel('my-routed'); }
  } finally { await setPipelineCostLimitUsd(null); }
});

// ── v4: the carried split per cut part at LIST rates; the budget's overrides; the cut estimate's fields ──

test('v4 — C9: cut parts are carried oldest first, each to its own row, at LIST rates; each keeps its own override ratio', () => {
  const o = unit();
  o.state.steps.push({ key: 'x:n_c:1', executionId: 'x:n_c:1', nodeId: 'n_c', costUsd: 0 });
  o._bookSessionTurn(B('x:n_a:1', 0.2));
  const parts = [{ turnId: 't:2', dispatchId: 'd:x:n_a:1:a2', executionId: 'x:n_a:1', cutUsd: 0.05, cutListUsd: 0.05 },
    { turnId: 't:3', dispatchId: 'd:x:n_b:1:a1', executionId: 'x:n_b:1', cutUsd: 0.001, cutListUsd: 0.4 }];
  const r = o._bookSessionTurn(B('x:n_c:1', 0.9, { carried: { ...parts[0], cutUsd: 0.051, cutListUsd: 0.45, parts } }));
  near(r.deltaUsd, 0.7);
  assert.deepEqual(r.carried.parts.map((p) => [p.turnId, p.executionId]), [['t:2', 'x:n_a:1'], ['t:3', 'x:n_b:1']]);
  near(r.carried.parts[0].usd, 0.05);
  near(r.carried.parts[1].usd, 0.001, 'a {free}-ish cut: its list share leaves the Δ, its own price is booked');
  near(r.carried.usd, 0.051);
  assert.deepEqual([r.overridden, r.carried.parts.map((p) => p.overridden)], [false, [false, true]], 'v5: the override is the cut record\'s (C9), not this turn\'s');
  near(o.state.steps[0].costUsd, 0.25);
  near(o.state.steps[1].costUsd, 0.001);
  near(o.state.steps[2].costUsd, 0.25, 'the current step pays only Δ minus the cuts\' LIST spend');
  const short = unit();
  short._bookSessionTurn(B('x:n_a:1', 0.2));
  const s = short._bookSessionTurn(B('x:n_b:1', 0.23, { carried: { ...parts[0], parts } }));
  assert.deepEqual(s.carried.parts.map((p) => Math.round(p.usd * 1e6) / 1e6), [0.03, 0], 'a short Δ goes to the oldest cut first');
  near(short.state.steps[1].costUsd, 0);
});

test('v4 — a {free} member cut on the host, then another member: the cut row books its own (free) price; the next pays only its own', async () => {
  await addGlobalModel({ id: 'claude-opus-5-5', cost: { free: true } });
  try {
    const o = unit();
    o.pipeline = { id: 'p_cut', dir: mkdtempSync(join(tmpdir(), 'worca-sess-cut-')) };
    const recs = [];
    const port = { ...o._sessionPort(), onRecord: (sid, r) => recs.push(r) };
    mockT.resetSessions();
    const list = (model) => priceUsage(model, MOCK_MEMBER_USAGE, { ratesFor: listCostRates });
    mockT.costFor = ({ agentType }) => list(agentType.includes('n_a') ? 'claude-opus-5-5' : 'claude-sonnet-5-5');   // the CLI meters at list
    mockT.behave = ({ turn }) => (turn === 1 ? 'host-error-after-member' : null);
    const hosts = createSessionHosts({ specs: [spec(['n_a', 'n_b'], { hostModel: 'claude-haiku-4-5' })], decisions: decisions(), port, transport: runMockSession });
    await hosts.hostFor('n_a').run(mockMember('x:n_a:1'), member('n_a'));
    const cut = hosts.snapshot()[SID].openCut;
    near(cut.cutListUsd - cut.cutUsd, list('claude-opus-5-5'), 'the cut at list rates holds the member\'s list spend; at the operator\'s, $0');
    await hosts.hostFor('n_a').run(mockMember('x:n_b:1', [], { model: 'claude-sonnet-5-5' }), member('n_b'));
    const delta = recs.filter((r) => r.kind === 'turn_end').at(-1).deltaUsd;
    near(o.state.steps[0].costUsd, cut.cutUsd, 'the {free} member\'s row: only its main agent\'s share');
    near(o.state.steps[1].costUsd, delta - cut.cutListUsd, 'the next member never pays the cut member\'s list spend');
    await hosts.close('done');
  } finally {
    await removeGlobalModel('claude-opus-5-5');
    mockT.resetSessions(); mockT.behave = null; mockT.costFor = null;
  }
});

test('v4 — the remaining budget: the per-pipeline override drops the own cap, the team override drops the team cap', async () => {
  const o = unit();
  const { id } = await seedPipeline(join(tmpdir(), 'worca-sess-book-ov'), { status: 'running' });
  o.pipeline = { id };
  o.state.totalCostUsd = 1;
  await setPipelineCostLimitUsd(2.5);
  try {
    o.policyRun = { fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: 4, onBreach: 'pause' } } };
    near(o._remainingPipelineBudgetUsd(), 1.5, 'the tighter own cap');
    setCostCapOverride(id);
    near(o._remainingPipelineBudgetUsd(), 3, '"disregard the cap": the team soft cap still meters it');
    writePolicyState(id, { overrides: ['pipeline'] });
    assert.equal(o._remainingPipelineBudgetUsd(), null, '"continue past the team cap" too: nothing meters it');
  } finally { await setPipelineCostLimitUsd(null); o.policyRun = undefined; }
});

// ── v5: a $0 carried share leaves a blank row blank; the override flags of a {free} carry, end to end ──

test('v5 — a carried share of $0 (a short Δ) books nothing: the cut row stays blank (C24); a {free} share still books its real $0', () => {
  const o = unit();
  o.state.steps.push({ key: 'x:n_c:1', executionId: 'x:n_c:1', nodeId: 'n_c' });   // blank: no booking yet
  o.state.steps.push({ key: 'x:n_d:1', executionId: 'x:n_d:1', nodeId: 'n_d' });
  o._bookSessionTurn(B('x:n_a:1', 0.2));
  const parts = [{ turnId: 't:2', executionId: 'x:n_d:1', cutUsd: 0.05, cutListUsd: 0.05 }, { turnId: 't:3', executionId: 'x:n_c:1', cutUsd: 0.4, cutListUsd: 0.4 }];
  const r = o._bookSessionTurn(B('x:n_b:1', 0.23, { carried: { ...parts[0], parts } }));
  assert.deepEqual(r.carried.parts.map((p) => Math.round(p.usd * 1e6) / 1e6), [0.03, 0]);
  assert.equal(o.state.steps[2].costUsd, undefined, 'the second cut got nothing back from this Δ: its row stays blank, never $0.00');
  near(o.state.steps[3].costUsd, 0.03);
  const f = unit();
  f.state.steps.push({ key: 'x:n_c:1', executionId: 'x:n_c:1', nodeId: 'n_c' });
  f._bookSessionTurn(B('x:n_a:1', 0.2));
  f._bookSessionTurn(B('x:n_b:1', 0.7, { carried: { turnId: 't:2', executionId: 'x:n_c:1', cutUsd: 0, cutListUsd: 0.1 } }));
  assert.equal(f.state.steps[2].costUsd, 0, 'a {free} cut took back its list spend and books its own price: a real $0');
});
