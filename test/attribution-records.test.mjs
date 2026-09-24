// test/attribution-records.test.mjs — the metrics actor prefers the person who started the run;
// a team cap override records who chose to continue (identity.mjs), never 'local'.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { actorForRecord, buildRunRecord } from '../src/core/metrics/record.mjs';

useTempHome(after);

test('actorForRecord: a person wins; local, empty and non-strings fall back', () => {
  assert.equal(actorForRecord('ada@example.com'), 'ada@example.com');
  for (const v of ['local', '', '  ', null, undefined, 7]) assert.equal(actorForRecord(v), null, String(v));
});

test('attribution:none still drops the actor, whoever started the run', () => {
  const snap = { id: 'abcd0001', status: 'done', actor: 'ada@example.com', steps: [] };
  assert.equal(buildRunRecord(snap, { attribution: 'none' }).actor, null);
  assert.equal(buildRunRecord(snap, { attribution: 'git-user' }).actor, 'ada@example.com');
});

test('a team pipeline-cap override records who continued, next to the reason', async () => {
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { checkTeamPipelineGate } = await import('../src/core/policy/gate.mjs');
  const { readPolicyState } = await import('../src/core/policy/state.mjs');
  seedPipelineRow({ id: 'cafe0001', startedAt: new Date().toISOString() });
  seedPipelineRow({ id: 'cafe0002', startedAt: new Date().toISOString() });
  const caps = { policy: { home: 'acme/api', sha: 'abc' }, pipeline: { team: { kind: 'soft', value: 1, onBreach: 'pause' } } };
  assert.equal(checkTeamPipelineGate(caps, { pipelineId: 'cafe0001', spentSoFar: 2, pastTeamCap: true, reason: 'finish it', by: 'ada@example.com' }).overridden, true);
  const s = readPolicyState('cafe0001');
  assert.equal(s.reason, 'finish it');
  assert.equal(s.overriddenBy, 'ada@example.com');
  checkTeamPipelineGate(caps, { pipelineId: 'cafe0002', spentSoFar: 2, pastTeamCap: true, by: 'local' });
  assert.equal(readPolicyState('cafe0002').overriddenBy, undefined, 'never "local"');
});
