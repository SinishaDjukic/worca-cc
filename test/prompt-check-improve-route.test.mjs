// test/prompt-check-improve-route.test.mjs — POST /api/prompt-check/improve (ui/routes/prompt-check/improve-route.mjs).
// Boots the app in-process with WORCA_MOCK, a temp HOME (settings.json) and WORCA_HOME (the DB), and injects a
// counting runner through _setImproveRunnerForTest, so no model is ever spawned.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const HOME = mkdtempSync(join(tmpdir(), 'worca-cc-pci-home-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
process.env.WORCA_MOCK = '1';

const { _setImproveRunnerForTest } = await import('../src/core/prompt-check/improve.mjs');
const { _setImproveBucketForTest } = await import('../ui/routes/prompt-check/improve-route.mjs');
const { rewriteText } = await import('../src/shared/prompt-check/improve.mjs');
const { setChatPrefs, setTotalCostLimitUsd } = await import('../src/core/settings.mjs');
const { recordAskCostDelta } = await import('../src/core/cost-budget.mjs');
const { TokenBucket } = await import('../src/core/chat/rate-limiter.mjs');

let srv;
let port;
before(async () => {
  const mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
});
after(async () => {
  _setImproveRunnerForTest(null);
  _setImproveBucketForTest(null);
  if (srv) await new Promise((r) => srv.close(r));
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
  delete process.env.WORCA_MOCK;
  rmSync(HOME, { recursive: true, force: true });
});

const TASK = 'Add the zebra-5521 CSV export to the Insights page.';
const SONNET = { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' };
let seq = 0;
const body = (o = {}) => ({ requestId: `i-${++seq}`, surface: { kind: 'chat', id: `th_${seq}` }, text: TASK, kind: 'requirement', ...o });
const postTo = async (path, b) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json() };
};
const post = (b) => postTo('/api/prompt-check/improve', b);
function counting(reply = { sections: [{ id: 'who', text: 'a team lead' }] }) {
  const calls = [];
  const run = async (o) => { calls.push(o); return { text: JSON.stringify(typeof reply === 'function' ? reply(o) : reply) }; };
  return { calls, run };
}
function withRunner(t, run, pick = () => SONNET) {
  _setImproveRunnerForTest(run, pick);
  t.after(() => _setImproveRunnerForTest(null));
}
const promptCheck = (on) => setChatPrefs({ promptCheck: on });
function freshBucket(t) {
  _setImproveBucketForTest(new TokenBucket(1000));
  t.after(() => _setImproveBucketForTest(null));
}
function captureConsole(t) {
  const lines = [];
  const keep = {};
  for (const k of ['log', 'warn', 'error', 'debug', 'info']) {
    keep[k] = console[k];
    console[k] = (...a) => lines.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' '));
  }
  const restore = () => Object.assign(console, keep);
  t.after(restore);
  return { lines, restore };
}

test('validation: each 400 message, with 0 runner calls', async (t) => {
  await promptCheck(true);
  freshBucket(t);
  const { calls, run } = counting();
  withRunner(t, run);
  const cases = [
    [{ requestId: '' }, 'requestId is required'],
    [{ surface: { kind: 'nope', id: 'a' } }, 'surface is required'],
    [{ text: '  ' }, 'text is required'],
    [{ text: 'a'.repeat(20_001) }, 'text is too long'],
    [{ kind: undefined }, 'kind is invalid'],
    [{ kind: 'question' }, 'kind is invalid'],
    [{ openDecisions: 'x' }, 'openDecisions is invalid'],
    [{ openDecisions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, 'openDecisions is invalid'],
    [{ openDecisions: [1] }, 'openDecisions is invalid'],
    [{ projectKey: 'a', projectDir: '/b' }, 'project is invalid'],
    [{ projectKey: 5 }, 'project is invalid'],
    [{ projectDir: `/${'x'.repeat(1024)}` }, 'project is invalid'],
    [{ engine: 'nope' }, 'unknown engine'],
    [{ chatModel: 'x; rm -rf /' }, 'chatModel is invalid'],
  ];
  for (const [patch, error] of cases) {
    const r = await post(body(patch));
    assert.equal(r.status, 400, error);
    assert.deepEqual(r.body, { error });
  }
  assert.equal(calls.length, 0);
});

test('setting off → 409 with 0 runner calls; the 11th request in a minute → 429 and the runner count stays 10', async (t) => {
  await promptCheck(false);
  const { calls, run } = counting();
  withRunner(t, run);
  const off = await post(body());
  assert.equal(off.status, 409);
  assert.deepEqual(off.body, { error: 'prompt check is off' });
  assert.equal(calls.length, 0);
  await promptCheck(true);
  _setImproveBucketForTest(new TokenBucket(10, { now: () => 0 }));
  t.after(() => _setImproveBucketForTest(null));
  for (let i = 0; i < 10; i++) assert.equal((await post(body())).status, 200, `request ${i + 1}`);
  const last = await post(body());
  assert.equal(last.status, 429);
  assert.deepEqual(last.body, { error: 'too many rewrites, try again in a moment' });
  assert.equal(calls.length, 10);
});

test('one request makes exactly 1 runner call and answers the rewrite and its text form', async (t) => {
  await promptCheck(true);
  freshBucket(t);
  const { calls, run } = counting();
  withRunner(t, run);
  const b = body();
  const r = await post(b);
  assert.equal(calls.length, 1);
  assert.equal(r.body.requestId, b.requestId);
  assert.equal(r.body.source, 'model');
  assert.equal(r.body.kind, 'requirement');
  assert.equal(r.body.model, 'Sonnet 5.5');
  assert.equal(r.body.rewrite.sections[0].text, 'a team lead');
  assert.equal(r.body.text, rewriteText(r.body.rewrite));
  assert.deepEqual(r.body.paths, []);
  assert.deepEqual(Object.keys(r.body).sort(), ['kind', 'model', 'paths', 'requestId', 'rewrite', 'source', 'text']);
});

test('a second Improve on the same surface supersedes the first', async (t) => {
  await promptCheck(true);
  freshBucket(t);
  let n = 0;
  withRunner(t, async () => {
    n += 1;
    if (n === 1) return new Promise(() => {});
    return { text: JSON.stringify({ sections: [] }) };
  });
  const surface = { kind: 'new-run', id: 'form' };
  const first = post(body({ surface }));
  while (n < 1) await new Promise((r) => setTimeout(r, 5));
  const second = await post(body({ surface }));
  const a = await first;
  assert.equal(a.body.source, 'superseded');
  assert.equal(second.body.source, 'model');
  assert.equal(n, 2);
});

test('budget blocked → failed with total cost limit reached and 0 runner calls; no model → model unavailable', async (t) => {
  await promptCheck(true);
  freshBucket(t);
  const { calls, run } = counting();
  withRunner(t, run, () => null);
  _setImproveRunnerForTest(run, () => SONNET);
  await setTotalCostLimitUsd(1);
  recordAskCostDelta({ threadId: 'th_improve_budget', amountUsd: 5 });
  t.after(() => setTotalCostLimitUsd(''));
  const b = await post(body());
  assert.deepEqual(b.body, { requestId: b.body.requestId, source: 'failed', error: 'total cost limit reached', model: null });
  assert.equal(calls.length, 0);
  await setTotalCostLimitUsd('');
  _setImproveRunnerForTest(run, () => null);
  const none = await post(body());
  assert.equal(none.body.source, 'failed');
  assert.equal(none.body.error, 'model unavailable');
  assert.equal(calls.length, 0);
});

test('grounding: a registered project answers {path, inRepo} pairs only, no contents; a 400-character path is clipped', async (t) => {
  await promptCheck(true);
  freshBucket(t);
  const proj = mkdtempSync(join(tmpdir(), 'pci-proj-'));
  mkdirSync(join(proj, 'lib'));
  writeFileSync(join(proj, 'lib', 'real.mjs'), 'SENTINEL-quokka-6610');
  const outside = mkdtempSync(join(tmpdir(), 'pci-out-'));
  writeFileSync(join(outside, 'secret.mjs'), 'SENTINEL-quokka-6610');
  symlinkSync(join(outside, 'secret.mjs'), join(proj, 'lib', 'out.mjs'));
  t.after(() => { rmSync(proj, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  const added = await postTo('/api/projects', { name: 'pci', path: proj });
  assert.ok(added.status < 300, JSON.stringify(added.body));
  const long = `lib/${'a'.repeat(396)}`;
  const text = 'Use `lib/real.mjs`, `lib/missing.mjs`, `/etc/passwd`, `../x` and `lib/out.mjs`.';
  const { run } = counting({ sections: [{ id: 'scope', text }, { id: 'constraints', text: `\`${long}\`` }] });
  withRunner(t, run);
  const r = await post(body({ projectDir: proj }));
  assert.deepEqual(r.body.paths.slice(0, 5), [
    { path: 'lib/real.mjs', inRepo: true },
    { path: 'lib/missing.mjs', inRepo: false },
    { path: '/etc/passwd', inRepo: false },
    { path: '../x', inRepo: false },
    { path: 'lib/out.mjs', inRepo: false },
  ]);
  assert.equal(r.body.paths[5].path.length, 300);
  assert.equal(r.body.paths[5].inRepo, false);
  for (const p of r.body.paths) assert.deepEqual(Object.keys(p), ['path', 'inRepo']);
  assert.ok(!JSON.stringify(r.body).includes('SENTINEL'));
  const unreg = await post(body({ projectDir: outside }));
  assert.ok(unreg.body.paths.length > 0);
  assert.ok(unreg.body.paths.every((p) => p.inRepo === false));
  const unknownKey = await post(body({ projectKey: 'nope-00000000' }));
  assert.ok(unknownKey.body.paths.every((p) => p.inRepo === false));
});

function raw(path, headers, payload) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(payload);
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } }, (resp) => {
      let b = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { b += c; });
      resp.on('end', () => res({ status: resp.statusCode, body: b }));
    });
    r.on('error', rej);
    r.end(data);
  });
}

test('a non-local Host or a cross-site Origin is refused exactly like POST /api/ask/threads, with no model call or text in a log', async (t) => {
  await promptCheck(true);
  freshBucket(t);
  const { calls, run } = counting();
  withRunner(t, run);
  const { lines, restore } = captureConsole(t);
  for (const headers of [{ host: 'evil.example.com' }, { host: `127.0.0.1:${port}`, origin: 'https://evil.example.com' }]) {
    const ours = await raw('/api/prompt-check/improve', headers, body({ projectKey: 'pk-secret-1' }));
    const chat = await raw('/api/ask/threads', headers, {});
    assert.ok(ours.status >= 400, JSON.stringify(headers));
    assert.equal(ours.status, chat.status, JSON.stringify(headers));
    assert.equal(ours.body, chat.body, JSON.stringify(headers));
  }
  restore();
  assert.equal(calls.length, 0);
  for (const l of lines) assert.ok(!l.includes('zebra-5521') && !l.includes('pk-secret-1'), l);
});

test('the log: 1 fixed-field line per request, with no text, path or project', async (t) => {
  await promptCheck(true);
  freshBucket(t);
  const { run } = counting({ sections: [{ id: 'who', text: 'see `lib/hidden-otter.mjs`' }] });
  withRunner(t, run);
  const { lines, restore } = captureConsole(t);
  await post(body({ projectKey: 'pk-secret-2' }));
  await post(body({ projectDir: '/tmp/dir-secret-3' }));
  restore();
  const ours = lines.filter((l) => l.includes('prompt-check improve'));
  assert.equal(ours.length, 2, lines.join('\n'));
  assert.match(ours[0], /^\[worca\] prompt-check improve source=model surface=chat paths=1 notInRepo=1 \d+ms$/);
  for (const l of lines) {
    for (const s of ['zebra-5521', 'hidden-otter', 'pk-secret-2', 'dir-secret-3']) assert.ok(!l.includes(s), l);
  }
});
