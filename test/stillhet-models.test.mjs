// test/stillhet-models.test.mjs — "Would…" stays in the prototype host's demo adapter (ui/public/stillhet/demo/demo-actions.js;
// test/stillhet-demo-actions.test.mjs guards ui/public/stillhet/). This extends the scan to the library the app host loads
// (ui/public/design-system/components/, bundled into components.js), and checks that an action the library cannot take
// (a `would` phrase in run-state.mjs) is said through the host: the demo sentence in the prototype, the refusal in the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as R from '../ui/public/design-system/components/index.mjs';

const LIB = new URL('../ui/public/design-system/components/', import.meta.url);
const NOT_CONNECTED = 'Not connected to Worca yet.';
const HOSTS = { prototype: (p) => 'Would ' + p, app: () => NOT_CONNECTED };
const CTX = { pr: '#1', pr2: '#2', pr3: '#3', base: 'main', branch: 'feat/x', groupBranch: 'feat/x', source: 'feat/s', hidden: 'worca/run-1', folder: '~/x', n: 3 };

test('"Would" appears in no library file the app host loads', () => {
  const hits = readdirSync(LIB).filter((f) => /\.(mjs|js)$/.test(f) && /\bWould\b/.test(readFileSync(new URL(f, LIB), 'utf8')));
  assert.deepEqual(hits, []);
});

const wouldActions = (would) => R.stateIds().flatMap((id) => Object.entries(R.actionFlow(id, { ...CTX, would }))
  .filter(([, f]) => f && typeof f === 'object' && f.would).map(([label, f]) => ({ id, label, f })));

test('every action the library cannot take is said through the host: the demo sentence, or the one refusal', () => {
  const proto = wouldActions(HOSTS.prototype), app = wouldActions(HOSTS.app);
  assert.ok(proto.length >= 20, `${proto.length} would-actions`);
  for (const { id, label, f } of proto) assert.equal(f.say, 'Would ' + f.would, `${id}: ${label}`);
  for (const { id, label, f } of app) assert.equal(f.say, NOT_CONNECTED, `${id}: ${label}`);
  assert.equal(R.actionFlow('paused-budget', { ...CTX, would: HOSTS.prototype })['Open Settings'].say, 'Would open Settings › Tasks › Budget; Resume opens once there is room');
});

test('the run page model says the app host\'s refusal for "Open Settings" on a budget pause, never "Would…"', () => {
  for (const [host, would] of Object.entries(HOSTS)) {
    const window = { RailUI: R, RailWould: would };
    vm.runInNewContext(readFileSync(new URL('../ui/public/stillhet/runs/run-page-model.js', import.meta.url), 'utf8'), { window, console, Math, Object, String, Set, JSON, parseFloat, Error });
    const say = window.RunCardModel.view('paused-budget', {}).flow['Open Settings'].say;
    assert.equal(say, host === 'app' ? NOT_CONNECTED : 'Would open Settings › Tasks › Budget; Resume opens once there is room');
  }
});
