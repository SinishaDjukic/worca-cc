// src/broker/ui-server.mjs
// The key page (plans/credential-broker-design.html §5.6, §7.1): each person saves,
// tests and deletes their own credentials here, at the broker's own hostname, behind
// its own Access application. The broker checks the identity itself and never trusts
// worca for it. Keys can be written, never read back.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createAccessVerifier } from '../core/cf-access.mjs';
import { safeEqual, normalizeBillTo } from './tokens.mjs';
import { startOfUtcDay, startOfUtcMonth } from './limits.mjs';
import { startDeviceFlow, pollDeviceFlow, githubSecretOf } from './copilot.mjs';

const UI_DIR = fileURLToPath(new URL('./ui/', import.meta.url));
const STATIC = Object.freeze({
  '/': { file: 'page.html', type: 'text/html; charset=utf-8' },
  '/page.mjs': { file: 'page.mjs', type: 'text/javascript; charset=utf-8' },
  '/page.css': { file: 'page.css', type: 'text/css; charset=utf-8' },
});
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const CSRF_COOKIE = 'wb_csrf';

export function securityHeaders() {
  return {
    'content-security-policy': CSP,
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
  };
}

function send(res, status, body, type = 'application/json', extra = {}) {
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...securityHeaders(), 'content-type': type, 'content-length': Buffer.byteLength(s), ...extra });
  res.end(s);
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readJson(req, limit = 16 << 10) {
  return new Promise((resolveP, rejectP) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { rejectP(new Error('too large')); req.destroy(); return; } parts.push(c); });
    req.on('end', () => { try { resolveP(n ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch { rejectP(new Error('bad json')); } });
    req.on('error', rejectP);
  });
}

/** The identity resolver for the key page: Access JWT, a trusted header, or none. */
export function createIdentity(config, { fetchImpl } = {}) {
  const id = config.identity;
  if (id?.kind === 'access') {
    const verify = createAccessVerifier({ teamDomain: id.teamDomain, aud: id.aud, ...(fetchImpl ? { fetchImpl } : {}) });
    return async (req) => {
      const token = req.headers['cf-access-jwt-assertion'];
      if (typeof token !== 'string' || !token) return null;
      const who = await verify(token);
      return who?.email ? normalizeBillTo(who.email) : null;
    };
  }
  if (id?.kind === 'header') {
    return async (req) => {
      const v = req.headers[id.header];
      return normalizeBillTo(Array.isArray(v) ? v[0] : v);
    };
  }
  return async () => null;
}

/**
 * @param {{config:object, service:object, store:object, identity?:(req)=>Promise<string|null>, now?:()=>number, log?:Function}} o
 * @returns {(req, res) => void}
 */
export function createUiHandler({ config, service, store, identity = createIdentity(config), now = Date.now, log = () => {} }) {
  const staticCache = new Map();
  const readStatic = (entry) => {
    if (!staticCache.has(entry.file)) staticCache.set(entry.file, readFileSync(UI_DIR + entry.file, 'utf8'));
    return staticCache.get(entry.file);
  };
  const secureCookie = String(config.publicUrl || '').startsWith('https:') ? '; Secure' : '';
  const deviceFlows = new Map();   // "<email>|<slot>" -> {deviceCode, expiresAt}: in memory, per sign-in attempt

  function usageFor(email) {
    const t = now();
    const out = {};
    for (const s of service.slots) {
      out[s.id] = { todayUsd: store.spentSince(email, s.id, startOfUtcDay(t)), monthUsd: store.spentSince(email, s.id, startOfUtcMonth(t)) };
    }
    return out;
  }

  /** A state-changing request must come from the key page itself. */
  function csrfOk(req) {
    const origin = String(req.headers.origin || '');
    if (!config.publicUrl || origin !== config.publicUrl) return false;
    const c = cookies(req)[CSRF_COOKIE];
    const h = req.headers['x-worca-csrf'];
    return !!c && typeof h === 'string' && safeEqual(c, h);
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://keys');
    const p = url.pathname;
    if (req.method === 'GET' && p === '/healthz') { send(res, 200, { ok: true, version: config.version || null, mode: config.mode }); return; }

    let email;
    try { email = await identity(req); }
    catch { send(res, 503, { error: 'cannot verify the sign-in token right now' }); return; }
    if (!email) { send(res, 401, { error: 'unauthorized: sign in through the identity proxy' }); return; }

    if (req.method === 'GET' && STATIC[p]) { send(res, 200, readStatic(STATIC[p]), STATIC[p].type); return; }

    if (req.method === 'GET' && p === '/api/me') {
      let csrf = cookies(req)[CSRF_COOKIE];
      if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) csrf = randomBytes(32).toString('base64url');
      send(res, 200, {
        email, returnUrl: config.returnUrl, csrf,
        slots: service.slotStatus(email), usage: usageFor(email),
        defaults: { dailyUsd: config.defaultDailyUsd, monthlyUsd: config.defaultMonthlyUsd },
      }, 'application/json', { 'set-cookie': `${CSRF_COOKIE}=${csrf}; Path=/; HttpOnly; SameSite=Strict${secureCookie}` });
      return;
    }

    const m = /^\/api\/(slots|budget)\/([a-z][a-z0-9-]{1,31})(\/test|\/device|\/device\/poll)?$/.exec(p);
    if (!m) { send(res, 404, { error: 'not found' }); return; }
    if (!csrfOk(req)) { send(res, 403, { error: 'refused: this request did not come from the key page' }); return; }
    const [, kind, slotId, sub] = m;
    const test = sub === '/test';
    if (!service.slotById.has(slotId)) { send(res, 404, { error: 'unknown slot' }); return; }

    // GitHub device sign-in (Copilot): the broker runs the flow and keeps the resulting
    // GitHub token sealed; neither the page nor worca ever holds it.
    if (kind === 'slots' && (sub === '/device' || sub === '/device/poll') && req.method === 'POST') {
      const slot = service.slotById.get(slotId);
      if (slot.signIn !== 'github-device') { send(res, 404, { error: 'this credential has no sign-in flow' }); return; }
      const key = `${email}|${slotId}`;
      if (sub === '/device') {
        try {
          const f = await startDeviceFlow({ fetchImpl: service.fetchImpl, ...(slot.deviceBaseUrl ? { baseUrl: slot.deviceBaseUrl } : {}), ...(slot.clientId ? { clientId: slot.clientId, scope: slot.scope } : {}) });
          deviceFlows.set(key, { deviceCode: f.deviceCode, expiresAt: now() + f.expiresIn * 1000 });
          send(res, 200, { userCode: f.userCode, verificationUri: f.verificationUri, interval: f.interval, expiresIn: f.expiresIn });
        } catch (err) { send(res, 502, { error: err.message }); }
        return;
      }
      const flow = deviceFlows.get(key);
      if (!flow || flow.expiresAt < now()) { deviceFlows.delete(key); send(res, 410, { error: 'the sign-in code expired: start again' }); return; }
      let r;
      try { r = await pollDeviceFlow(flow.deviceCode, { fetchImpl: service.fetchImpl, ...(slot.deviceBaseUrl ? { baseUrl: slot.deviceBaseUrl } : {}), ...(slot.clientId ? { clientId: slot.clientId } : {}) }); }
      catch (err) { send(res, 502, { error: err.message }); return; }
      if (r.pending) { send(res, 200, { pending: true, slowDown: !!r.slowDown }); return; }
      deviceFlows.delete(key);
      if (r.error) { send(res, 422, { error: `GitHub sign-in failed: ${r.error}` }); return; }
      // A GitHub App user token comes with a refresh token: stored together, renewed by the broker.
      const saved = await service.saveCredential(email, slotId, slot.auth === 'github-user' ? githubSecretOf(r, now()) : r.token);
      if (!saved.ok) { send(res, saved.status || 422, { error: saved.error }); return; }
      send(res, 200, { state: 'set', suffix: saved.suffix, kind: saved.kind });
      return;
    }

    if (kind === 'slots' && req.method === 'PUT' && !test) {
      let body;
      try { body = await readJson(req); } catch { send(res, 400, { error: 'body must be JSON' }); return; }
      const r = await service.saveCredential(email, slotId, body.secret);
      if (!r.ok) { send(res, r.status || 422, { error: r.error }); return; }
      send(res, 200, { state: 'set', suffix: r.suffix, kind: r.kind });
      return;
    }
    if (kind === 'slots' && req.method === 'POST' && test) {
      const r = await service.testCredential(email, slotId);
      send(res, r.ok ? 200 : (r.status || 422), r.ok ? { ok: true } : { ok: false, error: r.error });
      return;
    }
    if (kind === 'slots' && req.method === 'DELETE' && !test) {
      service.deleteCredential(email, slotId);
      send(res, 200, { state: 'missing' });
      return;
    }
    if (kind === 'budget' && req.method === 'PUT' && !test) {
      let body;
      try { body = await readJson(req); } catch { send(res, 400, { error: 'body must be JSON' }); return; }
      const cap = (v, dflt, name) => {
        if (v === null || v === undefined || v === '') return { v: null };
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) return { err: `${name} must be a number of dollars` };
        if (dflt != null && n > dflt) return { err: `${name} can't be above the team limit of $${dflt}` };
        return { v: n };
      };
      const d = cap(body.dailyUsd, config.defaultDailyUsd, 'Daily cap');
      const mo = cap(body.monthlyUsd, config.defaultMonthlyUsd, 'Monthly cap');
      if (d.err || mo.err) { send(res, 422, { error: d.err || mo.err }); return; }
      const n = store.setCaps(email, slotId, { dailyUsd: d.v, monthlyUsd: mo.v });
      if (!n) { send(res, 404, { error: 'save a key first' }); return; }
      service.limits.invalidate(email, slotId);
      send(res, 200, { dailyUsd: d.v, monthlyUsd: mo.v });
      return;
    }
    send(res, 405, { error: 'method not allowed' });
  }

  return (req, res) => {
    handle(req, res).catch((err) => {
      log(`key page error: ${err && err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  };
}
