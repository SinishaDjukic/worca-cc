#!/usr/bin/env node
// experiments/messaging-bus/e1-outbox-bench.mjs — E1 (plan §4.2): the SQLite outbox as the local bus.
//  (a) publish throughput: single-row transactions, 100-row batches, two writer processes on one DB
//  (b) publisher process → consumer process latency per wake mode (poll-10/50/250, watch) + EmitterBus floor
//  (c) restart recovery: a transactional and a naive consumer, SIGKILLed inside one row's critical
//      window (after its effect, before its ack or commit) and restarted
//  (d) prune 90 % of N rows
//   node e1-outbox-bench.mjs [--quick] [--out <path>] [--n <publish N>]
// The same file is its own child (`--child writer|consumer|restart …`). Every spawned pid is recorded
// and stopped in a `finally`.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir, cpus, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createSqliteBus } from './lib/sqlite-bus.mjs';
import { createEmitterBus } from './lib/emitter-bus.mjs';
import { percentiles, hrtimeMs, round } from './lib/stats.mjs';

const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);
const FROM = { kind: 'system', id: 'e1', sub: null };
const draft = (topic, text, data) => ({ topic, kind: 'status', body: data ? { text, data } : { text } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (argv, name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };

// ---------------------------------------------------------------- children

function childWriter(argv) {
  const bus = createSqliteBus({ path: arg(argv, '--db') });
  const n = Number(arg(argv, '--n'));
  let busy = 0;
  const t0 = hrtimeMs();
  for (let i = 0; i < n; i++) {
    for (;;) {
      try { bus.publish(draft('run.e1.tput', `w${process.pid} ${i}`), { from: FROM }); break; } catch (e) {
        if (e.code !== 'BUS_BUSY') throw e;
        busy += 1;
      }
    }
  }
  const t1 = hrtimeMs();
  bus.close();
  process.stdout.write(JSON.stringify({ t0, t1, busy }) + '\n');
}

function childConsumer(argv) {
  const bus = createSqliteBus({ path: arg(argv, '--db') });
  const n = Number(arg(argv, '--n'));
  const mode = arg(argv, '--mode');
  const opts = mode === 'watch' ? { watch: true, pollMs: 1000 } : { watch: false, pollMs: Number(mode.split('-')[1]) };
  const lat = [];
  const drain = () => {
    for (;;) {
      const rows = bus.read('e1:lat', ['run.e1.lat'], { limit: 1000 });
      if (rows.length === 0) break;
      const now = hrtimeMs();
      for (const r of rows) lat.push(now - r.body.data.t);
      const last = new Map();
      for (const r of rows) last.set(r.origin, r.seq);
      for (const [origin, seq] of last) bus.ack('e1:lat', { origin, seq });
    }
    if (lat.length >= n) {
      stop();
      bus.close();
      process.stdout.write(JSON.stringify({ lat }) + '\n', () => process.exit(0));
    }
  };
  const stop = bus.wake('e1:lat', drain, opts);
  process.stdout.write('ready\n');
}

function childRestart(argv) {
  const bus = createSqliteBus({ path: arg(argv, '--db') });
  const kind = arg(argv, '--kind');
  // the crash seam: SIGKILL ourselves after the effect of the n-th row and before its ack (naive) or COMMIT (transactional)
  const dieAfter = Number(arg(argv, '--die-after-effect', '0'));
  let done = 0;
  const maybeDie = () => { done += 1; if (dieAfter && done === dieAfter) process.kill(process.pid, 'SIGKILL'); };
  const db = bus.db;
  db.exec('CREATE TABLE IF NOT EXISTS processed (id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS effects (rowid INTEGER PRIMARY KEY, id TEXT NOT NULL)');
  const consumer = `e1:restart:${kind}`;
  const markProcessed = db.prepare('INSERT OR IGNORE INTO processed (id) VALUES (?)');
  const effect = db.prepare('INSERT INTO effects (id) VALUES (?)');
  const ack = db.prepare(`INSERT INTO bus_cursors (consumer, origin, seq) VALUES (?, ?, ?)
    ON CONFLICT(consumer, origin) DO UPDATE SET seq = MAX(seq, excluded.seq)`);
  for (;;) {
    const rows = bus.read(consumer, ['run.e1.restart'], { limit: 20 });
    if (rows.length === 0) break;
    for (const r of rows) {
      writeSync(2, `R ${r.id}\n`); // synchronous: a SIGKILL cannot drop a buffered line
      if (kind === 'transactional') {
        db.exec('BEGIN IMMEDIATE');
        try {
          if (markProcessed.run(r.id).changes === 1) effect.run(r.id);
          maybeDie();
          ack.run(consumer, r.origin, r.seq);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      } else {
        effect.run(r.id);
        maybeDie();
        bus.ack(consumer, { origin: r.origin, seq: r.seq });
      }
    }
  }
  bus.close();
}

// ---------------------------------------------------------------- parent helpers

const pids = [];
const live = new Set();
function track(child) {
  pids.push(child.pid);
  live.add(child);
  child.on('exit', () => live.delete(child));
  return child;
}
function spawnChild(args) {
  return track(spawn(process.execPath, [SELF, '--child', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }));
}
const exited = (c) => new Promise((r) => { if (c.exitCode !== null || c.signalCode !== null) r(); else c.once('exit', () => r()); });
const linesOf = (stream, onLine) => createInterface({ input: stream }).on('line', onLine);

async function benchPublish(dir, n) {
  const single = createSqliteBus({ path: join(dir, 'single.db'), origin: 'h_e1a' });
  let t0 = hrtimeMs();
  for (let i = 0; i < n; i++) single.publish(draft('run.e1.tput', `m${i}`), { from: FROM });
  const singleMs = hrtimeMs() - t0;
  single.close();

  const batch = createSqliteBus({ path: join(dir, 'batch.db'), origin: 'h_e1b' });
  t0 = hrtimeMs();
  for (let i = 0; i < n; i += 100) {
    batch.publishBatch(Array.from({ length: Math.min(100, n - i) }, (_, j) => draft('run.e1.tput', `m${i + j}`)), { from: FROM });
  }
  const batchMs = hrtimeMs() - t0;
  batch.close();

  const twoPath = join(dir, 'two.db');
  createSqliteBus({ path: twoPath, origin: 'h_e1c' }).close();
  const half = Math.floor(n / 2);
  const results = await Promise.all([0, 1].map(async () => {
    const c = spawnChild(['writer', '--db', twoPath, '--n', String(half)]);
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    await exited(c);
    if (c.exitCode !== 0) throw new Error(`writer failed: ${err}`);
    return JSON.parse(out);
  }));
  const two = createSqliteBus({ path: twoPath });
  const seqs = two.outboxAfter(0, 2 * half + 10).map((r) => r.seq);
  two.close();
  const twoMs = Math.max(...results.map((r) => r.t1)) - Math.min(...results.map((r) => r.t0));
  return {
    n,
    single: { ms: singleMs, msgsPerSec: (n / singleMs) * 1000 },
    batch100: { ms: batchMs, msgsPerSec: (n / batchMs) * 1000 },
    twoWriters: {
      ms: twoMs, msgsPerSec: ((2 * half) / twoMs) * 1000, busyErrors: results.reduce((a, r) => a + r.busy, 0),
      seqGapFree: seqs.length === 2 * half && seqs.every((s, i) => s === i + 1),
    },
  };
}

/** Publish `n` messages at `rate`/s, never waiting on a consumer between them. */
async function publishAtRate(publish, n, rate) {
  const t0 = performance.now();
  let i = 0;
  while (i < n) {
    const due = Math.min(n, Math.floor(((performance.now() - t0) * rate) / 1000) + 1);
    while (i < due) publish(i++);
    if (i < n) await sleep(1);
  }
}

async function benchLatency(dir, n) {
  const rate = 500;
  const out = {};
  for (const mode of ['poll-10', 'poll-50', 'poll-250', 'watch']) {
    const path = join(dir, `lat-${mode}.db`);
    const bus = createSqliteBus({ path, origin: 'h_e1d' });
    const c = spawnChild(['consumer', '--db', path, '--mode', mode, '--n', String(n)]);
    let result = null;
    const ready = new Promise((resolve) => linesOf(c.stdout, (line) => {
      if (line === 'ready') resolve();
      else result = JSON.parse(line);
    }));
    let err = '';
    c.stderr.on('data', (d) => { err += d; });
    await ready;
    await publishAtRate((i) => bus.publish(draft('run.e1.lat', `l${i}`, { t: hrtimeMs() }), { from: FROM }), n, rate);
    await Promise.race([exited(c), sleep(2000)]);
    if (c.exitCode === null) c.kill('SIGKILL');
    await exited(c);
    bus.close();
    if (!result) throw new Error(`consumer ${mode} delivered nothing: ${err}`);
    out[mode] = { received: result.lat.length, ...percentiles(result.lat, [50, 99]) };
  }
  // in-process floor
  const em = createEmitterBus({ origin: 'h_e1e' });
  const lat = [];
  em.wake('e1:lat', () => {
    const rows = em.read('e1:lat', ['run.e1.lat'], { limit: 1000 });
    const now = hrtimeMs();
    for (const r of rows) { lat.push(now - r.body.data.t); em.ack('e1:lat', { origin: r.origin, seq: r.seq }); }
  });
  await publishAtRate((i) => em.publish(draft('run.e1.lat', `l${i}`, { t: hrtimeMs() }), { from: FROM }), n, rate);
  em.close();
  out.emitter = { received: lat.length, ...percentiles(lat, [50, 99]) };
  return { rate, n, modes: out };
}

async function benchRestart(dir, n) {
  const out = {};
  for (const kind of ['transactional', 'naive']) {
    const path = join(dir, `restart-${kind}.db`);
    const bus = createSqliteBus({ path, origin: 'h_e1f' });
    const ids = [];
    for (let i = 0; i < n; i += 500) {
      ids.push(...bus.publishBatch(Array.from({ length: Math.min(500, n - i) }, (_, j) => draft('run.e1.restart', `r${i + j}`)), { from: FROM }).map((r) => r.id));
    }
    const reads = [];
    const run = (dieAfter) => new Promise((resolve, reject) => {
      const c = spawnChild(['restart', '--db', path, '--kind', kind, '--die-after-effect', String(dieAfter)]);
      let errText = '';
      linesOf(c.stderr, (line) => {
        if (line.startsWith('R ')) reads.push(line.slice(2));
        else errText += line + '\n';
      });
      c.on('exit', (code, signal) => {
        if (signal === 'SIGKILL' && dieAfter) resolve('killed');
        else if (code === 0) resolve('done');
        else reject(new Error(`restart consumer ${kind}: ${code ?? signal} ${errText}`));
      });
    });
    const first = await run(Math.floor(n * 0.4));
    const second = await run(0);
    const effects = bus.db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS d FROM effects').get();
    const have = new Set(bus.db.prepare('SELECT DISTINCT id FROM effects').all().map((r) => r.id));
    const counts = new Map();
    for (const id of reads) counts.set(id, (counts.get(id) ?? 0) + 1);
    out[kind] = {
      published: n, firstRun: first, secondRun: second, diedAfterEffectOfRow: Math.floor(n * 0.4),
      lost: ids.filter((id) => !have.has(id)).length,
      duplicateEffects: effects.n - effects.d,
      redeliveries: [...counts.values()].filter((v) => v > 1).length,
    };
    bus.close();
  }
  return out;
}

function benchPrune(dir, n) {
  const bus = createSqliteBus({ path: join(dir, 'prune.db'), origin: 'h_e1g' });
  for (let i = 0; i < n; i += 1000) {
    bus.publishBatch(Array.from({ length: Math.min(1000, n - i) }, (_, j) => draft(`run.e1.p${(i + j) % 10}`, `p${i + j}`)), { from: FROM });
  }
  const cut = Math.floor(n * 0.9);
  const t0 = hrtimeMs();
  const r = bus.db.prepare('DELETE FROM bus_messages WHERE origin = ? AND seq <= ?').run(bus.origin, cut);
  const ms = hrtimeMs() - t0;
  const left = bus.countRows();
  bus.close();
  return { n, deleted: Number(r.changes), left, ms };
}

async function main(argv) {
  const quick = argv.includes('--quick');
  const outPath = arg(argv, '--out', join(HERE, 'results', 'e1.json'));
  const N = {
    publish: Number(arg(argv, '--n', quick ? 2000 : 50_000)),
    latency: quick ? 200 : 2000,
    restart: quick ? 1000 : 10_000,
    prune: quick ? 5000 : 100_000,
  };
  const dir = mkdtempSync(join(tmpdir(), 'bus-e1-'));
  const t0 = Date.now();
  try {
    const publish = await benchPublish(dir, N.publish);
    const latency = await benchLatency(dir, N.latency);
    const restart = await benchRestart(dir, N.restart);
    const prune = benchPrune(dir, N.prune);
    const summary = {
      'e1.publish.n': N.publish,
      'e1.publish.single.msgsPerSec': round(publish.single.msgsPerSec, 0),
      'e1.publish.batch100.msgsPerSec': round(publish.batch100.msgsPerSec, 0),
      'e1.publish.twoWriters.msgsPerSec': round(publish.twoWriters.msgsPerSec, 0),
      'e1.publish.twoWriters.busyErrors': publish.twoWriters.busyErrors,
      'e1.publish.twoWriters.seqGapFree': publish.twoWriters.seqGapFree,
      'e1.latency.n': N.latency,
      'e1.latency.ratePerSec': latency.rate,
    };
    for (const [mode, v] of Object.entries(latency.modes)) {
      summary[`e1.latency.${mode}.p50Ms`] = round(v.p50, 2);
      summary[`e1.latency.${mode}.p99Ms`] = round(v.p99, 2);
      summary[`e1.latency.${mode}.received`] = v.received;
    }
    for (const [kind, v] of Object.entries(restart)) {
      summary[`e1.restart.${kind}.published`] = v.published;
      summary[`e1.restart.${kind}.lost`] = v.lost;
      summary[`e1.restart.${kind}.duplicateEffects`] = v.duplicateEffects;
      summary[`e1.restart.${kind}.redeliveries`] = v.redeliveries;
    }
    summary['e1.prune.n'] = prune.n;
    summary['e1.prune.ms'] = round(prune.ms, 2);
    const result = {
      experiment: 'e1', quick,
      env: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, cpus: cpus().length },
      durationMs: Date.now() - t0, summary, publish, latency, restart, prune, pids,
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(JSON.stringify(summary) + '\n');
  } finally {
    for (const c of live) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
    await Promise.all([...live].map(exited));
    rmSync(dir, { recursive: true, force: true });
  }
}

const argv = process.argv.slice(2);
if (argv[0] === '--child') {
  const role = argv[1];
  if (role === 'writer') childWriter(argv);
  else if (role === 'consumer') childConsumer(argv);
  else if (role === 'restart') childRestart(argv);
} else {
  main(argv).catch((e) => { process.stderr.write(`${e.stack ?? e}\n`); process.exit(1); });
}
