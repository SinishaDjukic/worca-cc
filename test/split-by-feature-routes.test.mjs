import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as acorn from 'acorn';
import { planRoutes, emitRouteFile, relSpecifier, orderFlips } from '../tools/split-by-feature/routes.mjs';
import { loadMap } from '../tools/split-by-feature/plan.mjs';
import { packFiles, registrationOrder, routeIndex } from '../tools/split-by-feature.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const MAP = loadMap(ROOT, JSON.stringify({ version: 1, docless: { runs: 't', 'run-groups': 't' }, features: [
  { name: 'runs', doc: null, routes: ['/api/runs'], css: [], html: [] },
  { name: 'run-groups', doc: null, routes: ['/api/runs/groups'], css: [], html: [] },
  { name: 'mcp-servers', doc: 'docs/mcp-servers.md', routes: ['/api/mcp/'], css: [], html: [] }] }));
const wrap = (mid) => "import express from 'express';\nimport { getDb } from '../src/core/db.mjs';\nconst app = express();\nlet DRAIN = false;\n"
  + "app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));\n" + mid + "// SPA fallback: x\napp.use((q, s, n) => n());\nfunction late() {}\nconst LATE = 1;\n";
const all = (plan) => [...plan.group.keys()].sort((a, b) => a - b);   // source order, as packFiles gives it

test('a route and its single-user helper move together; imports are re-relativized; the file shape is fixed', () => {
  const src = wrap("// list runs\nfunction rows() { return getDb().prepare('x').all(); }\napp.get('/api/runs', (q, s) => s.json(rows()));\n");
  const plan = planRoutes(src, MAP);
  assert.equal(all(plan).length, 2);
  const out = emitRouteFile({ name: 'runs', feature: 'runs', doc: null, version: 1, stmtIdx: all(plan), plan });
  assert.match(out.text, /^import \{ getDb \} from '\.\.\/\.\.\/\.\.\/src\/core\/db\.mjs';$/m);
  assert.match(out.text, /export function register\(app\) \{\n\/\/ list runs\nfunction rows\(\)/);
  assert.ok(out.text.endsWith("app.get('/api/runs', (q, s) => s.json(rows()));\n}\n"));
  const top = acorn.parse(out.text, { ecmaVersion: 'latest', sourceType: 'module' }).body;
  assert.ok(top.slice(0, -1).every((s) => s.type === 'ImportDeclaration'));
  assert.equal(top.at(-1).type, 'ExportNamedDeclaration');
  assert.equal(top.at(-1).declaration.id.name, 'register');
});

test('a route that writes a module let stays central', () => {
  const plan = planRoutes(wrap("app.post('/api/runs/drain', (q, s) => { DRAIN = true; s.end(); });\n"), MAP);
  assert.equal(plan.group.size, 0);
  assert.match(plan.pins[0].reason, /writes DRAIN/);
});

test('a registration-time read of a const declared after the call site is pinned; a late function is fine', () => {
  const plan = planRoutes(wrap("app.get('/api/runs/a', LATE ? h : h);\napp.get('/api/runs/b', late);\n"), MAP);
  assert.equal(all(plan).length, 1);
  assert.match(plan.pins[0].reason, /reads LATE before it is declared/);
});

test('a helper used by central code stays central and is imported from ../../server.mjs', () => {
  const plan = planRoutes(wrap("function shared() {}\napp.get('/api/runs', shared);\napp.use(shared);\n"), MAP);
  const out = emitRouteFile({ name: 'runs', feature: 'runs', doc: null, version: 1, stmtIdx: all(plan), plan });
  assert.match(out.text, /import \{ shared \} from '\.\.\/\.\.\/server\.mjs';/);
});

test('import.meta and computed paths pin the statement', () => {
  const plan = planRoutes(wrap("app.get('/api/runs/x', () => import.meta.url);\napp[m]('/api/runs/y', h);\n"), MAP);
  assert.equal(plan.group.size, 0);
  assert.equal(plan.pins.length, 2);
});

test('a mid-region app.use is a barrier: routes above and below it register in different segments', () => {
  const src = wrap("app.post('/api/mcp/preview', h1);\napp.use('/api/mcp', guard);\napp.get('/api/mcp/servers', h2);\n");
  const plan = planRoutes(src, MAP);
  assert.equal(plan.barriers.length, 1);
  assert.deepEqual([...new Set(plan.group.values())].sort(), ['mcp-servers#0', 'mcp-servers#1']);
  const files = packFiles(plan, MAP);
  assert.deepEqual(files.map((f) => [f.name, f.segment]), [['mcp-servers/preview', 0], ['mcp-servers/servers', 1]]);   // named by content, not segment
});

test('a move that would swap two overlapping routes keeps the earlier one central', () => {
  // runs (lines 6, 8) registers before run-groups (line 7), so moving all three would put /:id before /groups
  const plan = planRoutes(wrap("app.get('/api/runs/a', a);\napp.get('/api/runs/groups', b);\napp.get('/api/runs/:id', c);\n"), MAP);
  const flips = orderFlips(plan, packFiles(plan, MAP));
  assert.deepEqual([...flips.keys()].map((i) => plan.body[i].loc.start.line), [7]);
  assert.match(flips.values().next().value, /would run after GET "\/api\/runs\/:id"/);
  const again = planRoutes(plan.src, MAP, { forced: flips });
  assert.deepEqual(orderFlips(again, packFiles(again, MAP)).size, 0);
  assert.match(again.pins[0].reason, /would run after GET "\/api\/runs\/:id"/);
});

test('registration order: features by their first statement per segment, areas in source order; the index registers exactly that order', () => {
  const plan = planRoutes(wrap("app.get('/api/runs/groups', a);\napp.get('/api/runs', b);\napp.use('/api/mcp', guard);\napp.get('/api/mcp/servers', h2);\napp.get('/api/runs/x', c);\n"), MAP);
  const files = packFiles(plan, MAP);
  assert.deepEqual(files.map((f) => [f.segment, f.name]), [[0, 'run-groups/groups'], [0, 'runs/runs'], [1, 'mcp-servers/servers'], [1, 'runs/x']]);
  assert.deepEqual(registrationOrder([...files].reverse()), [...files]);
  const idx = routeIndex(files, plan);
  assert.deepEqual([...idx.keys()].sort(), ['ui/routes/index.mjs', 'ui/routes/mcp-servers/index.mjs', 'ui/routes/run-groups/index.mjs', 'ui/routes/runs/index.mjs']);
  assert.match(idx.get('ui/routes/index.mjs'), /^ {2}Object\.freeze\(\[\.\.\.m_run_groups\.SEGMENTS\[0\], \.\.\.m_runs\.SEGMENTS\[0\]\]\),/m);
  assert.match(idx.get('ui/routes/index.mjs'), /^ {2}Object\.freeze\(\[\.\.\.m_mcp_servers\.SEGMENTS\[1\], \.\.\.m_runs\.SEGMENTS\[1\]\]\),/m);
  assert.match(idx.get('ui/routes/runs/index.mjs'), /^import \* as m_runs_runs from '\.\/runs\.mjs';$/m);
  assert.match(idx.get('ui/routes/runs/index.mjs'), /^ {2}Object\.freeze\(\[m_runs_runs\]\),/m);
  assert.match(idx.get('ui/routes/runs/index.mjs'), /^ {2}Object\.freeze\(\[m_runs_x\]\),/m);   // the index, not the name, records the segment
  // orderFlips checks this same order: the files it reads are packFiles' own, already in registrationOrder
  assert.equal(orderFlips(plan, files).size, 0);
});

test('layering: a route file imports only ../../server.mjs and the re-pointed specifiers of its own statements', () => {
  const src = wrap("function rows() { return getDb().prepare('x').all(); }\napp.get('/api/runs', (q, s) => s.json(rows()));\nfunction shared() {}\napp.get('/api/runs/groups', shared);\napp.use(shared);\n");
  const plan = planRoutes(src, MAP);
  for (const f of packFiles(plan, MAP)) {
    const out = emitRouteFile({ name: f.name, feature: f.feature, doc: null, version: 1, stmtIdx: f.stmtIdx, plan });
    const specs = [...out.text.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    for (const sp of specs) assert.ok(sp === '../../server.mjs' || sp === 'express' || sp === '../../../src/core/db.mjs', `${f.name}: ${sp}`);
  }
});

test('relSpecifier: relative paths move two levels (ui/routes/FEATURE), bare specifiers stay', () => {
  assert.equal(relSpecifier('../src/core/x.mjs', 'ui/routes/runs'), '../../../src/core/x.mjs');
  assert.equal(relSpecifier('./public/y.mjs', 'ui/routes/runs'), '../../public/y.mjs');
  assert.equal(relSpecifier('express', 'ui/routes/runs'), 'express');
});

test('a helper that writes a central let stays central for good (the fixed point settles)', () => {
  const plan = planRoutes(wrap("function bump() { DRAIN = true; }\napp.get('/api/runs', (q, s) => { bump(); s.end(); });\n"), MAP);
  assert.deepEqual(all(plan).map((i) => plan.body[i].type), ['ExpressionStatement']);
  const out = emitRouteFile({ name: 'runs', feature: 'runs', doc: null, version: 1, stmtIdx: all(plan), plan });
  assert.match(out.text, /import \{ bump \} from '\.\.\/\.\.\/server\.mjs';/);
});
