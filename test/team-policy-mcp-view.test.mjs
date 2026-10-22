// test/team-policy-mcp-view.test.mjs — the MCP parts of ui/public/team-policy-view.mjs (MCP registry
// spec §11.1 editor, §11.3 checklist rows, strip and consent modal), pure renderers in jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderPolicyEditor, docFromEditor, editorDirty } from '../ui/public/team-policy-view.mjs';

const dom = new JSDOM('<!doctype html><body></body>');
const doc = dom.window.document;
globalThis.window = dom.window;

const REG = [
  { key: 'plugins.required', group: 'plugins', label: 'Required plugins', type: 'plugins', kinds: ['soft'] },
  { key: 'mcp.required', group: 'plugins', label: 'Required MCP servers', type: 'mcpServers', kinds: ['soft'], workspaceRuns: false },
  { key: 'cost.pipelineLimitUsd', group: 'cost', label: 'Per-pipeline cap (USD)', type: 'usd', kinds: ['default', 'soft'], cap: true, attrs: ['onBreach', 'requireReason'] },
];
const GITHUB = { name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_HOST: { field: 'host' } }, fields: [{ key: 'host', label: 'Host', secret: false, oauth: false, required: true }], description: '', values: { host: 'github.acme.io' } };
const SENTRY = { plugin: 'acme-tools', server: 'sentry' };
const DOC = { schema: 1, title: '', notes: '', fields: {
  'plugins.required': { kind: 'soft', value: [{ name: 'acme-tools' }] },
  'mcp.required': { kind: 'soft', value: [GITHUB, SENTRY] },
}, workspaceRuns: {}, catalogs: { guardrailSets: [], models: [] } };
const blur = (el) => el.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));

test('editor: mcp.required renders one chip per entry, round-trips unchanged, and has no Workspace-runs row', () => {
  const root = renderPolicyEditor(DOC, { registry: REG, doc });
  const row = root.querySelector('.tp-edit-row[data-key="mcp.required"][data-scope="fields"]');
  assert.deepEqual([...row.querySelectorAll('.tp-chip')].map((c) => c.firstChild.textContent),
    ['github · inline stdio · npx -y @modelcontextprotocol/server…', 'sentry · acme-tools']);
  assert.deepEqual(docFromEditor(root, { registry: REG }).fields['mcp.required'], DOC.fields['mcp.required']);
  assert.equal(editorDirty(root, DOC, { registry: REG }), false, 'a round trip never deletes or changes the field');
  assert.equal(root.querySelector('.tp-edit-row[data-key="mcp.required"][data-scope="workspaceRuns"]'), null);
  assert.ok(root.querySelector('.tp-edit-row[data-key="cost.pipelineLimitUsd"][data-scope="workspaceRuns"]'));
});

test('editor: Add opens a JSON box for one entry, checked on blur; an emptied list is skipped like plugins', () => {
  const root = renderPolicyEditor({ ...DOC, fields: { 'plugins.required': DOC.fields['plugins.required'] } }, { registry: REG, doc });
  doc.body.append(root);
  const row = root.querySelector('.tp-edit-row[data-key="mcp.required"][data-scope="fields"]');
  const box = row.querySelector('.tp-mcp-json'); const err = row.querySelector('.tp-mcp-err');
  assert.equal(box.hidden, true);
  row.querySelector('.tp-mcp-add').click();
  assert.equal(box.hidden, false);
  box.value = '{nope'; blur(box);
  assert.equal(err.hidden, false); assert.equal(err.textContent, 'not valid JSON');
  box.value = '{"plugin":"acme-tools"}'; blur(box);
  assert.equal(err.textContent, 'an entry is { "plugin", "server", "values"? } or an inline definition with "name" and "type"');
  box.value = '{"plugin":"","server":""}'; blur(box);
  assert.equal(err.textContent, 'an entry is { "plugin", "server", "values"? } or an inline definition with "name" and "type"');
  box.value = '{"name":"x","type":"stdio","command":"npx","args":"-y"}'; blur(box);
  assert.equal(err.textContent, '"args" must be a list', 'a chip could not show it, and no chip could remove it');
  assert.equal(row.querySelectorAll('.tp-chip').length, 0);
  box.value = JSON.stringify(SENTRY); blur(box);
  assert.equal(err.hidden, true); assert.equal(box.hidden, true); assert.equal(box.value, '');
  assert.equal(row.querySelector('.tp-kind-seg .on').dataset.kind, 'soft', 'the first allowed kind is picked');
  assert.deepEqual(docFromEditor(root, { registry: REG }).fields['mcp.required'], { kind: 'soft', value: [SENTRY] });
  row.querySelector('.tp-chip-rm').click();
  assert.equal(row.querySelector('.tp-kind-seg .on').dataset.kind, 'soft');
  assert.equal(docFromEditor(root, { registry: REG }).fields['mcp.required'], undefined, 'kind still set, list empty: not written');
  root.remove();
});

test('editor: an entry left in the JSON box with an error holds Publish back; clearing the box releases it', () => {
  const root = renderPolicyEditor(DOC, { registry: REG, doc });
  doc.body.append(root);
  const row = root.querySelector('.tp-edit-row[data-key="mcp.required"][data-scope="fields"]');
  const publish = root.querySelector('.tp-publish');
  row.querySelectorAll('.tp-chip-rm')[1].click();
  assert.equal(publish.disabled, false, 'a removed entry is a change');
  row.querySelector('.tp-mcp-add').click();
  const box = row.querySelector('.tp-mcp-json');
  box.value = '{"name":"linear","type":"http","url":"https://mcp.linear.app/mcp",}'; blur(box);
  assert.equal(row.querySelector('.tp-mcp-err').textContent, 'not valid JSON');
  assert.equal(publish.disabled, true, 'a click on Publish would publish the policy without the typed entry and close the editor');
  assert.equal(publish.title, 'Fix or clear the MCP server entry first');
  box.value = ''; blur(box);
  assert.equal(publish.disabled, false, 'an emptied box releases it');
  root.remove();
});

// ---- checklist rows, the MCP strip, the consent dialog (Task 8) ------------------------------
import { renderSetupChecklist, renderMcpConsent } from '../ui/public/team-policy-view.mjs';

const T = { home: 'acme/platform', sha: '8c1d2e0', setId: 'team-acme-platform-9333', setName: 'Team · acme/platform', values: {}, before: null, field: null, working: false };
const GH_DEF = { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_HOST: { field: 'host' }, GITHUB_PERSONAL_ACCESS_TOKEN: { field: 'token' } },
  fields: [{ key: 'host', label: 'Host', secret: false, oauth: false, required: true }, { key: 'token', label: 'Token', secret: true, oauth: false, required: true }], description: '' };
const DD = (url) => ({ type: 'http', url, headers: { 'DD-SITE': 'eu' }, fields: [], description: '' });
// Appendix B's Team set, plus a plugin whose plugin is missing and a consented member switched off.
const ROWS = [
  { ...T, serverId: 'policy:acme/platform/github', name: 'github', plugin: null, type: 'stdio', state: 'skipped', field: 'Token', problem: 'Token not set', hash: 'a'.repeat(64), base: 'github', def: GH_DEF, values: { host: 'github.acme.io' } },
  { ...T, serverId: 'plugin:acme-tools/sentry', name: 'sentry', plugin: 'acme-tools', type: 'http', state: 'never-consented', hash: 'b'.repeat(64), base: 'sentry', def: DD('https://mcp.sentry.dev/mcp') },
  { ...T, serverId: 'policy:acme/platform/datadog', name: 'datadog', plugin: null, type: 'http', state: 'changed', working: true, hash: 'c'.repeat(64), base: 'datadog', def: DD('https://mcp.datadoghq.com/mcp'), before: { def: DD('https://old.datadoghq.com/mcp'), values: {} } },
  { ...T, serverId: 'policy:acme/platform/linear', name: 'linear', plugin: null, type: 'http', state: 'not-installed', hash: 'd'.repeat(64), base: 'platform-linear', def: DD('https://mcp.linear.app/mcp') },
  { ...T, serverId: 'plugin:acme-jira/jira', name: 'jira', plugin: 'acme-jira', type: null, state: 'needs-plugin', hash: 'e'.repeat(64), base: 'jira', def: null },
  { ...T, serverId: 'policy:acme/platform/pg', name: 'pg', plugin: null, type: 'stdio', state: 'off', hash: 'f'.repeat(64), base: 'pg', def: GH_DEF },
  { ...T, serverId: 'policy:acme/platform/ok', name: 'ok', plugin: null, type: 'stdio', state: 'ok', working: true, hash: '0'.repeat(64), base: 'ok', def: GH_DEF },
];
const act = (row) => { const b = row.querySelector('.tp-mcp-act'); return b ? [b.textContent, b.dataset.action, b.dataset.consent || '', b.dataset.home, b.dataset.server] : null; };

test('setup checklist: one MCP row per entry, the action its state calls for; no "Replace / Keep mine"', () => {
  const list = renderSetupChecklist({ home: 'acme/platform', requirements: [], seeds: [], trusted: false, mcp: ROWS }, { doc });
  const rows = [...list.querySelectorAll('.tp-setup-row.tp-mcp-row')];
  assert.deepEqual(rows.map((r) => [r.querySelector('.tp-setup-text b').textContent, r.querySelector('.tp-mcp-state').textContent]), [
    ['github', 'Token not set'], ['sentry', 'Off'], ['datadog', 'Team definition changed'], ['linear', 'Not installed'],
    ['jira', 'Needs plugin acme-jira'], ['pg', 'Off'], ['ok', 'On']]);
  assert.deepEqual(rows.map((r) => r.querySelector('.tp-setup-text small').textContent), [
    'Token in Team · acme/platform', 'from acme-tools', 'team definition · http', 'team definition · http', 'from acme-jira', 'team definition · stdio', 'team definition · stdio']);
  assert.deepEqual(rows.map(act), [
    ['Set Token', 'set', '', 'acme/platform', 'policy:acme/platform/github'],
    ['Turn on', 'turn-on', '1', 'acme/platform', 'plugin:acme-tools/sentry'],
    ['Update', 'update', '1', 'acme/platform', 'policy:acme/platform/datadog'],
    ['Install', 'install', '1', 'acme/platform', 'policy:acme/platform/linear'],
    null,
    ['Turn on', 'turn-on', '', 'acme/platform', 'policy:acme/platform/pg'],
    null]);
  assert.deepEqual([...list.querySelectorAll('.tp-mcp-act')].map((b) => b.dataset.state), ['skipped', 'never-consented', 'changed', 'not-installed', 'off'], 'app.js acts only while the row is still in that state');
  assert.match(list.querySelector('.tp-trust-row').textContent, /MCP servers are never installed or turned on automatically/);
  assert.equal(list.querySelector('.hist-empty'), null);
  assert.doesNotMatch(list.textContent, /Keep mine|Replace/);
});

test('consent dialog: name, home @ sha, type, what it runs, env/headers, what each teammate fills, the set it joins', () => {
  const gh = renderMcpConsent(ROWS[0], 'install', { doc });
  const facts = Object.fromEntries([...gh.querySelectorAll('dl.tp-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  assert.deepEqual(facts, {
    Name: 'github', From: 'acme/platform · worca-policy @ 8c1d2e0', Type: 'stdio', Runs: 'npx -y @modelcontextprotocol/server-github',
    Environment: 'GITHUB_HOST github.acme.io · GITHUB_PERSONAL_ACCESS_TOKEN secret · you set it next',
    'Each teammate fills': 'Host (team value github.acme.io) · Token (secret)', Joins: 'Team · acme/platform set',
  });
  const lin = renderMcpConsent(ROWS[3], 'install', { doc });
  assert.equal(lin.querySelector('.tp-mcp-base').textContent, 'Runs as platform-linear on this machine: the name linear is taken.');
  assert.match(renderMcpConsent(ROWS[1], 'turn-on', { doc }).textContent, /Pluginacme-tools/);
  const up = renderMcpConsent(ROWS[2], 'update', { doc });
  assert.deepEqual([...up.querySelectorAll('h3')].map((x) => x.textContent), ['Now (the definition you consented to)', 'The team definition']);
  assert.deepEqual([...up.querySelectorAll('dl.tp-facts')].map((dl) => [...dl.querySelectorAll('dt')].find((dt) => dt.textContent === 'URL').nextElementSibling.textContent),
    ['https://old.datadoghq.com/mcp', 'https://mcp.datadoghq.com/mcp']);
});

test('consent facts: "Runs as" only when the name is taken; field defaults; a plugin server\'s ./ paths; the Open card fallback', () => {
  assert.equal(renderMcpConsent(ROWS[0], 'install', { doc }).querySelector('.tp-mcp-base'), null, 'github runs as github');
  const factsOf = (el) => Object.fromEntries([...el.querySelectorAll('dl.tp-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
  const withDefault = { ...ROWS[5], values: {}, def: { type: 'stdio', command: 'pg', env: { PG_HOST: { field: 'host' } }, fields: [{ key: 'host', label: 'Host', secret: false, oauth: false, required: false, default: 'db.local' }], description: '' } };
  const facts = factsOf(renderMcpConsent(withDefault, 'turn-on', { doc }));
  assert.equal(facts.Environment, 'PG_HOST db.local');
  assert.equal(facts['Each teammate fills'], 'Host (default db.local)');
  // MCP registry spec §4.1: consent screens show a plugin server's ./ paths as <plugin-dir>/….
  const plugin = { ...ROWS[1], def: { type: 'stdio', command: './bin/sentry-mcp', args: ['./mcp/sentry.mjs', '--stdio'], fields: [], description: '' } };
  assert.equal(factsOf(renderMcpConsent(plugin, 'turn-on', { doc })).Runs, '<plugin-dir>/bin/sentry-mcp <plugin-dir>/mcp/sentry.mjs --stdio');
  const list = renderSetupChecklist({ home: 'acme/platform', mcp: [{ ...ROWS[0], field: null, problem: 'url is not https' }] }, { doc });
  assert.equal(list.querySelector('.tp-mcp-act').textContent, 'Open card');
  // The URL and the command line read the values the team seeds, as ENVIRONMENT does; no value: the field's placeholder.
  const site = { ...ROWS[3], values: { site: 'datadoghq.eu' }, def: { type: 'http', url: ['https://mcp.', { field: 'site' }, '/mcp'], fields: [{ key: 'site', label: 'Site', secret: false, oauth: false, required: true }], description: '' } };
  assert.equal(factsOf(renderMcpConsent(site, 'install', { doc })).URL, 'https://mcp.datadoghq.eu/mcp');
  assert.equal(factsOf(renderMcpConsent({ ...site, values: {} }, 'install', { doc })).URL, 'https://mcp.{site}/mcp');
  const args = { ...ROWS[5], values: { host: 'db.acme.io', token: 'never-shown' }, def: { type: 'stdio', command: 'pg-mcp', args: ['--host', { field: 'host' }, { field: 'token', prefix: '--token=' }],
    fields: [{ key: 'host', label: 'Host', secret: false, oauth: false, required: true }, { key: 'token', label: 'Token', secret: true, oauth: false, required: true }], description: '' } };
  assert.equal(factsOf(renderMcpConsent(args, 'turn-on', { doc })).Runs, 'pg-mcp --host db.acme.io --token={token}', 'a secret never shows a value');
});
