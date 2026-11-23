// test/ask-panel-composer-ext.test.mjs — the chat composer's extension (ask-panel setComposerExt, docs/design.md "In the
// chat"): a new design and a chat's design use the chat's own composer. Their pills open the composer's own menu, their
// buttons and lead join its row and lead row; a new design's send takes the message, a chat's design only adds its
// payload to the chat's own message.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makePanel, openChat } from './helpers/ask-panel-harness.mjs';

const opened = [];
afterEach(() => { for (const c of opened.splice(0)) { try { c.panel.destroy(); } catch { /* gone */ } c.window.close(); } });

const THREAD = { id: 'ask_0000000a', title: 'A tea shop', designId: 'd_00000000000a', context: { pinned: false }, engine: 'claude' };
const snapshot = { thread: THREAD, messages: [], attachments: [], runLinks: [], inFlight: null };

/** A panel whose designChat lends `ext` (made per mount from the slot it gets) to the composer. */
function rig(makeExt) {
  const sent = [];
  const handles = [];
  const designChat = {
    enabled: () => true,
    mountStart(slot, { setComposer }) {
      const composerSlot = slot.ownerDocument.createElement('div');
      slot.replaceChildren(composerSlot);
      handles.push(setComposer(makeExt({ doc: slot.ownerDocument, composerSlot, sent })));
    },
    mount(slot, { setComposer }) { handles.push(setComposer(makeExt({ doc: slot.ownerDocument, sent }))); },
    unmount() {},
  };
  const ctx = makePanel({ deps: { designChat }, fetchHandler: (url, opts) => (url === '/api/ask/threads/ask_0000000a/messages' && opts.method === 'POST'
    ? { ok: true, status: 202, json: async () => ({ userMessageId: 'msg_1', assistantMessageId: 'msg_2' }) }
    : { ok: true, status: 200, json: async () => (url.startsWith('/api/ask/threads/ask_0000000a') ? snapshot : {}) }) });
  opened.push(ctx);
  ctx.panel.open();
  return { ...ctx, sent, handles };
}
const type = (ctx, text) => {
  const input = ctx.doc.querySelector('.ask-input');
  input.value = text;
  input.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
};

test('a new design: the composer goes under its heading with its pill, buttons and placeholder; a pick repaints the pill; the send is the view\'s', async () => {
  let kind = 'web';
  const ctx = rig(({ doc, composerSlot, sent }) => ({
    composerSlot, sets: false, placeholder: 'A landing page',
    pills: [{ key: 'kind', caption: 'Kind', label: () => (kind === 'web' ? 'Web page' : 'Video'),
      items: () => [{ text: 'Web page', checked: kind === 'web', pick: () => { kind = 'web'; } }, { text: 'Video', checked: kind === 'video', pick: () => { kind = 'video'; } }] }],
    nodes: [Object.assign(doc.createElement('span'), { className: 'gear' })],
    send: async (m) => { sent.push(m); return sent.length === 1 ? { ok: false, error: 'Could not create the design.' } : { ok: true }; },
  }));
  assert.equal(ctx.panel.startDesign(), true);
  await ctx.tick();
  const { doc } = ctx;
  const composer = doc.querySelector('.ask-composer');
  assert.ok(composer.parentElement.matches('[data-chat-design] div'), 'the composer sits in the view\'s slot');
  const row = composer.querySelector('.ask-composer-row');
  const pill = row.querySelector('[data-ask-composer-ext] [data-ask-ext-pill="kind"]');
  assert.deepEqual([pill.textContent, pill.getAttribute('aria-label'), !!row.querySelector('[data-ask-composer-ext] .gear')], ['Web page', 'Kind: Web page', true]);
  assert.equal(row.dataset.extSets, 'off', 'Sets leave the row');
  assert.equal(doc.querySelector('.ask-input').placeholder, 'A landing page');
  pill.click();
  const items = [...doc.querySelectorAll('.ask-pop-ext [role="menuitemradio"]')];
  assert.deepEqual(items.map((b) => [b.textContent, b.getAttribute('aria-checked')]), [['Web page', 'true'], ['Video', 'false']]);
  items[1].click();
  assert.deepEqual([pill.textContent, doc.querySelector('.ask-pop-ext')], ['Video', null]);
  type(ctx, 'A tea shop page');
  doc.querySelector('[data-ask-send]').click();
  await ctx.tick();
  assert.deepEqual(ctx.sent[0], { text: 'A tea shop page', files: [], pick: ctx.sent[0].pick, projectKey: null });
  assert.equal(typeof ctx.sent[0].pick.model, 'string');
  assert.deepEqual([doc.querySelector('.ask-input').value, doc.querySelector('.ask-composer-msg').textContent], ['A tea shop page', 'Could not create the design.'],
    'a refusal keeps the words and says why');
  doc.querySelector('[data-ask-send]').click();
  await ctx.tick();
  assert.equal(doc.querySelector('.ask-input').value, '', 'a sent message clears the composer');
  assert.equal(ctx.fetchCalls.some((c) => c.url === '/api/ask/threads' || /\/messages$/.test(c.url)), false, 'no Ask turn');
});

test('a chat with a design is a chat: its transcript stays, its pins ride the chat\'s own message (payload), and another chat gives everything back', async () => {
  let sentCalls = 0;
  const ctx = rig(({ doc }) => ({
    lead: Object.assign(doc.createElement('div'), { className: 'pins' }),
    nodes: [Object.assign(doc.createElement('span'), { className: 'gear' })],
    payload: () => ({ design: { designId: THREAD.designId, pins: [{ id: 'hero', path: 'h1', tag: 'h1', text: 'Hi', html: '' }] } }),
    sent: () => { sentCalls += 1; },
  }));
  await openChat(ctx, THREAD.id);
  const { doc } = ctx;
  assert.equal(doc.querySelector('.chat-page').dataset.view, 'thread', 'no design view: the chat keeps its transcript');
  assert.equal(doc.querySelector('[data-chat-design]').hasAttribute('data-inline'), true, 'the design sits above the composer');
  assert.equal(doc.querySelector('[data-ask-scope-btn]').disabled, false, 'the scope is the chat\'s own');
  assert.equal(doc.querySelector('.ask-composer-row').dataset.extSets, undefined, 'Sets stay');
  assert.ok(doc.querySelector('[data-chat-composer-lead] > .pins'), 'the lead row holds the design\'s pins');
  assert.ok(doc.querySelector('[data-ask-composer-ext] .gear'), 'the gear joins the row');
  type(ctx, 'Make the hero darker');
  doc.querySelector('[data-ask-send]').click();
  await ctx.tick();
  await ctx.tick();
  const post = ctx.fetchCalls.find((c) => c.url === `/api/ask/threads/${THREAD.id}/messages`);
  assert.ok(post, 'an Ask message, not the design\'s own send');
  const body = JSON.parse(post.opts.body);
  assert.equal(body.text, 'Make the hero darker');
  assert.deepEqual(body.design, { designId: THREAD.designId, pins: [{ id: 'hero', path: 'h1', tag: 'h1', text: 'Hi', html: '' }] });
  assert.equal(sentCalls, 1, 'the pins clear once the message is in');
  ctx.panel.open({ threadId: null });
  await ctx.tick();
  ctx.flush();
  assert.deepEqual([doc.querySelector('[data-chat-composer-lead] > .pins'), doc.querySelector('[data-ask-composer-ext]').hidden], [null, true], 'a plain chat gets its composer back');
});
