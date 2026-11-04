// test/workflow-test-project-claude-settings.test.mjs — workflow tests 3b, Task 3 (D72): the project's own Claude Code hooks and
// plugins switched off in a Pretend try's checkout; links never followed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strippedSettingsText, stripProjectClaudeSettings, PROJECT_SETTINGS_FILES, STRIPPED_SETTINGS_KEYS }
  from '../src/core/workflow-tests/project-claude-settings.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-cc-pcs-')); dirs.push(d); return d; };
const canLinkFiles = (() => { try { const d = tmp(); writeFileSync(join(d, 't'), 'x'); symlinkSync(join(d, 't'), join(d, 'l')); return true; } catch { return false; } })();
const FILE_LINKS = { skip: canLinkFiles ? false : 'this machine cannot make file symlinks (EPERM on Windows without developer mode)' };

test('the text: hooks and enabledPlugins go, everything else stays; nothing to do is null', () => {
  assert.deepEqual(STRIPPED_SETTINGS_KEYS, ['hooks', 'enabledPlugins']);
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
  try { await assert.rejects(stripProjectClaudeSettings(d), /EACCES|EPERM/); } finally { chmodSync(join(d, '.claude', 'settings.json'), 0o644); }
});
