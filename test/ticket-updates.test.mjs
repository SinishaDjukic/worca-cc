// test/ticket-updates.test.mjs — Ticket updates' provider-neutral rules (plans/ticket-updates-design.md D2, D4, D7, D9, D14,
// §4, §6): the move a finished run passes, the save's checks, the projects filter and Report back's words.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { writeTicketUpdates } from '../src/core/plugin-config.mjs';
import {
  toMove, moveFor, validateTicketUpdates, projectFilter, filterProjects, describeMove, TU_LIMITS, TicketUpdatesError, isProjectKey,
} from '../src/core/ticket-updates.mjs';

useTempHome(after, 'worca-tu-rules-');
const prevFlags = process.env.WORCA_FLAGS;
after(() => { if (prevFlags === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prevFlags; });
const flag = (on) => { process.env.WORCA_FLAGS = on ? 'ticketUpdates' : '-ticketUpdates'; };

const ALL = (target) => ({ project: '', moment: 'finished', target });
const RULE = (project, label, target) => ({ project, label, moment: 'finished', target });
const RESOLVED = { kind: 'status', value: '10012', label: 'Resolved', category: 'done' };
const SAVED = {
  projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'Customer portal' }],
  rules: [ALL({ kind: 'category', value: 'done' }), RULE('SHOP', 'Shop', RESOLVED), RULE('CRM', 'Customer portal', { kind: 'none' })],
  savedAt: '2026-10-29T10:42:00.000Z', savedBy: 'local',
};
writeTicketUpdates('jira-source', 'acme', 'jira', SAVED);
writeTicketUpdates('jira-source', 'norule', 'jira', { projects: [], rules: [RULE('SHOP', 'Shop', RESOLVED)] });
writeTicketUpdates('jira-source', 'typed', 'jira', { projects: [], rules: [ALL({ kind: 'typed', value: 'Resolve' })] });
const AT = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };

test('toMove: each stored target as the move a plugin hears (§3)', () => {
  assert.deepEqual(toMove({ kind: 'none' }), { none: true });
  assert.deepEqual(toMove({ kind: 'category', value: 'done' }), { category: 'done' });
  assert.deepEqual(toMove(RESOLVED), { status: '10012', name: 'Resolved' });
  assert.deepEqual(toMove({ kind: 'typed', value: 'Resolve' }), { status: 'Resolve' }, 'typed: no name');
  assert.deepEqual(toMove(undefined), { none: true });
});

test('moveFor: project rule, All projects, no project, no record, a failed run, flag off, typed (D4, D7, §6)', async () => {
  flag(true);
  await checkRows([
    { name: "the ticket's project rule wins", run: () => assert.deepEqual(moveFor({ ...AT, project: 'SHOP', status: 'completed' }), { status: '10012', name: 'Resolved' }) },
    { name: "a project rule of Don't move", run: () => assert.deepEqual(moveFor({ ...AT, project: 'CRM', status: 'completed' }), { none: true }) },
    { name: 'a project without a rule: All projects', run: () => assert.deepEqual(moveFor({ ...AT, project: 'OPS', status: 'completed' }), { category: 'done' }) },
    { name: 'no project (a row from before this change): All projects', run: () => {
      assert.deepEqual(moveFor({ ...AT, project: '', status: 'completed' }), { category: 'done' });
      assert.deepEqual(moveFor({ ...AT, status: 'completed' }), { category: 'done' });
    } },
    { name: 'no record: undefined (legacy)', run: () => assert.equal(moveFor({ ...AT, profile: 'beta', project: 'SHOP', status: 'completed' }), undefined) },
    { name: 'a run that did not finish successfully: none, once rules exist', run: () => {
      assert.deepEqual(moveFor({ ...AT, project: 'SHOP', status: 'failed' }), { none: true });
      assert.deepEqual(moveFor({ ...AT, project: 'SHOP', status: 'needs-human' }), { none: true });
    } },
    { name: 'typed carried over: status without a name', run: () => assert.deepEqual(moveFor({ ...AT, profile: 'typed', status: 'completed' }), { status: 'Resolve' }) },
    { name: 'a hand-edited record without an All projects rule: none, for any project (fails closed)', run: () => {
      assert.deepEqual(moveFor({ ...AT, profile: 'norule', project: 'OPS', status: 'completed' }), { none: true });
      assert.deepEqual(moveFor({ ...AT, profile: 'norule', status: 'completed' }), { none: true });
    } },
    { name: 'no profile reads the default bucket (empty here)', run: () => assert.equal(moveFor({ plugin: 'jira-source', sourceId: 'jira', status: 'completed' }), undefined) },
  ]);
  flag(false);
  assert.equal(moveFor({ ...AT, project: 'SHOP', status: 'completed' }), undefined, 'flag off: saved rules are ignored');
});

const refused = (body, re) => assert.throws(() => validateTicketUpdates(body),
  (e) => e instanceof TicketUpdatesError && e.code === 'BAD_REQUEST' && re.test(e.message));
const NONE_ALL = ALL({ kind: 'none' });

test('validateTicketUpdates: the limits and shapes of §4; the clean record, All projects first', async () => {
  await checkRows([
    { name: 'a valid body comes back clean, All projects first, labels defaulted, a repeated project dropped', run: () => {
      const v = validateTicketUpdates({ projects: [{ value: ' SHOP ', label: 'Shop' }, { value: 'SHOP', label: 'x' }, { value: 'CRM' }],
        rules: [RULE('SHOP', '', RESOLVED), ALL({ kind: 'typed', value: 'Resolve' })], extra: 1 });
      assert.deepEqual(v, { projects: [{ value: 'SHOP', label: 'Shop' }, { value: 'CRM', label: 'CRM' }],
        rules: [{ project: '', moment: 'finished', target: { kind: 'typed', value: 'Resolve' } },
          { project: 'SHOP', label: 'SHOP', moment: 'finished', target: RESOLVED }] });
    } },
    { name: 'projects and rules must be lists', run: () => { refused({ rules: [NONE_ALL] }, /projects/); refused({ projects: [] }, /rules/); } },
    { name: 'at most 200 projects', run: () => refused({ projects: Array.from({ length: TU_LIMITS.projects + 1 }, (_, i) => ({ value: `P${i}` })), rules: [NONE_ALL] }, /200 projects/) },
    { name: 'at most 200 project rules', run: () => refused({ projects: [],
      rules: [NONE_ALL, ...Array.from({ length: TU_LIMITS.rules + 1 }, (_, i) => RULE(`P${i}`, '', { kind: 'none' }))] }, /200 project rules/) },
    { name: 'a list longer than 201 rules is refused before any rule is read', run: () => refused({ projects: [],
      rules: Array.from({ length: TU_LIMITS.rules + 2 }, () => ({})) }, /200 project rules/) },
    { name: 'values and labels at most 200 characters', run: () => {
      refused({ projects: [{ value: 'X'.repeat(201) }], rules: [NONE_ALL] }, /200 characters/);
      refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', 'n'.repeat(201), { kind: 'none' })] }, /200 characters/);
    } },
    { name: 'a rule project is a key: not an object, null or a boolean; owner/repo is a key, any other slash is not (PR 2, decision 1)', run: () => {
      for (const project of [{}, null, true, ['SHOP']]) refused({ projects: [], rules: [NONE_ALL, { ...RULE('x', '', { kind: 'none' }), project }] }, /project must be a project key/);
      for (const bad of ['a/b/c', '/a', 'a/', 'a//b', 'a/..', './a']) {
        refused({ projects: [{ value: bad }], rules: [NONE_ALL] }, /is not a project key/);
        refused({ projects: [], rules: [NONE_ALL, RULE(bad, '', { kind: 'none' })] }, /is not a project key/);
      }
      const ok = validateTicketUpdates({ projects: [{ value: 'Acme/API', label: 'API' }], rules: [NONE_ALL, RULE('Acme/API', 'API', { kind: 'none' })] });
      assert.deepEqual([ok.projects, ok.rules[1].project], [[{ value: 'Acme/API', label: 'API' }], 'Acme/API']);
    } },
    { name: 'one rule per project and moment', run: () => refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'none' }), RULE('SHOP', '', { kind: 'none' })] }, /SHOP has more than one rule/) },
    { name: 'exactly one All projects rule', run: () => {
      refused({ projects: [], rules: [RULE('SHOP', '', { kind: 'none' })] }, /exactly one rule/);
      refused({ projects: [], rules: [NONE_ALL, NONE_ALL] }, /All projects has more than one rule/);
    } },
    { name: 'All projects only none, category or typed', run: () => refused({ projects: [], rules: [ALL(RESOLVED)] }, /All projects can only be/) },
    { name: 'typed only on All projects', run: () => refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'typed', value: 'x' })] }, /old setting/) },
    { name: 'moments only finished', run: () => refused({ projects: [], rules: [{ ...NONE_ALL, moment: 'started' }] }, /finishes/) },
    { name: 'a status needs its id, name and one of the four categories', run: () => {
      refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'status', value: '1', label: 'Done', category: 'closed' })] }, /category/);
      refused({ projects: [], rules: [NONE_ALL, RULE('SHOP', '', { kind: 'status', value: '', label: 'Done', category: 'done' })] }, /id and name/);
    } },
    { name: 'a category move is only Any Done status; an unknown kind is refused', run: () => {
      refused({ projects: [], rules: [ALL({ kind: 'category', value: 'todo' })] }, /Any Done status/);
      refused({ projects: [], rules: [ALL({ kind: 'close' })] }, /needs a move/);
    } },
  ]);
});

test('isProjectKey (PR 2, decision 1): at most one slash between two parts (owner/repo); never a dot part, %, \\, ?, # or a control character', () => {
  for (const ok of ['SHOP', 'My Project', 'Acme/API', 'acme/web.site', `${'o'.repeat(39)}/${'r'.repeat(100)}`, 'X'.repeat(100)]) {
    assert.equal(isProjectKey(ok), true, ok);
  }
  for (const bad of ['', '.', '..', 'a/b/c', '/a', 'a/', 'a//b', 'a/..', './a', 'a/.', 'X'.repeat(101), `a/${'r'.repeat(101)}`, 'a%2eb',
    'a\\b', 'a?b', 'a#b', 'a\u0001b', null, 7]) {
    assert.equal(isProjectKey(bad), false, String(bad));
  }
});

test('projectFilter and filterProjects (D9): only with the flag on and projects picked; a kept value stays', () => {
  flag(true);
  assert.deepEqual([...projectFilter('jira-source', 'jira', 'acme')], ['SHOP', 'CRM']);
  assert.equal(projectFilter('jira-source', 'jira', 'typed'), null, 'none picked = all projects');
  assert.equal(projectFilter('jira-source', 'jira', 'beta'), null, 'no record');
  const all = [{ value: 'SHOP', label: 'Shop (SHOP)' }, { value: 'OPS', label: 'Operations (OPS)' }, { value: 'CRM', label: 'Customer portal (CRM)' }];
  assert.deepEqual(filterProjects(all, projectFilter('jira-source', 'jira', 'acme')).map((o) => o.value), ['SHOP', 'CRM']);
  assert.deepEqual(filterProjects(all, new Set(['CRM']), ['OPS']).map((o) => o.value), ['OPS', 'CRM'], 'a saved choice outside the filter stays');
  assert.equal(filterProjects(all, null), all);
  flag(false);
  assert.equal(projectFilter('jira-source', 'jira', 'acme'), null, 'flag off: no filter');
});

test('describeMove (D14): the words Report back uses', () => {
  assert.equal(describeMove(undefined), null);
  assert.deepEqual(describeMove({ category: 'done' }, { project: 'SHOP' }), { kind: 'category', label: 'a Done status' });
  assert.deepEqual(describeMove({ status: '10012', name: 'Resolved' }, { project: 'SHOP' }), { kind: 'status', label: 'Resolved' });
  assert.deepEqual(describeMove({ status: 'Resolve' }, { project: 'SHOP' }), { kind: 'status', label: 'Resolve (as typed)' },
    'a carried-over typed value reads as the sheet shows it (decided 2026-10-30)');
  assert.deepEqual(describeMove({ none: true }, { project: 'SHOP' }), { kind: 'none', label: 'SHOP' });
});
