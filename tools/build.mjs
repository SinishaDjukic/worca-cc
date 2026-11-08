#!/usr/bin/env node
// tools/build.mjs — build worca for a target (docs/desktop.md).
//   node tools/build.mjs                         # --target web (default): the npm package's prepack step, nothing else
//   node tools/build.mjs --target desktop        # the Electron app for this machine's platform and arch → desktop/dist/
//   node tools/build.mjs --target desktop --dir  # unpacked app only, no installers
//   node tools/build.mjs --target desktop --no-smoke
// Desktop steps: npm pack this checkout → check-pack → npm ci --omit=dev into desktop/build/server; the pinned Node
// (desktop/node-runtime.json, sha256-checked) into desktop/build/node; a smoke run of that server; electron-builder;
// the same smoke against the packaged app. Builds run on the target platform and arch only (node-pty is native).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as tar from 'tar';
import { checkPackFiles, packJsonPaths } from './check-pack.mjs';
import { buildServerEnv, startServer, stopServer } from '../desktop/src/server-process.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = join(ROOT, 'desktop');
const BUILD = join(DESKTOP, 'build');
const DIST = join(DESKTOP, 'dist');

export const TARGETS = ['web', 'desktop'];
export const DESKTOP_PLATFORMS = ['mac', 'win', 'linux'];   // electron-builder names
export const DESKTOP_ARCHES = ['x64', 'arm64'];
const USAGE = 'usage: build.mjs [--target web|desktop] [--platform mac|win|linux] [--arch x64|arm64] [--dir] [--no-smoke]';
const NODE_PLATFORM = { mac: 'darwin', win: 'win32', linux: 'linux' };
const UNSUPPORTED = new Set(['win-arm64', 'linux-arm64']);
const SIGNING_VARS = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];

const readNvmrc = () => { try { return readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim(); } catch { return ''; } };
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function parseArgs(argv) {
  const o = { target: 'web', platform: null, arch: null, dir: false, smoke: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') { const v = argv[++i]; if (!TARGETS.includes(v)) { console.error(`unknown target: ${v}`); process.exit(2); } o.target = v; }
    else if (a === '--platform') { const v = argv[++i]; if (!DESKTOP_PLATFORMS.includes(v)) { console.error(`unknown platform: ${v}`); process.exit(2); } o.platform = v; }
    else if (a === '--arch') { const v = argv[++i]; if (!DESKTOP_ARCHES.includes(v)) { console.error(`unknown arch: ${v}`); process.exit(2); } o.arch = v; }
    else if (a === '--dir') o.dir = true;
    else if (a === '--no-smoke') o.smoke = false;
    else if (a === '--help') { console.log(USAGE); process.exit(0); }
    else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  return o;
}

export function hostDesktopPlatform(nodePlatform) {
  return { darwin: 'mac', win32: 'win', linux: 'linux' }[nodePlatform] || null;
}

/** The platform and arch a desktop build makes: the flags, else this machine's. */
function desktopTarget(o, host) {
  return { platform: o.platform || hostDesktopPlatform(host.platform), arch: o.arch || host.arch };
}

/** Why this build must not run (main prints it and exits 2), or null. */
export function buildRefusal(o, host = { platform: process.platform, arch: process.arch, nodeVersion: process.versions.node, nvmrc: readNvmrc() }) {
  if (o.target === 'web') {
    return o.platform || o.arch || o.dir || o.smoke === false ? '--platform, --arch, --dir and --no-smoke apply to --target desktop only' : null;
  }
  const hostPlatform = hostDesktopPlatform(host.platform);
  const { platform, arch } = desktopTarget(o, host);
  if (!hostPlatform) return `desktop builds run on macOS, Windows or Linux, not ${host.platform}`;
  if (!platform || platform !== hostPlatform) return `desktop builds run on the target platform: build ${platform} on a ${platform} machine (node-pty is native)`;
  if (arch !== host.arch) return `desktop builds run on the target arch: build ${arch} on an ${arch} machine (node-pty is native)`;
  if (!DESKTOP_ARCHES.includes(arch) || UNSUPPORTED.has(`${platform}-${arch}`)) return `${platform} ${arch} is not a supported desktop target`;
  const want = String(host.nvmrc || '').split('.')[0];
  if (String(host.nodeVersion).replace(/^v/, '').split('.')[0] !== want) {
    return `the desktop build installs node-pty for Node ${host.nvmrc}: run it with Node ${host.nvmrc}.x (this is ${host.nodeVersion})`;
  }
  return null;
}

/** --target web: exactly what `prepack` runs. */
export function planWebBuild() {
  return [{ command: process.execPath, args: [join(ROOT, 'tools/build-extension.mjs'), '--pack'] }];
}

export function nodeRuntimeAsset(runtime, platform, arch) {
  const key = `${NODE_PLATFORM[platform] || platform}-${arch}`;
  const entry = runtime && runtime.assets && Object.hasOwn(runtime.assets, key) ? runtime.assets[key] : null;
  if (!entry) throw new Error(`no pinned Node runtime for ${platform}-${arch}`);
  return { key, file: entry.file, url: `https://nodejs.org/dist/v${runtime.version}/${entry.file}`, sha256: entry.sha256, archive: entry.file.endsWith('.zip') ? 'zip' : 'tar.gz' };
}

/** The env minus every signing secret: npm, install scripts and the smoke's server never need them. */
export function withoutSigning(env) {
  const out = { ...env };
  for (const k of SIGNING_VARS) delete out[k];
  return out;
}

/** Signing turns on only when its vars are present (non-blank). Blank vars are deleted: electron-builder treats an
 *  empty CSC_LINK as set. Unsigned builds never pick up a keychain identity silently. Windows signs with WIN_CSC_* only:
 *  CSC_* is the Apple certificate, and electron-builder would read it on Windows, so it is removed there. */
export function signingEnv(env, platform) {
  const out = { ...env };
  for (const k of SIGNING_VARS) if (k in out && !String(out[k] ?? '').trim()) delete out[k];
  const has = (...ks) => ks.every((k) => String(out[k] ?? '').trim() !== '');
  let signed = false;
  let notarize = false;
  if (platform === 'mac') {
    signed = has('CSC_LINK', 'CSC_KEY_PASSWORD');
    notarize = signed && (has('APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER') || has('APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'));
  } else if (platform === 'win') {
    delete out.CSC_LINK;
    delete out.CSC_KEY_PASSWORD;
    signed = has('WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD');
  }
  if (!signed) out.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  return { env: out, signed, notarize };
}

/** The electron-builder config (arch-neutral: arch only picks the CLI flag). */
export function desktopBuilderConfig({ version, platform, arch, signed, notarize }) {
  const entitlements = signed ? 'build-resources/entitlements.mac.plist' : undefined;
  return {
    appId: 'dev.worca.desktop',
    productName: 'Worca',
    extraMetadata: { version },
    directories: { output: 'dist', buildResources: 'build-resources' },
    files: ['main.mjs', 'preload.cjs', 'src/**', 'assets/**', 'package.json'],
    asar: true,
    npmRebuild: false,
    // electron-builder always drops a top-level node_modules inside an extraResources source (app-builder-lib
    // util/filter.js createFilter), whatever the filter: the server's node_modules is copied as its own entry.
    extraResources: [
      { from: 'build/server', to: 'server', filter: ['**/*'] },
      { from: 'build/server/node_modules', to: 'server/node_modules', filter: ['**/*'] },
      { from: 'build/node', to: 'node', filter: ['**/*'] },
    ],
    mac: {
      target: ['dmg', 'zip'],
      category: 'public.app-category.developer-tools',
      icon: 'build-resources/icon.icns',
      // CFBundleName is the bold menu-bar title; electron-builder derives both names from productName, the explicit
      // keys make this config the one testable source (extendInfo is merged last).
      extendInfo: { NSMicrophoneUsageDescription: 'Worca uses the microphone for voice input in chat.', CFBundleName: 'Worca', CFBundleDisplayName: 'Worca' },
      identity: signed ? undefined : null,
      hardenedRuntime: !!signed,
      ...(signed ? { entitlements, entitlementsInherit: entitlements } : {}),
      notarize: !!notarize,
    },
    // The icons (and build-resources/icon.png) are generated from build-resources/logo.png by tools/desktop-icons.mjs (committed; --check verifies).
    win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'build-resources/icon.ico' },
    nsis: { oneClick: false, perMachine: false, installerIcon: 'build-resources/icon.ico', uninstallerIcon: 'build-resources/icon.ico' },
    linux: { target: ['AppImage', 'deb'], category: 'Development', maintainer: 'Sinisha Djukic', icon: 'build-resources/icons' },
    publish: null,
  };
}

const winQuote = (s) => (/\s/.test(s) ? `"${s}"` : s);

export function builderCommand({ platform, arch, dir, desktopDir, configPath, hostPlatform = process.platform }) {
  const projectDir = resolve(desktopDir);
  const win = hostPlatform === 'win32';
  const bin = join(projectDir, 'node_modules', '.bin', win ? 'electron-builder.cmd' : 'electron-builder');
  const args = ['--projectDir', projectDir, '--config', resolve(configPath), `--${platform}`, `--${arch}`, '--publish', 'never'];
  if (dir) args.push('--dir');
  return { command: win ? winQuote(bin) : bin, args: win ? args.map(winQuote) : args, options: { cwd: projectDir, shell: win, stdio: 'inherit' } };
}

/** The unpacked mac app electron-builder leaves in distDir. */
export function packagedAppPath({ arch, distDir }) {
  return join(distDir, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Worca.app');
}

export function packagedResourcesDir({ platform, arch, distDir }) {
  if (platform === 'mac') return join(packagedAppPath({ arch, distDir }), 'Contents', 'Resources');
  if (platform === 'win') return join(distDir, 'win-unpacked', 'resources');
  return join(distDir, 'linux-unpacked', 'resources');
}

/** What is wrong with a built Worca.app's Info.plist (parsed to an object); [] when the app is named right. */
export function infoPlistProblems(plist, { productName = 'Worca', appId = 'dev.worca.desktop' } = {}) {
  if (!plist || typeof plist !== 'object' || Array.isArray(plist)) return ['Info.plist is not a dictionary'];
  const problems = [];
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    if (plist[key] !== productName) problems.push(`${key} is "${plist[key]}", expected "${productName}"`);
  }
  if (plist.CFBundleIdentifier !== appId) problems.push(`CFBundleIdentifier is "${plist.CFBundleIdentifier}", expected "${appId}"`);
  if (typeof plist.CFBundleIconFile !== 'string' || !plist.CFBundleIconFile) problems.push('CFBundleIconFile is missing');
  return problems;
}

/** Read a built Worca.app's Info.plist with plutil and check it names the app right: returns the parsed plist, or
 *  throws "Info.plist unreadable: …" or "Info.plist: <problems>". */
export function checkPackagedInfoPlist({ plistPath, run = spawnSync }) {
  const r = run('plutil', ['-convert', 'json', '-o', '-', plistPath], { encoding: 'utf8' });
  let plist;
  try {
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`plutil exited with ${r.status ?? r.signal}: ${String(r.stderr || '').trim()}`);
    plist = JSON.parse(r.stdout);
  } catch (err) {
    throw new Error(`Info.plist unreadable: ${err && err.message ? err.message : err}`);
  }
  const problems = infoPlistProblems(plist);
  if (problems.length) throw new Error(`Info.plist: ${problems.join('; ')}`);
  return plist;
}

/** `npm pack --json` prints prepack's own output on stdout first: the JSON is the array that starts a line. */
export function packJsonFromStdout(stdout) {
  const text = String(stdout || '');
  const at = text.search(/^\[/m);
  if (at < 0) throw new Error('npm pack printed no JSON');
  return text.slice(at).trim();
}

const defaultRun = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 1 << 28, ...opts });
const runFailed = (what, r) => new Error(`${what} exited with ${r.status ?? r.signal ?? r.error?.message}${r.stderr ? `: ${String(r.stderr).trim().split('\n').slice(-10).join('\n')}` : ''}`);

/** npm pack this checkout, check its file list, install it with production deps into <stageDir>/../server. npm and
 *  every dependency's install script run without the signing secrets. */
export async function stageServer({ root = ROOT, stageDir, run = defaultRun, env = process.env }) {
  const npmEnv = withoutSigning(env);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  const dest = process.platform === 'win32' ? winQuote(stageDir) : stageDir;   // defaultRun goes through cmd on win32
  const pack = run(npmCmd, ['pack', '--json', '--pack-destination', dest], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], env: npmEnv });
  if (pack.status !== 0) throw runFailed('npm pack', pack);
  const json = packJsonFromStdout(pack.stdout);
  const files = packJsonPaths(json);
  const problems = checkPackFiles(files, { requireExtension: true });
  if (problems.length) throw new Error(`the package fails check-pack:\n  ${problems.join('\n  ')}`);
  const entry = [].concat(JSON.parse(json))[0];
  const tarball = join(stageDir, entry.filename);
  const serverDir = join(dirname(stageDir), 'server');
  rmSync(serverDir, { recursive: true, force: true });
  mkdirSync(serverDir, { recursive: true });
  await tar.x({ file: tarball, cwd: serverDir, strip: 1 });
  const ci = run(npmCmd, ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: serverDir, stdio: 'inherit', env: npmEnv });
  if (ci.status !== 0) throw runFailed('npm ci --omit=dev', ci);
  // ensureSpawnHelper (src/core/terminal/pty.mjs) chmods this at runtime; do it now, so it never writes inside an
  // installed (possibly signed) bundle.
  const prebuilds = join(serverDir, 'node_modules', 'node-pty', 'prebuilds');
  if (existsSync(prebuilds)) {
    for (const d of readdirSync(prebuilds)) {
      const helper = join(prebuilds, d, 'spawn-helper');
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  }
  return { serverDir, tarball, files };
}

const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

/** The pinned Node: downloaded once into cacheDir (verified before it gets its final name), then node + LICENSE. */
export async function fetchNodeRuntime({ asset, cacheDir, outDir, fetch = globalThis.fetch }) {
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, asset.file);
  if (existsSync(cached) && sha256Of(readFileSync(cached)) !== asset.sha256) rmSync(cached, { force: true });
  if (!existsSync(cached)) {
    const part = `${cached}.part`;
    rmSync(part, { force: true });
    const r = await fetch(asset.url);
    if (!r || !r.ok) throw new Error(`node runtime ${asset.file}: download failed (HTTP ${r && r.status})`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const got = sha256Of(bytes);
    if (got !== asset.sha256) throw new Error(`node runtime ${asset.file}: sha256 ${got} does not match the pinned ${asset.sha256}`);
    writeFileSync(part, bytes);
    renameSync(part, cached);
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const top = asset.file.replace(/\.(tar\.gz|zip)$/, '');
  // Next to outDir, so every rename below stays on one filesystem (a tmpfs /tmp, or TEMP on another drive: EXDEV).
  const scratch = mkdtempSync(join(dirname(outDir), '.node-x-'));
  try {
    let binary;
    if (asset.archive === 'zip') {
      // Windows: the system tar (bsdtar) reads zip files; a bare `tar` on PATH can be Git's GNU tar, which cannot.
      const systemTar = join(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'tar.exe');
      const r = spawnSync(systemTar, ['-xf', cached, '-C', scratch, `${top}/node.exe`, `${top}/LICENSE`], { encoding: 'utf8', env: withoutSigning(process.env) });
      if (r.status !== 0) throw new Error(`node runtime ${asset.file}: tar exited with ${r.status}: ${r.stderr}`);
      binary = 'node.exe';
      renameSync(join(scratch, top, 'node.exe'), join(outDir, 'node.exe'));
    } else {
      await tar.x({ file: cached, cwd: scratch, filter: (p) => p === `${top}/bin/node` || p === `${top}/LICENSE` });
      binary = 'node';
      renameSync(join(scratch, top, 'bin', 'node'), join(outDir, 'node'));
      chmodSync(join(outDir, 'node'), 0o755);
    }
    renameSync(join(scratch, top, 'LICENSE'), join(outDir, 'LICENSE'));
    return { nodePath: join(outDir, binary) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The smoke's verdict on the answers of /api/health and /api/app/update; throws on the first mismatch. */
export function checkSmoke({ health, update, want }) {
  if (!health || health.name !== '@worca/app') throw new Error(`/api/health answered ${JSON.stringify(health)}`);
  if (health.version !== want) throw new Error(`the server reports version ${health.version}, not ${want}`);
  const reason = update ? update.reason : undefined;
  if (reason !== 'desktop') throw new Error(`/api/app/update reports reason ${JSON.stringify(reason)}, not "desktop"`);
  return { version: health.version, updateReason: reason };
}

const SMOKE_FETCH_MS = 15000;

/** Start the server with that node exactly as the desktop app does, check it, stop it. */
export async function smokeServer({ nodePath, serverDir, timeoutMs = 90000 }) {
  const want = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const home = mkdtempSync(join(tmpdir(), 'worca-smoke-home-'));
  const wh = mkdtempSync(join(tmpdir(), 'worca-smoke-store-'));
  const storeDir = join(wh, '.worca-cc');
  const base = {};
  for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'LANG']) if (process.env[k] !== undefined) base[k] = process.env[k];
  const env = buildServerEnv({ baseEnv: { ...base, WORCA_MOCK: '1', HOME: home, USERPROFILE: home, WORCA_HOME: wh }, loginPath: null, port: 0, platform: process.platform });
  let handle = null;
  try {
    try {
      handle = await startServer({ runtime: { nodePath, serverRoot: serverDir }, env, logStream: null, home, readyTimeoutMs: timeoutMs });
    } catch (err) {
      throw new Error(`${err.message}${err.stderrTail ? `\n${String(err.stderrTail).trim().split('\n').slice(-20).join('\n')}` : ''}`);
    }
    const health = await (await fetch(`${handle.url}/api/health`, { signal: AbortSignal.timeout(SMOKE_FETCH_MS) })).json();
    const update = await (await fetch(`${handle.url}/api/app/update`, { signal: AbortSignal.timeout(SMOKE_FETCH_MS) })).json();
    const verdict = checkSmoke({ health, update, want });
    for (let i = 0; i < 200 && !existsSync(join(storeDir, 'ui.json')); i++) await new Promise((r) => setTimeout(r, 50));
    return verdict;
  } finally {
    if (handle) await stopServer(handle, { storeDir });
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
    rmSync(wh, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** The files the packaged smoke needs before it starts the packaged server; [] when all are there. */
export function missingPackagedFiles({ res, platform, exists = existsSync }) {
  const node = join(res, 'node', platform === 'win' ? 'node.exe' : 'node');
  return [join(res, 'server', 'ui', 'server.mjs'), join(res, 'server', 'node_modules', 'express', 'package.json'), node].filter((p) => !exists(p));
}

/** Run one build step; a failure prints "build: <name> failed: …" and exits 1. */
export async function step(name, fn, { exit = process.exit, log = console } = {}) {
  log.log(`build: ${name} …`);
  try {
    return await fn();
  } catch (err) {
    log.error(`build: ${name} failed: ${err && err.message ? err.message : err}`);
    exit(1);
  }
}

async function buildDesktop(o) {
  const { platform, arch } = desktopTarget(o, { platform: process.platform, arch: process.arch });
  const cmd = builderCommand({ platform, arch, dir: o.dir, desktopDir: DESKTOP, configPath: join(BUILD, 'electron-builder.json') });
  const builderBin = cmd.command.replace(/^"|"$/g, '');
  await step('electron-builder check', () => { if (!existsSync(builderBin)) throw new Error('run npm ci --prefix desktop first'); });
  const { serverDir } = await step('stage server', () => stageServer({ root: ROOT, stageDir: join(BUILD, 'stage') }));
  const { nodePath } = await step('node runtime', () => {
    const asset = nodeRuntimeAsset(JSON.parse(readFileSync(join(DESKTOP, 'node-runtime.json'), 'utf8')), platform, arch);
    return fetchNodeRuntime({ asset, cacheDir: join(BUILD, 'cache'), outDir: join(BUILD, 'node') });
  });
  if (o.smoke) await step('smoke (staged)', async () => { const r = await smokeServer({ nodePath, serverDir }); console.log(`build: staged server ${r.version} answered, updater reason ${r.updateReason}`); });
  const signing = signingEnv(process.env, platform);
  await step('electron-builder config', () => {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    writeFileSync(join(BUILD, 'electron-builder.json'), `${JSON.stringify(desktopBuilderConfig({ version, platform, arch, signed: signing.signed, notarize: signing.notarize }), null, 2)}\n`);
    console.log(`build: ${signing.signed ? `signed${signing.notarize ? ' and notarized' : ''}` : 'unsigned'} ${platform} ${arch}${o.dir ? ' (unpacked app only)' : ''}`);
  });
  await step('electron-builder', () => {
    if (!existsSync(builderBin)) throw new Error('run npm ci --prefix desktop first');
    rmSync(DIST, { recursive: true, force: true });
    const r = spawnSync(cmd.command, cmd.args, { ...cmd.options, env: signing.env });
    if (r.status !== 0) throw new Error(`electron-builder exited with ${r.status ?? r.signal ?? r.error?.message}`);
  });
  if (platform === 'mac') {
    await step('Info.plist', () => {
      const plist = checkPackagedInfoPlist({ plistPath: join(packagedAppPath({ arch, distDir: DIST }), 'Contents', 'Info.plist') });
      console.log(`build: Info.plist names the app ${plist.CFBundleName} (${plist.CFBundleIdentifier})`);
    });
  }
  if (o.smoke) {
    await step('smoke (packaged)', async () => {
      const res = packagedResourcesDir({ platform, arch, distDir: DIST });
      const missing = missingPackagedFiles({ res, platform });
      if (missing.length) throw new Error(`the packaged app lacks ${missing.join(', ')}`);
      const r = await smokeServer({ nodePath: join(res, 'node', platform === 'win' ? 'node.exe' : 'node'), serverDir: join(res, 'server') });
      console.log(`build: packaged server ${r.version} answered, updater reason ${r.updateReason}`);
    });
  }
  console.log(`build: done → ${DIST}`);
}

// realpath, as import.meta.url is: a symlinked checkout or tools dir must still run the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const o = parseArgs(process.argv.slice(2));
  const refusal = buildRefusal(o);
  if (refusal) { console.error(refusal); process.exit(2); }
  if (o.target === 'web') {
    for (const s of planWebBuild()) {
      const r = spawnSync(s.command, s.args, { stdio: 'inherit', cwd: ROOT });
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
    process.exit(0);
  }
  await buildDesktop(o);
}
