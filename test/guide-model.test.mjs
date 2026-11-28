// test/guide-model.test.mjs — the Guide helper job's model (Shaper ask screens, R-arch-3): the stored { model, effort }
// pair `guideModel` (the commandSummaryModel template) and resolveGuideModel, the one function the composer's tooltip and
// the next slice's check both ask. A stored catalog model wins, then the Quick jobs role, else the cheapest ready
// Claude model; none ready, no model. settings.json lives under HOME, so HOME is sandboxed before src/core loads.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'worca-cc-guidemodel-home-'));
const whome = mkdtempSync(join(tmpdir(), 'worca-cc-guidemodel-whome-'));
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
process.env.HOME = home; process.env.USERPROFILE = home;
process.env.WORCA_HOME = whome;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';

// Namespace reads, so a missing new export fails only its own test.
const settings = await import('../src/core/settings.mjs');
const { _resetForTests } = await import('../src/core/db.mjs');

after(() => {
  _resetForTests();
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  for (const d of [home, whome]) rmSync(d, { recursive: true, force: true });
});

const writeSettings = (s) => {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(settings.settingsFile(), JSON.stringify(s));
};
const readBack = () => JSON.parse(readFileSync(settings.settingsFile(), 'utf8'));
beforeEach(() => writeSettings({}));

const CLAUDE = { kind: 'signin', engine: 'claude' };
const row = (id, extra = {}) => ({ id, label: id, efforts: ['low', 'medium', 'high'], engine: 'claude', connection: CLAUDE, harnesses: ['claude'], ...extra });
const ROWS = [row('claude-opus-5-5'), row('claude-haiku-5-5', { efforts: ['medium', 'high'] }), row('claude-sonnet-5-5')];
const noCost = () => null;
const resolve = async (rows = ROWS, costOf = noCost) => (await import('../src/core/guide-model.mjs')).resolveGuideModel(rows, costOf);
const UNSET = { model: null, effort: null };

test('R-arch-3: a stored catalog model is the Guide model, source "settings"', async () => {
  writeSettings({ guideModel: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } });
  assert.deepEqual(await resolve(), { model: 'claude-opus-5-5', effort: 'high', source: 'settings', stale: null });
});

test('R-arch-3 example: changing the stored model changes the model the next call runs on', async () => {
  writeSettings({ guideModel: { model: 'claude-opus-5-5' } });
  assert.equal((await resolve()).model, 'claude-opus-5-5');
  writeSettings({ guideModel: { model: 'claude-sonnet-5-5' } });
  assert.equal((await resolve()).model, 'claude-sonnet-5-5');
});

test('unset: the cheapest ready Claude model at its lowest effort, source "auto", never another helper\'s pick', async () => {
  writeSettings({ commandSummaryModel: { model: 'claude-opus-5-5' }, namingModel: { model: 'claude-opus-5-5' } });
  const { resolveNamingModel } = await import('../src/core/naming.mjs');
  const got = await resolve();
  assert.deepEqual(got, resolveNamingModel(UNSET, ROWS, noCost));
  assert.equal(got.source, 'auto');
  assert.ok(got.model);
});

test('unset with a Quick jobs role: Guide runs on the role\'s model; its own pick wins over the role', async () => {
  const roles = { claude: { quick: { model: 'claude-sonnet-5-5', effort: 'high' } } };
  writeSettings({ modelRoles: roles });
  assert.equal((await resolve()).model, 'claude-sonnet-5-5');
  writeSettings({ modelRoles: roles, guideModel: { model: 'claude-opus-5-5' } });
  assert.equal((await resolve()).model, 'claude-opus-5-5');
});

test('no ready model: model null; a stored id the catalog no longer carries is named stale', async () => {
  const none = [row('claude-haiku-5-5', { needsSignIn: true })];
  assert.equal((await resolve(none)).model, null);
  assert.equal((await resolve([])).model, null);
  writeSettings({ guideModel: { model: 'gone-model' } });
  const got = await resolve();
  assert.equal(got.source, 'auto');
  assert.equal(got.stale, 'gone-model');
});

test('guideModel(): both null when unset; an invalid stored value reads { model: null, effort: null } and resolves auto', async (t) => {
  t.mock.method(console, 'warn', () => {});
  assert.deepEqual(settings.guideModel(), UNSET);
  for (const bad of ['claude-opus-5-5', { effort: 'high' }, { model: '  ' }, 42]) {
    writeSettings({ guideModel: bad });
    assert.deepEqual(settings.guideModel(), UNSET, JSON.stringify(bad));
    assert.equal((await resolve()).source, 'auto', JSON.stringify(bad));
  }
  writeSettings({ guideModel: { model: ' claude-opus-5-5 ', effort: 'nonsense' } });
  assert.deepEqual(settings.guideModel(), { model: 'claude-opus-5-5', effort: null });
});

test('setGuideModel: validated against the catalog, stored under guideModel, null deletes the key; other keys stay', async () => {
  writeSettings({ commandSummaryModel: { model: 'claude-sonnet-5-5' } });
  const out = await settings.setGuideModel({ model: 'CLAUDE-OPUS-5-5', effort: 'high' }, { models: ROWS });
  assert.deepEqual(out, { guideModel: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(readBack().guideModel, { model: 'claude-opus-5-5', effort: 'high' });
  assert.throws(() => settings.assertGuideModelInput({ model: 'no-such-model' }, ROWS), /guideModel|no-such-model/);
  await assert.rejects(settings.setGuideModel({ model: 'no-such-model' }, { models: ROWS }), /no-such-model/);
  assert.deepEqual(readBack().guideModel, { model: 'claude-opus-5-5', effort: 'high' }, 'a refused write changes nothing');
  await settings.setGuideModel(null, { models: ROWS });
  assert.equal('guideModel' in readBack(), false);
  assert.deepEqual(readBack().commandSummaryModel, { model: 'claude-sonnet-5-5' });
});

test('guideModel is a POST key, so a body holding only it never clears the root', () => {
  assert.ok(settings.SETTINGS_POST_KEYS.includes('guideModel'));
});
