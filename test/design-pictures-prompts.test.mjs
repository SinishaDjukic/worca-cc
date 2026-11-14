// test/design-pictures-prompts.test.mjs — Design pictures P2 Task B4: the lead's Made pictures rules (SPEC §7, D11)
// come last in a lead's system prompt only with pictures on, the `Picture kit:` line only when a kit is given, and
// spawn options change nothing but that lead's system prompt (no env, no setting). Builders' text never changes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  MADE_PICTURES, builderSystemPrompt, integratePrompt, leadChangePrompt, leadPlanPrompt, leadSystemPrompt,
} from '../src/core/design/prompts.mjs';
import { designSpawnOptions } from '../src/core/design/spawn-options.mjs';

useTempHome(after);
const D = 'd_0123456789ab';
const base = { engine: 'claude', agentId: 'a_11111111', buildId: 'b_111111111111', designId: D, prompt: 'P', model: 'claude-sonnet-5-5', effort: 'medium', maxBudgetUsd: 3, denyRules: ['Read(//**/.env*)'], signal: new AbortController().signal, onEvent: () => {} };
const KINDS = ['web', 'presentation', 'pitch', 'video', 'document'];

const BLOCK = `Made pictures (only when your task names a \`Picture kit\`):
- A picture that is not a screen of the product (a scene, a mood, a texture, an illustration, a background) can be made for you when nothing in the project or the brief's attachments fits. Run \`node <Picture kit> <name> <wide|tall|square> "<what it shows>"\` in work/, the description inside double quotes: it saves the picture under \`assets/made/\` and prints its path and pixel size. The name is short: lower-case letters, digits and hyphens.
- Never have one made of the product's screens, its logo or its name, of a person who exists, or of another company's brand: those are real pictures, or are drawn. No words inside a made picture: text belongs in HTML.
- Say what is in the picture, how it is drawn or shot, its light and its colours (name the design's own colours), and that it holds no text, letters or logos. Use no double quotes in it. Keep one style across a design's pictures: repeat the same style words in each description.
- Ask for the shape of the place the picture goes: \`wide\` for a band or half a slide, \`tall\` for a column, \`square\` for a card.
- Few: a picture where it carries the section's point. Never one per card, never as filler.
- Read each picture before a brief names it. Have it made again under the same name when it shows the wrong thing, holds text or looks broken: twice at most, then draw the thing in HTML, CSS and SVG, or leave it out.
- Give the command two minutes where your shell lets you set a limit. When it prints \`picture: still in the making\`, or the shell stops it before it prints anything, run \`node <Picture kit> <name>\` to wait for it. When it prints \`picture:\` and any other reason, no picture was made: draw the thing or leave it out, and say so in your last line.
- A made picture may fill its box edge to edge (\`object-fit: cover\`) when it is scenery. Say so in that section's \`brief\`, because a builder gives every picture room unless its brief says otherwise. What it shows must stay in view.`;
const ROOM = 'A picture has room: clear space on every side between it, or the frame drawn around it, and the edges of its card, section or slide.';
test('without pictures every lead\'s system prompt is unchanged; with them the block comes last', () => {
  assert.equal(MADE_PICTURES, BLOCK);
  for (const rule of ['Run `node <Picture kit> <name> <wide|tall|square> "<what it shows>"` in work/, the description inside double quotes',
    'Give the command two minutes where your shell lets you set a limit. When it prints `picture: still in the making`, or the shell stops it before it prints anything, run `node <Picture kit> <name>` to wait for it.',
    'A made picture may fill its box edge to edge (`object-fit: cover`) when it is scenery. Say so in that section\'s `brief`']) assert.ok(BLOCK.includes(rule), rule);
  for (const kind of KINDS) {
    assert.doesNotMatch(leadSystemPrompt({ kind }), /Made pictures|Picture kit/, kind);
    assert.equal(leadSystemPrompt({ kind, pictures: false }), leadSystemPrompt({ kind }));
    assert.equal(leadSystemPrompt({ kind, pictures: true }), `${leadSystemPrompt({ kind })}\n\n${BLOCK}`);
    const builder = builderSystemPrompt({ kind });
    assert.doesNotMatch(builder, /Made pictures|Picture kit/); assert.ok(builder.includes(ROOM), 'the builders\' room rule stays');
  }
});
test('the Picture kit line only when given, in plan, change and integrate', () => {
  const has = (p) => p.split('\n').includes('Picture kit: .kit/picture.mjs');
  assert.ok(has(leadPlanPrompt({ brief: 'B', kind: 'web', questionFile: '/q', planFile: '/p', pictureKit: '.kit/picture.mjs' })));
  assert.ok(has(leadChangePrompt({ instruction: 'X', kind: 'web', sections: [], questionFile: '/q', roundFile: '/r', pictureKit: '.kit/picture.mjs' })));
  const i = integratePrompt({ findings: [], integrationFile: '/i', lookKit: '/k/look.mjs', pictureKit: '.kit/picture.mjs' });
  assert.ok(has(i)); assert.ok(i.includes('A made picture listed as `cropped` fills its box on purpose: leave it as it is unless what it shows is out of view.'));
  assert.ok(has(integratePrompt({ findings: [], integrationFile: '/i', pictureKit: '.kit/picture.mjs' })), 'no Look kit: still named');
  for (const p of [leadPlanPrompt({ brief: 'B', kind: 'web', questionFile: '/q', planFile: '/p' }), integratePrompt({ findings: [], integrationFile: '/i', lookKit: '/k' })])
    assert.doesNotMatch(p, /^Picture kit:|cropped/m);
});
test('the Picture kit line follows the Kit contract and the Look kit; the cropped sentence needs both kits', () => {
  const KIT = 'Picture kit: .kit/picture.mjs';
  const CROPPED = 'A made picture listed as `cropped` fills its box on purpose: leave it as it is unless what it shows is out of view.';
  const at = (p, line) => p.split('\n').indexOf(line);
  const plan = leadPlanPrompt({ brief: 'B', kind: 'web', kitContract: '/c', questionFile: '/q', planFile: '/p', pictureKit: '.kit/picture.mjs' });
  const change = leadChangePrompt({ instruction: 'X', kind: 'web', sections: [], kitContract: '/c', questionFile: '/q', roundFile: '/r', pictureKit: '.kit/picture.mjs' });
  for (const p of [plan, change]) {
    assert.equal(at(p, KIT), at(p, 'Kit contract: /c') + 1);
    assert.equal(at(p, 'Question file: /q'), at(p, KIT) + 1);
  }
  assert.doesNotMatch(leadChangePrompt({ instruction: 'X', kind: 'web', sections: [], questionFile: '/q', roundFile: '/r' }), /^Picture kit:/m);
  const both = integratePrompt({ findings: [], integrationFile: '/i', lookKit: '/k', pictureKit: '.kit/picture.mjs' });
  assert.equal(at(both, KIT), at(both, 'Look kit: /k') + 1);
  const [first, cropped, then] = ['First look at what was built.', CROPPED, 'Then check the sections'].map((s) => both.indexOf(s));
  assert.ok(first >= 0 && first < cropped && cropped < then, 'between First look and Then check');
  assert.ok(at(both, CROPPED) > 0, 'a line of its own');
  const noLook = integratePrompt({ findings: [], integrationFile: '/i', pictureKit: '.kit/picture.mjs' });
  assert.equal(at(noLook, KIT), at(noLook, 'Integration file: /i') + 1);
  assert.doesNotMatch(noLook, /cropped/);
});
test('spawn options: only the lead\'s system prompt changes with pictures; no env, no setting', () => {
  const lead = designSpawnOptions({ ...base, role: 'lead', stage: 'plan', pictures: true });
  const plain = designSpawnOptions({ ...base, role: 'lead', stage: 'plan' });
  assert.ok(lead.systemPrompt.endsWith(BLOCK));
  assert.equal('spawnEnv' in lead, false);
  assert.deepEqual([lead.envScrub, lead.envAllowlist, lead.extraSettings], [plain.envScrub, plain.envAllowlist, plain.extraSettings]);
  const builder = designSpawnOptions({ ...base, role: 'builder', stage: 'first', sectionId: 'hero', pictures: true });
  assert.doesNotMatch(builder.systemPrompt, /Made pictures/); assert.equal('spawnEnv' in builder, false);
});
