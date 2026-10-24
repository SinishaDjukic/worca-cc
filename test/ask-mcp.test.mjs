// test/ask-mcp.test.mjs — Ask Worca's side of the MCP registry (spec §9.1–9.4) over injected readers:
// the targets in play, one resolve per turn or preview, the prompt section's input, the preview body
// and the turn-end worktree notice. The resolver itself is faked: its own rules are tested with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askTargetsInPlay, resolveAskMcp, askMcpPromptInput, askMcpJoinNotice, ASK_MCP_COPY_CAP } from '../src/core/ask/mcp.mjs';

const PROJECTS = [
  { key: 'billing-00000001', name: 'billing', path: '/p/billing' },
  { key: 'shop-00000002', name: 'shop', path: '/p/shop' },
  { key: 'docs-00000003', name: 'docs', path: '/p/docs' },
];
const WS = { id: 'wks-checkout-0000abcd', name: 'checkout', projectKeys: ['billing-00000001', 'shop-00000002'] };
const readers = (worktrees = []) => ({
  listProjects: async () => PROJECTS,
  readWorkspace: async (id) => (id === WS.id ? WS : null),
  listWorktrees: (threadId) => (threadId === 'ask_00000001' ? worktrees : []),
});
const wt = (projectKey) => ({ projectKey });

test('targets: pinned project, then every open worktree by creation order (rank 1 + index); a project in play keeps its first route', async () => {
  const t = await askTargetsInPlay({ ctx: { pinned: true, projectKey: 'billing-00000001' }, threadId: 'ask_00000001' },
    readers([wt('shop-00000002'), wt('billing-00000001'), wt('docs-00000003'), wt('shop-00000002'), wt('gone-00000009')]));
  assert.deepEqual(t, [
    { kind: 'project', key: 'billing-00000001', name: 'billing', route: 'pinned', rank: 0 },
    { kind: 'project', key: 'shop-00000002', name: 'shop', route: 'worktree', rank: 1 },
    { kind: 'project', key: 'docs-00000003', name: 'docs', route: 'worktree', rank: 3 },
  ]);
});

test('targets: a pinned workspace brings its members; No project brings none (no page route); a context without pinned names its scope by key, never by projectDir', async () => {
  const r = readers();
  assert.deepEqual(await askTargetsInPlay({ ctx: { pinned: true, workspaceId: WS.id } }, r), [
    { kind: 'workspace', id: WS.id, name: 'checkout', route: 'pinned', rank: 0, members: [{ key: 'billing-00000001', name: 'billing' }, { key: 'shop-00000002', name: 'shop' }] },
  ]);
  assert.deepEqual(await askTargetsInPlay({ ctx: { pinned: false, projectKey: 'shop-00000002' } }, r), []);
  assert.deepEqual(await askTargetsInPlay({ ctx: { projectDir: '/p/docs' } }, r), []);
  assert.deepEqual(await askTargetsInPlay({ ctx: { projectDir: '/p/docs', projectSource: 'fallback' } }, r), [], 'the dropdown fallback is not the page\'s project');
  assert.deepEqual((await askTargetsInPlay({ ctx: { workspaceId: WS.id } }, r)).map((x) => [x.kind, x.route, x.rank]), [['workspace', 'pinned', 0]]);
  assert.deepEqual(await askTargetsInPlay({ ctx: { pinned: true, projectKey: 'gone-00000009' } }, r), [], 'an unregistered project is no target');
  assert.deepEqual(await askTargetsInPlay({ ctx: { pinned: true, workspaceId: 'wks-gone-00000000' } }, r), []);
  assert.deepEqual(await askTargetsInPlay({ ctx: { pinned: true, projectKey: 'shop-00000002', projectDir: '/p/docs' } }, r), [{ kind: 'project', key: 'shop-00000002', name: 'shop', route: 'pinned', rank: 0 }], 'a pin replaces the page');
  assert.deepEqual(await askTargetsInPlay({ ctx: { projectKey: 'shop-00000002', projectSource: 'fallback' } }, r), [{ kind: 'project', key: 'shop-00000002', name: 'shop', route: 'pinned', rank: 0 }],
    'a named key is the scope; the tag only ever dropped projectDir');
});

test('targets: every member of a workspace in play is in play — a worktree on one adds no target (D13; §5.1: no member Team set)', async () => {
  const pinned = await askTargetsInPlay({ ctx: { pinned: true, workspaceId: WS.id }, threadId: 'ask_00000001' }, readers([wt('shop-00000002'), wt('docs-00000003')]));
  assert.deepEqual(pinned.map((x) => [x.kind, x.key ?? x.id, x.route, x.rank]), [['workspace', WS.id, 'pinned', 0], ['project', 'docs-00000003', 'worktree', 2]]);
  const page = await askTargetsInPlay({ ctx: { workspaceId: WS.id }, threadId: 'ask_00000001' }, readers([wt('billing-00000001')]));
  assert.deepEqual(page.map((x) => [x.kind, x.route]), [['workspace', 'pinned']], 'a context naming a workspace without pinned is its scope');
});

const RESULT = () => ({
  servers: { jira: { type: 'http', url: 'https://j/mcp' } }, env: { MCPSECRET_A41C6F76: 'tok-value-123456', MCP_TIMEOUT: '15000' },
  secretValues: ['tok-value-123456'], grants: ['mcp__jira'], disallowedTools: [], skippedTools: [],
  copies: [{ name: 'jira', copy: 'jira', setId: 'general', setName: 'General', serverId: 'plugin:acme-tools/jira', projects: [], description: 'Jira', renamedFrom: null, provisional: false }],
  skipped: [{ setId: 'billing', setName: 'Billing', serverId: 'plugin:acme-tools/jira', copy: 'jira_billing', reason: 'missing:token' }],
  sets: [{ id: 'general', name: 'General', group: 'general', routes: [], members: 1, started: 1 }],
});

test('resolveAskMcp: surface ask, cap 12, no taken names, the chat\'s choices, teams from the cache per target (ws:<id> for a workspace), MCP_TIMEOUT 60000', async () => {
  const calls = []; const teamCalls = [];
  const deps = { ...readers([wt('docs-00000003')]),   // docs is no member of the workspace: its own target and Team set
    cachedTeamFor: (target) => { teamCalls.push(target); return target.projectKey === 'docs-00000003' ? { home: 'acme/platform', required: [{ name: 'github' }] } : null; },
    resolveRegistry: async (opts) => { calls.push(opts); return RESULT(); } };
  const off = { sets: ['billing'], members: [] };
  const { targets, result } = await resolveAskMcp({ ctx: { pinned: true, workspaceId: WS.id }, threadId: 'ask_00000001', off, model: 'claude-opus-5-5' }, deps);
  assert.equal(targets.length, 2);
  assert.deepEqual(result, RESULT());
  const o = calls[0];
  assert.equal(o.surface, 'ask');
  assert.equal(o.copyCap, 12); assert.equal(ASK_MCP_COPY_CAP, 12);
  assert.deepEqual(o.taken, []);
  assert.deepEqual(o.off, off);
  assert.equal(o.toolNameLimit, 128);
  assert.equal(o.mcpTimeoutMs, 60000);
  assert.deepEqual(o.targets, targets);
  assert.deepEqual(teamCalls, [{ workspaceId: WS.id }, { projectKey: 'docs-00000003' }]);
  assert.deepEqual({ ...o.teams }, { [`ws:${WS.id}`]: null, 'docs-00000003': { home: 'acme/platform', required: [{ name: 'github' }] } });
  await resolveAskMcp({ ctx: {}, model: 'claude-opus-5-5' }, deps);
  assert.deepEqual(calls[1].off, { sets: [], members: [] }, 'no choices ⇒ nothing off');
});

test('resolveAskMcp never throws: a failing reader or resolver reads as no MCP servers', async (t) => {
  const warn = console.warn; console.warn = () => {}; t.after(() => { console.warn = warn; });
  const out = await resolveAskMcp({ ctx: {}, model: 'm' }, { ...readers(), cachedTeamFor: () => null, resolveRegistry: async () => { throw new Error('store unreadable'); } });
  assert.deepEqual(out.targets, []);
  assert.deepEqual(out.result.copies, []);
  assert.deepEqual(out.result.servers, {});
});

const STORE = { projects: Object.assign(Object.create(null), { 'billing-00000001': { sets: ['billing'], includeGeneral: false } }) };
const CATALOG = [{ id: 'plugin:acme-tools/jira', def: { fields: [{ key: 'token', label: 'API token', secret: true, required: true }] } }];
const snapDeps = { readMcpStore: async () => STORE, loadCatalog: async () => CATALOG };

test('askMcpPromptInput: target names and routes, project names for keys, skip texts, the no-General line for a project that excludes General', async () => {
  const targets = [{ kind: 'project', key: 'billing-00000001', name: 'billing', route: 'pinned', rank: 0 },
    { kind: 'workspace', id: WS.id, name: 'checkout', route: 'worktree', rank: 0, members: [{ key: 'billing-00000001', name: 'billing' }, { key: 'shop-00000002', name: 'shop' }] }];
  const result = RESULT();
  result.copies.push({ name: 'sentry_billing', setId: 'billing', setName: 'Billing', projects: ['billing-00000001'], description: 'Sentry' });
  assert.deepEqual(await askMcpPromptInput({ targets, result }, snapDeps), {
    targets: [{ name: 'billing', route: 'pinned' }, { name: 'checkout', route: 'worktree' }],
    copies: [{ name: 'jira', description: 'Jira', setName: 'General', projects: [] }, { name: 'sentry_billing', description: 'Sentry', setName: 'Billing', projects: ['billing'] }],
    skipped: [{ copy: 'jira_billing', setName: 'Billing', reason: 'API token not set' }],
    noGeneral: ['billing'],                    // checkout: shop includes General, so a workspace run does too
    generalCopies: ['jira'],
  });
  assert.equal(await askMcpPromptInput({ targets, result: { ...result, copies: [] } }, snapDeps), null, 'no copies ⇒ no section');
  const gone = await askMcpPromptInput({ targets, result: { ...result, skipped: [{ setId: 'shop', setName: 'Shop', serverId: 'manual:gone', copy: null, reason: 'missing-server' }] } }, snapDeps);
  assert.equal(gone.skipped[0].copy, 'manual:gone', 'a server no longer in the catalog has no copy name: its id stands in');
});

test('askMcpJoinNotice (D17): names the copies a new worktree brings, per project; nothing when no worktree target joined or it brings no copy', async () => {
  const shared = { name: 'linear_platform', projects: ['billing-00000001', 'shop-00000002'] };   // a set both projects use: already running
  const before = { targets: [{ kind: 'project', key: 'billing-00000001', name: 'billing', route: 'pinned', rank: 0 }], result: { ...RESULT(), copies: [shared, { name: 'sentry_billing', projects: ['billing-00000001'] }] } };
  const after = { ...RESULT(), copies: [
    shared, { name: 'postgres-ro_shop', projects: ['shop-00000002'] }, { name: 'sentry_billing', projects: ['billing-00000001'] }, { name: 'sentry_shop', projects: ['shop-00000002'] },
  ] };
  const deps = (worktrees, result = after) => ({ ...readers(worktrees), cachedTeamFor: () => null, resolveRegistry: async () => result });
  const args = { before, ctx: { pinned: true, projectKey: 'billing-00000001' }, threadId: 'ask_00000001', off: null, model: 'claude-opus-5-5' };
  assert.equal(await askMcpJoinNotice(args, deps([wt('shop-00000002')])), "shop's MCP servers (postgres-ro_shop, sentry_shop) join from the next message");
  assert.equal(await askMcpJoinNotice(args, deps([], { ...after, copies: [...after.copies, { name: 'jira_billing', projects: ['billing-00000001'] }] })), null,
    'no new worktree target — a copy added in Settings mid-turn is not a worktree change');
  assert.equal(await askMcpJoinNotice(args, deps([wt('billing-00000001')])), null, 'a worktree on a project already in play');
  assert.equal(await askMcpJoinNotice(args, deps([wt('shop-00000002')], { ...after, copies: after.copies.filter((c) => c.name === 'sentry_billing' || c === shared) })), null, 'its copies are off in this chat');
  assert.equal(await askMcpJoinNotice({ ...args, before: { targets: [], result: { ...RESULT(), copies: [] } } }, deps([])), null,
    'only a worktree target joins: the pinned project a failed start resolve missed is no join');
  const wsBefore = { targets: [{ kind: 'workspace', id: WS.id, name: 'checkout', route: 'pinned', rank: 0, members: [{ key: 'billing-00000001', name: 'billing' }, { key: 'shop-00000002', name: 'shop' }] }], result: before.result };
  assert.equal(await askMcpJoinNotice({ ...args, before: wsBefore, ctx: { pinned: true, workspaceId: WS.id } }, deps([wt('shop-00000002')])), null,
    'a worktree on a member of the workspace in play joins nothing');
});

test('mcpForEngine: a locked-down chat keeps the copies its engine attaches; the rest are skipped with the reason', async () => {
  const { mcpForEngine } = await import('../src/core/ask/mcp.mjs');
  const { skipReasonText } = await import('../src/core/mcp/registry.mjs');
  const r = {
    servers: { local: { type: 'stdio', command: 'node', args: [] }, web: { type: 'http', url: 'https://x.example/mcp' } },
    env: {}, secretValues: [], grants: ['mcp__local', 'mcp__web'], disallowedTools: ['mcp__web__a_very_long_tool'],
    copies: [{ name: 'local', copy: 'local', setId: 'general', setName: 'General', serverId: 's1' }, { name: 'web', copy: 'web', setId: 'general', setName: 'General', serverId: 's2' }],
    skipped: [], skippedTools: [{ name: 'web', tool: 'a_very_long_tool', reason: 'tool-name-too-long:a_very_long_tool' }], sets: [],
  };
  assert.equal(mcpForEngine(r, 'claude'), r, 'Claude attaches every copy');
  assert.equal(mcpForEngine(r, 'gemini'), r, 'Gemini CLI attaches stdio and http servers');
  const codex = mcpForEngine(r, 'codex');
  assert.deepEqual(Object.keys(codex.servers), ['local']);
  assert.deepEqual(codex.copies.map((c) => c.name), ['local']);
  assert.deepEqual(codex.grants, ['mcp__local']);
  assert.deepEqual(codex.disallowedTools, []);
  assert.deepEqual(codex.skippedTools, []);
  assert.deepEqual(codex.skipped, [{ setId: 'general', setName: 'General', serverId: 's2', copy: 'web', reason: 'engine-remote' }]);
  assert.match(skipReasonText(codex.skipped[0], []), /attaches local \(stdio\) servers only/);
});
