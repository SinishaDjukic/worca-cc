// test/git-info-issue.test.mjs — createIssue(): the one gh call that WRITES to
// GitHub on a user's behalf outside the PR flow. Every command goes through the
// injectable runner, so nothing here reaches github.com.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createIssue, _testing as gitInfo } from '../src/core/git-info.mjs';

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

test('a non-label failure is NOT retried', async () => {
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
});

test('a logged-out gh is reported as an auth problem, not a generic failure', async () => {
  runner(async (cmd, args) => (args[0] === 'issue'
    ? fail('gh: To get started with GitHub CLI, please run: gh auth login')
    : ok('')));

  const r = await createIssue({ ...ARGS, body: 'report' });

  assert.equal(r.ok, false);
  assert.equal(r.kind, 'auth', 'the UI tells the reporter to run `gh auth login`');
});

test('no gh on PATH is reported before anything is written', async () => {
  const calls = [];
  gitInfo.setRunner(async (cmd, args) => {
    calls.push(args[0]);
    return fail('spawn gh ENOENT', -1);
  });

  const r = await createIssue({ ...ARGS, body: 'report' });

  assert.equal(r.ok, false);
  assert.equal(r.kind, 'no-gh');
  assert.deepEqual(calls, ['--version'], 'no `issue create` is attempted');
});

test('an unknown repo is refused without spawning gh', async () => {
  const calls = runner(async () => ok(ISSUE_URL));
  const r = await createIssue({ repo: '', title: 'x', body: 'y' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'no-repo');
  assert.deepEqual(calls, [], 'a missing bugs.url must never fall back to the cwd remote');
});
