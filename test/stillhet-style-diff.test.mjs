// test/stillhet-style-diff.test.mjs — the pure parts of tools/stillhet-style-diff.mjs, and its usage exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { diffStyles, ROUTES, ACCEPTED } from '../tools/stillhet-style-diff.mjs';

const dump = (color = 'red') => ({ 'r|dark|1280': { 'div:0': { color, width: '10px' }, 'p:1': { color: 'blue' } } });

test('diffStyles: [] for equal dumps, one row per changed property, a row for an element on one side only', () => {
  assert.deepEqual(diffStyles(dump(), dump()), []);
  const rows = diffStyles(dump('red'), dump('green'));
  assert.equal(rows.length, 1, 'a seeded regression is exactly one row');
  assert.deepEqual(rows[0], { route: 'r', theme: 'dark', width: '1280', path: 'div:0', prop: 'color', dev: 'red', slice: 'green' });
  const extra = dump(); extra['r|dark|1280']['span:2'] = { color: 'red' };
  assert.deepEqual(diffStyles(dump(), extra).map((r) => [r.path, r.dev, r.slice]), [['span:2', 'absent', 'present']]);
});

test('ROUTES includes Labs; the CLI without --dev exits 2', () => {
  assert.ok(ROUTES.includes('#settings/experimental'));
  const r = spawnSync(process.execPath, ['tools/stillhet-style-diff.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--dev SHA/);
});

test('ACCEPTED: one flag-off difference, the Labs row for Stillhet, with the owner\'s words as its reason', () => {
  assert.deepEqual(ACCEPTED.map((a) => [a.route, a.selector]), [['#settings/experimental', '[data-flag-row="rail"]']]);
  assert.match(ACCEPTED[0].reason, /before enrolling everything I would recommend to be de-activated, labs is reasonable/);
});
