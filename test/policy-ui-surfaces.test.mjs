// test/policy-ui-surfaces.test.mjs
// Team-policy rows on the existing Settings surfaces (team-policy design §8): the Guardrails list
// (a blue "policy" badge, read-only like a built-in) and the Models list ("From team policy").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderGuardrailList, renderGuardrailEditor, isReadOnlyGuardrailSet } from '../ui/public/guardrails-view.mjs';
import { renderModelsList } from '../ui/public/models-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const settings = { honorProjectSettings: true, envScrub: false, envAllowlist: [], protectedPaths: ['.env*'], deny: ['Bash(git push)'] };

test('guardrails: a policy set carries a blue policy badge and no Delete; built-ins and user sets unchanged', () => {
  const list = renderGuardrailList([
    { id: 'normal', name: 'Normal', origin: 'builtin', settings },
    { id: 'gp:gateway-normal', name: 'Gateway normal', origin: 'policy:acme/gateway', settings },
    { id: 'gr_mine', name: 'Mine', origin: null, settings },
  ], { doc });
  const cards = [...list.querySelectorAll('.grv-card')];
  const pol = cards[1];
  assert.equal(pol.querySelector('.grv-origin').className, 'badge blue grv-origin');
  assert.equal(pol.querySelector('.grv-origin').textContent, 'policy');
  assert.match(pol.querySelector('.grv-origin').title, /acme\/gateway/);
  assert.equal(pol.querySelector('.grv-delete'), null);
  assert.equal(pol.querySelector('.grv-details').title, 'View');
  assert.equal(cards[0].querySelector('.grv-origin').textContent, 'built-in');
  assert.ok(cards[2].querySelector('.grv-delete'), 'a user set keeps Delete');
  assert.equal(isReadOnlyGuardrailSet({ origin: 'policy:x' }), true);
  assert.equal(isReadOnlyGuardrailSet({ origin: 'plugin:x' }), false);
  const view = renderGuardrailEditor({ id: 'gp:gateway-normal', name: 'Gateway normal', origin: 'policy:acme/gateway', settings }, { mode: 'view', doc });
  assert.equal(view.querySelector('.grv-origin').textContent, 'policy', 'the read-only editor names its origin');
});

test('models: a "From team policy" section with read-only policy rows', () => {
  const root = renderModelsList({
    globals: [], plugins: [], predefined: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }], efforts: ['medium', 'high', 'xhigh', 'max'],
    policy: [{ id: 'acme-proxy-opus', label: 'Opus via Acme gateway', efforts: ['medium', 'high'], env: { ANTHROPIC_BASE_URL: 'https://llm', ANTHROPIC_AUTH_TOKEN: '${T}' }, home: 'acme/gateway' }],
  }, { doc });
  const titles = [...root.querySelectorAll('.mv-section-title')].map((x) => x.textContent);
  assert.deepEqual(titles, ['Your models', 'From team policy', 'Built-in models']);
  const card = root.querySelector('.mv-policy');
  assert.equal(card.querySelector('.mv-origin').className, 'badge blue mv-origin');
  assert.ok(card.querySelector('.mv-routed'), 'endpoint-routed disclosure');
  assert.match(card.querySelector('.mv-summary').textContent, /acme-proxy-opus — medium · high — 2 env vars · routes via base URL — policy acme\/gateway/);
  assert.equal(card.querySelector('.mv-delete'), null); assert.equal(card.querySelector('.mv-edit'), null);
  assert.ok(card.querySelector('.mv-test'));
  const none = renderModelsList({ globals: [], plugins: [], predefined: [], efforts: [] }, { doc });
  assert.ok(![...none.querySelectorAll('.mv-section-title')].some((x) => x.textContent === 'From team policy'));
});
