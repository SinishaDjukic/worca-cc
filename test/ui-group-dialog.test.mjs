// test/ui-group-dialog.test.mjs — the shared group dialog (group-dialog.mjs) with a Runs adapter: the run noun,
// Smart naming through the adapter, the name source, the whole answer to onDone, no rename needed for create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openGroupDialog } from '../ui/public/group-dialog.mjs';

const icon = (doc) => doc.createElement('i');
const settle = () => new Promise((r) => setTimeout(r, 0));
function dom() {
  const { window } = new JSDOM('<!doctype html><body><button id="o">open</button></body>', { pretendToBeVisual: true });
  return window;
}
const key = (win, target, init) => target.dispatchEvent(new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const type = (win, input, v) => { input.value = v; input.dispatchEvent(new win.Event('input', { bubbles: true })); };
const runsAdapter = (calls) => ({
  suggest: async (signal) => { calls.push(['suggest', !!signal]); return { source: 'model', name: 'Mock group' }; },
  create: async (body) => { calls.push(['create', body]); return { group: { id: 'grp_1', title: body.name }, undo: 'undo_1' }; },
});

test('runs: "2 runs", one suggestion through the adapter; untouched it saves as suggested and onDone gets the answer', async () => {
  const win = dom(); const doc = win.document; const calls = []; let got = null;
  openGroupDialog({ doc, count: 2, noun: 'run', suggestOn: true, adapter: runsAdapter(calls), icon, onDone: (g, r) => { got = [g, r]; } });
  assert.equal(doc.querySelector('.chat-group-modal .chat-group-sub').textContent, '2 runs');
  await settle();
  assert.deepEqual(calls, [['suggest', true]]);
  assert.equal(doc.getElementById('chat-group-name').value, 'Mock group');
  doc.querySelector('.chat-group-modal .btn-primary').click();
  await settle();
  assert.deepEqual(calls.at(-1), ['create', { name: 'Mock group', nameSource: 'suggested' }]);
  assert.equal(got[0].id, 'grp_1');
  assert.equal(got[1].undo, 'undo_1');
  assert.equal(doc.querySelector('.chat-group-modal'), null);
});

test('runs: a typed name saves as user; create works without a rename in the adapter', async () => {
  const win = dom(); const doc = win.document; const calls = [];
  openGroupDialog({ doc, count: 1, noun: 'run', suggestOn: false, adapter: runsAdapter(calls), icon });
  assert.equal(doc.querySelector('.chat-group-modal .chat-group-sub').textContent, '1 run');
  const input = doc.getElementById('chat-group-name');
  type(win, input, 'Hotfixes');
  key(win, input, { key: 'Enter' });
  await settle();
  assert.deepEqual(calls, [['create', { name: 'Hotfixes', nameSource: 'user' }]]);
});
