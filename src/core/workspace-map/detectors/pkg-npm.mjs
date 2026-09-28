// src/core/workspace-map/detectors/pkg-npm.mjs
// npm packages: every package.json provides its `name` and consumes its dependencies.
// A `file:` / `link:` / `portal:` / `workspace:<relative path>` dependency that resolves into
// another member's project dir names that member as the target (one inside this member names no
// member); `npm:` aliases consume the real package.

import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { LIMITS } from '../../../shared/workspace-map/limits.mjs';
import { isSampleManifest } from './lib/text.mjs';

const SECTIONS = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);
const FOLD = process.platform === 'win32' || process.platform === 'darwin';
const same = (a, b) => (FOLD ? a.toLowerCase() === b.toLowerCase() : a === b);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function lineOf(lines, re, from = 0) {
  for (let i = Math.max(0, from); i < lines.length; i += 1) if (re.test(lines[i])) return i;
  return -1;
}

/** The 1-based line and literal evidence of the first line matching `re` at or after `from`
 *  (falling back to the whole file). */
function locate(lines, re, from) {
  let i = lineOf(lines, re, from);
  if (i < 0) i = lineOf(lines, re, 0);
  if (i < 0) return null;
  return { line: i + 1, match: lines[i].trim().slice(0, LIMITS.MATCH_MAX) };
}

/** Every `"key":` of every line, indexed ONCE: key text → its 0-based line numbers, ascending. A
 *  manifest is never rescanned per dependency (the index's scan hygiene), so thousands of dependencies
 *  — or a minified 1 MiB package.json with all of them on line 1 — stay linear. */
const KEY_RE = /"((?:[^"\\]|\\.){1,256})"[ \t]{0,64}:/g;
/** A key as JSON.parse reads it, so an escaped dependency name (`"@acme\/x"`, a `\u`-escaped `@`)
 *  still finds its line. */
const keyText = (raw) => {
  if (!raw.includes('\\')) return raw;
  try { return JSON.parse(`"${raw}"`); } catch { return raw; }
};
function keyLines(lines) {
  const out = new Map();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(KEY_RE)) {
      const key = keyText(m[1]);
      const list = out.get(key);
      if (!list) out.set(key, [i]);
      else if (list[list.length - 1] !== i) list.push(i);
    }
  });
  return out;
}

/** The first line of `list` at or after `from` (else its first) → { line, match } | null. `trimmed`
 *  caches each line's evidence text: a minified manifest cites line 1 for every dependency. */
function lookup(lines, list, from, trimmed) {
  if (!list) return null;
  const i = list.find((n) => n >= from) ?? list[0];
  if (!trimmed.has(i)) trimmed.set(i, lines[i].trim().slice(0, LIMITS.MATCH_MAX));
  return { line: i + 1, match: trimmed.get(i) };
}

/** The line of a `"name":` key whose (JSON-decoded, trimmed) value IS `name`: an `author` / `contributors` /
 *  dependency `name` key earlier in the file is never cited for the package. */
const NAME_VALUE = /"name"[ \t]{0,64}:[ \t]{0,64}("(?:[^"\\]|\\.){0,4096}")/g;
function nameLine(lines, list, name, trimmed) {
  for (const i of list || []) {
    for (const m of lines[i].matchAll(NAME_VALUE)) {
      let v = null;
      try { v = JSON.parse(m[1]); } catch { continue; }
      if (typeof v === 'string' && v.trim() === name) return lookup(lines, [i], 0, trimmed);
    }
  }
  return null;
}

function localTarget(spec, rel, ctx) {
  const m = /^(file|link|portal):(.+)$/.exec(spec) || /^(workspace):(\.{1,2}\/.+)$/.exec(spec);
  if (!m) return null;
  const base = ctx.member.projectDir || ctx.member.dir;
  const abs = resolve(base, dirname(rel), m[2]);
  const hit = ctx.members.find((o) => o.key !== ctx.member.key && [o.projectDir, o.dir].some((d) => d && same(resolve(d), abs)));
  if (hit) return hit.key;
  // A path inside this member (`file:./vendor/x`, `workspace:./packages/ui`) is an intra-member
  // dependency: it names no other member, so it carries no target.
  const f = (p) => (FOLD ? p.toLowerCase() : p);
  const inOwn = [ctx.member.projectDir, ctx.member.dir].filter(Boolean).some((d) => {
    const r = relative(f(resolve(d)), f(abs));
    return !r || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
  });
  return inOwn ? null : basename(abs).toLowerCase();
}

export default {
  id: 'pkg-npm',
  // A sample app's manifest (docs/, examples/) is no package of this member.
  claims: (rel) => (rel === 'package.json' || rel.endsWith('/package.json')) && !isSampleManifest(rel),
  detect(file, ctx) {
    let pkg;
    try {
      pkg = JSON.parse(file.text);
    } catch {
      return { unresolved: [{ kind: 'pkg', raw: file.rel, file: file.rel, line: 1, reason: 'unparsable package.json' }] };
    }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return {};
    const lines = file.text.split(/\r?\n/);
    const keys = keyLines(lines);
    const trimmed = new Map();
    const root = file.rel === 'package.json';
    const out = { stack: ['node'], facts: [], aliases: [] };
    const name = typeof pkg.name === 'string' ? pkg.name.trim() : '';
    if (name) {
      // An escaped value (`"@acme\/x"` — the serializer that escapes its dependency keys escapes this
      // too), a padded one, or a name too long for a RegExp (npm caps names at 214) still cites the
      // `"name":` key's line.
      const at = (name.length <= 214 ? locate(lines, new RegExp(`"name"\\s*:\\s*${esc(JSON.stringify(name))}`), 0) : null)
        ?? nameLine(lines, keys.get('name'), name, trimmed) ?? lookup(lines, keys.get('name'), 0, trimmed);
      if (at) out.facts.push({ kind: 'pkg', dir: 'provides', key: `npm:${name}`, file: file.rel, ...at, detail: 'package.json name' });
      if (root) {
        out.aliases.push({ value: name.toLowerCase(), source: 'package.json' });
        const tail = /^@[^/]+\/(.+)$/.exec(name);
        // M7: a scope tail is derived from the name, and an SDK (`@acme/billing`) carries it as often as the service it
        // calls: tier 3 (alias-tiers.mjs), never above a survey alias of a member no code maps.
        if (tail) out.aliases.push({ value: tail[1].toLowerCase(), source: 'npm-scope-tail' });
      }
    }
    if (root && typeof pkg.description === 'string' && pkg.description.trim()) {
      out.role = { text: pkg.description.replace(/\s+/g, ' ').trim().slice(0, LIMITS.ROLE_MAX), source: 'manifest' };
    }
    for (const section of SECTIONS) {
      const deps = pkg[section];
      if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
      const from = keys.get(section)?.[0] ?? 0;
      for (const [dep, rawSpec] of Object.entries(deps)) {
        const spec = typeof rawSpec === 'string' ? rawSpec.trim() : '';
        const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@.*)?$/.exec(spec);
        const real = alias ? alias[1] : dep;
        const at = lookup(lines, keys.get(dep), from, trimmed);
        if (!at) continue;
        const target = localTarget(spec, file.rel, ctx);
        out.facts.push({
          kind: 'pkg', dir: 'consumes', key: `npm:${real}`, file: file.rel, ...at,
          detail: `${section} ${spec}`.trim().slice(0, LIMITS.DETAIL_MAX),
          ...(target ? { target } : {}),
        });
      }
    }
    return out;
  },
};
