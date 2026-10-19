// test/ui-runs-scale.test.mjs — spec §5a.8 / Known bug "large lists stay fast": 300 runs in 20 groups build, render
// and update within budget. Measured 2026-10-19 on the dev machine: build 18–34 ms, render 87–125 ms (320 rows).
// The budgets are ~8x that, best of 3, so full-suite load does not flake them.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildRunsModel, renderRunsList } from '../ui/public/runs-list.mjs';
import { scaleRuns } from './helpers/runs-scale.mjs';
import { NOW } from './helpers/run-states.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const BUILD_MS = 250;
const RENDER_MS = 1000;
const UPDATE_MS = 1000;
const best = (n, fn) => Math.min(...Array.from({ length: n }, () => { const t = performance.now(); fn(); return performance.now() - t; }));

test('300 runs / 20 groups: every run is listed once and the build fits the budget', () => {
  const input = scaleRuns();
  const members = input.groups.reduce((n, g) => n + g.members.length, 0);
  assert.equal(input.live.length + input.history.length - 20 * 4 + members, 300, '200 single runs + 100 group members');
  assert.equal(input.groups.length, 20);
  let model;
  const ms = best(3, () => { model = buildRunsModel({ ...input, recentShown: 1000, now: NOW }); });
  const rows = model.sections.flatMap((s) => s.rows);
  assert.equal(rows.filter((r) => r.kind === 'chain').length, 20);
  assert.equal(rows.length, 220, '200 single rows + 20 group rows (members fold into their group)');
  assert.ok(ms < BUILD_MS, `build took ${ms.toFixed(0)} ms (budget ${BUILD_MS})`);
});

test('300 runs / 20 groups render, and an update of 10 runs repaints, within budget', () => {
  const doc = trackDom(new JSDOM('<!doctype html><body><div id="h"></div></body>')).window.document;
  const host = doc.getElementById('h');
  const model = buildRunsModel({ ...scaleRuns(), recentShown: 1000, now: NOW });
  const render = best(3, () => host.replaceChildren(...renderRunsList(doc, model)));
  assert.equal(host.querySelectorAll('.runs-row').length, 320, '220 rows + 100 expanded members');
  assert.ok(render < RENDER_MS, `render took ${render.toFixed(0)} ms (budget ${RENDER_MS})`);
  const update = best(3, () => {
    const m2 = buildRunsModel({ ...scaleRuns({ shift: 1 }), recentShown: 1000, now: NOW });
    host.replaceChildren(...renderRunsList(doc, m2));
  });
  assert.ok(update < UPDATE_MS, `update took ${update.toFixed(0)} ms (budget ${UPDATE_MS})`);
});
