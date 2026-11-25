// test/diff-open-editor.test.mjs — the Diff tab's open-in-editor controls (ui/public/diff-open-editor.mjs):
// which control a run's Actions model allows, the tooltip texts, the first changed line, and the two
// builders (classes, label, icon, busy state, the route's error under its anchor). Plain JSDOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  editorOpenFor, runFolderOpenFor, openFileTitle, firstChangedLine,
  buildOpenFileButton, buildOpenRunButton, showOpenError, clearOpenError,
} from '../ui/public/diff-open-editor.mjs';

const ED = [{ key: 'editor', label: 'Cursor' }, { key: 'terminal', label: 'Terminal' }];
const member = (over = {}) => ({ projectKey: 'pa', state: 'not-checked-out', builtins: ED, ...over });
const model = (over = {}) => ({ enabled: true, finished: true, checkoutBlocked: null, members: [member()], ...over });

test('editorOpenFor matrix', () => {
  const rows = [
    ['no model', null, {}, null],
    ['actions off (hosted)', model({ enabled: false }), {}, null],
    ['a test-boot config object', { config: {} }, {}, null],
    ['archived', model(), { archived: true }, null],
    ['no editor', model({ members: [member({ builtins: [{ key: 'terminal', label: 'T' }] })] }), {}, null],
    ['live run', model({ finished: false, checkoutBlocked: 'Check out is available once the run has finished' }), {}, 'open'],
    ['checked out', model({ members: [member({ state: 'checked-out' })] }), {}, 'open'],
    ['no branch', model({ members: [member({ state: 'no-branch' })] }), {}, null],
    ['checkout blocked', model({ checkoutBlocked: 'git is missing' }), {}, null],
    ['held elsewhere', model({ members: [member({ heldBy: '/me/clone' })] }), {}, 'use-folder'],
    ['not checked out', model(), {}, 'checkout'],
    ['workspace: no projectKey and two members', model({ members: [member(), member({ projectKey: 'pb' })] }), {}, null],
    ['workspace: picks the member', model({ members: [member(), member({ projectKey: 'pb', state: 'checked-out' })] }), { projectKey: 'pb' }, 'open'],
    ['workspace: unknown member', model({ members: [member()] }), { projectKey: 'zz' }, null],
  ];
  for (const [name, m, opts, mode] of rows) {
    const got = editorOpenFor(m, opts);
    assert.equal(got ? got.mode : null, mode, name);
    if (got) assert.equal(got.label, 'Cursor', name);
  }
  const held = editorOpenFor(model({ members: [member({ heldBy: '/me/clone' })] }));
  assert.deepEqual(held, { label: 'Cursor', mode: 'use-folder', member: 'pa', heldBy: '/me/clone' });
});

test('runFolderOpenFor: a live run whose every member has the editor', () => {
  assert.deepEqual(runFolderOpenFor(model({ finished: false })), { label: 'Cursor' });
  assert.equal(runFolderOpenFor(model()), null, 'finished');
  assert.equal(runFolderOpenFor(model({ finished: false, enabled: false })), null);
  assert.equal(runFolderOpenFor(model({ finished: false, members: [member(), member({ builtins: [] })] })), null);
  assert.equal(runFolderOpenFor(null), null);
  assert.equal(runFolderOpenFor({ config: {} }), null);
});

test('openFileTitle texts', () => {
  assert.equal(openFileTitle('csv.mjs', 'Cursor', 'open'), 'Open csv.mjs in Cursor');
  assert.equal(openFileTitle('csv.mjs', 'Cursor', 'checkout'), 'Check out this run, then open csv.mjs in Cursor');
  assert.equal(openFileTitle('csv.mjs', 'Cursor', 'use-folder'), 'Use the folder that has this branch, then open csv.mjs in Cursor');
});

test('firstChangedLine: the first hunk\'s new-side start, at least 1; null without hunks or for binary', () => {
  assert.equal(firstChangedLine({ hunks: [{ newStart: 12 }, { newStart: 40 }] }), 12);
  assert.equal(firstChangedLine({ hunks: [{ newStart: 0 }] }), 1, 'a pure deletion opens at line 1');
  assert.equal(firstChangedLine({ hunks: [] }), null);
  assert.equal(firstChangedLine({ binary: true, hunks: [{ newStart: 3 }] }), null);
  assert.equal(firstChangedLine(null), null);
});

test('builders: classes, aria-label, title, label and icon', () => {
  const doc = new JSDOM('').window.document;
  const b = buildOpenFileButton(doc, { fileName: 'csv.mjs', label: 'Cursor', mode: 'checkout', onOpen: async () => ({ ok: true }) });
  assert.equal(b.className, 'btn btn-sm btn-quiet btn-icon hd-diff-open');
  assert.equal(b.type, 'button');
  assert.equal(b.getAttribute('aria-label'), 'Check out this run, then open csv.mjs in Cursor');
  assert.equal(b.title, 'Check out this run, then open csv.mjs in Cursor');
  assert.ok(b.querySelector('svg'), 'the external icon');
  assert.equal(b.textContent, '', 'the label is only in the tooltip');
  const r = buildOpenRunButton(doc, { label: 'Cursor', onOpen: async () => ({ ok: true }) });
  assert.equal(r.className, 'btn btn-sm rd-diff-open');
  assert.equal(r.textContent, 'Open in Cursor');
  assert.ok(r.querySelector('svg'));
});

test('a failed open shows the route\'s error under its anchor; busy while it runs; the next click clears it', async () => {
  const doc = new JSDOM('<div id="wrap"><div class="hd-diff-pane-head"></div><div class="body"></div></div>').window.document;
  const head = doc.querySelector('.hd-diff-pane-head');
  let release;
  let answer = { ok: false, error: 'Editor did not open: boom' };
  const b = buildOpenFileButton(doc, { fileName: 'a.mjs', label: 'Cursor', mode: 'open',
    onOpen: () => new Promise((r) => { release = () => r(answer); }) });
  head.append(b);
  b.click();
  assert.equal(b.disabled, true);
  assert.equal(b.getAttribute('aria-busy'), 'true');
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(b.disabled, false);
  assert.equal(b.hasAttribute('aria-busy'), false);
  const err = head.nextElementSibling;
  assert.ok(err.matches('span.field-error[role="alert"]'));
  assert.equal(err.querySelector('.fe-text').textContent, 'Editor did not open: boom');
  assert.ok(err.querySelector('svg.fe-ic'));
  answer = { ok: true };
  b.click();
  assert.equal(doc.querySelectorAll('.field-error').length, 0, 'the next click clears it');
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.querySelectorAll('.field-error').length, 0);
  showOpenError(head, 'one'); showOpenError(head, 'two');
  assert.equal(doc.querySelectorAll('.field-error').length, 1, 'one message per anchor');
  assert.equal(doc.querySelector('.fe-text').textContent, 'two');
  clearOpenError(head);
  assert.equal(doc.querySelectorAll('.field-error').length, 0);
});

test('the run button anchors its error under the note row', async () => {
  const doc = new JSDOM('<div class="rd-diff-note"><span></span><span class="rd-diff-note-end"></span></div><div class="host"></div>').window.document;
  const r = buildOpenRunButton(doc, { label: 'Cursor', onOpen: async () => ({ ok: false, error: 'This run has no shared folder.' }) });
  doc.querySelector('.rd-diff-note-end').append(r);
  r.click();
  await new Promise((res) => setTimeout(res, 0));
  assert.ok(doc.querySelector('.rd-diff-note').nextElementSibling.matches('.field-error'));
});

test('a focused button keeps the focus after the open, though disabling blurs it in Chromium', async () => {
  const win = new JSDOM('<div class="hd-diff-pane-head"></div>').window;
  const desc = Object.getOwnPropertyDescriptor(win.HTMLButtonElement.prototype, 'disabled');
  Object.defineProperty(win.HTMLButtonElement.prototype, 'disabled', { configurable: true, get: desc.get,
    set(v) { if (v) this.blur(); desc.set.call(this, v); } });
  const doc = win.document;
  const b = buildOpenFileButton(doc, { fileName: 'a.mjs', label: 'Cursor', mode: 'open', onOpen: async () => ({ ok: true }) });
  doc.querySelector('.hd-diff-pane-head').append(b);
  b.focus();
  b.click();
  assert.equal(doc.activeElement, doc.body, 'the patched setter blurs');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(doc.activeElement, b);
});
