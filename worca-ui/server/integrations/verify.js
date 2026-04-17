import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * @param {string|Buffer} rawBody
 * @param {string|null|undefined} sigHeader  — value of X-Worca-Signature header
 * @param {string[]} secrets                 — any-match set
 * @returns {boolean}
 */
export function verify(rawBody, sigHeader, secrets) {
  if (!sigHeader?.startsWith('sha256=')) return false;
  const received = Buffer.from(sigHeader.slice(7));
  for (const secret of secrets) {
    const expected = Buffer.from(
      createHmac('sha256', secret).update(rawBody).digest('hex'),
    );
    if (
      expected.length === received.length &&
      timingSafeEqual(expected, received)
    )
      return true;
  }
  return false;
}
