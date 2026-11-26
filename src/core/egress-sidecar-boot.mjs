// src/core/egress-sidecar-boot.mjs — what Worca's box does at start about the corporate proxy login
// (docs/network-proxy.md, "Worca in a container"):
//   - next to an egress sidecar: a proxy-login.json an older version saved in the box is moved to the sidecar once,
//     then deleted. The box keeps no login.
//   - a container with no sidecar (raw `docker compose up`): the in-box login keeps working, with one warning.
// The native install never gets here with anything to do: it has no WORCA_EGRESS_API_URL and no WORCA_CONTAINER.
import { readProxyLogin, clearProxyLogin, proxyLoginFile } from './proxy-credentials.mjs';
import { sidecarConfigured, sidecarClient, SidecarError } from './egress-sidecar-client.mjs';
import { proxyUrlHasLogin } from './env-proxy.mjs';
import { existsSync } from 'node:fs';

export const IN_BOX_LOGIN_TEXT = 'Corporate proxy: the login is kept inside Worca\'s box (no egress sidecar), where agents can read it unless agent isolation is on. '
  + 'Start the box with `worca container up`, which adds the egress sidecar and keeps the login there (docs/network-proxy.md).';

/** The one warning for a container without a sidecar whose proxy login lives in the box, or null. Pure apart from a stat. */
export function inBoxLoginNotice({ env = process.env, home, exists = existsSync } = {}) {
  if (String(env.WORCA_CONTAINER || '') !== '1' || sidecarConfigured(env)) return null;
  const file = proxyLoginFile(home);
  const saved = !!file && exists(file);
  return saved || proxyUrlHasLogin(env) ? IN_BOX_LOGIN_TEXT : null;
}

/** The parts of the box's networkProxy the sidecar takes (never enabled or fixedPort). */
function sidecarPatch(np) {
  const o = {};
  for (const k of ['upstream', 'auth', 'noProxy', 'timeouts']) if (np && np[k] !== undefined && np[k] !== null && np[k] !== '') o[k] = np[k];
  return o;
}

/**
 * Move a login saved in the box to the sidecar, once. Resolves {moved, deleted, reason}. Never throws.
 * @param {{env?: object, home?: string, client?: ReturnType<typeof sidecarClient>, networkProxy?: () => object,
 *   log?: (level: string, text: string) => void, attempts?: number, delayMs?: number}} [o]
 */
export async function moveBoxLoginToSidecar({ env = process.env, home, client = sidecarClient(env), networkProxy = () => ({}),
  log = () => {}, attempts = 12, delayMs = 5000 } = {}) {
  if (!sidecarConfigured(env)) return { moved: false, deleted: false, reason: 'no sidecar' };
  const rec = readProxyLogin(home !== undefined ? { home } : {});
  if (!rec) return { moved: false, deleted: false, reason: 'no login in the box' };
  if (rec.error) {
    // A password equivalent the box cannot even read safely: it goes, and the user logs in again (into the sidecar).
    const deleted = clearProxyLogin(home !== undefined ? { home } : {});
    log('warn', `Corporate proxy: an old proxy login in the box cannot be used (${rec.error}), so it was deleted. Log in again: worca container proxy login`);
    return { moved: false, deleted, reason: rec.error };
  }
  for (let i = 0; i < attempts; i++) {
    try {
      const st = await client.status();
      if (st.status !== 200 || !st.body) throw new SidecarError(`the egress sidecar answered ${st.status}`);
      if (st.body.managed || st.body.login) {
        const deleted = clearProxyLogin(home !== undefined ? { home } : {});
        log('info', `Corporate proxy: the egress sidecar already has a login${st.body.managed ? ' (managed by the operator)' : ''}, so the old login in the box was deleted`);
        return { moved: false, deleted, reason: 'sidecar has a login' };
      }
      if (st.body.state === 'not-configured') {
        const patch = sidecarPatch(networkProxy());
        if (patch.upstream) {
          const s = await client.saveSettings({ networkProxy: patch });
          if (s.status !== 200) {
            log('warn', `Corporate proxy: the old login in the box was not moved: the sidecar refused the proxy settings (${s.body && s.body.error ? s.body.error : s.status}); it stays in the box until the next start`);
            return { moved: false, deleted: false, reason: 'settings refused' };
          }
        }
      }
      const r = await client.login({ domain: rec.domain, user: rec.user, ntHash: rec.ntHash.toString('hex') });
      if (r.status !== 200) {
        log('warn', `Corporate proxy: the old login in the box was not moved (${r.body && r.body.error ? r.body.error : `the sidecar answered ${r.status}`}); it stays in the box until the next start`);
        return { moved: false, deleted: false, reason: 'login refused' };
      }
      const deleted = clearProxyLogin(home !== undefined ? { home } : {});
      log('info', `Corporate proxy: moved the login for ${rec.domain ? `${rec.domain}\\${rec.user}` : rec.user} from the box to the egress sidecar and deleted it here. An older image needs a new login after this.`);
      return { moved: true, deleted, reason: 'moved' };
    } catch (err) {
      if (!(err instanceof SidecarError)) throw err;
      if (err.code === 'SIDECAR_CONFIG' || err.code === 'SIDECAR_SECRET' || i === attempts - 1) {
        log('warn', `Corporate proxy: the old login in the box was not moved: ${err.message}; it stays in the box until the next start`);
        return { moved: false, deleted: false, reason: err.code };
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { moved: false, deleted: false, reason: 'unreachable' };
}

/** The server's boot step: the warning, or the move in the background (the sidecar may still be starting). */
export function startSidecarBoot({ env = process.env, networkProxy, log }) {
  const notice = inBoxLoginNotice({ env });
  if (notice) log('warn', notice);
  if (!sidecarConfigured(env)) return Promise.resolve(null);
  return moveBoxLoginToSidecar({ env, networkProxy, log }).catch((err) => {
    log('warn', `Corporate proxy: moving the old login to the egress sidecar failed (${err && err.message ? err.message : err})`);
    return null;
  });
}
