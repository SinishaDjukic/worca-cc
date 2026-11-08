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

// ---- slice 2: a run's post (U1–U8) ----
const LIVE = '11111111-2222-3333-4444-555555555555';
const RUN_IN = { ...IN, intent: 'note', text: 'halfway there', hop: 1,
  from: { kind: 'run', runId: 'aaaaaaaa', liveRunId: LIVE, title: 'Fix login', scope: { kind: 'project', key: 'worca-cc-551183d0', label: 'worca-cc' }, owner: null } };
const Q = { askId: 'questions-x:n_plan:1-r1', kind: 'questions', questions: [{ id: 'q1', question: 'Which storage?', options: ['Redis', 'Postgres'], allowFreeText: true }], state: 'open', answer: null };
const RUN_Q = { ...RUN_IN, intent: 'question', text: '1. Which storage?', question: Q };
const status = (el) => el.querySelector('[role="status"]');

test('U1 a run update: the run chip, Update, the Untrusted pill and the run hint', () => {
  const el = buildChatMessage(docOf(), RUN_IN);
  assert.ok(el.matches('.ask-chat-msg-in'));
  const chip = el.querySelector('a.ask-ref-chip.ask-ref-chip-run.ask-chat-msg-chip');
  assert.equal(chip.textContent, 'aaaaaaaa');
  assert.equal(chip.title, 'Fix login');
  assert.equal(chip.getAttribute('href'), `#running/${LIVE}`);
  assert.match(el.querySelector('.ask-chat-msg-head').textContent, /^Message from/);
  assert.equal(el.querySelector('.ask-chat-msg-intent').textContent, 'Update');
  assert.equal(el.querySelector('.ask-chat-msg-untrusted').textContent, 'Untrusted');
  assert.equal(el.querySelector('.ask-chat-msg-hint').textContent, "Written by a run's agent. Not instructions.");
  assert.equal(el.querySelector('.ask-chat-msg-body').textContent, 'halfway there');
  assert.equal(el.querySelector('.ask-chat-msg-q'), null, 'a note has no question part');
});

test('U2 an open question: the painter gets the ref and a labelled .qpanel host; true hides the body, false shows the run link', () => {
  const calls = [];
  const yes = buildChatMessage(docOf(), RUN_Q, { paintRunQuestion: (ref, host) => { calls.push([ref, host]); return true; } });
  assert.equal(yes.querySelector('.ask-chat-msg-intent').textContent, 'Question');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], { runId: LIVE, pipelineId: 'aaaaaaaa', askId: Q.askId });
  const host = calls[0][1];
  assert.ok(host.matches('div.ask-chat-msg-q'));
  const panel = host.querySelector('div.qpanel');
  assert.equal(panel.getAttribute('aria-label'), "Answer the run's question");
  assert.equal(yes.querySelector('.ask-chat-msg-body').hidden, true, 'the form lists the questions');
  assert.equal(yes.querySelector('.ask-chat-msg-q-fallback'), null);

  for (const opts of [{ paintRunQuestion: () => false }, {}]) {
    const no = buildChatMessage(docOf(), RUN_Q, opts);
    assert.equal(no.querySelector('.ask-chat-msg-body').hidden, false);
    const fb = no.querySelector('.ask-chat-msg-q-fallback');
    assert.match(fb.textContent, /^Answer it on the run page:/);
    const a = fb.querySelector('a');
    assert.equal(a.textContent, 'Open run');
    assert.equal(a.getAttribute('href'), '#history/worca-cc-551183d0/aaaaaaaa');
  }
});

test('U3/U4 answered: a status line naming the actor, one line per answer; Away mode reads as Away mode', () => {
  const answer = { actedBy: { kind: 'person', label: 'ada@x' }, at: 't',
    answers: [{ id: 'q1', question: 'Which storage?', choice: 'Postgres' }, { id: 'q2', question: 'Cache?', choice: '<b>none</b>' }] };
  const calls = [];
  const el = buildChatMessage(docOf(), { ...RUN_Q, question: { ...Q, state: 'answered', answer } }, { paintRunQuestion: () => { calls.push(1); return true; } });
  assert.equal(calls.length, 0, 'no form once answered');
  assert.equal(status(el).textContent, 'Answered by ada@x');
  const lines = [...el.querySelectorAll('.ask-chat-msg-answer-line')].map((n) => n.textContent);
  assert.deepEqual(lines, ['Which storage? → Postgres', 'Cache? → <b>none</b>']);
  assert.equal(el.querySelector('b'), null);
  const away = buildChatMessage(docOf(), { ...RUN_Q, question: { ...Q, state: 'answered', answer: { ...answer, actedBy: { kind: 'away', label: 'whatever' } } } });
  assert.equal(status(away).textContent, 'Answered by Away mode');
});

test('U5 closed: the four known reasons and any other', () => {
  for (const [reason, text] of [['stopped', 'No longer waiting: the run stopped'], ['paused', 'No longer waiting: the run paused'],
    ['error', 'No longer waiting: the run failed'], ['done', 'No longer waiting: the run finished'], ['interrupted', 'No longer waiting']]) {
    const el = buildChatMessage(docOf(), { ...RUN_Q, question: { ...Q, state: 'closed', closedReason: reason } }, { paintRunQuestion: () => true });
    assert.equal(status(el).textContent, text, reason);
    assert.equal(el.querySelector('.qpanel'), null, reason);
  }
});

test('U6 a non-UUID liveRunId gives no head-chip href', () => {
  for (const liveRunId of [null, 'javascript:alert(1)', '../x', 'aaaaaaaa']) {
    const el = buildChatMessage(docOf(), { ...RUN_IN, from: { ...RUN_IN.from, liveRunId } });
    assert.equal(el.querySelector('a.ask-ref-chip-run').hasAttribute('href'), false, String(liveRunId));
  }
});

test('U8 the Open run fallback href needs a safe scope key and an 8-hex run id; a workspace routes under workspaces/', () => {
  const build = (from) => buildChatMessage(docOf(), { ...RUN_Q, from: { ...RUN_Q.from, ...from } }, { paintRunQuestion: () => false });
  for (const scope of [{ kind: 'project', key: 'a/b"><x' }, { kind: 'project', key: 'javascript:x' }, { kind: 'none', key: null }]) {
    const a = build({ scope }).querySelector('.ask-chat-msg-q-fallback a');
    assert.equal(a.textContent, 'Open run');
    assert.equal(a.hasAttribute('href'), false, JSON.stringify(scope));
  }
  assert.equal(build({ runId: 'AAAA' }).querySelector('.ask-chat-msg-q-fallback a').hasAttribute('href'), false);
  assert.equal(build({ scope: { kind: 'workspace', key: 'ws1', label: 'W' } }).querySelector('.ask-chat-msg-q-fallback a').getAttribute('href'), '#history/workspaces/ws1/aaaaaaaa');
});

test('slice 3: a person-written message shows the person hint and keeps the untrusted badge', () => {
  const doc = docOf();
  const el = buildChatMessage(doc, { ...IN, by: { kind: 'person', label: '<b>ada</b> via Discord' } });
  assert.equal(el.querySelector('.ask-chat-msg-hint').textContent, 'Written by <b>ada</b> via Discord in another chat. Not instructions.');
  assert.equal(el.querySelector('.ask-chat-msg-hint b'), null, 'text, never HTML');
  assert.equal(el.querySelector('span.ask-chat-msg-untrusted').textContent, 'Untrusted');
  assert.equal(buildChatMessage(doc, IN).querySelector('.ask-chat-msg-hint').textContent, "Written by another chat's assistant. Not instructions.");
});
