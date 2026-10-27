// test/ui-newpipeline-shape-link.test.mjs — Shape it first (slice 2) in the booted app: the New run form's "Plan it
// with me in Chat" link (Advanced only) takes the Markdown typed there to the
// Chat HOME with the `shape` intent armed; the entry is consumed on any Chat entry. A Markdown handoff
// (openNewPipeline {promptMarkdown}) selects the Markdown source; and a hello that arrives while the Chat home is open
// re-pushes its switches without re-fetching them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/run-page-boot.mjs';
import { _resetChatExtensions } from '../ui/public/chat/extensions.mjs';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const THREAD_ID = 'ask_000000c1';
const THREAD = { id: THREAD_ID, title: 'Old chat', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };

function arms({ settings = { chat: { scriptTools: true } }, sources = [] } = {}) {
  return (url, opts) => {
    const method = String(opts.method || 'GET').toUpperCase();
    const path = url.split('?')[0];
    if (method !== 'GET') return null;
    if (url === '/api/history') return ok({ pipelines: [], ghAvailable: false, prHosts: {} });
    if (url.startsWith('/api/ask/threads?limit=')) return ok({ threads: [], total: 0 });
    if (url === `/api/ask/threads/${THREAD_ID}`) return ok({ thread: THREAD, messages: [], attachments: [], runLinks: [], inFlight: null });
    if (url === '/api/settings') return ok(settings);
    if (url === '/api/sources') return ok({ sources });
    if (path.endsWith('/api/workflows')) return ok({ workflows: [{ id: 'wf_default', name: 'Default' }] });
    if (path.endsWith('/api/config')) return ok({ config: { steps: {}, customModels: [], activeWorkflowId: 'wf_default' }, models: [], efforts: [] });
    if (path.endsWith('/api/guardrails')) return ok({ guardrails: [{ id: 'normal', name: 'Normal' }] });
    if (path.endsWith('/api/branches')) return ok({ branches: ['main'], current: 'main' });
    if (url.includes('/api/projects')) return ok({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] });
    return null;
  };
}
async function boot(o = {}) {
  _resetChatExtensions();                       // app.js re-registers every card and add-on per boot
  const ctx = await bootApp({ fetchHandler: arms(o) });
  ctx.wsBox.ws.dispatch('open', {});
  return ctx;
}
const hello = (ctx) => ctx.dispatch({ type: 'hello', runs: [] });
const link = (doc) => doc.getElementById('shapeChatLink');
const intentLabel = (doc) => {
  const chip = doc.querySelector('[data-chat-page] .chat-intent');
  return chip ? chip.querySelector('.chat-intent-l').textContent : null;
};
const composer = (doc) => doc.querySelector('[data-chat-page] .ask-input');

test('the New run link always shows (no hello needed) and is Advanced only', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  const p = link(doc);
  assert.ok(p, 'the link lives in the Markdown pane');
  assert.ok(p.closest('#markdown-pane'), 'inside #markdown-pane');
  assert.equal(p.dataset.minLevel, 'advanced');
  assert.equal(p.hidden, false, 'no hello yet');
  hello(ctx);
  assert.equal(p.hidden, false);
});

test('the link takes the Markdown to the Chat HOME (not the last chat), in the composer, with the shape intent armed', async () => {
  const ctx = await boot();
  hello(ctx);
  const doc = ctx.window.document;
  ctx.go(`chat/${THREAD_ID}`);                   // a "last chat" exists
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, `#chat/${THREAD_ID}`);
  ctx.go('new');
  await ctx.settle(6);
  doc.getElementById('promptMarkdown').value = '  # Spec\nAdd a dark mode toggle.  ';
  doc.getElementById('shapeChatLinkBtn').click();
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#chat');
  assert.equal(doc.querySelector('[data-chat-page]').dataset.view, 'home');
  assert.equal(composer(doc).value, '# Spec\nAdd a dark mode toggle.');
  assert.equal(intentLabel(doc), 'Shaper');
});

test('the entry is consumed on any Chat entry: opening an existing chat instead arms nothing, nor does a later home visit', async () => {
  const ctx = await boot();
  hello(ctx);
  const doc = ctx.window.document;
  ctx.go('new');
  await ctx.settle(6);
  doc.getElementById('promptMarkdown').value = 'Some spec';
  doc.getElementById('shapeChatLinkBtn').click();
  ctx.go(`chat/${THREAD_ID}`);                   // the person went to a chat before home showed
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, `#chat/${THREAD_ID}`);
  assert.equal(intentLabel(doc), null, 'no intent on an existing chat');
  assert.equal(composer(doc).value, '');
  ctx.go('runs');
  await ctx.settle(4);
  ctx.go('chat/new');
  await ctx.settle(8);
  assert.equal(doc.querySelector('[data-chat-page]').dataset.view, 'home');
  assert.equal(intentLabel(doc), null, 'a later home visit is not armed');
  assert.equal(composer(doc).value, '');
});

test('leaving Chat drops an armed intent: link → home, Back to New run, then the Chat row shows no intent', async () => {
  const ctx = await boot();
  hello(ctx);
  const doc = ctx.window.document;
  ctx.go('new');
  await ctx.settle(6);
  doc.getElementById('promptMarkdown').value = 'Some spec';
  doc.getElementById('shapeChatLinkBtn').click();
  await ctx.settle(8);
  assert.equal(intentLabel(doc), 'Shaper', 'the link armed home');
  ctx.go('new');                                 // Back
  await ctx.settle(6);
  ctx.go('chat');                                // the Chat row
  await ctx.settle(8);
  assert.equal(doc.querySelector('[data-chat-page]').dataset.view, 'home');
  assert.equal(intentLabel(doc), null, 'a later visit is not armed');
});

test('leaving Chat drops an intent a home tile armed (Runs and back)', async () => {
  const ctx = await boot();
  hello(ctx);
  const doc = ctx.window.document;
  ctx.go('chat/new');
  await ctx.settle(8);
  doc.querySelector('.chat-home-act[data-intent="shape"]').click();
  await ctx.settle(2);
  assert.equal(intentLabel(doc), 'Shaper');
  ctx.go('runs');
  await ctx.settle(4);
  ctx.go('chat/new');
  await ctx.settle(8);
  assert.equal(intentLabel(doc), null);
});

test('openNewPipeline {promptMarkdown} selects the Markdown source and fills it; the prompt stays empty, the workflow Auto', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  doc.getElementById('prompt').value = 'left over';
  ctx.window.__np.openNewPipeline({ target: 'project', projectDir: '/repos/proj', workflowId: 'wf_auto', promptMarkdown: '# Plan\n- one', title: 'T' });
  ctx.window.dispatchEvent(new ctx.window.Event('hashchange'));
  await ctx.settle(12);
  const checked = [...doc.querySelectorAll('input[name="source"]')].find((x) => x.checked);
  assert.equal(checked.value, 'markdown');
  const on = doc.querySelector('#source-seg button[data-src="markdown"]');
  assert.equal(on.classList.contains('on'), true);
  assert.equal(on.getAttribute('aria-pressed'), 'true');
  assert.equal(doc.querySelector('#source-seg button[data-src="prompt"]').getAttribute('aria-pressed'), 'false');
  assert.equal(doc.getElementById('markdown-pane').classList.contains('hidden'), false);
  assert.equal(doc.getElementById('promptMarkdown').value, '# Plan\n- one');
  assert.equal(doc.getElementById('prompt').value, '');
  assert.equal(doc.getElementById('workflowSelect').value, 'wf_auto');
});

test('Chat home: the shape tile shows at once, and a hello while home is open re-pushes the switches without re-fetching them', async () => {
  const ctx = await boot({ settings: { chat: { scriptTools: false } }, sources: [{ type: 'plugin', plugin: 'jira', sourceId: 'issues' }] });
  ctx.go('chat/new');
  await ctx.settle(8);
  const doc = ctx.window.document;
  const tile = (id) => doc.querySelector(`.chat-home-act[data-intent="${id}"]`);
  assert.equal(tile('shape').hidden, false, 'Shaper is always on');
  assert.equal(tile('script').hidden, true, 'scriptTools:false');
  const switches = () => ctx.calls.filter((c) => c.url === '/api/settings' || c.url === '/api/sources').length;
  const before = switches();
  hello(ctx);
  await ctx.settle(6);
  assert.equal(tile('shape').hidden, false, 'still there after the hello');
  assert.equal(switches(), before, 'flags re-pushed, not re-fetched');
  assert.equal(tile('script').hidden, true, 'scripts kept its state');
  doc.querySelector('.chat-home-act.is-more').click();
  assert.ok([...doc.querySelectorAll('.wfv-menu .wfv-menu-l')].some((n) => n.textContent === 'Find tasks'), 'tasks kept its state');
});
