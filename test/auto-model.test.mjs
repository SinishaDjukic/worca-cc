import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAutoModel, AUTO_MODEL_ENV } from '../src/core/auto/model.mjs';

const MODELS = [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5' }, { id: 'claude-sonnet-4-6' }, { id: 'my-proxy' }];

test('resolveAutoModel: env wins verbatim, then the setting (catalog only), then sonnet-5, sonnet, first', () => {
  assert.equal(resolveAutoModel(MODELS, { env: { [AUTO_MODEL_ENV]: ' anything-goes ' }, setting: 'claude-opus-5-5' }), 'anything-goes');
  assert.equal(resolveAutoModel(MODELS, { env: {}, setting: 'CLAUDE-OPUS-5-5' }), 'claude-opus-5-5');
  assert.equal(resolveAutoModel(MODELS, { env: {}, setting: 'gone-model' }), 'claude-sonnet-5', 'a stale setting is ignored');
  assert.equal(resolveAutoModel(MODELS.filter((m) => m.id !== 'claude-sonnet-5'), { env: {}, setting: '' }), 'claude-sonnet-4-6');
  assert.equal(resolveAutoModel([{ id: 'my-proxy' }], { env: {}, setting: '' }), 'my-proxy');
  assert.equal(resolveAutoModel([], { env: {}, setting: '' }), '');
});

// The settings tier: sandbox HOME (settings.json lives under HOME, not WORCA_HOME).
let home, srv, base, prev;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-automodel-'));
  prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK, [AUTO_MODEL_ENV]: process.env[AUTO_MODEL_ENV] };
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME; delete process.env[AUTO_MODEL_ENV];
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
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

test('settings: autoWorkflowModel round-trips through the API, validates BEFORE any write, clears on empty, reports the effective model', async () => {
  const { autoWorkflowModel, setAutoWorkflowModel, assertAutoWorkflowModelInput, SETTINGS_POST_KEYS } = await import('../src/core/settings.mjs');
  assert.ok(SETTINGS_POST_KEYS.includes('autoWorkflowModel'), 'the key is registered beside its setter (the root-clearing guard reads this list)');
  assert.equal(autoWorkflowModel(), '');
  let j = await get();
  assert.equal(j.autoWorkflowModel, '');
  assert.deepEqual(j.autoWorkflowModelEffective, { model: 'claude-sonnet-5', source: 'default' });
  let r = await post({ autoWorkflowModel: 'CLAUDE-OPUS-5-5' });
  assert.equal(r.status, 200);
  j = await r.json();
  assert.equal(j.autoWorkflowModel, 'claude-opus-5-5', 'canonical catalog casing');
  assert.deepEqual(j.autoWorkflowModelEffective, { model: 'claude-opus-5-5', source: 'settings' });
  assert.equal(autoWorkflowModel(), 'claude-opus-5-5');
  r = await post({ autoWorkflowModel: 'no-such-model' });
  assert.equal(r.status, 400);
  assert.equal(autoWorkflowModel(), 'claude-opus-5-5', 'a rejected write changes nothing');
  r = await post({ autoWorkflowModel: 'no-such-model', titleModel: 'claude-sonnet-5' });
  assert.equal(r.status, 400, 'validation runs before ANY write');
  assert.equal((await get()).titleModel, null, 'the sibling key of a rejected body was not written either');
  r = await post({ autoWorkflowModel: '' });
  assert.equal((await r.json()).autoWorkflowModel, '');
  // The route CLEARS root for a POST that names no SETTINGS_POST_KEYS key — pin the
  // CONSEQUENCE, not just the list membership (measured: with the key missing from
  // the list, an autoWorkflowModel-only POST wiped root and no existing test noticed).
  const rootDir = await mkdtemp(join(tmpdir(), 'worca-cc-automodel-root-'));
  try {
    assert.equal((await (await post({ root: rootDir })).json()).root, rootDir);
    await post({ autoWorkflowModel: 'claude-opus-5-5' });
    assert.equal((await get()).root, rootDir, 'an autoWorkflowModel-only POST must not clear the root');
  } finally {
    await post({ root: '' });
    await rm(rootDir, { recursive: true, force: true });
  }
  process.env[AUTO_MODEL_ENV] = 'x-env';
  try { assert.deepEqual((await get()).autoWorkflowModelEffective, { model: 'x-env', source: 'env' }); } finally { delete process.env[AUTO_MODEL_ENV]; }
  assert.equal(assertAutoWorkflowModelInput('', null), null);
  assert.equal(assertAutoWorkflowModelInput(' claude-OPUS-5-5 ', [{ id: 'claude-opus-5-5' }]), 'claude-opus-5-5');
  assert.throws(() => assertAutoWorkflowModelInput(42), /catalog model id/);
  assert.throws(() => assertAutoWorkflowModelInput('nope', [{ id: 'claude-opus-5-5' }]), /unknown model "nope"/);
  await assert.rejects(() => setAutoWorkflowModel(42), /catalog model id/);
});
