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

// ── Slice 7 (R-po-5): the same proof shoots the state line and the need-you count on the card and the feature page ─────
test('s7: it adds the line surface (SURFACE=line), the worlds busy, next, two and acts, and names its shots per theme', () => {
  const s = src();
  assert.match(s, /SURFACE[^\n]*['"]line['"]/, 'SURFACE=line is understood');
  for (const w of ['next', 'two', 'acts']) assert.match(s, new RegExp(`\\b${w}\\s*:\\s*\\{|['"]${w}['"]`), w);
  assert.match(s, /line-\$\{[A-Za-z.]+\}-(card|\$\{[A-Za-z.]+\})-\$\{[A-Za-z.]+\}\.png/, 'line-{world}-card-{theme}.png');
  assert.match(s, /line-\$\{[A-Za-z.]+\}-(page|\$\{[A-Za-z.]+\})-\$\{[A-Za-z.]+\}\.png/, 'line-{world}-page-{theme}.png');
  assert.match(s, /deviceScaleFactor: 2/);
  assert.match(s, /n_review/, 'busy run 6 is seeded reviewing');
  assert.match(s, /setApproveEach/, 'acts asks before each run');
});

test('s7: it checks the exact lines, "4 need you" once, no chip in two, the chip height and the card detail\'s line count', () => {
  const s = src();
  for (const t of ['Run 6 reviewing · next: run 9', '2 of 16 runs done', 'next: run 9', 'Run 8 building, run 10 building · next: run 13',
    'Nothing can go on until you act', '4 need you', '1 needs you']) assert.ok(s.includes(t), t);
  assert.match(s, /data-need|dataset\.need/);
  assert.match(s, /need you[^\n]*once|once[^\n]*need you/i, 'the count is checked to appear once');
  assert.match(s, /no (need )?chip/i);
  assert.match(s, /\b18\b/, 'the one-chip height');
  assert.match(s, /lineHeight|line-height/);
});

// ── Slice 8 (R-ux-2, R-qa-5): the same proof points at run 12, keeps it with Enter and lets go with Escape ───────────
test('s8: it adds the links surface (SURFACE=links), skips the world loop for it, and drives real pointer and key input', () => {
  const s = src();
  assert.match(s, /process\.env\.SURFACE === 'links'/, 'the section is guarded by SURFACE=links');
  assert.match(s, /WORLDS = [^\n]*SURFACE !== 'links'/, 'WORLDS skips SURFACE=links');
  assert.match(s, /Input\.dispatchMouseEvent/);
  assert.match(s, /mouseMoved/);
  assert.match(s, /Input\.dispatchKeyEvent/);
  assert.match(s, /['"]Enter['"]/);
  assert.match(s, /['"]Escape['"]/);
  assert.match(s, /activeElement\s*===?\s*document\.body/, 'focus is checked to be on the body before the kept shot');
});

test('s8: the pointing log has before, pointed, kept and released row positions, shot per theme, with the exact marks checked', () => {
  const s = src();
  assert.match(s, /links-base-(?:card|page|\$\{[A-Za-z.]+\})-\$\{[A-Za-z.]+\}\.png/, 'links-base-{card|page}-{theme}.png');
  assert.match(s, /links-kept-base-(?:card|page|\$\{[A-Za-z.]+\})-\$\{[A-Za-z.]+\}\.png/, 'links-kept-base-{card|page}-{theme}.png');
  assert.match(s, /results\.links/);
  assert.match(s, /samePositions/);
  assert.match(s, /getBoundingClientRect/);
  for (const phase of ['before', 'pointed', 'kept', 'released']) assert.match(s, new RegExp(`\\b${phase}\\b`), phase);
  assert.match(s, /\[\s*1\s*,\s*7\s*,\s*10\s*\]/, 'solid is checked to be 1, 7, 10');
  assert.match(s, /\[\s*16\s*\]/, 'dashed is checked to be 16');
  assert.match(s, /::before/, 'the bar\'s computed style is read');
  assert.match(s, /['"]3px['"]/, 'the bar is checked to be 3px wide');
  assert.match(s, /deviceScaleFactor: 2/);
  assert.match(s, /THEMES = \['light', 'dark'\]/);
});

// ── Slice 9 (R-ux-4, R-qa-4): the same proof mounts the run order map on the served page and checks its real rects ─────
test('s9: it adds the map surface (SURFACE=map), the worlds base, busy, held, change and after2, shoots map-{world}-{theme}.png and checks segments against the dot and label rects, the base world\'s 15 pairs, aria-hidden, the Tab check on an overflowing map, the card\'s dot classes, the pulse, and fails on overlaps', () => {
  const s = src();
  assert.match(s, /!process\.env\.SURFACE[^\n]*SURFACE === 'map'/, 'SURFACE=map runs it, and so does a run with no SURFACE');
  assert.match(s, /WORLDS = [^\n]*SURFACE !== 'map'/, 'SURFACE=map skips the rows worlds');
  assert.match(s, /\bafter2\b/, 'base with run 2 done');
  assert.match(s, /map-\$\{[A-Za-z.]+\}-\$\{[A-Za-z.]+\}\.png/, 'map-{world}-{theme}.png');
  assert.match(s, /\/shape\/run-order-map\.mjs/, 'the module as the page serves it');
  assert.match(s, /renderRunOrderMap/);
  assert.match(s, /path\.rom-link/);
  assert.match(s, /\.rom-run \.status-dot/);
  assert.match(s, /\.rom-n\b/);
  for (const [a, b] of [[2, 7], [2, 8], [3, 4], [3, 10], [4, 5], [5, 6], [6, 7], [7, 12], [8, 15], [9, 16], [10, 12], [12, 16], [13, 14], [14, 15], [15, 16]]) {
    assert.match(s, new RegExp(`\\b${a}\\s*(?:,|→|->|>|-)\\s*${b}\\b`), `base pair ${a}→${b}`);
  }
  assert.match(s, /aria-hidden|ariaHidden/);
  assert.match(s, /\b240\b/, 'the host is narrowed to 240px');
  assert.match(s, /Input\.dispatchKeyEvent/);
  assert.match(s, /['"]Tab['"]/);
  assert.match(s, /is-violet/, 'merged rows keep a model-only dot');
  assert.match(s, /\.chat-rc-members[^\n]*\.status-dot|\.status-dot[^\n]*\.chat-rc-members|chat-rc-members[\s\S]{0,400}\.status-dot/, 'the card rows\' dot classes');
  assert.match(s, /data-from=\\?["']2\\?["']|\.from\s*===?\s*['"]?2\b/, 'after2 draws nothing from run 2');
  assert.match(s, /check\(overlaps\[[^\n]*\.length === 0/, 'links that share no run and run together fail the proof');
});

// ── Slice 12 (R-arch-1): the line surface proves run 1, which runs in the Chat card's own pipeline ────────────────────
test('s12: the line surface adds the first world (run 1 reviewing, nothing done) and checks the card\'s run 1 row', () => {
  const s = src();
  assert.match(s, /['"]line-first['"]\s*:[^\n]*1:\s*\{\s*pipe:\s*'running'\s*\}[^\n]*1:\s*'n_review'/, 'SPECS line-first: run 1 running at the Reviewer');
  assert.match(s, /\bfirst\s*:\s*\{\s*line:\s*'Run 1 reviewing · next: run 9',\s*done:\s*'0 of 16 runs done',\s*chip:\s*''/, 'LINE_WORLDS first');
  assert.match(s, /===\s*'first'[\s\S]{0,600}reviewing/, 'the first world\'s extra card check: run 1\'s row reads reviewing');
});

// ── Slice 13 (R-ux-5): the stops surface proves each open line's step card draws as the card question, each fact once ──
test('s13: the stops surface checks no visible banner or step head, the card\'s padding and foot wrap, a zero host margin, Run N once, and seeds gate and clarify stops', () => {
  const s = src();
  // Per open line: what STOP_LINES records and stopsShot checks.
  assert.match(s, /\.qpanel-head/, 'the banner is read');
  assert.match(s, /\.step-head/, 'the step card\'s head is read');
  assert.match(s, /banner === false/);
  assert.match(s, /head === false/);
  assert.match(s, /\b16px\b/, 'the card\'s top padding');
  assert.match(s, /['"]wrap['"]/, 'the foot wraps');
  assert.match(s, /margin === ['"]0px['"]/, 'the host adds no top margin');
  assert.match(s, /runs === 1/, 'Run N once per line');
  assert.match(s, /asked === true/, 'the question text stays visible');
  assert.match(s, /ready for your approval/);
  assert.match(s, /Shape \\+d/, 'no "Shape 3/8" on a line');
  assert.match(s, /\b32\.5\b[\s\S]*chat-rc-stop-line|chat-rc-stop-line[\s\S]*\b32\.5\b/, 'each line row stays one line');
  assert.doesNotMatch(s, /textHeight \+ 11\.5/, 'R-qa-9: 360px keeps the strict 32.5px row, no text-height allowance');
  // The seeded gate and clarify stops, and the shots.
  assert.match(s, /['"]stops-kinds['"]/);
  assert.match(s, /4:\s*\{[^}]*stop:\s*'objection'/, 'run 4 at a gate stop');
  assert.match(s, /11:\s*\{[^}]*ask:\s*'clarify'/, 'run 11 at a clarify ask');
  assert.match(s, /gateStop/, 'the gate stop is built by the real gateStop');
  assert.match(s, /stops-kinds-card-\$\{[A-Za-z.]*theme[A-Za-z.]*\}\.png/, 'stops-kinds-card-{theme}.png');
  assert.match(s, /stops-busy-card-360-light\.png/);
});

// ── Run order, later runs: the order surface also shoots a later run and stopped runs, each beside the agreed mock ────
test('the order surface shoots later and still and puts each beside the mock', () => {
  const s = src();
  for (const w of ['later', 'still']) assert.match(s, new RegExp(`['"]${w}['"]`), w);
  assert.ok(s.includes('run-order-mock.html'), 'the agreed mock is opened');
  assert.ok(s.includes('order-vs-mock-'), 'the side-by-side shots');
  assert.match(s, /is-faint/, 'the faint links are checked');
  assert.match(s, /--line-2/, 'their stroke is compared with the token');
});
