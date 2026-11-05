// test/ask-mcp-deps.test.mjs — the chat's MCP-server readers and the card's apply over the real store
// (docs/mcp-servers.md "Chat").
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { manualNameTaken } from '../src/core/mcp/views.mjs';

useTempHome(after, 'worca-ask-mcp-deps-');
const { listMcpServers, enginesFor, applyMcpChange, validateMcpChange, pinnedProjects, discoverMcpServers } = await import('../src/core/ask/mcp-deps.mjs');
const { projectKey } = await import('../src/core/store.mjs');
const { addManualServer, createSet, putMember, editManualServer, removeServerEverywhere, readMcpStore, mcpDir } = await import('../src/core/mcp/store.mjs');
const { ENGINE_NAMES, engineLabel } = await import('../src/shared/engine-switch.mjs');

const TOKEN = 'ghp_' + 'a'.repeat(36);
const GH_RAW = { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: { field: 'GITHUB_TOKEN' } }, fields: [{ key: 'GITHUB_TOKEN', label: 'GITHUB_TOKEN', secret: true, required: true }], description: '' };
const disk = (n) => JSON.parse(readFileSync(join(mcpDir(), `${n}.json`), 'utf8'));
const members = () => Object.values(disk('sets').sets || {}).flatMap((s) => s.members.map((m) => m.server));

test('manualNameTaken: a manual name, another id\'s base, or a catalog name is taken; a free name is not', () => {
  const ctx = {
    snapshot: { manual: { gh: {} }, bases: { 'manual:gh': 'gh', 'plugin:p/docs': 'docs' } },
    catalog: [{ id: 'plugin:p/search', name: 'search' }],
  };
  assert.equal(manualNameTaken(ctx, 'gh'), true);
  assert.equal(manualNameTaken(ctx, 'docs'), true);
  assert.equal(manualNameTaken(ctx, 'search'), true);
  assert.equal(manualNameTaken(ctx, 'fresh'), false);
});

test('listMcpServers never returns a stored secret', async () => {
  const def = await addManualServer('gh', GH_RAW);
  await putMember('general', 'manual:gh', { enabled: true, secrets: { GITHUB_TOKEN: TOKEN } }, { def });
  const other = await createSet('Other');
  const otherId = typeof other === 'string' ? other : other.id;
  await putMember(otherId, 'manual:gh', { enabled: false, secrets: { GITHUB_TOKEN: { $env: 'MCP_GH' } } }, { def });
  const out = await listMcpServers();
  assert.equal(JSON.stringify(out).includes(TOKEN), false);
  const row = out.servers.find((s) => s.id === 'manual:gh');
  assert.ok(row.sets.some((s) => s.set === 'General' && s.enabled === true && s.secrets.GITHUB_TOKEN === 'set'), JSON.stringify(row.sets));
  assert.ok(row.sets.some((s) => s.set === 'Other' && s.secrets.GITHUB_TOKEN === '$MCP_GH'), JSON.stringify(row.sets));
  assert.equal(row.editable, true);
  assert.equal(row.origin, 'Manual');
});

test('enginesFor uses each adapter\'s own rule', () => {
  const fake = (e) => ({ unattachableMcp: (servers) => (e === 'codex' ? Object.entries(servers).filter(([, v]) => v.url).map(([n]) => ({ name: n, reason: 'remote' })) : []) });
  const stdio = enginesFor('x', { type: 'stdio' }, { getEngine: fake });
  assert.deepEqual(stdio.on, ENGINE_NAMES.map(engineLabel));
  const http = enginesFor('x', { type: 'http' }, { getEngine: fake });
  assert.deepEqual(http.off.map((o) => o.engine), ['Codex']);
  assert.match(http.off[0].reason, /codex attaches stdio servers only/);
});

test('the real enginesFor: an http server is off on Codex and Goose', () => {
  assert.deepEqual(enginesFor('x', { type: 'http' }).off.map((o) => o.engine), ['Codex', 'Goose']);
});

const ADD = { kind: 'add', name: 'github', type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: TOKEN } };

test('applyMcpChange add writes the definition only', async () => {
  const r = await validateMcpChange(ADD);
  assert.equal(r.ok, true, JSON.stringify(r));
  const res = await applyMcpChange(r.card);
  assert.equal(disk('servers').manual.github.fields[0].secret, true);
  assert.equal(members().includes('manual:github'), false);
  assert.match(res.detail, /It is in no set yet/);
});

test('applyMcpChange edit applies a fresh card', async () => {
  const listed = (await listMcpServers()).servers.find((s) => s.id === 'manual:github');
  const r = await validateMcpChange({ kind: 'edit', name: 'github', type: listed.type, command: listed.command, args: [...listed.args, '--read-only'], env: listed.env });
  assert.equal(r.ok, true, JSON.stringify(r));
  await applyMcpChange(r.card, { retest: () => {} });
  assert.deepEqual(disk('servers').manual.github.args, ['-y', '@modelcontextprotocol/server-github', '--read-only']);
});

test('applyMcpChange edit keeps a stored literal the chat saw masked', async () => {
  const V = 'Kq7Zr2Lm9Xw4Tb8Nc3Vd=Hs6Jp1Gf5Ry0Ue2Wa7Mo';
  await addManualServer('hid', { type: 'stdio', command: 'srv', args: ['--seed', V], env: { CFG: V, MODE: 'a' }, fields: [], description: '' });
  const listed = (await listMcpServers()).servers.find((s) => s.id === 'manual:hid');
  assert.deepEqual(listed.args, ['--seed', '••••']);
  const r = await validateMcpChange({ kind: 'edit', name: 'hid', type: listed.type, command: listed.command, args: listed.args, env: { ...listed.env, MODE: 'b' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(JSON.stringify(r.card).includes(V), false);
  await applyMcpChange(r.card, { retest: () => {} });
  assert.deepEqual(disk('servers').manual.hid.args, ['--seed', V]);
  assert.deepEqual(disk('servers').manual.hid.env, { CFG: V, MODE: 'b' });
  await removeServerEverywhere('manual:hid');
});

test('applyMcpChange edit and remove fail on a stale card', async () => {
  const listed = (await listMcpServers()).servers.find((s) => s.id === 'manual:github');
  const edit = await validateMcpChange({ kind: 'edit', name: 'github', type: 'stdio', command: 'npx', args: ['-y'], env: listed.env });
  const remove = await validateMcpChange({ kind: 'remove', name: 'github' });
  assert.equal(edit.ok && remove.ok, true);
  const stored = (await readMcpStore()).manual.github;
  await editManualServer('github', { ...stored, description: 'changed in Settings' });
  await assert.rejects(applyMcpChange(edit.card, { retest: () => {} }), { status: 409, message: /changed since this card was made/ });
  await assert.rejects(applyMcpChange(remove.card), { status: 409, message: /changed since this card was made/ });
  assert.equal(disk('servers').manual.github.description, 'changed in Settings');
});

test('applyMcpChange of a non-manual id throws and changes nothing', async () => {
  let called = 0;
  const io = { viewContext: async () => ({ catalog: [{ id: 'plugin:acme/docs', source: 'plugin', name: 'docs' }] }),
    remove: async () => { called += 1; }, edit: async () => { called += 1; } };
  await assert.rejects(applyMcpChange({ kind: 'remove', change: { name: 'docs', serverId: 'plugin:acme/docs', expect: 'x' } }, io), /no Manual MCP server/);
  await assert.rejects(applyMcpChange({ kind: 'edit', change: { name: 'docs', serverId: 'plugin:acme/docs', def: {}, expect: 'x' } }, io), /no Manual MCP server/);
  assert.equal(called, 0);
});

test('validateMcpChange (real registry) refuses a taken name', async () => {
  const r = await validateMcpChange(ADD);
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /the name "github" is taken/);
});

test('applyMcpChange import: every server added as Manual, in no set; a taken name mid-way names what was added', async () => {
  const def = (command) => ({ type: 'stdio', command, args: ['--x'], env: {}, fields: [], description: '' });
  const r = await applyMcpChange({ type: 'mcp', kind: 'import', change: { servers: [{ name: 'imp-a', def: def('a-mcp') }, { name: 'imp-b', def: def('b-mcp') }] } });
  assert.equal(r.ok, true);
  assert.match(r.detail, /^Added imp-a, imp-b\. They are in no set yet: turn them on in a set on Connectors › MCP servers$/);
  const s = await readMcpStore();
  assert.ok(Object.hasOwn(s.manual, 'imp-a') && Object.hasOwn(s.manual, 'imp-b'));
  assert.equal(members().some((m) => m === 'manual:imp-a' || m === 'manual:imp-b'), false);
  await assert.rejects(() => applyMcpChange({ type: 'mcp', kind: 'import', change: { servers: [{ name: 'imp-c', def: def('c-mcp') }, { name: 'imp-a', def: def('a2-mcp') }] } }),
    /Added imp-c, then could not add imp-a: the name "imp-a" is taken/);
  const one = await applyMcpChange({ type: 'mcp', kind: 'import', alreadyPresent: [{ id: 'cursor:user:github', name: 'github', from: 'Cursor · ~/.cursor/mcp.json' }],
    change: { servers: [{ name: 'imp-d', def: def('d-mcp') }] } });
  assert.equal(one.detail, 'Added imp-d. It is in no set yet: turn it on in a set on Connectors › MCP servers · 1 already in worca, not added again');
});

test('pinnedProjects: a project pin, a workspace pin (its members), no pin; discoverMcpServers gates user files off a local worca', async () => {
  const io = { listProjects: async () => [{ key: 'shop', path: '/p/shop' }, { key: projectKey('/p/api'), path: '/p/api' }],
    listWorkspaces: async () => [{ id: 'wks-1', projectPaths: ['/p/api'] }] };
  assert.deepEqual(await pinnedProjects({ projectKey: 'shop' }, io), [{ key: 'shop', path: '/p/shop' }]);
  assert.deepEqual(await pinnedProjects({ workspaceId: 'wks-1' }, io), [{ key: projectKey('/p/api'), path: '/p/api' }]);
  assert.deepEqual(await pinnedProjects(null, io), []);
  let seen = null;
  const view = await discoverMcpServers({ pin: { projectKey: 'shop' } }, { ...io, env: { WORCA_CONTAINER: '1' }, discover: async (o) => { seen = o; return { servers: [], files: [] }; } });
  assert.deepEqual(seen, { projects: [{ key: 'shop', path: '/p/shop' }], homeScope: false });
  assert.deepEqual(view.servers, []);
  await discoverMcpServers({ pin: null }, { ...io, env: {}, discover: async (o) => { seen = o; return { servers: [], files: [] }; } });
  assert.deepEqual(seen, { projects: [], homeScope: true });
});
