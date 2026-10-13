// worca Chat P4: the run panel's pure pieces (ui/public/chat/run-panel.mjs) — its address, its tab keys
// and its small chrome. The panel itself (app.js) is covered by test/ui-chat-panel*.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  PANEL_HISTORY_MIN, PANEL_HISTORY_OVERLAY_BELOW, PANEL_STRINGS, panelTabFor, panelThread, panelSegments, chatPanelHash,
  chatThreadHash, buildPanelBarButtons, buildPanelShell, setPanelNotice,
} from '../ui/public/chat/run-panel.mjs';

test('the panel address is chat/<thread|new>/run/<id>[/<tab>], and closing goes back to the thread (or the Chat home)', () => {
  assert.equal(chatPanelHash('t1', 'r1'), 'chat/t1/run/r1');
  assert.equal(chatPanelHash('t1', 'r1', 'logs'), 'chat/t1/run/r1/logs');
  assert.equal(chatPanelHash('', 'fcec04e8', 'diff'), 'chat/new/run/fcec04e8/diff');
  assert.equal(chatThreadHash('t1'), 'chat/t1');
  assert.equal(chatThreadHash('new'), 'chat');
  assert.equal(chatThreadHash(''), 'chat');
});

test('a #chat param splits into its thread and its run segments', () => {
  assert.equal(panelThread(''), 'new');
  assert.equal(panelThread('t1'), 't1');
  assert.equal(panelThread('t1/run/r1/logs'), 't1');
  assert.deepEqual(panelSegments(''), []);
  assert.deepEqual(panelSegments('t1'), []);
  assert.deepEqual(panelSegments('t1/run'), []);
  assert.deepEqual(panelSegments('t1/run/r1'), ['r1']);
  assert.deepEqual(panelSegments('new/run/r1/logs'), ['r1', 'logs']);
  assert.deepEqual(panelSegments('t1/other/r1'), []);
});

test('Q&A is `qa` on the live screen and `clarify` on the saved one; other keys pass through, junk is dropped', () => {
  assert.equal(panelTabFor('live', 'clarify'), 'qa');
  assert.equal(panelTabFor('live', 'qa'), 'qa');
  assert.equal(panelTabFor('saved', 'qa'), 'clarify');
  assert.equal(panelTabFor('saved', 'clarify'), 'clarify');
  assert.equal(panelTabFor('live', 'Logs'), 'logs');
  assert.equal(panelTabFor('saved', 'workflow'), 'workflow');
  assert.equal(panelTabFor('live', ''), '');
  assert.equal(panelTabFor('live', 'x"]'), '');
});

test('the bar buttons are labelled icon buttons: Open full page, then Close', () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const wrap = buildPanelBarButtons(window.document);
  assert.equal(wrap.className, 'crp-bar-btns');
  const [full, close] = wrap.querySelectorAll('button');
  assert.equal(full.type, 'button');
  assert.ok(full.classList.contains('crp-full'));
  assert.equal(full.getAttribute('aria-label'), 'Open full page');
  assert.equal(full.title, 'Open full page');
  assert.equal(close.type, 'button');
  assert.ok(close.classList.contains('crp-close'));
  assert.equal(close.getAttribute('aria-label'), 'Close run panel');
  assert.equal(close.title, 'Close');
  assert.ok(full.querySelector('svg[aria-hidden="true"]') && close.querySelector('svg[aria-hidden="true"]'));
  window.close();
});

test('the shell has a hidden notice row (status text and Close) over the screen host, and setPanelNotice shows and clears it', () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const root = buildPanelShell(window.document);
  assert.ok(root.classList.contains('crp'));
  assert.ok(root.hasAttribute('data-crp'));
  const msg = root.querySelector(':scope > .crp-msg');
  assert.equal(msg.hidden, true);
  assert.equal(msg.querySelector('.crp-msg-text').getAttribute('role'), 'status');
  assert.ok(msg.querySelector('button.crp-close'));
  assert.ok(root.querySelector(':scope > .crp-host'));
  setPanelNotice(root, PANEL_STRINGS.loading);
  assert.equal(msg.hidden, false);
  assert.equal(msg.querySelector('.crp-msg-text').textContent, 'Loading the run…');
  setPanelNotice(root, '');
  assert.equal(msg.hidden, true);
  assert.equal(msg.querySelector('.crp-msg-text').textContent, '');
  window.close();
});

test("constants: the history column folds below 1500px; P1's overlay breakpoint is mirrored; the strings match the plan table", () => {
  assert.equal(PANEL_HISTORY_MIN, 1500);
  assert.equal(PANEL_HISTORY_OVERLAY_BELOW, 1100);
  // ask-panel.mjs does not export its breakpoint: keep the two equal.
  const ask = readFileSync(fileURLToPath(new URL('../ui/public/ask-panel.mjs', import.meta.url)), 'utf8');
  assert.match(ask, new RegExp(`const HISTORY_OVERLAY_BELOW = ${PANEL_HISTORY_OVERLAY_BELOW};`));
  assert.deepEqual({ ...PANEL_STRINGS }, {
    region: 'Run details', close: 'Close run panel', closeTip: 'Close', full: 'Open full page',
    loading: 'Loading the run…', missing: 'Could not find this run',
  });
});

test('a tab key that names an Object.prototype member is a plain key, never the prototype value', () => {
  assert.equal(panelTabFor('live', 'constructor'), 'constructor');
  assert.equal(panelTabFor('saved', 'constructor'), 'constructor');
});
