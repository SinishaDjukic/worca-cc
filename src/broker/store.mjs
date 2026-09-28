// src/broker/store.mjs
// The broker's own SQLite database (plans/credential-broker-design.html §6.5):
// sealed credentials, spawn tokens (hashes only) and usage rows. node:sqlite,
// synchronous, loaded lazily like src/core/db.mjs. A path of ':memory:' keeps
// everything in memory (single mode without a data dir, and tests).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const _require = createRequire(import.meta.url);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS credentials (
  bill_to TEXT NOT NULL, slot TEXT NOT NULL,
  ciphertext BLOB NOT NULL, iv BLOB NOT NULL, tag BLOB NOT NULL,
  key_id TEXT NOT NULL, suffix TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_used_at TEXT, verified_at TEXT, verify_error TEXT,
  daily_usd REAL, monthly_usd REAL,
  PRIMARY KEY (bill_to, slot));
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY,
  spawn_id TEXT NOT NULL UNIQUE, run_id TEXT, thread_id TEXT, kind TEXT NOT NULL,
  bill_to TEXT NOT NULL, slots TEXT NOT NULL, issuer TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
  budget_usd REAL, spent_usd REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY, at TEXT NOT NULL, bill_to TEXT NOT NULL, slot TEXT NOT NULL,
  spawn_id TEXT, run_id TEXT, model TEXT, status INTEGER,
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  usd REAL, ms INTEGER);
CREATE INDEX IF NOT EXISTS usage_bill_to_at ON usage (bill_to, at);
CREATE INDEX IF NOT EXISTS usage_run ON usage (run_id);
CREATE INDEX IF NOT EXISTS tokens_issuer ON tokens (issuer);
`;

const iso = (ms) => new Date(ms).toISOString();

export function openStore(path = ':memory:') {
  const { DatabaseSync } = _require('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // Columns added after the first release, on existing databases too:
  //   credentials.kind   'api-key' | 'subscription' | 'github' (shown without decrypting)
  //   tokens.isolated    the spawn runs under its person's own agent user (a subscription
  //                      is only ever used by such a spawn in multi mode)
  //   usage.plan         'subscription' for calls on a Claude plan (no per-call price)
  const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name));
  if (!cols('credentials').has('kind')) db.exec('ALTER TABLE credentials ADD COLUMN kind TEXT');
  if (!cols('tokens').has('isolated')) db.exec('ALTER TABLE tokens ADD COLUMN isolated INTEGER NOT NULL DEFAULT 0');
  if (!cols('usage').has('plan')) db.exec('ALTER TABLE usage ADD COLUMN plan TEXT');
  const q = (sql) => db.prepare(sql);

  const s = {
    db,
    close() { try { db.close(); } catch { /* already closed */ } },

    // ── credentials ──
    putCredential({ billTo, slot, sealed, suffix, kind = null, verifiedAt = null, now = Date.now() }) {
      q(`INSERT INTO credentials (bill_to, slot, ciphertext, iv, tag, key_id, suffix, kind, created_at, updated_at, verified_at, verify_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT (bill_to, slot) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, tag = excluded.tag,
           key_id = excluded.key_id, suffix = excluded.suffix, kind = excluded.kind, updated_at = excluded.updated_at,
           verified_at = excluded.verified_at, verify_error = NULL`)
        .run(billTo, slot, sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyId, suffix, kind, iso(now), iso(now), verifiedAt ? iso(verifiedAt) : null);
    },
    getCredential(billTo, slot) {
      return q('SELECT * FROM credentials WHERE bill_to = ? AND slot = ?').get(billTo, slot) || null;
    },
    listCredentials(billTo) {
      return q('SELECT bill_to, slot, suffix, kind, key_id, created_at, updated_at, last_used_at, verified_at, verify_error, daily_usd, monthly_usd FROM credentials WHERE bill_to = ? ORDER BY slot').all(billTo);
    },
    allCredentials() {
      return q('SELECT * FROM credentials').all();
    },
    resealCredential(billTo, slot, sealed) {
      q('UPDATE credentials SET ciphertext = ?, iv = ?, tag = ?, key_id = ? WHERE bill_to = ? AND slot = ?')
        .run(sealed.ciphertext, sealed.iv, sealed.tag, sealed.keyId, billTo, slot);
    },
    deleteCredential(billTo, slot) {
      return q('DELETE FROM credentials WHERE bill_to = ? AND slot = ?').run(billTo, slot).changes;
    },
    markUsed(billTo, slot, now = Date.now()) {
      q('UPDATE credentials SET last_used_at = ? WHERE bill_to = ? AND slot = ?').run(iso(now), billTo, slot);
    },
    setVerify(billTo, slot, { ok, error = null, now = Date.now() }) {
      q('UPDATE credentials SET verified_at = ?, verify_error = ? WHERE bill_to = ? AND slot = ?')
        .run(iso(now), ok ? null : String(error || 'rejected').slice(0, 300), billTo, slot);
    },
    setCaps(billTo, slot, { dailyUsd = null, monthlyUsd = null }) {
      return q('UPDATE credentials SET daily_usd = ?, monthly_usd = ? WHERE bill_to = ? AND slot = ?')
        .run(dailyUsd, monthlyUsd, billTo, slot).changes;
    },

    // ── tokens ──
    insertToken(row) {
      q(`INSERT INTO tokens (hash, spawn_id, run_id, thread_id, kind, bill_to, slots, issuer, created_at, expires_at, budget_usd, isolated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(row.hash, row.spawnId, row.runId ?? null, row.threadId ?? null, row.kind, row.billTo,
          JSON.stringify(row.slots), row.issuer, iso(row.createdAt), iso(row.expiresAt), row.budgetUsd ?? null, row.isolated ? 1 : 0);
    },
    tokenByHash(hash) {
      return q('SELECT * FROM tokens WHERE hash = ?').get(hash) || null;
    },
    tokenBySpawn(spawnId) {
      return q('SELECT * FROM tokens WHERE spawn_id = ?').get(spawnId) || null;
    },
    revokeSpawn(spawnId, now = Date.now()) {
      return q('UPDATE tokens SET revoked_at = ? WHERE spawn_id = ? AND revoked_at IS NULL').run(iso(now), spawnId).changes;
    },
    revokeWhere({ issuer, runId, billTo, exceptIssuer }, now = Date.now()) {
      const where = []; const args = [];
      if (issuer) { where.push('issuer = ?'); args.push(issuer); }
      if (exceptIssuer) { where.push('issuer <> ?'); args.push(exceptIssuer); }
      if (runId) { where.push('run_id = ?'); args.push(runId); }
      if (billTo) { where.push('bill_to = ?'); args.push(billTo); }
      if (!where.length) return 0;
      return q(`UPDATE tokens SET revoked_at = ? WHERE revoked_at IS NULL AND ${where.join(' AND ')}`).run(iso(now), ...args).changes;
    },
    addSpend(hash, usd) {
      if (!(usd > 0)) return;
      q('UPDATE tokens SET spent_usd = spent_usd + ? WHERE hash = ?').run(usd, hash);
    },
    deleteExpiredTokens(now = Date.now()) {
      // Keep revoked/expired rows for a day so a late request still gets "expired or revoked".
      return q('DELETE FROM tokens WHERE expires_at < ?').run(iso(now - 86_400_000)).changes;
    },

    // ── usage ──
    insertUsage(u) {
      q(`INSERT INTO usage (at, bill_to, slot, spawn_id, run_id, model, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd, ms, plan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(iso(u.at ?? Date.now()), u.billTo, u.slot, u.spawnId ?? null, u.runId ?? null, u.model ?? null, u.status ?? null,
          u.inputTokens ?? 0, u.outputTokens ?? 0, u.cacheReadTokens ?? 0, u.cacheWriteTokens ?? 0, u.usd ?? 0, u.ms ?? null, u.plan ?? null);
    },
    spentSince(billTo, slot, sinceMs) {
      const r = q('SELECT COALESCE(SUM(usd), 0) AS usd FROM usage WHERE bill_to = ? AND slot = ? AND at >= ?').get(billTo, slot, iso(sinceMs));
      return Number(r?.usd || 0);
    },
    queryUsage({ since = null, billTo = null, runId = null, spawnId = null, limit = 1000 } = {}) {
      const where = []; const args = [];
      if (since) { where.push('at >= ?'); args.push(since); }
      if (billTo) { where.push('bill_to = ?'); args.push(billTo); }
      if (runId) { where.push('run_id = ?'); args.push(runId); }
      if (spawnId) { where.push('spawn_id = ?'); args.push(spawnId); }
      const lim = Math.max(1, Math.min(10_000, Number(limit) || 1000));
      return q(`SELECT at, bill_to AS billTo, slot, spawn_id AS spawnId, run_id AS runId, model, status,
          input_tokens AS inputTokens, output_tokens AS outputTokens, cache_read_tokens AS cacheReadTokens,
          cache_write_tokens AS cacheWriteTokens, usd, ms
        FROM usage ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${lim}`).all(...args);
    },
    /** Spend and volume per person and slot in [since, until): the Stats "By person" card. */
    summarizeUsage({ since = null, until = null } = {}) {
      const where = []; const args = [];
      if (since) { where.push('at >= ?'); args.push(since); }
      if (until) { where.push('at < ?'); args.push(until); }
      return q(`SELECT bill_to AS billTo, slot, COALESCE(plan, 'api') AS plan, COUNT(*) AS requests, COALESCE(SUM(usd), 0) AS usd,
          COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
          COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens, COALESCE(SUM(cache_write_tokens), 0) AS cacheWriteTokens,
          COUNT(DISTINCT run_id) AS runs, MAX(at) AS lastAt
        FROM usage ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY bill_to, slot, COALESCE(plan, 'api') ORDER BY usd DESC`).all(...args);
    },
    deleteOldUsage(now = Date.now()) {
      return q('DELETE FROM usage WHERE at < ?').run(iso(now - 400 * 86_400_000)).changes;
    },
  };
  return s;
}
