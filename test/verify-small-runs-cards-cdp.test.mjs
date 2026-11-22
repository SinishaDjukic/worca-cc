// Small runs C5 (Step 6): the closing browser check of every Feature C card state is a CDP script that needs Chrome, so
// it is not part of `npm test`. This needle test pins what the script proves, so a change that drops a surface, a theme,
// the width, a measurement, the Welcome skip, the cap or the report fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../tools/verify-small-runs-cards-cdp.mjs', import.meta.url);
const src = () => readFileSync(FILE, 'utf8');

test('the script exists and holds the Verifier states by seeding, never by a live mock run', () => {
  assert.ok(existsSync(FILE));
  const s = src();
  for (const state of ["'verifying'", "'gaps'", "'clean'"]) assert.ok(s.includes(`vCheck(`) && s.includes(state), state);
  assert.match(s, /setVerify\(VW\.f, vCheck\(VW, VW_RUN, 'verifying'\)\)/);
  assert.match(s, /pipeline\(VW_RUN, 'running'/, 'a running pipelines row for the Verifier');
  assert.match(s, /fire\(VF\.f, added\.index, GAP_RUN, 'running'/, 'a running pipelines row for one gap run');
  assert.match(s, /const VSTOP = verifyStop\(/, 'the bound stop');
  assert.doesNotMatch(s, /\/api\/run'/, 'no live mock run is started');
});

test('every Feature C surface beside its prototype screen and moment', () => {
  const s = src();
  assert.match(s, /prototypeShot\('verifier', '\[data-vf="vw"\]'/);
  assert.match(s, /prototypeShot\('verifier', '\[data-vf="vf"\]'/);
  assert.match(s, /prototypeShot\('ship', null/);
  assert.match(s, /\['0', 'offered'/);
  assert.match(s, /\['\.5', 'building'/);
  assert.match(s, /\['1', 'built'/);
  assert.match(s, /\['2', 'remark'/);
  assert.match(s, /\['3', 'confirmed'/);
  assert.match(s, /prototypeShot\('prototype', `\[data-proto="\$\{seg\}"\]`/);
  for (const screen of ['build', 'run-panel', 'run-stops', 'req-change']) assert.ok(s.includes(`prototypeShot('${screen}'`), screen);
  assert.ok(s.includes('plans/shaper-refresh/prototype.html'));
});

test('the run page and the side panel of the Verifier run and of one gap run', () => {
  const s = src();
  assert.match(s, /#running\/\$\{runId\}/);
  assert.match(s, /#chat\/new\/run\/\$\{pid\}\/overview/);
  assert.match(s, /runViews\(`run-\$\{VW_RUN\}`, VW_RUN, 'verifier', theme\)/);
  assert.match(s, /runViews\(`run-\$\{GAP_RUN\}`, GAP_RUN, 'gap-run', theme\)/);
});

test('the Verifier strings, the gap list and the measurements', () => {
  const s = src();
  for (const needle of ["'Verifying'", "'the Verifier walks the main flow · 4 of 4 runs done'", "'Ready to ship'", "'ship from the feature page'",
    "'Verifier: 3 of 4 hold in the main flow · 1 gap between runs · run 5 added: a small run for the gap'",
    "'Verified: the 4 requirements owned by runs hold in the main flow'", "'Add a run for the gap'", "'Needs you'"]) assert.ok(s.includes(needle), needle);
  assert.match(s, /judge\('verifier gap list'/);
  assert.match(s, /Math\.abs\(r\.height - 32\) > 0\.5/, 'the 32px one-line check');
  assert.match(s, /m\.maxDy <= 1/);
  assert.match(s, /m\.spreadX <= 1/);
  assert.match(s, /overflow:/);
});

test('both themes at 375px, the Welcome Skip, the 30-minute cap, reduced motion and the report file', () => {
  const s = src();
  assert.match(s, /const THEMES = \['light', 'dark'\];/);
  assert.match(s, /const WIDTH = 375;/);
  assert.match(s, /const CAP_MS = 30 \* 60 \* 1000;/);
  assert.match(s, /writeLog\('timeout'\)/);
  assert.match(s, /writeLog\('incomplete'\)/);
  assert.match(s, /\^\(skip\|got it\)\$/);
  assert.match(s, /Emulation\.setEmulatedMedia', \{ features: \[\{ name: 'prefers-reduced-motion', value: 'reduce' \}\] \}/);
  assert.match(s, /'small-runs-cards-measure\.json'/);
  assert.match(s, /shot\(`app-/);
  assert.match(s, /shot\(`prototype-/);
  assert.doesNotMatch(s, /process\.env\.PORT\b/);
  assert.match(s, /'--remote-debugging-port=0'/);
  assert.match(s, /process\.env\.HOME = home/);
});
