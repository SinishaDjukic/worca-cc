// test/settings-file-mode.test.mjs — settings.json is owner-only (0600) on POSIX: written so, and tightened at
// every CLI and server start, leftover temp copies included.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readServerSource } from '../src/core/read-server-source.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'worca-settings-mode-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => rmSync(HOME, { recursive: true, force: true }));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(HOME, '.worca-cc');
const FILE = join(DIR, 'settings.json');
const TMP = join(DIR, 'settings.json.1a2b3c4d.tmp');
const POSIX = { skip: process.platform === 'win32' };
const modeOf = (f) => statSync(f).mode & 0o777;
const settings = () => import('../src/core/settings.mjs');
const seed = (mode, file = FILE) => { mkdirSync(DIR, { recursive: true }); writeFileSync(file, '{}\n'); chmodSync(file, mode); };
const reset = () => rmSync(DIR, { recursive: true, force: true });

/** Captures console.warn lines for the duration of `fn`. */
function warnings(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  try { return { result: fn(), lines }; } finally { console.warn = orig; }
}

test('persistSettings writes 0600 under umask 022, and the bytes are unchanged', POSIX, async () => {
  reset();
  const prev = process.umask(0o022);
  try {
    const { writeSettingsKeys, readSettings } = await settings();
    await writeSettingsKeys({ foo: 1 });
    assert.equal(modeOf(FILE), 0o600);
    assert.equal(readFileSync(FILE, 'utf8'), JSON.stringify(readSettings(), null, 2) + '\n');
    assert.equal(readFileSync(FILE, 'utf8'), JSON.stringify({ foo: 1 }, null, 2) + '\n');
  } finally { process.umask(prev); }
});

test('a 0644 file is tightened; 0600, missing and win32 change nothing', POSIX, async () => {
  const { tightenSettingsFileMode } = await settings();
  reset(); seed(0o644);
  assert.deepEqual(tightenSettingsFileMode(), { changed: true });
  assert.equal(modeOf(FILE), 0o600);
  assert.deepEqual(tightenSettingsFileMode(), { changed: false, reason: 'already' });
  reset();
  assert.deepEqual(tightenSettingsFileMode(), { changed: false, reason: 'missing' });
  seed(0o644);
  assert.deepEqual(tightenSettingsFileMode({ platform: 'win32' }), { changed: false, reason: 'windows' });
  assert.equal(modeOf(FILE), 0o644);
});

test('a leftover settings.json temp copy is tightened too', POSIX, async () => {
  const { tightenSettingsFileMode } = await settings();
  reset(); seed(0o600); seed(0o644, TMP); seed(0o644, join(DIR, 'settings.json.notes.tmp'));
  assert.deepEqual(tightenSettingsFileMode(), { changed: true });
  assert.equal(modeOf(TMP), 0o600);
  assert.equal(modeOf(join(DIR, 'settings.json.notes.tmp')), 0o644, 'only the 8-hex-digit temp form');
});

test('a 0644 temp copy with no settings.json is tightened, and the answer is still missing', POSIX, async () => {
  reset();
  seed(0o644, TMP);
  const { tightenSettingsFileMode } = await settings();
  assert.deepEqual(tightenSettingsFileMode(), { changed: false, reason: 'missing' });
  assert.equal(modeOf(TMP), 0o600);
});

test('an fs error warns once, names the code and never throws', POSIX, async () => {
  const { tightenSettingsFileMode } = await settings();
  const err = (code) => () => { throw Object.assign(new Error(code), { code }); };
  reset(); seed(0o644);
  for (const [opts, code] of [[{ chmod: err('EPERM') }, 'EPERM'], [{ stat: err('EACCES') }, 'EACCES']]) {
    const { result, lines } = warnings(() => tightenSettingsFileMode(opts));
    assert.deepEqual(result, { changed: false, reason: 'error', code });
    assert.deepEqual(lines, [`[worca] could not make settings.json owner-only (${code}); run chmod 600 on it or fix its owner`]);
  }
  // A failure on the temp copy alone: still one warning, no throw.
  reset(); seed(0o600); seed(0o644, TMP);
  const chmod = (p, m) => { if (p.endsWith('.tmp')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); chmodSync(p, m); };
  const { result, lines } = warnings(() => tightenSettingsFileMode({ chmod }));
  assert.deepEqual(result, { changed: false, reason: 'error', code: 'EPERM' });
  assert.equal(lines.length, 1);
});

test('CLI help tightens a 0644 settings file', POSIX, () => {
  reset(); seed(0o644);
  const r = spawnSync(process.execPath, [join(ROOT, 'src/cli/worca-cc.mjs'), 'help'], {
    env: { ...process.env, HOME, USERPROFILE: HOME, WORCA_TEST_ALLOW_HOME_FALLBACK: '1' }, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(modeOf(FILE), 0o600);
});

test('server boot calls tighten before the proxy migration', () => {
  const src = readServerSource();
  const t = src.indexOf('tightenSettingsFileMode()');
  assert.ok(t > 0, 'the server calls tightenSettingsFileMode()');
  assert.ok(t < src.indexOf('migrateCorporateProxyFlag()'));
});
