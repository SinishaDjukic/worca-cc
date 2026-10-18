// test/agent-needs-repo.test.mjs — P3 Task 8: which agents (and so which workflows) expect a code repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { normalizeAgentMeta } from '../src/shared/graph/agent-meta.mjs';
import { createAgent, updateAgent, userAgentsDir } from '../src/core/agent-store.mjs';
import { graphNeedsRepo, workflowNeedsRepo } from '../src/core/workflows.mjs';

useTempHome(after, 'worca-needs-repo-');

let srv, base;
before(async () => {
  process.env.WORCA_MOCK = '1';
  const { app } = await import('../ui/server.mjs');   // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
});

test('the five shipped agents that expect a repository carry needsRepo; nobody else does', () => {
  const registry = loadAgentRegistry();
  assert.deepEqual(Object.values(registry).filter((m) => m.needsRepo).map((m) => m.key).sort(),
    ['architect', 'manualTestsChecklist', 'promoCapture', 'promoExplorer', 'reviewer']);
  assert.equal(registry.reviewer.needsRepo, true);
  assert.equal('needsRepo' in registry.planner, false, 'absent when not set, never false');
});

test('normalizeAgentMeta keeps needsRepo only when it is exactly true', () => {
  const raw = { metaVersion: 2, key: 'x', runnerType: 'producer', inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }] };
  assert.equal(normalizeAgentMeta({ ...raw, needsRepo: true }).meta.needsRepo, true);
  for (const v of [false, 'yes', 1, undefined]) assert.equal('needsRepo' in normalizeAgentMeta({ ...raw, needsRepo: v }).meta, false, String(v));
});

test('graphNeedsRepo: any agent node whose registry entry needs a repository', () => {
  const registry = { a: { key: 'a', needsRepo: true }, b: { key: 'b' } };
  const g = (...keys) => ({ nodes: [{ id: 'n_task', kind: 'task' }, ...keys.map((key, i) => ({ id: `n${i}`, kind: 'agent', key }))] });
  assert.equal(graphNeedsRepo(g('b', 'a'), registry), true);
  assert.equal(graphNeedsRepo(g('b'), registry), false);
  assert.equal(graphNeedsRepo(g('gone'), registry), false, 'an unknown agent is not a repository hint');
  assert.equal(graphNeedsRepo({ nodes: [{ id: 's', kind: 'script', key: 'a' }] }, registry), false, 'only agent nodes count');
  assert.equal(graphNeedsRepo({ id: 'wf_auto', auto: true }, registry), false, 'no nodes, no hint');
  assert.equal(graphNeedsRepo(null, registry), false);
});

test('workflowNeedsRepo: the shipped workflows', async () => {
  assert.equal(await workflowNeedsRepo('wf_default'), true);
  assert.equal(await workflowNeedsRepo('wf_presentation'), false);
  assert.equal(await workflowNeedsRepo('wf_promo_video'), true);
  assert.equal(await workflowNeedsRepo('wf_architecture_c4'), true);
  assert.equal(await workflowNeedsRepo('wf_memory_defrag'), false);
  assert.equal(await workflowNeedsRepo('wf_auto'), false);
  assert.equal(await workflowNeedsRepo('wf_nope'), false);
  assert.equal(await workflowNeedsRepo('wf_default', { registry: {} }), false, 'the injected registry decides');
});

test('GET /api/workflows rows carry needsRepo', async () => {
  const { workflows } = await (await fetch(`${base}/api/workflows`)).json();
  const by = Object.fromEntries(workflows.map((w) => [w.id, w.needsRepo]));
  assert.equal(by.wf_default, true);
  assert.equal(by.wf_memory_defrag, false);
  assert.equal(by.wf_presentation, false);
  assert.equal(by.wf_promo_video, true);
  assert.ok(workflows.every((w) => typeof w.needsRepo === 'boolean'));
});

test('an editor save of a user agent that never names needsRepo keeps it; an explicit false clears it', async () => {
  const meta = {
    metaVersion: 2, key: 'myReviewer', displayName: 'My Reviewer', runnerType: 'producer', order: 99, needsRepo: true,
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'my-notes.md' }],
  };
  await createAgent({ meta, markdown: '# My reviewer\n' });
  const { needsRepo: _drop, ...withoutField } = meta;
  const saved = await updateAgent('myReviewer', { meta: { ...withoutField, description: 'edited' } });
  assert.equal(saved.meta.needsRepo, true);
  assert.equal(JSON.parse(await readFile(join(userAgentsDir(), 'myReviewer.meta.json'), 'utf8')).needsRepo, true);
  assert.equal(loadAgentRegistry().myReviewer.needsRepo, true);
  const cleared = await updateAgent('myReviewer', { meta: { ...withoutField, needsRepo: false } });
  assert.equal('needsRepo' in cleared.meta, false);
});
