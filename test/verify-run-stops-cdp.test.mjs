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

test('the pages: 1280 in both themes and 375 in light; the run page, the feature page, one word per run and a finished feature', () => {
  const s = src();
  assert.match(s, /const PAGE_CELLS = \[\[1280, 'light'\], \[1280, 'dark'\], \[375, 'light'\]\];/);
  assert.match(s, /`#chat\/\$\{thread\.id\}`, '\.issues', 'run-thread'/, 'the run page of a feature a thread started');
  assert.match(s, /`#feature\/\$\{fx\.id\}`, '\.plan-checks', 'run-no-thread'/, 'and of one it did not');
  assert.match(s, /s\.links\.length === 1 && s\.links\[0\] === href/);
  assert.match(s, /s\.controls === 0 && s\.findings === 1/);
  assert.match(s, /JSON\.stringify\(p\.heads\) === JSON\.stringify\(\[PQ2\.stop\.head\]\)/, 'one visible head');
  assert.match(s, /JSON\.stringify\(p\.primaries\) === '\["Re-plan"\]'/, 'one primary');
  assert.match(s, /Plan ready for your approval/);
  assert.match(s, /p\.bar\.length === 0/);
  assert.match(s, /\/\^Re-plan\/\.test\(x\)/, 'no Re-plan in the ⋯');
  assert.match(s, /JSON\.stringify\(onPage\) === JSON\.stringify\(onCard\) && JSON\.stringify\(onPage\) === JSON\.stringify\(onList\)/);
  assert.match(s, /m\.rows\.length === 10 && off\.length === 0/, 'ten one-line 32px rows');
  assert.match(s, /c\.text === 'Create 2 PRs' && c\.disabled/);
  assert.match(s, /the reason is on the page/);
  assert.match(s, /state: 'clean', head: \{ index: 2, pipelineId: 'ad000002' \}/, 'the finished feature has passed its Verifier check');
  assert.match(s, /t === '2 · 1 met · 1 dropped'/);
  assert.match(s, /s\.line === 'none' && s\.bg === 'rgba\(0, 0, 0, 0\)'/, 'Show is a quiet button');
});

test('the outline-change stop: its notes on every surface, folded and opened, in the page cells and a wide desktop', () => {
  const s = src();
  assert.match(s, /const NOTE_CELLS = \[\.\.\.PAGE_CELLS, \[1920, 'light'\]\];/);
  for (const surface of ["'card'", "'feature-page'", "'run-page'", "'side-panel'", "'run-page-finding'", "'side-panel-finding'"]) assert.ok(s.includes(`[${surface},`), surface);
  assert.match(s, /process\.env\.WORCA_FLAGS = flagOnHere \? 'shaperSmallRuns' : '-shaperSmallRuns';/, 'the findings, with the flag off');
  assert.match(s, /A prerequisite is not in this tree/, 'the mock\'s note');
  assert.match(s, /const LONG_NOTE = /);
  assert.match(s, /stop: planStop\(\{ run: 8, outlineChange, node: 'n_plan' \}\)/);
  assert.match(s, /-folded`\)/);
  assert.match(s, /-opened`\)/);
});

test('the outline-change stop: two question lines, no inner scrollbar, nothing past the card, the pick kept', () => {
  const s = src();
  assert.match(s, /text\.getBoundingClientRect\(\)\.height \/ parseFloat\(getComputedStyle\(text\)\.lineHeight\)/);
  assert.match(s, /const cap = length === 'title-120' \? 3 : 2;/);
  assert.match(s, /!n\.classList\.contains\('is-clamped'\) && n\.clientHeight > 0 && n\.scrollHeight > n\.clientHeight \+ 1/);
  assert.match(s, /q\.scrollWidth > q\.clientWidth/);
  assert.match(s, /the options sit directly under the note/);
  assert.match(s, /JSON\.stringify\(x\.picked\) === '\["change"\]'/);
  assert.match(s, /'Show the full note'/);
  assert.match(s, /'Show less'/);
});
