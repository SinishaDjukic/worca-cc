// test/helpers/access-jwt.mjs
// A local stand-in for Cloudflare Access: an RSA key pair, its JWKS as the
// certs endpoint would serve it, and a signer for Cf-Access-Jwt-Assertion
// tokens. No network: `certsFetch` is a fetchImpl for createAccessVerifier.
import { generateKeyPairSync, sign } from 'node:crypto';

export const TEAM = 'acme.cloudflareaccess.com';
export const AUD = 'aud-worca-01';
export const CERTS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

export function makeAccessKey(kid = 'kid-1') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, jwk };
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Sign a token; `claims` override the valid defaults, `header` overrides alg/kid. */
export function signAccessJwt(key, claims = {}, header = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const p = b64({
    iss: `https://${TEAM}`, aud: [AUD], email: 'me@example.com', sub: 'user-1',
    iat: now, nbf: now, exp: now + 600, ...claims,
  });
  const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key.privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

/** fetchImpl serving `keysRef.keys` (mutable, for rotation) and counting calls. */
export function certsFetch(keysRef) {
  const f = async (url) => {
    f.calls += 1;
    if (String(url) !== CERTS_URL) return new Response('not found', { status: 404 });
    if (keysRef.down) return new Response('down', { status: 502 });
    return Response.json({ keys: keysRef.keys.map((k) => k.jwk) });
  };
  f.calls = 0;
  return f;
}
