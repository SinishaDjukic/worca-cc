// test/script-bench-dir-cwd.test.mjs
// The bench cwd arm the CLI alone unlocks (spec §6): `worca script test --cwd
// <dir>` runs in an arbitrary folder, and the SERVER never passes allowDirCwd,
// so a browser can never point a bench run at one. P1c's deps.onLine is used
// here as-is (the CLI's only line channel) and is NOT changed by this task.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { userScriptsDir } from '../src/core/script-registry.mjs';
import { resolveBenchCwd, runBenchOnce } from '../src/core/script-bench.mjs';

useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true, maxRetries: 3 }); });

/** A node script that prints one line and reports the cwd it ran in. */
function writeCwdScript(key) {
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.mjs`), [
    'export default async function ({ ctx }) {',
    "  console.log('probe line');",
    "  return { outputs: { out: { value: ctx.cwd + '\\n' } }, summary: ctx.cwd };",
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, metaVersion: 2, displayName: key, runtime: 'node', file: `${key}.mjs`, order: 900,
    inputs: [], outputs: [{ id: 'out', type: 'md', when: 'always', filename: `${key}-cycle{cycle}.md` }],
  }, null, 2) + '\n');
}

test('resolveBenchCwd: scratch, a dir with allowDirCwd, and every refusal', async () => {
  // The scratch arm CREATES its folder (the landed _cwd did), so name one that is not there yet.
  const dirs = { cwd: join(tmp('worca-cc-bench-scratch-'), 'cwd') };
  assert.deepEqual(await resolveBenchCwd(undefined, { dirs }), { cwd: dirs.cwd, checkpointRef: null });
  assert.ok(existsSync(dirs.cwd), 'scratch is created on demand');
  assert.deepEqual(await resolveBenchCwd({ kind: 'scratch' }, { dirs }), { cwd: dirs.cwd, checkpointRef: null });
  assert.deepEqual(await resolveBenchCwd({}, { dirs }), { cwd: dirs.cwd, checkpointRef: null }, 'no kind reads as scratch, as before');
  const real = tmp('worca-cc-bench-dir-');
  const got = await resolveBenchCwd({ kind: 'dir', dir: real }, { dirs, allowDirCwd: true });
  assert.equal(got.cwd, real);
  assert.equal(got.checkpointRef, null, 'a folder that is no git checkout has no checkpoint');
  // The landed project arm keeps its three sentences.
  const projects = async () => [{ key: 'p1', path: real, exists: true }, { key: 'gone', path: join(real, 'nope'), exists: false }];
  assert.equal((await resolveBenchCwd({ kind: 'project', projectKey: 'p1' }, { dirs, projects })).cwd, real);
  await assert.rejects(() => resolveBenchCwd({ kind: 'project' }, { dirs, projects }),
    (e) => e.code === 'BAD_REQUEST' && /needs a projectKey/.test(e.message));
  await assert.rejects(() => resolveBenchCwd({ kind: 'project', projectKey: 'ghost' }, { dirs, projects }),
    (e) => e.code === 'BAD_REQUEST' && /project "ghost" is not registered/.test(e.message));
  await assert.rejects(() => resolveBenchCwd({ kind: 'project', projectKey: 'gone' }, { dirs, projects }),
    (e) => e.code === 'BAD_REQUEST' && /does not exist or is not a directory/.test(e.message));
  await assert.rejects(() => resolveBenchCwd({ kind: 'dir' }, { dirs, allowDirCwd: true }),
    (e) => e.code === 'BAD_REQUEST' && /needs a dir/.test(e.message));
  await assert.rejects(() => resolveBenchCwd({ kind: 'dir', dir: real }, { dirs }),
    (e) => e.code === 'BAD_REQUEST' && /registered project/.test(e.message));
  await assert.rejects(() => resolveBenchCwd({ kind: 'dir', dir: join(real, 'nope') }, { dirs, allowDirCwd: true }),
    (e) => e.code === 'BAD_REQUEST' && /not a directory/.test(e.message));
  await assert.rejects(() => resolveBenchCwd({ kind: 'elsewhere' }, { dirs, allowDirCwd: true }),
    (e) => e.code === 'BAD_REQUEST' && /scratch, project or dir/.test(e.message));
});

test('runBenchOnce: allowDirCwd routes the run into that folder; P1c onLine still streams', async () => {
  writeCwdScript('dirProbe');
  const where = tmp('worca-cc-bench-run-');
  const lines = [];
  const result = await runBenchOnce(
    { key: 'dirProbe', params: {}, inputs: {}, cwd: { kind: 'dir', dir: where } },
    { allowDirCwd: true, onLine: (ev) => lines.push(String(ev && ev.text)) });
  assert.equal(result.status, 'clean', JSON.stringify(result.error || {}));
  assert.ok(result.summary.includes(basename(where)), result.summary);
  assert.ok(lines.some((l) => l.includes('probe line')), lines.join(' | '));
});

test('the server never passes allowDirCwd (source pin)', () => {
  const src = readFileSync(fileURLToPath(new URL('../ui/server.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /allowDirCwd/, 'a browser must never point a bench run at an arbitrary folder');
  assert.match(src, /createBench\(request\)/, 'the bench route builds its bench with NO deps');
});

test('runBenchOnce without allowDirCwd refuses a dir cwd — the server never sets it', async () => {
  writeCwdScript('dirProbeTwo');
  await assert.rejects(
    () => runBenchOnce({ key: 'dirProbeTwo', cwd: { kind: 'dir', dir: tmp('worca-cc-bench-x-') } }, {}),
    (e) => e.code === 'BAD_REQUEST');
});
