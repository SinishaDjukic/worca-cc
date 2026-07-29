// src/core/preflight-node.mjs  (FINAL)
// Runtime preflight for the node:sqlite backend. Called once at each entry point
// (src/cli/worca-cc.mjs, ui/server.mjs) BEFORE any DB is opened. Guarantees the
// process is on a Node with a FLAGLESS node:sqlite (>= 22.13.0) and that the module
// actually imports, then fails fast with an actionable message instead of letting a
// cryptic error surface deep inside db.mjs.
//
// Pure, dependency-free (semver-ish compare is hand-rolled — no new dependency,
// matching the project's "Node built-ins + express + ws" rule). Deliberately does
// NOT import db.mjs: the version check must not open the DB.
//
// NOTE: distinct from src/core/preflight.mjs (optional-TOOL detection, detectTools()).
// This is the Node-RUNTIME preflight.

import process from 'node:process';
import { createRequire } from 'node:module';

/** Minimum Node that ships a flagless node:sqlite (v22 LTS 'Jod' backport / v23.4+). */
export const MIN_NODE = '22.13.0';

const require = createRequire(import.meta.url);

/**
 * Parse a version string into [major, minor, patch] integers. Tolerant: ignores a
 * leading "v", ignores any pre-release/build suffix, treats missing/non-numeric
 * components as 0.
 * @param {string} v
 * @returns {[number, number, number]}
 */
function parse(v) {
  const core = String(v).trim().replace(/^v/i, '').split(/[-+]/, 1)[0];
  const [maj = '0', min = '0', pat = '0'] = core.split('.');
  const n = (s) => {
    const x = parseInt(s, 10);
    return Number.isFinite(x) ? x : 0;
  };
  return [n(maj), n(min), n(pat)];
}

/**
 * Compare two version strings numerically by major.minor.patch.
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1}
 */
export function cmpVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Is `actual` (default: the running process's Node) >= MIN_NODE?
 * @param {string} [actual=process.versions.node]
 * @returns {boolean}
 */
export function meetsMinNode(actual = process.versions.node) {
  return cmpVersions(actual, MIN_NODE) >= 0;
}

/**
 * Confirm node:sqlite imports and exposes DatabaseSync. Returns null on success or a
 * short error string on failure (never throws). node:sqlite is a builtin, so require
 * resolves synchronously even in this ESM module — keeping preflight a plain sync
 * call that matches the synchronous data layer.
 * @returns {string | null}
 */
export function probeSqlite() {
  try {
    const mod = require('node:sqlite');
    if (!mod || typeof mod.DatabaseSync !== 'function') {
      return 'node:sqlite imported but DatabaseSync is missing';
    }
    return null;
  } catch (err) {
    return err && err.message ? err.message : String(err);
  }
}

/**
 * Full runtime preflight. If the Node version is too old OR node:sqlite cannot be
 * loaded, print a clear, actionable message to stderr and exit non-zero (code 1).
 * Otherwise return normally. Called once per entry point before opening the DB.
 *
 * Kept side-effecting (writes stderr, calls process.exit) on purpose: it is the
 * single fail-fast gate. The pure helpers above are what the unit tests exercise.
 *
 * @param {{ exit?: (code:number)=>never, err?: (s:string)=>void }} [io] injectable
 *   for tests; defaults to process.exit / process.stderr.write.
 */
export function preflightNode(io = {}) {
  const exit = io.exit || ((c) => process.exit(c));
  const err = io.err || ((s) => process.stderr.write(s));
  const actual = process.versions.node;

  if (!meetsMinNode(actual)) {
    err(
      `\nworca: Node ${actual} is too old.\n` +
        `  Worca CC stores its state in SQLite via the built-in node:sqlite module,\n` +
        `  which is only available (flag-free) on Node >= ${MIN_NODE}.\n` +
        `  Please upgrade Node (e.g. \`nvm install --lts\` or use the bundled .nvmrc:\n` +
        `  \`nvm use\`), then re-run.\n\n`
    );
    return exit(1);
  }

  const sqliteErr = probeSqlite();
  if (sqliteErr) {
    err(
      `\nworca: the built-in node:sqlite module could not be loaded.\n` +
        `  (${sqliteErr})\n` +
        `  Worca CC requires Node >= ${MIN_NODE} with node:sqlite available.\n` +
        `  You are on Node ${actual}. Upgrade Node (\`nvm use\` with the bundled\n` +
        `  .nvmrc) and re-run.\n\n`
    );
    return exit(1);
  }
}
