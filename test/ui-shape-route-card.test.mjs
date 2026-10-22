// test/ui-shape-route-card.test.mjs — the three choices and the label
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderRouteCard } from '../ui/public/shape/route-card.mjs';

const CARD = { type: 'route', text: 'make the legend smaller', featureTitle: 'Charts', hasNext: true,
  guess: { choice: 'add', where: 'next', reason: 'touches "legend", which run 3 changes' } };
const docOf = () => new JSDOM('<!doctype html><body></body>').window.document;

test('the guess is preselected with its reason; the primary names the choice and follows the radio', async () => {
  const d = docOf(); const posted = [];
  const el = renderRouteCard(d, { state: 'proposed', card: CARD }, { onChoose: async (v) => posted.push(v), onNotNow: async () => {} });
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Route');
  assert.equal(el.querySelector('.ask-routecard-guess').textContent, 'Worca\'s guess: Add to Charts (touches "legend", which run 3 changes)');
  assert.equal(el.querySelector('input[value="add"]').checked, true);
  const primary = el.querySelector('.btn-primary');
  assert.equal(primary.textContent, 'Add to Charts');
  el.querySelector('input[value="own"]').click();
  assert.equal(primary.textContent, 'Own run now');
  el.querySelector('input[value="save"]').click();
  assert.equal(primary.textContent, 'Save for later');
  el.querySelector('input[value="add"]').click();
  el.querySelector('.ask-routecard-where').value = 'extra';
  el.querySelector('.ask-routecard-where').dispatchEvent(new d.defaultView.Event('change'));
  primary.click(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posted, [{ verb: 'add', where: 'extra' }]);
});

test('each choice posts its own verb', async () => {
  for (const [value, want] of [['own', { verb: 'own' }], ['save', { verb: 'save' }]]) {
    const d = docOf(); const posted = [];
    const el = renderRouteCard(d, { state: 'proposed', card: CARD }, { onChoose: async (v) => posted.push(v), onNotNow: async () => {} });
    el.querySelector(`input[value="${value}"]`).click();
    el.querySelector('.btn-primary').click(); await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(posted, [want]);
  }
});

test('no run left to plan: the Add select offers only an extra run', () => {
  const el = renderRouteCard(docOf(), { state: 'proposed', card: { ...CARD, hasNext: false } }, { onChoose: async () => {}, onNotNow: async () => {} });
  assert.deepEqual([...el.querySelectorAll('.ask-routecard-where option')].map((o) => o.value), ['extra']);
});
