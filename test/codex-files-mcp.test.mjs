// test/codex-files-mcp.test.mjs — the read-only file tools a Codex helper job (the Auto classifier's repo look,
// the night decider) gets over its roots, served over MCP stdio (src/core/engines/codex-files-mcp.mjs), and the
// night decider's Codex spawn that hands them over.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFileTools, parseRoots, writeFilesMcpConfig, CODEX_FILES_SERVER, CODEX_FILES_MCP_PATH } from '../src/core/engines/codex-files-mcp.mjs';
import { runNightAnalysis } from '../src/core/night/analysis.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';

useTempHome(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'files-mcp-'))); dirs.push(d); return d; };

function repo() {
  const root = tmp();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.mjs'), 'export const A = 1;\n');
  writeFileSync(join(root, '.env'), 'TOKEN=secret\n');
  return root;
}

test('parseRoots: absolute --root values only', () => {
  assert.deepEqual(parseRoots(['--root', '/a', '--root', 'rel', '--root', '/b', '--root']), ['/a', '/b']);
});

test('the three tools read under the roots, refuse outside them and never open a protected file', async () => {
  const root = repo();
  const tools = createFileTools({ roots: [root] });
  assert.deepEqual(tools.list().map((t) => t.name), ['read_file', 'grep', 'glob']);
  assert.match((await tools.call('read_file', { path: join(root, 'src', 'a.mjs') })).text, /export const A = 1;/);
  assert.deepEqual((await tools.call('glob', { pattern: 'src/**/*.mjs' })).paths, [join(root, 'src', 'a.mjs')]);
  assert.equal((await tools.call('grep', { pattern: 'export' })).matches.length, 1);
  await assert.rejects(tools.call('read_file', { path: '/etc/hosts' }), { name: 'AskToolError' });
  await assert.rejects(tools.call('read_file', { path: join(root, '.env') }), (e) => e.name === 'AskToolError' && /protected/.test(e.message));
  assert.deepEqual((await tools.call('glob', { pattern: '**/.env*' })).paths, []);
});

test('the run store and checkouts are readable (the run-read denies), the rest of worca\'s state is not', async () => {
  const home = tmp();
  const runs = join(home, '.worca-cc', 'runs', 'r1');
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, 'f.txt'), 'ok\n');
  writeFileSync(join(home, '.worca-cc', 'settings.json'), '{}');
  const tools = createFileTools({ roots: [home] });
  assert.match((await tools.call('read_file', { path: join(runs, 'f.txt') })).text, /ok/);
  await assert.rejects(tools.call('read_file', { path: join(home, '.worca-cc', 'settings.json') }), /protected/);
});

test('writeFilesMcpConfig: one stdio server over the roots, private to the user', () => {
  const dir = tmp();
  const path = writeFilesMcpConfig({ dir, roots: ['/r1', '/r2'], name: 'x' });
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const srv = doc.mcpServers[CODEX_FILES_SERVER];
  assert.equal(srv.command, process.execPath);
  assert.deepEqual(srv.args.slice(1), [CODEX_FILES_MCP_PATH, '--root', '/r1', '--root', '/r2']);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o077, 0);
});

test('the server answers MCP over stdio, and finishes a call still running when its stdin closes', async () => {
  const root = repo();
  const child = spawn(process.execPath, [CODEX_FILES_MCP_PATH, '--root', root], { stdio: ['pipe', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (b) => { out += b; });
  child.stdin.end([
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'grep', arguments: { pattern: 'export' } } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n');
  assert.equal(await new Promise((r) => child.on('exit', r)), 0);
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].result.serverInfo.name, 'worca');
  assert.equal(JSON.parse(lines[1].result.content[0].text).matches[0].path, join(root, 'src', 'a.mjs'));
});

test('runNightAnalysis on Codex: read-only, the file tools over the checkout and the plan folders, the config removed after', async () => {
  const cwd = repo();
  const plans = tmp();
  let seen = null; let cfg = null;
  const run = async (o) => {
    seen = o; cfg = JSON.parse(readFileSync(o.mcpConfigPath, 'utf8'));
    o.onEvent({ type: 'result', text: '', costUsd: 0.02, isError: false, usage: { input_tokens: 900, cache_read_input_tokens: 100, output_tokens: 5 } });
    return { text: '{"decisions":[]}' };
  };
  const res = await runNightAnalysis({ questions: [{ id: 'q', question: '?', options: ['a', 'b'] }], cwd, task: 't', planPaths: [join(plans, 'p.md')],
    criteria: {}, model: 'gpt-5.5', engine: 'codex', run });
  assert.equal(seen.engine, 'codex');
  assert.equal(seen.sandbox, 'read-only');
  assert.equal(seen.modelEnv, undefined);
  assert.equal(seen.maxTurns, 12);
  assert.deepEqual(cfg.mcpServers[CODEX_FILES_SERVER].args.slice(-4), ['--root', cwd, '--root', plans]);
  assert.ok(seen.systemPrompt.includes(`the repository at ${cwd}`));
  assert.equal(existsSync(seen.mcpConfigPath), false);
  assert.equal(res.costUsd, 0.02);
  assert.equal(res.peakContextTokens, 1000, 'codex has no per-message usage: the turn\'s prompt is the peak');
});

test('runNightAnalysis on Claude is unchanged: no engine, no MCP config, Claude\'s own tools', async () => {
  let seen = null;
  await runNightAnalysis({ questions: [{ id: 'q', question: '?', options: ['a'] }], cwd: tmp(), task: 't', criteria: {}, model: 'claude-sonnet-5',
    run: async (o) => { seen = o; return { text: '{"decisions":[]}' }; } });
  assert.equal('engine' in seen, false);
  assert.equal('mcpConfigPath' in seen, false);
  assert.deepEqual(seen.tools, ['Read', 'Grep', 'Glob']);
  assert.match(seen.systemPrompt, /\(Read, Grep, Glob\)/);
});

test('a Codex run says which merged MCP servers its agents will not get; a Claude run says nothing', () => {
  const dir = tmp();
  const path = join(dir, 'mcp.json');
  writeFileSync(path, JSON.stringify({ mcpServers: { pg: { command: 'x' }, web: { type: 'http', url: 'https://mcp.example/' } } }));
  const rc = { mcpConfigPath: path, mcpServerNames: ['pg', 'web', 'native_one'] };
  const codex = createOrchestrator({ projectDir: dir, claude: { mock: true, engine: 'codex' } });
  assert.deepEqual(codex._engineMcpWarnings(rc), [
    'engine codex: MCP servers Claude Code loads on its own are not attached on codex: native_one',
    'engine codex: MCP servers not attached on codex — remote, and codex attaches stdio servers only: web',
  ]);
  assert.deepEqual(createOrchestrator({ projectDir: dir, claude: { mock: true } })._engineMcpWarnings(rc), []);
});
