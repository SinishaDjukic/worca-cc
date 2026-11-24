// Small runs C3 (Step 7): the browser check of a run's stops is a CDP script that needs Chrome, so it is not part of
// `npm test`. This needle test pins what the script proves, so a change that drops a surface, a theme or the cap fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../tools/verify-run-stops-cdp.mjs', import.meta.url);
const src = () => readFileSync(FILE, 'utf8');

test('the script exists and opens the card, the side panel, the run page and the prototype\'s #run-stops', () => {
  assert.ok(existsSync(FILE));
  const s = src();
  assert.match(s, /#chat\/\$\{thread\.id\}/, 'the feature card in Chat');
  assert.match(s, /#chat\/new\/run\/ab000008\/overview/, 'the side panel overview');
  assert.match(s, /#running\/\$\{RUN_ID\}/, 'the run page');
  assert.match(s, /\$\{PROTO\}#run-stops/);
});

test('it seeds 10 runs with real-length titles, run 10 building on run 8, run 8 on a stop and run 9 building', () => {
  const s = src();
  assert.match(s, /dependsOn: i === 9 \? \['s8'\] : \[\]/);
  assert.match(s, /'Check every chart type renders with an empty dataset'/);
  assert.match(s, /const STOP = gateStop\(/);
  assert.match(s, /liveRun\(8, 'ab000008', 'n_review', PQ\)/);
  assert.match(s, /liveRun\(9, 'ab000009', 'n_impl', null\)/);
  assert.match(s, /body\.held === true/, 'the answer is held while run 9 builds');
});

test('it checks one primary, zero panel buttons and one findings list, the row words, and measures rows per list', () => {
  const s = src();
  assert.match(s, /c\.primaries\.length === 1 && c\.primaries\[0\] === 'Run another cycle'/);
  assert.match(s, /p\.qButtons === 0 && p\.options === 0 && p\.findings === 1 && !p\.barAnswer/);
  assert.match(s, /'waiting for you'/);
  assert.match(s, /'waits for run 8'/);
  assert.match(s, /'after run 9'/);
  assert.match(s, /'Run 8 \| another cycle · decided by you'/, 'the run once, in its span; the text without it');
  assert.match(s, /Math\.abs\(r\.height - 32\) > 0\.5/);
  assert.match(s, /r\.textLines > 1/, 'a long title stays one line');
  assert.match(s, /m\.maxDy <= 1/);
  assert.match(s, /m\.spreadX <= 1/);
});

test('both themes at 375px, the 30-minute cap, a free port and a sandboxed HOME', () => {
  const s = src();
  assert.match(s, /const THEMES = \['light', 'dark'\]/);
  assert.match(s, /const WIDTH = 375;/);
  assert.match(s, /const CAP_MS = 30 \* 60 \* 1000;/);
  assert.doesNotMatch(s, /process\.env\.PORT\b/);
  assert.match(s, /'--remote-debugging-port=0'/);
  assert.match(s, /process\.env\.HOME = home/);
});
