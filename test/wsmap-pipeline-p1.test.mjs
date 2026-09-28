// test/wsmap-pipeline-p1.test.mjs — the P1 modules chained the way the v3 scan will chain them:
// extract → survey (hand-written) → catalog → usage (confirm every candidate) → join → render,
// every agent document passing the checker CLI; then a re-scan after a code move (wsmap P1).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { extractWorkspace, surveyBrief } from '../src/core/workspace-map/extract.mjs';
import identity from '../src/core/workspace-map/detectors/identity.mjs';
import npm from '../src/core/workspace-map/detectors/pkg-npm.mjs';
const P1_DETECTORS = Object.freeze([identity, npm]); // pinned: P3/P4 grow DETECTORS
import { buildCatalog, usageBriefs } from '../src/core/workspace-map/catalog.mjs';
import { joinMap, synthBrief } from '../src/core/workspace-map/join.mjs';
import { checkerCommand, main as checkCli } from '../src/core/workspace-map/check-cli.mjs';
import { renderWorkspaceDescription, countLines } from '../src/shared/workspace-map/render.mjs';
import { emptyOverrides, setEdgeState, effectiveEdges } from '../src/shared/workspace-map/overrides.mjs';
import { mapSummary } from '../src/shared/workspace-map/summary.mjs';
import { scanDescriptionBudget } from '../src/shared/workspace-size.mjs';
import { makeRepos, git } from './helpers/wsmap-p1-repos.mjs';

const json = (o) => JSON.stringify(o, null, 2) + '\n';
const ws = await makeRepos({
  'shared-lib': { 'package.json': json({ name: '@acme/shared', description: 'Shared helpers' }) },
  'billing-api': {
    'package.json': json({ name: '@acme/billing', dependencies: { '@acme/shared': '1.0.0' } }),
    'src/routes.ts': "import { Router } from 'express';\nexport const r = Router();\nr.get('/invoices/:id', getInvoice);\n",
  },
  web: {
    'package.json': json({ name: '@acme/web', dependencies: { '@acme/billing': '1.0.0' } }),
    'src/api.ts': "export const invoice = (id) => fetch('/api/invoices/' + id);\n",
  },
});
after(() => ws.cleanup());
const dirOf = Object.fromEntries(ws.members.map((m) => [m.key, m.dir]));
const out = join(ws.root, 'pipeline');
await mkdir(out, { recursive: true });

async function checked(kind, name, doc, ref) {
  const file = join(out, name);
  await writeFile(file, JSON.stringify(doc));
  const lines = [];
  const code = await checkCli([kind, file, `--${{ survey: 'extract', usage: 'catalog', synthesis: 'map' }[kind]}`, ref], { print: (l) => lines.push(l) });
  assert.deepEqual([code, lines], [0, ['OK']], `${name} must pass its checker`);
}

async function scan(routesFile) {
  const extract = await extractWorkspace({ name: 'Shop', members: ws.members, detectors: P1_DETECTORS });
  const extractPath = join(out, 'extract.json');
  await writeFile(extractPath, JSON.stringify(extract));
  const brief = surveyBrief(extract, { extractPath, checkerCmd: checkerCommand('survey', { ref: extractPath }) });
  assert.match(brief.split('\n')[2], /^<!-- worca:check=".+" survey "<OUT>" --extract ".+extract\.json" -->$/);
  const survey = { version: 1, members: {} };
  for (const [key, m] of Object.entries(extract.members)) {
    survey.members[key] = m.needs.length ? { status: 'investigated', role: `Role of ${key}`, provides: [], consumes: [] } : { status: 'skipped' };
  }
  survey.members['billing-api'].provides = [{ kind: 'http', key: 'GET /invoices/:id', file: routesFile, line: 3, match: "r.get('/invoices/:id'" }];
  await checked('survey', 'survey.json', survey, extractPath);
  const catalog = await buildCatalog({ extract, survey });
  const catalogPath = join(out, 'catalog.json');
  await writeFile(catalogPath, JSON.stringify(catalog));
  const briefs = usageBriefs(catalog, { catalogPath, checkerCmd: checkerCommand('usage', { ref: catalogPath }) });
  assert.equal(Object.keys(briefs.files).length, 3);
  const usage = { version: 1, members: {} };
  for (const key of Object.keys(catalog.members)) {
    usage.members[key] = { status: 'investigated', uses: catalog.candidates[key].map(({ entry, file, line, match }) => ({ entry, file, line, match })), rejected: [], other: [] };
  }
  await checked('usage', 'usage.json', usage, catalogPath);
  const map = await joinMap({ catalog, usage, runId: 'run-1' });
  const mapPath = join(out, 'workspace-map.json');
  await writeFile(mapPath, JSON.stringify(map));
  assert.match(synthBrief(map, { mapPath, checkerCmd: checkerCommand('synthesis', { ref: mapPath }) }), /^# Workspace synthesis brief\n/);
  const synthesis = { version: 1, overview: 'A shop of three projects.', roles: {}, coordination: ['Release shared-lib first.'], orderNotes: '' };
  await checked('synthesis', 'synthesis.json', synthesis, mapPath);
  return { map, synthesis };
}

test('end to end: static exact edges, a candidate confirmed into a verified edge, order, description', async () => {
  const { map, synthesis } = await scan('src/routes.ts');
  assert.deepEqual(map.edges.map((e) => [e.from, e.to, e.kind, e.confidence]), [
    ['billing-api', 'shared-lib', 'pkg', 'exact'],
    ['web', 'billing-api', 'http', 'verified'],
    ['web', 'billing-api', 'pkg', 'exact'],
  ]);
  assert.deepEqual(map.order, [['shared-lib'], ['billing-api'], ['web']]);
  const text = renderWorkspaceDescription({ name: 'Shop', map, synthesis, budget: scanDescriptionBudget(3) });
  assert.ok(countLines(text) <= 300);
  assert.ok(text.includes("- web -> billing-api: REST API; GET /invoices/:id — src/api.ts:1"), text);
  assert.ok(text.includes('- shared-lib (`shared-lib`): manifest: "Shared helpers"'), 'the package.json description, quoted with its source (M1)');
  assert.ok(text.includes('1. shared-lib\n2. billing-api\n3. web'));
});

test('re-scan after a code move: same edge ids, overrides still apply, a vanished confirmed edge is missing (killer: overrides survive a re-scan)', async () => {
  const first = await scan('src/routes.ts');
  const http = first.map.edges.find((e) => e.kind === 'http');
  const pkg = first.map.edges.find((e) => e.from === 'web' && e.kind === 'pkg');
  let ov = setEdgeState(emptyOverrides(), http, 'confirmed', 't1');
  ov = setEdgeState(ov, pkg, 'confirmed', 't1');
  // Move both ends of the http edge, and drop web's package dependency.
  await mkdir(join(dirOf['billing-api'], 'src', 'http'), { recursive: true });
  await rename(join(dirOf['billing-api'], 'src', 'routes.ts'), join(dirOf['billing-api'], 'src', 'http', 'routes.ts'));
  await mkdir(join(dirOf.web, 'src', 'client'), { recursive: true });
  await rename(join(dirOf.web, 'src', 'api.ts'), join(dirOf.web, 'src', 'client', 'api.ts'));
  await writeFile(join(dirOf.web, 'package.json'), json({ name: '@acme/web' }));
  for (const d of [dirOf['billing-api'], dirOf.web]) { git(d, 'add', '-A'); git(d, 'commit', '-q', '-m', 'move'); }
  const second = await scan('src/http/routes.ts');
  const moved = second.map.edges.find((e) => e.kind === 'http');
  assert.equal(moved.id, http.id, 'the edge id hashes (from, to, kind, norm), never a file');
  assert.deepEqual(moved.evidence.from[0].file, 'src/client/api.ts');
  const eff = effectiveEdges(second.map, ov);
  assert.equal(eff.find((e) => e.id === http.id).state, 'confirmed');
  assert.equal(eff.find((e) => e.id === pkg.id).state, 'missing');
  assert.deepEqual(mapSummary(second.map, ov), { scannedAt: second.map.scannedAt, members: 3, edges: 2, gaps: 0,
    confirmed: 1, rejected: 0, manual: 0, missing: 1, stale: 0, byKind: { http: 1, pkg: 1 } });
  const text = renderWorkspaceDescription({ name: 'Shop', map: second.map, synthesis: second.synthesis, overrides: ov, budget: 300 });
  assert.ok(text.includes('(confirmed)'));
  assert.ok(!text.includes('build dep; @acme/billing'), 'a missing edge never reaches the description');
});

test('secrets never leave the checkout: no raw secret in extract, catalog, briefs, map or description (killer: redaction)', async () => {
  const sec = await makeRepos({
    'billing-db': { 'migrations/001.sql': 'CREATE DATABASE billing;\n' },
    'billing-api': { 'src/routes.ts': "r.get('/invoices/:id', getInvoice);\n" },
    web: {
      '.env': 'DATABASE_URL=postgres://app:s3cr3t@db:5432/billing\nAPI_TOKEN=abc123\nBILLING_URL=http://svc:pa55w0rd@billing-api:8080/invoices\nREPLICA_URL=postgres://ro:s3cr3t@replica:5432/billing\n',
      // The candidate scan skips guardrail-protected files (.env*), so the URL a candidate is found
      // in sits in a source file too.
      'src/config.ts': "export const BILLING_URL = 'http://svc:pa55w0rd@billing-api:8080/invoices';\n",
    },
  });
  after(() => sec.cleanup());
  // A test-local stand-in for P3's config-env detector: it hands extract RAW secret-bearing text.
  const envDb = {
    id: 'env-db',
    claims: (rel) => rel === '.env',
    detect(file) {
      const lines = file.text.split(/\r?\n/);
      const facts = [];
      const unresolved = [];
      lines.forEach((line, i) => {
        const db = /^DATABASE_URL=(\S+)$/.exec(line);
        if (db) facts.push({ kind: 'db', dir: 'consumes', key: `db:${db[1].split('/').pop()}`, file: '.env', line: i + 1, match: line, detail: line, target: db[1] });
        const b = /^BILLING_URL=(\S+)$/.exec(line);
        if (b) facts.push({ kind: 'http', dir: 'consumes', key: `GET ${b[1]}`, file: '.env', line: i + 1, match: line });
        if (line.startsWith('API_TOKEN=')) unresolved.push({ kind: 'other', raw: line, file: '.env', line: i + 1, reason: 'config' });
      });
      return { facts, unresolved, aliases: [{ value: 'redis://:pa55w0rd@cache', source: 'env' }] };
    },
  };
  // A stand-in manifest detector whose role text carries a secret.
  const roleDet = { id: 'role-det', claims: (rel) => rel === 'migrations/001.sql', detect: () => ({ role: { text: 'Rotates API_TOKEN=abc123 nightly', source: 'manifest' } }) };
  const extract = await extractWorkspace({ name: 'Sec', members: sec.members, detectors: [...P1_DETECTORS, envDb, roleDet] });
  const survey = { version: 1, members: {
    'billing-db': { status: 'investigated', role: 'Billing database', provides: [{ kind: 'db', key: 'db:billing', file: 'migrations/001.sql', line: 1, match: 'CREATE DATABASE billing' }], consumes: [] },
    'billing-api': { status: 'investigated', provides: [{ kind: 'http', key: 'GET /invoices/:id', file: 'src/routes.ts', line: 1, match: "r.get('/invoices/:id'" }], consumes: [] },
    // An agent-written member key and (below) entry id echoed by the checker's messages: persisted redacted.
    'API_TOKEN=abc123': { status: 'skipped' },
    web: { status: 'investigated', role: 'Uses API_TOKEN=abc123', aliases: ['api_token=abc123'], provides: [], consumes: [
      { kind: 'db', key: 'db:billing', file: '.env', line: 4, match: 'postgres://ro:s3cr3t@replica:5432/billing' },
      { kind: 'other', key: 'token', file: '.env', line: 2, match: 'abc123' },
      // a cited file that does not exist is rejected — and its agent-written path is stored redacted
      { kind: 'db', key: 'db:billing', file: 'cfg/API_TOKEN=abc123.env', line: 1, match: 'x' },
    ] },
  } };
  const catalog = await buildCatalog({ extract, survey });
  const briefs = usageBriefs(catalog, { catalogPath: '/p/catalog.json', checkerCmd: 'CHECK' });
  const usage = { version: 1, members: Object.fromEntries(Object.keys(catalog.members).map((k) => [k, { status: 'investigated',
    uses: [...catalog.candidates[k].map(({ entry, file, line, match }) => ({ entry, file, line, match })), { entry: 'token=abc123', file: 'src/config.ts', line: 1, match: 'x' }], rejected: [],
    other: k === 'web' ? [{ to: 'billing-db', kind: 'other', key: 'read replica', label: 'replica', file: '.env', line: 4, match: 'REPLICA_URL=postgres://ro:s3cr3t@replica' }] : [] }])) };
  const map = await joinMap({ catalog, usage });
  const synthesis = { version: 1, overview: 'Web reads DATABASE_URL=postgres://app:s3cr3t@db:5432/billing.', roles: {}, coordination: ['Rotate API_TOKEN=abc123 first.'], orderNotes: '' };
  const text = renderWorkspaceDescription({ name: 'Sec', map, synthesis, budget: 300 });
  const everything = [JSON.stringify(extract), surveyBrief(extract, { extractPath: '/p/extract.json', checkerCmd: 'CHECK' }), JSON.stringify(catalog),
    briefs.index, ...Object.values(briefs.files), JSON.stringify(map), synthBrief(map, { mapPath: '/p/m.json', checkerCmd: 'CHECK' }), text].join('\n');
  for (const secret of ['s3cr3t', 'abc123', 'pa55w0rd']) assert.ok(!everything.includes(secret), `${secret} leaked`);
  const db = map.edges.find((e) => e.from === 'web' && e.to === 'billing-db');
  // billing-db's provide is survey-only: `exact` needs static facts on both ends (spec §5.7), so the edge is verified.
  assert.deepEqual([db.kind, db.norm, db.confidence], ['db', 'db:billing', 'verified'], 'the db fact still verifies and the edge forms');
  assert.deepEqual(db.evidence.from.map((x) => x.line), [1, 4], 'static and verified survey evidence, both redacted');
  assert.ok(db.evidence.from.every((x) => x.match.includes('postgres://***@')));
  assert.ok(map.edges.some((e) => e.from === 'web' && e.kind === 'other' && e.evidence.from[0].match === 'REPLICA_URL=postgres://***@replica'));
  assert.ok(map.edges.some((e) => e.from === 'web' && e.to === 'billing-api' && e.kind === 'http' && e.confidence === 'verified'), 'the redacted candidate still verifies');
  assert.ok(text.includes('postgres://***@db:5432/billing'), 'the description keeps the redacted, recognisable text');
});
