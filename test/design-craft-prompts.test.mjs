// test/design-craft-prompts.test.mjs — the Craft rules of a Design build (src/core/design/prompts.mjs): what makes a
// design look made on purpose when the brief brings no brand. Every kind's lead and builders read the shared rules,
// the lead also sets the design system and the direction, a web page adds its motion rules, and the lead's last pass
// checks the sections against them. The web kit CONTRACT says the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { builderSystemPrompt, integratePrompt, leadChangePrompt, leadSystemPrompt, leadTarget, planFixPrompt } from '../src/core/design/prompts.mjs';

const KINDS = ['web', 'presentation', 'pitch', 'video'];
const kit = (kind) => readFileSync(new URL(`../assets/design-kit/${kind}/CONTRACT.md`, import.meta.url), 'utf8');

/** One line of the prompts for each rule a design is held to; the motion rule is a web page's own (see below). */
const RULES = {
  'no filler badges, no embellishments': 'A badge, pill, eyebrow label, icon tile, divider, glow or background ornament stays only if the reader would miss what it says.',
  'no redundant labels': 'A label that repeats the heading, the logo or the thing beside it goes.',
  'no italic words': 'No italics for emphasis, and no word of a heading styled apart from the rest.',
  'mono only where needed': 'Monospace only for code, commands and file paths.',
  'a design system': 'Every colour, type size, radius, shadow and space comes from a token',
  'the actual product': 'A product, a screen or a result is shown as it is and large enough to read',
  'the main thing is large': 'The one thing a section is about is the largest thing in it.',
  'the right paddings': 'One padding for each kind of box, wherever it appears.',
  'a specific headline': 'A heading says one specific thing about this subject, never a slogan that would fit any other.',
  'consistent icons': 'Icons come from one family: one stroke width, one size for each role, `currentColor`.',
  'nested corner radius': 'inner radius = outer radius − padding, and 0 when that is negative.',
  'text contrast': 'Text contrast is at least 4.5:1 against what is really behind it.',
  'headline wrapping': 'A heading wraps with `text-wrap: balance`, never breaks inside a word or a hyphenated pair',
  'less explanation text': 'What a picture or a control already shows is not explained again.',
};

test('every kind\'s lead and builders read each Craft rule, once', () => {
  for (const kind of KINDS) {
    for (const [who, s] of [['lead', leadSystemPrompt({ kind })], ['builder', builderSystemPrompt({ kind })]]) {
      assert.equal(s.split('\n').filter((l) => l === 'Craft:').length, 1, `${kind} ${who}: one Craft block`);
      for (const [rule, line] of Object.entries(RULES)) assert.equal(s.split(line).length, 2, `${kind} ${who}: ${rule}`);
    }
  }
});

test('the lead sets the design system and, with no brand in the brief, one quiet direction in brand.md', () => {
  for (const kind of KINDS) {
    const s = leadSystemPrompt({ kind });
    for (const re of [/^Design:$/m, /Write `tokens\.css` whole/, /one type scale of at most 8 sizes/, /at most 4 radii/, /Style every shared piece once in `global\.css`/,
      /With no project and no reference in the brief, choose one direction and keep to it\./, /one accent, the system font stack, no background picture, no decoration/,
      /^5\. `brand\.md`: the look and the voice the builders follow\..* with none, the direction you chose\.$/m, /Each `brief` names the section's one point/]) assert.match(s, re, kind);
    assert.doesNotMatch(s, /when a project is given/, `${kind}: brand.md is always written`);
    assert.ok(s.indexOf('\nDesign:\n') < s.indexOf('\nCraft:\n') && s.indexOf('\nCraft:\n') < s.indexOf('\nFiles:\n'), `${kind}: after the plan shape, before the file rules`);
    assert.match(builderSystemPrompt({ kind }), /Before you write, Read `brand\.md`, beside `tokens\.css`, when it is there/, kind);
  }
});

test('motion that answers the person is a web page\'s rule; a deck and a video keep their kit\'s', () => {
  const lead = leadSystemPrompt(); const builder = builderSystemPrompt();
  for (const re of [/Motion is yours\./, /`--ease-out: cubic-bezier\(0\.23, 1, 0\.32, 1\)`/, /`--ease-in-out: cubic-bezier\(0\.77, 0, 0\.175, 1\)`/, /any other change under 300ms/,
    /`@media \(prefers-reduced-motion: reduce\)`/, /At most one entrance, for the first screen, written by you\. Sections add none\./,
    /The first screen shows the product itself, large/, /Never a wall of equal cards\./]) assert.match(lead, re);
  for (const re of [/Animate only what answers the person: a press, a hover, a state that changed, something that opened\./, /no entrance, no reveal on scroll, no loop, pulse, float or glow at rest/,
    /never `transition: all` and never ease-in/, /Nothing appears from `scale\(0\)`/, /`transform: scale\(0\.97\)` on `:active`/, /`@media \(hover: hover\) and \(pointer: fine\)`/,
    /never lorem ipsum/, /`min-width: 0`/, /`overflow-wrap: anywhere`/, /`font-variant-numeric: tabular-nums`/, /at most 65 characters wide/]) assert.match(builder, re);
  assert.ok(builder.endsWith('`font-variant-numeric: tabular-nums`.'), 'a web builder ends with its own block');
  for (const kind of ['presentation', 'pitch', 'video']) {
    for (const s of [leadSystemPrompt({ kind }), builderSystemPrompt({ kind })]) {
      for (const no of [/A web page:/, /cubic-bezier/, /:active/, /transition: all/, /Animate only what answers/]) assert.doesNotMatch(s, no, kind);
    }
  }
});

test('the lead\'s last pass checks the sections against the Craft rules and sends back only what breaks one', () => {
  const p = integratePrompt({ findings: [], integrationFile: '/w/integration.json' });
  assert.match(p, /Then check the sections against the Craft rules, worst first:/);
  assert.match(p, /Send back only a section that clearly breaks a rule, and name the rule in its `why`\./);
  assert.ok(p.indexOf('Craft rules') < p.indexOf('Fix what belongs to the global files yourself'), 'before the rework rules');
});

test('the web kit CONTRACT states the same rules, and no kit ties brand.md to a project', () => {
  const web = kit('web');
  assert.match(web, /^## Craft$/m);
  for (const [rule, line] of Object.entries(RULES)) {
    if (rule === 'the actual product') continue;   // the contract adds the web page's 12px floor inside that sentence
    assert.ok(web.includes(line), rule);
  }
  for (const must of ['A product, a screen or a result is shown as it is and large enough to read, text in it at least 12px', 'Animate only what answers the person',
    '`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`', 'choose one quiet direction', 'Never a wall of equal cards.']) assert.ok(web.includes(must), must);
  for (const kind of ['web', 'deck', 'video', 'document']) assert.doesNotMatch(kit(kind), /when a project is given/, kind);
});

test('a document\'s lead and builders read each Craft rule once, and worca\'s look by default', () => {
  const lead = leadSystemPrompt({ kind: 'document' }); const builder = builderSystemPrompt({ kind: 'document' });
  for (const [who, s] of [['lead', lead], ['builder', builder]]) {
    assert.equal(s.split('\n').filter((l) => l === 'Craft:').length, 1, `${who}: one Craft block`);
    for (const [rule, line] of Object.entries(RULES)) assert.equal(s.split(line).length, 2, `${who}: ${rule}`);
    assert.match(s, /Body text is plain, complete prose in short paragraphs, as long as the point needs and no longer\./, who);
    assert.doesNotMatch(s, /Body text is one or two short sentences\./, who);
  }
  for (const bullet of [
    '- The look comes from the first source that names one, in this order: 1. the brief or its attachments, when the person asks for a style, a brand or a reference; 2. a skill or the project, when a design or brand skill you have, the project\'s CLAUDE.md, rules or memory, or its own design system or brand files set one (when both do, follow the project\'s own and say so); 3. otherwise worca\'s own look. Never choose a look of your own.',
    '- worca\'s look is in the kit, beside CONTRACT.md: Read `worca-look/tokens.css` and `worca-look/global.css`, and Write them whole as `tokens.css` and `global.css`. Add only what the document needs, from those tokens. worca puts the fonts they load in `assets/worca/` once your plan is valid.',
    '- Another look keeps `worca-look/global.css` and the token names of `worca-look/tokens.css`: write `tokens.css` with those names in that look.',
    '- The first line of `brand.md` is `Look source: <brief|project|skill|worca> — <why>`: the words of the brief, the file or the skill that set the look, or that none did. worca refuses a plan without it, and `project` when your task has no Project line.',
    '- Each `brief` names the section\'s one point',
  ]) assert.ok(lead.includes(bullet), bullet);
  assert.match(lead, /^4\. `brand\.md`: the `Look source:` line first/m);
  assert.doesNotMatch(lead, /^\d\. `global\.js`/m, 'no global.js item');
  assert.ok(lead.indexOf('\nDesign:\n') < lead.indexOf('\nCraft:\n') && lead.indexOf('\nCraft:\n') < lead.indexOf('\nFiles:\n'));
  for (const no of ['the system font stack', 'choose one direction', '`css` and `js` when the section needs them']) assert.equal(lead.includes(no), false, no);
  // The web keeps its own default.
  assert.match(leadSystemPrompt({ kind: 'web' }), /choose one direction and keep to it/);
});

test('a document\'s fix prompt names brand.md, its change round the look, and its section target', () => {
  const today = planFixPrompt({ errors: ['x'] });
  assert.equal(today, 'plan.json is not valid:\n- x\nFix these and write plan.json again, whole, at the Plan file path. Change nothing else.');
  const brand = planFixPrompt({ errors: ['sections must be an array of at least one section', 'brand.md has no "Look source:" line: write it'] }).split('\n');
  assert.equal(brand[0], 'plan.json or brand.md is not valid:');
  assert.equal(brand.at(-1), 'Fix these: write plan.json again, whole, at the Plan file path, and Edit the `Look source:` line of brand.md beside it. Change nothing else.');
  assert.equal(brand.length, 4);
  const change = leadChangePrompt({ kind: 'document', instruction: 'x', roundFile: '/r', questionFile: '/q' });
  assert.ok(change.includes('A change that asks for another look rewrites `tokens.css` and the `Look source:` line of `brand.md`.'));
  assert.doesNotMatch(change, /place the slot/);
  assert.doesNotMatch(leadChangePrompt({ kind: 'web', instruction: 'x', roundFile: '/r', questionFile: '/q' }), /Look source/);
  assert.equal(leadTarget({ kind: 'document', fast: true }), '6 to 20 sections, one per part');
  assert.equal(leadTarget({ kind: 'document', fast: false }), '3 to 8 sections, one per part');
});
