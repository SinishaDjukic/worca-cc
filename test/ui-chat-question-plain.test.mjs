// test/ui-chat-question-plain.test.mjs — the chat question card's opt-in lead (ui/public/chat/question.mjs with
// src/shared/answerer.mjs): a product lead reads the plain twin; with no options the markup is the entry's own words,
// whatever lead is saved and whatever the flag says. jsdom, no app boot.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildChatQuestion } from '../ui/public/chat/question.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const rig = () => { const dom = new JSDOM('<!doctype html><html><body></body></html>'); doms.push(dom); return dom.window.document; };
const spec = (questions) => ({ id: 'chat-q-x', heading: 'Your turn', questions, submitLabel: () => 'Go', onSubmit: async () => {} });

const PLAIN = [{ id: 'q1', text: 'Who may export: everyone with project:read?', plain: 'Who may export?', options: [
  { value: 'members', label: 'Require project:read', plain: 'Anyone who can see the project' },
  { value: 'owner', label: 'Owner only' },
] }];

test('opts.lead product: the question and options read their plain twins', () => {
  const doc = rig();
  const { el } = buildChatQuestion(doc, spec(PLAIN), { lead: 'product' });
  assert.equal(el.querySelector('.qtext-t').textContent, 'Who may export?');
  assert.deepEqual([...el.querySelectorAll('.chat-q-opt-label')].map((n) => n.textContent), ['Anyone who can see the project', 'Owner only']);
  assert.equal(el.querySelector('.qopts').getAttribute('aria-label'), 'Who may export?');
});

test('no options: an entry with backticks and no plain twin gives the same markup as without the option', () => {
  const doc = rig();
  const q = [{ id: 'q1', text: 'Run `npm ci` first?', options: [{ value: 'y', label: 'Yes, `npm ci`' }, { value: 'n', label: 'No' }] }];
  const base = buildChatQuestion(doc, spec(q)).el.outerHTML;
  assert.match(base, /Run `npm ci` first\?/);
  assert.equal(buildChatQuestion(doc, spec(q), {}).el.outerHTML, base);
  assert.equal(buildChatQuestion(doc, spec(PLAIN)).el.querySelector('.qtext-t').textContent, PLAIN[0].text, 'no lead: the entry text');
});
