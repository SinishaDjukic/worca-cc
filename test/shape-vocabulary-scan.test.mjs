// test/shape-vocabulary-scan.test.mjs — D21, D29: no user-visible "Shape it first" / "Plan it with me" / "while shaping" in the files this
// feature ships. Comments are stripped first (internal ids and comments may keep the old name).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OLD = /Shape it first|Plan it with me|while shaping/i;
const REFUSED = /\bRun anyway\b/;   // D32: a button names its outcome (case-sensitive: prose "to run anyway" is no label)
const bad = (l) => OLD.test(l) || REFUSED.test(l);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'vendor']);   // as test/shape-gate-scan.test.mjs
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(mjs|js|css|html)$/.test(name)) out.push(full);
  }
  return out;
}
/** Block comments, then whole-line and trailing `// ` comments (a URL's `://` has no space before it). */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/\s.*$/, ''))).join('\n');

test('no user-visible "Shape it first", "Plan it with me", "while shaping" or "Run anyway" in ui/, src/ or the docs this branch ships', () => {
  const files = [...walk(join(ROOT, 'ui')), ...walk(join(ROOT, 'src'))];
  const hits = [];
  for (const f of files) {
    code(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => {
      if (bad(l)) hits.push(`${relative(ROOT, f).split(sep).join('/')}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
  const docs = readFileSync(join(ROOT, 'docs/ui-levels.md'), 'utf8').split('\n')
    .map((l, i) => [l, i]).filter(([l]) => bad(l)).map(([l, i]) => `docs/ui-levels.md:${i + 1}: ${l.slice(0, 120)}`);
  assert.deepEqual([...hits, ...docs], []);
});

test('the scan strips comments but not strings', () => {
  assert.equal(OLD.test(code("// Shape it first: a comment\nconst a = 1; // Shape it first\n/* Shape it first */")), false);
  assert.equal(OLD.test(code("const s = 'Shape it first';")), true);
  assert.equal(OLD.test(code("fetch('http://x/y'); const s = 'while shaping';")), true);
  assert.equal(OLD.test(code("const s = 'Plan it with me';")), true);
});

test('the scan refuses the label "Run anyway" in code, not in comments', () => {
  assert.equal(bad(code("setLabel(b, 'Run anyway');")), true);
  assert.equal(bad(code("// was 'Run anyway'")), false);
});
