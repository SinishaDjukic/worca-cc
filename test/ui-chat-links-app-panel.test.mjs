// test/ui-chat-links-app-panel.test.mjs — chat links in the real app, part 2 (issue 1064): the PDF tab, the settings Switch, refused origins, the side column and the tool panel per scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PK, TID, until, boot, KIND_CARD } from './helpers/chat-links-boot.mjs';

test('row 12e: the card\'s PDF Files tab renders the PDF', async () => {
  const { NO_PREVIEW } = await import('../ui/public/artifacts/stage.mjs');
  const a = await boot({ blocks: [KIND_CARD] });
  assert.ok(await until(() => a.doc.querySelector('.ask-filescard-name')));
  [...a.doc.querySelectorAll('.ask-filescard-name')].find((n) => n.textContent === 'report.pdf').click();
  await a.settle(12);
  const panel = a.doc.querySelector('.tool-panel');
  assert.ok(await until(() => panel.querySelector('embed[type="application/pdf"]')), panel.querySelector('.tool-body')?.innerHTML.slice(0, 400));
  assert.ok(panel.querySelector('embed[type="application/pdf"]').getAttribute('src').startsWith(`/api/ask/threads/${TID}/attachments/att_00000000`));
  assert.ok(!panel.textContent.includes(NO_PREVIEW), 'no NO_PREVIEW');
});

test('row 13: the settings card shows the library Switch and saves it at once', async () => {
  const a = await boot();
  a.go('settings/ask'); await a.settle(12);
  const sw = a.doc.getElementById('chatLinksInPanel');
  assert.equal(sw.getAttribute('role'), 'switch');
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.equal(a.doc.querySelector('#chat-links-card .btn-primary'), null, 'no Save: a Switch acts at once');
  sw.click();
  await a.settle(12);
  assert.ok(a.rec.settingsPosts.some((b) => b.chatLinksInPanel === false), JSON.stringify(a.rec.settingsPosts));
});

test('row 14: a refused origin in sessionStorage: the assistant\'s Browser tab shows the note, no iframe, no frame-check', async () => {
  const a = await boot({ session: { 'worca-cc.frameRefused': '["https://docs.example.org"]' },
    serverTabs: () => [{ id: 'tab_r1', kind: 'browser', url: 'https://docs.example.org/x', delivered: false }] });
  let framed = 0;   // an iframe added and removed again in one tick still counts (the cached verdict would hide it)
  new a.window.MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeName === 'IFRAME' || n.querySelector?.('iframe')) framed += 1; })
    .observe(a.doc.querySelector('.tool-panel'), { childList: true, subtree: true });
  a.doc.querySelector('.tool-icon[data-tool-kind="browser"]')?.click();
  await a.settle(12);
  const tab = a.doc.querySelector('.tool-panel .tool-tab-item[data-tab-id="tab_r1"] .tool-tab');
  assert.ok(tab, 'the assistant tab is in the strip');
  tab.click();
  await a.settle(12);
  assert.match(a.doc.querySelector('.tool-panel .tool-body').textContent, /This site cannot be shown here/);
  assert.equal(a.doc.querySelector('.tool-panel iframe'), null);
  assert.equal(a.rec.frame.length, 0);
  assert.equal(framed, 0, 'no iframe was ever made');
});

test('row 17: the hosted port gate: 5173 outside the range opens natively with a notice; once a running Action owns it, the click previews', async () => {
  let running = [];
  const a = await boot({ settings: () => ({ actionsGate: { previewPortsLocked: true }, actions: { portLow: 3000, portHigh: 3010 } }), running: () => running });
  assert.ok(await until(() => a.link('dev')?.getAttribute('aria-label') === 'dev, opens in a new tab'), `label: ${a.link('dev')?.getAttribute('aria-label')}`);
  a.doc.getElementById('toasts')?.replaceChildren();
  assert.equal(a.clickLink('dev').defaultPrevented, false);
  await a.settle(6);
  assert.match(a.doc.getElementById('toasts').textContent, /Port 5173 is not previewed here/);
  assert.equal(a.items('browser').length, 0);
  running = [{ kind: 'service', ports: { web: 5173 } }];
  a.dispatch({ type: 'actions-changed' });
  await a.settle(12);
  assert.equal(a.clickLink('dev').defaultPrevented, true);
  await a.settle(12);
  assert.deepEqual(a.rec.minted, [5173]);
});

test('row 10: in the side column on a project page, the file link opens a chat tab as the project panel\'s guest', async () => {
  const a = await boot({ url: `http://localhost:4317/#projects/${PK}` });
  a.window.__np.chat.openChat({ threadId: TID });
  await a.settle(12);
  assert.equal(a.doc.getElementById('ask-side').hidden, false);
  assert.ok(await until(() => a.doc.querySelector('#ask-side .ask-md button.ask-file-link')), 'the file link in the column');
  a.doc.querySelector('#ask-side .ask-md button.ask-file-link').click();
  await a.settle(12);
  const t = a.model().tabs.find((x) => x.kind === 'files');
  assert.deepEqual(t && t.scope, { type: 'chat', id: TID });
  assert.equal(a.window.location.hash, `#projects/${PK}`);
  assert.equal(a.items('files').length, 1, 'shown in the project page\'s strip (a guest)');
});

test('row 10b (M55): an ask-tool-tabs frame for the column\'s chat pulls that chat\'s tabs on a project page', async () => {
  const a = await boot({ url: `http://localhost:4317/#projects/${PK}` });
  a.window.__np.chat.openChat({ threadId: TID });
  await a.settle(12);
  const gets = () => a.calls.filter((c) => c.url.includes('/api/tools/tabs') && c.url.includes(`threadId=${TID}`) && (c.opts.method || 'GET') === 'GET').length;
  const before = gets();
  a.dispatch({ type: 'ask-tool-tabs', threadId: TID });
  await a.settle(8);
  assert.ok(gets() > before, 'pulled');
});

test('row 15: worca\'s own page link in the covering column routes in place and uncovers the page', async () => {
  const a = await boot({ url: `http://localhost:4317/#projects/${PK}`, innerWidth: 1000 });
  a.window.__np.chat.openChat({ threadId: TID });
  await a.settle(12);
  const side = a.doc.getElementById('ask-side');
  assert.equal(side.hidden, false);
  assert.ok(await until(() => [...side.querySelectorAll('.ask-md a')].some((x) => x.textContent === 'home')));
  const home = [...side.querySelectorAll('.ask-md a')].find((x) => x.textContent === 'home');
  const ev = new a.window.MouseEvent('click', { bubbles: true, cancelable: true });
  home.dispatchEvent(ev);
  await a.settle(6);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(a.window.location.hash, '#runs');
  assert.equal(a.doc.querySelector('main.main').hasAttribute('inert'), false, 'the page is live again');
});

test('the settings read fails: chat links still come on (the catch arm)', async () => {
  const { bootChat } = await import('./helpers/chat-panel-boot.mjs');
  void bootChat;
  const a = await boot({ settings: () => { throw new Error('offline'); } });
  assert.ok(await until(() => a.doc.querySelector('.ask-md button.ask-file-link')), 'links on after a failed read');
});

// ── the tool panel opens only for the person, per scope (real app) ────────────────────────────────────────────
test('tool panel per scope (a): a first start with the old terminal pane\'s open flag stays closed; its width carries over', async () => {
  const a = await boot({ local: { 'worca-cc.terminal.open': '1', 'worca-cc.terminal.width': '520' } });
  assert.equal(a.doc.querySelector('.tool-panel').hidden, true);
  assert.equal(a.doc.body.classList.contains('term-open'), false);
  assert.equal(a.doc.body.style.getPropertyValue('--term-w'), '520px');
});

test('tool panel per scope (b): open in a chat, a new chat starts closed; back in the chat it opens again', async () => {
  const a = await boot();
  assert.ok(await until(() => a.doc.querySelector('.ask-md button.ask-file-link')));
  a.doc.querySelector('.ask-md button.ask-file-link').click();
  await a.settle(12);
  assert.equal(a.doc.querySelector('.tool-panel').hidden, false);
  a.go('chat/new');
  await a.settle(12);
  assert.ok(await until(() => a.doc.querySelector('.tool-panel').hidden), 'a new chat starts closed');
  a.go(`chat/${TID}`);
  await a.settle(12);
  assert.ok(await until(() => !a.doc.querySelector('.tool-panel').hidden), 'the chat it was open in opens again');
  assert.deepEqual(a.model().open, [`chat:${TID}`]);
});

test('tool panel per scope (c): opened in a new chat, the first message keeps it open under the chat\'s new id', async () => {
  const { ok } = await import('./helpers/chat-panel-boot.mjs');
  const more = (u, opts) => {
    const path = u.split('?')[0];
    const m = opts.method || 'GET';
    if (path.endsWith('/api/ask/threads') && m === 'POST') {
      return ok({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: { pinned: true, projectKey: PK }, totals: {} } });
    }
    if (path.endsWith(`/api/ask/threads/${TID}/messages`) && m === 'POST') return ok({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000002' });
    return null;
  };
  const a = await boot({ url: 'http://localhost:4317/#chat/new', more });
  a.doc.dispatchEvent(new a.window.KeyboardEvent('keydown', { code: 'KeyE', key: 'E', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  await a.settle(12);
  assert.equal(a.doc.querySelector('.tool-panel').hidden, false, 'the person opened it (the + page: a new chat opens no tab yet)');
  a.doc.querySelector('textarea.ask-input').value = 'hi';
  a.doc.querySelector('[data-ask-send]').click();
  await a.settle(16);
  assert.ok(await until(() => (a.model().open || []).includes(`chat:${TID}`)), JSON.stringify(a.model().open));
  assert.equal(a.doc.querySelector('.tool-panel').hidden, false, 'still open: the same chat, now with an id');
});

test('T-R3 Quick look on a chat\'s .docx with no converter: the pop-up renders it through the simplified preview', async () => {
  const { officeVendor } = await import('./helpers/office-vendor.mjs');
  const { fixture, respond } = await import('./helpers/office-lite-fixtures.mjs');
  const { fail } = await import('./helpers/chat-panel-boot.mjs');
  const ATT = `/api/ask/threads/${TID}/attachments/att_00000001`;
  let vendor = null;
  const a = await boot({ blocks: [KIND_CARD], jsdom: { runScripts: 'outside-only', beforeParse: (w) => { vendor = officeVendor(w); } },
    hooks: { officeImport: (u) => vendor.importer(u) },
    more: (u, opts) => {
      const m = opts.method || 'GET';
      if (u === `${ATT}?as=pdf` && m === 'HEAD') return fail(501, {});
      if (u === ATT && m === 'GET') return Promise.resolve(respond(fixture('memo.docx')));
      return null;
    } });
  assert.ok(await until(() => a.doc.querySelector('[aria-label="Quick look at deck.docx"]')), 'the card is there');
  a.doc.querySelector('[aria-label="Quick look at deck.docx"]').click();
  assert.ok(await until(() => a.doc.querySelector('.apv .olp[data-office-path="docx"] .docx-wrapper'), 400), a.doc.querySelector('.apv')?.textContent.slice(0, 300));
  assert.match(a.doc.querySelector('.apv .olp-docx').textContent, /Quarterly memo/);
  assert.deepEqual(vendor.calls, ['/vendor/jszip/jszip.min.js', '/vendor/docx-preview/docx-preview.min.js']);
});
