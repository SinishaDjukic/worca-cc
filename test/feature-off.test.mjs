// test/feature-off.test.mjs
// THE feature-off bar (spec §12, plan Global Constraints): with ZERO plugins
// installed the plugin system must be invisible — sources are exactly
// prompt+markdown, the registry has no plugin layer, and createPipeline stamps
// the default source columns. Runs against a fresh sandbox home; this file is
// a regression guard and must pass from its very first run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { listTaskSources } from '../src/core/sources.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { createPipeline } from '../src/core/artifacts.mjs';
import { prepare } from '../src/core/db.mjs';

useTempHome(after);

const scratch = [];
after(() => Promise.all(scratch.map((d) => rm(d, { recursive: true, force: true }))));

test('listTaskSources with zero plugins is exactly prompt + markdown', () => {
  assert.deepEqual(listTaskSources(), [
    { type: 'prompt', displayName: 'Prompt' },
    { type: 'markdown', displayName: 'Markdown' },
  ]);
});

test('loadAgentRegistry with zero plugins serves no plugin-origin agents', () => {
  const registry = loadAgentRegistry();
  const metas = Object.values(registry);
  assert.ok(metas.length > 0, 'built-in agents must load');
  assert.equal(registry.planner?.origin, 'builtin');
  assert.deepEqual(metas.filter((m) => String(m.origin).startsWith('plugin:')).map((m) => m.key), []);
});

test("createPipeline({prompt}) stamps source_type='prompt', source_ref NULL", async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-featoff-'));
  scratch.push(proj);
  const { id } = await createPipeline(proj, { prompt: 'plain prompt run' });
  const row = prepare('SELECT source_type, source_ref FROM pipelines WHERE id = ?').get(id);
  assert.equal(row.source_type, 'prompt');
  assert.equal(row.source_ref, null);
});
