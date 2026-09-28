// test/workspace-map-docs.test.mjs
// The workspace map is documented where a reader looks: docs/workspace-map.md (stages,
// coverage, confidence, review, graph, eval — with the eval tool's own command line), the
// README Workspaces section and docs list, guardrails.md (script stages outside the deny
// rules but inside the env scrub), getting-started row 7, storage.md (graph copy + v40
// columns), and ui-levels.md (the Map tab at the level app.js gives it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { USAGE } from '../tools/workspace-map-eval.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const lines = (rel) => read(rel).split(/\r?\n/);

test('docs/workspace-map.md: every section, stage, level and confidence; the eval command line is the tool\'s', () => {
  const doc = read('docs/workspace-map.md');
  for (const h of ['## How a scan works', '## Coverage and confidence', '## The description', '## Reviewing the map',
    '## Cross-project graph', '## Measuring a scan', '## Guardrails']) assert.ok(doc.includes(h), h);
  for (const row of ['extract', 'survey', 'catalog', 'usage', 'join', 'synth', 'render',
    'rich', 'partial', 'none', 'exact', 'verified', 'heuristic', 'inferred']) {
    assert.match(doc, new RegExp(`^\\| ${row} \\|`, 'm'), `table row: ${row}`);
  }
  assert.ok(doc.includes(USAGE.replace(/^usage: /, '')), 'the command line matches tools/workspace-map-eval.mjs');
  assert.ok(doc.includes('Regenerate description'));
  assert.ok(doc.includes('Cross-project graph: <path> — graphify query "<question>" --graph "<path>"'));
  const flat = doc.replace(/\s+/g, ' ');
  assert.ok(flat.includes('are replaced by `***` before anything is recorded'), 'the Guardrails section states the redaction');
  assert.ok(flat.includes('well-known API token formats'));
  assert.ok(flat.includes('webhook URL tokens'));
  assert.ok(flat.includes('Checking a line an agent cites (a survey fact in the catalog, a reported use in the join) reads that file whatever its name'));
});

test('README: the Workspaces section describes the Map tab and links the doc; the docs list names it', () => {
  const readme = read('README.md');
  const section = readme.slice(readme.indexOf('### Workspaces'), readme.indexOf('### Plugins & chat'));
  assert.match(section, /\*\*Map\*\* tab/);
  assert.ok(section.includes('(docs/workspace-map.md)'));
  assert.match(readme, /^- \[Workspace map\]\(docs\/workspace-map\.md\) — /m);
});

test('guardrails.md: the scan\'s script stages are outside the deny rules, inside the env scrub, and read member checkouts', () => {
  const doc = read('docs/guardrails.md');
  assert.match(doc, /script stages \(extract, catalog, join, render\)/);
  assert.ok(doc.includes('(see [workspace-map.md](workspace-map.md#guardrails))'));
  const flat = doc.replace(/\s+/g, ' ');
  assert.ok(flat.includes('no deny rule reaches them, and they start from the run\'s scrubbed environment when its set scrubs'));
  assert.ok(flat.includes('checking a line an agent cites reads that file whatever its name'), 'the verifier reads protected files an agent cites');
  const at = doc.indexOf('- Exempt from scrub/deny:');
  assert.ok(at >= 0, 'the exempt bullet exists');
  const exempt = doc.slice(at, doc.indexOf('\n- ', at));
  assert.equal(/script/i.test(exempt), false, 'a script node starts from the run\'s scrubbed env: never listed as exempt from scrub');
});

test('getting-started row 7 names the Map tab; storage.md names the graph copy and the v40 columns', () => {
  assert.match(lines('docs/getting-started.md').find((l) => l.startsWith('| 7 |')), /\*\*Map\*\* tab/);
  const storage = read('docs/storage.md');
  assert.ok(storage.includes('workspace-graph.json'));
  assert.ok(storage.includes('workspaces.map_json, map_overrides_json'));
});

test('ui-levels.md lists the workspace Map tab at the level app.js gives it', () => {
  const m = /key:\s*'map',\s*label:\s*'Map',\s*level:\s*'(simple|advanced|expert)'/.exec(read('ui/public/app.js'));
  assert.ok(m, 'WD_TABS carries the Map tab');
  const letter = { simple: 'S', advanced: 'A', expert: 'E' }[m[1]];
  const row = lines('docs/ui-levels.md').find((l) => l.startsWith('| Workspace page Map tab'));
  assert.ok(row, 'the Map tab row exists');
  assert.match(row, new RegExp(`\\| ${letter}( — [^|]*)? \\|$`));
});
