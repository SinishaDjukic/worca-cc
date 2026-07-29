// test/agent-registry-workspace.test.mjs
// M4: the two workspace agents in the registry — scope coercion, the
// produces===['workspace'] canary (the §6.9 highest-risk hazard), the DEFAULT_SPEC
// channel wiring, and the mandatory registryToSteps `scope:'workspace-only'`
// exclusion that keeps AGENT_STEPS at EXACTLY 8 (single-project byte-identity).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentRegistry, registryToSteps } from '../src/core/agent-registry.mjs';
import { AGENT_STEPS } from '../src/core/config.mjs';

const tmpDirs = [];
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('the two workspace agents load with scope:"workspace-only"', () => {
  const reg = loadAgentRegistry();
  assert.ok(reg.workspaceScanner, 'workspaceScanner present');
  assert.ok(reg.workspaceReviewer, 'workspaceReviewer present');
  assert.equal(reg.workspaceScanner.scope, 'workspace-only');
  assert.equal(reg.workspaceReviewer.scope, 'workspace-only');
});

test('every original project agent stays scope:"project" (coercion default)', () => {
  const reg = loadAgentRegistry();
  for (const k of ['planner', 'refiner', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer']) {
    assert.equal(reg[k].scope, 'project', `${k} must be project-scope`);
  }
});

test('CANARY: workspaceScanner.produces === ["workspace"] (channel-id list in sync)', () => {
  // §6.9 highest-risk hazard: if "workspace" were missing from CHANNEL_IDS when the
  // sidecar loads, channelList silently drops it and produces collapses to []. This
  // canary is what catches that channel-id/sidecar desync.
  const reg = loadAgentRegistry();
  assert.deepEqual(reg.workspaceScanner.produces, ['workspace']);
  assert.deepEqual(reg.workspaceScanner.consumes, ['userPrompt']);
  assert.deepEqual(reg.workspaceScanner.connectsTo, []);
});

test('workspaceReviewer mirrors reviewer wiring (code->review->implementer loop)', () => {
  const reg = loadAgentRegistry();
  assert.equal(reg.workspaceReviewer.runnerType, 'verifier');
  assert.equal(reg.workspaceReviewer.loopSource, true);
  assert.deepEqual(reg.workspaceReviewer.produces, ['review']);
  assert.deepEqual(reg.workspaceReviewer.consumes, ['plan', 'code']);
  assert.ok(reg.workspaceReviewer.connectsTo.includes('implementer'));
  assert.equal(reg.workspaceReviewer.fanOut, true);
});

test('both workspace agents declare fanOut:true', () => {
  const reg = loadAgentRegistry();
  assert.equal(reg.workspaceScanner.fanOut, true);
  assert.equal(reg.workspaceReviewer.fanOut, true);
});

test('NON-NEGOTIABLE: registryToSteps still returns EXACTLY the 9 project steps', () => {
  // The scope:'workspace-only' exclusion is mandatory — without it the registry's 11
  // entries would push this to 11 and break the single-project UI stepper / config keys.
  const steps = registryToSteps(loadAgentRegistry());
  assert.equal(steps.length, 9, 'workspace-only agents are excluded from the step list');
  assert.deepEqual(steps.map((s) => s.key), [
    'clarify', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer',
  ]);
  assert.ok(!steps.some((s) => s.key === 'workspaceScanner'), 'scanner excluded');
  assert.ok(!steps.some((s) => s.key === 'workspaceReviewer'), 'workspace reviewer excluded');
});

test('AGENT_STEPS (derived from the registry) is byte-identical to registryToSteps and has 9 entries', () => {
  assert.equal(AGENT_STEPS.length, 9);
  assert.deepEqual(AGENT_STEPS, registryToSteps(loadAgentRegistry()));
});

test('scope coercion fails SAFE: a bogus scope value coerces to "project" (visible, not hidden)', async () => {
  // Feed a typo'd scope through the REAL normalizeMeta via loadAgentRegistry with a
  // temp sidecar dir. A non-'workspace-only' value must fall back to 'project' so a
  // typo surfaces a VISIBLE project agent rather than a silently-hidden one (§6.6).
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-scope-'));
  tmpDirs.push(dir);
  await writeFile(join(dir, 'typoAgent.meta.json'), JSON.stringify({
    key: 'typoAgent', displayName: 'Typo', description: 'd', color: 'blue',
    icon: '<path d="M0 0"/>', agentFile: 'worca-cc-typo.md',
    runnerType: 'producer', order: 9, scope: 'workspace-onlyy', // <- typo
  }), 'utf8');
  await writeFile(join(dir, 'wsOnly.meta.json'), JSON.stringify({
    key: 'wsOnly', displayName: 'WS', description: 'd', color: 'blue',
    icon: '<path d="M0 0"/>', agentFile: 'worca-cc-ws.md',
    runnerType: 'producer', order: 10, scope: 'workspace-only', // exact marker
  }), 'utf8');

  const reg = loadAgentRegistry(dir);
  assert.equal(reg.typoAgent.scope, 'project', 'a typo coerces to project (fails safe to visible)');
  assert.equal(reg.wsOnly.scope, 'workspace-only', 'the exact marker is preserved');
  // And the real shipped registry only ever carries the closed set.
  for (const m of Object.values(loadAgentRegistry())) {
    assert.ok(m.scope === 'project' || m.scope === 'workspace-only', `bad scope for ${m.key}: ${m.scope}`);
  }
});
