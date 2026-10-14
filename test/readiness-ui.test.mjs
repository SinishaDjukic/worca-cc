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
    assert.match(app, /import \{ renderReadinessChip, readinessAddedToast \} from '\.\/readiness-chip\.mjs';/);
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

describe('readiness UI: breakdown flyout', () => {
  it('lists failing checks of the primary engine with title, detail and fix as text', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /failing/);
    assert.match(src, /\.fix/);
    assert.doesNotMatch(src, /innerHTML/, 'check text is server data: textContent only');
  });

  it('offers an ignore link per failing check and a Recheck button', () => {
    const src = fnSource('buildReadinessMenu');
    assert.match(src, /Ignore for this project/);
    assert.match(src, /Recheck/);
  });

  it('ignoring a check PATCHes the project settings with the extended readiness.ignore list', () => {
    const src = fnSource('setReadinessIgnore');
    assert.match(src, /\/settings`/);
    assert.match(src, /method: 'PATCH'/);
    assert.match(src, /'readiness\.ignore'/);
  });

  it('recheck re-evaluates past the cache', () => {
    assert.match(fnSource('fetchReadinessReport'), /refresh=1/);
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
});
