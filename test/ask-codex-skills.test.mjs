// test/ask-codex-skills.test.mjs — set skills in a Codex Ask chat (#635). The turn mounts them per message exactly as a
// Claude turn does, hands that one folder to worca's read_file as an extra root for that turn only (the per-message MCP
// config), and lists each skill's SKILL.md in the prompt. Codex has no plugin namespace: a name two sets share becomes
// `<set slug>-<name>`, in the prompt, the notices and the picker preview alike. The codex spawn itself is unchanged.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage, getMessage } from '../src/core/ask/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { askFileRoots, defaultFileDeps } from '../src/core/ask/file-deps.mjs';
import { buildMcpConfig } from '../src/core/ask/spawn.mjs';
import { codexSkillNames, renderCodexSkillsSection } from '../src/core/ask/prompt.mjs';
import { askMcpPreview, askMcpJoinNotice } from '../src/core/ask/mcp.mjs';

const home = useTempHome(after);
// settings.json lives under $HOME/.worca-cc (the Ask slot, the Ask caps): HOME is a scratch dir too.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-codex-skills-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});

const T = 'ask_0000c0de';
const M = 'askm_0000c0de';
const skillsDir = (h, t = T) => join(h, 'ask', t, 'skills');

let fixtures = 0;
function skillDir(name, body = `Do ${name}.`) {
  const dir = join(home, 'fixture-skills', `${name}-${++fixtures}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} help\n---\n${body}\n`);
  return dir;
}
const row = (setId, setName, pluginName, name, over = {}) => ({
  id: `skill:library:${name}`, name, qualifiedName: `${pluginName}:${name}`, pluginName, setId, setName, setSlug: setId === 'general' ? null : setId,
  dir: `/lib/${name}`, projects: [], description: `${name} help`, plugin: null, ...over,
});
/** Two sets that both mount `deploy`, and one skill no other set has. */
const SKILLS = () => ({
  mounted: [
    row('billing', 'Billing', 'billing', 'deploy', { dir: skillDir('deploy', 'Billing deploy steps.') }),
    row('billing', 'Billing', 'billing', 'graphify', { dir: skillDir('graphify') }),
    row('ops', 'Ops', 'ops', 'deploy', { dir: skillDir('deploy', 'Ops deploy steps.') }),
  ],
  plugins: [{ setId: 'billing', setName: 'Billing', pluginName: 'billing', renamedPlugin: false, skills: ['deploy', 'graphify'] },
    { setId: 'ops', setName: 'Ops', pluginName: 'ops', renamedPlugin: false, skills: ['deploy'] }],
  skipped: [], sets: [], blocked: null,
});

test('askFileRoots: a skill root is taken only when it is exactly this thread\'s <skills>/<message> folder', () => {
  const h = '/h/.worca-cc';
  const base = [join(h, 'ask', T, 'wt'), join(h, 'ask', T, 'att'), join(h, 'ask', 'memory')];
  assert.deepEqual(askFileRoots({ home: h, threadId: T }), base);
  assert.deepEqual(askFileRoots({ home: h, threadId: T, skillRoot: join(skillsDir(h), M) }), [...base, join(skillsDir(h), M)]);
  for (const bad of [
    skillsDir(h),                                   // the thread's whole skills folder
    join(skillsDir(h, 'ask_0000beef'), M),          // another chat's
    join(skillsDir(h), M, 'billing'),               // below a message folder
    join(skillsDir(h), 'not-a-message'),
    `${join(skillsDir(h), M)}/../${M}`,             // not normalized
    join('ask', T, 'skills', M),                    // relative
    join(h, 'ask', T, 'wt', M),
  ]) assert.deepEqual(askFileRoots({ home: h, threadId: T, skillRoot: bad }), base, bad);
});

test('read_file: the turn\'s skill root reads its SKILL.md; another message\'s folder and the whole skills dir stay out', () => {
  const h = worcaHome();
  const root = join(skillsDir(h), M);
  const other = join(skillsDir(h), 'askm_0000beef');
  for (const d of [join(root, 'billing', 'skills', 'deploy'), join(other, 'ops', 'skills', 'deploy')]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SKILL.md'), 'the deploy steps\n');
  }
  const file = join(root, 'billing', 'skills', 'deploy', 'SKILL.md');
  const withRoot = defaultFileDeps({ threadId: T, env: { WORCA_ASK_ENGINE: 'codex', WORCA_ASK_SKILL_ROOT: root } }).files;
  assert.match(JSON.stringify(withRoot.readFile({ path: file })), /the deploy steps/);
  assert.throws(() => withRoot.readFile({ path: join(other, 'ops', 'skills', 'deploy', 'SKILL.md') }), /outside this chat's worktrees, attachments and memory and this turn's skills/);
  assert.throws(() => withRoot.readFile({ path: skillsDir(h) }), /outside/);
  // Without the env (a later turn, a turn with no skills) the same file is out of reach.
  const without = defaultFileDeps({ threadId: T, env: { WORCA_ASK_ENGINE: 'codex' } }).files;
  assert.throws(() => without.readFile({ path: file }), /outside this chat's worktrees, attachments and memory$/);
  // A root naming another thread's folder is ignored.
  const foreign = defaultFileDeps({ threadId: 'ask_0000beef', env: { WORCA_ASK_ENGINE: 'codex', WORCA_ASK_SKILL_ROOT: root } }).files;
  assert.throws(() => foreign.readFile({ path: file }), /outside/);
  rmSync(join(h, 'ask', T), { recursive: true, force: true });
  rmSync(join(h, 'ask', 'ask_0000beef'), { recursive: true, force: true });
});

test('buildMcpConfig: the skill root rides a Codex turn\'s per-message config only', () => {
  const env = (o) => buildMcpConfig({ homeBase: '/h', threadId: T, serverPath: '/s.mjs', env: {}, ...o }).mcpServers.worca.env;
  assert.equal(env({ engine: 'codex', skillRoot: '/h/.worca-cc/ask/x' }).WORCA_ASK_SKILL_ROOT, '/h/.worca-cc/ask/x');
  assert.equal('WORCA_ASK_SKILL_ROOT' in env({ engine: 'codex' }), false);
  assert.equal('WORCA_ASK_SKILL_ROOT' in env({ engine: 'claude', skillRoot: '/h/.worca-cc/ask/x' }), false, 'a Claude chat loads skills through --plugin-dir');
});

test('codexSkillNames: a name two sets share becomes <set slug>-<name>; a unique one stays as it is', () => {
  const names = codexSkillNames(SKILLS().mounted);
  assert.deepEqual([...names.entries()], [['billing:deploy', 'billing-deploy'], ['billing:graphify', 'graphify'], ['ops:deploy', 'ops-deploy']]);
  const s = renderCodexSkillsSection({ skills: [{ name: 'graphify', description: 'graph\nhelp', path: '/m/billing/skills/graphify/SKILL.md' }] });
  assert.match(s, /^## Skills from your sets\n/);
  assert.match(s, /read its SKILL\.md with read_file/);
  assert.match(s, /\n- graphify — graph help · \/m\/billing\/skills\/graphify\/SKILL\.md\n/);
});

// ---- the turn ----------------------------------------------------------------------------------------------------
function seed() {
  const thread = createThread();
  const user = appendMessage(thread.id, { role: 'user', text: 'hello' });
  const asst = appendMessage(thread.id, { role: 'assistant', text: '', status: 'streaming' });
  return { thread, user, asst };
}
const reply = (o) => {
  o.onEvent({ type: 'session', sessionId: 'codex:th-1', model: 'gpt-5.5', init: true });
  o.onEvent({ type: 'text', text: 'Answer', parentId: null, from: 'assistant', blocks: ['Answer'], messageId: 'item_1' });
  o.onEvent({ type: 'result', text: 'Answer', isError: false, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, costUsd: 0.01 });
  return { text: 'Answer', exitCode: 0 };
};
function codexTurn(s, over = {}, deps = {}) {
  return createAskTurn({
    threadId: s.thread.id, assistantMessageId: s.asst.id, userMessageId: s.user.id,
    prompt: 'PROMPT', systemPrompt: 'SYS', restoredPrompt: 'RESTORED', model: 'gpt-5.5', effort: 'low', engine: 'codex',
    firstTurn: false, firstText: 'hello', ...over,
    deps: {
      generateTitle: async () => '', failedBecauseSignedOut: async () => false,
      codexPreflight: async () => ({}), codexAskSupport: async () => ({}), codexLockdown: () => ['--disable', 'shell_tool'],
      memoryMount: async () => null, ...deps,
    },
  });
}
const comparable = (o) => {
  const { systemPrompt, mcpConfigPath, onEvent, signal, ...rest } = o;
  return rest;
};

test('a Codex turn: mounted per message, its folder is read_file\'s extra root, the prompt lists each SKILL.md; the spawn is otherwise unchanged and the mount goes after the turn', async () => {
  const s = seed();
  const base = join(worcaHome(), 'ask', s.thread.id, 'skills', s.asst.id);
  const seen = [];
  const turn = codexTurn(s, { skills: SKILLS() }, {
    runClaudeImpl: async (o) => {
      const cfg = JSON.parse(readFileSync(o.mcpConfigPath, 'utf8'));
      seen.push({ o, env: cfg.mcpServers.worca.env, skill: readFileSync(join(base, 'ops', 'skills', 'deploy', 'SKILL.md'), 'utf8') });
      return reply(o);
    },
  });
  const out = await turn.run();
  assert.equal(out.status, 'done');
  assert.equal(seen[0].env.WORCA_ASK_SKILL_ROOT, base, 'exactly this message\'s folder');
  assert.match(seen[0].skill, /Ops deploy steps/);
  const sys = seen[0].o.systemPrompt;
  assert.ok(sys.startsWith('SYS\n\n## Skills from your sets\n'), 'the section goes right after the route\'s prompt');
  for (const [name, plugin, dir] of [['billing-deploy', 'billing', 'deploy'], ['graphify', 'billing', 'graphify'], ['ops-deploy', 'ops', 'deploy']]) {
    assert.ok(sys.includes(`- ${name} — ${dir} help · ${join(base, plugin, 'skills', dir, 'SKILL.md')}`), name);
  }
  assert.equal(existsSync(base), false, 'removed in finally, as on Claude');
  // The lockdown and the rest of the spawn: what a Codex turn without skills gets, nothing added.
  const s2 = seed();
  const plain = [];
  await codexTurn(s2, {}, { runClaudeImpl: async (o) => { plain.push(o); return reply(o); } }).run();
  assert.deepEqual(comparable(seen[0].o), comparable(plain[0]));
  assert.equal(seen[0].o.askLockdown, true);
  assert.equal(seen[0].o.sandbox, 'read-only');
  for (const k of ['pluginDirs', 'addDirs', 'allowedTools', 'tools']) assert.equal(k in seen[0].o, false, k);
});

test('the next message\'s mount replaces this one: a folder an earlier turn left is swept, only the new one is the root', async () => {
  const s = seed();
  const parent = join(worcaHome(), 'ask', s.thread.id, 'skills');
  mkdirSync(join(parent, 'askm_0000dead', 'billing'), { recursive: true });
  const seen = [];
  await codexTurn(s, { skills: SKILLS() }, {
    runClaudeImpl: async (o) => { seen.push(JSON.parse(readFileSync(o.mcpConfigPath, 'utf8')).mcpServers.worca.env); return reply(o); },
  }).run();
  assert.equal(seen[0].WORCA_ASK_SKILL_ROOT, join(parent, s.asst.id));
  assert.equal(existsSync(join(parent, 'askm_0000dead')), false);
  assert.equal(existsSync(join(parent, s.asst.id)), false);
});

test('a Codex turn ignores Claude Code\'s --plugin-dir block, and names a skill it could not copy as the chat would load it', async (t) => {
  const w = console.warn; console.warn = () => {}; t.after(() => { console.warn = w; });
  const s = seed();
  const result = { ...SKILLS(), blocked: 'sideload-disabled' };
  const base = join(worcaHome(), 'ask', s.thread.id, 'skills', s.asst.id);
  const seen = [];
  const turn = codexTurn(s, { skills: result }, {
    materializeSkillMount: async ({ base: b }) => {
      mkdirSync(join(b, 'billing', 'skills', 'graphify'), { recursive: true });
      return { base: b, pluginDirs: [join(b, 'billing')], plugins: [{ setId: 'billing', pluginName: 'billing', dir: join(b, 'billing'), skills: ['deploy', 'graphify'] }],
        failed: [{ setId: 'billing', pluginName: 'billing', name: 'deploy', error: 'over the skill size limits' }] };
    },
    runClaudeImpl: async (o) => { seen.push(JSON.parse(readFileSync(o.mcpConfigPath, 'utf8')).mcpServers.worca.env); return reply(o); },
  });
  await turn.run();
  assert.equal(seen[0].WORCA_ASK_SKILL_ROOT, base);
  const notes = getMessage(s.asst.id).blocks.filter((b) => b.kind === 'notice').map((b) => b.text);
  assert.ok(notes.includes('skills from sets not loaded: billing-deploy, ops-deploy (they could not be copied for this turn)'), JSON.stringify(notes));
});

test('a Codex turn whose mount fails runs without the root and says so', async (t) => {
  const w = console.warn; console.warn = () => {}; t.after(() => { console.warn = w; });
  const s = seed();
  const seen = [];
  const turn = codexTurn(s, { skills: SKILLS() }, {
    materializeSkillMount: async () => { throw new Error('disk full'); },
    runClaudeImpl: async (o) => { seen.push({ env: JSON.parse(readFileSync(o.mcpConfigPath, 'utf8')).mcpServers.worca.env, sys: o.systemPrompt }); return reply(o); },
  });
  await turn.run();
  assert.equal('WORCA_ASK_SKILL_ROOT' in seen[0].env, false);
  assert.equal(seen[0].sys.includes('## Skills from your sets'), false);
  assert.ok(getMessage(s.asst.id).blocks.some((b) => b.kind === 'notice' && /skills from sets not loaded/.test(b.text)));
});

// ---- the picker preview and the join notice --------------------------------------------------------------------
const PROJECTS = [{ key: 'billing-00000001', name: 'billing', path: '/p/billing' }];
const MCP = () => ({
  servers: {}, env: {}, secretValues: [], grants: [], disallowedTools: [], skippedTools: [], skipped: [],
  copies: [{ name: 'jira', copy: 'jira', setId: 'billing', setName: 'Billing', serverId: 'plugin:acme/jira', projects: [], description: 'Jira', renamedFrom: null, provisional: false }],
  sets: [{ id: 'billing', name: 'Billing', group: 'set', routes: [], members: 1, started: 1 }],
});
const previewDeps = (skills) => ({
  listProjects: async () => PROJECTS, readWorkspace: async () => null, listWorktrees: () => [],
  cachedTeamFor: () => null, cachedSkillTeamFor: async () => null,
  resolveRegistry: async () => MCP(), resolveSkillRegistry: async () => skills,
  readMcpStore: async () => ({ projects: {} }), loadCatalog: async () => [],
});

test('askMcpPreview on a Codex chat: skills under the names the chat loads them by, no servers, and how many servers wait for Claude', async () => {
  const sk = { ...SKILLS(), blocked: 'sideload-disabled', skipped: [{ setId: 'ops', setName: 'Ops', pluginName: 'ops', qualifiedName: 'ops:notes', skillId: 'skill:library:notes', name: 'notes', reason: 'off' }],
    sets: [{ id: 'billing', name: 'Billing', group: 'set', routes: [], skills: 2, started: 2 }, { id: 'ops', name: 'Ops', group: 'set', routes: [], skills: 2, started: 1 }] };
  const p = await askMcpPreview({ ctx: { pinned: true, projectKey: 'billing-00000001' }, model: 'gpt-5.5', engine: 'codex' }, previewDeps(sk));
  assert.deepEqual(p.skills.mounted.map((m) => m.qualifiedName), ['billing-deploy', 'graphify', 'ops-deploy']);
  assert.equal(p.skills.skipped[0].qualifiedName, 'notes');
  assert.equal(p.skills.started, 3, 'Claude Code\'s --plugin-dir block does not apply on Codex');
  assert.deepEqual(p.skills.layer, { blocked: null, text: null });
  assert.deepEqual([p.copies, p.started, p.skipped, p.codexServers], [[], 0, [], 1]);
  assert.deepEqual(p.sets.map((x) => [x.id, x.members, x.started, x.skills, x.startedSkills]), [['billing', 0, 0, 2, 2], ['ops', 0, 0, 2, 1]]);
  // A Claude chat's preview is unchanged: qualified names, the copy, no codexServers.
  const c = await askMcpPreview({ ctx: { pinned: true, projectKey: 'billing-00000001' }, model: 'claude-opus-5-5' }, previewDeps({ ...SKILLS(), sets: [] }));
  assert.deepEqual(c.skills.mounted.map((m) => m.qualifiedName), ['billing:deploy', 'billing:graphify', 'ops:deploy']);
  assert.equal(c.started, 1);
  assert.equal('codexServers' in c, false);
});

test('askMcpJoinNotice on a Codex chat: only the skills a new worktree brings, under the Codex names', async () => {
  const joined = SKILLS().mounted.map((m) => ({ ...m, projects: ['billing-00000001'] }));
  const deps = { ...previewDeps({ ...SKILLS(), mounted: joined }), listWorktrees: () => [{ projectKey: 'billing-00000001', path: '/wt' }] };
  const before = { targets: [], result: { copies: [] }, skills: { ...SKILLS(), mounted: [] } };
  const text = await askMcpJoinNotice({ before, ctx: {}, threadId: 'ask_00000001', model: 'gpt-5.5', engine: 'codex' }, deps);
  assert.equal(text, "billing's skills (billing-deploy, graphify, ops-deploy) join from the next message");
});
