// test/requirements-view-model.test.mjs — Who interviews on New feature (9c boards 1, 2, 7, 8), in jsdom with a fake API.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'HTMLElement', 'window', 'File']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');
const { whoInterviews, recommendationNote, defaultLine, fallbackLine, modelChip, switchConfirm, sentTo, costSentence } = await import('../ui/public/requirements-model.mjs');
const { setEngineLocks } = await import('../ui/public/engine-locks.mjs');

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const H = (engine, choiceLabel, over = {}) => ({ engine, label: choiceLabel.replace(/ \(beta\)/, ''), choiceLabel, ready: true, short: null, reason: null, broker: false,
  repo: true, files: false, keepsCopy: false, reportsCost: true, company: null, ...over });
const HARNESSES = [
  H('claude', 'Claude Code', { files: true }),
  H('codex', 'OpenAI Codex (beta)'),
  H('copilot', 'GitHub Copilot (beta)', { ready: false, short: 'Not installed', reason: 'cannot run copilot (ENOENT)' }),
  H('gemini', 'Gemini CLI (beta)', { repo: false }),
  H('qwen', 'Qwen Code (beta)', { repo: false, ready: false, short: 'Not signed in', reason: 'not signed in' }),
];
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', harnesses: ['claude'], efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', harnesses: ['claude'], efforts: ['medium', 'high'] },
  { id: 'gpt-sol', label: 'GPT-5.6 Sol', harnesses: ['codex'], efforts: ['low', 'medium', 'high'] },
  { id: 'gpt-lite', label: 'GPT Lite', harnesses: ['codex'], efforts: ['low'] },
  { id: 'gem-flash', label: 'Gemini Flash', harnesses: ['gemini'], efforts: [], noEffort: true },
];
const DEFAULTS = { claude: { model: 'claude-sonnet-5-5', effort: 'medium' }, codex: { model: 'gpt-lite', effort: null }, gemini: { model: 'gem-flash', effort: null } };
const RECOMMENDED = { claude: 'claude-opus-5-5', codex: 'gpt-sol', gemini: null, copilot: null, qwen: null };
const CATALOG = { harnesses: HARNESSES, models: MODELS, defaults: DEFAULTS, recommended: RECOMMENDED };
const est = (look, round, rec) => ({ look: { usd: look }, round: { usd: round }, recommended: rec });
const ESTIMATES = {
  'claude-sonnet-5-5': est(0.09, 0.02, { model: 'claude-opus-5-5', look: { usd: 0.16 }, round: { usd: 0.03 } }),
  'claude-opus-5-5': est(0.16, 0.03, { model: 'claude-opus-5-5', look: { usd: 0.16 }, round: { usd: 0.03 } }),
  'gpt-sol': est(0.12, 0.02, { model: 'gpt-sol', look: { usd: 0.12 }, round: { usd: 0.02 } }),
};

/** A fake API: `routes` maps "METHOD path" (query stripped) to a body or a function of the parsed query. */
function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const [path, qs = ''] = url.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs));
    calls.push({ method, url, body: opts.body ? JSON.parse(opts.body) : undefined });
    const hit = routes[`${method} ${path}`];
    const body = typeof hit === 'function' ? hit(q, opts) : hit;
    const status = body !== undefined ? 200 : 404;
    return { ok: status < 400, status, json: async () => body ?? { error: 'not found' }, text: async () => '' };
  };
  return calls;
}
const INTERVIEW = { default: { engine: 'claude', model: 'claude-sonnet-5-5', label: 'Sonnet 5.5', effort: 'medium' }, fallbackReason: null };
const LIST = (over = {}) => ({ features: [], lookCostUsd: 0.09, spend: { windowUsd: 0, totalLimitUsd: null }, interview: INTERVIEW, briefs: [],
  readEstimates: { text: null, image: null, binary: null }, ...over });
const ROUTES = (over = {}) => ({
  'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] },
  'GET /api/requirements': LIST(), 'GET /api/requirements/models': CATALOG,
  'GET /api/requirements/estimates': (q) => ESTIMATES[q.model] || { look: { usd: null, reason: 'no-estimate' }, round: { usd: null, reason: 'no-price' }, recommended: null },
  ...over,
});
const openNew = async (routes = ROUTES()) => {
  const calls = fakeApi(routes);
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const routed = [];
  const view = createRequirementsView({ host, subEl: document.createElement('div'), msgEl: document.createElement('p'), deps: { route: (p) => routed.push(p) } });
  await view.show('new');
  await settle();
  return { host, calls, routed };
};
const sel = (host, name) => host.querySelector(`.req-who .req-who-${name}`);
const pickValue = async (select, v) => { select.value = v; select.dispatchEvent(new window.Event('change', { bubbles: true })); await settle(); };

test('whoInterviews: a fieldset "Who interviews" with labelled Harness, Model and Effort selects', () => {
  const w = whoInterviews(document, { models: MODELS, harnesses: HARNESSES, choice: { engine: 'claude', model: 'claude-sonnet-5-5', effort: '' }, defaults: DEFAULTS });
  assert.equal(w.el.tagName, 'FIELDSET');
  assert.equal(text(w.el.querySelector('legend')), 'Who interviews');
  const labels = [...w.el.querySelectorAll('label')].map((l) => [l.textContent, w.el.querySelector(`#${l.getAttribute('for')}`).tagName]);
  assert.deepEqual(labels, [['Harness', 'SELECT'], ['Model', 'SELECT'], ['Effort', 'SELECT']]);
  assert.deepEqual(w.value(), { engine: 'claude', model: 'claude-sonnet-5-5', effort: null });
});

test('whoInterviews: the harness list has no Cursor and carries the option texts of gap 4', () => {
  setEngineLocks([]);
  const w = whoInterviews(document, { models: MODELS, harnesses: HARNESSES, choice: { engine: 'claude', model: 'claude-sonnet-5-5' }, defaults: DEFAULTS });
  const opts = [...w.el.querySelector('.req-who-harness').options].map((o) => [o.value, o.textContent, o.disabled]);
  assert.deepEqual(opts, [
    ['claude', 'Claude Code', false],
    ['codex', 'OpenAI Codex (beta)', false],
    ['copilot', 'GitHub Copilot (beta) · Not installed', true],
    ['gemini', "Gemini CLI (beta) · Can't read the repo", false],
    ['qwen', "Qwen Code (beta) · Can't read the repo · Not signed in", true],
  ]);
  assert.ok(!opts.some(([v]) => v === 'cursor'));
});

test("whoInterviews: a broker lock greys the harness with lockEngineOptions' suffix", () => {
  setEngineLocks([{ name: 'codex', broker: true, reason: 'the credential broker is on' }]);
  const hs = HARNESSES.map((x) => (x.engine === 'codex' ? { ...x, ready: false, broker: true, short: 'Off while the credential broker is on' } : x));
  const w = whoInterviews(document, { models: MODELS, harnesses: hs, choice: { engine: 'claude', model: 'claude-sonnet-5-5' }, defaults: DEFAULTS });
  const o = [...w.el.querySelector('.req-who-harness').options].find((x) => x.value === 'codex');
  assert.equal(o.textContent, 'OpenAI Codex (beta): off while the credential broker is on');
  assert.equal(o.disabled, true);
  setEngineLocks([]);
});

test('whoInterviews: Model lists the harness models; Effort lists the model efforts and hides for a model without any', () => {
  const w = whoInterviews(document, { models: MODELS, harnesses: HARNESSES, choice: { engine: 'claude', model: 'claude-opus-5-5' }, defaults: DEFAULTS });
  const model = w.el.querySelector('.req-who-model');
  const effort = w.el.querySelector('.req-who-effort');
  assert.deepEqual([...model.options].map((o) => o.value), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  assert.deepEqual([...effort.options].map((o) => o.textContent), ['Default effort', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(effort.options[0].value, '');
  assert.equal(effort.closest('.req-who-field').hidden, false);
});

test('whoInterviews: changing the harness fills Model with that harness default and resets Effort', async () => {
  const seen = [];
  const w = whoInterviews(document, { models: MODELS, harnesses: HARNESSES, choice: { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'high' }, defaults: DEFAULTS,
    onChange: (v) => seen.push(v) });
  const harness = w.el.querySelector('.req-who-harness');
  assert.equal(w.value().effort, 'high');
  harness.value = 'codex';
  harness.dispatchEvent(new window.Event('change'));
  assert.deepEqual(w.value(), { engine: 'codex', model: 'gpt-lite', effort: null });
  assert.deepEqual([...w.el.querySelector('.req-who-model').options].map((o) => o.value), ['gpt-sol', 'gpt-lite']);
  assert.deepEqual(seen.at(-1), { engine: 'codex', model: 'gpt-lite', effort: null });
  harness.value = 'gemini';
  harness.dispatchEvent(new window.Event('change'));
  assert.equal(w.el.querySelector('.req-who-effort').closest('.req-who-field').hidden, true, 'a model with noEffort hides Effort');
  assert.equal(w.value().effort, null);
});

test('recommendationNote: another model picked, the recommended one picked, and no recommendation', () => {
  let used = 0;
  const labels = { harness: 'Claude Code', picked: 'Sonnet 5.5', recommended: 'Opus 5.5' };
  const other = recommendationNote(document, { picked: 'claude-sonnet-5-5', recommended: 'claude-opus-5-5', estimates: ESTIMATES['claude-sonnet-5-5'], labels, onUse: () => { used += 1; } });
  assert.ok(other.classList.contains('hint'));
  assert.ok(other.querySelector('svg'), 'the info icon');
  assert.equal(text(other), 'Requirements work best with a strong model, like Opus 5.5 on Claude Code: about $0.16 for a code look, about $0.03 a round. '
    + 'You picked Sonnet 5.5: about $0.09 for a code look, about $0.02 a round. Use Opus 5.5');
  const use = other.querySelector('button');
  assert.equal(use.textContent, 'Use Opus 5.5');
  use.click();
  assert.equal(used, 1);
  const same = recommendationNote(document, { picked: 'claude-opus-5-5', recommended: 'claude-opus-5-5', estimates: ESTIMATES['claude-opus-5-5'], labels: { ...labels, picked: 'Opus 5.5' } });
  assert.equal(text(same), 'Requirements work best with a strong model, like Opus 5.5 on Claude Code: about $0.16 for a code look, about $0.03 a round.');
  assert.equal(same.querySelector('button'), null);
  const none = recommendationNote(document, { picked: 'gem-flash', recommended: null, estimates: est(0.05, 0.01, null), labels: { harness: 'Gemini CLI', picked: 'Gemini Flash' } });
  assert.equal(text(none), 'About $0.05 for a code look, about $0.01 a round.');
});

test('recommendationNote: no repo leaves the code look out; missing parts say "no estimate yet" and "cost unknown"', () => {
  const labels = { harness: 'Gemini CLI', picked: 'Gemini Flash', recommended: 'Gemini Pro' };
  const n = recommendationNote(document, { picked: 'x', recommended: 'x', repo: false, estimates: { look: { usd: null, reason: 'no-estimate' }, round: { usd: 0.01 }, recommended: { model: 'x', round: { usd: 0.01 } } }, labels });
  assert.equal(text(n), 'Requirements work best with a strong model, like Gemini Pro on Gemini CLI: about $0.01 a round.');
  const u = recommendationNote(document, { picked: 'y', recommended: 'x', estimates: { look: { usd: null, reason: 'no-estimate' }, round: { usd: null, reason: 'no-price' },
    recommended: { model: 'x', look: { usd: null, reason: 'no-price' }, round: { usd: null, reason: 'no-estimate' } } }, labels });
  assert.match(text(u), /: cost unknown for a code look, no estimate yet for a round\. You picked Gemini Flash: no estimate yet for a code look, cost unknown for a round\./);
  const both = recommendationNote(document, { picked: 'x', recommended: 'x', estimates: { recommended: { model: 'x', look: { usd: null, reason: 'no-estimate' }, round: { usd: null, reason: 'no-estimate' } } }, labels });
  assert.equal(text(both), 'Requirements work best with a strong model, like Gemini Pro on Gemini CLI: no estimate yet.');
  const unk = recommendationNote(document, { picked: 'x', recommended: 'x', estimates: { recommended: { model: 'x', look: { usd: null, reason: 'no-price' }, round: { usd: null, reason: 'no-price' } } }, labels });
  assert.match(text(unk), /on Gemini CLI: cost unknown\.$/);
  const mixed = recommendationNote(document, { picked: 'x', recommended: null, estimates: { look: { usd: null, reason: 'no-estimate' }, round: { usd: 0.02 } }, labels });
  assert.equal(text(mixed), 'No estimate yet for a code look, about $0.02 a round.');
  assert.equal(mixed.getAttribute('aria-live'), null, 'the slot that holds the note is the live region, not the note');
});

test('defaultLine: only when the choice differs from the default; fallbackLine: the grey D4 line', () => {
  const dc = { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' };
  const labels = { model: 'Sonnet 5.5', harness: 'Claude Code' };
  assert.equal(defaultLine(document, { choice: dc, defaultChoice: dc, labels }), null);
  let used = 0;
  const l = defaultLine(document, { choice: { engine: 'codex', model: 'gpt-sol', effort: null }, defaultChoice: dc, labels, onUse: () => { used += 1; } });
  assert.equal(text(l), 'Your default: Sonnet 5.5 on Claude Code. Use the default');
  l.querySelector('button').click();
  assert.equal(used, 1);
  const f = fallbackLine(document, "Your default engine is Cursor, which can't run Requirements, so this starts on Claude.");
  assert.ok(f.classList.contains('hint'));
  assert.equal(text(f), "Your default engine is Cursor, which can't run Requirements, so this starts on Claude.");
  assert.equal(fallbackLine(document, null), null);
});

// ── the page ────────────────────────────────────────────────────────────

test('New feature: Who interviews is filled from the default; the sentence "Worca interviews with" is gone', async () => {
  const { host, calls } = await openNew();
  assert.ok(calls.some((c) => c.url === '/api/requirements/models'));
  assert.equal(text(host.querySelector('.req-who legend')), 'Who interviews');
  assert.equal(sel(host, 'harness').value, 'claude');
  assert.equal(sel(host, 'model').value, 'claude-sonnet-5-5');
  assert.equal(sel(host, 'effort').value, 'medium');
  assert.doesNotMatch(host.textContent, /Worca interviews with/);
  assert.equal(host.querySelector('.req-new-model'), null);
  // the form's other fields keep their labels
  assert.ok(host.querySelector('#req-new-target'));
});

test('New feature: the note follows the pick, refetches estimates on each change, and Use <rec> sets the model', async () => {
  const { host, calls } = await openNew();
  assert.equal(text(host.querySelector('.req-new-note')), 'Requirements work best with a strong model, like Opus 5.5 on Claude Code: about $0.16 for a code look, about $0.03 a round. '
    + 'You picked Sonnet 5.5: about $0.09 for a code look, about $0.02 a round. Use Opus 5.5');
  assert.ok(calls.some((c) => c.url === '/api/requirements/estimates?engine=claude&model=claude-sonnet-5-5'));
  host.querySelector('.req-new-use').click();
  await settle();
  assert.equal(sel(host, 'model').value, 'claude-opus-5-5');
  assert.ok(calls.some((c) => c.url === '/api/requirements/estimates?engine=claude&model=claude-opus-5-5'));
  assert.equal(text(host.querySelector('.req-new-note')), 'Requirements work best with a strong model, like Opus 5.5 on Claude Code: about $0.16 for a code look, about $0.03 a round.');
  assert.equal(host.querySelector('.req-new-note .req-new-use'), null);
});

test('New feature: choosing another harness refills Model, shows Your default and the harness line, and the note follows', async () => {
  const { host } = await openNew();
  assert.equal(host.querySelector('.req-new-default'), null, 'the default is chosen: no line');
  await pickValue(sel(host, 'harness'), 'codex');
  assert.equal(sel(host, 'model').value, 'gpt-lite');
  assert.equal(sel(host, 'effort').value, '');
  assert.equal(text(host.querySelector('.req-new-default')), 'Your default: Sonnet 5.5 on Claude Code. Use the default');
  assert.equal(text(host.querySelector('.req-new-harness')), 'OpenAI Codex reads the repo read-only. Files go to it as text.');
  await pickValue(sel(host, 'model'), 'gpt-sol');
  assert.equal(text(host.querySelector('.req-new-note')), 'Requirements work best with a strong model, like GPT-5.6 Sol on OpenAI Codex: about $0.12 for a code look, about $0.02 a round.');
  host.querySelector('.req-new-default .req-new-use').click();
  await settle();
  assert.equal(sel(host, 'harness').value, 'claude');
  assert.equal(sel(host, 'model').value, 'claude-sonnet-5-5');
  assert.equal(host.querySelector('.req-new-default'), null);
});

test('New feature: a harness that cannot read the repo drops the code look from the note and says so under the selects', async () => {
  const { host } = await openNew();
  await pickValue(sel(host, 'harness'), 'gemini');
  assert.equal(text(host.querySelector('.req-new-harness')), "Gemini CLI can't read the repo. Files go to it as text.");
  assert.doesNotMatch(text(host.querySelector('.req-new-note')), /code look/);
});

test('New feature (board 7): a fallback reason shows the grey line and the form sits on Claude Code', async () => {
  const reason = "Your default engine is Cursor, which can't run Requirements, so this starts on Claude.";
  const { host } = await openNew(ROUTES({ 'GET /api/requirements': LIST({ interview: { ...INTERVIEW, fallbackReason: reason } }) }));
  assert.equal(text(host.querySelector('.req-new-fallback')), reason);
  assert.equal(sel(host, 'harness').value, 'claude');
  const none = await openNew();
  assert.equal(none.host.querySelector('.req-new-fallback'), null);
});

test('New feature: the privacy note keeps today\'s exact Claude text and follows another harness', async () => {
  const { host } = await openNew();
  const today = 'Worca sends each file to Sonnet 5.5 to read it. Text is checked for keys and passwords first; images and PDFs go as they are.';
  assert.equal(host.querySelector('#req-new-files-privacy').textContent, today);
  await pickValue(sel(host, 'harness'), 'codex');
  await pickValue(sel(host, 'model'), 'gpt-sol');
  assert.equal(host.querySelector('#req-new-files-privacy').textContent,
    'Worca sends each file to GPT-5.6 Sol on OpenAI Codex to read it. Text is checked for keys and passwords first. OpenAI Codex gets files as text: PDFs and images are skipped.');
  await pickValue(sel(host, 'harness'), 'claude');
  assert.equal(host.querySelector('#req-new-files-privacy').textContent.replace('Sonnet 5.5', 'X'), today.replace('Sonnet 5.5', 'X'));
});

test('New feature: the create body carries the model choice', async () => {
  const routes = ROUTES({ 'POST /api/requirements': { feature: { seq: 7 } } });
  const { host, calls, routed } = await openNew(routes);
  host.querySelector('#req-new-title').value = 'Cancel an order';
  host.querySelector('#req-new-desc').value = 'Customers cancel before it ships.';
  await pickValue(sel(host, 'harness'), 'codex');
  await pickValue(sel(host, 'model'), 'gpt-sol');
  await pickValue(sel(host, 'effort'), 'high');
  [...host.querySelectorAll('.req-new .btn-primary')].at(-1).click();
  await settle();
  const post = calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body.model, { engine: 'codex', model: 'gpt-sol', effort: 'high' });
  assert.deepEqual(routed, ['feature/7']);
});

test('New feature: when the models cannot be loaded the form still works and sends no model', async () => {
  const routes = ROUTES({ 'GET /api/requirements/models': undefined, 'POST /api/requirements': { feature: { seq: 8 } } });
  delete routes['GET /api/requirements/models'];
  const { host, calls } = await openNew(routes);
  assert.equal(host.querySelector('.req-who'), null);
  host.querySelector('#req-new-title').value = 'T';
  host.querySelector('#req-new-desc').value = 'D';
  [...host.querySelectorAll('.req-new .btn-primary')].at(-1).click();
  await settle();
  assert.equal(calls.find((c) => c.method === 'POST').body.model, undefined);
});

test('N2: New feature: Who interviews says it is loading, then that the models could not be loaded, with Try again', async () => {
  let release;
  let fail = true;
  const pending = new Promise((r) => { release = r; });
  let first = true;
  let retryPending = null;
  const routes = ROUTES({ 'GET /api/requirements/models': () => {
    if (first) { first = false; return pending; }
    if (retryPending) return retryPending.p;
    return fail ? undefined : CATALOG;
  } });
  const { host, calls } = await openNew(routes);
  const status = () => host.querySelector('.req-who-box .req-who-status');
  const box = host.querySelector('.req-who-box');
  assert.equal(box.hidden, false, 'the box is there while the models load');
  assert.equal(text(status()), 'Loading the models…');
  release(undefined);   // the load fails (no catalog)
  await settle();
  assert.equal(host.querySelector('.req-who'), null);
  assert.equal(box.hidden, false);
  assert.equal(text(status()), 'The models could not be loaded. Try again');
  const retry = status().querySelector('button');
  assert.equal(text(retry), 'Try again');
  // keyboard: the button stays the same element and keeps focus through a retry (a11y, re-review Minor)
  retry.focus();
  let r2;
  retryPending = { p: new Promise((r) => { r2 = r; }) };
  retry.click();
  await settle();
  assert.equal(text(status()), 'Loading the models…', 'the line says it is loading again');
  assert.equal(status().querySelector('button'), retry, 'the same button');
  assert.equal(retry.getAttribute('aria-disabled'), 'true');
  assert.equal(document.activeElement, retry, 'focus stays on the button while loading');
  retry.click();   // pressed again while loading: ignored
  await settle();
  r2(undefined);
  retryPending = null;
  await settle();
  assert.equal(text(status()), 'The models could not be loaded. Try again', 'a failed retry says so again');
  assert.equal(retry.getAttribute('aria-disabled'), null);
  assert.equal(document.activeElement, retry, 'focus is still on Try again');
  fail = false;
  retry.click();
  await settle();
  assert.ok(host.querySelector('.req-who .req-who-harness'), 'Try again draws Who interviews');
  assert.equal(status(), null, 'the status line is gone');
  assert.equal(document.activeElement, host.querySelector('.req-who .req-who-harness'), 'focus moves to Harness, not to the page');
  assert.equal(calls.filter((c) => c.url === '/api/requirements/models').length, 3, 'the press while loading asked nothing');
});

test('N2: New feature: models loaded but the default unknown: no Claude pick in the selects, the failure line, and no model posted', async () => {
  const CODEX_DEFAULT = { default: { engine: 'codex', model: 'gpt-lite', label: 'GPT Lite', effort: null }, fallbackReason: null };
  for (const [what, listRoute] of [['the list has no default', LIST({ interview: null })], ['the list call fails', undefined]]) {
    let listNow = listRoute;
    const routes = ROUTES({ 'GET /api/requirements': () => listNow, 'POST /api/requirements': { feature: { seq: 9 } } });
    const { host } = await openNew(routes);
    assert.equal(host.querySelector('.req-who'), null, `${what}: no selects (they would pick Claude)`);
    const status = host.querySelector('.req-who-box .req-who-status');
    assert.equal(text(status), 'The models could not be loaded. Try again', what);
    // Try again asks the list again: with the default known the selects start on Codex
    listNow = LIST({ interview: CODEX_DEFAULT });
    status.querySelector('button').click();
    await settle();
    assert.equal(sel(host, 'harness')?.value, 'codex', `${what}: Try again draws the Codex default`);
    // and before that, Create would have posted no model: checked on a fresh form
    listNow = listRoute;
    const again = await openNew(ROUTES({ 'GET /api/requirements': () => listNow, 'POST /api/requirements': { feature: { seq: 9 } } }));
    again.host.querySelector('#req-new-title').value = 'T';
    again.host.querySelector('#req-new-desc').value = 'D';
    [...again.host.querySelectorAll('.req-new .btn-primary')].at(-1).click();
    await settle();
    const post = again.calls.find((c) => c.method === 'POST');
    assert.ok(post, `${what}: Create posts`);
    assert.equal(post.body.model, undefined, `${what}: no model is posted, so the server stores the default or answers 503`);
  }
});

test('styles: the new rules sit inside the Requirements block and use tokens only (board 8, dark)', () => {
  const css = readStyleCss();
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const s of ['.req-who', '.req-new-note', '.req-new-fallback', '.req-new-default']) {
    const at = css.indexOf(s);
    assert.ok(at > start && at < end, `${s} inside the Requirements block`);
  }
  const lines = css.slice(start, end).split('\n').filter((l) => /\.req-who|\.req-new-(note|fallback|default|use|harness)/.test(l));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), 'tokens only');
});

// ── 9c boards 3, 4, 9: the feature's model chip and dialog, the switch confirm, the brief's box and Refresh dialog ──

const H9 = [
  H('claude', 'Claude Code', { files: true, company: 'Anthropic' }),
  H('codex', 'OpenAI Codex (beta)', { company: 'OpenAI' }),
  H('gemini', 'Gemini CLI (beta)', { repo: false, keepsCopy: true, reportsCost: false, company: 'Google' }),
  H('goose', 'Goose (beta)', { repo: false, keepsCopy: true, company: null }),
];
const MODELS9 = [...MODELS, { id: 'goose-m', label: 'Goose M', harnesses: ['goose'], efforts: [], noEffort: true },
  { id: 'own-gpt', label: 'Own GPT', harnesses: ['codex'], efforts: ['low'], custom: 'global', hasEnv: true }];
const CATALOG9 = { harnesses: H9, models: MODELS9, defaults: { ...DEFAULTS, goose: { model: 'goose-m', effort: null } },
  recommended: { claude: 'claude-opus-5-5', codex: 'gpt-sol', gemini: null, goose: null } };
const BRIEF_EST = (usdv, rec) => ({ brief: usdv && typeof usdv === 'object' ? usdv : { usd: usdv }, recommended: rec });
const FILES = [{ name: 'notes.txt', kind: 'text', bytes: 900 }, { name: 'spec.pdf', kind: 'pdf', bytes: 90000 },
  { name: 'mockup.png', kind: 'image', bytes: 5000 }, { name: 'big.txt', kind: 'text', bytes: 60000 }];

test('modelChip: a button.chip with aria-haspopup=dialog, the label and a chevron', () => {
  let opened = 0;
  const b = modelChip(document, { modelLabel: 'GPT-5.6 Sol on OpenAI Codex' }, () => { opened += 1; });
  assert.equal(b.tagName, 'BUTTON');
  assert.equal(b.type, 'button');
  assert.ok(b.classList.contains('chip'));
  assert.equal(b.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(text(b), 'GPT-5.6 Sol on OpenAI Codex');
  assert.equal(b.querySelector('svg').getAttribute('aria-hidden'), 'true');
  b.click();
  assert.equal(opened, 1);
});

test('sentTo: the named company, or the provider of the model for Goose, OpenCode and an own-endpoint model', () => {
  assert.deepEqual(sentTo(H9[1], MODELS9[2], 'GPT-5.6 Sol'), { company: 'OpenAI', named: true });
  assert.deepEqual(sentTo(H9[3], MODELS9[5], 'Goose M'), { company: 'the provider of Goose M', named: false });
  assert.deepEqual(sentTo(H9[1], MODELS9[6], 'Own GPT'), { company: 'the provider of Own GPT', named: false }, 'a model with its own endpoint');
});

const sw = (from, to, files = FILES) => switchConfirm({ from, to, harnesses: H9, models: MODELS9, files });

test('switchConfirm: Codex to Gemini lists the repo, the kept copy, Google and the missing cost (Codex reports one); not the files (Codex already skipped them)', () => {
  const plan = sw({ engine: 'codex', model: 'gpt-sol' }, { engine: 'gemini', model: 'gem-flash' }, FILES.slice(0, 3));
  assert.equal(plan.title, 'Switch this feature to Gemini CLI?');
  assert.equal(plan.confirmLabel, 'Switch to Gemini CLI');
  assert.equal(plan.message, "Worca's next step runs on Gemini CLI with Gemini Flash. Steps already done keep their answers and their cost.\n\nWhat changes:\n"
    + "• Gemini CLI can't read the repo: code looks are skipped, for this feature and for the Product brief.\n"
    + '• Gemini CLI keeps its own copy of each step in its history on this computer.\n'
    + "• Your feature's description, answers and attachments are sent to Google.\n"
    + '• Gemini CLI reports no cost. Worca estimates it from list prices where it can.');
});

test('switchConfirm: Claude to Gemini lists the repo, the two skipped files, the kept copy, Google and the missing cost', () => {
  const plan = sw({ engine: 'claude', model: 'claude-sonnet-5-5' }, { engine: 'gemini', model: 'gem-flash' }, FILES.slice(0, 3));
  assert.equal(plan.message.split('What changes:\n')[1],
    "• Gemini CLI can't read the repo: code looks are skipped, for this feature and for the Product brief.\n"
    + '• Attached files go as text: spec.pdf and mockup.png are skipped.\n'
    + '• Gemini CLI keeps its own copy of each step in its history on this computer.\n'
    + "• Your feature's description, answers and attachments are sent to Google.\n"
    + '• Gemini CLI reports no cost. Worca estimates it from list prices where it can.');
});

test('switchConfirm: files are listed when the new harness takes text only and some are skipped (a text of 24 KB or less goes)', () => {
  const claude = { engine: 'claude', model: 'claude-sonnet-5-5' };
  const gem = { engine: 'gemini', model: 'gem-flash' };
  const plan = sw(claude, gem);
  assert.match(plan.message, /• Attached files go as text: spec\.pdf, mockup\.png and big\.txt are skipped\.\n/);
  assert.match(sw(claude, gem, [FILES[1]]).message, /spec\.pdf is skipped\./);
  assert.match(sw(claude, gem, [FILES[1], FILES[2]]).message, /spec\.pdf and mockup\.png are skipped\./);
  assert.doesNotMatch(sw(claude, gem, [FILES[0]]).message, /Attached files/);
});

test('switchConfirm: Codex to Claude with nothing lost asks only about the company; Claude to Claude and Codex to Codex ask nothing', () => {
  const toClaude = sw({ engine: 'codex', model: 'gpt-sol' }, { engine: 'claude', model: 'claude-opus-5-5' });
  assert.equal(toClaude.message.split('What changes:\n')[1], "• Your feature's description, answers and attachments are sent to Anthropic.");
  assert.equal(toClaude.confirmLabel, 'Switch to Claude Code');
  assert.equal(sw({ engine: 'claude', model: 'claude-sonnet-5-5' }, { engine: 'claude', model: 'claude-opus-5-5' }), null);
  assert.equal(sw({ engine: 'codex', model: 'gpt-lite' }, { engine: 'codex', model: 'gpt-sol' }), null);
});

test('switchConfirm: Goose says "the provider of <model>"; an own-endpoint model on the same harness asks about it', () => {
  const g = sw({ engine: 'claude', model: 'claude-opus-5-5' }, { engine: 'goose', model: 'goose-m' }, []);
  assert.match(g.message, /• Your feature's description, answers and attachments are sent to the provider of Goose M\./);
  const own = sw({ engine: 'codex', model: 'gpt-sol' }, { engine: 'codex', model: 'own-gpt' }, []);
  assert.match(own.message, /sent to the provider of Own GPT\./);
  assert.doesNotMatch(own.message, /keeps its own copy/);
});

test('recommendationNote (brief): the brief wording, the cost words and Use <rec>', () => {
  const labels = { harness: 'Claude Code', picked: 'Sonnet 5.5', recommended: 'Opus 5.5' };
  let used = 0;
  const n = recommendationNote(document, { kind: 'brief', picked: 'claude-sonnet-5-5', recommended: 'claude-opus-5-5', labels, onUse: () => { used += 1; },
    estimates: BRIEF_EST(0.24, { model: 'claude-opus-5-5', brief: { usd: 0.42 } }) });
  assert.equal(text(n), 'A brief works best with a strong model, like Opus 5.5 on Claude Code: about $0.42. You picked Sonnet 5.5: about $0.24. Counts toward your limit. Use Opus 5.5');
  assert.equal(n.getAttribute('aria-live'), null);
  n.querySelector('button').click();
  assert.equal(used, 1);
  const same = recommendationNote(document, { kind: 'brief', picked: 'x', recommended: 'x', labels, estimates: BRIEF_EST(0.42, { model: 'x', brief: { usd: 0.42 } }) });
  assert.equal(text(same), 'A brief works best with a strong model, like Opus 5.5 on Claude Code: about $0.42. Counts toward your limit.');
  const missing = recommendationNote(document, { kind: 'brief', picked: 'x', recommended: 'x', labels: { ...labels, harness: 'OpenAI Codex', recommended: 'GPT-5.6 Sol' },
    estimates: BRIEF_EST(null, { model: 'x', brief: { usd: null, reason: 'no-estimate' } }) });
  assert.equal(text(missing), 'A brief works best with a strong model, like GPT-5.6 Sol on OpenAI Codex: no estimate yet. Counts toward your limit.');
  const unk = recommendationNote(document, { kind: 'brief', picked: 'y', recommended: 'x', labels, estimates: BRIEF_EST({ usd: null, reason: 'no-price' }, null) });
  assert.match(text(unk), /You picked Sonnet 5\.5: cost unknown\./);
  const none = recommendationNote(document, { kind: 'brief', picked: 'y', recommended: null, labels, estimates: { brief: { usd: null, reason: 'no-price' } } });
  assert.equal(text(none), 'Cost unknown. Counts toward your limit.');
});

test('whoInterviews: repoOnly greys the harnesses that cannot read the repo and names the legend', () => {
  const w = whoInterviews(document, { models: MODELS9, harnesses: H9, choice: { engine: 'gemini', model: 'gem-flash' }, defaults: CATALOG9.defaults, legend: 'Who makes it', repoOnly: true });
  assert.equal(text(w.el.querySelector('legend')), 'Who makes it');
  const opts = [...w.el.querySelector('.req-who-harness').options].map((o) => [o.value, o.textContent, o.disabled]);
  assert.deepEqual(opts, [['claude', 'Claude Code', false], ['codex', 'OpenAI Codex (beta)', false], ['gemini', "Gemini CLI (beta) · Can't read the repo", true],
    ['goose', "Goose (beta) · Can't read the repo", true]]);
  assert.equal(w.value().engine, 'claude', 'a harness that cannot make a brief is not where the box starts');
});

test('defaultLine: a lead ("Last made with …") first; alone when the pick is the default', () => {
  const dc = { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' };
  const labels = { model: 'Sonnet 5.5', harness: 'Claude Code' };
  const lead = 'Last made with Opus 5.5 on Claude Code. ';
  assert.equal(text(defaultLine(document, { choice: { engine: 'claude', model: 'claude-opus-5-5' }, defaultChoice: dc, labels, lead })),
    'Last made with Opus 5.5 on Claude Code. Your default: Sonnet 5.5 on Claude Code. Use the default');
  assert.equal(text(defaultLine(document, { choice: dc, defaultChoice: dc, labels, lead })), 'Last made with Opus 5.5 on Claude Code.');
  assert.equal(defaultLine(document, { choice: dc, defaultChoice: dc, labels }), null);
});

// ── the feature page ──

const F9 = (over = {}) => ({
  seq: 4, id: 'FEAT-4', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel an order', status: 'your_turn', state: 'your_turn', rounds: 2, costUsd: 0.21, busy: false,
  orientation: { summary: '', files: [], skipped: null },
  spec: { goal: { text: 'Cancel', measure: '' }, actors: [], flow: [], edgeCases: [], rules: [], outOfScope: [], criteria: [], assumptions: [], openQuestions: [], edited: {} },
  pending: null, lastError: null, readiness: { ok: false, passed: 0, total: 6, checks: [], overridable: false }, starts: [], unaskedRejections: [], changedSinceStart: [],
  model: { engine: 'codex', model: 'gpt-sol', effort: 'high' }, modelLabel: 'GPT-5.6 Sol on OpenAI Codex', anyEstimated: false, attachments: FILES, ...over,
});
const openFeature = async ({ f = F9(), confirm, extra = {}, turns = [] } = {}) => {
  let cur = f;
  const calls = fakeApi({
    ...ROUTES(),
    'GET /api/requirements/models': CATALOG9,
    'GET /api/requirements/4': () => ({ feature: cur, turns }),
    'GET /api/requirements': LIST({ interview: { default: { engine: 'claude', model: 'claude-sonnet-5-5', label: 'Sonnet 5.5', effort: 'medium' }, fallbackReason: null } }),
    'PUT /api/requirements/4/model': (q, o) => {
      const b = JSON.parse(o.body);
      cur = { ...cur, model: b, modelLabel: `${MODELS9.find((m) => m.id === b.model).label} on ${b.engine}` };
      return { feature: cur, turns: [] };
    },
    ...extra,
  });
  const host = document.createElement('div');
  const msgEl = document.createElement('p');
  document.body.replaceChildren(host, msgEl);
  const asked = [];
  const view = createRequirementsView({ host, subEl: document.createElement('div'), msgEl,
    deps: { route: () => {}, confirm: async (o) => { asked.push(o); return confirm ? confirm(o) : true; } } });
  await view.show('feature/4');
  await settle();
  return { host, calls, asked, view, msgEl };
};
const dialogEl = () => document.querySelector('[role="dialog"][aria-labelledby]');
const putCalls = (calls) => calls.filter((c) => c.method === 'PUT');
const chipsOf = (host) => [...host.querySelectorAll('.req-chips > .chip')];

test('feature page: the model chip follows the cost chip, names the model and harness; the cost chip says ≈ when estimated', async () => {
  const { host } = await openFeature();
  const chips = chipsOf(host);
  const at = chips.findIndex((c) => /so far/.test(c.textContent));
  assert.equal(text(chips[at]), '$0.21 so far');
  const chip = chips[at + 1];
  assert.equal(chip.tagName, 'BUTTON');
  assert.equal(chip.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(text(chip), 'GPT-5.6 Sol on OpenAI Codex');
  const est = await openFeature({ f: F9({ anyEstimated: true }) });
  assert.equal(text(chipsOf(est.host).find((c) => /so far/.test(c.textContent))), '≈$0.21 so far');
  const none = await openFeature({ f: F9({ modelLabel: null, model: null }) });
  assert.equal(none.host.querySelector('[data-ui="model-chip"]'), null, 'no chip when the model cannot be told');
});

test('feature page: the chip opens "Model for this feature" with its parts; Cancel saves nothing and gives the focus back', async () => {
  const { host, calls, asked } = await openFeature();
  const chip = host.querySelector('[data-ui="model-chip"]');
  chip.focus();
  chip.click();
  await settle();
  const d = dialogEl();
  assert.ok(d, 'a dialog');
  assert.equal(d.getAttribute('aria-modal'), 'true');
  assert.equal(text(document.getElementById(d.getAttribute('aria-labelledby'))), 'Model for this feature');
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'Interviews, code looks, file reads and Feature chat use it.');
  const v = (n) => d.querySelector(`.req-who-${n}`).value;
  assert.deepEqual([v('harness'), v('model'), v('effort')], ['codex', 'gpt-sol', 'high'], "starts on the feature's own pick");
  assert.equal(text(d.querySelector('.req-new-harness')), 'OpenAI Codex reads the repo read-only. Files go to it as text.');
  assert.equal(text(d.querySelector('.req-model-applies')), 'Applies from the next step. Steps already done keep the model that ran them.');
  assert.equal(text(d.querySelector('.req-new-default')), 'Your default: Sonnet 5.5 on Claude Code. Use the default');
  assert.ok(calls.some((c) => /\/estimates\?engine=codex&model=gpt-sol$/.test(c.url)));
  assert.equal(text(d.querySelector('[aria-live="polite"]')),
    'Requirements work best with a strong model, like GPT-5.6 Sol on OpenAI Codex: about $0.12 for a code look, about $0.02 a round.');
  assert.equal(d.querySelectorAll('[aria-live]').length, 1, 'one persistent live slot');
  assert.deepEqual([...d.querySelectorAll('.req-dlg-btns button')].map((b) => b.textContent), ['Cancel', 'Save']);
  d.querySelector('[data-ui="model-cancel"]').click();
  await settle();
  assert.equal(dialogEl(), null);
  assert.equal(putCalls(calls).length, 0);
  assert.equal(asked.length, 0);
  assert.equal(document.activeElement.getAttribute('data-ui'), 'model-chip', 'the focus goes back to the chip');
});

test('feature page: Escape closes the dialog; focus moves into it on open', async () => {
  const { host, calls } = await openFeature();
  host.querySelector('[data-ui="model-chip"]').click();
  await settle();
  assert.ok(dialogEl().contains(document.activeElement), 'focus moved in');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(dialogEl(), null);
  assert.equal(putCalls(calls).length, 0);
});

test('feature page: Save to Gemini asks the switch confirm first; Cancel on it saves nothing, OK puts the model and repaints the chip', async () => {
  const no = await openFeature({ confirm: () => false });
  no.host.querySelector('[data-ui="model-chip"]').click();
  await settle();
  await pickValue(dialogEl().querySelector('.req-who-harness'), 'gemini');
  dialogEl().querySelector('[data-ui="model-save"]').click();
  await settle();
  assert.equal(no.asked.length, 1);
  assert.equal(no.asked[0].title, 'Switch this feature to Gemini CLI?');
  assert.equal(no.asked[0].confirmLabel, 'Switch to Gemini CLI');
  assert.equal(putCalls(no.calls).length, 0, 'Cancel saves nothing');
  assert.ok(dialogEl(), 'the dialog stays for another choice');
  const yes = await openFeature();
  yes.host.querySelector('[data-ui="model-chip"]').click();
  await settle();
  await pickValue(dialogEl().querySelector('.req-who-harness'), 'gemini');
  dialogEl().querySelector('[data-ui="model-save"]').click();
  await settle();
  assert.deepEqual(putCalls(yes.calls).map((c) => c.body), [{ engine: 'gemini', model: 'gem-flash', effort: null }]);
  assert.equal(dialogEl(), null);
  assert.equal(text(yes.host.querySelector('[data-ui="model-chip"]')), 'Gemini Flash on gemini');
  assert.equal(document.activeElement, yes.host.querySelector('[data-ui="model-chip"]'), 'the focus is on the new chip, not <body>');
});

test('feature page: Claude to Gemini lists the skipped files in the confirm', async () => {
  const { host, asked } = await openFeature({ f: F9({ model: { engine: 'claude', model: 'claude-opus-5-5', effort: null }, modelLabel: 'Opus 5.5 on Claude Code' }) });
  host.querySelector('[data-ui="model-chip"]').click();
  await settle();
  await pickValue(dialogEl().querySelector('.req-who-harness'), 'gemini');
  dialogEl().querySelector('[data-ui="model-save"]').click();
  await settle();
  assert.match(asked[0].message, /• Attached files go as text: spec\.pdf, mockup\.png and big\.txt are skipped\./);
  assert.match(asked[0].message, /sent to Google\./);
});

test('feature page: Claude to another Claude model asks nothing and saves; the same pick just closes', async () => {
  const { host, calls, asked } = await openFeature({ f: F9({ model: { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }, modelLabel: 'Sonnet 5.5 on Claude Code' }) });
  host.querySelector('[data-ui="model-chip"]').click();
  await settle();
  dialogEl().querySelector('[data-ui="model-save"]').click();
  await settle();
  assert.equal(putCalls(calls).length, 0, 'unchanged: nothing is sent');
  assert.equal(dialogEl(), null);
  host.querySelector('[data-ui="model-chip"]').click();
  await settle();
  await pickValue(dialogEl().querySelector('.req-who-model'), 'claude-opus-5-5');
  dialogEl().querySelector('[data-ui="model-save"]').click();
  await settle();
  assert.equal(asked.length, 0, 'no confirm');
  assert.deepEqual(putCalls(calls).map((c) => c.body), [{ engine: 'claude', model: 'claude-opus-5-5', effort: 'medium' }]);
});

test('feature page: a refused save (409) says why inside the dialog and keeps it open', async () => {
  const { host } = await openFeature();
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => (o.method === 'PUT' ? { ok: false, status: 409, json: async () => ({ error: 'Worca is working on this feature.' }) } : inner(u, o));
  host.querySelector('[data-ui="model-chip"]').click();
  await settle();
  await pickValue(dialogEl().querySelector('.req-who-model'), 'gpt-lite');
  dialogEl().querySelector('[data-ui="model-save"]').click();
  await settle();
  assert.equal(text(dialogEl().querySelector('.req-dlg-msg')), 'Worca is working on this feature.');
  assert.ok(!dialogEl().querySelector('[data-ui="model-save"]').disabled);
});

// ── the brief page ──

const BRIEF9 = '/api/requirements/brief/project/shop-1';
const briefBody9 = (over = {}) => ({ brief: null, target: { name: 'shop', branch: 'main', repositories: 1, leftOut: [], slow: [] },
  notes: { scopeType: 'project', scopeKey: 'shop-1', body: '', lookAtCode: true }, estimate: { costUsd: 0.24, model: { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' } },
  usedBy: [], staleness: null, documents: [], madeWith: null,
  briefDefault: { choice: { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }, fallbackReason: null }, ...over });
const madeBrief9 = (over = {}) => ({ id: 3, scopeType: 'project', scopeKey: 'shop-1', status: 'ready', sections: { purpose: 'It sells.' }, edited: {}, files: [],
  sources: [{ project: 'shop-1', branch: 'main', ref: 'refs/heads/main', sha: '3f2a1c9deadbeef' }], seed: null, model: 'claude-opus-5-5', engine: 'claude', costUsd: 0.42,
  error: null, madeBy: 'po', madeAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over });
const BRIEF_ESTIMATES = (q) => ({
  'claude-sonnet-5-5': BRIEF_EST(0.24, { model: 'claude-opus-5-5', brief: { usd: 0.42 } }),
  'claude-opus-5-5': BRIEF_EST(0.42, { model: 'claude-opus-5-5', brief: { usd: 0.42 } }),
  'gpt-sol': BRIEF_EST(null, { model: 'gpt-sol', brief: { usd: null, reason: 'no-estimate' } }),
}[q.model] || BRIEF_EST(null, null));
const openBrief9 = async (body, extra = {}) => {
  const calls = fakeApi({ ...ROUTES(), 'GET /api/requirements/models': CATALOG9, 'GET /api/requirements/estimates': BRIEF_ESTIMATES, [`GET ${BRIEF9}`]: body, ...extra });
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const msgEl = document.createElement('p');
  const view = createRequirementsView({ host, subEl: document.createElement('div'), msgEl, deps: { route: () => {}, confirm: async () => true } });
  await view.show('brief/project/shop-1');
  await settle();
  return { host, calls, view, msgEl };
};

test('brief page (board 9): the box picks who makes it, Gemini is greyed with "Can\'t read the repo", the note is the brief\'s own', async () => {
  const { host, calls } = await openBrief9(briefBody9());
  const box = host.querySelector('.req-brief-cost');
  assert.equal(text(box.querySelector('.req-who legend')), 'Who makes it');
  assert.equal(box.querySelector('.req-brief-model'), null, 'the old line is gone');
  const opts = [...box.querySelector('.req-who-harness').options].map((o) => [o.value, o.textContent, o.disabled]);
  assert.deepEqual(opts, [['claude', 'Claude Code', false], ['codex', 'OpenAI Codex (beta)', false], ['gemini', "Gemini CLI (beta) · Can't read the repo", true],
    ['goose', "Goose (beta) · Can't read the repo", true]]);
  assert.equal(box.querySelector('.req-who-model').value, 'claude-sonnet-5-5');
  assert.ok(calls.some((c) => c.url === '/api/requirements/estimates?engine=claude&model=claude-sonnet-5-5&step=brief'));
  assert.equal(text(box.querySelector('[aria-live="polite"]')),
    'A brief works best with a strong model, like Opus 5.5 on Claude Code: about $0.42. You picked Sonnet 5.5: about $0.24. Counts toward your limit. Use Opus 5.5');
  assert.equal(text(box.querySelector('.req-brief-facts')), 'Branch main · 3 to 5 minutes', 'the cost lives in the note now');
  box.querySelector('.req-new-use').click();
  await settle();
  assert.equal(box.querySelector('.req-who-model').value, 'claude-opus-5-5');
});

test('brief page: the Claude fallback line when the Default engine cannot read the repo; Create posts the choice', async () => {
  const reason = "Your default engine is Gemini CLI, which can't read the repo, so this brief is made on Claude.";
  const { host, calls } = await openBrief9(briefBody9({ briefDefault: { choice: { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' }, fallbackReason: reason } }),
    { [`POST ${BRIEF9}`]: { brief: madeBrief9({ status: 'making' }) } });
  assert.equal(text(host.querySelector('.req-brief-cost .req-new-fallback')), reason);
  await pickValue(host.querySelector('.req-brief-cost .req-who-model'), 'claude-opus-5-5');
  host.querySelector('[data-ui="brief-create"]').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { choice: { engine: 'claude', model: 'claude-opus-5-5', effort: 'medium' } });
});

test('brief page: without the models there is no box and no pre-9c model line (B3); Create posts no choice', async () => {
  const routes = { ...ROUTES(), [`GET ${BRIEF9}`]: briefBody9(), [`POST ${BRIEF9}`]: { brief: madeBrief9({ status: 'making' }) } };
  delete routes['GET /api/requirements/models'];
  const calls = fakeApi(routes);
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const view = createRequirementsView({ host, subEl: document.createElement('div'), msgEl: document.createElement('p'), deps: { route: () => {} } });
  await view.show('brief/project/shop-1');
  await settle();
  assert.equal(host.querySelector('.req-who'), null);
  assert.equal(host.querySelector('.req-brief-model'), null, 'a 9c page never falls back to the pre-9c line');
  host.querySelector('[data-ui="brief-create"]').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, {});
});

test('brief page, made: the chip names what made it ("Opus 5.5 on Claude Code · $0.42")', async () => {
  const { host } = await openBrief9(briefBody9({ brief: madeBrief9(), madeWith: { engine: 'claude', model: 'claude-opus-5-5', label: 'Opus 5.5' } }));
  const chips = [...host.querySelectorAll('.req-brief-chips > *')].map(text);
  assert.ok(chips.includes('Opus 5.5 on Claude Code · $0.42'), chips.join(' | '));
});

test('brief page, made: Refresh opens its dialog from the model that made it, shows both lines and the note, and posts the choice', async () => {
  const { host, calls } = await openBrief9(briefBody9({ brief: madeBrief9(), madeWith: { engine: 'claude', model: 'claude-opus-5-5', label: 'Opus 5.5' },
    usedBy: [{ seq: 2, id: 'FEAT-2' }] }), { [`POST ${BRIEF9}`]: { brief: madeBrief9({ status: 'making' }) } });
  host.querySelector('[data-ui="brief-more"]').click();
  host.querySelector('[data-ui="mi-brief-refresh"]').click();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'asks first');
  const d = dialogEl();
  assert.equal(text(document.getElementById(d.getAttribute('aria-labelledby'))), 'Refresh the brief');
  assert.equal(text(d.querySelector('.req-dlg-lead')), 'One look at main, read-only, 3 to 5 minutes. Your edits are kept.');
  assert.deepEqual([d.querySelector('.req-who-harness').value, d.querySelector('.req-who-model').value], ['claude', 'claude-opus-5-5']);
  assert.equal(text(d.querySelector('.req-new-default')), 'Last made with Opus 5.5 on Claude Code. Your default: Sonnet 5.5 on Claude Code. Use the default');
  assert.equal(text(d.querySelector('[aria-live="polite"]')), 'A brief works best with a strong model, like Opus 5.5 on Claude Code: about $0.42. Counts toward your limit.');
  assert.equal([...d.querySelector('.req-who-harness').options].find((o) => o.value === 'gemini').disabled, true);
  d.querySelector('[data-ui="brief-refresh-go"]').click();
  await settle();
  assert.deepEqual(calls.find((c) => c.method === 'POST').body, { choice: { engine: 'claude', model: 'claude-opus-5-5', effort: null } });
  assert.equal(dialogEl(), null);
});

test('brief page, made: Cancel on the Refresh dialog posts nothing; "Use the default" moves the selects', async () => {
  const { host, calls } = await openBrief9(briefBody9({ brief: madeBrief9(), madeWith: { engine: 'claude', model: 'claude-opus-5-5', label: 'Opus 5.5' } }));
  host.querySelector('[data-ui="brief-more"]').click();
  host.querySelector('[data-ui="mi-brief-refresh"]').click();
  await settle();
  dialogEl().querySelector('.req-new-default .req-new-use').click();
  await settle();
  assert.equal(dialogEl().querySelector('.req-who-model').value, 'claude-sonnet-5-5');
  dialogEl().querySelector('[data-ui="brief-refresh-cancel"]').click();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(dialogEl(), null);
});

test('styles: the model chip, the dialog and the brief box rules sit inside the Requirements block with tokens only', () => {
  const css = readStyleCss();
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const s of ['.req-model-chip', '.req-brief-who']) {
    const at = css.indexOf(s);
    assert.ok(at > start && at < end, `${s} inside the Requirements block`);
  }
  const lines = css.slice(start, end).split('\n').filter((l) => /req-model-chip|req-model-dialog|req-brief-who|req-model-applies/.test(l));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), 'tokens only');
});

test('brief page: a pick the server refuses (400) is said in the message line and the page stays', async () => {
  const refusal = "Gemini CLI can't read the repo, so it can't make a Product brief.";
  const { host, msgEl } = await openBrief9(briefBody9());
  const inner = globalThis.fetch;
  globalThis.fetch = async (u, o = {}) => (o.method === 'POST' ? { ok: false, status: 400, json: async () => ({ error: refusal }) } : inner(u, o));
  host.querySelector('[data-ui="brief-create"]').click();
  await settle();
  assert.equal(text(msgEl), refusal);
  assert.ok(msgEl.classList.contains('err'));
  assert.match(host.querySelector('[data-ui="brief-create"]').textContent, /Create the brief/, 'the button is back');
  assert.equal(host.querySelector('[data-ui="brief-create"]').disabled, false);
});

// ── 9c boards 5 and 6: the thread, the code look as a step, notices, errors, the cost list ──

const STEP_NOTICE = 'GPT-5.5 is no longer available, so this step used the default.';
const turn = (id, kind, o = {}) => ({ id, kind, payload: {}, model: null, modelLabel: null, costUsd: null, costKind: null, engine: null, notices: [], by: null, at: '2026-11-09T10:00:00', ...o });
const Q = (id = 'q1') => [{ id, question: 'Who may cancel an order?', options: ['Customers', 'Support'], recommended: 'Customers', why: '' }];
const lookTurn = (id = 1, o = {}) => turn(id, 'orientation', { model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', engine: 'claude', costUsd: 0.19, costKind: 'billed',
  payload: { summary: 'Products already bring in downloadable documents during import and show them on product pages. A second sentence follows.', files: ['/a.js', '/b.js', '/c.js'], skipped: null }, ...o });
const roundTurn = (id, o = {}) => turn(id, 'round', { payload: { questions: Q(`q${id}`), note: '' }, model: 'gpt-sol', modelLabel: 'GPT-5.6 Sol', engine: 'codex', costUsd: 0.03, costKind: 'billed', ...o });
const answersTurn = (id, roundTurnId) => turn(id, 'answers', { payload: { roundTurnId, answers: [{ id: `q${roundTurnId}`, answer: 'Customers', recommended: true }] } });
const pendingOf = (turnId) => ({ turnId, questions: Q(`q${turnId}`), note: '' });
const noticeLines = (el) => [...el.querySelectorAll('ul[aria-label="What this step could not do"] li')].map((li) => text(li));

test('thread: each round says what it ran on and its cost, right-aligned, with its notices as grey hint lines', async () => {
  const { host } = await openFeature({ f: F9({ pending: pendingOf(4), status: 'your_turn' }), turns: [
    roundTurn(2, { notices: [STEP_NOTICE] }), answersTurn(3, 2),
    roundTurn(4, { model: 'gem-flash', modelLabel: 'Gemini Flash', engine: 'gemini', costUsd: 0.04, costKind: 'estimated',
      notices: ["Repo not read: Gemini CLI can't read the repo.", 'Cost estimated: Gemini CLI reports none.'] })] });
  const r1 = host.querySelector('.req-round[data-round="2"]');
  assert.equal(text(r1.querySelector('.req-round-n')), 'Round 1');
  assert.equal(text(r1.querySelector('.req-step-meta')), 'GPT-5.6 Sol on OpenAI Codex · $0.03');
  assert.deepEqual(noticeLines(r1), [STEP_NOTICE]);
  assert.ok(!r1.querySelector('.amber'), 'notices are never amber');
  assert.ok(r1.querySelector('ul[aria-label] li svg'), 'with the info icon');
  const q = host.querySelector('.qpanel');
  assert.equal(text(q.querySelector('.req-step-meta')), 'Gemini Flash on Gemini CLI · ≈$0.04');
  assert.deepEqual(noticeLines(q), ["Repo not read: Gemini CLI can't read the repo.", 'Cost estimated: Gemini CLI reports none.']);
});

test('thread: an unknown cost says "cost unknown", never $0.00; a Claude round with nothing booked says only what ran it', async () => {
  const { host } = await openFeature({ f: F9({ status: 'done', state: 'done' }), turns: [
    roundTurn(2, { costUsd: null, costKind: 'unknown' }), answersTurn(3, 2),
    roundTurn(4, { model: 'claude-opus-5-5', modelLabel: 'Opus 5.5', engine: 'claude', costUsd: null, costKind: null }), answersTurn(5, 4)] });
  assert.equal(text(host.querySelector('.req-round[data-round="2"] .req-step-meta')), 'GPT-5.6 Sol on OpenAI Codex · cost unknown');
  assert.equal(text(host.querySelector('.req-round[data-round="4"] .req-step-meta')), 'Opus 5.5 on Claude Code');
  assert.ok(!/\$0\.00/.test(host.querySelector('.req-left').textContent));
});

test('thread: the code look is a step row in turn order: "Code look · 3 files", what ran it, the first sentence, Show what it found', async () => {
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function scroll() { scrolled.push(this.className); };
  const { host } = await openFeature({ f: F9({ orientation: { summary: 'x', files: ['/a.js'], skipped: null } }),
    turns: [lookTurn(1), roundTurn(2), answersTurn(3, 2)] });
  const rows = [...host.querySelectorAll('.req-rounds > .req-round, .req-rounds > .req-step')];
  assert.deepEqual(rows.map((r) => r.className.includes('req-step-look')), [true, false], 'the look first, then Round 1');
  const row = rows[0];
  assert.equal(text(row.querySelector('.req-round-n')), 'Code look · 3 files');
  assert.equal(text(row.querySelector('.req-step-meta')), 'Opus 5.5 on Claude Code · $0.19');
  assert.equal(text(row.querySelector('.req-step-first')), 'Products already bring in downloadable documents during import and show them on product pages.');
  const btn = row.querySelector('button[data-ui="look-show"]');
  assert.equal(text(btn), 'Show what it found');
  assert.equal(host.querySelector('details.req-orient').open, false);
  btn.click();
  await settle();
  assert.equal(host.querySelector('details.req-orient').open, true, 'the folded card opens');
  assert.ok(scrolled.some((c) => /req-orient/.test(c)), 'and scrolls into view');
  assert.ok(text(host.querySelector('details.req-orient summary')).startsWith('Code look: what Worca found'));
});

test('thread: a look with no files has no count; the first sentence is at most 200 characters', async () => {
  const long = `${'word '.repeat(80)}end.`;
  const { host } = await openFeature({ turns: [lookTurn(1, { payload: { summary: long, files: [], skipped: null } })] });
  assert.equal(text(host.querySelector('.req-step-look .req-round-n')), 'Code look');
  assert.ok(host.querySelector('.req-step-look .req-step-first').textContent.length <= 200);
});

test('thread: a look skipped for the harness is a row with its notice and no button; a look skipped for the brief adds no row', async () => {
  const skippedEngine = turn(1, 'orientation', { engine: 'gemini', notices: ["Repo not read: Gemini CLI can't read the repo."], payload: { summary: '', files: [], skipped: 'engine' } });
  const { host } = await openFeature({ f: F9({ orientation: { summary: '', files: [], skipped: 'engine' } }), turns: [skippedEngine] });
  const row = host.querySelector('.req-step-look');
  assert.equal(text(row.querySelector('.req-round-n')), 'Code look');
  assert.equal(text(row.querySelector('.req-step-meta')), 'Gemini CLI');
  assert.deepEqual(noticeLines(row), ["Repo not read: Gemini CLI can't read the repo."]);
  assert.equal(row.querySelector('button'), null);
  const brief = await openFeature({ f: F9({ orientation: { summary: '', files: [], skipped: 'brief' } }),
    turns: [turn(1, 'orientation', { payload: { summary: '', files: [], skipped: 'brief' } })] });
  assert.equal(brief.host.querySelector('.req-step-look'), null);
  assert.equal(text(brief.host.querySelector('details.req-orient p')), 'Worca has not done a code look for this feature.');
});

test('thread: a model turn is one plain row "You switched this feature to <model> on <Harness> · <time>"', async () => {
  const { host } = await openFeature({ turns: [roundTurn(2), answersTurn(3, 2),
    turn(4, 'model', { at: '2026-11-09T14:02:00', payload: { engine: 'gemini', model: 'gem-flash', effort: null, from: { engine: 'codex', model: 'gpt-sol' } } })] });
  const row = host.querySelector('.req-step-switch');
  assert.equal(text(row), 'You switched this feature to gem-flash on Gemini CLI · 9 Nov, 14:02');
  assert.equal(row.querySelector('button'), null);
});

const readyError = (job = 'look', o = {}) => turn(9, 'error', { engine: 'codex', model: 'gpt-sol', modelLabel: 'GPT-5.6 Sol', costUsd: null, costKind: null,
  payload: { code: 'NOT_READY', message: "OpenAI Codex isn't signed in. Sign in, or change the model.", job, docsUrl: 'https://docs.example.org/codex-login' }, ...o });

test('errors: a NOT_READY look stops with the D13 sentence, Change the model, Try again and the docs link', async () => {
  const { host, calls } = await openFeature({ f: F9({ lastError: "OpenAI Codex isn't signed in. Sign in, or change the model." }),
    turns: [readyError('look')], extra: { 'POST /api/requirements/4/retry': { feature: F9(), turns: [] } } });
  const box = host.querySelector('.req-error');
  assert.equal(box.getAttribute('role'), 'status', 'a repaint does not announce it again');
  assert.equal(text(box.querySelector('.req-error-title')), 'Code look stopped');
  assert.equal(text(box.querySelector('.req-step-meta')), 'GPT-5.6 Sol on OpenAI Codex · nothing spent');
  assert.equal(text(box.querySelector('.req-error-text')), "OpenAI Codex isn't signed in. Sign in, or change the model.");
  const docs = box.querySelector('a.req-error-docs');
  assert.equal(text(docs), 'How to sign in to OpenAI Codex');
  assert.equal(docs.getAttribute('href'), 'https://docs.example.org/codex-login');
  assert.deepEqual([...box.querySelectorAll('button')].map((b) => text(b)), ['Change the model', 'Try again']);
  box.querySelector('[data-ui="error-change-model"]').click();
  await settle();
  assert.equal(text(document.getElementById(dialogEl().getAttribute('aria-labelledby'))), 'Model for this feature');
  dialogEl().querySelector('[data-ui="model-cancel"]').click();
  await settle();
  host.querySelector('.req-error .req-retry').click();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'POST' && /retry$/.test(c.url)).length, 1);
});

test('errors: a NOT_READY round is "Round N stopped" (N: the round that did not run); other errors keep their text and Try again', async () => {
  const { host } = await openFeature({ f: F9({ lastError: "OpenAI Codex isn't signed in. Sign in, or change the model." }),
    turns: [roundTurn(2), answersTurn(3, 2), readyError('round', { payload: { code: 'NOT_READY', message: "OpenAI Codex isn't signed in. Sign in, or change the model.", job: 'round' } })] });
  assert.equal(text(host.querySelector('.req-error-title')), 'Round 2 stopped');
  assert.equal(host.querySelector('a.req-error-docs'), null, 'no docs link without a docsUrl');
  const limit = await openFeature({ f: F9({ lastError: 'Limit reached. Try later.' }), turns: [turn(9, 'error', { payload: { code: 'RATE_LIMIT', message: 'Limit reached. Try later.', job: 'round' } })] });
  assert.equal(text(limit.host.querySelector('.req-error')), 'Limit reached. Try later. Try again');
  assert.equal(limit.host.querySelector('.req-error-title'), null);
});

test('files: a SKIPPED_ENGINE file is a grey line (not an alert) with Read again', async () => {
  const skipped = { id: 7, name: 'spec.pdf', kind: 'pdf', bytes: 90000, status: 'failed', href: '/api/requirements/4/attachments/7',
    error: { code: 'SKIPPED_ENGINE', message: 'spec.pdf skipped: Gemini CLI gets files as text only.' } };
  const { host, calls } = await openFeature({ f: F9({ attachments: [skipped] }), extra: { 'POST /api/requirements/4/attachments/7/read-again': { feature: F9({ attachments: [skipped] }), turns: [] } } });
  const line = host.querySelector('.req-file-failed');
  assert.equal(line.getAttribute('role'), null, 'grey, nothing to rush');
  assert.ok(line.classList.contains('req-file-skipped'));
  assert.equal(text(line.querySelector('.req-file-failed-text')), 'spec.pdf skipped: Gemini CLI gets files as text only.');
  const btn = line.querySelector('button');
  assert.equal(text(btn), 'Read again');
  btn.click();
  await settle();
  assert.equal(calls.filter((c) => c.method === 'POST' && /read-again$/.test(c.url)).length, 1);
});

const COSTS = (o = {}) => ({ rows: [
  { step: 'look', label: 'Code look', ranOn: 'Opus 5.5 on Claude Code', usd: 0.16, kind: 'billed' },
  { step: 'round', label: 'Round 1', ranOn: 'GPT-5.6 Sol on OpenAI Codex', usd: 0.03, kind: 'billed' },
  { step: 'round', label: 'Round 2', ranOn: 'GPT-5.6 Sol on OpenAI Codex', usd: 0.02, kind: 'billed' },
  { step: 'round', label: 'Round 3', ranOn: 'gemini-3-pro on Gemini CLI', usd: 0.04, kind: 'estimated' },
  { step: 'read', label: 'File read · notes.txt', ranOn: 'qwen3-coder-plus on Qwen Code', usd: null, kind: 'unknown' }],
billedUsd: 0.21, estimatedUsd: 0.04, unknownSteps: 1, totalUsd: 0.25, anyEstimated: true, limitUsd: 5, resetPeriod: 'monthly', ...o });

test('cost chip: a button that opens "Cost of this feature" with the table, the So far row and the sentence', async () => {
  const { host, calls } = await openFeature({ f: F9({ anyEstimated: true, costUsd: 0.25 }), extra: { 'GET /api/requirements/4/costs': COSTS() } });
  const chip = host.querySelector('[data-ui="cost-chip"]');
  assert.equal(chip.tagName, 'BUTTON');
  assert.equal(chip.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(text(chip), '≈$0.25 so far');
  chip.click();
  await settle();
  assert.ok(calls.some((c) => c.url === '/api/requirements/4/costs'));
  const d = dialogEl();
  assert.equal(text(document.getElementById(d.getAttribute('aria-labelledby'))), 'Cost of this feature');
  assert.deepEqual([...d.querySelectorAll('thead th')].map((t) => text(t)), ['Step', 'Ran on', 'Cost']);
  assert.deepEqual([...d.querySelectorAll('tbody tr')].map((r) => [...r.children].map((c) => text(c))), [
    ['Code look', 'Opus 5.5 on Claude Code', '$0.16'], ['Round 1', 'GPT-5.6 Sol on OpenAI Codex', '$0.03'], ['Round 2', 'GPT-5.6 Sol on OpenAI Codex', '$0.02'],
    ['Round 3', 'gemini-3-pro on Gemini CLI', '≈$0.04'], ['File read · notes.txt', 'qwen3-coder-plus on Qwen Code', 'cost unknown'], ['So far', '≈$0.25']]);
  assert.equal(text(d.querySelector('.req-cost-sentence')),
    '$0.21 billed and ≈$0.04 estimated, plus 1 step with cost unknown. The Requirements budget counts ≈$0.25 of $5.00 this month; the step with cost unknown is not counted.');
  assert.equal(document.activeElement.closest('[role="dialog"]'), d, 'the focus is in the dialog');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(dialogEl(), null, 'Escape closes it');
  assert.equal(document.activeElement, chip, 'and the focus goes back to the chip');
});

test('costSentence: billed only, estimated only, unknown only, weekly, with no limit', () => {
  assert.equal(costSentence(COSTS({ rows: [], billedUsd: 0.21, estimatedUsd: 0, unknownSteps: 0, totalUsd: 0.21, anyEstimated: false })),
    '$0.21 billed. The Requirements budget counts $0.21 of $5.00 this month.');
  assert.equal(costSentence(COSTS({ billedUsd: 0, estimatedUsd: 0.04, unknownSteps: 0, totalUsd: 0.04, limitUsd: null })),
    '≈$0.04 estimated. The Requirements budget counts ≈$0.04 this month.');
  assert.equal(costSentence(COSTS({ billedUsd: 0, estimatedUsd: 0, unknownSteps: 2, totalUsd: 0, anyEstimated: false, resetPeriod: 'weekly' })),
    '2 steps with cost unknown. The Requirements budget counts nothing of $5.00 this week; the 2 steps with cost unknown are not counted.');
  assert.equal(costSentence(COSTS({ billedUsd: 0, estimatedUsd: 0, unknownSteps: 1, totalUsd: 0, anyEstimated: false, limitUsd: null })),
    '1 step with cost unknown. The Requirements budget counts nothing this month; the step with cost unknown is not counted.');
});

test('cost chip: plain "$0.25 so far" without an estimate; a costs read that fails says so and opens nothing', async () => {
  const { host, msgEl } = await openFeature({ f: F9({ anyEstimated: false, costUsd: 0.25 }) });
  assert.equal(text(host.querySelector('[data-ui="cost-chip"]')), '$0.25 so far');
  host.querySelector('[data-ui="cost-chip"]').click();
  await settle();
  assert.equal(dialogEl(), null);
  assert.equal(text(msgEl), 'The costs could not be loaded. Try again.');
});

test('code look: no old name is left in what the feature page shows', async () => {
  const OLD = /closer look|look at the code|looked at the code|looking at the code|found in the code/i;
  const brief = { id: 3, status: 'ready', madeAt: new Date(Date.now() - 2 * 864e5).toISOString(), sources: [], matches: ['Orders'], matchesMore: 0, lookAtCode: true };
  const variants = [
    F9({ orientation: null }),
    F9({ orientation: { summary: '', files: [], skipped: 'off' } }),
    F9({ orientation: { summary: '', files: [], skipped: 'no-git' } }),
    F9({ orientation: { summary: '', files: [], skipped: 'failed' } }),
    F9({ orientation: { summary: '', files: [], skipped: 'brief' } }),
    F9({ brief, lookCostUsd: 0.2, orientation: { summary: '', files: [], skipped: 'brief' } }),
    F9({ brief, lookCostUsd: 0.2, orientation: { summary: 'Orders live in orders.js.', files: ['/o.js'], skipped: null, scopeType: 'project', scopeKey: 'shop-1', briefId: 3 } }),
    F9({ brief, orientation: { summary: '', files: [], skipped: 'failed' } }),
  ];
  for (const f of variants) {
    const { host } = await openFeature({ f, turns: [lookTurn(1)] });
    assert.ok(!OLD.test(host.textContent), `${JSON.stringify(f.orientation)}: ${(host.textContent.match(OLD) || [])[0]}`);
  }
});

test('styles: the step rows, notices, error and cost dialog rules sit inside the Requirements block with tokens only', () => {
  const css = readStyleCss();
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const s of ['.req-step-meta', '.req-step-notices', '.req-error-title', '.req-cost-dialog', '.req-cost-chip']) {
    const at = css.indexOf(s);
    assert.ok(at > start && at < end, `${s} inside the Requirements block`);
  }
  const lines = css.slice(start, end).split('\n').filter((l) => /req-step-|req-error-|req-cost-|req-file-skipped/.test(l));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), 'tokens only');
});

test('cost chip: "Cost unknown so far" when every step is unknown; money with unknown parts keeps the money; no steps keeps $0.00', async () => {
  const chip = async (o) => text((await openFeature({ f: F9(o) })).host.querySelector('[data-ui="cost-chip"]'));
  assert.equal(await chip({ costUsd: 0, unknownSteps: 2 }), 'Cost unknown so far');
  assert.equal(await chip({ costUsd: 0.25, unknownSteps: 1, anyEstimated: true }), '≈$0.25 so far');
  assert.equal(await chip({ costUsd: 0.1, unknownSteps: 1 }), '$0.10 so far');
  assert.equal(await chip({ costUsd: 0, unknownSteps: 0 }), '$0.00 so far');
});

test('cost dialog: "So far" says "cost unknown" when the total is 0 and steps are unknown', async () => {
  const data = COSTS({ rows: [{ step: 'round', label: 'Round 1', ranOn: 'GPT-5.6 Sol on OpenAI Codex', usd: null, kind: 'unknown' }], billedUsd: 0, estimatedUsd: 0, unknownSteps: 1, totalUsd: 0, anyEstimated: false });
  const { host } = await openFeature({ f: F9({ costUsd: 0, unknownSteps: 1 }), extra: { 'GET /api/requirements/4/costs': data } });
  host.querySelector('[data-ui="cost-chip"]').click();
  await settle();
  const last = [...dialogEl().querySelectorAll('tbody tr')].at(-1);
  assert.deepEqual([...last.children].map((c) => text(c)), ['So far', 'cost unknown']);
  assert.ok(!/\$0\.00/.test(dialogEl().textContent), dialogEl().textContent);
});

// ---- 9c fix B2: the brief chip names the cost of the make that made it, in the cost words ----
test('B2: the brief chip says the last make\'s cost: "cost unknown" for a Copilot make, never the old Claude cost or $0.00', async () => {
  const chip = async (brief, madeWith) => {
    const { host } = await openBrief9(briefBody9({ brief: madeBrief9(brief), madeWith }));
    return [...host.querySelectorAll('.req-brief-chips > *')].map(text);
  };
  const cop = { engine: 'copilot', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' };
  // refreshed on Copilot after a $0.09 Claude make: the brief cost $0.09 in all, this make's cost is unknown
  let chips = await chip({ engine: 'copilot', model: 'claude-sonnet-5-5', costUsd: 0.0946, madeCostUsd: 0, madeCostKind: 'unknown' }, cop);
  assert.ok(chips.includes('Claude Sonnet 5.5 on GitHub Copilot · cost unknown'), chips.join(' | '));
  chips = await chip({ engine: 'copilot', model: 'claude-sonnet-5-5', costUsd: 0, madeCostUsd: 0, madeCostKind: 'unknown' }, cop);
  assert.ok(chips.includes('Claude Sonnet 5.5 on GitHub Copilot · cost unknown'), chips.join(' | '));
  chips = await chip({ engine: 'codex', model: 'gpt-sol', costUsd: 0.5, madeCostUsd: 0.04, madeCostKind: 'estimated' }, { engine: 'codex', model: 'gpt-sol', label: 'GPT-5.6 Sol' });
  assert.ok(chips.includes('GPT-5.6 Sol on OpenAI Codex · ≈$0.04'), chips.join(' | '));
  chips = await chip({ costUsd: 0.5, madeCostUsd: 0.0946, madeCostKind: 'billed' }, { engine: 'claude', model: 'claude-opus-5-5', label: 'Opus 5.5' });
  assert.ok(chips.includes('Opus 5.5 on Claude Code · $0.09'), chips.join(' | '));
  // a pre-9c brief (engine NULL, no make cost booked) shows as today
  chips = await chip({ engine: null, costUsd: 0.42, madeCostUsd: null, madeCostKind: null }, { engine: 'claude', model: 'claude-opus-5-5', label: 'Opus 5.5' });
  assert.ok(chips.includes('Opus 5.5 on Claude Code · $0.42'), chips.join(' | '));
});

// ---- 9c fix B3: a catalog that could not be loaded is asked again; a 9c page never shows the pre-9c model line ----
test('B3: the brief box: a failed first models load is asked again on the next visit, and the pre-9c line never shows meanwhile', async () => {
  let fail = true;
  const routes = { ...ROUTES(), 'GET /api/requirements/estimates': BRIEF_ESTIMATES, [`GET ${BRIEF9}`]: briefBody9(),
    'GET /api/requirements/models': () => (fail ? { __fail: true } : CATALOG9) };
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const [path] = url.split('?');
    calls.push({ method, url });
    const hit = routes[`${method} ${path}`];
    const body = typeof hit === 'function' ? hit(Object.fromEntries(new URLSearchParams(url.split('?')[1] || '')), opts) : hit;
    const status = body === undefined ? 404 : body && body.__fail ? 503 : 200;
    return { ok: status < 400, status, json: async () => (status === 200 ? body : { error: 'not ready' }), text: async () => '' };
  };
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  const view = createRequirementsView({ host, subEl: document.createElement('div'), msgEl: document.createElement('p'), deps: { route: () => {} } });
  await view.show('brief/project/shop-1');
  await settle();
  assert.equal(host.querySelector('.req-brief-cost .req-who'), null, 'no models yet');
  assert.equal(host.querySelector('.req-brief-model'), null, 'never the pre-9c "<model> · counts toward your limit" line on a 9c page');
  fail = false;
  await view.show('');
  await settle();
  await view.show('brief/project/shop-1');
  await settle();
  assert.ok(host.querySelector('.req-brief-cost .req-who-harness'), 'the box is there on the next visit');
  assert.equal(calls.filter((c) => c.url === '/api/requirements/models').length, 2);
});

test('B3: the New feature form: a failed models load is asked again on the next visit', async () => {
  let fail = true;
  const routes = ROUTES({ 'GET /api/requirements/models': () => (fail ? undefined : CATALOG) });
  const host = document.createElement('div');
  document.body.replaceChildren(host);
  fakeApi(routes);
  const view = createRequirementsView({ host, subEl: document.createElement('div'), msgEl: document.createElement('p'), deps: { route: () => {} } });
  await view.show('new');
  await settle();
  assert.equal(host.querySelector('.req-who-harness'), null);
  fail = false;
  await view.show('');
  await settle();
  await view.show('new');
  await settle();
  assert.ok(host.querySelector('.req-who-harness'), 'Who interviews is there on the next visit');
});
