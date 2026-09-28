// test/docs-ask-forms.test.mjs
// The plugin authoring skill is the contract plugin authors read. Two things it
// must never get wrong: "plugins ship no code" (still true — forms are DECLARED)
// and the API a form needs. The worked example is the form the repo actually
// ships, so the two can never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORCA_ASK_FORMS_API } from '../src/core/plugin-api.mjs';
import { validateFormDef } from '../src/shared/forms/form-def.mjs';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SKILL = read('../.claude/skills/creating-worca-cc-plugins/SKILL.md');
const README = read('../README.md');
const REVIEWER = JSON.parse(read('../agents/reviewer.meta.json'));

test('the skill no longer says a plugin can never ship UI', () => {
  assert.doesNotMatch(SKILL, /There is no way to ship a custom component/,
    'superseded: a plugin can now ship DECLARED forms');
  assert.match(SKILL, /ships \*\*no code that runs in the browser\*\*/, 'the true invariant, restated');
  assert.match(SKILL, /declared forms/i);
});

test('the skill has an Ask forms section naming the API, the catalog and --strict', () => {
  assert.match(SKILL, /^## Ask forms \(API 4\)/m);
  assert.match(SKILL, new RegExp(`">=${WORCA_ASK_FORMS_API} <${WORCA_ASK_FORMS_API + 1}"`));
  assert.match(SKILL, /--strict/);
  assert.match(SKILL, /negotiate/i);
  assert.match(SKILL, /review-list/, 'the widget catalog is listed');
  assert.match(SKILL, /8 forms per agent/);
  assert.match(SKILL, /64 KB/);
  assert.match(SKILL, /\^\[a-z\]\[a-z0-9-\]\{0,47\}\$/, 'the form id rule, verbatim');
  assert.match(SKILL, /1\u2013120 characters, mandatory/, 'title is mandatory and capped');
});

test('the skill describes the REAL dialect, not the spec\u2019s first draft of it', () => {
  for (const kw of ['patternHint', 'defaultFrom', 'enumFrom', 'accept', 'uniqueItems', 'multipleOf']) {
    assert.match(SKILL, new RegExp(`\\b${kw}\\b`), `the dialect list is missing ${kw}`);
  }
  assert.match(SKILL, /opaque object/i, 'a data-side object with no properties is legal and useful');
  assert.match(SKILL, /"surface": "web"/, 'a form may declare that a text answer is meaningless');
  assert.match(SKILL, /an item may not depend on its own field/i);
  assert.match(SKILL, /mutually exclusive/i, 'enum vs enumFrom');
});

test('the skill carries the layout-item key table, including suggest on select', () => {
  assert.match(SKILL, /^### Layout item keys$/m);
  assert.match(SKILL, /`widget`, `field`, `bind`, `label`, `help`, `when`, `requires`, `fallback`/);
  assert.match(SKILL, /\*\*`suggest`\*\*/, 'suggest is a LAYOUT key of select, never a schema keyword');
  assert.match(SKILL, /notePlaceholder/);
  assert.match(SKILL, /beforeLabel/);
});

test('the skill states BOTH gates, including the auto-answer rule authors trip on', () => {
  assert.match(SKILL, /^### Two gates you will meet$/m);
  assert.match(SKILL, /`example` is mandatory/);
  assert.match(SKILL, /auto answer built from `example` must be a valid\s+answer/);
  assert.match(SKILL, /always-visible free-text/i,
    'the rule that fails a form: --yes could never answer such a field');
  assert.match(SKILL, /resumed once with the error list/, 'gate 2 gives the agent one repair');
  assert.match(SKILL, /layout#2/, 'errors name the item by its reading position');
});

test('the skill’s worked example IS the form the repo ships, and it passes gate 1', () => {
  const m = SKILL.match(/```json\n(\{\s*"version": 1,\s*\n\s*"title": "Confirm these findings",[\s\S]*?)\n```/);
  assert.ok(m, 'the Ask forms section carries the review-findings def as one json block');
  const def = JSON.parse(m[1]);
  assert.deepEqual(def, REVIEWER.ask.forms['review-findings'],
    'the doc copies the shipped form byte-for-byte — no hand-edited drift');
  assert.deepEqual(validateFormDef(def, { id: 'review-findings' }).errors, []);
});

test('the skill shows what the agent WRITES and what it RECEIVES back', () => {
  assert.match(SKILL, /"form": "review-findings",\n\s*"data"/, 'the ask-time payload');
  assert.match(SKILL, /"values"/, 'the resume payload');
});

test('the skill names the API-4 gate as a common mistake', () => {
  assert.match(SKILL, /\| An `ask` block on a plugin declaring API 3/);
});

test('the skill says the consent line is derived from `accept` with no code run', () => {
  assert.match(SKILL, /which file types they may display from the run folder/);
  assert.match(SKILL, /without running a line of your code/);
});

test('the README says agents can ask through forms, and that plugins can ship them', () => {
  assert.match(README, /ask form/i);
  assert.match(README, /### Agents/);
  assert.match(README, /### Plugins & chat/);
});

test('every doc touched here says "worca", never "worca-cc", in prose', () => {
  for (const [name, text] of [['SKILL.md', SKILL]]) {
    const section = text.slice(text.indexOf('## Ask forms (API 4)'), text.indexOf('## Scripts (API 3)'));
    assert.ok(section.length > 200, `${name}: the Ask forms section is missing or empty`);
    // `worca-cc-plugin.json` and `worca-cc-api` are identifiers, not prose.
    const prose = section.replace(/worca-cc-plugin\.json/g, '').replace(/worca-cc-api/g, '');
    assert.doesNotMatch(prose, /worca-cc/, `${name}: product name is "worca" in prose`);
  }
});
