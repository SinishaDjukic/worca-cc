// test/design-watch.test.mjs
// Design P8 Task 4: the work-folder watcher an engine without token streaming draws from (L8.5, L8.23, L8.29). One
// non-recursive watch per folder, a baseline at start, per-path debounce with a hard max wait, and a rescan that
// carries any folder a watch missed. A fake `watchImpl` drives the events; one case runs the real `fs.watch`. Each case
// has its own mkdtemp folder, removed by exact path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkWatcher } from '../src/core/design/watch.mjs';
import { patchFs } from './helpers/fs-gate.mjs';

const POSIX = process.platform !== 'win32';
const ROOT = POSIX && typeof process.getuid === 'function' && process.getuid() === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves once `pred()` is truthy, polling every 5 ms (a ref'd timer); rejects after `ms`. */
async function waitUntil(pred, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    if (pred()) return;
    if (Date.now() >= end) throw new Error(`condition not met within ${ms} ms`);
    await sleep(5);
  }
}

/** A work folder in its own mkdtemp root: `sections/<id>/` for each id. `put` writes a work-relative file. */
function workFolder(t, ids = ['hero']) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-watch-')));
  const locked = [];
  t.after(() => {
    for (const p of locked) { try { chmodSync(p, 0o755); } catch { /* gone */ } }
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const work = join(root, 'work');
  mkdirSync(join(work, 'sections'), { recursive: true });
  for (const id of ids) mkdirSync(join(work, 'sections', id));
  const abs = (rel) => join(work, ...rel.split('/'));
  const put = (rel, text) => { mkdirSync(dirname(abs(rel)), { recursive: true }); writeFileSync(abs(rel), text); };
  return { root, work, abs, put, lock: (rel) => { chmodSync(abs(rel), 0o000); locked.push(abs(rel)); } };
}

/** A fake `fs.watch`: records each call; its handle offers only `.on('error', fn)` and `.close()`. `throwFor(dir)`
 *  returning an error makes that call throw it. */
function fakeWatch({ throwFor = () => null } = {}) {
  const calls = [];
  const impl = (dir, opts, listener) => {
    const err = throwFor(dir);
    if (err) throw err;
    const handle = {
      closed: 0,
      errorFns: [],
      on(event, fn) { if (event === 'error') handle.errorFns.push(fn); return handle; },
      close() { handle.closed += 1; },
    };
    calls.push({ dir, opts, listener, handle });
    return handle;
  };
  /** The latest watch of `dir`. */
  const of = (dir) => calls.filter((c) => c.dir === dir).at(-1);
  return { impl, calls, of };
}

function recorder() {
  const lands = [];
  return { lands, onLand: (rel, o) => { lands.push({ rel, gone: o.gone }); } };
}

test('one watch per folder, never recursive', (t) => {
  const f = workFolder(t);
  const w = fakeWatch();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: () => {}, watchImpl: w.impl });
  watcher.start();
  assert.deepEqual(w.calls.map((c) => c.dir).sort(), [f.work, join(f.work, 'sections'), join(f.work, 'sections', 'hero')].sort());
  for (const c of w.calls) assert.deepEqual(c.opts, { persistent: false }, 'persistent false, and no recursive key');
  assert.equal(watcher.degraded, false);
  watcher.close();
});

test('events: filtered, coalesced', async (t) => {
  const f = workFolder(t);
  const w = fakeWatch();
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand, debounceMs: 20, maxWaitMs: 200, watchImpl: w.impl });
  watcher.start();
  const hero = w.of(join(f.work, 'sections', 'hero'));
  const work = w.of(f.work);
  const sections = w.of(join(f.work, 'sections'));
  f.put('sections/hero/index.html', '<p>a</p>');
  for (let i = 0; i < 10; i++) hero.listener('change', 'index.html');
  // Every one of these exists on disk, so only the filter keeps it from landing.
  f.put('sections/hero/.ctx/tokens.css', 'x');
  f.put('sections/hero/.asks/a.json', '{}');
  f.put('sections/hero/notes.txt', 'n');
  for (const name of ['.ctx', '.asks', 'notes.txt', '../tokens.css']) hero.listener('rename', name);
  for (const rel of ['.crew.json', 'shell.html', 'plan.json', 'assets/att/x.png']) f.put(rel, 'x');
  for (const name of ['.crew.json', 'shell.html', 'plan.json', 'assets']) work.listener('rename', name);
  f.put('sections/con/index.html', '<p>con</p>');
  sections.listener('rename', 'con');
  await sleep(120);
  assert.deepEqual(r.lands, [{ rel: 'sections/hero/index.html', gone: false }]);
  assert.equal(w.calls.some((c) => c.dir.endsWith('con')), false, 'a reserved name gets no watch');
  watcher.close();
  for (const c of w.calls) assert.equal(c.handle.closed, 1, `closed: ${c.dir}`);
});

test('a file written non-stop still lands within the max wait', async (t) => {
  const f = workFolder(t);
  const w = fakeWatch();
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand, debounceMs: 40, maxWaitMs: 100, watchImpl: w.impl });
  watcher.start();
  const hero = w.of(join(f.work, 'sections', 'hero'));
  const t0 = Date.now();
  let i = 0;
  const writer = setInterval(() => { f.put('sections/hero/style.css', `a{}${'x'.repeat(i++)}`); hero.listener('change', 'style.css'); }, 10);
  try {
    await waitUntil(() => r.lands.length > 0, 400);
  } finally {
    clearInterval(writer);
    watcher.close();
  }
  assert.ok(Date.now() - t0 <= 400);
  assert.equal(r.lands[0].rel, 'sections/hero/style.css');
});

test('what the disk does', async (t) => {
  const f = workFolder(t);
  f.put('tokens.css', ':root{}');
  f.put('global.css', 'body{}');
  f.put('sections/hero/index.html', '<p>old</p>');
  const w = fakeWatch();
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand, debounceMs: 20, maxWaitMs: 200, watchImpl: w.impl });
  watcher.start();

  await t.test('files present at start never land (a baseline)', async () => {
    assert.equal(await watcher.rescan(), 0);
    assert.deepEqual(r.lands, []);
  });

  await t.test('a null filename schedules a rescan on a timer, never synchronously', async () => {
    f.put('sections/hero/index.html', '<p>new text</p>');
    w.of(join(f.work, 'sections', 'hero')).listener('rename', null);
    assert.deepEqual(r.lands, [], 'nothing lands inside the event');
    await waitUntil(() => r.lands.length === 1);
    assert.deepEqual(r.lands, [{ rel: 'sections/hero/index.html', gone: false }]);
  });

  await t.test('a new folder reported by the sections watch gets its own watch, and its index.html lands', async () => {
    r.lands.length = 0;
    f.put('sections/feat/index.html', '<p>feat</p>');
    w.of(join(f.work, 'sections')).listener('rename', 'feat');
    assert.ok(w.of(join(f.work, 'sections', 'feat')), 'watched at once');
    await waitUntil(() => r.lands.length === 1);
    assert.deepEqual(r.lands, [{ rel: 'sections/feat/index.html', gone: false }]);
  });

  await t.test('an atomic rename onto global.css lands once', async () => {
    r.lands.length = 0;
    writeFileSync(join(f.work, 'global.css.tmp'), 'body{}');   // same text, same size: the inode tells
    renameSync(join(f.work, 'global.css.tmp'), join(f.work, 'global.css'));
    assert.equal(await watcher.rescan(), 1);
    assert.equal(await watcher.rescan(), 0);
    assert.deepEqual(r.lands, [{ rel: 'global.css', gone: false }]);
  });

  await t.test('a same-size edit with the old mtime lands (ctime is in the fingerprint)', async () => {
    r.lands.length = 0;
    const p = f.abs('tokens.css');
    const SEC = 1_700_000_000;   // a whole second, so the restore below is exact
    utimesSync(p, SEC, SEC);
    assert.equal(await watcher.rescan(), 1, 'a new mtime');
    writeFileSync(p, ':ROOT{}');
    utimesSync(p, SEC, SEC);
    assert.equal(statSync(p).mtimeMs, SEC * 1000, 'same inode, size and mtime as the last landing');
    assert.equal(await watcher.rescan(), 1);
    assert.deepEqual(r.lands, [{ rel: 'tokens.css', gone: false }, { rel: 'tokens.css', gone: false }]);
  });

  await t.test('a link or a FIFO named sections/hero/style.css never lands', { skip: !POSIX }, async () => {
    r.lands.length = 0;
    const hero = w.of(join(f.work, 'sections', 'hero'));
    f.put('elsewhere.css', 'a{}');
    symlinkSync(f.abs('elsewhere.css'), f.abs('sections/hero/style.css'));
    hero.listener('rename', 'style.css');
    await sleep(60);
    assert.equal(await watcher.rescan(), 0);
    unlinkSync(f.abs('sections/hero/style.css'));
    const made = spawnSync('mkfifo', [f.abs('sections/hero/style.css')]);
    assert.equal(made.status, 0, 'mkfifo');
    hero.listener('rename', 'style.css');
    await sleep(60);
    assert.equal(await watcher.rescan(), 0);
    unlinkSync(f.abs('sections/hero/style.css'));
    assert.deepEqual(r.lands, []);
  });

  await t.test('a landed file deleted lands once more with gone, then is forgotten', async () => {
    r.lands.length = 0;
    unlinkSync(f.abs('sections/feat/index.html'));
    assert.equal(await watcher.rescan(), 1);
    assert.deepEqual(r.lands, [{ rel: 'sections/feat/index.html', gone: true }]);
    assert.equal(await watcher.rescan(), 0);
  });

  await t.test('an error event marks the watcher degraded and closes that handle', () => {
    const feat = w.of(join(f.work, 'sections', 'feat'));
    assert.equal(watcher.degraded, false);
    for (const fn of feat.handle.errorFns) fn(Object.assign(new Error('gone'), { code: 'EPERM' }));
    assert.equal(watcher.degraded, true);
    assert.equal(feat.handle.closed, 1);
  });

  await t.test('an unreadable folder is skipped, never gone', { skip: !POSIX || ROOT }, async () => {
    r.lands.length = 0;
    f.put('sections/hero/script.js', 'let a;');
    assert.equal(await watcher.rescan(), 1);
    f.lock('sections/hero');
    assert.equal(await watcher.rescan(), 0);
    chmodSync(f.abs('sections/hero'), 0o755);
    assert.deepEqual(r.lands, [{ rel: 'sections/hero/script.js', gone: false }]);
  });

  watcher.close();
  watcher.close();
  assert.equal(await watcher.rescan(), 0, 'rescan after close resolves 0');
});

test('a watch that throws leaves its folder degraded, and the rescan carries it', async (t) => {
  const f = workFolder(t);
  const hero = join(f.work, 'sections', 'hero');
  const logs = [];
  const w = fakeWatch({ throwFor: (dir) => (dir === hero ? Object.assign(new Error('no space'), { code: 'ENOSPC' }) : null) });
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand, watchImpl: w.impl, log: (m) => logs.push(m) });
  assert.doesNotThrow(() => watcher.start());
  assert.equal(watcher.degraded, true);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /ENOSPC/);
  f.put('sections/hero/index.html', '<p>x</p>');
  assert.equal(await watcher.rescan(), 1);
  assert.deepEqual(r.lands, [{ rel: 'sections/hero/index.html', gone: false }]);
  await watcher.rescan();
  assert.equal(logs.length, 1, 'logged once');
  watcher.close();
});

test('a missing sections/ scans as 0; an onLand that throws is caught', async (t) => {
  const f = workFolder(t, []);
  rmSync(join(f.work, 'sections'), { recursive: true });
  const w = fakeWatch();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: () => { throw new Error('listener'); }, watchImpl: w.impl, log: () => {} });
  watcher.start();
  assert.equal(await watcher.rescan(), 0);
  f.put('tokens.css', ':root{}');
  assert.equal(await watcher.rescan(), 1, 'the throw is caught and the landing counts');
  assert.equal(await watcher.rescan(), 0);
  watcher.close();
});

test('drop closes a section folder\'s watch; a folder recreated under the same id is watched again', async (t) => {
  const f = workFolder(t, ['hero', 'old']);
  const w = fakeWatch();
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand, debounceMs: 20, watchImpl: w.impl });
  watcher.start();
  f.put('sections/old/index.html', '<p>old</p>');
  assert.equal(await watcher.rescan(), 1);
  const old = w.of(join(f.work, 'sections', 'old'));
  watcher.drop('old');
  assert.equal(old.handle.closed, 1, 'closed before the folder goes');
  rmSync(f.abs('sections/old'), { recursive: true, force: true, maxRetries: 10 });
  assert.equal(await watcher.rescan(), 0, 'a dropped folder\'s files send no gone');
  const hero = w.of(join(f.work, 'sections', 'hero'));
  const ino = statSync(f.abs('sections/hero')).ino;
  // The old folder moves aside before the new one is made, so its inode is still taken (ext4 reuses a freed one).
  renameSync(f.abs('sections/hero'), f.abs('sections/aside'));
  mkdirSync(f.abs('sections/hero'));
  rmSync(f.abs('sections/aside'), { recursive: true });
  assert.notEqual(statSync(f.abs('sections/hero')).ino, ino, 'a new inode');
  w.of(join(f.work, 'sections')).listener('rename', 'hero');
  const again = w.of(join(f.work, 'sections', 'hero'));
  assert.notEqual(again, hero, 'watched again');
  assert.equal(hero.handle.closed, 1, 'the dead watch is closed');
  watcher.close();
});

test('rescan during a scan runs once more after it', async (t) => {
  const f = workFolder(t);
  f.put('sections/hero/index.html', '<p>one</p>');   // before start: the baseline
  const lands = [];
  let watcher = null;
  let during = null;
  const onLand = (rel) => {
    lands.push(rel);
    if (during) return;
    // Inside the first scan's landing: a write after that scan read this file, then two more rescans.
    f.put('sections/hero/index.html', '<p>three, longer</p>');
    during = [watcher.rescan(), watcher.rescan()];
  };
  watcher = createWorkWatcher({ workDir: f.work, onLand, watchImpl: fakeWatch().impl });
  watcher.start();
  f.put('sections/hero/index.html', '<p>two!</p>');
  assert.equal(await watcher.rescan(), 1);
  assert.ok(during, 'the second and third rescans ran during the first scan');
  assert.deepEqual(await Promise.all(during), [1, 1], 'both resolve after one follow-up scan');
  assert.deepEqual(lands, ['sections/hero/index.html', 'sections/hero/index.html']);
  watcher.close();
});

test('close drops landings: a debounce pending and a scan in flight land nothing', async (t) => {
  const f = workFolder(t);
  const w = fakeWatch();
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand, debounceMs: 20, watchImpl: w.impl });
  watcher.start();
  f.put('sections/hero/index.html', '<p>x</p>');
  f.put('tokens.css', ':root{}');
  w.of(join(f.work, 'sections', 'hero')).listener('change', 'index.html');
  const scan = watcher.rescan();
  watcher.close();
  const watches = w.calls.length;
  assert.equal(await scan, 0);
  await sleep(80);
  assert.deepEqual(r.lands, []);
  assert.equal(w.calls.length, watches, 'the scan opens no watch after close');
});

test('close while a new section folder\'s lstat is in flight: no watch opens after close', async (t) => {
  const f = workFolder(t);
  const w = fakeWatch();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: () => {}, watchImpl: w.impl });
  watcher.start();
  await watcher.rescan();
  mkdirSync(f.abs('sections/fresh'));
  let reached;
  const at = new Promise((res) => { reached = res; });
  let release;
  const gate = new Promise((res) => { release = res; });
  const restore = patchFs('lstat', (orig) => async (p, ...rest) => {
    if (p === f.abs('sections/fresh')) { reached(); await gate; }
    return orig(p, ...rest);
  });
  try {
    const scan = watcher.rescan();
    await at;
    watcher.close();
    const watches = w.calls.length;
    release();
    assert.equal(await scan, 0);
    assert.equal(w.calls.length, watches, 'no watch of sections/fresh after close');
    assert.equal(w.calls.some((c) => c.dir === f.abs('sections/fresh')), false);
  } finally {
    restore();
  }
});

test('close inside a landing: the rest of that scan lands nothing', async (t) => {
  const f = workFolder(t);
  const lands = [];
  let watcher = null;
  watcher = createWorkWatcher({ workDir: f.work, onLand: (rel) => { lands.push(rel); watcher.close(); }, watchImpl: fakeWatch().impl });
  watcher.start();
  f.put('tokens.css', ':root{}');
  f.put('global.css', 'body{}');
  f.put('sections/hero/index.html', '<p>x</p>');
  assert.equal(await watcher.rescan(), 1);
  assert.equal(lands.length, 1);
});

test('a folder removed whole sends its landed files\' gone; a link planted as a section folder is never followed', { skip: !POSIX }, async (t) => {
  const f = workFolder(t, ['hero', 'feat']);
  const w = fakeWatch();
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand, debounceMs: 20, watchImpl: w.impl });
  watcher.start();
  f.put('sections/feat/index.html', '<p>feat</p>');
  assert.equal(await watcher.rescan(), 1);
  rmSync(f.abs('sections/feat'), { recursive: true });
  assert.equal(await watcher.rescan(), 1);
  assert.deepEqual(r.lands.at(-1), { rel: 'sections/feat/index.html', gone: true });
  r.lands.length = 0;
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'index.html'), '<p>outside</p>');
  symlinkSync(outside, f.abs('sections/evil'));
  w.of(join(f.work, 'sections')).listener('rename', 'evil');
  assert.equal(w.calls.some((c) => c.dir.endsWith('evil')), false, 'a link gets no watch');
  await sleep(60);
  assert.equal(await watcher.rescan(), 0);
  assert.deepEqual(r.lands, []);
  watcher.close();
});

test('the real fs.watch, on this OS', async (t) => {
  const f = workFolder(t);
  const r = recorder();
  const watcher = createWorkWatcher({ workDir: f.work, onLand: r.onLand });
  watcher.start();
  f.put('tokens.css', ':root{--a:1}');
  f.put('sections/hero/index.html', '<section data-section="hero"><p>x</p></section>');
  const both = () => ['tokens.css', 'sections/hero/index.html'].every((rel) => r.lands.some((l) => l.rel === rel && !l.gone));
  try {
    await waitUntil(both, 1500);
  } catch {
    await watcher.rescan();   // a filesystem that reports nothing: the rescan carries it
  }
  assert.ok(both(), JSON.stringify(r.lands));
  watcher.close();
  rmSync(f.work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  assert.deepEqual(readdirSync(f.root), []);
});

test('the probe tool', async (t) => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'worca-watch-probe-test-')));
  t.after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const printed = [];
  const saved = console.log;
  console.log = (...a) => printed.push(a.join(' '));
  let mod;
  try {
    mod = await import('../tools/design-watch-probe.mjs');
  } finally {
    console.log = saved;
  }
  assert.deepEqual(printed, [], 'importing the module runs nothing');
  assert.deepEqual(readdirSync(tmp), []);
  const log = [];
  assert.equal(await mod.main([], { log: (m) => log.push(m) }), 2);
  const out = [];
  assert.equal(await mod.main(['--dir', tmp], { log: (m) => out.push(m) }), 0);
  const report = JSON.parse(out.find((m) => m.trimStart().startsWith('{')));
  assert.deepEqual(report.missed, []);
  for (const k of ['fsWatch', 'byEvent', 'byRescan', 'maxLagMs']) assert.ok(k in report, k);
  assert.equal(report.byEvent + report.byRescan, 3);
  assert.deepEqual(readdirSync(tmp), [], 'it removed exactly its folder');
});
