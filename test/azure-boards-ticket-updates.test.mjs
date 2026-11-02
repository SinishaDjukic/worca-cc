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
