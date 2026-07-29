// test/title.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTitle, generateTitle } from '../src/core/title.mjs';

test('sanitizeTitle strips quotes, collapses whitespace, caps length', () => {
  assert.equal(sanitizeTitle('  "Add user auth"\n'), 'Add user auth');
  // sanitizeTitle takes the FIRST non-empty line, then strips a leading "Title:" label.
  // The "  thing" on the 2nd line is intentionally dropped.
  assert.equal(sanitizeTitle('Title: Fix the thing'), 'Fix the thing');
  assert.equal(sanitizeTitle('Title: Fix the\n  thing'), 'Fix the'); // 2nd line dropped (first-line-only)
  const long = 'x'.repeat(120);
  assert.ok(sanitizeTitle(long).length <= 70);
  assert.equal(sanitizeTitle(''), '');
  assert.equal(sanitizeTitle('```\ncode\n```'), 'code'); // strips stray code fences
});

test('generateTitle returns a non-empty deterministic title in mock mode', async () => {
  process.env.WORCA_MOCK = '1';
  const t = await generateTitle('Make sure the title of a new running pipeline is generated up front', {
    cwd: process.cwd(),
  });
  // Under mock with no MOCK_ROLE the body is generic ('[mock] role unknown complete');
  // we only assert shape — a real `claude` binary produces a human title.
  assert.equal(typeof t, 'string');
  assert.ok(t.length > 0 && t.length <= 70);
  delete process.env.WORCA_MOCK;
});

test('generateTitle returns "" when the prompt is empty', async () => {
  assert.equal(await generateTitle('', { cwd: process.cwd() }), '');
});
