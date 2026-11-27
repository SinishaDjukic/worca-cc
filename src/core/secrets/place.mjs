// src/core/secrets/place.mjs — where the secret vault can work at all (docs/secrets.md, "With the other setups").
// The vault's key lives in the OS key store of the machine Worca runs on. A container (a plain container with the
// egress sidecar, the Hardened box, a Shared instance, or the egress sidecar itself) has no OS key store, and its
// proxy login belongs to the egress sidecar, so there the vault is "not available here": nothing is sealed, migrated
// or reset, and status says so. The credential broker is the answer for keys in a container (docs/credential-broker.md).
// Pure: reads only `env`. No imports, so flag.mjs, status and the posture can take it without a cycle.

const on = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const set = (v) => typeof v === 'string' && v.trim() !== '';

/** The sentence every surface shows when the vault cannot work here. */
export const CONTAINER_TEXT = 'Not available in a container: a container has no OS key store. '
  + 'Use the credential broker to keep keys out of the box (docs/credential-broker.md).';

/** The `worca doctor` line in a container (flag on). */
export const DOCTOR_CONTAINER_LINE = 'secrets: not available in a container (the credential broker keeps keys out of the box)';

/**
 * 'container' when Worca runs in a container (WORCA_CONTAINER from the image, WORCA_DATA_DIR from a single-volume host,
 * WORCA_BOX for the Hardened box, WORCA_EGRESS_API_URL next to an egress sidecar, WORCA_EGRESS_DATA_DIR in the sidecar
 * itself), else null (a native install, where the vault can be used).
 * @returns {'container'|null}
 */
export function vaultUnavailableHere(env = process.env) {
  if (!env || typeof env !== 'object') return null;
  if (on(env.WORCA_CONTAINER) || set(env.WORCA_DATA_DIR) || set(env.WORCA_BOX)
    || set(env.WORCA_EGRESS_API_URL) || set(env.WORCA_EGRESS_DATA_DIR)) return 'container';
  return null;
}
