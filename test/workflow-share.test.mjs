// test/workflow-share.test.mjs
// The JSON share round trip (issue #421): exportGraphJson (the stored row,
// unstamped) and importGraphWorkflow (mint id, suffix on collision, shared
// validator with the one-line unknown-agent fold), plus saveGraphWorkflow
// keeping the composer's reject-on-collision semantics.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { useTempHome } from './helpers/temp-home.mjs';
import { writeKeyGraph } from './helpers/export-fixtures.mjs';
import {
  exportGraphJson, importGraphWorkflow, saveGraphWorkflow, summarizeUnknownAgents, workflowFileSlug,
} from '../src/core/workflow-share.mjs';
import { readWorkflow, writeGraphWorkflow } from '../src/core/workflows.mjs';

useTempHome(after);

test('exportGraphJson: the STORED row — no id/origin/timestamps, canvas kept, fixed key order', async () => {
  const tpl = await writeKeyGraph({ name: 'Share Me', keys: ['planner'] });
  await writeGraphWorkflow({ ...tpl, canvas: { zoom: 1.5, x: 10 } });
  const j = await exportGraphJson(tpl.id);
  assert.deepEqual(Object.keys(j), ['version', 'name', 'domain', 'nodes', 'wires', 'canvas']);
  assert.equal(j.version, 2);
  assert.equal(j.name, 'Share Me');
  assert.equal(j.domain, 'coding');
  assert.deepEqual(j.nodes, tpl.nodes);
  assert.deepEqual(j.wires, tpl.wires);
  assert.deepEqual(j.canvas, { zoom: 1.5, x: 10 });
  for (const k of ['id', 'origin', 'createdAt', 'updatedAt', 'archivedAt', '_worca']) assert.equal(k in j, false, `${k} must not leak`);
});

test('exportGraphJson: the built-in default is shareable; an unknown id is NOT_FOUND', async () => {
  const j = await exportGraphJson('wf_default');
  assert.equal(j.version, 2);
  assert.ok(j.nodes.length > 0);
  assert.equal('canvas' in j, false, 'no canvas => no key');
  await assert.rejects(exportGraphJson('wf_no-such-thing'), (e) => e.code === 'NOT_FOUND');
});

test('workflowFileSlug: wf_ stripped, other ids sanitized, never empty', () => {
  assert.equal(workflowFileSlug('wf_my-flow'), 'my-flow');
  assert.equal(workflowFileSlug('wf_default'), 'default');
  assert.equal(workflowFileSlug('wfp_demo_simple'), 'wfp_demo_simple');
  assert.equal(workflowFileSlug('wf_'), 'workflow');
});

test('importGraphWorkflow mints an id and ignores the file\'s id/origin; canvas survives', async () => {
  const src = await exportGraphJson('wf_default');
  const r = await importGraphWorkflow({ ...src, id: 'wf_default', origin: 'plugin:x', name: 'Imported Default', canvas: { zoom: 2 } });
  assert.ok(r.workflow.id.startsWith('wf_') && r.workflow.id !== 'wf_default', r.workflow.id);
  assert.equal(r.workflow.origin, null, 'a file origin is never trusted');
  assert.equal(r.renamed, false);
  assert.equal(r.requestedName, 'Imported Default');
  const row = await readWorkflow(r.workflow.id);
  assert.equal(row.name, 'Imported Default');
  assert.deepEqual(row.nodes, src.nodes);
  assert.deepEqual(row.canvas, { zoom: 2 });
  // The default itself is untouched.
  assert.equal((await readWorkflow('wf_default')).name, 'Default');
});

test('importGraphWorkflow suffixes the name on a live collision — never overwrites', async () => {
  const src = await exportGraphJson('wf_default');
  const a = await importGraphWorkflow({ ...src, name: 'Twice' });
  const b = await importGraphWorkflow({ ...src, name: 'Twice' });
  const c = await importGraphWorkflow({ ...src, name: 'Twice' });
  assert.equal(a.workflow.name, 'Twice');
  assert.equal(b.workflow.name, 'Twice (2)');
  assert.equal(c.workflow.name, 'Twice (3)');
  assert.equal(b.renamed, true);
  assert.equal(b.requestedName, 'Twice');
  assert.equal(new Set([a.workflow.id, b.workflow.id, c.workflow.id]).size, 3, 'three distinct rows');
  // A name that already carries a suffix continues counting from it.
  const d = await importGraphWorkflow({ ...src, name: 'Twice (2)' });
  assert.equal(d.workflow.name, 'Twice (4)');
  // `name` overrides the file's name before any collision handling.
  const e = await importGraphWorkflow({ ...src, name: 'Twice' }, { name: 'Renamed On Import' });
  assert.equal(e.workflow.name, 'Renamed On Import');
  assert.equal(e.renamed, false);
});

test('importGraphWorkflow refuses the reserved name (with a hint), a v1 body and a blank name', async () => {
  const src = await exportGraphJson('wf_default');
  await assert.rejects(importGraphWorkflow({ ...src, name: 'Default' }),
    (e) => e.code === 'RESERVED_NAME' && /different name/.test(e.message));
  await assert.rejects(importGraphWorkflow({ name: 'Old', steps: [[{ key: 'planner' }]], feedbacks: [] }),
    (e) => e.code === 'BAD_REQUEST' && /version 2/.test(e.message));
  await assert.rejects(importGraphWorkflow({ ...src, name: '   ' }), (e) => e.code === 'BAD_REQUEST' && /name is required/.test(e.message));
});

test('importGraphWorkflow folds unknown agents into ONE summary line that points at the plugin export', async () => {
  const src = await exportGraphJson('wf_default');
  const nodes = src.nodes.map((n) => (n.kind === 'agent' && n.key === 'planner' ? { ...n, key: 'ghostAgent' } : n));
  assert.notDeepEqual(nodes, src.nodes, 'the default has a planner node to rename');
  await assert.rejects(importGraphWorkflow({ ...src, name: 'Ghost', nodes }), (e) => {
    assert.equal(e.code, 'INVALID_GRAPH');
    assert.equal(e.message, 'invalid graph', 'the composer-facing message is unchanged');
    assert.ok(e.errors.some((i) => i.code === 'V4'), 'the shared validator\'s V4 is the cause');
    assert.match(e.summary, /1 agent not installed here \(ghostAgent\)/);
    assert.match(e.summary, /--format plugin/);
    return true;
  });
  assert.equal(summarizeUnknownAgents([{ code: 'V7', message: 'unknown agent "x"' }]), null, 'only V4 counts');
  assert.match(summarizeUnknownAgents([
    { code: 'V4', message: 'unknown agent "a" — no such key in the registry' },
    { code: 'V4', message: 'unknown agent "a" — no such key in the registry' },
    { code: 'V4', message: 'unknown agent "b" — no such key in the registry' },
  ]), /2 agents not installed here \(a, b\)/);
});

test('importGraphWorkflow checks per-node tunables against the catalog (BAD_REQUEST)', async () => {
  const src = await exportGraphJson('wf_default');
  const nodes = src.nodes.map((n) => (n.kind === 'agent' ? { ...n, config: { ...(n.config || {}), model: 'no-such-model' } } : n));
  await assert.rejects(importGraphWorkflow({ ...src, name: 'Bad Model', nodes }),
    (e) => e.code === 'BAD_REQUEST' && /unknown model "no-such-model"/.test(e.message));
});

test('saveGraphWorkflow keeps composer semantics: a minted collision is ID_TAKEN, a legal id re-saves', async () => {
  const src = await exportGraphJson('wf_default');
  const a = await saveGraphWorkflow({ ...src, name: 'Composer Save' });
  assert.ok(a.workflow.id.startsWith('wf_'));
  await assert.rejects(saveGraphWorkflow({ ...src, name: 'Composer Save' }),
    (e) => e.code === 'ID_TAKEN' && e.id === a.workflow.id);
  const b = await saveGraphWorkflow({ ...src, id: a.workflow.id, name: 'Composer Save Renamed' });
  assert.equal(b.workflow.id, a.workflow.id);
  assert.equal(b.workflow.name, 'Composer Save Renamed');
  await assert.rejects(saveGraphWorkflow({ name: 'v1', steps: [] }), (e) => e.code === 'BAD_REQUEST');
});
