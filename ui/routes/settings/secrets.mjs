// ui/routes/settings/secrets.mjs — the secret vault's OS key store status for Settings › About, behind the
// secretVault flag. GET re-probes through a single-flight cache (concurrent GETs share one probe); startup probes
// once without being awaited; a settings save refreshes it. With the flag off nothing here imports the status core,
// the vault, the OS store or the keyring. Read-only: no route writes a vault file or the OS item. A secret migration
// whose OS-store check failed (noteStoreCheck) overlays the answer until a later migration passes. The pending message
// about secrets moved into the vault is read (GET /api/secrets/notice) and acknowledged (POST /api/secrets/notice/ack,
// compare-and-delete on its id) here too; there is no export route: export is local CLI only.
import { flagEnabled, requireFlag } from '../../../src/core/flags.mjs';
import { worcaHome } from '../../../src/core/projects.mjs';
import { agentMayBeCaller, teamOriginOk } from '../../server.mjs';

const FLAG = 'secretVault';
let cachePromise = null;
let failedCheck = null;   // { state, code } of the last migration whose preflight or key read-back failed

// Fixed text, equal to VAULT_MESSAGES['store-check'] in src/core/secrets/refs.mjs (pinned by a test): the route does
// not load the secrets modules for it.
export const STORE_CHECK_MESSAGE = 'the OS key store did not pass its write and read check; nothing was moved';

/**
 * Keep the outcome of a secret migration (secrets/flag.mjs migrateSecretsIfEnabled) for the status answer: a `skipped`
 * run with a check code (the preflight or the key read-back failed) is overlaid on every later answer, as state
 * `locked` or `unavailable`, `reason: 'store-check'`, until a run is `done`. Any other result leaves it as it is.
 */
export function noteStoreCheck(result) {
  if (result?.state === 'skipped' && result.code) failedCheck = { state: result.reason === 'locked' ? 'locked' : 'unavailable', code: result.code };
  else if (result?.state === 'done') failedCheck = null;
}

const overlaid = (status) => (failedCheck
  ? { ...status, state: failedCheck.state, reason: 'store-check', message: STORE_CHECK_MESSAGE, code: failedCheck.code }
  : status);

// The cache, created once on first use with the flag on, so concurrent first uses share it. An injected `probe`
// (tests) starts a fresh cache around it.
function cacheFor(probe) {
  // The default probe asks through the settings vault's primed store, so the start's prime and the status share one
  // getKey, and a status refresh never zeroes the key the settings vault holds.
  const create = () => Promise.all([import('../../../src/core/secrets/status.mjs'), import('../../../src/core/secrets/settings-vault.mjs')])
    .then(([{ createStatusCache, secretsStatus }, { settingsVaultStore }]) => createStatusCache({
      probe: probe ?? (async () => secretsStatus({ store: await settingsVaultStore() })),
    }));
  if (probe) return (cachePromise = create());
  cachePromise ??= create().catch((err) => { cachePromise = null; throw err; });
  return cachePromise;
}

// The answer when even the status core failed to load: fixed text only.
const fallback = () => ({
  backend: 'none', label: 'No OS key store', state: 'unavailable', vault: 'unknown',
  reason: 'store-unavailable', message: 'no OS key store is available for the Worca vault', checkedAt: new Date().toISOString(),
});

const NOTICE_AGENT_TEXT = 'Acknowledge this message in your own browser, not from an agent.';
const NOTICE_FAILED = 'The message about moved secrets could not be read.';
const ID_RE = /^[0-9a-f]{16}$/;

export function register(app) {
  app.get('/api/secrets/status', requireFlag(FLAG), async (_req, res) => {
    let status;
    try {
      status = await (await cacheFor()).refresh();
    } catch {
      status = fallback();
    }
    res.json(overlaid(status));
  });

  // The pending notice: key names, the backend label and counts only (never a value).
  app.get('/api/secrets/notice', requireFlag(FLAG), async (_req, res) => {
    try {
      const { readNotice } = await import('../../../src/core/secrets/notice.mjs');
      const n = readNotice({ home: worcaHome() });
      res.json({ notice: n ? { id: n.id, at: n.at, label: n.label, keys: n.keys, left: n.left } : null });
    } catch {
      res.status(500).json({ error: NOTICE_FAILED });
    }
  });

  // Got it: the person's own browser only (an agent cannot dismiss the message about the moved keys).
  app.post('/api/secrets/notice/ack', requireFlag(FLAG), async (req, res) => {
    try {
      if (agentMayBeCaller(req)) return res.status(403).json({ error: NOTICE_AGENT_TEXT });
      if (!teamOriginOk(req, res)) return undefined;
      const id = req.body?.id;
      if (typeof id !== 'string' || !ID_RE.test(id)) return res.status(400).json({ error: 'send the notice id' });
      const { ackNotice } = await import('../../../src/core/secrets/notice.mjs');
      return res.json({ ok: true, cleared: await ackNotice({ home: worcaHome(), id }) });
    } catch {
      return res.status(500).json({ error: 'The message could not be acknowledged.' });
    }
  });
}

/**
 * Probe once at startup and log one fixed line (`[worca-ui] secrets: LABEL (STATE)`), also when the probe throws.
 * Returns undefined at once; never rejects; does nothing with the flag off.
 */
export function startSecretsProbe({ log = (m) => console.log(m), probe } = {}) {
  if (!flagEnabled(FLAG)) return undefined;
  cacheFor(probe)
    .then((c) => c.refresh())
    .then((s) => `[worca-ui] secrets: ${s.label} (${overlaid(s).state})`, () => '[worca-ui] secrets: No OS key store (unavailable)')
    .then((line) => { try { log(line); } catch { /* a broken logger must not reject */ } });
  return undefined;
}

/** Re-probe after a settings save (fire and forget). Returns undefined; never rejects; nothing with the flag off. */
export function refreshSecretsStatus() {
  if (!flagEnabled(FLAG)) return undefined;
  cacheFor().then((c) => c.refresh()).catch(() => {});
  return undefined;
}
