// test/requirements-markdown-save.test.mjs — the rendered spec and Save to specs/ (design D11).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptySpec } from '../src/core/requirements/spec.mjs';
import { renderSpecMarkdown } from '../src/core/requirements/markdown.mjs';
import { saveSpecToCheckout, specFileName } from '../src/core/requirements/save.mjs';

const scratch = [];
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
const feature = {
  seq: 12, id: 'FEAT-12', title: 'Cancel an order!', description: 'Before it ships', status: 'done',
  spec: { ...emptySpec(), goal: { text: 'Customers cancel', measure: 'fewer calls' }, actors: ['Customer'], flow: ['Open order', 'Cancel'],
    criteria: [{ id: 'R-po-1', text: 'Cancel while unpaid' }], assumptions: [{ id: 'A-1', text: 'Full refund', status: 'confirmed' }] },
};

/** Symlinks need admin or Developer Mode on Windows: skip those cases there instead of failing. */
function canSymlink() {
  const d = tmp('req-sl-');
  try { symlinkSync(d, join(d, 'probe'), 'dir'); return true; } catch { return false; }
}

test('markdown: every section, ids, statuses, empty sections say so', () => {
  const md = renderSpecMarkdown(feature, { targetName: 'shop' });
  assert.match(md, /^# FEAT-12: Cancel an order!/);
  assert.match(md, /\*\*Project:\*\* shop/);
  assert.match(md, /## Goal\n\nCustomers cancel\n\n\*\*Success measure:\*\* fewer calls/);
  assert.match(md, /## Main flow\n\n1\. Open order\n2\. Cancel/);
  assert.match(md, /- \*\*R-po-1\*\* Cancel while unpaid/);
  assert.match(md, /- \*\*A-1\*\* \(confirmed\) Full refund/);
  assert.match(md, /## Business rules\n\n_None yet\._/);
  assert.match(md, /> Before it ships/);
});

test('file name: FEAT id + slug', () => {
  assert.equal(specFileName(feature), 'FEAT-12-cancel-an-order.md');
  assert.equal(specFileName({ id: 'FEAT-1', title: '!!!' }), 'FEAT-1-feature.md');
});

test('save: writes specs/<name>, never overwrites unless asked', async () => {
  const proj = tmp('req-save-');
  const r = await saveSpecToCheckout({ projectDir: proj, feature, markdown: 'v1' });
  assert.deepEqual(r, { ok: true, path: 'specs/FEAT-12-cancel-an-order.md' });
  assert.equal(readFileSync(join(proj, r.path), 'utf8'), 'v1');
  const again = await saveSpecToCheckout({ projectDir: proj, feature, markdown: 'v2' });
  assert.deepEqual(again, { ok: false, status: 409, error: 'exists', path: 'specs/FEAT-12-cancel-an-order.md' });
  assert.equal((await saveSpecToCheckout({ projectDir: proj, feature, markdown: 'v2', overwrite: true })).ok, true);
  assert.equal(readFileSync(join(proj, r.path), 'utf8'), 'v2');
});

test('save: refuses specs/ outside the project, a dangling link, and a symlinked target', { skip: !canSymlink() && 'symlinks need admin or Developer Mode here' }, async () => {
  const outside = tmp('req-out-');
  const p1 = tmp('req-p1-');
  symlinkSync(outside, join(p1, 'specs'), 'dir');
  assert.deepEqual(await saveSpecToCheckout({ projectDir: p1, feature, markdown: 'x' }), { ok: false, status: 409, error: 'specs/ points outside the project' });
  const p2 = tmp('req-p2-');
  symlinkSync(join(p2, 'gone'), join(p2, 'specs'), 'dir');
  assert.deepEqual(await saveSpecToCheckout({ projectDir: p2, feature, markdown: 'x' }), { ok: false, status: 409, error: 'specs/ is a broken link' });
  const p3 = tmp('req-p3-');
  mkdirSync(join(p3, 'specs'));
  writeFileSync(join(outside, 'victim.md'), 'keep');
  symlinkSync(join(outside, 'victim.md'), join(p3, 'specs', specFileName(feature)), 'file');
  assert.deepEqual(await saveSpecToCheckout({ projectDir: p3, feature, markdown: 'x', overwrite: true }), { ok: false, status: 409, error: 'refusing to write through a symlink' });
  assert.equal(readFileSync(join(outside, 'victim.md'), 'utf8'), 'keep');
  assert.equal(existsSync(join(outside, specFileName(feature))), false);
});
