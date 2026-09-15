// test/workflows-origin-auto.test.mjs — spec §12.5: a composer save must not erase the row's
// `origin`, or an Auto-created workflow would silently lose its Auto tag on the first edit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeGraphWorkflow, readWorkflow } from '../src/core/workflows.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';

useTempHome(after);

test('a composer save (no origin in the body) keeps origin=auto on an Auto-created row', async () => {
  const tpl = { ...SEED_TEMPLATES.find((t) => t.id === 'wf_quick-fix'), id: 'wf_theme', name: 'Theme switch', origin: 'auto' };
  await writeGraphWorkflow(tpl);
  assert.equal((await readWorkflow('wf_theme')).origin, 'auto');
  const { origin, ...noOrigin } = tpl;
  await writeGraphWorkflow({ ...noOrigin, name: 'Theme switch v2' });
  const row = await readWorkflow('wf_theme');
  assert.equal(row.name, 'Theme switch v2');
  assert.equal(row.origin, 'auto', 'workflows.mjs COALESCE(excluded.origin, workflows.origin)');
});
