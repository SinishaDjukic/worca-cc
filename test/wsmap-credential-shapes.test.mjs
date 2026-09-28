// test/wsmap-credential-shapes.test.mjs — credential shapes the first redactor missed (spec D21):
// a token used as a URL's user name (a classic 40-hex GitHub PAT, an Azure DevOps PAT, a Sentry DSN
// key, a NATS token — any length for nats://), a JWT anywhere, credential query parameters whose name
// holds no secret word (`jwt`, `session`, `sid`, `ticket`, Azure API Management's `subscription-key`),
// and AWS STS key ids (`ASIA…`). They never
// reach extract, the catalog, a brief, the map or the stored workspace (finalize → map_json and the
// description), while every edge they sit on still forms. A candidate's text, an HTTP call's cited
// URL and route key, and a dynamic URL's text stop before the query (a parameter of ANY name may carry
// a credential; templated, concatenated and f-string URLs included) — and before a `#`
// fragment, never before Ruby's `#{…}`. Every new rule stays linear on 1 MiB adversarial input.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';
import { redactSecrets, redactLines } from '../src/shared/workspace-map/redact.mjs';
import { extractWorkspace, surveyBrief } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog, usageBriefs } from '../src/core/workspace-map/catalog.mjs';
import { joinMap, synthBrief } from '../src/core/workspace-map/join.mjs';
import { projectKey } from '../src/core/store.mjs';
import { workspaceKey, readWorkspace, readWorkspaceMap } from '../src/core/workspaces.mjs';
import { finalizeWorkspaceScan, WORKSPACE_MAP_FILE } from '../src/core/workspace-scan-run.mjs';
import httpClients from '../src/core/workspace-map/detectors/http-clients.mjs';
// Read through the namespace: before cutQuery exists the file still loads and each case fails on its own.
import * as keys from '../src/shared/workspace-map/keys.mjs';

const { normKey } = keys;

useTempHome(after);

const PAT40 = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const AZPAT52 = 'zq2azure3pat4abcdefghijklmnopqrstuvwxyz234567abcdefg';
const AZPAT84 = '7Kq2Lm9Np4Rs8Tv3Wx6Yz1Ab5Cd0Ef7Gh2Ij9Kl4Mn8Op3Qr6St1Uv5Wx0YzAZDO9Ab3Cd7Ef2Gh6Ij1Kl5M';
const SENTRY = 'e3b0c44298fc1c149afbf4c8996fb924';
const NATS_LONG = 's3cr3tT0kenValue123';
const NATS_SHORT = 'ZqNatsTok';
const JWT_A = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ3ZWItYSJ9.ZqJwtSigA1b2c3d4e5f6g7h8';
const JWT_B = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ3ZWItYiJ9.ZqJwtSigB1b2c3d4e5f6g7h8';
const SESS = 'ZqSess10nT0k3nAbc';
const ASIA = 'ASIAZQ9EXAMPLEKEY7AB';
const APIM = 'ZqApimKey0123456789abcdef';
const APIM_ENV = 'd4c3b2a1f0e9d8c7b6a5948372615049';
const APIM_COMPOSE = '9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b';
const HMAC = 'ZqHmacSig0123';
const TICKET = 'ZqTicket0123';
const XSIG = 'ZqCandSig0123';
const SID = 'ZqSid0123abc';
const TPL = 'ZqTplHmac0123';

const ROWS = [
  // a token as a URL's user name (≥ 16 chars mixing letters and digits) → ***@
  [`git+https://${PAT40}@github.com/acme/private-lib.git`, 'git+https://***@github.com/acme/private-lib.git'],
  [`url = https://${AZPAT52}@dev.azure.com/acme/shop/_git/private-lib`, 'url = https://***@dev.azure.com/acme/shop/_git/private-lib'],
  [`https://${AZPAT84}@dev.azure.com/org/p/_git/r`, 'https://***@dev.azure.com/org/p/_git/r'],
  [`SENTRY_DSN=https://${SENTRY}@o123456.ingest.sentry.io/1234567`, 'SENTRY_DSN=https://***@o123456.ingest.sentry.io/1234567'],
  [`nats://${NATS_LONG}@nats:4222`, 'nats://***@nats:4222'],
  // a nats:// user name IS its token, however short: letters only, or a few chars
  [`NATS_URL: nats://${NATS_SHORT}@nats:4222`, 'NATS_URL: nats://***@nats:4222'],
  ["connect({ servers: 'nats://tok3n@nats' })", "connect({ servers: 'nats://***@nats' })"],
  // …right after an AWS key id too: one pass masks both, so a second pass changes nothing
  ['ASIAQ3EXAMPLEKEY7ABCnats://tok3n@nats:4222', 'ASIA***nats://***@nats:4222'],
  // a user name that is a name stays: git@, deploy@, gitlab-ci-token@, oauth2@, a short one on any other scheme
  ['git@github.com:acme/x.git', 'git@github.com:acme/x.git'],
  ['ssh://git@github.com/acme/x.git', 'ssh://git@github.com/acme/x.git'],
  ['ssh://deploy@build.internal/srv', 'ssh://deploy@build.internal/srv'],
  ['https://gitlab-ci-token@gitlab.com/acme/x.git', 'https://gitlab-ci-token@gitlab.com/acme/x.git'],
  ['https://oauth2@gitlab.com/acme/x.git', 'https://oauth2@gitlab.com/acme/x.git'],
  ['amqp://guest@rabbitmq:5672/', 'amqp://guest@rabbitmq:5672/'],
  // a JWT anywhere; query parameters whose name holds no secret word
  [`http://reports:8080/api/reports/latest?jwt=${JWT_A}`, 'http://reports:8080/api/reports/latest?jwt=***'],
  [`/embed/dashboard/${JWT_B}#bordered=true`, '/embed/dashboard/eyJ***#bordered=true'],
  [`/api/reports/weekly?session=${SESS}&x=1`, '/api/reports/weekly?session=***&x=1'],
  ['/r?sessionId=Zq9a&session_id=Zq9b&sid=Zq9c&ticket=ST-1-Zq9d&page=2', '/r?sessionId=***&session_id=***&sid=***&ticket=***&page=2'],
  // an Azure API Management key in a URL (in `.env`, compose or k8s only the central redaction stands between it and the map)
  [`https://apim.example.net/orders?subscription-key=${APIM_ENV}`, 'https://apim.example.net/orders?subscription-key=***'],
  // AWS STS key ids like access key ids
  ['AWS_ACCESS_KEY_ID_TMP ASIAQ3EXAMPLEKEY7ABC', 'AWS_ACCESS_KEY_ID_TMP ASIA***'],
  [`?X-Amz-Credential=${ASIA}/20260101/us-east-1/s3/aws4_request`, '?X-Amz-Credential=ASIA***/20260101/us-east-1/s3/aws4_request'],
];

test('redactSecrets: a token as a URL user name, a nats:// token of any length, JWTs, jwt/session/sid/ticket/subscription-key parameters, ASIA ids', () => {
  assert.equal(AZPAT84.length, 84);
  for (const [input, want] of ROWS) assert.equal(redactSecrets(input), want, input);
});

test('the new rules are idempotent, per string and per line', () => {
  for (const [input] of ROWS) {
    const once = redactSecrets(input);
    assert.equal(redactSecrets(once), once, input);
    assert.deepEqual(redactLines([input]), [once], input);
  }
});

test('the new rules stay linear on 1 MiB adversarial input (a quadratic JWT rule took minutes on the eyJ run)', () => {
  const MiB = 1 << 20;
  const fill = (unit) => unit.repeat(Math.floor(MiB / unit.length));
  const inputs = [
    fill('eyJ'), fill(` eyJ${'a'.repeat(2044)}`), fill('eyJaaaaaaaa.eyJ'), fill(`.eyJ${'a'.repeat(2040)}.eyJaa.`),
    fill('://a1'), fill(`://${'a1'.repeat(127)}b `), fill('nats://'), fill(`nats://${'a'.repeat(255)} `),
    fill('?session='), fill('&ticket='), fill('?subscription-key='), fill('ASIA'),
  ];
  for (const s of inputs) {
    const t0 = performance.now();
    redactSecrets(s);
    redactLines([s]);
    const ms = performance.now() - t0;
    assert.ok(ms < 3000, `${JSON.stringify(s.slice(0, 16))}… (${s.length} chars) took ${Math.round(ms)} ms`);
  }
});

test('an HTTP call keeps no query value in its key, its cited URL or its dynamic-url text; a placeholder\'s `?` and a ternary stay', () => {
  const member = { key: 'm', name: 'm', dir: '/none', projectDir: '/none' };
  const files = {
    'web/a.js': [
      'export const x = () => fetch(`${BASE}/api/reports/export?hmac=ZqKeyHmac1`);',
      "export const y = () => fetch(BASE + '/api/reports/weekly?hmac=ZqKeyHmac2');",
      'export const z = () => fetch(`${a}${b}?hmac=ZqKeyHmac3`);',
      'export const w = () => fetch(on ? `${a}` : `${b}`);',
      'export const v = () => axios.get(`${API}/users/${id}#frag`);',
      "export const u = () => fetch(`${BASE}/users/${on ? 'me' : id}/orders`);",
      'export const t = (p) => axios.get(`${API}/items/${p?.id}/tags`);',
    ].join('\n') + '\n',
    'svc/a.py': "def f():\n    return requests.get(f'{BASE}/api/reports/archive?hmac=ZqKeyHmac4')\n",
    'app/c.rb': 'class C\n  def a(id) = RestClient.get("#{BASE}/invoices/#{id}?hmac=ZqKeyHmac5")\nend\n',
  };
  const ctx = { member, members: [member], files: Object.keys(files), state: {} };
  const facts = [];
  const unresolved = [];
  for (const [rel, text] of Object.entries(files)) {
    const r = httpClients.detect({ rel, text }, ctx);
    facts.push(...(r?.facts || []));
    unresolved.push(...(r?.unresolved || []));
  }
  facts.push(...(httpClients.finish(ctx)?.facts || []));
  assert.deepEqual(facts.map((f) => f.key).sort(), ['GET /api/reports/archive', 'GET /api/reports/export', 'GET /api/reports/weekly', 'GET /invoices/{id}',
    'GET /items/${p?.id}/tags', 'GET /users/${id}', "GET /users/${on ? 'me' : id}/orders"]);
  const cited = (key) => facts.find((f) => f.key === key)?.match;
  assert.equal(cited("GET /users/${on ? 'me' : id}/orders"), "${BASE}/users/${on ? 'me' : id}/orders", 'a `?` inside a placeholder starts no query');
  assert.equal(cited('GET /items/${p?.id}/tags'), '${API}/items/${p?.id}/tags');
  assert.deepEqual(unresolved.map((u) => u.raw), ['fetch(`${a}${b}', 'fetch(on ? `${a}` : `${b}`);'], 'the query goes, a ternary\'s `?` stays');
  const all = JSON.stringify({ facts, unresolved });
  assert.equal(all.includes('ZqKeyHmac'), false, all);
});

/** http-clients over in-memory files of one member (claims → detect → finish, as extract runs it). */
const detectHttp = (files) => {
  const member = { key: 'm', name: 'm', dir: '/none', projectDir: '/none' };
  const ctx = { member, members: [member], files: Object.keys(files), state: {} };
  const facts = [];
  const unresolved = [];
  for (const [rel, text] of Object.entries(files)) {
    const r = httpClients.detect({ rel, text }, ctx);
    facts.push(...(r?.facts || []));
    unresolved.push(...(r?.unresolved || []));
  }
  facts.push(...(httpClients.finish(ctx)?.facts || []));
  return { facts, unresolved };
};

test('a JS private field inside a placeholder is no fragment: the key, its norm and the cited URL keep it', () => {
  const { facts } = detectHttp({
    'web/a.js': 'export class C { #base; #tenant; orders() { return fetch(`${this.#base}/tenants/${this.#tenant}/orders`); } }\n',
    'web/b.js': 'export const b = () => fetch(`${BASE}/docs/x#section`);\n',
  });
  assert.deepEqual(facts.map((f) => [f.key, normKey('http', f.key), f.match]), [
    ['GET /tenants/${this.#tenant}/orders', 'http:GET /tenants/{}/orders', '${this.#base}/tenants/${this.#tenant}/orders'],
    ['GET /docs/x', 'http:GET /docs/x', '${BASE}/docs/x'],
  ]);
});

test('a placeholder is read whole: an optional chain, a comparison, an arrow or Kotlin\'s ?.let never starts a query (the key keeps the norm 15486564 gives)', () => {
  const { facts, unresolved } = detectHttp({
    'web/a.js': "export const a = (u) => fetch(`${API}/accounts/${u?.type === 'org' ? u.orgId : u.id}/billing?sig=ZqQ1`);\n",
    'web/b.js': "export const b = (id) => fetch(`${API}/users/${users.find((u) => u?.id === id)?.slug}/cards`);\n",
    'web/c.js': "export const c = (id) => fetch(`${API}/items/${id ? `${id}` : 'all'}/tags?sig=ZqQ2`);\n",
    'app/D.kt': 'class D { fun d(user: User?) = client.get("${api}/users/${user?.let { it.id }}/orders?token=ZqQ3") }\n',
    'web/e.js': "export const e = (o) => fetch(`${API}/orgs/${o?.id ?? 'none'}/members#top`);\n",
  });
  assert.deepEqual(facts.map((f) => [f.file, f.key]), [
    ['web/a.js', "GET /accounts/${u?.type === 'org' ? u.orgId : u.id}/billing"],
    ['web/b.js', 'GET /users/${users.find((u) => u?.id === id)?.slug}/cards'],
    ['app/D.kt', 'GET /users/${user?.let { it.id }}/orders'],
    ['web/e.js', "GET /orgs/${o?.id ?? 'none'}/members"],
  ]);
  assert.deepEqual(facts.filter((f) => f.file.endsWith('.js')).map((f) => normKey('http', f.key)),
    ['http:GET /accounts/{}/billing', 'http:GET /users/{}/cards', 'http:GET /orgs/{}/members']);
  assert.deepEqual(unresolved.map((u) => u.raw), ["fetch(`${API}/items/${id ? `${id}` : 'all'}/tags"], 'a nested template stays whole; the query goes');
  assert.equal(/ZqQ\d/.test(JSON.stringify({ facts, unresolved })), false);
});

test('cutQuery: a query or fragment outside every placeholder is cut, one in a placeholder\'s string cuts at that placeholder, a userinfo is skipped; one pass, linear on 1 MiB', () => {
  for (const [input, want] of [
    ["/accounts/${u?.type === 'org' ? u.orgId : u.id}/billing?sig=ZqC1", "/accounts/${u?.type === 'org' ? u.orgId : u.id}/billing"],
    ['${API}/users/${users.find((u) => u?.id === id)?.slug}#top', '${API}/users/${users.find((u) => u?.id === id)?.slug}'],
    ['${api}/users/${user?.let { it.id }}/orders?token=ZqC2', '${api}/users/${user?.let { it.id }}/orders'],
    ["${REPORTS}/z${q ? '?hmac=ZqC3' : ''}", '${REPORTS}/z'],
    ['"#{BASE}/invoices/#{id}?hmac=ZqC4"', '"#{BASE}/invoices/#{id}'],
    ['/users/{id?}/x?y=ZqC5', '/users/{id?}/x'],
    ['http://svc:pa?ss#1@host:8080/x?y=ZqC6', 'http://svc:pa?ss#1@host:8080/x'],
    ['?hmac=ZqC7', '?hmac='],
    ["/r${a ? 'it\\'s' : 'x'}/y?sig=ZqC9", "/r${a ? 'it\\'s' : 'x'}/y"],
    ['/plain/path', '/plain/path'],
  ]) assert.equal(keys.cutQuery?.(input), want, input);
  const MiB = 1 << 20;
  for (const unit of ['${', "{'", '{a?', '${`${', '://a:b', '#{x}']) {
    const s = unit.repeat(Math.floor(MiB / unit.length));
    const c0 = process.cpuUsage();
    keys.cutQuery(s);
    const { user, system } = process.cpuUsage(c0);
    assert.ok((user + system) / 1000 < 1000, `${JSON.stringify(unit)}: ${((user + system) / 1000).toFixed(0)} ms of CPU`);
  }
});

test('cutQuery: a URL inside the query is no userinfo; a bare {…} placeholder and a lone quoted ? stay; a truncated placeholder moves no norm', () => {
  const { facts } = detectHttp({
    'web/n.js': "export const n = () => fetch('http://reports:8080/api/reports/cb?hmac=ZqNested8&next=http://u:p@evil/y');\n",
    'web/t.js': 'export const t = (u) => fetch(`${USERS}/users/${u?.id ?? `me`}/orders`);\n',
    'web/k.js': "export const k = (s) => fetch(`${API}/k/${s || '?'}/v`);\n",
    'svc/C.cs': 'class C {\n  async Task F(U u) { var r = await _http.GetAsync($"{Base}/users/{u?.Id}/orders?x=1"); }\n}\n',
  });
  const by = (rel) => facts.find((f) => f.file === rel);
  assert.equal(JSON.stringify(facts).includes('ZqNested8'), false);
  assert.deepEqual([by('web/n.js').key, by('web/n.js').match], ['GET /api/reports/cb', 'http://reports:8080/api/reports/cb']);
  // the lexer ends this literal at the nested backtick: no query there, so no cut — never the shorter route /users
  assert.notEqual(normKey('http', by('web/t.js').key), 'http:GET /users');
  assert.equal(by('web/k.js').key, "GET /k/${s || '?'}/v");
  assert.equal(by('svc/C.cs').key, 'GET /users/{u?.Id}/orders');
  assert.equal(keys.cutQuery('/items/{id?}/tags?x=1'), '/items/{id?}/tags');
  assert.equal(keys.cutQuery("${BASE}/x${q ? '\\'?hmac=Zq' : ''}"), '${BASE}/x');
});

test('no query value reaches a cited URL, a dynamic URL text or a target (leading ?, comment, placeholder, &name=, base host)', () => {
  const { facts, unresolved } = detectHttp({
    'web/a.js': "const api = axios.create({ baseURL: 'http://reports:8080/api/reports' });\nexport const a = () => api.get('?hmac=ZqLeadQ1');\n",
    'web/b.js': "export const b = () => fetch(REPORTS /* signed */ + '/api/reports/y?hmac=ZqComment2');\n",
    'web/c.js': "export const c = (q) => fetch(`${REPORTS}/api/reports/z${q ? '?hmac=ZqInPh3' : ''}`);\n",
    'web/d.js': "export const d = (url) => fetch(url + '&hmac=ZqAmp4');\n",
    'web/e.js': "const api = axios.create({ baseURL: 'http://reports:8080?hmac=ZqTarget5' });\nexport const e = () => api.get('/api/reports/x');\n",
    'web/f.js': "const BASE = 'http://reports:8080?hmac=ZqTarget6';\nexport const f = () => fetch(`${BASE}/api/reports/w`);\n",
    'web/g.js': "export const g = () => fetch(REPORTS /* signed */ + '/api' + '/reports/v?hmac=ZqNoNeedle7');\n",
  });
  const all = redactSecrets(JSON.stringify({ facts, unresolved }));
  assert.equal(/Zq\w+/.test(all), false, all);
  // …and every call still keys and cites something on its line
  assert.deepEqual(facts.map((f) => [f.key, f.match, f.target]).sort(), [
    ['GET /api/reports/', '?hmac=', 'reports:8080'],
    ['GET /api/reports/v', 'export const g = () => fetch(REPORTS /* signed */ + \'/api\' + \'/reports/v', 'REPORTS'],
    ['GET /api/reports/w', '${BASE}/api/reports/w', 'reports:8080'],
    ['GET /api/reports/x', '/api/reports/x', 'reports:8080'],
    ['GET /api/reports/y', '/api/reports/y', 'REPORTS'],
    ['GET /api/reports/z', '${REPORTS}/api/reports/z', 'REPORTS'],
  ]);
});

test('end to end: a client class built on JS private fields still joins its route', async () => {
  const ws = await makeWorkspace({
    billing: { 'package.json': '{"name":"billing","dependencies":{"express":"4"}}\n',
      'src/server.js': "const express = require('express');\nconst app = express();\napp.get('/tenants/:tenant/orders', (req, res) => res.json({}));\napp.listen(8080);\n" },
    web: { 'package.json': '{"name":"web"}\n',
      'src/client.js': 'export class BillingClient {\n  #base = process.env.BILLING_URL;\n  #tenant = "acme";\n  orders() { return fetch(`${this.#base}/tenants/${this.#tenant}/orders`); }\n}\n' },
  });
  after(() => ws.cleanup());
  const extract = await extractWorkspace({ name: 'P', members: ws.members });
  const map = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: { version: 1, members: {} } });
  assert.deepEqual(map.edges.map((e) => `${e.from}->${e.to} ${e.display}`), ['web->billing GET /tenants/:tenant/orders']);
});

test('an agent-keyed HTTP call (survey fact, usage use) keeps no query value in catalog, map or synth brief', async () => {
  const ws = await makeWorkspace({
    reports: { 'package.json': '{"name":"reports","dependencies":{"express":"4"}}\n',
      'src/server.js': "const express = require('express');\nconst app = express();\napp.get('/api/reports/export', (req, res) => res.json({}));\napp.get('/api/reports/weekly', (req, res) => res.json({}));\napp.listen(8080);\n" },
    web: { 'package.json': '{"name":"web"}\n', 'src/x.js': 'export const EXPORT_URL = `${REPORTS}/api/reports/export?hmac=ZqSurvey1`;\n',
      'src/y.js': 'export const WEEKLY = `${REPORTS}/api/reports/weekly?hmac=ZqUse2`;\n' },
  });
  after(() => ws.cleanup());
  const extract = await extractWorkspace({ name: 'S', members: ws.members });
  const survey = { version: 1, members: { web: { status: 'investigated', aliases: [], provides: [], consumes: [
    { kind: 'http', key: 'http://reports:8080/api/reports/export?hmac=ZqSurvey1', file: 'src/x.js', line: 1,
      match: '${REPORTS}/api/reports/export?hmac=ZqSurvey1', target: 'reports' },
    { kind: 'http', key: 'GET /api/reports/export?hmac=ZqRejected3', file: 'src/x.js', line: 1, match: 'no such text' }] } } };
  const catalog = await buildCatalog({ extract, survey });
  const weekly = catalog.entries.find((e) => e.norm === 'http:GET /api/reports/weekly');
  // …and a relation keyed by a URL with a query (rule (e): the key becomes the edge's display)
  const usage = { version: 1, members: { reports: { status: 'investigated', uses: [], rejected: [], other: [] },
    web: { status: 'investigated', uses: [{ entry: weekly.id, file: 'src/y.js', line: 1, match: '${REPORTS}/api/reports/weekly?hmac=ZqUse2' }], rejected: [],
      other: [{ to: 'reports', kind: 'http', key: 'GET /api/reports/archive?hmac=ZqOther4', file: 'src/x.js', line: 1, match: '${REPORTS}/api/reports/export?hmac=ZqSurvey1' }] } } };
  const map = await joinMap({ catalog, usage });
  const text = JSON.stringify({ catalog, map, brief: synthBrief(map, { mapPath: '/p/map.json', checkerCmd: 'CHECK' }) });
  assert.equal(/Zq(Survey1|Use2|Rejected3|Other4)/.test(text), false, text);
  assert.deepEqual(map.edges.map((e) => `${e.from}->${e.to} ${e.display} ${e.evidence.from[0].match}`).sort(), [
    'web->reports GET /api/reports/archive ${REPORTS}/api/reports/export',
    'web->reports GET /api/reports/weekly ${REPORTS}/api/reports/weekly',
    'web->reports http://reports:8080/api/reports/export ${REPORTS}/api/reports/export',
  ]);
});

test('no artifact of extract → catalog → briefs → join → finalize holds a raw credential; the edges still form', async () => {
  const ws = await makeWorkspace({
    reports: {
      'package.json': '{"name":"reports","dependencies":{"express":"4"}}\n',
      'src/server.js': ["const express = require('express');", 'const app = express();',
        ...['/api/reports/latest', '/api/reports/weekly', '/api/reports/export', '/api/reports/archive', '/api/reports/upload', '/api/reports/orders', '/api/reports/:id', '/embed/dashboard/:token']
          .map((p) => `app.get('${p}', (req, res) => res.json({}));`), 'app.listen(8080);', ''].join('\n'),
    },
    nats: { 'package.json': '{"name":"nats"}\n', 'README.md': '# nats\n\nThe NATS broker config.\n' },
    'private-lib': { 'package.json': '{"name":"private-lib","version":"1.0.0"}\n' },
    web: {
      'package.json': `${JSON.stringify({ name: 'web', dependencies: { axios: '1', 'private-lib': `git+https://${PAT40}@github.com/acme/private-lib.git` } }, null, 2)}\n`,
      '.gitmodules': `[submodule "vendor/private-lib"]\n\tpath = vendor/private-lib\n\turl = https://${AZPAT52}@dev.azure.com/acme/shop/_git/private-lib\n`,
      '.env': [`NATS_URL=nats://${NATS_LONG}@nats:4222`, `SENTRY_DSN=https://${SENTRY}@o123456.ingest.sentry.io/1234567`,
        `REPORTS_URL=http://reports:8080/api/reports/latest?jwt=${JWT_A}`, `EMBED_URL=http://reports:8080/embed/dashboard/${JWT_B}`,
        `WEEKLY_URL=http://reports:8080/api/reports/weekly?session=${SESS}`,
        `UPLOAD_URL=http://reports:8080/api/reports/upload?X-Amz-Credential=${ASIA}/20260101/us-east-1/s3/aws4_request`,
        `ORDERS_URL=http://reports:8080/api/reports/orders?subscription-key=${APIM_ENV}`, ''].join('\n'),
      'docker-compose.yml': `services:\n  web:\n    build: .\n    environment:\n      NATS_URL: nats://${NATS_SHORT}@nats:4222\n      ORDERS_URL: http://reports:8080/api/reports/orders?subscription-key=${APIM_COMPOSE}\n`,
      // an HTTP client call and a candidate literal: a query parameter of any name may carry a credential
      'src/api.js': `import axios from 'axios';\nexport const exportAll = () => axios.get('http://reports:8080/api/reports/export?subscription-key=${APIM}&hmac=${HMAC}');\n`,
      // a templated URL: its route key drops the query too (only the literal branches of urlOf did)
      'src/tpl.js': 'export const tpl = () => fetch(`${REPORTS}/api/tpl/export?hmac=' + TPL + '`);\n',
      'src/links.js': `export const ARCHIVE_LINK = 'http://reports:8080/api/reports/archive?ticket=${TICKET}&x-sig=${XSIG}';\n`,
      // Ruby's #{…} is interpolation, never a fragment: the cited text keeps it
      'lib/client.rb': "require 'httparty'\ndef report(id)\n  HTTParty.get(\"http://reports:8080/api/reports/#{id}\")\nend\n",
      'lib/links.rb': `ARCHIVE = "http://reports:8080/api/reports/archive/#{year}?sid=${SID}"\n`,
    },
  }, { remotes: { 'private-lib': 'https://dev.azure.com/acme/shop/_git/private-lib' } });
  after(() => ws.cleanup());
  // Keyed like a real scan: member key = projectKey, name = the folder.
  const members = ws.members.map((m) => ({ ...m, key: projectKey(m.dir) }));
  const key = Object.fromEntries(members.map((m) => [m.name, m.key]));
  const extract = await extractWorkspace({ name: 'Creds', members });
  const catalog = await buildCatalog({ extract, survey: null });
  const briefs = usageBriefs(catalog, { catalogPath: '/p/catalog.json', checkerCmd: 'CHECK' });
  // The usage stage confirms every candidate, citing it as the catalog wrote it.
  const usage = { version: 1, members: Object.fromEntries(Object.keys(catalog.members).map((k) => [k, { status: 'investigated',
    uses: (catalog.candidates[k] || []).map(({ entry, file, line, match }) => ({ entry, file, line, match })), rejected: [], other: [] }])) };
  const map = await joinMap({ catalog, usage });
  const pipelineDir = await mkdtemp(join(tmpdir(), 'worca-cc-wscreds-run-'));
  after(() => rm(pipelineDir, { recursive: true, force: true }));
  await writeFile(join(pipelineDir, WORKSPACE_MAP_FILE), JSON.stringify(map));
  const projectPaths = members.map((m) => m.dir);
  const id = workspaceKey({ name: 'Creds', projectPaths });
  assert.deepEqual(await finalizeWorkspaceScan({ workspaceId: id, name: 'Creds', projectPaths, pipelineDir }), { outcome: 'created', workspaceId: id });
  const stored = await readWorkspaceMap(id);
  const artifacts = {
    extract: JSON.stringify(extract), survey: surveyBrief(extract, { extractPath: '/p/extract.json', checkerCmd: 'CHECK' }), catalog: JSON.stringify(catalog),
    briefs: [briefs.index, ...Object.values(briefs.files)].join('\n'), map: JSON.stringify(map), synth: synthBrief(map, { mapPath: '/p/map.json', checkerCmd: 'CHECK' }),
    stored: JSON.stringify(stored), description: (await readWorkspace(id)).description,
  };
  const raw = { PAT40, AZPAT52, SENTRY, NATS_LONG, NATS_SHORT, JWT_A: JWT_A.split('.')[2], JWT_B: JWT_B.split('.')[2], SESS, ASIA: ASIA.slice(4), APIM, APIM_ENV, APIM_COMPOSE, HMAC, TICKET, XSIG, SID, TPL };
  for (const [name, secret] of Object.entries(raw)) {
    for (const [where, text] of Object.entries(artifacts)) assert.ok(!text.includes(secret), `${name} leaked into ${where}`);
  }

  const edge = (to, kind, display) => map.edges.find((e) => e.from === key.web && e.to === key[to] && e.kind === kind && (!display || e.display === display));
  const cited = (e) => e.evidence.from.map((x) => `${x.file}:${x.line} ${x.match}`);
  assert.deepEqual(cited(edge('nats', 'service')), ['.env:1 nats://***@nats:4222', 'docker-compose.yml:5 nats://***@nats:4222']);
  assert.deepEqual(cited(edge('private-lib', 'pkg', 'private-lib')), ['package.json:5 "private-lib": "git+https://***@github.com/acme/private-lib.git"']);
  assert.deepEqual(cited(edge('private-lib', 'pkg', 'dev.azure.com/acme/shop/_git/private-lib')), ['.gitmodules:3 https://***@dev.azure.com/acme/shop/_git/private-lib']);
  assert.deepEqual(cited(edge('reports', 'http', 'GET /api/reports/latest')), ['.env:3 http://reports:8080/api/reports/latest?jwt=***']);
  assert.deepEqual(cited(edge('reports', 'http', 'GET /embed/dashboard/:token')), ['.env:4 http://reports:8080/embed/dashboard/eyJ***']);
  assert.deepEqual(cited(edge('reports', 'http', 'GET /api/reports/weekly')), ['.env:5 http://reports:8080/api/reports/weekly?session=***']);
  assert.deepEqual(cited(edge('reports', 'http', 'GET /api/reports/upload')), ['.env:6 http://reports:8080/api/reports/upload?X-Amz-Credential=ASIA***/20260101/us-east-1/s3/aws4_request']);
  // A configuration value keeps its query (only the central redaction guards it): the API Management key is masked.
  assert.deepEqual(cited(edge('reports', 'http', 'GET /api/reports/orders')),
    ['.env:7 http://reports:8080/api/reports/orders?subscription-key=***', 'docker-compose.yml:6 http://reports:8080/api/reports/orders?subscription-key=***']);
  // An HTTP call's cited URL and a candidate stop before the query; Ruby's #{…} is kept.
  assert.deepEqual(cited(edge('reports', 'http', 'GET /api/reports/export')), ['src/api.js:2 http://reports:8080/api/reports/export']);
  assert.deepEqual(cited(edge('reports', 'http', 'GET /api/reports/archive')).sort(),
    ['lib/links.rb:1 http://reports:8080/api/reports/archive/#{year}', 'src/links.js:1 http://reports:8080/api/reports/archive']);
  const rb = extract.members[key.web].consumes.find((f) => f.kind === 'http' && f.file === 'lib/client.rb');
  assert.equal(rb?.match, 'http://reports:8080/api/reports/#{id}', 'the HTTP call keeps its #{id}');
});

test('a URL password holding `?` or `#` is never cut into a citation or a target: the host and the base path stay', () => {
  const { facts } = detectHttp({
    'web/p.js': "const api = axios.create({ baseURL: 'http://svc:Zq9?pw@billing:8080/api' });\nexport const p = () => api.get('/invoices');\n",
    'web/q.js': "const BASE = 'https://svc:p#ssZq8@billing:8080';\nexport const q = () => fetch(`${BASE}/api/x`);\n",
    'web/r.js': "export const r = () => fetch('http://svc:Zq7Leak?rest@reports:8080/api/reports/archive');\n",
    // a query right after the host is no path prefix, even one holding a slash
    'web/s.js': "const Q = 'http://ledger:8080?v=/api';\nexport const s = () => fetch(`${Q}/entries`);\n",
  });
  const all = redactSecrets(JSON.stringify(facts));
  assert.equal(/Zq\w+/.test(all), false, all);
  assert.deepEqual(facts.map((f) => [f.key, f.target]).sort(), [['GET /api/invoices', 'billing:8080'], ['GET /api/reports/archive', 'reports:8080'], ['GET /api/x', 'billing:8080'], ['GET /entries', 'ledger:8080']]);
});

test('a URL inside a relative text\'s query is no userinfo; a port before a query \'@\' opens none; a password holding two \'?\' / \'#\' is never a target', () => {
  assert.equal(keys.cutQuery('/cb?next=http://u:p@evil/y&hmac=ZqRel1'), '/cb');
  assert.equal(keys.cutQuery('http://billing:8080?cc=ops@acme.com&hmac=ZqPort1'), 'http://billing:8080');
  // a regex literal holding a quote misreads the placeholder's strings: the query after it is cut where it stands (the norm stays)
  assert.equal(keys.cutQuery("${API}/users/${name.replace(/'/g, '')}/orders?hmac=ZqRx1"), "${API}/users/${name.replace(/'/g, '')}/orders");
  // a conditional query cuts at its placeholder even when a query follows
  assert.equal(keys.cutQuery("${API}/x${q ? '?sig=ZqRx2' : ''}/y?z=1"), '${API}/x');
  const { facts } = detectHttp({
    'web/r.js': 'export const r = () => fetch(`${API}/cb?next=http://u:p@evil/y&hmac=ZqRel2`);\n',
    'web/t.js': "const api = axios.create({ baseURL: 'http://svc:Zq7#cd#ef@billing:8080/api' });\nexport const t = () => api.get('/invoices');\n",
    'web/u.js': "const BASE = 'http://svc:Zq6&#e#@x9@billing:8080';\nexport const u = () => fetch(`${BASE}/api/x`);\n",
    // an Azure-style user holding '@' (`user@server:pass@host`): the host is after the last '@'
    'web/v.js': "const api = axios.create({ baseURL: 'http://ops@acme.com:Zq5pw@ledger:8080/v1' });\nexport const v = () => api.get('/entries');\n",
    // …and a literal absolute URL: its host is after the last '@' before the path, never the password's head
    'web/w.js': "export const w = () => fetch('http://svc:Zq4#cd#ef@billing:8080/api/w/@me');\n",
  });
  const all = redactSecrets(JSON.stringify(facts));
  assert.equal(/Zq\w+/.test(all), false, all);
  assert.deepEqual(facts.map((f) => [f.key, f.target]).sort(), [['GET /api/invoices', 'billing:8080'], ['GET /api/w/@me', 'billing:8080'], ['GET /api/x', 'billing:8080'], ['GET /cb', 'API'], ['GET /v1/entries', 'ledger:8080']]);
});

test('a code expression is cut inside its string pieces only: an optional chain, a ternary or ?? before the URL stays cited', () => {
  const { facts } = detectHttp({
    'web/a.js': "export const a = () => fetch(this.config?.apiUrl + '/users?hmac=ZqCode1');\n",
    'web/b.js': "export const b = (id) => axios.get((isProd ? PROD_URL : DEV_URL) + '/users/' + id);\n",
    'svc/E.cs': 'class E {\n  async Task F() { var r = await _http.GetAsync((baseUrl ?? Default) + "/orders"); }\n}\n',
    // a regex literal holding a quote misreads the pieces: the query the key dropped is cut as URL text
    'web/r.js': "export const r = () => fetch(url.replace(/'/g, '') + '/reports?hmac=ZqCode2');\n",
  });
  assert.deepEqual(facts.map((f) => [f.key, f.match]), [
    ['GET /users', "this.config?.apiUrl + '/users"],
    ['GET /users/{}', "(isProd ? PROD_URL : DEV_URL) + '/users/' + id"],
    ['GET /orders', '(baseUrl ?? Default) + "/orders"'],
    ['GET /reports', "url.replace(/'/g, '') + '/reports"],
  ]);
  assert.equal(JSON.stringify(facts).includes('ZqCode'), false);
  assert.equal(keys.cutCode?.("BASE + '/x/' + id + '?sig=' + s"), "BASE + '/x/' + id + '");
});

test('a cut never splits a URL password: a dynamic URL text and a rejected agent key are cut after redaction', async () => {
  const { unresolved } = detectHttp({
    'svc/a.py': 'import os, requests\ndef f():\n    return requests.get(os.getenv("BILLING_URL", "http://svc:Zq1Dyn?3S&MC=xK@billing:8080/api"))\n',
    'web/b.js': "export const b = () => axios.get(buildUrl('http://svc:Zq2Dyn&ab=cd@billing:8080'));\n",
  });
  assert.equal(unresolved.length, 2);
  assert.equal(/Zq\dDyn/.test(redactSecrets(JSON.stringify(unresolved))), false, JSON.stringify(unresolved));
  const ws = await makeWorkspace({ web: { 'package.json': '{"name":"web"}\n', 'src/b.js': 'export const b = () => 1;\n' } });
  after(() => ws.cleanup());
  const extract = await extractWorkspace({ name: 'R', members: ws.members });
  const survey = { version: 1, members: { web: { status: 'investigated', aliases: [], provides: [], consumes: [
    { kind: 'http', key: 'http://svc:P?Zq3Rej@Zq4Rej#5@billing:8080/api/w?hmac=Zq5Rej', file: 'src/b.js', line: 1, match: 'no such text' }] } } };
  const catalog = await buildCatalog({ extract, survey });
  assert.deepEqual(catalog.rejected.map((r) => r.fact.key), ['http://***@billing:8080/api/w']);
});

test('an absolute URL with an Azure-style user, a base whose query holds a slash and an @ in a query behind a non-numeric port key their calls on the right host and path', () => {
  const { facts } = detectHttp({
    'web/x.js': "export const x = () => fetch('http://ops@acme.com:Zq3pw@ledger:8080/v1/entries');\n",
    'web/y.js': "const api = axios.create({ baseURL: 'http://ledger:8080?v=/api' });\nexport const y = () => api.get('/entries');\n",
    'web/z.js': "export const z = () => fetch('http://host:PORT/x?cc=ops@acme.com&k=ZqCanary9');\n",
    // …and an e-mail / Azure-style user whose password holds '#' or '?': the cut starts after the whole userinfo
    'web/w.js': "export const w = () => axios.get('http://reports@acme.com:Pa$$w0rdZq1#2024@ledger:8080/v1/entries/2');\n",
    'svc/v.py': "import requests\ndef v():\n    return requests.get('https://ops@acme.com:WinterZq2?77@ledger:8080/v1/entries/3')\n",
  });
  assert.deepEqual(facts.map((f) => [f.file, f.key, f.target]), [['web/x.js', 'GET /v1/entries', 'ledger:8080'], ['web/y.js', 'GET /entries', 'ledger:8080'], ['web/z.js', 'GET /x', 'host:PORT'],
    ['web/w.js', 'GET /v1/entries/2', 'ledger:8080'], ['svc/v.py', 'GET /v1/entries/3', 'ledger:8080']]);
  const all = redactSecrets(JSON.stringify(facts));
  assert.equal(/Zq\w+/.test(all), false, all);
  // the whole line emit() cites when its needle is not on it (a comment inside the concatenation) is redacted before its cut
  const line = detectHttp({ 'web/u.js': "export const u = () => fetch(BASE /* see http://wiki */ + '/api' + '/items'); const MIRROR = 'http://svc:pwZq6#x@billing:8080';\n" });
  assert.equal(/Zq6/.test(redactSecrets(JSON.stringify(line))), false, JSON.stringify(line));
});

test('a cited URL over 200 characters with an e-mail / Azure-style user and a `#` / `?` password is clipped past the userinfo redaction reads: no artifact through finalize holds the password, and the edge forms', async () => {
  const route = '/api/reports/' + 'segment/'.repeat(22) + 'end';
  const ws = await makeWorkspace({
    billing: { 'package.json': '{"name":"billing","dependencies":{"express":"4"}}\n', 'src/server.js': `const express = require('express');\nconst app = express();\napp.get('${route}', (q, s) => s.json({}));\napp.listen(8080);\n` },
    web: {
      'package.json': '{"name":"web","dependencies":{"axios":"1"}}\n',
      'src/api.js': `import axios from 'axios';\nexport const a = () => axios.get('http://reports@acme.com:PwLongZq#2024@billing:8080${route}');\n`,
      'svc/b.py': `import requests\ndef b():\n    return requests.get('https://app@pgsrv:PyLongZq?77@billing:8080${route}')\n`,
    },
  });
  after(() => ws.cleanup());
  const members = ws.members.map((m) => ({ ...m, key: projectKey(m.dir) }));
  const key = Object.fromEntries(members.map((m) => [m.name, m.key]));
  const extract = await extractWorkspace({ name: 'Long', members });
  const catalog = await buildCatalog({ extract, survey: null });
  const briefs = usageBriefs(catalog, { catalogPath: '/p/catalog.json', checkerCmd: 'CHECK' });
  const usage = { version: 1, members: Object.fromEntries(Object.keys(catalog.members).map((k) => [k, { status: 'investigated',
    uses: (catalog.candidates[k] || []).map(({ entry, file, line, match }) => ({ entry, file, line, match })), rejected: [], other: [] }])) };
  const map = await joinMap({ catalog, usage });
  const pipelineDir = await mkdtemp(join(tmpdir(), 'worca-cc-wslong-run-'));
  after(() => rm(pipelineDir, { recursive: true, force: true }));
  await writeFile(join(pipelineDir, WORKSPACE_MAP_FILE), JSON.stringify(map));
  const projectPaths = members.map((m) => m.dir);
  const id = workspaceKey({ name: 'Long', projectPaths });
  assert.deepEqual(await finalizeWorkspaceScan({ workspaceId: id, name: 'Long', projectPaths, pipelineDir }), { outcome: 'created', workspaceId: id });
  const artifacts = {
    extract: JSON.stringify(extract), survey: surveyBrief(extract, { extractPath: '/p/extract.json', checkerCmd: 'CHECK' }), catalog: JSON.stringify(catalog),
    briefs: [briefs.index, ...Object.values(briefs.files)].join('\n'), map: JSON.stringify(map), synth: synthBrief(map, { mapPath: '/p/map.json', checkerCmd: 'CHECK' }),
    stored: JSON.stringify(await readWorkspaceMap(id)), description: (await readWorkspace(id)).description,
  };
  for (const secret of ['PwLongZq', 'PyLongZq']) {
    for (const [where, text] of Object.entries(artifacts)) assert.ok(!text.includes(secret), `${secret} leaked into ${where}`);
  }
  const edge = map.edges.find((e) => e.from === key.web && e.to === key.billing && e.kind === 'http');
  assert.ok(edge, JSON.stringify(map.edges));
  assert.deepEqual(edge.evidence.from.map((x) => x.file).sort(), ['src/api.js', 'svc/b.py'], 'both calls still join the route');
});

test('a dynamic URL text is redacted before its 200-character cut: a password straddling the cut leaves no head', () => {
  const pw = 'Zq' + 'Ab1'.repeat(55);
  const { unresolved } = detectHttp({ 'svc/a.py': `import os, requests\ndef f():\n    return requests.get(os.getenv("BILLING_URL", "http://svc:${pw}@billing:8080/api"))\n` });
  assert.equal(unresolved.length, 1);
  assert.equal(/ZqAb1/.test(JSON.stringify(unresolved)), false, JSON.stringify(unresolved));
});
