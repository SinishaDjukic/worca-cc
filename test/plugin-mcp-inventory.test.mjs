// test/plugin-mcp-inventory.test.mjs — MCP servers in consent, the Plugins card data and
// the ignored-contributions line (MCP registry spec §4.1 "Consent and inventory").
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { JIRA, SENTRY, writeMcpPlugin } from './helpers/mcp-plugin-fixture.mjs';
import { buildInstallInventory, ignoredContributions, linkPlugin, listInstalledPlugins } from '../src/core/plugin-store.mjs';
import { MCP_NEEDS_API_5 } from '../src/core/plugin-manifest.mjs';
import { renderInstallConsent } from '../ui/public/plugins-view.mjs';

useTempHome(after);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-mcp-inv-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
const doc = new JSDOM('<!doctype html><body></body>').window.document;

const PG = {
  type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', { field: 'database', prefix: '--db=' }],
  fields: [{ key: 'database', label: 'Database URL', required: true }], description: '',
};
const ORG_URL = {
  type: 'sse', url: ['https://', { field: 'org' }, '.example.dev/sse'],
  fields: [{ key: 'org', label: 'Org', required: true }], description: '',
};

test('consent lists each honoured server with its command or URL; ./ shows as <plugin-dir>/', () => {
  const dir = writeMcpPlugin(join(scratch, 'a'), { name: 'acme-tools', mcpServers: { sentry: SENTRY, jira: JIRA, pg: PG, org: ORG_URL } });
  assert.deepEqual(buildInstallInventory(dir).mcpServers, [
    { name: 'jira', type: 'stdio', command: 'node <plugin-dir>/mcp/jira.mjs' },
    { name: 'org', type: 'sse', url: 'https://{org}.example.dev/sse' },
    { name: 'pg', type: 'stdio', command: 'npx -y @modelcontextprotocol/server-postgres --db={database}' },
    { name: 'sentry', type: 'http', url: 'https://mcp.sentry.dev/mcp' },
  ]);
  const old = writeMcpPlugin(join(scratch, 'b'), { name: 'acme-tools', range: '>=4 <5' });
  assert.deepEqual(buildInstallInventory(old).mcpServers, [], 'below API 5 consent promises no server');
});

test('an API-4 plugin names its ignored block; an API-5 one does not', () => {
  const old = writeMcpPlugin(join(scratch, 'c'), { name: 'old-tools', range: '>=4 <5' });
  assert.deepEqual(ignoredContributions('old-tools', old, { drops: [], scriptDrops: [], workflowSkips: [] }),
    [{ file: 'worca-cc-plugin.json', reason: MCP_NEEDS_API_5 }]);
  const cur = writeMcpPlugin(join(scratch, 'd'), { name: 'new-tools' });
  assert.deepEqual(ignoredContributions('new-tools', cur, { drops: [], scriptDrops: [], workflowSkips: [] }), []);
});

test('listInstalledPlugins: contributions.mcpServers counts honoured servers', async () => {
  await linkPlugin('acme-tools', writeMcpPlugin(join(scratch, 'e'), { name: 'acme-tools', mcpServers: { jira: JIRA, sentry: SENTRY } }));
  await linkPlugin('old-tools', writeMcpPlugin(join(scratch, 'f'), { name: 'old-tools', range: '>=4 <5' }));
  const rows = Object.fromEntries(listInstalledPlugins().map((r) => [r.name, r]));
  assert.equal(rows['acme-tools'].contributions.mcpServers, 2);
  assert.equal(rows['old-tools'].contributions.mcpServers, 0);
  assert.deepEqual(rows['old-tools'].ignored.map((i) => i.reason), [MCP_NEEDS_API_5]);
});

test('consent modal: listed servers, nothing when none, "unknown — refresh" for an old snapshot', () => {
  const entry = { name: 'acme-tools', repoUrl: 'https://github.com/acme/p', sha: 'a1b2c3d4e5f6' };
  const heads = (inv) => [...renderInstallConsent(entry, inv, { doc }).querySelectorAll('.pl-consent-h')].map((n) => n.textContent);
  const withRows = renderInstallConsent(entry, { mcpServers: [{ name: 'jira', type: 'stdio', command: 'node <plugin-dir>/mcp/jira.mjs' }] }, { doc });
  assert.ok([...withRows.querySelectorAll('.pl-consent-h')].some((n) => n.textContent === 'MCP servers (1)'));
  assert.ok([...withRows.querySelectorAll('.pl-consent-row')].some((n) => n.textContent === 'jira (stdio) — node <plugin-dir>/mcp/jira.mjs'));
  assert.ok(!heads({ mcpServers: [] }).some((t) => t.startsWith('MCP servers')), 'none shipped: no section');
  assert.ok(heads({ agents: [] }).includes('MCP servers: unknown — refresh the marketplace'),
    'a snapshot persisted before API 5 has no key: never read that as "none"');
});

test('consent modal: a Codex model says so', () => {
  const entry = { name: 'acme-models', repoUrl: 'https://github.com/acme/m', sha: 'a1b2c3d4e5f6' };
  const el = renderInstallConsent(entry, { models: [{ id: 'acme-codex', label: 'Acme Codex', engine: 'codex', envKeys: [], baseUrl: null }, { id: 'acme-claude', label: 'Acme', envKeys: [], baseUrl: null }] }, { doc });
  assert.deepEqual([...el.querySelectorAll('.pl-engine')].map((n) => n.textContent), ['Codex']);
});
