// test/teams-chat-worker.test.mjs — the teams-chat example plugin: JWT
// accept/reject matrix with self-minted RS256 tokens + a fake JWKS endpoint,
// conversation-reference capture, activity.id dedupe, mention stripping,
// proactive-send-to-seen-only, AAD token caching + 401 refresh, AdaptiveCard
// shape, validateConfig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { createJwtValidator, decodeJwt } from '../plugins/teams-chat/channel/jwt.mjs';
import { createTokenProvider } from '../plugins/teams-chat/channel/token.mjs';
import { createTeamsWorker, validateConfig, renderCard, stripMentions } from '../plugins/teams-chat/channel/worker.mjs';

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

test('JWT matrix: valid accepted; iss/aud/exp/sig/serviceUrl/kid rejected', async () => {
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
});

test('a signed token WITHOUT exp is rejected (fail closed)', async () => {
  const token = mint({ exp: undefined }); // JSON.stringify drops the key entirely
  assert.equal(decodeJwt(token).payload.exp, undefined, 'fixture guard: token really has no exp');
  const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch });
  const r = await v.validate(`Bearer ${token}`, SERVICE_URL);
  assert.equal(r.ok, false);
  assert.match(r.reason, /exp/);
});

test('a string exp is rejected', async () => {
  const v = createJwtValidator({ appId: APP_ID, fetchFn: jwksFetch });
  const r = await v.validate(`Bearer ${mint({ exp: 'never' })}`, SERVICE_URL);
  assert.equal(r.ok, false);
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
  const events = { inbound: [], status: [], logs: [] };
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
        posts.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
        const out = post(posts.length);
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
    meta: { platform: 'teams', activityId: 'act-1', serviceUrl: SERVICE_URL, tenantId: 'tenant-1', name: 'Sam', replyToId: 'act-1' },
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
