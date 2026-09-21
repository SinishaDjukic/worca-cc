// test/ui-ask-form-style.test.mjs — the ask-form stylesheet family. jsdom computes
// no layout, so the contract is asserted on the stylesheet TEXT, exactly like
// test/ui-question-panel.test.mjs. Two things matter most: no colour literal, and
// an [hidden] guard on every rule that sets display (an author display rule beats
// the hidden attribute, which is what `when` relies on).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
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

test('the family exists and is anchored on the question panel wash', () => {
  assert.ok(afBodies().length >= 25, 'the .af- family is present');
  const form = ruleBody('.af-form');
  assert.ok(form, '.af-form rule missing');
  assert.match(form, /display:\s*flex/);
  assert.match(ruleBody('.af-label'), /var\(--ink\)/);
  assert.match(ruleBody('.af-err'), /var\(--red-ink\)/);
  assert.match(ruleBody('.af-choice.on'), /var\(--green-bg\)/);   // ruleBody escapes; pass raw selectors
  assert.match(ruleBody('.af-pill[data-tone="bad"]'), /var\(--red-ink\)/, 'the closed tone families are styled');
});

test('no colour literal anywhere in the family, and no media query was added', () => {
  const offenders = [];
  for (const [sel, body] of afBodies()) {
    const noData = body.replace(/url\("data:[^"]*"\)/g, 'url(DATA)');
    const hits = noData.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/gi);
    if (hits) offenders.push(`${sel}: ${hits.join(' ')}`);
  }
  assert.deepEqual(offenders, []);
  assert.ok(!/prefers-color-scheme/.test(bare), 'both themes come from light-dark() tokens');
});

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

test('the .af-nofile placeholder is styled and is not a broken-image box (X14)', () => {
  const body = ruleBody('.af-nofile');
  assert.ok(body, '.af-nofile rule missing');
  assert.match(body, /var\(--/, 'tokens only');
});

test('the ask family never joins a selector list with a probed question-panel rule', () => {
  for (const [sel] of afBodies()) {
    for (const probed of ['.qpanel', '.qopt', '.qfree', '.qpanel-foot', '.rd-questions .qpanel']) {
      assert.ok(!sel.split(',').map((s) => s.trim()).includes(probed),
        `${sel} would shadow the ruleBody() probe for ${probed}`);
    }
  }
});

test('focus-visible and the keyboard affordances are styled', () => {
  assert.match(ruleBody('.af-choice:focus-visible'), /outline:\s*2px solid var\(--ink\)/);
  assert.match(ruleBody('.af-icon-btn:focus-visible'), /outline:\s*2px solid var\(--ink\)/);
  assert.match(ruleBody('.af-tab:focus-visible'), /outline:\s*2px solid var\(--ink\)/);
  assert.match(ruleBody('.af-inp:focus'), /var\(--green\)/);
});

test('the detail screen scales the family up, like the clarify body', () => {
  assert.ok(ruleBody('.rd-questions .af-choice'), 'the detail override exists');
  assert.ok(ruleBody('.rd-questions .af-label'), 'and covers the labels');
});
