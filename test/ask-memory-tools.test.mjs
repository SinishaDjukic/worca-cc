// test/ask-memory-tools.test.mjs — the four memory tools over fake deps (scope matrix, modes, errors),
// the real bundle on a temp home (agent-memory-design.md §9.1, B3, B24). The read-only source scans are
// rows of ask-tools' write-free guard.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAskTools } from '../src/core/ask/tools.mjs';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { redactAskText } from '../src/core/ask/redact.mjs';
import { defaultToolDeps } from '../src/core/ask/tool-deps.mjs';
import { defaultMemoryDeps, refreshAskMemoryMount } from '../src/core/ask/memory-deps.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { memoryRoot, GLOBAL_SCOPE, projectScope, readMemory, listMemory, listSnapshots, MemoryError } from '../src/core/memory-store.mjs';
import { addProject, worcaHome } from '../src/core/projects.mjs';
import { createThread, updateThread } from '../src/core/ask/store.mjs';
import { checkRows } from './helpers/rows.mjs';
import { scopeRefusalText } from '../src/core/ask/scope.mjs';

useTempHome(after);

function fakeTools({ pin = { projectKey: 'demo-00000001' }, store = new Map(), memoryExtra = {} } = {}) {
  const calls = [];
  const key = (scope, name) => `${scope.kind === 'global' ? 'global' : `projects/${scope.projectKey}`}/${name}`;
  const memory = {
    projectByKey: async (k) => (k === 'demo-00000001' || k === 'other-00000002' ? { key: k, name: k.split('-')[0], path: `/p/${k}` } : null),
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
    ...memoryExtra,
  };
  const tools = createAskTools({
    buildCatalog: async () => ({ projects: [], workspaces: [], workflows: [] }),
    validateProposal: async () => ({ ok: true, card: {} }),
    pinnedScope: () => pin, redact: redactAskText, limits: ASK_LIMITS,
    memory,
  });
  return { tools, calls, store };
}

test('P4 scope resolution: a write\'s explicit projectKey must be the chat\'s project, reads stay open; the chat\'s project fills a missing key; No project has no project memory to default to; a pinned workspace is not a project', async () => {
  const explicit = fakeTools({ pin: null });
  await assert.rejects(() => explicit.tools.call('remember', { scope: 'project', projectKey: 'other-00000002', name: 'a', body: 'A' }),
    { name: 'AskToolError', message: `remember: ${scopeRefusalText(null, { projectKey: 'other-00000002' })}` });
  assert.deepEqual(await explicit.tools.call('list_memory', { scope: 'project', projectKey: 'other-00000002' }), { project: { projectKey: 'other-00000002', files: [] } });
  await assert.rejects(() => fakeTools({ pin: { projectKey: 'ghost-00000009' } }).tools.call('remember', { scope: 'project', projectKey: 'ghost-00000009', name: 'a', body: 'A' }), { name: 'AskToolError', message: 'remember: unknown projectKey "ghost-00000009" — use list_projects' });
  const pinned = fakeTools();
  await pinned.tools.call('remember', { scope: 'project', name: 'a', body: 'A' });
  assert.equal(pinned.calls[0][1], 'projects/demo-00000001/a');
  const page = fakeTools({ pin: null });
  await assert.rejects(() => page.tools.call('remember', { scope: 'project', name: 'a', body: 'A' }), { name: 'AskToolError', message: `remember: ${scopeRefusalText(null)}` });
  // I2-#6: a project removed from the registry after it was pinned (or after the page moved on)
  // must not create a scope for a project that no longer exists — the explicit path already checked.
  const stale = fakeTools({ pin: { projectKey: 'ghost-00000009' } });
  await assert.rejects(() => stale.tools.call('remember', { scope: 'project', name: 'a', body: 'A' }),
    { name: 'AskToolError', message: 'remember: project "ghost-00000009" is no longer registered — use list_projects' });
  const stalePage = fakeTools({ pin: null });
  await assert.rejects(() => stalePage.tools.call('read_memory', { scope: 'project', name: 'a' }), /read_memory: which project\? pass projectKey/, 'a page context is never read');
  const none = fakeTools({ pin: null });
  await assert.rejects(() => none.tools.call('remember', { scope: 'project', name: 'a', body: 'A' }), { name: 'AskToolError', message: `remember: ${scopeRefusalText(null)}` });
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
  const { tools, store } = fakeTools({ pin: { projectKey: 'demo-00000001' } });
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

test('the REAL memory bundle: remember/forget through the store (ask: source, snapshot, mount refresh) and the page-project resolution', async () => {
  await checkRows([
    { name: 'the REAL bundle on a temp home: remember writes through the store with an ask: source and a snapshot; forget removes; the mount refreshes by scope', run: async () => {
      const p = (await addProject({ name: 'realmem', path: process.cwd() })).find((x) => x.name === 'realmem');
      const th = createThread();
      updateThread(th.id, { context: { pinned: true, projectKey: p.key } });
      const threadId = th.id;
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
    } },
    { name: 'the REAL bundle: No project (even with a stale page projectDir) has no project memory to default to; contextProjectKey is gone; a pinned workspace still needs a member key', run: async () => {
      const p = (await addProject({ name: 'pagemem', path: gitDir('pagemem') })).find((x) => x.name === 'pagemem');
      // What ask-panel.mjs sends on the New / Running / Projects pages: a projectDir, no projectKey.
      const page = createThread();
      updateThread(page.id, { context: { view: 'new', projectDir: p.path, pinned: false } });
      const tools = createAskTools({ ...defaultToolDeps({ threadId: page.id }), ...defaultMemoryDeps({ threadId: page.id }) });
      await assert.rejects(() => tools.call('remember', { scope: 'project', name: 'pagefollow', body: 'From the page.\n' }), { message: `remember: ${scopeRefusalText(null)}` });
      assert.equal('contextProjectKey' in defaultMemoryDeps({ threadId: page.id }).memory, false);
      // MCP registry §9.1: the generic dropdown fallback is not the page's project — memory never defaults to it.
      const fallback = createThread();
      updateThread(fallback.id, { context: { view: 'settings', projectDir: p.path, projectSource: 'fallback', pinned: false } });
      const fbTools = createAskTools({ ...defaultToolDeps({ threadId: fallback.id }), ...defaultMemoryDeps({ threadId: fallback.id }) });
      await assert.rejects(() => fbTools.call('remember', { scope: 'project', name: 'pagefollow', body: 'From the page.\n' }), { message: `remember: ${scopeRefusalText(null)}` });
      assert.equal(await readMemory(memoryRoot(), projectScope(p.key), 'pagefollow'), null);
      const pinnedWs = createThread();
      updateThread(pinnedWs.id, { context: { view: 'new', workspaceId: 'wks-team-0000abcd', pinned: true } });
      const wsTools = createAskTools({ ...defaultToolDeps({ threadId: pinnedWs.id }), ...defaultMemoryDeps({ threadId: pinnedWs.id }) });
      await assert.rejects(() => wsTools.call('remember', { scope: 'project', name: 'x', body: 'y' }),
        /remember: the pinned scope is a workspace — pass projectKey for the member project this belongs to/);
    } },
  ]);
});

test('team memory: list_memory adds the read-only team rows only when the deps provide them; read_memory falls back to a team note; forget names it', async () => {
  const team = [{ name: 'deploy-trap', description: 'Read before deploying', paths: [], updated: '2026-10-16T09:00:00.000Z', author: 'Ana', shadowed: false }];
  const { tools } = fakeTools({ pin: { projectKey: 'demo-00000001' }, memoryExtra: {
    listTeam: async () => team,
    readTeam: async (_k, name) => (name === 'deploy-trap' ? { meta: { name, description: 'Read before deploying', paths: [], updated: team[0].updated }, body: 'Migrate first.\n', author: 'Ana' } : null),
  } });
  const listed = await tools.call('list_memory', { scope: 'project' });
  assert.deepEqual(listed.project.team.map((t) => [t.name, t.author]), [['deploy-trap', 'Ana']]);
  const read = await tools.call('read_memory', { scope: 'project', name: 'deploy-trap' });
  assert.equal(read.layer, 'team');
  assert.equal(read.readOnly, true);
  assert.match(read.body, /Migrate first/);
  await assert.rejects(tools.call('forget', { scope: 'project', name: 'deploy-trap' }), /teammate's shared note with no copy on this machine/);
  const { tools: plain } = fakeTools({ pin: { projectKey: 'demo-00000001' } });
  assert.equal('team' in (await plain.call('list_memory', { scope: 'project' })).project, false, 'no team deps (or off): the result shape is unchanged');
  const { tools: broken } = fakeTools({ pin: { projectKey: 'demo-00000001' }, memoryExtra: { listTeam: async () => { throw new Error('team.json unreadable'); } } });
  const half = (await broken.call('list_memory', { scope: 'project' })).project;
  assert.deepEqual([Array.isArray(half.files), 'team' in half], [true, false], 'a broken team snapshot never costs list_memory its local half');
});

test('team memory, the REAL bundle: the Ask mount carries an opted-in project\'s team folder (local names shadow), list/read show the team rows, remember changes a team note whole, off empties the folder', async () => {
  const { writeProjectSettings } = await import('../src/core/settings-cascade.mjs');
  const { teamNoteText, _testing: team } = await import('../src/core/memory-team.mjs');
  const { writeMemory } = await import('../src/core/memory-store.mjs');
  const { readdirSync } = await import('node:fs');
  const p = (await addProject({ name: 'teamask', path: gitDir('teamask') })).find((x) => x.name === 'teamask');
  writeProjectSettings({ projectKey: p.key }, { 'memory.team': true });
  const at = new Date().toISOString();   // a fresh snapshot: the turn's background refresh does not fetch
  const entry = (name, body) => team.noteEntry(name, teamNoteText({ name, description: `About ${name}`, paths: [], updated: at }, body, { author: 'Ana' }));
  team.writeSnapshot(p.key, { schema: 1, branch: 'worca-memory', headSha: 'f'.repeat(40), fetchedAt: at, missing: false,
    notes: { deploy: entry('deploy', 'Migrate first.'), style: entry('style', 'Team style.') } });
  await writeMemory(memoryRoot(), projectScope(p.key), 'style', '---\nname: style\ndescription: Mine\n---\nMy style.\n', { source: 'user' });
  const base = await refreshAskMemoryMount({ projectKey: p.key, projectName: 'teamask' });
  const teamDir = join(base, '.claude', 'rules', 'worca', 'team');
  assert.deepEqual(readdirSync(teamDir), ['deploy.md'], 'style is shadowed by the local note');
  const th = createThread();
  updateThread(th.id, { context: { pinned: true, projectKey: p.key } });   // P4: writes go to the chat's own project
  const tools = createAskTools({ ...defaultToolDeps({ threadId: th.id }), ...defaultMemoryDeps({ threadId: th.id }) });
  const listed = await tools.call('list_memory', { scope: 'project', projectKey: p.key });
  assert.deepEqual(listed.project.team.map((t) => [t.name, t.author, t.shadowed]), [['deploy', 'Ana', false], ['style', 'Ana', true]]);
  const read = await tools.call('read_memory', { scope: 'project', projectKey: p.key, name: 'deploy' });
  assert.deepEqual([read.layer, read.readOnly, read.author], ['team', true, 'Ana']);
  // remember on a team-only note changes THAT note (D2): append adds under the team's body, an omitted hook keeps the
  // team's — the write replaces the team version for everyone, so it must never drop the teammate's text.
  await tools.call('remember', { scope: 'project', projectKey: p.key, name: 'deploy', mode: 'append', body: 'Also warm the cache.' });
  const changed = await readMemory(memoryRoot(), projectScope(p.key), 'deploy');
  assert.match(changed.body, /Migrate first\.\n\nAlso warm the cache\./);
  assert.equal(changed.meta.description, 'About deploy');
  assert.equal(changed.meta.extra.author, undefined, 'never the team\'s extras');
  writeProjectSettings({ projectKey: p.key }, { 'memory.team': null });
  await refreshAskMemoryMount({ projectKey: p.key, projectName: 'teamask' });
  assert.deepEqual(readdirSync(teamDir), [], 'off: the team folder is emptied');
  assert.equal('team' in (await tools.call('list_memory', { scope: 'project', projectKey: p.key })).project, false, 'off: the shape before team memory');
});

test('team memory, the REAL bundle: remember of a teammate\'s note keeps a hook longer than this machine\'s cap whole (D4, D13)', async () => {
  const { writeProjectSettings } = await import('../src/core/settings-cascade.mjs');
  const { teamNoteText, _testing: team } = await import('../src/core/memory-team.mjs');
  const p = (await addProject({ name: 'teamhook', path: gitDir('teamhook') })).find((x) => x.name === 'teamhook');
  writeProjectSettings({ projectKey: p.key }, { 'memory.team': true });
  const at = new Date().toISOString();
  const hook = `Read before deploying: ${'the staging pipeline needs a manual approval, '.repeat(4)}end.`;   // a teammate's cap is higher
  assert.ok(hook.length > 160);
  team.writeSnapshot(p.key, { schema: 1, branch: 'worca-memory', headSha: 'f'.repeat(40), fetchedAt: at, missing: false, deleted: [],
    notes: { longhook: team.noteEntry('longhook', teamNoteText({ name: 'longhook', description: hook, paths: [], updated: at }, 'Team body.', { author: 'Ana' })) } });
  const th = createThread();
  updateThread(th.id, { context: { pinned: true, projectKey: p.key } });   // P4: writes go to the chat's own project
  const tools = createAskTools({ ...defaultToolDeps({ threadId: th.id }), ...defaultMemoryDeps({ threadId: th.id }) });
  await tools.call('remember', { scope: 'project', projectKey: p.key, name: 'longhook', mode: 'append', body: 'Also warm the cache.' });
  const changed = await readMemory(memoryRoot(), projectScope(p.key), 'longhook');
  assert.equal(changed.meta.description, hook, 'the team\'s hook, whole: clipped here, the share would cut it for everyone');
  assert.match(changed.body, /Team body\.\n\nAlso warm the cache\./);
});

test('team memory, the REAL bundle: a case variant of a teammate\'s note name reads, appends to and names the team\'s note (m1, D4, D9)', async () => {
  const { writeProjectSettings } = await import('../src/core/settings-cascade.mjs');
  const { teamNoteText, _testing: team } = await import('../src/core/memory-team.mjs');
  const p = (await addProject({ name: 'teamcase', path: gitDir('teamcase') })).find((x) => x.name === 'teamcase');
  writeProjectSettings({ projectKey: p.key }, { 'memory.team': true });
  const at = new Date().toISOString();
  team.writeSnapshot(p.key, { schema: 1, branch: 'worca-memory', headSha: 'f'.repeat(40), fetchedAt: at, missing: false, deleted: [],
    notes: { Deploy: team.noteEntry('Deploy', teamNoteText({ name: 'Deploy', description: 'Read before deploying', paths: ['infra/**'], updated: at }, 'Migrate first.', { author: 'Ana' })) } });
  const th = createThread();
  updateThread(th.id, { context: { pinned: true, projectKey: p.key } });
  const tools = createAskTools({ ...defaultToolDeps({ threadId: th.id }), ...defaultMemoryDeps({ threadId: th.id }) });
  const read = await tools.call('read_memory', { scope: 'project', projectKey: p.key, name: 'deploy' });
  assert.deepEqual([read.layer, read.name], ['team', 'Deploy'], 'read_memory finds the team\'s note under its own spelling');
  await assert.rejects(tools.call('forget', { scope: 'project', projectKey: p.key, name: 'DEPLOY' }), /"Deploy" is a teammate's shared note/);
  const r = await tools.call('remember', { scope: 'project', projectKey: p.key, name: 'deploy', mode: 'append', body: 'Also warm the cache.' });
  assert.equal(r.name, 'Deploy', 'the write keeps the team\'s spelling');
  assert.deepEqual((await listMemory(memoryRoot(), projectScope(p.key))).map((e) => e.name), ['Deploy'], 'never a second spelling that would replace the team\'s note');
  const changed = await readMemory(memoryRoot(), projectScope(p.key), 'Deploy');
  assert.match(changed.body, /Migrate first\.\n\nAlso warm the cache\./, 'append adds under the team\'s body');
  assert.deepEqual([changed.meta.description, changed.meta.paths], ['Read before deploying', ['infra/**']]);
});
