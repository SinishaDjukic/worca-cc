// test/run-report.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getDb } from '../src/core/db.mjs';
import { upsertSubAgent, writeReview } from '../src/core/artifacts.mjs';
import { persistResults, OVERVIEW_FILE } from '../src/core/results.mjs';
import { writeGuardrailSet } from '../src/core/guardrail-store.mjs';
import { seedPipeline, seedWorkspacePipeline } from './helpers/db-seed.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  buildRunReport, countIssues, workflowShape, cyclesByNode, renderIssueBody,
} from '../src/core/run-report.mjs';

// Module top level, like the other 169 files: WORCA_HOME must be set before any
// lazy getDb() can migrate the developer's real ~/.worca-cc.
const home = useTempHome(after);
const WORCA_VERSION = createRequire(import.meta.url)('../package.json').version;

const STARTED = '2026-06-01T00:00:00.000Z';
const ENDED   = '2026-06-01T00:30:00.000Z';   // +30 min => wallClockMs 1_800_000

// The graphify instruction the runner really writes is ~700 chars of boilerplate;
// this fixture keeps a DISTINCTIVE substring so the redaction guard below is not
// vacuous (v1 asserted /graphify-out/, which its own fixture never contained).
const TOOLS_INSTRUCTION =
  'A code knowledge-graph CLI named "graphify" is available, and a fresh graph for ' +
  'THIS worktree has been built at graphify-out/ (relative to your working directory).';

let id, dir, wsId, wsDir;

const STEPPER_V2 = {
  version: 2,
  template: { id: 'wf_default', name: 'Default' },
  graph: {
    nodes: [
      { id: 'n_plan', kind: 'agent', key: 'planner', label: 'Planner', x: 0, y: 0,
        uiPhase: 'plan', color: 'red', icon: '<circle/>',
        // The authored config: a custom agent can put ANYTHING here (manifest.mjs:133).
        config: { secretNote: 'ping me at ddprinov@gmail.com', apiBase: 'https://internal.acme' },
        model: 'claude-opus-5', effort: 'high', fanOut: true, askQuestions: false,
        awaitAll: false, subagentModel: '' },
    ],
    wires: [{ id: 'w1', from: { node: 'n_plan', port: 'plan' },
              to: { node: 'n_plan', port: 'revise' }, loop: true, maxCycles: 3 }],
  },
  steps: [], feedbacks: [],
};

/**
 * seedPipeline CANNOT set a run's clock: `started_at` is INSERT-arm only
 * (artifacts.mjs:890) and writeState overwrites `updated_at` with now on every call
 * (artifacts.mjs:1037) — neither column is in the UPSERT list (artifacts.mjs:1051-1060).
 * Stamp them directly so wallClockMs / waitingMs are assertable at all.
 */
function stampClock(pipelineId, startedAt, updatedAt) {
  getDb().prepare('UPDATE pipelines SET started_at = ?, updated_at = ? WHERE id = ?')
    .run(startedAt, updatedAt, pipelineId);
}

before(async () => {
  ({ id, dir } = await seedPipeline(join(home, 'proj'), {
    title: 'Secret Project rework', status: 'done', phase: 'done', cycle: 2,
    prompt: 'rewrite the billing module for ACME Corp',
    totalCostUsd: 4.21, totalActiveMs: 640000,
    branch: { source: 'dev', feature: 'feat/acme-billing', worktreeDir: '/Users/someone/secret/wt' },
    stepper: STEPPER_V2,
    tools: { graphify: true, codeReviewGraph: false, tool: 'graphify', kind: 'cli',
             instruction: TOOLS_INSTRUCTION },
    steps: [
      { key: 'x:n_plan:1', nodeId: 'n_plan', phase: 'planner', agentKey: 'planner',
        cycle: 1, status: 'done', costUsd: 3.00, activeMs: 500000,
        startedAt: STARTED, endedAt: '2026-06-01T00:08:20.000Z' },
      { key: 'x:n_plan:2', nodeId: 'n_plan', phase: 'planner', agentKey: 'planner',
        cycle: 2, status: 'done', costUsd: 1.21, activeMs: 140000,
        startedAt: '2026-06-01T00:08:20.000Z', endedAt: '2026-06-01T00:10:40.000Z' },
    ],
  }));
  stampClock(id, STARTED, ENDED);

  await mkdir(dir, { recursive: true });   // seedPipeline creates it; belt and braces
  await persistResults(dir, {
    summary: { filesNew: 2, filesChanged: 19, filesDeleted: 0,
               linesAdded: 634, linesRemoved: 95, blockingIssues: 1, nitpicks: 1 },
    newFiles: [{ path: 'src/acme/billing.mjs', status: 'A', added: 46, removed: 0 }],
    changedFiles: [{ path: 'src/core/db.mjs', status: 'M', added: 11, removed: 1, issues: [] }],
    keyThingsToCheck: [{ id: 'check-0', severity: 'major', title: 'unguarded write',
                         detail: '…', location: 'src/acme/billing.mjs:42', kind: 'refine', cycle: 1 }],
    nitpicks: [{ severity: 'minor', title: 'rename x', kind: 'refine' }],
  });

  // The cached overview. Without this on disk readRunArtifacts returns overview:null
  // and EVERY narrative assertion below passes no matter what the builder does — the
  // `paths` gate on the narrative is the highest-value redaction gate in the feature,
  // so it is pinned against a real file. Shape per normalizeOverview
  // (overview-agent.mjs:70-74); the narrative deliberately names a file, because a
  // model writes it FROM the diff and that is exactly why D7 gates it behind `paths`.
  await writeFile(join(dir, OVERVIEW_FILE), JSON.stringify({
    narrative: 'Rewrote src/acme/billing.mjs end to end.',
    diffFindings: [{ severity: 'major', file: 'src/acme/billing.mjs', line: 42,
                     title: 'unchecked write to billing', detail: '…', newVsReview: true }],
    diffCheckTruncated: false,
  }, null, 2));

  // writeReview is ASYNC and swallows every error (artifacts.mjs:245): an unawaited
  // call shows up later as "every issue count is 0", never as a rejection.
  await writeReview(id, 'refine', 1, {
    summary: 'one blocker',
    issues: [
      { severity: 'major', title: 'unguarded write', detail: 'd', location: 'src/acme/billing.mjs:42' },
      { severity: 'minor', title: 'rename x', detail: 'd', location: 'src/acme/billing.mjs:9' },
    ],
  });

  upsertSubAgent(id, {
    id: 'toolu_a', label: 'investigate ACME billing', nodeId: 'n_plan', stepIndex: 0,
    cycle: 1, stepKey: 'x:n_plan:1', status: 'finished',
    startedAt: STARTED, finishedAt: '2026-06-01T00:05:01.000Z',
    durationMs: 300000, tokens: 171728, costUsd: 0.94, subagentType: 'general-purpose',
    runModel: 'claude-opus-5', skills: ['acme-internal-skill'],
  });

  // ── a WORKSPACE run: different results.json top level (run-harness.mjs:2810) ──
  // seedWorkspacePipeline only round-trips the workspace superset when `state`
  // carries workspaceId/workspaceName/projectKeys (artifacts.mjs:1364-1380).
  ({ id: wsId, dir: wsDir } = await seedWorkspacePipeline(
    join(home, 'alpha'), 'wks-demo',
    { status: 'done', phase: 'done', title: 'WS rework',
      workspaceId: 'wks-demo', workspaceName: 'Acme Platform',
      projectKeys: ['alpha-11111111', 'beta-22222222'],
      totalCostUsd: 1.5, totalActiveMs: 60000 },
    [{ projectKey: 'alpha-11111111', projectDir: join(home, 'alpha'), projectName: 'alpha' },
     { projectKey: 'beta-22222222', projectDir: join(home, 'beta'), projectName: 'beta' }],
  ));
  await mkdir(wsDir, { recursive: true });
  await persistResults(wsDir, {
    summary: { filesNew: 1, filesChanged: 4, filesDeleted: 0,
               linesAdded: 40, linesRemoved: 5, blockingIssues: 0, nitpicks: 0 },
    perProject: {
      'alpha-11111111': { summary: { filesChanged: 3 }, changedFiles: [{ path: 'a/x.mjs' }] },
      'beta-22222222':  { summary: { filesChanged: 1 }, changedFiles: [{ path: 'b/y.mjs' }] },
    },
  });
});

// ── the contract that matters most ────────────────────────────────────────────
test('the DEFAULT payload is metadata only: no prompt, no paths, no names, no diff', async () => {
  const p = await buildRunReport(id, { reason: 'poor-quality' });
  const blob = JSON.stringify(p);

  assert.equal(p.schemaVersion, 1, 'the payload is versioned');
  assert.deepEqual(p.included, { paths: false, prompt: false, names: false },
    'the receipt says nothing was opted in');

  // Each excluded class, asserted by the very string that would leak it.
  assert.doesNotMatch(blob, /rewrite the billing module/, 'the prompt text is absent');
  assert.doesNotMatch(blob, /src\/acme\/billing\.mjs/, 'no file path leaks (incl. an issue location)');
  assert.doesNotMatch(blob, /feat\/acme-billing/, 'no branch name leaks');
  assert.doesNotMatch(blob, /Secret Project rework/, 'no run title leaks');
  assert.doesNotMatch(blob, /secret\/wt/, 'the worktree path never leaks, under any option');
  assert.doesNotMatch(blob, /ddprinov@gmail\.com/, 'the authored node config is never embedded');
  assert.doesNotMatch(blob, /internal\.acme/, 'no unknown config key rides along either');
  assert.doesNotMatch(blob, /investigate ACME billing/, 'a sub-agent label is free text and is dropped');
  assert.doesNotMatch(blob, /acme-internal-skill/, 'a sub-agent skill name is dropped too');
  // A substring that IS in the seeded tools.instruction — v1 asserted one that was not.
  assert.doesNotMatch(blob, /fresh graph for THIS worktree/,
    'the tools instruction blob is dropped (D12)');
  assert.equal('prompt' in p.run, false, 'run.prompt is ABSENT, not null');
  // A real overview.json IS on disk for this run (see before()), so this is a live
  // gate, not a vacuous truth: move the assignment out of `if (include.paths)` and
  // this fails.
  assert.equal('narrative' in p, false, 'the narrative is absent without the paths opt-in');
  assert.doesNotMatch(blob, /unchecked write to billing/,
    'and the overview\'s diffFindings ship under NO option — only its narrative, behind paths');
  assert.equal('issues' in p.review, false, 'review issues are counts-only by default');
});

test('the always-on set is the rich one: versions, totals, workflow, steps, sub-agents, counts', async () => {
  const p = await buildRunReport(id, { reason: 'something-else' });

  assert.equal(p.app.worca, WORCA_VERSION, 'the worca version rides EVERY report');
  assert.equal(p.app.node, process.version);
  assert.equal(p.app.platform, process.platform);
  assert.equal(p.app.arch, process.arch);
  assert.equal(p.run.status, 'done');
  assert.equal(p.run.cycle, 2);
  assert.equal(p.run.costUsd, 4.21);
  assert.equal(p.run.activeMs, 640000);
  assert.equal(p.run.wallClockMs, 1800000, 'wall clock = updated_at - started_at (30 min)');
  assert.equal(p.steps.length, 2, 'per-step metrics ship regardless of reason');
  assert.equal(p.subAgents.length, 1, 'per-sub-agent metrics ship regardless of reason');
  assert.deepEqual(p.review.issueCounts, { critical: 0, major: 1, minor: 1, suggestion: 0 },
    'review issue COUNTS ship regardless of reason');
  assert.equal(p.files.linesAdded, 634, 'file-summary counts ship regardless of reason');
  assert.equal(p.evidence, null, '"something else" leans on the always-on set');
});

test('the workflow shape is whitelisted, and keys + labels ship verbatim', async () => {
  const p = await buildRunReport(id, { reason: 'too-expensive' });

  assert.deepEqual(p.workflow.nodes[0], {
    id: 'n_plan', kind: 'agent', key: 'planner', label: 'Planner',
    model: 'claude-opus-5', effort: 'high',
    fanOut: true, askQuestions: false, awaitAll: false, cyclesUsed: 2,
  }, 'exactly the whitelisted fields — no config, no icon, no colour, no coordinates');

  assert.deepEqual(p.workflow.wires[0], {
    id: 'w1', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_plan', port: 'revise' },
    loop: true, maxCycles: 3,
  }, 'loop wires carry maxCycles');
  assert.deepEqual(p.workflow.template, { builtin: true, id: 'wf_default', name: 'Default' },
    'a STOCK workflow id is fixed vocabulary, so its identity ships whole');
  assert.equal('subagentModel' in p.workflow.nodes[0], false,
    'an empty subagentModel is omitted, not shipped as ""');
});

test('each reason attaches its own evidence block', async () => {
  const cost = await buildRunReport(id, { reason: 'too-expensive' });
  assert.equal(cost.evidence.topSteps[0].costUsd, 3.00, 'dearest step first');
  assert.equal(cost.evidence.subAgentTotals.tokens, 171728);
  assert.equal(cost.evidence.perNode[0].maxCycles, 3, 'cyclesUsed is comparable against maxCycles');
  assert.equal(cost.evidence.perNode[0].cyclesUsed, 2);
  assert.ok('pipelineLimitUsd' in cost.evidence.budget, 'the configured caps ride the cost report');

  const slow = await buildRunReport(id, { reason: 'too-slow' });
  assert.equal(slow.evidence.wallClockMs, 1800000);
  assert.equal(slow.evidence.activeMs, 640000);
  assert.equal(slow.evidence.overSubscribed, false, 'this run\'s steps ran one after another');
  assert.equal(slow.evidence.waitingMs, 1160000, 'the GAP is the finding: waiting vs working');
  assert.equal(slow.evidence.dominatingStep.nodeId, 'n_plan');
  assert.deepEqual(slow.evidence.fanOutNodes, ['planner'], 'fan-out nodes are named');

  const quality = await buildRunReport(id, { reason: 'poor-quality' });
  assert.equal(quality.evidence.blockingIssues, 1);
  assert.equal(quality.evidence.files.filesChanged, 19);
  assert.equal('newFiles' in quality.evidence.files, false, 'never the diff, never the paths');

  const failed = await buildRunReport(id, { reason: 'failed-or-stuck' });
  assert.equal(failed.evidence.status, 'done');
  assert.equal(failed.evidence.terminal, true);
  assert.deepEqual(failed.evidence.failedSteps, [], 'a clean run reports no failed steps');
});

// `activeMs` is the SUM of per-step active time; `wallClockMs` is elapsed time. Fan-out
// is a first-class feature, so on a parallel run the sum EXCEEDS the elapsed time and
// the gap is not a measurement of anything. Refuse to assert rather than publish an
// inverted number to a public issue tracker.
test('a PARALLEL run refuses to assert a waiting gap instead of inverting it', async () => {
  const OVERLAP_START = '2026-06-01T00:00:00.000Z';
  const OVERLAP_END   = '2026-06-01T00:01:00.000Z';   // +60s wall clock
  const parallel = await seedPipeline(join(home, 'fanout'), {
    status: 'done', phase: 'done', cycle: 1,
    // Two 50s steps inside a 60s run: 100_000 active against 60_000 elapsed.
    totalActiveMs: 100000, totalCostUsd: 1,
    steps: [
      { key: 'x:n_a:1', nodeId: 'n_a', phase: 'implementer', agentKey: 'implementer',
        cycle: 1, status: 'done', costUsd: 0.5, activeMs: 50000,
        startedAt: OVERLAP_START, endedAt: '2026-06-01T00:00:50.000Z' },
      { key: 'x:n_b:1', nodeId: 'n_b', phase: 'implementer', agentKey: 'implementer',
        cycle: 1, status: 'done', costUsd: 0.5, activeMs: 50000,
        startedAt: OVERLAP_START, endedAt: '2026-06-01T00:00:50.000Z' },
    ],
  });
  stampClock(parallel.id, OVERLAP_START, OVERLAP_END);

  const p = await buildRunReport(parallel.id, { reason: 'too-slow' });
  const ev = p.evidence;
  assert.equal(ev.wallClockMs, 60000);
  assert.equal(ev.activeMs, 100000, 'the sum really does exceed the elapsed time');
  assert.equal(ev.overSubscribed, true, 'the steps overlapped — say so rather than guess');
  assert.equal(ev.waitingMs, null,
    'NOT Math.max(0, …), which would report a 60s run as having waited 0s');
  assert.equal(ev.activeShare, null, 'NOT 1.667, which is self-evidently not a share');

  const body = renderIssueBody(p);
  assert.doesNotMatch(body, /waiting vs working/,
    'and the issue body drops the row rather than printing "0s waiting / 1m 40s working"');
  assert.match(body, /\| wall clock \| 1m 0s \|/, 'the measured facts still ship');
});

// The fixture run is `done` with a clean step set, so the block above only ever sees
// an EMPTY failure evidence. Seed a run that actually failed: this is the one reason
// whose source row routinely carries a resume_point, because the `error` branch does
// NOT clear it (run-harness.mjs:1196) the way `done` and `stopped` do.
test('a FAILED run carries its failure evidence — and never the raw pause detail (D10)', async () => {
  const failed = await seedPipeline(join(home, 'broken'), {
    status: 'error', phase: 'implement', cycle: 1,
    resumePoint: { version: 2, pauseReason: 'error',
                   pauseDetail: 'ENOENT: no such file or directory, open /Users/dp/secret.md' },
    // endReached + warnings ride the `outcome` blob, which toPipelineRow writes only
    // for engine 2 (artifacts.mjs:1407); without it both read null, not false/0.
    engine: 2, endReached: false,
    warnings: ['the worktree was left in place', 'no results.json was written'],
    steps: [
      { key: 'x:n_impl:1', nodeId: 'n_impl', phase: 'implementer', agentKey: 'implementer',
        cycle: 1, status: 'done', costUsd: 0.4, activeMs: 4000 },
      { key: 'x:n_rev:1', nodeId: 'n_rev', phase: 'reviewer', agentKey: 'reviewer',
        cycle: 1, status: 'error', costUsd: 0.2, activeMs: 1000 },
    ],
  });

  const p = await buildRunReport(failed.id, { reason: 'failed-or-stuck' });
  const ev = p.evidence;
  assert.equal(ev.status, 'error');
  assert.equal(ev.terminal, true, "'error' is a terminal status");
  assert.equal(ev.interrupted, false, 'interrupted is its own status, not a synonym for failed');
  assert.equal(ev.endReached, false, 'a real boolean, because this run has an outcome blob');
  assert.equal(ev.warningCount, 2, 'warnings are COUNTED — the text itself never ships');
  assert.deepEqual(ev.failedSteps,
    [{ nodeId: 'n_rev', agentKey: 'reviewer', cycle: 1, status: 'error' }],
    'only the failing step, and only its workflow vocabulary');
  assert.equal(ev.lastStepStatus, 'error');
  assert.equal(ev.pauseReason, 'error', 'the reason CODE ships');
  assert.equal(ev.pauseReasonLabel, 'a step failed', 'with its FIXED label, never free text');

  const blob = JSON.stringify(p);
  assert.doesNotMatch(blob, /ENOENT/, 'pauseDetail is a raw error message — it never ships (D10)');
  assert.doesNotMatch(blob, /\/Users\//, 'nor the absolute path such a message embeds');
  assert.doesNotMatch(blob, /worktree was left in place/, 'nor a warning string');
});

test('a legacy row with NULL guardrails_id reports "not recorded", it does not throw', async () => {
  const p = await buildRunReport(id, { reason: 'wrong-or-unsafe' });
  assert.equal(p.evidence.guardrails.legacy, true, 'NULL guardrails_id is reported honestly');
  assert.equal(p.evidence.guardrails.id, null);
  assert.equal(p.evidence.guardrails.builtin, null);
  assert.equal(p.evidence.tools.tool, 'graphify', 'the tools descriptor rides the safety report');
  assert.equal('instruction' in p.evidence.tools, false, 'minus its boilerplate instruction');
});

// The legacy branch above returns four fixed keys and touches none of the reduction.
// This is the block that turns a custom set into counts: protectedPaths are user
// globs, envAllowlist is env var names, and the set id is gr_<slug of the user's own
// name for it> (D14). None of the three may appear in a public issue.
test('a CUSTOM guardrail set ships as COUNTS — the globs, env names and set id do not', async () => {
  const set = await writeGuardrailSet({
    name: 'ACME internal policy',
    settings: {
      honorProjectSettings: false, envScrub: true,
      envAllowlist: ['ACME_TOKEN', 'ACME_REGION'],
      protectedPaths: ['/Users/dp/secrets/**'],
      deny: ['Bash(curl:*)', 'WebFetch'],
    },
  });
  assert.equal(set.id, 'gr_acme-internal-policy', 'the id is a slug of the user-chosen name');

  const guarded = await seedPipeline(join(home, 'guarded'), { status: 'done' });
  // guardrails_id is creation-immutable: it is on writeState's INSERT arm but NOT in
  // its ON CONFLICT list (artifacts.mjs:1051-1060), and seedPipeline never forwards it
  // to createPipeline. Stamp it directly, the same trick stampClock uses.
  getDb().prepare('UPDATE pipelines SET guardrails_id = ? WHERE id = ?').run(set.id, guarded.id);

  const p = await buildRunReport(guarded.id, { reason: 'wrong-or-unsafe' });
  const g = p.evidence.guardrails;
  assert.equal(g.legacy, false, 'the row records a set, so this is not the legacy branch');
  assert.equal(g.builtin, false);
  // NOT 'plugin': nothing writes a non-null `origin` today, so every stored set is
  // 'user' and that arm is unreachable (D14) — a test that expected it would be a lie.
  assert.equal(g.origin, 'user', 'a stored set with NULL origin classifies as user');
  assert.equal(g.denyCount, 2);
  assert.equal(g.protectedPathCount, 1);
  assert.equal(g.envAllowlistCount, 2);
  assert.equal(g.envScrub, true, 'the two booleans are policy, not content');
  assert.equal(g.honorProjectSettings, false);
  assert.equal(g.id, null, 'a custom id is a slug of the set NAME, so it waits for `names`');

  const blob = JSON.stringify(p);
  assert.doesNotMatch(blob, /secrets/, 'a protectedPaths entry is a user glob — counted, never quoted');
  assert.doesNotMatch(blob, /ACME_TOKEN/, 'an envAllowlist entry is an env var NAME');
  assert.doesNotMatch(blob, /Bash\(curl/, 'nor do the deny rules themselves ship');
  assert.doesNotMatch(blob, /acme-internal-policy/, 'nor the set id');
  assert.doesNotMatch(blob, /ACME internal policy/, 'nor the name the user gave it');

  const named = await buildRunReport(guarded.id,
    { reason: 'wrong-or-unsafe', include: { names: true } });
  assert.equal(named.evidence.guardrails.id, 'gr_acme-internal-policy');
  assert.equal(named.evidence.guardrails.name, 'ACME internal policy');
  assert.doesNotMatch(JSON.stringify(named), /secrets/,
    '`names` unlocks the set\'s identity — never its contents');
});

test('opting in adds exactly its own class and nothing else', async () => {
  const paths = await buildRunReport(id, { reason: 'poor-quality', include: { paths: true } });
  assert.equal(paths.included.paths, true);
  assert.equal(paths.review.issues[0].location, 'src/acme/billing.mjs:42', 'locations appear only here');
  assert.equal(paths.files.newFiles[0].path, 'src/acme/billing.mjs');
  assert.equal(paths.narrative, 'Rewrote src/acme/billing.mjs end to end.',
    'the cached narrative rides `paths` (D7) — and only `paths`');
  assert.doesNotMatch(JSON.stringify(paths), /unchecked write to billing/,
    'but the rest of the overview stays behind — the narrative is the only field read');
  assert.doesNotMatch(JSON.stringify(paths), /rewrite the billing module/, 'paths does not unlock the prompt');
  assert.doesNotMatch(JSON.stringify(paths), /feat\/acme-billing/, 'paths does not unlock branch names');
  assert.equal('newFiles' in paths.evidence.files, false,
    'the quality evidence keeps its own copy of the counts — the opt-in does not bleed into it');

  const prompt = await buildRunReport(id, { reason: 'poor-quality', include: { prompt: true } });
  assert.equal(prompt.run.prompt, 'rewrite the billing module for ACME Corp');
  assert.doesNotMatch(JSON.stringify(prompt), /src\/acme\/billing\.mjs/, 'prompt does not unlock paths');

  const names = await buildRunReport(id, { reason: 'poor-quality', include: { names: true } });
  assert.equal(names.run.title, 'Secret Project rework');
  assert.equal(names.run.branch.feature, 'feat/acme-billing');
  assert.doesNotMatch(JSON.stringify(names), /secret\/wt/, 'names NEVER unlocks the worktree path');
});

// Every other fixture in this file hands `template` a hand-written safe name, which is
// how this leak survived three review cycles. On an AUTO run that field is written by
// the classifier FROM the task text (auto/classify.mjs:156 -> orchestrator.mjs:361) and
// the id is a slug of the same name (auto/proposal.mjs:127) — the `prompt` class, so it
// waits for `names` exactly as a gr_<slug> guardrail id does (D14).
test('an AUTO-minted workflow name and id wait for `names` — in the payload AND the issue body', async () => {
  const auto = await seedPipeline(join(home, 'auto'), {
    status: 'done', phase: 'done', title: 'ACME billing webhook fix',
    prompt: 'fix the ACME billing webhook that drops Stripe refunds',
    stepper: {
      ...STEPPER_V2,
      template: { id: 'wf_acme-billing-webhook-fix', name: 'ACME billing webhook fix' },
      auto: { status: 'decided', via: 'created', rounds: 1, humanInLoop: false },
    },
  });

  const p = await buildRunReport(auto.id, { reason: 'something-else' });
  const blob = JSON.stringify(p);
  assert.doesNotMatch(blob, /ACME billing webhook fix/,
    'a classifier-written workflow name is a paraphrase of the prompt');
  assert.doesNotMatch(blob, /acme-billing-webhook-fix/, 'and the minted id is a slug of that name');
  assert.deepEqual(p.workflow.template, { builtin: false, id: null },
    'the default ships the CLASS of the template, never its identity');
  assert.equal('name' in p.workflow.template, false, 'name is ADDED by `names`, never nulled');
  assert.deepEqual(p.workflow.auto,
    { status: 'decided', via: 'created', rounds: 1, humanInLoop: false },
    'the auto block itself is workflow vocabulary and still ships');

  // metricRows puts the template in the prefilled issue BODY too — the leak had two mouths.
  const body = renderIssueBody(p);
  assert.doesNotMatch(body, /ACME billing webhook fix/, 'the issue body names no workflow either');
  assert.match(body, /\| workflow \| custom \(manifest v2, 1 nodes\) \|/,
    'the body reports the class and the topology size instead');

  const named = await buildRunReport(auto.id,
    { reason: 'something-else', include: { names: true } });
  assert.equal(named.workflow.template.id, 'wf_acme-billing-webhook-fix');
  assert.equal(named.workflow.template.name, 'ACME billing webhook fix');
  assert.equal(named.workflow.template.builtin, false, 'the discriminator stays put under the opt-in');
  assert.match(renderIssueBody(named), /\| workflow \| ACME billing webhook fix \(manifest v2, 1 nodes\) \|/,
    '`names` unlocks the workflow identity in the body as well');
});

test('a WORKSPACE run reports a project COUNT, and names only behind the opt-in', async () => {
  const p = await buildRunReport(wsId, { reason: 'poor-quality' });
  assert.equal(p.run.target, 'workspace');
  assert.equal(p.files.filesChanged, 4, 'the roll-up summary is read, not the per-project map');
  assert.equal(p.files.projectCount, 2, 'the member count ships; the member KEYS do not (D9)');
  const blob = JSON.stringify(p);
  assert.doesNotMatch(blob, /alpha-11111111/, 'a perProject key is a project key — never by default');
  assert.doesNotMatch(blob, /Acme Platform/, 'nor the workspace name');
  assert.equal('workspace' in p.run, false, 'run.workspace is absent without `names`');

  const named = await buildRunReport(wsId, { reason: 'poor-quality', include: { names: true } });
  assert.equal(named.run.workspace.name, 'Acme Platform');
  assert.deepEqual(named.run.workspace.projectKeys, ['alpha-11111111', 'beta-22222222']);
  assert.equal('perProject' in named.files, false,
    'even under `names`, the per-project breakdown is not shipped at v1');
});

test('an unknown pipeline id returns null, so the route can 404 cleanly', async () => {
  assert.equal(await buildRunReport('deadbeef', { reason: 'too-slow' }), null);
  assert.equal(await buildRunReport('', { reason: 'too-slow' }), null);
  assert.equal(await buildRunReport('../../etc/passwd', { reason: 'too-slow' }), null);
});

test('a run whose dir was deleted still builds; files is null, nothing throws', async () => {
  const gone = await seedPipeline(join(home, 'gone'), { status: 'done' });
  await rm(gone.dir, { recursive: true, force: true });
  const p = await buildRunReport(gone.id, { reason: 'poor-quality', include: { paths: true } });
  assert.ok(p, 'the payload still builds');
  assert.equal(p.files, null, 'no results.json => files is null, not a throw');
  // NOT gate coverage — there is no overview.json on disk here, so this only says a
  // missing file is absorbed. The gate itself is pinned in the DEFAULT-payload test.
  assert.equal('narrative' in p, false, 'no overview.json on disk => no narrative, not a throw');
});

// ── pure helpers ──────────────────────────────────────────────────────────────
test('countIssues tallies the four severities and folds unknowns to minor', () => {
  assert.deepEqual(
    countIssues([{ issues: [{ severity: 'critical' }, { severity: 'WAT' }, { severity: 'major' }] }]),
    { critical: 1, major: 1, minor: 1, suggestion: 0 },
    'an unknown severity is folded to minor by normalizeSeverity, never dropped');
  assert.deepEqual(countIssues(null), { critical: 0, major: 0, minor: 0, suggestion: 0 });
});

test('workflowShape reads a LEGACY v1 stepper without a graph key', () => {
  const v1 = {
    version: 1,
    steps: [{ kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight', sub: 'checks' }] },
            { kind: 'agent', nodes: [{ id: 's1_0', key: 'planner', uiPhase: 'plan', label: 'Planner',
                                       color: 'red', sub: 'writes the plan', cycles: true,
                                       model: 'claude-opus-5', effort: 'high' }] }],
    feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's1_0', maxCycles: 3 }],
  };
  const shape = workflowShape(v1, { s1_0: 4 });
  assert.equal(shape.manifestVersion, 1);
  assert.equal(shape.template, null, 'a v1 manifest has no template block');
  const planner = shape.nodes.find((n) => n.id === 's1_0');
  assert.deepEqual(planner, { id: 's1_0', kind: 'agent', key: 'planner', label: 'Planner',
                              model: 'claude-opus-5', effort: 'high', cyclesUsed: 4 },
    'v1 cells are whitelisted too — no colour, no "sub" description');
  assert.equal(shape.wires[0].loop, true, 'v1 feedbacks become loop wires');
  assert.equal(shape.wires[0].maxCycles, 3);
});

test('workflowShape classifies the template id: stock ships, minted and user-saved wait', () => {
  const shape = (template, auto, include) => workflowShape(
    { version: 2, template, auto, graph: { nodes: [{ id: 'n', kind: 'agent', key: 'planner' }], wires: [] } },
    {}, include).template;

  assert.deepEqual(shape({ id: 'wf_default', name: 'Default' }),
    { builtin: true, id: 'wf_default', name: 'Default' }, 'the shipping builtin');
  assert.deepEqual(shape({ id: 'wf_quick-fix', name: 'Quick Fix' }),
    { builtin: true, id: 'wf_quick-fix', name: 'Quick Fix' }, 'a V17 seed recipe is stock too');
  assert.deepEqual(shape({ id: 'wf_acme-secrets', name: 'ACME secrets' }),
    { builtin: false, id: null }, 'a user-saved id is a slug of the name the user typed');
  // mintAutoWorkflowId avoids the two reserved ids but not a seed id, and on a fresh
  // home no seed row exists at all — so `via: 'created'` is the authority, not the slug.
  assert.deepEqual(shape({ id: 'wf_quick-fix', name: 'Quick Fix' }, { status: 'decided', via: 'created' }),
    { builtin: false, id: null }, 'a template minted THIS run is never stock, whatever it slugs to');
  assert.deepEqual(shape({ id: 'wf_quick-fix', name: 'Quick Fix' }, { status: 'decided', via: 'reused' }),
    { builtin: true, id: 'wf_quick-fix', name: 'Quick Fix' }, 'Auto REUSING a stock recipe still names it');
  assert.deepEqual(shape({ id: 'wf_acme-secrets', name: 'ACME secrets' }, null, { names: true }),
    { builtin: false, id: 'wf_acme-secrets', name: 'ACME secrets' }, '`names` adds both fields back');
});

// Only the stock IDS are fixed vocabulary. The NAMES on the manifest are the workflow
// ROW's name, and writeGraphWorkflow reserves only wf_default and wf_auto — every V17
// seed id is an ordinary renameable row whose upsert does `SET name = excluded.name`
// (workflows.mjs:295-345). So a composer Save over `wf_full` keeps the id and replaces
// the name with whatever the user typed.
test('a RENAMED stock workflow ships its canonical name, never the one the user typed', () => {
  const shape = (template, auto, include) => workflowShape(
    { version: 2, template, auto, graph: { nodes: [{ id: 'n', kind: 'agent', key: 'planner' }], wires: [] } },
    {}, include).template;

  assert.deepEqual(shape({ id: 'wf_full', name: 'PZ_RENAMED_BY_USER' }),
    { builtin: true, id: 'wf_full', name: 'Full' },
    'the name is keyed off the id in the shipped constants, not read from the manifest');
  assert.deepEqual(shape({ id: 'wf_default', name: 'ACME internal pipeline' }),
    { builtin: true, id: 'wf_default', name: 'Default' });
  assert.deepEqual(
    shape({ id: 'wf_quick-fix', name: 'ACME internal pipeline' }, { status: 'decided', via: 'reused' }),
    { builtin: true, id: 'wf_quick-fix', name: 'Quick Fix' },
    'the auto REUSED path reads the same constants');
  // …and under `names` the builtin arm still reports the canonical name: the typed one
  // is the workflow row's, which `names` unlocks for a CUSTOM template only.
  assert.deepEqual(shape({ id: 'wf_full', name: 'PZ_RENAMED_BY_USER' }, null, { names: true }),
    { builtin: true, id: 'wf_full', name: 'Full' });
});

test('a renamed stock workflow does not leak through the payload or the issue body', async () => {
  const renamed = await seedPipeline(join(home, 'renamed'), {
    status: 'done', phase: 'done', cycle: 1,
    stepper: { version: 2, template: { id: 'wf_full', name: 'PZ_RENAMED_BY_USER' },
               graph: { nodes: [{ id: 'n_plan', kind: 'agent', key: 'planner' }], wires: [] },
               steps: [], feedbacks: [] },
  });

  // Every opt-in off: the modal promises metadata only.
  const p = await buildRunReport(renamed.id, { reason: 'something-else' });
  assert.deepEqual(p.workflow.template, { builtin: true, id: 'wf_full', name: 'Full' });
  assert.doesNotMatch(JSON.stringify(p), /PZ_RENAMED_BY_USER/,
    'a name the user typed never rides the default payload');
  const body = renderIssueBody(p);
  assert.doesNotMatch(body, /PZ_RENAMED_BY_USER/, 'nor the prefilled issue body');
  assert.match(body, /\| workflow \| Full \(manifest v2, 1 nodes\) \|/,
    'the body names the recipe worca ships, which is the fact a maintainer needs');
});

test('workflowShape survives a run with no stepper at all', () => {
  assert.equal(workflowShape(null), null);
  assert.equal(workflowShape({}), null);
  assert.equal(workflowShape('not json'), null);
});

test('cyclesByNode takes the max cycle per node and ignores untagged steps', () => {
  assert.deepEqual(
    cyclesByNode([{ nodeId: 'a', cycle: 1 }, { nodeId: 'a', cycle: 3 },
                  { nodeId: 'b', cycle: 2 }, { cycle: 9 }]),
    { a: 3, b: 2 });
});
