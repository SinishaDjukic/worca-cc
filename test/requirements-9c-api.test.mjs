// test/requirements-9c-api.test.mjs — the model choice API (plans/requirements-9c-design.md §5, D2, D6-D10, D14, D18): the harness
// list, the estimates, the choice at create, the switch, the brief's choice, the costs. A bare express app, fake runner only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { useTempHome } from './helpers/temp-home.mjs';
import { createAskModels } from '../src/core/ask/models.mjs';
import { recordRequirementsCostDelta } from '../src/core/cost-budget.mjs';
import {
  createFeature, getFeature, listTurns, insertHelperMessage, updateFeature, appendTurn, setContext, listAttachments, getBrief, beginBrief, saveBriefResult,
} from '../src/core/requirements/store.mjs';
import { settled, startOrientation } from '../src/core/requirements/interview.mjs';
import { addAttachments, readsSettled } from '../src/core/requirements/attachment-job.mjs';
import { markStarting, unmarkStarting } from '../src/core/requirements/starting.mjs';
import { registerRequirementsRoutes, REQUIREMENTS_ROUTES } from '../src/core/requirements/routes.mjs';

useTempHome(after, 'worca-req-9c-api-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'requirements';
delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;

const RAW = [
  { id: 'claude-opus-x', label: 'Opus X', efforts: ['medium', 'high'], engine: 'claude' },
  { id: 'gpt-everyday', label: 'GPT Everyday', efforts: ['low', 'medium'], engine: 'codex' },
  { id: 'cop-1', label: 'Cop One', efforts: ['medium'], engine: 'copilot' },
];
const ask = createAskModels({ listModels: async () => RAW, askPrefs: () => ({ engine: 'claude', slots: {} }), codexAvailable: () => true, copilotAvailable: () => true });
const ROUND1 = { spec: { goal: { text: 'Cancel before shipping', measure: 'fewer calls' } }, criteria: [{ id: null, text: 'A customer can cancel an unpaid order' }],
  questions: [{ id: 'who', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers', why: 'w' }], done: false, note: 'One question.' };
const calls = [];
const state = { engines: ['claude', 'codex', 'copilot'], readiness: [], gate: async () => null, engine: 'claude' };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = { name: 'screen.png', kind: 'image', mime: 'image/png', data: PNG, bytes: PNG.length, sha256: sha(PNG) };

const deps = {
  runClaudeImpl: async (opts) => {
    calls.push(opts);
    if (state.hold) await state.hold;
    const reading = /summar/i.test(String(opts.systemPrompt || '')) && !/question/i.test(String(opts.prompt || ''));
    const text = JSON.stringify(reading ? { summary: 'A screen.' } : ROUND1);
    opts.onEvent?.({ type: 'result', raw: { type: 'result', total_cost_usd: 0.1, result: text }, costUsd: 0.1 });
    return { text };
  },
  listModels: async () => RAW,
  interviewModel: async () => ({ model: 'claude-opus-x', effort: 'medium' }),
  interviewSlot: () => ({}),
  userSignIn: () => false,
  resolveEngine: () => ({ engine: state.engine }),
  engines: () => state.engines,
  readiness: async () => state.readiness,
  roleModel: () => null,
  resolveRole: (engine) => (engine === 'codex' ? { model: 'gpt-everyday' } : null),
  catalog: ask.askCatalog,
  validate: ask.validateModelEffort,
  gate: (...a) => state.gate(...a),
  onChange: () => {},
  startRun: async () => ({ status: 200, body: {} }),
};

let srv; let base; let projKey; let projDir;
before(async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'req-9c-api-shop-'));
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  setContext('project', projKey, { lookAtCode: false });
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  registerRequirementsRoutes(app, { broadcast: () => {}, deps });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(projDir, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const P = '/api/requirements';
const own = (f) => ({ type: 'feature', id: f.seq });
const featureOn = (engine, model) => {
  const f = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel order', description: 'Before it ships' });
  if (engine) updateFeature(f.seq, { model: { engine, model, effort: null } });
  return f;
};
const CODEX = { engine: 'codex', model: 'gpt-everyday', effort: null };

test('flag off: the new routes answer the flag gate 404', async () => {
  delete process.env.WORCA_FLAGS;
  try {
    for (const [m, p] of [['GET', '/models'], ['GET', '/estimates?engine=claude&model=x'], ['PUT', '/1/model'], ['GET', '/1/costs']]) {
      const r = await call(m, `${P}${p}`, m === 'GET' ? undefined : {});
      assert.deepEqual([r.status, r.json], [404, { error: 'not found' }], `${m} ${p}`);
    }
  } finally { process.env.WORCA_FLAGS = 'requirements'; }
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  for (const k of [`GET ${P}/models`, `GET ${P}/estimates`, `PUT ${P}/:seq/model`, `GET ${P}/:seq/costs`]) assert.ok(keys.includes(k), k);
  assert.ok(keys.indexOf(`GET ${P}/models`) < keys.indexOf(`GET ${P}/:seq`));
  assert.ok(keys.indexOf(`GET ${P}/estimates`) < keys.indexOf(`GET ${P}/:seq`));
});

test('GET /models: the offered harnesses (never Cursor), a broker-locked one marked, the catalog, the defaults and the recommended models', async () => {
  state.readiness = [{ name: 'claude', ready: true }, { name: 'codex', ready: false, reason: 'broker', broker: true }, { name: 'copilot', ready: false, reason: 'not signed in' }];
  state.engines = ['claude', 'codex', 'copilot', 'cursor'];   // even a source that offered Cursor would not list it
  const r = await call('GET', `${P}/models`);
  state.engines = ['claude', 'codex', 'copilot'];
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.harnesses.map((h) => h.engine), ['claude', 'codex', 'copilot']);
  const [claude, codex, copilot] = r.json.harnesses;
  assert.deepEqual([claude.label, claude.choiceLabel, claude.ready, claude.broker, claude.repo, claude.files, claude.company], ['Claude Code', 'Claude Code', true, false, true, true, 'Anthropic']);
  assert.deepEqual([codex.ready, codex.broker, codex.short, codex.repo, codex.files, codex.company], [false, true, 'Off while the credential broker is on', true, false, 'OpenAI']);
  assert.deepEqual([copilot.ready, copilot.broker, copilot.short, copilot.keepsCopy], [false, false, 'Not signed in', true]);
  assert.ok(r.json.models.some((m) => m.id === 'gpt-everyday'));
  assert.deepEqual(r.json.defaults.claude, { model: 'claude-opus-x', effort: 'medium' });
  assert.equal(r.json.defaults.codex.effort, null);
  assert.deepEqual(r.json.recommended, { claude: null, codex: 'gpt-everyday', copilot: null });
  state.readiness = [];
});

test('GET /estimates: look and round for a model, the brief step, the recommended model; Cursor refused', async () => {
  const f = featureOn();
  appendTurn(f.seq, { kind: 'orientation', model: 'est-model', costUsd: 0.2 });
  appendTurn(f.seq, { kind: 'orientation', model: 'gpt-everyday', costUsd: 0.5 });
  const r = await call('GET', `${P}/estimates?engine=claude&model=est-model`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.look, { usd: 0.2 });
  assert.equal(r.json.round.usd, null);
  assert.equal(typeof r.json.round.reason, 'string');
  assert.equal(r.json.recommended, null);
  const c = await call('GET', `${P}/estimates?engine=codex&model=est-model`);
  assert.deepEqual([c.json.recommended.model, c.json.recommended.look], ['gpt-everyday', { usd: 0.5 }]);
  const b = await call('GET', `${P}/estimates?engine=codex&model=gpt-everyday&step=brief`);
  assert.equal(b.json.brief.usd, null);
  assert.deepEqual(Object.keys(b.json).sort(), ['brief', 'recommended']);
  assert.deepEqual(Object.keys(b.json.recommended).sort(), ['brief', 'model']);
  const x = await call('GET', `${P}/estimates?engine=cursor&model=m`);
  assert.deepEqual([x.status, x.json.error], [400, "Cursor can't run Requirements."]);
  assert.equal((await call('GET', `${P}/estimates?model=m`)).status, 400);
});

test('POST: Cursor and a model that is not on the harness are refused (400) before anything is created; a good pick is stored', async () => {
  const body = { scopeType: 'project', scopeKey: projKey, title: 'Pick', description: 'd' };
  const count = () => call('GET', P).then((r) => r.json.features.length);
  const n0 = await count();
  const cur = await call('POST', P, { ...body, model: { engine: 'cursor', model: 'gpt-everyday', effort: null } });
  assert.deepEqual([cur.status, cur.json.error], [400, "Cursor can't run Requirements."]);
  const off = await call('POST', P, { ...body, model: { engine: 'claude', model: 'gpt-everyday', effort: null } });
  assert.equal(off.status, 400);
  assert.match(off.json.error, /doesn't run on Claude Code/);
  assert.equal((await call('POST', P, { ...body, model: { engine: 'codex', model: 'nope', effort: null } })).status, 400);
  assert.equal((await call('POST', P, { ...body, model: 'codex' })).status, 400);
  const tk = await call('POST', P, { ...body, model: { engine: 'cursor', model: 'm', effort: null }, fromTicket: { key: 'X-1' } });
  assert.deepEqual([tk.status, tk.json.error], [400, "Cursor can't run Requirements."], 'the ticket path checks the pick first');
  assert.equal(await count(), n0, 'nothing created');
  const ok = await call('POST', P, { ...body, model: CODEX });
  assert.equal(ok.status, 201);
  await settled(ok.json.feature.seq);
  assert.deepEqual(ok.json.feature.model, CODEX);
  assert.equal(ok.json.feature.modelLabel, 'GPT Everyday on OpenAI Codex');
  assert.deepEqual(getFeature(ok.json.feature.seq).model, CODEX);
  assert.equal(calls.at(-1).engine, 'codex');
});

test('POST without a model stores the default choice (an API client keeps working)', async () => {
  const r = await call('POST', P, { scopeType: 'project', scopeKey: projKey, title: 'Default', description: 'd' });
  assert.equal(r.status, 201);
  await settled(r.json.feature.seq);
  assert.deepEqual(r.json.feature.model, { engine: 'claude', model: 'claude-opus-x', effort: 'medium' });
  assert.equal(r.json.feature.modelLabel, 'Opus X on Claude Code');
  state.engine = 'codex';
  try {
    const c = await call('POST', P, { scopeType: 'project', scopeKey: projKey, title: 'Default codex', description: 'd' });
    await settled(c.json.feature.seq);
    assert.equal(c.json.feature.model.engine, 'codex');
  } finally { state.engine = 'claude'; }
});

test('the list: interview.default and fallbackReason; spend.unknownSteps', async () => {
  let r = (await call('GET', P)).json;
  assert.deepEqual(r.interview, { default: { engine: 'claude', model: 'claude-opus-x', label: 'Opus X', effort: 'medium' }, fallbackReason: null });
  assert.equal(typeof r.spend.unknownSteps, 'number');
  state.engine = 'cursor';
  try {
    r = (await call('GET', P)).json;
    assert.equal(r.interview.default.engine, 'claude');
    assert.equal(r.interview.fallbackReason, "Your default engine is Cursor, which can't run Requirements, so this starts on Claude.");
  } finally { state.engine = 'claude'; }
});

test('the feature view: a pre-9c feature shows the resolved Claude pair as legacy; turns keep engine and notices', async () => {
  const f = featureOn();
  appendTurn(f.seq, { kind: 'round', payload: { questions: [] }, engine: 'codex', notices: ['n1'] });
  const v = (await call('GET', `${P}/${f.seq}`)).json;
  assert.deepEqual(v.feature.model, { engine: 'claude', model: 'claude-opus-x', effort: 'medium', legacy: true });
  assert.equal(v.feature.modelLabel, 'Opus X on Claude Code');
  assert.equal(v.feature.anyEstimated, false);
  assert.equal(v.feature.interview.label, 'Opus X');
  const t = v.turns.find((x) => x.kind === 'round');
  assert.deepEqual([t.engine, t.notices], ['codex', ['n1']]);
});

test('PUT /:seq/model: stores the choice, appends a model turn with from, answers the feature view; refusals', async () => {
  const f = featureOn('claude', 'claude-opus-x');
  const url = `${P}/${f.seq}/model`;
  const r = await call('PUT', url, CODEX);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.feature.model, CODEX);
  assert.equal(r.json.feature.modelLabel, 'GPT Everyday on OpenAI Codex');
  const turn = listTurns(f.seq).filter((t) => t.kind === 'model').at(-1);
  assert.deepEqual(turn.payload, { ...CODEX, from: { engine: 'claude', model: 'claude-opus-x', effort: null } });
  assert.equal((await call('PUT', url, { engine: 'cursor', model: 'gpt-everyday', effort: null })).json.error, "Cursor can't run Requirements.");
  assert.equal((await call('PUT', url, { engine: 'codex', model: 'gpt-everyday', effort: 'bogus' })).status, 400);
  assert.equal((await call('PUT', url, undefined)).status, 400);
  assert.equal((await call('PUT', `${P}/999999/model`, CODEX)).status, 404);
  markStarting(f.seq);
  try { assert.equal((await call('PUT', url, { engine: 'claude', model: 'claude-opus-x', effort: null })).status, 409); } finally { unmarkStarting(f.seq); }
  await call('POST', `${P}/${f.seq}/archive`, {});
  assert.equal((await call('PUT', url, { engine: 'claude', model: 'claude-opus-x', effort: null })).status, 409);
});

test('PUT /:seq/model: 409 while a job is running', async () => {
  const f = featureOn('codex', 'gpt-everyday');
  let release;
  state.hold = new Promise((r) => { release = r; });
  try {
    startOrientation(f.seq, { by: 'po' }, deps);
    assert.equal((await call('PUT', `${P}/${f.seq}/model`, { engine: 'claude', model: 'claude-opus-x', effort: null })).status, 409);
  } finally { state.hold = null; release(); await settled(f.seq); }
});

test('PUT /:seq/model to Claude re-queues the files the old harness skipped', async () => {
  const f = featureOn('codex', 'gpt-everyday');
  addAttachments(own(f), [png], { by: 'po' }, deps);
  await readsSettled(own(f));
  assert.equal(listAttachments('feature', f.seq)[0].error.code, 'SKIPPED_ENGINE');
  const r = await call('PUT', `${P}/${f.seq}/model`, { engine: 'claude', model: 'claude-opus-x', effort: null });
  assert.equal(r.status, 200);
  await readsSettled(own(f));
  assert.ok(listAttachments('feature', f.seq).every((x) => x.error?.code !== 'SKIPPED_ENGINE'));
});

test('GET /:seq/costs: rows with labels and ran-on, billed, estimated and unknown apart; the view says anyEstimated', async () => {
  const f = featureOn('codex', 'gpt-everyday');
  const look = appendTurn(f.seq, { kind: 'orientation', payload: {} });
  const r1 = appendTurn(f.seq, { kind: 'round', payload: {} });
  const r2 = appendTurn(f.seq, { kind: 'round', payload: {} });
  const book = (o) => recordRequirementsCostDelta({ featureSeq: f.seq, model: 'gpt-everyday', engine: 'codex', ...o });
  book({ turnId: look, amountUsd: 0.03, step: 'look', costKind: 'billed' });
  book({ turnId: r1, amountUsd: 0.04, step: 'round', costKind: 'estimated' });
  book({ turnId: r2, amountUsd: 0, step: 'round', costKind: 'unknown' });
  book({ turnId: null, amountUsd: 0.01, step: 'chat', costKind: 'billed', helperMessageId: 7 });
  const r = await call('GET', `${P}/${f.seq}/costs`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.rows.map((x) => [x.step, x.label, x.ranOn, x.usd, x.kind]), [
    ['look', 'Code look', 'GPT Everyday on OpenAI Codex', 0.03, 'billed'],
    ['round', 'Round 1', 'GPT Everyday on OpenAI Codex', 0.04, 'estimated'],
    ['round', 'Round 2', 'GPT Everyday on OpenAI Codex', null, 'unknown'],
    ['chat', 'Feature chat', 'GPT Everyday on OpenAI Codex', 0.01, 'billed'],
  ]);
  assert.deepEqual([r.json.billedUsd, r.json.estimatedUsd, r.json.unknownSteps, r.json.totalUsd, r.json.anyEstimated], [0.04, 0.04, 1, 0.08, true]);
  assert.equal((await call('GET', `${P}/${f.seq}`)).json.feature.anyEstimated, true);
  assert.equal((await call('GET', `${P}/999999/costs`)).status, 404);
  // the dialog's budget sentence: the limit (null: none) and the period
  assert.ok('limitUsd' in r.json && ['weekly', 'monthly'].includes(r.json.resetPeriod));
  // each turn names its model label and cost kind (null: nothing booked)
  const turns = (await call('GET', `${P}/${f.seq}`)).json.turns;
  assert.deepEqual(turns.map((t) => [t.id, t.modelLabel, t.costKind]), [[look, null, 'billed'], [r1, null, 'estimated'], [r2, null, 'unknown']]);
});

test('GET /:seq/helper: each reply carries its engine, notices, model label and cost kind', async () => {
  const f = featureOn('codex', 'gpt-everyday');
  appendTurn(f.seq, { kind: 'round', payload: {}, model: 'gpt-everyday', engine: 'codex' });
  await call('GET', `${P}/${f.seq}`);   // a feature view remembers the labels of the models its turns ran on
  const { id } = insertHelperMessage({ featureSeq: f.seq, role: 'worca', text: 'Hi', costUsd: 0.04, model: 'gpt-everyday', engine: 'codex',
    notices: ['Cost estimated: OpenAI Codex reports none.'] });
  recordRequirementsCostDelta({ featureSeq: f.seq, turnId: null, helperMessageId: id, amountUsd: 0.04, model: 'gpt-everyday', engine: 'codex', step: 'chat', costKind: 'estimated' });
  const m = (await call('GET', `${P}/${f.seq}/helper`)).json.messages[0];
  assert.deepEqual([m.engine, m.notices, m.modelLabel, m.costKind], ['codex', ['Cost estimated: OpenAI Codex reports none.'], 'GPT Everyday', 'estimated']);
});

test('feature view: a model turn carries the label of the model it switched to; unknownSteps counts unknown costs', async () => {
  const f = featureOn('codex', 'gpt-everyday');
  const t = appendTurn(f.seq, { kind: 'model', payload: { engine: 'codex', model: 'gpt-everyday', effort: null, from: null } });
  const r = appendTurn(f.seq, { kind: 'round', payload: {} });
  recordRequirementsCostDelta({ featureSeq: f.seq, turnId: r, amountUsd: 0, model: 'gpt-everyday', engine: 'codex', step: 'round', costKind: 'unknown' });
  const v = (await call('GET', `${P}/${f.seq}`)).json;
  assert.equal(v.turns.find((x) => x.id === t).modelLabel, 'GPT Everyday');
  assert.equal(v.feature.unknownSteps, 1);
});

test('GET /:seq/costs: a file read is "File read · <name>"', async () => {
  const f = featureOn('claude', 'claude-opus-x');
  addAttachments(own(f), [png], { by: 'po' }, deps);
  await readsSettled(own(f));
  const row = listAttachments('feature', f.seq)[0];
  recordRequirementsCostDelta({ featureSeq: f.seq, turnId: null, attachmentId: row.id, amountUsd: 0.02, model: 'claude-opus-x', engine: 'claude', step: 'read', costKind: 'billed' });
  const r = (await call('GET', `${P}/${f.seq}/costs`)).json;
  const read = r.rows.filter((x) => x.step === 'read').at(-1);
  assert.deepEqual([read.label, read.ranOn, read.usd], ['File read · screen.png', 'Opus X on Claude Code', 0.02]);
});

test('lookCostUsd follows the feature model', async () => {
  const f = featureOn('copilot', 'cop-1');
  appendTurn(f.seq, { kind: 'orientation', model: 'cop-1', costUsd: 0.4 });
  assert.equal((await call('GET', `${P}/${f.seq}`)).json.feature.lookCostUsd, 0.4);
});

test('the brief: a choice on a harness that cannot read the repo is 400; the page says what it was made with and what the default is', async () => {
  setContext('project', projKey, { lookAtCode: true });
  const r = await call('POST', `${P}/brief/project/${projKey}`, { choice: { engine: 'gemini', model: 'x', effort: null } });
  assert.deepEqual([r.status, r.json.error], [400, "Gemini CLI can't read the repo, so it can't make a Product brief."]);
  assert.equal((await call('POST', `${P}/brief/project/${projKey}`, { choice: { engine: 'cursor', model: 'x', effort: null } })).status, 400);
  const g = (await call('GET', `${P}/brief/project/${projKey}`)).json;
  assert.deepEqual(g.briefDefault, { choice: { engine: 'claude', model: 'claude-opus-x', effort: 'medium' }, fallbackReason: null });
  assert.equal(g.madeWith, null);
  assert.equal(g.estimate.costUsd, null);
  assert.deepEqual(g.estimate.model, { id: 'claude-opus-x', label: 'Opus X' });
  const b = beginBrief('project', projKey, { by: 'po' });
  saveBriefResult(b.id, { sections: { product: 'p', users: [], terms: [], areas: [] }, sources: [], model: 'gpt-everyday', engine: 'codex' });
  assert.equal(getBrief('project', projKey).engine, 'codex');
  const made = (await call('GET', `${P}/brief/project/${projKey}`)).json;
  assert.deepEqual(made.madeWith, { engine: 'codex', model: 'gpt-everyday', label: 'GPT Everyday' });
});

test('the list (B1): each row carries its unknown steps and whether any cost is estimated, as the feature view does', async () => {
  const f = featureOn('copilot', 'cop-1');
  const look = appendTurn(f.seq, { kind: 'orientation', payload: {} });
  const round = appendTurn(f.seq, { kind: 'round', payload: {} });
  for (const [turnId, step] of [[look, 'look'], [round, 'round']]) {
    recordRequirementsCostDelta({ featureSeq: f.seq, turnId, amountUsd: 0, model: 'cop-1', engine: 'copilot', step, costKind: 'unknown' });
  }
  const g = featureOn('codex', 'gpt-everyday');
  recordRequirementsCostDelta({ featureSeq: g.seq, turnId: null, amountUsd: 0.04, model: 'gpt-everyday', engine: 'codex', step: 'round', costKind: 'estimated' });
  const rows = (await call('GET', P)).json.features;
  const row = (x) => rows.find((r) => r.seq === x.seq);
  assert.deepEqual([row(f).costUsd, row(f).unknownSteps, row(f).anyEstimated], [0, 2, false]);
  assert.deepEqual([row(g).unknownSteps, row(g).anyEstimated], [0, true]);
  const v = (await call('GET', `${P}/${f.seq}`)).json.feature;
  assert.equal(v.unknownSteps, row(f).unknownSteps);
});
