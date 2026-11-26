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
  for (const needle of ["'Verifying'", "'the Verifier walks the main flow · 4 of 4 runs done'", "'Ready to ship'",
    "'Verifier: 3 of 4 hold · 1 gap · run 5 added for it'",
    "'Verified: the 4 requirements owned by runs hold in the main flow'", "'Add a run for the gap'", "'Needs you'"]) assert.ok(s.includes(needle), needle);
  assert.match(s, /judge\('verifier gap list'/);
  assert.match(s, /judgeVerifyLine\('gap found', theme\)/, 'the Verifier line measured beside the gap rows (owner direction d86d13181)');
  assert.match(s, /judgeVerifyLine\('no gap', theme\)/);
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

test('D1 Ship: blocked, ready, not met and done beside the prototype\'s #ship at 1280px and 375px; rows measured; keyboard and focus', () => {
  const s = src();
  for (const needle of ["shipFeature('sb'", "shipFeature('sr'", "shipFeature('sd'", "shipFeature('sk'", "'R-comp-4': { kind: 'confirmed', role: 'compliance' }",
    "recordShip(SD.f.id", "for (const width of [1280, WIDTH])", "'Waiting for Compliance to confirm R-comp-4'",
    "'Mark R-comp-4 as Compliance: The sign-up data stays in the EU'", "shipFeature('sn'", "mark: 'not-met', reason: 'Legal has not signed the EU clause yet'",
    "app-ship-not-met-", "f.prsOpen === 1", "f.views.join() === 'View PRs'",
    "'Create 4 PRs'", "'4 PRs open'", "'into main'", "judge('ship blocked confirmed rows'", "judge('ship ready confirmed rows'", "judge('ship done PR rows'",
    "Input.dispatchKeyEvent", "Accessibility.getPartialAXTree", "key1('Tab'", "key1('Enter'", "the focus stays on Met"]) {
    assert.ok(s.includes(needle), needle);
  }
  assert.match(s, /prototypeShot\('ship', null, `ship-blocked-\$\{width\}`/);
  assert.match(s, /prototypeShot\('ship', \['\[data-act="compok"\]'/);
  assert.match(s, /prototypeShot\('ship', \['\[data-act="prdlg"\]', '\[data-act="prok"\]'\]/);
  assert.doesNotMatch(s, /'ship from the feature page'/);
});

test('D2: runs-list, run-facts, agents-place and card-members at Expert, the 10 members, one Agents place, and the flag-off control', () => {
  const s = src();
  for (const name of ['runs-list', 'run-facts', 'agents-place', 'card-members']) assert.ok(s.includes(`\`${name}`), name);
  for (const needle of ['.srows.runs-members > .runs-item', '.runs-stage', "uiLevel: 'expert'", 'm.rows.length === 10', 'm.rows[0].pid === D2.pid(1)',
    "places === 1", "live === 2 && panel === 2 && saved === 1", 'PATCH /api/flags', "method: 'PATCH'", 'delete process.env.WORCA_FLAGS',
    '#history/', '#running/${D2_RUN}', '#chat/new/run/${D2_LIVE}/overview', 'stageInside', 'scrollWidth <= e.clientWidth',
    "'plan v2 · after the plan review'", 'for (const width of [WIDTH, 1280])']) assert.ok(s.includes(needle), needle);
  assert.match(s, /Math\.abs\(r\.height - 32\) > 1/, 'the 32px (±1px) member rows');
  assert.match(s, /m\.spreadX <= 1/);
  // The truncation proof (fit-1-1, requirements-1-2): a long-title member; the line's natural width; the title ellipsizes.
  for (const needle of ['const D2_LONG = 4;', 'Math.abs(r.subW - r.subScroll) > 1 || r.subScroll > r.subClient', 'long.titleEllipsis && long.titleCut',
    "words.length === 8 && words.every((w) => w === 'done')"]) assert.ok(s.includes(needle), needle);
  assert.match(s, /await d2Phase\(\);\nawait d3Phase\(\);\nawait heldPhase\(\);\nawait takeIn\w*\(\);\nawait finish\(\);\n$/, 'D2 before D3, the held row, then the take-in, before the verdict');
});

test('d3Phase seeds, measures both lists with the width, pairs with the prototype feature screen, and runs after D2', () => {
  const s = src();
  for (const needle of ["seedFeature('d3'", "'R-comp-1': { kind: 'confirmed', role: 'compliance' }", "reqChanges.apply(D3.f.id",
    "post(`/api/shape/features/${D3.f.id}/confirm`", "recordShip(D3.f.id", '#feature/${D3.f.id}/requirements', '#feature/${D3.f.id}/decisions',
    "MEASURE(D3_REQS, '.plan-check-row', '.plan-check-mark', '.plan-check-text')", "'li:not([data-fact=\"care\"]) > .plan-check-row'",
    '{ width, oneLine: true }', "'run 2 · changed · run 6 builds it'", "'run 3 · being built'", "'confirmed by a person · Compliance'",
    "'run 2 · met · changed by run 6'", 'Marked Not met by you · ${D3_REASON}', 'r.idLines <= 1', '!r.noteCut', '!f.careCut', 'f.link.color !== f.link.noteColor',
    'visible label widths', 'results.d3Minutes', 'for (const width of [1280, WIDTH])', "process.env.D3_ONLY === '1'", 'await skipWelcome(); await setTheme(theme);']) {
    assert.ok(s.includes(needle), needle);
  }
  assert.match(s, /prototypeShot\('feature', \['\[data-moment="vf"\]', '\[data-tab="Requirements"\]'\]/);
  assert.match(s, /prototypeShot\('feature', \['\[data-moment="vf"\]', '\[data-tab="Decisions"\]'\]/);
  assert.match(s, /#ship`\); await setTheme\(theme\)[\s\S]*compok[\s\S]*location\.hash = '#feature'[\s\S]*\[data-moment="rs"\]/, 'the after pair: #ship, confirm, then #feature in the same page');
  assert.match(s, /prototypeFeatureAfter\('Requirements'/);
  assert.match(s, /prototypeFeatureAfter\('Decisions'/);
});

test('the TAKEIN_ONLY phase: the moved step and the refused stop of a seeded 4-run feature at 1280px in both themes, 4 screenshots, runs last', () => {
  const s = src();
  const gate = s.match(/process\.env\.TAKEIN_ONLY === '1'\) \{ await (takeIn\w*)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the TAKEIN_ONLY=1 gate');
  assert.match(s, new RegExp(`await heldPhase\\(\\);\\nawait ${gate[1]}\\(\\);\\nawait finish\\(\\);\\n$`), 'last in a full run');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the take-in phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  // Run 2's audit line, written the way the harness writes it.
  assert.match(s, /Base \\?`feat\/run-3\\?` moved: merged into \\?`feat\/run-2\\?` \(1 commit\)\.|baseMovedAudit\(['"`]feat\/run-3['"`], ['"`]feat\/run-2['"`]/);
  assert.match(body, /appendAudit/);
  for (const needle of ['feat/run-3 moved · run 2 starts from it', 'takeInRefused', 'runs 2 and 3 clash in src/a.mjs', 'Not sent: ']) {
    assert.ok(s.includes(needle), needle);
  }
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  // The four files, with these exact names (no prefix), in SHOTS_DIR.
  assert.match(s, /[`'/]small-runs-taken-in-(\$\{theme\}|light|dark)\.png/);
  assert.match(s, /[`'/]small-runs-take-in-refused-(\$\{theme\}|light|dark)\.png/);
});

test('heldPhase: a clash-held run seeded with setClashHold, its row and one Start now at 1280px in both themes', () => {
  const s = src();
  assert.match(s, /process\.env\.HELD_ONLY === '1'\) \{ await heldPhase\(\); await finish\(\); \}/);
  const at = s.indexOf('async function heldPhase(');
  assert.ok(at >= 0, 'the held-row phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  for (const needle of ['setClashHold(', 'runs 2 and 3 clash in src/a.mjs', 'Run 4 is held: ', '.shape-feature-held-why']) assert.ok(s.includes(needle), needle);
  assert.match(s, /feature-start|Start now/, 'Start now is counted');
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  // The two files, with these exact names (no prefix), in SHOTS_DIR.
  assert.match(s, /[`'/]small-runs-held-clash-(\$\{theme\}|light|dark)\.png/);
});

test('the SHIP_LIST_ONLY phase: the Ship list of the waited and the combine shape at 1280px in both themes, 4 screenshots', () => {
  const s = src();
  const gate = s.match(/process\.env\.SHIP_LIST_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the SHIP_LIST_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the Ship list phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  // The two features, their branch records, and what only the rule's own output shows (the fallback would not).
  for (const needle of ['Ship list', 'Ship combined', 'UPDATE pipelines SET branch', 'feat/run-4', 'tookIn', 'combined:',
    'stacked along the real branches', '.ask-shipcard-stats', 'onto #1', 'onto #3', 'onto #2', '3 PRs open', 'Create 3 PRs']) {
    assert.ok(s.includes(needle), needle);
  }
  // The four files, with these exact names (no prefix), in SHOTS_DIR.
  assert.match(s, /[`'/]small-runs-ship-list-(\$\{theme\}|light|dark)\.png/);
  assert.match(s, /[`'/]small-runs-ship-list-combined-(\$\{theme\}|light|dark)\.png/);
});

test('the HELD_RESUME_ONLY phase: a seeded held resume, Resume clicked, still paused, light and dark at 1280px, 2 screenshots', () => {
  const s = src();
  const gate = s.match(/process\.env\.HELD_RESUME_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the HELD_RESUME_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the held-resume phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  assert.match(body, /Resume/, 'the Resume button');
  assert.match(body, /click/i, 'Resume is clicked');
  assert.match(body, /paused/i, 'the row still reads paused');
  assert.match(body, /\bruns\b/, 'no runs-map entry for run 5');
  // The two files, with these exact names (no prefix), in SHOTS_DIR.
  assert.match(s, /[`'/]held-resume-(\$\{theme\}|light|dark)\.png/);
});
