import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home; let C; let store;
before(async () => {
  home = mkdtempSync(join(tmpdir(), 'worca-chatconv-'));
  process.env.WORCA_HOME = home;
  store = await import('../src/core/ask/store.mjs');
  C = await import('../src/core/chat/conversations.mjs');
});
after(() => { rmSync(home, { recursive: true, force: true }); });

const bind = (over = {}) => {
  const t = store.createThread({ createdBy: 'ada@example.com' });
  return C.createConversation({ plugin: 'discord-chat', channelId: 'main', platform: 'discord', guildId: 'G1',
    parentChatId: 'C1', chatId: `T-${t.id}`, ownerUserId: 'U1', worcaIdentity: 'ada@example.com', askThreadId: t.id, ...over });
};

test('binding: find by platform thread, by Ask thread; unique per platform thread', () => {
  const c = bind();
  assert.equal(C.findConversation({ plugin: 'discord-chat', channelId: 'main', chatId: c.chatId }).id, c.id);
  assert.equal(C.conversationForThread(c.askThreadId).id, c.id);
  assert.throws(() => C.createConversation({ ...c, askThreadId: c.askThreadId }), /UNIQUE/);
  assert.equal(C.conversationForThread('ask_ffffffff'), null);
});

test('controls: single-use claim is exclusive; release re-arms; reusable header controls never spend', () => {
  const c = bind();
  const ref = C.issueControl({ conversationId: c.id, cardId: 'card_00000001', action: 'start', issuedState: 'proposed', ownerUserId: 'U1' });
  assert.match(ref, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(C.claimControl(ref), true);
  assert.equal(C.claimControl(ref), false, 'a replayed click cannot claim twice');
  C.releaseControl(ref);
  assert.equal(C.claimControl(ref), true, 'a refused apply gives it back');
  const h = C.issueControl({ conversationId: c.id, action: 'header:stop', ownerUserId: 'U1', singleUse: false });
  assert.equal(C.claimControl(h), true);
  assert.equal(C.claimControl(h), true);
  C.retireCardControls(c.id, 'card_00000001');
  assert.equal(C.claimControl(ref), false);
});

test('rebind spends card controls, keeps header controls', () => {
  const c = bind();
  const card = C.issueControl({ conversationId: c.id, cardId: 'card_00000002', action: 'dismiss', ownerUserId: 'U1' });
  const head = C.issueControl({ conversationId: c.id, action: 'header:new', ownerUserId: 'U1', singleUse: false });
  const t2 = store.createThread({ createdBy: 'ada@example.com' });
  assert.equal(C.rebindConversation(c.id, { askThreadId: t2.id }).askThreadId, t2.id);
  assert.equal(C.claimControl(card), false);
  assert.equal(C.claimControl(head), true);
});

test('deliveries upsert per part; dedup marks first sighting only and prunes old rows', () => {
  const c = bind();
  C.recordDelivery({ conversationId: c.id, askMessageId: 'askm_00000001', part: 'text:0', platformMessageId: 'M1' });
  C.recordDelivery({ conversationId: c.id, askMessageId: 'askm_00000001', part: 'card:card_1', platformMessageId: 'M2', shownState: 'proposed' });
  C.recordDelivery({ conversationId: c.id, askMessageId: 'askm_00000001', part: 'card:card_1', platformMessageId: 'M2', shownState: 'started' });
  const parts = C.deliveredParts(c.id, 'askm_00000001').sort((a, b) => a.part.localeCompare(b.part));
  assert.deepEqual(parts.map((p) => [p.part, p.shownState]), [['card:card_1', 'started'], ['text:0', null]]);
  const now = Date.now();
  assert.equal(C.markSeen({ plugin: 'p', channelId: 'main', eventId: 'e1' }, { now }), true);
  assert.equal(C.markSeen({ plugin: 'p', channelId: 'main', eventId: 'e1' }, { now }), false);
  assert.equal(C.markSeen({ plugin: 'p', channelId: 'main', eventId: 'e1' }, { now: now + C.SEEN_TTL_MS + 1000 }), true, 'pruned then new');
  assert.equal(C.markSeen({ plugin: 'p', channelId: 'main', eventId: '' }), true, 'no id is never dropped');
});

test('prune: expired and long-used controls go, live ones stay', () => {
  const c = bind();
  const now = Date.now();
  const live = C.issueControl({ conversationId: c.id, cardId: 'card_00000009', action: 'start', issuedState: 'proposed', ownerUserId: 'U1' }, { now });
  const expired = C.issueControl({ conversationId: c.id, cardId: 'card_00000009', action: 'dismiss', ownerUserId: 'U1', ttlMs: 1000 }, { now: now - 5000 });
  const used = C.issueControl({ conversationId: c.id, cardId: 'card_00000009', action: 'choice', ownerUserId: 'U1' }, { now });
  assert.equal(C.claimControl(used, { now: now - C.USED_CONTROL_KEEP_MS - 1000 }), true);
  C.pruneChatRows({ now });
  assert.ok(C.getControl(live));
  assert.equal(C.getControl(expired), null);
  assert.equal(C.getControl(used), null);
});

test('the boot sweep keeps an empty thread that a conversation is bound to (review m4)', () => {
  const bound = bind();
  const loose = store.createThread({ createdBy: 'ada@example.com' });
  const later = Date.now() + 2 * 24 * 60 * 60 * 1000;
  store.sweepEmptyThreads({ now: later });
  assert.ok(store.getThread(bound.askThreadId), 'bound + empty: kept');
  assert.ok(C.getConversation(bound.id), 'binding kept');
  assert.equal(store.getThread(loose.id), null, 'unbound + empty: swept as before');
});

test('deleting the Ask thread removes the binding (FK cascade)', () => {
  const c = bind();
  store.deleteThread(c.askThreadId);
  assert.equal(C.getConversation(c.id), null);
});
