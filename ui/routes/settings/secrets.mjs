// ui/routes/settings/secrets.mjs — the secret vault for Settings › General › Secret vault, behind the
// secretVault flag. The status carries the counts by kind (src/core/secrets/summary.mjs: never a value or a name). In a
// container it answers "not available" without loading the OS store. The actions (Check now, Turn on, Reset) map to
// the CLI's logic (worca secrets status --check, the one-time move, worca secrets reset) and act as the person: same
// origin only, JSON only, never an agent. Export stays local CLI only (it refuses while the app runs). GET re-probes through a single-flight cache (concurrent GETs share one probe); startup probes
// once without being awaited; a settings save refreshes it. With the flag off nothing here imports the status core,
// the vault, the OS store or the keyring. Read-only: no route writes a vault file or the OS item. A secret migration
// whose OS-store check failed (noteStoreCheck) overlays the answer until a later migration passes. The pending message
// about secrets moved into the vault is read (GET /api/secrets/notice) and acknowledged (POST /api/secrets/notice/ack,
// compare-and-delete on its id) here too; there is no export route: export is local CLI only.
import { flagEnabled, requireFlag } from '../../../src/core/flags.mjs';
import { worcaHome } from '../../../src/core/projects.mjs';
import { DEPLOYMENT, agentMayBeCaller, teamOriginOk } from '../../server.mjs';
import { vaultUnavailableHere } from '../../../src/core/secrets/place.mjs';
import { noteLastStatus } from '../../../src/core/secrets/last-status.mjs';

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

const ACT_AGENT_TEXT = 'Change the secret vault in your own browser, not from an agent.';
/** The guard of every vault action: the person's own same-origin page, a JSON body, the confirm the dialog sent. */
function refuseAction(req, res, { confirm = false } = {}) {
  if (agentMayBeCaller(req)) { res.status(403).json({ error: ACT_AGENT_TEXT, code: 'VAULT_AGENT_BLOCKED' }); return true; }
  if (!teamOriginOk(req, res)) return true;
  if (!req.is('application/json')) { res.status(415).json({ error: 'send the body as application/json', code: 'JSON_REQUIRED' }); return true; }
  if (confirm && req.body?.confirm !== true) { res.status(400).json({ error: 'confirm the action first', code: 'CONFIRM_REQUIRED' }); return true; }
  if (vaultUnavailableHere(process.env)) { res.status(409).json({ error: 'The secret vault is not available in a container.', code: 'VAULT_CONTAINER' }); return true; }
  return false;
}

/** The status with the counts by kind; in a container the fixed answer, with no OS store loaded. */
async function statusNow() {
  if (vaultUnavailableHere(process.env)) {
    const { containerStatus } = await import('../../../src/core/secrets/status.mjs');
    return { ...containerStatus(), counts: { vault: {}, files: {} } };
  }
  let status;
  try { status = await (await cacheFor()).refresh(); } catch { status = fallback(); }
  let counts = { vault: {}, files: {} };
  try { counts = (await import('../../../src/core/secrets/summary.mjs')).secretCounts({ home: worcaHome() }); } catch { /* counts stay 0 */ }
  noteLastStatus(overlaid(status));   // the chat reads this one (last-status.mjs): it never asks the key store itself
  return { ...overlaid(status), counts };
}

export function register(app) {
  app.get('/api/secrets/status', requireFlag(FLAG), async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await statusNow());
  });

  // Check now: the OS store's write and read check on a throwaway item (worca secrets status --check). Moves nothing.
  app.post('/api/secrets/check', requireFlag(FLAG), async (req, res) => {
    try {
      if (refuseAction(req, res)) return undefined;
      const { checkOsStore } = await import('../../../src/core/secrets/status.mjs');
      const { VAULT_MESSAGES } = await import('../../../src/core/secrets/refs.mjs');
      const r = await checkOsStore();
      if (r.ok) noteStoreCheck({ state: 'done' });
      return res.json({ ok: r.ok, label: r.label, ...(r.ok ? {} : { message: VAULT_MESSAGES[r.code] ?? STORE_CHECK_MESSAGE }), status: await statusNow() });
    } catch {
      return res.status(500).json({ error: 'The key store could not be checked.' });
    }
  });

  // Turn on / Finish moving: the check, then the one-time move of the keys saved in files (as at the start).
  app.post('/api/secrets/enable', requireFlag(FLAG), async (req, res) => {
    try {
      if (refuseAction(req, res, { confirm: true })) return undefined;
      const { checkOsStore } = await import('../../../src/core/secrets/status.mjs');
      const check = await checkOsStore();
      if (!check.ok) {
        noteStoreCheck({ state: 'skipped', reason: check.code === 'store-locked' ? 'locked' : 'unavailable', code: 'store-check' });
        return res.status(409).json({ error: `${check.label} did not pass its write and read check, so nothing was moved.`, code: 'STORE_CHECK', status: await statusNow() });
      }
      const { migrateSecretsIfEnabled } = await import('../../../src/core/secrets/flag.mjs');
      const r = await migrateSecretsIfEnabled({ reason: 'ui', deployment: DEPLOYMENT, log: () => {} });
      noteStoreCheck(r);
      const moved = Object.values(r.moved || {}).reduce((a, b) => a + b, 0);
      if (r.state !== 'done') return res.status(409).json({ error: r.state === 'busy' ? 'Another Worca process is moving the keys. Try again in a minute.' : 'The keys were not moved. They keep working from their files.', code: 'MOVE_' + String(r.state).toUpperCase(), status: await statusNow() });
      return res.json({ ok: true, moved, left: r.left, status: await statusNow() });
    } catch {
      return res.status(500).json({ error: 'The keys could not be moved. They keep working from their files.' });
    }
  });

  // Reset: an unreadable vault moves aside so a new one can start (worca secrets reset). A readable one is refused.
  app.post('/api/secrets/reset', requireFlag(FLAG), async (req, res) => {
    try {
      if (refuseAction(req, res, { confirm: true })) return undefined;
      const { resetVault } = await import('../../../src/core/secrets/status.mjs');
      const r = await resetVault({ confirm: async () => true });
      if (r.outcome === 'refused') return res.status(409).json({ error: r.reason === 'readable' ? 'The vault can be read, so there is nothing to reset.' : 'The vault cannot be reset right now.', code: 'RESET_REFUSED', status: await statusNow() });
      return res.json({ ok: true, outcome: r.outcome, status: await statusNow() });
    } catch {
      return res.status(500).json({ error: 'The vault could not be reset.' });
    }
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
  if (vaultUnavailableHere(process.env)) { try { log('[worca-ui] secrets: not available in a container'); } catch { /* ignore */ } return undefined; }
  cacheFor(probe)
    .then((c) => c.refresh())
    .then((s) => { noteLastStatus(overlaid(s)); return s; })
    .then((s) => `[worca-ui] secrets: ${s.label} (${overlaid(s).state})`, () => '[worca-ui] secrets: No OS key store (unavailable)')
    .then((line) => { try { log(line); } catch { /* a broken logger must not reject */ } });
  return undefined;
}

/** Re-probe after a settings save (fire and forget). Returns undefined; never rejects; nothing with the flag off. */
export function refreshSecretsStatus() {
  if (!flagEnabled(FLAG) || vaultUnavailableHere(process.env)) return undefined;
  cacheFor().then((c) => c.refresh()).catch(() => {});
  return undefined;
}
