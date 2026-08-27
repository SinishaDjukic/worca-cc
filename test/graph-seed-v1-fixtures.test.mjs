// test/graph-seed-v1-fixtures.test.mjs
// The 7 hand-written v1 rows the seeds were converted FROM. P4's dual-engine parity
// suite runs these on the LIVE v1 engine and their v2 twins on the graph engine, so a
// fixture that does not correspond to its seed would silently compare two different
// pipelines. This file proves the correspondence through the SAME static maps the
// V24 overlay migration uses — nothing here is hand-checked prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_TEMPLATES, NODE_ID_MAP, FB_WIRE_MAP } from '../src/core/graph/seed-templates.mjs';

const DIR = fileURLToPath(new URL('./fixtures/workflows-v1/', import.meta.url));
const load = (id) => JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'));
/** `s<rank>_<col>` sorts by rank, then column — the v1 step order. */
const byPosition = (a, b) => {
  const pa = /^s(\d+)_(\d+)$/.exec(a); const pb = /^s(\d+)_(\d+)$/.exec(b);
  return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]);
};

test('every seed has a v1 fixture with the v1 template shape', () => {
  assert.equal(SEED_TEMPLATES.length, 7);
  for (const seed of SEED_TEMPLATES) {
    const fx = load(seed.id);
    assert.equal(fx.id, seed.id);
    assert.equal(fx.name, seed.name, `${seed.id}: same display name`);
    assert.equal(fx.domain, seed.domain);
    assert.equal(fx.version, 1, `${seed.id}: the fixture is a v1 row`);
    assert.ok(Array.isArray(fx.steps) && fx.steps.every((g) => Array.isArray(g)), `${seed.id}: steps are groups`);
    assert.ok(Array.isArray(fx.feedbacks));
    assert.equal(typeof fx.createdAt, 'string');
    assert.equal(typeof fx.updatedAt, 'string');
    for (const fb of fx.feedbacks) assert.deepEqual(Object.keys(fb).sort(), ['from', 'id', 'to'], `${seed.id}: v1 feedbacks carry no maxCycles`);
  }
});

test('fixture steps are the seed agent nodes, in NODE_ID_MAP order and with their keys', () => {
  for (const seed of SEED_TEMPLATES) {
    const fx = load(seed.id);
    const map = NODE_ID_MAP[seed.id];
    assert.ok(map, `${seed.id}: NODE_ID_MAP entry`);
    const expectedIds = Object.keys(map).sort(byPosition);
    assert.deepEqual(fx.steps.map((g) => g[0].id), expectedIds, `${seed.id}: one group per mapped step, in order`);
    assert.deepEqual(fx.steps.map((g) => g.length), expectedIds.map(() => 1), `${seed.id}: every seed is linear`);
    const nodeById = new Map(seed.nodes.map((n) => [n.id, n]));
    for (const group of fx.steps) {
      const nodeId = map[group[0].id];
      assert.ok(nodeId, `${seed.id}: ${group[0].id} is mapped`);
      assert.equal(group[0].key, nodeById.get(nodeId).key, `${seed.id}: ${group[0].id} keeps its agent key`);
    }
    // …and every agent node of the seed is represented (nothing dropped).
    const agents = seed.nodes.filter((n) => n.kind === 'agent').map((n) => n.id).sort();
    assert.deepEqual(Object.values(map).sort(), agents, `${seed.id}: the map covers every agent node`);
  }
});

test('fixture feedbacks are the seed loop wires, resolved through the OR valve', () => {
  for (const seed of SEED_TEMPLATES) {
    const fx = load(seed.id);
    const fbMap = FB_WIRE_MAP[seed.id];
    const inv = Object.fromEntries(Object.entries(NODE_ID_MAP[seed.id]).map(([v1, v2]) => [v2, v1]));
    const wireById = new Map(seed.wires.map((w) => [w.id, w]));
    const nodeById = new Map(seed.nodes.map((n) => [n.id, n]));
    assert.equal(fx.feedbacks.length, Object.keys(fbMap).length, `${seed.id}: one feedback per mapped wire`);
    for (const fb of fx.feedbacks) {
      const wireId = fbMap[fb.id];
      assert.ok(wireId, `${seed.id}: ${fb.id} is mapped to a wire`);
      const wire = wireById.get(wireId);
      assert.ok(wire, `${seed.id}: ${wireId} exists in the seed`);
      assert.equal(wire.config?.maxCycles, 3, `${seed.id}: ${wireId} is a budgeted loop wire`);
      assert.equal(inv[wire.from.node], fb.from, `${seed.id}: ${fb.id} source`);
      // The OR valve did not exist in v1: the v1 target is whatever `or.out` feeds.
      let target = wire.to.node;
      if (nodeById.get(target)?.kind === 'or') {
        const out = seed.wires.find((w) => w.from.node === target && w.from.port === 'out');
        assert.ok(out, `${seed.id}: the valve has an out wire`);
        target = out.to.node;
      }
      assert.equal(inv[target], fb.to, `${seed.id}: ${fb.id} target`);
    }
  }
});
