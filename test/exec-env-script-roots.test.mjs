// test/exec-env-script-roots.test.mjs
// The built-in scripts' import closure (script-runner.mjs scriptUploadRoots): copied alone, at the same relative
// layout, every scripts/*.mjs still resolves all its imports — what an E2B sandbox gets in e2b mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scriptUploadRoots, BUILTIN_SCRIPT_PACKAGES } from '../src/core/graph/script-runner.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'worca-script-roots-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

test('user and plugin scripts get their own tree', () => {
  assert.deepEqual(scriptUploadRoots('/home/u/.worca-cc/scripts/x.mjs'), ['/home/u/.worca-cc/scripts']);
  assert.deepEqual(scriptUploadRoots('/p/plugins/acme/current/scripts/sub/x.mjs'), ['/p/plugins/acme/current']);
});

test('every built-in script loads from the uploaded roots alone', { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 120_000 }, () => {
  const roots = scriptUploadRoots(join(REPO, 'scripts', 'x.mjs'));
  for (const dir of roots) {
    const name = BUILTIN_SCRIPT_PACKAGES.find((p) => dir.endsWith(`${sep}node_modules${sep}${p}`));
    cpSync(dir, name ? join(scratch, 'node_modules', name) : join(scratch, relative(REPO, dir)), { recursive: true });
  }
  const failures = [];
  for (const f of readdirSync(join(REPO, 'scripts')).filter((n) => n.endsWith('.mjs'))) {
    const url = pathToFileURL(join(scratch, 'scripts', f)).href;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url)})`],
      { cwd: scratch, encoding: 'utf8', timeout: 20_000, env: { ...process.env, WORCA_HOME: join(scratch, 'home') } });
    if (/ERR_MODULE_NOT_FOUND|Cannot find package/.test(r.stderr || '')) failures.push(`${f}: ${r.stderr.split('\n').find((l) => /Cannot find|ERR_MODULE/.test(l))}`);
  }
  assert.deepEqual(failures, []);
});

// scripts/promo-*.mjs load the kit lazily (promo-common.mjs loadKitTool), so the import pass above never sees it:
// the Render step failed in a sandbox with "Cannot find module …/assets/promo-kit/tools/find-tools.mjs".
test('the promo kit tools a built-in script loads lazily resolve from the uploaded roots alone', { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false, timeout: 120_000 }, () => {
  const kit = join(scratch, 'assets', 'promo-kit', 'tools');
  const probe = `
const { loadKitTool } = await import(${JSON.stringify(pathToFileURL(join(scratch, 'scripts', 'promo-common.mjs')).href)});
for (const name of ${JSON.stringify(readdirSync(join(REPO, 'assets', 'promo-kit', 'tools')).filter((n) => n.endsWith('.mjs')).map((n) => n.slice(0, -4)))}) await loadKitTool(name);
const { gsapPath } = await import(${JSON.stringify(pathToFileURL(join(kit, 'init-film.mjs')).href)});
if (!gsapPath().startsWith(${JSON.stringify(realpathSync(scratch))})) throw new Error('gsap resolved outside the copy: ' + gsapPath());`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe],
    { cwd: scratch, encoding: 'utf8', timeout: 20_000, env: { ...process.env, WORCA_HOME: join(scratch, 'home') } });
  assert.equal(r.status, 0, r.stderr);
});
