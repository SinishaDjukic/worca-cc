// test/ui-tool-run.test.mjs — the tool panel's Run tab (ui/public/tool-run.mjs): its kind (no header icon, never offered on
// the + page, a No-project chat holds it too), the frame it lends to the Chat run panel, and in the real app a run opened
// from a chat shows in that tab: Overview steps the address back to the chat, the tab picked again routes to its run,
// another run reuses the tab under its own title, and Escape closes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunKind, RUN_FROM_CHAT } from '../ui/public/tool-run.mjs';
import { TID, until, boot } from './helpers/tool-overview-boot.mjs';

test('the Run kind: no header icon, never on the + page, any chat may hold it; mount lends the frame, unmount reports the leave', () => {
  const log = [];
  const frame = { hidden: true };
  const host = { kids: [], append(el) { this.kids.push(el); } };
  const k = createRunKind({ frame: () => frame, onShown: (t) => log.push(['shown', t.id]), onLeft: (t) => log.push(['left', t.id]) });
  assert.deepEqual([k.kind, k.strip, k.onlyWhenAvailable, k.folderless], ['run', false, true, true]);
  assert.equal(k.unavailable({ side: { type: 'chat', id: TID } }), RUN_FROM_CHAT);
  assert.equal(k.title({ state: { title: 'Tax in the cart total' } }), 'Tax in the cart total');
  assert.equal(k.title({ state: {} }), 'Run');
  k.mount({ id: 't1', state: {} }, host);
  assert.deepEqual([host.kids[0], frame.hidden], [frame, false]);
  k.unmount({ id: 't1' });
  assert.deepEqual(log, [['shown', 't1'], ['left', 't1']]);
});

test('in the real app: a run opened from the chat is a Run tab; Overview steps back to the chat, the tab routes again, Escape closes it', async () => {
  const { KEY, ROW, hello } = await import('./helpers/chat-panel-boot.mjs');
  const a = await boot({ rows: [ROW] });
  hello(a, []);
  await a.settle(12);
  const tabs = () => [...a.panel().querySelectorAll('.tool-tab-item[data-kind="run"] .tool-tab-text')].map((n) => n.textContent);   // Run tabs only (the fixture holds a project Terminal too)
  const kind = () => a.panel().querySelector('.tool-body')?.dataset.kind;
  a.window.location.hash = `#chat/${TID}/run/${ROW.id}`;
  assert.ok(await until(() => kind() === 'run' && !!a.panel().querySelector('.tool-body .crp-host > :is(.rd,.hd)')), `kind ${kind()}`);
  assert.deepEqual(tabs(), [ROW.title], 'one Run tab, named for its run');
  assert.equal(a.doc.querySelector('[data-chat-page] > [data-chat-panel]:not([hidden])'), null, 'no panel of its own beside the chat');
  await a.openOverview();
  assert.ok(await until(() => a.window.location.hash === `#chat/${TID}`), a.window.location.hash);
  assert.deepEqual(tabs(), [ROW.title], 'the tab stays in the strip');
  a.panel().querySelector('.tool-tab-item[data-kind="run"] .tool-tab').click();
  assert.ok(await until(() => a.window.location.hash === `#chat/${TID}/run/${ROW.id}` && !!a.panel().querySelector('.tool-body .crp-host > :is(.rd,.hd)')), a.window.location.hash);
  const ev = new a.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  a.doc.querySelector('.tool-body [data-chat-panel]').dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, `Escape taken: ${!!a.doc.querySelector('.viewer-modal:not(.hidden), dialog[open], .guide-layer')}`);
  assert.ok(await until(() => a.window.location.hash === `#chat/${TID}` && tabs().length === 0), `${a.window.location.hash} ${tabs()}`);
  assert.ok(KEY);
});
