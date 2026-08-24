// test/ask-mcp-stdio.test.mjs
// P1/T13: the hand-rolled MCP stdio server (ask-worca-design.md §6.4, D11):
// unit tests over a fake tool set, then the REAL child spawned against a temp
// home with seeded rows. stdout must carry nothing but JSON-RPC lines.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';
import { addProject } from '../src/core/projects.mjs';
import { createThread, appendMessage, addAttachment } from '../src/core/ask/store.mjs';
import { createRpcServer, parseArgv } from '../src/core/ask/mcp-stdio.mjs';
import { AskToolError } from '../src/core/ask/tools.mjs';

const home = useTempHome(after);
const SCRIPT = fileURLToPath(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url));

const FAKE_TOOLS = {
  list: () => [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, additionalProperties: false } }],
  call: async (name, input) => {
    if (name === 'echo') {
      if (input.text === 'boom') throw new AskToolError('echo: boom');
      if (input.text === 'crash') throw new TypeError('unexpected');
      return { echoed: input.text };
    }
    throw new AskToolError(`unknown tool: ${name}`);
  },
};

function harness() {
  const out = [];
  const logs = [];
  const server = createRpcServer({ tools: FAKE_TOOLS, write: (s) => out.push(s), log: (s) => logs.push(s), serverVersion: '9.9.9' });
  return { server, out, logs, parsed: () => out.map((s) => { assert.ok(s.endsWith('\n') && !s.slice(0, -1).includes('\n'), 'one JSON object per line'); return JSON.parse(s); }) };
}

test('parseArgv: --home / --thread, missing values ignored', () => {
  assert.deepEqual(parseArgv(['--home', '/b', '--thread', 'ask_00000001']), { home: '/b', thread: 'ask_00000001' });
  assert.deepEqual(parseArgv([]), { home: null, thread: null });
  assert.deepEqual(parseArgv(['--home']), { home: null, thread: null });
});

test('handshake: initialize echoes a supported protocolVersion, falls back otherwise; notifications are never answered; ids may be 0', async () => {
  const { server, out, parsed } = harness();
  await server.feed(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { roots: { listChanged: true } }, clientInfo: { name: 'claude-code', version: '2.1.239' } } }));
  await server.feed(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  await server.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  await server.feed(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }));
  await server.feed(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'notifications/cancelled', params: {} }));
  await server.idle();
  const msgs = parsed();
  assert.equal(msgs.length, 3, 'two initialize answers + ping; notifications unanswered');
  assert.deepEqual(msgs[0], { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'worca', version: '9.9.9' } } });
  assert.deepEqual(msgs[1], { jsonrpc: '2.0', id: 1, result: {} });
  assert.equal(msgs[2].result.protocolVersion, '2025-06-18');
  assert.equal(out.length, 3);
});

test('tools/list, tools/call success, tool errors as isError text, crashes logged, protocol errors as JSON-RPC errors', async () => {
  const { server, logs, parsed } = harness();
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' }, _meta: { 'claudecode/toolUseId': 'toolu_x', progressToken: 2 } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'boom' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { text: 'crash' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: [1] } },
    { jsonrpc: '2.0', id: 7, method: 'resources/list' },
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'echo' } },
  ];
  for (const l of lines) server.feed(JSON.stringify(l));
  server.feed('not json at all');
  server.feed(JSON.stringify([{ jsonrpc: '2.0', id: 9, method: 'ping' }, { jsonrpc: '2.0', id: 10, method: 'ping' }]));
  server.feed('   ');
  await server.idle();
  const m = parsed();
  assert.deepEqual(m.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, null, 9, 10], 'responses in request order; parse error carries id null');
  assert.deepEqual(m[0].result.tools, FAKE_TOOLS.list());
  assert.deepEqual(m[1].result, { content: [{ type: 'text', text: JSON.stringify({ echoed: 'hi' }) }] });
  assert.deepEqual(m[2].result, { content: [{ type: 'text', text: 'error: echo: boom' }], isError: true });
  assert.deepEqual(m[3].result, { content: [{ type: 'text', text: 'error: unexpected' }], isError: true });
  assert.equal(logs.filter((l) => l.includes('unexpected')).length, 1, 'non-AskToolError failures are logged');
  assert.equal(logs.filter((l) => l.includes('boom')).length, 0, 'expected tool errors are not logged');
  assert.equal(m[4].error.code, -32602);
  assert.equal(m[5].error.code, -32602);
  assert.equal(m[6].error.code, -32601);
  assert.deepEqual(m[7].result, { content: [{ type: 'text', text: JSON.stringify({ echoed: undefined }) }] }, 'missing arguments ⇒ {}');
  assert.deepEqual(m[8], { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
});

// ── the real child against the temp home ────────────────────────────────────
function rpc(child, msg) { child.stdin.write(`${JSON.stringify(msg)}\n`); }
function runChild(args, lines, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
    for (const l of lines) rpc(child, l);
    child.stdin.end();
  });
}

test('real child: handshake, seeded rows readable, thread-scoped attachment, proposal, clean stdout, exit 0 on stdin end', async () => {
  const projectDir = mkdtempSync(join(tmpdir(), 'worca-ask-mcp-proj-'));
  const [project] = await addProject({ name: 'mcpdemo', path: projectDir });
  const seeded = await seedPipeline(projectDir, { title: 'Seeded', status: 'done', prompt: 'seed prompt' });
  await writeFile(join(seeded.dir, 'diff-patch.patch'), 'diff --git a/a.txt b/a.txt\n+++ b/a.txt\n+hello\n', 'utf8');
  const thread = createThread();
  const msg = appendMessage(thread.id, { role: 'user', text: 'x' });
  const att = addAttachment(thread.id, msg.id, { name: 'n.md', text: 'attached text' });
  const other = createThread();

  const calls = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_run', arguments: { id: seeded.id } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_run_diff', arguments: { id: seeded.id, projectKey: project.key } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_attachment', arguments: { id: att.id } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'propose_run', arguments: { projectKey: project.key, brief: 'Add a badge' } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_run', arguments: { id: 'zzzzzzzz' } } },
    { jsonrpc: '2.0', id: 8, method: 'foo/bar' },
  ];
  // argv wins over env: env points at a bogus base, argv at the real one
  const r = await runChild(['--home', home, '--thread', thread.id], calls, { env: { WORCA_HOME: '/nonexistent/base', WORCA_ASK_THREAD_ID: other.id } });
  assert.equal(r.code, 0, `exit 0 (stderr: ${r.err})`);
  const msgs = r.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(msgs.map((m) => m.id), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(msgs[0].result.protocolVersion, '2025-11-25');
  assert.deepEqual(msgs[1].result.tools.map((t) => t.name), ['list_projects', 'list_workflows', 'list_runs', 'get_run', 'get_run_diff', 'propose_run', 'read_attachment',
    'list_diff_comments', 'add_diff_comment', 'resolve_diff_comment', 'delete_diff_comment',
    'open_worktree', 'list_worktrees', 'remove_worktree', 'git']);
  const projects = JSON.parse(msgs[2].result.content[0].text);
  assert.equal(projects.projects[0].key, project.key);
  const run = JSON.parse(msgs[3].result.content[0].text);
  assert.equal(run.id, seeded.id);
  assert.equal(run.prompt, 'seed prompt');
  assert.equal(run.hasDiff, true);
  const diff = JSON.parse(msgs[4].result.content[0].text);
  assert.equal(diff.available, true);
  assert.deepEqual(diff.files, [{ path: 'a.txt', added: 1, removed: 0 }]);
  assert.equal(JSON.parse(msgs[5].result.content[0].text).text, 'attached text', 'argv thread wins over the env thread');
  const proposal = JSON.parse(msgs[6].result.content[0].text);
  assert.equal(proposal.ok, true);
  assert.equal(proposal.card.projectKey, project.key);
  assert.deepEqual(msgs[7].result, { content: [{ type: 'text', text: 'error: get_run: run not found' }], isError: true });
  assert.equal(msgs[8].error.code, -32601);
});

test('real child: the env-only form works too, and another thread cannot read the attachment', async () => {
  const thread = createThread();
  const msg = appendMessage(thread.id, { role: 'user', text: 'x' });
  const att = addAttachment(thread.id, msg.id, { name: 'n.md', text: 'mine' });
  const stranger = createThread();
  const r = await runChild([], [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_attachment', arguments: { id: att.id } } },
  ], { env: { WORCA_HOME: home, WORCA_ASK_THREAD_ID: stranger.id } });
  assert.equal(r.code, 0, r.err);
  const [m] = r.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(m.result, { content: [{ type: 'text', text: 'error: read_attachment: attachment not found' }], isError: true });
});
