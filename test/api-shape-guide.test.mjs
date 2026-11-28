// test/api-shape-guide.test.mjs — Shaper ask screens, slice 3: GET /api/shape/guide and PUT /api/shape/guide/prefs
// (the viewer's Guide prefs and the Guide model's name, ui/routes/shape/guide.mjs), and the `guideModel` setting on
// GET/POST /api/settings. Behind the shaperSmallRuns flag: off, both routes are 404 and settings answer as today.
// No check runs here.
//
// SANDBOX: HOME/USERPROFILE point at a temp dir, as in test/api-answerer.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let home, srv, base, prev;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-guideapi-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK', 'WORCA_PROJECTS_ROOT',
    'WORCA_IDENTITY_HEADER', 'WORCA_IDENTITY_TRUSTED_PROXIES', 'WORCA_FLAGS']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
  delete process.env.WORCA_PROJECTS_ROOT;
  delete process.env.WORCA_IDENTITY_HEADER;
  delete process.env.WORCA_FLAGS;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  _resetForTests();
  const { app } = await import('../ui/server.mjs');
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await rm(home, { recursive: true, force: true, maxRetries: 5 });
});

const JSONH = { 'Content-Type': 'application/json' };
const send = (method, path, body, headers = {}) => fetch(`${base}${path}`, { method, headers: { ...JSONH, ...headers }, body: JSON.stringify(body) });
const getGuide = (headers = {}) => fetch(`${base}/api/shape/guide`, { headers });
const guide = async (headers = {}) => {
  const r = await getGuide(headers);
  assert.equal(r.status, 200, 'GET /api/shape/guide');
  return r.json();
};
const putPrefs = (body, headers = {}) => send('PUT', '/api/shape/guide/prefs', body, headers);
const putLead = (lead) => send('PUT', '/api/answerer', { lead });
const getSettings = async () => (await fetch(`${base}/api/settings`)).json();
const postSettings = (body) => send('POST', '/api/settings', body);

const settingsFile = () => join(home, '.worca-cc', 'settings.json');
const settingsBytes = () => (existsSync(settingsFile()) ? readFileSync(settingsFile(), 'utf8') : null);
const stored = () => JSON.parse(settingsBytes() || '{}');
const record = (key = '') => stored().answererProfiles?.[key];
function seed(patch) {
  mkdirSync(join(home, '.worca-cc'), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify({ ...stored(), ...patch }));
}
const prefsOf = ({ on, offerSeen, rowsOpen }) => ({ on, offerSeen, rowsOpen });
const DEFAULTS = { on: true, offerSeen: false, rowsOpen: false };

async function withFlags(value, fn) {
  const was = process.env.WORCA_FLAGS;
  if (value === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = value;
  try { await fn(); } finally {
    if (was === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = was;
  }
}
const on = (fn) => () => withFlags('shaperSmallRuns', fn);

test('R-qa-7: flag off, both Guide routes are 404 and write nothing; the same server answers them with the flag on', async () => {
  await withFlags(undefined, async () => {
    seed({ answererProfiles: { '': { lead: 'qa' } } });
    const before = settingsBytes();
    const read = await getGuide();
    assert.equal(read.status, 404);
    assert.deepEqual(await read.json(), { error: 'not found' });
    assert.equal((await putPrefs({ on: false })).status, 404);
    assert.equal(settingsBytes(), before);
  });
  await withFlags('shaperSmallRuns', async () => {
    assert.equal((await getGuide()).status, 200, 'registered: the 404 above is the flag\'s');
  });
});

test('flag on, a fresh profile: the defaults and the Guide model as { id, label }', on(async () => {
  seed({ answererProfiles: {}, guideModel: undefined });
  const body = await guide();
  assert.deepEqual(Object.keys(body).sort(), ['model', 'offerSeen', 'on', 'rowsOpen']);
  assert.deepEqual(prefsOf(body), DEFAULTS);
  const { resolveNamingModel } = await import('../src/core/naming.mjs');
  const { listModels, modelCostConfig, modelLabelOf } = await import('../src/core/config.mjs');
  const pick = resolveNamingModel({ model: null, effort: null }, await listModels(''), modelCostConfig);
  assert.deepEqual(body.model, pick.model ? { id: pick.model, label: modelLabelOf(pick.model) } : null);
  assert.ok(body.model?.label, 'a built-in Claude model is ready in a clean home');
}));

test('R-qa-8: PUT on:false answers the prefs, and a new GET (the reload) reads on:false; only non-default prefs are stored', on(async () => {
  seed({ answererProfiles: {} });
  const r = await putPrefs({ on: false });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { on: false, offerSeen: false, rowsOpen: false });
  assert.deepEqual(prefsOf(await guide()), { on: false, offerSeen: false, rowsOpen: false });
  assert.deepEqual(record(), { guideOn: false });

  assert.deepEqual(await (await putPrefs({ offerSeen: true, rowsOpen: true })).json(), { on: false, offerSeen: true, rowsOpen: true });
  assert.deepEqual(record(), { guideOn: false, guideOfferSeen: true, guideRowsOpen: true });

  assert.deepEqual(await (await putPrefs({ on: true, offerSeen: false, rowsOpen: false })).json(), DEFAULTS);
  assert.deepEqual(record(), {}, 'a pref at its default is not stored');
}));

test('R-qa-9 / R-arch-5: the on, offerSeen and rowsOpen writes keep the role, and a role write and clear keep them', on(async () => {
  seed({ answererProfiles: { '': { lead: 'compliance', note: 'kept' } } });
  assert.equal((await putPrefs({ on: false })).status, 200);
  assert.deepEqual(record(), { lead: 'compliance', note: 'kept', guideOn: false });
  assert.equal((await putPrefs({ offerSeen: true })).status, 200);
  assert.deepEqual(record(), { lead: 'compliance', note: 'kept', guideOn: false, guideOfferSeen: true });
  assert.equal((await putPrefs({ rowsOpen: true })).status, 200);
  assert.equal(record().lead, 'compliance');

  assert.equal((await putLead('ux')).status, 200);   // the lead key of "Design"
  assert.deepEqual(prefsOf(await guide()), { on: false, offerSeen: true, rowsOpen: true });
  assert.equal(record().lead, 'ux');
  assert.equal((await putLead(null)).status, 200);
  assert.deepEqual(prefsOf(await guide()), { on: false, offerSeen: true, rowsOpen: true });
  assert.deepEqual(await (await fetch(`${base}/api/answerer`)).json(), { lead: null }, 'the profile route answers the lead only');
}));

test('a refused prefs body is 400 BAD_GUIDE_PREFS and writes nothing', on(async () => {
  seed({ answererProfiles: { '': { lead: 'qa' } } });
  const before = settingsBytes();
  for (const body of [{}, [], { on: 'yes' }, { offerSeen: 1 }, { rowsOpen: null }, { theme: true }, { on: false, theme: true }, { on: false, offerSeen: 'x' }]) {
    const r = await putPrefs(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    const j = await r.json();
    assert.equal(j.error.code, 'BAD_GUIDE_PREFS', JSON.stringify(body));
    assert.equal(j.error.message, 'Guide preferences take on, offerSeen and rowsOpen, each true or false');
  }
  assert.equal(settingsBytes(), before);
}));

test('per person: a write for one signed-in name leaves another at the defaults', on(async () => {
  seed({ answererProfiles: {} });
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try {
    assert.equal((await putPrefs({ on: false, offerSeen: true }, { 'x-test-user': 'Ada@example.com' })).status, 200);
    assert.deepEqual(prefsOf(await guide({ 'x-test-user': 'ada@example.com' })), { on: false, offerSeen: true, rowsOpen: false });
    assert.deepEqual(prefsOf(await guide({ 'x-test-user': 'bob@example.com' })), DEFAULTS);
  } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
  assert.deepEqual(prefsOf(await guide()), DEFAULTS, 'the local record is untouched');
}));

test('R-arch-3 example: a Guide model saved on Models is the model GET /api/shape/guide names', on(async () => {
  for (const [id, label] of [['claude-opus-5-5', 'Opus 5.5'], ['claude-haiku-4-5', 'Haiku 4.5']]) {
    const r = await postSettings({ guideModel: { model: id } });
    assert.equal(r.status, 200);
    assert.deepEqual((await guide()).model, { id, label });
  }
}));

test('settings: flag off, GET carries no Guide keys and a posted guideModel is ignored; flag on, it round-trips', async () => {
  seed({ guideModel: undefined });
  await withFlags(undefined, async () => {
    const r = await postSettings({ guideModel: { model: 'claude-opus-5-5' } });
    assert.equal(r.status, 200);
    const posted = await r.json();
    assert.equal('guideModel' in stored(), false, 'ignored with the flag off');
    for (const j of [posted, await getSettings()]) {
      assert.equal('guideModel' in j, false);
      assert.equal('guideModelEffective' in j, false);
    }
  });
  await withFlags('shaperSmallRuns', async () => {
    const unset = await getSettings();
    assert.deepEqual(unset.guideModel, { model: null, effort: null });
    assert.equal(unset.guideModelEffective.source, 'auto');
    const r = await postSettings({ guideModel: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.deepEqual(j.guideModel, { model: 'claude-opus-5-5', effort: 'high' });
    assert.deepEqual(j.guideModelEffective, { model: 'claude-opus-5-5', effort: 'high', source: 'settings', stale: null });
    assert.deepEqual(stored().guideModel, { model: 'claude-opus-5-5', effort: 'high' });
    const cleared = await (await postSettings({ guideModel: null })).json();
    assert.deepEqual(cleared.guideModel, { model: null, effort: null });
    assert.equal('guideModel' in stored(), false);
  });
});

test('settings: a Codex id, an unknown model and a bad effort are 400 naming guideModel, and nothing is written', on(async () => {
  seed({ guideModel: { model: 'claude-sonnet-5-5' } });
  const before = settingsBytes();
  for (const [bad, re] of [
    [{ model: 'gpt-5.5', effort: 'high' }, /^“Guide model”: "gpt-5\.5" runs on OpenAI Codex\. This setting picks a model Claude Code can run\.$/],
    [{ model: 'no-such-model' }, /The model “no-such-model” is not in the catalog/],
    [{ model: 'claude-haiku-4-5', effort: 'max' }, /does not offer effort "max"/],
    [{ model: '', effort: 'high' }, /“Effort” needs a model/],
  ]) {
    const r = await postSettings({ guideModel: bad, theme: 'dark' });
    assert.equal(r.status, 400, JSON.stringify(bad));
    const j = await r.json();
    assert.match(j.error, re);
    assert.equal(String(j.field).split('.')[0], 'guideModel', JSON.stringify(bad));
    assert.equal(settingsBytes(), before, 'validated before any write, the sibling key included');
  }
}));

test('settings: a valid guideModel beside a refused key is not written either', on(async () => {
  seed({ guideModel: { model: 'claude-sonnet-5-5' } });
  const before = settingsBytes();
  const r = await postSettings({ guideModel: { model: 'claude-opus-5-5' }, pipelineCostLimitUsd: 'x' });
  assert.equal(r.status, 400);
  assert.equal(settingsBytes(), before);
  // The same pick alone is taken, so the refusal above is what held it back.
  assert.equal((await postSettings({ guideModel: { model: 'claude-opus-5-5' } })).status, 200);
  assert.deepEqual(stored().guideModel, { model: 'claude-opus-5-5' });
}));
