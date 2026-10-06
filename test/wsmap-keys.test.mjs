// test/wsmap-keys.test.mjs — key normalisation and the fuzzy matchers (wsmap P1, spec §5.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normKey, normPath, normHttp, normPkg, hostAlias, hostName, remoteSlug, pathSuffixMatch, topicMatches, httpTerm, normBody, envStems,
} from '../src/shared/workspace-map/keys.mjs';

test('normPath: every parameter style becomes {} and URLs lose scheme, host, query, fragment', () => {
  const cases = [
    ['/users/:id?x=1', '/users/{}'],
    ['/users/:id/', '/users/{}'],
    ['/users/{id}', '/users/{}'],
    ['/users/<id>', '/users/{}'],
    ['/users/<int:id>/x', '/users/{}/x'],
    ['/users/[id]', '/users/{}'],
    ['/files/[...slug]', '/files/{}'],
    ['/q/${id}', '/q/{}'],
    ['/q/%s/%d', '/q/{}/{}'],
    ['/q/{0}', '/q/{}'],
    ['https://api.example.com:8443/v1/users/{id}#frag', '/v1/users/{}'],
    ['//cdn.example.com/a', '/a'],
    ['users/{id}', '/users/{}'],
    ['${base}/users/${id}', '/users/{}'],
    ['/a//b///c/', '/a/b/c'],
    ['/', '/'],
    ['http://billing:8080', '/'],
    ['/v1/users:batchGet', '/v1/users:batchGet'],
    ['/users/{id:[0-9]+}', '/users/{}'],
    ['/users/{id:[0-9]{3}}/x', '/users/{}/x'],
    ['/a/{id:\\d+}/b', '/a/{}/b'],
    ['/users/{id?}', '/users/{}'],
    ['/users/{id:int?}/orders', '/users/{}/orders'],
    ['/files/{*path}', '/files/{}'],
    ['/files/{**catchall}', '/files/{}'],
  ];
  for (const [input, want] of cases) assert.equal(normPath(input), want, input);
  for (const bad of ['', '   ', 'two words', null, 42, '/a b', '/x\ty']) assert.equal(normPath(bad), null, String(bad));
});

test('normHttp / normKey http: method upper-cased, blank/ANY/ALL → *, full URLs accepted', () => {
  assert.equal(normHttp('get', '/users/:id'), 'http:GET /users/{}');
  assert.equal(normHttp('', '/x'), 'http:* /x');
  assert.equal(normHttp('ANY', '/x'), 'http:* /x');
  assert.equal(normHttp('G3T', '/x'), null);
  assert.equal(normKey('http', 'GET /users/:id'), 'http:GET /users/{}');
  assert.equal(normKey('http', 'post http://billing:8080/invoices/'), 'http:POST /invoices');
  assert.equal(normKey('http', '/invoices/{invoiceId}'), 'http:* /invoices/{}');
  assert.equal(normKey('http', 'https://billing.internal/api/v1/invoices/42?x=1'), 'http:* /api/v1/invoices/42');
  assert.equal(normKey('http', 'GET /users/{id:[0-9]+}'), 'http:GET /users/{}', 'gorilla / Spring regex parameter');
  assert.equal(normKey('http', 'GET /users/{id?}'), 'http:GET /users/{}', 'ASP.NET / Laravel optional parameter');
});

test('normPkg / normKey pkg: per-ecosystem rules', () => {
  assert.equal(normPkg('npm', '@acme/Auth'), 'pkg:npm:@acme/Auth', 'npm is kept as declared');
  assert.equal(normPkg('pypi', 'Foo_Bar.baz'), 'pkg:pypi:foo-bar-baz', 'PEP 503');
  assert.equal(normPkg('cargo', 'Serde_JSON'), 'pkg:cargo:serde_json');
  assert.equal(normPkg('nuget', 'Acme.Billing'), 'pkg:nuget:acme.billing');
  assert.equal(normPkg('maven', 'com.acme:billing:1.2.0'), 'pkg:maven:com.acme:billing', 'version dropped');
  assert.equal(normPkg('git', 'GitHub.com/Acme/Billing'), 'pkg:git:github.com/acme/billing', 'P3 git-submodules keys by remoteSlug');
  assert.equal(normPkg('maven', 'billing'), null, 'maven needs group:artifact');
  assert.equal(normPkg('go', 'github.com/acme/lib'), 'pkg:go:github.com/acme/lib');
  assert.equal(normPkg('bower', 'x'), null);
  assert.equal(normKey('pkg', 'npm:@acme/billing'), 'pkg:npm:@acme/billing');
  assert.equal(normKey('pkg', '@acme/billing'), null, 'no ecosystem prefix → not keyable');
});

test('normKey: grpc, graphql, topic, db, service, other', () => {
  assert.equal(normKey('grpc', '/acme.billing.v1.Billing/GetInvoice'), 'grpc:acme.billing.v1.Billing/GetInvoice');
  assert.equal(normKey('grpc', 'acme.Billing'), 'grpc:acme.Billing');
  assert.equal(normKey('graphql', 'Query.user'), 'graphql:Query.user');
  assert.equal(normKey('graphql', 'query GetUser'), 'graphql:op:GetUser');
  assert.equal(normKey('graphql', 'op:GetUser'), 'graphql:op:GetUser');
  assert.equal(normKey('topic', 'Orders.Created'), 'topic:Orders.Created', 'case kept');
  assert.equal(normKey('topic', 'orders.*'), 'topic:orders.*', 'wildcards kept');
  assert.equal(normKey('db', 'Billing.Invoices'), 'table:billing.invoices', 'bare name → table, schema kept');
  assert.equal(normKey('db', 'db:Shop'), 'db:shop');
  assert.equal(normKey('db', 'table:"public"."users"'), 'table:public.users');
  assert.equal(normKey('service', 'http://Billing:8080/x'), 'service:billing');
  assert.equal(normKey('service', 'localhost:3000'), null);
  assert.equal(normKey('other', '  Shared   S3 Bucket '), 'other:shared s3 bucket');
  assert.equal(normKey('other', 'x'.repeat(500)).length, 'other:'.length + 120);
  assert.equal(normKey('nope', 'x'), null);
  assert.equal(normKey('http', '   '), null);
  assert.equal(normBody('pkg:npm:@a/b'), 'npm:@a/b');
});

test('envStems: env / config keys naming a service become alias candidates', () => {
  assert.deepEqual(envStems('BILLING_API_URL'), ['billing-api', 'billing_api', 'billing']);
  assert.deepEqual(envStems('services.billing.url'), ['billing']);
  assert.deepEqual(envStems('billingBaseUrl'), ['billing-base', 'billing_base', 'billing']);
  assert.deepEqual(envStems('USERS_SVC_HOST'), ['users-svc', 'users_svc', 'users']);
  assert.deepEqual(envStems('Billing:Url'), ['billing'], 'ASP.NET config keys use ":"');
  assert.deepEqual(envStems('Services:Billing:BaseUrl'), ['billing-base', 'billing_base', 'billing']);
  for (const no of ['billing', 'BILLING_TIMEOUT', '', 'URL', 'x'.repeat(300), null]) assert.deepEqual(envStems(no), [], String(no));
});

test('hostAlias / hostName: 1 MB of \':${\' runs is rejected fast (LLM keys pass through here too)', () => {
  for (const f of [hostAlias, hostName]) {
    const t0 = performance.now();
    assert.equal(f('a' + ':${x'.repeat(250000)), null);
    assert.ok(performance.now() - t0 < 3000, `the length guard keeps ${f.name} linear (unguarded: over a minute)`);
  }
});

test('hostAlias: first DNS label; hostName: the whole host; local hosts, IPs and IPv6 are neither', () => {
  assert.equal(hostAlias('http://billing:8080/x'), 'billing');
  assert.equal(hostAlias('billing.internal'), 'billing');
  assert.equal(hostAlias('billing'), 'billing');
  assert.equal(hostAlias('postgres://u:p@pg-main:5432/shop'), 'pg-main');
  assert.equal(hostAlias('Billing_API:9000'), 'billing_api');
  for (const bad of ['localhost:3000', '127.0.0.1', 'http://0.0.0.0:80', 'http://[::1]:3000', '10.0.0.7:5432', '', '   ', null, 'a b']) {
    assert.equal(hostAlias(bad), null, String(bad));
    assert.equal(hostName(bad), null, String(bad));
  }
  assert.equal(hostName('http://u:p@Billing.Internal:8080/x?y=1'), 'billing.internal');
  assert.equal(hostName('https://api.stripe.com/v1/charges'), 'api.stripe.com');
  assert.equal(hostName('billing'), 'billing');
  assert.equal(hostName('a..b'), null);
});

test('remoteSlug: scp, https and ssh remotes → host/path; local paths → null', () => {
  assert.equal(remoteSlug('git@github.com:acme/billing-api.git'), 'github.com/acme/billing-api');
  assert.equal(remoteSlug('https://user@github.com/Acme/Billing-API.git/'), 'github.com/acme/billing-api');
  assert.equal(remoteSlug('ssh://git@git.acme.io:2222/team/x.git'), 'git.acme.io/team/x');
  assert.equal(remoteSlug('http://github.com//acme/billing.git'), 'github.com/acme/billing', 'repeated / collapsed');
  assert.equal(remoteSlug('/srv/git/x.git'), null);
  assert.equal(remoteSlug('../x'), null);
});

test('remoteSlug: every Azure DevOps spelling folds to one dev.azure.com slug', () => {
  assert.equal(remoteSlug('https://dev.azure.com/acme/Shop/_git/api'), 'dev.azure.com/acme/shop/api');
  assert.equal(remoteSlug('https://acme@dev.azure.com/acme/Shop/_git/api'), 'dev.azure.com/acme/shop/api');
  assert.equal(remoteSlug('git@ssh.dev.azure.com:v3/acme/Shop/api'), 'dev.azure.com/acme/shop/api');
  assert.equal(remoteSlug('https://acme.visualstudio.com/DefaultCollection/Shop/_git/api'), 'dev.azure.com/acme/shop/api');
  assert.equal(remoteSlug('https://github.com/Acme/API.git'), 'github.com/acme/api', 'non-Azure unchanged');
  assert.equal(remoteSlug('https://dev.azure.com/acme/Shop/api'), 'dev.azure.com/acme/shop/api', 'an unparseable Azure path keeps the old generic slug');
});

test('pathSuffixMatch: provider segments are a suffix of the consumer, {} matches one segment, one static segment agrees', () => {
  assert.equal(pathSuffixMatch('/api/v1/invoices/{}', '/invoices/{}'), true);
  assert.equal(pathSuffixMatch('/invoices/42', '/invoices/{}'), true);
  assert.equal(pathSuffixMatch('/invoices/{}', '/invoices/42'), true);
  assert.equal(pathSuffixMatch('/invoices', '/invoices/{}'), false, 'provider longer than consumer');
  assert.equal(pathSuffixMatch('/a/{}/{}', '/{}/{}'), false, 'provider needs one static segment');
  assert.equal(pathSuffixMatch('/a', '/'), false);
  assert.equal(pathSuffixMatch('/users/{}', '/invoices/{}'), false);
  assert.equal(pathSuffixMatch('/invoices/{}', '/health'), false, 'a consumer {} alone never matches a provider segment');
  assert.equal(pathSuffixMatch('/{}/{}', '/a/b'), false);
  assert.equal(pathSuffixMatch('/api/{}/items', '/api/orders/items'), true, '{} in the middle, statics agree around it');
  assert.equal(pathSuffixMatch('/api/users/{}', '/api/{}/invoices'), false, 'crossed parameters: only the prefix agrees');
  assert.equal(pathSuffixMatch('/api/users/{}/orders', '/api/{}/invoices/{}'), false);
  assert.equal(pathSuffixMatch('/api/v1/users/{}', '/{}/users/{}'), true, 'a one-sided parameter still matches');
  assert.equal(pathSuffixMatch('/api/{}/users/me', '/api/v1/users/{}'), true, 'a literal agreeing after the crossing aligns them (a templated version, v6)');
  assert.equal(pathSuffixMatch('/api/{}/orders/export', '/api/v1/orders/{}'), true);
  assert.equal(pathSuffixMatch('/orgs/{}/repos/list/{}', '/orgs/{}/repos/{}/branches'), false, 'nothing agrees after the first one-sided parameter');
  assert.equal(pathSuffixMatch('/users/{}/settings', '/{}/profile/settings'), false, 'a literal after BOTH parameters is a shared word (v7)');
  assert.equal(pathSuffixMatch('/api/{}/jobs/status', '/users/{}/status'), false);
  assert.equal(pathSuffixMatch('/api/{}/jobs/status', '/api/v1/jobs/status'), true);
  assert.equal(pathSuffixMatch('/users/{}/settings/theme', '/admin/settings/{}'), false, "a parameter after a literal the provider lacks is that resource's id (v8)");
  assert.equal(pathSuffixMatch('/orgs/{}/members/count', '/v1/members/{}'), false, 'an id over the provider version is still an id');
  assert.equal(pathSuffixMatch('/{}/members/count', '/teams/members/{}'), false, 'a leading parameter aligns only over a version');
  assert.equal(pathSuffixMatch('/{}/users/me', '/v1/users/{}'), true, '${BASE}/${VERSION}/users/me once normPath drops the base');
  assert.equal(pathSuffixMatch('/{}/tweets/recent', '/2/tweets/{}'), true);
});

test('topicMatches: * one segment, # zero or more, > one or more, exact otherwise; . and : separate', () => {
  assert.equal(topicMatches('orders.*', 'orders.created'), true);
  assert.equal(topicMatches('orders.*', 'orders.created.v1'), false);
  assert.equal(topicMatches('orders.#', 'orders'), true);
  assert.equal(topicMatches('orders.#', 'orders.a.b'), true);
  assert.equal(topicMatches('orders.>', 'orders'), false);
  assert.equal(topicMatches('orders.>', 'orders.a.b'), true);
  assert.equal(topicMatches('orders.created', 'orders.created'), true);
  assert.equal(topicMatches('orders.created', 'orders.deleted'), false);
  assert.equal(topicMatches('chat:*', 'chat:room1'), true, 'Redis channels use ":"');
  assert.equal(topicMatches('chat:*', 'chat:room1:x'), false);
  assert.equal(topicMatches('user:#', 'user:1:events'), true);
  assert.equal(topicMatches('chat:*', 'chat.room1'), false, 'the separators must agree');
});

test('httpTerm: longest static prefix before the first {} — only when ≥ 2 segments or ≥ 8 chars', () => {
  assert.equal(httpTerm('/invoices/{}'), '/invoices');
  assert.equal(httpTerm('/users/{}'), null, 'one short segment is too generic');
  assert.equal(httpTerm('/api/users/{}'), '/api/users');
  assert.equal(httpTerm('/api/v1/health'), '/api/v1/health');
  assert.equal(httpTerm('/{}/x'), null);
  assert.equal(httpTerm('/files/{}.json'), null);
  assert.equal(httpTerm('nope'), null);
});
