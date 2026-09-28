// test/script-registry.test.mjs
// Layered script registry (spec §8.1): built-in scripts/ + user ~/.worca-cc/scripts
// + enabled plugins' current/scripts, builtin > user > plugin, and D16: a key an
// agent holds is dropped with a warning (agents win, deterministic).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadScriptRegistry, userScriptsDir, pluginScriptLayers, DEFAULT_SCRIPTS_DIR } from '../src/core/script-registry.mjs';
import { readPluginsLock, writePluginsLock, pluginDir, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

function writeScript(dir, key, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.mjs`), 'export default async function () { return { summary: "ok" }; }\n');
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, metaVersion: 2, displayName: key, runtime: 'node', file: `${key}.mjs`, order: 50,
    inputs: [], outputs: [{ id: 'out', type: 'md', filename: `${key}-cycle{cycle}.md` }], ...extra,
  }, null, 2));
}
const quiet = (fn) => { const warned = []; const orig = console.warn; console.warn = (...a) => warned.push(a.join(' ')); try { return [fn(), warned]; } finally { console.warn = orig; } };

test('three layers merge, sorted by order, with origin and host-platform paths stamped', () => {
  const builtin = tmp('worca-sreg-b-');
  const user = tmp('worca-sreg-u-');
  writeScript(builtin, 'alpha', { order: 1, command: undefined });
  writeScript(user, 'beta', { order: 2, runtime: 'shell', file: undefined, command: { default: 'npm test', win32: 'npm.cmd test' } });
  const reg = loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: user, includePlugins: false, agentKeys: null, platform: 'linux' });
  assert.deepEqual(Object.keys(reg), ['alpha', 'beta']);
  assert.equal(reg.alpha.origin, 'builtin');
  assert.equal(reg.alpha.scriptPath, join(builtin, 'alpha.mjs'));
  assert.equal(reg.alpha.scriptsDir, builtin);
  assert.equal(reg.alpha.commandResolved, null);
  assert.equal(reg.beta.origin, 'user');
  assert.equal(reg.beta.scriptPath, null);
  assert.equal(reg.beta.commandResolved, 'npm test');
  assert.equal(loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: user, includePlugins: false, agentKeys: null, platform: 'win32' }).beta.commandResolved, 'npm.cmd test');
  assert.equal(userScriptsDir(), join(worcaHome(), 'scripts'));
  assert.match(DEFAULT_SCRIPTS_DIR, /scripts[\\/]$/, 'the built-in layer is the repo scripts/ dir (fileURLToPath, never .pathname)');
});

test('a user key shadowing a built-in is skipped; an invalid sidecar is skipped with the normalizer reason', () => {
  const builtin = tmp('worca-sreg-b-');
  const user = tmp('worca-sreg-u-');
  writeScript(builtin, 'alpha', { order: 1, displayName: 'Builtin Alpha' });
  writeScript(user, 'alpha', { order: 1, displayName: 'SHADOW' });
  writeScript(user, 'broken', { runtime: 'ruby' });
  const drops = [];
  const [reg, warned] = quiet(() => loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: user, includePlugins: false, agentKeys: null, onDrop: (d) => drops.push(d) }));
  assert.equal(reg.alpha.displayName, 'Builtin Alpha');
  assert.equal('broken' in reg, false);
  assert.ok(warned.some((w) => /\[script-registry\] user script "alpha" shadows a built-in/.test(w)), warned.join('\n'));
  assert.ok(warned.some((w) => /sidecar "broken" is invalid; skipped: runtime must be one of node, shell, python/.test(w)));
  assert.ok(drops.some((d) => d.origin === 'user' && d.file === 'alpha.meta.json' && /shadows/.test(d.reason)));
  assert.ok(drops.some((d) => d.origin === 'user' && d.file === 'broken.meta.json' && /runtime must be one of/.test(d.reason)));
});

test('D16: a script whose key an agent holds is skipped with a warning; agentKeys may be a Set, an array, or null (no check)', () => {
  const builtin = tmp('worca-sreg-b-');
  writeScript(builtin, 'reviewer', { order: 1 });
  writeScript(builtin, 'echo', { order: 2 });
  const [reg, warned] = quiet(() => loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: null, includePlugins: false, agentKeys: new Set(['reviewer']) }));
  assert.deepEqual(Object.keys(reg), ['echo']);
  assert.ok(warned.some((w) => w === '[script-registry] "reviewer" collides with an agent key; skipped'), warned.join('\n'));
  assert.deepEqual(Object.keys(loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: null, includePlugins: false, agentKeys: ['echo'] })), ['reviewer']);
  assert.deepEqual(Object.keys(loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: null, includePlugins: false, agentKeys: null })), ['reviewer', 'echo']);
  // Default: the live agent registry — the built-in `reviewer` agent wins the key.
  const [live] = quiet(() => loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: null, includePlugins: false }));
  assert.deepEqual(Object.keys(live), ['echo']);
});

/** Lay a plugin out the way plugin-store does (mirrors test/plugin-agent-registry.test.mjs). */
function installFakePlugin(name, scripts, { enabled = true } = {}) {
  const versionDir = join(pluginDir(name), 'versions', 'abc1234');
  const dir = join(versionDir, 'scripts');
  for (const [key, extra] of scripts) writeScript(dir, key, extra);
  symlinkSync(versionDir, join(pluginDir(name), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({ ...readPluginsLock(), [name]: { repo: 'https://example.com/p.git', subdir: name, pinnedSha: 'a'.repeat(40), version: '0.1.0', enabled, installedAt: '2026-07-12T00:00:00.000Z' } });
}

test('plugin layer: enabled plugins in name order, origin plugin:<name>, paths through current/, disabled plugins skipped, collisions skipped', () => {
  const builtin = tmp('worca-sreg-b-');
  writeScript(builtin, 'alpha', { order: 1 });
  installFakePlugin('zeta-tools', [['shared', { order: 5, displayName: 'from zeta' }], ['zOnly', { order: 6 }]]);
  installFakePlugin('beta-tools', [['shared', { order: 5, displayName: 'from beta' }], ['alpha', { order: 1 }]]);
  installFakePlugin('off-tools', [['offOnly', { order: 7 }]], { enabled: false });
  assert.deepEqual(pluginScriptLayers().map((l) => l.plugin), ['beta-tools', 'zeta-tools']);
  const [reg, warned] = quiet(() => loadScriptRegistry({ scriptsDir: builtin, userScriptsDir: null, agentKeys: null }));
  assert.deepEqual(Object.keys(reg).sort(), ['alpha', 'shared', 'zOnly']);
  assert.equal(reg.alpha.origin, 'builtin');
  assert.equal(reg.shared.displayName, 'from beta');
  assert.equal(reg.shared.origin, 'plugin:beta-tools');
  assert.equal(reg.shared.scriptPath, join(pluginCurrentDir('beta-tools'), 'scripts', 'shared.mjs'));
  assert.ok(warned.some((w) => /plugin script "shared" \(plugin "zeta-tools"\) collides/.test(w)));
  assert.ok(warned.some((w) => /plugin script "alpha" \(plugin "beta-tools"\) collides/.test(w)));
});
