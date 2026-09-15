// test/title-model.test.mjs
// #422: the title model is decided PER CALL — explicit > WORCA_TITLE_MODEL >
// stored titleModel (only while it is a catalog member) > the run's model >
// the built-in Haiku. Aux calls run at AUX_EFFORT ('low'), and a failed title
// call reports ONCE through onError instead of vanishing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTitleModel, describeTitleModel, generateTitle, DEFAULT_TITLE_MODEL } from '../src/core/title.mjs';
import { AUX_EFFORT } from '../src/core/model-env.mjs';
import { PREDEFINED_MODELS } from '../src/core/config.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const deps = (over = {}) => ({ env: {}, stored: () => null, inCatalog: () => true, ...over });

test('DEFAULT_TITLE_MODEL is the BUILT-IN Haiku id, so a global entry shadowing it routes title calls', () => {
  assert.ok(PREDEFINED_MODELS.some((m) => m.id === DEFAULT_TITLE_MODEL), `${DEFAULT_TITLE_MODEL} must be a PREDEFINED_MODELS id`);
});

test('resolveTitleModel: precedence explicit > env > stored > run > built-in', () => {
  assert.deepEqual(resolveTitleModel({ model: ' x ', runModel: 'r' }, deps({ env: { WORCA_TITLE_MODEL: 'e' }, stored: () => 's' })),
    { model: 'x', source: 'explicit', stale: null });
  assert.deepEqual(resolveTitleModel({ runModel: 'r' }, deps({ env: { WORCA_TITLE_MODEL: 'e' }, stored: () => 's' })),
    { model: 'e', source: 'env', stale: null });
  assert.deepEqual(resolveTitleModel({ runModel: 'r' }, deps({ stored: () => 's' })),
    { model: 's', source: 'settings', stale: null });
  assert.deepEqual(resolveTitleModel({ runModel: 'r' }, deps()),
    { model: 'r', source: 'run', stale: null });
  assert.deepEqual(resolveTitleModel({}, deps()),
    { model: DEFAULT_TITLE_MODEL, source: 'builtin', stale: null });
});

test('resolveTitleModel: an EMPTY env override is not an override; the env id is not catalog-checked', () => {
  assert.equal(resolveTitleModel({ runModel: 'r' }, deps({ env: { WORCA_TITLE_MODEL: '   ' } })).source, 'run');
  assert.deepEqual(resolveTitleModel({}, deps({ env: { WORCA_TITLE_MODEL: 'off-catalog' }, inCatalog: () => false })),
    { model: 'off-catalog', source: 'env', stale: null });
});

test('resolveTitleModel: a stored id that left the catalog is reported as stale and skipped', () => {
  assert.deepEqual(resolveTitleModel({ runModel: 'r' }, deps({ stored: () => 'gone', inCatalog: (id) => id !== 'gone' })),
    { model: 'r', source: 'run', stale: 'gone' });
  assert.deepEqual(resolveTitleModel({}, deps({ stored: () => 'gone', inCatalog: () => false })),
    { model: DEFAULT_TITLE_MODEL, source: 'builtin', stale: 'gone' });
});

test('describeTitleModel: what the Settings card paints', () => {
  assert.deepEqual(describeTitleModel(deps()), { model: null, source: 'run', stale: null });
  assert.deepEqual(describeTitleModel(deps({ stored: () => 's' })), { model: 's', source: 'settings', stale: null });
  assert.deepEqual(describeTitleModel(deps({ env: { WORCA_TITLE_MODEL: 'e' }, stored: () => 's' })), { model: 'e', source: 'env', stale: null });
  assert.deepEqual(describeTitleModel(deps({ stored: () => 'gone', inCatalog: () => false })), { model: null, source: 'run', stale: 'gone' });
});

test('generateTitle spawns with the RUN model and --effort low when nothing else is configured', POSIX_SHIM, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-title-model-'));
  const out = join(dir, 'argv.txt');
  const bin = join(dir, 'fake-claude.sh');
  // The runner parses stream-json: the reply rides a `result` frame.
  const frame = join(dir, 'frame.json');
  await writeFile(frame, JSON.stringify({ type: 'result', result: 'Some Title' }) + '\n', 'utf8');
  await writeFile(bin, '#!/bin/sh\nprintf "%s\\n" "$@" > ' + JSON.stringify(out) + '\ncat ' + JSON.stringify(frame) + '\nexit 0\n', 'utf8');
  await chmod(bin, 0o755);
  const prev = { WORCA_MOCK: process.env.WORCA_MOCK, WORCA_TITLE_MODEL: process.env.WORCA_TITLE_MODEL };
  delete process.env.WORCA_MOCK; delete process.env.WORCA_TITLE_MODEL;
  try {
    const t = await generateTitle('some task', { cwd: dir, bin, runModel: 'endpoint-model-x' });
    assert.equal(t, 'Some Title');
    const argv = (await readFile(out, 'utf8')).split('\n');
    assert.equal(argv[argv.indexOf('--model') + 1], 'endpoint-model-x', 'the run model is the title model');
    assert.equal(argv[argv.indexOf('--effort') + 1], AUX_EFFORT, 'aux effort, not a pipeline EFFORTS member');
    assert.equal(AUX_EFFORT, 'low');
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(dir, { recursive: true, force: true });
  }
});

test('generateTitle reports a failed call ONCE through onError (with the model), still returns ""', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-title-err-'));
  const prev = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  const calls = [];
  try {
    const t = await generateTitle('some task', {
      cwd: dir, bin: join(dir, 'no-such-claude'), runModel: 'm1', mock: false,
      onError: (info) => calls.push(info),
    });
    assert.equal(t, '');
    assert.equal(calls.length, 1, 'exactly one report');
    assert.equal(calls[0].model, 'm1');
    assert.ok(calls[0].error instanceof Error && calls[0].error.message, 'carries the spawn error');
  } finally {
    if (prev === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test('generateTitle: a throwing onError sink never breaks the caller; no report in mock mode success', async () => {
  const t = await generateTitle('Add a settings page with dark mode', {
    cwd: process.cwd(), mock: true, runModel: 'm1', onError: () => { throw new Error('sink boom'); },
  });
  assert.ok(t.length > 0, 'mock title produced');
});

test('run-harness passes the run model + an onError sink to generateTitle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-title-harness-'));
  try {
    const orch = createOrchestrator({ projectDir: dir, prompt: 'p', auto: true, claude: { mock: true, model: 'run-model-z' } });
    const o = orch._titleGenOpts();
    assert.equal(o.runModel, 'run-model-z');
    assert.equal(o.mock, true);
    assert.equal(typeof o.onError, 'function');
    // The sink writes a warn line into the run log rather than throwing.
    const logged = [];
    orch._log = (source, level, text) => logged.push({ source, level, text });
    o.onError({ model: 'run-model-z', error: new Error('boom') });
    assert.equal(logged.length, 1);
    assert.equal(logged[0].level, 'warn');
    assert.match(logged[0].text, /title generation failed \(model run-model-z\): boom/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
