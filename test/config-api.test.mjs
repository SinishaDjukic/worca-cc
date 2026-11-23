// test/config-api.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { appServer } from './helpers/app-server.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { checkRows } from './helpers/rows.mjs';

let proj, srv, base, homeDir, prevHome;
const q = (o) => new URLSearchParams(o).toString();

before(async () => {
  // POST /api/config* drives setStep/addCustomModel/removeCustomModel, which now
  // write the DB. Isolate that DB under a throwaway WORCA_HOME and reset the
  // db.mjs singleton so its writes can't leak into / inherit from neighbours in
  // the shared single-process `node --test` run.
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-cfgapi-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-cc-cfgapi-'));
  const { app } = await import('../ui/server.mjs'); // imported => does not bind a port
  srv = appServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(proj, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

test('GET /api/config with and without projectDir: predefined models, empty config, step defs', async () => {
  await checkRows([
    { name: 'GET /api/config returns predefined models + empty config + step defs', run: async () => {
      const r = await fetch(`${base}/api/config?${q({ projectDir: proj })}`);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.deepEqual(j.config, { steps: {}, customModels: [], workflows: {}, activeWorkflowId: 'wf_auto' });
      assert.ok(j.models.some((m) => m.id === 'claude-opus-4-8'));
      assert.ok(j.steps.some((s) => s.key === 'planner'));
      assert.ok(j.efforts.includes('xhigh'));
    } },
    { name: 'GET /api/config without projectDir -> built-in models, empty config', run: async () => {
      const r = await fetch(`${base}/api/config`);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.deepEqual(j.config, { steps: {}, customModels: [] });
      // Every predefined model is present, none flagged custom (no project = no customs).
      assert.ok(j.models.some((m) => m.id === 'claude-opus-4-8'));
      assert.ok(j.models.some((m) => m.id === 'claude-sonnet-4-6'));
      assert.ok(j.models.some((m) => m.id === 'claude-haiku-4-5'));
      assert.ok(j.models.every((m) => m.custom === false));
      assert.ok(j.steps.some((s) => s.key === 'planner'));
    } },
  ]);
});

test('GET /api/config catalog: Opus 5.5 1M-native (no [1m] twin), Opus 4.8/Sonnet 4.6 [1m] variants, no Haiku [1m]', async () => {
  const r = await fetch(`${base}/api/config?${q({ projectDir: proj })}`);
  const j = await r.json();
  await checkRows([
    { name: 'GET /api/config exposes Opus 5.5 (claude-opus-5-5), 1M-native (no [1m] twin)', run: () => {
      assert.equal(r.status, 200);
      const opus5 = j.models.find((m) => m.id === 'claude-opus-5-5');
      assert.ok(opus5, 'claude-opus-5-5 is present in the model catalog');
      assert.equal(opus5.label, 'Opus 5.5');
      assert.equal(opus5.custom, false);
      assert.deepEqual(opus5.efforts, ['medium', 'high', 'xhigh', 'max']);

      // 1M-native: there must be NO separate [1m] twin id.
      assert.ok(
        !j.models.some((m) => m.id === 'claude-opus-5-5[1m]'),
        'no redundant claude-opus-5-5[1m] twin',
      );
    } },
    { name: 'GET /api/config lists the 1M long-context variants', run: () => {
      assert.ok(j.models.some((m) => m.id === 'claude-opus-4-8[1m]'));
      assert.ok(j.models.some((m) => m.id === 'claude-sonnet-4-6[1m]'));
      // Haiku 1M is intentionally absent (subscription-gated).
      assert.ok(!j.models.some((m) => m.id === 'claude-haiku-4-5[1m]'));
    } },
  ]);
});

// Rows: [original title, step, model, effort, expected status]. A 200 is reflected in the
// POST response and in a following GET; a refused effort is a 400.
test('POST /api/config sets a step (Opus 5.5 xhigh, Opus 4.8 max, a 1M model) and GET reflects it; an unsupported effort is a 400', async () => {
  await checkRows([
    ['Opus 5.5 accepts xhigh effort via POST /api/config', 'planner', 'claude-opus-5-5', 'xhigh', 200],
    ['POST /api/config sets a step; GET reflects it', 'reviewer', 'claude-opus-4-8', 'max', 200],
    ['POST /api/config accepts a 1M model + its effort', 'planner', 'claude-opus-4-8[1m]', 'xhigh', 200],
    ['POST /api/config with an unsupported effort -> 400', 'reviewer', 'claude-haiku-4-5', 'xhigh', 400],
  ].map(([name, step, model, effort, status]) => ({ name, run: async () => {
    let r = await fetch(`${base}/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: proj, step, model, effort }),
    });
    assert.equal(r.status, status);
    if (status !== 200) return;
    assert.deepEqual((await r.json()).config.steps[step], { model, effort });
    r = await fetch(`${base}/api/config?${q({ projectDir: proj })}`);
    assert.deepEqual((await r.json()).config.steps[step], { model, effort });
  } })));
});

test('per-project custom-model ADD endpoint is gone; DELETE still cleans up legacy entries', async () => {
  // POST /api/config/models was removed (configurable-models-design.md §4.9):
  // new models are added GLOBALLY via POST /api/models.
  let r = await fetch(`${base}/api/config/models`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectDir: proj, id: 'my-model-x' }),
  });
  assert.equal(r.status, 404);

  // Legacy entries (seeded via the core API existing projects still carry) can
  // still be deleted over HTTP.
  const { addCustomModel } = await import('../src/core/config.mjs');
  await addCustomModel(proj, { id: 'my-model-x' });
  r = await fetch(`${base}/api/config?${q({ projectDir: proj })}`);
  assert.ok((await r.json()).models.some((m) => m.id === 'my-model-x' && m.custom === 'project'));

  r = await fetch(`${base}/api/config/models?${q({ projectDir: proj, id: 'my-model-x' })}`, { method: 'DELETE' });
  assert.equal(r.status, 200);
  assert.ok(!(await r.json()).models.some((m) => m.id === 'my-model-x'));
});

test('POST /api/config passes askQuestions through and responds with the FULL run-config shape', async () => {
  await checkRows([
    { name: 'POST /api/config passes askQuestions through to setStep', run: async () => {
      let r = await fetch(`${base}/api/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: proj, step: 'planner', askQuestions: true }),
      });
      assert.equal(r.status, 200);
      const { config } = await r.json();
      assert.equal(config.steps.planner.askQuestions, true);
    } },
    { name: 'POST /api/config responds with the FULL run-config shape (workflows layer, mirrors PATCH)', run: async () => {
      // Clients assign the response to their whole config state; setStep's legacy
      // {steps, customModels} view dropped config.workflows and made saved node
      // models paint as unconfigured after any default-stage edit.
      const r = await fetch(`${base}/api/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: proj, step: 'refiner', model: 'claude-opus-4-8' }),
      });
      assert.equal(r.status, 200);
      const { config } = await r.json();
      assert.ok(config.workflows && typeof config.workflows === 'object', 'run-config workflows layer present');
      assert.equal(config.steps.refiner.model, 'claude-opus-4-8');
    } },
  ]);
});
