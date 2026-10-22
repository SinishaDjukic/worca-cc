// test/promo-agents.test.mjs
// The eight Promo video agents as the other lanes see them: the exact ports (ids, types,
// required, renderers, arms, filenames) the workflow graph wires and the scripts read, the
// approve-script form (gates 1 and 3, and the mock line a mock run raises), the kit staging,
// the fan-out, and the load-bearing film-making rules in each prompt — so a later "tidy-up"
// cannot quietly delete the craft the hand-built worca film taught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAgentRegistry, DEFAULT_AGENTS_DIR } from '../src/core/agent-registry.mjs';
import { validateMetaV2 } from '../src/shared/graph/agent-meta.mjs';
import { MOCK_WRITER_ROLES } from '../src/core/claude-runner.mjs';
import { validateFormDef } from '../src/shared/forms/form-def.mjs';
import { autoAnswer, collectAnswer, checkAskData } from '../src/shared/forms/answer.mjs';
import { resolveAnswerSchema } from '../src/shared/forms/schema.mjs';
import { checkRows } from './helpers/rows.mjs';

const REGISTRY = loadAgentRegistry(DEFAULT_AGENTS_DIR, { userAgentsDir: null, includePlugins: false });
const KEYS = ['promoSetup', 'promoVoice', 'promoExplorer', 'promoWriter', 'promoCapture', 'promoMascot', 'promoScenes', 'promoReview'];
const raw = (key) => JSON.parse(readFileSync(join(DEFAULT_AGENTS_DIR, `${key}.meta.json`), 'utf8'));
const body = (key) => readFileSync(join(DEFAULT_AGENTS_DIR, REGISTRY[key].agentFile), 'utf8');

/** [id, type, required, as] per input; [id, type, when, filename] per output — the spec table. */
const PORTS = {
  promoSetup: { runnerType: 'clarifier', mockRole: 'clarify',
    inputs: [['task', 'md', true, 'file']],
    outputs: [['answers', 'json', 'always', 'promo-setup.json']] },
  promoVoice: { runnerType: 'clarifier', mockRole: 'clarify',
    inputs: [['voices', 'json', true, 'file']],
    outputs: [['answers', 'json', 'always', 'promo-voice.json']] },
  promoExplorer: { runnerType: 'producer', mockRole: 'generic-producer',
    inputs: [['task', 'md', true, 'file'], ['answers', 'json', false, 'answers']],
    outputs: [['product', 'md', 'always', 'promo-product.md'], ['runbook', 'json', 'always', 'promo-runbook.json']] },
  promoWriter: { runnerType: 'producer', mockRole: 'generic-producer',
    inputs: [['task', 'md', true, 'file'], ['product', 'md', true, 'file'], ['answers', 'json', true, 'answers']],
    outputs: [['script', 'json', 'always', 'promo-script.json'], ['storyboard', 'md', 'always', 'promo-storyboard.md']] },
  promoCapture: { runnerType: 'producer', mockRole: 'generic-producer',
    inputs: [['runbook', 'json', true, 'file'], ['storyboard', 'md', true, 'file'], ['product', 'md', false, 'file']],
    outputs: [['plates', 'json', 'always', 'promo-plates.json']] },
  promoMascot: { runnerType: 'producer', mockRole: 'generic-producer',
    inputs: [['answers', 'json', true, 'answers'], ['storyboard', 'md', true, 'file'], ['product', 'md', false, 'file'], ['timeline', 'json', false, 'file']],
    outputs: [['mascot', 'md', 'always', 'promo-mascot.md']] },
  promoScenes: { runnerType: 'producer', mockRole: 'generic-producer',
    inputs: [['storyboard', 'md', true, 'file'], ['timeline', 'json', true, 'file'], ['plates', 'json', true, 'file'], ['mascot', 'md', false, 'file'], ['fixes', 'md', false, 'fix-review']],
    outputs: [['film', 'md', 'always', 'promo-film-cycle{cycle}.md']] },
  promoReview: { runnerType: 'verifier', mockRole: 'generic-verifier',
    inputs: [['film', 'md', true, 'file'], ['storyboard', 'md', false, 'file'], ['timeline', 'json', false, 'file']],
    outputs: [['pass', 'void', 'clean', undefined], ['findings', 'md', 'blocking', 'promo-review-cycle{cycle}.md'], ['review', 'md', 'always', 'promo-review-cycle{cycle}.md']] },
};

test('the registry lists the eight promo agents with the spec’s ports, in workflow order', async () => {
  await checkRows([
    ...KEYS.map((key) => ({ name: `${key}: v2-valid, domain video, ports as the spec table`, run: () => {
      const m = REGISTRY[key];
      assert.ok(m, `${key} is in the registry`);
      assert.deepEqual(validateMetaV2(raw(key), { mockWriterRoles: MOCK_WRITER_ROLES }).errors, []);
      assert.equal(m.domain, 'video');
      assert.equal(m.scope, 'project');
      assert.equal(m.runnerType, PORTS[key].runnerType);
      assert.equal(m.mockRole, PORTS[key].mockRole);
      assert.deepEqual(m.inputs.map((p) => [p.id, p.type, p.required, p.as]), PORTS[key].inputs);
      assert.deepEqual(m.outputs.map((p) => [p.id, p.type, p.when, p.filename]), PORTS[key].outputs);
      assert.ok(m.promptHints, `${key} carries prompt hints`);
      assert.match(m.displayName, /^Promo: /);
    } })),
    { name: 'workflow order: setup, voice, explorer, writer, capture, mascot, scenes, review', run: () => {
      const keys = Object.keys(REGISTRY).filter((k) => KEYS.includes(k));
      assert.deepEqual(keys, KEYS);
      assert.deepEqual(KEYS.map((k) => REGISTRY[k].order), [70, 71, 72, 73, 74, 75, 76, 77]);
    } },
    { name: 'the scenes fix loop: fixes is a loop receiver with its own directive', run: () => {
      const fixes = REGISTRY.promoScenes.inputs.find((p) => p.id === 'fixes');
      assert.equal(fixes.loop, true);
      assert.equal(fixes.required, false);
      assert.match(fixes.directive, /^## Fix cycle/);
    } },
    { name: 'the review: a verdict per cycle, findings and review share one file', run: () => {
      assert.deepEqual(REGISTRY.promoReview.verdict, { filename: 'promo-review-cycle{cycle}.json' });
      const [findings, review] = ['findings', 'review'].map((id) => REGISTRY.promoReview.outputs.find((p) => p.id === id));
      assert.equal(findings.filename, review.filename);
    } },
  ]);
});

test('kit staging, fan-out and asking, per agent', async () => {
  await checkRows([
    { name: 'capture, mascot and scenes (and the writer and review, which read the CONTRACT and run its tools) stage promo-kit', run: () => {
      for (const key of ['promoCapture', 'promoMascot', 'promoScenes', 'promoWriter', 'promoReview']) {
        assert.deepEqual(REGISTRY[key].requiresAssets, ['promo-kit'], key);
      }
      for (const key of ['promoSetup', 'promoVoice', 'promoExplorer']) assert.deepEqual(REGISTRY[key].requiresAssets, [], key);
    } },
    { name: 'scenes fan out (one sub-agent per scene group); so do the explorer and the review', run: () => {
      assert.equal(REGISTRY.promoScenes.fanOut, true);
      assert.equal(REGISTRY.promoExplorer.fanOut, true);
      assert.equal(REGISTRY.promoReview.fanOut, true);
      for (const key of ['promoSetup', 'promoVoice', 'promoWriter', 'promoCapture', 'promoMascot']) assert.equal(REGISTRY[key].fanOut, false, key);
    } },
    { name: 'the clarifiers are locked on; the writer asks by default; nobody else asks', run: () => {
      for (const key of ['promoSetup', 'promoVoice']) {
        assert.deepEqual([REGISTRY[key].asksQuestions, REGISTRY[key].questionsLocked, REGISTRY[key].questionsDefault], [true, true, true], key);
      }
      assert.deepEqual([REGISTRY.promoWriter.asksQuestions, REGISTRY.promoWriter.questionsLocked, REGISTRY.promoWriter.questionsDefault], [true, false, true]);
      for (const key of ['promoExplorer', 'promoCapture', 'promoMascot', 'promoScenes', 'promoReview']) assert.equal(REGISTRY[key].asksQuestions, false, key);
    } },
  ]);
});

test('approve-script: gates 1 and 3 with its example, and the mock line raises a valid form', async () => {
  const def = REGISTRY.promoWriter.ask?.forms?.['approve-script'];
  await checkRows([
    { name: 'gate 1 clean', run: () => {
      assert.ok(def, 'promoWriter declares approve-script');
      assert.deepEqual(validateFormDef(def, { id: 'approve-script' }).errors, []);
    } },
    { name: 'the unattended answer approves and keeps every line', run: () => {
      const auto = autoAnswer(def, def.example);
      assert.equal(auto.decision, 'approve');
      assert.deepEqual(auto.lines, def.example.lines.map((l) => ({ id: l.id, verdict: 'keep' })));
      assert.equal(auto.notes, undefined);
      assert.deepEqual(collectAnswer(def, resolveAnswerSchema(def.answer, def.example), auto).errors, []);
    } },
    { name: 'a person can rework or cut a line with a note, and only listed lines', run: () => {
      const schema = resolveAnswerSchema(def.answer, def.example);
      const ok = collectAnswer(def, schema, { decision: 'changes', lines: [{ id: 'v01', verdict: 'rework', note: 'Shorter.' }, { id: 'v02', verdict: 'cut' }], notes: 'More jokes.' });
      assert.deepEqual(ok.errors, []);
      assert.ok(collectAnswer(def, schema, { decision: 'approve', lines: [{ id: 'v99', verdict: 'cut' }] }).errors.length);
    } },
    { name: 'the layout: headline callout, review-list of lines, the storyboard, decision, notes', run: () => {
      const widgets = [];
      (function walk(items) { for (const i of items || []) { widgets.push(i.widget + (i.field ? `:${i.field}` : i.bind ? `@${i.bind}` : '')); walk(i.children); for (const t of i.tabs || []) walk(t.children); } })(def.layout);
      assert.deepEqual(widgets, ['callout@data.headline', 'tabs', 'review-list:lines', 'markdown@data.storyboard', 'select:decision', 'textarea:notes']);
    } },
    ...['promoSetup', 'promoVoice', 'promoWriter'].map((key) => ({ name: `${key}: its MOCK_ASK_FORM line names its own form and passes gate 2`, run: () => {
      const line = body(key).split('\n').find((l) => l.startsWith('MOCK_ASK_FORM:'));
      assert.ok(line, `${key} carries a MOCK_ASK_FORM line`);
      const payload = JSON.parse(line.slice('MOCK_ASK_FORM:'.length).trim());
      const forms = REGISTRY[key].ask.forms;
      assert.ok(Object.hasOwn(forms, payload.form), `${payload.form} is one of ${key}'s forms`);
      const gate = checkAskData(forms[payload.form], payload.data);
      assert.equal(gate.ok, true, JSON.stringify(gate.errors));
    } })),
  ]);
});

test('every prompt carries its contract paths and the rules that made the worca film work', async () => {
  const must = {
    promoExplorer: ['promo/product.md', 'promo/runbook.json', '"ui": false', 'temporary HOME', 'argv', 'Not claims'],
    promoWriter: ['promo-kit/CONTRACT.md', 'promo/script.json', 'promo/storyboard.md', 'hook', 'title', 'close', 'approve-script', 'words per second', 'minSec', 'Shot list', 'no arms', 'product.md'],
    promoCapture: ['promo-kit/CONTRACT.md', 'promo-kit/capture/lib.mjs', 'runbook.ui === false', 'promo/plates/manifest.json', 'temporary HOME', 'own port', 'leak', 'Stop', 'chrome', 'clip', 'demo data'],
    promoMascot: ['promo-kit/film/mascot.js', 'promo/film/mascot.js', 'promo/mascot.md', 'NO arms', 'nose', 'mascotAmount', 'Cameo', 'Star of the show', 'Use my attached image', 'contact sheet'],
    promoScenes: ['promo-kit/CONTRACT.md', 'promo/film/scenes/', 'S.word', 'build-data', 'snap', 'fluency', 'sub-agent', 'every ~2 s', '1.2 s', 'Fix cycle', 'ui: false'],
    promoReview: ['promo-kit/CONTRACT.md', 'fluency', 'snap', 'full-res', '±0.5 s', '1080p', 'arms', 'humans', 'product.md', 'critical', 'major'],
  };
  await checkRows([
    ...Object.entries(must).map(([key, needles]) => ({ name: `${key}: names its paths and rules`, run: () => {
      const text = body(key);
      const missing = needles.filter((n) => !text.includes(n));
      assert.deepEqual(missing, [], `${key} lost: ${missing.join(' | ')}`);
    } })),
    { name: 'every promo prompt: inherit model, a tools line, no absolute or home paths, and the product is "worca", never "worca-cc"', run: () => {
      for (const key of KEYS) {
        const text = body(key);
        assert.match(text, /^---\nname: worca-cc-promo-[a-z]+\n/, `${key} frontmatter name`);
        assert.match(text, /\nmodel: inherit\n/, `${key} model`);
        assert.match(text, /\ntools: Read, Write/, `${key} tools`);
        assert.ok(!/\/Users\/|\/home\/[a-z]|C:\\\\Users/.test(text), `${key}: no absolute home path`);
        const prose = text.replace(/^---[\s\S]*?\n---\n/, '').replace(/worca-cc-promo-[a-z]+/g, '');
        assert.ok(!/worca-cc/i.test(prose), `${key}: user-facing product name is worca`);
      }
    } },
  ]);
});
