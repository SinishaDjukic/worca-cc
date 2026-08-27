# Agent B — Isomorphic shared graph core (adjudication, 2026-08-26)

## Findings (dev @ e6968e15)
- Statics: one mount `app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }))` ui/server.mjs:771. node_modules assets are per-file `res.sendFile` routes with `res.type('text/javascript')` + nosniff: hljs :718-737, marked/dompurify :745-757, `/vendor` 404 tail :759-769. No CSP/helmet. Middleware order: express.json :704 → loopback Host/Origin guard :711-716 → vendor → static → API → SPA fallback :4793-4800 (any unmatched GET not under /api/, /ws, /vendor gets index.html). Nothing mounts /src.
- MIME: express 4.22.2 → serve-static 1.16.3 → send 0.19.2 → mime 1.6.0: `.mjs` = application/javascript; charset UTF-8. Headless Chrome 151 executed as module, zero console errors.
- UI tests load ui modules as plain Node ESM: test/composer-ui.test.mjs:7-16 imports ../ui/public/composer-core.mjs; test/ask-panel.test.mjs:7 imports ask-panel.mjs (which imports siblings relatively, ui/public/ask-panel.mjs:7-10); test/ui-composer-wires.test.mjs:15-31 boots app.js under jsdom via `await import(appPath + '?b=…')`. ⇒ absolute specifier `/src/shared/graph/ports.mjs` BREAKS in Node (ERR_MODULE_NOT_FOUND).
- Precedent: src/core/diff-anchor.mjs:9-18 reaches into ../../ui/public/diff-view.mjs "because ui/public is the only directory express.static serves". Old branch byte-copied 700 LOC.
- Purity hazard: old src/core/graph/ports.mjs:18 imported hasBlocking from ../protocol.mjs which imports node:fs/promises (protocol.mjs:8).

## Verdict 1 — Location: `src/shared/graph/`
Below both src/core and ui/public; neither imports the other. Rejected src/core/graph/pure/ (no crisp guard boundary) and ui/public/shared/ (engine + CLI would depend on UI tree). `src/` and `ui/public/` both in package.json#files.

## Verdict 2 — Import convention: RELATIVE paths that walk above the static root; no import map
URL path == repo path by construction (/src/shared/graph/x.mjs ↔ src/shared/graph/x.mjs). Import map rejected (package.json#imports + index.html map = two-source drift jsdom can't detect). Node = strict resolver; browser clamps `..` above root.
Probe (scratchpad/agent-b/probe/probe.mjs): new URL('../../../src/shared/graph/validate.mjs', '/graph/composer.mjs') → /src/shared/graph/validate.mjs; from /app.js with 2 `..` → same; over-deep clamps. Node ESM identity: app.js (2 ..) and graph/composer.mjs (3 ..) get the SAME module instance (sameFn/sameState/sameUrl true) in Node, jsdom (?b= cache-bust re-evaluates app.js only; shared dep NOT re-evaluated), and Chrome 151. Express mount: GET /src/shared/graph/validate.mjs → 200 application/javascript nosniff; missing file → 404 text/plain with the tail (WITHOUT the tail → SPA fallback serves index.html = MIME error in Chrome); `..` / %2e%2e traversal → 404 (send refuses).

MOUNT (insert after the /vendor tail ui/server.mjs:769, before :771):
```js
// src/shared/** is the ONE source of the graph model for server + browser
// (no build step). ui modules import it by relative path that walks above
// ui/public; the browser clamps that URL at '/', so it must be served here at
// exactly the repo-relative path. The 404 tail keeps a typo'd path from
// falling through to the SPA index.html (which Chrome reports as a MIME error).
const SHARED_DIR = path.join(PROJECT_ROOT, 'src', 'shared');
app.use('/src/shared', express.static(SHARED_DIR, {
  index: false,
  setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
}));
app.use('/src/shared', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Not found');
});
```
IMPORT LINES (`..` count = file depth below repo root; header comment in every ui module):
```js
// ui/public/app.js                (depth 2)
import { portsFnFor } from '../../src/shared/graph/ports.mjs';
// ui/public/graph/composer.mjs    (depth 3)
import { validateGraph } from '../../../src/shared/graph/validate.mjs';
import { nodeSize, portAnchor, bezierPath } from '../../../src/shared/graph/geometry.mjs';
// src/core/graph/scheduler.mjs / ui/server.mjs / test/*.mjs — ordinary relative paths
import { classifyLoops } from '../../shared/graph/loops.mjs';
```
Identity test (test/shared-graph-single-source.test.mjs): (1) ui/public/graph/model.mjs re-exports validateGraph from shared; assert uiModel.validateGraph === shared.validateGraph. (2) POST /api/workflows an invalid v2 graph and assert.deepEqual(body.errors, validateGraph(tpl, portsFn).errors) — proves 422 text == composer text.

## Verdict 3 — What stays OUT of shared; agent ports in the browser
Never in src/shared: anything importing node:*, express, db.mjs, agent-registry.mjs (fs), protocol.mjs (fs), artifacts.mjs, channels.mjs, projects.mjs; scheduler/executor (IO-injected engine); seed templates, GRAPH_DEFAULT_WORKFLOW, migrations. Move BLOCKING/normalizeSeverity/hasBlocking/blockingIssues (protocol.mjs:244-259, pure) into src/shared/graph/verdict.mjs; protocol.mjs re-exports them.
Agent port metadata: FETCH, no embedded table. GET /api/agents (ui/server.mjs:3907) already returns normalized meta; v2 adds inputs/outputs/runnerType/verdict/fanOut/asksQuestions/placeable/mockRole. Composer builds portsFn = portsFnFor(indexByKey(agents)) after fetch; palette "Loading agents…" then renders; on failure inline "Couldn't load agents — Retry" row, Save disabled. Canvas renders a loaded template regardless (unknown key → portsOf() returns empty ports + known:false; V4 pip; no crash). Run/History graphs do NOT use the live registry: run manifest snapshots {template, agents:{key→ports/display}} at run start (shared/manifest.mjs). Server: registryPortsFn(registry) = portsFnFor(indexByKey(registry)). Retires dev-map hot-spot #2 (composer-core.mjs:57-102) and the connects-to.test.mjs pin; spec §5/§6 "EMBEDDED_AGENTS regenerated with v2 ports" superseded (record as deviation).

## Verdict 4 — Remaining duplication risks
1. CSS geometry — geometry.mjs exports GEOMETRY_CSS_VARS (--gv-node-w:220px, --gv-head-h, --gv-port-row-h, --gv-zone-gap, --gv-dot-r, …); canvas engine applies on the .gv-world host at mount (style.setProperty); style.css uses only var(--gv-*). Guard: set-equality between --gv-* names referenced in style.css and Object.keys(GEOMETRY_CSS_VARS).
2. Agent-meta v2 normalization — one shared agent-meta.mjs used by registry + Agents-view port editor + agent-gen output checks.
3. Server 422 = validator messages by construction. Never hand-write graph error strings in server.mjs.
4. Seeds vs sidecar port ids — graph-seed-templates.test.mjs validates every seed with the shared validator against real agents/*.meta.json ports.
5. Test fixtures — no FIXTURE_PORTS copy; test/helpers/graph-ports.mjs loads the real sidecars and returns portsFn.
6. Bezier 0.45 — one bezierPath for view, ghost, thumbnail.
7. Module-level state — shared modules must be stateless (guard forbids top-level let/var).

## Verdict 5 — Test consequences + guard test
- Pure UI tests import shared directly (../src/shared/graph/validate.mjs), no jsdom; DOM tests keep the ui-composer-wires boot recipe.
- Server tests: add test/api-shared-static.test.mjs — walk src/shared/**, GET each at /src/shared/<rel> → 200, /javascript/i, nosniff, body equals file; /src/shared/graph/nope.mjs and /src/shared/graph/ → 404 and doesNotMatch(/text\/html/).
- Guard test test/shared-graph-purity.test.mjs (regexes dry-run against the current tree: 23 specifiers in ui/public, no false positives):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHARED = path.join(ROOT, 'src/shared');
const PUBLIC = path.join(ROOT, 'ui/public');
const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
const walk = (d, out = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p, out) : /\.(mjs|js)$/.test(e.name) && out.push(p); } return out; };
const specs = (src) => [...src.matchAll(IMPORT_RE)].map((m) => m[1] || m[2]);
const posix = (p) => p.split(path.sep).join('/');

test('src/shared/** is pure, relative-only, self-contained, stateless ESM', () => {
  const files = walk(SHARED);
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const s of specs(src)) {
      assert.match(s, /^\.\.?\//, `${f}: non-relative import "${s}"`);
      const t = path.resolve(path.dirname(f), s);
      assert.ok(t.startsWith(SHARED + path.sep) && statSync(t).isFile(), `${f}: "${s}" leaves src/shared or is missing`);
    }
    for (const [label, re] of [
      ['node: builtin', /['"]node:/], ['require()', /\brequire\s*\(/], ['process', /\bprocess\./],
      ['DOM global', /\b(window|document|navigator|localStorage)\b/], ['fetch', /\bfetch\s*\(/],
      ['import.meta', /import\.meta\b/], ['top-level mutable binding', /^(let|var)\s/m],
    ]) assert.doesNotMatch(src, re, `${f}: ${label}`);
  }
});

test('ui/public leaves the static root only into src/shared, at the URL the mount serves', () => {
  for (const f of walk(PUBLIC)) {
    for (const s of specs(readFileSync(f, 'utf8'))) {
      if (/^https?:|^\/vendor\//.test(s)) continue;
      assert.match(s, /^\.\.?\//, `${f}: "${s}" must be relative (absolute specifiers break Node)`);
      const onDisk = path.resolve(path.dirname(f), s);
      if (onDisk.startsWith(PUBLIC + path.sep)) continue;
      assert.ok(onDisk.startsWith(SHARED + path.sep), `${f}: "${s}" escapes ui/public but not into src/shared`);
      const url = new URL(s, 'http://x/' + posix(path.relative(PUBLIC, f))).pathname;
      assert.equal(url, '/' + posix(path.relative(ROOT, onDisk)), `${f}: browser URL != disk path`);
    }
  }
});
```

## Shared modules (`src/shared/graph/`) and planned exports
| module | exports |
|---|---|
| constants.mjs | TEMPLATE_VERSION=2, KINDS, FLOW_KINDS, PORT_TYPES (md|json|void|any), AWAIT_PORT, TASK_PORTS, END_PORTS, gatePorts(kind, arity), NODE_ID_RE/WIRE_ID_RE/PORT_ID_RE, DEFAULT_MAX_CYCLES, MAX_PORTS_PER_SIDE=8, LIMITS |
| verdict.mjs | SEVERITIES, BLOCKING, normalizeSeverity, hasBlocking, blockingIssues (moved from protocol.mjs, re-exported there) |
| ports.mjs | flowPorts(node), portsFnFor(agentsByKey), portsOf(portsFn,node) (never throws; known:false), findPort, typeCompatible(out,in), resolveOrOutType(tpl, portsFn, orId, seen), inboundWires, outboundWires, firedOutputs(ports, verdict) |
| loops.mjs | tarjanSccs(ids, edges), classifyLoops(tpl, portsFn) → {loopWireIds, loopInputs, sccOf, launchOrder} |
| validate.mjs | RULES ([{code:'V1'…'V21', check}]), validateGraph(tpl, portsFn, {limits}) → {ok, errors, warnings} with Issue={code,message,nodeId?,wireId?,portId?}, formatIssue |
| template.mjs | normalizeTemplate, serializeTemplate (stable key order), newNode, newWire, mintId(prefix, taken), canWire({tpl, portsFn, from, to}) → {ok, code?, reason?}, removeNode, removeWire, nodeById, wireById |
| geometry.mjs | NODE_W, HEADER_H, PORT_ROW_H, ZONE_GAP, PAD_T/PAD_B/BORDER/FOOTER_H, PORT_HIT_R, WIRE_HIT_TOL, SNAP, ZOOM_MIN/MAX, GEOMETRY_CSS_VARS, nodeSize, portAnchor, bezierPath(a,b,{loop,reverse}), bezierPoint, snap, hitNode, hitPort, hitWire, graphBounds, fitBounds |
| layout.mjs | rankNodes(tpl, loops), autoLayout(tpl, portsFn) (deterministic, idempotent, loop wires excluded) |
| thumbnail.mjs | thumbnailSvg(tpl, portsFn, {width,height}) → string (uses geometry.bezierPath) |
| agent-meta.mjs | normalizeAgentMeta(raw) → {meta, errors} (spec §5 v2 rules), indexByKey(list) |
| manifest.mjs | buildGraphManifest(tpl, agentsByKey) (run-start snapshot), manifestPortsFn(manifest), manifestTemplate(manifest) |
Engine-only (src/core/graph/): scheduler.mjs, executor.mjs, registry-ports.mjs, builtin-workflows.mjs, seed-templates.mjs. Browser-only (ui/public/graph/): view.mjs, composer.mjs, inspector.mjs, palette.mjs, run-decor.mjs, save-dialog.mjs, model.mjs (thin re-export/adapter).
Deviations to record: spec §6 agents-meta.mjs/EMBEDDED_AGENTS row and §5 "fallback regenerated" dropped (fetch-only); §6 graph-model.mjs "validate adapter" = re-export of shared validator; diff-view.mjs stays.
