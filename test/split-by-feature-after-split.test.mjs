// test/split-by-feature-after-split.test.mjs — the post-split guards (#919): a movable route left in the residual
// ui/server.mjs and a monolith kept next to ui/public/parts.json both fail, naming the catch-up command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { residualRouteProblems, keptMonolithProblems, catchUpCommand } from '../tools/split-by-feature/after-split.mjs';

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

test('a route above the static mount is outside the old move region and is not flagged', () => {
  const src = server('', "app.get('/api/settings/x', (q, r) => r.json({}));\n");
  assert.deepEqual(residualRouteProblems(src, MAP, new Set(), CMD), []);
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
