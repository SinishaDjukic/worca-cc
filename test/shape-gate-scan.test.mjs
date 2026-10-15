// test/shape-gate-scan.test.mjs — the repo-wide call-site scan for the Shape it first gate (spec D12): one gate
// module reads the switch, one client module reads the hello feature, the plan route opens with the guard, and every
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

test('WORCA_SHAPE_FIRST is mentioned only in the gate module', () => {
  const hits = files.filter((f) => f.text.includes('WORCA_SHAPE_FIRST')).map((f) => f.rel);
  assert.deepEqual(hits, ['src/core/shape/gate.mjs']);
});

test('features.shapeFirst is read only in the client gate module', () => {
  const hits = files.filter((f) => /\.shapeFirst\b/.test(f.text)).map((f) => f.rel);
  assert.deepEqual(hits, ['ui/public/chat/shape-gate.mjs']);
});

test('no file imports src/shared/flags', () => {
  const hits = files.filter((f) => /^\s*(import|export)\b[^;\n]*from\s+['"][^'"]*shared\/flags(\.mjs)?['"]/m.test(f.text)).map((f) => f.rel);
  assert.deepEqual(hits, []);
});

test("the /api/runs/:id/answer handler's first statement is requireShapeFirst", () => {
  const text = read('ui/server.mjs');
  const m = text.match(/app\.post\('\/api\/runs\/:id\/answer',\s*\(req, res\)\s*=>\s*\{\s*\n\s*([^\n]*)/);
  assert.ok(m, 'the route exists');
  assert.equal(m[1].trim(), 'if (!requireShapeFirst(req, res)) return;');
});

for (const [verb, route] of [['get', '/plan'], ['post', '/plan/save']]) {
  test(`the ${verb.toUpperCase()} /api/runs/:id${route} handler's first statement is requireShapeFirst`, () => {
    const re = /app\.(get|post)\('\/api\/runs\/:id\/plan(\/save)?',\s*(async\s+)?\(req, res\)\s*=>\s*\{\s*\n\s*([^\n]*)/g;
    const m = [...read('ui/server.mjs').matchAll(re)].find((x) => x[1] === verb && (x[2] || '') === route.slice('/plan'.length));
    assert.ok(m, 'the route exists');
    assert.equal(m[4].trim(), 'if (!requireShapeFirst(req, res)) return;');
  });
}

test('outside import/export lines GRAPH_SHAPE_WORKFLOW is read only beside a gate call', () => {
  for (const rel of ['ui/server.mjs', 'src/core/ask/catalog.mjs', 'src/cli/worca-cc.mjs', 'src/core/ask/proposal.mjs']) {
    const lines = read(rel).split('\n').filter((l) => l.includes('GRAPH_SHAPE_WORKFLOW') && !/^\s*(import|export)\b/.test(l));
    for (const l of lines) assert.match(l, /shapeFirstEnabled\(|shapeFirst\(/, `${rel}: ${l.trim()}`);
  }
});

test('resolveShapeRequest( is called in ui/server.mjs with enabled: shapeFirstEnabled() and internal', () => {
  assert.match(read('ui/server.mjs'), /resolveShapeRequest\([^)]*\{\s*enabled:\s*shapeFirstEnabled\(\),\s*internal:/);
});

test('every /api/shape/ handler, async or not, starts with requireShapeFirst', () => {
  const re = /app\.(get|post)\('\/api\/shape\/[^']*',\s*(async\s+)?\(req, res\)\s*=>\s*\{\s*\n\s*([^\n]*)/g;
  const found = [...read('ui/server.mjs').matchAll(re)];
  assert.ok(found.length >= 6, `found ${found.length} handlers`);
  for (const m of found) assert.equal(m[3].trim(), 'if (!requireShapeFirst(req, res)) return;', m[0]);
});

test('liveSliceOf and broadcastFeature never mention WORCA_SHAPE_FIRST', () => {
  const text = read('ui/server.mjs');
  for (const name of ['function liveSliceOf', 'function broadcastFeature(']) {
    const at = text.indexOf(name);
    assert.ok(at >= 0, name);
    const end = text.indexOf('\n}\n', at);
    assert.ok(!text.slice(at, end).includes('WORCA_SHAPE_FIRST'), name);
  }
});
