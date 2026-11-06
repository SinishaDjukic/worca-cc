// test/workflow-test-project-claude-settings.test.mjs — workflow tests 3b, Task 3 (D72): the project's own Claude Code hooks and
// plugins switched off in a Pretend try's checkout; links never followed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { strippedSettingsText, strippedFrontmatterText, isTryGuardEnvKey, stripProjectClaudeSettings, PROJECT_SETTINGS_FILES, STRIPPED_SETTINGS_KEYS,
  _testing as pcsTesting } from '../src/core/workflow-tests/project-claude-settings.mjs';
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

test('concern 3: the loader keys go too: LD_* and DYLD_* would load checkout code into the own node hook of Worca the same way', () => {
  const t = strippedSettingsText(JSON.stringify({ env: { LD_PRELOAD: './x.so', ld_library_path: './lib', LD_AUDIT: './a.so',
    DYLD_INSERT_LIBRARIES: './x.dylib', DYLD_LIBRARY_PATH: './lib', OLD_LD_FLAG: 'kept' } }));
  assert.deepEqual(JSON.parse(t), { env: { OLD_LD_FLAG: 'kept' } });
  for (const k of ['LD_PRELOAD', 'Ld_Library_Path', 'DYLD_INSERT_LIBRARIES', 'dyld_fallback_library_path']) assert.ok(isTryGuardEnvKey(k), k);
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
/** re-review 2: nothing parses (even with the CLI's quoting), it mentions hooks, no hooks line to cut: emptied and named. */
const UNSURE = '---\nname: [x\n  hooks: { Stop: [] }\n---\nbody\n';

test('D72a: the frontmatter loses its top-level hooks key and block; every other byte stays', () => {
  assert.equal(strippedFrontmatterText(FM(BLOCK)).text, FM(''));
  assert.equal(strippedFrontmatterText(FM('hooks: {}\n')).text, FM(''), 'an inline value');
  assert.equal(strippedFrontmatterText(FM('hooks: { PreToolUse: [ { matcher: "Bash" } ] }  # c\n')).text, FM(''));
  assert.equal(strippedFrontmatterText(FM('"hooks":\n  Stop: []\n')).text, FM(''), 'a quoted key');
  assert.equal(strippedFrontmatterText(FM(BLOCK, '')).text, FM('', ''), 'the last key');
  const crlf = `\uFEFF${FM(BLOCK)}`.replace(/\n/g, '\r\n');
  assert.equal(strippedFrontmatterText(crlf).text, `\uFEFF${FM('')}`.replace(/\n/g, '\r\n'), 'BOM and CRLF kept');
  // (`description: hooks: none` unquoted is not strict YAML, but the CLI's quoting fallback reads it: no hooks, nothing to do)
  for (const t of [FM(''), 'no frontmatter\nhooks: x\n', '', FM('', 'description: "hooks: none"\nnested:\n  hooks: kept\n'), FM('', 'description: hooks: none\n'),
    '---\nname: x\nhooks:\n  Stop: []\n', '---\nname: x\ndescription: a --- b\nhooks:\n  Stop: []\n---\nbody\n']) {
    // (the last two: the CLI reads no frontmatter without a second `---`, and its frontmatter ends at the first `---`, even mid-line)
    assert.equal(strippedFrontmatterText(t), null, JSON.stringify(t.slice(0, 40)));
  }
});

test('re-review 2: what the line strip cannot cut is rewritten from its YAML reading: the same values, no hooks, the body byte for byte', () => {
  const NAMED = FM('');
  for (const [t, want, why] of [[FM('hooks: { PreToolUse: [\n  { matcher: "Bash" } ] }\n'), NAMED, 'a flow value over lines'],
    [FM('hooks:\n\tStop: []\n'), NAMED, 'a tab (line strip: the CLI turns leading tabs into spaces)'], [FM('hooks: {}\nhooks: {}\n'), NAMED, 'two hooks keys (both cut)'],
    [FM('hooks: &h\n  Stop: []\n', 'other: *h\n'), FM('', 'other:\n  Stop: []\n'), 'an anchor used elsewhere'], [FM('hooks: "a\n  b"\n'), NAMED, 'a quoted value over lines']]) {
    assert.deepEqual(strippedFrontmatterText(t), { text: want }, why);
  }
});

test('review m4 (kept safe in re-review 2): YAML forms that still carry a top-level hooks key lose it; one that parses without it is fine', () => {
  for (const [t, want, why] of [
    ['---\n  name: x\n  hooks:\n    Stop: []\n---\nbody\n', '---\nname: x\n---\nbody\n', 'an indented root mapping'],
    ['---\nname: x\n? hooks\n: { Stop: [] }\n---\nbody\n', '---\nname: x\n---\nbody\n', 'an explicit ? key'],
    ['---\nname: x\nbase: &b\n  hooks:\n    Stop: []\n<<: *b\n---\nbody\n', '---\nname: x\nbase:\n  hooks:\n    Stop: []\n---\nbody\n', 'a merge key bringing hooks'],
    ['---\n{ name: x, hooks: { Stop: [] } }\n---\nbody\n', '---\nname: x\n---\nbody\n', 'a flow-style frontmatter'],
    ['---\n"ho\u006fks": { Stop: [] }\nname: x\n---\nbody\n', '---\nname: x\n---\nbody\n', 'an escaped key'],
    [FM(BLOCK, 'base: &b\n  hooks:\n    Stop: []\n<<: *b\n'), FM('', 'base:\n  hooks:\n    Stop: []\n').replace('description: d\n', ''), 'a merge key bringing hooks back after the line strip'],
  ]) assert.deepEqual(strippedFrontmatterText(t), { text: want }, why);
  // nothing parses, even with the CLI's quoting (so the CLI reads it as empty), mentioning hooks, and no hooks line to cut:
  // the frontmatter goes (the CLI reads it as empty anyway), named
  assert.deepEqual(strippedFrontmatterText('---\nname: [x\n  hooks: { Stop: [] }\n---\nbody\n'), { text: '---\n---\nbody\n', unsafe: true });
  assert.equal(strippedFrontmatterText('---\nname: x\nbase: &b\n  model: y\n<<: *b\n---\nbody\n'), null, 'a merge key with no hooks: nothing to do');
  assert.equal(strippedFrontmatterText('---\nname: [x\n---\nbody\n'), null, 'YAML that does not parse and never says hooks: nothing to do');
});

test('re-review 2 N-I1: a value that is not strict YAML but mentions hooks (the CLI quotes it and still loads the hooks block) never keeps the hooks', () => {
  // Claude Code 2.1.318 (pMn): Bun.YAML.parse, else every `key: value` line whose value has `: ` (or one of {}[]*&#!|>%@`) is
  // quoted, leading tabs become spaces, and it parses again: this skill loads, with its hooks.
  const lenient = 'description: Git hooks: set up pre-commit\n';
  assert.deepEqual(strippedFrontmatterText(FM(BLOCK, lenient)), { text: FM('', lenient) }, 'stripped, every other byte kept, nothing to warn about');
  assert.deepEqual(strippedFrontmatterText(FM('hooks:\n\tStop: []\n', lenient)), { text: FM('', lenient) }, 'a tab-indented block (the CLI turns tabs into spaces)');
  // still not YAML after the CLI's quoting, mentioning hooks: the line-stripped text is written anyway, and named
  const broken = 'other:\n  - [broken: hooks\n';
  assert.deepEqual(strippedFrontmatterText(FM(BLOCK, broken)), { text: FM('', broken), unsafe: true });
});

test('re-review 3 m1: a frontmatter that no reading parses stays unreadable: the CLI reads no field of it in a normal run (2.1.318 xd: {} when pMn fails)', () => {
  // the fault is only in the hooks block: the line strip alone would bring name, model and allowed-tools to life in the try
  const fm = '---\nname: a\nmodel: opus\nallowed-tools: Bash\nhooks:\n  - [ {matcher: Bash}\n---\nbody\n';
  assert.deepEqual(strippedFrontmatterText(fm), { text: '---\n---\nbody\n', unsafe: true }, 'an empty frontmatter: no fields, as in a normal run');
  // still unreadable after the line strip: the line-stripped text is kept (unreadable the same way), named
  const broken = 'other:\n  - [broken: hooks\n';
  assert.deepEqual(strippedFrontmatterText(FM(BLOCK, broken)), { text: FM('', broken), unsafe: true });
});

test('I-2: nested .claude folders below the checkout root (a monorepo package\'s skills load once the agent works there: probe nested-read-318) lose their hooks too', async () => {
  const d = tmp();
  const w = (rel, text) => { mkdirSync(join(d, ...rel.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(d, ...rel.split('/')), text); };
  w('packages/web/.claude/skills/deploy/SKILL.md', FM(BLOCK));
  w('packages/web/.claude/agents/a.md', FM(BLOCK));
  w('packages/web/.claude/commands/c.md', FM(BLOCK));
  w('packages/web/.claude/settings.json', JSON.stringify({ hooks: { Stop: [] } }));
  w('packages/web/src/.claude/skills/deeper/SKILL.md', FM(BLOCK));
  w('packages/api/.claude/commands/broken.md', UNSURE);
  w('node_modules/pkg/.claude/skills/s/SKILL.md', FM(BLOCK));
  w('.git/x/.claude/skills/s/SKILL.md', FM(BLOCK));
  const outside = tmp();
  w('packages/linked/keep.txt', 'x');
  mkdirSync(join(outside, '.claude', 'skills', 's'), { recursive: true });
  writeFileSync(join(outside, '.claude', 'skills', 's', 'SKILL.md'), FM(BLOCK));
  symlinkSync(outside, join(d, 'packages', 'outside'), 'junction');                       // an ordinary link: never followed, kept
  symlinkSync(join(outside, '.claude'), join(d, 'packages', 'linked', '.claude'), 'junction');   // a nested .claude link: removed
  const r = await stripProjectClaudeSettings(d);
  assert.deepEqual(r.changed, ['packages/api/.claude/commands/broken.md', 'packages/web/.claude/skills/deploy/SKILL.md', 'packages/web/.claude/agents/a.md', 'packages/web/.claude/commands/c.md',
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

/** A `git` for stripProjectClaudeSettings, as the harness's _git: { ok, stdout }. */
const gitIn = (cwd) => async (args) => {
  try { return { ok: true, stdout: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, stdout: '', stderr: String(e.stderr || e.message) }; }
};

test('re-review 2 n4: the nested walk skips gitignored folders (the CLI skips a gitignored skills dir too), and node_modules and .git still', async () => {
  const d = tmp();
  const w = (rel, text) => { mkdirSync(join(d, ...rel.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(d, ...rel.split('/')), text); };
  execFileSync('git', ['init', '-q'], { cwd: d });
  w('.gitignore', 'target/\n.venv/\nignored-pkg/.claude/\n');
  w('target/debug/.claude/skills/s/SKILL.md', FM(BLOCK));
  w('.venv/lib/.claude/agents/a.md', FM(BLOCK));
  w('ignored-pkg/.claude/commands/c.md', FM(BLOCK));
  w('packages/new/target/x/.claude/skills/s/SKILL.md', FM(BLOCK));   // an ignored folder inside an untracked one
  w('packages/web/.claude/skills/s/SKILL.md', FM(BLOCK));
  w('node_modules/pkg/.claude/skills/s/SKILL.md', FM(BLOCK));
  w('.claude/skills/root/SKILL.md', FM(BLOCK));
  w('.git/info/.claude/skills/s/SKILL.md', FM(BLOCK));
  const r = await stripProjectClaudeSettings(d, { git: gitIn(d) });
  assert.deepEqual(r.changed, ['.claude/skills/root/SKILL.md', 'packages/web/.claude/skills/s/SKILL.md']);
  for (const p of ['target/debug/.claude/skills/s/SKILL.md', '.venv/lib/.claude/agents/a.md', 'ignored-pkg/.claude/commands/c.md',
    'packages/new/target/x/.claude/skills/s/SKILL.md', 'node_modules/pkg/.claude/skills/s/SKILL.md', '.git/info/.claude/skills/s/SKILL.md']) {
    assert.equal(readFileSync(join(d, ...p.split('/')), 'utf8'), FM(BLOCK), `${p} is not walked`);
  }
  // not a git checkout (or git fails): only node_modules and .git are skipped
  const f = tmp();
  mkdirSync(join(f, 'target', '.claude', 'skills', 's'), { recursive: true });
  writeFileSync(join(f, 'target', '.claude', 'skills', 's', 'SKILL.md'), FM(BLOCK));
  assert.deepEqual((await stripProjectClaudeSettings(f, { git: async () => ({ ok: false, stdout: '' }) })).changed, ['target/.claude/skills/s/SKILL.md']);
});

test('re-review 2 n4: the nested walk visits at most so many folders, and says so when it stops', async () => {
  const d = tmp();
  for (let i = 0; i < 6; i++) mkdirSync(join(d, `p${i}`, 'src'), { recursive: true });
  mkdirSync(join(d, 'z', '.claude', 'skills', 's'), { recursive: true });
  writeFileSync(join(d, 'z', '.claude', 'skills', 's', 'SKILL.md'), FM(BLOCK));
  const capped = await stripProjectClaudeSettings(d, { walkDirsMax: 5 });
  assert.equal(capped.walkCapped, 5);
  assert.deepEqual(capped.changed, []);
  const all = await stripProjectClaudeSettings(d);
  assert.equal('walkCapped' in all, false);
  assert.deepEqual(all.changed, ['z/.claude/skills/s/SKILL.md']);
});

test('re-review 2 n4, n5: the harness passes its git, logs a capped walk, and names the env keys it left out (names only)', async () => {
  const d = tmp();
  mkdirSync(join(d, '.claude'), { recursive: true });
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ env: { NODE_OPTIONS: '--max-old-space-size=8192', LD_LIBRARY_PATH: '/opt/cuda/lib64', KEEP: '1' } }));
  writeFileSync(join(d, '.claude', 'settings.local.json'), JSON.stringify({ env: { GH_CONFIG_DIR: '/x' } }));
  const logs = [];
  const gitCalls = [];
  const h = { workDirs: new Map([['k', d]]), members: [{ projectKey: 'k' }], pipeline: { dir: tmp() }, _setupStage() {},
    _git: async (args, o) => { gitCalls.push([args, o && o.cwd]); return { ok: true, stdout: '' }; }, _recordRunWarning: async () => {},
    _log: (source, level, text) => logs.push({ source, level, text }) };
  await RunHarness.prototype._pluginsOffInCheckout.call(h);
  assert.ok(gitCalls.some(([a, cwd]) => a.includes('--ignored') && cwd === d), 'the ignored folders are listed with the harness\'s git, in the checkout');
  const envLine = logs.find((l) => /env/.test(l.text));
  assert.equal(envLine.text, 'Left the project\'s own settings env keys out of this try (they could undo Worca\'s guards): '
    + '.claude/settings.json: NODE_OPTIONS, LD_LIBRARY_PATH; .claude/settings.local.json: GH_CONFIG_DIR.');
  assert.doesNotMatch(JSON.stringify(logs), /cuda|8192|\/x"/, 'never a value');
  assert.equal(logs.some((l) => /folders/.test(l.text)), false, 'no cap line when the walk was not capped');
  pcsTesting.walkDirsMax(1);
  try {
    mkdirSync(join(d, 'a', 'b'), { recursive: true });
    logs.length = 0;
    await RunHarness.prototype._pluginsOffInCheckout.call(h);
  } finally { pcsTesting.reset(); }
  assert.deepEqual(logs.filter((l) => /folders/.test(l.text)).map((l) => [l.source, l.level, l.text]), [['worktree', 'warn',
    'Worca stopped looking for the project\'s nested .claude folders after 1 folders; a skill, agent or command deeper in the checkout may keep its hooks in this try.']]);
});

test('D72a: in a checkout: skills\' SKILL.md, agents and commands lose their frontmatter hooks; links go, never followed; unsafe ones are named', async () => {
  const d = tmp();
  const w = (rel, text) => { mkdirSync(join(d, ...rel.split('/').slice(0, -1)), { recursive: true }); writeFileSync(join(d, ...rel.split('/')), text); };
  w('.claude/skills/deploy/SKILL.md', FM(BLOCK));
  w('.claude/skills/deploy/notes.md', FM(BLOCK));
  w('.claude/skills/plain/SKILL.md', FM(''));
  w('.claude/agents/team/reviewer.md', FM('hooks: {}\n'));
  w('.claude/commands/ship.md', FM(BLOCK));
  w('.claude/commands/broken.md', UNSURE);
  w('.claude/commands/unclosed.md', '---\nhooks:\n  Stop: []\n');   // no second ---: the CLI reads no frontmatter
  const outside = tmp();
  mkdirSync(join(outside, 'evil'));
  writeFileSync(join(outside, 'evil', 'SKILL.md'), FM(BLOCK));
  symlinkSync(join(outside, 'evil'), join(d, '.claude', 'skills', 'evil'), 'junction');
  const r = await stripProjectClaudeSettings(d);
  assert.deepEqual(r, { changed: ['.claude/skills/deploy/SKILL.md', '.claude/agents/team/reviewer.md', '.claude/commands/broken.md', '.claude/commands/ship.md'],
    links: ['.claude/skills/evil'], unparsed: ['.claude/commands/broken.md'] });
  assert.equal(readFileSync(join(d, '.claude', 'skills', 'deploy', 'SKILL.md'), 'utf8'), FM(''));
  assert.equal(readFileSync(join(d, '.claude', 'skills', 'deploy', 'notes.md'), 'utf8'), FM(BLOCK), 'not a SKILL.md: not read by the CLI as a skill');
  assert.equal(readFileSync(join(d, '.claude', 'commands', 'broken.md'), 'utf8'), '---\n---\nbody\n', 're-review 2 N-I1: written as far as Worca could strip it, and named');
  assert.equal(readFileSync(join(d, '.claude', 'commands', 'unclosed.md'), 'utf8'), '---\nhooks:\n  Stop: []\n');
  assert.equal(existsSync(join(d, '.claude', 'skills', 'evil')), false);
  assert.equal(readFileSync(join(outside, 'evil', 'SKILL.md'), 'utf8'), FM(BLOCK), 'the link target is untouched');
  assert.deepEqual(await stripProjectClaudeSettings(d), { changed: [], links: [] }, 'a second pass: nothing left to do');
});

test('D72a: the harness names an unsafe frontmatter in one run warning and keeps the changed tracked files out of the try', async () => {
  const d = tmp();
  mkdirSync(join(d, '.claude', 'skills', 's'), { recursive: true });
  writeFileSync(join(d, '.claude', 'skills', 's', 'SKILL.md'), FM(BLOCK));
  mkdirSync(join(d, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(d, '.claude', 'agents', 'a.md'), UNSURE);
  const warnings = [];
  const h = { workDirs: new Map([['k', d]]), members: [{ projectKey: 'k' }], pipeline: { dir: tmp() }, _setupStage() {},
    _git: async () => ({ ok: true, stdout: '.claude/skills/s/SKILL.md\0' }), _recordRunWarning: async (t) => { warnings.push(t); } };
  await RunHarness.prototype._pluginsOffInCheckout.call(h);
  assert.deepEqual(h._tryPluginPaths, ['.claude/skills/s/SKILL.md']);
  assert.deepEqual(warnings, ['Worca could not be sure it removed every hook from the project\'s .claude/agents/a.md, so a hook in it may still run in this try.']);
  assert.equal(readFileSync(join(d, '.claude', 'agents', 'a.md'), 'utf8'), '---\n---\nbody\n', 'written as far as Worca could strip it');
});
