// test/orchestrator-no-project-resume.test.mjs — P3: a paused run without a project stops and resumes in its own
// work/ folder (never "not onboarded on this machine"), and a resume whose work/ was deleted by hand fails loudly.
// The pausedRun() pattern of test/stop-paused-harness.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, rmSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { ENGINES } from './helpers/engines.mjs';
import { getDb } from '../src/core/db.mjs';
import { newPipelineId, findPipelineRowById, listRunArtifacts, readPipelineForResume } from '../src/core/artifacts.mjs';
import { createOrchestratorFor } from '../src/core/engine-select.mjs';
import { stopPausedRun } from '../src/core/stop-paused.mjs';
import { noProjectWorkDir } from '../src/core/store.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after, 'worca-np-resume-');
// The harness reads the control poll period when it takes ownership: poll every 25 ms here, not every 1 s.
const prevControlCheckMs = process.env.WORCA_CONTROL_CHECK_MS;
process.env.WORCA_CONTROL_CHECK_MS = '25';
after(() => {
  if (prevControlCheckMs === undefined) delete process.env.WORCA_CONTROL_CHECK_MS;
  else process.env.WORCA_CONTROL_CHECK_MS = prevControlCheckMs;
});
const engine = ENGINES[0];
const okVerifier = async () => ({ status: 'ok', issues: [], review: { issues: [] }, summary: '' });

/** A real paused run without a project whose producer wrote `wip.txt` into its work/ folder before the pause. */
async function pausedNoProjectRun() {
  const pipelineId = newPipelineId();
  let orch;
  orch = engine.create({
    workMode: 'none', pipelineId, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async (ctx) => {
        writeFileSync(join(orch.runCwd, 'wip.txt'), 'half done\n');
        queueMicrotask(() => orch.pause());
        return new Promise((_res, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort();
          else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      },
      verifier: okVerifier,
    },
  });
  assert.equal((await orch.run()).status, 'paused');
  assert.equal(orch.state.id, pipelineId);
  assert.ok(existsSync(join(noProjectWorkDir(pipelineId), 'wip.txt')), 'a pause keeps work/');
  return pipelineId;
}

test('stop a paused run without a project: settles stopped, never asks the registry, keeps wip.txt as an artifact', async () => {
  const id = await pausedNoProjectRun();
  let asked = 0;
  const out = await stopPausedRun(id, { by: 'local', claude: { mock: true }, projectDirFor: async () => { asked += 1; return null; } });
  assert.deepEqual(out, { ok: true, pipelineId: id, status: 'stopped' });
  assert.equal(asked, 0, 'the reserved key never reaches the registry lookup');
  assert.equal(findPipelineRowById(id).status, 'stopped');
  assert.ok((await listRunArtifacts(id)).some((a) => a.kind === 'work' && a.relPath === 'work/wip.txt'));
  assert.equal(existsSync(join(worcaHome(), 'runs', id)), false, 'the run root is reclaimed once work/ is kept');
});

test('resume a paused run without a project: it reattaches work/ and finishes done', { timeout: 180000 }, async () => {
  const id = await pausedNoProjectRun();
  const o = await createOrchestratorFor({ projectDir: noProjectWorkDir(id), claude: { mock: true }, resume: readPipelineForResume(id), workMode: 'git' });
  assert.equal(o.workMode, 'none', 'the recorded mode wins over a caller (P1)');
  const res = await o.resume();
  assert.equal(res.status, 'done', res.error);
  assert.equal(o.runCwd, noProjectWorkDir(id), 'the resume re-attached the run\'s own work/ folder');
  assert.ok((await listRunArtifacts(id)).some((a) => a.kind === 'work' && a.relPath === 'work/wip.txt'));
});

test('a resume whose work/ was deleted by hand stops loudly, not in git', async () => {
  const id = await pausedNoProjectRun();
  rmSync(noProjectWorkDir(id), { recursive: true, force: true });
  const o = await createOrchestratorFor({ projectDir: noProjectWorkDir(id), auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  const res = await o.resume();
  assert.equal(res.status, 'error');
  assert.match(String(res.error || ''), /^work folder missing: .* — cannot resume$/);
});

test('a run paused before its setup made work/ resumes: the setup replay creates the folder', { timeout: 180000 }, async () => {
  const id = await pausedNoProjectRun();
  // The shape a pause in run()'s preflight leaves (before _setupRunRoot): setupIncomplete, no work/ yet.
  rmSync(join(worcaHome(), 'runs', id), { recursive: true, force: true });
  getDb().prepare("UPDATE pipelines SET resume_point = json_set(resume_point, '$.setupIncomplete', json('true')) WHERE id = ?").run(id);
  const o = await createOrchestratorFor({ projectDir: noProjectWorkDir(id), auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  const res = await o.resume();
  assert.equal(res.status, 'done', res.error);
  assert.equal(o.runCwd, noProjectWorkDir(id));
});

test('a resume never mounts through a work/.claude an agent swapped for a link: its target keeps its skills and rules (P3-D19)', { timeout: 180000 }, async () => {
  const id = await pausedNoProjectRun();
  const work = noProjectWorkDir(id);
  const victim = join(worcaHome(), 'victim-claude');
  mkdirSync(join(victim, 'skills', 'mine'), { recursive: true });
  writeFileSync(join(victim, 'skills', 'mine', 'SKILL.md'), 'keep');
  mkdirSync(join(victim, 'rules', 'worca'), { recursive: true });
  writeFileSync(join(victim, 'rules', 'worca', 'mine.md'), 'keep');
  rmSync(join(work, '.claude'), { recursive: true, force: true });
  try { symlinkSync(victim, join(work, '.claude'), 'junction'); } catch (e) { if (e.code === 'EPERM') return; throw e; }   // Windows without the privilege
  const o = await createOrchestratorFor({ projectDir: work, auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  await o.resume();
  assert.equal(readFileSync(join(victim, 'skills', 'mine', 'SKILL.md'), 'utf8'), 'keep', 'the skill mount never removes through the link');
  assert.equal(readFileSync(join(victim, 'rules', 'worca', 'mine.md'), 'utf8'), 'keep', 'the memory mount never removes through the link');
});

test('a resume never works through a work/ an agent swapped for a link: it stops loudly and the link target keeps its rules (P3-D19)', { timeout: 180000 }, async () => {
  const id = await pausedNoProjectRun();
  const work = noProjectWorkDir(id);
  const victim = join(worcaHome(), 'victim-work');
  mkdirSync(join(victim, '.claude', 'rules', 'worca'), { recursive: true });
  writeFileSync(join(victim, '.claude', 'rules', 'worca', 'mine.md'), 'keep');
  rmSync(work, { recursive: true, force: true });
  try { symlinkSync(victim, work, 'junction'); } catch (e) { if (e.code === 'EPERM') return; throw e; }   // Windows without the privilege
  const o = await createOrchestratorFor({ projectDir: work, auto: true, claude: { mock: true }, resume: readPipelineForResume(id) });
  const res = await o.resume();
  assert.match(String(res.error || ''), /work folder is not the run's own: .* — cannot resume/);
  assert.equal(readFileSync(join(victim, '.claude', 'rules', 'worca', 'mine.md'), 'utf8'), 'keep', 'nothing is mounted through the link');
  assert.equal(existsSync(join(victim, '.claude', 'skills')), false, 'no skill mount lands behind the link');
});

test('a run whose agent swapped work/.claude for a link: teardown removes nothing through it (strict), the files are kept (P3-D19)', { timeout: 180000 }, async () => {
  const pipelineId = newPipelineId();
  const outside = join(worcaHome(), 'outside-claude');
  mkdirSync(join(outside, 'rules', 'worca'), { recursive: true });
  writeFileSync(join(outside, 'rules', 'worca', 'mine.md'), 'keep');
  let orch;
  orch = engine.create({
    workMode: 'none', pipelineId, prompt: 'demo', auto: true, claude: { mock: true },
    runners: {
      producer: async () => {
        writeFileSync(join(orch.runCwd, 'deck.md'), '# deck\n');
        rmSync(join(orch.runCwd, '.claude'), { recursive: true, force: true });
        try { symlinkSync(outside, join(orch.runCwd, '.claude'), 'junction'); } catch (e) { if (e.code !== 'EPERM') throw e; }   // Windows without the privilege
        return { status: 'ok', summary: '' };
      },
      verifier: okVerifier,
    },
  });
  assert.equal((await orch.run()).status, 'done');
  assert.equal(readFileSync(join(outside, 'rules', 'worca', 'mine.md'), 'utf8'), 'keep', 'the memory mount entry is never removed through the link');
  assert.ok((await listRunArtifacts(pipelineId)).some((a) => a.kind === 'work' && a.relPath === 'work/deck.md'));
});
