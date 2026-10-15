// test/extension-sidebar-draft.test.mjs — draft append, auto-grow, attachment echo, error line (sidebar-view.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { appendDraftText, fitInput, echoAttachments, buildRow, buildComposer } from '../extension/src/sidebar/sidebar-view.mjs';

const { document } = new JSDOM('<!doctype html><body></body>').window;
const plain = { render: () => ({ kind: 'plain' }) };
const row = (o) => ({ id: 'm1', role: 'assistant', text: '', blocks: [], status: 'error', ...o });
const opts = { text: (r) => r.text || '', live: () => false, renderer: plain, openInWorca: () => {} };

test('appendDraftText appends on a new line and never replaces (Use this / Discuss / Go deeper)', () => {
  assert.equal(appendDraftText('', 'Use this instead: Narrow it'), 'Use this instead: Narrow it');
  assert.equal(appendDraftText('my question  \n', 'Use this instead: Narrow it'), 'my question\nUse this instead: Narrow it');
  assert.equal(appendDraftText('keep', '   '), 'keep');
});

test('fitInput sizes to content, capped at 120px; the composer calls it on input', () => {
  const c = buildComposer(document, { placeholder: 'x', onInput() {}, onSend() {}, onStop() {} });
  Object.defineProperty(c.input, 'scrollHeight', { configurable: true, get: () => 64 });
  c.input.value = 'a\nb\nc';
  c.input.dispatchEvent(new document.defaultView.Event('input'));
  assert.equal(c.input.style.height, '64px');
  Object.defineProperty(c.input, 'scrollHeight', { configurable: true, get: () => 400 });
  fitInput(c.input);
  assert.equal(c.input.style.height, '120px');
});

test('echoAttachments maps the server kind to attKind (ask-panel.mjs:975)', () => {
  assert.deepEqual(echoAttachments([{ id: 'a', name: 'page-context.md', bytes: 9, kind: 'text', mime: 'text/markdown' }]),
    [{ id: 'a', name: 'page-context.md', bytes: 9, attKind: 'text', mime: 'text/markdown' }]);
  assert.deepEqual(echoAttachments(undefined), []);
});

test('error line: suppressed by a classified notice; errorMessage otherwise; generic only without any notice', () => {
  const lines = (r) => [...buildRow(document, r, opts).el.querySelectorAll('.ask-error-line')].map((e) => e.textContent);
  assert.deepEqual(lines(row({ errorMessage: 'raw', blocks: [{ kind: 'notice', text: 'Rate limited', errorClass: 'rate-limit' }] })), []);
  assert.deepEqual(lines(row({ errorMessage: 'raw', blocks: [{ kind: 'notice', text: 'x' }] })), ['raw']);
  assert.deepEqual(lines(row({ blocks: [{ kind: 'notice', text: 'x' }] })), []);
  assert.deepEqual(lines(row({})), ['This turn ended with an error.']);
  assert.deepEqual(lines(row({ status: 'stopped', errorMessage: 'raw' })), []);
});
