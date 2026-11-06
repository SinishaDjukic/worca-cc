// test/teams-chat-worker.test.mjs — the teams-chat example plugin: JWT
// accept/reject matrix with self-minted RS256 tokens + a fake JWKS endpoint,
// conversation-reference capture, activity.id dedupe, mention stripping,
// proactive-send-to-seen-only, AAD token caching + 401 refresh, AdaptiveCard
// shape, validateConfig; v0.3 interactive: channel reply chains, Adaptive Card
// controls, invoke parsing + held answers, update activity, typing receipts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createJwtValidator, decodeJwt } from '../plugins/teams-chat/channel/jwt.mjs';
import { createTokenProvider } from '../plugins/teams-chat/channel/token.mjs';
import {
  createTeamsWorker, validateConfig, renderCard, renderControls, stripMentions, parseSubmit, chatIdOf, splitConversationId,
  interactionIdOf, NOTICE, teamsFileHostOk,
} from '../plugins/teams-chat/channel/worker.mjs';
import { checkRows } from './helpers/rows.mjs';
import { isValidIncoming } from '../src/core/chat/channel-protocol.mjs';

const APP_ID = 'app-1234';
const SERVICE_URL = 'https://smba.trafficmanager.net/emea/';

// ── self-minted RS256 infrastructure ─────────────────────────────────────────

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: rogueKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'kid-1', use: 'sig', alg: 'RS256' };

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mint({ kid = 'kid-1', alg = 'RS256', key = privateKey, ...claims } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'https://api.botframework.com', aud: APP_ID,
    exp: nowSec + 600, nbf: nowSec - 60, serviceurl: SERVICE_URL,
    ...claims,
  };
  const signed = `${b64url(JSON.stringify({ typ: 'JWT', alg, kid }))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(signed).sign(key);
  return `${signed}.${b64url(sig)}`;
}

const jwksFetch = async (url) => {
  if (url.includes('openidconfiguration')) return { ok: true, status: 200, json: async () => ({ jwks_uri: 'https://login.test/keys' }) };
  if (url.includes('/keys')) return { ok: true, status: 200, json: async () => ({ keys: [JWK] }) };
  throw new Error(`unexpected ${url}`);
};

test('JWT matrix: valid accepted; iss/aud/exp/sig/serviceUrl/kid, missing exp and string exp all rejected (fail closed)', async () => {
  await checkRows([
    { name: 'JWT matrix: valid accepted; iss/aud/exp/sig/serviceUrl/kid rejected', run: async () => {
      const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch });
      assert.equal((await v.validate(`Bearer ${mint()}`, SERVICE_URL)).ok, true);
      const cases = [
        [`Bearer ${mint({ iss: 'https://evil.example' })}`, SERVICE_URL, /bad issuer/],
        [`Bearer ${mint({ aud: 'other-app' })}`, SERVICE_URL, /bad audience/],
        [`Bearer ${mint({ exp: Math.floor(Date.now() / 1000) - 1000 })}`, SERVICE_URL, /expired/],
        [`Bearer ${mint({ nbf: Math.floor(Date.now() / 1000) + 1000 })}`, SERVICE_URL, /not yet valid/],
        [`Bearer ${mint({ key: rogueKey })}`, SERVICE_URL, /bad signature/],
        [`Bearer ${mint()}`, 'https://spoofed.example/', /serviceUrl mismatch/],
        [`Bearer ${mint({ kid: 'kid-unknown' })}`, SERVICE_URL, /unknown signing key/],
        [`Bearer ${mint({ alg: 'none' })}`, SERVICE_URL, /unexpected alg|bad signature|malformed/],
        ['', SERVICE_URL, /missing bearer/],
        ['Bearer not.a.jwt', SERVICE_URL, /malformed/],
      ];
      for (const [header, svc, re] of cases) {
        const out = await v.validate(header, svc);
        assert.equal(out.ok, false, String(re));
        assert.match(out.reason, re);
      }
      assert.ok(decodeJwt(mint()));
    } },
    { name: 'a signed token WITHOUT exp is rejected (fail closed)', run: async () => {
      const token = mint({ exp: undefined }); // JSON.stringify drops the key entirely
      assert.equal(decodeJwt(token).payload.exp, undefined, 'fixture guard: token really has no exp');
      const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch });
      const r = await v.validate(`Bearer ${token}`, SERVICE_URL);
      assert.equal(r.ok, false);
      assert.match(r.reason, /exp/);
    } },
    { name: 'a string exp is rejected', run: async () => {
      const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch });
      const r = await v.validate(`Bearer ${mint({ exp: 'never' })}`, SERVICE_URL);
      assert.equal(r.ok, false);
    } },
  ]);
});

test('a JWKS outage with no cache yields ok:false (→401), not an escaped throw', async () => {
  const v = createJwtValidator({ appId: APP_ID, fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
  const r = await v.validate(`Bearer ${mint({})}`, SERVICE_URL);
  assert.equal(r.ok, false);
  assert.match(r.reason, /jwks unavailable/i);
});

test('a JWKS outage with a warm cache serves stale keys (bounded)', async () => {
  let clock = Date.now();
  let up = true;
  const v = createJwtValidator({
    appId: APP_ID,
    now: () => clock,
    fetchFn: (u) => (up ? jwksFetch(u) : Promise.reject(new Error('ECONNREFUSED'))),
  });
  assert.equal((await v.validate(`Bearer ${mint({})}`, SERVICE_URL)).ok, true); // warms the cache
  up = false;
  clock += 25 * 60 * 60 * 1000; // past JWKS_TTL_MS → forced refetch → outage
  const sec = Math.floor(clock / 1000);
  const fresh = mint({ exp: sec + 600, nbf: sec - 60 }); // re-mint against the advanced clock
  assert.equal((await v.validate(`Bearer ${fresh}`, SERVICE_URL)).ok, true, 'stale cache still validates');
});

function fakeCtx(config = {}) {
  const state = new Map();
  const events = { inbound: [], status: [], logs: [], interactions: [] };
  return {
    ctx: {
      apiVersion: 2, platform: 'teams', mock: false,
      config: { appId: APP_ID, appPassword: 'sekret', tenantType: 'multi-tenant', ingressToken: 'ing', ...config },
      state: {
        get: async (k) => (state.has(k) ? state.get(k) : null),
        set: async (k, v) => { state.set(k, v); },
      },
      log: (l, m) => events.logs.push(`${l}:${m}`),
      emitMessage: (m) => events.inbound.push(m),
      emitInteraction: (e) => events.interactions.push(e),
      setStatus: (s, d) => events.status.push({ state: s, detail: d ?? null }),
      shutdownSignal: new AbortController().signal,
    },
    state, events,
  };
}

const ACTIVITY = (over = {}) => ({
  type: 'message', id: 'act-1', text: '<at>worca</at> /status',
  serviceUrl: SERVICE_URL,
  channelId: 'msteams',
  conversation: { id: 'conv-1', conversationType: 'personal' },
  from: { id: '29:user1', name: 'Sam', aadObjectId: 'aad-1' },
  recipient: { id: `28:${APP_ID}` },
  channelData: { tenant: { id: 'tenant-1' } },
  ...over,
});

const frame = (activity, auth = `Bearer ${mint()}`) => ({
  headers: { authorization: auth },
  bodyB64: Buffer.from(JSON.stringify(activity)).toString('base64'),
});

function tokenRoutes({ tokenCalls = { n: 0 }, post = () => ({ status: 200, body: { id: 'sent' } }) } = {}) {
  const posts = [];
  return {
    posts, tokenCalls,
    fetchFn: async (url, opts) => {
      if (url.includes('login.microsoftonline.com')) {
        tokenCalls.n++;
        return { ok: true, status: 200, json: async () => ({ access_token: `tok-${tokenCalls.n}`, expires_in: 3600 }) };
      }
      if (url.includes('openidconfiguration') || url.includes('/keys')) return jwksFetch(url);
      if (url.includes('/v3/conversations/')) {
        posts.push({ url, method: opts.method, body: JSON.parse(opts.body), auth: opts.headers.Authorization, signal: opts.signal });
        const out = post(posts.length, posts[posts.length - 1]);
        return {
          ok: out.status >= 200 && out.status < 300, status: out.status,
          headers: { get: (k) => (out.headers || {})[k.toLowerCase()] ?? null },
          json: async () => out.body ?? {},
        };
      }
      throw new Error(`unexpected ${url}`);
    },
  };
}

test('inbound webhook: JWT gate (401), conversation capture, dedupe, mention stripping', async () => {
  const { ctx, state, events } = fakeCtx();
  const r = tokenRoutes();
  const w = createTeamsWorker(ctx, { fetchFn: r.fetchFn, _sleep: async () => {} });

  assert.equal((await w.handleWebhook(frame(ACTIVITY(), 'Bearer garbage'))).statusCode, 401);
  assert.equal(events.inbound.length, 0);
  assert.ok(events.logs.some((l) => /rejected inbound activity/.test(l)));

  assert.equal((await w.handleWebhook(frame(ACTIVITY()))).statusCode, 200);
  assert.deepEqual(events.inbound[0], {
    chatId: 'conv-1', userId: 'aad-1', text: '/status',
    meta: { platform: 'teams', activityId: 'act-1', messageId: 'act-1', serviceUrl: SERVICE_URL, tenantId: 'tenant-1', name: 'Sam', replyToId: 'act-1', isGroup: false, mentionsBot: false },
  });
  const conv = state.get('conversations')['conv-1'];
  assert.equal(conv.serviceUrl, SERVICE_URL);
  assert.equal(conv.user.aadObjectId, 'aad-1');
  assert.equal(conv.isGroup, false);

  // Bot Framework redelivery: same activity.id -> 200 but NOT re-emitted
  assert.equal((await w.handleWebhook(frame(ACTIVITY()))).statusCode, 200);
  assert.equal(events.inbound.length, 1);

  // conversationUpdate feeds the store but never emits
  await w.handleWebhook(frame(ACTIVITY({ type: 'conversationUpdate', id: 'act-2', conversation: { id: 'conv-2', isGroup: true } })));
  assert.equal(events.inbound.length, 1);
  assert.equal(state.get('conversations')['conv-2'].isGroup, true);

  // Unparseable body -> 400 (parsing precedes the JWT check because the
  // serviceUrl claim is verified against the parsed activity).
  assert.equal((await w.handleWebhook({ headers: {}, bodyB64: 'bm90anNvbg==' })).statusCode, 400);
});

test('G18: only a "personal" Teams conversation is 1:1; a group chat, a channel or an unknown type is a group', async () => {
  const { ctx, events } = fakeCtx();
  const r = tokenRoutes();
  const w = createTeamsWorker(ctx, { fetchFn: r.fetchFn, _sleep: async () => {} });
  const types = ['groupChat', 'channel', undefined, 'personal'];
  for (const [i, conversationType] of types.entries()) {
    await w.handleWebhook(frame(ACTIVITY({ id: `act-g${i}`, conversation: { id: `conv-g${i}`, ...(conversationType ? { conversationType } : {}) } })));
  }
  assert.deepEqual(events.inbound.map((e) => e.meta.isGroup), [true, true, true, false]);
});

test('send: seen conversations only; AdaptiveCard payload; AAD token cached + 401 refresh', async () => {
  const { ctx } = fakeCtx();
  const r = tokenRoutes();
  const w = createTeamsWorker(ctx, { fetchFn: r.fetchFn, _sleep: async () => {} });
  await w.handleWebhook(frame(ACTIVITY()));

  await assert.rejects(w.send('conv-unknown', { title: 't', body: [], severity: 'info' }),
    (e) => e.kind === 'plugin' && /message the bot once/.test(e.message));

  const msg = { title: 'Run done', body: [{ kind: 'markdown', value: '**bold** [pr](https://x)' }], severity: 'success' };
  await w.send('conv-1', msg);
  await w.send('conv-1', msg);
  assert.equal(r.tokenCalls.n, 1, 'AAD token cached across sends');
  assert.match(r.posts[0].url, /smba\.trafficmanager\.net\/emea\/v3\/conversations\/conv-1\/activities$/);
  const card = r.posts[0].body.attachments[0];
  assert.equal(card.contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(card.content.version, '1.2');
  assert.match(card.content.body[0].text, /✅ Run done/);
  assert.match(card.content.body[1].text, /bold pr \(https:\/\/x\)/);

  // one forced refresh on 401, then typed auth error
  const r2 = tokenRoutes({ post: () => ({ status: 401 }) });
  const w2 = createTeamsWorker(fakeCtx().ctx, { fetchFn: r2.fetchFn, _sleep: async () => {} });
  await w2.handleWebhook(frame(ACTIVITY()));
  await assert.rejects(w2.send('conv-1', msg), (e) => e.kind === 'auth');
  assert.ok(r2.tokenCalls.n >= 2, '401 forced a token refresh before failing');
});

test('mock mode skips JWT only; start reports outbound credential state', async () => {
  const { ctx, events } = fakeCtx();
  ctx.mock = true;
  const r = tokenRoutes();
  const w = createTeamsWorker(ctx, { fetchFn: r.fetchFn, _sleep: async () => {} });
  assert.equal((await w.handleWebhook(frame(ACTIVITY(), 'Bearer garbage'))).statusCode, 200, 'mock skips JWT validation');

  const info = await w.start();
  assert.equal(info.identity, APP_ID);
  assert.ok(events.status.some((s) => s.state === 'connected'));

  const bad = createTeamsWorker(fakeCtx().ctx, {
    fetchFn: async (url) => (url.includes('login.microsoftonline.com')
      ? { ok: false, status: 401, json: async () => ({ error: 'invalid_client' }) }
      : jwksFetch(url)),
  });
  await bad.start(); // status disconnected, no throw
});

// ── conversation store: bounded + serialized ─────────────────────────────────

/** A worker whose host state round-trips through JSON (as the real protocol
 *  frames do) and whose clock is monotonic, so eviction order is deterministic
 *  and a read-modify-write race is observable instead of hidden behind a
 *  shared object reference. */
function convFixture() {
  const { ctx, state, events } = fakeCtx();
  ctx.mock = true; // skip the JWT gate — these tests are about the store
  const hostGet = ctx.state.get;
  ctx.state.get = async (k) => {
    const v = await hostGet(k);
    await Promise.resolve(); // the real host answers across an async gap
    return v == null ? v : JSON.parse(JSON.stringify(v));
  };
  let clock = Date.UTC(2026, 0, 1);
  const routes = tokenRoutes();
  const worker = createTeamsWorker(ctx, {
    fetchFn: routes.fetchFn,
    _sleep: async () => {},
    now: () => (clock += 1000),
  });
  return { worker, state, events, routes };
}

let actSeq = 0;
// handleWebhook dedupes on activity.id before the store is touched.
const webhookFor = (a) => frame({ ...a, id: `act-${++actSeq}` }, 'Bearer mock');

test('conversation store caps at 200, evicting oldest lastSeen (LRU, not insertion order)', async () => {
  const { worker, state } = convFixture();
  for (let i = 0; i < 200; i++) {
    await worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: `c${i}` } })));
  }
  // Re-see c0 BEFORE overflowing: a correct LRU keeps it and evicts c1 instead.
  await worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: 'c0' } })));
  for (let i = 200; i < 205; i++) {
    await worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: `c${i}` } })));
  }
  const all = state.get('conversations');
  assert.equal(Object.keys(all).length, 200);
  assert.ok(all.c0, 're-seen conversation survives');
  assert.equal(all.c1, undefined, 'least-recently-SEEN evicted, not first-inserted');
  assert.ok(all.c204);
});

test('concurrent inbound activities do not lose conversation refs (RMW serialized)', async () => {
  const { worker, state } = convFixture();
  await Promise.all([
    worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: 'x' } }))),
    worker.handleWebhook(webhookFor(ACTIVITY({ conversation: { id: 'y' } }))),
  ]);
  const all = state.get('conversations');
  assert.ok(all.x && all.y, `lost a ref: ${JSON.stringify(Object.keys(all))}`);
});

test('helpers: stripMentions, renderCard severity icons; validateConfig field pinning', async () => {
  assert.equal(stripMentions('<at>worca bot</at> /status now'), '/status now');
  assert.equal(stripMentions('plain'), 'plain');
  assert.match(renderCard({ title: 'Boom', body: [], severity: 'error' }).content.body[0].text, /🔴 Boom/);

  const missing = await validateConfig({ tenantType: 'single-tenant' });
  assert.deepEqual(missing.errors.map((e) => e.field), ['appId', 'appPassword', 'tenantId', 'ingressToken']);

  const authFail = await validateConfig(
    { appId: APP_ID, appPassword: 'wrong', ingressToken: 'i' },
    { fetchFn: async () => ({ ok: false, status: 401, json: async () => ({ error_description: 'AADSTS7000215 invalid secret' }) }) },
  );
  assert.equal(authFail.errors[0].field, 'appPassword');
  assert.match(authFail.errors[0].message, /AADSTS7000215/);

  const ok = await validateConfig(
    { appId: APP_ID, appPassword: 'right', ingressToken: 'i' },
    { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) }) },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.identity, APP_ID);
});

// ── v0.3 interactive: freeform chat in channel reply chains ─────────────────

const CHANNEL = '19:0a1b2c3d4e5f60718293a4b5c6d7e8f9@thread.tacv2';
const ROOT = '1700000000001';
const THREAD = `${CHANNEL};messageid=${ROOT}`;   // 72 chars: longer than the protocol's old 64-char chat id cap
const REF = 'AbCdEfGhIjKlMnOpQrStUvWx';
const BOT_AT = { type: 'mention', mentioned: { id: `28:${APP_ID}`, name: 'worca' }, text: '<at>worca</at>' };
const CHANNEL_POST = (over = {}) => ACTIVITY({
  id: ROOT, text: '<at>worca</at> plan the\n  release', entities: [BOT_AT],
  conversation: { id: THREAD, conversationType: 'channel', isGroup: true }, ...over,
});
const INVOKE = (data, over = {}) => ACTIVITY({
  type: 'invoke', name: 'adaptiveCard/action', id: `f:${Math.random().toString(36).slice(2)}`, text: undefined,
  conversation: { id: THREAD, conversationType: 'channel', isGroup: true }, replyToId: 'hdr-1',
  value: { action: { type: 'Action.Execute', verb: 'worca', data } }, ...over,
});
const bodyOf = (res) => JSON.parse(Buffer.from(res.bodyB64, 'base64').toString('utf8'));
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error('timed out'); await tick(2); }
}

/** A worker that has seen one channel post (and the personal chat conv-1). */
async function channelWorker(opts = {}, routes = tokenRoutes()) {
  const f = fakeCtx();
  const w = createTeamsWorker(f.ctx, { fetchFn: routes.fetchFn, _sleep: async () => {}, ...opts });
  assert.equal((await w.handleWebhook(frame(CHANNEL_POST()))).statusCode, 200);
  assert.equal((await w.handleWebhook(frame(ACTIVITY({ id: 'act-p' })))).statusCode, 200);
  return { w, routes, ...f };
}

test('channel posts: a top-level post is the channel, a reply is its chain; only a top-level channel post that mentions THIS bot starts freeform', async () => {
  const { w, events, state } = await channelWorker();
  const [post] = events.inbound;
  assert.equal(post.chatId, CHANNEL);
  assert.equal(post.text, 'plan the\nrelease', 'the bot mention goes, line breaks stay');
  assert.equal(post.meta.mentionsBot, true);
  assert.equal(post.meta.messageId, ROOT);
  assert.equal(post.meta.isGroup, true);

  // A reply in the chain (it must @mention the bot to be delivered at all): the chain, never a new start.
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000009', replyToId: ROOT,
    text: '<at>worca</at> and ask <at>Ada</at>', entities: [BOT_AT, { type: 'mention', mentioned: { id: '29:ada' }, text: '<at>Ada</at>' }] })));
  const reply = events.inbound.at(-1);
  assert.equal(reply.chatId, THREAD);
  assert.equal(reply.text, 'and ask Ada', "another person's mention keeps their name");
  assert.equal(reply.meta.mentionsBot, false);

  // Only someone else mentioned; a group chat; a personal chat: no freeform start.
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000002', conversation: { id: `${CHANNEL};messageid=1700000000002`, conversationType: 'channel' },
    text: '<at>Ada</at> hi', entities: [{ type: 'mention', mentioned: { id: '29:ada' }, text: '<at>Ada</at>' }] })));
  assert.equal(events.inbound.at(-1).meta.mentionsBot, false);
  await w.handleWebhook(frame(ACTIVITY({ id: 'act-g', entities: [BOT_AT], conversation: { id: '19:g@thread.v2', conversationType: 'groupChat' } })));
  assert.deepEqual([events.inbound.at(-1).chatId, events.inbound.at(-1).meta.mentionsBot], ['19:g@thread.v2', false]);
  assert.equal(events.inbound.find((m) => m.meta.messageId === 'act-p').meta.mentionsBot, false);

  // One stored reference per channel, not per post.
  const all = state.get('conversations');
  assert.equal(all[CHANNEL].conversationType, 'channel');
  assert.equal(all[THREAD], undefined);

  // Bots are ignored: this bot itself and any sender marked as a bot.
  const n = events.inbound.length;
  await w.handleWebhook(frame(ACTIVITY({ id: 'act-b1', from: { id: `28:${APP_ID}`, name: 'worca' } })));
  await w.handleWebhook(frame(ACTIVITY({ id: 'act-b2', from: { id: '28:other', role: 'bot' } })));
  assert.equal(events.inbound.length, n);

  assert.deepEqual(splitConversationId(THREAD), { base: CHANNEL, root: ROOT });
  assert.equal(chatIdOf({ type: 'invoke', id: ROOT, conversation: { id: THREAD } }), THREAD, 'only a message can be the root post');
  assert.equal(stripMentions('<at>worca bot</at> /status now'), '/status now', 'no mention entities: every <at> tag goes (v0.2)');
});

test('renderControls: buttons and links in ActionSets of 5, a select is a ChoiceSet + Choose, a modal button is inline Input.Text + submit; nothing is required', () => {
  const ref = (n) => REF.slice(0, 20) + String(n).padStart(4, '0');
  const proposal = [
    { kind: 'button', ref: ref(1), label: 'Start run', style: 'success' },
    { kind: 'button', ref: ref(2), label: 'Not now', style: 'secondary' },
    { kind: 'button', ref: ref(3), label: 'Request changes', style: 'secondary',
      modal: { title: 'Request changes', fields: [{ id: 'text', label: 'What should change?', style: 'paragraph', required: true, maxLength: 2000 }] } },
    { kind: 'link', label: 'Open in worca', url: 'https://worca.example/#chat/ask_1' },
  ];
  const els = renderControls(proposal);
  assert.deepEqual(els.map((e) => e.type), ['ActionSet', 'Container', 'ActionSet']);
  assert.deepEqual(els[0].actions.map((a) => [a.type, a.title, a.data['w-ref'], a.data['w-kind'], a.associatedInputs, a.style ?? null]), [
    ['Action.Execute', 'Start run', ref(1), 'button', 'none', 'positive'],
    ['Action.Execute', 'Not now', ref(2), 'button', 'none', null],
  ]);
  const [input, submit] = els[1].items;
  assert.deepEqual([input.type, input.id, input.label, input.isMultiline, input.maxLength], ['Input.Text', 'w2-text', 'What should change?', true, 2000]);
  assert.deepEqual([submit.actions[0].title, submit.actions[0].data, submit.actions[0].associatedInputs],
    ['Request changes', { 'w-ref': ref(3), 'w-kind': 'modal', 'w-ix': 2 }, 'auto']);
  assert.deepEqual(els[2].actions[0], { type: 'Action.OpenUrl', title: 'Open in worca', url: 'https://worca.example/#chat/ask_1' });
  // Older Teams clients without Universal Actions render the Action.Submit fallback: same data, same inputs.
  const start = els[0].actions[0];
  assert.deepEqual(start.fallback, { type: 'Action.Submit', title: 'Start run', data: start.data, associatedInputs: 'none', style: 'positive' });
  assert.equal(submit.actions[0].fallback.associatedInputs, 'auto');
  assert.equal(JSON.stringify(els).includes('isRequired'), false);

  const header = renderControls([
    { kind: 'select', ref: ref(4), placeholder: 'Scope: No project', options: [{ value: 'none', label: 'No project' }, { value: 'p:web', label: 'web', description: 'the site' }] },
    { kind: 'button', ref: ref(5), label: 'Stop', style: 'danger' },
  ]);
  assert.deepEqual(header[0], { type: 'Input.ChoiceSet', id: 'w0-choice', style: 'compact', placeholder: 'Scope: No project',
    choices: [{ title: 'No project', value: 'none' }, { title: 'web — the site', value: 'p:web' }] });
  assert.deepEqual([header[1].actions[0].title, header[1].actions[0].data['w-kind'], header[1].actions[0].associatedInputs], ['Choose', 'select', 'auto']);
  assert.equal(header[2].actions[0].style, 'destructive');

  const six = renderControls(Array.from({ length: 6 }, (_, i) => ({ kind: 'button', ref: ref(10 + i), label: `B${i}`, style: 'primary' })));
  assert.deepEqual(six.map((s) => s.actions.length), [5, 1]);
  assert.equal(renderCard({ title: null, body: [], severity: 'info', controls: proposal }).content.version, '1.5');
  assert.equal(renderCard({ title: null, body: [], severity: 'info' }).content.version, '1.2');
});

test('parseSubmit + interactionIdOf: only our data becomes an interaction; inputs map back to values and fields', () => {
  assert.deepEqual(parseSubmit({ 'w-ref': REF, 'w-kind': 'button', 'w-ix': 3, other: 'x' }), { ref: REF, kind: 'button' });
  assert.deepEqual(parseSubmit({ 'w-ref': REF, 'w-kind': 'select', 'w-ix': 0, 'w0-choice': 'p:web' }), { ref: REF, kind: 'select', values: ['p:web'] });
  assert.deepEqual(parseSubmit({ 'w-ref': REF, 'w-kind': 'select', 'w-ix': 0 }), { ref: REF, kind: 'select', values: [] });
  assert.deepEqual(parseSubmit({ 'w-ref': REF, 'w-kind': 'modal', 'w-ix': 2, 'w2-text': 'x'.repeat(5000), 'w1-text': 'other card part', 'w2-Bad': 'no' }),
    { ref: REF, kind: 'modal', fields: { text: 'x'.repeat(4000) } });
  for (const bad of [null, [], {}, { 'w-ref': 'short', 'w-kind': 'button', 'w-ix': 0 }, { 'w-ref': REF, 'w-kind': 'link', 'w-ix': 0 },
    { 'w-ref': REF, 'w-kind': 'button', 'w-ix': 10 }, { 'w-ref': REF, 'w-kind': 'button', 'w-ix': '1' }]) {
    assert.equal(parseSubmit(bad), null, JSON.stringify(bad));
  }
  assert.equal(interactionIdOf('f:abc'), 'f:abc');
  const long = interactionIdOf('x'.repeat(65));
  assert.match(long, /^h:[0-9a-f]{40}$/);
  assert.equal(interactionIdOf('x'.repeat(65)), long, 'stable across redeliveries');
});

test('invoke: the JWT gates every invoke; Action.Execute emits one interaction and the held answer is the host notice; replays never emit twice', async () => {
  const { w, events, routes } = await channelWorker({ invokeHoldMs: 5000 });
  const inv = INVOKE({ 'w-ref': REF, 'w-kind': 'button', 'w-ix': 1 });

  assert.equal((await w.handleWebhook(frame(inv, 'Bearer garbage'))).statusCode, 401);
  assert.equal((await w.handleWebhook(frame({ ...inv, id: 'f:nojwt' }, ''))).statusCode, 401);
  assert.equal(events.interactions.length, 0);

  const pending = w.handleWebhook(frame(inv));
  await until(() => events.interactions.length === 1);
  assert.deepEqual(events.interactions[0], { id: inv.id, chatId: THREAD, userId: 'aad-1', ref: REF, kind: 'button',
    meta: { platform: 'teams', messageId: 'hdr-1', name: 'Sam' } });
  const before = routes.posts.length;
  await w.replyInteraction(inv.id, 'Only <@aad-1> can act on this conversation.');
  const res = await pending;
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/json');
  assert.deepEqual(bodyOf(res), { statusCode: 200, type: 'application/vnd.microsoft.activity.message', value: 'Only Sam can act on this conversation.' });
  assert.equal(routes.posts.length, before, 'a held notice is the invoke answer, not a post');

  const again = await w.handleWebhook(frame(inv));
  assert.equal(bodyOf(again).value, NOTICE.received);
  assert.equal(events.interactions.length, 1, 'a redelivered invoke is not emitted again');
  await assert.rejects(w.replyInteraction(inv.id, 'twice'), /interaction expired/);

  const foreign = await w.handleWebhook(frame(INVOKE({ 'w-ref': REF, 'w-kind': 'button', 'w-ix': 1 }, {
    value: { action: { type: 'Action.Execute', verb: 'someone-else', data: { 'w-ref': REF, 'w-kind': 'button', 'w-ix': 1 } } } })));
  assert.equal(bodyOf(foreign).value, NOTICE.stale);
  const nothingPicked = await w.handleWebhook(frame(INVOKE({ 'w-ref': REF, 'w-kind': 'select', 'w-ix': 0 })));
  assert.equal(bodyOf(nothingPicked).value, NOTICE.pickFirst);
  assert.deepEqual(await w.handleWebhook(frame(INVOKE({}, { name: 'task/fetch' }))), { statusCode: 200 });
  assert.equal(events.interactions.length, 1);

  const picked = w.handleWebhook(frame(INVOKE({ 'w-ref': REF, 'w-kind': 'select', 'w-ix': 0, 'w0-choice': 'p:web' })));
  await until(() => events.interactions.length === 2);
  assert.deepEqual([events.interactions[1].kind, events.interactions[1].values], ['select', ['p:web']]);
  await w.replyInteraction(events.interactions[1].id, 'Scope: web');
  assert.equal(bodyOf(await picked).value, 'Scope: web');
});

test('invoke: a notice later than the hold is posted in the reply chain; an Action.Submit message is an interaction whose notice is posted', async () => {
  const { w, events, routes } = await channelWorker({ invokeHoldMs: 10 });
  const inv = INVOKE({ 'w-ref': REF, 'w-kind': 'button', 'w-ix': 0 });
  const res = await w.handleWebhook(frame(inv));
  assert.equal(bodyOf(res).value, NOTICE.received, 'the hold ran out: answered without the notice');
  await w.replyInteraction(inv.id, 'Done — the message will update shortly.');
  const post = routes.posts.at(-1);
  assert.ok(post.url.endsWith(`/v3/conversations/${encodeURIComponent(THREAD)}/activities`));
  assert.deepEqual([post.method, post.body.type, post.body.textFormat, post.body.text], ['POST', 'message', 'plain', 'Done — the message will update shortly.']);

  const submit = ACTIVITY({ id: 'act-sub', text: undefined, conversation: { id: THREAD, conversationType: 'channel' }, replyToId: 'card-9',
    value: { 'w-ref': REF, 'w-kind': 'modal', 'w-ix': 2, 'w2-text': 'make it smaller' } });
  const n = events.inbound.length;
  const r = await w.handleWebhook(frame(submit));
  assert.deepEqual(r, { statusCode: 200 });
  assert.equal(events.inbound.length, n, 'a submit is not a chat message');
  assert.deepEqual(events.interactions.at(-1), { id: 'act-sub', chatId: THREAD, userId: 'aad-1', ref: REF, kind: 'modal',
    fields: { text: 'make it smaller' }, meta: { platform: 'teams', messageId: 'card-9', name: 'Sam' } });
  await w.replyInteraction('act-sub', 'Sent your change request. The proposal stays open.');
  assert.equal(routes.posts.at(-1).body.text, 'Sent your change request. The proposal stays open.');
  await assert.rejects(w.replyInteraction('never-seen', 'x'), /interaction expired/);
});

test('send: a thread posts into the post reply chain and returns its id; edit PUTs the card; refusals are permanent, 5xx transient; long text splits', async () => {
  let answer = () => ({ status: 200, body: { id: 'sent' } });
  const routes = tokenRoutes({ post: (_n, req) => answer(req) });
  const { w } = await channelWorker({}, routes);
  const msg = (controls) => ({ title: null, severity: 'info', body: [{ kind: 'markdown', value: '**worca chat** · scope: **No project**' }], ...(controls ? { controls } : {}) });

  const head = await w.send(CHANNEL, msg(), { thread: { fromMessageId: ROOT, name: 'worca chat' } });
  assert.deepEqual(head, { ok: true, chunks: 1, messageIds: ['sent'], threadId: THREAD });
  assert.ok(routes.posts.at(-1).url.endsWith(`/v3/conversations/${encodeURIComponent(THREAD)}/activities`));
  assert.equal(routes.posts.at(-1).body.conversation.id, THREAD);
  await w.send(THREAD, msg());   // a reply chain uses its channel's stored reference
  assert.ok(routes.posts.at(-1).url.endsWith(`/v3/conversations/${encodeURIComponent(THREAD)}/activities`));

  // After a scope pick the header has no New conversation: the edit replaces every control.
  const edited = await w.send(THREAD, msg([{ kind: 'button', ref: REF, label: 'Stop', style: 'danger' }]), { edit: { messageId: 'hdr-1' } });
  assert.deepEqual(edited, { ok: true, messageIds: ['hdr-1'] });
  const put = routes.posts.at(-1);
  assert.equal(put.method, 'PUT');
  assert.ok(put.url.endsWith(`/v3/conversations/${encodeURIComponent(THREAD)}/activities/hdr-1`));
  assert.equal(put.body.id, 'hdr-1');
  const card = put.body.attachments[0].content;
  assert.equal(card.version, '1.5');
  assert.deepEqual(card.body.filter((e) => e.type === 'ActionSet').flatMap((s) => s.actions.map((a) => a.title)), ['Stop']);

  for (const [status, re, permanent] of [[404, /not found/, true], [403, /forbidden/, true], [400, /failed/, true], [503, /unavailable/, undefined]]) {
    answer = () => ({ status, body: { error: { message: 'nope' } } });
    await assert.rejects(w.send(THREAD, msg(), { edit: { messageId: 'hdr-1' } }), (e) => re.test(e.message) && e.permanent === permanent
      && e.kind === (status >= 500 ? 'network' : 'plugin'), String(status));
  }
  answer = () => ({ status: 200, body: { id: 'sent' } });
  await assert.rejects(w.send('conv-1', msg(), { thread: { fromMessageId: 'act-p', name: 'x' } }), (e) => e.permanent === true && /channels only/.test(e.message));
  await assert.rejects(w.send('19:unseen@thread.v2', msg()), (e) => e.permanent === true && /message the bot once/.test(e.message));

  let k = 0;
  answer = () => ({ status: 200, body: { id: `m${++k}` } });
  const long = await w.send(THREAD, { title: 'Reply', severity: 'info', body: [{ kind: 'text', value: 'y'.repeat(13000) }],
    controls: [{ kind: 'button', ref: REF, label: 'Start run', style: 'success' }] });
  assert.deepEqual([long.chunks, long.messageIds], [3, ['m1', 'm2', 'm3']]);
  const cards = routes.posts.slice(-3).map((p) => p.body.attachments[0].content);
  assert.deepEqual(cards.map((c) => c.body.some((e) => e.type === 'ActionSet')), [false, false, true], 'controls only on the last card');
  assert.deepEqual(cards.map((c) => c.body[0].weight === 'Bolder'), [true, false, false], 'the title only on the first card');
});

test('react: ⏳ on repeats a typing activity in a personal chat until ⏳ off; channels and other marks send nothing; a refused typing never throws', async () => {
  let status = 200;
  const routes = tokenRoutes({ post: () => ({ status, body: {} }) });
  const { w, events } = await channelWorker({ typingEveryMs: 10 }, routes);
  const typings = () => routes.posts.filter((p) => p.body.type === 'typing').length;

  assert.deepEqual(await w.react('conv-1', 'act-p', '⏳', true), { ok: true });
  assert.equal(typings(), 1);
  assert.ok(routes.posts.at(-1).url.endsWith('/v3/conversations/conv-1/activities'));
  await until(() => typings() >= 3);
  await w.react('conv-1', 'act-p', '⏳', false);
  const stopped = typings();
  await tick(40);
  assert.equal(typings(), stopped, '⏳ off stops the indicator');

  for (const [chat, emoji] of [['conv-1', '✅'], ['conv-1', '❌'], [CHANNEL, '⏳'], [THREAD, '⏳'], ['19:unseen@thread.v2', '⏳']]) {
    assert.deepEqual(await w.react(chat, 'm', emoji, true), { ok: true });
  }
  assert.equal(typings(), stopped, 'no typing in channels, for unknown chats or for final marks');

  status = 403;
  assert.deepEqual(await w.react('conv-1', 'act-q', '⏳', true), { ok: true });
  assert.deepEqual(await w.react('conv-1', 'act-r', '⏳', true), { ok: true });
  assert.equal(events.logs.filter((l) => /typing indicator failed/.test(l)).length, 1, 'logged once per error text');

  status = 200;
  await w.react('conv-1', 'act-s', '⏳', true);
  await w.stop();
  const atStop = typings();
  await tick(40);
  assert.equal(typings(), atStop, 'stop() ends every indicator');
});

test('bounded outages: a 429 is waited out for a send but thrown back for a notice or a typing post; every request has a timeout', async () => {
  let answer = () => ({ status: 200, body: { id: 'sent' } });
  const routes = tokenRoutes({ post: (_n, req) => answer(req) });
  const sleeps = [];
  const { w, events } = await channelWorker({ invokeHoldMs: 10, _sleep: async (ms) => { sleeps.push(ms); } }, routes);
  const msg = { title: null, severity: 'info', body: [{ kind: 'text', value: 'hi' }] };
  const limited = { status: 429, headers: { 'retry-after': '7' } };

  // send: the ladder sleeps Retry-After, then posts.
  let calls = 0;
  answer = () => (++calls === 1 ? limited : { status: 200, body: { id: 'after-wait' } });
  assert.deepEqual((await w.send(THREAD, msg)).messageIds, ['after-wait']);
  assert.deepEqual(sleeps, [7000]);

  // A late notice (it runs inside the host's replyInteraction RPC): one request, a rate-limit error, no wait.
  answer = () => ({ status: 200, body: { id: 'sent' } });
  const inv = INVOKE({ 'w-ref': REF, 'w-kind': 'button', 'w-ix': 0 });
  assert.equal(bodyOf(await w.handleWebhook(frame(inv))).value, NOTICE.received);
  answer = () => limited;
  let before = routes.posts.length;
  await assert.rejects(w.replyInteraction(inv.id, 'late notice'), (e) => e.kind === 'rate-limit' && e.retryAfterMs === 7000);
  assert.equal(routes.posts.length, before + 1);
  assert.deepEqual(sleeps, [7000], 'a notice never waits out the 429 ladder');

  // A typing post: one request, logged, no wait, no indicator left running.
  before = routes.posts.length;
  assert.deepEqual(await w.react('conv-1', 'act-p', '⏳', true), { ok: true });
  assert.equal(routes.posts.length, before + 1);
  assert.deepEqual(sleeps, [7000]);
  assert.ok(events.logs.some((l) => /typing indicator failed: Teams rate limit/.test(l)));

  assert.ok(routes.posts.length > 3);
  assert.ok(routes.posts.every((p) => p.signal instanceof AbortSignal), 'every Bot Framework request carries a timeout signal');
});

test('typing stops on its own after TYPING_MAX_MS, and after a refused repeat', async () => {
  let offset = 0;
  let status = 200;
  const routes = tokenRoutes({ post: () => ({ status, body: {} }) });
  const { w } = await channelWorker({ typingEveryMs: 10, now: () => Date.now() + offset }, routes);
  const typings = () => routes.posts.filter((p) => p.body.type === 'typing').length;

  await w.react('conv-1', 'act-p', '⏳', true);
  await until(() => typings() >= 2);
  offset = 10 * 60 * 1000 + 1000;   // a ⏳ that never got its "off"
  await tick(30);
  const capped = typings();
  await tick(50);
  assert.equal(typings(), capped, 'no typing after 10 minutes');
  offset = 0;

  await w.react('conv-1', 'act-q', '⏳', true);
  await until(() => typings() >= capped + 2);
  status = 403;
  const n = routes.posts.length;
  await until(() => routes.posts.length > n);
  await tick(30);
  const refused = routes.posts.length;
  await tick(50);
  assert.equal(routes.posts.length, refused, 'a refused repeat stops the indicator');
  await w.stop();
});

test('held invokes and notices: stop() answers a held invoke at once; a notice past its TTL is not posted; a long edit posts its tail', async () => {
  let offset = 0;
  const routes = tokenRoutes();
  const { w, events } = await channelWorker({ invokeHoldMs: 30000, now: () => Date.now() + offset }, routes);
  const held = w.handleWebhook(frame(INVOKE({ 'w-ref': REF, 'w-kind': 'button', 'w-ix': 0 })));
  await until(() => events.interactions.length === 1);
  await w.stop();
  const res = await Promise.race([held, tick(500).then(() => 'still held')]);
  assert.notEqual(res, 'still held', 'stop() answers a held invoke');
  assert.equal(bodyOf(res).value, NOTICE.received);

  const late = createTeamsWorker(fakeCtx().ctx, { fetchFn: routes.fetchFn, _sleep: async () => {}, invokeHoldMs: 10, now: () => Date.now() + offset });
  await late.handleWebhook(frame(CHANNEL_POST({ id: '1700000000077', conversation: { id: `${CHANNEL};messageid=1700000000077`, conversationType: 'channel' } })));
  const inv = INVOKE({ 'w-ref': REF, 'w-kind': 'button', 'w-ix': 0 });
  await late.handleWebhook(frame(inv));
  offset = 15 * 60 * 1000;
  const before = routes.posts.length;
  await assert.rejects(late.replyInteraction(inv.id, 'too late'), /interaction expired/);
  assert.equal(routes.posts.length, before, 'an expired notice is not posted');
  offset = 0;

  // A live status edit carries the WHOLE reply: the first chunk updates the card, the rest follows as new posts in the
  // same reply chain, and the controls ride the last one.
  const from = routes.posts.length;
  const long = 'x'.repeat(6000) + 'y'.repeat(6000) + 'z'.repeat(1000);
  const r = await w.send(THREAD, { title: null, severity: 'info', body: [{ kind: 'text', value: long }],
    controls: [{ kind: 'button', ref: REF, label: 'Stop', style: 'danger' }] }, { edit: { messageId: 'hdr-1' } });
  const sent = routes.posts.slice(from);
  assert.deepEqual(sent.map((p) => p.method), ['PUT', 'POST', 'POST']);
  assert.ok(sent.slice(1).every((p) => p.url.endsWith(`/v3/conversations/${encodeURIComponent(THREAD)}/activities`)), 'the rest goes to the same chat');
  const blocks = sent.map((p) => p.body.attachments[0].content.body);
  assert.equal(blocks.map((b) => b.find((x) => x.type === 'TextBlock').text).join(''), long, 'nothing of the reply is lost');
  assert.deepEqual(blocks.map((b) => b.some((x) => x.type !== 'TextBlock')), [false, false, true], 'the controls ride the last chunk');
  assert.equal(r.messageIds.length, 3);
  assert.equal(r.messageIds[0], 'hdr-1');
});

test('upgrade from v0.2.0: a channel reference stored under its post id still sends, is a channel, and is re-keyed to the channel', async () => {
  const OLD = `${CHANNEL};messageid=1700000000111`;
  const oldRef = (over = {}) => ({ serviceUrl: SERVICE_URL, tenantId: 'tenant-1', channelId: 'msteams', botId: `28:${APP_ID}`,
    user: { id: '29:user1', name: 'Sam', aadObjectId: 'aad-1' }, isGroup: true, lastSeen: '2026-10-01T00:00:00.000Z', ...over });
  const routes = tokenRoutes();
  const f = fakeCtx();
  f.ctx.mock = true;
  f.state.set('conversations', { [OLD]: oldRef() });
  const w = createTeamsWorker(f.ctx, { fetchFn: routes.fetchFn, _sleep: async () => {}, typingEveryMs: 10 });
  const msg = { title: null, severity: 'info', body: [{ kind: 'text', value: 'run done' }] };

  await w.send(OLD, msg);   // Notify conversation IDs still holding the v0.2.0 id
  assert.ok(routes.posts.at(-1).url.endsWith(`/v3/conversations/${encodeURIComponent(OLD)}/activities`));
  await w.send(CHANNEL, msg);
  assert.ok(routes.posts.at(-1).url.endsWith(`/v3/conversations/${encodeURIComponent(CHANNEL)}/activities`));
  assert.equal((await w.send(CHANNEL, msg, { thread: { fromMessageId: ROOT, name: 'worca chat' } })).threadId, THREAD, 'the old reference is a channel');
  const n = routes.posts.length;
  await w.react(OLD, 'm', '⏳', true);
  await tick(30);
  assert.equal(routes.posts.length, n, 'no typing into a channel');

  await w.handleWebhook(frame(ACTIVITY({ id: 'act-up' })));
  const all = f.state.get('conversations');
  assert.equal(all[OLD], undefined);
  assert.equal(all[CHANNEL].conversationType, 'channel');

  // A newer channel reference wins over an old post's one.
  const g = fakeCtx();
  g.state.set('conversations', { [OLD]: oldRef({ serviceUrl: 'https://old.example/' }),
    [CHANNEL]: oldRef({ conversationType: 'channel', lastSeen: '2026-11-01T00:00:00.000Z' }) });
  const w2 = createTeamsWorker(g.ctx, { fetchFn: routes.fetchFn, _sleep: async () => {} });
  await w2.send(OLD, msg);
  assert.ok(routes.posts.at(-1).url.startsWith(SERVICE_URL));
  // ... and a newer post reference wins over an older channel one (v0.2.0 stored a team's conversationUpdate there).
  const h = fakeCtx();
  h.state.set('conversations', { [OLD]: oldRef({ lastSeen: '2026-11-01T00:00:00.000Z' }),
    [CHANNEL]: oldRef({ serviceUrl: 'https://old.example/', lastSeen: '2026-09-01T00:00:00.000Z' }) });
  await createTeamsWorker(h.ctx, { fetchFn: routes.fetchFn, _sleep: async () => {} }).send(CHANNEL, msg);
  assert.ok(routes.posts.at(-1).url.startsWith(SERVICE_URL));
});

test('manifest + README: interactive, freeform settings, documented Teams limits', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(await readFile(new URL('../plugins/teams-chat/worca-cc-plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version, '0.4.0');
  const ch = manifest.chatChannels[0];
  assert.deepEqual(ch.capabilities, { inbound: true, outbound: true, interactive: true, liveStatus: true });
  assert.equal('attachmentHosts' in ch, false, 'Teams files go through the worker, never the host URL path');
  const keys = ch.configSchema.map((f) => f.key);
  for (const k of ['freeformChat', 'chatMembers', 'worcaUrl']) assert.ok(keys.includes(k), k);
  assert.equal(keys.includes('historyOnStart'), false, 'Teams has no channel history');
  assert.equal(ch.configSchema.find((f) => f.key === 'freeformChat').default, 'off');
  const readme = await readFile(new URL('../plugins/teams-chat/README.md', import.meta.url), 'utf8');
  assert.match(readme, /@mention the bot in every reply/);
  assert.match(readme, /cannot add reactions/);
  assert.match(readme, /"supportsFiles": false/);
  assert.match(readme, /\*\*Upgrading from 0\.2\.\*\*/);
  assert.match(readme, /SharePoint/);
  assert.match(readme, /no channel history/i);
});

// ── 0.4.0: files, typing and live status ────────────────────────────────────

const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const IMG_URL = 'https://smba.trafficmanager.net/emea/v3/attachments/0-weu-d1-abc/views/original';
function filesRoutes(base, img) {
  const seen = [];
  return { seen, fetchFn: async (url, opts = {}) => {
    if (url.includes('/v3/attachments/') || url.includes('.asm.skype.com') || url.includes('evil.example.com')) {
      seen.push({ url, auth: opts.headers?.Authorization ?? null, redirect: opts.redirect ?? null });
      return img(url, opts);
    }
    return base.fetchFn(url, opts);
  } };
}

test('inbound files: inline images become refs, SharePoint files are listed with a note, html bodies and cards are not files; no attachments key without files', async () => {
  const { ctx, events } = fakeCtx();
  const r = tokenRoutes();
  const w = createTeamsWorker(ctx, { fetchFn: r.fetchFn, _sleep: async () => {} });
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000002', attachments: [
    { contentType: 'image/png', contentUrl: IMG_URL },
    { contentType: 'image/*', contentUrl: 'https://us-api.asm.skype.com/v1/objects/0-x/views/imgo' },
    { contentType: 'image/png', contentUrl: 'https://evil.example.com/x.png' },
    { contentType: 'application/vnd.microsoft.teams.file.download.info', name: 'report.docx', content: { downloadUrl: 'https://tenant.sharepoint.com/x' } },
    { contentType: 'reference', name: 'deck.pptx', contentUrl: 'https://tenant.sharepoint.com/sites/x/deck.pptx' },
    { contentType: 'text/html', content: '<div>hi</div>' },
  ] })));
  const m = events.inbound.at(-1);
  assert.deepEqual(m.attachments.map(({ ref, ...a }) => a), [
    { name: 'image-1.png', contentType: 'image/png', size: 0 },
    { name: 'image-2.png', contentType: null, size: 0 },
    { name: 'image-3.png', contentType: null, size: 0, unavailable: 'an image on a host worca does not send the bot\'s token to' },
    { name: 'report.docx', contentType: null, size: 0, unavailable: 'a SharePoint or OneDrive file link: open it in Teams (worca does not download SharePoint files)' },
    { name: 'deck.pptx', contentType: null, size: 0, unavailable: 'a SharePoint or OneDrive file link: open it in Teams (worca does not download SharePoint files)' },
  ]);
  assert.match(m.attachments[0].ref, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(m.replyTo, undefined, 'Teams carries no replied-to content: nothing is quoted');
  assert.equal(isValidIncoming(m), true);
  // meta.serviceUrl is smba.trafficmanager.net itself: look for the file URLs, not the host
  for (const leak of ['/v3/attachments/', 'asm.skype.com', 'evil.example.com', 'sharepoint.com']) assert.ok(!JSON.stringify(m).includes(leak), `no file URL leaves the worker (${leak})`);
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000003' })));
  assert.equal('attachments' in events.inbound.at(-1), false);
});

test('fetchFile: the Bot Framework token goes only to the vouched hosts, with no redirects; 403 permanent; over the cap tooBig; no token in an error', async () => {
  const { ctx, events } = fakeCtx();
  let mode = 'ok';
  const routes = filesRoutes(tokenRoutes(), () => {
    if (mode === '403') return new Response('', { status: 403 });
    if (mode === 'boom') throw new TypeError('fetch failed');
    return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
  });
  const w = createTeamsWorker(ctx, { fetchFn: routes.fetchFn, _sleep: async () => {} });
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000002', attachments: [{ contentType: 'image/png', contentUrl: IMG_URL }] })));
  const ref = events.inbound.at(-1).attachments[0].ref;
  const got = await w.fetchFile(ref, { maxBytes: 1000 });
  assert.deepEqual([Buffer.compare(got.data, PNG_BYTES), got.contentType], [0, 'image/png']);
  assert.deepEqual(routes.seen, [{ url: IMG_URL, auth: 'Bearer tok-1', redirect: 'error' }]);
  await assert.rejects(w.fetchFile(ref, { maxBytes: 4 }), (e) => e.tooBig === true);
  for (const [m, permanent] of [['403', true], ['boom', false]]) {
    mode = m;
    await assert.rejects(w.fetchFile(ref, { maxBytes: 1000 }), (e) => (e.permanent === true) === permanent && !e.message.includes('tok-1') && !e.message.includes('trafficmanager'), m);
  }
  await assert.rejects(w.fetchFile('Z'.repeat(24), { maxBytes: 10 }), (e) => e.permanent === true && /expired/.test(e.message));
});

test('typing(): a typing activity repeated in a personal chat until stopped; a channel sends nothing; an unseen chat is refused', async () => {
  const routes = tokenRoutes();
  const { w } = await channelWorker({ typingEveryMs: 20 }, routes);
  const typings = () => routes.posts.filter((p) => p.body.type === 'typing');
  assert.deepEqual(await w.typing(THREAD, true), { ok: true });
  assert.deepEqual(await w.typing(CHANNEL, true), { ok: true });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(typings().length, 0, 'Teams shows no bot typing in channels: nothing is sent');
  assert.deepEqual(await w.typing('conv-1', true), { ok: true });          // channelWorker has seen the personal conv-1
  await until(() => typings().length >= 2);
  assert.ok(typings().every((p) => p.url.includes(encodeURIComponent('conv-1'))));
  assert.deepEqual(await w.typing('conv-1', false), { ok: true });
  const n = typings().length;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(typings().length, n, 'stopped');
  await assert.rejects(w.typing('conv-never', true), (e) => e.permanent === true);
});

test('live status: a status edit spends one bounded 429 budget, then throws back; a deleted status message is permanent', async () => {
  let mode = 'limit';
  const routes = tokenRoutes({ post: () => (mode === 'limit' ? { status: 429, headers: { 'retry-after': '5' } } : { status: 404 }) });
  const sleeps = [];
  const { w } = await channelWorker({ _sleep: async (ms) => { sleeps.push(ms); } }, routes);
  await assert.rejects(w.send(THREAD, { title: null, severity: 'info', body: [{ kind: 'text', value: '⏳ Working on it…' }] }, { edit: { messageId: 'st-1' } }),
    (e) => e.kind === 'rate-limit' && e.retryAfterMs === 5000);
  assert.ok(sleeps.reduce((a, b) => a + b, 0) <= 10000, `${sleeps}`);
  mode = 'gone';
  await assert.rejects(w.send(THREAD, { title: null, severity: 'info', body: [{ kind: 'text', value: 'x' }] }, { edit: { messageId: 'st-1' } }), (e) => e.permanent === true);
});

test('file hosts: https on the vouched hosts only (no userinfo, no port); the JWT-vouched serviceUrl host counts; 10 files at most; any SharePoint URL is listed; a refused first typing post starts no repeat', async () => {
  const GCC = 'https://smba.infra.gcc.teams.microsoft.com/teams/';
  const gccUrl = `${GCC}v3/attachments/0-gcc-d1-abc/views/original`;
  for (const [url, svc, ok] of [
    [IMG_URL, SERVICE_URL, true],
    ['https://us-api.asm.skype.com/v1/objects/0-x/views/imgo', SERVICE_URL, true],
    [gccUrl, GCC, true],
    [gccUrl, SERVICE_URL, false],
    ['http://smba.trafficmanager.net/emea/v3/attachments/a/views/original', SERVICE_URL, false],
    ['https://user:pw@smba.trafficmanager.net/emea/v3/attachments/a/views/original', SERVICE_URL, false],
    ['https://smba.trafficmanager.net:8443/emea/v3/attachments/a/views/original', SERVICE_URL, false],
    ['https://asm.skype.com.evil.example/x.png', SERVICE_URL, false],
    ['https://evilasm.skype.com/x.png', SERVICE_URL, false],
    ['not a url', SERVICE_URL, false],
  ]) assert.equal(teamsFileHostOk(url, svc), ok, `${url} on ${svc}`);

  const { ctx, events } = fakeCtx();
  const w = createTeamsWorker(ctx, { fetchFn: tokenRoutes().fetchFn, _sleep: async () => {} });
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000004', serviceUrl: GCC, attachments: [{ contentType: 'image/png', contentUrl: gccUrl }] }),
    `Bearer ${mint({ serviceurl: GCC })}`));
  assert.match(events.inbound.at(-1).attachments[0].ref ?? '', /^[A-Za-z0-9_-]{24}$/, 'an image on the JWT-vouched serviceUrl host is a ref');
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000005', attachments: Array.from({ length: 12 }, (_, i) => ({ contentType: 'image/png', contentUrl: IMG_URL.replace('-abc/', `-abc${i}/`) })) })));
  assert.equal(events.inbound.at(-1).attachments.length, 10);
  assert.equal(isValidIncoming(events.inbound.at(-1)), true);
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000006', attachments: [{ contentType: 'application/pdf', name: 'spec.pdf', contentUrl: 'https://tenant-my.sharepoint.com/personal/x/spec.pdf' }] })));
  assert.deepEqual(events.inbound.at(-1).attachments, [{ name: 'spec.pdf', contentType: null, size: 0,
    unavailable: 'a SharePoint or OneDrive file link: open it in Teams (worca does not download SharePoint files)' }]);

  const routes = tokenRoutes({ post: () => ({ status: 403, body: {} }) });
  const { w: w2 } = await channelWorker({ typingEveryMs: 10 }, routes);
  const typings = () => routes.posts.filter((p) => p.body.type === 'typing').length;
  assert.deepEqual(await w2.typing('conv-1', true), { ok: true });
  await tick(50);
  assert.equal(typings(), 1, 'a refused first typing post starts no repeat');
  await w2.stop();
});

test('inbound files: an image pasted into a channel post may arrive only as <img> in the text/html body; it becomes a ref once (deduplicated with an image attachment); other <img> hosts are skipped', async () => {
  const { ctx, events } = fakeCtx();
  const r = tokenRoutes();
  const w = createTeamsWorker(ctx, { fetchFn: r.fetchFn, _sleep: async () => {} });
  const AMS = 'https://us-api.asm.skype.com/v1/objects/0-wus-d2-abc/views/imgo';
  const html = (src) => ({ contentType: 'text/html', content: `<div><p>look</p><img alt="image" src="${src}" itemtype="http://schema.skype.com/AMSImage"><img src="https://statics.teams.cdn.office.net/evergreen-assets/emoji/smile.png"></div>` });
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000004', attachments: [html(AMS)] })));
  const only = events.inbound.at(-1);
  assert.deepEqual(only.attachments.map(({ ref, ...a }) => a), [{ name: 'image-1.png', contentType: null, size: 0 }], 'the emoji on another host is not a file');
  assert.match(only.attachments[0].ref, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(isValidIncoming(only), true);
  await w.handleWebhook(frame(CHANNEL_POST({ id: '1700000000005', attachments: [{ contentType: 'image/*', contentUrl: AMS }, html(AMS)] })));
  assert.equal(events.inbound.at(-1).attachments.length, 1, 'one image sent both ways is one file');
  assert.ok(!JSON.stringify(events.inbound.slice(-2)).includes('asm.skype.com'), 'no file URL leaves the worker');
});
