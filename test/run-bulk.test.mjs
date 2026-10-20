// test/run-bulk.test.mjs — which runs Stop / Archive / Delete apply to (spec §3.2), and the server runner
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bulkVerdict, planBulk, bulkConfirm } from '../src/shared/run-bulk.mjs';
import { runBulk } from '../src/core/run-bulk.mjs';

const T = (id, state, extra = {}) => ({ id, title: id, state, ...extra });

test('verdicts: stop live, cancel a group\'s waiting members, archive/delete only finished, skip and name the rest', () => {
  assert.equal(bulkVerdict('stop', T('a', 'working')), 'apply');
  assert.equal(bulkVerdict('stop', T('a', 'paused', { status: 'interrupted' })), 'skip');
  assert.equal(bulkVerdict('stop', T('a', 'waiting'), { inGroup: true }), 'cancel');
  assert.equal(bulkVerdict('stop', T('a', 'waiting')), 'skip');
  assert.equal(bulkVerdict('archive', T('a', 'merged')), 'apply');
  assert.equal(bulkVerdict('archive', T('a', 'needs-you')), 'skip');
  assert.equal(bulkVerdict('delete', T('a', 'waiting')), 'cancel');
  assert.equal(bulkVerdict('delete', T('a', 'working')), 'skip');
  assert.equal(bulkVerdict('restore', T('a', 'paused')), 'apply', 'an archived paused row restores');
  assert.equal(bulkVerdict('archive', T('t9', 'stopped', { ticketId: 't9' })), 'skip', 'a canceled ticket has no record');
  const plan = planBulk('stop', [T('g', 'working', { members: [T('m1', 'working'), T('m2', 'waiting'), T('m3', 'waiting')] }), T('x', 'merged')]);
  assert.deepEqual([plan.apply.map((t) => t.id), plan.cancel.map((t) => t.id), plan.skip.map((t) => [t.id, t.reason])],
    [['m1'], ['m2', 'm3'], [['x', 'already finished']]]);
  const c = bulkConfirm('stop', plan);
  assert.equal(c.title, 'Stop 3 runs?', 'the headline counts what the bar and the result count: stopped + cancelled');
  assert.match(c.message, /2 waiting runs are cancelled: m2, m3\./);
  assert.match(c.message, /Skipped 1 already finished: x\./);
  assert.match(c.message, /cannot be undone/);
});

test('Delete\'s confirm names what goes and what stays', () => {
  const c = bulkConfirm('delete', planBulk('delete', [T('a', 'merged'), T('b', 'working')]));
  assert.equal(c.title, 'Delete 1 run permanently?');
  assert.match(c.message, /Deletes the run records, their files and local branches\./);
  assert.match(c.message, /Keeps remote branches, pull requests and their cost in Statistics/);
  assert.match(c.message, /Skipped 1 still running — stop it first: b\./);
  assert.match(c.message, /no undo/);
});

test('a finished run raised to Needs you by its PR (D31) archives and deletes; Stop skips it as finished', () => {
  const pr = T('p', 'needs-you', { prNeeds: true, status: 'done', pipelineId: 'p' });
  assert.equal(bulkVerdict('archive', pr), 'apply');
  assert.equal(bulkVerdict('delete', pr), 'apply');
  assert.equal(bulkVerdict('stop', pr), 'skip');
  assert.equal(planBulk('stop', [pr]).skip[0].reason, 'already finished');
});

test('an interrupted run with no resume point archives and deletes; one that can resume is skipped as interrupted', () => {
  const dead = T('d', 'paused', { status: 'interrupted', resumable: false, pipelineId: 'd' });
  const parked = T('r', 'paused', { status: 'interrupted', resumable: true, pipelineId: 'r' });
  const unknown = T('u', 'paused', { status: 'interrupted', pipelineId: 'u' });
  assert.equal(bulkVerdict('archive', dead), 'apply');
  assert.equal(bulkVerdict('delete', dead), 'apply');
  assert.equal(bulkVerdict('stop', dead), 'skip', 'an interrupted run is never stopped');
  for (const t of [parked, unknown]) {
    assert.equal(bulkVerdict('archive', t), 'skip', `${t.id}: only Resume moves it on`);
    assert.equal(bulkVerdict('delete', t), 'skip');
  }
  assert.deepEqual(planBulk('archive', [parked]).skip.map((t) => t.reason), ['interrupted — resume it first']);
  assert.deepEqual(planBulk('delete', [parked]).skip.map((t) => t.reason), ['interrupted — resume it first']);
});

test('a waiting group member that Archive skips reads "not started yet", not "never started"', () => {
  const plan = planBulk('archive', [T('g', 'waiting', { members: [T('t2', 'waiting', { ticketId: 't2' })] })]);
  assert.deepEqual(plan.skip.map((t) => t.reason), ['not started yet']);
});

const fakeDeps = (calls, members) => ({
  expandGroup: () => members,
  resolve: (t) => (t.pipelineId ? { ...t, id: t.pipelineId, title: 'Slice 1', state: 'working', status: 'running' } : { ...t, id: t.ticketId, title: t.ticketId, state: 'waiting' }),
  stop: async (t) => { calls.push(['stop', t.id]); },
  cancel: (t) => { calls.push(['cancel', t.id]); return true; },
  afterGroupStop: (g) => calls.push(['cancelRest', g.id]),
});
const MEMBERS = [{ pipelineId: 'p1', ticketId: null }, { pipelineId: null, ticketId: 't2' }, { pipelineId: null, ticketId: 't3' }];

test('runBulk: a feature group stop cancels the waiting members first, then stops the live one, then cancels the feature', async () => {
  const calls = [];
  const r = await runBulk({ action: 'stop', groups: [{ id: 'feat_1', kind: 'feature' }] }, fakeDeps(calls, MEMBERS));
  assert.deepEqual(calls, [['cancel', 't2'], ['cancel', 't3'], ['stop', 'p1'], ['cancelRest', 'feat_1']]);
  assert.deepEqual([r.done.map((d) => d.id), r.cancelled.map((d) => d.id), r.skipped], [['p1'], ['t2', 't3'], []]);
});

test('runBulk: a plain Run-after chain arrives with its members inline and its waiting members are cancelled too', async () => {
  const calls = [];
  const deps = { ...fakeDeps(calls, []), expandGroup: () => { throw new Error('a chain is never looked up by id'); } };
  const r = await runBulk({ action: 'stop', groups: [{ id: 'p:p1', kind: 'chain', title: 'Chain', members: MEMBERS }] }, deps);
  assert.deepEqual(calls, [['cancel', 't2'], ['cancel', 't3'], ['stop', 'p1']], 'no cancelRest for a chain');
  assert.equal(r.cancelled.length, 2);
});
