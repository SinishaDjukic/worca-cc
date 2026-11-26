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

// ── Slice 5 (R-ux-6, R-arch-1): the same proof also shoots the Runs list member rows and the run page head ───────────
test('s5: it adds the busy world and the side (Runs list) and run (run page head) surfaces', () => {
  const s = src();
  assert.match(s, /WORLDS = \[[^\]]*'busy'/, 'busy is a walked world');
  assert.match(s, /busy: \{ spec: SIXTEEN_RUN_STATES\.busy/);
  assert.match(s, /\bside\b\s*:|['"]side['"]/);
  assert.match(s, /\brun\b\s*:|['"]run['"]/);
  assert.match(s, /runs-members/);
  assert.match(s, /data-level="member"/);
  assert.match(s, /runs-expand/, 'the feature group is expanded');
  assert.match(s, /\.rd-sheet \.run-status/);
  assert.match(s, /#running\//);
  assert.match(s, /#history\//);
});

test('s5: the judge checks the strips, the sidebar ink, the dashed ring\'s centre and that no run page detail restates dev\'s state', () => {
  const s = src();
  assert.match(s, /\.runs-stage/);
  assert.match(s, /run-prog-mark/);
  assert.match(s, /runs-row-sub/);
  assert.match(s, /run-status-detail/);
  for (const w of [/needs you/i, /paused/i, /waiting(?! for you)/i, /stopped/i, /starts /]) assert.match(s, w, String(w));
  assert.match(s, /cent(re|er)/i);
});

test('s5: it names the sidebar shots, one 360px light sidebar shot and the run page head shots', () => {
  const s = src();
  assert.match(s, /\b360\b/);
  assert.match(s, /rows-(busy|\$\{[A-Za-z.]+\})-side-360-light\.png/);
  assert.match(s, /rows-\$\{[A-Za-z.]+\}-run\$\{[A-Za-z.]+\}-\$\{[A-Za-z.]+\}\.png/);
});

// ── Slice 6 (R-po-4): the same proof shoots the Chat card's open stop list, a refused Resume and the list after run 4 ───
test('s6: it adds the stops surface and names its three shots per theme', () => {
  const s = src();
  assert.match(s, /\bstops\b\s*:|['"]stops['"]/);
  for (const shot of ['stops-busy-card', 'stops-refused', 'stops-after']) {
    assert.match(s, new RegExp(`${shot}-\\$\\{[A-Za-z.]*theme[A-Za-z.]*\\}\\.png`), `${shot}-{theme}.png`);
  }
  assert.match(s, /chat-rc-stop/);
});

test('s6: it checks the busy lines, run 5\'s red "!" and Resume, a mounted question per open line and no second Resume', () => {
  const s = src();
  for (const line of ['Run 2 · plan approval · holds up 7, 8, 12, 15, 16', 'Run 5 failed · holds up 6, 7, 12, 16']) assert.ok(s.includes(line), line);
  assert.match(s, /chat-rc-stop-resume/);
  assert.match(s, /data-qrun|dataset\.qrun/);
  assert.match(s, /\.qpanel/);
  assert.match(s, /feature-resume/, 'the footer has no second Resume');
});

test('s6: Approve on run 4\'s real step card names run 4, a refused Resume shows its text, and run 4 re-seeded building leaves three lines', () => {
  const s = src();
  assert.ok(s.includes('Slice 6 is still going'), 'the refused Resume\'s text');
  assert.match(s, /Approve/, 'run 4\'s Approve is clicked');
  assert.match(s, /\/answer/, 'the Approve request is read');
  assert.match(s, /4:\s*\{\s*pipe:\s*'running'\s*\}/, 'run 4 re-seeded as building');
});
