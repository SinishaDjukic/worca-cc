// test/ask-spawn-codex.test.mjs — the Codex chat spawn (cascading-settings-design.md D13, §8 test 14).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAskSpawnOptions, buildMcpConfig, ASK_MCP_SERVER_PATH } from '../src/core/ask/spawn.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { fakeCodex } from './helpers/fake-codex.mjs';

const POSIX = process.platform === 'win32' ? { skip: 'POSIX fake bin' } : {};
const base = (over = {}) => ({
  thread: { id: 'ask_00000001', sessionId: null },
  turn: { prompt: 'hello', systemPrompt: 'SYS', model: 'gpt-5.5', effort: 'low', modelEnv: { X: '1' } },
  limits: { maxTurns: 40, maxBudgetUsd: 2 },
  mcpConfigPath: '/h/.worca-cc/tmp/ask/mcp-askm_00000001.json',
  scratchDir: '/h/.worca-cc/tmp/ask',
  memoryDir: '/h/.worca-cc/ask/memory/global',
  web: { enabled: true, allowedDomains: ['example.com'], search: { url: 'https://s/{query}', keyVar: 'BRAVE_KEY' } },
  ...over,
});
let prevMock;
beforeEach(() => { prevMock = process.env.WORCA_MOCK; delete process.env.WORCA_MOCK; });
afterEach(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; });

test('a Codex chat: read-only, lockdown, the worca MCP server, no writable dirs and none of Claude\'s levers', () => {
  const { signal, onEvent, ...o } = buildAskSpawnOptions({ ...base({ thread: { id: 'ask_00000001', sessionId: 'codex:th-1' } }), engine: 'codex' });
  assert.deepEqual(o, {
    engine: 'codex', cwd: '/h/.worca-cc/tmp/ask', prompt: 'hello', systemPrompt: 'SYS', model: 'gpt-5.5', effort: 'low',
    sandbox: 'read-only', askLockdown: true, mcpConfigPath: '/h/.worca-cc/tmp/ask/mcp-askm_00000001.json',
    envScrub: true, envAllowlist: ['SSH_AUTH_SOCK', 'BRAVE_KEY'], resumeSessionId: 'codex:th-1',
  });
});

test('images ride the options; a relayed turn passes no key variable', () => {
  const o = buildAskSpawnOptions({ ...base({ turn: { prompt: 'p', images: ['/att/a.png'] }, relayed: true }), engine: 'codex' });
  assert.deepEqual(o.images, ['/att/a.png']);
  assert.deepEqual(o.envAllowlist, ['SSH_AUTH_SOCK']);
});

test('a Claude chat is unchanged by the engine argument', () => {
  const strip = ({ signal, onEvent, ...o }) => o;
  assert.deepEqual(strip(buildAskSpawnOptions({ ...base(), engine: 'claude' })), strip(buildAskSpawnOptions(base())));
  assert.equal('engine' in buildAskSpawnOptions(base()), false);
});

test('no MCP env value rides the codex argv', POSIX, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-ask-codex-argv-'));
  try {
    const fake = fakeCodex(dir, 'ok');
    const cfg = join(dir, 'mcp.json');
    writeFileSync(cfg, JSON.stringify(buildMcpConfig({ homeBase: dir, threadId: 'ask_00000001', serverPath: ASK_MCP_SERVER_PATH, env: {}, engine: 'codex',
      relay: null, reader: 'Pat Example' })));
    const o = buildAskSpawnOptions({ ...base({ mcpConfigPath: cfg, scratchDir: dir }), engine: 'codex' });
    // Task 0 (a) was NOT CONFIRMED: CODEX_ASK_LOCKDOWN is null and askLockdown:true refuses (codex-ask-adapter test), so
    // the spawn passes the candidate list explicitly to reach the argv.
    await runClaude({ ...o, askLockdown: ['--disable', 'shell_tool', '--disable', 'unified_exec', '-c', 'web_search="disabled"'], bin: fake.bin });
    const argv = fake.args().join(' ');
    assert.match(argv, /--sandbox read-only/);
    assert.match(argv, /mcp_servers\.worca\.command=/);
    assert.match(argv, /mcp_servers\.worca\.env_vars=\[[^\]]*"WORCA_ASK_ENGINE"/);
    assert.doesNotMatch(argv, /Pat Example/);
    assert.doesNotMatch(argv, /--add-dir/);
    assert.equal(fake.env().WORCA_ASK_ENGINE, 'codex');
    assert.equal(fake.env().WORCA_ASK_READER, 'Pat Example');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
