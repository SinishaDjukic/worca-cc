// A run paused in the middle of a decomposed implement step resumes at the task it was on:
// the tasks that finished before the pause are not run again, the paused one is. A task
// whose file changed while the run was paused runs again (its content digest moved), and so
// does one whose edits a `git checkout .` / `git stash` took away during the pause.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, appendFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { writeGraphWorkflow } from '../src/core/workflows.mjs';
import { runAgentExecution } from '../src/core/graph/executor.mjs';
import { readPipelineForResume, listTasks } from '../src/core/artifacts.mjs';
import { getDb } from '../src/core/db.mjs';

useTempHome(after);

// settings/agent lookups resolve under HOME, not WORCA_HOME (test/orchestrator-recovery-release.test.mjs).
let sandboxHome;
const prevEnv = {};
before(async () => {
  sandboxHome = await mkdtemp(join(tmpdir(), 'worca-skipdone-home-'));
  for (const k of ['HOME', 'USERPROFILE']) prevEnv[k] = process.env[k];
  process.env.HOME = sandboxHome;
  process.env.USERPROFILE = sandboxHome;
});
after(async () => {
  for (const k of ['HOME', 'USERPROFILE']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await rm(sandboxHome, { recursive: true, force: true });
});

/** task -> decomposer -> implementer(expands) -> End. The mock decomposer writes phase 1
 *  (p1t1, p1t2) and phase 2 (p2t1). */
const GRAPH = {
  id: 'wf_resume_skips_done',
  name: 'Resume skips done tasks',
  domain: 'coding',
  nodes: [
    { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
    { id: 'n_dec', kind: 'agent', key: 'decomposer', x: 200, y: 0, config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', x: 400, y: 0, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 0, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_dec', port: 'plan' } },
    { id: 'w2', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_dec', port: 'tasks' }, to: { node: 'n_impl', port: 'task' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } },
  ],
};

const abortable = (ctx) => new Promise((_r, rej) => {
  const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
  if (ctx.signal?.aborted) onAbort(); else ctx.signal?.addEventListener('abort', onAbort, { once: true });
});

/** Run 1: phase 1 finishes, the run pauses inside p2t1. Returns what the resume needs.
 *  `edits` (task id → { file: content }) are written into the run's work tree by that task. */
async function pausedInPhaseTwo(edits = {}) {
  await writeGraphWorkflow(GRAPH);
  const dir = gitDir('skipdone');
  execSync('git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base && printf v0 > app.txt && git add app.txt && git -c user.email=t@t -c user.name=t commit -q -m app', { cwd: dir, shell: '/bin/sh' });
  const first = createOrchestrator({
    projectDir: dir, workflowId: GRAPH.id, prompt: 'demo', claude: { mock: true }, auto: false,
    runners: {
      producer: async (ctx) => {
        if (!ctx.slice) return runAgentExecution(ctx);
        const mine = edits[ctx.slice.id] || {};
        if (mine.delayMs) await new Promise((r) => setTimeout(r, mine.delayMs));
        for (const [file, text] of Object.entries(mine.files || {})) await writeFile(join(first.workDir, file), text);
        if (ctx.slice.id !== 'p2t1') return { status: 'ok', summary: `did ${ctx.slice.id}` };
        queueMicrotask(() => first.pause());
        return abortable(ctx);
      },
    },
  });
  const res = await first.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  const done = first.getState().steps.filter((s) => s.kind === 'task' && s.status === 'done').map((s) => s.taskId).sort();
  assert.deepEqual(done, ['p1t1', 'p1t2'], 'phase 1 finished before the pause');
  const saved = readPipelineForResume(first.state.id);
  return { dir, first, saved };
}

async function resume(dir, saved) {
  const ran = [];
  const second = createOrchestrator({
    projectDir: dir, claude: { mock: true }, auto: false, resume: saved,
    runners: {
      producer: async (ctx) => {
        if (!ctx.slice) return runAgentExecution(ctx);
        ran.push(ctx.slice.id);
        return { status: 'ok', summary: `did ${ctx.slice.id}` };
      },
    },
  });
  const r = await second.resume();
  assert.equal(r.status, 'done', JSON.stringify(r));
  return { second, ran: ran.sort() };
}

test('resume runs only the task the pause cut off, not the finished ones', { timeout: 60000 }, async () => {
  const { dir, first, saved } = await pausedInPhaseTwo();
  const { second, ran } = await resume(dir, saved);
  assert.deepEqual(ran, ['p2t1']);
  const tasks = listTasks(first.state.id);
  assert.deepEqual(tasks.map((t) => [t.id, t.status]).sort(), [['p1t1', 'done'], ['p1t2', 'done'], ['p2t1', 'done']]);
  const audit = getDb().prepare('SELECT text FROM pipeline_events WHERE pipeline_id = ?').all(first.state.id).map((e) => e.text).join('\n');
  assert.match(audit, /n_impl: task "Slice one" already finished in the earlier attempt — not run again\./);
  assert.match(audit, /n_impl: task "Slice two" already finished in the earlier attempt — not run again\./);
  const slices = second.getState().steps.filter((s) => s.kind === 'task');
  assert.ok(slices.every((s) => s.status === 'done'), JSON.stringify(slices.map((s) => [s.taskId, s.status])));
});

test('a task that finishes while the run is pausing is not run again', { timeout: 60000 }, async () => {
  await writeGraphWorkflow(GRAPH);
  const dir = gitDir('skipdrain');
  const first = createOrchestrator({
    projectDir: dir, workflowId: GRAPH.id, prompt: 'demo', claude: { mock: true }, auto: false,
    runners: {
      producer: async (ctx) => {
        if (!ctx.slice) return runAgentExecution(ctx);
        // p1t1 is still finishing when the pause lands; p1t2 is cut off by it.
        if (ctx.slice.id === 'p1t1') { await new Promise((r) => setTimeout(r, 50)); first.pause(); return { status: 'ok', summary: 'did p1t1' }; }
        return abortable(ctx);
      },
    },
  });
  assert.equal((await first.run()).status, 'paused');
  const saved = readPipelineForResume(first.state.id);
  const { ran } = await resume(dir, saved);
  assert.deepEqual(ran, ['p1t2', 'p2t1']);
});

test('resume after a failure pause re-runs the failed task, not its finished phase-mate', { timeout: 60000 }, async () => {
  await writeGraphWorkflow(GRAPH);
  const dir = gitDir('skipfail');
  let p1t1Done;
  const p1t1Finished = new Promise((r) => { p1t1Done = r; });
  const first = createOrchestrator({
    projectDir: dir, workflowId: GRAPH.id, prompt: 'demo', claude: { mock: true }, auto: false,
    runners: {
      producer: async (ctx) => {
        if (!ctx.slice) return runAgentExecution(ctx);
        if (ctx.slice.id === 'p1t1') { setImmediate(p1t1Done); return { status: 'ok', summary: 'did p1t1' }; }
        await p1t1Finished;
        throw new Error('claude exited with code 1: kaboom');
      },
    },
  });
  const res = await first.run();
  assert.equal(res.status, 'paused', JSON.stringify(res));
  assert.equal(res.reason, 'error');
  const { ran } = await resume(dir, readPipelineForResume(first.state.id));
  assert.deepEqual(ran, ['p1t2', 'p2t1']);
});

test('resume re-runs a finished task whose file changed during the pause', { timeout: 60000 }, async () => {
  const { dir, first, saved } = await pausedInPhaseTwo();
  await appendFile(join(first.pipeline.dir, 'tasks', 'p1-t2-slice-two.md'), '\nAlso handle the empty case.\n');
  const { ran } = await resume(dir, saved);
  assert.deepEqual(ran, ['p1t2', 'p2t1']);
});

// Phase 1: p1t1 edits the tracked app.txt and adds a file, p1t2 only adds a file. The two run side
// by side in one work tree, so a task's record holds whatever changed while it ran: p1t1 writes late,
// after p1t2 has finished, so p1t2's record holds only two.txt.
const PHASE_ONE_EDITS = {
  p1t1: { delayMs: 300, files: { 'app.txt': 'v1', 'one.txt': 'one' } },
  p1t2: { files: { 'two.txt': 'two' } },
};

test('resume re-runs only the finished task whose edit a `git checkout` of one file reverted', { timeout: 60000 }, async () => {
  const { dir, first, saved } = await pausedInPhaseTwo(PHASE_ONE_EDITS);
  assert.notEqual(first.workDir, dir, 'the run works in its own worktree');
  execSync('git checkout -- app.txt', { cwd: first.workDir });    // back to v0; p1t2's two.txt untouched
  const { ran } = await resume(dir, saved);
  assert.deepEqual(ran, ['p1t1', 'p2t1']);
});

test('resume re-runs every finished task after `git checkout .`, which empties the files they created', { timeout: 60000 }, async () => {
  const { dir, first, saved } = await pausedInPhaseTwo(PHASE_ONE_EDITS);
  execSync('git checkout -- .', { cwd: first.workDir });          // app.txt back to v0; new (intent-to-add) files emptied
  assert.equal(readFileSync(join(first.workDir, 'two.txt'), 'utf8'), '', 'checkout empties an intent-to-add file');
  const { ran } = await resume(dir, saved);
  assert.deepEqual(ran, ['p1t1', 'p1t2', 'p2t1']);
});

test('resume re-runs every finished task whose edits `git reset --hard` + `git clean` took away', { timeout: 60000 }, async () => {
  const { dir, first, saved } = await pausedInPhaseTwo(PHASE_ONE_EDITS);
  execSync('git reset -q --hard && git clean -qfd', { cwd: first.workDir, shell: '/bin/sh' });
  const { ran } = await resume(dir, saved);
  assert.deepEqual(ran, ['p1t1', 'p1t2', 'p2t1']);
});

test('a file the user edited to new content during the pause does not re-run the task', { timeout: 60000 }, async () => {
  const { dir, first, saved } = await pausedInPhaseTwo(PHASE_ONE_EDITS);
  await writeFile(join(first.workDir, 'app.txt'), 'v1 plus the user fix');
  const { ran } = await resume(dir, saved);
  assert.deepEqual(ran, ['p2t1']);
});
