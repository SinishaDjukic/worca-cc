// test/ui-ask-away-card.test.mjs
// The Away mode card in the Ask panel (wording §3.7): "Change Away mode?" with the scope as its target line, the Now / After
// summary lines with the changed words marked, one Changed line per field, Keep as is / Apply; the
// applied state reads "Saved. <the new status line>".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { checkRows } from './helpers/rows.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000002';

const AWAY_CARD = {
  type: 'away', level: 'user', projectKey: null, projectName: null, set: { enabled: true }, unset: [],
  changes: [{ field: 'enabled', label: 'Which runs', before: 'Only runs I marked', after: 'All runs' }],
  summary: 'Which runs: All runs',
  before: ['From 22:00 to 07:00, worca answers questions on runs you marked. Other runs wait for you.'],
  after: ['From 22:00 to 07:00, worca answers questions on all runs.'],
  note: '',
};

function apiHandler(recorder = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}/cards/${CARD_ID}` && method === 'POST') {
      recorder.cardBodies = [...(recorder.cardBodies || []), JSON.parse(opts.body)];
      if (recorder.cardResponse) return recorder.cardResponse;
      return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: CARD_ID, state: 'applied', card: AWAY_CARD }, turn: { assistantMessageId: 'askm_00000009' } }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    if (url.startsWith('/api/ask/threads') && method === 'GET') return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
    if (url === '/api/projects') return { ok: true, status: 200, json: async () => ({ projects: [] }) };
    if (url === '/api/workspaces') return { ok: true, status: 200, json: async () => ({ workspaces: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function openWith(block, recorder = {}) {
  const ctx = makePanel({ fetchHandler: apiHandler(recorder) });
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
const proposed = (card) => ({ kind: 'card', id: CARD_ID, state: 'proposed', card });

test('Away card: proposed renders Now/After/Changed and Apply posts applied; a project card\'s Keep as is posts declined; applied shows Saved. with no buttons', async () => {
  await checkRows([
    { name: 'proposed: title, Now / After / Changed, both buttons; Apply posts applied', run: async () => {
      const rec = {};
      const ctx = await openWith(proposed(AWAY_CARD), rec);
      const el = ctx.doc.querySelector('.ask-card.ask-awcard');
      assert.ok(el, 'the Away mode card renders as its own card');
      assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Change Away mode?');
      assert.equal(el.querySelector('.ask-mcard-target').textContent, 'user settings', 'the scope is the target line');
      assert.match(el.querySelector('.ask-awcard-now').textContent, /^Now:.*runs you marked/);
      assert.match(el.querySelector('.ask-awcard-after').textContent, /^After:.*on all runs/);
      assert.deepEqual([...el.querySelectorAll('.ask-awcard-after mark')].map((m) => m.textContent), ['all', 'runs.']);
      assert.deepEqual([...el.querySelectorAll('.ask-awcard-changes li')].map((li) => li.textContent), ['Which runs: Only runs I marked → All runs']);
      assert.equal(el.querySelector('[data-ask-ac-decline]').textContent, 'Keep as is');
      const apply = el.querySelector('[data-ask-ac-apply]');
      assert.equal(apply.textContent, 'Apply');
      apply.click();
      await ctx.tick(); await ctx.tick();
      assert.deepEqual(rec.cardBodies, [{ state: 'applied' }]);
    } },
    { name: 'a project card names the project; Keep as is posts declined', run: async () => {
      const rec = {};
      const ctx = await openWith(proposed({ ...AWAY_CARD, level: 'project', projectKey: 'shop-1', projectName: 'Shop' }), rec);
      const el = ctx.doc.querySelector('.ask-card.ask-awcard');
      assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Change Away mode?');
      assert.equal(el.querySelector('.ask-mcard-target').textContent, 'project Shop');
      el.querySelector('[data-ask-ac-decline]').click();
      await ctx.tick(); await ctx.tick();
      assert.deepEqual(rec.cardBodies, [{ state: 'declined' }]);
    } },
    { name: 'applied: "Saved. <detail>"', run: async () => {
      const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'applied', card: { ...AWAY_CARD, result: { ok: true, detail: 'Right now it is 15:00. You count as here. Next away hours start at 22:00.' } } });
      const el = ctx.doc.querySelector('.ask-card.ask-awcard');
      assert.equal(el.querySelector('.ask-awcard-saved').textContent, 'Saved. Right now it is 15:00. You count as here. Next away hours start at 22:00.');
      assert.equal(el.querySelector('[data-ask-ac-apply]'), null, 'no buttons once applied');
    } },
  ]);
});
