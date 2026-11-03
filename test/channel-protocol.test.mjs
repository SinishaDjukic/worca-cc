// test/channel-protocol.test.mjs — frame vocabulary + message contracts
// (chat-connectivity-design.md §4.4) and the redaction layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSegment, isValidMessage, isValidIncoming, isValidFrame,
  encodeFrame, decodeFrame, MAX_FRAME_BYTES, HOST_FRAMES,
} from '../src/core/chat/channel-protocol.mjs';
import { redactSecrets } from '../src/core/chat/redact.mjs';

const MSG = { title: 'Run done', body: [{ kind: 'text', value: 'ok' }], severity: 'success' };
const HELLO = {
  type: 'hello', apiVersion: 2, plugin: 'p', channelId: 'main',
  platform: 'telegram', module: '/abs/worker.mjs', config: {}, state: {},
};

test('segment/message/incoming validators (ported adapter.js contract)', () => {
  assert.equal(isValidSegment({ kind: 'text', value: 'x' }), true);
  assert.equal(isValidSegment({ kind: 'link', value: 'PR', href: 'https://x' }), true);
  assert.equal(isValidSegment({ kind: 'blink', value: 'x' }), false);
  assert.equal(isValidSegment({ kind: 'text' }), false);

  assert.equal(isValidMessage(MSG), true);
  assert.equal(isValidMessage({ ...MSG, title: null }), true);
  assert.equal(isValidMessage({ ...MSG, severity: 'fatal' }), false);
  assert.equal(isValidMessage({ ...MSG, body: [{ kind: 'nope', value: '' }] }), false);

  assert.equal(isValidIncoming({ chatId: '42', userId: 'u1', text: '/status', meta: {} }), true);
  assert.equal(isValidIncoming({ chatId: '42', userId: 'u1', text: '/status' }), true); // meta optional
  assert.equal(isValidIncoming({ chatId: '', userId: 'u1', text: 'x' }), false);       // empty chatId
  assert.equal(isValidIncoming({ chatId: '42', text: 'x' }), false);
});

test('isValidFrame: every direction, strict on type, tolerant on extras', () => {
  assert.equal(isValidFrame(HELLO), true);
  assert.equal(isValidFrame({ ...HELLO, extra: 1 }), true, 'additive growth allowed');
  assert.equal(isValidFrame({ ...HELLO, module: undefined }), false);
  assert.equal(isValidFrame({ type: 'send', id: 's-1', chatId: '42', message: MSG }), true);
  assert.equal(isValidFrame({ type: 'send', id: 's-1', chatId: '42', message: { bad: 1 } }), false);
  assert.equal(isValidFrame({ type: 'send-result', id: 's-1', ok: true }), true);
  assert.equal(isValidFrame({ type: 'send-result', id: 's-1', ok: false, error: { kind: 'auth', message: 'x' } }), true);
  assert.equal(isValidFrame({ type: 'send-result', id: 's-1', ok: false }), false, 'failure needs error.message');
  assert.equal(isValidFrame({ type: 'status', state: 'connected' }), true);
  assert.equal(isValidFrame({ type: 'status', state: 'zombie' }), false);
  assert.equal(isValidFrame({ type: 'inbound', msg: { chatId: '42', userId: 'u', text: 'hi' } }), true);
  assert.equal(isValidFrame({ type: 'state-delta', delta: { cursor: 7 } }), true);
  assert.equal(isValidFrame({ type: 'state-delta', delta: [1] }), false);
  assert.equal(isValidFrame({ type: 'webhook', id: 'w-1', method: 'POST', path: '/x', headers: {}, bodyB64: '' }), true);
  assert.equal(isValidFrame({ type: 'webhook-result', id: 'w-1', statusCode: 401 }), true);
  assert.equal(isValidFrame({ type: 'ping', id: 'p1' }), true);
  assert.equal(isValidFrame({ type: 'shutdown' }), true);
  assert.equal(isValidFrame({ type: 'wat' }), false);
  assert.equal(isValidFrame(null), false);
});

test('encode/decode round-trip; oversize refused both ways', () => {
  const line = encodeFrame(HELLO);
  assert.ok(line.endsWith('\n'));
  assert.deepEqual(decodeFrame(line.trimEnd()), HELLO);
  assert.equal(decodeFrame('{nope'), null);
  assert.equal(decodeFrame(JSON.stringify({ type: 'wat' })), null);
  const big = { type: 'log', level: 'info', msg: 'x'.repeat(MAX_FRAME_BYTES) };
  assert.throws(() => encodeFrame(big), /MAX_FRAME_BYTES/);
  assert.equal(decodeFrame(JSON.stringify(big)), null);
});

test('redactSecrets scrubs every platform credential shape', () => {
  const red = redactSecrets([
    'https://api.telegram.org/bot123456789:AAHnbEXAMPLEsecretEXAMPLEsecretEXAMPLE/getMe',
    'https://hooks.slack.com/services/T0ABC123/B0DEF456/XyZ123abc456',
    'xoxb-1234567890-abcdefghij', 'xapp-1-A123-xyz',
    'https://discord.com/api/webhooks/1234567890/AbCdEf_Gh-123',
    'Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
    'client_secret=SuperSecret123&grant_type=client_credentials',
  ].join(' | '));
  assert.doesNotMatch(red, /AAHnbEXAMPLE/);
  assert.doesNotMatch(red, /XyZ123abc456/);
  assert.doesNotMatch(red, /xoxb-1234567890/);
  assert.doesNotMatch(red, /xapp-1-A123/);
  assert.doesNotMatch(red, /AbCdEf_Gh-123/);
  assert.doesNotMatch(red, /SuperSecret123/);
  assert.match(red, /bot<redacted>/);
  assert.match(red, /Bearer <redacted>/);
  assert.match(red, /client_secret=<redacted>/);
  assert.equal(redactSecrets('plain message, no secrets'), 'plain message, no secrets');
});
import { isValidControls, isValidInteraction, isValidSendOptions, CONTROL_LIMITS, MAX_CHAT_ID } from '../src/core/chat/channel-protocol.mjs';
import * as vendored from '../plugins/discord-chat/lib/message.mjs';

const REF = 'AbCdEfGhIjKlMnOpQrStUvWx';
const CMSG = (controls) => ({ title: null, body: [{ kind: 'markdown', value: 'x' }], severity: 'info', controls });

test('controls: buttons, link, select, modal spec; limits refuse', () => {
  const ok = [
    { kind: 'button', ref: REF, label: 'Start run', style: 'primary' },
    { kind: 'button', ref: REF.replace('A', 'B'), label: 'Answer', style: 'secondary',
      modal: { title: 'Your answer', fields: [{ id: 'text', label: 'Answer', style: 'paragraph', required: true, maxLength: 2000 }] } },
    { kind: 'link', label: 'Open in worca', url: 'https://worca.example/#chat/ask_0123abcd' },
    { kind: 'select', ref: REF.replace('A', 'C'), placeholder: 'Pick one', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', description: 'second' }] },
  ];
  assert.equal(isValidControls(ok), true);
  for (const impl of [isValidMessage, vendored.isValidMessage]) {
    assert.equal(impl(CMSG(ok)), true);
    assert.equal(impl(CMSG(undefined)), true, 'controls are optional');
    assert.equal(impl(CMSG([{ kind: 'button', ref: 'short', label: 'x', style: 'primary' }])), false, 'ref shape');
    assert.equal(impl(CMSG([{ kind: 'link', label: 'x', url: 'javascript:alert(1)' }])), false, 'link scheme');
    assert.equal(impl(CMSG([{ kind: 'select', ref: REF, options: [] }])), false, 'empty select');
    assert.equal(impl(CMSG([{ kind: 'select', ref: REF, options: Array.from({ length: 26 }, (_, i) => ({ value: `v${i}`, label: `L${i}` })) }])), false, '26 options');
    assert.equal(impl(CMSG(Array.from({ length: CONTROL_LIMITS.controls + 1 }, (_, i) => ({ kind: 'link', label: `l${i}`, url: 'https://x.example' })))), false, 'too many');
    assert.equal(impl(CMSG([{ kind: 'button', ref: REF, label: 'x', style: 'blurple' }])), false, 'style');
    assert.equal(impl(CMSG([{ kind: 'button', ref: REF, label: 'x', style: 'primary', modal: { title: 'x'.repeat(46), fields: [] } }])), false, 'modal title');
  }
});

test('send options and interaction frames', () => {
  assert.equal(isValidSendOptions({ edit: { messageId: 'm1' } }), true);
  assert.equal(isValidSendOptions({ thread: { fromMessageId: 'm1', name: 'Chat with worca' } }), true);
  assert.equal(isValidSendOptions({ edit: { messageId: 'm1' }, thread: { fromMessageId: 'm1', name: 'x' } }), false, 'one at a time');
  assert.equal(isValidSendOptions({ thread: { fromMessageId: 'm1', name: '' } }), false);
  const evt = { id: 'i1', chatId: 'T1', userId: 'U1', ref: REF, kind: 'select', values: ['a'], meta: { platform: 'discord' } };
  assert.equal(isValidInteraction(evt), true);
  assert.equal(isValidInteraction({ ...evt, kind: 'modal', values: undefined, fields: { text: 'hi' } }), true);
  assert.equal(isValidInteraction({ ...evt, ref: 'bad ref' }), false);
  assert.equal(isValidInteraction({ ...evt, values: [7] }), false);
  // A Teams reply chain: `<channel>;messageid=<root>` is 72 chars, past the old 64-char cap.
  const teamsThread = '19:0a1b2c3d4e5f60718293a4b5c6d7e8f9@thread.tacv2;messageid=1700000000001';
  assert.equal(MAX_CHAT_ID, 256);
  assert.equal(isValidInteraction({ ...evt, chatId: teamsThread }), true);
  assert.equal(isValidInteraction({ ...evt, chatId: 'x'.repeat(MAX_CHAT_ID) }), true);
  assert.equal(isValidInteraction({ ...evt, chatId: 'x'.repeat(MAX_CHAT_ID + 1) }), false);
  assert.equal(isValidInteraction({ ...evt, id: 'x'.repeat(65) }), false, 'the interaction id stays at 64');
  assert.equal(isValidFrame({ type: 'interaction', evt }), true);
  assert.equal(isValidFrame({ type: 'interaction-reply', id: 'r1', interactionId: 'i1', text: 'Only the owner can act.' }), true);
  assert.equal(isValidFrame({ type: 'send', id: 's1', chatId: 'C', message: CMSG(undefined), options: { edit: { messageId: 'm1' } } }), true);
  assert.equal(isValidFrame({ type: 'send', id: 's1', chatId: 'C', message: CMSG(undefined), options: { edit: {} } }), false);
});

test('react frame: chat, message, emoji and on/off are required and bounded', () => {
  const ok = { type: 'react', id: 'x1', chatId: 'C1', messageId: '1234567890', emoji: '⏳', on: true };
  assert.ok(HOST_FRAMES.includes('react'));
  assert.equal(isValidFrame(ok), true);
  assert.equal(isValidFrame({ ...ok, on: false }), true);
  assert.equal(isValidFrame({ ...ok, on: 'yes' }), false);
  assert.equal(isValidFrame({ ...ok, messageId: '' }), false);
  assert.equal(isValidFrame({ ...ok, messageId: 'x'.repeat(65) }), false);
  assert.equal(isValidFrame({ ...ok, chatId: '' }), false);
  assert.equal(isValidFrame({ ...ok, chatId: '19:0a1b2c3d4e5f60718293a4b5c6d7e8f9@thread.tacv2;messageid=1700000000001' }), true);
  assert.equal(isValidFrame({ ...ok, chatId: 'x'.repeat(256) }), true);
  assert.equal(isValidFrame({ ...ok, chatId: 'x'.repeat(257) }), false);
  assert.equal(isValidFrame({ ...ok, emoji: '' }), false);
  assert.equal(isValidFrame({ ...ok, emoji: 'x'.repeat(33) }), false);
  assert.equal(isValidFrame({ ...ok, id: 7 }), false);
});
