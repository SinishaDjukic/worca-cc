// test/mcp-secrets.test.mjs
// Literal secrets in the MCP servers a run hands its agents (src/core/mcp-secrets.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpSecretsMode, mcpSecretFindings, screenMcpSecrets } from '../src/core/mcp-secrets.mjs';

test('mode: explicit value, else block with the broker on, else warn', () => {
  assert.equal(mcpSecretsMode({}), 'warn');
  assert.equal(mcpSecretsMode({ WORCA_BROKER_URL: 'http://broker:8080' }), 'block');
  assert.equal(mcpSecretsMode({ WORCA_BROKER_URL: 'http://broker:8080', WORCA_MCP_SECRETS: 'warn' }), 'warn');
  assert.equal(mcpSecretsMode({ WORCA_MCP_SECRETS: 'OFF' }), 'off');
  assert.equal(mcpSecretsMode({ WORCA_MCP_SECRETS: 'nonsense' }), 'warn');
});

test('findings: env, headers, URL credentials and parameters, token-shaped args', () => {
  assert.deepEqual(mcpSecretFindings({ command: 'x', env: { LINEAR_API_KEY: 'lin_abc123', DEBUG: '1' } }), ['env LINEAR_API_KEY']);
  assert.deepEqual(mcpSecretFindings({ env: { SOMETHING: 'ghp_abcdefghijklmnopqrstuvwxyz0123' } }), ['env SOMETHING']);
  assert.deepEqual(mcpSecretFindings({ type: 'http', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer abc123def' } }), ['header Authorization']);
  assert.deepEqual(mcpSecretFindings({ url: 'https://u:p@mcp.example.com/sse' }), ['credentials in the URL']);
  assert.deepEqual(mcpSecretFindings({ url: 'https://mcp.example.com/?api_key=abc&x=1' }), ['URL parameter api_key']);
  assert.deepEqual(mcpSecretFindings({ command: 'npx', args: ['server', '--token', 'sk-abcdefghijklmnopqrstuv'] }), ['a token in args']);
});

test('references are not findings', () => {
  assert.deepEqual(mcpSecretFindings({ env: { LINEAR_API_KEY: '${LINEAR_API_KEY}', TOKEN: '${T:-}' } }), []);
  assert.deepEqual(mcpSecretFindings({ url: 'https://mcp.example.com', headers: { Authorization: 'Bearer ${MCP_TOKEN}' } }), []);
  assert.deepEqual(mcpSecretFindings({ command: 'node', args: ['server.js'], env: { NODE_ENV: 'production' } }), []);
  assert.deepEqual(mcpSecretFindings(null), []);
});

test('screen: block drops and says why without the value; warn keeps; off does nothing', () => {
  const servers = { linear: { command: 'x', env: { LINEAR_API_KEY: 'lin_supersecretvalue' } }, fs: { command: 'fs' } };
  const b = screenMcpSecrets(servers, { mode: 'block' });
  assert.deepEqual(Object.keys(b.servers), ['fs']);
  assert.deepEqual(b.dropped, ['linear']);
  assert.match(b.warnings[0], /`linear` was left out.*env LINEAR_API_KEY.*WORCA_MCP_SECRETS=warn/);
  assert.ok(!b.warnings.join(' ').includes('lin_supersecretvalue'));
  const w = screenMcpSecrets(servers, { mode: 'warn' });
  assert.deepEqual(Object.keys(w.servers), ['linear', 'fs']);
  assert.equal(w.warnings.length, 1);
  const o = screenMcpSecrets(servers, { mode: 'off' });
  assert.equal(o.servers, servers);
  assert.deepEqual(o.warnings, []);
});
