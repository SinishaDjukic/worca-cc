import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatBusyReason, CHAT_BUSY } from '../src/shared/chat-busy.mjs';

test('chatBusyReason: replying wins, then a command, then a followed live run; idle is null', () => {
  assert.equal(chatBusyReason({ inFlight: true, commands: 2, tracking: 1 }), 'replying');
  assert.equal(chatBusyReason({ commands: 1, tracking: 1 }), 'command');
  assert.equal(chatBusyReason({ tracking: 1 }), 'following');
  assert.equal(chatBusyReason({}), null);
  assert.equal(chatBusyReason(), null);
});

test('every reason has its tooltip text, and each says what to do', () => {
  for (const r of ['replying', 'command', 'following']) assert.match(CHAT_BUSY[r], /^Can't archive while this chat .+\. Wait .+\.$/);
});
