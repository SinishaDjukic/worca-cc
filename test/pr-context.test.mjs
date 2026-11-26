import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AREAS, NO_ISSUE, areasFor, hasLinkedIssue, run } = require('../.github/scripts/pr-context.cjs');

const repo = { owner: 'acme', repo: 'widgets' };
const ALL_LABELS = [...AREAS.map((a) => a.name), NO_ISSUE.name];

function fakeGithub({ existingLabels = ALL_LABELS, files = [] } = {}) {
  const calls = { addLabels: [], createLabel: [] };
  const github = {
    rest: {
      issues: {
        getLabel: async ({ name }) => {
          if (existingLabels.includes(name)) return { data: { name } };
          throw Object.assign(new Error('Not Found'), { status: 404 });
        },
        createLabel: async (args) => { calls.createLabel.push(args.name); },
        addLabels: async (args) => { calls.addLabels.push([args.issue_number, ...args.labels]); },
      },
      pulls: { listFiles: 'listFiles' },
    },
    paginate: async () => files.map((filename) => ({ filename })),
  };
  return { github, calls };
}
function fakeCore() {
  const failures = [];
  return { core: { info() {}, setFailed: (m) => failures.push(m) }, failures };
}
const pull = (number, extra = {}) => ({ number, user: { login: 'ann', type: 'User' }, body: 'Closes #5', labels: [], ...extra });
const event = (pull_request) => ({ repo, eventName: 'pull_request_target', payload: { pull_request } });

describe('areasFor', () => {
  it('maps a feature folder to its label from the engine, the pages and the routes', () => {
    assert.deepEqual(areasFor(['src/core/chat/send.mjs']), ['area:chat']);
    assert.deepEqual(areasFor(['ui/public/ask/panel.mjs', 'ui/routes/chat/index.mjs']), ['area:chat']);
    assert.deepEqual(areasFor(['ui/public/new-run/form.mjs', 'src/core/shape/plan.mjs']), ['area:runs', 'area:shaper']);
    assert.deepEqual(areasFor(['src/core/workflow-tests/run.mjs', 'ui/public/requirements-attach/pick.mjs']), ['area:shaper', 'area:workflows']);
  });
  it('maps the non-feature areas by their own paths', () => {
    assert.deepEqual(areasFor(['src/cli/main.mjs', '.github/workflows/ci.yml']), ['area:cli', 'area:ci']);
    assert.deepEqual(areasFor(['e2e/extension/pair.spec.mjs', 'ui/public/browser-extension/pair.mjs']), ['area:extension']);
  });
  it('gives no label to flat files, tests, docs and look-alike paths', () => {
    assert.deepEqual(areasFor(['src/core/config.mjs', 'test/chat.test.mjs', 'docs/setup.md', 'build/src/core/chat/x.mjs', 'src/core/chatty/x.mjs']), []);
  });
});

describe('hasLinkedIssue', () => {
  it('accepts closing keywords and Refs, with a number, a cross-repo ref or an issue URL', () => {
    for (const body of [
      'Closes #12', 'fixes #12', 'Resolved: #12', 'Refs #12', 'Part of #12', 'Related to acme/widgets#12',
      'Text first.\n\nCloses https://github.com/acme/widgets/issues/12',
    ]) assert.equal(hasLinkedIssue(body), true, body);
  });
  it('rejects a description with no issue, a bare number or only the template hint', () => {
    for (const body of [
      '', null, 'Makes the header nicer.', 'See #12', 'Closes the gap in the header',
      '## What and why\n<!-- Link the issue: Closes #123 -->\nNicer header.',
    ]) assert.equal(hasLinkedIssue(body), false, String(body));
  });
});

describe('run', () => {
  it('adds only the missing area labels and passes with a linked issue', async () => {
    const { github, calls } = fakeGithub({ files: ['ui/public/chat/view.mjs', 'src/cli/main.mjs'] });
    const { core, failures } = fakeCore();
    await run({ github, core, context: event(pull(9, { labels: [{ name: 'area:chat' }] })) });
    assert.deepEqual(calls.addLabels, [[9, 'area:cli']]);
    assert.deepEqual(failures, []);
  });

  it('fails without a linked issue, after labelling, and says how to fix it', async () => {
    const { github, calls } = fakeGithub({ files: ['src/core/runs/store.mjs'] });
    const { core, failures } = fakeCore();
    await run({ github, core, context: event(pull(9, { body: 'Nicer docs.' })) });
    assert.deepEqual(calls.addLabels, [[9, 'area:runs']]);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /Closes #123/);
    assert.match(failures[0], /acme\/widgets\/issues\/new\/choose/);
  });

  it('passes without a linked issue when the no-issue label is set', async () => {
    const { github } = fakeGithub();
    const { core, failures } = fakeCore();
    await run({ github, core, context: event(pull(9, { body: '', labels: [{ name: 'no-issue' }] })) });
    assert.deepEqual(failures, []);
  });

  it('skips bots entirely', async () => {
    const { github, calls } = fakeGithub({ existingLabels: [], files: ['.github/workflows/ci.yml'] });
    const { core, failures } = fakeCore();
    await run({ github, core, context: event(pull(9, { body: '', user: { login: 'dependabot[bot]', type: 'Bot' } })) });
    assert.deepEqual(calls, { addLabels: [], createLabel: [] });
    assert.deepEqual(failures, []);
  });

  it('creates the labels that are missing', async () => {
    const { github, calls } = fakeGithub({ existingLabels: ['area:chat', 'area:cli'] });
    const { core } = fakeCore();
    await run({ github, core, context: event(pull(9)) });
    assert.deepEqual(calls.createLabel, ALL_LABELS.filter((n) => n !== 'area:chat' && n !== 'area:cli'));
  });
});
