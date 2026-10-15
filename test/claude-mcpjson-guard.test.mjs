// test/claude-mcpjson-guard.test.mjs
// Claude Code starts every server of the cwd's committed .mcp.json in -p, approved or not (probed on 2.1.293), so
// runClaude names the unapproved ones in disabledMcpjsonServers of the ONE --settings payload, at every spawn,
// judged by the approvals of the user's own project folder (mcpjsonProjectDir). A fake `bin` records the argv.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { unapprovedMcpjsonNames } from '../src/core/mcpjson-approval.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script' : false };
process.env.WORCA_HOST_GUARD = '0';                 // isolate this file's --settings from the host guard's

const dirs = [];
const tmp = async (p = 'worca-cc-mcpjson-guard-') => { const d = await mkdtemp(join(tmpdir(), p)); dirs.push(d); return d; };
const prevHome = process.env.HOME;
process.env.HOME = await tmp('worca-cc-mcpjson-guard-home-');   // the real ~/.claude approvals must not decide
after(async () => { process.env.HOME = prevHome; await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

async function fakeBin(dir, outFile) {
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(bin, `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(outFile)}; done\nexit 0\n`, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}
/** A run checkout with a committed .mcp.json of `names`, and the user's own project folder approving `approved`. */
async function fixture(names, approved = []) {
  const cwd = await tmp();
  await writeFile(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: Object.fromEntries(names.map((n) => [n, { command: n }])) }));
  const real = await tmp();
  await mkdir(join(real, '.claude'), { recursive: true });
  await writeFile(join(real, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: approved }));
  return { cwd, real };
}
async function argvOf(opts) {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try { await runClaude({ bin: await fakeBin(dir, out), prompt: 'p', ...opts }); } finally { if (prevMock !== undefined) process.env.WORCA_MOCK = prevMock; }
  return (await readFile(out, 'utf8')).split('\0').filter(Boolean);
}
const settingsOf = (argv) => { const i = argv.indexOf('--settings'); return i === -1 ? null : JSON.parse(argv[i + 1]); };

test('unapprovedMcpjsonNames: the cwd\'s servers not approved by the project folder; none without a .mcp.json', async () => {
  const { cwd, real } = await fixture(['a', 'b', 'c'], ['a']);
  assert.deepEqual(await unapprovedMcpjsonNames(cwd, real), ['b', 'c']);
  assert.deepEqual(await unapprovedMcpjsonNames(cwd), ['a', 'b', 'c'], 'judged by the cwd itself when no project folder is given');
  assert.deepEqual(await unapprovedMcpjsonNames(await tmp()), []);
});

test('runClaude: the unapproved committed servers ride --settings as disabledMcpjsonServers, merged with the caller\'s', POSIX_SHIM, async () => {
  const { cwd, real } = await fixture(['a', 'b', 'c'], ['a']);
  const s = settingsOf(await argvOf({ cwd, mcpjsonProjectDir: real, extraSettings: { disabledMcpjsonServers: ['x'], disableSkillShellExecution: true } }));
  assert.deepEqual(s.disabledMcpjsonServers, ['x', 'b', 'c']);
  assert.equal(s.disableSkillShellExecution, true, 'the caller\'s other settings are kept');
});

test('runClaude: nothing added when every server is approved, without a .mcp.json, or under --strict-mcp-config', POSIX_SHIM, async () => {
  const ok = await fixture(['a'], ['a']);
  assert.equal(settingsOf(await argvOf({ cwd: ok.cwd, mcpjsonProjectDir: ok.real })), null, 'byte-identical argv: no --settings at all');
  assert.equal(settingsOf(await argvOf({ cwd: await tmp() })), null);
  const held = await fixture(['b']);
  const argv = await argvOf({ cwd: held.cwd, mcpjsonProjectDir: held.real, strictMcpConfig: true });
  assert.ok(argv.includes('--strict-mcp-config'));
  assert.equal(settingsOf(argv), null, 'strict loads no .mcp.json, so there is nothing to hold');
});

test('runClaude: read at every spawn, so a server added to .mcp.json mid-run is held on the next one', POSIX_SHIM, async () => {
  const { cwd, real } = await fixture(['a'], ['a']);
  assert.equal(settingsOf(await argvOf({ cwd, mcpjsonProjectDir: real })), null);
  await writeFile(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { a: { command: 'a' }, added: { command: 'x' } } }));
  assert.deepEqual(settingsOf(await argvOf({ cwd, mcpjsonProjectDir: real })).disabledMcpjsonServers, ['added']);
});

test('a pipeline node passes the user\'s project folder, not its run checkout, to judge the approvals', async () => {
  const { _runOptsForTests: runOpts } = await import('../src/core/phases.mjs');
  const o = runOpts({ projectDir: '/runs/r1/repos/shop', mcpjsonProjectDir: '/home/me/shop' }, { role: 'implementer', prompt: 'p', systemPrompt: 's', allowedTools: [] });
  assert.equal(o.cwd, '/runs/r1/repos/shop');
  assert.equal(o.mcpjsonProjectDir, '/home/me/shop');
  const src = await readFile(new URL('../src/core/orchestrator.mjs', import.meta.url), 'utf8');
  assert.match(src, /mcpjsonProjectDir: this\.isWorkspace \? undefined : this\.projectDir/, 'the orchestrator sets it from the real folder');
});
