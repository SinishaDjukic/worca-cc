// test/cli-flags.test.mjs — `worca flags` (spec §3.3): list / on / off / reset round-trip
// settings.json through the same setter as the API; a WORCA_FLAGS-locked key is refused.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'worca-cc.mjs');
const home = useTempHome(after);
let sandbox;
before(async () => { sandbox = await mkdtemp(join(tmpdir(), 'worca-flags-cli-')); });
after(async () => { await rm(sandbox, { recursive: true, force: true }); });

function run(args, extraEnv = {}) {
  return new Promise((res) => {
    // settings.json lives under HOME; the child inherits NODE_TEST_CONTEXT, so it must opt in (P15).
    const env = { ...process.env, WORCA_HOME: home, HOME: sandbox, USERPROFILE: sandbox, WORCA_TEST_ALLOW_HOME_FALLBACK: '1', ...extraEnv };
    if (!('WORCA_FLAGS' in extraEnv)) delete env.WORCA_FLAGS;
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (b) => (stdout += b)); child.stderr.on('data', (b) => (stderr += b));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}
const stored = async () => { try { return JSON.parse(await readFile(join(sandbox, '.worca-cc', 'settings.json'), 'utf8')).flags; } catch { return undefined; } };

test('worca flags list / on / off / reset, and a locked key is refused', async () => {
  await checkRows([
    { name: 'list (and bare `worca flags`) prints key, state, stage, source', run: async () => {
      for (const args of [['flags'], ['flags', 'list']]) {
        const r = await run(args);
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.stdout, /^flagsDemo\toff\texperimental\tdefault$/m);
      }
    } },
    { name: 'on / off / reset round-trip settings.json', run: async () => {
      assert.equal((await run(['flags', 'on', 'flagsDemo'])).code, 0);
      assert.deepEqual(await stored(), { flagsDemo: true });
      assert.match((await run(['flags'])).stdout, /^flagsDemo\ton\texperimental\tsettings$/m);
      assert.equal((await run(['flags', 'off', 'flagsDemo'])).code, 0);
      assert.equal(await stored(), undefined);
      await run(['flags', 'on', 'flagsDemo']);
      assert.equal((await run(['flags', 'reset'])).code, 0);
      assert.equal(await stored(), undefined);
    } },
    { name: 'an unknown key and bad usage exit 2', run: async () => {
      const r = await run(['flags', 'on', 'ghostFlag']);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /unknown flag "ghostFlag"/);
      assert.equal((await run(['flags', 'on'])).code, 2);
      assert.equal((await run(['flags', 'toggle', 'flagsDemo'])).code, 2);
    } },
    { name: 'a WORCA_FLAGS-locked key is refused, and list says it is locked', run: async () => {
      const r = await run(['flags', 'off', 'flagsDemo'], { WORCA_FLAGS: 'flagsDemo' });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /locked by WORCA_FLAGS/);
      assert.match((await run(['flags'], { WORCA_FLAGS: 'flagsDemo' })).stdout, /^flagsDemo\ton\texperimental\tlocked by WORCA_FLAGS$/m);
    } },
  ]);
});
