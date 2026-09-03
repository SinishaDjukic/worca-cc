// test/graph-prompt-parity.test.mjs
// THE prompt snapshot pin, in two layers. For each of the 11 shipped builtins this
// assembles the v2 task prompt through the SAME builder runAgentExecution ships
// (buildAgentPrompt, driven by the REAL agents/*.meta.json sidecars — never a
// fixture) and then:
//   1. FRAGMENTS — asserts it still CONTAINS every load-bearing line of today's
//      bespoke phases.mjs prompts, each named so a failure says WHAT was lost;
//   2. WHOLE PROMPT — asserts byte equality against test/fixtures/prompt-snapshots/
//      <key>.md. Fragments alone cannot see a DELETION of an unpinned line or a
//      REORDER of the blocks; the snapshot can, and the fragment names are the
//      readable index into it.
// Regenerating the snapshots (after a DELIBERATE prompt change — always review the
// diff, it is the contract with every shipped agent):
//   UPDATE_PROMPT_SNAPSHOTS=1 WORCA_HOME=$(mktemp -d) \
//     node --test test/graph-prompt-parity.test.mjs
// Anchors as of dev e6968e15 (P1/P2 do not touch phases.mjs): taskHeader :449-496 ·
// fanOutDirective :122-146 · verdict contract :879-881 · implementer arms :788-812
// + :836 · siblings :762-777 · reviewer diff :859-866 · planner instruction
// :651-653, revise :641-647, inline answers :658-660 · refiner :681-682 ·
// decomposer :721-731 · planReviewer :908-909 · workspace reviewer :953-954 +
// :961-962 · checklist :1076-1084 · web UI :1120-1127 · clarify :581-587 ·
// base instruction :1206-1207 / :1245-1246 · RESUME_HEADER :331-335 ·
// attachments channels.mjs:279-286.
// If a number has drifted, locate by content — the strings are the contract.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { posix } from './helpers/posix-path.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { runOpts, RESUME_HEADER, READ_WRITE_TOOLS, IMPLEMENTER_TOOLS } from '../src/core/phases.mjs';
import {
  buildAgentPrompt, allocateOutputs, allocateVerdict, expandsOutputPort,
  taskSourcedPorts, runAgentExecution,
} from '../src/core/graph/executor.mjs';

// `store:'project'` allocations resolve under worcaHome() — isolate it FIRST.
useTempHome(after);

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url));
/** Builtin layer only — the pin is about the 11 files that ship in agents/. */
const REGISTRY = loadAgentRegistry(AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const portsFn = registryPortsFn(REGISTRY);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const projectDir = tmp('worca-parity-proj-');
const pipelineDir = tmp('worca-parity-pipe-');

const TASK_PROMPT = 'BUILD THE THING';
const ORDINAL = 2;                       // proves {cycle} still renders the cycle

// ── the v1 bytes (verbatim copies; see the header note) ──────────────────────

const V1_REQUEST_BLOCK = `## Original request\n\n${TASK_PROMPT}\n`;
const V1_UPSTREAM_BLOCK =
  '## Upstream input\n\nYour input is the output of the preceding step(s); the file paths to ' +
  'read are named below.\n';
/** channels.mjs#renderAttachmentsBlock (:279-286). */
const V1_ATTACHMENTS_HEAD =
  '\n## Attached files\n\nThe user attached these files; read any that are relevant:\n\n';
/** phases.mjs#taskHeader's legacy skills sentence (:484-486). */
const V1_SKILLS_HINT =
  'Project and personal skills (.claude/skills in this project and ~/.claude/skills) are ' +
  'available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or ' +
  'knowledge-graph skills) rather than guessing conventions.\n\n';
/** phases.mjs#fanOutDirective, the legacy (non-detached) arm (:122-146). */
const V1_FANOUT_HEAD = '## Fan-out ENABLED — parallelize your research\n\n';
const V1_FANOUT_SUBAGENTS =
  'Pick the BEST-FIT `subagent_type`: this project\'s own agents (`.claude/agents`) and your personal ' +
  'agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the ' +
  'sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).';
const V1_FANOUT_TAIL =
  'Sub-agents are strictly READ-ONLY investigators: YOU write every artifact. Skip fan-out only for a ' +
  'trivial, single-file change.\n\n';
/** The three lines every v1 verdict contract opens with (reviewer :879-881). */
const V1_VERDICT_CONTRACT =
  'The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], ' +
  '"summary" }. Use severities critical|major|minor|suggestion; only critical/major block the ' +
  'pipeline.\n\n';
/** The role-specific tails the four bespoke contracts added on top. */
const V1_REFINER_CALIBRATION = 'Mark a finding critical/major only if it must be fixed before implementation.';
const V1_PLAN_REVIEW_CONSEQUENCE = 'critical/major block (the planner then revises).';
const V1_WEBUI_CALIBRATION = 'a failing manual case is at least major';
const V1_WS_UNION_LINE =
  'The issue list is the UNION of every per-project critical/major issue (never ' +
  'collapse one), sorted by projectKey then severity, each location prefixed "<projectKey>: ".';
/** The bespoke "what to do" sentences the generic baseInstruction cannot carry. */
const V1_PLAN_REVIEW_INSTRUCTION = 'Review the implementation PLAN against the original request and the real codebase.';
const V1_PLAN_REVIEW_SCOPE = 'Do NOT rewrite the plan.';
const V1_WEBUI_INSTRUCTION =
  'Execute the manual test checklist against the running web UI using the Playwright tools.';
/** The three moved-bytes directive arms — now sidecar `directive` fields. */
const V1_FIX_DIRECTIVE =
  'Address EVERY critical and major issue in the review below, then re-run the tests. ' +
  'Follow the plan; deviate only if something does not work at all.';
const V1_SLICE_DIRECTIVE =
  'Implement the task below using TDD (red-green-refactor). The TASK file is a ' +
  'self-contained vertical slice and is AUTHORITATIVE — do exactly what it says and ' +
  'nothing outside its scope. The plan is reference/context only; you do NOT need to ' +
  'read the whole plan.';
const V1_IMPLEMENT_DIRECTIVE =
  'Implement the plan using TDD (red-green-refactor). Follow it with NO deviation; ' +
  'deviate slightly only if a step does not work at all.';
const V1_REVISE_DIRECTIVE =
  '## Revise to address the review\n\n' +
  'A reviewer found issues with the previous plan. Re-plan from scratch (cold start) and ' +
  'address EVERY critical and major finding in the review below. Preserve the ' +
  '"## Clarifications (Q&A)" section.';
/** The per-agent hint sentences the old branch DROPPED (adj-f1 §0 item 2). */
const V1_IMPL_CWD = 'Work inside the project directory (your cwd). Commit nothing; just edit files and tests.';
const V1_REVIEWER_DIFF_REF =
  'Inspect the diff with `git diff abc1234` (the orchestrator\'s pre-implementation ' +
  'checkpoint) and `git status` in your cwd. New/untracked files are intent-to-added, ' +
  'so they DO appear in that diff; use `git status` to cross-check.';
const V1_DECOMPOSER_SLICES =
  'tracer-bullet vertical slices grouped into ordered phases. Within a phase, tasks must be ' +
  'parallel-safe and edit DISJOINT files';
const V1_DECOMPOSER_TASKS_DIR =
  `Write each task file under: ${join(pipelineDir, 'tasks')}/ (name them p<phase>-t<n>-<kebab-title>.md)`;
const V1_DECOMPOSER_MANIFEST =
  'The manifest shape is { "phases": [ { "ordinal", "tasks": [ { "id", "title", "file" } ] } ] }. ' +
  'Use id "p<ordinal>t<n>" and a pipeline-dir-relative "file" path.';
const V1_PLANNER_INSTRUCTION =
  'Write a complete, build-ready implementation plan. It MUST contain concrete code snippets ' +
  'for the features and MUST end with a "## Clarifications (Q&A)" section';
const V1_NO_ANSWERS = '_No clarifying questions were asked._';
const V1_CLARIFY_SCOPE = 'Identify the decisions you cannot safely resolve from the task text or the real codebase';
const V1_REFINER_INSTRUCTION =
  'Read the current plan, critically review it INCLUDING its code snippets, then write an ' +
  'improved version and a machine-readable review.';
const V1_REVIEWER_INSTRUCTION =
  'Review the git diff of what was implemented against the plan.';
const V1_WS_REVIEW_INSTRUCTION =
  'Review what was implemented across the member projects against the plan.';
const V1_CHECKLIST_SINGLE =
  'Read the implementation plan and the implemented changes (via `git diff` in your cwd), ' +
  'then write a markdown checklist of concrete manual test cases a human can run against the ' +
  'app. Each case: a `- [ ]` line with steps and the expected result.';
const V1_CHECKLIST_DETACHED = 'your cwd is the worca-cc run root, not a repository, so inspect each member on its own';
/** The generalized input renderers that replace v1's bespoke arms (v2 bytes, by design). */
/** executor.mjs#baseInstruction, the PRODUCER arm — v1's generic producer
 *  (phases.mjs:1206-1207). The first line of every non-verifier agent prompt, and
 *  the only sentence that tells an agent to write its declared outputs at all. */
const V2_BASE_PRODUCER =
  'You are a pipeline agent. Read every input below, do your job exactly as your role ' +
  'instructions describe, and write EVERY declared output to its exact path.';
/** …the VERIFIER arm — v1's generic verifier (phases.mjs:1245-1246). */
const V2_BASE_VERIFIER =
  'You are a verifier. Inspect the inputs below exactly as your role instructions describe, ' +
  'then write a human-readable review markdown AND a machine-readable review JSON.';
/** …the CLARIFIER arm — v1's buildClarifyPrompt (:581-587) minus its parenthetical
 *  aside naming two builtin agents a generic graph need not have. */
const V2_BASE_CLARIFIER =
  'Identify the decisions you cannot safely resolve from the task text or the real ' +
  'codebase — including things a downstream agent would otherwise silently assume. For ' +
  'each, produce one conceptual question with 2 to 4 options and a free-text fallback. Ask ' +
  'only what materially changes the plan (up to 8 questions); never pad, and never split one ' +
  'decision. For low-impact details, pick a sensible default rather than asking. If you have ' +
  'no material open questions, write { "questions": [] } to that same path.';
/** phases.mjs#RESUME_HEADER (:288-292), verbatim — the import alone only pins the
 *  POSITION, so the bytes are restated here. */
const V1_RESUME_HEADER =
  '## Resumed session\n\n' +
  'You were interrupted mid-task and this session has been resumed. First verify the\n' +
  'state of your previous work (files/artifacts you already wrote), then continue the\n' +
  'ORIGINAL task below to completion. Do not redo work that is already done.\n\n';

const V2_FIX_REVIEW_ARM = '(the review to address — fix EVERY critical and major issue)';
const V2_ANSWERS_ARM = '(the clarifying questions and the answers already given)';

// ── the graph the builtins are wired into ────────────────────────────────────
// Only two wire facts matter to the prompt: which ports a `kind:'task'` node feeds
// (the request/attachments gate), and which output lands on an `expands` input (the
// decomposer's contract block + MOCK markers). Everything else is sidecar data.

const nodeId = (key) => `n_${key}`;
const BUILTIN_KEYS = Object.keys(REGISTRY).sort();

const PARITY_TPL = {
  id: 'wf_parity', name: 'Parity', version: 2, domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    ...BUILTIN_KEYS.map((key, i) => ({ id: nodeId(key), kind: 'agent', key, x: 200 + i * 40, y: 0, config: {} })),
  ],
  wires: [
    { id: 'w_t_clarify', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('clarify'), port: 'task' } },
    { id: 'w_t_planner', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('planner'), port: 'task' } },
    { id: 'w_t_scan', from: { node: 'n_task', port: 'task' }, to: { node: nodeId('workspaceScanner'), port: 'task' } },
    { id: 'w_dec_impl', from: { node: nodeId('decomposer'), port: 'tasks' }, to: { node: nodeId('implementer'), port: 'task' } },
  ],
};

/** The frontmatter `tools:` line of an agent .md — what resolveGraph stamps onto
 *  `node.tools` in production (workflows.mjs#parseFrontmatterTools, private). */
function frontmatterTools(key) {
  const file = REGISTRY[key].agentFile;
  const text = readFileSync(join(AGENTS_DIR, file), 'utf8');
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  const line = m ? m[1].split(/\r?\n/).find((l) => /^tools\s*:/.test(l)) : null;
  return line ? line.replace(/^tools\s*:/, '').split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const tok = (over = {}) => ({ seq: 1, type: 'md', ...over });

/** Bind a port to a plausible absolute artifact path; a void port binds a
 *  payload-free token (which is exactly what an `as:'worktree'` input gets). */
function bind(port) {
  if (port.type === 'void') return tok({ type: 'void' });
  return tok({ type: port.type, path: `/abs/${port.id}.${port.type === 'json' ? 'json' : 'md'}` });
}

/**
 * The ctx `runAgentExecution` hands its builder, assembled the way `prepare` does —
 * real sidecar meta, real allocation, graph-derived expands port. `only` names the
 * ports to bind; absent it, every REQUIRED input is bound (the steady-state first
 * execution). Optional inputs (the reviewer's `as:'worktree'` `done`, the planner's
 * `answers`/`revise`) are bound only when named.
 */
function ctxFor(key, { only = null, workspace = null, extras = [], slice = null, runRoot = null } = {}) {
  const meta = REGISTRY[key];
  const node = {
    id: nodeId(key), kind: 'agent', key, x: 0, y: 0, config: {},
    fanOut: !!meta.fanOut, agentPrompt: `You are ${meta.displayName}.`, tools: frontmatterTools(key),
  };
  const ports = portsFn(node);                 // spreads the meta: ports.verdict IS the sidecar block
  let v = 0;
  const runCtx = {
    pipelineDir, projectDir, baseName: 'feature', datePrefix: '01-01-26',
    workspaceKey: null, duplicateKey: false, slice: slice?.id ?? null,
    planVersion: () => { v += 1; return v; },
  };
  const chosen = (ports.inputs || []).filter((p) => p.id !== 'await' && (only ? only.includes(p.id) : p.required));
  const bindings = {};
  for (const port of chosen) bindings[port.id] = bind(port);
  const executionId = `x:${node.id}:${ORDINAL}`;
  return {
    node, nodeId: node.id, ports, meta, bindings,
    trigger: { wireIds: [], freshPorts: Object.keys(bindings) },
    ordinal: ORDINAL, cycle: ORDINAL, executionId, runCtx, slice,
    outputs: allocateOutputs({ node, ports, executionId, ordinal: ORDINAL, runCtx }),
    verdict: allocateVerdict({ node, ports, ordinal: ORDINAL, runCtx }),
    expandsPort: expandsOutputPort(PARITY_TPL, portsFn, node.id),
    projectDir, pipelineDir, taskPrompt: TASK_PROMPT, toolInstruction: 'TOOLS',
    checkpointRef: 'abc1234', extras, workspace, runRoot, template: PARITY_TPL,
    priorAnswers: [], agentPrompts: {}, claudeOpts: { mock: true },
  };
}

const promptFor = (key, opts) => buildAgentPrompt(ctxFor(key, opts));

// ── the 11 ────────────────────────────────────────────────────────────────────

test('the pin covers exactly the 11 shipped builtins, all v2-ported', () => {
  assert.deepEqual(BUILTIN_KEYS, [
    'clarify', 'decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting',
    'planReviewer', 'planner', 'refiner', 'reviewer', 'workspaceReviewer', 'workspaceScanner',
  ]);
  for (const key of BUILTIN_KEYS) {
    assert.equal(REGISTRY[key].metaVersion, 2, `${key} is metaVersion 2`);
    assert.ok((portsFn({ kind: 'agent', key }).inputs || []).some((p) => p.id === 'await'),
      `${key} carries the synthesized await gate`);
  }
});

test('every builtin keeps the v1 task header: title, cwd line, pipeline dir, skills hint', () => {
  for (const key of BUILTIN_KEYS) {
    const p = promptFor(key);
    assert.ok(p.startsWith(`# Task: ${REGISTRY[key].displayName}\n\n`), `${key}: task title`);
    assert.ok(p.includes(`Project directory (your cwd): ${projectDir}\n`), `${key}: cwd line`);
    assert.ok(p.includes(`Pipeline directory (shared artifacts): ${pipelineDir}\n\n`), `${key}: pipeline dir`);
    assert.ok(p.includes(V1_SKILLS_HINT), `${key}: skills hint`);
  }
});

const BASE_BY_RUNNER = {
  producer: V2_BASE_PRODUCER, verifier: V2_BASE_VERIFIER, clarifier: V2_BASE_CLARIFIER,
};

test('every builtin opens "## What to do" with the base instruction for its runnerType — and only that one', () => {
  const arms = Object.values(BASE_BY_RUNNER);
  for (const key of BUILTIN_KEYS) {
    const runnerType = REGISTRY[key].runnerType || 'producer';
    const mine = BASE_BY_RUNNER[runnerType];
    assert.ok(mine, `${key}: unknown runnerType ${runnerType}`);
    const p = promptFor(key);
    // Position, not just presence: the base instruction is the FIRST thing under
    // the heading, ahead of the sidecar hints and every block after them.
    assert.ok(p.includes(`\n## What to do\n\n${mine}\n\n`),
      `${key}: "## What to do" must open with the ${runnerType} base instruction`);
    for (const other of arms) {
      if (other !== mine) assert.equal(p.includes(other), false, `${key}: carries a foreign base instruction`);
    }
  }
  // The clause that makes an agent write its files at all is keyed by runnerType,
  // never by an agent key — every non-verifier builtin carries it.
  assert.ok(V2_BASE_PRODUCER.includes('write EVERY declared output to its exact path'));
  const producers = BUILTIN_KEYS.filter((k) => (REGISTRY[k].runnerType || 'producer') === 'producer');
  assert.ok(producers.length >= 5, `expected several producers, got ${producers.length}`);
  for (const key of producers) {
    assert.ok(promptFor(key).includes('write EVERY declared output to its exact path'), key);
  }
});

// ── request policy (v1 phases.mjs:449-496 semantics, restated without the key list) ──

const TASK_WIRED = ['clarify', 'planner', 'workspaceScanner'];
const WANTS_REQUEST = ['refiner', 'reviewer', 'planReviewer'];
const UPSTREAM_ONLY = ['decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer'];

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

test('request policy: every other builtin gets the upstream-input header and no request text', () => {
  for (const key of UPSTREAM_ONLY) {
    const p = promptFor(key, { extras: [{ name: 'spec.md', path: '/abs/spec.md' }] });
    assert.ok(p.includes(V1_UPSTREAM_BLOCK), `${key}: ## Upstream input`);
    assert.ok(!p.includes(TASK_PROMPT), `${key}: no request text at all`);
    assert.ok(!p.includes(V1_ATTACHMENTS_HEAD), `${key}: no attachments`);
  }
});

test('request policy is driven by wantsRequest, not by the v1 agent-key list', () => {
  const base = ctxFor('reviewer');
  const node = { ...base.node, id: 'n_custom', key: 'custom' };
  const meta = { ...REGISTRY.reviewer, key: 'custom', displayName: 'Custom' };
  const wants = buildAgentPrompt({ ...base, node, ports: { ...base.ports, ...meta }, meta });
  assert.ok(wants.includes(V1_REQUEST_BLOCK), 'wantsRequest alone earns the request');
  const { wantsRequest, ...without } = meta;                 // eslint-disable-line no-unused-vars
  const neither = buildAgentPrompt({ ...base, node, ports: { ...base.ports, ...without }, meta: without });
  assert.ok(neither.includes(V1_UPSTREAM_BLOCK));
  assert.ok(!neither.includes(TASK_PROMPT));
});

// ── fan-out, verdict contract, markers ───────────────────────────────────────

test('fan-out declarers keep the v1 directive verbatim; the others carry none', () => {
  for (const key of BUILTIN_KEYS) {
    const p = promptFor(key);
    if (REGISTRY[key].fanOut) {
      assert.ok(p.includes(V1_FANOUT_HEAD), `${key}: fan-out head`);
      assert.ok(p.includes(V1_FANOUT_SUBAGENTS), `${key}: subagent_type sentence`);
      assert.ok(p.includes(V1_FANOUT_TAIL), `${key}: read-only tail`);
    } else {
      assert.ok(!p.includes(V1_FANOUT_HEAD), `${key}: no fan-out block`);
    }
  }
});

test('every verdict declarer carries the three-line contract plus its calibration tail', () => {
  const withVerdict = BUILTIN_KEYS.filter((k) => REGISTRY[k].verdict);
  assert.deepEqual(withVerdict.sort(), ['manualWebUiTesting', 'planReviewer', 'refiner', 'reviewer', 'workspaceReviewer']);
  for (const key of withVerdict) assert.ok(promptFor(key).includes(V1_VERDICT_CONTRACT), `${key}: verdict contract`);
  assert.ok(promptFor('refiner').includes(V1_REFINER_CALIBRATION));
  assert.ok(promptFor('planReviewer').includes(V1_PLAN_REVIEW_CONSEQUENCE));
  assert.ok(promptFor('manualWebUiTesting').includes(V1_WEBUI_CALIBRATION));
  assert.ok(promptFor('workspaceReviewer').includes(V1_WS_UNION_LINE));
  assert.ok(!promptFor('decomposer').includes(V1_VERDICT_CONTRACT), 'a producer carries none');
});

/** v1's MOCK_ROLE per builtin — the closed writer vocabulary the offline mock
 *  switches on. The scanner's marker is deliberately NOT its prompt role. */
const MOCK_ROLES = {
  clarify: 'clarify', planner: 'planner-plan', refiner: 'refiner', decomposer: 'decomposer',
  implementer: 'implementer', reviewer: 'reviewer', planReviewer: 'plan-review',
  workspaceReviewer: 'workspace-reviewer', manualTestsChecklist: 'manual-tests-checklist',
  manualWebUiTesting: 'manual-web-ui-testing', workspaceScanner: 'workspace-scan',
};

test('every builtin pins its v1 MOCK_ROLE and names its allocated outputs absolutely', () => {
  for (const key of BUILTIN_KEYS) {
    const ctx = ctxFor(key);
    const p = buildAgentPrompt(ctx);
    assert.equal(REGISTRY[key].mockRole, MOCK_ROLES[key], `${key}: sidecar mockRole`);
    assert.ok(p.includes(`MOCK_ROLE: ${MOCK_ROLES[key]}`), `${key}: MOCK_ROLE marker`);
    assert.ok(p.includes(`MOCK_CYCLE: ${ORDINAL}`), `${key}: MOCK_CYCLE`);
    assert.ok(!p.includes('MOCK_STRATEGY'), `${key}: no dead marker`);
    for (const [portId, alloc] of Object.entries(ctx.outputs)) {
      assert.ok(isAbsolute(alloc.path), `${key}.${portId}: absolute`);
      assert.ok(p.includes(alloc.path), `${key}.${portId}: the path is in the prompt`);
    }
    if (ctx.verdict) assert.ok(p.includes(`MOCK_JSON: ${ctx.verdict.path}`), `${key}: MOCK_JSON`);
  }
  // The filename contract, spot-checked against v1's shipped names.
  assert.match(posix(ctxFor('reviewer').outputs.review.path), /reviews\/01-01-26-feature-impl-review\.md$/);
  assert.match(posix(ctxFor('reviewer').verdict.path), /impl-review-cycle2\.json$/);
  assert.match(posix(ctxFor('planReviewer').outputs.review.path), /reviews\/01-01-26-feature-plan-review\.md$/);
  assert.match(posix(ctxFor('workspaceReviewer').verdict.path), /ws-review-cycle2\.json$/);
  assert.match(posix(ctxFor('refiner').verdict.path), /refine-review-cycle2\.json$/);
  assert.match(posix(ctxFor('manualWebUiTesting').outputs.review.path), /webui-review-cycle2\.md$/);
  assert.match(posix(ctxFor('manualTestsChecklist').outputs.checklist.path), /manual-tests-checklist\.md$/);
  assert.match(posix(ctxFor('decomposer').outputs.tasks.path), /decomposition\.json$/);
  assert.match(posix(ctxFor('clarify').outputs.answers.path), /clarify\.json$/);
  assert.match(posix(ctxFor('planner').outputs.plan.path), /plans\/01-01-26-feature\.md$/);
  assert.equal(ctxFor('refiner').outputs.plan.path, ctxFor('refiner').outputs.revise.path);
  assert.ok(buildAgentPrompt(ctxFor('decomposer')).includes(`MOCK_TASKS_DIR: ${join(pipelineDir, 'tasks')}`),
    'the decomposer is discovered through the wire into implementer.task');
});

// ── the per-agent load-bearing sentences (adj-f1 §5; §0 item 2: what the old branch lost) ──

test('clarify keeps its scope, its budget and its empty-questions instruction', () => {
  const p = promptFor('clarify');
  assert.ok(p.includes(V1_CLARIFY_SCOPE));
  assert.ok(p.includes('2 to 4 options'));
  assert.ok(p.includes('up to 8 questions'));
  assert.ok(p.includes('write { "questions": [] } to that same path'));
  assert.ok(p.includes('MOCK_PRIOR: 0'));
  assert.ok(!p.includes('## Already answered — DO NOT ask these again'),
    'the round-2 block is gone: the clarifier executes once per token');
});

test('planner keeps its instruction, the REVISE arm and the inline answers block', () => {
  const p = promptFor('planner');
  assert.ok(p.includes(V1_PLANNER_INSTRUCTION));
  assert.ok(p.includes('## Clarifications already answered'));
  assert.ok(p.includes(V1_NO_ANSWERS), 'unbound answers render the v1 placeholder');
  assert.ok(p.includes('MOCK_BASE: feature'));
  const revising = promptFor('planner', { only: ['task', 'revise'] });
  assert.ok(revising.includes(V1_REVISE_DIRECTIVE), 'the revise directive is byte-faithful');
  const answered = buildAgentPrompt({
    ...ctxFor('planner', { only: ['task', 'answers'] }),
    priorAnswers: [{ id: 'q1', question: 'Fail fast?', choice: 'Yes' }],
  });
  assert.ok(answered.includes('- **Q:** Fail fast? — **A:** Yes'));
  assert.ok(answered.includes(V2_ANSWERS_ARM), 'and the answers port renders its own arm');
});

test('refiner, reviewer, planReviewer and workspaceReviewer keep their v1 instructions', () => {
  assert.ok(promptFor('refiner').includes(V1_REFINER_INSTRUCTION));
  const rev = promptFor('reviewer', { only: ['plan', 'done'] });   // `done` is optional: bind it to reach the worktree arm
  assert.ok(rev.includes(V1_REVIEWER_INSTRUCTION));
  assert.ok(rev.includes(V1_REVIEWER_DIFF_REF), 'the checkpoint-ref diff sentence survives (as:worktree)');
  assert.ok(!promptFor('reviewer').includes('Inspect the diff with'), 'and only renders when the worktree token is bound');
  const pr = promptFor('planReviewer');
  assert.ok(pr.includes(V1_PLAN_REVIEW_INSTRUCTION));
  assert.ok(pr.includes(V1_PLAN_REVIEW_SCOPE));
  assert.ok(promptFor('workspaceReviewer').includes(V1_WS_REVIEW_INSTRUCTION));
  assert.ok(promptFor('workspaceReviewer', {
    workspace: { projects: [{ projectKey: 'api', projectName: 'API', worktreeDir: '/abs/api', checkpointRef: 'aaa1' }] },
  }).includes('## Workspace fan-out — one reviewer per touched project'));
});

test('implementer renders exactly ONE arm per execution, plus the cwd sentence', () => {
  const fix = promptFor('implementer', { only: ['fix', 'plan'] });
  assert.ok(fix.includes(V1_FIX_DIRECTIVE), 'fix beats implement (A3, declared order)');
  assert.ok(fix.includes(V2_FIX_REVIEW_ARM));
  assert.ok(!fix.includes(V1_IMPLEMENT_DIRECTIVE));
  const sliced = promptFor('implementer', { only: ['task', 'plan'] });
  assert.ok(sliced.includes(V1_SLICE_DIRECTIVE), 'task beats implement');
  assert.ok(!sliced.includes(V1_FIX_DIRECTIVE));
  const plain = promptFor('implementer', { only: ['plan'] });
  assert.ok(plain.includes(V1_IMPLEMENT_DIRECTIVE));
  for (const p of [fix, sliced, plain]) assert.ok(p.includes(V1_IMPL_CWD), 'Work inside… Commit nothing');
  const withSiblings = promptFor('implementer', {
    only: ['task', 'plan'],
    slice: { id: 'p1t1', title: 'One', phase: 1, path: '/abs/t1.md', index: 0, siblings: [{ id: 'p1t2', title: 'Two', file: 'tasks/p1-t2.md' }] },
  });
  assert.ok(withSiblings.includes('## Parallel siblings — shared working tree'));
  assert.ok(withSiblings.includes('- p1t2 "Two" (tasks/p1-t2.md)'));
});

test('decomposer keeps the slicing rules, the tasks dir and the manifest shape', () => {
  const p = promptFor('decomposer');
  assert.ok(p.includes(V1_DECOMPOSER_SLICES));
  assert.ok(p.includes(V1_DECOMPOSER_TASKS_DIR));
  assert.ok(p.includes(V1_DECOMPOSER_MANIFEST));
  assert.ok(!promptFor('planner').includes('Write each task file under:'), 'the contract renders ONLY for the expands producer');
});

test('the checklist keeps both change-inspection variants; web UI keeps its instruction', () => {
  assert.ok(promptFor('manualTestsChecklist').includes(V1_CHECKLIST_SINGLE), 'single-project bytes are v1-identical');
  const detached = promptFor('manualTestsChecklist', {
    runRoot: '/run/root',
    workspace: { projects: [{ projectKey: 'api', projectName: 'API', worktreeDir: '/run/root/repos/api', checkpointRef: 'aaa1' }] },
  });
  assert.ok(detached.includes(V1_CHECKLIST_DETACHED));
  assert.ok(detached.includes('- **API**: `git -C repos/api diff aaa1`'));
  assert.ok(!detached.includes('via `git diff` in your cwd'));
  assert.ok(promptFor('manualWebUiTesting').includes(V1_WEBUI_INSTRUCTION));
});

// ── tools, resume header, round trip ─────────────────────────────────────────

test('frontmatter tools reach allowedTools — the Playwright grants are not lost', () => {
  const ctx = ctxFor('manualWebUiTesting');
  const browser = frontmatterTools('manualWebUiTesting').filter((t) => t.startsWith('mcp__plugin_playwright_playwright__browser_'));
  assert.ok(browser.length >= 10, 'the sidecar body still declares the browser tools');
  const opts = runOpts(ctx, { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: READ_WRITE_TOOLS });
  for (const t of browser) assert.ok(opts.allowedTools.includes(t), `granted: ${t}`);
  assert.deepEqual(opts.allowedTools.slice(0, READ_WRITE_TOOLS.length), READ_WRITE_TOOLS);
  assert.equal(REGISTRY.implementer.sideEffect, 'code', 'the implementer is the code writer');
  const implOpts = runOpts(ctxFor('implementer'), { role: 'r', prompt: 'P', systemPrompt: 'S', allowedTools: IMPLEMENTER_TOOLS });
  assert.ok(implOpts.allowedTools.includes('MultiEdit'));
});

test('a resumed execution keeps the v1 resume header, ahead of the task prompt', () => {
  const ctx = { ...ctxFor('reviewer'), resumeSessionId: 'sess-9' };
  const opts = runOpts(ctx, { role: 'r', prompt: buildAgentPrompt(ctx), systemPrompt: 'S', allowedTools: READ_WRITE_TOOLS });
  assert.equal(RESUME_HEADER, V1_RESUME_HEADER, 'the resume header keeps its v1 bytes');
  assert.ok(opts.prompt.startsWith(V1_RESUME_HEADER));
  assert.ok(opts.prompt.includes(`# Task: ${REGISTRY.reviewer.displayName}`));
});

test('runAgentExecution ships exactly the prompt buildAgentPrompt produced', async () => {
  const ctx = ctxFor('reviewer');
  const r = await runAgentExecution(ctx);
  assert.equal(r.prompt, buildAgentPrompt(ctx), 'no second builder, no drift');
  assert.ok(r.outputs.review.path.endsWith('-impl-review.md'));
  assert.ok(Array.isArray(r.verdict.issues));
  assert.match(r.sessionId, /^mock-session-/);
});

// ── the whole-prompt snapshots ───────────────────────────────────────────────

const SNAPSHOT_DIR = fileURLToPath(new URL('./fixtures/prompt-snapshots/', import.meta.url));

/**
 * The only four things in a prompt that are not stable across machines and runs:
 * the two mkdtemp scratch dirs, the temp WORCA_HOME behind `store:'project'`
 * allocations, and the store key those allocations embed (store.mjs#projectKey =
 * `<basename>-<sha1(path)[:8]>`, so it changes with the mkdtemp suffix). Everything
 * else in ctxFor is fixed by construction (datePrefix '01-01-26', checkpointRef
 * 'abc1234', ORDINAL 2, `/abs/<port>.<ext>` bindings), so no date or id
 * normalisation is needed. Longest path first: the dirs are siblings under
 * tmpdir(), and a prefix replacement must not eat a longer match.
 */
function normalizePrompt(text) {
  const subs = [
    [worcaHome(), '<WORCA_HOME>'],
    [pipelineDir, '<PIPELINE_DIR>'],
    [projectDir, '<PROJECT_DIR>'],
    [projectKey(projectDir), '<STORE_KEY>'],
  ].sort((a, b) => b[0].length - a[0].length);
  const out = subs.reduce((acc, [from, to]) => acc.split(from).join(to), text);
  // On Windows an allocation under one of those dirs continues with the native
  // separator (`<PIPELINE_DIR>\clarify.json`); the committed snapshots are the
  // POSIX form. Only the run of path segments right after a placeholder is
  // normalised — never the prompt prose.
  return out.replace(/(<(?:WORCA_HOME|PIPELINE_DIR|PROJECT_DIR)>)((?:\\[^\s'"`]*)+)/g, (m, ph, rest) => ph + posix(rest));
}

test('every builtin prompt matches its committed whole-prompt snapshot', () => {
  const update = process.env.UPDATE_PROMPT_SNAPSHOTS === '1';
  if (update) mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const key of BUILTIN_KEYS) {
    const file = join(SNAPSHOT_DIR, `${key}.md`);
    const actual = normalizePrompt(promptFor(key));
    assert.equal(actual.includes(tmpdir()), false, `${key}: an un-normalised temp path leaked into the snapshot`);
    if (update) { writeFileSync(file, `${actual}\n`, 'utf8'); continue; }   // newline-terminated: a POSIX text file, byte-exact in a listing
    assert.equal(`${actual}\n`, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'),
      `${key}: the assembled prompt no longer matches test/fixtures/prompt-snapshots/${key}.md. `
      + 'If the change is deliberate, review the diff and regenerate with '
      + 'UPDATE_PROMPT_SNAPSHOTS=1 (see this file\'s header).');
  }
});
