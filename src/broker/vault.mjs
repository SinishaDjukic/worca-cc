// src/broker/vault.mjs
// Credentials at rest (plans/credential-broker-design.html §6.5): AES-256-GCM with
// the operator's vault key, the (person, slot) pair bound in as additional data so a
// row copied to another person or slot fails to open. Pure apart from the key given.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Short fingerprint of a vault key: tells the broker a row was sealed with another key. */
export function keyId(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function aadFor(billTo, slot) {
  return Buffer.from(`${billTo}\n${slot}`, 'utf8');
}

/** @returns {{ciphertext: Buffer, iv: Buffer, tag: Buffer, keyId: string}} */
export function seal(key, plaintext, { billTo, slot }) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aadFor(billTo, slot));
  const ciphertext = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return { ciphertext, iv, tag: c.getAuthTag(), keyId: keyId(key) };
}

/** The plaintext, or throws (wrong key, tampered row, or row of another person/slot). */
export function open(key, { ciphertext, iv, tag }, { billTo, slot }) {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv));
  d.setAAD(aadFor(billTo, slot));
  d.setAuthTag(Buffer.from(tag));
  return Buffer.concat([d.update(Buffer.from(ciphertext)), d.final()]).toString('utf8');
}

/** The last 4 characters, shown as ••••xxxx. Never more. */
export function suffixOf(secret) {
  const s = String(secret || '');
  return s.length > 8 ? s.slice(-4) : '';
}
