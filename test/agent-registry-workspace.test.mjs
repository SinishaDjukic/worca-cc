// test/agent-registry-workspace.test.mjs
// M4: the two workspace agents in the registry — scope coercion, the
// produces===['workspace'] canary (the §6.9 highest-risk hazard), the reviewer
// port mirror, and the mandatory agentSteps() `scope:'workspace-only'`
// exclusion that keeps the step list at EXACTLY 9 (single-project byte-identity).
//
// v2 note: the channel fields these tests read are the temporary v1-compat shim,
// DERIVED from the sidecar ports (agent-registry.mjs:v1CompatShim) — the authored
// DEFAULT_SPEC table is unread. So `consumes` is REQUIRED-only (optional inputs
// land in `optionalConsumes`), `connectsTo` is the literal '*' (v2 dropped the
// authored adjacency list) and `loopSource` is gone (subsumed by `verdict` plus
// per-output `when`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { agentSteps } from '../src/core/config.mjs';

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

test('CANARY: workspaceScanner declares its ports and stays off the palette', () => {
  // §6.9: the scanner is driven off-pipeline (runWorkspaceScan), so it must keep its
  // port contract while never becoming placeable. There is no channel list left to
  // desync against — the ports ARE the contract.
  const reg = loadAgentRegistry();
  assert.deepEqual(reg.workspaceScanner.inputs.map((p) => p.id), ['task']);
  assert.deepEqual(reg.workspaceScanner.outputs.map((p) => p.id), ['workspace']);
  assert.equal(reg.workspaceScanner.placeable, false);
});

test('workspaceReviewer mirrors reviewer wiring (code->review->implementer loop)', () => {
  const reg = loadAgentRegistry();
  assert.equal(reg.workspaceReviewer.runnerType, 'verifier');
  // v2 states the loop through the PORTS, so the mirror is asserted there: the
  // two verifiers carry byte-identical inputs and outputs, differing only in the
  // artifact filenames each writes. A blocking `review` back-edge plus a clean
  // `pass` IS the code->review->implementer loop.
  const strip = (ports) => ports.map(({ filename, ...rest }) => rest);
  assert.deepEqual(reg.workspaceReviewer.inputs, reg.reviewer.inputs);
  assert.deepEqual(strip(reg.workspaceReviewer.outputs), strip(reg.reviewer.outputs));
  assert.equal(reg.workspaceReviewer.outputs.find((p) => p.id === 'review').when, 'blocking');
  assert.equal(reg.workspaceReviewer.outputs.find((p) => p.id === 'pass').when, 'clean');
  assert.equal(reg.workspaceReviewer.verdict.filename, 'ws-review-cycle{cycle}.json');
  // `done` is the optional void input the implementer's completion feeds.
  assert.equal(reg.workspaceReviewer.inputs.find((p) => p.id === 'done').required, false);
  assert.equal(reg.workspaceReviewer.fanOut, true);
});

test('both workspace agents declare fanOut:true', () => {
  const reg = loadAgentRegistry();
  assert.equal(reg.workspaceScanner.fanOut, true);
  assert.equal(reg.workspaceReviewer.fanOut, true);
});

test('NON-NEGOTIABLE: agentSteps() still returns EXACTLY the 9 project steps', () => {
  // The scope:'workspace-only' exclusion is mandatory — without it the registry's 11
  // entries would push this to 11 and break the per-step config keyspace.
  const steps = agentSteps();
  assert.equal(steps.length, 9, 'workspace-only agents are excluded from the step list');
  assert.deepEqual(steps.map((s) => s.key), [
    'clarify', 'planner', 'refiner', 'decomposer', 'implementer', 'reviewer', 'manualTestsChecklist', 'manualWebUiTesting', 'planReviewer',
  ]);
  assert.ok(!steps.some((s) => s.key === 'workspaceScanner'), 'scanner excluded');
  assert.ok(!steps.some((s) => s.key === 'workspaceReviewer'), 'workspace reviewer excluded');
});

test('agentSteps() recomputes per call and stays at 9 entries', () => {
  assert.equal(agentSteps().length, 9);
  assert.deepEqual(agentSteps(), agentSteps());
});

test('scope coercion fails SAFE: a bogus scope value coerces to "project" (visible, not hidden)', async () => {
  // Feed a typo'd scope through the REAL normalizeMeta via loadAgentRegistry with a
  // temp sidecar dir. A non-'workspace-only' value must fall back to 'project' so a
  // typo surfaces a VISIBLE project agent rather than a silently-hidden one (§6.6).
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-scope-'));
  tmpDirs.push(dir);
  const ports = {
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  };
  await writeFile(join(dir, 'typoAgent.meta.json'), JSON.stringify({
    metaVersion: 2, key: 'typoAgent', displayName: 'Typo', description: 'd', color: 'blue',
    icon: '<path d="M0 0"/>', agentFile: 'worca-cc-typo.md', ...ports,
    runnerType: 'producer', order: 9, scope: 'workspace-onlyy', // <- typo
  }), 'utf8');
  await writeFile(join(dir, 'worca-cc-typo.md'), '# typo agent\n', 'utf8');
  await writeFile(join(dir, 'wsOnly.meta.json'), JSON.stringify({
    metaVersion: 2, key: 'wsOnly', displayName: 'WS', description: 'd', color: 'blue',
    icon: '<path d="M0 0"/>', agentFile: 'worca-cc-ws.md', ...ports,
    runnerType: 'producer', order: 10, scope: 'workspace-only', // exact marker
  }), 'utf8');
  await writeFile(join(dir, 'worca-cc-ws.md'), '# ws agent\n', 'utf8');

  const reg = loadAgentRegistry(dir);
  assert.equal(reg.typoAgent.scope, 'project', 'a typo coerces to project (fails safe to visible)');
  assert.equal(reg.wsOnly.scope, 'workspace-only', 'the exact marker is preserved');
  // And the real shipped registry only ever carries the closed set.
  for (const m of Object.values(loadAgentRegistry())) {
    assert.ok(m.scope === 'project' || m.scope === 'workspace-only', `bad scope for ${m.key}: ${m.scope}`);
  }
});
