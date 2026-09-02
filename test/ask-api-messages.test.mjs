// The live turn over WORCA_MOCK: frames to ask-done, 409/grace, 429, stop,
// attachments, the R-F route-level MOCK_ASK regression, mid-turn replay.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';

import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);

let homeDir, srv, base, wsBase, mod, prevHome;
const JSONH = { 'Content-Type': 'application/json' };
const MODEL = { model: 'claude-opus-5', effort: 'high' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-askmsg-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  mod = await import('../ui/server.mjs');
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  wsBase = `ws://127.0.0.1:${srv.address().port}/ws`;
});

after(async () => {
  for (const [, job] of mod._testing.askJobs) { try { job.turn?.stop?.(); } catch { /* reap */ } }
  if (srv) {
    // A RED WS test never reaches ws.close(), and an upgraded socket is NOT
    // destroyed by closeAllConnections() — server.close()'s callback then never
    // fires and the file hangs in teardown. Bound the wait so the failures
    // actually print (pair the red run with --test-force-exit).
    await Promise.race([
      new Promise((r) => { srv.close(r); srv.closeAllConnections?.(); }),
      new Promise((r) => { const t = setTimeout(r, 500); t.unref?.(); }),
    ]);
  }
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
// A conditional GET over node:http: global fetch stamps `cache-control: no-cache`
// onto any request that carries If-None-Match (Fetch spec: a conditional request
// gets cache mode "no-store"), and `fresh` then answers 200 by design.
const condGet = (p, headers) => new Promise((res, rej) => {
  http.get(`${base}${p}`, { headers }, (r) => { r.resume(); r.on('end', () => res(r.statusCode)); }).on('error', rej);
});
const newThread = async () => (await (await post('/api/ask/threads', {})).json()).thread;
const snapshot = async (id) => (await fetch(`${base}/api/ask/threads/${id}`)).json();

function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function tick() {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    })();
  });
}
// JOB frames only. The §17 contract splits ask-* into buffered job frames (they
// carry the per-job `seq`) and out-of-turn frames (ask-message / ask-title /
// ask-run-status — no seq, upserted by their own key). The user echo is an
// out-of-turn ask-message broadcast BEFORE the turn starts, so a bare
// type.startsWith('ask-') filter would put it at index 0 and break every
// ordering and seq-monotonic assertion below.
const framesFor = (msgs, threadId) => msgs.filter((m) => m.threadId === threadId
  && typeof m.type === 'string' && m.type.startsWith('ask-') && typeof m.seq === 'number');

test('validation: 404 unknown thread, 400 model/effort/context/text', async () => {
  assert.equal((await post('/api/ask/threads/ask_ffffffff/messages', { text: 'x', ...MODEL })).status, 404);
  const t = await newThread();
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', model: 'no-such-model', effort: 'high' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', model: 'claude-opus-5', effort: 'ultra' })).status, 400);
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', ...MODEL, context: { pipelineId: 'zz' } })).status, 400);
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: '   ', ...MODEL })).status, 400);
});

test('a full mock turn: 202, stamped frames to ask-done, persistence, session, title, echo', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text: 'hi there', ...MODEL });
  assert.equal(r.status, 202);
  const { userMessageId, assistantMessageId } = await r.json();
  assert.match(userMessageId, /^askm_[0-9a-f]{8}$/);
  // §7.4: NOTHING is stamped before the 202 — the row stays untitled (the header
  // reads "Ask Worca") until the D13 background title lands. That call runs
  // CONCURRENTLY with the turn, so by the time this GET is answered the row may
  // already carry the announced title — but never the prompt text. The frame is
  // written to the socket before the DB read below can be answered, but it is
  // parsed on a different socket — so WAIT for it rather than peeking at msgs.
  const early = (await snapshot(t.id)).thread.title;
  if (early !== null) {
    const announced = await waitFor(() => msgs.find((m) => m.type === 'ask-title' && m.threadId === t.id));
    assert.equal(early, announced.title,
      `no provisional title from the message route: null until the announced one (got ${JSON.stringify(early)})`);
  }
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  const frames = framesFor(msgs, t.id);
  assert.equal(frames[0].type, 'ask-start');
  assert.equal(frames[0].userMessageId, userMessageId);
  assert.equal(frames[0].messageId, assistantMessageId);
  for (let i = 1; i < frames.length; i += 1) {
    assert.equal(frames[i].seq, frames[i - 1].seq + 1, 'per-job monotonic seq');
  }
  const done = frames.at(-1);
  assert.equal(done.type, 'ask-done');
  assert.equal(done.status, 'done');
  assert.equal(done.threadTotals.turns, 1);
  const echo = msgs.find((m) => m.type === 'ask-message' && m.threadId === t.id);
  assert.ok(echo && echo.message.id === userMessageId, 'user message echoed for other tabs');
  const snap = await snapshot(t.id);
  const asst = snap.messages.find((m) => m.id === assistantMessageId);
  assert.equal(asst.status, 'done');
  assert.equal(asst.text, '[mock] hi there', 'the mock echoes the USER text — the context header was stripped');
  assert.equal(snap.thread.sessionId, 'mock-session-ask-1');
  assert.equal(snap.inFlight, null);
  // D13: the background title call titles the still-untitled thread and
  // announces it out-of-turn (under WORCA_MOCK it echoes the title prompt).
  const titled = await waitFor(() => msgs.find((m) => m.type === 'ask-title' && m.threadId === t.id));
  assert.ok(typeof titled.title === 'string' && titled.title, 'ask-title carries the new title');
  assert.equal((await snapshot(t.id)).thread.title, titled.title, 'the announced title is the stored one');
  ws.close();
});

test('409 while in flight; the 30 s grace entry never blocks the next turn', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW one', ...MODEL })).status, 202);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-start'));
  assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'second', ...MODEL })).status, 409);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  const again = await post(`/api/ask/threads/${t.id}/messages`, { text: 'third', ...MODEL });
  assert.equal(again.status, 202, 'a done grace entry never 409s');
  await waitFor(() => framesFor(msgs, t.id).filter((f) => f.type === 'ask-done').length >= 2);
  ws.close();
});

test('mid-turn reconnect: ?threadId= replay and {type:subscribe,threadId} both deliver the stamped prefix', async () => {
  const t = await newThread();
  const a = openWs(`?threadId=${t.id}`);
  await a.opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW replay me', ...MODEL });
  await waitFor(() => framesFor(a.msgs, t.id).length >= 3);
  const b = openWs(`?threadId=${t.id}`);
  await b.opened;
  await waitFor(() => framesFor(b.msgs, t.id).length >= 3);
  const seqOf = (list) => list.map((f) => `${f.seq}:${f.type}`);
  const bFrames = framesFor(b.msgs, t.id);
  assert.deepEqual(seqOf(bFrames.slice(0, 3)), seqOf(framesFor(a.msgs, t.id).slice(0, 3)), 'replayed prefix identical');
  const c = openWs();
  await c.opened;
  c.ws.send(JSON.stringify({ type: 'subscribe', threadId: t.id }));
  await waitFor(() => framesFor(c.msgs, t.id).length >= 3);
  assert.equal(framesFor(c.msgs, t.id)[0].seq, 1, 'in-band subscribe replays from the start');
  await waitFor(() => framesFor(a.msgs, t.id).some((f) => f.type === 'ask-done'));
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('429 at three global running turns', async () => {
  const ts = [await newThread(), await newThread(), await newThread()];
  const w = openWs();
  await w.opened;
  for (const t of ts) {
    assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW hold', ...MODEL })).status, 202);
  }
  const extra = await newThread();
  assert.equal((await post(`/api/ask/threads/${extra.id}/messages`, { text: 'x', ...MODEL })).status, 429);
  for (const t of ts) await post(`/api/ask/threads/${t.id}/stop`, {});
  await waitFor(() => ts.every((t) => framesFor(w.msgs, t.id).some((f) => f.type === 'ask-done')));
  w.ws.close();
});

test('stop: ask-done stopped/user with costUsd null; idempotent; bad shape 400', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'MOCK_SLOW stopping', ...MODEL });
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-delta'));
  assert.deepEqual(await (await post(`/api/ask/threads/${t.id}/stop`, {})).json(), { ok: true });
  const done = await waitFor(() => framesFor(msgs, t.id).find((f) => f.type === 'ask-done'));
  assert.equal(done.status, 'stopped');
  assert.equal(done.reason, 'user');
  assert.equal(done.costUsd, null, 'no result frame arrived before the abort');
  assert.deepEqual(await (await post(`/api/ask/threads/${t.id}/stop`, {})).json(), { ok: true }, 'idempotent after done');
  assert.equal((await post('/api/ask/threads/zzz/stop', {})).status, 400);
  const snap = await snapshot(t.id);
  const asst = snap.messages.at(-1);
  assert.equal(asst.status, 'stopped');
  assert.equal(asst.reason, 'user');
  assert.equal(asst.costUsd, null);
  assert.equal(snap.thread.totals.turns, 1, 'a null-cost turn still counts');
  ws.close();
});

test('R-F route regression: a chat message "MOCK_ASK: <path>" writes NOTHING — turn and title included', async () => {
  const probe = join(homeDir, 'mock-ask-probe.json');
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  const r = await post(`/api/ask/threads/${t.id}/messages`, { text: `MOCK_ASK: ${probe}`, ...MODEL });
  assert.equal(r.status, 202);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  await new Promise((res) => setTimeout(res, 400)); // the fire-and-forget title call (dontAsk, Task 2) settles
  assert.ok(!existsSync(probe), 'neither the turn nor the title call reached the legacy MOCK_ASK write arm');
  ws.close();
});

test('attachments: stored + block on the user message; caps enforced', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const ok = await post(`/api/ask/threads/${t.id}/messages`, {
    text: 'with files', ...MODEL,
    attachments: [{ name: 'notes.md', dataBase64: b64('# hello attachment') }],
  });
  assert.equal(ok.status, 202);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  const snap = await snapshot(t.id);
  assert.equal(snap.attachments.length, 1);
  assert.equal(snap.attachments[0].name, 'notes.md');
  const user = snap.messages.find((m) => m.role === 'user');
  assert.ok(user.blocks.some((b) => b.kind === 'attachment' && b.name === 'notes.md' && b.bytes > 0));
  const dl = await fetch(`${base}/api/ask/threads/${t.id}/attachments/${snap.attachments[0].id}`);
  assert.equal(await dl.text(), '# hello attachment');

  const t2 = await newThread();
  const send = (atts) => post(`/api/ask/threads/${t2.id}/messages`, { text: 'x', ...MODEL, attachments: atts, context: { view: 'history' } });
  const before = (await snapshot(t2.id)).thread;
  assert.equal((await send([{ name: 'evil.exe', dataBase64: b64('x') }])).status, 400);
  assert.equal((await send([{ name: 'big.md', dataBase64: Buffer.alloc(513 * 1024, 97).toString('base64') }])).status, 413);
  assert.equal((await send([{ name: 'bad.md', dataBase64: Buffer.from([0xff, 0xfe, 0xfd]).toString('base64') }])).status, 400);
  assert.equal((await send([{ name: 'nul.md', dataBase64: Buffer.from('a\u0000b', 'utf8').toString('base64') }])).status, 400);
  assert.equal((await send(Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.md`, dataBase64: b64('x') })))).status, 400);
  // Every check precedes the FIRST write (all-or-nothing): a rejected message
  // must leave the thread untouched — no context/model/title write, no rows.
  const after2 = await snapshot(t2.id);
  assert.equal(after2.thread.title, before.title, 'no deterministic title on a rejected message');
  assert.deepEqual(after2.thread.context, before.context, 'context not stored on a rejected message');
  assert.equal(after2.thread.model, before.model, 'model not stored on a rejected message');
  assert.deepEqual(after2.messages, [], 'no message rows written');
  assert.deepEqual(after2.attachments, [], 'no attachment rows written');
  ws.close();
});

test('binary attachments (#398): png + pdf stored with kind/mime, served with their real type; spoofed or oversized bodies refused', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0, 1, 2, 0xfe, 0xff])]);
  const pdf = Buffer.from('%PDF-1.7\nfake body\n%%EOF\n', 'latin1');
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  const ok = await post(`/api/ask/threads/${t.id}/messages`, {
    text: 'see the screenshot and the spec', ...MODEL,
    attachments: [
      { name: 'shot.png', dataBase64: png.toString('base64') },
      { name: 'spec.pdf', dataBase64: pdf.toString('base64') },
    ],
  });
  assert.equal(ok.status, 202);
  // the 202 carries the store-minted rows: the sender's echo keys its thumbnail
  // and thread budget off them without waiting for a broadcast it may have missed
  const okBody = await ok.json();
  assert.deepEqual(okBody.attachments.map((a) => [a.name, a.kind, a.mime, a.bytes]),
    [['shot.png', 'image', 'image/png', png.length], ['spec.pdf', 'binary', 'application/pdf', pdf.length]]);
  for (const a of okBody.attachments) assert.match(a.id, /^att_[0-9a-f]{8}$/);
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  const snap = await snapshot(t.id);
  const rows = Object.fromEntries(snap.attachments.map((a) => [a.name, a]));
  assert.equal(rows['shot.png'].id, okBody.attachments[0].id);
  assert.equal(rows['shot.png'].kind, 'image');
  assert.equal(rows['shot.png'].mime, 'image/png');
  assert.equal(rows['shot.png'].bytes, png.length);
  assert.equal(rows['spec.pdf'].kind, 'binary');
  assert.equal(rows['spec.pdf'].mime, 'application/pdf');
  const user = snap.messages.find((m) => m.role === 'user');
  assert.ok(user.blocks.some((b) => b.kind === 'attachment' && b.name === 'shot.png' && b.attKind === 'image' && b.mime === 'image/png'),
    'the message block carries attKind/mime for the UI thumbnail');
  // body on disk under the row id with the mime extension, never the user name
  // (worcaHome() is <WORCA_HOME>/.worca-cc)
  assert.ok(existsSync(join(homeDir, '.worca-cc', 'ask', t.id, 'att', `${rows['shot.png'].id}.png`)));
  assert.ok(existsSync(join(homeDir, '.worca-cc', 'ask', t.id, 'att', `${rows['spec.pdf'].id}.pdf`)));
  // the download route serves the REAL mime and the exact bytes
  const dl = await fetch(`${base}/api/ask/threads/${t.id}/attachments/${rows['shot.png'].id}`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-type'), /^image\/png/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), png, 'bytes round-trip unmangled');
  assert.equal(dl.headers.get('content-disposition'), 'inline');
  // a body is immutable under its id: cached for a year, revalidated by a stat
  // ETag (never a per-request sha1 of the whole file)
  assert.equal(dl.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.ok(dl.headers.get('etag'), 'an ETag is served');
  assert.ok(dl.headers.get('last-modified'), 'Last-Modified is served');
  assert.equal(await condGet(`/api/ask/threads/${t.id}/attachments/${rows['shot.png'].id}`, { 'If-None-Match': dl.headers.get('etag') }), 304, 'a matching ETag short-circuits the body');
  assert.equal(await condGet(`/api/ask/threads/${t.id}/attachments/${rows['shot.png'].id}`, { 'If-Modified-Since': dl.headers.get('last-modified') }), 304, 'so does Last-Modified');
  const dlPdf = await fetch(`${base}/api/ask/threads/${t.id}/attachments/${rows['spec.pdf'].id}`);
  assert.match(dlPdf.headers.get('content-type'), /^application\/pdf/);
  assert.equal((await fetch(`${base}/api/ask/threads/${t.id}/attachments/att_ffffffff`)).status, 404);

  // refusals, all before any write (the all-or-nothing shape of the text test)
  const t2 = await newThread();
  const send = (atts) => post(`/api/ask/threads/${t2.id}/messages`, { text: 'x', ...MODEL, attachments: atts });
  const spoof = await send([{ name: 'spoof.png', dataBase64: Buffer.from('plain text, not a png').toString('base64') }]);
  assert.equal(spoof.status, 400);
  assert.match((await spoof.json()).error, /does not match its extension/);
  assert.equal((await send([{ name: 'big.png', dataBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') }])).status, 413);
  assert.equal((await send([{ name: 'vector.svg', dataBase64: Buffer.from('<svg/>').toString('base64') }])).status, 400, 'svg stays off the allowlist');
  // The 64mb JSON window belongs to THIS route only: a ~13 MB body (two 5 MB
  // images, base64) reaches the route's own per-file 413 …
  const twoBig = await send([
    { name: 'ok.png', dataBase64: Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)]).toString('base64') },
    { name: 'over.png', dataBase64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') },
  ]);
  assert.equal(twoBig.status, 413);
  assert.match((await twoBig.json()).error, /attachment over/, 'the route, not the parser, answered');
  // … while the sibling routes keep the app-wide 8mb parser (a 9 MB PATCH dies
  // in body-parser, never reaching the handler's string-field read)
  const fat = await fetch(`${base}/api/ask/threads/${t2.id}`, { method: 'PATCH', headers: JSONH, body: JSON.stringify({ title: 'x'.repeat(9 * 1024 * 1024) }) });
  assert.equal(fat.status, 413);
  assert.equal((await snapshot(t2.id)).thread.title, null, 'the fat PATCH changed nothing');
  const after2 = await snapshot(t2.id);
  assert.deepEqual(after2.messages, [], 'no message rows written');
  assert.deepEqual(after2.attachments, [], 'no attachment rows written');
  ws.close();
});

test('M1: a title given at thread creation is NEVER replaced by the background title (D13 guard)', async () => {
  const r = await post('/api/ask/threads', { title: 'Named By Hand' });
  const t = (await r.json()).thread;
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'hello named', ...MODEL });
  await waitFor(() => framesFor(msgs, t.id).some((f) => f.type === 'ask-done'));
  await new Promise((res) => setTimeout(res, 400)); // give a (wrong) title call time to land
  assert.ok(!msgs.some((m) => m.type === 'ask-title' && m.threadId === t.id),
    'no ask-title frame: the haiku call is not even fired for a user-named thread');
  assert.equal((await snapshot(t.id)).thread.title, 'Named By Hand');
  ws.close();
});

test('M2: a reserved slot (ids still null) holds the 409 yet stays invisible to hello and GET', async () => {
  const t = await newThread();
  // The exact entry the message route reserves BEFORE its first write. Two
  // concurrent POSTs cannot pin this: every await between the top 409 check and
  // the reservation (validateModelEffort -> composeCatalog, askBuildCatalog ->
  // three synchronous better-sqlite3 reads, resolveAskContext) resolves in
  // microtasks, so a second request never enters the route mid-window
  // (empirically instrumented — a Promise.all race test passes on the UNFIXED
  // code and pins nothing).
  mod._testing.askJobs.set(t.id, {
    turn: null, messageId: null, userMessageId: null,
    events: [], seq: 0, status: 'running',
    startedAt: new Date().toISOString(), graceTimer: null,
  });
  try {
    assert.equal((await post(`/api/ask/threads/${t.id}/messages`, { text: 'x', ...MODEL })).status, 409,
      'the reservation blocks the next POST before any row exists');
    assert.equal((await snapshot(t.id)).inFlight, null,
      'GET reports no in-flight turn while the assistant row does not exist yet');
    const w = openWs();
    await w.opened;
    const hello = await waitFor(() => w.msgs.find((m) => m.type === 'hello'));
    assert.ok(!hello.ask.some((a) => a.threadId === t.id),
      'hello omits a slot whose assistant message id is still null');
    w.ws.close();
  } finally {
    mod._testing.askJobs.delete(t.id);
  }
});

test('MOCK_FAIL surfaces as ask-error with the runner message; the thread stays usable', async () => {
  const t = await newThread();
  const { ws, msgs, opened } = openWs(`?threadId=${t.id}`);
  await opened;
  await post(`/api/ask/threads/${t.id}/messages`, { text: 'please MOCK_FAIL now', ...MODEL });
  const err = await waitFor(() => framesFor(msgs, t.id).find((f) => f.type === 'ask-error'));
  assert.match(err.message, /claude exited with code 1: mock failure/);
  const snap = await snapshot(t.id);
  assert.equal(snap.messages.at(-1).status, 'error');
  assert.equal(snap.inFlight, null, 'grace entry, not running');
  const again = await post(`/api/ask/threads/${t.id}/messages`, { text: 'hello again', ...MODEL });
  assert.equal(again.status, 202, 'the thread survives an errored turn');
  await waitFor(() => framesFor(msgs, t.id).filter((f) => f.type === 'ask-done').length >= 1);
  ws.close();
});

// Review of PR #376: Ask spend counts toward totalCostLimitUsd (pipelines get
// 403'd / paused by it) but the message route never consulted budgetStatus(),
// so chat kept spending past the cap it filled.
test('POST /messages is 403 while the total cost window is spent — chat stops at the cap it helps fill', async () => {
  const { setTotalCostLimitUsd } = await import('../src/core/settings.mjs');
  const { recordAskCostDelta, budgetStatus } = await import('../src/core/cost-budget.mjs');
  const t = await newThread();
  await setTotalCostLimitUsd(1);
  try {
    recordAskCostDelta({ threadId: t.id, messageId: 'msg_budget01', amountUsd: 1.5 });
    assert.equal(budgetStatus().blocked, true, 'fixture: the window is spent by chat alone');
    const r = await post(`/api/ask/threads/${t.id}/messages`, { text: 'hi', ...MODEL });
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.match(body.error, /total cost limit/);
    assert.equal(body.budget.blocked, true);
    assert.equal((await snapshot(t.id)).messages.length, 0, 'nothing was written');
    assert.equal(mod._testing.askJobs.has(t.id), false, 'no turn started');
  } finally {
    await setTotalCostLimitUsd(null);
  }
});
