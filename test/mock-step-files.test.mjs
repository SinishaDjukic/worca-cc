// Spec §9 / D13: the in-process mock writes the test-only WORCA_MOCK_EXTRA_FILES into
// the execution's step folder after its role side effects, and the mock decomposer's
// manifest carries ABSOLUTE task-file paths (the _expandDecomposition absolute branch).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaude } from '../src/core/claude-runner.mjs';
import { mockMarkers } from '../src/core/phases.mjs';

const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

function withExtraFiles(value, fn) {
  const prev = process.env.WORCA_MOCK_EXTRA_FILES;
  if (value === undefined) delete process.env.WORCA_MOCK_EXTRA_FILES; else process.env.WORCA_MOCK_EXTRA_FILES = value;
  return Promise.resolve().then(fn).finally(() => {
    if (prev === undefined) delete process.env.WORCA_MOCK_EXTRA_FILES; else process.env.WORCA_MOCK_EXTRA_FILES = prev;
  });
}
const collect = () => { const out = []; return { out, onEvent: (e) => out.push(e) }; };
const written = (ev) => ev.out.filter((e) => e.type === 'tool_use' && e.raw?.file).map((e) => e.raw.file);

test('WORCA_MOCK_EXTRA_FILES writes each rel=text entry into MOCK_STEP_DIR after the role side effects', async () => {
  const stepDir = join(tmp('worca-mock-step-'), 'steps', 'n_x-c1');
  const out = join(stepDir, 'out.md');
  const ev = collect();
  await withExtraFiles('DEVIATIONS.md=# Deviations\n\nnone;notes/scratch.txt=hi;../escape.md=NO;=skipped;bad', () =>
    runClaude({ mock: true, cwd: tmp('worca-mock-cwd-'), onEvent: ev.onEvent,
      prompt: mockMarkers({ MOCK_ROLE: 'generic-producer', MOCK_OUT: out, MOCK_STEP_DIR: stepDir }) }));
  assert.equal(readFileSync(join(stepDir, 'DEVIATIONS.md'), 'utf8'), '# Deviations\n\nnone');
  assert.equal(readFileSync(join(stepDir, 'notes', 'scratch.txt'), 'utf8'), 'hi');
  assert.equal(existsSync(join(stepDir, '..', 'escape.md')), false, 'a `..` rel is ignored');
  const files = written(ev);
  assert.ok(files.includes(out), 'the role output was written');
  assert.ok(files.indexOf(join(stepDir, 'DEVIATIONS.md')) > files.indexOf(out), 'extra files land AFTER the role switch');
  assert.ok(files.includes(join(stepDir, 'notes', 'scratch.txt')));
});

test('without the env, or without MOCK_STEP_DIR, nothing extra is written', async () => {
  const stepDir = join(tmp('worca-mock-step-'), 'steps', 'n_x-c1');
  const ev = collect();
  await withExtraFiles(undefined, () => runClaude({ mock: true, cwd: tmp('worca-mock-cwd-'), onEvent: ev.onEvent,
    prompt: mockMarkers({ MOCK_ROLE: 'generic-producer', MOCK_OUT: join(stepDir, 'out.md'), MOCK_STEP_DIR: stepDir }) }));
  assert.deepEqual(written(ev), [join(stepDir, 'out.md')]);
  const ev2 = collect();
  const out2 = join(tmp('worca-mock-nostep-'), 'out.md');
  await withExtraFiles('DEVIATIONS.md=x', () => runClaude({ mock: true, cwd: tmp('worca-mock-cwd-'), onEvent: ev2.onEvent,
    prompt: mockMarkers({ MOCK_ROLE: 'generic-producer', MOCK_OUT: out2 }) }));
  assert.deepEqual(written(ev2), [out2]);
});

test('the mock decomposer writes ABSOLUTE task-file paths under MOCK_TASKS_DIR', async () => {
  const stepDir = join(tmp('worca-mock-dec-'), 'steps', 'n_dec-c1');
  const tasksDir = join(stepDir, 'tasks');
  const out = join(stepDir, 'decomposition.json');
  await runClaude({ mock: true, cwd: tmp('worca-mock-cwd-'), onEvent: () => {},
    prompt: mockMarkers({ MOCK_ROLE: 'decomposer', MOCK_OUT: out, MOCK_TASKS_DIR: tasksDir }) });
  const files = JSON.parse(readFileSync(out, 'utf8')).phases.flatMap((p) => p.tasks.map((t) => t.file));
  assert.deepEqual(files, [join(tasksDir, 'p1-t1-slice-one.md'), join(tasksDir, 'p1-t2-slice-two.md'), join(tasksDir, 'p2-t1-slice-three.md')]);
  for (const f of files) assert.ok(existsSync(f), `${f} was written`);
});
