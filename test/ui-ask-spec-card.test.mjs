// test/ui-ask-spec-card.test.mjs
// The Spec Builder card in the Ask panel (docs/spec-builder.md): a proposed `spec` card shows the title, project,
// a collapsed preview and the estimate; "Use this spec" hands the markdown to onUseSpec; "Save to plans/" posts
// to the save route, and a 409 turns the button into "Save as <suggestion>". startThread opens a pinned chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { checkRows } from './helpers/rows.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000002';
const SPEC = '---\nworca:\n  kind: feature\n  size: medium\n  roles: [product]\n---\n# Dark mode\n';
const CARD = {
  type: 'spec', title: 'Dark mode', summary: 'Spec: Dark mode', markdown: SPEC, path: 'plans/dark-mode-design.md',
  frontMatter: { kind: 'feature', size: 'medium', roles: ['product'] },
  estimate: { recipe: 'plan-complete-detailed', stages: [], low: 1.2, high: 7.5, ms: 26 * 60_000, msHigh: 156 * 60_000, basis: 'rough', samples: 0 },
  projectKey: 'app-0000abcd', projectName: 'app', projectDir: '/tmp/app',
};

function apiHandler(recorder) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/spec-builder/save' && method === 'POST') {
      const body = JSON.parse(opts.body);
      recorder.saves.push(body);
      if (body.path === 'plans/dark-mode-design.md') return { ok: false, status: 409, json: async () => ({ error: 'plans/dark-mode-design.md already exists', code: 'EXISTS', suggestion: 'plans/dark-mode-design-v2.md' }) };
      return { ok: true, status: 200, json: async () => ({ path: body.path }) };
    }
    if (url === '/api/ask/threads' && method === 'POST') return { ok: true, status: 201, json: async () => ({ thread: { id: 'ask_00000009', title: 'New', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    if (url.startsWith('/api/ask/threads') && method === 'GET') return { ok: true, status: 200, json: async () => ({ threads: [] }) };
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [] }) };
    if (url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workspaces: [] }) };
    return { ok: true, status: 202, json: async () => ({}) };
  };
}

async function openWith(block, recorder) {
  const ctx = makePanel({ fetchHandler: apiHandler(recorder), deps: { onUseSpec: (spec) => recorder.used.push(spec) } });
  ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  const frames = stampFrames([
    { type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't' },
    { type: 'ask-card', block },
  ], { threadId: TID, messageId: MID });
  for (const f of frames) ctx.panel.pushServerFrame(f);
  ctx.flush();
  await ctx.tick(); await ctx.tick();
  ctx.flush();
  return ctx;
}

test('the spec card: renders, Use this spec, Save with the 409 suggestion', async () => {
  const recorder = { saves: [], used: [] };
  const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'proposed', card: CARD }, recorder);
  const card = ctx.doc.querySelector('[data-ask-speccard]');
  await checkRows([
    { name: 'renders the title, the project, a collapsed preview and the estimate line', run: () => {
      assert.ok(card, 'the spec card is rendered');
      assert.match(card.textContent, /Dark mode/);
      assert.match(card.textContent, /app/);
      const details = card.querySelector('details');
      assert.ok(details && !details.open);
      assert.match(details.textContent, /# Dark mode/);
      assert.match(card.querySelector('[data-ask-spec-estimate]').textContent, /^\$1\.20–\$7\.50 · 26 min–156 min · Rough estimate$/);
    } },
    { name: 'Use this spec hands the markdown, project key and dir to onUseSpec', run: () => {
      card.querySelector('[data-ask-spec-use]').click();
      assert.deepEqual(recorder.used, [{ markdown: SPEC, projectKey: 'app-0000abcd', projectDir: '/tmp/app' }]);
    } },
    { name: 'Save posts the card path; a 409 offers the suggestion, which the next click posts', run: async () => {
      const save = card.querySelector('[data-ask-spec-save]');
      save.click();
      await ctx.tick(); await ctx.tick();
      assert.deepEqual(recorder.saves[0], { projectKey: 'app-0000abcd', path: 'plans/dark-mode-design.md', markdown: SPEC });
      assert.equal(card.querySelector('.ask-card-err').textContent, 'plans/dark-mode-design.md exists');
      assert.equal(save.textContent, 'Save as plans/dark-mode-design-v2.md');
      save.click();
      await ctx.tick(); await ctx.tick();
      assert.equal(recorder.saves[1].path, 'plans/dark-mode-design-v2.md');
      assert.equal(save.textContent, 'Saved to plans/dark-mode-design-v2.md');
      assert.ok(save.disabled);
      assert.equal(card.querySelector('.ask-card-err').textContent, '');
    } },
  ]);
});

test('startThread: a new chat pinned to the project, whose first message is the text', async () => {
  const recorder = { saves: [], used: [] };
  const ctx = makePanel({ fetchHandler: apiHandler(recorder) });
  const sent = await ctx.panel.startThread({ text: '[worca spec-builder] Write a spec', scope: { projectKey: 'app-0000abcd', label: 'app' } });
  assert.equal(sent, true);
  assert.ok(ctx.panel.isOpen());
  const posts = ctx.fetchCalls.filter((c) => (c.opts.method || 'GET').toUpperCase() === 'POST');
  assert.equal(posts[0].url, '/api/ask/threads');
  const msg = posts.find((c) => c.url === '/api/ask/threads/ask_00000009/messages');
  assert.ok(msg, 'the first message is posted to the new thread');
  const body = JSON.parse(msg.opts.body);
  assert.equal(body.text, '[worca spec-builder] Write a spec');
  assert.equal(body.context.pinned, true);
  assert.equal(body.context.projectKey, 'app-0000abcd');
});
