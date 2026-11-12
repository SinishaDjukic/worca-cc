// test/api-workflow-test-plugins-off.test.mjs — workflow tests 3b, Task 3 (D70, D70a, D72): through the run handler (mock
// engine). A Pretend try's spawns load no user settings; in a project try the project's own hooks and plugins are off in the
// checkout, its other settings, agents and CLAUDE.md stay, and none of it is in what the try changed. A Real try keeps both.
// Final review E2: a skill Worca mounts after that (here the projects root's) loses its frontmatter hooks in a Pretend try,
// project or not, and keeps them in a Real try and a normal run.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { templateRepo } from './helpers/git-dir.mjs';
import { repoSnapshot } from './helpers/repo-snapshot.mjs';
import { runSettled } from './helpers/run-settled.mjs';

useTempHome(after);
let homeDir, prevHome, prevEnv, srv, base, runs, _testing, artifacts, real, key, pin, copyDir, settled, executor, realRunClaude, stopRun;
const extra = [];
const spawns = [];
// E2: the projects root's skill, with a frontmatter hook, and what each spawn found mounted in its working folder.
const ROOT_SKILL = '---\nname: hooky\ndescription: d\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: echo hi\n---\nbody\n';
const ROOT_SKILL_OFF = '---\nname: hooky\ndescription: d\n---\nbody\n';
const mountedSkill = new Map();
let prevRoot, rootDir, prevManaged, libSkillFile;
// Final review O3: a skill with a frontmatter hook in the person's General set, and what each spawn's --plugin-dir held.
const SET_SKILL = '---\nname: hookyset\ndescription: d\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: echo hi\n---\nbody\n';
const SET_SKILL_OFF = '---\nname: hookyset\ndescription: d\n---\nbody\n';
const setSkill = new Map();
const setSkillOf = (o) => {
  for (const d of Array.isArray(o.pluginDirs) ? o.pluginDirs : []) {
    const f = join(d, 'skills', 'hookyset', 'SKILL.md');
    if (existsSync(f)) return readFileSync(f, 'utf8');
  }
  return null;
};
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b || {}) });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const GRAPH = {
  version: 2, id: 'wf_poff', name: 'Fix a bug', domain: 'coding',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w2', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } }],
};
const PROJECT_SETTINGS = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] }, enabledPlugins: { 'p@m': true },
  permissions: { allow: ['Bash(npm test:*)'] } };
// D70a: a try loads the run's own sources minus the user's. This hermetic home keeps no sign-in in its user settings, so a
// run here is project-only, and so is a Pretend try's spawn.
const RUN_SOURCES = ['project'];

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftpoff-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'workflowTests';
  executor = await import('../src/core/graph/executor.mjs');
  ({ runClaude: realRunClaude } = await import('../src/core/claude-runner.mjs'));
  rootDir = await mkdtemp(join(tmpdir(), 'worca-cc-wftpoff-root-'));
  mkdirSync(join(rootDir, '.claude', 'skills', 'hooky'), { recursive: true });
  writeFileSync(join(rootDir, '.claude', 'skills', 'hooky', 'SKILL.md'), ROOT_SKILL);
  prevRoot = process.env.WORCA_PROJECTS_ROOT;
  process.env.WORCA_PROJECTS_ROOT = rootDir;
  executor._testing.runClaude = async (o) => {   // every agent spawn's options, and the root skill it found mounted
    spawns.push(o);
    const f = join(String(o.cwd || ''), '.claude', 'skills', 'hooky', 'SKILL.md');
    mountedSkill.set(o, existsSync(f) ? readFileSync(f, 'utf8') : null);
    setSkill.set(o, setSkillOf(o));
    return realRunClaude(o);
  };
  // O3: the library skill through the real import, in General (every target's set unless left out).
  prevManaged = process.env.WORCA_CLAUDE_MANAGED_SETTINGS;
  process.env.WORCA_CLAUDE_MANAGED_SETTINGS = join(homeDir, 'no-managed.json');   // sideloading allowed whatever this machine says
  const setSrc = join(await mkdtemp(join(tmpdir(), 'worca-cc-wftpoff-set-')), 'hookyset');
  extra.push(dirname(setSrc));
  mkdirSync(setSrc);
  writeFileSync(join(setSrc, 'SKILL.md'), SET_SKILL);
  const { stageImport } = await import('../src/core/skills-registry/import.mjs');
  const { commitImport } = await import('../src/core/skills-registry/library.mjs');
  const { loadSkillCatalog } = await import('../src/core/skills-registry/catalog.mjs');
  const { putSkillMember } = await import('../src/core/mcp/store.mjs');
  const st = await stageImport({ kind: 'dir', path: setSrc }, {});
  await commitImport(st.dir, st.name);
  const entry = (await loadSkillCatalog()).find((e) => e.id === 'skill:library:hookyset');
  await putSkillMember('general', entry.id, { enabled: true }, { entry, siblingNames: [] });
  libSkillFile = join(entry.dir, 'SKILL.md');
  assert.equal(readFileSync(libSkillFile, 'utf8'), SET_SKILL, 'the library holds the skill with its hook');
  const mod = await import('../ui/server.mjs');
  ({ runs, _testing, stopRun } = mod);
  settled = runSettled({ runs, answerRun: _testing.answerRun });
  artifacts = await import('../src/core/artifacts.mjs');
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  real = templateRepo('wftpoff', { branch: 'main', user: true, files: { '.gitignore': 'node_modules/\n.claude/settings.local.json\n', 'README.md': '# hi\n',
    '.claude/settings.json': `${JSON.stringify(PROJECT_SETTINGS, null, 2)}\n`, '.claude/agents/helper.md': '# helper\n', 'CLAUDE.md': '# rules\n' } });
  extra.push(real);
  const { insertProject } = await import('../src/core/projects.mjs');
  insertProject({ name: 'tickets', path: real });
  key = (await import('../src/core/store.mjs')).projectKey(real);
  const { pinStart } = await import('../src/core/workflow-tests/project-copy.mjs');
  pin = await pinStart({ key, name: 'tickets', projectDir: real });
  copyDir = join(homeDir, '.worca-cc', 'workflow-tests', 'repos', key);   // worcaHome() is <WORCA_HOME>/.worca-cc
  assert.equal((await post('/api/workflows', GRAPH)).status, 201);
});
after(async () => {
  if (executor) executor._testing.runClaude = null;
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  if (prevRoot === undefined) delete process.env.WORCA_PROJECTS_ROOT; else process.env.WORCA_PROJECTS_ROOT = prevRoot;
  if (prevManaged === undefined) delete process.env.WORCA_CLAUDE_MANAGED_SETTINGS; else process.env.WORCA_CLAUDE_MANAGED_SETTINGS = prevManaged;
  if (rootDir) extra.push(rootDir);
  for (const [k, v] of Object.entries(prevEnv || {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_MOCK; delete process.env.WORCA_FLAGS;
  for (const d of [homeDir, ...extra]) await rm(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const projectBody = async (title) => {
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  return { ...tryRunBody({ name: 'Ticket 482', request: 'Fix the rounding.' }, [], { workflowId: 'wf_poff', tryNo: 1,
    project: { copyDir, startCommit: pin.startCommit } }), title };
};
async function projectTry(connectors, title) {
  const from = spawns.length;
  const out = await _testing.invokeStartRun(await projectBody(title), null, { workflowTest: { use: 'draft', connectors, project: { key, setupCmd: null } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = await settled(out.body.runId);
  const row = artifacts.findPipelineRowById(entry.pipelineId);
  const br = JSON.parse(row.branch);
  return { entry, row, br, mine: spawns.slice(from).filter((o) => String(o.cwd || '').startsWith(br.worktreeDir)) };
}

test('a Pretend project try: no user settings on any spawn; the project\'s hooks and plugins off; the rest stays; none of it is a change', { timeout: 240000 }, async () => {
  const was = repoSnapshot(real);
  const { entry, row, br, mine } = await projectTry('pretend', 'Test: Ticket 482 · try 1');
  assert.equal(row.status, 'done');
  assert.ok(mine.length > 0, 'the try spawned its agent');
  for (const o of mine) {
    assert.deepEqual(o.settingSources, RUN_SOURCES);
    assert.equal(o.pluginsOff, true);
  }
  assert.deepEqual(JSON.parse(readFileSync(join(br.worktreeDir, '.claude', 'settings.json'), 'utf8')), { permissions: { allow: ['Bash(npm test:*)'] } });
  assert.ok(existsSync(join(br.worktreeDir, '.claude', 'agents', 'helper.md')), 'the project\'s agents stay');
  assert.equal(readFileSync(join(br.worktreeDir, 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n'), '# rules\n', 'and its instructions (core.autocrlf on Windows)');
  const results = JSON.parse(readFileSync(join(entry.orch.pipeline.dir, 'results.json'), 'utf8'));
  const paths = [...results.newFiles, ...results.changedFiles].map((f) => f.path);
  assert.ok(paths.includes('src/feature.mjs'), 'the mock implementer\'s work is the change');
  assert.ok(!paths.includes('.claude/settings.json'), 'Worca\'s switch-off is not');
  // 3b Task 6 (D73): so the scope checks do not count it either.
  const { projectChanges } = await import('../src/core/workflow-tests/result.mjs');
  const { runCheck } = await import('../src/shared/workflow-tests/checks.mjs');
  const changes = projectChanges(results);
  assert.ok(!changes.touched.some((p) => p.startsWith('.claude/')), 'the change list has no .claude file');
  assert.equal(runCheck({ kind: 'unchanged', patterns: ['.claude/**'] }, { changes }).met, true);
  assert.equal(runCheck({ kind: 'under', dirs: ['src/', 'test/'] }, { changes }).met, true, JSON.stringify(changes.touched));
  // The mock implementer writes exactly two files (src/feature.mjs, test/feature.test.mjs): two is Met, one is Not met.
  assert.deepEqual(changes.touched, ['src/feature.mjs', 'test/feature.test.mjs']);
  assert.deepEqual(runCheck({ kind: 'max-files', max: 2 }, { changes }), { met: true, value: '2 files' });
  assert.deepEqual(runCheck({ kind: 'max-files', max: 1 }, { changes }), { met: false, value: '2 files' });
  assert.equal(git(copyDir, 'show', `${br.feature}:.claude/settings.json`), JSON.stringify(PROJECT_SETTINGS, null, 2), 'nor is it committed');
  assert.equal(repoSnapshot(real), was, 'nothing in the person\'s repository changed');
  // E2: the projects root's skill, mounted after the switch-off, is a copy without its hooks; the person's file keeps them.
  for (const o of mine) assert.equal(mountedSkill.get(o), ROOT_SKILL_OFF);
  assert.equal(readFileSync(join(rootDir, '.claude', 'skills', 'hooky', 'SKILL.md'), 'utf8'), ROOT_SKILL);
  assert.ok(!paths.some((p) => p.startsWith('.claude/skills/hooky')), 'the mount is not a change of the try');
  const { readRunManifest } = await import('../src/core/run-manifest.mjs');
  const warnings = (await readRunManifest(entry.orch.runRoot))?.warnings || [];
  assert.ok(!warnings.some((w) => /modified mounted skill `hooky`/.test(w)), `Worca's own strip is not an agent's edit: ${JSON.stringify(warnings)}`);
  // O3: the General set's skill reaches the spawn through --plugin-dir without its hooks; the library keeps them.
  for (const o of mine) assert.equal(setSkill.get(o), SET_SKILL_OFF);
  assert.equal(readFileSync(libSkillFile, 'utf8'), SET_SKILL);
});

test('a Real project try keeps them: user settings as a normal run loads them, and the project file is untouched', { timeout: 240000 }, async () => {
  const { row, br, mine } = await projectTry('real', 'Test: Ticket 482 · try 2');
  assert.equal(row.status, 'done');
  assert.ok(mine.length > 0);
  // #943: a normal run is project-only here too; a Real try is a normal run's spawn (no pluginsOff, no carry).
  for (const o of mine) { assert.deepEqual(o.settingSources, RUN_SOURCES); assert.equal('pluginsOff' in o, false); }
  assert.deepEqual(JSON.parse(readFileSync(join(br.worktreeDir, '.claude', 'settings.json'), 'utf8')), PROJECT_SETTINGS);
  for (const o of mine) assert.equal(mountedSkill.get(o), ROOT_SKILL, 'E2: a Real try mounts the root skill as a normal run does');
  for (const o of mine) assert.equal(setSkill.get(o), SET_SKILL, 'O3: and the set skill with its hooks');
});

test('a Pretend try without a project: its spawns load no user settings either', { timeout: 240000 }, async () => {
  const { tryRunBody } = await import('../src/core/workflow-tests/try-body.mjs');
  const from = spawns.length;
  const out = await _testing.invokeStartRun({ ...tryRunBody({ name: 'Brief', request: 'Write it.' }, [], { workflowId: 'wf_poff', tryNo: 1 }),
    title: 'Test: Brief · try 1' }, null, { workflowTest: { use: 'draft' } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = await settled(out.body.runId);
  const mine = spawns.slice(from);
  assert.ok(mine.length > 0);
  for (const o of mine) { assert.deepEqual(o.settingSources, RUN_SOURCES); assert.equal(o.pluginsOff, true); }
  for (const o of mine) assert.equal(mountedSkill.get(o), ROOT_SKILL_OFF, 'E2: never stripped before, the same mount loses its hooks too');
  for (const o of mine) assert.equal(setSkill.get(o), SET_SKILL_OFF, 'O3: so does the set skill');
  const { readRunManifest } = await import('../src/core/run-manifest.mjs');
  assert.ok(entry.orch.runRoot, 'a try is a detached run');
  const warnings = (await readRunManifest(entry.orch.runRoot))?.warnings || [];
  assert.ok(!warnings.some((w) => /modified mounted skill/.test(w)), `review m5: no rescue warning here either: ${JSON.stringify(warnings)}`);
});

test('E2: a normal run mounts the root skill as it is, hooks and all', { timeout: 240000 }, async () => {
  const from = spawns.length;
  const out = await _testing.invokeStartRun({ projectDir: real, prompt: 'Add a feature', title: 'Normal run', workflowId: 'wf_poff' }, null, {});
  assert.equal(out.status, 200, JSON.stringify(out.body));
  await settled(out.body.runId);
  const mine = spawns.slice(from);
  assert.ok(mine.length > 0);
  for (const o of mine) { assert.equal('pluginsOff' in o, false); assert.equal(mountedSkill.get(o), ROOT_SKILL); }
  for (const o of mine) assert.equal(setSkill.get(o), SET_SKILL, 'O3: a normal run loads the set skill as it is');
});

test('a switch-off Worca cannot write: no step runs, and the try is Worca\'s problem (copy), not the workflow\'s (U-T2)',
  { timeout: 240000, skip: process.getuid && process.getuid() === 0 ? 'root writes a read-only file' : false }, async () => {
  const { PLUGINS_OFF_STAGE } = await import('../src/core/workflow-tests/project-claude-settings.mjs');
  const { worcaProblemOf, pauseVerdict } = await import('../src/core/workflow-tests/runner.mjs');
  const { TRY_SETUP_STAGE } = await import('../src/core/workflow-tests/shell-step.mjs');
  // The person's setup (which runs first) leaves the settings file and its .claude folder read-only: Worca's write then
  // fails (EACCES / EPERM). Both, because Worca replaces the file through a temp file and a rename (M6, 4435f05ca): on Linux
  // and macOS a rename replaces a read-only file, so only the read-only folder (no temp file can be made in it) refuses the
  // write; on Windows a folder's read-only flag refuses nothing, and the rename over the read-only file is what fails.
  const setupCmd = 'node -e "const fs=require(\'fs\');fs.chmodSync(\'.claude/settings.json\',0o444);fs.chmodSync(\'.claude\',0o555)"';
  const from = spawns.length;
  const out = await _testing.invokeStartRun(await projectBody('Test: Ticket 482 · try 3'), null,
    { workflowTest: { use: 'draft', connectors: 'pretend', project: { key, setupCmd } } });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const entry = await settled(out.body.runId);
  const br = JSON.parse(artifacts.findPipelineRowById(entry.pipelineId).branch);
  try {
    assert.equal(entry.status, 'paused', 'an error in Worca\'s own setup pauses the run (the setup site), never a terminal error');
    assert.equal(entry.pauseReason, 'error');
    assert.match(entry.pauseDetail, /^Worca could not switch off the project's Claude Code hooks and plugins for this try: .*(EACCES|EPERM)/);
    const stage = entry.orch.state.setupStage;
    assert.equal(stage, PLUGINS_OFF_STAGE);
    assert.notEqual(stage, TRY_SETUP_STAGE, 'not the person\'s setup command');
    const pause = { ...pauseVerdict(entry.pauseReason, entry.pauseDetail), raw: entry.pauseDetail };
    assert.equal(worcaProblemOf({ pause, liveState: { setupStage: stage } }).kind, 'copy', 'the runner sets it aside and makes it again');
    assert.equal(spawns.slice(from).filter((o) => String(o.cwd || '').startsWith(br.worktreeDir)).length, 0, 'before any step');
  } finally {
    const { chmodSync } = await import('node:fs');
    try { chmodSync(join(br.worktreeDir, '.claude'), 0o755); } catch { /* already gone */ }   // first: the cleanup removes its files
    try { chmodSync(join(br.worktreeDir, '.claude', 'settings.json'), 0o644); } catch { /* already gone */ }
    await stopRun(out.body.runId).catch(() => {});
  }
});
