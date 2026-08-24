// test/ui-ask-style.test.mjs — raw style.css assertions for the Ask Worca
// section (spec §10.3). Same technique as test/ui-diff-style.test.mjs /
// ui-running-routing's ruleBody: anchored selector match, body capture stops at
// the first closing brace — hence the "no comments in rule bodies" house rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

test('ui-ask-style: the dock is a fixed, click-through layer at z-40 with the rail arms', () => {
  const dock = ruleBody('.ask-dock');
  assert.ok(dock, '.ask-dock rule exists');
  assert.match(dock, /position:fixed/);
  assert.match(dock, /z-index:40/);
  assert.match(dock, /pointer-events:none/);
  assert.match(dock, /left:298px/);
  const collapsed = ruleBody('body.rail-collapsed .ask-dock');
  assert.ok(collapsed, 'collapsed-rail arm exists');
  assert.match(collapsed, /left:76px/);
  // the children restore pointer events
  assert.match(ruleBody('.ask-sheet') || '', /pointer-events:auto/);
  assert.match(ruleBody('.ask-pill') || '', /pointer-events:auto/);
});

test('ui-ask-style: below 1080px the dock spans the viewport EVEN with a collapsed rail', () => {
  // the media rule must carry the higher-specificity selector too, or
  // body.rail-collapsed .ask-dock{left:76px} wins below the breakpoint
  const media = css.slice(css.indexOf('@media (max-width:1080px)', css.indexOf('.ask-dock')));
  const block = media.slice(0, media.indexOf('}', media.indexOf('{', media.indexOf('{') + 1)) + 1);
  assert.match(block, /body\.rail-collapsed \.ask-dock/, 'media rule restates the rail-collapsed selector');
  assert.match(block, /left:0/);
});

test('ui-ask-style: the sheet uses wr-rise and the card radius token', () => {
  const sheet = ruleBody('.ask-sheet');
  assert.match(sheet, /animation:wr-rise/);
  assert.match(sheet, /var\(--r-card\)/);
  assert.match(sheet, /width:min\(782px/);
  assert.match(sheet, /height:min\(669px/);
});

test('ui-ask-style: hidden twins exist for the hideable ask elements', () => {
  for (const sel of ['.ask-sheet[hidden]', '.ask-pill[hidden]', '.ask-jump[hidden]', '.ask-composer-msg[hidden]', '.ask-chips[hidden]',
    '.ask-wt-btn[hidden]']) {   // shares display:flex from .ask-agents-btn, so without the twin it never hides (jsdom cannot catch it)
    const body = ruleBody(sel);
    assert.ok(body, `${sel} twin exists`);
    assert.match(body, /display:none/);
  }
});

test('ui-ask-style: the ask section spends tokens, not hex', () => {
  const start = css.indexOf('/* ---------- Ask Worca');
  assert.ok(start !== -1, 'the ask section comment exists');
  const end = css.indexOf('/* ---------- reduced motion for the Running redesign');
  assert.ok(end > start, 'the ask section sits before the final reduced-motion block');
  const section = css.slice(start, end);
  assert.equal((section.match(/#[0-9a-fA-F]{6}\b/g) || []).length, 0, 'no 6-digit hex literals in the ask section');
  assert.ok(!/#[0-9a-fA-F]{3}\b/.test(section.replace(/#fff\b/g, '')), 'no non-#fff 3-digit hex either');
});

test('ui-ask-style: the FINAL reduced-motion block neutralises the dock', () => {
  const guard = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(css.slice(guard).includes('.ask-dock *{animation:none !important;}'), 'the last block carries the ask arm');
  // every ask animation reference precedes the guard
  const lastAskAnim = css.lastIndexOf('animation:wr-rise');
  assert.ok(lastAskAnim < guard, 'wr-rise uses sit before the final reduced-motion block');
});

test('ui-ask-style: the hljs variable block now feeds .ask-md too', () => {
  assert.match(css, /\.hd-diff-pane,\.ask-md\{\s*--hd-syntax-comment/, 'selector widened without restating hexes');
  const count = (css.match(/--hd-syntax-comment:#/g) || []).length;
  assert.equal(count, 1, 'the six syntax hexes still appear exactly once');
});

test('ui-ask-style: dots reuse wr-pulse; the pill and popovers are tokened', () => {
  assert.match(ruleBody('.ask-dot-run') || '', /animation:wr-pulse/);
  assert.match(ruleBody('.ask-dot-run') || '', /var\(--violet\)/);
  assert.match(ruleBody('.ask-dot-done') || '', /var\(--green\)/);
  assert.match(ruleBody('.ask-pill') || '', /border-radius:999px/);
  assert.match(ruleBody('.ask-pop') || '', /position:absolute/);
  assert.match(ruleBody('.ask-error-line') || '', /var\(--red-ink\)/);
});

test('ui-ask-style: composer textarea overrides the global textarea rules', () => {
  const input = ruleBody('.ask-composer textarea.ask-input');
  assert.ok(input, 'the higher-specificity selector exists (spec §10.3)');
  assert.match(input, /min-height:0/);
  assert.match(input, /max-height:120px/);
  assert.match(input, /resize:none/);
});
