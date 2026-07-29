// test/ui-pinned-sidebar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ui/public/style.css'),
  'utf8',
);

// Same anchored helper idiom as test/newpipeline-selector-width.test.mjs:
// extract a flat rule body, anchored on a non-word char (or start) so we don't
// match a longer selector that merely ends with the same suffix.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

test('the document is locked to the viewport (no page-level scroll)', () => {
  const body = ruleBody('html,body');
  assert.ok(body, 'html,body rule must exist');
  assert.match(body, /overflow:\s*hidden/, 'page must not scroll at the document level');
  assert.match(body, /height:\s*100%/, 'html,body must fill the viewport height');
  // Lock the intent: the document height must be fixed, not allowed to grow.
  assert.doesNotMatch(body, /min-height/, 'html,body must use height (not min-height) so the page cannot grow');
});

test('the app shell is exactly one viewport tall and cannot grow with content', () => {
  const app = ruleBody('.app');
  assert.ok(app, '.app rule must exist');
  assert.match(app, /height:\s*100vh/, '.app must be a fixed 100vh, not min-height');
  assert.doesNotMatch(app, /min-height/, '.app must use height (not min-height) so it cannot grow');
});

test('only the main content panel scrolls', () => {
  const main = ruleBody('.main');
  assert.ok(main, '.main rule must exist');
  assert.match(main, /overflow-y:\s*auto/, '.main is the single scroll container');
});

test('the menu stays full-height with the connected indicator pinned to the bottom', () => {
  const sidebar = ruleBody('.sidebar');
  assert.ok(sidebar, '.sidebar rule must exist');
  // Defensive: if the menu ever exceeds the viewport it scrolls internally
  // instead of clipping the connected indicator.
  assert.match(sidebar, /overflow-y:\s*auto/, '.sidebar should scroll internally if it overflows');

  const foot = ruleBody('.side-foot');
  assert.ok(foot, '.side-foot rule must exist');
  assert.match(foot, /margin-top:\s*auto/, 'connected indicator must remain pinned to the menu bottom');
});
