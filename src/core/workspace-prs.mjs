// Pure helpers for the per-member PRs of a WORKSPACE run: which members exist
// (state.projects x state.branches), which repo a PR route acts on, the rollup that
// the pipelines row's single pr_* columns carry (stats count a run once), and the
// marker-delimited "related PRs" block cross-linked into every sibling PR body.
// Leaf module: no imports, so artifacts.mjs and ui/server.mjs can both use it.

/** Files a member changed. `'D'` rows already count inside filesChanged (results.mjs bucketFiles). */
export const changedFileCount = (s) => (s ? (s.filesNew | 0) + (s.filesChanged | 0) : 0);

/**
 * The run's members as { memberKey, name, projectDir, feature, source, workMode }, in
 * state.projects order. projectDir is the member's REAL repo dir (run-harness
 * resolves it before the worktree), which is where its feature branch is kept.
 * workMode is 'folder' only for a Folder member (state.projects[i].workMode), else 'git'.
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
        workMode: p.workMode === 'folder' ? 'folder' : 'git',
      };
    });
}

/** The repo one PR route call acts on for a workspace run. Never throws. */
export function memberPrTarget(state, memberKey) {
  const key = typeof memberKey === 'string' ? memberKey.trim() : '';
  if (!key) return { ok: false, error: 'memberKey is required for a workspace run' };
  const m = workspaceMembers(state).find((x) => x.memberKey === key);
  if (!m) return { ok: false, error: `unknown workspace member: ${key.slice(0, 80)}` };
  if (m.workMode === 'folder') return { ok: false, error: `a Folder member has no branch to create a PR from: ${m.memberKey}` };
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

const DRAFT_REFUSED = /draft/i;

/**
 * Create a PR through `create(args)`; when a draft is refused (the forge's error names drafts) retry it ready for review.
 * `onDraftFallback({ memberKey, error })` runs once the ready PR exists; the result carries `fellBack: true`.
 * A call that did not ask for a draft is never retried.
 */
export async function createPrWithDraftRetry(create, args, onDraftFallback = null) {
  const out = await create(args);
  if (out.ok || !args.draft || !DRAFT_REFUSED.test(out.error || '')) return out;
  const retry = await create({ ...args, draft: false });
  if (!retry.ok) return retry;
  if (onDraftFallback) onDraftFallback({ memberKey: args.memberKey ?? null, error: out.error });
  return { ...retry, fellBack: true };
}

/**
 * A workspace run's PRs: one per member whose branch has commits (a member the planner left untouched gets none), each
 * on its own base, Watch PR on each (enabled by `actor`), then the PRs cross-linked. Only the issue's own repository's PR
 * closes the issue. `draft` opens them as drafts (a refused draft retries ready: `onDraftFallback({ memberKey, error })`).
 * Every I/O call is in `deps`. → { ok, url, prs, fellBack, existed (every PR was already there), newDraft (some PR is a new draft) } with `url` that PR's (else the first), or { ok:false, error }
 * when no member changed or none opened.
 */
export async function openWorkspaceRunPrs(pipelineId, state, { draft = true, actor = 'automation', onDraftFallback = null } = {}, deps) {
  const prs = []; let changed = 0;
  for (const m of deps.prStateMembers(state)) {
    if (m.workMode === 'folder' || !m.projectDir || !m.feature || !m.source) continue;
    if (!(await deps.branchExists(m.projectDir, m.feature)) || !((await deps.commitsAhead(m.projectDir, m.source, m.feature)) > 0)) continue;
    changed++;
    const target = deps.prTargetFor(state, m.memberKey);
    if (target.error) { prs.push({ name: m.name, repo: null, url: null, error: target.error }); continue; }
    const out = await createPrWithDraftRetry(deps.createRunPr, { id: pipelineId, state, target, base: m.source, memberKey: m.memberKey, draft, actor },
      (e) => onDraftFallback?.({ ...e, name: m.name }));
    if (!out.ok) { prs.push({ name: m.name, repo: null, url: null, error: out.error }); continue; }
    prs.push({ name: m.name, repo: out.repo, url: out.pr.url, closes: !!out.closes, draft: !!out.newDraft, existed: !!out.pr.existed, fellBack: !!out.fellBack });
    if (!out.pr.existed && deps.watchablePrUrl(out.pr.url)) {
      try {
        deps.setWatch({ prUrl: out.pr.url, pipelineId: out.pipelineIdForPr, memberKey: m.memberKey, pushRemote: out.pushRemote, enabled: true, enabledBy: actor });
        deps.broadcast(deps.prWatchFrame(out.pipelineIdForPr, m.memberKey));
      } catch (err) { console.error(`[worca-ui] ${actor}: could not watch ${out.pr.url}: ${err?.message || err}`); }
    }
  }
  if (!changed) return { ok: false, error: 'the run changed no repository' };
  const opened = prs.filter((p) => p.url);
  if (!opened.length) return { ok: false, error: prs.map((p) => `${p.name}: ${p.error}`).join('; ') };
  deps.kickPrWatch();
  if (opened.length >= 2) {
    const r = await deps.crosslinkMemberPrs(pipelineId, deps.readPipelineStateById(pipelineId) || state).catch((err) => ({ failed: [{ error: err?.message || String(err) }] }));
    if (r.edited?.length) deps.appendAuditById(pipelineId, `Cross-linked ${r.edited.length} pull requests to their siblings (${actor}).`, { actor });
  }
  return { ok: true, url: (opened.find((p) => p.closes) || opened[0]).url, prs, fellBack: opened.some((p) => p.fellBack), existed: opened.every((p) => p.existed), newDraft: opened.some((p) => p.draft) };
}
