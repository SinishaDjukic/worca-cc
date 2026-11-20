import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { compareDumps, probesFor, childEnv, layersOf } from '../tools/split-by-feature/equivalence.mjs';
import { recordMounts, routeTable } from '../tools/express-routes.mjs';
import { describePath } from '../tools/split-by-feature/overlap.mjs';

const r = (path, h = 'h1', methods = ['get']) => ({ kind: 'route', path: describePath(path), methods, handlers: [h] });
// mw('x') is root-mounted (fast_slash); mw('x', source) is scoped to that mount regexp
const mw = (name, source) => ({ kind: 'mw', name, fastSlash: source === undefined, re: { source: source ?? '^\\/?(?=\\/|$)', flags: 'i' }, handler: name });
const SHARED = '^\\/src\\/shared\\/?(?=\\/|$)';
const served = { 'GET /style.css': { status: 200, type: 'text/css; charset=UTF-8', cache: 'public, max-age=0', etag: true, lastModified: true, sha: 'a' } };

test('identical dumps are equal', () => {
  const d = { layers: [mw('serveStatic'), r('/api/runs')], served };
  assert.deepEqual(compareDumps(d, d), { equal: true, problems: [], acceptedDeltas: [] });
});
test('a scoped serveStatic ahead of the public one is ordinary middleware, not the asset layer', () => {
  const before = { layers: [mw('serveStatic', SHARED), mw('guard'), mw('serveStatic'), r('/api/x')], served };
  const split = { layers: [mw('serveStatic', SHARED), mw('guard'), mw('serveStyleCss'), mw('servePublic'), r('/api/x')], served };
  assert.deepEqual(compareDumps(before, split).problems, []);
  const dropped = { layers: [mw('guard'), mw('serveStyleCss'), mw('servePublic'), r('/api/x')], served };   // /src/shared mount lost
  assert.match(compareDumps(before, dropped).problems.join('\n'), /asset middleware moved|middleware sequence differs/);
  const twoRoot = { layers: [mw('serveStatic'), mw('serveStatic'), r('/api/x')], served };
  assert.match(compareDumps(twoRoot, twoRoot).problems.join('\n'), /expected 1 unscoped serveStatic, found 2/);
});
// D(layers, served): a dump whose layers sit behind one root static mount, with the base served probes
const D = (layers = [], extra = {}) => ({ layers: [mw('serveStatic'), ...layers], served: { ...served, ...extra } });
test('the raw-shell spellings may only change from no CSP to the rendered shell (D23)', () => {
  const raw = { status: 200, type: 'text/html; charset=UTF-8', csp: null, sha: 'raw' };
  const shell = { status: 200, type: 'text/html; charset=utf-8', csp: "default-src 'self'", sha: 'shell' };
  const ok = compareDumps(D([], { 'GET //index.html': raw }), D([], { 'GET //index.html': shell }));
  assert.deepEqual(ok.problems, []); assert.equal(ok.acceptedDeltas[0].probe, 'GET //index.html');
  const bad = compareDumps(D([], { 'GET //index.html': raw }), D([], { 'GET //index.html': { ...shell, status: 404 } }));
  assert.deepEqual(bad.problems, ['served output differs: GET //index.html']);
  const other = compareDumps(D([], { 'GET /index.html': raw }), D([], { 'GET /index.html': shell }));
  assert.deepEqual(other.problems, ['served output differs: GET /index.html']);   // no other probe may change
});
test('a flipped pair that can match the same URL is a problem; a disjoint pair is not', () => {
  const before = D([r('/api/runs/groups', 'g'), r('/api/runs/:id', 'i'), r('/api/chat', 'c')]);
  const after = D([r('/api/runs/:id', 'i'), r('/api/runs/groups', 'g'), r('/api/chat', 'c')]);
  const p = compareDumps(before, after).problems;
  assert.equal(p.length, 1); assert.match(p[0], /order flip/);
  const after2 = D([r('/api/chat', 'c'), r('/api/runs/groups', 'g'), r('/api/runs/:id', 'i')]);
  assert.deepEqual(compareDumps(before, after2).problems, []);
});
test('a route moved past a central middleware that matches it is a problem, a parameterised one too', () => {
  const guard = mw('mcpGuard', '^\\/api\\/mcp\\/?(?=\\/|$)');
  const before = { layers: [mw('serveStatic'), r('/api/mcp/preview', 'p'), guard], served };
  const after = { layers: [mw('serveStyleCss'), mw('servePublic'), guard, r('/api/mcp/preview', 'p')], served };
  assert.match(compareDumps(before, after).problems.join('\n'), /order flip/);
  const groups = mw('groupsMw', '^\\/api\\/runs\\/groups\\/?(?=\\/|$)');
  assert.match(compareDumps(D([r('/api/runs/:id', 'i'), groups]), D([groups, r('/api/runs/:id', 'i')])).problems.join('\n'), /order flip/);
});
test('array and regexp paths are compared and overlap conservatively', () => {
  const before = D([r(['/api/a', '/api/runs/:id'], 'x'), r('/api/runs/groups', 'g')]);
  const after = D([r('/api/runs/groups', 'g'), r(['/api/a', '/api/runs/:id'], 'x')]);
  assert.match(compareDumps(before, after).problems.join('\n'), /order flip/);
  const re = { kind: 'route', path: describePath(/^\/api\/x/), methods: ['get'], handlers: ['h'] };
  assert.match(compareDumps(D([re, r('/api/y')]), D([r('/api/y'), re])).problems.join('\n'), /order flip/);
});
test('a changed handler body is a problem', () => {
  assert.match(compareDumps(D([r('/api/x', 'h1')]), D([r('/api/x', 'h2')])).problems.join('\n'), /route layers differ/);
});
test('asset layers: serveStyleCss must take serveStatic\'s index, servePublic the next one', () => {
  const before = { layers: [mw('guard'), mw('serveStatic'), r('/api/x')], served };
  assert.deepEqual(compareDumps(before, { layers: [mw('guard'), mw('serveStyleCss'), mw('servePublic'), r('/api/x')], served }).problems, []);
  assert.match(compareDumps(before, { layers: [mw('serveStyleCss'), mw('guard'), mw('servePublic'), r('/api/x')], served }).problems.join('\n'), /asset middleware moved/);
});
test('different served bytes or headers are a problem', () => {
  assert.deepEqual(compareDumps(D(), D([], { 'GET /style.css': { ...served['GET /style.css'], sha: 'b' } })).problems, ['served output differs: GET /style.css']);
  assert.deepEqual(compareDumps(D(), D([], { 'GET /style.css': { ...served['GET /style.css'], etag: false } })).problems, ['served output differs: GET /style.css']);
});
test('probes cover parts, extensionless HTML, variants, folders and a bad escape', () => {
  const p = probesFor({ css: ['chat/chat.css'], html: ['shell/shell.html'], dirs: ['shell'] }).map(([m, u]) => `${m} ${u}`);
  for (const u of ['GET /chat/chat.css', 'GET //chat/chat.css', 'GET /CHAT/CHAT.CSS', 'GET /shell/shell', 'GET /shell', 'GET /shell/', 'GET /parts.json', 'GET /%E0%A4%A',
    'GET //style.css', 'GET /%73tyle.css', 'GET /style.css/', 'GET //index.html', 'GET /%69ndex.html'])
    assert.ok(p.includes(u), u);
});
test('child env is an allowlist plus the sandbox', () => {
  process.env.SECRET_TOKEN_FOR_TEST = 'x';
  const env = childEnv('/tmp/h');
  assert.equal(env.SECRET_TOKEN_FOR_TEST, undefined);
  assert.equal(env.HOME, '/tmp/h'); assert.equal(env.WORCA_MOCK, '1'); assert.equal(env.PORT, '0');
  delete process.env.SECRET_TOKEN_FOR_TEST;
});

// The same app on Express 4 (the express4 alias) and Express 5, each in its own syntax: one layer list, so the dry run
// and the catch-up compare a pre-split Express 4 tree with an Express 5 one.
test('layersOf reads an Express 4 app and an Express 5 app to the same layers', () => {
  const req = createRequire(import.meta.url);
  const build = (pkg, star, opt) => {
    const er = createRequire(req.resolve(`${pkg}/package.json`)); recordMounts(er); const express = er('./');
    const app = express(); const feat = express.Router(); const h = (q, s) => s.end(); const next = (q, s, n) => n();
    feat.get('/items/:id', h);
    app.use(express.json()); app.use('/api/ask/threads/:id', next); app.use('/src/shared', next); app.use('/api/feat', feat);
    app.get(`/api/runs/:id/raw/${star}`, h); app.get(`/api/page${opt}`, h); app.get(/^\/vendor\/(.+)$/, h); app.use(function guard(q, s, n) { n(); });
    return layersOf(routeTable(app, (f) => f.name));   // express.json's own source differs between the majors
  };
  const four = build('express4', '*', '/:tab?'); const five = build('express', '*splat', '{/:tab}');
  assert.deepEqual(five, four);
  assert.deepEqual(four.map((l) => l.re?.source ?? l.path.value), ['^\\/?(?=\\/|$)', '^\\/api\\/ask\\/threads(?:\\/([^/]+?))\\/?(?=\\/|$)',
    '^\\/src\\/shared\\/?(?=\\/|$)', '^\\/api\\/feat\\/?(?=\\/|$)', '/api/runs/:id/raw/*', '/api/page{/:tab}', '/^\\/vendor\\/(.+)$/', '^\\/?(?=\\/|$)']);
  assert.deepEqual(compareDumps({ layers: [mw('serveStatic'), ...four], served }, { layers: [mw('serveStatic'), ...five], served }).problems, []);
});
