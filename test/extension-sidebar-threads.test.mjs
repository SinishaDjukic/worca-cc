// test/extension-sidebar-threads.test.mjs — the sidebar's thread list: a new thread appears and is selected, titles
// repaint, "New chat" is always a real change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { upsertThread, retitleThread, dropThread, threadOptions, THREAD_LIST_MAX } from '../extension/src/sidebar/sidebar-view.mjs';

test('upsertThread caps the list at THREAD_LIST_MAX, newest first (v6)', () => {
  let list = [];
  for (let i = 0; i < THREAD_LIST_MAX + 5; i++) list = upsertThread(list, { id: `t_${i}` });
  assert.equal(list.length, THREAD_LIST_MAX);
  assert.equal(list[0].id, `t_${THREAD_LIST_MAX + 4}`);
});

const A = { id: 'askt_a', title: 'Older chat', updatedAt: '1' };

test('a thread created by the first send is prepended and selected', () => {
  const list = upsertThread([A], { id: 'askt_new', title: null, updatedAt: '2' });
  assert.deepEqual(list.map((t) => t.id), ['askt_new', 'askt_a']);
  const opts = threadOptions(list, 'askt_new');
  assert.deepEqual(opts.map((o) => [o.value, o.label, o.selected]), [['', 'New chat', false], ['askt_new', 'Untitled chat', true], ['askt_a', 'Older chat', false]]);
});

test('upsert of a known thread updates it in place (a snapshot load)', () => {
  const list = upsertThread([{ id: 'askt_new', title: null }, A], { id: 'askt_a', title: 'Renamed', updatedAt: '3' });
  assert.deepEqual(list.map((t) => [t.id, t.title]), [['askt_new', null], ['askt_a', 'Renamed']]);
});

test('ask-title retitles the matching entry; an unknown id changes nothing', () => {
  const list = [{ id: 'askt_new', title: null }, A];
  assert.equal(retitleThread(list, 'askt_new', 'Rate limits on the ACME API')[0].title, 'Rate limits on the ACME API');
  assert.equal(retitleThread(list, 'askt_zzz', 'x'), list);
});

test('the open thread is always an option, so "New chat" is a real change; no thread → "New chat" selected', () => {
  assert.deepEqual(threadOptions([], 'askt_x').map((o) => [o.value, o.selected]), [['', false], ['askt_x', true]]);
  assert.deepEqual(threadOptions([A], null).map((o) => [o.value, o.selected]), [['', true], ['askt_a', false]]);
  assert.deepEqual(dropThread([A], 'askt_a'), []);
});

test('rendered into a <select>, choosing "New chat" after a send fires change', () => {
  const { document, Event } = new JSDOM('<!doctype html><body><select></select></body>').window;
  const sel = document.querySelector('select');
  const paint = (list, open) => sel.replaceChildren(...threadOptions(list, open).map((o) => { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; op.selected = o.selected; return op; }));
  paint(upsertThread([], { id: 'askt_new' }), 'askt_new');
  assert.equal(sel.value, 'askt_new');
  let changed = null;
  sel.addEventListener('change', () => { changed = sel.value; });
  sel.value = ''; sel.dispatchEvent(new Event('change'));
  assert.equal(changed, '');
});
