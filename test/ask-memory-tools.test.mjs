// test/ask-memory-tools.test.mjs — the four memory tools over fake deps (scope matrix, modes, errors),
// the real bundle on a temp home, and the read-only source scans (agent-memory-design.md §9.1, B3, B24).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { defaultMemoryDeps, refreshAskMemoryMount } from '../src/core/ask/memory-deps.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { memoryRoot, GLOBAL_SCOPE, projectScope, readMemory, listSnapshots, MemoryError } from '../src/core/memory-store.mjs';
import { addProject, worcaHome } from '../src/core/projects.mjs';
import { createThread, updateThread } from '../src/core/ask/store.mjs';

useTempHome(after);

function fakeTools({ pin = { projectKey: 'demo-00000001' }, context = null, store = new Map() } = {}) {
  const calls = [];
  const key = (scope, name) => `${scope.kind === 'global' ? 'global' : `projects/${scope.projectKey}`}/${name}`;
  const memory = {
    projectByKey: async (k) => (k === 'demo-00000001' || k === 'other-00000002' ? { key: k, name: k.split('-')[0], path: `/p/${k}` } : null),
    contextProjectKey: async () => context,
    list: async (scope) => [...store.entries()].filter(([k]) => k.startsWith(`${scope.kind === 'global' ? 'global' : `projects/${scope.projectKey}`}/`)).map(([k, v]) => ({ name: k.split('/').pop(), description: v.description, paths: v.paths, source: 'ask:t', updated: 'U', bytes: v.body.length, hasFrontmatter: true, hash: 'h' })),
    read: async (scope, name) => { const v = store.get(key(scope, name)); return v ? { text: `---\nname: ${name}\n---\n${v.body}`, meta: { name, description: v.description, paths: v.paths, source: 'ask:t', updated: 'U', extra: {} }, body: v.body } : null; },
    remember: async (scope, { name, body, description, paths, mode }) => {
      calls.push(['remember', key(scope, name), { body, description, paths, mode }]);
      if (name === 'HUGE') throw new MemoryError('ETOOBIG', 'memory: "HUGE" is 99999 bytes, over the 32768-byte cap');
      const prev = store.get(key(scope, name));
      const next = { description: description ?? prev?.description ?? '', paths: paths ?? prev?.paths ?? [], body: mode === 'append' && prev ? `${prev.body.trimEnd()}\n\n${body.trim()}\n` : body };
      store.set(key(scope, name), next);
      return { created: !prev, bytes: next.body.length };
    },
    forget: async (scope, name) => { calls.push(['forget', key(scope, name)]); return store.delete(key(scope, name)); },
  };
  const tools = createAskTools({
    buildCatalog: async () => ({ projects: [], workspaces: [], workflows: [] }),
    validateProposal: async () => ({ ok: true, card: {} }),
    pinnedScope: () => pin, redact: redactAskText, limits: ASK_LIMITS,
    memory,
  });
  return { tools, calls, store };
}

test('list(): the four memory tools are advertised last, with JSON-Schema inputs and no forbidden words', () => {
  const { tools } = fakeTools();
  const names = tools.list().map((d) => d.name);
  assert.deepEqual(names.slice(-4), ['list_memory', 'read_memory', 'remember', 'forget']);
  for (const d of tools.list().slice(-4)) {
    assert.ok(d.description.length > 20 && d.inputSchema.type === 'object' && d.inputSchema.additionalProperties === false, d.name);
  }
  assert.deepEqual(tools.list().find((d) => d.name === 'remember').inputSchema.required, ['scope', 'name', 'body']);
  assert.deepEqual(tools.list().find((d) => d.name === 'forget').inputSchema.required, ['scope', 'name']);
  assert.deepEqual(tools.list().find((d) => d.name === 'read_memory').inputSchema.required, ['scope', 'name']);
  assert.equal(tools.list().find((d) => d.name === 'list_memory').inputSchema.required, undefined);
});

test('scope resolution: explicit projectKey → pinned project → page project → a pointed error; every key goes through the registry; a pinned workspace is not a project', async () => {
  const explicit = fakeTools({ pin: null });
  await explicit.tools.call('remember', { scope: 'project', projectKey: 'other-00000002', name: 'a', body: 'A' });
  assert.equal(explicit.calls[0][1], 'projects/other-00000002/a');
  await assert.rejects(() => explicit.tools.call('remember', { scope: 'project', projectKey: 'ghost-00000009', name: 'a', body: 'A' }), { name: 'AskToolError', message: 'remember: unknown projectKey "ghost-00000009" — use list_projects' });
  const pinned = fakeTools();
  await pinned.tools.call('remember', { scope: 'project', name: 'a', body: 'A' });
  assert.equal(pinned.calls[0][1], 'projects/demo-00000001/a');
  const page = fakeTools({ pin: null, context: 'other-00000002' });
  await page.tools.call('remember', { scope: 'project', name: 'a', body: 'A' });
  assert.equal(page.calls[0][1], 'projects/other-00000002/a', 'the page-following project is the last fallback');
  // I2-#6: a project removed from the registry after it was pinned (or after the page moved on)
  // must not create a scope for a project that no longer exists — the explicit path already checked.
  const stale = fakeTools({ pin: { projectKey: 'ghost-00000009' } });
  await assert.rejects(() => stale.tools.call('remember', { scope: 'project', name: 'a', body: 'A' }),
    { name: 'AskToolError', message: 'remember: project "ghost-00000009" is no longer registered — use list_projects' });
  const stalePage = fakeTools({ pin: null, context: 'ghost-00000009' });
  await assert.rejects(() => stalePage.tools.call('read_memory', { scope: 'project', name: 'a' }),
    { name: 'AskToolError', message: 'read_memory: project "ghost-00000009" is no longer registered — use list_projects' });
  const none = fakeTools({ pin: null });
  await assert.rejects(() => none.tools.call('remember', { scope: 'project', name: 'a', body: 'A' }), /remember: which project\? pass projectKey \(see list_projects\) or pin a project for this chat/);
  const ws = fakeTools({ pin: { workspaceId: 'wks-team-0000abcd' } });
  await assert.rejects(() => ws.tools.call('read_memory', { scope: 'project', name: 'a' }), /read_memory: the pinned scope is a workspace — pass projectKey for the member project this belongs to/);
  await assert.rejects(() => ws.tools.call('forget', { scope: 'both', name: 'a' }), /forget: scope must be "global" or "project"/);
  await ws.tools.call('remember', { scope: 'global', name: 'g', body: 'G' });
  assert.equal(ws.calls.at(-1)[1], 'global/g', 'global never needs a project');
});

test('remember: replace vs append, description/paths kept when omitted, paths as string or array, the result shape, store errors', async () => {
  const { tools, calls, store } = fakeTools();
  let r = await tools.call('remember', { scope: 'global', name: 'style', body: 'Terse.\n', description: 'Commit style', paths: 'src/**, test/**' });
  assert.deepEqual(r, { scope: 'global', projectKey: null, scopeKey: 'global', name: 'style', bytes: 7, created: true, mode: 'replace' });
  assert.deepEqual(calls.at(-1)[2], { body: 'Terse.\n', description: 'Commit style', paths: ['src/**', 'test/**'], mode: 'replace' });
  r = await tools.call('remember', { scope: 'global', name: 'style', body: 'Also no emoji.', mode: 'append' });
  assert.equal(r.created, false); assert.equal(r.mode, 'append');
  assert.deepEqual(calls.at(-1)[2], { body: 'Also no emoji.', description: undefined, paths: undefined, mode: 'append' }, 'omitted meta is passed as undefined: the bundle keeps the existing values');
  assert.equal(store.get('global/style').body, 'Terse.\n\nAlso no emoji.\n');
  // Models commonly send JSON null for an optional field: null means "omitted", never "clear".
  await tools.call('remember', { scope: 'global', name: 'style', body: 'Still terse.', mode: 'append', description: null, paths: null });
  assert.deepEqual(calls.at(-1)[2], { body: 'Still terse.', description: undefined, paths: undefined, mode: 'append' }, 'null meta is treated as omitted');
  await tools.call('remember', { scope: 'global', name: 'style', body: 'x', paths: ['a/**', ' b '] });
  assert.deepEqual(calls.at(-1)[2].paths, ['a/**', 'b']);
  await tools.call('remember', { scope: 'global', name: 'style', body: 'x', paths: [] });
  assert.deepEqual(calls.at(-1)[2].paths, [], 'an empty list clears paths explicitly');
  r = await tools.call('remember', { scope: 'project', name: 'conv', body: 'C' });
  assert.deepEqual({ scope: r.scope, projectKey: r.projectKey, scopeKey: r.scopeKey }, { scope: 'project', projectKey: 'demo-00000001', scopeKey: 'projects/demo-00000001' });
  await assert.rejects(() => tools.call('remember', { scope: 'global', name: 'x', body: '   ' }), /remember: body is required/);
  await assert.rejects(() => tools.call('remember', { scope: 'global', name: '', body: 'x' }), /remember: name is required/);
  await assert.rejects(() => tools.call('remember', { scope: 'global', name: 'x', body: 'x', mode: 'merge' }), /remember: mode must be "replace" or "append"/);
  await assert.rejects(() => tools.call('remember', { scope: 'global', name: 'HUGE', body: 'x' }), { name: 'AskToolError', message: 'remember: "HUGE" is 99999 bytes, over the 32768-byte cap' });
});

test('list_memory / read_memory / forget over the fake store: B24 shapes, every string the model sees redacted', async () => {
  const { tools, store } = fakeTools({ pin: null, context: 'demo-00000001' });
  store.set('global/testing', { description: 'How tests run', paths: ['test/**'], body: 'npm ci.\n' });
  store.set('projects/demo-00000001/conv', { description: 'Naming', paths: [], body: 'kebab.\n' });
  const both = await tools.call('list_memory', {});
  assert.deepEqual(both, {
    global: [{ name: 'testing', description: 'How tests run', paths: ['test/**'], source: 'ask:t', updated: 'U', bytes: 8 }],
    project: { projectKey: 'demo-00000001', files: [{ name: 'conv', description: 'Naming', paths: [], source: 'ask:t', updated: 'U', bytes: 7 }] },
  });
  assert.deepEqual(Object.keys(await tools.call('list_memory', { scope: 'global' })), ['global']);
  const noProject = fakeTools({ pin: null });
  assert.deepEqual(await noProject.tools.call('list_memory', {}), { global: [], project: null }, 'no resolvable project ⇒ null, never an error');
  await assert.rejects(() => noProject.tools.call('list_memory', { scope: 'project' }), /list_memory: which project\?/);
  await assert.rejects(() => tools.call('list_memory', { scope: 'everything' }), /list_memory: scope must be "global" or "project"/);
  const f = await tools.call('read_memory', { scope: 'global', name: 'testing' });
  assert.deepEqual(f, { scope: 'global', projectKey: null, name: 'testing', description: 'How tests run', paths: ['test/**'], source: 'ask:t', updated: 'U', body: 'npm ci.\n' },
    'B24: the parsed meta + body, and NO `text` — the model never needs the fence twice');
  // B24/I2-#4: a credential that leaked into a memory body or hook never reaches the transcript.
  store.set('global/secrets', { description: `token ghp_${'a'.repeat(24)} in the hook`, paths: [], body: `Use ghp_${'b'.repeat(24)} for CI.\n` });
  const red = await tools.call('read_memory', { scope: 'global', name: 'secrets' });
  assert.equal(red.body, 'Use ghp_<redacted> for CI.\n');
  assert.equal(red.description, 'token ghp_<redacted> in the hook');
  const listed = (await tools.call('list_memory', { scope: 'global' })).global.find((e) => e.name === 'secrets');
  assert.equal(listed.description, 'token ghp_<redacted> in the hook', 'list rows are redacted too');
  await assert.rejects(() => tools.call('read_memory', { scope: 'global', name: 'nope' }), /read_memory: no memory file "nope" in global/);
  assert.deepEqual(await tools.call('forget', { scope: 'project', name: 'conv' }), { scope: 'project', projectKey: 'demo-00000001', scopeKey: 'projects/demo-00000001', name: 'conv', removed: true });
  await assert.rejects(() => tools.call('forget', { scope: 'project', name: 'conv' }), /forget: no memory file "conv" in project/);
});

test('the REAL bundle on a temp home: remember writes through the store with an ask: source and a snapshot; forget removes; the mount refreshes by scope', async () => {
  const p = (await addProject({ name: 'realmem', path: process.cwd() })).find((x) => x.name === 'realmem');
  const threadId = 'ask_0000abcd';
  const tools = createAskTools({ ...defaultToolDeps({ threadId }), ...defaultMemoryDeps({ threadId }) });
  assert.equal(await refreshAskMemoryMount({}), null, 'B33: an empty store mounts NOTHING (the spawn stays byte-identical)');
  const r = await tools.call('remember', { scope: 'project', projectKey: p.key, name: 'conventions', body: 'kebab-case files.\n', description: 'Naming rules' });
  assert.equal(r.created, true);
  const f = await readMemory(memoryRoot(), projectScope(p.key), 'conventions');
  assert.equal(f.meta.source, `ask:${threadId}`);
  assert.equal(f.meta.description, 'Naming rules');
  await tools.call('remember', { scope: 'project', projectKey: p.key, name: 'conventions', body: 'And tests next to sources.', mode: 'append' });
  const f2 = await readMemory(memoryRoot(), projectScope(p.key), 'conventions');
  assert.equal(f2.body, 'kebab-case files.\n\nAnd tests next to sources.\n');
  assert.equal(f2.meta.description, 'Naming rules', 'kept across an append that named no description');
  assert.ok((await listSnapshots(memoryRoot(), projectScope(p.key))).length >= 1, 'every store write snapshots');
  await tools.call('remember', { scope: 'global', name: 'style', body: 'Terse commits.\n' });
  const mount = await refreshAskMemoryMount({ projectKey: p.key, projectName: 'realmem' });
  assert.equal(mount, join(worcaHome(), 'ask', 'memory', p.key));
  assert.equal(existsSync(join(mount, '.claude', 'rules', 'worca', 'global', 'style.md')), true);
  assert.equal(existsSync(join(mount, '.claude', 'rules', 'worca', 'project', 'conventions.md')), true);
  const globalOnly = await refreshAskMemoryMount({});
  assert.equal(globalOnly, join(worcaHome(), 'ask', 'memory', 'global'));
  assert.equal(existsSync(join(globalOnly, '.claude', 'rules', 'worca', 'project')), false, 'no project ⇒ global only');
  await assert.rejects(() => refreshAskMemoryMount({ projectKey: 'not a key' }), /invalid projectKey/,
    'a key that is not a registry key never reaches mkdir — and the guard REJECTS (async), so a .catch() caller sees it too');
  assert.deepEqual(await tools.call('forget', { scope: 'global', name: 'style' }), { scope: 'global', projectKey: null, scopeKey: 'global', name: 'style', removed: true });
  assert.equal(await readMemory(memoryRoot(), GLOBAL_SCOPE, 'style'), null);
});

test('the REAL bundle follows the PAGE project through the thread context: projectDir resolves like resolveAskContext, a pinned workspace does not', async () => {
  const p = (await addProject({ name: 'pagemem', path: gitDir('pagemem') })).find((x) => x.name === 'pagemem');
  // What ask-panel.mjs sends on the New / Running / Projects pages: a projectDir, no projectKey.
  const page = createThread();
  updateThread(page.id, { context: { view: 'new', projectDir: p.path, pinned: false } });
  const tools = createAskTools({ ...defaultToolDeps({ threadId: page.id }), ...defaultMemoryDeps({ threadId: page.id }) });
  const r = await tools.call('remember', { scope: 'project', name: 'pagefollow', body: 'From the page.\n' });
  assert.equal(r.projectKey, p.key, 'B30: the page project is resolved from projectDir');
  assert.ok(await readMemory(memoryRoot(), projectScope(p.key), 'pagefollow'));
  const pinnedWs = createThread();
  updateThread(pinnedWs.id, { context: { view: 'new', workspaceId: 'wks-team-0000abcd', pinned: true } });
  const wsTools = createAskTools({ ...defaultToolDeps({ threadId: pinnedWs.id }), ...defaultMemoryDeps({ threadId: pinnedWs.id }) });
  await assert.rejects(() => wsTools.call('remember', { scope: 'project', name: 'x', body: 'y' }),
    /remember: the pinned scope is a workspace — pass projectKey for the member project this belongs to/);
});

test('source scans: tools.mjs still has no imports and no SQL verbs; memory-deps.mjs is the ONE Ask module that imports the store; the MCP child spreads it', () => {
  const tools = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(tools, /^import /m, 'tools.mjs imports nothing');
  assert.doesNotMatch(tools, /\b(INSERT|UPDATE|DELETE)\b/);
  const deps = readFileSync(new URL('../src/core/ask/memory-deps.mjs', import.meta.url), 'utf8');
  assert.match(deps, /from '\.\.\/memory-store\.mjs'/);
  assert.doesNotMatch(deps, /from 'node:fs/, 'no direct fs — the store owns every write');
  assert.match(deps, /export async function refreshAskMemoryMount[\s\S]*?withStoreLock\(memoryRoot\(\), async \(\) =>[\s\S]*?await refreshMount\(/,
    'the mount refresh is serialised with every other in-process store writer (anchored on the function: remember() takes the same lock)');
  const toolDeps = readFileSync(new URL('../src/core/ask/tool-deps.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(toolDeps, /memory-store/, 'tool-deps stays store-free');
  const stdio = readFileSync(new URL('../src/core/ask/mcp-stdio.mjs', import.meta.url), 'utf8');
  assert.match(stdio, /createAskTools\(\{[\s\S]*?defaultMemoryDeps/, 'the MCP child spreads the memory bundle into createAskTools');
});
