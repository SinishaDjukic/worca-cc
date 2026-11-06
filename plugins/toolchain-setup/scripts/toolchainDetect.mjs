// Toolchain setup, step 1: deterministic version-file scan. Reads files only.
import { readFile, readdir, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, sep, basename, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const SKIP = new Set(['.git', 'node_modules', 'build', 'dist', 'out', 'target', '.gradle', '.idea', '.venv', 'venv',
  '__pycache__', 'vendor', 'Pods', '.dart_tool', '.next', '.turbo', 'coverage', '.cache', '.pub-cache', 'bin', 'obj']);
const MAX_FILES = 20000, MAX_DEPTH = 8, MAX_BYTES = 1_000_000, LISTING_CAP = 4000;
const SDKMAN_VENDOR = { tem: 'temurin', zulu: 'zulu', librca: 'liberica', amzn: 'corretto', ms: 'microsoft',
  open: 'openjdk', graal: 'graalvm', graalce: 'graalvm-community', oracle: 'oracle', sem: 'semeru', sapmchn: 'sapmachine' };

async function walk(root) {
  const files = [], dirs = [];
  const stack = [[root, 0]];
  while (stack.length && files.length < MAX_FILES) {
    const [dir, depth] = stack.pop();
    let ents;
    try { ents = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      const rel = relative(root, p).split(sep).join('/');
      if (e.isDirectory()) {
        dirs.push(rel);
        if (!SKIP.has(e.name) && !e.name.endsWith('.xcodeproj') && depth < MAX_DEPTH) stack.push([p, depth + 1]);
      } else if (e.isFile()) files.push(rel);
    }
  }
  return { files: files.sort(), dirs: dirs.sort() };
}

const lineAt = (text, idx) => (idx < 0 ? 1 : text.slice(0, idx).split('\n').length);

/** "18.17.0" exact · ">=18" minimum · everything else ("18", "^18", "lts/*", ">=3.0 <4") range. */
export function classify(raw) {
  const s = String(raw).trim().replace(/^v(?=\d)/, '');
  if (/^\d+\.\d+\.\d+(?:[-+.][\w.+-]+)?$/.test(s)) return { version: s, constraint: 'exact' };
  const min = s.match(/^>=?\s*v?(\d+(?:\.\d+){0,2})$/);
  if (min) return { version: min[1], constraint: 'minimum' };
  return { version: s, constraint: 'range' };
}

export async function detect(root) {
  const { files, dirs } = await walk(root);
  const facts = [], capabilities = [], seenCap = new Set();
  const add = (tool, raw, file, line, constraint, options) => {
    if (raw == null || !String(raw).trim()) return;
    const c = classify(raw);
    facts.push({ tool, version: c.version, constraint: constraint || c.constraint, source: `${file}:${line}`, ...(options ? { options } : {}) });
  };
  const need = (need, why, source) => {
    const k = `${need}|${source}`;
    if (seenCap.has(k) || capabilities.filter((c) => c.need === need).length >= 5) return;
    seenCap.add(k); capabilities.push({ need, why, source });
  };
  const read = async (rel) => {
    try {
      const buf = await readFile(join(root, rel));
      return buf.length > MAX_BYTES ? null : buf.toString('utf8');
    } catch { return null; }
  };
  const each = (text, re, fn) => { for (const m of text.matchAll(re)) fn(m, lineAt(text, m.index)); };

  for (const d of dirs) {
    if (/\.(xcodeproj|xcworkspace)$/.test(d)) need('macos', 'Xcode project: building it needs macOS and Xcode', `${d}:1`);
  }

  for (const f of files) {
    const name = basename(f);
    const lower = name.toLowerCase();
    if (lower === 'podfile') need('macos', 'CocoaPods Podfile: needs macOS and Xcode', `${f}:1`);
    if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(lower)) need('docker', 'docker compose file', `${f}:1`);
    if (lower.endsWith('.cu')) need('cuda', 'CUDA source file', `${f}:1`);
    if (f.includes('/androidTest/') || f.startsWith('androidTest/')) need('emulator', 'instrumented Android tests (androidTest)', `${f}:1`);

    const wanted = ['.tool-versions', 'mise.toml', '.mise.toml', '.nvmrc', '.node-version', 'package.json', '.java-version',
      '.sdkmanrc', 'build.gradle', 'build.gradle.kts', 'gradle-wrapper.properties', 'pom.xml', 'maven-wrapper.properties',
      'go.mod', 'rust-toolchain', 'rust-toolchain.toml', 'global.json', '.python-version', 'pyproject.toml', 'pubspec.yaml',
      'requirements.txt', 'dockerfile'];
    if (!wanted.includes(lower) && !(lower === 'config.toml' && /(^|\/)\.?(config\/)?mise\/config\.toml$/.test(f))) continue;
    const text = await read(f);
    if (text == null) continue;

    switch (lower) {
      case '.tool-versions':
        text.split('\n').forEach((l, i) => {
          const m = l.replace(/#.*/, '').trim().split(/\s+/);
          if (m.length >= 2 && m[0]) add(m[0], m[1], f, i + 1);
        });
        break;
      case 'mise.toml': case '.mise.toml': case 'config.toml': {
        let inTools = false;
        text.split('\n').forEach((l, i) => {
          const t = l.replace(/#.*/, '').trim();
          if (/^\[.*\]$/.test(t)) { inTools = t === '[tools]'; return; }
          if (!inTools) return;
          const m = t.match(/^"?([\w@/:.-]+)"?\s*=\s*(?:\[\s*)?(?:\{[^}]*version\s*=\s*)?"([^"]+)"/);
          if (m) add(m[1], m[2], f, i + 1);
        });
        break;
      }
      case '.nvmrc': case '.node-version': {
        const v = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
        add('node', v, f, 1);
        break;
      }
      case 'package.json': {
        let pkg; try { pkg = JSON.parse(text); } catch { break; }
        const at = (needle) => lineAt(text, text.indexOf(needle));
        for (const [tool, v] of Object.entries(pkg.engines || {})) {
          if (['node', 'npm', 'pnpm', 'yarn', 'bun', 'deno'].includes(tool) && typeof v === 'string') add(tool, v, f, at(`"${tool}"`));
        }
        if (typeof pkg.packageManager === 'string') {
          const m = pkg.packageManager.match(/^(npm|pnpm|yarn|bun)@([^+\s]+)/);
          if (m) add(m[1], m[2], f, at('"packageManager"'), 'exact');
        }
        if (/"(testcontainers|@testcontainers\/[\w-]+)"\s*:/.test(text)) need('docker', 'Testcontainers dependency', `${f}:${at('testcontainers')}`);
        break;
      }
      case '.java-version': add('java', text.trim().split('\n')[0], f, 1); break;
      case '.sdkmanrc':
        text.split('\n').forEach((l, i) => {
          const m = l.replace(/#.*/, '').trim().match(/^([\w-]+)\s*=\s*(\S+)$/);
          if (!m) return;
          if (m[1] === 'java') {
            const j = m[2].match(/^(\d[\w.+]*?)-(\w+)$/);
            if (j && SDKMAN_VENDOR[j[2]]) add('java', `${SDKMAN_VENDOR[j[2]]}-${j[1]}`, f, i + 1, 'exact');
            else add('java', m[2], f, i + 1);
          } else add(m[1], m[2], f, i + 1);
        });
        break;
      case 'build.gradle': case 'build.gradle.kts':
        each(text, /jvmToolchain\s*\(\s*(\d+)\s*\)|JavaLanguageVersion\.of\(\s*(\d+)\s*\)/g, (m, ln) => add('java', m[1] || m[2], f, ln, 'range'));
        each(text, /(?:sourceCompatibility|targetCompatibility)\s*=?\s*JavaVersion\.VERSION_(\d+)(?:_(\d+))?/g, (m, ln) => add('java', m[1] === '1' ? m[2] : m[1], f, ln, 'minimum'));
        each(text, /compileSdk(?:Version)?\s*[=(]?\s*(\d+)/g, (m, ln) => add(`sdkmanager:platforms;android-${m[1]}`, m[1], f, ln, 'exact'));
        each(text, /buildToolsVersion\s*[=(]?\s*["'](\d+\.\d+\.\d+)["']/g, (m, ln) => add(`sdkmanager:build-tools;${m[1]}`, m[1], f, ln, 'exact'));
        each(text, /ndkVersion\s*[=(]?\s*["']([\d.]+)["']/g, (m, ln) => add(`sdkmanager:ndk;${m[1]}`, m[1], f, ln, 'exact'));
        each(text, /org\.testcontainers/g, (m, ln) => need('docker', 'Testcontainers dependency', `${f}:${ln}`));
        each(text, /testInstrumentationRunner/g, (m, ln) => need('emulator', 'instrumented Android tests', `${f}:${ln}`));
        break;
      case 'gradle-wrapper.properties': {
        const m = text.match(/distributionUrl=.*gradle-([\d.]+(?:-rc-\d+)?)-(?:bin|all)\.zip/);
        if (m) add('gradle', m[1], f, lineAt(text, m.index), 'exact');
        break;
      }
      case 'maven-wrapper.properties': {
        const m = text.match(/distributionUrl=.*apache-maven-([\d.]+)-bin\.zip/);
        if (m) add('maven', m[1], f, lineAt(text, m.index), 'exact');
        break;
      }
      case 'pom.xml':
        each(text, /<(maven\.compiler\.release|maven\.compiler\.source|java\.version|release)>\s*(\d+)\s*</g, (m, ln) => add('java', m[2], f, ln, 'minimum'));
        each(text, /org\.testcontainers/g, (m, ln) => need('docker', 'Testcontainers dependency', `${f}:${ln}`));
        break;
      case 'go.mod':
        each(text, /^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/gm, (m, ln) => add('go', m[1], f, ln, 'minimum'));
        each(text, /^toolchain\s+go(\d+\.\d+\.\d+)\s*$/gm, (m, ln) => add('go', m[1], f, ln, 'exact'));
        each(text, /testcontainers-go/g, (m, ln) => need('docker', 'Testcontainers dependency', `${f}:${ln}`));
        break;
      case 'rust-toolchain':
        add('rust', text.trim().split('\n')[0], f, 1);
        break;
      case 'rust-toolchain.toml': {
        const m = text.match(/channel\s*=\s*"([^"]+)"/);
        // rustup's profile and components decide what gets downloaded (minimal is ~4x smaller than the default set).
        const profile = text.match(/^\s*profile\s*=\s*"([^"]+)"/m)?.[1];
        const list = text.match(/^\s*components\s*=\s*\[([^\]]*)\]/m)?.[1];
        const components = list ? [...list.matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
        const options = { ...(profile ? { profile } : {}), ...(components.length ? { components } : {}) };
        if (m) add('rust', m[1], f, lineAt(text, m.index), undefined, Object.keys(options).length ? options : undefined);
        break;
      }
      case 'global.json': {
        let g; try { g = JSON.parse(text); } catch { break; }
        if (g?.sdk?.version) add('dotnet', g.sdk.version, f, lineAt(text, text.indexOf('"version"')), 'exact');
        break;
      }
      case '.python-version': add('python', text.trim().split('\n')[0], f, 1); break;
      case 'pyproject.toml':
        each(text, /requires-python\s*=\s*["']([^"']+)["']/g, (m, ln) => add('python', m[1].replace(/\s*,\s*/g, ' '), f, ln));
        each(text, /^python\s*=\s*["']([^"']+)["']/gm, (m, ln) => add('python', m[1], f, ln));
        each(text, /testcontainers/g, (m, ln) => need('docker', 'Testcontainers dependency', `${f}:${ln}`));
        each(text, /\b(pycuda|cupy|nvidia-[\w-]+-cu\d+)\b/g, (m, ln) => need('cuda', `CUDA package ${m[1]}`, `${f}:${ln}`));
        break;
      case 'requirements.txt':
        each(text, /^\s*testcontainers\b/gm, (m, ln) => need('docker', 'Testcontainers dependency', `${f}:${ln}`));
        each(text, /^\s*(pycuda|cupy[\w-]*|nvidia-[\w-]+-cu\d+)\b/gm, (m, ln) => need('cuda', `CUDA package ${m[1]}`, `${f}:${ln}`));
        break;
      case 'pubspec.yaml': {
        const env = text.match(/^environment:\s*\n((?:[ \t]+.*\n?)*)/m);
        if (!env) break;
        const base = env.index + env[0].indexOf(env[1]);
        for (const m of env[1].matchAll(/^\s+(sdk|flutter):\s*["']?([^"'\n#]+?)["']?\s*$/gm)) {
          add(m[1] === 'sdk' ? 'dart' : 'flutter', m[2], f, lineAt(text, base + m.index + 1));
        }
        break;
      }
      case 'dockerfile':
        each(text, /nvidia\/cuda/g, (m, ln) => need('cuda', 'CUDA base image', `${f}:${ln}`));
        break;
    }
  }
  return { facts, capabilities, files: files.slice(0, LISTING_CAP), filesTruncated: files.length > LISTING_CAP, fileCount: files.length };
}

/** First stdout line of `cmd args` when it exits 0 within 10 s, else null. Never a shell. */
function probe(cmd, args) {
  return new Promise((resolve) => {
    let out = '', child;
    try { child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return resolve(null); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 10000);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim().split('\n')[0] : null); });
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

/** Is mise here, and which installer could add it (brew; on Windows winget or scoop)? */
export async function probeTools() {
  const bin = await findMise();
  const version = bin ? await probe(bin, ['--version']) : null;
  const win = process.platform === 'win32';
  return { present: !!version, version: version || null, tooOld: !!version && miseTooOld(version), minVersion: MIN_MISE, brew: !win && !!(await probe('brew', ['--version'])),
    winget: win && !!(await probe('winget', ['--version'])),
    scoop: win && !!(await probe('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'scoop', '--version'])), platform: process.platform };
}

export default async function ({ inputs, ctx, log }) {
  const hints = inputs.task ? (await readFile(inputs.task.path, 'utf8')).slice(0, 4000) : '';
  const out = await detect(ctx.cwd);
  const mise = await probeTools();
  log('info', `scanned ${out.fileCount} files: ${out.facts.length} facts, ${out.capabilities.length} capability needs`);
  log(mise.present ? 'info' : 'warn', mise.present ? `mise ${mise.version}` : 'mise is not installed: asking whether to install it');
  const summary = `${out.facts.length} version facts, ${out.capabilities.length} capability needs; mise ${mise.present ? mise.version : 'missing'}`;
  return {
    summary,
    // ready/bootstrap get only the probe, never repo text: the ask agent reads them.
    outputs: { facts: { value: { version: 1, hints, ...out, mise } }, ready: { value: mise }, bootstrap: { value: mise } },
    verdict: { summary, issues: mise.present ? [] : [{ severity: 'major', title: 'mise is not installed',
      detail: 'Every toolchain step needs mise. Routed to the install question; nothing is installed without a yes.' }] },
  };
}
