#!/usr/bin/env node
// experiments/messaging-bus/host.mjs — one simulated host for E4 (plan §4.2), run as an IPC child:
//   node host.mjs --origin h_a --db <path> --token <own server token> [--die-after-pages <n>] [--split-cursor]
// --die-after-pages: SIGKILL itself after the rows of the n-th ingested page are inserted and before that page's
// cursor is written (inside the one ingest transaction, or between the two with --split-cursor).
// It opens its bus, serves its outbox on 127.0.0.1:0 and reports {op:'ready', port, origin}.
// IPC in: {op:'peer', url, token, origin} (start or replace the puller of that peer),
// {op:'publish', n, rate} (rate per second; 0 = as fast as possible), {op:'pause'}, {op:'resume'},
// {op:'stats', reset?}. Every reply carries the request's `rid`.
import { createSqliteBus } from './lib/sqlite-bus.mjs';
import { startOutboxServer, createPuller } from './lib/replicate.mjs';

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const origin = arg('--origin');
const dieAfterPages = Number(arg('--die-after-pages') ?? 0);
const splitCursor = process.argv.includes('--split-cursor');
let pages = 0;
const afterInsert = () => { pages += 1; if (dieAfterPages && pages === dieAfterPages) process.kill(process.pid, 'SIGKILL'); };
const bus = createSqliteBus({ path: arg('--db'), origin });
const server = await startOutboxServer({ bus, token: arg('--token') });
const pullers = new Map(); // peer origin → { puller, cfg }
let lags = [];
let lastIngestAt = 0;

function makePuller(cfg) {
  return createPuller({
    bus, url: cfg.url, token: cfg.token, peerOrigin: cfg.origin, longPollMs: 5000, limit: cfg.limit ?? 500,
    _afterInsert: afterInsert, _splitCursor: splitCursor,
    onIngest: (items, r, now) => {
      lastIngestAt = now;
      if (r.inserted > 0) for (const e of items) lags.push(now - e.ts);
    },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function publish(n, rate) {
  const t0 = Date.now();
  let first = null;
  let last = null;
  for (let i = 0; i < n; i++) {
    if (rate > 0) {
      const due = t0 + (i * 1000) / rate;
      const now = Date.now();
      if (due > now) await sleep(due - now);
    }
    const r = bus.publish({ topic: 'team.metrics', kind: 'status', body: { text: `${origin} #${i}` } }, { from: { kind: 'system', id: origin, sub: null } });
    first ??= r.seq;
    last = r.seq;
    if (rate === 0 && i % 250 === 249) await sleep(0); // let the outbox server answer pulls meanwhile
  }
  return { first, last };
}

function stats(reset) {
  const perOrigin = Object.fromEntries(bus.db.prepare('SELECT origin, COUNT(*) AS n, MAX(seq) AS max FROM bus_messages GROUP BY origin').all()
    .map((r) => [r.origin, { n: r.n, max: r.max }]));
  const out = {
    origin, rows: bus.countRows(), perOrigin, lags, lastIngestAt,
    pullers: Object.fromEntries([...pullers].map(([o, p]) => [o, p.puller.stats()])),
  };
  if (reset) lags = [];
  return out;
}

process.on('message', async (msg) => {
  const reply = (body) => process.send({ rid: msg.rid, ...body });
  try {
    if (msg.op === 'peer') {
      const old = pullers.get(msg.origin);
      if (old) await old.puller.stop();
      const p = { cfg: msg, puller: makePuller(msg) };
      pullers.set(msg.origin, p);
      p.puller.start();
      reply({ op: 'peer' });
    } else if (msg.op === 'publish') {
      reply({ op: 'published', ...(await publish(msg.n, msg.rate ?? 0)) });
    } else if (msg.op === 'pause') {
      for (const p of pullers.values()) await p.puller.stop();
      reply({ op: 'paused' });
    } else if (msg.op === 'resume') {
      for (const p of pullers.values()) p.puller.start();
      reply({ op: 'resumed' });
    } else if (msg.op === 'stats') {
      reply({ op: 'stats', stats: stats(msg.reset) });
    } else if (msg.op === 'exit') {
      for (const p of pullers.values()) await p.puller.stop();
      await server.close();
      bus.close();
      reply({ op: 'bye' });
      process.exit(0);
    }
  } catch (e) {
    reply({ op: 'error', error: String(e?.message ?? e) });
  }
});
process.on('disconnect', () => process.exit(0));
process.send({ op: 'ready', port: server.port, url: server.url, origin: bus.origin });
