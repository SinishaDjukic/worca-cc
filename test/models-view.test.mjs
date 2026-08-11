// test/models-view.test.mjs — pure jsdom tests for the Models-view renderers
// (configurable-models-design.md §4.10). No app.js boot: every renderer takes
// `doc` explicitly and returns detached DOM (guardrails-view test pattern).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  effortsSummary, envSummary, renderModelsList, renderModelEditor,
  collectModelEditor, makeEnvRow, deleteRefsSummary,
} from '../ui/public/models-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const EFFORTS = ['medium', 'high', 'xhigh', 'max'];
const PREDEFINED = [
  { id: 'claude-opus-5', label: 'Opus 5', efforts: EFFORTS },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'] },
];
const GLOBAL = {
  id: 'glm-4.7', label: 'GLM (proxy)', efforts: ['medium', 'high'],
  env: { ANTHROPIC_BASE_URL: '••••••e/v1', ANTHROPIC_AUTH_TOKEN: '••••••1234', X_REF: '${MY_VAR}' },
};
const SHADOW = { id: 'claude-sonnet-4-6', label: 'Sonnet via proxy', efforts: ['medium'], env: { ANTHROPIC_BASE_URL: '••••••e/v1' } };

test('effortsSummary/envSummary', () => {
  assert.equal(effortsSummary(EFFORTS, EFFORTS), 'all efforts');
  assert.equal(effortsSummary([], EFFORTS), 'all efforts');
  assert.equal(effortsSummary(['medium', 'high'], EFFORTS), 'medium · high');
  assert.equal(envSummary(undefined), '');
  assert.equal(envSummary({ A: '1' }), '1 env var');
  assert.equal(envSummary({ ANTHROPIC_BASE_URL: 'x', T: 'y' }), '2 env vars · routes via base URL');
});

test('list: global cards get Edit/Delete + shadow badge; legacy get Promote; built-ins read-only + overridden badge', () => {
  const el = renderModelsList({
    globals: [GLOBAL, SHADOW],
    legacy: [{ id: 'old-local', label: 'Old Local' }],
    predefined: PREDEFINED,
    efforts: EFFORTS,
    projectName: 'my-repo',
  }, { doc });

  const cards = el.querySelectorAll('.mv-card:not(.mv-legacy)');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].dataset.id, 'glm-4.7');
  assert.equal(cards[0].querySelector('.mv-shadow'), null, 'non-shadow entry has no override badge');
  assert.ok(cards[0].querySelector('.mv-edit'));
  assert.ok(cards[0].querySelector('.mv-delete'));
  assert.match(cards[0].querySelector('.mv-summary').textContent, /3 env vars · routes via base URL/);
  assert.equal(cards[1].querySelector('.mv-shadow').textContent, 'overrides built-in');

  const legacy = el.querySelectorAll('.mv-legacy');
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].querySelector('.mv-origin').textContent, 'project (legacy)');
  assert.equal(legacy[0].querySelector('.mv-promote').dataset.id, 'old-local');

  const builtins = el.querySelectorAll('.mv-builtin');
  assert.equal(builtins.length, 2);
  assert.equal(builtins[0].querySelector('.mv-shadowed'), null);
  assert.equal(builtins[1].querySelector('.mv-shadowed').textContent, 'overridden', 'sonnet is overridden by SHADOW');
  assert.equal(builtins[0].querySelector('button'), null, 'built-ins carry no actions');
});

test('editor (create): id enabled, all efforts pre-checked, no env rows', () => {
  const el = renderModelEditor(null, EFFORTS, { doc });
  assert.equal(el.dataset.mode, 'create');
  assert.equal(el.querySelector('.mv-id').disabled, false);
  const cbs = [...el.querySelectorAll('.mv-effort-cb')];
  assert.equal(cbs.length, 4);
  assert.ok(cbs.every((c) => c.checked));
  assert.equal(el.querySelectorAll('.mv-env-row').length, 0);
  assert.ok(el.querySelector('.mv-save'));
  assert.ok(el.querySelector('.mv-cancel'));
});

test('editor (edit): id locked, efforts reflect the entry, masked env rows carry data-original', () => {
  const el = renderModelEditor(GLOBAL, EFFORTS, { doc });
  assert.equal(el.dataset.mode, 'edit');
  assert.equal(el.dataset.id, 'glm-4.7');
  assert.equal(el.querySelector('.mv-id').disabled, true);
  assert.deepEqual(
    [...el.querySelectorAll('.mv-effort-cb')].filter((c) => c.checked).map((c) => c.value),
    ['medium', 'high'],
  );
  const rows = [...el.querySelectorAll('.mv-env-row')];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.mv-env-val').value, '••••••e/v1');
  assert.equal(rows[0].querySelector('.mv-env-val').dataset.original, '••••••e/v1');
  assert.equal(el.dataset.envKeys, 'ANTHROPIC_BASE_URL\nANTHROPIC_AUTH_TOKEN\nX_REF');
});

test('collect (create): id from input, partial efforts, env rows as typed; full effort set collapses to []', () => {
  const el = renderModelEditor(null, EFFORTS, { doc });
  el.querySelector('.mv-id').value = '  my-model  ';
  el.querySelector('.mv-label').value = 'Mine';
  el.querySelector('.mv-efforts').appendChild(makeEnvRow({ doc })); // noop guard: env rows live in .mv-env
  el.querySelector('.mv-env').appendChild(makeEnvRow({ doc }));
  const row = el.querySelector('.mv-env .mv-env-row');
  row.querySelector('.mv-env-key').value = 'ANTHROPIC_BASE_URL';
  row.querySelector('.mv-env-val').value = 'https://x';

  let { id, body } = collectModelEditor(el);
  assert.equal(id, null);
  assert.deepEqual(body, { id: 'my-model', label: 'Mine', efforts: [], env: { ANTHROPIC_BASE_URL: 'https://x' } });

  // Uncheck one effort -> the subset is sent.
  el.querySelector('.mv-effort-cb[value="max"]').checked = false;
  ({ body } = collectModelEditor(el));
  assert.deepEqual(body.efforts, ['medium', 'high', 'xhigh']);
});

test('collect (edit): removed env rows become null-deletes; kept masked values are echoed', () => {
  const el = renderModelEditor(GLOBAL, EFFORTS, { doc });
  // Remove the token row entirely; change the base URL; keep X_REF untouched.
  const rows = [...el.querySelectorAll('.mv-env-row')];
  rows[1].remove(); // ANTHROPIC_AUTH_TOKEN
  rows[0].querySelector('.mv-env-val').value = 'https://new.example';

  const { id, body } = collectModelEditor(el);
  assert.equal(id, 'glm-4.7');
  assert.equal(body.env.ANTHROPIC_BASE_URL, 'https://new.example');
  assert.equal(body.env.ANTHROPIC_AUTH_TOKEN, null, 'removed row -> null delete');
  assert.equal(body.env.X_REF, '${MY_VAR}', 'untouched value echoed (server keeps refs readable)');
});

test('deleteRefsSummary wording', () => {
  assert.match(deleteRefsSummary('x', { predefinedShadow: true }), /Remove the override/);
  assert.match(deleteRefsSummary('x', { predefinedShadow: false, nodes: [], steps: [] }), /No pipeline configuration references it/);
  const refs = {
    predefinedShadow: false,
    nodes: [{ projectKey: 'a', workflowId: 'w', nodeId: 'n' }, { projectKey: 'b', workflowId: 'w', nodeId: 'n' }],
    steps: [{ projectKey: 'a', step: 'implementer' }],
  };
  assert.match(deleteRefsSummary('x', refs), /2 node selections and 1 role selection across 2 projects/);
});
