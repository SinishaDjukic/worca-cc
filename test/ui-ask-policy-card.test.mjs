// test/ui-ask-policy-card.test.mjs
// The team-policy card in the Ask panel (docs/team-policy.md "Ask Worca"): the metrics card's
// component with the policy words — title, kind chip, the per-kind verb — plus an edit's
// before → after list; Publish posts {state:'applied'}; applied / failed / declined states.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000002';

const EDIT_CARD = {
  type: 'policy', kind: 'edit', projectKey: 'bl-00000001', projectName: 'billing', workspaceId: null, workspaceName: null,
  home: 'acme/gateway', baseSha: 'abc1234', note: 'Q4 push needs headroom', message: null,
  summary: "Edit acme/gateway's team policy — 2 changes",
  changes: [
    { key: 'cost.pipelineLimitUsd', block: 'fields', label: 'Per-pipeline cap (USD)', before: 'soft $25.00 · reason required', after: 'soft $30.00 · reason required' },
    { key: 'guardrails.minimum', block: 'fields', label: 'Minimum tier', before: null, after: 'soft Normal' },
  ],
  effects: ["One commit to acme/gateway's worca-policy branch, pushed to origin under your git user", 'Governs acme/gateway and the projects that follow it: acme/billing'],
};
const FOLLOW_CARD = {
  type: 'policy', kind: 'enable', mode: 'follow', projectKey: 'ed-00000001', projectName: 'edge', workspaceId: null, workspaceName: null,
  delegateTo: 'acme/gateway', change: false, note: '', summary: "Make edge follow acme/gateway's team policy", effects: ['Pushes a marker branch'],
};

function apiHandler(recorder = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}/cards/${CARD_ID}` && method === 'POST') {
      recorder.cardBodies = [...(recorder.cardBodies || []), JSON.parse(opts.body)];
      return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: CARD_ID, state: 'applied', card: { ...EDIT_CARD, result: { ok: true, detail: 'published abc1234 to acme/gateway' } } }, turn: { assistantMessageId: 'askm_00000009' } }) };
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

test('proposed edit: policy title and chip, the before → after list, effects, Decline / Publish; Publish posts applied', async () => {
  const rec = {};
  const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'proposed', card: EDIT_CARD }, rec);
  const el = ctx.doc.querySelector('.ask-card.ask-mcard.ask-pcard');
  assert.ok(el, 'the policy card reuses the metrics card component');
  assert.equal(el.getAttribute('data-ask-pcard'), 'proposed');
  assert.equal(el.getAttribute('data-ask-mcard'), null);
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Proposed policy change');
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Edit team policy');
  assert.equal(el.querySelector('.ask-mcard-summary').textContent, EDIT_CARD.summary);
  assert.equal(el.querySelector('.ask-mcard-target').textContent, 'project billing');
  assert.equal(el.querySelector('.ask-mcard-note').textContent, 'Q4 push needs headroom');
  const rows = [...el.querySelectorAll('.ask-mcard-changes li')];
  assert.deepEqual(rows.map((li) => [li.querySelector('.ask-mcard-change-label').textContent, li.querySelector('.ask-mcard-before').textContent, li.querySelector('.ask-mcard-after').textContent]), [
    ['Per-pipeline cap (USD)', 'soft $25.00 · reason required', 'soft $30.00 · reason required'],
    ['Minimum tier', 'unset', 'soft Normal'],
  ]);
  assert.ok(rows[1].querySelector('.ask-mcard-before').classList.contains('is-unset'), 'an unset side is styled as such, not struck through');
  assert.deepEqual([...el.querySelectorAll('.ask-mcard-effects li')].map((li) => li.textContent), EDIT_CARD.effects);
  const apply = el.querySelector('[data-ask-mc-apply]');
  assert.equal(apply.textContent, 'Publish');
  apply.click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.cardBodies, [{ state: 'applied' }]);
});

test('the verb follows the kind: Follow / Set up / Set home / Route members', async () => {
  const verb = async (card) => (await openWith({ kind: 'card', id: CARD_ID, state: 'proposed', card })).doc.querySelector('[data-ask-mc-apply]').textContent;
  assert.equal(await verb(FOLLOW_CARD), 'Follow');
  assert.equal(await verb({ ...FOLLOW_CARD, mode: 'here', delegateTo: null }), 'Set up');
  assert.equal(await verb({ ...FOLLOW_CARD, kind: 'workspace_home' }), 'Set home');
  assert.equal(await verb({ ...FOLLOW_CARD, kind: 'route_members' }), 'Route members');
  const chip = (await openWith({ kind: 'card', id: CARD_ID, state: 'proposed', card: FOLLOW_CARD })).doc.querySelector('.ask-mcard-kind').textContent;
  assert.equal(chip, 'Set up team policy');
});

test('applied, failed and declined states', async () => {
  const applied = await openWith({ kind: 'card', id: CARD_ID, state: 'applied', card: { ...EDIT_CARD, result: { ok: true, detail: 'published abc1234 to acme/gateway' } } });
  const a = applied.doc.querySelector('.ask-pcard');
  assert.equal(a.querySelector('.ask-mcard-title').textContent, 'Applied policy change');
  assert.equal(a.querySelector('.ask-mcard-detail').textContent, 'published abc1234 to acme/gateway');
  assert.equal(a.querySelectorAll('.ask-mcard-changes li').length, 2, 'the receipt keeps what changed');
  assert.ok(!a.querySelector('.ask-mcard-effects') && !a.querySelector('[data-ask-mc-apply]'));
  const failed = await openWith({ kind: 'card', id: CARD_ID, state: 'failed', error: 'push rejected', card: { ...EDIT_CARD, result: { ok: false, error: 'push rejected', hint: 'you may not have push rights to `worca-policy`' } } });
  const f = failed.doc.querySelector('.ask-pcard');
  assert.equal(f.querySelector('.ask-mcard-title').textContent, 'Policy change failed');
  assert.equal(f.querySelector('.ask-mcard-failed').textContent, 'Could not apply: push rejected');
  assert.match(f.querySelector('.ask-mcard-hint').textContent, /push rights/);
  const declined = await openWith({ kind: 'card', id: CARD_ID, state: 'declined', card: EDIT_CARD });
  assert.equal(declined.doc.querySelector('.ask-card-stub').textContent, `Declined — ${EDIT_CARD.summary}`);
});
