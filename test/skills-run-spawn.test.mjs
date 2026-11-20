// test/skills-run-spawn.test.mjs — skills registry design §4.3, spawn side: the audit clause, runOpts'
// one --plugin-dir per set plugin, and the executor's sideload safety net (a refused spawn is
// dispatched once more without the set skills). No claude spawn: the executor's runClaude seam.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import { runAgentExecution, _testing } from '../src/core/graph/executor.mjs';
import { renderContextAudit, renderSkillAudit } from '../src/core/run-context.mjs';

useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-skills-spawn-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
afterEach(() => { _testing.runClaude = null; });

const RO = { role: 'planner', prompt: 'p', systemPrompt: '', allowedTools: ['Read'] };
const DIRS = [join(scratch, 'skills', 'billing'), join(scratch, 'skills', 'general')];
// The CLI's refusal under managed `disableSideloadFlags` (P3 Task 0: the text read from the CLI binary), as the runner words a non-zero exit.
const REFUSAL = "claude exited with code 1: --plugin-dir is disabled by your organization's managed settings (disableSideloadFlags)";

test('renderSkillAudit / renderContextAudit: no layer ⇒ the line is unchanged; a layer appends its clause', () => {
  const rc = { memberCount: 1, bytes: { bySource: {}, total: 0 }, injectedSkillNames: [], renames: {}, mcpServerNames: [], warnings: [] };
  const plain = 'Context: 1 member, 0 memory sources inlined (0 bytes), 0 skills mounted, 0 MCP servers merged, 0 warnings.';
  assert.equal(renderContextAudit(rc), plain);
  assert.equal(renderContextAudit(rc, null), plain);
  assert.equal(renderSkillAudit(null), '');
  const layer = { mounted: [{}, {}, {}], plugins: [{}, {}], skipped: [{}], blocked: null };
  assert.equal(renderSkillAudit(layer), '3 set skills in 2 plugins (1 skipped)');
  assert.equal(renderContextAudit(rc, layer), plain.replace(/\.$/, ', 3 set skills in 2 plugins (1 skipped).'));
  assert.equal(renderSkillAudit({ mounted: [{}], plugins: [{}], skipped: [], blocked: null }), '1 set skill in 1 plugin (0 skipped)');
  assert.equal(renderSkillAudit({ mounted: [{}, {}], plugins: [{}], skipped: [{}], blocked: 'sideload-disabled' }), '2 set skills not loaded (sideload-disabled; 1 skipped)');
});

test('runOpts: no set skills ⇒ pluginDirs stays absent (byte-identical spawn); a layer ⇒ one entry per set plugin', () => {
  assert.equal(runOpts({ projectDir: scratch, claudeOpts: {} }, RO).pluginDirs, undefined);
  assert.equal(runOpts({ projectDir: scratch, claudeOpts: {}, skillPluginDirs: [] }, RO).pluginDirs, undefined, 'a blocked layer carries []');
  assert.deepEqual(runOpts({ projectDir: scratch, claudeOpts: {}, skillPluginDirs: DIRS }, RO).pluginDirs, DIRS);
});

/** One agent execution through the real executor; `claudeOpts.mock` keeps any fallthrough offline. */
const agentCtx = (over = {}) => ({
  node: { id: 'n_a', kind: 'agent', key: 'custom', config: {}, agentPrompt: 'You are custom.', tools: [] },
  nodeId: 'n_a', executionId: 'x:n_a:1', ordinal: 1, cycle: 1,
  ports: { inputs: [], outputs: [] }, meta: { displayName: 'Custom', runnerType: 'producer', inputs: [], outputs: [] },
  bindings: {}, outputs: {}, verdict: null, expandsPort: null, priorAnswers: [], trigger: { wireIds: [], freshPorts: [] },
  runCtx: { pipelineDir: scratch, projectDir: scratch, baseName: 'f', datePrefix: '01-01-26', planVersion: () => 1 },
  projectDir: scratch, pipelineDir: scratch, taskPrompt: 'T', toolInstruction: '', extras: [], agentPrompts: {}, workspace: null,
  claudeOpts: { mock: true }, ...over,
});
/** A fake runClaude: `script(opts, n)` answers call n (1-based); every call's options are kept. */
const seam = (script) => {
  const calls = [];
  _testing.runClaude = async (opts) => { calls.push(opts); return script(opts, calls.length); };
  return calls;
};
const refused = () => { throw new Error(REFUSAL); };

test('safety net: a spawn with set plugins refused before init drops them once and is dispatched again, everything else kept', async () => {
  const calls = seam((o, n) => (n === 1 ? refused() : { text: 'done', exitCode: 0 }));
  let refusedCalls = 0;
  const r = await runAgentExecution(agentCtx({
    skillPluginDirs: DIRS, onSkillSideloadRefused: () => { refusedCalls += 1; },
    resumeSessionId: 'sess-1', node: { id: 'n_a', kind: 'agent', key: 'custom', config: {}, agentPrompt: 'x', tools: [], fanOut: true, subagentEffort: 'high' },
  }));
  assert.equal(r.summary, 'done');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].pluginDirs, DIRS);
  assert.equal(calls[1].pluginDirs, undefined, 'only --plugin-dir is dropped');
  assert.deepEqual(calls[1].agents, calls[0].agents, '--agents rides the re-dispatch unchanged');
  assert.ok(calls[0].agents, 'the fixture is a pinned fan-out node (it carries --agents)');
  assert.equal(calls[1].resumeSessionId, 'sess-1', 'the session was never reached: the retry resumes the same one');
  assert.equal(calls[1].prompt, calls[0].prompt);
  assert.equal(refusedCalls, 1, 'the harness drops the layer for the rest of the run');
});

test('safety net: no retry after init, without set plugins, on another error, and never twice', async () => {
  const late = seam((o) => { o.onEvent({ type: 'session', sessionId: 's' }); refused(); });
  await assert.rejects(runAgentExecution(agentCtx({ skillPluginDirs: DIRS, onSkillSideloadRefused: () => assert.fail('after init') })), /plugin-dir is disabled/);
  assert.equal(late.length, 1, 'the session started: a later failure is the agent\'s own');

  const lateInit = seam((o) => { o.onEvent({ type: 'system', raw: { type: 'system', subtype: 'init' } }); refused(); });
  await assert.rejects(runAgentExecution(agentCtx({ skillPluginDirs: DIRS })), /plugin-dir is disabled/);
  assert.equal(lateInit.length, 1, 'a system/init frame counts as init');

  const agentsOnly = seam(() => { throw new Error("claude exited with code 1: --agents is disabled by your organization's managed settings (disableSideloadFlags)"); });
  await assert.rejects(runAgentExecution(agentCtx({ onSkillSideloadRefused: () => assert.fail('no set plugins') })), /--agents is disabled/);
  assert.equal(agentsOnly.length, 1, 'a spawn without set plugins is never re-dispatched (an --agents refusal is not ours)');

  const other = seam(() => { throw new Error('claude exited with code 1: Not logged in · Please run /login'); });
  await assert.rejects(runAgentExecution(agentCtx({ skillPluginDirs: DIRS, onSkillSideloadRefused: () => assert.fail('other error') })), /Not logged in/);
  assert.equal(other.length, 1);

  const twice = seam(() => refused());
  await assert.rejects(runAgentExecution(agentCtx({ skillPluginDirs: DIRS })), /plugin-dir is disabled/);
  assert.equal(twice.length, 2, 'one re-dispatch, then the error is the run\'s');
});

test('safety net: the re-dispatch keeps the abort signal and reports ITS session id', async () => {
  const calls = seam((o, n) => { if (n === 1) refused(); o.onEvent({ type: 'session', sessionId: 'sess-retry' }); return { text: 'done', exitCode: 0 }; });
  const ac = new AbortController();
  const r = await runAgentExecution(agentCtx({ skillPluginDirs: DIRS, signal: ac.signal }));
  assert.equal(r.sessionId, 'sess-retry', 'a pause after the net resumes the session that ran');
  // The child's signal folds the run's in with the node time limit (E4): a pause still reaches it.
  ac.abort();
  assert.equal(calls[1].signal.aborted, true, 'a pause still reaches the re-dispatched child');
});

test('safety net: a refusal the CLI printed on stdout before init counts too (the runner\'s error then names no reason)', async () => {
  const calls = seam((o, n) => {
    if (n > 1) return { text: 'done', exitCode: 0 };
    o.onEvent({ type: 'log', text: "--plugin-dir is disabled by your organization's managed settings (disableSideloadFlags).", raw: '' });
    throw new Error('claude exited with code 1: no stderr');
  });
  let refusedCalls = 0;
  const r = await runAgentExecution(agentCtx({ skillPluginDirs: DIRS, onSkillSideloadRefused: () => { refusedCalls += 1; } }));
  assert.equal(r.summary, 'done');
  assert.deepEqual([calls.length, calls[1].pluginDirs, refusedCalls], [2, undefined, 1]);
  const plain = seam((o) => { o.onEvent({ type: 'log', text: 'something else went wrong', raw: '' }); throw new Error('claude exited with code 1: no stderr'); });
  await assert.rejects(runAgentExecution(agentCtx({ skillPluginDirs: DIRS })), /no stderr/);
  assert.equal(plain.length, 1, 'any other line is not a refusal');
});
