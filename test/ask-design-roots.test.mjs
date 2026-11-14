// test/ask-design-roots.test.mjs — a locked-down Design chat reads the design (Design P8 Task 3, L8.10, P5 Contract
// issue 10). Its file tools are worca's read_file / grep / glob, which reach only their roots: the design's work/ folder
// and its project go first (so grep and glob default to work/), shape-checked like the skill root, carried to the MCP
// child as WORCA_ASK_DESIGN_ROOTS (or to the relay), and the "outside" message stops counting roots.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskTurn } from '../src/core/ask/turn.mjs';
import { createThread, appendMessage } from '../src/core/ask/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { askFileRoots, defaultFileDeps, createAskFileReader } from '../src/core/ask/file-deps.mjs';
import { buildMcpConfig } from '../src/core/ask/spawn.mjs';
import { buildDesignSystemPrompt } from '../src/core/ask/prompt.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc (the Ask slot, the Ask caps): HOME is a scratch dir too.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-design-roots-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});

const POSIX = process.platform !== 'win32';
const T = 'ask_0000abcd';
const ID = 'd_0123456789ab';
// Synthetic roots that do not exist, built with resolve(): on win32 a bare '/h/…' is not normalized and would be dropped.
const h = resolve('/h/.worca-cc');
const WORK = join(h, 'design', ID, 'work');
const P = resolve('/p/app');
const baseRoots = [join(h, 'ask', T, 'wt'), join(h, 'ask', T, 'att'), join(h, 'ask', 'memory')];
const roots = (design) => askFileRoots({ home: h, threadId: T, design });
const DEFAULT_OUTSIDE = /outside this chat's worktrees, attachments and memory$/;

test('askFileRoots: design roots come first, work/ then the project, before the chat\'s own', () => {
  assert.deepEqual(roots({ workDir: WORK, projectDir: P }), [WORK, P, ...baseRoots]);
  assert.deepEqual(roots({ workDir: WORK }), [WORK, ...baseRoots]);
  assert.deepEqual(askFileRoots({ home: h, threadId: T }), baseRoots);
  const skill = join(h, 'ask', T, 'skills', 'askm_0000abcd');
  assert.deepEqual(askFileRoots({ home: h, threadId: T, skillRoot: skill, design: { workDir: WORK } }), [WORK, ...baseRoots, skill], 'the skill root stays last');
  assert.deepEqual(askFileRoots({ home: h, threadId: '../x', design: { workDir: WORK } }), [], 'no thread, no roots at all');
});

test('askFileRoots: only exactly a design\'s work folder, and a project outside the home or in its projects folder', () => {
  for (const bad of [
    join(h, 'design', ID),                              // the design folder itself (versions/, dist/)
    join(h, 'design', 'd_x', 'work'),                   // not a design id
    `${WORK}/../work`,                                  // not normalized
    join(h, 'store'),
    resolve('/etc'),
    join('relative', 'work'),
    '',
    5,
    join(resolve('/other/.worca-cc'), 'design', ID, 'work'),   // another home's design
    join(WORK, 'sub'),                                  // below work/
  ]) assert.deepEqual(roots({ workDir: bad, projectDir: P }), baseRoots, `workDir ${String(bad)}: the whole design is dropped`);
  for (const bad of [
    h,
    join(h, 'store'),
    join(h, 'projects'),                                // the projects folder itself, every project in it
    join(h, 'projects', 'app', 'src'),                  // below a project there: not a project
    WORK,                                               // inside the home
    dirname(h),                                         // holds the home
    'rel',
    '/p/../etc',
    5,
  ]) assert.deepEqual(roots({ workDir: WORK, projectDir: bad }), [WORK, ...baseRoots], `projectDir ${String(bad)}`);
  // worca's default projects folder (settings.mjs worcaProjectsFolder) is inside the home: its direct children are kept.
  assert.deepEqual(roots({ workDir: WORK, projectDir: join(h, 'projects', 'app') }), [WORK, join(h, 'projects', 'app'), ...baseRoots]);
  for (const bad of [null, [], { workDir: 5 }, 'x', 7, [WORK]]) assert.deepEqual(roots(bad), baseRoots, `design ${JSON.stringify(bad)}`);
});

test('defaultFileDeps: the MCP child reads WORCA_ASK_DESIGN_ROOTS; bad JSON or a bad shape gives no design root', (t) => {
  const work = join(worcaHome(), 'design', ID, 'work');
  t.after(() => rmSync(join(worcaHome(), 'design'), { recursive: true, force: true }));
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'plan.json'), '{"title":"ShipRadar"}\n');
  const files = (raw) => defaultFileDeps({ threadId: T, env: { WORCA_ASK_ENGINE: 'codex', WORCA_ASK_DESIGN_ROOTS: raw } }).files;
  const plan = join(work, 'plan.json');
  assert.match(files(JSON.stringify({ workDir: work })).readFile({ path: plan }).text, /ShipRadar/);
  assert.throws(() => files(JSON.stringify({ workDir: work })).readFile({ path: join(worcaHome(), 'design', ID) }), /outside this chat's files$/);
  assert.throws(() => files('not json').readFile({ path: plan }), DEFAULT_OUTSIDE);
  assert.throws(() => files(JSON.stringify({ workDir: dirname(work) })).readFile({ path: plan }), DEFAULT_OUTSIDE);
  assert.throws(() => files(JSON.stringify([work])).readFile({ path: plan }), DEFAULT_OUTSIDE);
  assert.throws(() => files(undefined).readFile({ path: plan }), DEFAULT_OUTSIDE);
  // The words follow the roots askFileRoots KEPT, never an env var being set: another chat's skill root adds no "skills".
  const foreignSkill = join(worcaHome(), 'ask', 'ask_0000beef', 'skills', 'askm_0000beef');
  const foreign = defaultFileDeps({ threadId: T, env: { WORCA_ASK_ENGINE: 'codex', WORCA_ASK_SKILL_ROOT: foreignSkill } }).files;
  assert.throws(() => foreign.readFile({ path: plan }), DEFAULT_OUTSIDE);
});

test('a real read: work/ and the project open, .env stays protected, versions/ and the rest are outside this chat\'s files, in grep too', async (t) => {
  const home = worcaHome();
  const work = join(home, 'design', ID, 'work');
  const versions = join(home, 'design', ID, 'versions');
  const scratch = mkdtempSync(join(tmpdir(), 'worca-design-roots-'));
  t.after(() => { rmSync(scratch, { recursive: true, force: true }); rmSync(join(home, 'design'), { recursive: true, force: true }); });
  mkdirSync(work, { recursive: true });
  mkdirSync(versions, { recursive: true });
  writeFileSync(join(work, 'plan.json'), '{"title":"ShipRadar plan"}\n');
  writeFileSync(join(versions, 'v1.json'), '{"title":"an older ShipRadar"}\n');
  const proj = join(scratch, 'app');
  mkdirSync(proj);
  writeFileSync(join(proj, 'a.md'), 'project notes\n');
  writeFileSync(join(proj, '.env'), 'TOKEN=x\n');
  const stray = join(scratch, 'stray.txt');
  writeFileSync(stray, 'x\n');
  const OUT = "outside this chat's files";
  const reader = createAskFileReader({ roots: askFileRoots({ home, threadId: T, design: { workDir: work, projectDir: proj } }), home: homedir(), outsideText: OUT });
  assert.match(reader.readFile({ path: join(work, 'plan.json') }).text, /ShipRadar plan/);
  assert.match(reader.readFile({ path: join(proj, 'a.md') }).text, /project notes/);
  assert.throws(() => reader.readFile({ path: join(proj, '.env') }), /protected/);
  assert.throws(() => reader.readFile({ path: join(versions, 'v1.json') }), /outside this chat's files$/);
  assert.throws(() => reader.readFile({ path: stray }), /outside this chat's files$/);
  // The grep worker builds its own reader from workerData: the same words reach the model.
  await assert.rejects(reader.grep({ pattern: 'x', path: stray }), (e) => e.name === 'AskFileError' && /outside this chat's files$/.test(e.message));
  // work/ is the first root, so a grep with no path searches it (never versions/).
  assert.deepEqual((await reader.grep({ pattern: 'ShipRadar' })).matches.map((m) => m.path), [realpathSync(join(work, 'plan.json'))]);
  if (POSIX) {
    // A project that is a link to the folder holding the home reads as outside on its text and inside on its real path.
    const link = join(scratch, 'holds-home');
    symlinkSync(dirname(home), link);
    assert.deepEqual(askFileRoots({ home, threadId: T, design: { workDir: work, projectDir: link } }), [work, ...askFileRoots({ home, threadId: T })]);
    const toProj = join(scratch, 'to-app');
    symlinkSync(proj, toProj);
    assert.deepEqual(askFileRoots({ home, threadId: T, design: { workDir: work, projectDir: toProj } })[1], toProj, 'a link to an ordinary folder is kept');
  }
});

test('C5: a root swapped for a link after the turn started is dropped: another design is never read through it', { skip: !POSIX }, async (t) => {
  const home = worcaHome();
  const work = join(home, 'design', ID, 'work');
  const otherWork = join(home, 'design', 'd_ba9876543210', 'work');
  const scratch = mkdtempSync(join(tmpdir(), 'worca-design-roots-swap-'));
  t.after(() => { rmSync(scratch, { recursive: true, force: true }); rmSync(join(home, 'design'), { recursive: true, force: true }); });
  for (const d of [work, otherWork]) mkdirSync(d, { recursive: true });
  writeFileSync(join(work, 'plan.json'), '{"title":"mine"}\n');
  writeFileSync(join(otherWork, 'plan.json'), '{"title":"BOB-DESIGN-SECRET"}\n');
  const proj = join(scratch, 'app');
  mkdirSync(proj);
  writeFileSync(join(proj, 'a.md'), 'project notes\n');
  const env = { WORCA_ASK_ENGINE: 'codex', WORCA_ASK_DESIGN_ROOTS: JSON.stringify({ workDir: work, projectDir: proj }) };
  const reader = defaultFileDeps({ threadId: T, env }).files;
  assert.match(reader.readFile({ path: join(proj, 'a.md') }).text, /project notes/, 'the project reads before the swap');
  // An agent renames the project and plants a link to another person's design in its place.
  renameSync(proj, `${proj}-moved`);
  symlinkSync(otherWork, proj, 'dir');
  assert.throws(() => reader.readFile({ path: join(proj, 'plan.json') }), /outside this chat's files$/);
  await assert.rejects(reader.grep({ pattern: 'BOB-DESIGN-SECRET', path: proj }), /outside this chat's files$/);
  assert.deepEqual((await reader.grep({ pattern: 'title' })).matches.map((m) => m.path), [realpathSync(join(work, 'plan.json'))], 'work/ still reads');
  // A design root missing when the turn starts is not a root: a folder appearing under its name later never counts.
  const late = join(scratch, 'late');
  const lateReader = defaultFileDeps({ threadId: T, env: { ...env, WORCA_ASK_DESIGN_ROOTS: JSON.stringify({ workDir: work, projectDir: late }) } }).files;
  symlinkSync(otherWork, late, 'dir');
  assert.throws(() => lateReader.readFile({ path: join(late, 'plan.json') }), /outside this chat's files$/);
});

test('M-2: the root a grep or glob without a path searches (root 0) swapped for a link is dropped: no other folder is listed or read', { skip: !POSIX }, async (t) => {
  // A plain locked-down chat: root 0 is ask/<thread>/wt, a folder in the person's own group that the relay reads as worca.
  const home = worcaHome();
  const wt = join(home, 'ask', T, 'wt');
  const scratch = mkdtempSync(join(tmpdir(), 'worca-design-roots-wt-'));
  t.after(() => { rmSync(scratch, { recursive: true, force: true }); rmSync(join(home, 'ask', T), { recursive: true, force: true }); });
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, 'mine.txt'), 'MY-NOTES\n');
  const other = join(scratch, 'other');
  mkdirSync(other);
  writeFileSync(join(other, 'secret.txt'), 'OTHER-SECRET\n');
  const reader = createAskFileReader({ roots: askFileRoots({ home, threadId: T }), home: homedir() });
  assert.deepEqual((await reader.grep({ pattern: 'MY-NOTES' })).matches.map((m) => m.path), [realpathSync(join(wt, 'mine.txt'))], 'root 0 reads before the swap');
  assert.deepEqual(reader.glob({ pattern: '*.txt' }).paths, [realpathSync(join(wt, 'mine.txt'))]);
  renameSync(wt, `${wt}-moved`);
  symlinkSync(other, wt, 'dir');
  const noRoot = /this chat has no worktree yet/;
  await assert.rejects(reader.grep({ pattern: 'OTHER-SECRET' }), (e) => e.name === 'AskFileError' && noRoot.test(e.message));
  assert.throws(() => reader.glob({ pattern: '*' }), noRoot);
  assert.throws(() => reader.grepRaw({ pattern: 'OTHER-SECRET' }), noRoot, 'the worker\'s own search refuses too');
});

test('buildMcpConfig: WORCA_ASK_DESIGN_ROOTS rides a locked-down chat\'s config only', () => {
  const env = (o) => buildMcpConfig({ homeBase: '/h', threadId: T, serverPath: '/s.mjs', env: {}, ...o }).mcpServers.worca.env;
  assert.deepEqual(JSON.parse(env({ engine: 'codex', designRoots: { workDir: WORK } }).WORCA_ASK_DESIGN_ROOTS), { workDir: WORK });
  assert.deepEqual(JSON.parse(env({ engine: 'codex', designRoots: { workDir: WORK, projectDir: P } }).WORCA_ASK_DESIGN_ROOTS), { workDir: WORK, projectDir: P });
  assert.equal('WORCA_ASK_DESIGN_ROOTS' in env({ engine: 'codex' }), false);
  assert.equal('WORCA_ASK_DESIGN_ROOTS' in env({ engine: 'claude', designRoots: { workDir: WORK } }), false, 'a Claude chat reads with its own Read, Grep and Glob');
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
    firstTurn: false, firstText: 'hello', design: true, ...over,
    deps: {
      generateTitle: async () => '', failedBecauseSignedOut: async () => false,
      codexPreflight: async () => ({}), codexAskSupport: async () => ({}), codexLockdown: () => ['--disable', 'shell_tool'],
      memoryMount: async () => null, ...deps,
    },
  });
}
const mcpEnv = (o) => JSON.parse(readFileSync(o.mcpConfigPath, 'utf8')).mcpServers.worca.env;

test('the wiring: a Codex turn keeps designRoots and hands them to its MCP config, or to the relay that runs its tools', async () => {
  const seen = [];
  const turn = codexTurn(seed(), { designRoots: { workDir: WORK, projectDir: P } }, { runClaudeImpl: async (o) => { seen.push(mcpEnv(o)); return reply(o); } });
  assert.deepEqual(turn.designRoots, { workDir: WORK, projectDir: P }, 'createAskTurn takes the option');
  assert.equal((await turn.run()).status, 'done');
  assert.deepEqual(JSON.parse(seen[0].WORCA_ASK_DESIGN_ROOTS), { workDir: WORK, projectDir: P });
  // Without design roots the config is what it was.
  const plain = [];
  const without = codexTurn(seed(), {}, { runClaudeImpl: async (o) => { plain.push(mcpEnv(o)); return reply(o); } });
  assert.equal(without.designRoots, null);
  await without.run();
  assert.equal('WORCA_ASK_DESIGN_ROOTS' in plain[0], false);
  // Relay mode: the tools run in the server, so the relay gets the roots and the child only forwards.
  let relayArgs = null;
  const relayed = [];
  await codexTurn(seed(), { designRoots: { workDir: WORK } }, {
    claimAgentFile: () => {},
    agentRelay: (a) => { relayArgs = a; return { url: 'http://127.0.0.1:1/api/ask/relay', token: 't', dispose() {} }; },
    runClaudeImpl: async (o) => { relayed.push(mcpEnv(o)); return reply(o); },
  }).run();
  assert.deepEqual(relayArgs.designRoots, { workDir: WORK });
  assert.equal('WORCA_ASK_DESIGN_ROOTS' in relayed[0], false, 'the relay\'s child holds no roots');
});

test('the design prompt: a locked-down chat is told its file tools open the paths get_design returns', () => {
  const clause = /\(and web tools when they are on\)\. Open the design's files with read_file, grep and glob at the absolute paths get_design returns: paths\.work, and paths\.project when the design has a project\./;
  const codex = buildDesignSystemPrompt({ engine: 'codex' });
  assert.match(codex, /plus the worca file tools read_file, grep and glob/);
  assert.match(codex, clause);
  assert.doesNotMatch(buildDesignSystemPrompt({ engine: 'claude' }), /get_design returns/);
});
