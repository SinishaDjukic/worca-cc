// Small runs C2 (Step 8): the browser check of the Agents rows is a CDP script that needs Chrome, so it is not part of
// `npm test`. This needle test pins what the script proves, so a change that drops a surface, a theme or the cap fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../tools/verify-shape-agents-cdp.mjs', import.meta.url);

test('the script exists, opens the three routes and the prototype screens', () => {
  assert.ok(existsSync(FILE));
  const src = readFileSync(FILE, 'utf8');
  assert.match(src, /#chat\/\$\{thread\.id\}/, 'the feature card in Chat');
  assert.match(src, /#chat\/new\/run\/ab000002\/overview/, 'the side panel overview');
  assert.match(src, /#running\/\$\{RUN_ID\}/, 'the run page');
  assert.match(src, /plans\/shaper-refresh\/prototype\.html/);
  assert.match(src, /\$\{PROTO\}#build/);
  assert.match(src, /\$\{PROTO\}#run-panel/);
});

test('it seeds the live run through the server\'s runs map with careRun and n_tests active', () => {
  const src = readFileSync(FILE, 'utf8');
  assert.match(src, /runs\.set\(RUN_ID,/);
  assert.match(src, /const stepper = \{ \.\.\.buildGraphManifest\(.*careRun \};/);
  assert.match(src, /active: \[\{ nodeId: 'n_tests'/);
  assert.match(src, /careRunPlan\('thorough'/);
});

test('it measures both selectors, both themes at 375px, and holds the 30-minute cap', () => {
  const src = readFileSync(FILE, 'utf8');
  assert.match(src, /'\.run-member'/);
  assert.match(src, /'\.run-agents \.plan-check-row'/);
  assert.match(src, /const THEMES = \['light', 'dark'\]/);
  assert.match(src, /const WIDTH = 375;/);
  assert.match(src, /const CAP_MS = 30 \* 60 \* 1000;/);
  assert.match(src, /Math\.abs\(r\.height - 32\) > 0\.5/);
  assert.match(src, /m\.maxDy <= 1/);
  assert.match(src, /m\.spreadX <= 1/);
  assert.match(src, /Code review · Requirements/);
  // Every card run row is one 32px line (no geometry exemption for a stacked PR or cost).
  assert.match(src, /'\.status-dot', '\.run-member-title'\)\), \{ long: false, every: true \}\)/);
  // It never binds the inherited PORT (the host app's) nor a fixed Chrome debugging port.
  assert.doesNotMatch(src, /process\.env\.PORT\b/);
  assert.match(src, /'--remote-debugging-port=0'/);
});
