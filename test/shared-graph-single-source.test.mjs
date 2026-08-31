import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as uiModel from '../ui/public/graph/model.mjs';
import * as validate from '../src/shared/graph/validate.mjs';
import * as ports from '../src/shared/graph/ports.mjs';
import * as template from '../src/shared/graph/template.mjs';
import * as geometry from '../src/shared/graph/geometry.mjs';
import * as route from '../src/shared/graph/route.mjs';
import * as loops from '../src/shared/graph/loops.mjs';
import * as layout from '../src/shared/graph/layout.mjs';
import * as thumbnail from '../src/shared/graph/thumbnail.mjs';
import * as agentMeta from '../src/shared/graph/agent-meta.mjs';
import * as manifest from '../src/shared/graph/manifest.mjs';

test('ui/public/graph/model.mjs re-exports the SHARED functions — same identity, no copy', () => {
  assert.equal(uiModel.validateGraph, validate.validateGraph);
  assert.equal(uiModel.formatIssue, validate.formatIssue);
  assert.equal(uiModel.portsFnFor, ports.portsFnFor);
  assert.equal(uiModel.portsOf, ports.portsOf);
  assert.equal(uiModel.canWire, template.canWire);
  assert.equal(uiModel.normalizeTemplate, template.normalizeTemplate);
  assert.equal(uiModel.newNode, template.newNode);
  assert.equal(uiModel.nodeSize, geometry.nodeSize);
  // The router is the ONE wire-shape generator (view, ghost, thumbnail, hit test).
  assert.equal(uiModel.routeWire, route.routeWire);
  assert.equal(uiModel.routeAll, route.routeAll);
  assert.equal(uiModel.separateRoutes, route.separateRoutes);
  assert.equal(uiModel.routePathD, route.routePathD);
  assert.equal(uiModel.routeMid, route.routeMid);
  assert.equal(uiModel.hitRoute, route.hitRoute);
  assert.equal(uiModel.classifyLoops, loops.classifyLoops);
  assert.equal(uiModel.autoLayout, layout.autoLayout);
  assert.equal(uiModel.thumbnailSvg, thumbnail.thumbnailSvg);
  assert.equal(uiModel.indexByKey, agentMeta.indexByKey);
  assert.equal(uiModel.manifestPortsFn, manifest.manifestPortsFn);
  // C-2: the icon allowlist is shared by the run monitor (manifest cells) and the
  // composer canvas (view.mjs safeAgentIcon) — one function, never a second copy.
  assert.equal(typeof manifest.sanitizeIcon, 'function', 'manifest exports sanitizeIcon');
  assert.equal(uiModel.sanitizeIcon, manifest.sanitizeIcon);
});

test('model.mjs imports ONLY by relative path and carries the depth note', () => {
  const src = readFileSync(fileURLToPath(new URL('../ui/public/graph/model.mjs', import.meta.url)), 'utf8');
  const specs = [...src.matchAll(/from\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(specs.length >= 8);
  for (const s of specs) {
    assert.match(s, /^\.\.\/\.\.\/\.\.\/src\/shared\/graph\//, `"${s}" must walk up exactly three levels`);
  }
  assert.match(src, /depth 3/, 'the header states the depth so a moved file is caught by review');
});
