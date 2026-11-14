// test/jira-source-download.test.mjs — jira-source's downloadAttachment against a fake Jira over real HTTP (plans/requirements-a61-design.md
// D9, D15, D16, §5): the Authorization header on the site only, Cloud's one redirect to a signed address without it, a second redirect and
// another origin refused, the size checked before and while streaming, an existing file never overwritten or deleted, nothing left at dest.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import createTaskSource from '../plugins/jira-source/connector/index.mjs';
import { startFakeJira } from './helpers/fake-jira.mjs';

const open = [];
const dirs = [];
after(async () => { for (const j of open) await j.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const ISSUE = (attachments) => ({ key: 'SHOP-124', project: 'SHOP', projectName: 'Shop web', summary: 'Partial cancel', description: '', rendered: '',
  type: { id: '10001', name: 'Story' }, status: 'In progress', priority: null, updated: '2026-10-25T12:00:00.000+0000', comments: [], custom: {}, attachments });
const SLIP = (over = {}) => ({ id: '10041', filename: 'packing-slip.png', mimeType: 'image/png', size: PNG.length, created: '2026-10-21T09:00:00.000+0000', body: PNG, ...over });
async function site(o = {}, deps = { allowHttpRedirect: true }) {
  const jira = await startFakeJira({ seed: [ISSUE(o.attachments || [SLIP()])], ...o });
  open.push(jira);
  const cloud = (o.deployment || 'cloud') === 'cloud';
  const map = new Map();
  const ctx = { apiVersion: 5, profile: 'acme', log: () => {}, config: { baseUrl: jira.base, email: cloud ? 'ann@acme.test' : '', token: 'tok' },
    state: { map, get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } } };
  return { jira, src: createTaskSource(ctx, deps) };
}
const dest = () => { const d = mkdtempSync(join(tmpdir(), 'worca-jira-dl-')); dirs.push(d); return join(d, 'body.part'); };
const MAX = 25 * 1024 * 1024;

test('Cloud: the site answers with the header, then one redirect to the signed address without it; the body lands at dest', async () => {
  const { jira, src } = await site();
  const to = dest();
  assert.deepEqual(await src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), { name: 'packing-slip.png', mime: 'image/png', bytes: PNG.length });
  assert.deepEqual(readFileSync(to), PNG);
  const first = jira.requests.find((r) => r.path === '/rest/api/2/attachment/content/10041');
  assert.ok(first && /^Basic /.test(first.auth), 'the site gets the Authorization header');
  assert.deepEqual(jira.media.requests.map((r) => r.auth), [null], 'the signed address never does');
});

test("Data Center: the site serves /secure/attachment itself, with the bearer token; the answer's bytes are the file's size", async () => {
  const { jira, src } = await site({ deployment: 'datacenter' });
  const to = dest();
  const r = await src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to });
  assert.equal(r.bytes, readFileSync(to).length);
  assert.ok(jira.requests.some((x) => x.path === '/secure/attachment/10041/packing-slip.png' && x.auth === 'Bearer tok'));
  assert.equal(jira.media.requests.length, 0);
});

test('a second redirect, a plain-http redirect without the test switch and a content address on another origin are refused; nothing is left at dest', async () => {
  const twice = await site({ redirectTwice: true });
  const a = dest();
  await assert.rejects(twice.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: a }), (e) => e.kind === 'plugin');
  assert.equal(existsSync(a), false);
  const strict = await site({}, {});
  const b = dest();
  await assert.rejects(strict.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: b }), (e) => e.kind === 'plugin');
  assert.equal(strict.jira.media.requests.length, 0, 'an http address off the site is never asked');
  assert.equal(existsSync(b), false);
  const elsewhere = await site({ contentElsewhere: true });
  const c = dest();
  await assert.rejects(elsewhere.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: c }), (e) => e.kind === 'plugin');
  assert.equal(elsewhere.jira.media.requests.length, 0, 'a content address on another origin is refused before any request');
  assert.equal(existsSync(c), false);
});

test('the size: over maxBytes on the metadata is tooLarge before any download; a body that grows past it is cut and deleted', async () => {
  const big = await site({ attachments: [SLIP({ size: 40 * 1024 * 1024 })] });
  const a = dest();
  assert.deepEqual(await big.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: a }), { tooLarge: true, bytes: 40 * 1024 * 1024 });
  assert.ok(!big.jira.requests.some((r) => /attachment\/content/.test(r.path)), 'no download was started');
  const liar = await site({ deployment: 'datacenter', attachments: [SLIP({ size: 4 })] });
  const b = dest();
  const r = await liar.src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: 8, dest: b });
  assert.equal(r.tooLarge, true);
  assert.ok(r.bytes > 8);
  assert.equal(existsSync(b), false, 'the partial file is deleted');
});

test('an existing file at dest is never overwritten or deleted', async () => {
  const { src } = await site({ deployment: 'datacenter' });
  const to = dest();
  writeFileSync(to, 'mine');
  await assert.rejects(src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), (e) => e.kind === 'plugin');
  assert.equal(readFileSync(to, 'utf8'), 'mine');
});

test("final review M2: a 401 from Cloud's signed address, which got no Authorization header, is not the token: a plugin error; nothing at dest", async () => {
  const { jira, src } = await site({ mediaStatus: 401 });
  const to = dest();
  await assert.rejects(src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }),
    (e) => e.kind === 'plugin' && !/token/i.test(e.message));
  assert.deepEqual(jira.media.requests.map((r) => r.auth), [null], 'the signed address got no header');
  assert.equal(existsSync(to), false);
});

test('401 throws auth; 403 is gone and forbidden; 404 and an attachment not on the ticket are gone; a relative dest is refused; nothing at dest', async () => {
  for (const [status, want] of [[401, null], [403, { gone: true, forbidden: true }], [404, { gone: true }]]) {
    const { src } = await site({ deployment: 'datacenter', contentStatus: status });
    const to = dest();
    if (want) assert.deepEqual(await src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), want, String(status));
    else await assert.rejects(src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: to }), (e) => e.kind === 'auth');
    assert.equal(existsSync(to), false, String(status));
  }
  const { src } = await site();
  assert.deepEqual(await src.downloadAttachment({ key: 'SHOP-124', id: '99999', maxBytes: MAX, dest: dest() }), { gone: true });
  await assert.rejects(src.downloadAttachment({ key: 'SHOP-124', id: '10041', maxBytes: MAX, dest: 'relative/body.part' }), (e) => e.kind === 'plugin');
});
