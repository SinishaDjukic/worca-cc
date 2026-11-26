// ui/routes/settings/security.mjs — feature "settings": GET /api/security/posture, the instance's security posture as
// this server process sees it (src/core/security-posture.mjs). Read-only; it never calls docker. Settings › General ›
// Security and the setup assistant's "Where agents run" read it.
import { securityPosture } from '../../../src/core/security-posture.mjs';
import { describeExecEnvs } from '../../../src/core/exec-env/index.mjs';
import { currentSpecHash } from '../../../src/core/exec-env/box-image.mjs';
import { execEnvSetting } from '../../../src/core/settings.mjs';
import { REMOTE_MODE, proxyHost } from '../../server.mjs';

/** The secret vault's facts for the "Secrets at rest" row, or null with the flag off and no vault in use. Config files
 *  only (summary.mjs): never the OS key store, so the posture never prompts for the Keychain. */
export async function secretVaultFacts() {
  const { secretVaultFlagOn, vaultInUse } = await import('../../../src/core/secrets/flag.mjs');
  const flagOn = secretVaultFlagOn();
  if (!flagOn && !vaultInUse()) return null;
  let vaultOn = false;
  if (vaultInUse()) {
    try {
      const { vault } = (await import('../../../src/core/secrets/summary.mjs')).secretCounts();
      vaultOn = Object.values(vault).some((n) => n > 0);
    } catch { vaultOn = false; }
  }
  return { flagOn, vaultOn };
}

/** The posture payload; `proxyStatus` and `vaultFacts` are injectable for tests. */
export async function postureNow({ env = process.env, remoteMode = REMOTE_MODE, proxyStatus = () => proxyHost.status(), vaultFacts = secretVaultFacts } = {}) {
  let proxy = null;
  try { proxy = await proxyStatus(); } catch { proxy = null; }
  let secretVault = null;
  try { secretVault = await vaultFacts(); } catch { secretVault = null; }
  const name = execEnvSetting() || 'local';
  const label = describeExecEnvs().find((e) => e.name === name)?.label || name;
  return securityPosture({ env, remoteMode, execEnvDefault: name, execEnvLabel: label, proxy, specHashOf: currentSpecHash, secretVault });
}

export function register(app) {
app.get('/api/security/posture', async (_req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await postureNow()); }
  catch (err) { res.status(500).json({ error: err && err.message ? err.message : String(err) }); }
});
}
