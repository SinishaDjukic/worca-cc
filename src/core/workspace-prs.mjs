// Pure helpers for the per-member PRs of a WORKSPACE run: which members exist
// (state.projects x state.branches), which repo a PR route acts on, the rollup that
// the pipelines row's single pr_* columns carry (stats count a run once), and the
// marker-delimited "related PRs" block cross-linked into every sibling PR body.
// Leaf module: no imports, so artifacts.mjs and ui/server.mjs can both use it.

/** Files a member changed. `'D'` rows already count inside filesChanged (results.mjs bucketFiles). */
export const changedFileCount = (s) => (s ? (s.filesNew | 0) + (s.filesChanged | 0) : 0);

/**
 * The run's members as { memberKey, name, projectDir, feature, source }, in
 * state.projects order. projectDir is the member's REAL repo dir (run-harness
 * resolves it before the worktree), which is where its feature branch is kept.
 */
export function workspaceMembers(state) {
  const branches = state && state.branches && typeof state.branches === 'object' ? state.branches : {};
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  return projects
    .filter((p) => p && typeof p.projectKey === 'string' && p.projectKey)
    .map((p) => {
      const b = branches[p.projectKey] || {};
      return {
        memberKey: p.projectKey,
        name: p.projectName || p.projectKey,
        projectDir: p.projectDir || null,
        feature: typeof b.feature === 'string' && b.feature ? b.feature : null,
        source: typeof b.source === 'string' && b.source ? b.source : null,
      };
    });
}

/** The repo one PR route call acts on for a workspace run. Never throws. */
export function memberPrTarget(state, memberKey) {
  const key = typeof memberKey === 'string' ? memberKey.trim() : '';
  if (!key) return { ok: false, error: 'memberKey is required for a workspace run' };
  const m = workspaceMembers(state).find((x) => x.memberKey === key);
  if (!m) return { ok: false, error: `unknown workspace member: ${key.slice(0, 80)}` };
  return { ok: true, target: { repoDir: m.projectDir, feature: m.feature, source: m.source, memberKey: m.memberKey, memberName: m.name } };
}

const upper = (s) => String(s || '').toUpperCase();

/**
 * One PR standing for the whole run (the pipelines row's pr_* columns): MERGED as
 * soon as ANY member PR is merged, else OPEN as soon as any is open; url/number of
 * the first merged (else first open) member in key order. Null when none is live.
 * @param {Record<string,{url:string,number?:number|null,state?:string}>} prs
 */
export function rollupMemberPrs(prs) {
  const live = Object.keys(prs || {}).sort()
    .map((k) => prs[k])
    .filter((p) => p && p.url && (upper(p.state) === 'OPEN' || upper(p.state) === 'MERGED'));
  if (!live.length) return null;
  const merged = live.find((p) => upper(p.state) === 'MERGED');
  const pick = merged || live[0];
  return { url: pick.url, number: pick.number ?? null, state: merged ? 'MERGED' : 'OPEN' };
}

export const RELATED_PRS_START = '<!-- worca:related-prs -->';
export const RELATED_PRS_END = '<!-- /worca:related-prs -->';

/** The sibling list written into each member PR's body. */
export function relatedPrsBlock({ workspaceName = null, siblings = [] } = {}) {
  const head = workspaceName
    ? `**Related pull requests** (same worca workspace run in *${workspaceName}*):`
    : '**Related pull requests** (same worca workspace run):';
  const lines = siblings.map((s) => `- ${s.name}: ${s.url}${upper(s.state) === 'MERGED' ? ' (merged)' : ''}`);
  return [RELATED_PRS_START, head, ...lines, RELATED_PRS_END].join('\n');
}

/** Replace the body's related block (or append one); text outside the markers is kept. */
export function withRelatedPrsBlock(body, block) {
  const text = String(body ?? '');
  const i = text.indexOf(RELATED_PRS_START);
  const k = i >= 0 ? text.indexOf(RELATED_PRS_END, i) : -1;
  const base = i >= 0 && k > i
    ? (text.slice(0, i).trimEnd() + text.slice(k + RELATED_PRS_END.length)).trimEnd()
    : text.trimEnd();
  return base ? `${base}\n\n${block}` : block;
}
