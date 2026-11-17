// test/models-brand-marks.test.mjs — the Models page's brand marks (models-menu P1 Task 2, contract C3): the slug
// tables name real files of the icon pack, vendorOf works a model's vendor out (L3), and the tiles draw a mark, the
// worca mark or a plugin's bag, never a broken image.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { iconSvg } from '../ui/public/icons.mjs';
import {
  HARNESS_MARKS, PROVIDER_MARKS, VENDOR_MARKS, vendorOf, markUrl, gradientOf, markTile, modelMark,
} from '../ui/public/models/brand-marks.mjs';

const PACK_DIR = path.join(path.dirname(createRequire(import.meta.url).resolve('@lobehub/icons-static-svg/package.json')), 'icons');
const GRADIENTS = ['indigo', 'teal', 'pink', 'blue', 'lime', 'slate'];

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

test('every slug of the three tables is a file of the pack (exact case)', () => {
  const files = new Set(readdirSync(PACK_DIR));
  const slugs = [...Object.values(HARNESS_MARKS), ...Object.values(PROVIDER_MARKS), ...Object.values(VENDOR_MARKS).map((v) => v.slug)];
  assert.equal(slugs.length, 8 + 4 + 17);
  for (const slug of slugs) assert.ok(files.has(`${slug}.svg`), `${slug}.svg is in the pack`);
});

test('the tables: one mark per engine, the four providers, the vendors with their names', () => {
  assert.deepEqual(Object.keys(HARNESS_MARKS).sort(), [...ENGINE_NAMES].sort());
  assert.deepEqual(HARNESS_MARKS, {
    claude: 'claudecode-color', codex: 'codex-color', copilot: 'githubcopilot', cursor: 'cursor',
    gemini: 'geminicli-color', goose: 'goose', opencode: 'opencode', qwen: 'qwen-color',
  });
  assert.deepEqual(Object.keys(PROVIDER_MARKS).sort(), ['anthropic', 'copilot', 'openai', 'openrouter']);
  assert.deepEqual(PROVIDER_MARKS, { copilot: 'githubcopilot', openrouter: 'openrouter', openai: 'openai', anthropic: 'anthropic' });
  assert.equal(HARNESS_MARKS.copilot, 'githubcopilot');
  assert.equal(VENDOR_MARKS.amazon.slug, 'aws-color');
  assert.equal(VENDOR_MARKS.anthropic.slug, 'claude-color');
  assert.deepEqual(Object.entries(VENDOR_MARKS).map(([k, v]) => [k, v.slug, v.name]), [
    ['anthropic', 'claude-color', 'Anthropic'], ['openai', 'openai', 'OpenAI'], ['google', 'google-color', 'Google'],
    ['xai', 'xai', 'xAI'], ['microsoft', 'microsoft-color', 'Microsoft'], ['moonshot', 'moonshot', 'Moonshot AI'],
    ['baidu', 'baidu-color', 'Baidu'], ['meta', 'meta-color', 'Meta'], ['mistral', 'mistral-color', 'Mistral'],
    ['deepseek', 'deepseek-color', 'DeepSeek'], ['qwen', 'qwen-color', 'Qwen'], ['zhipu', 'zhipu-color', 'Zhipu'],
    ['cohere', 'cohere-color', 'Cohere'], ['nvidia', 'nvidia-color', 'NVIDIA'], ['perplexity', 'perplexity-color', 'Perplexity'],
    ['amazon', 'aws-color', 'Amazon'], ['minimax', 'minimax-color', 'MiniMax'],
  ]);
  assert.equal(markUrl('openai'), '/vendor/brand-icons/openai.svg');
});

test('vendorOf: the upstream prefix through the aliases, a built-in by engine, a family guess, else null', () => {
  const rows = [
    [{ id: 'openrouter-x-ai-grok-4-7', upstream: { provider: 'openai', model: 'x-ai/grok-4.7' } }, 'xai'],
    [{ id: 'openrouter-qwen-qwen3-8-27b-free', upstream: { provider: 'openai', model: 'qwen/qwen3.8-27b:free' } }, 'qwen'],
    [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, 'anthropic'],
    [{ id: 'gpt-6.1-sol', engine: 'codex' }, 'openai'],
    [{ id: 'copilot/gemini-4-argon', engine: 'copilot', label: 'Gemini 4 Argon' }, 'google'],
    [{ id: 'copilot-mai-code-1.1-flash', label: 'MAI-Code-1.1-Flash (Copilot)', upstream: { provider: 'copilot', model: 'mai-code-1.1-flash' } }, 'microsoft'],
    // Rule 1 falls through (no such vendor) and rule 3 reads the id and the label, never the upstream model (L3).
    [{ id: 'openrouter-nousresearch-hermes-4-llama-3-1-405b', label: 'Hermes 4 Llama 3.1 405B', upstream: { provider: 'openai', model: 'nousresearch/hermes-4-llama-3.1-405b' } }, 'meta'],
    [{ id: 'acme', upstream: { provider: 'openai', model: 'unknownco/llama-x' } }, null],
    [{ id: 'acme-stable', label: 'acme-stable' }, null],
    [{ id: '' }, null],
    [{ id: 'x', upstream: { provider: 'openai', model: 'unknownco/thing' } }, null],
    [{ id: 'x', upstream: { provider: 'openai', model: 'constructor/thing' } }, null],
    // The aliases, case-folded, on ids no family matches; and the prefix wins over a family the id names.
    [{ id: 'acme-1', upstream: { provider: 'openai', model: 'X-AI/acme-1' } }, 'xai'],
    [{ id: 'acme-2', upstream: { provider: 'openai', model: 'Meta-Llama/acme-2' } }, 'meta'],
    [{ id: 'acme-3', upstream: { provider: 'openai', model: 'mistralai/acme-3' } }, 'mistral'],
    [{ id: 'acme-4', upstream: { provider: 'openai', model: 'moonshotai/acme-4' } }, 'moonshot'],
    [{ id: 'acme-5', upstream: { provider: 'openai', model: 'z-ai/acme-5' } }, 'zhipu'],
    [{ id: 'acme-6', upstream: { provider: 'openai', model: 'perplexity/acme-6' } }, 'perplexity'],
    [{ id: 'openrouter-nvidia-llama-x', upstream: { provider: 'openai', model: 'nvidia/llama-x' } }, 'nvidia'],
    // A built-in Codex model is OpenAI's whatever its id; a row with upstream or env keys is not a built-in.
    [{ id: 'arctic-1', engine: 'codex' }, 'openai'],
    [{ id: 'arctic-1', engine: 'codex', env: {} }, 'openai'],
    [{ id: 'arctic-1', engine: 'codex', env: { OPENAI_BASE_URL: 'http://127.0.0.1:1' } }, null],
    [{ id: 'arctic-1', engine: 'codex', upstream: { provider: 'openai', model: 'arctic-1' } }, null],
    // Family guess: first match wins, in the rules' order.
    [{ id: 'devstral-medium' }, 'mistral'],
    [{ id: 'o3-mini' }, 'openai'],
    [{ id: 'phi-5' }, 'microsoft'],
    [{ id: 'glm-5', label: 'GLM 5' }, 'zhipu'],
    [{ id: 'command-r-plus' }, 'cohere'],
    [{ id: 'nova-pro' }, 'amazon'],
    [{ id: 'ernie-5' }, 'baidu'],
    [{ id: 'kimi-k3' }, 'moonshot'],
    [{ id: 'minimax-m3' }, 'minimax'],
    [{ id: 'deepseek-v4' }, 'deepseek'],
    [{ id: 'qwq-32b' }, 'qwen'],
    [{ id: 'x', label: 'Fable 5.2' }, 'anthropic'],
    [{ id: 'gemma-4' }, 'google'],
    [{ id: 'grok-5' }, 'xai'],
    [{ id: 'llama-4' }, 'meta'],
  ];
  for (const [model, want] of rows) {
    const got = vendorOf(model);
    assert.equal(got, want, JSON.stringify(model));
    if (got !== null) assert.ok(Object.hasOwn(VENDOR_MARKS, got), `${got} is a VENDOR_MARKS key`);
  }
});

test('gradientOf is stable, one of the six, and spreads names over more than one', () => {
  const g = gradientOf('acme-models');
  assert.ok(GRADIENTS.includes(g), g);
  assert.equal(gradientOf('acme-models'), g);
  const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'acme-models', 'other-plugin'].map(gradientOf));
  for (const s of seen) assert.ok(GRADIENTS.includes(s), s);
  assert.ok(seen.size > 1, 'a hash, not a constant');
});

test('markTile: a pack mark as an image, an unknown key as a blank tile, never a broken image', () => {
  const doc = docOf();
  const harness = markTile(doc, { kind: 'harness', key: 'claude', size: 'lg', label: 'Claude Code' });
  assert.equal(harness.tagName, 'SPAN');
  assert.equal(harness.className, 'mdl-mark lg');
  const img = harness.querySelector('img');
  assert.equal(img.getAttribute('src'), markUrl(HARNESS_MARKS.claude));
  assert.equal(img.getAttribute('alt'), 'Claude Code');

  const provider = markTile(doc, { kind: 'provider', key: 'openrouter' });
  assert.equal(provider.className, 'mdl-mark');
  assert.equal(provider.querySelector('img').getAttribute('src'), '/vendor/brand-icons/openrouter.svg');
  assert.equal(provider.querySelector('img').getAttribute('alt'), '');

  const vendor = markTile(doc, { kind: 'vendor', key: 'mistral', size: 'xl', label: 'Mistral' });
  assert.equal(vendor.className, 'mdl-mark xl');
  assert.equal(vendor.querySelector('img').getAttribute('src'), '/vendor/brand-icons/mistral-color.svg');

  for (const [kind, key] of [['vendor', 'no-such-vendor'], ['harness', 'no-such-engine'], ['provider', 'constructor']]) {
    const tile = markTile(doc, { kind, key });
    assert.equal(tile.querySelector('img'), null, `${kind}:${key}`);
    assert.ok(tile.classList.contains('mdl-mark') && tile.classList.contains('blank'), `${kind}:${key}`);
    assert.equal(tile.querySelector('.ic').innerHTML, iconSvg('cube', 16), `${kind}:${key} draws the cube`);
  }

  const glyph = markTile(doc, { kind: 'glyph', key: 'bag', size: 'sm' });
  assert.ok(glyph.classList.contains('blank') && glyph.classList.contains('sm'));
  assert.equal(glyph.querySelector('.ic').style.width, '12px');
  assert.equal(glyph.querySelector('img'), null);
});

test('modelMark: the vendor mark, else the worca mark on blue, else the plugin bag on its gradient', () => {
  const doc = docOf();
  const vendor = modelMark(doc, { id: 'claude-opus-5-5', label: 'Opus 5.5' });
  assert.equal(vendor.className, 'mdl-mark');
  assert.equal(vendor.querySelector('img').getAttribute('src'), markUrl('claude-color'));
  assert.equal(vendor.querySelector('img').getAttribute('alt'), 'Anthropic');

  const own = modelMark(doc, { id: 'acme-stable', label: 'acme-stable' });
  assert.ok(own.classList.contains('mdl-mark') && own.classList.contains('own') && own.classList.contains('g-blue'));
  assert.equal(own.querySelector('img').getAttribute('src'), '/assets/worca-mark-mask.png');
  assert.equal(own.querySelector('img').getAttribute('alt'), '');

  const plugin = modelMark(doc, { id: 'acme-stable', label: 'acme-stable', plugin: 'acme-models' }, 'sm');
  for (const c of ['mdl-mark', 'own', `g-${gradientOf('acme-models')}`, 'sm']) assert.ok(plugin.classList.contains(c), c);
  assert.equal(plugin.querySelector('img'), null);
  assert.ok(plugin.querySelector('svg'));
  assert.equal(plugin.querySelector('.ic').style.width, '12px');
  assert.equal(plugin.querySelector('.ic').innerHTML, iconSvg('bag', 12), 'the plugin tile draws the bag');

  const big = markTile(doc, { kind: 'plugin', key: 'acme-models', size: 'xl' });
  assert.equal(big.querySelector('.ic').style.width, '24px');
  assert.equal(markTile(doc, { kind: 'plugin', key: 'acme-models' }).querySelector('.ic').style.width, '16px');
  assert.equal(markTile(doc, { kind: 'plugin', key: 'acme-models', size: 'lg' }).querySelector('.ic').style.width, '20px');
});
