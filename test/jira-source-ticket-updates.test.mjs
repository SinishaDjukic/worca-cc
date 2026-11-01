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

// ---- reportResult with a move (§7, D10, D11) ----
const tr = (id, name, to, fields) => ({ id, name, to, ...(fields ? { fields } : {}) });
const RES = (...names) => ({ resolution: { required: true, name: 'Resolution', allowedValues: names.map((n, i) => ({ id: String(i + 1), name: n })) } });
const RESULT = { status: 'completed', summary: 'done', links: [{ title: 'Pull request', url: 'https://github.com/acme/shop/pull/5' }], inputs: { writeBack: 'yes' } };
const LINK = '* [Pull request|https://github.com/acme/shop/pull/5]';
/** One report against a fresh fake Jira holding SHOP-12 in `from` with `transitions`. */
async function report(move, { from = S.prog, transitions = [], deployment = 'cloud', ...more } = {}) {
  const { jira, src, logs } = await site({ deployment, projectStatuses: STATUSES, seed: [{ key: 'SHOP-12', project: 'SHOP', status: from, transitions }], ...more });
  const out = await src.reportResult('SHOP-12', { ...RESULT, move });
  const i = jira.issues.get('SHOP-12');
  return { out, comment: i.comments.at(-1), posts: jira.requests.filter((r) => r.method === 'POST' && /\/transitions$/.test(r.path)),
    reads: jira.requests.filter((r) => r.method === 'GET' && /\/transitions$/.test(r.path)), status: i.fields.status, jira, logs };
}

test('Any Done status: prefers Done, then Closed, Resolved, Complete, Completed, then the rest in Jira\'s order; the line is last', async () => {
  for (const deployment of BOTH) {
    const r = await report({ category: 'done' }, { deployment,
      transitions: [tr('51', 'Resolve', S.resolved), tr('61', 'Close', S.closed), tr('71', 'Finish', S.done), tr('81', "Won't do", S.wontdo)] });
    assert.deepEqual(r.posts.map((p) => p.body), [{ transition: { id: '71' } }], deployment);
    assert.deepEqual(r.out, { commented: true, transitioned: true, moved: { from: 'In Progress', to: 'Done' }, note: 'Moved to Done.' }, deployment);
    assert.equal(r.comment, `done\n\n${LINK}\n\nMoved to Done.`, `${deployment}: summary, links, then the outcome line`);
    assert.equal(r.reads[0].query.expand, 'transitions.fields');
  }
  const closed = await report({ category: 'done' }, { transitions: [tr('51', 'Resolve', S.resolved), tr('61', 'Close', S.closed)] });
  assert.equal(closed.out.note, 'Moved to Closed.');
  const other = await report({ category: 'done' }, { transitions: [tr('91', 'Ship', st('20', 'Shipped', 'done')), tr('92', 'Archive', st('21', 'Archived', 'done'))] });
  assert.equal(other.out.note, 'Moved to Shipped.', "no preferred name: Jira's order");
});

test('Any Done status never takes a cancelled one; with none it does not move and says so; already done is said', async () => {
  const only = await report({ category: 'done' }, { from: S.review, transitions: [tr('81', "Won't do", S.wontdo), tr('82', 'Duplicate', S.dup), tr('83', 'Dup again', S.dup)] });
  assert.deepEqual([only.posts.length, only.out.moved, only.out.transitioned], [0, null, false]);
  assert.equal(only.out.note, 'Not moved: from "In Review" only Won\'t Do and Duplicate lead to a Done status.');
  assert.equal(only.comment, `done\n\n${LINK}\n\nNot moved: from "In Review" only Won't Do and Duplicate lead to a Done status.`);
  const one = await report({ category: 'done' }, { from: S.review, transitions: [tr('81', "Won't do", S.wontdo)] });
  assert.equal(one.out.note, 'Not moved: from "In Review" only Won\'t Do leads to a Done status.', 'one: leads (decided 2026-10-30)');
  const none = await report({ category: 'done' }, { from: S.review, transitions: [tr('11', 'Start', S.prog)] });
  assert.equal(none.out.note, 'Not moved: from "In Review" no transition leads to a Done status.');
  const already = await report({ category: 'done' }, { from: S.closed, transitions: [tr('71', 'Finish', S.done)] });
  assert.deepEqual([already.out.note, already.reads.length, already.posts.length], ['Already in Closed.', 0, 0]);
  const wontdo = await report({ category: 'done' }, { from: S.wontdo });
  assert.equal(wontdo.out.note, "Already in Won't Do.", 'a ticket already in a done-category status is not moved again');
});

test('a required Resolution: filled with Done, Fixed, Complete or Completed; else the next candidate; else not moved', async () => {
  const filled = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, RES("Won't Do", 'Done'))] });
  assert.deepEqual(filled.posts[0].body, { transition: { id: '71' }, fields: { resolution: { id: '2' } } });
  assert.equal(filled.out.note, 'Moved to Done, Resolution: Done.');
  const fallback = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, RES("Won't Do")), tr('61', 'Close', S.closed)] });
  assert.deepEqual([fallback.posts.map((p) => p.body.transition.id), fallback.out.note], [['61'], 'Moved to Closed.']);
  const no = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, RES('Rejected'))] });
  assert.deepEqual([no.posts.length, no.out.note], [0, 'Not moved: the move to Done needs a Resolution, and none is named Done, Fixed or Complete.']);
  const status = await report({ status: '10001', name: 'Done' }, { transitions: [tr('71', 'Finish', S.done, RES('Fixed'))] });
  assert.equal(status.out.note, 'Moved to Done, Resolution: Fixed.', 'the same rule for a status move');
});

test('other required fields without a default: Worca fills none, so it does not move and names them', async () => {
  const r = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done, { customfield_10020: { required: true, name: 'Fix versions', hasDefaultValue: false },
    customfield_10021: { required: true, name: 'Team', hasDefaultValue: true } })] });
  assert.deepEqual([r.posts.length, r.out.note], [0, 'Not moved: the move to Done asks for fields Worca does not fill (Fix versions).']);
});

test('a status move: by id, a typed name, already there, gone from the project, not reachable', async () => {
  for (const deployment of BOTH) {
    const byId = await report({ status: '10012', name: 'Resolved' }, { deployment, transitions: [tr('11', 'Start', S.prog), tr('51', 'Resolve', S.resolved)] });
    assert.deepEqual([byId.posts[0].body, byId.out.note, byId.status.name], [{ transition: { id: '51' } }, 'Moved to Resolved.', 'Resolved'], deployment);
  }
  const typed = await report({ status: 'resolve' }, { transitions: [tr('51', 'Resolve', S.resolved)] });
  assert.equal(typed.out.note, 'Moved to Resolved.', 'typed: by transition name, case-insensitive');
  const toName = await report({ status: 'resolved' }, { transitions: [tr('51', 'Wrap up', S.resolved)] });
  assert.equal(toName.out.note, 'Moved to Resolved.', "typed: by the target status's name");
  // S2: as legacy, a transition's name wins over another transition's target name (plugins/jira-source/connector/index.mjs:274)
  const order = await report({ status: 'Done' }, { transitions: [tr('61', 'Close', S.done), tr('62', 'Done', S.closed)] });
  assert.deepEqual([order.posts[0].body, order.out.note], [{ transition: { id: '62' } }, 'Moved to Closed.'],
    'typed "Done": the transition named Done, not the one leading to Done');
  const already = await report({ status: '3', name: 'In Progress' }, { transitions: [tr('51', 'Resolve', S.resolved)] });
  assert.deepEqual([already.out.note, already.reads.length], ['Already in In Progress.', 0]);
  const gone = await report({ status: '10099', name: 'Shipped' }, { transitions: [tr('11', 'Start', S.prog)] });
  assert.equal(gone.out.note, 'Not moved: SHOP has no status named Shipped any more.');
  const away = await report({ status: '10012', name: 'Resolved' }, { transitions: [tr('11', 'Start', S.prog), tr('12', 'Review', S.review)] });
  assert.equal(away.out.note, 'Could not move to "Resolved" from "In Progress" (available: Start, Review).');
  const legacyTyped = await report({ status: 'Shipped' }, { transitions: [tr('11', 'Start', S.prog), tr('12', 'Review', S.review)] });
  assert.equal(legacyTyped.out.note, 'Could not move to "Shipped" from "In Progress" (available: Start, Review).');
  assert.ok(legacyTyped.logs.some((l) => /^warn SHOP-12: Could not move/.test(l)));
});

test("I1: a cancelling transition into a neutral status is not taken; of two into Closed the done-verb one wins", async () => {
  const first = await report({ category: 'done' }, { transitions: [tr('81', "Won't Do", S.closed), tr('61', 'Close Issue', S.closed)] });
  assert.deepEqual([first.posts.map((p) => p.body.transition.id), first.out.note], [['61'], 'Moved to Closed.'], "Won't Do listed first");
  const verbs = await report({ category: 'done' }, { transitions: [tr('81', 'Reject', S.closed), tr('82', 'Cancel', S.closed), tr('83', 'Mark as duplicate', S.closed), tr('84', 'Decline', S.closed)] });
  assert.deepEqual([verbs.posts.length, verbs.out.note], [0, 'Not moved: from "In Progress" only Reject, Cancel, Mark as duplicate and Decline lead to a Done status.'],
    'only cancelling transitions reach a done status: nothing moves, and it says so');
  const tie = await report({ category: 'done' }, { transitions: [tr('91', 'Ship it', S.closed), tr('92', 'Done', S.closed)] });
  assert.deepEqual(tie.posts.map((p) => p.body.transition.id), ['92'], 'same target: a preferred done name first');
  const named = await report({ status: '6', name: 'Closed' }, { transitions: [tr('81', "Won't Do", S.closed), tr('61', 'Close Issue', S.closed)] });
  assert.deepEqual([named.posts.map((p) => p.body.transition.id), named.out.note], [['61'], 'Moved to Closed.'], 'a named status too');
  const namedOnly = await report({ status: '6', name: 'Closed' }, { transitions: [tr('81', "Won't Do", S.closed)] });
  assert.equal(namedOnly.posts.length, 0);
  for (const bad of ['Close as Duplicate', "Resolve as Won't Fix", 'Cancel issue', 'Reject request', 'Cannot Reproduce', 'Closed (Wont Fix)', 'Close  as\u00a0DUPLICATE']) {
    const compound = await report({ category: 'done' }, { transitions: [tr('81', bad, S.closed), tr('82', 'Approve', S.closed)] });
    assert.deepEqual(compound.posts.map((p) => p.body.transition.id), ['82'], `${JSON.stringify(bad)} listed first is never taken`);
    const only = await report({ category: 'done' }, { transitions: [tr('81', bad, S.closed)] });
    assert.equal(only.posts.length, 0, `${JSON.stringify(bad)} alone moves nothing`);
  }
  const picked = await report({ status: '10010', name: "Won't Do" }, { transitions: [tr('81', "Won't Do", S.wontdo)] });
  assert.equal(picked.out.note, "Moved to Won't Do.", 'choosing a cancelled status on purpose still works');
});

test('isCancelledName collapses inner spaces and NBSP and accepts Wont Fix', () => {
  for (const n of ["Won't  Do", 'Won’t Fix', ' Not   planned ', 'Wont Fix', 'Wont do']) assert.equal(isCancelledName(n), true, JSON.stringify(n));
  assert.equal(isCancelledName('Closed'), false);
});

test("Jira's reason is collapsed to one line in the comment's last line", async () => {
  const r = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done)],
    refuseTransition: { status: 400, body: { errorMessages: ['Field   Assignee\n  is\r\nrequired.'], errors: { x: 'second\tone' } } } });
  assert.equal(r.comment.split('\n').at(-1), 'Not moved: Jira refused the move to Done: Field Assignee is required.; second one.');
});

test('an unrecognised move shape moves nothing and does not read the ticket', async () => {
  const r = await report({}, { transitions: [tr('71', 'Finish', S.done)] });
  assert.deepEqual([r.posts.length, r.reads.length, r.out.moved, r.out.note], [0, 0, null, '']);
});

test("a 4xx refusal of the transition still comments with Jira's reason (D10, Deviation 3); 401, 429 and 5xx throw", async () => {
  const r = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done)],
    refuseTransition: { status: 400, body: { errorMessages: ['Field Assignee is required.'], errors: {} } } });
  assert.deepEqual([r.out.transitioned, r.out.moved], [false, null]);
  assert.equal(r.out.note, 'Not moved: Jira refused the move to Done: Field Assignee is required.');
  assert.equal(r.comment.split('\n').at(-1), r.out.note);
  const forbidden = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done)],
    refuseTransition: { status: 403, body: { errorMessages: [], errors: { status: 'You may not move this issue.' } } } });
  assert.equal(forbidden.out.note, 'Not moved: Jira refused the move to Done: You may not move this issue.');
  const silent = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done)],
    refuseTransition: { status: 409, body: {} } });
  assert.equal(silent.out.note, 'Not moved: Jira refused the move to Done: Jira gave no reason.', 'no message (decided 2026-10-30)');
  const { jira, src } = await site({ projectStatuses: STATUSES, seed: [{ key: 'SHOP-12', project: 'SHOP', status: S.prog, transitions: [] }], refuseToken: true });
  await assert.rejects(src.reportResult('SHOP-12', { ...RESULT, move: { category: 'done' } }), (e) => e.kind === 'auth');
  assert.deepEqual(jira.issues.get('SHOP-12').comments, [], 'no comment after a refused token');
  // S4: the boundary is the transition POST itself: these throw there, so the write-back fails and Report result retries
  for (const [refusal, kind] of [[{ status: 429, body: {} }, 'rate-limit'], [{ status: 401, body: {} }, 'auth'],
    [{ status: 500, body: { errorMessages: ['Internal server error'] } }, 'plugin']]) {
    const site2 = await site({ projectStatuses: STATUSES, refuseTransition: refusal,
      seed: [{ key: 'SHOP-12', project: 'SHOP', status: S.prog, transitions: [tr('71', 'Finish', S.done)] }] });
    await assert.rejects(site2.src.reportResult('SHOP-12', { ...RESULT, move: { category: 'done' } }), (e) => e.kind === kind, String(refusal.status));
    assert.ok(site2.jira.requests.some((q) => q.method === 'POST' && /\/transitions$/.test(q.path)), `${refusal.status}: the POST was tried`);
    assert.deepEqual(site2.jira.issues.get('SHOP-12').comments, [], `${refusal.status}: no comment`);
  }
});

test("Jira does not let Worca read the ticket's status or transitions (403, 404): a Not moved line, the comment still posted", async () => {
  const hidden = await report({ category: 'done' }, { transitions: [tr('71', 'Finish', S.done)],
    refuseTransitionsRead: { status: 403, body: { errorMessages: ['You do not have the permission to see the specified issue.'] } } });
  assert.deepEqual([hidden.posts.length, hidden.out.transitioned, hidden.out.moved], [0, false, null]);
  assert.equal(hidden.out.note, "Not moved: Jira did not let Worca read SHOP-12's transitions (You do not have the permission to see the specified issue).");
  assert.equal(hidden.comment.split('\n').at(-1), hidden.out.note);
  const silent = await report({ status: '10012', name: 'Resolved' }, { refuseTransitionsRead: { status: 404, body: {} } });
  assert.equal(silent.out.note, "Not moved: Jira did not let Worca read SHOP-12's transitions (Jira gave no reason).");
});

test("Don't move: no read, no transition, no line; a failed run passes none and only comments", async () => {
  const r = await report({ none: true }, { transitions: [tr('71', 'Finish', S.done)] });
  assert.deepEqual([r.reads.length, r.posts.length, r.out], [0, 0, { commented: true, transitioned: false, moved: null, note: '' }]);
  assert.equal(r.comment, `done\n\n${LINK}`);
  assert.equal(r.jira.requests.filter((q) => /\/issue\/SHOP-12$/.test(q.path)).length, 0, 'the status is not even read');
});

test('without a move: exactly the old behaviour (transitionOnComplete, its line before the links)', async () => {
  const { jira, src } = await site({ done: 'Done', projectStatuses: STATUSES,
    seed: [{ key: 'SHOP-12', project: 'SHOP', status: S.prog, transitions: [tr('71', 'Finish', S.done)] }] });
  const out = await src.reportResult('SHOP-12', RESULT);
  assert.deepEqual(out, { commented: true, transitioned: true });
  assert.equal(jira.issues.get('SHOP-12').comments.at(-1), `done\n\nMoved to Done.\n\n${LINK}`);
  const reads = jira.requests.filter((q) => q.method === 'GET' && /\/transitions$/.test(q.path));
  assert.equal(reads[0].query.expand, undefined, 'the legacy read asks for no fields');
});
