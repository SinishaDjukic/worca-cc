// test/graph-session-parity.test.mjs — X1: a session changes WHERE a step runs, never WHAT runs or where its files go.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { BRIEF_DIVIDER } from '../src/core/engines/session-dispatch.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { _testing as execT } from '../src/core/graph/executor.mjs';
import { _testing as hostT } from '../src/core/session-host.mjs';
import { projectKey } from '../src/core/store.mjs';

useTempHome(after);
const SID = 's_aaaaaaaa';
async function save(id, seedId, members) {
  const t = structuredClone(SEED_TEMPLATES.find((s) => s.id === seedId));
  for (const m of members) t.nodes.find((n) => n.id === m).config.session = SID;
  await writeGraphWorkflow({ ...t, id, name: id });
}
async function runOnce(workflowId) {
  const facts = { starts: [], tokens: [], raw: [], hostedOk: [] };
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
  try { assert.equal((await orch.run()).status, 'done'); } finally { execT.runClaude = null; hostT.onDefinitions = null; }
  const st = orch.getState();
  // Run-specific tokens beyond the master's five (Step 3): the project's store key and folder name (the memory block, the
  // store paths) and the run's checkpoint commit (the reviewer's `git diff <ref>` line).
  const norm = (s) => [[st.pipelineDir, '<P>'], [st.branch?.worktreeDir, '<W>'], [projectDir, '<D>'], [projectKey(projectDir), '<K>'],
    [basename(projectDir), '<B>'], [orch.checkpointRef, '<C>'], [st.id, '<R>'], [workflowId, '<WF>']]
    .reduce((acc, [from, to]) => (from ? acc.split(from).join(to) : acc), String(s));
  const { listArtifacts } = await import('../src/core/artifacts.mjs');          // what History serves (artifacts.mjs:283)
  return { ...facts, briefs: facts.raw.map(norm).sort(), rows: st.steps.filter((s) => s.executionId && !s.executionId.startsWith('x:preflight') && !s.executionId.startsWith('x:done')).length,
    deliveries: st.wireDeliveries, artifacts: (await listArtifacts(st.id)).map((a) => norm(a.relPath || a.path)).sort() };
}

before(async () => {
  process.env.WORCA_FLAGS = 'sessionGroups';
  await save('wf_par_plain', 'wf_quick-fix', []);
  await save('wf_par_grouped', 'wf_quick-fix', ['n_plan', 'n_impl', 'n_review']);
  await save('wf_par_nc_plain', 'wf_no-clarify', []);
  await save('wf_par_nc_grouped', 'wf_no-clarify', ['n_decompose', 'n_impl', 'n_review']);   // ×N slices run outside (D2)
});
after(() => { delete process.env.WORCA_FLAGS; });

// v3 (added, nothing weakened): every member execution went through the host — a later member that ran ungrouped would
// still produce the same briefs; the ×N composite and its slices run outside (D2).
const HOSTED = {
  wf_par_grouped: ['x:n_impl:1', 'x:n_impl:2', 'x:n_plan:1', 'x:n_review:1', 'x:n_review:2'],
  wf_par_nc_grouped: ['x:n_decompose:1', 'x:n_impl:2', 'x:n_review:1', 'x:n_review:2'],
};
for (const [plain, grouped] of [['wf_par_plain', 'wf_par_grouped'], ['wf_par_nc_plain', 'wf_par_nc_grouped']]) {
  test(`parity: ${grouped} vs ${plain}`, { timeout: 180000 }, async () => {
    const a = await runOnce(plain);
    const b = await runOnce(grouped);
    assert.deepEqual(b.starts, a.starts, 'launch order');
    assert.deepEqual(b.tokens, a.tokens, 'fired outputs');
    assert.deepEqual(b.artifacts, a.artifacts, 'artifact paths');
    assert.deepEqual(b.deliveries, a.deliveries, 'verdict routing and loop counts');
    assert.equal(b.rows, a.rows, 'ledger row count');
    assert.ok(b.hostedOk.length > 0, 'members went through the host');
    assert.deepEqual([...new Set(b.hostedOk.map(([x]) => x))].sort(), HOSTED[grouped], 'v3: every member execution, none ungrouped');
    for (const [executionId, same] of b.hostedOk) assert.ok(same, `${executionId}: the definition prompt is the member's own system prompt + brief, byte for byte`);
    assert.deepEqual(b.briefs, a.briefs, 'every brief of the run, normalized, equals the ungrouped run\'s');
  });
}
