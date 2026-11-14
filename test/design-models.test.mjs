// test/design-models.test.mjs
// Design's model picks: the lead (main agent) and the builders (one per section). Who picks (the design's own pill,
// the Models page's Design row, the role, the engine's default), how a design stores its picks, the routes that take
// and offer them, the settings key behind the Models page rows, and the pills' pure view.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { JSDOM } from 'jsdom';
import { useDesignEnv } from './helpers/design-fixture.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import { createDesign, getDesign, updateDesign } from '../src/core/design/store.mjs';
import { designModelPick, resolveDesignModel } from '../src/core/design/spawn-options.mjs';
import { designBuildModels } from '../src/core/design/chat-thread.mjs';
import { DESIGN_ENGINES } from '../src/core/design/engines.mjs';
import { assertDesignModelsInput, nextDesignModels } from '../src/core/settings.mjs';
import { DESIGN_ENGINE_NAMES } from '../src/shared/design-names.mjs';
import { roleOfSettingId } from '../src/shared/model-roles.mjs';
import { enginePatchToSettingsBody, designRowId, renderEngineSection } from '../ui/public/engine-settings-view.mjs';
import { readPick, coerceEffort, createModelPills, pillView, readOptions, shortModel, sourceText, splitModels } from '../ui/public/design/model-pills.mjs';

useDesignEnv(after);

const servers = [];
const registries = [];
after(async () => {
  for (const r of registries) { r.pauseAll(); await r.settled(); }
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  }
});

async function mkApp(deps = {}) {
  const designBuilds = createDesignBuilds({ broadcast: () => {}, deps: { mock: true, staggerMs: 0, retryDelayMs: 0 } });
  registries.push(designBuilds);
  const app = express();
  app.use(express.json());
  registerDesignRoutes(app, { broadcast: () => {}, deps: { designBuilds, ...deps } });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;
  return async (method, path, body) => {
    const r = await fetch(`${base}${path}`, {
      method, headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
}
let call;
before(async () => { call = await mkApp(); });

// ── who picks ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('the design pick wins, then the Models page row, then the role, then the engine default', () => {
  const settings = () => ({ claude: { lead: { model: 'claude-opus-5', effort: 'xhigh' }, builder: { model: 'claude-haiku-5-5' } } });
  const design = { models: { lead: { model: 'claude-fable-5-1', effort: 'max' } } };
  assert.deepEqual(designModelPick('lead', { engine: 'claude', design, settings }), { model: 'claude-fable-5-1', effort: 'max', source: 'design' });
  assert.deepEqual(designModelPick('builder', { engine: 'claude', design, settings }), { model: 'claude-haiku-5-5', effort: 'medium', source: 'setting' }, 'no effort: the builder default');
  assert.deepEqual(designModelPick('lead', { engine: 'claude', settings }), { model: 'claude-opus-5', effort: 'xhigh', source: 'setting' });
  assert.deepEqual(designModelPick('lead', { engine: 'codex', settings }), { model: null, effort: 'high', source: 'default' }, 'another engine has its own rows');
  assert.deepEqual(designModelPick('builder', { engine: 'claude', settings: () => ({}) }), { model: null, effort: 'medium', source: 'default' });
  assert.deepEqual(designModelPick('lead', { engine: 'claude', design: { models: { lead: { model: '  ' } } }, settings: () => ({}) }).source, 'default', 'a blank pick is none');
  assert.deepEqual(designModelPick('lead', { engine: 'claude', settings: () => { throw new Error('bad file'); } }).source, 'default', 'an unreadable setting is none');
});

test('resolveDesignModel and designBuildModels read the design picks', () => {
  const design = { engine: 'claude', models: { lead: { model: 'claude-opus-5-5', effort: 'xhigh' }, builder: { model: 'claude-sonnet-5-5' } } };
  assert.deepEqual(resolveDesignModel('lead', { engine: 'claude', design }), { model: 'claude-opus-5-5', effort: 'xhigh' });
  assert.deepEqual(resolveDesignModel('builder', { engine: 'claude', design }), { model: 'claude-sonnet-5-5', effort: 'medium' });
  assert.deepEqual(designBuildModels(design), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual(designBuildModels({ engine: 'claude', models: { lead: { model: 'claude-opus-5-5' }, builder: { model: 'claude-opus-5-5' } } }), ['claude-opus-5-5'], 'one model once');
  assert.deepEqual(designBuildModels({ engine: 'claude' }), [], 'no picks, no role: the CLI default');
});

// ── the store ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('a design keeps its picks; a patch replaces them, null clears them', () => {
  const d = createDesign({ kind: 'web', models: { lead: { model: 'claude-opus-5-5', effort: 'high' }, builder: null } });
  assert.deepEqual(d.models, { lead: { model: 'claude-opus-5-5', effort: 'high' } });
  assert.deepEqual(createDesign({ kind: 'web' }).models, {}, 'none: {}');
  const p = updateDesign(d.id, { models: { builder: { model: 'claude-haiku-5-5' } } });
  assert.deepEqual(p.models, { builder: { model: 'claude-haiku-5-5' } });
  assert.deepEqual(updateDesign(d.id, { models: null }).models, {});
  assert.deepEqual(updateDesign(d.id, { title: 'T' }).models, {}, 'a patch without models keeps them');
  for (const bad of ['x', { cook: { model: 'm' } }, { lead: { model: '' } }, { lead: { model: 'm', extra: 1 } }, { lead: { model: 'm', effort: 3 } }]) {
    assert.throws(() => createDesign({ kind: 'web', models: bad }), /models/, JSON.stringify(bad));
  }
});

// ── the routes ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('POST takes picks the engine runs and stores them; a model the engine cannot run is a 400 and makes nothing', async () => {
  const ok = await call('POST', '/api/design', { kind: 'web', models: { lead: { model: 'claude-opus-5-5', effort: 'xhigh' }, builder: { model: 'claude-sonnet-5-5', effort: 'medium' } } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.design.models, { lead: { model: 'claude-opus-5-5', effort: 'xhigh' }, builder: { model: 'claude-sonnet-5-5', effort: 'medium' } });
  assert.deepEqual(getDesign(ok.json.design.id).models, ok.json.design.models);
  for (const [models, re] of [
    [{ lead: { model: 'gpt-6-sol' } }, /runs on/],
    [{ lead: { model: 'no-such-model' } }, /unknown model/],
    [{ lead: { model: 'claude-opus-5-5', effort: 'minimal' } }, /effort/],
    [{ lead: { effort: 'high' } }, /model is required/],
    [{ cook: { model: 'claude-opus-5-5' } }, /unknown agent/],
    ['x', /models must be/],
  ]) {
    const r = await call('POST', '/api/design', { kind: 'web', title: 'refused', models });
    assert.equal(r.status, 400, JSON.stringify(models));
    assert.match(r.json.error, re);
  }
});

test('PATCH merges one pick, clears one with null and all with models: null', async () => {
  const { json } = await call('POST', '/api/design', { kind: 'web', models: { lead: { model: 'claude-opus-5-5' } } });
  const id = json.design.id;
  let r = await call('PATCH', `/api/design/${id}`, { models: { builder: { model: 'claude-haiku-5-5', effort: 'high' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.models, { lead: { model: 'claude-opus-5-5' }, builder: { model: 'claude-haiku-5-5', effort: 'high' } });
  r = await call('PATCH', `/api/design/${id}`, { models: { lead: null } });
  assert.deepEqual(r.json.models, { builder: { model: 'claude-haiku-5-5', effort: 'high' } });
  r = await call('PATCH', `/api/design/${id}`, { models: { lead: { model: 'gpt-6-sol' } } });
  assert.equal(r.status, 400);
  assert.deepEqual(getDesign(id).models, { builder: { model: 'claude-haiku-5-5', effort: 'high' } }, 'a refusal changes nothing');
  r = await call('PATCH', `/api/design/${id}`, { models: null });
  assert.deepEqual(r.json.models, {});
});

test('GET /models offers the engine models, the design picks and the defaults', async () => {
  const start = await call('GET', '/api/design/models');
  assert.equal(start.status, 200);
  assert.equal(start.json.engine, 'claude');
  assert.ok(start.json.models.some((m) => m.id === 'claude-opus-5-5'));
  assert.ok(start.json.models.every((m) => (m.harnesses || ['claude']).includes('claude')), 'only models Claude runs');
  assert.deepEqual(start.json.models.find((m) => m.id === 'claude-opus-5-5').efforts, ['medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(start.json.picks, { lead: null, builder: null });
  assert.deepEqual(start.json.defaults, { lead: { model: null, effort: 'high', source: 'default' }, builder: { model: null, effort: 'medium', source: 'default' } });
  const codex = await call('GET', '/api/design/models?engine=codex');
  assert.equal(codex.json.engine, 'codex');
  assert.ok(codex.json.models.length && codex.json.models.every((m) => m.harnesses.includes('codex')));
  assert.equal((await call('GET', '/api/design/models?engine=nope')).status, 400);
  const { json } = await call('POST', '/api/design', { kind: 'web', models: { builder: { model: 'claude-sonnet-5-5' } } });
  const one = await call('GET', `/api/design/${json.design.id}/models`);
  assert.deepEqual(one.json.picks, { lead: null, builder: { model: 'claude-sonnet-5-5' } });
  assert.equal((await call('GET', '/api/design/d_000000000000/models')).status, 404);
});

// ── the Models page ─────────────────────────────────────────────────────────────────────────────────────────────────
test('designModels: per engine, lead and builder, each a model pick or null', () => {
  assert.deepEqual(assertDesignModelsInput({ claude: { lead: { model: 'claude-opus-5-5', effort: 'high' }, builder: null } }),
    { claude: { lead: { model: 'claude-opus-5-5', effort: 'high' }, builder: null } });
  for (const bad of [null, { nope: {} }, { claude: { cook: null } }, { claude: { lead: { effort: 'high' } } }, { claude: { lead: { model: 'm', effort: 'minimal' } } }]) {
    assert.throws(() => assertDesignModelsInput(bad), /designModels|model/, JSON.stringify(bad));
  }
  const cur = { claude: { lead: { model: 'a' } }, codex: { builder: { model: 'b' } } };
  assert.deepEqual(nextDesignModels(cur, { claude: { lead: null, builder: { model: 'c' } } }), { claude: { builder: { model: 'c' } }, codex: { builder: { model: 'b' } } });
  assert.equal(nextDesignModels({ claude: { lead: { model: 'a' } } }, { claude: { lead: null } }), undefined, 'empty: the key goes');
});

test('the Engines card rows: their roles, and what Save posts', () => {
  assert.equal(roleOfSettingId(designRowId('claude', 'lead')), 'deep');
  assert.equal(roleOfSettingId(designRowId('codex', 'builder')), 'everyday');
  assert.deepEqual(enginePatchToSettingsBody({
    'models.claude.design.lead': { model: 'claude-opus-5-5', effort: 'high' },
    'models.codex.design.builder': null,
    'models.claude.design.builder': { model: '', effort: 'high' },
  }), { designModels: { claude: { lead: { model: 'claude-opus-5-5', effort: 'high' }, builder: null }, codex: { builder: null } } });
});

test('the Engines card shows Design rows only for the engines it is given', () => {
  const dom = new JSDOM('<!doctype html><body><div id="h"></div></body>');
  const host = dom.window.document.getElementById('h');
  renderEngineSection(host, { level: 'user', roles: [], catalog: [], fields: {}, jobs: {}, designEngines: ['claude'] });
  const ids = [...host.querySelectorAll('.engine-design .inherit-field')].map((el) => el.dataset.setting);
  assert.deepEqual(ids, ['models.claude.design.lead', 'models.claude.design.builder']);
  dom.window.close();
});

test('DESIGN_ENGINE_NAMES is every engine Design builds on', () => {
  const runs = Object.entries(DESIGN_ENGINES).filter(([e, row]) => e !== 'mock' && row.gate !== 'refused').map(([e]) => e);
  assert.deepEqual([...DESIGN_ENGINE_NAMES].sort(), runs.sort());
});

// ── the pills ───────────────────────────────────────────────────────────────────────────────────────────────────────
const OPTS = readOptions({
  engine: 'claude', label: 'Claude', efforts: ['medium', 'high', 'xhigh', 'max'],
  models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] }, { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['medium', 'high'] }],
  picks: { lead: null, builder: { model: 'claude-sonnet-5-5', effort: 'high' } },
  defaults: { lead: { model: 'claude-opus-5-5', effort: 'high', source: 'role' }, builder: { model: null, effort: 'medium', source: 'default' } },
});

test('the pickers read the answer and say who picks, as the Chat button reads', () => {
  assert.equal(readOptions({ engine: 'claude' }), null);
  assert.deepEqual(OPTS.picks, { lead: null, builder: { model: 'claude-sonnet-5-5', effort: 'high' } });
  assert.equal(readPick({ effort: 'high' }), null);
  assert.equal(shortModel('claude-opus-5-5', OPTS.models), 'Opus 5.5');
  assert.equal(sourceText('lead', 'role', 'Claude'), 'Deep thinking');
  assert.equal(sourceText('builder', 'role', 'Claude'), 'Everyday coding');
  assert.equal(sourceText('lead', 'setting', 'Claude'), 'Models page');
  const lead = pillView('lead', null, OPTS);
  assert.deepEqual([lead.agent, lead.model, lead.effort, lead.isDefault], ['Lead', 'Opus 5.5', 'high', true]);
  assert.match(lead.title, /default, from Deep thinking/);
  const b = pillView('builder', OPTS.picks.builder, OPTS);
  assert.deepEqual([b.agent, b.model, b.effort, b.isDefault], ['Builders', 'Sonnet 5.5', 'high', false]);
  assert.deepEqual([pillView('builder', null, OPTS).model, pillView('builder', null, OPTS).effort], ['Default', 'medium']);
  assert.equal(coerceEffort('claude-sonnet-5-5', 'xhigh', OPTS), 'high', 'an effort the model lacks: high');
  const { primary, rest } = splitModels([{ id: 'claude-opus-5-5' }, { id: 'claude-opus-5' }, { id: 'claude-sonnet-5-5' }], null);
  assert.deepEqual([primary.map((m) => m.id), rest.map((m) => m.id)], [['claude-opus-5-5', 'claude-sonnet-5-5'], ['claude-opus-5']]);
  assert.deepEqual(splitModels([{ id: 'claude-opus-5-5' }, { id: 'claude-opus-5' }], 'claude-opus-5').primary.map((m) => m.id), ['claude-opus-5-5', 'claude-opus-5'], 'the pick stays up front');
});

test('a pick in the dock is saved, and a refused save puts it back; Effort opens its own pane', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const doc = dom.window.document;
  const answer = { engine: 'claude', label: 'Claude', efforts: OPTS.efforts, models: OPTS.models, picks: { lead: null, builder: null }, defaults: OPTS.defaults };
  const fetchFn = async () => ({ ok: true, json: async () => answer });
  const saved = [];
  let refuse = '';
  const pills = createModelPills({ doc, fetch: fetchFn, url: () => '/api/design/d_1/models', save: async (role, pick) => { saved.push([role, pick]); return refuse; } });
  doc.body.append(pills.el);
  await pills.load();
  const [leadBtn] = pills.el.querySelectorAll('.dz-model-btn');
  const spans = () => [...leadBtn.querySelectorAll('.ask-model-btn-engine,.ask-model-btn-label,.ask-model-btn-effort')].map((x) => x.textContent);
  assert.deepEqual(spans(), ['Lead', 'Opus 5.5', 'high']);
  const menu = () => pills.el.querySelector('.ask-pop-model:not([hidden])');
  leadBtn.click();
  assert.ok(menu(), 'the Chat picker menu opens');
  [...menu().querySelectorAll('.ask-model-item')].find((b) => b.textContent.startsWith('Sonnet 5.5')).click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved, [['lead', { model: 'claude-sonnet-5-5', effort: 'high' }]]);
  assert.deepEqual(spans(), ['Lead', 'Sonnet 5.5', 'high']);
  leadBtn.click();
  menu().querySelector('.ask-effort-row').click();
  assert.deepEqual([...menu().querySelectorAll('.ask-effort-item')].map((b) => b.textContent), ['medium', 'high'], 'the model\'s own efforts');
  menu().querySelector('.ask-effort-item').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved[1], ['lead', { model: 'claude-sonnet-5-5', effort: 'medium' }]);
  refuse = 'no';
  leadBtn.click();
  menu().querySelector('.dz-model-default').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved[2], ['lead', null]);
  assert.deepEqual(pills.picks(), { lead: { model: 'claude-sonnet-5-5', effort: 'medium' } }, 'refused: the pick is back');
  pills.destroy();
  dom.window.close();
});
