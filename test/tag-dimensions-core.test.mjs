// test/tag-dimensions-core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimensionsForTarget, allTagDimensions, teamTagPolicy, applyTagRules } from '../src/core/tag-dimensions.mjs';

const CC = { key: 'cc', label: 'Cost centre', values: [], required: true };
const LOCAL = { key: 'client', label: 'Client', values: [], required: false };
const policy = (fields) => ({ ok: true, home: 'acme/web', doc: { schema: 1, fields, workspaceRuns: {} } });
const withCc = policy({ 'runs.tagDimensions': { kind: 'soft', value: [CC] } });

test('dimensionsForTarget: policy field wins; a policy without the field falls back to Settings; none → null source', async () => {
  const io = (r, user = [LOCAL]) => ({ resolveProject: async () => r, user: () => user, userEnforce: () => false });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, io(withCc)), { source: 'policy', home: 'acme/web', dims: [CC], enforce: false });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, io(policy({}))), { source: 'settings', home: null, dims: [LOCAL], enforce: false });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, io({ ok: false, reason: 'not-enabled' }, [])), { source: null, home: null, dims: [], enforce: false });
  assert.deepEqual(await dimensionsForTarget({ projectDir: '/p' }, { resolveProject: async () => { throw new Error('boom'); }, user: () => [], userEnforce: () => false }), { source: null, home: null, dims: [], enforce: false });
});

test('dimensionsForTarget passes discover:false, for a project and for a workspace', async () => {
  const seen = [];
  const io = { resolveProject: async (_d, o) => { seen.push(o); return { ok: false }; }, resolveWorkspace: async (_w, o) => { seen.push(o); return { ok: false }; }, user: () => [], userEnforce: () => false };
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

test('dimensionsForTarget: enforce = policy runs.enforceTags, else false under a policy list, else the local switch', async () => {
  const io = (r, enforce) => ({ resolveProject: async () => r, user: () => [LOCAL], userEnforce: () => enforce });
  const both = policy({ 'runs.tagDimensions': { kind: 'soft', value: [CC] }, 'runs.enforceTags': { kind: 'soft', value: true } });
  assert.equal((await dimensionsForTarget({ projectDir: '/p' }, io(both, false))).enforce, true);
  assert.equal((await dimensionsForTarget({ projectDir: '/p' }, io(withCc, true))).enforce, false, 'the team list ignores the local switch');
  assert.equal((await dimensionsForTarget({ projectDir: '/p' }, io(policy({}), true))).enforce, true);
  const onlyEnforce = policy({ 'runs.enforceTags': { kind: 'soft', value: true } });
  const r = await dimensionsForTarget({ projectDir: '/p' }, io(onlyEnforce, false));
  assert.deepEqual([r.source, r.home, r.dims, r.enforce], ['settings', 'acme/web', [LOCAL], true]);
});

test('teamTagPolicy: first existing project whose policy sets either field; null when none', async () => {
  const projects = async () => [{ path: '/gone', exists: false }, { path: '/a', exists: true }, { path: '/b', exists: true }];
  const t = await teamTagPolicy({ projects, resolveProject: async (p) => (p === '/b' ? withCc : { ok: false }) });
  assert.deepEqual(t, { home: 'acme/web', dims: [CC], enforce: null });
  assert.equal(await teamTagPolicy({ projects, resolveProject: async () => ({ ok: false }) }), null);
});

test('applyTagRules: no-op when enforcement is off; pre-fills then reports the problem', async () => {
  const rules = async () => ({ dims: [CC], enforce: true });
  const sources = () => ({ projectDefaults: [], lastUsed: ['cc:4410'] });
  assert.deepEqual(await applyTagRules({ tags: [] }, { rules: async () => ({ dims: [CC], enforce: false }), sources }), { tags: [], error: null, enforced: false });
  assert.deepEqual(await applyTagRules({ tags: [] }, { rules, sources }), { tags: ['cc:4410'], error: null, enforced: true });
  assert.deepEqual(await applyTagRules({ tags: [] }, { rules, sources: () => ({}) }), { tags: [], error: 'Add Cost centre to start', enforced: true });
});
