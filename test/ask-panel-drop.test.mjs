// test/ask-panel-drop.test.mjs — drag-and-drop onto the sheet and file paste
// into the composer both feed the same addFiles() the "+" button uses. jsdom
// has no DataTransfer: a plain object carrying `types`/`files` is pinned onto
// the event with defineProperty, the way the composer suite injects input.files.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { checkRows } from './helpers/rows.mjs';

const mkFile = (ctx, name, content, type = 'text/plain') => new ctx.window.File([content], name, { type });

function fire(ctx, target, type, data) {
  const ev = new ctx.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: data, configurable: true });
  target.dispatchEvent(ev);
  return ev;
}

function paste(ctx, target, data) {
  const ev = new ctx.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: data, configurable: true });
  target.dispatchEvent(ev);
  return ev;
}

const fileDrag = (files) => ({ types: ['Files'], files });
const sheetOf = (ctx) => ctx.doc.querySelector('.chat-convo');
test('ask-panel-drop: a file drop on the sheet attaches chips through the "+" validation and cancels the browser default', async () => {
  await checkRows([
    { name: 'ask-panel-drop: a file drop on the sheet attaches chips and cancels the browser default', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const sheet = sheetOf(ctx);
      const data = fileDrag([mkFile(ctx, 'a.md', 'one'), mkFile(ctx, 'b.txt', 'two')]);
      assert.equal(fire(ctx, sheet, 'dragenter', data).defaultPrevented, true);
      assert.equal(fire(ctx, sheet, 'dragover', data).defaultPrevented, true, 'dragover must be cancelled or drop never fires');
      // dropped on a child: the whole sheet is the target
      const drop = fire(ctx, ctx.doc.querySelector('.ask-transcript'), 'drop', data);
      assert.equal(drop.defaultPrevented, true, 'the browser must not open the file in the tab');
      await ctx.tick(); await ctx.tick();
      assert.deepEqual([...ctx.doc.querySelectorAll('.ask-chip-name')].map((n) => n.textContent), ['a.md', 'b.txt']);
    } },
    { name: 'ask-panel-drop: a dropped file runs through the same validation as the "+" button', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const data = fileDrag([mkFile(ctx, 'evil.exe', 'x')]);
      fire(ctx, sheetOf(ctx), 'dragenter', data);
      fire(ctx, sheetOf(ctx), 'drop', data);
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-chip'), null);
      assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment type not allowed: evil\.exe/);
    } },
  ]);
});

test('ask-panel-drop: pasted files attach (default cancelled); generic image.png pastes get unique names; a nameless unknown binary is rejected, a nameless text/* attaches as .txt', async () => {
  await checkRows([
    { name: 'ask-panel-drop: a paste with files attaches them and cancels the default', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const input = ctx.doc.querySelector('textarea.ask-input');
      const ev = paste(ctx, input, { types: ['Files'], files: [mkFile(ctx, 'notes.md', 'hello')], getData: () => '' });
      assert.equal(ev.defaultPrevented, true);
      await ctx.tick(); await ctx.tick();
      assert.match(ctx.doc.querySelector('.ask-chip').textContent, /notes\.md/);
      assert.equal(input.value, '', 'nothing is typed into the draft');
    } },
    { name: 'ask-panel-drop: repeated generic "image.png" pastes get unique names, so the dedupe does not replace them', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const input = ctx.doc.querySelector('textarea.ask-input');
      const png = () => mkFile(ctx, 'image.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
      paste(ctx, input, { types: ['Files'], files: [png()] });
      await ctx.tick(); await ctx.tick();
      paste(ctx, input, { types: ['Files'], files: [png()] });
      await ctx.tick(); await ctx.tick();
      const names = [...ctx.doc.querySelectorAll('.ask-chip-name')].map((n) => n.textContent);
      assert.equal(names.length, 2, 'both screenshots stay attached');
      assert.notEqual(names[0], names[1]);
      for (const n of names) assert.match(n, /^pasted-.+\.png$/);
    } },
    { name: 'ask-panel-drop: a nameless pasted file of an unknown binary type is rejected, not attached as text', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const input = ctx.doc.querySelector('textarea.ask-input');
      const tiff = mkFile(ctx, '', new Uint8Array([0x49, 0x49, 0x2a, 0x00]), 'image/tiff');
      paste(ctx, input, { types: ['Files'], files: [tiff], getData: () => '' });
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-chip'), null);
      assert.match(ctx.doc.querySelector('.ask-composer-msg').textContent, /attachment type not allowed: pasted-\d+$/);
    } },
    { name: 'ask-panel-drop: a nameless pasted text/* file still attaches as .txt', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const input = ctx.doc.querySelector('textarea.ask-input');
      paste(ctx, input, { types: ['Files'], files: [mkFile(ctx, '', 'hello', 'text/plain')], getData: () => '' });
      await ctx.tick(); await ctx.tick();
      assert.match(ctx.doc.querySelector('.ask-chip-name').textContent, /^pasted-\d+\.txt$/);
    } },
  ]);
});

test('ask-panel-drop: mixed pastes — image+text lets the text through, text+non-image attaches the file, plain text is untouched', async () => {
  await checkRows([
    { name: 'ask-panel-drop: an image+text paste (Excel/Word copy) lets the text through and attaches nothing', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const input = ctx.doc.querySelector('textarea.ask-input');
      const png = mkFile(ctx, 'image.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
      const ev = paste(ctx, input, {
        types: ['text/plain', 'Files'], files: [png], getData: (t) => (t === 'text/plain' ? 'A1\tB1' : ''),
      });
      assert.equal(ev.defaultPrevented, false, 'the native text paste goes ahead');
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-chip'), null);
    } },
    { name: 'ask-panel-drop: text plus a non-image file still attaches the file', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const input = ctx.doc.querySelector('textarea.ask-input');
      const ev = paste(ctx, input, {
        types: ['text/plain', 'Files'], files: [mkFile(ctx, 'notes.md', 'hi')], getData: () => 'notes.md',
      });
      assert.equal(ev.defaultPrevented, true);
      await ctx.tick(); await ctx.tick();
      assert.match(ctx.doc.querySelector('.ask-chip').textContent, /notes\.md/);
    } },
    { name: 'ask-panel-drop: a plain-text paste is untouched', run: async () => {
      const ctx = makePanel();
      ctx.panel.open();
      const input = ctx.doc.querySelector('textarea.ask-input');
      const ev = paste(ctx, input, { types: ['text/plain'], files: [], getData: () => 'hello' });
      assert.equal(ev.defaultPrevented, false, 'the native text paste goes ahead');
      await ctx.tick(); await ctx.tick();
      assert.equal(ctx.doc.querySelector('.ask-chip'), null);
      assert.equal(ctx.doc.querySelector('.ask-composer-msg').hidden, true, 'no error either');
    } },
  ]);
});
