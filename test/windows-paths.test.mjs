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
import { checkRows } from './helpers/rows.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const PROXY_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'];

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
// `.pathname` again. Walks src/, tools/, scripts/ and ui/server.mjs (the Node side —
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
  const dirs = ['src', 'tools', 'scripts'].map((d) => join(REPO, d)).filter((d) => existsSync(d));
  const files = [...dirs.flatMap((d) => walk(d)), join(REPO, 'ui', 'server.mjs')];
  assert.ok(files.length > 50, 'sweep must actually see the codebase');
  const offenders = files.filter((f) => /import\.meta\.url\)\s*\.pathname/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => f.slice(REPO.length)), [], 'use fileURLToPath(new URL(…, import.meta.url)) instead');
});

test('scrubbedEnv: PATH, HOME, the proxy and CA variables on POSIX; Windows additionally gets the non-secret system baseline', async () => {
  // A plain object for the host env, never process.env: on Windows that one answers every
  // casing of a name, so HTTPS_PROXY and https_proxy would both come back.
  const HOST = {
    PATH: '/usr/bin', HOME: '/home/u', WORCA_HOME: '/home/u/.worca-cc',
    SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\u', SECRET_TOKEN: 'nope',
  };
  const scrub = (platform, vars = {}) => scrubbedEnv(platform, { ...HOST, ...vars });
  const CA = { NODE_EXTRA_CA_CERTS: '/etc/corp/ca.pem', SSL_CERT_FILE: '/etc/ssl/corp.pem', SSL_CERT_DIR: '/etc/ssl/certs' };
  await checkRows([
    { name: 'POSIX with no proxy set: PATH and HOME only', run: () => {
      assert.deepEqual(scrub('linux'), { PATH: '/usr/bin', HOME: '/home/u' });
    } },
    { name: 'POSIX: each proxy variable that is set passes in its own case, unset ones stay absent', run: () => {
      assert.deepEqual(scrub('linux', { HTTPS_PROXY: 'http://proxy.corp:8080', http_proxy: 'http://proxy.corp:3128', no_proxy: 'corp.example,.internal' }), {
        PATH: '/usr/bin', HOME: '/home/u',
        HTTPS_PROXY: 'http://proxy.corp:8080', http_proxy: 'http://proxy.corp:3128', no_proxy: 'corp.example,.internal',
      });
    } },
    { name: 'the CA bundle paths pass on both platforms, a credentialed proxy or not (a proxy that re-signs TLS needs them)', run: () => {
      assert.deepEqual(scrub('linux', CA), { PATH: '/usr/bin', HOME: '/home/u', ...CA });
      const win = scrub('win32', { ...CA, HTTPS_PROXY: 'http://user:s3cret@proxy.corp:8080' });
      for (const [k, v] of Object.entries(CA)) assert.equal(win[k], v, k);
      assert.ok(!('HTTPS_PROXY' in win));
    } },
    { name: 'Windows: the baseline and the proxy variables, never WORCA_* or arbitrary vars', run: () => {
      const win = scrub('win32', { HTTPS_PROXY: 'http://proxy.corp:8080', NO_PROXY: 'corp.example' });
      assert.equal(win.PATH, '/usr/bin');
      assert.equal(win.SYSTEMROOT, 'C:\\Windows');
      assert.equal(win.USERPROFILE, 'C:\\Users\\u');
      assert.equal(win.HTTPS_PROXY, 'http://proxy.corp:8080');
      assert.equal(win.NO_PROXY, 'corp.example');
      assert.ok(!('WORCA_HOME' in win) && !('SECRET_TOKEN' in win), 'never forwards WORCA_* or arbitrary vars');
      for (const k of Object.keys(win)) assert.ok(['PATH', 'HOME', ...PROXY_NAMES, ...WIN32_ENV_BASELINE].includes(k), `unexpected key ${k}`);
    } },
    { name: 'a proxy URL with credentials (in any form) withholds every proxy URL on both platforms; NO_PROXY still passes', run: () => {
      for (const withCreds of ['http://user:s3cret@proxy.corp:8080', 'http://TOKEN@proxy.corp:8080', 'user:s3cret@proxy.corp:8080', 'http://user:s3cret@[not-a-host']) {
        const vars = { https_proxy: withCreds, HTTP_PROXY: 'http://proxy.corp:3128', NO_PROXY: 'corp.example' };
        assert.deepEqual(scrub('linux', vars), { PATH: '/usr/bin', HOME: '/home/u', NO_PROXY: 'corp.example' }, withCreds);
        const win = scrub('win32', vars);
        assert.equal(win.NO_PROXY, 'corp.example', withCreds);
        assert.ok(!['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy'].some((k) => k in win), `${withCreds}: ${Object.keys(win)}`);
      }
    } },
    { name: 'a malformed proxy URL without credentials still passes, so the child can warn about it', run: () => {
      assert.deepEqual(scrub('linux', { HTTPS_PROXY: 'http://[not-a-host' }), { PATH: '/usr/bin', HOME: '/home/u', HTTPS_PROXY: 'http://[not-a-host' });
    } },
    { name: 'with no env given, it reads this process', run: () => {
      assert.equal(scrubbedEnv('linux').PATH, process.env.PATH);
    } },
  ]);
});

test('lastPathSegment handles POSIX, Windows and trailing separators', () => {
  assert.equal(lastPathSegment('/x/worca'), 'worca');
  assert.equal(lastPathSegment('C:\\x\\worca'), 'worca');
  assert.equal(lastPathSegment('C:\\x\\worca\\'), 'worca');
  assert.equal(lastPathSegment('/x/worca/'), 'worca');
  assert.equal(lastPathSegment(''), '');
  assert.equal(lastPathSegment(undefined), '');
});
