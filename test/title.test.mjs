// test/title.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTitle, generateTitle, isRefusalTitle } from '../src/core/title.mjs';

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

test('sanitizeTitle truncates at a word boundary, never mid-word', () => {
  const long = 'Implement the new authentication middleware layer for every incoming request handler';
  const t = sanitizeTitle(long);
  assert.ok(t.length <= 70);
  assert.ok(!t.endsWith('reque'), 'must not cut mid-word');
  // every word of the output is a whole word of the input
  for (const w of t.split(' ')) assert.ok(long.split(' ').includes(w), `"${w}" is a fragment`);
  // a single unbroken run longer than the cap still hard-slices (nothing to break on)
  assert.equal(sanitizeTitle('x'.repeat(120)).length, 70);
});

test('isRefusalTitle flags clarifying-question / refusal output', () => {
  // The exact live failure: haiku asked for context instead of titling, and the
  // 70-char slice produced this mid-word string as a run title.
  assert.ok(isRefusalTitle("I need more context to write a title. What's the task or work you'd li"));
  assert.ok(isRefusalTitle("What's the task or work you'd like to do?"));
  assert.ok(isRefusalTitle('Could you describe the task first?'));
  assert.ok(isRefusalTitle('Sorry, I cannot write a title without more information'));
  assert.ok(isRefusalTitle('Please provide the task description'));
  assert.ok(isRefusalTitle("I'm unable to determine what this task is about"));
  // prose far beyond the 3–8 word instruction is a refusal/ramble, not a title
  assert.ok(isRefusalTitle('The user has not actually described any software task that could be titled here'));
});

test('isRefusalTitle passes real titles through', () => {
  assert.equal(isRefusalTitle('Add User Auth'), false);
  assert.equal(isRefusalTitle('Fix Login Redirect Bug'), false);
  assert.equal(isRefusalTitle('Improve History Diff Viewer'), false);
  assert.equal(isRefusalTitle('I/O Error Handling Cleanup'), false);   // "I/" is not first-person "I "
  assert.equal(isRefusalTitle('I18n Support For Settings Page'), false);
  assert.equal(isRefusalTitle('[mock] role unknown complete'), false); // mock-mode title must survive
  assert.equal(isRefusalTitle(''), false);
});

test('generateTitle returns "" when the model asks for context instead of titling', async () => {
  const { mkdtemp, writeFile, chmod, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-title-refusal-'));
  const bin = join(dir, 'fake-claude-refusal.sh');
  const frameFile = join(dir, 'frame.json');
  await writeFile(frameFile, JSON.stringify({
    type: 'result',
    result: "I need more context to write a title. What's the task or work you'd like to do?",
  }) + '\n', 'utf8');
  await writeFile(bin, '#!/bin/sh\ncat ' + JSON.stringify(frameFile) + '\nexit 0\n', 'utf8');
  await chmod(bin, 0o755);
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    const t = await generateTitle('hey', { cwd: dir, bin });
    assert.equal(t, '', 'refusal output must be dropped so the caller keeps the provisional title');
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
    await rm(dir, { recursive: true, force: true });
  }
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
