// test/title.test.mjs
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTitle, generateTitle, isRefusalTitle } from '../src/core/title.mjs';
import { checkRows } from './helpers/rows.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeCodex } from './helpers/fake-codex.mjs';
import { CODEX_DEFAULT_MODEL } from '../src/core/engines/codex.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

test('sanitizeTitle: strips quotes/labels/fences, first line only, caps at 70 on a word boundary', async () => {
  await checkRows([
    { name: 'sanitizeTitle strips quotes, collapses whitespace, caps length', run: () => {
      assert.equal(sanitizeTitle('  "Add user auth"\n'), 'Add user auth');
      // sanitizeTitle takes the FIRST non-empty line, then strips a leading "Title:" label.
      // The "  thing" on the 2nd line is intentionally dropped.
      assert.equal(sanitizeTitle('Title: Fix the thing'), 'Fix the thing');
      assert.equal(sanitizeTitle('Title: Fix the\n  thing'), 'Fix the'); // 2nd line dropped (first-line-only)
      const long = 'x'.repeat(120);
      assert.ok(sanitizeTitle(long).length <= 70);
      assert.equal(sanitizeTitle(''), '');
      assert.equal(sanitizeTitle('```\ncode\n```'), 'code'); // strips stray code fences
    } },
    { name: 'sanitizeTitle truncates at a word boundary, never mid-word', run: () => {
      const long = 'Implement the new authentication middleware layer for every incoming request handler';
      const t = sanitizeTitle(long);
      assert.ok(t.length <= 70);
      assert.ok(!t.endsWith('reque'), 'must not cut mid-word');
      // every word of the output is a whole word of the input
      for (const w of t.split(' ')) assert.ok(long.split(' ').includes(w), `"${w}" is a fragment`);
      // a single unbroken run longer than the cap still hard-slices (nothing to break on)
      assert.equal(sanitizeTitle('x'.repeat(120)).length, 70);
    } },
  ]);
});

test('isRefusalTitle: refusals flagged, real titles (incl. What/Which/Unable/Please starts) pass', async () => {
  await checkRows([
    { name: 'isRefusalTitle flags clarifying-question / refusal output', run: () => {
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
    } },
    { name: 'isRefusalTitle passes real titles through', run: () => {
      assert.equal(isRefusalTitle('Add User Auth'), false);
      assert.equal(isRefusalTitle('Fix Login Redirect Bug'), false);
      assert.equal(isRefusalTitle('Improve History Diff Viewer'), false);
      assert.equal(isRefusalTitle('I/O Error Handling Cleanup'), false);   // "I/" is not first-person "I "
      assert.equal(isRefusalTitle('I18n Support For Settings Page'), false);
      assert.equal(isRefusalTitle('[mock] role unknown complete'), false); // mock-mode title must survive
      assert.equal(isRefusalTitle(''), false);
    } },
    { name: 'isRefusalTitle: legitimate titles starting with What/Which/Unable/Please are NOT refusals; real refusals still are', run: () => {
      // Review of PR #376: the refusal filter dropped legitimate pipeline titles that
      // merely START with What's/Which/Unable/Please — the caller then kept the
      // provisional "first 80 chars of the prompt" title for ever.
      for (const t of ['What\'s New Page Redesign', 'Which Tab Is Active Indicator', 'Unable To Login Error Fix',
        'Please Wait Spinner Timing', 'What If Analysis Export', 'Unable Reason Column In Reports']) {
        assert.equal(isRefusalTitle(t), false, t);
      }
      for (const t of ['What is the task you want titled', 'Which task should I title', 'Unable to determine the task',
        'Please provide more details about the task', 'Please let me know what the task is', "What's the task or work you'd like to do?"]) {
        assert.equal(isRefusalTitle(t), true, t);
      }
    } },
  ]);
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

test('generateTitle forwards envScrub/envAllowlist to the spawn (no leak during runs)', POSIX_SHIM, async () => {
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

test('generateTitle honors opts.mock without WORCA_MOCK — no spawn even with a bogus bin', async () => {
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    const t = await generateTitle('Add a settings page with dark mode', {
      cwd: process.cwd(),
      mock: true,
      bin: '/nonexistent/claude-must-not-spawn',
    });
    // runMock's unknown-role body. Without the passthrough the bogus bin is
    // spawned, ENOENTs, and generateTitle swallows that into ''.
    assert.equal(t, '[mock] role unknown complete');
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  }
});

test('generateTitle on codex: one codex spawn, read-only, codex\'s default model and no Claude title model', POSIX_SHIM, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-title-codex-'));
  const codex = fakeCodex(dir, 'Add Billing Export');
  const prev = process.env.WORCA_TITLE_MODEL;
  process.env.WORCA_TITLE_MODEL = 'claude-haiku-4-5';   // a Claude override must not reach codex
  const errors = [];
  try {
    const title = await generateTitle('add a billing export to the admin page', { engine: 'codex', bin: codex.bin, cwd: dir, onError: (e) => errors.push(e) });
    assert.equal(title, 'Add Billing Export');
  } finally {
    if (prev === undefined) delete process.env.WORCA_TITLE_MODEL; else process.env.WORCA_TITLE_MODEL = prev;
  }
  assert.deepEqual(errors, []);
  const args = codex.args();
  assert.equal(args[0], 'exec');
  assert.deepEqual(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2), ['--sandbox', 'read-only']);
  assert.equal(args[args.indexOf('-m') + 1], CODEX_DEFAULT_MODEL, 'no title model on codex: its own default, named so it is priced');
  assert.equal(args.includes('--add-dir'), false);
  assert.ok(args.includes('model_reasoning_effort="low"'), 'the aux effort travels');
});

test('a failing codex title keeps the provisional title and says which engine failed', POSIX_SHIM, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-title-codex-fail-'));
  const codex = fakeCodex(dir, null, { fail: '401 Unauthorized' });
  const errors = [];
  const title = await generateTitle('fix the login form', { engine: 'codex', bin: codex.bin, cwd: dir, onError: (e) => errors.push(e) });
  assert.equal(title, '');
  assert.equal(errors.length, 1);
  assert.match(errors[0].error.message, /401 Unauthorized/);
  assert.equal(errors[0].model, "codex's default model");
});

test('generateTitle reports each priced result through onCost, re-priced as the title model', async () => {
  const seen = [];
  const run = async (o) => { o.onEvent({ type: 'result', costUsd: 0.0021, raw: { type: 'result', usage: { input_tokens: 90, output_tokens: 8 } } }); return { text: 'Add rate limiting' }; };
  // bin: before the `run` seam existed this fell through to runClaude — a bogus bin keeps that red phase offline.
  const t = await generateTitle('add rate limiting to the api', { model: 'claude-haiku-4-5', run, onCost: (c) => seen.push(c), bin: '/nonexistent/claude-must-not-spawn', mock: false });
  assert.equal(t, 'Add rate limiting');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].costUsd, 0.0021);
  assert.equal(seen[0].model, 'claude-haiku-4-5');
});

describe('the title call is priced as its model (a {free} title model books $0, not the CLI figure)', () => {
  let home; const prev = {};
  before(async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { addGlobalModel } = await import('../src/core/settings.mjs');
    home = await mkdtemp(join(tmpdir(), 'worca-title-free-'));
    for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
    process.env.HOME = home; process.env.USERPROFILE = home;
    process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';            // the catalog reads the sandboxed settings.json
    await addGlobalModel({ id: 'title-free', env: { ANTHROPIC_BASE_URL: 'https://p' }, cost: { free: true } });
  });
  after(async () => {
    const { rm } = await import('node:fs/promises');
    for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    await rm(home, { recursive: true, force: true, maxRetries: 3 });
  });
  test('onCost reports the re-priced figure', async () => {
    const seen = [];
    const run = async (o) => { o.onEvent({ type: 'result', costUsd: 0.0021, raw: { type: 'result', usage: { input_tokens: 90, output_tokens: 8 } } }); return { text: 'Add rate limiting' }; };
    await generateTitle('add rate limiting to the api', { model: 'title-free', run, onCost: (c) => seen.push(c), bin: '/nonexistent/claude-must-not-spawn', mock: false });
    assert.deepEqual(seen.map((c) => [c.costUsd, c.model]), [[0, 'title-free']]);
  });
});
