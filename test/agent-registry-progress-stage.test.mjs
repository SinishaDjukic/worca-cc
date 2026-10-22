// `progressStage` (run progress bar): an OPTIONAL v2 sidecar field naming the bar stage an agent
// moves the run into. The registry whitelists it; an invalid value skips the whole sidecar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMeta } from '../src/core/agent-registry.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

const v2 = (over = {}) => ({
  key: 'acmeAnalyst', metaVersion: 2, displayName: 'Analyst', order: 5, runnerType: 'producer',
  inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'report', type: 'md', filename: '{base}-report.md', store: 'project' }],
  agentFile: 'acme-analyst.md', ...over,
});

test('progressStage is whitelisted by the registry and stays absent when not declared', () => {
  const meta = normalizeMeta(v2({ progressStage: 'build' }), { warn: () => {} });
  assert.equal(meta.progressStage, 'build');
  assert.equal('progressStage' in normalizeMeta(v2(), { warn: () => {} }), false);
});

test('an invalid progressStage skips the sidecar with a warning', () => {
  const warns = [];
  assert.equal(normalizeMeta(v2({ progressStage: 'invalid' }), { warn: (w) => warns.push(w) }), null);
  assert.ok(warns.some((w) => w.includes('progressStage must be one of')));
});
