// test/ui-ask-proxy-card.test.mjs
// The corporate proxy card in the Ask panel (propose_network_proxy_change / propose_corporate_proxy_on): the title,
// one line per change "Label: before → after", "New connections use it now.", Keep as is / Apply; the applied state
// reads the result's detail and links to the setting; a declined card is a one-line stub. A card stored before the
// proxy left Labs (kind 'flag') renders as the enable card: no Labs, no restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { stampFrames } from './helpers/ask-frames.mjs';
import { checkRows } from './helpers/rows.mjs';

const TID = 'ask_00000001';
const MID = 'askm_00000001';
const CARD_ID = 'card_00000002';

const PROXY_CARD = { type: 'proxy', kind: 'settings', patch: { upstream: 'proxy2.acme.test:3128' },
  changes: [{ field: 'upstream', label: 'Proxy', before: 'proxy.acme.test:8080', after: 'proxy2.acme.test:3128' }],
  summary: 'Proxy: proxy2.acme.test:3128', upstreamChanged: true, restartNote: 'New connections use it now.', note: 'new office' };
const ENABLE_CARD = { type: 'proxy', kind: 'enable', patch: { enabled: true }, restartNote: 'New connections use it now.',
  changes: [{ field: 'enabled', label: 'Network proxy', before: 'Off', after: 'On' }], summary: 'Network proxy: On', note: '' };
/** As stored by an older Worca. */
const FLAG_CARD = { type: 'proxy', kind: 'flag', set: { corporateProxy: true }, changes: [{ field: 'corporateProxy', label: 'Corporate proxy (Labs)', before: 'Off', after: 'On' }],
  summary: 'Corporate proxy (Labs): On', restartNote: 'Restart Worca to apply.', note: '' };

function apiHandler(recorder = {}) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === `/api/ask/threads/${TID}/cards/${CARD_ID}` && method === 'POST') {
      recorder.cardBodies = [...(recorder.cardBodies || []), JSON.parse(opts.body)];
      if (recorder.cardResponse) return recorder.cardResponse;
      return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: CARD_ID, state: 'applied', card: PROXY_CARD }, turn: { assistantMessageId: 'askm_00000009' } }) };
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

test('proxy card: proposed / applied / failed / declined', async () => {
  await checkRows([
    { name: 'proposed settings: title, the change line, the live note, both buttons; Apply posts applied', run: async () => {
      const rec = {};
      const ctx = await openWith(proposed(PROXY_CARD), rec);
      const el = ctx.doc.querySelector('.ask-card.ask-pxcard');
      assert.ok(el, 'the proxy card renders as its own card');
      assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Change the network proxy?');
      assert.equal(el.querySelector('.ask-mcard-note').textContent, 'new office');
      assert.deepEqual([...el.querySelectorAll('.ask-mcard-changes li')].map((li) => li.textContent), ['Proxy: proxy.acme.test:8080 → proxy2.acme.test:3128']);
      assert.equal(el.querySelector('.ask-pxcard-restart').textContent, 'New connections use it now.');
      assert.equal(el.querySelector('[data-ask-px-decline]').textContent, 'Keep as is');
      const apply = el.querySelector('[data-ask-px-apply]');
      assert.equal(apply.textContent, 'Apply');
      apply.click();
      await ctx.tick(); await ctx.tick();
      assert.deepEqual(rec.cardBodies, [{ state: 'applied' }]);
    } },
    { name: 'proposed enable: its own title, Network proxy Off → On, the live line', run: async () => {
      const ctx = await openWith(proposed(ENABLE_CARD));
      const el = ctx.doc.querySelector('.ask-card.ask-pxcard');
      assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Turn on the corporate proxy?');
      assert.match(el.textContent, /Network proxy:?\s*Off\s*→\s*On/);
      assert.match(el.textContent, /New connections use it now\./);
      assert.doesNotMatch(el.textContent, /Restart Worca|Labs/);
    } },
    { name: 'proposed pre-upgrade flag: the enable title and row, the live line; Keep as is posts declined', run: async () => {
      const rec = {};
      const ctx = await openWith(proposed(FLAG_CARD), rec);
      const el = ctx.doc.querySelector('.ask-card.ask-pxcard');
      assert.equal(el.querySelector('.ask-mcard-title').textContent, 'Turn on the corporate proxy?');
      assert.equal(el.querySelector('.ask-pxcard-restart').textContent, 'New connections use it now.');
      assert.doesNotMatch(el.textContent, /Restart Worca|Labs/);
      el.querySelector('[data-ask-px-decline]').click();
      await ctx.tick(); await ctx.tick();
      assert.deepEqual(rec.cardBodies, [{ state: 'declined' }]);
    } },
    { name: 'applied settings: the detail and a link to Settings › Runs › Network proxy; no buttons', run: async () => {
      const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'applied', card: { ...PROXY_CARD, result: { ok: true, detail: 'Saved. New connections use it now.' } } });
      const el = ctx.doc.querySelector('.ask-card.ask-pxcard');
      assert.equal(el.querySelector('.ask-awcard-saved').textContent, 'Saved. New connections use it now.');
      assert.equal(el.querySelector('a.ask-card-sched-link').getAttribute('href'), '#settings/runs/network-proxy');
      assert.equal(el.querySelector('a.ask-card-sched-link').textContent, 'Open Settings › Runs › Network proxy');
      assert.equal(el.querySelector('[data-ask-px-apply]'), null, 'no buttons once applied');
    } },
    { name: 'applied enable and flag: the link goes to Settings › Runs › Network proxy; no Labs, no restart', run: async () => {
      for (const card of [ENABLE_CARD, FLAG_CARD]) {
        const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'applied', card: { ...card, result: { ok: true, detail: 'Saved. New connections use it now.' } } });
        const el = ctx.doc.querySelector('.ask-pxcard');
        assert.equal(el.querySelector('a.ask-card-sched-link').getAttribute('href'), '#settings/runs/network-proxy');
        assert.equal(el.querySelector('a.ask-card-sched-link').textContent, 'Open Settings › Runs › Network proxy');
        assert.doesNotMatch(el.textContent, /Restart Worca|Labs/);
      }
    } },
    { name: 'failed: "Could not apply: <error>"', run: async () => {
      const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'failed', error: 'the corporate proxy is off', card: PROXY_CARD });
      assert.equal(ctx.doc.querySelector('.ask-pxcard .ask-mcard-failed').textContent, 'Could not apply: the corporate proxy is off');
    } },
    { name: 'declined: the one-line stub', run: async () => {
      const ctx = await openWith({ kind: 'card', id: CARD_ID, state: 'declined', card: PROXY_CARD });
      assert.equal(ctx.doc.querySelector('.ask-pxcard'), null);
      assert.ok([...ctx.doc.querySelectorAll('.ask-card-stub')].some((e) => e.textContent === 'Declined: Proxy: proxy2.acme.test:3128'));
    } },
  ]);
});
