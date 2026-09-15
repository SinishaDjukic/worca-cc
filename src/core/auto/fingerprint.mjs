// A cheap, OFFLINE description of a project for the Auto classifier (spec §4.4):
// top-level entries, manifests + dependency names, lockfiles, test/CI configs,
// the language mix and derived hints. fs/promises + path only — no shell, so it
// behaves the same on Windows. Bounded (entries, depth, bytes) and never throws.
// Every `/` in the output is a DISPLAY separator (a directory marker, the
// `.github/workflows` label) — never fed to a path API.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

export const FINGERPRINT_LIMITS = Object.freeze({ maxBytes: 2048, maxEntries: 2000, depth: 2, maxTopEntries: 60, maxDeps: 80 });
/** A manifest larger than this is skipped, never slurped (the walk is bounded; the reads must be too). */
const MAX_MANIFEST_BYTES = 1_048_576;

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor', 'coverage', '.next', '.cache', '__pycache__', '.venv', 'venv', '.worca-cc', '.worca-cc-test', '.worca-cc-smoke']);
const MANIFESTS = {
  'package.json': 'node', 'pyproject.toml': 'python', 'requirements.txt': 'python', 'go.mod': 'go', 'Cargo.toml': 'rust',
  'pom.xml': 'java', 'build.gradle': 'java', 'build.gradle.kts': 'kotlin', 'Gemfile': 'ruby', 'composer.json': 'php', 'pubspec.yaml': 'dart',
};
const REQUIREMENTS_RE = /^requirements[\w.-]*\.txt$/i;   // requirements.txt, requirements-dev.txt, requirements_test.txt …
const CSPROJ_RE = /\.csproj$/i;
/** Manifest kind by file name; `requirements*.txt` and `*.csproj` are globs. */
const manifestKind = (name) => MANIFESTS[name] || (REQUIREMENTS_RE.test(name) ? 'python' : CSPROJ_RE.test(name) ? 'dotnet' : null);
const LOCKS = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'poetry.lock', 'uv.lock', 'Cargo.lock', 'go.sum', 'Gemfile.lock', 'composer.lock'];
const TEST_CONFIG_RE = /^(jest|vitest|playwright|cypress|karma|mocha)\.config\.[cm]?[jt]s$|^(pytest\.ini|tox\.ini|\.mocharc(\.[a-z]+)?|phpunit\.xml(\.dist)?)$/i;
const WEB_HINTS = ['react', 'react-dom', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', '@angular/core', 'express', 'fastify', 'koa', 'hono',
  'django', 'flask', 'fastapi', 'rails', 'sinatra', 'laravel', 'vite', 'webpack', 'tailwindcss', 'htmx'];
const LANG_BY_EXT = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.rb': 'Ruby', '.php': 'PHP', '.dart': 'Dart',
  '.cs': 'C#', '.swift': 'Swift', '.c': 'C', '.cpp': 'C++', '.h': 'C/C++', '.html': 'HTML', '.css': 'CSS', '.scss': 'CSS',
  '.vue': 'Vue', '.svelte': 'Svelte', '.sql': 'SQL', '.sh': 'Shell',
};

const uniq = (list) => [...new Set(list.filter(Boolean))];
/** Code-unit order: the same on every OS and locale (localeCompare is not). */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Dependency NAMES of one manifest (crude per-format scans; never throws). */
async function depsOf(path, name, max) {
  let text = '';
  try {
    if ((await stat(path)).size > MAX_MANIFEST_BYTES) return [];
    text = await readFile(path, 'utf8');
  } catch { return []; }
  const out = [];
  try {
    if (name === 'package.json' || name === 'composer.json') {
      const j = JSON.parse(text);
      for (const k of ['dependencies', 'devDependencies', 'require', 'require-dev']) out.push(...Object.keys(j?.[k] && typeof j[k] === 'object' ? j[k] : {}));
    } else if (REQUIREMENTS_RE.test(name)) {
      for (const line of text.split(/\r?\n/)) { const m = /^\s*([A-Za-z0-9_.\-\[\]]+)/.exec(line); if (m && !line.trim().startsWith('#') && !line.trim().startsWith('-')) out.push(m[1].replace(/\[.*$/, '')); }
    } else if (name === 'pyproject.toml') {
      const m = /dependencies\s*=\s*\[([\s\S]*?)\]/.exec(text);
      for (const s of (m ? m[1] : '').match(/"([^"]+)"|'([^']+)'/g) || []) out.push(s.replace(/["']/g, '').split(/[<>=!~;\s\[]/)[0]);
    } else if (name === 'go.mod') {
      for (const m of text.matchAll(/^\s*([\w.\-/]+\.[\w.\-/]+)\s+v[\w.\-+]+/gm)) out.push(m[1]);
    } else if (name === 'Cargo.toml') {
      const m = /\[dependencies\]([\s\S]*?)(\n\[|$)/.exec(text);
      for (const line of (m ? m[1] : '').split(/\r?\n/)) { const d = /^\s*([A-Za-z0-9_\-]+)\s*=/.exec(line); if (d) out.push(d[1]); }
    } else if (name === 'Gemfile') {
      for (const m of text.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
    } else if (name === 'pom.xml') {
      for (const m of text.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) out.push(m[1]);
    } else if (name === 'build.gradle' || name === 'build.gradle.kts') {
      for (const m of text.matchAll(/(?:implementation|api|testImplementation|compileOnly)\s*\(?\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
    } else if (CSPROJ_RE.test(name)) {
      for (const m of text.matchAll(/<PackageReference\s+Include="([^"]+)"/g)) out.push(m[1]);
    } else if (name === 'pubspec.yaml') {
      const m = /^dependencies:\s*\n([\s\S]*?)(?:^\S|$(?![\r\n]))/m.exec(text);
      for (const line of (m ? m[1] : '').split(/\r?\n/)) { const d = /^\s{2}([A-Za-z0-9_]+)\s*:/.exec(line); if (d) out.push(d[1]); }
    }
  } catch { /* a malformed manifest lists nothing */ }
  return uniq(out).sort(byCodeUnit).slice(0, max);
}

/** File counts by language, shallow (depth-bounded, entry-bounded, skip list). */
async function languageMix(dir, L) {
  const counts = new Map();
  let seen = 0;
  const walk = async (d, depth) => {
    if (depth > L.depth || seen >= L.maxEntries) return;
    let entries = [];
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= L.maxEntries) return;
      seen += 1;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) await walk(join(d, e.name), depth + 1); continue; }
      const lang = LANG_BY_EXT[extname(e.name).toLowerCase()];
      if (lang) counts.set(lang, (counts.get(lang) || 0) + 1);
    }
  };
  await walk(dir, 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]));
}

function clip(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = text;
  while (Buffer.byteLength(`${out}…`, 'utf8') > maxBytes) out = out.slice(0, -Math.max(1, Math.ceil(out.length * 0.05)));
  return `${out}…`;
}

/**
 * @param {string} dir project directory
 * @param {Partial<typeof FINGERPRINT_LIMITS>} [limits]
 * @returns {Promise<string>} the fingerprint text (see test/auto-fingerprint.test.mjs for the exact lines)
 */
export async function fingerprintProject(dir, limits = {}) {
  const L = { ...FINGERPRINT_LIMITS, ...limits };
  try {
    const top = (await readdir(dir, { withFileTypes: true }))
      .filter((e) => !SKIP.has(e.name) && (!e.name.startsWith('.') || e.name === '.github'))
      .sort((a, b) => byCodeUnit(a.name, b.name));
    const lines = [];
    const shown = top.slice(0, L.maxTopEntries).map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
    lines.push(`top-level: ${shown.join(' ')}${top.length > L.maxTopEntries ? ` … (+${top.length - L.maxTopEntries})` : ''}`);
    const deps = new Set();
    for (const e of top) {
      const kind = e.isFile() ? manifestKind(e.name) : null;
      if (!kind) continue;
      const names = await depsOf(join(dir, e.name), e.name, L.maxDeps);
      lines.push(`${e.name} (${kind}): ${names.length ? names.join(', ') : '(no dependencies listed)'}`);
      names.forEach((n) => deps.add(n.toLowerCase()));
    }
    const locks = top.filter((e) => e.isFile() && LOCKS.includes(e.name)).map((e) => e.name);
    if (locks.length) lines.push(`lockfiles: ${locks.join(', ')}`);
    const tests = top.filter((e) => e.isFile() && TEST_CONFIG_RE.test(e.name)).map((e) => e.name);
    const ci = top.some((e) => e.isDirectory() && e.name === '.github') ? ['.github/workflows'] : [];
    if (tests.length || ci.length) lines.push(`tests/ci: ${[...tests, ...ci].join(', ')}`);
    const langs = await languageMix(dir, L);
    if (langs.length) lines.push(`languages: ${langs.map(([l, n]) => `${l} (${n})`).join(', ')}`);
    const hints = [];
    const web = WEB_HINTS.filter((h) => deps.has(h));
    if (web.length) hints.push(`web-ui likely (${web.slice(0, 5).join(', ')})`);
    if (tests.length) hints.push(`tests: ${uniq(tests.map((t) => t.split('.')[0].toLowerCase())).join(', ')}`);
    if (hints.length) lines.push(`hints: ${hints.join('; ')}`);
    return clip(lines.join('\n'), L.maxBytes);
  } catch (err) {
    return `fingerprint: unavailable (${err?.code || err?.message || 'error'})`;
  }
}
