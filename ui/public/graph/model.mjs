// ui/public/graph/model.mjs                                          (depth 3)
// The browser's door to the ONE graph model. ui/public cannot import src/core,
// but src/shared/** is pure ESM served at /src/shared, so these specifiers
// resolve to the SAME module instance in Node, jsdom and Chrome alike: three
// `..` because this file sits three levels below the repo root. Absolute
// specifiers ('/src/shared/...') are FORBIDDEN — they break the Node ESM
// resolver the UI tests use. NOTHING may be redefined here: this file is
// re-exports only, and test/shared-graph-single-source.test.mjs asserts the
// function IDENTITY against the shared modules.
export {
  flowPorts, portsFnFor, portsOf, findPort, typeCompatible, resolveOrOutType,
  inboundWires, outboundWires, firedOutputs,
} from '../../../src/shared/graph/ports.mjs';
export { tarjanSccs, classifyLoops } from '../../../src/shared/graph/loops.mjs';
export { RULES, validateGraph, formatIssue } from '../../../src/shared/graph/validate.mjs';
export {
  normalizeTemplate, serializeTemplate, newNode, newWire, mintId, canWire,
  removeNode, removeWire, nodeById, wireById,
} from '../../../src/shared/graph/template.mjs';
export {
  NODE_W, HEAD_H, ROW_H, SEP_H, PAD_T, PAD_B, BORDER, DOT, FOOT_H, EXEC_ROW_H, SNAP,
  PORT_HIT_R, WIRE_HIT_TOL, ZOOM_MIN, ZOOM_MAX, ZOOM_K, ROW0, GEOMETRY_CSS_VARS,
  injectGeometry, nodeSize, portAnchor, bezierPath, bezierPoint, bezierMid, snap,
  hitNode, hitPort, hitWire, graphBounds, fitBounds,
} from '../../../src/shared/graph/geometry.mjs';
export { rankNodes, autoLayout } from '../../../src/shared/graph/layout.mjs';
export { thumbnailSvg } from '../../../src/shared/graph/thumbnail.mjs';
export { normalizeAgentMeta, validateMetaV2, indexByKey, derivePortSummary } from '../../../src/shared/graph/agent-meta.mjs';
export { buildGraphManifest, manifestPortsFn, manifestTemplate, sanitizeIcon, UI_PHASE } from '../../../src/shared/graph/manifest.mjs';
export {
  TEMPLATE_VERSION, KINDS, FLOW_KINDS, PORT_TYPES, AWAIT_PORT, TASK_PORTS, END_PORTS,
  gatePorts, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE, LIMITS, NODE_ID_RE, WIRE_ID_RE, PORT_ID_RE,
} from '../../../src/shared/graph/constants.mjs';
