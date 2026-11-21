// test/helpers/chat-links-boot.mjs — the shared boot and fixtures of ui-chat-links-app.test.mjs and ui-chat-links-app-panel.test.mjs (split to keep each host file near 12 tests).
import assert from 'node:assert/strict';
// Static, so its afterEach (each test's jsdom window released, its timers stopped) is a file-level hook.
import { bootChat, ok } from './chat-panel-boot.mjs';

export const PK = 'app-0000aaaa';
export const TID = 'ask_0000c11c';
export const realMarkdown = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });
export const ANSWER = 'See src/a.js:12, [the docs](https://docs.example.org/x), [repo](https://github.com/a/b), [dev](http://localhost:5173/), [home](http://localhost:4317/#runs), [pdf](http://localhost:4317/api/x/file.pdf) and [mail](mailto:a@b.c).';
export const TEXT40 = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const until = async (fn, tries = 200) => { for (let i = 0; i < tries; i++) { if (fn()) return true; await wait(5); } return false; };

export async function boot({ url = `http://localhost:4317/#chat/${TID}`, settings = () => ({}), settingsDelay = 0, frame = () => ({ framable: null }),
  serverTabs = () => [], blocks = [], running = () => [], session = null, innerWidth = null, matchMedia = null, local = null, more = null, hooks = null, jsdom = null } = {}) {
  const rec = { resolve: [], frame: [], puts: [], file: [], minted: [], settingsPosts: [], att: [] };
  const msg = { id: 'askm_00000001', threadId: TID, seq: 1, role: 'assistant', text: ANSWER, blocks, status: 'done', createdAt: 't' };
  const ctx = await bootChat({ url, session, innerWidth, matchMedia, local, jsdom, hooks: { askMarkdown: realMarkdown, ...(hooks || {}) }, arms: (u, opts) => {
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

// One files card holding every kind a card shows (row 12b / 12c / 12e).
export const KIND_ITEMS = [
  ['report.pdf', 'pdf', 'application/pdf'], ['deck.docx', 'office', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['notes.md', 'markdown', 'text/markdown'], ['data.csv', 'csv', 'text/csv'], ['data.json', 'json', 'application/json'],
  ['change.diff', 'diff', 'text/x-diff'], ['page.html', 'html', 'text/html'], ['app.js', 'text', 'text/plain'],
  ['shot.png', 'image', 'image/png'], ['logo.svg', 'svg', 'image/svg+xml'],
].map(([name, kind, mime], i) => ({ attId: `att_0000000${i}`, name, kind, mime, bytes: 120 }));
export const KIND_CARD = { kind: 'card', id: 'card_00000001', state: 'shown', card: { type: 'files', title: 'Every kind', items: KIND_ITEMS } };
export const IMAGES = new Set(['image', 'svg']);
/** Click each item's main control in turn; → per item 'popup' or the new Files tab's attKind. The pop-up is closed after each. */
export async function clickEveryKind(a) {
  const seen = [];
  for (const item of KIND_ITEMS) {
    const before = a.model().tabs.filter((t) => t.kind === 'files').length;
    const el = IMAGES.has(item.kind)
      ? a.doc.querySelector(`.ask-filescard-thumb[title="${item.name}"]`)
      : [...a.doc.querySelectorAll('.ask-filescard-name')].find((n) => n.textContent === item.name);
    assert.ok(el, item.name);
    el.click();
    await a.settle(12);
    const files = a.model().tabs.filter((t) => t.kind === 'files');
    const popup = a.doc.querySelector('.viewer-modal.apv:not(.hidden)');
    if (popup) {
      assert.equal(files.length, before, `${item.name}: a pop-up adds no Files tab`);
      popup.querySelector('.apv-close').click();
      await a.settle(6);
      assert.equal(a.doc.querySelector('.viewer-modal.apv:not(.hidden)'), null, 'the pop-up closed');
      seen.push('popup');
    } else {
      assert.equal(files.length, before + 1, `${item.name}: exactly one new Files tab`);
      const tab = files.find((t) => t.state.att === item.attId);
      assert.ok(tab, `${item.name}: its own tab`);
      seen.push(tab.state.attKind);
    }
  }
  return seen;
}
