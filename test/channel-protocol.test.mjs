// test/channel-protocol.test.mjs — frame vocabulary + message contracts
// (chat-connectivity-design.md §4.4) and the redaction layer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSegment, isValidMessage, isValidIncoming, isValidFrame,
  encodeFrame, decodeFrame, MAX_FRAME_BYTES,
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
