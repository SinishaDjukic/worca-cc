#!/usr/bin/env node
// scripts/smoke-workspace.mjs
// Offline mock SMOKE for a WORKSPACE pipeline run (M4). Proves the review-fanout loop
// end to end with $0 spend:
//   scanner (mock) writes a description -> a 2-project workspace run injects it into
//   every system prompt -> the reviewer node resolves to `workspaceReviewer` -> its
//   mock blocking count decays with cycle so the review -> implementer loop TERMINATES.
//
// SCOPE SEAM (§6.8): M4 exercises the mock PIPELINE RUN (fully achievable now). The
// real SCAN ENGINE (workspace-scan.mjs, the `scan-*` WS family) lands in M5; here we
// mock the scanner role directly to populate the workspace description, then run the
// pipeline. The M5 smoke will replace the mocked scan with the real engine.
//
// ISOLATION (mirrors `npm run smoke`): runs under WORCA_HOME=.worca-cc-smoke and uses
// THROWAWAY git repos created in an OS temp dir (never examples/sandbox, never this
// repo) — the orchestrator makes real worktrees + branches INSIDE each member repo, so
// pointing at a real repo would pollute it. Temp repos + the smoke home are removed in
// a finally block, so a clean run leaves no worktree/branch/dir behind.

import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { projectKey } from '../src/core/store.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { DIFF_PATCH_FILE } from '../src/core/results.mjs';

function die(msg) {
  console.error(`smoke:workspace FAILED — ${msg}`);
  process.exitCode = 1;
}

/** A fresh throwaway git repo with one commit, on branch `main`. */
async function freshRepo(label) {
  const dir = await mkdtemp(join(tmpdir(), `worca-cc-smoke-ws-${label}-`));
  const g = (args) => spawnSync('git', args, { cwd: dir });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'smoke@worca-cc']);
  g(['config', 'user.name', 'smoke']);
  await writeFile(join(dir, 'README.md'), `# ${label}\n\nThrowaway smoke member project.\n`);
  g(['add', '-A']);
  g(['commit', '-qm', 'init']);
  return dir;
}

async function main() {
  // Force mock so nothing spawns claude / spends tokens, even if the env didn't set it.
  process.env.WORCA_MOCK = process.env.WORCA_MOCK || '1';
  // §6 intro: the default run-root mode stays `legacy` until the Phase-5 flip, so this
  // script PINS `detached` in-process — otherwise none of the §9.2 layout assertions
  // below could pass. After the flip the pin becomes a no-op that documents intent.
  process.env.WORCA_RUN_ROOT = 'detached';

  const repos = [];
  try {
    const a = await freshRepo('a');
    const b = await freshRepo('b');
    repos.push(a, b);

    // Member set sorted by projectKey ascending (the canonical ordering everywhere).
    const members = [a, b]
      .map((dir) => ({ projectDir: dir, projectKey: projectKey(dir), projectName: dir.split('/').pop() }))
      .sort((x, y) => (x.projectKey < y.projectKey ? -1 : x.projectKey > y.projectKey ? 1 : 0));

    // 1) SCAN (mocked role — the real engine is M5). Produce the interconnection
    // description the run will inject into every agent.
    let description = '';
    {
      const scanOut = join(repos[0], 'ws-description.md');
      const prompt = [
        '## Member projects to investigate',
        ...members.map((m) => `- **${m.projectName}** (\`${m.projectKey}\`): investigate ${m.projectDir}`),
        'MOCK_ROLE: workspace-scan',
        `MOCK_OUT: ${scanOut}`,
        'MOCK_BASE: Smoke Workspace',
      ].join('\n');
      const investigating = [];
      await runClaude({
        cwd: repos[0], prompt, mock: true,
        onEvent: (e) => { if (/^INVESTIGATING /.test(e.text || '')) investigating.push(e.text); },
      });
      description = await (await import('node:fs/promises')).readFile(scanOut, 'utf8');
      if (!/# Workspace: Smoke Workspace/.test(description)) return die('scan did not write a template description');
      if (investigating.length !== members.length) return die(`expected ${members.length} INVESTIGATING lines, got ${investigating.length}`);
      console.log(`  scan: wrote ${description.length}-char description, ${investigating.length} investigations`);
    }

    // 2) RUN the mock workspace pipeline with the frozen description injected.
    const workspace = {
      id: 'wks-smoke-00000000', key: 'wks-smoke-00000000',
      name: 'Smoke Workspace', description,
      projects: members.map((m) => ({ ...m, branch: { source: 'main' } })),
    };
    const orch = createOrchestrator({
      workspace, prompt: 'add a small feature', auto: true, claude: { mock: true }, branch: { source: 'main' },
    });

    // Capture the resolved plan to prove the review node became `workspaceReviewer`.
    const origDispatch = orch._dispatch.bind(orch);
    let seenPlan = null;
    orch._dispatch = async (plan, runArgs) => { seenPlan = plan; return origDispatch(plan, runArgs); };

    // §9.2 per-node cwd: `ctx.projectDir` is what phases.mjs passes to runClaude as
    // `cwd`, so recording every node ctx records every spawn's cwd.
    const nodeCwds = [];
    const origNodeCtx = orch._nodeCtx.bind(orch);
    orch._nodeCtx = (node, pos) => {
      const ctx = origNodeCtx(node, pos);
      nodeCwds.push({ key: node.key, cwd: ctx.projectDir });
      return ctx;
    };

    // §9.2 layout snapshot: the run root and every member checkout exist until
    // teardown removes them, so sample the tree at the top of _teardownRunRoot (which
    // runs BEFORE any removal — its per-member step 1 is a read-only rescue).
    let snap = null;
    const origTeardown = orch._teardownRunRoot.bind(orch);
    orch._teardownRunRoot = async () => {
      const runRoot = orch.runRoot;
      snap = {
        runRoot,
        claudeMd: !!runRoot && existsSync(join(runRoot, 'CLAUDE.md')),
        strayAtRoot: !!runRoot && existsSync(join(runRoot, 'src')),
        members: members.map((m) => ({
          key: m.projectKey,
          repo: !!runRoot && existsSync(join(runRoot, 'repos', m.projectKey)),
          edited: !!runRoot && existsSync(join(runRoot, 'repos', m.projectKey, 'src', 'feature.mjs'))
            && existsSync(join(runRoot, 'repos', m.projectKey, 'test', 'feature.test.mjs')),
        })),
      };
      return origTeardown();
    };

    const res = await orch.run();
    if (res.status !== 'done') return die(`workspace run did not complete: status=${res.status} (${JSON.stringify(res).slice(0, 300)})`);

    const keys = (seenPlan?.steps || []).flat().map((n) => n.key);
    if (!keys.includes('workspaceReviewer')) return die(`review node was not substituted to workspaceReviewer (keys: ${keys.join(',')})`);
    if (keys.includes('reviewer')) return die('single-project reviewer node leaked into a workspace run');

    // ── §9.2 new assertions (Phase 4) ───────────────────────────────────────
    const runRoot = snap?.runRoot;
    if (!runRoot) return die('teardown never ran, so the run-root layout was never sampled');
    if (!/\/runs\/[^/]+$/.test(runRoot)) return die(`run root is not <worcaHome>/runs/<pipelineId>: ${runRoot}`);
    // (a) cwd for EVERY node is the run root — no member is anyone's cwd.
    if (nodeCwds.length < 3) return die(`expected several dispatched nodes, saw ${nodeCwds.length}`);
    for (const n of nodeCwds) {
      if (n.cwd !== runRoot) return die(`node ${n.key} cwd is not the run root: ${n.cwd}`);
    }
    for (const m of members) {
      if (nodeCwds.some((n) => n.cwd === m.projectDir)) return die(`a node ran inside member ${m.projectKey}`);
    }
    // (b) each member's repos/<key> carries THAT member's mock edits.
    for (const m of snap.members) {
      if (!m.repo) return die(`member checkout missing at repos/${m.key}`);
      if (!m.edited) return die(`mock edits did not land in repos/${m.key} (workspaceWriteTargets not honored)`);
    }
    if (snap.strayAtRoot) return die('the mock wrote src/ at the run root instead of the member checkouts');
    // (c) the generated CLAUDE.md existed during the run.
    if (!snap.claudeMd) return die('generated <runRoot>/CLAUDE.md was absent during the run');
    // (d) the concatenated patch carries `# <projectKey>` headers, one per member.
    const patch = await readFile(join(orch.getState().pipelineDir, DIFF_PATCH_FILE), 'utf8').catch(() => '');
    for (const m of members) {
      if (!patch.includes(`# ${m.projectKey}`)) return die(`diff.patch lacks the '# ${m.projectKey}' header`);
    }
    if (!/feature\.mjs/.test(patch)) return die('diff.patch carries no member edits');
    // (e) the run root is GONE after `done` (guarded rm -rf, §8.13).
    if (existsSync(runRoot)) return die(`run root survived a completed run: ${runRoot}`);
    console.log(`  layout: cwd=run root for ${nodeCwds.length} nodes, edits in ${snap.members.length} repos/<key>, ` +
      'CLAUDE.md generated, per-project patch headers, run root reaped');

    // ── §7.7 / Phase 5(a): R4 pills survived the run-root relocation ─────────
    // The regression guard for §7.7: pills only appear if `_nodeCtx` kept stamping
    // the event-attribution literal AND step nodeIds stayed inside the stepper
    // manifest's `agents` cells. Under the DETACHED layout (pinned above) every
    // node runs from the run root, so a broken attribution would silently drop
    // every pill — visible here and nowhere else in the offline gates.
    const stAll = orch.getState();
    const stepPills = (stAll.steps || []).flatMap((s) => (Array.isArray(s.skills) ? s.skills : []));
    const subPills = (stAll.subAgents || []).flatMap((s) => (Array.isArray(s.skills) ? s.skills : []));
    if (!stepPills.includes('skill:graphify')) return die(`no main-agent skill pill on any step (got ${JSON.stringify(stepPills)})`);
    // The three-part MCP label is the §7.1 delta: server AND tool, on both streams.
    if (!stepPills.includes('mcp:playwright:browser_snapshot')) return die(`no three-part MCP pill on a step (got ${JSON.stringify(stepPills)})`);
    if (!subPills.includes('mcp:playwright:browser_navigate') || !subPills.includes('mcp:playwright:browser_click')) {
      return die(`sub-agent per-tool pills missing — one server must yield one pill per tool (got ${JSON.stringify(subPills)})`);
    }
    if (!subPills.includes('skill:brainstorming')) return die(`no sub-agent skill pill (got ${JSON.stringify(subPills)})`);
    // Every step that captured pills must be attributable to a stepper cell of kind
    // 'agents' (§7.7) — the client's `agentNodeIdSet` (app.js) filters the Agents
    // dropdown by exactly this set, so a nodeId outside it renders NO pills at all.
    const agentIds = new Set((stAll.stepper?.steps || [])
      .filter((cell) => cell && cell.kind === 'agents')
      .flatMap((cell) => (cell.nodes || []).map((n) => n && n.id)));
    if (agentIds.size === 0) return die('the run stepper exposes no agents cells — §7.7 attribution is unverifiable');
    let pillBearing = 0;
    for (const s of stAll.steps || []) {
      if (!Array.isArray(s.skills) || !s.skills.length || s.nodeId == null) continue;
      pillBearing += 1;
      if (!agentIds.has(s.nodeId)) {
        return die(`step '${s.key}' captured pills under nodeId '${s.nodeId}', absent from the stepper 'agents' cells`);
      }
    }
    if (pillBearing < 3) return die(`expected most agents to capture pills, only ${pillBearing} steps did`);
    console.log(`  pills:  ${new Set(stepPills).size} distinct on steps (${pillBearing} pill-bearing), ` +
      `${new Set(subPills).size} on sub-agents, three-part MCP labels present, ` +
      'every pill-bearing nodeId is a stepper agent');

    // The review->implementer loop must have TERMINATED (the mock decays blocking with cycle).
    const state = orch.getState();
    if (state.status !== 'done') return die(`final state not done: ${state.status}`);
    if (state.target !== 'workspace') return die(`state.target should be 'workspace', got ${state.target}`);

    console.log(`  run:  status=${res.status}, review node=workspaceReviewer, loop terminated (cycles capped)`);
    console.log('smoke:workspace OK — scanner wrote a description, the workspace run injected it, the workspaceReviewer loop terminated.');
  } finally {
    await Promise.all(repos.map((d) => rm(d, { recursive: true, force: true }).catch(() => {})));
    // The smoke home (.worca-cc-smoke) is left for inspection like `npm run smoke`; the
    // workspace store lives under it. Throwaway member repos (with their worktrees +
    // worca-cc/* branches) are reaped above, so nothing leaks into a real repo.
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
