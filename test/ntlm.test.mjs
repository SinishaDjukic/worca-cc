// test/ntlm.test.mjs — MD4 (RFC 1320 A.5) and NTLMv2 (MS-NLMP §4.2.4) vectors, and the Type 1/2/3 layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  md4, ntHash, ntowfv2, ntlmv2Response, type1Message, parseType2, type3Message, parseType3,
  parseAvPairs, NTLM_FLAGS, TYPE1_FLAGS, AV,
} from '../src/core/ntlm.mjs';

const hex = (b) => Buffer.from(b).toString('hex');
const H = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');

test('md4: RFC 1320 A.5 test suite', () => {
  const v = {
    '': '31d6cfe0d16ae931b73c59d7e0c089c0',
    a: 'bde52cb31de33e46245e05fbdbd6fb24',
    abc: 'a448017aaf21d8525fc10ae87aa6729d',
    'message digest': 'd9130a8164549fe818874806e1c7014b',
    abcdefghijklmnopqrstuvwxyz: 'd79e1c308aa5bbcdeea8ed63df412da9',
    ['1234567890'.repeat(8)]: 'e33b4ddc9c38f2199c3e7b164fcc0536',
  };
  for (const [msg, want] of Object.entries(v)) assert.equal(hex(md4(Buffer.from(msg, 'latin1'))), want, JSON.stringify(msg));
});

// MS-NLMP §4.2.4: User "User", UserDom "Domain", Passwd "Password", Time 0, ClientChallenge aa*8,
// ServerChallenge 0123456789abcdef, target info = MsvAvNbDomainName "Domain", MsvAvNbComputerName "Server", EOL.
const SERVER_CHALLENGE = H('0123456789abcdef');
const CLIENT_CHALLENGE = Buffer.alloc(8, 0xaa);
const TIME = Buffer.alloc(8);
const TARGET_INFO = H(`0200 0c00 44006f006d00610069006e00
                       0100 0c00 53006500720076006500720000000000`);

test('NTLMv2: MS-NLMP §4.2.4 NT hash, NTOWFv2, LMv2, NTProofStr, SessionBaseKey', () => {
  const nt = ntHash('Password');
  assert.equal(hex(nt), 'a4f49c406510bdcab6824ee7c30fd852');
  const ntowf = ntowfv2(nt, 'User', 'Domain');
  assert.equal(hex(ntowf), '0c868a403bfd7a93a3001ef22ef02e3f');
  const r = ntlmv2Response({ ntowf, serverChallenge: SERVER_CHALLENGE, clientChallenge: CLIENT_CHALLENGE, timestamp: TIME, targetInfo: TARGET_INFO });
  assert.equal(hex(r.lmChallengeResponse), '86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa');
  assert.equal(hex(r.ntProofStr), '68cd0ab851e51c96aabc927bebef6a1c');
  assert.equal(hex(r.sessionBaseKey), '8de40ccadbc14a82f15cb0ad0de95ca3');
  const temp = Buffer.concat([H('0101000000000000'), TIME, CLIENT_CHALLENGE, Buffer.alloc(4), TARGET_INFO, Buffer.alloc(4)]);
  assert.equal(hex(r.ntChallengeResponse), hex(Buffer.concat([r.ntProofStr, temp])));
});

function vectorType2(flags = 0xe28a8233) {
  const b = Buffer.alloc(48 + TARGET_INFO.length);
  Buffer.from('NTLMSSP\0', 'latin1').copy(b, 0);
  b.writeUInt32LE(2, 8);
  b.writeUInt32LE(48, 16);                 // empty TargetName at 48
  b.writeUInt32LE(flags >>> 0, 20);
  SERVER_CHALLENGE.copy(b, 24);
  b.writeUInt16LE(TARGET_INFO.length, 40); b.writeUInt16LE(TARGET_INFO.length, 42); b.writeUInt32LE(48, 44);
  TARGET_INFO.copy(b, 48);
  return b;
}

test('Type 1 asks for NTLM, Unicode and extended session security, with empty domain and workstation', () => {
  const t1 = type1Message();
  assert.equal(t1.length, 32);
  assert.equal(t1.subarray(0, 8).toString('latin1'), 'NTLMSSP\0');
  assert.equal(t1.readUInt32LE(8), 1);
  const f = t1.readUInt32LE(12);
  for (const k of ['UNICODE', 'NTLM', 'EXTENDED_SESSIONSECURITY', 'REQUEST_TARGET']) assert.ok(f & NTLM_FLAGS[k], k);
});

test('Type 2 parses the challenge and AV pairs; out-of-range offsets throw', () => {
  const t2 = parseType2(vectorType2().toString('base64'));
  assert.equal(hex(t2.challenge), '0123456789abcdef');
  assert.deepEqual(t2.avPairs.map((p) => [p.id, p.value.toString('utf16le')]), [[AV.NB_DOMAIN, 'Domain'], [AV.NB_COMPUTER, 'Server']]);
  const bad = vectorType2(); bad.writeUInt32LE(4000, 44);
  assert.throws(() => parseType2(bad), /outside the message/);
  assert.throws(() => parseType2(Buffer.from('nope')), /not an NTLM challenge/);
  assert.throws(() => parseAvPairs(H('0200ff00')), /truncated/);
});

test('Type 3 carries the vector responses at the offsets it declares (MS-NLMP §2.2.1.3 layout)', () => {
  const t3 = type3Message({ ntHash: ntHash('Password'), user: 'User', domain: 'Domain', workstation: 'COMPUTER',
    type2: parseType2(vectorType2()), clientChallenge: CLIENT_CHALLENGE, timestampOverride: TIME });
  const p = parseType3(t3);
  assert.equal(p.user, 'User'); assert.equal(p.domain, 'Domain'); assert.equal(p.workstation, 'COMPUTER');
  assert.equal(hex(p.lmChallengeResponse), '86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa');
  assert.equal(hex(p.ntChallengeResponse.subarray(0, 16)), '68cd0ab851e51c96aabc927bebef6a1c');
  assert.equal(p.flags, ((((TYPE1_FLAGS & 0xe28a8233) | NTLM_FLAGS.UNICODE) & ~NTLM_FLAGS.OEM) >>> 0));
  assert.equal(t3.readUInt32LE(60), p.flags);
});

test('a MsvAvTimestamp in the challenge is used as the time and the LM response is 24 zero bytes', () => {
  const ts = H('0090d336b734c301');
  const info = Buffer.concat([Buffer.from([7, 0, 8, 0]), ts, Buffer.alloc(4)]);
  const t2 = { flags: NTLM_FLAGS.UNICODE | NTLM_FLAGS.NTLM, challenge: SERVER_CHALLENGE, targetInfo: info, avPairs: parseAvPairs(info) };
  const p = parseType3(type3Message({ ntHash: ntHash('x'), user: 'u', domain: '', type2: t2 }));
  assert.equal(hex(p.lmChallengeResponse), '00'.repeat(24));
  assert.equal(hex(p.ntChallengeResponse.subarray(24, 32)), hex(ts));
});
