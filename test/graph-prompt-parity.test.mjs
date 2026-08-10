// test/graph-prompt-parity.test.mjs
//
// THE prompt snapshot pin. For each of the 11 shipped builtins this assembles the
// v2 task prompt through the SAME builder runAgentExecution ships (executor.mjs's
// buildAgentPrompt, driven by the REAL agents/*.meta.json sidecars — never a
// fixture) and asserts it still CONTAINS every load-bearing line of today's
// bespoke phases.mjs prompts.
//
// Every expected string below is a VERBATIM copy of the live v1 builder text,
// pasted as a literal rather than imported: phases.mjs dies at the engine swap,
// and a pin that imports the thing it guards degrades into a tautology the moment
// the source moves. Anchors as of 2026-08-10 (phases.mjs working tree):
//   taskHeader                :447-494   fanOutDirective          :121-145
//   RESUME_HEADER             :330-335   workspaceFanOutDirective :182-236
//   verdict contract copies   -> refiner :686-688, reviewer :877-879,
//     planReviewer :913-915, workspaceReviewer :957-960 (FOUR lines),
//     manual web UI :1123-1125, generic verifier :1248-1250
//   implementer FIX arm       :787-795   decomposed-SLICE arm     :796-806
//   planner REVISE arm        :639-645
// If a number has drifted, locate by content — the strings are the contract.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { runOpts, RESUME_HEADER } from '../src/core/phases.mjs';
import {
  buildAgentPrompt,
  allocateOutputs,
  allocateVerdict,
  expandsOutputPort,
  taskSourcedPorts,
  runAgentExecution,
} from '../src/core/graph/executor.mjs';

useTempHome(after);

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
/** Builtin layer only — the pin is about the 11 files that ship in agents/. */
const REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });

const scratch = [];
function tmp(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

const projectDir = tmp('worca-cc-parity-proj-');
const pipelineDir = tmp('worca-cc-parity-pipe-');

const TASK_PROMPT = 'BUILD THE THING';
const ORDINAL = 2;                       // proves {cycle} still renders the cycle

// ── the v1 bytes (verbatim copies; see the header note) ───────────────────────

const V1_REQUEST_BLOCK = `## Original request\n\n${TASK_PROMPT}\n`;

const V1_UPSTREAM_BLOCK =
  '## Upstream input\n\nYour input is the output of the preceding step(s); the file paths to ' +
  'read are named below.\n';

/** channels.mjs#renderAttachmentsBlock (:279-286). */
const V1_ATTACHMENTS_HEAD =
  '\n## Attached files\n\nThe user attached these files; read any that are relevant:\n\n';

/** phases.mjs#fanOutDirective, the legacy (non-detached) arm. */
const V1_FANOUT =
  '## Fan-out ENABLED — parallelize your research\n\n' +
  'The Task/Agent tool is in your tool list this run. For any non-trivial task that spans more ' +
  'than one file or area, DISPATCH parallel read-only research sub-agents NOW — one per distinct ' +
  'area (e.g. UI vs. server vs. store vs. tests) — explore them concurrently, then synthesize their ' +
  'reports yourself. Do NOT investigate every area serially with Read/Grep when the work splits ' +
  'into independent areas.\n\n' +
  'Pick the BEST-FIT `subagent_type`: this project\'s own agents (`.claude/agents`) and your personal ' +
  'agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the ' +
  'sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).\n\n' +
  'Skills are available too: this project\'s and your personal skills (`.claude/skills`, ' +
  '`~/.claude/skills`) can be invoked via the Skill tool — by you AND by the sub-agents you spawn — ' +
  'use any that fit (e.g. design, framework-pattern, knowledge-graph) instead of guessing conventions.\n\n' +
  'Sub-agents are strictly READ-ONLY investigators: YOU write every artifact. Skip fan-out only for a ' +
  'trivial, single-file change.\n\n';

/** phases.mjs#RESUME_HEADER — applied by runOpts, so it is pinned through runOpts. */
const V1_RESUME_HEADER =
  '## Resumed session\n\n' +
  'You were interrupted mid-task and this session has been resumed. First verify the\n' +
  'state of your previous work (files/artifacts you already wrote), then continue the\n' +
  'ORIGINAL task below to completion. Do not redo work that is already done.\n\n';

/** The three lines every v1 verdict contract opens with (reviewer :877-879 and the
 *  generic verifier :1248-1250 are exactly this; the other four roles extend it). */
const V1_VERDICT_CONTRACT =
  'The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], ' +
  '"summary" }. Use severities critical|major|minor|suggestion; only critical/major block the ' +
  'pipeline.\n\n';

/** The role-specific tails the four bespoke verdict contracts added on top. Each is
 *  behavioral (it calibrates severity or the merge), so each has to survive. */
const V1_WS_UNION_LINE =                                  // workspaceReviewer :960
  'The issue list is the UNION of every per-project critical/major issue (never ' +
  'collapse one), sorted by projectKey then severity, each location prefixed "<projectKey>: ".';
const V1_REFINER_CALIBRATION =                            // refiner :687-688
  'Mark a finding critical/major only if it must be fixed before implementation.';
const V1_PLAN_REVIEW_CONSEQUENCE =                        // planReviewer :914-915
  'critical/major block (the planner then revises).';
const V1_WEBUI_CALIBRATION =                              // manual web UI :1125
  'a failing manual case is at least major';

/** The two bespoke "what to do" sentences the generic baseInstruction cannot
 *  carry (it is keyed by runnerType, and both roles are plain verifiers). */
const V1_PLAN_REVIEW_SCOPE = 'Do NOT rewrite the plan.';   // planReviewer :906-907
const V1_WEBUI_INSTRUCTION =                               // manual web UI :1118
  'Execute the manual test checklist against the running web UI using the Playwright tools.';

/** The three moved-bytes directive arms. All three now live on sidecar `directive`
 *  fields, so these pins are what prove the move was byte-faithful. */
const V1_FIX_DIRECTIVE =                                  // implementerBody :790-791
  'Address EVERY critical and major issue in the review below, then re-run the tests. ' +
  'Follow the plan; deviate only if something does not work at all.';
const V1_SLICE_DIRECTIVE =                                // implementerBody :798-801
  'Implement the task below using TDD (red-green-refactor). The TASK file is a ' +
  'self-contained vertical slice and is AUTHORITATIVE — do exactly what it says and ' +
  'nothing outside its scope. The plan is reference/context only; you do NOT need to ' +
  'read the whole plan.';
const V1_REVISE_DIRECTIVE =                               // runPlannerPlan :640-643
  '## Revise to address the review\n\n' +
  'A reviewer found issues with the previous plan. Re-plan from scratch (cold start) and ' +
  'address EVERY critical and major finding in the review below. Preserve the ' +
  '"## Clarifications (Q&A)" section.';

/** phases.mjs#workspaceFanOutDirective headings, per strategy. */
const V1_WS_FANOUT = {
  explore: '## Workspace fan-out — explore across member projects',
  task: '## Workspace fan-out — one sub-agent per plan task',
  review: '## Workspace fan-out — one reviewer per touched project',
};

/** The generalized input renderers that replace v1's bespoke arms (executor
 *  INPUT_RENDERERS). The worktree one carries the reviewer's diff instruction. */
const V2_WORKTREE_ARM = '(the working tree — inspect with `git diff` / `git status` in your cwd)';
const V2_FIX_REVIEW_ARM = '(the review to address — fix EVERY critical and major issue)';
const V2_ANSWERS_ARM = '(the clarifying questions and the answers already given)';

// ── the graph the builtins are wired into ────────────────────────────────────
// Only two wire facts matter to the prompt: which ports a `kind: 'task'` node
// feeds (the request/attachments gate), and which output lands on an `expands`
// input (the decomposer's MOCK markers). Everything else is sidecar data.

const nodeId = (key) => `n_${key}`;
const BUILTIN_KEYS = Object.keys(REGISTRY).sort();

const PARITY_TPL = {
  id: 'wf_parity',
  name: 'Parity',
  version: 2,
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    ...BUILTIN_KEYS.map((key, i) => ({
      id: nodeId(key), kind: 'agent', key, x: 200 + i * 40, y: 0, config: {},
    })),
  ],
  wires: [
    { id: 'w_task_clarify', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('clarify'), port: 'task' } },
    { id: 'w_task_planner', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('planner'), port: 'task' } },
    { id: 'w_task_scan', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('workspaceScanner'), port: 'task' } },
    { id: 'w_dec_impl', from: { node: nodeId('decomposer'), port: 'tasks' }, to: { node: nodeId('implementer'), port: 'task' } },
  ],
};

const portsFn = (node) => REGISTRY[node.key];

/** A workspace channel in the shape the orchestrator mints (legacy, non-detached:
 *  no runRoot, so the task header keeps today's single-cwd wording). */
const WORKSPACE = {
  workspaceDescription: 'Two services that share a schema.',
  projects: [
    { projectKey: 'api', projectName: 'API', worktreeDir: '/abs/api', checkpointRef: 'aaa1111' },
    { projectKey: 'web', projectName: 'Web', worktreeDir: '/abs/web', checkpointRef: 'bbb2222' },
  ],
};

// ── ctx assembly (mirrors executor.prepare) ──────────────────────────────────

const tok = (over = {}) => ({
  seq: 1, type: 'md', path: null, value: null, meta: null,
  sourceExecutionId: 'e0', forced: false, ...over,
});

function runCtxFor() {
  let v = 1;
  return {
    pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
    workspaceKey: null, duplicateKey: false, planVersion: () => v++,
  };
}

/** Bind a port to a plausible absolute artifact path; a void port binds a
 *  payload-free token (which is exactly what an `as: worktree` input gets). */
function bind(port) {
  if (port.type === 'void') return tok({ type: 'void' });
  return tok({ type: port.type, path: `/abs/${port.id}.${port.type === 'json' ? 'json' : 'md'}` });
}

/**
 * The ctx `runAgentExecution` hands its builder, assembled the way `prepare` does
 * — real sidecar meta, real allocation, graph-derived expands port. `only` names
 * the ports to bind; absent it, every REQUIRED input is bound (the steady-state
 * first execution).
 */
function ctxFor(key, { only = null, workspace = null, extras = [] } = {}) {
  const meta = REGISTRY[key];
  const node = { id: nodeId(key), kind: 'agent', key, x: 0, y: 0, config: {}, fanOut: !!meta.fanOut };
  const runCtx = runCtxFor();
  const chosen = meta.inputs.filter((p) => (only ? only.includes(p.id) : p.required));
  const bindings = {};
  for (const port of chosen) bindings[port.id] = bind(port);
  const executionId = `${node.id}#${ORDINAL}`;
  const outputs = allocateOutputs({ node, ports: meta, executionId, ordinal: ORDINAL, runCtx });
  const verdict = allocateVerdict({ node, ports: meta, ordinal: ORDINAL, runCtx });
  return {
    node, ports: meta, meta, bindings,
    trigger: { freshPorts: Object.keys(bindings) },
    ordinal: ORDINAL, executionId, runCtx, outputs, verdict,
    expandsPort: expandsOutputPort(PARITY_TPL, portsFn, node.id),
    projectDir, pipelineDir, taskPrompt: TASK_PROMPT, extras, workspace,
    template: PARITY_TPL, priorAnswers: [],
    agentPrompts: { [key]: `You are ${meta.displayName}.` },
    claudeOpts: { mock: true },
  };
}

const promptFor = (key, opts) => buildAgentPrompt(ctxFor(key, opts));

// ── the 11 ────────────────────────────────────────────────────────────────────

test('the pin covers exactly the 11 shipped builtins', () => {
  assert.equal(BUILTIN_KEYS.length, 11);
  assert.deepEqual(BUILTIN_KEYS, [
    'clarify', 'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting',
    'planReviewer', 'planner', 'refiner', 'reviewer', 'workspaceReviewer', 'workspaceScanner',
  ]);
});

test('every builtin keeps the v1 task header: title, cwd line, pipeline dir', () => {
  for (const key of BUILTIN_KEYS) {
    const p = promptFor(key, { workspace: null });
    assert.ok(p.startsWith(`# Task: ${REGISTRY[key].displayName}\n\n`), `${key}: task title`);
    assert.ok(p.includes(`Project directory (your cwd): ${projectDir}\n`), `${key}: cwd line`);
    assert.ok(p.includes(`Pipeline directory (shared artifacts): ${pipelineDir}\n\n`), `${key}: pipeline dir`);
  }
});

// ── request policy (v1 phases.mjs:447-494 semantics) ──────────────────────────

/** v1's wantsPrompt was `isEntry || consumesPrompt || key in {refiner,reviewer,planReviewer}`.
 *  v2 restates it WITHOUT the key list: a task-node-wired binding, or `wantsRequest`
 *  on the sidecar. The three by-policy roles carry `wantsRequest: true`, so the
 *  matrix below is byte-for-byte the v1 one. */
const TASK_WIRED = ['clarify', 'planner', 'workspaceScanner'];
const WANTS_REQUEST = ['refiner', 'reviewer', 'planReviewer'];
const UPSTREAM_ONLY = [
  'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer',
];

test('request policy: task-wired builtins get the request AND the attachments', () => {
  const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
  for (const key of TASK_WIRED) {
    assert.ok(taskSourcedPorts(PARITY_TPL, nodeId(key)).size > 0, `${key} is task-wired`);
    const p = promptFor(key, { extras });
    assert.ok(p.includes(V1_REQUEST_BLOCK), `${key}: ## Original request`);
    assert.ok(!p.includes(V1_UPSTREAM_BLOCK), `${key}: no upstream header`);
    assert.ok(p.includes(V1_ATTACHMENTS_HEAD), `${key}: ## Attached files`);
    assert.ok(p.includes('- `/abs/spec.md` (spec.md)'), `${key}: the attachment row`);
  }
});

test('request policy: wantsRequest builtins get the request but NEVER the attachments', () => {
  const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
  for (const key of WANTS_REQUEST) {
    assert.equal(REGISTRY[key].wantsRequest, true, `${key}.wantsRequest`);
    assert.equal(taskSourcedPorts(PARITY_TPL, nodeId(key)).size, 0, `${key} binds no task token`);
    const p = promptFor(key, { extras });
    assert.ok(p.includes(V1_REQUEST_BLOCK), `${key}: ## Original request`);
    assert.ok(!p.includes(V1_ATTACHMENTS_HEAD), `${key}: no attachments`);
  }
});

test('request policy: every other builtin gets the upstream-input header', () => {
  const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
  for (const key of UPSTREAM_ONLY) {
    const p = promptFor(key, { extras });
    assert.ok(p.includes(V1_UPSTREAM_BLOCK), `${key}: ## Upstream input`);
    assert.ok(!p.includes(V1_REQUEST_BLOCK), `${key}: no request block`);
    assert.ok(!p.includes(TASK_PROMPT), `${key}: no request text at all`);
    assert.ok(!p.includes(V1_ATTACHMENTS_HEAD), `${key}: no attachments`);
  }
});

test('request policy is driven by wantsRequest, not by the v1 agent-key list', () => {
  // A key v1 never special-cased still gets the request from `wantsRequest` alone,
  // and loses it without — which is what makes the rule generic rather than a
  // rename of the old `key === 'refiner' || ...` test.
  const meta = { ...REGISTRY.reviewer, key: 'custom', displayName: 'Custom' };
  const base = ctxFor('reviewer');
  const node = { ...base.node, id: 'n_custom', key: 'custom' };
  const wants = buildAgentPrompt({ ...base, node, ports: meta, meta, template: PARITY_TPL });
  assert.ok(wants.includes(V1_REQUEST_BLOCK));

  const { wantsRequest, ...without } = meta;                 // eslint-disable-line no-unused-vars
  const neither = buildAgentPrompt({ ...base, node, ports: without, meta: without, template: PARITY_TPL });
  assert.ok(neither.includes(V1_UPSTREAM_BLOCK));
  assert.ok(!neither.includes(TASK_PROMPT));
});

// ── absolute output paths + the MOCK markers ──────────────────────────────────

/** v1's MOCK_ROLE per builtin (the closed writer vocabulary the offline mock
 *  switches on). The scanner's marker is deliberately NOT its prompt role. */
const MOCK_ROLES = {
  clarify: 'clarify',
  planner: 'planner-plan',
  refiner: 'refiner',
  decomposer: 'decomposer',
  implementer: 'implementer',
  reviewer: 'reviewer',
  planReviewer: 'plan-review',
  workspaceReviewer: 'workspace-reviewer',
  workspaceScanner: 'workspace-scan',
  manualTestsChecklist: 'manual-tests-checklist',
  manualWebUiTesting: 'manual-web-ui-testing',
};

/** The output port whose path v1 put in MOCK_OUT. The implementer is absent on
 *  purpose: its only v2 output is void, and v1's MOCK_OUT there was the fix-mode
 *  review path, which the Ports block now binds instead. */
const MOCK_OUT_PORT = {
  clarify: 'answers',
  planner: 'plan',
  refiner: 'plan',
  decomposer: 'tasks',
  reviewer: 'review',
  planReviewer: 'review',
  workspaceReviewer: 'review',
  workspaceScanner: 'workspace',
  manualTestsChecklist: 'checklist',
  manualWebUiTesting: 'review',
};

test('every builtin names each allocated output on an absolute-path write line', () => {
  for (const key of BUILTIN_KEYS) {
    const ctx = ctxFor(key);
    const p = buildAgentPrompt(ctx);
    assert.ok(p.includes('## Ports (this run)\n\n### Inputs\n\n'), `${key}: ports block`);
    for (const [portId, handle] of Object.entries(ctx.outputs)) {
      assert.ok(handle.path.startsWith('/'), `${key}.${portId}: absolute`);
      assert.ok(p.includes(`- Write **${portId}** to: ${handle.path}`), `${key}.${portId}: write line`);
    }
    if (ctx.verdict) {
      assert.ok(ctx.verdict.path.startsWith('/'), `${key}: absolute verdict path`);
      assert.ok(
        p.includes(`- Write the **verdict** JSON (machine-readable) to: ${ctx.verdict.path}`),
        `${key}: verdict write line`,
      );
    }
  }
});

test('every builtin emits its v1 MOCK_ROLE, MOCK_CYCLE, MOCK_OUT, MOCK_JSON and MOCK_IN', () => {
  for (const key of BUILTIN_KEYS) {
    const ctx = ctxFor(key);
    const p = buildAgentPrompt(ctx);
    assert.ok(p.includes(`MOCK_ROLE: ${MOCK_ROLES[key]}`), `${key}: MOCK_ROLE`);
    assert.ok(p.includes(`MOCK_CYCLE: ${ORDINAL}`), `${key}: MOCK_CYCLE`);

    const outPort = MOCK_OUT_PORT[key];
    if (outPort) assert.ok(p.includes(`MOCK_OUT: ${ctx.outputs[outPort].path}`), `${key}: MOCK_OUT`);

    if (ctx.verdict) assert.ok(p.includes(`MOCK_JSON: ${ctx.verdict.path}`), `${key}: MOCK_JSON`);
    else assert.ok(!p.includes('MOCK_JSON:'), `${key}: no verdict, no MOCK_JSON`);

    const firstIn = Object.values(ctx.bindings).map((t) => t.path).find(Boolean);
    if (firstIn) assert.ok(p.includes(`MOCK_IN: ${firstIn}`), `${key}: MOCK_IN`);
  }
});

test('the clarifier and the decomposer keep their v1 side markers', () => {
  const clarify = buildAgentPrompt(ctxFor('clarify'));
  assert.ok(clarify.includes('MOCK_PRIOR: 0'));
  assert.ok(clarify.includes(`MOCK_OUT: ${join(pipelineDir, 'clarify.json')}`));

  const dec = ctxFor('decomposer');
  assert.equal(dec.expandsPort, 'tasks');            // graph-derived, not key-derived
  const decomposer = buildAgentPrompt(dec);
  assert.ok(decomposer.includes(`MOCK_TASKS_DIR: ${join(pipelineDir, 'tasks')}`));
  assert.ok(decomposer.includes(`MOCK_OUT: ${join(pipelineDir, 'decomposition.json')}`));
});

// ── the verdict contract ──────────────────────────────────────────────────────

const VERDICT_BUILTINS = ['refiner', 'reviewer', 'planReviewer', 'workspaceReviewer', 'manualWebUiTesting'];

test('every verdict builtin carries the v1 verdict-contract reminder', () => {
  for (const key of VERDICT_BUILTINS) {
    assert.ok(REGISTRY[key].verdict, `${key} declares a verdict`);
    const p = promptFor(key, { workspace: key === 'workspaceReviewer' ? WORKSPACE : null });
    assert.ok(p.includes(V1_VERDICT_CONTRACT), `${key}: verdict contract`);
  }
  for (const key of BUILTIN_KEYS.filter((k) => !VERDICT_BUILTINS.includes(k))) {
    assert.ok(!promptFor(key).includes(V1_VERDICT_CONTRACT), `${key}: no verdict, no contract`);
  }
});

test('the four workspaceReviewer contract lines survive, UNION rule included', () => {
  const p = promptFor('workspaceReviewer', { workspace: WORKSPACE });
  assert.ok(p.includes(V1_VERDICT_CONTRACT), 'lines 1-3');
  assert.ok(p.includes(V1_WS_UNION_LINE), 'line 4 — the UNION rule');
});

test('the role-specific verdict calibrations survive the collapse to one contract', () => {
  assert.ok(promptFor('refiner').includes(V1_REFINER_CALIBRATION), 'refiner severity bar');
  assert.ok(promptFor('planReviewer').includes(V1_PLAN_REVIEW_CONSEQUENCE), 'plan review consequence');
  assert.ok(promptFor('manualWebUiTesting').includes(V1_WEBUI_CALIBRATION), 'a failed case is major');
});

test('the bespoke instructions the generic baseInstruction cannot carry survive', () => {
  assert.ok(promptFor('planReviewer').includes(V1_PLAN_REVIEW_SCOPE), 'plan reviewer never rewrites');
  assert.ok(promptFor('manualWebUiTesting').includes(V1_WEBUI_INSTRUCTION), 'drive the UI with Playwright');
  // the checklist author's dying diff wording, already homed in promptHints
  assert.ok(
    promptFor('manualTestsChecklist').includes(
      'Read the implementation plan and the implemented changes (via `git diff` in your cwd), then ' +
      'write a markdown checklist of concrete manual test cases a human can run against the app. ' +
      'Each case: a `- [ ]` line with steps and the expected result.',
    ),
    'manual tests checklist diff wording',
  );
});

// ── the three moved-bytes directive arms ──────────────────────────────────────

test('the implementer FIX arm assembles verbatim from the sidecar directive', () => {
  const p = promptFor('implementer', { only: ['plan', 'fix'] });
  assert.ok(p.includes('Mode: fix\n\n'));
  assert.ok(p.includes(V1_FIX_DIRECTIVE));
  assert.ok(p.includes('fix: /abs/fix.md'));
  assert.ok(p.includes(`- **fix** (md) -> /abs/fix.md ${V2_FIX_REVIEW_ARM}`));
});

test('the DECOMPOSED-SLICE arm assembles verbatim from the sidecar directive', () => {
  const p = promptFor('implementer', { only: ['plan', 'task'] });
  assert.ok(p.includes('Mode: task\n\n'));
  assert.ok(p.includes(V1_SLICE_DIRECTIVE));
  assert.ok(p.includes('task: /abs/task.json'));
});

test('the planner REVISE arm assembles verbatim from the sidecar directive', () => {
  const p = promptFor('planner', { only: ['task', 'revise'] });
  assert.ok(p.includes('Mode: revise\n\n'));
  assert.ok(p.includes(V1_REVISE_DIRECTIVE));
  assert.ok(p.includes('revise: /abs/revise.md'));
});

test('a latched (non-fresh) directive port renders no arm at all', () => {
  const ctx = ctxFor('implementer', { only: ['plan', 'fix'] });
  const p = buildAgentPrompt({ ...ctx, trigger: { freshPorts: ['plan'] } });
  assert.ok(!p.includes('Mode: fix'));
  assert.ok(!p.includes(V1_FIX_DIRECTIVE));
  assert.ok(p.includes('/abs/fix.md'));                // still bound, still named
});

// ── fan-out ───────────────────────────────────────────────────────────────────

test('the fan-out directive renders verbatim exactly for the fan-out builtins', () => {
  for (const key of BUILTIN_KEYS) {
    const p = promptFor(key);
    if (REGISTRY[key].fanOut) assert.ok(p.includes(V1_FANOUT), `${key}: fan-out directive`);
    else assert.ok(!p.includes('## Fan-out ENABLED'), `${key}: fan-out off`);
  }
  assert.deepEqual(
    BUILTIN_KEYS.filter((k) => !REGISTRY[k].fanOut),
    ['manualTestsChecklist', 'manualWebUiTesting'],
  );
});

test('each workspace strategy still renders its v1 workspace fan-out block', () => {
  const strategies = BUILTIN_KEYS.filter((k) => REGISTRY[k].workspaceStrategy);
  assert.deepEqual(strategies, ['implementer', 'planReviewer', 'planner', 'refiner', 'reviewer', 'workspaceReviewer']);
  for (const key of strategies) {
    const strategy = REGISTRY[key].workspaceStrategy;
    const p = promptFor(key, { workspace: WORKSPACE });
    assert.ok(p.includes(V1_WS_FANOUT[strategy]), `${key}: ${strategy} block`);
    assert.ok(p.includes(`MOCK_STRATEGY: ${strategy}`), `${key}: MOCK_STRATEGY`);
    // no workspace on the run -> the block disappears, exactly as in v1
    assert.ok(!promptFor(key).includes(V1_WS_FANOUT[strategy]), `${key}: single-project run`);
  }
});

// ── the generalized input arms that replace v1's bespoke sentences ────────────

test('the reviewers still get the working-tree diff instruction', () => {
  for (const key of ['reviewer', 'workspaceReviewer']) {
    const p = promptFor(key, {
      only: ['plan', 'done'],
      workspace: key === 'workspaceReviewer' ? WORKSPACE : null,
    });
    assert.ok(p.includes(V2_WORKTREE_ARM), `${key}: worktree arm`);
  }
});

test('the planner still gets the clarify answers arm', () => {
  const p = promptFor('planner', { only: ['task', 'answers'] });
  assert.ok(p.includes(`- **answers** (json) -> /abs/answers.json ${V2_ANSWERS_ARM}`));
});

// ── RESUME_HEADER (applied on the delivery path, not by the builder) ──────────

test('a resumed ctx prefixes the v1 RESUME_HEADER onto the assembled prompt', () => {
  assert.equal(RESUME_HEADER, V1_RESUME_HEADER, 'the header bytes themselves');
  const ctx = ctxFor('reviewer');
  const prompt = buildAgentPrompt(ctx);
  const spawn = (over) => runOpts(
    { ...ctx, ...over },
    { role: 'reviewer', prompt, systemPrompt: 'sys', allowedTools: [] },
  ).prompt;
  assert.equal(spawn({}), prompt);
  assert.equal(spawn({ resumeSessionId: 'sess-1' }), V1_RESUME_HEADER + prompt);
});

// ── the builder these pins guard IS the one runAgentExecution ships ──────────

test('runAgentExecution returns the pinned prompt byte-for-byte', async () => {
  const ctx = ctxFor('planReviewer');
  const r = await runAgentExecution(ctx);
  assert.equal(r.prompt, buildAgentPrompt(ctx));
  assert.ok(r.prompt.includes('MOCK_ROLE: plan-review'));
  assert.ok(r.prompt.includes(V1_VERDICT_CONTRACT));
  assert.ok(r.prompt.includes(V1_REQUEST_BLOCK));
});
