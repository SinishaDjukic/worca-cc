import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LABELS, pickLabel, hasAuthorLabel, labelItem, run } = require('../.github/scripts/author-label.cjs');

const repo = { owner: 'acme', repo: 'widgets' };

function fakeGithub({ permissions = {}, existingLabels = [], items = [] } = {}) {
  const calls = { addLabels: [], createLabel: [], permission: [] };
  const github = {
    rest: {
      issues: {
        getLabel: async ({ name }) => {
          if (existingLabels.includes(name)) return { data: { name } };
          throw Object.assign(new Error('Not Found'), { status: 404 });
        },
        createLabel: async (args) => { calls.createLabel.push(args.name); },
        addLabels: async (args) => { calls.addLabels.push([args.issue_number, ...args.labels]); },
        listForRepo: 'listForRepo',
      },
      repos: {
        getCollaboratorPermissionLevel: async ({ username }) => {
          calls.permission.push(username);
          return { data: { permission: permissions[username] || 'read' } };
        },
      },
    },
    paginate: async () => items,
  };
  return { github, calls };
}
const core = { info() {}, notice() {} };
const issue = (number, login, extra = {}) => ({ number, user: { login, type: 'User' }, author_association: 'NONE', labels: [], ...extra });

describe('pickLabel', () => {
  it('puts write, maintain (reported as write) and admin on the team', () => {
    assert.equal(pickLabel({ permission: 'admin', association: 'OWNER' }), 'from:team');
    assert.equal(pickLabel({ permission: 'write', association: 'COLLABORATOR' }), 'from:team');
  });
  it('team wins over a first-timer association', () => {
    assert.equal(pickLabel({ permission: 'write', association: 'FIRST_TIME_CONTRIBUTOR' }), 'from:team');
  });
  it('labels first-timers who are not on the team', () => {
    assert.equal(pickLabel({ permission: 'read', association: 'FIRST_TIMER' }), 'from:first-timer');
    assert.equal(pickLabel({ permission: 'none', association: 'FIRST_TIME_CONTRIBUTOR' }), 'from:first-timer');
  });
  it('labels everyone else as community, including triage (reported as read)', () => {
    for (const association of ['NONE', 'CONTRIBUTOR', 'MANNEQUIN', undefined]) {
      assert.equal(pickLabel({ permission: 'read', association }), 'from:community');
    }
  });
  it('skips bots', () => {
    assert.equal(pickLabel({ permission: 'write', association: 'NONE', userType: 'Bot' }), null);
  });
});

describe('hasAuthorLabel', () => {
  it('matches from:* labels as objects or strings', () => {
    assert.equal(hasAuthorLabel([{ name: 'bug' }, { name: 'from:team' }]), true);
    assert.equal(hasAuthorLabel(['from:community']), true);
    assert.equal(hasAuthorLabel([{ name: 'bug' }]), false);
    assert.equal(hasAuthorLabel(undefined), false);
  });
});

describe('labelItem', () => {
  it('leaves already-labelled items and bots alone, without a permission lookup', async () => {
    const { github, calls } = fakeGithub();
    const permissionOf = async (u) => { calls.permission.push(u); return 'read'; };
    const deps = { github, context: { repo }, core, permissionOf };
    assert.equal(await labelItem(issue(1, 'ann', { labels: [{ name: 'from:team' }] }), deps), null);
    assert.equal(await labelItem(issue(2, 'dependabot[bot]', { user: { login: 'dependabot[bot]', type: 'Bot' } }), deps), null);
    assert.deepEqual(calls.addLabels, []);
    assert.deepEqual(calls.permission, []);
  });
});

describe('run', () => {
  it('labels the issue from an issues event and creates missing labels', async () => {
    const { github, calls } = fakeGithub({ permissions: { ann: 'write' }, existingLabels: ['from:team'] });
    await run({ github, core, context: { repo, eventName: 'issues', payload: { issue: issue(7, 'ann') } } });
    assert.deepEqual(calls.createLabel, ['from:first-timer', 'from:community']);
    assert.deepEqual(calls.addLabels, [[7, 'from:team']]);
  });

  it('labels the pull request from a pull_request_target event', async () => {
    const { github, calls } = fakeGithub({ existingLabels: LABELS.map((l) => l.name) });
    const pr = issue(9, 'bob', { author_association: 'FIRST_TIME_CONTRIBUTOR' });
    await run({ github, core, context: { repo, eventName: 'pull_request_target', payload: { pull_request: pr } } });
    assert.deepEqual(calls.createLabel, []);
    assert.deepEqual(calls.addLabels, [[9, 'from:first-timer']]);
  });

  it('backfills, skipping labelled items and bots, and looks each author up once', async () => {
    const items = [
      issue(1, 'ann'),
      issue(2, 'carol'),
      issue(3, 'ann'),
      issue(4, 'dave', { labels: [{ name: 'from:community' }] }),
      issue(5, 'renovate[bot]', { user: { login: 'renovate[bot]', type: 'Bot' } }),
    ];
    const { github, calls } = fakeGithub({ permissions: { ann: 'admin' }, existingLabels: LABELS.map((l) => l.name), items });
    await run({ github, core, context: { repo, eventName: 'workflow_dispatch', payload: { inputs: { state: 'all' } } } });
    assert.deepEqual(calls.addLabels, [[1, 'from:team'], [2, 'from:community'], [3, 'from:team']]);
    assert.deepEqual(calls.permission, ['ann', 'carol']);
  });
});
