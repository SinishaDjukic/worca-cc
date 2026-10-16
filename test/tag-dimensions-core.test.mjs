// test/tag-dimensions-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionsForTarget, allTagDimensions } from '../src/core/tag-dimensions.mjs';

const CC = { key: 'cc', label: 'Cost centre', values: [], required: true };
const LOCAL = { key: 'client', label: 'Client', values: [], required: false };
const policy = (fields) => ({ ok: true, home: 'acme/web', doc: { schema: 1, fields, workspaceRuns: {} } });
const withCc = policy({ 'runs.tagDimensions': { kind: 'soft', value: [CC] } });

test('dimensionsForTarget: policy field wins; a policy without the field falls back to Settings; none → null source', async () => {
  const io = (r, user = [LOCAL]) => ({ resolveProject: async () => r, user: () => user });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, io(withCc)), { source: 'policy', home: 'acme/web', dims: [CC] });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, io(policy({}))), { source: 'settings', home: null, dims: [LOCAL] });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, io({ ok: false, reason: 'not-enabled' }, [])), { source: null, home: null, dims: [] });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, { resolveProject: async () => { throw new Error('boom'); }, user: () => [] }), { source: null, home: null, dims: [] });
});

test('dimensionsForTarget passes discover:false, for a project and for a workspace', async () => {
  const seen = [];
  const io = { resolveProject: async (_d, o) => { seen.push(o); return { ok: false }; }, resolveWorkspace: async (_w, o) => { seen.push(o); return { ok: false }; }, user: () => [] };
  await dimensionsForTarget({ projectDir: '/p' }, io);
  await dimensionsForTarget({ workspaceId: 'w1' }, io);
  assert.deepEqual(seen, [{ discover: false }, { discover: false }]);
});

test('allTagDimensions: union of every project policy, then Settings; policy wins a shared key', async () => {
  const r = await allTagDimensions({
    projects: async () => [{ path: '/a', exists: true }, { path: '/b', exists: true }, { path: '/gone', exists: false }],
    resolveProject: async (p) => (p === '/a' ? withCc : { ok: false }),
    user: () => [{ ...CC, label: 'Mine' }, LOCAL],
  });
  assert.deepEqual(r.dims.map((d) => d.label), ['Cost centre', 'Client']);
});
