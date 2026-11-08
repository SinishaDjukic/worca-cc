// src/core/design/preview-grants.mjs
// The preview path tokens of a Design (P3, SPEC C-7): 256 random bits in base64url, each mapped to
// {designId, owner, expiresAt} in process memory. A grant lives 12 h, is dropped when its design is deleted
// (`revokeDesign`, passed to P2's DELETE as `dropGrants`) and is lost on restart, so the parent re-mints.
// Imports only node:crypto.

import { randomBytes } from 'node:crypto';

export const PREVIEW_TTL_MS = 43_200_000;
/** 32 bytes in base64url, no padding: always 43 characters. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * A Map keyed by token, so `__proto__` and `constructor` are plain keys; `check` tests TOKEN_RE before any lookup.
 * A grant is expired from `expiresAt` on (`now() >= expiresAt`). `check` drops the expired grant it meets, and every
 * `mint` sweeps all expired grants, so the map cannot grow without bound.
 * @param {{ now?: () => number, ttlMs?: number }} [opts]
 * @returns {{
 *   mint: (grant: { designId: string, owner: string|null }) => { token: string, expiresAt: number },
 *   check: (token: unknown) => { designId: string, owner: string|null, expiresAt: number } | null,
 *   revokeDesign: (designId: string) => number,
 *   size: () => number,
 * }}
 */
export function createPreviewGrants({ now = Date.now, ttlMs = PREVIEW_TTL_MS } = {}) {
  /** token -> { designId, owner, expiresAt } */
  const grants = new Map();

  return {
    mint({ designId, owner }) {
      const t = now();
      for (const [token, g] of grants) if (t >= g.expiresAt) grants.delete(token);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = t + ttlMs;
      grants.set(token, { designId, owner: owner ?? null, expiresAt });
      return { token, expiresAt };
    },
    check(token) {
      if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
      const g = grants.get(token);
      if (!g) return null;
      if (now() >= g.expiresAt) { grants.delete(token); return null; }
      return { designId: g.designId, owner: g.owner, expiresAt: g.expiresAt };
    },
    revokeDesign(designId) {
      let n = 0;
      for (const [token, g] of grants) if (g.designId === designId) { grants.delete(token); n += 1; }
      return n;
    },
    size() {
      return grants.size;
    },
  };
}

/** The process-wide grants: the mint route hands tokens out, the preview gate checks them. */
export const previewGrants = createPreviewGrants();
