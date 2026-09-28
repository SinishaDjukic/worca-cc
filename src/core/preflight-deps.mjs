// src/core/preflight-deps.mjs
// Runtime preflight for the npm dependencies. Called once at each entry point
// (src/cli/worca-cc.mjs, ui/server.mjs) right after preflightNode(). Catches the
// source-checkout case where `git pull` brought a package.json that declares a
// package the local node_modules does not have yet (or has at an older version),
// which otherwise surfaces only when a lazily-imported module needs it — mid-run,
// as "Cannot find package 'yaml'".
//
// Pure, dependency-free: it reads package.json files directly (no require.resolve,
// which an `exports` map without "./package.json" would refuse) and walks up the
// node_modules chain the way Node's resolver does, so a global install whose
// dependencies npm hoisted above the package still passes.
//
// Sibling of preflight-node.mjs (the Node-RUNTIME preflight), which this reuses
// for the version compare.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { cmpVersions } from './preflight-node.mjs';

/** The package root: the directory holding worca's own package.json. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function core(v) {
  return String(v).trim().replace(/^v/i, '').split(/[-+]/, 1)[0].split('.').map((s) => parseInt(s, 10) || 0);
}

/**
 * Does `installed` satisfy `spec`? Understands the forms package.json uses here:
 * an exact pin ("2.9.1"), a caret ("^8.18.0", with npm's 0.x narrowing) and a
 * tilde ("~1.2.3"). Any other spec (a tag, a URL, a complex range) is not
 * second-guessed: presence is enough.
 * @param {string} installed
 * @param {string} spec
 * @returns {boolean}
 */
export function satisfies(installed, spec) {
  const s = String(spec).trim();
  const m = /^([\^~]?)v?(\d+(?:\.\d+){0,2})$/.exec(s);
  if (!m) return true;
  const [op, want] = [m[1], m[2]];
  if (op === '') return cmpVersions(installed, want) === 0;
  if (cmpVersions(installed, want) < 0) return false;
  const [iMaj, iMin] = core(installed);
  const [wMaj, wMin] = core(want);
  if (op === '~') return iMaj === wMaj && iMin === wMin;
  // Caret: the left-most non-zero component is locked (^1.2.3 → 1.x, ^0.2.3 → 0.2.x).
  if (wMaj !== 0) return iMaj === wMaj;
  if (wMin !== 0) return iMaj === 0 && iMin === wMin;
  return cmpVersions(installed, want) === 0;
}

/**
 * The installed version of `name` as Node would resolve it from `root`, or null
 * when no node_modules on the way up has it.
 * @param {string} name
 * @param {string} root
 * @returns {string | null}
 */
export function installedVersion(name, root) {
  let dir = root;
  for (;;) {
    const pkg = readJson(path.join(dir, 'node_modules', name, 'package.json'));
    if (pkg) return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * Every declared runtime dependency that is missing or does not satisfy its spec.
 * @param {string} [root=PACKAGE_ROOT]
 * @returns {{ name: string, spec: string, installed: string | null }[]}
 */
export function checkDeps(root = PACKAGE_ROOT) {
  const deps = readJson(path.join(root, 'package.json'))?.dependencies || {};
  const problems = [];
  for (const [name, spec] of Object.entries(deps)) {
    const installed = installedVersion(name, root);
    if (installed === null || !satisfies(installed, spec)) problems.push({ name, spec, installed });
  }
  return problems;
}

/**
 * The actionable message for a non-empty checkDeps() result.
 * @param {{ name: string, spec: string, installed: string | null }[]} problems
 * @param {string} [root=PACKAGE_ROOT]
 * @returns {string}
 */
export function formatDepsProblems(problems, root = PACKAGE_ROOT) {
  const lines = problems.map((p) => (p.installed === null
    ? `  missing   ${p.name}@${p.spec}`
    : `  outdated  ${p.name}@${p.spec} (installed ${p.installed})`));
  return (
    `\nworca: installed dependencies do not match package.json:\n` +
    `${lines.join('\n')}\n` +
    `  This usually means package.json changed (e.g. after \`git pull\`) since the\n` +
    `  last install. Run \`npm ci\` in ${root}, then re-run.\n\n`
  );
}

/**
 * Full dependency preflight: print the problems to stderr and exit 1 when any
 * declared dependency is missing or outdated; otherwise return normally.
 * Side-effecting on purpose, like preflightNode(); the helpers above are what
 * the unit tests exercise.
 * @param {{ root?: string, exit?: (code:number)=>never, err?: (s:string)=>void }} [io]
 */
export function preflightDeps(io = {}) {
  const root = io.root || PACKAGE_ROOT;
  const exit = io.exit || ((c) => process.exit(c));
  const err = io.err || ((s) => process.stderr.write(s));
  const problems = checkDeps(root);
  if (problems.length === 0) return;
  err(formatDepsProblems(problems, root));
  return exit(1);
}
