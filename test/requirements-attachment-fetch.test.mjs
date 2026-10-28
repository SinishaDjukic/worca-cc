// test/requirements-attachment-fetch.test.mjs — a picked tracker attachment becomes an A8 file (plans/requirements-a61-design.md D9, D10,
// D14–D17) in mock mode: the real callSource with the shim's canned (or held) downloadAttachment, A8's mock reads. No tracker, no model.
// This file imports attachment-fetch.mjs before attachment-job.mjs on purpose: the two import each other.
import * as fetchJob from '../src/core/requirements/attachment-fetch.mjs';
import * as job from '../src/core/requirements/attachment-job.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { useTempHome } from './helpers/temp-home.mjs';
import { tx } from '../src/core/db.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { callSource, setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { createFeature, getFeature, getAttachment, listAttachments, listTurns } from '../src/core/requirements/store.mjs';

useTempHome(after, 'worca-req-fetch-');
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_MOCK = '1';
after(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; setMockSourceResponses(null); });

const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const seen = [];
const d = { callSource: (o) => { seen.push(o); return callSource(o); }, onChange: () => {}, budget: () => ({ blocked: false }) };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = Buffer.from('%PDF-1.7\nheld\n');
const BODY = { 10041: PNG, 10042: PDF, 10043: Buffer.from('Macro text.\n') };
const feature = (title = 'Partial cancel') => createFeature({ scopeType: 'project', scopeKey: 'shop-f1', title, description: 'From a ticket' });
const own = (f) => ({ type: 'feature', id: f.seq });
const row = (f, id = '10042', name = 'partial-cancel-flow.pdf', bytes = 1258291) => tx(() => fetchJob.insertDownloadRow(own(f),
  { conn: CONN, tracker: 'Jira', key: 'SHOP-124', id, name, bytes, from: { tracker: 'Jira', key: 'SHOP-124' } }, { by: 'po' }));
const queue = async (f, r) => { fetchJob.queueDownloads(own(f), [r.id], { by: 'po' }, d); await job.readsSettled(own(f)); return getAttachment(r.id); };
const waitFor = async (pred, ms = 3000) => { const end = Date.now() + ms; while (!pred()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };
const getDirs = () => { try { return readdirSync(join(worcaHome(), 'tmp', 'requirements')).filter((x) => x.startsWith('att-get-')); } catch { return []; } };
const bodies = (id) => { try { return readdirSync(job.attachmentsDir()).filter((n) => n.startsWith(id)); } catch { return []; } };
/** Downloads the test answers by hand: each waits until released, then writes its body to dest. */
function hold() {
  const waiting = [];
  setMockSourceResponses({ downloadAttachment: (args) => new Promise((resolve) => waiting.push({ args, resolve })) });
  return { waiting, release: (i = 0) => { const [w] = waiting.splice(i, 1); writeFileSync(w.args.dest, BODY[w.args.id], { flag: 'wx' });
    w.resolve({ name: 'x', mime: 'x', bytes: BODY[w.args.id].length }); } };
}

test('insertDownloadRow (D10, D14): a downloading row named, typed and sized from the tracker, where from in fetch, a pending hash, an added turn with from', () => {
  const f = feature();
  const r = row(f);
  assert.deepEqual([r.status, r.name, r.kind, r.mime, r.bytes, r.sha256], ['downloading', 'partial-cancel-flow.pdf', 'binary', 'application/pdf', 1258291, `pending:${r.id}`]);
  assert.deepEqual(r.fetch, { ...CONN, tracker: 'Jira', key: 'SHOP-124', id: '10042', name: 'partial-cancel-flow.pdf', bytes: 1258291 });
  const t = listTurns(f.seq).at(-1);
  assert.deepEqual([t.kind, t.payload.action, t.payload.name, t.payload.from], ['file', 'added', 'partial-cancel-flow.pdf', { tracker: 'Jira', key: 'SHOP-124' }]);
  assert.equal(row(f, '10050').name, 'partial-cancel-flow (2).pdf', 'a name already used is made unique');
});

test('a download (D9): a fresh att-get folder and body.part; the body written into the store under the row id; the file read; the folder gone', async () => {
  setMockSourceResponses(null);
  const f = feature();
  const r = row(f, '10041', 'packing-slip.png', 860160);
  fetchJob.queueDownloads(own(f), [r.id], { by: 'po' }, d);
  assert.equal(fetchJob.isDownloading(r.id), true);
  await job.readsSettled(own(f));
  const now = getAttachment(r.id);
  assert.deepEqual([now.status, now.kind, now.mime, now.bytes, now.sha256], ['done', 'image', 'image/png', PNG.length, sha(PNG)]);
  assert.deepEqual(readFileSync(job.attachmentFile(now)), PNG);
  const call = seen.filter((c) => c.op === 'downloadAttachment').at(-1);
  assert.deepEqual([call.profile, call.timeoutMs, call.args.key, call.args.id, call.args.maxBytes], ['acme', 120_000, 'SHOP-124', '10041', 25 * 1024 * 1024]);
  assert.match(call.args.dest.replaceAll('\\', '/'), /\/tmp\/requirements\/att-get-[0-9a-f]{8}\/body\.part$/);
  assert.deepEqual(getDirs(), [], 'the folder is removed');
  assert.equal(now.fetch.key, 'SHOP-124', 'where it came from stays on the row');
});

test('at most two downloads at a time across features; the others wait as downloading (D10, D17)', async () => {
  const h = hold();
  const a = feature('A');
  const b = feature('B');
  const rows = [row(a, '10042'), row(a, '10043', 'support-macro.txt', 4096), row(b, '10041', 'packing-slip.png', 860160)];
  fetchJob.queueDownloads(own(a), [rows[0].id, rows[1].id], {}, d);
  fetchJob.queueDownloads(own(b), [rows[2].id], {}, d);
  await waitFor(() => h.waiting.length === 2);
  assert.equal(fetchJob.MAX_DOWNLOAD_JOBS, 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.waiting.length, 2, 'the third waits for a slot');
  assert.ok(rows.every((x) => fetchJob.isDownloading(x.id) && getAttachment(x.id).status === 'downloading'));
  assert.equal(job.filesPending(own(a)), true, "A8's pending check counts a download");
  h.release(0);
  await waitFor(() => h.waiting.length === 2, 3000);
  h.release(0);
  h.release(0);
  await job.readsSettled(own(a));
  await job.readsSettled(own(b));
  assert.deepEqual(rows.map((x) => getAttachment(x.id).status), ['done', 'done', 'done']);
});

test('a failed download marks only that file (D10, D16): a fixed reason by kind, gone, forbidden, nothing sent; downloading again works', async () => {
  const f = feature();
  const cases = [
    [() => { throw new PluginOpError('timeout', 'plugin "jira-source" op "downloadAttachment" exceeded 120000ms'); }, 'it did not answer within 2 minutes'],
    [() => { throw new PluginOpError('auth', 'Jira token invalid'); }, 'the API token was refused'],
    [() => { throw new PluginOpError('plugin', 'Jira 500 (GET /rest/x)'); }, 'it answered with an error'],
    [() => ({ gone: true }), 'it is no longer on SHOP-124'],
    [() => ({ gone: true, forbidden: true }), 'this connection may not see it'],
    [() => ({ name: 'x.pdf', mime: 'application/pdf', bytes: 5 }), 'Jira did not send it'],
  ];
  for (const [answer, reason] of cases) {
    setMockSourceResponses({ downloadAttachment: answer });
    const now = await queue(f, row(f, '10042'));
    assert.deepEqual([now.status, now.error.code, now.error.job, now.error.message],
      ['failed', 'DOWNLOAD', 'download', `Worca could not get this file from Jira: ${reason}.`], reason);
    job.removeAttachment(own(f), now.id, {}, d);
  }
  setMockSourceResponses({ downloadAttachment: () => { throw new PluginOpError('timeout', 'x'); } });
  const r = await queue(f, row(f, '10042'));
  setMockSourceResponses(null);
  assert.equal(fetchJob.redownload(own(f), r, {}, d).status, 'downloading');
  await job.readsSettled(own(f));
  assert.equal(getAttachment(r.id).status, 'done');
  assert.deepEqual(getDirs(), []);
});

test('a body Worca cannot store (plan review M1): the file fails with Try again, never stays downloading; nothing in the store, no folder left; the log keeps one line', async () => {
  setMockSourceResponses(null);
  const f = feature();
  const r = row(f, '10041', 'packing-slip.png', 860160);
  const boom = () => { throw Object.assign(new Error('EBUSY: resource busy or locked\nsecond line'), { code: 'EBUSY' }); };
  const logged = [];
  const was = console.error;
  console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    fetchJob.queueDownloads(own(f), [r.id], { by: 'po' }, { ...d, writeBody: boom });
    await job.readsSettled(own(f));
  } finally { console.error = was; }
  const now = getAttachment(r.id);
  assert.deepEqual([now.status, now.error.code, now.error.job, now.error.message],
    ['failed', 'DOWNLOAD', 'download', 'Worca could not get this file from Jira: Worca could not store it.']);
  assert.deepEqual([bodies(r.id), getDirs(), fetchJob.isDownloading(r.id)], [[], [], false]);
  assert.ok(logged.some((l) => /EBUSY/.test(l)) && !logged.some((l) => /second line/.test(l)), 'the first line only (M3)');
  assert.equal(fetchJob.redownload(own(f), now, {}, d).status, 'downloading');
  await job.readsSettled(own(f));
  assert.equal(getAttachment(r.id).status, 'done');
});

test('a file that arrived but A8 cannot use is refused (D10): too large, a size that lied, not its type, a duplicate', async () => {
  const f = feature();
  const cases = [
    [() => ({ tooLarge: true, bytes: 30 * 1024 * 1024 }), 'it is over 25 MB'],
    [(a) => { writeFileSync(a.dest, PDF, { flag: 'wx' }); return { name: 'x.pdf', mime: 'application/pdf', bytes: PDF.length - 1 }; }, 'it is not the file Jira described'],
    [(a) => { writeFileSync(a.dest, 'not a pdf at all', { flag: 'wx' }); return { name: 'x.pdf', mime: 'application/pdf', bytes: 16 }; }, 'its content does not match its type'],
  ];
  for (const [answer, reason] of cases) {
    setMockSourceResponses({ downloadAttachment: answer });
    const now = await queue(f, row(f, '10042'));
    assert.deepEqual([now.status, now.error.code, now.error.message], ['failed', 'REFUSED', `Worca could not use this file: ${reason}.`], reason);
    assert.deepEqual(bodies(now.id), [], 'nothing stored');
    job.removeAttachment(own(f), now.id, {}, d);
  }
  job.addAttachments(own(f), [{ name: 'call-notes.pdf', kind: 'binary', mime: 'application/pdf', data: PDF, bytes: PDF.length, sha256: sha(PDF) }], {}, d);
  await job.readsSettled(own(f));
  setMockSourceResponses({ downloadAttachment: (a) => { writeFileSync(a.dest, PDF, { flag: 'wx' }); return { name: 'x.pdf', mime: 'application/pdf', bytes: PDF.length }; } });
  const dup = await queue(f, row(f, '10042', 'scan-notes.pdf'));
  assert.equal(dup.error.message, 'Worca could not use this file: it is already attached as call-notes.pdf.');
  assert.deepEqual(getDirs(), []);
});

test('checkFetched (D9, D15, S7): inside the folder, a regular file and no link, at most the cap, the answered size, read through one descriptor; the folder is 0700', () => {
  const { dir, dest } = fetchJob.makeFetchFolder();
  const other = mkdtempSync(join(tmpdir(), 'worca-other-'));
  try {
    assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 3 }), { ok: false, why: 'missing' });
    writeFileSync(dest, 'abc');
    const ok = fetchJob.checkFetched(dir, dest, { bytes: 3 });
    assert.deepEqual([ok.ok, ok.size, String(ok.body)], [true, 3, 'abc'], 'the bytes it checked come back with it');
    assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 4 }), { ok: false, why: 'size' });
    assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 3 }, 2), { ok: false, why: 'too-large' });
    writeFileSync(join(other, 'body.part'), 'abc');
    assert.deepEqual(fetchJob.checkFetched(dir, join(other, 'body.part'), { bytes: 3 }), { ok: false, why: 'path' });
    if (process.platform !== 'win32') {
      assert.equal(statSync(dir).mode & 0o777, 0o700, "the folder is the user's alone");
      rmSync(dest);
      symlinkSync(join(other, 'body.part'), dest);
      assert.deepEqual(fetchJob.checkFetched(dir, dest, { bytes: 3 }), { ok: false, why: 'not-a-file' });
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});
