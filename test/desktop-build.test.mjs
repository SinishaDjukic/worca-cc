// test/desktop-build.test.mjs — tools/build.mjs (--target web|desktop), the desktop package, its pinned Node runtime,
// its resources and the manual desktop workflow. Pure planners only: nothing here packages an app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import * as tar from 'tar';
import { pngSize } from '../tools/build-extension.mjs';
import {
  TARGETS, DESKTOP_PLATFORMS, DESKTOP_ARCHES, parseArgs, buildRefusal, planWebBuild, hostDesktopPlatform, nodeRuntimeAsset,
  signingEnv, desktopBuilderConfig, builderCommand, packagedResourcesDir, fetchNodeRuntime, packJsonFromStdout,
  withoutSigning, stageServer, checkSmoke, missingPackagedFiles, step, packagedAppPath, infoPlistProblems, checkPackagedInfoPlist,
} from '../tools/build.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const NVMRC = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim();
const RUNTIME = JSON.parse(readFileSync(join(ROOT, 'desktop/node-runtime.json'), 'utf8'));
const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'tools/build.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
const host = (o = {}) => ({ platform: 'darwin', arch: 'arm64', nodeVersion: `${NVMRC}.3.1`, nvmrc: NVMRC, ...o });

test('parseArgs: web by default; flags parsed', () => {
  assert.deepEqual(TARGETS, ['web', 'desktop']);
  assert.deepEqual(DESKTOP_PLATFORMS, ['mac', 'win', 'linux']);
  assert.deepEqual(DESKTOP_ARCHES, ['x64', 'arm64']);
  assert.deepEqual(parseArgs([]), { target: 'web', platform: null, arch: null, dir: false, smoke: true });
  assert.deepEqual(parseArgs(['--target', 'desktop', '--platform', 'linux', '--arch', 'x64', '--dir', '--no-smoke']),
    { target: 'desktop', platform: 'linux', arch: 'x64', dir: true, smoke: false });
});

test('CLI: unknown target / platform / arch / argument exit 2; web with a desktop flag exits 2; --help exits 0', () => {
  const r = cli('--target', 'ios');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown target: ios/);
  assert.doesNotMatch(r.stdout, /built /, 'nothing built');
  const plat = cli('--target', 'desktop', '--platform', 'beos');
  assert.equal(plat.status, 2);
  assert.match(plat.stderr, /unknown platform: beos/);
  const arch = cli('--target', 'desktop', '--arch', 'ia32');
  assert.equal(arch.status, 2);
  assert.match(arch.stderr, /unknown arch: ia32/);
  const bad = cli('--frob');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown argument: --frob/);
  const web = cli('--target', 'web', '--platform', 'mac');
  assert.equal(web.status, 2);
  assert.match(web.stderr, /--platform, --arch, --dir and --no-smoke apply to --target desktop only/);
  const help = cli('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: build\.mjs \[--target web\|desktop\] \[--platform mac\|win\|linux\] \[--arch x64\|arm64\] \[--dir\] \[--no-smoke\]/);
});

test('buildRefusal: web flags, cross platform, cross arch, unsupported arm64 targets, Node major mismatch', () => {
  const d = (o) => ({ target: 'desktop', platform: null, arch: null, dir: false, smoke: true, ...o });
  assert.equal(buildRefusal(parseArgs([]), host()), null);
  for (const o of [{ platform: 'mac' }, { arch: 'x64' }, { dir: true }, { smoke: false }]) {
    assert.equal(buildRefusal({ ...parseArgs([]), ...o }, host()), '--platform, --arch, --dir and --no-smoke apply to --target desktop only');
  }
  assert.equal(buildRefusal(d({}), host()), null, 'host platform and arch by default');
  assert.equal(buildRefusal(d({ platform: 'mac', arch: 'arm64' }), host()), null);
  assert.equal(buildRefusal(d({ platform: 'win' }), host()), 'desktop builds run on the target platform: build win on a win machine (node-pty is native)');
  assert.equal(buildRefusal(d({ arch: 'x64' }), host()), 'desktop builds run on the target arch: build x64 on an x64 machine (node-pty is native)');
  assert.equal(buildRefusal(d({ platform: 'win', arch: 'arm64' }), host({ platform: 'win32' })), 'win arm64 is not a supported desktop target');
  assert.equal(buildRefusal(d({ platform: 'linux', arch: 'arm64' }), host({ platform: 'linux' })), 'linux arm64 is not a supported desktop target');
  assert.equal(buildRefusal(d({}), host({ platform: 'linux' })), 'linux arm64 is not a supported desktop target', 'an arm64 Linux host has no default target');
  assert.equal(buildRefusal(d({}), host({ platform: 'aix' })), 'desktop builds run on macOS, Windows or Linux, not aix');
  assert.equal(buildRefusal(d({}), host({ nodeVersion: '22.19.0' })), `the desktop build installs node-pty for Node ${NVMRC}: run it with Node ${NVMRC}.x (this is 22.19.0)`);
});

test('planWebBuild: exactly the prepack extension build; prepack and the new scripts pinned', () => {
  assert.deepEqual(planWebBuild(), [{ command: process.execPath, args: [join(ROOT, 'tools/build-extension.mjs'), '--pack'] }]);
  assert.equal(PKG.scripts['build:web'], 'node tools/build.mjs --target web');
  assert.equal(PKG.scripts['build:desktop'], 'node tools/build.mjs --target desktop');
  assert.equal(PKG.scripts.prepack, 'node tools/build-extension.mjs --pack');
  assert.equal(hostDesktopPlatform('darwin'), 'mac');
  assert.equal(hostDesktopPlatform('win32'), 'win');
  assert.equal(hostDesktopPlatform('linux'), 'linux');
  assert.equal(hostDesktopPlatform('aix'), null);
});

test('packJsonFromStdout: the npm pack JSON after prepack output on stdout', () => {
  const json = JSON.stringify([{ filename: 'worca-app-1.0.0.tgz', files: [{ path: 'a' }] }], null, 2);
  assert.equal(packJsonFromStdout(`built chrome → /x\nbuilt edge → /y\n${json}\n`), json);
  assert.equal(packJsonFromStdout(json), json);
  assert.throws(() => packJsonFromStdout('no json here'), /npm pack printed no JSON/);
});

test('signingEnv: unsigned by default; blank vars deleted; mac signed/notarized only when complete; linux never', () => {
  const none = signingEnv({ PATH: '/x' }, 'mac');
  assert.deepEqual([none.signed, none.notarize, none.env.CSC_IDENTITY_AUTO_DISCOVERY, none.env.PATH], [false, false, 'false', '/x']);
  const blank = signingEnv({ CSC_LINK: '', CSC_KEY_PASSWORD: '  ', APPLE_ID: '' }, 'mac');
  assert.equal(blank.signed, false);
  for (const k of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID']) assert.ok(!(k in blank.env), `${k} deleted`);
  const signed = signingEnv({ CSC_LINK: 'b64', CSC_KEY_PASSWORD: 'pw' }, 'mac');
  assert.deepEqual([signed.signed, signed.notarize], [true, false]);
  assert.ok(!('CSC_IDENTITY_AUTO_DISCOVERY' in signed.env));
  const api = signingEnv({ CSC_LINK: 'b64', CSC_KEY_PASSWORD: 'pw', APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' }, 'mac');
  assert.deepEqual([api.signed, api.notarize], [true, true]);
  const appleId = signingEnv({ CSC_LINK: 'b64', CSC_KEY_PASSWORD: 'pw', APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'p', APPLE_TEAM_ID: 't' }, 'mac');
  assert.equal(appleId.notarize, true);
  assert.equal(signingEnv({ CSC_LINK: 'b64', CSC_KEY_PASSWORD: 'pw', APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'p' }, 'mac').notarize, false);
  assert.equal(signingEnv({ APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' }, 'mac').notarize, false, 'notarize needs signing');
  assert.equal(signingEnv({ CSC_LINK: 'b64', CSC_KEY_PASSWORD: 'pw' }, 'linux').signed, false);
  assert.equal(signingEnv({ WIN_CSC_LINK: 'b64', WIN_CSC_KEY_PASSWORD: 'pw' }, 'win').signed, true);
  assert.equal(signingEnv({ WIN_CSC_LINK: 'b64' }, 'win').signed, false);
  assert.equal(signingEnv({ CSC_LINK: 'b64' }, 'mac').signed, false, 'a mac certificate without its password is unsigned');
  assert.equal(signingEnv({ CSC_LINK: 'b64' }, 'mac').env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
});

test('signingEnv win: the mac certificate (CSC_*) never signs a Windows build and is removed from its env', () => {
  const macOnly = signingEnv({ CSC_LINK: 'mac-p12', CSC_KEY_PASSWORD: 'pw', PATH: '/x' }, 'win');
  assert.equal(macOnly.signed, false);
  assert.ok(!('CSC_LINK' in macOnly.env) && !('CSC_KEY_PASSWORD' in macOnly.env), 'electron-builder would read CSC_LINK on Windows');
  assert.equal(macOnly.env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
  assert.equal(macOnly.env.PATH, '/x');
  const both = signingEnv({ CSC_LINK: 'mac-p12', CSC_KEY_PASSWORD: 'pw', WIN_CSC_LINK: 'win-pfx', WIN_CSC_KEY_PASSWORD: 'wpw' }, 'win');
  assert.equal(both.signed, true);
  assert.deepEqual([both.env.WIN_CSC_LINK, both.env.WIN_CSC_KEY_PASSWORD, 'CSC_LINK' in both.env], ['win-pfx', 'wpw', false]);
  assert.equal(signingEnv({ CSC_LINK: 'mac-p12', CSC_KEY_PASSWORD: 'pw' }, 'mac').env.CSC_LINK, 'mac-p12', 'mac keeps it');
});

test('withoutSigning: every signing secret is dropped (npm and install scripts never see them); the input is not mutated', () => {
  const env = { PATH: '/x', HOME: '/h', CSC_LINK: 'a', CSC_KEY_PASSWORD: 'b', WIN_CSC_LINK: 'c', WIN_CSC_KEY_PASSWORD: 'd', APPLE_API_KEY: 'e', APPLE_API_KEY_ID: 'f', APPLE_API_ISSUER: 'g', APPLE_ID: 'h', APPLE_APP_SPECIFIC_PASSWORD: 'i', APPLE_TEAM_ID: 'j' };
  assert.deepEqual(withoutSigning(env), { PATH: '/x', HOME: '/h' });
  assert.equal(env.CSC_LINK, 'a');
});

test('desktopBuilderConfig: unsigned mac, asar, no rebuild, the extraResources (server, its node_modules, node), no publish, targets, version', () => {
  const c = desktopBuilderConfig({ version: PKG.version, platform: 'mac', arch: 'arm64', signed: false, notarize: false });
  assert.equal(c.appId, 'dev.worca.desktop');
  assert.equal(c.productName, 'Worca');
  assert.equal(c.extraMetadata.version, PKG.version);
  assert.deepEqual(c.directories, { output: 'dist', buildResources: 'build-resources' });
  assert.deepEqual(c.files, ['main.mjs', 'src/**', 'assets/**', 'package.json']);
  assert.equal(c.asar, true);
  assert.equal(c.npmRebuild, false);
  // electron-builder always drops a top-level node_modules inside an extraResources source (app-builder-lib
  // util/filter.js createFilter), whatever the filter says: the server's node_modules is its own entry.
  assert.deepEqual(c.extraResources, [
    { from: 'build/server', to: 'server', filter: ['**/*'] },
    { from: 'build/server/node_modules', to: 'server/node_modules', filter: ['**/*'] },
    { from: 'build/node', to: 'node', filter: ['**/*'] },
  ]);
  assert.equal(c.publish, null);
  assert.equal(c.mac.identity, null);
  assert.equal(c.mac.hardenedRuntime, false);
  assert.equal(c.mac.notarize, false);
  assert.ok(!('entitlements' in c.mac) && !('entitlementsInherit' in c.mac));
  assert.deepEqual(c.mac.target, ['dmg', 'zip']);
  assert.equal(c.mac.icon, 'build-resources/icon.png');
  assert.match(c.mac.extendInfo.NSMicrophoneUsageDescription, /microphone/);
  assert.equal(c.mac.extendInfo.CFBundleName, 'Worca', 'the bold menu-bar title');
  assert.equal(c.mac.extendInfo.CFBundleDisplayName, 'Worca');
  assert.equal(c.mac.extendInfo.CFBundleName, c.productName);
  assert.equal(c.mac.extendInfo.CFBundleDisplayName, c.productName);
  assert.deepEqual(c.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  assert.deepEqual(c.nsis, { oneClick: false, perMachine: false });
  assert.deepEqual(c.linux.target, ['AppImage', 'deb']);
  const s = desktopBuilderConfig({ version: '1.0.0', platform: 'mac', arch: 'x64', signed: true, notarize: true });
  assert.ok(!('identity' in JSON.parse(JSON.stringify(s)).mac), 'signed: electron-builder picks the identity');
  assert.deepEqual([s.mac.hardenedRuntime, s.mac.entitlements, s.mac.entitlementsInherit, s.mac.notarize],
    [true, 'build-resources/entitlements.mac.plist', 'build-resources/entitlements.mac.plist', true]);
  assert.deepEqual(desktopBuilderConfig({ version: '1.0.0', platform: 'mac', arch: 'x64', signed: false, notarize: false }),
    desktopBuilderConfig({ version: '1.0.0', platform: 'mac', arch: 'arm64', signed: false, notarize: false }), 'arch-neutral');
});

test('nodeRuntimeAsset: the four pinned targets, official dist URLs; an unpinned target throws', () => {
  const rows = [['mac', 'arm64', 'darwin-arm64', 'tar.gz'], ['mac', 'x64', 'darwin-x64', 'tar.gz'], ['linux', 'x64', 'linux-x64', 'tar.gz'], ['win', 'x64', 'win32-x64', 'zip']];
  for (const [p, a, key, archive] of rows) {
    const asset = nodeRuntimeAsset(RUNTIME, p, a);
    assert.equal(asset.key, key);
    assert.equal(asset.file, RUNTIME.assets[key].file);
    assert.equal(asset.sha256, RUNTIME.assets[key].sha256);
    assert.equal(asset.url, `https://nodejs.org/dist/v${RUNTIME.version}/${asset.file}`);
    assert.equal(asset.archive, archive);
  }
  assert.throws(() => nodeRuntimeAsset(RUNTIME, 'win', 'arm64'), /no pinned Node runtime for win-arm64/);
});

test('node-runtime.json: version >= 22.19.0 and the .nvmrc major; exactly 4 assets with official names and sha256 hex', () => {
  const [maj, min] = RUNTIME.version.split('.').map(Number);
  assert.ok(maj > 22 || (maj === 22 && min >= 19));
  assert.equal(String(maj), NVMRC);
  assert.deepEqual(Object.keys(RUNTIME.assets).sort(), ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']);
  const names = { 'darwin-arm64': 'darwin-arm64.tar.gz', 'darwin-x64': 'darwin-x64.tar.gz', 'linux-x64': 'linux-x64.tar.gz', 'win32-x64': 'win-x64.zip' };
  for (const [k, a] of Object.entries(RUNTIME.assets)) {
    assert.equal(a.file, `node-v${RUNTIME.version}-${names[k]}`);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
  }
});

test('packagedResourcesDir: where electron-builder leaves the unpacked app', () => {
  assert.equal(packagedResourcesDir({ platform: 'mac', arch: 'arm64', distDir: '/d' }), join('/d', 'mac-arm64', 'Worca.app', 'Contents', 'Resources'));
  assert.equal(packagedResourcesDir({ platform: 'mac', arch: 'x64', distDir: '/d' }), join('/d', 'mac', 'Worca.app', 'Contents', 'Resources'));
  assert.equal(packagedResourcesDir({ platform: 'win', arch: 'x64', distDir: '/d' }), join('/d', 'win-unpacked', 'resources'));
  assert.equal(packagedResourcesDir({ platform: 'linux', arch: 'x64', distDir: '/d' }), join('/d', 'linux-unpacked', 'resources'));
});

test('packagedAppPath: mac and mac-arm64 Worca.app', () => {
  assert.equal(packagedAppPath({ arch: 'arm64', distDir: '/d' }), join('/d', 'mac-arm64', 'Worca.app'));
  assert.equal(packagedAppPath({ arch: 'x64', distDir: '/d' }), join('/d', 'mac', 'Worca.app'));
});

test('infoPlistProblems: a Worca plist passes; Electron names, a wrong identifier, a missing icon file and a non-dict each reported', () => {
  const good = { CFBundleName: 'Worca', CFBundleDisplayName: 'Worca', CFBundleIdentifier: 'dev.worca.desktop', CFBundleIconFile: 'icon.icns', CFBundleExecutable: 'Worca' };
  assert.deepEqual(infoPlistProblems(good), []);
  assert.deepEqual(infoPlistProblems({ ...good, CFBundleName: 'Electron' }), ['CFBundleName is "Electron", expected "Worca"']);
  assert.deepEqual(infoPlistProblems({ ...good, CFBundleDisplayName: 'Electron' }), ['CFBundleDisplayName is "Electron", expected "Worca"']);
  assert.deepEqual(infoPlistProblems({ ...good, CFBundleIdentifier: 'com.github.Electron' }), ['CFBundleIdentifier is "com.github.Electron", expected "dev.worca.desktop"']);
  const { CFBundleIconFile, ...noIcon } = good;
  assert.deepEqual(infoPlistProblems(noIcon), ['CFBundleIconFile is missing']);
  assert.deepEqual(infoPlistProblems({ ...good, CFBundleIconFile: '' }), ['CFBundleIconFile is missing']);
  assert.deepEqual(infoPlistProblems({ CFBundleName: 'Electron', CFBundleDisplayName: 'Electron', CFBundleIdentifier: 'com.github.Electron' }), [
    'CFBundleName is "Electron", expected "Worca"',
    'CFBundleDisplayName is "Electron", expected "Worca"',
    'CFBundleIdentifier is "com.github.Electron", expected "dev.worca.desktop"',
    'CFBundleIconFile is missing',
  ]);
  const { CFBundleName, ...noName } = good;
  assert.deepEqual(infoPlistProblems(noName), ['CFBundleName is "undefined", expected "Worca"']);
  for (const bad of [null, undefined, 'x', 3, ['Worca']]) assert.deepEqual(infoPlistProblems(bad), ['Info.plist is not a dictionary'], String(bad));
  assert.deepEqual(infoPlistProblems({ ...good, CFBundleName: 'Other' }, { productName: 'Other' }), [
    'CFBundleDisplayName is "Worca", expected "Other"',
  ]);
});

test('checkPackagedInfoPlist: plutil -convert json of the given plist; a Worca plist returns it; Electron names, a failed or unstartable plutil and bad JSON each throw', () => {
  const good = { CFBundleName: 'Worca', CFBundleDisplayName: 'Worca', CFBundleIdentifier: 'dev.worca.desktop', CFBundleIconFile: 'icon.icns' };
  const calls = [];
  const runWith = (r) => (command, args, opts) => { calls.push([command, args, opts]); return r; };
  assert.deepEqual(checkPackagedInfoPlist({ plistPath: '/d/Worca.app/Contents/Info.plist', run: runWith({ status: 0, stdout: JSON.stringify(good), stderr: '' }) }), good);
  assert.deepEqual(calls, [['plutil', ['-convert', 'json', '-o', '-', '/d/Worca.app/Contents/Info.plist'], { encoding: 'utf8' }]]);
  assert.throws(() => checkPackagedInfoPlist({ plistPath: '/p', run: runWith({ status: 0, stdout: JSON.stringify({ ...good, CFBundleName: 'Electron', CFBundleDisplayName: 'Electron' }) }) }),
    { message: 'Info.plist: CFBundleName is "Electron", expected "Worca"; CFBundleDisplayName is "Electron", expected "Worca"' });
  assert.throws(() => checkPackagedInfoPlist({ plistPath: '/p', run: runWith({ status: 1, stdout: '', stderr: '/p: file does not exist\n' }) }),
    { message: 'Info.plist unreadable: plutil exited with 1: /p: file does not exist' });
  assert.throws(() => checkPackagedInfoPlist({ plistPath: '/p', run: runWith({ status: null, signal: 'SIGKILL', stdout: '' }) }),
    { message: 'Info.plist unreadable: plutil exited with SIGKILL: ' });
  assert.throws(() => checkPackagedInfoPlist({ plistPath: '/p', run: runWith({ status: null, error: new Error('spawnSync plutil ENOENT') }) }),
    { message: 'Info.plist unreadable: spawnSync plutil ENOENT' });
  assert.throws(() => checkPackagedInfoPlist({ plistPath: '/p', run: runWith({ status: 0, stdout: '{not json' }) }), /^Error: Info\.plist unreadable: /);
});

test('builderCommand: absolute projectDir and config, --publish never, --dir only when asked, .cmd + shell on win32', () => {
  const c = builderCommand({ platform: 'mac', arch: 'arm64', dir: false, desktopDir: 'desktop', configPath: 'desktop/build/electron-builder.json', hostPlatform: 'darwin' });
  assert.ok(c.command.endsWith(join('node_modules', '.bin', 'electron-builder')));
  assert.ok(isAbsolute(c.command));
  const i = c.args.indexOf('--projectDir');
  assert.ok(isAbsolute(c.args[i + 1]));
  assert.ok(isAbsolute(c.args[c.args.indexOf('--config') + 1]));
  assert.deepEqual(c.args.slice(4), ['--mac', '--arm64', '--publish', 'never']);
  assert.ok(!c.args.includes('--dir'));
  assert.ok(isAbsolute(c.options.cwd) && c.options.cwd.endsWith('desktop'));
  assert.ok(!c.options.shell);
  const d = builderCommand({ platform: 'linux', arch: 'x64', dir: true, desktopDir: '/r/desktop', configPath: '/r/desktop/build/c.json', hostPlatform: 'linux' });
  assert.deepEqual(d.args.slice(4), ['--linux', '--x64', '--publish', 'never', '--dir']);
  const w = builderCommand({ platform: 'win', arch: 'x64', dir: false, desktopDir: 'C:\\r\\desktop', configPath: 'C:\\r\\desktop\\build\\c.json', hostPlatform: 'win32' });
  assert.match(w.command, /electron-builder\.cmd"?$/);
  assert.equal(w.options.shell, true);
  const sp = builderCommand({ platform: 'win', arch: 'x64', dir: false, desktopDir: '/Users/John Doe/r/desktop', configPath: '/Users/John Doe/r/desktop/build/c.json', hostPlatform: 'win32' });
  assert.match(sp.command, /^".*John Doe.*electron-builder\.cmd"$/, 'a path with a space is quoted for the shell');
  assert.match(sp.args[sp.args.indexOf('--projectDir') + 1], /^".*John Doe.*"$/);
  assert.equal(sp.args[sp.args.indexOf('--publish') + 1], 'never', 'plain words stay unquoted');
});

test('fetchNodeRuntime: bytes whose sha256 differs from the pin → rejects, nothing left at the final path or .part', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'desk-cache-'));
  const outDir = mkdtempSync(join(tmpdir(), 'desk-out-'));
  try {
    const bytes = Buffer.from('not node');
    const got = createHash('sha256').update(bytes).digest('hex');
    const asset = { key: 'darwin-arm64', file: 'node-v24.0.0-darwin-arm64.tar.gz', url: 'https://nodejs.org/dist/v24.0.0/node-v24.0.0-darwin-arm64.tar.gz', sha256: 'a'.repeat(64), archive: 'tar.gz' };
    const urls = [];
    const fetch = async (u) => { urls.push(u); return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }; };
    await assert.rejects(fetchNodeRuntime({ asset, cacheDir, outDir, fetch }),
      new RegExp(`node runtime ${asset.file}: sha256 ${got} does not match the pinned ${'a'.repeat(64)}`));
    assert.deepEqual(urls, [asset.url]);
    assert.equal(existsSync(join(cacheDir, asset.file)), false);
    assert.equal(existsSync(join(cacheDir, `${asset.file}.part`)), false);
    assert.deepEqual(readdirSync(outDir), [], 'no node extracted');
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('desktop/package.json: private, no dependencies, exactly electron + electron-builder pinned exactly, main.mjs', () => {
  const d = JSON.parse(readFileSync(join(ROOT, 'desktop/package.json'), 'utf8'));
  assert.equal(d.private, true);
  assert.equal(d.type, 'module');
  assert.equal(d.main, 'main.mjs');
  assert.equal(d.productName, 'Worca', 'Electron names the app and its userData folder from productName');
  assert.ok(!('dependencies' in d));
  assert.deepEqual(Object.keys(d.devDependencies).sort(), ['electron', 'electron-builder']);
  for (const v of Object.values(d.devDependencies)) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.ok(Number(d.devDependencies.electron.split('.')[0]) >= 28, 'an ESM main needs Electron 28+');
  assert.equal(d.scripts.start, 'node dev/start.mjs', 'npm start runs the dev launcher (the Worca.app copy)');
  assert.ok(existsSync(join(ROOT, 'desktop/dev/start.mjs')));
  const lock = JSON.parse(readFileSync(join(ROOT, 'desktop/package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/electron'].version, d.devDependencies.electron);
  assert.equal(lock.packages['node_modules/electron-builder'].version, d.devDependencies['electron-builder']);
});

test('.gitignore keeps desktop build output out of git', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(gi, /^desktop\/build\/$/m);
  assert.match(gi, /^desktop\/dist\/$/m);
  assert.match(gi, /^desktop\/\.dev-app\/$/m, 'the dev launcher\'s Worca.app copy');
});

test('icon 1024x1024; tray 32x32 and 64x64; the mac entitlements carry what the bundled node needs', () => {
  assert.deepEqual(pngSize(readFileSync(join(ROOT, 'desktop/build-resources/icon.png'))), { width: 1024, height: 1024 });
  assert.deepEqual(pngSize(readFileSync(join(ROOT, 'desktop/assets/tray.png'))), { width: 32, height: 32 });
  assert.deepEqual(pngSize(readFileSync(join(ROOT, 'desktop/assets/tray@2x.png'))), { width: 64, height: 64 });
  const plist = readFileSync(join(ROOT, 'desktop/build-resources/entitlements.mac.plist'), 'utf8');
  for (const k of ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-library-validation', 'com.apple.security.device.audio-input']) {
    assert.ok(plist.includes(`<key>${k}</key>`), k);
  }
});

test('desktop-build workflow: manual only, SHA-pinned, .nvmrc, a timeout, uploads with if-no-files-found error, no release', () => {
  const text = readFileSync(join(ROOT, '.github/workflows/desktop-build.yml'), 'utf8');
  const wf = YAML.parse(text);
  assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch']);
  assert.deepEqual(wf.permissions, { contents: 'read' });
  const job = wf.jobs.build;
  assert.ok(job['timeout-minutes'] > 0);
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix.include.map((m) => `${m.platform}-${m.arch}`), ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64']);
  for (const s of job.steps.filter((x) => x.uses)) assert.match(s.uses, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  const setup = job.steps.find((s) => String(s.uses || '').startsWith('actions/setup-node@'));
  assert.equal(setup.with['node-version-file'], '.nvmrc');
  assert.match(text, /node tools\/build\.mjs --target desktop --platform \$\{\{ matrix\.platform \}\} --arch \$\{\{ matrix\.arch \}\}/);
  const upload = job.steps.find((s) => String(s.uses || '').startsWith('actions/upload-artifact@'));
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.match(upload.with.name, /worca-desktop-\$\{\{ matrix\.platform \}\}-\$\{\{ matrix\.arch \}\}/);
  assert.doesNotMatch(text, /gh release|npm publish|softprops|action-gh-release/);
  const build = job.steps.find((x) => String(x.run || '').includes('tools/build.mjs --target desktop'));
  const macVars = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  for (const k of macVars) assert.match(build.env[k], /^\$\{\{ matrix\.platform == 'mac' && secrets\.\w+ \|\| '' \}\}$/, `${k} reaches mac jobs only`);
  for (const k of ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) assert.match(build.env[k], /^\$\{\{ matrix\.platform == 'win' && secrets\.WIN_CSC_\w+ \|\| '' \}\}$/, `${k} reaches the win job only`);
  assert.deepEqual(Object.keys(build.env).sort(), [...macVars, 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'].sort());
});

// ---- the desktop build steps (fakes for npm and the network; small real tarballs) ----

const PACK_FILES = ['package.json', 'ui/server.mjs', 'extension/dist/chrome/manifest.json', 'extension/dist/edge/manifest.json', 'extension/dist/firefox/manifest.json'];

/** A fake npm: pack writes a real tarball of a tiny package and prints prepack noise + JSON; ci makes node-pty's helper. */
function fakeNpm({ files = PACK_FILES, packStatus = 0, ciStatus = 0 } = {}) {
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (args[0] === 'pack') {
      if (packStatus) return { status: packStatus, stdout: '', stderr: 'npm ERR! pack broke' };
      const dest = args[args.indexOf('--pack-destination') + 1];
      const src = mkdtempSync(join(tmpdir(), 'desk-pkg-'));
      mkdirSync(join(src, 'package', 'ui'), { recursive: true });
      writeFileSync(join(src, 'package', 'package.json'), '{"name":"@worca/app","version":"1.0.0"}');
      writeFileSync(join(src, 'package', 'ui', 'server.mjs'), '// server');
      tar.c({ sync: true, gzip: true, cwd: src, file: join(dest, 'worca-app-1.0.0.tgz') }, ['package']);
      rmSync(src, { recursive: true, force: true });
      const json = JSON.stringify([{ filename: 'worca-app-1.0.0.tgz', files: files.map((path) => ({ path })) }], null, 2);
      return { status: 0, stdout: `built chrome → x\n${json}\n`, stderr: '' };
    }
    if (args[0] === 'ci') {
      if (ciStatus) return { status: ciStatus, stdout: '', stderr: 'gyp ERR!' };
      const d = join(opts.cwd, 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'spawn-helper'), 'bin');
      chmodSync(join(d, 'spawn-helper'), 0o644);
      return { status: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected npm ${args.join(' ')}`);
  };
  return { run, calls };
}

async function withBuildDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'desk-build-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('stageServer: npm pack → check-pack → extract → npm ci --omit=dev; spawn-helper made executable; no signing secret reaches npm', async () => {
  await withBuildDir(async (dir) => {
    const { run, calls } = fakeNpm();
    const env = { PATH: '/bin', CSC_LINK: 'p12', CSC_KEY_PASSWORD: 'pw', APPLE_ID: 'a', WIN_CSC_LINK: 'w' };
    const r = await stageServer({ root: '/repo', stageDir: join(dir, 'stage'), run, env });
    assert.equal(r.serverDir, join(dir, 'server'));
    assert.deepEqual(r.files, PACK_FILES);
    assert.deepEqual(calls.map((c) => c.args[0]), ['pack', 'ci']);
    assert.equal(calls[0].opts.cwd, '/repo');
    assert.deepEqual(calls[1].args, ['ci', '--omit=dev', '--no-audit', '--no-fund']);
    assert.equal(calls[1].opts.cwd, r.serverDir);
    for (const c of calls) {
      assert.equal(c.opts.env.PATH, '/bin');
      for (const k of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'WIN_CSC_LINK']) assert.ok(!(k in c.opts.env), `${k} kept from npm ${c.args[0]}`);
    }
    assert.equal(readFileSync(join(r.serverDir, 'ui', 'server.mjs'), 'utf8'), '// server', 'the tarball is extracted with strip 1');
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(r.serverDir, 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper')).mode & 0o777, 0o755);
    }
  });
});

test('stageServer: a tarball with desktop files or without the extension builds is refused before npm ci runs (I11)', async () => {
  for (const [files, re] of [
    [[...PACK_FILES, 'desktop/main.mjs'], /the package fails check-pack:[\s\S]*desktop\/main\.mjs: desktop build files never ship/],
    [['package.json', 'ui/server.mjs'], /the package fails check-pack:[\s\S]*missing extension\/dist\/chrome\/manifest\.json/],
  ]) {
    await withBuildDir(async (dir) => {
      const { run, calls } = fakeNpm({ files });
      await assert.rejects(stageServer({ root: '/repo', stageDir: join(dir, 'stage'), run, env: {} }), re);
      assert.deepEqual(calls.map((c) => c.args[0]), ['pack'], 'no npm ci');
      assert.equal(existsSync(join(dir, 'server')), false);
    });
  }
});

test('stageServer: a failing npm pack or npm ci rejects with its status and stderr tail', async () => {
  await withBuildDir(async (dir) => {
    await assert.rejects(stageServer({ root: '/repo', stageDir: join(dir, 'stage'), run: fakeNpm({ packStatus: 1 }).run, env: {} }), /npm pack exited with 1: npm ERR! pack broke/);
    await assert.rejects(stageServer({ root: '/repo', stageDir: join(dir, 'stage'), run: fakeNpm({ ciStatus: 7 }).run, env: {} }), /npm ci --omit=dev exited with 7: gyp ERR!/);
  });
});

/** A tiny "node" tar.gz laid out as nodejs.org ships it, and its asset entry. */
function fakeNodeTarball(dir) {
  const top = 'node-v24.0.0-darwin-arm64';
  const src = join(dir, 'src');
  mkdirSync(join(src, top, 'bin'), { recursive: true });
  writeFileSync(join(src, top, 'bin', 'node'), '#!/bin/sh\necho fake\n');
  writeFileSync(join(src, top, 'LICENSE'), 'MIT');
  writeFileSync(join(src, top, 'README.md'), 'not extracted');
  const file = join(dir, `${top}.tar.gz`);
  tar.c({ sync: true, gzip: true, cwd: src, file }, [top]);
  const bytes = readFileSync(file);
  const asset = { key: 'darwin-arm64', file: `${top}.tar.gz`, url: `https://nodejs.org/dist/v24.0.0/${top}.tar.gz`, sha256: createHash('sha256').update(bytes).digest('hex'), archive: 'tar.gz' };
  const fetches = [];
  const fetch = async (u) => { fetches.push(u); return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }; };
  return { asset, fetch, fetches };
}

/** os.tmpdir() follows TMPDIR/TEMP/TMP: point them at a missing folder so any scratch made there fails. */
async function withoutTmpdir(fn) {
  const saved = Object.fromEntries(['TMPDIR', 'TEMP', 'TMP'].map((k) => [k, process.env[k]]));
  for (const k of Object.keys(saved)) process.env[k] = join(tmpdir(), 'desk-no-such-tmp', 'x');
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('fetchNodeRuntime: download, verify, cache; node (0755) + LICENSE only; extracted next to outDir, never in os.tmpdir() (EXDEV)', async () => {
  await withBuildDir(async (dir) => {
    const { asset, fetch, fetches } = fakeNodeTarball(dir);
    const build = join(dir, 'build');
    const cacheDir = join(build, 'cache');
    const outDir = join(build, 'node');
    const r = await withoutTmpdir(() => fetchNodeRuntime({ asset, cacheDir, outDir, fetch }));
    assert.equal(r.nodePath, join(outDir, 'node'));
    assert.deepEqual(fetches, [asset.url]);
    assert.deepEqual(readdirSync(outDir).sort(), ['LICENSE', 'node']);
    assert.match(readFileSync(join(outDir, 'node'), 'utf8'), /echo fake/);
    if (process.platform !== 'win32') assert.equal(statSync(join(outDir, 'node')).mode & 0o777, 0o755);
    assert.deepEqual(readdirSync(build).sort(), ['cache', 'node'], 'the scratch folder is removed');
    assert.deepEqual(readdirSync(cacheDir), [asset.file]);
    // cached and intact: no download
    const again = await fetchNodeRuntime({ asset, cacheDir, outDir, fetch: async () => { throw new Error('no network'); } });
    assert.equal(again.nodePath, join(outDir, 'node'));
    // a cached file that no longer matches the pin is downloaded again
    writeFileSync(join(cacheDir, asset.file), 'corrupt');
    await fetchNodeRuntime({ asset, cacheDir, outDir, fetch });
    assert.equal(fetches.length, 2);
    assert.equal(createHash('sha256').update(readFileSync(join(cacheDir, asset.file))).digest('hex'), asset.sha256);
  });
});

test('fetchNodeRuntime: an HTTP error rejects with its status; nothing cached', async () => {
  await withBuildDir(async (dir) => {
    const asset = { key: 'darwin-arm64', file: 'node-v24.0.0-darwin-arm64.tar.gz', url: 'https://nodejs.org/x', sha256: 'a'.repeat(64), archive: 'tar.gz' };
    await assert.rejects(fetchNodeRuntime({ asset, cacheDir: join(dir, 'c'), outDir: join(dir, 'o'), fetch: async () => ({ ok: false, status: 404 }) }),
      /node runtime node-v24\.0\.0-darwin-arm64\.tar\.gz: download failed \(HTTP 404\)/);
    assert.deepEqual(readdirSync(join(dir, 'c')), []);
  });
});

test('checkSmoke: the server must be @worca/app at the checkout version with the desktop updater reason', () => {
  const health = { name: '@worca/app', version: '1.2.3' };
  assert.deepEqual(checkSmoke({ health, update: { reason: 'desktop' }, want: '1.2.3' }), { version: '1.2.3', updateReason: 'desktop' });
  assert.throws(() => checkSmoke({ health: { name: 'other', version: '1.2.3' }, update: { reason: 'desktop' }, want: '1.2.3' }), /\/api\/health answered \{"name":"other"/);
  assert.throws(() => checkSmoke({ health: { ...health, version: '1.2.2' }, update: { reason: 'desktop' }, want: '1.2.3' }), /the server reports version 1\.2\.2, not 1\.2\.3/);
  assert.throws(() => checkSmoke({ health, update: { reason: 'source' }, want: '1.2.3' }), /\/api\/app\/update reports reason "source", not "desktop"/);
  assert.throws(() => checkSmoke({ health, update: null, want: '1.2.3' }), /reports reason undefined/);
});

test('missingPackagedFiles: the server, its express dependency and the bundled node must be in the packaged app', async () => {
  await withBuildDir(async (res) => {
    const want = [join(res, 'server', 'ui', 'server.mjs'), join(res, 'server', 'node_modules', 'express', 'package.json'), join(res, 'node', 'node')];
    assert.deepEqual(missingPackagedFiles({ res, platform: 'mac' }), want);
    for (const p of want) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, ''); }
    assert.deepEqual(missingPackagedFiles({ res, platform: 'linux' }), []);
    rmSync(join(res, 'server', 'node_modules'), { recursive: true });
    assert.deepEqual(missingPackagedFiles({ res, platform: 'mac' }), [want[1]]);
    assert.deepEqual(missingPackagedFiles({ res, platform: 'win', exists: (p) => !p.endsWith('node.exe') }), [join(res, 'node', 'node.exe')]);
  });
});

test('step: returns the value; a failure prints "<name> failed: …" and exits 1', async () => {
  const lines = [];
  const log = { log: (l) => lines.push(l), error: (l) => lines.push(`ERR ${l}`) };
  const exits = [];
  assert.equal(await step('ok', async () => 5, { exit: (c) => exits.push(c), log }), 5);
  assert.deepEqual(exits, []);
  await step('stage server', async () => { throw new Error('boom'); }, { exit: (c) => exits.push(c), log });
  assert.deepEqual(exits, [1]);
  assert.deepEqual(lines, ['build: ok …', 'build: stage server …', 'ERR build: stage server failed: boom']);
});
