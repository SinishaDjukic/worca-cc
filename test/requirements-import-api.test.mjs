// test/requirements-import-api.test.mjs — the import routes and the create from a ticket (plans/requirements-a61-design.md §6, D10–D12, D14,
// D16, D18) on a bare express app with the requirements routes, in mock mode with jira-source linked: the 201 before any download ends,
// the criteria, the link, the turn, the comments file, the second read, D12's unlinked create, the caps, Try again and Remove.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { useTempHome } from './helpers/temp-home.mjs';
import { linkPlugin } from '../src/core/plugin-store.mjs';
import { createProfile, writePluginConfig } from '../src/core/plugin-config.mjs';
import { setMockSourceResponses, PluginOpError } from '../src/core/plugin-shim.mjs';
import { createFeature, getFeature, getExportLink, saveExportLink, listAttachments, listFeatures, listTurns } from '../src/core/requirements/store.mjs';
import { settled } from '../src/core/requirements/interview.mjs';
import { attachmentFile } from '../src/core/requirements/attachment-job.mjs';
import { isDownloading } from '../src/core/requirements/attachment-fetch.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { registerRequirementsRoutes, REQUIREMENTS_ROUTES } from '../src/core/requirements/routes.mjs';
import { _resetExportCaches } from '../src/core/requirements/export.mjs';

useTempHome(after, 'worca-req-import-api-');
const prev = { flags: process.env.WORCA_FLAGS, mock: process.env.WORCA_MOCK };
process.env.WORCA_FLAGS = 'requirements';
process.env.WORCA_MOCK = '1';
const SECRET = 'tok-SECRET-1234';
let srv; let base; let projKey; let projDir;

before(async () => {
  const { addProject } = await import('../src/core/projects.mjs');
  projDir = mkdtempSync(join(tmpdir(), 'req-import-api-shop-'));
  projKey = (await addProject({ name: 'shop', path: projDir })).find((p) => p.name === 'shop').key;
  await linkPlugin('jira-source', fileURLToPath(new URL('../plugins/jira-source', import.meta.url)));
  createProfile('jira-source', 'acme', 'acme.atlassian.net (Cloud)');
  writePluginConfig('jira-source', [{ key: 'baseUrl', type: 'text' }, { key: 'email', type: 'text' }, { key: 'token', type: 'text', secret: true }],
    { baseUrl: 'https://acme.atlassian.net', email: 'ann@acme.test', token: SECRET }, 'acme');
  _resetExportCaches();
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  // round 1 waits for the files at most 1.5 s here (6 minutes in the product), so a held download lets the feature be edited again
  registerRequirementsRoutes(app, { broadcast: () => {}, deps: { startRun: async () => ({ status: 200, body: {} }), round1WaitMs: 1500 } });
  srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  srv?.closeAllConnections?.();
  if (srv) await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  for (const [k, v] of [['WORCA_FLAGS', prev.flags], ['WORCA_MOCK', prev.mock]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  setMockSourceResponses(null);
  rmSync(projDir, { recursive: true, force: true });
});

const call = async (method, path, body) => {
  const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const P = '/api/requirements';
const imp = (path = '') => `${P}/import/project/${projKey}${path}`;
const ACME = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const CRITERIA = ['A customer can cancel the items of an order that have not been picked up.', 'Shipped items stay on the order and cannot be cancelled.',
  'The refund covers only the cancelled items, including their share of the shipping cost.'];
const FROM = (over = {}) => ({ ...ACME, key: 'SHOP-124', criteria: CRITERIA, comments: ['10231', '10232', '10233', '10235', '10236'],
  attachments: ['10041', '10042', '10043'], descriptionFile: false, ...over });
const create = (over = {}, ft = FROM()) => call('POST', P, { scopeType: 'project', scopeKey: projKey, title: 'Partial cancel for multi-item orders',
  description: 'Customers cancel the items not picked up yet.', fromTicket: ft, ...over });
const waitFor = async (pred, ms = 8000) => { const end = Date.now() + ms; while (!(await pred())) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const BODY = { 10041: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 10042: Buffer.from('%PDF-1.7\nx\n'), 10043: Buffer.from('Macro text.\n') };
const getDirs = () => { try { return readdirSync(join(worcaHome(), 'tmp', 'requirements')).filter((x) => x.startsWith('att-get-')); } catch { return []; } };
/** Downloads answered by hand: `drain()` answers every one, also those that start after a slot freed. */
function hold() {
  const waiting = [];
  setMockSourceResponses({ downloadAttachment: (args) => new Promise((resolve) => waiting.push(() => {
    writeFileSync(args.dest, BODY[args.id], { flag: 'wx' });
    resolve({ name: 'x', mime: 'x', bytes: BODY[args.id].length });
  })) });
  return { waiting, drain: async (seq) => waitFor(() => { while (waiting.length) waiting.shift()(); return listAttachments('feature', seq).every((a) => a.status !== 'downloading'); }) };
}

test('the route table: the four import routes, before GET /api/requirements', () => {
  const keys = REQUIREMENTS_ROUTES.map((r) => `${r.method} ${r.path}`);
  const list = keys.indexOf(`GET ${P}`);
  for (const k of [`GET ${P}/import/:scopeType/:scopeKey`, `POST ${P}/import/:scopeType/:scopeKey/options`, `POST ${P}/import/:scopeType/:scopeKey/search`,
    `POST ${P}/import/:scopeType/:scopeKey/preview`]) {
    assert.ok(keys.includes(k) && keys.indexOf(k) < list, k);
  }
});

test('GET import, options, search and preview answer through the routes; no config value ever; a connection not listed is 400; a gone key 404', async () => {
  setMockSourceResponses(null);
  const v = await call('GET', imp());
  assert.equal(v.status, 200);
  assert.deepEqual([v.json.sources.map((s) => s.plugin), v.json.defaultConnection], [['jira-source'], ACME]);
  assert.equal((await call('POST', imp('/options'), ACME)).json.projects[0].value, 'SHOP');
  assert.deepEqual((await call('POST', imp('/search'), { ...ACME, search: 'partial' })).json.tickets.map((t) => t.key), ['SHOP-124']);
  const p = await call('POST', imp('/preview'), { ...ACME, key: 'SHOP-124' });
  assert.deepEqual([p.status, p.json.title], [200, 'Partial cancel for multi-item orders']);
  for (const body of [v.json, p.json]) assert.ok(!JSON.stringify(body).includes(SECRET), 'no token in an answer');
  assert.deepEqual([(await call('POST', imp('/search'), { ...ACME, profile: 'nope' })).status], [400]);
  const g = await call('POST', imp('/preview'), { ...ACME, key: 'SHOP-999' });
  assert.deepEqual([g.status, g.json.gone, g.json.error], [404, true, 'SHOP-999 was not found in Jira, or this connection cannot see it.']);
});

test('Start the interview with a ticket (D10, D11, D14): 201 at once; R-po-1… from SHOP-124; the link with origin import; the comments file; the picked attachments downloading', async () => {
  const h = hold();
  const r = await create();
  assert.equal(r.status, 201);
  const f = r.json.feature;
  assert.deepEqual(f.spec.criteria.map((c) => [c.id, c.text, c.edited, c.source]), CRITERIA.map((t, i) => [`R-po-${i + 1}`, t, true, 'SHOP-124']));
  assert.equal(f.export.link.key, 'SHOP-124', 'the chip from the start (the view carries the origin from Task 10 on)');
  assert.deepEqual(f.attachments.map((a) => a.name), ['SHOP-124 comments.md', 'packing-slip.png', 'partial-cancel-flow.pdf', 'support-macro.txt']);
  assert.ok(['reading', 'done'].includes(f.attachments[0].status));
  assert.deepEqual(f.attachments.slice(1).map((a) => a.status), ['downloading', 'downloading', 'downloading']);
  assert.ok(f.attachments.every((a) => a.from && a.from.key === 'SHOP-124' && a.from.tracker === 'Jira'));
  assert.deepEqual([r.json.filesNotStored, r.json.notOnTicket], [[], { key: 'SHOP-124', comments: [], attachments: [] }]);
  const link = getExportLink(f.seq);
  assert.deepEqual([link.origin, link.trackerProject, link.fields.issueTypeName, link.fields.priorityName, link.fields.labels, link.fields.criteria],
    ['import', 'SHOP', 'Story', 'Medium', ['worca'], { target: 'description' }]);
  assert.match(link.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(link.createdAt, link.exportedAt);
  assert.deepEqual(link.spec.criteria.map((c) => c.id), ['R-po-1', 'R-po-2', 'R-po-3'], 'the spec as created');
  const turn = listTurns(f.seq).find((t) => t.kind === 'export');
  assert.deepEqual([turn.payload.action, turn.payload.key, turn.payload.linked, turn.payload.criteria, turn.payload.comments, turn.payload.files],
    ['imported', 'SHOP-124', true, ['R-po-1', 'R-po-2', 'R-po-3'], 5, ['packing-slip.png', 'partial-cancel-flow.pdf', 'support-macro.txt']]);
  const md = readFileSync(attachmentFile(listAttachments('feature', f.seq)[0]), 'utf8');
  assert.match(md, /^# Comments on SHOP-124\n\n\*\*Ann Example\*\* · 21 Oct 2026\n/);
  assert.ok(!md.includes('Jira Automation') && md.includes('ghp_<redacted>') && !md.includes('ghp_abcdef'));
  await h.drain(f.seq);
  await waitFor(() => listAttachments('feature', f.seq).every((a) => a.status === 'done'));
  await settled(f.seq);
  assert.ok(getFeature(f.seq).rounds >= 1, 'round 1 ran once the files were read');
});

test('the second read (D10): a comment and an attachment no longer on the ticket are left out and named; a refused one with its reason', async () => {
  setMockSourceResponses(null);
  const r = await create({}, FROM({ comments: ['10231', '99999'], attachments: ['10041', '99998', '10044'] }));
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.notOnTicket, { key: 'SHOP-124', comments: ['99999'], attachments: [{ id: '99998', reason: null },
    { id: '10044', reason: 'Not offered: Worca reads text, images and PDF. Save it as PDF to attach it here.' }] });
  assert.deepEqual(r.json.feature.attachments.map((a) => a.name), ['SHOP-124 comments.md', 'packing-slip.png']);
  await settled(r.json.feature.seq);
});

test('the ticket cannot be read at Start the interview (D10, D16): gone 404, unreachable 502; nothing is created', async () => {
  const before = listFeatures({ archived: true }).length;
  const g = await create({}, FROM({ key: 'SHOP-999' }));
  assert.deepEqual([g.status, g.json.gone, g.json.error], [404, true, 'SHOP-999 was not found in Jira, or this connection cannot see it.']);
  setMockSourceResponses({ importTicket: () => { throw new PluginOpError('timeout', 'x'); } });
  const t = await create();
  assert.deepEqual([t.status, t.json.kind, t.json.error], [502, 'timeout', 'Worca could not reach Jira: it did not answer within a minute.']);
  setMockSourceResponses(null);
  assert.equal(listFeatures({ archived: true }).length, before);
});

test('one ticket follows one feature (D12): a ticket another feature follows makes an unlinked feature whose turn names it', async () => {
  setMockSourceResponses(null);
  const other = createFeature({ scopeType: 'project', scopeKey: projKey, title: 'Cancel an order before it ships', description: 'x' });
  saveExportLink(other.seq, { ...ACME, trackerProject: 'SHOP', key: 'SHOP-123' });
  const r = await create({}, FROM({ key: 'SHOP-123', attachments: [] }));
  assert.equal(r.status, 201);
  assert.equal(r.json.feature.export.link, null);
  assert.equal(getExportLink(r.json.feature.seq), null);
  const turn = listTurns(r.json.feature.seq).find((t) => t.kind === 'export');
  assert.deepEqual([turn.payload.linked, turn.payload.linkedTo], [false, other.id]);
  assert.deepEqual(r.json.feature.spec.criteria.map((c) => c.source), ['SHOP-123', 'SHOP-123', 'SHOP-123']);
  await settled(r.json.feature.seq);
});

test("the caps at the create (D9): the form's files, the comments file and the downloads together; over 10 is refused and nothing created", async () => {
  setMockSourceResponses(null);
  const before = listFeatures({ archived: true }).length;
  const files = Array.from({ length: 7 }, (_, i) => ({ name: `notes-${i}.md`, dataBase64: Buffer.from(`note ${i}`).toString('base64') }));
  const r = await create({ attachments: files });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'support-macro.txt was not added: a feature takes up to 10 files.');
  assert.equal(listFeatures({ archived: true }).length, before);
});

test('Try again on a failed download fetches it again (A8 read-again); Remove on a downloading file deletes its row; round 1 does not wait for ever', async () => {
  setMockSourceResponses({ downloadAttachment: () => { throw new PluginOpError('auth', 'x'); } });
  const r = await create({}, FROM({ attachments: ['10042'] }));
  const seq = r.json.feature.seq;
  await settled(seq);
  const pdf = listAttachments('feature', seq).find((a) => a.name === 'partial-cancel-flow.pdf');
  assert.deepEqual([pdf.status, pdf.error.message], ['failed', 'Worca could not get this file from Jira: the API token was refused.']);
  setMockSourceResponses(null);
  assert.equal((await call('POST', `${P}/${seq}/attachments/${pdf.id}/read-again`, {})).status, 202);
  await waitFor(() => listAttachments('feature', seq).find((a) => a.id === pdf.id).status === 'done');
  const h = hold();
  const r2 = await create({}, FROM({ comments: [], attachments: ['10043'] }));
  const seq2 = r2.json.feature.seq;
  await settled(seq2);   // round 1 ran after round1WaitMs with the file still downloading
  const txt = listAttachments('feature', seq2).find((a) => a.name === 'support-macro.txt');
  assert.equal(txt.status, 'downloading');
  assert.ok(getFeature(seq2).rounds >= 1);
  assert.equal((await call('DELETE', `${P}/${seq2}/attachments/${txt.id}`)).status, 200);
  assert.equal(listAttachments('feature', seq2).length, 0);
  while (h.waiting.length) h.waiting.shift()();
  // the released download of the removed file ends now: wait for it, so it never finishes after this test (or after useTempHome's cleanup)
  await waitFor(() => !isDownloading(txt.id));
  assert.deepEqual(getDirs(), [], 'its folder is gone');
});
