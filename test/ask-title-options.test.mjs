// test/ask-title-options.test.mjs
// P1/T2: generateTitle forwards the Ask Worca hardening options to runClaude —
// and forwards NOTHING new when they are absent (pipeline title calls unchanged).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateTitle } from '../src/core/title.mjs';

let prevMock, prevOrch;
beforeEach(() => {
  prevMock = process.env.WORCA_MOCK; prevOrch = process.env.ORCH_MOCK;
  delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
});
afterEach(() => {
  if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  if (prevOrch === undefined) delete process.env.ORCH_MOCK; else process.env.ORCH_MOCK = prevOrch;
});

async function fakeBin(dir, outFile) {
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, '#!/bin/sh\n' +
    `for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(outFile)}; done\n` +
    `printf '%s\\n' '{"type":"result","result":"Fix Login Bug"}'\n` +
    'exit 0\n', 'utf8');
  await chmod(bin, 0o755);
  return bin;
}
function splitArgv(dump) { const parts = dump.split('\0'); parts.pop(); return parts; }

test('hardened call: --tools "" + the three flags reach the spawned argv; the title still comes back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-title-'));
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const title = await generateTitle('fix login bug in auth module', {
    cwd: dir, bin, tools: [], strictMcpConfig: true, settingSources: ['project'], disableSlashCommands: true,
  });
  assert.equal(title, 'Fix Login Bug');
  const argv = splitArgv(await readFile(out, 'utf8'));
  assert.equal(argv[argv.indexOf('--tools') + 1], '');
  assert.ok(argv.includes('--strict-mcp-config'));
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], 'project');
  assert.ok(argv.includes('--disable-slash-commands'));
  assert.equal(argv[argv.indexOf('--effort') + 1], 'low', 'existing effort unchanged');
  assert.ok(!argv.includes('--allowedTools'), 'allowedTools: [] still emits no --allowedTools');
  assert.ok(!argv.includes('--mcp-config'), 'no mcpConfigPath given ⇒ none passed');
});

test('legacy call: none of the new flags appear', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-title-'));
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  await generateTitle('fix login bug', { cwd: dir, bin });
  const argv = splitArgv(await readFile(out, 'utf8'));
  for (const flag of ['--tools', '--strict-mcp-config', '--setting-sources', '--disable-slash-commands', '--mcp-config']) {
    assert.ok(!argv.includes(flag), `${flag} must not appear for a legacy caller`);
  }
});

test('mcpConfigPath is forwarded when given', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-ask-title-'));
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  await generateTitle('fix login bug', { cwd: dir, bin, mcpConfigPath: join(dir, 'mcp-empty.json') });
  const argv = splitArgv(await readFile(out, 'utf8'));
  assert.equal(argv[argv.indexOf('--mcp-config') + 1], join(dir, 'mcp-empty.json'));
});

// --- Task 2 (P2): permissionMode pass-through -------------------------------
// A fake `claude` that dumps its argv NUL-separated (the spawn-args.test.mjs:82-93
// technique) and answers one result line (that part is this file's own fakeBin
// recipe, :21-29 — spawn-args' fake exits without a result line) — generateTitle
// never throws either way.
async function pmArgvBin(dir) {
  const out = join(dir, 'pm-argv.txt');
  const bin = join(dir, 'claude-pm');
  await writeFile(bin, [
    '#!/bin/sh',
    `for a in "$@"; do printf '%s\\0' "$a" >> "${out}"; done`,
    `printf '%s\\n' '{"type":"result","result":"A Title"}'`,
    'exit 0',
    '',
  ].join('\n'));
  await chmod(bin, 0o755);
  return { bin, out };
}

test('generateTitle forwards permissionMode when given (the ask call passes dontAsk)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-title-pm-'));
  const { bin, out } = await pmArgvBin(dir);
  const t = await generateTitle('fix the login flow', { cwd: dir, bin, permissionMode: 'dontAsk' });
  assert.equal(t, 'A Title');
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  const i = argv.indexOf('--permission-mode');
  assert.notEqual(i, -1);
  assert.equal(argv[i + 1], 'dontAsk');
  await rm(dir, { recursive: true, force: true });
});

test('generateTitle without permissionMode keeps the legacy acceptEdits argv', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-title-pm-legacy-'));
  const { bin, out } = await pmArgvBin(dir);
  await generateTitle('fix the login flow', { cwd: dir, bin });
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  const i = argv.indexOf('--permission-mode');
  assert.equal(argv[i + 1], 'acceptEdits');
  await rm(dir, { recursive: true, force: true });
});
