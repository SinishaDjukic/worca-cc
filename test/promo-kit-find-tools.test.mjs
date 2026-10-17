// test/promo-kit-find-tools.test.mjs
// Chrome / Edge / ffmpeg lookups for the promo kit, per host OS. Pure: every case injects
// platform/env/exists/which, so the Windows and Linux paths are covered on any host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, findFfmpeg, toolHints, which } from '../assets/promo-kit/tools/find-tools.mjs';

const only = (...ps) => { const set = new Set(ps); return (p) => set.has(p); };
const none = () => null;

test('WORCA_CHROME wins when it exists', () => {
  assert.equal(findChrome({ env: { WORCA_CHROME: '/x/chrome' }, exists: () => true, which: none }), '/x/chrome');
  // a stale override falls through to the normal lookup
  assert.equal(findChrome({ env: { WORCA_CHROME: '/gone/chrome' }, platform: 'linux', exists: only('/usr/bin/chromium'), which: none }), '/usr/bin/chromium');
});

test('win32: Chrome under %ProgramFiles%, Edge when Chrome is absent, %LocalAppData% per-user installs', () => {
  const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(findChrome({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' }, exists: only(chrome), which: none }), chrome);
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  assert.equal(findChrome({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    exists: only(edge), which: none }), edge);
  const local = 'C:\\Users\\Pat Doe\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(findChrome({ platform: 'win32', env: { LOCALAPPDATA: 'C:\\Users\\Pat Doe\\AppData\\Local' }, exists: only(local), which: none }), local,
    'env names are case-insensitive on Windows');
  // Chrome beats Edge when both are installed
  assert.equal(findChrome({ platform: 'win32', env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    exists: only(chrome, edge), which: none }), chrome);
});

test('darwin falls back to the app bundle; linux finds chromium on PATH', () => {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.equal(findChrome({ platform: 'darwin', env: {}, exists: only(mac), which: none }), mac);
  const edgeMac = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.equal(findChrome({ platform: 'darwin', env: {}, exists: only(edgeMac), which: none }), edgeMac);
  assert.equal(findChrome({ platform: 'linux', env: {}, exists: () => false, which: (n) => (n === 'chromium' ? '/usr/lib/chromium/chromium' : null) }),
    '/usr/lib/chromium/chromium');
  assert.equal(findChrome({ platform: 'linux', env: {}, exists: () => false, which: none }), null);
});

test('PATH lookup prefers google-chrome, then chromium, …, then msedge', () => {
  const seen = [];
  const w = (n) => { seen.push(n); return n === 'msedge' ? '/opt/msedge' : null; };
  assert.equal(findChrome({ platform: 'linux', env: {}, exists: () => false, which: w }), '/opt/msedge');
  assert.deepEqual(seen.slice(0, 6), ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge']);
});

test('findFfmpeg: WORCA_FFMPEG, then ffmpeg-static, then PATH; all missing → null', () => {
  const stat = '/nm/ffmpeg-static/ffmpeg';
  assert.equal(findFfmpeg({ env: { WORCA_FFMPEG: '/x/ffmpeg' }, exists: () => true, resolveStatic: () => stat, which: () => '/usr/bin/ffmpeg' }), '/x/ffmpeg');
  assert.equal(findFfmpeg({ env: {}, exists: () => true, resolveStatic: () => stat, which: () => '/usr/bin/ffmpeg' }), stat);
  assert.equal(findFfmpeg({ env: {}, exists: only('/usr/bin/ffmpeg'), resolveStatic: () => stat, which: () => '/usr/bin/ffmpeg' }), '/usr/bin/ffmpeg',
    'a resolved ffmpeg-static whose binary was never downloaded is skipped');
  assert.equal(findFfmpeg({ env: {}, exists: () => true, resolveStatic: () => null, which: (n) => (n === 'ffmpeg' ? '/usr/bin/ffmpeg' : null) }), '/usr/bin/ffmpeg');
  assert.equal(findFfmpeg({ platform: 'linux', env: {}, exists: () => false, resolveStatic: () => null, which: none }), null);
  assert.equal(findFfmpeg({ platform: 'win32', env: {}, exists: () => false, resolveStatic: () => { throw new Error('not installed'); }, which: none }), null);
});

test('which() walks PATH (and PATHEXT on win32)', () => {
  assert.equal(which('ffmpeg', { platform: 'linux', env: { PATH: '/a:/usr/bin' }, exists: only('/usr/bin/ffmpeg') }), '/usr/bin/ffmpeg');
  assert.equal(which('ffmpeg', { platform: 'win32', env: { Path: 'C:\\tools;C:\\Program Files\\ffmpeg\\bin', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    exists: only('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.EXE') }), 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.EXE');
  assert.equal(which('ffmpeg', { platform: 'win32', env: { PATH: '"C:\\Program Files\\ffmpeg\\bin"' }, exists: only('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.EXE') }),
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.EXE', 'quoted PATH entry, default PATHEXT');
  assert.equal(which('nope', { platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false }), null);
});

test('toolHints name the install command for the host OS', () => {
  assert.match(toolHints('win32').ffmpeg, /winget install Gyan\.FFmpeg/);
  assert.match(toolHints('darwin').ffmpeg, /brew install ffmpeg/);
  assert.match(toolHints('linux').ffmpeg, /apt install ffmpeg/);
  for (const p of ['win32', 'darwin', 'linux']) {
    assert.match(toolHints(p).chrome, /WORCA_CHROME/);
    assert.match(toolHints(p).ffmpeg, /WORCA_FFMPEG/);
  }
  assert.match(toolHints('win32').chrome, /Edge/);
});

test('loadDep: a staged copy of the kit (no node_modules beside it) finds worca deps through WORCA_APP_ROOT', async () => {
  const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const stage = mkdtempSync(join(tmpdir(), 'promo-kit-stage-'));
  const cwd = process.cwd();
  try {
    mkdirSync(join(stage, 'promo-kit', 'tools'), { recursive: true });
    copyFileSync(join(repo, 'assets', 'promo-kit', 'tools', 'find-tools.mjs'), join(stage, 'promo-kit', 'tools', 'find-tools.mjs'));
    const staged = await import(pathToFileURL(join(stage, 'promo-kit', 'tools', 'find-tools.mjs')).href);
    process.chdir(stage);                                   // not the repo: the cwd fallback must not find it
    assert.throws(() => staged.loadDep('gsap/package.json', { env: { PATH: '' } }), /WORCA_APP_ROOT/);
    assert.equal(staged.loadDep('gsap/package.json', { env: { PATH: '', WORCA_APP_ROOT: repo } }).name, 'gsap');
  } finally { process.chdir(cwd); rmSync(stage, { recursive: true, force: true }); }
});

test('loadDep from a STAGED kit (no node_modules beside it) resolves worca deps through .worca-app-root', async () => {
  const { mkdtemp, cp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const run = await mkdtemp(join(tmpdir(), 'promo-staged-'));
  try {
    await cp(join(repo, 'assets', 'promo-kit'), join(run, 'promo-kit'), { recursive: true });
    await writeFile(join(run, 'promo-kit', '.worca-app-root'), repo + '\n');
    const staged = await import(pathToFileURL(join(run, 'promo-kit', 'tools', 'find-tools.mjs')).href);
    const pw = staged.loadDep('playwright-core', { env: { PATH: process.env.PATH || '' } });   // no WORCA_APP_ROOT, no npm_package_json
    assert.equal(typeof pw.chromium, 'object');
  } finally { await rm(run, { recursive: true, force: true }); }
});
