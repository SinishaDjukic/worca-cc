// test/pr-description-model.test.mjs
// Settings › Models › PR description model: the model behind the "Ship it?" modal's
// Generate with AI. Mirrors the Auto workflow model setting (test/auto-model.test.mjs):
// catalog-validated, cleared by an empty value, reported with its effective model.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The settings tier: sandbox HOME (settings.json lives under HOME, not WORCA_HOME).
let home, srv, base, prev;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-prdescmodel-'));
  prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  await rm(home, { recursive: true, force: true });
});
const get = async () => (await fetch(`${base}/api/settings`)).json();
const post = (body) => fetch(`${base}/api/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('settings: prDescriptionModel round-trips through the API, validates BEFORE any write, clears on empty, reports the effective model', async () => {
  const { prDescriptionModel, setPrDescriptionModel, assertPrDescriptionModelInput, SETTINGS_POST_KEYS } = await import('../src/core/settings.mjs');
  assert.ok(SETTINGS_POST_KEYS.includes('prDescriptionModel'), 'the key is registered beside its setter (the root-clearing guard reads this list)');
  assert.equal(prDescriptionModel(), '');
  let j = await get();
  assert.equal(j.prDescriptionModel, '');
  assert.deepEqual(j.prDescriptionModelEffective, { model: 'claude-sonnet-5', source: 'default' },
    'the default is Sonnet-class — not Haiku, not the run model');
  let r = await post({ prDescriptionModel: 'CLAUDE-OPUS-5-5' });
  assert.equal(r.status, 200);
  j = await r.json();
  assert.equal(j.prDescriptionModel, 'claude-opus-5-5', 'canonical catalog casing');
  assert.deepEqual(j.prDescriptionModelEffective, { model: 'claude-opus-5-5', source: 'settings' });
  assert.equal(prDescriptionModel(), 'claude-opus-5-5');
  r = await post({ prDescriptionModel: 'no-such-model' });
  assert.equal(r.status, 400);
  assert.equal(prDescriptionModel(), 'claude-opus-5-5', 'a rejected write changes nothing');
  r = await post({ prDescriptionModel: 'no-such-model', titleModel: 'claude-sonnet-5' });
  assert.equal(r.status, 400, 'validation runs before ANY write');
  assert.equal((await get()).titleModel, null, 'the sibling key of a rejected body was not written either');
  r = await post({ prDescriptionModel: '' });
  j = await r.json();
  assert.equal(j.prDescriptionModel, '');
  assert.deepEqual(j.prDescriptionModelEffective, { model: 'claude-sonnet-5', source: 'default' });
  // A POST naming no SETTINGS_POST_KEYS key clears root — pin that this key is not such a POST.
  const rootDir = await mkdtemp(join(tmpdir(), 'worca-cc-prdescmodel-root-'));
  try {
    assert.equal((await (await post({ root: rootDir })).json()).root, rootDir);
    await post({ prDescriptionModel: 'claude-opus-5-5' });
    assert.equal((await get()).root, rootDir, 'a prDescriptionModel-only POST must not clear the root');
  } finally {
    await post({ root: '' });
    await post({ prDescriptionModel: '' });
    await rm(rootDir, { recursive: true, force: true });
  }
  assert.equal(assertPrDescriptionModelInput('', null), null);
  assert.equal(assertPrDescriptionModelInput(' claude-OPUS-5-5 ', [{ id: 'claude-opus-5-5' }]), 'claude-opus-5-5');
  assert.throws(() => assertPrDescriptionModelInput(42), /catalog model id/);
  assert.throws(() => assertPrDescriptionModelInput('nope', [{ id: 'claude-opus-5-5' }]), /unknown model "nope"/);
  await assert.rejects(() => setPrDescriptionModel(42), /catalog model id/);
  // A stored id the catalog no longer carries reports the default as effective.
  const { writeFile, mkdir, readFile } = await import('node:fs/promises');
  const { settingsFile } = await import('../src/core/settings.mjs');
  const file = settingsFile();
  await mkdir(join(file, '..'), { recursive: true });
  let cur = {};
  try { cur = JSON.parse(await readFile(file, 'utf8')); } catch { /* none yet */ }
  await writeFile(file, JSON.stringify({ ...cur, prDescriptionModel: 'gone-model' }));
  try {
    const j = await get();
    assert.equal(j.prDescriptionModel, 'gone-model');
    assert.deepEqual(j.prDescriptionModelEffective, { model: 'claude-sonnet-5', source: 'default' });
  } finally {
    await post({ prDescriptionModel: '' });
  }
});
