// test/model-addons.test.mjs — the per-model-family prompt add-ons (src/core/model-addons.mjs): the family map, the
// engine allow-list, the mode split, the file lookup and its guards, the assembly, and one snapshot per family and mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt, resolveAgentBody } from '../src/core/phases.mjs';
import {
  ADDON_FAMILIES, ADDON_ENGINES, MODEL_ID_FAMILIES, ADDONS_DIR, resolveModelFamily, resolveAddonFamily, addonMode, resolveAddon,
  appendAddon, isPinnedAddon, engineTakesAddon, pinFitsSpawn,
} from '../src/core/model-addons.mjs';
import { ENGINE_NAMES } from '../src/shared/engine-switch.mjs';
import { COPILOT_TOOL_NAMES } from '../src/core/engines/copilot.mjs';
import { GOOSE_TOOL_NAMES } from '../src/core/engines/goose.mjs';
import { claudeToolName } from '../src/core/engines/gemini-family.mjs';
import { QWEN_BUILTIN_TOOLS } from '../src/core/engines/qwen.mjs';

const scratch = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-addons-')); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// ── the family map ───────────────────────────────────────────────────────────

const FAMILY_ROWS = [
  ['claude-fable-5-2', 'fable-5-2'], ['claude-fable-5-1', 'fable-5-1'], ['claude-fable-5', 'fable-5'],
  ['claude-opus-5-5', 'opus-5-5'], ['claude-opus-5', 'opus-5'], ['claude-opus-4-8', 'opus-4-8'],
  ['claude-opus-4-8[1m]', 'opus-4-8'], ['claude-opus-4-8-20260101', 'opus-4-8'],
  ['claude-sonnet-5-5', 'sonnet-5-5'], ['claude-sonnet-5', 'sonnet-5'], ['claude-sonnet-5-20261001', 'sonnet-5'],
  ['claude-haiku-5-5', 'haiku-5-5'],
];
for (const [id, family] of FAMILY_ROWS) {
  test(`resolveModelFamily: ${id} → ${family}`, () => {
    assert.equal(resolveModelFamily(id), family);
    assert.equal(resolveModelFamily(id, { engine: 'claude' }), family);
    assert.equal(resolveAddonFamily(id), family, 'resolveAddonFamily agrees');
  });
}

// Families only the add-on resolver knows: resolveModelFamily (effort) stays on its legacy list.
const ADDON_FAMILY_ROWS = [
  ['claude-opus-4-6', 'opus-4-6'], ['claude-opus-4-6[1m]', 'opus-4-6'], ['claude-sonnet-4-6', 'sonnet-4-6'],
  ['claude-haiku-4-5', 'haiku-4-5'], ['claude-haiku-4-5-20251001', 'haiku-4-5'],
];
for (const [id, family] of ADDON_FAMILY_ROWS) {
  test(`resolveAddonFamily: ${id} → ${family}`, () => {
    assert.equal(resolveAddonFamily(id), family);
    assert.equal(resolveAddonFamily(id, { engine: 'claude' }), family);
  });
}

const NON_ANTHROPIC_ROWS = [
  ['gpt-6-astra', 'gpt-6'], ['gpt-6.1-sol', 'gpt-6'], ['gpt-6.1-terra', 'gpt-6'], ['gpt-6-sol', 'gpt-6'], ['gpt-6-luna', 'gpt-6'],
  ['gpt-5.3-codex', 'gpt-5-codex'],
  ['gemini-3-pro-preview', 'gemini-3'], ['gemini-3.1-pro-preview', 'gemini-3'], ['gemini-3-flash-preview', 'gemini-3'],
  ['gemini-3.5-flash', 'gemini-3'], ['gemini-3.6-flash', 'gemini-3'], ['gemini-3.7-flash', 'gemini-3'], ['gemini-3.8-flash', 'gemini-3'],
  ['kimi-k3', 'kimi-k3'],
];
test('resolveAddonFamily: non-Anthropic ids, bare and provider-qualified', () => {
  for (const [id, family] of NON_ANTHROPIC_ROWS) {
    for (const prefix of ['', 'copilot/', 'openai/', 'google/', 'moonshotai/', 'openrouter/openai/']) {
      assert.equal(resolveAddonFamily(`${prefix}${id}`), family, `${prefix}${id}`);
    }
  }
  assert.equal(resolveAddonFamily('copilot/claude-opus-4.8-fast', { engine: 'copilot' }), 'opus-4-8');
  assert.equal(resolveAddonFamily('COPILOT/GPT-6.1-SOL', { engine: 'copilot' }), 'gpt-6');
  assert.equal(resolveAddonFamily(' gpt-6-astra '), 'gpt-6');
  for (const engine of ENGINE_NAMES) assert.equal(resolveAddonFamily('anthropic/claude-opus-4-8', { engine }), 'opus-4-8', engine);
});

for (const id of [
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-5.3-codex-spark',
  'gemini-4-argon', 'grok-4.7', 'grok-4.6', 'grok-4.5', 'mai-code-1.1-flash', 'claude-opus-4-7', 'opus', 'claude-acp/sonnet',
  'gpt-6', 'gpt-6.1-sol-x', 'constructor', '__proto__', 'toString', '', null, undefined, 42,
]) {
  test(`resolveAddonFamily: ${JSON.stringify(id)} → null`, () => {
    assert.equal(resolveAddonFamily(id), null);
    assert.equal(resolveAddonFamily(id, { engine: 'codex' }), null);
  });
}

test('resolveModelFamily: copilot ids resolve through the wire model, dotted versions as dashes', () => {
  assert.equal(resolveModelFamily('copilot/claude-opus-4.8', { engine: 'copilot' }), 'opus-4-8');
  assert.equal(resolveModelFamily('copilot/claude-opus-5.5', { engine: 'copilot' }), 'opus-5-5');
  assert.equal(resolveModelFamily('claude-opus-5-5', { engine: 'copilot' }), 'opus-5-5');
});

for (const [id, engine] of [
  ['gpt-5.5'], ['claude-x-9'], ['claude-opus-4-7'], ['claude-sonnet-4-6'], ['claude-haiku-4-5'], ['claude-haiku-4-5-20251001'],
  ['claude-opus-4-20250514'], ['opus'], ['sonnet'], ['haiku'], ['fable'], [''], [null], [undefined],
  ['copilot/gpt-5.5', 'copilot'], ['claude-opus-5-5', 'codex'], ['claude-opus-5-5', 'cursor'], ['claude-opus-5-5', 'opencode'],
  ['claude-opus-5-5', 'gemini'], ['claude-opus-5-5', 'qwen'], ['claude-opus-5-5', 'goose'],
  // Legacy behaviour (effort): no -fast, no new families, no new engines, no non-Anthropic ids.
  ['copilot/claude-opus-4.8-fast', 'copilot'], ['claude-opus-4-6', 'claude'], ['gpt-6.1-sol', 'codex'],
  ['anthropic/claude-opus-4-8', 'opencode'],
]) {
  test(`resolveModelFamily: ${JSON.stringify(id)}${engine ? ` on ${engine}` : ''} → null`, () => {
    assert.equal(resolveModelFamily(id, engine ? { engine } : {}), null);
  });
}

test('ADDON_FAMILIES is the frozen set of 16 families; ADDON_ENGINES is ENGINE_NAMES', () => {
  assert.deepEqual([...ADDON_FAMILIES].sort(), [
    'fable-5', 'fable-5-1', 'fable-5-2', 'gemini-3', 'gpt-5-codex', 'gpt-6', 'haiku-4-5', 'haiku-5-5', 'kimi-k3', 'opus-4-6',
    'opus-4-8', 'opus-5', 'opus-5-5', 'sonnet-4-6', 'sonnet-5', 'sonnet-5-5',
  ]);
  assert.ok(Object.isFrozen(ADDON_FAMILIES));
  assert.deepEqual([...ADDON_ENGINES], [...ENGINE_NAMES]);
  assert.ok(Object.isFrozen(ADDON_ENGINES));
  assert.ok(Object.isFrozen(MODEL_ID_FAMILIES));
  for (const family of Object.values(MODEL_ID_FAMILIES)) assert.ok(ADDON_FAMILIES.includes(family), family);
});

// ── the mode ─────────────────────────────────────────────────────────────────

test('addonMode: a clarifier or a step that may ask is interactive', () => {
  assert.equal(addonMode({ runnerType: 'clarifier' }), 'interactive');
  assert.equal(addonMode({ runnerType: 'producer', questionsEnabled: true }), 'interactive');
  assert.equal(addonMode({ questionsEnabled: true }), 'interactive');
});

test('addonMode: everything else is unattended', () => {
  assert.equal(addonMode({ runnerType: 'producer' }), 'unattended');
  assert.equal(addonMode({ runnerType: 'verifier', questionsEnabled: false }), 'unattended');
  assert.equal(addonMode({}), 'unattended');
  assert.equal(addonMode(), 'unattended');
});

// ── the file lookup ──────────────────────────────────────────────────────────

/** A temp add-on folder; a name may hold `harness/` (its folder is made). */
function dirWith(files) {
  const d = tmp();
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(d, name)), { recursive: true });
    writeFileSync(join(d, name), text, 'utf8');
  }
  return d;
}

test('resolveAddon: family file, then the unattended file, then the per-agent file, joined by a blank line', () => {
  const dir = dirWith({ 'opus-5-5.md': 'FAMILY\n', 'opus-5-5.unattended.md': '  UNATTENDED  \n', 'opus-5-5.implementer.md': 'AGENT', 'opus-5-5.reviewer.md': 'OTHER' });
  const { addon, warnings } = resolveAddon({ model: 'claude-opus-5-5', engine: 'claude', agentKey: 'implementer', mode: 'unattended', dir });
  assert.deepEqual(warnings, []);
  assert.deepEqual(addon, {
    v: 2, engine: 'claude', harness: null, family: 'opus-5-5', mode: 'unattended',
    files: ['opus-5-5.md', 'opus-5-5.unattended.md', 'opus-5-5.implementer.md'],
    text: 'FAMILY\n\nUNATTENDED\n\nAGENT', sha256: sha('FAMILY\n\nUNATTENDED\n\nAGENT'),
  });
  assert.equal(isPinnedAddon(addon), true);
});

test('resolveAddon: interactive mode skips the unattended file', () => {
  const dir = dirWith({ 'opus-5-5.md': 'FAMILY', 'opus-5-5.unattended.md': 'UNATTENDED', 'opus-5-5.implementer.md': 'AGENT' });
  const { addon } = resolveAddon({ model: 'claude-opus-5-5', agentKey: 'implementer', mode: 'interactive', dir });
  assert.deepEqual(addon.files, ['opus-5-5.md', 'opus-5-5.implementer.md']);
  assert.equal(addon.text, 'FAMILY\n\nAGENT');
  assert.equal(addon.mode, 'interactive');
});

test('resolveAddon: `unattended` is never an agent key; no agent key reads no per-agent file', () => {
  const dir = dirWith({ 'opus-5-5.unattended.md': 'UNATTENDED' });
  assert.equal(resolveAddon({ model: 'claude-opus-5-5', agentKey: 'unattended', mode: 'interactive', dir }).addon, null);
  const both = dirWith({ 'opus-5-5.md': 'FAMILY', 'opus-5-5.implementer.md': 'AGENT' });
  assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', mode: 'unattended', dir: both }).addon.files, ['opus-5-5.md']);
});

test('resolveAddon: no family, or no file found, gives no add-on and no warning', () => {
  const dir = dirWith({ 'opus-5-5.md': 'FAMILY' });
  assert.deepEqual(resolveAddon({ model: 'gpt-5.5', agentKey: 'implementer', mode: 'unattended', dir }), { addon: null, warnings: [] });
  // The model layer ignores the engine: codex on a claude-* id reads the model file (no harness file in this folder).
  assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', engine: 'codex', mode: 'unattended', dir }), {
    addon: { v: 2, engine: 'codex', harness: null, family: 'opus-5-5', mode: 'unattended', files: ['opus-5-5.md'], text: 'FAMILY', sha256: sha('FAMILY') },
    warnings: [],
  });
  assert.deepEqual(resolveAddon({ model: 'claude-sonnet-5-5', mode: 'unattended', dir }), { addon: null, warnings: [] });
  assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', mode: 'unattended', dir: join(dir, 'missing') }), { addon: null, warnings: [] });
});

// ── the harness layer ────────────────────────────────────────────────────────

const BOTH_LAYERS = {
  'harness/codex.md': 'H', 'harness/codex.unattended.md': 'HU', 'harness/codex.implementer.md': 'HA', 'harness/codex.reviewer.md': 'HX',
  'gpt-6.md': 'M', 'gpt-6.unattended.md': 'MU', 'gpt-6.implementer.md': 'MA', 'harness/claude.md': 'HC',
};

test('resolveAddon: the harness layer, then the model layer, each base → unattended → per-agent', () => {
  const dir = dirWith(BOTH_LAYERS);
  const { addon, warnings } = resolveAddon({ model: 'gpt-6.1-sol', engine: 'codex', agentKey: 'implementer', mode: 'unattended', dir });
  assert.deepEqual(warnings, []);
  const text = 'H\n\nHU\n\nHA\n\nM\n\nMU\n\nMA';
  assert.deepEqual(addon, {
    v: 2, engine: 'codex', harness: 'codex', family: 'gpt-6', mode: 'unattended',
    files: ['harness/codex.md', 'harness/codex.unattended.md', 'harness/codex.implementer.md', 'gpt-6.md', 'gpt-6.unattended.md', 'gpt-6.implementer.md'],
    text, sha256: sha(text),
  });
  assert.equal(isPinnedAddon(addon), true);
});

test('resolveAddon: interactive mode skips the unattended file of both layers', () => {
  const dir = dirWith(BOTH_LAYERS);
  const { addon } = resolveAddon({ model: 'gpt-6.1-sol', engine: 'codex', agentKey: 'implementer', mode: 'interactive', dir });
  assert.deepEqual(addon.files, ['harness/codex.md', 'harness/codex.implementer.md', 'gpt-6.md', 'gpt-6.implementer.md']);
  assert.equal(addon.text, 'H\n\nHA\n\nM\n\nMA');
  assert.equal(addon.mode, 'interactive');
});

test('resolveAddon: harness only (no model, or an unknown one), and model only', () => {
  const dir = dirWith({ 'harness/cursor.md': 'HC', 'opus-5-5.md': 'M' });
  for (const model of [undefined, null, 'auto']) {
    const { addon, warnings } = resolveAddon({ model, engine: 'cursor', mode: 'unattended', dir });
    assert.deepEqual(warnings, []);
    assert.deepEqual(addon, { v: 2, engine: 'cursor', harness: 'cursor', family: null, mode: 'unattended', files: ['harness/cursor.md'], text: 'HC', sha256: sha('HC') }, String(model));
  }
  const claude = resolveAddon({ model: 'claude-opus-5-5', engine: 'claude', mode: 'unattended', dir }).addon;
  assert.equal(claude.harness, null);
  assert.equal(claude.engine, 'claude');
  assert.equal(claude.family, 'opus-5-5');
  assert.equal(resolveAddon({ model: 'claude-opus-5-5', mode: 'unattended', dir }).addon.engine, 'claude', 'no engine named is claude');
});

test('resolveAddon: a known family with no file in the chosen mode records family null', () => {
  const dir = dirWith({ 'harness/codex.md': 'H', 'gpt-6.unattended.md': 'MU' });
  const { addon, warnings } = resolveAddon({ model: 'gpt-6.1-sol', engine: 'codex', agentKey: 'implementer', mode: 'interactive', dir });
  assert.deepEqual(warnings, []);
  assert.deepEqual(addon, { v: 2, engine: 'codex', harness: 'codex', family: null, mode: 'interactive', files: ['harness/codex.md'], text: 'H', sha256: sha('H') });
  const shipped = resolveAddon({ model: 'gpt-5.3-codex', engine: 'codex', agentKey: 'clarify', mode: 'interactive' }).addon;
  assert.equal(shipped.family, null, 'gpt-5-codex ships only an unattended file');
  assert.equal(shipped.harness, 'codex');
  assert.deepEqual(shipped.files, ['harness/codex.md']);
});

test('resolveAddon: an unknown engine reads no file at all', () => {
  const dir = dirWith({ 'evil.md': 'ESCAPED', 'harness/x.md': 'X', 'opus-5-5.md': 'M' });
  for (const engine of ['../evil', 'claude2', 'constructor']) {
    assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', engine, mode: 'unattended', dir }), { addon: null, warnings: [] }, engine);
  }
});

test('resolveAddon: an agent key that is not a plain name reads no harness per-agent file', () => {
  // `harness/codex./../evil.md` joins to <dir>/harness/evil.md: without the key check that file would be read.
  const dir = dirWith({ 'harness/codex.md': 'H', 'harness/evil.md': 'ESCAPED', 'evil.md': 'ESCAPED' });
  for (const agentKey of ['/../evil', 'a/b', '.hidden', '9lives', 'x'.repeat(65), 'unattended']) {
    assert.deepEqual(resolveAddon({ model: undefined, engine: 'codex', agentKey, mode: 'interactive', dir }).addon.files, ['harness/codex.md'], agentKey);
  }
});

test('resolveAddon: a symlinked harness folder is skipped with a warning; the model layer still applies', { skip: process.platform === 'win32' ? 'symlinks' : false }, () => {
  const real = dirWith({ 'codex.md': 'LINKED' });
  const dir = dirWith({ 'opus-5-5.md': 'M' });
  symlinkSync(real, join(dir, 'harness'));
  const { addon, warnings } = resolveAddon({ model: 'claude-opus-5-5', engine: 'codex', mode: 'unattended', dir });
  assert.deepEqual(warnings, ['model add-on folder "harness" skipped: not a directory']);
  assert.deepEqual(addon.files, ['opus-5-5.md']);
  assert.equal(addon.harness, null);
});

test('resolveAddon: a file named harness is skipped with the folder warning', () => {
  const dir = dirWith({ harness: 'not a folder', 'opus-5-5.md': 'M' });
  const { addon, warnings } = resolveAddon({ model: 'claude-opus-5-5', engine: 'codex', mode: 'unattended', dir });
  assert.deepEqual(warnings, ['model add-on folder "harness" skipped: not a directory']);
  assert.deepEqual(addon.files, ['opus-5-5.md']);
});

test('resolveAddon: a 2049-byte harness file is skipped; exactly 2048 bytes is allowed', () => {
  const dir = dirWith({ 'harness/codex.md': 'x'.repeat(2049) });
  assert.deepEqual(resolveAddon({ engine: 'codex', mode: 'unattended', dir }), { addon: null, warnings: ['model add-on "harness/codex.md" skipped: over 2048 bytes'] });
  writeFileSync(join(dir, 'harness', 'codex.md'), 'x'.repeat(2048), 'utf8');
  const ok = resolveAddon({ engine: 'codex', mode: 'unattended', dir });
  assert.deepEqual(ok.warnings, []);
  assert.equal(ok.addon.text, 'x'.repeat(2048));
});

test('resolveAddon: an agent key that is not a plain name reads no per-agent file', () => {
  // `opus-5-5./../evil.md` joins to <dir>/evil.md: without the key check that file would be read.
  const dir = dirWith({ 'opus-5-5.md': 'FAMILY', 'evil.md': 'ESCAPED' });
  for (const agentKey of ['/../evil', 'a/b', '.hidden', '9lives', 'x'.repeat(65)]) {
    assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', agentKey, mode: 'interactive', dir }).addon.files, ['opus-5-5.md'], agentKey);
  }
});

for (const engine of ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen']) {
  test(`engineTakesAddon: ${engine} takes an add-on`, () => {
    assert.equal(engineTakesAddon({ engine, model: 'claude-opus-5-5' }), true);
    assert.equal(engineTakesAddon({ engine }), true);
  });
}

test('engineTakesAddon: no engine is claude; the model plays no part; unknown names are refused', () => {
  assert.equal(engineTakesAddon({ model: 'claude-opus-5-5' }), true);
  assert.equal(engineTakesAddon(), true);
  assert.equal(engineTakesAddon({ engine: 'copilot', model: 'copilot/gpt-5.5' }), true);
  assert.equal(engineTakesAddon({ engine: 'copilot' }), true);
  for (const engine of ['claude2', '../x', 'Codex', 'constructor']) assert.equal(engineTakesAddon({ engine, model: 'claude-opus-5-5' }), false, engine);
});

test('resolveAddon: a symlink, a 2049-byte file and an empty file are skipped, with the named warnings', { skip: process.platform === 'win32' ? 'symlinks' : false }, () => {
  const dir = dirWith({ 'real.md': 'LINKED', 'opus-5-5.unattended.md': 'x'.repeat(2049), 'opus-5-5.implementer.md': ' \n\n ' });
  symlinkSync(join(dir, 'real.md'), join(dir, 'opus-5-5.md'));
  const { addon, warnings } = resolveAddon({ model: 'claude-opus-5-5', agentKey: 'implementer', mode: 'unattended', dir });
  assert.equal(addon, null);
  assert.deepEqual(warnings, [
    'model add-on "opus-5-5.md" skipped: not a regular file',
    'model add-on "opus-5-5.unattended.md" skipped: over 2048 bytes',
  ]);
  writeFileSync(join(dir, 'opus-5-5.unattended.md'), 'x'.repeat(2048), 'utf8');
  const ok = resolveAddon({ model: 'claude-opus-5-5', agentKey: 'implementer', mode: 'unattended', dir });
  assert.equal(ok.addon.text, 'x'.repeat(2048), 'exactly 2048 bytes is allowed');
  assert.deepEqual(ok.addon.files, ['opus-5-5.unattended.md']);
});

test('resolveAddon: a directory in a file\'s place is not a regular file', () => {
  const dir = dirWith({ 'opus-5-5.unattended.md': 'U' });
  mkdirSync(join(dir, 'opus-5-5.md'));
  const { addon, warnings } = resolveAddon({ model: 'claude-opus-5-5', mode: 'unattended', dir });
  assert.deepEqual(addon.files, ['opus-5-5.unattended.md']);
  assert.deepEqual(warnings, ['model add-on "opus-5-5.md" skipped: not a regular file']);
});

// ── assembly and the pin check ───────────────────────────────────────────────

test('appendAddon: no add-on returns the same string', () => {
  const s = 'TOOLS\n\nYou are the implementer.';
  assert.equal(appendAddon(s, null), s);
  assert.equal(appendAddon(s, undefined), s);
  assert.equal(appendAddon(s, { text: '' }), s);
  assert.equal(appendAddon('', null), '');
});

test('appendAddon: the add-on follows a blank line, or stands alone on an empty prompt', () => {
  const addon = { text: 'NOTES' };
  assert.equal(appendAddon('BODY', addon), 'BODY\n\nNOTES');
  assert.equal(appendAddon('', addon), 'NOTES');
});

test('isPinnedAddon: the shape, the cap and the sha256 are all checked', () => {
  const good = { v: 1, family: 'opus-5-5', mode: 'unattended', files: ['opus-5-5.md'], text: 'T', sha256: sha('T') };
  assert.equal(isPinnedAddon(good), true);
  for (const bad of [
    null, undefined, 'x', {}, { ...good, v: 2 }, { ...good, text: '' }, { ...good, text: 7 }, { ...good, sha256: sha('U') },
    { ...good, family: 'opus-4-7' }, { ...good, mode: 'other' }, { ...good, files: 'opus-5-5.md' }, { ...good, files: [3] },
    { ...good, text: 'x'.repeat(12801), sha256: sha('x'.repeat(12801)) },
  ]) assert.equal(isPinnedAddon(bad), false, JSON.stringify(bad)?.slice(0, 80));
  assert.equal(isPinnedAddon({ ...good, text: 'x'.repeat(6401), sha256: sha('x'.repeat(6401)) }), true, 'a v1 pin over the old 6400 cap');
  assert.equal(isPinnedAddon({ ...good, text: 'x'.repeat(12800), sha256: sha('x'.repeat(12800)) }), true);
});

const V2 = { v: 2, engine: 'codex', harness: 'codex', family: 'gpt-6', mode: 'unattended', files: ['harness/codex.md', 'gpt-6.md'], text: 'T', sha256: sha('T') };

test('isPinnedAddon: v2 records — harness-only, family-only and both; the bad shapes', () => {
  assert.equal(isPinnedAddon(V2), true, 'both');
  assert.equal(isPinnedAddon({ ...V2, family: null }), true, 'harness only');
  assert.equal(isPinnedAddon({ ...V2, harness: null }), true, 'family only');
  assert.equal(isPinnedAddon({ ...V2, text: 'x'.repeat(12800), sha256: sha('x'.repeat(12800)) }), true);
  for (const [why, bad] of [
    ['harness of another engine', { ...V2, harness: 'gemini' }], ['both null', { ...V2, harness: null, family: null }],
    ['unknown engine', { ...V2, engine: 'x', harness: 'x' }], ['unknown engine, no harness', { ...V2, engine: 'x', harness: null }],
    ['unknown family', { ...V2, family: 'gpt-5' }], ['v3', { ...V2, v: 3 }], ['no engine', { ...V2, engine: undefined, harness: null }],
    ['bad mode', { ...V2, mode: 'other' }], ['files not strings', { ...V2, files: [3] }], ['forged sha', { ...V2, sha256: sha('U') }],
    ['over the cap', { ...V2, text: 'x'.repeat(12801), sha256: sha('x'.repeat(12801)) }], ['empty text', { ...V2, text: '', sha256: sha('') }],
  ]) assert.equal(isPinnedAddon(bad), false, why);
});

test('pinFitsSpawn: a v2 pin only on its own engine; a v1 pin only under the legacy rule', () => {
  assert.equal(pinFitsSpawn(V2, { engine: 'codex', model: 'gpt-6.1-sol' }), true);
  assert.equal(pinFitsSpawn(V2, { engine: 'claude', model: 'claude-opus-5-5' }), false);
  assert.equal(pinFitsSpawn(V2, {}), false, 'no engine is claude');
  const claudePin = { ...V2, engine: 'claude', harness: null, family: 'opus-5-5' };
  assert.equal(pinFitsSpawn(claudePin, {}), true, 'a v2 claude pin on no engine');
  assert.equal(pinFitsSpawn(claudePin, { engine: 'claude' }), true);
  const v1 = { v: 1, family: 'opus-5-5', mode: 'unattended', files: ['opus-5-5.md'], text: 'T', sha256: sha('T') };
  assert.equal(pinFitsSpawn(v1, { engine: 'claude', model: 'claude-opus-5-5' }), true);
  assert.equal(pinFitsSpawn(v1, { model: 'claude-opus-5-5' }), true);
  assert.equal(pinFitsSpawn(v1, { engine: 'copilot', model: 'copilot/claude-opus-5.5' }), true);
  assert.equal(pinFitsSpawn(v1, { engine: 'copilot', model: 'copilot/gpt-6.1-sol' }), false);
  assert.equal(pinFitsSpawn(v1, { engine: 'codex', model: 'claude-opus-5-5' }), false);
  assert.equal(pinFitsSpawn({ ...V2, sha256: sha('U') }, { engine: 'codex' }), false, 'a forged sha');
  assert.equal(pinFitsSpawn(null, { engine: 'codex' }), false);
  assert.equal(pinFitsSpawn(V2), false);
});

test('ADDONS_DIR is agents/addons/ beside the built-in agents', () => {
  assert.match(ADDONS_DIR.replace(/\\/g, '/'), /\/agents\/addons\/?$/);
});

// ── the shipped add-on files: one snapshot per family, engine and mode, and the content rules ──

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SNAP_DIR = join(REPO, 'test', 'fixtures', 'model-addons');
const HARNESS_DIR = join(ADDONS_DIR, 'harness');
const regularFiles = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
// The model layer's files, and the harness layer's (relative to ADDONS_DIR: `harness/<name>`).
const SHIPPED = regularFiles(ADDONS_DIR);
const SHIPPED_HARNESS = regularFiles(HARNESS_DIR);
const ALL_SHIPPED = [...SHIPPED, ...SHIPPED_HARNESS.map((n) => `harness/${n}`)];
const AGENT_KEYS = new Set(readdirSync(join(REPO, 'agents')).filter((f) => f.endsWith('.meta.json')).map((f) => f.slice(0, -'.meta.json'.length)));
// One representative id per family: the claude-* id for Anthropic families, a catalog or typed id for the others.
const FAMILY_ID = Object.fromEntries(ADDON_FAMILIES.map((f) => [f, `claude-${f}`]));
Object.assign(FAMILY_ID, { 'gpt-6': 'gpt-6.1-sol', 'gpt-5-codex': 'gpt-5.3-codex', 'gemini-3': 'gemini-3.8-flash', 'kimi-k3': 'copilot/kimi-k3' });
const CARVE_OUT = '- A refused tool call, a permission denial or a host-guard block is not an obstacle: do not retry it by another tool or route; report it.';
// A fixed one-line body keeps the snapshots about the add-on: an edit of the implementer's .md churns none of them.
const plainPrompt = () => buildSystemPrompt('', resolveAgentBody({ node: { agentPrompt: 'You are the implementer.' }, agentPrompts: {} }, 'implementer'), 'implementer');

/** Compare one assembled prompt with its snapshot file (or write it under UPDATE_ADDON_SNAPSHOTS=1). */
function checkSnapshot(name, { addon, warnings }) {
  assert.deepEqual(warnings, []);
  const plain = plainPrompt();
  const assembled = appendAddon(plain, addon);
  const file = join(SNAP_DIR, name);
  const text = addon ? assembled : 'NO-ADDON';
  if (!addon) assert.equal(assembled, plain, 'no add-on: the plain prompt, unchanged');
  if (process.env.UPDATE_ADDON_SNAPSHOTS === '1') { mkdirSync(SNAP_DIR, { recursive: true }); writeFileSync(file, text, 'utf8'); return; }
  assert.ok(existsSync(file), `${file}: no snapshot yet; regenerate with UPDATE_ADDON_SNAPSHOTS=1`);
  assert.equal(text, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `${name}: the assembled prompt changed; regenerate with UPDATE_ADDON_SNAPSHOTS=1 if deliberate`);
}

test('every FAMILY_ID resolves to its family', () => {
  for (const family of ADDON_FAMILIES) assert.equal(resolveAddonFamily(FAMILY_ID[family]), family, family);
});

// The model layer alone: engine claude has no harness file, so these snapshots hold no harness text.
for (const family of ADDON_FAMILIES) {
  for (const mode of ['interactive', 'unattended']) {
    test(`snapshot: ${family} ${mode} implementer prompt`, () => {
      checkSnapshot(`${family}.${mode}.implementer.txt`, resolveAddon({ model: FAMILY_ID[family], engine: 'claude', agentKey: 'implementer', mode }));
    });
  }
}

test('every family has an add-on in at least one mode', () => {
  for (const family of ADDON_FAMILIES) {
    const some = ['interactive', 'unattended'].some((mode) => resolveAddon({ model: FAMILY_ID[family], engine: 'claude', agentKey: 'implementer', mode }).addon);
    assert.ok(some, `${family}: NO-ADDON in both modes`);
  }
});

// The harness layer alone (no model): NO-ADDON pins "no file" for claude, cursor and opencode.
for (const engine of ENGINE_NAMES) {
  for (const mode of ['interactive', 'unattended']) {
    test(`snapshot: harness ${engine} ${mode} implementer prompt`, () => {
      checkSnapshot(`harness-${engine}.${mode}.implementer.txt`, resolveAddon({ model: undefined, engine, agentKey: 'implementer', mode }));
    });
  }
}

test('snapshot: both layers, harness first (codex on gpt-6.1-sol, unattended implementer)', () => {
  const resolved = resolveAddon({ model: 'gpt-6.1-sol', engine: 'codex', agentKey: 'implementer', mode: 'unattended' });
  assert.equal(resolved.addon.harness, 'codex');
  assert.equal(resolved.addon.family, 'gpt-6');
  checkSnapshot('combined.codex.gpt-6-1-sol.unattended.implementer.txt', resolved);
});

test('content: every add-on file is a short markdown file with a known name', () => {
  assert.ok(SHIPPED.length > 0);
  assert.ok(SHIPPED_HARNESS.length > 0);
  for (const [layer, names, known, dir, base] of [
    ['model', SHIPPED, ADDON_FAMILIES, ADDONS_DIR, 'Model notes'], ['harness', SHIPPED_HARNESS, ENGINE_NAMES, HARNESS_DIR, 'Harness notes'],
  ]) {
    for (const name of names) {
      const m = /^([a-z0-9-]+?)(?:\.([A-Za-z0-9_-]+))?\.md$/.exec(name);
      assert.ok(m, `${layer} ${name}: only <name>[.<agentKey>|.unattended].md files`);
      assert.ok(known.includes(m[1]), `${layer} ${name}: unknown ${layer === 'model' ? 'family' : 'engine'} ${m[1]}`);
      if (m[2] && m[2] !== 'unattended') assert.ok(AGENT_KEYS.has(m[2]), `${name}: no agent "${m[2]}" in agents/*.meta.json`);
      const raw = readFileSync(join(dir, name));
      assert.ok(raw.length <= 2048, `${name}: over 2048 bytes`);
      const text = raw.toString('utf8');
      assert.ok(text.trimEnd().split('\n').length <= 15, `${name}: over 15 lines`);
      const baseFile = names.includes(`${m[1]}.md`);
      const heading = m[2] && m[2] !== 'unattended' && baseFile ? `## ${base} for this step` : `## ${base}`;
      assert.equal(text.split('\n')[0], heading, `${name}: starts with "${heading}"`);
    }
  }
});

test('content: every family has a shipped file, and every table family is a known one', () => {
  for (const family of ADDON_FAMILIES) {
    assert.ok(SHIPPED.some((n) => n.split('.')[0] === family), `${family}: no file`);
  }
  for (const family of Object.values(MODEL_ID_FAMILIES)) assert.ok(ADDON_FAMILIES.includes(family), family);
});

test('content: no ownership sentence, and keep-going text only in unattended files', () => {
  for (const name of ALL_SHIPPED) {
    const text = readFileSync(join(ADDONS_DIR, name), 'utf8');
    assert.doesNotMatch(text, /\bowner\b|maintainer/i, `${name}: no ownership sentence`);
    if (!name.endsWith('.unattended.md')) {
      assert.doesNotMatch(text, /keep working|keep going|do not end your turn|Want me to|carry the task to completion|until every|do not give up/i, `${name}: keep-going text belongs in a .unattended.md file`);
    }
  }
});

test('content: every unattended file carries the refusal / permission / host-guard carve-out', () => {
  const unattended = ALL_SHIPPED.filter((n) => n.endsWith('.unattended.md'));
  assert.ok(unattended.length >= 10);
  for (const name of unattended) {
    const lines = readFileSync(join(ADDONS_DIR, name), 'utf8').split('\n');
    assert.ok(lines.includes(CARVE_OUT), `${name}: no carve-out line`);
  }
});

test('content: the sonnet-5-5 and haiku-5-5 files are deliberate identical pairs', () => {
  for (const suffix of ['.md', '.unattended.md']) {
    assert.equal(readFileSync(join(ADDONS_DIR, `sonnet-5-5${suffix}`), 'utf8'), readFileSync(join(ADDONS_DIR, `haiku-5-5${suffix}`), 'utf8'), suffix);
  }
});

test('content: sonnet-5, sonnet-4-6 and haiku-4-5 share one unattended file (one guide section names all three)', () => {
  const sonnet5 = readFileSync(join(ADDONS_DIR, 'sonnet-5.unattended.md'), 'utf8');
  assert.equal(readFileSync(join(ADDONS_DIR, 'sonnet-4-6.unattended.md'), 'utf8'), sonnet5);
  assert.equal(readFileSync(join(ADDONS_DIR, 'haiku-4-5.unattended.md'), 'utf8'), sonnet5);
});

// Each tool name a harness file cites, with the Claude Code tool it stands for: the adapter maps are the source.
const HARNESS_TOOLS = {
  copilot: [['bash', 'Bash'], ['view', 'Read'], ['rg', 'Grep'], ['grep', 'Grep'], ['glob', 'Glob'], ['create', 'Write'], ['apply_patch', 'Edit'], ['edit', 'Edit'], ['str_replace', 'Edit']],
  goose: [['shell', 'Bash'], ['write', 'Write'], ['edit', 'Edit']],
  gemini: [['run_shell_command', 'Bash'], ['read_file', 'Read'], ['write_file', 'Write'], ['replace', 'Edit'], ['grep_search', 'Grep'], ['search_file_content', 'Grep'], ['glob', 'Glob']],
  qwen: [['run_shell_command', 'Bash'], ['read_file', 'Read'], ['write_file', 'Write'], ['edit', 'Edit'], ['grep_search', 'Grep'], ['glob', 'Glob']],
  codex: [['apply_patch', 'Edit']],
};

test('content: every tool a harness file names is a real tool of that harness', () => {
  for (const [name, claude] of HARNESS_TOOLS.copilot) assert.equal(COPILOT_TOOL_NAMES[name], claude, `copilot ${name}`);
  for (const [name, claude] of HARNESS_TOOLS.goose) assert.equal(GOOSE_TOOL_NAMES[name], claude, `goose ${name}`);
  for (const [name, claude] of HARNESS_TOOLS.gemini) assert.equal(claudeToolName(name), claude, `gemini ${name}`);
  for (const [name, claude] of HARNESS_TOOLS.qwen) {
    assert.ok(QWEN_BUILTIN_TOOLS.includes(name), `qwen ${name}`);
    assert.equal(claudeToolName(name), claude, `qwen ${name}`);
  }
  for (const [engine, pairs] of Object.entries(HARNESS_TOOLS)) {
    const text = readFileSync(join(HARNESS_DIR, `${engine}.md`), 'utf8');
    for (const [name] of pairs) assert.ok(text.includes(`\`${name}\``), `harness/${engine}.md names \`${name}\``);
    const listed = new Set(pairs.map(([name]) => name));
    for (const [, token] of text.matchAll(/`([^`]+)`/g)) assert.ok(listed.has(token), `harness/${engine}.md names \`${token}\`, which is not a listed tool`);
  }
});

test('content: the interactive fable-5-2 prompt carries none of the unattended file', () => {
  const unattended = readFileSync(join(ADDONS_DIR, 'fable-5-2.unattended.md'), 'utf8').trim();
  const snap = readFileSync(join(SNAP_DIR, 'fable-5-2.interactive.implementer.txt'), 'utf8');
  for (const line of unattended.split('\n').filter((l) => l.startsWith('- '))) assert.equal(snap.includes(line), false, line);
  assert.ok(readFileSync(join(SNAP_DIR, 'fable-5-2.unattended.implementer.txt'), 'utf8').includes(unattended.split('\n').at(-1)));
});
