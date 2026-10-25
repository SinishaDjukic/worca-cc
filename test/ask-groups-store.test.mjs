// test/ask-groups-store.test.mjs — the Chats column's topic groups (issue #948 slice 3, src/core/ask/store.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createThread, getThread, deleteThread, appendMessage, listThreadsPage, setArchived,
  createChatGroup, getChatGroup, listChatGroups, renameChatGroup, addToChatGroup, removeFromChatGroup,
  deleteChatGroup, chatGroupThreadIds, firstUserText, ChatGroupError,
} from '../src/core/ask/store.mjs';

useTempHome(after);

test('adding a grouped thread to another group moves it; the emptied group is deleted', () => {
  const a = createThread({ title: 'a' });
  const b = createThread({ title: 'b' });
  const g1 = createChatGroup({ name: 'One', threadIds: [a.id] });
  const g2 = createChatGroup({ name: 'Two', nameSource: 'suggested', threadIds: [b.id] });
  assert.match(g1.id, /^askg_[0-9a-f]{8}$/);
  assert.equal(getThread(a.id).groupId, g1.id);
  addToChatGroup(g2.id, [a.id]);
  assert.equal(getThread(a.id).groupId, g2.id);
  assert.equal(getChatGroup(g1.id), null, 'a group is never left empty');
  assert.deepEqual(chatGroupThreadIds(g2.id).sort(), [a.id, b.id].sort());
  assert.equal(listChatGroups().find((g) => g.id === g2.id).count, 2);
  assert.equal(getChatGroup(g2.id).nameSource, 'suggested');
});

test('listChatGroups: count leaves archived chats out, total keeps them', () => {
  const a = createThread({ title: 'a' });
  const b = createThread({ title: 'b' });
  const g = createChatGroup({ name: 'Mixed', threadIds: [a.id, b.id] });
  setArchived(b.id, true);
  const row = listChatGroups().find((x) => x.id === g.id);
  assert.equal(row.count, 1);
  assert.equal(row.total, 2);
});

test('creating a group with a chat that is already grouped moves that chat too', () => {
  const a = createThread({ title: 'a' });
  const g1 = createChatGroup({ name: 'One', threadIds: [a.id] });
  const g2 = createChatGroup({ name: 'Two', threadIds: [a.id] });
  assert.equal(getThread(a.id).groupId, g2.id);
  assert.equal(getChatGroup(g1.id), null);
});

test('deleting a group with deleteChats=false leaves its threads ungrouped', () => {
  const a = createThread({ title: 'a' });
  const b = createThread({ title: 'b' });
  const g = createChatGroup({ name: 'Docs', threadIds: [a.id, b.id] });
  const r = deleteChatGroup(g.id);
  assert.equal(r.deleted, true);
  assert.deepEqual(r.threadIds.sort(), [a.id, b.id].sort());
  assert.equal(getChatGroup(g.id), null);
  for (const t of [a, b]) {
    assert.ok(getThread(t.id), 'the chat stays');
    assert.equal(getThread(t.id).groupId, null);
  }
});

test('a name is 1 to 120 characters, whitespace collapsed; nameSource is suggested or user; a group needs a chat', () => {
  const a = createThread({ title: 'a' });
  const code = (fn) => { try { fn(); return null; } catch (e) { assert.ok(e instanceof ChatGroupError); return e.code; } };
  assert.equal(code(() => createChatGroup({ name: '   ', threadIds: [a.id] })), 'BAD_NAME');
  assert.equal(code(() => createChatGroup({ name: 'x'.repeat(121), threadIds: [a.id] })), 'BAD_NAME');
  assert.equal(code(() => createChatGroup({ name: 'ok', nameSource: 'model', threadIds: [a.id] })), 'BAD_NAME_SOURCE');
  assert.equal(code(() => createChatGroup({ name: 'ok', threadIds: [] })), 'NO_CHATS');
  assert.equal(code(() => createChatGroup({ name: 'ok', threadIds: ['ask_00000000'] })), 'NO_THREAD');
  assert.equal(createChatGroup({ name: '  Release   prep ', threadIds: [a.id] }).name, 'Release prep');
});

test('renameChatGroup saves the name and its source; a missing group answers null', () => {
  const a = createThread({ title: 'a' });
  const g = createChatGroup({ name: 'Mock group', nameSource: 'suggested', threadIds: [a.id] });
  const r = renameChatGroup(g.id, { name: 'Login work', nameSource: 'user' });
  assert.equal(r.name, 'Login work');
  assert.equal(r.nameSource, 'user');
  assert.equal(renameChatGroup('askg_00000000', { name: 'x' }), null);
});

test('Remove from group: the last chat out deletes the group; deleting a member chat drops an emptied group', () => {
  const a = createThread({ title: 'a' });
  const b = createThread({ title: 'b' });
  const g = createChatGroup({ name: 'Pair', threadIds: [a.id, b.id] });
  assert.deepEqual(removeFromChatGroup(a.id), { groupId: g.id, deleted: false });
  assert.equal(getThread(a.id).groupId, null);
  deleteThread(b.id);
  assert.equal(getChatGroup(g.id), null);
});

test('the search matches a group name and returns match.group; firstUserText reads the first user message only', () => {
  const a = createThread({ title: 'Fix the login' });
  appendMessage(a.id, { role: 'user', text: 'Safari loops after SSO' });
  appendMessage(a.id, { role: 'user', text: 'second message' });
  createChatGroup({ name: 'Release prep', threadIds: [a.id] });
  const page = listThreadsPage({ query: 'release', show: 'all' });
  const hit = page.threads.find((t) => t.id === a.id);
  assert.deepEqual(hit.match, { group: 'Release prep' });
  assert.equal(firstUserText(a.id), 'Safari loops after SSO');
});
