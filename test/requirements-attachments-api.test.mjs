// test/requirements-attachments-api.test.mjs — files over HTTP in mock mode, behind the flag (plans/requirements-a8-design.md §5, D10, D18).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import express from 'express';

let home; let srv; let base; let prev; let projKey; let projDir; let mod;
before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-req-att-api-'));
  prev = {};
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_FLAGS', 'WORCA_MOCK', 'WORCA_MOCK_READ_MS', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) prev[k] = process.env[k];
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.WORCA_HOME = join(home, 'worca-home');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_FLAGS = 'requirements';
  (await import('../src/core/db.mjs'))._resetForTests();
  projDir = await mkdtemp(join(home, 'shop-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't'], ['commit', '-q', '--allow-empty', '-m', 'init']]) {
    spawnSync('git', a, { cwd: projDir });
  }
  const { addProject } = await import('../src/core/projects.mjs');
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  mod = await import('../ui/server.mjs');
  srv = mod.server;
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

const call = async (method, path, body, headers = {}) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* a body */ }
  return { status: r.status, json, buf, headers: r.headers };
};
const waitFor = async (pred, ms = 8000) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const up = (name, data) => ({ name, dataBase64: Buffer.from(data).toString('base64') });
const PDF = Buffer.from('%PDF-1.7\nsupport tickets\n');
const create = (attachments, title = 'Cancel order') => call('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title, description: 'Before it ships', attachments });
const view = async (seq) => (await call('GET', `/api/requirements/${seq}`)).json.feature;

test('create with two files: stored, read before round 1, round 1 names the first file as a source', async () => {
  const c = await create([up('notes.md', '# Notes\nRefunds in 14 days.'), up('tickets.pdf', PDF)]);
  assert.equal(c.status, 201, JSON.stringify(c.json));
  const seq = c.json.feature.seq;
  await waitFor(async () => (await view(seq)).status === 'your_turn');
  const f = await view(seq);
  assert.deepEqual(f.attachments.map((a) => [a.name, a.kind, a.status, a.summary]), [
    ['notes.md', 'text', 'done', '[mock] What Worca took from notes.md: two rules, one number and an open point.'],
    ['tickets.pdf', 'binary', 'done', '[mock] What Worca took from tickets.pdf: two rules, one number and an open point.']]);
  const a = f.attachments[0];
  assert.deepEqual(Object.keys(a).sort(), ['asking', 'asks', 'bytes', 'costUsd', 'error', 'estimateUsd', 'history', 'href', 'id', 'kind', 'mentions', 'mime',
    'name', 'readAt', 'readModel', 'sendWithRun', 'sendable', 'status', 'summary', 'summaryEdited'].sort());
  assert.equal(a.sendable, true);
  assert.equal(a.href, `/api/requirements/${seq}/attachments/${a.id}`);
  assert.equal(f.spec.criteria[0].source, 'notes.md');
  assert.deepEqual(a.mentions, ['R-po-1']);
  assert.deepEqual(f.unaskedFiles, []);
  assert.equal(f.resetPeriod, 'monthly');
  assert.ok(f.interview && f.interview.label);
});

test('add, download, edit, switch, remove; the refusals of D7 and D9', async () => {
  const seq = (await create(undefined, 'Refunds')).json.feature.seq;
  await waitFor(async () => (await view(seq)).status === 'your_turn');
  const add = await call('POST', `/api/requirements/${seq}/attachments`, { attachments: [up('policy.md', 'Refunds <b>14 days</b>'), up('t.pdf', PDF)] });
  assert.equal(add.status, 202, JSON.stringify(add.json));
  await waitFor(async () => (await view(seq)).attachments.every((x) => x.status === 'done'));
  const [md, pdf] = (await view(seq)).attachments;
  const t = await call('GET', md.href);
  assert.deepEqual([t.status, t.headers.get('content-type'), t.headers.get('x-content-type-options'), t.headers.get('cache-control')],
    [200, 'text/plain; charset=utf-8', 'nosniff', 'private, no-cache']);
  assert.equal(t.headers.get('content-disposition'), 'inline; filename="policy.md"; filename*=UTF-8\'\'policy.md');
  assert.equal(t.buf.toString('utf8'), 'Refunds <b>14 days</b>');
  const p = await call('GET', pdf.href);
  assert.deepEqual([p.headers.get('content-type'), p.buf.equals(PDF)], ['application/pdf', true]);
  const etag = p.headers.get('etag');
  assert.match(etag, /^"[0-9a-f]{64}"$/);
  assert.equal((await call('GET', pdf.href, undefined, { 'if-none-match': etag })).status, 304);
  const e = await call('PATCH', md.href, { summary: 'Mine.', sendWithRun: true });
  assert.equal(e.status, 200);
  const edited = e.json.feature.attachments[0];
  assert.deepEqual([edited.summary, edited.summaryEdited, edited.sendWithRun], ['Mine.', true, true]);
  assert.equal((await call('PATCH', md.href, { sendWithRun: 'yes' })).status, 400);
  const no = async (attachments) => { const r = await call('POST', `/api/requirements/${seq}/attachments`, { attachments }); return [r.status, r.json.error]; };
  assert.deepEqual(await no([up('plan.docx', 'x')]), [400, 'plan.docx was not added: Worca reads text, images and PDF. Save it as PDF to attach it here.']);
  assert.deepEqual(await no([up('again.pdf', PDF)]), [400, 'again.pdf is already attached as t.pdf.']);
  assert.deepEqual(await no(Array.from({ length: 9 }, (_, i) => up(`n${i}.md`, `n${i}`))), [400, 'n8.md was not added: a feature takes up to 10 files.']);
  assert.equal((await call('GET', `/api/requirements/${seq}/attachments/ratt_000000000000`)).status, 404);
  assert.equal((await call('GET', `/api/requirements/${seq}/attachments/..%2Fx`)).status, 404);
  const gone = await call('DELETE', pdf.href);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.json.feature.attachments.map((x) => x.name), ['policy.md']);
  assert.equal((await call('GET', pdf.href)).status, 404);
});

test('replace, ask and read again answer 202; a file being read refuses them with 409', async () => {
  const seq = (await create([up('a.md', 'alpha')], 'Ask me')).json.feature.seq;
  await waitFor(async () => (await view(seq)).status === 'your_turn');
  const a = (await view(seq)).attachments[0];
  process.env.WORCA_MOCK_READ_MS = '400';
  try {
    assert.equal((await call('POST', `${a.href}/read-again`, {})).status, 202);
    for (const [path, body] of [['/read-again', {}], ['/ask', { question: 'Q?' }], ['/replace', { attachments: [up('b.md', 'beta')] }]]) {
      const r = await call('POST', `${a.href}${path}`, body);
      assert.deepEqual([r.status, r.json.error], [409, 'Worca is reading this file.'], path);
    }
    assert.deepEqual([(await call('PATCH', a.href, { summary: 'x' })).status], [409]);
  } finally { delete process.env.WORCA_MOCK_READ_MS; }
  await waitFor(async () => (await view(seq)).attachments[0].status === 'done');
  process.env.WORCA_MOCK_READ_MS = '300';
  let asked;
  try { asked = await call('POST', `${a.href}/ask`, { question: 'What about refunds?' }); } finally { delete process.env.WORCA_MOCK_READ_MS; }
  assert.equal(asked.status, 202);
  assert.equal(asked.json.feature.attachments[0].asking, 'What about refunds?', 'the answer to the press shows the ask in progress');
  await waitFor(async () => (await view(seq)).attachments[0].asks.length === 1);
  assert.equal((await view(seq)).attachments[0].asking, null, 'cleared once answered');
  assert.equal((await view(seq)).attachments[0].asks[0].answer, '[mock] What about refunds?: the file does not say more.');
  const rp = await call('POST', `${a.href}/replace`, { attachments: [up('b.md', 'beta')], keepSummary: false });
  assert.equal(rp.status, 202);
  await waitFor(async () => (await view(seq)).attachments[0].status === 'done');
  const b = (await view(seq)).attachments[0];
  assert.deepEqual([b.id, b.name, b.asks.length, b.history[0].name], [a.id, 'b.md', 0, 'a.md']);
});

test('busy, archived and starting refusals; the brief documents need a made brief', async () => {
  process.env.WORCA_MOCK_READ_MS = '400';
  let seq;
  try {
    seq = (await create([up('slow.md', 'slow')], 'Busy')).json.feature.seq;
    const r = await call('POST', `/api/requirements/${seq}/attachments`, { attachments: [up('x.md', 'x')] });
    assert.equal(r.status, 409, 'busy while the create job waits for the reads');
  } finally { delete process.env.WORCA_MOCK_READ_MS; }
  await waitFor(async () => (await view(seq)).status === 'your_turn');
  await call('POST', `/api/requirements/${seq}/archive`, {});
  assert.equal((await call('POST', `/api/requirements/${seq}/attachments`, { attachments: [up('y.md', 'y')] })).status, 409);
  const docs = `/api/requirements/brief/project/${projKey}/documents`;
  assert.deepEqual([(await call('POST', docs, { attachments: [up('g.md', 'glossary')] })).status], [409]);
  assert.equal((await call('POST', `/api/requirements/brief/project/${projKey}`, {})).status, 202);
  await waitFor(async () => !!(await call('GET', `/api/requirements/brief/project/${projKey}`)).json.brief?.madeAt);
  const added = await call('POST', docs, { attachments: [up('g.md', 'glossary')] });
  assert.equal(added.status, 202, JSON.stringify(added.json));
  await waitFor(async () => (await call('GET', `/api/requirements/brief/project/${projKey}`)).json.documents[0]?.status === 'done');
  const page = (await call('GET', `/api/requirements/brief/project/${projKey}`)).json;
  assert.deepEqual([page.documents[0].name, page.documents[0].sendWithEveryRun, 'sendWithRun' in page.documents[0]], ['g.md', false, false]);
  assert.equal((await call('PATCH', page.documents[0].href, { sendWithEveryRun: true })).json.documents[0].sendWithEveryRun, true);
  const { attachmentFile } = await import('../src/core/requirements/attachment-job.mjs');
  const body = attachmentFile(page.documents[0]);
  assert.equal(existsSync(body), true);
  assert.equal((await call('DELETE', `/api/requirements/brief/project/${projKey}`)).status, 200);
  assert.equal(existsSync(body), false, 'deleting the brief removed its documents');
});

test('flag off: an upload is answered 404 by the gate, unparsed; boot: reads left reading fail, old read folders go', async () => {
  delete process.env.WORCA_FLAGS;
  try {
    for (const path of ['/api/requirements', '/api/requirements/1/attachments', `/api/requirements/brief/project/${projKey}/documents`]) {
      const r = await call('POST', path, '{"attachments": [');
      assert.deepEqual([r.status, r.json], [404, { error: 'not found' }], path);
    }
  } finally { process.env.WORCA_FLAGS = 'requirements'; }
  const store = await import('../src/core/requirements/store.mjs');
  const left = store.insertAttachment({ id: store.mintAttachmentId(), ownerType: 'feature', ownerId: 1, name: 'x.md', kind: 'text', mime: 'text/plain', bytes: 1, sha256: 'boot1' });
  const { worcaHome } = await import('../src/core/projects.mjs');
  const old = join(worcaHome(), 'tmp', 'requirements', 'att-read-00ff00ff');
  mkdirSync(old, { recursive: true });
  const t = (Date.now() - 2 * 3600_000) / 1000;
  utimesSync(old, t, t);
  const summary = await mod.bootMaintenance({ log: () => {} });
  assert.ok(summary.recoveredAttachmentReads >= 1);
  assert.equal(store.getAttachment(left.id).error.code, 'INTERRUPTED');
  assert.equal(existsSync(old), false);
});

test('a download refuses a version that could not be stored, and a body it cannot read answers product copy, not a path', async () => {
  const seq = (await create([up('s.md', 'stored'), up('d.md', 'dir')], 'Downloads')).json.feature.seq;
  await waitFor(async () => (await view(seq)).status === 'your_turn');
  const [s, dd] = (await view(seq)).attachments;
  const store = await import('../src/core/requirements/store.mjs');
  const { attachmentFile } = await import('../src/core/requirements/attachment-job.mjs');
  // a Windows lock can leave the old body in place: the row decides, not the disk
  store.updateAttachment(s.id, { status: 'failed', error: { code: 'STORE_FAILED', message: 'Worca could not store the new version. Replace it again.', at: new Date().toISOString() } });
  assert.equal(existsSync(attachmentFile(store.getAttachment(s.id))), true);
  const r = await call('GET', s.href);
  assert.deepEqual([r.status, r.json], [404, { error: 'Worca could not store the new version. Replace it again.' }]);
  assert.equal(r.headers.get('content-disposition'), null);
  const body = attachmentFile(store.getAttachment(dd.id));
  await rm(body, { force: true });
  mkdirSync(body);   // a body the server cannot read
  const logged = [];
  const err = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  let g;
  try { g = await call('GET', dd.href); } finally { console.error = err; }
  assert.deepEqual([g.status, g.json], [500, { error: 'Worca could not open the stored file. Remove it and attach it again.' }]);
  assert.match(g.headers.get('content-type'), /^application\/json/);
  assert.equal(g.headers.get('content-disposition'), null);
  assert.equal(logged.length, 1, 'the raw error goes to the log');
  await rm(body, { recursive: true, force: true });
});

test('a start in flight refuses the file routes; downloads take no lock', async () => {
  const seq = (await create([up('k.md', 'kept')], 'Starting')).json.feature.seq;
  await waitFor(async () => (await view(seq)).status === 'your_turn');
  const a = (await view(seq)).attachments[0];
  const { markStarting, unmarkStarting, STARTING_MESSAGE } = await import('../src/core/requirements/starting.mjs');
  markStarting(seq);
  try {
    for (const [m, path, body] of [['POST', `/api/requirements/${seq}/attachments`, { attachments: [up('n.md', 'new')] }], ['PATCH', a.href, { sendWithRun: true }],
      ['DELETE', a.href, undefined], ['POST', `${a.href}/read-again`, {}], ['POST', `${a.href}/ask`, { question: 'Q?' }],
      ['POST', `${a.href}/replace`, { attachments: [up('n.md', 'new')] }]]) {
      const r = await call(m, path, body);
      assert.deepEqual([r.status, r.json.error], [409, STARTING_MESSAGE], `${m} ${path}`);
    }
    assert.equal((await call('GET', a.href)).status, 200);
  } finally { unmarkStarting(seq); }
});

// A bare app with the requirements routes and injected deps (as requirements-start.test.mjs): the same process, database
// and file queue as the server above, so a body write or the spend read can be made to fail.
async function bareApp(deps) {
  const { registerRequirementsRoutes } = await import('../src/core/requirements/routes.mjs');
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  registerRequirementsRoutes(app, { broadcast: () => {}, deps });
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const at = `http://127.0.0.1:${s.address().port}`;
  const go = async (method, path, body) => {
    const r = await fetch(`${at}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const close = async () => { s.closeAllConnections?.(); await Promise.race([new Promise((r) => s.close(r)), new Promise((r) => setTimeout(r, 500))]); };
  return { go, close };
}
const quietErrors = async (fn) => {
  const logged = [];
  const err = console.error;
  console.error = (...a) => logged.push(a.map(String).join(' '));
  try { return { out: await fn(), logged }; } finally { console.error = err; }
};

test('a create keeps its feature when a file cannot be stored: 201, the files not stored by name, the interview goes on', async () => {
  const { writeFileSync } = await import('node:fs');
  let writes = 0;
  const app = await bareApp({ writeBody: (...a) => { writes += 1; if (writes === 2) throw Object.assign(new Error('EACCES: permission denied, open /home/me/secret-place/att/b.txt'), { code: 'EACCES' }); return writeFileSync(...a); } });
  try {
    const { out: c, logged } = await quietErrors(() => app.go('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'Partly stored',
      description: 'd', attachments: [up('a.md', 'one'), up('b.md', 'two'), up('c.md', 'three')] }));
    assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.deepEqual(c.json.filesNotStored, ['b.md', 'c.md'], 'the failing file and the one never tried');
    assert.equal(JSON.stringify(c.json).includes('secret-place'), false, 'no path in the answer');
    assert.ok(logged.some((l) => /EACCES/.test(l)), 'the raw error goes to the log');
    const seq = c.json.feature.seq;
    const { listFeatures } = await import('../src/core/requirements/store.mjs');
    assert.equal(listFeatures({}).filter((f) => f.title === 'Partly stored').length, 1, 'the feature exists exactly once');
    await waitFor(async () => (await view(seq)).status === 'your_turn');
    assert.deepEqual((await view(seq)).attachments.map((x) => [x.name, x.status]), [['a.md', 'done']]);
    const ok = await app.go('POST', '/api/requirements', { scopeType: 'project', scopeKey: projKey, title: 'All stored', description: 'd', attachments: [up('z.md', 'zzz')] });
    assert.deepEqual([ok.status, ok.json.filesNotStored], [201, []]);
    await waitFor(async () => (await view(ok.json.feature.seq)).status === 'your_turn');
  } finally { await app.close(); }
});

test("a file route's unexpected failure answers the fallback copy; a list whose spend cannot be read still answers", async () => {
  const seq = (await create(undefined, 'Fallback')).json.feature.seq;
  await waitFor(async () => (await view(seq)).status === 'your_turn');
  const app = await bareApp({
    writeBody: () => { throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); },
    requirementsSpend: () => { throw new Error('the budget store is gone'); },
  });
  try {
    const { out: r, logged } = await quietErrors(() => app.go('POST', `/api/requirements/${seq}/attachments`, { attachments: [up('w.md', 'write me')] }));
    assert.deepEqual([r.status, r.json], [500, { error: 'Worca could not finish that. Try again.' }]);
    assert.ok(logged.some((l) => /ENOSPC/.test(l)));
    const { out: l, logged: l2 } = await quietErrors(() => app.go('GET', '/api/requirements'));
    assert.equal(l.status, 200, JSON.stringify(l.json));
    assert.equal(l.json.spend, null);
    assert.ok(Array.isArray(l.json.features) && l.json.features.length > 0);
    assert.ok(l2.some((x) => /budget store is gone/.test(x)));
  } finally { await app.close(); }
});

test('at most two uploads in flight: a third answers 409; a slot frees on an aborted request and on an error', async () => {
  const { port } = srv.address();
  // a request whose body never ends holds its slot
  const hold = () => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/api/requirements/1/attachments',
      headers: { 'content-type': 'application/json', 'content-length': '1000000' } });
    req.on('error', () => {});
    req.write('{"attachments": [');
    return req;
  };
  const held = [hold(), hold()];
  try {
    await waitFor(async () => (await call('POST', '/api/requirements/1/attachments', { attachments: [] })).status === 409);
    const r = await call('POST', `/api/requirements/brief/project/${projKey}/documents`, { attachments: [] });
    assert.deepEqual([r.status, r.json], [409, { error: 'Try again in a moment.' }], 'the cap spans the five upload routes');
    assert.notEqual((await call('GET', '/api/requirements')).status, 409, 'other routes are not capped');
  } finally { for (const h of held) h.destroy(); }
  await waitFor(async () => (await call('POST', '/api/requirements/1/attachments', '{"attachments": [')).status === 400);
  for (let i = 0; i < 4; i += 1) {
    const bad = await call('POST', '/api/requirements/1/attachments', '{"attachments": [');
    assert.equal(bad.status, 400, 'a parser error frees its slot');
    const refused = await call('POST', '/api/requirements/999999/attachments', { attachments: [] });
    assert.equal(refused.status, 404, 'a route refusal frees its slot');
  }
});
