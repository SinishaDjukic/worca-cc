// test/ui-chat-group-dialog.test.mjs — the Chats column's group dialog (issue #948 slice 3, chat-group-dialog.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openChatGroupDialog } from '../ui/public/chat-group-dialog.mjs';

const CHATS = [{ id: 'ask_00000001', title: 'Fix the login' }, { id: 'ask_00000002', title: 'SSO on Safari' }];
const icon = (doc) => doc.createElement('i');
const settle = () => new Promise((r) => setTimeout(r, 0));
function dom() {
  const { window } = new JSDOM('<!doctype html><body><button id="o">open</button></body>', { pretendToBeVisual: true });
  return window;
}
const key = (win, target, init) => target.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const type = (win, input, v) => { input.value = v; input.dispatchEvent(new win.Event('input', { bubbles: true })); };

test('smartRunNaming off: a plain Name field, no chip, no suggest call; ⌘↵ creates with nameSource user', async () => {
  const win = dom(); const doc = win.document; const calls = []; let made = null;
  const api = async (m, p, b) => { calls.push([m, p, b]); return { group: { id: 'askg_00000001', name: b.name } }; };
  openChatGroupDialog({ doc, chats: CHATS, suggestOn: false, api, icon, onDone: (g) => { made = g; } });
  const input = doc.getElementById('chat-group-name');
  assert.equal(doc.activeElement, input);
  assert.equal(doc.querySelector('.chat-group-modal .sn-actions'), null);
  assert.equal(doc.querySelector('.chat-group-modal .sn-chip'), null);
  assert.equal(doc.querySelector('.chat-group-modal .chat-group-title').textContent, 'New group');
  type(win, input, 'Login work');
  key(win, input, { key: 'Enter', metaKey: true });
  await settle();
  assert.deepEqual(calls, [['POST', '/api/ask/groups', { name: 'Login work', nameSource: 'user', threadIds: ['ask_00000001', 'ask_00000002'] }]]);
  assert.equal(made.name, 'Login work');
  assert.equal(doc.querySelector('.chat-group-modal'), null);
});

test('smartRunNaming on: shimmer, then the Suggested chip; untouched it saves as suggested', async () => {
  const win = dom(); const doc = win.document; const calls = []; let release;
  const api = (m, p, b) => {
    calls.push([m, p, b]);
    if (p === '/api/ask/groups/suggest-name') return new Promise((r) => { release = r; });
    return Promise.resolve({ group: { id: 'askg_00000001', name: b.name } });
  };
  openChatGroupDialog({ doc, chats: CHATS, suggestOn: true, api, icon });
  assert.ok(doc.querySelector('.chat-group-modal .sn-adorn.sn-loading'));
  assert.deepEqual(calls[0], ['POST', '/api/ask/groups/suggest-name', { threadIds: ['ask_00000001', 'ask_00000002'] }]);
  release({ source: 'model', name: 'Login and SSO' });
  await settle();
  assert.equal(doc.getElementById('chat-group-name').value, 'Login and SSO');
  assert.equal(doc.querySelector('.chat-group-modal .sn-chip').textContent, 'Suggested');
  doc.querySelector('.chat-group-modal .btn-primary').click();
  await settle();
  assert.equal(calls.at(-1)[2].nameSource, 'suggested');
});

test('typing replaces the suggestion and the name saves as user; ⌥R suggests again', async () => {
  const win = dom(); const doc = win.document; const calls = [];
  const api = async (m, p, b) => { calls.push([m, p, b]); return p.endsWith('suggest-name') ? { source: 'model', name: 'Login and SSO' } : { group: { id: 'askg_00000001', name: b.name } }; };
  openChatGroupDialog({ doc, chats: CHATS, suggestOn: true, api, icon });
  await settle();
  const input = doc.getElementById('chat-group-name');
  type(win, input, 'My name');
  assert.equal(doc.querySelector('.chat-group-modal .sn-chip'), null);
  key(win, input, { key: '®', code: 'KeyR', altKey: true });
  await settle();
  assert.equal(calls.filter((c) => c[1].endsWith('suggest-name')).length, 2);
  type(win, input, 'Mine again');
  key(win, input, { key: 'Enter', ctrlKey: true });
  await settle();
  assert.deepEqual(calls.at(-1), ['POST', '/api/ask/groups', { name: 'Mine again', nameSource: 'user', threadIds: ['ask_00000001', 'ask_00000002'] }]);
});

test('a failed suggestion leaves the field empty; an empty name is refused; Esc closes and refocuses the opener', async () => {
  const win = dom(); const doc = win.document; const opener = doc.getElementById('o'); const calls = [];
  opener.focus();
  const api = async (m, p, b) => { calls.push([m, p, b]); return { source: 'fallback', error: 'x' }; };
  openChatGroupDialog({ doc, chats: CHATS, suggestOn: true, api, icon, opener });
  await settle();
  assert.equal(doc.getElementById('chat-group-name').value, '');
  assert.equal(doc.querySelector('.chat-group-modal .sn-chip'), null);
  doc.querySelector('.chat-group-modal .btn-primary').click();
  await settle();
  assert.equal(doc.querySelector('.chat-group-err').textContent, 'Name the group.');
  assert.equal(calls.length, 1, 'no save without a name');
  key(win, doc.getElementById('chat-group-name'), { key: 'Escape' });
  assert.equal(doc.querySelector('.chat-group-modal'), null);
  assert.equal(doc.activeElement, opener);
});

test('Rename: the current name in the field, no suggestion on open; Rename sends PATCH', async () => {
  const win = dom(); const doc = win.document; const calls = [];
  const api = async (m, p, b) => { calls.push([m, p, b]); return { group: { id: 'askg_00000001', name: b.name } }; };
  openChatGroupDialog({ doc, mode: 'rename', group: { id: 'askg_00000001', name: 'Release prep', nameSource: 'user' }, chats: CHATS, suggestOn: true, api, icon });
  assert.equal(doc.getElementById('chat-group-name').value, 'Release prep');
  assert.equal(calls.length, 0);
  type(win, doc.getElementById('chat-group-name'), 'Release');
  doc.querySelector('.chat-group-modal .btn-primary').click();
  await settle();
  assert.deepEqual(calls, [['PATCH', '/api/ask/groups/askg_00000001', { name: 'Release', nameSource: 'user' }]]);
});

test('the hint is a polite live region; Tab from the primary button wraps to the field', () => {
  const win = dom(); const doc = win.document;
  openChatGroupDialog({ doc, chats: CHATS, suggestOn: false, api: async () => ({}), icon });
  assert.equal(doc.querySelector('.chat-group-hint').getAttribute('aria-live'), 'polite');
  const ok = doc.querySelector('.chat-group-modal .btn-primary');
  ok.focus();
  key(win, ok, { key: 'Tab' });
  assert.equal(doc.activeElement, doc.getElementById('chat-group-name'));
  key(win, doc.activeElement, { key: 'Tab', shiftKey: true });
  assert.equal(doc.activeElement, ok);
});
