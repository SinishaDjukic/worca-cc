#!/usr/bin/env node
// tools/stillhet-gate-instances.mjs — starts, lists and stops the gate instances A–D of plans/rail/test-protocol.md §2,
// each with its OWN HOME. settings.json is read and written at $HOME/.worca-cc (src/core/settings.mjs defaultRoot), never at
// WORCA_HOME, so an instance started without its own HOME changes the owner's real settings (F-X-01). A and B get a copy of
// the owner's store (an APFS clone where it can; the real store is only read), C and D an empty one. `rail` lives in each
// instance's own settings.json and never in WORCA_FLAGS, so it stays unlocked (P11). Stop kills only the processes this tool
// started (a pid file per HOME, checked against the process's start time and command). `login-status` and `login X` check
// and run the Claude CLI's own login under each HOME; the CLI's output is never printed, logged or stored.
//
// Run: node tools/stillhet-gate-instances.mjs start [A,B,C,D] [--root DIR] [--port A=4601] [--no-mock B] [--mock-env WORCA_MOCK_X=v]
//        [--welcome] [--ui-level simple|advanced|expert] [--fresh]
//      node tools/stillhet-gate-instances.mjs list | stop [letters] | login-status [letters] | login X | restore-branches X   [--root DIR]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, constants as FS, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { CLAUDE_AUTH_ENV_FLAGS, CLAUDE_AUTH_ENV_KEYS, isClaudeSignedOutError, parseClaudeAuthConfigDir, parseClaudeAuthStatus } from '../src/core/preflight.mjs';

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

/** The instance server's env (D7): its own HOME, nothing that leads back to the owner's flags or login. Pure. */
export function buildInstanceEnv(inst, baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const k of ['WORCA_FLAGS', 'CLAUDE_CONFIG_DIR', 'NODE_TEST_CONTEXT', 'WORCA_TEST_ALLOW_HOME_FALLBACK', ...CLAUDE_AUTH_ENV_KEYS, ...CLAUDE_AUTH_ENV_FLAGS]) delete env[k];
  env.HOME = inst.home;
  env.USERPROFILE = inst.home;
  env.WORCA_HOME = path.join(inst.home, '.worca-cc');
  env.PORT = String(inst.port);
  env.WORCA_AUTO_RESUME = '0';
  if (inst.mock) Object.assign(env, { WORCA_MOCK: '1' }, inst.mockEnv || {});
  else { delete env.WORCA_MOCK; delete env.ORCH_MOCK; }
  return env;
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

/** The prefixes of the real store as they may appear in stored text: as given, through realpath, and JSON-escaped. */
function storePrefixes(realStore, store) {
  const pairs = new Map();
  for (const from of new Set([path.resolve(realStore), canon(realStore)])) {
    const a = from + path.sep, b = path.resolve(store) + path.sep;
    pairs.set(a, b);
    pairs.set(JSON.stringify(a).slice(1, -1), JSON.stringify(b).slice(1, -1));
  }
  return [...pairs];
}

/** Points the copied store at itself: every text value in the copy's DB and every runs/ID/run.json that names a path under
 *  the real store is rewritten to the instance's store. Without it, deleting or archiving a copied run on A or B would
 *  force-remove the owner's real worktree and run root (src/core/pipeline-delete.mjs → removeWorktree). Returns the count. */
export function rewriteStorePaths(store, realStore) {
  const pairs = storePrefixes(realStore, store);
  let changed = 0;
  const dbFile = path.join(store, 'worca-cc.db');
  if (existsSync(dbFile)) {
    const db = new DatabaseSync(dbFile);
    try {
      const q = (name) => `"${name.replaceAll('"', '""')}"`;
      for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
        for (const col of db.prepare(`PRAGMA table_info(${q(name)})`).all()) {
          for (const [from, to] of pairs) {
            const r = db.prepare(`UPDATE ${q(name)} SET ${q(col.name)} = replace(${q(col.name)}, ?, ?) WHERE typeof(${q(col.name)}) = 'text' AND instr(${q(col.name)}, ?) > 0`)
              .run(from, to, from);
            changed += Number(r.changes);
          }
        }
      }
    } finally { db.close(); }
  }
  const runs = path.join(store, 'runs');
  if (existsSync(runs)) {
    for (const e of readdirSync(runs, { withFileTypes: true })) {
      const file = path.join(runs, e.name, 'run.json');
      if (!e.isDirectory() || !existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      let next = text;
      for (const [from, to] of pairs) next = next.split(from).join(to);
      if (next !== text) { writeFileSync(file, next); changed++; }
    }
  }
  return changed;
}

/** Creates the instance HOME, copies the store into A/B the first time, and writes its settings by tmp and rename. */
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
  let copied = 'kept';
  if (!existsSync(store)) {
    if (inst.store === 'copy') {
      if (!existsSync(realStore)) refuse('no-store', `${inst.letter} copies ${realStore}, which is missing`);
      mkdirSync(inst.home, { recursive: true });
      copied = cp(realStore, store);
      try { rewriteStorePaths(store, realStore); } catch (e) {
        rmSync(store, { recursive: true, force: true });   // a copy that still points into the real store is never left behind
        refuse('store-rewrite', `${inst.letter}'s copied store could not be pointed at ${store} (${e.message}); nothing was started`);
      }
    } else {
      mkdirSync(store, { recursive: true });
      copied = 'empty';
    }
  }
  const file = path.join(store, 'settings.json');
  let existing = {};
  try { existing = JSON.parse(readFileSync(file, 'utf8')); } catch { /* none yet */ }
  writeFileSync(`${file}.tmp`, JSON.stringify(instanceSettings(existing, inst, { welcome, uiLevel }), null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  return { copied };
}

export const BRANCHES_FILE = 'real-branches.json';
const gitRead = (dir, args) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout : null;
};

/** The real repos the copied store's projects and runs name (projects.path, every project_dir column). */
function realRepoDirs(store) {
  const dirs = new Set();
  const dbFile = path.join(store, 'worca-cc.db');
  if (!existsSync(dbFile)) return [];
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const q = (name) => `"${name.replaceAll('"', '""')}"`;
    for (const { name } of db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()) {
      for (const col of db.prepare(`PRAGMA table_info(${q(name)})`).all()) {
        if (col.name !== 'project_dir' && !(name === 'projects' && col.name === 'path')) continue;
        for (const row of db.prepare(`SELECT DISTINCT ${q(col.name)} AS d FROM ${q(name)} WHERE typeof(${q(col.name)}) = 'text'`).all()) {
          if (path.isAbsolute(row.d)) dirs.add(row.d);
        }
      }
    }
  } finally { db.close(); }
  return [...dirs].sort();
}

/** R2: the copied runs still name the owner's real repos, and deleting or archiving one on A or B runs `git branch -D` there
 *  (src/core/pipeline-delete.mjs → removeWorktree). Before each A/B start the branch tips of those repos are read (read-only
 *  `git for-each-ref`) into the instance HOME, so `restore-branches X` can bring a deleted branch back. Returns the file. */
export function snapshotRealBranches(inst) {
  const repos = {};
  for (const dir of realRepoDirs(path.join(inst.home, '.worca-cc'))) {
    if (!existsSync(dir)) continue;
    const refs = gitRead(dir, ['for-each-ref', '--format=%(refname:short)%09%(objectname)', 'refs/heads']);
    if (refs === null) continue;
    repos[dir] = Object.fromEntries(refs.split('\n').filter(Boolean).map((l) => l.split('\t')));
  }
  const file = path.join(inst.home, BRANCHES_FILE);
  writeFileSync(`${file}.tmp`, JSON.stringify({ takenAt: new Date().toISOString(), repos }, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  return file;
}

/** Recreates every snapshot branch that no longer exists at its recorded tip. A branch that exists is never moved.
 *  Each entry: `{ repo, branch, sha, result: 'present' | 'restored' | 'lost' }` (lost: the commit is gone too). */
export function restoreBranches(inst) {
  const file = path.join(inst.home, BRANCHES_FILE);
  let snap;
  try { snap = JSON.parse(readFileSync(file, 'utf8')); } catch { refuse('no-snapshot', `${file} is missing; only A and B take one, at start`); }
  const out = [];
  for (const [repo, branches] of Object.entries(snap.repos || {})) {
    for (const [branch, sha] of Object.entries(branches)) {
      let result = 'present';
      if (gitRead(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) === null) {
        result = gitRead(repo, ['cat-file', '-e', `${sha}^{commit}`]) !== null && gitRead(repo, ['branch', branch, sha]) !== null ? 'restored' : 'lost';
      }
      out.push({ repo, branch, sha, result });
    }
  }
  return out;
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

/** Claims a letter under its root (an exclusive lock file holding this pid) so two starts of one letter cannot interleave.
 *  A lock whose pid no longer runs is refused as stale, never taken over. Returns the release function. */
export function claimInstance(inst) {
  const root = path.dirname(inst.home);
  mkdirSync(root, { recursive: true });
  const lock = path.join(root, `.${inst.letter}.lock`);
  {
    try {
      const fd = openSync(lock, 'wx');
      try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); }
      return () => rmSync(lock, { force: true });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(lock, 'utf8').trim());
      let alive = false;
      try { if (pid > 0) { process.kill(pid, 0); alive = true; } } catch (k) { alive = k.code === 'EPERM'; }
      if (alive) refuse('already-running', `${inst.letter} is being started by pid ${pid}; wait for it or stop it first`);
      // no takeover: two starts that both saw the dead pid could each remove the other's fresh lock and both win
      refuse('stale-lock', `${lock} is held by pid ${pid}, which no longer runs; remove that file and start again`);
    }
  }
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
  let child;
  try {
    child = spawnImpl(process.execPath, [serverPath], { cwd: inst.home, env: buildInstanceEnv(inst, baseEnv), detached: true, stdio: ['ignore', fd, fd] });
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
            await prepareHome(inst, { realHome, fresh: opts.fresh, welcome: opts.welcome, uiLevel: opts.uiLevel });
            const branches = inst.store === 'copy' ? snapshotRealBranches(inst) : null;
            const rec = await startInstance(inst, { serverPath: io.serverPath || SERVER_PATH, baseEnv });
            out(`${line(rec)}  pid=${rec.pid}`);
            if (branches) out(`   do not delete or archive copied runs here: that deletes their branch in the real repo. Tips: ${branches} (restore-branches ${inst.letter})`);
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
      case 'restore-branches': {
        if (opts.letters.length !== 1) refuse('bad-arg', 'restore-branches takes one instance letter, e.g. restore-branches A');
        const results = restoreBranches(plan[0]);
        for (const r of results) if (r.result !== 'present') out(`${r.repo}  ${r.branch}  ${r.result}  ${r.sha}`);
        out(`${results.filter((r) => r.result === 'present').length} branches already present`);
        return 0;
      }
      default:
        refuse('bad-arg', 'commands: start, list, stop, login-status, login X, restore-branches X');
    }
  } catch (e) {
    if (e instanceof GateInstanceError) { err(`${e.code}: ${e.message}`); return 2; }
    throw e;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
