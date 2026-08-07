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

test('generateTitle forwards envScrub/envAllowlist to the spawn (no leak during runs)', async () => {
  const { mkdtemp, writeFile, readFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-title-env-'));
  const out = join(dir, 'env.txt');
  const bin = join(dir, 'fake-claude-env.sh');
  await writeFile(bin, '#!/bin/sh\nenv > ' + JSON.stringify(out) + '\necho t\nexit 0\n', 'utf8');
  await chmod(bin, 0o755);
  const prevMock = process.env.WORCA_MOCK;
  const prevLeak = process.env.WORCA_TITLE_LEAK;
  delete process.env.WORCA_MOCK;
  process.env.WORCA_TITLE_LEAK = 'secret';
  try {
    await generateTitle('some task', { cwd: dir, bin, envScrub: true, envAllowlist: [] });
    const dump = await readFile(out, 'utf8');
    assert.ok(!dump.includes('WORCA_TITLE_LEAK'), 'title spawn must honor env scrub');
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
    if (prevLeak === undefined) delete process.env.WORCA_TITLE_LEAK; else process.env.WORCA_TITLE_LEAK = prevLeak;
    await rm(dir, { recursive: true, force: true });
  }
});
