// `humanEffort` (money-saved design §5): an OPTIONAL v2 sidecar block a plugin author uses to
// tune the human-hours estimate of a custom agent. Invalid shapes are dropped with a warning
// and never fail the sidecar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeAgentMeta } from '../src/shared/graph/agent-meta.mjs';
import { normalizeMeta } from '../src/core/agent-registry.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const v2 = (over = {}) => ({
  key: 'acmeAnalyst', metaVersion: 2, displayName: 'Analyst', order: 5, runnerType: 'producer',
  inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'report', type: 'md', filename: '{base}-report.md', store: 'project' }],
  agentFile: 'acme-analyst.md', ...over,
});

test('factor and hours survive normalization; both are optional', () => {
  const a = normalizeMeta(v2({ humanEffort: { factor: 1.5 } }), { warn: () => {} });
  assert.deepEqual(a.humanEffort, { factor: 1.5 });
  const b = normalizeMeta(v2({ humanEffort: { hours: 0.25 } }), { warn: () => {} });
  assert.deepEqual(b.humanEffort, { hours: 0.25 });
  const c = normalizeMeta(v2({ humanEffort: { factor: 0, hours: 2 } }), { warn: () => {} });
  assert.deepEqual(c.humanEffort, { factor: 0, hours: 2 });
  assert.equal('humanEffort' in normalizeMeta(v2(), { warn: () => {} }), false);
});

test('invalid humanEffort is dropped with ONE warning and the sidecar still loads', () => {
  const warnings = [];
  for (const bad of [{ factor: -1 }, { hours: 'x' }, { factor: Infinity }, 'nope', 3, {}]) {
    const m = normalizeMeta(v2({ humanEffort: bad }), { warn: (w) => warnings.push(w) });
    assert.ok(m, `sidecar loads for ${JSON.stringify(bad)}`);
    assert.equal('humanEffort' in m, false, JSON.stringify(bad));
  }
  assert.equal(warnings.filter((w) => /humanEffort/.test(w)).length, 6);
  const { errors } = normalizeAgentMeta(v2({ humanEffort: { factor: -1 } }), { warn: () => {} });
  assert.equal(errors.length, 0, 'never an ERROR (errors skip the whole sidecar)');
});

test('built-in sidecars: memory defragmenter and workspace scanner are factor 0, clarify is a fixed 0.25 h', () => {
  const read = (f) => JSON.parse(readFileSync(join(process.cwd(), 'agents', f), 'utf8'));
  assert.deepEqual(read('memoryDefragmenter.meta.json').humanEffort, { factor: 0 });
  assert.deepEqual(read('workspaceScanner.meta.json').humanEffort, { factor: 0 });
  assert.deepEqual(read('clarify.meta.json').humanEffort, { hours: 0.25 });
});
