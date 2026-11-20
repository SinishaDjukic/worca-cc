// test/issue-number-names.test.mjs — tool, test and npm script names say what they do, never which issue they came from.
// An issue number stays a reference only (docs, commit and tag messages, the PR description).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const ISSUE = /(^|[-_:/.])\d{3,}([-_:./]|$)/;   // a run of 3+ digits as its own name segment: verify-919.mjs, verify:919, 919-go-no-go.md

test('the rule catches an issue number as a name segment and nothing else', () => {
  for (const n of ['tools/verify-919.mjs', 'test/catch-up-919-fixture.test.mjs', 'verify:919', 'go/919-go-no-go.md', 'proof-919/x.md'])
    assert.match(n, ISSUE, n);
  for (const n of ['tools/split-verify.mjs', 'test/fixtures/upgrade-snapshot/dev-v60.json', 'split:go-no-go', 'test/e2e-v12.test.mjs'])
    assert.doesNotMatch(n, ISSUE, n);
});

test('no tools/ or test/ file name holds an issue number', () => {
  const files = execFileSync('git', ['ls-files', '--', 'tools', 'test'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  assert.ok(files.length > 100, 'git ls-files listed the tree');
  assert.deepEqual(files.filter((f) => ISSUE.test(f)), []);
});

test('no package.json script name holds an issue number', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8'));
  assert.deepEqual(Object.keys(scripts).filter((k) => ISSUE.test(k)), []);
});
