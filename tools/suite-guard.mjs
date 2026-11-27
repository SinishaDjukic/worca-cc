// tools/suite-guard.mjs — the suite regression guard. A test file may not boot ui/public/app.js inside each of its
// tests (today's offenders sit on test/suite-guard-offenders.json, a shrink-only list), and a new test file may not
// cost more than BUDGET_S seconds, read from test/timings.json (the per-file wall seconds CI's shards measure).
// Pure functions first; all I/O sits in readRepo and the CLI entry. Run by test/suite-guard.test.mjs.
//   node tools/suite-guard.mjs          print each problem; exit 1 when there is one, 2 on a base or read error
//   node tools/suite-guard.mjs --list   print the sorted JSON array of the files that boot per test today
import * as acorn from 'acorn';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BUDGET_S = 20;
export const LIST_FILE = 'test/suite-guard-offenders.json';

const TEST_CALLEES = new Set(['test', 'it']);
const TEST_VARIANTS = new Set(['only', 'skip', 'todo']);
const EACH_HOOKS = new Set(['beforeEach', 'afterEach']);
const ARRAY_METHODS = new Set(['forEach', 'map', 'flatMap', 'filter', 'some', 'every', 'reduce', 'find']);
const LOOPS = new Set(['ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement']);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
// A path segment naming app.js, optionally followed by a query or hash.
const APP_JS = /(^|[/\\])app\.js([?#]|$)/;

const parse = (source) => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });

// Calls visit(node, ancestors) for every node below root, root included; ancestors runs outermost first.
function walk(root, visit, ancestors = []) {
  if (!root || typeof root.type !== 'string') return;
  visit(root, ancestors);
  ancestors.push(root);
  for (const key of Object.keys(root)) {
    const v = root[key];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, ancestors); }
    else if (v && typeof v.type === 'string') walk(v, visit, ancestors);
  }
  ancestors.pop();
}

const resolveRel = (from, spec) => (spec.startsWith('./') || spec.startsWith('../'))
  ? posix.normalize(posix.join(posix.dirname(from), spec)) : null;

// The module-level facts both classify and helperBoots need: variable initialisers (for following a binding to
// app.js), named local functions, names imported from helpers, and the module's exports.
function scan(ast, path) {
  const vars = new Map();
  const fns = new Map();
  walk(ast, (n) => {
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init) {
      vars.set(n.id.name, n.init);
      if (FUNCTIONS.has(n.init.type)) fns.set(n.id.name, n.init);
    } else if (n.type === 'FunctionDeclaration' && n.id) fns.set(n.id.name, n);
  });
  const imports = []; // { local, from, imported } — imported '*' for a namespace
  const exports = []; // { exported, local } or { exported, from, imported } or { star: from }
  for (const s of ast.body) {
    if (s.type === 'ImportDeclaration') {
      const from = resolveRel(path, s.source.value);
      if (!from) continue;
      for (const sp of s.specifiers) {
        const imported = sp.type === 'ImportSpecifier' ? (sp.imported.name ?? sp.imported.value)
          : sp.type === 'ImportDefaultSpecifier' ? 'default' : '*';
        imports.push({ local: sp.local.name, from, imported });
      }
    } else if (s.type === 'ExportNamedDeclaration') {
      const from = s.source ? resolveRel(path, s.source.value) : null;
      if (s.declaration) {
        const d = s.declaration;
        if (d.id) exports.push({ exported: d.id.name, local: d.id.name });
        for (const v of d.declarations || []) if (v.id.type === 'Identifier') exports.push({ exported: v.id.name, local: v.id.name });
      }
      for (const sp of s.specifiers) {
        const local = sp.local.name ?? sp.local.value;
        const exported = sp.exported.name ?? sp.exported.value;
        if (s.source) { if (from) exports.push({ exported, from, imported: local }); }
        else exports.push({ exported, local });
      }
    } else if (s.type === 'ExportAllDeclaration' && !s.exported) {
      const from = resolveRel(path, s.source.value);
      if (from) exports.push({ star: from });
    } else if (s.type === 'ExportDefaultDeclaration' && s.declaration.id) {
      exports.push({ exported: 'default', local: s.declaration.id.name });
    }
  }
  return { vars, fns, imports, exports };
}

// A boot import: a dynamic import() whose argument refers to app.js (directly or through a binding) and carries a
// query string (the cache bust that re-runs the whole app).
function isBootImport(node, vars) {
  const strings = [];
  const seen = new Set();
  const collect = (root) => walk(root, (n) => {
    if (n.type === 'Literal' && typeof n.value === 'string') strings.push(n.value);
    else if (n.type === 'TemplateElement') strings.push(n.value.cooked ?? n.value.raw);
    else if (n.type === 'Identifier' && vars.has(n.name) && !seen.has(n.name)) { seen.add(n.name); collect(vars.get(n.name)); }
  });
  collect(node.source);
  return strings.some((s) => APP_JS.test(s)) && strings.some((s) => s.includes('?'));
}

// The local names that boot: names imported from a helper that exports a boot, then every named local function
// whose body boots, to a fixed point. Returns a predicate over a function body (or any node).
function bootFinder({ vars, fns, imports }, boots) {
  const names = new Set();
  const namespaces = new Map(); // local namespace name -> the helper's booting exports
  for (const { local, from, imported } of imports) {
    const b = boots.get(from);
    if (!b?.size) continue;
    if (imported === '*') namespaces.set(local, b);
    else if (b.has(imported)) names.add(local);
  }
  const boots_ = (root) => {
    let hit = false;
    walk(root, (n) => {
      if (hit) return;
      if (n.type === 'ImportExpression') hit = isBootImport(n, vars);
      else if (n.type === 'CallExpression') {
        const c = n.callee;
        if (c.type === 'Identifier') hit = names.has(c.name);
        else if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && !c.computed) hit = !!namespaces.get(c.object.name)?.has(c.property.name);
      }
    });
    return hit;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, fn] of fns) if (!names.has(name) && boots_(fn.body)) { names.add(name); changed = true; }
  }
  return { names, boots: boots_ };
}

// helpers: Map(repo-relative path -> source) of test/helpers/*.mjs. Returns Map(path -> Set of exported names that
// boot app.js), resolved across helpers that import or re-export each other.
export function helperBoots(helpers) {
  const scans = new Map();
  for (const [path, source] of helpers) {
    try { scans.set(path, scan(parse(source), path)); } catch { /* an unparsable helper exports no boot */ }
  }
  const out = new Map([...helpers.keys()].map((p) => [p, new Set()]));
  for (let changed = true; changed;) {
    changed = false;
    for (const [path, s] of scans) {
      const { names } = bootFinder(s, out);
      const mine = out.get(path);
      const add = (name) => { if (!mine.has(name)) { mine.add(name); changed = true; } };
      for (const e of s.exports) {
        if (e.star) for (const n of out.get(e.star) ?? []) add(n);
        else if (e.from) { if (out.get(e.from)?.has(e.imported)) add(e.exported); }
        else if (names.has(e.local)) add(e.exported);
      }
    }
  }
  return out;
}

const isTestCall = (c) => (c.type === 'Identifier' && TEST_CALLEES.has(c.name))
  || (c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier'
    && ((TEST_CALLEES.has(c.object.name) && TEST_VARIANTS.has(c.property.name)) || c.property.name === 'test'));
const isEachHook = (c) => (c.type === 'Identifier' && EACH_HOOKS.has(c.name))
  || (c.type === 'MemberExpression' && !c.computed && EACH_HOOKS.has(c.property.name));
const callback = (call) => [...call.arguments].reverse().find((a) => FUNCTIONS.has(a.type));

// Decides whether one test file boots app.js inside each test. bootingTests counts the booting test() calls, each
// weighted by how often it runs: a local factory's call count, and 2 for a loop or an array-method callback.
export function classify(path, source, boots) {
  let ast;
  try { ast = parse(source); } catch (e) { return { error: e.message }; }
  const s = scan(ast, path);
  const finder = bootFinder(s, boots);
  const calls = new Map(); // local function name -> how often the file calls it
  walk(ast, (n) => { if (n.type === 'CallExpression' && n.callee.type === 'Identifier') calls.set(n.callee.name, (calls.get(n.callee.name) ?? 0) + 1); });
  const fnName = new Map([...s.fns].map(([name, fn]) => [fn, name]));
  let bootingTests = 0;
  let eachHook = false;
  walk(ast, (n, ancestors) => {
    if (n.type !== 'CallExpression') return;
    const cb = callback(n);
    if (!cb) return;
    if (isEachHook(n.callee)) { if (finder.boots(cb.body)) eachHook = true; return; }
    if (!isTestCall(n.callee) || !finder.boots(cb.body)) return;
    let weight = 1;
    for (let i = 0; i < ancestors.length; i++) {
      const a = ancestors[i];
      if (LOOPS.has(a.type) && a.body === ancestors[i + 1]) weight *= 2;
      else if (FUNCTIONS.has(a.type)) {
        const name = fnName.get(a);
        if (name) weight *= Math.max(calls.get(name) ?? 0, 1);
        const parent = ancestors[i - 1];
        if (parent?.type === 'CallExpression' && parent.arguments.includes(a) && parent.callee.type === 'MemberExpression'
          && !parent.callee.computed && ARRAY_METHODS.has(parent.callee.property.name)) weight *= 2;
      }
    }
    bootingTests += weight;
  });
  return { offends: eachHook || bootingTests >= 2, bootingTests };
}

// files: Map(top-level test path -> source, or null when the prefilter skipped it). list: the HEAD list or null.
// base: { ref, files: Set, list } or null when the base-dependent rules (time, added) are skipped.
// Returns the sorted problem messages; [] when clean.
export function checkSuite({ files, boots, timings, list, base }) {
  const problems = [];
  const entries = Array.isArray(list?.perTestBoot) ? list.perTestBoot : [];
  if (!list) problems.push(`${LIST_FILE} is missing.`);
  else if (entries.some((f, i) => i > 0 && !(entries[i - 1] < f))) problems.push(`${LIST_FILE} must list each file once, sorted.`);
  const listed = new Set(entries);
  const offends = new Set();
  const broken = new Set();
  for (const [file, source] of files) {
    if (source == null) continue;
    const r = classify(file, source, boots);
    if (r.error) { broken.add(file); problems.push(`${file} could not be parsed: ${r.error}`); continue; }
    if (!r.offends) continue;
    offends.add(file);
    if (!listed.has(file)) {
      problems.push(`${file} boots ui/public/app.js inside each test (${r.bootingTests} tests): boot it once in before(), see test/helpers/*-boot.mjs. ${LIST_FILE} only shrinks.`);
    }
  }
  for (const file of listed) {
    if (!files.has(file)) problems.push(`${file} is on ${LIST_FILE} but no longer exists: remove it from the list.`);
    else if (!offends.has(file) && !broken.has(file)) problems.push(`${file} is on ${LIST_FILE} but no longer boots app.js per test: remove it from the list.`);
  }
  if (base) {
    for (const file of files.keys()) {
      const t = timings?.[file];
      if (!base.files.has(file) && typeof t === 'number' && t > BUDGET_S) {
        problems.push(`${file} is a new test file timed at ${t} s in test/timings.json, over the ${BUDGET_S} s budget.`);
      }
    }
    if (base.list) {
      const was = new Set(base.list.perTestBoot ?? []);
      for (const file of listed) {
        if (!was.has(file)) problems.push(`${file} was added to ${LIST_FILE}: the list only shrinks (compared with ${base.ref.slice(0, 10)}).`);
      }
    }
  }
  return problems.sort();
}

// env: the process environment. git(args) returns stdout and throws on a non-zero exit.
// Returns { ref } (a commit to compare with) or { skip: reason } (the base-dependent rules are skipped).
export function resolveBase(env, git) {
  const v = env.WORCA_SUITE_GUARD_BASE;
  if (v === 'none') return { skip: 'WORCA_SUITE_GUARD_BASE=none' };
  if (v) {
    try { return { ref: git(['rev-parse', '--verify', `${v}^{commit}`]).trim() }; } catch {
      throw new Error(`suite guard: WORCA_SUITE_GUARD_BASE=${v} is not a commit here`);
    }
  }
  if (env.GITHUB_ACTIONS === 'true') {
    throw new Error(`suite guard: no base commit to compare ${LIST_FILE} with; set WORCA_SUITE_GUARD_BASE`);
  }
  try { return { ref: git(['merge-base', 'HEAD', 'origin/dev']).trim() }; } catch {
    return { skip: 'no origin/dev to compare with' };
  }
}

// The I/O layer: what checkSuite needs, read from the working tree at root and (when ref is set) from that commit.
// parsed counts the files the classifier parses (all helpers plus the prefiltered top-level files).
export function readRepo(root, ref) {
  const read = (rel) => readFileSync(posix.join(root, rel), 'utf8');
  const mjs = (dir) => readdirSync(posix.join(root, dir), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.mjs')).map((d) => d.name).sort();
  const helpers = new Map(mjs('test/helpers').map((f) => [`test/helpers/${f}`, read(`test/helpers/${f}`)]));
  const boots = helperBoots(helpers);
  const bootingHelpers = [...boots].filter(([, names]) => names.size).map(([p]) => posix.basename(p));
  const files = new Map();
  let parsed = helpers.size;
  for (const f of mjs('test')) {
    const source = read(`test/${f}`);
    const keep = source.includes('app.js') || bootingHelpers.some((h) => source.includes(h));
    files.set(`test/${f}`, keep ? source : null);
    if (keep) parsed++;
  }
  const timingsPath = posix.join(root, 'test/timings.json');
  const timings = existsSync(timingsPath) ? JSON.parse(readFileSync(timingsPath, 'utf8')) : {};
  const listPath = posix.join(root, LIST_FILE);
  const list = existsSync(listPath) ? JSON.parse(readFileSync(listPath, 'utf8')) : null;
  let base = null;
  if (ref) {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
    const baseFiles = new Set(git(['ls-tree', '--name-only', ref, 'test/']).split('\n').filter(Boolean));
    let baseList = null;
    try { baseList = JSON.parse(git(['show', `${ref}:${LIST_FILE}`])); } catch { /* no list at the base: first landing */ }
    base = { ref, files: baseFiles, list: baseList };
  }
  return { files, boots, timings, list, base, parsed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  if (process.argv.includes('--list')) {
    const { files, boots } = readRepo(root, null);
    const out = [...files].filter(([f, src]) => src != null && classify(f, src, boots).offends).map(([f]) => f).sort();
    console.log(JSON.stringify(out, null, 1));
    process.exit(0);
  }
  let repo;
  try {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const base = resolveBase(process.env, git);
    if (base.skip) console.error(`suite guard: base-dependent rules skipped (${base.skip})`);
    repo = readRepo(root, base.ref ?? null);
  } catch (e) { console.error(e.message); process.exit(2); }
  const problems = checkSuite(repo);
  for (const p of problems) console.log(p);
  console.log(`suite guard: ${problems.length} problem(s), ${repo.parsed} files parsed`);
  process.exit(problems.length ? 1 : 0);
}
