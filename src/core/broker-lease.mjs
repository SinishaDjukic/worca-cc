// src/core/broker-lease.mjs
// One spawn's broker token (plans/credential-broker-design.html §5.2): who pays, which slot, how long, isolated or not.
// Every engine adapter that runs brokered takes its token here; runViaBroker (engines/claude.mjs) too. The token is
// revoked by `release()` on every exit (the adapter's finally).
import { brokerInfo, mintSpawnToken, revokeSpawnToken, slotBaseUrl } from './broker-client.mjs';
import { resolveBillTo, normalizeBillTo, currentOwner } from './billing.mjs';
import { agentIdentity } from './agent-user.mjs';
import { agentIdentityFor } from './agent-pool.mjs';

const SPAWN_TTL_SEC = { aux: 600, test: 600, ask: 7200, phase: 86400 };

/** Error in the recovery classes the orchestrator already knows (auth pauses, never retries blindly). */
export function brokerSpawnError(message, errorClass = 'auth') {
  return Object.assign(new Error(`worca-broker: ${message}`), { errorClass });
}

/**
 * Mint a spawn token for `slot`. `spawn`: the spawn's own options {billTo, spawnKind, permissionMode, askLockdown,
 * runId, threadId, maxBudgetUsd, asAgent, execEnv} — runViaBroker passes its `opts`, the other adapters the fields they
 * destructure (7.7). Resolves `{ baseUrl, token, secrets, mode, release }`; `release()` is idempotent and never throws
 * (revokeSpawnToken is async and swallows its own errors).
 */
export async function brokerLease(spawn, slot) {
  let info;
  try { info = await brokerInfo(); } catch (err) { throw brokerSpawnError(err.message, 'network'); }
  let billTo = resolveBillTo(spawn.billTo);
  if (info.mode === 'multi' && (!billTo || billTo === 'local')) {
    billTo = normalizeBillTo(process.env.WORCA_BROKER_SYSTEM_BILL_TO);
    if (!billTo) throw brokerSpawnError('this action has no signed-in person to bill it to. Start it from the web UI, or set WORCA_BROKER_SYSTEM_BILL_TO for work nobody in particular starts');
  }
  // `askLockdown` (deviation, listed in §2): a Codex/Copilot chat locks itself down without permissionMode 'dontAsk'.
  const kind = ['aux', 'test', 'ask', 'phase'].includes(spawn.spawnKind) ? spawn.spawnKind
    : (spawn.permissionMode === 'dontAsk' || spawn.askLockdown ? 'ask' : 'phase');
  const owner = normalizeBillTo(currentOwner()) || billTo;
  const isolated = spawn.execEnv?.remote ? owner === billTo
    : spawn.asAgent ? owner === billTo && !!agentIdentityFor(owner)?.dedicated : !!agentIdentity();
  const budgetUsd = typeof spawn.maxBudgetUsd === 'number' && Number.isFinite(spawn.maxBudgetUsd) && spawn.maxBudgetUsd > 0 ? spawn.maxBudgetUsd : undefined;
  let minted;
  try {
    minted = await mintSpawnToken({ billTo: billTo || 'local', slots: [slot], kind, ttlSec: SPAWN_TTL_SEC[kind],
      runId: spawn.runId || null, threadId: spawn.threadId || null, isolated, budgetUsd });
  } catch (err) {
    throw brokerSpawnError(`cannot get a token for this spawn: ${err.message}`, err.status === 401 ? 'auth' : 'network');
  }
  let released = false;
  return { baseUrl: slotBaseUrl(slot), token: minted.token, secrets: [minted.token], mode: info.mode,
    release: () => { if (!released) { released = true; revokeSpawnToken(minted.spawnId); } } };
}
