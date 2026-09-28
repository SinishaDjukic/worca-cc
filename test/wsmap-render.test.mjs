// test/wsmap-render.test.mjs — the generated description under a hard line budget (wsmap P1, spec §6.7).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderWorkspaceDescription, countLines } from '../src/shared/workspace-map/render.mjs';
import { emptyOverrides, setEdgeState, addManualEdge } from '../src/shared/workspace-map/overrides.mjs';
import { edgeId } from '../src/shared/workspace-map/ids.mjs';
import { KINDS } from '../src/shared/workspace-map/schema.mjs';

const AT = '2026-09-25T10:00:00.000Z';
const edge = (from, to, kind, norm, display, over = {}) => ({ id: edgeId(from, to, kind, norm), from, to, kind, norm, display,
  label: null, detail: null, confidence: 'exact', sources: ['static'],
  evidence: { from: [{ file: `src/${from}.ts`, line: 7, match: 'x' }], to: [] }, ...over });
const member = (key, over = {}) => ({ key, name: key, role: `Role of ${key}`, roleSource: 'static', aliases: [key], stack: ['node'],
  coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, factsStatic: 3, factsLlm: 0, unresolved: 0, rejected: 0,
    surveyed: 'skipped', usageStatus: 'investigated', graph: null }, ...over });
const shop = () => ({ version: 1, workspace: { name: 'Shop' }, members: [member('web'), member('billing-api', { name: 'Billing API', role: null }), member('shared-lib')],
  edges: [
    edge('web', 'billing-api', 'http', 'http:GET /invoices/{}', 'GET /invoices/{id}'),
    edge('web', 'billing-api', 'http', 'http:POST /invoices', 'POST /invoices', { confidence: 'verified' }),
    edge('web', 'shared-lib', 'pkg', 'pkg:npm:@acme/shared', '@acme/shared'),
    edge('billing-api', 'shared-lib', 'pkg', 'pkg:npm:@acme/shared', '@acme/shared'),
    edge('web', 'billing-api', 'topic', 'topic:orders', 'orders', { confidence: 'inferred', evidence: { from: [], to: [] } }),
  ],
  order: [['shared-lib'], ['billing-api'], ['web']], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 } });

test('countLines: newline-separated, trailing newline not counted', () => {
  assert.deepEqual(['', 'a', 'a\n', 'a\nb', 'a\nb\n', '\n'].map(countLines), [0, 1, 1, 2, 2, 1]);
});

test('L0 at a roomy budget: sections, roles, evidence, marks, order', () => {
  const synthesis = { version: 1, overview: 'A small shop.', roles: { 'billing-api': 'Bills customers' },
    coordination: ['Release billing-api before web.'], orderNotes: 'shared-lib first.' };
  const text = renderWorkspaceDescription({ name: 'Shop', map: shop(), synthesis, budget: 300 });
  const lines = text.split('\n');
  assert.equal(lines[0], '# Workspace: Shop');
  for (const h of ['## Overview', '## Projects', '## Interconnections', '## Change-coordination notes', '## Suggested change order']) assert.ok(lines.includes(h), h);
  assert.ok(!lines.includes('## Coverage'), 'no gaps → no Coverage section');
  assert.ok(lines.includes('- Billing API (`billing-api`): Bills customers'), 'synth role fills a missing role');
  assert.ok(lines.includes('- web (`web`): repo: "Role of web"'), 'a static role of unknown file: quoted, the neutral label (M1)');
  assert.ok(lines.includes('- web -> Billing API: REST API; GET /invoices/{id}, POST /invoices — src/web.ts:7'), text);
  assert.ok(lines.includes('- web -> Billing API: message/queue; orders (inferred)'), text);
  assert.ok(lines.includes('1. shared-lib') && lines.includes('3. web'));
  assert.ok(lines.includes('shared-lib first.'));
});

test('rejected and missing edges never reach the description; confirmed and manual are marked', () => {
  const map = shop();
  let ov = setEdgeState(emptyOverrides(), map.edges[4], 'rejected', AT);
  ov = setEdgeState(ov, map.edges[2], 'confirmed', AT);
  ov = setEdgeState(ov, edge('web', 'shared-lib', 'db', 'table:gone', 'gone'), 'confirmed', AT);
  ov = addManualEdge(ov, { from: 'shared-lib', to: 'web', kind: 'other', display: 'Shared S3 bucket' }, AT).overrides;
  const text = renderWorkspaceDescription({ name: 'Shop', map, overrides: ov, budget: 300 });
  assert.ok(!text.includes('orders'), 'rejected edge rendered');
  assert.ok(!text.includes('gone'), 'missing edge rendered');
  assert.ok(text.includes('- web -> shared-lib: build dep; @acme/shared — src/web.ts:7 (confirmed)'), text);
  assert.ok(text.includes('- shared-lib -> web: other; Shared S3 bucket (manual)'), text);
});

test('fallbacks: no synthesis, unknown roles, coverage gaps, graph line, null map', () => {
  const map = shop();
  map.members[2] = member('shared-lib', { role: null, stack: [], coverage: { ...member('x').coverage, level: 'none', surveyed: 'failed' } });
  const text = renderWorkspaceDescription({ name: 'Shop', map, budget: 300, graphLine: 'Cross-project graph: /g.json' });
  assert.ok(text.includes('Workspace of 3 projects: Billing API, shared-lib, web.'));
  assert.ok(text.includes('- Billing API (`billing-api`): (role unknown)'));
  assert.ok(text.includes('- shared-lib: not mapped (stack not recognised; survey failed)'), text);
  assert.equal(text.split('\n').at(-1), 'Cross-project graph: /g.json');
  const spaced = 'Cross-project graph: /Users/Jane  Doe/g.json — graphify query "<question>" --graph "/Users/Jane  Doe/g.json"';
  assert.equal(renderWorkspaceDescription({ name: 'Shop', map, budget: 300, graphLine: spaced }).split('\n').at(-1), spaced, 'a quoted path keeps its spacing');
  const bare = renderWorkspaceDescription({ name: 'Shop', map: null, budget: 300 });
  assert.equal(bare, ['# Workspace: Shop', '', '## Overview', '', 'No workspace map was produced.', '', '## Projects', '', '- (unknown)',
    '', '## Interconnections', '', '- (none found)', '', '## Coverage', '', '- not mapped (no workspace map was produced)'].join('\n'));
  assert.doesNotThrow(() => renderWorkspaceDescription({ name: 'Shop', map: { members: 'x' }, synthesis: 'junk', overrides: 7, budget: 'x' }));
});

test('nothing mapped: zero edges, every member none — the description still stands (review focus)', () => {
  const none = { ...member('x').coverage, level: 'none', surveyed: 'failed', usageStatus: 'failed' };
  const map = { version: 1, members: ['a', 'b'].map((k) => member(k, { role: null, stack: [], coverage: none })), edges: [], order: [['a', 'b']], cycles: [] };
  const text = renderWorkspaceDescription({ name: 'Legacy', map, budget: 300 });
  assert.ok(text.includes('## Interconnections\n\n- (none found)'));
  assert.ok(text.includes('1. a, b'));
  assert.ok(text.includes('- a: not mapped (stack not recognised; survey failed; usage lookup failed)'));
  assert.ok(!text.includes('## Change-coordination notes'));
});

function bigMap(nMembers, nEdges) {
  const keys = Array.from({ length: nMembers }, (_, i) => `member-${String(i).padStart(3, '0')}`);
  // Edge i joins member (i mod n) to the member (1 + ⌊i/n⌋ mod (n-1)) places later: distinct pairs.
  const edges = Array.from({ length: nEdges }, (_, i) => {
    const a = i % nMembers;
    const b = (a + 1 + (Math.floor(i / nMembers) % (nMembers - 1))) % nMembers;
    const kind = KINDS[i % KINDS.length];
    return edge(keys[a], keys[b], kind, `${kind}:thing-${i}`, `thing-${i}`, { detail: 'x'.repeat(40) });
  });
  return { version: 1, members: keys.map((k) => member(k)), edges, order: [keys], cycles: [] };
}

test('budget 300 holds at L3 for 40 members and 1 500 edges, and no pair is dropped (killer: render budget)', () => {
  const map = bigMap(40, 1500);
  const synthesis = { version: 1, overview: 'One. Two. Three. Four. Five.', coordination: Array.from({ length: 20 }, (_, i) => `note ${i}`) };
  const text = renderWorkspaceDescription({ name: 'Big', map, synthesis, budget: 300, graphLine: 'Cross-project graph: /g.json' });
  assert.ok(countLines(text) <= 300, `got ${countLines(text)} lines`);
  const inter = text.split('\n## Interconnections\n')[1].split('\n## ')[0];
  const pairs = new Set(map.edges.map((e) => `${e.from}>${e.to}`));
  assert.equal(pairs.size, 1500, 'the fixture really has 1 500 pairs');
  for (const p of pairs) {
    const [from, to] = p.split('>');
    const line = inter.split('\n').find((l) => l.startsWith(`- ${from} -> `));
    assert.ok(line && line.includes(`${to} (`), `pair ${p} dropped`);
  }
  assert.ok(text.includes('One. Two. Three.') && !text.includes('Four.'), 'L3 overview ≤ 3 sentences');
  const projects = text.split('\n## Projects\n\n')[1].split('\n\n')[0].split('\n');
  assert.equal(projects.length, 40, 'L3 keeps one line per project (L4 packing not needed)');
  assert.equal(inter.trim().split('\n').length, 40, 'L3: one line per consumer');
});

test('newlines in keys or evidence paths never add lines: the budget holds for any input', () => {
  let ov = emptyOverrides();
  for (let i = 0; i < 30; i += 1) ov = addManualEdge(ov, { from: `ghost${i}\n\n\n\n\n`, to: 'web', kind: 'other', display: 'x' }, `t${i}`).overrides;
  const map = shop();
  map.edges[0].evidence.from[0].file = 'a\nb\nc.ts';
  const text = renderWorkspaceDescription({ name: 'Shop', map, overrides: ov, budget: 60 });
  assert.ok(countLines(text) <= 60, `got ${countLines(text)} lines`);
  assert.ok(!/\n# /.test(text.slice(1)), 'no second heading');
  const roomy = renderWorkspaceDescription({ name: 'Shop', map, budget: 300 }).split('\n');
  assert.ok(roomy.some((l) => l.includes('— a b c.ts:7')) && !roomy.includes('b'), 'L0 evidence stays on one line');
  map.edges[0].evidence.from[0].file = 'src/my  web.ts';
  assert.ok(renderWorkspaceDescription({ name: 'Shop', map, budget: 300 }).includes('— src/my  web.ts:7'), 'an evidence path keeps its spacing');
});

test('a member key, an edge kind or an evidence line with newlines never adds lines (labels fall back to the key)', () => {
  const key = 'k' + '\n'.repeat(100) + '# injected';
  const map = { version: 1, members: [member(key, { name: 'dup' }), member('b', { name: 'dup' })],
    edges: [edge('b', key, 'http', 'http:GET /x', 'GET /x', { evidence: { from: [{ file: 'a.ts', line: '7\n\n# L' }], to: [] } }),
      edge('b', key, 'weird\n\n# kind', 'other:x', 'x')], order: [[key, 'b']], cycles: [] };
  for (const budget of [60, 300]) {
    const text = renderWorkspaceDescription({ name: 'W', map, budget });
    assert.ok(countLines(text) <= budget, `budget ${budget}: got ${countLines(text)} lines`);
    assert.ok(!/\n# /.test(text.slice(1)), 'no second heading');
  }
  // A corrupt map_json: a prototype-named kind is just a word, an object in `order` is no label.
  const odd = { ...map, edges: [edge('b', key, 'constructor', 'other:y', 'y')], order: [[JSON.parse('{"toString":null}'), 'b']] };
  const text = renderWorkspaceDescription({ name: 'W', map: odd, budget: 300 });
  assert.ok(text.includes(': constructor; y') && !text.includes('native code'), text);
});

test('synthesis text and names that start like markdown never open a heading, a fence or an HTML block (v3)', () => {
  const map = shop();
  map.members[0] = member('web', { name: '# Web' });
  const synthesis = { version: 1, overview: '# Billing platform', coordination: ['# Release order', '```', '<!-- hidden'], orderNotes: '## Coverage' };
  for (const budget of [60, 300]) {
    const lines = renderWorkspaceDescription({ name: 'Shop', map, synthesis, budget }).split('\n');
    const headings = lines.filter((l) => l.startsWith('#'));
    assert.deepEqual(headings.filter((h) => !/^(# Workspace: Shop|## (Overview|Projects|Interconnections|Change-coordination notes|Suggested change order|Coverage))$/.test(h)), [], `budget ${budget}`);
    assert.equal(headings.filter((h) => h === '## Coverage').length, 0, 'orderNotes never fakes a section');
    assert.ok(!lines.some((l) => /^(- |\d+\. )?(#|```|~~~|<)/.test(l) && !headings.includes(l)), `budget ${budget}: a list item opens a block`);
  }
  assert.ok(renderWorkspaceDescription({ name: 'Shop', map, synthesis, budget: 300 }).includes('\\# Billing platform'), 'the text stays, escaped');
  assert.ok(renderWorkspaceDescription({ name: 'Shop', map: null, synthesis, budget: 300 }).split('\n').includes('\\# Billing platform'), 'the null-map skeleton too');
});

test('an escaped tag, a tag glued to a bare URL and a note that starts with inline code stay text (v6)', () => {
  const map = shop();
  map.members[0] = member('web', { role: 'A drop-in \\<textarea> replacement' });
  map.edges[0] = { ...map.edges[0], display: 'GET https://api.acme.io/users/<id>', evidence: { from: [{ file: 'https://x.io/a', line: '<textarea>' }], to: [] } };
  const synthesis = { version: 1, overview: 'Escaped \\\\<style> and www.x.io<textarea> stay text.',
    coordination: ['`shared-lib` must release before `web`.', '```js', 'see https://x.io/search/<title> b'], orderNotes: '' };
  const text = renderWorkspaceDescription({ name: 'Shop', map, synthesis, budget: 300 });
  // An even run of backslashes (none included) before a tag opener leaves the tag live; the page sanitizer then drops
  // every later section with it. A bare URL swallows a backslash, so inside one the opener is an entity.
  assert.equal(/(^|[^\\])(\\\\)*<[A-Za-z!?/]/m.test(text), false, text);
  const lines = text.split('\n');
  assert.ok(lines.includes('- web (`web`): repo: "A drop-in \\<textarea> replacement"'), 'an escaped tag gains no second backslash');
  assert.ok(text.includes('Escaped \\\\\\<style> and www.x.io&lt;textarea> stay text.'));
  assert.ok(lines.some((l) => l.includes('GET https://api.acme.io/users/&lt;id>')));
  assert.equal(/(?:https?:\/\/|www\.)\S*\\</i.test(text), false, 'inside a bare URL a backslash is a URL character, never an escape (the evidence line too)');
  assert.ok(lines.includes('- see https://x.io/search/&lt;title> b'));
  assert.ok(lines.includes('- `shared-lib` must release before `web`.'), 'a single backtick opens no fence: the code spans stay paired');
  assert.ok(lines.includes('- \\```js'), 'three backticks still open a fence and are escaped');
});

test('budget below L3 still holds via L4 packing (budget 60, 120 members)', () => {
  const map = bigMap(120, 3000);
  const text = renderWorkspaceDescription({ name: 'Huge', map, budget: 60 });
  assert.ok(countLines(text) <= 60, `got ${countLines(text)} lines`);
  for (const m of map.members) assert.ok(text.includes(`\`${m.key}\``), `project ${m.key} dropped`);
});

test('a note, name or overview shaped like a rule, a list or a link definition stays text; object-valued fields never throw (v4)', () => {
  const map = shop();
  map.members[0] = member('web', { name: '1. Web' });
  const synthesis = { version: 1, overview: '[x]: https://example.test', coordination: ['---', '--', '- -', '* * *', '+ plus', '-5% latency', '3.0 API', '| a | b |'], orderNotes: '___' };
  const lines = renderWorkspaceDescription({ name: 'Shop', map, synthesis, budget: 300 }).split('\n');
  for (const want of ['\\[x]: https://example.test', '- \\---', '- \\--', '- \\- -', '- \\* * *', '- \\+ plus', '\\___',
    '- -5% latency', '- 3.0 API', '- | a | b |']) assert.ok(lines.includes(want), want); // the last three: no block start, left as written
  assert.ok(lines.some((l) => l.startsWith('- 1\\. Web (`web`)')), 'a numbered name opens no nested list');
  const odd = { ...map, edges: [JSON.parse('{"id":"x_000000000009","from":"web","to":"billing-api","kind":"http","display":{"toString":null},"evidence":{"from":[{"file":{"toString":null},"line":7}]}}')] };
  assert.doesNotThrow(() => renderWorkspaceDescription({ name: 'Shop', map: odd, budget: 300 }));
});

test('a tag written mid-line in any field is escaped: the page sanitizer never drops later sections with it (probe C, C30)', () => {
  const map = shop();
  map.members[0] = member('web', { role: 'SPA with a <noscript> fallback' });
  map.edges[0] = { ...map.edges[0], display: 'GET /users/<id>', evidence: { from: [{ file: 'src/<style>.ts', line: 7, match: 'x' }], to: [] } };
  const synthesis = { version: 1, overview: 'Vue SFCs hold <template>, <script setup> and <style> blocks; a < b stays.',
    coordination: ['web sets the page <title> from billing data.', 'Keep the <!-- build marker.', '[ ] ship billing first'], orderNotes: '[a\\]b]: https://example.test' };
  for (const budget of [60, 300]) {
    const text = renderWorkspaceDescription({ name: 'Shop <textarea>', map, synthesis, budget, graphLine: 'Cross-project graph: /g.json — graphify query "<question>"' });
    const body = text.split('\n').slice(0, -1).join('\n'); // the graph line is code-written and kept as is
    assert.equal(/(^|[^\\])<[A-Za-z!?/]/m.test(body), false, `budget ${budget}: an unescaped tag opener`);
    assert.ok(body.includes('a < b stays'), 'a lone < stays as written');
    assert.ok(text.endsWith('graphify query "<question>"'));
  }
  const lines = renderWorkspaceDescription({ name: 'Shop', map, synthesis, budget: 300 }).split('\n');
  assert.ok(lines.includes('\\[a\\]b]: https://example.test'), 'a link definition with an escaped bracket stays text');
  assert.ok(lines.some((l) => l.includes('GET /users/\\<id>')));
  assert.ok(lines.includes('- \\[ ] ship billing first'), 'a task-list box stays text');
});
