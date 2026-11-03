// test/split-by-feature-after-split.test.mjs — the post-split guards (#919): a movable route left in the residual
// ui/server.mjs, a route above its static mount that is not central, and a monolith kept next to ui/public/parts.json
// all fail, naming the catch-up command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { residualRouteProblems, topZoneRouteProblems, keptMonolithProblems, catchUpCommand, express4SyntaxProblems } from '../tools/split-by-feature/after-split.mjs';

const CMD = 'npm run split:catch-up -- feat/old';
const MAP = { features: [{ name: 'settings', routes: ['/api/settings'] }, { name: 'runs', routes: ['/api/runs'] }] };
// A residual ui/server.mjs in miniature: the parts-aware static mount opens the old move region, the SPA fallback closes it.
const server = (region, above = '') => "import express from 'express';\nconst app = express();\nlet hits = 0;\n" + above
  + 'app.use(function servePublic(req, res, next) { next(); });\n' + region
  + 'for (const mod of []) mod.register(app);\n// SPA fallback: x\napp.use((q, s, n) => n());\n';
const tmp = (t) => { const d = mkdtempSync(join(tmpdir(), 'sbf-kept-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('a movable route left in the residual ui/server.mjs names its feature folder and the catch-up command', () => {
  const src = server("app.get('/api/settings/x', (q, r) => r.json({}));\n");
  assert.deepEqual(residualRouteProblems(src, MAP, new Set(), CMD),
    ['route GET /api/settings/x (ui/server.mjs:5) belongs in ui/routes/settings/ — run npm run split:catch-up -- feat/old']);
});

test('a route whose key is in pinned.json stays central', () => {
  const src = server("app.get('/api/settings/x', (q, r) => r.json({}));\n");
  assert.deepEqual(residualRouteProblems(src, MAP, new Set(['GET "/api/settings/x"']), CMD), []);
});

test('a route the split rules keep central (it writes a central binding) is not flagged', () => {
  const src = server("app.post('/api/runs/y', (q, r) => { hits += 1; r.json({}); });\n");
  assert.deepEqual(residualRouteProblems(src, MAP, new Set(), CMD), []);
});

test('a route above the static mount is outside the old move region and is not flagged by the residual guard', () => {
  const src = server('', "app.get('/api/settings/x', (q, r) => r.json({}));\n");
  assert.deepEqual(residualRouteProblems(src, MAP, new Set(), CMD), []);
});

test('a route above the static mount fails the top-zone guard, naming its feature folder and the catch-up command', () => {
  const src = server('', "app.post('/api/settings/x', (q, r) => r.json({}));\n");
  assert.deepEqual(topZoneRouteProblems(src, MAP, new Set(), CMD),
    ['route POST /api/settings/x (ui/server.mjs:4) belongs in ui/routes/settings/ — run npm run split:catch-up -- feat/old'
      + ' (top of ui/server.mjs is for central sign-in and guards only)']);
});

test('a central top-zone route in central-routes.json passes the top-zone guard', () => {
  const src = server('', "app.post('/api/run', express.json({ limit: '64mb' }));\nfor (const p of PATHS) app.post(p, gate);\n");
  assert.deepEqual(topZoneRouteProblems(src, MAP, new Set(['POST /api/run', 'POST p']), CMD), []);
});

test('an unmapped route in the region keeps the coverage message', () => {
  const src = server("app.get('/api/zz/x', (q, r) => r.json({}));\n");
  assert.deepEqual(residualRouteProblems(src, MAP, new Set(), CMD), ['unmapped route: GET /api/zz/x (ui/server.mjs:5)']);
});

test('a residual server without the servePublic mount is a problem, not a crash', () => {
  const src = "const app = {};\napp.get('/api/settings/x', () => {});\n// SPA fallback: x\napp.use(() => {});\n";
  assert.deepEqual(residualRouteProblems(src, MAP, new Set(), CMD), ['split: ui/server.mjs anchors not found (static mount / SPA fallback) (ui/server.mjs:1)']);
});

test('a kept ui/public/style.css next to parts.json is not served and names the catch-up command', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'style.css'), ':root{}\n');
  assert.deepEqual(keptMonolithProblems(d, CMD), []);                              // no parts.json: an unsplit tree
  writeFileSync(join(d, 'parts.json'), '{}');
  assert.deepEqual(keptMonolithProblems(d, CMD), ['ui/public/style.css next to ui/public/parts.json is not served: the app builds '
    + "/style.css from the parts listed in parts.json, so this file's changes are lost — run npm run split:catch-up -- feat/old"]);
});

test('a kept ui/public/index.html next to parts.json is not served and names the catch-up command', (t) => {
  const d = tmp(t);
  writeFileSync(join(d, 'parts.json'), '{}'); writeFileSync(join(d, 'index.html'), '<html>\n');
  assert.deepEqual(keptMonolithProblems(d, CMD), ['ui/public/index.html next to ui/public/parts.json is not served: the app builds '
    + "the page from the parts listed in parts.json, so this file's changes are lost — run npm run split:catch-up -- feat/old"]);
});

test('catchUpCommand: the placeholder outside a git branch', (t) => {
  assert.equal(catchUpCommand(tmp(t)), 'npm run split:catch-up -- <branch>');
});

test('on Express 5, a route in Express 4 path syntax fails with its Express 5 spelling (a caught-up Express 4 branch)', (t) => {
  const d = tmp(t);
  mkdirSync(join(d, 'ui/routes/runs'), { recursive: true });
  writeFileSync(join(d, 'ui/server.mjs'), "app.get('/api/ok/:id', h);\nheaders.get('x-a?');\n");
  writeFileSync(join(d, 'ui/routes/runs/raw.mjs'), ['export function register(app) {', "  app.get('/api/runs/:id/raw/*', h);",
    "  app.get('/api/runs/:id/tab/:tab?', h);", "  app.post('/api/pair/:id/:verdict(approve|deny)', h);", '  app.get(`/api/x/${a}/(y)`, h);',
    "  app.get('/api/runs/:id/raw/*splat', h); app.get('/api/page{/:tab}', h); app.get(/^\\/re\\/(.+)$/, h);", '}', ''].join('\n'));
  assert.deepEqual(express4SyntaxProblems(d), [
    'route GET /api/runs/:id/raw/* (ui/routes/runs/raw.mjs:2) uses Express 4 path syntax: a bare * is a named wildcard in Express 5: *splat (the handler reads req.params.splat, an array of segments, not req.params[0]) — dev is on Express 5',
    'route GET /api/runs/:id/tab/:tab? (ui/routes/runs/raw.mjs:3) uses Express 4 path syntax: the optional :tab? is {/:tab} in Express 5 — dev is on Express 5',
    'route POST /api/pair/:id/:verdict(approve|deny) (ui/routes/runs/raw.mjs:4) uses Express 4 path syntax: :verdict(…) has an inline regex, which Express 5 dropped: register :verdict and check it in the handler (next() when it does not match) — dev is on Express 5',
    'route GET /api/x/${…}/(y) (ui/routes/runs/raw.mjs:5) uses Express 4 path syntax: "(" is reserved in Express 5 paths: escape it (\\() or use a RegExp route — dev is on Express 5',
  ]);
});
