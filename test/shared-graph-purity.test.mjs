// test/shared-graph-purity.test.mjs
// src/shared/** is the ONE source of the graph model for server + browser, so
// it must stay pure ESM: relative imports that never leave src/shared, no
// node: builtins, no DOM, no module-level mutable state. And every ui/public
// specifier that leaves the static root must land inside src/shared at a URL
// equal to its disk path — which is exactly what the /src/shared mount serves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED = path.join(ROOT, 'src/shared');
const PUBLIC = path.join(ROOT, 'ui/public');
const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
const walk = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : /\.(mjs|js)$/.test(e.name) && out.push(p); } return out; };
const specs = (src) => [...src.matchAll(IMPORT_RE)].map((m) => m[1] || m[2]);
const posix = (p) => p.split(path.sep).join('/');

test('src/shared/graph holds the shared core (the guard is never vacuous)', () => {
  const names = walk(SHARED).map((f) => posix(path.relative(SHARED, f)));
  for (const required of ['graph/constants.mjs', 'graph/verdict.mjs']) {
    assert.ok(names.includes(required), `src/shared/${required} must exist`);
  }
});

test('src/shared/** is pure, relative-only, self-contained, stateless ESM', () => {
  const files = walk(SHARED);
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Specifiers are read from the RAW source; the token rules run on a
    // comment-stripped copy, so ordinary prose ("the task document.", "the
    // process.") in a JSDoc block cannot fail the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    for (const s of specs(src)) {
      assert.match(s, /^\.\.?\//, `${f}: non-relative import "${s}"`);
      const t = path.resolve(path.dirname(f), s);
      assert.ok(t.startsWith(SHARED + path.sep) && statSync(t).isFile(), `${f}: "${s}" leaves src/shared or is missing`);
    }
    for (const [label, re] of [
      ['node: builtin', /['"]node:/], ['require()', /\brequire\s*\(/], ['process', /\bprocess\./],
      ['DOM global', /\b(window|document|navigator|localStorage)\b/], ['fetch', /\bfetch\s*\(/],
      ['import.meta', /import\.meta\b/], ['top-level mutable binding', /^(let|var)\s/m],
    ]) assert.doesNotMatch(code, re, `${f}: ${label}`);
  }
});

test('ui/public leaves the static root only into src/shared, at the URL the mount serves', () => {
  for (const f of walk(PUBLIC)) {
    for (const s of specs(readFileSync(f, 'utf8'))) {
      if (/^https?:|^\/vendor\//.test(s)) continue;
      assert.match(s, /^\.\.?\//, `${f}: "${s}" must be relative (absolute specifiers break Node)`);
      const onDisk = path.resolve(path.dirname(f), s);
      if (onDisk.startsWith(PUBLIC + path.sep)) continue;
      assert.ok(onDisk.startsWith(SHARED + path.sep), `${f}: "${s}" escapes ui/public but not into src/shared`);
      const url = new URL(s, 'http://x/' + posix(path.relative(PUBLIC, f))).pathname;
      assert.equal(url, '/' + posix(path.relative(ROOT, onDisk)), `${f}: browser URL != disk path`);
    }
  }
});
