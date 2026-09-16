// test/ui-ask-metrics-card.test.mjs
// The metrics card in the Ask panel (docs/team-metrics.md "Ask Worca"): the proposed card renders
// the summary, target, note and effects with Decline / Apply; Apply posts {state:'applied'} and
// Decline {state:'declined'} to the cards route; the applied flip renders the result (and a
// per-member result list for route_members); declined and failed states render their stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000002';

const RECORD_CARD = {
  type: 'metrics', kind: 'record', projectKey: 'proj-00000001', projectName: 'proj', workspaceId: null, workspaceName: null,
  record: false, note: 'you asked to stop recording here', summary: 'Turn "Include my runs" off for proj',
  effects: ['Stops recording your runs on this project from this machine only', 'The branch, existing records and every teammate are untouched'],
};
const ROUTE_CARD = {
  type: 'metrics', kind: 'route_members', projectKey: null, projectName: null, workspaceId: 'wks-team-00000001', workspaceName: 'team',
  homeProjectKey: 'proj-00000001', homeProjectName: 'proj', note: '', summary: 'Route every member of team to its metrics home proj',
  effects: ['Each member with no worca-metrics branch gets a marker branch on its origin that delegates to the home'],
};

function apiHandler(recorder = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}/cards/${CARD_ID}` && method === 'POST') {
      recorder.cardBodies = [...(recorder.cardBodies || []), JSON.parse(opts.body)];
      if (recorder.cardResponse) return recorder.cardResponse;
      return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: CARD_ID, state: 'applied', card: RECORD_CARD }, turn: { assistantMessageId: 'askm_00000009' } }) };
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

test('proposed: summary, target, note, effects, the kind chip and the two verbs; Apply posts applied', async () => {
  const rec = {};
  const ctx = await openWith(proposed(RECORD_CARD), rec);
  const el = ctx.doc.querySelector('.ask-card.ask-mcard');
  assert.ok(el, 'the metrics card renders as its own card, not the run form');
  assert.equal(el.getAttribute('data-ask-mcard'), 'proposed');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Proposed metrics change');
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Include my runs');
  assert.equal(el.querySelector('.ask-mcard-summary').textContent, 'Turn "Include my runs" off for proj');
  assert.equal(el.querySelector('.ask-mcard-target').textContent, 'project proj');
  assert.equal(el.querySelector('.ask-mcard-note').textContent, 'you asked to stop recording here');
  assert.deepEqual([...el.querySelectorAll('.ask-mcard-effects li')].map((li) => li.textContent), RECORD_CARD.effects);
  assert.ok(!el.querySelector('.ask-card-brief'), 'no run-form fields');
  const apply = el.querySelector('[data-ask-mc-apply]');
  assert.equal(apply.textContent, 'Apply');
  apply.click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.cardBodies, [{ state: 'applied' }]);
});

test('Decline posts declined; a failed POST shows in .ask-card-err and re-enables the button', async () => {
  const rec = { cardResponse: { ok: false, status: 409, json: async () => ({ error: 'turn in flight' }) } };
  const ctx = await openWith(proposed(RECORD_CARD), rec);
  const el = ctx.doc.querySelector('.ask-card.ask-mcard');
  const decline = el.querySelector('[data-ask-mc-decline]');
  decline.click();
  await ctx.tick(); await ctx.tick();
  assert.deepEqual(rec.cardBodies, [{ state: 'declined' }]);
  assert.match(el.querySelector('.ask-card-err').textContent, /still replying/);
  assert.equal(decline.disabled, false);
});

test('applied: check line, the result detail, the per-member list for route_members; no verbs', async () => {
  const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'applied', card: { ...ROUTE_CARD, result: { ok: true, home: 'acme/proj', detail: '1 routed · 1 skipped · 1 failed',
    results: [{ slug: 'acme/a', result: 'routed' }, { slug: 'acme/b', result: 'skipped', reason: 'already records on its own branch' }, { slug: 'acme/c', result: 'failed', error: 'push rejected', hint: 'exempt worca-metrics from branch protection' }] } } });
  const el = ctx.doc.querySelector('.ask-card.ask-mcard');
  assert.equal(el.getAttribute('data-ask-mcard'), 'applied');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Applied metrics change');
  assert.equal(el.querySelector('.ask-mcard-kind').textContent, 'Route members');
  assert.ok(el.querySelector('.ask-mcard-summary svg'), 'the check mark');
  assert.equal(el.querySelector('.ask-mcard-target').textContent, 'workspace team');
  assert.equal(el.querySelector('.ask-mcard-detail').textContent, '1 routed · 1 skipped · 1 failed');
  const rows = [...el.querySelectorAll('.ask-mcard-results li')];
  assert.deepEqual(rows.map((li) => [li.className, li.querySelector('.mono').textContent]), [['is-routed', 'acme/a'], ['is-skipped', 'acme/b'], ['is-failed', 'acme/c']]);
  assert.match(rows[2].textContent, /push rejected/); assert.match(rows[2].querySelector('.ask-mcard-hint').textContent, /branch protection/);
  assert.ok(!el.querySelector('.ask-mcard-effects'), 'effects are for the decision, not the receipt');
  assert.ok(!el.querySelector('[data-ask-mc-apply]') && !el.querySelector('[data-ask-mc-decline]'));
});

test('failed and declined states', async () => {
  const failed = await openWith({ kind: 'card', id: CARD_ID, state: 'failed', error: 'push rejected by hook', card: { ...RECORD_CARD, result: { ok: false, error: 'push rejected by hook', code: 'PUSH_REJECTED', hint: 'exempt worca-metrics' } } });
  const el = failed.doc.querySelector('.ask-card.ask-mcard');
  assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Metrics change failed');
  assert.equal(el.querySelector('.ask-mcard-failed').textContent, 'Could not apply: push rejected by hook');
  assert.equal(el.querySelector('.ask-mcard-hint').textContent, 'exempt worca-metrics');
  assert.ok(!el.querySelector('[data-ask-mc-apply]'));
  const declined = await openWith({ kind: 'card', id: CARD_ID, state: 'declined', card: RECORD_CARD });
  const stub = declined.doc.querySelector('.ask-card-stub');
  assert.equal(stub.textContent, 'Declined — Turn "Include my runs" off for proj');
  assert.ok(!declined.doc.querySelector('.ask-mcard'));
});
