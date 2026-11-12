// experiments/messaging-bus/lib/detect-state.mjs — the hook detector's state in the bus DB (plan §3.3, §4.4).
// One row set per scope = `<startMark>|<consumer>` (one publisher in one step attempt). Every write runs
// inside the caller's transaction. There is no dedup-key table: coalescing is a net surface diff (§3.3).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bus_detect_file (scope TEXT NOT NULL, file TEXT NOT NULL, kind TEXT NOT NULL,
  announced_json TEXT, current_json TEXT, first_json TEXT, window_call INTEGER, window_ts INTEGER,
  pending INTEGER NOT NULL DEFAULT 0, meta_json TEXT, PRIMARY KEY(scope, file));
CREATE TABLE IF NOT EXISTS bus_detect_outside (scope TEXT NOT NULL, file TEXT NOT NULL, PRIMARY KEY(scope, file));
CREATE TABLE IF NOT EXISTS bus_detect_counters (scope TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0,
  autos INTEGER NOT NULL DEFAULT 0, capped INTEGER NOT NULL DEFAULT 0, last_shown_id TEXT, last_shown_hop INTEGER,
  last_shown_call INTEGER);
CREATE TABLE IF NOT EXISTS bus_detect_snap (scope TEXT NOT NULL, tool_use_id TEXT NOT NULL, path TEXT NOT NULL,
  hash TEXT NOT NULL, PRIMARY KEY(scope, tool_use_id, path));
`;
// One Pre snapshot per Bash call (parallel calls each keep their own). The row with an empty path marks
// "a snapshot was taken", so an empty tree is told apart from a missing snapshot.
const TAKEN = '';

const j = (v) => (v === null || v === undefined ? null : JSON.stringify(v));
const p = (s) => (s === null || s === undefined ? null : JSON.parse(s));

export function openDetectState(db) {
  db.exec(SCHEMA);
  const q = {
    files: db.prepare('SELECT * FROM bus_detect_file WHERE scope = ? ORDER BY file'),
    putFile: db.prepare(`INSERT INTO bus_detect_file (scope, file, kind, announced_json, current_json, first_json, window_call, window_ts, pending, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope, file) DO UPDATE SET kind = excluded.kind,
      announced_json = excluded.announced_json, current_json = excluded.current_json, first_json = excluded.first_json,
      window_call = excluded.window_call, window_ts = excluded.window_ts, pending = excluded.pending, meta_json = excluded.meta_json`),
    outside: db.prepare('SELECT file FROM bus_detect_outside WHERE scope = ? ORDER BY file'),
    putOutside: db.prepare('INSERT OR IGNORE INTO bus_detect_outside (scope, file) VALUES (?, ?)'),
    counters: db.prepare('SELECT * FROM bus_detect_counters WHERE scope = ?'),
    putCounters: db.prepare(`INSERT INTO bus_detect_counters (scope, calls, autos, capped, last_shown_id, last_shown_hop, last_shown_call)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET calls = excluded.calls, autos = excluded.autos,
      capped = excluded.capped, last_shown_id = excluded.last_shown_id, last_shown_hop = excluded.last_shown_hop,
      last_shown_call = excluded.last_shown_call`),
    snap: db.prepare('SELECT path, hash FROM bus_detect_snap WHERE scope = ? AND tool_use_id = ? ORDER BY path'),
    putSnap: db.prepare('INSERT OR REPLACE INTO bus_detect_snap (scope, tool_use_id, path, hash) VALUES (?, ?, ?, ?)'),
    clearSnap: db.prepare('DELETE FROM bus_detect_snap WHERE scope = ? AND tool_use_id = ?'),
  };

  const getFiles = (scope) => {
    const out = {};
    for (const r of q.files.all(scope)) {
      out[r.file] = {
        kind: r.kind, announced: p(r.announced_json), current: p(r.current_json), first: p(r.first_json),
        windowCall: r.window_call, windowTs: r.window_ts, pending: !!r.pending,
        // who and what last changed the file: a coalesced flush carries them (owner, outsideTask, tool, toolUseId)
        ...(p(r.meta_json) ?? {}),
      };
    }
    return out;
  };
  const putFile = (scope, file, r) => q.putFile.run(scope, file, r.kind, j(r.announced), j(r.current), j(r.first),
    r.windowCall ?? null, r.windowTs ?? null, r.pending ? 1 : 0,
    j({ owner: r.owner ?? null, outsideTask: !!r.outsideTask, tool: r.tool ?? null, toolUseId: r.toolUseId ?? null }));
  const getOutside = (scope) => q.outside.all(scope).map((r) => r.file);
  const putOutside = (scope, file) => q.putOutside.run(scope, file);
  const getCounters = (scope) => {
    const r = q.counters.get(scope);
    if (!r) return { calls: 0, autos: 0, capped: false, lastShown: null };
    return {
      calls: r.calls, autos: r.autos, capped: !!r.capped,
      lastShown: r.last_shown_id ? { id: r.last_shown_id, hop: r.last_shown_hop, callNo: r.last_shown_call } : null,
    };
  };
  const putCounters = (scope, c) => q.putCounters.run(scope, c.calls ?? 0, c.autos ?? 0, c.capped ? 1 : 0,
    c.lastShown?.id ?? null, c.lastShown?.hop ?? null, c.lastShown?.callNo ?? null);
  const key = (toolUseId) => String(toolUseId ?? '');
  /** The Pre snapshot of one Bash call: `{ path → hash }`, or null when none was taken. */
  const getSnap = (scope, toolUseId) => {
    const rows = q.snap.all(scope, key(toolUseId));
    return rows.length ? Object.fromEntries(rows.filter((r) => r.path !== TAKEN).map((r) => [r.path, r.hash])) : null;
  };
  const putSnap = (scope, toolUseId, map) => {
    q.clearSnap.run(scope, key(toolUseId));
    q.putSnap.run(scope, key(toolUseId), TAKEN, 'taken');
    for (const [path, hash] of Object.entries(map ?? {})) q.putSnap.run(scope, key(toolUseId), path, hash);
  };
  const clearSnap = (scope, toolUseId) => q.clearSnap.run(scope, key(toolUseId));

  return {
    getFiles, putFile, getOutside, putOutside, getCounters, putCounters, getSnap, putSnap, clearSnap,
    /** The read-only snapshot the detector and the planner see; `snap` is the Pre snapshot of THIS tool call (null = none). */
    snapshot: (scope, toolUseId) => ({ files: getFiles(scope), outside: getOutside(scope), counters: getCounters(scope), snap: getSnap(scope, toolUseId) }),
    /** Applies a planner's `writes` (`{op:'file'|'outside'|'counters', …}`). */
    apply(scope, writes) {
      for (const w of writes) {
        if (w.op === 'file') putFile(scope, w.file, w.row);
        else if (w.op === 'outside') putOutside(scope, w.file);
        else if (w.op === 'counters') putCounters(scope, { ...getCounters(scope), ...w.row });
      }
    },
  };
}
