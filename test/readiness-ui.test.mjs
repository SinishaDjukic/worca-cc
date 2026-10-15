// test/readiness-ui.test.mjs — the agent-readiness wiring in ui/public/app.js: chips in the projects
// list, the breakdown flyout, the ignore list (flyout link + project settings card) and the
// readiness-changed WebSocket frame. app.js is a browser monolith that cannot be imported under node,
// so — like ui-id-consistency.test.mjs — these read its source for the contract each piece must keep.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');

/** Source of `function <name>(…) {…}` up to the next top-level `}` line. */
function fnSource(name) {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(app);
  assert.ok(m, `function ${name} exists in app.js`);
  const end = app.indexOf('\n}\n', m.index);
  return app.slice(m.index, end + 3);
}

describe('readiness UI: chips in the projects list', () => {
  it('imports the chip renderer statically', () => {
    assert.match(app, /import \{ renderReadinessChip, readinessAddedToast, readinessMenuModel, renderLevelLabel, LEVEL_WORDS \} from '\.\/readiness-chip\.mjs';/);
  });

  it('turns a readiness-added frame into the one-time toast', () => {
    assert.match(app, /msg\.type === 'readiness-added'[\s\S]{0,200}readinessAddedToast\(msg/);
    assert.match(app, /notify\(toast\)/);
  });

  it('renderProjectsList paints the chips after the list is built', () => {
    assert.match(fnSource('renderProjectsList'), /paintReadinessChips\(\)/);
  });

  it('paintReadinessChips renders from the project summary into the row sync column', () => {
    const src = fnSource('paintReadinessChips');
    assert.match(src, /renderReadinessChip\(/);
    assert.match(src, /\.pl-sync/);
  });

  it('each chip is the trigger of one createFlyout popup', () => {
    assert.match(fnSource('newReadinessChip'), /createFlyout\(/);
  });

  it('a chip click never opens the project page', () => {
    assert.match(app, /closest\('\.pl-rd'\)/, 'the row click handler skips clicks that start on a chip');
  });
});

describe('readiness UI: popover v2', () => {
  it('opens below the chip', () => {
    assert.match(fnSource('newReadinessChip'), /mode: 'below'/);
  });
  it('builds from the pure model and never from innerHTML', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /readinessMenuModel\(/);
    assert.doesNotMatch(src, /innerHTML/);
  });
  it('has a fixed head, a scrolling body and a fixed foot', () => {
    const src = fnSource('buildReadinessMenu');
    for (const cls of ['rp-head', 'rp-body', 'rp-foot']) assert.match(src, new RegExp(cls));
  });
  it('offers "Not used here" with an Undo toast that restores the previous value', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /Not used here/);
    assert.match(src, /setReadinessTool\(key, t\.name, 'unused'\)/);
    assert.match(src, /label: 'Undo'/);
    assert.match(src, /setReadinessTool\(key, t\.name, prev\)/);
  });
  it('the run engine gets the hint instead of the button', () => {
    assert.match(fnSource('buildReadinessMenu'), /Runs use this tool\. To stop judging it, change the engine in Settings\./);
  });
  it('the not-judged line links to project settings', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /Not judged: /);
    assert.match(src, /Change in Settings/);
    assert.match(src, /openReadinessSettings\(key\)/);
  });
  it('the header count opens the passed box', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /const count = el\('button', 'rp-count'/);
    assert.match(src, /count\.addEventListener\('click', \(\) => \{ passedBox\.open = true/);
  });
  it('ignored checks can be restored from the popover', () => {
    assert.match(fnSource('buildReadinessMenu'), /Stop ignoring/);
  });
  it('no middle dot in any readiness copy', () => {
    for (const name of ['buildReadinessMenu', 'fillReadinessCard']) assert.doesNotMatch(fnSource(name), /·/);
  });
  it('setReadinessTool writes the whole map and returns the previous value', () => {
    const src = fnSource('setReadinessTool');
    assert.match(src, /'readiness\.tools'/);
    assert.match(src, /return prev/);
  });
});

describe('readiness UI: ignore list and recheck', () => {
  it('ignoring a check PATCHes the project settings with the extended readiness.ignore list', () => {
    const src = fnSource('setReadinessIgnore');
    assert.match(src, /\/settings`/);
    assert.match(src, /method: 'PATCH'/);
    assert.match(src, /'readiness\.ignore'/);
  });

  it('recheck re-evaluates past the cache', () => {
    assert.match(fnSource('fetchReadinessReport'), /refresh=1/);
    assert.match(fnSource('buildReadinessMenu'), /Recheck[\s\S]{0,300}refresh: true/);
  });

  it('an error toast uses the err tone', () => {
    assert.match(fnSource('buildReadinessMenu'), /tone: 'err'/);
  });
});

describe('readiness UI: project settings card', () => {
  it('buildPdSettings appends the Agent Readiness card', () => {
    assert.match(fnSource('buildPdSettings'), /buildReadinessSettingsCard\(/);
  });

  it('the card toggles each check through readiness.ignore with a switch', () => {
    assert.match(fnSource('buildReadinessSettingsCard'), /readiness-settings-card/);
    const src = fnSource('fillReadinessCard');
    assert.match(src, /Agent Readiness/);
    assert.match(src, /type = 'checkbox'/);
    assert.match(src, /setReadinessIgnore\(/);
  });
});

describe('readiness UI: WebSocket frame', () => {
  it('readiness-changed refetches the project report and repaints', () => {
    const i = app.indexOf("msg.type === 'readiness-changed'");
    assert.ok(i > 0, 'handled in handleServerMessage');
    const block = app.slice(i, i + 900);
    assert.match(block, /refreshReadiness\(/);
    assert.match(block, /return;/);
  });

  it('readiness-changed also repaints an open popover or a settings card outside the Projects page', () => {
    const i = app.indexOf("msg.type === 'readiness-changed'");
    const block = app.slice(i, i + 600);
    assert.match(block, /readiness-settings-card/);
    assert.doesNotMatch(block, /currentView\(\) === 'projects'\) void refreshReadiness/);
  });

  it('a refreshed report becomes the row summary with its counts', () => {
    assert.match(fnSource('applyReadinessReport'), /summaryOfClient\(report\)/);
    assert.match(app, /const summaryOfClient = \(r\) => \(\{ level: r\.level, failingCount: r\.counts\.mustFix \+ r\.counts\.shouldFix, \.\.\.r\.counts \}\);/);
  });
});
