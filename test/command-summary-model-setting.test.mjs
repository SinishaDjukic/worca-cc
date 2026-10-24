// test/command-summary-model-setting.test.mjs
// The Models page's Claude tab › Command summaries (#911 slice 2): the { model, effort } pair behind the chat
// command summary call (ask/command-summary.mjs). Harness copied from test/naming-model-setting.test.mjs: catalog-validated
// before any write, cleared by null, reported with its effective pair (resolveNamingModel, as Run naming).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let home, srv, base, runs;
const prev = {};
const JSONH = { 'Content-Type': 'application/json' };
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-csmodel-'));
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

test('commandSummaryModel: unset resolves to the cheapest ready Claude model; a catalog pair round-trips; a refused write changes nothing; null clears', async () => {
  const { commandSummaryModel, SETTINGS_POST_KEYS } = await import('../src/core/settings.mjs');
  assert.ok(SETTINGS_POST_KEYS.includes('commandSummaryModel'));
  let j = await get();
  assert.deepEqual(j.commandSummaryModel, UNSET);
  assert.deepEqual(j.commandSummaryModelEffective, await unsetEffective(), 'unset: resolveNamingModel over the catalog, as Run naming');
  j = await (await post({ commandSummaryModel: { model: 'CLAUDE-OPUS-5-5', effort: 'high' } })).json();
  assert.deepEqual(j.commandSummaryModel, { model: 'claude-opus-5-5', effort: 'high' }, 'canonical catalog casing');
  assert.equal(j.commandSummaryModelEffective.source, 'settings');
  let r = await post({ commandSummaryModel: { model: 'no-such-model' }, titleModel: 'claude-sonnet-5' });
  assert.equal(r.status, 400, 'validation runs before ANY write');
  j = await get();
  assert.deepEqual(j.commandSummaryModel, { model: 'claude-opus-5-5', effort: 'high' }, 'a refused write changes nothing');
  assert.equal(j.titleModel, null, 'not even the other key in the same body');
  assert.deepEqual((await settingsJson()).commandSummaryModel, { model: 'claude-opus-5-5', effort: 'high' });
  assert.deepEqual(commandSummaryModel(), { model: 'claude-opus-5-5', effort: 'high' });
  r = await post({ commandSummaryModel: null });
  assert.deepEqual((await r.json()).commandSummaryModel, UNSET);
  assert.equal('commandSummaryModel' in (await settingsJson()), false, 'null deletes the key');
});
