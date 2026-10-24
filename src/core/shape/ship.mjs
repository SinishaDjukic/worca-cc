// src/core/shape/ship.mjs — Ship as (D24) and the feature's changelog entry (D25). The server injects the PR and git
// operations; this module decides the order. Engine side, ungated: only POST /api/shape/features/:id/ship reaches it.
import { changelogWithFeature } from '../../shared/shape/slices.mjs';
import { parseReleaseChoice } from '../../shared/release-version.mjs';

export const SHIP_MODES = Object.freeze(['stacked', 'one']);

/**
 * The combined body of the one PR: a section per slice. `keptUrl` is a draft that becomes the one PR (not closed).
 * Over `maxChars` (the caller passes PR_BODY_MAX less room for createRunPr's closing line and footer) the checklists
 * are left out; each stays in its slice's closed draft.
 */
export function onePrBody(slices, keptUrl = null, { maxChars = Infinity } = {}) {
  // One ship flow: a slice without a PR (the normal case now) has no Draft line.
  const draftLine = (s) => (!s.pr || !s.pr.url ? '' : s.pr.url === keptUrl ? 'Draft: this pull request' : `Draft: ${s.pr.url} (closed)`);
  const build = (withLists) => slices.map((s) => `## Slice ${s.index}: ${s.title}\n\n${s.summary ? `${s.summary}\n\n` : ''}`
    + `${withLists && s.checklistMd ? `${s.checklistMd}\n\n` : ''}${draftLine(s)}`.trimEnd()).join('\n\n');
  const full = build(true);
  const closedAny = slices.some((s) => s.pr && s.pr.url && s.pr.url !== keptUrl);
  return full.length <= maxChars ? full
    : `${build(false)}\n\n${closedAny ? "Each slice's checklist is in its closed draft." : "The slices' checklists are left out to fit."}`;
}

/**
 * @param {{feature:{id,title,slices:Array<{index,title,pipelineId,pr:{url}|null, summary?:string, checklistMd?:string}>},
 *   mode:'stacked'|'one', maxBody?:number}} input
 * @param {{commitChangelog(pipelineId, update):Promise<{ok,error?,kind?}>, push(pipelineId):Promise<{ok,error?}>,
 *   openOnePr({pipelineId, title, body}):Promise<{ok,url?,existed?,error?}>, adoptOnePr({url, pipelineId, body}):Promise<{ok,error?}>,
 *   markReady(prUrl):Promise<{ok,error?}>, close(prUrl, comment, pipelineId):Promise<{ok,error?}>,
 *   refreshBody(prUrl, pipelineId):Promise<unknown>}} deps
 * @returns {Promise<{ok:true, mode, prUrl:string|null, closed?:number, warnings:string[]}|{ok:false, status:number, error:string}>}
 *   closed (mode 'one'): how many drafts were closed. The one PR replaces the last row's PR, so the rows cannot tell.
 *   One: slices may have no PR (the one ship flow opens none per slice); stacked needs every slice's PR.
 */
export async function shipFeature({ feature, mode, maxBody = Infinity }, deps) {
  if (!SHIP_MODES.includes(mode)) return { ok: false, status: 400, error: 'mode must be stacked or one' };
  const slices = feature.slices;
  const last = slices[slices.length - 1];
  // One ship flow: stacked marks every slice PR ready, so each needs one; One makes its own and closes only those that exist.
  const missing = mode === 'stacked' && slices.find((s) => !s.pr || !s.pr.url);
  if (missing) return { ok: false, status: 409, error: `slice ${missing.index} has no pull request yet` };
  // D25 first, so the entry is part of what ships (the one PR, or the last stacked PR). changelogWithFeature leaves a
  // text that already has this feature's entry as it is, so a retry after a later failure adds no second entry.
  const cl = await deps.commitChangelog(last.pipelineId, (text) => changelogWithFeature(text, feature));
  if (!cl.ok) return { ok: false, status: 409, error: `could not write the changelog: ${cl.error}` };
  const pushed = await deps.push(last.pipelineId);
  if (!pushed.ok) return { ok: false, status: 500, error: `git push failed: ${pushed.error}` };
  const warnings = [];
  if (mode === 'stacked') {
    for (const s of slices) {                          // merge order
      const r = await deps.markReady(s.pr.url);
      if (!r.ok) return { ok: false, status: 500, error: `could not mark slice ${s.index}'s PR ready: ${r.error}` };
    }
    for (const s of slices) await Promise.resolve(deps.refreshBody(s.pr.url, s.pipelineId)).catch(() => warnings.push(`slice ${s.index}: links not refreshed`));
    return { ok: true, mode, prUrl: null, warnings };
  }
  const one = await deps.openOnePr({ pipelineId: last.pipelineId, title: feature.title, body: onePrBody(slices, null, { maxChars: maxBody }) });
  if (!one.ok) return { ok: false, status: 500, error: `could not create the PR: ${one.error}` };
  // P16: the forge answered with an open PR from the same head into the same base (the last slice's draft already
  // targets the root): that PR is the one PR. Make it ready and give it the combined body; never close it.
  let kept = null;
  if (one.existed) {
    kept = one.url;
    const a = await deps.adoptOnePr({ url: one.url, pipelineId: last.pipelineId, body: onePrBody(slices, kept, { maxChars: maxBody }) });
    if (!a.ok) return { ok: false, status: 500, error: `could not mark the pull request ready: ${a.error}` };
  }
  let closed = 0;
  for (const s of slices) {
    if (!s.pr || !s.pr.url || s.pr.url === kept) continue;   // a slice without a PR has nothing to close
    const c = await deps.close(s.pr.url, `Shipped as one pull request: ${one.url}`, s.pipelineId);
    if (c.ok) closed++;
    else warnings.push(`could not close slice ${s.index}'s draft: ${c.error}`);
  }
  return { ok: true, mode, prUrl: one.url, closed, warnings };
}

/** Shaper s4: the Ship card's verbs; nothing else is accepted on a `ship` card. null = Not now. */
export const SHIP_CARD_VERBS = Object.freeze({ 'ship-one': 'one', 'ship-stacked': 'stacked', 'not-now': null });

/** → { ok:true, verb, mode:'one'|'stacked'|null, release:{version}|null } | { ok:false, status:400, error } */
export function shipCardVerb(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (typeof b.verb !== 'string' || !Object.prototype.hasOwnProperty.call(SHIP_CARD_VERBS, b.verb)) {
    return { ok: false, status: 400, error: 'verb must be ship-one, ship-stacked or not-now' };
  }
  const mode = SHIP_CARD_VERBS[b.verb];
  if (mode === null) {
    return b.release === undefined || b.release === null
      ? { ok: true, verb: b.verb, mode: null, release: null }
      : { ok: false, status: 400, error: 'not-now takes no release' };
  }
  const r = parseReleaseChoice(b.release);
  if (r.error) return { ok: false, status: 400, error: r.error };
  return { ok: true, verb: b.verb, mode, release: r.value };
}
