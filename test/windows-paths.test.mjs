// test/windows-paths.test.mjs — Windows portability guards.
//
// Regression for the Windows bug where every built-in agent vanished from the
// UI: `new URL('../../agents/', import.meta.url).pathname` is a URL path, not a
// filesystem path — `/C:/…/agents/` on Windows (ENOENT) and %-encoded on every
// platform — so the built-in registry layer scanned as EMPTY. Downstream:
// /api/agents returned nothing (saved workflows painted "Could not load this
// workflow"), and setStep rejected each model change with `unknown step` (the
// New Pipeline picker flickered back to its previous value).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_AGENTS_DIR, loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { scrubbedEnv, WIN32_ENV_BASELINE } from '../src/core/plugin-shim.mjs';
import { lastPathSegment } from '../src/core/chat/command-router.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));

test('DEFAULT_AGENTS_DIR is a filesystem path (fileURLToPath), not a URL pathname', () => {
  assert.equal(DEFAULT_AGENTS_DIR, fileURLToPath(new URL('../agents/', import.meta.url)));
  assert.ok(!DEFAULT_AGENTS_DIR.includes('%'), 'must not be percent-encoded');
  assert.ok(!/^\/[A-Za-z]:/.test(DEFAULT_AGENTS_DIR), 'must not be a /C:/… URL path');
  assert.ok(DEFAULT_AGENTS_DIR.includes(sep), 'uses the host separator');
  assert.ok(existsSync(DEFAULT_AGENTS_DIR) && statSync(DEFAULT_AGENTS_DIR).isDirectory());
  assert.ok(readdirSync(DEFAULT_AGENTS_DIR).includes('planner.meta.json'));
});

test('the built-in layer is non-empty through the DEFAULT (argument-less) registry load', () => {
  // This is the exact call /api/agents, listAgents() and config.mjs stepKeys()
  // make; with the URL-pathname default it returned {} on Windows.
  const reg = loadAgentRegistry(undefined, { userAgentsDir: null, includePlugins: false });
  for (const key of ['clarify', 'planner', 'refiner', 'implementer', 'reviewer']) {
    assert.equal(reg[key]?.origin, 'builtin', `built-in "${key}" must resolve`);
    assert.ok(existsSync(reg[key].agentPath), `agentPath must exist: ${reg[key].agentPath}`);
  }
});

// Sweep: no module may derive a filesystem path from `import.meta.url` via
// `.pathname` again. Walks src/, scripts/ and ui/server.mjs (the Node side —
// browser modules never touch the filesystem).
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.mjs') || name.endsWith('.js') || name.endsWith('.cjs')) out.push(p);
  }
  return out;
}

test('no Node-side module uses `new URL(…, import.meta.url).pathname` as a filesystem path', () => {
  const files = [...walk(join(REPO, 'src')), ...walk(join(REPO, 'scripts')), join(REPO, 'ui', 'server.mjs')];
  assert.ok(files.length > 50, 'sweep must actually see the codebase');
  const offenders = files.filter((f) => /import\.meta\.url\)\s*\.pathname/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => f.slice(REPO.length)), [], 'use fileURLToPath(new URL(…, import.meta.url)) instead');
});

test('scrubbedEnv: PATH+HOME only on POSIX; Windows additionally gets the non-secret system baseline', () => {
  const saved = { ...process.env };
  try {
    process.env.PATH = '/usr/bin';
    process.env.HOME = '/home/u';
    process.env.WORCA_HOME = '/home/u/.worca-cc';
    process.env.SYSTEMROOT = 'C:\\Windows';
    process.env.USERPROFILE = 'C:\\Users\\u';
    process.env.SECRET_TOKEN = 'nope';
    assert.deepEqual(scrubbedEnv('linux'), { PATH: '/usr/bin', HOME: '/home/u' });
    const win = scrubbedEnv('win32');
    assert.equal(win.PATH, '/usr/bin');
    assert.equal(win.SYSTEMROOT, 'C:\\Windows');
    assert.equal(win.USERPROFILE, 'C:\\Users\\u');
    assert.ok(!('WORCA_HOME' in win) && !('SECRET_TOKEN' in win), 'never forwards WORCA_* or arbitrary vars');
    for (const k of Object.keys(win)) assert.ok(['PATH', 'HOME', ...WIN32_ENV_BASELINE].includes(k), `unexpected key ${k}`);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('lastPathSegment handles POSIX, Windows and trailing separators', () => {
  assert.equal(lastPathSegment('/x/worca'), 'worca');
  assert.equal(lastPathSegment('C:\\x\\worca'), 'worca');
  assert.equal(lastPathSegment('C:\\x\\worca\\'), 'worca');
  assert.equal(lastPathSegment('/x/worca/'), 'worca');
  assert.equal(lastPathSegment(''), '');
  assert.equal(lastPathSegment(undefined), '');
});
