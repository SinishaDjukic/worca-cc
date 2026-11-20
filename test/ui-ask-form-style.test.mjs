// test/ui-ask-form-style.test.mjs — the ask-form stylesheet family. jsdom computes
// no layout, so the contract is asserted on the stylesheet TEXT, exactly like
// test/ui-question-panel.test.mjs. What it pins: an [hidden] guard on every rule
// that sets display (an author display rule beats the hidden attribute, which is
// what `when` relies on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const css = readStyleCss();
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = bare.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}
/** Every `{ … }` body whose selector mentions an .af- class. */
function afBodies() {
  const out = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(bare)) !== null) if (/\.af-/.test(m[1])) out.push([m[1].trim(), m[2]]);
  return out;
}

test('[hidden] is guarded blanket-wide AND per class (W19)', () => {
  // `when` is implemented as el.hidden = … on an EXISTING node (focus must survive).
  // The UA rule loses to any author `display`, so the family needs its own.
  const blanket = bare.match(/\.af-form \[hidden\][^{]*\{([^}]*)\}/);
  assert.ok(blanket, '.af-form [hidden] blanket rule missing');
  assert.match(blanket[1], /display:\s*none/);
  assert.ok(/\.af-form\[hidden\]/.test(bare), 'the root itself is guarded too');
  assert.ok(!/\.af-[^{}]*!important/.test(bare), 'specificity, not !important');
  for (const sel of ['.af-err[hidden]', '.af-rv-note[hidden]', '.af-pane[hidden]', '.af-open[hidden]']) {
    const body = ruleBody(sel);
    assert.ok(body, `${sel} rule missing`);
    assert.match(body, /display:\s*none/);
  }
  // Every .af- rule that sets `display` is a candidate for being hidden by `when`.
  // The blanket rule covers them; this asserts none of them re-raises specificity
  // past (0,1,1) with a display declaration that would defeat it.
  for (const [sel, body] of afBodies()) {
    if (!/display\s*:/.test(body)) continue;
    const classes = (sel.match(/\.[-\w]+/g) || []).length;
    assert.ok(classes <= 1 || /\[hidden\]/.test(sel) || /\.rd-questions/.test(sel),
      `${sel} sets display at a specificity the blanket [hidden] rule cannot beat`);
  }
});
