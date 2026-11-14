#!/usr/bin/env node
// tools/design-watch-probe.mjs
// R14 (Design P8 Task 4): does the design file watcher land files on this filesystem, and how fast? It makes its own
// folder `worca-watch-probe-XXXXXX/` under --dir (mkdtemp), lays out a work folder there (work/, work/sections/a/),
// starts `createWorkWatcher` on it, then writes tokens.css, sections/a/index.html and, in a folder made after the
// start, sections/b-new/style.css, 200 ms apart. A file the watcher's events land counts in `byEvent`, with its lag
// from the write (`maxLagMs`, the largest); after a settle time one `rescan()` lands what the events missed
// (`byRescan`, the build's re-read at every tool result and agent exit); a file neither landed is in `missed`.
// `fsWatch` is `ok` when every folder's watch opened and stayed open, else `degraded` (the rescan carries those).
// `--unreadable` (POSIX) also makes a mode-000 sections/locked/ mid-probe: `unreadable` reports that the process
// lived on (as root mode 000 locks nothing, so the run says it proves nothing). No model, no network, no cost.
//
//   node tools/design-watch-probe.mjs --dir <folder> [--unreadable]
//
// It prints the report as JSON and removes exactly its own folder. Exit: 0 nothing missed; 1 a file was missed;
// 2 usage (no --dir, or not a folder).
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createWorkWatcher } from '../src/core/design/watch.mjs';

/** The files the probe writes, in order, 200 ms apart; the last one in a folder made after the watcher started. */
const FILES = Object.freeze(['tokens.css', 'sections/a/index.html', 'sections/b-new/style.css']);
const GAP_MS = 200;
/** How long after the last write the events get before the rescan: the watcher's max wait (1 s) and some slack. */
const SETTLE_MS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));   // ref'd: the watches are not persistent

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  let o;
  try {
    o = parseArgs({ args: argv, options: { dir: { type: 'string' }, unreadable: { type: 'boolean', default: false } } }).values;
  } catch (err) { log(err.message); return 2; }
  if (!o.dir) { log('usage: node tools/design-watch-probe.mjs --dir <folder> [--unreadable]'); return 2; }
  let base;
  try {
    base = realpathSync(o.dir);
    if (!statSync(base).isDirectory()) throw new Error('not a folder');
  } catch { log(`--dir ${o.dir} is not a folder`); return 2; }

  const root = mkdtempSync(join(base, 'worca-watch-probe-'));
  const work = join(root, 'work');
  const locked = join(work, 'sections', 'locked');
  const abs = (rel) => join(work, ...rel.split('/'));
  let watcher = null;
  let lockedMade = false;
  try {
    mkdirSync(join(work, 'sections', 'a'), { recursive: true });
    const writtenAt = new Map();
    const byEventAt = new Map();
    const byRescan = new Set();
    let scanning = false;
    const warnings = [];
    watcher = createWorkWatcher({
      workDir: work,
      onLand: (rel, { gone }) => {
        if (gone || !writtenAt.has(rel) || byEventAt.has(rel)) return;
        if (scanning) byRescan.add(rel);
        else byEventAt.set(rel, performance.now());
      },
      log: (line) => warnings.push(line),
    });
    watcher.start();
    let unreadable;
    for (const [i, rel] of FILES.entries()) {
      if (i) await sleep(GAP_MS);
      if (o.unreadable && i === FILES.length - 1) unreadable = makeLocked();
      mkdirSync(join(abs(rel), '..'), { recursive: true });
      writeFileSync(abs(rel), `/* ${rel} written by the worca watch probe */\n`);
      writtenAt.set(rel, performance.now());
    }
    const until = performance.now() + SETTLE_MS;
    while (byEventAt.size < FILES.length && performance.now() < until) await sleep(20);
    scanning = true;
    await watcher.rescan();
    const lagsMs = Object.fromEntries([...byEventAt].map(([rel, at]) => [rel, Math.round(at - writtenAt.get(rel))]));
    const lags = Object.values(lagsMs);
    const report = {
      fsWatch: watcher.degraded ? 'degraded' : 'ok',
      byEvent: byEventAt.size,
      byRescan: byRescan.size,
      missed: FILES.filter((rel) => !byEventAt.has(rel) && !byRescan.has(rel)),
      maxLagMs: lags.length ? Math.max(...lags) : null,
      lagsMs,
      platform: process.platform,
      dir: base,
      ...(o.unreadable ? { unreadable: unreadable === 'made' ? 'made mid-probe; the process lived on' : unreadable } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
    log(JSON.stringify(report, null, 2));
    return report.missed.length ? 1 : 0;
  } finally {
    watcher?.close();
    if (lockedMade) { try { chmodSync(locked, 0o755); } catch { /* not there */ } }
    try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch (err) { log(`could not remove ${root}: ${err.message}`); }
  }

  /** sections/locked/ with a file in it, then mode 000. */
  function makeLocked() {
    if (process.platform === 'win32') return 'not on Windows (no mode bits)';
    mkdirSync(locked);
    lockedMade = true;
    writeFileSync(join(locked, 'index.html'), '<p>locked</p>\n');
    chmodSync(locked, 0o000);
    if (typeof process.getuid === 'function' && process.getuid() === 0) return 'made, but root ignores mode 000: proves nothing';
    return 'made';
  }
}

const isMain = (() => { try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isMain) main().then((code) => process.exit(code), (err) => { console.error(err && err.stack ? err.stack : err); process.exit(2); });
