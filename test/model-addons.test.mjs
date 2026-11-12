// test/model-addons.test.mjs — the per-model-family prompt add-ons (src/core/model-addons.mjs): the family map, the
// engine allow-list, the mode split, the file lookup and its guards, the assembly, and one snapshot per family and mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt, resolveAgentBody } from '../src/core/phases.mjs';
import {
  ADDON_FAMILIES, ADDONS_DIR, resolveModelFamily, addonMode, resolveAddon, appendAddon, isPinnedAddon, engineTakesAddon,
} from '../src/core/model-addons.mjs';

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
]) {
  test(`resolveModelFamily: ${JSON.stringify(id)}${engine ? ` on ${engine}` : ''} → null`, () => {
    assert.equal(resolveModelFamily(id, engine ? { engine } : {}), null);
  });
}

test('ADDON_FAMILIES is the frozen set of 9 families', () => {
  assert.deepEqual([...ADDON_FAMILIES].sort(), ['fable-5', 'fable-5-1', 'fable-5-2', 'haiku-5-5', 'opus-4-8', 'opus-5', 'opus-5-5', 'sonnet-5', 'sonnet-5-5']);
  assert.ok(Object.isFrozen(ADDON_FAMILIES));
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

function dirWith(files) {
  const d = tmp();
  for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text, 'utf8');
  return d;
}

test('resolveAddon: family file, then the unattended file, then the per-agent file, joined by a blank line', () => {
  const dir = dirWith({ 'opus-5-5.md': 'FAMILY\n', 'opus-5-5.unattended.md': '  UNATTENDED  \n', 'opus-5-5.implementer.md': 'AGENT', 'opus-5-5.reviewer.md': 'OTHER' });
  const { addon, warnings } = resolveAddon({ model: 'claude-opus-5-5', engine: 'claude', agentKey: 'implementer', mode: 'unattended', dir });
  assert.deepEqual(warnings, []);
  assert.deepEqual(addon, {
    v: 1, family: 'opus-5-5', mode: 'unattended',
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
  assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', engine: 'codex', mode: 'unattended', dir }), { addon: null, warnings: [] });
  assert.deepEqual(resolveAddon({ model: 'claude-sonnet-5-5', mode: 'unattended', dir }), { addon: null, warnings: [] });
  assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', mode: 'unattended', dir: join(dir, 'missing') }), { addon: null, warnings: [] });
});

test('resolveAddon: an agent key that is not a plain name reads no per-agent file', () => {
  // `opus-5-5./../evil.md` joins to <dir>/evil.md: without the key check that file would be read.
  const dir = dirWith({ 'opus-5-5.md': 'FAMILY', 'evil.md': 'ESCAPED' });
  for (const agentKey of ['/../evil', 'a/b', '.hidden', '9lives', 'x'.repeat(65)]) {
    assert.deepEqual(resolveAddon({ model: 'claude-opus-5-5', agentKey, mode: 'interactive', dir }).addon.files, ['opus-5-5.md'], agentKey);
  }
});

test('engineTakesAddon: claude or no engine, and copilot on a claude-* wire model only', () => {
  assert.equal(engineTakesAddon({ model: 'claude-opus-5-5' }), true);
  assert.equal(engineTakesAddon({ engine: 'claude', model: 'anything' }), true);
  assert.equal(engineTakesAddon({ engine: 'copilot', model: 'copilot/claude-opus-5.5' }), true);
  assert.equal(engineTakesAddon({ engine: 'copilot', model: 'copilot/gpt-5.5' }), false);
  assert.equal(engineTakesAddon({ engine: 'copilot' }), false);
  for (const engine of ['codex', 'cursor', 'opencode', 'gemini', 'qwen', 'goose']) assert.equal(engineTakesAddon({ engine, model: 'claude-opus-5-5' }), false, engine);
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
    { ...good, text: 'x'.repeat(6401), sha256: sha('x'.repeat(6401)) },
  ]) assert.equal(isPinnedAddon(bad), false, JSON.stringify(bad)?.slice(0, 80));
  assert.equal(isPinnedAddon({ ...good, text: 'x'.repeat(6400), sha256: sha('x'.repeat(6400)) }), true);
});

test('ADDONS_DIR is agents/addons/ beside the built-in agents', () => {
  assert.match(ADDONS_DIR.replace(/\\/g, '/'), /\/agents\/addons\/?$/);
});

// ── the shipped add-on files: one snapshot per family and mode, and the content rules ──

const REPO = fileURLToPath(new URL('../', import.meta.url));
const SNAP_DIR = join(REPO, 'test', 'fixtures', 'model-addons');
const SHIPPED = readdirSync(ADDONS_DIR).sort();
const AGENT_KEYS = new Set(readdirSync(join(REPO, 'agents')).filter((f) => f.endsWith('.meta.json')).map((f) => f.slice(0, -'.meta.json'.length)));
const FAMILY_ID = Object.fromEntries(ADDON_FAMILIES.map((f) => [f, `claude-${f}`]));
// A fixed one-line body keeps the snapshots about the add-on: an edit of the implementer's .md churns none of them.
const plainPrompt = () => buildSystemPrompt('', resolveAgentBody({ node: { agentPrompt: 'You are the implementer.' }, agentPrompts: {} }, 'implementer'), 'implementer');

for (const family of ADDON_FAMILIES) {
  for (const mode of ['interactive', 'unattended']) {
    test(`snapshot: ${family} ${mode} implementer prompt`, () => {
      const plain = plainPrompt();
      const { addon, warnings } = resolveAddon({ model: FAMILY_ID[family], engine: 'claude', agentKey: 'implementer', mode });
      assert.deepEqual(warnings, []);
      const assembled = appendAddon(plain, addon);
      const file = join(SNAP_DIR, `${family}.${mode}.implementer.txt`);
      const text = addon ? assembled : 'NO-ADDON';
      if (!addon) assert.equal(assembled, plain, 'no add-on: the plain prompt, unchanged');
      if (process.env.UPDATE_ADDON_SNAPSHOTS === '1') { mkdirSync(SNAP_DIR, { recursive: true }); writeFileSync(file, text, 'utf8'); return; }
      assert.ok(existsSync(file), `${file}: no snapshot yet; regenerate with UPDATE_ADDON_SNAPSHOTS=1`);
      assert.equal(text, readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `${family}.${mode}: the assembled prompt changed; regenerate with UPDATE_ADDON_SNAPSHOTS=1 if deliberate`);
    });
  }
}

test('content: every add-on file is a short markdown file with a known name', () => {
  assert.ok(SHIPPED.length > 0);
  for (const name of SHIPPED) {
    const m = /^([a-z0-9-]+?)(?:\.([A-Za-z0-9_-]+))?\.md$/.exec(name);
    assert.ok(m, `${name}: only <family>[.<agentKey>|.unattended].md files`);
    assert.ok(ADDON_FAMILIES.includes(m[1]), `${name}: unknown family ${m[1]}`);
    if (m[2] && m[2] !== 'unattended') assert.ok(AGENT_KEYS.has(m[2]), `${name}: no agent "${m[2]}" in agents/*.meta.json`);
    const raw = readFileSync(join(ADDONS_DIR, name));
    assert.ok(raw.length <= 2048, `${name}: over 2048 bytes`);
    const text = raw.toString('utf8');
    assert.ok(text.trimEnd().split('\n').length <= 15, `${name}: over 15 lines`);
    const familyFile = SHIPPED.includes(`${m[1]}.md`);
    const heading = m[2] && m[2] !== 'unattended' && familyFile ? '## Model notes for this step' : '## Model notes';
    assert.equal(text.split('\n')[0], heading, `${name}: starts with "${heading}"`);
  }
});

test('content: no ownership sentence, and keep-going text only in unattended files', () => {
  for (const name of SHIPPED) {
    const text = readFileSync(join(ADDONS_DIR, name), 'utf8');
    assert.doesNotMatch(text, /\bowner\b|maintainer/i, `${name}: no ownership sentence`);
    if (!name.endsWith('.unattended.md')) {
      assert.doesNotMatch(text, /keep working|keep going|do not end your turn|Want me to/i, `${name}: keep-going text belongs in a .unattended.md file`);
    }
  }
});

test('content: the sonnet-5-5 and haiku-5-5 files are deliberate identical pairs', () => {
  for (const suffix of ['.md', '.unattended.md']) {
    assert.equal(readFileSync(join(ADDONS_DIR, `sonnet-5-5${suffix}`), 'utf8'), readFileSync(join(ADDONS_DIR, `haiku-5-5${suffix}`), 'utf8'), suffix);
  }
});

test('content: the interactive fable-5-2 prompt carries none of the unattended file', () => {
  const unattended = readFileSync(join(ADDONS_DIR, 'fable-5-2.unattended.md'), 'utf8').trim();
  const snap = readFileSync(join(SNAP_DIR, 'fable-5-2.interactive.implementer.txt'), 'utf8');
  for (const line of unattended.split('\n').filter((l) => l.startsWith('- '))) assert.equal(snap.includes(line), false, line);
  assert.ok(readFileSync(join(SNAP_DIR, 'fable-5-2.unattended.implementer.txt'), 'utf8').includes(unattended.split('\n').at(-1)));
});
