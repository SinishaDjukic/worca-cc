// test/ui-polish-cdp.test.mjs — the pure parts of tools/ui-polish-cdp.mjs (UI/UX review 2026-10-19, D23): the screens it
// visits, the theme × width matrix and the before/after Markdown table. The run itself needs Chrome (not in npm test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCREENS, MATRIX, table } from '../tools/ui-polish-cdp.mjs';

test('SCREENS: the 9 review screens plus a feature card and a Ship card; MATRIX gives 66 combinations', () => {
  assert.equal(SCREENS.length, 11);
  assert.deepEqual(SCREENS.map((s) => s.key), ['chat', 'new-run', 'runs', 'run-page', 'group-page', 'schedules', 'workflows',
    'statistics', 'settings', 'feature-card', 'ship-card']);
  for (const s of SCREENS) assert.match(s.hash, /^#/);
  assert.equal(SCREENS.length * MATRIX.themes.length * MATRIX.widths.length, 66);
});

test('SCREENS: the card screens wait for the real Shaper feature card and Ship card, never a generic run card', () => {
  const by = Object.fromEntries(SCREENS.map((s) => [s.key, s]));
  assert.equal(by['feature-card'].ready, '.chat-home-plan .shape-feature');
  assert.equal(by['feature-card'].prep, 'open-plan', 'the feature card lives in Chat › Plans, opened');
  assert.equal(by['ship-card'].ready, '.ask-card[data-ship-card="ready"]');
  assert.equal(by['run-page'].also.ready, '.hd-tabs [role="tab"]', 'the saved run page is measured in Details too, where its tabs are');
  for (const s of [...SCREENS, ...SCREENS.map((x) => x.also).filter(Boolean)]) assert.equal(typeof s.ready, 'string', `${s.key || s.hash} names what must be on screen before the audit`);
});

test('table: one row per screen x theme x width, before → after, "–" for a missing after', () => {
  const before = [];
  for (const { key } of SCREENS) for (const theme of MATRIX.themes) for (const width of MATRIX.widths) before.push({ screen: key, theme, width, violations: 3 });
  const after = before.slice(1).map((m) => ({ ...m, violations: 0 }));
  const lines = table(before, after).split('\n');
  assert.equal(lines[0], '| Screen | Theme | Width | Violations before | after |');
  assert.equal(lines.length, 2 + 66);
  assert.equal(lines[2], '| chat | light | 1280 | 3 | – |', 'the first combination has no after');
  assert.equal(lines[3], '| chat | light | 375 | 3 | 0 |');
});
