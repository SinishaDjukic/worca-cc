// Toolchain setup, step 7: prove each installed tool runs. Version probes only — never a build.
// `state` is Install's result, or Resolve's plan when nothing changed (then every row is "unchanged").
import { readFile, mkdtemp, rm, access, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, delimiter, relative, sep, isAbsolute } from 'node:path';

// Tool homes mise does not move with MISE_DATA_DIR (its state, rustup, cargo, terraform's checkpoint, the
// ~/.default-*-packages lists): pin them to the root or switch them off, so an install writes nothing into $HOME.
const isolated = (root, scratch) => ({ MISE_STATE_DIR: join(root, 'state'), MISE_RUSTUP_HOME: join(root, 'rustup'), MISE_CARGO_HOME: join(root, 'cargo'),
  CHECKPOINT_DISABLE: '1', ...Object.fromEntries(['NODE', 'PYTHON', 'RUBY', 'GO'].map((t) => [`MISE_${t}_DEFAULT_PACKAGES_FILE`, join(scratch, 'no-default-packages')])),
  // The backends' own installers: npm: goes through mise's aube, pipx: through uv (with its own python, never a system one), go: through go.
  AUBE_HOME: join(root, 'aube'), AUBE_CACHE_DIR: join(root, 'cache', 'aube'), AUBE_STORE_DIR: join(root, 'aube', 'store'), AUBE_NO_UPDATE_CHECK: '1',
  UV_CACHE_DIR: join(root, 'cache', 'uv'), UV_PYTHON_INSTALL_DIR: join(root, 'uv-python'), UV_PYTHON_PREFERENCE: 'only-managed',
  GOPATH: join(root, 'gopath'), GOMODCACHE: join(root, 'cache', 'go-mod'), GOCACHE: join(root, 'cache', 'go-build') });
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
/** True when `p` exists and really lives inside `root`: a link out of the root (rustup's ~/.cargo/bin) is not an install there. */
async function inRoot(p, root) {
  try { const [rp, rr] = await Promise.all([realpath(p), realpath(root)]); return rp === rr || rp.startsWith(rr + sep); } catch { return false; }
}
/** New $HOME entries since `before`, outermost only, leaving out the root itself. */
export function leaksSince(before, after, home, root) {
  const had = new Set(before);
  const rootRel = relative(home, root).split(sep).join('/');   // entries use '/' on every OS
  const fresh = after.filter((x) => !had.has(x) && rootRel !== x && !rootRel.startsWith(`${x}/`));
  return fresh.filter((x) => !fresh.some((y) => x.startsWith(`${y}/`))).map((x) => `~/${x}`);
}

// Same as Install's: a probe without the rust options makes mise see missing components and reinstall them.
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

// Is a system package installed? One fixed, read-only query per package manager.
const PS = ['powershell', '-NoProfile', '-NonInteractive', '-Command'];
async function systemInstalled(manager, pkg, run) {
  const q = { brew: ['brew', 'list', '--versions', pkg], apt: ['dpkg-query', '-W', '-f=${Status}', pkg], dnf: ['rpm', '-q', pkg],
    winget: ['winget', 'list', '--id', pkg, '--exact', '--accept-source-agreements'], scoop: [...PS, 'scoop', 'prefix', pkg] }[manager];
  if (!q) return false;
  const r = await run(q[0], q.slice(1), { timeoutMs: 60000 });
  const out = String(r.stdout ?? r.out ?? '');
  return r.code === 0 && (manager !== 'apt' || out.includes('install ok installed'));
}

const PROBE = {
  java: ['java', '-version'], node: ['node', '-v'], go: ['go', 'version'], rust: ['rustc', '--version'], python: ['python', '--version'],
  dotnet: ['dotnet', '--version'], gradle: ['gradle', '--version'], maven: ['mvn', '-v'], flutter: ['flutter', '--version'],
  dart: ['dart', '--version'], kotlin: ['kotlin', '-version'], terraform: ['terraform', 'version'], npm: ['npm', '-v'], pnpm: ['pnpm', '-v'],
  yarn: ['yarn', '-v'], bun: ['bun', '--version'], deno: ['deno', '--version'], ruby: ['ruby', '-v'], protoc: ['protoc', '--version'],
  buf: ['buf', '--version'], 'android-sdk': ['sdkmanager', '--version'],
};
const NO_VERSION_CHECK = new Set(['android-sdk']);
export const probeFor = (tool) => PROBE[tool] || [tool, '--version'];
const nums = (v) => String(v).replace(/^[a-z][a-z-]*?-?(?=\d)/i, '').split(/[^\d]+/).filter(Boolean);
/** The probe output must show the version's first two numbers ("17.0", "20.10", "8.5"). */
export const versionSeen = (version, out) => { const n = nums(version); return !n.length || out.includes(n.slice(0, 2).join('.')); };
/** The probe line that shows the version (a banner may come first), else the first three lines. */
export const detailOf = (version, out) => {
  const n = nums(version).slice(0, 2).join('.');
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = n && lines.find((l) => l.includes(n));
  return (hit || lines.slice(0, 3).join(' | ')).slice(0, 300);
};

function run(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let out = '', done = false, child;
    const finish = (code, extra = '') => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out: out + extra }); } };
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: -1, out: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1, '\n(timed out)'); }, timeoutMs);
    const take = (d) => { if (out.length < 20000) out += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => finish(-1, e.message));
    child.on('close', (code) => finish(code ?? -1));
  });
}
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

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

export default async function ({ inputs, log }) {
  const MISE = (await findMise()) || 'mise';
  const state = JSON.parse(await readFile(inputs.state.path, 'utf8'));
  const root = state.toolchainRoot;
  if (!root || !Array.isArray(state.rows)) throw new Error('state has no toolchainRoot or rows');
  // Probes run in an empty folder: the repo's own mise/asdf config is never loaded.
  const scratch = await mkdtemp(join(tmpdir(), 'worca-mise-'));
  const env = { ...process.env, MISE_DATA_DIR: root, MISE_CACHE_DIR: join(root, 'cache'), MISE_YES: '1', MISE_CEILING_PATHS: dirname(scratch),
    MISE_GLOBAL_CONFIG_FILE: join(scratch, 'none.toml'), MISE_TRUSTED_CONFIG_PATHS: '', MISE_NOT_FOUND_AUTO_INSTALL: 'false',
    ANDROID_HOME: join(root, 'android-sdk'), ANDROID_SDK_ROOT: join(root, 'android-sdk'), ...isolated(root, scratch),
    MISE_EXEC_AUTO_INSTALL: 'false' };   // a probe proves what Install put there; it never installs
  const rows = [];
  try {
    for (const r of state.rows) {
      const installed = r.install ? ['ok', 'unchanged'].includes(r.install) : r.change === 'unchanged';
      let verify;
      if (r.kind === 'capability' || r.status !== 'installable') verify = { result: 'n/a' };
      else if (r.install === 'failed') verify = { result: 'fail', detail: 'install failed' };
      else if (!installed) verify = { result: 'skipped' };
      else if (r.kind === 'license') verify = { result: 'pass', detail: 'accepted' };
      else if (r.kind === 'sdkmanager') {
        const dir = join(root, 'android-sdk', ...r.spec.slice('sdkmanager:'.length).split(';'));
        verify = (await exists(dir)) ? { result: 'pass', detail: dir } : { result: 'fail', detail: `missing ${dir}` };
      } else if (r.kind === 'system') {
        verify = (await systemInstalled(r.manager, r.package, run)) ? { result: 'pass', detail: `installed by ${r.manager}` } : { result: 'fail', detail: `${r.manager} does not list ${r.package}` };
      } else if (r.tool.includes(':')) {
        // A backend tool (npm:…, github:…) has no known version command: prove the install is in the root and exposes commands.
        const where = await run(MISE, ['where', r.spec], { cwd: scratch, env, timeoutMs: 60000 });
        const dir = where.code === 0 ? where.out.split('\n').map((l) => l.trim()).filter(isAbsolute).pop() || '' : '';
        const bins = [];
        if (dir && (await inRoot(dir, root))) {
          const bp = await run(MISE, ['bin-paths', r.spec], { cwd: scratch, env, timeoutMs: 60000 });
          for (const d of (bp.code === 0 ? bp.out.split('\n') : []).map((l) => l.trim()).filter(isAbsolute)) bins.push(...((await readdir(d).catch(() => [])).filter((n) => !n.startsWith('.'))));
        }
        verify = bins.length ? { result: 'pass', detail: `installed in the root; provides ${bins.slice(0, 8).join(', ')}${bins.length > 8 ? ', …' : ''}` }
          : { result: 'fail', detail: dir ? `nothing to run under ${dir}` : 'not installed in the toolchain root' };
      } else {
        const probe = probeFor(r.tool);
        const p = await run(MISE, ['exec', installArg(r, log), '--', ...probe], { cwd: scratch, env, timeoutMs: 120000 });
        const out = p.out.trim();
        const seen = NO_VERSION_CHECK.has(r.tool) || versionSeen(r.version, out);
        const ok = p.code === 0 && seen;
        verify = { result: ok ? 'pass' : 'fail', command: probe.join(' '),
          detail: detailOf(r.version, out) + (p.code !== 0 ? ` (exit ${p.code})` : seen ? '' : ` (expected ${r.version})`) };
      }
      if (verify.result !== 'n/a') log(verify.result === 'fail' ? 'warn' : 'info', `${r.spec || r.tool}: ${verify.result}${verify.detail ? ` — ${verify.detail}` : ''}`);
      rows.push({ ...r, verify });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  // Only Install's snapshot can be diffed: when nothing was installed there is no "before".
  const homeLeaks = Array.isArray(state.homeBefore) ? leaksSince(state.homeBefore, await homeSnapshot(), homedir(), root) : [];
  if (homeLeaks.length) log('warn', `written outside the toolchain root during this run: ${homeLeaks.join(', ')}`);
  const n = (s) => rows.filter((r) => r.verify.result === s).length;
  const summary = `${n('pass')} pass, ${n('fail')} fail, ${n('skipped')} skipped${homeLeaks.length ? `, ${homeLeaks.length} new in $HOME` : ''}`;
  return { summary, outputs: { verify: { value: { ...state, rows, homeLeaks, verifiedAt: new Date().toISOString() } } } };
}
