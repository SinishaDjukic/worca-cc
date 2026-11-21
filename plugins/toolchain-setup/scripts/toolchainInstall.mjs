// Toolchain setup, step 6: install exactly what the user approved — never anything else.
// What runs is rebuilt from Resolve's plan rows; the answer only selects rows, by id AND spec.
import { readFile, mkdtemp, rm, access, readdir, mkdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, delimiter, sep, isAbsolute } from 'node:path';

const TOOL_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const SDK_RE = /^sdkmanager:(platforms;android-\d+|build-tools;\d+\.\d+\.\d+|ndk;\d+(?:\.\d+)+|platform-tools)$/;
const LICENSE = 'android-sdk-licenses';

// Tool homes mise does not move with MISE_DATA_DIR (its state, rustup, cargo, terraform's checkpoint, the
// ~/.default-*-packages lists): pin them to the root or switch them off, so an install writes nothing into $HOME.
const isolated = (root, scratch) => ({ MISE_STATE_DIR: join(root, 'state'), MISE_RUSTUP_HOME: join(root, 'rustup'), MISE_CARGO_HOME: join(root, 'cargo'),
  CHECKPOINT_DISABLE: '1', ...Object.fromEntries(['NODE', 'PYTHON', 'RUBY', 'GO'].map((t) => [`MISE_${t}_DEFAULT_PACKAGES_FILE`, join(scratch, 'no-default-packages')])),
  // The backends' own installers: npm: goes through mise's aube, pipx: through uv (with its own python, never a system one), go: through go.
  AUBE_HOME: join(root, 'aube'), AUBE_CACHE_DIR: join(root, 'cache', 'aube'), AUBE_STORE_DIR: join(root, 'aube', 'store'), AUBE_NO_UPDATE_CHECK: '1',
  UV_CACHE_DIR: join(root, 'cache', 'uv'), UV_PYTHON_INSTALL_DIR: join(root, 'uv-python'), UV_PYTHON_PREFERENCE: 'only-managed',
  GOPATH: join(root, 'gopath'), GOMODCACHE: join(root, 'cache', 'go-mod'), GOCACHE: join(root, 'cache', 'go-build') });
/** True when `p` exists and really lives inside `root`: a link out of the root (rustup's ~/.cargo/bin) is not an install there. */
async function inRoot(p, root) {
  try { const [rp, rr] = await Promise.all([realpath(p), realpath(root)]); return rp === rr || rp.startsWith(rr + sep); } catch { return false; }
}
// What sits directly in $HOME and in its app-data folders (Linux XDG, Windows AppData, macOS Library; the ones a box
// lacks are skipped). Install takes this before; Verify diffs after its probes.
const APP_DATA = ['.local/share', '.local/state', '.config', '.cache', 'AppData/Local', 'AppData/Roaming', 'Library/Caches', 'Library/Application Support'];
export async function homeSnapshot() {
  const home = homedir(), seen = [];
  const ls = async (rel) => { try { return await readdir(join(home, ...rel.split('/'))); } catch { return null; } };
  for (const n of (await ls('')) || []) seen.push(n);
  for (const x of APP_DATA) { const kids = await ls(x); if (kids) seen.push(x, ...kids.map((k) => `${x}/${k}`)); }
  return seen;
}

const RUST_PROFILE = /^(minimal|default|complete)$/;
const COMPONENT_RE = /^[a-z][a-z0-9-]{0,40}$/;
/** What `mise install` gets: rust takes rustup's profile and components as tool options. Odd values are dropped, never passed. */
export function installArg(r, log) {
  const o = r.options;
  if (r.tool !== 'rust' || !o || typeof o !== 'object') return r.spec;
  const comps = o.components ?? [];
  if ((o.profile != null && !RUST_PROFILE.test(o.profile)) || !Array.isArray(comps) || comps.length > 20
    || !comps.every((c) => typeof c === 'string' && COMPONENT_RE.test(c))) {
    log('warn', `ignored the rust options of ${r.spec}: not plain profile / component names`);
    return r.spec;
  }
  const opts = [o.profile && `profile=${o.profile}`, comps.length && `components=${comps.join(',')}`].filter(Boolean);
  return opts.length ? `rust[${opts.join(',')}]@${r.version}` : r.spec;
}

// Same backend shapes as Resolve (this script re-checks every row it runs).
const OWNER_REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.-]{1,100}$/;
const BACKEND = { github: OWNER_REPO, aqua: OWNER_REPO, npm: /^(@[a-z0-9][a-z0-9._-]{0,100}\/)?[a-z0-9][a-z0-9._-]{0,100}$/,
  pipx: /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/, cargo: /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/,
  go: /^[a-z0-9][a-z0-9.-]{0,100}\.[a-z]{2,}(\/[A-Za-z0-9._~-]{1,100}){1,10}$/, gem: /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/ };
const isBackend = (tool) => { const i = String(tool).indexOf(':'); const name = tool.slice(i + 1); return i > 0 && !!BACKEND[tool.slice(0, i)]?.test(name) && !name.split('/').includes('..'); };

// System packages: same shapes as Resolve, and one fixed command per package manager. Never a shell, never a password
// prompt (sudo -n fails instead of asking).
const SYSTEM = { brew: /^[a-z0-9][a-z0-9@+._-]{0,63}$/, apt: /^[a-z0-9][a-z0-9+.-]{1,63}$/, dnf: /^[A-Za-z0-9][A-Za-z0-9+._-]{0,63}$/,
  winget: /^[A-Za-z0-9][A-Za-z0-9+_-]{0,63}(\.[A-Za-z0-9+_-]{1,63}){1,5}$/, scoop: /^[a-z0-9][a-z0-9._-]{0,63}$/ };
/** {argv, env} that installs `pkg` with `manager`, or null when either is not allowed. */
export function systemCommand(manager, pkg, { root = false } = {}) {
  if (!SYSTEM[manager]?.test(pkg)) return null;
  const sudo = root ? [] : ['sudo', '-n'];
  switch (manager) {
    case 'brew': return { argv: ['brew', 'install', pkg], env: { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' } };
    case 'apt': return { argv: [...sudo, 'apt-get', 'install', '-y', '--no-install-recommends', pkg], env: { DEBIAN_FRONTEND: 'noninteractive' } };
    case 'dnf': return { argv: [...sudo, 'dnf', 'install', '-y', pkg], env: {} };
    case 'winget': return { argv: ['winget', 'install', '--id', pkg, '--exact', '--silent', '--disable-interactivity', '--accept-package-agreements', '--accept-source-agreements'], env: {} };
    case 'scoop': return { argv: ['powershell', '-NoProfile', '-NonInteractive', '-Command', 'scoop', 'install', pkg], env: {} };   // scoop is a PowerShell script
    default: return null;
  }
}

/** Who answered this run's toolchain approval? Away mode records each decision in worca's own database. A system package
 *  installs only when a person answered: Away mode, or no way to tell, means no. Read-only; never writes the database. */
export async function approvedByAway(runId) {
  if (!runId) return { away: true, why: 'the run id is unknown, so a person\'s answer cannot be confirmed' };
  const db = join((process.env.WORCA_HOME || '').trim() || homedir(), '.worca-cc', 'worca-cc.db');
  let conn;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    conn = new DatabaseSync(db, { readOnly: true });
    const records = conn.prepare('SELECT record FROM night_decisions WHERE pipeline_id = ?').all(String(runId));
    const ours = records.some(({ record }) => { try { return (JSON.parse(record).questions || []).some((q) => /^toolchain-/.test(q?.id)); } catch { return true; } });
    return ours ? { away: true, why: 'Away mode answered the approval' } : { away: false };
  } catch (e) {
    return { away: true, why: `who answered cannot be confirmed (${e.message.slice(0, 120)})` };
  } finally { try { conn?.close(); } catch { /* closed */ } }
}
// The command a person runs instead, shown when a system row is refused.
const BY_HAND = { brew: (p) => `brew install ${p}`, apt: (p) => `sudo apt-get install -y ${p}`, dnf: (p) => `sudo dnf install -y ${p}`,
  winget: (p) => `winget install --id ${p} --exact`, scoop: (p) => `scoop install ${p}` };

export function validSpec(r) {
  if (r.kind === 'system') return r.spec === r.tool && r.tool === `${r.manager}:${r.package}` && !!systemCommand(r.manager, r.package);
  if (r.kind === 'mise') return (TOOL_RE.test(r.tool) || isBackend(r.tool)) && VERSION_RE.test(r.version || '') && r.spec === `${r.tool}@${r.version}`;
  if (r.kind === 'sdkmanager') return SDK_RE.test(r.spec) && r.spec === r.tool;
  if (r.kind === 'license') return r.spec === LICENSE && r.tool === LICENSE;
  return false;
}

/** Which plan rows to install. Every approved entry must be {id, spec} naming an installable plan row. */
export function selectApproved(plan, answer) {
  const decision = ['all', 'selected', 'skip'].includes(answer?.decision) ? answer.decision : 'skip';
  const list = Array.isArray(answer?.approved) ? answer.approved : [];
  const refused = [], install = [], seen = new Set();
  const byId = new Map((plan.rows || []).map((r) => [r.id, r]));
  for (const a of list) {
    const id = a && typeof a === 'object' ? a.id : undefined;
    const spec = a && typeof a === 'object' ? a.spec : undefined;
    const r = byId.get(id);
    const no = (reason) => refused.push({ id: String(id ?? '').slice(0, 20), spec: String(spec ?? '').slice(0, 120), reason });
    if (decision === 'skip') no('the decision was Skip');
    else if (typeof id !== 'string' || typeof spec !== 'string') no('an approved entry must be {id, spec}');
    else if (!r) no('not a row of the plan');
    else if (spec !== r.spec) no(`spec does not match the plan row (${r.spec})`);
    else if (r.status !== 'installable') no(`the plan marks this row ${r.status}`);
    else if (!validSpec(r)) no('the spec failed validation');
    else if (!seen.has(id)) { seen.add(id); if (r.change !== 'unchanged') install.push(r); }
  }
  return { decision, install, refused };
}

const exists = async (p, mode = constants.F_OK) => { try { await access(p, mode); return true; } catch { return false; } };

// Live progress goes to stderr: worca streams it as it comes. api.log() lines only arrive when the script ends.
const live = (line) => process.stderr.write(`${line}\n`);
/** Spawn without a shell; every output line goes to onLine; returns the exit code and the last lines. */
function runStream(cmd, args, { cwd, env, timeoutMs, input, onLine = () => {} }) {
  return new Promise((resolve) => {
    const tail = [];
    let done = false, child, buf = { out: '', err: '' };
    const push = (l) => { if (!l.trim()) return; onLine(l); tail.push(l); if (tail.length > 30) tail.shift(); };
    const feed = (k) => (d) => { buf[k] += d; const parts = buf[k].split(/\r?\n|\r/); buf[k] = parts.pop(); parts.forEach(push); };
    const finish = (code, extra) => { if (done) return; done = true; clearTimeout(timer); push(buf.out); push(buf.err); if (extra) push(extra); resolve({ code, tail: tail.join('\n') }); };
    try { child = spawn(cmd, args, { cwd, env, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: -1, tail: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1, `(stopped after ${Math.round(timeoutMs / 60000)} min)`); }, timeoutMs);
    child.stdout.on('data', feed('out'));
    child.stderr.on('data', feed('err'));
    child.on('error', (e) => finish(-1, e.message));
    child.on('close', (code) => finish(code ?? -1));
    if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
  });
}

async function findFile(dir, name, depth = 5) {
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of ents) if (e.isFile() && e.name === name && dir.endsWith('bin')) return join(dir, e.name);
  if (depth <= 0) return null;
  for (const e of ents) if (e.isDirectory()) { const f = await findFile(join(dir, e.name), name, depth - 1); if (f) return f; }
  return null;
}

/** mise on PATH, else where its installers put it: mise.run's ~/.local/bin and Homebrew on macOS/Linux; winget's links,
 *  scoop's shims and Chocolatey on Windows (mise.exe there). Those folders count even off PATH: a mise installed after the
 *  worca server started is not on its PATH yet. null when none. */
export async function findMise() {
  const win = process.platform === 'win32', home = homedir();
  const extra = win
    ? [join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'), join(process.env.SCOOP || join(home, 'scoop'), 'shims'),
      join(process.env.ChocolateyInstall || join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey'), 'bin')]
    : [join(home, '.local', 'bin'), '/usr/local/bin', process.platform === 'darwin' ? '/opt/homebrew/bin' : '/home/linuxbrew/.linuxbrew/bin'];
  for (const d of [...(process.env.PATH || '').split(delimiter).filter(Boolean), ...extra]) {
    const p = join(d, win ? 'mise.exe' : 'mise');
    try { await access(p, win ? constants.F_OK : constants.X_OK); return p; } catch { /* next */ }
  }
  return null;
}

export default async function ({ inputs, params, ctx = {}, log }) {
  const MISE = (await findMise()) || 'mise';
  const plan = JSON.parse(await readFile(inputs.plan.path, 'utf8'));
  let answer = null;
  try { answer = JSON.parse(await readFile(inputs.approved.path, 'utf8')); } catch (e) { log('warn', `approved.json unreadable (${e.message}): installing nothing`); }
  const root = plan.toolchainRoot;
  if (!root || !Array.isArray(plan.rows)) throw new Error('the plan has no toolchainRoot or rows');
  const { decision, install: approved, refused } = selectApproved(plan, answer);
  // System packages change the whole machine: Away mode's answer never installs them.
  let install = approved;
  if (approved.some((r) => r.kind === 'system')) {
    const who = await approvedByAway(ctx.runId);
    if (who.away) {
      for (const r of approved.filter((x) => x.kind === 'system')) {
        refused.push({ id: r.id, spec: r.spec, reason: `${who.why}; system packages need a person's answer. Run "${BY_HAND[r.manager](r.package)}" yourself, or answer Approve yourself in a new run` });
      }
      install = approved.filter((r) => r.kind !== 'system');
    }
  }
  for (const r of refused) log('warn', `refused ${r.id} ${r.spec}: ${r.reason}`);

  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(tmpdir(), 'worca-mise-'));
  const env = { ...process.env, MISE_DATA_DIR: root, MISE_CACHE_DIR: join(root, 'cache'), MISE_YES: '1', MISE_CEILING_PATHS: dirname(scratch),
    MISE_GLOBAL_CONFIG_FILE: join(scratch, 'none.toml'), MISE_TRUSTED_CONFIG_PATHS: '', MISE_NOT_FOUND_AUTO_INSTALL: 'false', ...isolated(root, scratch) };
  const homeBefore = await homeSnapshot();
  const timeoutMs = Math.max(1, Number(params.itemTimeoutMin || 30)) * 60000;
  const result = new Map();   // row id -> { install, detail }
  const chosen = new Set(install.map((r) => r.id));

  try {
    // 1. mise tools (java and android-sdk first: sdkmanager needs both).
    // Runtimes other rows need (node for npm:…) first, then java and android-sdk (sdkmanager needs both).
    const needed = new Set(install.map((r) => r.needs).filter(Boolean));
    const rank = (r) => (needed.has(r.tool) ? 10 : 0) + ['java', 'android-sdk'].indexOf(r.tool);
    const mise = install.filter((r) => r.kind === 'mise').sort((a, b) => rank(b) - rank(a));
    // A backend installs with its runtime on PATH: the one from this plan, freshly installed or already there.
    const runtimePath = async (r) => {
      const dep = r.needs && plan.rows.find((x) => x.tool === r.needs && x.spec && (result.get(x.id)?.install === 'ok' || x.change === 'unchanged' || x.present));
      if (!dep) return env;
      const bp = await runStream(MISE, ['bin-paths', dep.spec], { cwd: scratch, env, timeoutMs: 60000 });
      const dirs = bp.code === 0 ? bp.tail.split('\n').map((l) => l.trim()).filter(isAbsolute) : [];   // the tail also holds mise's warnings
      return dirs.length ? { ...env, PATH: [...dirs, env.PATH || ''].join(delimiter) } : env;
    };
    for (const [i, r] of mise.entries()) {
      log('info', `[${i + 1}/${mise.length}] mise install ${r.spec}`);
      // With options (rust components) mise itself checks the install and adds only what is missing.
      if (!r.options && await inRoot(join(root, 'installs', r.tool, r.version), root)) { result.set(r.id, { install: 'ok', detail: 'already present in the shared toolchain root' }); continue; }
      const run = await runStream(MISE, ['install', installArg(r, log)], { cwd: scratch, env: await runtimePath(r), timeoutMs, onLine: (l) => live(`[${r.spec}] ${l}`) });
      result.set(r.id, run.code === 0 ? { install: 'ok' } : { install: 'failed', detail: run.tail });
      log(run.code === 0 ? 'info' : 'warn', `${r.spec}: ${run.code === 0 ? 'installed' : `failed (exit ${run.code})`}`);
    }

    // 2. Android: licenses, then components — only when approved.
    const sdkRows = install.filter((r) => r.kind === 'sdkmanager');
    const licenseRow = plan.rows.find((r) => r.kind === 'license');
    if (sdkRows.length) {
      const sdkRoot = join(root, 'android-sdk');
      await mkdir(sdkRoot, { recursive: true });
      const where = async (spec) => { const w = await runStream(MISE, ['where', spec], { cwd: scratch, env, timeoutMs: 60000 }); return w.code === 0 ? w.tail.split('\n').pop().trim() : null; };
      const exe = process.platform === 'win32' ? 'sdkmanager.bat' : 'sdkmanager';
      let sdkmanager = null;
      for (const c of [join(sdkRoot, 'cmdline-tools', 'latest', 'bin', exe), process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'cmdline-tools', 'latest', 'bin', exe),
        ...(process.env.PATH || '').split(delimiter).filter(Boolean).map((d) => join(d, exe))].filter(Boolean)) {
        if (await exists(c, constants.X_OK)) { sdkmanager = c; break; }
      }
      const androidSdk = plan.rows.find((r) => r.tool === 'android-sdk' && r.kind === 'mise' && r.spec);
      if (!sdkmanager && androidSdk) { const w = await where(androidSdk.spec); if (w) sdkmanager = await findFile(w, exe); }
      const javaRow = plan.rows.find((r) => r.tool === 'java' && r.spec && (result.get(r.id)?.install === 'ok' || r.change === 'unchanged'));
      const javaHome = javaRow ? await where(javaRow.spec) : null;
      const sdkEnv = { ...process.env, ANDROID_HOME: sdkRoot, ANDROID_SDK_ROOT: sdkRoot,
        ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH || ''}` } : {}) };

      let licensed = !licenseRow;   // no license row = accepted on an earlier run (kept in the lock)
      if (licenseRow && chosen.has(licenseRow.id)) {
        if (!sdkmanager) result.set(licenseRow.id, { install: 'failed', detail: 'sdkmanager not found' });
        else {
          log('info', 'accepting the Android SDK licenses (approved in the form)');
          const run = await runStream(sdkmanager, [`--sdk_root=${sdkRoot}`, '--licenses'], { cwd: scratch, env: sdkEnv, timeoutMs, input: 'y\n'.repeat(100), onLine: (l) => live(`[licenses] ${l}`) });
          licensed = run.code === 0;
          result.set(licenseRow.id, licensed ? { install: 'ok' } : { install: 'failed', detail: run.tail });
        }
      }
      for (const r of sdkRows) {
        const component = r.spec.slice('sdkmanager:'.length);
        if (!licensed) { result.set(r.id, { install: 'failed', detail: 'the Android SDK licenses were not accepted' }); continue; }
        if (!sdkmanager) { result.set(r.id, { install: 'failed', detail: 'sdkmanager not found' }); continue; }
        if (await exists(join(sdkRoot, ...component.split(';')))) { result.set(r.id, { install: 'ok', detail: 'already present' }); continue; }
        log('info', `sdkmanager ${component}`);
        const run = await runStream(sdkmanager, [`--sdk_root=${sdkRoot}`, component], { cwd: scratch, env: sdkEnv, timeoutMs, onLine: (l) => live(`[${component}] ${l}`) });
        result.set(r.id, run.code === 0 ? { install: 'ok' } : { install: 'failed', detail: run.tail });
      }
    } else if (licenseRow && chosen.has(licenseRow.id)) {
      result.set(licenseRow.id, { install: 'skipped', detail: 'no Android component was approved' });
    }

    // 3. System packages, last: they land outside the toolchain root, system-wide.
    for (const r of install.filter((x) => x.kind === 'system')) {
      const cmd = systemCommand(r.manager, r.package, { root: process.getuid?.() === 0 });
      log('info', `${cmd.argv.join(' ')}`);
      const run = await runStream(cmd.argv[0], cmd.argv.slice(1), { cwd: scratch, env: { ...process.env, ...cmd.env }, timeoutMs, onLine: (l) => live(`[${r.spec}] ${l}`) });
      result.set(r.id, run.code === 0 ? { install: 'ok' } : { install: 'failed', detail: run.tail });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  const rows = plan.rows.map((r) => {
    const done = result.get(r.id);
    if (done) return { ...r, ...done };
    if (r.kind === 'capability' || r.status !== 'installable') return { ...r, install: 'n/a' };
    if (r.change === 'unchanged') return { ...r, install: 'unchanged' };
    return { ...r, install: 'skipped' };
  });
  const n = (s) => rows.filter((r) => r.install === s).length;
  const summary = `${decision}: ${n('ok')} installed, ${n('failed')} failed, ${n('skipped')} skipped, ${refused.length} refused`;
  log('info', summary);
  return { summary, outputs: { install: { value: { ...plan, rows, decision, refused, homeBefore, installedAt: new Date().toISOString() } } } };
}
