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

test('step 3: a freshly armed team-cap override says so (the server audits who and why); an existing one does not', async () => {
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { checkTeamPipelineGate } = await import('../src/core/policy/gate.mjs');
  seedPipelineRow({ id: 'cafe0003', startedAt: new Date().toISOString() });
  const caps = { policy: { home: 'acme/api', sha: 'abc' }, pipeline: { team: { kind: 'soft', value: 1, onBreach: 'pause' } } };
  const first = checkTeamPipelineGate(caps, { pipelineId: 'cafe0003', spentSoFar: 2, pastTeamCap: true, reason: 'ship it', by: 'ada@example.com' });
  assert.deepEqual({ fresh: first.fresh, reason: first.reason }, { fresh: true, reason: 'ship it' });
  const again = checkTeamPipelineGate(caps, { pipelineId: 'cafe0003', spentSoFar: 3, pastTeamCap: false });
  assert.equal(again.overridden, true);
  assert.equal(again.fresh, undefined, 'already armed: nothing new to audit');
});

test('step 3: appendAuditById stores the actor always and the text as given', async () => {
  const { seedPipelineRow } = await import('./helpers/db-seed.mjs');
  const { appendAuditById } = await import('../src/core/artifacts.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  seedPipelineRow({ id: 'cafe0004', startedAt: new Date().toISOString() });
  appendAuditById('cafe0004', 'Run archived by ada@example.com.', { actor: 'ada@example.com' });
  appendAuditById('cafe0004', 'Run archived.', { actor: 'local' });
  appendAuditById('cafe0004', 'Pipeline finished with status **done**.');
  const rows = getDb().prepare('SELECT text, actor FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all('cafe0004').map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { text: 'Run archived by ada@example.com.', actor: 'ada@example.com' },
    { text: 'Run archived.', actor: 'local' },
    { text: 'Pipeline finished with status **done**.', actor: null },
  ]);
});

test('step 3: Ask\'s schedule tools read and mark notifications per person when the turn has a shared reader', async () => {
  const { addNotification, unreadCount } = await import('../src/core/notifications.mjs');
  const { defaultScheduleDeps } = await import('../src/core/ask/schedule-deps.mjs');
  const n = addNotification({ kind: 'failed', message: 'it failed', scheduleId: 'sch_0000000a' });
  const ada = defaultScheduleDeps({ reader: 'ada@example.com' }).schedules;
  const grace = defaultScheduleDeps({ reader: 'grace@example.com' }).schedules;
  const global = defaultScheduleDeps().schedules;
  const before = { ada: ada.unread(), grace: grace.unread(), global: global.unread() };
  assert.equal(ada.markRead([n.id]), 1);
  assert.equal(ada.unread(), before.ada - 1, 'read for Ada');
  assert.equal(grace.unread(), before.grace, 'still unread for Grace');
  assert.equal(global.unread(), before.global, 'the global state untouched');
  assert.equal(unreadCount('schedule'), before.global);
  assert.equal(ada.activity({}).notifications.find((x) => x.id === n.id).unread, false);
});

test('step 3: the Ask MCP child learns its reader through WORCA_ASK_READER, only when given', async () => {
  const { buildMcpConfig } = await import('../src/core/ask/spawn.mjs');
  const base = { homeBase: '/b', threadId: 't', serverPath: '/s.mjs', env: {} };
  assert.equal(buildMcpConfig(base).mcpServers.worca.env.WORCA_ASK_READER, undefined);
  assert.equal(buildMcpConfig({ ...base, reader: 'ada@example.com' }).mcpServers.worca.env.WORCA_ASK_READER, 'ada@example.com');
});
