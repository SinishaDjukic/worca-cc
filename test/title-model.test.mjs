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
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);
const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const deps = (over = {}) => ({ env: {}, stored: () => null, inCatalog: () => true, ready: () => true, ...over });

test('resolveTitleModel: precedence explicit > env > stored > run > built-in; empty env ignored; off-catalog stored id reported stale', async () => {
  await checkRows([
    { name: 'resolveTitleModel: precedence explicit > env > stored > run > built-in', run: () => {
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
    } },
    { name: 'resolveTitleModel: an EMPTY env override is not an override; the env id is not catalog-checked', run: () => {
      assert.equal(resolveTitleModel({ runModel: 'r' }, deps({ env: { WORCA_TITLE_MODEL: '   ' } })).source, 'run');
      assert.deepEqual(resolveTitleModel({}, deps({ env: { WORCA_TITLE_MODEL: 'off-catalog' }, inCatalog: () => false })),
        { model: 'off-catalog', source: 'env', stale: null });
    } },
    { name: 'resolveTitleModel: a stored id that left the catalog is reported as stale and skipped', run: () => {
      assert.deepEqual(resolveTitleModel({ runModel: 'r' }, deps({ stored: () => 'gone', inCatalog: (id) => id !== 'gone' })),
        { model: 'r', source: 'run', stale: 'gone' });
      assert.deepEqual(resolveTitleModel({}, deps({ stored: () => 'gone', inCatalog: (id) => id !== 'gone' })),
        { model: DEFAULT_TITLE_MODEL, source: 'builtin', stale: 'gone' });
    } },
    { name: 'resolveTitleModel: the built-in Haiku is the last resort only while it is in the catalog AND ready; else no model (the CLI default)', run: () => {
      assert.deepEqual(resolveTitleModel({}, deps({ ready: (id) => id !== DEFAULT_TITLE_MODEL })),
        { model: null, source: 'builtin', stale: null });
      assert.deepEqual(resolveTitleModel({}, deps({ inCatalog: (id) => id !== DEFAULT_TITLE_MODEL })),
        { model: null, source: 'builtin', stale: null });
      assert.deepEqual(resolveTitleModel({}, deps({ stored: () => 'gone', inCatalog: () => false })),
        { model: null, source: 'builtin', stale: 'gone' });
      // A user-chosen model is never readiness-checked: the choice stands.
      assert.deepEqual(resolveTitleModel({ runModel: 'r' }, deps({ ready: () => false })),
        { model: 'r', source: 'run', stale: null });
      assert.deepEqual(resolveTitleModel({}, deps({ stored: () => 's', ready: () => false })),
        { model: 's', source: 'settings', stale: null });
    } },
    { name: 'describeTitleModel: the built-in fallback (Haiku or the CLI default) still reads as "the run model"', run: () => {
      assert.deepEqual(describeTitleModel(deps()), { model: null, source: 'run', stale: null });
      assert.deepEqual(describeTitleModel(deps({ ready: () => false })), { model: null, source: 'run', stale: null });
      assert.deepEqual(describeTitleModel(deps({ stored: () => 'gone', inCatalog: () => false })), { model: null, source: 'run', stale: 'gone' });
      assert.deepEqual(describeTitleModel(deps({ stored: () => 's' })), { model: 's', source: 'settings', stale: null });
      assert.deepEqual(describeTitleModel(deps({ env: { WORCA_TITLE_MODEL: 'e' } })), { model: 'e', source: 'env', stale: null });
    } },
  ]);
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

test('generateTitle retries a rate-limited call (recovery backoff) and titles on the retry', POSIX_SHIM, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-title-429-'));
  const bin = join(dir, 'fake-claude.sh');
  const count = join(dir, 'count');
  const fail = JSON.stringify({ type: 'result', is_error: true, result: 'API Error: Request rejected (429) · openai: rate limited (429)' });
  const ok = JSON.stringify({ type: 'result', result: 'Retried Title' });
  // First call: a 429 on the result frame + the benign notice on stderr, exit 1. Second: a title.
  await writeFile(bin, [
    '#!/bin/sh',
    `if [ -f ${JSON.stringify(count)} ]; then printf '%s\\n' '${ok}'; exit 0; fi`,
    `touch ${JSON.stringify(count)}`,
    `printf '%s\\n' '[claude-code:unrecognized_model] {"model":"m1"}' 1>&2`,
    `printf '%s\\n' '${fail}'`,
    'exit 1',
  ].join('\n') + '\n', 'utf8');
  await chmod(bin, 0o755);
  const prev = { WORCA_MOCK: process.env.WORCA_MOCK, WORCA_RECOVERY_BACKOFF_MS: process.env.WORCA_RECOVERY_BACKOFF_MS };
  delete process.env.WORCA_MOCK; process.env.WORCA_RECOVERY_BACKOFF_MS = '0';
  const errors = [];
  try {
    const t = await generateTitle('some task', { cwd: dir, bin, runModel: 'm1', onError: (i) => errors.push(i) });
    assert.equal(t, 'Retried Title');
    assert.equal(errors.length, 0, 'a call that recovered reports nothing');
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

// The `run` seam stands in for runClaude: it records each attempt's model and
// fails the ones `fails` names (undefined = the no-model CLI-default attempt).
const seam = ({ fails = () => false, cost = null } = {}) => {
  const models = [];
  const run = async (o) => {
    models.push(o.model);
    if (cost != null) o.onEvent({ type: 'result', costUsd: cost, raw: { type: 'result', usage: { input_tokens: 90, output_tokens: 8 } } });
    if (fails(o.model)) throw new Error(`model ${o.model} is not available on this account (404)`);
    return { text: 'Fallback Title' };
  };
  return { run, models };
};
const offline = { bin: '/nonexistent/claude-must-not-spawn', mock: false };

test('generateTitle: no model anywhere and Haiku not ready → ONE call with no --model (the CLI default) titles the run', async () => {
  const { run, models } = seam();
  const errors = [];
  const t = await generateTitle('some task', { ...offline, run, onError: (i) => errors.push(i) }, deps({ ready: () => false }));
  assert.equal(t, 'Fallback Title');
  assert.deepEqual(models, [undefined], 'no model flag at all');
  assert.equal(errors.length, 0);
});

test('generateTitle: the built-in Haiku fails → retried ONCE with no model, the title still comes out', async () => {
  const { run, models } = seam({ fails: (m) => m === DEFAULT_TITLE_MODEL });
  const errors = [];
  const t = await generateTitle('some task', { ...offline, run, onError: (i) => errors.push(i) }, deps());
  assert.equal(t, 'Fallback Title');
  assert.deepEqual(models, [DEFAULT_TITLE_MODEL, undefined]);
  assert.equal(errors.length, 0, 'a fallback that titled reports nothing');
});

test('generateTitle: the built-in Haiku AND the no-model retry fail → onError ONCE, "" (never throws)', async () => {
  const { run, models } = seam({ fails: () => true });
  const errors = [];
  const t = await generateTitle('some task', { ...offline, run, onError: (i) => errors.push(i) }, deps());
  assert.equal(t, '');
  assert.deepEqual(models, [DEFAULT_TITLE_MODEL, undefined], 'one retry, not more');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].model, null, 'the last attempt ran on the CLI default');
  assert.ok(errors[0].error instanceof Error);
});

test('generateTitle: a user-chosen model (explicit, env, settings, run) is NOT retried — the error surfaces through onError', async () => {
  const cases = [
    ['explicit', { model: 'pick-x' }, deps(), 'pick-x'],
    ['env', {}, deps({ env: { WORCA_TITLE_MODEL: 'env-x' } }), 'env-x'],
    ['settings', {}, deps({ stored: () => 'set-x' }), 'set-x'],
    ['run', { runModel: 'run-x' }, deps(), 'run-x'],
  ];
  for (const [source, opts, d, id] of cases) {
    const { run, models } = seam({ fails: () => true });
    const errors = [];
    const t = await generateTitle('some task', { ...offline, ...opts, run, onError: (i) => errors.push(i) }, d);
    assert.equal(t, '', source);
    assert.deepEqual(models, [id], `${source}: one attempt only`);
    assert.equal(errors.length, 1, source);
    assert.equal(errors[0].model, id, source);
  }
});

test('generateTitle: onCost fires once per PRICED attempt, each booked as the model it ran on', async () => {
  const { run } = seam({ fails: (m) => m === DEFAULT_TITLE_MODEL, cost: 0.0021 });
  const seen = [];
  const t = await generateTitle('some task', { ...offline, run, onCost: (c) => seen.push(c) }, deps());
  assert.equal(t, 'Fallback Title');
  assert.deepEqual(seen.map((c) => [c.costUsd, c.model]), [[0.0021, DEFAULT_TITLE_MODEL], [0.0021, null]]);
  assert.equal(seen[1].usage.input_tokens, 90);
});

test('generateTitle: an abort returns "" with no retry and no report', async () => {
  const ctrl = new AbortController();
  const models = [];
  const errors = [];
  const run = async (o) => {
    models.push(o.model);
    ctrl.abort();
    const e = new Error('aborted'); e.name = 'AbortError'; throw e;
  };
  const t = await generateTitle('some task', { ...offline, run, signal: ctrl.signal, onError: (i) => errors.push(i) }, deps());
  assert.equal(t, '');
  assert.deepEqual(models, [DEFAULT_TITLE_MODEL]);
  assert.equal(errors.length, 0);
  // A plain failure that lands after the run was stopped: still no retry.
  const ctrl2 = new AbortController();
  const models2 = [];
  const run2 = async (o) => { models2.push(o.model); ctrl2.abort(); throw new Error('boom'); };
  const t2 = await generateTitle('some task', { ...offline, run: run2, signal: ctrl2.signal }, deps());
  assert.equal(t2, '');
  assert.deepEqual(models2, [DEFAULT_TITLE_MODEL], 'a stopped run never spawns the retry');
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
    // The no-model attempt (the CLI default) names itself instead of printing "null".
    o.onError({ model: null, error: new Error('boom') });
    assert.match(logged[1].text, /title generation failed \(the CLI default model\): boom/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
