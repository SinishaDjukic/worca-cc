// test/jira-source-ticket-updates.test.mjs — jira-source's Ticket updates (plans/ticket-updates-design.md D1, D4, D10, D11, §7)
// against a fake Jira over real HTTP, Cloud and Data Center: the capability, project names, the old setting, a project's
// statuses with their categories, and (Task 10) reportResult with a move.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import createTaskSource, { isCancelledName, categoryOf } from '../plugins/jira-source/connector/index.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
after(async () => { for (const j of open) await j.close(); });
const BOTH = ['cloud', 'datacenter'];
async function site(o = {}) {
  const jira = await startFakeJira(o);
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const logs = [];
  const ctx = { apiVersion: 5, profile: 'acme', log: (level, msg) => { logs.push(`${level} ${msg}`); },
    config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: 'tok', transitionOnComplete: o.done ?? '' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, logs, src: createTaskSource(ctx) };
}
const st = (id, name, key) => ({ id, name, statusCategory: { key } });
const S = { open: st('1', 'Open', 'new'), prog: st('3', 'In Progress', 'indeterminate'), review: st('4', 'In Review', 'indeterminate'),
  done: st('10001', 'Done', 'done'), closed: st('6', 'Closed', 'done'), resolved: st('10012', 'Resolved', 'done'),
  wontdo: st('10010', "Won't Do", 'done'), wontfix: st('10011', 'Won’t Fix', 'done'), dup: st('10013', 'Duplicate', 'done'),
  notplanned: st('10014', 'Not planned', 'done') };
const STATUSES = { SHOP: [[S.open, S.prog, S.done, S.wontdo], [S.open, S.resolved, S.wontfix, S.dup, S.notplanned]] };

test('capabilities: ticketUpdates beside export; write-back still follows the run\'s input', async () => {
  const { src } = await site();
  assert.deepEqual(src.capabilities({ inputs: { writeBack: 'yes' } }), { writeBack: true, incrementalSync: false, export: true, ticketUpdates: true });
  assert.equal(src.capabilities({}).writeBack, false);
});

test('listProjects: each item gains name, the project name alone (Cloud and Data Center)', async () => {
  for (const deployment of BOTH) {
    const { src } = await site({ deployment });
    assert.deepEqual(await src.listProjects(), [{ value: 'SHOP', label: 'Shop web (SHOP)', name: 'Shop web' }, { value: 'OPS', label: 'Operations (OPS)', name: 'Operations' }], deployment);
  }
});

test('legacyMove (D4): the old setting\'s key and what it means', async () => {
  assert.deepEqual((await site({ done: ' Resolve ' })).src.legacyMove(), { field: 'transitionOnComplete', target: { typed: 'Resolve' } });
  assert.deepEqual((await site({ done: '' })).src.legacyMove(), { field: 'transitionOnComplete', target: null });
});

test('listStatuses: every status of the project once, in Jira\'s order, its category by D1 (Cloud and Data Center)', async () => {
  for (const deployment of BOTH) {
    const { src, jira } = await site({ deployment, projectStatuses: STATUSES });
    assert.deepEqual(await src.listStatuses({ project: 'SHOP' }), [
      { value: '1', label: 'Open', category: 'todo' }, { value: '3', label: 'In Progress', category: 'in_progress' },
      { value: '10001', label: 'Done', category: 'done' }, { value: '10010', label: "Won't Do", category: 'cancelled' },
      { value: '10012', label: 'Resolved', category: 'done' }, { value: '10011', label: 'Won’t Fix', category: 'cancelled' },
      { value: '10013', label: 'Duplicate', category: 'cancelled' }, { value: '10014', label: 'Not planned', category: 'cancelled' }], deployment);
    assert.ok(jira.requests.some((r) => r.path === '/rest/api/2/project/SHOP/statuses'));
    // S3: a refusal carries Jira's own words (exportOp), never jira-api's status and REST path, which reachReason would hide
    await assert.rejects(src.listStatuses({ project: 'NOPE' }), (e) => e.kind === 'plugin'
      && e.message === "Jira refused the request: No project could be found with key 'NOPE'." && !/rest\/api/.test(e.message));
    await assert.rejects(src.listStatuses({}), (e) => e.kind === 'plugin' && e.message === 'a project is required');
    // S9: a project key is never a path: no request leaves for "..", ".", a slash or an over-long key
    const before = jira.requests.length;
    for (const project of ['..', '.', 'A/B', 'A\\B', 'X'.repeat(101)]) {
      await assert.rejects(src.listStatuses({ project }), (e) => e.kind === 'plugin' && e.message === 'a project key cannot be a path', project);
    }
    assert.equal(jira.requests.length, before, 'no request reached Jira');
  }
});

test('D1: the negative endings, case-insensitive, either apostrophe; Jira\'s three categories', () => {
  for (const n of ["Won't Do", 'won’t do', "WON'T FIX", 'Rejected', 'Duplicate', 'Cancelled', 'Canceled', 'Declined', 'Invalid', 'Obsolete', 'Abandoned', 'Not planned', ' not planned ']) {
    assert.equal(isCancelledName(n), true, n);
  }
  for (const n of ['Done', 'Closed', 'Resolved', 'Won it', 'Duplicated work', 'Cancel']) assert.equal(isCancelledName(n), false, n);
  assert.equal(categoryOf(S.open), 'todo');
  assert.equal(categoryOf(S.prog), 'in_progress');
  assert.equal(categoryOf(S.done), 'done');
  assert.equal(categoryOf(S.wontdo), 'cancelled');
  assert.equal(categoryOf(st('9', 'Odd', 'undefined')), 'todo', 'no category: to do');
});
