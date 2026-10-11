#!/usr/bin/env node
// tools/smoke-tree.mjs
// A normalised manifest of a smoke run's WORCA_HOME, so two runs (the base and a
// refactor) can be compared with `diff`: every file path and text body with ids,
// dates, timestamps and durations replaced (timing numbers become 0 so JSON stays
// parseable), plus every DB row with its volatile columns dropped. A manifest of the SAME commit run twice must diff clean; if it
// does not, extend normalise() before trusting it. Given a FILE instead of a
// directory (a smoke's console output), it prints that file normalised.
//
//   node --disable-warning=ExperimentalWarning tools/smoke-tree.mjs .worca-cc-smoke > base.txt
//   node --disable-warning=ExperimentalWarning tools/smoke-tree.mjs smoke-plugin.log > base-log.txt
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.argv[2];
if (!root) { console.error('usage: smoke-tree.mjs <WORCA_HOME|file>'); process.exit(2); }

const VOLATILE_COL = /(_at|_ms|^ts$|duration|started|finished|created|updated|pid|elapsed)/i;

function normalise(s) {
  return String(s)
    .split(root).join('<HOME>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TS>')
    .replace(/\b\d{2}-\d{2}-\d{2}-/g, '<DATE>-')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/(worca-cc-smoke-[\w-]*?-)[A-Za-z0-9]{6}(?![A-Za-z0-9])/gi, '$1<RND>') // mkdtemp suffixes of the smoke tools
    .replace(/^index [0-9a-f]+\.\.[0-9a-f]+/gm, 'index <SHA>..<SHA>')
    .replace(/`[0-9a-f]{7,40}`/g, '`<SHA>`')
    .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{9,40}\b/g, '<SHA>')
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s"'`)\\]*/g, '<TMP>')
    .replace(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{8}\b/g, '<ID>')
    // An all-digit id (an 8-hex id with no letter, about 1 in 40): any standalone
    // 8-digit token, wherever it sits (prose "(id 12345678)", an escaped JSON
    // string `…-12345678\"`), but never a JSON number value (after `:`, `[` or
    // `,`) and never part of a longer number or a decimal.
    .replace(/(?<![\w.]|[:[,]\s*)\d{8}(?!\w|\.\d)/g, '<ID>')
    .replace(/"(\w*(?:Ms|At|_ms|_at|ts|elapsed))"\s*:\s*("[^"]*"|\d+(?:\.\d+)?)/g, '"$1":0')
    .replace(/\b\d{10,13}\b/g, '0');
}

/** JSON with object keys and array items sorted, and JSON held in string
 *  values (DB columns) parsed too: order that follows a random name carries no
 *  signal here, content does. */
function sortDeep(v) {
  if (typeof v === 'string' && /^[[{]/.test(v)) {
    try { return sortDeep(JSON.parse(v)); } catch { return v; }
  }
  if (Array.isArray(v)) return v.map(sortDeep).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
}
function canonical(text) {
  try { return JSON.stringify(sortDeep(JSON.parse(text)), null, 1); } catch { return text; }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (statSync(root).isFile()) {
  process.stdout.write(normalise(readFileSync(root, 'utf8')));
  process.exit(0);
}

const lines = [];
for (const file of walk(root)) {
  const rel = normalise(relative(root, file));
  if (/worca-cc\.db(-wal|-shm)?$/.test(file)) { lines.push(`file ${rel}`); continue; }
  const text = normalise(readFileSync(file, 'utf8'));
  // A workspace run orders its member projects by a hash of their (random) temp
  // path, so JSON key order and patch section order carry no signal: compare
  // canonical JSON and the patch's lines as a sorted multiset.
  const body = file.endsWith('.json') ? canonical(text)
    : file.endsWith('.patch') ? text.split('\n').sort().join('\n') : text;
  lines.push(`file ${rel} ${createHash('sha256').update(body).digest('hex').slice(0, 16)}`);
}

const dbPath = walk(root).find((f) => f.endsWith('worca-cc.db'));
if (dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t}"`).all().map((r) => {
      // Integer row ids follow insertion order, which follows the same hash order.
      const kept = Object.fromEntries(Object.entries(r).filter(([k, v]) => !VOLATILE_COL.test(k) && !(k === 'id' && typeof v === 'number')));
      return canonical(normalise(JSON.stringify(kept))).replace(/\n\s*/g, ' ');
    }).sort();
    for (const row of rows) lines.push(`row ${t} ${row}`);
  }
  db.close();
}
process.stdout.write(`${lines.sort().join('\n')}\n`);
