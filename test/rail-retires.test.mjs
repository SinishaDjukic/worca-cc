// test/rail-retires.test.mjs — the old parts Stillhet's later slices retire (ui/public/design-system/rail-retires.json) only
// lose references: a listed part's count (in parts.json, and as an import or href in ui/public) never rises above
// test/fixtures/rail-retires-baseline.json, the same freeze ratchet as rail-gate. The list starts empty in slice 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUB = join(ROOT, 'ui/public');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/** Problems of a retires list ([] = valid): { version: 1, parts: [{ part, replacedBy, slice }] }, each part a file under ui/public. */
function schemaProblems(list, exists = (p) => existsSync(join(PUB, p))) {
  const out = [];
  if (!list || list.version !== 1 || !Array.isArray(list.parts)) return ['want { version: 1, parts: [] }'];
  for (const r of list.parts) {
    if (!r || typeof r.part !== 'string' || typeof r.replacedBy !== 'string' || !Number.isInteger(r.slice)) { out.push(`bad row ${JSON.stringify(r)}`); continue; }
    if (!exists(r.part)) out.push(`${r.part}: no such part under ui/public`);
  }
  return out;
}

/** How often each listed part is referenced: its parts.json entry, and every import or href naming it in ui/public. */
function refCounts(list, { manifest = readJson('ui/public/parts.json'), texts = sources() } = {}) {
  const counts = {};
  for (const { part } of list.parts) {
    const name = part.split('/').pop().replace(/[.]/g, '\\.');
    const re = new RegExp(`(?:from\\s+|import\\(\\s*|href=)['"\`][^'"\`]*${name}['"\`]`, 'g');
    counts[part] = [...(manifest.css || []), ...(manifest.html || [])].filter((p) => p === part).length
      + texts.reduce((n, t) => n + (t.match(re) || []).length, 0);
  }
  return counts;
}
function sources(dir = PUB, out = []) {
  for (const e of readdirSync(dir)) { const p = join(dir, e); if (statSync(p).isDirectory()) sources(p, out); else if (/\.(mjs|js|html)$/.test(e)) out.push(readFileSync(p, 'utf8')); }
  return out;
}
const grew = (counts, baseline) => Object.keys(counts).filter((p) => counts[p] > (baseline[p] ?? 0));

test('the retires list is valid, and no listed part gained a reference', () => {
  const list = readJson('ui/public/design-system/rail-retires.json');
  assert.deepEqual(schemaProblems(list), []);
  assert.deepEqual(grew(refCounts(list), readJson('test/fixtures/rail-retires-baseline.json')), []);
});

test('the ratchet: a grown count fails, a shrunk one passes; a bad row or a missing part fails the schema', () => {
  const list = { version: 1, parts: [{ part: 'runs/old.css', replacedBy: 'runs/rail-run-card.css', slice: 4 }] };
  const manifest = { css: ['runs/old.css'], html: [] };
  const counts = refCounts(list, { manifest, texts: ['<link href="/runs/old.css">', "import x from './runs/old.css';"] });
  assert.deepEqual(counts, { 'runs/old.css': 3 });
  assert.deepEqual(grew(counts, { 'runs/old.css': 2 }), ['runs/old.css'], 'grew: fails');
  assert.deepEqual(grew(counts, { 'runs/old.css': 3 }), []);
  assert.deepEqual(grew({ 'runs/old.css': 1 }, { 'runs/old.css': 3 }), [], 'shrank: passes');
  assert.deepEqual(schemaProblems(list, () => true), []);
  assert.deepEqual(schemaProblems(list, () => false), ['runs/old.css: no such part under ui/public']);
  assert.deepEqual(schemaProblems({ version: 2, parts: [] }), ['want { version: 1, parts: [] }']);
  assert.match(schemaProblems({ version: 1, parts: [{ part: 'x.css' }] })[0], /bad row/);
});
