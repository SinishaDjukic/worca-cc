// test/plugin-agent-registry.test.mjs
// Registry layer 3 (spec §9.1): enabled plugins' current/agents merge AFTER
// builtin+user; collisions skip-with-warning; among plugins lexicographic
// plugin-name order wins. Mirrors test/agent-registry-layered.test.mjs.
// NOTE: one module-level temp home for the whole file — every test uses UNIQUE
// plugin/agent names so earlier installs never leak into later assertions.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry, pluginAgentLayers } from '../src/core/agent-registry.mjs';
import { readPluginsLock, writePluginsLock, pluginDir, pluginCurrentDir } from '../src/core/plugins-lock.mjs';

useTempHome(after);

const scratch = [];
function tmp(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

function writeAgent(dir, key, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.md`), `# ${key}\n\nYou are the ${key} agent.\n`);
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    metaVersion: 2,
    key, displayName: key, description: 'd', color: 'amber', icon: '<path d="M0 0"/>',
    agentFile: `${key}.md`, runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }],
    outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
    order: 99, ...extra,
  }, null, 2));
}

/** Lay a plugin out the way plugin-store does: versions/<sha7>/agents + a REAL
 *  current -> versions/<sha7> symlink + a lock entry. agents = [[key, extra]]. */
function installFakePlugin(name, agents, { enabled = true, broken = false } = {}) {
  const versionDir = join(pluginDir(name), 'versions', 'abc1234');
  const agentsDir = join(versionDir, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  for (const [key, extra] of agents) writeAgent(agentsDir, key, extra);
  // 'junction' on Windows (a plain/dir symlink needs elevated privileges there);
  // versionDir is absolute, as junctions require. Mirrors plugin-store's swap.
  if (!broken) symlinkSync(versionDir, join(pluginDir(name), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({
    ...readPluginsLock(),
    [name]: {
      repo: 'https://example.com/plugins.git', subdir: name,
      pinnedSha: 'a'.repeat(40), version: '0.1.0', enabled,
      installedAt: '2026-07-12T00:00:00.000Z',
    },
  });
  return versionDir; // callers that write extra files (a manifest, a v1 sidecar) need it
}

test('a plugin agent joins the registry with origin plugin:<name> and agentPath through current/', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha', { order: 1 });
  installFakePlugin('demo-source', [['demoAgent', { order: 40 }]]);
  const layers = pluginAgentLayers().filter((l) => l.plugin === 'demo-source');
  assert.deepEqual(layers, [{ plugin: 'demo-source', dir: join(pluginCurrentDir('demo-source'), 'agents'), builtFor: null }]);
  const reg = loadAgentRegistry(builtin, { userAgentsDir: null });
  assert.equal(reg.demoAgent.origin, 'plugin:demo-source');
  assert.equal(reg.demoAgent.agentPath, join(pluginCurrentDir('demo-source'), 'agents', 'demoAgent.md'),
    'agentPath resolves THROUGH the current/ symlink, never a versions/ path');
});

test('a plugin key colliding with a built-in is SKIPPED with a warning (builtin > plugin)', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'sharedKey', { order: 1, displayName: 'Builtin Wins' });
  installFakePlugin('collider-a', [['sharedKey', { displayName: 'EVIL SHADOW' }]]);
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const reg = loadAgentRegistry(builtin, { userAgentsDir: null });
    assert.equal(reg.sharedKey.displayName, 'Builtin Wins');
    assert.equal(reg.sharedKey.origin, 'builtin');
    assert.ok(warned.some((w) => /sharedKey/.test(w) && /collider-a/.test(w) && /skip/i.test(w)), warned.join('; '));
  } finally { console.warn = orig; }
});

test('a plugin key colliding with a user agent is skipped (user > plugin)', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  const user = tmp('worca-cc-puser-');
  writeAgent(builtin, 'alpha2', { order: 1 });
  writeAgent(user, 'userKey', { order: 2, displayName: 'User Wins' });
  installFakePlugin('collider-b', [['userKey', { displayName: 'plugin copy' }]]);
  const reg = loadAgentRegistry(builtin, { userAgentsDir: user });
  assert.equal(reg.userKey.displayName, 'User Wins');
  assert.equal(reg.userKey.origin, 'user');
});

test('two plugins shipping the same key: lexicographically FIRST plugin name wins', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha3', { order: 1 });
  installFakePlugin('bbb-plugin', [['duped', { displayName: 'From BBB' }]]); // installed first…
  installFakePlugin('aaa-plugin', [['duped', { displayName: 'From AAA' }]]); // …but aaa sorts first
  const reg = loadAgentRegistry(builtin, { userAgentsDir: null });
  assert.equal(reg.duped.origin, 'plugin:aaa-plugin', 'lock-insertion order is irrelevant; name order decides');
  assert.equal(reg.duped.displayName, 'From AAA');
});

test('a disabled plugin contributes no agents (and no layer)', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha4', { order: 1 });
  installFakePlugin('sleepy', [['sleepyAgent', {}]], { enabled: false });
  assert.equal(loadAgentRegistry(builtin, { userAgentsDir: null }).sleepyAgent, undefined);
  assert.ok(!pluginAgentLayers().some((l) => l.plugin === 'sleepy'));
});

test('a broken plugin (no current/ symlink) is silently ignored, never fatal', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha5', { order: 1 });
  installFakePlugin('broken-one', [['brokenAgent', {}]], { broken: true });
  const reg = loadAgentRegistry(builtin, { userAgentsDir: null });
  assert.equal(reg.brokenAgent, undefined);
  assert.ok(reg.alpha5, 'the rest of the registry loads normally');
});

test('opts.includePlugins:false is the escape hatch that hides every plugin agent', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha6', { order: 1 });
  installFakePlugin('esc-hatch', [['escAgent', {}]]);
  assert.equal(loadAgentRegistry(builtin, { userAgentsDir: null, includePlugins: false }).escAgent, undefined);
  assert.ok(loadAgentRegistry(builtin, { userAgentsDir: null }).escAgent, 'default (true) includes plugins');
});

test('agent-store refuses Update/Delete on plugin-origin agents (code PLUGIN)', async () => {
  installFakePlugin('guarded', [['guardedAgent', {}]]);
  const { updateAgent, deleteAgent } = await import('../src/core/agent-store.mjs');
  await assert.rejects(async () => updateAgent('guardedAgent', { description: 'x' }),
    (e) => e.code === 'PLUGIN' && /plugin "guarded"/.test(e.message));
  await assert.rejects(async () => deleteAgent('guardedAgent'),
    (e) => e.code === 'PLUGIN');
});

test('a plugin sidecar that is not meta v2 is ignored, with a line naming the API', () => {
  const versionDir = installFakePlugin('legacy-source', []);
  writeFileSync(join(versionDir, 'worca-cc-plugin.json'),
    JSON.stringify({ name: 'legacy-source', engines: { 'worca-cc-api': '>=2 <3' } }));
  const agentsDir = join(versionDir, 'agents');
  writeFileSync(join(agentsDir, 'oldHelper.md'), '# oldHelper\n');
  writeFileSync(join(agentsDir, 'oldHelper.meta.json'), JSON.stringify({
    key: 'oldHelper', displayName: 'Old Helper', agentFile: 'oldHelper.md',
    runnerType: 'producer', consumes: ['userPrompt'], produces: ['plan'], order: 900,
  }));
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha', { order: 1 });
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    const reg = loadAgentRegistry(builtin, { userAgentsDir: null });
    assert.equal(reg.oldHelper, undefined, 'the v1 plugin sidecar never reaches the registry');
    assert.ok(reg.alpha, 'the builtin layer is unaffected');
  } finally { console.warn = realWarn; }
  assert.ok(warnings.some((m) => m.includes('plugin:legacy-source/oldHelper.meta.json')
    && m.includes('built for plugin API 2')
    && m.includes('metaVersion') && m.endsWith('ignored')), warnings.join('\n'));

  // A parseable manifest with NO `engines` accepts everything, so declaredApi
  // answers 0 — report that as "an older plugin API", never "plugin API 0".
  writeFileSync(join(versionDir, 'worca-cc-plugin.json'), JSON.stringify({ name: 'legacy-source' }));
  warnings.length = 0;
  console.warn = (m) => warnings.push(String(m));
  try { loadAgentRegistry(builtin, { userAgentsDir: null }); } finally { console.warn = realWarn; }
  assert.ok(warnings.some((m) => m.includes('built for an older plugin API')), warnings.join('\n'));
});

// NOTE: this one is GREEN before the implementation — nothing gates user
// sidecars today. It is a REGRESSION GUARD on the scope rule (plugin layers
// only), not a red-to-green test. Keep it; do not "fix" it into failing.
test('the v2 gate is PLUGIN-only: a v1 USER sidecar still loads (v1 engine is live)', () => {
  const builtin = tmp('worca-cc-pbuiltin-');
  writeAgent(builtin, 'alpha', { order: 1 });
  const userDir = tmp('worca-cc-userlayer-');
  mkdirSync(userDir, { recursive: true });
  writeFileSync(join(userDir, 'oldUser.md'), '# oldUser\n');
  writeFileSync(join(userDir, 'oldUser.meta.json'), JSON.stringify({
    key: 'oldUser', displayName: 'Old User', agentFile: 'oldUser.md',
    runnerType: 'producer', consumes: ['plan'], produces: ['review'], order: 98,
  }));
  const reg = loadAgentRegistry(builtin, { userAgentsDir: userDir, includePlugins: false });
  assert.ok(reg.oldUser, 'a v1 user sidecar is untouched by the plugin API gate');
  assert.equal(reg.oldUser.metaVersion, undefined);
});
