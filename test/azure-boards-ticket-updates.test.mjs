// test/azure-boards-ticket-updates.test.mjs — azure-boards-source's Ticket updates (plans/ticket-updates-design.md D1, D4, D6,
// D11, §3; plans/ticket-updates-pr2-plan.md decisions 3 and 4) against a fake Azure DevOps: the capability, the old setting,
// a project's statuses with their categories, the ticket's project, and (Task 3) reportResult with a move.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { categoryOf } from '../plugins/azure-boards-source/connector/index.mjs';
import { fakeAzureBoards } from './helpers/fake-azure-boards.mjs';

function site(o = {}) {
  const ado = fakeAzureBoards(o);
  const logs = [];
  const ctx = { apiVersion: 5, profile: 'work', log: (level, msg) => { logs.push(`${level} ${msg}`); },
    config: { organization: 'acme', token: 'pat', closeOnComplete: o.close ?? 'no' }, state: { get: async () => null, set: async () => {} } };
  return { ado, logs, src: createTaskSource(ctx, { fetch: ado.fetch }) };
}

test('capabilities: ticketUpdates; write-back as before', () => {
  assert.deepEqual(site().src.capabilities(), { writeBack: true, incrementalSync: false, ticketUpdates: true });
});

test('legacyMove (D4): closeOnComplete yes is Any Done status, no or unset is nothing', () => {
  assert.deepEqual(site({ close: 'yes' }).src.legacyMove(), { field: 'closeOnComplete', target: { category: 'done' } });
  assert.deepEqual(site({ close: 'no' }).src.legacyMove(), { field: 'closeOnComplete', target: null });
  assert.deepEqual(site({ close: '' }).src.legacyMove(), { field: 'closeOnComplete', target: null });
});

test("D1: Azure's state categories onto Worca's four; Resolved is in progress, Removed cancelled", () => {
  assert.deepEqual(['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed', 'Odd', undefined].map((category) => categoryOf({ category })),
    ['todo', 'in_progress', 'in_progress', 'done', 'cancelled', 'todo', 'todo']);
});

test("listStatuses: every state of the project's visible types once, in Azure's order, by name, with its category", async () => {
  const { src, ado } = site();
  assert.deepEqual(await src.listStatuses({ project: 'Shop' }), [
    { value: 'New', label: 'New', category: 'todo' }, { value: 'Active', label: 'Active', category: 'in_progress' },
    { value: 'Resolved', label: 'Resolved', category: 'in_progress' }, { value: 'Closed', label: 'Closed', category: 'done' },
    { value: 'Removed', label: 'Removed', category: 'cancelled' }, { value: 'Draft', label: 'Draft', category: 'todo' },
    { value: 'Shipped', label: 'Shipped', category: 'done' }, { value: 'Proposed', label: 'Proposed', category: 'todo' },
    { value: 'Dropped', label: 'Dropped', category: 'cancelled' }]);
  assert.deepEqual(ado.requests.map((r) => `${r.method} ${r.path}?api-version=${r.query['api-version']}`).sort(), [
    'GET /acme/Shop/_apis/wit/workitemtypecategories?api-version=7.1', 'GET /acme/Shop/_apis/wit/workitemtypes?api-version=7.1']);
  assert.equal((await src.listStatuses({ project: 'Shop' })).some((s) => s.value === 'Requested' || s.value === 'Parked'), false,
    'a hidden type (Code Review Request) and a disabled one add nothing');
});

test("listStatuses: a refusal says Azure's own words, not the REST URL; a bad token stays auth; a project is never a path", async () => {
  const { src, ado } = site();
  await assert.rejects(src.listStatuses({ project: 'Nope' }), (e) => e.kind === 'plugin'
    && e.message === "Azure Boards refused the request: VS800075: The project with id 'Nope' does not exist, or you do not have permission to access it."
    && !/https?:|_apis/.test(e.message));
  await assert.rejects(site({ token: 'other' }).src.listStatuses({ project: 'Shop' }), (e) => e.kind === 'auth');
  await assert.rejects(src.listStatuses({}), (e) => e.kind === 'plugin' && e.message === 'a project is required');
  const before = ado.requests.length;
  for (const project of ['..', '.', 'A/B', 'A\\B', 'A?B', 'A#B', 'X'.repeat(101)]) {
    await assert.rejects(src.listStatuses({ project }), (e) => e.kind === 'plugin' && e.message === 'a project name cannot be a path', project);
  }
  assert.equal(ado.requests.length, before, 'no request reached Azure DevOps');
});

test("getTask: meta.project is the work item's own project (System.TeamProject), as listProjects names it (D6)", async () => {
  const { src } = site({ items: [{ id: 12, project: 'Shop', type: 'Bug', state: 'Active' }] });
  const t = await src.getTask('acme/shop#12');
  assert.deepEqual(t.meta, { organization: 'acme', project: 'Shop', id: 12, type: 'Bug' });
  assert.deepEqual(await src.listProjects(), [{ value: 'Shop', label: 'Shop' }], 'listProjects: no `name`, the name is the key');
});

// ---- reportResult with a move (Task 3) ----
const RESULT = { status: 'completed', summary: 'done', links: [{ title: 'PR', url: 'https://dev.azure.com/acme/Shop/_git/api/pullrequest/5' }] };
const HTML = '<p>done</p><ul><li><a href="https://dev.azure.com/acme/Shop/_git/api/pullrequest/5">PR</a></li></ul>';
/** One report against a fresh fake holding work item 12 (a `type` in `state`). */
async function report(move, { type = 'Bug', state = 'Active', ...more } = {}) {
  const s = site({ items: [{ id: 12, project: 'Shop', type, state }], ...more });
  const out = await s.src.reportResult('acme/Shop#12', { ...RESULT, move });
  const w = s.ado.items.get(12);
  return { out, comment: w.comments.at(-1), state: w.state, calls: s.ado.requests.map((r) => r.method),
    patches: s.ado.requests.filter((r) => r.method === 'PATCH').map((r) => r.body), ...s };
}

test("Any Done status: the type's Completed state, moved first, then one comment ending with the line", async () => {
  const r = await report({ category: 'done' });
  assert.deepEqual(r.patches, [[{ op: 'add', path: '/fields/System.State', value: 'Closed' }]]);
  assert.deepEqual(r.out, { commented: true, moved: { from: 'Active', to: 'Closed' }, note: 'Moved to Closed.' });
  assert.equal(r.comment, `${HTML}<p>Moved to Closed.</p>`);
  assert.deepEqual(r.calls, ['GET', 'GET', 'PATCH', 'POST'], 'read the item, its type\'s states, move, then comment');
  assert.equal((await report({ category: 'done' }, { state: 'Resolved' })).out.note, 'Moved to Closed.', 'D1: Resolved is not done yet');
  assert.equal((await report({ category: 'done' }, { type: 'Shipping Note', state: 'Draft' })).out.note, 'Moved to Shipped.');
});

test('Any Done status never picks Removed; a ticket already Completed or Removed stays; a type without a Done status says so', async () => {
  for (const [type, state] of [['Bug', 'Closed'], ['Task', 'Removed']]) {
    const r = await report({ category: 'done' }, { type, state });
    assert.deepEqual([r.out.note, r.patches.length, r.state], [`Already in ${state}.`, 0, state], state);
    assert.equal(r.comment, `${HTML}<p>Already in ${state}.</p>`);
  }
  const idea = await report({ category: 'done' }, { type: 'Idea', state: 'Proposed' });
  assert.deepEqual([idea.out.note, idea.patches.length], ["Not moved: Shop's Idea type has no Done status.", 0]);
});

test("a status move: by name; already there; this type lacks it; gone from the project; Removed may be picked by name", async () => {
  const byName = await report({ status: 'Resolved', name: 'Resolved' });
  assert.deepEqual([byName.out.note, byName.state], ['Moved to Resolved.', 'Resolved']);
  assert.equal((await report({ status: 'active', name: 'Active' })).out.note, 'Already in Active.');
  const lacks = await report({ status: 'Resolved', name: 'Resolved' }, { type: 'Task' });
  assert.deepEqual([lacks.out.note, lacks.patches.length], ["Not moved: Shop's Task type has no status named Resolved.", 0],
    'decision 3: no fallback to another state of the same category');
  const gone = await report({ status: 'Released', name: 'Released' });
  assert.equal(gone.out.note, 'Not moved: Shop has no status named Released any more.');
  assert.equal((await report({ status: 'Removed', name: 'Removed' }, { type: 'Task' })).out.note, 'Moved to Removed.');
});

test("a 4xx refusal of the move is a line with Azure's reason and the comment is posted; 401, 429 and 5xx throw", async () => {
  const r = await report({ category: 'done' }, { refusePatch: { status: 400, body: { message: 'TF401320: Rule Error for field Reason.' } } });
  assert.deepEqual([r.out.moved, r.out.note], [null, 'Not moved: Azure Boards refused the move to Closed: TF401320: Rule Error for field Reason.']);
  assert.equal(r.comment, `${HTML}<p>Not moved: Azure Boards refused the move to Closed: TF401320: Rule Error for field Reason.</p>`);
  const silent = await report({ category: 'done' }, { refusePatch: { status: 403, body: {} } });
  assert.equal(silent.out.note, 'Not moved: Azure Boards refused the move to Closed: Azure Boards gave no reason.');
  for (const [status, kind] of [[401, 'auth'], [429, 'rate-limit'], [500, 'plugin']]) {
    const s = site({ items: [{ id: 12, project: 'Shop', type: 'Bug', state: 'Active' }], refusePatch: { status, body: { message: 'no' } } });
    await assert.rejects(s.src.reportResult('acme/Shop#12', { ...RESULT, move: { category: 'done' } }), (e) => e.kind === kind, String(status));
    assert.deepEqual(s.ado.items.get(12).comments, [], `${status}: no comment, so the write-back fails and can be retried`);
  }
});

test("Don't move: no read, no move, no line; a run that did not finish passes none and only comments", async () => {
  const r = await report({ none: true });
  assert.deepEqual([r.calls, r.out, r.comment], [['POST'], { commented: true, moved: null, note: '' }, HTML]);
});

test('without a move: exactly the old behaviour (comment first, then closeOnComplete)', async () => {
  const s = site({ close: 'yes', items: [{ id: 12, project: 'Shop', type: 'Bug', state: 'Active' }] });
  assert.equal(await s.src.reportResult('acme/Shop#12', RESULT), undefined);
  assert.deepEqual(s.ado.requests.map((r) => r.method), ['POST', 'GET', 'GET', 'PATCH']);
  assert.deepEqual([s.ado.items.get(12).comments, s.ado.items.get(12).state], [[HTML], 'Closed']);
});
