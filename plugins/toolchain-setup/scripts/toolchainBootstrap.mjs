// Toolchain setup, step 2b: install mise after the user said yes, so Resolve can resolve versions for real.
// brew when it is there, else the official installer into ~/.local/bin; on Windows winget (per user), else scoop.
// Never sudo or admin rights; the URL and package ids are fixed here.
import { readFile, mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';

export const INSTALLER_URL = 'https://mise.run';

// The oldest mise this pipeline is tested with. Older ones silently ignore settings it relies on (rustup/cargo homes,
// rust[profile=…] options, the aube/uv cache variables, MISE_EXEC_AUTO_INSTALL), so installs would leak out of the root.
export const MIN_MISE = '2026.10.7';
/** True unless `line` ("2026.10.8 macos-arm64 (…)") starts with a version at or above MIN_MISE; unreadable counts as too old. */
export function miseTooOld(line) {
  const m = String(line ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return true;
  const want = MIN_MISE.split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = Number(m[i + 1]) - want[i]; if (d) return d < 0; }
  return false;
}
const UPGRADE = 'Upgrade it the way it was installed (brew upgrade mise, mise self-update, winget upgrade jdx.mise or scoop update mise)';


// Live progress goes to stderr: worca streams it as it comes. api.log() lines only arrive when the script ends.
const live = (line) => process.stderr.write(`${line}\n`);

function runStream(cmd, args, { cwd, env, timeoutMs, onLine = () => {} }) {
  return new Promise((resolve) => {
    const tail = [];
    let done = false, child, buf = { out: '', err: '' };
    const push = (l) => { if (!l.trim()) return; onLine(l); tail.push(l); if (tail.length > 30) tail.shift(); };
    const feed = (k) => (d) => { buf[k] += d; const parts = buf[k].split(/\r?\n|\r/); buf[k] = parts.pop(); parts.forEach(push); };
    const finish = (code, extra) => { if (done) return; done = true; clearTimeout(timer); push(buf.out); push(buf.err); if (extra) push(extra); resolve({ code, tail: tail.join('\n') }); };
    try { child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return resolve({ code: -1, tail: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(-1, `(stopped after ${Math.round(timeoutMs / 60000)} min)`); }, timeoutMs);
    child.stdout.on('data', feed('out'));
    child.stderr.on('data', feed('err'));
    child.on('error', (e) => finish(-1, e.message));
    child.on('close', (code) => finish(code ?? -1));
  });
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

/** Only an explicit install installs; anything else (missing file, unclear answer, unattended run) is skip. */
/** The engine stops the card at 15 min (meta timeoutMs); curl may take 2. Clamp so our own clear error wins. */
export const installTimeoutMs = (params) => Math.min(12, Math.max(1, Number(params?.timeoutMin) || 10)) * 60000;

export const readDecision = (doc) => (doc && doc.decision === 'install' ? 'install' : 'skip');

async function versionOf(bin) {
  const r = await runStream(bin, ['--version'], { timeoutMs: 20000 });
  return r.code === 0 ? r.tail.split('\n')[0].trim() : null;
}

export default async function ({ inputs, params, log }) {
  const probe = JSON.parse(await readFile(inputs.bootstrap.path, 'utf8'));
  let answer = null;
  try { answer = JSON.parse(await readFile(inputs.decision.path, 'utf8')); } catch (e) { log('warn', `decision unreadable (${e.message}): treating it as Skip`); }
  const decision = readDecision(answer);
  const done = (value, summary) => { log('info', summary); return { summary, outputs: { done: { value } } }; };

  if (decision === 'skip') return done({ decision, mise: false, version: null, method: null, binPath: null }, 'mise install declined');
  const before = await findMise();
  const beforeVersion = before && (await versionOf(before));
  if (beforeVersion) return done({ decision, mise: true, version: beforeVersion, method: 'already-present', binPath: before }, `mise already present at ${before}`);

  const timeoutMs = installTimeoutMs(params);
  const onLine = (l) => live(`[mise install] ${l}`);
  let method, run;
  if (process.platform === 'win32') {
    // The mise.run installer is a shell script: Windows gets mise from winget (user scope, no UAC prompt) or scoop.
    if (probe?.winget) {
      method = 'winget';
      run = await runStream('winget', ['install', '--id', 'jdx.mise', '--exact', '--scope', 'user', '--silent', '--disable-interactivity',
        '--accept-package-agreements', '--accept-source-agreements'], { timeoutMs, onLine });
    } else if (probe?.scoop) {
      method = 'scoop';
      run = await runStream('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'scoop', 'install', 'mise'], { timeoutMs, onLine });   // scoop is a PowerShell script
    } else {
      throw new Error('There is no winget or scoop on this Windows machine, so mise cannot be installed here. '
        + 'Install mise by hand (https://mise.jdx.dev/installing-mise.html), then Resume.');
    }
  } else if (probe?.brew) {
    method = 'brew';
    run = await runStream('brew', ['install', 'mise'], { env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' }, timeoutMs, onLine });
  } else {
    method = 'mise.run';
    const tmp = await mkdtemp(join(tmpdir(), 'worca-mise-install-'));
    try {
      const script = join(tmp, 'install.sh');
      run = await runStream('curl', ['-fsSL', '--proto', '=https', '--proto-redir', '=https', INSTALLER_URL, '-o', script], { timeoutMs: 120000, onLine });
      if (run.code === 0) {
        const target = join(homedir(), '.local', 'bin', 'mise');
        await mkdir(dirname(target), { recursive: true });
        run = await runStream('sh', [script], { env: { ...process.env, MISE_INSTALL_PATH: target }, timeoutMs, onLine });
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  const after = await findMise();
  if (!after) {
    throw new Error(`mise is still not installed after ${method} (exit ${run.code}): ${run.tail.split('\n').slice(-5).join(' | ')}. `
      + 'Install it by hand (https://mise.jdx.dev/installing-mise.html), then Resume.');
  }
  const version = await versionOf(after);
  if (!version) throw new Error(`mise at ${after} does not run after ${method} (\`mise --version\` failed). Remove or fix it, then Resume.`);
  if (miseTooOld(version)) throw new Error(`mise ${version.split(/\s/)[0]} at ${after} is too old after ${method}: ${MIN_MISE} or newer is needed. ${UPGRADE}, then Resume.`);
  return done({ decision, mise: true, version, method, binPath: after }, `mise ${version} installed via ${method}`);
}
