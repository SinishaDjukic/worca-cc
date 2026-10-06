// test/policy-cache-homes.test.mjs — which cached policy stands for a home (MCP registry spec §11.2, §11.3): a registered
// project's row before a removed one's, then the newest discovery; removing a project drops its cache; a home whose doc
// this Worca cannot read is reported apart, never as "no longer required".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { projectKey } from '../src/core/store.mjs';
import { addProject, removeProject } from '../src/core/projects.mjs';
import { writeTeamPolicyPrefs, readTeamPolicyPrefs } from '../src/core/config.mjs';
import * as cache from '../src/core/policy/cache.mjs';
import { createWorkspace } from '../src/core/workspaces.mjs';
import { setTotalAck, readTotalAck } from '../src/core/policy/state.mjs';

useTempHome(after);
const root = mkdtempSync(join(tmpdir(), 'homes-'));
after(() => rmSync(root, { recursive: true, force: true }));
const dirOf = (n) => { const d = join(root, n); mkdirSync(d); return d; };
const DOC = (v) => ({ schema: 1, fields: { 'cost.pipelineLimitUsd': { kind: 'soft', value: v } } });
const cacheOf = (dir, slug, patch) => writeTeamPolicyPrefs(projectKey(dir), { present: true, hasOrigin: true, docKnown: true, slug, delegateTo: null, ...patch });
const homesOf = (slug) => cache.cachedPolicyHomes().filter((h) => h.slug === slug).map((h) => [h.sha, h.key]);

test('removing a project drops its policy cache: its home is no longer followed here', async () => {
  const one = dirOf('one');
  await addProject({ name: 'one', path: one });
  cacheOf(one, 'acme/one', { headSha: 'aaaaaaa', checkedAt: '2026-09-01T00:00:00.000Z', doc: DOC(1) });
  assert.deepEqual(homesOf('acme/one'), [['aaaaaaa', projectKey(one)]]);
  await removeProject('one');
  assert.equal(readTeamPolicyPrefs(projectKey(one)), null);
  assert.deepEqual(homesOf('acme/one'), [], 'its Team set greys with Forget (§11.2)');
});

test('a registered project\'s row stands for its home before a removed project\'s; among registered ones the newest discovery', async () => {
  const old = dirOf('two-old'); const a = dirOf('two-a'); const b = dirOf('two-b');
  // A row an older Worca left behind for a removed project (never discovered again), however new its date.
  cacheOf(old, 'acme/two', { headSha: 'aaaaaaa', checkedAt: '2026-09-30T00:00:00.000Z', doc: DOC(1) });
  assert.deepEqual(homesOf('acme/two'), [['aaaaaaa', projectKey(old)]], 'alone, it still counts');
  await addProject({ name: 'two-a', path: a });
  await addProject({ name: 'two-b', path: b });
  cacheOf(a, 'acme/two', { headSha: 'bbbbbbb', checkedAt: '2026-09-02T00:00:00.000Z', doc: DOC(2) });
  cacheOf(b, 'acme/two', { headSha: 'ccccccc', checkedAt: '2026-09-03T00:00:00.000Z', doc: DOC(3) });
  assert.deepEqual(homesOf('acme/two'), [['ccccccc', projectKey(b)]]);
  assert.equal(cache.cachedPolicyHomes().find((h) => h.slug === 'acme/two').doc.fields['cost.pipelineLimitUsd'].value, 3);
});

test('a home whose cached policy this Worca cannot read is reported apart, not as a home that requires nothing', async () => {
  const three = dirOf('three');
  await addProject({ name: 'three', path: three });
  cacheOf(three, 'acme/three', { headSha: 'ddddddd', checkedAt: '2026-09-04T00:00:00.000Z', unknownSchema: true, doc: null });
  assert.deepEqual(homesOf('acme/three'), []);
  assert.deepEqual([...cache.unreadablePolicyHomes()], ['acme/three']);
  cacheOf(three, 'acme/three', { unknownSchema: false, doc: DOC(4) });
  assert.deepEqual([...cache.unreadablePolicyHomes()], []);
  assert.deepEqual(homesOf('acme/three'), [['ddddddd', projectKey(three)]]);
});

test('removing a project that is a workspace\'s policy home keeps its cache: the workspace still follows the home', async () => {
  const wa = dirOf('ws-a'); const wb = dirOf('ws-b');
  for (const d of [wa, wb]) execFileSync('git', ['init', '-q', d]);
  await addProject({ name: 'ws-a', path: wa });
  await createWorkspace({ name: 'Home WS', projectPaths: [wa, wb], policyProject: wa });
  cacheOf(wa, 'acme/ws', { headSha: 'eeeeeee', checkedAt: '2026-09-05T00:00:00.000Z', doc: DOC(5) });
  await removeProject('ws-a');
  assert.deepEqual(homesOf('acme/ws'), [['eeeeeee', projectKey(wa)]], 'its Team set stays live for the workspace');
});

test('removing a project keeps its total-cap acknowledgements: added again in the same window, it is not asked twice', async () => {
  const four = dirOf('four');
  await addProject({ name: 'four', path: four });
  cacheOf(four, 'acme/four', { headSha: 'fffffff', checkedAt: '2026-09-06T00:00:00.000Z', doc: DOC(6) });
  setTotalAck(projectKey(four), 'acme/four', 1000, { reason: 'release week' });
  await removeProject('four');
  assert.deepEqual(homesOf('acme/four'), [], 'the home is no longer followed');
  assert.deepEqual(Object.keys(readTeamPolicyPrefs(projectKey(four))), ['acks']);
  assert.ok(readTotalAck(projectKey(four), 'acme/four', 1000), 'the acknowledgement stays');
});

test('removing a project a workspace still names keeps its cache: the home its policy project follows is found among its members', async () => {
  const h = dirOf('dl-h'); const p2 = dirOf('dl-p2');
  for (const d of [h, p2]) execFileSync('git', ['init', '-q', d]);
  await addProject({ name: 'dl-h', path: h });
  await createWorkspace({ name: 'Delegating WS', projectPaths: [p2, h], policyProject: p2 });
  cacheOf(p2, 'acme/dl-p2', { headSha: 'fffffff', checkedAt: '2026-09-07T00:00:00.000Z', doc: null, delegateTo: 'acme/dl-h' });
  cacheOf(h, 'acme/dl-h', { headSha: '1111111', checkedAt: '2026-09-07T00:00:00.000Z', doc: DOC(7) });
  await removeProject('dl-h');
  assert.deepEqual(homesOf('acme/dl-h'), [['1111111', projectKey(h)]], 'the workspace still follows the home: its Team set stays live');
  // A repo no workspace names is no longer followed: its cache goes.
  const lone = dirOf('dl-lone');
  await addProject({ name: 'dl-lone', path: lone });
  cacheOf(lone, 'acme/dl-lone', { headSha: '2222222', checkedAt: '2026-09-07T00:00:00.000Z', doc: DOC(8) });
  await removeProject('dl-lone');
  assert.deepEqual(homesOf('acme/dl-lone'), []);
});

test('a follower whose marker names the old Azure short-form slug still gets the home\'s policy (cycle-3 M1)', () => {
  const azHome = dirOf('az-home'); const azFollower = dirOf('az-follower');
  cacheOf(azHome, 'dev.azure.com/acme/shop/shop', { headSha: 'az1', doc: DOC(3) });
  // The marker was committed before the fold: it names https://dev.azure.com/acme/_git/Shop's old slug.
  cacheOf(azFollower, 'dev.azure.com/acme/web/web', { delegateTo: 'dev.azure.com/acme/shop', doc: { schema: 1, delegateTo: 'dev.azure.com/acme/shop' } });
  const got = cache.cachedPolicyForKey(projectKey(azFollower));
  assert.ok(got, 'the follower is governed, not silently policy-free');
  assert.equal(got.home, 'dev.azure.com/acme/shop/shop');
  assert.deepEqual(got.doc, cache.cachedPolicyForKey(projectKey(azHome)).doc);
  assert.equal(cache.cachedPolicyForKey(projectKey(azHome)).home, 'dev.azure.com/acme/shop/shop');
});

test('a home cached under both the visualstudio.com and the canonical spelling is one home', () => {
  const a = dirOf('vs-a'); const b = dirOf('vs-b');
  cacheOf(a, 'acme.visualstudio.com/shop/api', { headSha: 'vs1', checkedAt: '2026-01-01T00:00:00Z', doc: DOC(4) });
  cacheOf(b, 'dev.azure.com/acme/shop/api', { headSha: 'vs2', checkedAt: '2026-02-01T00:00:00Z', doc: DOC(5) });
  assert.deepEqual(cache.cachedPolicyHomes().map((h) => h.slug).filter((s) => s.includes('shop/api')), ['dev.azure.com/acme/shop/api']);
  assert.deepEqual(homesOf('dev.azure.com/acme/shop/api'), [['vs2', projectKey(b)]], 'the newest discovery stands for the home');
  // The old-spelling home reports the canonical `home`, like its followers do.
  assert.equal(cache.cachedPolicyForKey(projectKey(a)).home, 'dev.azure.com/acme/shop/api');
});
