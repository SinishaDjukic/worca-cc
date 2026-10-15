// test/api-pinpoint-demo-scenario.test.mjs — under WORCA_DEMO_SCENARIO a matching quote streams the scripted Explain
// (no "(mock · web surface)" prefix) and scripted alternatives; a miss keeps PINPOINT_MOCK.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
let srv, port;
before(async () => {
  process.env.HOME = process.env.WORCA_HOME; process.env.USERPROFILE = process.env.WORCA_HOME; process.env.WORCA_MOCK = '1';
  const f = join(process.env.WORCA_HOME, 'scenario.json');
  writeFileSync(f, JSON.stringify({ chunkMs: 0, pinpoint: [{ match: '$348', explain: 'That is 12 × $29: no discount at all.',
    alternatives: [{ title: 'Show $278/yr', detail: 'Apply the 20%.', tradeoffs: [{ tone: 'ok', text: 'Honest' }] }] }] }));
  process.env.WORCA_DEMO_SCENARIO = f;
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(async () => { if (srv) await new Promise((r) => srv.close(r)); delete process.env.WORCA_MOCK; delete process.env.WORCA_DEMO_SCENARIO; });

const post = async (body) => (await (await fetch(`http://127.0.0.1:${port}/api/pinpoint`, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).text()).trim().split('\n').map((l) => JSON.parse(l));

test('scripted Explain on the web surface, no mock prefix, several deltas', async () => {
  const out = await post({ action: 'explain', quote: 'Billed $348 per year', surface: 'web' });
  const deltas = out.filter((l) => l.type === 'delta');
  assert.ok(deltas.length >= 3);
  assert.equal(deltas.map((d) => d.text).join(''), 'That is 12 × $29: no discount at all.');
  assert.equal(out.at(-1).type, 'done');
});
test('scripted alternatives; a miss keeps the stock mock', async () => {
  const alts = (await post({ action: 'alternatives', quote: 'Billed $348 per year' })).find((l) => l.type === 'alternatives');
  assert.equal(alts.alternatives[0].title, 'Show $278/yr');
  const miss = (await post({ action: 'explain', quote: 'rate limits', surface: 'chat' })).filter((l) => l.type === 'delta').map((d) => d.text).join('');
  assert.match(miss, /^This is a mock explanation/);
});
