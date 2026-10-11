// ui/public/c4/c4-view.mjs headless: the parser, view resolution, both layouts and the SVG
// renderer — the path the c4Render card takes — plus the Artifacts-tab kind dispatch
// (artifact-view-c4.mjs). The <worca-c4> element itself is exercised in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseC4, buildViews, renderToSVG } from '../ui/public/c4/c4-view.mjs';
import { loadDagre } from '../scripts/c4-dagre.mjs';
import { viewerKindFor } from '../ui/public/artifact-view-c4.mjs';
import { viewerKindFor as kindForPath, mimeForPath } from '../src/shared/artifact-kinds.mjs';
import { checkRows } from './helpers/rows.mjs';

const WORCA_MODEL = readFileSync(new URL('../docs/architecture/architecture.c4', import.meta.url), 'utf8');

test('the vendored dagre loads in Node', () => {
  const d = loadDagre();
  assert.ok(d && typeof d.layout === 'function' && d.graphlib);
});

test("every view of worca's own model renders headless, with and without dagre, and no NaN", () => {
  const m = parseC4(WORCA_MODEL);
  const views = buildViews(m);
  assert.ok(views.length >= 14);
  for (const dagre of [loadDagre(), null]) {
    for (const v of views) {
      const { svg, width, height } = renderToSVG(m, v.id, { dagre });
      assert.match(svg, /^<svg /, v.id);
      assert.ok(width > 0 && height > 0, v.id);
      assert.doesNotMatch(svg, /NaN|undefined/, `${v.id} ${dagre ? 'dagre' : 'rows'}`);
    }
  }
});

test('an edge that ends at a container drawn as a frame does not break the layout', () => {
  // dagre throws "Cannot set properties of undefined (setting 'rank')" on an edge into a compound
  // node; the viewer routes those edges between the boxes instead (a real run hit this).
  const m = parseC4(`specification { element system  element container }
model { s = system 'S' { app = container 'App'  db = container 'DB' }  ext = system 'Ext'
  s.app -> s.db 'reads'  s -> ext 'calls'  ext -> s 'webhook' }
views { view inside of s { include *, ext } }`);
  const { svg } = renderToSVG(m, 'inside', { dagre: loadDagre() });
  assert.doesNotMatch(svg, /NaN/);
  assert.match(svg, /<title>calls<\/title>/);
  assert.match(svg, /<title>webhook<\/title>/);
});

test('deployment sheet: bands in order, a lone card is capped and centred', () => {
  const m = parseC4(`specification { element system  deploymentNode zone }
model { a = system 'A' }
deployment { only = zone 'Only' { t = instanceOf a } }
views { deployment view d { include only.* } }`);
  const { svg } = renderToSVG(m, 'd', {});
  const rect = svg.match(/<g class="c4-node" data-id="only\.t"[^>]*><rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/);
  assert.ok(rect, 'the tile is drawn');
  const [x, w] = [Number(rect[1]), Number(rect[2])];
  assert.ok(w <= 300, `capped (${w})`);
  assert.ok(Math.abs(x + w / 2 - 560) < 1, 'centred on the 1120px sheet');
});

test('parse: criteria and order metadata, tags, multi-line strings, unresolved references reported', () => {
  const m = parseC4(`specification { element system  deploymentNode zone  tag gate }
model { a = system 'A' { description '''two
lines''' #gate }  a -> nowhere 'x' }
deployment { z = zone 'Z' { metadata { criteria 'what goes here' order 'alphabetical' }  t = instanceOf a } }
views { view index { include * } }`);
  assert.equal(m.deployment.z.metadata.criteria, 'what goes here');
  assert.equal(m.deployment.z.metadata.order, 'alphabetical');
  assert.ok(m.elements.a.tags.includes('gate'));
  assert.match(m.elements.a.description, /two\s*\n?\s*lines/);
  assert.ok(m.problems.some((p) => /nowhere/.test(p)));
});

test('artifact kinds: .c4 / .likec4 / .c4.json open in the C4 viewer, everything else as before', async () => {
  await checkRows([
    { name: 'C4 sources', run: () => { for (const p of ['docs/a.c4', 'A.LIKEC4', 'x/model.c4.json']) assert.equal(viewerKindFor(null, p), 'c4', p); } },
    { name: 'the c4 artifact kind with no extension', run: () => assert.equal(viewerKindFor('c4', 'model'), 'c4') },
    { name: 'the media and text kinds are untouched', run: () => {
      assert.equal(viewerKindFor(null, 'deck/deck.html'), 'html');
      assert.equal(viewerKindFor(null, 'shot.jpg'), 'image');
      assert.equal(viewerKindFor('plan', 'PLAN'), 'markdown');
      assert.equal(viewerKindFor(null, 'x.json'), 'json');
    } },
    { name: 'the shared table serves a .c4 as text', run: () => {
      assert.equal(kindForPath('a.c4'), 'text');
      assert.equal(mimeForPath('a.c4'), 'text/plain; charset=utf-8');
    } },
  ]);
});
