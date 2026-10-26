// test/requirements-helper-api.test.mjs — Ask Worca over HTTP in mock mode, behind the flag (plans/requirements-a3-design.md §5, D10–D16, D19).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';

let home; let srv; let base; let prev; let projKey; let projDir;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-req-helper-api-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_MOCK_HELPER_MS', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'requirements';
  delete process.env.WORCA_MOCK_HELPER_MS;
  (await import('../src/core/db.mjs'))._resetForTests();
  projDir = await mkdtemp(join(home, 'shop-'));
  const { addProject } = await import('../src/core/projects.mjs');
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  srv = (await import('../ui/server.mjs')).server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  (await import('../src/core/db.mjs'))._resetForTests();
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
};
const waitFor = async (pred, ms = 8000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const helper = async (seq) => (await call('GET', `/api/requirements/${seq}/helper`)).json;
const idle = (seq) => waitFor(async () => (await helper(seq)).answering === false);
/** A feature waiting for round 1's answers (the mock round asks "who" and "when"). */
async function pendingFeature(title = 'Cancel order') {
  const c = await call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title, description: 'Before it ships' });
  const seq = c.json.feature.seq;
  await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'your_turn');
  return { seq, feature: (await call('GET', `/api/requirements/${seq}`)).json.feature };
}

test('the chat in mock mode: send, a draft and a proposal, Accept, a dropped draft after Submit, Clear chat; frames', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const frames = [];
  ws.on('message', (d) => { try { const m = JSON.parse(String(d)); if (m.type === 'requirements-changed') frames.push(m); } catch { /* other frames */ } });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    const { seq, feature } = await pendingFeature();
    assert.deepEqual(feature.helper, { answering: false, messages: 0 });
    assert.deepEqual(await helper(seq), { messages: [], answering: false, estimate: null });
    frames.length = 0;
    const s = await call('POST', `/api/requirements/${seq}/helper/messages`, { text: 'Who may do this?', focus: { roundTurnId: feature.pending.turnId, questionId: 'who' } });
    assert.equal(s.status, 202);
    assert.deepEqual(s.json.messages[0].focus, { roundTurnId: feature.pending.turnId, questionId: 'who', n: 1 });
    await waitFor(async () => (await helper(seq)).messages.length === 2);
    let h = await helper(seq);
    assert.equal(h.answering, false);
    const w = h.messages[1];
    assert.equal(w.text, "[mock] Worca's answer to: Who may do this?");
    assert.deepEqual(w.drafts, [{ question: 'who', n: 1, option: 'Support agents', why: "[mock] Worca's reason for this draft.", dropped: false }]);
    assert.deepEqual(w.proposals.map((p) => [p.n, p.target, p.change, p.state, p.stale, p.askedAgain]), [[1, 'criterion', 'add', 'proposed', false, false]]);
    await waitFor(async () => frames.filter((f) => f.seq === seq).length >= 2);
    assert.deepEqual((await call('GET', `/api/requirements/${seq}`)).json.feature.helper, { answering: false, messages: 2 });
    frames.length = 0;
    const a = await call('POST', `/api/requirements/${seq}/helper/messages/${w.id}/proposals/1/accept`, {});
    assert.equal(a.status, 200);
    const accepted = a.json.messages[1].proposals[0];
    assert.equal(accepted.state, 'accepted');
    const crit = (await call('GET', `/api/requirements/${seq}`)).json.feature.spec.criteria;
    assert.equal(crit.find((x) => x.text === '[mock] A criterion Worca suggests.').id, accepted.appliedId);
    assert.ok(frames.some((f) => f.seq === seq), 'Accept sends the feature frame');
    assert.equal((await call('POST', `/api/requirements/${seq}/helper/messages/${w.id}/proposals/1/reject`, {})).status, 409);
    await call('POST', `/api/requirements/${seq}/helper/messages`, { text: 'More?' });
    await waitFor(async () => (await helper(seq)).messages.length === 4);
    assert.deepEqual((await helper(seq)).messages[3].proposals, [], 'the criterion exists now: not proposed again');
    await call('POST', `/api/requirements/${seq}/answers`, { roundTurnId: feature.pending.turnId, useRecommended: true });
    await waitFor(async () => (await call('GET', `/api/requirements/${seq}`)).json.feature.status === 'done');
    h = await helper(seq);
    assert.equal(h.messages[1].drafts[0].dropped, true, 'its round is answered');
    frames.length = 0;
    const d = await call('DELETE', `/api/requirements/${seq}/helper`);
    assert.deepEqual([d.status, d.json.messages], [200, []]);
    assert.ok(frames.some((f) => f.seq === seq), 'Clear chat sends the feature frame');
    assert.ok((await call('GET', `/api/requirements/${seq}`)).json.feature.spec.criteria.some((x) => x.text === '[mock] A criterion Worca suggests.'));
  } finally { ws.close(); }
});

test('§5 refusals: the 2,000-character cap, unknown messages and proposals, Stop with nothing running, nothing to try again', async () => {
  const { seq } = await pendingFeature('Caps');
  for (const text of ['', '   ', 'x'.repeat(2001), 7, undefined]) {
    const r = await call('POST', `/api/requirements/${seq}/helper/messages`, { text });
    assert.deepEqual([r.status, r.json.error], [400, 'a message is 1 to 2,000 characters'], JSON.stringify(text));
  }
  assert.equal((await call('POST', `/api/requirements/${seq}/helper/messages`, { text: 'x'.repeat(2000) })).status, 202);
  await idle(seq);
  const [po, w] = (await helper(seq)).messages;
  for (const path of [`999999/proposals/1/accept`, `abc/proposals/1/accept`, `${w.id}/proposals/9/accept`, `${w.id}/proposals/x/reject`, `${po.id}/proposals/1/accept`]) {
    assert.equal((await call('POST', `/api/requirements/${seq}/helper/messages/${path}`, {})).status, 404, path);
  }
  assert.deepEqual(await call('POST', `/api/requirements/${seq}/helper/stop`, {}).then((r) => [r.status, r.json.error]), [409, 'Worca is not answering.']);
  assert.deepEqual(await call('POST', `/api/requirements/${seq}/helper/retry`, {}).then((r) => [r.status, r.json.error]), [409, 'There is nothing to try again.']);
  assert.equal((await call('POST', '/api/requirements/999999/helper/messages', { text: 'hi' })).status, 404);
  assert.equal((await call('GET', '/api/requirements/999999/helper')).status, 404);
});

test('D12/D20: while Worca answers Send and Clear chat wait; Stop keeps the message and records STOPPED; Try again asks it again', async () => {
  const { seq } = await pendingFeature('Stop');
  process.env.WORCA_MOCK_HELPER_MS = '5000';
  try {
    const s = await call('POST', `/api/requirements/${seq}/helper/messages`, { text: 'Slow' });
    assert.equal(s.json.answering, true);
    assert.deepEqual(await call('POST', `/api/requirements/${seq}/helper/messages`, { text: 'Again' }).then((r) => [r.status, r.json.error]),
      [409, 'Worca is still answering. Try again in a moment.']);
    assert.equal((await call('DELETE', `/api/requirements/${seq}/helper`)).status, 409);
    const st = await call('POST', `/api/requirements/${seq}/helper/stop`, {});
    assert.equal(st.status, 200);
    assert.deepEqual(st.json.messages.map((m) => [m.role, m.text, m.error]),
      [['po', 'Slow', null], ['worca', '', { code: 'STOPPED', message: 'You stopped this reply.' }]]);
  } finally { delete process.env.WORCA_MOCK_HELPER_MS; }
  const t = await call('POST', `/api/requirements/${seq}/helper/retry`, {});
  assert.equal(t.status, 202);
  await waitFor(async () => { const m = (await helper(seq)).messages.at(-1); return m.role === 'worca' && !m.error; });
});

test('D10 Ask again over HTTP: a stale proposal only (202); the card says it was asked again', async () => {
  const { seq } = await pendingFeature('Ask again');
  const { insertHelperMessage } = await import('../src/core/requirements/store.mjs');
  const { normalizeHelperReply } = await import('../src/core/requirements/helper.mjs');
  const f = (await call('GET', `/api/requirements/${seq}`)).json.feature;
  const { proposals } = normalizeHelperReply({ text: 't', proposals: [{ target: 'rules', change: 'set', value: ['A refund goes back the way the order was paid'], reason: 'r' }] }, { spec: f.spec });
  const m = insertHelperMessage({ featureSeq: seq, role: 'worca', text: 't', proposals });
  assert.equal((await call('POST', `/api/requirements/${seq}/helper/messages/${m.id}/proposals/1/ask-again`, {})).status, 409);
  assert.equal((await call('PUT', `/api/requirements/${seq}/spec/rules`, { value: ['Refund in 3 days'] })).status, 200);
  const card = (await helper(seq)).messages.find((x) => x.id === m.id).proposals[0];
  assert.deepEqual([card.stale, card.added, card.removed], [true, ['A refund goes back the way the order was paid'], []]);
  const r = await call('POST', `/api/requirements/${seq}/helper/messages/${m.id}/proposals/1/ask-again`, {});
  assert.equal(r.status, 202);
  assert.deepEqual(r.json.messages.find((x) => x.role === 'po').focus, { askAgain: { msgId: m.id, n: 1 } });
  await idle(seq);
  assert.equal((await helper(seq)).messages.find((x) => x.id === m.id).proposals[0].askedAgain, true);
});

test('D9 (user decision 2026-10-26): Worca\'s add is stale once the spec has its text; the card says so and Accept answers 409', async () => {
  const { seq } = await pendingFeature('Stale add');
  await call('POST', `/api/requirements/${seq}/helper/messages`, { text: 'Hi' });
  await idle(seq);
  const w = (await helper(seq)).messages[1];
  assert.deepEqual([w.proposals[0].change, w.proposals[0].stale], ['add', false]);
  assert.equal((await call('POST', `/api/requirements/${seq}/criteria`, { text: '[MOCK] a criterion Worca suggests.' })).status, 200);
  assert.equal((await helper(seq)).messages[1].proposals[0].stale, true);
  assert.deepEqual(await call('POST', `/api/requirements/${seq}/helper/messages/${w.id}/proposals/1/accept`, {}).then((r) => [r.status, r.json.error]),
    [409, 'The spec changed since Worca proposed this.']);
  assert.equal((await call('GET', `/api/requirements/${seq}`)).json.feature.spec.criteria.filter((c) => /criterion worca suggests/i.test(c.text)).length, 1);
});

test('D16: an archived feature\'s chat can be read, not used', async () => {
  const { seq } = await pendingFeature('Archived');
  await call('POST', `/api/requirements/${seq}/helper/messages`, { text: 'Hi' });
  await idle(seq);
  const w = (await helper(seq)).messages[1];
  assert.equal((await call('POST', `/api/requirements/${seq}/archive`, {})).status, 200);
  const read = await call('GET', `/api/requirements/${seq}/helper`);
  assert.deepEqual([read.status, read.json.messages.length], [200, 2]);
  for (const [method, path] of [['POST', 'helper/messages'], ['POST', 'helper/retry'], ['DELETE', 'helper'],
    ['POST', `helper/messages/${w.id}/proposals/1/accept`], ['POST', `helper/messages/${w.id}/proposals/1/reject`], ['POST', `helper/messages/${w.id}/proposals/1/ask-again`]]) {
    const r = await call(method, `/api/requirements/${seq}/${path}`, method === 'DELETE' ? undefined : { text: 'Hi' });
    assert.deepEqual([r.status, r.json.error], [409, 'this feature is archived; restore it first'], `${method} ${path}`);
  }
});

test('flag off: the chat routes answer the gate\'s 404', async () => {
  delete process.env.WORCA_FLAGS;
  try {
    const r = await call('GET', '/api/requirements/1/helper');
    assert.deepEqual([r.status, r.json], [404, { error: 'not found' }]);
  } finally { process.env.WORCA_FLAGS = 'requirements'; }
});
