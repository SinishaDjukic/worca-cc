// test/ui-runs-share-status.test.mjs — the run-sharing status line under Settings › Run sharing (run sharing s1, D23).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderRunsShareStatus } from '../ui/public/runs-share-status.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const base = { enabled: true, flag: true, branch: 'worca-runs', personKey: '0123456789abcdef', lastPushAt: null, lastError: null, lastErrorCode: null, lastErrorAt: null, hint: null, canStart: true, startError: null };

test('a branch-protection rejection says so and how to fix it', () => {
  const el = renderRunsShareStatus(doc, { ...base, lastError: 'remote: protected branch hook declined\nmore', lastErrorCode: 'PUSH_REJECTED', hint: 'exempt `worca-runs` from branch protection' });
  assert.match(el.textContent, /Push rejected · branch protection/);
  assert.match(el.textContent, /To fix: exempt `worca-runs` from branch protection/);
  assert.equal(el.dataset.kind, 'error');
});

test('another error says Push failed and the first line of the error', () => {
  const el = renderRunsShareStatus(doc, { ...base, lastError: 'fatal: no route\nsecond line', lastErrorCode: 'FETCH_FAILED' });
  assert.match(el.textContent, /Push failed/);
  assert.match(el.textContent, /fatal: no route/);
  assert.doesNotMatch(el.textContent, /second line|To fix/);
});

test('a success names the branch and the last push; nothing yet says Not pushed yet', () => {
  const ok = renderRunsShareStatus(doc, { ...base, lastPushAt: '2026-11-07T10:00:00.000Z' });
  assert.match(ok.textContent, /^Branch worca-runs · last push /);
  assert.equal(ok.dataset.kind, 'ok');
  const none = renderRunsShareStatus(doc, base);
  assert.match(none.textContent, /Not pushed yet/);
});
