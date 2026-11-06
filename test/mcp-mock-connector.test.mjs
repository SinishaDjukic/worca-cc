// test/mcp-mock-connector.test.mjs — D35: the stand-in a pretend try loads for each connector. It offers the recorded
// tools, writes down every call, reads included, and sends nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnectorHandler, parseArgs, listedTool, MOCK_CONNECTOR_PATH, NOT_SENT } from '../src/core/mcp/mock-connector.mjs';

test('tools/list offers the recorded tools; a names-only record gets an open schema', () => {
  const log = [];
  const h = createConnectorHandler({ server: 'slack_team', log: (e) => log.push(e), now: () => 'T',
    tools: [{ name: 'post_message', description: 'Post to a channel', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }, 'search_messages'] });
  assert.deepEqual(h({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }).result,
    { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'slack_team', version: '1' } });
  assert.deepEqual(h({ jsonrpc: '2.0', id: 2, method: 'tools/list' }).result.tools, [
    { name: 'post_message', description: 'Post to a channel', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    { name: 'search_messages', description: '', inputSchema: { type: 'object' } },
  ]);
  assert.equal(h({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification is never answered');
  assert.deepEqual(h({ jsonrpc: '2.0', id: 3, method: 'ping' }).result, {});
  assert.deepEqual(log, []);
});

test('every call, reads included, is written down and answered "Not sent: this is a test."', () => {
  const log = [];
  const h = createConnectorHandler({ server: 'jira', log: (e) => log.push(e), now: () => '2026-10-26T10:00:00Z',
    tools: [{ name: 'create_issue' }, { name: 'search_issues', annotations: { readOnlyHint: true } }] });
  const r = h({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_issue', arguments: { title: 'Bulk export' } } });
  assert.deepEqual(r, { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: NOT_SENT }] } });
  assert.equal(NOT_SENT, 'Not sent: this is a test.');
  h({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_issues', arguments: { q: 'export' } } });
  assert.deepEqual(log, [
    { ts: '2026-10-26T10:00:00Z', server: 'jira', tool: 'create_issue', arguments: { title: 'Bulk export' }, readOnly: false },
    { ts: '2026-10-26T10:00:00Z', server: 'jira', tool: 'search_issues', arguments: { q: 'export' }, readOnly: true },
  ]);
  assert.equal(h({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'delete_all' } }).error.code, -32602);
  assert.equal(h({ jsonrpc: '2.0', id: 6, method: 'resources/list' }).error.code, -32601);
  assert.equal(log.length, 2, 'an unknown tool is not a call');
  assert.deepEqual(parseArgs(['--server', 'jira', '--tools', 't.json', '--log', 'c.ndjson']), { server: 'jira', tools: 't.json', log: 'c.ndjson' });
  assert.deepEqual(listedTool('x'), { name: 'x', description: '', inputSchema: { type: 'object' } });
});

test('as a process: stdio lines in, answers out, the call in the log file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-mockconn-'));
  try {
    const tools = join(dir, 'tools.json');
    const log = join(dir, 'calls.ndjson');
    await writeFile(tools, JSON.stringify([{ name: 'post_message' }]));
    const child = spawn(process.execPath, [MOCK_CONNECTOR_PATH, '--server', 'slack_team', '--tools', tools, '--log', log], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = [];
    const got = new Promise((resolve) => {
      let buf = '';
      child.stdout.on('data', (c) => {
        buf += c;
        const parts = buf.split('\n');
        buf = parts.pop();
        lines.push(...parts.filter(Boolean));
        if (lines.length >= 2) resolve();
      });
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'post_message', arguments: { channel: '#product', text: 'Brief ready' } } })}\n`);
    await got;
    child.stdin.end();
    await new Promise((r) => child.on('close', r));
    assert.deepEqual(lines.map((l) => JSON.parse(l).id), [1, 2]);
    assert.equal(JSON.parse(lines[1]).result.content[0].text, 'Not sent: this is a test.');
    const entry = JSON.parse((await readFile(log, 'utf8')).trim());
    assert.deepEqual([entry.server, entry.tool, entry.arguments], ['slack_team', 'post_message', { channel: '#product', text: 'Brief ready' }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
