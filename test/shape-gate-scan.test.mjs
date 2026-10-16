// test/shape-gate-scan.test.mjs — the repo-wide call-site scan for the Shape it first gate (spec D12): the flag key
// is read only by the two gate modules (and listed in the registry), the plan route opens with the guard, and every
// server read of the built-in shape workflow asks the gate on the same line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'dist', 'coverage']);

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(mjs|js|cjs)$/.test(name)) out.push(full);
  }
  return out;
}
const files = ['src', 'ui', 'tools'].flatMap((d) => sourceFiles(join(ROOT, d)))
  .map((f) => ({ rel: relative(ROOT, f).split(sep).join('/'), text: readFileSync(f, 'utf8') }));
const read = (rel) => files.find((f) => f.rel === rel)?.text ?? '';

test('the shapeFirst flag is read only in the two gate modules', () => {
  const hits = files.filter((f) => /\b(?:flagEnabled|flagOn|onFlagChange|requireFlag)\(\s*['"]shapeFirst['"]/.test(f.text)).map((f) => f.rel).sort();
  assert.deepEqual(hits, ['src/core/shape/gate.mjs', 'ui/public/chat/shape-gate.mjs']);
});

test("the /api/runs/:id/answer handler's first statement is requireShapeFirst", () => {
  const text = read('ui/server.mjs');
  const m = text.match(/app\.post\('\/api\/runs\/:id\/answer',\s*\(req, res\)\s*=>\s*\{\s*\n\s*([^\n]*)/);
  assert.ok(m, 'the route exists');
  assert.equal(m[1].trim(), 'if (!requireShapeFirst(req, res)) return;');
});

test('outside import/export lines GRAPH_SHAPE_WORKFLOW is read only beside a gate call', () => {
  for (const rel of ['ui/server.mjs', 'src/core/ask/catalog.mjs', 'src/cli/worca-cc.mjs']) {
    const lines = read(rel).split('\n').filter((l) => l.includes('GRAPH_SHAPE_WORKFLOW') && !/^\s*(import|export)\b/.test(l));
    for (const l of lines) assert.match(l, /shapeFirstEnabled\(|shapeFirst\(/, `${rel}: ${l.trim()}`);
  }
});

test('resolveShapeRequest( is called in ui/server.mjs with enabled: shapeFirstEnabled()', () => {
  assert.match(read('ui/server.mjs'), /resolveShapeRequest\([^)]*\{\s*enabled:\s*shapeFirstEnabled\(\)\s*\}\)/);
});
