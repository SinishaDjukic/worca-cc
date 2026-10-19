// test/cli-run-preset.test.mjs — `worca run --preset NAME --prompt …` (#712 slice 3, D6–D8): resolves the name in
// scope, posts the New run body, and exits 1 naming the broken items or the available presets.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { resolve } from 'node:path';
import { cmdRun } from '../src/cli/run-preset.mjs';
import { presetRunBody } from '../src/shared/run-presets.mjs';
import { projectKey } from '../src/core/store.mjs';

const DIR = resolve('/tmp/worca-cli-run-preset-proj');
const KEY = projectKey(DIR);
const QUICK = { id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', scope: { kind: 'project', ref: KEY },
  setup: { workflowId: 'wf_default', guardrailsId: 'normal', humanInLoop: false, overlay: { nodes: { n_plan: { model: 'claude-haiku-4-5', effort: 'medium' } } } } };
const DOCS = { id: 'rp_bbbbbbbbbbbb', name: 'Docs pass', scope: { kind: 'global', ref: null }, setup: { workflowId: 'wf_default' } };
const ELSEWHERE = { id: 'rp_cccccccccccc', name: 'Other only', scope: { kind: 'project', ref: 'other-1a2b3c4d' }, setup: {} };

const servers = [];
after(() => { for (const s of servers) s.close(); });
async function fakeServer({ presets = [QUICK, DOCS, ELSEWHERE], run = { status: 200, body: { runId: 'run_1' } }, presetsStatus = 200,
  live = [{ id: '44599ed6', runId: 'run_1', status: 'running', live: true }] } = {}) {
  const posts = [];
  const runLists = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url === '/api/presets') return send(presetsStatus, presetsStatus === 200 ? { presets } : { error: 'not found' });
      if (req.method === 'POST' && req.url === '/api/run') { posts.push(JSON.parse(raw)); return send(run.status, run.body); }
      if (req.method === 'GET' && req.url.startsWith('/api/runs?')) { runLists.push(new URL(req.url, 'http://x').searchParams); return send(200, { pipelines: [], live }); }
      send(404, {});
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return { base: `http://127.0.0.1:${srv.address().port}`, posts, runLists };
}
function io(base) {
  const lines = { out: [], err: [] };
  return { lines, opts: { out: (s) => lines.out.push(s), err: (s) => lines.err.push(s), c: (_k, s) => s,
    fail: (m) => { throw Object.assign(new Error(m), { code: 'CLI_FAIL' }); }, ui: async () => base, cwd: DIR, pipelineWaitMs: 300 } };
}

test("worca run --preset 'Quick fix' --prompt x posts the same body as New run and exits 0", async () => {
  const srv = await fakeServer();
  const { lines, opts } = io(srv.base);
  assert.equal(await cmdRun(['--preset', 'quick FIX', '--prompt', 'x'], opts), 0);
  assert.equal(srv.posts.length, 1);
  // The keys a preset contributes to New run's body after a pick (ui/public/app.js). That this normalizes to
  // the hand-made body is slice 1's proof in test/api-run-presets.test.mjs "fromPreset".
  assert.deepEqual(srv.posts[0], { ...QUICK.setup, projectDir: DIR, prompt: 'x', presetId: QUICK.id });
  assert.deepEqual(srv.posts[0], presetRunBody(QUICK, { projectDir: DIR, prompt: 'x' }));
  // `worca logs` resolves pipeline ids (what `worca runs list` shows), not the runs-map id /api/run answers.
  assert.match(lines.out.join('\n'), /Started run 44599ed6 from preset "Quick fix" — follow it with: worca logs 44599ed6/);
  assert.equal(srv.runLists[0].get('projectDir'), DIR);
});

test('a run whose pipeline id does not show in time points at worca runs list, never at the runs-map id', async () => {
  const srv = await fakeServer({ live: [{ id: 'run_1', runId: 'run_1', status: 'starting', live: true }] });
  const { lines, opts } = io(srv.base);
  assert.equal(await cmdRun(['--preset', 'Quick fix', '--prompt', 'x'], opts), 0);
  assert.ok(srv.runLists.length > 1, 'it polls while the id is not known yet');
  assert.match(lines.out.join('\n'), /Started a run from preset "Quick fix" — find it with: worca runs list/);
  assert.doesNotMatch(lines.out.join('\n'), /worca logs run_1/);
});

test('a workspace run looks its pipeline id up by workspace', async () => {
  const srv = await fakeServer();
  const { lines, opts } = io(srv.base);
  assert.equal(await cmdRun(['--preset', 'Docs pass', '--prompt', 'x', '--workspace', 'ws_1'], opts), 0);
  assert.equal(srv.runLists[0].get('workspaceId'), 'ws_1');
  assert.match(lines.out.join('\n'), /worca logs 44599ed6/);
});

test('an unknown name exits 1 listing the available presets in scope, and posts nothing', async () => {
  const srv = await fakeServer();
  const { lines, opts } = io(srv.base);
  assert.equal(await cmdRun(['--preset', 'Quik fix', '--prompt', 'x'], opts), 1);
  assert.equal(srv.posts.length, 0);
  assert.match(lines.err.join('\n'), /no run preset named "Quik fix" for this project/);
  assert.match(lines.err.join('\n'), /Available: Quick fix, Docs pass/);
  assert.doesNotMatch(lines.err.join('\n'), /Other only/, 'a preset pinned to another project is not offered');
});

test('a preset pinned to another project exits 1 naming where it is pinned', async () => {
  const srv = await fakeServer();
  const { lines, opts } = io(srv.base);
  assert.equal(await cmdRun(['--preset', 'Other only', '--prompt', 'x'], opts), 1);
  assert.match(lines.err.join('\n'), /preset "Other only" is pinned to project other-1a2b3c4d/);
});

test('a broken preset exits 1 with one line per broken item', async () => {
  const broken = [{ item: 'guardrails', message: 'Guardrail set gr_1 no longer exists' }, { item: 'model', message: 'Planner: model my-gateway-opus is no longer in the catalog' }];
  const srv = await fakeServer({ run: { status: 409, body: { code: 'preset-broken', error: 'Preset "Quick fix" cannot start: …', broken } } });
  const { lines, opts } = io(srv.base);
  assert.equal(await cmdRun(['--preset', 'Quick fix', '--prompt', 'x'], opts), 1);
  assert.deepEqual(lines.err, ['worca run: Preset "Quick fix" cannot start:', '  - Guardrail set gr_1 no longer exists', '  - Planner: model my-gateway-opus is no longer in the catalog']);
});

test('no server, the flag off, and usage errors', async () => {
  const none = io(null);
  assert.equal(await cmdRun(['--preset', 'Quick fix', '--prompt', 'x'], none.opts), 1);
  assert.match(none.lines.err.join('\n'), /none is running — start it with: worca ui/);
  const off = await fakeServer({ presetsStatus: 404 });
  const o = io(off.base);
  assert.equal(await cmdRun(['--preset', 'Quick fix', '--prompt', 'x'], o.opts), 1);
  assert.match(o.lines.err.join('\n'), /run presets are turned off — turn them on with: worca flags on runPresets/);
  const dead = io('http://127.0.0.1:9');   // nothing listens on the discard port: the request is refused
  assert.equal(await cmdRun(['--preset', 'Quick fix', '--prompt', 'x'], dead.opts), 1);
  assert.match(dead.lines.err.join('\n'), /lost the Worca server/);
  await assert.rejects(cmdRun(['--prompt', 'x'], o.opts), /worca run needs --preset NAME/);
  await assert.rejects(cmdRun(['--preset', 'Quick fix'], o.opts), /worca run needs --prompt/);
  await assert.rejects(cmdRun(['--preset', '--prompt', 'x'], o.opts), /--preset needs a value/);
  await assert.rejects(cmdRun(['--preset', 'Quick fix', '--prompt', 'x', '--model', 'opus'], o.opts), /unknown option/);
});
