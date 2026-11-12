// experiments/messaging-bus/lib/emitter-bus.mjs
// The in-process baseline (today's EventEmitter pattern): no persistence, but the same read, Ack,
// Start-position and Self-row rules as the SQLite bus (plan §3.4), so the conformance cases run
// against both. Also exports the pure rules both buses share.
import { EventEmitter } from 'node:events';
import { BusError, validateDraft, validateFrom, validateTopic } from './envelope.mjs';

/** Subscription patterns → a predicate (exact topics, or one trailing `*` = that prefix). */
export function topicMatcher(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) throw new BusError('BUS_BAD_TOPIC', 'no topics');
  const exact = new Set();
  const prefixes = [];
  for (const p of patterns) {
    const v = validateTopic(p, { pattern: true });
    if (!v.ok) throw new BusError(v.code, v.message);
    if (p.endsWith('.*')) prefixes.push(p.slice(0, -1));
    else exact.add(p);
  }
  return { exact: [...exact], prefixes, test: (t) => exact.has(t) || prefixes.some((pre) => t.startsWith(pre)) };
}

/** A row the reading consumer published itself (§3.4 Self rows). */
export function isSelfRow(env, self) {
  return !!self && env.from?.kind === 'agent' && env.from.id === self.sessionId && env.from.sub === self.agentKey;
}

/**
 * The §3.4 Ack rule: the longest prefix of the raw rows in which every non-self row was shown,
 * as per-origin max seqs. `shownCount` counts non-self rows (they are shown as a prefix).
 */
export function ackPrefix(rows, self, shownCount) {
  const acks = new Map();
  let shownLeft = shownCount;
  for (const row of rows) {
    if (!isSelfRow(row, self)) {
      if (shownLeft === 0) break;
      shownLeft -= 1;
    }
    acks.set(row.origin, Math.max(acks.get(row.origin) ?? 0, row.seq));
  }
  return acks;
}

/** Normalise a render result: `shown` may be a count (renderMailbox) or the shown rows. */
export function shownCountOf(out, nonSelf) {
  const n = Array.isArray(out?.shown) ? out.shown.length : Number(out?.shown ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > nonSelf.length) throw new BusError('BUS_BAD_ENVELOPE', 'render returned a bad shown count');
  return n;
}

export function createEmitterBus({ origin } = {}) {
  if (typeof origin !== 'string' || !/^h_[0-9a-z]{1,16}$/.test(origin)) throw new BusError('BUS_BAD_ENVELOPE', 'origin must be h_<id>');
  const rows = []; // envelopes in (origin, seq) order
  const ids = new Map();
  const cursors = new Map(); // consumer → Map(origin → seq)
  const marks = new Map(); // name → [{origin, seq}]
  const agentKeys = new Map(); // `${session}\0${topicKey}` → agentId
  const events = new EventEmitter();
  let nextSeq = 1;
  let closed = false;
  const bus = { origin, _faultAfterRender: false };

  const open = () => { if (closed) throw new BusError('BUS_CLOSED', 'bus is closed'); };
  const insertSorted = (env) => {
    let i = rows.length;
    while (i > 0 && (rows[i - 1].origin > env.origin || (rows[i - 1].origin === env.origin && rows[i - 1].seq > env.seq))) i--;
    rows.splice(i, 0, env);
    ids.set(env.id, env);
  };
  const copy = (e) => structuredClone(e);

  function rawRead(cur, patterns, limit) {
    const m = topicMatcher(patterns);
    const out = [];
    for (const r of rows) {
      if (out.length >= limit) break;
      if (m.test(r.topic) && r.seq > (cur.get(r.origin) ?? 0)) out.push(r);
    }
    return out;
  }

  function cursorFor(consumer, startMark) {
    const existing = cursors.get(consumer);
    if (existing && existing.size > 0) return { cur: new Map(existing), seeded: false, noMark: false };
    const mark = startMark ? marks.get(startMark) : undefined;
    if (!mark) return { cur: new Map(), seeded: false, noMark: true };
    return { cur: new Map(mark.map((c) => [c.origin, c.seq]).concat([['', 0]])), seeded: true, noMark: false };
  }

  bus.publish = (draft, { from } = {}) => {
    open();
    const v = validateDraft(draft);
    if (!v.ok) throw new BusError(v.code, v.message);
    const f = validateFrom(from ?? { kind: 'system', id: origin, sub: null });
    if (!f.ok) throw new BusError(f.code, f.message);
    const dup = ids.get(v.env.id);
    if (dup) return { id: dup.id, origin: dup.origin, seq: dup.seq, duplicate: true };
    const env = { ...v.env, origin, seq: nextSeq++, from: f.from };
    insertSorted(env);
    events.emit('publish');
    return { id: env.id, origin, seq: env.seq, duplicate: false };
  };

  bus.read = (consumer, patterns, { limit = 100, startMark, self } = {}) => {
    open();
    const { cur, noMark } = cursorFor(consumer, startMark);
    const out = rawRead(cur, patterns, limit).filter((r) => !isSelfRow(r, self)).map(copy);
    out.noMark = noMark;
    return out;
  };

  bus.ack = (consumer, { origin: o, seq }) => {
    open();
    if (!cursors.has(consumer)) cursors.set(consumer, new Map());
    const c = cursors.get(consumer);
    c.set(o, Math.max(c.get(o) ?? 0, seq));
  };

  bus.readRenderAck = (consumer, patterns, { limit = 100, startMark, self, render, claim } = {}) => {
    open();
    if (claim) {
      const r = checkClaim(claim.sessionKey, claim.topicKey, claim.agentId);
      if (!r.ok) throw new BusError(r.code, r.message);
    }
    const { cur, seeded, noMark } = cursorFor(consumer, startMark);
    const raw = rawRead(cur, patterns, limit);
    const nonSelf = raw.filter((r) => !isSelfRow(r, self)).map(copy);
    const out = render(nonSelf, { limitHit: raw.length >= limit });
    const n = shownCountOf(out, nonSelf);
    if (bus._faultAfterRender) throw new Error('injected fault after render');
    // commit: claim, seed, ack
    if (claim) agentKeys.set(`${claim.sessionKey}\0${claim.topicKey}`, claim.agentId);
    for (const [o, s] of ackPrefix(raw, self, n)) cur.set(o, Math.max(cur.get(o) ?? 0, s));
    if (seeded || cur.size > 0) cursors.set(consumer, cur);
    return { text: out.text ?? '', shown: nonSelf.slice(0, n), more: nonSelf.length - n, noMark, limitHit: raw.length >= limit };
  };

  bus.mark = (name) => {
    open();
    if (!marks.has(name)) {
      const max = new Map();
      for (const r of rows) max.set(r.origin, Math.max(max.get(r.origin) ?? 0, r.seq));
      marks.set(name, [...max].sort(([a], [b]) => (a < b ? -1 : 1)).map(([o, s]) => ({ origin: o, seq: s })));
    }
    return { name, cursors: marks.get(name).map((c) => ({ ...c })) };
  };

  function checkClaim(sessionKey, topicKey, agentId) {
    const owner = agentKeys.get(`${sessionKey}\0${topicKey}`);
    if (owner === undefined || owner === agentId) return { ok: true };
    return { ok: false, code: 'BUS_BAD_CONSUMER', message: 'agent id collides with an earlier one after lowercasing' };
  }

  bus.claimAgentKey = (sessionKey, topicKey, agentId) => {
    open();
    const r = checkClaim(sessionKey, topicKey, agentId);
    if (r.ok) agentKeys.set(`${sessionKey}\0${topicKey}`, agentId);
    return r;
  };

  bus.ingest = (envs) => {
    open();
    let inserted = 0;
    let duplicates = 0;
    for (const e of envs) {
      if (ids.has(e.id) || rows.some((r) => r.origin === e.origin && r.seq === e.seq)) { duplicates++; continue; }
      insertSorted(copy(e));
      inserted++;
    }
    if (inserted) events.emit('publish');
    return { inserted, duplicates };
  };

  bus.outboxAfter = (seq, limit = 100) => {
    open();
    return rows.filter((r) => r.origin === origin && r.seq > seq).slice(0, limit).map(copy);
  };

  bus.replay = (consumer, patterns, n) => {
    open();
    const m = topicMatcher(patterns);
    const cur = cursors.get(consumer) ?? new Map();
    const acked = rows.filter((r) => m.test(r.topic) && r.seq <= (cur.get(r.origin) ?? 0));
    return acked.slice(Math.max(0, acked.length - n)).map(copy);
  };

  bus.cursors = (consumer) => {
    open();
    return [...(cursors.get(consumer) ?? new Map())].filter(([o]) => o !== '').sort(([a], [b]) => (a < b ? -1 : 1)).map(([o, s]) => ({ origin: o, seq: s }));
  };

  bus.countRows = () => rows.length;

  bus.wake = (consumer, cb) => {
    open();
    const fn = () => cb();
    events.on('publish', fn);
    return () => events.off('publish', fn);
  };

  bus.close = () => { closed = true; events.removeAllListeners(); };
  return bus;
}
