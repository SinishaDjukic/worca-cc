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
const { whoInterviews, recommendationNote, defaultLine, fallbackLine } = await import('../ui/public/requirements-model.mjs');
const { setEngineLocks } = await import('../ui/public/engine-locks.mjs');

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const H = (engine, choiceLabel, over = {}) => ({ engine, label: choiceLabel.replace(/ \(beta\)/, ''), choiceLabel, ready: true, short: null, reason: null, broker: false,
  repo: true, files: false, keepsCopy: false, reportsCost: true, company: null, ...over });
const HARNESSES = [
  H('claude', 'Claude', { files: true }),
  H('codex', 'Codex (beta)'),
  H('copilot', 'Copilot (beta)', { ready: false, short: 'Not installed', reason: 'cannot run copilot (ENOENT)' }),
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
    ['claude', 'Claude', false],
    ['codex', 'Codex (beta)', false],
    ['copilot', 'Copilot (beta) · Not installed', true],
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
  assert.equal(o.textContent, 'Codex (beta): off while the credential broker is on');
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
  const labels = { harness: 'Claude', picked: 'Sonnet 5.5', recommended: 'Opus 5.5' };
  const other = recommendationNote(document, { picked: 'claude-sonnet-5-5', recommended: 'claude-opus-5-5', estimates: ESTIMATES['claude-sonnet-5-5'], labels, onUse: () => { used += 1; } });
  assert.ok(other.classList.contains('hint'));
  assert.ok(other.querySelector('svg'), 'the info icon');
  assert.equal(text(other), 'Requirements work best with a strong model, like Opus 5.5 on Claude: about $0.16 for a code look, about $0.03 a round. '
    + 'You picked Sonnet 5.5: about $0.09 for a code look, about $0.02 a round. Use Opus 5.5');
  const use = other.querySelector('button');
  assert.equal(use.textContent, 'Use Opus 5.5');
  use.click();
  assert.equal(used, 1);
  const same = recommendationNote(document, { picked: 'claude-opus-5-5', recommended: 'claude-opus-5-5', estimates: ESTIMATES['claude-opus-5-5'], labels: { ...labels, picked: 'Opus 5.5' } });
  assert.equal(text(same), 'Requirements work best with a strong model, like Opus 5.5 on Claude: about $0.16 for a code look, about $0.03 a round.');
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
  assert.equal(mixed.getAttribute('aria-live'), 'polite');
});

test('defaultLine: only when the choice differs from the default; fallbackLine: the grey D4 line', () => {
  const dc = { engine: 'claude', model: 'claude-sonnet-5-5', effort: 'medium' };
  const labels = { model: 'Sonnet 5.5', harness: 'Claude' };
  assert.equal(defaultLine(document, { choice: dc, defaultChoice: dc, labels }), null);
  let used = 0;
  const l = defaultLine(document, { choice: { engine: 'codex', model: 'gpt-sol', effort: null }, defaultChoice: dc, labels, onUse: () => { used += 1; } });
  assert.equal(text(l), 'Your default: Sonnet 5.5 on Claude. Use the default');
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
  assert.equal(text(host.querySelector('.req-new-note')), 'Requirements work best with a strong model, like Opus 5.5 on Claude: about $0.16 for a code look, about $0.03 a round. '
    + 'You picked Sonnet 5.5: about $0.09 for a code look, about $0.02 a round. Use Opus 5.5');
  assert.ok(calls.some((c) => c.url === '/api/requirements/estimates?engine=claude&model=claude-sonnet-5-5'));
  host.querySelector('.req-new-use').click();
  await settle();
  assert.equal(sel(host, 'model').value, 'claude-opus-5-5');
  assert.ok(calls.some((c) => c.url === '/api/requirements/estimates?engine=claude&model=claude-opus-5-5'));
  assert.equal(text(host.querySelector('.req-new-note')), 'Requirements work best with a strong model, like Opus 5.5 on Claude: about $0.16 for a code look, about $0.03 a round.');
  assert.equal(host.querySelector('.req-new-note .req-new-use'), null);
});

test('New feature: choosing another harness refills Model, shows Your default and the harness line, and the note follows', async () => {
  const { host } = await openNew();
  assert.equal(host.querySelector('.req-new-default'), null, 'the default is chosen: no line');
  await pickValue(sel(host, 'harness'), 'codex');
  assert.equal(sel(host, 'model').value, 'gpt-lite');
  assert.equal(sel(host, 'effort').value, '');
  assert.equal(text(host.querySelector('.req-new-default')), 'Your default: Sonnet 5.5 on Claude. Use the default');
  assert.equal(text(host.querySelector('.req-new-harness')), 'Codex reads the repo read-only. Files go to it as text.');
  await pickValue(sel(host, 'model'), 'gpt-sol');
  assert.equal(text(host.querySelector('.req-new-note')), 'Requirements work best with a strong model, like GPT-5.6 Sol on Codex: about $0.12 for a code look, about $0.02 a round.');
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

test('New feature (board 7): a fallback reason shows the grey line and the form sits on Claude', async () => {
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
    'Worca sends each file to GPT-5.6 Sol on Codex to read it. Text is checked for keys and passwords first. Codex gets files as text: PDFs and images are skipped.');
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
