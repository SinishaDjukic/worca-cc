// test/desktop-dev-bundle.test.mjs — the dev launcher's Worca.app copy of the stock Electron.app (desktop/dev/
// dev-bundle.mjs) and the `npm start` CLI (desktop/dev/start.mjs). Fake run/fs everywhere; only the last row, on a Mac
// with desktop/node_modules installed, builds a real bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECIPE, ICON_SIZES, STALE_WORK_MS, bundlePaths, wantedStamp, needsRebuild, bundleCommands, ensureDevBundle, launchPlan } from '../desktop/dev/dev-bundle.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DESK = '/w/desktop';
const STOCK_BIN = '/w/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const ICON = '/w/desktop/build-resources/icon.png';
const ICON_BYTES = Buffer.from('png-bytes');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const under = (p, dir) => p === dir || p.startsWith(dir + sep);

test('bundlePaths: stock app from Contents/MacOS/Electron; everything under desktop/.dev-app; a given workDir holds tmpApp and iconset', () => {
  const p = bundlePaths({ desktopDir: DESK, electronBinary: STOCK_BIN });
  assert.deepEqual(bundlePaths({ desktopDir: DESK, electronBinary: STOCK_BIN, workDir: '/w/desktop/.dev-app/work-AB12' }), {
    ...p,
    workDir: '/w/desktop/.dev-app/work-AB12',
    tmpApp: '/w/desktop/.dev-app/work-AB12/Worca.app',
    iconset: '/w/desktop/.dev-app/work-AB12/worca.iconset',
  });
  assert.deepEqual(p, {
    stockApp: '/w/desktop/node_modules/electron/dist/Electron.app',
    outDir: '/w/desktop/.dev-app',
    workDir: '/w/desktop/.dev-app/work',
    app: '/w/desktop/.dev-app/Worca.app',
    tmpApp: '/w/desktop/.dev-app/work/Worca.app',
    iconset: '/w/desktop/.dev-app/work/worca.iconset',
    stamp: '/w/desktop/.dev-app/stamp.json',
    binary: '/w/desktop/.dev-app/Worca.app/Contents/MacOS/Electron',
  });
});

test('wantedStamp/needsRebuild: missing binary, missing/garbage stamp, other Electron version, other icon bytes, other recipe → rebuild; identical → no rebuild', () => {
  assert.equal(RECIPE, 1);
  const wanted = wantedStamp({ electronVersion: '45.2.3', iconBytes: ICON_BYTES });
  assert.deepEqual(wanted, { recipe: 1, electronVersion: '45.2.3', iconSha256: sha(ICON_BYTES) });
  const text = JSON.stringify(wanted);
  assert.equal(needsRebuild({ stampText: text, wanted, binaryExists: true }), false);
  assert.equal(needsRebuild({ stampText: text, wanted, binaryExists: false }), true, 'missing binary');
  assert.equal(needsRebuild({ stampText: null, wanted, binaryExists: true }), true, 'missing stamp');
  for (const garbage of ['', '{', 'null', '[]', '"x"', '3']) assert.equal(needsRebuild({ stampText: garbage, wanted, binaryExists: true }), true, garbage);
  assert.equal(needsRebuild({ stampText: JSON.stringify({ ...wanted, electronVersion: '46.0.0' }), wanted, binaryExists: true }), true, 'electron');
  assert.equal(needsRebuild({ stampText: JSON.stringify(wantedStamp({ electronVersion: '45.2.3', iconBytes: Buffer.from('other') })), wanted, binaryExists: true }), true, 'icon');
  assert.equal(needsRebuild({ stampText: JSON.stringify({ ...wanted, recipe: 0 }), wanted, binaryExists: true }), true, 'recipe');
  const { iconSha256, ...noIcon } = wanted;
  assert.equal(needsRebuild({ stampText: JSON.stringify(noIcon), wanted, binaryExists: true }), true, 'a key missing');
});

test('bundleCommands: ditto first, 10 sips sizes, iconutil into tmp Resources/worca.icns, three plutil replaces (CFBundleName Worca, CFBundleDisplayName Worca, CFBundleIconFile worca.icns), codesign --force --deep --sign - last; every written path under workDir, the stock app only as ditto\'s source', () => {
  const p = bundlePaths({ desktopDir: DESK, electronBinary: STOCK_BIN });
  const cmds = bundleCommands(p, { iconPath: ICON });
  assert.deepEqual(cmds.map((c) => c.step), ['copy', ...Array(10).fill('icon'), 'icns', 'plist', 'plist', 'plist', 'sign']);
  assert.deepEqual(cmds[0], { step: 'copy', command: 'ditto', args: [p.stockApp, p.tmpApp] });
  assert.deepEqual(ICON_SIZES.map((s) => s.px), [16, 32, 32, 64, 128, 256, 256, 512, 512, 1024]);
  assert.deepEqual(ICON_SIZES.map((s) => s.name), [
    'icon_16x16.png', 'icon_16x16@2x.png', 'icon_32x32.png', 'icon_32x32@2x.png', 'icon_128x128.png',
    'icon_128x128@2x.png', 'icon_256x256.png', 'icon_256x256@2x.png', 'icon_512x512.png', 'icon_512x512@2x.png',
  ]);
  ICON_SIZES.forEach(({ name, px }, i) => {
    assert.deepEqual(cmds[1 + i], { step: 'icon', command: 'sips', args: ['-z', String(px), String(px), ICON, '--out', join(p.iconset, name)] });
  });
  const icns = join(p.tmpApp, 'Contents', 'Resources', 'worca.icns');
  assert.deepEqual(cmds[11], { step: 'icns', command: 'iconutil', args: ['-c', 'icns', p.iconset, '-o', icns] });
  const plist = join(p.tmpApp, 'Contents', 'Info.plist');
  assert.deepEqual(cmds.slice(12, 15).map((c) => [c.command, ...c.args]), [
    ['plutil', '-replace', 'CFBundleName', '-string', 'Worca', plist],
    ['plutil', '-replace', 'CFBundleDisplayName', '-string', 'Worca', plist],
    ['plutil', '-replace', 'CFBundleIconFile', '-string', 'worca.icns', plist],
  ]);
  assert.deepEqual(cmds.at(-1), { step: 'sign', command: 'codesign', args: ['--force', '--deep', '--sign', '-', p.tmpApp] });
  // I4: what each command writes lies under workDir; the stock app is only ditto's source.
  const written = [cmds[0].args[1], ...cmds.slice(1, 11).map((c) => c.args.at(-1)), cmds[11].args.at(-1), ...cmds.slice(12, 15).map((c) => c.args.at(-1)), cmds.at(-1).args.at(-1)];
  for (const w of written) assert.ok(under(w, p.workDir), w);
  cmds.forEach((c, i) => c.args.forEach((a, j) => {
    if (i === 0 && j === 0) return;
    assert.ok(!under(a, p.stockApp), `${c.command} ${a}`);
    assert.ok(!under(a, p.app), `${c.command} never touches the installed app: ${a}`);
  }));
  assert.deepEqual(bundleCommands(p, { iconPath: ICON }), cmds, 'pure');
});

/** A fake fs over a Map of path → content (directories as 'DIR'), recording every op in order. */
function fakeFs(files = {}, { failOn = {}, mtimes = {} } = {}) {
  const tree = new Map(Object.entries(files));
  const mtime = new Map(Object.entries(mtimes));
  const ops = [];
  let seq = 0;
  const maybeFail = (op, p) => { if (failOn[op] && (failOn[op] === true || failOn[op] === p)) throw Object.assign(new Error(`${op} ${p}: EACCES`), { code: 'EACCES' }); };
  const fs = {
    existsSync: (p) => [...tree.keys()].some((k) => under(k, p)),
    readFileSync: (p, enc) => {
      maybeFail('readFileSync', p);
      if (!tree.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      const v = tree.get(p);
      return enc ? String(v) : v;
    },
    writeFileSync: (p, data) => { maybeFail('writeFileSync', p); ops.push(['write', p]); tree.set(p, String(data)); },
    rmSync: (p, o) => { maybeFail('rmSync', p); ops.push(['rm', p, !!(o && o.recursive), !!(o && o.force)]); for (const k of [...tree.keys()]) if (under(k, p)) tree.delete(k); },
    mkdirSync: (p, o) => { maybeFail('mkdirSync', p); ops.push(['mkdir', p, !!(o && o.recursive)]); tree.set(p, 'DIR'); },
    mkdtempSync: (prefix) => { maybeFail('mkdtempSync', prefix); const p = `${prefix}T${++seq}`; ops.push(['mkdtemp', p]); tree.set(p, 'DIR'); mtime.set(p, Date.now()); return p; },
    readdirSync: (dir) => [...new Set([...tree.keys()].filter((k) => k.startsWith(dir + sep)).map((k) => k.slice(dir.length + 1).split(sep)[0]))],
    statSync: (p) => { if (!fs.existsSync(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' }); return { mtimeMs: mtime.get(p) ?? Date.now() }; },
    renameSync: (a, b) => {
      maybeFail('renameSync', a);
      ops.push(['rename', a, b]);
      for (const k of [...tree.keys()]) if (under(k, a)) { tree.set(b + k.slice(a.length), tree.get(k)); tree.delete(k); }
    },
  };
  return { fs, tree, ops };
}

const P = bundlePaths({ desktopDir: DESK, electronBinary: STOCK_BIN });
const WANTED = wantedStamp({ electronVersion: '45.2.3', iconBytes: ICON_BYTES });
// The fake mkdtempSync names the first build's scratch folder <outDir>/work-T1.
const W = join(P.outDir, 'work-T1');
const PW = bundlePaths({ desktopDir: DESK, electronBinary: STOCK_BIN, workDir: W });
const okRun = (log, tree) => (command, args) => {
  log.push([command, ...args]);
  if (command === 'ditto') tree.set(join(args[1], 'Contents', 'MacOS', 'Electron'), 'bin');
  if (command === 'codesign') tree.set(join(args.at(-1), 'SIGNED'), 'yes');
  return { status: 0, stderr: '', error: undefined };
};
const ensure = (fs, run) => ensureDevBundle({ desktopDir: DESK, electronBinary: STOCK_BIN, electronVersion: '45.2.3', iconPath: ICON, run, fs });

test('ensureDevBundle up to date: zero run calls, returns the Worca.app binary, rebuilt false', () => {
  const { fs, ops } = fakeFs({ [ICON]: ICON_BYTES, [P.stamp]: JSON.stringify(WANTED), [P.binary]: 'bin' });
  const runs = [];
  const r = ensure(fs, (...a) => { runs.push(a); return { status: 0 }; });
  assert.deepEqual(r, { binary: P.binary, rebuilt: false });
  assert.deepEqual(runs, []);
  assert.deepEqual(ops, [], 'no writes');
});

test('ensureDevBundle rebuild: stale work-* folders removed, a fresh work-* folder made, commands in order, then stamp removed, old Worca.app removed, tmp renamed, stamp written last, own work folder removed', () => {
  const stale = join(P.outDir, 'work-old');
  const busy = join(P.outDir, 'work-busy');
  const { fs, tree, ops } = fakeFs(
    { [ICON]: ICON_BYTES, [P.stamp]: JSON.stringify({ ...WANTED, electronVersion: '44.0.0' }), [P.binary]: 'old-bin', [stale]: 'DIR', [join(stale, 'x')]: 'x', [busy]: 'DIR', [join(P.outDir, 'workbench')]: 'x' },
    { mtimes: { [stale]: Date.now() - STALE_WORK_MS - 1000, [busy]: Date.now() - 1000, [join(P.outDir, 'workbench')]: 0 } },
  );
  const runs = [];
  const r = ensure(fs, okRun(runs, tree));
  assert.deepEqual(r, { binary: P.binary, rebuilt: true });
  assert.deepEqual(runs, bundleCommands(PW, { iconPath: ICON }).map((c) => [c.command, ...c.args]));
  assert.deepEqual(ops, [
    ['mkdir', P.outDir, true],
    ['rm', stale, true, true],
    ['mkdtemp', W],
    ['mkdir', PW.iconset, true],
    ['rm', P.stamp, false, true],
    ['rm', P.app, true, true],
    ['rename', PW.tmpApp, P.app],
    ['write', P.stamp],
    ['rm', W, true, true],
  ]);
  assert.equal(STALE_WORK_MS, 10 * 60 * 1000);
  assert.ok(fs.existsSync(busy), 'a young work-* folder may be another build in progress: kept');
  assert.ok(fs.existsSync(join(P.outDir, 'workbench')), 'only work-* names are scratch');
  assert.deepEqual(JSON.parse(tree.get(P.stamp)), WANTED);
  assert.equal(tree.get(P.binary), 'bin', 'the new bundle is installed');
  assert.equal(tree.get(join(P.app, 'SIGNED')), 'yes');
  assert.equal(fs.existsSync(W), false);
  // A missing stamp or binary rebuilds too.
  const fresh = fakeFs({ [ICON]: ICON_BYTES });
  assert.equal(ensure(fresh.fs, okRun([], fresh.tree)).rebuilt, true);
  const noBin = fakeFs({ [ICON]: ICON_BYTES, [P.stamp]: JSON.stringify(WANTED) });
  assert.equal(ensure(noBin.fs, okRun([], noBin.tree)).rebuilt, true);
});

test('ensureDevBundle failure at sign: throws DEV_BUNDLE_FAILED step sign with the stderr line; work dir removed; existing Worca.app and stamp untouched', () => {
  const oldStamp = JSON.stringify({ ...WANTED, recipe: 0 });
  const { fs, tree, ops } = fakeFs({ [ICON]: ICON_BYTES, [P.stamp]: oldStamp, [P.binary]: 'old-bin' });
  const runs = [];
  const run = (command, args) => {
    if (command === 'codesign') return { status: 1, stderr: 'warning: x\ncodesign: the bundle is broken\n', error: undefined };
    return okRun(runs, tree)(command, args);
  };
  assert.throws(() => ensure(fs, run), (err) => {
    assert.equal(err.code, 'DEV_BUNDLE_FAILED');
    assert.equal(err.step, 'sign');
    assert.equal(err.message, 'codesign exited 1: codesign: the bundle is broken');
    return true;
  });
  assert.equal(tree.get(P.stamp), oldStamp);
  assert.equal(tree.get(P.binary), 'old-bin');
  assert.equal(fs.existsSync(W), false);
  assert.deepEqual(ops.at(-1), ['rm', W, true, true]);
  assert.ok(!ops.some((o) => o[0] === 'rename' || o[0] === 'write' || (o[0] === 'rm' && (o[1] === P.app || o[1] === P.stamp))));
});

test('ensureDevBundle failure: a spawn error at copy (could not start); an unreadable icon (step stamp, zero run calls)', () => {
  const a = fakeFs({ [ICON]: ICON_BYTES, [P.stamp]: 'old', [P.binary]: 'old-bin' });
  const runs = [];
  assert.throws(() => ensure(a.fs, (command, args) => { runs.push(command); return { status: null, stderr: '', error: new Error('spawnSync ditto ENOENT') }; }), (err) => {
    assert.equal(err.code, 'DEV_BUNDLE_FAILED');
    assert.equal(err.step, 'copy');
    assert.equal(err.message, 'ditto could not start: spawnSync ditto ENOENT');
    return true;
  });
  assert.deepEqual(runs, ['ditto']);
  assert.equal(a.tree.get(P.stamp), 'old');
  assert.equal(a.tree.get(P.binary), 'old-bin');
  assert.equal(a.fs.existsSync(W), false);

  const b = fakeFs({ [P.stamp]: 'old', [P.binary]: 'old-bin' });
  const runsB = [];
  assert.throws(() => ensure(b.fs, (...x) => { runsB.push(x); return { status: 0 }; }), (err) => {
    assert.equal(err.code, 'DEV_BUNDLE_FAILED');
    assert.equal(err.step, 'stamp');
    assert.match(err.message, /ENOENT/);
    return true;
  });
  assert.deepEqual(runsB, []);
  assert.equal(b.tree.get(P.stamp), 'old');

  // A non-zero exit with no stderr still names the command and status.
  const c = fakeFs({ [ICON]: ICON_BYTES });
  assert.throws(() => ensure(c.fs, (command, args) => (command === 'iconutil' ? { status: 2, stderr: '' } : okRun([], c.tree)(command, args))),
    (err) => err.step === 'icns' && /^iconutil exited 2/.test(err.message));

  // A tool ended by a signal (status null) is a failure too, named by its signal.
  const d = fakeFs({ [ICON]: ICON_BYTES, [P.stamp]: 'old', [P.binary]: 'old-bin' });
  assert.throws(() => ensure(d.fs, (command, args) => (command === 'codesign' ? { status: null, signal: 'SIGKILL', stderr: '' } : okRun([], d.tree)(command, args))), (err) => {
    assert.equal(err.step, 'sign');
    assert.equal(err.message, 'codesign exited SIGKILL');
    return true;
  });
  assert.equal(d.tree.get(P.stamp), 'old');
  assert.equal(d.tree.get(P.binary), 'old-bin');

  // The scratch folder cannot be made: step copy, nothing run, the installed copy untouched.
  const e = fakeFs({ [ICON]: ICON_BYTES, [P.stamp]: 'old', [P.binary]: 'old-bin' }, { failOn: { mkdtempSync: true } });
  const runsE = [];
  assert.throws(() => ensure(e.fs, (...x) => { runsE.push(x); return { status: 0 }; }), (err) => err.step === 'copy' && /mkdtempSync .*EACCES/.test(err.message));
  assert.deepEqual(runsE, []);
  assert.equal(e.tree.get(P.stamp), 'old');
  assert.equal(e.tree.get(P.binary), 'old-bin');
});

test('ensureDevBundle failure at install (renameSync throws): step install; no stamp left, so needsRebuild is true', () => {
  const { fs, tree } = fakeFs({ [ICON]: ICON_BYTES, [P.stamp]: 'old', [P.binary]: 'old-bin' }, { failOn: { renameSync: true } });
  assert.throws(() => ensure(fs, okRun([], tree)), (err) => {
    assert.equal(err.code, 'DEV_BUNDLE_FAILED');
    assert.equal(err.step, 'install');
    assert.match(err.message, /renameSync .*EACCES/);
    return true;
  });
  assert.equal(tree.has(P.stamp), false, 'no stamp left');
  assert.equal(fs.existsSync(W), false);
  assert.equal(needsRebuild({ stampText: null, wanted: WANTED, binaryExists: fs.existsSync(P.binary) }), true);
});

test('ensureDevBundle, two builds at once: a second build started during the first one\'s install never touches the first one\'s tmp bundle; the installed copy is the one that was built and signed, under a matching stamp', () => {
  const { fs, tree } = fakeFs({ [ICON]: ICON_BYTES });
  const rmSync = fs.rmSync;
  let raced = false;
  // B runs inside A's removal of the old Worca.app: B makes its scratch folder, ditto half-copies the stock app
  // into it (no Info.plist edits, no signature), and B then fails at the first sips.
  fs.rmSync = (p, o) => {
    rmSync(p, o);
    if (p !== P.app || raced) return;
    raced = true;
    const partial = (command, args) => (command === 'ditto' ? okRun([], tree)(command, args) : { status: 1, stderr: 'sips: interrupted' });
    assert.throws(() => ensure(fs, partial), (err) => err.step === 'icon');
  };
  assert.deepEqual(ensure(fs, okRun([], tree)), { binary: P.binary, rebuilt: true });
  assert.ok(raced);
  assert.equal(tree.get(join(P.app, 'SIGNED')), 'yes', 'the installed copy is the signed one A built');
  assert.equal(tree.get(P.binary), 'bin');
  assert.deepEqual(JSON.parse(tree.get(P.stamp)), WANTED);
  assert.deepEqual(fs.readdirSync(P.outDir).sort(), ['Worca.app', 'stamp.json'], 'both scratch folders removed');
});

test('launchPlan: linux/win32 → stock, no ensure call; WORCA_DESKTOP_DEV_BUNDLE=0 → stock; ensure ok → bundled; ensure throws → stock with the "menu bar will say Electron" warning naming the step', () => {
  let ensures = 0;
  const ok = () => { ensures++; return { binary: P.binary, rebuilt: true }; };
  for (const platform of ['linux', 'win32']) {
    assert.deepEqual(launchPlan({ platform, env: {}, electronBinary: STOCK_BIN, ensure: ok }), { binary: STOCK_BIN, bundled: false, warning: null });
  }
  assert.equal(ensures, 0);
  assert.deepEqual(launchPlan({ platform: 'darwin', env: { WORCA_DESKTOP_DEV_BUNDLE: '0' }, electronBinary: STOCK_BIN, ensure: ok }), { binary: STOCK_BIN, bundled: false, warning: null });
  assert.equal(ensures, 0);
  assert.deepEqual(launchPlan({ platform: 'darwin', env: { WORCA_DESKTOP_DEV_BUNDLE: '1' }, electronBinary: STOCK_BIN, ensure: ok }), { binary: P.binary, bundled: true, warning: null });
  assert.equal(ensures, 1);
  const failing = () => { throw Object.assign(new Error('codesign exited 1: nope'), { code: 'DEV_BUNDLE_FAILED', step: 'sign' }); };
  assert.deepEqual(launchPlan({ platform: 'darwin', env: {}, electronBinary: STOCK_BIN, ensure: failing }), {
    binary: STOCK_BIN,
    bundled: false,
    warning: 'worca desktop: could not build the dev Worca.app (sign): codesign exited 1: nope. Launching the stock Electron.app; the menu bar will say "Electron".',
  });
});

test('start.mjs: importing it spawns nothing; resolveElectron returns null when require throws or returns a non-string; exitCodeFor 0→0, 3→3, signal→1', async () => {
  const { resolveElectron, exitCodeFor } = await import('../desktop/dev/start.mjs');
  const req = (map) => (id) => { if (!(id in map)) throw new Error(`Cannot find module '${id}'`); const v = map[id]; if (v instanceof Error) throw v; return v; };
  assert.deepEqual(resolveElectron(req({ electron: '/e/Electron', 'electron/package.json': { version: '45.2.3' } })), { electronBinary: '/e/Electron', electronVersion: '45.2.3' });
  assert.equal(resolveElectron(req({})), null);
  assert.equal(resolveElectron(req({ electron: new Error('Electron failed to install correctly'), 'electron/package.json': { version: '45.2.3' } })), null);
  assert.equal(resolveElectron(req({ electron: { not: 'a path' }, 'electron/package.json': { version: '45.2.3' } })), null);
  assert.equal(resolveElectron(req({ electron: '', 'electron/package.json': { version: '45.2.3' } })), null);
  assert.equal(resolveElectron(req({ electron: '/e/Electron', 'electron/package.json': {} })), null);
  assert.equal(resolveElectron(req({ electron: '/e/Electron' })), null);
  assert.equal(exitCodeFor({ code: 0, signal: null }), 0);
  assert.equal(exitCodeFor({ code: 3, signal: null }), 3);
  assert.equal(exitCodeFor({ code: null, signal: 'SIGTERM' }), 1);
});

const electronInstalled = existsSync(join(ROOT, 'desktop', 'node_modules', 'electron'));
test('real bundle (darwin, electron installed)', { skip: process.platform !== 'darwin' || !electronInstalled ? 'needs macOS and npm ci --prefix desktop' : false }, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'worca devapp-')));
  try {
    const desktopDir = join(dir, 'desktop');
    mkdirSync(join(desktopDir, 'build-resources'), { recursive: true });
    const iconPath = join(desktopDir, 'build-resources', 'icon.png');
    copyFileSync(join(ROOT, 'desktop', 'build-resources', 'icon.png'), iconPath);
    const req = createRequire(join(ROOT, 'desktop', 'package.json'));
    const electronBinary = req('electron');
    const electronVersion = req('electron/package.json').version;
    const first = ensureDevBundle({ desktopDir, electronBinary, electronVersion, iconPath });
    const p = bundlePaths({ desktopDir, electronBinary });
    assert.deepEqual(first, { binary: p.binary, rebuilt: true });
    const plist = join(p.app, 'Contents', 'Info.plist');
    const extract = (key) => spawnSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).stdout.trim();
    assert.equal(extract('CFBundleName'), 'Worca');
    assert.equal(extract('CFBundleDisplayName'), 'Worca');
    assert.equal(extract('CFBundleIconFile'), 'worca.icns');
    assert.ok(existsSync(join(p.app, 'Contents', 'Resources', 'worca.icns')));
    const verify = spawnSync('codesign', ['--verify', '--deep', p.app], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
    assert.deepEqual(readdirSync(p.outDir).sort(), ['Worca.app', 'stamp.json']);
    assert.equal(existsSync(dirname(electronBinary)), true, 'the stock app is still there');
    assert.deepEqual(ensureDevBundle({ desktopDir, electronBinary, electronVersion, iconPath }), { binary: p.binary, rebuilt: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
