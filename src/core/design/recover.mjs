// src/core/design/recover.mjs
// Boot recovery for Design builds (P2): a build the last server left open, other than a `paused` one, had its agents
// killed with the host, so its row is marked `interrupted`, reason `restart`. Nothing is spawned (L20): a person
// resumes it with Continue, which rehydrates it from these rows. `closeBuildRow` is the same close for a row this
// server holds no build for while it runs (M6: a store throw cut the build short).

import { listAgents, listOpenBuilds, updateAgent, updateBuild } from './store.mjs';

/** Agent statuses of a process that was running, or of a question waiting on its answer. */
const LIVE_AGENT = new Set(['starting', 'thinking', 'writing', 'reading', 'waiting', 'retrying']);

/**
 * Closes the build row `build` (as `listOpenBuilds` or `getBuild` return it) as `status` with `reason`: its live
 * agents become `agentStatus`, its `writing` sections `stopped`. `updateBuild` sets `endedAt` and keeps the design's
 * status in step. Throws what the store throws.
 * @param {{ id: string, sections: object[] }} build
 * @param {{ status: string, reason: string, agentStatus: string }} end
 */
export function closeBuildRow(build, { status, reason, agentStatus }) {
  for (const a of listAgents(build.id)) if (LIVE_AGENT.has(a.status)) updateAgent(a.id, { status: agentStatus });
  const sections = build.sections.map((s) => (s?.status === 'writing' ? { ...s, status: 'stopped' } : s));
  updateBuild(build.id, { status, reason, sections });
}

/**
 * Marks every open build but a `paused` one, and every one `isLive(id)` names (a build this server runs now),
 * `interrupted` with reason `restart`: its live agents become `interrupted`, its `writing` sections `stopped`.
 * `updateBuild` sets `endedAt` and keeps the design's status in step. A row that fails is logged and skipped.
 * @param {{ isLive?: (buildId: string) => boolean }} [opts]
 * @returns {number} how many builds were marked
 */
export function recoverDesignBuilds({ isLive = () => false } = {}) {
  let n = 0;
  for (const build of listOpenBuilds()) {
    if (build.status === 'paused' || isLive(build.id)) continue;
    try {
      closeBuildRow(build, { status: 'interrupted', reason: 'restart', agentStatus: 'interrupted' });
      n += 1;
    } catch (err) {
      console.error(`[design] build ${build.id} not recovered: ${err && err.message ? err.message : String(err)}`);
    }
  }
  return n;
}
