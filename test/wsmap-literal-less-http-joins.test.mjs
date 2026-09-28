// test/wsmap-literal-less-http-joins.test.mjs — M6 shape 6, the catalog half (spec §6.3 step 5): an http consume whose
// path has no literal segment (`GET /`, `GET /{}`) names no route. It joins only through a host that names a member
// (C28, `strict`); an outside host, a localhost port or a Feign service id never lands it on whichever member happens
// to serve `GET /` or `GET /{}` (a mounted Express router). A path with a literal segment still joins by norm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorkspace } from './helpers/wsmap-fixtures.mjs';
import { extractWorkspace } from '../src/core/workspace-map/extract.mjs';
import { buildCatalog } from '../src/core/workspace-map/catalog.mjs';
import { joinMap } from '../src/core/workspace-map/join.mjs';

/** extract → catalog → join over a fresh workspace (static facts only) → sorted 'from -> to norm (confidence)'. */
async function edges(spec) {
  const w = await makeWorkspace(spec);
  try {
    const extract = await extractWorkspace({ name: 'Rootless', members: w.members });
    const map = await joinMap({ catalog: await buildCatalog({ extract, survey: null }), usage: null });
    return map.edges.filter((e) => e.kind !== 'pkg').map((e) => `${e.from} -> ${e.to} ${e.norm} (${e.confidence})`).sort();
  } finally { await w.cleanup(); }
}
// a router mounted elsewhere serves `GET /` and `GET /{}` — the member every placeholder-only call used to land on
const USERS_SVC = { 'package.json': '{ "name": "users-svc" }\n', 'src/users.js': "const express = require('express');\nconst router = express.Router();\nrouter.get('/', listUsers);\nrouter.get('/:id', getUser);\nrouter.get('/users/:id', getUser);\nmodule.exports = router;\n" };

test('M6 shape 6: a call with no literal path segment joins only through a host naming a member — never an outside host or localhost; a literal path and a topic still join', async () => {
  assert.deepEqual(await edges({
    'users-svc': USERS_SVC,
    billing: { 'package.json': '{ "name": "billing" }\n', 'src/s.js': "const express = require('express'); const app = express();\napp.get('/invoices/:id', getInvoice);\nawait consumer.subscribe({ topics: ['invoice.paid'] });\n" },
    web: {
      'package.json': '{ "name": "web" }\n',
      'src/a.js': [
        "export const crm = (id) => fetch('http://legacy-crm:8080/' + id);",
        "export const ping = () => fetch('http://legacy-crm:8080/');",
        "export const health = () => fetch('http://localhost:9000/');",
        "export const invoice = (id) => fetch('http://billing:8080/' + id);",
        "export const user = (id) => fetch('/users/' + id);",
        "export const paid = (m) => producer.send({ topic: 'invoice.paid', messages: [m] });",
      ].join('\n') + '\n',
    },
  }), ['billing -> web topic:invoice.paid (exact)', 'web -> billing http:GET /{} (exact)', 'web -> users-svc http:GET /users/{} (exact)']);
});

test('M6 shape 6: a Feign client to an outside service (`name = "stores"`) with a placeholder-only path joins nobody', async () => {
  assert.deepEqual(await edges({
    'users-svc': USERS_SVC,
    orders: { 'pom.xml': '<project><groupId>a</groupId><artifactId>orders</artifactId></project>\n', 'src/main/java/StoreClient.java': '@FeignClient(name = "stores")\npublic interface StoreClient {\n  @GetMapping("/{storeId}")\n  Store get(@PathVariable("storeId") Long storeId);\n}\n' },
  }), []);
});
