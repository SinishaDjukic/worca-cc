// test/ui-project-settings.test.mjs — the project Settings tab cards (plans/cascading-settings-design.md D4, §6, §8 test 11):
// each field shows what it inherits and from where; an override shows "Project"; Save PATCHes only what changed; a 400
// is shown on its card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountProjectSettings } from '../ui/public/project-settings-view.mjs';

const CATALOG = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', engine: 'claude', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];
const VIEW = {
  own: { askMaxTurns: 9, 'run.engine': 'codex' },
  effective: {},
  layers: {
    askMaxTurns: { project: 9, user: 30, team: 12, default: 400 },
    pipelineCostLimitUsd: { user: 5, default: null },
    humanRateUsdPerHour: { team: 80, default: 35 },
    askMaxBudgetUsd: { default: null },
    'run.engine': { project: 'codex', user: 'claude', default: 'claude' },
    'models.codex.steps.planner': { user: { model: 'gpt-5.5', effort: 'low' } },
  },
  roles: [{ key: 'planner', label: 'Plan' }],
};
const tick = () => new Promise((r) => setTimeout(r, 0));

function harness({ settings = () => ({ status: 200, body: VIEW }), patch = () => ({ status: 200, body: VIEW }) } = {}) {
  const { window } = new JSDOM('<!doctype html><div id="host"></div>');
  const calls = [];
  const fetchFn = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method, body: opts.body ? JSON.parse(opts.body) : null });
    const r = String(url).includes('/settings') ? (method === 'PATCH' ? patch(JSON.parse(opts.body)) : settings()) : { status: 200, body: { models: CATALOG } };
    return { ok: r.status < 400, status: r.status, json: async () => r.body };
  };
  const host = window.document.getElementById('host');
  mountProjectSettings(host, { projectKey: 'proj-1', projectDir: '/repos/proj', fetchFn });
  return { window, host, calls };
}
const field = (host, id) => host.querySelector(`[data-setting="${id}"]`);

test('every field says what it inherits and from where; an override shows Project', async () => {
  const { host } = harness();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual([...host.querySelectorAll('.pd-settings-card')].map((c) => c.dataset.card), ['models', 'cost', 'ask', 'context', 'exec', 'pr', 'smartNaming']);
  const turns = field(host, 'askMaxTurns');
  assert.equal(turns.querySelector('.inherit-input').value, '9');
  assert.equal(turns.querySelector('.inherit-input').placeholder, '30 (your setting)');
  assert.equal(turns.querySelector('.inherit-badge').hidden, false);
  assert.equal(field(host, 'pipelineCostLimitUsd').querySelector('.inherit-input').placeholder, '$5.00 (your setting)');
  assert.equal(field(host, 'humanRateUsdPerHour').querySelector('.inherit-input').placeholder, '$80.00 (team default)');
  assert.equal(field(host, 'askMaxBudgetUsd').querySelector('.inherit-input').placeholder, 'no cap (default)');
  const engine = field(host, 'run.engine').querySelector('.inherit-input');
  assert.equal(engine.value, 'codex');
  assert.equal(engine.options[0].textContent, 'Claude (your setting)');
  const plan = field(host, 'models.codex.steps.planner').querySelector('.inherit-model');
  assert.equal(plan.options[0].textContent, 'GPT-5.5 (your setting)');
  assert.equal(field(host, 'models.codex.steps.planner').querySelector('.inherit-effort').options[0].textContent, 'low (your setting)');
  assert.deepEqual([...plan.options].map((o) => o.value), ['', 'gpt-5.5'], 'the Codex card offers Codex models only');
  assert.equal(field(host, 'models.codex.workspaceScan'), null, 'workspace scans are set per user');
});

test('Save sends only what changed; a cleared field is null; a 400 shows on its card', async () => {
  let reply = { status: 200, body: { ...VIEW, own: { 'run.engine': 'codex' } } };
  const { window, host, calls } = harness({ patch: () => reply });
  for (let i = 0; i < 4; i++) await tick();
  const ask = host.querySelector('.pd-settings-card[data-card="ask"]');
  field(host, 'askMaxTurns').querySelector('.inherit-clear').click();
  ask.querySelector('.pd-settings-save').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').at(-1), { url: '/api/projects/proj-1/settings', method: 'PATCH', body: { askMaxTurns: null } });
  assert.equal(window.document.querySelector('.toast.ok .tt').textContent, 'Saved');
  assert.equal(host.querySelector('.pd-settings-card[data-card="ask"] .card-alert'), null);
  assert.equal(field(host, 'askMaxTurns').querySelector('.inherit-input').value, '', 'repainted from the answer: back to inherit');
  reply = { status: 400, body: { error: 'askMaxTurns must be an integer between 1 and 500' } };
  const input = field(host, 'askMaxTurns').querySelector('.inherit-input');
  input.value = '9999';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  host.querySelector('.pd-settings-card[data-card="ask"] .pd-settings-save').click();
  for (let i = 0; i < 4; i++) await tick();
  const alert = host.querySelector('.pd-settings-card[data-card="ask"] .card-alert.err');
  assert.equal(alert.querySelector('.ca-title').textContent, 'Not saved');
  assert.equal(alert.querySelector('.ca-detail').textContent, 'askMaxTurns must be an integer between 1 and 500');
  host.querySelector('.pd-settings-card[data-card="cost"] .pd-settings-save').click();
  for (let i = 0; i < 2; i++) await tick();
  assert.equal(host.querySelector('.pd-settings-card[data-card="cost"] .pd-settings-msg').textContent, 'Nothing changed.');
});

test('a failed read says so instead of painting guesses', async () => {
  const { host } = harness({ settings: () => ({ status: 500, body: { error: 'boom' } }) });
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(host.querySelector('.pd-settings-error .ca-detail').textContent, 'boom');
  assert.equal(host.querySelector('.pd-settings-card'), null);
});

test('the Claude card says its step models apply to the Default workflow only (review I6)', async () => {
  const { host } = harness();
  for (let i = 0; i < 4; i++) await tick();
  const note = host.querySelector('.engine-card[data-engine="claude"] > small.hint');
  assert.equal(note?.textContent, 'Claude step models set here apply to the Default workflow; other workflows keep their own node picks.');
  assert.equal(host.querySelector('.engine-card[data-engine="codex"] > small.hint'), null);
});

test('Smart run naming: pattern and types show what they inherit; Save sends one smartNaming block; Clear returns to inherit', async () => {
  const view = { ...VIEW, own: { ...VIEW.own, smartNaming: { types: ['docs', 'fix'] } },
    layers: { ...VIEW.layers, smartNaming: { project: { types: ['docs', 'fix'] }, user: { pattern: '{type}/{ticket}-{slug}' }, default: { pattern: '{type}/{slug}', types: ['feat', 'fix'] } } } };
  const { host, calls, window } = harness({ settings: () => ({ status: 200, body: view }), patch: () => ({ status: 200, body: view }) });
  for (let i = 0; i < 4; i++) await tick();
  const pattern = field(host, 'smartNaming.pattern'); const types = field(host, 'smartNaming.types');
  assert.equal(pattern.querySelector('.inherit-input').value, '');
  assert.equal(pattern.querySelector('.inherit-input').placeholder, '{type}/{ticket}-{slug} (your setting)');
  assert.equal(types.querySelector('.inherit-input').value, 'docs, fix');
  assert.equal(types.querySelector('.inherit-badge').hidden, false);
  const input = pattern.querySelector('.inherit-input');
  input.value = '{type}/x-{slug}'; input.dispatchEvent(new window.Event('input', { bubbles: true }));
  host.querySelector('[data-card="smartNaming"] .pd-settings-save').click();
  await tick(); await tick();
  const sent = calls.filter((c) => c.method === 'PATCH').pop();
  assert.deepEqual(sent.body, { smartNaming: { types: ['docs', 'fix'], pattern: '{type}/x-{slug}' } });
  const again = field(host, 'smartNaming.types');   // the card repainted from the PATCH answer
  again.querySelector('.inherit-clear').click();
  host.querySelector('[data-card="smartNaming"] .pd-settings-save').click();
  await tick(); await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').pop().body, { smartNaming: null });
});

test('s4: Pull requests › Watch new pull requests reads Off (default) and saves true, then null on Clear', async () => {
  const view = { ...VIEW, own: {}, layers: { ...VIEW.layers, watchNewPrs: { default: false } } };
  const saved = { ...view, own: { watchNewPrs: true }, layers: { ...view.layers, watchNewPrs: { project: true, default: false } } };
  const { window, host, calls } = harness({ settings: () => ({ status: 200, body: view }), patch: (body) => ({ status: 200, body: body.watchNewPrs === true ? saved : view }) });
  for (let i = 0; i < 4; i++) await tick();
  const row = field(host, 'watchNewPrs');
  const select = row.querySelector('.inherit-input');
  assert.deepEqual([...select.options].map((o) => [o.value, o.textContent]), [['', 'Off (default)'], ['on', 'On']]);
  assert.equal(row.querySelector('label').textContent, 'Watch new pull requests');
  select.value = 'on';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  const card = host.querySelector('.pd-settings-card[data-card="pr"]');
  card.querySelector('.pd-settings-save').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').at(-1).body, { watchNewPrs: true });
  const again = field(host, 'watchNewPrs');
  assert.equal(again.querySelector('.inherit-input').value, 'on', 'repainted from the answer');
  assert.equal(again.querySelector('.inherit-badge').hidden, false, 'set here: the Project badge shows');
  again.querySelector('.inherit-clear').click();
  host.querySelector('.pd-settings-card[data-card="pr"] .pd-settings-save').click();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').at(-1).body, { watchNewPrs: null });
});

test('Team memory (memory.team): Local by default; Both saves true, Team "only"; a refusal without origin shows on the card', async () => {
  let reply = { status: 400, body: { error: 'team memory needs an `origin` remote: the team layer lives on its worca-memory branch' } };
  const { window, host, calls } = harness({ patch: () => reply });
  for (let i = 0; i < 4; i++) await tick();
  const select = field(host, 'memory.team').querySelector('.inherit-input');
  assert.deepEqual([select.value, ...[...select.options].map((o) => o.textContent)], ['', 'Local (default)', 'Team: team notes only', 'Both: my notes and the team\'s']);
  select.value = 'both';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  const save = () => host.querySelector('.pd-settings-card[data-card="context"] .pd-settings-save').click();
  save();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').at(-1).body, { 'memory.team': true });
  assert.match(host.querySelector('.pd-settings-card[data-card="context"] .card-alert .ca-detail').textContent, /origin/);
  reply = { status: 200, body: { ...VIEW, own: { ...VIEW.own, 'memory.team': true } } };
  save();
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(field(host, 'memory.team').querySelector('.inherit-input').value, 'both', 'repainted from the answer');
  assert.match(field(host, 'memory.team').textContent, /Switching back to Local drops changes still waiting to be pushed/, 'the Team view\'s switch-off warning, here too (m13)');
  const again = field(host, 'memory.team').querySelector('.inherit-input');
  again.value = 'team';
  again.dispatchEvent(new window.Event('change', { bubbles: true }));
  reply = { status: 200, body: { ...VIEW, own: { ...VIEW.own, 'memory.team': 'only' } } };
  save();
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').at(-1).body, { 'memory.team': 'only' });
  assert.equal(field(host, 'memory.team').querySelector('.inherit-input').value, 'team');
});
