// src/core/sync-before-run.mjs
// Sync before run (plan §4.3, §0.2 C9, D2, D14): the per-member opts.sync a run start hands createOrchestratorFor, and the
// interactive start's precheck that asks the person once about a diverged base or a failed fetch. Moved unchanged out of
// ui/server.mjs, which imports and re-exports both.
import path from 'node:path';
import { effectiveSyncSettings } from './project-sync.mjs';
import { mapWithCap, fanoutCap } from './fanout.mjs';
import { fetchRemote, syncStatus, isSafeBranchName, INTERACTIVE_TIMEOUT_MS } from './git-sync.mjs';

/** Per-member opts.sync for createOrchestratorFor (plan §4.3, D2, D14). */
export function runSyncOpts(members, { allowed, before, policy, scheduled, onDiverged }) {
  const out = {};
  for (const m of members) {
    const s = effectiveSyncSettings(m.projectKey);
    let resolved, source;
    if (scheduled) {
      resolved = onDiverged || (s.onDiverged === 'fail' ? 'fail' : 'origin');       // D2: nobody can answer 'ask'
      source = onDiverged ? 'schedule' : 'setting';
    } else if (s.onDiverged === 'origin') {
      resolved = 'origin'; source = 'setting';                                     // D14: never asks
    } else if (policy === 'origin' && s.onDiverged !== 'fail') {
      resolved = 'origin'; source = 'user';                                        // the person chose on the card
    } else {
      resolved = 'fail'; source = 'setting';                                       // 'fail', or 'ask' not yet answered
    }
    out[m.projectKey] = { enabled: !!(allowed && (before ?? s.beforeRun)), remote: s.remote, onDiverged: resolved, policySource: source };
  }
  return { members: out, enabled: Object.values(out).some((x) => x.enabled) };
}

/**
 * Before an interactive start: fetch (no TTL, 8 s bound) and read each synced member's base.
 * Returns null (start) or { status: 409, body } asking the person once (plan §0.2 C9, D14).
 * A member whose policy already resolves to 'origin' is never asked. No TTL: a Start is an
 * explicit action, so a push that landed inside the 45 s cache (a diverged base the run's own
 * Sync stage would then fail on) or a remote that came back since a failed fetch is seen now.
 */
export async function syncPrecheck(members, sync) {
  const rows = await mapWithCap(members, fanoutCap(), async (m) => {
    const cfg = sync.members[m.projectKey];
    if (!cfg || !cfg.enabled || !isSafeBranchName(m.source)) return null;
    const f = await fetchRemote(m.projectDir, { remote: cfg.remote, maxAgeMs: 0, timeoutMs: INTERACTIVE_TIMEOUT_MS });
    if (!f.ok && (f.kind === 'no-remote' || f.kind === 'bad-remote')) return null;
    const st = await syncStatus(m.projectDir, { base: m.source, remote: cfg.remote });
    // Neither a local nor a remote branch (a tag or a SHA): the harness has no branch to sync, so
    // an offline start from it must not be asked about a failed fetch (D9).
    if (!st.ok || (!st.hasLocal && !st.hasRemote)) return null;
    return { m, f, st, cfg, setting: effectiveSyncSettings(m.projectKey).onDiverged };
  });
  const hit = rows.filter(Boolean);
  const view = (r) => ({ projectKey: r.m.projectKey, projectName: r.m.projectName || path.basename(r.m.projectDir), base: r.m.source,
    remote: r.cfg.remote, ahead: r.st.ahead, behind: r.st.behind, fetchedAt: r.f.fetchedAt || r.st.fetchedAt || null });
  const diverged = hit.filter((r) => r.st.state === 'diverged' && r.cfg.onDiverged !== 'origin');
  if (diverged.length) {
    const d = diverged[0];
    const forbidden = diverged.some((r) => r.setting === 'fail');     // the project forbids starting from the remote
    return { status: 409, body: { code: 'sync-diverged', kind: 'diverged', options: forbidden ? ['cancel'] : ['origin', 'cancel'],
      ...(forbidden ? { forbidden: true } : {}), members: diverged.map(view),
      error: `${d.m.source} has diverged from ${d.cfg.remote}/${d.m.source} (${d.st.ahead} ahead, ${d.st.behind} behind)` } };
  }
  const failed = hit.filter((r) => !r.f.ok);
  if (failed.length) {
    const x = failed[0];
    return { status: 409, body: { code: 'sync-fetch-failed', kind: 'fetch-failed', fetchKind: x.f.kind, options: ['last-fetch', 'cancel'],
      members: failed.map((r) => ({ ...view(r), fetchKind: r.f.kind })), error: `Could not reach ${x.cfg.remote} (${x.f.kind})` } };
  }
  return null;
}
