// test/naming-model-setting.test.mjs
// The Models page's Claude tab › Run naming: the { model, effort } pair behind Smart run naming's one
// cheap call (naming.mjs suggestNames). Copies test/agent-gen-model.test.mjs: catalog-validated before
// any write, cleared by an empty value, reported with its effective pair. Unset (or stale) resolves to the
// cheapest ready Claude model (resolveNamingModel), not a CLI default. settings.json lives under HOME, so
// HOME is sandboxed and the test runner's HOME guard lifted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

useTempHome(after);

let home, srv, base, runs;
const prev = {};
const JSONH = { 'Content-Type': 'application/json' };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-namingmodel-'));
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_MOCK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  const mod = await import('../ui/server.mjs');       // imported ⇒ no port bind
  ({ runs } = mod);
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await Promise.race([
    new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
    new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
  ]);
  for (const r of runs?.values() || []) { try { r.orch?.stop?.(); } catch { /* best-effort */ } }
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const get = async () => (await fetch(`${base}/api/settings`)).json();
const post = (body) => fetch(`${base}/api/settings`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
const settingsJson = async () => JSON.parse(await readFile(join(home, '.worca-cc', 'settings.json'), 'utf8'));
const UNSET = { model: null, effort: null };

/** What an unset (or stale) setting resolves to in this sandbox: the cheapest ready Claude model, or none. */
async function unsetEffective(stale = null) {
  const { resolveNamingModel } = await import('../src/core/naming.mjs');
  const { listModels, modelCostConfig } = await import('../src/core/config.mjs');
  return { ...resolveNamingModel(UNSET, await listModels(''), modelCostConfig), stale };
}

async function writeStored(value) {
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  let cur = {};
  try { cur = await settingsJson(); } catch { /* none yet */ }
  await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ ...cur, namingModel: value }));
}

test('settings: namingModel round-trips through the API, validates BEFORE any write, clears on empty, reports the effective pair', async () => {
  const { namingModel, SETTINGS_POST_KEYS } = await import('../src/core/settings.mjs');
  assert.ok(SETTINGS_POST_KEYS.includes('namingModel'), 'the key is registered beside its setter (the root-clearing guard reads this list)');
  const DEFAULT = await unsetEffective();
  assert.notEqual(DEFAULT.source, 'settings');
  assert.deepEqual(namingModel(), UNSET);
  let j = await get();
  assert.deepEqual(j.namingModel, UNSET);
  assert.deepEqual(j.namingModelEffective, DEFAULT, 'unset: the cheapest ready Claude model, or none');
  let r = await post({ namingModel: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } });
  j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(j.namingModel, { model: 'claude-opus-5-5', effort: 'high' }, 'canonical catalog casing');
  assert.deepEqual(j.namingModelEffective, { model: 'claude-opus-5-5', effort: 'high', source: 'settings', stale: null });
  assert.deepEqual((await settingsJson()).namingModel, { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(namingModel(), { model: 'claude-opus-5-5', effort: 'high' });
  // Refusals change nothing on disk.
  for (const [bad, re] of [
    [{ model: 'no-such-model' }, /The model “no-such-model” is not in the catalog/],
    [{ model: 'gpt-5.5', effort: 'high' }, /"gpt-5\.5" runs on Codex\. This setting picks a model Claude Code can run\.$/],
    [{ model: 'claude-haiku-4-5', effort: 'max' }, /does not offer effort "max"/],
    [{ model: '', effort: 'high' }, /“Effort” needs a model/],
    ['claude-opus-5-5', /must be \{ model, effort \}/],
  ]) {
    r = await post({ namingModel: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    const body = await r.json();
    assert.match(body.error, re);
    assert.equal(body.field.split('.')[0], 'namingModel');
  }
  assert.deepEqual(namingModel(), { model: 'claude-opus-5-5', effort: 'high' }, 'a rejected write changes nothing');
  r = await post({ namingModel: { model: 'no-such-model' }, titleModel: 'claude-sonnet-5' });
  assert.equal(r.status, 400, 'validation runs before ANY write');
  assert.equal((await get()).titleModel, null, 'the sibling key of a rejected body was not written either');
  r = await post({ namingModel: { model: 'claude-sonnet-5', effort: '' } });
  j = await r.json();
  assert.deepEqual(j.namingModel, { model: 'claude-sonnet-5', effort: null }, 'a blank effort = the model\'s default effort');
  assert.deepEqual((await settingsJson()).namingModel, { model: 'claude-sonnet-5' });
  for (const empty of [null, '', { model: '', effort: '' }]) {
    await post({ namingModel: { model: 'claude-opus-5-5', effort: 'high' } });
    j = await (await post({ namingModel: empty })).json();
    assert.deepEqual(j.namingModel, UNSET, JSON.stringify(empty));
    assert.deepEqual(j.namingModelEffective, DEFAULT);
    assert.equal('namingModel' in (await settingsJson()), false, 'cleared tidily');
  }
  // A POST naming no SETTINGS_POST_KEYS key clears root — pin that this key is not such a POST.
  const rootDir = await mkdtemp(join(tmpdir(), 'worca-cc-namingmodel-root-'));
  try {
    assert.equal((await (await post({ root: rootDir })).json()).root, rootDir);
    j = await (await post({ namingModel: { model: 'claude-opus-5-5' } })).json();
    assert.equal(j.root, rootDir, 'a namingModel-only POST must not clear the root');
    assert.equal((await get()).root, rootDir);
  } finally {
    await post({ root: '' });
    await post({ namingModel: null });
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('assertNamingModelInput / setNamingModel / namingModel: the pair rule, the catalog casing, hand edits', async () => {
  const { assertNamingModelInput, setNamingModel, namingModel } = await import('../src/core/settings.mjs');
  const MODELS = [{ id: 'claude-opus-5-5', efforts: ['medium', 'high', 'xhigh', 'max'] }, { id: 'claude-haiku-4-5', efforts: ['medium', 'high'] }];
  await checkRows([
    { name: 'assertNamingModelInput: empty / null / blank model clears; the model comes back in the catalog casing', run: () => {
      for (const v of ['', null, undefined, { model: '' }, { model: null, effort: null }]) assert.equal(assertNamingModelInput(v, MODELS), null, JSON.stringify(v));
      assert.deepEqual(assertNamingModelInput({ model: ' claude-OPUS-5-5 ', effort: ' max ' }, MODELS), { model: 'claude-opus-5-5', effort: 'max' });
      assert.deepEqual(assertNamingModelInput({ model: 'my-proxy', effort: 'high' }), { model: 'my-proxy', effort: 'high' }, 'no catalog: the id passes as given');
    } },
    { name: 'assertNamingModelInput: refuses a non-pair, an effort without a model, an unknown model, an unoffered effort', run: () => {
      assert.throws(() => assertNamingModelInput('claude-opus-5-5', MODELS), /^Error: namingModel must be \{ model, effort \} or null$/);
      assert.throws(() => assertNamingModelInput({ effort: 'high' }, MODELS), /namingModel\.effort needs a model/);
      assert.throws(() => assertNamingModelInput({ model: 42 }, MODELS), /namingModel\.model must be a catalog model id/);
      assert.throws(() => assertNamingModelInput({ model: 'nope' }, MODELS), /unknown model "nope"/);
      assert.throws(() => assertNamingModelInput({ model: 'claude-haiku-4-5', effort: 'max' }, MODELS), /claude-haiku-4-5 does not offer effort "max"/);
    } },
    { name: 'setNamingModel refuses before any write; namingModel reads a bad hand edit as unset', run: async () => {
      await assert.rejects(() => setNamingModel({ model: 42 }), /catalog model id/);
      assert.deepEqual(namingModel(), UNSET);
      await writeStored({ model: 'claude-opus-5-5', effort: 'bogus' });
      assert.deepEqual(namingModel(), { model: 'claude-opus-5-5', effort: null }, 'a bad effort reads as the model\'s default effort');
      await writeStored('claude-opus-5-5');
      assert.deepEqual(namingModel(), UNSET, 'not a pair: unset');
      await writeStored({ effort: 'high' });
      assert.deepEqual(namingModel(), UNSET, 'an effort without a model means nothing');
      await setNamingModel(null);
      assert.equal('namingModel' in (await settingsJson()), false);
    } },
  ]);
});

test('GET /api/settings: a stored id the catalog no longer carries reports the cheapest ready model as effective, with stale', async () => {
  await writeStored({ model: 'gone-model', effort: 'high' });
  try {
    const j = await get();
    assert.deepEqual(j.namingModel, { model: 'gone-model', effort: 'high' }, 'the stored pair, as stored');
    assert.deepEqual(j.namingModelEffective, await unsetEffective('gone-model'));
    await writeStored({ model: 'claude-haiku-4-5', effort: 'max' });
    assert.deepEqual((await get()).namingModelEffective, { model: 'claude-haiku-4-5', effort: null, source: 'settings', stale: null },
      'an effort the model does not offer is dropped');
  } finally { await post({ namingModel: null }); }
});
