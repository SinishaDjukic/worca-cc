// pkg-go: go.mod (any depth; one per module).
//   provides  go:<module path>; alias = last path element without a /vN suffix (when `aliasable`:
//             never from a testdata module, a nested module only with a multi-word name)
//   consumes  every direct `require` (single-line and block form). `// indirect`
//             requirements are transitive and skipped. A `replace <mod> => ../path`
//             (local directory) sets target = the member that directory belongs to;
//             a replaced module that is not required is still a consume.
import { splitLines, fact, memberForPath, aliasable, onePerKey, isSampleManifest } from './lib/text.mjs';
import { isTestPath } from '../files.mjs';

// Linear, anchored line regexes (lines are ≤ 1 MB; every quantifier is over one class, and neither the
// module nor a version token of a replace holds `=`: a line of `=>` runs splits at its first `=>` only).
const RE = {
  module: /^\s*module\s+"?([^\s"]+)"?/,
  blockOpen: /^\s*(require|replace|exclude|retract|tool|godebug)\s*\(\s*$/,
  blockClose: /^\s*\)\s*$/,
  require: /^\s*(?:require\s+)?"?([^\s"()]+)"?\s+(v[^\s/]+)(\s*\/\/.*)?$/,
  replace: /^\s*(?:replace\s+)?"?([^\s"()=]+)"?(?:\s+v[^\s=]+)?\s*=>\s*"?([^\s"]+)"?(?:\s+v[^\s=]+)?\s*$/,
};
const LOCAL = /^(\.{1,2}[\\/]|\/|[A-Za-z]:[\\/])/;
const aliasOf = (mod) => mod.split('/').filter((s) => !/^v\d+$/.test(s)).pop() || null;

function detect({ rel, text }, ctx) {
  const lines = splitLines(text);
  const facts = [];
  const aliases = [];
  const requires = [];
  const replaces = [];
  let block = null;
  lines.forEach((raw, i) => {
    const line = raw.replace(/^\uFEFF/, '');
    if (block) {
      if (RE.blockClose.test(line)) { block = null; return; }
      if (block === 'require') { const m = RE.require.exec(line); if (m) requires.push({ mod: m[1], indirect: /\/\/\s*indirect/.test(m[3] || ''), line: i + 1 }); }
      if (block === 'replace') { const m = RE.replace.exec(line); if (m) replaces.push({ mod: m[1], to: m[2], line: i + 1 }); }
      return;
    }
    const open = RE.blockOpen.exec(line);
    if (open) { block = open[1]; return; }
    const mod = RE.module.exec(line);
    if (mod) {
      facts.push(fact({ kind: 'pkg', dir: 'provides', key: `go:${mod[1]}`, rel, lines, line: i + 1, needle: mod[1], detail: 'Go module', confidence: 'exact' }));
      const a = aliasOf(mod[1]);
      if (a && aliasable(rel, a)) aliases.push({ value: a, source: 'go.mod' });
      return;
    }
    if (/^\s*require\s/.test(line)) { const m = RE.require.exec(line); if (m) requires.push({ mod: m[1], indirect: /\/\/\s*indirect/.test(m[3] || ''), line: i + 1 }); return; }
    if (/^\s*replace\s/.test(line)) { const m = RE.replace.exec(line); if (m) replaces.push({ mod: m[1], to: m[2], line: i + 1 }); }
  });
  const localTarget = new Map();
  for (const r of replaces) {
    if (!LOCAL.test(r.to)) continue;
    const m = memberForPath(ctx, rel, r.to);
    localTarget.set(r.mod, { member: m && m.key !== ctx.member.key ? m.key : undefined, to: r.to, line: r.line });
  }
  const required = new Set();
  for (const r of requires) {
    if (r.indirect) continue;
    required.add(r.mod);
    const local = localTarget.get(r.mod);
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `go:${r.mod}`, rel, lines, line: r.line, needle: r.mod,
      detail: local ? `replace => ${local.to}` : undefined, target: local?.member, confidence: 'exact' }));
  }
  for (const [mod, local] of localTarget) {
    if (required.has(mod)) continue;
    facts.push(fact({ kind: 'pkg', dir: 'consumes', key: `go:${mod}`, rel, lines, line: local.line, needle: mod, detail: `replace => ${local.to}`, target: local.member, confidence: 'exact' }));
  }
  return { facts: onePerKey(facts), aliases, stack: isTestPath(rel) ? [] : ['go'] };
}

export default Object.freeze({
  id: 'pkg-go',
  claims: (rel) => /(^|\/)go\.mod$/.test(rel) && !isSampleManifest(rel),
  detect,
});
