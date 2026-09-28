// pkg-gradle: Groovy and Kotlin DSL builds.
//   provides  maven:<group>:<rootProject.name> and maven:<group>:<leaf> per `include` of the ROOT
//             settings file (only when a `group` is declared); rootProject.name aliases the member
//             when `aliasable` (a nested settings file only with a multi-word name)
//   consumes  "g:a[:v]" string and group/name map notation in dependency configurations,
//             [libraries] of gradle/libs.versions.toml (exact when a build file references the
//             alias — `libs.<alias>`, or a referenced `libs.bundles.<name>` — heuristic otherwise),
//             and project(':x') dependencies whose settings remap `project(':x').projectDir` into
//             ANOTHER member (target = it). Each fact cites the line of its coordinate.
// Intra-build project(':x') dependencies never leave the member and are not facts. A test-path
// build or settings file (a TestKit fixture) sets no stack, name, group or include.
import { posix } from 'node:path';
import { splitLines, lineIndex, blankComments, fact, memberForPath, aliasable, onePerKey, cleanUnresolved, isSampleManifest } from './lib/text.mjs';
import { loadToml, tomlSections, keyLine } from './lib/toml.mjs';
import { isTestPath } from '../files.mjs';

// Dependency configurations: the standard names plus any source-set prefixed variant.
const CONFIGS = String.raw`(?:implementation|api|compileOnly|runtimeOnly|compile|runtime|testCompile|testRuntime|annotationProcessor|kapt|ksp|classpath|developmentOnly|[a-z][A-Za-z0-9]{0,40}(?:Implementation|Api|CompileOnly|RuntimeOnly|AnnotationProcessor))`;
const WRAP = String.raw`(?:(?:platform|enforcedPlatform|testFixtures)\s*\(\s*)?`;
// After the configuration name: '(' with any whitespace around it, or plain spaces — never both
// (`\s*\(?\s*` backtracks quadratically on a long whitespace run).
const HEAD = String.raw`(?:\s*\(\s*|[ \t]*)`;
// Each regex: one bounded token run, no nested quantifiers (linear on a 1 MB line).
const RE = {
  coord: new RegExp(String.raw`\b${CONFIGS}${HEAD}${WRAP}(['"])([^'"\n]{3,300})\1`, 'g'),
  map: new RegExp(String.raw`\b${CONFIGS}${HEAD}group\s*[:=]\s*(['"])([^'"\n]{1,200})\1\s*,\s*name\s*[:=]\s*(['"])([^'"\n]{1,200})\3`, 'g'),
  project: new RegExp(String.raw`\b${CONFIGS}${HEAD}${WRAP}project\s*\(\s*(?:path\s*[:=]\s*)?(['"])(:?[^'"\n]{1,200})\1`, 'g'),
  rootName: /\brootProject\.name\s*=\s*(['"])([^'"\n]{1,200})\1/g,
  // include ':a', ':b' | include(':a') | include(\n  ":a",\n  ":b",\n) — the list (which may span
  // lines) is read by an indexOf scan in detect(), never by a bounded run re-scanned per `include`
  include: /^[ \t]*include\b[ \t]*/gm,
  includeArg: /(['"])(:?[^'"\n]{1,200})\1/g,
  group: /^[ \t]*(?:project\.)?group(?:[ \t]*=[ \t]*|[ \t]+)(['"])([^'"\n]{1,200})\1/gm,
  projectDir: /project\s*\(\s*(['"])(:?[^'"\n]{1,200})\1\s*\)\s*\.projectDir\s*=\s*(?:file\s*\(\s*|(?:new\s+)?File\s*\(\s*(?:settingsDir|rootDir)\s*,\s*)?(['"])([^'"\n]{1,300})\3/g,
  libsRef: /\blibs\.([A-Za-z][\w.]{0,200})/g, // version-catalog accessors: libs.money, libs.ledger.core, libs.bundles.ktor
  // Groovy varargs after a coordinate: implementation 'a:b:1', 'c:d:2' (the list may span lines). Sticky.
  more: /[ \t]*,\s*(['"])([^'"\n]{3,300})\1/y,
};

const leaf = (p) => p.split(':').filter(Boolean).pop() || '';
const COORD_OK = /^[\w.-]+$/;
/** Gradle's accessor for a catalog alias: '-', '_' and '.' all become '.' (`ledger-core` → `libs.ledger.core`). */
const accessor = (alias) => String(alias).replace(/[-_.]+/g, '.').toLowerCase();
/** Offset of a quoted capture that ends the match (`m[0]` ends with its closing quote). */
const tailAt = (m, capture) => m.index + m[0].length - 1 - capture.length;

/** true for a build file of a build the member's ROOT build includes: under buildSrc/, or under a directory
 *  (not the root) with its own settings file — only when the member has a root settings file (a member
 *  whose only build sits in backend/ keeps that build's name and group). */
function includedBuild(files, rel) {
  if (!files.has('settings.gradle') && !files.has('settings.gradle.kts')) return false;
  if (/^buildSrc\//.test(rel)) return true;
  for (let d = posix.dirname(rel); d && d !== '.'; d = posix.dirname(d)) {
    if (files.has(`${d}/settings.gradle`) || files.has(`${d}/settings.gradle.kts`)) return true;
  }
  return false;
}

/** gradle/libs.versions.toml: the [libraries] and [bundles] are kept in state; finish() decides,
 *  once every build file has been read, which libraries a build references (exact) and which are
 *  only declared (heuristic). */
function detectToml({ rel, text }, ctx) {
  const lines = splitLines(text);
  const { data, error } = loadToml(text);
  if (!data) return { unresolved: cleanUnresolved(ctx.state, rel, [{ kind: 'pkg', raw: rel, file: rel, line: 1, reason: `toml parse error: ${error}` }]) };
  const sections = tomlSections(lines);
  const st = ctx.state;
  st.catalog ??= [];
  st.bundles ??= new Map();
  const libraries = data.libraries && typeof data.libraries === 'object' && !Array.isArray(data.libraries) ? data.libraries : {};
  for (const [alias, v] of Object.entries(libraries)) {
    let g = null; let a = null;
    if (typeof v === 'string') [g, a] = v.split(':');
    else if (v && typeof v.module === 'string') [g, a] = v.module.split(':');
    else if (v && typeof v.group === 'string' && typeof v.name === 'string') { g = v.group; a = v.name; }
    if (!g || !a || !COORD_OK.test(g) || !COORD_OK.test(a)) continue;
    st.catalog.push({ alias, key: `maven:${g}:${a}`, rel, lines, line: keyLine(lines, sections, ['libraries'], alias) || 1 });
  }
  const bundles = data.bundles && typeof data.bundles === 'object' && !Array.isArray(data.bundles) ? data.bundles : {};
  for (const [name, list] of Object.entries(bundles)) {
    if (Array.isArray(list)) st.bundles.set(`bundles.${accessor(name)}`, list.filter((x) => typeof x === 'string').map(accessor));
  }
  return { stack: isTestPath(rel) ? [] : ['java'] };
}

function detect(file, ctx) {
  if (file.rel.endsWith('.toml')) return detectToml(file, ctx);
  const { rel, text } = file;
  const lines = splitLines(text);
  const code = blankComments(text, { slash: true });
  const lineOf = lineIndex(code);
  const st = ctx.state;
  st.projectDeps ??= [];
  st.includes ??= [];
  st.projectDirs ??= {};
  st.libRefs ??= new Set();
  const facts = [];
  const unresolved = [];
  const test = isTestPath(rel); // a TestKit fixture build: its facts count (marked test), it names nothing
  // An included build (build-logic/ with its own settings file, buildSrc/) of the member's root build: its
  // `group` and `rootProject.name` are that build's (convention plugins), never the member's.
  st.fileSet ??= new Set(ctx.files || []);
  const included = includedBuild(st.fileSet, rel);
  const isRoot = !rel.includes('/');
  // The root settings file names the build; an included build's settings (build-logic/, buildSrc/)
  // sorts earlier but never wins, and only the root settings file's `include`s are provides.
  const rootSettings = /^settings\.gradle(\.kts)?$/.test(rel);
  for (const m of test || included ? [] : code.matchAll(RE.rootName)) {
    if (!st.root || (rootSettings && !st.root.rootSettings)) st.root = { name: m[2], rel, line: lineOf(tailAt(m, m[2])), lines, rootSettings };
  }
  for (const m of test || included ? [] : code.matchAll(RE.group)) {
    if (!st.group || (isRoot && !st.group.root)) st.group = { value: m[2], root: isRoot };
  }
  if (!test && /(^|\/)settings\.gradle(\.kts)?$/.test(rel)) {
    let close = -1; // the last ')' found, reused while it lies ahead: one pass for every `include(`
    for (const m of rootSettings ? code.matchAll(RE.include) : []) {
      const at = m.index + m[0].length;
      let base = at;
      let end;
      if (code[at] === '(') {
        if (close < at) close = code.indexOf(')', at);
        if (close === -1) break; // no later list can close either
        if (close - at > 4000) continue;
        base = at + 1;
        end = close;
      } else {
        const nl = code.indexOf('\n', at);
        end = Math.min(nl === -1 ? code.length : nl, at + 2000);
      }
      for (const a of code.slice(base, end).matchAll(RE.includeArg)) st.includes.push({ path: a[2], rel, line: lineOf(base + a.index), lines });
    }
    for (const m of code.matchAll(RE.projectDir)) st.projectDirs[m[2].replace(/^:?/, ':')] = { dir: m[4], rel };
  }
  const coords = [];
  for (const m of code.matchAll(RE.coord)) {
    coords.push({ coord: m[2], at: tailAt(m, m[2]) });
    RE.more.lastIndex = m.index + m[0].length;
    for (let n = RE.more.exec(code); n; n = RE.more.exec(code)) coords.push({ coord: n[2], at: tailAt(n, n[2]) });
  }
  for (const { coord, at } of coords) {
    const parts = coord.split(':');
    if (parts.length < 2) continue;
    const [g, a] = parts;
    const line = lineOf(at); // the coordinate's own line (a call may span lines)
    if (g.includes('$') || a.includes('$')) { unresolved.push({ kind: 'pkg', raw: coord, file: rel, line, reason: 'interpolated gradle coordinate' }); continue; }
    if (!COORD_OK.test(g) || !COORD_OK.test(a)) continue;
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `maven:${g}:${a}`, rel, lines, line, needle: coord, confidence: 'exact' }));
  }
  for (const m of code.matchAll(RE.map)) {
    if (!COORD_OK.test(m[2]) || !COORD_OK.test(m[4])) continue;
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `maven:${m[2]}:${m[4]}`, rel, lines, line: lineOf(tailAt(m, m[4])), needle: m[4], confidence: 'exact' }));
  }
  for (const m of code.matchAll(RE.project)) st.projectDeps.push({ path: m[2].replace(/^:?/, ':'), rel, line: lineOf(tailAt(m, m[2])), lines, needle: m[2] });
  for (const m of code.matchAll(RE.libsRef)) {
    const parts = m[1].toLowerCase().split('.').filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) st.libRefs.add(parts.slice(0, i).join('.')); // `libs.x.y.get()` references x.y
  }
  const stack = test ? [] : ['java'];
  if (stack.length && /org\.jetbrains\.kotlin|kotlin\s*\(\s*"jvm"\s*\)/.test(code)) stack.push('kotlin');
  return { facts: onePerKey(facts), unresolved: cleanUnresolved(st, rel, unresolved), stack };
}

function finish(ctx) {
  const st = ctx.state;
  const facts = [];
  const aliases = [];
  const group = st.group?.value;
  if (st.root) {
    if (aliasable(st.root.rel, st.root.name)) aliases.push({ value: st.root.name, source: 'gradle' });
    if (group) facts.push(fact({ kind: 'pkg', dir: 'provides', key: `maven:${group}:${st.root.name}`, rel: st.root.rel, lines: st.root.lines, line: st.root.line, needle: st.root.name, detail: 'Gradle root project', confidence: 'exact' }));
  }
  if (group) {
    for (const inc of st.includes || []) {
      const name = leaf(inc.path);
      // M8: an included sample subproject (`:examples:billing`, or a projectDir under samples/) is no package of this member
      const dir = st.projectDirs?.[inc.path.replace(/^:?/, ':')]?.dir ?? inc.path.split(':').filter(Boolean).join('/');
      if (!name || isSampleManifest(`${dir}/`)) continue;
      facts.push(fact({ kind: 'pkg', dir: 'provides', key: `maven:${group}:${name}`, rel: inc.rel, lines: inc.lines, line: inc.line, needle: inc.path, detail: 'Gradle subproject', confidence: 'exact' }));
    }
  }
  for (const d of st.projectDeps || []) {
    const remap = st.projectDirs?.[d.path];
    if (!remap) continue;
    const other = memberForPath(ctx, remap.rel, remap.dir);
    if (!other || other.key === ctx.member.key) continue;
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `maven:${group || other.key}:${leaf(d.path)}`, rel: d.rel, lines: d.lines, line: d.line, needle: d.needle, detail: `project dependency (${remap.dir})`, target: other.key, confidence: 'exact' }));
  }
  // Version catalog: a library a build file references is a consume; one only declared (a shared
  // catalog lists far more than a build uses) is a guess, so its edge stays heuristic.
  const refs = st.libRefs || new Set();
  for (const [bundle, list] of st.bundles || []) if (refs.has(bundle)) for (const x of list) refs.add(x);
  for (const c of st.catalog || []) {
    const used = refs.has(accessor(c.alias));
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: c.key, rel: c.rel, lines: c.lines, line: c.line, needle: c.alias,
      detail: used ? 'version catalog' : 'version catalog (no build file references it)', confidence: used ? 'exact' : 'heuristic' }));
  }
  return { facts: onePerKey(facts), aliases };
}

export default Object.freeze({
  id: 'pkg-gradle',
  claims: (rel) => (/(^|\/)(settings|build)\.gradle(\.kts)?$/.test(rel) || /(^|\/)gradle\/libs\.versions\.toml$/.test(rel)) && !isSampleManifest(rel),
  detect,
  finish,
});
