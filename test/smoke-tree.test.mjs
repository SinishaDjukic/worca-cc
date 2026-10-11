// test/smoke-tree.test.mjs — tools/smoke-tree.mjs id normalisation (file mode)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../tools/smoke-tree.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'smoke-tree-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function normalise(text) {
  const file = join(dir, 'in.txt');
  writeFileSync(file, text);
  return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', TOOL, file], { encoding: 'utf8' });
}

test('an 8-hex id with no letter is an id wherever an id can sit', () => {
  assert.equal(normalise('Pipeline created (id 73866114).'), 'Pipeline created (id <ID>).');
  assert.equal(normalise('"projectKeys": [ "worca-cc-smoke-ws-b-Ab3dEf-18071353" ]'),
    '"projectKeys": [ "worca-cc-smoke-ws-b-<RND>-<ID>" ]');
  // A DB row is normalised as JSON.stringify output: a JSON-string column escapes its quotes.
  assert.equal(normalise('{"data":"{\\"key\\":\\"proj-18071353\\"}"}'), '{"data":"{\\"key\\":\\"proj-<ID>\\"}"}');
  assert.equal(normalise('runs/18071353.json'), 'runs/<ID>.json');
  // The letter-bearing id keeps its own rule.
  assert.equal(normalise('(id 7a866114)'), '(id <ID>)');
});

test('an 8-digit number that is not an id stays', () => {
  for (const s of ['"tokens": 12345678', '{"n":12345678}', '[12345678, 23456789]', '0.12345678', 'size 123456789']) {
    assert.equal(normalise(s), s, s);
  }
});
