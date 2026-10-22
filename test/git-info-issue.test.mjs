// test/git-info-issue.test.mjs — createIssue(): the one gh call that WRITES to
// GitHub on a user's behalf outside the PR flow. Every command goes through the
// injectable runner, so nothing here reaches github.com.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createIssue, ghItemSummaries, _testing as gitInfo } from '../src/core/git-info.mjs';
import { checkRows } from './helpers/rows.mjs';

afterEach(() => gitInfo.reset());

const ISSUE_URL = 'https://github.com/SinishaDjukic/worca-cc/issues/512';
const ARGS = { repo: 'SinishaDjukic/worca-cc', title: 'Run report: too slow (worca 1.2.0)' };

/** Record every invocation; answer `gh --version` so hasGh() clears. */
function runner(answer) {
  const calls = [];
  gitInfo.setRunner(async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === '--version') return { ok: true, stdout: 'gh version 2.63.2', stderr: '', code: 0 };
    return answer(cmd, args, calls);
  });
  return calls;
}

const ok = (stdout) => ({ ok: true, stdout, stderr: '', code: 0 });
const fail = (stderr, code = 1) => ({ ok: false, stdout: '', stderr, code });

test('createIssue files the issue with both labels and returns its URL', async () => {
  let bodyOnDisk = null;
  let bodyPath = null;
  const calls = runner(async (cmd, args) => {
    // Read the --body-file WHILE gh would be running: the file must exist then.
    bodyPath = args[args.indexOf('--body-file') + 1];
    bodyOnDisk = await readFile(bodyPath, 'utf8');
    return ok(`Creating issue in SinishaDjukic/worca-cc\n${ISSUE_URL}\n`);
  });

  const r = await createIssue({ ...ARGS, body: 'the whole report\n```json\n{}\n```' });

  assert.deepEqual(r, { ok: true, url: ISSUE_URL, labeled: true });
  const create = calls.find((c) => c.args[0] === 'issue');
  assert.deepEqual(create.args.slice(0, 5),
    ['issue', 'create', '--repo', 'SinishaDjukic/worca-cc', '--title'],
    '--repo is explicit: gh must not guess the target from the cwd remote');
  assert.deepEqual(create.args.filter((a, i) => create.args[i - 1] === '--label'), ['bug', 'ai']);
  assert.equal(bodyOnDisk, 'the whole report\n```json\n{}\n```',
    'the body rides a file, so a 40 KB report needs no argv and no shell quoting');
  assert.equal(existsSync(bodyPath), false, 'the temp body file is cleaned up');
});

test('a repo without the labels still gets the issue, unlabelled', async () => {
  // Anyone filing a report from their own worca has no triage permission on the
  // worca repo, and `ai` may not exist at all. gh fails the whole create over it.
  let attempt = 0;
  runner(async (cmd, args) => {
    if (args[0] !== 'issue') return ok('');
    attempt += 1;
    if (args.includes('--label')) return fail("could not add label: 'ai' not found");
    return ok(ISSUE_URL);
  });

  const r = await createIssue({ ...ARGS, body: 'report' });

  assert.deepEqual(r, { ok: true, url: ISSUE_URL, labeled: false });
  assert.equal(attempt, 2, 'exactly one retry, and only after a label failure');
});

test('create failures: a non-label failure is not retried (kind failed); a logged-out gh is kind auth', async () => {
  await checkRows([
    { name: 'a non-label failure is NOT retried', run: async () => {
      let attempt = 0;
      runner(async (cmd, args) => {
        if (args[0] !== 'issue') return ok('');
        attempt += 1;
        return fail('HTTP 503: the service is unavailable');
      });

      const r = await createIssue({ ...ARGS, body: 'report' });

      assert.equal(r.ok, false);
      assert.equal(r.kind, 'failed');
      assert.match(r.error, /503/);
      assert.equal(attempt, 1, 'retrying a 503 would file the issue twice when it eventually lands');
    } },
    { name: 'a logged-out gh is reported as an auth problem, not a generic failure', run: async () => {
      runner(async (cmd, args) => (args[0] === 'issue'
        ? fail('gh: To get started with GitHub CLI, please run: gh auth login')
        : ok('')));

      const r = await createIssue({ ...ARGS, body: 'report' });

      assert.equal(r.ok, false);
      assert.equal(r.kind, 'auth', 'the UI tells the reporter to run `gh auth login`');
    } },
  ]);
});

test('pre-flight refusals: an unknown repo spawns nothing; no gh stops after --version', async () => {
  await checkRows([
    { name: 'no gh on PATH is reported before anything is written', run: async () => {
      const calls = [];
      gitInfo.setRunner(async (cmd, args) => {
        calls.push(args[0]);
        return fail('spawn gh ENOENT', -1);
      });

      const r = await createIssue({ ...ARGS, body: 'report' });

      assert.equal(r.ok, false);
      assert.equal(r.kind, 'no-gh');
      assert.deepEqual(calls, ['--version'], 'no `issue create` is attempted');
    } },
    { name: 'an unknown repo is refused without spawning gh', run: async () => {
      const calls = runner(async () => ok(ISSUE_URL));
      const r = await createIssue({ repo: '', title: 'x', body: 'y' });
      assert.equal(r.ok, false);
      assert.equal(r.kind, 'no-repo');
      assert.deepEqual(calls, [], 'a missing bugs.url must never fall back to the cwd remote');
    } },
  ]);
});

test('ghItemSummaries: one gh api graphql per repo, a pullRequest and an issue alias per number; partial data survives a non-zero exit', async () => {
  const data = { data: { r: {
    p7: { title: 'Fix', state: 'OPEN', isDraft: true }, i7: null,
    p8: { title: 'Old', state: 'MERGED', isDraft: false }, i8: null,
    p9: null, i9: { title: 'Bug', state: 'CLOSED' },
    p10: null, i10: null,
  } }, errors: [{ type: 'NOT_FOUND', path: ['r', 'i7'] }] };
  const calls = runner(() => ({ ok: false, stdout: JSON.stringify(data), stderr: 'gh: Could not resolve to an Issue with the number of 7.', code: 1 }));
  const m = await ghItemSummaries({ repo: 'SinishaDjukic/worca-cc', numbers: [7, 8, 9, 10, 7] });
  assert.deepEqual([...m], [[7, { kind: 'pr', title: 'Fix', state: 'draft' }], [8, { kind: 'pr', title: 'Old', state: 'merged' }], [9, { kind: 'issue', title: 'Bug', state: 'closed' }]]);
  const gql = calls.find((c) => c.args[0] === 'api');
  assert.deepEqual(gql.args.slice(0, 5), ['api', 'graphql', '--hostname', 'github.com', '-f'], 'always github.com, whatever GH_HOST says');
  assert.match(gql.args[5], /repository\(owner: "SinishaDjukic", name: "worca-cc"\)/);
  assert.match(gql.args[5], /p7: pullRequest\(number: 7\).*i7: issue\(number: 7\).*p10: pullRequest\(number: 10\).*i10: issue\(number: 10\)/);
  assert.doesNotMatch(gql.args[5], /issueOrPullRequest/, 'an App read token has no issues permission: PRs go through pullRequest');
  assert.equal((gql.args[5].match(/pullRequest\(/g) || []).length, 4, 'a number asked twice is asked once');
  assert.equal(gql.opts.timeout, 10_000);
  for (const bad of [{ repo: 'o/r/x', numbers: [7] }, { repo: 'o', numbers: [7] }, { repo: 'o/r', numbers: [0, -1, 1.5] }]) {
    assert.equal((await ghItemSummaries(bad)).size, 0, JSON.stringify(bad));
  }
  assert.equal(calls.filter((c) => c.args[0] === 'api').length, 1, 'a malformed repo or no valid number never runs gh');
  runner(() => ({ ok: false, stdout: '', stderr: 'error connecting to api.github.com', code: 1 }));
  assert.equal((await ghItemSummaries({ repo: 'o/r', numbers: [1] })).size, 0, 'offline: an empty answer');
});

test('ghItemSummaries: a GitHub App token that cannot be minted asks nothing (never the server user\'s own gh login)', async () => {
  const calls = runner(() => ({ ok: true, stdout: JSON.stringify({ data: { r: { p1: { title: 'x', state: 'OPEN', isDraft: false } } } }), stderr: '', code: 0 }));
  const saved = { id: process.env.WORCA_GH_APP_ID, key: process.env.WORCA_GH_APP_KEY_FILE };
  process.env.WORCA_GH_APP_ID = '12345';
  process.env.WORCA_GH_APP_KEY_FILE = '/nonexistent/worca-chip-test-key.pem';
  try {
    assert.equal((await ghItemSummaries({ repo: 'o/r', numbers: [1] })).size, 0);
  } finally {
    for (const [k, v] of [['WORCA_GH_APP_ID', saved.id], ['WORCA_GH_APP_KEY_FILE', saved.key]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  assert.equal(calls.filter((c) => c.args[0] === 'api').length, 0, 'gh api never ran');
});
