// test/network-proxy-text.test.mjs
// The Network proxy card's status sentences live in src/shared/network-proxy-text.mjs so setup apply's
// proxy-swap row says exactly what the card says (A20). The card and proxy-host.mjs re-export them unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../src/shared/network-proxy-text.mjs';
import * as card from '../ui/public/settings-network-proxy.mjs';
import { FIXED_PORT_NOTE as hostNote } from '../src/core/proxy-host.mjs';

test('the card re-exports the shared sentences with their exact wording', () => {
  const expected = {
    FIXED_PORT_NOTE: 'Applies at the next start',
    SAVED_TEXT: 'Saved. New connections use it now.',
    PORT_PENDING_TEXT: ' The local proxy port applies at the next start.',
    NOT_SAVED_TEXT: 'Not saved: the test did not pass. Fix the values and Save again.',
    SAVED_OFF_TEXT: 'Saved. New connections go direct now.',
  };
  for (const [k, v] of Object.entries(expected)) {
    assert.equal(shared[k], v, k);
    assert.equal(card[k], v, `card ${k}`);
  }
  assert.equal(hostNote, shared.FIXED_PORT_NOTE);
});
