// test/readiness-e2e.test.mjs — tools/readiness/e2e.mjs: Playwright JSON → statuses, and the before/after judgement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testResults, judgeSameResults, e2eScripts, SAME_RESULTS, e2eRow, CI_ONLY, FIREFOX_CI_JOB } from '../tools/readiness/e2e.mjs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';

const png = (v) => encodePNG(1, 1, new Uint8Array([v, v, v]));
const rep = (st) => ({ suites: [{ title: 'visual.spec.mjs', specs: [{ title: 'sidebar light', tests: [{ projectName: '', status: st }] }],
  suites: [{ title: 'chat', specs: [{ title: 'sends', tests: [{ projectName: '', status: 'expected' }] }] }] }] });

test('testResults flattens nested suites to "file › suite › spec" → status', () => {
  assert.deepEqual(testResults(rep('unexpected')), { 'visual.spec.mjs › sidebar light': 'unexpected', 'visual.spec.mjs › chat › sends': 'expected' });
});
test('same statuses and pixel-identical images: same; one status or one pixel off: not same, named', () => {
  const imgs = { 'visual-sidebar/a-actual.png': png(1) };
  const side = (st, v = 1) => ({ results: testResults(rep(st)), images: Object.keys(imgs), read: () => png(v) });
  const j = judgeSameResults(side('unexpected'), side('unexpected'));
  assert.deepEqual([j.same, j.pass, j.fail, j.images], [true, 1, 1, 1]);
  assert.match(judgeSameResults(side('unexpected'), side('expected')).problems[0], /sidebar light: unexpected before, expected after/);
  assert.match(judgeSameResults(side('unexpected'), side('unexpected', 2)).problems[0], /a-actual\.png: 1 px differ/);
});
test('no results on a side is never "same" (a suite that did not run proves nothing)', () => {
  assert.equal(judgeSameResults({ results: null, images: [] }, { results: null, images: [] }).same, false);
});
test('e2e:extension is the one same-results suite; e2eScripts still drops the updaters', () => {
  assert.deepEqual([...SAME_RESULTS], ['e2e:extension']);
  assert.deepEqual(e2eScripts({ 'e2e:extension': 'x', 'e2e:extension:update-linux': 'y', 'e2e:firefox-smoke': 'z' }), ['e2e:extension', 'e2e:firefox-smoke']);
});
test('ciOnly: e2e:firefox-smoke is not run locally, never counts as a pass, and is named with its CI job', () => {
  const calls = [];
  const d = { scripts: () => ({ 'e2e:firefox-smoke': 'node tools/firefox-smoke.mjs', 'e2e:other': 'node x.mjs' }),
    runLogged: (c, a) => { calls.push(a[1]); return { code: 0, text: '' }; } };
  const r = e2eRow(d, '/before', '/after', 'i-e2e', (f) => `/ev/${f}`, new Map(), { ciOnly: CI_ONLY });
  assert.deepEqual(calls, ['e2e:other'], 'the CI-only suite never runs here');
  assert.equal(r.ok, true, 'the local suites decide the row');
  assert.deepEqual(r.notLocal, [{ name: 'e2e:firefox-smoke', ci: FIREFOX_CI_JOB }]);
  assert.deepEqual(r.list.find((x) => x.name === 'e2e:firefox-smoke'), { name: 'e2e:firefox-smoke', mode: 'ci', ok: null, ci: FIREFOX_CI_JOB, logs: [] });
  assert.match(r.text, /e2e:firefox-smoke: CI job firefox-e2e, not run locally/);
  assert.doesNotMatch(r.text, /e2e:firefox-smoke (green|same)/);
  // without ciOnly the suite runs (and a local hang still fails the row)
  calls.length = 0; e2eRow(d, '/b', '/a', 't', (f) => f, new Map());
  assert.deepEqual(calls, ['e2e:firefox-smoke', 'e2e:other']);
});
test('a row whose only suites are CI-only is not ok: nothing ran locally', () => {
  const d = { scripts: () => ({ 'e2e:firefox-smoke': 'x' }), runLogged: () => ({ code: 0, text: '' }) };
  assert.equal(e2eRow(d, '/b', '/a', 't', (f) => f, new Map(), { ciOnly: CI_ONLY }).ok, false);
});
test('with a memo, two rows on the same before tree run the before suite once', () => {
  const cwds = [];
  const d = { scripts: () => ({ 'e2e:extension': 'node x.mjs' }), runLogged: (c, a, f, o) => { cwds.push(o.cwd); return { code: 0, text: '' }; } };
  const memo = new Map();
  e2eRow(d, '/before', '/split', 'i-e2e', (f) => `/ev/${f}`, memo);
  e2eRow(d, '/before', '/split', 'k-e2e', (f) => `/ev/${f}`, memo);
  assert.equal(cwds.filter((c) => c === '/before').length, 1);
  assert.equal(cwds.filter((c) => c === '/split').length, 2);
});
