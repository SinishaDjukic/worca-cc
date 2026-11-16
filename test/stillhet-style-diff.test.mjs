// test/stillhet-style-diff.test.mjs — the pure parts of tools/stillhet-style-diff.mjs, and its usage exit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { diffStyles, hashDiff, withTimeout, ROUTES, ACCEPTED } from '../tools/stillhet-style-diff.mjs';

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
  assert.deepEqual(ACCEPTED.map((a) => [a.route, a.selector]), [['#settings/experimental', '[data-flag-row="stillhet"]']]);
  assert.match(ACCEPTED[0].reason, /before enrolling everything I would recommend to be de-activated, labs is reasonable/);
});

test('hashDiff: only the paths whose hash differs are fetched in full; an element on one side only is a skeleton row', () => {
  const { changed, devOnly, sliceOnly } = hashDiff({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 });
  assert.deepEqual(changed, ['b']);
  assert.deepEqual(devOnly, { c: {} });
  assert.deepEqual(sliceOnly, { d: {} });
  assert.deepEqual(diffStyles({ k: devOnly }, { k: sliceOnly }).map((r) => [r.path, r.dev, r.slice]), [['c', 'present', 'absent'], ['d', 'absent', 'present']]);
});

test('withTimeout: a page that never settles is an error naming it, not a hang', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, '#settings light 360 on slice'), /#settings light 360 on slice: timed out/);
  assert.equal(await withTimeout(Promise.resolve(7), 20, 'x'), 7);
});

test('the CLI refuses an unknown --route with exit 2', () => {
  const r = spawnSync(process.execPath, ['tools/stillhet-style-diff.mjs', '--dev', 'HEAD', '--route', '#nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown route #nope/);
});
