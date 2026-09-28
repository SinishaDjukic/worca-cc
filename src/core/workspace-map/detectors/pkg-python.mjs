// pkg-python: pyproject.toml ([project] PEP 621, [tool.poetry], PEP 735
// [dependency-groups], [tool.uv.sources]) and requirement files (requirements*.txt, *-requirements.txt,
// requirements*.in, requirements/*.txt|in).
//   provides  pypi:<name> ([project].name or [tool.poetry].name); alias = name when `aliasable`
//             (never a test-path manifest; a nested one only with a multi-word name)
//   consumes  every requirement name. Local paths (`-e ../x`, `../x`, `name @ file:../x`,
//             poetry `{ path = "../x" }`, uv sources `{ path = … }`) set target = the member
//             owning that directory; a path inside this member is no consume; a nameless local
//             requirement is keyed by the directory basename (confidence heuristic). pip resolves
//             requirement-file paths from the working directory, taken to be the member root;
//             pyproject paths resolve from the pyproject's directory.
// Names are emitted as written; normKey applies PEP 503 (lower-case, runs of -_. → -). A test-path
// manifest sets no stack and no role.
import { basename } from 'node:path';
import { splitLines, fact, memberForPath, aliasable, onePerKey, cleanUnresolved, isSampleManifest } from './lib/text.mjs';
import { loadToml, tomlSections, keyLine } from './lib/toml.mjs';
import { isTestPath } from '../files.mjs';
import { LIMITS } from '../../../shared/workspace-map/limits.mjs';

const NAME_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]{0,200})/;
const EGG_RE = /#egg=([A-Za-z0-9][A-Za-z0-9._-]{0,200})/;
const LOCAL_RE = /^(\.{1,2}[\\/]|\/|[A-Za-z]:[\\/]|file:)/;
const DIRECT_REF_RE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]{0,200})[ \t]*(?:\[[^\]\n]*\][ \t]*)?@[ \t]*(\S+)/;
const trimSeps = (s) => { let e = s.length; while (e > 0 && (s[e - 1] === '/' || s[e - 1] === '\\')) e -= 1; return s.slice(0, e); };
const list = (v) => (Array.isArray(v) ? v : []);
const table = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const fileToPath = (u) => u.replace(/^file:(\/\/)?/, '');
const targetOf = (ctx, rel, path) => {
  const m = memberForPath(ctx, rel, fileToPath(path));
  return m && m.key !== ctx.member.key ? m.key : undefined;
};
/** A local path that stays inside this member (a sibling package): not a consume. */
const intra = (ctx, rel, path) => memberForPath(ctx, rel, fileToPath(path))?.key === ctx.member.key;
// A quoted requirement's leading name (`"requests>=2"`, `'Acme.Money[fast] ~= 1.0'`): the index key.
const SPEC_NAME_RE = /["']([A-Za-z0-9][A-Za-z0-9._-]{0,200})/g;
const pep503 = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');
/** pep503 name → ascending 1-based lines holding a quoted string that starts with it: one pass
 *  over the file, so 50 000 dependencies cost one scan — never a section rescan per dependency
 *  (a TOML escape or a multi-line string hides a spec's text from a plain search). */
function specIndex(lines) {
  const idx = new Map();
  lines.forEach((l, i) => {
    for (const m of l.matchAll(SPEC_NAME_RE)) {
      const k = pep503(m[1]);
      const at = idx.get(k) ?? [];
      if (at[at.length - 1] !== i + 1) at.push(i + 1);
      idx.set(k, at);
    }
  });
  return idx;
}

function fromRequirements({ rel, text }, ctx) {
  const lines = splitLines(text);
  const cwd = 'requirements.txt'; // pip's working directory = the member root
  const facts = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/(^|\s)#[^]*$/, '').trim();
    if (!line) return;
    if (/^-(r|c|-requirement|-constraint|-index-url|i|-extra-index-url|f|-find-links|-trusted-host|-hash)\b/.test(line)) return;
    const editable = /^(-e|--editable)\s([^]+)$/.exec(line); // [^]: a lone \r ends `.` but not the line
    const spec = editable ? editable[2].trim() : line;
    const direct = DIRECT_REF_RE.exec(spec);
    if (direct) {
      const local = LOCAL_RE.test(direct[2]);
      if (local && intra(ctx, cwd, direct[2])) return;
      facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `pypi:${direct[1]}`, rel, lines, line: i + 1, needle: direct[1], target: local ? targetOf(ctx, cwd, direct[2]) : undefined, detail: local ? `path ${direct[2]}` : undefined, confidence: 'exact' }));
      return;
    }
    if (LOCAL_RE.test(spec) || /^[\w.-]+[\\/]/.test(spec) || spec === '.') {
      const path = spec.replace(/#[^]*$/, '').replace(/\[[^]*$/, '');
      if (path === '.' || path === './' || intra(ctx, cwd, path)) return;
      const egg = EGG_RE.exec(spec);
      const name = egg ? egg[1] : basename(trimSeps(fileToPath(path)).replace(/\\/g, '/'));
      if (!name || name === '..' || name === '.') return;
      facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `pypi:${name}`, rel, lines, line: i + 1, needle: spec.replace(/#[^]*$/, ''), target: targetOf(ctx, cwd, path), detail: `path ${path}`, confidence: egg ? 'exact' : 'heuristic' }));
      return;
    }
    if (/^(git\+|hg\+|svn\+|bzr\+|https?:)/.test(spec)) {
      const egg = EGG_RE.exec(spec);
      if (egg) facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `pypi:${egg[1]}`, rel, lines, line: i + 1, needle: egg[1], detail: 'vcs requirement', confidence: 'exact' }));
      return;
    }
    const m = NAME_RE.exec(spec);
    if (m) facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `pypi:${m[1]}`, rel, lines, line: i + 1, needle: m[1], confidence: 'exact' }));
  });
  return { facts: onePerKey(facts), stack: isTestPath(rel) ? [] : ['python'] };
}

function fromPyproject({ rel, text }, ctx) {
  const lines = splitLines(text);
  const { data, error } = loadToml(text);
  if (!data) {
    // Partial result: the [project]/[tool.poetry] name still counts as a provide.
    const facts = [];
    let section = '';
    lines.forEach((l, i) => {
      const h = /^\s*\[([^\]]+)\]/.exec(l);
      if (h) { section = h[1].trim(); return; }
      const n = /^\s*name\s*=\s*["']([^"']+)["']/.exec(l);
      if (n && (section === 'project' || section === 'tool.poetry')) facts.push(fact({ kind: 'pkg', dir: 'provides', key: `pypi:${n[1]}`, rel, lines, line: i + 1, needle: n[1], confidence: 'heuristic' }));
    });
    return { facts: onePerKey(facts), stack: isTestPath(rel) ? [] : ['python'], unresolved: cleanUnresolved(ctx.state, rel, [{ kind: 'pkg', raw: rel, file: rel, line: 1, reason: `toml parse error: ${error}` }]) };
  }
  const sections = tomlSections(lines);
  const facts = [];
  const aliases = [];
  const uvSources = table(data.tool?.uv?.sources);
  // Each dependency's line comes from one index of the file (specIndex), walked forward per
  // (section, name) inside the section or its parent (inline tables); a miss cites the key line.
  const specAt = specIndex(lines);
  const rangeMemo = new Map();
  const rangesOf = (section) => {
    const k = section.join('\u0000');
    if (!rangeMemo.has(k)) {
      const parent = section.slice(0, -1).join('\u0000');
      rangeMemo.set(k, sections.filter((s) => { const n = s.name.join('\u0000'); return n === k || n === parent; }).slice(0, 64).map((s) => [s.start + 2, s.end]));
    }
    return rangeMemo.get(k);
  };
  const next = new Map();
  const specLine = (name, section) => {
    const k = pep503(name);
    const at = specAt.get(k) || [];
    const ranges = rangesOf(section);
    const pk = `${section.join('.')}\u0000${k}`;
    let i = next.get(pk) || 0;
    while (i < at.length && !ranges.some(([lo, hi]) => at[i] >= lo && at[i] <= hi)) i += 1;
    next.set(pk, i + 1);
    return i < at.length ? at[i] : 0;
  };
  const provide = (name, section) => {
    if (typeof name !== 'string' || !name.trim()) return;
    facts.push(fact({ kind: 'pkg', dir: 'provides', key: `pypi:${name}`, rel, lines, line: keyLine(lines, sections, section, 'name') || 1, needle: name, detail: 'Python project', confidence: 'exact' }));
    if (aliasable(rel, name)) aliases.push({ value: name, source: 'pyproject' });
  };
  provide(data.project?.name, ['project']);
  provide(data.tool?.poetry?.name, ['tool', 'poetry']);
  // PEP 508 strings: [project].dependencies, [project.optional-dependencies].*, [dependency-groups].*
  const pep508 = (spec, section, detail) => {
    if (typeof spec !== 'string') return;
    const direct = DIRECT_REF_RE.exec(spec);
    const m = direct || NAME_RE.exec(spec);
    if (!m) return;
    const name = m[1];
    const local = direct && LOCAL_RE.test(direct[2]) ? direct[2] : uvSources[name]?.path;
    if (typeof local === 'string' && intra(ctx, rel, local)) return;
    const line = specLine(name, section) || keyLine(lines, sections, section.slice(0, -1), section[section.length - 1]) || 1;
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `pypi:${name}`, rel, lines, line, needle: name, detail: [detail, local && `path ${local}`].filter(Boolean).join(', ') || undefined, target: local ? targetOf(ctx, rel, local) : undefined, confidence: 'exact' }));
  };
  for (const d of list(data.project?.dependencies)) pep508(d, ['project'], undefined);
  for (const [extra, deps] of Object.entries(table(data.project?.['optional-dependencies']))) for (const d of list(deps)) pep508(d, ['project', 'optional-dependencies'], `extra ${extra}`);
  for (const [group, deps] of Object.entries(table(data['dependency-groups']))) for (const d of list(deps)) pep508(d, ['dependency-groups'], `group ${group}`);
  // Poetry tables: name = "^1.0" | { version, path, develop, extras } | [ … ]
  const poetry = table(data.tool?.poetry);
  const tables = [[['tool', 'poetry', 'dependencies'], poetry.dependencies, undefined], [['tool', 'poetry', 'dev-dependencies'], poetry['dev-dependencies'], 'dev']];
  for (const [g, grp] of Object.entries(table(poetry.group))) tables.push([['tool', 'poetry', 'group', g, 'dependencies'], grp?.dependencies, `group ${g}`]);
  for (const [section, deps, detail] of tables) {
    for (const [name, spec] of Object.entries(table(deps))) {
      if (name.toLowerCase() === 'python') continue;
      const path = spec && typeof spec === 'object' && !Array.isArray(spec) ? spec.path : undefined;
      if (typeof path === 'string' && intra(ctx, rel, path)) continue;
      const line = keyLine(lines, sections, section, name) || 1;
      facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `pypi:${name}`, rel, lines, line, needle: name, detail: [detail, path && `path ${path}`].filter(Boolean).join(', ') || undefined, target: path ? targetOf(ctx, rel, path) : undefined, confidence: 'exact' }));
    }
  }
  const desc = data.project?.description || poetry.description;
  const test = isTestPath(rel); // a fixture pyproject says nothing about the member's stack or role
  return { facts: onePerKey(facts), aliases, stack: test ? [] : ['python'], role: !test && typeof desc === 'string' && desc.trim() ? { text: desc.trim().slice(0, LIMITS.ROLE_MAX), source: 'manifest' } : undefined };
}

export default Object.freeze({
  id: 'pkg-python',
  // pyproject.toml; requirements.txt, requirements-dev.txt, dev-requirements.txt, requirements.in (pip-tools),
  // requirements/*.txt|in — never a sample folder's (docs/requirements.txt is the docs build's)
  claims: (rel) => (/(^|\/)pyproject\.toml$/.test(rel) || /(^|\/)([\w.-]*[-_.])?requirements([-_.][\w.-]*)?\.(txt|in)$/i.test(rel)
    || /(^|\/)requirements\/[^/]+\.(txt|in)$/i.test(rel)) && !isSampleManifest(rel),
  detect: (file, ctx) => (file.rel.endsWith('.toml') ? fromPyproject(file, ctx) : fromRequirements(file, ctx)),
});
