// test/agent-registry-layered.test.mjs
// Layered registry: built-ins (repo agents/) + user agents (<worcaHome()>/agents).
// Built-ins are immutable: a user key colliding with a built-in is skipped + warned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { loadAgentRegistry, userAgentsDir } from '../src/core/agent-registry.mjs';
import { worcaHome } from '../src/core/projects.mjs';

useTempHome(after);

const scratch = [];
function tmp(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

function writeAgent(dir, key, extra = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.md`), `# ${key}\n\nYou are the ${key} agent.\n`);
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, displayName: key, description: 'd', color: 'amber', icon: '<path d="M0 0"/>',
    agentFile: `${key}.md`, runnerType: 'producer', loopSource: false,
    produces: ['plan'], consumes: ['userPrompt'], optionalConsumes: [], connectsTo: '*',
    order: 99, ...extra,
  }, null, 2));
}

test('user agents merge into the registry with computed origin + layer-correct agentPath', () => {
  const builtin = tmp('worca-cc-builtin-');
  const user = tmp('worca-cc-user-');
  writeAgent(builtin, 'alpha', { order: 1 });
  writeAgent(user, 'beta', { order: 2 });
  const reg = loadAgentRegistry(builtin, { userAgentsDir: user });
  assert.deepEqual(Object.keys(reg), ['alpha', 'beta']);
  assert.equal(reg.alpha.origin, 'builtin');
  assert.equal(reg.beta.origin, 'user');
  assert.equal(reg.alpha.agentPath, join(builtin, 'alpha.md'));
  assert.equal(reg.beta.agentPath, join(user, 'beta.md'));
});

test('a user key colliding with a built-in is SKIPPED with a warning (built-ins immutable)', () => {
  const builtin = tmp('worca-cc-builtin-');
  const user = tmp('worca-cc-user-');
  writeAgent(builtin, 'alpha', { order: 1, displayName: 'Builtin Alpha' });
  writeAgent(user, 'alpha', { order: 1, displayName: 'EVIL SHADOW' });
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const reg = loadAgentRegistry(builtin, { userAgentsDir: user });
    assert.equal(reg.alpha.displayName, 'Builtin Alpha', 'built-in wins');
    assert.equal(reg.alpha.origin, 'builtin');
    assert.ok(warned.some((w) => /alpha/.test(w) && /skip/i.test(w)), warned.join('; '));
  } finally { console.warn = orig; }
});

test('opts.userAgentsDir: null disables the user layer entirely', () => {
  const builtin = tmp('worca-cc-builtin-');
  writeAgent(builtin, 'alpha', { order: 1 });
  const reg = loadAgentRegistry(builtin, { userAgentsDir: null });
  assert.deepEqual(Object.keys(reg), ['alpha']);
});

test('the default user layer is <worcaHome()>/agents and merges automatically', () => {
  const builtin = tmp('worca-cc-builtin-');
  writeAgent(builtin, 'alpha', { order: 1 });
  const userDir = join(worcaHome(), 'agents');
  writeAgent(userDir, 'gamma', { order: 5 });
  assert.equal(userAgentsDir(), userDir);
  const reg = loadAgentRegistry(builtin); // no opts: user layer resolved from worcaHome()
  assert.deepEqual(Object.keys(reg), ['alpha', 'gamma']);
  assert.equal(reg.gamma.origin, 'user');
});

test('combined layers sort by .order across layers', () => {
  const builtin = tmp('worca-cc-builtin-');
  const user = tmp('worca-cc-user-');
  writeAgent(builtin, 'zlast', { order: 10 });
  writeAgent(user, 'afirst', { order: 0.5 });
  const reg = loadAgentRegistry(builtin, { userAgentsDir: user });
  assert.deepEqual(Object.keys(reg), ['afirst', 'zlast']);
});
