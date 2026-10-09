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
  assert.deepEqual([...host.querySelectorAll('.pd-settings-card')].map((c) => c.dataset.card), ['models', 'cost', 'ask', 'context']);
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
