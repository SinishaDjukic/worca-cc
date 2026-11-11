// test/ui-design-engine-gate.test.mjs — Design P8 Task 2 (L8.1, L8.3, L8.25): the Library's start box meets the engine
// gate. A 409 `engine-gated` or `engine-refused` from POST /api/design opens one consent dialog and keeps Send busy until
// it closes; Allow unguarded re-posts the engine the dialog named, Use Claude re-posts `engine: 'claude'`, Cancel keeps
// the text. Plain DOM in jsdom with a fake fetch (a queue of POST replies) and a fake clock; nothing reaches a server.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { fakeClock } from './helpers/design-clock.mjs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { createLibrary, takeStart } from '../ui/public/design/library.mjs';
import { openEngineGateDialog } from '../ui/public/design/engine-gate-dialog.mjs';

const trackDom = useDomRelease(afterEach);
const made = [];
afterEach(() => { while (made.length) made.pop().destroy(); });

const flush = () => new Promise((resolve) => setImmediate(resolve));

function reply(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text), text: async () => text };
}

const CODEX_SHELL = 'Codex cannot be kept from running shell commands.';
const GOOSE = 'Goose cannot be held to one folder or kept from running commands, so Design does not run on it.';
const gated = (o = {}) => [409, { error: CODEX_SHELL, code: 'engine-gated', overridable: true, engine: 'codex', label: 'Codex', reasons: [CODEX_SHELL], notes: [], ...o }];
const refused = (o = {}) => [409, { error: GOOSE, code: 'engine-refused', overridable: false, engine: 'goose', label: 'Goose', reasons: [GOOSE], notes: [], ...o }];
const created = (id) => [201, { design: { id }, threadId: null }];

// rig(replies) -> {lib, host, doc, win, tick, posts, navs, setText, keydown, dialog, buttons, press}. `replies` is the queue
// of [status, body] answers to POST /api/design, one per post (a post past the end answers 500); `posts` records each
// post's body and `navs` each navigate(). GET /api/design lists nothing and GET /api/projects has none.
function rig(replies) {
  const clock = fakeClock();
  const dom = trackDom(new JSDOM(`<!doctype html><html><body>
    <main class="main"><section class="view" data-view="design"><div id="design-host"></div></section></main>
  </body></html>`, { url: 'http://localhost/' }));
  const win = dom.window;
  const doc = win.document;
  Object.assign(win, { setTimeout: clock.set, clearTimeout: clock.clear });
  const host = doc.getElementById('design-host');
  const queue = [...replies];
  const posts = [];
  const navs = [];
  async function fetch(url, init = {}) {
    const method = String(init.method ?? 'GET').toUpperCase();
    if (method === 'POST' && url === '/api/design') {
      posts.push(JSON.parse(init.body ?? '{}'));
      const next = queue.shift();
      return next ? reply(...next) : reply(500, { error: 'no reply queued' });
    }
    if (url === '/api/design') return reply(200, []);
    if (url === '/api/projects') return reply(200, { projects: [] });
    return reply(404, { error: 'not found' });
  }
  const lib = createLibrary({ doc, win, host, fetch, navigate: (hash) => { navs.push(hash); }, now: () => Date.UTC(2026, 10, 9) });
  made.push(lib);
  const input = () => host.querySelector('textarea.dz-input');
  const setText = (text) => {
    input().value = text;
    input().dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const keydown = (target, key) => {
    target.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const dialog = () => doc.querySelector('.viewer-modal');
  const buttons = () => [...(dialog()?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
  const press = async (name) => {
    const b = [...dialog().querySelectorAll('button')].find((x) => x.textContent === name);
    assert.ok(b, `the dialog has ${name}`);
    b.click();
    for (let i = 0; i < 4; i += 1) await flush();
  };
  const tick = async () => { clock.tick(250); for (let i = 0; i < 4; i += 1) await flush(); };
  return { lib, host, doc, win, tick, posts, navs, setText, keydown, input, dialog, buttons, press };
}

const FIRST = { kind: 'web', fast: true, title: 'A landing page' };

test('gated: one dialog names the engine and its reasons; Allow unguarded re-posts that engine with the consent, then opens the design', async () => {
  const r = rig([gated(), created('d_000000000009')]);
  await r.lib.open(); await r.tick();
  r.setText('A landing page');
  r.host.querySelector('.ask-send').click(); await r.tick();
  assert.deepEqual(r.posts, [FIRST]);
  assert.equal(r.doc.querySelectorAll('.viewer-modal').length, 1);
  assert.equal(r.dialog().querySelector('h2').textContent, 'Build on Codex?');
  assert.equal(r.dialog().getAttribute('role'), 'dialog');
  assert.equal(r.dialog().getAttribute('aria-labelledby'), r.dialog().querySelector('h2').id);
  assert.ok(r.dialog().textContent.includes(CODEX_SHELL), 'the reason is in the dialog');
  assert.deepEqual(r.buttons(), ['Cancel', 'Use Claude', 'Allow unguarded']);
  assert.equal(r.host.querySelector('.dz-start-err').hidden, true, 'a gate is not a refusal under the box');
  assert.equal(r.host.querySelector('.ask-send').disabled, true, 'Send stays busy while the dialog is open');
  await r.press('Allow unguarded');
  assert.deepEqual(r.posts[1], { ...FIRST, allowUnguarded: true, engine: 'codex' }, 'the engine the dialog named, never a re-resolve');
  assert.equal(r.dialog(), null);
  assert.deepEqual(r.navs, ['#design/d_000000000009']);
  assert.deepEqual(takeStart('d_000000000009'), { text: 'A landing page', files: [] });
  assert.equal(r.input().value, '', 'the composer resets on the 201');
});

test('refused: the title says it cannot build, no Allow unguarded; Use Claude re-posts engine claude; a refused claude offers neither', async () => {
  const r = rig([refused(), created('d_00000000000a')]);
  await r.lib.open(); await r.tick();
  r.setText('A landing page');
  r.host.querySelector('.ask-send').click(); await r.tick();
  assert.equal(r.dialog().querySelector('h2').textContent, 'Goose cannot build designs');
  assert.ok(r.dialog().textContent.includes(GOOSE));
  assert.deepEqual(r.buttons(), ['Cancel', 'Use Claude']);
  await r.press('Use Claude');
  assert.deepEqual(r.posts, [FIRST, { ...FIRST, engine: 'claude' }]);
  assert.equal(r.dialog(), null);
  assert.deepEqual(r.navs, ['#design/d_00000000000a']);

  const c = rig([refused({ engine: 'claude', label: 'Claude', error: 'no key', reasons: ['no key'] })]);
  await c.lib.open(); await c.tick();
  c.setText('A deck');
  c.host.querySelector('.ask-send').click(); await c.tick();
  assert.equal(c.dialog().querySelector('h2').textContent, 'Claude cannot build designs');
  assert.deepEqual(c.buttons(), ['Cancel']);
});

test('cancel, a second refusal, no second send: Enter posts nothing while the dialog is open; Cancel keeps the text; a 409 after Allow is written under the box', async () => {
  const note = 'Gemini CLI cannot read the picked project.';
  const r = rig([gated({ notes: [note] }), gated(), [409, { error: 'the credential broker is on', code: 'engine-refused', overridable: false, engine: 'codex', label: 'Codex', reasons: ['the credential broker is on'], notes: [] }]]);
  await r.lib.open(); await r.tick();
  r.setText('A landing page');
  r.keydown(r.input(), 'Enter'); await r.tick();
  assert.equal(r.posts.length, 1);
  assert.ok(r.dialog().textContent.includes(note), 'a note is a plain line too');
  r.keydown(r.input(), 'Enter'); r.host.querySelector('.ask-send').click(); await r.tick();
  assert.equal(r.posts.length, 1, 'no second send while the dialog is open');
  assert.equal(r.doc.querySelectorAll('.viewer-modal').length, 1, 'one dialog');
  await r.press('Cancel');
  assert.equal(r.dialog(), null);
  assert.equal(r.input().value, 'A landing page');
  assert.equal(r.host.querySelector('.ask-send').disabled, false, 'Send is ready again');
  assert.equal(r.host.querySelector('.dz-start-err').hidden, true);
  assert.deepEqual(r.navs, []);

  r.host.querySelector('.ask-send').click(); await r.tick();
  assert.equal(r.posts.length, 2);
  await r.press('Allow unguarded');
  assert.equal(r.posts.length, 3);
  assert.equal(r.dialog(), null, 'a second refusal opens no second dialog');
  const err = r.host.querySelector('.dz-start-err');
  assert.deepEqual([err.hidden, err.textContent], [false, 'the credential broker is on']);
  assert.equal(r.input().value, 'A landing page');
  assert.equal(r.host.querySelector('.ask-send').disabled, false);
  assert.deepEqual(r.navs, []);
});

test('Escape is the dialog\'s Cancel; a 409 that is not the gate, or the gate\'s code on another status, stays a line under the box; leaving the Library takes an open dialog with it', async () => {
  const r = rig([
    gated(),
    [409, { error: 'That design is busy.', code: 'conflict', engine: 'codex' }],
    [400, { error: 'nope is not an engine worca knows.', code: 'engine-refused', engine: 'nope' }],
    gated(),
  ]);
  await r.lib.open(); await r.tick();
  r.setText('A landing page');
  r.host.querySelector('.ask-send').click(); await r.tick();
  r.keydown(r.dialog(), 'Escape'); await r.tick();
  assert.equal(r.dialog(), null);
  assert.equal(r.host.querySelector('.ask-send').disabled, false);

  r.host.querySelector('.ask-send').click(); await r.tick();
  assert.equal(r.dialog(), null, 'only engine-gated and engine-refused open the dialog');
  assert.equal(r.host.querySelector('.dz-start-err').textContent, 'That design is busy.');

  r.host.querySelector('.ask-send').click(); await r.tick();
  assert.equal(r.dialog(), null, 'only a 409 opens the dialog');
  assert.equal(r.host.querySelector('.dz-start-err').textContent, 'nope is not an engine worca knows.');

  r.host.querySelector('.ask-send').click(); await r.tick();
  assert.ok(r.dialog());
  made.pop().destroy();
  assert.equal(r.doc.querySelector('.viewer-modal'), null, 'no dialog left on document.body');
  r.keydown(r.doc.body, 'Escape');
  assert.equal(r.posts.length, 4);
});

test('the dialog alone: titles, buttons and their order, plain lines, Cancel focused, close() is silent and idempotent', async () => {
  const dom = trackDom(new JSDOM('<!doctype html><html><body><button id="opener">x</button></body></html>', { url: 'http://localhost/' }));
  const doc = dom.window.document;
  doc.getElementById('opener').focus();
  const calls = [];
  const d = openEngineGateDialog({
    doc, label: 'Gemini CLI', overridable: true,
    reasons: ['Gemini CLI runs with its shell and web tools off here, but cannot be limited to the tools Design allows.'],
    notes: ['Gemini CLI cannot read the picked project.'],
    onAllow: () => calls.push('allow'), onClaude: () => calls.push('claude'), onCancel: () => calls.push('cancel'),
  });
  const modal = doc.querySelector('.viewer-modal');
  assert.equal(modal.querySelector('h2').textContent, 'Build on Gemini CLI?');
  assert.deepEqual([...modal.querySelectorAll('.dlg-body p')].map((p) => p.textContent), [
    'Gemini CLI runs with its shell and web tools off here, but cannot be limited to the tools Design allows.',
    'Gemini CLI cannot read the picked project.',
  ]);
  assert.deepEqual([...modal.querySelectorAll('.dlg-foot button')].map((b) => [b.textContent, b.className, b.type]),
    [['Cancel', 'btn', 'button'], ['Use Claude', 'btn', 'button'], ['Allow unguarded', 'btn btn-primary', 'button']]);
  assert.equal(doc.activeElement.textContent, 'Cancel', 'the safe choice has the focus, so a stray Enter never consents');
  assert.equal(modal.innerHTML.includes('style='), false, 'no inline style: no wash, no edge line');
  d.close();
  d.close();
  assert.equal(doc.querySelector('.viewer-modal'), null);
  assert.deepEqual(calls, [], 'close() calls no handler');
  assert.equal(doc.activeElement.id, 'opener', 'the focus goes back');

  const r = openEngineGateDialog({ doc, label: 'Goose', overridable: false, reasons: [GOOSE], notes: [], onAllow: () => calls.push('allow') });
  assert.equal(doc.querySelector('.viewer-modal h2').textContent, 'Goose cannot build designs');
  assert.deepEqual([...doc.querySelectorAll('.viewer-modal button')].map((b) => b.textContent), ['Cancel'], 'no onClaude, no Use Claude; not overridable, no Allow');
  doc.querySelector('.viewer-modal button').click();
  assert.deepEqual(calls, [], 'no onCancel given: Cancel only closes');
  assert.equal(doc.querySelector('.viewer-modal'), null);
  r.close();
});

test('on a phone the three buttons wrap inside the card: `.confirm-actions` does not wrap by itself (measured at 390 px in Chrome)', () => {
  const rules = cssRules(readStyleCss()).filter((r) => r.sel === '.dz-gate-modal .confirm-actions' && !r.media);
  assert.equal(rules.length, 1);
  assert.match(rules[0].body, /(^|;)\s*flex-wrap:\s*wrap\s*(;|$)/);
});
