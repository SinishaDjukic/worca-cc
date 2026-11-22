// test/opencode-models-import.test.mjs — the catalogue's OpenCode list and import: `opencode models` read from the
// installed CLI (parseOpencodeModels, opencodeModelIds), then brought into the catalog as engine-'opencode' entries
// (opencodeModelsForImport, importOpencodeModels in provider-ops) and served by the /api/providers/opencode routes.
// The fake binary answers `models` (test/helpers/fake-opencode.mjs); HOME + WORCA_HOME are sandboxed so the catalog
// writes land in temp. Tests build on each other in file order, as api-providers.test.mjs does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { fakeOpencode } from './helpers/fake-opencode.mjs';
import { parseOpencodeModels, opencodeModelIds } from '../src/core/engines/opencode.mjs';
import { opencodeModelsForImport, importOpencodeModels } from '../src/core/bridge/provider-ops.mjs';
import { addGlobalModel, listGlobalModels, removeGlobalModel } from '../src/core/settings.mjs';

const MODELS_TEXT = 'openrouter/z-ai/glm-5.3-prime\nopencode/beam-free\nNOT_A_MODEL\n\naifarm-msp/DeepSeek-V4-Flash-0731\n';
const EXPECTED_IDS = ['openrouter/z-ai/glm-5.3-prime', 'opencode/beam-free', 'aifarm-msp/DeepSeek-V4-Flash-0731'];

let srv, base, homeDir, binDir, configuredBin;
const prevEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_OPENCODE_BIN: process.env.WORCA_OPENCODE_BIN, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const realFetch = globalThis.fetch;

before(async () => {
  homeDir = mkdtempSync(join(tmpdir(), 'worca-cc-ocm-home-'));
  binDir = mkdtempSync(join(tmpdir(), 'worca-cc-ocm-bin-'));
  process.env.HOME = homeDir; process.env.USERPROFILE = homeDir; process.env.WORCA_HOME = homeDir;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  configuredBin = fakeOpencode(binDir, 'x', { modelsText: MODELS_TEXT }).bin;
  process.env.WORCA_OPENCODE_BIN = configuredBin;
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const k of Object.keys(prevEnv)) { if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k]; }
  rmSync(homeDir, { recursive: true, force: true });
  rmSync(binDir, { recursive: true, force: true });
});

const jfetch = async (path, opts) => { const r = await realFetch(`${base}${path}`, opts); return { status: r.status, body: await r.json().catch(() => null) }; };
const post = (path, body) => jfetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

test('parseOpencodeModels: provider/model lines only, order kept, blanks and junk dropped', () => {
  assert.deepEqual(parseOpencodeModels(MODELS_TEXT), EXPECTED_IDS);
  assert.deepEqual(parseOpencodeModels(''), []);
  assert.deepEqual(parseOpencodeModels('notamatch\nmore/x y\n\nprovider/model\n'), ['provider/model']);
  assert.deepEqual(parseOpencodeModels('  openrouter/foo  \r\n openai/bar \n'), ['openrouter/foo', 'openai/bar']);
});

test('opencodeModelIds: one `opencode models` per call, autoupdate silenced', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-ocm-'));
  const fake = fakeOpencode(dir, 'x', { modelsText: MODELS_TEXT });
  process.env.WORCA_OPENCODE_BIN = fake.bin;
  try {
    assert.deepEqual(await opencodeModelIds({ bin: fake.bin }), EXPECTED_IDS);
    assert.deepEqual(await opencodeModelIds({ bin: fake.bin }), EXPECTED_IDS, 'fresh every time (no per-process cache)');
    assert.deepEqual(fake.args(), ['models']);
    assert.equal(fake.env().OPENCODE_DISABLE_AUTOUPDATE, '1');
  } finally {
    process.env.WORCA_OPENCODE_BIN = configuredBin;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /api/providers/opencode/models: the CLI models with their provider and inCatalog', async () => {
  const { status, body } = await jfetch('/api/providers/opencode/models');
  assert.equal(status, 200);
  assert.deepEqual(body.models.map((m) => m.id), EXPECTED_IDS);
  assert.equal(body.models[0].provider, 'openrouter');
  assert.equal(body.models[2].provider, 'aifarm-msp');
  assert.equal(body.models[0].inCatalog, false, 'nothing imported yet');
});

test('import: a fresh model joins the catalogue as an OpenCode entry; a re-import is a no-op', async () => {
  const list = await opencodeModelsForImport();
  assert.deepEqual(list.map((m) => m.inCatalog), [false, false, false]);
  const r = await importOpencodeModels(['openrouter/z-ai/glm-5.3-prime', 'opencode/beam-free', 'ghost/x']);
  assert.deepEqual(r.created.sort(), ['opencode/beam-free', 'openrouter/z-ai/glm-5.3-prime']);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.skipped, [{ id: 'ghost/x', why: 'your opencode does not list it' }]);

  const entry = listGlobalModels().find((m) => m.id === 'openrouter/z-ai/glm-5.3-prime');
  assert.ok(entry, 'stored in the catalog');
  assert.equal(entry.engine, 'opencode');
  assert.equal(entry.label, 'z-ai/glm-5.3-prime (OpenCode)');
  assert.ok(!entry.upstream && !entry.env, 'an own-sign-in engine entry: no upstream, no env');
  assert.deepEqual(await importOpencodeModels(['openrouter/z-ai/glm-5.3-prime']), { created: [], updated: [], skipped: [] },
    'an already-imported OpenCode entry is not counted again');
});

test('an id already held under another engine is skipped, not clobbered', async () => {
  await addGlobalModel({ id: 'aifarm-msp/DeepSeek-V4-Flash-0731', label: 'Taken by Claude', engine: 'claude' });
  const r = await importOpencodeModels(['aifarm-msp/DeepSeek-V4-Flash-0731']);
  assert.deepEqual(r, { created: [], updated: [], skipped: [{ id: 'aifarm-msp/DeepSeek-V4-Flash-0731', why: '"aifarm-msp/DeepSeek-V4-Flash-0731" already exists and is not an OpenCode model' }] });
  await removeGlobalModel('aifarm-msp/DeepSeek-V4-Flash-0731');   // free the id for the route test
});

test('a model the catalogue refuses is skipped with its reason; the ones before and after it are still imported and reported', async () => {
  for (const id of ['openrouter/z-ai/glm-5.3-prime', 'opencode/beam-free']) await removeGlobalModel(id);   // imported above
  const add = async (entry) => { if (entry.id === 'opencode/beam-free') throw new Error('disk full'); return addGlobalModel(entry); };
  const r = await importOpencodeModels(EXPECTED_IDS, { add });
  assert.deepEqual(r.created, ['openrouter/z-ai/glm-5.3-prime', 'aifarm-msp/DeepSeek-V4-Flash-0731']);
  assert.deepEqual(r.skipped, [{ id: 'opencode/beam-free', why: 'disk full' }]);
  // Back to what the tests below start from.
  await removeGlobalModel('aifarm-msp/DeepSeek-V4-Flash-0731');
  await importOpencodeModels(['opencode/beam-free']);
});

test('import with nothing picked is refused', async () => {
  await assert.rejects(() => importOpencodeModels([]), /pick at least one model/);
  await assert.rejects(() => importOpencodeModels([' ']), /pick at least one model/);
});

test('POST /api/providers/opencode/import-models imports into the catalog; /api/models says engine opencode', async () => {
  const imp = await post('/api/providers/opencode/import-models', { ids: ['aifarm-msp/DeepSeek-V4-Flash-0731'] });
  assert.equal(imp.status, 200, JSON.stringify(imp.body));
  assert.deepEqual(imp.body.created, ['aifarm-msp/DeepSeek-V4-Flash-0731']);
  assert.equal(imp.body.models.find((m) => m.id === 'aifarm-msp/DeepSeek-V4-Flash-0731').engine, 'opencode');
  const list = await jfetch('/api/providers/opencode/models');
  assert.equal(list.body.models[2].inCatalog, true, 'the route re-lists it as in the catalog');
});

test('an empty import is refused by the route', async () => {
  const r = await post('/api/providers/opencode/import-models', { ids: [] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /pick at least one/);
});
