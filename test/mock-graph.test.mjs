// test/mock-graph.test.mjs
// The offline MOCK chain, audited as a whole (plan Task 23).
//
// The chain is: sidecar `mockRole` -> clarifier runnerType -> a node whose output
// feeds an `expands` input -> a declared verdict -> the generic producer
// (`resolveMockRole`, executor.mjs), and every link of it must land on a `case`
// the writer switch in `runMock` actually handles. The unit-level chain is pinned
// in graph-executor.test.mjs; what this file adds is the two things a unit test
// cannot see:
//
//   1. the STRUCTURAL audit — the writer switch's case labels and the
//      `MOCK_WRITER_ROLES` export are the same set, and the 11 builtin sidecars
//      pin roles that already exist in it (so the switch needs no new case
//      strings), with the delta between the two spelled out;
//   2. the BEHAVIOURAL audit — real graphs run to completion offline. The two
//      canonical fixtures terminate because the mock verdicts get less severe
//      each cycle, an ALL-CUSTOM graph (clarifier -> producer -> expands
//      consumer -> verifier loop -> End) reaches its End card with agents the
//      engine has never heard of, and no flow card ever spawns a runner.
//
// GENERICITY: the all-custom case is the load-bearing one. Every key in it is a
// user sidecar, so if any part of the chain ever keys off a builtin agent name,
// that test goes red first.

import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { _resetForTests } from '../src/core/db.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeWorkflow } from '../src/core/workflows.mjs';
import { MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER } from '../src/core/claude-runner.mjs';
import { FIXTURE_DEFAULT, FIXTURE_FLOW } from '../src/core/graph/fixtures.mjs';
import { SEVERITIES, hasBlocking } from '../src/core/protocol.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// ── 1. structural audit: the switch, the export, the builtin sidecars ─────────

/** The `case` labels of runMock's writer switch, read straight off the source —
 *  the only way to prove the export has not drifted from the switch it claims to
 *  mirror. Identifier cases resolve through the constants they name. */
async function writerSwitchRoles() {
  const src = await readFile(join(REPO, 'src/core/claude-runner.mjs'), 'utf8');
  const start = src.indexOf('switch (role) {');
  assert.notEqual(start, -1, 'runMock still dispatches on `switch (role)`');
  const end = src.indexOf('default:', start);
  assert.notEqual(end, -1, 'the switch still has a default arm');
  const named = { MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER };
  const roles = [...src.slice(start, end).matchAll(/^\s*case\s+(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*)):/gm)]
    .map(([, literal, ident]) => {
      if (literal !== undefined) return literal;
      assert.ok(ident in named, `case ${ident}: names a constant this audit does not know`);
      return named[ident];
    });
  assert.ok(roles.length > 0, 'the switch has case arms');
  return new Set(roles);
}

/** Every builtin sidecar's declared `mockRole`, keyed by agent key. Read from the
 *  shipped `agents/` dir, not the registry, so a normalization change cannot mask
 *  a missing pin. */
async function builtinMockRoles() {
  const dir = join(REPO, 'agents');
  const out = {};
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.meta.json'))) {
    const meta = JSON.parse(await readFile(join(dir, file), 'utf8'));
    out[meta.key] = meta.mockRole ?? null;
  }
  return out;
}

test('MOCK_WRITER_ROLES is exactly the writer switch case set', async () => {
  const fromSwitch = await writerSwitchRoles();
  assert.deepEqual(
    [...fromSwitch].sort(), [...MOCK_WRITER_ROLES].sort(),
    'the export and the switch it mirrors must not drift',
  );
});

test('the 11 builtins pin roles the switch already handles — no new case strings', async () => {
  const pinned = await builtinMockRoles();
  assert.equal(Object.keys(pinned).length, 11, 'the 11 builtin sidecars');
  for (const [key, role] of Object.entries(pinned)) {
    assert.notEqual(role, null, `${key} pins an explicit mockRole`);
    assert.ok(MOCK_WRITER_ROLES.has(role), `${key} -> ${role} is a handled writer role`);
  }
  // Nothing in the switch is orphaned either: what the builtins do not claim is
  // exactly the three roles no sidecar can pin — the agent generator's own
  // writer, and the two ends of the generic fallback chain.
  const unclaimed = [...MOCK_WRITER_ROLES].filter((r) => !Object.values(pinned).includes(r));
  assert.deepEqual(
    unclaimed.sort(), ['agent-gen', 'generic-producer', 'generic-verifier'],
    'the switch carries no case the chain can never reach',
  );
});

// ── shared offline-run harness ────────────────────────────────────────────────

const prevHome = process.env.WORCA_HOME;
const prevMock = process.env.WORCA_MOCK;
let home;
let proj;

beforeEach(async () => {
  _resetForTests();
  home = await mkdtemp(join(tmpdir(), 'worca-cc-mockgraph-home-'));
  process.env.WORCA_HOME = home;
  process.env.WORCA_MOCK = '1';
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-mockgraph-proj-'));
  await writeFile(join(proj, 'README.md'), '# demo\n', 'utf8');
  execFileSync('git', ['init', '-q'], { cwd: proj });
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'], { cwd: proj });
});

afterEach(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME;
  else process.env.WORCA_HOME = prevHome;
  if (prevMock === undefined) delete process.env.WORCA_MOCK;
  else process.env.WORCA_MOCK = prevMock;
  for (const d of [home, proj]) if (d) await rm(d, { recursive: true, force: true });
  home = undefined;
  proj = undefined;
});

after(async () => {
  for (const d of [home, proj]) if (d) await rm(d, { recursive: true, force: true });
});

/** Run one saved template to completion, entirely offline, collecting the trace
 *  the assertions below need. */
async function runOffline(workflowId, prompt) {
  const orch = createOrchestrator({
    projectDir: proj, prompt, workflowId, auto: true, claude: { mock: true },
  });
  const execs = [];
  const logs = [];
  const questions = [];
  orch.on('exec', (e) => { if (e.status === 'start') execs.push(e); });
  orch.on('log', (e) => logs.push(e));
  orch.on('question', (e) => questions.push(e));
  const res = await orch.run();
  return { orch, res, execs, logs, questions, dir: orch.getState().pipelineDir };
}

/** The nodes whose prompts actually reached the mock runner, from its own opening
 *  log line. A flow card has no prompt at all, so it can never appear here. */
const spawnedNodes = (logs) => new Set(
  logs.filter((l) => /^\[mock\] starting role=/.test(l.text || '')).map((l) => l.nodeId),
);

/** Severity rank: SEVERITIES is ordered most-severe-first, so a LARGER index is a
 *  milder finding and an empty verdict is milder than anything. */
const worst = (issues) => (issues || []).reduce(
  (rank, i) => Math.min(rank, SEVERITIES.indexOf(i.severity)), SEVERITIES.length,
);

/** Every `<stem>-cycle<N>.json` verdict the run wrote, grouped by stem and sorted
 *  by cycle — one group per looping verifier. */
async function verdictsByStem(dir) {
  const out = new Map();
  for (const file of await readdir(dir)) {
    const m = /^(.+)-cycle(\d+)\.json$/.exec(file);
    if (!m) continue;
    const review = JSON.parse(await readFile(join(dir, file), 'utf8'));
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push({ cycle: Number(m[2]), issues: review.issues || [] });
  }
  for (const list of out.values()) list.sort((a, b) => a.cycle - b.cycle);
  return out;
}

/** Every verifier loop closed on its own: strictly milder each cycle, and clean
 *  at the last one. That is WHY these runs terminate offline — not a gate. */
function assertSeveritiesDecrease(byStem, label) {
  assert.ok(byStem.size > 0, `${label}: at least one verifier wrote a verdict`);
  for (const [stem, cycles] of byStem) {
    assert.ok(cycles.length >= 2, `${label}/${stem}: the loop turned at least once`);
    assert.deepEqual(
      cycles.map((c) => c.cycle), cycles.map((_, i) => i + 1),
      `${label}/${stem}: one verdict per ordinal, from 1`,
    );
    for (let i = 1; i < cycles.length; i += 1) {
      assert.ok(
        worst(cycles[i].issues) > worst(cycles[i - 1].issues),
        `${label}/${stem}: cycle ${cycles[i].cycle} is strictly milder than ${cycles[i - 1].cycle}`,
      );
    }
    assert.equal(
      hasBlocking({ issues: cycles.at(-1).issues }), false,
      `${label}/${stem}: the last verdict is clean, so the clean port fires`,
    );
  }
}

// ── 2. the canonical fixtures run offline and terminate on severity ───────────

test('FIXTURE_DEFAULT runs to End offline; every verifier loop decays by cycle', async () => {
  const { res, execs, logs, questions, dir } = await runOffline('wf_default', 'demo default graph');
  assert.equal(res.status, 'done');
  assert.equal(res.endReached, true, 'the run resolved THROUGH the End card');

  assert.deepEqual(
    execs.filter((e) => e.agentKey).map((e) => `${e.agentKey}:${e.ordinal}`),
    ['clarify:1', 'planner:1', 'refiner:1', 'refiner:2', 'implementer:1', 'reviewer:1',
      'implementer:2', 'reviewer:2'],
    'both loops turn exactly once — the mock verdicts converge',
  );
  assertSeveritiesDecrease(await verdictsByStem(dir), 'wf_default');
  assert.equal(
    questions.filter((q) => q.kind === 'gate').length, 0,
    'no loop-budget gate fired: termination came from the severities, not the ceiling',
  );
  assert.equal(
    logs.some((l) => /no side effects for unknown role/.test(l.text || '')), false,
    'every node resolved to a role the writer switch handles',
  );
});

test('FIXTURE_FLOW (or/and/await/End) runs to End offline with the same decay', async () => {
  await writeWorkflow(structuredClone(FIXTURE_FLOW));
  const { res, execs, questions, dir } = await runOffline(FIXTURE_FLOW.id, 'demo flow graph');
  assert.equal(res.status, 'done');
  assert.equal(res.endReached, true);

  assert.deepEqual(
    execs.filter((e) => e.agentKey).map((e) => `${e.agentKey}:${e.ordinal}`),
    ['planner:1', 'refiner:1', 'refiner:2', 'implementer:1', 'reviewer:1',
      'implementer:2', 'reviewer:2', 'manualTestsChecklist:1'],
    'the AND gate holds the checklist until the refined plan AND the clean review land',
  );
  assertSeveritiesDecrease(await verdictsByStem(dir), 'wf_flow_fixture');
  assert.equal(questions.filter((q) => q.kind === 'gate').length, 0);
});

// ── 3. flow cards spawn nothing ───────────────────────────────────────────────

/** FIXTURE_FLOW with its End fed through a COMBINE card instead of directly, so a
 *  single graph carries all five flow kinds: task, or, and, combine, end. */
const FLOW_ALL = (() => {
  const tpl = structuredClone(FIXTURE_FLOW);
  tpl.id = 'wf_flow_all';
  tpl.name = 'Flow (all cards)';
  tpl.nodes.push({ id: 'n_comb', kind: 'combine', x: 1600, y: 260, config: { arity: 2 } });
  tpl.wires = tpl.wires.filter((w) => w.id !== 'w14');
  tpl.wires.push(
    { id: 'w14', from: { node: 'n_check', port: 'checklist' }, to: { node: 'n_comb', port: 'in1' } },
    { id: 'w15', from: { node: 'n_refine', port: 'plan' }, to: { node: 'n_comb', port: 'in2' } },
    { id: 'w16', from: { node: 'n_comb', port: 'out' }, to: { node: 'n_end', port: 'result' } },
  );
  return tpl;
})();

test('task/and/or/combine/end executions spawn no runner at all', async () => {
  await writeWorkflow(structuredClone(FLOW_ALL));
  const { res, execs, logs } = await runOffline(FLOW_ALL.id, 'demo every flow card');
  assert.equal(res.status, 'done');
  assert.equal(res.endReached, true, 'the End card resolves through the combine');

  const flow = FLOW_ALL.nodes.filter((n) => n.kind !== 'agent');
  assert.deepEqual(
    [...new Set(flow.map((n) => n.kind))].sort(), ['and', 'combine', 'end', 'or', 'task'],
    'all five flow kinds are in this graph',
  );
  const ran = new Set(execs.map((e) => e.nodeId));
  for (const n of flow) assert.ok(ran.has(n.id), `${n.kind} card ${n.id} executed`);

  const spawned = spawnedNodes(logs);
  for (const n of flow) {
    assert.equal(spawned.has(n.id), false, `${n.kind} card ${n.id} spawned no runner`);
  }
  assert.deepEqual(
    [...spawned].sort(),
    FLOW_ALL.nodes.filter((n) => n.kind === 'agent').map((n) => n.id).sort(),
    'exactly the agent nodes reached the runner',
  );
  // inferRole's prompt sniffing is unreachable from the graph path: every spawn
  // carried an explicit MOCK_ROLE, so nothing ever fell through to 'unknown'.
  assert.equal(logs.some((l) => /no side effects for unknown role/.test(l.text || '')), false);
});

// ── 4. an ALL-CUSTOM graph completes offline ──────────────────────────────────

/** Four user agents the engine has never heard of, one per link of the chain:
 *  a clarifier (-> `clarify`), a producer feeding an `expands` input
 *  (-> `decomposer`), the expands consumer (-> `generic-producer`), and a
 *  verifier with a verdict (-> `generic-verifier`). */
const CUSTOM_AGENTS = {
  askBot: {
    metaVersion: 2,
    key: 'askBot', displayName: 'Ask Bot', description: 'asks the open questions',
    color: 'violet', icon: '<p/>', agentFile: 'askBot.md', runnerType: 'clarifier', order: 40,
    inputs: [{ id: 'brief', type: 'md' }],
    outputs: [{ id: 'answers', type: 'json', filename: 'ask-answers.json' }],
  },
  sketcher: {
    metaVersion: 2,
    key: 'sketcher', displayName: 'Sketcher', description: 'splits the brief into pieces',
    color: 'green', icon: '<p/>', agentFile: 'sketcher.md', runnerType: 'producer', order: 41,
    inputs: [
      { id: 'brief', type: 'md' },
      { id: 'answers', type: 'json' },
    ],
    outputs: [{ id: 'pieces', type: 'json', filename: 'pieces.json' }],
  },
  crafter: {
    metaVersion: 2,
    key: 'crafter', displayName: 'Crafter', description: 'crafts one piece',
    color: 'blue', icon: '<p/>', agentFile: 'crafter.md', runnerType: 'producer',
    order: 42, sideEffect: 'code',
    inputs: [
      { id: 'brief', type: 'md' },
      { id: 'piece', type: 'json', required: false, expands: true, directive: 'Craft exactly this piece.' },
      { id: 'fix', type: 'md', required: false, loop: true, directive: 'Address the audit findings.' },
    ],
    outputs: [{ id: 'built', type: 'void' }],
  },
  auditor: {
    metaVersion: 2,
    key: 'auditor', displayName: 'Auditor', description: 'audits the craft',
    color: 'red', icon: '<p/>', agentFile: 'auditor.md', runnerType: 'verifier', order: 43,
    verdict: { filename: 'audit-cycle{cycle}.json' },
    inputs: [
      { id: 'brief', type: 'md' },
      { id: 'built', type: 'void', required: false },
    ],
    outputs: [
      { id: 'findings', type: 'md', when: 'blocking', filename: 'audit-cycle{cycle}.md' },
      { id: 'ok', type: 'void', when: 'clean' },
    ],
  },
};

/** Task -> clarifier -> producer -> expands consumer -> verifier loop -> End.
 *  Every agent node is a user key; the End card is mandatory (V21). */
const ALL_CUSTOM = {
  id: 'wf_all_custom',
  name: 'All Custom',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_ask', kind: 'agent', key: 'askBot', x: 200, y: 0, config: {} },
    { id: 'n_sketch', kind: 'agent', key: 'sketcher', x: 400, y: 0, config: {} },
    { id: 'n_craft', kind: 'agent', key: 'crafter', x: 600, y: 0, config: {} },
    { id: 'n_audit', kind: 'agent', key: 'auditor', x: 800, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 1000, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_ask', port: 'brief' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_sketch', port: 'brief' } },
    { id: 'w3', from: { node: 'n_ask', port: 'answers' }, to: { node: 'n_sketch', port: 'answers' } },
    { id: 'w4', from: { node: 'n_sketch', port: 'pieces' }, to: { node: 'n_craft', port: 'piece' } },
    { id: 'w5', from: { node: 'n_task', port: 'task' }, to: { node: 'n_craft', port: 'brief' } },
    { id: 'w6', from: { node: 'n_craft', port: 'built' }, to: { node: 'n_audit', port: 'built' } },
    { id: 'w7', from: { node: 'n_task', port: 'task' }, to: { node: 'n_audit', port: 'brief' } },
    { id: 'w8', from: { node: 'n_audit', port: 'findings' }, to: { node: 'n_craft', port: 'fix' }, config: { maxCycles: 3 } },
    { id: 'w9', from: { node: 'n_audit', port: 'ok' }, to: { node: 'n_end', port: 'result' } },
  ],
};

/** The mock decomposer always writes 2 phases — p1t1 + p1t2, then p2t1. */
const MOCK_TASK_IDS = ['p1t1', 'p1t2', 'p2t1'];

async function installCustomAgents() {
  const dir = join(home, '.worca-cc', 'agents');
  await mkdir(dir, { recursive: true });
  for (const [key, meta] of Object.entries(CUSTOM_AGENTS)) {
    await writeFile(join(dir, `${key}.md`), `# ${meta.displayName}\n\nYou are ${meta.description}.\n`);
    await writeFile(join(dir, `${key}.meta.json`), JSON.stringify(meta));
  }
}

test('an ALL-CUSTOM graph reaches End offline: clarify -> decompose -> craft -> audit', async () => {
  await installCustomAgents();
  await writeWorkflow(structuredClone(ALL_CUSTOM));
  const { res, execs, logs, questions, dir } = await runOffline(ALL_CUSTOM.id, 'demo all custom');

  assert.equal(res.status, 'done');
  assert.equal(res.endReached, true, 'the all-custom graph resolved THROUGH its own End card');

  // Every link of the chain fired, in order, with agents the engine never saw.
  assert.deepEqual(
    execs.filter((e) => e.agentKey && e.kind !== 'task').map((e) => `${e.agentKey}:${e.ordinal}`),
    ['askBot:1', 'sketcher:1', 'crafter:1', 'auditor:1', 'crafter:2', 'auditor:2'],
    'the custom verifier loop turns exactly once, then converges',
  );

  // 2. the clarifier gated ONCE and the answers token unblocked the producer.
  const clarifyGates = questions.filter((q) => q.kind === 'clarify');
  assert.equal(clarifyGates.length, 1, 'the custom clarifier gates exactly once');
  assert.equal(clarifyGates[0].nodeId, 'n_ask');
  assert.equal(clarifyGates[0].questions.length, 2, 'the offline clarifier asked its MOCK_PRIOR=0 questions');
  const answers = JSON.parse(await readFile(join(dir, 'ask-answers.json'), 'utf8'));
  assert.equal(answers.answers.length, 2, 'the engine rewrote the file with the answers');

  // 3. the expands producer resolved to `decomposer` and emitted a parseable
  //    decomposition, so the consumer fanned out under its OWN node.
  const decomposition = JSON.parse(await readFile(join(dir, 'pieces.json'), 'utf8'));
  assert.deepEqual(decomposition.phases.map((p) => p.ordinal), [1, 2]);
  const slices = execs.filter((e) => e.kind === 'task');
  assert.deepEqual(slices.map((e) => e.taskId), MOCK_TASK_IDS);
  for (const s of slices) {
    assert.equal(s.nodeId, 'n_craft', 'the slices run under the CUSTOM consumer');
    assert.equal(s.agentKey, 'crafter');
  }

  // 4. the custom verifier mocked as `generic-verifier`, whose severities decay
  //    by ordinal — which is what closes the loop with no gate.
  assertSeveritiesDecrease(await verdictsByStem(dir), 'wf_all_custom');
  assert.equal(questions.filter((q) => q.kind === 'gate').length, 0);

  assert.equal(logs.some((l) => /no side effects for unknown role/.test(l.text || '')), false);
});

test('a custom v2 agent with a verdict mocks as generic-verifier', async () => {
  await installCustomAgents();
  await writeWorkflow(structuredClone(ALL_CUSTOM));
  const { logs, dir } = await runOffline(ALL_CUSTOM.id, 'demo custom verifier');

  const auditLines = logs.filter((l) => l.nodeId === 'n_audit' && /^\[mock\] starting role=/.test(l.text || ''));
  assert.deepEqual(
    auditLines.map((l) => l.text),
    ['[mock] starting role=generic-verifier cycle=1', '[mock] starting role=generic-verifier cycle=2'],
    'the declared verdict — not any key table — selected the writer, and MOCK_CYCLE is the ordinal',
  );
  // generic-verifier reuses the reviewer writer: md review + verdict json per
  // cycle. The md is a `blocking` output, but parity D7 keeps allocating and
  // rendering its path on EVERY execution, so the clean cycle writes one too —
  // it is simply never routed.
  for (const cycle of [1, 2]) {
    const review = JSON.parse(await readFile(join(dir, `audit-cycle${cycle}.json`), 'utf8'));
    assert.ok(Array.isArray(review.issues), `audit-cycle${cycle}.json is a review document`);
    assert.equal(hasBlocking(review), cycle === 1, 'blocking at cycle 1, clean from cycle 2');
    assert.match(
      await readFile(join(dir, `audit-cycle${cycle}.md`), 'utf8'), /^# /,
      `audit-cycle${cycle}.md is the human-readable half`,
    );
  }
});
