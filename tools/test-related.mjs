// tools/test-related.mjs — `npm run test:related`: the test files a change can affect. A static
// reverse-dependency graph over the repo's own sources: relative imports (static and dynamic),
// `new URL('…', import.meta.url)`, and quoted repo paths (a 'src/…' / '../ui/public/app.js' string,
// or the literal segments of a join()/resolve() call). A directory reference made by new URL(),
// an import or a join() ('../agents/') depends on every file inside it; a quoted path in prose (a
// prompt saying "src/ and test/") only counts when it names a file, and comments and backticked prose never count. A test is related when a changed file is in its transitive closure, or
// is the test itself. Over-selecting is safe; under-selecting is not, so anything the graph cannot
// reason about (FULL_SUITE) asks for the whole suite.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SCAN_DIRS = ['src', 'ui', 'bin', 'agents', 'tools', 'test', 'templates', 'plugins'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.worca-cc-test', 'fixtures', 'snapshots']);
const CODE = /\.(mjs|cjs|js)$/;
// The runner, its config and the dependency set: a change here can affect any test.
export const FULL_SUITE = [/^package\.json$/, /^npm-shrinkwrap\.json$/, /^tools\/test(-run|-related)?\.mjs$/, /^test\/tiers\.json$/,
  /^test\/helpers\/no-real-claude\//, /^\.nvmrc$/];
const TEST_FILE = /^test\/[^/]+\.test\.mjs$/;

const posix = (p) => p.split(sep).join('/');
const ROOT_DIRS = new Set(['src', 'ui', 'test', 'tools', 'docs']);   // too broad to mean "reads every file in it"

function walk(root, dir, out) {
  let entries;
  try { entries = readdirSync(join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(root, rel, out); } else if (CODE.test(e.name)) out.push(rel);
  }
  return out;
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bnew\s+URL\(\s*)(['"`])(\.{1,2}\/[^'"`]*)\1/g;
// Single or double quotes only: a backticked path is almost always prose (`ui/server.mjs` in a comment or a prompt).
const PATH_LITERAL_RE = /(['"])((?:\.{1,2}\/)*(?:src|ui|bin|agents|tools|test|templates|plugins|docs)\/[^'"`\s$]*)\1/g;
// Comments never load anything: a path named in one is not a dependency.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1');
const JOIN_RE = /\b(?:join|resolve)\(([^()]*)\)/g;
const SEGMENT_RE = /(['"])([^'"\s$]+)\1/g;

/** The repo paths (files or directories) one source file refers to. */
export function referencesOf(root, file, src) {
  const out = new Set();
  const add = (abs, { dirs = true } = {}) => {
    const rel = posix(relative(root, abs)).replace(/\/$/, '');
    if (!rel || rel.startsWith('..')) return;
    let st;
    try { st = statSync(abs); } catch { return; }
    if (st.isDirectory() && (!dirs || ROOT_DIRS.has(rel))) return;
    out.add(rel);
  };
  const dir = dirname(join(root, file));
  src = stripComments(src);
  for (const m of src.matchAll(IMPORT_RE)) add(resolve(dir, m[2].split(/[?#]/)[0]));
  for (const m of src.matchAll(PATH_LITERAL_RE)) {
    const p = m[2].split(/[?#]/)[0];
    add(resolve(dir, p), { dirs: false });                                   // relative to the file …
    add(resolve(root, p.replace(/^(\.{1,2}\/)+/, '')), { dirs: false });     // … or to the repo root
  }
  for (const m of src.matchAll(JOIN_RE)) {
    const segs = [...m[1].matchAll(SEGMENT_RE)].map((s) => s[2]);
    if (segs.length < 2) continue;
    const p = segs.join('/').replace(/^(\.{1,2}\/)+/, '');
    add(resolve(root, p));
  }
  return out;
}

/** Map of repo path → the source files that refer to it (file and directory references). */
export function buildGraph(root) {
  const files = SCAN_DIRS.flatMap((d) => walk(root, d, []));
  const byTarget = new Map();
  const dirRefs = [];   // [dirPath, referrer]
  for (const f of files) {
    let src;
    try { src = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    for (const ref of referencesOf(root, f, src)) {
      if (ref === f) continue;
      let isDir = false;
      try { isDir = statSync(join(root, ref)).isDirectory(); } catch { /* gone */ }
      if (isDir) { if (ref !== '.' && ref !== '') dirRefs.push([ref, f]); continue; }
      if (!byTarget.has(ref)) byTarget.set(ref, new Set());
      byTarget.get(ref).add(f);
    }
  }
  const referrers = (target) => {
    const out = new Set(byTarget.get(target) || []);
    for (const [d, f] of dirRefs) if (target.startsWith(`${d}/`)) out.add(f);
    return out;
  };
  return { files, referrers };
}

/**
 * @param {string[]} changed repo-relative posix paths
 * @returns {{ full: boolean, reason?: string, tests: string[] }}
 */
export function relatedTests(root, changed, graph = buildGraph(root)) {
  const trigger = changed.find((c) => FULL_SUITE.some((re) => re.test(c)));
  if (trigger) return { full: true, reason: `${trigger} changed`, tests: [] };
  const seen = new Set(changed);
  const queue = [...changed];
  while (queue.length) {
    for (const r of graph.referrers(queue.pop())) if (!seen.has(r)) { seen.add(r); queue.push(r); }
  }
  const tests = [...seen].filter((f) => TEST_FILE.test(f) && existsSync(join(root, f))).sort();
  return { full: false, tests };
}

/** Files changed in the working tree against `base` (default HEAD), including untracked ones. */
export function changedFiles(root, base = 'HEAD') {
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`);
    return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  };
  return [...new Set([...git(['diff', '--name-only', base]), ...git(['ls-files', '--others', '--exclude-standard'])])].sort();
}
