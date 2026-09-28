// test/ui-graph-live-band.test.mjs — the footer's `live` band (script nodes P1b, S4): one mono line,
// keyed by kind so it survives repaints, billed as one footer line. The band is kind-agnostic in the
// view (run-decor decides WHO gets one), so the shared agent fixture is enough.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, fixture, portsFn, AGENTS } from './helpers/graph-view-fixture.mjs';

const viewPath = new URL('../ui/public/graph/view.mjs', import.meta.url).href;

test('setFooter renders a live band as one mono line and updates it in place', async () => {
  const { doc, host } = boot();
  const { createGraphView } = await import(viewPath);
  const view = createGraphView(host, { doc, mode: 'monitor', portsFn, agents: AGENTS });
  view.render(fixture(), {});
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['active'], summary: '1 run' }, { kind: 'live', text: 'npm test …' }]);
  const live = host.querySelector('.node[data-node-id="n_agent"] .xfoot .xlive');
  assert.equal(live.textContent, 'npm test …');
  assert.equal(live.title, 'npm test …');
  view.setFooter('n_agent', [{ kind: 'strip', leds: ['active'], summary: '1 run' }, { kind: 'live', text: '3 failing' }]);
  assert.equal(host.querySelector('.node[data-node-id="n_agent"] .xfoot .xlive'), live, 'the element survives (keyed band)');
  assert.equal(live.textContent, '3 failing');
  assert.equal(live.title, '3 failing');
  assert.equal(view._internals.footers.get('n_agent'), 2, 'a live band bills one footer line');
});
