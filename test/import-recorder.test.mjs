// test/import-recorder.test.mjs — the builtins-only preload that logs every module a child resolves.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const REPO_URL = pathToFileURL(REPO).href;
const RECORDER = pathToFileURL(join(REPO, 'test/helpers/import-recorder.mjs')).href;
const REFS = pathToFileURL(join(REPO, 'src/core/secrets/refs.mjs')).href;
const ROOT = mkdtempSync(join(tmpdir(), 'worca-import-recorder-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));

// The child marks the log, then imports refs.mjs: nothing from the repo may precede the mark.
const SCRIPT = `import { appendFileSync } from 'node:fs';
const log = process.env.WORCA_TEST_IMPORT_LOG;
if (log) appendFileSync(log, 'MARK\\n');
await import(${JSON.stringify(REFS)});`;

const runChild = (env) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', RECORDER, '--input-type=module', '--eval', SCRIPT],
  { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });

test('with the variable: refs.mjs is logged after the mark, and no repo URL before it', () => {
  const log = join(ROOT, 'imports.log');
  const r = runChild({ WORCA_TEST_IMPORT_LOG: log });
  assert.equal(r.status, 0, r.stderr);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  const mark = lines.indexOf('MARK');
  assert.ok(mark >= 0);
  assert.deepEqual(lines.slice(0, mark).filter((l) => l.startsWith(REPO_URL)), []);
  assert.ok(lines.slice(mark + 1).includes(REFS));
});

test('without the variable: no log is written', () => {
  const cwd = mkdtempSync(join(ROOT, 'none-'));
  const env = { ...process.env };
  delete env.WORCA_TEST_IMPORT_LOG;
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', RECORDER, '--input-type=module', '--eval', SCRIPT], { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(cwd), []);
});
