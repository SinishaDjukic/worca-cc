// test/readiness-proc.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { childEnv, run, runLogged } from '../tools/readiness/proc.mjs';

test('childEnv drops FORCE_COLOR and NODE_TEST_CONTEXT and keeps the rest', () => {
  assert.deepEqual(childEnv({ FORCE_COLOR: '1', NODE_TEST_CONTEXT: 'child', PATH: '/bin' }), { PATH: '/bin' });
});

test('run captures stdout and the exit code without a shell', () => {
  const r = run(process.execPath, ['-e', 'console.log("a;b"); process.exit(2)']);
  assert.equal(r.code, 2); assert.equal(r.stdout, 'a;b\n');
});

test('runLogged streams a child to its log and returns the exit code and the whole log', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'readiness-')), 'evidence', 'x.log');
  const r = runLogged(process.execPath, ['-e', 'console.log("hi"); process.exit(3)'], f);
  assert.equal(r.code, 3);
  assert.match(r.text, /^\$ .*\nhi\n\n\[exit 3\]\n$/s);
});
