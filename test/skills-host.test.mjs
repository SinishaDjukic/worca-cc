// test/skills-host.test.mjs
// Skills registry §4.1 host gates: the managed settings path per platform, `disableSideloadFlags` (managed file +
// drop-ins), the installed Claude Code plugin names a set's generated plugin must not shadow, and the CLI capability
// probe's `pluginDir`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIDELOAD_REFUSAL_RE, managedSettingsPath, skillHostFacts } from '../src/core/skills-registry/host.mjs';
import { checkRows } from './helpers/rows.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'the fake claude is a POSIX shell script' : false };
const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-skills-host-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const put = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };

test('managedSettingsPath: the CLI\'s managed dir per platform; WORCA_CLAUDE_MANAGED_SETTINGS overrides', async () => {
  await checkRows([
    { name: 'macOS', run: () => assert.equal(managedSettingsPath('darwin', {}), '/Library/Application Support/ClaudeCode/managed-settings.json') },
    { name: 'Windows (Program Files, not ProgramData)', run: () => assert.equal(managedSettingsPath('win32', {}), 'C:\\Program Files\\ClaudeCode\\managed-settings.json') },
    { name: 'Linux', run: () => assert.equal(managedSettingsPath('linux', {}), '/etc/claude-code/managed-settings.json') },
    { name: 'any other platform reads /etc/claude-code', run: () => assert.equal(managedSettingsPath('freebsd', {}), '/etc/claude-code/managed-settings.json') },
    { name: 'override', run: () => assert.equal(managedSettingsPath('darwin', { WORCA_CLAUDE_MANAGED_SETTINGS: '/x/m.json' }), '/x/m.json') },
    { name: 'blank override is ignored', run: () => assert.equal(managedSettingsPath('linux', { WORCA_CLAUDE_MANAGED_SETTINGS: '  ' }), '/etc/claude-code/managed-settings.json') },
  ]);
});

test('skillHostFacts.sideloadDisabled: managed file, then drop-ins in name order (later wins); unreadable reads as allowed', async () => {
  const facts = (dir, home = tmp()) => skillHostFacts({ env: { WORCA_CLAUDE_MANAGED_SETTINGS: join(dir, 'managed-settings.json') }, platform: 'linux', home });
  await checkRows([
    { name: 'no managed file → allowed', run: () => assert.equal(facts(tmp()).sideloadDisabled, false) },
    { name: 'managed file true → disabled', run: () => {
      const d = tmp(); put(join(d, 'managed-settings.json'), '{"disableSideloadFlags":true}');
      assert.equal(facts(d).sideloadDisabled, true);
    } },
    { name: 'a truthy non-boolean is not true', run: () => {
      const d = tmp(); put(join(d, 'managed-settings.json'), '{"disableSideloadFlags":"yes"}');
      assert.equal(facts(d).sideloadDisabled, false);
    } },
    { name: 'a drop-in turns it on over the file', run: () => {
      const d = tmp(); put(join(d, 'managed-settings.json'), '{"disableSideloadFlags":false}');
      put(join(d, 'managed-settings.d', '10-org.json'), '{"disableSideloadFlags":true}');
      assert.equal(facts(d).sideloadDisabled, true);
    } },
    { name: 'a later drop-in turns it off again; a drop-in without the key changes nothing', run: () => {
      const d = tmp(); put(join(d, 'managed-settings.d', '10-a.json'), '{"disableSideloadFlags":true}');
      put(join(d, 'managed-settings.d', '20-b.json'), '{"disableSideloadFlags":false}');
      put(join(d, 'managed-settings.d', '30-c.json'), '{"other":1}');
      assert.equal(facts(d).sideloadDisabled, false);
    } },
    { name: 'dot-files and non-.json drop-ins are not read', run: () => {
      const d = tmp(); put(join(d, 'managed-settings.d', '.hidden.json'), '{"disableSideloadFlags":true}');
      put(join(d, 'managed-settings.d', 'notes.txt'), '{"disableSideloadFlags":true}');
      assert.equal(facts(d).sideloadDisabled, false);
    } },
    { name: 'malformed JSON never throws and reads as allowed', run: () => {
      const d = tmp(); put(join(d, 'managed-settings.json'), '{nope');
      put(join(d, 'managed-settings.d', '10.json'), '[true]');
      assert.equal(facts(d).sideloadDisabled, false);
    } },
  ]);
});

test('skillHostFacts.installedPluginNames: enabledPlugins keys before "@", skills-dir plugins, CLAUDE_CONFIG_DIR; never throws', async () => {
  const env = (o = {}) => ({ WORCA_CLAUDE_MANAGED_SETTINGS: join(tmp(), 'none.json'), ...o });
  await checkRows([
    { name: 'every enabledPlugins key (enabled or not), lower-cased, unique, sorted', run: () => {
      const home = tmp();
      put(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: {
        'superpowers@claude-plugins-official': true, 'firebase@claude-plugins-official': false, 'firebase@firebase': true,
        'Billing@acme': true, bare: true } }));
      assert.deepEqual(skillHostFacts({ env: env(), platform: 'linux', home }).installedPluginNames, ['bare', 'billing', 'firebase', 'superpowers']);
    } },
    { name: 'a skills-dir plugin counts by folder and manifest name; a plain personal skill does not', run: () => {
      const home = tmp();
      put(join(home, '.claude', 'skills', 'shop', '.claude-plugin', 'plugin.json'), '{"name":"shop-tools"}');
      put(join(home, '.claude', 'skills', 'graphify', 'SKILL.md'), '---\nname: graphify\n---\n');
      assert.deepEqual(skillHostFacts({ env: env(), platform: 'linux', home }).installedPluginNames, ['shop', 'shop-tools']);
    } },
    { name: 'a skills-dir plugin linked into the skills folder counts too', run: () => {
      if (process.platform === 'win32') return;   // symlinks need privileges on Windows
      const home = tmp(); const real = tmp();
      put(join(real, '.claude-plugin', 'plugin.json'), '{"name":"linked-tools"}');
      mkdirSync(join(home, '.claude', 'skills'), { recursive: true });
      symlinkSync(real, join(home, '.claude', 'skills', 'linked'));
      assert.deepEqual(skillHostFacts({ env: env(), platform: 'linux', home }).installedPluginNames, ['linked', 'linked-tools']);
    } },
    { name: 'CLAUDE_CONFIG_DIR replaces <home>/.claude', run: () => {
      const home = tmp(); const cfg = tmp();
      put(join(home, '.claude', 'settings.json'), '{"enabledPlugins":{"wrong@m":true}}');
      put(join(cfg, 'settings.json'), '{"enabledPlugins":{"right@m":true}}');
      assert.deepEqual(skillHostFacts({ env: env({ CLAUDE_CONFIG_DIR: cfg }), platform: 'linux', home }).installedPluginNames, ['right']);
    } },
    { name: 'no settings, malformed settings, or a non-map enabledPlugins → []', run: () => {
      const a = tmp(); const b = tmp(); const c = tmp();
      put(join(b, '.claude', 'settings.json'), '{oops');
      put(join(c, '.claude', 'settings.json'), '{"enabledPlugins":["billing@x"]}');
      for (const home of [a, b, c]) assert.deepEqual(skillHostFacts({ env: env(), platform: 'linux', home }).installedPluginNames, []);
    } },
  ]);
});

test('SIDELOAD_REFUSAL_RE: the CLI\'s refusals of --plugin-dir, never an unrelated failure', async () => {
  const yes = [
    "--plugin-dir is disabled by your organization's managed settings (disableSideloadFlags). Plugins, custom agents, and MCP servers can only be loaded from sources your administrator has approved.",
    "--agents, --plugin-dir are disabled by your organization's managed settings (disableSideloadFlags).",
    "The session process exited with code 1. This machine's managed settings (disableSideloadFlags) refused the launch.",
    "error: unknown option '--plugin-dir'",
  ];
  const no = ['Not logged in · Please run /login', 'Invalid --agents configuration', 'spawn claude ENOENT', 'API Error: 529 overloaded',
    // a path that merely holds the words: a run titled "…sideload…", a checkout named vite-plugin-dir-tree
    "claude exited with code 1: EACCES: permission denied, open '/w/store/p/pipelines/07-10-26-support-apk-sideload-ab12cd34/skills/billing/.claude-plugin/plugin.json'",
    "claude exited with code 1: ENOENT: no such file or directory, scandir '/home/u/code/vite-plugin-dir-tree/.claude'"];
  await checkRows([
    ...yes.map((text) => ({ name: `matches: ${text.slice(0, 40)}`, run: () => assert.ok(SIDELOAD_REFUSAL_RE.test(text)) })),
    ...no.map((text) => ({ name: `ignores: ${text}`, run: () => assert.ok(!SIDELOAD_REFUSAL_RE.test(text)) })),
  ]);
});

// ── the CLI capability probe (skills registry §4.1): pluginDir ──────────────────────────────────────
import { probeClaudeCapabilities } from '../src/core/preflight.mjs';

test('probeClaudeCapabilities: pluginDir is whether --help advertises --plugin-dir', POSIX_SHIM, async () => {
  const fake = (help) => {
    const bin = join(tmp(), 'claude');
    writeFileSync(bin, `#!/bin/sh\ncase "$1" in\n  --version) echo "2.1.291 (Claude Code)";;\n  --help) printf '%s\\n' ${JSON.stringify(help)};;\nesac\nexit 0\n`);
    chmodSync(bin, 0o755);
    return bin;
  };
  const withFlag = await probeClaudeCapabilities(fake('  --mcp-config <configs...>\n  --plugin-dir <path>  Load a plugin'));
  const without = await probeClaudeCapabilities(fake('  --mcp-config <configs...>'));
  assert.deepEqual(withFlag, { mcpConfig: true, pluginDir: true, version: '2.1.291', forwardSubagentText: false, agentsFile: true });
  assert.deepEqual(without, { mcpConfig: true, pluginDir: false, version: '2.1.291', forwardSubagentText: false, agentsFile: true });
});
