// test/ui-stage-row-blurb.test.mjs — New-Pipeline agent rows must SHOW the whole
// agent blurb, not ellipsize it mid-sentence (web-UI review F1: the longer blurbs
// no longer fit the old ~235px .meta column, so every row read "Writes the code
// from the approved pl…"). Since the accordion redesign the blurb lives in the
// OPENED row body (.agent-desc), where it has the full width and can wrap; the
// agent NAME in the collapsed head keeps its single-line ellipsis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Comments stripped first: a /* … */ block above a rule would otherwise be
// captured as part of its selector list and break the exact-match below.
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ');
const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');

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

test('the agent blurb wraps instead of ellipsizing away', () => {
  const bodies = rules('.agent-desc');
  assert.ok(bodies.length, '.agent-desc rule must exist');
  for (const body of bodies) {
    assert.doesNotMatch(body, /white-space:\s*nowrap/, 'blurb must not be forced onto one line');
    assert.doesNotMatch(body, /text-overflow:\s*ellipsis/, 'blurb must not ellipsize');
  }
  assert.match(bodies.join(';'), /overflow-wrap:\s*anywhere/, 'a long unbroken token cannot widen the row');
});

test('the collapsed row NAME keeps its single-line ellipsis', () => {
  const all = rules('.agent-name').join(';');
  assert.ok(all, '.agent-name rule must exist');
  assert.match(all, /white-space:\s*nowrap/, 'node label stays on one line');
  assert.match(all, /text-overflow:\s*ellipsis/, 'node label ellipsizes when too long');
});

test('the five built-in stage blurbs ship with the renderer', () => {
  // They moved out of index.html into DEFAULT_STAGE_META: the Default workflow's
  // rows are rendered, not hardcoded (newpipeline-ux-design.md §4.7).
  const appjs = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');
  for (const blurb of [
    'Turns hidden decisions into questions before planning',
    'Explores the codebase and writes the implementation plan',
    'Rewrites the latest plan into a tighter version',
    'Writes the code from the approved plan, strict TDD',
    'Reviews the implementation diff against the plan',
  ]) {
    assert.ok(appjs.includes(blurb), `DEFAULT_STAGE_META must carry: ${blurb}`);
  }
});
