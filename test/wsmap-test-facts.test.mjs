// test/wsmap-test-facts.test.mjs — spec §5.1 (M11): test facts never create edges; they are counted. Join
// verifies every use and relation the usage pass cites, then drops the ones whose file is test code
// (stats.testFacts); a citation that does not verify is rejected (stats.factsRejected) and is never read as
// a test fact. The usage brief and the usage mapper's steps 2–3 tell the investigators never to cite tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { joinMap } from '../src/core/workspace-map/join.mjs';
import { usageBriefs } from '../src/core/workspace-map/catalog.mjs';
import { entryId } from '../src/shared/workspace-map/ids.mjs';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';

const ws = await makeWorkspace({
  billing: { 'src/routes.ts': "router.get('/api/invoices/:id', h);\nrouter.get('/api/invoices', h);\n" },
  web: {
    'src/client.ts': "export const list = () => request(BASE + '/api/invoices');\n",
    'src/export.ts': "export const archive = 's3://ledger-archive';\n",
    'test/e2e/billing.test.ts': "it('x', async () => { await fetch('http://billing:8080/api/invoices/42'); });\n",
    'src/__tests__/export.spec.ts': "const bucket = 's3://billing-exports';\n",
  },
});
after(() => ws.cleanup());
const dir = Object.fromEntries(ws.members.map((m) => [m.key, m.dir]));
const E = (norm, display, line) => ({ id: entryId('billing', 'http', norm), member: 'billing', kind: 'http', norm, display, terms: [],
  evidence: [{ file: 'src/routes.ts', line, match: 'router.get' }], sources: ['static'], confidence: 'exact' });
const GET = E('http:GET /api/invoices/{}', 'GET /api/invoices/:id', 1);
const LIST = E('http:GET /api/invoices', 'GET /api/invoices', 2);
const member = (key) => ({ key, name: key, dir: dir[key], role: null, roleSource: null, aliases: [key], stack: ['node'],
  coverage: { level: 'rich', files: 2, scannedFiles: 2, truncated: false, detectors: {} }, graph: null, surveyStatus: 'skipped',
  unresolved: [], facts: { static: 2, llm: 0 }, candidatesTruncated: false });
const catalog = { version: 1, workspace: { name: 'Shop' }, members: { billing: member('billing'), web: member('web') },
  entries: [GET, LIST], aliasIndex: { billing: 'billing', web: 'web' }, ambiguousAliases: {}, consumes: { billing: [], web: [] },
  candidates: { billing: [], web: [] }, rejected: [], briefs: {}, errors: [] };
const usage = (uses, other) => ({ version: 1, members: {
  billing: { status: 'investigated', uses: [], rejected: [], other: [] },
  web: { status: 'investigated', uses, rejected: [], other } } });
const testUse = { entry: GET.id, file: 'test/e2e/billing.test.ts', line: 1, match: "fetch('http://billing:8080/api/invoices/42')" };
const prodUse = { entry: LIST.id, file: 'src/client.ts', line: 1, match: "request(BASE + '/api/invoices')" };
const testRel = { to: 'billing', kind: 'other', key: 'export bucket', label: 'S3 exports', file: 'src/__tests__/export.spec.ts', line: 1, match: "'s3://billing-exports'" };
const prodRel = { to: 'billing', kind: 'other', key: 'ledger archive', label: 'S3 archive', file: 'src/export.ts', line: 1, match: "'s3://ledger-archive'" };
/** Each edge by the file its consumer-side evidence cites (an `other` edge's key or id format is not this test's concern). */
const edgesOf = (map) => map.edges.map((e) => `${e.from} -> ${e.to} ${e.kind} ${e.confidence} ${e.evidence.from.map((x) => x.file).join(',')}`).sort();

test('a use and a relation the usage pass cites from test code make no edge and are counted as test facts', async () => {
  const map = await joinMap({ catalog, usage: usage([testUse, prodUse], [testRel, prodRel]) });
  assert.deepEqual(map.errors, []);
  assert.deepEqual(edgesOf(map), [
    'web -> billing http verified src/client.ts',
    'web -> billing other inferred src/export.ts',
  ], 'only the production citations make edges');
  assert.deepEqual([map.stats.testFacts, map.stats.factsRejected], [2, 0], 'counted as test facts, never as rejections');
});

test('test-only citations alone make no edge at all', async () => {
  const map = await joinMap({ catalog, usage: usage([testUse], [testRel]) });
  assert.deepEqual([map.edges, map.stats.testFacts, map.stats.factsRejected], [[], 2, 0]);
});

test('a citation that does not verify is rejected, never read as a test fact, and never breaks the join', async () => {
  const broken = { entry: GET.id, file: 'test/e2e/billing.test.ts', line: 1, match: 'text on no line of the file' };
  const map = await joinMap({ catalog, usage: usage([broken, prodUse], [testRel, { ...prodRel, match: 'nowhere either' }]) });
  assert.deepEqual(map.errors, [], 'a rejected citation carries no fact: the test-path check must not read one');
  assert.deepEqual(edgesOf(map), ['web -> billing http verified src/client.ts']);
  assert.deepEqual([map.stats.factsRejected, map.stats.testFacts], [2, 1]);
});

test('the usage brief and the usage mapper body tell steps 2 and 3 never to cite test code', () => {
  const { files } = usageBriefs(catalog, { catalogPath: '/p/catalog.json', checkerCmd: 'CHECK' });
  for (const [key, text] of Object.entries(files)) {
    const lines = text.split('\n');
    for (const step of ['2', '3']) {
      const line = lines.find((l) => l.startsWith(`${step}. `));
      assert.ok(line && /never cite test code/i.test(line), `${key}: brief step ${step}`);
    }
  }
  const body = readFileSync(new URL('../agents/worca-cc-workspace-usage-mapper.md', import.meta.url), 'utf8').split('\n');
  for (const step of ['2', '3']) {
    const line = body.find((l) => l.startsWith(`   > ${step}. `));
    assert.ok(line && /never cite test code/i.test(line), `usage mapper investigator step ${step}`);
  }
});
