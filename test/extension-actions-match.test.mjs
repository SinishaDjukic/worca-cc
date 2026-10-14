// test/extension-actions-match.test.mjs — the extension's "which running worca Action serves this page?" (D7, D8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageOrigin, instanceOrigins, matchRunningAction } from '../src/core/extension-actions.mjs';

const inst = (o) => ({ instanceId: 'i1', runId: 'r1', member: null, actionId: 'web', label: 'Web', kind: 'service', status: 'ready', pid: 4242, ports: {}, url: null, ...o });
const info = { r1: { title: 'Fix checkout', projectKey: 'acme-web', workspaceId: null }, r2: { title: 'Shop', projectKey: 'acme-api', workspaceId: 'shop' } };
const runInfo = (id) => info[id] || null;

test('localhost and 127.0.0.1 are the same host', () => {
  const m = matchRunningAction(pageOrigin('http://localhost:5173/cart'), [inst({ url: 'http://127.0.0.1:5173/' })], runInfo);
  assert.deepEqual(m, { url: 'http://127.0.0.1:5173', projectKey: 'acme-web', workspaceId: null, runId: 'r1', runTitle: 'Fix checkout' });
  assert.ok(matchRunningAction('http://[::1]:5173', [inst({ url: 'http://localhost:5173' })], runInfo));
});

test('a different port, or https vs http, does not match', () => {
  assert.equal(matchRunningAction('http://localhost:5174', [inst({ url: 'http://localhost:5173' })], runInfo), null);
  assert.equal(matchRunningAction('https://localhost:5173', [inst({ url: 'http://localhost:5173' })], runInfo), null);
  assert.equal(matchRunningAction('http://example.test:5173', [inst({ url: 'http://localhost:5173' })], runInfo), null);
});

test('an instance with no url matches on its bound ports', () => {
  const m = matchRunningAction('http://127.0.0.1:5173', [inst({ ports: { web: 5173 } })], runInfo);
  assert.equal(m.runId, 'r1');
  assert.equal(m.url, 'http://127.0.0.1:5173');
  assert.deepEqual(instanceOrigins(inst({ url: 'http://localhost:3000/x', ports: { a: 3001, b: 'x', c: 70000 } })), ['http://localhost:3000', 'http://localhost:3001']);
});

test('only ready/running instances count; the first match wins', () => {
  assert.equal(matchRunningAction('http://localhost:5173', [inst({ url: 'http://localhost:5173', status: 'starting' })], runInfo), null);
  const m = matchRunningAction('http://localhost:5173', [inst({ url: 'http://localhost:5173', status: 'exited' }), inst({ runId: 'r2', url: 'http://localhost:5173', status: 'running' })], runInfo);
  assert.equal(m.runId, 'r2');
});

test('a workspace run returns its workspaceId and no projectKey', () => {
  const m = matchRunningAction('http://localhost:5173', [inst({ runId: 'r2', url: 'http://localhost:5173' })], runInfo);
  assert.equal(m.workspaceId, 'shop');
  assert.equal(m.projectKey, null);
});

test('the answer carries only what the sidebar needs (no pid, ports or instance id)', () => {
  const m = matchRunningAction('http://localhost:5173', [inst({ url: 'http://localhost:5173', ports: { web: 5173 } })], () => null);
  assert.deepEqual(Object.keys(m).sort(), ['projectKey', 'runId', 'runTitle', 'url', 'workspaceId']);
  assert.deepEqual([m.projectKey, m.runTitle], [null, null]);
});

test('pageOrigin accepts http(s) only', () => {
  assert.equal(pageOrigin('http://localhost:5173/a?b#c'), 'http://localhost:5173');
  assert.equal(pageOrigin('https://Example.test/'), 'https://example.test');
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'chrome://extensions', 'not a url', '', null, 42, `http://x.test/${'a'.repeat(2050)}`]) assert.equal(pageOrigin(bad), null, String(bad).slice(0, 30));
  assert.equal(matchRunningAction(null, [inst({ url: 'http://localhost:5173' })], runInfo), null);
});
