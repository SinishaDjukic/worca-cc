// Memory usage counts, collect-only (plans/team-memory-usage-tracking.md): the InstructionsLoaded hook rides worca's own
// --settings payload only when a mounted note has `paths:`, the hook script keeps addresses only, each signal counts
// once per note per execution, reads come from the parsed tool events, the files are written at sync-back (never
// during an execution), and a defragment run records nothing.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { seedQuickFix } from './helpers/engines.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';
import { memoryRoot, writeMemory, GLOBAL_SCOPE, projectScope } from '../src/core/memory-store.mjs';
import { projectKey } from '../src/core/store.mjs';
import { buildSettingsPayload, buildClaudeArgs } from '../src/core/engines/claude.mjs';
import { _runOptsForTests as runOpts } from '../src/core/phases.mjs';
import {
  memoryUsageRoot, memoryUsageHookEntry, noteOfMemoryRel, noteOfReadMemory, createUsageTally, drainMemoryLoads,
  recordMemoryUsage, memoryLoadLogPath, MEMORY_LOADS_DIR,
} from '../src/core/memory-usage.mjs';

useTempHome(after);
let sandboxHome; const prevEnv = {};
const HERMETIC_ROOT = mkdtempSync(join(tmpdir(), 'worca-usage-proot-'));
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-usage-home-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT', 'WORCA_RUN_ROOT']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome; process.env.USERPROFILE = sandboxHome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_PROJECTS_ROOT = HERMETIC_ROOT;
  delete process.env.WORCA_RUN_ROOT;
  await seedQuickFix();
});
after(async () => {
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  await rm(sandboxHome, { recursive: true, force: true });
  rmSync(HERMETIC_ROOT, { recursive: true, force: true });
});

const HOOK = fileURLToPath(new URL('../src/core/memory-usage-hook.mjs', import.meta.url));
const CAPS = { hardBytesPerFile: 32768 };
const NOW = '2026-10-24T10:00:00.000Z';
const SCOPED = '---\nname: billing\ndescription: Billing rules\npaths: src/billing/**\n---\nRound half even.\n';
const DIRS = [
  { scope: GLOBAL_SCOPE, rel: 'global' },
  { scope: projectScope('demo-00000001'), rel: 'project' },
];

/** Run the hook script the way the CLI does: the event on stdin, the log path as argv[2]. */
function runHook(log, event) {
  const r = spawnSync(process.execPath, [HOOK, log], { input: JSON.stringify(event), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, '', 'the hook prints nothing');
}
const load = (cwd, rel, trigger, extra = {}) => ({
  session_id: 's-1', transcript_path: '/secret/transcript.jsonl', cwd, hook_event_name: 'InstructionsLoaded',
  file_path: join(cwd, '.claude', 'rules', 'worca', ...rel.split('/')), memory_type: 'Project', load_reason: 'path_glob_match',
  globs: ['src/billing'], trigger_file_path: trigger, ...extra,
});
function feedRead(orch, ctx, file, id) {
  const attr = { nodeId: ctx.nodeId, executionId: ctx.executionId, cycle: ctx.ordinal };
  orch._onAgentEvent('implementer', { type: 'assistant', text: '', raw: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: file } }] } } }, attr);
}
const usageOf = async (file) => JSON.parse(await readFile(file === 'global' ? join(memoryUsageRoot(), 'global.json') : join(memoryUsageRoot(), 'projects', `${file}.json`), 'utf8'));

test('settings payload: the InstructionsLoaded hook joins worca\'s ONE --settings payload only when asked, path_glob_match only, beside the host guard', () => {
  assert.equal(buildSettingsPayload(null), null, 'no log ⇒ nothing to carry');
  const s = buildSettingsPayload(null, { memoryLoadLog: '/run/memory-loads/e1.jsonl' });
  assert.deepEqual(Object.keys(s.settings.hooks), ['InstructionsLoaded']);
  const [entry] = s.settings.hooks.InstructionsLoaded;
  assert.equal(entry.matcher, 'path_glob_match');
  assert.match(entry.hooks[0].command, /memory-usage-hook\.mjs" "\/run\/memory-loads\/e1\.jsonl"$/);
  assert.equal(s.hook, false, 'never --include-hook-events');
  const both = buildSettingsPayload({ deny: ['Bash(curl:*)'] }, { hostGuard: true, memoryLoadLog: '/l.jsonl', extraSettings: { hooks: { InstructionsLoaded: [] } } });
  assert.equal(both.settings.hooks.InstructionsLoaded.length, 1, 'a caller cannot set hooks; ours is the only one');
  assert.ok(both.settings.hooks.PreToolUse?.length, 'the host guard stays');
  assert.deepEqual(both.settings.permissions, { deny: ['Bash(curl:*)'] });
  const base = { prompt: 'p', permissionMode: 'acceptEdits' };
  assert.deepEqual(buildClaudeArgs({ ...base, memoryLoadLog: undefined }), buildClaudeArgs(base), 'absent ⇒ byte-identical argv');
  const args = buildClaudeArgs({ ...base, memoryLoadLog: '/l.jsonl' });
  assert.ok(!args.includes('--include-hook-events'));
  assert.match(args[args.indexOf('--settings') + 1], /InstructionsLoaded/);
  assert.equal(runOpts({ projectDir: '/w' }, { role: 'x', prompt: 'p' }).memoryLoadLog, undefined);
  assert.equal(runOpts({ projectDir: '/w', memoryLoadLog: '/l.jsonl' }, { role: 'x', prompt: 'p' }).memoryLoadLog, '/l.jsonl');
  assert.deepEqual(memoryUsageHookEntry('C:\\r\\l.jsonl').hooks[0].command.endsWith('"C:/r/l.jsonl"'), true, 'forward slashes, like the host guard');
});

test('hook script: one address-only line per path_glob_match load; session_start and non-worca rules write nothing; a trigger outside the cwd is dropped', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'worca-usage-cwd-'));
  const log = join(cwd, 'pipe', MEMORY_LOADS_DIR, 'e1.jsonl');   // the dir does not exist yet
  runHook(log, load(cwd, 'project/billing.md', join(cwd, 'src', 'billing', 'a.js'), { agent_id: 'a1', agent_type: 'Explore' }));
  runHook(log, load(cwd, 'team/x.md', '/elsewhere/secret.js'));
  runHook(log, { ...load(cwd, 'project/always.md', null), load_reason: 'session_start' });
  runHook(log, { ...load(cwd, 'x', null), file_path: join(cwd, '.claude', 'rules', 'mine.md') });
  runHook(log, { garbage: true });
  const lines = (await readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines, [
    { f: 'project/billing.md', r: 'path_glob_match', t: 'src/billing/a.js', a: 'Explore' },
    { f: 'team/x.md', r: 'path_glob_match', t: null, a: null },
  ]);
  assert.ok(!(await readFile(log, 'utf8')).includes(cwd), 'no absolute path, no transcript path, no session id');
  await rm(cwd, { recursive: true, force: true });
});

test('note addresses: rules and writable copies map per layer; Ask read_memory results map to the same keys', () => {
  assert.deepEqual(noteOfMemoryRel('global/style.md', DIRS), { file: 'global', note: 'global:style' });
  assert.deepEqual(noteOfMemoryRel('project/lesson.md', DIRS), { file: 'demo-00000001', note: 'project:lesson' });
  assert.deepEqual(noteOfMemoryRel('team/shared.md', DIRS), { file: 'demo-00000001', note: 'team:shared' });
  const ws = [{ scope: GLOBAL_SCOPE, rel: 'global' }, { scope: projectScope('a-1'), rel: 'projects/a-1' }];
  assert.deepEqual(noteOfMemoryRel('projects/a-1/n.md', ws), { file: 'a-1', note: 'project:n' });
  assert.deepEqual(noteOfMemoryRel('team/a-1/n.md', ws), { file: 'a-1', note: 'team:n' });
  for (const bad of ['notes.md', 'global/x.txt', 'projects/zz/n.md', 'team/n.md', '', null]) assert.equal(noteOfMemoryRel(bad, ws), null, String(bad));
  assert.deepEqual(noteOfReadMemory({ scope: 'project', projectKey: 'a-1', name: 'n', layer: 'team' }), { file: 'a-1', note: 'team:n' });
  assert.deepEqual(noteOfReadMemory({ scope: 'global', name: 'g' }), { file: 'global', note: 'global:g' });
  assert.equal(noteOfReadMemory({ scope: 'project', name: 'n' }), null);
});

test('drain + merge: a hook file is read once and removed, repeats count once, buckets age out after 90 days, triggers keep the last 5', async () => {
  await rm(memoryUsageRoot(), { recursive: true, force: true });
  const pipe = await mkdtemp(join(tmpdir(), 'worca-usage-pipe-'));
  const log = memoryLoadLogPath(pipe, 'n_impl#1');
  await mkdir(join(pipe, MEMORY_LOADS_DIR), { recursive: true });
  await writeFile(log, '{"f":"project/b.md","r":"path_glob_match","t":"src/b/1.js"}\nnot json\n{"f":"project/b.md","r":"path_glob_match","t":"src/b/2.js"}\n{"f":"project/b.md","r":"session_start"}\n');
  const tally = createUsageTally();
  await drainMemoryLoads(pipe, 'n_impl#1', DIRS, tally);
  assert.equal(existsSync(log), false, 'removed once read');
  assert.equal(tally.add({ file: 'demo-00000001', note: 'project:b' }, 'hit'), false, 'already counted in this execution');
  tally.add({ file: 'demo-00000001', note: 'project:b' }, 'read');
  tally.add({ file: 'demo-00000001', note: 'project:b' }, 'read');
  assert.equal(tally.size, 2);
  const old = Date.parse('2026-07-01T00:00:00Z');
  await recordMemoryUsage([{ file: 'demo-00000001', note: 'project:b', signal: 'hit', trigger: 'src/old.js' }], { now: old });
  for (let i = 0; i < 6; i += 1) await recordMemoryUsage([{ file: 'demo-00000001', note: 'project:b', signal: 'hit', trigger: `src/t${i}.js` }], { now: Date.parse(NOW) });
  await recordMemoryUsage(tally.events(), { now: Date.parse(NOW) });
  const doc = await usageOf('demo-00000001');
  assert.equal(doc.schema, 1);
  const n = doc.notes['project:b'];
  assert.deepEqual(Object.keys(n.days), ['2026-10-24'], 'July aged out (90 days)');
  assert.deepEqual(n.days['2026-10-24'], { hit: 7, read: 1, edit: 0 });
  assert.equal(n.triggers.length, 5);
  assert.equal(n.triggers[0], 'src/b/1.js', 'newest first; the first trigger of an execution is kept');
  await rm(pipe, { recursive: true, force: true });
});

test('a run with a path-scoped note: hook file per execution, hits from the hook and reads from tool events counted once each, a proposed note is no edit (#943), written at sync-back only, the user\'s settings untouched', { timeout: 120000 }, async () => {
  await rm(memoryRoot(), { recursive: true, force: true });
  await rm(memoryUsageRoot(), { recursive: true, force: true });
  const dir = gitDir('usage');
  const pk = projectKey(dir);
  await writeMemory(memoryRoot(), projectScope(pk), 'billing', SCOPED, { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'style', 'Terse subjects.\n', { source: 'user', now: NOW, caps: CAPS });
  const seen = [];
  let orch = null;
  orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_quick-fix', prompt: 'demo task', claude: { mock: true }, auto: true,
    runners: { producer: async (ctx) => {
      seen.push({ key: ctx.node.key, log: ctx.memoryLoadLog, usageBefore: existsSync(join(memoryUsageRoot(), 'projects', `${pk}.json`)) });
      if (ctx.node.key === 'implementer' && seen.filter((s) => s.key === 'implementer').length === 1) {
        const ev = load(ctx.projectDir, 'project/billing.md', join(ctx.projectDir, 'src', 'billing', 'a.js'));
        runHook(ctx.memoryLoadLog, ev);
        runHook(ctx.memoryLoadLog, { ...ev, agent_type: 'Explore', trigger_file_path: join(ctx.projectDir, 'src', 'billing', 'b.js') });
        feedRead(orch, ctx, join(ctx.memoryRules, 'project', 'billing.md'), 'toolu_r1');
        feedRead(orch, ctx, join(ctx.memoryRules, 'project', 'billing.md'), 'toolu_r2');
        feedRead(orch, ctx, join(ctx.memoryMount, 'global', 'style.md'), 'toolu_r3');
        feedRead(orch, ctx, join(ctx.projectDir, 'README.md'), 'toolu_r4');
        await writeFile(join(ctx.memoryMount, 'project', 'lesson.md'), 'Run npm ci first.\n');
        assert.equal(existsSync(memoryUsageRoot()), false, 'nothing written during the execution');
      }
      return runAgentExecution(ctx);
    } },
  });
  const res = await orch.run();
  assert.equal(res.status, 'done', JSON.stringify(res));
  for (const s of seen) assert.equal(s.log, memoryLoadLogPath(orch.getState().pipelineDir, s.log.split('/').pop().replace(/\.jsonl$/, '')), 'every execution gets its own hook file');
  assert.equal(new Set(seen.map((s) => s.log)).size, seen.length);
  assert.equal(seen.filter((s) => s.key === 'implementer')[1].usageBefore, true, 'the first implementer\'s counts were merged at its sync-back');
  const day = new Date().toISOString().slice(0, 10);
  const proj = await usageOf(pk);
  assert.deepEqual(proj.notes['project:billing'].days[day], { hit: 1, read: 1, edit: 0 }, 'two loads and two reads in one execution count once each');
  assert.deepEqual(proj.notes['project:billing'].triggers, ['src/billing/a.js']);
  assert.equal(proj.notes['project:lesson'], undefined, 'a note the run wrote is only a proposal: no store edit to count');
  assert.deepEqual((await usageOf('global')).notes['global:style'].days[day], { hit: 0, read: 1, edit: 0 });
  assert.deepEqual(await readdir(join(orch.getState().pipelineDir, MEMORY_LOADS_DIR)), [], 'hook files drained');
  assert.ok(!JSON.stringify(proj).includes('Round half even'), 'counts only, never note text');
  assert.equal(existsSync(join(sandboxHome, '.claude')), false, 'the user\'s Claude settings are never written');
  assert.equal(existsSync(join(dir, '.claude', 'settings.json')) || existsSync(join(dir, '.claude', 'settings.local.json')), false, 'nor the project\'s');
});

test('no path-scoped note mounted: no hook (byte-identical spawn), reads still counted', { timeout: 120000 }, async () => {
  await rm(memoryRoot(), { recursive: true, force: true });
  await rm(memoryUsageRoot(), { recursive: true, force: true });
  const dir = gitDir('usage');
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'style', 'Terse subjects.\n', { source: 'user', now: NOW, caps: CAPS });
  const logs = []; let orch = null; let fed = false;
  orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_quick-fix', prompt: 'demo task', claude: { mock: true }, auto: true,
    runners: { producer: async (ctx) => {
      logs.push(ctx.memoryLoadLog);
      if (!fed) { fed = true; feedRead(orch, ctx, join(ctx.memoryRules, 'global', 'style.md'), 'toolu_r1'); }
      return runAgentExecution(ctx);
    } },
  });
  assert.equal((await orch.run()).status, 'done');
  assert.ok(logs.length && logs.every((l) => l === null), JSON.stringify(logs));
  assert.equal((await usageOf('global')).notes['global:style'].days[new Date().toISOString().slice(0, 10)].read, 1);
});

test('a defragment run records nothing: no hook, no reads, no edits, its hook files dropped', { timeout: 120000 }, async () => {
  await rm(memoryRoot(), { recursive: true, force: true });
  await rm(memoryUsageRoot(), { recursive: true, force: true });
  const dir = gitDir('usage');
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'a', '---\nname: a\ndescription: A\npaths: src/**\n---\nRule A.\n', { source: 'user', now: NOW, caps: CAPS });
  await writeMemory(memoryRoot(), GLOBAL_SCOPE, 'b', 'Rule B.\n', { source: 'user', now: NOW, caps: CAPS });
  let log = 'unset'; let orch = null;
  orch = createOrchestrator({
    projectDir: dir, workflowId: 'wf_memory_defrag', memoryScope: 'global', prompt: 'Defragment global memory.', claude: { mock: true }, auto: true,
    runners: { producer: async (ctx) => {
      if (ctx.node.key === 'memoryDefragmenter') {
        log = ctx.memoryLoadLog;
        feedRead(orch, ctx, join(ctx.memoryMount, 'global', 'a.md'), 'toolu_r1');
        runHook(memoryLoadLogPath(ctx.pipelineDir, ctx.executionId), load(ctx.projectDir, 'global/a.md', join(ctx.projectDir, 'src', 'x.js')));
      }
      return runAgentExecution(ctx);
    } },
  });
  assert.equal((await orch.run()).status, 'done');
  assert.equal(log, null);
  assert.equal(existsSync(memoryUsageRoot()), false);
  assert.deepEqual(await readdir(join(orch.getState().pipelineDir, MEMORY_LOADS_DIR)), []);
});
