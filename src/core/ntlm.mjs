// src/core/ntlm.mjs — NTLMv2 for proxy authentication (MS-NLMP), dependency-free.
//
// Node's OpenSSL 3 has no MD4 (crypto.createHash('md4') throws), so the NT hash uses the
// RFC 1320 implementation below; HMAC-MD5 comes from node:crypto. Only what a proxy client
// needs: NEGOTIATE (Type 1), CHALLENGE (Type 2) parsing, AUTHENTICATE (Type 3) with an NTLMv2
// response. No signing, sealing or key exchange (no KEY_EXCH, no MIC).
import { createHmac, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';

export class NtlmError extends Error {}

export const NTLM_FLAGS = Object.freeze({
  UNICODE: 0x00000001, OEM: 0x00000002, REQUEST_TARGET: 0x00000004, NTLM: 0x00000200,
  ALWAYS_SIGN: 0x00008000, EXTENDED_SESSIONSECURITY: 0x00080000, TARGET_INFO: 0x00800000,
  N128: 0x20000000, N56: 0x80000000,
});
const F = NTLM_FLAGS;
export const TYPE1_FLAGS = (F.UNICODE | F.OEM | F.REQUEST_TARGET | F.NTLM | F.ALWAYS_SIGN
  | F.EXTENDED_SESSIONSECURITY | F.N128 | F.N56) >>> 0;

export const AV = Object.freeze({ EOL: 0, NB_COMPUTER: 1, NB_DOMAIN: 2, DNS_COMPUTER: 3, DNS_DOMAIN: 4, DNS_TREE: 5, FLAGS: 6, TIMESTAMP: 7 });
const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1');

/** RFC 1320 MD4. */
export function md4(input) {
  const msg = Buffer.from(input);
  const total = (((msg.length + 8) >>> 6) + 1) << 6;
  const buf = Buffer.alloc(total);
  msg.copy(buf);
  buf[msg.length] = 0x80;
  const bits = msg.length * 8;
  buf.writeUInt32LE(bits >>> 0, total - 8);
  buf.writeUInt32LE(Math.floor(bits / 0x100000000) >>> 0, total - 4);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  const f = (x, y, z) => (x & y) | (~x & z);
  const g = (x, y, z) => (x & y) | (x & z) | (y & z);
  const h = (x, y, z) => x ^ y ^ z;
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const X = new Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = buf.readUInt32LE(off + i * 4);
    const aa = a, bb = b, cc = c, dd = d;
    for (const i of [0, 4, 8, 12]) {
      a = rotl((a + f(b, c, d) + X[i]) | 0, 3);
      d = rotl((d + f(a, b, c) + X[i + 1]) | 0, 7);
      c = rotl((c + f(d, a, b) + X[i + 2]) | 0, 11);
      b = rotl((b + f(c, d, a) + X[i + 3]) | 0, 19);
    }
    for (const i of [0, 1, 2, 3]) {
      a = rotl((a + g(b, c, d) + X[i] + 0x5a827999) | 0, 3);
      d = rotl((d + g(a, b, c) + X[i + 4] + 0x5a827999) | 0, 5);
      c = rotl((c + g(d, a, b) + X[i + 8] + 0x5a827999) | 0, 9);
      b = rotl((b + g(c, d, a) + X[i + 12] + 0x5a827999) | 0, 13);
    }
    for (const i of [0, 2, 1, 3]) {
      a = rotl((a + h(b, c, d) + X[i] + 0x6ed9eba1) | 0, 3);
      d = rotl((d + h(a, b, c) + X[i + 8] + 0x6ed9eba1) | 0, 9);
      c = rotl((c + h(d, a, b) + X[i + 4] + 0x6ed9eba1) | 0, 11);
      b = rotl((b + h(c, d, a) + X[i + 12] + 0x6ed9eba1) | 0, 15);
    }
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0;
  }
  const out = Buffer.alloc(16);
  out.writeInt32LE(a, 0); out.writeInt32LE(b, 4); out.writeInt32LE(c, 8); out.writeInt32LE(d, 12);
  return out;
}

/** NTOWFv1: MD4 of the UTF-16LE password. This is the value worca keeps, never the password. */
export const ntHash = (password) => md4(Buffer.from(String(password), 'utf16le'));

/** NTOWFv2 = HMAC-MD5(NT hash, UTF-16LE(UPPER(user) + domain)). */
export function ntowfv2(hash, user, domain) {
  return createHmac('md5', hash).update(Buffer.from(String(user).toUpperCase() + String(domain ?? ''), 'utf16le')).digest();
}

/** Windows FILETIME (100 ns since 1601-01-01) as 8 little-endian bytes. */
export function filetime(ms = Date.now()) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n);
  return b;
}

/** NEGOTIATE_MESSAGE: no domain, no workstation (both buffers empty at offset 32). */
export function type1Message() {
  const b = Buffer.alloc(32);
  SIGNATURE.copy(b, 0);
  b.writeUInt32LE(1, 8);
  b.writeUInt32LE(TYPE1_FLAGS, 12);
  b.writeUInt32LE(32, 20);
  b.writeUInt32LE(32, 28);
  return b;
}

export function parseAvPairs(buf) {
  const out = [];
  let i = 0;
  while (i + 4 <= buf.length) {
    const id = buf.readUInt16LE(i);
    const len = buf.readUInt16LE(i + 2);
    if (i + 4 + len > buf.length) throw new NtlmError('NTLM target info is truncated');
    if (id === AV.EOL) break;
    out.push({ id, value: Buffer.from(buf.subarray(i + 4, i + 4 + len)) });
    i += 4 + len;
  }
  return out;
}

/** CHALLENGE_MESSAGE from a Buffer or the base64 token of `Proxy-Authenticate: NTLM <token>`. */
export function parseType2(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'base64');
  if (b.length < 32 || !b.subarray(0, 8).equals(SIGNATURE) || b.readUInt32LE(8) !== 2) {
    throw new NtlmError('not an NTLM challenge (Type 2) message');
  }
  const flags = b.readUInt32LE(20);
  const challenge = Buffer.from(b.subarray(24, 32));
  let targetInfo = Buffer.alloc(0);
  if (b.length >= 48) {
    const len = b.readUInt16LE(40);
    const off = b.readUInt32LE(44);
    if (len && off + len > b.length) throw new NtlmError('NTLM challenge has a target info field outside the message');
    if (len) targetInfo = Buffer.from(b.subarray(off, off + len));
  }
  return { flags, challenge, targetInfo, avPairs: parseAvPairs(targetInfo) };
}

/** The NTLMv2 responses (MS-NLMP §3.3.2) for one challenge. */
export function ntlmv2Response({ ntowf, serverChallenge, clientChallenge, timestamp, targetInfo }) {
  const temp = Buffer.concat([Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]), timestamp, clientChallenge, Buffer.alloc(4), targetInfo, Buffer.alloc(4)]);
  const ntProofStr = createHmac('md5', ntowf).update(Buffer.concat([serverChallenge, temp])).digest();
  const lm = createHmac('md5', ntowf).update(Buffer.concat([serverChallenge, clientChallenge])).digest();
  return {
    ntProofStr,
    ntChallengeResponse: Buffer.concat([ntProofStr, temp]),
    lmChallengeResponse: Buffer.concat([lm, clientChallenge]),
    sessionBaseKey: createHmac('md5', ntowf).update(ntProofStr).digest(),
  };
}

/**
 * AUTHENTICATE_MESSAGE with an NTLMv2 response. `clientChallenge`, `timestampOverride` and `now`
 * exist for the test vectors; production passes none of them.
 */
export function type3Message({ ntHash: hash, user, domain = '', workstation = '', type2,
  clientChallenge = randomBytes(8), timestampOverride = null, now = Date.now() }) {
  const avTime = type2.avPairs.find((p) => p.id === AV.TIMESTAMP && p.value.length === 8);
  const timestamp = timestampOverride || (avTime ? avTime.value : filetime(now));
  const ntowf = ntowfv2(hash, user, domain);
  const r = ntlmv2Response({ ntowf, serverChallenge: type2.challenge, clientChallenge, timestamp, targetInfo: type2.targetInfo });
  const lm = avTime ? Buffer.alloc(24) : r.lmChallengeResponse;   // §3.1.5.1.2: Z(24) when the server sent a timestamp
  const unicode = (type2.flags & F.UNICODE) !== 0;
  const enc = (s) => Buffer.from(String(s), unicode ? 'utf16le' : 'latin1');
  const flags = (((TYPE1_FLAGS & type2.flags) | (unicode ? F.UNICODE : F.OEM)) & ~(unicode ? F.OEM : 0)) >>> 0;
  const fields = [lm, r.ntChallengeResponse, enc(domain), enc(user), enc(workstation), Buffer.alloc(0)];
  const head = Buffer.alloc(64);
  SIGNATURE.copy(head, 0);
  head.writeUInt32LE(3, 8);
  let off = head.length;
  fields.forEach((f, i) => {
    const at = 12 + i * 8;
    head.writeUInt16LE(f.length, at);
    head.writeUInt16LE(f.length, at + 2);
    head.writeUInt32LE(off, at + 4);
    off += f.length;
  });
  head.writeUInt32LE(flags, 60);
  return Buffer.concat([head, ...fields]);
}

/** Read back a Type 3 (the fake upstream in the tests verifies with it). */
export function parseType3(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'base64');
  if (b.length < 64 || !b.subarray(0, 8).equals(SIGNATURE) || b.readUInt32LE(8) !== 3) {
    throw new NtlmError('not an NTLM authenticate (Type 3) message');
  }
  const field = (i) => {
    const at = 12 + i * 8;
    const len = b.readUInt16LE(at);
    const off = b.readUInt32LE(at + 4);
    if (off + len > b.length) throw new NtlmError('NTLM authenticate has a field outside the message');
    return Buffer.from(b.subarray(off, off + len));
  };
  const flags = b.readUInt32LE(60);
  const text = (buf) => buf.toString(flags & F.UNICODE ? 'utf16le' : 'latin1');
  return {
    flags,
    lmChallengeResponse: field(0), ntChallengeResponse: field(1),
    domain: text(field(2)), user: text(field(3)), workstation: text(field(4)),
  };
}
