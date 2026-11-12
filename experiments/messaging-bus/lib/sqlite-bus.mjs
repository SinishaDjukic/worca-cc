// experiments/messaging-bus/lib/sqlite-bus.mjs
// The local default transport (plan §3.3, §4.1): a SQLite outbox/inbox with per-(consumer, origin)
// cursors. Every state change is one BEGIN IMMEDIATE transaction; readRenderAck folds claim, seed,
// read, render and the prefix ack into ONE of them (§3.4). `wake` is a hint only: fs.watch on the
// -wal file plus a polling fallback, and an in-process signal for this connection's own writes.
import { EventEmitter } from 'node:events';
import { watch } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { openSqlite } from './sqlite.mjs';
import { BusError, validateDraft, validateFrom, validateTopic } from './envelope.mjs';
import { topicMatcher, isSelfRow, ackPrefix, shownCountOf } from './emitter-bus.mjs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bus_messages (
  rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, origin TEXT NOT NULL, seq INTEGER NOT NULL,
  topic TEXT NOT NULL, kind TEXT NOT NULL, env_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(origin, seq));
CREATE INDEX IF NOT EXISTS bus_messages_topic ON bus_messages(topic, origin, seq);
CREATE TABLE IF NOT EXISTS bus_cursors (consumer TEXT NOT NULL, origin TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY(consumer, origin));
CREATE TABLE IF NOT EXISTS bus_marks (name TEXT NOT NULL, origin TEXT NOT NULL, seq INTEGER NOT NULL,
  PRIMARY KEY(name, origin));
CREATE TABLE IF NOT EXISTS bus_agent_keys (session_key TEXT NOT NULL, topic_key TEXT NOT NULL, agent_id TEXT NOT NULL,
  PRIMARY KEY(session_key, topic_key));
CREATE TABLE IF NOT EXISTS bus_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
const ORIGIN_RE = /^h_[0-9a-z]{1,16}$/;
const COLLISION = 'agent id collides with an earlier one after lowercasing';

const isBusy = (e) => e?.errcode === 5 || e?.errcode === 6 || /database is locked|SQLITE_BUSY/i.test(String(e?.message));

export function createSqliteBus({ path, origin, pollMs = 50 } = {}) {
  if (typeof path !== 'string' || !path) throw new BusError('BUS_BAD_ENVELOPE', 'path required');
  const db = openSqlite(path);
  const local = new EventEmitter();
  local.setMaxListeners(0);
  let closed = false;
  const stoppers = new Set();
  const bus = { db, path, _faultAfterRender: false };

  let inTx = false;

  /** One BEGIN IMMEDIATE transaction; a call made while one is open joins it (no nesting). */
  function tx(fn) {
    if (inTx) return fn();
    try {
      db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      throw isBusy(e) ? new BusError('BUS_BUSY', String(e.message)) : e;
    }
    inTx = true;
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw isBusy(e) ? new BusError('BUS_BUSY', String(e.message)) : e;
    } finally {
      inTx = false;
    }
  }

  tx(() => {
    db.exec(SCHEMA);
    const row = db.prepare("SELECT value FROM bus_meta WHERE key = 'origin'").get();
    if (row) {
      if (origin && origin !== row.value) throw new BusError('BUS_BAD_ENVELOPE', `db belongs to origin ${row.value}`);
      bus.origin = row.value;
    } else {
      const o = origin ?? `h_${randomBytes(4).toString('hex')}`;
      if (!ORIGIN_RE.test(o)) throw new BusError('BUS_BAD_ENVELOPE', 'origin must be h_<id>');
      db.prepare("INSERT INTO bus_meta (key, value) VALUES ('origin', ?), ('next_seq', '1')").run(o);
      bus.origin = o;
    }
  });

  const q = {
    nextSeq: db.prepare("SELECT value FROM bus_meta WHERE key = 'next_seq'"),
    setSeq: db.prepare("UPDATE bus_meta SET value = ? WHERE key = 'next_seq'"),
    insert: db.prepare(`INSERT OR IGNORE INTO bus_messages (id, origin, seq, topic, kind, env_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT origin, seq FROM bus_messages WHERE id = ?'),
    ack: db.prepare(`INSERT INTO bus_cursors (consumer, origin, seq) VALUES (?, ?, ?)
      ON CONFLICT(consumer, origin) DO UPDATE SET seq = MAX(seq, excluded.seq)`),
    hasCursor: db.prepare('SELECT 1 AS x FROM bus_cursors WHERE consumer = ? LIMIT 1'),
    cursors: db.prepare("SELECT origin, seq FROM bus_cursors WHERE consumer = ? AND origin != '' ORDER BY origin"),
    hasMark: db.prepare('SELECT 1 AS x FROM bus_marks WHERE name = ? LIMIT 1'),
    seed: db.prepare('INSERT OR IGNORE INTO bus_cursors (consumer, origin, seq) SELECT ?, origin, seq FROM bus_marks WHERE name = ?'),
    markSentinel: db.prepare("INSERT INTO bus_marks (name, origin, seq) VALUES (?, '', 0)"),
    markRows: db.prepare('INSERT INTO bus_marks (name, origin, seq) SELECT ?, origin, MAX(seq) FROM bus_messages GROUP BY origin'),
    markGet: db.prepare("SELECT origin, seq FROM bus_marks WHERE name = ? AND origin != '' ORDER BY origin"),
    claimGet: db.prepare('SELECT agent_id FROM bus_agent_keys WHERE session_key = ? AND topic_key = ?'),
    claimPut: db.prepare('INSERT INTO bus_agent_keys (session_key, topic_key, agent_id) VALUES (?, ?, ?)'),
    outbox: db.prepare('SELECT env_json FROM bus_messages WHERE origin = ? AND seq > ? ORDER BY seq LIMIT ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM bus_messages'),
    dataVersion: db.prepare('PRAGMA data_version'),
  };

  const open = () => { if (closed) throw new BusError('BUS_CLOSED', 'bus is closed'); };

  /** Raw rows after the cursors kept in `table` under `key` ('bus_cursors' by consumer, 'bus_marks' by name). */
  function rawRead(table, key, patterns, limit) {
    const m = topicMatcher(patterns);
    const conds = [];
    const args = [key];
    for (const t of m.exact) { conds.push('m.topic = ?'); args.push(t); }
    for (const p of m.prefixes) { conds.push('substr(m.topic, 1, ?) = ?'); args.push(p.length, p); }
    const keyCol = table === 'bus_cursors' ? 'consumer' : 'name';
    args.push(limit);
    const sql = `SELECT m.env_json FROM bus_messages m
      LEFT JOIN ${table} c ON c.${keyCol} = ? AND c.origin = m.origin
      WHERE (${conds.join(' OR ')}) AND m.seq > COALESCE(c.seq, 0)
      ORDER BY m.origin, m.seq LIMIT ?`;
    return db.prepare(sql).all(...args).map((r) => JSON.parse(r.env_json));
  }

  function insertDraft(draft, from) {
    const v = validateDraft(draft);
    if (!v.ok) throw new BusError(v.code, v.message);
    const dup = q.byId.get(v.env.id);
    if (dup) return { id: v.env.id, origin: dup.origin, seq: dup.seq, duplicate: true };
    const seq = Number(q.nextSeq.get().value);
    const env = { ...v.env, origin: bus.origin, seq, from };
    const r = q.insert.run(env.id, env.origin, seq, env.topic, env.kind, JSON.stringify(env), Date.now());
    if (r.changes === 0) {
      const same = q.byId.get(env.id);
      if (same) return { id: env.id, origin: same.origin, seq: same.seq, duplicate: true };
      throw new BusError('BUS_BAD_ENVELOPE', `seq ${seq} of origin ${bus.origin} is already taken`);
    }
    q.setSeq.run(String(seq + 1));
    return { id: env.id, origin: bus.origin, seq, duplicate: false };
  }

  function stampFrom(from) {
    const f = validateFrom(from ?? { kind: 'system', id: bus.origin, sub: null });
    if (!f.ok) throw new BusError(f.code, f.message);
    return f.from;
  }

  bus.publish = (draft, { from } = {}) => {
    open();
    const f = stampFrom(from);
    const r = tx(() => insertDraft(draft, f));
    if (!r.duplicate) local.emit('write');
    return r;
  };

  /** Runs `fn` inside one BEGIN IMMEDIATE transaction; a `publish` called inside it joins it (plan §4.6). */
  bus.transaction = (fn) => {
    open();
    if (typeof fn !== 'function') throw new BusError('BUS_BAD_ENVELOPE', 'transaction needs a function');
    return tx(fn);
  };

  /** E1's batched publish: many drafts in ONE transaction (all or nothing). */
  bus.publishBatch = (drafts, { from } = {}) => {
    open();
    const f = stampFrom(from);
    const out = tx(() => drafts.map((d) => insertDraft(d, f)));
    local.emit('write');
    return out;
  };

  bus.read = (consumer, patterns, { limit = 100, startMark, self } = {}) => {
    open();
    let rows;
    let noMark = false;
    if (q.hasCursor.get(consumer)) rows = rawRead('bus_cursors', consumer, patterns, limit);
    else if (startMark && q.hasMark.get(startMark)) rows = rawRead('bus_marks', startMark, patterns, limit);
    else { noMark = true; rows = rawRead('bus_cursors', consumer, patterns, limit); }
    const out = rows.filter((r) => !isSelfRow(r, self));
    out.noMark = noMark;
    return out;
  };

  bus.ack = (consumer, { origin: o, seq }) => {
    open();
    tx(() => q.ack.run(consumer, o, seq));
  };

  function claimInTx(sessionKey, topicKey, agentId) {
    const row = q.claimGet.get(sessionKey, topicKey);
    if (row && row.agent_id !== agentId) return { ok: false, code: 'BUS_BAD_CONSUMER', message: COLLISION };
    if (!row) q.claimPut.run(sessionKey, topicKey, agentId);
    return { ok: true };
  }

  bus.claimAgentKey = (sessionKey, topicKey, agentId) => {
    open();
    return tx(() => claimInTx(sessionKey, topicKey, agentId));
  };

  bus.readRenderAck = (consumer, patterns, { limit = 100, startMark, self, render, claim } = {}) => {
    open();
    if (typeof render !== 'function') throw new BusError('BUS_BAD_ENVELOPE', 'render required');
    return tx(() => {
      if (claim) {
        const c = claimInTx(claim.sessionKey, claim.topicKey, claim.agentId);
        if (!c.ok) throw new BusError(c.code, c.message);
      }
      let noMark = false;
      if (!q.hasCursor.get(consumer)) {
        if (startMark && q.hasMark.get(startMark)) q.seed.run(consumer, startMark);
        else noMark = true;
      }
      const raw = rawRead('bus_cursors', consumer, patterns, limit);
      const nonSelf = raw.filter((r) => !isSelfRow(r, self));
      const limitHit = raw.length >= limit;
      const out = render(nonSelf, { limitHit });
      const n = shownCountOf(out, nonSelf);
      if (bus._faultAfterRender) throw new Error('injected fault after render');
      for (const [o, s] of ackPrefix(raw, self, n)) q.ack.run(consumer, o, s);
      return { text: out.text ?? '', shown: nonSelf.slice(0, n), more: nonSelf.length - n, noMark, limitHit };
    });
  };

  bus.mark = (name) => {
    open();
    if (typeof name !== 'string' || !name) throw new BusError('BUS_BAD_ENVELOPE', 'mark name required');
    return tx(() => {
      if (!q.hasMark.get(name)) { q.markSentinel.run(name); q.markRows.run(name); }
      return { name, cursors: q.markGet.all(name).map((r) => ({ origin: r.origin, seq: r.seq })) };
    });
  };

  /**
   * Foreign rows from a peer, keeping their origin and seq; with `cursorKey`, the peer cursor moves in the same tx.
   * `_afterInsert` is a test/experiment seam called inside the transaction after the inserts, before the cursor.
   */
  bus.ingest = (envs, { cursorKey, cursorSeq, _failAfterInsert = false, _afterInsert } = {}) => {
    open();
    for (const e of envs) {
      if (!e || typeof e.id !== 'string' || !ORIGIN_RE.test(String(e.origin)) || !Number.isInteger(e.seq) || e.seq < 1
        || !validateTopic(e.topic).ok) throw new BusError('BUS_BAD_ENVELOPE', 'bad replicated envelope');
      // a row of our own origin can only come from us; storing one would take a local seq and lose later publishes
      if (e.origin === bus.origin) throw new BusError('BUS_BAD_ENVELOPE', 'replicated envelope carries the local origin');
    }
    const r = tx(() => {
      let inserted = 0;
      for (const e of envs) inserted += q.insert.run(e.id, e.origin, e.seq, e.topic, e.kind, JSON.stringify(e), Date.now()).changes;
      if (_failAfterInsert) throw new Error('injected fault after insert');
      _afterInsert?.();
      if (cursorKey) q.ack.run(cursorKey, cursorKey.replace(/^peer:/, ''), cursorSeq);
      return { inserted, duplicates: envs.length - inserted };
    });
    if (r.inserted) local.emit('write');
    return r;
  };

  bus.outboxAfter = (seq, limit = 100) => {
    open();
    return q.outbox.all(bus.origin, seq, limit).map((r) => JSON.parse(r.env_json));
  };

  /** The last n already-acked rows for a consumer, in (origin, seq) order; the cursor does not move. */
  bus.replay = (consumer, patterns, n) => {
    open();
    const m = topicMatcher(patterns);
    const conds = [];
    const args = [consumer];
    for (const t of m.exact) { conds.push('m.topic = ?'); args.push(t); }
    for (const p of m.prefixes) { conds.push('substr(m.topic, 1, ?) = ?'); args.push(p.length, p); }
    args.push(n);
    const rows = db.prepare(`SELECT m.env_json FROM bus_messages m
      JOIN bus_cursors c ON c.consumer = ? AND c.origin = m.origin
      WHERE (${conds.join(' OR ')}) AND m.seq <= c.seq
      ORDER BY m.origin DESC, m.seq DESC LIMIT ?`).all(...args);
    return rows.reverse().map((r) => JSON.parse(r.env_json));
  };

  bus.cursors = (consumer) => {
    open();
    return q.cursors.all(consumer).map((r) => ({ origin: r.origin, seq: r.seq }));
  };

  bus.countRows = () => {
    open();
    return q.count.get().n;
  };

  /** A low-latency hint: fires after a write by this connection, a -wal change, or a poll that sees a new data_version. */
  bus.wake = (consumer, cb, { watch: useWatch = true, pollMs: every = pollMs } = {}) => {
    open();
    let pending = null;
    const fire = () => {
      if (pending || closed) return;
      pending = setTimeout(() => { pending = null; if (!closed) cb(); }, 1);
    };
    local.on('write', fire);
    let watcher = null;
    if (useWatch) {
      try {
        watcher = watch(`${path}-wal`, { persistent: true }, fire);
        watcher.on('error', () => { watcher = null; });
      } catch { watcher = null; }
    }
    let version = q.dataVersion.get().data_version;
    const timer = setInterval(() => {
      if (closed) return;
      const v = q.dataVersion.get().data_version;
      if (v !== version) { version = v; fire(); }
    }, every);
    const stop = () => {
      local.off('write', fire);
      clearInterval(timer);
      if (pending) clearTimeout(pending);
      try { watcher?.close(); } catch { /* closed */ }
      stoppers.delete(stop);
    };
    stoppers.add(stop);
    return stop;
  };

  bus.close = () => {
    if (closed) return;
    for (const stop of [...stoppers]) stop();
    closed = true;
    db.close();
  };
  return bus;
}
