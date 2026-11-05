import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOverlap, describePath } from '../tools/split-by-feature/overlap.mjs';

const r = (path, methods = ['get']) => ({ kind: 'route', methods, path: describePath(path) });
const mw = (source) => ({ kind: 'mw', re: { source, flags: 'i' } });

test('a param path overlaps a literal it can stand for; disjoint paths do not', () => {
  assert.equal(canOverlap(r('/api/runs/:id'), r('/api/runs/groups')), true);
  assert.equal(canOverlap(r('/api/runs/:id'), r('/api/chat')), false);
});
test('Express 5 paths: a named wildcard and an optional group', () => {
  assert.equal(canOverlap(r('/api/runs/:id/artifact-raw/*splat'), r('/api/runs/:id/artifact-raw/a/b')), true);
  assert.equal(canOverlap(r('/api/runs/:id/artifact-raw/*splat'), r('/api/runs/:id/logs')), false);
  assert.equal(canOverlap(r('/api/x{/:id}'), r('/api/x')), true);
  assert.equal(canOverlap(r('/api/x{/:id}'), r('/api/x/3')), true);
  assert.equal(canOverlap(r('/api/x{/:id}'), r('/api/y')), false);
});
test('array and regexp paths overlap conservatively', () => {
  assert.equal(canOverlap(r(['/api/a', '/api/runs/:id']), r('/api/runs/groups')), true);
  assert.equal(canOverlap(r(['/api/a', '/api/b']), r('/api/runs/groups')), false);
  assert.equal(canOverlap(r(/^\/api\/x/), r('/api/y')), true);
});
test('get vs post never overlap; all meets every verb', () => {
  assert.equal(canOverlap(r('/api/x', ['get']), r('/api/x', ['post'])), false);
  assert.equal(canOverlap(r('/api/x', ['all']), r('/api/x', ['post'])), true);
  assert.equal(canOverlap(r('/api/x', ['_all']), r('/api/x', ['delete'])), true);
});
test('a route vs a middleware mount', () => {
  assert.equal(canOverlap(r('/api/runs/:id'), mw('^\\/api\\/runs\\/groups\\/?(?=\\/|$)')), true);
  assert.equal(canOverlap(r('/api/chat'), mw('^\\/api\\/mcp\\/?(?=\\/|$)')), false);
  assert.equal(canOverlap(mw('^\\/api\\/mcp\\/?(?=\\/|$)'), r('/api/mcp/servers')), true);
});
