// test/ui-chat-links-app.test.mjs — chat links in the real app (issue 1064 §2–§4): app.js + index.html under jsdom. Part 2: ui-chat-links-app-panel.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PK, TID, wait, until, boot, KIND_ITEMS, KIND_CARD, clickEveryKind } from './helpers/chat-links-boot.mjs';

test('row 1: a confirmed path is a button; a click opens one Files tab of the chat at the line; again adds none', async () => {
  const a = await boot();
  assert.ok(await until(() => a.doc.querySelector('.ask-md button.ask-file-link')), 'the file link appeared');
  const b = a.doc.querySelector('.ask-md button.ask-file-link');
  assert.equal(b.textContent, 'src/a.js:12');
  b.click();
  await a.settle(12);
  assert.ok(!a.doc.querySelector('.tool-panel').hidden, 'the panel opened');
  const tabs = a.model().tabs.filter((t) => t.kind === 'files');
  assert.deepEqual(tabs.map((t) => `${t.scope.type}:${t.scope.id}`), [`chat:${TID}`]);
  assert.ok(a.rec.file.some((u) => u.includes('path=src%2Fa.js')), 'the Files tab read src/a.js');
  assert.ok(await until(() => a.doc.querySelector('.tool-panel .tool-line-mark[data-line="12"]')), 'line 12 marked');
  a.doc.querySelector('.ask-md button.ask-file-link').click();
  await a.settle(12);
  assert.equal(a.items().length, 1);
});

test('row 2 + 2b: an external site opens in a Browser tab of the chat (frame-check with the chat); a refused verdict makes the next click native; twice = one tab', async () => {
  let verdict = { framable: true };
  const a = await boot({ frame: () => verdict });
  assert.ok(await until(() => a.link('the docs')));
  let ev = a.clickLink('the docs');
  assert.equal(ev.defaultPrevented, true);
  await a.settle(12);
  assert.deepEqual([...a.doc.querySelectorAll('.tool-panel iframe.tool-browser-frame')].map((f) => f.getAttribute('src')), ['https://docs.example.org/x']);
  assert.deepEqual(a.rec.frame.map((b) => b.threadId), [TID]);
  ev = a.clickLink('the docs');
  await a.settle(12);
  assert.equal(a.items('browser').length, 1, '2b: the open tab is brought forward');
  assert.equal(a.model().tabs.filter((t) => t.kind === 'browser').length, 1);
  assert.equal(a.items('browser')[0].querySelector('.tool-tab').getAttribute('aria-selected'), 'true');
});

test('row 2 (refused): the tab says the site cannot be shown, and the next click is native', async () => {
  const a = await boot({ frame: () => ({ framable: false }) });
  assert.ok(await until(() => a.link('the docs')));
  assert.equal(a.clickLink('the docs').defaultPrevented, true);
  assert.ok(await until(() => /This site cannot be shown here/.test(a.doc.querySelector('.tool-panel')?.textContent || '')));
  assert.equal(a.clickLink('the docs').defaultPrevented, false, 'a refused origin opens natively');
});

test('rows 3, 4, 7: a refusing host, a modified click and mailto stay native and open no tab', async () => {
  const a = await boot();
  assert.ok(await until(() => a.link('repo')));
  assert.equal(a.clickLink('repo').defaultPrevented, false);
  for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { button: 1 }]) assert.equal(a.clickLink('the docs', init).defaultPrevented, false, JSON.stringify(init));
  assert.equal(a.clickLink('mail').defaultPrevented, false);
  await a.settle(8);
  assert.equal(a.items('browser').length, 0);
});

test('rows 5, 6: localhost goes through the preview; worca\'s own page routes in place; an own path stays native', async () => {
  const a = await boot();
  assert.ok(await until(() => a.link('dev')));
  assert.equal(a.clickLink('dev').defaultPrevented, true);
  await a.settle(12);
  assert.deepEqual(a.rec.minted, [5173]);
  assert.deepEqual([...a.doc.querySelectorAll('.tool-panel iframe.tool-browser-frame')].map((f) => f.getAttribute('src')), ['/preview/5173/tok/']);
  const before = a.items().length;
  assert.equal(a.clickLink('home').defaultPrevented, true);
  assert.equal(a.window.location.hash, '#runs');
  a.go(`chat/${TID}`); await a.settle(12);
  assert.ok(await until(() => a.link('pdf')));
  assert.equal(a.clickLink('pdf').defaultPrevented, false);
  assert.equal(a.window.location.hash, `#chat/${TID}`);
  assert.equal(a.items().length, before);
});

test('row 8 + 16: setting off (late answer): no file link, no resolve POST, no labels, the docs click native; on: links and labels', async () => {
  const off = await boot({ settings: () => ({ chatLinksInPanel: false }), settingsDelay: 50 });
  await wait(120); await off.settle(12);
  assert.ok(off.link('the docs'));
  assert.equal(off.doc.querySelector('.ask-md button.ask-file-link'), null);
  assert.equal(off.rec.resolve.length, 0, 'never asked');
  assert.deepEqual(['the docs', 'dev', 'repo', 'pdf', 'home', 'mail'].map((t) => off.link(t).getAttribute('aria-label')), [null, null, null, null, null, null]);
  assert.equal(off.clickLink('the docs').defaultPrevented, false);
  const on = await boot({ settings: () => ({}), settingsDelay: 50 });
  await wait(120);
  assert.ok(await until(() => on.doc.querySelector('.ask-md button.ask-file-link')), 'the file link appears once the setting lands');
  assert.deepEqual(['the docs', 'dev', 'repo', 'pdf', 'home', 'mail'].map((t) => on.link(t).getAttribute('aria-label')),
    ['the docs, opens in the panel', 'dev, opens in the panel', 'repo, opens in a new tab', 'pdf, opens in a new tab', null, null]);
});

test('row 9: narrow page: the click opens the full-screen sheet with the focus inside', async () => {
  const mm = (q) => ({ matches: /max-width:\s*879px/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const a = await boot({ innerWidth: 700, matchMedia: mm });
  assert.ok(await until(() => a.doc.querySelector('.ask-md button.ask-file-link')));
  a.doc.querySelector('.ask-md button.ask-file-link').click();
  await a.settle(12);
  const panel = a.doc.querySelector('.tool-panel');
  assert.ok(panel.classList.contains('is-sheet') && !panel.hidden);
  assert.ok(await until(() => panel.contains(a.doc.activeElement)), `focus in the panel (${a.doc.activeElement?.className})`);
});

test('row 11 + 11b: a focus frame brings the chat\'s tab forward at the new line; off screen only the model takes it and the next PUT carries it', async () => {
  const a = await boot();
  assert.ok(await until(() => a.doc.querySelector('.ask-md button.ask-file-link')));
  a.doc.querySelector('.ask-md button.ask-file-link').click();
  await a.settle(12);
  const id = a.model().tabs.find((t) => t.kind === 'files').id;
  a.dispatch({ type: 'ask-tool-tabs', threadId: 'ask_0000ffff', focus: 'tab_other001', target: { path: 'src/a.js', line: 3 } });
  await a.settle(6);
  assert.equal(a.model().tabs.find((t) => t.id === id).state.line, 12, 'another chat\'s frame changes nothing');
  const input = a.doc.querySelector('textarea.ask-input');
  input.focus();
  a.dispatch({ type: 'ask-tool-tabs', threadId: TID, focus: id, target: { path: 'src/a.js', line: 30 } });
  await a.settle(12);
  assert.equal(a.model().tabs.find((t) => t.id === id).state.line, 30);
  assert.ok(await until(() => a.doc.querySelector('.tool-panel .tool-line-mark[data-line="30"]')));
  assert.equal(a.doc.activeElement, input, 'the composer keeps the focus');
  a.go(`projects/${PK}`); await a.settle(12);
  a.rec.puts.length = 0;
  a.dispatch({ type: 'ask-tool-tabs', threadId: TID, focus: id, target: { path: 'src/a.js', line: 44 } });
  await a.settle(8);
  assert.equal(a.model().tabs.find((t) => t.id === id).state.line, 44);
  assert.notEqual(a.doc.querySelector('.tool-panel .tool-tab[aria-selected="true"]')?.closest('.tool-tab-item')?.dataset.tabId, id);
  await wait(600);
  const put = a.rec.puts.findLast((p) => p.q.includes(`threadId=${TID}`) && p.tabs.some((t) => t.id === id));   // another window's debounced PUT can land here (global fetch)
  assert.ok(put, 'a PUT for the chat');
  assert.ok(put.tabs.find((t) => t.id === id), JSON.stringify({ id, puts: a.rec.puts, model: a.model().tabs.map((t) => [t.id, t.kind, t.scope]) }));
  assert.deepEqual(put.tabs.find((t) => t.id === id).target, { path: 'src/a.js', line: 44 });
});

test('row 12: a show_files card\'s name opens the chat copy (the setting is on: a non-image goes to a Files tab)', async () => {
  const block = { kind: 'card', id: 'card_00000001', state: 'shown', card: { type: 'files', items: [{ attId: 'att_00000001', name: 'notes.txt', kind: 'text', bytes: 10, mime: 'text/plain' }] } };
  const a = await boot({ blocks: [block] });
  const pb = await until(() => a.doc.querySelector('.ask-filescard-name')) && a.doc.querySelector('.ask-filescard-name');
  assert.ok(pb, 'the file row is there');
  assert.ok(a.doc.querySelector('.ask-filescard-quick'), 'its small icon is Quick look');
  pb.click();
  await a.settle(12);
  assert.ok(await until(() => /Chat copy/.test(a.doc.querySelector('.tool-panel')?.textContent || '')), 'panel: ' + (a.doc.querySelector('.tool-panel')?.hidden) + ' ' + a.doc.querySelector('.tool-panel')?.textContent.slice(0,300) + ' tabs ' + JSON.stringify(a.model().tabs));
  assert.ok(a.rec.att.some((u) => u.includes(`/api/ask/threads/${TID}/attachments/att_00000001?as=text`)), a.calls.filter((c) => /attach|tools/.test(c.url)).map((c) => (c.opts.method||'GET') + ' ' + c.url).join(' | ') + ' body: ' + a.doc.querySelector('.tool-panel .tool-body')?.innerHTML.slice(0, 600));
});

test('row 12d: a card click before the settings read lands (setting unset) opens the Files tab, not the pop-up', async () => {
  const block = { kind: 'card', id: 'card_00000001', state: 'shown', card: { type: 'files', items: [{ attId: 'att_00000001', name: 'report.pdf', kind: 'pdf', bytes: 120, mime: 'application/pdf' }] } };
  const a = await boot({ blocks: [block], settings: () => ({}), settingsDelay: 400 });
  assert.ok(await until(() => a.doc.querySelector('.ask-filescard-name')), 'the file row is there');
  a.doc.querySelector('.ask-filescard-name').click();   // the settings read is still held
  await a.settle(12);
  const files = a.model().tabs.filter((t) => t.kind === 'files');
  assert.deepEqual(files.map((t) => [t.state.att, t.state.attKind]), [['att_00000001', 'pdf']], JSON.stringify(a.model().tabs));
  assert.equal(a.doc.querySelector('.viewer-modal.apv:not(.hidden)'), null, 'no pop-up');
  await wait(450);   // the held arm resolves inside the test
});

test('row 12b: setting unset and on: each non-image name opens its own Files tab with the card\'s kind; image and svg tiles open the pop-up', async () => {
  for (const settings of [() => ({}), () => ({ chatLinksInPanel: true })]) {
    const a = await boot({ blocks: [KIND_CARD], settings });
    assert.ok(await until(() => a.doc.querySelectorAll('.ask-filescard-name').length >= 8), 'the card is there');
    assert.deepEqual(await clickEveryKind(a), ['pdf', 'office', 'markdown', 'csv', 'json', 'diff', 'code', 'code', 'popup', 'popup'], JSON.stringify(settings()));
  }
});

test('row 12c: setting off: every kind opens the pop-up; no Files tab', async () => {
  const a = await boot({ blocks: [KIND_CARD], settings: () => ({ chatLinksInPanel: false }), settingsDelay: 50 });
  await wait(120); await a.settle(12);
  assert.ok(await until(() => a.doc.querySelectorAll('.ask-filescard-name').length >= 8), 'the card is there');
  assert.deepEqual(await clickEveryKind(a), KIND_ITEMS.map(() => 'popup'));
  assert.equal(a.model().tabs.filter((t) => t.kind === 'files').length, 0);
});
