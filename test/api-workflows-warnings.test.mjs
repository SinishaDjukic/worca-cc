// test/api-workflows-warnings.test.mjs — POST /api/workflows surfaces the SOFT
// half of validateGraph. v2 warnings are objects ({code, msg, nodeId?/wireId?}),
// not the v1 validator's governance strings: warnings never block, so a template
// that only trips a W rule persists and answers 201 with them attached, while an
// E rule answers 422 {errors, warnings} and writes nothing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let srv, base, homeDir, prevHome;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wfwarn-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
});

const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

/** task -> planner -> implementer -> end; `implCfg` seeds the node under test. */
function template(name, implCfg = {}) {
  return {
    name, version: 2, domain: 'coding',
    nodes: [
      { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
      { id: 'n_plan', kind: 'agent', key: 'planner', x: 320, y: 200, config: {} },
      { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 200, config: implCfg },
      { id: 'n_end', kind: 'end', x: 880, y: 200, config: {} },
    ],
    wires: [
      { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
      { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
      { id: 'w3', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_end', port: 'result' } },
    ],
  };
}

test('an unknown node config key saves 201 WITH a V17 warning object', async () => {
  const r = await post('/api/workflows', template('Warny', { bogusKey: 1 }));
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.ok(data.workflow && data.workflow.id, 'workflow persisted — warnings never block');
  assert.ok(Array.isArray(data.warnings) && data.warnings.length >= 1, 'warnings surfaced');
  const v17 = data.warnings.find((w) => w.code === 'V17');
  assert.ok(v17, 'unknown config keys are V17');
  assert.equal(v17.nodeId, 'n_impl');
  assert.match(v17.msg, /unknown config key 'bogusKey'/);
  // The unknown key is preserved verbatim on the stored node, not stripped.
  const stored = await (await fetch(`${base}/api/workflows/${data.workflow.id}`)).json();
  assert.deepEqual(stored.nodes.find((n) => n.id === 'n_impl').config, { bogusKey: 1 });
});

test('an unknown WIRE config key warns against the wire id', async () => {
  const tpl = template('Wire Warny');
  tpl.wires[1] = { ...tpl.wires[1], config: { bogus: 2 } };
  const r = await post('/api/workflows', tpl);
  assert.equal(r.status, 201);
  const { warnings } = await r.json();
  const v17 = warnings.find((w) => w.code === 'V17' && w.wireId === 'w2');
  assert.ok(v17, 'wire-level V17 carries wireId, not nodeId');
  assert.equal(v17.nodeId, undefined);
});

test('a no-op awaitAll barrier saves 201 with a V16 warning', async () => {
  const r = await post('/api/workflows', template('Barrier', { awaitAll: true }));
  assert.equal(r.status, 201);
  const { warnings } = await r.json();
  assert.ok(warnings.some((w) => w.code === 'V16' && w.nodeId === 'n_impl'));
});

test('a clean topology saves 201 with warnings: []', async () => {
  const r = await post('/api/workflows', template('Cleany'));
  assert.equal(r.status, 201);
  const data = await r.json();
  assert.deepEqual(data.warnings, []);
});

test('errors block and persist nothing; warnings ride along in the 422 body', async () => {
  // Delete the End node: V21/V5 fire (errors) while the orphaned node also
  // trips V15 (warning) — the 422 must carry BOTH halves.
  const tpl = template('Blocked', { bogusKey: 1 });
  tpl.nodes = tpl.nodes.filter((n) => n.id !== 'n_end');
  tpl.wires = tpl.wires.filter((w) => w.to.node !== 'n_end');

  const r = await post('/api/workflows', tpl);
  assert.equal(r.status, 422);
  const data = await r.json();
  assert.ok(data.errors.some((e) => e.code === 'V21'), 'a template needs exactly one end node');
  assert.ok(data.warnings.some((w) => w.code === 'V17'), 'soft findings ride along');
  assert.equal(data.workflow, undefined, 'nothing is persisted on a blocked save');

  const list = await (await fetch(`${base}/api/workflows`)).json();
  assert.ok(!list.workflows.some((w) => w.name === 'Blocked'));
});
