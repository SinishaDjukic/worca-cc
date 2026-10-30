// tools/split-by-feature/codemod-reads.mjs
// One-shot (#919 s1): point every test/tool disk read of the three monoliths at its reader in src/core
// (read-style-css.mjs, read-index-html.mjs, read-server-source.mjs), one module per file.
//   node tools/split-by-feature/codemod-reads.mjs [--write]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELPER = { 'style.css': 'readStyleCss', 'index.html': 'readIndexHtml', 'server.mjs': 'readServerSource' };
const MODULE = { readStyleCss: 'read-style-css', readIndexHtml: 'read-index-html', readServerSource: 'read-server-source' };
// A path expression naming one monolith: new URL('../ui/public/x', import.meta.url), optionally in fileURLToPath(…),
// join(a, '..', 'ui', 'public', 'x'), join(a, 'ui/public/x'), or the bare repo-relative string.
const P = String.raw`(?:(?:fileURLToPath\()?new URL\(\s*'(?:\.\.\/)+ui\/(?:public\/)?(style\.css|index\.html|server\.mjs)',\s*import\.meta\.url\s*\)\)?`
  + String.raw`|(?:path\.)?join\([^()]*?'ui'\s*,\s*(?:'public'\s*,\s*)?'(style\.css|index\.html|server\.mjs)'\s*\)`
  + String.raw`|(?:path\.)?join\([^()]*?'ui\/(?:public\/)?(style\.css|index\.html|server\.mjs)'\s*\)`
  + String.raw`|'ui\/(?:public\/)?(style\.css|index\.html|server\.mjs)')`;
// Not a member call on something else: `(await import('node:fs')).readFileSync(…)` would become `(…).readStyleCss()`.
const READ = String.raw`(?<![\w$.)\]])(?:fs\.)?(?:readFileSync|readFile)\(`;
const ENC = String.raw`\s*,\s*(?:'utf-?8'|\{\s*encoding:\s*'utf-?8'\s*\})\s*`;
const name = (m) => m.slice(1).find(Boolean);
const okPath = (file, full) => (file === 'server.mjs' ? /ui\/server|'ui'\s*,\s*'server/.test(full) : /public/.test(full));

export function rewrite(src, fileRel) {
  let out = src; const used = new Set();
  const call = (file) => { used.add(HELPER[file]); return `${HELPER[file]}()`; };
  // 1. inline: readFileSync(PATH, 'utf8') and await readFile(PATH, 'utf8')
  out = out.replace(new RegExp(String.raw`${READ}\s*${P}${ENC}\)`, 'g'), (full, ...g) => {
    const file = name([full, ...g.slice(0, 4)]);
    return okPath(file, full) ? call(file) : full;
  });
  // 2. path variable: const htmlPath = PATH; … readFileSync(htmlPath, 'utf8')
  for (const m of [...out.matchAll(new RegExp(String.raw`^[ \t]*(?:export\s+)?const\s+(\w+)\s*=\s*${P}\s*;[ \t]*\n`, 'gm'))]) {
    const [decl, v, ...g] = m; const file = name([decl, ...g.slice(0, 4)]);
    if (!okPath(file, decl) || /^\s*export/.test(decl)) continue;           // exported (test/helpers): hand edit
    out = out.replace(new RegExp(String.raw`${READ}\s*${v}${ENC}\)`, 'g'), () => call(file));
    if (!new RegExp(String.raw`\b${v}\b`).test(out.replace(decl, ''))) out = out.replace(decl, '');
  }
  // 3. local read helper: const read = (p) => readFileSync(…p…); … read('ui/public/style.css')
  const helpers = [...out.matchAll(/\bconst\s+(\w+)\s*=\s*\(\s*\w+\s*\)\s*=>\s*(?:fs\.)?readFileSync\(/g)].map((m) => m[1]);
  for (const h of helpers) {
    out = out.replace(new RegExp(String.raw`\b${h}\(\s*'ui\/(?:public\/)?(style\.css|index\.html|server\.mjs)'\s*\)`, 'g'), (full, file) => call(file));
  }
  if (!used.size) return src;
  const line = [...used].sort((a, b) => (MODULE[a] < MODULE[b] ? -1 : 1)).map((h) => {
    let spec = posix.relative(posix.dirname(fileRel), `src/core/${MODULE[h]}.mjs`);
    if (!spec.startsWith('.')) spec = './' + spec;
    return `import { ${h} } from '${spec}';\n`;
  }).join('');
  const lastImport = [...out.matchAll(/^import [^\n]*;\n/gm)].pop();    // single-line imports; a file whose last import spans lines gets it at the top
  const at = lastImport ? lastImport.index + lastImport[0].length : 0;
  return out.slice(0, at) + line + out.slice(at);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes('--write');
  for (const d of ['test', 'tools']) {
    for (const f of readdirSync(d, { recursive: true })) {
      const rel = posix.join(d, String(f).split('\\').join('/'));
      if (!/\.(mjs|js)$/.test(rel) || rel.startsWith('tools/split-by-feature') || rel.startsWith('test/split-by-feature')) continue;
      if (rel === 'test/public-assets.test.mjs') continue;
      const src = readFileSync(rel, 'utf8'); const out = rewrite(src, rel);
      if (out !== src) { console.log(`rewrote ${rel}`); if (write) writeFileSync(rel, out); }
    }
  }
}
