// pkg-cargo: every Cargo.toml (a workspace root and each member crate).
//   provides  cargo:<package.name>; alias = name when `aliasable`; role = package.description
//   consumes  [dependencies], [dev-dependencies], [build-dependencies],
//             [target.<cfg>.*dependencies] and [workspace.dependencies]; a renamed
//             dependency (`pkg = { package = "real" }`) is keyed by the real name;
//             `path = "../x"` sets target = the member owning that directory.
// A virtual workspace root has no [package] and provides nothing; its member crates are
// read from their own Cargo.toml files (every Cargo.toml is claimed). A test-path crate (a
// fixture) sets no stack and no role.
import { splitLines, fact, memberForPath, aliasable, onePerKey, cleanUnresolved, isSampleManifest } from './lib/text.mjs';
import { loadToml, tomlSections, keyLine } from './lib/toml.mjs';
import { isTestPath } from '../files.mjs';
import { LIMITS } from '../../../shared/workspace-map/limits.mjs';

const DEP_TABLES = ['dependencies', 'dev-dependencies', 'build-dependencies'];

function detect({ rel, text }, ctx) {
  const lines = splitLines(text);
  const { data, error } = loadToml(text);
  if (!data) {
    const facts = [];
    let section = '';
    lines.forEach((l, i) => {
      const h = /^\s*\[([^\]]+)\]/.exec(l);
      if (h) { section = h[1].trim(); return; }
      const n = /^\s*name\s*=\s*["']([^"']+)["']/.exec(l);
      if (n && section === 'package') facts.push(fact({ kind: 'pkg', dir: 'provides', key: `cargo:${n[1]}`, rel, lines, line: i + 1, needle: n[1], confidence: 'heuristic' }));
    });
    return { facts: onePerKey(facts), stack: isTestPath(rel) ? [] : ['rust'], unresolved: cleanUnresolved(ctx.state, rel, [{ kind: 'pkg', raw: rel, file: rel, line: 1, reason: `toml parse error: ${error}` }]) };
  }
  const sections = tomlSections(lines);
  const facts = [];
  const aliases = [];
  const name = data.package?.name;
  if (typeof name === 'string' && name) {
    facts.push(fact({ kind: 'pkg', dir: 'provides', key: `cargo:${name}`, rel, lines, line: keyLine(lines, sections, ['package'], 'name') || 1, needle: name, detail: 'Rust crate', confidence: 'exact' }));
    if (aliasable(rel, name)) aliases.push({ value: name, source: 'cargo' });
  }
  const tables = [];
  for (const t of DEP_TABLES) tables.push([[t], data[t], t === 'dependencies' ? undefined : t]);
  for (const [cfg, body] of Object.entries(data.target || {})) for (const t of DEP_TABLES) tables.push([['target', cfg, t], body?.[t], `target ${cfg}`]);
  tables.push([['workspace', 'dependencies'], data.workspace?.dependencies, 'workspace']);
  for (const [section, deps, detail] of tables) {
    for (const [dep, spec] of Object.entries(deps && typeof deps === 'object' && !Array.isArray(deps) ? deps : {})) {
      const table = spec && typeof spec === 'object' ? spec : {};
      // `{ workspace = true }`: the root's [workspace.dependencies] entry is the fact.
      if (table.workspace === true) continue;
      const real = typeof table.package === 'string' ? table.package : dep;
      const path = typeof table.path === 'string' ? table.path : undefined;
      const m = path ? memberForPath(ctx, rel, path) : null;
      // A path into this member (a sibling crate) never leaves it: same-named crates elsewhere
      // (`core`, `util`) would otherwise join by norm.
      if (m && m.key === ctx.member.key) continue;
      const line = keyLine(lines, sections, section, dep) || 1;
      facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `cargo:${real}`, rel, lines, line, needle: dep,
        detail: [detail, path && `path ${path}`].filter(Boolean).join(', ') || undefined,
        target: m && m.key !== ctx.member.key ? m.key : undefined, confidence: 'exact' }));
    }
  }
  const desc = data.package?.description;
  const test = isTestPath(rel);
  return { facts: onePerKey(facts), aliases, stack: test ? [] : ['rust'], role: !test && typeof desc === 'string' && desc.trim() ? { text: desc.trim().slice(0, LIMITS.ROLE_MAX), source: 'manifest' } : undefined };
}

export default Object.freeze({
  id: 'pkg-cargo',
  claims: (rel) => /(^|\/)Cargo\.toml$/.test(rel) && !isSampleManifest(rel),
  detect,
});
