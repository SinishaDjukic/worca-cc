// test/wsmap-ids.test.mjs — workspace-map limits and stable ids (wsmap P1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIMITS, MAP_VERSION } from '../src/shared/workspace-map/limits.mjs';
import { hash64, entryId, edgeId, manualEdgeId } from '../src/shared/workspace-map/ids.mjs';

test('LIMITS is the frozen spec §9 table, MAP_VERSION is 1', () => {
  assert.equal(MAP_VERSION, 1);
  assert.ok(Object.isFrozen(LIMITS));
  assert.deepEqual({ ...LIMITS }, {
    MAX_FILES_PER_MEMBER: 50000, MAX_FILE_BYTES: 1048576, MEMBER_BUDGET_MS: 60000,
    MAX_FACTS_PER_MEMBER: 5000, MATCH_MAX: 200, DETAIL_MAX: 200, LABEL_MAX: 60, ROLE_MAX: 160,
    OTHER_KEY_MAX: 120, EVIDENCE_WINDOW: 3, EVIDENCE_PER_SIDE: 3,
    MAX_CANDIDATES_PER_ENTRY: 20, MAX_CANDIDATES_PER_MEMBER: 400,
    BRIEF_MAX_BYTES: 40960, SYNTH_BRIEF_MAX_BYTES: 61440,
    INVESTIGATOR_CONCURRENCY: 8, EXTRACT_POOL: 4,
    GRAPH_FULL_MAX_NODES: 60000, GRAPH_FULL_MAX_BYTES: 67108864,
    GRAPH_HOOD_HOPS: 2, GRAPH_HOOD_MAX_NODES_PER_MEMBER: 2000, CALLERS_PER_END: 3,
  });
});

test('hash64 is FNV-1a 64 over UTF-8: published vectors and multi-byte input', () => {
  assert.equal(hash64(''), 'cbf29ce484222325');
  assert.equal(hash64('a'), 'af63dc4c8601ec8c');
  assert.equal(hash64('foobar'), '85944171f73967e8');
  assert.equal(hash64('é'), '0ac21707b7181e01', 'two UTF-8 bytes, not one UTF-16 unit');
  assert.equal(hash64('日本'), '121d7e35a6d3ce91');
  assert.match(hash64('x'.repeat(5000)), /^[0-9a-f]{16}$/);
});

test('entryId / edgeId / manualEdgeId: prefix + truncated hash of the pipe-joined parts', () => {
  assert.equal(entryId('billing-api', 'http', 'http:GET /invoices/{}'), 'e_1759e37440');
  assert.equal(edgeId('web', 'billing-api', 'http', 'http:GET /invoices/{}'), 'x_81ad6dd3b863');
  assert.equal(manualEdgeId('web', 'billing-api', 'http', 'GET /x', '2026-09-25T10:00:00.000Z'), 'm_ab24bf3e5b9e');
  assert.notEqual(edgeId('web', 'billing-api', 'http', 'http:GET /invoices/{}'), edgeId('billing-api', 'web', 'http', 'http:GET /invoices/{}'),
    'direction is part of the id');
});
