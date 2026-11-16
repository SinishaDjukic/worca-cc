// test/design-system-choice-note-narrow.test.mjs — gate.real-data F-cov23-05 (docs/rail/components.md ChoiceNote): at 390px
// the note clipped its 22px title, cut its message to two lines and drew every row on one grid row, over its ways out.
// The rules: a ChoiceNote's title wraps, each detail line takes its own row at any card width and is never clamped, and
// its rows and ways wrap their buttons under the words. jsdom has no layout, so this reads the cascade the app loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync('ui/public/stillhet/css/rail.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// the last declaration of `prop` among the rules whose selector list is exactly `sel` (later rules win at equal specificity)
const last = (sel, prop) => {
  let hit = null;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((x) => x.trim()).includes(sel)) continue;
    const d = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(m[2]); if (d) hit = { value: d[1].trim(), at: m.index };
  }
  return hit;
};
const at = (re) => { let i = -1; for (const m of css.matchAll(re)) i = m.index; return i; };

test('F-cov23-05: a ChoiceNote\'s title wraps instead of clipping', () => {
  assert.equal(last('.choice-note .rc-word', 'white-space')?.value, 'normal');
  assert.ok(last('.choice-note .rc-word', 'white-space').at > at(/\.rc-word\{[^}]*white-space:nowrap/g), 'after the status zone\'s nowrap');
});

test('F-cov23-05: each detail line has its own row and is never clamped, after the narrow card rule', () => {
  const row = last('.choice-note > .rc-detail', 'grid-row');
  assert.equal(row?.value, 'auto');
  assert.ok(row.at > at(/\.rc-zone > \.rc-detail\{grid-row:2;\}/g), 'after the 420px container rule that puts every detail on row 2');
  assert.equal(last('.choice-note > .rc-detail', 'display')?.value, 'block');
  assert.equal(last('.choice-note > .rc-detail', 'white-space')?.value, 'normal');
  assert.equal(last('.choice-note > .rc-detail', 'overflow')?.value, 'visible');
  assert.ok(last('.choice-note > .rc-detail', 'display').at > at(/\.rc-zone \.rc-detail\{[^}]*line-clamp/g), 'after the two-line clamp');
});

test('F-cov23-05: rows and ways wrap their buttons under the words', () => {
  for (const sel of ['.choice-note > .choice-note-row', '.choice-note > .choice-note-ways']) {
    assert.equal(last(sel, 'display')?.value, 'flex', sel);
    assert.equal(last(sel, 'flex-wrap')?.value, 'wrap', sel);
  }
});
