// test/feature-pull-entries.test.mjs — the two entry points of "pull a feature from Requirements": the New Run button and the
// Chat composer add-on, in jsdom with a fake modal, fake flags and a fake fetchJson. The picker is the real one; the start flow is stubbed.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/' });
for (const k of ['document', 'window', 'Event']) Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
after(() => window.close());
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
const { mountNewRunPull, mountChatPull, mountFeaturePull } = await import('../ui/public/feature-pull/entries.mjs');
const { composerAddons, _resetChatExtensions } = await import('../ui/public/chat/extensions.mjs');

beforeEach(() => { _resetChatExtensions(); document.body.replaceChildren(); window.location.hash = ''; });

function fakeModal() {
  const m = { card: null, opts: null, open(card, opts) { m.card = card; m.opts = opts; }, close() { const o = m.opts; m.card = null; m.opts = null; if (o && o.onClose) o.onClose(); } };
  return m;
}
function fakeFlags(initial = true) {
  const f = { on: initial, subs: [], flagOn: () => f.on, onFlagChange: (_k, fn) => { f.subs.push(fn); return () => {}; }, set(v) { f.on = v; f.subs.forEach((fn) => fn(v)); } };
  return f;
}
const FEATURES = [{ seq: 7, title: 'Login page', state: 'ready', status: 'idle', ready: 6 }, { seq: 8, title: 'Old', state: 'archived', status: 'archived' }];
function harness({ routes = {} } = {}) {
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (route) { const v = route[1]; return typeof v === 'function' ? v(url, opts) : v; }
    if (url.startsWith('/api/requirements?')) return { features: FEATURES };
    return {};
  };
  return { calls, fetchJson };
}
const rows = (modal) => [...modal.card.querySelectorAll('[data-ui="feature-pick-row"]')];
const noteText = (modal) => modal.card.querySelector('[data-ui="feature-pick-note"]')?.textContent;

function newRun({ target, flags = fakeFlags(true), routes, startFeature } = {}) {
  const button = document.createElement('button');
  document.body.append(button);
  const modal = fakeModal();
  const h = harness({ routes });
  const started = [];
  const startFeatureFn = startFeature || (async (o) => { started.push(o); o.onStarted({ runId: 'run-9', version: 1 }); return null; });
  mountNewRunPull({ button, getTarget: () => target, fetchJson: h.fetchJson, createModal: () => modal, flagOn: flags.flagOn, onFlagChange: flags.onFlagChange, startFeature: startFeatureFn, win: window, document });
  return { button, modal, flags, started, ...h };
}
const PROJECT = { runTarget: 'project', projectKey: 'shop-1', projectPath: '/work/shop', workspaceId: '', workspacePaths: [] };

test('New Run: the button is hidden while the flag is off and follows the flag live', () => {
  const t = newRun({ target: PROJECT, flags: fakeFlags(false) });
  assert.equal(t.button.hidden, true);
  t.flags.set(true);
  assert.equal(t.button.hidden, false);
  t.flags.set(false);
  assert.equal(t.button.hidden, true);
});

test('New Run: a project target lists that project\'s features and a pick starts from it with the project directory', async () => {
  const t = newRun({ target: PROJECT });
  assert.equal(t.button.hidden, false);
  t.button.click();
  await settle();
  assert.equal(t.calls[0].url, '/api/requirements?scopeType=project&scopeKey=shop-1');
  assert.deepEqual(rows(t.modal).map((r) => r.querySelector('.feature-pick-title').textContent), ['Login page']);
  rows(t.modal)[0].click();
  await settle();
  assert.equal(t.started.length, 1);
  assert.equal(t.started[0].seq, 7);
  assert.equal(t.started[0].projectDir, '/work/shop');
  assert.equal(window.location.hash, '#running/run-9');
});

test('New Run: a workspace target uses the workspace id and its first member directory', async () => {
  const t = newRun({ target: { runTarget: 'workspace', projectKey: '', projectPath: '', workspaceId: 'ws-2', workspacePaths: ['/work/a', '/work/b'] } });
  t.button.click();
  await settle();
  assert.equal(t.calls[0].url, '/api/requirements?scopeType=workspace&scopeKey=ws-2');
  rows(t.modal)[0].click();
  await settle();
  assert.equal(t.started[0].projectDir, '/work/a');
});

test('New Run: no run target shows "Pick a project or workspace first" and fetches nothing', async () => {
  const t = newRun({ target: { runTarget: 'none', projectKey: '', projectPath: '', workspaceId: '', workspacePaths: [] } });
  t.button.click();
  await settle();
  assert.equal(noteText(t.modal), 'Pick a project or workspace first');
  assert.equal(t.calls.length, 0);
});

test('New Run: a project target with no project chosen yet is the no-scope message too', async () => {
  const t = newRun({ target: { ...PROJECT, projectKey: '', projectPath: '' } });
  t.button.click();
  await settle();
  assert.equal(noteText(t.modal), 'Pick a project or workspace first');
  assert.equal(t.calls.length, 0);
});

test('New Run: the form is untouched, and a start without a run id does not move the page', async () => {
  const form = document.createElement('form');
  form.innerHTML = '<input id="a" value="keep me"><textarea id="b">my prompt</textarea>';
  document.body.append(form);
  const t = newRun({ target: PROJECT, startFeature: async (o) => { o.onStarted({}); return null; } });
  t.button.click();
  await settle();
  rows(t.modal)[0].click();
  await settle();
  assert.equal(form.querySelector('#a').value, 'keep me');
  assert.equal(form.querySelector('#b').value, 'my prompt');
  assert.equal(window.location.hash, '');
});

function chat({ context = { pinned: true, projectKey: 'shop-1' }, threadId = 'ask_1', flags = fakeFlags(true), routes, startFeature, postStatus = 201, liveScope } = {}) {
  const modal = fakeModal();
  const h = harness({ routes: {
    '/api/projects': { projects: [{ key: 'shop-1', path: '/work/shop' }] },
    '/api/workspaces': { workspaces: [{ id: 'ws-2', projectPaths: ['/work/a', '/work/b'] }] },
    '/api/ask/threads/': () => { if (postStatus >= 400) { const e = new Error('x'); e.status = postStatus; throw e; } return { cardId: 'card_1' }; },
    '/api/ask/threads': { thread: { id: 'ask_new' } },
    ...routes } });
  const started = [];
  const startFeatureFn = startFeature || (async (o) => { started.push(o); o.onStarted({ runId: 'run-9', version: 1 }); return null; });
  mountChatPull({ fetchJson: h.fetchJson, createModal: () => modal, flagOn: flags.flagOn, onFlagChange: flags.onFlagChange, startFeature: startFeatureFn, win: window });
  const [addon] = composerAddons();
  const lead = document.createElement('div');
  document.body.append(lead);
  const announced = [];
  const thread = threadId ? { id: threadId, context } : null;
  const handle = addon.mount(lead, { doc: document, fetch: () => { throw new Error('unused'); }, threadId: () => threadId, thread: () => thread, announce: (t) => announced.push(t),
    ...(liveScope ? { scope: () => liveScope } : {}) });
  handle.update(thread);
  return { lead, modal, flags, handle, started, announced, ...h };
}

test('Chat: the add-on registers once, with an icon button that has an aria-label, only while the flag is on', () => {
  const c = chat({ flags: fakeFlags(false) });
  assert.equal(composerAddons().length, 1);
  assert.equal(composerAddons()[0].id, 'feature-pull');
  assert.equal(c.lead.querySelector('button'), null);
  c.flags.set(true);
  const btn = c.lead.querySelector('button');
  assert.ok(btn);
  assert.ok(btn.getAttribute('aria-label'));
  assert.ok(btn.querySelector('svg'));
  assert.equal(btn.textContent.trim(), '');
  c.flags.set(false);
  assert.equal(c.lead.querySelector('button'), null);
});

test('Chat: the picker lists the thread\'s project features; a pick starts with that project\'s directory and posts the card', async () => {
  const c = chat();
  c.lead.querySelector('button').click();
  await settle();
  assert.equal(c.calls.find((x) => x.url.startsWith('/api/requirements?')).url, '/api/requirements?scopeType=project&scopeKey=shop-1');
  rows(c.modal)[0].click();
  await settle();
  assert.equal(c.started[0].seq, 7);
  assert.equal(c.started[0].projectDir, '/work/shop');
  const post = c.calls.find((x) => x.url === '/api/ask/threads/ask_1/feature-runs');
  assert.equal(post.method, 'POST');
  assert.deepEqual(post.body, { seq: 7, runId: 'run-9' });
  assert.equal(c.lead.querySelector('.fp-chat-notice'), null);
});

test('Chat: a workspace thread resolves its first member directory', async () => {
  const c = chat({ context: { pinned: true, workspaceId: 'ws-2' } });
  c.lead.querySelector('button').click();
  await settle();
  assert.ok(c.calls.some((x) => x.url === '/api/requirements?scopeType=workspace&scopeKey=ws-2'));
  rows(c.modal)[0].click();
  await settle();
  assert.equal(c.started[0].projectDir, '/work/a');
});

test('Chat: an unpinned thread has no scope: the picker says so and fetches no features', async () => {
  const c = chat({ context: { pinned: false, projectKey: 'shop-1' } });
  c.lead.querySelector('button').click();
  await settle();
  assert.equal(noteText(c.modal), 'Pick a project or workspace first');
  assert.equal(c.calls.some((x) => x.url.startsWith('/api/requirements')), false);
});

test('Chat: the live scope pill wins over a stale thread context (picker, directory and card)', async () => {
  const c = chat({ context: { pinned: true, projectKey: 'old' }, liveScope: { pinned: true, projectKey: 'shop-1', workspaceId: null } });
  c.lead.querySelector('button').click();
  await settle();
  assert.equal(c.calls.find((x) => x.url.startsWith('/api/requirements?')).url, '/api/requirements?scopeType=project&scopeKey=shop-1');
  rows(c.modal)[0].click();
  await settle();
  assert.equal(c.started[0].projectDir, '/work/shop');
});

test('Chat: a new chat with a pinned scope pulls a feature: a thread is created, pinned, given the card, and opened', async () => {
  const c = chat({ threadId: null, context: null, liveScope: { pinned: true, projectKey: 'shop-1', workspaceId: null } });
  c.lead.querySelector('button').click();
  await settle();
  assert.equal(c.calls.find((x) => x.url.startsWith('/api/requirements?')).url, '/api/requirements?scopeType=project&scopeKey=shop-1');
  rows(c.modal)[0].click();
  await settle();
  const posts = c.calls.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${x.url}`);
  assert.deepEqual(posts, ['POST /api/ask/threads', 'PATCH /api/ask/threads/ask_new', 'POST /api/ask/threads/ask_new/feature-runs']);
  assert.deepEqual(c.calls.find((x) => x.method === 'PATCH').body, { scope: { pinned: true, projectKey: 'shop-1' } });
  assert.equal(window.location.hash, '#chat/ask_new');
  assert.equal(c.lead.querySelector('.fp-chat-notice'), null);
});

test('Chat: a new chat with no scope still shows "Pick a project or workspace first"', async () => {
  const c = chat({ threadId: null, context: null, liveScope: { pinned: false, projectKey: null, workspaceId: null } });
  c.lead.querySelector('button').click();
  await settle();
  assert.equal(noteText(c.modal), 'Pick a project or workspace first');
});

test('Chat: a second press while the picker is open does not open a second one', async () => {
  const c = chat();
  let opened = 0;
  const open = c.modal.open; c.modal.open = (...a) => { opened += 1; return open(...a); };
  const btn = c.lead.querySelector('button');
  btn.click(); btn.click();
  await settle();
  assert.equal(opened, 1);
});

test('Chat: the card-failure notice goes when the thread changes', async () => {
  const c = chat({ postStatus: 500 });
  c.lead.querySelector('button').click();
  await settle();
  rows(c.modal)[0].click();
  await settle();
  assert.ok(c.lead.querySelector('.fp-chat-notice'));
  c.handle.update({ id: 'ask_2', context: {} });
  assert.equal(c.lead.querySelector('.fp-chat-notice'), null);
});

test('New Run: a second press while a pull is going does not open a second picker', async () => {
  const t = newRun({ target: PROJECT });
  let opened = 0;
  const open = t.modal.open; t.modal.open = (...a) => { opened += 1; return open(...a); };
  t.button.click(); t.button.click();
  await settle();
  assert.equal(opened, 1);
});

test('Chat: when the card cannot be posted, a notice says so and links to the run', async () => {
  const c = chat({ postStatus: 500 });
  c.lead.querySelector('button').click();
  await settle();
  rows(c.modal)[0].click();
  await settle();
  const notice = c.lead.querySelector('.fp-chat-notice');
  assert.ok(notice);
  assert.match(notice.textContent, /The run started, but its card could not be posted/);
  assert.equal(notice.querySelector('a').getAttribute('href'), '#running/run-9');
  assert.ok(c.announced.some((t) => /card could not be posted/.test(t)));
});

test('mountFeaturePull mounts both entries: the chat add-on registers and the New Run button is wired', () => {
  const button = document.createElement('button');
  document.body.append(button);
  const f = fakeFlags(true);
  mountFeaturePull({ button, getTarget: () => PROJECT, flagOn: f.flagOn, onFlagChange: f.onFlagChange, fetchJson: async () => ({}), document });
  assert.equal(composerAddons().length, 1);
  assert.equal(button.hidden, false);
});

test('the New Run page carries the button outside the advanced-only Task source field', () => {
  const html = readFileSync(new URL('../ui/public/new-run/new.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const btn = doc.getElementById('pull-from-requirements');
  assert.ok(btn);
  assert.equal(btn.closest('[data-min-level]'), null);
  assert.match(btn.textContent, /Pull from Requirements/);
});
