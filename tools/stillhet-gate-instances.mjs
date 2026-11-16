#!/usr/bin/env node
// tools/stillhet-gate-instances.mjs — starts, lists and stops the gate instances A–D of plans/rail/test-protocol.md §2,
// each with its OWN HOME. settings.json is read and written at $HOME/.worca-cc (src/core/settings.mjs defaultRoot), never at
// WORCA_HOME, so an instance started without its own HOME changes the owner's real settings (F-X-01). A and B get a copy of
// the owner's store (an APFS clone where it can; the real store is only read) made independent of it: the repos it names are
// cloned into the instance HOME and every record and git link points there, so nothing done on A or B reaches the owner's
// real repos (C1, isolateCopy / verifyIsolation; a copy that still leads outside its HOME is refused); copied schedules are turned off,
// every clone pushes to HOME/outside/no-push, and no instance env carries a GitHub credential. C and D start empty. `rail` lives in each
// instance's own settings.json and never in WORCA_FLAGS, so it stays unlocked (P11). Stop kills only the processes this tool
// started (a pid file per HOME, checked against the process's start time and command). `login-status` and `login X` check
// and run the Claude CLI's own login under each HOME; the CLI's output is never printed, logged or stored.
//
// Run: node tools/stillhet-gate-instances.mjs start [A,B,C,D] [--root DIR] [--port A=4601] [--no-mock B] [--mock-env WORCA_MOCK_X=v]
//        [--welcome] [--ui-level simple|advanced|expert] [--fresh]
//      node tools/stillhet-gate-instances.mjs list | stop [letters] | login-status [letters] | login X   [--root DIR]
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, constants as FS, cpSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { CLAUDE_AUTH_ENV_FLAGS, CLAUDE_AUTH_ENV_KEYS, isClaudeSignedOutError, parseClaudeAuthConfigDir, parseClaudeAuthStatus } from '../src/core/preflight.mjs';
import { GITHUB_CREDENTIAL_KEYS } from '../src/core/github-credentials.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER_PORT = 4317;
const UI_LEVELS = ['simple', 'advanced', 'expert'];
const SERVER_PATH = fileURLToPath(new URL('../ui/server.mjs', import.meta.url));

/** The protocol's four targets (test-protocol §2). */
export const INSTANCES = Object.freeze({
  A: Object.freeze({ port: 4501, rail: false, store: 'copy' }),
  B: Object.freeze({ port: 4502, rail: true, store: 'copy' }),
  C: Object.freeze({ port: 4503, rail: false, store: 'empty' }),
  D: Object.freeze({ port: 4504, rail: true, store: 'empty' }),
});
export const RECORD_FILE = 'gate-instance.json';

export class GateInstanceError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const refuse = (code, message) => { throw new GateInstanceError(code, message); };

const letterList = (v) => String(v || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const realHomeDefault = () => os.userInfo().homedir;

/** argv (after the script) → options. Unknown flags throw `bad-arg`. */
export function parseArgs(argv) {
  const opts = { cmd: null, letters: [], root: null, ports: {}, noMock: new Set(), mockEnv: {}, welcome: false, uiLevel: null, fresh: false };
  const args = [...argv];
  const value = (flag) => {
    if (!args.length || args[0].startsWith('--')) refuse('bad-arg', `${flag} needs a value`);
    return args.shift();
  };
  while (args.length) {
    const a = args.shift();
    if (a === '--root') opts.root = value(a);
    else if (a === '--port') {
      const m = /^([A-Za-z])=(\d+)$/.exec(value(a));
      if (!m) refuse('bad-arg', '--port takes X=N, e.g. --port A=4601');
      opts.ports[m[1].toUpperCase()] = Number(m[2]);
    } else if (a === '--no-mock') for (const l of letterList(value(a))) opts.noMock.add(l);
    else if (a === '--mock-env') {
      const kv = value(a), at = kv.indexOf('=');
      if (at <= 0) refuse('bad-arg', '--mock-env takes KEY=VALUE');
      opts.mockEnv[kv.slice(0, at)] = kv.slice(at + 1);
    } else if (a === '--welcome') opts.welcome = true;
    else if (a === '--ui-level') {
      opts.uiLevel = value(a);
      if (!UI_LEVELS.includes(opts.uiLevel)) refuse('bad-arg', `--ui-level is one of ${UI_LEVELS.join(', ')}`);
    } else if (a === '--fresh') opts.fresh = true;
    else if (a.startsWith('--')) refuse('bad-arg', `unknown flag ${a}`);
    else if (!opts.cmd) opts.cmd = a;
    else opts.letters.push(...letterList(a));
  }
  return opts;
}

/** A path compared as the OS sees it: realpath of its nearest existing ancestor plus the rest (/var is /private/var). */
function canon(p) {
  const abs = path.resolve(p);
  let head = abs, rest = '';
  while (!existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) return abs;
    rest = rest ? path.join(path.basename(head), rest) : path.basename(head);
    head = up;
  }
  try { head = realpathSync(head); } catch { /* keep the resolved path */ }
  return rest ? path.join(head, rest) : head;
}
const within = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** Refuses an instance HOME that is the real home. */
export function assertSafeHome(home, { realHome = realHomeDefault() } = {}) {
  if (canon(home) === canon(realHome)) refuse('real-home', `HOME ${home} is the real home; an instance needs its own`);
}

/** Refuses the owner's port and a port outside 1024–65535. */
export function assertSafePort(port) {
  if (port === OWNER_PORT) refuse('owner-port', `port ${OWNER_PORT} is the owner's live instance; pick another port`);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) refuse('bad-port', `port ${port} is outside 1024–65535`);
}

/** The instances to act on. Pure: every refusal is thrown here, before anything is written. */
export function planInstances(opts, { realHome = realHomeDefault(), tmp = os.tmpdir() } = {}) {
  const root = path.resolve(opts.root || path.join(tmp, 'worca-gate-instances'));
  const realRoot = canon(root);
  if (realRoot === canon(realHome) || within(realRoot, canon(path.join(realHome, '.worca-cc')))) {
    refuse('root-in-real-store', `root ${root} is the real home or inside its .worca-cc; pick another --root`);
  }
  const letters = opts.letters.length ? opts.letters : Object.keys(INSTANCES);
  for (const l of [...letters, ...Object.keys(opts.ports), ...opts.noMock]) {
    if (!INSTANCES[l]) refuse('unknown-letter', `unknown instance ${l}; the instances are A, B, C and D`);
  }
  for (const k of Object.keys(opts.mockEnv)) {
    if (!/^WORCA_MOCK_[A-Z0-9_]+$/.test(k)) refuse('bad-mock-env', `only WORCA_MOCK_* keys may be passed (${k})`);
  }
  return [...new Set(letters)].sort().map((letter) => {
    const home = path.join(root, letter);
    assertSafeHome(home, { realHome });
    const port = opts.ports[letter] ?? INSTANCES[letter].port;
    assertSafePort(port);
    const mock = !opts.noMock.has(letter);
    return { letter, home, port, rail: INSTANCES[letter].rail, store: INSTANCES[letter].store, mock, mockEnv: mock ? { ...opts.mockEnv } : {} };
  });
}

// Nothing an instance spawns may reach the owner's GitHub: no token, no SSH agent, no "push as me" broker, no git config
// passed in the env (a credential helper), and gh and git read their config inside the instance HOME, where none exists.
const GITHUB_REACH_ENV = Object.freeze([...GITHUB_CREDENTIAL_KEYS, 'SSH_AUTH_SOCK', 'WORCA_BROKER_URL', 'WORCA_GH_AS_PERSON', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']);
const isGitConfigPair = (k) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k);

/** The instance server's env (D7): its own HOME, nothing that leads back to the owner's flags, login or GitHub. Pure. */
export function buildInstanceEnv(inst, baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const k of ['WORCA_FLAGS', 'CLAUDE_CONFIG_DIR', 'NODE_TEST_CONTEXT', 'WORCA_TEST_ALLOW_HOME_FALLBACK', ...CLAUDE_AUTH_ENV_KEYS, ...CLAUDE_AUTH_ENV_FLAGS, ...GITHUB_REACH_ENV]) delete env[k];
  for (const k of Object.keys(env)) if (isGitConfigPair(k)) delete env[k];
  env.GH_CONFIG_DIR = path.join(inst.home, '.config', 'gh');
  env.GIT_CONFIG_GLOBAL = path.join(inst.home, '.gitconfig');
  env.GIT_CONFIG_NOSYSTEM = '1';   // the system config holds the keychain credential helper on macOS
  env.HOME = inst.home;
  env.USERPROFILE = inst.home;
  // WORCA_HOME is the BASE: the store is WORCA_HOME/.worca-cc (src/core/projects.mjs worcaHome), the same folder as the
  // settings, as on the owner's machine. HOME/.worca-cc here would open an empty HOME/.worca-cc/.worca-cc beside the copy.
  env.WORCA_HOME = inst.home;
  env.PORT = String(inst.port);
  env.WORCA_AUTO_RESUME = '0';
  if (inst.mock) Object.assign(env, { WORCA_MOCK: '1' }, inst.mockEnv || {});
  else { delete env.WORCA_MOCK; delete env.ORCH_MOCK; }
  return env;
}

/** What in a server env could still reach the owner's GitHub. Empty when none. */
export function envProblems(env, home) {
  const bad = [];
  for (const k of Object.keys(env)) if (GITHUB_REACH_ENV.includes(k) || isGitConfigPair(k)) bad.push(`env ${k} set`);
  for (const k of ['GH_CONFIG_DIR', 'GIT_CONFIG_GLOBAL']) if (!env[k] || !within(path.resolve(env[k]), path.resolve(home))) bad.push(`env ${k} outside ${home}: ${env[k] ?? '(unset)'}`);
  if (env.GIT_CONFIG_NOSYSTEM !== '1') bad.push('env GIT_CONFIG_NOSYSTEM not 1');
  return bad;
}

/** The instance's settings.json (D6): rail per instance, the welcome dialog seen, expert on an empty install. Pure. */
export function instanceSettings(existing, inst, { welcome = false, uiLevel = null } = {}) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const out = { ...base };
  out.flags = { ...(base.flags && typeof base.flags === 'object' ? base.flags : {}), rail: inst.rail };
  out.onboarding = { ...(base.onboarding && typeof base.onboarding === 'object' ? base.onboarding : {}), welcomeSeen: !welcome };
  if (uiLevel) out.uiLevel = uiLevel;
  else if (inst.store === 'empty' && !base.uiLevel) out.uiLevel = 'expert';
  return out;
}

/** Copies the store: an APFS clone on darwin (`cp -cR`), else a copy-on-write copy where the file system has one. */
function cpStore(src, dst) {
  if (process.platform === 'darwin') {
    try { execFileSync('cp', ['-cR', src, dst], { stdio: 'ignore' }); return 'clone'; } catch { rmSync(dst, { recursive: true, force: true }); }
  }
  cpSync(src, dst, { recursive: true, mode: FS.COPYFILE_FICLONE });
  return 'copy';
}

// ── C1: a copied instance can never change the owner's real repos ─────────────────────────────────────────────────────
// The copy's records name the owner's real repos (projectDir, realDir, projects.path …) and its checkouts' .git files lead
// into them, so a delete or archive of a copied run would `git branch -D` and `git worktree remove` there
// (src/core/pipeline-delete.mjs → removeWorktree). isolateCopy makes the copy independent: every repo the copy names is
// cloned into HOME/repos (APFS clone; the real repo is only read), every record and every git link is rewritten to the
// copy, and a path that cannot be copied (missing, the real home, a dot folder in it) is pointed at HOME/outside/…, which
// never exists. verifyIsolation then checks the result on every A/B start; anything still outside HOME refuses the start.
const PATH_CHARS = 'A-Za-z0-9._\\-~@+';
const PATH_COLUMN = /(^|_)(dir|path|cwd|root)$/i;
const PATH_KEY = /(dir|path|root|cwd)$/i;
const PROJECT_FIELD = /^(path|project_dir|projectDir|realDir|repoDir|projectPath)$/;
const q = (name) => `"${name.replaceAll('"', '""')}"`;
const gitOut = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** Replaces paths in text. `prefix` pairs also map every path under `from`; exact pairs only `from` itself. A match never
 *  starts or ends inside a longer path name (/x/repo never hits /x/repo-2). JSON-escaped spellings are mapped too. */
export function pathRewriter(pairs) {
  const all = new Map();
  for (const p of pairs) {
    for (const [from, to] of [[p.from, p.to], [JSON.stringify(p.from).slice(1, -1), JSON.stringify(p.to).slice(1, -1)]]) {
      if (from && !all.has(from)) all.set(from, { from, to, prefix: p.prefix });
    }
  }
  if (!all.size) return (s) => s;
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alts = [...all.values()].sort((a, b) => b.from.length - a.from.length)
    .map((p) => `${esc(p.from)}(?![${PATH_CHARS}${p.prefix ? '' : '/'}])`);
  const re = new RegExp(`(?<![${PATH_CHARS}/])(?:${alts.join('|')})`, 'g');
  return (s) => s.replace(re, (m) => all.get(m).to);
}

/** The DB's ordinary tables and their columns (FTS and other virtual tables and their shadow tables are left alone). */
function plainTables(db) {
  const rows = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const virtual = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(r.sql || '')).map((r) => r.name);
  return rows.filter((r) => !virtual.some((v) => r.name === v || r.name.startsWith(`${v}_`)))
    .map((r) => ({ name: r.name, cols: db.prepare(`PRAGMA table_info(${q(r.name)})`).all().map((c) => c.name) }));
}

/** Every .json file of the store outside the checkouts (runs/ID/run.json, settings.json, run-slots, terminal, ask …). */
function storeJsonFiles(store) {
  if (!existsSync(store)) return [];
  const r = spawnSync('find', [store, '(', '-name', 'repos', '-o', '-name', 'wt', '-o', '-name', 'node_modules', '-o', '-name', '.git', ')', '-prune',
    '-o', '-type', 'f', '-name', '*.json', '-print'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.stdout.split('\n').filter(Boolean);
}

function* jsonPaths(v, key = '') {
  if (typeof v === 'string') { if (PATH_KEY.test(key) && path.isAbsolute(v)) yield { field: key, value: v }; return; }
  if (Array.isArray(v)) { for (const x of v) yield* jsonPaths(x, key); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* jsonPaths(x, k);
}
function* textPaths(text, column) {
  if (PATH_COLUMN.test(column) && path.isAbsolute(text) && !text.includes('\n')) yield { field: column, value: text };
  else if (/^\s*[[{]/.test(text)) { let v; try { v = JSON.parse(text); } catch { return; } yield* jsonPaths(v); }
}

/** Every path a record of the store acts on: path columns, path keys inside JSON columns, and the store's .json files. */
function* storeRecordPaths(store) {
  const dbFile = path.join(store, 'worca-cc.db');
  if (existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      for (const { name, cols } of plainTables(db)) {
        for (const col of cols) {
          for (const row of db.prepare(`SELECT ${q(col)} AS v FROM ${q(name)} WHERE typeof(${q(col)}) = 'text' AND instr(${q(col)}, '/') > 0`).all()) {
            for (const p of textPaths(row.v, col)) yield { where: `${name}.${col}`, ...p };
          }
        }
      }
    } finally { db.close(); }
  }
  for (const file of storeJsonFiles(store)) {
    let v;
    try { v = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    for (const p of jsonPaths(v)) yield { where: path.relative(store, file), ...p };
  }
}

/** Rewrites every text value of the DB and every .json file of the store. */
function rewriteStore(store, rw) {
  const dbFile = path.join(store, 'worca-cc.db');
  if (existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile);
    try {
      db.function('gate_rw', { deterministic: true }, (v) => (typeof v === 'string' ? rw(v) : v));
      for (const { name, cols } of plainTables(db)) {
        for (const c of cols.map(q)) {
          db.prepare(`UPDATE ${q(name)} SET ${c} = gate_rw(${c}) WHERE typeof(${c}) = 'text' AND instr(${c}, '/') > 0 AND gate_rw(${c}) <> ${c}`).run();
        }
      }
    } finally { db.close(); }
  }
  for (const file of storeJsonFiles(store)) {
    const text = readFileSync(file, 'utf8');
    const next = rw(text);
    if (next !== text) writeFileSync(file, next);
  }
}

/** Every `.git` under dir (node_modules skipped). */
function gitEntries(dir) {
  if (!existsSync(dir)) return [];
  const r = spawnSync('find', [dir, '-name', 'node_modules', '-prune', '-o', '-name', '.git', '-print'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return r.stdout.split('\n').filter(Boolean);
}
const gitdirOf = (file) => {
  const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(file, 'utf8'));
  return m ? path.resolve(path.dirname(file), m[1].trim()) : null;
};
/** The link files of a git dir: each registered worktree's gitdir, the object alternates, the config (local remotes). */
function gitDirLinks(g) {
  const out = [];
  const wts = path.join(g, 'worktrees');
  if (existsSync(wts)) for (const n of readdirSync(wts)) if (existsSync(path.join(wts, n, 'gitdir'))) out.push({ kind: 'admin', file: path.join(wts, n, 'gitdir') });
  for (const [kind, rel] of [['alternates', path.join('objects', 'info', 'alternates')], ['config', 'config']]) {
    if (existsSync(path.join(g, rel))) out.push({ kind, file: path.join(g, rel) });
  }
  return out;
}
/** The paths one git link file leads to. */
function linkTargets({ kind, file }) {
  const text = readFileSync(file, 'utf8');
  if (kind === 'dotgit') { const t = gitdirOf(file); return t ? [t] : []; }
  if (kind === 'admin') return text.trim() ? [path.resolve(path.dirname(file), text.trim())] : [];
  if (kind === 'alternates') return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => path.resolve(path.dirname(path.dirname(file)), l));
  return [...text.matchAll(/^\s*url\s*=\s*(.+)$/gm)].map((m) => m[1].trim()).filter((u) => u.startsWith('/') || u.startsWith('file://'))
    .map((u) => u.replace(/^file:\/\//, ''));
}
function gitLinks(home) {
  const out = [];
  for (const g of gitEntries(home)) {
    let st;
    try { st = statSync(g); } catch { continue; }
    if (st.isFile()) out.push({ kind: 'dotgit', file: g });
    else out.push(...gitDirLinks(g));
  }
  return out;
}

/** The repos a path belongs to: its main repo (the git common dir's parent) and its own checkout top. Null when no repo. */
function gitRootsOf(value, isGitdir) {
  let dir = value;
  try { if (!isGitdir && statSync(value).isFile()) dir = path.dirname(value); } catch { return null; }
  const at = isGitdir ? ['--git-dir', dir] : ['-C', dir];
  const common = gitOut([...at, 'rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  const main = path.basename(common) === '.git' ? path.dirname(common) : common;
  const top = isGitdir ? null : gitOut([...at, 'rev-parse', '--path-format=absolute', '--show-toplevel']);
  return [...new Set([main, top].filter(Boolean))];
}
/** A root that may be cloned: never the real home or above it, a dot folder in it (~/.claude, ~/.ssh), or above HOME. */
function copyable(root, realHome, home) {
  const r = canon(root), h = canon(realHome);
  if (within(h, r) || within(canon(home), r)) return false;
  const rel = path.relative(h, r);
  return !(within(r, h) && rel.startsWith('.'));
}

/** Makes a freshly copied store independent of the owner's (C1). Returns `{ repos, placeholders }`. Exported for tests. */
export function isolateCopy(store, { home, realStore, realHome, cp = cpStore }) {
  const storePairs = [...new Set([path.resolve(realStore), canon(realStore)])].map((from) => ({ from, to: path.resolve(store), prefix: true }));
  rewriteStore(store, pathRewriter(storePairs));

  const sources = [];
  for (const r of storeRecordPaths(store)) sources.push({ value: r.value, project: PROJECT_FIELD.test(r.field) });
  // a checkout's .git file leads to its repo; a local remote is a repo too. A registration of a checkout outside the copy
  // is not followed (it is dropped below), and alternates outside it are left for verifyIsolation to refuse.
  for (const l of gitLinks(store)) if (l.kind === 'dotgit' || l.kind === 'config') for (const t of linkTargets(l)) sources.push({ value: t, gitdir: l.kind === 'dotgit' });
  const homeC = canon(home);
  const wanted = [];
  const exact = new Map();
  const seen = new Set();
  sources.sort((a, b) => Number(!!b.project) - Number(!!a.project));   // a project field may clone a folder; decide that first
  for (const s of sources) {
    if (seen.has(s.value) || within(canon(s.value), homeC)) continue;
    seen.add(s.value);
    let roots = gitRootsOf(s.value, s.gitdir);
    if (!roots && s.project && !s.gitdir) { try { if (statSync(s.value).isDirectory()) roots = [s.value]; } catch { /* missing */ } }
    if (roots && roots.every((r) => copyable(r, realHome, home))) wanted.push({ value: s.value, roots: roots.map(canon) });
    else exact.set(s.value, path.join(home, 'outside', path.resolve(s.value)));
  }
  const tops = [];
  for (const r of [...new Set(wanted.flatMap((w) => w.roots))].sort((a, b) => a.length - b.length)) if (!tops.some((t) => within(r, t))) tops.push(r);
  const dest = new Map(tops.map((t) => [t, path.join(home, 'repos', createHash('sha1').update(t).digest('hex').slice(0, 8), path.basename(t))]));
  for (const [t, d] of dest) { mkdirSync(path.dirname(d), { recursive: true }); cp(t, d); }

  const pairs = [...storePairs, ...[...dest].map(([from, to]) => ({ from, to, prefix: true }))];
  for (const w of wanted) {   // the spelling a record uses (/var/… for /private/var/…) maps to the same copy
    const c = canon(w.value), t = tops.find((x) => within(c, x));
    if (t && path.resolve(w.value) !== c) pairs.push({ from: path.resolve(w.value), to: path.join(dest.get(t), path.relative(t, c)), prefix: true });
  }
  for (const [from, to] of exact) pairs.push({ from: path.resolve(from), to, prefix: false });
  const rw = pathRewriter(pairs);
  rewriteStore(store, rw);
  for (const l of gitLinks(home)) {
    const text = readFileSync(l.file, 'utf8');
    const next = rw(text);
    if (next !== text) writeFileSync(l.file, next);
    // a copied repo's registration of a checkout that is not in this copy (an owner worktree elsewhere) is dropped from the copy
    if (l.kind === 'admin' && linkTargets(l).some((t) => !within(canon(t), homeC))) rmSync(path.dirname(l.file), { recursive: true, force: true });
  }
  const gitDirs = blockPushes(home);
  const { schedules, tickets } = stopCopiedSchedules(store);
  writeFileSync(path.join(store, COPY_RECORD), JSON.stringify({ copiedAt: new Date().toISOString(), schedules, tickets, gitDirs }, null, 2) + '\n');
  return { repos: tops.length, placeholders: exact.size };
}

// ── Owner decisions on PLAN-Gc: a copy never fires a copied schedule and never pushes ─────────────────────────────────
// The copy's record (in its store) names what was copied, so a schedule or clone made later inside the instance is its own.
const COPY_RECORD = 'gate-copy.json';
const PENDING_TICKET = ['scheduled', 'missed', 'firing'];
const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(t);

/** Turns every copied schedule off: active series are paused (as a user pause would), and every run waiting for its time
 *  is canceled. Returns the copied ids. */
function stopCopiedSchedules(store) {
  const dbFile = path.join(store, 'worca-cc.db');
  if (!existsSync(dbFile)) return { schedules: [], tickets: [] };
  const db = new DatabaseSync(dbFile);
  try {
    const now = new Date().toISOString();
    const out = { schedules: [], tickets: [] };
    if (hasTable(db, 'schedules')) {
      out.schedules = db.prepare('SELECT id FROM schedules ORDER BY id').all().map((r) => r.id);
      db.prepare("UPDATE schedules SET status = 'paused', pause_reason = 'user', next_run_at = NULL, updated_at = ? WHERE status = 'active'").run(now);
    }
    if (hasTable(db, 'scheduled_runs')) {
      out.tickets = db.prepare('SELECT id FROM scheduled_runs ORDER BY id').all().map((r) => r.id);
      db.prepare(`UPDATE scheduled_runs SET status = 'canceled', updated_at = ? WHERE status IN (${PENDING_TICKET.map(() => '?').join(', ')})`).run(now, ...PENDING_TICKET);
    }
    return out;
  } finally { db.close(); }
}

/** `{ name: { urls, pushurls } }` of a git dir's remotes, read from its config file. */
function remotesOf(gitDir) {
  const out = {};
  const r = spawnSync('git', ['config', '--file', path.join(gitDir, 'config'), '--get-regexp', '^remote\\..*\\.(url|pushurl)$'], { encoding: 'utf8' });
  for (const line of (r.stdout || '').split('\n').filter(Boolean)) {
    const m = /^remote\.(.+)\.(url|pushurl) (.*)$/.exec(line);
    if (!m) continue;
    const e = (out[m[1]] ||= { urls: [], pushurls: [] });
    (m[2] === 'url' ? e.urls : e.pushurls).push(m[3]);
  }
  return out;
}
const gitDirsIn = (dir) => gitEntries(dir).filter((g) => { try { return statSync(g).isDirectory(); } catch { return false; } });

/** Points every remote's push URL of every git dir in HOME at HOME/outside/no-push, which never exists: fetch keeps its
 *  URL, a push fails. Returns the git dirs. */
function blockPushes(home) {
  const noPush = path.join(home, 'outside', 'no-push');
  const dirs = gitDirsIn(home);
  for (const g of dirs) {
    for (const name of Object.keys(remotesOf(g))) {
      execFileSync('git', ['config', '--file', path.join(g, 'config'), '--replace-all', `remote.${name}.pushurl`, noPush], { stdio: 'ignore' });
    }
  }
  return dirs;
}

/** A copy's schedules still on and remotes that can push outside its HOME. */
function copyProblems(home) {
  const homeC = canon(home);
  const store = path.join(home, '.worca-cc');
  let rec = null;
  try { rec = JSON.parse(readFileSync(path.join(store, COPY_RECORD), 'utf8')); } catch { /* a copy made before the record: everything counts as copied */ }
  const bad = [];
  const dbFile = path.join(store, 'worca-cc.db');
  if (existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const copied = (ids) => (id) => !rec || (ids || []).includes(id);
      if (hasTable(db, 'schedules')) {
        for (const r of db.prepare("SELECT id FROM schedules WHERE status = 'active' ORDER BY id").all()) if (copied(rec?.schedules)(r.id)) bad.push(`schedule ${r.id} enabled`);
      }
      if (hasTable(db, 'scheduled_runs')) {
        for (const r of db.prepare(`SELECT id FROM scheduled_runs WHERE status IN (${PENDING_TICKET.map(() => '?').join(', ')}) ORDER BY id`).all(...PENDING_TICKET)) {
          if (copied(rec?.tickets)(r.id)) bad.push(`scheduled run ${r.id} pending`);
        }
      }
    } finally { db.close(); }
  }
  const dirs = new Set([...(rec?.gitDirs || []).filter((g) => existsSync(g)), ...gitDirsIn(path.join(home, 'repos'))]);
  for (const g of dirs) {
    for (const [name, { urls, pushurls }] of Object.entries(remotesOf(g))) {
      for (const u of pushurls.length ? pushurls : urls) {
        const local = u.startsWith('/') || u.startsWith('file://') ? u.replace(/^file:\/\//, '') : null;
        if (!local || !within(canon(local), homeC)) bad.push(`${g} remote ${name} push URL outside HOME: ${u}`);
      }
    }
  }
  return bad;
}

/** Everything in an instance HOME that still leads outside it: a record's path, a .git file, a worktree registration,
 *  object alternates, a local remote, a remote that can push outside HOME, or a copied schedule still on. Empty when the
 *  copy is independent. */
export function verifyIsolation(home) {
  const homeC = canon(home);
  const store = path.join(home, '.worca-cc');
  const bad = [];
  for (const r of storeRecordPaths(store)) if (!within(canon(r.value), homeC)) bad.push(`${r.where} ${r.field}: ${r.value}`);
  for (const l of gitLinks(home)) for (const t of linkTargets(l)) if (!within(canon(t), homeC)) bad.push(`${l.file} (${l.kind}): ${t}`);
  bad.push(...copyProblems(home));
  return bad;
}

/** Creates the instance HOME, copies and isolates the store into A/B the first time, refuses a copy that still leads
 *  outside its HOME, and writes its settings by tmp and rename. */
export async function prepareHome(inst, { realHome = realHomeDefault(), fresh = false, cp = cpStore, welcome = false, uiLevel = null } = {}) {
  if (fresh && existsSync(inst.home)) {
    // only a HOME this tool made: it holds the tool's record or the server log
    if (!existsSync(path.join(inst.home, RECORD_FILE)) && !existsSync(path.join(inst.home, 'server.log'))) {
      refuse('not-fresh-safe', `${inst.home} was not made by this tool; --fresh deletes only an instance HOME`);
    }
    rmSync(inst.home, { recursive: true, force: true });
  }
  const store = path.join(inst.home, '.worca-cc');
  const realStore = path.join(realHome, '.worca-cc');
  // a copy that is not independent is never left behind
  const discard = () => { rmSync(store, { recursive: true, force: true }); rmSync(path.join(inst.home, 'repos'), { recursive: true, force: true }); };
  let copied = 'kept', repos = null;
  if (!existsSync(store)) {
    if (inst.store === 'copy') {
      if (!existsSync(realStore)) refuse('no-store', `${inst.letter} copies ${realStore}, which is missing`);
      mkdirSync(inst.home, { recursive: true });
      copied = cp(realStore, store);
      try { repos = isolateCopy(store, { home: inst.home, realStore, realHome, cp }).repos; } catch (e) {
        discard();
        refuse('store-rewrite', `${inst.letter}'s copied store could not be made independent of ${realStore} (${e.message}); nothing was started`);
      }
    } else {
      mkdirSync(store, { recursive: true });
      copied = 'empty';
    }
  }
  if (inst.store === 'copy') {
    const bad = verifyIsolation(inst.home);
    if (bad.length) {
      if (copied !== 'kept') discard();
      refuse('copy-not-isolated', `${inst.letter}'s copy still leads to ${bad.length} path(s) outside ${inst.home}, so a delete or archive `
        + `there could change the owner's real repos; nothing was started. ${bad.slice(0, 5).join('; ')}`);
    }
  }
  const file = path.join(store, 'settings.json');
  let existing = {};
  try { existing = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ }
  writeFileSync(`${file}.tmp`, JSON.stringify(instanceSettings(existing, inst, { welcome, uiLevel }), null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  return { copied, repos };
}

/** `{ lstart, command }` of a live pid, or null. The real seam behind list and stop. */
export function defaultPs(pid) {
  try {
    const lstart = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return lstart ? { lstart, command } : null;
  } catch { return null; }
}

/** True when nothing listens on the port (both the any-address and the loopback bind). */
async function portFree(port) {
  const tryListen = (host) => new Promise((r) => {
    const s = net.createServer();
    s.once('error', () => r(false));
    s.listen({ port, ...(host ? { host } : {}), exclusive: true }, () => s.close(() => r(true)));
  });
  return (await tryListen(null)) && (await tryListen('127.0.0.1'));
}

const readRecord = (home) => { try { return JSON.parse(readFileSync(path.join(home, RECORD_FILE), 'utf8')); } catch { return null; } };
const isOurs = (rec, live) => !!live && live.lstart === rec.lstart && live.command.includes(rec.serverPath);

/** Claims a letter under its root so two starts of one letter cannot interleave. The lock appears atomically and never
 *  empty: this pid is written to a private temp file that is then hard-linked to the lock name (link fails if it exists).
 *  A lock whose pid no longer runs is refused as stale, never taken over. Returns the release function. */
export function claimInstance(inst) {
  const root = path.dirname(inst.home);
  mkdirSync(root, { recursive: true });
  const lock = path.join(root, `.${inst.letter}.lock`);
  const mine = `${lock}.${process.pid}.${Date.now()}`;
  writeFileSync(mine, String(process.pid));
  try {
    linkSync(mine, lock);
    return () => rmSync(lock, { force: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  } finally { rmSync(mine, { force: true }); }
  let raw = '';
  try { raw = readFileSync(lock, 'utf8').trim(); } catch { /* released meanwhile */ }
  // not a pid (an old lock caught mid-write, or one just released): another start holds or held it this instant
  if (!/^[1-9]\d*$/.test(raw)) refuse('already-running', `${inst.letter} is being started by another process (${lock}); wait for it and try again`);
  const pid = Number(raw);
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (k) { alive = k.code === 'EPERM'; }
  if (alive) refuse('already-running', `${inst.letter} is being started by pid ${pid}; wait for it or stop it first`);
  // no takeover: two starts that both saw the dead pid could each remove the other's fresh lock and both win
  refuse('stale-lock', `${lock} is held by pid ${pid}, which no longer runs; remove that file and start again`);
}

const portInUse = (inst) => refuse('port-in-use', `port ${inst.port} is already in use; pick another with --port ${inst.letter}=N`);

/** Refuses a start while this tool's server for the letter still runs, or while someone holds the port. */
async function assertStartable(inst, ps) {
  const prev = readRecord(inst.home);
  if (prev && isOurs(prev, ps(prev.pid))) refuse('already-running', `${inst.letter} already runs (pid ${prev.pid}); stop it first`);
  if (!(await portFree(inst.port))) portInUse(inst);
}

/** Spawns the server detached under the instance env, waits for it, and writes the record into its HOME. */
export async function startInstance(inst, { serverPath = SERVER_PATH, spawn: spawnImpl = spawn, fetch: fetchImpl = globalThis.fetch, waitMs = 30000, ps = defaultPs, baseEnv = process.env } = {}) {
  await assertStartable(inst, ps);
  mkdirSync(inst.home, { recursive: true });
  const logFile = path.join(inst.home, 'server.log');
  let offset = 0;
  try { offset = statSync(logFile).size; } catch { /* no log yet */ }
  const fd = openSync(logFile, 'a');
  const env = buildInstanceEnv(inst, baseEnv);
  const envBad = envProblems(env, inst.home);
  if (envBad.length) { closeSync(fd); refuse('credential-env', `${inst.letter}'s server env could reach the owner's GitHub; nothing was started. ${envBad.join('; ')}`); }
  let child;
  try {
    child = spawnImpl(process.execPath, [serverPath], { cwd: inst.home, env, detached: true, stdio: ['ignore', fd, fd] });
  } finally { closeSync(fd); }
  let exited = false;
  child.once?.('exit', () => { exited = true; });
  child.unref?.();
  // every refusal after the spawn stops the child, so no server is left running without a record
  const fail = (code, message) => { try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ } refuse(code, message); };
  const url = `http://127.0.0.1:${inst.port}/api/projects`;
  const until = Date.now() + waitMs;
  for (;;) {
    let log = '';
    try { log = readFileSync(logFile).subarray(offset).toString('utf8'); } catch { /* not yet */ }   // only this start's lines
    if (/already in use/.test(log)) fail('port-in-use', `port ${inst.port} is already in use; pick another with --port ${inst.letter}=N`);
    if (exited) refuse('start-timeout', `${inst.letter}'s server exited; see ${logFile}`);
    try { if ((await fetchImpl(url)).ok) break; } catch { /* not up yet */ }
    if (Date.now() > until) fail('start-timeout', `${inst.letter} did not answer ${url} within ${waitMs} ms; see ${logFile}`);
    await sleep(200);
  }
  const lstart = ps(child.pid)?.lstart;
  // without its start time the record could never be matched again, and stop could never reach the server
  if (!lstart) fail('no-start-time', `${inst.letter}'s server start time could not be read (pid ${child.pid}); it was stopped`);
  const record = { letter: inst.letter, home: inst.home, port: inst.port, pid: child.pid, lstart,
    serverPath, rail: inst.rail, mock: inst.mock, mockEnv: inst.mockEnv || {}, store: inst.store, startedAt: new Date().toISOString() };
  writeFileSync(path.join(inst.home, RECORD_FILE), JSON.stringify(record, null, 2) + '\n');
  return record;
}

/** Every recorded instance under root, with whether its pid lives and is still the server this tool started. */
export function listInstances(root, { ps = defaultPs } = {}) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const rec = readRecord(path.join(root, e.name));
    if (!rec) continue;
    const live = ps(rec.pid);
    out.push({ ...rec, alive: !!live, ours: isOurs(rec, live) });
  }
  return out.sort((a, b) => String(a.letter).localeCompare(String(b.letter)));
}

/** Stops the recorded instances (D10): a signal only for a pid whose start time and command still match its record. */
export async function stopInstances(root, letters, { ps = defaultPs, kill = process.kill.bind(process), waitMs = 10000 } = {}) {
  const want = letters && letters.length ? new Set(letters) : null;
  const out = [];
  for (const rec of listInstances(root, { ps })) {
    if (want && !want.has(rec.letter)) continue;
    const recordFile = path.join(root, rec.letter, RECORD_FILE);
    if (!rec.alive) { rmSync(recordFile, { force: true }); out.push({ letter: rec.letter, pid: rec.pid, result: 'not-running' }); continue; }
    if (!rec.ours) { out.push({ letter: rec.letter, pid: rec.pid, result: 'not-ours' }); continue; }
    const gone = () => !isOurs(rec, ps(rec.pid));
    try { kill(rec.pid, 'SIGTERM'); } catch { /* already gone */ }
    const until = Date.now() + waitMs;
    while (!gone() && Date.now() < until) await sleep(100);
    if (!gone()) {
      try { kill(rec.pid, 'SIGKILL'); } catch { /* already gone */ }
      while (!gone() && Date.now() < until + 2000) await sleep(100);
    }
    rmSync(recordFile, { force: true });
    out.push({ letter: rec.letter, pid: rec.pid, result: 'stopped' });
  }
  return out;
}

/** Runs a command with pipes, any exit code: `{ code, out, stdout }` (out is stdout + stderr), or null on a spawn failure or timeout (SIGKILL). */
function runCaptured(cmd, args, { env, timeout }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { resolve(null); return; }
    let out = '', stdout = '', settled = false;
    const done = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } done(null); }, timeout);
    child.stdout.on('data', (d) => { out += d; stdout += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', () => done(null));
    child.on('close', (code) => done({ code, out, stdout }));
  });
}

/** Why a login is not possible on this instance. */
export function loginReason(platform = process.platform) {
  if (platform === 'darwin') {
    return 'No login under this HOME: on macOS the Claude CLI keeps its sign-in in the login Keychain, which it finds through '
      + '$HOME/Library/Keychains. This instance\'s HOME has none, and the tool does not link the owner\'s (nothing is shared). '
      + 'Real replies (Chat, runs without mock) are not possible on this instance; use a mock instance.';
  }
  return 'The CLI\'s login did not take under this HOME; run `claude auth login` again with HOME=… or use a mock instance.';
}

const claudeBin = (env) => env.WORCA_CLAUDE_BIN || 'claude';

/** Whether the Claude CLI is signed in under the instance HOME (D14). Never throws; the CLI's output is only parsed. */
export async function loginStatus(inst, { run = runCaptured, bin = null, baseEnv = process.env, platform = process.platform } = {}) {
  try {
    const env = buildInstanceEnv(inst, baseEnv);
    const exe = bin || claudeBin(env);
    const r = await run(exe, ['auth', 'status', '--json'], { env, timeout: 10000 });
    // the status JSON is on stdout; stderr may carry another object that would spoil the parse
    const text = r ? (String(r.stdout || '').trim() ? r.stdout : r.out) : '';
    let state = parseClaudeAuthStatus(text);
    let method = state === 'unknown' ? 'none' : 'auth-status';
    const dir = parseClaudeAuthConfigDir(text);
    const configHome = dir ? (within(canon(dir), canon(inst.home)) ? 'inside' : 'outside') : 'unknown';
    if (state === 'unknown') {
      const p = await run(exe, ['-p', 'ok', '--model', 'claude-haiku-5-5'], { env, timeout: 30000 });
      if (p && p.code === 0) { state = 'signed-in'; method = 'prompt'; }
      else if (p && isClaudeSignedOutError(p.out)) { state = 'signed-out'; method = 'prompt'; }
    }
    return state === 'signed-in' ? { state, method, configHome } : { state, method, configHome, reason: loginReason(platform) };
  } catch {
    return { state: 'unknown', method: 'none', configHome: 'unknown', reason: loginReason(platform) };
  }
}

const line = (r) => `${r.letter}  http://127.0.0.1:${r.port}  HOME=${r.home}  rail=${r.rail ? 'on' : 'off'}  mock=${r.mock ? 'on' : 'off'}  store=${r.store}`;
const authLine = (s) => `claude=${s.state} (${s.method === 'none' ? 'no answer' : s.method}), config ${s.configHome === 'unknown' ? 'unknown' : s.configHome} HOME`;

/** The CLI. 0 ok, 2 a refusal (`code: message` on stderr), 3 a login that did not take. `io` carries the test seams. */
export async function main(argv = process.argv.slice(2), io = {}) {
  const out = io.out || ((l) => console.log(l));
  const err = io.err || ((l) => console.error(l));
  const realHome = io.realHome || realHomeDefault();
  const baseEnv = io.baseEnv || process.env;
  const platform = io.platform || process.platform;
  try {
    const opts = parseArgs(argv);
    const plan = planInstances(opts, { realHome, tmp: io.tmp || os.tmpdir() });
    const root = path.dirname(plan[0].home);
    switch (opts.cmd) {
      case 'start': {
        for (const inst of plan) {
          const release = claimInstance(inst);   // first: a second start of this letter refuses before it copies or spawns
          try {
            await assertStartable(inst, defaultPs);   // before prepareHome: a refused start writes nothing into the HOME
            const prep = await prepareHome(inst, { realHome, fresh: opts.fresh, welcome: opts.welcome, uiLevel: opts.uiLevel });
            const rec = await startInstance(inst, { serverPath: io.serverPath || SERVER_PATH, baseEnv });
            out(`${line(rec)}  pid=${rec.pid}`);
            if (inst.store === 'copy') {
              out(`   independent copy: every path it names is inside ${inst.home}${prep.repos === null ? '' : ` (${prep.repos} repos cloned into ${path.join(inst.home, 'repos')})`}; a delete or archive here never reaches the owner's real repos`);
            }
          } finally { release(); }
        }
        return 0;
      }
      case 'list': {
        const want = new Set(plan.map((i) => i.letter));
        for (const r of listInstances(root)) {
          if (!want.has(r.letter)) continue;
          out(`${line(r)}  pid=${r.pid}${r.ours ? '' : r.alive ? '  (not ours)' : '  (not running)'}`);
        }
        return 0;
      }
      case 'stop': {
        for (const r of await stopInstances(root, plan.map((i) => i.letter))) out(`${r.letter}  pid=${r.pid}  ${r.result}`);
        return 0;
      }
      case 'login-status': {
        for (const inst of plan) {
          const rec = readRecord(inst.home);
          const target = rec ? { ...inst, port: rec.port, mock: rec.mock, mockEnv: rec.mockEnv } : inst;
          out(`${line(target)}  ${authLine(await loginStatus(target, { baseEnv, platform }))}`);
        }
        return 0;
      }
      case 'login': {
        if (opts.letters.length !== 1) refuse('bad-arg', 'login takes one instance letter, e.g. login B');
        const inst = plan[0];
        mkdirSync(inst.home, { recursive: true });
        const env = buildInstanceEnv(inst, baseEnv);
        // the person finishes the CLI's own login in this terminal or the browser; the tool captures nothing
        spawnSync(claudeBin(env), ['auth', 'login'], { env, stdio: 'inherit' });
        const s = await loginStatus(inst, { baseEnv, platform });
        out(`${line(inst)}  ${authLine(s)}`);
        if (s.state !== 'signed-in') { err(s.reason || loginReason(platform)); return 3; }
        return 0;
      }
      default:
        refuse('bad-arg', 'commands: start, list, stop, login-status, login X');
    }
  } catch (e) {
    if (e instanceof GateInstanceError) { err(`${e.code}: ${e.message}`); return 2; }
    throw e;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
