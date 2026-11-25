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
  assert.match(s, /await d2Phase\(\);\nawait d3Phase\(\);\nawait finish\(\);\n$/, 'D2 before D3, D3 last, before the verdict');
});

test('d3Phase seeds, measures both lists with the width, pairs with the prototype feature screen, and runs last', () => {
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
