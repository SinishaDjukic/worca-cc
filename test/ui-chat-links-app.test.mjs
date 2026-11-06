// test/ui-chat-links-app.test.mjs — chat links in the real app (issue 1064 §2–§4): app.js + index.html under jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PK = 'app-0000aaaa';
const TID = 'ask_0000c11c';
const realMarkdown = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });
const ANSWER = 'See src/a.js:12, [the docs](https://docs.example.org/x), [repo](https://github.com/a/b), [dev](http://localhost:5173/), [home](http://localhost:4317/#runs), [pdf](http://localhost:4317/api/x/file.pdf) and [mail](mailto:a@b.c).';
const TEXT40 = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 200) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(5); } return false; };

async function boot({ url = `http://localhost:4317/#chat/${TID}`, settings = () => ({}), settingsDelay = 0, frame = () => ({ framable: null }),
  serverTabs = () => [], blocks = [], running = () => [], session = null, innerWidth = null, matchMedia = null, local = null, more = null } = {}) {
  const { bootChat, ok } = await import('./helpers/chat-panel-boot.mjs');
  const rec = { resolve: [], frame: [], puts: [], file: [], minted: [], settingsPosts: [], att: [] };
  const msg = { id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: ANSWER, blocks, status: 'done', createdAt: 't' };
  const ctx = await bootChat({ url, session, innerWidth, matchMedia, local, hooks: { askMarkdown: realMarkdown }, arms: (u, opts) => {
    const extra = more ? more(u, opts) : null;
    if (extra) return extra;
    const path = u.split('?')[0];
    const m = opts.method || 'GET';
    if (path.endsWith(`/api/ask/threads/${TID}`) && m === 'GET') return ok({ thread: { id: TID, title: 'Links', createdAt: 't', updatedAt: 't', context: { pinned: true, projectKey: PK } }, messages: [msg], attachments: [] });
    if (path.endsWith('/api/ask/files/resolve')) { const b = JSON.parse(opts.body); rec.resolve.push(b); return ok({ root: null, paths: Object.fromEntries(b.paths.map((p) => [p, p === 'src/a.js' ? { ok: true, path: 'src/a.js', type: 'file', lines: 40 } : { ok: false }])) }); }
    if (path.endsWith('/api/tools/tabs')) {
      if (m === 'PUT') { const b = JSON.parse(opts.body); rec.puts.push({ q: u.split('?')[1], ...b }); return ok({ tabs: b.tabs }); }
      return ok({ tabs: u.includes(`threadId=${TID}`) ? serverTabs() : [] });
    }
    if (path.endsWith('/api/projects')) return ok({ projects: [{ key: PK, name: 'app', path: '/tmp/app' }] });
    if (path.endsWith('/api/tools/file')) { rec.file.push(u); return ok({ path: 'src/a.js', size: TEXT40.length, text: TEXT40, truncated: false, root: { label: 'app' } }); }
    if (path.endsWith('/api/tools/files')) return ok({ entries: [], root: { label: 'app' } });
    if (path.endsWith('/api/tools/frame-check')) { const b = JSON.parse(opts.body); rec.frame.push(b); return ok(frame(b)); }
    if (path.endsWith('/api/preview/sessions')) { const { port } = JSON.parse(opts.body); rec.minted.push(port); return ok({ port, token: 'tok', base: `/preview/${port}/tok/` }); }
    if (path.endsWith('/api/actions/running')) return ok(running());
    if (path.includes(`/api/ask/threads/${TID}/attachments/`)) { rec.att.push(u); return ok({ text: 'copy text\n' }); }
    if (path.endsWith('/api/settings')) {
      if (m === 'POST') { rec.settingsPosts.push(JSON.parse(opts.body)); return ok({ ok: true, ...settings(), ...JSON.parse(opts.body) }); }
      const body = settings();
      return settingsDelay ? wait(settingsDelay).then(() => ok(body)) : ok(body);
    }
    return null;
  } });
  await ctx.settle(12);
  const doc = ctx.window.document;
  const link = (text) => [...doc.querySelectorAll('.ask-md a')].find((a) => a.textContent === text);
  const clickLink = (text, init = {}) => {
    const ev = new ctx.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    link(text).dispatchEvent(ev);
    return ev;
  };
  const items = (kind) => [...doc.querySelectorAll(`.tool-panel .tool-tab-item${kind ? `[data-kind="${kind}"]` : ''}`)];
  const model = () => JSON.parse(ctx.window.localStorage.getItem('worca-cc.tools') || '{"tabs":[]}');
  return { ...ctx, doc, rec, link, clickLink, items, model };
}

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

test('row 13: the settings card shows the switch and saves it', async () => {
  const a = await boot();
  a.go('settings/ask'); await a.settle(12);
  const cb = a.doc.getElementById('chatLinksInPanel');
  assert.equal(cb.checked, true);
  cb.checked = false;
  cb.dispatchEvent(new a.window.Event('change', { bubbles: true }));
  a.doc.getElementById('chatLinksSave').click();
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
