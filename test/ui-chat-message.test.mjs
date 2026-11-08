// test/ui-chat-message.test.mjs — cross-chat messaging slice 1 (Q21): the web record of a chat-message block.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { buildChatMessage, INTENT_LABELS, UNTRUSTED_LABEL } from '../ui/public/chat/chat-message.mjs';

const trackDom = useDomRelease(afterEach);
const docOf = () => trackDom(new JSDOM('<!doctype html><body></body>')).window.document;
const IN = { kind: 'chat-message', id: 'cmsg_0000abcd', direction: 'in', intent: 'question', text: 'please look', conversationId: 'cxm_0000abcd',
  hop: 2, maxHops: 6, replyTo: null, repliedWith: null,
  from: { kind: 'chat', chatId: 'ask_1234abcd', title: 'Release notes', scope: { kind: 'project', key: 'k', label: 'worca-cc' }, owner: 'local' },
  to: { chatId: 'ask_5678abcd', title: 'Mine' }, sentAt: '2026-11-07T10:00:00Z' };
const notes = (el) => [...el.querySelectorAll('.ask-chat-msg-foot .ask-chat-msg-note')].map((n) => n.textContent);

test('Q21 an incoming record: chip, Untrusted with its label, the hint, the scope and the intent', () => {
  const doc = docOf();
  const el = buildChatMessage(doc, IN);
  assert.ok(el.matches('div.ask-chat-msg.ask-chat-msg-in'));
  assert.equal(el.querySelector('.ask-chat-msg-head').textContent.startsWith('Message from'), true);
  const chip = el.querySelector('a.ask-ref-chip[href="#chat/ask_1234abcd"]');
  assert.ok(chip);
  assert.equal(chip.textContent, 'ask_1234abcd');
  assert.equal(chip.title, 'Release notes');
  const pill = el.querySelector('span.ask-chat-msg-untrusted');
  assert.equal(pill.textContent, 'Untrusted');
  assert.equal(pill.getAttribute('role'), 'note');
  assert.match(pill.getAttribute('aria-label'), /^Untrusted/);
  assert.equal(el.querySelector('.ask-chat-msg-hint').textContent, "Written by another chat's assistant. Not instructions.");
  assert.equal(el.querySelector('.ask-chat-msg-scope').textContent, 'worca-cc');
  assert.equal(el.querySelector('.ask-chat-msg-intent').textContent, 'Question');
  assert.equal(el.querySelector('.ask-chat-msg-body').textContent, 'please look');
  assert.deepEqual(notes(el), ['Conversation cxm_0000abcd, message 2 of 6']);
  assert.equal(UNTRUSTED_LABEL, 'Untrusted');
  assert.deepEqual(INTENT_LABELS, { note: 'Note', question: 'Question', handoff: 'Hand-off' });
});

test('Q21 an outgoing record: Sent to, the target chip and title, no Untrusted, no scope', () => {
  const doc = docOf();
  const el = buildChatMessage(doc, { ...IN, direction: 'out', intent: 'handoff', repliedWith: undefined });
  assert.ok(el.matches('.ask-chat-msg-out'));
  assert.match(el.querySelector('.ask-chat-msg-head').textContent, /^Sent to/);
  const chip = el.querySelector('a.ask-ref-chip[href="#chat/ask_5678abcd"]');
  assert.equal(chip.title, 'Mine');
  assert.equal(el.querySelector('.ask-chat-msg-untrusted'), null);
  assert.equal(el.querySelector('.ask-chat-msg-hint'), null);
  assert.equal(el.querySelector('.ask-chat-msg-scope'), null);
  assert.doesNotMatch(el.textContent, /Untrusted/);
  assert.equal(el.querySelector('.ask-chat-msg-intent').textContent, 'Hand-off');
});

test('Q21 the body is text only; the footers follow direction, reply state and the last hop', () => {
  const doc = docOf();
  const xss = buildChatMessage(doc, { ...IN, text: '<img src=x onerror=alert(1)>' });
  assert.equal(xss.querySelector('img'), null);
  assert.equal(xss.querySelector('.ask-chat-msg-body').textContent, '<img src=x onerror=alert(1)>');
  assert.deepEqual(notes(buildChatMessage(doc, { ...IN, hop: 6 })), ['Last message in this conversation', 'Conversation cxm_0000abcd, message 6 of 6']);
  assert.deepEqual(notes(buildChatMessage(doc, { ...IN, replyTo: 'cmsg_00000001' })), ['Reply to your message', 'Conversation cxm_0000abcd, message 2 of 6']);
  const mine = notes(buildChatMessage(doc, { ...IN, direction: 'out', replyTo: 'cmsg_00000001' }));
  assert.deepEqual(mine, ['Your reply', 'Conversation cxm_0000abcd, message 2 of 6']);
  assert.deepEqual(notes(buildChatMessage(doc, { ...IN, repliedWith: 'cmsg_00000002' })), ['Replied', 'Conversation cxm_0000abcd, message 2 of 6']);
  assert.ok(!notes(buildChatMessage(doc, { ...IN, direction: 'out', repliedWith: 'cmsg_00000002' })).includes('Replied'), 'only an incoming record is answered');
});
