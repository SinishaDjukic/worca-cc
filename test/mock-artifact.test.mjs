// test/mock-artifact.test.mjs — the pure parts of the mock artifact tool (tools/mock-artifact/, docs/screenshots.md):
// how a recording becomes the page's lookup table, how the crawl picks its routes, and the path scrub. The tool
// itself needs Chrome and a real server, so it is not run here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { httpTable, wsFrames } from '../tools/mock-artifact/build.mjs';
import { cleanRoute, enqueue, MAX_ROUTES, PER_SHAPE, routeShape, scrubText } from '../tools/mock-artifact/record.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('httpTable keys answers by method, path, query and body, falls back to method and path, and drops the chat turn', () => {
  const rec = {
    http: [
      { method: 'GET', url: '/api/runs?limit=5', status: 200, ct: 'application/json', text: '[1]' },
      { method: 'GET', url: '/api/runs?limit=9', status: 200, ct: 'application/json', text: '[2]' },
      { method: 'POST', url: '/api/ask/mcp-preview', body: '{"a":1}', status: 200, ct: 'application/json', text: '{"x":1}' },
      { method: 'GET', url: '/assets/logo.png', status: 200, ct: 'image/png', b64: 'AA==' },
      { method: 'GET', url: '/api/broken', err: 'TypeError' },
      { method: 'GET', url: '/api/settings', status: 200, ct: 'application/json', text: '{"theme":"light","uiLevel":"expert"}' },
      { method: 'GET', url: '/api/ask/threads', status: 200, ct: 'application/json', text: '{"after":"turn"}' },
    ],
    turnMark: { http: 6, ws: 0 },
    ws: [],
  };
  const t = httpTable(rec);
  assert.equal(t['GET /api/runs?limit=5'].t, '[1]');
  assert.equal(t['GET /api/runs'].t, '[2]', 'the bare path answers with the latest response');
  assert.equal(t['POST /api/ask/mcp-preview {"a":1}'].t, '{"x":1}');
  assert.equal(t['GET /assets/logo.png'], undefined, 'only /api/* is replayed by fetch');
  assert.equal(t['GET /api/broken'], undefined, 'a failed request is not an answer');
  assert.equal(JSON.parse(t['GET /api/settings'].t).theme, 'system', 'the page follows the viewer’s theme');
  assert.equal(t['GET /api/ask/threads'], undefined, 'state after the chat turn is not the start state');
});

test('wsFrames keeps the server’s frames before the chat turn', () => {
  const rec = { http: [], ws: [{ dir: 'in', data: 'a' }, { dir: 'out', data: 'b' }, { dir: 'in', data: 'c' }, { dir: 'in', data: 'turn' }], turnMark: { http: 0, ws: 3 } };
  assert.deepEqual(wsFrames(rec), ['a', 'c']);
});

test('routeShape folds ids so the crawl visits a few pages of each kind', () => {
  assert.equal(routeShape('history/nimbus-crm-80bff96a/534c09ce'), 'history/:id/:id');
  assert.equal(routeShape('running/6b4bb974-9976-4d18-ae0d-7f6cb7ea811a'), 'running/:id');
  assert.equal(routeShape('chat/ask_551bb910'), 'chat/:id');
  assert.equal(routeShape('workspaces/wks-nimbus-31608a56/map'), 'workspaces/:id/map');
  assert.equal(routeShape('settings/guardrails'), 'settings/guardrails');
});

test('cleanRoute and enqueue: no duplicates, at most PER_SHAPE of a shape, never past MAX_ROUTES', () => {
  assert.equal(cleanRoute('#settings/runs'), 'settings/runs');
  assert.equal(cleanRoute('#'), null);
  assert.equal(cleanRoute('#a b'), null);
  assert.equal(cleanRoute('#x?y=1'), null);
  const q = ['chat'];
  const shapes = new Map([['chat', 1]]);
  enqueue(q, ['#chat', '#models', '#history/p-aaaaaaaa/11111111', '#history/p-bbbbbbbb/22222222', '#history/p-cccccccc/33333333'], shapes);
  assert.deepEqual(q, ['chat', 'models', 'history/p-aaaaaaaa/11111111', 'history/p-bbbbbbbb/22222222']);
  assert.equal(PER_SHAPE, 2);
  const big = [];
  enqueue(big, Array.from({ length: MAX_ROUTES + 20 }, (_, i) => `#page${i}`), new Map());
  assert.equal(big.length, MAX_ROUTES);
});

test('scrubText replaces the checkout and sandbox paths, plain, URL-encoded and via /private', () => {
  const ctx = { repo: '/Users/someone/dev/worca/', sandbox: '/tmp/worca-mock-sandbox' };
  const text = [
    '/Users/someone/dev/worca/agents/plan.md',
    '/private/tmp/worca-mock-sandbox/code/nimbus-crm',
    'projectDir=%2Ftmp%2Fworca-mock-sandbox%2Fcode%2Fnimbus-crm',
  ].join('\n');
  const out = scrubText(text, ctx);
  assert.ok(!out.includes('someone'), out);
  assert.ok(!out.includes('worca-mock-sandbox'), out);
  assert.match(out, /\/Users\/maya\/.local\/lib\/worca\/agents\/plan\.md/);
  assert.match(out, /^\/Users\/maya\/code\/nimbus-crm$/m);
  assert.match(out, /projectDir=%2FUsers%2Fmaya%2Fcode%2Fnimbus-crm/);
});

test('npm run mock:artifact runs the tool', () => {
  assert.equal(pkg.scripts['mock:artifact'], 'node --disable-warning=ExperimentalWarning tools/mock-artifact.mjs');
});
