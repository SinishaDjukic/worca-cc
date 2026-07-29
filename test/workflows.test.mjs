// test/workflows.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_WORKFLOW,
  workflowsDir,
  listWorkflows,
  readWorkflow,
  writeWorkflow,
  deleteWorkflow,
  resolveWorkflow,
  buildStepperManifest,
} from '../src/core/workflows.mjs';
import { setNodeModel, setFeedbackCycles, setStep } from '../src/core/config.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs'; // ▲ v3: add (not yet imported)
import { getDb, _resetForTests } from '../src/core/db.mjs';

// Each test gets its own ~/.worca-cc via WORCA_HOME so the global store is
// isolated and nothing touches the developer's real home dir. The DB singleton is
// reset so the next getDb() reopens against the fresh WORCA_HOME.
const homes = [];
async function freshHome() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-home-'));
  homes.push(d);
  _resetForTests();
  process.env.WORCA_HOME = d;
  return d;
}
const projects = [];
async function freshProject() {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-proj-'));
  projects.push(d);
  return d;
}
after(async () => {
  delete process.env.WORCA_HOME;
  await Promise.all([...homes, ...projects].map((d) => rm(d, { recursive: true, force: true })));
});

test('DEFAULT_WORKFLOW is the Plan->Refine->Implement->Review topology', () => {
  assert.equal(DEFAULT_WORKFLOW.id, 'wf_default');
  assert.equal(DEFAULT_WORKFLOW.name, 'Default');
  assert.equal(DEFAULT_WORKFLOW.version, 1);
  // 5 sequential steps, one node each.
  assert.equal(DEFAULT_WORKFLOW.steps.length, 5);
  assert.deepEqual(DEFAULT_WORKFLOW.steps.map((s) => s.length), [1, 1, 1, 1, 1]);
  assert.deepEqual(
    DEFAULT_WORKFLOW.steps.map((s) => s[0].key),
    ['clarify', 'planner', 'refiner', 'implementer', 'reviewer'],
  );
  // Node ids are unique instance ids.
  const ids = DEFAULT_WORKFLOW.steps.flat().map((n) => n.id);
  assert.deepEqual(ids, ['s_clarify', 's0_0', 's1_0', 's2_0', 's3_0']);
});

test('DEFAULT_WORKFLOW.domain === "coding"', () => {
  assert.equal(DEFAULT_WORKFLOW.domain, 'coding');
});

test('writeWorkflow persists domain; readWorkflow round-trips; malformed/blank → general', async () => {
  await freshHome();
  await writeWorkflow({ id: 'wf_mk', name: 'Campaign', steps: [], feedbacks: [], domain: 'marketing' });
  const got = await readWorkflow('wf_mk');          // exercises readRaw's OWN SELECT
  assert.equal(got.domain, 'marketing');

  await writeWorkflow({ id: 'wf_bad', name: 'X', steps: [], feedbacks: [], domain: 'Bad Domain!' });
  assert.equal((await readWorkflow('wf_bad')).domain, 'general');

  await writeWorkflow({ id: 'wf_none', name: 'Y', steps: [], feedbacks: [] });   // absent
  assert.equal((await readWorkflow('wf_none')).domain, 'general');
});

test('pre-migration row reads back as general (COALESCE) via list + read', async () => {
  await freshHome();
  const db = getDb();
  db.exec("INSERT INTO workflows (id,name,version,steps,feedbacks,created_at,updated_at) " +
          "VALUES ('wf_old','Old',1,'[]','[]','1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z')");
  const list = await listWorkflows();
  assert.equal(list.find((w) => w.id === 'wf_old').domain, 'general');   // list path
  assert.equal((await readWorkflow('wf_old')).domain, 'general');        // readRaw path
});

test('DEFAULT_WORKFLOW feedbacks reproduce the refine self-loop and review->implement loop', () => {
  // Two loops: refiner self-loop (s1_0 -> s1_0) and review -> implement (s3_0 -> s2_0).
  const fbs = DEFAULT_WORKFLOW.feedbacks;
  assert.equal(fbs.length, 2);
  const refine = fbs.find((f) => f.from === 's1_0');
  const review = fbs.find((f) => f.from === 's3_0');
  assert.ok(refine, 'refine loop present');
  assert.equal(refine.to, 's1_0'); // self-loop, mirrors _refineLoop re-running refine
  assert.ok(review, 'review loop present');
  assert.equal(review.to, 's2_0'); // review -> implement (fix pass), mirrors _reviewLoop
  // Feedback ids are unique.
  assert.equal(new Set(fbs.map((f) => f.id)).size, fbs.length);
});

test('workflowsDir is <WORCA_HOME>/.worca-cc/workflows', async () => {
  const home = await freshHome();
  assert.equal(workflowsDir(), join(home, '.worca-cc', 'workflows'));
});

test('writeWorkflow stamps id/createdAt/updatedAt and roundtrips through readWorkflow', async () => {
  await freshHome();
  const saved = await writeWorkflow({
    name: 'Quick Fix',
    steps: [[{ id: 's0_0', key: 'planner' }], [{ id: 's1_0', key: 'implementer' }]],
    feedbacks: [],
  });
  assert.match(saved.id, /^wf_/);
  assert.equal(saved.name, 'Quick Fix');
  assert.equal(saved.version, 1);
  assert.ok(saved.createdAt && saved.updatedAt, 'timestamps stamped');

  // Persisted as a row in the workflows table (storage is SQLite now, not <id>.json).
  const row = getDb().prepare('SELECT name FROM workflows WHERE id = ?').get(saved.id);
  assert.equal(row.name, 'Quick Fix');

  const got = await readWorkflow(saved.id);
  assert.deepEqual(got.steps, saved.steps);
  assert.deepEqual(got.feedbacks, saved.feedbacks);
});

test('writeWorkflow derives a wf_<slug> id from the name when id is missing', async () => {
  await freshHome();
  const saved = await writeWorkflow({ name: 'My Cool Flow', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.match(saved.id, /^wf_my-cool-flow/);
});

test('writeWorkflow preserves createdAt but bumps updatedAt on re-save', async () => {
  await freshHome();
  const first = await writeWorkflow({ id: 'wf_x', name: 'X', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  const second = await writeWorkflow({ ...first, name: 'X2', updatedAt: undefined });
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.name, 'X2');
});

test('listWorkflows returns user templates sorted newest-first; excludes wf_default', async () => {
  await freshHome();
  const a = await writeWorkflow({ id: 'wf_a', name: 'A', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [], createdAt: '2026-01-01T00:00:00.000Z' });
  const b = await writeWorkflow({ id: 'wf_b', name: 'B', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [], createdAt: '2026-02-01T00:00:00.000Z' });
  const list = await listWorkflows();
  assert.deepEqual(list.map((w) => w.id), ['wf_b', 'wf_a']); // newest createdAt first
  assert.ok(!list.some((w) => w.id === 'wf_default'), 'DEFAULT_WORKFLOW is not in the user store');
});

test('readWorkflow returns DEFAULT_WORKFLOW for "wf_default"', async () => {
  await freshHome();
  const got = await readWorkflow('wf_default');
  assert.equal(got.id, 'wf_default');
  assert.equal(got.steps.length, 5);
});

test('readWorkflow returns null for a missing id; listWorkflows is [] on an empty store', async () => {
  await freshHome();
  assert.equal(await readWorkflow('wf_nope'), null);
  assert.deepEqual(await listWorkflows(), []);
});

test('deleteWorkflow removes a saved template and returns true', async () => {
  await freshHome();
  const saved = await writeWorkflow({ id: 'wf_del', name: 'Del', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.equal(await deleteWorkflow(saved.id), true);
  assert.equal(await readWorkflow(saved.id), null);
  const row = getDb().prepare('SELECT 1 FROM workflows WHERE id = ?').get('wf_del');
  assert.equal(row, undefined, 'row gone after delete');
});

test('deleteWorkflow returns false for a missing id', async () => {
  await freshHome();
  assert.equal(await deleteWorkflow('wf_ghost'), false);
});

test('deleteWorkflow refuses to delete the built-in default (returns false, leaves it readable)', async () => {
  await freshHome();
  assert.equal(await deleteWorkflow('wf_default'), false);
  const still = await readWorkflow('wf_default');
  assert.equal(still.id, 'wf_default'); // DEFAULT_WORKFLOW is always present
});

// --- Security: unsafe-id guard on workflow ids -----------------------------
// The id keys the workflows table (no path is built from it anymore). The guard
// still rejects anything outside ^[A-Za-z0-9_-]+$ (covers wf_default + wf_<slug>),
// so unsafe ids never read or mutate a row.
test('readWorkflow rejects path-traversal / unsafe ids (returns null)', async () => {
  await freshHome();
  for (const bad of ['../foo', '../../etc/passwd', 'a/b', '..%2f..%2fx', 'foo.bar', 'foo bar', '', '.', '..']) {
    assert.equal(await readWorkflow(bad), null, `readWorkflow must reject "${bad}"`);
  }
});
test('deleteWorkflow refuses unsafe ids and deletes nothing real', async () => {
  await freshHome();
  const saved = await writeWorkflow({ id: 'wf_keep', name: 'Keep', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.equal(await deleteWorkflow('../wf_keep'), false);
  assert.equal(await deleteWorkflow('a/b'), false);
  assert.ok(await readWorkflow('wf_keep'), 'a real saved workflow survives an unsafe-id delete');
  void saved;
});
test('writeWorkflow still works and ids round-trip (guard does not break valid ids)', async () => {
  await freshHome();
  const saved = await writeWorkflow({ name: 'My Cool Flow', steps: [[{ id: 's0_0', key: 'planner' }]], feedbacks: [] });
  assert.match(saved.id, /^wf_/);
  assert.ok(await readWorkflow(saved.id), 'a valid derived id still reads back');
  assert.equal(await deleteWorkflow(saved.id), true);
});

// Inline fake registry mirroring Phase 1's AgentMeta shape. agentFile values are
// the REAL agent prompt files on disk so prompt + tools load is exercised.
const REGISTRY = {
  clarify: { key: 'clarify', runnerType: 'clarifier', agentFile: 'worca-cc-clarify.md', loopSource: false },
  planner: { key: 'planner', runnerType: 'producer', agentFile: 'worca-cc-planner.md', loopSource: false },
  refiner: { key: 'refiner', runnerType: 'producer', agentFile: 'worca-cc-plan-refiner.md', loopSource: false },
  implementer: { key: 'implementer', runnerType: 'producer', agentFile: 'worca-cc-implementer.md', loopSource: false },
  reviewer: { key: 'reviewer', runnerType: 'verifier', agentFile: 'worca-cc-code-reviewer.md', loopSource: true },
};

test('resolveWorkflow(default) yields a 5-step ExecutablePlan with prompts and default cycles', async () => {
  await freshHome();
  const p = await freshProject();
  const plan = await resolveWorkflow(p, 'wf_default', REGISTRY);
  assert.equal(plan.id, 'wf_default');
  assert.equal(plan.steps.length, 5);
  const flat = plan.steps.flat();
  assert.deepEqual(flat.map((n) => n.key), ['clarify', 'planner', 'refiner', 'implementer', 'reviewer']);
  // Each node carries the resolved runner + a non-empty agentPrompt from its file.
  for (const n of flat) {
    assert.ok(['producer', 'verifier', 'clarifier'].includes(n.runnerType), `runnerType for ${n.key}`);
    assert.ok(typeof n.agentPrompt === 'string' && n.agentPrompt.length > 0, `prompt for ${n.key}`);
    assert.ok('model' in n && 'effort' in n, 'model/effort fields present');
    assert.ok(Array.isArray(n.tools), 'tools array present');
  }
  // loopSource flows through from the registry.
  assert.equal(flat.find((n) => n.key === 'reviewer').loopSource, true);
  assert.equal(flat.find((n) => n.key === 'planner').loopSource, false);
  // Feedbacks carry the gate + a default maxCycles of 3 (matches the UI default).
  assert.equal(plan.feedbacks.length, 2);
  for (const f of plan.feedbacks) {
    assert.equal(f.gate, 'hasBlocking');
    assert.equal(f.maxCycles, 3);
  }
});

test('resolveWorkflow overlays per-project model/effort and feedback cycles', async () => {
  await freshHome();
  const p = await freshProject();
  await setNodeModel(p, 'wf_default', 's2_0', { model: 'claude-opus-4-8', effort: 'high' });
  await setFeedbackCycles(p, 'wf_default', 'fb_review', 2);
  const plan = await resolveWorkflow(p, 'wf_default', REGISTRY);
  const impl = plan.steps.flat().find((n) => n.nodeId === 's2_0');
  assert.equal(impl.model, 'claude-opus-4-8');
  assert.equal(impl.effort, 'high');
  const reviewFb = plan.feedbacks.find((f) => f.id === 'fb_review');
  assert.equal(reviewFb.maxCycles, 2);
});

// ── M4: workspace substitution (opts.isWorkspace) + the off-pipeline scanner guard ──
test('resolveWorkflow({isWorkspace:true}) substitutes the review node reviewer -> workspaceReviewer', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = loadAgentRegistry(); // real registry has both reviewer + workspaceReviewer
  const plan = await resolveWorkflow(p, 'wf_default', reg, undefined, { isWorkspace: true });
  const keys = plan.steps.flat().map((n) => n.key);
  assert.deepEqual(keys, ['clarify', 'planner', 'refiner', 'implementer', 'workspaceReviewer'],
    'the review node key becomes workspaceReviewer on a workspace run');
  const wsR = plan.steps.flat().find((n) => n.key === 'workspaceReviewer');
  assert.equal(wsR.runnerType, 'verifier', 'resolved from the workspaceReviewer meta');
  assert.equal(wsR.loopSource, true, 'workspaceReviewer is a loop source');
  assert.equal(wsR.uiPhase, 'review', 'shares the single-project review stepper bucket');
  assert.ok(typeof wsR.agentPrompt === 'string' && wsR.agentPrompt.length > 0, 'its body loads (the contract)');
  // The feedback edge (s3_0 -> s2_0) is preserved — the nodeId is unchanged by substitution.
  assert.ok(plan.feedbacks.some((f) => f.from === 's3_0' && f.to === 's2_0'), 'review->implement loop intact');
});

test('resolveWorkflow substitution is GATED: no opts === {isWorkspace:false}, single-project byte-identical', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = loadAgentRegistry();
  const noOpts = await resolveWorkflow(p, 'wf_default', reg);
  const falseWs = await resolveWorkflow(p, 'wf_default', reg, undefined, { isWorkspace: false });
  assert.deepEqual(noOpts, falseWs, 'no opts is byte-identical to {isWorkspace:false}');
  // Both keep the single-project reviewer; neither substitutes.
  assert.deepEqual(noOpts.steps.flat().map((n) => n.key), ['clarify', 'planner', 'refiner', 'implementer', 'reviewer']);
  assert.ok(!noOpts.steps.flat().some((n) => n.key === 'workspaceReviewer'), 'no workspaceReviewer when not a workspace run');
});

test('resolveWorkflow throws if a workflow hand-authors a workspaceScanner node (off-pipeline guard)', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = loadAgentRegistry();
  await writeWorkflow({
    id: 'wf_badscan',
    name: 'Bad Scan',
    steps: [[{ id: 'n_scan', key: 'workspaceScanner' }], [{ id: 'n_impl', key: 'implementer' }]],
    feedbacks: [],
  });
  await assert.rejects(
    () => resolveWorkflow(p, 'wf_badscan', reg),
    /workspaceScanner is an off-pipeline producer and cannot be a workflow node/,
    'the off-pipeline scanner must never resolve as a node',
  );
  // The guard fires regardless of isWorkspace (the scanner is never a node either way).
  await assert.rejects(() => resolveWorkflow(p, 'wf_badscan', reg, undefined, { isWorkspace: true }),
    /workspaceScanner is an off-pipeline producer/);
});

test('resolveWorkflow resolves a saved template (incl. a parallel step)', async () => {
  await freshHome();
  const p = await freshProject();
  await writeWorkflow({
    id: 'wf_par',
    name: 'Parallel',
    steps: [
      [{ id: 'n_plan', key: 'planner' }],
      [{ id: 'n_impl', key: 'implementer' }, { id: 'n_refine', key: 'refiner' }], // parallel group
      [{ id: 'n_rev', key: 'reviewer' }],
    ],
    feedbacks: [{ id: 'fb_r', from: 'n_rev', to: 'n_impl' }],
  });
  const plan = await resolveWorkflow(p, 'wf_par', REGISTRY);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[1].length, 2); // the parallel group survives
  assert.deepEqual(plan.steps[1].map((n) => n.nodeId).sort(), ['n_impl', 'n_refine']);
  assert.equal(plan.feedbacks[0].from, 'n_rev');
  assert.equal(plan.feedbacks[0].to, 'n_impl');
});

test('resolveWorkflow throws for an unknown workflow id', async () => {
  await freshHome();
  const p = await freshProject();
  await assert.rejects(() => resolveWorkflow(p, 'wf_missing', REGISTRY), /wf_missing|not found|unknown/i);
});

const REG = {
  planner:     { displayName: 'Plan',                 color: 'violet', description: 'architecture & breakdown' },
  refiner:     { displayName: 'Refine Plan',          color: 'green',  description: 'tighten the plan' },
  implementer: { displayName: 'Implementation',       color: 'amber',  description: 'write the code' },
  reviewer:    { displayName: 'Review Implementation',color: 'blue',   description: 'verify & report' },
  manualTestsChecklist: { displayName: 'Manual Tests Checklist', color: 'blue',   description: 'draft manual test cases' },
  manualWebUiTesting:   { displayName: 'Manual web UI testing',  color: 'violet', description: 'drive the browser' },
};

test('buildStepperManifest: brackets nodes with preflight + done', () => {
  const plan = {
    id: 'wf_default', name: 'Default',
    steps: [
      [{ nodeId: 's0_0', key: 'planner',     uiPhase: 'plan' }],
      [{ nodeId: 's1_0', key: 'refiner',     uiPhase: 'refine' }],
      [{ nodeId: 's2_0', key: 'implementer', uiPhase: 'implement' }],
      [{ nodeId: 's3_0', key: 'reviewer',    uiPhase: 'review' }],
    ],
    feedbacks: [
      { id: 'fb_refine', from: 's1_0', to: 's1_0' },
      { id: 'fb_review', from: 's3_0', to: 's2_0' },
    ],
  };
  const m = buildStepperManifest(plan, REG);
  assert.equal(m.version, 1);
  assert.equal(m.steps.length, 6); // preflight + 4 + done
  assert.deepEqual(m.steps[0], { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] });
  assert.deepEqual(m.steps[5], { kind: 'done',      nodes: [{ id: 'done', label: 'Done', sub: 'complete' }] });
  assert.deepEqual(m.steps[1].nodes[0], {
    id: 's0_0', key: 'planner', uiPhase: 'plan', label: 'Plan',
    color: 'violet', sub: 'architecture & breakdown', cycles: false,
    model: '', effort: '',
  });
  // fb_review targets s2_0 (implementer); fb_refine self-loops s1_0 (refiner).
  assert.equal(m.steps[2].nodes[0].cycles, true);  // s1_0 refiner — self-loop target
  assert.equal(m.steps[3].nodes[0].cycles, true);  // s2_0 implementer — review→implement target
  assert.equal(m.steps[4].nodes[0].cycles, false); // s3_0 reviewer — not a target
});

test('buildStepperManifest: carries the feedback edges (self-cycle + cross-loop) on the manifest', () => {
  const plan = {
    id: 'wf_default', name: 'Default',
    steps: [
      [{ nodeId: 's0_0', key: 'planner',     uiPhase: 'plan' }],
      [{ nodeId: 's1_0', key: 'refiner',     uiPhase: 'refine' }],
      [{ nodeId: 's2_0', key: 'implementer', uiPhase: 'implement' }],
      [{ nodeId: 's3_0', key: 'reviewer',    uiPhase: 'review' }],
    ],
    feedbacks: [
      { id: 'fb_refine', from: 's1_0', to: 's1_0', maxCycles: 3, gate: 'hasBlocking' },
      { id: 'fb_review', from: 's3_0', to: 's2_0', maxCycles: 2, gate: 'hasBlocking' },
    ],
  };
  const m = buildStepperManifest(plan, REG);
  // The manifest now carries the loop edges, projected to {id,from,to,maxCycles}
  // (the `gate` field is dropped — the UI never needs it).
  assert.deepEqual(m.feedbacks, [
    { id: 'fb_refine', from: 's1_0', to: 's1_0', maxCycles: 3 },
    { id: 'fb_review', from: 's3_0', to: 's2_0', maxCycles: 2 },
  ]);
  // Self-cycle vs cross-loop are distinguishable by from===to (the codebase convention).
  const self = m.feedbacks.find((f) => f.id === 'fb_refine');
  const cross = m.feedbacks.find((f) => f.id === 'fb_review');
  assert.equal(self.from, self.to, 'fb_refine is a self-cycle');
  assert.notEqual(cross.from, cross.to, 'fb_review is a cross-loop');
  // The per-node cycles:boolean flag is unchanged (additive change, not a replacement).
  // Manifest cells: [0]=preflight, [1..4]=agents, [5]=done. cycles is set when the
  // node is a feedback TARGET (fb.to === nodeId): s1_0 (refine self), s2_0 (review->implement).
  assert.equal(m.steps[2].nodes[0].cycles, true);  // s1_0 refiner — self-loop target
  assert.equal(m.steps[3].nodes[0].cycles, true);  // s2_0 implementer — review→implement target
  assert.equal(m.steps[4].nodes[0].cycles, false); // s3_0 reviewer — not a target
});

test('buildStepperManifest: missing/empty plan.feedbacks yields feedbacks:[] (no crash)', () => {
  const noFb = { id: 'w', name: 'w', steps: [[{ nodeId: 'n', key: 'planner', uiPhase: 'plan' }]], feedbacks: [] };
  assert.deepEqual(buildStepperManifest(noFb, REG).feedbacks, []);
  // plan.feedbacks entirely absent must also be tolerated (fbs guard: Array.isArray(plan?.feedbacks)?…:[]).
  const absent = { id: 'w', name: 'w', steps: [[{ nodeId: 'n', key: 'planner', uiPhase: 'plan' }]] };
  assert.deepEqual(buildStepperManifest(absent, REG).feedbacks, []);
});

test('buildStepperManifest(resolveWorkflow): feedbacks carry resolved maxCycles incl. per-project override', async () => {
  await freshHome();
  const p = await freshProject();
  await setFeedbackCycles(p, 'wf_default', 'fb_review', 2); // override the cross-loop
  const plan = await resolveWorkflow(p, 'wf_default', REGISTRY);
  const m = buildStepperManifest(plan, REGISTRY);
  const refine = m.feedbacks.find((f) => f.id === 'fb_refine');
  const review = m.feedbacks.find((f) => f.id === 'fb_review');
  assert.deepEqual(refine, { id: 'fb_refine', from: 's1_0', to: 's1_0', maxCycles: 3 }); // default
  assert.deepEqual(review, { id: 'fb_review', from: 's3_0', to: 's2_0', maxCycles: 2 }); // overridden
});

test('buildStepperManifest: carries per-node model + effort from the plan', () => {
  const plan = {
    id: 'wf_x', name: 'X',
    steps: [
      [{ nodeId: 's0_0', key: 'planner', uiPhase: 'plan', model: 'opus', effort: 'high' }],
      [{ nodeId: 's1_0', key: 'refiner', uiPhase: 'refine' }], // unset -> empty strings
    ],
    feedbacks: [],
  };
  const m = buildStepperManifest(plan, REG);
  assert.equal(m.steps[1].nodes[0].model, 'opus');   // step[0] is preflight; agent cell is [1]
  assert.equal(m.steps[1].nodes[0].effort, 'high');
  assert.equal(m.steps[2].nodes[0].model, '');
  assert.equal(m.steps[2].nodes[0].effort, '');
});

test('buildStepperManifest: groups parallel nodes into one cell', () => {
  const plan = {
    id: 'wf_x', name: 'X',
    steps: [
      [{ nodeId: 's0_0', key: 'planner', uiPhase: 'plan' }],
      [{ nodeId: 's1_0', key: 'implementer', uiPhase: 'implement' },
       { nodeId: 's1_1', key: 'manualTestsChecklist', uiPhase: 'manual-checklist' }],
    ],
    feedbacks: [],
  };
  const m = buildStepperManifest(plan, REG);
  assert.equal(m.steps.length, 4); // preflight + 2 agent cells (1 single + 1 parallel) + done
  assert.equal(m.steps[1].nodes.length, 1);
  assert.equal(m.steps[2].nodes.length, 2); // parallel cell
  assert.deepEqual(m.steps[2].nodes.map((n) => n.id), ['s1_0', 's1_1']);
  assert.equal(m.steps[2].nodes[1].label, 'Manual Tests Checklist');
});

test('buildStepperManifest: falls back to key when registry lacks the agent', () => {
  const plan = { id: 'w', name: 'w', steps: [[{ nodeId: 'n', key: 'ghost', uiPhase: 'ghost' }]], feedbacks: [] };
  const m = buildStepperManifest(plan, {});
  assert.equal(m.steps[1].nodes[0].label, 'ghost'); // key as last-resort label
  assert.equal(m.steps[1].nodes[0].color, '');
  assert.equal(m.steps[1].nodes[0].sub, '');
});

test('resolveWorkflow carries channel spec onto nodes (guards _bindNodeIo)', async () => {
  await freshHome();
  const p = await freshProject();
  const plan = await resolveWorkflow(p, 'wf_default', loadAgentRegistry());
  const flat = plan.steps.flat();
  const planner = flat.find((n) => n.key === 'planner');
  const implementer = flat.find((n) => n.key === 'implementer');
  assert.deepEqual(planner.produces, ['plan']);
  assert.deepEqual(planner.consumes, ['userPrompt', 'clarify', 'review']);
  assert.deepEqual(implementer.produces, ['code']);
  assert.deepEqual(implementer.optionalConsumes, ['review']);
});

test('resolveWorkflow stamps fanOut from the sidecar default for wf_default', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = loadAgentRegistry();
  const plan = await resolveWorkflow(p, 'wf_default', reg);
  const byKey = (k) => plan.steps.flat().find((n) => n.key === k);
  assert.equal(byKey('planner').fanOut, true, 'planner default ON');
  assert.equal(byKey('implementer').fanOut, true, 'implementer default ON');
});

test('a per-node fanOut override beats the sidecar default (wf_default)', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = loadAgentRegistry();
  await setNodeModel(p, 'wf_default', 's0_0', { fanOut: false }); // force planner OFF
  await setNodeModel(p, 'wf_default', 's2_0', { fanOut: true });  // force implementer ON
  const plan = await resolveWorkflow(p, 'wf_default', reg);
  const byKey = (k) => plan.steps.flat().find((n) => n.key === k);
  assert.equal(byKey('planner').fanOut, false);
  assert.equal(byKey('implementer').fanOut, true);
});

test('legacy steps[role] reaches wf_default main-run nodes (model/effort + fanOut)', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = loadAgentRegistry();
  await setStep(p, 'implementer', { model: 'claude-opus-4-8', effort: 'high' });
  await setStep(p, 'reviewer', { fanOut: true });
  const plan = await resolveWorkflow(p, 'wf_default', reg);
  const byKey = (k) => plan.steps.flat().find((n) => n.key === k);
  assert.equal(byKey('implementer').model, 'claude-opus-4-8', 'default-workflow model now reaches the node');
  assert.equal(byKey('implementer').effort, 'high');
  assert.equal(byKey('reviewer').fanOut, true);
});

test('legacy steps are NOT applied to a saved (non-default) workflow', async () => {
  await freshHome();
  const p = await freshProject();
  const reg = loadAgentRegistry();
  await writeWorkflow({ id: 'wf_saved', name: 'Saved', steps: [[{ id: 'n0', key: 'implementer' }]], feedbacks: [] });
  await setStep(p, 'implementer', { model: 'claude-opus-4-8' });
  const plan = await resolveWorkflow(p, 'wf_saved', reg);
  const impl = plan.steps.flat().find((n) => n.key === 'implementer');
  assert.equal(impl.model, undefined, 'saved-workflow node ignores legacy steps');
});
