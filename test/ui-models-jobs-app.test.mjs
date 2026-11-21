// test/ui-models-jobs-app.test.mjs — the Jobs tab wired into the booted app (models-menu P6, Task 5): it loads GET
// /api/settings, /api/config and /api/engines, keeps one draft for the whole tab (through a harness switch, a tab
// switch and another tab's settings-changed), saves it in ONE POST /api/settings, makes a harness the default at once,
// follows the interface level and the flags, opens the block an address, "Used by" or a search row names, and draws
// from bare stub bodies. The Models page's old Roles and Engines cards are gone; Project settings and the setup
// assistant still draw their own rows. Stubs route by METHOD and path, as test/ui-models-catalogue-app.test.mjs does.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { lastToast } from './helpers/feedback.mjs';
import { readIndexHtml } from '../src/core/read-index-html.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { levelRank } from '../ui/public/ui-level.mjs';
import { ENGINE_NAMES, engineLabel } from '../src/shared/engine-switch.mjs';
import { ROLE_LABELS } from '../src/shared/model-roles.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);
// A throw in an app.js listener reaches the window's `error` event, never the test: every test ends with none.
const pageErrors = [];
afterEach(() => { assert.deepEqual(pageErrors.splice(0), []); });

const html = readIndexHtml();
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const clone = (o) => JSON.parse(JSON.stringify(o));

// Task 2's catalogue (GET /api/config `models`), Task 3's settings and steps.
const CAT = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'], hidden: true },
  { id: 'my-gw', label: 'My GW', custom: 'global', efforts: ['medium', 'high'] },
  { id: 'or-grok', label: 'xAI: Grok (OpenRouter)', custom: 'global', needsSignIn: true, signInReason: 'no_key', bridged: 'openai', upstreamModel: 'x-ai/grok' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];
const SETTINGS = { runEngine: null, modelRoles: { claude: { deep: { model: 'claude-opus-5-5', effort: 'xhigh' } } },
  stepModels: { claude: { reviewer: { model: 'claude-opus-5-5', effort: 'max' }, implementer: { effort: 'high' } } },
  titleModel: 'claude-haiku-4-5', autoWorkflowModel: '', prDescriptionModel: '', agentGenModel: { model: null, effort: null },
  secondOpinionModel: null, memoryDefrag: { model: 'claude-haiku-4-5', effort: null }, designModels: {},
  utilityModels: { codex: { overview: { model: 'gpt-6.1-sol' } } } };
const STEPS = [{ key: 'planner', label: 'Plan' }, { key: 'refiner', label: 'Refine' }, { key: 'implementer', label: 'Implement' },
  { key: 'reviewer', label: 'Review' }, { key: 'manualTestsChecklist', label: 'Manual tests checklist' }];
const ALL_READY = ENGINE_NAMES.map((name) => ({ name, label: engineLabel(name), ready: true }));
const TESTABLE = new Set(['claude-opus-5-5', 'claude-haiku-4-5']);

/** GET /api/models: CAT's rows where the Catalogue keeps them, each with `testable`, and one use of gpt-6.1-sol. */
const modelsBody = () => ({
  predefined: CAT.filter((m) => !m.engine && !m.custom).map((m) => ({ ...m, testable: TESTABLE.has(m.id) })),
  codex: CAT.filter((m) => m.engine === 'codex').map(({ engine, ...m }) => ({ ...m, testable: false })),
  copilot: [], plugin: [], policy: [],
  models: CAT.filter((m) => m.custom === 'global').map(({ custom, ...m }) => ({ ...m, testable: false })),
  efforts: ['medium', 'high'], providers: [], hiddenBuiltins: {},
  uses: { 'gpt-6.1-sol': [{ kind: 'helper', engine: 'codex', key: 'overview', label: 'Run overview' }] },
});

class WSStub {
  constructor() { this.readyState = 1; WSStub.last = this; this._l = {}; }
  send() {} close() {}
  addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
  _open() { (this._l.open || []).forEach((fn) => fn({})); }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };
const ok = (body) => ({ status: 200, body });

/** `arms`: [method, path, body | (postBody) => ({ status, body })], tried in order before the defaults (a path matches
 *  by prefix). `settings`: the GET /api/settings body, or a function of the window (asked on every GET); every answer is
 *  a fresh copy. `level`: the server-rendered interface mode (Expert unless a case says otherwise). Every call is
 *  "<METHOD> <url>"; POST bodies are parsed into `posts`. */
async function boot({ hash = 'models/jobs', arms = [], settings = SETTINGS, level = 'expert', config = { models: CAT, steps: STEPS },
  engines = { engines: ALL_READY }, projects = [] } = {}) {
  const page = html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`);
  const dom = trackDom(new JSDOM(page, { url: `http://localhost:4317/${hash ? `#${hash}` : ''}` }));
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = WSStub;
  window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  window.addEventListener('error', (e) => pageErrors.push(String(e.error?.stack || e.message)));
  const calls = [];
  const posts = [];
  const read = () => clone(typeof settings === 'function' ? settings(window) : settings);
  const all = [
    ...arms,
    ['GET', '/api/models', () => ok(modelsBody())],
    ['GET', '/api/providers', ok({})],
    ['POST', '/api/settings', (body) => ok({ ...read(), ...body })],
    ['GET', '/api/settings', () => ok(read())],
    ['GET', '/api/config', () => ok(clone(config))],
    ['GET', '/api/engines', () => ok(clone(engines))],
    ['GET', '/api/engine-locks', ok({ engines: [] })],
    ['GET', '/api/projects', ok({ projects })],
  ];
  window.fetch = (url, opts = {}) => {
    const u = String(url).replace(/^https?:\/\/[^/]+/, '');
    const method = opts.method || 'GET';
    calls.push(`${method} ${u}`);
    let body = null;
    if (method === 'POST' && typeof opts.body === 'string') { try { body = JSON.parse(opts.body); } catch { body = opts.body; } }
    if (method === 'POST') posts.push({ url: u, body });
    const answer = ({ status = 200, body: b = {} }) => Promise.resolve({ ok: status < 400, status, json: async () => b });
    for (const [m, path, r] of all) {
      if (m === method && u.startsWith(path)) return answer(typeof r === 'function' ? r(body) : r);
    }
    return answer(ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }));
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'requestAnimationFrame']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  window.localStorage.clear();
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  if (WSStub.last) WSStub.last._open();
  await settle();
  return { window, doc: window.document, calls, posts };
}

async function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
  await settle();
}

const press = (window, node) => {
  assert.ok(node, 'the control to press exists');
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
};
/** The label of a menu item: its model name, else its first span (the next and back rows). */
const itemLabel = (b) => (b.querySelector('.ask-model-name') || b.querySelector('span'))?.textContent ?? b.textContent;
/** Press the open picker's item whose label is exactly `label`. */
async function pick(window, doc, label) {
  const pop = doc.querySelector('.mdl-pick-pop');
  assert.ok(pop, 'a picker is open');
  const item = [...pop.querySelectorAll('[role="menuitem"]')].find((b) => itemLabel(b) === label);
  assert.ok(item, `the picker offers "${label}"`);
  press(window, item);
  await settle(2);
}
/** Press the open override menu's item whose name is exactly `label`. */
async function over(window, doc, label) {
  const pop = doc.querySelector('.mdl-over-pop');
  assert.ok(pop, 'an override menu is open');
  const item = [...pop.querySelectorAll('[role="menuitem"]')].find((b) => b.querySelector('span').textContent === label);
  assert.ok(item, `the override menu offers "${label}"`);
  press(window, item);
  await settle(2);
}
const broadcast = async () => {
  WSStub.last._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'settings-changed' }) }));
  await settle();
};
const count = (calls, call) => calls.filter((c) => c === call).length;
const settingsPosts = (posts) => posts.filter((p) => p.url === '/api/settings');
const tile = (doc, engine, role) => doc.querySelector(`#jobs-roles .mdl-tile[data-setting="models.${engine}.roles.${role}"]`);
const tileText = (doc, engine, role) => tile(doc, engine, role)?.querySelector('.mdl-tile-name').textContent;
const hx = (doc, engine) => doc.querySelector(`#jobs-root .mdl-hx [data-engine="${engine}"]`);
const pressed = (doc) => doc.querySelector('#jobs-root .mdl-hx [aria-pressed="true"]')?.dataset.engine;
const jobRow = (doc, id) => [...doc.querySelectorAll('#jobs-root .mdl-job-row')].find((r) => r.dataset.setting === id) || null;
const rowText = (doc, id) => jobRow(doc, id)?.querySelector('.mdl-pick-text').textContent;
const rowEffort = (doc, id) => jobRow(doc, id)?.querySelector('.mdl-pick-eff')?.textContent ?? '';
const bar = (doc) => doc.querySelector('#jobs-root .mdl-savebar');
/** Shown at the page's level: no [hidden] ancestor and every [data-min-level] ancestor at or below the level. */
function visible(doc, node) {
  assert.ok(node, 'the node exists');
  const level = levelRank(doc.documentElement.dataset.level);
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hidden) return false;
    if (n.dataset.minLevel && levelRank(n.dataset.minLevel) > level) return false;
  }
  return true;
}

test('1: the tab paints from settings and config; the old Roles and Engines cards are gone', async () => {
  const { doc, calls } = await boot();
  assert.ok(doc.querySelector('#models-tab-jobs > #jobs-root > .mdl-jobs'), 'the tab is drawn into #jobs-root');
  assert.equal(doc.getElementById('model-roles-card'), null);
  assert.equal(doc.getElementById('engine-settings-card'), null);
  assert.equal(doc.getElementById('engine-settings-root'), null);
  assert.equal(tileText(doc, 'claude', 'deep'), 'Opus 5.5');
  assert.equal(tileText(doc, 'claude', 'everyday'), "Each job's own default");
  assert.equal(pressed(doc), 'claude', 'no default harness: Claude Code');
  // The own rows show folded; /api/config's steps name them; Test needs a model the catalogue marks testable.
  assert.equal(rowText(doc, 'models.claude.steps.reviewer'), 'Opus 5.5');
  assert.ok(jobRow(doc, 'models.claude.steps.reviewer').querySelector('.mdl-job-test'), 'Opus 5.5 is testable (GET /api/models)');
  assert.equal(rowText(doc, 'models.claude.utility.title'), 'Haiku 4.5');
  assert.ok(count(calls, 'GET /api/config') >= 1);
  assert.ok(count(calls, 'GET /api/engines') >= 1);
  assert.equal(bar(doc).hidden, true);
});

test('2: a pick is a draft until Save; one request saves everything', async () => {
  let saved = clone(SETTINGS);
  const { window, doc, posts } = await boot({ settings: () => saved });
  press(window, tile(doc, 'claude', 'quick'));
  await pick(window, doc, 'Haiku 4.5');
  assert.equal(tileText(doc, 'claude', 'quick'), 'Haiku 4.5');
  assert.equal(doc.activeElement, tile(doc, 'claude', 'quick'), 'the repaint hands the focus back to the tile');
  press(window, doc.querySelector('#jobs-steps .mdl-override'));
  await over(window, doc, 'Plan');
  assert.ok(doc.querySelector('.mdl-pick-pop'), "the revealed row's picker opens");
  assert.equal(doc.activeElement.closest('.mdl-pick-pop') !== null, true);
  await pick(window, doc, 'More models');
  await pick(window, doc, 'Opus 5');
  assert.equal(rowText(doc, 'models.claude.steps.planner'), 'Opus 5');
  assert.equal(bar(doc).hidden, false);
  assert.equal(bar(doc).querySelector('.note').textContent, '2 unsaved changes');
  assert.deepEqual(settingsPosts(posts), [], 'nothing is saved before Save');
  press(window, bar(doc).querySelector('.mdl-save'));
  await settle();
  assert.deepEqual(settingsPosts(posts).map((p) => p.body), [{
    modelRoles: { claude: { quick: { model: 'claude-haiku-4-5' } } },
    stepModels: { claude: { planner: { model: 'claude-opus-5' } } },
  }]);
  assert.equal(lastToast(doc)?.title, 'Saved.');
  assert.equal(bar(doc).hidden, true);
  // What is saved now is the answer: the tile keeps its new model with no draft behind it.
  assert.equal(tileText(doc, 'claude', 'quick'), 'Haiku 4.5');
  // Nothing of the draft is left over: what another tab saves next shows as it is.
  saved = { ...SETTINGS, modelRoles: { claude: { ...SETTINGS.modelRoles.claude, quick: { model: 'claude-opus-5' } } } };
  await broadcast();
  assert.equal(tileText(doc, 'claude', 'quick'), 'Opus 5');
  assert.equal(bar(doc).hidden, true);
});

test('3: the draft survives a harness switch, a tab switch and a broadcast; Discard drops it', async () => {
  const { window, doc, calls } = await boot();
  press(window, tile(doc, 'claude', 'deep'));
  await pick(window, doc, "Each job's own default");
  assert.equal(tileText(doc, 'claude', 'deep'), "Each job's own default");
  assert.equal(bar(doc).querySelector('.note').textContent, '1 unsaved change');
  press(window, hx(doc, 'codex'));
  await settle(2);
  assert.equal(pressed(doc), 'codex');
  assert.ok(tile(doc, 'codex', 'deep'), 'the Codex roles show');
  assert.equal(bar(doc).querySelector('.note').textContent, '1 unsaved change', 'the count covers the harness not shown');
  press(window, hx(doc, 'claude'));
  await settle(2);
  assert.equal(tileText(doc, 'claude', 'deep'), "Each job's own default");
  const shown = count(calls, 'GET /api/engines');
  await go(window, 'models');
  assert.equal(count(calls, 'GET /api/engines'), shown, 'the Catalogue reads no readiness of its own here (60 s cache)');
  // One plain hash write: go() dispatches a hashchange of its own besides the one jsdom delivers (two routes).
  window.location.hash = 'models/jobs';
  await settle();
  assert.equal(count(calls, 'GET /api/engines'), shown + 1, 'each Jobs show reads the readiness once');
  assert.equal(tileText(doc, 'claude', 'deep'), "Each job's own default", 'a tab switch keeps the draft');
  assert.equal(bar(doc).querySelector('.note').textContent, '1 unsaved change');
  const engines = count(calls, 'GET /api/engines');
  const reads = count(calls, 'GET /api/settings');
  await broadcast();
  assert.ok(count(calls, 'GET /api/settings') > reads, 'the broadcast re-read the settings');
  assert.equal(count(calls, 'GET /api/engines'), engines, 'a broadcast spawns no readiness preflight');
  assert.equal(bar(doc).querySelector('.note').textContent, '1 unsaved change');
  press(window, bar(doc).querySelector('.mdl-discard'));
  await settle(2);
  assert.equal(bar(doc).hidden, true);
  assert.equal(tileText(doc, 'claude', 'deep'), 'Opus 5.5', 'Discard returns to what is saved');
});

test('4: a refused save keeps the draft and says why on the Jobs line', async () => {
  const { window, doc } = await boot({ arms: [['POST', '/api/settings', { status: 400, body: { error: 'role.model is required', field: 'modelRoles' } }]] });
  press(window, tile(doc, 'claude', 'quick'));
  await pick(window, doc, 'Haiku 4.5');
  press(window, bar(doc).querySelector('.mdl-save'));
  await settle();
  const msg = doc.getElementById('models-jobs-msg');
  assert.match(msg.textContent, /role\.model is required/);
  assert.match(msg.className, /\berr\b/);
  assert.equal(bar(doc).hidden, false, 'the draft stays');
  assert.equal(bar(doc).querySelector('.note').textContent, '1 unsaved change');
  assert.equal(tileText(doc, 'claude', 'quick'), 'Haiku 4.5');
  // Discard drops the draft the refusal was about, and its line with it.
  press(window, bar(doc).querySelector('.mdl-discard'));
  await settle(2);
  assert.equal(msg.textContent, '');
  assert.doesNotMatch(msg.className, /\berr\b/);
});

test('5: Default for new runs saves at once, and New run then starts on it', async () => {
  let runEngine = null;
  const { window, doc, posts } = await boot({ settings: () => ({ ...SETTINGS, runEngine }), arms: [
    ['POST', '/api/settings', (body) => { if (body?.runEngine) runEngine = body.runEngine; return ok({ ...SETTINGS, runEngine, ...body }); }],
    ['GET', '/api/run-defaults', () => ok({ engine: { value: runEngine || 'claude', source: runEngine ? 'user' : 'default' } })],
  ] });
  assert.equal(doc.getElementById('engineSelect').value, 'claude', 'New run starts on Claude Code before');
  press(window, hx(doc, 'codex'));
  await settle(2);
  const def = doc.querySelector('#jobs-root .mdl-default-btn');
  assert.equal(def.getAttribute('aria-pressed'), 'false');
  press(window, def);
  await settle();
  assert.deepEqual(settingsPosts(posts).map((p) => p.body), [{ runEngine: 'codex' }]);
  assert.equal(lastToast(doc)?.title, 'OpenAI Codex is the default for new runs');
  assert.equal(doc.querySelector('#jobs-root .mdl-default-btn').getAttribute('aria-pressed'), 'true');
  assert.equal(pressed(doc), 'codex');
  // Pressed, it is off: a second press (a click reaches a disabled button in jsdom) saves nothing again.
  press(window, doc.querySelector('#jobs-root .mdl-default-btn'));
  await settle();
  assert.equal(settingsPosts(posts).length, 1);
  // Opened right after, in the same page, New run starts on the new default (it re-read GET /api/run-defaults).
  await go(window, 'new');
  assert.equal(doc.getElementById('engineSelect').value, 'codex');
});

test('6: levels: Simple shows the roles of the default harness only; Expert shows the harness tiles', async () => {
  const { doc } = await boot({ level: 'simple' });
  assert.equal(visible(doc, doc.getElementById('jobs-roles')), true);
  assert.equal(visible(doc, doc.getElementById('jobs-steps')), false);
  assert.equal(visible(doc, doc.querySelector('#jobs-root .mdl-hx')), false);
  assert.equal(doc.getElementById('jobs-roles').dataset.minLevel, 'simple');
  const expert = await boot();
  assert.equal(visible(expert.doc, expert.doc.querySelector('#jobs-root .mdl-hx')), true);
  assert.equal(visible(expert.doc, expert.doc.getElementById('jobs-steps')), true);
  // The level changes while the tab shows: below Expert it draws the default harness again.
  press(expert.window, hx(expert.doc, 'codex'));
  await settle(2);
  assert.ok(tile(expert.doc, 'codex', 'deep'));
  expert.doc.documentElement.dataset.level = 'advanced';
  expert.doc.dispatchEvent(new expert.window.CustomEvent('worca:level'));
  await settle(2);
  assert.ok(tile(expert.doc, 'claude', 'deep'), 'Advanced: the default harness');
  assert.equal(tile(expert.doc, 'codex', 'deep'), null);
});

// As the server answers: the interview's default only while the requirements flag is on (ui/server.mjs settingsState).
const INTERVIEW_DEFAULT = { requirementsInterviewDefault: { model: 'claude-opus-5-5', effort: 'medium' } };
const flagAware = (w) => ({ ...SETTINGS, ...(/(?:^|\s)requirements(?:\s|$)/.test(w.document.documentElement.dataset.flags || '') ? INTERVIEW_DEFAULT : {}) });

test('7: flags repaint rows: Requirements re-reads the settings; Run naming and Design repaint without a read', async () => {
  const { window, doc, calls } = await boot({ settings: flagAware });
  applyFlags({ requirements: false, smartRunNaming: false, design: false }, doc);
  await settle();
  press(window, doc.querySelector('#jobs-helpers .mdl-show-all'));
  await settle(2);
  const interview = 'models.claude.requirementsInterview';
  assert.equal(jobRow(doc, interview), null, 'flag off: no Requirements interview row');
  assert.equal(jobRow(doc, 'models.claude.utility.naming'), null);
  assert.equal(doc.getElementById('jobs-design'), null);
  const reads = count(calls, 'GET /api/settings');
  applyFlags({ requirements: true }, doc);
  await settle();
  assert.ok(count(calls, 'GET /api/settings') > reads, 'the flag re-reads the settings (its default comes only while on)');
  assert.equal(jobRow(doc, interview).querySelector('.mdl-job-name').textContent, 'Requirements interview');
  assert.equal(rowText(doc, interview), 'Opus 5.5 (default)');
  assert.equal(rowEffort(doc, interview), ' · medium (default)');
  const before = count(calls, 'GET /api/settings');
  applyFlags({ smartRunNaming: true }, doc);
  await settle(2);
  assert.equal(jobRow(doc, 'models.claude.utility.naming').querySelector('.mdl-job-name').textContent, 'Run naming');
  applyFlags({ design: true }, doc);
  await settle(2);
  assert.ok(doc.getElementById('jobs-design'), 'the Design card follows its flag');
  assert.equal(count(calls, 'GET /api/settings'), before, 'Run naming and Design repaint without a GET');
  applyFlags({ smartRunNaming: false, design: false }, doc);
  await settle(2);
  assert.equal(jobRow(doc, 'models.claude.utility.naming'), null, 'flag off again: the row goes');
  assert.equal(doc.getElementById('jobs-design'), null);
});

test('8: addresses, old and new, open the block they name', async () => {
  const cases = [
    ['models/jobs/helpers', 'jobs-helpers'],
    ['models/jobs/roles', 'jobs-roles'],
    ['models/jobs/steps', 'jobs-steps'],
    ['models/engine-settings-card', 'jobs-steps'],
    ['models/jobs/engine-settings-card', 'jobs-steps'],
    ['models/engine', 'jobs-steps'],
    ['models/model-roles-card', 'jobs-roles'],
    ['models/title-model', 'jobs-helpers'],
  ];
  for (const [hash, id] of cases) {
    const { doc } = await boot({ hash });
    const block = doc.getElementById(id);
    assert.ok(block?.classList.contains('is-found'), `#${hash} flashes #${id}`);
    assert.ok(block.contains(doc.activeElement), `#${hash} puts the focus in #${id}`);
    assert.equal(doc.querySelectorAll('#jobs-root .is-found').length, 1, `#${hash}: only #${id}`);
  }
  // A hop inside the page reveals too, and the flash survives the repaint a broadcast makes.
  const { window, doc } = await boot({ hash: 'models' });
  await go(window, 'models/jobs/helpers');
  assert.ok(doc.getElementById('jobs-helpers').classList.contains('is-found'));
  await broadcast();
  assert.ok(doc.getElementById('jobs-helpers').classList.contains('is-found'), 'a repaint keeps the flash');
  assert.equal(window.location.hash, '#models/jobs/helpers', 'the address stays as typed');
});

// P6 review s1 (the whole-menu walk): Settings' Run naming and Memory defragment links mean Claude's helper jobs. With
// another default harness the bare address showed that harness's card; the address names the harness that owns them.
test('8b: an address naming its harness opens that harness, whatever the default or the harness shown', async () => {
  for (const runEngine of ['codex', 'cursor']) {
    const { doc } = await boot({ hash: 'models/jobs/helpers/claude', settings: { ...SETTINGS, runEngine } });
    assert.equal(pressed(doc), 'claude', `default ${runEngine}: Claude Code's tile`);
    assert.ok(doc.getElementById('jobs-helpers')?.classList.contains('is-found'), `default ${runEngine}: its Helper jobs card`);
  }
  const { window, doc } = await boot({ hash: 'models/jobs', settings: { ...SETTINGS, runEngine: 'codex' } });
  assert.equal(pressed(doc), 'codex', 'the tab opens on the default');
  await go(window, 'models/jobs/helpers/claude');
  assert.equal(pressed(doc), 'claude', 'a hop inside the page moves the harness too');
  assert.ok(doc.getElementById('jobs-helpers').classList.contains('is-found'));
  await go(window, 'models/jobs/steps/nope');
  assert.equal(pressed(doc), 'claude', 'a word that names no harness leaves the one shown');
  assert.ok(doc.getElementById('jobs-steps').classList.contains('is-found'), 'and still opens its block');
});

test('9: "Used by" opens the harness and the part', async () => {
  const { window, doc } = await boot({ hash: 'models/model/gpt-6.1-sol' });
  const use = doc.querySelector('#model-panel-host .mdl-use');
  assert.equal(use.dataset.kind, 'helper');
  press(window, use);
  await settle();
  assert.equal(window.location.hash, '#models/jobs/helpers');
  assert.equal(pressed(doc), 'codex');
  assert.equal(doc.querySelector('#jobs-root .mdl-hx [data-engine="codex"][aria-pressed="true"]') !== null, true);
  assert.equal(rowText(doc, 'models.codex.utility.overview'), 'GPT-6.1 Sol');
  assert.ok(doc.getElementById('jobs-helpers').classList.contains('is-found'));
});

test('10: the Catalogue keeps its Default chip: a broadcast whose settings name another default moves it', async () => {
  let runEngine = null;
  const { doc } = await boot({ hash: 'models', settings: () => ({ ...SETTINGS, runEngine }) });
  const chips = (engine) => [...doc.querySelectorAll(`#models-list .mdl-grp[data-engine="${engine}"] .mdl-grp-toggle .badge.slate`)].map((b) => b.textContent);
  assert.deepEqual(chips('claude'), ['Default']);
  assert.deepEqual(chips('codex'), []);
  runEngine = 'codex';
  await broadcast();
  assert.deepEqual(chips('codex'), ['Default']);
  assert.deepEqual(chips('claude'), []);
});

test('11: Project settings and the setup assistant still draw their own rows', async () => {
  const PROJ = { name: 'proj', path: '/repos/proj', exists: true, key: 'proj-1' };
  const VIEW = { own: {}, layers: {}, roles: [{ key: 'planner', label: 'Plan' }] };
  const { window, doc } = await boot({ projects: [PROJ], arms: [['GET', '/api/projects/proj-1/settings', ok(VIEW)]] });
  await go(window, 'projects/proj-1/settings');
  const sec = doc.querySelector('#proj-detail .pd-sec[data-sec="settings"]');
  assert.equal(sec.hidden, false);
  assert.equal(sec.querySelector('.pd-settings-error'), null, 'the settings GET was answered');
  assert.deepEqual([...sec.querySelectorAll('.pd-settings .engine-card')].map((c) => c.dataset.engine), ENGINE_NAMES);
  assert.equal(sec.querySelector('.engine-card[data-engine="claude"] .inherit-field[data-setting="models.claude.steps.planner"] .drow-label > label').textContent, 'Plan');

  const sa = (sel) => doc.querySelector(`#setup-modal ${sel}`);
  press(window, doc.getElementById('setupRunAgain'));
  await settle();
  for (const title of ['How does this machine reach the internet?', 'Where should Worca get its models?', 'Which models should do the work?']) {
    assert.equal(sa('.sa-next').disabled, false);
    press(window, sa('.sa-next'));
    await settle();
    assert.equal(sa('#setup-title').textContent, title);
  }
  assert.deepEqual([...doc.querySelectorAll('#setup-modal .sa-roles .inherit-field .drow-label > label')].map((l) => l.textContent),
    ['Deep thinking', 'Everyday tasks', 'Quick jobs']);
  assert.equal(sa('.sa-roles .inherit-field[data-setting="models.claude.roles.everyday"] .drow-label > label').textContent, ROLE_LABELS.everyday);
});

test('12: bare stub bodies paint; a failed read draws nothing and throws nothing', async () => {
  const { doc } = await boot({ settings: {}, config: { models: [] }, engines: {} });
  assert.equal(visible(doc, doc.getElementById('jobs-roles')), true);
  assert.deepEqual([...doc.querySelectorAll('#jobs-roles .mdl-tile .mdl-tile-name')].map((n) => n.textContent),
    ["Each job's own default", "Each job's own default", "Each job's own default"]);
  assert.equal(doc.querySelectorAll('#jobs-steps .mdl-job-row').length, 0, 'no steps in the body: none drawn');
  assert.equal(doc.querySelector('#jobs-root .mdl-jobs-reason').textContent, '', 'no engines array: no readiness claimed');
  const nullBody = await boot({ settings: null });
  assert.equal(nullBody.doc.querySelectorAll('#jobs-roles .mdl-tile').length, 3, 'a body that is no object reads as no settings');
  const failed = await boot({ arms: [['GET', '/api/settings', { status: 500, body: { error: 'disk full' } }]] });
  assert.equal(failed.doc.getElementById('jobs-root').childElementCount, 0, 'a failed settings read draws nothing');
  assert.match(failed.doc.getElementById('models-jobs-msg').textContent, /Could not load settings: disk full/);
  const noConfig = await boot({ arms: [['GET', '/api/config', { status: 500, body: { error: 'boom' } }]] });
  assert.equal(noConfig.doc.getElementById('jobs-root').childElementCount, 0, 'a failed config read draws nothing');
});

test('13: the harness line says whether the picked harness can start runs (GET /api/engines); a broker lock greys its tile', async () => {
  const engines = { engines: [
    { name: 'claude', label: 'Claude', ready: true, reason: null },
    { name: 'codex', label: 'Codex', ready: true, reason: 'could not check the codex sign-in' },
    { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor-agent is not signed in' },
    { name: 'gemini', label: 'Gemini CLI', ready: false, reason: 'Off while the credential broker is on', broker: true },
  ] };
  const { window, doc } = await boot({ engines });
  const line = () => doc.querySelector('#jobs-root .mdl-jobs-reason').textContent;
  assert.equal(line(), '', 'a ready harness with nothing to say');
  press(window, hx(doc, 'cursor'));
  await settle(2);
  assert.equal(line(), "Cursor can't start runs yet: cursor-agent is not signed in.");
  press(window, hx(doc, 'codex'));
  await settle(2);
  assert.equal(line(), 'Codex can start runs: its CLI is installed and signed in. Note: could not check the codex sign-in.');
  await broadcast();
  assert.equal(line(), 'Codex can start runs: its CLI is installed and signed in. Note: could not check the codex sign-in.', 'a broadcast keeps the last readiness');
  assert.equal(hx(doc, 'gemini').disabled, true, "the read's broker lock greys the tile");
  // The tab's own read brings the broker's locks, also when the Catalogue never drew (its read failed).
  const noCatalogue = await boot({ engines, arms: [['GET', '/api/models', { status: 500, body: { error: 'boom' } }]] });
  assert.equal(hx(noCatalogue.doc, 'gemini').disabled, true);
  // A locked default harness gives way to Claude Code.
  const locked = await boot({ engines, settings: { ...SETTINGS, runEngine: 'gemini' } });
  assert.equal(pressed(locked.doc), 'claude');
  assert.ok(tile(locked.doc, 'claude', 'deep'), 'the roles drawn are Claude Code\'s');
  assert.equal(tile(locked.doc, 'gemini', 'deep'), null);
});

test('14: Command summaries sits under Helper jobs while its flag is on, with its default model', async () => {
  const settings = { ...SETTINGS, commandSummaryModel: { model: null, effort: null },
    commandSummaryModelEffective: { model: 'claude-opus-5-5', effort: 'medium', source: 'auto', stale: null } };
  const { window, doc } = await boot({ settings });
  const id = 'models.claude.utility.commandSummary';
  applyFlags({ commandSummaries: false }, doc);
  await settle();
  press(window, doc.querySelector('#jobs-helpers .mdl-show-all'));
  await settle(2);
  assert.equal(jobRow(doc, id), null, 'flag off: no row');
  applyFlags({ commandSummaries: true }, doc);
  await settle();
  assert.equal(jobRow(doc, id).querySelector('.mdl-job-name').textContent, 'Command summaries');
  assert.equal(rowText(doc, id), 'Opus 5.5 (default)', 'the cheapest ready Claude model');
  assert.equal(rowEffort(doc, id), '', 'it inherits the model only');
});

test('15: a Codex default opens the tab on OpenAI Codex, its rows reading the Codex roles', async () => {
  const { window, doc } = await boot({ settings: { ...SETTINGS, runEngine: 'codex', modelRoles: { codex: { everyday: { model: 'gpt-6.1-sol' } } } } });
  assert.equal(pressed(doc), 'codex');
  assert.equal(doc.querySelector('#jobs-root .mdl-default-btn').getAttribute('aria-pressed'), 'true');
  assert.equal(tileText(doc, 'codex', 'everyday'), 'GPT-6.1 Sol');
  press(window, doc.querySelector('#jobs-steps .mdl-show-all'));
  await settle(2);
  assert.equal(rowText(doc, 'models.codex.steps.implementer'), 'From Everyday tasks · GPT-6.1 Sol');
  // The picker lists what runs on the harness shown.
  press(window, tile(doc, 'codex', 'deep'));
  const names = [...doc.querySelectorAll('.mdl-pick-pop .ask-model-name')].map((n) => n.textContent);
  assert.ok(names.includes('GPT-6.1 Sol'), names.join(', '));
  assert.ok(!names.includes('Opus 5.5'), 'no Claude model on OpenAI Codex');
  press(window, tile(doc, 'codex', 'deep'));
  // Below Expert the tab always shows the default harness.
  const advanced = await boot({ level: 'advanced', settings: { ...SETTINGS, runEngine: 'codex' } });
  assert.ok(tile(advanced.doc, 'codex', 'deep'), 'Advanced: the default harness');
  assert.equal(tile(advanced.doc, 'claude', 'deep'), null);
});

/** The open picker's item whose label is exactly `label`. */
const pickItem = (doc, label) => [...doc.querySelectorAll('.mdl-pick-pop [role="menuitem"]')].find((b) => itemLabel(b) === label) || null;

test('16: each picker gets its row\'s rules; Test, clear and Discard work on the rows', async () => {
  const { window, doc, calls } = await boot({ arms: [['POST', '/api/models/claude-opus-5-5/test', ok({ ok: true, text: 'pong' })]] });
  // A role needs a model: with none, Effort is off. A second press on the same tile closes its picker.
  press(window, tile(doc, 'claude', 'quick'));
  assert.equal(pickItem(doc, 'Effort').disabled, true, 'a role takes no effort alone');
  assert.ok(pickItem(doc, "Each job's own default")?.querySelector('.ask-model-check'), 'nothing set: the clear item is ticked');
  press(window, tile(doc, 'claude', 'quick'));
  assert.equal(doc.querySelector('.mdl-pick-pop'), null);
  // A model-only helper job: Effort "not supported", its own model ticked.
  press(window, jobRow(doc, 'models.claude.utility.title').querySelector('.mdl-pick'));
  assert.equal(pickItem(doc, 'Effort').querySelector('.ask-pop-row-value').textContent, 'not supported');
  assert.ok(pickItem(doc, 'Haiku 4.5').querySelector('.ask-model-check'), 'the stored model is ticked');
  assert.equal(pickItem(doc, 'Follow Quick jobs') !== null, true, 'its clear item follows its role');
  press(window, jobRow(doc, 'models.claude.utility.title').querySelector('.mdl-pick'));
  // A step may keep an effort alone.
  press(window, doc.querySelector('#jobs-steps .mdl-override'));
  await over(window, doc, 'Refine');
  assert.equal(pickItem(doc, 'Effort').disabled, false, 'a step takes an effort with no model');
  await pick(window, doc, 'Effort');
  await pick(window, doc, 'high');
  assert.equal(rowEffort(doc, 'models.claude.steps.refiner'), ' · high');
  // Test asks the server about the row's own model and says what it answered.
  press(window, jobRow(doc, 'models.claude.steps.reviewer').querySelector('.mdl-job-test'));
  await settle();
  assert.ok(calls.includes('POST /api/models/claude-opus-5-5/test'));
  assert.equal(lastToast(doc)?.title, 'claude-opus-5-5 replied');
  // The clear button drops the row's own model: it folds away and counts as a change.
  press(window, jobRow(doc, 'models.claude.steps.reviewer').querySelector('.mdl-job-clear'));
  await settle(2);
  assert.equal(jobRow(doc, 'models.claude.steps.reviewer'), null, 'cleared, the row follows its role (folded)');
  assert.equal(bar(doc).querySelector('.note').textContent, '2 unsaved changes');
  // Discard drops the draft and the rows an Override showed.
  press(window, bar(doc).querySelector('.mdl-discard'));
  await settle(2);
  assert.equal(bar(doc).hidden, true);
  assert.equal(jobRow(doc, 'models.claude.steps.refiner'), null, 'the revealed row folds again');
  assert.equal(rowText(doc, 'models.claude.steps.reviewer'), 'Opus 5.5');
});

test('17: the newest read wins: an older one that lands later draws nothing', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  let first = true;
  const answer = (body) => ({ ok: true, status: 200, json: async () => body });
  const older = { ...SETTINGS, modelRoles: { claude: { deep: { model: 'claude-haiku-4-5' } } } };
  const { window, doc } = await boot({ settings: SETTINGS });
  // From here on the next GET /api/settings is held and answers stale settings; the ones after it answer at once.
  const fetch0 = window.fetch;
  window.fetch = globalThis.fetch = (url, opts = {}) => {
    if (String(url) === '/api/settings' && (opts.method || 'GET') === 'GET' && first) { first = false; return held.then(() => answer(clone(older))); }
    return fetch0(url, opts);
  };
  window.location.hash = 'models';
  await settle();
  window.location.hash = 'models/jobs';   // this show's read is held
  await settle();
  window.location.hash = 'models';
  await settle();
  window.location.hash = 'models/jobs';   // this one answers at once
  await settle();
  assert.equal(tileText(doc, 'claude', 'deep'), 'Opus 5.5');
  release();
  await settle();
  assert.equal(tileText(doc, 'claude', 'deep'), 'Opus 5.5', 'the older read wrote nothing');
});

test('18: on the Jobs tab a window focus re-reads it, and the Catalogue\'s Default chip follows', async () => {
  let runEngine = null;
  const { window, doc } = await boot({ settings: () => ({ ...SETTINGS, runEngine }), arms: [['GET', '/api/credentials', ok({ enabled: true })]] });
  const chips = (engine) => [...doc.querySelectorAll(`#models-list .mdl-grp[data-engine="${engine}"] .mdl-grp-toggle .badge.slate`)].map((b) => b.textContent);
  assert.deepEqual(chips('claude'), ['Default']);
  runEngine = 'codex';
  window.dispatchEvent(new window.Event('focus'));
  await settle();
  assert.deepEqual(chips('codex'), ['Default']);
});

test('19: a broadcast re-reads the tab even when the catalogue read fails', async () => {
  let deep = 'claude-opus-5-5';
  const { doc } = await boot({ arms: [['GET', '/api/models', { status: 500, body: { error: 'boom' } }]],
    settings: () => ({ ...SETTINGS, modelRoles: { claude: { deep: { model: deep } } } }) });
  assert.equal(tileText(doc, 'claude', 'deep'), 'Opus 5.5');
  deep = 'claude-haiku-4-5';
  await broadcast();
  assert.equal(tileText(doc, 'claude', 'deep'), 'Haiku 4.5', 'what another tab saved shows');
});

/** The saved settings after a POST: each key the body names under a section and a harness replaces the stored one. */
function savedAfter(saved, body) {
  const out = clone(saved);
  for (const [sect, engines] of Object.entries(body || {})) for (const [e, keys] of Object.entries(engines || {})) Object.assign(((out[sect] ||= {})[e] ||= {}), keys);
  return out;
}
const answerOf = (body) => ({ ok: true, status: 200, json: async () => body });

test('20: a pick made while Save is out stays a draft; the busy Save sends nothing twice', async () => {
  // The server saves on arrival and broadcasts settings-changed before it answers (ui/server.mjs): the first POST is
  // held here, so the tab repaints while it is out.
  let saved = clone(SETTINGS);
  const { window, doc } = await boot({ settings: () => saved });
  const sent = [];
  let release = null;
  const fetch0 = window.fetch;
  window.fetch = globalThis.fetch = (url, opts = {}) => {
    if (String(url) !== '/api/settings' || opts.method !== 'POST') return fetch0(url, opts);
    const body = JSON.parse(opts.body);
    sent.push(body);
    saved = savedAfter(saved, body);
    const now = clone(saved);
    if (sent.length > 1) return Promise.resolve(answerOf(now));
    return new Promise((r) => { release = () => r(answerOf(now)); });
  };
  const save = () => bar(doc).querySelector('.mdl-save');
  const busy = () => [save().disabled, save().getAttribute('aria-busy')];
  const reveal = async (label, id) => {
    press(window, doc.querySelector('#jobs-steps .mdl-override'));
    await over(window, doc, label);
    press(window, jobRow(doc, id).querySelector('.mdl-pick'));   // its picker closes with no pick
  };
  // Before the save: Quick jobs and Plan picked (Plan revealed by Override), Refine revealed with no pick.
  press(window, tile(doc, 'claude', 'quick'));
  await pick(window, doc, 'Haiku 4.5');
  press(window, doc.querySelector('#jobs-steps .mdl-override'));
  await over(window, doc, 'Plan');
  await pick(window, doc, 'More models');
  await pick(window, doc, 'Opus 5');
  await reveal('Refine', 'models.claude.steps.refiner');
  press(window, save());
  await settle(2);
  assert.equal(sent.length, 1);
  await broadcast();
  assert.deepEqual(busy(), [true, 'true'], 'a repaint while the save is out draws Save busy');
  // While it is out: a new pick (Deep thinking), a sent id picked again (Quick jobs, Plan), a row revealed.
  press(window, tile(doc, 'claude', 'deep'));
  await pick(window, doc, 'Haiku 4.5');
  press(window, tile(doc, 'claude', 'quick'));
  await pick(window, doc, "Each job's own default");
  press(window, jobRow(doc, 'models.claude.steps.planner').querySelector('.mdl-pick'));
  await pick(window, doc, 'Follow Deep thinking');
  await reveal('Manual tests checklist', 'models.claude.steps.manualTestsChecklist');
  assert.deepEqual(busy(), [true, 'true']);
  press(window, save());
  await settle(2);
  assert.equal(sent.length, 1, 'a press on the busy Save sends nothing');
  release();
  await settle();
  assert.equal(lastToast(doc)?.title, 'Saved.');
  assert.equal(tileText(doc, 'claude', 'deep'), 'Haiku 4.5', 'the new pick is still on its tile');
  assert.equal(tileText(doc, 'claude', 'quick'), "Each job's own default", 'so is a sent id picked again');
  assert.ok(jobRow(doc, 'models.claude.steps.planner'), 'a revealed row whose pick stays in the draft stays');
  assert.notEqual(rowText(doc, 'models.claude.steps.planner'), 'Opus 5');
  assert.equal(bar(doc).hidden, false);
  assert.equal(bar(doc).querySelector('.note').textContent, '3 unsaved changes');
  assert.deepEqual(busy(), [false, null], 'Save is free again');
  assert.equal(jobRow(doc, 'models.claude.steps.refiner'), null, 'the row revealed before the save with no pick folds');
  assert.ok(jobRow(doc, 'models.claude.steps.manualTestsChecklist'), 'the row revealed during the save stays');
  press(window, save());
  await settle();
  assert.deepEqual(sent, [
    { modelRoles: { claude: { quick: { model: 'claude-haiku-4-5' } } }, stepModels: { claude: { planner: { model: 'claude-opus-5' } } } },
    { modelRoles: { claude: { deep: { model: 'claude-haiku-4-5' }, quick: null } }, stepModels: { claude: { planner: null } } },
  ]);
  assert.equal(bar(doc).hidden, true);
});

test('21: a read sent before Save that answers after it draws nothing over what was saved', async () => {
  let saved = clone(SETTINGS);
  const stale = clone(SETTINGS);
  const { window, doc } = await boot({ settings: () => saved,
    arms: [['POST', '/api/settings', (body) => { saved = savedAfter(saved, body); return ok(clone(saved)); }]] });
  let release;
  const held = new Promise((r) => { release = r; });
  let holding = true;
  const fetch0 = window.fetch;
  window.fetch = globalThis.fetch = (url, opts = {}) => {
    if (String(url) === '/api/settings' && (opts.method || 'GET') === 'GET' && holding) return held.then(() => answerOf(clone(stale)));
    return fetch0(url, opts);
  };
  // A broadcast reads the tab twice (its own read and the Catalogue's re-read): both are held, and answer what was
  // saved before the Save below.
  await broadcast();
  holding = false;
  press(window, tile(doc, 'claude', 'quick'));
  await pick(window, doc, 'Haiku 4.5');
  press(window, bar(doc).querySelector('.mdl-save'));
  await settle();
  assert.equal(bar(doc).hidden, true);
  release();
  await settle();
  assert.equal(tileText(doc, 'claude', 'quick'), 'Haiku 4.5', 'the older read wrote nothing');
  assert.equal(bar(doc).hidden, true);
});

test('22: a refusal with no JSON object in its body says its HTTP status, and frees a Save drawn while it was out', async () => {
  const { window, doc } = await boot();
  let release = null;
  const fetch0 = window.fetch;
  window.fetch = globalThis.fetch = (url, opts = {}) => {
    if (String(url) !== '/api/settings' || opts.method !== 'POST') return fetch0(url, opts);
    return new Promise((r) => { release = () => r({ ok: false, status: 400, json: async () => null }); });
  };
  press(window, tile(doc, 'claude', 'quick'));
  await pick(window, doc, 'Haiku 4.5');
  press(window, bar(doc).querySelector('.mdl-save'));
  await settle(2);
  await broadcast();
  assert.equal(bar(doc).querySelector('.mdl-save').disabled, true, 'drawn while the POST is out: busy');
  release();
  await settle();
  assert.equal(doc.getElementById('models-jobs-msg').textContent, 'HTTP 400');
  assert.equal(bar(doc).querySelector('.note').textContent, '1 unsaved change');
  const save = bar(doc).querySelector('.mdl-save');
  assert.deepEqual([save.disabled, save.getAttribute('aria-busy'), save.textContent], [false, null, 'Save']);
});

test('23: Discard leaves a settings load error on the Jobs line', async () => {
  let fail = false;
  const { window, doc } = await boot({ arms: [['GET', '/api/settings', () => (fail ? { status: 500, body: { error: 'disk full' } } : ok(clone(SETTINGS)))]] });
  press(window, tile(doc, 'claude', 'quick'));
  await pick(window, doc, 'Haiku 4.5');
  fail = true;
  await broadcast();
  const msg = doc.getElementById('models-jobs-msg');
  assert.equal(msg.textContent, 'Could not load settings: disk full');
  press(window, bar(doc).querySelector('.mdl-discard'));
  await settle(2);
  assert.equal(bar(doc).hidden, true);
  assert.equal(msg.textContent, 'Could not load settings: disk full', 'still true: it stays');
});

test('#1450: picking "Let Claude Code decide" on a role tile saves { cliDecides: true }', async () => {
  const roleDefaults = { claude: { deep: { model: 'claude-opus-5-5' }, everyday: { model: 'claude-opus-5' }, quick: { model: 'claude-haiku-4-5' } },
    codex: { deep: { model: 'gpt-6.1-sol' }, everyday: { model: 'gpt-6.1-sol' }, quick: { model: 'gpt-6.1-sol' } } };
  const { window, doc, posts } = await boot({ settings: { ...clone(SETTINGS), modelRoles: {}, roleDefaults, claudeAuth: 'signed-in' } });
  assert.equal(tileText(doc, 'claude', 'deep'), 'Worca default · Opus 5.5');
  press(window, tile(doc, 'claude', 'deep'));
  await pick(window, doc, 'Let Claude Code decide');
  assert.equal(tileText(doc, 'claude', 'deep'), 'Let Claude Code decide');
  press(window, bar(doc).querySelector('.mdl-save'));
  await settle();
  assert.deepEqual(settingsPosts(posts).map((p) => p.body), [{ modelRoles: { claude: { deep: { cliDecides: true } } } }]);
});
