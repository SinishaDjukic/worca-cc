// test/ui-stage-row-blurb.test.mjs — New-Pipeline stage rows must SHOW the whole
// caption, not ellipsize it mid-sentence (web-UI review F1: the longer blurbs no
// longer fit the ~235px .meta column, so every row read "Writes the code from
// the approved pl…"). The stage NAME keeps its single-line ellipsis; only the
// caption wraps, clamped at 2 lines so the row height stays bounded.
//
// The rows are painted per agent node by renderNodeRows now — the five
// hardcoded stage rows (and their blurbs) are gone from index.html — so what is
// pinned here is the CSS the painted rows still reuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Comments stripped first: a /* … */ block above a rule would otherwise be
// captured as part of its selector list and break the exact-match below.
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');

// Every rule body whose selector LIST contains `selector` exactly. Unlike the
// first-match ruleBody() idiom this cannot be fooled by a grouped rule that
// re-declares the same selector further down the sheet.
function rules(selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}

test('the stage-row caption wraps instead of ellipsizing the blurb away', () => {
  const bodies = rules('.stage-cfg .meta small');
  assert.ok(bodies.length, '.stage-cfg .meta small rule must exist');
  for (const body of bodies) {
    assert.doesNotMatch(body, /white-space:\s*nowrap/, 'caption must not be forced onto one line');
    assert.doesNotMatch(body, /text-overflow:\s*ellipsis/, 'caption must not ellipsize');
  }
  const all = bodies.join(';');
  assert.match(all, /-webkit-line-clamp:\s*2/, 'caption clamps at 2 lines so rows stay compact');
  assert.match(all, /overflow-wrap:\s*anywhere/, 'a long unbroken token still cannot widen the column');
});

test('the stage-row NAME keeps its single-line ellipsis', () => {
  const all = rules('.stage-cfg .meta b').join(';');
  assert.ok(all, '.stage-cfg .meta b rule must exist');
  assert.match(all, /white-space:\s*nowrap/, 'node label stays on one line');
  assert.match(all, /text-overflow:\s*ellipsis/, 'node label ellipsizes when too long');
});
