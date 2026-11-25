// test/issue-number-names.test.mjs — tool, test and npm script names say what they do, never which issue they came from.
// An issue number stays a reference only (docs, commit and tag messages, the PR description).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';

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

// Workflows too: the file name, the workflow `name:`, job ids and job `name:` values.
// `${{ … }}` expressions are dropped, then each word goes through the same ISSUE rule, so a spaced
// `verify 919 proofs` is caught without loosening the regex the tests above pin. A wrapping `#`, `(`,
// `[`, `)`, `]` or `,` is stripped first, so `#1583` and `(919)` count too.
export function workflowNameOffenders(entries) {
  const words = (s) => String(s).replace(/\$\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/).map((w) => w.replace(/^[#([]+|[)\],]+$/g, '')).filter(Boolean);
  const out = [];
  for (const { file, doc } of entries) {
    const check = (where, name) => { if (name != null && words(name).some((w) => ISSUE.test(w))) out.push(`${file} ${where}: ${name}`); };
    check('file', file);
    check('workflow name', doc?.name);
    for (const [id, job] of Object.entries(doc?.jobs || {})) {
      check('job id', id);
      check('job name', job?.name);
    }
  }
  return out;
}

test('no workflow file, workflow name, job id or job name holds an issue number', () => {
  const files = execFileSync('git', ['ls-files', '--', '.github/workflows'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /\.ya?ml$/.test(f));
  assert.ok(files.includes('.github/workflows/ci.yml'), 'git ls-files listed the workflows');
  const entries = files.map((file) => ({ file, doc: YAML.parse(readFileSync(new URL(file, ROOT), 'utf8')) }));
  assert.deepEqual(workflowNameOffenders(entries), []);
});

test('workflowNameOffenders: a job id like verify-919 is named, with where it sits', () => {
  assert.deepEqual(workflowNameOffenders([{ file: '.github/workflows/ci.yml', doc: { name: 'CI', jobs: { 'verify-919': {} } } }]),
    ['.github/workflows/ci.yml job id: verify-919']);
});

test('workflowNameOffenders: a spaced number in a job or workflow name is caught; an expression is not a word', () => {
  const at = '.github/workflows/ci.yml';
  assert.deepEqual(workflowNameOffenders([{ file: at, doc: { name: 'CI', jobs: { verify: { name: 'verify 919 proofs' } } } }]),
    [`${at} job name: verify 919 proofs`]);
  assert.deepEqual(workflowNameOffenders([{ file: at, doc: { name: 'CI', jobs: { 'npm-test': { name: 'npm test (${{ matrix.shard }}/4)' } } } }]), []);
  assert.deepEqual(workflowNameOffenders([{ file: at, doc: { name: 'timings-1583', jobs: {} } }]), [`${at} workflow name: timings-1583`]);
  assert.deepEqual(workflowNameOffenders([{ file: '.github/workflows/timings-1583.yml', doc: { name: 'Refresh test timings', jobs: {} } }]),
    ['.github/workflows/timings-1583.yml file: .github/workflows/timings-1583.yml']);
  assert.deepEqual(workflowNameOffenders([{ file: '.github/workflows/timings.yml', doc: { name: 'Refresh test timings', jobs: { refresh: { name: 'Refresh test timings' } } } }]), []);
  assert.deepEqual(workflowNameOffenders([{ file: at, doc: { name: 'CI', jobs: { a: { name: 'fix #1583' }, b: { name: 'proofs (919),' } } } }]),
    [`${at} job name: fix #1583`, `${at} job name: proofs (919),`]);
});
