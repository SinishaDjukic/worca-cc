// test/helpers/session-parity.mjs — X1's run (session groups): one mock run of a workflow, and what a session must never
// change about it. Moved out of test/graph-session-parity.test.mjs (Task 49) by Task 65, which runs `shared` mode through it.
// The caller's file sets WORCA_FLAGS and its temp home, and saves `workflowId`.
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { gitDir } from './git-dir.mjs';
import { createOrchestrator } from '../../src/core/orchestrator.mjs';
import { BRIEF_DIVIDER, SHARED_SESSION_PREAMBLE, SHARED_ROLE_HEADING } from '../../src/core/engines/session-dispatch.mjs';
import { runClaude } from '../../src/core/claude-runner.mjs';
import { _testing as execT } from '../../src/core/graph/executor.mjs';
import { _testing as hostT } from '../../src/core/session-host.mjs';
import { projectKey } from '../../src/core/store.mjs';

/** → { starts, tokens, raw, hostedOk, sharedOk, briefs, rows, deliveries, artifacts }. `raw`/`briefs` hold every brief of the
 *  run as `systemPrompt + BRIEF_DIVIDER + prompt` of the step's own runOpts: a plain spawn's, a hosted member's (its
 *  definition prompt, checked in `hostedOk`) and a `shared` member's (its turn checked in `sharedOk`: the preamble, then
 *  the role heading, the system prompt and the prompt, byte for byte). */
export async function runOnce(workflowId) {
  const facts = { starts: [], tokens: [], raw: [], hostedOk: [], sharedOk: [] };
  const projectDir = gitDir(workflowId);
  const orch = createOrchestrator({ projectDir, workflowId, prompt: 'demo', auto: true, claude: { mock: true } });
  orch.on('exec', (e) => { if (e.status === 'start') facts.starts.push([e.nodeId, e.executionId]); });
  orch.on('token', (e) => facts.tokens.push([e.from.node, e.from.port]));          // scheduler.mjs:268-279
  execT.runClaude = async (opts) => { facts.raw.push(opts.systemPrompt + BRIEF_DIVIDER + opts.prompt); return runClaude(opts); };
  hostT.onDefinitions = (defs, memberOpts, member) => {
    const [type, def] = Object.entries(defs).find(([k]) => k.startsWith('worca-x-'));
    facts.hostedOk.push([member.executionId, def.prompt === memberOpts.systemPrompt + BRIEF_DIVIDER + memberOpts.prompt, type]);
    facts.raw.push(def.prompt);
  };
  hostT.onSharedTurn = (turnOpts, memberOpts, member) => {
    facts.sharedOk.push([member.executionId, turnOpts.systemPrompt === SHARED_SESSION_PREAMBLE
      && turnOpts.prompt === `${SHARED_ROLE_HEADING}${memberOpts.systemPrompt}\n\n${memberOpts.prompt}`]);
    facts.raw.push(memberOpts.systemPrompt + BRIEF_DIVIDER + memberOpts.prompt);
  };
  try { assert.equal((await orch.run()).status, 'done'); } finally { execT.runClaude = null; hostT.onDefinitions = null; hostT.onSharedTurn = null; }
  const st = orch.getState();
  // Run-specific tokens beyond the master's five (Step 3): the project's store key and folder name (the memory block, the
  // store paths) and the run's checkpoint commit (the reviewer's `git diff <ref>` line).
  const norm = (s) => [[st.pipelineDir, '<P>'], [st.branch?.worktreeDir, '<W>'], [projectDir, '<D>'], [projectKey(projectDir), '<K>'],
    [basename(projectDir), '<B>'], [orch.checkpointRef, '<C>'], [st.id, '<R>'], [workflowId, '<WF>']]
    .reduce((acc, [from, to]) => (from ? acc.split(from).join(to) : acc), String(s));
  const { listArtifacts } = await import('../../src/core/artifacts.mjs');          // what History serves (artifacts.mjs:283)
  return { ...facts, briefs: facts.raw.map(norm).sort(), rows: st.steps.filter((s) => s.executionId && !s.executionId.startsWith('x:preflight') && !s.executionId.startsWith('x:done')).length,
    deliveries: st.wireDeliveries, artifacts: (await listArtifacts(st.id)).map((a) => norm(a.relPath || a.path)).sort() };
}
