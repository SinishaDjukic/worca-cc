// test/engine-settings-validators.test.mjs — Settings › Models' utility pickers are Claude slots
// in this release (cascading-settings-design.md D10; the Codex slots arrive with the engine cards):
// a Codex id is a 400 that names it, validated before anything is written.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home, srv, base, prev;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-eng-settings-'));
  prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
  process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_HOME;
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

test('a Codex id in a Claude utility setting is a 400 naming it; nothing is written', async () => {
  const cases = [
    ['titleModel', 'gpt-5.5', 'gpt-5.5'],
    ['autoWorkflowModel', 'gpt-5.5', 'gpt-5.5'],
    ['prDescriptionModel', 'gpt-5.6-sol', 'gpt-5.6-sol'],
    ['memoryDefrag', { model: 'gpt-5.5', effort: 'low' }, 'gpt-5.5'],
    ['workspaceScan', { scanModel: 'gpt-5.5', scanEffort: 'low', agentModel: 'sonnet', agentEffort: 'medium' }, 'gpt-5.5'],
  ];
  for (const [key, value, id] of cases) {
    const r = await post({ [key]: value, theme: 'dark' });
    assert.equal(r.status, 400, key);
    const body = await r.json();
    // #555: the error names the setting by its visible label, and `field` by its key.
    assert.match(body.error, new RegExp(`^“[^”]+”: "${id.replace(/\./g, '\\.')}" runs on Codex — this setting picks a model Claude Code can run\\.$`), key);
    assert.equal(body.field.split('.')[0], key);
  }
  const s = await get();
  assert.equal(s.prDescriptionModel, '');
  assert.equal(s.autoWorkflowModel, '');
  assert.notEqual(s.theme, 'dark', 'a refused POST writes no key');
  const ok = await post({ titleModel: 'claude-haiku-4-5' });
  assert.equal(ok.status, 200, 'a Claude id is still accepted');
});

test('Ask never runs on Cursor; a run may', async () => {
  const { assertAskEngineInput, assertRunEngineInput } = await import('../src/core/settings.mjs');
  assert.throws(() => assertAskEngineInput('cursor'), /askEngine must be one of claude \| codex/);
  assert.equal(assertRunEngineInput('cursor'), 'cursor');
});

test('Cursor: step models without effort; no helper slots', async () => {
  const { assertUtilityModelsInput, assertStepModelsInput } = await import('../src/core/settings.mjs');
  assert.throws(() => assertUtilityModelsInput({ cursor: { title: { model: 'x' } } }), /Cursor runs no helper jobs/);
  assert.deepEqual(assertStepModelsInput({ cursor: { plan: { model: 'x' } } }), { cursor: { plan: { model: 'x' } } });
  assert.throws(() => assertStepModelsInput({ cursor: { plan: { model: 'x', effort: 'high' } } }), /^Error: stepModels\.cursor\.plan: Cursor takes no effort$/);
});

test('a Cursor id in a Claude utility setting is a 400 naming it', async () => {
  const { addGlobalModel } = await import('../src/core/settings.mjs');
  await addGlobalModel({ id: 'cursor-m', engine: 'cursor' });
  const r = await post({ titleModel: 'cursor-m' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /^“[^”]+”: "cursor-m" runs on Cursor — this setting picks a model Claude Code can run\.$/);
});
