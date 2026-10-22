// test/ui-chat-ask-changes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderAskChanges } from '../ui/public/chat/ask-changes.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;

test('Send is off while empty; a send posts the trimmed text and clears the field', async () => {
  const d = doc(); const sent = [];
  const f = renderAskChanges(d, { onSend: async (t) => { sent.push(t); } });
  d.body.appendChild(f.el);
  const input = f.el.querySelector('.ask-changes-input'); const send = f.el.querySelector('.ask-changes-send');
  assert.equal(send.disabled, true);
  input.value = '  make it blue '; input.dispatchEvent(new d.defaultView.Event('input'));
  send.click(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, ['make it blue']);
  assert.equal(input.value, '');
});

test('a failed send keeps the text and says why', async () => {
  const d = doc();
  const f = renderAskChanges(d, { onSend: async () => { throw Object.assign(new Error('x'), { body: { error: 'the run is still going' } }); } });
  const input = f.el.querySelector('.ask-changes-input');
  input.value = 'make it blue'; input.dispatchEvent(new d.defaultView.Event('input'));
  f.el.querySelector('.ask-changes-send').click(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(input.value, 'make it blue');
  assert.equal(f.el.querySelector('.ask-changes-err').textContent, 'Not sent: the run is still going');
});
