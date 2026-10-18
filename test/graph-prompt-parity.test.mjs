// test/graph-prompt-parity.test.mjs
// THE prompt snapshot pin, in two layers. For each of the 24 non-presentation builtins this
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
// Regenerating snapshots is a reviewed step — diff every fixture before committing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { posix } from './helpers/posix-path.mjs';
import { checkRows } from './helpers/rows.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { projectKey } from '../src/core/store.mjs';
import { runOpts, RESUME_HEADER, READ_WRITE_TOOLS, IMPLEMENTER_TOOLS } from '../src/core/phases.mjs';
import { buildAgentPrompt, taskSourcedPorts, allocateOutputs, allocateVerdict } from '../src/core/graph/executor.mjs';
import {
  REGISTRY, TASK_PROMPT, ORDINAL, nodeId, BUILTIN_KEYS, PARITY_TPL,
  frontmatterTools, makeCtxFor, portsFn,
} from './helpers/prompt-ctx.mjs';

// `store:'project'` allocations resolve under worcaHome() — isolate it FIRST.
useTempHome(after);

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const projectDir = tmp('worca-parity-proj-');
const pipelineDir = tmp('worca-parity-pipe-');

// ── the v1 bytes (verbatim copies; see the header note) ──────────────────────

const V1_REQUEST_BLOCK = `## Original request\n\n${TASK_PROMPT}\n`;
const V1_UPSTREAM_BLOCK =
  '## Upstream input\n\nYour input is the output of the preceding step(s); the file paths to ' +
  'read are named below.\n';
/** channels.mjs#renderAttachmentsBlock (:279-286). */
const V1_ATTACHMENTS_HEAD =
  '\n## Attached files\n\nThe user attached these files; read any that are relevant:\n\n';
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
const V1_PLANNER_INSTRUCTION =
  'Write a complete, build-ready implementation plan. It MUST contain concrete code snippets ' +
  'for the features and MUST end with a "## Clarifications (Q&A)" section';
const V1_NO_ANSWERS = '_No clarifying questions were asked._';
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
/** phases.mjs#RESUME_HEADER (:288-292), verbatim — the import alone only pins the
 *  POSITION, so the bytes are restated here. */
const V1_RESUME_HEADER =
  '## Resumed session\n\n' +
  'You were interrupted mid-task and this session has been resumed. First verify the\n' +
  'state of your previous work (files/artifacts you already wrote), then continue the\n' +
  'ORIGINAL task below to completion. Do not redo work that is already done.\n\n';

/** The generalized input renderers that replace v1's bespoke arms (v2 bytes, by design). */
const V2_FIX_REVIEW_ARM = '(the review to address — fix EVERY critical and major issue)';
const V2_ANSWERS_ARM = '(the clarifying questions and the answers already given)';

const ctxFor = makeCtxFor({ pipelineDir, projectDir });

const promptFor = (key, opts) => buildAgentPrompt(ctxFor(key, opts));

// ── request policy (v1 phases.mjs:449-496 semantics, restated without the key list) ──

const TASK_WIRED = ['clarify', 'planner'];
const WANTS_REQUEST = ['refiner', 'reviewer', 'planReviewer'];
const UPSTREAM_ONLY = ['decomposer', 'implementer', 'manualTestsChecklist', 'manualWebUiTesting', 'workspaceReviewer',
  'workspaceScanner', 'workspaceUsageMapper', 'workspaceSynthesizer'];

test('request policy per builtin class: task-wired (request + attachments), wantsRequest (request, no attachments), upstream-only (header, no request)', async () => {
  await checkRows([
    { name: 'request policy: task-wired builtins get the request AND the attachments', run: () => {
      const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
      for (const key of TASK_WIRED) {
        assert.ok(taskSourcedPorts(PARITY_TPL, nodeId(key)).size > 0, `${key} is task-wired`);
        const p = promptFor(key, { extras });
        assert.ok(p.includes(V1_REQUEST_BLOCK), `${key}: ## Original request`);
        assert.ok(!p.includes(V1_UPSTREAM_BLOCK), `${key}: no upstream header`);
        assert.ok(p.includes(V1_ATTACHMENTS_HEAD), `${key}: ## Attached files`);
        assert.ok(p.includes('- `/abs/spec.md` (spec.md)'), `${key}: the attachment row`);
      }
    } },
    { name: 'request policy: wantsRequest builtins get the request but NEVER the attachments', run: () => {
      const extras = [{ name: 'spec.md', path: '/abs/spec.md' }];
      for (const key of WANTS_REQUEST) {
        assert.equal(REGISTRY[key].wantsRequest, true, `${key}.wantsRequest`);
        assert.equal(taskSourcedPorts(PARITY_TPL, nodeId(key)).size, 0, `${key} binds no task token`);
        const p = promptFor(key, { extras });
        assert.ok(p.includes(V1_REQUEST_BLOCK), `${key}: ## Original request`);
        assert.ok(!p.includes(V1_ATTACHMENTS_HEAD), `${key}: no attachments`);
      }
    } },
    { name: 'request policy: every other builtin gets the upstream-input header and no request text', run: () => {
      for (const key of UPSTREAM_ONLY) {
        const p = promptFor(key, { extras: [{ name: 'spec.md', path: '/abs/spec.md' }] });
        assert.ok(p.includes(V1_UPSTREAM_BLOCK), `${key}: ## Upstream input`);
        assert.ok(!p.includes(TASK_PROMPT), `${key}: no request text at all`);
        assert.ok(!p.includes(V1_ATTACHMENTS_HEAD), `${key}: no attachments`);
      }
    } },
  ]);
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

// ── markers ──────────────────────────────────────────────────────────────────

/** v1's MOCK_ROLE per builtin — the closed writer vocabulary the offline mock
 *  switches on. The scanner's marker is deliberately NOT its prompt role. */
const MOCK_ROLES = {
  clarify: 'clarify', planner: 'planner-plan', refiner: 'refiner', decomposer: 'decomposer',
  implementer: 'implementer', reviewer: 'reviewer', planReviewer: 'plan-review',
  workspaceReviewer: 'workspace-reviewer', manualTestsChecklist: 'manual-tests-checklist',
  manualWebUiTesting: 'manual-web-ui-testing', workspaceScanner: 'workspace-scan',
  memoryDefragmenter: 'memory-defrag', workspaceUsageMapper: 'workspace-usage', workspaceSynthesizer: 'workspace-synth',
  // The architecture pair is post-v1: the setup form rides the clarify writer, the
  // architect has its own c4-architect writer.
  architectSetup: 'clarify', architect: 'c4-architect',
  // The promo video crew is post-v1 too: two form clarifiers on the clarify writer, the
  // producers on the generic writer, the review on the generic verifier (no bespoke roles).
  promoSetup: 'clarify', promoVoice: 'clarify', promoExplorer: 'generic-producer', promoWriter: 'generic-producer',
  promoCapture: 'generic-producer', promoMascot: 'generic-producer', promoScenes: 'generic-producer', promoReview: 'generic-verifier',
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
  assert.deepEqual(BUILTIN_KEYS.filter((k) => REGISTRY[k].verdict).sort(), ['manualWebUiTesting', 'planReviewer', 'promoReview', 'refiner', 'reviewer', 'workspaceReviewer']);
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

// ── role reviews (spec §3) ───────────────────────────────────────────────────

const RECORDED_PLAN = readFileSync(new URL('./fixtures/role-review/recorded-plan.md', import.meta.url), 'utf8');

/** A role-review slice ctx as the orchestrator builds it: the roleReview port set, the slice, the role and its plan. */
function roleSliceCtx(role, siblings) {
  const base = ctxFor('planReviewer', { slice: { id: `role-${role}`, title: role, phase: 1, path: null, role, index: 0, siblings } });
  const node = { ...base.node, config: { roleReview: true } };
  const ports = portsFn(node);
  const executionId = base.executionId;
  return {
    ...base, node, ports, bindings: { plan: { seq: 1, type: 'md', path: '/abs/plan.md' } },
    outputs: allocateOutputs({ node, ports, executionId, ordinal: ORDINAL, runCtx: base.runCtx }),
    verdict: allocateVerdict({ node, ports, ordinal: ORDINAL, runCtx: base.runCtx }),
    role, rolePlanText: RECORDED_PLAN,
  };
}

test('role reviews: a role slice prompt carries its own brief and markers only, no siblings block', () => {
  const ux = buildAgentPrompt(roleSliceCtx('ux', [{ id: 'role-qa', title: 'QA', file: null }]));
  assert.equal(ux.match(/## Your role:/g).length, 1);
  assert.match(ux, /## Your role: UX/);
  assert.doesNotMatch(ux, /## Your role: QA|`R-qa-/);
  assert.match(ux, /^MOCK_PERSPECTIVE: ux$/m);
  assert.match(ux, /^MOCK_CHECKLIST: R-ux-1,R-ux-2,/m);
  assert.match(ux, /^MOCK_ROLE: plan-review$/m);
  assert.doesNotMatch(ux, /Parallel siblings/);
  assert.doesNotMatch(ux, /^MOCK_FINDINGS:/m);
  const plain = promptFor('planReviewer');
  assert.doesNotMatch(plain, /## Your role:|MOCK_PERSPECTIVE|MOCK_CHECKLIST/);
});

test('role reviews: only the Project fit slice carries the house brief', () => {
  const brief = '# House brief\n\n## Components\n- ui/public/shape/check-row.mjs — rows\n';
  const fit = buildAgentPrompt({ ...roleSliceCtx('fit', []), houseBrief: brief });
  assert.match(fit, /^## Project fit: the house brief$/m);
  assert.match(fit, /^# House brief$/m);
  assert.match(fit, /^MOCK_PERSPECTIVE: fit$/m);
  const ux = buildAgentPrompt({ ...roleSliceCtx('ux', []), houseBrief: brief });
  assert.doesNotMatch(ux, /House brief/);
  for (const key of ['planner', 'refiner', 'planReviewer']) assert.doesNotMatch(promptFor(key), /House brief/, key);
});

test('role reviews: the refiner renders the findings directive and MOCK_FINDINGS only when findings is bound', () => {
  const bound = promptFor('refiner', { only: ['plan', 'findings'] });
  assert.match(bound, /## Role reviews/);
  assert.match(bound, /"addressed": \["ux-1-1"/);
  assert.match(bound, /^MOCK_FINDINGS: \/abs\/findings\.md$/m);
  const plain = promptFor('refiner');
  assert.doesNotMatch(plain, /## Role reviews|MOCK_FINDINGS/);
});
