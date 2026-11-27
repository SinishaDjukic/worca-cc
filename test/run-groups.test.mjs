// test/run-groups.test.mjs — run groups: Shaper features (#770) and user groups (runs redesign §3.3)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { createSliceFeature, setFeatureAcceptance, shipHold, liveSliceFrom } from '../src/core/shape/features.mjs';
import { listRunGroups, createRunGroup, addToGroup, removeFromGroup, RunGroupError, addRunsToGroup, restoreRunGroups, runNameInputs } from '../src/core/run-groups.mjs';
import { buildRunsModel, renderRunsList } from '../ui/public/runs-list.mjs';
import { groupModel } from '../src/shared/run-model.mjs';
import { getStats } from '../src/core/stats.mjs';
import { setWatch } from '../src/core/pr-watch.mjs';
import { verifyStop } from '../src/shared/shape/verifier.mjs';
import { JSDOM } from 'jsdom';

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

test('Add to group moves a run out of another user group (deleting it when empty), skips slices; Undo restores it', () => {
  const f = featureWithTwoDone();
  seedPipelineRow({ id: 'p-m1', title: 'M1', status: 'done' });
  seedPipelineRow({ id: 'p-m2', title: 'M2', status: 'done' });
  const old = createRunGroup({ title: 'Old', pipelineId: 'p-m1' });
  const target = createRunGroup({ title: 'Target', pipelineId: 'p-m2', nameSource: 'suggested' });
  const r = addRunsToGroup({ groupId: target.id, pipelineIds: ['p-m1', f.s2, 'p-m2', 'nope'] });
  assert.deepEqual(r.added, ['p-m1']);
  assert.deepEqual(r.skipped.map((s) => [s.pipelineId, s.reason]), [[f.s2, 'feature'], ['p-m2', 'already'], ['nope', 'not-found']]);
  assert.equal(listRunGroups().find((g) => g.id === old.id), undefined, 'the emptied group is gone');
  assert.equal(getDb().prepare('SELECT 1 FROM run_groups WHERE id = ?').get(old.id), undefined);
  assert.deepEqual(listRunGroups().find((g) => g.id === target.id).members.map((m) => m.pipelineId), ['p-m2', 'p-m1']);
  assert.equal(listRunGroups().find((g) => g.id === target.id).nameSource, 'suggested');
  restoreRunGroups(r.snap);
  assert.deepEqual(listRunGroups().find((g) => g.id === old.id).members.map((m) => m.pipelineId), ['p-m1'], 'Old is back, same id');
  assert.deepEqual(listRunGroups().find((g) => g.id === target.id).members.map((m) => m.pipelineId), ['p-m2']);
});

test('New group takes several runs and a name source; its Undo deletes the group it created', () => {
  seedPipelineRow({ id: 'p-n1', title: 'N1', status: 'done' });
  seedPipelineRow({ id: 'p-n2', title: 'N2', status: 'done' });
  const g = createRunGroup({ title: 'Pair', pipelineIds: ['p-n1', 'p-n2'], nameSource: 'user' });
  assert.deepEqual(g.added, ['p-n1', 'p-n2']);
  assert.deepEqual(listRunGroups().find((x) => x.id === g.id).members.map((m) => m.pipelineId), ['p-n1', 'p-n2']);
  assert.throws(() => createRunGroup({ title: 'X', pipelineIds: ['p-n1'], nameSource: 'ai' }), (e) => e.code === 'BAD_NAME_SOURCE');
  restoreRunGroups(g.snap);
  assert.equal(getDb().prepare('SELECT 1 FROM run_groups WHERE id = ?').get(g.id), undefined);
});

test('a new group of only feature slices is refused; runNameInputs reads title and prompt', () => {
  const f = featureWithTwoDone();
  assert.throws(() => createRunGroup({ title: 'Nope', pipelineIds: [f.s1, f.s2] }), (e) => e.code === 'IN_GROUP');
  seedPipelineRow({ id: 'p-q', title: 'Fix login', status: 'done' });
  getDb().prepare("UPDATE pipelines SET prompt = 'Safari loops after SSO' WHERE id = 'p-q'").run();
  assert.deepEqual(runNameInputs(['p-q']), [{ title: 'Fix login', firstMessage: 'Safari loops after SSO' }]);
  assert.equal(runNameInputs(['p-q', 'missing']), null);
});

/** D2 · a 10-slice feature whose origin carries the small-runs marker (`shape_stats.smallRuns`) or not. */
function tenSliceFeature({ marked = true, agreed = null } = {}) {
  n += 1;
  const origin = `p-ten-${n}`;
  seedPipelineRow({ id: origin, title: 'Shape it', status: 'done' });
  if (marked) getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{"smallRuns":true}', origin);
  const outline = { why: 'w', slices: Array.from({ length: 10 }, (_, i) => ({ id: `s${i + 1}`, title: `Slice ${i + 1}`, goal: 'g',
    inScope: [], outOfScope: [], acceptance: [], dependsOn: [], estimate: 'small' })) };
  if (agreed) { outline.agreed = agreed.map((x) => ({ id: x, text: x })); outline.leftOut = []; outline.slices[0].requirements = [agreed[0]]; }
  const { id } = createSliceFeature({ pipelineId: origin, projectDir: PROJECT, title: 'Ten runs', outline, perspectives: [], workflowId: 'wf_shape' });
  return { id, origin };
}
const withSmallRuns = (on, fn) => {
  const prev = process.env.WORCA_FLAGS;
  try {
    if (on) process.env.WORCA_FLAGS = 'shaperSmallRuns'; else delete process.env.WORCA_FLAGS;
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev;
  }
};

test('D2 (D1): a marked 10-run feature is 1 group of 10, run 1 is the planning run, smallRuns: true with the flag on', () => {
  const f = tenSliceFeature();
  const groups = withSmallRuns(true, () => listRunGroups().filter((x) => x.id === f.id));
  assert.equal(groups.length, 1);
  const [g] = groups;
  assert.equal(g.members.length, 10);
  assert.equal(g.members[0].pipelineId, f.origin, 'run 1 is the planning run');
  assert.deepEqual(g.members.map((m) => m.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(g.smallRuns, true);
});

test('D2 (D1): flag off, or an unmarked feature: the group keeps dev\'s keys (no smallRuns key at all)', () => {
  const marked = tenSliceFeature();
  const plain = tenSliceFeature({ marked: false });
  const off = withSmallRuns(false, () => listRunGroups());
  const on = withSmallRuns(true, () => listRunGroups());
  assert.equal('smallRuns' in off.find((x) => x.id === marked.id), false);
  assert.equal('smallRuns' in on.find((x) => x.id === plain.id), false);
  for (const g of on.filter((x) => x.kind === 'user')) assert.equal('smallRuns' in g, false);
});

test('item 7: each native member of a small-runs group carries its slice (kind, state, stop, waitsFor); other groups and the flag off keep their keys', () => {
  const f = tenSliceFeature();
  const plain = tenSliceFeature({ marked: false });
  const db = getDb();
  const outline = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(f.id).outline);
  outline.slices[2].dependsOn = ['s2'];
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify(outline), f.id);
  n += 1;
  seedPipelineRow({ id: `p-live-${n}`, title: 'Slice 2', status: 'running' });
  db.prepare('UPDATE shape_feature_slices SET pipeline_id = ? WHERE feature_id = ? AND idx = 2').run(`p-live-${n}`, f.id);
  const loose = `p-loose-${n}`;
  seedPipelineRow({ id: loose, title: 'Loose', status: 'done' });
  addToGroup({ groupId: f.id, pipelineId: loose });
  const live = (pid) => (pid === `p-live-${n}` ? { runId: 'r', status: 'running', asking: true, stop: { reason: 'objection', held: true, after: 1 } } : null);
  const of = (list, x) => list.find((g) => g.id === x.id);
  const on = withSmallRuns(true, () => listRunGroups({ live }));
  const m = of(on, f).members;
  assert.deepEqual(m[0].slice, { kind: null, state: 'done', buildsOn: [] });
  // Its stop answer is held waiting its turn, so it goes on next (owner direction dd8aea6ed).
  assert.deepEqual(m[1].slice, { kind: null, state: 'questions', stop: { reason: 'objection', held: true, after: 1 }, nextTurn: true, buildsOn: [] });
  assert.deepEqual(m[2].slice, { kind: null, state: 'planned', waitsFor: [2], buildsOn: [2] });
  assert.equal(m.at(-1).pipelineId, loose);
  assert.equal('slice' in m.at(-1), false, 'an ad-hoc member is no slice');
  const none = (list, x) => of(list, x).members.every((y) => !('slice' in y));
  assert.ok(none(on, plain));
  assert.ok(none(withSmallRuns(false, () => listRunGroups({ live })), f));
  assert.deepEqual(of(withSmallRuns(true, () => listRunGroups()), f).members[1].slice, { kind: null, state: 'starting', buildsOn: [] }, 'no live overlay');
});

test('fail closed: a marked feature with an owner-less requirement carries hold, flag on only; every other group has no such key', () => {
  const held = tenSliceFeature({ agreed: ['R-po-1', 'R-ops-1'] });
  const fine = tenSliceFeature({ agreed: ['R-po-1'] });
  const plain = tenSliceFeature({ marked: false, agreed: ['R-po-1', 'R-ops-1'] });
  const on = withSmallRuns(true, () => listRunGroups());
  const of = (list, f) => list.find((x) => x.id === f.id);
  assert.equal(of(on, held).hold, 'R-ops-1 is owned by no run and confirmed by no person');
  for (const f of [fine, plain]) assert.equal('hold' in of(on, f), false);
  assert.equal('hold' in of(withSmallRuns(false, () => listRunGroups()), held), false);
});

// ── Slice 7 (D1): an open confirmation is the feature's hold ─────────────────────────────────────────────────────
/** A marked (or not) 2-run feature, both runs done, whose R-ux-2 a person confirms (Design). */
function confirmFeature({ marked = true } = {}) {
  n += 1;
  const ids = [`p-conf-${n}-1`, `p-conf-${n}-2`];
  seedPipelineRow({ id: ids[0], title: 'Shape it', status: 'done' });
  if (marked) getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{"smallRuns":true}', ids[0]);
  const outline = { why: 'w', slices: [1, 2].map((i) => ({ id: `s${i}`, title: `Slice ${i}`, goal: 'g', inScope: [], outOfScope: [],
    acceptance: [], dependsOn: [], estimate: 'small', ...(i === 1 ? { requirements: ['R-po-1'] } : {}) })),
    agreed: [{ id: 'R-po-1', text: 'People see it' }, { id: 'R-ux-2', text: 'The words say who confirms' }], leftOut: [] };
  const { id } = createSliceFeature({ pipelineId: ids[0], projectDir: PROJECT, title: 'Confirm', outline, perspectives: [], workflowId: 'wf_shape' });
  getDb().prepare('UPDATE shape_features SET requirement_kinds = ? WHERE id = ?')
    .run(JSON.stringify({ 'R-ux-2': { kind: 'confirmed', role: 'design' } }), id);
  const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = 2').get(id).ticket_id;
  seedPipelineRow({ id: ids[1], title: 'Slice 2', status: 'done' });
  getDb().prepare('UPDATE scheduled_runs SET status = \'fired\', pipeline_id = ? WHERE id = ?').run(ids[1], t);
  return { id, ids };
}
const groupOf = (flag, id) => withSmallRuns(flag, () => listRunGroups()).find((g) => g.id === id);

test("s7: a waiting confirmation is the feature's hold, only for a marked feature with the flag on", () => {
  const f = confirmFeature();
  const plain = confirmFeature({ marked: false });
  assert.equal(groupOf(true, f.id).hold, 'Needs your confirmation: R-ux-2');
  assert.equal(shipHold(f.id), 'Needs your confirmation: R-ux-2');
  assert.equal('hold' in groupOf(true, plain.id), false, 'unmarked');
  assert.equal('hold' in groupOf(false, f.id), false, 'flag off');
});

test('s7: once marked Met the group has no hold', () => {
  const f = confirmFeature();
  assert.equal(groupOf(true, f.id).hold, 'Needs your confirmation: R-ux-2');
  setFeatureAcceptance(f.id, [{ id: 'R-ux-2', mark: 'met', role: 'design', by: 'ann', at: '2026-11-22T16:55:00.000Z' }]);
  assert.equal('hold' in groupOf(true, f.id), false);
  assert.equal(shipHold(f.id), null);
});

// ── Feature page slice 6 (R-arch-2): Verifier rounds count once in the feature's cost, with the flag on ───────────
const AT = (minute) => `2026-10-18T0${minute}:00:00Z`;
/** A Verifier round's ticket, as startVerifyCheck stores it: the request names the feature and the round. A halted
 *  round's retry is a new ticket with the same round, and the old ticket keeps its pipeline. `usd` null: no pipeline
 *  row. `pid` null: the ticket has not fired. */
function verifyTicket(featureId, { ticket, pid = null, round = 1, status = 'done', usd = null, at = AT(1) }) {
  if (pid && usd != null) seedPipelineRow({ id: pid, title: 'Verifier', status, totalCostUsd: usd });
  getDb().prepare(`INSERT INTO scheduled_runs (id, status, pipeline_id, request, run_at, created_at, updated_at, title)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Verifier')`).run(ticket, pid ? 'fired' : 'scheduled', pid,
    JSON.stringify({ workflowId: 'wf_shape_verify', shape: { verify: { featureId, round } } }), at, at, at);
}
/** A 5-run feature (run 1 is the planning run), every run done at $2. */
function fiveRunsAtTwo({ marked = true } = {}) {
  n += 1;
  const ids = [1, 2, 3, 4, 5].map((i) => `p-cost-${n}-${i}`);
  seedPipelineRow({ id: ids[0], title: 'Shape it', status: 'done', totalCostUsd: 2 });
  if (marked) getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{"smallRuns":true}', ids[0]);
  const outline = { why: 'w', slices: [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, title: `Slice ${i}`, goal: 'g', inScope: [],
    outOfScope: [], acceptance: [], dependsOn: [], estimate: 'small' })) };
  const { id } = createSliceFeature({ pipelineId: ids[0], projectDir: PROJECT, title: 'Five runs', outline, perspectives: [], workflowId: 'wf_shape' });
  for (const i of [2, 3, 4, 5]) {
    const t = getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(id, i).ticket_id;
    seedPipelineRow({ id: ids[i - 1], title: `Slice ${i}`, status: 'done', totalCostUsd: 2 });
    getDb().prepare('UPDATE scheduled_runs SET status = \'fired\', pipeline_id = ? WHERE id = ?').run(ids[i - 1], t);
  }
  return { id, ids };
}
/** The requirement's example: round 1 failed at $0.50, and its retry (round 1 again) done at $1. */
function elevenFifty() {
  getDb().exec('DELETE FROM pipelines');
  const f = fiveRunsAtTwo();
  const failed = `p-vfail-${n}`;
  const clean = `p-vdone-${n}`;
  // The later ticket is inserted first: run order is the ticket's created_at, not the row order.
  verifyTicket(f.id, { ticket: `t-vdone-${n}`, pid: clean, status: 'done', usd: 1, at: AT(2) });
  verifyTicket(f.id, { ticket: `t-vfail-${n}`, pid: failed, status: 'error', usd: 0.5, at: AT(1) });
  return { ...f, failed, clean };
}
const featureGroup = (id, flag = true) => withSmallRuns(flag, () => listRunGroups().find((x) => x.id === id));

test('R-arch-2: 5 runs at $2, a Verifier round at $1 and a failed round at $0.50 give $11.50, each pipeline once', () => {
  const f = elevenFifty();
  // Never counted: a round that has not fired, and another feature's round.
  verifyTicket(f.id, { ticket: `t-vwait-${n}`, round: 2, at: AT(3) });
  verifyTicket('feat_other', { ticket: `t-vother-${n}`, pid: `p-vother-${n}`, usd: 9 });
  const g = featureGroup(f.id);
  assert.equal(g.cost.usd, 11.5);
  assert.equal(Object.keys(g.cost.byPipeline).length, 7);
  assert.deepEqual(g.cost.byPipeline, { ...Object.fromEntries(f.ids.map((id) => [id, 2])), [f.failed]: 0.5, [f.clean]: 1 });
  assert.deepEqual(g.cost.checks, { [f.failed]: { round: 1, at: AT(1), status: 'error' }, [f.clean]: { round: 1, at: AT(2), status: 'done' } });
  assert.equal(g.members.length, 5, 'a Verifier round is no member of the group');
});

test('R-arch-2: the same group reads $11.50 on the Cost tab (model and table) and on the Runs list group row', async () => {
  const f = elevenFifty();
  const g = featureGroup(f.id);
  const { featureCostModel, renderFeatureCost } = await import('../ui/public/shape/feature-cost.mjs');
  const { groupCostUsd, renderRunsList } = await import('../ui/public/runs-list.mjs');
  const { JSDOM } = await import('jsdom');
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const model = featureCostModel(g, groupCostUsd(g));
  assert.equal(model.totalUsd, 11.5);
  const priced = model.rows.filter((r) => r.usd != null);
  assert.equal(priced.length, 7, 'five runs and two Verifier rounds');
  assert.equal(Math.round(priced.reduce((a, r) => a + r.usd, 0) * 100) / 100, 11.5);
  assert.match(renderFeatureCost(doc, model).querySelector('tfoot').textContent, /Total\s*\$11\.50/);
  const history = f.ids.map((id) => ({ id, projectKey: 'k', title: id, status: 'done', run: { status: 'done' } }));
  const groups = [{ id: g.id, groupKind: 'feature', title: g.title, smallRuns: true, cost: g.cost,
    members: g.members.map((m) => ({ position: m.position, title: m.title, pipelineId: m.pipelineId, kind: 'hist', run: { status: 'done' } })) }];
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, buildRunsModel({ history, groups, now: NOW })));
  assert.equal(host.querySelector(`.runs-item[data-row-key="chain:${g.id}"] > a.runs-row .runs-cost`).textContent, '$11.50');
});

test('R-arch-2: a re-planned feature\'s Verifier round counts once, in the newest feature\'s cost', () => {
  getDb().exec('DELETE FROM pipelines');
  const f = featureWithTwoDone();
  const db = getDb();
  db.prepare('UPDATE pipelines SET total_cost_usd = ? WHERE id = ?').run(1.5, f.s1);
  db.prepare('UPDATE pipelines SET total_cost_usd = ? WHERE id = ?').run(0.75, f.s2);
  const check = `p-vold-${n}`;
  verifyTicket(f.id, { ticket: `t-vold-${n}`, pid: check, usd: 0.5 });
  // A ticket whose pipeline row is gone adds nothing and no check.
  verifyTicket(f.id, { ticket: `t-vgone-${n}`, pid: `p-vgone-${n}`, round: 2, at: AT(2) });
  seedPipelineRow({ id: `p-replan-v-${n}`, title: 'Re-plan', status: 'done', totalCostUsd: 0.5 });
  const { id: next } = createSliceFeature({ pipelineId: `p-replan-v-${n}`, projectDir: PROJECT, title: 'Run tags',
    outline: OUTLINE, perspectives: [], workflowId: 'wf_shape', replaces: f.id });
  const g = featureGroup(next);
  assert.equal(g.cost.usd, 3.25, 'new planning run + the old round\'s two runs + its Verifier round');
  assert.equal(g.cost.byPipeline[check], 0.5);
  assert.deepEqual(Object.keys(g.cost.checks), [check]);
});

// Unchanged at checkpoint 217b540b4 (run-groups.mjs and stats.mjs match it on the tree this literal was captured on,
// with `node tools/test.mjs test/run-groups.test.mjs`).
test('unmarked feature: cost deep-equals the checkpoint 217b540b4 output, flag on or off, with no checks key', () => {
  getDb().exec('DELETE FROM pipelines');
  const f = featureWithTwoDone();
  const db = getDb();
  db.prepare('UPDATE pipelines SET total_cost_usd = ? WHERE id = ?').run(1.5, f.s1);
  db.prepare('UPDATE pipelines SET total_cost_usd = ? WHERE id = ?').run(0.75, f.s2);
  for (const flag of [true, false]) {
    assert.deepEqual(featureGroup(f.id, flag).cost, { usd: 2.25, byPipeline: { [f.s1]: 1.5, [f.s2]: 0.75 } }, `flag ${flag}`);
  }
});

// R-qa-1: with the flag off nothing changes for a small-runs feature either.
test('flag off: a small-runs feature\'s group cost leaves the Verifier rounds out and has no checks key, as at checkpoint 217b540b4', () => {
  const f = elevenFifty();
  assert.deepEqual(featureGroup(f.id, false).cost, { usd: 10, byPipeline: Object.fromEntries(f.ids.map((id) => [id, 2])) });
});

// ── Slice 9 (R-po-4, D12): an unacknowledged Verifier note is the feature's hold ───────────────────────────────
const NOTES_ONE = "Acknowledge the Verifier's note to ship";
/** The feature's one Verifier check on record: `state`, `texts` as its findings, `acked` note ids. */
function setNotedCheck(featureId, state, texts, acked = []) {
  const db = getDb();
  const outline = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(featureId).outline);
  const findings = texts.map((text, i) => ({ id: `note-${i + 1}`, text }));
  const check = { round: 1, ticketId: null, pipelineId: null, head: null, headSha: null, state,
    result: { held: ['R-po-1'], gaps: [], findings }, gapRuns: [], extra: 0, fixCycles: 1, at: '2026-11-27T10:00:00.000Z',
    ...(acked.length ? { acks: Object.fromEntries(acked.map((id) => [id, { by: 'ann', at: '2026-11-27T14:02:00.000Z' }])) } : {}) };
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...outline, verify: { checks: [check] } }), featureId);
}
const confirmUx = (featureId) => setFeatureAcceptance(featureId, [{ id: 'R-ux-2', mark: 'met', role: 'design', by: 'ann', at: '2026-11-27T09:00:00.000Z' }]);

test("s9: an unacknowledged note on a clean or accepted check is the group's hold, so it never reads ready", () => {
  const f = confirmFeature();
  confirmUx(f.id);
  for (const state of ['clean', 'accepted']) {
    setNotedCheck(f.id, state, ['the import test takes 40 s']);
    assert.equal(groupOf(true, f.id).hold, NOTES_ONE, state);
    assert.equal(shipHold(f.id), NOTES_ONE, state);
  }
  assert.equal('hold' in groupOf(false, f.id), false, 'flag off');
  setNotedCheck(f.id, 'clean', ['a', 'b']);
  assert.equal(groupOf(true, f.id).hold, "Acknowledge the Verifier's notes to ship");
  setNotedCheck(f.id, 'clean', ['a', 'b'], ['note-1']);
  assert.equal(groupOf(true, f.id).hold, NOTES_ONE, 'one still open');
  setNotedCheck(f.id, 'clean', ['a', 'b'], ['note-1', 'note-2']);
  assert.equal('hold' in groupOf(true, f.id), false, 'all acknowledged');
});

test('s9: the confirmation hold comes first, and a gaps or verifying check holds nothing for its notes', () => {
  const f = confirmFeature();
  setNotedCheck(f.id, 'clean', ['a']);
  assert.equal(groupOf(true, f.id).hold, 'Needs your confirmation: R-ux-2');
  confirmUx(f.id);
  assert.equal(groupOf(true, f.id).hold, NOTES_ONE);
  for (const state of ['gaps', 'verifying']) {
    setNotedCheck(f.id, state, ['a']);
    assert.equal(shipHold(f.id), null, state);
  }
});

test("s9: an unmarked feature's group is the checkpoint's, with or without a noted check on record", () => {
  const plain = confirmFeature({ marked: false });
  const before = groupOf(true, plain.id);
  assert.equal('hold' in before, false);
  setNotedCheck(plain.id, 'clean', ['a']);
  assert.deepEqual(groupOf(true, plain.id), before);
});

// ── Slice 11 (R-ux-4): Verifier rounds show inside their feature's group as check rows ──────────────────────────────
/** The feature's stored Verifier checks. */
function setChecks(featureId, checks) {
  const db = getDb();
  const outline = JSON.parse(db.prepare('SELECT outline FROM shape_features WHERE id = ?').get(featureId).outline);
  db.prepare('UPDATE shape_features SET outline = ? WHERE id = ?').run(JSON.stringify({ ...outline, verify: { checks } }), featureId);
}
/** One stored check, as startVerifyCheck and recordVerifyResult write it. `gaps` null: no result on record. */
const storedCheck = ({ round, ticketId = null, pipelineId = null, state = 'verifying', gaps = null }) => ({ round, ticketId, pipelineId,
  head: null, headSha: null, state, gapRuns: [], extra: 0, fixCycles: 1, at: AT(0),
  result: gaps === null ? null : { held: [], gaps: Array.from({ length: gaps }, (_, i) => ({ id: `R-po-${i + 1}`, why: 'missing', title: `Close R-po-${i + 1}` })) } });
/** A Verifier round of feature `f`: its ticket and its pipeline row. */
function verifierRound(f, { round, status, usd = 0.5, at = AT(round) }) {
  const pipelineId = `p-s11v-${n}-${round}`;
  const ticketId = `t-s11v-${n}-${round}`;
  verifyTicket(f.id, { ticket: ticketId, pid: pipelineId, round, status, usd, at });
  return { pipelineId, ticketId, round, at };
}
/** The server's group as app.js hands it to the list (runsGroupItem): its members, and each check as a `check` item. */
const listItem = (g) => ({ id: g.id, groupKind: 'feature', title: g.title, cost: g.cost, ...(g.smallRuns ? { smallRuns: true } : {}),
  members: g.members.map((m) => ({ position: m.position, title: m.title, pipelineId: m.pipelineId, kind: 'hist',
    href: `#history/k/${m.pipelineId}`, run: { status: m.status } })),
  ...(g.checks ? { checks: g.checks.map((c) => ({ kind: 'check', round: c.round, state: c.state, gaps: c.gaps, pipelineId: c.pipelineId,
    runId: '', href: `#history/k/${c.pipelineId}`, cost: g.cost.byPipeline[c.pipelineId] })) } : {}) });
/** The Runs list of one group, open, with a History row for every pipeline the group costs (its Verifier runs too). */
function drawGroup(g) {
  const history = Object.keys(g.cost.byPipeline).map((id) => {
    const status = getDb().prepare('SELECT status FROM pipelines WHERE id = ?').get(id).status;
    return { id, projectKey: 'k', title: id, status, run: { status } };
  });
  const model = buildRunsModel({ history, groups: [listItem(g)], toggled: new Map([[`chain:${g.id}`, true]]), now: NOW });
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const host = doc.createElement('div');
  host.append(...renderRunsList(doc, model));
  const item = host.querySelector(`.runs-item[data-row-key="chain:${g.id}"]`);
  const row = item.querySelector(':scope > a.runs-row');
  return { model, host, item, row,
    sub: () => row.querySelector('.runs-row-sub').textContent,
    inside: () => [...item.querySelectorAll(':scope > .runs-members > .runs-item')].map((it) => (it.dataset.level === 'check'
      ? it.querySelector(':scope > a.runs-row').dataset.line : it.querySelector(':scope > a.runs-row > .runs-row-title').textContent)),
    alone: (pid) => host.querySelectorAll(`.runs-item[data-level="top"] > a.runs-row[data-pipeline-id="${pid}"]`).length,
    ready: () => (item.textContent.match(/Ready to ship/g) || []).length,
    inNeeds: () => !!model.sections.find((x) => x.id === 'needs')?.rows.some((r) => r.groupId === g.id) };
}
const MEMBER_TITLES = [1, 2, 3, 4, 5].map((i) => `${i} · Slice ${i}`);

test("s11: the group lists runs 1–5, then 'Verifier · round 2 · 1 gap', and the Runs list has no standalone row for that round", () => {
  getDb().exec('DELETE FROM pipelines');
  const f = fiveRunsAtTwo();
  const v = verifierRound(f, { round: 2, status: 'error' });
  setChecks(f.id, [storedCheck({ ...v, state: 'gaps', gaps: 1 })]);
  const g = featureGroup(f.id);
  assert.equal(g.members.length, 5, 'a Verifier round is never a member');
  assert.deepEqual(g.checks, [{ round: 2, pipelineId: v.pipelineId, at: v.at, state: 'failed', gaps: 1 }]);
  const d = drawGroup(g);
  assert.deepEqual(d.inside(), [...MEMBER_TITLES, 'Verifier · round 2 · 1 gap']);
  assert.equal(d.alone(v.pipelineId), 0, 'no standalone row for the round');
  assert.equal(d.host.querySelectorAll('.runs-item[data-level="top"]').length, 1, 'the group is the only top-level row');
});

test("s11: a failed round shows on the group row, and 'Ready to ship' occurs once in the group", () => {
  getDb().exec('DELETE FROM pipelines');
  const f = fiveRunsAtTwo();
  const v2 = verifierRound(f, { round: 2, status: 'error' });
  setChecks(f.id, [storedCheck({ ...v2, state: 'gaps', gaps: 1 })]);
  const failed = drawGroup(featureGroup(f.id));
  assert.equal(failed.sub(), 'Verifier round 2 failed · 1 gap');
  assert.equal(failed.row.dataset.state, 'failed');
  assert.ok(failed.inNeeds(), 'a failed round sits in Needs you');
  assert.equal(failed.ready(), 0);
  // The same feature once round 3 passed.
  getDb().prepare("UPDATE pipelines SET status = 'done' WHERE id = ?").run(v2.pipelineId);
  const v3 = verifierRound(f, { round: 3, status: 'done' });
  setChecks(f.id, [storedCheck({ ...v2, state: 'gaps', gaps: 1 }), storedCheck({ ...v3, state: 'clean', gaps: 0 })]);
  const passed = drawGroup(featureGroup(f.id));
  assert.deepEqual(passed.inside().slice(5), ['Verifier · round 2 · 1 gap', 'Verifier · round 3 · passed']);
  assert.equal(passed.ready(), 1, 'said once in the whole group');
  assert.match(passed.row.textContent, /Ready to ship/, 'and on the group row');
});

test('s11: a checking, paused or asking newest round holds the group row', () => {
  getDb().exec('DELETE FROM pipelines');
  const f = fiveRunsAtTwo();
  const v = verifierRound(f, { round: 3, status: 'running' });
  setChecks(f.id, [storedCheck({ round: 3, ticketId: v.ticketId })]);   // before its settle the check names only its ticket
  const stop = verifyStop({ gaps: [{ id: 'R-po-1', why: 'missing' }], round: 3 });
  const overlays = {
    'Verifier round 3 checking': null,
    'Verifier round 3 paused': liveSliceFrom({ runId: 'r-v', status: 'paused' }),
    'Verifier round 3 needs you · 1 gap': liveSliceFrom({ runId: 'r-v', status: 'running', pendingQuestion: { id: 'verify-3', kind: 'gate', stop } }),
  };
  for (const [line, overlay] of Object.entries(overlays)) {
    const live = (pid) => (pid === v.pipelineId ? overlay : null);
    const g = withSmallRuns(true, () => listRunGroups({ live })).find((x) => x.id === f.id);
    const d = drawGroup(g);
    assert.equal(d.sub(), line);
    assert.equal(d.ready(), 0, line);
    assert.equal(d.inNeeds(), line.includes('needs you'), `${line}: Needs you`);
  }
});

test('s11: each round reads its state from the live run, then the run status, then the stored check', () => {
  getDb().exec('DELETE FROM pipelines');
  const f = fiveRunsAtTwo();
  const v = verifierRound(f, { round: 2, status: 'done' });
  const asking = (gaps) => liveSliceFrom({ runId: 'r-v', status: 'running', pendingQuestion: { id: 'verify-2', kind: 'gate',
    stop: verifyStop({ gaps: Array.from({ length: gaps }, (_, i) => ({ id: `R-po-${i + 1}`, why: 'missing' })), round: 2 }) } });
  const paused = liveSliceFrom({ runId: 'r-v', status: 'paused' });
  // [pipeline status, stored check state, stored gap count, live overlay, expected state, expected gaps]
  const table = [
    ['done', 'gaps', 2, null, 'gaps', 2],
    ['done', 'clean', 0, null, 'passed', 0],
    ['done', 'accepted', 1, null, 'passed', 1],
    ['running', 'verifying', null, null, 'verifying', null],
    ['done', 'verifying', null, null, 'verifying', null],
    ['paused', 'verifying', null, null, 'paused', null],
    ['interrupted', 'verifying', null, null, 'paused', null],
    ['running', 'verifying', null, paused, 'paused', null],
    ['error', 'verifying', null, null, 'failed', null],
    ['failed', 'verifying', null, null, 'failed', null],
    ['error', 'gaps', 1, null, 'failed', 1],
    ['stopped', 'verifying', null, null, 'stopped', null],
    ['aborted', 'verifying', null, null, 'stopped', null],
    ['running', 'verifying', null, asking(2), 'asking', 2],
  ];
  for (const [status, state, gaps, overlay, want, count] of table) {
    getDb().prepare('UPDATE pipelines SET status = ? WHERE id = ?').run(status, v.pipelineId);
    setChecks(f.id, [storedCheck({ ...v, state, gaps })]);
    const live = (pid) => (pid === v.pipelineId ? overlay : null);
    const g = withSmallRuns(true, () => listRunGroups({ live })).find((x) => x.id === f.id);
    assert.deepEqual(g.checks, [{ round: 2, pipelineId: v.pipelineId, at: v.at, state: want, gaps: count }],
      `${status} / ${state} / ${overlay ? overlay.status : 'no live run'}`);
  }
  // A malformed outline reads as no stored check: the run status alone decides, and nothing throws.
  getDb().prepare("UPDATE pipelines SET status = 'error' WHERE id = ?").run(v.pipelineId);
  setChecks(f.id, 'nope');
  assert.deepEqual(featureGroup(f.id).checks, [{ round: 2, pipelineId: v.pipelineId, at: v.at, state: 'failed', gaps: null }]);
});

test('s11: a halted round retried as a fresh ticket lists both rounds, oldest first, and neither stands alone', () => {
  const f = elevenFifty();
  // The halted check was dropped for the retry: only the retry's check is on record.
  setChecks(f.id, [storedCheck({ round: 1, ticketId: `t-vdone-${n}`, state: 'clean', gaps: 0 })]);
  const g = featureGroup(f.id);
  assert.deepEqual(g.checks, [
    { round: 1, pipelineId: f.failed, at: AT(1), state: 'failed', gaps: null },
    { round: 1, pipelineId: f.clean, at: AT(2), state: 'passed', gaps: 0 }]);
  const d = drawGroup(g);
  assert.deepEqual(d.inside(), [...MEMBER_TITLES, 'Verifier · round 1 · failed', 'Verifier · round 1 · passed']);
  assert.deepEqual([d.alone(f.failed), d.alone(f.clean)], [0, 0]);
});

test("s11: a re-planned feature's group reads an earlier feature's round from that feature's stored check", () => {
  getDb().exec('DELETE FROM pipelines');
  const f = fiveRunsAtTwo();
  const v = verifierRound(f, { round: 2, status: 'done' });
  setChecks(f.id, [storedCheck({ ...v, state: 'gaps', gaps: 2 })]);
  const origin = `p-s11replan-${n}`;
  seedPipelineRow({ id: origin, title: 'Re-plan', status: 'done', totalCostUsd: 0.5 });
  getDb().prepare('UPDATE pipelines SET shape_stats = ? WHERE id = ?').run('{"smallRuns":true}', origin);
  const { id: next } = createSliceFeature({ pipelineId: origin, projectDir: PROJECT, title: 'Five runs', outline: OUTLINE,
    perspectives: [], workflowId: 'wf_shape', replaces: f.id });
  assert.deepEqual(featureGroup(next).checks, [{ round: 2, pipelineId: v.pipelineId, at: v.at, state: 'gaps', gaps: 2 }]);
});

// The literal was captured by running this seed through listRunGroups in a `git archive 217b540b4` copy (flag on and
// off gave the same group); only the random feature and ticket ids are read back from the database.
test("s11: an unmarked feature's group (members, planning, cost, keys) deep-equals the checkpoint 217b540b4 output, flag on or off", () => {
  const ids = [1, 2, 3].map((i) => `p-um-${i}`);
  seedPipelineRow({ id: ids[0], title: 'Shape it', status: 'done', totalCostUsd: 2 });
  const outline = { why: 'w', slices: [1, 2, 3, 4, 5].map((i) => ({ id: `s${i}`, title: `Slice ${i}`, goal: 'g', inScope: [],
    outOfScope: [], acceptance: [], dependsOn: [], estimate: 'small' })) };
  const { id } = createSliceFeature({ pipelineId: ids[0], projectDir: PROJECT, title: 'Plain five', outline, perspectives: [], workflowId: 'wf_shape' });
  const ticketId = (i) => getDb().prepare('SELECT ticket_id FROM shape_feature_slices WHERE feature_id = ? AND idx = ?').get(id, i).ticket_id;
  for (const [i, status, usd] of [[2, 'done', 1.5], [3, 'running', 0.75]]) {
    seedPipelineRow({ id: ids[i - 1], title: `Slice ${i}`, status, totalCostUsd: usd });
    getDb().prepare("UPDATE scheduled_runs SET status = 'fired', pipeline_id = ? WHERE id = ?").run(ids[i - 1], ticketId(i));
  }
  seedPipelineRow({ id: 'p-um-loose', title: 'Loose fix', status: 'done', totalCostUsd: 0.25 });
  addToGroup({ groupId: id, pipelineId: 'p-um-loose' });
  const row = (position, title, pipelineId, ticket, status, more = {}) => ({ position, title, pipelineId, ticketId: ticket, status,
    pr: null, ticket: null, adhoc: false, after: null, ...more });
  const waiting = (position, after) => row(position, `Slice ${position}`, null, ticketId(position), null,
    { ticket: { id: ticketId(position), status: 'scheduled', runAt: null, after: true, held: false }, after });
  const expected = { id, kind: 'feature', title: 'Plain five', projectKey: null, planning: null,
    members: [row(1, 'Slice 1', ids[0], null, 'done'), row(2, 'Slice 2', ids[1], ticketId(2), 'done'),
      row(3, 'Slice 3', ids[2], ticketId(3), 'running'), waiting(4, 3), waiting(5, 4),
      row(6, 'Loose fix', 'p-um-loose', null, 'done', { adhoc: true })],
    cost: { usd: 4.5, byPipeline: { [ids[0]]: 2, [ids[1]]: 1.5, [ids[2]]: 0.75, 'p-um-loose': 0.25 } } };
  for (const flag of [true, false]) {
    const g = featureGroup(id, flag);
    assert.deepEqual(g, expected, `flag ${flag}`);
    assert.equal('checks' in g, false, `flag ${flag}`);
  }
});

test('s11: the $11.50 cost case is unchanged, and its rounds are check rows, not members', () => {
  const f = elevenFifty();
  const g = featureGroup(f.id);
  assert.equal(g.cost.usd, 11.5);
  assert.equal(Object.keys(g.cost.byPipeline).length, 7);
  assert.deepEqual(g.cost.checks, { [f.failed]: { round: 1, at: AT(1), status: 'error' }, [f.clean]: { round: 1, at: AT(2), status: 'done' } });
  assert.equal(g.members.length, 5);
  assert.equal(g.checks?.length, 2);
});

test('s11: flag off: no checks key, and the Verifier run stays a standalone row', () => {
  const f = elevenFifty();
  const g = featureGroup(f.id, false);
  assert.equal('checks' in g, false);
  // Flag off the cost leaves the rounds out; the failed round is added here only so drawGroup gives it a History row.
  const d = drawGroup({ ...g, cost: { ...g.cost, byPipeline: { ...g.cost.byPipeline, [f.failed]: 0.5 } } });
  assert.equal(d.alone(f.failed), 1);
  assert.equal(d.item.querySelector('.runs-item[data-level="check"]'), null);
});
