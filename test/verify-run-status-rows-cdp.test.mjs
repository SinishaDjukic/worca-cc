// Shaper small runs s4: the 2x light and dark proof of the run rows is a CDP script that needs Chrome, so it is not part
// of `npm test`. This needle test pins what the script proves, so a change that drops a world, a surface, a theme or a
// check fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../tools/verify-run-status-rows-cdp.mjs', import.meta.url);
const src = () => readFileSync(FILE, 'utf8');

test('the script exists, shoots at 2x in both themes, and names its shots rows-{world}-{card|page}-{theme}.png', () => {
  assert.ok(existsSync(FILE));
  const s = src();
  assert.match(s, /deviceScaleFactor: 2/);
  assert.match(s, /THEMES = \['light', 'dark'\]/);
  assert.match(s, /rows-\$\{world\}-\$\{surface\}-\$\{theme\}\.png|rows-\$\{[a-z]+\}-\$\{[a-z]+\}-\$\{[a-z]+\}\.png/);
  assert.match(s, /SHOTS_DIR/);
  assert.match(s, /VERIFY_PORT/);
});

test('it seeds the four worlds (base, held, change, failed) and shoots the Chat card and the feature page', () => {
  const s = src();
  for (const w of ['base', 'held', 'change', 'failed']) assert.match(s, new RegExp(`['"]${w}['"]`), w);
  assert.match(s, /after: 3/, 'run 4 held behind run 3');
  assert.match(s, /setKind\(13, 'change'\)/);
  assert.match(s, /cancelTicket\(14\)/);
  assert.match(s, /\.chat-rc-members/);
  assert.match(s, /gpage-runs/);
  assert.doesNotMatch(s, /\/api\/run['"`]/, 'the seeded worlds, never a real run start');
});

test('it checks the four required words and marks', () => {
  const s = src();
  for (const w of ['waits for run 2 (needs you), 6', 'after run 3', 'next · small change run', 'waits for run 7, 10']) assert.ok(s.includes(w), w);
  assert.match(s, /data-symbol|dataset\.symbol/);
  assert.match(s, /alert/);
  assert.match(s, /is-dashed-ring/);
  assert.match(s, /is-ink-ring/);
});

test('it asserts no row reads next while a held answer waits, a live word is never working, and only live rows pulse', () => {
  const s = src();
  assert.match(s, /working/);
  assert.match(s, /is-pulse/);
  assert.match(s, /data-mark|dataset\.mark/);
  assert.match(s, /process\.exit\(1\)|exitCode = 1/);
});

test('it measures every row (height, wrap) at 1280px and runs 7 and 12 at 375px in light, and the word colours', () => {
  const s = src();
  assert.match(s, /1280/);
  assert.match(s, /375/);
  assert.match(s, /offsetHeight|getBoundingClientRect/);
  assert.match(s, /wrap/i);
  assert.match(s, /amber-ink|rgb/i);
  assert.match(s, /red-ink|rgb/i);
});
