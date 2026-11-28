// test/api-shape-guide.test.mjs — Shaper ask screens, slice 3: GET /api/shape/guide and PUT /api/shape/guide/prefs
// (the viewer's Guide prefs and the Guide model's name, ui/routes/shape/guide.mjs), and the `guideModel` setting on
// GET/POST /api/settings. Behind the shaperSmallRuns flag: off, both routes are 404 and settings answer as today.
// Slice 4 (at the end): POST /api/shape/guide/check, with the model stubbed through _setGuideCheckForTest.
//
// SANDBOX: HOME/USERPROFILE point at a temp dir, as in test/api-answerer.test.mjs.
import { test, before, after, afterEach } from 'node:test';
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

// ---------------------------------------------------------------------------------------------------------------------
// Slice 4: POST /api/shape/guide/check. Imported inside the tests, so a missing module fails only these cases.

const grade = () => import('../src/core/prompt-check/grade.mjs');
afterEach(async () => {
  try { (await grade())._setGuideCheckForTest(null); } catch { /* no module: nothing was stubbed */ }
});

const PLAIN = ['Who is it for', 'What they get', 'What starts it', 'Limits', 'How you know it worked'];
const TECHNICAL = ['Who calls it', 'The behaviour', 'Trigger and scope', 'Constraints', 'Acceptance checks'];
const REPLY = JSON.stringify({
  label: 'EVIL',
  checks: { who: { covered: true, label: 'EVIL' }, what: { covered: false, question: 'What does the email hold?' } },
  size: 'medium',
});
const PROMPT = 'Send every team lead a weekly digest of open reviews';
const check = (body, headers = {}) => send('POST', '/api/shape/guide/check', body, headers);

/** Installs a recording stub; `answer(o)` gives the runner's result. `extra`: pickModel, maxInflight. */
async function stubModel(answer = async () => ({ text: REPLY }), extra = {}) {
  const calls = [];
  (await grade())._setGuideCheckForTest({ run: (o) => { calls.push(o); return answer(o); }, ...extra });
  return calls;
}
const refused = async (r, status, code, message, note) => {
  assert.equal(r.status, status, note ?? code);
  assert.deepEqual(await r.json(), { error: { code, message } }, note ?? code);
};
/** 200 with five checks in `labels`, each covered or with a question, a size, the register and the model. */
async function checked(r, register, labels) {
  assert.equal(r.status, 200, `check (${register})`);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ['checks', 'model', 'register', 'size']);
  assert.equal(j.register, register);
  assert.deepEqual(j.checks.map((c) => c.id), ['who', 'what', 'trigger', 'limits', 'done']);
  assert.deepEqual(j.checks.map((c) => c.label), labels);
  for (const c of j.checks) {
    assert.equal(typeof c.covered, 'boolean', c.id);
    if (c.covered) assert.equal(c.question, '', c.id);
    else assert.ok(typeof c.question === 'string' && c.question.length > 0 && c.question.length <= 160, c.id);
  }
  assert.ok(['small', 'medium', 'large'].includes(j.size), j.size);
  assert.ok(j.model.id && j.model.label, 'the model it ran on');
  return j;
}
async function withIdentity(fn) {
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';
  try { await fn(); } finally { delete process.env.WORCA_IDENTITY_HEADER; delete process.env.WORCA_IDENTITY_TRUSTED_PROXIES; }
}
const as = (name) => ({ 'x-test-user': name });
/** A runner that holds a prompt containing HOLDMARK until release() or an abort; every other prompt answers at once. The
 *  safety timer makes a broken abort or release fail the case instead of hanging it. */
function holding() {
  let started, release;
  const isStarted = new Promise((r) => { started = r; });
  const answer = (o) => {
    if (!o.prompt.includes('HOLDMARK')) return Promise.resolve({ text: REPLY });
    return new Promise((resolve, reject) => {
      const safety = setTimeout(() => resolve({ text: REPLY }), 5000);
      release = () => { clearTimeout(safety); resolve({ text: REPLY }); };
      o.signal?.addEventListener('abort', () => { clearTimeout(safety); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
      started();
    });
  };
  /** Waits until the held call reached the runner; fails if the request answered first. */
  const reached = (request) => Promise.race([isStarted, request.then((r) => assert.fail(`answered ${r.status} before the model was called`))]);
  return { answer, reached, release: () => release() };
}

test('R-qa-7 / R-arch-2: check: flag off is 404', async () => {
  const calls = await stubModel();
  await withFlags(undefined, async () => {
    for (const body of [{ prompt: PROMPT }, { prompt: PROMPT, role: 'admin' }, {}]) {
      const r = await check(body);
      assert.equal(r.status, 404, JSON.stringify(body));
      assert.deepEqual(await r.json(), { error: 'not found' });
    }
  });
  assert.equal(calls.length, 0);
  await withFlags('shaperSmallRuns', async () => {
    assert.equal((await check({ prompt: PROMPT })).status, 200, 'registered: the 404 above is the flag\'s');
  });
  // R-arch-7: the route lives in the Guide route module, not in the main server file.
  assert.doesNotMatch(readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8'), /guide\/check/);
});

test('R-qa-8 / R-arch-2 example: no-model and model-failure are distinct', on(async () => {
  seed({ answererProfiles: {} });
  const none = await stubModel(undefined, { pickModel: async () => ({ model: null, effort: null, source: 'default', stale: null }) });
  await refused(await check({ prompt: PROMPT }), 503, 'GUIDE_NO_MODEL', 'Guide has no model to run on.');
  assert.equal(none.length, 0, 'no model: nothing is called');

  for (const [note, answer] of [
    ['a throwing model', async () => { throw new Error('boom'); }],
    ['an unreadable reply', async () => ({ text: 'sure!' })],
  ]) {
    (await grade())._setGuideCheckForTest(null);
    const calls = await stubModel(answer);   // the real pick
    await refused(await check({ prompt: PROMPT }), 502, 'GUIDE_MODEL_FAILED', 'Guide is not answering right now.', note);
    assert.equal(calls.length, 1, note);
  }
}));

test('R-qa-9 / R-qa-10: product reads plain labels', on(async () => {
  seed({ answererProfiles: {} });
  const calls = await stubModel();
  for (const role of ['product', 'ux', 'compliance']) {
    const j = await checked(await check({ prompt: PROMPT, role }), 'plain', PLAIN);
    assert.equal(j.size, 'medium');
    assert.deepEqual([j.checks[0].covered, j.checks[1].question], [true, 'What does the email hold?']);
    assert.doesNotMatch(JSON.stringify(j), /EVIL/, 'a reply cannot set a label');
  }
  assert.equal(calls.length, 3);
  assert.ok(calls[0].prompt.includes(PROMPT) && calls[0].prompt.includes('Who is it for'));
  assert.doesNotMatch(`${calls[2].systemPrompt}\n${calls[2].prompt}`, /compliance/i, 'the model is not told the role');
}));

test('R-qa-9 / R-qa-11 / R-sec-1 example: no role reads technical labels', on(async () => {
  seed({ answererProfiles: { '': { lead: 'product' } } });   // the saved role does not decide: the request's does
  const calls = await stubModel();
  for (const body of [{ prompt: PROMPT }, { prompt: PROMPT, role: null }, { prompt: PROMPT, role: '' }]) {
    await checked(await check(body), 'technical', TECHNICAL);
  }
  for (const role of ['architect', 'qa', 'security', 'devops']) {
    await checked(await check({ prompt: PROMPT, role }), 'technical', TECHNICAL);
  }
  await checked(await check({ prompt: 'a'.repeat(8000) }), 'technical', TECHNICAL);
  assert.equal(calls.length, 8);
  assert.ok(calls[0].prompt.includes('Who calls it'));
}));

test('R-qa-11 / R-sec-1: check refusals never call the model', on(async () => {
  seed({ answererProfiles: {} });
  let picks = 0;
  const calls = await stubModel(undefined, { pickModel: async () => { picks += 1; return { model: 'claude-sonnet-5-5', effort: null }; } });
  const ROLE = ['GUIDE_BAD_ROLE', 'Guide does not know that role.'];
  const EMPTY = ['GUIDE_BAD_PROMPT', 'Guide needs a prompt to check.'];
  const LONG = ['GUIDE_PROMPT_TOO_LONG', 'The prompt is longer than Guide checks (8000 characters).'];
  for (const [body, status, [code, message]] of [
    [{ prompt: PROMPT, role: 'admin' }, 400, ROLE],
    [{ prompt: PROMPT, role: 7 }, 400, ROLE],
    [{ prompt: PROMPT, role: {} }, 400, ROLE],
    [{ prompt: 'a'.repeat(8001) }, 413, LONG],
    [{ prompt: 'a'.repeat(9000), role: 'admin' }, 400, ROLE],
    [{}, 400, EMPTY],
    [{ prompt: '   ' }, 400, EMPTY],
    [[PROMPT], 400, EMPTY],
  ]) {
    await refused(await check(body), status, code, message, `${code}: ${JSON.stringify(body).slice(0, 60)}`);
  }
  assert.equal(calls.length, 0, 'the stubbed model is never called');
  assert.equal(picks, 0, 'refused before a model is picked');
}));

test('R-qa-13 / R-sec-2: with one viewer\'s Guide off the check is 409 GUIDE_OFF with no model call; another viewer is checked', on(async () => {
  seed({ answererProfiles: {} });
  let picks = 0;
  const calls = await stubModel(undefined, { pickModel: async () => { picks += 1; return { model: 'claude-sonnet-5-5', effort: null }; } });
  assert.equal((await putPrefs({ on: false })).status, 200);
  await refused(await check({ prompt: PROMPT }), 409, 'GUIDE_OFF', 'Guide is off.');
  // The input gate comes before the switch.
  assert.equal((await check({ prompt: PROMPT, role: 'admin' })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal(picks, 0);
  assert.equal((await putPrefs({ on: true })).status, 200);
  assert.equal((await check({ prompt: PROMPT })).status, 200, 'switched on again');

  await withIdentity(async () => {
    assert.equal((await putPrefs({ on: false }, as('first@example.com'))).status, 200);
    await refused(await check({ prompt: PROMPT }, as('first@example.com')), 409, 'GUIDE_OFF', 'Guide is off.');
    assert.equal(calls.length, 1);
    await checked(await check({ prompt: PROMPT }, as('second@example.com')), 'technical', TECHNICAL);
    assert.equal(calls.length, 2);
  });
  seed({ answererProfiles: {} });
}));

test('a reached cost limit is 429 GUIDE_COST_LIMIT before the model pick; Guide off is answered first', on(async () => {
  const { recordCostDelta, budgetStatus } = await import('../src/core/cost-budget.mjs');
  const { getDb } = await import('../src/core/db.mjs');
  seed({ answererProfiles: {}, totalCostLimitUsd: 1 });
  try {
    recordCostDelta({ pipelineId: 'guide-budget', amountUsd: 2 });
    assert.equal(budgetStatus().blocked, true, 'fixture: the window is spent');
    let picks = 0;
    const calls = await stubModel(undefined, { pickModel: async () => { picks += 1; return { model: null }; } });
    await refused(await check({ prompt: PROMPT }), 429, 'GUIDE_COST_LIMIT', 'The cost limit is reached; Guide waits until it resets.');
    assert.equal((await putPrefs({ on: false })).status, 200);
    await refused(await check({ prompt: PROMPT }), 409, 'GUIDE_OFF', 'Guide is off.');
    assert.equal(calls.length, 0);
    assert.equal(picks, 0);
  } finally {
    seed({ answererProfiles: {}, totalCostLimitUsd: undefined });
    getDb().exec('DELETE FROM cost_ledger');
  }
}));

test('a check\'s spend is booked as utility cost kind "guide"', on(async () => {
  const { utilityTotals } = await import('../src/core/cost-budget.mjs');
  seed({ answererProfiles: {} });
  const count = () => utilityTotals(0, Date.now() + 60_000).guide?.count ?? 0;
  const was = count();
  await stubModel(async (o) => {
    o.onEvent({ type: 'result', costUsd: 0.002, usage: { input_tokens: 100, output_tokens: 20 } });
    return { text: REPLY };
  });
  assert.equal((await check({ prompt: PROMPT })).status, 200);
  assert.equal(count(), was + 1);
}));

test('R-qa-14: a second check from the same viewer makes the first answer 409 GUIDE_SUPERSEDED', on(async () => {
  seed({ answererProfiles: {} });
  const held = holding();
  const calls = await stubModel(held.answer);
  const first = check({ prompt: `HOLDMARK ${PROMPT}` });
  await held.reached(first);
  const second = check({ prompt: PROMPT });
  await refused(await first, 409, 'GUIDE_SUPERSEDED', 'A newer check replaced this one.');
  await checked(await second, 'technical', TECHNICAL);
  assert.equal(calls.length, 2);
}));

test('R-qa-14: past the cap a check is 429 GUIDE_BUSY with no new model call, and a finished or failed check frees its slot', on(async () => {
  seed({ answererProfiles: {} });
  await withIdentity(async () => {
    const held = holding();
    const calls = await stubModel(held.answer, { maxInflight: 1 });
    const first = check({ prompt: `HOLDMARK ${PROMPT}` }, as('first@example.com'));
    await held.reached(first);
    await refused(await check({ prompt: PROMPT }, as('second@example.com')), 429, 'GUIDE_BUSY', 'Guide is busy; try again in a moment.');
    assert.equal(calls.length, 1);
    held.release();
    await checked(await first, 'technical', TECHNICAL);
    assert.equal((await check({ prompt: PROMPT }, as('second@example.com'))).status, 200, 'the finished check freed its slot');

    (await grade())._setGuideCheckForTest(null);
    await stubModel(async (o) => { if (o.prompt.includes('FAILMARK')) throw new Error('boom'); return { text: REPLY }; }, { maxInflight: 1 });
    assert.equal((await check({ prompt: 'FAILMARK this one' }, as('first@example.com'))).status, 502);
    assert.equal((await check({ prompt: PROMPT }, as('second@example.com'))).status, 200, 'a failed check frees its slot too');
  });
}));

test('R-qa-12 / R-arch-8 / R-sec-2: the check runs on the Guide model', on(async () => {
  const { guideCheckModel } = await grade();
  try {
    seed({ answererProfiles: {}, guideModel: { model: 'claude-opus-5-5', effort: 'high' },
      commandSummaryModel: { model: 'claude-sonnet-5-5' }, titleModel: 'claude-haiku-4-5' });
    const calls = await stubModel();
    const j = await checked(await check({ prompt: PROMPT }), 'technical', TECHNICAL);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'claude-opus-5-5');
    assert.equal(calls[0].effort, 'high');
    assert.deepEqual(j.model, { id: 'claude-opus-5-5', label: 'Opus 5.5' });

    // Unset, it is the job's own auto pick: the one GET /api/shape/guide names, never another helper's model.
    seed({ guideModel: undefined, commandSummaryModel: { model: 'claude-opus-5-5' }, titleModel: 'claude-opus-5-5' });
    const pick = await guideCheckModel();
    const unset = await checked(await check({ prompt: PROMPT }), 'technical', TECHNICAL);
    assert.equal(calls[1].model, pick.model);
    assert.notEqual(calls[1].model, 'claude-opus-5-5');
    assert.deepEqual(unset.model, (await guide()).model);
    assert.equal(unset.model.id, calls[1].model);
  } finally { seed({ guideModel: undefined, commandSummaryModel: undefined, titleModel: undefined }); }
}));

test('R-arch-10: a check logs no prompt text', on(async () => {
  seed({ answererProfiles: {} });
  const SENTINEL = 'SENTINEL-prompt-7c1f';
  const lines = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'];
  const originals = methods.map((m) => console[m]);
  methods.forEach((m) => { console[m] = (...args) => { lines.push(args.map((a) => String(a?.stack ?? (typeof a === 'string' ? a : JSON.stringify(a)))).join(' ')); }; });
  const bodies = [];
  try {
    const body = { prompt: `Digest ${SENTINEL}` };
    await stubModel();
    const ok = await check(body);
    assert.equal(ok.status, 200);

    (await grade())._setGuideCheckForTest(null);
    await stubModel(async () => { throw new Error(`boom ${SENTINEL}`); });
    const failed = await check(body);
    assert.equal(failed.status, 502);
    bodies.push(await failed.text());

    (await grade())._setGuideCheckForTest(null);
    const calls = await stubModel(undefined, { pickModel: async () => { throw new Error(`pick broke ${SENTINEL}`); } });
    const broken = await check(body);
    assert.equal(broken.status, 500);
    const text = await broken.text();
    assert.deepEqual(JSON.parse(text), { error: { code: 'GUIDE_CHECK_FAILED', message: 'Guide could not check the prompt.' } });
    bodies.push(text);
    assert.equal(calls.length, 0);
  } finally { methods.forEach((m, i) => { console[m] = originals[i]; }); }
  assert.deepEqual(lines.filter((l) => l.includes(SENTINEL)), []);
  for (const b of bodies) assert.doesNotMatch(b, /SENTINEL|boom|pick broke/, 'no error body carries err.message');
}));

test('a check leaves settings.json byte-identical', on(async () => {
  seed({ answererProfiles: { '': { lead: 'qa', guideOfferSeen: true } } });
  await stubModel();
  const was = settingsBytes();
  assert.equal((await check({ prompt: PROMPT, role: 'product' })).status, 200);
  assert.equal(settingsBytes(), was);
}));
