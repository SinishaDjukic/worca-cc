// experiments/messaging-bus/lib/sqlite.mjs
// Opens a node:sqlite DatabaseSync. The module is loaded LAZILY through createRequire, with its
// one-time ExperimentalWarning filtered, so the warning never lands in a script's measured output
// (the pattern of src/core/db.mjs:9-19, copied rather than imported: the spike imports nothing
// from src/).
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);
let DatabaseSync = null;

function databaseSyncCtor() {
  if (DatabaseSync) return DatabaseSync;
  const emit = process.emitWarning;
  process.emitWarning = function filtered(warning, ...rest) {
    const text = typeof warning === 'string' ? warning : warning?.message;
    const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type ?? warning?.name;
    if (type === 'ExperimentalWarning' && /sqlite/i.test(String(text))) return;
    return emit.call(process, warning, ...rest);
  };
  try {
    ({ DatabaseSync } = _require('node:sqlite'));
  } finally {
    process.emitWarning = emit;
  }
  return DatabaseSync;
}

export function openSqlite(path, { readOnly = false } = {}) {
  const Ctor = databaseSyncCtor();
  const db = readOnly ? new Ctor(path, { readOnly: true }) : new Ctor(path);
  db.exec('PRAGMA busy_timeout = 5000');
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  return db;
}
