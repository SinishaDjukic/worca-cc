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
    "'Verified: the 4 requirements owned by runs hold in the main flow'", "'Send answers'", "'Needs you'"]) assert.ok(s.includes(needle), needle);
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
    "recordShip(SD.f.id", "for (const width of [1280, WIDTH])", "'Waiting for you to confirm R-comp-4'",
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
    '{ width, oneLine: true }', "'run 2 · changed · run 6 builds it'", "'run 3 · being built'", "'waiting for you to confirm · Compliance'",
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
  assert.ok(body.includes('Resume after run 2'), 'before the click the button says which run it waits for');
  // The two files, with these exact names (no prefix), in SHOTS_DIR.
  assert.match(s, /[`'/]held-resume-(\$\{theme\}|light|dark)\.png/);
});

test('the AFTER_RUN_ONLY phase: the Resume before the press and the after-run row, light and dark at 1280px, 8 screenshots', () => {
  const s = src();
  const gate = s.match(/process\.env\.AFTER_RUN_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the AFTER_RUN_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the after-run phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /375/, 'the label at 375px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  assert.match(body, /click/i, 'Resume is clicked');
  for (const needle of ['Resume after run', 'after run', 'data-mark', '#chat/new/run/']) assert.ok(body.includes(needle), needle);
  assert.match(s, new RegExp(`await heldResumePhase\\(\\);\\nawait ${gate[1]}\\(\\);\\n`), 'in a full run, right after the held resume');
  // The four files, with these exact names (no prefix), in SHOTS_DIR.
  assert.match(s, /[`'/]after-run-row-(\$\{theme\}|light|dark)\.png/);
  assert.match(s, /[`'/]resume-after-run-(\$\{theme\}|light|dark)\.png/);
  // Slice 11: a paused run before a working one, on the feature page's footer and the Chat feature card's footer.
  for (const needle of ['.gpage-actions', '.chat-rc-foot', 'Resume after run 6']) assert.ok(body.includes(needle), needle);
  assert.match(body, /\bcard\(/, 'the Chat feature card');
  const narrow = body.slice(0, body.indexOf('width: 1280'));
  for (const needle of ['.gpage-actions', '.chat-rc-foot']) assert.ok(narrow.includes(needle), `at 375px: ${needle}`);
  assert.match(s, /[`'/]feature-resume-after-run-(\$\{theme\}|light|dark)\.png/);
  assert.match(s, /[`'/]chat-card-resume-after-run-(\$\{theme\}|light|dark)\.png/);
});

test('the STOP_FINDINGS_ONLY phase: a 3-finding stop on the run page, the Chat run panel and the Chat card, light and dark at 1280px, 6 screenshots', () => {
  const s = src();
  const gate = s.match(/process\.env\.STOP_FINDINGS_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the STOP_FINDINGS_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the stop findings phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  // The seeded run at its gate stop; no live mock run.
  assert.match(body, /seedFeature\(/, 'a seeded marked feature');
  assert.match(body, /liveRun\(/, 'one live run');
  assert.match(body, /gateStop\(/, 'at a gate stop');
  // The three surfaces.
  assert.match(body, /#running\//, 'the run page');
  assert.match(body, /#chat\/new\/run\//, 'the Chat run panel');
  assert.match(body, /\bcard\(/, 'the Chat feature card');
  // 3 rows with their titles, and 1 primary.
  for (const needle of ['.issues > li.issue', '.issue-title', '.btn-primary']) assert.ok(body.includes(needle), needle);
  assert.match(body, /=== 3\b/, 'the 3 rows are counted');
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  // The six files, with these exact names (no prefix), in SHOTS_DIR.
  for (const surface of ['run-page', 'panel', 'card']) {
    assert.match(s, new RegExp(`[\`'/]small-runs-stop-findings-${surface}-(\\$\\{theme\\}|light|dark)\\.png`), `the ${surface} screenshots`);
  }
});

test('the One ship phase shoots its 6 surfaces in both themes', () => {
  const s = src();
  const gate = s.match(/process\.env\.SHIP_ONE_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the SHIP_ONE_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the One ship phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  // What each surface is asserted to show before its shot.
  for (const needle of ['disabled', '.shipit-prs-one-why', 'Run 2 already has pull request #40 open', ', or ship as one PR', '1 PR open',
    'Not opened: each run of this feature ships its own pull request', 'shipped as one PR or as stacked PRs']) {
    assert.ok(s.includes(needle), needle);
  }
  // The twelve files, with these exact names (no prefix), in SHOTS_DIR.
  for (const surface of ['enabled', 'disabled', 'group-line', 'applied', 'outcome', 'labs']) {
    assert.match(s, new RegExp(`[\`'/]app-ship-one-${surface}-(\\$\\{theme\\}|light|dark)\\.png`), `the ${surface} screenshots`);
  }
});

test('the SHIP_CARRIED_ONLY phase captures app-ship-carried-card and app-ship-carried-dialog in light and dark', () => {
  const s = src();
  const gate = s.match(/process\.env\.SHIP_CARRIED_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the SHIP_CARRIED_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the carried-run Ship phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  // The seeded shape (run 3 took in run 2) and what is asserted in the page before each shot.
  assert.match(body, /tookIn/, 'run 3 carries run 2');
  assert.match(s, /Run 2\\?'s work ships in run 3\\?'s pull request \(#40 is open\)/);
  for (const needle of ['Create 4 PRs', '.ask-shipcard-carried', '.shipit-prs-carried', 'scrollWidth', 'clientWidth']) {
    assert.ok(s.includes(needle), needle);
  }
  // The four app files, with these exact names (no prefix), in SHOTS_DIR, beside the prototype's two screens.
  for (const surface of ['card', 'dialog']) {
    assert.match(s, new RegExp(`[\`'/]app-ship-carried-${surface}-(\\$\\{theme\\}|light|dark)\\.png`), `the ${surface} screenshots`);
  }
  for (const screen of ['screen-requirements', 'screen-ship-dialog']) assert.ok(s.includes(screen), screen);
});

// Feature page slice 6 (R-ux-3): the Cost tab, the Ship card on Requirements and the Log tab, in both themes.
test('the FEATURE_TABS_ONLY phase captures feature-cost-tab, feature-requirements-ship-card and feature-log-tab in light and dark', () => {
  const s = src();
  assert.match(s, /process\.env\.FEATURE_TABS_ONLY === '1'\) \{ await featureTabsPhase\(\); await finish\(\); \}/, 'the FEATURE_TABS_ONLY=1 gate');
  const at = s.indexOf('async function featureTabsPhase(');
  assert.ok(at >= 0, 'the feature tabs phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /THEMES/, 'both themes');
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /375/, 'the narrow shots at 375px');
  // The Mark and ship click, what it must leave behind, and the bar that must not overflow.
  for (const needle of ['.gpage-markship', '[data-ship-card]', 'activeElement', 'scrollWidth', 'clientWidth']) assert.ok(body.includes(needle), needle);
  // The files, with these exact names (no prefix), in SHOTS_DIR.
  for (const surface of ['cost-tab', 'requirements-ship-card', 'log-tab']) {
    assert.match(s, new RegExp(`[\`'/]feature-${surface}-(\\$\\{theme\\}|light|dark)\\.png`), `the ${surface} screenshots`);
  }
  for (const narrow of ['cost-tab', 'requirements-bar']) {
    assert.match(s, new RegExp(`[\`'/]feature-${narrow}-narrow-(\\$\\{theme\\}|light)\\.png`), `the narrow ${narrow} screenshot`);
  }
});

// Slice 7 (D17): confirm in place — the tip beside the reason, the reason's link, the chat-less pointers.
test('s7: confirm-in-place phase', () => {
  const s = src();
  assert.match(s, /process\.env\.CONFIRM_ONLY === '1'\) \{ await confirmInPlacePhase\(\); await finish\(\); \}/, 'the CONFIRM_ONLY=1 gate');
  const at = s.indexOf('async function confirmInPlacePhase(');
  assert.ok(at >= 0, 'the confirm-in-place phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /THEMES/, 'both themes');
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /375|WIDTH/, 'and the narrow head');
  for (const needle of ['.rd-tip', '.run-status-link', '[data-ship-card]', 'activeElement', '#40']) assert.ok(body.includes(needle), needle);
  // A real hover, the rects, and that the tip is on top where it is drawn.
  for (const needle of ['Input.dispatchMouseEvent', 'getBoundingClientRect', 'elementFromPoint']) assert.ok(s.includes(needle), needle);
  for (const name of ['feature-confirm-tip', 'feature-confirm-reason', 'runs-confirm-needs', 'feature-chatless-waiting', 'ship-pr-named-once',
    'chat-card-confirm', 'prototype-stop-feature-link']) {
    assert.match(s, new RegExp(`[\`'/]${name}-(\\$\\{theme\\}|light|dark)\\.png`), `the ${name} screenshots`);
  }
});

// Shaper small runs slice 8 (D14): the gap question, light and dark.
test('the gap question: a 2-gap gate stop, shot in both themes', () => {
  const s = src();
  assert.match(s, /const VSTOP = verifyStop\(/);
  assert.match(s, /shot\(`app-verifier-gap-question-\$\{theme\}`\)/);
});


// Slice 9 (R-po-4, D15): the Verifier's note on the Ship card, before and after Acknowledge.
test('the SHIP_NOTES_ONLY phase: the note row before and after Acknowledge, 1280px, light and dark, 4 screenshots', () => {
  const s = src();
  assert.ok(/process\.env\.SHIP_NOTES_ONLY === '1'\) \{ await shipNotesPhase\(\); await finish\(\); \}/.test(s), 'the SHIP_NOTES_ONLY=1 gate');
  const at = s.indexOf('async function shipNotesPhase(');
  assert.ok(at >= 0, 'the Ship notes phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /shipFeature\(/, 'a seeded marked feature with every run done');
  assert.match(body, /setVerify\(/, 'its clean Verifier check on record');
  assert.match(body, /findings/, 'with one note');
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  for (const needle of ['ship-create', 'disabled', 'btn-primary', 'acknowledged']) assert.ok(body.includes(needle), needle);
  assert.match(body, /ship-ack-note-1|Acknowledge/, 'the note row\'s button');
  assert.match(body, /click/i, 'Acknowledge is clicked');
  assert.match(body, /check\(/, 'what it shoots is asserted');
  // Before Acknowledge the note is said once: no reason line, and Create described by the state line.
  for (const needle of ['whys', 'describedBy', '.ask-shipcard-why', 'ask-shipcard-gap', 'aria-describedby', '.ask-shipcard-stats']) {
    assert.ok(body.includes(needle), needle);
  }
  assert.match(body, /before\.whys === 0/, 'the before state has no reason line');
  assert.match(body, /before\.describedBy\b/, 'and Create is described by the state line');
  // The four files, with these exact names (no prefix), in SHOTS_DIR.
  for (const when of ['before', 'after']) {
    assert.match(s, new RegExp(`[\`'/]app-ship-note-${when}-(\\$\\{theme\\}|light|dark)\\.png`), `the ${when} screenshots`);
  }
});

// Slice 10 (R-po-5, step 7): the card log's "decided by" lines and the gap question with an Away answer, light and dark.
test('the GAP_AWAY_ONLY phase: the log lines and the held gap question, asserted before 4 screenshots in both themes', () => {
  const s = src();
  const gate = s.match(/process\.env\.GAP_AWAY_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the GAP_AWAY_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the Away gap phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /answeredBy/, 'a seeded check record that says who answered');
  assert.match(body, /R-po-1/);
  assert.match(body, /R-po-2/);
  assert.match(body, /'away'/);
  assert.match(body, /'you'/);
  assert.match(body, /decided by Away mode|ANSWERED_BY_WORDS/, 'the Away log line is asserted');
  assert.match(body, /decided by you|ANSWERED_BY_WORDS/, 'the log line of the person is asserted');
  assert.match(body, /decided/, 'the live gap stop has a decided row');
  assert.match(body, /judgement/, 'and a held judgement gap');
  assert.match(body, /Held for you/);
  assert.match(body, /check\(/, 'what it shoots is asserted');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  for (const name of ['app-verifier-away-log', 'app-verifier-away-question']) {
    assert.match(s, new RegExp(`${name}-(\\$\\{theme\\}|light|dark)`), `${name} screenshots`);
  }
});

// Slice 11 (R-ux-4, D15): the Verifier's check row and the failed group row, light and dark.
test('the VERIFIER_ROWS_ONLY phase: the failed round on its group, asserted before the screenshots in both themes at 1280px', () => {
  const s = src();
  assert.ok(/process\.env\.VERIFIER_ROWS_ONLY === '1'\) \{ await verifierRowsPhase\(\); await finish\(\); \}/.test(s), 'the VERIFIER_ROWS_ONLY=1 gate');
  const at = s.indexOf('async function verifierRowsPhase(');
  assert.ok(at >= 0, 'the Verifier rows phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /seedFeature\(/, 'a seeded marked feature');
  assert.match(body, /'error'/, 'a failed Verifier pipeline');
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  for (const needle of ['data-row-key', 'Verifier · round 2 · 1 gap', 'Verifier round 2 failed · 1 gap', 'check(']) assert.ok(body.includes(needle), needle);
  assert.match(s, /[`'/]runs-group-verifier-failed-(\$\{theme\}|light|dark)\.png/, 'the screenshots');
});

test('the STOP_LIST_ONLY phase asserts 3 lines, 0 then 1 step cards, and no paused line before each screenshot, in both themes at 1280px', () => {
  const s = src();
  assert.ok(/process\.env\.STOP_LIST_ONLY === '1'\) \{ await stopListPhase\(\); await finish\(\); \}/.test(s), 'the STOP_LIST_ONLY=1 gate');
  const at = s.indexOf('async function stopListPhase(');
  assert.ok(at >= 0, 'the stop list phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /seedFeature\(/, 'a seeded marked feature');
  assert.match(body, /liveRun\(/, 'its runs at a stop are live');
  assert.match(body, /'paused'/, 'one run is paused');
  assert.match(body, /#feature\//, 'the feature page');
  assert.match(body, /\bcard\(/, 'the Chat card');
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /360/, 'and the 360px card');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  for (const needle of ['chat-rc-stop-q', 'data-run="5"', 'chat-rc-stop-line', 'data-run="3"']) assert.ok(body.includes(needle), needle);
  assert.match(body, /click/i, 'line 2 is clicked');
  assert.match(body, /check\(/, 'what it shoots is asserted');
  assert.ok(body.indexOf('check(') < body.indexOf('capture('), 'asserted before the first screenshot');
  // The nine files: card and feature, closed and open, light and dark (no prefix), plus the 360px light card.
  assert.match(s, /[`'/]stop-list-(?:\$\{\w+\}|card|feature)-(?:\$\{\w+\}|closed)-(?:\$\{\w+\}|light|dark)\.png/, 'the closed shots');
  assert.match(s, /[`'/]stop-list-(?:\$\{\w+\}|card|feature)-(?:\$\{\w+\}|open)-(?:\$\{\w+\}|light|dark)\.png/, 'the open shots');
  assert.match(s, /stop-list-card-closed-light-360\.png/, 'the narrow shot');
});

// Slice 15 (R-qa-3, D11): the Labs entry's words, light and dark.
test('the LABS_WORDS_ONLY phase: the Labs entry says small runs only in its title, asserted before 2 screenshots at 1280px', () => {
  const s = src();
  const gate = s.match(/process\.env\.LABS_WORDS_ONLY === '1'\) \{ await (\w+)\(\); await finish\(\); \}/);
  assert.ok(gate, 'the LABS_WORDS_ONLY=1 gate');
  const at = s.indexOf(`async function ${gate[1]}(`);
  assert.ok(at >= 0, 'the Labs words phase');
  const body = s.slice(at, s.indexOf('\n}\n', at));
  assert.match(body, /1280/, 'at 1280px');
  assert.match(body, /THEMES|'dark'/, 'both themes');
  // The Labs row, its title and description, every tooltip and aria label, and the small-runs match.
  for (const needle of ['settings/experimental/shaperSmallRuns', '#flag-row-shaperSmallRuns', '.flag-row-title', '.flag-row-desc',
    'aria-label', 'title', 'small[ -]runs', 'Shaper small runs']) {
    assert.ok(body.includes(needle), needle);
  }
  assert.match(body, /check\(/, 'what it shoots is asserted');
  assert.ok(body.indexOf('check(') < body.indexOf('capture('), 'asserted before the first screenshot');
  assert.match(s, /[`'/]app-labs-words-(\$\{theme\}|light|dark)\.png/, 'the screenshots');
});
