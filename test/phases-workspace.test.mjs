// test/phases-workspace.test.mjs
// Workspace prompt-injection helpers (M3): workspaceContextBlock (cap + ellipsis),
// workspaceFanOutDirective (per-strategy pure text + anti-recursion), the optional
// 4th arg to buildSystemPrompt, and the taskHeader `## Workspace projects` block.
// All pure (no IO, no spawn). Byte-identity for single-project is pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  workspaceContextBlock, workspaceFanOutDirective, buildSystemPrompt, taskHeader,
  fanOutDirective, workspaceDiffInstruction, genericIoBlock,
} from '../src/core/phases.mjs';

const WS = {
  description: '# Workspace: Demo\n\nTwo services share a REST contract.',
  projects: [
    { projectKey: 'iam-1a2b3c4d', projectName: 'iam', worktreeDir: '/wt/iam', checkpointRef: 'sha-iam' },
    { projectKey: 'ui-5e6f7a8b', projectName: 'ui', worktreeDir: '/wt/ui', checkpointRef: 'sha-ui' },
  ],
};

// ── workspaceContextBlock ────────────────────────────────────────────────────
test('workspaceContextBlock: returns "" when no workspace (single-project byte-identity)', () => {
  assert.equal(workspaceContextBlock(undefined), '');
  assert.equal(workspaceContextBlock(null), '');
  assert.equal(workspaceContextBlock({}), '', 'no description -> empty');
  assert.equal(workspaceContextBlock({ description: '' }), '', 'empty description -> empty');
});

test('workspaceContextBlock: emits the heading, the description, and the member names', () => {
  const b = workspaceContextBlock(WS);
  assert.match(b, /## Workspace Context/);
  assert.match(b, /share a REST contract/);
  assert.match(b, /Member projects: iam, ui\./);
});

test('workspaceContextBlock: injects the FULL description, no cap, no ellipsis', () => {
  const long = '# Workspace: Big\n\n' + 'x'.repeat(5000);
  const b = workspaceContextBlock({ description: long, projects: [] });
  assert.ok(b.includes('x'.repeat(5000)), 'full description present verbatim');
  assert.ok(!b.includes('…'), 'no truncation ellipsis');
});

test('workspaceContextBlock: reads the real channel shape (workspaceDescription key)', () => {
  // Mirrors orchestrator.mjs#_workspaceChannel: the bus channel uses `workspaceDescription`,
  // NOT `description`. This is the production shape that buildSystemPrompt receives.
  const ws = {
    kind: 'metadata',
    workspaceDescription: '# Workspace: Real\n\nServices share a REST contract.',
    projects: [{ projectName: 'iam' }, { projectName: 'ui' }],
  };
  const b = workspaceContextBlock(ws);
  assert.match(b, /## Workspace Context/);
  assert.match(b, /share a REST contract/);
  assert.match(b, /Member projects: iam, ui\./);
});

// ── buildSystemPrompt 4th arg ────────────────────────────────────────────────
test('buildSystemPrompt: 4th arg injects the workspace block AFTER tool, BEFORE body', () => {
  const sys = buildSystemPrompt('TOOL_INSTRUCTION', 'AGENT_BODY', 'planner-plan', WS);
  const iTool = sys.indexOf('TOOL_INSTRUCTION');
  const iWs = sys.indexOf('## Workspace Context');
  const iBody = sys.indexOf('AGENT_BODY');
  assert.ok(iTool >= 0 && iWs >= 0 && iBody >= 0, 'all three present');
  assert.ok(iTool < iWs && iWs < iBody, `order: tool(${iTool}) < ws(${iWs}) < body(${iBody})`);
});

test('buildSystemPrompt: no 4th arg -> single-project prompt is byte-identical', () => {
  const without = buildSystemPrompt('TOOL', 'BODY', 'planner-plan');
  const withUndef = buildSystemPrompt('TOOL', 'BODY', 'planner-plan', undefined);
  assert.equal(without, withUndef);
  assert.doesNotMatch(without, /## Workspace Context/);
  assert.equal(without, 'TOOL\n\nBODY');
});

// ── workspaceFanOutDirective ─────────────────────────────────────────────────
test('workspaceFanOutDirective: explore strategy mentions one read-only sub-agent per project + anti-recursion', () => {
  const d = workspaceFanOutDirective('explore', WS);
  assert.match(d, /per (member )?project/i);
  assert.match(d, /read-only/i);
  assert.match(d, /projectKey/, 'merge sorted by projectKey');
  assert.match(d, /MUST NOT.*re-?fan-?out|never.*re-?fan-?out|not.*spawn.*sub-agent/i,
    'anti-recursion rule present');
});

test('workspaceFanOutDirective: task strategy mentions one sub-agent per plan task editing named projects', () => {
  const d = workspaceFanOutDirective('task', WS);
  assert.match(d, /task/i);
  assert.match(d, /Projects:/, 'reads the Projects: tag');
  assert.match(d, /MUST NOT.*re-?fan-?out|never.*re-?fan-?out|not.*spawn.*sub-agent/i);
});

test('workspaceFanOutDirective: review strategy mentions one reviewer per touched project + union of issues', () => {
  const d = workspaceFanOutDirective('review', WS);
  assert.match(d, /touched|changed/i);
  assert.match(d, /union/i, 'union of issues, never collapse');
  assert.match(d, /MUST NOT.*re-?fan-?out|never.*re-?fan-?out|not.*spawn.*sub-agent/i);
});

test('workspaceFanOutDirective: unknown strategy / no workspace -> "" (safe)', () => {
  assert.equal(workspaceFanOutDirective('explore', null), '');
  assert.equal(workspaceFanOutDirective('nope', WS), '');
});

// ── taskHeader workspace arm ─────────────────────────────────────────────────
const baseCtx = { projectDir: '/p', pipelineDir: '/pipe', taskPrompt: 'BUILD' };

test('taskHeader: with ctx.workspace lists each member worktree dir + checkpoint ref', () => {
  const h = taskHeader({ ...baseCtx, node: { key: 'planner' }, inputs: { userPrompt: {} }, workspace: WS }, 'Plan');
  assert.match(h, /## Workspace projects/);
  assert.match(h, /iam/);
  assert.match(h, /\/wt\/iam/, 'iam worktree dir');
  assert.match(h, /sha-iam/, 'iam checkpoint ref');
  assert.match(h, /\/wt\/ui/, 'ui worktree dir');
  assert.match(h, /sha-ui/, 'ui checkpoint ref');
});

test('taskHeader: no ctx.workspace -> no Workspace projects block (single-project byte-identity)', () => {
  const h = taskHeader({ ...baseCtx, node: { key: 'planner' }, inputs: { userPrompt: {} } }, 'Plan');
  assert.doesNotMatch(h, /## Workspace projects/);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4 (§5.8) — mode-gated prompt variants
// ═══════════════════════════════════════════════════════════════════════════════
// GATING (plan §6 Phase 4, verbatim): *every* prompt change is gated on
// `runRootMode === 'detached'`; workspace-specific variants are ADDITIONALLY gated on
// `isWorkspace`. Inside phases.mjs the detached signal is `ctx.runRoot`, which
// orchestrator._nodeCtx sets to a path ONLY on detached runs (null under legacy) — the
// same load-bearing gate the plan names for `workspaceWriteTargets`. Using the ctx
// (not a fresh env read) is what keeps a RESUMED run on its RECORDED mode (§8.14).
// Per §6 intro every mode-sensitive test also pins WORCA_RUN_ROOT, so these stay
// correct if a future refactor ever reads the env from here.
const RUN_ROOT = '/mh/runs/pipe-1';
function withMode(mode, fn) {
  const prev = process.env.WORCA_RUN_ROOT;
  process.env.WORCA_RUN_ROOT = mode;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.WORCA_RUN_ROOT;
    else process.env.WORCA_RUN_ROOT = prev;
  }
}

/** The workspace bus-channel shape on a DETACHED run: worktreeDir stays ABSOLUTE
 *  (§5.8 / the Phase-1 channels-workspace pin) — relativization is render-only. */
const WS_D = {
  kind: 'metadata',
  workspaceDescription: '# Workspace: Demo\n\nTwo services share a REST contract.',
  projects: [
    {
      projectKey: 'iam-1a2b3c4d', projectName: 'iam',
      worktreeDir: `${RUN_ROOT}/repos/iam-1a2b3c4d`, checkpointRef: 'sha-iam',
      graphInstruction: 'A code knowledge-graph CLI named "graphify" is available…',
    },
    {
      projectKey: 'ui-5e6f7a8b', projectName: 'ui',
      worktreeDir: `${RUN_ROOT}/repos/ui-5e6f7a8b`, checkpointRef: 'sha-ui',
      graphInstruction: '',                       // no graph for this member
    },
  ],
};
const wsCtx = (extra = {}) => ({
  ...baseCtx, node: { key: 'planner' }, inputs: { userPrompt: {} }, workspace: WS_D, ...extra,
});

// ── taskHeader: detached workspace variant ───────────────────────────────────
test('taskHeader: detached workspace names the RUN ROOT as cwd, the member repos, and no single project', () => {
  withMode('detached', () => {
    const h = taskHeader(wsCtx({ projectDir: RUN_ROOT, runRoot: RUN_ROOT }), 'Plan');
    assert.match(h, new RegExp(`Run root \\(your cwd\\): ${RUN_ROOT}`), 'run-root cwd line');
    assert.doesNotMatch(h, /Project directory \(your cwd\)/, 'the single-project cwd line is gone');
    assert.match(h, /Member projects: \.\/repos\/iam-1a2b3c4d \(iam\), \.\/repos\/ui-5e6f7a8b \(ui\)/);
    assert.match(h, /no single project/i, 'states that the agent is in no single project');
    assert.match(h, /member worktrees/i);
  });
});

test('taskHeader: detached workspace block renders repos/<key>, keeps refs, adds per-member graph', () => {
  withMode('detached', () => {
    const h = taskHeader(wsCtx({ projectDir: RUN_ROOT, runRoot: RUN_ROOT }), 'Plan');
    assert.match(h, /## Workspace projects/);
    assert.match(h, /worktree `repos\/iam-1a2b3c4d`/, 'render-time RELATIVE path');
    assert.match(h, /worktree `repos\/ui-5e6f7a8b`/);
    assert.ok(!h.includes(`${RUN_ROOT}/repos/`), 'no absolute worktree path is rendered');
    assert.match(h, /diff base `sha-iam`/, 'checkpoint refs retained');
    assert.match(h, /diff base `sha-ui`/);
    assert.match(h, /graph `repos\/iam-1a2b3c4d\/graphify-out\/`/, 'per-member graph location');
    assert.doesNotMatch(h, /graph `repos\/ui-5e6f7a8b\/graphify-out\/`/, 'no graph cell without an instruction');
    assert.match(h, /git -C repos\/<key>/, 'operate-in-place framing, not "cwd into"');
    assert.doesNotMatch(h, /cwds? into/i);
  });
});

test('taskHeader: LEGACY workspace keeps today cwd line + ABSOLUTE worktree paths (§10 rollback guard)', () => {
  withMode('legacy', () => {
    // No ctx.runRoot === legacy (orchestrator._nodeCtx). Bytes must not move.
    const h = taskHeader(wsCtx({ projectDir: '/wt/iam' }), 'Plan');
    assert.match(h, /Project directory \(your cwd\): \/wt\/iam/);
    assert.doesNotMatch(h, /Run root \(your cwd\)/);
    assert.match(h, new RegExp(`worktree \`${RUN_ROOT}/repos/iam-1a2b3c4d\``), 'absolute, as today');
    assert.doesNotMatch(h, /worktree `repos\//);
    assert.doesNotMatch(h, /graphify-out/, 'no graph cell under legacy');
    assert.match(h, /cwds into the/, "today's cwd-into wording is preserved");
  });
});

// ── the TWO single-project fixtures: legacy bytes vs the ONE-sentence detached delta ──
// Today's exact bytes, captured from the pre-Phase-4 tree at 430b588..cad646e.
const SINGLE_LEGACY_BYTES =
  '# Task: Plan\n\n' +
  'Project directory (your cwd): /p\n' +
  'Pipeline directory (shared artifacts): /pipe\n\n' +
  'Project and personal skills (.claude/skills in this project and ~/.claude/skills) are ' +
  'available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or ' +
  'knowledge-graph skills) rather than guessing conventions.\n\n' +
  '## Original request\n\nBUILD\n';

test('taskHeader: single-project under LEGACY is BYTE-identical to today (§10 rollback contract)', () => {
  withMode('legacy', () => {
    const h = taskHeader({ ...baseCtx, node: { key: 'planner' }, inputs: { userPrompt: {} } }, 'Plan');
    assert.equal(h, SINGLE_LEGACY_BYTES);        // bytes, not a regex
  });
});

test('taskHeader: single-project under DETACHED differs by EXACTLY the skills-hint sentence', () => {
  const detached = withMode('detached', () =>
    taskHeader({ ...baseCtx, node: { key: 'planner' }, inputs: { userPrompt: {} }, runRoot: RUN_ROOT }, 'Plan'));
  // The new sentence is truthful only under detached: project + root skills are
  // MOUNTED at <cwd>/.claude/skills for the run (§5.7), which legacy never does.
  assert.match(detached, /mounted at `?\.claude\/skills`? for this run/);
  assert.match(detached, /~\/\.claude\/skills/, 'personal skills still named');
  // …and it is the ONLY difference: swapping the hint paragraph back reproduces the
  // legacy bytes EXACTLY (so no other line drifted under detached).
  const legacyHint = SINGLE_LEGACY_BYTES.split('\n\n')[2];
  const detachedHint = detached.split('\n\n')[2];
  assert.notEqual(detachedHint, legacyHint, 'the hint paragraph did change');
  assert.equal(detached.replace(detachedHint, legacyHint), SINGLE_LEGACY_BYTES);
  // Single mode carries no workspace block in either mode.
  assert.doesNotMatch(detached, /## Workspace projects/);
  assert.doesNotMatch(detached, /Run root \(your cwd\)/);
});

// ── generic fanOutDirective: the §8.21 omitProjectAgents flag ─────────────────
test('fanOutDirective: default is byte-identical to today and keeps the project-agents clause', () => {
  const d = fanOutDirective(true);
  assert.equal(d, fanOutDirective(true, {}), 'an empty options object changes nothing');
  assert.equal(d, fanOutDirective(true, { omitProjectAgents: false }));
  assert.match(d, /this project's own agents \(`\.claude\/agents`\)/);
  assert.equal(fanOutDirective(false, { omitProjectAgents: true }), '', 'off still wins');
});

test('fanOutDirective: omitProjectAgents drops the project-agents promise, keeps ~/.claude/agents (§8.21)', () => {
  const omit = fanOutDirective(true, { omitProjectAgents: true });
  const keep = fanOutDirective(true);
  assert.doesNotMatch(omit, /this project's own agents/, 'cwd is the run root — no project agents');
  assert.doesNotMatch(omit, /`\.claude\/agents`/, 'the project path is never promised');
  assert.match(omit, /`~\/\.claude\/agents`/, 'personal agents remain promised (inherited env)');
  assert.match(omit, /general-purpose/);
  // The ONLY delta is the sub-agent sentence: every other paragraph is identical.
  const para = (s) => s.split('\n\n');
  const [po, pk] = [para(omit), para(keep)];
  assert.equal(po.length, pk.length, 'same paragraph count');
  const differing = po.filter((p, i) => p !== pk[i]);
  assert.equal(differing.length, 1, `exactly one paragraph differs: ${JSON.stringify(differing)}`);
  assert.match(differing[0], /subagent_type/);
});

// ── workspace fan-out directives: git -C repos/<key> ─────────────────────────
test('workspaceFanOutDirective: detached variants operate in place with git -C repos/<key>', () => {
  for (const strategy of ['explore', 'task', 'review']) {
    const d = workspaceFanOutDirective(strategy, WS_D, { relative: true });
    assert.match(d, /git -C repos\//, `${strategy}: git -C directive`);
    assert.doesNotMatch(d, /cwd into/i, `${strategy}: no cwd-into instruction`);
    assert.match(d, /MUST NOT.*re-?fan-?out/is, `${strategy}: anti-recursion untouched`);
  }
  assert.match(workspaceFanOutDirective('explore', WS_D, { relative: true }), /projectKey/, 'merge order kept');
  assert.match(workspaceFanOutDirective('task', WS_D, { relative: true }), /Projects:/);
  assert.match(workspaceFanOutDirective('review', WS_D, { relative: true }), /union/i);
});

test('workspaceFanOutDirective: legacy (no options) is byte-identical to today', () => {
  for (const strategy of ['explore', 'task', 'review']) {
    const d = workspaceFanOutDirective(strategy, WS_D);
    assert.equal(d, workspaceFanOutDirective(strategy, WS_D, {}), 'empty options === today');
    assert.equal(d, workspaceFanOutDirective(strategy, WS_D, { relative: false }));
    assert.doesNotMatch(d, /git -C/, `${strategy}: no run-root wording under legacy`);
  }
  assert.match(workspaceFanOutDirective('task', WS_D), /cwd into the named worktree/,
    "today's task wording is the legacy rollback baseline");
});

// ── manualTestsChecklist / per-member diff hints ─────────────────────────────
test('workspaceDiffInstruction: per-member git -C lines on a detached workspace run', () => {
  withMode('detached', () => {
    const s = workspaceDiffInstruction(wsCtx({ projectDir: RUN_ROOT, runRoot: RUN_ROOT }));
    assert.match(s, /git -C repos\/iam-1a2b3c4d diff sha-iam/);
    assert.match(s, /git -C repos\/ui-5e6f7a8b diff sha-ui/);
    assert.match(s, /iam/); assert.match(s, /ui/);
  });
});

test('workspaceDiffInstruction: "" for single-project and for legacy workspace runs', () => {
  withMode('detached', () => {
    assert.equal(workspaceDiffInstruction({ ...baseCtx, runRoot: RUN_ROOT }), '', 'single project');
  });
  withMode('legacy', () => {
    assert.equal(workspaceDiffInstruction(wsCtx({ projectDir: '/wt/iam' })), '', 'legacy workspace');
  });
  assert.equal(workspaceDiffInstruction(undefined), '', 'never throws');
});

// ── genericIoBlock: the runroot handle renders per member (§5.8) ──────────────
test('genericIoBlock: a runroot code handle names each member checkout + its diff base', () => {
  const block = genericIoBlock({
    code: {
      kind: 'runroot', dir: RUN_ROOT,
      repos: [
        { projectKey: 'iam-1a2b3c4d', projectName: 'iam', relDir: 'repos/iam-1a2b3c4d', checkpointRef: 'sha-iam' },
        { projectKey: 'ui-5e6f7a8b', projectName: 'ui', relDir: 'repos/ui-5e6f7a8b', checkpointRef: 'sha-ui' },
      ],
    },
  }, {});
  assert.match(block, /git -C repos\/<key> diff/);
  assert.match(block, /repos\/iam-1a2b3c4d \(diff base sha-iam\)/);
  assert.match(block, /repos\/ui-5e6f7a8b \(diff base sha-ui\)/);
  assert.doesNotMatch(block, /in your cwd/, 'the scalar working-tree hint is meaningless at a run root');
});

test('genericIoBlock: the worktree handle hint is unchanged (single-project byte-identity)', () => {
  const block = genericIoBlock({ code: { kind: 'worktree' } }, {});
  assert.match(block, /- code: \(the working tree — inspect with `git diff` \/ `git status` in your cwd\)/);
});

test('workspaceFanOutDirective: endpointRouted swaps the explore arm off Explore; default keeps today\'s bytes', () => {
  const ws = { projects: [{ projectKey: 'a' }] };
  const plain = workspaceFanOutDirective('explore', ws);
  assert.equal(workspaceFanOutDirective('explore', ws, { endpointRouted: false }), plain, 'default off changes nothing');
  assert.match(plain, /Explore sub-agent/);
  const routed = workspaceFanOutDirective('explore', ws, { endpointRouted: true });
  assert.doesNotMatch(routed, /Explore sub-agent/, 'a routed node is never steered into Explore');
  assert.match(routed, /`general-purpose` investigator/);
  assert.equal(workspaceFanOutDirective('explore', ws, { relative: true, endpointRouted: true }).includes('Explore sub-agent'), false,
    'relative + routed compose');
  for (const s of ['task', 'review']) {
    assert.equal(workspaceFanOutDirective(s, ws, { endpointRouted: true }), workspaceFanOutDirective(s, ws),
      `${s}: routed changes nothing (already general-purpose / names no type)`);
  }
});
