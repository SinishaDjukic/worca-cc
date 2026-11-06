import test from 'node:test';
import assert from 'node:assert/strict';
import { withoutControls } from '../src/core/chat/channel-host.mjs';

test('withoutControls keeps links as text, drops executable controls', () => {
  const m = { title: null, severity: 'info', body: [{ kind: 'markdown', value: 'Proposed run' }],
    controls: [{ kind: 'button', ref: 'AbCdEfGhIjKlMnOpQrStUvWx', label: 'Start run', style: 'primary' },
      { kind: 'link', label: 'Open in worca', url: 'https://w.example/#chat/ask_0123abcd' }] };
  const out = withoutControls(m);
  assert.equal('controls' in out, false);
  assert.deepEqual(out.body.slice(1), [{ kind: 'text', value: '\n' }, { kind: 'link', value: 'Open in worca', href: 'https://w.example/#chat/ask_0123abcd' }]);
  const plain = { title: null, severity: 'info', body: [] };
  assert.equal(withoutControls(plain), plain);
});
