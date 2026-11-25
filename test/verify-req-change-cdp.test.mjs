// Small runs C4 (Step 10): the browser check of a requirement change mid-build is a CDP script that needs Chrome, so it
// is not part of `npm test`. This needle test pins what the script proves, so a change that drops a surface, a theme,
// a measurement or the cap fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const FILE = new URL('../tools/verify-req-change-cdp.mjs', import.meta.url);
const src = () => readFileSync(FILE, 'utf8');

test('the script exists and opens the feature cards, the chat card, the run page, the side panel and both prototype screens', () => {
  assert.ok(existsSync(FILE));
  const s = src();
  assert.match(s, /#chat\/\$\{A\.threadId\}/, 'the stop on the feature card');
  assert.match(s, /#chat\/\$\{x\.threadId\}/, 'the notices');
  assert.match(s, /#chat\/\$\{chatThread\.id\}/, 'the chat card');
  assert.match(s, /#running\/\$\{STOP_RUN\}/, 'the run page');
  assert.match(s, /#chat\/new\/run\/\$\{A\.pid\(4\)\}\/overview/, 'the side panel');
  assert.match(s, /for \(const screen of \['req-change', 'spec-changed'\]\)/);
  assert.match(s, /\$\{PROTO\}#\$\{screen\}/);
});

test('7 app captures and 2 prototype captures per theme', () => {
  const s = src();
  for (const name of ['app-req-change-stop-', 'app-req-change-run-page-', 'app-req-change-side-panel-', 'app-req-change-chat-']) assert.ok(s.includes(`shot(\`${name}\${theme}\`)`), name);
  assert.match(s, /shot\(`app-req-change-\$\{kase\}-\$\{theme\}`\)/);
  assert.match(s, /\[\[B, 'not-started'\], \[C, 'running'\], \[D, 'finished'\]\]/);
  assert.match(s, /shot\(`prototype-\$\{screen\}-\$\{theme\}`\)/);
});

test('it seeds through the core modules and the one change path', () => {
  const s = src();
  assert.match(s, /createSliceFeature\(/);
  assert.match(s, /reqChanges\.apply\(/);
  assert.match(s, /const STOP = planStop\(/);
  assert.match(s, /landsAs: 'finished'/);
});

test('it asserts the exact strings, one mark per fold, the row measurement and the empty run page and panel', () => {
  const s = src();
  assert.match(s, /'How a change lands · by where the run that owns the requirement is'/);
  assert.match(s, /'R-po-3 changed · run 3 has not started'/);
  assert.match(s, /'R-po-2 changed · run 2 was running'/);
  assert.match(s, /'R-po-2 changed · run 2 is finished'/);
  assert.match(s, /'It stopped, re-plans from the new text and continues\.'/);
  assert.match(s, /'Run 5, a small change run, takes the next turn\.'/);
  assert.match(s, /You are told, not asked/);
  assert.match(s, /'next · small change run'/);
  assert.match(s, /on\.length === 1 && on\[0\]\.id === marked/);
  assert.match(s, /r\.height < 31\.5/, 'every fold row at least 32px');
  assert.match(s, /m\.maxDy <= 1/);
  assert.match(s, /m\.spreadX <= 1/);
  assert.match(s, /r\.idClipped/);
  assert.match(s, /c\.questions === 0 && c\.primaries\.length === 0 && c\.answer === 0/);
  assert.match(s, /r\.notices === 0 && r\.folds === 0 && r\.cardButtons === 0/);
  assert.match(s, /p\.notices === 0 && p\.folds === 0 && p\.cardButtons === 0/);
});

test('both themes at 375px, the 30-minute cap, a free port, a sandboxed HOME, the verdict line first and the notes', () => {
  const s = src();
  assert.match(s, /const THEMES = \['light', 'dark'\]/);
  assert.match(s, /const WIDTH = 375;/);
  assert.match(s, /const CAP_MS = 30 \* 60 \* 1000;/);
  assert.doesNotMatch(s, /process\.env\.PORT\b/);
  assert.match(s, /'--remote-debugging-port=0'/);
  assert.match(s, /process\.env\.HOME = home/);
  assert.match(s, /verdict: 'incomplete'/);
  assert.match(s, /left mark column/);
  assert.match(s, /the finished run/);
  assert.match(s, /re-plans at once/);
});
