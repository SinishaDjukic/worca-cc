import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPanelState } from '../extension/src/panel-state.mjs';

test('the panel follows its window active tab; switching deactivates the old tab', () => {
  const s = createPanelState();
  s.open(1);
  assert.deepEqual(s.focus(1, 10), { deactivate: null, activate: 10 });
  assert.ok(s.isActiveTab(10));
  assert.deepEqual(s.focus(1, 11), { deactivate: 10, activate: 11 });
  assert.equal(s.isActiveTab(10), false);
  assert.deepEqual(s.focus(2, 20), { deactivate: null, activate: null });   // no panel in window 2
  assert.equal(s.close(1), 11);
  assert.equal(s.isActiveTab(11), false);
});
test('a pinned tab (test builds: sidebar opened as a tab) ignores activation', () => {
  const s = createPanelState();
  s.open(1, { pinnedTabId: 10 });
  assert.deepEqual(s.focus(1, 99), { deactivate: null, activate: 10 });
  assert.deepEqual(s.focus(1, 98), { deactivate: null, activate: null });
});

// ---- a capture asked for before the tab's content script is up (the shortcut opened the sidebar first, D13)
import { createPendingCaptures } from '../extension/src/panel-state.mjs';
test('pending captures: taken once, expire after the TTL, per tab', () => {
  let t = 1000;
  const p = createPendingCaptures({ now: () => t, ttlMs: 100 });
  assert.equal(p.take(7), false);
  p.set(7); p.set(8);
  assert.equal(p.take(7), true);
  assert.equal(p.take(7), false);        // once
  t += 101;
  assert.equal(p.take(8), false);        // expired
  p.set(9); t += 100;
  assert.equal(p.take(9), true);         // exactly at the TTL still counts
});
