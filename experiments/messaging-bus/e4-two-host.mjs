#!/usr/bin/env node
// experiments/messaging-bus/e4-two-host.mjs — E4 (plan §4.2): two hosts, each with its own SQLite
// bus and outbox server on 127.0.0.1:0, each long-poll pulling the other (full mesh of two).
// Phases: steady, partition (B's puller paused 3 s while A publishes), crash (B SIGKILLs itself inside the
// ingest of its 3rd page, after the rows and before the cursor; restart on the same DB), auth (no token /
// wrong token). Both hosts share one machine clock. `rePulled` is the rows B's puller received again (its
// `duplicates`); a duplicate ROW cannot exist (UNIQUE id), so re-pulls are what a broken cursor shows.
// --split-cursor runs the crash host with the cursor in a second transaction: the contrast, rePulled > 0.
//   node e4-two-host.mjs [--quick] [--split-cursor] [--out <path>]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openSqlite } from './lib/sqlite.mjs';
import { percentiles, round } from './lib/stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = join(HERE, 'host.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a small page, so the crash phase kills B between pages of one backlog (mid-ingest)
const PULL_LIMIT = 100;
const pids = [];
const live = new Set();

const CRASH_PAGE = 3;

function startHost(origin, db, token, extra = []) {
  const child = fork(HOST, ['--origin', origin, '--db', db, '--token', token, ...extra], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  pids.push(child.pid);
  live.add(child);
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const pending = new Map();
  let rid = 0;
  const h = { child, origin, db, token, url: null, port: null, err: () => err };
  const ready = new Promise((resolve, reject) => {
    child.on('message', (m) => {
      if (m.op === 'ready') { h.url = m.url; h.port = m.port; resolve(h); return; }
      pending.get(m.rid)?.(m);
      pending.delete(m.rid);
    });
    child.on('exit', (code, sig) => {
      live.delete(child);
      for (const p of pending.values()) p({ op: 'error', error: `host exited ${code ?? sig}` });
      pending.clear();
      reject(new Error(`host ${origin} exited ${code ?? sig} ${err}`));
    });
  });
  ready.catch(() => {});
  h.ask = (msg) => new Promise((resolve) => {
    const id = ++rid;
    pending.set(id, resolve);
    child.send({ ...msg, rid: id });
  });
  h.exited = new Promise((r) => child.once('exit', () => r()));
  return ready;
}

/** Read-only view of a host DB: rows of one origin in ingest order. */
function rowsOf(db, origin) {
  const d = openSqlite(db, { readOnly: true });
  try { return d.prepare('SELECT id, seq FROM bus_messages WHERE origin = ? ORDER BY rowid').all(origin); } finally { d.close(); }
}
function countOf(db) {
  const d = openSqlite(db, { readOnly: true });
  try { return d.prepare('SELECT COUNT(*) AS n FROM bus_messages').get().n; } finally { d.close(); }
}

/** loss / order violations of `origin`'s rows on the receiving DB vs the origin's own outbox. */
function compare(srcDb, dstDb, origin) {
  const src = rowsOf(srcDb, origin);
  const dst = rowsOf(dstDb, origin);
  const have = new Set(dst.map((r) => r.id));
  let order = 0;
  for (let i = 1; i < dst.length; i++) if (dst[i].seq <= dst[i - 1].seq) order++;
  return { published: src.length, received: dst.length, loss: src.filter((r) => !have.has(r.id)).length, orderViolations: order };
}

async function waitFor(pred, timeoutMs, everyMs = 10) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(everyMs);
  }
  return Date.now() - t0;
}

async function main(argv) {
  const quick = argv.includes('--quick');
  const splitCursor = argv.includes('--split-cursor');
  const oi = argv.indexOf('--out');
  const outPath = oi >= 0 ? argv[oi + 1] : join(HERE, 'results', 'e4.json');
  const N = { steady: quick ? 100 : 1000, partition: quick ? 500 : 5000, crash: quick ? 500 : 5000, auth: 10 };
  const dir = mkdtempSync(join(tmpdir(), 'bus-e4-'));
  const t0 = Date.now();
  const dbA = join(dir, 'a.db');
  const dbB = join(dir, 'b.db');
  const tokA = randomBytes(16).toString('hex');
  const tokB = randomBytes(16).toString('hex');
  try {
    const A = await startHost('h_a', dbA, tokA);
    let B = await startHost('h_b', dbB, tokB);
    await A.ask({ op: 'peer', url: B.url, token: tokB, origin: 'h_b', limit: PULL_LIMIT });
    await B.ask({ op: 'peer', url: A.url, token: tokA, origin: 'h_a', limit: PULL_LIMIT });

    // steady: both sides publish at 200/s
    await Promise.all([A.ask({ op: 'publish', n: N.steady, rate: 200 }), B.ask({ op: 'publish', n: N.steady, rate: 200 })]);
    await waitFor(() => rowsOf(dbB, 'h_a').length >= N.steady && rowsOf(dbA, 'h_b').length >= N.steady, 10_000, 20);
    const sa = (await A.ask({ op: 'stats', reset: true })).stats;
    const sb = (await B.ask({ op: 'stats', reset: true })).stats;
    const steadyLags = [...sa.lags, ...sb.lags];
    const steady = { n: N.steady, rate: 200, ...percentiles(steadyLags, [50, 99]), samples: steadyLags.length,
      rePulled: sa.pullers.h_b.duplicates + sb.pullers.h_a.duplicates };
    const bDupAfterSteady = sb.pullers.h_a.duplicates;

    // partition: B stops pulling for 3 s while A publishes a backlog
    await B.ask({ op: 'pause' });
    const tPause = Date.now();
    await A.ask({ op: 'publish', n: N.partition, rate: 0 });
    const target = N.steady + N.partition;
    await sleep(Math.max(0, 3000 - (Date.now() - tPause)));
    const behind = rowsOf(dbB, 'h_a').length;
    await B.ask({ op: 'resume' });
    const catchUpMs = await waitFor(() => rowsOf(dbB, 'h_a').length >= target, 30_000, 5);
    const sbPart = (await B.ask({ op: 'stats' })).stats;
    const partition = { backlog: N.partition, behindAtResume: target - behind, catchUpMs,
      rePulled: sbPart.pullers.h_a.duplicates - bDupAfterSteady, ...compare(dbA, dbB, 'h_a') };

    // crash: B is stopped, A publishes a backlog, and B restarts with a seam that SIGKILLs it inside the ingest
    // of page CRASH_PAGE (rows inserted, cursor not yet written). Then B restarts again, normally, on the same DB.
    await B.ask({ op: 'exit' });
    await B.exited;
    const before = rowsOf(dbB, 'h_a').length;
    await A.ask({ op: 'publish', n: N.crash, rate: 0 });
    const target2 = target + N.crash;
    const seam = ['--die-after-pages', String(CRASH_PAGE), ...(splitCursor ? ['--split-cursor'] : [])];
    B = await startHost('h_b', dbB, tokB, seam);
    await B.ask({ op: 'peer', url: A.url, token: tokA, origin: 'h_a', limit: PULL_LIMIT });
    await B.exited;
    const killedBySeam = B.child.signalCode === 'SIGKILL';
    const atKill = rowsOf(dbB, 'h_a').length;
    const tRespawn = Date.now();
    B = await startHost('h_b', dbB, tokB);
    await B.ask({ op: 'peer', url: A.url, token: tokA, origin: 'h_a', limit: PULL_LIMIT });
    await A.ask({ op: 'peer', url: B.url, token: tokB, origin: 'h_b', limit: PULL_LIMIT });
    const caught = await waitFor(() => rowsOf(dbB, 'h_a').length >= target2, 30_000, 5);
    const recoverMs = caught === null ? null : Date.now() - tRespawn;
    await sleep(200); // a late re-pull would land now
    const sbCrash = (await B.ask({ op: 'stats' })).stats;
    const crash = { backlog: N.crash, crashPage: CRASH_PAGE, splitCursor, killedBySeam, rowsAtKill: atKill - before, recoverMs,
      rePulled: sbCrash.pullers.h_a.duplicates, ...compare(dbA, dbB, 'h_a') };

    // auth: refused pulls change nothing on either side
    const rowsBefore = [countOf(dbA), countOf(dbB)];
    let refused = 0;
    let requests = 0;
    for (let i = 0; i < N.auth; i++) {
      for (const headers of [{}, { authorization: 'Bearer wrong-token-xyz' }, { authorization: `Bearer ${tokB}` }]) {
        requests += 1;
        const r = await fetch(`${A.url}/outbox?after=0&limit=10`, { headers });
        if (r.status === 401) refused += 1;
        await r.arrayBuffer();
      }
    }
    for (const method of ['POST', 'PUT']) {
      requests += 1;
      const r = await fetch(`${A.url}/outbox`, { method, headers: { authorization: `Bearer ${tokA}` }, body: '{"items":[]}' });
      if ([401, 404, 405].includes(r.status)) refused += 1;
      await r.arrayBuffer();
    }
    const rowsAfter = [countOf(dbA), countOf(dbB)];
    const auth = { requests, refused, rowsChanged: Math.abs(rowsAfter[0] - rowsBefore[0]) + Math.abs(rowsAfter[1] - rowsBefore[1]) };

    const totalAB = compare(dbA, dbB, 'h_a');
    const totalBA = compare(dbB, dbA, 'h_b');
    await Promise.all([A.ask({ op: 'exit' }), B.ask({ op: 'exit' })]);
    await Promise.all([A.exited, B.exited]);

    const summary = {
      'e4.steady.n': N.steady,
      'e4.steady.lagP50Ms': round(steady.p50, 2),
      'e4.steady.lagP99Ms': round(steady.p99, 2),
      'e4.partition.backlog': N.partition,
      'e4.partition.catchUpMs': catchUpMs,
      'e4.partition.loss': partition.loss,
      'e4.partition.rePulled': partition.rePulled,
      'e4.partition.orderViolations': partition.orderViolations,
      'e4.crash.backlog': N.crash,
      'e4.crash.rowsAtKill': crash.rowsAtKill,
      'e4.crash.recoverMs': recoverMs,
      'e4.crash.loss': crash.loss,
      'e4.crash.rePulled': crash.rePulled,
      'e4.auth.requests': requests,
      'e4.auth.refused': refused,
      'e4.auth.rowsChanged': auth.rowsChanged,
      'e4.total.loss': totalAB.loss + totalBA.loss,
      'e4.total.rePulled': steady.rePulled + partition.rePulled + crash.rePulled,
      'e4.total.orderViolations': totalAB.orderViolations + totalBA.orderViolations,
    };
    const result = {
      experiment: 'e4', quick, splitCursor,
      env: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpus: cpus().length },
      durationMs: Date.now() - t0, summary, steady, partition, crash, auth, totals: { aToB: totalAB, bToA: totalBA }, pids,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify(summary) + '\n');
  } finally {
    for (const c of live) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
    await Promise.all([...live].map((c) => new Promise((r) => (c.exitCode !== null || c.signalCode !== null ? r() : c.once('exit', r)))));
    rmSync(dir, { recursive: true, force: true });
  }
}

main(process.argv.slice(2)).catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
