// test/ui-ask-style.test.mjs — raw style.css assertions for the Ask Worca
// section (spec §10.3). Same technique as ui-running-routing's ruleBody: anchored selector match, body capture stops at
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

test('ui-ask-style: hidden twins exist for the hideable ask elements', () => {
  for (const sel of ['.ask-jump[hidden]', '.ask-composer-msg[hidden]', '.ask-chips[hidden]',
    '.ask-mcp-btn[hidden]',      // shares display:inline-flex from .ask-scope-btn, so without the twin it never hides (jsdom cannot catch it)
    '.ask-queue[hidden]', '.ask-queue-resume[hidden]']) {
    const body = ruleBody(sel);
    assert.ok(body, `${sel} twin exists`);
    assert.match(body, /display:none/);
  }
});

test('ui-ask-style: toasts stay above the corner button', () => {
  const clearance = Number(css.match(/--ask-dock-clearance:(\d+)px/)[1]);
  assert.match(ruleBody('.toasts'), /bottom:calc\(var\(--ask-dock-clearance\) \+ env\(safe-area-inset-bottom,0px\)\)/);
  assert.ok(clearance >= 24 + 48, `toasts' bottom edge (${clearance}px) clears the button's top edge (72px)`);
});
