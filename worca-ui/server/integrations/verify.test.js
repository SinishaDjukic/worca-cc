import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verify } from './verify.js';

function sign(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

const BODY = 'hello world';
const SECRET = 'mysecret';

describe('verify', () => {
  it('returns true for a valid signature', () => {
    expect(verify(BODY, sign(BODY, SECRET), [SECRET])).toBe(true);
  });

  it('returns false for a bad signature', () => {
    expect(verify(BODY, sign(BODY, 'wrong'), [SECRET])).toBe(false);
  });

  it('returns false for a missing/null header', () => {
    expect(verify(BODY, null, [SECRET])).toBe(false);
    expect(verify(BODY, undefined, [SECRET])).toBe(false);
    expect(verify(BODY, '', [SECRET])).toBe(false);
  });

  it('returns false when header lacks sha256= prefix', () => {
    const raw = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verify(BODY, raw, [SECRET])).toBe(false);
  });

  it('returns true if any secret in the set matches (any-of-N)', () => {
    const secrets = ['s1', 's2', SECRET, 's4'];
    expect(verify(BODY, sign(BODY, SECRET), secrets)).toBe(true);
  });

  it('returns false if no secret in the set matches', () => {
    expect(verify(BODY, sign(BODY, SECRET), ['s1', 's2'])).toBe(false);
  });

  it('returns false for an empty secrets array', () => {
    expect(verify(BODY, sign(BODY, SECRET), [])).toBe(false);
  });
});
