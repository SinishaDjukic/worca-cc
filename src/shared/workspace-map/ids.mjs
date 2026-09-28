// src/shared/workspace-map/ids.mjs
// Stable ids for catalog entries, edges and manual edges (spec §5.5, §5.7, §5.9). FNV-1a 64-bit
// over the UTF-8 bytes, in BigInt, so the server and the browser compute the same id for the same
// input — and an id survives a code move (it hashes the member, kind and norm, never a line).

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** FNV-1a 64 over the UTF-8 encoding of `str` → 16 lowercase hex chars. */
export function hash64(str) {
  const bytes = new TextEncoder().encode(String(str ?? ''));
  let h = FNV_OFFSET;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK_64;
  }
  return h.toString(16).padStart(16, '0');
}

/** 'e_' + 10 hex: one provided thing of one member. */
export function entryId(member, kind, norm) {
  return 'e_' + hash64(`${member}|${kind}|${norm}`).slice(0, 10);
}

/** 'x_' + 12 hex: `from` uses `to` through (kind, norm). */
export function edgeId(from, to, kind, norm) {
  return 'x_' + hash64(`${from}|${to}|${kind}|${norm}`).slice(0, 12);
}

/** 'm_' + 12 hex: a manual edge (the creation time keeps two identical manual edges apart). */
export function manualEdgeId(from, to, kind, display, createdAt) {
  return 'm_' + hash64(`${from}|${to}|${kind}|${display}|${createdAt}`).slice(0, 12);
}
