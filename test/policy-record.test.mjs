// test/policy-record.test.mjs
// The optional `policy` object on a team-metrics record (team-policy design §10): present only
// when the run saw a policy, reason dropped under attribution:none, read from pipelines.policy_state.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { fakeHarness } from './helpers/metrics-git.mjs';
import { buildRunRecord, snapshotFromHarness, RECORD_FIELDS } from '../src/core/metrics/record.mjs';
import { writePolicyState } from '../src/core/policy/state.mjs';
import { parseRecordLine } from '../src/shared/team-metrics/aggregate.mjs';

useTempHome(after);
const proj = mkdtempSync(join(tmpdir(), 'worca-policy-record-'));

const snap = (policy) => ({
  status: 'done', runId: 'r1', startedAt: '2026-09-15T14:30:12Z', endedAt: '2026-09-15T14:40:58Z', totalActiveMs: 1, totalCostUsd: 1,
  steps: [], subAgents: [], workflow: null, agentKeys: [], target: { kind: 'project', project: 'acme/gateway' }, title: 't', source: null,
  pr: null, prBase: null, git: {}, interventions: {}, lastPause: null, actor: 'Mara', policy,
});

test('absent policy → no key at all (v1 records stay byte-identical)', () => {
  const rec = buildRunRecord(snap(null));
  assert.equal('policy' in rec, false);
  assert.deepEqual(Object.keys(rec), [...RECORD_FIELDS]);
  assert.equal('policy' in buildRunRecord(snap({ overrides: ['pipeline'] })), false, 'no home → no policy');
});

test('a policy object is clipped, de-duplicated, sha shortened; reason follows attribution', () => {
  const p = { home: 'acme/gateway', sha: 'abc1234def5678', overrides: ['pipeline', 'pipeline', 7], exceeded: [], deviations: ['model:x', 'plugin-missing:y'], unattended: 'yes', reason: 'hotfix at /Users/me/repo ok' };
  const rec = buildRunRecord(snap(p));
  assert.deepEqual(rec.policy, { home: 'acme/gateway', sha: 'abc1234', overrides: ['pipeline'], exceeded: [], deviations: ['model:x', 'plugin-missing:y'], unattended: false, reason: 'hotfix at <path> ok' });
  assert.equal(buildRunRecord(snap(p), { attribution: 'none' }).policy.reason, null);
  assert.equal(buildRunRecord(snap({ ...p, sha: 'nope', unattended: true })).policy.sha, null);
  assert.equal(buildRunRecord(snap({ ...p, unattended: true })).policy.unattended, true);
  // Readers of a v1 record keep working with the extra key.
  const parsed = parseRecordLine(JSON.stringify(rec));
  assert.equal(parsed.record.id, 'r1'); assert.equal(parsed.record.policy.home, 'acme/gateway');
});

test('snapshotFromHarness reads pipelines.policy_state and carries the auto flag', async () => {
  const { id } = await seedPipeline(proj, { title: 'r', status: 'done' });
  const h = fakeHarness({ projectDir: proj, runId: id });
  let s = await snapshotFromHarness(h, { status: 'done' });
  assert.equal(s.policy, null);
  writePolicyState(id, { home: 'acme/gateway', sha: 'abc1234', overrides: ['total'], reason: 'sprint end' });
  h.auto = true;
  s = await snapshotFromHarness(h, { status: 'done' });
  assert.equal(s.policy.home, 'acme/gateway'); assert.deepEqual(s.policy.overrides, ['total']); assert.equal(s.policy.unattended, true);
  const rec = buildRunRecord(s);
  assert.equal(rec.policy.reason, 'sprint end'); assert.equal(rec.policy.unattended, true);
});
