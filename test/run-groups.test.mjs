// test/run-groups.test.mjs — run groups: Shaper features (#770) and user groups (runs redesign §3.3)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { createSliceFeature } from '../src/core/shape/features.mjs';
import { listRunGroups, createRunGroup, addToGroup, removeFromGroup, RunGroupError } from '../src/core/run-groups.mjs';
import { buildRunsModel } from '../ui/public/runs-list.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { getStats } from '../src/core/stats.mjs';
import { setWatch } from '../src/core/pr-watch.mjs';

useTempHome(after);
const PROJECT = '/tmp/rg-proj';
const OUTLINE = { why: 'w', slices: [1, 2, 3].map((i) => ({ id: `s${i}`, title: `Slice ${i}`, goal: 'g', inScope: [], outOfScope: [],
  acceptance: [], dependsOn: [], estimate: 'small' })) };
const NOW = Date.parse('2026-10-18T12:00:00Z');
let n = 0;

function featureWithTwoDone() {
  n += 1;
  seedPipelineRow({ id: `p-slice1-${n}`, title: 'Shape it', status: 'done' });
  const { id } = createSliceFeature({ pipelineId: `p-slice1-${n}`, projectDir: PROJECT, title: 'Run tags', outline: OUTLINE,
    perspectives: [], workflowId: 'wf_shape' });
  // Slice 2 fired and finished; slice 3 still waits on it.
  const t2 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(id).ticket_id;
  seedPipelineRow({ id: `p-slice2-${n}`, title: 'Slice 2', status: 'done' });
  getDb().prepare('UPDATE scheduled_runs SET status = \'fired\', pipeline_id = ? WHERE id = ?').run(`p-slice2-${n}`, t2);
  return { id, s1: `p-slice1-${n}`, s2: `p-slice2-${n}` };
}

test('Known bug 6: a real Shaper feature lists as one group row "2/3", even with no chain feed', () => {
  const f = featureWithTwoDone();
  const g = listRunGroups().find((x) => x.id === f.id);
  assert.equal(g.kind, 'feature');
  assert.deepEqual(g.members.map((m) => [m.position, m.pipelineId, m.ticket ? m.ticket.status : null]),
    [[1, f.s1, null], [2, f.s2, null], [3, null, 'scheduled']]);
  assert.equal(g.members[2].after, 2, 'slice 3 waits on slice 2 (D29)');
  assert.deepEqual(g.members.map((m) => m.title), ['Slice 1', 'Slice 2', 'Slice 3'], 'slice titles, not the runs\' "Run tags · 1/3: …" titles');
  const history = [f.s1, f.s2].map((id) => ({ id, projectKey: 'k', title: id, status: 'done', run: { status: 'done' } }));
  const groups = [{ id: g.id, groupKind: 'feature', title: g.title,
    members: g.members.map((m) => ({ position: m.position, title: m.title, pipelineId: m.pipelineId, ticketId: m.ticketId,
      kind: m.pipelineId ? 'hist' : 'sched', run: m.pipelineId ? { status: m.status } : { ticket: m.ticket } })) }];
  const model = buildRunsModel({ history, groups, now: NOW });
  const rows = model.sections.flatMap((s) => s.rows);
  assert.equal(rows.length, 1, 'the two finished slices fold into the feature row');
  assert.equal(rows[0].kind, 'chain');
  assert.equal(rows[0].groupKind, 'feature');
  assert.equal(rows[0].count, '2/3');
  assert.equal(rows[0].open, true, 'an unfinished group is open by default (D29)');
});

test('Add to group / Remove from group change the size; one group at a time; a native slice cannot move', () => {
  const f = featureWithTwoDone();
  seedPipelineRow({ id: 'p-loose', title: 'Loose run', status: 'running' });
  addToGroup({ groupId: f.id, pipelineId: 'p-loose', by: 'ana' });
  let g = listRunGroups().find((x) => x.id === f.id);
  assert.equal(g.members.length, 4);
  assert.equal(g.members.at(-1).position, 4);
  assert.equal(g.members.at(-1).adhoc, true);
  assert.equal(g.members.at(-1).pipelineId, 'p-loose');
  assert.throws(() => addToGroup({ groupId: f.id, pipelineId: 'p-loose' }), (e) => e instanceof RunGroupError && e.code === 'IN_GROUP');
  assert.throws(() => addToGroup({ groupId: f.id, pipelineId: f.s2 }), (e) => e.code === 'IN_GROUP');
  assert.throws(() => removeFromGroup({ pipelineId: f.s2 }), (e) => e.code === 'NATIVE_MEMBER');
  removeFromGroup({ pipelineId: 'p-loose' });
  g = listRunGroups().find((x) => x.id === f.id);
  assert.equal(g.members.length, 3);
});

test('New group: created with its first run; removing the last member deletes it', () => {
  seedPipelineRow({ id: 'p-a', title: 'A', status: 'done' });
  seedPipelineRow({ id: 'p-b', title: 'B', status: 'done' });
  const g = createRunGroup({ title: 'Billing', pipelineId: 'p-a', by: 'ana' });
  assert.match(g.id, /^grp_[0-9a-f]{12}$/);
  addToGroup({ groupId: g.id, pipelineId: 'p-b' });
  assert.deepEqual(listRunGroups().find((x) => x.id === g.id).members.map((m) => m.pipelineId), ['p-a', 'p-b']);
  removeFromGroup({ pipelineId: 'p-a' });
  removeFromGroup({ pipelineId: 'p-b' });
  assert.equal(listRunGroups().find((x) => x.id === g.id), undefined);
  assert.throws(() => createRunGroup({ title: '  ', pipelineId: 'p-a' }), (e) => e.code === 'BAD_TITLE');
});

test('a deleted feature slice keeps its slot: the finished feature still reads "3/3", never stopped', () => {
  const f = featureWithTwoDone();
  const t3 = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 3').get(f.id).ticket_id;
  seedPipelineRow({ id: `p-slice3-${n}`, title: 'Slice 3', status: 'done' });
  getDb().prepare('UPDATE scheduled_runs SET status = \'fired\', pipeline_id = ? WHERE id = ?').run(`p-slice3-${n}`, t3);
  // What purgePipeline leaves behind (test/pipeline-delete.test.mjs covers the purge itself).
  getDb().prepare("UPDATE pipelines SET title = 'deleted run', archived_at = '2026-10-18T00:00:00Z', deleted_at = '2026-10-18T00:00:00Z' WHERE id = ?").run(f.s1);
  const g = listRunGroups().find((x) => x.id === f.id);
  assert.equal(g.members.length, 3);
  assert.equal(g.members[0].title, 'Slice 1', 'a native slice reads its slice title, never the (anonymised) run title');
  const m = groupModel({ kind: 'feature', members: g.members.map((x) => ({ status: x.status })) });
  assert.equal(m.count.text, '3/3');
  assert.ok(['merged', 'ready'].includes(m.state), m.state);
});

test('§2.4: a group total = planning run + members + earlier attempts + fix runs, equal to Statistics', () => {
  getDb().exec('DELETE FROM pipelines');                    // only this feature's runs in the store
  const f = featureWithTwoDone();                            // slice 1 (planning) and slice 2 done, slice 3 waiting
  const db = getDb();
  const cost = (id, usd) => db.prepare('UPDATE pipelines SET total_cost_usd = ? WHERE id = ?').run(usd, id);
  cost(f.s1, 1.5); cost(f.s2, 0.75);
  // An earlier failed attempt of slice 2: its old ticket keeps its pipeline and names the feature in its request.
  seedPipelineRow({ id: `p-try-${n}`, title: 'Slice 2', status: 'error', totalCostUsd: 0.4 });
  db.prepare(`INSERT INTO scheduled_runs (id, status, pipeline_id, request, run_at, created_at, updated_at, title)
    VALUES (?, 'fired', ?, ?, '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z', '2026-10-18T00:00:00Z', 'Slice 2')`)
    .run(`t-try-${n}`, `p-try-${n}`, JSON.stringify({ shape: { slice: { feature: f.id, idx: 2 } } }));
  // A Watch PR fix run on slice 2's PR; slice 2 is archived and still counts.
  seedPipelineRow({ id: `p-fix-${n}`, title: 'Fix CI', status: 'done', totalCostUsd: 0.25 });
  db.prepare("UPDATE pipelines SET pr_url = 'https://github.com/o/r/pull/9', archived_at = '2026-10-18T00:00:00Z' WHERE id = ?").run(f.s2);
  setWatch({ prUrl: 'https://github.com/o/r/pull/9', pipelineId: f.s2, enabled: false });   // pr-watch.mjs:38
  db.prepare("INSERT INTO pr_watch_runs (run_id, pr_url, pipeline_id, created_at) VALUES ('r-fix', 'https://github.com/o/r/pull/9', ?, '2026-10-18T00:00:00Z')").run(`p-fix-${n}`);
  const g = listRunGroups().find((x) => x.id === f.id);
  assert.equal(g.cost.usd, 2.9);
  assert.deepEqual(Object.keys(g.cost.byPipeline).sort(), [f.s1, f.s2, `p-fix-${n}`, `p-try-${n}`].sort());
  assert.equal(g.cost.usd, getStats({ range: 'all' }).totals.pipelineSpendUsd, 'the sum Statistics reports');
});

test('§2.4: a re-planned feature\'s total includes the earlier round', () => {
  getDb().exec('DELETE FROM pipelines');
  const f = featureWithTwoDone();
  const db = getDb();
  db.prepare('UPDATE pipelines SET total_cost_usd = ? WHERE id = ?').run(1.5, f.s1);
  db.prepare('UPDATE pipelines SET total_cost_usd = ? WHERE id = ?').run(0.75, f.s2);
  seedPipelineRow({ id: `p-replan-${n}`, title: 'Re-plan', status: 'done', totalCostUsd: 0.5 });
  const { id: next } = createSliceFeature({ pipelineId: `p-replan-${n}`, projectDir: PROJECT, title: 'Run tags',
    outline: OUTLINE, perspectives: [], workflowId: 'wf_shape', replaces: f.id });
  assert.equal(listRunGroups().find((x) => x.id === next).cost.usd, 2.75, 'new planning run + the old round\'s two runs');
});

test('planning: null while slice 1 is the planning run; the origin run once slice 1 was restarted', () => {
  const f = featureWithTwoDone();
  let g = listRunGroups().find((x) => x.id === f.id);
  assert.equal(g.planning, null, 'the origin run is slice 1: never counted twice');
  assert.equal(g.members[0].pipelineId, f.s1);
  // Slice 1 restarted: its row now points at a new run, the origin stays the earlier planning run.
  seedPipelineRow({ id: 'p-slice1-restart', status: 'running' });
  getDb().prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 1').run('p-slice1-restart', f.id);
  g = listRunGroups().find((x) => x.id === f.id);
  assert.deepEqual(g.planning, { pipelineId: f.s1, title: 'Planning', status: 'done' });
  assert.ok(!g.members.some((m) => m.pipelineId === f.s1), 'planning is not counted as a member');
  for (const u of listRunGroups().filter((x) => x.kind === 'user')) assert.equal(u.planning, null);
});

test('a member\'s stored PR carries its stored verdict (D3): Checks failing survives without a History PR', () => {
  const f = featureWithTwoDone();
  getDb().prepare('UPDATE pipelines SET pr_url = ?, pr_number = ?, pr_state = ?, pr_verdict = ? WHERE id = ?')
    .run('https://github.com/acme/web/pull/821', 821, 'OPEN',
      JSON.stringify({ mergeable: 'MERGEABLE', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } }), f.s1);
  const m = listRunGroups().find((g) => g.id === f.id).members[0];
  assert.deepEqual(m.pr, { url: 'https://github.com/acme/web/pull/821', number: 821, state: 'OPEN', mergeable: 'MERGEABLE',
    checks: { state: 'failing', total: 12, failed: 3, pending: 0 } });
  const plain = listRunGroups().find((g) => g.id === f.id).members[1];
  assert.equal(plain.pr, null, 'no stored PR: still null');
});
