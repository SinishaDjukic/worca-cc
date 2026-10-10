import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as uiModel from '../ui/public/graph/model.mjs';
import * as validate from '../src/shared/graph/validate.mjs';
import * as ports from '../src/shared/graph/ports.mjs';
import * as template from '../src/shared/graph/template.mjs';
import * as geometry from '../src/shared/graph/geometry.mjs';
import * as route from '../src/shared/graph/route.mjs';
import * as curves from '../src/shared/graph/curves.mjs';
import * as loops from '../src/shared/graph/loops.mjs';
import * as layout from '../src/shared/graph/layout.mjs';
import * as thumbnail from '../src/shared/graph/thumbnail.mjs';
import * as agentMeta from '../src/shared/graph/agent-meta.mjs';
import * as manifest from '../src/shared/graph/manifest.mjs';
import * as flow from '../src/shared/graph/flow-layout.mjs';

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
  // The bezier wire shape (curves.mjs) is shared too — paint, ghost and hit read the same samples.
  assert.equal(uiModel.wireCurve, curves.wireCurve);
  assert.equal(uiModel.ghostCurve, curves.ghostCurve);
  assert.equal(uiModel.classifyLoops, loops.classifyLoops);
  assert.equal(uiModel.autoLayout, layout.autoLayout);
  assert.equal(uiModel.thumbnailSvg, thumbnail.thumbnailSvg);
  assert.equal(uiModel.indexByKey, agentMeta.indexByKey);
  assert.equal(uiModel.manifestPortsFn, manifest.manifestPortsFn);
  // The flow layout/router (auto-proposal hosts) is shared too — never a UI copy.
  assert.equal(uiModel.flowLayout, flow.flowLayout);
  assert.equal(uiModel.routeFlow, flow.routeFlow);
  // C-2: the icon allowlist is shared by the run monitor (manifest cells) and the
  // composer canvas (view.mjs safeAgentIcon) — one function, never a second copy.
  assert.equal(typeof manifest.sanitizeIcon, 'function', 'manifest exports sanitizeIcon');
  assert.equal(uiModel.sanitizeIcon, manifest.sanitizeIcon);
});
