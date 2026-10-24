// test/chat-selftest.test.mjs — the chat self-test (engines/chat-selftest.mjs): the verdict, the scripted endpoint in
// both protocols, the probe MCP server, and the cache (per binary, version and user config; a failure never kept).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { judgeSelfTest, startStubEndpoint, chatSelfTest, resetChatSelfTests, configFingerprint, SELF_TEST_MODEL } from '../src/core/engines/chat-selftest.mjs';
import { PROBE_TOOLS, PROBE_ANSWER } from '../src/core/engines/chat-probe-mcp.mjs';

useTempHome(after);
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-selftest-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const wire = (s, t) => `mcp__${s}__${t}`;
const ALL = PROBE_TOOLS.map((t) => wire('worca', t));

test('the verdict: only worca\'s tools, its clashing names kept, no shell, the probe answered', () => {
  const base = { allowed: ALL, expected: ALL, canaryRan: false, probeCalled: true, label: 'Qwen Code' };
  assert.deepEqual(judgeSelfTest({ ...base, requests: [{ tools: ALL }, { tools: ALL }] }), {});
  assert.match(judgeSelfTest({ ...base, requests: [] , error: 'exit 41' }).refusal, /could not run its chat self-test on Qwen Code \(exit 41\)/);
  assert.match(judgeSelfTest({ ...base, requests: [{ tools: ALL }, { tools: [...ALL, 'read_file', 'agent'] }] }).refusal,
    /Qwen Code offered tools a chat must not have \(read_file, agent\)/, 'a later request (a background agent) counts too');
  assert.match(judgeSelfTest({ ...base, requests: [{ tools: ALL.filter((t) => !t.endsWith('read_file')) }] }).refusal, /hid worca's own tools \(mcp__worca__read_file\)/);
  assert.match(judgeSelfTest({ ...base, requests: [{ tools: ALL }], canaryRan: true }).refusal, /ran a shell command/);
  assert.match(judgeSelfTest({ ...base, requests: [{ tools: ALL }], probeCalled: false }).refusal, /did not answer through Qwen Code/);
});

async function post(url, body, path) {
  const r = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.text();
}

test('the endpoint (OpenAI): scripted steps for requests that offer tools, streaming or not; side calls answered apart', async () => {
  const stub = await startStubEndpoint({ protocol: 'openai', script: [{ tool: 'run_shell_command', args: { command: 'x' } }, { text: 'done' }] });
  try {
    const tools = [{ type: 'function', function: { name: 'mcp__worca__worca_probe' } }];
    assert.match(await post(stub.url, { messages: [], stream: false }, '/v1/chat/completions'), /next_speaker/);
    const first = JSON.parse(await post(stub.url, { messages: [], tools, stream: false }, '/v1/chat/completions'));
    assert.equal(first.choices[0].message.tool_calls[0].function.name, 'run_shell_command');
    const second = await post(stub.url, { messages: [], tools, stream: true }, '/v1/chat/completions');
    assert.match(second, /^data: .*"content":"done"/m);
    assert.match(second, /data: \[DONE\]/);
    assert.deepEqual(stub.requests, [{ tools: ['mcp__worca__worca_probe'] }, { tools: ['mcp__worca__worca_probe'] }]);
  } finally { await stub.close(); }
});

test('the endpoint (Gemini): function declarations and built-in tools recorded; functionCall then text', async () => {
  const stub = await startStubEndpoint({ protocol: 'gemini', script: [{ tool: 'mcp_worca_worca_probe', args: {} }] });
  try {
    assert.match(await post(stub.url, {}, '/v1beta/models/m:countTokens'), /totalTokens/);
    const r = await post(stub.url, { contents: [], tools: [{ functionDeclarations: [{ name: 'mcp_worca_glob' }] }, { googleSearch: {} }] }, '/v1beta/models/m:streamGenerateContent?alt=sse');
    assert.match(r, /"functionCall":\{"name":"mcp_worca_worca_probe"/);
    const end = JSON.parse(await post(stub.url, { contents: [], tools: [{ functionDeclarations: [{ name: 'mcp_worca_glob' }] }] }, '/v1beta/models/m:generateContent'));
    assert.equal(end.candidates[0].content.parts[0].text, 'done');
    assert.deepEqual(stub.requests.map((x) => x.tools), [['mcp_worca_glob', '<googleSearch>'], ['mcp_worca_glob']]);
  } finally { await stub.close(); }
});

/** The probe MCP server's answer to one call, through its stdio. */
function callProbe(cfg, name) {
  return new Promise((resolve, reject) => {
    const srv = cfg.mcpServers.worca;
    const child = spawn(srv.command, srv.args, { env: { ...process.env, ...srv.env }, stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    const out = [];
    child.stdout.on('data', (c) => {
      buf += c;
      for (let i; (i = buf.indexOf('\n')) >= 0;) { out.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
      if (out.length >= 3) { child.kill(); resolve(out); }
    });
    child.on('error', reject);
    for (const m of [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: {} } }]) {
      child.stdin.write(`${JSON.stringify(m)}\n`);
    }
  });
}

/**
 * A stand-in for an engine run: asks the endpoint (as the CLI would, with the probe env), offers `offer` tools, and
 * carries out what the scripted model asks — a shell command when `obeys` names it, worca's probe through its MCP server.
 */
const fakeEngine = ({ offer = ALL, obeys = [] } = {}) => {
  const runs = [];
  const run = async (o) => {
    runs.push(o);
    assert.equal(o.askLockdown, true);
    assert.equal(o.model, SELF_TEST_MODEL);
    const cfg = JSON.parse(readFileSync(o.mcpConfigPath, 'utf8'));
    const base = o.probe.env.OPENAI_BASE_URL;
    for (let i = 0; i < 5; i++) {
      const r = JSON.parse(await post(base, { messages: [], tools: offer.map((name) => ({ type: 'function', function: { name } })) }, '/chat/completions'));
      const call = r.choices[0].message.tool_calls?.[0]?.function;
      if (!call) return { text: 'done', exitCode: 0 };
      if (call.name === 'mcp__worca__worca_probe') {
        const answers = await callProbe(cfg, 'worca_probe');
        assert.deepEqual(answers[1].result.tools.map((t) => t.name), [...PROBE_TOOLS]);
        assert.ok(answers[2].result.content[0].text.startsWith(PROBE_ANSWER));
      } else if (obeys.includes(call.name)) {
        writeFileSync(JSON.parse(call.arguments).command.replace(/^touch /, ''), '');
      }
    }
    return { text: '', exitCode: 0 };
  };
  return { run, runs };
};
const opts = (o) => ({ engine: 'qwen', label: 'Qwen Code', bin: '/x/qwen', protocol: 'openai', wireName: wire, version: async () => '0.26.1',
  probeEnv: (url) => ({ OPENAI_BASE_URL: `${url}/v1` }), ...o });

test('a locked-down engine passes, and the pass is kept per binary, version and user config', async () => {
  resetChatSelfTests();
  const cacheFile = join(tmp(), 'cache.json');
  const cfg = join(tmp(), 'settings.json');
  writeFileSync(cfg, '{}');
  const e = fakeEngine();
  assert.deepEqual(await chatSelfTest(opts({ run: e.run, cacheFile, configFiles: [cfg] })), {});
  assert.deepEqual(await chatSelfTest(opts({ run: e.run, cacheFile, configFiles: [cfg] })), {});
  assert.equal(e.runs.length, 1, 'kept in memory');
  resetChatSelfTests();
  assert.deepEqual(await chatSelfTest(opts({ run: e.run, cacheFile, configFiles: [cfg] })), {});
  assert.equal(e.runs.length, 1, 'kept on disk across a restart');
  assert.deepEqual(await chatSelfTest(opts({ run: e.run, cacheFile, configFiles: [cfg], version: async () => '0.27.0' })), {});
  assert.equal(e.runs.length, 2, 'a new version runs it again');
  writeFileSync(cfg, '{"tools":{}}');
  assert.deepEqual(await chatSelfTest(opts({ run: e.run, cacheFile, configFiles: [cfg], version: async () => '0.27.0' })), {});
  assert.equal(e.runs.length, 3, 'a changed user config runs it again');
  assert.notEqual(configFingerprint([cfg]), configFingerprint([join(tmp(), 'none')]));
});

test('an engine that offers a built-in or runs the shell is refused, and the failure is not kept', async () => {
  resetChatSelfTests();
  const cacheFile = join(tmp(), 'cache.json');
  const open = fakeEngine({ offer: [...ALL, 'run_shell_command'], obeys: ['run_shell_command'] });
  assert.match((await chatSelfTest(opts({ run: open.run, cacheFile }))).refusal, /offered tools a chat must not have \(run_shell_command\)/);
  const shell = fakeEngine({ obeys: ['run_shell_command'] });
  assert.match((await chatSelfTest(opts({ run: shell.run, cacheFile }))).refusal, /ran a shell command/);
  assert.match((await chatSelfTest(opts({ run: shell.run, cacheFile }))).refusal, /ran a shell command/);
  assert.equal(shell.runs.length, 2, 'never kept');
  const broken = { run: async () => { throw new Error('exit 41: no auth'); } };
  assert.match((await chatSelfTest(opts({ run: broken.run, cacheFile }))).refusal, /could not run its chat self-test on Qwen Code \(exit 41: no auth\)/);
  assert.match((await chatSelfTest(opts({ run: open.run, cacheFile, version: async () => { throw Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }); } }))).refusal, /cannot run \/x\/qwen \(ENOENT\)/);
});
