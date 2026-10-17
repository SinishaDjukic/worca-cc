// Toolchain setup, step 8: save the lock + per-project env OUTSIDE the repo, then summarise the run.
import { readFile, writeFile, mkdir, mkdtemp, rm, rename, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';

function run(cmd, args, { cwd, env, timeoutMs = 60000 }) {
  return new Promise((resolve) => {
    let out = '', done = false, child;
    const finish = (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out }); } };
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve({ code: -1, out: '' }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code ?? -1));
  });
}
async function writeAtomic(path, text) { const tmp = `${path}.tmp-${process.pid}`; await writeFile(tmp, text); await rename(tmp, path); }

// Tool homes mise does not move with MISE_DATA_DIR (its state, rustup, cargo, terraform's checkpoint, the
// ~/.default-*-packages lists): pin them to the root or switch them off, so an install writes nothing into $HOME.
const isolated = (root, scratch) => ({ MISE_STATE_DIR: join(root, 'state'), MISE_RUSTUP_HOME: join(root, 'rustup'), MISE_CARGO_HOME: join(root, 'cargo'),
  CHECKPOINT_DISABLE: '1', ...Object.fromEntries(['NODE', 'PYTHON', 'RUBY', 'GO'].map((t) => [`MISE_${t}_DEFAULT_PACKAGES_FILE`, join(scratch, 'no-default-packages')])),
  // The backends' own installers: npm: goes through mise's aube, pipx: through uv (with its own python, never a system one), go: through go.
  AUBE_HOME: join(root, 'aube'), AUBE_CACHE_DIR: join(root, 'cache', 'aube'), AUBE_STORE_DIR: join(root, 'aube', 'store'), AUBE_NO_UPDATE_CHECK: '1',
  UV_CACHE_DIR: join(root, 'cache', 'uv'), UV_PYTHON_INSTALL_DIR: join(root, 'uv-python'), UV_PYTHON_PREFERENCE: 'only-managed',
  GOPATH: join(root, 'gopath'), GOMODCACHE: join(root, 'cache', 'go-mod'), GOCACHE: join(root, 'cache', 'go-build') });

/** The new lock: every verified row; a tool whose new version did not land keeps its old entry. */
export function nextLock(state, oldLock, now) {
  const oldTools = Array.isArray(oldLock?.tools) ? oldLock.tools : [];
  const dropped = new Set((state.removed || []).map((l) => `${l.tool}@${l.version}`));
  const tools = [];
  for (const r of state.rows) {
    if (!['mise', 'sdkmanager', 'license', 'system'].includes(r.kind) || r.verify?.result !== 'pass') continue;
    const prev = oldTools.find((l) => l.tool === r.tool && l.version === r.version);
    tools.push({ tool: r.tool, version: r.version, spec: r.spec, kind: r.kind, origin: r.origin,
      source: [...(r.sources || []), ...(r.evidence || [])].join(', ') || r.origin, installedAt: r.install === 'ok' ? now : (prev?.installedAt || now) });
  }
  for (const l of oldTools) {
    if (dropped.has(`${l.tool}@${l.version}`) || tools.some((t) => t.tool === l.tool)) continue;
    tools.push({ ...l, note: 'previous version kept: the new one was not installed' });
  }
  return { version: 1, project: state.projectDir, updatedAt: now, tools };
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

export default async function ({ inputs, log }) {
  const MISE = (await findMise()) || 'mise';
  const state = JSON.parse(await readFile(inputs.verify.path, 'utf8'));
  const { toolchainRoot: root, stateDir } = state;
  if (!root || !stateDir || !Array.isArray(state.rows)) throw new Error('verify.json carries no toolchainRoot, stateDir or rows');
  await mkdir(stateDir, { recursive: true });
  const lockPath = join(stateDir, 'toolchain.lock.json');
  let old = null;
  try { old = JSON.parse(await readFile(lockPath, 'utf8')); } catch { /* first run */ }
  const now = new Date().toISOString();
  const lock = nextLock(state, old, now);

  // Env: one version per tool (the first, i.e. the highest-priority source) goes on PATH.
  const scratch = await mkdtemp(join(tmpdir(), 'worca-mise-'));
  const env = { ...process.env, MISE_DATA_DIR: root, MISE_CACHE_DIR: join(root, 'cache'), MISE_CEILING_PATHS: dirname(scratch),
    MISE_GLOBAL_CONFIG_FILE: join(scratch, 'none.toml'), MISE_TRUSTED_CONFIG_PATHS: '', ...isolated(root, scratch) };
  const vars = {}, pathPrepend = [], onPath = new Set(), shadowed = [];
  try {
    for (const t of lock.tools.filter((x) => x.kind === 'mise')) {
      if (onPath.has(t.tool)) { shadowed.push(`${t.tool}@${t.version}`); continue; }
      onPath.add(t.tool);
      const bp = await run(MISE, ['bin-paths', t.spec], { cwd: scratch, env });
      if (bp.code === 0) pathPrepend.push(...bp.out.split('\n').map((s) => s.trim()).filter(Boolean));
      // rustup's proxies in cargo/bin find their toolchains only through these two.
      if (t.tool === 'rust') Object.assign(vars, { RUSTUP_HOME: join(root, 'rustup'), CARGO_HOME: join(root, 'cargo') });
      if (t.tool === 'java') { const w = await run(MISE, ['where', t.spec], { cwd: scratch, env }); if (w.code === 0 && w.out.trim()) vars.JAVA_HOME = w.out.trim(); }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  if (lock.tools.some((t) => t.kind === 'sdkmanager')) {
    const sdk = join(root, 'android-sdk');
    Object.assign(vars, { ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk });
    pathPrepend.push(join(sdk, 'platform-tools'), join(sdk, 'cmdline-tools', 'latest', 'bin'));
  }
  const envDoc = { updatedAt: now, vars, pathPrepend: [...new Set(pathPrepend)] };
  await writeAtomic(lockPath, JSON.stringify(lock, null, 2) + '\n');
  await writeAtomic(join(stateDir, 'toolchain.env.json'), JSON.stringify(envDoc, null, 2) + '\n');
  await writeAtomic(join(stateDir, 'toolchain.env'), [`# worca toolchain setup, ${now}. Not loaded into worca runs yet; not a shell script.`,
    ...Object.entries(vars).map(([k, v]) => `${k}=${v}`), `PATH_PREPEND=${envDoc.pathPrepend.join(delimiter)}`].join('\n') + '\n');

  // Report.
  const rows = state.rows;
  const label = (r) => (r.kind === 'mise' && r.version ? `${r.tool}@${r.version}` : r.tool);
  const pick = (f) => rows.filter(f);
  const installed = pick((r) => r.verify?.result === 'pass' && r.install === 'ok');
  const kept = pick((r) => r.verify?.result === 'pass' && r.install !== 'ok');
  const failed = pick((r) => r.verify?.result === 'fail');
  const skipped = pick((r) => r.verify?.result === 'skipped');
  const notHere = pick((r) => ['not-possible-here', 'unknown-tool', 'over-disk-budget'].includes(r.status));
  const sec = (title, list, line) => (list.length ? [`## ${title} (${list.length})`, ...list.map(line), ''] : []);
  const md = [
    '# Toolchain setup', '',
    `Lock: \`${lockPath}\` · env: \`${join(stateDir, 'toolchain.env')}\` · nothing was written to the repository.`, '',
    ...(state.mise ? [] : ['**mise is not installed (declined or failed), so every mise row below needs it.** Install mise, then start a new run.', '']),
    ...sec('Installed', installed, (r) => `- ${label(r)}${r.verify.detail ? ` — ${r.verify.detail}` : ''}`),
    ...sec('Already installed, still working', kept, (r) => `- ${label(r)}`),
    ...sec('Failed', failed, (r) => `- ${label(r)}: ${String(r.verify.detail || r.detail || '').split('\n').slice(-3).join(' | ').slice(0, 400)}`),
    ...sec('Skipped (not approved)', skipped, (r) => `- ${label(r)}`),
    ...sec('Not possible here', notHere, (r) => `- ${label(r)} — ${r.status}: ${r.reason || ''}`),
    ...sec('System-wide (outside the toolchain root, shared with everything on this machine)', installed.concat(kept).filter((r) => r.kind === 'system'), (r) => `- ${r.tool}`),
    ...((state.otherBoxes || []).length ? [`For other operating systems (not installed here): ${state.otherBoxes.join(', ')}`, ''] : []),
    ...sec('Written outside the toolchain root', state.homeLeaks || [], (p) => `- \`${p}\` (new in $HOME during this run; another program may have made it)`),
    ...(shadowed.length ? [`Conflicting versions installed but not on PATH: ${shadowed.join(', ')}`, ''] : []),
    ...((state.refused || []).length ? [`Refused approval entries: ${state.refused.map((x) => `${x.id} (${x.reason})`).join('; ')}`, ''] : []),
    ...((state.removed || []).length ? [`Dropped from the lock: ${state.removed.map((l) => `${l.tool}@${l.version}`).join(', ')}`, ''] : []),
  ].join('\n');
  const summary = `Installed ${installed.length}, failed ${failed.length}, skipped ${skipped.length}, not possible here ${notHere.length}${kept.length ? `, unchanged ${kept.length}` : ''}`;
  log('info', summary);
  return { summary, outputs: { report: { value: md } } };
}
