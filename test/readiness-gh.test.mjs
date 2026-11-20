// test/readiness-gh.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authStatus, originMatches, postReport } from '../tools/readiness/gh.mjs';

const fakeRun = ({ auth = 0, origin = 'git@github.com:SinishaDjukic/worca-cc.git', comments = '' } = {}) => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh' && args[0] === 'auth') return { code: auth, stdout: '', stderr: auth ? 'not logged in' : '✓ Logged in to github.com account someone (keyring)' };
    if (cmd === 'git' && args.includes('get-url')) return { code: 0, stdout: `${origin}\n`, stderr: '' };
    if (cmd === 'gh' && args[1] === 'comment') return { code: 0, stdout: 'https://github.com/SinishaDjukic/worca-cc/issues/919#issuecomment-1\n', stderr: '' };
    if (cmd === 'gh' && args[1] === 'view') return { code: 0, stdout: comments, stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
  return { run, calls };
};
const file = () => join(mkdtempSync(join(tmpdir(), 'readiness-gh-')), 'comment.md');
const marker = '**Readiness dry run** · dev 04370c0f6 · 2026-10-30T12:00:00Z';
const token = `ghp_${'A1b2'.repeat(9)}`;

test('authStatus keeps only the account name', () => {
  assert.deepEqual(authStatus(fakeRun().run), { ok: true, detail: 'gh is signed in to github.com as someone' });
  assert.equal(authStatus(fakeRun({ auth: 1 }).run).ok, false);
});

test('originMatches accepts the three GitHub URL forms of the repo and nothing that only contains it', () => {
  for (const [o, ok] of [['git@github.com:SinishaDjukic/worca-cc.git', true], ['https://github.com/SinishaDjukic/worca-cc', true],
    ['ssh://git@github.com/SinishaDjukic/worca-cc.git', true], ['https://evil.example/github.com/SinishaDjukic/worca-cc.git', false],
    ['git@github.com:SinishaDjukic/worca-cc-fork.git', false], ['git@github.com:sinishadjukic/Worca-CC.git', true],
    ['git@github.com:SinishaDjukic/worca-cc/extra.git', false]]) assert.equal(originMatches(fakeRun({ origin: o }).run, '.'), ok, o);
});

test('refuses without gh auth, with a foreign origin, or with a home path, a token or an email in the body — and never comments', () => {
  for (const [opts, body, re] of [
    [{ auth: 1 }, marker, /not signed in/],
    [{ origin: 'git@github.com:x/y.git' }, marker, /origin is not/],
    [{}, `${marker}\nlog at /Users/jdoe/x.log`, /refusing to post: line 2: a home-directory path/],
    [{}, `${marker}\nGH_TOKEN=${token}`, /refusing to post: line 2: /],
    [{}, `${marker}\nask jane@acme.io`, /refusing to post: line 2: an email address/]]) {
    const f = fakeRun(opts);
    assert.throws(() => postReport({ run: f.run, root: '.', body, marker, file: file() }), re);
    assert.ok(!f.calls.some((c) => c.startsWith('gh issue comment')), JSON.stringify(f.calls));
  }
});

test('a scan refusal leaves the comment in the file, so the flagged line can be read there', () => {
  const f = file();
  const body = `${marker}\nask jane@acme.io`;
  assert.throws(() => postReport({ run: fakeRun().run, root: '.', body, marker, file: f }), /line 2: an email address/);
  assert.equal(readFileSync(f, 'utf8'), body);
});

test('posts with --body-file and returns the URL once gh issue view shows the marker; throws when it does not', () => {
  const ok = fakeRun({ comments: `someone commented\n${marker}\n…` });
  assert.match(postReport({ run: ok.run, root: '.', body: marker, marker, file: file() }).url, /issuecomment-1$/);
  assert.ok(ok.calls.some((c) => /^gh issue comment 919 --repo SinishaDjukic\/worca-cc --body-file /.test(c)));
  const missing = fakeRun({ comments: 'nothing here' });
  assert.throws(() => postReport({ run: missing.run, root: '.', body: marker, marker, file: file() }), /does not show the report/);
});
