import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rmOpts = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
const H = () => import('../tools/test-handles.mjs');

test('diffHandles: the multiset difference against the stdio baseline', async () => {
  const { diffHandles } = await H();
  assert.deepEqual(diffHandles(['PipeWrap', 'PipeWrap'], ['PipeWrap', 'Timeout', 'PipeWrap']), ['Timeout']);
  assert.deepEqual(diffHandles(['PipeWrap', 'PipeWrap'], ['PipeWrap', 'PipeWrap', 'PipeWrap']), ['PipeWrap']);
  assert.deepEqual(diffHandles(['PipeWrap'], ['PipeWrap']), []);
});

test('formatHandles groups repeated types and sorts them', async () => {
  const { formatHandles } = await H();
  assert.equal(formatHandles(['Timeout', 'Timeout', 'TCPServerWrap']), 'TCPServerWrap, Timeout x2');
});

test('handleWarning is the exact warning line', async () => {
  const { handleWarning } = await H();
  assert.equal(handleWarning('test/x.test.mjs', ['Timeout']),
    'warning: test/x.test.mjs held the process open after its tests: Timeout (force-closed; unref or clear it)');
});

test('sidecarName is stable for a path and its symlinked alias', async () => {
  const { sidecarName } = await H();
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-handles-'));
  try {
    const f = join(dir, 'a.test.mjs');
    writeFileSync(f, '');
    const link = join(dir, 'link.test.mjs');
    symlinkSync(f, link);
    assert.equal(sidecarName(f), sidecarName(link));
    assert.match(sidecarName(f), /^[0-9a-f]{40}\.json$/);
  } finally { rmSync(dir, rmOpts); }
});

test('preloadUrl carries the directory in the query', async () => {
  const { preloadUrl } = await H();
  assert.equal(new URL(preloadUrl('/a b')).searchParams.get('dir'), '/a b');
});

test('readHandles: null for a missing or garbage sidecar, the list (then deletes it) for a valid one', async () => {
  const { readHandles, sidecarName } = await H();
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-handles-'));
  try {
    const f = join(dir, 'a.test.mjs');
    writeFileSync(f, '');
    assert.equal(readHandles(dir, f), null);
    writeFileSync(join(dir, sidecarName(f)), 'not json{');
    assert.equal(readHandles(dir, f), null);
    writeFileSync(join(dir, sidecarName(f)), JSON.stringify({ file: f, handles: ['Timeout'] }));
    assert.deepEqual(readHandles(dir, f), ['Timeout']);
    assert.equal(existsSync(join(dir, sidecarName(f))), false);
  } finally { rmSync(dir, rmOpts); }
});

test('importing the module without a query registers no exit listener', async () => {
  const before = process.listenerCount('exit');
  await H();
  assert.equal(process.listenerCount('exit'), before);
});

test('the preload acts in the test file\'s own process only: a forked child and a Worker that hold a timer leave no sidecar', async () => {
  const { preloadUrl } = await H();
  const { spawnSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-handles-'));
  try {
    const handles = join(dir, 'handles');
    mkdirSync(handles);
    // The child and the worker each arm a ref'd timer and are killed by process.exit while it is pending.
    writeFileSync(join(dir, 'child.mjs'), "setTimeout(() => {}, 60_000); setTimeout(() => process.exit(0), 50);\n");
    writeFileSync(join(dir, 'main.mjs'), [
      "import { fork } from 'node:child_process';",
      "import { Worker } from 'node:worker_threads';",
      "console.log(JSON.stringify(process.execArgv));",
      "await new Promise((r) => fork(new URL('./child.mjs', import.meta.url)).on('exit', r));",
      "await new Promise((r) => new Worker(\"setTimeout(() => {}, 60_000); setTimeout(() => process.exit(0), 50);\", { eval: true }).on('exit', r));",
      '',
    ].join('\n'));
    const r = spawnSync(process.execPath, ['--import', preloadUrl(handles), join(dir, 'main.mjs')], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!r.stdout.includes('test-handles'), 'the preload is gone from execArgv: ' + r.stdout);
    assert.deepEqual(readdirSync(handles), []);
  } finally { rmSync(dir, rmOpts); }
});

test('readHandles: a sidecar naming anything but plain handle type names is ignored', async () => {
  const { readHandles, sidecarName } = await H();
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-handles-'));
  try {
    const f = join(dir, 'a.test.mjs');
    writeFileSync(f, '');
    writeFileSync(join(dir, sidecarName(f)), JSON.stringify({ file: f, handles: ['Timeout', '\u001b[31mred'] }));
    assert.equal(readHandles(dir, f), null);
  } finally { rmSync(dir, rmOpts); }
});
