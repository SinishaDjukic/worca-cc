// test/workflow-test-project-claude-settings.test.mjs — workflow tests 3b, Task 3 (D72): the project's own Claude Code hooks and
// plugins switched off in a Pretend try's checkout; links never followed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strippedSettingsText, strippedFrontmatterText, isTryGuardEnvKey, stripProjectClaudeSettings, PROJECT_SETTINGS_FILES, STRIPPED_SETTINGS_KEYS }
  from '../src/core/workflow-tests/project-claude-settings.mjs';
import { RunHarness } from '../src/core/run-harness.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-pcs-')); dirs.push(d); return d; };
const canLinkFiles = (() => { try { const d = tmp(); writeFileSync(join(d, 't'), 'x'); symlinkSync(join(d, 't'), join(d, 'l')); return true; } catch { return false; } })();
const FILE_LINKS = { skip: canLinkFiles ? false : 'this machine cannot make file symlinks (EPERM on Windows without developer mode)' };

test('the text: hooks and enabledPlugins go, everything else stays; nothing to do is null', () => {
  assert.deepEqual(STRIPPED_SETTINGS_KEYS, ['hooks', 'enabledPlugins', 'extraKnownMarketplaces']);
  assert.deepEqual(PROJECT_SETTINGS_FILES, ['.claude/settings.json', '.claude/settings.local.json']);
  const t = strippedSettingsText(JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'] }, hooks: { SessionStart: [] }, enabledPlugins: { 'p@m': true }, env: { A: '1' } }));
  assert.deepEqual(JSON.parse(t), { permissions: { allow: ['Bash(npm test:*)'] }, env: { A: '1' } });
  assert.ok(t.endsWith('\n'));
  assert.equal(strippedSettingsText(JSON.stringify({ permissions: {} })), null, 'no such key');
  assert.equal(strippedSettingsText('{ not json'), null, 'the CLI cannot read it either');
  assert.equal(strippedSettingsText('[1]'), null);
  assert.equal(strippedSettingsText(''), null);
  assert.deepEqual(JSON.parse(strippedSettingsText(`﻿${JSON.stringify({ hooks: {} })}`)), {});
});

test('in a checkout: both files, what changed is named; agents, skills and CLAUDE.md are not touched', async () => {
  const d = tmp();
  mkdirSync(join(d, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [] }, model: 'x' }));
  writeFileSync(join(d, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { a: true } }));
  writeFileSync(join(d, '.claude', 'agents', 'a.md'), '# a');
  writeFileSync(join(d, 'CLAUDE.md'), '# rules');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: ['.claude/settings.json', '.claude/settings.local.json'], links: [] });
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8')), { model: 'x' });
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude', 'settings.local.json'), 'utf8')), {});
  assert.equal(readFileSync(join(d, '.claude', 'agents', 'a.md'), 'utf8'), '# a');
  assert.equal(readFileSync(join(d, 'CLAUDE.md'), 'utf8'), '# rules');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: [] }, 'a second pass changes nothing');
  assert.deepEqual(await stripProjectClaudeSettings(tmp()), { changed: [], links: [] }, 'no .claude folder');
});

test('the sandbox and permissions stay (the sign-in carry reads them, D81a)', async () => {
  const d = tmp();
  mkdirSync(join(d, '.claude'));
  const keep = { sandbox: { enabled: true, network: { allowedDomains: ['a.example'] } }, permissions: { deny: ['Bash(curl:*)'] } };
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ ...keep, hooks: { Stop: [] } }));
  writeFileSync(join(d, '.claude', 'settings.local.json'), JSON.stringify({ sandbox: { enabled: false }, enabledPlugins: { a: true } }));
  await stripProjectClaudeSettings(d);
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8')), keep);
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude', 'settings.local.json'), 'utf8')), { sandbox: { enabled: false } });
});

test('a settings file that is a link is removed, never followed', FILE_LINKS, async () => {
  const d = tmp();
  const outside = tmp();
  const target = join(outside, 'settings.json');
  writeFileSync(target, JSON.stringify({ hooks: { PreToolUse: [] } }));
  mkdirSync(join(d, '.claude'));
  symlinkSync(target, join(d, '.claude', 'settings.json'));
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: ['.claude/settings.json'] });
  assert.equal(existsSync(join(d, '.claude', 'settings.json')), false);
  assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), { hooks: { PreToolUse: [] } }, 'the file it pointed at is untouched');
});

test('a .claude folder that is a link (a junction on Windows) is removed, the link only', async () => {
  const d = tmp();
  const outside = tmp();
  writeFileSync(join(outside, 'settings.json'), JSON.stringify({ hooks: {} }));
  symlinkSync(outside, join(d, '.claude'), 'junction');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: ['.claude'] });
  assert.equal(existsSync(join(d, '.claude')), false);
  assert.deepEqual(JSON.parse(readFileSync(join(outside, 'settings.json'), 'utf8')), { hooks: {} }, 'never followed');
});

test('a file that cannot be written throws (the caller ends the try)', { skip: process.getuid && process.getuid() === 0 ? 'root writes a read-only file' : false }, async () => {
  const { chmodSync } = await import('node:fs');
  const d = tmp();
  mkdirSync(join(d, '.claude'));
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ hooks: {} }));
  chmodSync(join(d, '.claude', 'settings.json'), 0o444);
  // M6: the file is replaced by a rename, which a read-only file stops on Windows; on POSIX the folder must be read-only too.
  if (process.platform !== 'win32') chmodSync(join(d, '.claude'), 0o555);
  try { await assert.rejects(stripProjectClaudeSettings(d), /EACCES|EPERM/); } finally {
    if (process.platform !== 'win32') chmodSync(join(d, '.claude'), 0o755);
    chmodSync(join(d, '.claude', 'settings.json'), 0o644);
  }
});

// ── Task 5 (security review M10): what else in the project's settings would undo a Pretend try ───────────────────────────
test('M10: extraKnownMarketplaces goes, and the env keys that undo the try guard (the CLI applies settings env to its tools)', () => {
  assert.ok(STRIPPED_SETTINGS_KEYS.includes('extraKnownMarketplaces'));
  const env = { PATH: '/evil', Path: 'C:/evil', GIT_SSH_COMMAND: 'ssh', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_GLOBAL: '/g',
    GH_CONFIG_DIR: '/gh', GLAB_CONFIG_DIR: '/gl', AZURE_CONFIG_DIR: '/az', WORCA_TRY_GUARD_LOG: '/x', worca_home: '/h', GIT_TERMINAL_PROMPT: '1',
    GCM_INTERACTIVE: 'always', WSLENV: 'X', GH_TOKEN: 'ghp_x', NPM_TOKEN: 'n', NODE_ENV: 'test', BASH_DEFAULT_TIMEOUT_MS: '1000' };
  const t = strippedSettingsText(JSON.stringify({ env, extraKnownMarketplaces: { m: {} }, model: 'x' }));
  assert.deepEqual(JSON.parse(t), { env: { NODE_ENV: 'test', BASH_DEFAULT_TIMEOUT_MS: '1000' }, model: 'x' });
  assert.equal(strippedSettingsText(JSON.stringify({ env: { NODE_ENV: 'x' } })), null, 'nothing to strip: unchanged');
  for (const k of ['PATH', 'Path', 'GIT_CONFIG_VALUE_3', 'WORCA_X', 'WSLENV', 'GH_TOKEN']) assert.ok(isTryGuardEnvKey(k), k);
  for (const k of ['NODE_ENV', 'GITHUB_WORKSPACE', 'PATHEXT']) assert.equal(isTryGuardEnvKey(k), false, k);
});

test('concern 3: NODE_OPTIONS and NODE_PATH go too: the CLI hands settings env to Worca\'s own node hook (probe nodeopts-318)', () => {
  const t = strippedSettingsText(JSON.stringify({ env: { NODE_OPTIONS: '--require ./x.js', node_path: './evil', NODE_ENV: 'test' } }));
  assert.deepEqual(JSON.parse(t), { env: { NODE_ENV: 'test' } });
  for (const k of ['NODE_OPTIONS', 'Node_Options', 'NODE_PATH']) assert.ok(isTryGuardEnvKey(k), k);
});

// ── Task 5 (security review M6): never write through a hardlink ───────────────────────────────────────────────────────────
test('M6: a settings file that is a hardlink to a file outside the checkout: the outside file is unchanged', async () => {
  const d = tmp();
  const outside = join(tmp(), 'outside.json');
  writeFileSync(outside, JSON.stringify({ hooks: { PreToolUse: [] }, model: 'x' }));
  mkdirSync(join(d, '.claude'));
  linkSync(outside, join(d, '.claude', 'settings.json'));
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: ['.claude/settings.json'], links: [] });
  assert.deepEqual(JSON.parse(readFileSync(outside, 'utf8')), { hooks: { PreToolUse: [] }, model: 'x' }, 'the link target is untouched');
  assert.deepEqual(JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8')), { model: 'x' });
  assert.deepEqual(readdirSync(join(d, '.claude')), ['settings.json'], 'no temp file left');
});

// ── Task 5 (security review I2, decision D72a): hooks in the frontmatter of the project's skills, agents and commands ─────
const FM = (hooksBlock, rest = 'description: d\n') => `---\nname: x\n${hooksBlock}${rest}---\nBody with hooks: in it.\n\n---\nnot frontmatter\n`;
const BLOCK = 'hooks:\n  PreToolUse:\n    - matcher: "Bash"\n\n      hooks:\n        - type: command\n          command: "node mark.js"\n';

test('D72a: the frontmatter loses its top-level hooks key and block; every other byte stays', () => {
  assert.equal(strippedFrontmatterText(FM(BLOCK)).text, FM(''));
  assert.equal(strippedFrontmatterText(FM('hooks: {}\n')).text, FM(''), 'an inline value');
  assert.equal(strippedFrontmatterText(FM('hooks: { PreToolUse: [ { matcher: "Bash" } ] }  # c\n')).text, FM(''));
  assert.equal(strippedFrontmatterText(FM('"hooks":\n  Stop: []\n')).text, FM(''), 'a quoted key');
  assert.equal(strippedFrontmatterText(FM(BLOCK, '')).text, FM('', ''), 'the last key');
  const crlf = `\uFEFF${FM(BLOCK)}`.replace(/\n/g, '\r\n');
  assert.equal(strippedFrontmatterText(crlf).text, `\uFEFF${FM('')}`.replace(/\n/g, '\r\n'), 'BOM and CRLF kept');
  // (review m4: `description: hooks: none` unquoted is not YAML at all and now fails closed; quoted it is a plain value)
  for (const t of [FM(''), 'no frontmatter\nhooks: x\n', '', FM('', 'description: "hooks: none"\nnested:\n  hooks: kept\n')]) {
    assert.equal(strippedFrontmatterText(t), null, JSON.stringify(t.slice(0, 40)));
  }
});

test('D72a: a frontmatter Worca cannot change safely is left as it is and named', () => {
  for (const [t, why] of [['---\nname: x\nhooks:\n  Stop: []\n', 'no closing line'], [FM('hooks: { PreToolUse: [\n  { matcher: "Bash" } ] }\n'), 'a flow value over lines'],
    [FM('hooks:\n\tStop: []\n'), 'a tab'], [FM('hooks: &h\n  Stop: []\n', 'other: *h\n'), 'an anchor used elsewhere'], [FM('hooks: {}\nhooks: {}\n'), 'two hooks keys'],
    [FM('hooks: "a\n  b"\n'), 'an open quote']]) {
    assert.deepEqual(strippedFrontmatterText(t), { unsafe: true }, why);
  }
});

test('review m4: YAML forms that still carry a top-level hooks key fail closed (left as they are, named); one that parses without it is fine', () => {
  for (const [t, why] of [
    ['---\n  name: x\n  hooks:\n    Stop: []\n---\nbody\n', 'an indented root mapping'],
    ['---\nname: x\n? hooks\n: { Stop: [] }\n---\nbody\n', 'an explicit ? key'],
    ['---\nname: x\nbase: &b\n  hooks:\n    Stop: []\n<<: *b\n---\nbody\n', 'a merge key bringing hooks'],
    ['---\n{ name: x, hooks: { Stop: [] } }\n---\nbody\n', 'a flow-style frontmatter'],
    ['---\n"ho\\u006fks": { Stop: [] }\nname: x\n---\nbody\n', 'an escaped key'],
    ['---\nname: [x\n  hooks: { Stop: [] }\n---\nbody\n', 'YAML that does not parse, mentioning hooks'],
    [FM('', 'description: hooks: none\n'), 'not YAML (a plain value with ": " in it), mentioning hooks'],
    [FM(BLOCK, 'base: &b\n  hooks:\n    Stop: []\n<<: *b\n'), 'a merge key bringing hooks back after the line strip'],
  ]) assert.deepEqual(strippedFrontmatterText(t), { unsafe: true }, why);
  assert.equal(strippedFrontmatterText('---\nname: x\nbase: &b\n  model: y\n<<: *b\n---\nbody\n'), null, 'a merge key with no hooks: nothing to do');
  assert.equal(strippedFrontmatterText('---\nname: [x\n---\nbody\n'), null, 'YAML that does not parse and never says hooks: nothing to do');
});

test('I-2: nested .claude folders below the checkout root (a monorepo package\'s skills load once the agent works there: probe nested-read-318) lose their hooks too', async () => {
  const d = tmp();
  const w = (rel, text) => { mkdirSync(join(d, ...rel.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(d, ...rel.split('/')), text); };
  w('packages/web/.claude/skills/deploy/SKILL.md', FM(BLOCK));
  w('packages/web/.claude/agents/a.md', FM(BLOCK));
  w('packages/web/.claude/commands/c.md', FM(BLOCK));
  w('packages/web/.claude/settings.json', JSON.stringify({ hooks: { Stop: [] } }));
  w('packages/web/src/.claude/skills/deeper/SKILL.md', FM(BLOCK));
  w('packages/api/.claude/commands/broken.md', '---\nhooks:\n  Stop: []\n');
  w('node_modules/pkg/.claude/skills/s/SKILL.md', FM(BLOCK));
  w('.git/x/.claude/skills/s/SKILL.md', FM(BLOCK));
  const outside = tmp();
  w('packages/linked/keep.txt', 'x');
  mkdirSync(join(outside, '.claude', 'skills', 's'), { recursive: true });
  writeFileSync(join(outside, '.claude', 'skills', 's', 'SKILL.md'), FM(BLOCK));
  symlinkSync(outside, join(d, 'packages', 'outside'), 'junction');                       // an ordinary link: never followed, kept
  symlinkSync(join(outside, '.claude'), join(d, 'packages', 'linked', '.claude'), 'junction');   // a nested .claude link: removed
  const r = await stripProjectClaudeSettings(d);
  assert.deepEqual(r.changed, ['packages/web/.claude/skills/deploy/SKILL.md', 'packages/web/.claude/agents/a.md', 'packages/web/.claude/commands/c.md',
    'packages/web/src/.claude/skills/deeper/SKILL.md']);
  assert.deepEqual(r.links, ['packages/linked/.claude']);
  assert.deepEqual(r.unparsed, ['packages/api/.claude/commands/broken.md']);
  assert.equal(readFileSync(join(d, 'packages', 'web', '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'), FM(''));
  assert.equal(readFileSync(join(d, 'packages', 'web', '.claude', 'settings.json'), 'utf8'), JSON.stringify({ hooks: { Stop: [] } }),
    'a nested settings file is not one the CLI loads (only the root\'s): left as it is');
  assert.equal(readFileSync(join(d, 'node_modules', 'pkg', '.claude', 'skills', 's', 'SKILL.md'), 'utf8'), FM(BLOCK), 'node_modules is skipped');
  assert.equal(readFileSync(join(d, '.git', 'x', '.claude', 'skills', 's', 'SKILL.md'), 'utf8'), FM(BLOCK), '.git is skipped');
  assert.equal(readFileSync(join(outside, '.claude', 'skills', 's', 'SKILL.md'), 'utf8'), FM(BLOCK), 'nothing outside the checkout is touched');
  assert.equal(existsSync(join(d, 'packages', 'outside')), true, 'an ordinary link elsewhere in the checkout stays');
  assert.equal(existsSync(join(d, 'packages', 'linked', '.claude')), false);
});

test('m13: a folder too deep to walk is named as not checked, never passed over silently', async () => {
  const d = tmp();
  const deep = ['.claude', 'skills', ...Array.from({ length: 40 }, (_, i) => `d${i}`)];
  mkdirSync(join(d, ...deep), { recursive: true });
  writeFileSync(join(d, ...deep, 'SKILL.md'), FM(BLOCK));
  const r = await stripProjectClaudeSettings(d);
  assert.equal(r.unparsed.length, 1);
  assert.match(r.unparsed[0], /^\.claude\/skills\/d0\/d1\//);
});

test('D72a: in a checkout: skills\' SKILL.md, agents and commands lose their frontmatter hooks; links go, never followed; unsafe ones are named', async () => {
  const d = tmp();
  const w = (rel, text) => { mkdirSync(join(d, ...rel.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(d, ...rel.split('/')), text); };
  w('.claude/skills/deploy/SKILL.md', FM(BLOCK));
  w('.claude/skills/deploy/notes.md', FM(BLOCK));
  w('.claude/skills/plain/SKILL.md', FM(''));
  w('.claude/agents/team/reviewer.md', FM('hooks: {}\n'));
  w('.claude/commands/ship.md', FM(BLOCK));
  w('.claude/commands/broken.md', '---\nhooks:\n  Stop: []\n');
  const outside = tmp();
  mkdirSync(join(outside, 'evil'));
  writeFileSync(join(outside, 'evil', 'SKILL.md'), FM(BLOCK));
  symlinkSync(join(outside, 'evil'), join(d, '.claude', 'skills', 'evil'), 'junction');
  const r = await stripProjectClaudeSettings(d);
  assert.deepEqual(r, { changed: ['.claude/skills/deploy/SKILL.md', '.claude/agents/team/reviewer.md', '.claude/commands/ship.md'],
    links: ['.claude/skills/evil'], unparsed: ['.claude/commands/broken.md'] });
  assert.equal(readFileSync(join(d, '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'), FM(''));
  assert.equal(readFileSync(join(d, '.claude', 'skills', 'deploy', 'notes.md'), 'utf8'), FM(BLOCK), 'not a SKILL.md: not read by the CLI as a skill');
  assert.equal(readFileSync(join(d, '.claude', 'commands', 'broken.md'), 'utf8'), '---\nhooks:\n  Stop: []\n');
  assert.equal(existsSync(join(d, '.claude', 'skills', 'evil')), false);
  assert.equal(readFileSync(join(outside, 'evil', 'SKILL.md'), 'utf8'), FM(BLOCK), 'the link target is untouched');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: [], unparsed: ['.claude/commands/broken.md'] }, 'a second pass');
});

test('D72a: the harness names an unsafe frontmatter in one run warning and keeps the changed tracked files out of the try', async () => {
  const d = tmp();
  mkdirSync(join(d, '.claude', 'skills', 's'), { recursive: true });
  writeFileSync(join(d, '.claude', 'skills', 's', 'SKILL.md'), FM(BLOCK));
  mkdirSync(join(d, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(d, '.claude', 'agents', 'a.md'), '---\nhooks: [\n');
  const warnings = [];
  const h = { workDirs: new Map([['k', d]]), members: [{ projectKey: 'k' }], pipeline: { dir: tmp() }, _setupStage() {},
    _git: async () => ({ ok: true, stdout: '.claude/skills/s/SKILL.md\0' }), _recordRunWarning: async (t) => { warnings.push(t); } };
  await RunHarness.prototype._pluginsOffInCheckout.call(h);
  assert.deepEqual(h._tryPluginPaths, ['.claude/skills/s/SKILL.md']);
  assert.deepEqual(warnings, ['Worca could not safely remove the hooks from the project\'s .claude/agents/a.md, so any hooks in it may still run in this try.']);
});
